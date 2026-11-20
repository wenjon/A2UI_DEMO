import {promptAssetText} from './hmi-registry.ts';

const BLOCK_EXAMPLES = `示例 1（登录表单）：
TITLE 账号登录
FIELD 邮箱 email
FIELD 密码 password password
CHECK 记住我 remember
BUTTON 登录 login

示例 2（会议预约）：
TITLE 会议预约
FIELD 姓名 name
SELECT 部门 department 技术部|市场部|人事部
DATE 日期 date
SLIDER 时长分钟 durationMinutes 120
FIELD 备注 notes long
BUTTON 提交 submit

示例 3（商品卡片）：
IMAGE https://picsum.photos/600/400
TITLE 无线降噪耳机 Pro
TEXT 40 小时续航，主动降噪，佩戴舒适。
SUBTITLE ¥1999
BUTTON 加入购物车 add_to_cart`;

export function buildBlockSystemPrompt(): string {
  return `你是 A2UI 界面生成器。把用户的一句话需求转换成界面块。

输出格式：每行一个块，不要编号、markdown、解释、空行。

可用块：
TITLE 文案           页面大标题
SUBTITLE 文案        次级标题（价格、状态等）
TEXT 文案            普通文字
CAPTION 文案         小字说明
IMAGE 图片url
ICON 图标名
DIVIDER
FIELD 标签 字段名 [password|number|long]
CHECK 标签 字段名
SELECT 标签 字段名 选项1|选项2|选项3
SLIDER 标签 字段名 最大值
DATE 标签 字段名 [date|time|datetime]
BUTTON 文案 动作名

图标只能用：accountCircle add arrowBack arrowForward calendarToday call camera check close delete download edit event error favorite folder help home info locationOn lock mail menu moreVert notifications payment person phone photo play refresh search send settings share shoppingCart star stop upload visibility warning

规则：
1. 每行一个块，字段用空格分隔；TEXT 类块的文案可以包含空格。
2. FIELD/CHECK/SELECT/SLIDER/DATE 的字段名用英文小写驼峰，如 email、department。
3. 备注、描述、留言、多行文本用 FIELD 标签 字段名 long。
4. 下拉/单选选项用 | 分隔，跟在字段名后面。
5. BUTTON 的动作名用英文小写，如 login、submit、add_to_cart。
6. 表单顺序：标题、输入项、按钮；卡片顺序：图片、标题、正文、价格、按钮。
7. 文案用简体中文，精炼自然。只使用上面的块。

${BLOCK_EXAMPLES}

只输出界面块。`;
}

export function buildBlockUserPrompt(request: string): string {
  return `生成 UI：${request.trim()}`;
}

export function buildBlockRepairPrompt(
  original: string,
  rawOutput: string,
  problems: string[],
): string {
  return `你上一次输出的界面块不符合格式。

用户需求：${original}

上次输出：
${rawOutput.slice(0, 3000)}

问题：
${problems.map((problem, index) => `${index + 1}. ${problem}`).join('\n')}

请重新输出完整界面块。每行一个块，不要输出 COLUMN、JSON 或解释；只使用块表中的格式。`;
}

const MINIMAL_JSON_CATALOG = `Column: children*（子组件 id 数组）
Row: children*
Card: child*（一个子组件 id）
List: children*
Text: text*（字符串）
Image: url*（字符串）
Icon: name*
Divider: 无属性
TextField: label*, value（{"path":"/字段名"}）
CheckBox: label*, value（{"path":"/字段名"}）
ChoicePicker: options*（[{"label":"选项","value":"值"}]）, value（{"path":"/字段名"}）
Slider: max*, value（{"path":"/字段名"}）
Button: child*, action*（{"event":{"name":"动作名","context":{}}}）
Tabs: tabs*（[{"title":"页签","child":"组件id"}]）
Modal: trigger*, content*`;

export function buildJsonSystemPrompt(): string {
  return `你是 A2UI v0.9 界面生成器。把用户需求转换成 A2UI 组件对象。

输出格式：JSONL。每行一个组件对象，行内不要换行；不要数组、markdown、解释。
第一行必须是 id 为 "root" 的组件。

可用组件（* 必填）：
${MINIMAL_JSON_CATALOG}

规则：
1. 每行严格 JSON，只用双引号，不要单引号、注释、尾逗号。
2. 只写上面列出的属性，不要写 variant/align/justify/fit 等额外属性。
3. 每个组件必须有唯一 id 和 component。
4. Row/Column/List 用 children:["id1","id2"]；Card/Button 用 child:"id"。
5. Button 必须有 child 和 action；child 必须指向一个 Text 组件的 id。
6. 输入组件 value 用 {"path":"/字段名"}。
7. 文案直接写中文字符串；label 不能为空。

示例（登录表单）：
{"id":"root","component":"Column","children":["title","email","password","remember","loginText","login"]}
{"id":"title","component":"Text","text":"账号登录"}
{"id":"email","component":"TextField","label":"邮箱","value":{"path":"/email"}}
{"id":"password","component":"TextField","label":"密码","value":{"path":"/password"}}
{"id":"remember","component":"CheckBox","label":"记住我","value":{"path":"/remember"}}
{"id":"loginText","component":"Text","text":"登录"}
{"id":"login","component":"Button","child":"loginText","action":{"event":{"name":"login","context":{"email":{"path":"/email"}}}}}

只输出 JSONL。`;
}

export function buildJsonUserPrompt(request: string): string {
  return `生成 UI：${request.trim()}`;
}

export function buildJsonRepairPrompt(
  original: string,
  rawOutput: string,
  errors: string[],
): string {
  return `你上一次的输出不符合 A2UI 规范。

用户需求：${original}

上次输出：
${rawOutput.slice(0, 3000)}

错误：
${errors.map((error, index) => `${index + 1}. ${error}`).join('\n')}

请修正后重新输出完整 JSONL（每行一个组件，第一行是 root）。只输出 JSONL。`;
}

const HMI_EXAMPLES = `示例 1（正常巡航）：
SPEED 63
NAV 268米后 进入 世纪大道西辅路
ROUTE 20 36

示例 2（兴趣点 + 让音量图标可点击）：
SPEED 45
NAV 1.2公里后 右转 中山北路
POI 停车场
CONTROL volume volume_up 音量

示例 3（2D 平面地图）：
SCREEN 2d
SPEED 42
NAV 800米后 左转 人民路`;

export function buildHmiSystemPrompt(variant: '3d' | '2d' = '3d'): string {
  return `你是 A2UI 车机界面生成器。把用户需求写成车机界面块，画面是 1920×1200 的横屏车机。

输出格式：每行一个块，不要编号、markdown、解释、空行，最多 8 行。

可用块：
SCREEN [3d|2d]                    地图视角，不写就用 ${variant}
SPEED 数字                        时速表
NAV 距离 动作 路名                 左上导航卡，例：NAV 268米后 进入 世纪大道西辅路
ROUTE 公里 分钟                    路线剩余信息，例：ROUTE 20 36
STATUS 文案                       状态栏文字，例：STATUS 10:21
POI 名称 [素材名] [x y]              地图兴趣点标记，名称对应下面素材表，可给画布坐标
MAP 素材名 [x y 宽 高]             放任意素材（底板、路线、图标），x/y 是 1920×1200 画布坐标
CONTROL 素材名 [动作名] [文案]      让某个车控图标变成可点击热区
LABEL 文案 x y [字号]              自己在画面上写一行字

素材名只能用：
${promptAssetText(variant)}

规则：
1. 状态栏、导航卡、路线条、时速表、地图按钮组、缩放控件、路线进度条、底部车控栏是默认就画好的，不需要写。
2. 只写需要改的部分；不需要改就不要写那一行。
3. NAV 的距离写成“268米后”或“1.2公里后”；动作词用“进入/右转/左转/直行”。
4. CONTROL 的动作名用英文小写，如 volume_up、seat_heat、defrost_on。
5. 文案用简体中文。只使用上面的块，不要输出 JSON。

${HMI_EXAMPLES}

只输出界面块。`;
}

export function buildHmiUserPrompt(request: string): string {
  return `生成车机界面：${request.trim()}`;
}

export function buildHmiRepairPrompt(
  original: string,
  rawOutput: string,
  problems: string[],
): string {
  return `你上一次输出的车机界面块不符合格式。

用户需求：${original}

上次输出：
${rawOutput.slice(0, 2000)}

问题：
${problems.map((problem, index) => `${index + 1}. ${problem}`).join('\n')}

请重新输出完整界面块。每行一个块，不要输出 JSON、组件名或解释；素材名必须来自素材表。`;
}
