#!/usr/bin/env python3
"""一键把「车机 HMI 预览」推到 MuMu / 模拟器上（控制台后台 -> App 的 WebView 查看器）。

做四件事，每步都打印结果：
  1. adb reverse tcp:8787 tcp:8787   （让模拟器能连上控制台 /stream、/api）
  2. adb reverse tcp:5173 tcp:5173   （让模拟器能连上 demo 前端）
  3. settings put system user_rotation 1   （强制横屏）
  4. am force-stop com.example.a2uidemo，再
     am start -n com.example.a2uidemo/.HmiViewerActivity --es url "http://127.0.0.1:5173/?fit=1&live=1&console=http://127.0.0.1:8787"

HmiViewerActivity 是个全屏 WebView（app/src/main/java/com/example/a2uidemo/HmiViewerActivity.kt）：
车机画面走 WebView，不走 Compose 渲染器（Compose 只实现 Basic Catalog）。

用法：
  python android-demo/tools/hmi_live_viewer.py
  python android-demo/tools/hmi_live_viewer.py --prompt "找附近的停车场，时速 60"   # 生成 + 推送一版车机场景
  python android-demo/tools/hmi_live_viewer.py --device emulator-5554 --adb "D:\\platform-tools\\adb.exe"
  python android-demo/tools/hmi_live_viewer.py --no-rotation            # 不动模拟器旋转
  python android-demo/tools/hmi_live_viewer.py --print-only             # 只打印将要执行的命令
adb 路径不存在时会提示如何指定（--adb 或放到 PATH）。
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import urllib.request

DEFAULT_ADB = r"D:\Program Files\NetEase\MuMu\nx_main\adb.exe"
DEFAULT_DEVICE = "127.0.0.1:7555"
DEFAULT_CONSOLE = "http://127.0.0.1:8787"
DEFAULT_VIEWER = "http://127.0.0.1:5173"
PACKAGE = "com.example.a2uidemo"
ACTIVITY = PACKAGE + "/.HmiViewerActivity"


def run(argv, timeout=60):
    try:
        completed = subprocess.run(argv, capture_output=True, text=True,
                                   encoding="utf-8", errors="replace", timeout=timeout)
    except subprocess.TimeoutExpired:
        return 124, "", "超时（>" + str(timeout) + "s）"
    except OSError as exc:
        return 127, "", str(exc)
    return completed.returncode, (completed.stdout or "").strip(), (completed.stderr or "").strip()


def show(title, argv, code, out, err):
    text = out or err or "（无输出）"
    flag = "ok" if code == 0 else "失败 exit=" + str(code)
    print("· " + title + " [" + flag + "]")
    for line in text.splitlines() or [""]:
        print("    " + line)
    return code == 0


def resolve_adb(given):
    if given:
        if os.path.isfile(given):
            return given
        print("adb 不存在：" + given, file=sys.stderr)
        return None
    found = shutil.which("adb")
    if found:
        return found
    if os.path.isfile(DEFAULT_ADB):
        return DEFAULT_ADB
    return None


def main():
    parser = argparse.ArgumentParser(
        description="一键把车机 HMI 预览推到 MuMu（端口反代 + 横屏 + HmiViewerActivity）",
        epilog="车机画面由 App 里的 HmiViewerActivity（WebView）承接；通用 Basic 场景才走 Compose 渲染。",
    )
    parser.add_argument("--adb", default=None, help="adb 路径（默认 " + DEFAULT_ADB + "，找不到再用 PATH 里的 adb）")
    parser.add_argument("--device", default=DEFAULT_DEVICE, help="adb 设备（MuMu 默认 " + DEFAULT_DEVICE + "）")
    parser.add_argument("--console", default=DEFAULT_CONSOLE, help="控制台地址（写进查看器的 console 参数）")
    parser.add_argument("--viewer", default=DEFAULT_VIEWER, help="demo 前端地址（vite，需监听 127.0.0.1:5173）")
    parser.add_argument("--url", default=None, help="直接指定查看器加载的 url（覆盖 --viewer/--console 拼装结果）")
    parser.add_argument("--prompt", help="顺手让控制台生成并推送一个车机场景（走 surfaceKind=hmi）")
    parser.add_argument("--script", help="配合 --prompt 的车机块脚本，例如 \"CARD 座舱温度 主驾 22\"")
    parser.add_argument("--no-rotation", action="store_true", help="不改模拟器旋转")
    parser.add_argument("--no-force-stop", action="store_true", help="不先 force-stop App")
    parser.add_argument("--print-only", action="store_true", help="只打印要执行的命令，不真的执行")
    args = parser.parse_args()

    url = args.url or (args.viewer.rstrip("/") + "/?fit=1&live=1&console=" + args.console)

    adb = resolve_adb(args.adb)
    if adb is None:
        print("未找到 adb。请用 --adb 指定路径，或把 adb 放进 PATH，例如：", file=sys.stderr)
        print("  python android-demo/tools/hmi_live_viewer.py --adb \"" + DEFAULT_ADB + "\"", file=sys.stderr)
        print("  MuMu 的 adb 通常在 D:\\Program Files\\NetEase\\MuMu\\nx_main\\adb.exe；"
              "Android SDK 在 …\\platform-tools\\adb.exe", file=sys.stderr)
        return 2

    steps = []
    if not args.no_force_stop:
        steps.append(("force-stop " + PACKAGE, [adb, "-s", args.device, "shell", "am force-stop " + PACKAGE]))
    steps.append(("reverse tcp:8787", [adb, "-s", args.device, "reverse", "tcp:8787", "tcp:8787"]))
    steps.append(("reverse tcp:5173", [adb, "-s", args.device, "reverse", "tcp:5173", "tcp:5173"]))
    if not args.no_rotation:
        steps.append(("竖屏锁定", [adb, "-s", args.device, "shell", "settings put system accelerometer_rotation 0"]))
        steps.append(("横屏 user_rotation=1", [adb, "-s", args.device, "shell", "settings put system user_rotation 1"]))
    # url 里有 &，必须让设备端 shell 看到引号，所以整条命令作为一个参数传给 adb shell
    am = "am start -n " + ACTIVITY + " --es url '" + url + "'"
    steps.append(("打开 HmiViewerActivity", [adb, "-s", args.device, "shell", am]))

    print("adb    : " + adb)
    print("device : " + args.device)
    print("viewer : " + url)
    print("-" * 62)

    if args.print_only:
        for title, argv in steps:
            print("· " + title)
            print("    " + " ".join("'" + part + "'" if " " in part or "&" in part else part for part in argv))
        return 0

    code, out, err = run([adb, "-s", args.device, "get-state"], timeout=20)
    if code != 0:
        show("设备状态（get-state）", ["get-state"], code, out, err)
        print("设备 " + args.device + " 连不上：先启动 MuMu / 模拟器，或 `\"" + adb + "\" devices` 看设备号。", file=sys.stderr)
        return 3
    print("· 设备状态 [ok] " + (out or "device"))

    failed = 0
    for title, argv in steps:
        if not show(title, argv, *run(argv)):
            failed += 1
    if failed:
        print("有 " + str(failed) + " 步失败，可逐条重试上面打印的命令。", file=sys.stderr)

    if args.prompt:
        try:
            payload = {"prompt": args.prompt, "surfaceKind": "hmi"}
            if args.script:
                payload["script"] = args.script
            request = urllib.request.Request(args.console.rstrip("/") + "/api/generate",
                                             data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                                             headers={"Content-Type": "application/json; charset=utf-8"})
            with urllib.request.urlopen(request, timeout=120) as response:
                scene = json.loads(response.read().decode("utf-8"))
            messages = scene.get("messages") or []
            print("· 生成车机场景 [ok] " + str(scene.get("archetypeName")) + " / "
                  + str(len(messages)) + " 条 / " + str(scene.get("componentCount")) + " 组件")
            request = urllib.request.Request(args.console.rstrip("/") + "/api/push",
                                             data=json.dumps({"messages": messages,
                                                              "title": scene.get("title") or "车机场景",
                                                              "delayMs": 120},
                                                             ensure_ascii=False).encode("utf-8"),
                                             headers={"Content-Type": "application/json; charset=utf-8"})
            with urllib.request.urlopen(request, timeout=120) as response:
                pushed = json.loads(response.read().decode("utf-8"))
            print("· 推送 [ok] " + json.dumps(pushed, ensure_ascii=False))
            if not pushed.get("clients"):
                print("  提示：没有客户端连着 /stream。查看器页面（live=1）连上后会自动收到这批消息。", file=sys.stderr)
        except Exception as exc:  # 控制台没起 / 生成失败都不影响已打开的查看器
            print("· 生成或推送车机场景 [失败] " + str(exc), file=sys.stderr)
            print("  可单独跑：python android-demo/tools/console_push.py --hmi --prompt \"找附近的停车场，时速 60\"",
                  file=sys.stderr)

    print("-" * 62)
    print("完成。看 logcat：\"" + adb + "\" -s " + args.device + " logcat -d -s A2uiHmi:V")
    print("截图：      \"" + adb + "\" -s " + args.device + " shell screencap -p /sdcard/Download/hmi.png")
    return 0 if not failed else 4


if __name__ == "__main__":
    sys.exit(main())
