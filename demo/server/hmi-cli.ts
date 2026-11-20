/**
 * 车机场景命令行入口：场景描述 → A2UI v0.9 消息（无需模型，确定性编译）。
 *
 * 用法：
 *   node demo/server/hmi-cli.ts --prompt "找附近的停车场，时速 60"
 *   node demo/server/hmi-cli.ts --prompt "空调调到 22 度" --script "CARD 座舱温度 主驾 22 副驾 24"
 *   node demo/server/hmi-cli.ts --prompt "2D 平面地图找车位" --pretty
 *
 * 输出 stdout：{"ok":true,"archetype":"parking","variant":"3d","componentCount":31,"messages":[...]}
 * 控制台后台（android-demo/server/a2ui_console_server.py）就是靠这个入口把车机场景推给 App。
 */
import {compileHmiBlocks, fallbackHmiComponents, parseHmiBlocks} from './hmi-blocks.ts';
import {archetypeFromRequest, ARCHETYPES} from './hmi-archetypes.ts';
import {normalizeComponents, toMessages} from './validate.ts';

const BLOCK_WORDS = [
  'SCREEN',
  'NAV',
  'ROUTE',
  'SPEED',
  'STATUS',
  'POI',
  'MAP',
  'CONTROL',
  'LABEL',
  'HIDE',
  'SHOW',
  'CARD',
  'ICON',
  'MODE',
  'CLIMATE',
  'MEDIA',
  '屏幕',
  '导航',
  '剩余',
  '时速',
  '隐藏',
  '显示',
  '卡片',
  '图标',
  '按钮',
  '文字',
  '空调',
  '温度',
  '音乐',
  '媒体',
];

/** 中文场景描述里能直接抽出来的块（模型不在线时也能生成）。 */
function blocksFromPrompt(prompt: string): string[] {
  const lines: string[] = [];
  for (const rawLine of prompt.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const head = line.split(/\s+/)[0]?.toUpperCase();
    if (BLOCK_WORDS.includes(head) || BLOCK_WORDS.includes(line.split(/\s+/)[0])) lines.push(line);
  }

  const speed = prompt.match(/(?:时速|速度|车速)\D{0,3}(\d{1,3})/);
  if (speed) lines.push(`SPEED ${speed[1]}`);

  const remain = prompt.match(/剩余\D{0,3}(\d{1,4})\s*(?:公里|km|分钟)?\D{0,4}(\d{1,4})?/);
  if (remain) lines.push(`ROUTE ${remain[1]} ${remain[2] ?? ''}`.trim());

  const clock = prompt.match(/(?:时间|时钟)\D{0,2}(\d{1,2}[:：]\d{2})/);
  if (clock) lines.push(`STATUS ${clock[1]}`);

  for (const [name, key] of [
    ['停车场', 'poi-parking-3d'],
    ['万达广场', 'poi-mall-3d'],
    ['山河花园', 'poi-garden-3d'],
  ] as const) {
    if (prompt.includes(name)) lines.push(`POI ${name} ${key}`);
  }

  const temp = prompt.match(/(?:空调|温度|暖气|制冷)\D{0,6}?(\d{1,2})\s*(?:度|°|℃)/);
  const fan = prompt.match(/(?:风量|风速)\D{0,3}?(\d{1,2})/);
  const climateBits = [temp ? `${temp[1]} 度` : '', fan ? `风量 ${fan[1]} 档` : ''].filter(Boolean);
  if (climateBits.length) lines.push(`CLIMATE ${climateBits.join(' ')}`);

  const volume = prompt.match(/(?:音量|声音)\D{0,3}?(\d{1,3})/);
  const song = prompt.match(/(?:听|播放|放)\s*([^\s，。,]{2,12})/);
  const mediaBits = [song ? song[1] : '', volume ? `音量 ${volume[1]}` : ''].filter(Boolean);
  if (mediaBits.length) lines.push(`MEDIA ${mediaBits.join(' ')}`);

  if (/除霜|前挡|前窗/.test(prompt)) lines.push('CONTROL 除霜 toggle_defrost 除霜');
  if (/加热|座椅加热/.test(prompt)) lines.push('CONTROL 加热 toggle_heater 加热');
  if (/音量|声音/.test(prompt)) lines.push('CONTROL 音量 cycle_volume 音量');

  return lines;
}

function main() {
  const argv = process.argv.slice(2);
  const readFlag = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const pretty = argv.includes('--pretty');
  const prompt = readFlag('prompt') ?? '';
  const script = readFlag('script') ?? '';

  const lines = [...blocksFromPrompt(prompt)];
  if (script) lines.push(...script.split(/\r?\n/).map(line => line.trim()).filter(Boolean));

  const surfaceId = readFlag('surface') ?? 'hmi';
  const withDataModel = (messages: unknown[], data: unknown) => [
    ...messages,
    {version: 'v0.9', updateDataModel: {surfaceId, value: data}},
  ];

  const parsed = parseHmiBlocks(lines.join('\n'));
  const compiled = compileHmiBlocks(parsed.blocks, prompt || lines.join('\n'));
  const normalized = normalizeComponents(compiled.components);

  const archetypeKey = archetypeFromRequest(prompt || lines.join('\n'));
  let messages = withDataModel(toMessages(normalized.components, surfaceId), compiled.data);
  let warnings = [...parsed.warnings, ...compiled.warnings];

  if (!normalized.ok) {
    const fallback = fallbackHmiComponents(prompt);
    messages = withDataModel(toMessages(normalizeComponents(fallback.components).components, surfaceId), fallback.data);
    warnings.push('组件校验失败，已用车机默认界面');
  }

  const payload = {
    ok: normalized.ok,
    archetype: archetypeKey,
    archetypeName: ARCHETYPES[archetypeKey]?.name ?? archetypeKey,
    variant: compiled.variant,
    componentCount: normalized.components.length,
    slots: (normalized.components[0]?.slots as string[] | undefined) ?? [],
    mapAssets: (normalized.components[0]?.mapAssets as string[] | undefined) ?? null,
    warnings,
    messages,
  };

  process.stdout.write(JSON.stringify(payload, null, pretty ? 2 : 0) + '\n');
}

main();
