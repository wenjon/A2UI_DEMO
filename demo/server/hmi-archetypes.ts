import {hmiAsset, hmiAssetsOfGroup, type HmiVariant} from './hmi-registry.ts';

/**
 * Screen archetypes.
 *
 * An archetype decides *which slots are on the screen*, *what goes into each
 * slot*, and *which map overlays get drawn* — so two different requests compile
 * into two different component trees instead of the same nine widgets with new
 * text. Every part is placed from registry geometry, never from a baked panel.
 */

export type SlotName =
  | 'status'
  | 'nav'
  | 'route'
  | 'gauge'
  | 'buttons'
  | 'zoom'
  | 'progress'
  | 'dash'
  | 'map'
  | 'hud';

export const SLOT_ORDER: SlotName[] = [
  'map',
  'hud',
  'nav',
  'route',
  'gauge',
  'buttons',
  'zoom',
  'progress',
  'dash',
  'status',
];

export const SLOT_ALIASES: Record<string, SlotName> = {
  bar: 'status',
  statusbar: 'status',
  状态栏: 'status',
  navcard: 'nav',
  navcard3d: 'nav',
  导航卡: 'nav',
  导航: 'nav',
  routebar: 'route',
  路线条: 'route',
  剩余: 'route',
  speed: 'gauge',
  gauge: 'gauge',
  时速表: 'gauge',
  仪表: 'gauge',
  buttons: 'buttons',
  mapbuttons: 'buttons',
  按钮组: 'buttons',
  zoom: 'zoom',
  缩放: 'zoom',
  缩放控件: 'zoom',
  progress: 'progress',
  routeprogress: 'progress',
  进度条: 'progress',
  dash: 'dash',
  controlbar: 'dash',
  carbar: 'dash',
  车控栏: 'dash',
  车控: 'dash',
  hud: 'hud',
  card: 'hud',
  卡片: 'hud',
  自由区: 'hud',
  map: 'map',
  地图: 'map',
};

export type SlotRecipe = {
  /** Panel backdrop: the asset key of the exported plate (drawn first). */
  plate?: string;
  /** A single composite asset used instead of individual parts. */
  composite?: string;
  /** Individual icon / control assets, kept at their own design coordinates. */
  assets?: string[];
  /** Text parts: [dataModel path or literal, x, y, size, align, font]. */
  texts?: {key: string; value?: string; x: number; y: number; size: number; align?: 'left' | 'center'; font?: 'cn' | 'num'}[];
  /** Controls in this slot become hotspots with these action names. */
  hotspots?: {asset: string; action: string; label?: string; state?: string}[];
  /** True when the slot's own assets should be tappable by default. */
  tappable?: boolean;
};

export type Archetype = {
  key: string;
  name: string;
  /** Slots rendered on this screen, in paint order. */
  slots: SlotName[];
  /** Map overlays drawn by HmiScreen, in registry order. */
  mapAssets: string[];
  /** Data model defaults the archetype starts with. */
  data: () => Record<string, unknown>;
  /** Per-slot content. Slots missing here fall back to the slot defaults. */
  recipes?: Partial<Record<SlotName, SlotRecipe>>;
};

/** Text offsets measured from the verified render of the exported panels. */
const NAV_TEXTS: SlotRecipe['texts'] = [
  {key: 'distance', x: 308, y: 152, size: 44, font: 'num'},
  {key: 'label', x: 467, y: 182, size: 40, font: 'cn'},
  {key: 'road', x: 308, y: 226, size: 30, font: 'cn'},
];

const ROUTE_TEXTS: SlotRecipe['texts'] = [
  {key: 'remainLabel', value: '剩余', x: 136, y: 356, size: 22, font: 'cn'},
  {key: 'distance', x: 208, y: 350, size: 26, font: 'num'},
  {key: 'distanceUnit', value: '公里', x: 244, y: 356, size: 22, font: 'cn'},
  {key: 'time', x: 308, y: 350, size: 26, font: 'num'},
  {key: 'timeUnit', value: '分钟', x: 344, y: 356, size: 22, font: 'cn'},
  {key: 'pauseLabel', value: '暂停', x: 416, y: 356, size: 22, font: 'cn'},
  {key: 'exitLabel', value: '退出', x: 498, y: 356, size: 22, font: 'cn'},
];

const GAUGE_TEXTS: SlotRecipe['texts'] = [
  {key: 'speed', x: 120, y: 458, size: 46, font: 'num'},
  {key: 'speedUnit', value: 'KM/H', x: 120, y: 512, size: 22, font: 'num'},
];

function plateFor(componentAsset: string, variant: HmiVariant): string | undefined {
  const key = `${componentAsset}-plate`;
  return hmiAsset(key) ? key : hmiAsset(`${componentAsset}-${variant}`) ? `${componentAsset}-${variant}` : undefined;
}

/** All POI / marker / route assets of a variant, registry order. */
export function mapOverlayKeys(variant: HmiVariant): string[] {
  const rank = (kind: string) => (kind === 'route' ? 0 : kind === 'poi' ? 1 : 2);
  return hmiAssetsOfGroup('map', variant)
    .filter(asset => asset.kind === 'route' || asset.kind === 'poi' || asset.kind === 'marker')
    .sort((a, b) => rank(a.kind) - rank(b.kind) || a.rect.x - b.rect.x)
    .map(asset => asset.key);
}

export function statusIconKeys(): string[] {
  return hmiAssetsOfGroup('status-icons')
    .filter(asset => asset.kind === 'icon')
    .sort((a, b) => a.rect.x - b.rect.x)
    .map(asset => asset.key);
}

export function controlKeys(): string[] {
  return hmiAssetsOfGroup('controls')
    .slice()
    .sort((a, b) => a.rect.x - b.rect.x)
    .map(asset => asset.key);
}

const DEFAULT_DATA = () => ({
  nav: {distance: '268 米后', label: '进入', road: '世纪大道西辅路'},
  route: {distance: '20', time: '36'},
  speed: 63,
  status: {text: '10:21'},
});

export const ARCHETYPES: Record<string, Archetype> = {
  navigation: {
    key: 'navigation',
    name: '导航中',
    slots: ['map', 'status', 'nav', 'route', 'gauge', 'buttons', 'zoom', 'progress', 'dash'],
    mapAssets: [],
    data: DEFAULT_DATA,
  },
  parking: {
    key: 'parking',
    name: '找车位',
    slots: ['map', 'status', 'hud', 'gauge', 'buttons', 'dash'],
    mapAssets: ['poi-parking-3d', 'location-halo-3d'],
    data: () => ({
      ...DEFAULT_DATA(),
      search: {title: '附近停车场', count: '3 处', nearest: '180 米', lots: '中央商场 · 180 米|老码头地下库 · 420 米|外滩观景停车库 · 760 米'},
    }),
  },
  media: {
    key: 'media',
    name: '媒体',
    slots: ['map', 'status', 'hud', 'gauge', 'dash'],
    mapAssets: ['location-halo-3d'],
    data: () => ({
      ...DEFAULT_DATA(),
      media: {title: '夜航', artist: '港口电台 · FM 92.1', volume: 42, position: '2:14 / 4:38'},
    }),
  },
  climate: {
    key: 'climate',
    name: '空调',
    slots: ['map', 'status', 'hud', 'gauge', 'dash'],
    mapAssets: ['location-halo-3d'],
    data: () => ({
      ...DEFAULT_DATA(),
      climate: {driver: '22°', passenger: '24°', fan: '2 档', mode: '内循环'},
    }),
  },
  arrival: {
    key: 'arrival',
    name: '即将到达',
    slots: ['map', 'status', 'nav', 'route', 'gauge', 'progress', 'dash'],
    mapAssets: ['poi-parking-3d', 'location-halo-3d'],
    data: () => ({
      ...DEFAULT_DATA(),
      arrival: {title: '已到达目的地附近', note: '世纪大道西辅路 · 建议靠右停车'},
    }),
  },
};

const ARCHETYPE_ALIASES: Record<string, string> = {
  导航: 'navigation',
  导航中: 'navigation',
  巡航: 'navigation',
  nav: 'navigation',
  driving: 'navigation',
  找车位: 'parking',
  停车: 'parking',
  停车场: 'parking',
  parking: 'parking',
  媒体: 'media',
  音乐: 'media',
  收音机: 'media',
  歌: 'media',
  media: 'media',
  music: 'media',
  空调: 'climate',
  温度: 'climate',
  除霜: 'climate',
  climate: 'climate',
  hvac: 'climate',
  到达: 'arrival',
  终点: 'arrival',
  即将到达: 'arrival',
  arrival: 'arrival',
};

const ARCHETYPE_HINTS: {re: RegExp; key: string}[] = [
  {re: /停车|车位|parking/i, key: 'parking'},
  {re: /音乐|歌|媒体|电台|收音机|music|radio|播放/i, key: 'media'},
  {re: /空调|温度|除霜|风扇|加热|climate|hvac/i, key: 'climate'},
  {re: /到达|终点|抵达|arrival|靠右停车/i, key: 'arrival'},
];

/** 原型自带的 HUD 卡片内容：模型没写 CARD 时，HUD 卡也不至于空着。 */
export function archetypeCards(key: string, data: Record<string, unknown>): {title: string; body: string; group: string}[] {
  const text = (value: unknown) => (typeof value === 'string' ? value : String(value ?? ''));
  const pick = (name: string) => (data[name] as Record<string, unknown> | undefined) ?? {};
  if (key === 'parking') {
    const search = pick('search');
    return [{title: text(search.title) || '附近停车场', body: `${text(search.count) || '3 处'} · 最近 ${text(search.nearest) || '180 米'}`, group: 'hud'}];
  }
  if (key === 'media') {
    const media = pick('media');
    return [{title: text(media.title) || '正在播放', body: `${text(media.artist)} · ${text(media.position)} · 音量 ${text(media.volume)}`, group: 'hud'}];
  }
  if (key === 'climate') {
    const climate = pick('climate');
    return [{title: '座舱空调', body: `主驾 ${text(climate.driver) || '22°'} · 副驾 ${text(climate.passenger) || '24°'} · 风量 ${text(climate.fan) || '2 档'}`, group: 'hud'}];
  }
  if (key === 'arrival') {
    const arrival = pick('arrival');
    return [{title: text(arrival.title) || '已到达目的地附近', body: text(arrival.note) || '建议靠右停车', group: 'hud'}];
  }
  return [];
}

export function archetypeFromRequest(request: string): string {
  for (const hint of ARCHETYPE_HINTS) {
    if (hint.re.test(request)) return hint.key;
  }
  return 'navigation';
}

export function resolveArchetype(raw: string | undefined): {key: string; warning?: string} {
  if (!raw) return {key: 'navigation'};
  const cleaned = raw.trim().toLowerCase();
  const direct = ARCHETYPES[cleaned];
  if (direct) return {key: direct.key};
  const aliased = ARCHETYPE_ALIASES[raw.trim()] ?? ARCHETYPE_ALIASES[cleaned];
  if (aliased && ARCHETYPES[aliased]) return {key: aliased};
  return {key: 'navigation', warning: `界面原型“${raw}”不存在，已用 navigation`};
}

/** Default slot recipes: plate + individual parts, built from the registry. */
export function slotRecipe(slot: SlotName, variant: HmiVariant): SlotRecipe {
  switch (slot) {
    case 'status':
      return {assets: statusIconKeys(), texts: [{key: 'status', x: 403, y: 36, size: 26, align: 'center', font: 'num'}]};
    case 'nav':
      return {plate: plateFor('nav-instruction-card', variant), texts: NAV_TEXTS};
    case 'route':
      return {plate: plateFor('route-info-bar', variant), texts: ROUTE_TEXTS};
    case 'gauge':
      return {plate: plateFor('speedometer', variant), texts: GAUGE_TEXTS};
    case 'buttons':
      return {composite: `map-buttons-${variant}`};
    case 'zoom':
      return {composite: `zoom-control-${variant}`};
    case 'progress':
      return {composite: `route-progress-${variant}`};
    case 'dash':
      return {composite: `control-bar-${variant}`};
    case 'map':
    case 'hud':
      return {};
    default:
      return {};
  }
}

export function archetypeList(): {key: string; name: string; slots: SlotName[]}[] {
  return Object.values(ARCHETYPES).map(a => ({key: a.key, name: a.name, slots: a.slots}));
}
