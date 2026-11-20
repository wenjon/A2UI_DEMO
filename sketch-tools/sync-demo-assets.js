const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..', 'inventory', 'hmi-demo', 'svg');
const PARTS_SRC = path.join(__dirname, '..', 'inventory', 'hmi-demo', 'parts');
const DEST = path.join(__dirname, '..', 'demo', 'public', 'hmi');
const GROUPS = ['backgrounds', 'components', 'plates', 'map', 'controls', 'status-icons', 'screens'];
let count = 0;
for (const group of GROUPS) {
  const from = path.join(SRC, group);
  if (!fs.existsSync(from)) continue;
  const to = path.join(DEST, group);
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    fs.copyFileSync(path.join(from, name), path.join(to, name));
    count += 1;
  }
}
// 拆解出来的小粒度部件（inventory/hmi-demo/parts/<variant>/*.svg -> demo/public/hmi/parts/<variant>/）
if (fs.existsSync(PARTS_SRC)) {
  for (const variant of fs.readdirSync(PARTS_SRC)) {
    const from = path.join(PARTS_SRC, variant);
    if (!fs.statSync(from).isDirectory()) continue;
    const to = path.join(DEST, 'parts', variant);
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) {
      if (!name.endsWith('.svg')) continue;
      fs.copyFileSync(path.join(from, name), path.join(to, name));
      count += 1;
    }
  }
}
console.log(`copied ${count} svg -> ${DEST}`);
