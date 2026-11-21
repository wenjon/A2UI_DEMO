"""控制台「交给 Agent」收件箱的捞单 / 交回工具（我在 DeepSeek Harness 会话里用）。

  python android-demo/tools/console_agent_loop.py --list
  python android-demo/tools/console_agent_loop.py --claim-next              # 抢下一条待捞的，打印原文
  python android-demo/tools/console_agent_loop.py --submit ag-1234 --blocks-file blocks.txt [--title 车机 · …]
  python android-demo/tools/console_agent_loop.py --submit ag-1234 --blocks "SPEED 45" --no-push
  python android-demo/tools/console_agent_loop.py --fail ag-1234 --error "素材名不认识"

--submit 干的事：读这条请求的原始场景描述 → POST /api/generate（surfaceKind=hmi，带 script）
→ POST /api/push（推 SSE）→ POST /api/agent/done 标记已处理。推理部分是我干的，这里只做搬运。
"""

import argparse
import json
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8787"


def call(base, path, payload=None, timeout=240, method=None):
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        base.rstrip("/") + path,
        data=data,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method=method or ("POST" if payload is not None else "GET"),
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", "replace")
        return error.code, _safe_json(body)
    except urllib.error.URLError as error:
        return 0, {"error": f"连不上 {base}：{error.reason}"}
    return 200, _safe_json(body)


def _safe_json(body):
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return {"raw": body[:300]}


def show(record):
    return (
        f"[{record.get('id')}] {record.get('status')} · {record.get('text')}"
        + (f" —— {record.get('note')}" if record.get("note") else "")
    )


def main():
    parser = argparse.ArgumentParser(description="车机控制台 Agent 收件箱的捞单/交回工具")
    parser.add_argument("--base", default=BASE)
    parser.add_argument("--list", action="store_true", help="列出待捞的请求")
    parser.add_argument("--all", action="store_true", help="列出最近的请求（含已处理）")
    parser.add_argument("--request", help="新加一条待捞请求（模拟在后台网页里输入）")
    parser.add_argument("--note", default=None)
    parser.add_argument("--claim", help="认领一条请求 id")
    parser.add_argument("--claim-next", action="store_true", help="认领最早的一条待捞请求")
    parser.add_argument("--submit", help="把这条请求交回后台：生成 + 推送 + 标记已处理")
    parser.add_argument("--blocks", help="块脚本原文（每行一个块）")
    parser.add_argument("--blocks-file", help="从文件读块脚本")
    parser.add_argument("--title", default=None, help="推送标题")
    parser.add_argument("--no-push", action="store_true", help="只生成不推送")
    parser.add_argument("--fail", help="把这条请求标记为失败")
    parser.add_argument("--error", default="Agent 处理失败")
    parser.add_argument("--clear", action="store_true", help="清掉已处理/失败的记录")
    args = parser.parse_args()

    if args.list or args.all:
        path = "/api/agent/pending" if args.list else "/api/agent/all?limit=20"
        status, body = call(args.base, path)
        items = body.get("items", []) if isinstance(body, dict) else []
        print(f"{path} → HTTP {status}，{len(items)} 条")
        for record in items:
            print("  " + show(record))
        return 0 if status == 200 else 1

    if args.request:
        status, body = call(args.base, "/api/agent/request", {"text": args.request, "note": args.note})
        print(f"POST /api/agent/request → HTTP {status}：{show(body) if isinstance(body, dict) else body}")
        return 0 if status == 200 else 1

    if args.claim or args.claim_next:
        target = args.claim
        if args.claim_next:
            status, body = call(args.base, "/api/agent/pending")
            items = body.get("items", []) if isinstance(body, dict) else []
            if not items:
                print("收件箱里没有待捞的请求")
                return 1
            target = items[0].get("id")
            print(f"待捞 {len(items)} 条，认领最早一条：{show(items[0])}")
        status, body = call(args.base, "/api/agent/claim", {"id": target})
        print(f"POST /api/agent/claim {target} → HTTP {status}" + ("" if status == 200 else f"：{body}"))
        return 0 if status == 200 else 1

    if args.fail:
        status, body = call(args.base, "/api/agent/fail", {"id": args.fail, "error": args.error})
        print(f"POST /api/agent/fail {args.fail} → HTTP {status}")
        return 0 if status == 200 else 1

    if args.clear:
        status, body = call(args.base, "/api/agent/clear", {})
        print(f"POST /api/agent/clear → HTTP {status}：{body}")
        return 0 if status == 200 else 1

    if args.submit:
        blocks = args.blocks
        if args.blocks_file:
            with open(args.blocks_file, encoding="utf-8") as handle:
                blocks = handle.read()
        if not blocks or not blocks.strip():
            print("要 --blocks 或 --blocks-file：交回去的总得是块脚本")
            return 1
        blocks = blocks.strip()

        status, records = call(args.base, "/api/agent/all?limit=50")
        record = next((item for item in records.get("items", []) if item.get("id") == args.submit), None)
        if record is None:
            print(f"找不到 id {args.submit}（/api/agent/all → HTTP {status}）")
            return 1
        prompt = record.get("text") or ""
        print(f"请求原文：{prompt}")
        print("我推理出的块：\n" + "\n".join("    " + line for line in blocks.splitlines()))

        status, scene = call(
            args.base,
            "/api/generate",
            {"prompt": prompt, "surfaceKind": "hmi", "script": blocks},
        )
        if status != 200 or not scene.get("messages"):
            print(f"POST /api/generate → HTTP {status}：{scene}")
            call(args.base, "/api/agent/fail", {"id": args.submit, "error": str(scene.get("error", scene))})
            return 1
        print(
            f"生成：provider={scene.get('provider')} 组件={scene.get('componentCount')} "
            f"原型={scene.get('archetypeName')} 用时={scene.get('elapsedMs')}ms"
        )
        for warning in (scene.get("warnings") or [])[:4]:
            print(f"  告警：{warning}")

        pushed = None
        if not args.no_push:
            status, pushed = call(
                args.base,
                "/api/push",
                {
                    "messages": scene["messages"],
                    "title": args.title or f"车机 · {scene.get('archetypeName') or 'Agent 场景'}",
                    "delayMs": 40,
                },
            )
            print(f"推送 → HTTP {status}：clients={pushed.get('clients')} 消息={pushed.get('messageCount')}")
            if status != 200:
                call(args.base, "/api/agent/fail", {"id": args.submit, "error": str(pushed)})
                return 1

        status, done = call(
            args.base,
            "/api/agent/done",
            {
                "id": args.submit,
                "provider": scene.get("provider"),
                "archetypeName": scene.get("archetypeName"),
                "componentCount": scene.get("componentCount"),
                "title": (args.title or f"车机 · {scene.get('archetypeName') or 'Agent 场景'}"),
                "blocks": blocks,
                "notes": [f"推送 clients={pushed.get('clients') if pushed else '未推送'}"],
            },
        )
        print(f"POST /api/agent/done {args.submit} → HTTP {status}")
        return 0 if status == 200 else 1

    parser.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
