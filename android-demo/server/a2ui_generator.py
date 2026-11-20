#!/usr/bin/env python3
"""Natural language -> A2UI v0.9 messages.

Talks to any OpenAI-compatible chat-completions endpoint when one is
configured, and falls back to a deterministic local scene builder so the
console still works offline.
"""
from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field

CATALOG = "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
DEFAULT_SURFACE = "web_console"

ALLOWED_COMPONENTS = {
    "Text", "Column", "Row", "Card", "Button", "TextField",
    "CheckBox", "Slider", "Divider", "Image", "Icon", "List",
}
TEXT_VARIANTS = {"h1", "h2", "h3", "h4", "h5", "caption", "body"}
BUTTON_VARIANTS = {"primary", "default", "borderless"}
OPERATIONS = ("createSurface", "updateComponents", "updateDataModel", "deleteSurface")
DOLLAR = chr(36)


def _var(path):
    """Build an A2UI formatString placeholder without literal dollar-brace."""
    return DOLLAR + "{" + path + "}"


@dataclass
class GenerationResult:
    title: str
    summary: str
    messages: list
    provider: str
    warnings: list = field(default_factory=list)
    surface_id: str = DEFAULT_SURFACE
    elapsed_ms: int = 0

    def as_dict(self):
        return {
            "title": self.title,
            "summary": self.summary,
            "messages": self.messages,
            "provider": self.provider,
            "warnings": self.warnings,
            "surfaceId": self.surface_id,
            "elapsedMs": self.elapsed_ms,
        }


def model_settings():
    base_url = (os.environ.get("A2UI_LLM_BASE_URL")
                or os.environ.get("OPENAI_BASE_URL")
                or "https://api.openai.com/v1")
    api_key = os.environ.get("A2UI_LLM_API_KEY") or os.environ.get("OPENAI_API_KEY") or ""
    model = os.environ.get("A2UI_LLM_MODEL") or os.environ.get("AGENT_MODEL") or "gpt-4.1-mini"
    return {
        "base_url": base_url.rstrip("/"),
        "api_key": api_key,
        "model": model,
        "configured": bool(api_key),
    }


def llm_available():
    return model_settings()["configured"]


def _create(surface_id):
    return {"version": "v0.9", "createSurface": {"surfaceId": surface_id, "catalogId": CATALOG}}


def _components(surface_id, components):
    return {"version": "v0.9", "updateComponents": {"surfaceId": surface_id, "components": components}}


def _data(surface_id, path, value):
    body = {"surfaceId": surface_id, "value": value}
    if path is not None:
        body["path"] = path
    return {"version": "v0.9", "updateDataModel": body}


def _text(cid, value, variant="body"):
    return {"id": cid, "component": "Text", "text": value, "variant": variant}


def _field(cid, label, path, variant="shortText"):
    return {"id": cid, "component": "TextField", "label": label, "value": {"path": path}, "variant": variant}


def _check(cid, label, path):
    return {"id": cid, "component": "CheckBox", "label": label, "value": {"path": path}}


def _button(cid, label, action=None, variant="default"):
    node = {"id": cid, "component": "Button", "child": cid + "-label", "variant": variant}
    if action:
        node["action"] = {"event": action}
    return [node, _text(cid + "-label", label)]


def _kpi(prefix, label, value):
    return [
        {"id": prefix + "-card", "component": "Card", "child": prefix + "-box"},
        {"id": prefix + "-box", "component": "Column", "children": [prefix + "-label", prefix + "-value"]},
        _text(prefix + "-label", label, "caption"),
        _text(prefix + "-value", value, "h3"),
    ]


def _money(path, currency="CNY"):
    return {"call": "formatCurrency", "args": {"value": {"path": path}, "currency": currency}}


def _number(path):
    return {"call": "formatNumber", "args": {"value": {"path": path}}}


# ---------------------------------------------------------------- local scenes

def _login_scene(sid):
    return "登录 · 账号中心", "登录表单、记住我开关与注册入口", [
        _create(sid),
        _components(sid, [
            {"id": "root", "component": "Column", "children": ["hero", "form-card", "footer"]},
            {"id": "hero", "component": "Column", "children": ["hero-title", "hero-sub"]},
            _text("hero-title", "欢迎回来", "h2"),
            _text("hero-sub", "登录后继续使用你的工作空间", "caption"),
        ]),
        _data(sid, "/", {"email": "demo@example.com", "password": "", "remember": True}),
        _components(sid, [
            {"id": "form-card", "component": "Card", "child": "form-box"},
            {"id": "form-box", "component": "Column", "children": [
                "email-field", "password-field", "remember-check", "login-button", "login-hint"]},
            _field("email-field", "邮箱", "/email"),
            _field("password-field", "密码", "/password", "obscured"),
            _check("remember-check", "记住我", "/remember"),
            *_button("login-button", "登录", {"name": "login", "context": {"email": {"path": "/email"}}}, "primary"),
            _text("login-hint", "演示环境，不会真正提交账号", "caption"),
        ]),
        _data(sid, "/password", "a2ui-demo"),
        _components(sid, [
            {"id": "footer", "component": "Row", "children": ["footer-hint", "register-button"],
             "justify": "spaceBetween", "align": "center"},
            _text("footer-hint", "还没有账号？", "caption"),
            *_button("register-button", "立即注册", {"name": "register", "context": {}}, "borderless"),
        ]),
    ]


def _product_scene(sid):
    product = {
        "name": "AirWave 无线降噪耳机",
        "price": 899.0,
        "rating": "4.8 / 5.0",
        "bullets": [{"text": "40 小时综合续航"}, {"text": "自适应主动降噪"}, {"text": "双设备无缝切换"}],
    }
    return "商品详情 · AirWave", "商品信息、价格、卖点与购买动作", [
        _create(sid),
        _components(sid, [
            {"id": "root", "component": "Column", "children": ["product-image", "product-card", "product-actions"]},
            {"id": "product-image", "component": "Image", "description": "AirWave 无线降噪耳机", "url": ""},
        ]),
        _data(sid, "/", {"product": product}),
        _components(sid, [
            {"id": "product-card", "component": "Card", "child": "product-box"},
            {"id": "product-box", "component": "Column", "children": [
                "product-title", "product-price", "product-rating", "divider-1", "bullets-title", "bullets-list"]},
            _text("product-title", {"path": "/product/name"}, "h3"),
            _text("product-price", _money("/product/price"), "h3"),
            _text("product-rating", {"call": "formatString", "args": {
                "value": _var("/product/rating") + " 分 · 顺丰包邮"}}, "caption"),
            {"id": "divider-1", "component": "Divider"},
            _text("bullets-title", "核心卖点", "h5"),
            {"id": "bullets-list", "component": "List",
             "children": {"componentId": "bullet-row", "path": "/product/bullets"}},
            {"id": "bullet-row", "component": "Row", "children": ["bullet-dot", "bullet-text"], "align": "center"},
            _text("bullet-dot", "•", "caption"),
            _text("bullet-text", {"path": "/text"}),
        ]),
        _components(sid, [
            {"id": "product-actions", "component": "Row", "children": ["cart-button", "buy-button"],
             "justify": "spaceBetween", "align": "center"},
            *_button("cart-button", "加入购物车", {"name": "addToCart", "context": {
                "product": {"path": "/product/name"}, "price": {"path": "/product/price"}}}, "default"),
            *_button("buy-button", "立即购买", {"name": "buyNow", "context": {
                "product": {"path": "/product/name"}, "price": {"path": "/product/price"}}}, "primary"),
        ]),
    ]


def _settings_scene(sid):
    prefs = {"darkMode": True, "fontScale": 1.0, "autoSave": True, "pushEnabled": True, "emailDigest": False}
    return "偏好设置", "开关、滑杆与自动保存", [
        _create(sid),
        _components(sid, [
            {"id": "root", "component": "Column", "children": ["hero", "pref-card", "notify-card", "footer"]},
            {"id": "hero", "component": "Column", "children": ["hero-title", "hero-sub"]},
            _text("hero-title", "偏好设置", "h2"),
            _text("hero-sub", "所有改动都会写入本地数据模型", "caption"),
        ]),
        _data(sid, "/", {"prefs": prefs}),
        _components(sid, [
            {"id": "pref-card", "component": "Card", "child": "pref-box"},
            {"id": "pref-box", "component": "Column", "children": [
                "pref-title", "dark-row", "divider-1", "font-slider", "divider-2", "autosave-row"]},
            _text("pref-title", "外观与行为", "h4"),
            {"id": "dark-row", "component": "Row", "children": ["dark-label", "dark-check"],
             "justify": "spaceBetween", "align": "center"},
            _text("dark-label", "深色模式"),
            _check("dark-check", "", "/prefs/darkMode"),
            {"id": "divider-1", "component": "Divider"},
            {"id": "font-slider", "component": "Slider", "label": "字号缩放",
             "min": 0.8, "max": 1.4, "value": {"path": "/prefs/fontScale"}},
            {"id": "divider-2", "component": "Divider"},
            {"id": "autosave-row", "component": "Row", "children": ["autosave-label", "autosave-check"],
             "justify": "spaceBetween", "align": "center"},
            _text("autosave-label", "自动保存"),
            _check("autosave-check", "", "/prefs/autoSave"),
        ]),
        _components(sid, [
            {"id": "notify-card", "component": "Card", "child": "notify-box"},
            {"id": "notify-box", "component": "Column", "children": ["notify-title", "push-row", "email-row"]},
            _text("notify-title", "通知", "h4"),
            {"id": "push-row", "component": "Row", "children": ["push-label", "push-check"],
             "justify": "spaceBetween", "align": "center"},
            _text("push-label", "推送提醒"),
            _check("push-check", "", "/prefs/pushEnabled"),
            {"id": "email-row", "component": "Row", "children": ["email-label", "email-check"],
             "justify": "spaceBetween", "align": "center"},
            _text("email-label", "每周邮件摘要"),
            _check("email-check", "", "/prefs/emailDigest"),
            {"id": "footer", "component": "Row", "children": ["footer-text"], "justify": "spaceBetween"},
            _text("footer-text", "设置已在本地生效", "caption"),
        ]),
    ]


def _todo_scene(sid):
    tasks = [
        {"title": "完成 A2UI v0.9 组件校验", "due": "今天 18:00", "priority": "高", "dot": "●"},
        {"title": "补齐实时流断线重连", "due": "明天", "priority": "中", "dot": "○"},
        {"title": "整理设计走查清单", "due": "周五", "priority": "低", "dot": "○"},
    ]
    return "本周待办", "3 项任务，1 项已完成", [
        _create(sid),
        _components(sid, [
            {"id": "root", "component": "Column", "children": ["hero", "tasks-card", "actions"]},
            {"id": "hero", "component": "Column", "children": ["hero-title", "hero-sub"]},
            _text("hero-title", "本周待办", "h2"),
            _text("hero-sub", "先做重要的，再做紧急的", "caption"),
        ]),
        _data(sid, "/", {"completed": 1, "total": 3, "tasks": tasks}),
        _components(sid, [
            {"id": "tasks-card", "component": "Card", "child": "tasks-box"},
            {"id": "tasks-box", "component": "Column", "children": ["tasks-header", "tasks-list"]},
            {"id": "tasks-header", "component": "Row", "children": ["tasks-title", "tasks-summary"],
             "justify": "spaceBetween", "align": "center"},
            _text("tasks-title", "任务清单", "h4"),
            _text("tasks-summary", {"call": "formatString", "args": {
                "value": _var("/completed") + " / " + _var("/total") + " 已完成"}}, "caption"),
            {"id": "tasks-list", "component": "List",
             "children": {"componentId": "task-row", "path": "/tasks"}},
            {"id": "task-row", "component": "Row", "children": ["task-dot", "task-main", "task-priority"],
             "justify": "spaceBetween", "align": "center"},
            _text("task-dot", {"path": "/dot"}),
            {"id": "task-main", "component": "Column", "children": ["task-title", "task-due"]},
            _text("task-title", {"path": "/title"}),
            _text("task-due", {"path": "/due"}, "caption"),
            _text("task-priority", {"path": "/priority"}, "caption"),
        ]),
        _components(sid, [
            {"id": "actions", "component": "Row", "children": ["add-button", "clear-button"],
             "justify": "spaceBetween", "align": "center"},
            *_button("add-button", "新增任务", {"name": "addTask", "context": {}}, "primary"),
            *_button("clear-button", "清理已完成", {"name": "clearCompleted", "context": {}}, "borderless"),
        ]),
    ]


def _profile_scene(sid):
    profile = {
        "name": "林川",
        "role": "产品设计师 · 上海",
        "bio": "用 A2UI 把想法直接变成可运行的界面。",
        "stats": [
            {"value": "128", "label": "项目"},
            {"value": "24", "label": "关注"},
            {"value": "96%", "label": "按时率"},
        ],
    }
    stats_row = []
    stat_components = []
    for index in range(3):
        stats_row.append("stat-" + str(index) + "-card")
        stat_components += [
            {"id": "stat-" + str(index) + "-card", "component": "Card",
             "child": "stat-" + str(index) + "-box"},
            {"id": "stat-" + str(index) + "-box", "component": "Column",
             "children": ["stat-" + str(index) + "-value", "stat-" + str(index) + "-label"]},
            _text("stat-" + str(index) + "-value", {"path": "/profile/stats/" + str(index) + "/value"}, "h3"),
            _text("stat-" + str(index) + "-label", {"path": "/profile/stats/" + str(index) + "/label"}, "caption"),
        ]
    return "个人资料 · " + profile["name"], "资料卡、三项数据与关注动作", [
        _create(sid),
        _components(sid, [
            {"id": "root", "component": "Column", "children": ["profile-card", "stats-row", "actions"]},
            {"id": "profile-card", "component": "Card", "child": "profile-box"},
            {"id": "profile-box", "component": "Column", "children": ["profile-top", "profile-bio"]},
            {"id": "profile-top", "component": "Row", "children": ["avatar-icon", "name-box"], "align": "center"},
            {"id": "avatar-icon", "component": "Icon", "name": "star"},
            {"id": "name-box", "component": "Column", "children": ["profile-name", "profile-role"]},
            _text("profile-name", {"path": "/profile/name"}, "h3"),
            _text("profile-role", {"path": "/profile/role"}, "caption"),
        ]),
        _data(sid, "/", {"profile": profile}),
        _components(sid, [
            _text("profile-bio", {"path": "/profile/bio"}, "body"),
            {"id": "stats-row", "component": "Row", "children": stats_row,
             "justify": "spaceBetween"},
            *stat_components,
        ]),
        _components(sid, [
            {"id": "actions", "component": "Row", "children": ["follow-button", "message-button"],
             "justify": "spaceBetween", "align": "center"},
            *_button("follow-button", "关注", {"name": "followUser", "context": {
                "name": {"path": "/profile/name"}}}, "primary"),
            *_button("message-button", "发消息", {"name": "messageUser", "context": {}}, "borderless"),
        ]),
    ]


def _dashboard_scene(sid):
    orders = [
        {"name": "SKU-8821 · 无线降噪耳机", "amount": "¥899.00 × 1"},
        {"name": "SKU-4417 · 机械键盘 87 键", "amount": "¥428.00 × 2"},
        {"name": "SKU-1203 · 便携显示器 15.6", "amount": "¥1,299.00 × 1"},
    ]
    return "运营看板", "销售额、订单数、活跃用户与最近订单", [
        _create(sid),
        _components(sid, [
            {"id": "root", "component": "Column", "children": ["hero", "stats-row", "orders-card", "footer"]},
            {"id": "hero", "component": "Column", "children": ["hero-title", "hero-sub"]},
            _text("hero-title", "正在生成界面…", "caption"),
        ]),
        _data(sid, "/", {"revenue": 0, "orderCount": 0, "users": 0, "updatedAt": "刚刚"}),
        _components(sid, [
            _text("hero-title", "运营看板", "h2"),
            _text("hero-sub", "服务端逐条下发 A2UI 消息，界面边收边长", "caption"),
            {"id": "stats-row", "component": "Row",
             "children": ["revenue-card", "orderKpi-card", "users-card"], "justify": "spaceBetween"},
            *_kpi("revenue", "销售额", _money("/revenue")),
            *_kpi("orderKpi", "订单数", _number("/orderCount")),
            *_kpi("users", "活跃用户", _number("/users")),
        ]),
        _data(sid, "/revenue", 128640),
        _data(sid, "/orderCount", 342),
        _data(sid, "/users", 1024),
        _components(sid, [
            {"id": "orders-card", "component": "Card", "child": "orders-box"},
            {"id": "orders-box", "component": "Column", "children": ["orders-title", "orders-list"]},
            _text("orders-title", "最近订单", "h4"),
            {"id": "orders-list", "component": "List",
             "children": {"componentId": "order-row", "path": "/recentOrders"}},
            {"id": "order-row", "component": "Row", "children": ["order-name", "order-amount"],
             "justify": "spaceBetween", "align": "center"},
            _text("order-name", {"path": "/name"}),
            _text("order-amount", {"path": "/amount"}, "caption"),
        ]),
        _data(sid, "/recentOrders", orders),
        _components(sid, [
            {"id": "footer", "component": "Row", "children": ["footnote", "export-button"],
             "justify": "spaceBetween", "align": "center"},
            _text("footnote", {"call": "formatString", "args": {
                "value": "更新于 " + _var("/updatedAt") + " · v0.9 流式渲染"}}, "caption"),
            *_button("export-button", "导出报表", {"name": "exportReport", "context": {
                "revenue": {"path": "/revenue"}}}, "primary"),
        ]),
    ]


def _membership_scene(sid):
    member = {
        "name": "晨光会员",
        "level": "金卡会员",
        "points": 1280,
        "coupons": 3,
        "perks": [{"text": "每月 2 张升杯券"}, {"text": "生日双倍积分"}, {"text": "新品尝鲜 9 折"}],
    }
    return "会员首页 · 晨光", "积分、优惠券与本月会员权益", [
        _create(sid),
        _components(sid, [
            {"id": "root", "component": "Column", "children": ["hero", "stats-row", "perks-card", "actions"]},
            {"id": "hero", "component": "Column", "children": ["member-name", "member-level"]},
            _text("member-name", {"path": "/member/name"}, "h2"),
            _text("member-level", {"path": "/member/level"}, "caption"),
        ]),
        _data(sid, "/", {"member": member}),
        _components(sid, [
            {"id": "stats-row", "component": "Row", "children": ["points-card", "coupons-card"],
             "justify": "spaceBetween"},
            *_kpi("points", "可用积分", _number("/member/points")),
            *_kpi("coupons", "优惠券", _number("/member/coupons")),
        ]),
        _components(sid, [
            {"id": "perks-card", "component": "Card", "child": "perks-box"},
            {"id": "perks-box", "component": "Column", "children": ["perks-title", "perks-list"]},
            _text("perks-title", "本月权益", "h4"),
            {"id": "perks-list", "component": "List",
             "children": {"componentId": "perk-row", "path": "/member/perks"}},
            {"id": "perk-row", "component": "Row", "children": ["perk-dot", "perk-text"], "align": "center"},
            _text("perk-dot", "✦", "caption"),
            _text("perk-text", {"path": "/text"}),
        ]),
        _components(sid, [
            {"id": "actions", "component": "Row", "children": ["upgrade-button"], "justify": "center"},
            *_button("upgrade-button", "升级会员", {"name": "upgradeMembership", "context": {
                "level": {"path": "/member/level"}}}, "primary"),
        ]),
    ]


def _short_title(prompt):
    text = re.sub(r"[，,。；;！!？?\n].*", "", (prompt or "").strip())
    text = text.strip() or "智能概览"
    return text[:18]


def _generic_scene(sid, prompt):
    title = _short_title(prompt)
    note = (prompt or "根据需求生成的结构化界面").strip()[:120]
    steps = [
        {"text": "明确目标与成功标准"},
        {"text": "拆解关键任务与负责人"},
        {"text": "上线后持续观察数据"},
    ]
    return title, "根据自然语言需求生成的通用概览页", [
        _create(sid),
        _components(sid, [
            {"id": "root", "component": "Column", "children": ["hero", "overview-card", "footer"]},
            {"id": "hero", "component": "Column", "children": ["page-title", "page-sub"]},
            _text("page-title", title, "h1"),
            _text("page-sub", note, "caption"),
        ]),
        _data(sid, "/", {"overview": {"headline": title, "note": note, "steps": steps}}),
        _components(sid, [
            {"id": "overview-card", "component": "Card", "child": "overview-box"},
            {"id": "overview-box", "component": "Column", "children": ["overview-title", "divider-1", "steps-list"]},
            _text("overview-title", "建议的三步执行路径", "h4"),
            {"id": "divider-1", "component": "Divider"},
            {"id": "steps-list", "component": "List",
             "children": {"componentId": "step-row", "path": "/overview/steps"}},
            {"id": "step-row", "component": "Row", "children": ["step-dot", "step-text"], "align": "center"},
            _text("step-dot", "→", "caption"),
            _text("step-text", {"path": "/text"}),
        ]),
        _components(sid, [
            {"id": "footer", "component": "Row", "children": ["footer-hint", "continue-button"],
             "justify": "spaceBetween", "align": "center"},
            _text("footer-hint", "可以继续用自然语言细化这个界面", "caption"),
            *_button("continue-button", "继续完善", {"name": "refineScene", "context": {
                "headline": {"path": "/overview/headline"}}}, "primary"),
        ]),
    ]


def local_scene(prompt, surface_id=None):
    sid = surface_id or DEFAULT_SURFACE
    text = (prompt or "").strip()
    low = text.lower()
    if any(k in low for k in ("会员", "积分", "优惠券", "咖啡", "coffee", "member")):
        title, summary, messages = _membership_scene(sid)
    elif any(k in low for k in ("登录", "注册", "密码", "账号", "login", "sign in")):
        title, summary, messages = _login_scene(sid)
    elif any(k in low for k in ("商品", "产品", "价格", "购物车", "购买", "耳机", "product")):
        title, summary, messages = _product_scene(sid)
    elif any(k in low for k in ("设置", "偏好", "通知", "深色", "setting")):
        title, summary, messages = _settings_scene(sid)
    elif any(k in low for k in ("待办", "任务", "清单", "todo", "task")):
        title, summary, messages = _todo_scene(sid)
    elif any(k in low for k in ("个人", "资料", "头像", "profile")):
        title, summary, messages = _profile_scene(sid)
    elif any(k in low for k in ("看板", "仪表盘", "销售", "订单", "统计", "dashboard", "报表")):
        title, summary, messages = _dashboard_scene(sid)
    else:
        title, summary, messages = _generic_scene(sid, text)
    errors, warnings = validate_messages(messages, sid)
    if errors:
        warnings = warnings + ["本地场景自检未通过：" + item for item in errors]
    return GenerationResult(
        title=title, summary=summary, messages=messages,
        provider="local-rules", warnings=warnings, surface_id=sid,
    )


# ------------------------------------------------------------------ validation

def normalize_messages(raw, surface_id=DEFAULT_SURFACE):
    if isinstance(raw, dict):
        if isinstance(raw.get("messages"), list):
            source = raw["messages"]
        elif any(isinstance(raw.get(op), dict) for op in OPERATIONS):
            source = [raw]
        else:
            source = []
    elif isinstance(raw, list):
        source = raw
    else:
        source = []
    result = []
    for item in source:
        if not isinstance(item, dict):
            continue
        message = json.loads(json.dumps(item))
        message.setdefault("version", "v0.9")
        for op in OPERATIONS:
            body = message.get(op)
            if isinstance(body, dict):
                body.setdefault("surfaceId", surface_id)
        result.append(message)
    return result


_PLACEHOLDER_RE = re.compile(r"\$\s*\{(\/[^}]*)\}")
_EXACT_PLACEHOLDER_RE = re.compile(r"^\s*\$\s*\{(\/[^}]*)\}\s*$")


def _canonicalize_strings(value):
    """Recursively rewrite "$ {/path}" into the canonical "${/path}"."""
    changed = False
    if isinstance(value, str):
        new = _PLACEHOLDER_RE.sub(lambda m: DOLLAR + "{" + m.group(1) + "}", value)
        return new, new != value
    if isinstance(value, list):
        for index, item in enumerate(value):
            new, item_changed = _canonicalize_strings(item)
            if item_changed:
                value[index] = new
                changed = True
        return value, changed
    if isinstance(value, dict):
        for key in list(value.keys()):
            new, item_changed = _canonicalize_strings(value[key])
            if item_changed:
                value[key] = new
                changed = True
        return value, changed
    return value, False


def _coerce_text_binding(item):
    """Turn a Text value containing ${/path} into a proper data binding."""
    if item.get("component") != "Text":
        return False
    text = item.get("text")
    if not isinstance(text, str) or DOLLAR + "{" not in text:
        return False
    exact = _EXACT_PLACEHOLDER_RE.match(text)
    if exact:
        item["text"] = {"path": exact.group(1)}
    else:
        item["text"] = {"call": "formatString", "args": {"value": text}}
    return True


def _coerce_surface(messages, surface_id):
    warnings = []
    ids = set()
    for message in messages:
        for op in OPERATIONS:
            body = message.get(op)
            if isinstance(body, dict):
                sid = body.get("surfaceId")
                if isinstance(sid, str) and sid.strip():
                    ids.add(sid.strip())
    if len(ids) == 1 and ids != {surface_id}:
        old = next(iter(ids))
        for message in messages:
            for op in OPERATIONS:
                body = message.get(op)
                if isinstance(body, dict) and body.get("surfaceId") == old:
                    body["surfaceId"] = surface_id
        warnings.append("已将 surfaceId 从 " + old + " 纠正为 " + surface_id)
    for message in messages:
        body = message.get("createSurface")
        if isinstance(body, dict):
            if not body.get("catalogId"):
                body["catalogId"] = CATALOG
            elif body.get("catalogId") != CATALOG:
                body["catalogId"] = CATALOG
                warnings.append("已把 catalogId 纠正为 Basic Catalog")
    for message in messages:
        body = message.get("updateComponents")
        if not isinstance(body, dict):
            continue
        items = body.get("components")
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict) or item.get("component") != "List":
                continue
            if isinstance(item.get("children"), dict):
                continue
            template_id = item.get("componentId")
            list_path = item.get("path")
            if isinstance(template_id, str) and template_id.strip() and isinstance(list_path, str) and list_path.startswith("/"):
                item["children"] = {"componentId": template_id.strip(), "path": list_path}
                item.pop("componentId", None)
                item.pop("path", None)
                warnings.append("已将 List 的 componentId/path 规范化为 children 对象")

    placeholder_fixed = False
    for message in messages:
        _, changed = _canonicalize_strings(message)
        placeholder_fixed = placeholder_fixed or changed
        body = message.get("updateComponents")
        if not isinstance(body, dict):
            continue
        items = body.get("components")
        if not isinstance(items, list):
            continue
        for item in items:
            if isinstance(item, dict) and _coerce_text_binding(item):
                placeholder_fixed = True
    if placeholder_fixed:
        warnings.append("已将 $ {/path} 占位符规范化为 ${/path} 数据绑定")
    return warnings


def _validate_component(item, where, errors, warnings):
    component = item.get("component")
    if component not in ALLOWED_COMPONENTS:
        errors.append(where + " 使用了不支持的组件: " + str(component))
        return
    if component == "Text":
        if "text" not in item:
            errors.append(where + " 的 Text 缺少 text")
        variant = item.get("variant")
        if variant is not None and variant not in TEXT_VARIANTS:
            warnings.append(where + " 的 Text.variant 不受支持: " + str(variant))
    elif component == "Card":
        if not isinstance(item.get("child"), str) or not item.get("child"):
            errors.append(where + " 的 Card 需要 child 字符串")
    elif component == "Button":
        if not isinstance(item.get("child"), str) or not item.get("child"):
            errors.append(where + " 的 Button 需要 child 字符串")
        variant = item.get("variant")
        if variant is not None and variant not in BUTTON_VARIANTS:
            warnings.append(where + " 的 Button.variant 不受支持: " + str(variant))
    elif component in ("Column", "Row", "List"):
        children = item.get("children")
        if children is None:
            warnings.append(where + " 没有 children，渲染为空")
        elif isinstance(children, list):
            for ref in children:
                if not isinstance(ref, str) or not ref:
                    errors.append(where + " 的 children 必须是组件 id 字符串数组")
                    break
        elif isinstance(children, dict):
            if not isinstance(children.get("componentId"), str) or not children.get("componentId"):
                errors.append(where + " 的 List 模板缺少 componentId")
            path = children.get("path")
            if not isinstance(path, str) or not path.startswith("/"):
                errors.append(where + " 的 List 模板 path 必须是 / 开头的 JSON Pointer")
        else:
            errors.append(where + " 的 children 必须是数组或 {componentId, path} 对象")
    elif component == "Slider":
        for key in ("min", "max"):
            if key in item and not isinstance(item.get(key), (int, float)):
                warnings.append(where + " 的 " + key + " 不是数字")


def _check_tree(components, errors, warnings):
    if "root" not in components:
        errors.append('最终组件树缺少 id="root" 的根组件')
        return
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


def validate_messages(messages, surface_id=None):
    errors = []
    warnings = []
    if not isinstance(messages, list) or not messages:
        return ["messages 必须是非空数组"], warnings
    if not isinstance(messages[0], dict) or "createSurface" not in messages[0]:
        errors.append("第一条消息必须是 createSurface")
    created = set()
    surfaces = set()
    components = {}
    for index, message in enumerate(messages):
        label = "第 " + str(index + 1) + " 条消息"
        if not isinstance(message, dict):
            errors.append(label + "不是 JSON 对象")
            continue
        if message.get("version") != "v0.9":
            errors.append(label + ' 的 version 必须是 "v0.9"')
        ops = [op for op in OPERATIONS if op in message]
        if len(ops) != 1:
            errors.append(label + " 必须且只能包含一个操作，当前为 " + (", ".join(ops) or "无"))
            if not ops:
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
            surfaces.add(sid)
            if surface_id and sid != surface_id:
                errors.append(label + " 的 surfaceId 应为 " + surface_id + "，实际为 " + sid)
        if op == "createSurface":
            if index != 0:
                errors.append("createSurface 必须是第一条消息")
            if sid in created:
                errors.append("重复的 createSurface: " + sid)
            created.add(sid)
            if body.get("catalogId") != CATALOG:
                errors.append("catalogId 必须为 " + CATALOG)
        elif op == "updateComponents":
            if sid not in created:
                errors.append(label + " 在 createSurface 之前更新了组件")
            items = body.get("components")
            if not isinstance(items, list) or not items:
                errors.append(label + " 的 components 必须是非空数组")
                continue
            seen = set()
            for item_index, item in enumerate(items):
                where = label + " 第 " + str(item_index + 1) + " 个组件"
                if not isinstance(item, dict):
                    errors.append(where + " 不是对象")
                    continue
                cid = item.get("id")
                if not isinstance(cid, str) or not cid.strip():
                    errors.append(where + " 缺少 id")
                    continue
                cid = cid.strip()
                if cid in seen:
                    errors.append(label + " 内组件 id 重复: " + cid)
                seen.add(cid)
                _validate_component(item, where, errors, warnings)
                components[cid] = item
        elif op == "updateDataModel":
            if sid not in created:
                errors.append(label + " 在 createSurface 之前更新了数据")
            path = body.get("path")
            if path is not None and not (isinstance(path, str) and path.startswith("/")):
                errors.append(label + " 的 path 必须是 JSON Pointer（以 / 开头）")
            if "value" not in body:
                warnings.append(label + " 没有 value，将被视为删除该路径")
        elif op == "deleteSurface":
            created.discard(sid)
    if len(surfaces) > 1:
        errors.append("一次只能生成一个 surface，当前为: " + ", ".join(sorted(surfaces)))
    _check_tree(components, errors, warnings)
    if len(messages) < 4:
        warnings.append("消息条数偏少（" + str(len(messages)) + " 条），流式效果不明显")
    if len(messages) > 14:
        warnings.append("消息条数偏多（" + str(len(messages)) + " 条）")
    return errors, warnings


# ------------------------------------------------------------------------ llm

SYSTEM_PROMPT = """你是 A2UI v0.9 界面生成器。根据用户的中文需求，生成一组可以逐条下发给 Android 客户端渲染的界面消息。

只输出一个 JSON 对象，不要 Markdown 代码块，不要解释，不要注释。输出格式：
{"title":"界面标题","summary":"一句话说明","messages":[ ... ]}

每条消息必须有 "version":"v0.9"，并且只能包含下面四个操作键中的一个：
1. {"version":"v0.9","createSurface":{"surfaceId":"web_console","catalogId":"https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"}}
2. {"version":"v0.9","updateComponents":{"surfaceId":"web_console","components":[组件...]}}
3. {"version":"v0.9","updateDataModel":{"surfaceId":"web_console","path":"/a","value":任意 JSON}}
4. {"version":"v0.9","deleteSurface":{"surfaceId":"web_console"}}

硬性规则：
1. 第一条必须是 createSurface，整个场景只允许一个 surface，surfaceId 固定为 web_console。
2. 最终合并后的组件必须有 id="root"；所有 child / children 引用的 id 都必须在最终组件集合中存在。
3. 只允许这些组件：Text, Column, Row, Card, Button, TextField, CheckBox, Slider, Divider, Image, Icon, List。
4. Text：{"id":"x","component":"Text","text":"文案或{\"path\":\"/x\"}","variant":"h1|h2|h3|h4|h5|caption|body"}。
5. Column / Row：{"children":["id1","id2"]}，可选 "justify":"start|center|end|spaceBetween|spaceAround|spaceEvenly" 与 "align":"start|center|end"。
6. Card：{"child":"id"}，只包一个子组件；Button：{"child":"文本id","variant":"primary|default|borderless","action":{"event":{"name":"动作名","context":{"字段":{"path":"/x"}}}}}。
7. List 模板：{"componentId":"模板id","path":"/数组路径"}；模板内部一律使用相对路径，例如 {"path":"/name"}，不要写绝对路径。
8. TextField：{"label":"...","value":{"path":"/x"},"variant":"shortText|longText|number|obscured"}；CheckBox：{"label":"...","value":{"path":"/x"}}；Slider：{"label":"...","min":0,"max":1,"value":{"path":"/x"}}。
9. Image：{"description":"图片说明","url":""}；Icon：{"name":"star|check|add|search|info|favorite"}。
10. 数据统一放在 updateDataModel 的 value 中，path 使用 JSON Pointer。
11. 金额展示用 {"call":"formatCurrency","args":{"value":{"path":"/price"},"currency":"CNY"}}；数字用 {"call":"formatNumber","args":{"value":{"path":"/count"}}}；字符串拼接用 {"call":"formatString","args":{"value":"..."}}，其中路径占位符由美元符号和花括号组成，写成 $ 紧跟 {/path}。
12. 一个界面生成 6 到 10 条消息：先 createSurface，再骨架 updateComponents，再 updateDataModel，再补全组件与数据，方便客户端流式渲染。
13. 数据必须具体、贴合用户需求；禁止 TODO、占位符、Lorem ipsum 和空数组。
14. 组件 id 全局唯一；列表模板内的字段名（如 name、amount）不要和顶层 KPI 的组件 id 重名。
15. 不要输出 A2UI 之外的组件或属性，不要输出 null 组件。
"""


def _thinking_payload(settings):
    override = os.environ.get("A2UI_LLM_THINKING", "").strip().lower()
    if override in ("disabled", "enabled"):
        return {"type": override}
    if override in ("", "auto"):
        haystack = (settings["base_url"] + " " + settings["model"]).lower()
        if "ark.cn-beijing" in haystack or "volces" in haystack or "deepseek" in haystack:
            return {"type": "disabled"}
    return None


def _chat(messages, settings, timeout=120):
    url = settings["base_url"] + "/chat/completions"
    payload = {
        "model": settings["model"],
        "messages": messages,
        "temperature": 0.35,
        "max_tokens": int(os.environ.get("A2UI_LLM_MAX_TOKENS", "8000")),
        "stream": False,
    }
    thinking = _thinking_payload(settings)
    if thinking is not None:
        payload["thinking"] = thinking
    request = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": "Bearer " + settings["api_key"],
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            detail = exc.read().decode("utf-8", "replace")[:300]
        except Exception:
            pass
        raise RuntimeError("模型接口 HTTP " + str(exc.code) + ": " + detail)
    except urllib.error.URLError as exc:
        raise RuntimeError("无法连接模型接口: " + str(exc.reason))
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        raise RuntimeError("模型接口返回了非 JSON 内容")
    choices = data.get("choices")
    if not isinstance(choices, list) or not choices:
        raise RuntimeError("模型返回中没有 choices")
    message = choices[0].get("message") or {}
    content = message.get("content")
    if isinstance(content, list):
        content = "".join(part.get("text", "") for part in content if isinstance(part, dict))
    if not isinstance(content, str) or not content.strip():
        reasoning = message.get("reasoning_content")
        if isinstance(reasoning, str) and reasoning.strip():
            raise RuntimeError(
                "模型只返回了推理内容，正文被截断（finish_reason="
                + str(choices[0].get("finish_reason")) + "）；可增大 A2UI_LLM_MAX_TOKENS 或关闭 thinking"
            )
        raise RuntimeError("模型返回内容为空")
    return content


def _extract_json(text):
    text = text.strip()
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fenced:
        text = fenced.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        try:
            return json.loads(text[start:end + 1])
        except json.JSONDecodeError as exc:
            raise RuntimeError("JSON 解析失败: " + str(exc))
    raise RuntimeError("模型输出里没有 JSON 对象")


def _llm_scene(prompt, surface_id):
    settings = model_settings()
    system = SYSTEM_PROMPT + "\n固定 surfaceId: " + surface_id + "\n固定 catalogId: " + CATALOG
    history = [
        {"role": "system", "content": system},
        {"role": "user", "content": prompt},
    ]
    last_error = "未知错误"
    for _ in range(2):
        content = _chat(history, settings)
        try:
            payload = _extract_json(content)
        except RuntimeError as exc:
            last_error = str(exc)
            history.append({"role": "assistant", "content": content[:3000]})
            history.append({"role": "user", "content": "上面的输出不是合法 JSON（" + last_error + "）。请修复并只输出完整 JSON 对象。"})
            continue
        if not isinstance(payload, dict):
            last_error = "顶层必须是 JSON 对象"
            history.append({"role": "assistant", "content": content[:3000]})
            history.append({"role": "user", "content": "顶层必须是 JSON 对象，请重新输出。"})
            continue
        title = str(payload.get("title") or _short_title(prompt)).strip()[:60] or _short_title(prompt)
        summary = str(payload.get("summary") or "").strip()[:160] or "由模型生成的界面"
        messages = normalize_messages(payload, surface_id)
        warnings = _coerce_surface(messages, surface_id)
        errors, more = validate_messages(messages, surface_id)
        warnings += more
        if not errors:
            return GenerationResult(
                title=title, summary=summary, messages=messages,
                provider="llm:" + settings["model"], warnings=warnings,
                surface_id=surface_id,
            )
        last_error = "; ".join(errors[:8])
        history.append({"role": "assistant", "content": json.dumps(payload, ensure_ascii=False)[:3000]})
        history.append({"role": "user", "content": "上面的 JSON 未通过 A2UI 校验：" + last_error + "。请修复这些问题，重新输出完整 JSON。"})
    raise RuntimeError("模型生成未通过校验：" + last_error)


def generate_scene(prompt, prefer_llm=True, surface_id=None):
    started = time.time()
    sid = surface_id or DEFAULT_SURFACE
    text = (prompt or "").strip()
    if not text:
        text = "生成一个通用概览页"
    if prefer_llm and llm_available():
        try:
            result = _llm_scene(text, sid)
        except Exception as exc:
            result = local_scene(text, sid)
            result.provider = "local-fallback"
            result.warnings = ["模型生成失败，已回退本地规则：" + str(exc)] + result.warnings
    else:
        result = local_scene(text, sid)
        if prefer_llm and not llm_available():
            result.warnings = ["未配置模型 API Key，使用本地规则生成"] + result.warnings
    result.elapsed_ms = int((time.time() - started) * 1000)
    return result


if __name__ == "__main__":
    import argparse
    import sys

    parser = argparse.ArgumentParser(description="自然语言 -> A2UI v0.9")
    parser.add_argument("prompt", nargs="?", default="设计一个项目周报看板")
    parser.add_argument("--local", action="store_true", help="只用本地规则")
    parser.add_argument("--surface", default=DEFAULT_SURFACE)
    parser.add_argument("--json", action="store_true", help="输出完整 JSON")
    args = parser.parse_args()
    result = generate_scene(args.prompt, prefer_llm=not args.local, surface_id=args.surface)
    if args.json:
        print(json.dumps(result.as_dict(), ensure_ascii=False, indent=2))
    else:
        print("title:", result.title)
        print("provider:", result.provider)
        print("messages:", len(result.messages), "elapsed:", result.elapsed_ms, "ms")
        if result.warnings:
            print("warnings:", "; ".join(result.warnings))
