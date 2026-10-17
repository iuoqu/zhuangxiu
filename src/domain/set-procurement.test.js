import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTrustedCatalog } from './trusted-catalog.js';
import { bindReviewedHomeScene } from './home-product-binding.js';
import { buildSetProcurementDraft } from './set-procurement.js';
import { setOfferSnapshot } from './set-offers.js';

const configuration = {
  sources: [{
    id: 'fictional-set-source', ref: 'fixture:fictional-table-set', observedAt: '2026-10-16T00:00:00.000Z',
    trustSpecs: true, trustPrice: true, trustAvailability: true, trustUseSpec: true, trustSets: true,
    useReviewedBy: 'fixture-reviewer', useReviewedAt: '2026-10-16T01:00:00.000Z',
    setsReviewedBy: 'fixture-reviewer', setsReviewedAt: '2026-10-16T01:00:00.000Z',
    products: [
      { category: 'table', supplierSku: 'T-1', widthMm: 1800, depthMm: 800, heightMm: 750,
        useZones: [{ purpose: 'seating', x: -900, y: 400, w: 1800, h: 1000 }],
        priceAmount: 400, currency: 'USD', availability: 'in_stock', leadDays: 7, purchaseUnit: 'single' },
      { category: 'chair', supplierSku: 'C-1', widthMm: 500, depthMm: 550, heightMm: 850,
        useZones: [{ purpose: 'pullback', x: -250, y: 275, w: 500, h: 600 }],
        priceAmount: 150, currency: 'USD', availability: 'in_stock', leadDays: 7, purchaseUnit: 'single' },
    ],
    sets: [{ supplierSku: 'T-C-SET', priceAmount: 550, currency: 'USD', availability: 'in_stock', leadDays: 7,
      components: [{ supplierSku: 'T-1', quantity: 1 }, { supplierSku: 'C-1', quantity: 2 }] }],
  }],
};
const displayFurniture = plan => plan.furniture.map(item => ({ ...item }));
const project = () => ({
  w: 12000, h: 8000, site: { confirmed: true }, rules: { main: 1200, minor: 900 },
  objects: [{ id: 'entrance', type: 'door', x: 0, y: 4000 }, { id: 'exit', type: 'exit', x: 12000, y: 4000 }],
  furniture: [
    { id: 'table-1', kind: 'table', x: 4000, y: 3000, w: 1800, h: 800, z: 750, rot: 0 },
    { id: 'chair-1', kind: 'homeChair', x: 3500, y: 4100, w: 500, h: 550, z: 850, rot: 0, linkedTo: 'table-1' },
    { id: 'chair-2', kind: 'homeChair', x: 4500, y: 4100, w: 500, h: 550, z: 850, rot: 0, linkedTo: 'table-1' },
  ],
});

test('fictional table set replaces three individual prices with one sourced set and exact component counts', async () => {
  const { candidates, setOffers } = loadTrustedCatalog(configuration);
  const selections = project().furniture.map((item, index) => ({ sourceInstanceId: item.id, candidateId: candidates[index ? 1 : 0].candidateId }));
  const bound = await bindReviewedHomeScene({ project: project(), selections, candidates, displayFurniture });
  assert.equal(bound.status, 'bound', bound.reasons?.join(','));
  assert.deepEqual(bound.procurementDraft.merchandiseSubtotal, { amount: '700', currency: 'USD' });
  const offer = setOffers[0];
  const setSelection = { offerId: offer.offerId, offerSnapshot: setOfferSnapshot(offer),
    instanceIds: ['table-1', 'chair-1', 'chair-2'] };
  const input = { baseDraft: bound.procurementDraft, furniture: bound.project.furniture, offers: setOffers, selections: [setSelection] };
  const result = buildSetProcurementDraft(input);
  assert.equal(result.readyCount, 3);
  assert.equal(result.purchaseLines.length, 1);
  assert.equal(result.purchaseLines[0].supplierSku, 'T-C-SET');
  assert.deepEqual(result.purchaseLines[0].components.map(part => [part.supplierSku, part.quantity]), [['T-1', 1], ['C-1', 2]]);
  assert.deepEqual(result.merchandiseSubtotal, { amount: '550', currency: 'USD' });
  assert.equal(result.quoteStatus, 'not_quoted');
  const chairPair = loadTrustedCatalog({ sources: [{ ...configuration.sources[0], sets: [{
    ...configuration.sources[0].sets[0], supplierSku: 'CHAIR-PAIR', priceAmount: 240,
    components: [{ supplierSku: 'C-1', quantity: 2 }],
  }] }] }).setOffers[0];
  const pairOnly = buildSetProcurementDraft({ ...input, offers: [chairPair], selections: [{
    offerId: chairPair.offerId, offerSnapshot: setOfferSnapshot(chairPair), instanceIds: ['chair-1', 'chair-2'],
  }] });
  assert.equal(pairOnly.purchaseLines.length, 2, 'the table stays an individual purchase line');
  assert.deepEqual(pairOnly.merchandiseSubtotal, { amount: '640', currency: 'USD' });

  const changedOffer = { ...offer, price: { amount: 600, currency: 'USD' } };
  const stale = buildSetProcurementDraft({ ...input, offers: [changedOffer] });
  assert.ok(stale.setLines[0].reasons.includes('set_offer_stale'));
  assert.equal(stale.merchandiseSubtotal, null);
  const deleted = buildSetProcurementDraft({ ...input,
    baseDraft: { ...bound.procurementDraft, itemCount: 2, items: bound.procurementDraft.items.slice(0, 2) },
    furniture: bound.project.furniture.slice(0, 2),
  });
  assert.ok(deleted.setLines[0].reasons.includes('set_members_missing'));
  assert.equal(deleted.merchandiseSubtotal, null);
  const replaced = buildSetProcurementDraft({ ...input, baseDraft: {
    ...bound.procurementDraft, items: bound.procurementDraft.items.map(item => item.sourceInstanceId === 'chair-2'
      ? { ...item, candidateId: 'replacement:chair' } : item),
  } });
  assert.ok(replaced.setLines[0].reasons.includes('set_components_mismatch'));
  assert.equal(replaced.merchandiseSubtotal, null);
  assert.throws(() => buildSetProcurementDraft({ ...input, selections: [setSelection, setSelection] }), /distinct unclaimed/);
});

test('missing or unreviewed set component records never create a priced set', () => {
  const { candidates, setOffers } = loadTrustedCatalog(configuration);
  assert.throws(() => loadTrustedCatalog({ sources: [{ ...configuration.sources[0], sets: [{
    ...configuration.sources[0].sets[0], components: [{ supplierSku: 'T-1', quantity: 1 }, { supplierSku: 'NOT-FOUND', quantity: 2 }],
  }] }] }), /single-unit products/);
  assert.equal(candidates.length, 2);
  const unreviewed = loadTrustedCatalog({ sources: [{ ...configuration.sources[0], trustSets: false }] }).setOffers[0];
  assert.equal(unreviewed.verification.components, false);
  const chairPair = loadTrustedCatalog({ sources: [{ ...configuration.sources[0], sets: [{
    ...configuration.sources[0].sets[0], supplierSku: 'CHAIR-PAIR',
    components: [{ supplierSku: 'C-1', quantity: 2 }],
  }] }] }).setOffers[0];
  assert.deepEqual(chairPair.components.map(part => [part.supplierSku, part.quantity]), [['C-1', 2]]);
  assert.equal(setOffers.length, 1);
});
