import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoCatalog, DEMO_CATALOG_VERSION, DEMO_VISUAL_ASSET_VERSION } from './demo-catalog.js';
import { buildDemoProductPackages } from './demo-product-packages.js';
import { createDemoQuote, confirmDemoQuote, createDemoOrderRequest, demoQuoteMatches } from './demo-quote.js';

const baseSpecs = [
  ['wardrobe', 'WARDROBE', 1600, 600, 2200, 900], ['table', 'TABLE', 1400, 800, 750, 360],
  ['homeChair', 'CHAIR', 500, 550, 850, 150], ['vanity', 'VANITY', 1200, 500, 1400, 520],
  ['sofa', 'SOFA', 2200, 900, 850, 1800], ['coffeeTable', 'COFFEE', 1100, 600, 450, 240],
  ['lowCabinet', 'LOW', 1200, 450, 650, 340], ['bed', 'BED', 1800, 2100, 1000, 1100],
].map(([kind, sku, width, depth, height, samplePrice]) => ({ kind, sku, name: kind, width, depth, height, samplePrice }));

test('showcase catalog covers the eight required furniture categories with three tiers', () => {
  const catalog = createDemoCatalog(baseSpecs);
  assert.equal(catalog.version, DEMO_CATALOG_VERSION);
  for (const category of ['wardrobe', 'table', 'chair', 'vanity', 'sofa', 'coffee_table', 'low_cabinet', 'bed']) {
    const matches = catalog.candidates.filter(candidate => candidate.category === category);
    assert.ok(matches.length >= 3, category);
    assert.deepEqual(new Set(matches.map(candidate => candidate.demoTier)), new Set(['value', 'balanced', 'signature']));
    assert.ok(matches.every(candidate => candidate.verification.spec && candidate.verification.price &&
      candidate.verification.availability && candidate.verification.use));
    assert.ok(matches.every(candidate => candidate.visualSpec.assetVersion === DEMO_VISUAL_ASSET_VERSION));
    assert.ok(matches.every(candidate => candidate.visualSpec.shapeTemplate));
    assert.equal(new Set(matches.map(candidate => candidate.visualSpec.plan.fill)).size, 3);
  }
});

test('automatic packages fill the whole scene and remain visibly different', () => {
  const catalog = createDemoCatalog(baseSpecs);
  const slots = catalog.candidates.filter(candidate => candidate.demoTier === 'balanced').map((candidate, index) => ({
    slotId: `slot-${index}`, sourceInstanceId: `item-${index}`, category: candidate.category,
    role: candidate.role, label: candidate.name, envelopeMm: { width: candidate.dimensionsMm.width, depth: candidate.dimensionsMm.depth },
  }));
  const packages = buildDemoProductPackages({ slots, candidates: catalog.candidates, budget: 100000 });
  assert.deepEqual(packages.map(plan => plan.status), ['complete', 'complete', 'complete']);
  assert.ok(packages.every(plan => plan.selections.length === slots.length));
  assert.ok(packages[0].subtotal.amount < packages[1].subtotal.amount);
  assert.ok(packages[1].subtotal.amount < packages[2].subtotal.amount);
  assert.equal(new Set(packages.flatMap(plan => plan.selections.map(selection => selection.candidateId))).size, slots.length * 3);
});

test('demo quote stays tied to the catalog, layout and procurement snapshot', () => {
  const draft = { pendingCount: 0, merchandiseSubtotal: { amount: '1000', currency: 'USD' }, lines: [
    { candidateId: 'demo:chair', supplierSku: 'CHAIR', label: 'Chair', quantity: 2,
      unitPrice: { amount: 500, currency: 'USD' }, status: 'ready_for_quote_review' },
  ] };
  const quote = createDemoQuote({ projectName: 'Showcase', layoutRevision: 'layout-v1:abc',
    catalogVersion: DEMO_CATALOG_VERSION, procurementDraft: draft, createdAt: '2026-10-17T00:00:00.000Z' });
  assert.equal(quote.amounts.total, 1456.35);
  assert.equal(demoQuoteMatches(quote, { layoutRevision: 'layout-v1:abc', catalogVersion: DEMO_CATALOG_VERSION, procurementDraft: draft }), true);
  assert.equal(demoQuoteMatches(quote, { layoutRevision: 'layout-v1:changed', catalogVersion: DEMO_CATALOG_VERSION, procurementDraft: draft }), false);
  const confirmed = confirmDemoQuote(quote, '2026-10-18T00:00:00.000Z');
  const order = createDemoOrderRequest(confirmed, '2026-10-18T01:00:00.000Z');
  assert.equal(order.status, 'request_received');
  assert.match(order.orderRequestNumber, /^DEMO-OR-/);
});
