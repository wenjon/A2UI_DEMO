const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..', 'inventory', 'hmi-demo');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

async function main() {
  const items = manifest.assets.filter(a => a.png && a.kind !== 'screen' && a.kind !== 'background');
  const cols = 6;
  const cellW = 300, cellH = 170, pad = 8;
  const rows = Math.ceil(items.length / cols);
  const W = cols * cellW, H = rows * cellH;
  const composites = [];
  for (let i = 0; i < items.length; i++) {
    const a = items[i];
    const c = i % cols, r = Math.floor(i / cols);
    const boxW = cellW - pad * 2, boxH = cellH - 34;
    const thumb = await sharp(path.join(ROOT, a.png))
      .resize(boxW, boxH, { fit: 'contain', background: { r: 40, g: 44, b: 52, alpha: 1 } })
      .png().toBuffer();
    const left = c * cellW + pad;
    const top = r * cellH + pad + 4;
    composites.push({ input: thumb, left, top });
  }
  const base = sharp({ create: { width: W, height: H, channels: 3, background: { r: 22, g: 24, b: 28 } } });
  const out = await base.composite(composites).png().toBuffer();

  const labels = items.map((a, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    const x = c * cellW + pad + 2;
    const y = r * cellH + cellH - 22;
    return `<text x="${x}" y="${y}" font-family="Segoe UI, Microsoft YaHei" font-size="12" fill="#cfd6e4">${a.key} <tspan fill="#6b7488">${a.frame.width}x${a.frame.height}</tspan></text>`;
  }).join('');
  const svgOverlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${labels}</svg>`;
  await sharp(out).composite([{ input: Buffer.from(svgOverlay), left: 0, top: 0 }]).png()
    .toFile(path.join(ROOT, 'preview-sheet.png'));
  console.log('sheet', W, H, 'items', items.length);
}
main().catch(e => { console.error(e); process.exit(1); });
