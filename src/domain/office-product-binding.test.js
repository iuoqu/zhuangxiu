import test from 'node:test';
import assert from 'node:assert/strict';
import { importCatalog } from './catalog-import.js';
import { buildProductSlots } from './product-slots.js';
import { buildProcurementBom } from './procurement-bom.js';
import { computeLayoutRevision } from './layout-revision.js';
import { bindReviewedOfficeScene, isOfficeProductScene } from './office-product-binding.js';

const source = { id: 'fictional-office', ref: 'fixture:fictional-office', observedAt: '2026-10-16T00:00:00Z',
  trustSpecs: true, trustUseSpec: true, trustPrice: true, trustAvailability: true,
  useReviewedBy: 'fixture-reviewer', useReviewedAt: '2026-10-16T01:00:00Z' };
const rows = [
  { role: 'workstation', supplierSku: 'D-1', widthMm: 1400, depthMm: 700, heightMm: 750,
    useZones: [{ purpose: 'chair seat', x: -300, y: 350, w: 600, h: 800 }] },
  { role: 'task-chair', supplierSku: 'C-1', widthMm: 600, depthMm: 600, heightMm: 1000,
    useZones: [{ purpose: 'pullback', x: -300, y: 300, w: 600, h: 500 }] },
  { role: 'phone-booth', supplierSku: 'P-1', widthMm: 1200, depthMm: 1200, heightMm: 2300,
    useZones: [{ purpose: 'door approach', x: -450, y: 600, w: 900, h: 800 }] },
  { role: 'storage-cabinet', supplierSku: 'S-1', widthMm: 900, depthMm: 450, heightMm: 1100,
    useZones: [{ purpose: 'drawer access', x: -450, y: 225, w: 900, h: 600 }] },
].map(row => ({ ...row, priceAmount: 100, currency: 'USD', availability: 'in_stock', leadDays: 7, purchaseUnit: 'single' }));
const candidates = importCatalog(source, rows).candidates;
const project = () => ({
  version: 1, name: 'Fictional office', w: 12000, h: 9000,
  site: { confirmed: true }, rules: { main: 1200, minor: 900 },
  objects: [{ id: 'entry', type: 'door', x: 0, y: 4500 }, { id: 'exit', type: 'exit', x: 12000, y: 4500 }],
  furniture: [
    { id: 'desk-1', kind: 'desk', x: 3000, y: 3000, w: 1400, h: 700, z: 750, rot: 0, sku: 'DEMO-DESK', price: 999 },
    { id: 'phone-1', kind: 'phone', x: 7000, y: 2500, w: 1200, h: 1200, z: 2300, rot: 0 },
    { id: 'cabinet-1', kind: 'cabinet', x: 7000, y: 5500, w: 900, h: 450, z: 1100, rot: 0 },
  ],
});
const displayFurniture = plan => {
  const desk = plan.furniture.find(item => item.id === 'desk-1');
  const saved = plan.derivedProducts?.['desk-1-chair-0'];
  return [...plan.furniture, { id: 'desk-1-chair-0', kind: 'chair', x: desk.x,
    y: desk.y + desk.h / 2 + 350, w: saved?.w || 600, h: saved?.h || 600,
    z: saved?.z || 1000, rot: 0, linkedTo: desk.id, derived: true }];
};
const selections = () => [
  ['desk-1', candidates[0]], ['desk-1-chair-0', candidates[1]],
  ['phone-1', candidates[2]], ['cabinet-1', candidates[3]],
].map(([sourceInstanceId, candidate]) => ({ sourceInstanceId, candidateId: candidate.candidateId }));

test('generated office chair and primary furniture bind as four distinct sourced items', async () => {
  const original = project();
  assert.equal(isOfficeProductScene(original, displayFurniture(original)), true);
  const result = await bindReviewedOfficeScene({ project: original, selections: selections(), candidates, displayFurniture });
  assert.equal(result.status, 'bound', result.reasons?.join(', '));
  assert.equal(result.procurementDraft.itemCount, 4);
  assert.equal(result.procurementDraft.readyCount, 4);
  assert.deepEqual(result.procurementDraft.merchandiseSubtotal, { amount: '400', currency: 'USD' });
  assert.equal(result.project.productBindings.length, 4);
  assert.equal(result.project.derivedProducts['desk-1-chair-0'].productCandidateId, candidates[1].candidateId);
  assert.equal(result.project.furniture[0].sku, null);
  assert.equal(original.derivedProducts, undefined);
  const changed = structuredClone(result.project);
  changed.furniture[0].x += 200;
  const displayed = displayFurniture(changed);
  const stale = buildProcurementBom({ slots: buildProductSlots(displayed), bindings: changed.productBindings,
    candidates, layoutRevision: await computeLayoutRevision(changed, displayed, changed.productProfiles) });
  assert.equal(stale.merchandiseSubtotal, null);
  assert.equal(stale.readyCount, 0);
});

test('missing generated member, unreviewed use evidence and broken relation reject the scene', async () => {
  const missing = await bindReviewedOfficeScene({ project: project(), selections: selections().slice(0, 3), candidates, displayFurniture });
  assert.deepEqual(missing.reasons, ['one_product_required_per_instance']);
  const badCandidate = { ...candidates[1], verification: { ...candidates[1].verification, use: false } };
  const unreviewed = await bindReviewedOfficeScene({ project: project(), selections: selections(),
    candidates: [candidates[0], badCandidate, ...candidates.slice(2)], displayFurniture });
  assert.deepEqual(unreviewed.reasons, ['product_use_spec_unverified:desk-1-chair-0']);
  const unlinked = plan => displayFurniture(plan).map(item => item.id === 'desk-1-chair-0' ? { ...item, linkedTo: null } : item);
  const broken = await bindReviewedOfficeScene({ project: project(), selections: selections(), candidates, displayFurniture: unlinked });
  assert.deepEqual(broken.reasons, ['derived_relation_missing:desk-1-chair-0']);
});

test('a generated meeting chair remains a separate product linked to its table', async () => {
  const [table, chair] = importCatalog(source, [
    { role: 'meeting-table', supplierSku: 'MT-1', widthMm: 3600, depthMm: 1200, heightMm: 750,
      useZones: [{ purpose: 'meeting seat', x: -300, y: 600, w: 600, h: 800 }] },
    { role: 'meeting-chair', supplierSku: 'MC-1', widthMm: 600, depthMm: 600, heightMm: 900,
      useZones: [{ purpose: 'pullback', x: -300, y: 300, w: 600, h: 500 }] },
  ].map(row => ({ ...row, priceAmount: 100, currency: 'USD', availability: 'in_stock', leadDays: 7, purchaseUnit: 'single' }))).candidates;
  const plan = project();
  plan.furniture = [{ id: 'meeting-1', kind: 'meeting', x: 5000, y: 4000,
    w: 3600, h: 1200, z: 750, rot: 0 }];
  const displayMeeting = value => [value.furniture[0], {
    id: 'meeting-1-chair-0', kind: 'meetingChair', x: 5000, y: 5000,
    w: value.derivedProducts?.['meeting-1-chair-0']?.w || 600,
    h: value.derivedProducts?.['meeting-1-chair-0']?.h || 600,
    z: value.derivedProducts?.['meeting-1-chair-0']?.z || 900,
    rot: 0, linkedTo: 'meeting-1', derived: true,
  }];
  const result = await bindReviewedOfficeScene({ project: plan, selections: [
    { sourceInstanceId: 'meeting-1', candidateId: table.candidateId },
    { sourceInstanceId: 'meeting-1-chair-0', candidateId: chair.candidateId },
  ], candidates: [table, chair], displayFurniture: displayMeeting });
  assert.equal(result.status, 'bound', result.reasons?.join(', '));
  assert.equal(result.procurementDraft.readyCount, 2);
  assert.equal(result.procurementDraft.lines.length, 2);
});
