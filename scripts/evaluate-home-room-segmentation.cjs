// Optional local benchmark against the historical hand-drawn boxes.
// These boxes are approximate functional labels, not surveyed polygon ground truth.
const fs = require('node:fs');
const path = require('node:path');

const fixturePath = path.join(__dirname, '..', 'local-projects', '复式一室一厅-已标注.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const bboxIou = (a, b) => {
  const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const intersection = w * h;
  return intersection / (a.w * a.h + b.w * b.h - intersection || 1);
};

async function main() {
  let sharp;
  try { sharp = require('sharp'); }
  catch { throw new Error('Local image decoder missing; set NODE_PATH to a runtime containing sharp.'); }
  const image = Buffer.from(fixture.site.source.dataUrl.split(',')[1], 'base64');
  const { data, info } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { matchHomeRoomRegions, proposeHomeRoomRegions } = await import('../src/domain/home-room-segmentation.js');
  const regions = proposeHomeRoomRegions(data, info.width, info.height);
  const rows = regions.map((region, index) => {
    const best = fixture.site.zones.map(zone => ({ kind: zone.kind, iou: bboxIou(region, zone) }))
      .sort((a, b) => b.iou - a.iou)[0];
    return { proposal: index + 1, box: `${region.x},${region.y},${region.w},${region.h}`,
      stableRuns: region.stableRuns, closestManualKind: best.kind, boxIou: Number(best.iou.toFixed(2)) };
  });
  console.table(rows);
  const historical = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'local-projects',
    'live-ai-zones-panels-20261021.json'), 'utf8'));
  const matches = matchHomeRoomRegions(historical.suggestions, regions);
  console.table(matches.map((match, index) => {
    const candidate = historical.suggestions[index];
    const sameKind = fixture.site.zones.filter(zone => zone.kind === candidate.kind);
    const aiBoxIou = Math.max(0, ...sameKind.map(zone => bboxIou(candidate, zone)));
    const segBoxIou = match ? Math.max(0, ...sameKind.map(zone => bboxIou(match.region, zone))) : 0;
    const closest = match && fixture.site.zones.map(zone => ({ kind: zone.kind,
      iou: bboxIou(match.region, zone) })).sort((a, b) => b.iou - a.iou)[0];
    return { candidate: index + 1, aiKind: candidate.kind, matched: !!match,
      closestManualKind: closest?.kind || '-', aiBoxIou: Number(aiBoxIou.toFixed(2)),
      segBoxIou: Number(segBoxIou.toFixed(2)) };
  }));
  const assigned = matches.filter(Boolean).map(match => match.region);
  console.log(`Historical AI candidates: ${assigned.length}/${matches.length} region matches; duplicate region assignments: ${assigned.length - new Set(assigned).size}.`);
  console.log('Notice: matches include non-floors such as voids; no semantic or furniture placement is approved.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
