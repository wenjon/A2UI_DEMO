"""Drive the A2UI Studio console: 场景描述 -> A2UI JSON -> SSE 推送到已连接的 App.

用法：
  python android-demo/tools/console_push.py --prompt "做一个智能汽车的车机首页"
  python android-demo/tools/console_push.py --last                 # 重推最近一次场景
  python android-demo/tools/console_push.py --prompt "..." --llm   # 走控制台配置的模型
  python android-demo/tools/console_push.py --health               # 只看在线客户端数
  python android-demo/tools/console_push.py --hmi --prompt "找附近的停车场，时速 60"        # 车机 HMI 场景
  python android-demo/tools/console_push.py --hmi --prompt "车控面板" --script "CARD 座舱温度 主驾 22"

两条推送路线（同一条 SSE 通道 /stream，App 侧谁接住画面不同）：
  · 通用场景（默认，Basic Catalog）  -> App 的 Compose 渲染器：MainActivity「实时流」-> 连接
  · 车机 HMI 场景（--hmi，1920×1200） -> App 里的 **HmiViewerActivity（WebView）** 承接：
      Compose 渲染器只实现 Basic Catalog，画不了 HMI 素材，所以车机画面走 WebView 查看器。
      一键把车机预览推到模拟器（端口反代 + 横屏 + 打开 HmiViewerActivity）：
        python android-demo/tools/hmi_live_viewer.py
默认服务地址 http://127.0.0.1:8787 ，可用 --base 覆盖。
"""
import argparse
import json
import sys
import urllib.error
import urllib.request

def call(base, path, payload=None):
    data = None
    headers = {'Accept': 'application/json'}
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        headers['Content-Type'] = 'application/json; charset=utf-8'
    req = urllib.request.Request(base.rstrip('/') + path, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode('utf-8', 'replace')
        try:
            detail = json.loads(body).get('error')
        except (ValueError, AttributeError):
            detail = None
        raise SystemExit(f'服务返回 HTTP {exc.code} {path}：{detail or body[:400]}')


def looks_hmi(messages):
    """按 catalogId / 组件名判断是不是车机场景。"""
    for message in messages:
        if not isinstance(message, dict):
            continue
        for op in ('createSurface', 'updateComponents', 'updateDataModel', 'deleteSurface'):
            body = message.get(op)
            if not isinstance(body, dict):
                continue
            if 'hmi' in str(body.get('catalogId', '')).lower():
                return True
            for item in (body.get('components') or []):
                if isinstance(item, dict) and str(item.get('component', '')).startswith('Hmi'):
                    return True
    return False


def main():
    parser = argparse.ArgumentParser(
        description='向 A2UI 控制台提交场景并推送到已连接的 App',
        epilog='通用场景由 Compose 渲染；--hmi 的车机场景由 App 里的 HmiViewerActivity（WebView）承接。',
    )
    parser.add_argument('--base', default='http://127.0.0.1:8787')
    parser.add_argument('--prompt')
    parser.add_argument('--last', action='store_true')
    parser.add_argument('--llm', action='store_true')
    parser.add_argument('--hmi', action='store_true',
                        help='走车机 HMI 模式（surfaceKind=hmi，后台调 demo/server/hmi-cli.ts 组装 1920×1200 场景）')
    parser.add_argument('--script', help='车机场景的块脚本，例如 "CARD 座舱温度 主驾 22"（仅 --hmi 时生效）')
    parser.add_argument('--health', action='store_true')
    parser.add_argument('--delay', type=int, default=120)
    parser.add_argument('--title')
    parser.add_argument('--no-push', action='store_true', help='只生成不推送（打印消息数）')
    args = parser.parse_args()

    health = call(args.base, '/health')
    print(f"控制台 {args.base} 在线客户端 {health.get('clients')} 台")
    if args.health:
        status = call(args.base, '/api/status')
        print(json.dumps(status, ensure_ascii=False, indent=2))
        return

    hmi = bool(args.hmi)
    if args.last:
        messages = call(args.base, '/api/messages')
        title = (call(args.base, '/api/status').get('lastScene') or {}).get('title', '最近场景')
        hmi = looks_hmi(messages)
    else:
        if not args.prompt:
            parser.error('需要 --prompt 或 --last 或 --health')
        request = {'prompt': args.prompt, 'surfaceKind': 'hmi'} if hmi else {'prompt': args.prompt, 'preferLlm': bool(args.llm)}
        if hmi and args.script:
            request['script'] = args.script
        gen = call(args.base, '/api/generate', request)
        messages = gen.get('messages') or []
        title = args.title or gen.get('title') or args.prompt
        hmi = hmi or gen.get('provider') == 'hmi-composer'
        print(f"生成：{gen.get('provider')} / {len(messages)} 条消息 / {gen.get('componentCount', '?')} 个组件 / {gen.get('elapsedMs', '?')} ms")
        for note in (gen.get('notes') or [])[:5]:
            print('  ·', note)
        if hmi:
            slots = gen.get('slots') or []
            assets = gen.get('mapAssets') or []
            print(f"  · 原型 {gen.get('archetypeName')}（{gen.get('archetype')}）· 变体 {gen.get('variant')}"
                  f" · 槽位 {'、'.join(slots) or '无'} · 地图素材 {'、'.join(assets) or '无'}")

    if not messages:
        print('没有消息可推送', file=sys.stderr)
        sys.exit(1)

    if args.no_push:
        print(f"已生成 {len(messages)} 条消息（--no-push，未推送）")
        return

    pushed = call(args.base, '/api/push', {'messages': messages, 'title': title, 'delayMs': args.delay})
    print(json.dumps(pushed, ensure_ascii=False))
    if pushed.get('clients', 0) == 0:
        print('警告：没有 App 连着 SSE，消息只进了队列（App 里点「实时流」→「连接」）', file=sys.stderr)
    if hmi:
        print('车机场景：画面由 App 里的 HmiViewerActivity（WebView）承接，Compose 渲染器不画 HMI 素材。')
        print('  一键预览：python android-demo/tools/hmi_live_viewer.py'
              '   （含 adb reverse tcp:8787 / tcp:5173、横屏、am start -n com.example.a2uidemo/.HmiViewerActivity）')


if __name__ == '__main__':
    main()
