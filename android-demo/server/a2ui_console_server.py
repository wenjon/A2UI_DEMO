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
    POST /api/generate    {prompt, preferLlm, surfaceKind, script} -> scene
    GET  /api/hmi/scene   ?prompt=...&script=... -> same as generate with surfaceKind=hmi
    POST /api/validate    {messages} -> errors / warnings / stats
    POST /api/push        {messages, title, delayMs} -> broadcast

Two scene kinds share the same SSE channel:
    surfaceKind="basic" (默认) -> a2ui_generator.generate_scene（Basic Catalog，原逻辑不变）
    surfaceKind="hmi"          -> node demo/server/hmi-cli.ts（车机 1920×1200 组装）
"""
from __future__ import annotations

import argparse
import json
import os
import queue
import shutil
import subprocess
import threading
import time
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
HMI_ERROR_STATUS = 502
HMI_CATALOG = "https://luckplusone.cfifa.com/a2ui/hmi/catalog.json"
HMI_COMPONENTS = {
    "HmiScreen", "HmiAsset", "HmiText", "HmiHotspot", "HmiPanel", "HmiSpeedometer",
    "HmiStatusBar", "HmiNavInstruction", "HmiRouteInfo", "HmiMapButtons",
    "HmiZoomControl", "HmiRouteProgress", "HmiControlBar",
}


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


def _tail(text, limit=400):
    raw = str(text or "").strip()
    return raw[-limit:] if raw else "（无输出）"


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


def run_hmi_cli(prompt, script=None):
    node = shutil.which("node")
    if not node:
        raise HmiError("未找到 node：PATH 里没有 node 可执行文件。车机 HMI 场景要跑 demo/server/hmi-cli.ts，"
                       "请安装 Node.js（>= 22）或把它加入 PATH 后重试。")
    if not os.path.isfile(HMI_CLI):
        raise HmiError("找不到车机生成入口：" + HMI_CLI)
    argv = [node, HMI_CLI, "--prompt", prompt]
    if script:
        argv += ["--script", script]
    try:
        completed = subprocess.run(
            argv,
            cwd=REPO_DIR,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=HMI_TIMEOUT,
        )
    except subprocess.TimeoutExpired:
        raise HmiError("车机生成超时（> " + str(HMI_TIMEOUT) + "s），请重试或简化需求")
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


def hmi_scene(prompt, script=None):
    """车机 HMI 场景：字段与 generate(basic) 对齐，另外带原型 / 槽位 / 地图素材。"""
    started = time.time()
    payload = run_hmi_cli(prompt, script)
    messages = payload["messages"]
    archetype = str(payload.get("archetype") or "").strip()
    name = str(payload.get("archetypeName") or "").strip() or archetype or "车机场景"
    variant = str(payload.get("variant") or "").strip()
    slots = [str(item) for item in payload.get("slots") or [] if isinstance(item, (str, int))]
    map_assets = payload.get("mapAssets")
    map_assets = [str(item) for item in map_assets if isinstance(item, (str, int))] if isinstance(map_assets, list) else []
    warnings = [str(item) for item in payload.get("warnings") or [] if item]

    data = {
        "title": name,
        "summary": "车机 HMI 场景（1920×1200 组装）：App 端由 HmiViewerActivity（WebView）承接，"
                   "Compose 渲染器不画 HMI 素材。",
        "messages": messages,
        "provider": "hmi-composer",
        "warnings": warnings,
        "notes": [
            "原型：" + name + ("（" + archetype + "）" if archetype and archetype != name else ""),
            "画面：1920×1200 · " + {"3d": "3D 实景", "2d": "2D 平面"}.get(variant, variant or "未标注"),
            "槽位：" + ("、".join(slots) if slots else "无"),
            "地图素材：" + ("、".join(map_assets) if map_assets else "无"),
            "App 承接：HmiViewerActivity（WebView）加载 demo 网页，控制台只负责把消息推给 SSE 通道",
        ],
        "surfaceId": first_surface_id(messages) or "hmi",
        "elapsedMs": int((time.time() - started) * 1000),
        "archetype": archetype,
        "archetypeName": name,
        "variant": variant,
        "slots": slots,
        "mapAssets": map_assets,
        "hmi": True,
    }
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


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "A2uiConsole/1.0"
    hub = None

    def log_message(self, fmt, *args):
        print("[console] " + fmt % args, flush=True)

    def end_headers(self):
        # 浏览器页面（Vite 5173）用 EventSource 订阅 /stream 属于跨源请求，
        # 原生 SSE 客户端（App）不需要这些头，但网页端少了就连不上。
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "content-type, last-event-id")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        super().end_headers()

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
            })
            return

        if path == "/api/messages":
            with hub.lock:
                scene = hub.last_scene
            self.send_json([] if not scene else scene["messages"])
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
            print("[console] hmi scene: " + prompt[:40].replace("\n", " "), flush=True)
            try:
                data = hmi_scene(prompt, script)
            except HmiError as exc:
                self.send_json({"error": str(exc), "surfaceKind": "hmi"}, status=HMI_ERROR_STATUS)
                return
            print("[console] hmi scene " + data["archetypeName"] + ": " + str(data["messageCount"])
                  + " messages / " + str(data["componentCount"]) + " components / " + str(data["elapsedMs"]) + "ms",
                  flush=True)
            self.send_json(data)
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
        if path not in ("/api/generate", "/api/validate", "/api/push"):
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
                print("[console] hmi generate: " + prompt[:40].replace("\n", " "), flush=True)
                try:
                    data = hmi_scene(prompt, script)
                except HmiError as exc:
                    self.send_json({"error": str(exc), "surfaceKind": "hmi"}, status=HMI_ERROR_STATUS)
                    return
                print("[console] generated via hmi-composer: " + data["archetypeName"] + " / "
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


def main():
    parser = argparse.ArgumentParser(description="A2UI web console")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--surface", default=DEFAULT_SURFACE)
    args = parser.parse_args()

    Handler.hub = Hub(args.surface)
    Handler.hub.surface_id = args.surface

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
    print("  adb reverse tcp:" + str(args.port) + " tcp:" + str(args.port), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nbye", flush=True)


if __name__ == "__main__":
    main()
