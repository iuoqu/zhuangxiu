import test from 'node:test';
import assert from 'node:assert/strict';
import { importCatalog } from './catalog-import.js';
import { buildProductSlots } from './product-slots.js';
import { matchProducts } from './match-products.js';
import { requiredProductUseRects } from './product-use-spec.js';
import { bindProductToProject } from './product-binding.js';
import { bindReviewedHomeScene } from './home-product-binding.js';
import { analyzeHomeAssemblies } from './home-assemblies.js';
import { buildProcurementBom } from './procurement-bom.js';
import { computeLayoutRevision } from './layout-revision.js';

const source = {
  id: 'fixture-home', ref: 'fixture:reviewed-home-catalog.csv', observedAt: '2026-10-15T00:00:00.000Z',
  format: 'csv', trustSpecs: true, trustPrice: true, trustAvailability: true, trustUseSpec: true,
  useReviewedBy: 'fixture-reviewer', useReviewedAt: '2026-10-15T01:00:00.000Z',
};
const csv = [
  'category,sku,name,widthMm,depthMm,heightMm,priceAmount,currency,availability,leadDays,purchaseUnit,doorMechanism,frontClearanceMm,leftClearanceMm,rightClearanceMm,footClearanceMm',
  'wardrobe,W-1600,Wardrobe,1600,600,2200,900,USD,in_stock,14,single,hinged,800,,,',
  'wardrobe,W-2000,Wide wardrobe,2000,650,2200,1100,USD,in_stock,14,single,hinged,800,,,',
  'bed,B-1800,Bed,1800,2100,1000,1200,USD,in_stock,14,single,,,600,600,600',
].join('\n');
const [wardrobe, wideWardrobe, bed] = importCatalog(source, csv).candidates;
const candidates = [wardrobe, wideWardrobe, bed];
const displayFurniture = plan => plan.furniture.map(item => ({ ...item }));
const project = () => ({
  w: 10000, h: 8000, site: { confirmed: true }, rules: { main: 1200, minor: 900 },
  objects: [{ id: 'entrance', type: 'door', x: 0, y: 4000 }, { id: 'exit', type: 'exit', x: 10000, y: 4000 }],
  furniture: [
    { id: 'wardrobe-1', kind: 'wardrobe', x: 3000, y: 1800, w: 1600, h: 600, z: 2200, rot: 0, sku: 'DEMO-WARDROBE', price: 999 },
    { id: 'bed-1', kind: 'bed', x: 7000, y: 5800, w: 1800, h: 2100, z: 1000, rot: 0, sku: 'DEMO-BED', price: 999 },
  ],
});
const reviewedAt = '2026-10-15T01:00:00.000Z';
function profile(candidate) {
  return {
    verified: true, reviewedBy: 'fixture-reviewer', reviewedAt,
    candidateId: candidate.candidateId, sourceRef: candidate.sourceRef, observedAt: candidate.observedAt,
    dimensionsMm: { ...candidate.dimensionsMm }, clearanceRects: requiredProductUseRects(candidate),
  };
}
const profiles = (wardrobeCandidate = wardrobe) => ({ 'wardrobe-1': profile(wardrobeCandidate), 'bed-1': profile(bed) });
const revision = (plan, usage) => computeLayoutRevision(plan, displayFurniture(plan), usage);
const bom = async (plan, usage) => buildProcurementBom({
  slots: buildProductSlots(displayFurniture(plan)), bindings: plan.productBindings || [], candidates,
  layoutRevision: await revision(plan, usage),
});

test('reviewed wardrobe and bed clearances bind and reconcile to two single-unit lines', async () => {
  const initial = project(), usage = profiles();
  const first = await bindProductToProject({ project: initial, sourceInstanceId: 'wardrobe-1', candidate: wardrobe, profilesByInstanceId: usage, displayFurniture });
  assert.equal(first.status, 'bound');
  assert.equal(first.project.furniture[0].sku, null);
  assert.equal((await bom(first.project, usage)).readyCount, 1);
  assert.equal((await bom(first.project, usage)).pendingCount, 1);
  const second = await bindProductToProject({ project: first.project, sourceInstanceId: 'bed-1', candidate: bed, profilesByInstanceId: usage, displayFurniture });
  assert.equal(second.status, 'bound');
  const procurement = await bom(second.project, usage);
  assert.equal(procurement.readyCount, 2);
  assert.deepEqual(procurement.merchandiseSubtotal, { amount: '2100', currency: 'USD' });
  assert.equal(procurement.quoteStatus, 'not_quoted');
  assert.equal(initial.productBindings, undefined);
});

test('missing use evidence, a wrong category, a set and blocked opening stay out of procurement', async () => {
  const slot = buildProductSlots(project().furniture)[0];
  const unreviewed = importCatalog({ ...source, id: 'research', trustUseSpec: false }, csv).candidates[0];
  assert.ok(matchProducts(slot, [unreviewed]).matches[0].warnings.includes('use_spec_unverified'));
  const wrong = await bindProductToProject({ project: project(), sourceInstanceId: 'wardrobe-1', candidate: bed, profilesByInstanceId: profiles(), displayFurniture });
  assert.equal(wrong.status, 'rejected');
  assert.ok(wrong.reasons.includes('category_mismatch'));
  const set = await bindProductToProject({ project: project(), sourceInstanceId: 'wardrobe-1', candidate: { ...wardrobe, purchaseUnit: 'set' }, profilesByInstanceId: profiles(), displayFurniture });
  assert.deepEqual(set.reasons, ['candidate_not_verified_single_unit']);
  const missing = await bindProductToProject({ project: project(), sourceInstanceId: 'wardrobe-1', candidate: unreviewed,
    profilesByInstanceId: { ...profiles(), 'wardrobe-1': { ...profile(wardrobe), candidateId: unreviewed.candidateId, sourceRef: unreviewed.sourceRef } }, displayFurniture });
  assert.ok(missing.reasons.includes('product_use_spec_unverified'));
  const obstructed = project();
  obstructed.objects.push({ id: 'column', type: 'column', x: 2900, y: 2200, x2: 3100, y2: 2500 });
  const blocked = await bindProductToProject({ project: obstructed, sourceInstanceId: 'wardrobe-1', candidate: wardrobe, profilesByInstanceId: profiles(), displayFurniture });
  assert.equal(blocked.status, 'rejected');
  assert.ok(blocked.reasons.includes('fixed_object_collision'));
  assert.equal(obstructed.productBindings, undefined);
});

test('replacing the wardrobe changes geometry and invalidates the earlier bed procurement review', async () => {
  const originalUsage = profiles();
  const first = await bindProductToProject({ project: project(), sourceInstanceId: 'wardrobe-1', candidate: wardrobe, profilesByInstanceId: originalUsage, displayFurniture });
  const second = await bindProductToProject({ project: first.project, sourceInstanceId: 'bed-1', candidate: bed, profilesByInstanceId: originalUsage, displayFurniture });
  assert.equal((await bom(second.project, originalUsage)).readyCount, 2);
  const widerUsage = profiles(wideWardrobe);
  const replacement = await bindProductToProject({ project: second.project, sourceInstanceId: 'wardrobe-1', candidate: wideWardrobe, profilesByInstanceId: widerUsage, displayFurniture });
  assert.equal(replacement.status, 'bound');
  assert.equal(replacement.project.furniture[0].w, 2000);
  const changed = await bom(replacement.project, widerUsage);
  assert.equal(changed.readyCount, 1);
  assert.ok(changed.items.find(item => item.sourceInstanceId === 'bed-1').reasons.includes('placement_unverified_or_stale'));
  assert.equal(changed.merchandiseSubtotal, null);
  const tampered = { ...wardrobe, useSpec: { ...wardrobe.useSpec, frontClearanceMm: 100 } };
  assert.equal(requiredProductUseRects(tampered), null, 'a changed clearance without matching source evidence is not verified');
});

test('whole-scene binding prepares reviewed profiles and a procurement draft atomically', async () => {
  const original = project();
  const selections = [
    { sourceInstanceId: 'wardrobe-1', candidateId: wardrobe.candidateId },
    { sourceInstanceId: 'bed-1', candidateId: bed.candidateId },
  ];
  const bound = await bindReviewedHomeScene({ project: original, selections, candidates, displayFurniture });
  assert.equal(bound.status, 'bound');
  assert.equal(bound.procurementDraft.readyCount, 2);
  assert.equal(bound.project.productProfiles['wardrobe-1'].clearanceRects[0].h, 800);
  assert.equal(bound.project.furniture[0].sku, null);
  assert.equal(original.productBindings, undefined);
  const wrong = await bindReviewedHomeScene({ project: original,
    selections: [{ sourceInstanceId: 'wardrobe-1', candidateId: bed.candidateId }, selections[1]], candidates, displayFurniture });
  assert.deepEqual(wrong.reasons, ['category_or_role_mismatch:wardrobe-1']);
  assert.equal(wrong.project, original);
  const blocked = project();
  blocked.objects.push({ id: 'column', type: 'column', x: 2900, y: 2200, x2: 3100, y2: 2500 });
  const rejected = await bindReviewedHomeScene({ project: blocked, selections, candidates, displayFurniture });
  assert.ok(rejected.reasons.includes('wardrobe-1:fixed_object_collision'));
  assert.equal(blocked.productBindings, undefined);
});

test('six additional home categories need sourced use zones before whole-scene binding', async () => {
  const kinds = [
    ['table', 'table'], ['homeChair', 'chair'], ['vanity', 'vanity'],
    ['sofa', 'sofa'], ['coffeeTable', 'coffee_table'], ['lowCabinet', 'low_cabinet'],
  ];
  const rows = kinds.map(([kind, category], index) => ({
    category, supplierSku: `FIXTURE-${index}`, name: `Fixture ${kind}`,
    widthMm: 1000, depthMm: 600, heightMm: 800,
    priceAmount: 100, currency: 'USD', availability: 'in_stock', leadDays: 7, purchaseUnit: 'single',
    useZones: [{ purpose: 'reviewed approach', x: -500, y: 300, w: 1000, h: 700 }],
  }));
  const reviewed = importCatalog({ ...source, id: 'fixture-zones', format: 'json' }, rows).candidates;
  assert.equal(reviewed.length, 6);
  assert.ok(reviewed.every(candidate => candidate.verification.use && requiredProductUseRects(candidate)?.length === 1));
  const scene = {
    w: 20000, h: 14000, site: { confirmed: true }, rules: { main: 1200, minor: 900 },
    objects: [{ id: 'entrance', type: 'door', x: 0, y: 7000 }, { id: 'exit', type: 'exit', x: 20000, y: 7000 }],
    furniture: kinds.map(([kind], index) => ({
      id: `item-${index}`, kind, x: 2500 + (index % 3) * 6000, y: index < 3 ? 3000 : 10500,
      w: 1000, h: 600, z: 800, rot: 0, sku: `DEMO-${index}`, price: 99,
    })),
  };
  const selections = reviewed.map((candidate, index) => ({ sourceInstanceId: `item-${index}`, candidateId: candidate.candidateId }));
  const bound = await bindReviewedHomeScene({ project: scene, selections, candidates: reviewed, displayFurniture });
  assert.equal(bound.status, 'bound', bound.reasons?.join(','));
  assert.equal(bound.procurementDraft.readyCount, 6);
  assert.deepEqual(bound.procurementDraft.merchandiseSubtotal, { amount: '600', currency: 'USD' });
  const missing = importCatalog({ ...source, id: 'fixture-no-zone', format: 'json' }, [{ ...rows[0], useZones: null }]).candidates[0];
  assert.ok(matchProducts(buildProductSlots([scene.furniture[0]])[0], [missing]).matches[0].warnings.includes('use_spec_unverified'));
  const tampered = { ...reviewed[0], useSpec: { zones: [{ purpose: 'reviewed approach', x: -500, y: 300, w: 1000, h: 100 }] } };
  assert.equal(requiredProductUseRects(tampered), null);
  const insideBody = importCatalog({ ...source, id: 'fixture-inside-zone', format: 'json' }, [{
    ...rows[0], useZones: [{ purpose: 'invalid internal area', x: -100, y: -100, w: 200, h: 200 }],
  }]).candidates[0];
  assert.equal(insideBody.verification.use, false);
  assert.equal(requiredProductUseRects(insideBody), null);
});

test('explicit table-chair relation permits seating overlap but not intrusion into either furniture body', async () => {
  const rows = [
    { category: 'table', supplierSku: 'TABLE', widthMm: 1400, depthMm: 800, heightMm: 750,
      useZones: [{ purpose: 'seating', x: -400, y: 400, w: 800, h: 1000 }] },
    { category: 'chair', supplierSku: 'CHAIR', widthMm: 500, depthMm: 550, heightMm: 850,
      useZones: [{ purpose: 'chair pullback', x: -250, y: 275, w: 500, h: 600 }] },
  ].map(row => ({ ...row, priceAmount: 100, currency: 'USD', availability: 'in_stock', leadDays: 7, purchaseUnit: 'single' }));
  const pair = importCatalog({ ...source, id: 'fixture-pair', format: 'json' }, rows).candidates;
  const scene = {
    w: 10000, h: 8000, site: { confirmed: true }, rules: { main: 1200, minor: 900 },
    objects: [{ id: 'entrance', type: 'door', x: 0, y: 4000 }, { id: 'exit', type: 'exit', x: 10000, y: 4000 }],
    furniture: [
      { id: 'table-1', kind: 'table', x: 3000, y: 3000, w: 1400, h: 800, z: 750, rot: 0 },
      { id: 'chair-1', kind: 'homeChair', x: 3000, y: 4000, w: 500, h: 550, z: 850, rot: 0, linkedTo: 'table-1' },
    ],
  };
  const selections = pair.map((candidate, index) => ({ sourceInstanceId: scene.furniture[index].id, candidateId: candidate.candidateId }));
  assert.deepEqual(analyzeHomeAssemblies(scene.furniture).relations.map(relation => relation.kind), ['table_chair']);
  const bound = await bindReviewedHomeScene({ project: scene, selections, candidates: pair, displayFurniture });
  assert.equal(bound.status, 'bound', bound.reasons?.join(','));
  assert.equal(bound.procurementDraft.readyCount, 2, 'relationship does not invent a single bundle SKU');
  const unlinked = { ...scene, furniture: scene.furniture.map(item => ({ ...item, linkedTo: null })) };
  const collision = await bindReviewedHomeScene({ project: unlinked, selections, candidates: pair, displayFurniture });
  assert.ok(collision.reasons.includes('table-1:use_clearance_collision'));
  const invalid = { ...scene, furniture: scene.furniture.map(item => item.id === 'chair-1' ? { ...item, linkedTo: 'missing' } : item) };
  assert.deepEqual((await bindReviewedHomeScene({ project: invalid, selections, candidates: pair, displayFurniture })).reasons, ['missing_link_anchor:chair-1']);
  assert.deepEqual(analyzeHomeAssemblies([
    { id: 'sofa-1', kind: 'sofa' }, { id: 'chair-1', kind: 'homeChair', linkedTo: 'sofa-1' },
  ]).errors, ['invalid_furniture_relation:chair-1']);
  const intrusiveChair = importCatalog({ ...source, id: 'fixture-intrusion', format: 'json' }, [
    rows[0], { ...rows[1], useZones: [{ purpose: 'invalid approach across table', x: -250, y: -800, w: 500, h: 525 }] },
  ]).candidates;
  const intrusiveSelections = intrusiveChair.map((candidate, index) => ({ sourceInstanceId: scene.furniture[index].id, candidateId: candidate.candidateId }));
  const intrusion = await bindReviewedHomeScene({ project: scene, selections: intrusiveSelections, candidates: intrusiveChair, displayFurniture });
  assert.ok(intrusion.reasons.includes('table-1:use_clearance_collision'));
});
