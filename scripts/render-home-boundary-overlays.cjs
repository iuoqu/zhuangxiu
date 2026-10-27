// Render a local visual review sheet for the seven assistant-drafted inventories.
// Generated HTML embeds the supplied plans; do not publish it with the site.
const fs = require('node:fs');
const path = require('node:path');
const reference = require('../test-data/home-plan-boundaries.json');

function findImages(root) {
  const found = new Map();
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/100027647[0-6]\.jpe?g$/i.test(entry.name))
        found.set(entry.name.replace(/^\d+-/, ''), file);
    }
  }
  walk(root);
  return found;
}

const images = findImages(path.join(__dirname, '..', '.codex-remote-attachments'));
const escape = value => String(value).replace(/[&<>"']/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const colors = { bedroom: '#6942d9', bathroom: '#dc6b17', living: '#07946c',
  dining: '#067faa', kitchen: '#d1367a', study: '#5a899e' };
const drawZone = (region, mode) => {
  const points = region.polygon.map(point => point.join(',')).join(' ');
  const [x, y] = region.polygon[0];
  const color = mode === 'excluded' ? '#c93737' : mode === 'unresolved' ? '#b45309' :
    colors[region.kind] || '#334155';
  const fill = mode === 'excluded' ? 'url(#noFurniture)' : color;
  const opacity = mode === 'enclosed' ? '.16' : mode === 'unresolved' ? '.06' : '.1';
  const dash = mode === 'enclosed' ? '9 6' : mode === 'functional' ? '3 7' :
    mode === 'unresolved' ? '2 5' : '12 4';
  const label = `${region.id}${mode === 'functional' ? ' · 功能区' :
    mode === 'excluded' ? ' · 禁摆' : mode === 'unresolved' ? ' · 待判' : ''}`;
  const anchor = Array.isArray(region.anchor) ? `<circle cx="${region.anchor[0]}" cy="${region.anchor[1]}" r="6" fill="${color}" stroke="white" stroke-width="2"/>` : '';
  return `<polygon points="${points}" fill="${fill}" fill-opacity="${opacity}" stroke="${color}" stroke-width="3" stroke-dasharray="${dash}"><title>${escape(label)} (${escape(region.kind)}) ${escape(region.reason || '')}</title></polygon>${anchor}<text x="${x + 5}" y="${y + 20}" fill="${color}" font-size="19" font-weight="700" paint-order="stroke" stroke="white" stroke-width="4">${escape(label)}</text>`;
};
const cards = reference.cases.map(item => {
  const image = images.get(item.file);
  if (!image) return `<section><h2>${escape(item.file)}</h2><p>原图未找到，无法渲染。</p></section>`;
  const source = `data:image/jpeg;base64,${fs.readFileSync(image).toString('base64')}`;
  const functional = item.functionalZones || [], excluded = item.excludedZones || [],
    unresolved = item.unresolvedZones || [];
  const outlines = item.regions.map(region => drawZone(region, 'enclosed')).join('') +
    functional.map(region => drawZone(region, 'functional')).join('') +
    excluded.map(region => drawZone(region, 'excluded')).join('') +
    unresolved.map(region => drawZone(region, 'unresolved')).join('');
  const status = item.inventoryStatus === 'complete_draft' ? '草稿清单已列齐，待独立核对' :
    '需更清晰原图复核待判区域，清单不完整';
  return `<section id="plan-${item.file.replace(/\D/g, '')}"><h2>${escape(item.file)} · ${item.regions.length} 封闭 / ${functional.length} 开放 / ${excluded.length} 禁摆 / ${unresolved.length} 待判</h2><p>${escape(item.note)}</p><svg viewBox="0 0 ${item.width} ${item.height}" role="img" aria-label="${escape(item.file)} 空间清单草稿"><defs><pattern id="noFurniture" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="12" stroke="#c93737" stroke-width="3"/></pattern></defs><image href="${source}" width="${item.width}" height="${item.height}"/>${outlines}</svg><p class="warning">${status}；${escape(item.reviewStatus)} / ${escape(item.scope)} 边界不计入正式准确率。</p></section>`;
}).join('');
const nav = reference.cases.map(item => `<a href="#plan-${item.file.replace(/\D/g, '')}">${escape(item.file.replace(/\.jpg$/i, '').slice(-4))}</a>`).join('');
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>户型空间清单复核</title><style>body{margin:0;background:#f4f6f9;color:#17202b;font:16px system-ui,sans-serif}main{max-width:1100px;margin:auto;padding:24px}section{background:white;margin:24px 0;padding:20px;border:1px solid #dce2eb;border-radius:12px}svg{display:block;width:100%;height:auto;border:1px solid #dce2eb}h1,h2{margin:0 0 12px}p{line-height:1.5}.warning{color:#9a4b06;font-weight:600}nav{display:flex;gap:12px;flex-wrap:wrap}nav a{padding:6px 10px;background:white;border:1px solid #dce2eb;border-radius:8px}</style><main><h1>7 张户型图：空间清单草稿</h1><p>长虚线＝封闭房间轮廓，点虚线＋圆点＝开放式功能区，红色斜纹＝禁摆/通行区，橙色短虚线＝无法确认的候选区。6474、6473、6471、6470 的目测清单已列齐；6476、6475、6472 仍需更清晰原图。所有标注尚待独立人工复核，不能据此宣称识别或家具适配准确。</p><nav aria-label="跳转图纸">${nav}</nav>${cards}</main></html>`;
const target = path.resolve(process.argv[2] || path.join(__dirname, '..', 'local-projects', 'home-boundary-review.html'));
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, html);
process.stdout.write(`${target}\n`);
