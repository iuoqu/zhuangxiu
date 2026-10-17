import test from 'node:test';
import assert from 'node:assert/strict';
import { importCatalog } from './catalog-import.js';
import { buildProductSlots } from './product-slots.js';
import { buildProcurementBom } from './procurement-bom.js';

const source = {
  id: 'fixture-supplier', ref: 'fixture:catalog.csv', observedAt: '2026-10-14T00:00:00.000Z',
  format: 'csv', trustSpecs: true, trustPrice: true, trustAvailability: true, trustUseSpec: true,
  useReviewedBy: 'fixture-reviewer', useReviewedAt: '2026-10-14T01:00:00.000Z',
};
const chairZone = JSON.stringify([{ purpose: 'chair approach', x: -300, y: 300, w: 600, h: 500 }]);
const withZone = csv => csv.split('\n').map((line, index) => index ?
  `${line},"${chairZone.replaceAll('"', '""')}"` : `${line},useZones`).join('\n');
const slots = buildProductSlots([
  { id: 'chair-1', kind: 'chair', w: 600, h: 600, z: 1000, x: 1000, y: 1000 },
  { id: 'chair-2', kind: 'chair', w: 600, h: 600, z: 1000, x: 2000, y: 1000 },
]);
const csv = [
  'role,supplierSku,variantCode,name,widthMm,depthMm,heightMm,priceAmount,currency,availability,leadDays,purchaseUnit',
  'task-chair,CHAIR-1,BLACK,Office chair,600,600,1000,200,USD,in_stock,14,single',
].join('\n');
const verified = importCatalog(source, withZone(csv)).candidates[0];
const review = (slot, candidate = verified) => ({
  status: 'passed', slotId: slot.slotId, candidateId: candidate.candidateId,
  layoutRevision: 'layout-v1', candidateObservedAt: candidate.observedAt,
  productClearanceVerified: true, useSpecSnapshot: JSON.stringify(candidate.useSpec),
});
const bindings = slots.map(slot => ({ slotId: slot.slotId, candidateId: verified.candidateId, placementReview: review(slot) }));

test('unbound slots remain pending without copying illustrative SKU or value', () => {
  const result = buildProcurementBom({ slots, candidates: [verified], layoutRevision: 'layout-v1' });
  assert.equal(result.itemCount, 2);
  assert.equal(result.pendingCount, 2);
  assert.equal(result.lines.length, 1);
  assert.deepEqual(result.lines[0].reasons, ['needs_product']);
  assert.equal(result.merchandiseSubtotal, null);
  assert.equal(result.quoteStatus, 'not_quoted');
  assert.equal(result.lines[0].supplierSku, null);
  assert.equal(result.subtotalStatus, 'pending_items');
});

test('verified per-instance bindings reconcile into a priced procurement draft', () => {
  const result = buildProcurementBom({ slots, bindings, candidates: [verified], layoutRevision: 'layout-v1' });
  assert.equal(result.readyCount, 2);
  assert.equal(result.pendingCount, 0);
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0].quantity, 2);
  assert.deepEqual(result.lines[0].sourceInstanceIds, ['chair-1', 'chair-2']);
  assert.equal(result.lines[0].supplierSku, 'CHAIR-1');
  assert.equal(result.lines[0].variantCode, 'BLACK');
  assert.equal(result.lines[0].sourceRef, source.ref);
  assert.deepEqual(result.merchandiseSubtotal, { amount: '400', currency: 'USD' });
  assert.equal(result.subtotalStatus, 'complete');
  assert.equal(result.quoteStatus, 'not_quoted');
});

test('research candidates, stale checks and incomplete supply keep formal amount empty', () => {
  const untrusted = importCatalog({ ...source, id: 'web', trustSpecs: false, trustPrice: false, trustAvailability: false, trustUseSpec: false }, withZone(csv)).candidates[0];
  const webBindings = slots.map(slot => ({ slotId: slot.slotId, candidateId: untrusted.candidateId, placementReview: review(slot, untrusted) }));
  const research = buildProcurementBom({ slots, bindings: webBindings, candidates: [untrusted], layoutRevision: 'layout-v1' });
  assert.equal(research.readyCount, 0);
  assert.ok(research.items[0].reasons.includes('spec_unverified'));
  assert.ok(research.items[0].reasons.includes('supply_unverified'));
  assert.ok(research.items[0].reasons.includes('price_unverified'));
  assert.equal(research.merchandiseSubtotal, null);

  const stale = buildProcurementBom({ slots, bindings, candidates: [verified], layoutRevision: 'layout-v2' });
  assert.equal(stale.readyCount, 0);
  assert.deepEqual(stale.items[0].reasons, ['placement_unverified_or_stale']);
  const discontinued = { ...verified, availability: 'discontinued' };
  const unavailable = buildProcurementBom({ slots, bindings, candidates: [discontinued], layoutRevision: 'layout-v1' });
  assert.ok(unavailable.items[0].reasons.includes('not_confirmed_in_stock'));
  assert.equal(unavailable.merchandiseSubtotal, null);
  const set = { ...verified, purchaseUnit: 'set' };
  const unexpanded = buildProcurementBom({ slots, bindings, candidates: [set], layoutRevision: 'layout-v1' });
  assert.ok(unexpanded.items[0].reasons.includes('purchase_unit_not_expanded'));
  assert.equal(unexpanded.merchandiseSubtotal, null);
});

test('role, size and provenance mismatches cannot be promoted by a passed flag', () => {
  const wrongCategory = { ...verified, category: 'wardrobe' };
  const wrongRole = { ...verified, role: 'workstation' };
  const wrongSize = { ...verified, dimensionsMm: { ...verified.dimensionsMm, width: 800 } };
  const wrongSource = { ...verified, fieldSources: { ...verified.fieldSources, priceAmount: { ...verified.fieldSources.priceAmount, sourceRef: 'fixture:other.csv' } } };
  const changedPrice = { ...verified, price: { ...verified.price, amount: 1 } };
  for (const [candidate, expected] of [[wrongCategory, 'category_mismatch'], [wrongRole, 'role_mismatch'], [wrongSize, 'outside_design_envelope'], [wrongSource, 'price_unverified'], [changedPrice, 'price_unverified']]) {
    const result = buildProcurementBom({ slots, bindings, candidates: [candidate], layoutRevision: 'layout-v1' });
    assert.ok(result.items[0].reasons.includes(expected));
    assert.equal(result.merchandiseSubtotal, null);
  }
});

test('different currencies cannot be silently added into one merchandise subtotal', () => {
  const euro = importCatalog(source, withZone([
    'role,supplierSku,variantCode,name,widthMm,depthMm,heightMm,priceAmount,currency,availability,leadDays,purchaseUnit',
    'task-chair,CHAIR-2,BLACK,Office chair,600,600,1000,180,EUR,in_stock,14,single',
  ].join('\n'))).candidates[0];
  const mixedBindings = [bindings[0], { slotId: slots[1].slotId, candidateId: euro.candidateId, placementReview: review(slots[1], euro) }];
  const result = buildProcurementBom({ slots, bindings: mixedBindings, candidates: [verified, euro], layoutRevision: 'layout-v1' });
  assert.equal(result.readyCount, 2);
  assert.equal(result.subtotalStatus, 'mixed_currencies');
  assert.equal(result.merchandiseSubtotal, null);
});

test('decimal merchandise amounts add exactly without floating point drift', () => {
  const cheap = importCatalog(source, withZone([
    'role,supplierSku,variantCode,name,widthMm,depthMm,heightMm,priceAmount,currency,availability,leadDays,purchaseUnit',
    'task-chair,CHAIR-A,BLACK,Office chair,600,600,1000,0.1,USD,in_stock,14,single',
    'task-chair,CHAIR-B,BLACK,Office chair,600,600,1000,0.2,USD,in_stock,14,single',
  ].join('\n'))).candidates;
  const cheapBindings = slots.map((slot, index) => ({ slotId: slot.slotId, candidateId: cheap[index].candidateId, placementReview: review(slot, cheap[index]) }));
  const result = buildProcurementBom({ slots, bindings: cheapBindings, candidates: cheap, layoutRevision: 'layout-v1' });
  assert.deepEqual(result.merchandiseSubtotal, { amount: '0.3', currency: 'USD' });
});

test('duplicate or unknown bindings are rejected instead of silently changing quantities', () => {
  assert.throws(() => buildProcurementBom({ slots, bindings: [bindings[0], bindings[0]], candidates: [verified] }), /unique existing slot/);
  assert.throws(() => buildProcurementBom({ slots, bindings: [{ ...bindings[0], slotId: 'missing' }], candidates: [verified] }), /unique existing slot/);
  assert.throws(() => buildProcurementBom({ slots, bindings, candidates: [verified, verified] }), /unique IDs/);
});
