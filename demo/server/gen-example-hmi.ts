/**
 * Writes the shipped HMI examples under demo/public/examples/ from the same block
 * compiler the server and the CLI use, so the examples can never drift from the mechanism.
 * Run: node demo/server/gen-example-hmi.ts
 *
 * 默认产出「部件级组装」（assembly:"composed"）：界面由 HmiAsset / HmiText / HmiHotspot /
 * HmiPanel 拼出来，坐标全部来自 demo/shared/hmi-registry.json
 * （52 个原稿素材 + 74 个拆解部件 + 10 个带 capacity 的槽位）。
 * 最后一份用 `MODE 整块` 走原来的 8 个整块挂件（assembly:"panel"），作对照。
 */
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {compileHmiBlocks, parseHmiBlocks} from './hmi-blocks.ts';
import {ARCHETYPES, archetypeFromRequest} from './hmi-archetypes.ts';
import {normalizeComponents, toMessages} from './validate.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const examplesDir = path.resolve(here, '../public/examples');

type ExampleSpec = {
  /** 文件名沿用现有编号规律：40/41 手写整块，42 起为编译器生成的示例。 */
  file: string;
  surfaceId: string;
  name: string;
  description: string;
  /** 需求原话：原型（navigation/parking/media/climate/arrival）就是从这句话推断的。 */
  request: string;
  /** 期望原型，用来验证「需求文本 → 原型」这条推断没有跑偏。 */
  expectArchetype: string;
  /** 模型只需要写的语义块。 */
  script: string;
};

const EXAMPLES: ExampleSpec[] = [
  {
    file: '42_hmi-cockpit-assets.json',
    surfaceId: 'hmi-cockpit-assets',
    name: 'HMI 导航中（部件组装）',
    description:
      '默认组装版：导航卡/路线条/时速表/车控栏由拆解部件 + 活文字 + 热区拼出，地图只画点名的 POI。',
    request:
      '车机导航中：时速 45，1.2 公里后右转中山北路，地图上只标出这两个兴趣点，前方施工请减速自己写一行字',
    expectArchetype: 'navigation',
    script: [
      'SCREEN 3d navigation',
      'SPEED 45',
      'NAV 1.2公里后 右转 中山北路',
      'ROUTE 8 19',
      'STATUS 10:21',
      'POI 停车场 poi-parking-3d',
      'POI 山河花园 poi-garden-3d',
      'LABEL 前方施工，请减速 720 250 34',
    ].join('\n'),
  },
  {
    file: '43_hmi-parking.json',
    surfaceId: 'hmi-parking',
    name: 'HMI 找车位（部件组装）',
    description:
      'parking 原型：没有导航卡/路线条，HUD 区用 CARD 出卡片，SHOW 缩放把槽位加回来，地图只画停车场覆盖物。',
    request:
      '找附近停车场：中央商场 180 米、老码头地下库 420 米，车速很慢，把地图缩放控件调出来方便选',
    expectArchetype: 'parking',
    script: [
      'SCREEN parking',
      'SPEED 12',
      'STATUS 18:42',
      'CARD 附近停车场 中央商场 · 180 米 · 有空位',
      'CARD 地下车位 老码头地下库 B2 · 420 米',
      'SHOW 缩放',
      'POI 停车场 poi-parking-3d',
    ].join('\n'),
  },
  {
    file: '44_hmi-media.json',
    surfaceId: 'hmi-media',
    name: 'HMI 媒体（部件组装）',
    description:
      'media 原型：去掉路线条/按钮组/进度条，只留状态栏 + HUD 卡片 + 时速表 + 车控栏，ICON 用中文别名放素材。',
    request: '路上只听歌：夜航，港口电台 FM 92.1，音量 42，顺便把沿途的商场也标在地图上',
    expectArchetype: 'media',
    script: [
      'SCREEN media',
      'SPEED 68',
      'STATUS 21:47',
      'CARD 正在播放 夜航 · 港口电台 FM 92.1 · 2:14 / 4:38',
      'CARD 音量 42 点车控栏右侧音量图标可循环',
      'ICON 商场',
    ].join('\n'),
  },
  {
    file: '45_hmi-climate.json',
    surfaceId: 'hmi-climate',
    name: 'HMI 空调（部件组装）',
    description:
      'climate 原型：HIDE 时速表摘掉 gauge 槽位，HUD 卡片写温度，车控栏除霜/加热是带绑定的热区（状态写回 dataModel）。',
    request: '空调：主驾 22 度副驾 24 度，内循环，2 档风，前挡除霜开着，时速表先藏起来',
    expectArchetype: 'climate',
    script: [
      'SCREEN climate',
      'HIDE 时速表',
      'STATUS 07:15',
      'CARD 座舱温度 主驾 22° · 副驾 24° · 内循环',
      'CARD 前挡除霜 已开启 · 风量 2 档',
      'LABEL 外循环已关 640 620 26',
    ].join('\n'),
  },
  {
    file: '46_hmi-navigation-panel.json',
    surfaceId: 'hmi-navigation-panel',
    name: 'HMI 导航（MODE 整块对照）',
    description:
      'MODE 整块对照版：同一套需求回退到原稿的 8 个整块挂件（assembly:"panel"），STATUS 用活字盖掉烘死的时钟。',
    request:
      '导航中：时速 45，268 米后进入世纪大道西辅路，状态栏时钟换成 10:21，音量和地图上的兴趣点要能点',
    expectArchetype: 'navigation',
    script: [
      'MODE 整块',
      'SPEED 45',
      'NAV 268米后 进入 世纪大道西辅路',
      'ROUTE 20 36',
      'STATUS 10:21',
      'CONTROL 音量 cycle_volume 音量',
      'POI 停车场 poi-parking-3d',
      'POI 山河花园 poi-garden-3d',
    ].join('\n'),
  },
];

const PANEL_COMPOSITES = [
  'HmiStatusBar',
  'HmiNavInstruction',
  'HmiRouteInfo',
  'HmiSpeedometer',
  'HmiMapButtons',
  'HmiZoomControl',
  'HmiRouteProgress',
  'HmiControlBar',
];

function count(components: Record<string, unknown>[], name: string): number {
  return components.filter(component => component.component === name).length;
}

function build(spec: ExampleSpec) {
  const parsed = parseHmiBlocks(spec.script);
  const compiled = compileHmiBlocks(parsed.blocks, spec.request);
  const normalized = normalizeComponents(compiled.components);

  if (!normalized.ok) {
    console.error(`${spec.file} 编译失败：`, normalized.errors);
    process.exit(1);
  }

  const archetypeKey = archetypeFromRequest(spec.request);
  if (archetypeKey !== spec.expectArchetype) {
    console.error(
      `${spec.file} 原型推断跑偏：需求推成 ${archetypeKey}，脚本按 ${spec.expectArchetype} 写`,
    );
    process.exit(1);
  }

  const messages = toMessages(normalized.components, spec.surfaceId);
  messages.push({version: 'v0.9', updateDataModel: {surfaceId: spec.surfaceId, value: compiled.data}});

  const root = normalized.components.find(component => component.id === 'root') ?? {};
  const payload = {
    name: spec.name,
    description: spec.description,
    request: spec.request,
    script: spec.script,
    archetype: archetypeKey,
    archetypeName: ARCHETYPES[archetypeKey]?.name ?? archetypeKey,
    assembly: root.assembly,
    slots: root.slots,
    componentCount: normalized.components.length,
    messages,
  };

  const outFile = path.join(examplesDir, spec.file);
  writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  const components = normalized.components;
  const warnings = [...parsed.warnings, ...compiled.warnings];
  const mapAssets = Array.isArray(root.mapAssets) ? (root.mapAssets as string[]).join(',') : '全部（照旧）';
  const slots = Array.isArray(root.slots) ? (root.slots as string[]).join(',') : '（bare）';

  console.log(`\n${spec.file}`);
  console.log(`  ${spec.name}  surface=${spec.surfaceId}`);
  console.log(
    `  archetype=${archetypeKey}(${payload.archetypeName})  variant=${compiled.variant}  assembly=${root.assembly ?? '-'}`,
  );
  console.log(`  componentCount=${normalized.components.length}  slots=${slots}  mapAssets=${mapAssets}`);
  console.log(
    `  部件 HmiAsset=${count(components, 'HmiAsset')} HmiText=${count(components, 'HmiText')} ` +
      `HmiHotspot=${count(components, 'HmiHotspot')} HmiPanel=${count(components, 'HmiPanel')} ` +
      `整块挂件=${components.filter(c => PANEL_COMPOSITES.includes(String(c.component))).length}`,
  );
  console.log(
    `  消息 ${messages.length} 条：createSurface / updateComponents / updateDataModel` +
      `（dataModel 键：${Object.keys(compiled.data).join(', ')}）`,
  );
  if (warnings.length) console.log(`  warnings: ${warnings.join(' | ')}`);

  return {spec, messages: messages.length, components: normalized.components.length, warnings};
}

function updateManifest() {
  const manifestFile = path.join(examplesDir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as {
    file: string;
    name: string;
    description: string;
  }[];

  for (const spec of EXAMPLES) {
    const entry = {file: spec.file, name: spec.name, description: spec.description};
    const index = manifest.findIndex(item => item.file === spec.file);
    if (index >= 0) manifest[index] = entry;
    else manifest.push(entry);
  }
  manifest.sort((a, b) => a.file.localeCompare(b.file, 'en'));
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifestFile;
}

console.log('用同一台块编译器生成车机示例（默认部件级组装）：');
const results = EXAMPLES.map(build);
const manifestFile = updateManifest();

const totalComponents = results.reduce((sum, item) => sum + item.components, 0);
const totalWarnings = results.reduce((sum, item) => sum + item.warnings.length, 0);
console.log(
  `\n共 ${results.length} 份示例 / ${totalComponents} 个组件 / ${totalWarnings} 条 warning；` +
    `清单已更新：${manifestFile}`,
);
