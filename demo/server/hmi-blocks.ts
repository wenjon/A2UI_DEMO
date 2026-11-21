import {
  assetBox,
  hmiAsset,
  hmiAssetsOfGroup,
  hmiCatalogId,
  resolveAssetKey,
  type HmiAssetEntry,
  type HmiVariant,
} from './hmi-registry.ts';
import {
  ARCHETYPES,
  archetypeFromRequest,
  mapOverlayKeys,
  resolveArchetype,
  archetypeCards,
  type SlotName,
  SLOT_ALIASES,
} from './hmi-archetypes.ts';
import {
  archetypeSlots,
  composeScreenSlots,
  mapOverlayBudget,
  type ComposeContext,
  type ComposedComponent,
} from './hmi-composer.ts';

/**
 * HMI semantic blocks.
 *
 * The model only writes what changes on the car screen (a road name, a speed,
 * which POI to show, which control to make tappable). Every static part of the
 * 1920x1200 landscape composition — map background, status bar, button groups,
 * zoom control, route progress, control bar — is assembled here from the shared
 * asset registry, so the output is always a real car screen even when the model
 * writes almost nothing.
 */

export type HmiBlockKind =
  | 'SCREEN'
  | 'NAV'
  | 'ROUTE'
  | 'SPEED'
  | 'STATUS'
  | 'POI'
  | 'MAP'
  | 'CONTROL'
  | 'LABEL'
  | 'HIDE'
  | 'SHOW'
  | 'CARD'
  | 'ICON'
  | 'MODE'
  | 'CLIMATE'
  | 'MEDIA';

export type ParsedHmiBlock = {
  kind: HmiBlockKind;
  raw: string;
  args: string[];
};

export type HmiCompileResult = {
  components: Record<string, unknown>[];
  data: Record<string, unknown>;
  variant: HmiVariant;
  warnings: string[];
};

const KINDS = new Set<string>([
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
]);

const ALIASES: Record<string, HmiBlockKind> = {
  VIEW: 'SCREEN',
  CANVAS: 'SCREEN',
  屏幕: 'SCREEN',
  TURN: 'NAV',
  GUIDE: 'NAV',
  导航: 'NAV',
  REMAIN: 'ROUTE',
  TRIP: 'ROUTE',
  剩余: 'ROUTE',
  SPEEDOMETER: 'SPEED',
  GAUGE: 'SPEED',
  时速: 'SPEED',
  CLOCK: 'STATUS',
  TIME: 'STATUS',
  MARKER: 'POI',
  POINT: 'POI',
  ASSET: 'MAP',
  LAYER: 'MAP',
  IMG: 'MAP',
  BUTTON: 'CONTROL',
  BTN: 'CONTROL',
  HOTSPOT: 'CONTROL',
  按钮: 'CONTROL',
  TEXT: 'LABEL',
  NOTE: 'LABEL',
  TITLE: 'LABEL',
  HIDE: 'HIDE',
  REMOVE: 'HIDE',
  隐藏: 'HIDE',
  去掉: 'HIDE',
  SHOW: 'SHOW',
  ADD: 'SHOW',
  显示: 'SHOW',
  加上: 'SHOW',
  PANEL: 'CARD',
  卡片: 'CARD',
  弹卡: 'CARD',
  ICON: 'ICON',
  图标: 'ICON',
  LAYOUT: 'MODE',
  ASSEMBLY: 'MODE',
  组装: 'MODE',
  HVAC: 'CLIMATE',
  AC: 'CLIMATE',
  TEMP: 'CLIMATE',
  空调: 'CLIMATE',
  温度: 'CLIMATE',
  座舱: 'CLIMATE',
  MUSIC: 'MEDIA',
  PLAYER: 'MEDIA',
  AUDIO: 'MEDIA',
  音乐: 'MEDIA',
  媒体: 'MEDIA',
  电台: 'MEDIA',
};

const DEFAULTS = {
  distance: '268 米后',
  label: '进入',
  road: '世纪大道西辅路',
  remainingDistance: '20',
  remainingTime: '36',
  speed: 63,
};

function stripNumbering(line: string): string {
  return line.replace(/^(?:[-*•]+\s*|\d+[.)、]\s*)/, '').trim();
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith('“') && trimmed.endsWith('”'))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function sanitizeAction(value: string | undefined): string {
  const cleaned = (value ?? '').replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || 'control';
}

export function variantFromRequest(request: string, fallback: HmiVariant = '3d'): HmiVariant {
  const text = request.toLowerCase();
  if (/(^|[^a-z0-9])2d|平面|俯视图?/.test(text)) return '2d';
  if (/(^|[^a-z0-9])3d|三维|立体/.test(text)) return '3d';
  return fallback;
}

export function parseHmiBlocks(text: string): {blocks: ParsedHmiBlock[]; warnings: string[]} {
  const warnings: string[] = [];
  let body = text.trim();
  const fenced = body.match(/```(?:[a-z]+)?\s*([\s\S]*?)```/i);
  if (fenced) body = fenced[1].trim();

  const blocks: ParsedHmiBlock[] = [];
  const seen = new Set<string>();
  const MAX_BLOCKS = 60;
  let droppedDuplicates = 0;
  let droppedOverCap = 0;
  body.split(/\r?\n/).forEach((rawLine, index) => {
    const line = stripNumbering(rawLine.replace(/^`|`$/g, '').trim());
    if (!line || line.startsWith('#')) return;

    const match = /^([A-Za-z_]+)\b\s*([\s\S]*)$/.exec(line);
    if (!match) {
      warnings.push(`第 ${index + 1} 行无法识别，已跳过：${line.slice(0, 40)}`);
      return;
    }
    const keyword = match[1].toUpperCase();
    const kind = (KINDS.has(keyword) ? keyword : ALIASES[keyword]) as HmiBlockKind | undefined;
    if (!kind) {
      warnings.push(`第 ${index + 1} 行使用了未知块 ${match[1]}，已跳过`);
      return;
    }

    const rest = match[2].trim().replace(/\uFF5C/g, '|');
    if (!rest && kind !== 'SCREEN') {
      warnings.push(`第 ${index + 1} 行 ${kind} 缺少内容，已跳过`);
      return;
    }

    // 小模型常陷入复读（POI 3 / POI 4 / POI 5 …），这里去重 + 限量，别让它把画面淹掉。
    if (blocks.length >= MAX_BLOCKS) {
      droppedOverCap += 1;
      return;
    }
    const signature = `${kind} ${rest}`;
    if (seen.has(signature)) {
      droppedDuplicates += 1;
      return;
    }
    seen.add(signature);

    blocks.push({
      kind,
      raw: rawLine.trim(),
      args: rest.split(/\s+/).filter(Boolean).map(unquote),
    });
  });

  if (droppedDuplicates) warnings.push(`检测到模型复读：去掉 ${droppedDuplicates} 行完全重复的块`);
  if (droppedOverCap) warnings.push(`块数量超过 ${MAX_BLOCKS} 条，已截断 ${droppedOverCap} 行`);

  return {blocks, warnings};
}

function numberFrom(value: string | undefined, fallback: number): number {
  const text = (value ?? '').trim();
  if (!text) return fallback;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Pull the leading number out of "268 米后" / "1.2公里". */
function splitAmount(value: string): {amount: string; unit: string} {
  const match =
    /^\s*([\d.,]+\s*(?:米|公里|千米|km|m)(?:后|内)?)|(?:^|\s*)([\d.,]+)\s*(米|公里|千米|km|m)?/i.exec(
      value,
    );
  if (!match) return {amount: value.trim(), unit: ''};
  const amount = (match[1] ?? match[2] ?? '').trim();
  const unit = (match[1] ? '' : match[3] ?? '').trim();
  if (!amount) return {amount: value.trim(), unit: ''};
  return {amount, unit};
}

/** The individual status icons the status bar composite is made of. */
function statusIcons(): HmiAssetEntry[] {
  return hmiAssetsOfGroup('status-icons')
    .filter(asset => asset.kind === 'icon')
    .sort((a, b) => a.rect.x - b.rect.x);
}

/** 模型常写的中文地点名 → 地图素材（变体后缀由 resolveAssetKey 补）。 */
const POI_NAME_KEYS: Record<string, string> = {
  停车场: 'poi-parking',
  车位: 'poi-parking',
  停车: 'poi-parking',
  万达广场: 'poi-mall',
  万达: 'poi-mall',
  商场: 'poi-mall',
  广场: 'poi-mall',
  山河花园: 'poi-garden',
  花园: 'poi-garden',
  小区: 'poi-garden',
  起点: 'location-halo',
  当前位置: 'location-halo',
  定位: 'location-halo',
  自车: 'location-arrow',
  车头: 'location-arrow',
};

export function compileHmiBlocks(
  blocks: ParsedHmiBlock[],
  request: string,
): HmiCompileResult {
  const warnings: string[] = [];
  const components: Record<string, unknown>[] = [];
  const data: Record<string, unknown> = {};

  let variant: HmiVariant = variantFromRequest(request);
  let bare = false;
  /** 部件级组装（默认）还是直接用整块原稿。 */
  let mode: 'composed' | 'panel' = 'composed';
  let archetypeKey = archetypeFromRequest(request);
  let archetypeExplicit = false;
  const hiddenSlots = new Set<SlotName>();
  const shownSlots = new Set<SlotName>();
  const cards: {title: string; body: string; group: string}[] = [];
  const extraIcons: {asset: string; slot: SlotName}[] = [];
  const explicitMapAssets: string[] = [];

  const nav = {...DEFAULTS};
  const route = {distance: DEFAULTS.remainingDistance, time: DEFAULTS.remainingTime};
  let navWritten = false;
  let routeWritten = false;
  let speed = DEFAULTS.speed;
  let statusText = '';
  const climate: Record<string, string> = {};
  const media: Record<string, string | number> = {};
  const extras: Record<string, unknown>[] = [];
  const extraIds: string[] = [];
  const usedAssets = new Set<string>();
  const movedAssets = new Set<string>();
  let counter = 0;
  const nextId = (prefix: string) => {
    counter += 1;
    return `${prefix}${counter}`;
  };

  for (const block of blocks) {
    const {kind, args} = block;

    if (kind === 'SCREEN') {
      for (const arg of args) {
        const lowered = arg.toLowerCase();
        if (lowered === '2d' || lowered === '平面') variant = '2d';
        else if (lowered === '3d' || lowered === '三维') variant = '3d';
        else if (lowered === 'bare' || lowered === '无挂件') bare = true;
        else if (lowered === 'panel' || lowered === '整块') mode = 'panel';
        else if (lowered === 'composed' || lowered === '组装' || lowered === '部件') mode = 'composed';
        else {
          const resolved = resolveArchetype(arg);
          if (ARCHETYPES[resolved.key] && (arg === resolved.key || !resolved.warning)) {
            archetypeKey = resolved.key;
            archetypeExplicit = true;
            if (resolved.warning) warnings.push(resolved.warning);
          }
        }
      }
      continue;
    }

    if (kind === 'MODE') {
      const value = (args[0] ?? '').toLowerCase();
      if (value === 'panel' || value === '整块' || value === '整块原稿') mode = 'panel';
      else mode = 'composed';
      continue;
    }

    if (kind === 'HIDE' || kind === 'SHOW') {
      for (const arg of args) {
        const slot = SLOT_ALIASES[arg.trim()] ?? SLOT_ALIASES[arg.trim().toLowerCase()];
        if (!slot) {
          warnings.push(`${kind} 不认识挂件“${arg}”，已跳过（可用：状态栏/导航卡/路线条/时速表/按钮组/缩放/进度条/车控栏/卡片）`);
          continue;
        }
        if (kind === 'HIDE') {
          hiddenSlots.add(slot);
          shownSlots.delete(slot);
        } else {
          shownSlots.add(slot);
          hiddenSlots.delete(slot);
        }
      }
      continue;
    }

    if (kind === 'CARD') {
      const title = args[0] ?? '';
      const body = args.slice(1).join(' ').trim();
      if (!title) {
        warnings.push('CARD 缺少标题，已跳过');
        continue;
      }
      cards.push({title, body: body || '点卡片看详情', group: 'hud'});
      continue;
    }

    if (kind === 'ICON') {
      const resolved = resolveAssetKey(args[0] ?? '', variant);
      if (!resolved.key) {
        warnings.push(`ICON“${args[0] ?? ''}”没有对应素材，已跳过`);
        continue;
      }
      const entry = hmiAsset(resolved.key)!;
      const slot = (entry.slot as SlotName | null | undefined) ?? 'hud';
      extraIcons.push({asset: resolved.key, slot});
      continue;
    }

    if (kind === 'NAV') {
      navWritten = true;
      const raw = args.join(' ').trim();
      const {amount, unit} = splitAmount(raw);
      if (amount) {
        nav.distance = unit ? `${amount} ${unit}` : amount;
      }      const rest = args.slice(1);
      if (args[0] && /[\u4e00-\u9fa5]/.test(args[0]) && !/\d/.test(args[0])) {
        // "NAV 进入 世纪大道" style: action word first.
        nav.label = args[0];
        nav.road = rest.slice(1).join(' ') || nav.road;
      } else {
        if (args[1]) nav.label = args[1];
        if (args[2]) nav.road = args.slice(2).join(' ');
      }
      if (!nav.road) nav.road = DEFAULTS.road;
      continue;
    }

    if (kind === 'ROUTE') {
      routeWritten = true;
      if (args[0]) route.distance = args[0];
      if (args[1]) route.time = args[1];
      continue;
    }

    if (kind === 'SPEED') {
      const value = numberFrom(args[0]?.replace(/[^\d.]/g, ''), NaN);
      if (Number.isFinite(value)) speed = value;
      else warnings.push(`SPEED 的参数“${args[0] ?? ''}”不是数字，已用 ${DEFAULTS.speed}`);
      continue;
    }

    if (kind === 'STATUS') {
      const text = args.join(' ').trim();
      if (text) statusText = text;
      continue;
    }

    if (kind === 'POI') {
      const name = args[0] ?? '';
      const keyArg = args.slice(1).find(arg => !/^-?\d/.test(arg));
      const coords = args
        .slice(1)
        .filter(arg => /^-?\d+(\.\d+)?$/.test(arg))
        .map(Number);
      const resolved = resolveAssetKey(keyArg ?? name, variant);
      let key = resolved.key;
      if (resolved.warning) warnings.push(resolved.warning);

      if (!key) {
        const alias = POI_NAME_KEYS[name.trim()];
        if (alias) {
          const aliased = resolveAssetKey(alias, variant);
          if (aliased.key) {
            key = aliased.key;
          } else {
            warnings.push(aliased.warning ?? `POI“${name}”对应的素材 ${alias} 在这个变体里没有`);
          }
        }
      }
      if (!key) {
        const pool = hmiAssetsOfGroup('map', variant).filter(
          asset => (asset.kind === 'poi' || asset.kind === 'marker') && !usedAssets.has(asset.key),
        );
        key = pool[0]?.key ?? null;
        if (key) warnings.push(`POI“${name}”没有对应素材，已改用 ${key}`);
      }
      if (!key) {
        warnings.push(`POI“${name}”没有可用素材，已跳过`);
        continue;
      }

      usedAssets.add(key);
      const id = nextId('poi');
      const component: Record<string, unknown> = {id, component: 'HmiAsset', asset: key, variant};
      if (coords.length >= 2) {
        component.x = coords[0];
        component.y = coords[1];
        // A re-placed asset must not also be painted by the map layer pass.
        movedAssets.add(key);
      } else {
        explicitMapAssets.push(key);
      }
      if (coords.length >= 4) {
        component.width = coords[2];
        component.height = coords[3];
      }
      extras.push(component);
      extraIds.push(id);
      continue;
    }

    if (kind === 'MAP') {
      const resolved = resolveAssetKey(args[0] ?? '', variant);
      if (!resolved.key) {
        warnings.push(resolved.warning ?? 'MAP 缺少素材名');
        continue;
      }
      const entry = hmiAsset(resolved.key)!;
      const id = nextId('map');
      const component: Record<string, unknown> = {
        id,
        component: 'HmiAsset',
        asset: resolved.key,
        variant,
      };
      if (args[1] !== undefined) component.x = numberFrom(args[1], entry.rect.x);
      if (args[2] !== undefined) component.y = numberFrom(args[2], entry.rect.y);
      if (args[3] !== undefined) component.width = numberFrom(args[3], entry.rect.width);
      if (args[4] !== undefined) component.height = numberFrom(args[4], entry.rect.height);
      if (component.x !== undefined || component.y !== undefined) movedAssets.add(resolved.key);
      else explicitMapAssets.push(resolved.key);
      usedAssets.add(resolved.key);
      extras.push(component);
      extraIds.push(id);
      continue;
    }

    if (kind === 'CLIMATE') {
      const line = args.join(' ');
      const temps = [...line.matchAll(/(\d{1,2})\s*(?:度|°|℃)?/g)]
        .map(match => Number(match[1]))
        .filter(value => value >= 14 && value <= 32);
      const driver = line.match(/(?:主驾|驾驶员|左边)\D{0,4}(\d{1,2})/)?.[1];
      const passenger = line.match(/(?:副驾|乘客|右边)\D{0,4}(\d{1,2})/)?.[1];
      const fan = line.match(/(?:风量|风速)\D{0,3}(\d{1,2})/) ?? line.match(/(\d{1,2})\s*档/);
      if (driver) climate.driver = `${Number(driver)}°`;
      else if (temps.length) climate.driver = `${temps[0]}°`;
      if (passenger) climate.passenger = `${Number(passenger)}°`;
      else if (temps.length > 1) climate.passenger = `${temps[temps.length - 1]}°`;
      if (fan) climate.fan = `${Number(fan[1])} 档`;
      const mode = ['内循环', '外循环', '自动', '制冷', '制热'].find(word => line.includes(word));
      if (mode) climate.mode = mode;
      if (!Object.keys(climate).length) warnings.push('CLIMATE 没读出温度/风量，已退回原型默认值');
      continue;
    }

    if (kind === 'MEDIA') {
      const volume = args.join(' ').match(/(?:音量|volume)\D{0,3}(\d{1,3})/i);
      const words = args.filter(arg => !/^\d/.test(arg) && !/^(音量|volume)$/i.test(arg));
      if (words[0]) media.title = words[0];
      if (words.length > 1) media.artist = words.slice(1).join(' ');
      if (volume) media.volume = Math.min(100, Math.max(0, Number(volume[1])));
      if (!Object.keys(media).length) warnings.push('MEDIA 没读出歌名/音量，已退回原型默认值');
      continue;
    }

    if (kind === 'CONTROL') {
      const resolved = resolveAssetKey(args[0] ?? '', variant);
      let key = resolved.key;
      if (resolved.warning) warnings.push(resolved.warning);
      if (!key) {
        const pool = hmiAssetsOfGroup('controls').filter(asset => !usedAssets.has(asset.key));
        key = pool[0]?.key ?? null;
        if (key) warnings.push(`控件“${args[0] ?? ''}”没有对应素材，已改用 ${key}`);
      }
      if (!key) {
        warnings.push(`控件“${args[0] ?? ''}”没有可用素材，已跳过`);
        continue;
      }

      usedAssets.add(key);
      const id = nextId('ctl');
      const actionName = sanitizeAction(args[1] ?? `set_${key.replace(/-/g, '_')}`);
      const component: Record<string, unknown> = {
        id,
        component: 'HmiHotspot',
        asset: key,
        action: {event: {name: actionName, context: {}}},
        variant,
      };
      if (args[2]) component.label = args[2];

      // 小模型常把「空调调到 26 度」写成 CONTROL temp-driver …… 26度，不写 CLIMATE。
      // 这里顺手把数字并进 /climate、/media，座舱与媒体数据就不会还停在原型默认值。
      const stateNumber = args.slice(1).join(' ').match(/(\d{1,3})/)?.[1];
      if (stateNumber) {
        const value = Number(stateNumber);
        if (key === 'temp-driver' || key === 'temp-passenger') {
          const clamped = Math.min(32, Math.max(14, value));
          climate[key === 'temp-driver' ? 'driver' : 'passenger'] = `${clamped}°`;
          if (clamped !== value) warnings.push(`${key} 的温度 ${value} 超出 14–32，已收到 ${clamped}°`);
        } else if (key === 'fan-level') {
          climate.fan = `${Math.min(9, Math.max(0, value))} 档`;
        } else if (key === 'volume') {
          media.volume = Math.min(100, Math.max(0, value));
        }
      }

      extras.push(component);
      extraIds.push(id);
      continue;
    }

    if (kind === 'LABEL') {
      const sizeArg = args[args.length - 1];
      const hasSize = args.length >= 4 && /^\d+$/.test(sizeArg ?? '');
      const text = args.slice(0, hasSize ? -3 : -2).join(' ').trim() || args[0];
      const x = numberFrom(args[hasSize ? args.length - 3 : args.length - 2], 1400);
      const y = numberFrom(args[hasSize ? args.length - 2 : args.length - 1], 1000);
      if (!text) continue;
      const id = nextId('label');
      extras.push({
        id,
        component: 'HmiText',
        text,
        x,
        y,
        size: hasSize ? Number(sizeArg) : 28,
        font: 'cn',
        variant,
      });
      extraIds.push(id);
      continue;
    }
  }

  const archetype = ARCHETYPES[archetypeKey] ?? ARCHETYPES.navigation;

  // 原型先给出这套界面该有的数据，模型写的行覆盖它。
  Object.assign(data, archetype.data());
  if (Object.keys(climate).length) data.climate = {...((data.climate as Record<string, unknown>) ?? {}), ...climate};
  if (Object.keys(media).length) data.media = {...((data.media as Record<string, unknown>) ?? {}), ...media};
  if (cards.length) data.cards = cards;
  else {
    const seeded = archetypeCards(archetypeKey, data);
    if (seeded.length) data.cards = seeded;
  }
  data['nav'] = {...((data.nav as Record<string, unknown>) ?? {}), distance: nav.distance, label: nav.label, road: nav.road};
  data['route'] = {...((data.route as Record<string, unknown>) ?? {}), distance: route.distance, time: route.time};
  data['speed'] = speed;
  if (statusText) data.status = {...((data.status as Record<string, unknown>) ?? {}), text: statusText};

  const slotsForScreen = archetypeSlots(archetypeKey);
  for (const slot of shownSlots) if (!slotsForScreen.includes(slot)) slotsForScreen.push(slot);
  const activeSlots = slotsForScreen.filter(slot => !hiddenSlots.has(slot));

  // 模型把某个挂件的数据写了进去，但这个原型没有那个挂件：把挂件加回来，
  // 别让数据写进一个没人画的地方（实测 parking 原型没有导航卡，NAV 就白写了）。
  const needSlot = (slot: SlotName, needed: boolean, label: string) => {
    if (!needed || activeSlots.includes(slot)) return;
    if (hiddenSlots.has(slot)) {
      warnings.push(`${label}有数据，但被 HIDE 摘掉了，画面上看不到它`);
      return;
    }
    activeSlots.push(slot);
    warnings.push(`${label}有数据，但「${label}」不在原型「${archetype.name}」里，已自动加回`);
  };
  needSlot('nav', navWritten, '导航卡');
  needSlot('route', routeWritten, '路线条');
  needSlot('hud', cards.length > 0, '卡片');

  const composeContext: ComposeContext = {
    variant,
    archetype: archetypeKey,
    data,
    states: {},
    warnings,
    usedSlots: new Set<SlotName>(),
    hiddenAssets: movedAssets,
    nextId,
  };

  const chromeIds: string[] = [];
  const push = (component: Record<string, unknown>) => {
    components.push(component);
    chromeIds.push(component.id as string);
  };

  if (!bare && mode === 'composed') {
    for (const component of composeScreenSlots(activeSlots, composeContext)) push(component);
  } else if (!bare) {
    // 整块原稿：外观照原稿，只是可以按槽位开关。
    const compositeFor: Partial<Record<SlotName, {id: string; component: string}>> = {
      status: {id: 'status', component: 'HmiStatusBar'},
      nav: {id: 'nav', component: 'HmiNavInstruction'},
      route: {id: 'routeInfo', component: 'HmiRouteInfo'},
      gauge: {id: 'speed', component: 'HmiSpeedometer'},
      buttons: {id: 'buttons', component: 'HmiMapButtons'},
      zoom: {id: 'zoom', component: 'HmiZoomControl'},
      progress: {id: 'progress', component: 'HmiRouteProgress'},
      dash: {id: 'controlBar', component: 'HmiControlBar'},
    };
    for (const slot of activeSlots) {
      const spec = compositeFor[slot];
      if (!spec) continue;
      push({id: spec.id, component: spec.component, variant});
    }
    if (cards.length) {
      for (const component of composeScreenSlots(['hud'], composeContext)) push(component);
    }
  } else {
    push({id: 'nav', component: 'HmiNavInstruction', variant});
    push({id: 'routeInfo', component: 'HmiRouteInfo', variant});
    push({id: 'speed', component: 'HmiSpeedometer', variant});
  }

  // 每个热区的状态在数据模型里都有初值，端上第一次点击就有东西可改。
  const stateDefaults: Record<string, unknown> = {};
  for (const component of components) {
    const bind = component.bind as {path?: string} | undefined;
    if (component.component !== 'HmiHotspot' || !bind?.path) continue;
    const name = bind.path.split('/').pop() ?? '';
    if (!name || name in stateDefaults) continue;
    const actionContext = (component.action as {event?: {context?: Record<string, unknown>}})?.event?.context ?? {};
    stateDefaults[name] = actionContext.max !== undefined ? 0 : false;
  }
  if (Object.keys(stateDefaults).length) {
    data.state = {...((data.state as Record<string, unknown>) ?? {}), ...stateDefaults};
  }

  for (const icon of extraIcons) {
    const entry = hmiAsset(icon.asset);
    if (!entry) continue;
    const box = assetBox(entry);
    const id = nextId('iconExtra');
    extras.push({
      id,
      component: 'HmiAsset',
      asset: icon.asset,
      variant,
      x: box.left,
      y: box.top,
      width: box.width,
      height: box.height,
    });
    extraIds.push(id);
  }

  if (statusText && (bare || mode === 'panel')) {
    const clock = hmiAsset('clock');
    const box = clock ? assetBox(clock) : {left: 403, top: 43, width: 142, height: 25};
    push({
      id: nextId('statusText'),
      component: 'HmiText',
      text: statusText,
      x: box.left,
      y: box.top,
      width: box.width,
      size: 26,
      align: 'center',
      font: 'num',
      variant,
    });
  }

  components.push(...extras);

  const binding = {
    distance: {path: '/nav/distance'},
    label: {path: '/nav/label'},
    road: {path: '/nav/road'},
    remainingDistance: {path: '/route/distance'},
    remainingTime: {path: '/route/time'},
    speed: {path: '/speed'},
  };

  for (const component of components) {
    if (component.component === 'HmiNavInstruction') {
      component.distance = binding.distance;
      component.label = binding.label;
      component.road = binding.road;
    }
    if (component.component === 'HmiRouteInfo') {
      component.remainingDistance = binding.remainingDistance;
      component.remainingTime = binding.remainingTime;
    }
    if (component.component === 'HmiSpeedometer') {
      component.speed = binding.speed;
    }
  }

  const root: Record<string, unknown> = {
    id: 'root',
    component: 'HmiScreen',
    variant,
    children: [...chromeIds, ...extraIds],
  };
  if (movedAssets.size) root.hiddenAssets = [...movedAssets];
  if (!bare) {
    root.slots = activeSlots;
    root.assembly = mode;
  }
  // 按需覆盖物：模型点名要看的 POI/图层优先；否则用原型自带的覆盖物；都没有就照旧画全部。
  const requestedOverlays = explicitMapAssets.length
    ? [...new Set(explicitMapAssets)]
    : archetype.mapAssets.length
      ? [...archetype.mapAssets]
      : null;
  if (requestedOverlays) {
    const budget = mapOverlayBudget();
    if (requestedOverlays.length > budget) {
      warnings.push(`地图覆盖物 ${requestedOverlays.length} 个超过槽位容量 ${budget}，已截断`);
    }
    root.mapAssets = requestedOverlays.slice(0, budget);
  }

  return {
    components: [root, ...components],
    data,
    variant,
    warnings,
  };
}

/** A car screen is always a valid fallback: no blank page, never a web form. */
export function fallbackHmiComponents(request: string): {
  components: Record<string, unknown>[];
  data: Record<string, unknown>;
} {
  const compiled = compileHmiBlocks([], request);
  const reason = '生成结果没有通过校验，已显示默认车机界面。';
  compiled.components.push({
    id: 'fallbackNote',
    component: 'HmiText',
    text: reason,
    x: 140,
    y: 1000,
    size: 26,
    color: '#FF9C7A',
    font: 'cn',
    variant: compiled.variant,
  });
  compiled.components[0].children = [...(compiled.components[0].children as string[]), 'fallbackNote'];
  return {components: compiled.components, data: compiled.data};
}

export const HMI_SURFACE_ID_PREFIX = 'hmi-';

export function hmiSurfaceId(kind: 'gen' | 'fallback' = 'gen'): string {
  return `${HMI_SURFACE_ID_PREFIX}${kind}-${Date.now().toString(36)}`;
}

export function hmiMessagesHeader(surfaceId: string) {
  return {
    version: 'v0.9',
    createSurface: {
      surfaceId,
      catalogId: hmiCatalogId(),
      sendDataModel: true,
    },
  };
}

export function assetEntriesForPrompt(): HmiAssetEntry[] {
  return hmiAssetsOfGroup('controls');
}
