import test from 'node:test';
import assert from 'node:assert/strict';
import { importCatalog } from './catalog-import.js';
import { buildProductSlots } from './product-slots.js';
import { buildProcurementBom } from './procurement-bom.js';
import { computeLayoutRevision } from './layout-revision.js';
import { reviewProductPlacement } from './product-placement.js';
import { bindProductToProject } from './product-binding.js';
import { requiredProductUseRects } from './product-use-spec.js';

const source = { id: 'fixture', ref: 'fixture:catalog.csv', observedAt: '2026-10-15T00:00:00.000Z',
  trustSpecs: true, trustPrice: true, trustAvailability: true, trustUseSpec: true,
  useReviewedBy: 'fixture-reviewer', useReviewedAt: '2026-10-15T01:00:00.000Z' };
const candidates = importCatalog(source, [
  { role: 'workstation', supplierSku: 'DESK-1', variantCode: 'BASE', name: 'Desk', widthMm: 1400, depthMm: 700,
    heightMm: 750, priceAmount: 450, currency: 'USD', availability: 'in_stock', leadDays: 14,
    purchaseUnit: 'single', useZones: [{ purpose: 'seat', x: -300, y: 350, w: 600, h: 800 }] },
  { role: 'task-chair', supplierSku: 'CHAIR-1', variantCode: 'BASE', name: 'Chair', widthMm: 600, depthMm: 600,
    heightMm: 1000, priceAmount: 200, currency: 'USD', availability: 'in_stock', leadDays: 14,
    purchaseUnit: 'single', useZones: [{ purpose: 'pullback', x: -300, y: 300, w: 600, h: 500 }] },
]).candidates;
const [deskCandidate, chairCandidate] = candidates;
const project = () => ({
  w: 10000, h: 8000, site: { confirmed: true }, rules: { main: 1200, minor: 900 },
  objects: [
    { id: 'entrance', type: 'door', x: 0, y: 4000 },
    { id: 'exit', type: 'exit', x: 10000, y: 4000 },
  ],
  furniture: [
    { id: 'desk-1', kind: 'desk', x: 3000, y: 3000, w: 1400, h: 700, z: 750, rot: 0 },
    { id: 'chair-1', kind: 'chair', x: 3000, y: 3800, w: 600, h: 600, z: 1000, rot: 0, linkedTo: 'desk-1' },
  ],
});
const profiles = () => ({
  'desk-1': { verified: true, reviewedBy: 'fixture-reviewer', reviewedAt: '2026-10-15T01:00:00.000Z', candidateId: deskCandidate.candidateId, sourceRef: source.ref, observedAt: source.observedAt, dimensionsMm: { ...deskCandidate.dimensionsMm }, clearanceRects: requiredProductUseRects(deskCandidate) },
  'chair-1': { verified: true, reviewedBy: 'fixture-reviewer', reviewedAt: '2026-10-15T01:00:00.000Z', candidateId: chairCandidate.candidateId, sourceRef: source.ref, observedAt: source.observedAt, dimensionsMm: { ...chairCandidate.dimensionsMm }, clearanceRects: requiredProductUseRects(chairCandidate) },
});
const reviewDesk = async (plan = project(), usage = profiles()) => {
  const displayItems = plan.furniture.map(item => ({ ...item }));
  const slot = buildProductSlots(displayItems).find(item => item.sourceInstanceId === 'desk-1');
  const review = await reviewProductPlacement({ project: plan, displayItems, slot, candidate: deskCandidate, profilesByInstanceId: usage });
  return { review, slot, displayItems };
};

test('verified product geometry passes and the binding enters only a procurement draft', async () => {
  const plan = project(), { review, slot, displayItems } = await reviewDesk(plan);
  assert.equal(review.status, 'passed');
  assert.equal(review.productClearanceVerified, true);
  const allSlots = buildProductSlots(displayItems);
  const result = buildProcurementBom({
    slots: allSlots,
    bindings: [{ slotId: slot.slotId, candidateId: deskCandidate.candidateId, placementReview: review }],
    candidates,
    layoutRevision: await computeLayoutRevision(plan, displayItems, profiles()),
  });
  assert.equal(result.readyCount, 1);
  assert.equal(result.pendingCount, 1);
  assert.equal(result.merchandiseSubtotal, null);
  assert.equal(result.quoteStatus, 'not_quoted');
  assert.equal(result.items.find(item => item.slotId === slot.slotId).supplierSku, 'DESK-1');
  assert.equal(result.items.find(item => item.sourceInstanceId === 'chair-1').supplierSku, null);
  const revisedProfiles = profiles();
  revisedProfiles['desk-1'].clearanceRects[0].w += 50;
  const stale = buildProcurementBom({
    slots: allSlots,
    bindings: [{ slotId: slot.slotId, candidateId: deskCandidate.candidateId, placementReview: review }],
    candidates,
    layoutRevision: await computeLayoutRevision(plan, displayItems, revisedProfiles),
  });
  assert.equal(stale.readyCount, 0);
  assert.ok(stale.items.find(item => item.slotId === slot.slotId).reasons.includes('placement_unverified_or_stale'));
});

test('a verified single-unit SKU binds to one instance without carrying over demo price', async () => {
  const original = project();
  original.furniture[0].sku = 'DEMO-DESK';
  original.furniture[0].price = 999;
  const result = await bindProductToProject({
    project: original, sourceInstanceId: 'desk-1', candidate: deskCandidate,
    profilesByInstanceId: profiles(), displayFurniture: plan => plan.furniture.map(item => ({ ...item })),
  });
  assert.equal(result.status, 'bound');
  assert.equal(result.project.furniture[0].sku, null);
  assert.equal(result.project.furniture[0].price, null);
  assert.equal(result.project.furniture[0].productCandidateId, deskCandidate.candidateId);
  assert.equal(original.furniture[0].sku, 'DEMO-DESK');
  assert.equal(original.productBindings, undefined);
  const bom = buildProcurementBom({
    slots: buildProductSlots(result.displayItems), bindings: result.project.productBindings,
    candidates, layoutRevision: await computeLayoutRevision(result.project, result.displayItems, profiles()),
  });
  assert.equal(bom.readyCount, 1);
  assert.equal(bom.pendingCount, 1);
  assert.equal(bom.merchandiseSubtotal, null);
});

test('binding rejects an oversized product and leaves the current project intact', async () => {
  const large = importCatalog(source, [{ role: 'workstation', supplierSku: 'DESK-HUGE', variantCode: 'BASE', name: 'Large desk',
    widthMm: 9000, depthMm: 700, heightMm: 750, priceAmount: 450, currency: 'USD', availability: 'in_stock',
    leadDays: 14, purchaseUnit: 'single', useZones: [{ purpose: 'seat', x: -300, y: 350, w: 600, h: 800 }] }]).candidates[0];
  const usage = profiles();
  usage['desk-1'] = { ...usage['desk-1'], candidateId: large.candidateId, dimensionsMm: { ...large.dimensionsMm } };
  const original = project();
  const result = await bindProductToProject({ project: original, sourceInstanceId: 'desk-1', candidate: large, profilesByInstanceId: usage, displayFurniture: plan => plan.furniture.map(item => ({ ...item })) });
  assert.equal(result.status, 'rejected');
  assert.ok(result.reasons.includes('outside_site'));
  assert.equal(result.project, original);
  assert.equal(original.furniture[0].w, 1400);
  assert.equal(original.productBindings, undefined);
});

test('research candidates and derived furniture cannot be silently bound', async () => {
  const research = { ...deskCandidate, verification: { ...deskCandidate.verification, spec: false } };
  const input = { project: project(), candidate: research, profilesByInstanceId: profiles(), displayFurniture: plan => plan.furniture };
  assert.equal((await bindProductToProject({ ...input, sourceInstanceId: 'desk-1' })).status, 'rejected');
  assert.equal((await bindProductToProject({ ...input, candidate: deskCandidate, sourceInstanceId: 'desk-1-chair-0' })).status, 'unsupported_instance');
});

test('moving a column or the desk rejects or invalidates the previous placement review', async () => {
  const plan = project(), { review, slot, displayItems } = await reviewDesk(plan);
  plan.objects.push({ id: 'column', type: 'column', x: 2700, y: 2700, x2: 3300, y2: 3300 });
  const blocked = await reviewDesk(plan);
  assert.equal(blocked.review.status, 'blocked');
  assert.ok(blocked.review.reasons.includes('fixed_object_collision'));
  const stale = buildProcurementBom({
    slots: buildProductSlots(blocked.displayItems),
    bindings: [{ slotId: slot.slotId, candidateId: deskCandidate.candidateId, placementReview: review }],
    candidates,
    layoutRevision: await computeLayoutRevision(plan, blocked.displayItems, profiles()),
  });
  assert.ok(stale.items[0].reasons.includes('placement_unverified_or_stale'));
  assert.equal(stale.readyCount, 0);
  assert.equal(stale.merchandiseSubtotal, null);
  assert.notEqual(review.layoutRevision, blocked.review.layoutRevision);
  assert.equal(displayItems[0].w, 1400);
});

test('missing product clearance or unapplied physical dimensions cannot receive a passed review', async () => {
  const missing = profiles();
  delete missing['chair-1'];
  assert.deepEqual((await reviewDesk(project(), missing)).review.reasons, ['clearance_profile_missing_or_stale']);
  const wrong = project();
  wrong.furniture[0].w = 1600;
  assert.deepEqual((await reviewDesk(wrong)).review.reasons, ['candidate_dimensions_not_applied']);
  const unsigned = profiles();
  delete unsigned['desk-1'].reviewedBy;
  assert.deepEqual((await reviewDesk(project(), unsigned)).review.reasons, ['clearance_profile_missing_or_stale']);
  const malformed = project();
  malformed.objects.push({ id: 'unknown-column', type: 'column', x: 5000, y: 5000 });
  assert.deepEqual((await reviewDesk(malformed)).review.reasons, ['site_geometry_invalid']);
});

test('room door approach and required corridor width are checked on the whole scene', async () => {
  const roomPlan = project();
  roomPlan.objects.push({ id: 'meeting-room', type: 'room', kind: 'meeting', x: 2000, y: 2000, x2: 5000, y2: 5000, door: { side: 'south', width: 900 } });
  roomPlan.furniture[0].roomId = 'meeting-room';
  roomPlan.furniture[1].roomId = 'meeting-room';
  const roomReview = await reviewDesk(roomPlan);
  assert.equal(roomReview.review.status, 'blocked');
  assert.ok(roomReview.review.reasons.includes('room_door_approach_blocked'));
  const narrow = project();
  narrow.objects.push({ id: 'aisle', type: 'corridor', kind: 'main', x: 0, y: 6000, x2: 10000, y2: 6900 });
  const narrowReview = await reviewDesk(narrow);
  assert.equal(narrowReview.review.status, 'blocked');
  assert.ok(narrowReview.review.reasons.includes('corridor_too_narrow'));
});
