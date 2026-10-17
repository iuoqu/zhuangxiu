import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveProductVisual, summarizeProductVisuals } from './product-visuals.js';

const baseSpecs = [{ kind: 'chair', modelParts: [['fabric', 0, 0, 0, 1, 1, 1]] }];
const candidate = (id, tier, fill) => ({ candidateId: id, supplierSku: id.toUpperCase(), demoTier: tier,
  finish: `${tier} finish`, sceneKind: 'chair', visualSpec: { assetVersion: 'visual-v1', shapeTemplate: 'chair',
    shapeVariant: tier, plan: { fill, stroke: '#111', label: '#fff', accent: fill },
    materials: { fabric: [fill, '#222', '#ddd'] } } });
const candidates = [candidate('value-chair', 'value', '#ddd'), candidate('style-chair', 'signature', '#333')];

test('temporary package choice drives the resolved product visual before binding', () => {
  const item = { id: 'chair-1', kind: 'chair', productCandidateId: 'value-chair' };
  const resolved = resolveProductVisual({ item, candidateId: 'style-chair', candidates, baseSpecs });
  assert.equal(resolved.candidateId, 'style-chair');
  assert.equal(resolved.tier, 'signature');
  assert.equal(resolved.previewing, true);
  assert.equal(resolved.plan.fill, '#333');
  assert.deepEqual(resolved.modelParts, baseSpecs[0].modelParts);
});

test('scene summary reports product visuals and safe generic fallbacks', () => {
  const items = [{ id: 'chair-1', kind: 'chair' }, { id: 'chair-2', kind: 'chair' }];
  const summary = summarizeProductVisuals({ items, selections: { 'chair-1': 'value-chair' }, candidates, baseSpecs });
  assert.equal(summary.itemCount, 2);
  assert.equal(summary.productVisualCount, 1);
  assert.equal(summary.fallbackCount, 1);
  assert.deepEqual(summary.tiers, ['value']);
  assert.equal(summary.visuals[1].productSpecific, false);
  assert.deepEqual(summary.visuals[1].materials.wood, ['#a57446', '#8d623b', '#d2a46d']);
});
