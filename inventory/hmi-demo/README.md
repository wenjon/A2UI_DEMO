# HMI 概念导航 Demo · UI 素材单元

从 `HMI概念导航Demo.sketch` 拆出的可复用素材，每个单元同时提供 **自包含 SVG**（图片已内联 base64）与 **2x PNG**。

## 来源

- 文件：`D:\BaiduNetdiskDownload\HMI概念导航Demo.sketch`
- 页面：`HMI概念导航Demo`
- 画板：`HMI概念导航Demo_3D`（1920×1200）、`HMI概念导航Demo_2D`（1920×1200）
- 导出：`sketch-to-svg` + `paper.js`，PNG 由 `sharp` 以 2 倍尺寸渲染

## 目录

```
hmi-demo/
├─ svg/<分组>/<素材>.svg     # 自包含矢量，图片已内联
├─ png/<分组>/<素材>.png     # 2x 位图（screens 为 3840×2400）
├─ manifest.json            # 机器可读清单
└─ preview-sheet.png        # 全部素材总览
```

## 坐标约定

- `frame`：Sketch 原始坐标，相对于父图层。
- `canvasRect`：换算到画板内的绝对坐标（左上角原点），用它来还原布局。
- 每个素材的 SVG 视口已归零到自身左上角，尺寸等于 `frame.width/height`（描边出血的素材除外，见下文）。

## 清单

### 整屏（screens）

可直接当参考图/合成底图，1920×1200

| 素材 | 画板 | 尺寸 | 画板内位置 | 说明 |
| --- | --- | --- | --- | --- |
| `hmi-3d-screen` | 3D | 1920×1200 | 0,0 | HMI概念导航Demo_3D |
| `hmi-2d-screen` | 2D | 1920×1200 | 0,0 | HMI概念导航Demo_2D |

### 地图底图（backgrounds）

城市 3D 底图与 2D 平面地图

| 素材 | 画板 | 尺寸 | 画板内位置 | 说明 |
| --- | --- | --- | --- | --- |
| `map-city-3d` | 3D | 1920×1080 | 0,0 | WechatIMG62 1 |
| `map-flat-2d` | 2D | 2302×1592 | -216,-221 | image 78 |

### HUD 组件（components）

导航卡、路线信息条、时速表、按钮组、缩放、进度条、状态栏、车控栏

| 素材 | 画板 | 尺寸 | 画板内位置 | 说明 |
| --- | --- | --- | --- | --- |
| `control-bar-3d` | 3D | 1920×120 | 0,1080 | main control bar / light |
| `control-bar-2d` | 2D | 1920×120 | 0,1080 | main control bar / light |
| `status-bar-3d` | 3D | 425×49 | 120,30 | Group 29 |
| `status-bar-2d` | 2D | 425×49 | 124,27 | Group 29 |
| `nav-instruction-card-3d` | 3D | 442×192 | 120,120 | Group 35217 |
| `nav-instruction-card-2d` | 2D | 442×192 | 120,120 | Group 35217 |
| `route-info-bar-3d` | 3D | 442×72 | 120,342 | Group 35355 |
| `route-info-bar-2d` | 2D | 442×72 | 120,342 | Group 35355 |
| `speedometer-3d` | 3D | 100×100 | 120,450 | Group 35356 |
| `speedometer-2d` | 2D | 100×100 | 120,450 | Group 35356 |
| `map-buttons-3d` | 3D | 60×220 | 120,585 | Group 35211 |
| `map-buttons-2d` | 2D | 60×220 | 120,585 | Group 35211 |
| `zoom-control-3d` | 3D | 60×120 | 120,840 | Group 35361 |
| `zoom-control-2d` | 2D | 60×120 | 120,840 | Group 35361 |
| `route-progress-3d` | 3D | 36×685 | 1764,120 | Group 35364 |
| `route-progress-2d` | 2D | 36×685 | 1764,120 | Group 35364 |

### 无字底板（plates）

去掉所有文字后的纯底板，用来承载动态文案/数值。几何与对应组件一致，可直接当背景层：

| 素材 | 画板 | 尺寸 | 画板内位置 | 说明 |
| --- | --- | --- | --- | --- |
| `nav-instruction-card-3d-plate` | 3D | 442×192 | 120,120 | 导航卡底 |
| `nav-instruction-card-2d-plate` | 2D | 442×192 | 120,120 | 导航卡底 |
| `route-info-bar-3d-plate` | 3D | 442×72 | 120,342 | 路线信息条 |
| `route-info-bar-2d-plate` | 2D | 442×72 | 120,342 | 路线信息条 |
| `speedometer-3d-plate` | 3D | 100×100 | 120,450 | 时速表圈（SVG 含 3px 出血） |
| `speedometer-2d-plate` | 2D | 100×100 | 120,450 | 时速表圈（SVG 含 3px 出血） |

### 地图覆盖物（map）

路线、POI、当前位置标记

| 素材 | 画板 | 尺寸 | 画板内位置 | 说明 |
| --- | --- | --- | --- | --- |
| `route-path-3d` | 3D | 556×636 | 685,223 | Group 35369 |
| `route-path-2d` | 2D | 449×454 | 650,330 | 路径 |
| `poi-parking-3d` | 3D | 116×45 | 308,715 | Group 35366 |
| `poi-mall-3d` | 3D | 140×49 | 739,536 | Group 35367 |
| `poi-garden-3d` | 3D | 140×48 | 1392,376 | Group 35368 |
| `poi-pin-2d` | 2D | 74×74 | 1058,295 | Group 35218 |
| `location-halo-2d` | 2D | 199×199 | 542,685 | Group 35212 |
| `location-halo-3d` | 3D | 129×129 | 628,790 | Group 35212 |
| `location-arrow-3d` | 3D | 24×23 | 681,841 | Group 35372 |
| `location-arrow-outline-3d` | 3D | 32×32 | 682,832 | Group 35371 |

### 车控按钮（controls）

底部车控栏内的单个控件

| 素材 | 画板 | 尺寸 | 画板内位置 | 说明 |
| --- | --- | --- | --- | --- |
| `phone` | 3D | 48×48 | 1560,1115 | phone |
| `volume` | 3D | 50×112 | 1710,1084 | Volume |
| `music` | 3D | 48×48 | 1410,1115 | music |
| `seat-passenger` | 3D | 48×48 | 1262,1115 | seat |
| `seat-driver` | 3D | 48×48 | 610,1115 | seat |
| `temp-passenger` | 3D | 150×56 | 1035,1110 | Passenger Temp |
| `fan-level` | 3D | 100×75 | 910,1103 | Fan Level |
| `temp-driver` | 3D | 150×56 | 735,1110 | Driver Temp |
| `heater` | 3D | 48×48 | 460,1115 | heater |
| `defrost` | 3D | 50×50 | 310,1115 | defrost |
| `vehicle-model3` | 3D | 48×48 | 160,1115 | model3-icon |

### 状态栏图标（status-icons）

锁、蓝牙、信号、微信、时间

| 素材 | 画板 | 尺寸 | 画板内位置 | 说明 |
| --- | --- | --- | --- | --- |
| `lock` | 3D | 48×48 | 177,31 | lock |
| `bluetooth` | 3D | 48×48 | 237,31 | bluetooth |
| `cell-signal` | 3D | 48×48 | 297,31 | cell signal |
| `wechat` | 3D | 48×48 | 120,30 | 图层 1 |
| `clock` | 3D | 142×25 | 403,43 | Clock |

## 使用注意

- **半透明面板**（导航卡、路线信息条、缩放条、地图按钮）导出的是真实 alpha（3D 为 40% 深色，2D 为 80%），必须叠在地图上才有设计稿里的效果。
- **背景模糊**：设计里这些面板带 `blur.type=3 (background)`、`radius=8`。SVG 无法表达背景模糊，`manifest.json` 的 `style.blurs` 记录了参数，落地时请用 CSS `backdrop-filter: blur(8px)` 或等效方式。
- **3D 路线**（`route-path-3d`）只是彩色发光层，白色路面本身烘在地图底图里，所以单独看是一条细线，叠回底图才完整。
- **2D 路线**（`route-path-2d`）是 39% 黑的 14px 描边（Sketch 里 alpha 写成 0–255，已换算）。
- **描边出血**：Sketch 的描边以路径为中心、可以超出图层框，而 SVG 用 `<img>` 渲染时会被视口裁掉外半边。`speedometer-*-plate` 的视口已扩到 106×106（`viewBox="-3,-3,106,106"`，PNG 212×212），`route-path-2d` 扩到 463×468（`viewBox="-7,-7,463,468"`，PNG 926×936）；落位时左上角相应减 3px / 7px。
- **3D 当前位置**由 `location-halo-3d` + `location-arrow-3d` + `location-arrow-outline-3d` 三层叠加而成。
- 车控图标是深色（`#27313C`），状态栏图标是白色，二者都带透明底。
- 素材按原始包围盒导出，未做 trim，方便直接按坐标落位。

## 重新导出

```powershell
cd sketch-tools
& "D:\node24\node.exe" export-assets.js                 # 全部
& "D:\node24\node.exe" export-assets.js "phone,music"   # 只导指定 key
& "D:\node24\node.exe" contact-sheet.js                 # 重生成总览图
& "D:\node24\node.exe" sync-demo-assets.js              # 同步到 demo/public/hmi
```

导出脚本直接从 `.sketch`（zip）读取页面 JSON，不依赖临时解包目录。
注意：只导指定 key 时 `manifest.json` 会被重写成仅含这些素材；需要完整清单就跑一次不带参数的全量导出。
