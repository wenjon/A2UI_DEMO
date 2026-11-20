# A2UI 本地模型 Demo

在官方 Basic Catalog Gallery 上接了一条本地小模型链路：

```text
自然语言
  -> qwen3.5:4b（flm / OpenAI 兼容接口）
  -> 扁平语义块（TITLE / FIELD / BUTTON …，车机模式是 SPEED / NAV / POI / CARD …）
  -> 服务端确定性编译（车机模式：原型 → 槽位 → 部件级组装）
  -> A2UI v0.9 消息
  -> 校验与自动修复
  -> A2uiSurface 渲染
```

## 为什么不让 4B 直接输出 A2UI JSON

实测 4B 直接生成完整组件树时，容易出现单引号、漏括号、属性丢失、引用不存在的
组件等问题。即使开启 `response_format: json_object`，也只能保证“是 JSON”，不能保证
符合 A2UI 的组件和引用约束。

所以默认模式是 **语义块**：模型只负责理解需求并写少量扁平行，组件选择、数据绑定、
组件 ID、初始值和 action 结构由服务端生成。最终页面仍然是标准 A2UI v0.9 JSON。

“直出 JSON”模式保留在界面上，仅用于对比实验，不作为默认链路。

## 启动

先启动本地模型：

```powershell
flm serve qwen3.5:4b --port 8000 --host 127.0.0.1 --ctx-len 32768
```

再启动前端：

```powershell
cd demo
npm install
npm run dev
```

打开 http://127.0.0.1:5173 。右上角会显示模型连接状态；输入需求后点击“生成界面”，
或者按 `Ctrl + Enter`。

可用环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `A2UI_LLM_BASE` | `http://127.0.0.1:8000` | OpenAI 兼容接口地址 |
| `A2UI_LLM_MODEL` | `qwen3.5:4b` | 模型名 |
| `A2UI_LLM_TIMEOUT_MS` | `180000` | 单次请求超时 |

## 语义块语法

```text
TITLE 文案
SUBTITLE 文案
TEXT 文案
CAPTION 文案
IMAGE URL
ICON 图标名
DIVIDER

FIELD 标签 字段名 [password|number|long]
CHECK 标签 字段名
SELECT 标签 字段名 选项1|选项2
SLIDER 标签 字段名 最大值
DATE 标签 字段名 [date|time|datetime]
BUTTON 文案 动作名
```

示例：

```text
TITLE 账号登录
FIELD 邮箱 email
FIELD 密码 password password
CHECK 记住我 remember
BUTTON 登录 login
```

服务端会把 `email`、`password`、`remember` 变成 A2UI 数据绑定和初始数据模型；
点击按钮时 action 回调会带上当前表单值。

## 车机 HMI 模式（拆解 → 槽位 → 组装）

`mode: "hmi"`。4B 只写车机上要变的那几行，画面由服务端按素材注册表**组装**出来：

```text
拆解   52 个原稿素材 + 74 个细粒度部件（group:"parts"）→ 注册表 demo/shared/hmi-registry.json（126 条目 + 10 个带 capacity 的槽位）
槽位   需求文本 → 原型（navigation / parking / media / climate / arrival）→ 该界面该有哪些槽位、地图画哪些覆盖物
组装   槽位 → HmiAsset + HmiText + HmiHotspot + HmiPanel（root.assembly = "composed"）
```

界面默认由部件拼出来，不再是 8 个烧死文字的整块挂件；`MODE 整块` 可以整条回退到原稿挂件（`root.assembly = "panel"`）。
状态栏、导航卡、路线条、时速表、地图按钮组、缩放控件、路线进度条、底部车控栏，以及地图覆盖物（路线 / POI / 定位标）默认就组装好，模型不用写，只有要改动时才用 `HIDE` / `SHOW` / `CARD` / `ICON` 点名。

### 车机语义块

```text
SCREEN 3d|2d|bare|panel|composed [原型名]   视角 / 无挂件 / 组装方式 / 界面原型
MODE 组装|整块                              部件级组装（默认）或回退到 8 个整块挂件
SPEED 数字                                 时速表数字
NAV 距离 动作 路名                           例：NAV 1.2公里后 右转 中山北路
ROUTE 公里 分钟                            路线剩余信息
STATUS 文案                                状态栏时钟（组装时是活字；整块模式在原时钟位置盖一层活字）
POI 名称 [素材名] [x y [宽 高]]              地图兴趣点（中文名会映射到素材 key）
MAP 素材名 [x y 宽 高]                      放注册表里任意素材 / 拆解部件
CONTROL 素材名 [动作名] [文案]               把某个素材变成可点击热区
LABEL 文案 x y [字号]                       在 1920×1200 画布上自己写一行字
HIDE 挂件名                                摘掉一个槽位（例：HIDE 缩放）
SHOW 挂件名                                把原型里没有的槽位加回来（例：SHOW 进度条）
CARD 标题 正文                              在 HUD 区新加一张卡（面板 + 标题 + 正文 + 热区）
ICON 素材名                                 按注册表坐标放一个素材（中文名走别名）
```

- 别名照旧有效：`VIEW/CANVAS/屏幕→SCREEN`、`时速→SPEED`、`导航→NAV`、`剩余→ROUTE`、`按钮/BUTTON→CONTROL`、`文字/TEXT→LABEL`、`隐藏→HIDE`、`显示→SHOW`、`卡片→CARD`、`图标→ICON`、`组装/LAYOUT→MODE`；
- 中文控件名有别名：`音量→volume`、`电话→phone`、`音乐→music`、`座椅/主驾→seat-driver`、`副驾→seat-passenger`、`温度→temp-driver`、`风扇→fan-level`、`加热→heater`、`除霜→defrost`、`车型→vehicle-model3`；POI 同理（`停车场→poi-parking-3d`、`商场→poi-mall-3d`、`公园→poi-garden-3d`）；
- 素材名不在注册表里会被换成同类素材并给出 warning，不会渲染出空图；`POI`/`MAP` 给了坐标时，`HmiScreen.hiddenAssets` 会撤掉原位置那份，避免重复绘制；
- `NAV` / `ROUTE` / `SPEED` / `STATUS` 编译成数据绑定（`/nav/road`、`/route/distance`、`/speed`、`/status/text`）加一条 `updateDataModel`，不是把文案硬写进组件；带 `bind` 的热区在 `dataModel.state` 里有初值，点击后端上把状态写回 `surface.dataModel`；
- 模型完全不可用时，回退的仍是一台完整车机（`ok: false`，画面上加一行说明），不会退回网页卡片布局。

### 场景原型（决定槽位和地图覆盖物）

原型由需求文本推断，也可以 `SCREEN <原型名>` 点名。下表是 `node demo/server/hmi-cli.ts --prompt "..."` 的实测：

| 原型 | 关键词别名 | 槽位（不含 map） | 地图覆盖物 | 组件数 |
| --- | --- | --- | --- | --- |
| navigation 导航中 | 导航 / 巡航 / nav / driving | status,nav,route,gauge,buttons,zoom,progress,dash | 不点名（照旧画全部） | 56 |
| parking 找车位 | 停车 / 车位 / parking | status,hud,gauge,buttons,dash | poi-parking-3d, location-halo-3d | 37 |
| media 媒体 | 音乐 / 歌 / 媒体 / 电台 / music / radio | status,hud,gauge,dash | location-halo-3d | 33 |
| climate 空调 | 空调 / 温度 / 除霜 / 风扇 / 加热 / hvac | status,hud,gauge,dash | location-halo-3d | 32 |
| arrival 即将到达 | 到达 / 终点 / 抵达 / arrival | status,nav,route,gauge,progress,dash | poi-parking-3d, location-halo-3d | 49 |

`POI` / `MAP` 点名的覆盖物优先于原型默认值，最多 `map` 槽位的 capacity（12）个。

### 槽位与容量（`demo/shared/hmi-registry.json` 的 `slots`）

| 槽位 | rect（x,y,w,h） | capacity | 组装出来的部件 |
| --- | --- | --- | --- |
| status | 120,30,425,49 | 7 | 4 个状态图标 + `/status/text` 活时钟 |
| nav | 120,120,442,192 | 6 | 底板 + 转向图标 + 3 行活文字 + 整卡热区 |
| route | 120,342,442,72 | 8 | 无字底板 + 6 段文字 + 暂停 / 退出热区 |
| gauge | 117,447,106,106 | 4 | 描边底板 + 时速大字 + `KM/H` |
| buttons | 120,585,60,220 | 3 | 按钮组合成图 + 3 个热区（指北针 / 图层 / 回车位置） |
| zoom | 120,840,60,120 | 3 | 缩放合成图 + 放大 / 缩小热区（缩小带 `context.delta`） |
| progress | 1764,120,36,685 | 3 | 进度条 + 「查看全程」热区 |
| dash | 0,1080,1920,120 | 12 | `HmiPanel` 底板 + 11 个控件部件（温度 / 风量是活文字）+ 11 个热区 |
| map | 0,0,1920,1080 | 12 | 地图背景 + `root.mapAssets` 按需覆盖物 |
| hud | 600,140,1060,420 | 6 | `CARD` 卡片：面板 + 标题 + 正文 + `select_card` 热区 |

超容量时编译只告警不崩（`dash 槽位容量 12 已满…`、`地图覆盖物 N 个超过槽位容量 12，已截断`）。

`HmiAsset` / `HmiText` / `HmiHotspot` / `HmiPanel` 是组装用的通用组件：位置尺寸直接取 `demo/shared/hmi-registry.json` 里的 canvasRect 与描边出血。`HmiHotspot` 点击后发标准 A2UI action（`{event:{name,context}}`），在页面底部 Action 回调里能看到；界面右上角的「宽屏预览」按 16:10 显示车机画面，「叠原稿」把 Sketch 原始导出叠在画面上做比对。

## 命令行入口（不用模型也能生成车机界面）

```powershell
node demo/server/hmi-cli.ts --prompt "找附近的停车场，时速 60"
node demo/server/hmi-cli.ts --prompt "空调调到 22 度" --script "CARD 座舱温度 主驾 22 副驾 24"
node demo/server/hmi-cli.ts --prompt "2D 平面地图找车位" --pretty
```

输出 `{ok, archetype, archetypeName, variant, componentCount, slots, mapAssets, warnings, messages}`，
`messages` 里是 `createSurface` / `updateComponents` / `updateDataModel` 三条 v0.9 消息。
控制台后台 `android-demo/server/a2ui_console_server.py`（`127.0.0.1:8787`）就是靠这个入口支持 `surfaceKind:"hmi"`，
经同一个 SSE `/stream` 推给 App；`android-demo/tools/console_push.py --hmi`、`android-demo/tools/hmi_live_viewer.py` 已就绪。
浏览器端订阅：`http://127.0.0.1:5173/?fit=1&live=1&console=http://127.0.0.1:8787`。

## 示例（demo/public/examples）

| 文件 | 内容 |
| --- | --- |
| `40_hmi-navigation.json` / `41_hmi-navigation-2d.json` | 手写整块挂件（原稿外观）3D / 2D |
| `42_hmi-cockpit-assets.json` | navigation 组装版：59 件，槽位 status,nav,route,gauge,buttons,zoom,progress,dash，覆盖物 poi-parking-3d, poi-garden-3d |
| `43_hmi-parking.json` | parking 组装版：48 件（含 `SHOW 缩放`、2 张 `CARD`），槽位 status,hud,gauge,buttons,dash,zoom |
| `44_hmi-media.json` | media 组装版：41 件（含 `ICON 商场`），槽位 status,hud,gauge,dash |
| `45_hmi-climate.json` | climate 组装版：38 件（含 `HIDE 时速表`），槽位 status,hud,dash |
| `46_hmi-navigation-panel.json` | `MODE 整块` 对照：13 件，8 个整块挂件 + 活字时钟 + 音量热区 |

`42`–`46` 由 `node demo/server/gen-example-hmi.ts` 用同一台编译器生成，每份都带 `updateDataModel`。

验证这条链路：

```powershell
node sketch-tools/decompose-artboard.js --verify   # 拆解校验：3D 41 件 / 2D 33 件，漏墨 0
node sketch-tools/gen-hmi-registry.js              # 重建注册表（126 条目 + 10 槽位）
node sketch-tools/sync-demo-assets.js              # 把 SVG（含 parts/）同步到 demo/public/hmi
node demo/server/hmi-cli.ts --prompt "找附近的停车场，时速 60"
node demo/server/gen-example-hmi.ts                # 重建示例 42–46 和 manifest.json
node demo/server/selftest-hmi.ts                   # 不依赖模型和浏览器的编译 / 校验自检（应输出「全部通过」）
node sketch-tools/check-hmi-layout.js              # 浏览器实测坐标 vs 注册表坐标（偏差必须为 0）
```

## 接口

`POST /api/generate`

```json
{
  "prompt": "做一个邮箱和密码登录表单，带记住我和登录按钮",
  "mode": "blocks"
}
```

`mode` 可选 `blocks`（默认，网页界面）、`hmi`（车机横屏界面）或 `json`（实验）。

`GET /api/hmi/assets` 返回素材注册表（`groups` 分组计数 + 每条素材的 key / 分组 / 种类 / 视角 / src / rect / bleed / text），用来核对提示词里给模型的素材表和渲染用的是不是同一份；槽位与容量看 `shared/hmi-registry.json` 的 `slots`（或 `node demo/server/hmi-cli.ts --pretty` 输出里的 `slots` / `mapAssets`）。

返回内容包括：

- `messages`：可直接交给 `MessageProcessor.processMessages()` 的 A2UI v0.9 消息
- `script`：模型实际输出的语义块
- `components` / `data`：编译和校验后的组件与数据模型
- `attempts` / `warnings` / `errors`：重试、自动修复和校验信息
- `totalMs` / `usage`：耗时和 token 统计

`GET /api/health` 用于检查模型服务是否在线。

## 文件

- `server/prompt.ts`：语义块 / 车机模式的提示词和 few-shot
- `server/llm.ts`：模型调用与容错解析
- `server/blocks.ts`：语义块解析与 A2UI 组件树编译
- `server/hmi-registry.ts`：读 `shared/hmi-registry.json`，素材别名解析、坐标补齐、HMI 组件属性表
- `server/hmi-archetypes.ts`：场景原型（navigation / parking / media / climate / arrival）、槽位清单与配方、覆盖物
- `server/hmi-composer.ts`：部件级组装（底板 / 拆解部件 / 活文字 / 热区 / 面板），按槽位容量投放
- `server/hmi-blocks.ts`：车机语义块解析与整套 1920×1200 构图编译（含 `MODE 整块` 回退和兜底画面）
- `server/hmi-cli.ts`：命令行入口，需求文本 → A2UI v0.9 消息（控制台后台的 `surfaceKind:"hmi"` 走这里）
- `server/gen-example-hmi.ts`：用同一台编译器生成示例 42–46 与 `manifest.json`
- `server/selftest-hmi.ts`：离线自检（注册表 / 组装 / 原型 / 槽位开关 / 回退）
- `server/catalog.ts`：从官方 basic catalog 提取组件属性，并合并 HMI 组件
- `server/validate.ts`：组件白名单、引用/环/必填校验、素材坐标补齐、v0.9 消息生成
- `server/generate.ts`：生成流程、失败重试、回退界面
- `server/plugin.ts`：Vite 中间件接口
- `shared/hmi-registry.json`：素材注册表（生成物，别手改）
- `src/hmi/asset-registry.ts`：渲染端读取同一份注册表
- `src/hmi/hmi-catalog.tsx`：HMI Catalog 组件实现（`HmiScreen` 按需覆盖物、`HmiPanel`、`HmiHotspot` 状态机、`?live=1` EventSource 订阅）
- `src/App.tsx`：生成面板、三种模式、渲染、状态与诊断展示

## 限制

- 语义块编译器覆盖基础表单和卡片场景，不覆盖 Tabs、Modal、List、动态模板等完整
  Catalog 能力。扩展时先改 `server/blocks.ts` 和提示词，再补校验规则。
- 车机模式只能用注册表里已有的 126 个条目（52 个原稿素材 + 74 个拆解部件 + 10 个槽位）；Sketch 里新增素材后跑
  `sketch-tools/decompose-artboard.js` → `sketch-tools/sync-demo-assets.js` → `sketch-tools/gen-hmi-registry.js`，
  提示词、校验、渲染会自动跟上。控件图标（`controls` 组）只导出了 3D 版本，2D 界面的热区沿用同一套，
  2D 自己的拆解部件另有 33 件（3D 41 件）。
- 默认组装不再依赖烘死文字的整块：状态栏 / 导航卡 / 路线条 / 车控栏上的文字都是 `HmiText` 活字，随 `updateDataModel` 变。
  只有 `MODE 整块`（以及手写的 `40` / `41` 两份示例）会用到烧死文字的整块挂件，那时 `STATUS` 是在原时钟位置盖一层活字。
- 组件白名单保持封闭，模型不能发明控件。未知组件会被映射或拒绝。
- 4B 的强项是短结构化输出；需求越具体、字段越明确，结果越稳定。
- 当前 demo 面向演示和验证，没有鉴权、限流和持久化。

实测结果见 [EVAL.md](EVAL.md)。
