// Audit whole-plan space coverage separately from precise wall-boundary IoU.
// All seven checklists and geometries are assistant drafts, not verified truth.
const fs = require('node:fs');
const path = require('node:path');
const { polygonFor, contains } = require('./score-home-boundaries.cjs');
const reference = require('../test-data/home-plan-boundaries.json');
const checklist = require('../test-data/home-plan-space-checklist.json');

const groups = { enclosed: 'regions', functional: 'functionalZones', excluded: 'excludedZones',
  unresolved: 'unresolvedZones' };
const placeable = new Set(['bedroom', 'living', 'dining', 'study', 'mezzanine']);
const basename = file => path.basename(String(file || '')).replace(/^\d+-/, '');
const round = value => Number(value.toFixed(3));

function auditInventoryCase(plan, expected, diagnostic) {
  if (!plan || !expected || plan.file !== expected.file)
    throw new TypeError('A matching plan and visible-space checklist are required');
  const issues = [], expectedZones = [], allIds = [];
  for (const [group, field] of Object.entries(groups)) {
    const listed = Array.isArray(expected[group]) ? expected[group] : [];
    const actual = Array.isArray(plan[field]) ? plan[field] : [];
    const byId = new Map(actual.map(zone => [zone.id, zone]));
    for (const item of listed) {
      const zone = byId.get(item.id);
      if (!zone) issues.push(`missing ${group}: ${item.id}`);
      else if (zone.kind !== item.kind) issues.push(`wrong kind for ${item.id}: ${zone.kind}`);
      else expectedZones.push({ ...zone, group });
    }
    for (const item of actual) if (!listed.some(zone => zone.id === item.id))
      issues.push(`unlisted ${group}: ${item.id}`);
    allIds.push(...actual.map(zone => zone.id));
    for (const zone of actual) {
      const polygon = polygonFor(zone, plan.width, plan.height);
      if (!polygon) issues.push(`invalid polygon: ${zone.id}`);
      if (group === 'functional' && (!Array.isArray(zone.anchor) || zone.anchor.length !== 2 ||
          !zone.anchor.every(Number.isFinite) || !polygon ||
          !contains(polygon, zone.anchor[0] / plan.width, zone.anchor[1] / plan.height)))
        issues.push(`functional anchor outside zone: ${zone.id}`);
      if (group === 'unresolved' && (!zone.reason || typeof zone.reason !== 'string'))
        issues.push(`unresolved reason missing: ${zone.id}`);
    }
  }
  if (new Set(allIds).size !== allIds.length) issues.push('duplicate space id');
  if (!['complete_draft', 'needs_source_review'].includes(expected.inventoryStatus))
    issues.push(`unsupported checklist inventory status: ${expected.inventoryStatus}`);
  if (plan.inventoryStatus !== expected.inventoryStatus)
    issues.push(`inventory status ${plan.inventoryStatus} differs from checklist ${expected.inventoryStatus}`);
  if (plan.inventoryStatus === 'complete_draft' && (plan.unresolvedZones || []).length)
    issues.push('complete_draft cannot contain unresolved zones');
  if (plan.inventoryStatus === 'needs_source_review' && !(plan.unresolvedZones || []).length)
    issues.push('needs_source_review requires unresolved zones');
  const targetZones = expectedZones.filter(zone => zone.group === 'enclosed' || zone.group === 'functional');
  const base = { file: plan.file, inventoryStatus: issues.length ? 'incomplete_draft' : plan.inventoryStatus,
    independentlyReviewed: false, checklistCount: Object.keys(groups).reduce((sum, group) =>
      sum + (expected[group] || []).length, 0),
    annotatedCount: allIds.length, issues,
    byRole: { enclosed: (plan.regions || []).length, functional: (plan.functionalZones || []).length,
      excluded: (plan.excludedZones || []).length, unresolved: (plan.unresolvedZones || []).length } };
  if (!diagnostic) return { ...base, diagnosticStatus: 'missing', anchorCoverage: null };
  const candidates = [...(Array.isArray(diagnostic.spaces) ? diagnostic.spaces : []),
    ...(Array.isArray(diagnostic.unresolved) ? diagnostic.unresolved : [])].map((item, index) => {
    const x = Number.isFinite(item.anchorX) ? item.anchorX :
      Number.isFinite(item.x) && Number.isFinite(item.w) ? item.x + item.w / 2 : item.x;
    const y = Number.isFinite(item.anchorY) ? item.anchorY :
      Number.isFinite(item.y) && Number.isFinite(item.h) ? item.y + item.h / 2 : item.y;
    return { index, kind: item.kind, x: x / diagnostic.imageWidth, y: y / diagnostic.imageHeight };
  }).filter(item => Number.isFinite(item.x) && Number.isFinite(item.y) &&
    item.x >= 0 && item.x <= 1 && item.y >= 0 && item.y <= 1);
  const used = new Set(), found = [];
  for (const zone of targetZones) {
    const polygon = polygonFor(zone, plan.width, plan.height);
    if (!polygon) continue;
    const candidate = candidates.find(item => !used.has(item.index) && item.kind === zone.kind &&
      contains(polygon, item.x, item.y));
    if (candidate) { used.add(candidate.index); found.push(zone.id); }
  }
  const forbiddenAnchors = candidates.flatMap(item => !placeable.has(item.kind) ? [] :
    expectedZones.filter(zone => {
      const polygon = polygonFor(zone, plan.width, plan.height);
      return (zone.group === 'excluded' || zone.group === 'unresolved') && polygon &&
        contains(polygon, item.x, item.y);
    })
      .map(zone => ({ candidateIndex: item.index, zoneId: zone.id, kind: item.kind })));
  const duplicateAnchors = candidates.flatMap(item => used.has(item.index) ? [] :
    targetZones.filter(zone => {
      const polygon = polygonFor(zone, plan.width, plan.height);
      return zone.kind === item.kind && polygon && contains(polygon, item.x, item.y);
    })
      .map(zone => ({ candidateIndex: item.index, zoneId: zone.id })));
  return { ...base, diagnosticStatus: 'scored_against_draft',
    expectedDetectable: targetZones.length, matched: found.length,
    anchorCoverage: issues.length || plan.inventoryStatus !== 'complete_draft' || !targetZones.length ?
      null : round(found.length / targetZones.length),
    found, missing: targetZones.filter(zone => !found.includes(zone.id)).map(zone => zone.id),
    duplicateAnchors, forbiddenAnchors,
    caveat: 'Location checks use assistant-drafted semantic zones. This is not an audited AI accuracy score.' };
}

function auditInventory(diagnostics = [], planSet = reference, expectedSet = checklist) {
  const byFile = new Map(diagnostics.map(item => [basename(item.file), item]));
  const plans = new Map((planSet.cases || []).map(item => [item.file, item]));
  const cases = (expectedSet.cases || []).map(item => auditInventoryCase(
    plans.get(item.file), item, byFile.get(item.file)));
  return { cases, draftChecklistsComplete: cases.every(item => item.inventoryStatus === 'complete_draft'),
    auditPassed: cases.every(item => item.issues.length === 0),
    completeDraftCount: cases.filter(item => item.inventoryStatus === 'complete_draft').length,
    needsSourceReviewCount: cases.filter(item => item.inventoryStatus === 'needs_source_review').length,
    completeDiagnostics: cases.every(item => item.diagnosticStatus !== 'missing'),
    formalAccuracy: null,
    caveat: 'All seven inventories are assistant drafts. Unresolved zones need a clearer source and none has independent human review.' };
}

if (require.main === module) {
  try {
    const files = process.argv.slice(2);
    const report = auditInventory(files.map(file => JSON.parse(fs.readFileSync(file, 'utf8'))));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.auditPassed) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`Inventory audit failed: ${error.message}\n`);
    process.exitCode = 2;
  }
}

module.exports = { auditInventory, auditInventoryCase };
