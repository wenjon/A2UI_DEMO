# A2UI Android Demo · 自然语言控制台

用中文描述界面需求，生成 A2UI v0.9 JSON，实时推送到 Android 端用 Jetpack Compose 原生渲染。
**网页控制台是控制面，Android App 只是显示端。**

```
中文需求 ──► 控制台生成 ──► A2UI JSON ──► SSE 推送 ──► Android Compose 渲染
```

## 功能

- **自然语言生成**：中文描述 → 完整 A2UI 场景（AI 模式优先，失败自动回退本地规则）
- **两种目标界面**：通用界面（Basic Catalog，Compose 渲染）与 **车机 HMI（1920×1200 组装，App 端 WebView 承接）**
- **三栏工作台**：左侧写需求、中间手机预览、右侧编辑 / 校验 JSON
- **实时预览**：生成后立即用 Compose 风格画布渲染，并显示消息数与组件数
- **JSON 工作站**：格式化、压缩、校验、清空，可直接改 JSON 再推送
- **一键推送**：通过 SSE 把消息逐条发给已连接的 Android 客户端，可调节间隔
- **历史与状态**：最近 8 次生成记录、在线客户端数、最近推送时间
- **流式重放**：App 内按 450ms 间隔逐条喂消息，模拟 LLM 边生成边渲染
- **ACTION 回传**：点按钮会把 action 名和解析后的 context 打到日志

## 快速开始

### 1. 启动控制台服务

```powershell
$env:PYTHONDONTWRITEBYTECODE = "1"
python -u android-demo/server/a2ui_console_server.py --port 8787
```

- 浏览器打开：<http://127.0.0.1:8787/>
- 健康检查：`GET /health` → `{"ok":true,"clients":N}`

### 2. 把模拟器端口反代到本机

```powershell
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"   # 换成你自己的 adb 路径
& $adb -s emulator-5554 reverse tcp:8787 tcp:8787
```

### 3. App 连上实时流

App 右上区域点 **实时流**，地址保持 `http://127.0.0.1:8787/stream`，点 **连接**。
顶部出现 `LIVE` 和已接收消息数后，控制台右下角会显示在线客户端数。

### 4. 生成并推送

左侧输入需求（或用示例需求），点 **AI 生成界面** → 中间预览确认 → 右侧点 **推送到 App**。

## 页面布局

| 区域 | 作用 |
| --- | --- |
| 左栏 · 需求描述 | 输入中文需求、选择 AI / 本地规则、查看生成历史 |
| 中栏 · 实时预览 | 手机画布预览、消息数与组件数、推送状态 |
| 右栏 · JSON 工作站 | 查看 / 编辑 / 校验 / 推送消息，显示 SSE 地址 |

## 接口

```
GET  /               控制台页面
GET  /app.js         前端脚本
GET  /stream         SSE 推送（data: <单条 A2UI 消息>）
GET  /health         探活 + 在线客户端数
GET  /api/status     服务、模型、客户端、最近推送状态
GET  /api/messages   最近一次推送的场景（JSON 数组）
POST /api/generate   {prompt, preferLlm, surfaceKind, script} -> {title, provider, messages, ...}
GET  /api/hmi/scene  ?prompt=...&script=...   等价于 generate(surfaceKind=hmi)
POST /api/validate   {messages}                 -> {errors, warnings, stats}
POST /api/push       {messages, title, delayMs} -> {queued, clients, messageCount, componentCount}

# 「交给 Agent 推理」收件箱（详见下面同名小节；后台只收单，不推理）
POST /api/agent/request {text, note}  GET /api/agent/pending   GET /api/agent/all?limit=20
POST /api/agent/claim {id}            POST /api/agent/done {id, …}   POST /api/agent/fail {id, error}
POST /api/agent/clear
```

请求 / 响应均为 UTF-8 JSON；`messages` 是 A2UI v0.9 消息数组。

## 车机 HMI 场景（后台 → App）

左栏「目标界面」可以切换两种模式；**推送共用同一条 SSE（`/stream`）**，区别只在 App 侧由谁接画面：

| 模式 | 生成入口 | catalog | App 承接方 |
| --- | --- | --- | --- |
| 通用界面（默认 `surfaceKind:"basic"`） | `server/a2ui_generator.py`（AI / 本地规则） | Basic Catalog | Compose 渲染器（MainActivity → 实时流） |
| 车机 HMI（`surfaceKind:"hmi"`，1920×1200 组装） | `node demo/server/hmi-cli.ts`（确定性组装，不用模型） | HMI catalog | **`HmiViewerActivity`（WebView）** |

两条推送路线（同一后台、同一通道）：

- **Basic 场景 → Compose 渲染**：App 里「实时流」→ 连接 `http://127.0.0.1:8787/stream`，逐条边收边渲染。
- **车机 HMI 场景 → WebView 查看器**：Compose 渲染器只实现 Basic Catalog，画不了 HMI 素材；
  车机画面由 `app/src/main/java/com/example/a2uidemo/HmiViewerActivity.kt`（全屏 WebView）承接，
  它加载 demo 前端的 `?fit=1&live=1&console=http://127.0.0.1:8787` 页面，自己连控制台收消息。

后台行为：

- `POST /api/generate` 新增可选字段 `surfaceKind`（默认 `basic`，原流程一字未改）；
  `hmi` 时用 `subprocess` 调 `node demo/server/hmi-cli.ts --prompt ...`（`encoding='utf-8'`，超时 60s）。
- `hmi` 响应里 `provider = hmi-composer`，并额外带 `archetype` / `archetypeName` / `variant` / `slots` / `mapAssets` / `notes` / `hmi`；
  原有 `title` / `summary` / `messages` / `warnings` / `surfaceId` / `elapsedMs` / `messageCount` / `componentCount` 字段保持不变。
- `GET /api/hmi/scene?prompt=...&script=...`：等价于 `generate(surfaceKind=hmi)`，方便脚本直接调用。
- `POST /api/push` 逻辑不变（还是 `hub.push`）；只是校验按消息类型分流：Basic 走原 `validate_messages`，
  HMI 走 HMI 规则（HMI 组件白名单 + 结构检查），否则车机消息会被 Basic 规则误判成「不支持的组件」。
- `node` 不在 PATH 时不会崩：响应 `502 {"error":"未找到 node…","surfaceKind":"hmi"}`，通用模式照常可用。
- 启动横幅会打印 HMI 入口是否就绪（`HMI: <node 路径> -> demo/server/hmi-cli.ts (车机场景可用)`），
  另起一行报告模型写块是否就绪（启动时探一次 `<llm-base>/v1/models`，3 秒超时，探不到也不影响启动）。
- **模型写块**（可选，只有车机模式有）：请求带 `useModel:true`（或 `GET /api/hmi/scene?...&model=1`）时，
  后台改用 `node demo/server/hmi-cli.ts --model`，让本地模型写块、服务端编译纠偏；
  响应 `provider` 变成 `model:<模型名>` 或 `model→fallback`，并带 `model` / `modelScript` / `attempts` / `totalMs`。
  超时放宽到 240s。不传 `useModel` 时命令与超时跟以前一字不差。
  后台默认 `--llm-base http://127.0.0.1:8090`（本机 Strata 的 qwen3.8-flash-next）、`--llm-model qwen3.8-flash-next`，
  也可用环境变量 `A2UI_LLM_BASE` / `A2UI_LLM_MODEL`（ollama 是 `http://127.0.0.1:11434`）。
- 前端在车机模式下多一个「模型写块（本地小模型）」勾选：勾上时预览区显示 provider、模型名、模型写了哪几行、用时；
  不勾时界面与请求行为跟以前完全一样。通用（Basic）流程一字未改。

命令行用法：

```powershell
# 车机场景：生成 + 推送（走的还是同一条 SSE）
python -u android-demo/tools/console_push.py --hmi --prompt "找附近的停车场，时速 60"
python -u android-demo/tools/console_push.py --hmi --prompt "车控面板" --script "CARD 座舱温度 主驾 22"
python -u android-demo/tools/console_push.py --hmi-model --prompt "找附近的停车场，时速 60"   # 让本地模型写块，后台纠偏

# 一键把车机预览推到 MuMu：reverse tcp:8787 / tcp:5173 + 横屏 + 打开 HmiViewerActivity
python -u android-demo/tools/hmi_live_viewer.py
python -u android-demo/tools/hmi_live_viewer.py --prompt "导航去万达广场，剩余 3 公里 12 分钟"   # 顺便生成并推送
python -u android-demo/tools/hmi_live_viewer.py --print-only      # 只打印将要执行的 adb 命令
python -u android-demo/tools/hmi_live_viewer.py --device emulator-5554 --adb "D:\platform-tools\adb.exe"
```

控制台 UI 在 HMI 模式下的变化（通用模式一切照旧）：

- 「目标界面」两个按钮：**通用界面（Basic Catalog）** / **车机 HMI（1920×1200 组装）**；生成请求带 `surfaceKind:"hmi"`。
- 示例需求换成车机示例（找车位 / 导航去商场 / 车控面板 / 2D 找车位），生成按钮变「组装车机场景」。
- 中间「实时预览」的手机框换成 **16:10 横屏框**（纯 CSS，不真渲染 HMI 素材，只标出画面比例与槽位）。
- 右栏「JSON 工作台」上方出现原型条：原型名（如 找车位 / parking）+ 槽位（status / hud / gauge / buttons / dash）+ 地图素材。
- 「推送到 App」按钮、间隔、SSE 地址都不变；推送后提示「车机画面在 HmiViewerActivity（WebView）里」。

## 交给 Agent 推理（收件箱）

**后台在这个分支里不推理，也不生成。** 网页上点「⇢ 交给 Agent（这个会话来推理）」只是把 Prompt 里的场景描述
收进收件箱（`status:"pending"`）；真正写块的是 DeepSeek Harness 会话里的 Agent：它捞单、推理出块脚本，
再自己调生成和推送。没勾「模型写块」时这条分支后台连 `/api/generate` 都不会碰，一条消息也不生成、不推送。

```
网页输入 ─► POST /api/agent/request            进收件箱（待捞 pending）
Harness 会话里的 Agent ─► GET /api/agent/pending ─► POST /api/agent/claim（置 working，防两边同时捞）
                        ─► 推理出场景描述 + 块脚本（SCREEN / MODE / POI / CARD …）
                        ─► POST /api/generate {"prompt":…,"surfaceKind":"hmi","script":"…"}
                        ─► POST /api/push     {"messages":[…],"title":"…"}
                        ─► POST /api/agent/done（provider / 原型名 / 组件数 / 块原文 记进 result）
```

接口（同一个 Handler、同样的 JSON 风格，错误一律 `{"error": "..."}`，CORS 头照旧由 `end_headers()` 注入）：

| 接口 | 一行说明 |
| --- | --- |
| `POST /api/agent/request` | `{text:"场景描述", note?:字符串}` -> 新记录 `{id, text, note, status:"pending", createdAt, updatedAt, result:null}`；`text` 去掉首尾空白后为空 -> 400 |
| `GET /api/agent/pending` | `{"items":[…]}`，只含 `status=="pending"`，按 `createdAt` 升序 |
| `GET /api/agent/all?limit=20` | 最近记录（各种 status 都有），新的在前：`{"items":[…], "count":N, "limit":N}`（`limit` 1–200） |
| `POST /api/agent/claim` | `{id}` -> `status:"working"` + `claimedAt`；找不到 id -> 404；已经被捞走 -> 409 |
| `POST /api/agent/done` | `{id, provider, archetypeName, componentCount, title, blocks, notes?}` -> `status:"done"`，摘要存进 `result`（`blocks` 是 Agent / 模型写的块原文） |
| `POST /api/agent/fail` | `{id, error}` -> `status:"failed"`、`result.error` |
| `POST /api/agent/clear` | 只删 `done` / `failed`（`pending` / `working` 保留），返回 `{"ok":true,"removed":N,"agent":{…}}` |
| `GET /api/status` | 多一个 `agent` 字段：`{pending, working, latest, items, done, failed, total, file}`（`items` 是最近 8 条摘要，`text` 截到 220 字、不带 `blocks`）；**原有字段一个没动、没改名**，Basic 流程照旧 |

`id` 形如 `ag-<毫秒时间戳 hex>-<4 位随机 hex>`（例：`ag-1969c8e0a1f-4b7c`），短、可打印、撞上了会重取。

会话里的 Agent 侧有现成搬运工具 `android-demo/tools/console_agent_loop.py`（只做搬运，推理仍是 Agent 干的）：

```powershell
python -u android-demo/tools/console_agent_loop.py --list                       # 看待捞的场景描述
python -u android-demo/tools/console_agent_loop.py --request "市区堵车，快没电了，就近找停车场充电"   # 命令行模拟网页输入
python -u android-demo/tools/console_agent_loop.py --claim-next                 # 捞最早一条，置 working
python -u android-demo/tools/console_agent_loop.py --submit ag-… --blocks-file blocks.txt   # 生成 + 推送 + 标 done
python -u android-demo/tools/console_agent_loop.py --fail ag-… --error "素材名不认识"
python -u android-demo/tools/console_agent_loop.py --clear                      # 清掉已处理/失败的
```

`--submit` 内部就是上面那三步：读这条请求的原文 → `POST /api/generate`（`surfaceKind:"hmi"` + `script`）→ `POST /api/push` → `POST /api/agent/done`；加 `--no-push` 只生成不推。

持久化：`console/agent-inbox.jsonl`，一行一条 JSON（UTF-8）。所有读写都过 `threading.Lock`
（服务是 `ThreadingHTTPServer`）；正常路径**只追加写**、不整文件重写，同一个 id 后写的那行覆盖先写的那行，
所以中途崩了也不会把状态退回旧值。启动时读回来：文件不存在不报错，坏行（非法 JSON / 没有 id）跳过不崩。
只有 `/api/agent/clear` 会把留下的记录 compact 回文件（写临时文件 + `os.replace`，失败就不动内存）。

前端（**只在车机 HMI 模式出现，通用（Basic）模式的界面和行为一字未改**）：

- 「模型写块（本地小模型）」勾选下面多一行：**「⇢ 交给 Agent（这个会话来推理）」** 和小按钮 **「清空已处理」**。
- 点它只 `POST /api/agent/request`（用的就是 HMI Prompt 输入框里的文本），**不会**自动调 `/api/generate`；
  弹提示「已进收件箱 · 没有生成、没有推送 —— 去 Harness 会话里说一句『看下后台』我就去捞 · ag-…」。
- 收件箱状态区数据来自 `/api/status` 的 `agent` 字段，复用现有 3 秒轮询（没加新定时器）：
  `待捞 N`（· 处理中 M）、`Agent 处理中`、`已生成：<原型名> · <N> 件 · <provider>`、`失败：<原因>`。
- 「清空已处理」调 `POST /api/agent/clear`，只清 `done` / `failed`。

命令行收单（跟 `--prompt` / `--last` / `--hmi` / `--script` / `--no-push` 互斥，带了就只收单、不生成不推送）：

```powershell
python -u android-demo/tools/console_push.py --agent-request "现在市区堵车，快没电了，就近找停车场充电"
# 已进收件箱：ag-… · status=pending · 11:31:02
#   · 后台没有生成、没有推理、也没有推送。下一步：在 Harness 会话里说「看下后台」…
```

会话里的 Agent 侧（python `urllib` 或 curl 都行）完整一轮：

```powershell
$b = "http://127.0.0.1:8787"
# 1. 捞单：GET $b/api/agent/pending  ->  POST $b/api/agent/claim  {"id":"ag-…"}
# 2. 推理出块后生成：POST $b/api/generate {"prompt":"…","surfaceKind":"hmi","script":"SCREEN 主屏\nMODE 3D\nPOI 停车场 …"}
# 3. 推送：      POST $b/api/push   {"messages":[…],"title":"低电找桩"}
# 4. 标已处理：  POST $b/api/agent/done {"id":"ag-…","provider":"hmi-composer","archetypeName":"找车位",
#                                        "componentCount":38,"title":"低电找桩","blocks":"SCREEN 主屏\n…","notes":["…"]}
#    （生成或推送失败就 POST $b/api/agent/fail {"id":"ag-…","error":"…"}）
# 5. 可选清场：  POST $b/api/agent/clear
```

## AI 模式与回退

- 默认走 **AI 生成**，会读取环境里的模型配置；界面顶部显示实际 provider。
- 模型不可用、超时或返回格式不合法时，自动回退到**本地规则生成**，不会中断使用。
- 模型偶尔会输出 `List` 的 `componentId/path` 写法，服务端会规范化为 `children` 模板。
- 生成后自动跑一遍校验；有错误时右栏会标红，修正后再推送。

## 支持的组件与绑定

- 组件：`Text` `Column` `Row` `Card` `Button` `TextField` `CheckBox` `Slider` `Divider` `Image` `Icon` `List`
- 数据绑定：JSON Pointer（`/path`）、静态 `children`、模板对象 `{componentId, path}`
  （列表模板写作 `{componentId, path, item}`，标量项直接使用 item）
- 函数：`formatCurrency` / `formatNumber` / `pluralize` / `formatString`

## 车机预览（把 demo 网页 HMI 直接铺到模拟器上）

Compose 渲染器只实现 Basic Catalog，画不了 HMI 那套素材；所以车机画面走 `HmiViewerActivity`：
一个全屏 WebView，加载 `demo` 的 `?fit=1` 模式（只留画面、1920×1200 按宽高同时等比缩放、黑边居中）。

```powershell
$adb = "adb"   # MuMu 自带 adb，或写成 SDK 里 platform-tools\adb.exe 的完整路径
& $adb devices                                             # MuMu 通常是 127.0.0.1:7555

# 1. 起前端（必须监听 127.0.0.1，adb reverse 打的是本机回环）
cd demo
npx vite --host 127.0.0.1 --port 5173

# 2. 端口反代到模拟器
& $adb -s 127.0.0.1:7555 reverse tcp:5173 tcp:5173

# 3. 转横屏（MuMu 900x1600 -> 1600x900）
& $adb -s 127.0.0.1:7555 shell "settings put system accelerometer_rotation 0; settings put system user_rotation 1"

# 4. 打开车机页（默认 42_hmi-cockpit-assets）
& $adb -s 127.0.0.1:7555 shell "am start -n com.example.a2uidemo/.HmiViewerActivity"
# 换示例
& $adb -s 127.0.0.1:7555 shell "am force-stop com.example.a2uidemo"
& $adb -s 127.0.0.1:7555 shell "am start -n com.example.a2uidemo/.HmiViewerActivity --es url 'http://127.0.0.1:5173/?example=41_hmi-navigation-2d.json&fit=1'"

# 5. 截图 / 看页面控制台
& $adb -s 127.0.0.1:7555 shell "screencap -p /sdcard/Download/hmi.png"
& $adb -s 127.0.0.1:7555 pull /sdcard/Download/hmi.png hmi-mumu.png
& $adb -s 127.0.0.1:7555 logcat -d -s A2uiHmi:V
```

点热区会真的发 A2UI action（页面里的 action 同时打到 `console.log`，logcat 能看到）：

```powershell
& $adb -s 127.0.0.1:7555 shell "input tap 1381 855"     # 音量热区（素材坐标 1710,1084，缩放 0.75 + 左边黑边 80）
& $adb -s 127.0.0.1:7555 logcat -d -s A2uiHmi:V | Select-String 'a2ui action'
# [a2ui action] set_volume ctl3
```

浏览器里也能直接用 `?fit=1`：`http://127.0.0.1:5173/?fit=1`。

## 编译 / 安装 App

```powershell
# 需要 JDK 17+（先设置好 JAVA_HOME）
cd android-demo
./gradlew assembleDebug            # 首次构建会拉依赖

$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"   # 换成你自己的 adb 路径
& $adb -s emulator-5554 install -r "app\build\outputs\apk\debug\app-debug.apk"
& $adb -s emulator-5554 shell am start -n com.example.a2uidemo/.MainActivity
```

若提示 `INSTALL_FAILED_UPDATE_INCOMPATIBLE`，说明 debug 签名变了，先 `adb uninstall com.example.a2uidemo` 再安装。

## 目录

```
android-demo/
├─ console/              网页控制台（index.html + app.js）+ agent-inbox.jsonl（Agent 收件箱，运行时生成）
├─ server/
│  ├─ a2ui_console_server.py   控制台 HTTP + SSE 服务（含车机 HMI 入口 surfaceKind=hmi）
│  ├─ a2ui_generator.py        AI / 本地规则生成 + 校验
│  └─ a2ui_stream_server.py    纯演示用逐条下发服务
├─ tools/
│  ├─ console_push.py          命令行生成 / 推送（--hmi 走车机 HMI 模式；--agent-request 只进 Agent 收件箱）
│  └─ hmi_live_viewer.py       一键车机预览（adb reverse + 横屏 + HmiViewerActivity）
└─ app/src/main/.../       Compose 渲染器（A2uiCore / A2uiCompose / StreamClient）+ HmiViewerActivity
```

## 已知限制

- 只实现 Basic Catalog 的子集，没有 HMI catalog（车机场景的 HMI 消息由上面的 `HmiViewerActivity` WebView 渲染，Compose 渲染器收到 HMI 组件不会画）
- `Image` 是渐变占位，不加载网络图片
- 按钮 action 只在 App 日志 / 控制台提示，不回传后端
- `formatString` 只支持简单的 `${/path}`，不支持嵌套函数
- 忽略 validation / checks / theme / accessibility / `sendDataModel`
