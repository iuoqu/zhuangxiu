import test from 'node:test';
import assert from 'node:assert/strict';
import { createReviewSnapshot } from './review-snapshot.js';

test('an exported review remains tied to its captured layout, sources and pending reasons', () => {
  const project = {
    version: 1, name: 'Example', w: 9000, h: 6000,
    source: { kind: 'upload', fileName: 'plan.png', preview: 'data:image/png;base64,private' },
    site: { confirmed: true }, broker: { people: 4 }, rules: { main: 1200 },
    objects: [], furniture: [{ id: 'table-1', kind: 'table', x: 2000, y: 2000 }],
    productBindings: [{ slotId: 'slot:table-1', candidateId: 'candidate-1' }],
    productProfiles: { 'table-1': { reviewedBy: 'Reviewer' } },
    setSelections: [{ offerId: 'set-1', instanceIds: ['table-1', 'chair-1'] }],
  };
  const designBom = { itemCount: 1, lines: [{ label: 'Table', quantity: 1 }] };
  const baseDraft = { itemCount: 1, items: [{ sourceInstanceId: 'table-1', status: 'ready_for_quote_review' }] };
  const procurementDraft = {
    itemCount: 1, readyCount: 0, pendingCount: 1, subtotalStatus: 'pending_items',
    merchandiseSubtotal: null, purchaseLines: [{ kind: 'set', sourceInstanceIds: ['table-1', 'chair-1'],
      status: 'pending', reasons: ['set_members_missing'] }],
  };
  const candidates = [{ candidateId: 'candidate-1', supplierSku: 'TABLE-1', sourceRef: 'fixture:catalog', observedAt: '2026-10-16T00:00:00Z' },
    { candidateId: 'unselected', supplierSku: 'OTHER' }];
  const offers = [{ offerId: 'set-1', supplierSku: 'SET-1', sourceRef: 'fixture:catalog', observedAt: '2026-10-16T00:00:00Z' }];
  const capture = () => createReviewSnapshot({ project, displayFurniture: project.furniture, layoutRevision: 'layout-v1:abc', designBom,
    baseDraft, procurementDraft, candidates, offers, snapshotId: 'review-1', capturedAt: '2026-10-16T04:00:00Z' });
  const old = capture();
  const exported = JSON.stringify(old);
  project.furniture[0].x = 4000;
  project.productBindings[0].candidateId = 'replacement';
  candidates[0].supplierSku = 'CHANGED';
  procurementDraft.purchaseLines[0].reasons.push('price_changed');
  assert.equal(JSON.stringify(old), exported, 'later scene and catalog changes cannot rewrite the old review');
  assert.equal(old.layout.furniture[0].x, 2000);
  assert.deepEqual(old.procurement.pending[0].reasons, ['set_members_missing']);
  assert.equal(old.productEvidence.candidates.length, 1);
  assert.equal(old.project.source.preview, undefined, 'embedded plan preview is excluded');
  assert.equal(old.documentStatus, 'review_only_not_quote_or_order');
  assert.equal(Object.isFrozen(old.layout.furniture[0]), true);
  assert.equal(capture().layout.furniture[0].x, 4000, 'a later review captures the new state');
});
