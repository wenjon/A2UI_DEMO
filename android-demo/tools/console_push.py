"""Drive the A2UI Studio console: 场景描述 -> A2UI JSON -> SSE 推送到已连接的 App.

用法：
  python android-demo/tools/console_push.py --prompt "做一个智能汽车的车机首页"
  python android-demo/tools/console_push.py --last                 # 重推最近一次场景
  python android-demo/tools/console_push.py --prompt "..." --llm   # 走控制台配置的模型
  python android-demo/tools/console_push.py --health               # 只看在线客户端数
  python android-demo/tools/console_push.py --hmi --prompt "找附近的停车场，时速 60"        # 车机 HMI 场景
  python android-demo/tools/console_push.py --hmi --prompt "车控面板" --script "CARD 座舱温度 主驾 22"
  python android-demo/tools/console_push.py --hmi-model --prompt "导航中，剩余 12 公里 25 分钟，时速 88"   # 让本地模型写车机块
  python android-demo/tools/console_push.py --hmi --prompt "找附近的停车场，时速 60" --sim jam --sim-at 2520 --seed 7   # 带「车辆状态模拟数据」
  python android-demo/tools/console_push.py --agent-request "现在市区堵车，快没电了，就近找停车场充电"   # 只进 Agent 收件箱

两条推送路线（同一条 SSE 通道 /stream，App 侧谁接住画面不同）：
  · 通用场景（默认，Basic Catalog）  -> App 的 Compose 渲染器：MainActivity「实时流」-> 连接
  · 车机 HMI 场景（--hmi，1920×1200） -> App 里的 **HmiViewerActivity（WebView）** 承接：
      Compose 渲染器只实现 Basic Catalog，画不了 HMI 素材，所以车机画面走 WebView 查看器。
      --hmi-model = --hmi + useModel:true：块脚本由控制台后台配的本地模型写，服务端 compileHmiBlocks 纠偏。
      模型的地址 / 名字在启动控制台时指定：--llm-base http://127.0.0.1:11434 --llm-model qwen2.5:0.5b
      一键把车机预览推到模拟器（端口反代 + 横屏 + 打开 HmiViewerActivity）：
        python android-demo/tools/hmi_live_viewer.py
 第三条路「交给 Agent 推理」（--agent-request）：
   只 POST /api/agent/request 把场景描述记进控制台收件箱 —— 后台不生成、不推理、不推送。
   写块的是 DeepSeek Harness 会话里的 Agent：它 GET /api/agent/pending + POST /api/agent/claim 捞单，
   推理出块脚本后自己调 /api/generate（带 script）+ /api/push，最后 POST /api/agent/done 标成已处理。
   带了 --agent-request 就跟生成 / 推送流程互斥：--prompt / --last / --hmi / --hmi-model / --script /
   --no-push 一律忽略，收完单只打印 id 和提示就退出。
默认服务地址 http://127.0.0.1:8787 ，可用 --base 覆盖。
"""
import argparse
import json
import sys
import time
import urllib.error
import urllib.request

def call(base, path, payload=None, timeout=180):
    data = None
    headers = {'Accept': 'application/json'}
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        headers['Content-Type'] = 'application/json; charset=utf-8'
    req = urllib.request.Request(base.rstrip('/') + path, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
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
    parser.add_argument('--hmi-model', action='store_true',
                        help='等价于 --hmi + useModel:true：车机块脚本由本地模型写、后台编译纠偏（可能要几十秒）')
    parser.add_argument('--script', help='车机场景的块脚本，例如 "CARD 座舱温度 主驾 22"（仅 --hmi 时生效；--hmi-model 时后台走模型分支，会忽略它）')
    parser.add_argument('--sim', metavar='预设名',
                        help='车辆状态模拟预设（city-cruise / jam / highway-acc / parking-search / charging / arrival / rain-night / fuel-city）：'
                             '只用于 --hmi / --hmi-model，后台会拼成 hmi-cli.ts 的 --sim')
    parser.add_argument('--sim-at', type=int, metavar='秒', help='模拟时刻：预设内已经跑了多少秒（配合 --sim，拼成 --sim-at）')
    parser.add_argument('--seed', type=int, help='模拟随机种子（配合 --sim，拼成 --seed；同 preset + at + seed 结果可复现）')
    parser.add_argument('--agent-request', metavar='场景描述',
                        help='只把这段场景描述 POST 进控制台的 Agent 收件箱（POST /api/agent/request）：'
                             '后台不生成、不推理、不推送；跟上面的生成 / 推送参数互斥')
    parser.add_argument('--health', action='store_true')
    parser.add_argument('--delay', type=int, default=120)
    parser.add_argument('--title')
    parser.add_argument('--no-push', action='store_true', help='只生成不推送（打印消息数）')
    args = parser.parse_args()

    health = call(args.base, '/health')
    print(f"控制台 {args.base} 在线客户端 {health.get('clients')} 台")

    if args.agent_request:
        text = args.agent_request.strip()
        if not text:
            parser.error('--agent-request 的场景描述不能为空')
        ignored = [name for name, value in (
            ('--prompt', args.prompt), ('--last', args.last), ('--hmi', args.hmi),
            ('--hmi-model', args.hmi_model), ('--script', args.script), ('--llm', args.llm),
            ('--sim', args.sim), ('--sim-at', args.sim_at), ('--seed', args.seed),
            ('--no-push', args.no_push), ('--health', args.health), ('--title', args.title),
            ('--delay', args.delay if args.delay != 120 else None),
        ) if value]
        record = call(args.base, '/api/agent/request', {'text': text}, timeout=30)
        stamp = record.get('createdAt')
        clock = time.strftime('%H:%M:%S', time.localtime(stamp)) if isinstance(stamp, (int, float)) else '?'
        print(f"已进收件箱：{record.get('id')} · status={record.get('status')} · {clock}")
        print(f"  · 场景描述：{text if len(text) <= 120 else text[:119] + '…'}")
        if ignored:
            print(f"  · 带了 --agent-request，生成 / 推送相关参数已忽略：{' '.join(ignored)}")
        print('  · 后台没有生成、没有推理、也没有推送。下一步：在 DeepSeek Harness 会话里说「看下后台」，'
              'Agent 会捞这条（POST /api/agent/claim）、推理出块、再调 /api/generate（带 script）+ /api/push，'
              '最后 POST /api/agent/done 标成已处理。')
        return

    if args.health:
        status = call(args.base, '/api/status')
        print(json.dumps(status, ensure_ascii=False, indent=2))
        return

    hmi = bool(args.hmi or args.hmi_model)
    sim_option = None
    if args.sim:
        sim_option = {'preset': args.sim.strip()}
        if args.sim_at is not None:
            sim_option['at'] = args.sim_at
        if args.seed is not None:
            sim_option['seed'] = args.seed
    if (args.sim_at is not None or args.seed is not None) and not args.sim:
        parser.error('--sim-at / --seed 要配 --sim <预设名> 一起用')
    if sim_option and not hmi and not args.agent_request:
        parser.error('--sim 只作用于 --hmi / --hmi-model 分支（通用界面不带模拟车况）')
    if args.last and sim_option:
        print('  · --last 只重推最近场景，--sim 没有生效')
    if args.last:
        messages = call(args.base, '/api/messages')
        title = (call(args.base, '/api/status').get('lastScene') or {}).get('title', '最近场景')
        hmi = looks_hmi(messages)
    else:
        if not args.prompt:
            parser.error('需要 --prompt 或 --last 或 --health')
        if hmi:
            request = {'prompt': args.prompt, 'surfaceKind': 'hmi'}
            if args.hmi_model:
                request['useModel'] = True
            if args.script:
                request['script'] = args.script
            if sim_option:
                request['sim'] = sim_option
        else:
            request = {'prompt': args.prompt, 'preferLlm': bool(args.llm)}
        gen = call(args.base, '/api/generate', request, timeout=300 if args.hmi_model else 180)
        messages = gen.get('messages') or []
        title = args.title or gen.get('title') or args.prompt
        provider = str(gen.get('provider') or '')
        hmi = hmi or provider == 'hmi-composer' or provider.startswith('model')
        print(f"生成：{provider or '?'} / {len(messages)} 条消息 / {gen.get('componentCount', '?')} 个组件 / {gen.get('elapsedMs', '?')} ms")
        if provider.startswith('model'):
            attempts = gen.get('attempts') or []
            print(f"  · 模型写块：{gen.get('model', '?')} @ {gen.get('llmBase', '?')}"
                  f" · 模型 {gen.get('totalMs', '?')} ms · 尝试 {len(attempts)} 次")
            lines = [line.strip() for line in str(gen.get('modelScript') or '').splitlines() if line.strip()]
            if lines:
                print(f"  · 模型写的块（前 {min(6, len(lines))} 行 / 共 {len(lines)} 行）：")
                for line in lines[:6]:
                    print('      ', line)
            else:
                print('  · 模型没有回传块脚本（modelScript 为空）')
            for err in list(gen.get('modelErrors') or [])[:2]:
                print('   !', err)
        for note in (gen.get('notes') or [])[:5]:
            print('  ·', note)
        if hmi:
            slots = gen.get('slots') or []
            assets = gen.get('mapAssets') or []
            print(f"  · 原型 {gen.get('archetypeName')}（{gen.get('archetype')}）· 变体 {gen.get('variant')}"
                  f" · 槽位 {'、'.join(slots) or '无'} · 地图素材 {'、'.join(assets) or '无'}")
        sim_summary = gen.get('sim')
        if isinstance(sim_summary, dict):
            print(f"  · 模拟车况 {sim_summary.get('preset', args.sim or '?')}：时钟 {sim_summary.get('clock', '?')}"
                  f" · 车速 {sim_summary.get('speed', '?')} km/h · 电量 {sim_summary.get('soc', '?')}%"
                  f" · 卡片 +{sim_summary.get('cardsAdded', 0)}（已跑 {sim_summary.get('simSec', '?')} 秒）")
        elif sim_option:
            print(f"  · 模拟车况 {sim_option['preset']}"
                  + (f" @ {sim_option['at']} 秒" if 'at' in sim_option else '')
                  + (f" · seed {sim_option['seed']}" if 'seed' in sim_option else '')
                  + '：后台没回 sim 摘要（demo/server/hmi-sim.ts 或 hmi-cli.ts 的 --sim 分支还没接上）')

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
