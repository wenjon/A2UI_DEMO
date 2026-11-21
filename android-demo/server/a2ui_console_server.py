#!/usr/bin/env python3
"""A2UI web console server.

Natural language -> A2UI JSON -> live SSE push to the Android demo.

    python a2ui_console_server.py --port 8787
    adb reverse tcp:8787 tcp:8787
    browser: http://127.0.0.1:8787/
    app:     实时流 -> http://127.0.0.1:8787/stream

Endpoints
    GET  /                console UI
    GET  /stream          SSE (data: <a2ui message>)
    GET  /api/status      server / model / client state
    GET  /api/messages    last pushed scene as a JSON array
    GET  /health          probe
    POST /api/generate    {prompt, preferLlm, surfaceKind, script, useModel} -> scene
    GET  /api/hmi/scene   ?prompt=...&script=...&model=1[&sim=jam&sim_at=2520&seed=7] -> generate with surfaceKind=hmi
    GET  /api/sim/presets                -> 车辆状态模拟器的预设清单（来自 demo/server/hmi-sim.ts --list --json）
    GET  /api/sim/state     ?preset=jam&at=2520[&seed=7] -> 某个时刻的模拟快照
    POST /api/sim/control   {preset, at, actions:[{"domain":"climate","key":"driverSetC","value":27}]} -> 发一次车控指令后的快照
    POST /api/validate    {messages} -> errors / warnings / stats
    POST /api/push        {messages, title, delayMs} -> broadcast
    POST /api/agent/request {text, note} -> 收件箱收单（不生成、不推送）
    GET  /api/agent/pending              -> {"items":[...]}：只有 pending，createdAt 升序
    GET  /api/agent/all?limit=20         -> {"items":[...]}：最近记录（各种 status），新的在前
    POST /api/agent/claim {id}           -> pending -> working（没找到 404，已被捞走 409）
    POST /api/agent/done  {id, provider, archetypeName, componentCount, title, blocks, notes}
    POST /api/agent/fail  {id, error}    -> status=failed，原因写进 result.error
    POST /api/agent/clear                -> 只删 done/failed，返回删除条数

Two scene kinds share the same SSE channel:
    surfaceKind="basic" (默认) -> a2ui_generator.generate_scene（Basic Catalog，原逻辑不变）
    surfaceKind="hmi"          -> node demo/server/hmi-cli.ts（车机 1920×1200 组装）
                                   默认仍是服务端确定性组装；useModel / model=1 时加 --model，
                                   让本地模型写块、服务端 compileHmiBlocks 纠偏（失败自动回退）。

「交给 Agent 推理」收件箱（本后台只收单，不推理）：
    网页 / 命令行工具把场景描述 POST 到 /api/agent/request 进收件箱；真正写块的是 DeepSeek Harness
    会话里的 Agent：它 GET /api/agent/pending、POST /api/agent/claim 捞单，推理出块脚本后自己调
    /api/generate（带 script）+ /api/push，最后 POST /api/agent/done 标成已处理。
    这条分支后台自己不做任何推理，也不会自动去调 /api/generate。
    记录持久化在 console/agent-inbox.jsonl（每行一条 JSON，UTF-8，追加写；启动时读回来，坏行跳过）。

「车辆状态模拟数据」（docs/hmi-features-and-sim.md 第 3 节的契约）：
    模拟器本体在 demo/server/hmi-sim.ts（本后台不实现它、也不维护第二份预设表）：
      node demo/server/hmi-sim.ts --list --json                            -> GET  /api/sim/presets
      node demo/server/hmi-sim.ts --preset jam --at 2520 [--seed 7] --json -> GET  /api/sim/state
      node demo/server/hmi-sim.ts --preset jam --at 300 --control '<json>' -> POST /api/sim/control
    生成场景时带 sim：POST /api/generate {..., "sim": {"preset":"jam","at":2520,"seed":7}}（也接受 "sim":"jam"），
    后台把它拼成 hmi-cli.ts 的 --sim / --sim-at / --seed，并把返回里的 sim 摘要原样放进响应；
    不带 sim 时 argv 和响应字段都与改动前一字不差（前端 Basic 流程照旧）。
    模拟器还没实现好时这几个接口返回 {"error":"模拟器未就绪…"}，不会退回一份写死的预设副本。
"""
from __future__ import annotations

import argparse
import json
import os
import queue
import secrets
import shutil
import subprocess
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from a2ui_generator import (
    CATALOG,
    DEFAULT_SURFACE,
    OPERATIONS,
    generate_scene,
    llm_available,
    model_settings,
    validate_messages,
)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO_DIR = os.path.dirname(BASE_DIR)
CONSOLE_FILE = os.path.join(BASE_DIR, "console", "index.html")
APP_FILE = os.path.join(BASE_DIR, "console", "app.js")
MAX_BODY = 8 * 1024 * 1024

# --------------------------------------------------------------- 车机 HMI 入口
HMI_CLI = os.path.join(REPO_DIR, "demo", "server", "hmi-cli.ts")
HMI_TIMEOUT = 60
HMI_MODEL_TIMEOUT = 240  # 模型写块：本地小模型一次可能要几十秒到上百秒，超时给足（>= 180s）
HMI_ERROR_STATUS = 502
HMI_CATALOG = "https://luckplusone.cfifa.com/a2ui/hmi/catalog.json"

# -------------------------------------------------- 车辆状态模拟器（demo 侧实现）
HMI_SIM = os.path.join(REPO_DIR, "demo", "server", "hmi-sim.ts")   # 预设表 / 快照算法都在这个文件里
SIM_TIMEOUT = 60                # 模拟器是纯计算，60s 足够；卡住就当它没就绪
SIM_NOT_READY_STATUS = 503      # hmi-sim.ts 缺失 / 子命令没实现

# 车机「模型写块」用的本地模型（OpenAI 兼容接口）：默认 Strata 的 qwen3.8-flash-next(8090)，ollama 用 11434
DEFAULT_LLM_BASE = "http://127.0.0.1:8090"
DEFAULT_LLM_MODEL = "qwen3.8-flash-next"
LLM_SETTINGS = {
    "base_url": (os.environ.get("A2UI_LLM_BASE") or DEFAULT_LLM_BASE).strip(),
    "model": (os.environ.get("A2UI_LLM_MODEL") or DEFAULT_LLM_MODEL).strip(),
}
HMI_COMPONENTS = {
    "HmiScreen", "HmiAsset", "HmiText", "HmiHotspot", "HmiPanel", "HmiSpeedometer",
    "HmiStatusBar", "HmiNavInstruction", "HmiRouteInfo", "HmiMapButtons",
    "HmiZoomControl", "HmiRouteProgress", "HmiControlBar",
}

# ------------------------------------------------- 「交给 Agent 推理」收件箱
AGENT_FILE = os.path.join(BASE_DIR, "console", "agent-inbox.jsonl")
AGENT_STATUSES = ("pending", "working", "done", "failed")   # 待捞 / 处理中 / 已生成 / 失败
AGENT_FINISHED = ("done", "failed")                         # clear 只删这两种
AGENT_TEXT_LIMIT = 4000      # 跟 /api/generate 的 prompt 上限对齐
AGENT_NOTE_LIMIT = 1000
AGENT_BLOCKS_LIMIT = 20000   # Agent 写回来的块原文存进 result.blocks 的上限
AGENT_STATUS_ITEMS = 8       # /api/status 的 agent.items 带最近几条（摘要，不带 blocks）
AGENT_STATUS_TEXT = 220      # /api/status 里场景描述截断长度


def agent_clip(text, limit):
    raw = str(text or "").replace("\r", " ").replace("\n", " ").strip()
    if not limit or len(raw) <= limit:
        return raw
    return raw[: max(1, limit - 1)] + "…"


def normalise_agent_record(record):
    """把 jsonl 里读到的一行修成可用记录；修不出来返回 None（坏行跳过，不崩）。"""
    record_id = str(record.get("id") or "").strip()
    if not record_id:
        return None
    created = record.get("createdAt")
    if not isinstance(created, (int, float)) or isinstance(created, bool):
        created = time.time()
    updated = record.get("updatedAt")
    if not isinstance(updated, (int, float)) or isinstance(updated, bool):
        updated = created
    status = str(record.get("status") or "").strip().lower()
    if status not in AGENT_STATUSES:
        status = "pending"
    result = record.get("result")
    out = {
        "id": record_id,
        "text": str(record.get("text") or ""),
        "note": str(record.get("note") or ""),
        "status": status,
        "createdAt": float(created),
        "updatedAt": float(updated),
        "result": dict(result) if isinstance(result, dict) else None,
    }
    claimed = record.get("claimedAt")
    if isinstance(claimed, (int, float)) and not isinstance(claimed, bool):
        out["claimedAt"] = float(claimed)
    return out


def agent_public(record, text_limit=0, hide_blocks=False):
    """对外形态；text_limit / hide_blocks 给 /api/status 的轮询瘦身用。"""
    if record is None:
        return None
    item = {
        "id": record["id"],
        "text": record["text"] if not text_limit else agent_clip(record["text"], text_limit),
        "note": record.get("note") or "",
        "status": record["status"],
        "createdAt": record["createdAt"],
        "updatedAt": record["updatedAt"],
        "result": dict(record["result"]) if isinstance(record.get("result"), dict) else None,
    }
    if record.get("claimedAt") is not None:
        item["claimedAt"] = record["claimedAt"]
    if hide_blocks and isinstance(item["result"], dict) and "blocks" in item["result"]:
        result = dict(item["result"])
        blocks = str(result.pop("blocks") or "")
        result["blockChars"] = len(blocks)
        item["result"] = result
    return item


def scene_stats(messages):
    components = {}
    for message in messages:
        if not isinstance(message, dict):
            continue
        update = message.get("updateComponents")
        if isinstance(update, dict) and isinstance(update.get("components"), list):
            for item in update["components"]:
                if isinstance(item, dict) and isinstance(item.get("id"), str):
                    components[item["id"]] = item.get("component")
    return {"messageCount": len(messages), "componentCount": len(components)}


class HmiError(Exception):
    """车机 HMI 生成失败（node 缺失 / 超时 / 输出不合法）。"""


class SimNotReadyError(HmiError):
    """车辆状态模拟器还没就绪：demo/server/hmi-sim.ts 不存在，或那个子命令还没实现。"""


def _tail(text, limit=400):
    raw = str(text or "").strip()
    return raw[-limit:] if raw else "（无输出）"


def find_node():
    """沿用 run_hmi_cli 的 node 查找：PATH 里没有 node 就报同一段话。"""
    node = shutil.which("node")
    if not node:
        raise HmiError("未找到 node：PATH 里没有 node 可执行文件。车机 HMI 场景要跑 demo/server/hmi-cli.ts，"
                       "请安装 Node.js（>= 22）或把它加入 PATH 后重试。")
    return node


def _opt_int(value, label):
    """query / JSON 里的秒数、种子读成 int；没传返回 None。"""
    if value is None:
        return None
    if isinstance(value, bool):
        raise ValueError(label + " 必须是整数")
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if float(value).is_integer():
            return int(value)
        raise ValueError(label + " 必须是整数")
    text = str(value).strip()
    if not text:
        return None
    try:
        return int(text)
    except ValueError:
        raise ValueError(label + " 必须是整数（秒数 / 种子）：" + text[:40])


def parse_sim_option(payload):
    """/api/generate 的 sim：既接受 {"preset":"jam","at":2520,"seed":7}，也接受简写 "sim":"jam"。

    没传 sim 返回 None（调用方的 argv 与响应都保持原样）。返回 (preset, at, seed)。
    """
    raw = payload.get("sim")
    if raw is None:
        return None
    if isinstance(raw, str):
        preset = raw.strip()
        if not preset:
            return None
        return (preset, None, None)
    if isinstance(raw, dict):
        preset = str(raw.get("preset") or "").strip()
        if not preset:
            raise ValueError('sim 需要 preset，例如 {"preset":"jam","at":2520,"seed":7}')
        return (preset, _opt_int(raw.get("at"), "sim.at"), _opt_int(raw.get("seed"), "sim.seed"))
    raise ValueError('sim 只能是预设名（"jam"）或 {"preset":"jam","at":2520,"seed":7}')


def parse_sim_query(query):
    """GET 查询里的 sim / sim_at / seed（等价于 generate 带 sim）。没传 sim 返回 None。"""
    preset = (query.get("sim") or [""])[0].strip()
    if not preset:
        return None
    return (preset, _opt_int((query.get("sim_at") or [None])[0], "sim_at"),
            _opt_int((query.get("seed") or [None])[0], "seed"))


def sim_cli_args(preset, at=None, seed=None, json_flag=True):
    """拼 hmi-sim.ts 的 argv：--preset <名> [--at <秒>] [--seed <n>] [--json]。"""
    argv = ["--preset", preset]
    if at is not None:
        argv += ["--at", str(at)]
    if seed is not None:
        argv += ["--seed", str(seed)]
    if json_flag:
        argv.append("--json")
    return argv


def run_sim_cli(args, label):
    """跑 demo/server/hmi-sim.ts 并把它的 JSON 原样带回来（不解析成我们自己的形状）。"""
    node = find_node()
    if not os.path.isfile(HMI_SIM):
        raise SimNotReadyError("模拟器未就绪：" + HMI_SIM
                               + " 还不存在（车辆状态模拟器由 demo 侧实现，控制台不代做、也不内置预设表）")
    argv = [node, HMI_SIM] + list(args)
    try:
        completed = subprocess.run(
            argv,
            cwd=REPO_DIR,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=SIM_TIMEOUT,
        )
    except subprocess.TimeoutExpired:
        raise HmiError(label + "超时（> " + str(SIM_TIMEOUT) + "s）：" + " ".join(args))
    except OSError as exc:
        raise HmiError("调用 node 失败：" + str(exc))
    if completed.returncode != 0:
        raise HmiError(label + "失败（exit " + str(completed.returncode) + "）：" + _tail(completed.stderr))
    raw = (completed.stdout or "").strip()
    if not raw:
        raise HmiError(label + "没有输出 JSON：" + _tail(completed.stderr))
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HmiError(label + "的输出不是 JSON：" + str(exc) + " / " + _tail(raw, 200))


def sim_error_payload(exc):
    """模拟器接口的统一错误形态；模块没就绪时顺带说明该跑哪条命令把它补齐。"""
    if isinstance(exc, SimNotReadyError):
        return {"error": str(exc), "hint": "node demo/server/hmi-sim.ts --list --json（由 demo 侧实现）"}, SIM_NOT_READY_STATUS
    return {"error": str(exc)}, HMI_ERROR_STATUS



def surface_kind(messages):
    """basic | hmi：按消息里的 catalogId / 组件名判断，Basic 流程一律走原校验。"""
    if not isinstance(messages, list):
        return "basic"
    for message in messages:
        if not isinstance(message, dict):
            continue
        for op in OPERATIONS:
            body = message.get(op)
            if not isinstance(body, dict):
                continue
            catalog = str(body.get("catalogId") or "")
            if "hmi" in catalog.lower():
                return "hmi"
            items = body.get("components")
            if isinstance(items, list):
                for item in items:
                    if isinstance(item, dict) and str(item.get("component") or "").startswith("Hmi"):
                        return "hmi"
    return "basic"


def first_surface_id(messages):
    if not isinstance(messages, list):
        return ""
    for message in messages:
        if not isinstance(message, dict):
            continue
        for op in OPERATIONS:
            body = message.get(op)
            if isinstance(body, dict) and isinstance(body.get("surfaceId"), str) and body["surfaceId"].strip():
                return body["surfaceId"].strip()
    return ""


def validate_hmi_messages(messages):
    """车机场景的宽松校验：只查结构 + HMI 组件白名单（不套用 Basic Catalog 规则）。"""
    errors = []
    warnings = []
    if not isinstance(messages, list) or not messages:
        return ["messages 必须是非空数组"], warnings
    if not isinstance(messages[0], dict) or "createSurface" not in messages[0]:
        errors.append("第一条消息必须是 createSurface")
    created = set()
    components = {}
    for index, message in enumerate(messages):
        label = "第 " + str(index + 1) + " 条消息"
        if not isinstance(message, dict):
            errors.append(label + " 不是 JSON 对象")
            continue
        if message.get("version") != "v0.9":
            errors.append(label + ' 的 version 必须是 "v0.9"')
        ops = [op for op in OPERATIONS if op in message]
        if len(ops) != 1:
            errors.append(label + " 必须且只能包含一个操作，当前为 " + (", ".join(ops) or "无"))
            continue
        op = ops[0]
        body = message.get(op)
        if not isinstance(body, dict):
            errors.append(label + " 的 " + op + " 必须是对象")
            continue
        sid = body.get("surfaceId")
        if not isinstance(sid, str) or not sid.strip():
            errors.append(label + " 缺少 surfaceId")
            sid = ""
        else:
            sid = sid.strip()
        if op == "createSurface":
            if index != 0:
                errors.append("createSurface 必须是第一条消息")
            if sid in created:
                errors.append("重复的 createSurface: " + sid)
            created.add(sid)
        elif op == "updateComponents":
            if sid not in created:
                errors.append(label + " 在 createSurface 之前更新了组件")
            items = body.get("components")
            if not isinstance(items, list) or not items:
                errors.append(label + " 的 components 必须是非空数组")
                continue
            for item_index, item in enumerate(items):
                where = label + " 第 " + str(item_index + 1) + " 个组件"
                if not isinstance(item, dict):
                    errors.append(where + " 不是对象")
                    continue
                cid = item.get("id")
                if not isinstance(cid, str) or not cid.strip():
                    errors.append(where + " 缺少 id")
                    continue
                name = str(item.get("component") or "")
                if name not in HMI_COMPONENTS and not name.startswith("Hmi"):
                    warnings.append(where + " 的组件 " + (name or "无") + " 不在 HMI catalog 已知列表里")
                components[cid.strip()] = item
        elif op == "updateDataModel":
            if sid and sid not in created:
                errors.append(label + " 在 createSurface 之前更新了数据")
            if "path" in body:
                path = body.get("path")
                if not isinstance(path, str) or (path != "/" and not path.startswith("/")):
                    errors.append(label + " 的 path 必须是 JSON Pointer（以 / 开头）")
            if "value" not in body:
                warnings.append(label + " 没有 value，将被视为删除该路径")
        elif op == "deleteSurface":
            created.discard(sid)

    if "root" not in components:
        errors.append('最终组件树缺少 id="root" 的根组件（车机场景的根是 HmiScreen）')
    else:
        visited = set()
        missing = set()
        stack = ["root"]
        while stack:
            cid = stack.pop()
            if cid in visited:
                continue
            visited.add(cid)
            node = components.get(cid)
            if node is None:
                missing.add(cid)
                continue
            children = node.get("children")
            if isinstance(children, list):
                stack.extend([ref for ref in children if isinstance(ref, str)])
            elif isinstance(children, dict) and isinstance(children.get("componentId"), str):
                stack.append(children["componentId"])
            child = node.get("child")
            if isinstance(child, str):
                stack.append(child)
        if missing:
            errors.append("引用了不存在的组件 id: " + ", ".join(sorted(missing)))
        unreachable = sorted(set(components) - visited)
        if unreachable:
            warnings.append("存在未被 root 引用的组件: " + ", ".join(unreachable))
    return errors, warnings


def validate_scene(messages, surface_id=None):
    """按场景类型选校验器：Basic 走原来的 validate_messages，车机走 HMI 校验。"""
    if surface_kind(messages) == "hmi":
        return validate_hmi_messages(messages)
    return validate_messages(messages, surface_id)


def _truthy(value, default=False):
    """把 query / JSON 里的开关读成布尔：没传就用 default。"""
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    text = str(value).strip().lower()
    if not text:
        return default
    return text not in ("0", "false", "no", "off")


def probe_llm(timeout=3.0):
    """探一次 OpenAI 兼容的 GET <base>/v1/models，判断本地模型是否就绪。失败不影响启动。"""
    base = LLM_SETTINGS["base_url"].rstrip("/")
    url = base + "/v1/models"
    names = []
    try:
        request = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8", "replace"))
        items = []
        if isinstance(payload, dict):
            items = payload.get("data") or payload.get("models") or []
        elif isinstance(payload, list):
            items = payload
        for item in items if isinstance(items, list) else []:
            if isinstance(item, dict):
                name = item.get("id") or item.get("name") or item.get("model")
                if name:
                    names.append(str(name))
            elif item:
                names.append(str(item))
    except Exception as exc:
        return {"ready": False, "url": url, "models": [], "match": False, "error": str(exc)}
    wanted = LLM_SETTINGS["model"]
    matched = any(name == wanted or str(name).split(":")[0] == wanted.split(":")[0] for name in names)
    return {"ready": True, "url": url, "models": names, "match": matched, "error": None}


def run_hmi_cli(prompt, script=None, use_model=False, sim=None, sim_at=None, seed=None):
    """跑 demo/server/hmi-cli.ts。sim / sim_at / seed 不传时 argv 与原来一字不差。"""
    node = find_node()
    if not os.path.isfile(HMI_CLI):
        raise HmiError("找不到车机生成入口：" + HMI_CLI)
    argv = [node, HMI_CLI, "--prompt", prompt]
    if script:
        argv += ["--script", script]
    if sim:
        # docs/hmi-features-and-sim.md 3.4：生成时把模拟数据并进去（hmi-cli.ts 的契约）
        argv += ["--sim", sim]
        if sim_at is not None:
            argv += ["--sim-at", str(sim_at)]
        if seed is not None:
            argv += ["--seed", str(seed)]
    timeout = HMI_TIMEOUT
    env = None
    if use_model:
        # 模型写块：给 node 加 --model，并把模型地址 / 模型名传进子进程
        argv.append("--model")
        timeout = HMI_MODEL_TIMEOUT
        env = dict(os.environ)
        env["A2UI_LLM_BASE"] = LLM_SETTINGS["base_url"]
        env["A2UI_LLM_MODEL"] = LLM_SETTINGS["model"]
    try:
        completed = subprocess.run(
            argv,
            cwd=REPO_DIR,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            **({"env": env} if env is not None else {}),
        )
    except subprocess.TimeoutExpired:
        raise HmiError("车机生成超时（> " + str(timeout) + "s），请重试或简化需求")
    except OSError as exc:
        raise HmiError("调用 node 失败：" + str(exc))
    if completed.returncode != 0:
        raise HmiError("车机生成失败（exit " + str(completed.returncode) + "）：" + _tail(completed.stderr))
    raw = (completed.stdout or "").strip()
    if not raw:
        raise HmiError("node 没有输出 JSON：" + _tail(completed.stderr))
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HmiError("解析 node 输出失败：" + str(exc) + " / " + _tail(completed.stderr))
    if not isinstance(payload, dict) or not isinstance(payload.get("messages"), list) or not payload["messages"]:
        raise HmiError("node 输出里没有可用的 messages 数组：" + _tail(raw, 200))
    return payload


def hmi_scene(prompt, script=None, use_model=False, sim=None, sim_at=None, seed=None):
    """车机 HMI 场景：字段与 generate(basic) 对齐，另外带原型 / 槽位 / 地图素材。

    use_model=False（默认）：服务端确定性组装，provider = hmi-composer（与之前完全一致）。
    use_model=True：hmi-cli.ts --model，provider = model:<模型名>（失败时 model→fallback），
    并透传 model / modelScript / attempts / totalMs / usage 给前端。
    sim/sim_at/seed：带模拟车况时多传 --sim/--sim-at/--seed，并在响应里多一个原样透传的 sim 摘要；
    不传 sim 时响应字段与改动前完全一致。
    """
    started = time.time()
    payload = run_hmi_cli(prompt, script, use_model, sim, sim_at, seed)
    messages = payload["messages"]
    archetype = str(payload.get("archetype") or "").strip()
    name = str(payload.get("archetypeName") or "").strip() or archetype or "车机场景"
    variant = str(payload.get("variant") or "").strip()
    slots = [str(item) for item in payload.get("slots") or [] if isinstance(item, (str, int))]
    map_assets = payload.get("mapAssets")
    map_assets = [str(item) for item in map_assets if isinstance(item, (str, int))] if isinstance(map_assets, list) else []
    warnings = [str(item) for item in payload.get("warnings") or [] if item]
    provider = str(payload.get("provider") or ("model" if use_model else "hmi-composer")).strip() or "hmi-composer"
    if use_model and script and provider != "hmi-composer":
        warnings.append("模型写块模式下 --script 不生效（hmi-cli.ts 的 --model 分支不读 script）")
    sim_wanted = bool(sim)
    sim_summary = payload.get("sim") if isinstance(payload.get("sim"), dict) else None
    if sim_wanted and sim_summary is None:
        warnings.append("已把 --sim " + sim + " 传给 demo/server/hmi-cli.ts，但输出里没有 sim 摘要："
                        "模拟器（demo/server/hmi-sim.ts）或 hmi-cli.ts 的 --sim 分支还没接上")

    notes = [
        "原型：" + name + ("（" + archetype + "）" if archetype and archetype != name else ""),
        "画面：1920×1200 · " + {"3d": "3D 实景", "2d": "2D 平面"}.get(variant, variant or "未标注"),
        "槽位：" + ("、".join(slots) if slots else "无"),
        "地图素材：" + ("、".join(map_assets) if map_assets else "无"),
        "App 承接：HmiViewerActivity（WebView）加载 demo 网页，控制台只负责把消息推给 SSE 通道",
    ]
    if sim_wanted:
        notes.append("模拟车况：" + sim
                     + ("（sim-at " + str(sim_at) + " 秒）" if sim_at is not None else "")
                     + ("（seed " + str(seed) + "）" if seed is not None else "")
                     + (" · 已并进画面" if sim_summary is not None else " · 模拟器未就绪，只拼了 CLI 参数"))
    if provider == "hmi-composer":
        notes.append("生成方式：服务端直接组装（demo/server/hmi-cli.ts 确定性块）")
    else:
        model_name = str(payload.get("model") or LLM_SETTINGS["model"])
        attempts = payload.get("attempts")
        attempt_text = ""
        if isinstance(attempts, list) and attempts:
            attempt_text = " · 尝试 " + str(len(attempts)) + " 次"
        notes.append("生成方式：" + ("模型写块 " if provider.startswith("model:") else "模型写块失败，服务端已纠偏 ")
                     + model_name + " @ " + str(payload.get("llmBase") or LLM_SETTINGS["base_url"])
                     + attempt_text + " · 模型耗时 " + str(payload.get("totalMs")) + "ms")

    data = {
        "title": name,
        "summary": "车机 HMI 场景（1920×1200 组装）：App 端由 HmiViewerActivity（WebView）承接，"
                   "Compose 渲染器不画 HMI 素材。",
        "messages": messages,
        "provider": provider,
        "warnings": warnings,
        "notes": notes,
        "surfaceId": first_surface_id(messages) or "hmi",
        "elapsedMs": int((time.time() - started) * 1000),
        "archetype": archetype,
        "archetypeName": name,
        "variant": variant,
        "slots": slots,
        "mapAssets": map_assets,
        "hmi": True,
        "useModel": bool(use_model),
    }
    if sim_summary is not None:
        data["sim"] = sim_summary                     # hmi-cli.ts 的 sim 摘要原样透传，字段不改名
    if sim_wanted:
        data["simRequest"] = {"preset": sim, "at": sim_at, "seed": seed}   # 后台实际拼给 CLI 的参数
    for key in ("model", "modelScript", "attempts", "totalMs", "llmBase", "usage"):
        if payload.get(key) is not None:
            data[key] = payload[key]
    if provider.startswith("model→") and payload.get("errors"):
        data["modelErrors"] = payload["errors"]
    data.update(scene_stats(messages))
    if isinstance(payload.get("componentCount"), int):
        data["componentCount"] = payload["componentCount"]
    return data


class Hub:
    def __init__(self, surface_id):
        self.surface_id = surface_id
        self.lock = threading.Lock()
        self.push_lock = threading.Lock()
        self.clients = set()
        self.last_scene = None
        self.last_push = None
        self.pushing = 0
        self.messages_sent = 0
        self.started = time.time()

    def subscribe(self):
        channel = queue.Queue()
        with self.lock:
            self.clients.add(channel)
        return channel

    def unsubscribe(self, channel):
        with self.lock:
            self.clients.discard(channel)

    def client_count(self):
        with self.lock:
            return len(self.clients)

    def snapshot(self):
        with self.lock:
            last_scene = self.last_scene
            last_push = self.last_push
            return {
                "clients": len(self.clients),
                "pushing": self.pushing,
                "messagesSent": self.messages_sent,
                "lastScene": None if not last_scene else {
                    "title": last_scene["title"],
                    "count": len(last_scene["messages"]),
                    "at": last_scene["at"],
                },
                "lastPush": None if not last_push else dict(last_push),
            }

    def push(self, title, messages, delay_ms):
        with self.push_lock:
            with self.lock:
                self.pushing += 1
            sent = 0
            try:
                for index, message in enumerate(messages):
                    with self.lock:
                        channels = list(self.clients)
                    for channel in channels:
                        channel.put(message)
                    sent += len(channels)
                    if channels and delay_ms and index < len(messages) - 1:
                        time.sleep(delay_ms / 1000.0)
            finally:
                with self.lock:
                    self.pushing -= 1
                    self.messages_sent += sent
                    self.last_scene = {"title": title, "messages": messages, "at": time.time()}
                    self.last_push = {
                        "title": title,
                        "count": len(messages),
                        "clients": len(self.clients),
                        "at": time.time(),
                    }


class AgentInbox:
    """「交给 Agent 推理」的收件箱：后台只收单 / 记状态，推理由 Harness 会话里的 Agent 做。

    记录：{id, text, note, status, createdAt, updatedAt, result, [claimedAt]}
    status：pending（待捞）-> working（Agent 已捞走）-> done（已生成）| failed（失败）

    持久化：agent-inbox.jsonl 一行一条 JSON（UTF-8），正常路径只追加写、绝不整文件重写；
    同一个 id 后写的那行覆盖先写的那行，所以中途崩掉也不会把已写过的状态退回旧值。
    只有 /api/agent/clear 会把留下来的记录 compact 回文件（写临时文件 + os.replace）。
    多线程（ThreadingHTTPServer）：这个列表的所有读写都在 self.lock 里。
    """

    def __init__(self, path):
        self.path = path
        self.lock = threading.Lock()
        self.items = []          # 按 createdAt 升序
        self.load()

    # ------------------------------------------------------------- 持久化

    def load(self):
        """启动时读回记录；文件不存在 / 坏行都不报错、不崩。"""
        if not os.path.isfile(self.path):
            return
        try:
            with open(self.path, "r", encoding="utf-8") as handle:
                raw_lines = handle.readlines()
        except OSError as exc:
            print("[console] agent inbox 读不回来（从空收件箱开始）：" + str(exc), flush=True)
            return
        index = {}
        skipped = 0
        for raw in raw_lines:
            raw = raw.strip()
            if not raw:
                continue
            try:
                line = json.loads(raw)
            except json.JSONDecodeError:
                skipped += 1
                continue
            record = normalise_agent_record(line) if isinstance(line, dict) else None
            if record is None:
                skipped += 1
                continue
            known = index.get(record["id"])
            if known is None:
                index[record["id"]] = record
                self.items.append(record)
            else:
                known.update(record)     # 后写的覆盖先写的，位置保持第一次出现（= createdAt 顺序）
        if skipped:
            print("[console] agent inbox 读回 " + str(len(self.items)) + " 条（跳过坏行 " + str(skipped) + " 行）", flush=True)
        elif self.items:
            print("[console] agent inbox 读回 " + str(len(self.items)) + " 条：" + self.path, flush=True)

    def _new_id(self):
        """短、可打印、不重复：ag-<毫秒时间戳 hex>-<4 位随机 hex>。"""
        stamp = format(int(time.time() * 1000), "x")
        while True:
            candidate = "ag-" + stamp + "-" + secrets.token_hex(2)
            if not any(item["id"] == candidate for item in self.items):
                return candidate

    def _append(self, record):
        line = json.dumps(record, ensure_ascii=False, separators=(",", ":"))
        try:
            with open(self.path, "a", encoding="utf-8") as handle:
                handle.write(line + "\n")
            return True
        except OSError as exc:
            print("[console] agent inbox 追加写失败（内存里还在，重启后这条会丢）：" + str(exc), flush=True)
            return False

    def _compact(self, keep):
        """clear 专用：把留下的记录写回文件（临时文件 + os.replace，失败就不改内存）。"""
        tmp = self.path + ".tmp"
        try:
            with open(tmp, "w", encoding="utf-8") as handle:
                for record in keep:
                    handle.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
            os.replace(tmp, self.path)
            return True
        except OSError as exc:
            print("[console] agent inbox 清理写回失败（收件箱保持不变）：" + str(exc), flush=True)
            try:
                os.remove(tmp)
            except OSError:
                pass
            return False

    # ---------------------------------------------------------------- 读写

    def find(self, record_id):
        for item in self.items:              # 调用方必须已持锁
            if item["id"] == record_id:
                return item
        return None

    def create(self, text, note=""):
        with self.lock:
            now = time.time()
            record = {
                "id": self._new_id(),
                "text": text,
                "note": note or "",
                "status": "pending",
                "createdAt": now,
                "updatedAt": now,
                "result": None,
            }
            self.items.append(record)
            self._append(record)
            return dict(record)

    def claim(self, record_id):
        """-> ("ok", 记录) / ("missing", None) / ("conflict", 记录)：防两边同时捞同一条。"""
        with self.lock:
            record = self.find(record_id)
            if record is None:
                return ("missing", None)
            if record["status"] != "pending":
                return ("conflict", dict(record))
            now = time.time()
            record["status"] = "working"
            record["claimedAt"] = now
            record["updatedAt"] = now
            self._append(record)
            return ("ok", dict(record))

    def complete(self, record_id, result):
        with self.lock:
            record = self.find(record_id)
            if record is None:
                return None
            record["status"] = "done"
            record["result"] = dict(result)
            record["updatedAt"] = time.time()
            self._append(record)
            return dict(record)

    def fail(self, record_id, error):
        with self.lock:
            record = self.find(record_id)
            if record is None:
                return None
            merged = dict(record["result"]) if isinstance(record.get("result"), dict) else {}
            merged["error"] = error
            record["status"] = "failed"
            record["result"] = merged
            record["updatedAt"] = time.time()
            self._append(record)
            return dict(record)

    def clear_finished(self):
        """只删 done / failed；pending / working 保留。返回真正删掉的条数。"""
        with self.lock:
            keep = [item for item in self.items if item["status"] not in AGENT_FINISHED]
            removed = len(self.items) - len(keep)
            if not removed:
                return 0
            if not self._compact(keep):
                return 0
            self.items = keep
            return removed

    # --------------------------------------------------------------- 读视图

    def listing(self, statuses=None, limit=None, newest_first=False):
        with self.lock:
            items = list(self.items)
            if newest_first:
                items.reverse()
            if statuses:
                items = [item for item in items if item["status"] in statuses]
            if limit is not None:
                items = items[:limit]
            return [agent_public(item) for item in items]

    def status_summary(self):
        """/api/status 的 agent 字段：计数 + 最近一条 + 最近几条摘要（不带 blocks）。"""
        with self.lock:
            counts = dict((status, 0) for status in AGENT_STATUSES)
            for item in self.items:
                counts[item["status"]] = counts.get(item["status"], 0) + 1
            latest = None
            for item in self.items:
                if latest is None or item["updatedAt"] >= latest["updatedAt"]:
                    latest = item
            tail = self.items[-AGENT_STATUS_ITEMS:]
            tail.reverse()
            total = len(self.items)
            summaries = [agent_public(item, text_limit=AGENT_STATUS_TEXT, hide_blocks=True) for item in tail]
            latest_summary = agent_public(latest, text_limit=AGENT_STATUS_TEXT, hide_blocks=True)
        return {
            "pending": counts["pending"],
            "working": counts["working"],
            "latest": latest_summary,
            "items": summaries,
            "done": counts["done"],
            "failed": counts["failed"],
            "total": total,
            "file": AGENT_FILE,
        }


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "A2uiConsole/1.0"
    hub = None
    agent = None

    def log_message(self, fmt, *args):
        print("[console] " + fmt % args, flush=True)

    def handle(self):
        # 浏览器 / App 主动断开 SSE 是常态（关页面、adb reverse 变动、刷新），
        # 不值得为此打印整段 traceback。
        try:
            super().handle()
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError, TimeoutError):
            pass

    def end_headers(self):
        # 浏览器页面（Vite 5173）用 EventSource 订阅 /stream 属于跨源请求，
        # 原生 SSE 客户端（App）不需要这些头，但网页端少了就连不上。
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "content-type, last-event-id")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        super().end_headers()

    def agent_inbox(self):
        """收件箱单例。main() 里装好；万一没装就地装一次，别让收件箱接口 500。"""
        if Handler.agent is None:
            Handler.agent = AgentInbox(AGENT_FILE)
        return Handler.agent

    # ------------------------------------------------------------- primitives

    def send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def send_html(self, text, status=200):
        body = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_asset(self, text, content_type, status=200):
        body = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        if length > MAX_BODY:
            raise ValueError("请求体过大")
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("请求体不是合法 JSON: " + str(exc))

    def write_sse(self, message):
        payload = json.dumps(message, ensure_ascii=False, separators=(",", ":"))
        self.wfile.write(("data: " + payload + "\n\n").encode("utf-8"))
        self.wfile.flush()

    # ------------------------------------------------------------------- GET

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)
        hub = self.hub

        if path in ("/", "/index.html"):
            try:
                with open(CONSOLE_FILE, "r", encoding="utf-8") as handle:
                    self.send_html(handle.read())
            except OSError as exc:
                self.send_html(
                    "<h2>A2UI console</h2><p>缺少 console/index.html: " + str(exc) + "</p>",
                    status=500,
                )
            return

        if path == "/app.js":
            try:
                with open(APP_FILE, "r", encoding="utf-8") as handle:
                    self.send_asset(handle.read(), "application/javascript; charset=utf-8")
            except OSError as exc:
                self.send_asset("console.error(" + json.dumps("缺少 console/app.js: " + str(exc)) + ");",
                                "application/javascript; charset=utf-8", status=404)
            return

        if path == "/health":
            self.send_json({"ok": True, "clients": hub.client_count()})
            return

        if path == "/api/status":
            settings = model_settings()
            snapshot = hub.snapshot()
            self.send_json({
                "ok": True,
                "server": {
                    "uptimeSec": int(time.time() - hub.started),
                    "surfaceId": hub.surface_id,
                    "clients": snapshot["clients"],
                    "pushing": snapshot["pushing"],
                    "messagesSent": snapshot["messagesSent"],
                },
                "model": {
                    "configured": llm_available(),
                    "name": settings["model"],
                    "baseUrl": settings["base_url"],
                },
                "lastScene": snapshot["lastScene"],
                "lastPush": snapshot["lastPush"],
                # 收件箱状态（原有字段一个没动、没改名；这里只是多一个 agent）
                "agent": self.agent_inbox().status_summary(),
            })
            return

        if path == "/api/messages":
            with hub.lock:
                scene = hub.last_scene
            self.send_json([] if not scene else scene["messages"])
            return

        if path == "/api/agent/pending":
            items = self.agent_inbox().listing(statuses=("pending",))    # 只含 pending，createdAt 升序
            self.send_json({"items": items, "count": len(items)})
            return

        if path == "/api/agent/all":
            try:
                limit = int((query.get("limit") or ["20"])[0])
            except ValueError:
                limit = 20
            limit = max(1, min(limit, 200))
            items = self.agent_inbox().listing(limit=limit, newest_first=True)   # 新的在前
            self.send_json({"items": items, "count": len(items), "limit": limit})
            return

        if path == "/api/hmi/scene":
            prompt = (query.get("prompt") or [""])[0].strip()
            if not prompt:
                self.send_json({"error": "prompt 不能为空（?prompt=找附近的停车场，时速 60）"}, status=400)
                return
            if len(prompt) > 4000:
                self.send_json({"error": "prompt 过长（最多 4000 字符）"}, status=400)
                return
            script = (query.get("script") or [""])[0].strip() or None
            use_model = _truthy((query.get("model") or query.get("useModel") or [None])[0], False)
            try:
                sim_opt = parse_sim_query(query)
            except ValueError as exc:
                self.send_json({"error": str(exc)}, status=400)
                return
            sim, sim_at, seed = sim_opt if sim_opt else (None, None, None)
            print("[console] hmi scene (" + ("model" if use_model else "composer") + ")"
                  + (" sim=" + sim if sim else "") + ": "
                  + prompt[:40].replace("\n", " "), flush=True)
            try:
                data = hmi_scene(prompt, script, use_model, sim, sim_at, seed)
            except HmiError as exc:
                self.send_json({"error": str(exc), "surfaceKind": "hmi"}, status=HMI_ERROR_STATUS)
                return
            print("[console] hmi scene " + data["archetypeName"] + " (" + data["provider"] + "): " + str(data["messageCount"])
                  + " messages / " + str(data["componentCount"]) + " components / " + str(data["elapsedMs"]) + "ms",
                  flush=True)
            self.send_json(data)
            return

        if path == "/api/sim/presets":
            """预设清单只有一份：demo/server/hmi-sim.ts --list --json。这里不维护副本。"""
            try:
                payload = run_sim_cli(["--list", "--json"], "模拟器预设清单")
            except SimNotReadyError as exc:
                body, status = sim_error_payload(exc)
                self.send_json(body, status=status)
                return
            except HmiError as exc:
                body, status = sim_error_payload(exc)
                print("[console] sim presets 不可用：" + str(exc), flush=True)
                self.send_json(body, status=status)
                return
            self.send_json(payload)
            return

        if path == "/api/sim/state":
            preset = (query.get("preset") or [""])[0].strip()
            if not preset:
                self.send_json({"error": "preset 不能为空（?preset=jam&at=2520）"}, status=400)
                return
            try:
                at = _opt_int((query.get("at") or [None])[0], "at")
                seed = _opt_int((query.get("seed") or [None])[0], "seed")
            except ValueError as exc:
                self.send_json({"error": str(exc)}, status=400)
                return
            try:
                payload = run_sim_cli(sim_cli_args(preset, at, seed), "模拟器快照")
            except SimNotReadyError as exc:
                body, status = sim_error_payload(exc)
                self.send_json(body, status=status)
                return
            except HmiError as exc:
                body, status = sim_error_payload(exc)
                print("[console] sim state 不可用（preset=" + preset + "）：" + str(exc), flush=True)
                self.send_json(body, status=status)
                return
            self.send_json(payload)
            return

        if path == "/stream":
            self.handle_stream(hub, query)
            return

        if path == "/favicon.ico":
            self.send_response(204)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        self.send_json({"error": "not found", "path": path}, status=404)

    def handle_stream(self, hub, query):
        try:
            replay_delay = int(float(query.get("delay", ["120"])[0]))
        except ValueError:
            replay_delay = 120
        replay_delay = max(30, min(replay_delay, 600))
        replay = query.get("replay", ["1"])[0].lower() not in ("0", "false", "no")

        channel = hub.subscribe()
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache, no-transform")
            self.send_header("Connection", "keep-alive")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()
            self.wfile.write(b": connected\n\n")
            self.wfile.flush()
            print("[console] SSE client connected (" + str(hub.client_count()) + " total)", flush=True)

            with hub.lock:
                scene = hub.last_scene
                pushing = hub.pushing > 0
            if replay and scene and not pushing:
                for index, message in enumerate(scene["messages"]):
                    self.write_sse(message)
                    if index < len(scene["messages"]) - 1:
                        time.sleep(replay_delay / 1000.0)

            while True:
                try:
                    message = channel.get(timeout=2.0)
                except queue.Empty:
                    self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
                    continue
                if message is None:
                    break
                self.write_sse(message)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
            pass
        finally:
            hub.unsubscribe(channel)
            print("[console] SSE client disconnected (" + str(hub.client_count()) + " left)", flush=True)

    # ------------------------------------------------------------------ POST

    def do_POST(self):
        path = urlparse(self.path).path
        hub = self.hub
        agent_paths = ("/api/agent/request", "/api/agent/claim", "/api/agent/done",
                       "/api/agent/fail", "/api/agent/clear")
        sim_paths = ("/api/sim/control",)
        if path not in ("/api/generate", "/api/validate", "/api/push") + agent_paths + sim_paths:
            self.send_json({"error": "not found", "path": path}, status=404)
            return
        try:
            payload = self.read_json()
        except ValueError as exc:
            self.send_json({"error": str(exc)}, status=400)
            return
        if not isinstance(payload, dict):
            self.send_json({"error": "请求体必须是 JSON 对象"}, status=400)
            return

        if path == "/api/generate":
            prompt = str(payload.get("prompt") or "").strip()
            if not prompt:
                self.send_json({"error": "prompt 不能为空"}, status=400)
                return
            if len(prompt) > 4000:
                self.send_json({"error": "prompt 过长（最多 4000 字符）"}, status=400)
                return

            surface = str(payload.get("surfaceKind") or "basic").strip().lower()
            if surface in ("hmi", "hmi-car", "car", "车机"):
                script = payload.get("script")
                script = str(script).strip() if isinstance(script, str) else None
                use_model = _truthy(payload.get("useModel"), False)
                try:
                    sim_opt = parse_sim_option(payload)      # 可选："sim":"jam" 或 {"preset":"jam","at":2520,"seed":7}
                except ValueError as exc:
                    self.send_json({"error": str(exc), "surfaceKind": "hmi"}, status=400)
                    return
                sim, sim_at, seed = sim_opt if sim_opt else (None, None, None)
                print("[console] hmi generate (" + ("model" if use_model else "composer") + ")"
                      + (" sim=" + sim if sim else "") + ": "
                      + prompt[:40].replace("\n", " "), flush=True)
                try:
                    data = hmi_scene(prompt, script, use_model, sim, sim_at, seed)
                except HmiError as exc:
                    self.send_json({"error": str(exc), "surfaceKind": "hmi"}, status=HMI_ERROR_STATUS)
                    return
                print("[console] generated via " + data["provider"] + ": " + data["archetypeName"] + " / "
                      + str(data["messageCount"]) + " messages, " + str(data["componentCount"])
                      + " components, " + str(data["elapsedMs"]) + "ms", flush=True)
                self.send_json(data)
                return

            prefer_llm = payload.get("preferLlm", True)
            prefer_llm = bool(prefer_llm) if not isinstance(prefer_llm, str) else prefer_llm.lower() not in ("0", "false", "no")
            print("[console] generate: " + prompt[:40].replace("\n", " ") + " preferLlm=" + str(prefer_llm), flush=True)
            try:
                result = generate_scene(prompt, prefer_llm=prefer_llm, surface_id=hub.surface_id)
            except Exception as exc:
                self.send_json({"error": "生成失败: " + str(exc)}, status=500)
                return
            data = result.as_dict()
            data.update(scene_stats(result.messages))
            print("[console] generated via " + result.provider + ": " + str(len(result.messages)) + " messages, " + str(result.elapsed_ms) + "ms", flush=True)
            self.send_json(data)
            return

        if path == "/api/validate":
            messages = payload.get("messages")
            surface_id = payload.get("surfaceId") or hub.surface_id
            errors, warnings = validate_scene(messages, surface_id)
            stats = scene_stats(messages if isinstance(messages, list) else [])
            self.send_json({
                "ok": not errors,
                "errors": errors,
                "warnings": warnings,
                **stats,
            })
            return

        if path in sim_paths:
            self.handle_sim_control(payload)
            return

        if path in agent_paths:
            self.handle_agent(path, payload)
            return

        messages = payload.get("messages")
        if not isinstance(messages, list) or not messages:
            self.send_json({"error": "messages 必须是非空数组"}, status=400)
            return
        errors, warnings = validate_scene(messages, None)
        if errors:
            self.send_json({"error": "消息校验失败", "errors": errors, "warnings": warnings}, status=400)
            return
        title = str(payload.get("title") or payload.get("summary") or "控制台场景").strip()[:80]
        try:
            delay_ms = int(payload.get("delayMs", 160))
        except (TypeError, ValueError):
            delay_ms = 160
        delay_ms = max(30, min(delay_ms, 1200))
        clients = hub.client_count()
        thread = threading.Thread(target=hub.push, args=(title, messages, delay_ms), daemon=True)
        thread.start()
        stats = scene_stats(messages)
        print("[console] push (" + surface_kind(messages) + "): " + title + " " + str(len(messages))
              + " messages -> " + str(clients) + " clients", flush=True)
        self.send_json({
            "ok": True,
            "queued": len(messages),
            "clients": clients,
            "title": title,
            "delayMs": delay_ms,
            "warnings": warnings,
            **stats,
        })

    # -------------------------------------------- 车辆状态模拟器（demo 侧实现）

    def handle_sim_control(self, payload):
        """POST /api/sim/control {preset, at, actions:[…]} -> 发一次车控指令后的最新快照。

        只做转发：node demo/server/hmi-sim.ts --preset <p> --at <秒> --control '<json>'，返回原样透传。
        """
        preset = str(payload.get("preset") or "").strip()
        if not preset:
            self.send_json({"error": 'preset 不能为空（{"preset":"city-cruise","at":300,"actions":[…]}）'}, status=400)
            return
        try:
            at = _opt_int(payload.get("at"), "at")
            seed = _opt_int(payload.get("seed"), "seed")
        except ValueError as exc:
            self.send_json({"error": str(exc)}, status=400)
            return
        actions = payload.get("actions")
        if actions is not None and not isinstance(actions, list):
            self.send_json({"error": 'actions 必须是数组，例如 [{"domain":"climate","key":"driverSetC","value":27}]'},
                           status=400)
            return
        args = sim_cli_args(preset, at, seed, json_flag=False)
        if actions is not None:
            args += ["--control", json.dumps(actions, ensure_ascii=False)]
        print("[console] sim control " + preset + " @ " + (str(at) if at is not None else "未给秒数")
              + " · " + str(len(actions or [])) + " 条车控指令", flush=True)
        try:
            body = run_sim_cli(args, "模拟器车控指令")
        except SimNotReadyError as exc:
            out, status = sim_error_payload(exc)
            self.send_json(out, status=status)
            return
        except HmiError as exc:
            out, status = sim_error_payload(exc)
            print("[console] sim control 不可用（preset=" + preset + "）：" + str(exc), flush=True)
            self.send_json(out, status=status)
            return
        self.send_json(body)

    # -------------------------------------------- 交给 Agent 推理（收件箱）

    def handle_agent(self, path, payload):
        """收件箱：后台只收单 / 改状态 / 存摘要，这条分支不做任何推理，也不会去调 /api/generate。"""
        agent = self.agent_inbox()

        if path == "/api/agent/request":
            text = str(payload.get("text") or "").strip()
            if not text:
                self.send_json({"error": "text 不能为空（要交给 Agent 推理的场景描述）"}, status=400)
                return
            if len(text) > AGENT_TEXT_LIMIT:
                self.send_json({"error": "text 过长（最多 " + str(AGENT_TEXT_LIMIT) + " 字符）"}, status=400)
                return
            note = payload.get("note")
            note = str(note).strip()[:AGENT_NOTE_LIMIT] if note is not None else ""
            record = agent.create(text, note)
            print("[console] agent inbox 收单 " + record["id"] + ": " + agent_clip(text, 40), flush=True)
            self.send_json(record)
            return

        if path == "/api/agent/clear":
            removed = agent.clear_finished()
            print("[console] agent inbox 清掉已处理 " + str(removed) + " 条", flush=True)
            self.send_json({"ok": True, "removed": removed, "agent": agent.status_summary()})
            return

        record_id = str(payload.get("id") or "").strip()
        if not record_id:
            self.send_json({"error": "id 不能为空"}, status=400)
            return

        if path == "/api/agent/claim":
            outcome, record = agent.claim(record_id)
            if outcome == "missing":
                self.send_json({"error": "找不到这条请求：" + record_id}, status=404)
                return
            if outcome == "conflict":
                self.send_json({"error": "这条请求已经被捞走了（status=" + str(record["status"]) + "）",
                                "item": record}, status=409)
                return
            print("[console] agent inbox 捞单 " + record_id + " -> working", flush=True)
            self.send_json(record)
            return

        if path == "/api/agent/done":
            raw_count = payload.get("componentCount")
            if isinstance(raw_count, bool):
                component_count = None
            elif isinstance(raw_count, (int, float)):
                component_count = int(raw_count)
            else:
                try:
                    component_count = int(str(raw_count).strip())
                except (TypeError, ValueError):
                    component_count = None
            raw_notes = payload.get("notes")
            if isinstance(raw_notes, str):
                raw_notes = [raw_notes]
            if not isinstance(raw_notes, list):
                raw_notes = []
            notes = [str(item).strip()[:300] for item in raw_notes if str(item).strip()][:12]
            result = {
                "provider": str(payload.get("provider") or "").strip()[:80],
                "archetypeName": str(payload.get("archetypeName") or "").strip()[:80],
                "componentCount": component_count,
                "title": str(payload.get("title") or "").strip()[:120],
                "blocks": str(payload.get("blocks") or "")[:AGENT_BLOCKS_LIMIT],
                "notes": notes,
                "finishedAt": time.time(),
            }
            record = agent.complete(record_id, result)
            if record is None:
                self.send_json({"error": "找不到这条请求：" + record_id}, status=404)
                return
            print("[console] agent inbox 完成 " + record_id + " -> " + (result["archetypeName"] or "已生成")
                  + " (" + (result["provider"] or "?") + " · " + str(result["componentCount"]) + " 件)", flush=True)
            self.send_json(record)
            return

        # /api/agent/fail
        error = str(payload.get("error") or "").strip()[:600] or "Agent 处理失败（没给原因）"
        record = agent.fail(record_id, error)
        if record is None:
            self.send_json({"error": "找不到这条请求：" + record_id}, status=404)
            return
        print("[console] agent inbox 失败 " + record_id + ": " + agent_clip(error, 80), flush=True)
        self.send_json(record)


def main():
    parser = argparse.ArgumentParser(description="A2UI web console")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--surface", default=DEFAULT_SURFACE)
    parser.add_argument("--llm-base", default=LLM_SETTINGS["base_url"],
                        help="车机「模型写块」的 OpenAI 兼容地址（默认 " + DEFAULT_LLM_BASE + "，ollama 用 11434）")
    parser.add_argument("--llm-model", default=LLM_SETTINGS["model"],
                        help="车机「模型写块」用的模型名（默认 " + DEFAULT_LLM_MODEL + "）")
    args = parser.parse_args()

    LLM_SETTINGS["base_url"] = (args.llm_base or DEFAULT_LLM_BASE).strip().rstrip("/")
    LLM_SETTINGS["model"] = (args.llm_model or DEFAULT_LLM_MODEL).strip()

    Handler.hub = Hub(args.surface)
    Handler.hub.surface_id = args.surface
    Handler.agent = AgentInbox(AGENT_FILE)      # 「交给 Agent 推理」收件箱（启动时读回旧记录）

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.daemon_threads = True
    settings = model_settings()
    print("A2UI console on http://" + args.host + ":" + str(args.port) + "/", flush=True)
    print("  model: " + settings["model"] + " (" + ("configured" if settings["configured"] else "local only") + ")", flush=True)
    print("  SSE:   /stream  (app: http://127.0.0.1:" + str(args.port) + "/stream)", flush=True)
    node = shutil.which("node")
    hmi_ready = bool(node) and os.path.isfile(HMI_CLI)
    print("  HMI:   " + (node or "node 未找到") + " -> demo/server/hmi-cli.ts"
          + (" (车机场景可用)" if hmi_ready else " (车机场景不可用：装 Node.js 或检查 " + HMI_CLI + ")"), flush=True)
    print("  模拟车况: " + ("demo/server/hmi-sim.ts 在位（/api/sim/* 与 --sim 都走它）"
                            if os.path.isfile(HMI_SIM)
                            else "未就绪（" + HMI_SIM + " 还没实现：/api/sim/* 返回未就绪，--sim 只拼参数）"), flush=True)
    probe = probe_llm()
    if probe["ready"]:
        missing = "" if probe["match"] else "（/v1/models 里没看到这个模型，列表：" + ", ".join(probe["models"][:6]) + "）"
        print("  模型写块: 可用 " + LLM_SETTINGS["model"] + " @ " + LLM_SETTINGS["base_url"] + missing, flush=True)
    else:
        print("  模型写块: 本地模型未就绪（可用 --llm-base/--llm-model 指定）", flush=True)
    inbox = Handler.agent
    with inbox.lock:
        total = len(inbox.items)
        pending = sum(1 for item in inbox.items if item["status"] == "pending")
        working = sum(1 for item in inbox.items if item["status"] == "working")
    print("  Agent: 收件箱 " + AGENT_FILE + "（" + str(total) + " 条 · 待捞 " + str(pending)
          + " · 处理中 " + str(working) + "）；后台只收单，写块推理由会话里的 Agent 做", flush=True)
    print("  adb reverse tcp:" + str(args.port) + " tcp:" + str(args.port), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nbye", flush=True)


if __name__ == "__main__":
    main()
