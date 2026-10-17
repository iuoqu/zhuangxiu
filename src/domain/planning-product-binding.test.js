import test from 'node:test';
import assert from 'node:assert/strict';
import { importCatalog } from './catalog-import.js';
import { buildProductSlots } from './product-slots.js';
import { buildProcurementBom } from './procurement-bom.js';
import { computeLayoutRevision } from './layout-revision.js';
import { hasVerifiedProductUseSpec } from './product-use-spec.js';
import { bindReviewedPlanningScene, isPlanningProductScene } from './planning-product-binding.js';
import { reviewPlanningProductAlternatives, reviewPlanningProductPairs, reviewPlanningLayoutMoves,
  reviewPlanningContainerMoves, reviewPlanningContainerPairs,
  reviewPlanningRoomLayouts, reviewPlanningRoomItemMoves,
  reviewPlanningRoomItemPairs, reviewPlanningRoomItemRotations,
  reviewPlanningRoomItemSwaps } from './planning-fit-alternatives.js';

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

test('a bounded room orientation can solve a fit that whole-room translation cannot', async () => {
  const wideSofa=importCatalog(source,[{...baseRows[2],supplierSku:'S-3300',widthMm:3300}]).candidates[0],
    sideTable=candidates.find(candidate=>candidate.role==='side-table'),original=project();
  original.objects=original.objects.filter(item=>item.id!=='dining-zone');
  const room=original.objects.find(item=>item.id==='waiting');
  Object.assign(room,{y:1000,y2:5000,furnitureShift:{dx:200,dy:0}});original.furniture=[];
  const transform=(x,y,mode,cx=9600,cy=3000)=>mode==='rotate_cw'?{x:cx-(y-cy),y:cy+(x-cx)}:
    mode==='rotate_180'?{x:cx-(x-cx),y:cy-(y-cy)}:mode==='rotate_ccw'?{x:cx+(y-cy),y:cy-(x-cx)}:
    mode==='mirror_x'?{x:cx-(x-cx),y}:mode==='mirror_y'?{x,y:cy-(y-cy)}:{x,y};
  const turn=(rot,mode)=>((rot+(mode==='rotate_cw'?90:mode==='rotate_180'?180:mode==='rotate_ccw'?270:0))%360+360)%360;
  const displayRoomLayouts=plan=>{
    const current=plan.objects.find(item=>item.id==='waiting'),mode=current.furnitureLayout||'base',
      shift=current.furnitureShift||{dx:0,dy:0},saved=plan.derivedProducts||{};
    return [{id:'waiting-seating-sofa',kind:'sofa',x:9600,y:2300,w:1600,h:800,z:850,rot:0,roomId:'waiting'},
      {id:'waiting-seating-table',kind:'sideTable',x:9600,y:3100,w:500,h:500,z:550,rot:0,
        roomId:'waiting',linkedTo:'waiting-seating-sofa'}].map(item=>{const point=transform(item.x,item.y,mode);return {...item,
          x:point.x+shift.dx,y:point.y+shift.dy,rot:turn(item.rot,mode),
          ...(saved[item.id]?{w:saved[item.id].w,h:saved[item.id].h,z:saved[item.id].z}: {})}});
  };
  const choose=[{sourceInstanceId:'waiting-seating-sofa',candidateId:wideSofa.candidateId},
    {sourceInstanceId:'waiting-seating-table',candidateId:sideTable.candidateId}],args={project:original,
      selections:choose,candidates:[wideSofa,sideTable],displayFurniture:displayRoomLayouts,layoutValid:()=>true};
  const before=structuredClone(original),move=await reviewPlanningContainerMoves(args);
  assert.equal(move.alternatives.length,0,'3300 mm body cannot fit the 3200 mm room width by translation');
  const review=await reviewPlanningRoomLayouts(args);
  assert.equal(review.status,'alternatives_found');
  assert.deepEqual(review.alternatives[0],{containerId:'waiting',from:'base',to:'rotate_cw',
    reviewStatus:'whole_scene_passed'});
  assert.ok(review.trials<=12);
  assert.deepEqual(original,before,'orientation trials never change the source scene');
  assert.deepEqual(displayRoomLayouts({...original,objects:original.objects.map(item=>item.id==='waiting'
    ?{...item,furnitureLayout:'rotate_cw'}:item)}).map(item=>item.id),
    ['waiting-seating-sofa','waiting-seating-table']);
});

test('one affected room item can move on a bounded grid after room-wide changes fail', async () => {
  const [printer,cabinet]=importCatalog(source,[
    {role:'printer',supplierSku:'PR-1600',widthMm:1600,depthMm:600,heightMm:1200,
      useZones:[{purpose:'service access',x:-200,y:300,w:400,h:100}]},
    {role:'storage-cabinet',supplierSku:'CB-1200',widthMm:1200,depthMm:450,heightMm:1100,
      useZones:[{purpose:'door access',x:-200,y:225,w:400,h:100}]},
  ].map(row=>({...row,priceAmount:100,currency:'USD',availability:'in_stock',leadDays:7,
    purchaseUnit:'single'}))).candidates;
  const original={version:1,name:'Fictional print room item move',w:16000,h:9000,
    site:{confirmed:true},rules:{main:1200,minor:900},objects:[
      {id:'entry',type:'door',x:0,y:4500},{id:'exit',type:'exit',x:16000,y:4500},
      {id:'print-room',type:'room',kind:'print',x:8000,y:2000,x2:11000,y2:4500,
        door:{side:'south',width:900}},
    ],furniture:[]};
  const displayPrint=plan=>{
    const room=plan.objects.find(item=>item.id==='print-room'),shift=room.furnitureShift||{dx:0,dy:0},
      itemOffsets=room.furnitureItemOffsets||{},saved=plan.derivedProducts||{};
    return [{id:'print-room-printer',kind:'printer',x:8850,y:2350,w:700,h:650,z:1100},
      {id:'print-room-supplies',kind:'cabinet',x:10150,y:2350,w:1200,h:450,z:1100}]
      .map(item=>{const offset=itemOffsets[item.id]||{dx:0,dy:0},product=saved[item.id];return {...item,
        roomId:'print-room',x:item.x+shift.dx+offset.dx,y:item.y+shift.dy+offset.dy,
        ...(product?{w:product.w,h:product.h,z:product.z}: {})}});
  };
  const choose=[{sourceInstanceId:'print-room-printer',candidateId:printer.candidateId},
    {sourceInstanceId:'print-room-supplies',candidateId:cabinet.candidateId}],args={project:original,
      selections:choose,candidates:[printer,cabinet],displayFurniture:displayPrint,layoutValid:()=>true};
  const before=structuredClone(original),baseline=await bindReviewedPlanningScene(args);
  assert.equal(baseline.status,'rejected');
  assert.ok(baseline.placementIssues.some(issue=>issue.reason==='furniture_collision'));
  assert.equal((await reviewPlanningContainerMoves({...args,initialReview:baseline})).alternatives.length,0);
  assert.equal((await reviewPlanningRoomLayouts({...args,initialReview:baseline})).alternatives.length,0);
  const review=await reviewPlanningRoomItemMoves({...args,initialReview:baseline});
  assert.equal(review.status,'alternatives_found');
  assert.ok(review.trials<=16);
  const suggestion=review.alternatives.find(option=>option.sourceInstanceId==='print-room-supplies'&&
    option.to.dx===250&&option.to.dy===0);
  assert.deepEqual(suggestion,{containerId:'print-room',sourceInstanceId:'print-room-supplies',
    from:{dx:0,dy:0},to:{dx:250,dy:0},reviewStatus:'whole_scene_passed'});
  assert.deepEqual(original,before,'room item trials never change the source scene');
  const applied={...original,objects:original.objects.map(item=>item.id==='print-room'
    ?{...item,furnitureItemOffsets:{'print-room-supplies':{dx:250,dy:0}}}:item)};
  assert.deepEqual(displayPrint(applied).map(item=>item.id),['print-room-printer','print-room-supplies']);
  assert.equal((await bindReviewedPlanningScene({...args,project:applied})).status,'bound');
});

test('two affected items in one room can move apart when neither single move is sufficient', async () => {
  const [printer,cabinet]=importCatalog(source,[
    {role:'printer',supplierSku:'PR-1600-PAIR',widthMm:1600,depthMm:600,heightMm:1200,
      useZones:[{purpose:'service access',x:-200,y:300,w:400,h:100}]},
    {role:'storage-cabinet',supplierSku:'CB-1800-PAIR',widthMm:1800,depthMm:450,heightMm:1100,
      useZones:[{purpose:'door access',x:-200,y:225,w:400,h:100}]},
  ].map(row=>({...row,priceAmount:100,currency:'USD',availability:'in_stock',leadDays:7,
    purchaseUnit:'single'}))).candidates;
  const original={version:1,name:'Fictional print room pair move',w:16000,h:9000,
    site:{confirmed:true},rules:{main:1200,minor:900},objects:[
      {id:'entry',type:'door',x:0,y:4500},{id:'exit',type:'exit',x:16000,y:4500},
      {id:'print-room',type:'room',kind:'print',x:7700,y:2000,x2:11300,y2:4500,
        door:{side:'south',width:900}},
    ],furniture:[]};
  const displayPrint=plan=>{
    const room=plan.objects.find(item=>item.id==='print-room'),shift=room.furnitureShift||{dx:0,dy:0},
      itemOffsets=room.furnitureItemOffsets||{},saved=plan.derivedProducts||{};
    return [{id:'print-room-printer',kind:'printer',x:8850,y:2350,w:700,h:650,z:1100},
      {id:'print-room-supplies',kind:'cabinet',x:10150,y:2350,w:1200,h:450,z:1100}]
      .map(item=>{const offset=itemOffsets[item.id]||{dx:0,dy:0},product=saved[item.id];return {...item,
        roomId:'print-room',x:item.x+shift.dx+offset.dx,y:item.y+shift.dy+offset.dy,
        ...(product?{w:product.w,h:product.h,z:product.z}: {})}});
  };
  const choose=[{sourceInstanceId:'print-room-printer',candidateId:printer.candidateId},
    {sourceInstanceId:'print-room-supplies',candidateId:cabinet.candidateId}],args={project:original,
      selections:choose,candidates:[printer,cabinet],displayFurniture:displayPrint,layoutValid:()=>true};
  const before=structuredClone(original),baseline=await bindReviewedPlanningScene(args);
  assert.equal(baseline.status,'rejected');
  assert.equal((await reviewPlanningRoomItemMoves({...args,initialReview:baseline})).alternatives.length,0,
    'a 250 mm move still collides and a 500 mm move leaves the room');
  const review=await reviewPlanningRoomItemPairs({...args,initialReview:baseline});
  assert.equal(review.status,'alternatives_found');
  assert.ok(review.trials<=24);
  assert.deepEqual(review.alternatives[0],{containerId:'print-room',changes:[
    {sourceInstanceId:'print-room-printer',from:{dx:0,dy:0},to:{dx:-250,dy:0}},
    {sourceInstanceId:'print-room-supplies',from:{dx:0,dy:0},to:{dx:250,dy:0}},
  ],reviewStatus:'whole_scene_passed'});
  assert.deepEqual(original,before,'room item pair trials never change the source scene');
  const applied={...original,objects:original.objects.map(item=>item.id==='print-room'?{...item,
    furnitureItemOffsets:{'print-room-printer':{dx:-250,dy:0},'print-room-supplies':{dx:250,dy:0}}}:item)};
  assert.deepEqual(displayPrint(applied).map(item=>item.id),['print-room-printer','print-room-supplies']);
  assert.equal((await bindReviewedPlanningScene({...args,project:applied})).status,'bound');
});

test('one room item can rotate in place after bounded translations fail', async () => {
  const [printer,cabinet]=importCatalog(source,[
    {role:'printer',supplierSku:'PR-3000-TURN',widthMm:3000,depthMm:600,heightMm:1200,
      useZones:[{purpose:'service access',x:-200,y:300,w:400,h:100}]},
    {role:'storage-cabinet',supplierSku:'CB-DEEP-TURN',widthMm:1200,depthMm:2000,heightMm:1100,
      useZones:[{purpose:'door access',x:-200,y:1000,w:400,h:100}]},
  ].map(row=>({...row,priceAmount:100,currency:'USD',availability:'in_stock',leadDays:7,
    purchaseUnit:'single'}))).candidates;
  const original={version:1,name:'Fictional print room item rotation',w:16000,h:9000,
    site:{confirmed:true},rules:{main:1200,minor:900},objects:[
      {id:'entry',type:'door',x:0,y:6500},{id:'exit',type:'exit',x:16000,y:6500},
      {id:'print-room',type:'room',kind:'print',x:8100,y:1000,x2:10900,y2:5800,
        door:{side:'south',width:900}},
    ],furniture:[]};
  const displayPrint=plan=>{const room=plan.objects.find(item=>item.id==='print-room'),
    offsets=room.furnitureItemOffsets||{},rotations=room.furnitureItemRotations||{},saved=plan.derivedProducts||{};
    return [{id:'print-room-printer',kind:'printer',x:8850,y:2500,w:700,h:650,z:1100},
      {id:'print-room-supplies',kind:'cabinet',x:10150,y:2500,w:1200,h:450,z:1100}]
      .map(item=>{const offset=offsets[item.id]||{dx:0,dy:0},product=saved[item.id];return {...item,
        roomId:'print-room',x:item.x+offset.dx,y:item.y+offset.dy,rot:rotations[item.id]||0,
        ...(product?{w:product.w,h:product.h,z:product.z}: {})}})};
  const choose=[{sourceInstanceId:'print-room-printer',candidateId:printer.candidateId},
    {sourceInstanceId:'print-room-supplies',candidateId:cabinet.candidateId}],args={project:original,
      selections:choose,candidates:[printer,cabinet],displayFurniture:displayPrint,layoutValid:()=>true};
  const before=structuredClone(original),baseline=await bindReviewedPlanningScene(args);
  assert.equal(baseline.status,'rejected');
  assert.equal((await reviewPlanningRoomItemMoves({...args,initialReview:baseline})).alternatives.length,0);
  assert.equal((await reviewPlanningRoomItemPairs({...args,initialReview:baseline})).alternatives.length,0);
  const review=await reviewPlanningRoomItemRotations({...args,initialReview:baseline});
  assert.equal(review.status,'alternatives_found');
  assert.deepEqual(review.alternatives[0],{containerId:'print-room',sourceInstanceId:'print-room-printer',
    from:0,to:90,reviewStatus:'whole_scene_passed'});
  assert.deepEqual(original,before,'room item rotation trials never change the source scene');
  const applied={...original,objects:original.objects.map(item=>item.id==='print-room'
    ?{...item,furnitureItemRotations:{'print-room-printer':90}}:item)};
  assert.deepEqual(displayPrint(applied).map(item=>[item.id,item.rot]),
    [['print-room-printer',90],['print-room-supplies',0]]);
  assert.equal((await bindReviewedPlanningScene({...args,project:applied})).status,'bound');
});

test('two stable room instances can swap positions after moves and rotations fail', async () => {
  const [printer,cabinet]=importCatalog(source,[
    {role:'printer',supplierSku:'PR-SWAP',widthMm:700,depthMm:650,heightMm:1200,
      useZones:[{purpose:'left service access',x:-1600,y:600,w:400,h:100}]},
    {role:'storage-cabinet',supplierSku:'CB-SWAP',widthMm:1200,depthMm:450,heightMm:1100,
      useZones:[{purpose:'right door access',x:1200,y:400,w:400,h:100}]},
  ].map(row=>({...row,priceAmount:100,currency:'USD',availability:'in_stock',leadDays:7,
    purchaseUnit:'single'}))).candidates;
  const original={version:1,name:'Fictional print room position swap',w:16000,h:9000,
    site:{confirmed:true},rules:{main:1200,minor:900},objects:[
      {id:'entry',type:'door',x:0,y:6500},{id:'exit',type:'exit',x:16000,y:6500},
      {id:'print-room',type:'room',kind:'print',x:8000,y:1000,x2:11000,y2:5000,
        door:{side:'south',width:900}},
    ],furniture:[]};
  const displayPrint=plan=>{const room=plan.objects.find(item=>item.id==='print-room'),
    offsets=room.furnitureItemOffsets||{},rotations=room.furnitureItemRotations||{},saved=plan.derivedProducts||{};
    return [{id:'print-room-printer',kind:'printer',x:8850,y:2100,w:700,h:650,z:1100},
      {id:'print-room-supplies',kind:'cabinet',x:10150,y:2100,w:1200,h:450,z:1100}]
      .map(item=>{const offset=offsets[item.id]||{dx:0,dy:0},product=saved[item.id];return {...item,
        roomId:'print-room',x:item.x+offset.dx,y:item.y+offset.dy,rot:rotations[item.id]||0,
        ...(product?{w:product.w,h:product.h,z:product.z}: {})}})};
  const choose=[{sourceInstanceId:'print-room-printer',candidateId:printer.candidateId},
    {sourceInstanceId:'print-room-supplies',candidateId:cabinet.candidateId}],args={project:original,
      selections:choose,candidates:[printer,cabinet],displayFurniture:displayPrint,layoutValid:()=>true};
  const before=structuredClone(original),baseline=await bindReviewedPlanningScene(args);
  assert.equal(baseline.status,'rejected');
  assert.equal((await reviewPlanningRoomItemMoves({...args,initialReview:baseline})).alternatives.length,0);
  assert.equal((await reviewPlanningRoomItemPairs({...args,initialReview:baseline})).alternatives.length,0);
  assert.equal((await reviewPlanningRoomItemRotations({...args,initialReview:baseline})).alternatives.length,0);
  const review=await reviewPlanningRoomItemSwaps({...args,initialReview:baseline});
  assert.equal(review.status,'alternatives_found');
  assert.deepEqual(review.alternatives[0],{containerId:'print-room',changes:[
    {sourceInstanceId:'print-room-printer',from:{dx:0,dy:0},to:{dx:1300,dy:0}},
    {sourceInstanceId:'print-room-supplies',from:{dx:0,dy:0},to:{dx:-1300,dy:0}},
  ],reviewStatus:'whole_scene_passed'});
  assert.deepEqual(original,before,'room item swap trials never change the source scene');
  const applied={...original,objects:original.objects.map(item=>item.id==='print-room'?{...item,
    furnitureItemOffsets:{'print-room-printer':{dx:1300,dy:0},'print-room-supplies':{dx:-1300,dy:0}}}:item)};
  assert.deepEqual(displayPrint(applied).map(item=>[item.id,item.x]),
    [['print-room-printer',10150],['print-room-supplies',8850]]);
  assert.equal((await bindReviewedPlanningScene({...args,project:applied})).status,'bound');
});

test('equipment and display fixtures need reviewed use space before product binding', () => {
  const imported = importCatalog(source, [
    { role: 'equipment', supplierSku: 'EQ-1', widthMm: 600, depthMm: 700, heightMm: 1600 },
    { role: 'display', supplierSku: 'DP-1', widthMm: 700, depthMm: 500, heightMm: 1100 },
  ]).candidates;
  assert.deepEqual(imported.map(item => item.verification.use), [false, false]);
  assert.deepEqual(imported.map(hasVerifiedProductUseSpec), [false, false]);
});
