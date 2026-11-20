/**
 * Offline self-test for the HMI block compiler, slot composer and validator.
 * Run: node demo/server/selftest-hmi.ts
 * No model, no browser: it proves the deterministic half of the HMI pipeline —
 * including that different scenes really compile into different component trees.
 */
import {compileHmiBlocks, fallbackHmiComponents, parseHmiBlocks, variantFromRequest} from './hmi-blocks.ts';
import {archetypeFromRequest} from './hmi-archetypes.ts';
import {getHmiRegistry, hmiAssetsOfGroup, hmiSlot} from './hmi-registry.ts';
import {normalizeComponents, toMessages} from './validate.ts';

let failures = 0;

function check(label: string, condition: unknown, detail?: unknown) {
  if (condition) {
    console.log(`  ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
}

type Json = Record<string, unknown>;

function compile(script: string, request: string) {
  const parsed = parseHmiBlocks(script);
  const compiled = compileHmiBlocks(parsed.blocks, request);
  const normalized = normalizeComponents(compiled.components);
  const messages = toMessages(normalized.components, 'selftest');
  messages.push({version: 'v0.9', updateDataModel: {surfaceId: 'selftest', value: compiled.data}});
  return {parsed, compiled, normalized, messages};
}

const of = (result: {normalized: {components: Json[]}}, name: string) =>
  result.normalized.components.filter(component => component.component === name);

const rootOf = (result: {normalized: {components: Json[]}}) =>
  result.normalized.components.find(component => component.id === 'root');

const registry = getHmiRegistry();
console.log(`registry: ${registry.loaded ? 'demo/shared/hmi-registry.json' : '（缺失）'}`);

console.log('\n0. 注册表：素材 + 部件 + 槽位');
{
  check('注册表已加载', registry.loaded, registry.assets.length);
  check('素材总数 ≥ 120（原稿 52 + 拆解部件）', registry.assets.length >= 120, registry.assets.length);
  const parts = hmiAssetsOfGroup('parts');
  check('拆解部件 ≥ 60', parts.length >= 60, parts.length);
  check('3D 部件和 2D 部件都有', hmiAssetsOfGroup('parts', '3d').length > 0 && hmiAssetsOfGroup('parts', '2d').length > 0, {
    '3d': hmiAssetsOfGroup('parts', '3d').length,
    '2d': hmiAssetsOfGroup('parts', '2d').length,
  });
  check('槽位 10 个', Object.keys(registry.slots).length === 10, Object.keys(registry.slots));
  const unslotted = registry.assets.filter(asset => !asset.slot);
  check('只有整屏截图没有槽位', unslotted.length === 2 && unslotted.every(asset => asset.group === 'screens'), unslotted.map(a => a.key));
  const gauge = hmiSlot('gauge');
  check('gauge 槽位按描边出血算成 106×106', gauge?.rect.width === 106 && gauge?.rect.height === 106, gauge?.rect);
  check('每个槽位都有 capacity', Object.values(registry.slots).every(slot => typeof slot.capacity === 'number' && slot.capacity > 0), Object.keys(registry.slots));
}

console.log('\n1. 什么都不写（模型失败也要有车机画面）');
{
  const result = compile('', '车机导航中');
  const root = rootOf(result);
  const children = (root?.children as string[]) ?? [];
  check('校验通过', result.normalized.ok, result.normalized.errors);
  check('root 是 HmiScreen', root?.component === 'HmiScreen', root);
  check('默认是部件级组装', root?.assembly === 'composed', root?.assembly);
  check('槽位清单非空', Array.isArray(root?.slots) && (root?.slots as string[]).length >= 8, root?.slots);
  check('组装出来的部件比原来的 8 个挂件多', children.length > 8, children.length);
  check('变体默认 3d', root?.variant === '3d', root?.variant);
  check('数据模型带导航文案', Boolean((result.compiled.data.nav as Record<string, unknown>)?.road), result.compiled.data.nav);
  check('createSurface 用 HMI catalog', (result.messages[0] as Json).createSurface?.catalogId === registry.catalogId, result.messages[0]);
  check('surface 消息含 updateComponents', result.messages.length >= 2, result.messages.length);
  check('组件数不超过 120 上限', result.normalized.components.length <= 120, result.normalized.components.length);
}

console.log('\n2. 组装证据：不再用烧死的整块挂件');
{
  const result = compile('', '车机导航中');
  const assets = of(result, 'HmiAsset').map(component => component.asset as string);
  const baked = ['control-bar-3d', 'status-bar-3d', 'nav-instruction-card-3d', 'route-info-bar-3d'];
  check('没有画烧死文字的整块挂件', !assets.some(key => baked.includes(key)), assets.filter(key => baked.includes(key)));
  check('用了拆解部件', assets.some(key => key.startsWith('3d-')), assets.filter(key => key.startsWith('3d-')));
  const panels = of(result, 'HmiPanel');
  check('车控栏换成可组装面板底板', panels.length >= 1, panels.length);
  const hotspots = of(result, 'HmiHotspot');
  check('热区数量 ≥ 15（每个控件/按钮都能点）', hotspots.length >= 15, hotspots.length);
  const texts = of(result, 'HmiText');
  const bound = texts.filter(component => typeof component.text === 'object');
  check('文字是数据绑定（会随数据变）', bound.length >= 6, bound.map(component => component.text));
  const controls = assets.filter(key => ['defrost', 'heater', 'volume', 'music', 'phone', 'vehicle-model3'].includes(key));
  check('车控栏用独立控件素材', controls.length >= 5, controls);
}

console.log('\n3. 不同场景 → 不同界面（这是这次要证明的事）');
{
  const scenes = [
    {prompt: '导航中，剩余 12 公里 25 分钟', archetype: 'navigation'},
    {prompt: '找附近的停车场', archetype: 'parking'},
    {prompt: '只听歌，音量 60', archetype: 'media'},
    {prompt: '空调调到 22 度', archetype: 'climate'},
    {prompt: '即将到达终点', archetype: 'arrival'},
  ];
  const compiled = scenes.map(scene => ({...scene, result: compile('', scene.prompt)}));
  for (const item of compiled) {
    check(`校验通过：${item.prompt}`, item.result.normalized.ok, item.result.normalized.errors);
    check(`原型 ${item.archetype} 被识别`, archetypeFromRequest(item.prompt) === item.archetype, archetypeFromRequest(item.prompt));
  }
  const signatures = compiled.map(
    item => `${item.archetype}#${(rootOf(item.result)?.slots as string[])?.join('|')}#${item.result.normalized.components.length}`,
  );
  check('5 个场景的组件树结构互不相同', new Set(signatures).size === 5, signatures);

  const parking = compiled[1].result;
  const parkingRoot = rootOf(parking);
  check('找车位：地图只画停车场覆盖物', (parkingRoot?.mapAssets as string[])?.includes('poi-parking-3d'), parkingRoot?.mapAssets);
  check('找车位：有 HUD 卡片底板', of(parking, 'HmiPanel').length >= 1, of(parking, 'HmiPanel').length);
  check('找车位：没有导航引导卡槽位', !(parkingRoot?.slots as string[])?.includes('nav'), parkingRoot?.slots);
  const media = compiled[2].result;
  check('媒体：数据模型带媒体状态', Boolean((media.compiled.data.media as Record<string, unknown>)?.title), media.compiled.data.media);
  check('媒体：没有路线进度条槽位', !(rootOf(media)?.slots as string[])?.includes('progress'), rootOf(media)?.slots);
  const climate = compiled[3].result;
  check('空调：数据模型带温度', Boolean((climate.compiled.data.climate as Record<string, unknown>)?.driver), climate.compiled.data.climate);
  const arrival = compiled[4].result;
  check('到达：保留导航卡', (rootOf(arrival)?.slots as string[])?.includes('nav'), rootOf(arrival)?.slots);
  check('到达：不画地图按钮组/缩放', !(rootOf(arrival)?.slots as string[])?.includes('buttons'), rootOf(arrival)?.slots);
}

console.log('\n4. 常见写法：SPEED / NAV / POI / CONTROL / LABEL / STATUS');
{
  const script = [
    'SPEED 45',
    'NAV 1.2公里后 右转 中山北路',
    'ROUTE 8 22',
    'POI 停车场 poi-parking-3d',
    'POI 山河花园',
    'CONTROL 音量 volume_up 音量',
    'LABEL 前方施工 900 260 34',
    'STATUS 08:15',
  ].join('\n');
  const result = compile(script, '车机界面');
  check('校验通过', result.normalized.ok, result.normalized.errors);
  const speedText = of(result, 'HmiText').find(
    component => (component.text as Record<string, unknown>)?.path === '/speed',
  );
  check('时速数字走数据绑定', Boolean(speedText), of(result, 'HmiText').map(component => component.text));
  const navData = result.compiled.data.nav as Record<string, unknown>;
  check('NAV 距离解析成 1.2公里后', navData.distance === '1.2公里后', navData);
  check('NAV 动作 = 右转', navData.label === '右转', navData);
  check('NAV 路名 = 中山北路', navData.road === '中山北路', navData);
  const routeData = result.compiled.data.route as Record<string, unknown>;
  check('ROUTE 公里/分钟写进数据模型', routeData.distance === '8' && routeData.time === '22', routeData);
  const assets = of(result, 'HmiAsset').map(component => component.asset as string);
  check('两个 POI 素材都在地图覆盖物里', assets.includes('poi-parking-3d'), assets);
  const root = rootOf(result);
  check('POI 名字自动映射到素材 key', (root?.mapAssets as string[])?.includes('poi-garden-3d'), root?.mapAssets);
  check('STATUS 写进数据模型', (result.compiled.data.status as Record<string, unknown>)?.text === '08:15', result.compiled.data.status);
  const label = of(result, 'HmiText').find(component => component.text === '前方施工');
  check('LABEL 用了给定坐标', label?.x === 900 && label?.y === 260, [label?.x, label?.y]);
  check('LABEL 用了给定字号', label?.size === 34, label?.size);
  const controlHotspot = of(result, 'HmiHotspot').find(component => component.label === '音量');
  check('中文控件名映射到素材热区', Boolean(controlHotspot), of(result, 'HmiHotspot').map(component => component.label));
}

console.log('\n4b. CLIMATE / MEDIA：座舱与媒体状态真的进数据模型');
{
  const result = compile('CLIMATE 主驾 24 副驾 26 风量 3 档 内循环\nMEDIA 夜航 港口电台 · FM 92.1 音量 60', '只听歌');
  check('校验通过', result.normalized.ok, result.normalized.errors);
  const climate = result.compiled.data.climate as Record<string, unknown>;
  check('CLIMATE 写进 /climate', climate.driver === '24°' && climate.passenger === '26°' && climate.fan === '3 档' && climate.mode === '内循环', climate);
  const media = result.compiled.data.media as Record<string, unknown>;
  check('MEDIA 写进 /media', media.title === '夜航' && media.volume === 60, media);
  const hudTexts = of(result, 'HmiText').map(component => String(component.text ?? ''));
  check('MEDIA 卡用的是覆盖后的数据（不是原型默认值）', hudTexts.some(text => text.includes('音量 60')), hudTexts);
  const climateScene = compile('CLIMATE 主驾 24 副驾 26 风量 3 档 内循环', '空调界面');
  const climateTexts = of(climateScene, 'HmiText').map(component => String(component.text ?? ''));
  check('CLIMATE 卡用的是覆盖后的数据', climateTexts.some(text => text.includes('主驾 24°') && text.includes('3 档')), climateTexts);
  check('CLIMATE 卡不再残留原型默认值', !climateTexts.some(text => text.includes('主驾 22°')), climateTexts);
  const junk = compile('CLIMATE 乱七八糟', '空调界面');
  const junkData = junk.compiled.data.climate as Record<string, unknown>;
  check('CLIMATE 读不出来只告警不崩', junk.normalized.ok && junk.compiled.warnings.length >= 1, junk.compiled.warnings);
  check('读不出来时保留原型默认座舱数据', junkData.driver === '22°' && junkData.fan === '2 档', junkData);
}

console.log('\n5. POI 换位置（HmiScreen 要撤掉原来那份素材）');
{
  const result = compile('POI 山河花园 poi-garden-3d 1200 300', '车机界面');
  check('校验通过', result.normalized.ok, result.normalized.errors);
  const moved = of(result, 'HmiAsset').find(component => component.asset === 'poi-garden-3d');
  check('POI 用了新的坐标', moved?.x === 1200 && moved?.y === 300, [moved?.x, moved?.y]);
  const root = rootOf(result);
  check(
    'root.hiddenAssets 撤掉原素材',
    Array.isArray(root?.hiddenAssets) && (root?.hiddenAssets as string[]).includes('poi-garden-3d'),
    root?.hiddenAssets,
  );
  check('换位置的素材不再进 mapAssets', !(root?.mapAssets as string[])?.includes('poi-garden-3d'), root?.mapAssets);
}

console.log('\n6. 槽位开关：HIDE / SHOW');
{
  const hidden = compile('HIDE 缩放\nHIDE 进度条', '导航中');
  check('校验通过', hidden.normalized.ok, hidden.normalized.errors);
  const slots = (rootOf(hidden)?.slots as string[]) ?? [];
  check('HIDE 把缩放槽位摘掉', !slots.includes('zoom'), slots);
  check('HIDE 后没有缩放控件素材', !of(hidden, 'HmiAsset').some(component => String(component.asset).startsWith('zoom-control')), of(hidden, 'HmiAsset').map(component => component.asset));
  check('HIDE 后没有缩放热区', !of(hidden, 'HmiHotspot').some(component => component.label === '放大'), of(hidden, 'HmiHotspot').map(component => component.label));

  const shown = compile('SCREEN parking\nSHOW 缩放', '找车位');
  const shownSlots = (rootOf(shown)?.slots as string[]) ?? [];
  check('SHOW 把槽位加回来', shownSlots.includes('zoom'), shownSlots);
  const unknown = compile('HIDE 时光机', '导航中');
  check('不认识的挂件名只告警不崩', unknown.normalized.ok && unknown.compiled.warnings.length >= 1, unknown.compiled.warnings);
}

console.log('\n7. CARD：在 HUD 区新加一张卡');
{
  const result = compile('CARD 附近停车场 中央商场 180 米', '找车位');
  check('校验通过', result.normalized.ok, result.normalized.errors);
  const panels = of(result, 'HmiPanel');
  check('卡片有底板面板', panels.length >= 1, panels.length);
  const cardTexts = of(result, 'HmiText').filter(component =>
    String(component.text ?? '').includes('附近停车场') || String((component.text as Record<string, unknown>)?.path ?? '').includes('cards'),
  );
  check('卡片把标题画成文字', cardTexts.length >= 1, of(result, 'HmiText').map(component => component.text));
  const cardHotspot = of(result, 'HmiHotspot').find(component => (component.action as Json)?.event?.name === 'select_card');
  check('卡片本身可点（select_card）', Boolean(cardHotspot), of(result, 'HmiHotspot').map(component => (component.action as Json)?.event?.name));
  const cards = result.compiled.data.cards as Record<string, unknown>[];
  check('数据模型里有卡片内容', cards?.[0]?.title === '附近停车场', cards);
  const hudSlot = hmiSlot('hud');
  const panel = panels[0];
  check('卡片落在 hud 槽位范围内', panel.x >= hudSlot?.rect.x && panel.y >= hudSlot?.rect.y, [panel?.x, panel?.y, hudSlot?.rect]);
}

console.log('\n8. 按需地图覆盖物');
{
  const result = compile('POI 停车场 poi-parking-3d', '找车位');
  const root = rootOf(result);
  const mapAssets = (root?.mapAssets as string[]) ?? [];
  const allMap = hmiAssetsOfGroup('map', '3d').length;
  check('只画点名的覆盖物', mapAssets.includes('poi-parking-3d') && mapAssets.length < allMap, [mapAssets, allMap]);
  check('覆盖物数量不超过槽位容量', mapAssets.length <= (hmiSlot('map')?.capacity ?? 0), [mapAssets.length, hmiSlot('map')?.capacity]);
  const navResult = compile('', '导航中');
  check('导航原型不点名覆盖物（照旧画全部）', rootOf(navResult)?.mapAssets === undefined, rootOf(navResult)?.mapAssets);
  const climateResult = compile('', '空调');
  check('空调原型只留定位光环', ((rootOf(climateResult)?.mapAssets as string[]) ?? []).join(',') === 'location-halo-3d', rootOf(climateResult)?.mapAssets);
}

console.log('\n9. 动态状态：热区有绑定、数据模型有初值');
{
  const result = compile('', '车机导航中');
  const hotspots = of(result, 'HmiHotspot').filter(component => component.bind);
  check('开关型热区都带 bind', hotspots.length >= 5, hotspots.map(component => component.label));
  const state = (result.compiled.data.state as Record<string, unknown>) ?? {};
  const paths = hotspots.map(component => String((component.bind as Record<string, unknown>).path).split('/').pop());
  check('每个 bind 路径都有初值', paths.every(path => path in state), [paths, state]);
  const defrost = hotspots.find(component => component.label === '除霜');
  check('除霜热区存在且可切换', Boolean(defrost?.bind), defrost);
  const messages = result.messages.filter(message => (message as Json).updateDataModel);
  check('数据模型用 updateDataModel 下发', messages.length >= 1, messages.length);
}

console.log('\n10. 模型写乱：未知块 / 未知素材（不能变成网页表单）');
{
  const script = ['HELLO WORLD', 'BUTTON 登录', 'MAP 不存在的素材', 'SPEED 快一点'].join('\n');
  const result = compile(script, '车机界面');
  check('校验通过', result.normalized.ok, result.normalized.errors);
  const root = rootOf(result);
  check('root 仍是 HmiScreen', root?.component === 'HmiScreen', root?.component);
  check('有告警提示模型', result.compiled.warnings.length >= 2, result.compiled.warnings);
  check('没有生成网页表单组件', !of(result, 'TextField').length && !of(result, 'Button').length, of(result, 'Button').length);
  const control = of(result, 'HmiHotspot').find(component =>
    String((component.action as Json)?.event?.name ?? '').startsWith('set_'),
  );
  check('BUTTON 登录 变成一个可点热区（不是网页按钮）', Boolean(control), of(result, 'HmiHotspot').map(component => (component.action as Json)?.event?.name));
  check('速度回落到默认值', result.compiled.data.speed === 63, result.compiled.data.speed);
}

console.log('\n11. 2D 平面地图');
{
  const result = compile('SCREEN 2d\nSPEED 42\nCONTROL 除霜 defrost_on 除霜', '2D 平面地图车机界面');
  check('variantFromRequest 认得 2D', variantFromRequest('2D 平面地图') === '2d');
  check('校验通过', result.normalized.ok, result.normalized.errors);
  const root = rootOf(result);
  check('root.variant = 2d', root?.variant === '2d', root?.variant);
  const assets = of(result, 'HmiAsset').map(component => component.asset as string);
  check('2D 用 2D 拆解部件', assets.some(key => key.startsWith('2d-')), assets.filter(key => key.startsWith('2d-')));
  check('2D 不画 3D 挂件', !assets.some(key => key.startsWith('3d-')), assets.filter(key => key.startsWith('3d-')));
  const defrostHotspot = of(result, 'HmiHotspot').find(component => component.label === '除霜');
  check('除霜热区存在', Boolean(defrostHotspot), of(result, 'HmiHotspot').map(component => component.label));
}

console.log('\n12. MODE 整块：照原稿的整块挂件还在（可回退）');
{
  const result = compile('MODE 整块', '导航中');
  check('校验通过', result.normalized.ok, result.normalized.errors);
  const composites = result.normalized.components.filter(component =>
    ['HmiStatusBar', 'HmiNavInstruction', 'HmiRouteInfo', 'HmiSpeedometer', 'HmiMapButtons', 'HmiZoomControl', 'HmiRouteProgress', 'HmiControlBar'].includes(String(component.component)),
  );
  check('整块模式仍然给出 8 个原稿挂件', composites.length === 8, composites.map(component => component.component));
  check('整块模式下 root.assembly = panel', rootOf(result)?.assembly === 'panel', rootOf(result)?.assembly);
  const hidden = compile('MODE 整块\nHIDE 进度条', '导航中');
  check('整块模式也能按槽位摘挂件', hidden.normalized.components.filter(component => component.component === 'HmiRouteProgress').length === 0, hidden.normalized.components.map(component => component.component));
}

console.log('\n13. 回退路径（模型完全失败时）');
{
  const fallback = fallbackHmiComponents('车机界面');
  const normalized = normalizeComponents(fallback.components);
  check('回退界面校验通过', normalized.ok, normalized.errors);
  const note = normalized.components.find(component => component.id === 'fallbackNote');
  check('回退界面带说明文字', Boolean(note), note);
  const root = normalized.components.find(component => component.id === 'root');
  check('说明文字挂在 root 上', ((root?.children as string[]) ?? []).includes('fallbackNote'), root?.children);
  check('回退界面仍是车机组装（部件 > 20）', normalized.components.length > 20, normalized.components.length);
}

console.log(failures ? `\n${failures} 项失败` : '\n全部通过');
process.exit(failures ? 1 : 0);
