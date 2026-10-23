// Repeatable geometry-only diagnostic for supplied floor plans. A proposal count
// is not recognition accuracy: semantic labels and surveyed outlines are absent.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const files = process.argv.slice(2).flatMap(input => {
  const target = path.resolve(input);
  if (!fs.existsSync(target)) throw new Error(`Missing image path: ${input}`);
  return fs.statSync(target).isDirectory()
    ? fs.readdirSync(target).filter(name => /\.(jpe?g|png|webp)$/i.test(name)).sort()
      .map(name => path.join(target, name)) : [target];
});
if (!files.length) throw new Error('Usage: node scripts/evaluate-home-holdouts.cjs <image-or-folder> [...]');

const overlapOfSmaller = (a, b) => {
  const width = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return width * height / Math.min(a.w * a.h, b.w * b.h);
};

async function main() {
  let sharp;
  try { sharp = require('sharp'); }
  catch { throw new Error('Image decoder missing; set NODE_PATH to a runtime containing sharp.'); }
  const { buildHomePlanStructure } = await import('../src/domain/home-room-segmentation.js');
  const rows = [];
  for (const file of files) {
    const input = fs.readFileSync(file);
    const original = await sharp(input).metadata();
    const scale = Math.min(1, 1600 / Math.max(original.width, original.height));
    const compressed = await sharp(input).resize({ width: Math.round(original.width * scale),
      height: Math.round(original.height * scale), fit: 'fill' }).jpeg({ quality: 78 }).toBuffer();
    const { data, info } = await sharp(compressed).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const structure = buildHomePlanStructure(data, info.width, info.height);
    const { inkBounds, regions, candidates, contrastFallback } = structure;
    const nestedPairs = [];
    for (let i = 0; i < regions.length; i++) for (let j = i + 1; j < regions.length; j++)
      if (overlapOfSmaller(regions[i], regions[j]) >= .8) nestedPairs.push([i + 1, j + 1]);
    rows.push({ image: path.basename(file), sha256: createHash('sha256').update(input).digest('hex').slice(0, 12),
      size: `${info.width}x${info.height}`, inkBounds, proposals: regions.length,
      selectedCandidates: candidates.length, contrastFallback, nestedPairs,
      boxes: regions.map(({ x, y, w, h, area, fillRatio, touchesEdge, stableRuns }) =>
        ({ x, y, w, h, area, fillRatio, touchesEdge, stableRuns })) });
  }
  process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
  process.stderr.write('Geometry proposals only; compare overlays with independently annotated rooms before claiming accuracy.\n');
}
main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
