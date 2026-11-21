# 车机功能清单与模拟数据接口（v1）

> 目的：把「车机该有哪些功能」整理清楚，并且给每个功能配一个**照真实车机接口形状做的模拟接口**，
> 让后台按场景文字生成场景 JSON 时，画面里的数字是有来源、会随时间变的，而不是写死的样例文字。

## 1. 真实接口依据（不是我们自己编的字段名）

| 依据 | 能拿到什么 |
| --- | --- |
| [AOSP 车辆 HAL `vehicle_value` 联合](https://source.android.google.cn/reference/hal/unionvehicle__value) | `vehicle_speed`、`engine_coolant_temperature`、`is_fuel_level_low` 这类整车信号的原型 |
| [Android `ClimateProfileRequest`](https://developer.android.google.cn/reference/kotlin/androidx/car/app/hardware/climate/ClimateProfileRequest) | 座舱按**分区（zone）**取型：HVAC 功率、风向、车厢温度、分区映射 |
| [Qt IF Android Automotive 车辆属性表](https://doc.qt.io/QtAndroidAutomotive/qtandroidautomotive-vehicle-properties.html) | 一整套属性名：`HVAC_POWER_ON / HVAC_AC_ON / HVAC_MAX_AC_ON / HVAC_DUAL_ON / HVAC_AUTO_ON / HVAC_TEMPERATURE_CURRENT / HVAC_TEMPERATURE_SET / HVAC_FAN_DIRECTION / HVAC_ACTUAL_FAN_SPEED_RPM / HVAC_FAN_SPEED / HVAC_DEFROSTER / HVAC_RECIRC_ON / HVAC_AUTO_RECIRC_ON / HVAC_SEAT_VENTILATION / HVAC_MAX_DEFROST_ON / HVAC_SEAT_TEMPERATURE / HVAC_SIDE_MIRROR_HEAT / HVAC_STEERING_WHEEL_HEAT / HVAC_TEMPERATURE_DISPLAY_UNITS` |
| [OBD-II 命令参考](https://shinylib.net/obd/commands/) | `PID 0x03` 燃油系统状态、`PID 0x11` 节气门绝对开度（线控油门有 12–18% 的地板值）、`PID 0x5A` 相对油门踏板 |
| [车载终端参数表（Ruptela）](https://vehicles.ruptela.com/vehicle/285) | 实际会上报的量：车速 km/h、发动机油耗 L/h、冷却液温度 °C、环境空气温度 °C、蓄电池电压 V / 电流 A、单体电压 min/max/avg |
| [智能电池 SMB 规范](http://ww1.microchip.com/downloads/en/devicedoc/40238b_cn.pdf) | `RelativeStateOfCharge (0x0d)`、`AbsoluteStateOfCharge (0x0e)`、`RemainingCapacity (0x0f)`、`FullChargeCapacity (0x10)`、`MaxError` |
| [Magic Lane 导航指引对象](https://developer.magiclane.com/docs/ios/guides/core/navigation-instructions/) | 实时指引：当前街道、**限速上下文**、剩余时间/距离、**车道指引**、下一个机动动作（区分「导航中动态指引」与「算路后静态路段表」） |
| [Sygic 导航事件流](https://developers.sygic.com/maps-sdk/android/navigation/) | `incidents` 流：测速相机 / 闯红灯相机 / 区间测速 / 学校区 / 事故，每条带 `distance` 与 `recommendedSpeed` |
| [MediaSession（媒体会话）元数据](https://pub.dev/documentation/mpv_audio_kit/latest/mpv_audio_kit/MediaSession-class.html) | 系统级媒体会话字段：`title / artist / album / duration / artwork` + 播放状态，对接蓝牙 AVRCP、耳机按键、音频焦点 |

## 2. 功能清单（按域拆，每行都写「真实来源 → 我们的落点」）

### 2.1 基本 / 仪表

| 功能 | 真实来源 | 我们的落点 |
| --- | --- | --- |
| 车速 | `vehicle_speed` / OBD VSS（km/h） | 槽位 `gauge`（活字 `/speed`），块 `SPEED` |
| 小计里程 / 总里程 | 仪表板计数 | HUD 卡正文 |
| 转速、瞬时油耗/电耗 | `PID 0x0C`、油耗 L/h | HUD 卡正文 |
| 冷却液温度（油车） | `engine_coolant_temperature` | HUD 卡正文 |
| 蓄电池电压 / 电流 | OBD V/A | HUD 卡正文（诊断卡） |
| 胎压（四轮） | 胎压监测 | HUD 卡正文 |
| 环境温度 / 时间 | 环境空气温度、系统时钟 | 槽位 `status`，块 `STATUS` |
| 灯光、雨刮、车门/车窗/后备箱 | `LIGHT_*`、`WINDOW_POSITION_*`、`DOOR_*` | 底部 `dash` 热区 + HUD 卡正文 |
| 驾驶模式、能量回收 | 整车模式 | HUD 卡正文 |

### 2.2 车控（座舱）

| 功能 | 真实来源（属性名） | 我们的落点 |
| --- | --- | --- |
| 开关 / A/C / MAX A/C / 双区 / 自动 | `HVAC_POWER_ON / AC_ON / MAX_AC_ON / DUAL_ON / AUTO_ON` | 块 `CLIMATE`、槽位 `dash` |
| 分区目标温度 / 实测温度 | `HVAC_TEMPERATURE_SET / HVAC_TEMPERATURE_CURRENT`（按 zone） | `/climate.driver`、`/climate.passenger` |
| 风量（档位 + 实际 RPM）、风向 | `HVAC_FAN_SPEED`、`HVAC_ACTUAL_FAN_SPEED_RPM`、`HVAC_FAN_DIRECTION` | `/climate.fan` |
| 内/外循环、自动循环 | `HVAC_RECIRC_ON`、`HVAC_AUTO_RECIRC_ON` | `/climate.mode` |
| 前挡除霜 / MAX 除霜 / 后窗、后视镜加热 | `HVAC_DEFROSTER`、`HVAC_MAX_DEFROST_ON`、`HVAC_SIDE_MIRROR_HEAT` | 热区 `defrost` + 状态 |
| 座椅加热 / 通风、方向盘加热 | `HVAC_SEAT_TEMPERATURE`、`HVAC_SEAT_VENTILATION`、`HVAC_STEERING_WHEEL_HEAT` | 热区 `seat-driver/seat-passenger` + HUD 卡 |
| 温度显示单位 | `HVAC_TEMPERATURE_DISPLAY_UNITS` | 卡正文单位 |

### 2.3 音乐 / 媒体

| 功能 | 真实来源 | 我们的落点 |
| --- | --- | --- |
| 当前曲目元数据 | MediaSession `title / artist / album / duration` | `/media.title`、`/media.artist`、卡正文 |
| 播放状态与进度 | playback state、`position` | `/media.position`（`2:14 / 4:38`） |
| 音量、静音、音源焦点 | 音频流音量、`AudioFocus` | `/media.volume`，块 `MEDIA`，热区 `volume` |
| 音源切换（蓝牙 / USB / 网络 / 本地） | 媒体会话源 | 卡正文 |
| 电台（FM/AM/DAB 频率、台名、节目类型） | 调谐器 | `/media.artist` 里带 `FM 92.1` |
| 播放列表 / 上一曲下一曲 | 队列 | 卡正文「下一曲 …」 |

### 2.4 导航

| 功能 | 真实来源 | 我们的落点 |
| --- | --- | --- |
| 下一机动动作（距离、动作、路名） | 指引对象 maneuver | 槽位 `nav`（`/nav/distance|label|road`），块 `NAV` |
| 剩余距离 / 剩余时间 / 预计到达 | remaining distance / time、ETA | 槽位 `route`（`/route/distance|time`），块 `ROUTE` |
| 车道指引、分歧提示 | lane guidance | HUD 卡正文 |
| 路段限速、当前是否超速 | 限速上下文 | HUD 卡正文（「限速 80 · 当前 74」） |
| 前方事件：测速 / 事故 / 施工 / 学校区 | `incidents`（`distance`、`recommendedSpeed`） | HUD 卡正文 + 地图 POI |
| 路况分段（畅通/缓行/拥堵） | 路况 | 卡正文、`SPEED` 取值区间 |
| 途经点 / 目的地 / 充电桩 POI | POI 搜索 | 块 `POI`、地图覆盖物 |
| 附近停车场（车位数、距离、价格） | POI 详情 | `search` 数据 + `CARD` |

### 2.5 能量 / 充电（纯电与混动）

| 功能 | 真实来源 | 我们的落点 |
| --- | --- | --- |
| 电量 SOC、剩余容量 | `RelativeStateOfCharge`、`RemainingCapacity` | HUD 卡正文、卡「电量偏低」 |
| 续航（CLTC 与实际） | 续航计算 | 卡正文 |
| 充电中：功率、电压/电流、预计充满时间 | 充电桩 + BMS | 卡正文（`charging` preset） |
| 充电站（桩数、功率、单价、距离） | POI 详情 | 卡正文 + `POI` |
| 能量流 / 回收强度 | 整车能量管理 | 卡正文 |
| 油车对照：油量、是否偏低 | `is_fuel_level_low`、燃油液位 | `fuel-city` preset |

## 3. 模拟接口契约 v1

### 3.1 形态

- 模拟器是一个纯计算模块（不联网、不依赖第三方库），**给定预设 + 模拟时刻秒数就能算出同一份快照**（可复现）。
- 快照随时间推进（`tick(dtSec)`），所以「同一句话、不同时刻」画面数字不同，但可复现。
- 模拟接口只负责**状态与读数**；界面怎么拼仍由现有编译器决定（不新增客户端组件类型）。

### 3.2 预设（preset）

| preset | 场景 | 关键取值范围 |
| --- | --- | --- |
| `city-cruise` | 市区巡航 | 45–65 km/h，限速 60，SOC 62–71% |
| `jam` | 市区拥堵 | 6–22 km/h，剩余时间膨胀 1.6–2.4 倍，空调负荷升高 |
| `highway-acc` | 高速 ACC 跟车 | 92–104 km/h，限速 100/120，跟车距离 2 档，车道保持激活 |
| `parking-search` | 找车位 / 就近停车 | 8–25 km/h，停车场 POI 3–5 处（距离、价格、剩余车位） |
| `charging` | 充电中 | 直流 60–140 kW，SOC 上升，预计充满剩余时间递减 |
| `arrival` | 即将到达 | 剩余 < 800 米、< 3 分钟，车速递减，目的地提示 |
| `rain-night` | 雨夜 | 外温 3–8 °C、雨刮开、除霜开、后视镜加热开、照度低 |
| `fuel-city` | 燃油车对照 | 油量 %、冷却液 88–96 °C、转速、瞬时油耗 L/100km |

### 3.3 快照 JSON（字段与单位）

```jsonc
{
  "preset": "jam",
  "clock": "08:41",            // 模拟时刻（HH:MM，24h）
  "simSec": 2520,              // 预设内已经跑了多少秒
  "geo": {"city": "上海", "road": "中山北路", "speedLimit": 60, "segment": "缓行"},
  "vehicle": {
    "speed": 18,               // km/h
    "gear": "D",
    "odometerKm": 21437,
    "tripKm": 18.4,
    "driverPresent": true,
    "doors": {"driver": "关", "passenger": "关", "rearLeft": "关", "rearRight": "关"},
    "lights": "近光", "wiper": "间歇", "ambientC": 9,
    "tireBar": [2.42, 2.46, 2.38, 2.41],   // 左前 右前 左后 右后
    "tireWarn": null
  },
  "energy": {
    "kind": "electric",        // electric | combustion
    "soc": 58,                 // %
    "rangeKm": 268,
    "consumptionKwh100": 17.8,
    "batteryC": 26,
    "regen": "中",
    "fuelLevelPct": null,      // combustion 时用
    "coolantC": null,
    "rpm": null,
    "fuelL100": null
  },
  "climate": {
    "powerOn": true, "acOn": true, "autoOn": false, "dualOn": true,
    "driverSetC": 24, "passengerSetC": 22, "cabinC": 21.5,
    "fanLevel": 3, "fanDirection": "吹面",
    "recirc": "内循环", "defrost": false,
    "seatHeat": {"driver": 1, "passenger": 0}, "steeringWheelHeat": false
  },
  "media": {
    "source": "网络电台",       // 蓝牙 | USB | 网络电台 | 本地
    "title": "夜航", "artist": "港口电台 · FM 92.1",
    "album": null, "durationSec": 278, "positionSec": 134,
    "playback": "播放中",       // 播放中 | 暂停 | 停止
    "volume": 32, "muted": false,
    "nextTitle": "外滩夜色 · 港口电台"
  },
  "nav": {
    "active": true,
    "maneuver": "右转", "maneuverDistanceM": 420, "road": "人民路", "nextRoad": "河南中路",
    "remainingKm": 6.8, "remainingMin": 26, "eta": "09:07",
    "lanes": ["直行+右转", "右转"], "traffic": "缓行",
    "incidents": [{"type": "测速相机", "speedLimit": 60, "distanceM": 1200, "recommendedSpeed": 60}]
  },
  "charging": null,            // charging preset 时非空：功率 kW / 电压 V / 电流 A / 剩余分钟 / 站点 / 单价
  "adas": {
    "acc": false, "accGapSteps": null, "laneKeep": "未激活",
    "frontVehicleKmh": null, "blindSpot": false, "camera": "关闭"
  },
  "alerts": ["前方 1.2 公里 测速 60"]
}
```

### 3.4 接口

| 接口 | 作用 |
| --- | --- |
| `node demo/server/hmi-sim.ts --list` | 列出预设与说明 |
| `node demo/server/hmi-sim.ts --preset jam [--at 2520] [--seed 7] [--json]` | 取某个时刻的快照（`--at` = 预设内已跑的秒数） |
| `node demo/server/hmi-cli.ts … --sim jam --sim-at 2520` | 生成场景时把模拟数据并进去（**主要用法**） |
| `GET /api/sim/presets`（控制台） | 给后台界面用的预设清单 |
| `GET /api/sim/state?preset=jam&at=2520` | 取快照 |
| `POST /api/sim/control` `{preset, at, actions:[{"domain":"climate","key":"driverSetC","value":26}]}` | 模拟「发出一次车控指令」后回最新快照 |
| `POST /api/generate` 里加 `"sim": {"preset":"jam","at":2520,"seed":7}` | 后台输入场景文字 → 推理/组装 → 带模拟数据的场景 JSON |

### 3.5 模拟数据怎么进场景 JSON（不改客户端）

- `vehicle.speed` → `/speed`（槽位 `gauge`）
- `nav.maneuverDistanceM / maneuver / road` → `/nav/*`（槽位 `nav`）
- `nav.remainingKm / remainingMin` → `/route/*`（槽位 `route`）
- `clock` → `/status/text`
- `climate` → `/climate`（座舱卡 + 底部车控栏读数）
- `media` → `/media`（媒体卡）
- 其余读数（`energy` / `vehicle.tireBar` / `adas` / `nav.incidents` / `charging`）→ **HUD 卡正文**（`data.cards`），卡标题按域固定：`车辆状态`、`电量 · 续航`、`充电`、`胎压`、`路况 · 限速`、`前方事件`、`媒体`
- 已有的块永远优先：模型/Agent 写了 `SPEED / NAV / CLIMATE / CARD` 时，模拟数据只填**没被写过的**字段，不覆盖显式指令。

### 3.6 真实性要求（验收时按这个挑数据）

- 单位与量级要对：胎压 bar 两位小数、SOC 整数 %、续航与 SOC 自洽（`range ≈ soc × 满电续航 × 路况系数`）、
  车速与限速和路况自洽（拥堵不会 70 km/h）、剩余时间 ≥ 剩余距离 ÷ 限速、曲目进度 ≤ 时长、
  充电时 SOC 单调上升且预计充满时间单调下降。
- 路网、限速、充电站、曲目用中国城市常见取值（路名可沿用素材里的上海路网：世纪大道西辅路、中山北路、河南中路、延安高架）。
- 同一 preset 同一 `at` 必须给出同一份快照（可复现，便于回归测试）。

## 4. 后台输入示例 → 选哪个预设 → 端上该看到什么

后台输入还是自然语言；预设由推理这步选（Agent 或本地模型），也可以在后台下拉里直接指定。

| 你在后台输入 | preset | 推理应写出的块 | 端上应出现的真实感读数 |
| --- | --- | --- | --- |
| 早高峰中山北路拥堵，还剩 6.8 公里 26 分钟 | `jam` | `SPEED`（由模拟填）`NAV 420米后 右转 人民路` `ROUTE 6.8 26` `STATUS 缓行` | 车速 14–22、缓行卡、限速 60、ETA 09:07、前方测速卡 |
| 内环高架 ACC 跟车巡航，前方有车 | `highway-acc` | `SCREEN 3d 巡航` `NAV 1.2公里后 直行 延安高架` `ROUTE 21 17` | 车速 96–104、限速 100/120、ACC 跟车 2 档、车道保持激活、能耗 15 kWh/100km |
| 电量不多了，就近找充电桩充电 | `charging` | `CARD 电量偏低 …` `POI 充电站 …` | 充电卡：直流 96 kW · 38 分钟充满 · 特来电 · 1.42 元/度、SOC 随时间上升 |
| 找个停车场停车，中央商场附近 | `parking-search` | `SCREEN 3d 找车位` `POI 停车场 poi-parking-3d` | 停车场 3 处（中央商场 180 米 8 元/时、剩余车位）、车速 8–25、胎压卡 |
| 快到了，还有 600 米 2 分钟 | `arrival` | `NAV 600米后 到达 目的地` `ROUTE 0.6 2` | 剩余距离/时间递减、车速下降、到达提示卡 |
| 下雨了，天也黑了，除霜打开 | `rain-night` | `CLIMATE … 除霜` `STATUS 雨夜` | 外温 5 °C、除霜开、后视镜加热开、雨刮间歇、照度低 |
| 放点音乐，音量 60，安静点的 | `city-cruise` | `MEDIA … 音量 60` | 曲目 `夜航 · 港口电台 · FM 92.1 · 2:14 / 4:38`（进度随时间走）、音量 60、下一曲提示 |
| 主驾 26 度，座椅加热开一档 | `city-cruise` | `CLIMATE 主驾 26 风量 2 档 座椅加热 1 档` | 座舱卡 `主驾 26° · 副驾 22°`、座椅加热 1 档、方向盘加热关 |
| 油量不多了，找个加油站（油车） | `fuel-city` | `CARD 油量偏低 …` | 油量 18%、续航 121 km、水温 92 °C、转速 1800、瞬时油耗 8.4 L/100km |
| 停车等人，把空调关掉 | `parking-search` | `CLIMATE 关闭` | 空调关、车速 0、座椅/方向盘加热关、车内温度回落 |
| 前方有测速，限速 60 | `jam` | `CARD 前方测速 …` | 「前方 1.2 公里 测速 60」事件卡 + 地图 POI |
| 出远门，看看胎压和续航 | `highway-acc` | `CARD 车辆状态 …` | 胎压 2.42/2.46/2.38/2.41 bar、SOC 71%、实际续航 302 km、小计里程 18.4 km |

约定：**块写过的数字不被模拟数据覆盖**（例如你输入里明确说了「剩余 6.8 公里 26 分钟」，就按你说的显示；没说清的（车速、电量、胎压、曲目进度）才由模拟器填），这样"场景文字优先、其余都有来源"。
