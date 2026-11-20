/**
 * 把整张车机界面 SVG 拆成「小粒度 UI 部件」。
 *
 * 输入：inventory/hmi-demo/svg-v2/HMI概念导航Demo_3D.svg / _2D.svg（viewBox 就是 1920×1200 设计坐标）
 * 输出：inventory/hmi-demo/parts.json + inventory/hmi-demo/parts/<variant>/<part>.svg
 *
 * 分组规则：取顶层分组；若某分组里有 ≥2 个子分组，且子分组「有语义名字」或「子树里有文字」，
 * 就下钻一层，把这些元素当成独立部件（导航卡会拆成底板 + 268 + 米后 + 进入 + 路名）。
 * 包围盒不靠解析 path 猜，用 sharp 1:1 光栅化后从 alpha 通道实测，transform 自然算进去。
 *
 * 用法：node sketch-tools/decompose-artboard.js
 */
const fs = require('fs');
const path = require('path');
const {JSDOM} = require('jsdom');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const ARTBOARDS = [
  {id: '3d', file: 'inventory/hmi-demo/svg-v2/HMI概念导航Demo_3D.svg'},
  {id: '2d', file: 'inventory/hmi-demo/svg-v2/HMI概念导航Demo_2D.svg'},
];
const OUT_JSON = path.join(ROOT, 'inventory/hmi-demo/parts.json');
const OUT_DIR = path.join(ROOT, 'inventory/hmi-demo/parts');
const DESIGN = {width: 1920, height: 1200};

const GEOMETRY_TAGS = ['path', 'rect', 'circle', 'ellipse', 'line', 'polygon', 'polyline', 'text', 'image'];
/** Sketch 的默认命名没有语义，需要靠上下文改名。 */
const GENERIC = /^(路径|组|分组|形状|Group|Rectangle|Ellipse|Polygon|Subtract|Union|Intersect|Path|Shape|矩形|圆形|多边形|线|蒙版)/i;

/** 已知语义层名 -> 规范 key（和已导出的 controls/status-icons 素材对齐）。 */
const NAME_HINTS = {
  phone: 'phone',
  volume: 'volume',
  music: 'music',
  heater: 'heater',
  defrost: 'defrost',
  'model3-icon': 'vehicle-model',
  'fan level': 'fan-level',
  'driver temp': 'temp-driver',
  'passenger temp': 'temp-passenger',
  clock: 'clock',
  停车场: 'poi-parking',
  万达广场: 'poi-mall',
  山河花园: 'poi-garden',
};

function slug(value) {
  return String(value ?? '')
    .trim()
    .replace(/[——、，。:：/\\|()（）]+/g, ' ')
    .replace(/[^\p{Script=Han}A-Za-z0-9]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function displayName(el) {
  return String(el.getAttribute('id') ?? '').replace(/^Group:\s*/, '').trim();
}

function isGeneric(name) {
  return !name || GENERIC.test(name);
}

function textsOf(el) {
  return Array.from(el.querySelectorAll('text'))
    .map(t => (t.textContent ?? '').trim())
    .filter(Boolean);
}

function hasGeometry(el) {
  return GEOMETRY_TAGS.some(tag => el.querySelector(tag));
}

/** 往上找最近一个有语义名字的祖先，用来给部件起名。 */
function semanticContext(el) {
  let node = el.parentElement;
  while (node && node.tagName && node.tagName.toLowerCase() !== 'svg') {
    const name = displayName(node);
    if (!isGeneric(name)) return name;
    node = node.parentElement;
  }
  return null;
}

/** 祖先层上的裁切/遮罩/透明度：部件单独导出时必须带上，否则被裁掉的内容会外溢。 */
const INHERIT_PROPS = ['clip-path', 'mask', 'opacity', 'fill-opacity', 'mix-blend-mode'];

function styleDeclarations(el) {
  const style = el.getAttribute('style') ?? '';
  const found = {};
  for (const prop of INHERIT_PROPS) {
    const match = style.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:([^;]+)`, 'i'));
    if (match) found[prop] = match[1].trim();
  }
  return found;
}

function ancestorStyle(el) {
  const attrs = {};
  const inline = {};
  let node = el.parentElement;
  while (node && node.tagName && node.tagName.toLowerCase() !== 'svg') {
    for (const key of INHERIT_PROPS) {
      const value = node.getAttribute(key);
      if (value && !(key in attrs)) attrs[key] = value; // 最近一层祖先优先
    }
    for (const [key, value] of Object.entries(styleDeclarations(node))) {
      if (!(key in inline)) inline[key] = value;
    }
    node = node.parentElement;
  }
  if (Object.keys(inline).length) {
    attrs.style = Object.entries(inline)
      .map(([key, value]) => `${key}:${value}`)
      .join(';');
  }
  return attrs;
}

function collectDefs(el, doc) {
  const needed = new Set();
  const scan = node => {
    for (const attr of Array.from(node.attributes ?? [])) {
      for (const match of String(attr.value).matchAll(/url\(#([^)]+)\)/g)) needed.add(match[1]);
    }
  };
  scan(el);
  for (const child of Array.from(el.querySelectorAll('*'))) scan(child);
  let ancestor = el.parentElement;
  while (ancestor && ancestor.tagName && ancestor.tagName.toLowerCase() !== 'svg') {
    scan(ancestor);
    ancestor = ancestor.parentElement;
  }

  const defs = doc.querySelector('defs');
  if (!defs) return '';
  const include = [];
  let pass = 0;
  let previousSize = -1;
  while (needed.size !== previousSize && pass < 6) {
    previousSize = needed.size;
    pass += 1;
    for (const def of Array.from(defs.children)) {
      const id = def.getAttribute('id');
      if (!id || needed.has(id)) continue;
      for (const match of def.outerHTML.matchAll(/url\(#([^)]+)\)/g)) {
        if (needed.has(match[1])) {
          needed.add(id);
          break;
        }
      }
    }
  }
  for (const def of Array.from(defs.children)) {
    const id = def.getAttribute('id');
    if (id && needed.has(id)) include.push(def.outerHTML);
  }
  return include.length ? `<defs>${include.join('')}</defs>` : '';
}

async function alphaBounds(svgText) {
  const {info, data} = await sharp(Buffer.from(svgText, 'utf8'))
    .resize(DESIGN.width, DESIGN.height, {fit: 'fill', position: 'left top'})
    .ensureAlpha()
    .raw()
    .toBuffer({resolveWithObject: true});
  let minX = info.width;
  let maxX = -1;
  let minY = info.height;
  let maxY = -1;
  for (let y = 0; y < info.height; y += 1) {
    const row = y * info.width * 4;
    for (let x = 0; x < info.width; x += 1) {
      if (data[row + x * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return {x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1};
}

function svgDoc(inner, bounds) {
  const view = bounds
    ? `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`
    : `0,0,${DESIGN.width},${DESIGN.height}`;
  const size = bounds ? `${bounds.width}` : `${DESIGN.width}`;
  const height = bounds ? `${bounds.height}` : `${DESIGN.height}`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1"`,
    ` width="${size}" height="${height}" viewBox="${view}">`,
    inner,
    `</svg>`,
  ].join('');
}

function groupMarkup(el, inherited = {}) {
  const own = Array.from(el.attributes)
    .filter(a => a.name !== 'id')
    .map(a => `${a.name}="${a.value.replace(/"/g, '&quot;')}"`)
    .join(' ');
  const outer = Object.entries(inherited)
    .map(([name, value]) => `${name}="${String(value).replace(/"/g, '&quot;')}"`)
    .join(' ');
  const inner = `<g ${own}>${el.innerHTML}</g>`;
  return outer ? `<g ${outer}>${inner}</g>` : inner;
}

/** 元素级分组：顶层分组，必要时下钻一层。 */
function elementGroups(svgRoot) {
  const out = [];
  const wrappers = Array.from(svgRoot.children).filter(c => c.tagName.toLowerCase() === 'g');
  const loose = Array.from(svgRoot.children).filter(c => GEOMETRY_TAGS.includes(c.tagName.toLowerCase()));
  for (const el of loose) out.push({el, container: null});

  const roots = wrappers.length === 1 ? Array.from(wrappers[0].children) : wrappers;
  for (const el of roots) {
    const tag = el.tagName.toLowerCase();
    if (tag !== 'g') continue;
    const childGroups = Array.from(el.children).filter(c => c.tagName.toLowerCase() === 'g');
    const interesting = childGroups.filter(
      c => !isGeneric(displayName(c)) || textsOf(c).length > 0,
    );
    if (childGroups.length >= 2 && interesting.length >= 2) {
      for (const child of childGroups) out.push({el: child, container: el});
    } else {
      out.push({el, container: null});
    }
  }
  return out.filter(g => hasGeometry(g.el));
}

/**
 * 无名分组用实测位置改名（这些 rect 与 check-hmi-layout.js 实测的槽位坐标一致）。
 * key = `x,y` 起点，容差 3px。
 */
const SEMANTIC_BY_RECT = {
  '119,119': 'nav-card',
  '198,153': 'nav-turn-icon',
  '308,172': 'nav-text-block',
  '119,341': 'route-bar',
  '117,447': 'gauge-dial',
  '119,584': 'map-buttons-body',
  '119,839': 'zoom-body',
  '1763,118': 'progress-track',
  '685,223': 'route-path',
  '632,794': 'location-halo',
  '677,847': 'location-arrow',
  '676,840': 'location-arrow-outline',
  '128,41': 'status-clock',
  '313,720': 'poi-parking-mark',
  '1409,393': 'poi-garden-dot',
};

/** 同名但左右分布的控件（Sketch 里两个都叫 seat）。 */
function sideName(rawName, bounds) {
  if (/^seat$/i.test(rawName)) return bounds.x < 960 ? 'seat-driver' : 'seat-passenger';
  return null;
}

function semanticByRect(bounds) {
  for (const [key, name] of Object.entries(SEMANTIC_BY_RECT)) {
    const [x, y] = key.split(',').map(Number);
    if (Math.abs(bounds.x - x) <= 3 && Math.abs(bounds.y - y) <= 3) return name;
  }
  return null;
}

function kindOf(name, texts, bounds) {
  if (texts.length) return 'text';
  if (/icon|volume|phone|music|heater|defrost|seat|temp|fan|model|poi/i.test(name)) return 'icon-button';
  if (bounds.width >= 300 && bounds.height >= 300) return 'background';
  if (bounds.width >= 120 && bounds.height >= 60) return 'panel';
  return 'shape';
}

async function processArtboard(artboard) {
  const file = path.join(ROOT, artboard.file);
  if (!fs.existsSync(file)) {
    console.log(`跳过 ${artboard.file}（不存在）`);
    return [];
  }
  const doc = new JSDOM(fs.readFileSync(file, 'utf8')).window.document;
  const svgRoot = doc.querySelector('svg');
  const groups = elementGroups(svgRoot);
  // 记录原稿的绘制顺序：重组校验必须按这个顺序画，否则颜色对不上
  const docOrder = new Map();
  Array.from(svgRoot.querySelectorAll('*')).forEach((node, index) => docOrder.set(node, index));

  const outDir = path.join(OUT_DIR, artboard.id);
  fs.mkdirSync(outDir, {recursive: true});

  const parts = [];
  const used = new Set();

  for (const {el, container} of groups) {
    const rawName = displayName(el);
    const defsText = collectDefs(el, doc);
    const bounds = await alphaBounds(svgDoc(defsText + groupMarkup(el, ancestorStyle(el))));
    if (!bounds || bounds.width < 4 || bounds.height < 4) continue;

    const context = semanticContext(el) ?? (container ? displayName(container) : null);
    const hint =
      sideName(rawName, bounds) ??
      NAME_HINTS[rawName.toLowerCase()] ??
      NAME_HINTS[context?.toLowerCase() ?? ''] ??
      semanticByRect(bounds);
    const contextSlug = hint ?? (isGeneric(context) ? '' : slug(context));
    const ownSlug = isGeneric(rawName) ? '' : slug(rawName);

    let base = contextSlug || ownSlug || 'part';
    let key = `${artboard.id}-${base}`;
    let n = 1;
    while (used.has(key)) {
      n += 1;
      key = `${artboard.id}-${base}-${n}`;
    }
    used.add(key);

    const texts = textsOf(el);
    fs.writeFileSync(path.join(outDir, `${key}.svg`), svgDoc(defsText + groupMarkup(el, ancestorStyle(el)), bounds), 'utf8');

    parts.push({
      key,
      order: docOrder.get(el) ?? 0,
      name: rawName || base,
      context: context || null,
      variant: artboard.id,
      group: 'parts',
      kind: kindOf(rawName || context || '', texts, bounds),
      rect: {x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height},
      // 触控用的最小命中区（车机上手指要够大）
      hit: {
        x: Math.max(0, Math.round(bounds.x - Math.max(0, (56 - bounds.width) / 2))),
        y: Math.max(0, Math.round(bounds.y - Math.max(0, (56 - bounds.height) / 2))),
        width: Math.max(56, bounds.width),
        height: Math.max(56, bounds.height),
      },
      svg: {width: bounds.width, height: bounds.height},
      src: `/hmi/parts/${artboard.id}/${key}.svg`,
      file: `parts/${artboard.id}/${key}.svg`,
      texts,
    });
  }

  console.log(`${artboard.id}: 元素分组 ${groups.length} → 部件 ${parts.length}`);
  for (const part of parts) {
    console.log(
      `  ${part.key.padEnd(26)} ${String(part.rect.x).padStart(5)},${String(part.rect.y).padStart(5)} ` +
        `${String(part.rect.width).padStart(5)}x${String(part.rect.height).padStart(4)}  ${part.kind.padEnd(11)}` +
        (part.texts.length ? ` "${part.texts.join('/').slice(0, 24)}"` : ''),
    );
  }
  return parts;
}

async function maskOf(svgText, width, height) {
  const {data} = await sharp(Buffer.from(svgText, 'utf8'))
    .resize(width, height, {fit: 'fill', position: 'left top'})
    .ensureAlpha()
    .raw()
    .toBuffer({resolveWithObject: true});
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i += 1) mask[i] = data[i * 4 + 3] > 8 ? 1 : 0;
  return mask;
}

/**
 * 校验拆解是否可信，只做两件事：
 *  1) 不漏：把部件按原稿顺序贴回画布，原图每个可见像素都必须被某个部件覆盖。
 *  2) 自洽：每件部件单独渲染时，墨迹必须填满它声明的 rect（不裁掉、不外溢），
 *     并且它的实际 alpha 包围盒 == 声明的 rect。
 * 注意：不做「重组后逐像素比颜色」。sharp 的 raw composite 与浏览器合成语义不同
 * （半透明层会被算淡：同一张半透明导航卡，浏览器语义均值 68.8，sharp 163/157），
 * 那种比色得出的偏差是工具假象，不是拆解错误。真实渲染的一致性用
 * sketch-tools/check-hmi-layout.js（CDP 实测）和 .shots/*.png 肉眼比对来确认。
 */
async function verify(artboard, parts) {
  const file = path.join(ROOT, artboard.file);
  const base = await sharp(Buffer.from(fs.readFileSync(file, 'utf8'), 'utf8'))
    .resize(DESIGN.width, DESIGN.height, {fit: 'fill', position: 'left top'})
    .ensureAlpha()
    .raw()
    .toBuffer({resolveWithObject: true});

  const inked = new Uint8Array(DESIGN.width * DESIGN.height);
  const layers = [];
  const filled = [];
  for (const part of [...parts].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    const svg = fs.readFileSync(path.join(ROOT, 'inventory/hmi-demo', part.file), 'utf8');
    const {info, data} = await sharp(Buffer.from(svg, 'utf8'))
      .resize(part.rect.width, part.rect.height, {fit: 'fill', position: 'left top'})
      .ensureAlpha()
      .raw()
      .toBuffer({resolveWithObject: true});

    let ink = 0;
    let minX = info.width;
    let minY = info.height;
    let maxX = -1;
    let maxY = -1;
    for (let row = 0; row < info.height; row += 1) {
      for (let col = 0; col < info.width; col += 1) {
        if (data[(row * info.width + col) * 4 + 3] > 8) {
          ink += 1;
          if (col < minX) minX = col;
          if (row < minY) minY = row;
          if (col > maxX) maxX = col;
          if (row > maxY) maxY = row;
          const gx = part.rect.x + col;
          const gy = part.rect.y + row;
          if (gx >= 0 && gx < DESIGN.width && gy >= 0 && gy < DESIGN.height) inked[gy * DESIGN.width + gx] = 1;
        }
      }
    }
    layers.push({part, data, info});
    filled.push({
      key: part.key,
      fill: (ink / (info.width * info.height)) * 100,
      tight: minX === 0 && minY === 0 && maxX === info.width - 1 && maxY === info.height - 1,
    });
  }

  const baseInk = base.data.reduce((sum, value, index) => (index % 4 === 3 && value > 8 ? sum + 1 : sum), 0);
  let missed = 0;
  for (let i = 0; i < inked.length; i += 1) {
    if (base.data[i * 4 + 3] > 8 && !inked[i]) missed += 1;
  }

  const loose = filled.filter(row => !row.tight);
  const thin = filled.filter(row => row.fill < 20);
  console.log(
    `${artboard.id} 拆解校验：部件 ${parts.length} 个；` +
      `原图可见像素 ${fmt(baseInk)} px，部件覆盖后漏墨 ${fmt(missed)} px（${((missed / Math.max(1, baseInk)) * 100).toFixed(3)}%）；` +
      `墨迹填满自身边框 ${filled.length - loose.length}/${filled.length}`,
  );
  if (loose.length) console.log(`  边框内留白（描边出血/斜角）：${loose.slice(0, 6).map(row => `${row.key} ${row.fill.toFixed(0)}%`).join(', ')}`);
  if (thin.length) console.log(`  稀疏件（<20% 填充，多为细线/文字）：${thin.slice(0, 6).map(row => `${row.key} ${row.fill.toFixed(0)}%`).join(', ')}`);

  if (process.argv.includes('--dump')) {
    fs.mkdirSync(path.join(ROOT, '.shots'), {recursive: true});
    await sharp(Buffer.from(base.data), {raw: {width: DESIGN.width, height: DESIGN.height, channels: 4}})
      .png()
      .toFile(path.join(ROOT, `.shots/original-${artboard.id}.png`));
    console.log(`  已写出 .shots/original-${artboard.id}.png（原稿光栅，供肉眼比对）`);
  }
}

function fmt(value) {
  return value.toLocaleString('en-US');
}

async function main() {
  const parts = [];
  const verifyMode = process.argv.includes('--verify');
  for (const artboard of ARTBOARDS) {
    const list = await processArtboard(artboard);
    parts.push(...list);
    if (verifyMode) await verify(artboard, list);
  }
  fs.writeFileSync(
    OUT_JSON,
    JSON.stringify({generatedAt: new Date().toISOString(), design: DESIGN, parts}, null, 2),
    'utf8',
  );
  console.log(`\n写入 ${path.relative(ROOT, OUT_JSON)} （${parts.length} 个部件）`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
