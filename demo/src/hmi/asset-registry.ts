import registryJson from '../../shared/hmi-registry.json';

/**
 * Renderer side of the shared HMI asset registry (demo/shared/hmi-registry.json).
 * Coordinates are the Sketch canvasRect of the 1920x1200 artboard, so anything
 * placed with these numbers lands exactly where the design put it.
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
};

type RegistryJson = {
  catalogId?: string;
  design?: {width?: number; height?: number};
  groups?: Record<string, number>;
  assets?: HmiAssetEntry[];
};

const registry = registryJson as RegistryJson;

/**
 * `?fit=1` turns the page into a bare car-screen canvas (used by the Android /
 * emulator viewer): the 1920x1200 design is scaled to fit both width and height
 * instead of only the width.
 */
export const HMI_FIT =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('fit') === '1';

export const HMI_DESIGN = {
  width: registry.design?.width ?? 1920,
  height: registry.design?.height ?? 1200,
};

export const HMI_REGISTRY_CATALOG_ID =
  registry.catalogId ?? 'https://luckplusone.cfifa.com/a2ui/hmi/catalog.json';

export const HMI_ASSETS: HmiAssetEntry[] = registry.assets ?? [];

const byKey = new Map<string, HmiAssetEntry>(HMI_ASSETS.map(asset => [asset.key, asset]));

export function hmiAssetEntry(key: string | undefined | null): HmiAssetEntry | undefined {
  if (!key) return undefined;
  const exact = byKey.get(key);
  if (exact) return exact;
  const lowered = key.toLowerCase();
  return HMI_ASSETS.find(asset => asset.key.toLowerCase() === lowered);
}

export function hmiAssetsOfGroup(group: string, variant?: HmiVariant): HmiAssetEntry[] {
  return HMI_ASSETS.filter(
    asset => asset.group === group && (variant === undefined || asset.variant === variant),
  );
}

export type AssetBox = {left: number; top: number; width: number; height: number};

/** Design-space placement, adding back the stroke bleed the exported SVG keeps. */
export function hmiAssetBox(
  entry: HmiAssetEntry,
  override?: {x?: number; y?: number; width?: number; height?: number},
): AssetBox {
  const width = Math.max(
    1,
    Math.round(override?.width ?? entry.rect.width + entry.bleed.x * 2),
  );
  const height = Math.max(
    1,
    Math.round(override?.height ?? entry.rect.height + entry.bleed.y * 2),
  );
  return {
    left: Math.round(override?.x ?? entry.rect.x - entry.bleed.x),
    top: Math.round(override?.y ?? entry.rect.y - entry.bleed.y),
    width,
    height,
  };
}

/** Frame the asset sits in, without the bleed (used for panel containers). */
export function hmiFrameBox(entry: HmiAssetEntry): AssetBox {
  return {
    left: entry.rect.x,
    top: entry.rect.y,
    width: entry.rect.width,
    height: entry.rect.height,
  };
}

/** Bleed-corrected offset of the asset inside its own container frame. */
export function hmiPlateStyle(entry: HmiAssetEntry): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  return {
    left: -entry.bleed.x,
    top: -entry.bleed.y,
    width: entry.rect.width + entry.bleed.x * 2,
    height: entry.rect.height + entry.bleed.y * 2,
  };
}

export function hmiAssetSrc(key: string, variant?: HmiVariant): string {
  const entry = hmiAssetEntry(key);
  if (entry) return entry.src;
  if (variant) {
    const sibling = hmiAssetEntry(`${key}-${variant}`);
    if (sibling) return sibling.src;
  }
  return `/hmi/${key}.svg`;
}
