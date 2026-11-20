const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { Sketch } = require('sketch-constructor');
const svgLib = require('sketch-to-svg');
const JSZip = require('jszip');

const SKETCH_PATH = process.env.HMI_SKETCH_PATH || path.join(__dirname, '..', 'assets', 'HMI概念导航Demo.sketch');
const OUT_ROOT = path.join(__dirname, '..', 'inventory', 'hmi-demo');
const TARGET_ARTBOARD_ID = 'jKaZ0qqvngU75dIdpKbu9';
const SCALE = 2;

// Read the page JSON straight from the .sketch archive (a zip). sketch-constructor
// drops gradient / text-run detail that the raw page keeps.
async function readRawPage() {
  const zip = await JSZip.loadAsync(fs.readFileSync(SKETCH_PATH));
  const pages = Object.keys(zip.files).filter(name => /^pages\/[^/]+\.json$/.test(name));
  for (const name of pages) {
    const page = JSON.parse(await zip.file(name).async('string'));
    if ((page.layers || []).some(layer => layer.do_objectID === TARGET_ARTBOARD_ID)) return page;
  }
  throw new Error(`artboard ${TARGET_ARTBOARD_ID} not found in ${SKETCH_PATH}`);
}

// Some gradients resolve differently when a layer is exported on its own than when the
// whole artboard is rasterized into screens/*.png. For the 3D route line the artboard
// render is the design of record (orange -> yellow -> green), so match those colors.
function applyDesignFixes(out, svg) {
  // A centred stroke extends 2.5px past the 100x100 layer bounds; an <img> would clip it.
  if (out === 'speedometer-3d-plate' || out === 'speedometer-2d-plate') {
    return svg.replace('width="100" height="100" viewBox="0,0,100,100"', 'width="106" height="106" viewBox="-3,-3,106,106"');
  }
  // The 2D route is a 14px stroke sitting on the layer edges, so half of it is clipped.
  if (out === 'route-path-2d') {
    return svg.replace('width="448" height="454" viewBox="0,0,448,454"', 'width="463" height="468" viewBox="-7,-7,463,468"');
  }
  if (out !== 'route-path-3d') return svg;
  const stops = [
    '<stop offset="0" stop-color="#fd8b22"></stop>',
    '<stop offset="0.35" stop-color="#feab0a"></stop>',
    '<stop offset="0.55" stop-color="#f2bb09"></stop>',
    '<stop offset="0.7" stop-color="#bfc63c"></stop>',
    '<stop offset="0.8" stop-color="#a6d144"></stop>',
    '<stop offset="0.92" stop-color="#86da5c"></stop>',
    '<stop offset="1" stop-color="#7cdd66"></stop>',
  ].join('');
  return svg.replace(
    /(<linearGradient[^>]*id="color-1"[^>]*>)([\s\S]*?)(<\/linearGradient>)/,
    (match, open, body, close) => open + stops + close,
  );
}

const SPEC = [
  // ---- screens ----
  { id: 'jKaZ0qqvngU75dIdpKbu9', out: 'hmi-3d-screen', group: 'screens', kind: 'screen' },
  { id: 'UuCw5ydt6FyulGp7mGuoQ', out: 'hmi-2d-screen', group: 'screens', kind: 'screen' },

  // ---- backgrounds ----
  { id: 'iz-qLV8VnFahVOPxjBeSo', out: 'map-city-3d', group: 'backgrounds', kind: 'background' },
  { id: 'Q7h9_dWaDxqqMi4K2VAOF', out: 'map-flat-2d', group: 'backgrounds', kind: 'background' },

  // ---- shared chrome ----
  { id: 'hbB09CsmlWmGEISy9s8NB', out: 'control-bar-3d', group: 'components', kind: 'bar' },
  { id: '7pG35acyjPQUiNo24M14R', out: 'control-bar-2d', group: 'components', kind: 'bar' },
  { id: '0YBdrYfEBGbczLF-mnlMB', out: 'status-bar-3d', group: 'components', kind: 'status-bar' },
  { id: 'rClNxAfzbwlFwJXNBWzvz', out: 'status-bar-2d', group: 'components', kind: 'status-bar' },

  // ---- panels / hud ----
  { id: 'N0sOgILIhqnJr-Yi-XUBD', out: 'nav-instruction-card-3d', group: 'components', kind: 'panel' },
  { id: 'ZglkkMjh_D6KNoOGp8o-J', out: 'nav-instruction-card-2d', group: 'components', kind: 'panel' },
  { id: 'dI-6cEFI2iNEatfpStvtd', out: 'route-info-bar-3d', group: 'components', kind: 'panel' },
  { id: 'jzzFZKstn_5S-e5r5oYQw', out: 'route-info-bar-2d', group: 'components', kind: 'panel' },
  { id: 'O55CBQEyJRIux8iZotDpg', out: 'speedometer-3d', group: 'components', kind: 'gauge' },
  { id: 'vmutIeeERU_emMvPSx_Ip', out: 'speedometer-2d', group: 'components', kind: 'gauge' },
  { id: 'N0sOgILIhqnJr-Yi-XUBD', out: 'nav-instruction-card-3d-plate', group: 'plates', kind: 'panel', hideText: true },
  { id: 'ZglkkMjh_D6KNoOGp8o-J', out: 'nav-instruction-card-2d-plate', group: 'plates', kind: 'panel', hideText: true },
  { id: 'dI-6cEFI2iNEatfpStvtd', out: 'route-info-bar-3d-plate', group: 'plates', kind: 'panel', hideText: true },
  { id: 'jzzFZKstn_5S-e5r5oYQw', out: 'route-info-bar-2d-plate', group: 'plates', kind: 'panel', hideText: true },
  { id: 'O55CBQEyJRIux8iZotDpg', out: 'speedometer-3d-plate', group: 'plates', kind: 'gauge', hideText: true },
  { id: 'vmutIeeERU_emMvPSx_Ip', out: 'speedometer-2d-plate', group: 'plates', kind: 'gauge', hideText: true },
  { id: '5V2Iuyg-VJKMDGakz7XQW', out: 'map-buttons-3d', group: 'components', kind: 'button-group' },
  { id: '_yg8f_eypaBGpFOvCYF6j', out: 'map-buttons-2d', group: 'components', kind: 'button-group' },
  { id: 'sxFoBOk23aFXj5RurC9id', out: 'zoom-control-3d', group: 'components', kind: 'control' },
  { id: 'IFcBoO1HWUaikzmjRo-rP', out: 'zoom-control-2d', group: 'components', kind: 'control' },
  { id: 'AWmJy-NH8f6gZ-RtJGSp9', out: 'route-progress-3d', group: 'components', kind: 'progress' },
  { id: 'aX-wVIOneZRCyXqaW2DQ9', out: 'route-progress-2d', group: 'components', kind: 'progress' },

  // ---- map overlays ----
  { id: '7IcHD02w9PNdGR552QTMj', out: 'route-path-3d', group: 'map', kind: 'route' },
  { id: 'IQoisso18r6mE9PbknJ_y', out: 'route-path-2d', group: 'map', kind: 'route' },
  { id: 't5dQNOwFGsXP6Oz58xjR-', out: 'poi-parking-3d', group: 'map', kind: 'poi' },
  { id: '4WVCByNaqjSogo7d1wviw', out: 'poi-mall-3d', group: 'map', kind: 'poi' },
  { id: 'cCjpRBzI80wLeUnucX0J9', out: 'poi-garden-3d', group: 'map', kind: 'poi' },
  { id: 'dXsAF4KbRB2i7DNiC3i--', out: 'poi-pin-2d', group: 'map', kind: 'poi' },
  { id: 'GLl7zMi5EESTk0wrqzarr', out: 'location-halo-2d', group: 'map', kind: 'marker' },
  { id: 'FVjjg9FfY-kDpKVf3n3zY', out: 'location-halo-3d', group: 'map', kind: 'marker' },
  { id: 'wMLFcKZAlYyEkgtKCDsqo', out: 'location-arrow-3d', group: 'map', kind: 'marker' },
  { id: 'fr5t7M3dBWHyQmgg9vGz3', out: 'location-arrow-outline-3d', group: 'map', kind: 'marker' },

  // ---- control bar icons (3D artboard) ----
  { id: 'StPQsz4ESf07IaVw57uuH', out: 'phone', group: 'controls', kind: 'icon-button' },
  { id: 'Eg6lhrsLmb0oik_tFuXLQ', out: 'volume', group: 'controls', kind: 'icon-button' },
  { id: '6HdD1-_0sQSUE-Xo3Te5T', out: 'music', group: 'controls', kind: 'icon-button' },
  { id: 'sRr8X9yJ07RCu3ztb7wpL', out: 'seat-passenger', group: 'controls', kind: 'icon-button' },
  { id: '884TtW5o6FOCPJVE9wV-G', out: 'seat-driver', group: 'controls', kind: 'icon-button' },
  { id: 'npjOma22CqAugiqUldQni', out: 'temp-passenger', group: 'controls', kind: 'value' },
  { id: '9TLbCkYWBEgGkYH-eucbE', out: 'fan-level', group: 'controls', kind: 'icon-value' },
  { id: 'VwsmhsnIZKSkqV5P9w5bg', out: 'temp-driver', group: 'controls', kind: 'value' },
  { id: 'q8NqxyoVp3zjFS9bJX7Hj', out: 'heater', group: 'controls', kind: 'icon-button' },
  { id: '4w3UMWq_WpbhWhEnTAYTh', out: 'defrost', group: 'controls', kind: 'icon-button' },
  { id: 'Ryo30cKxS4ZV_L2ME8Q4b', out: 'vehicle-model3', group: 'controls', kind: 'icon-button' },

  // ---- status icons (3D artboard) ----
  { id: 'Uxjk3nBSlHRFsdvkN1QfI', out: 'lock', group: 'status-icons', kind: 'icon' },
  { id: 'V9_Hk8Yxc4SSjuAf0PUS5', out: 'bluetooth', group: 'status-icons', kind: 'icon' },
  { id: 'XWJBy3uHno8d0eZWO9NeC', out: 'cell-signal', group: 'status-icons', kind: 'icon' },
  { id: 'S-LOIJTSOxZ6DZnoW61eV', out: 'wechat', group: 'status-icons', kind: 'icon' },
  { id: 'fJ6ncUTXfsJtKONj5laXa', out: 'clock', group: 'status-icons', kind: 'text' },
];

function walkRaw(node, cb, parentAbs) {
  const abs = { x: (parentAbs ? parentAbs.x : 0) + node.frame.x, y: (parentAbs ? parentAbs.y : 0) + node.frame.y };
  cb(node, abs);
  for (const child of node.layers || []) walkRaw(child, cb, abs);
}

function indexSketch(sketch) {
  const byId = new Map();
  for (const page of sketch.pages) {
    const pageAbs = { x: 0, y: 0 };
    for (const artboard of page.layers) {
      walkRaw(artboard, (layer, abs) => {
        byId.set(layer.do_objectID, { layer, artboard: artboard.name, abs });
      }, { x: -artboard.frame.x, y: -artboard.frame.y });
    }
  }
  return byId;
}

function describeStyle(raw) {
  const out = { fills: [], borders: [], blur: null, opacity: null, text: null };
  const st = (raw && raw.style) || {};
  for (const f of st.fills || []) {
    if (f.isEnabled === false) continue;
    out.fills.push({
      type: f.fillType,
      color: f.color ? `rgba(${Math.round(f.color.red * 255)},${Math.round(f.color.green * 255)},${Math.round(f.color.blue * 255)},${Number(f.color.alpha.toFixed(3))})` : undefined,
      gradient: f.gradient ? f.gradient.stops.map(s => `rgba(${Math.round(s.color.red * 255)},${Math.round(s.color.green * 255)},${Math.round(s.color.blue * 255)},${Number(s.color.alpha.toFixed(3))})@${Number(s.position.toFixed(2))}`) : undefined,
    });
  }
  for (const b of st.borders || []) {
    if (b.isEnabled === false) continue;
    out.borders.push({ thickness: b.thickness, color: b.color ? `rgba(${Math.round(b.color.red * 255)},${Math.round(b.color.green * 255)},${Math.round(b.color.blue * 255)},${Number(b.color.alpha.toFixed(3))})` : undefined });
  }
  if (st.blur && st.blur.isEnabled) out.blur = { type: st.blur.type, radius: st.blur.radius, motionAngle: st.blur.motionAngle };
  if (st.contextSettings) out.opacity = st.contextSettings.opacity;
  if (raw) {
    out.blurs = [];
    out.subtreeFills = [];
    (function scan(node) {
      const st = node.style || {};
      if (st.blur && st.blur.isEnabled && st.blur.radius) {
        out.blurs.push({ layer: node.name, type: st.blur.type, radius: st.blur.radius });
      }
      for (const f of st.fills || []) {
        if (f.isEnabled === false) continue;
        const desc = f.color ? `rgba(${Math.round(f.color.red * 255)},${Math.round(f.color.green * 255)},${Math.round(f.color.blue * 255)},${Number((f.color.alpha > 1 ? f.color.alpha / 255 : f.color.alpha).toFixed(3))})` : null;
        const key = f.fillType + ':' + desc;
        if (desc && !out.subtreeFills.some(x => x.key === key)) out.subtreeFills.push({ key, layer: node.name, fillType: f.fillType, color: desc });
      }
      for (const c of node.layers || []) scan(c);
    })(raw);
    if (!out.blurs.length) delete out.blurs;
    if (!out.subtreeFills.length) delete out.subtreeFills;
    else if (out.subtreeFills.length > 8) out.subtreeFills = out.subtreeFills.slice(0, 8);
  }
  if (raw && raw.attributedString) {
    const attrs = raw.attributedString.attributes || [];
    out.text = {
      string: raw.attributedString.string,
      runs: attrs.map(a => ({
        text: raw.attributedString.string.substr(a.location, a.length),
        font: a.attributes && a.attributes.MSAttributedStringFontAttribute ? a.attributes.MSAttributedStringFontAttribute.attributes.name : undefined,
        size: a.attributes && a.attributes.MSAttributedStringFontAttribute ? a.attributes.MSAttributedStringFontAttribute.attributes.size : undefined,
        color: a.attributes && a.attributes.MSAttributedStringColorAttribute ? `rgba(${Math.round(a.attributes.MSAttributedStringColorAttribute.red * 255)},${Math.round(a.attributes.MSAttributedStringColorAttribute.green * 255)},${Math.round(a.attributes.MSAttributedStringColorAttribute.blue * 255)},${Number(a.attributes.MSAttributedStringColorAttribute.alpha.toFixed(3))})` : undefined,
      })),
    };
  }
  return out;
}

async function main() {
  const only = process.argv[2] ? new Set(process.argv[2].split(',')) : null;
  const sketch = await Sketch.fromFile(SKETCH_PATH);
  const index = indexSketch(sketch);
  const rawPage = await readRawPage();
  const rawById = new Map();
  for (const artboard of rawPage.layers) {
    walkRaw(artboard, (node) => rawById.set(node.do_objectID, node), { x: 0, y: 0 });
  }
  const spec = SPEC.filter(s => !s.skip && (!only || only.has(s.out)));

  const assets = [];
  let n = 0;
  for (const item of spec) {
    n++;
    const entry = index.get(item.id);
    if (!entry) { console.error(`!! missing layer ${item.out} (${item.id})`); continue; }
    const { layer, artboard, abs } = entry;
    if (item.hideText) {
      const hideText = node => {
        if (node._class === 'text') node.isVisible = false;
        for (const child of node.layers || []) hideText(child);
      };
      hideText(layer);
    }
    const w = Math.round(layer.frame.width * 100) / 100;
    const h = Math.round(layer.frame.height * 100) / 100;
    process.stdout.write(`[${n}/${spec.length}] ${item.out} (${w}x${h}) ... `);

    const res = await svgLib.createFromLayer(layer, { sketchFilePath: SKETCH_PATH, optimizeImageSize: true, optimizeImageSizeFactor: 2 });
    res.svg = applyDesignFixes(item.out, res.svg);
    const svgDir = path.join(OUT_ROOT, 'svg', item.group);
    const pngDir = path.join(OUT_ROOT, 'png', item.group);
    fs.mkdirSync(svgDir, { recursive: true });
    fs.mkdirSync(pngDir, { recursive: true });
    const svgPath = path.join(svgDir, item.out + '.svg');
    const pngPath = path.join(pngDir, item.out + '.png');
    fs.writeFileSync(svgPath, res.svg);

    const meta = describeStyle(rawById.get(item.id));
    // sketch-constructor drops most style details for groups; read raw style by id for fidelity
    let pngSize = null;
    try {
      // Padded SVGs (bleed for centred strokes) are wider than the layer frame;
      // rasterise the whole SVG viewport so the PNG does not clip the stroke again.
      const box = /<svg[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"/.exec(res.svg);
      const pngW = Math.max(1, Math.ceil((box ? Number(box[1]) : w) * SCALE));
      const pngH = Math.max(1, Math.ceil((box ? Number(box[2]) : h) * SCALE));
      await sharp(Buffer.from(res.svg), { density: 96 })
        .resize(pngW, pngH, { fit: 'fill' })
        .png({ compressionLevel: 9 })
        .toFile(pngPath);
      pngSize = { width: pngW, height: pngH };
    } catch (err) {
      console.error(`\n   png failed: ${err.message}`);
    }

    assets.push({
      id: item.id,
      name: layer.name,
      key: item.out,
      group: item.group,
      kind: item.kind,
      artboard,
      className: layer._class,
      frame: { x: layer.frame.x, y: layer.frame.y, width: w, height: h },
      canvasRect: { x: Math.round(abs.x * 100) / 100, y: Math.round(abs.y * 100) / 100, width: w, height: h },
      svg: path.relative(OUT_ROOT, svgPath).replace(/\\/g, '/'),
      png: fs.existsSync(pngPath) ? path.relative(OUT_ROOT, pngPath).replace(/\\/g, '/') : null,
      pngScale: SCALE,
      pngSize,
      style: meta,
      childCount: (layer.layers || []).length,
    });
    console.log('ok');
  }

  const manifest = {
    source: {
      file: SKETCH_PATH,
      fileName: path.basename(SKETCH_PATH),
      page: 'HMI概念导航Demo',
      artboards: [
        { name: 'HMI概念导航Demo_3D', id: 'jKaZ0qqvngU75dIdpKbu9', width: 1920, height: 1200 },
        { name: 'HMI概念导航Demo_2D', id: 'UuCw5ydt6FyulGp7mGuoQ', width: 1920, height: 1200 },
      ],
    },
    generatedAt: new Date().toISOString(),
    pngScale: SCALE,
    assetCount: assets.length,
    assets,
  };
  fs.writeFileSync(path.join(OUT_ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`\nwrote ${assets.length} assets -> ${OUT_ROOT}`);
}

main().catch(err => { console.error(err); process.exit(1); });


