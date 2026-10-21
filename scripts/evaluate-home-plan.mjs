import { readFile } from 'node:fs/promises';
import { evaluateHomePlanZones } from '../src/domain/home-plan-eval.js';
import { createHomeProject, assessHomePackage } from '../src/domain/home-packages.js';
import { mockProductsForPackage } from '../src/domain/home-mock-catalog.js';
import { createHomeAutoDraft } from '../src/domain/home-auto-draft.js';
import { buildHomeConceptLayout } from '../src/domain/home-concept-layout.js';

const args = process.argv.slice(2);
const valueOf = flag => args[args.indexOf(flag) + 1];
const referencePath = args.includes('--reference') ? valueOf('--reference') : null;
const actualPath = args.includes('--actual') ? valueOf('--actual') : null;
if (!referencePath || !actualPath || referencePath.startsWith('--') || actualPath.startsWith('--')) {
  process.stderr.write('Usage: node scripts/evaluate-home-plan.mjs --reference <annotated-project.json> --actual <AI-export-or-response.json> [--strict]\n');
  process.exit(1);
}

try {
  const reference = JSON.parse(await readFile(referencePath, 'utf8'));
  const actual = JSON.parse(await readFile(actualPath, 'utf8'));
  if (!reference?.site?.source || !Array.isArray(reference.site.zones))
    throw new TypeError('Reference must be an annotated home project with an image and zones');
  const suggestions = Array.isArray(actual.suggestions) ? actual.suggestions : actual?.site?.zones;
  if (!Array.isArray(suggestions)) throw new TypeError('Actual file must contain suggestions or exported site.zones');
  const actualSource = actual?.site?.source || actual.source || reference.site.source;
  const zoneReport = evaluateHomePlanZones(reference.site, suggestions, actualSource);
  const actualSite = actual?.site?.source?.kind === 'image' && Array.isArray(actual.site.zones)
    ? actual.site : { source: actualSource, ...createHomeAutoDraft(suggestions, actualSource, 0) };
  const project = createHomeProject(reference.packageId, reference.apartmentType);
  project.products = mockProductsForPackage(project.packageId);
  const lines = assessHomePackage(project).lines;
  const layout = buildHomeConceptLayout(lines, actualSite);
  const required = lines.filter(line => line.key !== 'queen_mattress')
    .reduce((sum, line) => sum + line.quantity, 0);
  const zoneIdsReliable = actualSite.zones.length === suggestions.length;
  const matchedZoneIds = new Set(zoneIdsReliable ? zoneReport.matches.map(match =>
    actualSite.zones[match.candidateIndex]?.id).filter(Boolean) : []);
  const placedOnMatchedZones = zoneIdsReliable ? layout.placements.filter(item =>
    matchedZoneIds.has(item.zoneId)).length : null;
  const referenceAspect = reference.site.source.widthPx / reference.site.source.heightPx;
  const actualAspect = actualSource.widthPx / actualSource.heightPx;
  const aspectDifference = Number.isFinite(actualAspect)
    ? Math.abs(actualAspect / referenceAspect - 1) : null;
  const furniture = { requiredOccupancyItems: required, placedItems: layout.placedCount,
    placedOnMatchedZones, pendingItems: layout.pendingCount,
    visualOnlyItems: layout.visualOnlyCount,
    coverage: required ? Number((layout.placedCount / required).toFixed(3)) : 1,
    pendingReasons: layout.issues.map(item => ({ label: item.label, reason: item.reason })) };
  const report = { referenceFile: referencePath, actualFile: actualPath,
    sameAspectRatio: aspectDifference !== null && aspectDifference <= 0.01,
    aspectDifference: aspectDifference === null ? null : Number(aspectDifference.toFixed(4)),
    zones: zoneReport, furniture,
    samplePass: zoneReport.samplePass && furniture.placedItems === required &&
      furniture.placedOnMatchedZones === required && aspectDifference !== null && aspectDifference <= 0.01,
    releaseReady: false,
    note: 'This is an offline single-plan diagnostic. It does not certify AI reliability, measured fit, products, or delivery.' };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (args.includes('--strict') && !report.samplePass) process.exitCode = 2;
} catch (error) {
  process.stderr.write(`Evaluation failed: ${error.message}\n`);
  process.exitCode = 1;
}
