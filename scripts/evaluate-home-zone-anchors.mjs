import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createWorker } from 'tesseract.js';
import { extractHomeRoomAnchors, assessHomeZoneAnchors } from '../src/domain/home-zone-anchor-check.js';
import { evaluateHomePlanZones } from '../src/domain/home-plan-eval.js';

const args = process.argv.slice(2);
const valueOf = flag => args[args.indexOf(flag) + 1];
const referencePath = args.includes('--reference') ? valueOf('--reference') : null;
const actualPath = args.includes('--actual') ? valueOf('--actual') : null;
if (!referencePath || !actualPath || referencePath.startsWith('--') || actualPath.startsWith('--')) {
  process.stderr.write('Usage: node scripts/evaluate-home-zone-anchors.mjs --reference <annotated-project.json> --actual <AI-response.json>\n');
  process.exit(1);
}

try {
  const reference = JSON.parse(await readFile(referencePath, 'utf8'));
  const actual = JSON.parse(await readFile(actualPath, 'utf8'));
  const source = reference?.site?.source;
  const candidateSource = actual?.site?.source || actual.source || source;
  const zones = Array.isArray(actual.suggestions) ? actual.suggestions : actual?.site?.zones;
  if (source?.kind !== 'image' || !/^data:image\/(jpeg|png|webp);base64,/.test(source.dataUrl) ||
      !Array.isArray(zones) || !candidateSource?.widthPx || !candidateSource?.heightPx)
    throw new TypeError('An annotated image project and candidate zones are required');
  const referenceAspect = source.widthPx / source.heightPx;
  if (Math.abs((candidateSource.widthPx / candidateSource.heightPx) / referenceAspect - 1) > 0.01)
    throw new TypeError('Candidate image aspect ratio differs from the reference');
  const image = Buffer.from(source.dataUrl.slice(source.dataUrl.indexOf(',') + 1), 'base64');
  const cachePath = fileURLToPath(new URL('../local-projects/', import.meta.url));
  await mkdir(cachePath, { recursive: true });
  const worker = await createWorker('eng', 1, { cachePath });
  let blocks;
  try { ({ data: { blocks } } = await worker.recognize(image, {}, { blocks: true })); }
  finally { await worker.terminate(); }
  const anchors = extractHomeRoomAnchors(blocks || []);
  const mapped = zones.map(zone => ({ ...zone,
    x: zone.x * source.widthPx / candidateSource.widthPx,
    y: zone.y * source.heightPx / candidateSource.heightPx,
    w: zone.w * source.widthPx / candidateSource.widthPx,
    h: zone.h * source.heightPx / candidateSource.heightPx }));
  const anchorReport = assessHomeZoneAnchors(mapped, anchors, source);
  const zoneReport = evaluateHomePlanZones(reference.site, zones, candidateSource);
  const matches = new Set(zoneReport.matches.map(match => match.candidateIndex));
  const diagnostic = { referenceFile: referencePath, actualFile: actualPath,
    sample: { annotatedZones: zoneReport.metrics.expectedZones,
      matchedZonesAtIoU04: zoneReport.metrics.matchedZones },
    ocr: { anchors: anchors.map(anchor => ({ kind: anchor.kind, x: anchor.x, y: anchor.y,
      confidence: Math.round(anchor.confidence) })), count: anchors.length },
    candidateEvidence: anchorReport.rows.map(row => ({ ...row, matchesAnnotatedBox: matches.has(row.candidateIndex) })),
    summary: anchorReport.summary, unmatchedAnchors: anchorReport.unmatchedAnchors,
    note: 'One-image diagnostic only. OCR label location can flag suspect boxes but cannot validate walls, net dimensions, or placement.' };
  process.stdout.write(`${JSON.stringify(diagnostic, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`Anchor evaluation failed: ${error.message}\n`);
  process.exitCode = 1;
}
