#!/usr/bin/env python3
"""A2UI v0.9 demo stream server.

Serves A2UI messages over Server-Sent Events so the Android demo can render a
surface progressively, message by message, instead of receiving one blob.

    python a2ui_stream_server.py --port 8787
    adb reverse tcp:8787 tcp:8787
    -> app: 实时流 -> http://127.0.0.1:8787/stream

Endpoints
    GET /           tiny HTML index
    GET /health     {"ok": true}
    GET /stream     SSE stream (data: <a2ui message>)
    GET /messages   the whole scenario as a JSON array
"""

import argparse
import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

CATALOG = "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"


def _components(surface_id, components):
    return {"version": "v0.9", "updateComponents": {"surfaceId": surface_id, "components": components}}


def _data(surface_id, path, value):
    message = {"version": "v0.9", "updateDataModel": {"surfaceId": surface_id, "value": value}}
    if path is not None:
        message["updateDataModel"]["path"] = path
    return message


def dashboard(surface_id):
    """A progressively generated operations dashboard."""

    def text(component_id, value, variant="body"):
        return {"id": component_id, "component": "Text", "text": value, "variant": variant}

    def kpi(prefix, label):
        return [
            {"id": f"{prefix}-card", "component": "Card", "child": f"{prefix}-box"},
            {"id": f"{prefix}-box", "component": "Column", "children": [f"{prefix}-label", f"{prefix}-value"]},
            text(f"{prefix}-label", label, "caption"),
            text(f"{prefix}-value", {"path": f"/{prefix}"}, "h3"),
        ]


    yield 0, {"version": "v0.9", "createSurface": {"surfaceId": surface_id, "catalogId": CATALOG}}

    yield 180, _components(surface_id, [
        {"id": "root", "component": "Column", "children": ["hero", "stats", "orders", "footer"]},
        {"id": "hero", "component": "Column", "children": ["hero-title", "hero-sub"]},
        text("hero-title", "正在生成界面…", "caption"),
    ])

    yield 260, _data(surface_id, "/", {"revenue": 0, "orderCount": 0, "users": 0, "updatedAt": "刚刚"})

    yield 300, _components(surface_id, [
        text("hero-title", "运营看板", "h2"),
        text("hero-sub", "由服务端逐条下发 A2UI 消息，界面边收边长", "caption"),
        {"id": "stats", "component": "Row", "children": ["revenue-card", "orderKpi-card", "users-card"],
         "justify": "spaceBetween"},
        *kpi("revenue", "销售额"),
        *kpi("orderKpi", "订单数"),
        *kpi("users", "活跃用户"),
    ])

    yield 260, _components(surface_id, [
        text("revenue-value", {"call": "formatCurrency", "args": {"value": {"path": "/revenue"}, "currency": "CNY"}}, "h3"),
        text("orderKpi-value", {"call": "formatNumber", "args": {"value": {"path": "/orderCount"}}}, "h3"),
        text("users-value", {"call": "formatNumber", "args": {"value": {"path": "/users"}}}, "h3"),
    ])

    yield 240, _data(surface_id, "/revenue", 128640)
    yield 220, _data(surface_id, "/orderCount", 342)
    yield 220, _data(surface_id, "/users", 1024)

    yield 300, _components(surface_id, [
        {"id": "orders", "component": "Card", "child": "orders-box"},
        {"id": "orders-box", "component": "Column", "children": ["orders-title", "orders-list"]},
        text("orders-title", "最近订单", "h4"),
        {"id": "orders-list", "component": "List",
         "children": {"componentId": "order-row", "path": "/recentOrders"}},
        {"id": "order-row", "component": "Row", "children": ["order-name", "order-amount"],
         "justify": "spaceBetween", "align": "center"},
        text("order-name", {"path": "/name"}),
        text("order-amount", {"path": "/amount"}, "caption"),
    ])

    yield 240, _data(surface_id, "/recentOrders", [{"name": "SKU-8821 · 无线降噪耳机", "amount": "¥899.00 × 1"}])
    yield 260, _data(surface_id, "/recentOrders", [
        {"name": "SKU-8821 · 无线降噪耳机", "amount": "¥899.00 × 1"},
        {"name": "SKU-4417 · 机械键盘 87 键", "amount": "¥428.00 × 2"},
    ])
    yield 280, _data(surface_id, "/recentOrders", [
        {"name": "SKU-8821 · 无线降噪耳机", "amount": "¥899.00 × 1"},
        {"name": "SKU-4417 · 机械键盘 87 键", "amount": "¥428.00 × 2"},
        {"name": "SKU-1203 · 便携显示器 15.6", "amount": "¥1,299.00 × 1"},
    ])

    yield 320, _components(surface_id, [
        {"id": "footer", "component": "Row", "children": ["footnote", "export-button"],
         "justify": "spaceBetween", "align": "center"},
        text("footnote", {"call": "formatString", "args": {"value": "更新于 ${/updatedAt} · v0.9 流式渲染"}}, "caption"),
        {"id": "export-button", "component": "Button", "child": "export-text", "variant": "primary",
         "action": {"event": {"name": "exportReport", "context": {"revenue": {"path": "/revenue"}}}}},
        text("export-text", "导出报表"),
    ])


SCENARIOS = {"dashboard": dashboard}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "A2uiStream/1.0"

    def log_message(self, fmt, *args):
        print("[stream] " + fmt % args, flush=True)

    def _send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        scenario_name = query.get("scenario", ["dashboard"])[0]
        builder = SCENARIOS.get(scenario_name)

        if parsed.path == "/health":
            self._send_json({"ok": True, "scenario": scenario_name})
            return

        if not builder:
            self._send_json({"error": f"unknown scenario: {scenario_name}"}, status=404)
            return

        messages = [message for _, message in builder("stream")]

        if parsed.path == "/messages":
            self._send_json(messages)
            return

        if parsed.path == "/":
            body = (
                "<html><body style='font-family:sans-serif;padding:24px'>"
                "<h2>A2UI stream server</h2>"
                "<p><a href='/stream'>/stream</a> - SSE, 逐条下发 A2UI 消息</p>"
                "<p><a href='/messages'>/messages</a> - 整个场景的 JSON 数组</p>"
                "<p><a href='/health'>/health</a></p>"
                "</body></html>"
            ).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if parsed.path != "/stream":
            self._send_json({"error": "not found"}, status=404)
            return

        speed = float(query.get("speed", ["1.0"])[0])
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache, no-transform")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()

        try:
            self.wfile.write(b": connected\n\n")
            self.wfile.flush()

            for delay_ms, message in builder("stream"):
                if delay_ms:
                    time.sleep(delay_ms / 1000.0 * speed)
                payload = json.dumps(message, ensure_ascii=False)
                self.wfile.write(f"data: {payload}\n\n".encode("utf-8"))
                self.wfile.flush()

            while True:
                time.sleep(2)
                self.wfile.write(b": ping\n\n")
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            print("[stream] client disconnected", flush=True)


def main():
    parser = argparse.ArgumentParser(description="A2UI v0.9 SSE demo server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--scenario", default="dashboard", choices=sorted(SCENARIOS))
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.daemon_threads = True
    print(f"A2UI stream server on http://{args.host}:{args.port}  scenario={args.scenario}")
    print(f"  SSE      GET :{args.port}/stream")
    print(f"  messages GET :{args.port}/messages")
    print("Android: adb reverse tcp:%d tcp:%d" % (args.port, args.port))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()