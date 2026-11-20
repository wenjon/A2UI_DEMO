import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {ComponentSpec, PropSpec} from './catalog.ts';

/**
 * Server-side view of the shared HMI asset registry
 * (demo/shared/hmi-registry.json, produced by sketch-tools/gen-hmi-registry.js).
 *
 * The same file is imported by demo/src/hmi/asset-registry.ts, so the prompt,
 * the validator and the renderer all agree on which assets exist, where they sit
 * in the 1920x1200 design space, and how much stroke bleed they carry.
 */

export type HmiVariant = '3d' | '2d';

export type HmiAssetEntry = {
  key: string;
  name: string;
  group: string;
  kind: string;
  variant: HmiVariant | null;
  src: string;
  rect: {x: number; y: number; width: number; height: number};
  bleed: {x: number; y: number};
  svg: {width: number; height: number; viewBox: string | null};
  childCount: number;
  text: string | null;
  /** 该素材属于哪个槽位（由生成器从几何推出来）。 */
  slot?: string | null;
  /** 拆解部件的触控盒（至少 56x56）。 */
  hit?: {x: number; y: number; width: number; height: number} | null;
  /** 拆解部件所在的语义容器名。 */
  context?: string | null;
};

export type HmiSlot = {
  name: string;
  rect: {x: number; y: number; width: number; height: number};
  z: number;
  layout: string;
  anchorAsset: string | null;
  capacity: number;
};

export type HmiRegistry = {
  catalogId: string;
  design: {width: number; height: number};
  groups: Record<string, number>;
  slots: Record<string, HmiSlot>;
  assets: HmiAssetEntry[];
  byKey: Map<string, HmiAssetEntry>;
  loaded: boolean;
};

const FALLBACK_CATALOG_ID = 'https://luckplusone.cfifa.com/a2ui/hmi/catalog.json';
const here = path.dirname(fileURLToPath(import.meta.url));

export const registryPath =
  process.env.A2UI_HMI_REGISTRY ??
  path.resolve(here, '../shared/hmi-registry.json');

let cached: HmiRegistry | null = null;

export function getHmiRegistry(): HmiRegistry {
  if (cached) return cached;

  let assets: HmiAssetEntry[] = [];
  let catalogId = FALLBACK_CATALOG_ID;
  let design = {width: 1920, height: 1200};
  let groups: Record<string, number> = {};
  let slots: Record<string, HmiSlot> = {};
  let loaded = false;

  try {
    const raw = JSON.parse(readFileSync(registryPath, 'utf8')) as {
      catalogId?: string;
      design?: {width?: number; height?: number};
      groups?: Record<string, number>;
      slots?: Record<string, HmiSlot>;
      assets?: HmiAssetEntry[];
    };
    assets = Array.isArray(raw.assets) ? raw.assets : [];
    catalogId = raw.catalogId ?? FALLBACK_CATALOG_ID;
    design = {
      width: raw.design?.width ?? 1920,
      height: raw.design?.height ?? 1200,
    };
    groups = raw.groups ?? {};
    slots = raw.slots ?? {};
    loaded = assets.length > 0;
  } catch {
    cached = {
      catalogId,
      design,
      groups,
      slots,
      assets,
      byKey: new Map(),
      loaded: false,
    };
    return cached;
  }

  cached = {
    catalogId,
    design,
    groups,
    slots,
    assets,
    byKey: new Map(assets.map(asset => [asset.key, asset])),
    loaded,
  };
  return cached;
}

export function hmiSlots(): Record<string, HmiSlot> {
  return getHmiRegistry().slots;
}

export function hmiSlot(name: string): HmiSlot | undefined {
  return getHmiRegistry().slots[name];
}

export function hmiAssetSlot(key: string): string | undefined {
  return hmiAsset(key)?.slot ?? undefined;
}

export function hmiCatalogId(): string {
  return getHmiRegistry().catalogId;
}

export function isHmiComponent(name: string): boolean {
  return name.startsWith('Hmi');
}

export function hmiAsset(key: string): HmiAssetEntry | undefined {
  return getHmiRegistry().byKey.get(key);
}

export function hmiAssetsOfGroup(group: string, variant?: HmiVariant): HmiAssetEntry[] {
  return getHmiRegistry().assets.filter(
    asset => asset.group === group && (variant === undefined || asset.variant === variant),
  );
}

// Chinese and English names a model is likely to write, mapped to manifest keys.
export const ASSET_ALIASES: Record<string, string> = {
  音量: 'volume',
  声音: 'volume',
  volume: 'volume',
  电话: 'phone',
  通话: 'phone',
  phone: 'phone',
  音乐: 'music',
  媒体: 'music',
  music: 'music',
  座椅: 'seat-driver',
  主驾: 'seat-driver',
  副驾: 'seat-passenger',
  座椅副驾: 'seat-passenger',
  温度: 'temp-driver',
  主驾温度: 'temp-driver',
  副驾温度: 'temp-passenger',
  空调: 'temp-driver',
  风扇: 'fan-level',
  风量: 'fan-level',
  加热: 'heater',
  座椅加热: 'heater',
  除霜: 'defrost',
  前挡: 'defrost',
  车型: 'vehicle-model3',
  车辆: 'vehicle-model3',
  锁: 'lock',
  解锁: 'lock',
  蓝牙: 'bluetooth',
  信号: 'cell-signal',
  微信: 'wechat',
  时间: 'clock',
  时钟: 'clock',
  停车场: 'poi-parking',
  停车: 'poi-parking',
  车位: 'poi-parking',
  商场: 'poi-mall',
  购物中心: 'poi-mall',
  公园: 'poi-garden',
  花园: 'poi-garden',
  绿地: 'poi-garden',
  地标: 'poi-pin',
  终点: 'poi-pin',
  状态栏: 'status-bar-3d',
  车控栏: 'control-bar-3d',
  路线: 'route-path-3d',
  路径: 'route-path-3d',
  进度条: 'route-progress-3d',
  放大: 'zoom-control-3d',
  缩放: 'zoom-control-3d',
  地图按钮: 'map-buttons-3d',
  导航卡: 'nav-instruction-card-3d-plate',
  时速表: 'speedometer-3d-plate',
  路线条: 'route-info-bar-3d-plate',
};

function withVariantSuffix(key: string, variant: HmiVariant): string {
  if (/-[23]d$/.test(key)) return key;
  const sibling = `${key}-${variant}`;
  if (hmiAsset(sibling)) return sibling;
  return key;
}

/** Map whatever the model wrote to a real asset key, or report why it failed. */
export function resolveAssetKey(
  raw: string,
  variant: HmiVariant,
): {key: string | null; warning?: string} {
  const trimmed = raw.trim().replace(/^\/+|\/+$/g, '');
  if (!trimmed) return {key: null, warning: '素材名为空'};

  const registry = getHmiRegistry();
  const lowered = trimmed.toLowerCase();

  const direct = registry.byKey.get(trimmed)
    ? trimmed
    : registry.assets.find(asset => asset.key.toLowerCase() === lowered)?.key;
  if (direct) {
    const sibling = withVariantSuffix(direct, variant);
    if (registry.byKey.has(sibling)) return {key: sibling};
    return {key: direct};
  }

  const alias = ASSET_ALIASES[trimmed] ?? ASSET_ALIASES[lowered];
  if (alias) {
    const sibling = withVariantSuffix(alias, variant);
    if (registry.byKey.has(sibling)) return {key: sibling};
    if (registry.byKey.has(alias)) return {key: alias};
  }

  // Loose match on the descriptive part, e.g. "poi-parking" -> "poi-parking-3d".
  const stem = lowered.replace(/-?[23]d$/, '');
  const candidate = registry.assets.find(
    asset => asset.group === 'map' && asset.variant === variant && asset.key.toLowerCase().startsWith(stem),
  );
  if (candidate) return {key: candidate.key};

  return {
    key: null,
    warning: `未知素材“${trimmed}”，可用素材见 MAP/CONTROL 说明`,
  };
}

/** Absolute placement for an asset, including the stroke bleed the SVG keeps. */
export function assetBox(
  entry: HmiAssetEntry,
  override?: Partial<{x: number; y: number; width: number; height: number}>,
): {left: number; top: number; width: number; height: number} {
  const design = getHmiRegistry().design;
  const width = Math.max(
    1,
    Math.round(override?.width ?? entry.rect.width + entry.bleed.x * 2),
  );
  const height = Math.max(
    1,
    Math.round(override?.height ?? entry.rect.height + entry.bleed.y * 2),
  );
  const x = override?.x ?? entry.rect.x - entry.bleed.x;
  const y = override?.y ?? entry.rect.y - entry.bleed.y;
  return {
    left: Math.max(-design.width, Math.min(design.width * 2, Math.round(x))),
    top: Math.max(-design.height, Math.min(design.height * 2, Math.round(y))),
    width,
    height,
  };
}

export function promptAssetText(variant: HmiVariant = '3d'): string {
  const groups: [string, string][] = [
    ['controls', 'CONTROL 车控按钮'],
    ['status-icons', 'STATUS 状态图标'],
    ['map', 'POI / MAP 地图覆盖物'],
    ['plates', 'MAP 无字底板（配 LABEL 自己写字）'],
  ];
  const lines: string[] = [];
  for (const [group, label] of groups) {
    const keys = hmiAssetsOfGroup(group)
      .filter(asset => asset.variant !== (variant === '3d' ? '2d' : '3d'))
      .map(asset => asset.key);
    if (keys.length) lines.push(`${label}：${keys.join(', ')}`);
  }
  return lines.join('\n');
}

const COMMON = new Set(['id', 'component', 'weight', 'accessibility']);

function spec(
  name: string,
  purpose: string,
  props: PropSpec[],
  required: string[] = [],
  extraProps: string[] = [],
): ComponentSpec {
  return {
    name,
    purpose,
    props,
    required,
    allowedProps: new Set([
      ...props.map(prop => prop.name),
      ...extraProps,
      ...COMMON,
    ]),
  };
}

const dynamicString = (name: string, required = false): PropSpec => ({
  name,
  type: 'dynamicString',
  required,
});

const designNumber = (name: string, required = false): PropSpec => ({
  name,
  type: 'number',
  required,
});

const variantProp = (): PropSpec => ({
  name: 'variant',
  type: 'enum',
  required: false,
  enumValues: ['3d', '2d'],
  defaultValue: '3d',
});

/** Server-side mirror of the HMI catalog in demo/src/hmi/hmi-catalog.tsx. */
export function hmiComponentSpecs(): Map<string, ComponentSpec> {
  const specs = [
    spec(
      'HmiScreen',
      '车机横屏画布（1920×1200 设计空间，自动等比缩放）',
      [
        {name: 'children', type: 'array<string>', required: true},
        variantProp(),
        {name: 'hiddenAssets', type: 'array<string>', required: false},
        {name: 'mapAssets', type: 'array<string>', required: false},
        {name: 'slots', type: 'array<string>', required: false},
        {
          name: 'assembly',
          type: 'enum',
          required: false,
          enumValues: ['composed', 'panel'],
          defaultValue: 'composed',
        },
      ],
      ['children'],
    ),
    spec('HmiNavInstruction', '左上导航指引卡：距离 + 动作 + 路名', [
      dynamicString('distance'),
      dynamicString('road'),
      dynamicString('label'),
      variantProp(),
    ]),
    spec('HmiRouteInfo', '路线剩余信息条：公里 + 分钟', [
      dynamicString('remainingDistance'),
      dynamicString('remainingTime'),
      variantProp(),
    ]),
    spec('HmiSpeedometer', '时速表（数字 + KM/H）', [
      {name: 'speed', type: 'number', required: false},
      variantProp(),
    ]),
    spec('HmiStatusBar', '状态栏素材（微信/锁/蓝牙/信号/时间）', [variantProp()]),
    spec('HmiMapButtons', '地图右侧按钮组素材', [variantProp()]),
    spec('HmiZoomControl', '地图缩放控件素材', [variantProp()]),
    spec('HmiRouteProgress', '路线进度条素材', [variantProp()]),
    spec('HmiControlBar', '底部车控栏素材', [variantProp()]),
    spec(
      'HmiAsset',
      '按素材 key 放任意 HMI 素材（自动带描边出血）',
      [dynamicString('asset', true), designNumber('x'), designNumber('y'), designNumber('width'), designNumber('height'), variantProp()],
      ['asset'],
      ['anchor'],
    ),
    spec(
      'HmiText',
      '设计空间里的文字（配无字底板用）',
      [
        dynamicString('text', true),
        designNumber('x', true),
        designNumber('y', true),
        designNumber('width'),
        designNumber('size'),
        {name: 'color', type: 'string', required: false},
        {name: 'align', type: 'enum', required: false, enumValues: ['left', 'center', 'right'], defaultValue: 'left'},
        {name: 'font', type: 'enum', required: false, enumValues: ['cn', 'num'], defaultValue: 'cn'},
        {name: 'bold', type: 'boolean', required: false},
        variantProp(),
      ],
      ['text', 'x', 'y'],
      ['anchor'],
    ),
    spec(
      'HmiHotspot',
      '可点击热区（有素材名就照素材位置，没有就用 x/y/宽/高；点击后发 action）',
      [
        dynamicString('asset'),
        {name: 'action', type: 'action', required: true},
        dynamicString('label'),
        {name: 'bind', type: 'dynamicValue', required: false},
        designNumber('x'),
        designNumber('y'),
        designNumber('width'),
        designNumber('height'),
        variantProp(),
      ],
      ['action'],
      ['anchor'],
    ),
    spec(
      'HmiPanel',
      '组装用的底板面板（颜色圆角矩形，给卡片/车控栏当背景）',
      [
        designNumber('x', true),
        designNumber('y', true),
        designNumber('width', true),
        designNumber('height', true),
        {name: 'fill', type: 'string', required: false},
        {name: 'radius', type: 'number', required: false},
        {name: 'border', type: 'string', required: false},
        {name: 'opacity', type: 'number', required: false},
        variantProp(),
      ],
      ['x', 'y', 'width', 'height'],
      ['anchor'],
    ),
  ];

  return new Map(specs.map(entry => [entry.name, entry]));
}
