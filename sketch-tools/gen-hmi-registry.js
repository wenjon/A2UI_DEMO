// Build the shared HMI asset registry from the Sketch manifest.
//
//   node sketch-tools/gen-hmi-registry.js
//
// Reads  inventory/hmi-demo/manifest.json   (export-assets.js output)
// Writes demo/shared/hmi-registry.json      (consumed by demo/server and demo/src)
//
// Every asset becomes addressable by its manifest key: the server prompt/validator
// and the renderer both read the same file, so re-exporting the Sketch file and
// rerunning this script is enough to make new assets usable.
'use strict';

const fs = require('fs');
const path = require('path');

const INVENTORY = path.join(__dirname, '..', 'inventory', 'hmi-demo');
const PUBLIC_HMI = path.join(__dirname, '..', 'demo', 'public', 'hmi');
const OUT_FILE = path.join(__dirname, '..', 'demo', 'shared', 'hmi-registry.json');
const CATALOG_ID = 'https://luckplusone.cfifa.com/a2ui/hmi/catalog.json';
const DESIGN = {width: 1920, height: 1200};

// Slot contract (read by the layout code that consumes demo/shared/hmi-registry.json).
// Every asset carries a `slot`, and every slot carries a base rect taken from the
// matching 3D asset of this same manifest — never from hardcoded numbers.
// The map stage is the 1920x1080 area above the 120px control bar.
const STAGE = {x: 0, y: 0, width: 1920, height: 1080};
// Custom card area in the middle of the map (no Sketch asset behind it).
const HUD_RECT = {x: 600, y: 140, width: 1060, height: 420};

// slot -> manifest key of the asset its base rect comes from.
const SLOT_BASE = {
  status: 'status-bar-3d',
  nav: 'nav-instruction-card-3d',
  route: 'route-info-bar-3d',
  gauge: 'speedometer-3d',
  buttons: 'map-buttons-3d',
  zoom: 'zoom-control-3d',
  progress: 'route-progress-3d',
  dash: 'control-bar-3d',
  map: 'map-city-3d',
};

// Output order of `slots`, plus z / layout / capacity per slot. `rect`/`anchorAsset` are
// only set here for slots that have no Sketch asset behind them (hud). `capacity` is how
// many parts the slot can hold on screen at once (not the number of manifest assets): the
// consumer warns and truncates past it.
const SLOT_META = [
  {name: 'status', z: 30, layout: 'native', capacity: 7},
  {name: 'nav', z: 20, layout: 'native', capacity: 6},
  {name: 'route', z: 20, layout: 'native', capacity: 8},
  {name: 'gauge', z: 20, layout: 'native', capacity: 4},
  {name: 'buttons', z: 20, layout: 'native', capacity: 3},
  {name: 'zoom', z: 20, layout: 'native', capacity: 3},
  {name: 'progress', z: 20, layout: 'native', capacity: 3},
  {name: 'dash', z: 25, layout: 'spread', capacity: 12},
  {name: 'map', z: 0, layout: 'native', capacity: 12},
  {name: 'hud', z: 15, layout: 'native', capacity: 6, rect: HUD_RECT, anchorAsset: null},
];

// components group: longest matching key prefix wins (2D variants land in the same slot).
const COMPONENT_SLOT = [
  ['status-bar', 'status'],
  ['nav-instruction-card', 'nav'],
  ['route-info-bar', 'route'],
  ['speedometer', 'gauge'],
  ['map-buttons', 'buttons'],
  ['zoom-control', 'zoom'],
  ['route-progress', 'progress'],
  ['control-bar', 'dash'],
];

// Groups that map straight onto a slot regardless of the key.
const GROUP_SLOT = {
  'status-icons': 'status',
  controls: 'dash',
  map: 'map',
  backgrounds: 'map',
  screens: null,
};

function attr(text, name) {
  const match = new RegExp('<svg[^>]*\\b' + name + '="([^"]+)"', 'i').exec(text);
  return match ? match[1] : null;
}

// Sketch exports keep the real drawing box, including stroke bleed. The manifest
// rect is the layer frame; the difference is the bleed that must be added back
// when the asset is placed at design coordinates.
function assetMetrics(svgPath, rect) {
  const head = fs.readFileSync(svgPath, 'utf8').slice(0, 4000);
  const width = Number(attr(head, 'width'));
  const height = Number(attr(head, 'height'));
  const viewBox = attr(head, 'viewBox');
  const box = viewBox ? viewBox.split(/\s+/).map(Number) : null;

  let bleedX = 0;
  let bleedY = 0;
  if (Number.isFinite(width) && Number.isFinite(height)) {
    bleedX = Math.max(0, Math.round((width - rect.width) / 2));
    bleedY = Math.max(0, Math.round((height - rect.height) / 2));
  } else if (box && box.length === 4) {
    bleedX = Math.max(0, Math.round(-box[0]));
    bleedY = Math.max(0, Math.round(-box[1]));
  }

  return {
    width: Number.isFinite(width) ? width : rect.width,
    height: Number.isFinite(height) ? height : rect.height,
    viewBox: viewBox,
    bleed: {x: bleedX, y: bleedY},
  };
}

function variantOf(asset) {
  if (typeof asset.artboard === 'string' && /_2D$/.test(asset.artboard)) return '2d';
  if (typeof asset.artboard === 'string' && /_3D$/.test(asset.artboard)) return '3d';
  if (/-2d\b/.test(asset.key)) return '2d';
  if (/-3d\b/.test(asset.key)) return '3d';
  return null;
}

function componentSlot(key) {
  let best = null;
  for (const [prefix, slot] of COMPONENT_SLOT) {
    if ((key === prefix || key.startsWith(prefix + '-')) && (!best || prefix.length > best[0].length)) {
      best = [prefix, slot];
    }
  }
  return best ? best[1] : null;
}

// Slot for one registry entry. A plate shares the slot of the component it is named
// after (`speedometer-3d-plate` -> `speedometer-3d` -> `gauge`). Parts (fine-grained
// pieces of a whole screen) get the smallest slot that contains ≥80% of their area.
function containmentSlot(entry, slots) {
  const area = Math.max(1, entry.rect.width * entry.rect.height);
  let best = null;
  for (const slot of Object.values(slots)) {
    const overlap = intersect(entry.rect, slot.rect);
    const ratio = (overlap.width * overlap.height) / area;
    if (ratio < 0.8) continue;
    const slotArea = slot.rect.width * slot.rect.height;
    if (!best || slotArea < best.area) best = {name: slot.name, area: slotArea};
  }
  return best ? best.name : null;
}

function slotOf(entry, byKey, slots) {
  if (entry.group === 'plates') {
    const baseKey = entry.key.replace(/-plate$/, '');
    const base = byKey.get(baseKey);
    return base && base.slot ? base.slot : componentSlot(baseKey);
  }
  if (entry.group === 'parts') return containmentSlot(entry, slots);
  if (entry.group === 'components') return componentSlot(entry.key);
  return GROUP_SLOT[entry.group] ?? null;
}

// Stroke bleed of an asset. Some layers are exported cropped to their frame while the
// matching plate keeps the centred stroke, so take the widest bleed of the pair.
function strokeBleed(entry, byKey) {
  const plate = byKey.get(entry.key + '-plate');
  return {
    x: Math.max(entry.bleed.x, plate ? plate.bleed.x : 0),
    y: Math.max(entry.bleed.y, plate ? plate.bleed.y : 0),
  };
}

// Same rule assetBox uses: position = rect - bleed, size = rect + 2 * bleed.
function bleedRect(entry, byKey) {
  const bleed = strokeBleed(entry, byKey);
  return {
    x: entry.rect.x - bleed.x,
    y: entry.rect.y - bleed.y,
    width: entry.rect.width + bleed.x * 2,
    height: entry.rect.height + bleed.y * 2,
  };
}

function intersect(rect, box) {
  const left = Math.max(rect.x, box.x);
  const top = Math.max(rect.y, box.y);
  const right = Math.min(rect.x + rect.width, box.x + box.width);
  const bottom = Math.min(rect.y + rect.height, box.y + box.height);
  return {x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top)};
}

function buildSlots(byKey) {
  const slots = {};
  for (const meta of SLOT_META) {
    if (meta.rect) {
      slots[meta.name] = {
        name: meta.name,
        rect: {x: meta.rect.x, y: meta.rect.y, width: meta.rect.width, height: meta.rect.height},
        z: meta.z,
        layout: meta.layout,
        anchorAsset: meta.anchorAsset ?? null,
        capacity: meta.capacity,
      };
      continue;
    }
    const base = byKey.get(SLOT_BASE[meta.name]);
    if (!base) {
      console.warn(`slot "${meta.name}": base asset "${SLOT_BASE[meta.name]}" not in the manifest`);
      continue;
    }
    let rect = bleedRect(base, byKey);
    if (meta.name === 'map') rect = intersect(rect, STAGE);
    slots[meta.name] = {
      name: meta.name,
      rect,
      z: meta.z,
      layout: meta.layout,
      anchorAsset: base.key,
      capacity: meta.capacity,
    };
  }
  return slots;
}

function main() {
  const manifestPath = path.join(INVENTORY, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const missingPublic = [];
  const entries = [];

  // parts.json：把整张界面拆出来的小粒度部件并入 assets（group "parts"）。
  // 没有这个文件时脚本行为完全不变。
  const partsPath = path.join(INVENTORY, 'parts.json');
  let partEntries = [];
  if (fs.existsSync(partsPath)) {
    const parts = JSON.parse(fs.readFileSync(partsPath, 'utf8')).parts ?? [];
    for (const part of parts) {
      if (!part.key || !part.rect || !part.src) continue;
      const local = path.join(INVENTORY, part.file.replace(/\//g, path.sep));
      if (!fs.existsSync(local)) {
        console.warn(`skip part (no svg file): ${part.file}`);
        continue;
      }
      partEntries.push({
        key: part.key,
        name: part.name || part.key,
        group: 'parts',
        kind: part.kind ?? 'shape',
        variant: part.variant ?? null,
        artboard: part.variant ?? null,
        src: part.src,
        rect: {
          x: Math.round(part.rect.x),
          y: Math.round(part.rect.y),
          width: Math.round(part.rect.width),
          height: Math.round(part.rect.height),
        },
        bleed: {x: 0, y: 0},
        svg: {width: part.rect.width, height: part.rect.height, viewBox: null},
        childCount: 0,
        text: part.texts && part.texts.length ? part.texts : null,
        context: part.context ?? null,
        hit: part.hit ?? null,
      });
    }
  }

  // Extension point (intentionally NOT implemented in this script): parts.json 若存在则并入
  // assets —— group "parts"，slot 继承父素材（byKey.get(part.parent).slot），并且脚本必须
  // 容忍 inventory/hmi-demo/parts.json 不存在。Nothing here asserts a fixed asset total — the
  // manifest is the only source of truth, so new groups/parts need no code change.
  for (const asset of manifest.assets) {
    if (!asset.key || !asset.svg) continue;
    const rect = asset.canvasRect || asset.frame;
    if (!rect) continue;

    const local = path.join(INVENTORY, asset.svg.replace(/\//g, path.sep));
    const served = '/hmi/' + asset.svg.replace(/^svg\//, '').replace(/\\/g, '/');
    if (!fs.existsSync(local)) {
      console.warn(`skip (no svg file): ${asset.svg}`);
      continue;
    }
    if (!fs.existsSync(path.join(PUBLIC_HMI, served.slice('/hmi/'.length).replace(/\//g, path.sep)))) {
      missingPublic.push(served);
    }

    const metrics = assetMetrics(local, rect);
    entries.push({
      key: asset.key,
      name: asset.name || asset.key,
      group: asset.group,
      kind: asset.kind,
      variant: variantOf(asset),
      artboard: asset.artboard,
      src: served,
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      bleed: metrics.bleed,
      svg: {width: metrics.width, height: metrics.height, viewBox: metrics.viewBox},
      childCount: asset.childCount ?? 0,
      text: asset.style && asset.style.text ? asset.style.text.string ?? null : null,
    });
  }

  entries.push(...partEntries);
  entries.sort((a, b) => a.key.localeCompare(b.key));

  const groups = {};
  for (const entry of entries) {
    groups[entry.group] = (groups[entry.group] ?? 0) + 1;
  }

  // Slots first (components are independent of plates), then the plate keys borrow the
  // slot of the component they are named after.
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  const slots = buildSlots(byKey);
  for (const entry of entries) {
    if (entry.group !== 'plates') entry.slot = slotOf(entry, byKey, slots);
  }
  for (const entry of entries) {
    if (entry.group === 'plates') entry.slot = slotOf(entry, byKey, slots);
  }

  const slotCounts = {};
  let unslotted = 0;
  for (const entry of entries) {
    if (entry.slot) slotCounts[entry.slot] = (slotCounts[entry.slot] ?? 0) + 1;
    else unslotted += 1;
  }

  const registry = {
    generatedAt: new Date().toISOString(),
    generatedBy: 'sketch-tools/gen-hmi-registry.js',
    source: {
      file: manifest.source ? manifest.source.file : null,
      manifestGeneratedAt: manifest.generatedAt,
      assetCount: manifest.assetCount,
    },
    catalogId: CATALOG_ID,
    design: DESIGN,
    groups,
    slots,
    assets: entries,
  };

  fs.mkdirSync(path.dirname(OUT_FILE), {recursive: true});
  fs.writeFileSync(OUT_FILE, JSON.stringify(registry, null, 2) + '\n', 'utf8');

  console.log(`assets: ${entries.length} / ${manifest.assetCount}`);
  console.log('groups:', JSON.stringify(groups));
  console.log(`slots: ${Object.keys(slots).length} (assets without a slot: ${unslotted})`);
  console.log('slot asset counts:', JSON.stringify(slotCounts));
  for (const slot of Object.values(slots)) {
    const count = slotCounts[slot.name] ?? 0;
    console.log(
      `  ${slot.name.padEnd(9)} rect=${slot.rect.x},${slot.rect.y},${slot.rect.width}x${slot.rect.height}` +
        ` z=${slot.z} layout=${slot.layout} capacity=${slot.capacity} assets=${count}` +
        ` anchor=${slot.anchorAsset ?? '-'}` +
        (count > slot.capacity ? ` [${count - slot.capacity} more asset(s) than capacity]` : ''),
    );
  }
  console.log('slots:', JSON.stringify(slots));
  if (missingPublic.length) {
    console.log(`not yet in demo/public/hmi (${missingPublic.length}): ${missingPublic.join(', ')}`);
    console.log('run: node sketch-tools/sync-demo-assets.js');
  }
  console.log(`wrote ${OUT_FILE}`);
}

main();
