import test from 'node:test';
import assert from 'node:assert/strict';
import { importCatalog } from './catalog-import.js';
import { buildProductSlots } from './product-slots.js';
import { buildProcurementBom } from './procurement-bom.js';
import { computeLayoutRevision } from './layout-revision.js';
import { hasVerifiedProductUseSpec } from './product-use-spec.js';
import { bindReviewedPlanningScene, isPlanningProductScene } from './planning-product-binding.js';
import { reviewPlanningProductAlternatives, reviewPlanningProductPairs, reviewPlanningLayoutMoves,
  reviewPlanningContainerMoves, reviewPlanningContainerPairs } from './planning-fit-alternatives.js';

const source = { id: 'fictional-mixed', ref: 'fixture:fictional-mixed',
  observedAt: '2026-10-16T00:00:00Z', trustSpecs: true, trustUseSpec: true,
  trustPrice: true, trustAvailability: true, useReviewedBy: 'fixture-reviewer',
  useReviewedAt: '2026-10-16T01:00:00Z' };
const baseRows = [
  { role: 'dining-table', supplierSku: 'DT-1', widthMm: 1000, depthMm: 700, heightMm: 750,
    useZones: [{ purpose: 'table access', x: -200, y: -450, w: 400, h: 100 }] },
  { role: 'dining-chair', supplierSku: 'DC-1', widthMm: 600, depthMm: 600, heightMm: 850,
    useZones: [{ purpose: 'chair pullback', x: -100, y: -400, w: 200, h: 100 }] },
  { role: 'sofa', supplierSku: 'S-1', widthMm: 1600, depthMm: 800, heightMm: 850,
    useZones: [{ purpose: 'sofa access', x: -200, y: 400, w: 400, h: 100 }] },
  { role: 'side-table', supplierSku: 'ST-1', widthMm: 500, depthMm: 500, heightMm: 550,
    useZones: [{ purpose: 'side access', x: 250, y: -100, w: 100, h: 200 }] },
].map(row => ({ ...row, priceAmount: 100, currency: 'USD', availability: 'in_stock',
  leadDays: 7, purchaseUnit: 'single' }));
const candidates = importCatalog(source, baseRows).candidates;
const project = () => ({ version: 1, name: 'Fictional mixed scene', w: 16000, h: 9000,
  site: { confirmed: true }, rules: { main: 1200, minor: 900 },
  objects: [
    { id: 'entry', type: 'door', x: 0, y: 4500 },
    { id: 'exit', type: 'exit', x: 16000, y: 4500 },
    { id: 'dining-zone', type: 'zone', kind: 'dining', x: 2000, y: 2000, x2: 5000, y2: 4800 },
    { id: 'waiting', type: 'room', kind: 'waiting', x: 8000, y: 2000, x2: 11200, y2: 5000,
      door: { side: 'south', width: 900 } },
  ],
  furniture: [{ id: 'dining-set', kind: 'dining4', x: 3500, y: 3400,
    w: 2400, h: 2200, z: 850, rot: 0, zoneId: 'dining-zone',
    sku: 'DEMO-DINING-4', price: 1250 }],
});
const displayFurniture = plan => {
  const saved = plan.derivedProducts || {};
  const zoneDx=(plan.furniture.find(item=>item.id==='dining-set')?.x||3500)-3500;
  const roomShift=plan.objects.find(item=>item.id==='waiting')?.furnitureShift||{dx:0,dy:0};
  const member = (id, kind, x, y, w, h, z, link, container) => ({ id, kind,
    w: saved[id]?.w || w, h: saved[id]?.h || h, z: saved[id]?.z || z, rot: 0,
    ...(link ? { linkedTo: link } : {}), ...container,
    x:x+(container.zoneId?zoneDx:roomShift.dx),y:y+(container.roomId?roomShift.dy:0) });
  const zone = { zoneId: 'dining-zone' }, room = { roomId: 'waiting' };
  return [
    member('dining-set-table', 'diningTable', 3500, 3400, 1000, 700, 750, null, zone),
    member('dining-set-chair-west', 'diningChair', 2600, 3400, 600, 600, 850, 'dining-set-table', zone),
    member('dining-set-chair-east', 'diningChair', 4400, 3400, 600, 600, 850, 'dining-set-table', zone),
    member('dining-set-chair-north', 'diningChair', 3500, 2600, 600, 600, 850, 'dining-set-table', zone),
    member('dining-set-chair-south', 'diningChair', 3500, 4200, 600, 600, 850, 'dining-set-table', zone),
    member('waiting-seating-sofa', 'sofa', 9600, 2800, 1600, 800, 850, null, room),
    member('waiting-seating-table', 'sideTable', 9600, 3600, 500, 500, 550, 'waiting-seating-sofa', room),
  ];
};
const selections = () => displayFurniture(project()).map(item => ({ sourceInstanceId: item.id,
  candidateId: candidates.find(candidate => candidate.role === ({ diningTable: 'dining-table',
    diningChair: 'dining-chair', sofa: 'sofa', sideTable: 'side-table' })[item.kind]).candidateId }));

test('shared dining and waiting room bind seven physical items without pricing a layout footprint', async () => {
  const original = project();
  assert.equal(isPlanningProductScene(original, displayFurniture(original)), true);
  const result = await bindReviewedPlanningScene({ project: original, selections: selections(), candidates, displayFurniture });
  assert.equal(result.status, 'bound', result.reasons?.join(', '));
  assert.equal(result.procurementDraft.itemCount, 7);
  assert.equal(result.procurementDraft.readyCount, 7);
  assert.deepEqual(result.procurementDraft.merchandiseSubtotal, { amount: '700', currency: 'USD' });
  assert.equal(result.project.furniture[0].sku, 'DEMO-DINING-4', 'planning footprint is not assigned a product');
  assert.equal(result.project.productBindings.some(binding => binding.slotId === 'slot:dining-set'), false);
  assert.equal(result.project.derivedProducts['waiting-seating-sofa'].productCandidateId, candidates[2].candidateId);
  assert.equal(original.derivedProducts, undefined, 'rejected or bound trials never mutate the original');
  const changed = structuredClone(result.project);
  changed.furniture[0].x += 200;
  const displayed = displayFurniture(changed);
  const stale = buildProcurementBom({ slots: buildProductSlots(displayed), bindings: changed.productBindings,
    candidates, layoutRevision: await computeLayoutRevision(changed, displayed, changed.productProfiles) });
  assert.equal(stale.readyCount, 0);
  assert.equal(stale.merchandiseSubtotal, null);
});

test('missing members, broken links and incomplete evidence reject the entire scene', async () => {
  const missing = await bindReviewedPlanningScene({ project: project(), selections: selections(), candidates,
    displayFurniture: plan => displayFurniture(plan).filter(item => item.id !== 'dining-set-chair-south') });
  assert.deepEqual(missing.reasons, ['scene_instances_or_relations_invalid']);
  const broken = await bindReviewedPlanningScene({ project: project(), selections: selections(), candidates,
    displayFurniture: plan => displayFurniture(plan).map(item => item.id === 'waiting-seating-table'
      ? { ...item, linkedTo: 'absent-sofa' } : item) });
  assert.deepEqual(broken.reasons, ['scene_instances_or_relations_invalid']);
  const noUse = { ...candidates[2], verification: { ...candidates[2].verification, use: false } };
  const unreviewed = await bindReviewedPlanningScene({ project: project(), selections: selections(),
    candidates: [candidates[0], candidates[1], noUse, candidates[3]], displayFurniture });
  assert.deepEqual(unreviewed.reasons, ['product_use_spec_unverified:waiting-seating-sofa']);
});

test('a sourced item whose body leaves its shared zone cannot bind', async () => {
  const oversized = importCatalog(source, [{ ...baseRows[0], supplierSku: 'DT-WIDE', widthMm: 4000 }]).candidates[0];
  const choose = selections().map(item => item.sourceInstanceId === 'dining-set-table'
    ? { ...item, candidateId: oversized.candidateId } : item);
  const original = project();
  const result = await bindReviewedPlanningScene({ project: original, selections: choose,
    candidates: [...candidates, oversized], displayFurniture });
  assert.equal(result.status, 'rejected');
  assert.ok(result.reasons.some(reason => reason.includes('outside_zone')), result.reasons?.join(', '));
  assert.ok(result.placementIssues.some(issue => issue.reason === 'outside_zone' &&
    issue.instanceIds.includes('dining-set-table') && issue.objectId === 'dining-zone'));
  assert.equal(original.productBindings, undefined);
});

test('placement failure identifies the actual room furniture instance', async () => {
  const oversized = importCatalog(source, [{ ...baseRows[2], supplierSku: 'S-WIDE', widthMm: 4000 }]).candidates[0];
  const choose = selections().map(item => item.sourceInstanceId === 'waiting-seating-sofa'
    ? { ...item, candidateId: oversized.candidateId } : item);
  const result = await bindReviewedPlanningScene({ project: project(), selections: choose,
    candidates: [...candidates, oversized], displayFurniture });
  assert.equal(result.status, 'rejected');
  assert.ok(result.placementIssues.some(issue => issue.reason === 'outside_room' &&
    issue.instanceIds.includes('waiting-seating-sofa') && issue.objectId === 'waiting'));
  assert.equal(result.reasons.some(reason => reason.startsWith('dining-set-table:outside_room')), false);
});

test('a smaller reviewed single product is proposed only after a complete scene recheck', async () => {
  const oversized = importCatalog(source, [{ ...baseRows[2], supplierSku: 'S-WIDE', widthMm: 4000 }]).candidates[0];
  const choose = selections().map(item => item.sourceInstanceId === 'waiting-seating-sofa'
    ? { ...item, candidateId: oversized.candidateId } : item);
  const original = project(), before = structuredClone(original);
  const review = await reviewPlanningProductAlternatives({ project: original, selections: choose,
    candidates: [...candidates, oversized], displayFurniture });
  assert.equal(review.status, 'alternatives_found');
  assert.equal(review.trials, 1);
  assert.deepEqual(review.alternatives.map(item => [item.sourceInstanceId, item.toCandidateId,
    item.reviewStatus]), [['waiting-seating-sofa', candidates[2].candidateId, 'whole_scene_passed']]);
  assert.deepEqual(original, before, 'proposal never changes the project');
});

test('two independent oversize failures are not claimed fixable by one product swap', async () => {
  const [wideTable, wideSofa] = importCatalog(source, [
    { ...baseRows[0], supplierSku: 'DT-WIDE', widthMm: 4000 },
    { ...baseRows[2], supplierSku: 'S-WIDE', widthMm: 4000 },
  ]).candidates;
  const choose = selections().map(item => item.sourceInstanceId === 'dining-set-table'
    ? { ...item, candidateId: wideTable.candidateId } : item.sourceInstanceId === 'waiting-seating-sofa'
      ? { ...item, candidateId: wideSofa.candidateId } : item);
  const review = await reviewPlanningProductAlternatives({ project: project(), selections: choose,
    candidates: [...candidates, wideTable, wideSofa], displayFurniture });
  assert.equal(review.status, 'no_single_swap_found');
  assert.deepEqual(review.alternatives, []);
  assert.ok(review.trials >= 2);
  const original=project(),before=structuredClone(original);
  const pair=await reviewPlanningProductPairs({project:original,selections:choose,
    candidates:[...candidates,wideTable,wideSofa],displayFurniture});
  assert.equal(pair.status,'alternatives_found');
  assert.deepEqual(pair.alternatives[0].changes.map(change=>[change.sourceInstanceId,change.toCandidateId]),
    [['dining-set-table',candidates[0].candidateId],['waiting-seating-sofa',candidates[2].candidateId]]);
  assert.equal(pair.alternatives[0].reviewStatus,'whole_scene_passed');
  assert.deepEqual(original,before,'pair review never changes the project');
});

test('a local furniture move is proposed only when the full scene passes at its new position', async () => {
  const original = {version:1,name:'Fictional local move',w:10000,h:8000,site:{confirmed:true},
    rules:{main:1200,minor:900},objects:[{id:'entry',type:'door',x:0,y:4000},
      {id:'exit',type:'exit',x:10000,y:4000}],
    furniture:[{id:'sofa-1',kind:'sofa',x:9500,y:2000,w:1600,h:800,z:850,rot:0}]};
  const before=structuredClone(original),selection=[{sourceInstanceId:'sofa-1',candidateId:candidates[2].candidateId}];
  const review=await reviewPlanningLayoutMoves({project:original,selections:selection,candidates,
    displayFurniture:trial=>trial.furniture});
  assert.equal(review.status,'alternatives_found');
  assert.ok(review.alternatives.some(option=>option.sourceInstanceId==='sofa-1'&&option.to.x===9000&&
    option.to.y===2000&&option.reviewStatus==='whole_scene_passed'));
  assert.deepEqual(original,before,'layout suggestions do not move the original furniture');
});

test('a room furnishing group can shift without changing room size, door or item count', async () => {
  const wideSofa=importCatalog(source,[{...baseRows[2],supplierSku:'S-2800',widthMm:2800}]).candidates[0];
  const original=project();
  original.objects.find(item=>item.id==='waiting').furnitureShift={dx:250,dy:0};
  const before=structuredClone(original);
  const choose=selections().map(item=>item.sourceInstanceId==='waiting-seating-sofa'
    ? {...item,candidateId:wideSofa.candidateId}:item);
  const review=await reviewPlanningContainerMoves({project:original,selections:choose,
    candidates:[...candidates,wideSofa],displayFurniture,
    layoutValid:(trial,target)=>target.kind==='room'&&
      trial.objects.find(item=>item.id===target.containerId)?.furnitureShift.dx>=0});
  assert.equal(review.status,'alternatives_found');
  assert.ok(review.alternatives.some(option=>option.kind==='room'&&option.containerId==='waiting'&&
    option.from.dx===250&&option.to.dx===0&&option.reviewStatus==='whole_scene_passed'));
  assert.deepEqual(original,before);
  assert.equal(displayFurniture(original).length,7);
});

test('a shared-zone footprint can shift while retaining its dining members', async () => {
  const edgeTable=importCatalog(source,[{...baseRows[0],supplierSku:'DT-EDGE',
    useZones:[{purpose:'right-side access',x:500,y:-100,w:800,h:200}]}]).candidates[0];
  const original=project();original.furniture[0].x=3750;
  const before=structuredClone(original);
  const choose=selections().map(item=>item.sourceInstanceId==='dining-set-table'
    ? {...item,candidateId:edgeTable.candidateId}:item);
  const review=await reviewPlanningContainerMoves({project:original,selections:choose,
    candidates:[...candidates,edgeTable],displayFurniture,
    layoutValid:(trial,target)=>target.kind==='zone'&&target.containerId==='dining-zone'&&
      trial.furniture[0].x>=3200&&trial.furniture[0].x<=3800});
  assert.equal(review.status,'alternatives_found');
  assert.ok(review.alternatives.some(option=>option.kind==='zone'&&option.containerId==='dining-zone'&&
    option.from.x===3750&&option.to.x===3500&&option.reviewStatus==='whole_scene_passed'));
  assert.deepEqual(original,before);
  assert.equal(displayFurniture(original).filter(item=>item.zoneId==='dining-zone').length,5);
});

test('two independent container failures require a jointly checked move', async () => {
  const [edgeTable,wideSofa]=importCatalog(source,[
    {...baseRows[0],supplierSku:'DT-EDGE',useZones:[{purpose:'right-side access',x:500,y:-100,w:800,h:200}]},
    {...baseRows[2],supplierSku:'S-2800',widthMm:2800},
  ]).candidates;
  const original=project();original.furniture[0].x=3750;
  original.objects.find(item=>item.id==='waiting').furnitureShift={dx:250,dy:0};
  const before=structuredClone(original),choose=selections().map(item=>item.sourceInstanceId==='dining-set-table'
    ?{...item,candidateId:edgeTable.candidateId}:item.sourceInstanceId==='waiting-seating-sofa'
      ?{...item,candidateId:wideSofa.candidateId}:item);
  const args={project:original,selections:choose,candidates:[...candidates,edgeTable,wideSofa],
    displayFurniture,layoutValid:(trial,target)=>target.kind==='room'
      ?trial.objects.find(item=>item.id===target.containerId)?.furnitureShift.dx>=0
      :trial.furniture.find(item=>item.zoneId===target.containerId)?.x>=3200};
  const single=await reviewPlanningContainerMoves(args);
  assert.equal(single.status,'no_container_move_found');
  const pair=await reviewPlanningContainerPairs(args);
  assert.equal(pair.status,'alternatives_found');
  assert.ok(pair.trials<=16);
  assert.equal(pair.alternatives[0].reviewStatus,'whole_scene_passed');
  assert.deepEqual(pair.alternatives[0].changes.map(change=>[change.kind,change.containerId,
    change.kind==='room'?change.to.dx:change.to.x]),
    [['zone','dining-zone',3500],['room','waiting',0]]);
  assert.deepEqual(original,before,'pair search does not change the scene');
  const capped=await reviewPlanningContainerPairs({...args,maxTrials:1});
  assert.equal(capped.trials,1);
  assert.equal(capped.trialLimitReached,true);
});

test('equipment and display fixtures need reviewed use space before product binding', () => {
  const imported = importCatalog(source, [
    { role: 'equipment', supplierSku: 'EQ-1', widthMm: 600, depthMm: 700, heightMm: 1600 },
    { role: 'display', supplierSku: 'DP-1', widthMm: 700, depthMm: 500, heightMm: 1100 },
  ]).candidates;
  assert.deepEqual(imported.map(item => item.verification.use), [false, false]);
  assert.deepEqual(imported.map(hasVerifiedProductUseSpec), [false, false]);
});
