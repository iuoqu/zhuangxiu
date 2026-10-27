const { test } = require('node:test');
const assert = require('node:assert/strict');
const { auditInventory, auditInventoryCase } = require('./audit-home-space-inventory.cjs');
const references = require('../test-data/home-plan-boundaries.json');
const checklists = require('../test-data/home-plan-space-checklist.json');

test('seven drafts reconcile to their visible-space checklists without claiming verified truth', () => {
  const report = auditInventory();
  assert.equal(report.auditPassed, true);
  assert.equal(report.draftChecklistsComplete, false);
  assert.equal(report.completeDraftCount, 4);
  assert.equal(report.needsSourceReviewCount, 3);
  assert.equal(report.formalAccuracy, null);
  assert.deepEqual(report.cases.map(item => item.checklistCount), [16, 15, 9, 13, 9, 10, 10]);
  assert.deepEqual(report.cases.map(item => item.annotatedCount), [16, 15, 9, 13, 9, 10, 10]);
  assert.ok(report.cases.every(item => item.independentlyReviewed === false));
});

test('missing open-plan dining cannot pass the whole-space checklist', () => {
  const original = references.cases.find(item => item.file === '1000276471.jpg');
  const checklist = checklists.cases.find(item => item.file === original.file);
  const altered = { ...original,
    functionalZones: original.functionalZones.filter(item => item.id !== 'dining') };
  const report = auditInventoryCase(altered, checklist);
  assert.equal(report.inventoryStatus, 'incomplete_draft');
  assert.match(report.issues.join(' '), /missing functional: dining/);
  assert.equal(report.anchorCoverage, null);
});

test('AI anchor audit separates detected spaces, duplicates and unsafe balcony placement', () => {
  const original = references.cases.find(item => item.file === '1000276471.jpg');
  const checklist = checklists.cases.find(item => item.file === original.file);
  const points = [
    ['bedroom', 250, 320], ['bathroom', 280, 900], ['living', 630, 420],
    ['dining', 720, 675], ['study', 270, 690], ['kitchen', 640, 930],
    ['living', 630, 420], ['living', 630, 100],
  ];
  const result = auditInventoryCase(original, checklist, { imageWidth: 960, imageHeight: 1280,
    spaces: points.map(([kind, anchorX, anchorY]) => ({ kind, anchorX, anchorY })) });
  assert.equal(result.anchorCoverage, 1);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.duplicateAnchors, [{ candidateIndex: 6, zoneId: 'living' }]);
  assert.deepEqual(result.forbiddenAnchors, [{ candidateIndex: 7, zoneId: 'balcony', kind: 'living' }]);
  assert.equal(result.independentlyReviewed, false);
});

test('an unresolved bathroom cannot be counted as a complete detected room', () => {
  const original = references.cases.find(item => item.file === '1000276476.jpg');
  const checklist = checklists.cases.find(item => item.file === original.file);
  const result = auditInventoryCase(original, checklist, { imageWidth: 1280, imageHeight: 705,
    spaces: [
      { kind: 'bedroom', anchorX: 300, anchorY: 270 },
      { kind: 'bedroom', anchorX: 820, anchorY: 270 },
      { kind: 'bedroom', anchorX: 975, anchorY: 270 },
      { kind: 'bathroom', anchorX: 235, anchorY: 480 },
      { kind: 'bedroom', anchorX: 1100, anchorY: 475 },
    ] });
  assert.equal(result.inventoryStatus, 'needs_source_review');
  assert.equal(result.anchorCoverage, null);
  assert.equal(result.byRole.unresolved, 4);
  assert.deepEqual(result.forbiddenAnchors, [{ candidateIndex: 4, zoneId: 'wc-right-edge', kind: 'bedroom' }]);
  assert.equal(result.formalAccuracy, undefined);
});
