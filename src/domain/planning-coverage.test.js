import test from 'node:test';
import assert from 'node:assert/strict';
import { importCatalog } from './catalog-import.js';
import { buildProductSlots } from './product-slots.js';
import { auditPlanningCoverage, candidateEvidenceGaps } from './planning-coverage.js';

const source = { id: 'fictional-coverage', ref: 'fixture:fictional-coverage',
  observedAt: '2026-10-16T00:00:00Z', trustSpecs: true, trustUseSpec: true,
  trustPrice: true, trustAvailability: true, useReviewedBy: 'fixture-reviewer',
  useReviewedAt: '2026-10-16T01:00:00Z' };
const readyRow = (role, sku, width, depth, height) => ({ role, supplierSku: sku,
  widthMm: width, depthMm: depth, heightMm: height,
  useZones: [{ purpose: 'fixture access', x: -50, y: depth / 2, w: 100, h: 50 }],
  priceAmount: 100, currency: 'USD', availability: 'in_stock', leadDays: 7,
  purchaseUnit: 'single' });
const slots = buildProductSlots([
  { id: 'table-1', kind: 'diningTable', w: 1000, h: 700, z: 750 },
  { id: 'chair-1', kind: 'diningChair', w: 600, h: 600, z: 850 },
  { id: 'sofa-1', kind: 'sofa', w: 1600, h: 800, z: 850 },
  { id: 'display-1', kind: 'displayPlinth', w: 700, h: 500, z: 1100 },
]);

test('coverage names missing roles, incomplete evidence and unselected reviewed products per instance', () => {
  const candidates = importCatalog(source, [
    readyRow('dining-table', 'DT-1', 1000, 700, 750),
    { ...readyRow('dining-chair', 'DC-1', 600, 600, 850), useZones: undefined },
    readyRow('sofa', 'S-1', 1600, 800, 850),
  ]).candidates;
  const coverage = auditPlanningCoverage({ slots, candidates,
    selections: [{ sourceInstanceId: 'sofa-1', candidateId: candidates[2].candidateId }] });
  assert.equal(coverage.itemCount, 4);
  assert.equal(coverage.readyForPlacementReview, 1);
  assert.deepEqual(coverage.lines.map(line => line.reasons[0]), [
    'product_not_selected', 'catalog_evidence_incomplete', null, 'catalog_role_missing',
  ].map(value => value || undefined));
  assert.ok(coverage.lines[1].reasons.includes('use_spec_unverified'));
  assert.equal(coverage.roles.find(role => role.role === 'dining-chair').instanceIds[0], 'chair-1');
});

test('selected candidate mismatch and missing ID stay explicit', () => {
  const candidates = importCatalog(source, [readyRow('dining-table', 'DT-1', 1000, 700, 750)]).candidates;
  const missing = auditPlanningCoverage({ slots: slots.slice(0, 1), candidates,
    selections: [{ sourceInstanceId: 'table-1', candidateId: 'absent' }] });
  assert.deepEqual(missing.lines[0].reasons, ['selected_candidate_missing']);
  const mismatch = auditPlanningCoverage({ slots: slots.slice(0, 2), candidates,
    selections: [{ sourceInstanceId: 'chair-1', candidateId: candidates[0].candidateId }] });
  assert.deepEqual(mismatch.lines[1].reasons, ['category_or_role_mismatch']);
  const untrusted = { ...candidates[0], verification: { ...candidates[0].verification, price: false } };
  assert.deepEqual(candidateEvidenceGaps(untrusted), ['price_unverified']);
});
