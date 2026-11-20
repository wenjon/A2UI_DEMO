import {
  assetBox,
  hmiAsset,
  hmiAssetSlot,
  hmiAssetsOfGroup,
  hmiSlot,
  type HmiAssetEntry,
  type HmiVariant,
} from './hmi-registry.ts';
import {
  ARCHETYPES,
  SLOT_ORDER,
  controlKeys,
  statusIconKeys,
  type SlotName,
} from './hmi-archetypes.ts';

/**
 * 部件级组装：挂件不再是一整块烧死的 SVG，而是「底板 + 独立图标 + 活文字 + 热区」的组合，
 * 坐标全部来自注册表（槽位 rect、拆解部件的实测 rect）。
 */

export type ComposedComponent = Record<string, unknown>;

export type ComposeContext = {
  variant: HmiVariant;
  archetype: string;
  data: Record<string, unknown>;
  states: Record<string, boolean | number>;
  warnings: string[];
  usedSlots: Set<SlotName>;
  hiddenAssets: Set<string>;
  nextId: (prefix: string) => string;
};

/** 拆解部件（group=parts），按语义名查找。 */
export function part(variant: HmiVariant, name: string): HmiAssetEntry | undefined {
  const direct = hmiAsset(`${variant}-${name}`);
  if (direct) return direct;
  const other = hmiAsset(`${variant === '3d' ? '2d' : '3d'}-${name}`);
  return other;
}

export function partsIn(slot: SlotName, variant: HmiVariant): HmiAssetEntry[] {
  return hmiAssetsOfGroup('parts', variant).filter(entry => hmiAssetSlot(entry.key) === slot);
}

function assetComponent(
  ctx: ComposeContext,
  entry: HmiAssetEntry,
  prefix: string,
  extra: Record<string, unknown> = {},
): ComposedComponent {
  const box = assetBox(entry);
  ctx.hiddenAssets.add(entry.key);
  return {
    id: ctx.nextId(prefix),
    component: 'HmiAsset',
    asset: entry.key,
    variant: ctx.variant,
    x: box.left,
    y: box.top,
    width: box.width,
    height: box.height,
    ...extra,
  };
}

function textComponent(
  ctx: ComposeContext,
  spec: {path: string; x: number; y: number; size: number; align?: 'left' | 'center'; font?: 'cn' | 'num'; literal?: string},
  prefix = 'text',
): ComposedComponent {
  return {
    id: ctx.nextId(prefix),
    component: 'HmiText',
    text: spec.literal ?? {path: spec.path},
    x: spec.x,
    y: spec.y,
    size: spec.size,
    ...(spec.align ? {align: spec.align} : {}),
    ...(spec.font ? {font: spec.font} : {}),
    variant: ctx.variant,
  };
}

function hotspotComponent(
  ctx: ComposeContext,
  spec: {x: number; y: number; width: number; height: number; action: string; state?: string; label?: string; context?: Record<string, unknown>},
): ComposedComponent {
  const component: ComposedComponent = {
    id: ctx.nextId('hot'),
    component: 'HmiHotspot',
    x: spec.x,
    y: spec.y,
    width: spec.width,
    height: spec.height,
    action: {event: {name: spec.action, context: spec.context ?? {}}},
    variant: ctx.variant,
  };
  if (spec.state) component.bind = {path: `/state/${spec.state}`};
  if (spec.label) component.label = spec.label;
  return component;
}

function panelComponent(
  ctx: ComposeContext,
  spec: {x: number; y: number; width: number; height: number; fill?: string; radius?: number; border?: string},
): ComposedComponent {
  return {
    id: ctx.nextId('panel'),
    component: 'HmiPanel',
    variant: ctx.variant,
    x: spec.x,
    y: spec.y,
    width: spec.width,
    height: spec.height,
    fill: spec.fill ?? '#0B1220',
    radius: spec.radius ?? 18,
    ...(spec.border ? {border: spec.border} : {}),
  };
}

function slotRect(name: SlotName) {
  const slot = hmiSlot(name);
  return slot ? slot.rect : {x: 0, y: 0, width: 0, height: 0};
}

function capacityOf(name: SlotName, requested: number): number {
  const capacity = hmiSlot(name)?.capacity ?? 99;
  if (requested > capacity) {
    return capacity;
  }
  return requested;
}

/** 状态栏：4 个图标 + 活时钟文字。 */
function composeStatus(ctx: ComposeContext): ComposedComponent[] {
  const out: ComposedComponent[] = [];
  const icons = statusIconKeys().filter(key => key !== 'clock');
  for (const key of icons) {
    const entry = hmiAsset(key);
    if (entry) out.push(assetComponent(ctx, entry, 'icon'));
  }
  const clock = hmiAsset('clock');
  const box = clock ? assetBox(clock) : {left: 403, top: 36, width: 142, height: 34};
  const existing = (ctx.data.status as Record<string, unknown> | undefined) ?? {};
  ctx.data.status = {...existing, text: existing.text ?? '10:21'};
  out.push(
    textComponent(ctx, {path: '/status/text', x: box.left, y: box.top, size: 26, align: 'center', font: 'num'}, 'text'),
  );
  return out;
}

/** 导航卡：底板 + 转向图标 + 三行活文字 + 整卡热区。 */
function composeNav(ctx: ComposeContext): ComposedComponent[] {
  const out: ComposedComponent[] = [];
  const plate = hmiAsset(`nav-instruction-card-${ctx.variant}-plate`) ?? hmiAsset(`nav-instruction-card-${ctx.variant}`);
  if (plate) out.push(assetComponent(ctx, plate, 'plate'));

  const icon = part(ctx.variant, 'nav-turn-icon');
  if (icon) out.push(assetComponent(ctx, icon, 'icon'));

  const texts = [
    {path: '/nav/distance', x: 308, y: 152, size: 44, font: 'num' as const},
    {path: '/nav/label', x: 467, y: 182, size: 40, font: 'cn' as const},
    {path: '/nav/road', x: 308, y: 226, size: 30, font: 'cn' as const},
  ];
  for (const spec of texts) out.push(textComponent(ctx, spec));

  const rect = slotRect('nav');
  out.push(
    hotspotComponent(ctx, {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      action: 'next_instruction',
      label: '下一条引导',
    }),
  );
  return out;
}

/** 路线条：底板（无烧死文字）+ 7 段活文字 + 暂停/退出热区。 */
function composeRoute(ctx: ComposeContext): ComposedComponent[] {
  const out: ComposedComponent[] = [];
  const bar = part(ctx.variant, 'route-bar') ?? hmiAsset(`route-info-bar-${ctx.variant}-plate`);
  if (bar) out.push(assetComponent(ctx, bar, 'plate'));

  const texts: {path?: string; literal?: string; x: number; y: number; size: number; font: 'cn' | 'num'}[] = [
    {literal: '剩余', x: 136, y: 362, size: 24, font: 'cn'},
    {path: '/route/distance', x: 206, y: 357, size: 30, font: 'num'},
    {literal: '公里', x: 244, y: 362, size: 24, font: 'cn'},
    {path: '/route/time', x: 306, y: 357, size: 30, font: 'num'},
    {literal: '分钟', x: 344, y: 362, size: 24, font: 'cn'},
    {path: '/route/action', x: 416, y: 362, size: 24, font: 'cn'},
  ];
  ctx.data.route = {...(ctx.data.route as object | undefined), action: '暂停'};
  for (const spec of texts) {
    out.push(
      textComponent(ctx, {
        path: spec.path ?? '/route/action',
        literal: spec.literal,
        x: spec.x,
        y: spec.y,
        size: spec.size,
        font: spec.font,
      }),
    );
  }

  out.push(
    hotspotComponent(ctx, {
      x: 410,
      y: 352,
      width: 64,
      height: 48,
      action: 'toggle_route_pause',
      state: 'routePause',
      label: '暂停',
      context: {field: '/route/action', on: '继续', off: '暂停'},
    }),
  );
  out.push(
    hotspotComponent(ctx, {x: 492, y: 352, width: 64, height: 48, action: 'exit_navigation', label: '退出'}),
  );
  return out;
}

/** 时速表：描边底板 + 大字数值 + 单位。 */
function composeGauge(ctx: ComposeContext): ComposedComponent[] {
  const out: ComposedComponent[] = [];
  const plate = hmiAsset(`speedometer-${ctx.variant}-plate`) ?? hmiAsset(`speedometer-${ctx.variant}`);
  if (plate) out.push(assetComponent(ctx, plate, 'plate'));
  out.push(textComponent(ctx, {path: '/speed', x: 120, y: 458, size: 46, font: 'num'}));
  out.push(textComponent(ctx, {literal: 'KM/H', path: '/speed', x: 120, y: 512, size: 22, font: 'num'}));
  return out;
}

/** 地图按钮组：合成图保留外观，但每个按钮有独立热区（从槽位几何推出）。 */
function composeButtons(ctx: ComposeContext): ComposedComponent[] {
  const out: ComposedComponent[] = [];
  const composite = hmiAsset(`map-buttons-${ctx.variant}`);
  const rect = slotRect('buttons');
  if (composite) out.push(assetComponent(ctx, composite, 'asset'));
  const names = ['toggle_compass', 'toggle_layers', 'recenter_map'];
  const labels = ['指北针', '图层', '回车位置'];
  const count = capacityOf('buttons', 3);
  for (let index = 0; index < count; index += 1) {
    out.push(
      hotspotComponent(ctx, {
        x: rect.x,
        y: rect.y + index * 80,
        width: rect.width,
        height: 60,
        action: names[index],
        state: names[index],
        label: labels[index],
        context: {button: index + 1},
      }),
    );
  }
  return out;
}

function composeZoom(ctx: ComposeContext): ComposedComponent[] {
  const out: ComposedComponent[] = [];
  const composite = hmiAsset(`zoom-control-${ctx.variant}`);
  const rect = slotRect('zoom');
  if (composite) out.push(assetComponent(ctx, composite, 'asset'));
  const count = capacityOf('zoom', 2);
  const specs = [
    {action: 'zoom_in', label: '放大', delta: 1},
    {action: 'zoom_out', label: '缩小', delta: -1},
  ];
  for (let index = 0; index < count && index < specs.length; index += 1) {
    out.push(
      hotspotComponent(ctx, {
        x: rect.x,
        y: rect.y + index * 60,
        width: rect.width,
        height: 60,
        action: specs[index].action,
        label: specs[index].label,
        context: {delta: specs[index].delta},
      }),
    );
  }
  return out;
}

function composeProgress(ctx: ComposeContext): ComposedComponent[] {
  const out: ComposedComponent[] = [];
  const composite = hmiAsset(`route-progress-${ctx.variant}`);
  if (composite) out.push(assetComponent(ctx, composite, 'asset'));
  const rect = slotRect('progress');
  out.push(
    hotspotComponent(ctx, {x: rect.x, y: rect.y, width: rect.width, height: 120, action: 'focus_route', label: '查看全程'}),
  );
  return out;
}

/** 车控栏：底板换成面板，11 个控件用拆解部件，温度/风量是活文字，每个控件都是热区。 */
function composeDash(ctx: ComposeContext, options: {showCompositeBar?: boolean} = {}): ComposedComponent[] {
  const out: ComposedComponent[] = [];
  const rect = slotRect('dash');

  if (options.showCompositeBar) {
    const composite = hmiAsset(`control-bar-${ctx.variant}`);
    if (composite) out.push(assetComponent(ctx, composite, 'asset'));
  } else {
    out.push(
      panelComponent(ctx, {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        fill: 'rgba(8,14,24,0.86)',
        radius: 0,
      }),
    );
  }

  const liveTexts: Record<string, {path: string; literal?: string; x: number; y: number; size: number; font: 'cn' | 'num'}> = {
    'temp-driver': {path: '/climate/driver', x: 777, y: 1119, size: 30, font: 'num'},
    'temp-passenger': {path: '/climate/passenger', x: 1075, y: 1119, size: 30, font: 'num'},
    'fan-level': {path: '/climate/fan', x: 931, y: 1106, size: 26, font: 'cn'},
  };

  const actions: Record<string, {action: string; state?: string; label: string; context?: Record<string, unknown>}> = {
    'vehicle-model3': {action: 'open_vehicle_menu', label: '车辆'},
    defrost: {action: 'toggle_defrost', state: 'defrost', label: '除霜'},
    heater: {action: 'toggle_heater', state: 'heater', label: '加热'},
    'seat-driver': {action: 'toggle_seat_heat', state: 'seatDriver', label: '主驾座椅'},
    'seat-passenger': {action: 'toggle_seat_heat', state: 'seatPassenger', label: '副驾座椅', context: {side: 'passenger'}},
    'fan-level': {action: 'cycle_fan_level', state: 'fan', label: '风量', context: {max: 4}},
    'temp-driver': {action: 'raise_temp', state: 'tempDriver', label: '主驾温度', context: {side: 'driver', delta: 1}},
    'temp-passenger': {action: 'raise_temp', state: 'tempPassenger', label: '副驾温度', context: {side: 'passenger', delta: 1}},
    music: {action: 'open_media', state: 'media', label: '媒体'},
    phone: {action: 'open_phone', label: '电话'},
    volume: {action: 'cycle_volume', state: 'volume', label: '音量', context: {max: 100}},
  };

  const keys = controlKeys();
  const budget = capacityOf('dash', keys.length);
  let placed = 0;
  for (const key of keys) {
    if (placed >= budget) {
      ctx.warnings.push(`dash 槽位容量 ${budget} 已满，控件“${key}”未放置`);
      continue;
    }
    placed += 1;
    const entry = hmiAsset(key);
    if (!entry) continue;
    const live = liveTexts[key];
    if (live && !options.showCompositeBar) {
      out.push(textComponent(ctx, live, 'dashText'));
    } else if (!live) {
      out.push(assetComponent(ctx, entry, 'ctl'));
    }
    const action = actions[key];
    if (!action) continue;
    const box = assetBox(entry);
    const hitWidth = Math.max(56, box.width + 16);
    const hitHeight = Math.max(56, box.height + 16);
    out.push(
      hotspotComponent(ctx, {
        x: Math.round(box.left + box.width / 2 - hitWidth / 2),
        y: Math.round(box.top + box.height / 2 - hitHeight / 2),
        width: hitWidth,
        height: hitHeight,
        action: action.action,
        state: action.state,
        label: action.label,
        context: action.context,
      }),
    );
  }
  return out;
}

/** HUD 卡：面板 + 标题 + 正文（内容来自数据模型，可被后续 updateDataModel 改）。 */
function composeHud(ctx: ComposeContext): ComposedComponent[] {
  const out: ComposedComponent[] = [];
  const rect = slotRect('hud');
  const cards = (ctx.data.cards as {title: string; body: string; group: string}[]) ?? [];
  if (!cards.length) return out;

  const budget = capacityOf('hud', cards.length);
  const height = Math.min(150, Math.floor(rect.height / Math.min(cards.length, 3)));
  cards.slice(0, budget).forEach((card, index) => {
    const top = rect.y + index * (height + 16);
    out.push(
      panelComponent(ctx, {
        x: rect.x,
        y: top,
        width: Math.min(rect.width, 520),
        height,
        fill: 'rgba(10,18,30,0.78)',
        radius: 22,
        border: 'rgba(120,180,255,0.28)',
      }),
    );
    out.push(
      textComponent(ctx, {path: `/cards/${index}/title`, literal: card.title, x: rect.x + 28, y: top + 22, size: 34, font: 'cn'}, 'cardText'),
    );
    out.push(
      textComponent(ctx, {path: `/cards/${index}/body`, literal: card.body, x: rect.x + 28, y: top + 68, size: 24, font: 'cn'}, 'cardText'),
    );
    out.push(
      hotspotComponent(ctx, {
        x: rect.x,
        y: top,
        width: Math.min(rect.width, 520),
        height,
        action: 'select_card',
        label: card.title,
        context: {card: index, group: card.group ?? 'hud'},
      }),
    );
  });
  return out;
}

const EMITTERS: Partial<Record<SlotName, (ctx: ComposeContext) => ComposedComponent[]>> = {
  status: composeStatus,
  nav: composeNav,
  route: composeRoute,
  gauge: composeGauge,
  buttons: composeButtons,
  zoom: composeZoom,
  progress: composeProgress,
  dash: ctx => composeDash(ctx),
  hud: composeHud,
};

export function composeSlot(slot: SlotName, ctx: ComposeContext): ComposedComponent[] {
  const emit = EMITTERS[slot];
  if (!emit) return [];
  return emit(ctx);
}

export function composeScreenSlots(
  slots: SlotName[],
  ctx: ComposeContext,
  options: {compositeDash?: boolean} = {},
): ComposedComponent[] {
  const out: ComposedComponent[] = [];
  for (const slot of SLOT_ORDER) {
    if (!slots.includes(slot) || slot === 'map') continue;
    ctx.usedSlots.add(slot);
    if (slot === 'dash' && options.compositeDash) {
      out.push(...composeDash(ctx, {showCompositeBar: true}));
      continue;
    }
    out.push(...composeSlot(slot, ctx));
  }
  return out;
}

export function archetypeSlots(key: string): SlotName[] {
  const archetype = ARCHETYPES[key] ?? ARCHETYPES.navigation;
  return archetype.slots.filter(slot => slot !== 'map');
}

export function mapOverlayBudget(): number {
  return hmiSlot('map')?.capacity ?? 12;
}

export {slotRect};
