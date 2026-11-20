// Verify, through CDP, that the rendered car screen lands on the registry geometry.
// Usage: node check-hmi-layout.js [page-url]
const http = require('http');
const registry = require('../demo/shared/hmi-registry.json');

const ENDPOINT = process.env.CDP_ENDPOINT || 'http://127.0.0.1:9223';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function json(path) {
  return new Promise((resolve, reject) => {
    http.get(`${ENDPOINT}${path}`, res => {
      let body = '';
      res.on('data', chunk => (body += chunk));
      res.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });
}

async function main() {
  const pageUrl = process.argv[2] || '';
  const targets = await json('/json/list');
  // 只碰本次要测的页面：优先 URL 完全匹配，其次任意 http(s) 页面；绝不碰 edge:// 或别的标签页
  const httpTargets = targets.filter(t => t.type === 'page' && /^https?:/i.test(t.url ?? ''));
  const page = httpTargets.find(t => pageUrl && t.url === pageUrl)
    ?? httpTargets.find(t => pageUrl && t.url.startsWith(pageUrl.split('?')[0]))
    ?? (pageUrl ? undefined : httpTargets[0]);
  if (!page) {
    const seen = (targets.find(t => t.type === 'page')?.url ?? '无') ;
    throw new Error(`找不到页面 ${pageUrl || 'http 页面'}（现有页面：${seen}）`);
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 0;
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const {resolve, reject} = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    }
  });
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, {once: true});
    ws.addEventListener('error', reject, {once: true});
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, {resolve, reject});
      ws.send(JSON.stringify({id, method, params}));
    });

  await send('Runtime.enable');
  const result = await send('Runtime.evaluate', {
    expression: `(() => {
      const stage = document.querySelector('.hmi-stage');
      if (!stage) return null;
      const stageRect = stage.getBoundingClientRect();
      const scale = stageRect.width / 1920;
      const items = [...stage.querySelectorAll('img, .hmi-abs')].map(el => {
        const r = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          src: el.getAttribute('src') ?? el.className,
          x: +((r.x - stageRect.x) / scale).toFixed(1),
          y: +((r.y - stageRect.y) / scale).toFixed(1),
          w: +(r.width / scale).toFixed(1),
          h: +(r.height / scale).toFixed(1),
        };
      });
      const texts = [...stage.querySelectorAll('.hmi-label, .hmi-text, .hmi-distance')].map(el => {
        const r = el.getBoundingClientRect();
        return {
          text: el.textContent.trim().slice(0, 24),
          x: +((r.x - stageRect.x) / scale).toFixed(1),
          y: +((r.y - stageRect.y) / scale).toFixed(1),
        };
      });
      return {scale, stageWidth: stageRect.width, items, texts};
    })()`,
    returnByValue: true,
  });

  const state = result.result.value;
  ws.close();
  if (!state) throw new Error('no .hmi-stage on the page');

  const expected = new Map(registry.assets.map(a => [a.src, a]));
  const bySrc = new Map(state.items.filter(i => i.tag === 'img').map(i => [i.src, i]));
  let worst = 0;
  const rows = [];

  for (const [src, rendered] of bySrc) {
    const asset = expected.get(src);
    if (!asset) {
      rows.push(`  ?    ${src}  (不在注册表里)`);
      continue;
    }
    const want = {
      x: asset.rect.x - asset.bleed.x,
      y: asset.rect.y - asset.bleed.y,
      w: asset.rect.width + asset.bleed.x * 2,
      h: asset.rect.height + asset.bleed.y * 2,
    };
    const delta = Math.max(
      Math.abs(rendered.x - want.x),
      Math.abs(rendered.y - want.y),
      Math.abs(rendered.w - want.w),
      Math.abs(rendered.h - want.h),
    );
    worst = Math.max(worst, delta);
    rows.push(
      `${delta > 1.5 ? '  FAIL' : '  ok  '} ${asset.key.padEnd(26)} 期望 ${want.x},${want.y} ${want.w}x${want.h}  实际 ${rendered.x},${rendered.y} ${rendered.w}x${rendered.h}`,
    );
  }

  console.log(`画面 ${state.stageWidth.toFixed(0)}px 宽，缩放 ${state.scale.toFixed(4)}，素材 ${bySrc.size} 个`);
  console.log(rows.join('\n'));
  console.log(`\n最大偏差：${worst.toFixed(1)} 设计像素`);

  console.log('\n文字层：');
  for (const text of state.texts) {
    console.log(`  ${text.text.padEnd(24)} @ ${text.x},${text.y}`);
  }

  const hotspots = state.items.filter(i => String(i.src).includes('hmi-hotspot'));
  console.log(`\n热区 ${hotspotCount(hotspots)} 个：`);
  for (const hotspot of hotspots) {
    console.log(`  ${hotspot.src} @ ${hotspot.x},${hotspot.y} ${hotspot.w}x${hotspot.h}`);
  }

  process.exit(worst > 1.5 ? 1 : 0);
}

function hotspotCount(items) {
  return items.length;
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
