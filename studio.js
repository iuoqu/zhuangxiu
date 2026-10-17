/* Generic office planning MVP. Coordinates use millimetres; projects persist in browser localStorage. */
const $ = s => document.querySelector(s), cv = $('#canvas'), ctx = cv.getContext('2d');
const STORE = 'office-planner-mvp-v1';
const hasSavedProject = !!localStorage.getItem(STORE);
const catalog = SAMPLE_FURNITURE;
const visibleCatalog=catalog.filter(item=>!['meetingModular','pantryCounter','pantryTable','diningTable','diningChair','printer','shelf','serverRack','lactationChair','sideTable','videoScreen','displayPlinth','locker','barStool'].includes(item.kind));
const typeName={wall:'Wall',door:'Door',window:'Window',partition:'Partition',column:'Column',corridor:'Corridor',exit:'Emergency exit',blocked:'No-go zone',room:'Functional room',zone:'Shared-use zone',workArea:'Team work area'};
let P, tool='select', selected=null, drag=null, view='2d', history=[], readOnly=false, spaceDown=false, focusedIssue=null, focusedProductId=null, editGuideIssue=null, previewProposalId=null, roomReusePreviewId=null;
let designBomModule=null, designBomLoadError=false;
let productToolsPromise=null, productTools=null, productCandidates=[], latestDesignLines=[], sourcingRevision=0, sourcingRenderKey='', sourcingPlanKey='';
let approvedToolsPromise=null, approvedTools=null, approvedCandidates=[], approvedSetOffers=[], approvedCatalogLoaded=false, approvedCatalogMode=null, approvedCatalogRevision=0, approvedSelections={}, approvedRenderKey='', approvedFitOptions=null;
let demoCatalogVersion=null, demoPackages=[], demoPackageKey='';
const productPlacementReviews=new Map();
import('./src/domain/design-bom.js').then(module=>{
  designBomModule=module;
  if(P)renderDesignNeeds(allDisplayFurniture(P.furniture));
}).catch(()=>{
  designBomLoadError=true;
  if(P)renderDesignNeeds([]);
});
$('#comparisonPanel').insertAdjacentHTML('afterend','<section id="editGuide" class="edit-guide" aria-live="polite" hidden><div class="edit-guide-copy"><b id="editGuideTitle"></b><p id="editGuideText"></p></div><div class="edit-guide-actions"><button type="button" class="btn" id="editGuideUndo">Undo last change</button><button type="button" class="btn" id="editGuideClose">Close guide</button></div></section>');
$('#comparisonPanel').insertAdjacentHTML('afterend','<section id="manualSpaceGuide" class="manual-space-guide" aria-label="Manually adjust a suggested area" hidden><div><b id="manualSpaceTitle"></b><p id="manualSpaceSuggestion"></p><p id="manualSpaceFeedback" class="manual-feedback" role="status"></p><p class="manual-note">Move the highlighted area on the plan, or set its size here. Furniture and nearby areas are not automatically rearranged; review the updated checks.</p></div><div class="manual-space-controls"><label>Width (mm)<input id="manualSpaceWidth" type="number" min="1000" step="100"></label><label>Depth (mm)<input id="manualSpaceDepth" type="number" min="1000" step="100"></label><button type="button" class="btn primary" id="manualSpaceApply">Apply my size</button><button type="button" class="btn" id="manualSpaceFocus">Locate area</button><button type="button" class="btn" id="manualSpaceUndo">Undo edit</button><button type="button" class="btn" id="manualSpaceClose">Done</button></div></section>');
$('#inspector').insertAdjacentHTML('beforebegin','<div id="teamAreaPicker" class="team-area-picker" hidden></div>');
let comparisonCollapsed=false;
let mobileCompareExpanded=false;
const comparisonPanel=$('#comparisonPanel');
const roomReuseDisclosure=document.createElement('details');roomReuseDisclosure.id='roomReuseDisclosure';roomReuseDisclosure.className='proposal-disclosure';roomReuseDisclosure.innerHTML='<summary>Existing-room use suggestion</summary><div id="roomReuseOptions" class="space-proposals" aria-live="polite"></div>';comparisonPanel.insertBefore(roomReuseDisclosure,$('#comparisonGrid'));
comparisonPanel.querySelector('.comparison-head').insertAdjacentHTML('afterend','<div class="mobile-plan-controls" id="mobilePlanControls" hidden><label for="mobilePlanSelect">Viewing layout</label><select id="mobilePlanSelect" aria-label="Choose a layout"></select><button class="btn" id="mobileCompareToggle" type="button" aria-controls="comparisonGrid" aria-expanded="false">Compare all three</button></div>');
const proposalDisclosure=document.createElement('details');
proposalDisclosure.id='proposalDisclosure';
proposalDisclosure.className='proposal-disclosure';
proposalDisclosure.open=false;
proposalDisclosure.innerHTML='<summary>Space adjustment suggestions</summary>';
const proposalHost=$('#spaceProposals');
proposalHost.before(proposalDisclosure);
proposalDisclosure.append(proposalHost);
let V={scale:0.04,x:0,y:0};
let underlay={src:null,image:null};
function id(){return Math.random().toString(36).slice(2,10)}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function normalizeProject(p){
  p.source=p.source||{kind:'dimensions'};p.site=p.site||{confirmed:false};p.drafts=p.drafts||[];
  for(const object of p.objects||[])if(object.type==='room'){
    if(object.furnitureShift){const {dx,dy}=object.furnitureShift;
      if(!Number.isInteger(dx)||!Number.isInteger(dy)||Math.abs(dx)>5000||Math.abs(dy)>5000)delete object.furnitureShift}
    if(!['rotate_cw','rotate_180','rotate_ccw','mirror_x','mirror_y'].includes(object.furnitureLayout))delete object.furnitureLayout;
    const raw=object.furnitureItemOffsets;
    if(!raw||typeof raw!=='object'||Array.isArray(raw))delete object.furnitureItemOffsets;
    else{const clean={};for(const [instanceId,offset] of Object.entries(raw).slice(0,24))if(instanceId.startsWith(`${object.id}-`)&&
      offset&&Number.isInteger(offset.dx)&&Number.isInteger(offset.dy)&&Math.abs(offset.dx)<=5000&&Math.abs(offset.dy)<=5000&&
      (offset.dx||offset.dy))clean[instanceId]={dx:offset.dx,dy:offset.dy};
      if(Object.keys(clean).length)object.furnitureItemOffsets=clean;else delete object.furnitureItemOffsets}
    const rawTurns=object.furnitureItemRotations;
    if(!rawTurns||typeof rawTurns!=='object'||Array.isArray(rawTurns))delete object.furnitureItemRotations;
    else{const clean={};for(const [instanceId,turn] of Object.entries(rawTurns).slice(0,24))if(instanceId.startsWith(`${object.id}-`)&&
      [90,180,270].includes(turn))clean[instanceId]=turn;
      if(Object.keys(clean).length)object.furnitureItemRotations=clean;else delete object.furnitureItemRotations}
  }
  for(const draft of p.drafts)draft.workAreas=(Array.isArray(draft.workAreas)?draft.workAreas:[]).map(area=>({...area,type:'workArea'}));
  if(p.drafts.length&&!p.drafts.some(d=>d.id===p.activeDraft))p.activeDraft=p.drafts[0].id;
  p.workAreas=(Array.isArray(p.workAreas)?p.workAreas:(p.drafts.find(d=>d.id===p.activeDraft)?.workAreas||[])).map(area=>({...area,type:'workArea'}));
  p.spaceProposals=Array.isArray(p.spaceProposals)?p.spaceProposals:[];
  p.roomReuseProposals=Array.isArray(p.roomReuseProposals)?p.roomReuseProposals:[];
  p.acceptedRoomReuse=p.acceptedRoomReuse&&typeof p.acceptedRoomReuse==='object'?p.acceptedRoomReuse:null;
  p.manualSpaceEdit=p.manualSpaceEdit&&typeof p.manualSpaceEdit==='object'?p.manualSpaceEdit:null;
  p.zoneAssist=p.zoneAssist&&typeof p.zoneAssist==='object'&&Array.isArray(p.zoneAssist.ideas)?p.zoneAssist:null;
  p.zoneAssistHistory=Array.isArray(p.zoneAssistHistory)?p.zoneAssistHistory.filter(turn=>turn&&typeof turn.request==='string'&&typeof turn.reply==='string').slice(-6):[];
  p.productBindings=Array.isArray(p.productBindings)?p.productBindings:[];
  p.productProfiles=p.productProfiles&&typeof p.productProfiles==='object'&&!Array.isArray(p.productProfiles)?p.productProfiles:{};
  p.derivedProducts=p.derivedProducts&&typeof p.derivedProducts==='object'&&!Array.isArray(p.derivedProducts)?p.derivedProducts:{};
  p.setSelections=Array.isArray(p.setSelections)?p.setSelections:[];
  p.catalogMode=p.catalogMode==='demo'?'demo':p.catalogMode==='server'?'server':null;
  p.catalogVersion=typeof p.catalogVersion==='string'?p.catalogVersion:null;
  p.demoBudget=Number.isFinite(Number(p.demoBudget))&&Number(p.demoBudget)>0?Number(p.demoBudget):75000;
  p.demoPackageChoice=p.demoPackageChoice&&typeof p.demoPackageChoice==='object'?p.demoPackageChoice:null;
  if(p.demoPackageChoice){const raw=p.demoPackageChoice.selections,clean={};if(raw&&typeof raw==='object'&&!Array.isArray(raw))
    for(const [instanceId,candidateId] of Object.entries(raw).slice(0,500))if(typeof instanceId==='string'&&instanceId&&typeof candidateId==='string'&&candidateId)clean[instanceId]=candidateId;
    p.demoPackageChoice.selections=clean}
  p.demoQuote=p.demoQuote&&typeof p.demoQuote==='object'?p.demoQuote:null;
  p.demoOrder=p.demoOrder&&typeof p.demoOrder==='object'?p.demoOrder:null;
  p.draftsStale=!!p.draftsStale;return p;
}
function fresh(name='Untitled office',w=18000,h=12000,source={kind:'dimensions'}){return normalizeProject({version:1,name,w,h,source,site:{confirmed:false},rules:{main:1200,minor:900},objects:[{id:id(),type:'wall',x:0,y:0,x2:w,y2:0},{id:id(),type:'wall',x:w,y:0,x2:w,y2:h},{id:id(),type:'wall',x:w,y:h,x2:0,y2:h},{id:id(),type:'wall',x:0,y:h,x2:0,y2:0}],furniture:[],drafts:[]})}
function load(){try{const p=JSON.parse(localStorage.getItem(STORE));if(p?.version===1)return normalizeProject(p)}catch{}return fresh()}
function save(){localStorage.setItem(STORE,JSON.stringify(P));render();renderDemoPackageCards()}
function snapshot(){history.push(JSON.stringify(P));if(history.length>30)history.shift()}
function undo(){if(!history.length)return;P=normalizeProject(JSON.parse(history.pop()));previewProposalId=null;roomReusePreviewId=null;selected=null;save()}
function fit(){const r=cv.getBoundingClientRect(), pad=70;V.scale=Math.min((r.width-pad)/P.w,(r.height-pad)/P.h);V.x=(r.width-P.w*V.scale)/2;V.y=(r.height-P.h*V.scale)/2;render()}
function resizeCanvas(){const r=cv.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,2),w=Math.max(1,Math.round(r.width*d)),h=Math.max(1,Math.round(r.height*d));if(cv.width!==w||cv.height!==h){cv.width=w;cv.height=h}ctx.setTransform(d,0,0,d,0,0)}
function sourceUnderlay(){const src=P.source?.preview;if(!src)return null;if(underlay.src!==src){const image=new Image();underlay={src,image};image.onload=render;image.src=src}return underlay.image}
function screen(x,y){return [V.x+x*V.scale,V.y+y*V.scale]}; function world(x,y){return [(x-V.x)/V.scale,(y-V.y)/V.scale]};
function rect(o){return {x:Math.min(o.x,o.x2),y:Math.min(o.y,o.y2),w:Math.abs(o.x2-o.x),h:Math.abs(o.y2-o.y)}}
function overlap(a,b){return a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y}
function inSite(r){return r.x>=0&&r.y>=0&&r.x+r.w<=P.w&&r.y+r.h<=P.h}
function clamp(n){return Math.round(n/50)*50}
function furnitureRect(f){const quarter=Math.abs(Math.round((f.rot||0)/90))%2,w=quarter?f.h:f.w,h=quarter?f.w:f.h;return {x:f.x-w/2,y:f.y-h/2,w,h}}
function siteReadiness(){const count=t=>P.objects.filter(o=>o.type===t).length,entrances=count('door'),exits=count('exit'),walls=count('wall'),fixed=count('column')+count('blocked')+(P.broker?.fitOutMode==='as_is'?P.objects.filter(o=>o.type==='room'&&o.existing).length:0),recognitionPending=P.source?.status==='awaiting_recognition',geometryReady=walls>=3&&entrances>0&&exits>0;return {entrances,exits,walls,fixed,recognitionPending,geometryReady,ready:geometryReady&&!recognitionPending}}
function sourceLabel(){if(P.source?.kind==='upload')return `${P.source.fileName||'Uploaded plan'} · ${P.source.status==='awaiting_recognition'?'assisted import':'tracing reference'}`;if(P.source?.kind==='simulated')return `${P.source.label||'Simulated property'} · fictional`;if(P.source?.kind==='example')return 'Guided example';if(P.source?.originalFile)return `Entered dimensions · ${P.source.originalFile.fileName} intake retained`;return `${(P.w/1000).toFixed(1)} × ${(P.h/1000).toFixed(1)} m · entered dimensions`}
function markSiteChanged(){P.site=P.site||{};P.site.confirmed=false;P.spaceProposals=[];previewProposalId=null;if(P.drafts?.length)P.draftsStale=true}
function renderSiteStatus(){const r=siteReadiness(),status=P.draftsStale?['warn','Site changed · regenerate concepts']:r.recognitionPending?['warn','Assisted import required']:P.site?.confirmed?['ok','Site confirmed']:r.ready?['warn','Ready for confirmation']:['bad','Entrance and emergency exit required'];$('#siteStatus').innerHTML=`<div class="readiness-row"><span>Source</span><b>${esc(sourceLabel())}</b></div><div class="readiness-row"><span>Envelope</span><b>${(P.w/1000).toFixed(1)} × ${(P.h/1000).toFixed(1)} m</b></div><div class="readiness-row"><span>Entrances / exits</span><b>${r.entrances} / ${r.exits}</b></div><div class="readiness-row"><span>Fixed constraints</span><b>${r.fixed}</b></div><div class="status ${status[0]}">${status[1]}</div>`}
function renderPhaseBar(){const bar=$('#setupBar');if(readOnly||P.drafts.length&&!P.draftsStale){bar.hidden=true;return}const r=siteReadiness(),tools=bar.querySelectorAll('[data-setup-tool]');bar.hidden=false;bar.classList.toggle('warn',!!P.draftsStale||(!r.ready&&!P.drafts.length));if(P.drafts.length){tools.forEach(b=>b.hidden=true);$('#setupTitle').textContent='Layouts need updating';$('#setupText').textContent='Regenerate before sharing.';$('#openBrief').textContent='Review needs';return}if(r.recognitionPending){tools.forEach(b=>b.hidden=true);$('#setupTitle').textContent='PDF / DWG requires assisted import';$('#setupText').textContent='File recorded. Use dimensions to continue this MVP.';$('#openBrief').textContent='Use dimensions for now';return}tools.forEach(b=>b.hidden=false);$('#setupTitle').textContent='Step 3 · Mark the site';$('#setupText').textContent=r.ready?'Entrance and exit marked. Check the plan, then continue.':'Choose a marker, then tap an exterior wall.';$('#openBrief').textContent='Confirm site'}
function addFurniture(kind){if(readOnly)return;snapshot();const candidate=makeFurniture(kind,P.w/2,P.h/2);let placed=false;for(let y=700;y<P.h&&!placed;y+=700)for(let x=700;x<P.w&&!placed;x+=700){candidate.x=x;candidate.y=y;if(canPlaceFurniture(candidate,P.furniture,P.objects)){placed=true}}if(!placed){history.pop();$('#hint').textContent='No free position found. Move furniture or adjust the clear zones first.';return}P.furniture.push(candidate);selected=candidate.id;tool='select';setTool();save()}
function seatsOfFurniture(f){return f.kind==='bench2'?2:f.kind==='cubicle'||f.kind==='desk'?1:f.kind==='meeting'?6:0}
function makeFurniture(kind,x,y){const c=catalog.find(v=>v.kind===kind);return {id:id(),type:'furniture',kind,sku:c.sku,catalogVersion:SAMPLE_CATALOG_VERSION,name:c.name,w:c.width,h:c.depth,z:c.height,price:c.samplePrice,priceStatus:'illustrative',x,y,rot:0}}
// Chairs are linked views of their parent furniture, so moving or rotating a desk keeps its seats together.
// The extra chair-use depth is an MVP planning allowance, not a code-compliance value.
const CHAIR_USE_DEPTH=1000,CHAIR_SIZE=600;
function chairSeats(f){const w=f.w,h=f.h;if(f.kind==='bench2')return [{x:0,y:-h/2,side:'north'},{x:0,y:h/2,side:'south'}];if(f.kind==='desk'||f.kind==='manager'||f.kind==='reception')return [{x:0,y:h/2,side:'south'}];if(f.kind==='coffeeBar')return [{x:-550,y:h/2,side:'south'},{x:550,y:h/2,side:'south'}];if(f.kind==='cubicle')return [{x:0,y:200,side:'inside'}];if(f.kind==='meeting')return [{x:-w/4,y:-h/2,side:'north'},{x:w/4,y:-h/2,side:'north'},{x:-w/4,y:h/2,side:'south'},{x:w/4,y:h/2,side:'south'},{x:-w/2,y:0,side:'west'},{x:w/2,y:0,side:'east'}];return []}
function rotateLocal(f,x,y){const angle=(f.rot||0)*Math.PI/180;return {x:f.x+x*Math.cos(angle)-y*Math.sin(angle),y:f.y+x*Math.sin(angle)+y*Math.cos(angle)}}
function chairItems(f){const spec=catalog.find(item=>item.kind===(f.kind==='meeting'?'meetingChair':f.kind==='coffeeBar'?'barStool':'chair'));return chairSeats(f).map((seat,index)=>{const outward=seat.side==='north'?{x:0,y:-1}:seat.side==='south'?{x:0,y:1}:seat.side==='west'?{x:-1,y:0}:seat.side==='east'?{x:1,y:0}:{x:0,y:0},offset=seat.side==='inside'?0:CHAIR_SIZE/2+50,p=rotateLocal(f,seat.x+outward.x*offset,seat.y+outward.y*offset);return {id:`${f.id}-chair-${index}`,type:'furniture',kind:spec.kind,sku:spec.sku,catalogVersion:SAMPLE_CATALOG_VERSION,name:spec.name,w:spec.width,h:spec.depth,z:spec.height,price:spec.samplePrice,priceStatus:'illustrative',x:p.x,y:p.y,rot:f.rot||0,linkedTo:f.id,...(f.roomId?{roomId:f.roomId}:{}),...(f.zoneId?{zoneId:f.zoneId}:{})}})}
// Planning footprints remain in the editable layout; only their physical members
// enter the visual scene, design needs and review snapshot. No bundle price is implied.
function compositeFurnitureItems(parent){
  if(!['dining4','lounge2'].includes(parent.kind))return [parent];
  const member=(kind,key,x,y,options={})=>{
    const spec=catalog.find(item=>item.kind===kind),point=rotateLocal(parent,x,y);
    return {id:`${parent.id}-${key}`,type:'furniture',kind,name:options.name||spec.name,
      w:options.w||spec.width,h:options.h||spec.depth,z:spec.height,x:point.x,y:point.y,
      rot:parent.rot||0,roomId:parent.roomId,zoneId:parent.zoneId,derived:true,
      sku:null,price:null,priceStatus:'pending_product_quote',
      ...(options.linkedTo?{linkedTo:`${parent.id}-${options.linkedTo}`}:{})};
  };
  if(parent.kind==='dining4')return [
    member('diningTable','table',0,0,{name:'Dining table · concept'}),
    member('diningChair','chair-west',-900,0,{linkedTo:'table'}),
    member('diningChair','chair-east',900,0,{linkedTo:'table'}),
    member('diningChair','chair-north',0,-800,{linkedTo:'table'}),
    member('diningChair','chair-south',0,800,{linkedTo:'table'}),
  ];
  return [member('sofa','sofa',0,-300,{name:'2-seat sofa · concept',w:1600,h:800}),
    member('sideTable','table',0,500,{linkedTo:'sofa'})];
}
function compositeMembersValid(parent){
  if(!['dining4','lounge2'].includes(parent.kind))return true;
  const bounds=furnitureRect(parent),inside=area=>area.x>=bounds.x&&area.y>=bounds.y&&
    area.x+area.w<=bounds.x+bounds.w&&area.y+area.h<=bounds.y+bounds.h;
  const members=compositeFurnitureItems(parent);
  return members.every((member,index)=>inside(furnitureRect(member))&&
    !members.some((other,j)=>j>index&&overlap(furnitureRect(member),furnitureRect(other))));
}
function rotatedLocalBox(f,x,y,w,h){const corners=[[x,y],[x+w,y],[x+w,y+h],[x,y+h]].map(([a,b])=>rotateLocal(f,a,b)),xs=corners.map(p=>p.x),ys=corners.map(p=>p.y);return {x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)}}
function chairUseZones(f){return chairSeats(f).filter(seat=>seat.side!=='inside').map(seat=>seat.side==='north'?rotatedLocalBox(f,seat.x-CHAIR_SIZE/2,seat.y-CHAIR_USE_DEPTH,CHAIR_SIZE,CHAIR_USE_DEPTH):seat.side==='south'?rotatedLocalBox(f,seat.x-CHAIR_SIZE/2,seat.y,CHAIR_SIZE,CHAIR_USE_DEPTH):seat.side==='west'?rotatedLocalBox(f,seat.x-CHAIR_USE_DEPTH,seat.y-CHAIR_SIZE/2,CHAIR_USE_DEPTH,CHAIR_SIZE):rotatedLocalBox(f,seat.x,seat.y-CHAIR_SIZE/2,CHAIR_USE_DEPTH,CHAIR_SIZE))}
function occupiedFurnitureRects(f){return [furnitureRect(f),...chairUseZones(f)]}
function allDisplayFurniture(items,objects=P.objects,derivedProducts=P.derivedProducts){
  const primaryIds=new Set(items.map(item=>item.id));
  return [...items.flatMap(f=>[...compositeFurnitureItems(f),...chairItems(f)]),
    ...(objects||[]).filter(o=>o.type==='room').flatMap(room=>roomDisplayFurniture(room))].map(item=>{
    if(primaryIds.has(item.id))return item;
    const saved=derivedProducts?.[item.id];
    return saved?{...item,w:saved.w,h:saved.h,z:saved.z,name:saved.name||item.name,
      productCandidateId:saved.productCandidateId,sku:null,price:null,priceStatus:'pending_product_quote'}:item;
  });
}
function furnitureHasClearance(f,project){const areas=occupiedFurnitureRects(f),blocks=plannerBlocks((project.objects||[]).filter(o=>o.id!==f.zoneId)),inside=r=>r.x>=0&&r.y>=0&&r.x+r.w<=project.w&&r.y+r.h<=project.h;return areas.every(r=>inside(r)&&!blocks.some(block=>overlap(r,block))&&!(project.furniture||[]).some(other=>other.id!==f.id&&occupiedFurnitureRects(other).some(box=>overlap(r,box))))}
function workstationSeatsForAssessment(project){return (project.furniture||[]).filter(f=>['bench2','cubicle','desk'].includes(f.kind)&&furnitureHasClearance(f,project)&&islandSpacingValid(f,project)).reduce((total,f)=>total+seatsOfFurniture(f),0)}
function workAreaSeatsForAssessment(project,workAreaId){
  const area=(project.workAreas||[]).find(item=>item.id===workAreaId);
  if(!area||![area.x,area.y,area.x2,area.y2].every(Number.isFinite))return 0;
  const bounds=rect(area),inside=box=>box.x>=bounds.x&&box.y>=bounds.y&&box.x+box.w<=bounds.x+bounds.w&&box.y+box.h<=bounds.y+bounds.h;
  const members=(project.furniture||[]).filter(f=>f.workAreaId===workAreaId&&f.islandId&&['bench2','cubicle','desk'].includes(f.kind));
  return [...new Set(members.map(f=>f.islandId))].reduce((total,islandId)=>{
    const wholeIsland=project.furniture.filter(f=>f.islandId===islandId);
    if(!wholeIsland.length||wholeIsland.some(f=>f.workAreaId!==workAreaId)||!inside(islandEnvelope(wholeIsland))||!wholeIsland.every(f=>furnitureHasClearance(f,project)&&islandSpacingValid(f,project)))return total;
    return total+wholeIsland.reduce((n,f)=>n+seatsOfFurniture(f),0);
  },0);
}
function plannerBlocks(objects){return objects.filter(o=>['column','blocked','corridor','room','zone'].includes(o.type)).map(rect)}
function canPlaceFurniture(f,placed,objects){const areas=occupiedFurnitureRects(f),blocks=plannerBlocks(objects);return areas.every(r=>inSite(r)&&!blocks.some(b=>overlap(r,b))&&!placed.some(x=>occupiedFurnitureRects(x).some(q=>overlap(r,q))))}
function putIfFree(kind,x,y,placed,objects){const f=makeFurniture(kind,x,y);if(!canPlaceFurniture(f,placed,objects))return false;placed.push(f);return true}
// An island is assembled before testing positions. Opposing rows face outward, leaving the joined desk edges inside.
const ISLAND_GAP=400,ISLAND_SIZES=[8,6,4,2];
function workstationIsland(kind,seats,x,y,islandId=id(),turn=0){
  const unit=catalog.find(v=>v.kind===kind),columns=seats/2,members=[];
  for(let row=0;row<2;row++)for(let column=0;column<columns;column++){
    const localX=(column-(columns-1)/2)*unit.width,localY=(row-.5)*unit.depth,desk=makeFurniture(kind,x+(turn?-localY:localX),y+(turn?localX:localY));
    desk.rot=(row===0?180:0)+turn;desk.islandId=islandId;desk.islandSeats=seats;members.push(desk);
  }
  return members;
}
function islandEnvelope(members){const boxes=members.flatMap(occupiedFurnitureRects),x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y)),right=Math.max(...boxes.map(b=>b.x+b.w)),bottom=Math.max(...boxes.map(b=>b.y+b.h)),privateAccess=members[0]?.kind==='cubicle'?900:0,turn=Math.abs(Math.round((members[0]?.rot||0)/90))%2;return {x:x-(turn?privateAccess:0),y:y-(turn?0:privateAccess),w:right-x+(turn?2*privateAccess:0),h:bottom-y+(turn?0:2*privateAccess)}}
function islandSpacingValid(f,project){if(!f.islandId)return true;const furniture=project.furniture||[],members=furniture.filter(item=>item.islandId===f.islandId);if(members.length!==f.islandSeats)return false;const envelope=islandEnvelope(members);if(envelope.x<0||envelope.y<0||envelope.x+envelope.w>project.w||envelope.y+envelope.h>project.h||plannerBlocks(project.objects||[]).some(block=>overlap(envelope,block))||furniture.some(item=>!item.islandId&&occupiedFurnitureRects(item).some(box=>overlap(envelope,box))))return false;return ![...new Set(furniture.filter(item=>item.islandId&&item.islandId!==f.islandId).map(item=>item.islandId))].some(islandId=>{const other=islandEnvelope(furniture.filter(item=>item.islandId===islandId));return overlap(envelope,{x:other.x-ISLAND_GAP,y:other.y-ISLAND_GAP,w:other.w+2*ISLAND_GAP,h:other.h+2*ISLAND_GAP})})}
function canPlaceIsland(members,zone,placed,objects){
  const envelope=islandEnvelope(members),inside=r=>r.x>=zone.x0&&r.y>=zone.y0&&r.x+r.w<=zone.x1&&r.y+r.h<=zone.y1&&inSite(r),blocks=plannerBlocks(objects);
  if(!inside(envelope)||blocks.some(block=>overlap(envelope,block)))return false;
  const existing=[...new Set(placed.filter(f=>f.islandId).map(f=>f.islandId))].map(islandId=>islandEnvelope(placed.filter(f=>f.islandId===islandId)));
  if(existing.some(other=>overlap(envelope,{x:other.x-ISLAND_GAP,y:other.y-ISLAND_GAP,w:other.w+2*ISLAND_GAP,h:other.h+2*ISLAND_GAP})))return false;
  const loose=placed.filter(f=>!f.islandId);
  if(loose.some(f=>occupiedFurnitureRects(f).some(box=>overlap(envelope,box))))return false;
  return members.every((f,index)=>occupiedFurnitureRects(f).every(area=>inside(area)&&!members.some((other,j)=>j>index&&occupiedFurnitureRects(other).some(box=>overlap(area,box)))));
}
// A sampled free-floor route is a concept screen, not an egress or accessibility certification.
function accessReview(project){
  const step=500,columns=Math.ceil(project.w/step),rows=Math.ceil(project.h/step),objects=project.objects||[],furniture=project.furniture||[];
  const blockers=[...objects.filter(o=>['column','blocked','room','zone','partition'].includes(o.type)).map(o=>{const box=rect(o);return o.type==='partition'?{x:box.x-100,y:box.y-100,w:box.w+200,h:box.h+200}:box}),...furniture.flatMap(occupiedFurnitureRects)];
  const clear=new Uint8Array(columns*rows),visited=new Uint8Array(columns*rows),at=(x,y)=>y*columns+x;
  for(let y=0;y<rows;y++)for(let x=0;x<columns;x++){const px=(x+.5)*step,py=(y+.5)*step;if(px<project.w&&py<project.h&&!blockers.some(box=>px>=box.x-100&&px<=box.x+box.w+100&&py>=box.y-100&&py<=box.y+box.h+100))clear[at(x,y)]=1}
  const nearby=(point,limit=850)=>{const result=[];for(let y=Math.max(0,Math.floor((point.y-limit)/step));y<Math.min(rows,Math.ceil((point.y+limit)/step));y++)for(let x=Math.max(0,Math.floor((point.x-limit)/step));x<Math.min(columns,Math.ceil((point.x+limit)/step));x++){const index=at(x,y);if(clear[index]&&Math.hypot((x+.5)*step-point.x,(y+.5)*step-point.y)<=limit)result.push(index)}return result};
  const entrances=objects.filter(o=>o.type==='door'),exits=objects.filter(o=>o.type==='exit');
  if(!entrances.length||!exits.length)return {status:'unknown',exitConnected:false,unreachableRooms:[],unreachableZones:[],unreachableIslands:[]};
  const queue=[];for(const entrance of entrances)for(const index of nearby(entrance)){if(!visited[index]){visited[index]=1;queue.push(index)}}
  for(let head=0;head<queue.length;head++){const index=queue[head],x=index%columns,y=Math.floor(index/columns);for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=columns||ny>=rows)continue;const next=at(nx,ny);if(clear[next]&&!visited[next]){visited[next]=1;queue.push(next)}}}
  const reached=point=>nearby(point).some(index=>visited[index]),boundaryReached=box=>{for(let x=box.x-600;x<=box.x+box.w+600;x+=step)if(reached({x,y:box.y-550})||reached({x,y:box.y+box.h+550}))return true;for(let y=box.y-600;y<=box.y+box.h+600;y+=step)if(reached({x:box.x-550,y})||reached({x:box.x+box.w+550,y}))return true;return false};
  const roomDoorOutside=room=>{const box=rect(room),side=room.door?.side;return side==='north'?{x:box.x+box.w/2,y:box.y-550}:side==='south'?{x:box.x+box.w/2,y:box.y+box.h+550}:side==='west'?{x:box.x-550,y:box.y+box.h/2}:{x:box.x+box.w+550,y:box.y+box.h/2}};
  const islands=[...new Set(furniture.filter(f=>f.islandId).map(f=>f.islandId))].map(islandId=>furniture.filter(f=>f.islandId===islandId));
  const roomsMissed=objects.filter(o=>o.type==='room'&&!reached(roomDoorOutside(o))),zonesMissed=objects.filter(o=>o.type==='zone'&&!boundaryReached(rect(o))),islandsMissed=islands.filter(members=>!boundaryReached(islandEnvelope(members)));
  return {status:'checked',exitConnected:exits.some(reached),unreachableRooms:roomsMissed.map(o=>o.name||roomNames[o.kind]||'Room'),unreachableRoomIds:roomsMissed.map(o=>o.id),unreachableZones:zonesMissed.map(o=>o.name||'Shared zone'),unreachableZoneIds:zonesMissed.map(o=>o.id),unreachableIslands:islandsMissed.map(members=>members[0].islandId)};
}
// Sample each interval where the set of intruding objects is constant; this is a planning-width screen only.
function corridorBottlenecks(project){
  const objects=project.objects||[],furniture=project.furniture||[],rules=project.rules||{main:1200,minor:900};
  const obstacles=[...objects.filter(o=>['column','blocked','room','zone','partition'].includes(o.type)).map(o=>{const box=rect(o);return {id:o.id,name:o.name||typeName[o.type],box:o.type==='partition'?{x:box.x-100,y:box.y-100,w:box.w+200,h:box.h+200}:box}}),...furniture.flatMap(f=>occupiedFurnitureRects(f).map(box=>({id:f.id,name:f.name,box})))];
  return objects.filter(o=>o.type==='corridor').map(corridor=>{
    const area=rect(corridor),horizontal=area.w>=area.h,alongStart=horizontal?area.x:area.y,alongEnd=alongStart+(horizontal?area.w:area.h),acrossStart=horizontal?area.y:area.x,acrossEnd=acrossStart+(horizontal?area.h:area.w),required=corridor.kind==='main'?(+rules.main||1200):(+rules.minor||900);
    const relevant=obstacles.filter(item=>overlap(area,item.box)),cuts=[alongStart,alongEnd];
    for(const item of relevant){cuts.push(Math.max(alongStart,horizontal?item.box.x:item.box.y),Math.min(alongEnd,horizontal?item.box.x+item.box.w:item.box.y+item.box.h))}
    cuts.sort((a,b)=>a-b);let narrowest=acrossEnd-acrossStart,point={x:area.x+area.w/2,y:area.y+area.h/2},sourceIds=[];
    for(let index=0;index<cuts.length-1;index++){if(cuts[index+1]<=cuts[index])continue;const sample=(cuts[index]+cuts[index+1])/2,active=relevant.filter(item=>sample>(horizontal?item.box.x:item.box.y)&&sample<(horizontal?item.box.x+item.box.w:item.box.y+item.box.h)),intervals=active.map(item=>({start:Math.max(acrossStart,horizontal?item.box.y:item.box.x),end:Math.min(acrossEnd,horizontal?item.box.y+item.box.h:item.box.x+item.box.w)})).filter(interval=>interval.end>interval.start).sort((a,b)=>a.start-b.start);let cursor=acrossStart,widest=0;for(const interval of intervals){widest=Math.max(widest,interval.start-cursor);cursor=Math.max(cursor,interval.end)}widest=Math.max(widest,acrossEnd-cursor);if(widest<narrowest){narrowest=widest;point=horizontal?{x:sample,y:area.y+area.h/2}:{x:area.x+area.w/2,y:sample};sourceIds=[...new Set(active.map(item=>item.id))]}}
    return narrowest+1<required?{corridorId:corridor.id,kind:corridor.kind||'minor',required,clearance:Math.max(0,Math.round(narrowest)),point,sourceIds:sourceIds.length?sourceIds:[corridor.id],sources:[...new Set(relevant.filter(item=>sourceIds.includes(item.id)).map(item=>item.name))]}:null;
  }).filter(Boolean);
}
function fillWorkstations(kind,target,zones,placed,objects,workAreaId=null){
  let total=placed.filter(f=>['bench2','cubicle','desk'].includes(f.kind)&&(!workAreaId||f.workAreaId===workAreaId)).reduce((n,f)=>n+seatsOfFurniture(f),0);
  for(const size of ISLAND_SIZES){
    if(total>=target||size>Math.max(2,target-total+(target-total)%2))continue;
    const points=[];
    for(const turn of [0,90]){const base=workstationIsland(kind,size,0,0,undefined,turn),box=islandEnvelope(base);for(const zone of zones)for(let y=zone.y0-box.y;y<=zone.y1-box.y-box.h;y+=500)for(let x=zone.x0-box.x;x<=zone.x1-box.x-box.w;x+=500)points.push({x,y,zone,turn})}
    points.sort((a,b)=>placementScore('workstation',b)-placementScore('workstation',a)||a.y-b.y||a.x-b.x);
    for(const point of points){if(total>=target||size>Math.max(2,target-total+(target-total)%2))break;const island=workstationIsland(kind,size,point.x,point.y,undefined,point.turn);if(canPlaceIsland(island,point.zone,placed,objects)){for(const member of island)member.workAreaId=workAreaId||'general';placed.push(...island);total+=size}}
  }
  return total;
}
// These rectangles label desk neighborhoods. They never enter plannerBlocks: rooms, furniture and aisles remain the physical blockers.
function workAreaSectors(zones,kind,wanted){
  const fits=zone=>[0,90].some(turn=>{const envelope=islandEnvelope(workstationIsland(kind,2,0,0,'sector-test',turn));return zone.x1-zone.x0>=envelope.w&&zone.y1-zone.y0>=envelope.h});
  const sectors=zones.filter(fits).map(zone=>({...zone}));
  while(sectors.length<Math.min(4,wanted)){
    const choices=[];
    for(let i=0;i<sectors.length;i++)for(const axis of ['x','y']){
      const source=sectors[i],mid=axis==='x'?Math.round((source.x0+source.x1)/500)*250:Math.round((source.y0+source.y1)/500)*250;
      const first={...source,[axis+'1']:mid},second={...source,[axis+'0']:mid};
      if(fits(first)&&fits(second))choices.push({index:i,first,second,area:(source.x1-source.x0)*(source.y1-source.y0)});
    }
    if(!choices.length)break;
    choices.sort((a,b)=>b.area-a.area||a.index-b.index);
    const choice=choices[0];sectors.splice(choice.index,1,choice.first,choice.second);
  }
  return sectors.sort((a,b)=>(b.x1-b.x0)*(b.y1-b.y0)-(a.x1-a.x0)*(a.y1-a.y0)||a.y0-b.y0||a.x0-b.x0);
}
function planWorkAreas(kind,people,zones,furniture,objects,brief,intent=null){
  const named=(brief?.requirements?.workAreas||[]).slice(0,3);
  if(!named.length){const seats=fillWorkstations(kind,people,zones,furniture,objects);return {seats,workAreas:[]}}
  const genericTarget=Math.max(0,people-named.reduce((sum,area)=>sum+area.targetDesks,0));
  const requests=[...named.map(area=>({...area})),...(genericTarget?[{id:'__general__',name:'General work area',activity:'mixed',targetDesks:genericTarget,minimumDesks:0,priority:'preferred',generic:true}]:[])];
  const sectors=workAreaSectors(zones,kind,requests.length),ordered=named.slice().sort((a,b)=>b.targetDesks-a.targetDesks),assigned=new Map();
  if(intent?.targetKey?.startsWith('work-area:')&&['near_entrance','near_window'].includes(intent.action)){
    const areaId=intent.targetKey.slice('work-area:'.length),index=ordered.findIndex(area=>area.id===areaId),marker=intent.action==='near_window'?'window':'door';
    if(index>=0&&P.objects.some(item=>item.type===marker)){
      ordered.unshift(...ordered.splice(index,1));
      sectors.sort((a,b)=>markerDistance(marker,{x:a.x0,y:a.y0,x2:a.x1,y2:a.y1})-markerDistance(marker,{x:b.x0,y:b.y0,x2:b.x1,y2:b.y1}));
    }
  }
  for(let i=0;i<ordered.length;i++)if(sectors[i])assigned.set(ordered[i].id,[sectors[i]]);
  if(genericTarget)assigned.set('__general__',sectors.slice(Math.min(ordered.length,sectors.length)));
  const workAreas=[];
  for(const request of requests){
    const parts=assigned.get(request.id)||[],sector=parts[0],actualDesks=parts.length?fillWorkstations(kind,request.targetDesks,parts,furniture,objects,request.id):0;
    workAreas.push({id:request.id,type:'workArea',name:request.name,activity:request.activity,targetDesks:request.targetDesks,minimumDesks:request.minimumDesks||0,priority:request.priority||'must',generic:!!request.generic,actualDesks,shortfall:Math.max(0,request.targetDesks-actualDesks),...(sector?{x:sector.x0,y:sector.y0,x2:sector.x1,y2:sector.y1}:{})});
  }
  return {seats:furniture.filter(f=>['bench2','cubicle','desk'].includes(f.kind)).reduce((n,f)=>n+seatsOfFurniture(f),0),workAreas};
}
const roomNames={meeting:'Meeting room',office:'Private office',pantry:'Pantry'};
const extraRoomSpecs={meeting:{name:'Additional meeting room',capacity:30},huddle:{name:'Huddle room',capacity:6},focus:{name:'Focus room',capacity:1,w:3000,h:3000},training:{name:'Training room',capacity:12},collaboration:{name:'Open collaboration',capacity:2,w:3200,h:3000},waiting:{name:'Visitor waiting area',capacity:2,w:3200,h:3000},canteen:{name:'Canteen / break room',capacity:4,w:3200,h:3200},kitchenette:{name:'Kitchenette',capacity:2,w:3200,h:3000},print:{name:'Print / copy area',capacity:0,w:3000,h:2500},storage:{name:'Storage room',capacity:0,w:3000,h:2500},it:{name:'IT / server room',capacity:0,w:3000,h:2500},lactation:{name:'Lactation room',capacity:1,w:3000,h:2700},video:{name:'Video meeting room',capacity:4},display:{name:'Visitor display / showroom',capacity:0,w:3200,h:3000},lockers:{name:'Lockers / mail area',capacity:0,w:3000,h:2500}};
function meetingSeatingPlan(seats,doorSide='south'){
  const count=Math.max(1,Math.min(30,Math.trunc(Number(seats)||1))),ends=Math.min(2,count),remaining=count-ends,nearCount=2*Math.floor(remaining/4),farCount=remaining-nearCount;
  const positions=(amount,clearCenter)=>{if(!amount)return [];if(amount%2){const half=(amount-1)/2;return [...Array.from({length:half},(_,i)=>-(i+1)*800),0,...Array.from({length:half},(_,i)=>(i+1)*800)]}const half=amount/2,first=clearCenter?800:400;return [...Array.from({length:half},(_,i)=>-(first+i*800)),...Array.from({length:half},(_,i)=>first+i*800)]};
  const near=positions(nearCount,true),far=positions(farCount,false),furthest=Math.max(0,...near.map(Math.abs),...far.map(Math.abs)),tableLength=Math.max(3600,2*(furthest+450)),turn=doorSide==='north'?180:doorSide==='east'?270:doorSide==='west'?90:0,horizontal=doorSide==='north'||doorSide==='south';
  return {count,ends,near,far,tableLength,turn,w:horizontal?tableLength+2000:3000,h:horizontal?3000:tableLength+2000};
}
function roomSpec(kind,seats=6,doorSide='south',sizeVariant='standard'){
  let standard;if(['meeting','huddle','training','video'].includes(kind)){const plan=meetingSeatingPlan(seats,doorSide);standard={w:plan.w,h:plan.h}}
  else if(kind==='office'||kind==='focus')standard={w:3000,h:3000};
  else{const spec=extraRoomSpecs[kind],w=spec?.w||3200,h=spec?.h||3000;standard=['east','west'].includes(doorSide)?{w:h,h:w}:{w,h}}
  if(sizeVariant!=='compact')return standard;
  // Reduce the dimension parallel to the corridor. Furniture and door approaches still have to pass their own checks.
  const reduction=['meeting','huddle','training','video'].includes(kind)?300:600;
  return ['east','west'].includes(doorSide)?{w:standard.w,h:standard.h-reduction}:{w:standard.w-reduction,h:standard.h};
}
function meetingRoomFurniture(room){
  const bounds=rect(room),plan=meetingSeatingPlan(room.plannedSeats,room.door?.side),chairSpec=catalog.find(item=>item.kind==='meetingChair'),tableSpec=catalog.find(item=>item.kind==='meetingModular'),cx=bounds.x+bounds.w/2,cy=bounds.y+bounds.h/2,table={id:`${room.id}-table`,type:'furniture',kind:'meetingModular',sku:tableSpec.sku,catalogVersion:SAMPLE_CATALOG_VERSION,name:'Meeting table · concept',w:plan.tableLength,h:1000,z:tableSpec.height,price:Math.round(tableSpec.samplePrice*plan.tableLength/tableSpec.width),priceStatus:'illustrative',x:cx,y:cy,rot:plan.turn,roomId:room.id,derived:true};
  const seats=[...plan.far.map(x=>({x,y:-500,side:'north'})),...plan.near.map(x=>({x,y:500,side:'south'})),...(plan.ends? [{x:-plan.tableLength/2,y:0,side:'west'}]:[]),...(plan.ends>1?[{x:plan.tableLength/2,y:0,side:'east'}]:[])];
  const chairs=seats.map((seat,index)=>{const vector=seat.side==='north'?[0,-1]:seat.side==='south'?[0,1]:seat.side==='west'?[-1,0]:[1,0],p=rotateLocal(table,seat.x+vector[0]*350,seat.y+vector[1]*350);return {id:`${room.id}-chair-${index}`,type:'furniture',kind:'meetingChair',sku:chairSpec.sku,catalogVersion:SAMPLE_CATALOG_VERSION,name:chairSpec.name,w:chairSpec.width,h:chairSpec.depth,z:chairSpec.height,price:chairSpec.samplePrice,priceStatus:'illustrative',x:p.x,y:p.y,rot:plan.turn,roomId:room.id,derived:true,linkedTo:table.id}});
  const useZones=seats.map(seat=>seat.side==='north'?rotatedLocalBox(table,seat.x-300,seat.y-800,600,800):seat.side==='south'?rotatedLocalBox(table,seat.x-300,seat.y,600,800):seat.side==='west'?rotatedLocalBox(table,seat.x-800,seat.y-300,800,600):rotatedLocalBox(table,seat.x,seat.y-300,800,600));
  table.useZones=useZones;return [table,...chairs];
}
function meetingRoomFurnitureValid(room,project){
  if(!['meeting','huddle','training'].includes(room.kind))return true;if(room.extraKind&&(!extraRoomSpecs[room.extraKind]||(+room.plannedSeats||0)>extraRoomSpecs[room.extraKind].capacity))return false;const bounds=rect(room),items=roomDisplayFurniture(room),table=items[0],inside=area=>area.x>=bounds.x&&area.y>=bounds.y&&area.x+area.w<=bounds.x+bounds.w&&area.y+area.h<=bounds.y+bounds.h,door=room.door?.side,approach=door==='north'?{x:bounds.x+bounds.w/2-450,y:bounds.y,w:900,h:900}:door==='south'?{x:bounds.x+bounds.w/2-450,y:bounds.y+bounds.h-900,w:900,h:900}:door==='west'?{x:bounds.x,y:bounds.y+bounds.h/2-450,w:900,h:900}:{x:bounds.x+bounds.w-900,y:bounds.y+bounds.h/2-450,w:900,h:900};
  return items.length===Math.max(1,Number(room.plannedSeats)||1)+1&&items.every((item,index)=>{const area=furnitureRect(item);return inside(area)&&!overlap(area,approach)&&!items.some((other,j)=>j>index&&overlap(area,furnitureRect(other)))})&&table.useZones.every(area=>inside(area)&&!overlap(area,approach))&&!(project.furniture||[]).some(item=>overlap(bounds,furnitureRect(item)));
}
function roomFurnitureBase(room){
  if(['meeting','huddle','training'].includes(room.kind))return meetingRoomFurniture(room);
  if(!['office','pantry','focus','collaboration','waiting','canteen','kitchenette','print','storage','it','lactation','video','display','lockers'].includes(room.kind))return [];
  const bounds=rect(room),side=room.door?.side,turn=side==='north'?180:side==='east'?270:side==='west'?90:0,anchor={x:bounds.x+bounds.w/2,y:bounds.y+bounds.h/2,rot:turn};
  const item=(kind,key,x,y)=>{const spec=catalog.find(c=>c.kind===kind),point=rotateLocal(anchor,x,y);return {id:`${room.id}-${key}`,type:'furniture',kind,sku:spec.sku,catalogVersion:SAMPLE_CATALOG_VERSION,name:spec.name,w:spec.width,h:spec.depth,z:spec.height,price:spec.samplePrice,priceStatus:'illustrative',x:point.x,y:point.y,rot:turn,roomId:room.id,derived:true}};
  if(room.kind==='video')return [...meetingRoomFurniture(room),item('videoScreen','screen',0,-1400)];
  if(['office','focus'].includes(room.kind)){const desk=item(room.kind==='office'?'manager':'desk','desk',0,-850),chair=chairItems(desk)[0];chair.roomId=room.id;chair.derived=true;desk.useZones=chairUseZones(desk);return [desk,chair]}
  if(['pantry','kitchenette'].includes(room.kind)){const counter=item('pantryCounter','counter',0,-1150),table=item('pantryTable','table',0,-100),chairs=[item('diningChair','chair-0',-850,-100),item('diningChair','chair-1',850,-100)];chairs.forEach(chair=>chair.linkedTo=table.id);table.useZones=[rotatedLocalBox(table,-1300,-300,800,600),rotatedLocalBox(table,500,-300,800,600)];return [counter,table,...chairs]}
  if(['collaboration','waiting'].includes(room.kind))return [item('lounge2','seating',0,-400)];
  if(room.kind==='canteen')return [item('dining4','seating',0,-450)];
  if(room.kind==='print')return [item('printer','printer',-650,-900),item('cabinet','supplies',650,-900)];
  if(room.kind==='storage')return [item('shelf','shelf-0',-700,-850),item('shelf','shelf-1',700,-850)];
  if(room.kind==='it')return [item('serverRack','rack-0',-650,-850),item('serverRack','rack-1',650,-850)];
  if(room.kind==='display')return [item('displayPlinth','display-0',-650,-850),item('displayPlinth','display-1',650,-850)];
  if(room.kind==='lockers')return [item('locker','locker-0',-650,-850),item('locker','locker-1',650,-850)];
  return [item('lactationChair','chair',-500,-550),item('sideTable','table',600,-550)];
}
function roomFurniture(room){
  const bounds=rect(room),cx=bounds.x+bounds.w/2,cy=bounds.y+bounds.h/2,mode=room.furnitureLayout||'base',
    dx=room.furnitureShift?.dx||0,dy=room.furnitureShift?.dy||0,
    point=(x,y)=>{const px=x-cx,py=y-cy;return mode==='rotate_cw'?{x:cx-py,y:cy+px}:
      mode==='rotate_180'?{x:cx-px,y:cy-py}:mode==='rotate_ccw'?{x:cx+py,y:cy-px}:
      mode==='mirror_x'?{x:cx-px,y}:mode==='mirror_y'?{x,y:cy-py}:{x,y}},
    turn=rot=>{const value=mode==='rotate_cw'?rot+90:mode==='rotate_180'?rot+180:
      mode==='rotate_ccw'?rot+270:mode==='mirror_x'?180-rot:mode==='mirror_y'?-rot:rot;return ((value%360)+360)%360},
    box=area=>{const corners=[[area.x,area.y],[area.x+area.w,area.y],[area.x,area.y+area.h],[area.x+area.w,area.y+area.h]].map(([x,y])=>point(x,y)),xs=corners.map(p=>p.x),ys=corners.map(p=>p.y);return {...area,x:Math.min(...xs)+dx,y:Math.min(...ys)+dy,w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)}};
  return roomFurnitureBase(room).map(item=>{const moved=point(item.x,item.y);return {...item,x:moved.x+dx,y:moved.y+dy,rot:turn(item.rot||0),
    ...(item.useZones?{useZones:item.useZones.map(box)}:{})}});
}
function roomDisplayFurniture(room){
  const offsets=room.furnitureItemOffsets||{},rotations=room.furnitureItemRotations||{},turnBox=(zone,item,offset,turn)=>{
    const angle=((turn%360)+360)%360,corners=[[zone.x,zone.y],[zone.x+zone.w,zone.y],[zone.x,zone.y+zone.h],[zone.x+zone.w,zone.y+zone.h]]
      .map(([x,y])=>{const px=x-item.x,py=y-item.y,point=angle===90?{x:-py,y:px}:angle===180?{x:-px,y:-py}:
        angle===270?{x:py,y:-px}:{x:px,y:py};return {x:item.x+offset.dx+point.x,y:item.y+offset.dy+point.y}}),
      xs=corners.map(point=>point.x),ys=corners.map(point=>point.y);
    return {...zone,x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)};
  };
  return roomFurniture(room).flatMap(compositeFurnitureItems).map(item=>{const offset=offsets[item.id]||{dx:0,dy:0},turn=rotations[item.id]||0;
    if(!offset.dx&&!offset.dy&&!turn)return item;return {...item,x:item.x+offset.dx,y:item.y+offset.dy,
      rot:((item.rot||0)+turn)%360,
      ...(item.useZones?{useZones:item.useZones.map(zone=>turnBox(zone,item,offset,turn))}:{})}});
}
function roomFurnitureValid(room,project){
  if(['meeting','huddle','training'].includes(room.kind))return meetingRoomFurnitureValid(room,project);
  if(!['office','pantry','focus','collaboration','waiting','canteen','kitchenette','print','storage','it','lactation','video','display','lockers'].includes(room.kind))return true;
  if(room.extraKind&&(!extraRoomSpecs[room.extraKind]||(+room.plannedSeats||0)>extraRoomSpecs[room.extraKind].capacity))return false;
  const bounds=rect(room),groups=roomFurniture(room),items=roomDisplayFurniture(room),side=room.door?.side,inside=area=>area.x>=bounds.x&&area.y>=bounds.y&&area.x+area.w<=bounds.x+bounds.w&&area.y+area.h<=bounds.y+bounds.h;
  const approach=side==='north'?{x:bounds.x+bounds.w/2-450,y:bounds.y,w:900,h:900}:side==='south'?{x:bounds.x+bounds.w/2-450,y:bounds.y+bounds.h-900,w:900,h:900}:side==='west'?{x:bounds.x,y:bounds.y+bounds.h/2-450,w:900,h:900}:{x:bounds.x+bounds.w-900,y:bounds.y+bounds.h/2-450,w:900,h:900};
  const valid=(list,item,index)=>{const area=furnitureRect(item);return inside(area)&&!overlap(area,approach)&&!list.some((other,j)=>j>index&&overlap(area,furnitureRect(other)))&&(!item.useZones||item.useZones.every(zone=>inside(zone)&&!overlap(zone,approach)))};
  return groups.every((item,index)=>compositeMembersValid(item)&&valid(groups,item,index))&&items.every((item,index)=>valid(items,item,index))&&
    !(project.furniture||[]).some(item=>overlap(bounds,furnitureRect(item)));
}
function roomDoorPoint(o){const r=rect(o),side=o.door?.side;return {x:side==='west'?r.x:side==='east'?r.x+r.w:r.x+r.w/2,y:side==='north'?r.y:side==='south'?r.y+r.h:r.y+r.h/2}}
function roomHasCorridorAccess(o,objects){if(!o.door||!['north','south','east','west'].includes(o.door.side))return false;const point=roomDoorPoint(o);return objects.some(c=>{if(c.type!=='corridor')return false;const r=rect(c);return o.door.side==='north'?point.x>=r.x&&point.x<=r.x+r.w&&Math.abs(point.y-(r.y+r.h))<=50:o.door.side==='south'?point.x>=r.x&&point.x<=r.x+r.w&&Math.abs(point.y-r.y)<=50:o.door.side==='west'?point.y>=r.y&&point.y<=r.y+r.h&&Math.abs(point.x-(r.x+r.w))<=50:point.y>=r.y&&point.y<=r.y+r.h&&Math.abs(point.x-r.x)<=50})}
function placementRelation(kind,rule,role=''){const aliases=role==='executive'?['executive','ceo','总经理']:role==='director'?['director','总监']:kind==='reception'?['reception','前台','接待']:kind==='meeting'?['meeting','会议']:kind==='office'?['office','办公室']:kind==='workstation'?['workstation','desk','工位']:[];return (P.broker?.relations||[]).find(relation=>relation.rule===rule&&aliases.some(alias=>String(relation.from||'').toLowerCase().includes(alias)))||null}
function markerDistance(type,point){const box=point.x2==null?{x:point.x,y:point.y,w:0,h:0}:rect(point),center={x:box.x+box.w/2,y:box.y+box.h/2},markers=P.objects.filter(o=>o.type===type);return markers.length?Math.min(...markers.map(o=>Math.hypot(center.x-o.x,center.y-o.y))):null}
function placementScore(kind,point,role='',intent=null,spaceKey=''){let score=0;for(const [rule,type,defaultWeight] of [['entrance','door',kind==='reception'?1:0],['window','window',kind==='workstation'?0.25:0]]){const explicit=placementRelation(kind,rule,role)||role&&placementRelation('office',rule),weight=explicit?(explicit.priority==='must'?3:1.5):defaultWeight,metres=markerDistance(type,point);if(weight&&metres!=null)score-=weight*metres/1000}if(intent?.targetKey===spaceKey&&['near_entrance','near_window'].includes(intent.action)){const distance=markerDistance(intent.action==='near_window'?'window':'door',point);if(distance!=null)score-=10*distance/1000}return score}
function layoutSkeleton(pattern,shift={x:0,y:0}){
  const w=P.w,h=P.h,baseY=Math.round(h/2-600),baseX=Math.round(w/2-600),midY=Math.max(pattern==='core'?3500:3000,Math.min(h-(pattern==='core'?4500:4000),baseY+(shift.y||0))),midX=Math.max(3000,Math.min(w-4200,baseX+(shift.x||0)));
  if(P.broker?.fitOutMode==='as_is'){
    const fixedCorridor=P.objects.find(o=>o.type==='corridor'&&o.existing),edge=fixedCorridor?rect(fixedCorridor).y+rect(fixedCorridor).h:h/2+600,top=edge+300,bottom=h-600,left=600,right=w-600,middle=Math.round(w/2);
    const zone=(x0,x1,y0=top,y1=bottom)=>({x0,x1,y0,y1});
    const zones=pattern==='core'?[zone(left,middle-150),zone(middle+150,right)]:pattern==='perimeter'?[zone(left,right,top,bottom-700),zone(left,right,bottom-600,bottom)]:pattern==='neighborhood'?[zone(left,middle-150,top,bottom),zone(middle+150,right,top,bottom)]:[zone(left,right)];
    return {corridors:[],slots:[],zones:zones.filter(item=>item.x1>item.x0&&item.y1>item.y0)};
  }
  const corridor=(x,y,x2,y2,kind='main')=>({id:id(),type:'corridor',kind,x,y,x2,y2,generated:true});
  const slot=(x0,x1,y0,y1,side)=>({x0,x1,y0,y1,side});
  if(pattern==='core'){
    const top=midY-2700,bottom=midY+3900;
    return {corridors:[corridor(0,top,w,top+1200),corridor(0,bottom-1200,w,bottom),corridor(0,top,1200,bottom,'minor'),corridor(w-1200,top,w,bottom,'minor')],slots:[slot(1500,w-1500,top+1200,bottom-1200,'north'),slot(1500,w-1500,top+1200,bottom-1200,'south')],zones:[{x0:650,x1:w-650,y0:650,y1:top-250},{x0:650,x1:w-650,y0:bottom+250,y1:h-650}]};
  }
  if(pattern==='perimeter'){
    const roomsBottom=h>=11000,start=Math.max(3500,Math.min(roomsBottom?Math.min(6500,h-6000):h-4000,3500+(shift.y||0))),end=start+1200,corridors=[corridor(0,start,w,end)],slots=[slot(500,w-500,500,start,'south')],zones=[];
    if(roomsBottom){corridors.push(corridor(0,h-4700,w,h-3500,'minor'),corridor(0,end,1200,h-4700,'minor'),corridor(w-1200,end,w,h-4700,'minor'));slots.push(slot(500,w-500,h-3500,h-500,'north'));zones.push({x0:1450,x1:w-1450,y0:end+250,y1:h-4950})}
    else zones.push({x0:650,x1:w-650,y0:end+250,y1:h-650});
    return {corridors,slots,zones};
  }
  if(pattern==='neighborhood'){
    const corridors=[corridor(0,midY,w,midY+1200),corridor(midX,0,midX+1200,h,'minor')];
    const slots=[slot(500,midX,500,midY,'east'),slot(midX+1200,w-500,500,midY,'west')];
    if(h>=11000)slots.push(slot(500,midX,midY+1200,h-500,'east'),slot(midX+1200,w-500,midY+1200,h-500,'west'));
    const zones=[{x0:650,x1:midX-250,y0:650,y1:midY-250},{x0:midX+1450,x1:w-650,y0:650,y1:midY-250},{x0:650,x1:midX-250,y0:midY+1450,y1:h-650},{x0:midX+1450,x1:w-650,y0:midY+1450,y1:h-650}];
    return {corridors,slots,zones};
  }
  return {corridors:[corridor(0,midY,w,midY+1200)],slots:[slot(500,w-500,500,midY,'south')],zones:[{x0:650,x1:w-650,y0:650,y1:midY-250},{x0:650,x1:w-650,y0:midY+1450,y1:h-650}]};
}
function planRooms(objects,brief,slots,compactSpaceKey=null,intent=null){
  if(brief?.fitOutMode==='as_is')return;
  const existing=kind=>objects.filter(o=>o.type==='room'&&o.kind===kind&&!o.extraKind&&(kind!=='meeting'||o.plannedSeats>=brief.roomSeats)&&roomHasCorridorAccess(o,objects)&&rect(o).w>=roomSpec(kind,o.plannedSeats,o.door?.side,o.sizeVariant).w&&rect(o).h>=roomSpec(kind,o.plannedSeats,o.door?.side,o.sizeVariant).h&&roomFurnitureValid(o,{...P,objects,furniture:[]})).length;
  const officeNeeded=Math.max(0,Math.min(30,+brief.offices||0)-existing('office')),roles=brief.officeRoles||{},roleRequests=[...Array(Math.min(officeNeeded,+roles.executive||0)).fill({kind:'office',role:'executive',name:'Executive office'}),...Array(Math.min(Math.max(0,officeNeeded-(+roles.executive||0)),+roles.director||0)).fill({kind:'office',role:'director',name:'Director office'})];
  const requests=[...Array(Math.max(0,Math.min(10,+brief.meetingRooms||0)-existing('meeting'))).fill({kind:'meeting',seats:+brief.roomSeats||6}),...roleRequests,...Array(Math.max(0,officeNeeded-roleRequests.length)).fill({kind:'office'}),...(brief.pantry&&!existing('pantry')?[{kind:'pantry'}]:[])];
  for(const space of brief.requirements?.spaces?.filter(s=>s.origin==='extra')||[]){const spec=extraRoomSpecs[space.kind],requested=+space.seats||0,seats=requested||(space.kind==='meeting'?6:space.kind==='huddle'||space.kind==='video'?4:space.kind==='training'?8:spec?.capacity||0);if(!spec||seats>spec.capacity)continue;for(let n=0;n<Math.min(30,+space.count||0);n++)requests.push({kind:space.kind,name:spec.name,seats,extraKind:space.kind,requirementId:space.id})}
  const requestCounts=new Map();for(const request of requests){request.requirementId=request.requirementId||`base-${request.kind}`;const count=requestCounts.get(request.requirementId)||0;request.spaceKey=`${request.requirementId}:${count}`;requestCounts.set(request.requirementId,count+1)}
  for(const request of requests){
    const {kind,role}=request;
    const candidates=[];
    for(const slot of slots){
      const sizeVariant=request.spaceKey===compactSpaceKey?'compact':'standard',{w,h}=roomSpec(kind,request.seats||0,slot.side,sizeVariant);
      const horizontal=['north','south'].includes(slot.side),fixed=horizontal?slot.side==='north'?slot.y0:slot.y1-h:slot.side==='west'?slot.x0:slot.x1-w;
      const start=horizontal?slot.x0:slot.y0,end=horizontal?slot.x1-w:slot.y1-h;
      for(let p=start;p<=end;p+=250){
        const x=horizontal?p:fixed,y=horizontal?fixed:p,side=slot.side;
        const candidate={id:id(),type:'room',kind,role:role||null,name:request.name||roomNames[kind],plannedSeats:request.seats||0,extraKind:request.extraKind||null,requirementId:request.requirementId,spaceKey:request.spaceKey,sizeVariant,x,y,x2:x+w,y2:y+h,door:{side,width:900},conceptOnly:true,generated:true};
        const area=rect(candidate);
        if(!inSite(area)||!roomHasCorridorAccess(candidate,objects)||objects.some(o=>['column','blocked','corridor','room'].includes(o.type)&&overlap(area,rect(o)))||!roomFurnitureValid(candidate,{...P,objects,furniture:[]}))continue;
        candidates.push(candidate);
      }
    }
    candidates.sort((a,b)=>placementScore(kind,b,role,intent,request.spaceKey)-placementScore(kind,a,role,intent,request.spaceKey)||a.y-b.y||a.x-b.x);
    if(candidates.length)objects.push(candidates[0]);
  }
}
const sharedZoneSpecs={reception:{name:'Reception',w:3200,h:2800,kind:'reception',capacity:1},coffee:{name:'Coffee bar',w:3000,h:2800,kind:'coffeeBar',capacity:1},dining:{name:'Dining area',w:3000,h:2800,kind:'dining4',capacity:4},lounge:{name:'Lounge',w:3000,h:2600,kind:'lounge2',capacity:2}};
const compactSharedZoneSpecs={reception:{w:2800,h:2600,itemY:-150},coffee:{w:2600,h:2400,itemY:-250},dining:{w:2600,h:2400,itemY:0},lounge:{w:2600,h:2200,itemY:0}};
function sharedZoneSize(kind,sizeVariant='standard'){const spec=sharedZoneSpecs[kind];if(!spec)return null;return sizeVariant==='compact'?compactSharedZoneSpecs[kind]:{w:spec.w,h:spec.h,itemY:0}}
function spaceConstraint(brief,requirementId,kind,seats=0,doorSide='south'){
  const requirement=brief?.requirements?.spaces?.find(space=>space.id===requirementId),shared=sharedZoneSpecs[kind],fixedFootprint=kind==='workstation'?{w:1600,h:1600}:kind==='phone'?{w:1200,h:1200}:null,capacity=Number(seats)||shared?.capacity||({workstation:1,phone:1,office:1,focus:1,pantry:2,kitchenette:2,waiting:2,collaboration:2,canteen:4}[kind]??extraRoomSpecs[kind]?.capacity??0),targetFootprint=shared?sharedZoneSize(kind):fixedFootprint||roomSpec(kind,seats,doorSide),minimumFootprint=shared?sharedZoneSize(kind,'compact'):fixedFootprint||roomSpec(kind,seats,doorSide,'compact');
  const sample=targetFootprint&&!shared&&!fixedFootprint?{id:'sample-space',type:'room',kind,plannedSeats:seats,x:0,y:0,x2:targetFootprint.w,y2:targetFootprint.h,door:{side:doorSide}}:null;
  const requiredFurniture=shared?[shared.kind]:fixedFootprint?kind==='workstation'?['workstation desk or cubicle','task chair']:['phone']:sample?[...new Set(roomFurniture(sample).map(item=>item.kind))]:[];
  const mode=['workstation','phone'].includes(kind)||brief?.requirements?.spaceSizing?.[requirementId]?.mode==='fixed'?'fixed':'suggest';
  return {requirementId,kind,required:requirement?.priority!=='preferred',minimumCapacity:capacity,targetCapacity:capacity,requiredFurniture,targetFootprint,minimumFootprint,mode};
}
function zoneHasCorridorAccess(zone,objects){const a=rect(zone);return objects.some(o=>{if(o.type!=='corridor')return false;const b=rect(o);return ((Math.abs(a.y-(b.y+b.h))<=50||Math.abs(a.y+a.h-b.y)<=50)&&a.x<b.x+b.w&&a.x+a.w>b.x)||((Math.abs(a.x-(b.x+b.w))<=50||Math.abs(a.x+a.w-b.x)<=50)&&a.y<b.y+b.h&&a.y+a.h>b.y)})}
function validSharedZone(zone,objects,furniture){const area=rect(zone),spec=sharedZoneSpecs[zone.kind],minimum=sharedZoneSize(zone.kind,zone.sizeVariant),item=furniture.find(f=>f.zoneId===zone.id&&f.kind===spec?.kind);if(!spec||!item||!inSite(area)||area.w<minimum.w||area.h<minimum.h||!zoneHasCorridorAccess(zone,objects))return false;const inside=box=>box.x>=area.x&&box.y>=area.y&&box.x+box.w<=area.x+area.w&&box.y+box.h<=area.y+area.h;if(!compositeMembersValid(item)||!occupiedFurnitureRects(item).every(inside))return false;return !objects.some(o=>o.id!==zone.id&&['column','blocked','corridor','room','zone'].includes(o.type)&&overlap(area,rect(o)))&&!furniture.some(f=>f.id!==item.id&&overlap(area,furnitureRect(f)))}
function planSharedZones(objects,brief,furniture,compactSpaceKey=null,intent=null){
  const requests=[...(brief.reception?['reception']:[]),...(brief.coffeeBar?['coffee']:[]),...Array(Math.min(10,Math.ceil(Math.max(0,+brief.diningSeats||0)/4))).fill('dining'),...Array(Math.min(10,Math.ceil(Math.max(0,+brief.loungeSeats||0)/2))).fill('lounge')];
  const requestCounts=new Map();for(const kind of requests){const spec=sharedZoneSpecs[kind],count=requestCounts.get(kind)||0,spaceKey=`base-${kind}:${count}`,sizeVariant=spaceKey===compactSpaceKey?'compact':'standard',size=sharedZoneSize(kind,sizeVariant),candidates=[];requestCounts.set(kind,count+1);
    for(const corridor of objects.filter(o=>o.type==='corridor')){
      const c=rect(corridor),horizontal=c.w>=c.h,edges=horizontal?[{axis:'x',fixed:c.y-size.h},{axis:'x',fixed:c.y+c.h}]:[{axis:'y',fixed:c.x-size.w},{axis:'y',fixed:c.x+c.w}];
      for(const edge of edges){const start=horizontal?Math.max(300,c.x+300):Math.max(300,c.y+300),end=horizontal?Math.min(P.w-size.w-300,c.x+c.w-size.w-300):Math.min(P.h-size.h-300,c.y+c.h-size.h-300);
        for(let p=start;p<=end;p+=250){const x=horizontal?p:edge.fixed,y=horizontal?edge.fixed:p,zone={id:id(),type:'zone',kind,name:spec.name,capacity:spec.capacity,requirementId:`base-${kind}`,spaceKey,sizeVariant,x,y,x2:x+size.w,y2:y+size.h,generated:true,conceptOnly:true},area=rect(zone);
          if(!inSite(area)||!zoneHasCorridorAccess(zone,objects)||objects.some(o=>['column','blocked','corridor','room','zone'].includes(o.type)&&overlap(area,rect(o)))||furniture.some(f=>overlap(area,furnitureRect(f))))continue;
          const item=makeFurniture(spec.kind,x+size.w/2,y+size.h/2+(size.itemY||0));if(!canPlaceFurniture(item,furniture,objects))continue;item.zoneId=zone.id;if(!validSharedZone(zone,[...objects,zone],[...furniture,item]))continue;candidates.push({zone,item});
        }
      }
    }
    candidates.sort((a,b)=>placementScore(kind,b.zone,'',intent,spaceKey)-placementScore(kind,a.zone,'',intent,spaceKey)||a.zone.y-b.zone.y||a.zone.x-b.zone.x);
    if(candidates.length){objects.push(candidates[0].zone);furniture.push(candidates[0].item)}
  }
}
function conceptAtShift(pattern,people,meetingSeats,phoneCount,style,shift,options={}){
  const sourceObjects=options.sourceObjects||P.objects,structural=sourceObjects.filter(o=>['wall','door','window','exit','column','blocked','partition'].includes(o.type)||(o.type==='room'&&!o.generated)).map(o=>({...o}));
  const layout=layoutSkeleton(pattern,shift),markedCorridors=sourceObjects.filter(o=>o.type==='corridor'&&!o.generated).map(o=>({...o}));
  const objects=[...structural,...markedCorridors,...layout.corridors],furniture=[],zones=layout.zones;
  if(P.broker){planRooms(objects,P.broker,layout.slots,options.compactSpaceKey,options.intent);planSharedZones(objects,P.broker,furniture,options.compactSpaceKey,options.intent)}
  const meetings=P.broker?0:Math.ceil(meetingSeats/6);
  for(let i=0;i<meetings;i++){const x=P.w-2400-i*3900,y=i%2?2200:P.h-2200;putIfFree('meeting',x,y,furniture,objects)}
  for(let i=0;i<phoneCount;i++){const x=1000+i*1450,y=P.h-1500;putIfFree('phone',x,y,furniture,objects)}
  const stationKind=style==='private'?'cubicle':'desk',{seats,workAreas}=planWorkAreas(stationKind,people,zones,furniture,objects,P.broker,options.intent);
  const names=P.broker?.fitOutMode==='as_is'?{spine:['Open floor','Furniture in the available open area'],core:['Split teams','Furniture grouped into two work areas'],perimeter:['Loose fit','More open floor kept between furniture groups'],neighborhood:['Team groups','Separate desk clusters within the existing shell']}:{spine:['Central spine','One main aisle with rooms and desks on either side'],core:['Central room core','Enclosed rooms in a central band; desks near the perimeter'],perimeter:['Perimeter rooms','Enclosed rooms at the edge; shared work area in the middle'],neighborhood:['Team neighborhoods','Cross-aisle divides desks into four team zones']};
  const sharedZones=kind=>objects.filter(o=>o.type==='zone'&&o.kind===kind);
  const draft={id:id(),label:names[pattern][0],purpose:names[pattern][1],layoutPattern:pattern,stationStyle:style,corridorShift:{x:shift.x||0,y:shift.y||0},objects,furniture,workAreas,meta:{requested:people,seats,meetings:P.broker?objects.filter(o=>o.type==='room'&&o.kind==='meeting'&&!o.extraKind).length:furniture.filter(f=>f.kind==='meeting').length*6,offices:objects.filter(o=>o.type==='room'&&o.kind==='office'&&!o.extraKind).length,pantries:objects.filter(o=>o.type==='room'&&o.kind==='pantry'&&!o.extraKind).length,phones:furniture.filter(f=>f.kind==='phone').length,diningSeats:sharedZones('dining').reduce((n,z)=>n+z.capacity,0),loungeSeats:sharedZones('lounge').reduce((n,z)=>n+z.capacity,0),coffeeBars:sharedZones('coffee').length,receptions:sharedZones('reception').length}};
  draft.access=accessReview({...P,objects,furniture});return draft;
}
function corridorVariants(pattern){if(P.objects.some(o=>o.type==='corridor'&&!o.generated))return [{x:0,y:0}];return pattern==='neighborhood'?[{x:0,y:0},{x:-1000,y:0},{x:1000,y:0},{x:0,y:-1000},{x:0,y:1000}]:[{x:0,y:0},{x:0,y:-1000},{x:0,y:1000}]}
function concept(pattern,people,meetingSeats,phoneCount,style){const mode=style==='private'?'private':P.broker?.mode||'hybrid',variants=corridorVariants(pattern).map(shift=>conceptAtShift(pattern,people,meetingSeats,phoneCount,style,shift));variants.sort((a,b)=>draftScore(a,P.broker,mode)-draftScore(b,P.broker,mode)||Math.abs(a.corridorShift.x)+Math.abs(a.corridorShift.y)-Math.abs(b.corridorShift.x)-Math.abs(b.corridorShift.y));return variants[0]}
function draftScore(d,brief,mode){const m=d.meta,roomGap=brief?Math.max(0,brief.meetingRooms-m.meetings)+Math.max(0,brief.offices-m.offices)+Math.max(0,(brief.pantry?1:0)-m.pantries):0,extraGap=brief?(brief.requirements?.spaces||[]).filter(s=>s.origin==='extra'&&s.priority!=='preferred').reduce((n,s)=>n+Math.max(0,s.count-d.objects.filter(o=>o.type==='room'&&o.requirementId===s.id&&(!s.seats||o.plannedSeats>=s.seats)).length),0):0,seatGap=Math.max(0,m.requested-m.seats),phoneGap=Math.max(0,(brief?.phones??0)-m.phones),sharedGap=brief?Math.max(0,(+brief.diningSeats||0)-m.diningSeats)+Math.max(0,(+brief.loungeSeats||0)-m.loungeSeats)+4*Math.max(0,(brief.coffeeBar?1:0)-m.coffeeBars)+4*Math.max(0,(brief.reception?1:0)-m.receptions):0,preference=mode==='private'&&d.layoutPattern==='perimeter'?15:mode==='open'&&d.layoutPattern==='spine'?15:mode==='hybrid'&&d.layoutPattern==='neighborhood'?15:0,project={...P,objects:d.objects,furniture:d.furniture,workAreas:d.workAreas||[],drafts:[d]},areaGaps=(brief?.requirements?.workAreas||[]).reduce((score,area)=>{const placed=workAreaSeatsForAssessment(project,area.id);return score+Math.max(0,area.targetDesks-placed)*12+Math.max(0,area.minimumDesks-placed)*65},0),placement=brief&&typeof evaluatePlacementRules==='function'?evaluatePlacementRules(project,brief).filter(Boolean):[],hardPlacementGap=placement.filter(r=>r.priority==='must'&&r.status==='fail').length,access=d.access||accessReview(project),accessGap=(access.exitConnected?0:2)+access.unreachableRooms.length+access.unreachableZones.length+access.unreachableIslands.length;return (roomGap+extraGap)*120+seatGap*10+areaGaps+phoneGap*50+sharedGap*20+hardPlacementGap*100+accessGap*60-preference}
function generateDrafts(){
  if(readOnly)return;
  const readiness=siteReadiness();
  if(!readiness.ready){$('#hint').textContent=readiness.recognitionPending?'Use the dimension-based fallback or complete assisted import before generating concepts.':'Mark at least one entrance and one emergency exit before generating concepts.';render();return}
  const people=Math.max(4,+$('#briefPeople').value||36),meeting=Math.max(0,+$('#briefMeeting').value||0),phone=Math.max(0,+$('#briefPhone').value||0),mode=$('#briefMode').value;
  const patterns=['spine','core','perimeter','neighborhood'];
  snapshot();comparisonCollapsed=false;mobileCompareExpanded=false;proposalDisclosure.open=false;roomReuseDisclosure.open=false;
  P.site.confirmed=true;P.site.confirmedAt=new Date().toISOString();P.draftsStale=false;P.spaceProposals=[];P.roomReuseProposals=[];P.acceptedAdjustment=null;P.acceptedRoomReuse=null;P.manualSpaceEdit=null;P.zoneAssist=null;P.zoneAssistHistory=[];previewProposalId=null;roomReusePreviewId=null;
  const candidates=patterns.map(pattern=>concept(pattern,people,meeting,phone,mode==='private'?'private':'hybrid'));
  candidates.sort((a,b)=>draftScore(a,P.broker,mode)-draftScore(b,P.broker,mode)||patterns.indexOf(a.layoutPattern)-patterns.indexOf(b.layoutPattern));
  P.drafts=candidates.slice(0,3);applyDraft(P.drafts[0].id,false);P.spaceProposals=buildSpaceProposals(P.drafts[0]);P.roomReuseProposals=buildRoomReuseProposals(P.drafts[0]);save();
}
function applyDraft(draftId,keepHistory=true){const d=(P.drafts||[]).find(x=>x.id===draftId);if(!d)return;if(keepHistory)snapshot();P.objects=JSON.parse(JSON.stringify(d.objects));P.furniture=JSON.parse(JSON.stringify(d.furniture));P.productBindings=[];P.productProfiles={};P.derivedProducts={};P.setSelections=[];P.demoPackageChoice=null;P.demoQuote=null;P.demoOrder=null;P.workAreas=JSON.parse(JSON.stringify(d.workAreas||[]));P.activeDraft=d.id;P.acceptedAdjustment=null;P.acceptedRoomReuse=null;P.roomReuseProposals=[];P.manualSpaceEdit=null;P.zoneAssist=null;P.zoneAssistHistory=[];previewProposalId=null;roomReusePreviewId=null;selected=null;focusedIssue=null;focusedProductId=null;editGuideIssue=null;render()}
function setTool(){document.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===tool));document.querySelectorAll('[data-setup-tool]').forEach(b=>{const active=b.dataset.setupTool===tool;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active))});const wallPlacement=['door','exit'].includes(tool),hint=$('#hint');hint.classList.toggle('guided-placement',wallPlacement&&!readOnly);hint.textContent=tool==='select'?'Scroll to zoom · Hold Space to pan · Drag objects to move':tool==='door'?'Entrance selected — click the correct exterior wall to place it.':tool==='exit'?'Exit selected — click the correct exterior wall to place it.':`${typeName[tool]||'Furniture'}: ${tool==='window'?'click near a wall to place':'drag on the plan to create'}`}
function lineHit(a,b,x,y){const dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy||1,t=Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/l));return Math.hypot(x-(a.x+t*dx),y-(a.y+t*dy))<180}
function hit(x,y){for(const f of [...P.furniture].reverse())if(overlap({x,y,w:1,h:1},furnitureRect(f))||chairItems(f).some(chair=>overlap({x,y,w:1,h:1},furnitureRect(chair))))return f;for(const o of [...P.objects].reverse()){if(['wall','partition'].includes(o.type)&&lineHit(o,{x:o.x2,y:o.y2},x,y))return o;if(!['wall','partition','door','window','exit'].includes(o.type)){let r=rect(o);if(overlap({x,y,w:1,h:1},r))return o}if(['door','window','exit'].includes(o.type)&&Math.hypot(x-o.x,y-o.y)<280)return o}for(const area of [...(P.workAreas||[])].reverse())if(!area.generic&&[area.x,area.y,area.x2,area.y2].every(Number.isFinite)&&overlap({x,y,w:1,h:1},rect(area)))return area;return null}
function hitDisplayFurniture(x,y){return [...allDisplayFurniture(P.furniture,P.objects,P.derivedProducts)].reverse().find(item=>overlap({x,y,w:1,h:1},furnitureRect(item)))||null}
function drawLine(o,color,width=3,dash=[]){const [a,b]=[screen(o.x,o.y),screen(o.x2,o.y2)];ctx.save();ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(dash);ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();ctx.restore()}
const WORK_AREA_COLORS=[{fill:'rgba(16,185,129,.1)',line:'#047857',desk:'#a7f3d0'},{fill:'rgba(245,158,11,.1)',line:'#b45309',desk:'#fde68a'},{fill:'rgba(168,85,247,.1)',line:'#7e22ce',desk:'#e9d5ff'}];
function workAreaColor(workAreaId,areas=P.workAreas){const index=(areas||[]).filter(area=>!area.generic).findIndex(area=>area.id===workAreaId);return index<0?null:WORK_AREA_COLORS[index%WORK_AREA_COLORS.length]}
function drawWorkAreaOverlay(){for(const area of P.workAreas||[]){const color=workAreaColor(area.id);if(!color||![area.x,area.y,area.x2,area.y2].every(Number.isFinite))continue;const r=rect(area),[x,y]=screen(r.x,r.y);ctx.save();ctx.fillStyle=color.fill;ctx.strokeStyle=color.line;ctx.lineWidth=1.5;ctx.setLineDash([6,5]);ctx.fillRect(x,y,r.w*V.scale,r.h*V.scale);ctx.strokeRect(x,y,r.w*V.scale,r.h*V.scale);ctx.restore()}}
function drawWorkAreaLabels(){for(const area of P.workAreas||[]){const color=workAreaColor(area.id);if(!color||![area.x,area.y,area.x2,area.y2].every(Number.isFinite))continue;const r=rect(area),[x,y]=screen(r.x,r.y),label=`${area.name} · ${workAreaSeatsForAssessment(P,area.id)}/${area.targetDesks}`;ctx.save();ctx.font='600 11px system-ui';const labelWidth=Math.min(r.w*V.scale-8,ctx.measureText(label).width+10);if(labelWidth>45&&r.h*V.scale>24){ctx.fillStyle='rgba(255,255,255,.94)';ctx.fillRect(x+3,y+3,labelWidth,17);ctx.fillStyle=color.line;ctx.textAlign='left';ctx.fillText(label,x+7,y+15,labelWidth-8)}ctx.restore()}}
function drawRoom2d(o){const r=rect(o),[x,y]=screen(r.x,r.y),w=r.w*V.scale,h=r.h*V.scale,colors={meeting:['#ecfdf5','#047857'],office:['#f5f3ff','#6d28d9'],pantry:['#fff7ed','#c2410c']},[fill,line]=colors[o.kind]||['#f8fafc','#475569'];ctx.save();ctx.fillStyle=fill;ctx.fillRect(x,y,w,h);ctx.strokeStyle=line;ctx.lineWidth=o.id===selected?4:3;ctx.strokeRect(x,y,w,h);ctx.fillStyle=line;ctx.font='600 12px system-ui';ctx.textAlign='center';const fullLabel=o.name||roomNames[o.kind]||'Room',shortLabel={meeting:'Meeting',office:'Office',pantry:'Pantry',huddle:'Huddle',focus:'Focus',training:'Training',collaboration:'Collab',waiting:'Waiting',canteen:'Canteen',kitchenette:'Kitchen',print:'Print',storage:'Storage',it:'IT',lactation:'Private',video:'Video',display:'Display',lockers:'Lockers'}[o.kind]||'Room',label=ctx.measureText(fullLabel).width+12<=w?fullLabel:ctx.measureText(shortLabel).width+8<=w?shortLabel:'';if(label&&h>=24)ctx.fillText(label,x+w/2,y+h/2);if(o.door){const point=roomDoorPoint(o),[dx,dy]=screen(point.x,point.y),vertical=['east','west'].includes(o.door.side),gap=Math.min(900*V.scale,(vertical?h:w)*.5);ctx.strokeStyle=fill;ctx.lineWidth=7;ctx.beginPath();if(vertical){ctx.moveTo(dx,dy-gap/2);ctx.lineTo(dx,dy+gap/2)}else{ctx.moveTo(dx-gap/2,dy);ctx.lineTo(dx+gap/2,dy)}ctx.stroke();ctx.strokeStyle=line;ctx.lineWidth=2;ctx.beginPath();if(vertical){ctx.moveTo(dx,dy-gap/2);ctx.lineTo(dx+(o.door.side==='west'?gap/2:-gap/2),dy)}else{ctx.moveTo(dx-gap/2,dy);ctx.lineTo(dx,dy+(o.door.side==='north'?gap/2:-gap/2))}ctx.stroke()}ctx.restore()}
function draw2d(){ctx.clearRect(0,0,cv.width,cv.height);ctx.save();ctx.fillStyle='#e9eef3';ctx.fillRect(0,0,cv.clientWidth,cv.clientHeight);const [sx,sy]=screen(0,0),[ex,ey]=screen(P.w,P.h);ctx.fillStyle='#fff';ctx.fillRect(sx,sy,ex-sx,ey-sy);const planImage=sourceUnderlay();if(planImage?.complete&&planImage.naturalWidth){ctx.save();ctx.globalAlpha=.28;ctx.drawImage(planImage,sx,sy,ex-sx,ey-sy);ctx.restore()}ctx.strokeStyle='#d7dde5';ctx.lineWidth=1;const grid=1000;for(let x=0;x<=P.w;x+=grid){let [a,b]=[screen(x,0),screen(x,P.h)];ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke()}for(let y=0;y<=P.h;y+=grid){let [a,b]=[screen(0,y),screen(P.w,y)];ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke()}
drawWorkAreaOverlay();
for(const o of P.objects){if(['wall','partition'].includes(o.type))drawLine(o,o.type==='wall'?'#263238':'#64748b',o.type==='wall'?6:3,o.type==='partition'?[8,5]:[]);else if(['door','window','exit'].includes(o.type)){const [x,y]=screen(o.x,o.y),isEdgeMarker=o.type==='door'||o.type==='exit',label=o.type==='door'?'Entrance':o.type==='exit'?'Exit':'';ctx.save();ctx.translate(x,y);ctx.fillStyle=o.type==='exit'?'#15803d':o.type==='door'?'#b45309':'#0284c7';ctx.fillRect(-8,-8,16,16);if(isEdgeMarker){ctx.font='600 12px system-ui';ctx.textBaseline='middle';const onLeft=o.x<P.w*.1,onRight=o.x>P.w*.9,onTop=o.y<P.h*.1;ctx.textAlign=onLeft?'left':onRight?'right':'center';ctx.fillText(label,onLeft?13:onRight?-13:0,onLeft||onRight?0:onTop?18:-18)}ctx.restore()}else{const r=rect(o),[x,y]=screen(r.x,r.y),shared=o.type==='zone',zoneColors={dining:['rgba(251,191,36,.2)','#b45309'],lounge:['rgba(244,114,182,.2)','#be185d'],coffee:['rgba(167,139,250,.2)','#6d28d9'],reception:['rgba(45,212,191,.2)','#0f766e']};ctx.fillStyle=shared?(zoneColors[o.kind]?.[0]||'#f1f5f9'):o.type==='corridor'?'rgba(37,99,235,.15)':o.type==='blocked'?'rgba(220,38,38,.18)':'#94a3b8';ctx.strokeStyle=shared?(zoneColors[o.kind]?.[1]||'#475569'):o.type==='corridor'?'#2563eb':o.type==='blocked'?'#dc2626':'#475569';ctx.setLineDash(o.type==='corridor'?[8,4]:shared?[5,4]:[]);ctx.fillRect(x,y,r.w*V.scale,r.h*V.scale);ctx.strokeRect(x,y,r.w*V.scale,r.h*V.scale);ctx.setLineDash([]);if(shared){ctx.fillStyle=ctx.strokeStyle;ctx.font='600 11px system-ui';ctx.textAlign='center';ctx.fillText(o.name||'Shared area',x+r.w*V.scale/2,y+15)}}}
for(const o of P.objects.filter(o=>o.type==='room'))drawRoom2d(o);
const displayItems=allDisplayFurniture(P.furniture,P.objects,P.derivedProducts),{visuals:productVisuals}=sceneProductVisuals(displayItems);
for(const f of displayItems){const r=furnitureRect(f),[x,y]=screen(r.x,r.y),chair=['chair','meetingChair','diningChair','barStool'].includes(f.kind),workColor=workAreaColor(f.workAreaId),visual=productVisuals.get(f.id),productSpecific=visual?.productSpecific,active=f.id===focusedProductId||f.id===selected;ctx.save();ctx.translate(x+r.w*V.scale/2,y+r.h*V.scale/2);ctx.rotate((f.rot||0)*Math.PI/180);ctx.fillStyle=productSpecific?visual.plan.fill:chair?'#cbd5e1':f.id===selected?'#bfdbfe':workColor?.desk||'#dbeafe';ctx.strokeStyle=active?'#2563eb':productSpecific?visual.plan.stroke:chair?'#475569':workColor?.line||'#3b82f6';ctx.lineWidth=active?4:2;if(active){ctx.shadowColor='rgba(37,99,235,.35)';ctx.shadowBlur=9}if(chair){ctx.beginPath();ctx.arc(0,0,Math.max(3,Math.min(r.w,r.h)*V.scale*.4),0,Math.PI*2);ctx.fill();ctx.stroke()}else{ctx.fillRect(-r.w*V.scale/2,-r.h*V.scale/2,r.w*V.scale,r.h*V.scale);ctx.strokeRect(-r.w*V.scale/2,-r.h*V.scale/2,r.w*V.scale,r.h*V.scale);if(productSpecific&&r.h*V.scale>=12){ctx.fillStyle=visual.plan.accent;ctx.fillRect(-r.w*V.scale/2+2,-r.h*V.scale/2+2,Math.max(0,r.w*V.scale-4),Math.min(5,r.h*V.scale*.18))}}ctx.shadowBlur=0;ctx.fillStyle=productSpecific?visual.plan.label:'#1e3a8a';ctx.font='12px system-ui';ctx.textAlign='center';if(!chair&&r.w*V.scale>=Math.max(100,ctx.measureText(f.name).width+12)&&r.h*V.scale>=30)ctx.fillText(f.name,0,4);ctx.restore()}
for(const islandId of new Set(P.furniture.filter(f=>f.islandId).map(f=>f.islandId))){const members=P.furniture.filter(f=>f.islandId===islandId),r=islandEnvelope(members),[x,y]=screen(r.x,r.y),active=members.some(f=>f.id===selected),workColor=workAreaColor(members[0]?.workAreaId);ctx.save();ctx.strokeStyle=active?'#1d4ed8':workColor?.line||'#64748b';ctx.lineWidth=active?2:1;ctx.setLineDash([5,4]);ctx.strokeRect(x,y,r.w*V.scale,r.h*V.scale);ctx.setLineDash([]);ctx.fillStyle=active?'#1d4ed8':workColor?.line||'#475569';ctx.font='600 11px system-ui';ctx.textAlign='left';if(r.w*V.scale>48)ctx.fillText(`${members.length} seats`,x+4,y+13);ctx.restore()}
drawWorkAreaLabels();
if(selected){const o=find(selected);if(o&&o.type!=='furniture'){const r=rect(o);if(r.w&&r.h){const [x,y]=screen(r.x,r.y);ctx.strokeStyle='#2563eb';ctx.lineWidth=2;ctx.strokeRect(x-3,y-3,r.w*V.scale+6,r.h*V.scale+6)}}}
if(focusedIssue){ctx.save();ctx.strokeStyle='#dc2626';ctx.fillStyle='rgba(220,38,38,.12)';ctx.lineWidth=4;for(const r of issueTargetBoxes(focusedIssue.targetIds)){const [x,y]=screen(r.x,r.y),w=Math.max(14,r.w*V.scale),h=Math.max(14,r.h*V.scale);ctx.fillRect(x-5,y-5,w+10,h+10);ctx.strokeRect(x-5,y-5,w+10,h+10)}if(focusedIssue.point){const [x,y]=screen(focusedIssue.point.x,focusedIssue.point.y);ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(x,y,11,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.beginPath();ctx.moveTo(x-16,y);ctx.lineTo(x+16,y);ctx.moveTo(x,y-16);ctx.lineTo(x,y+16);ctx.stroke()}ctx.restore()}ctx.restore()}
function draw3d(){
  ctx.clearRect(0,0,cv.width,cv.height);ctx.fillStyle='#dbe5ef';ctx.fillRect(0,0,cv.clientWidth,cv.clientHeight);
  const r=cv.getBoundingClientRect(),s=Math.min((r.width-90)/P.w,(r.height-90)/P.h),ox=(r.width-P.w*s)/2,oy=(r.height-P.h*s)/2+20;
  const p=(x,y,z=0)=>[ox+(x-y)*s*.72+P.h*s*.36,oy+(x+y)*s*.28-z*s*.45];
  const poly=(points,fill,stroke='#64748b',width=1)=>{ctx.beginPath();points.forEach((v,i)=>i?ctx.lineTo(...v):ctx.moveTo(...v));ctx.closePath();ctx.fillStyle=fill;ctx.fill();ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke()};
  const displayItems=allDisplayFurniture(P.furniture,P.objects,P.derivedProducts).sort((a,b)=>a.x+a.y-b.x-b.y),sceneVisuals=sceneProductVisuals(displayItems),productVisuals=sceneVisuals.visuals;
  poly([p(0,0),p(P.w,0),p(P.w,P.h),p(0,P.h)],'#f8fafc');
  for(const o of P.objects.filter(o=>o.type==='zone')){const r=rect(o),fill={dining:'#fef3c7',lounge:'#fce7f3',coffee:'#ede9fe',reception:'#ccfbf1'}[o.kind]||'#e2e8f0';poly([p(r.x,r.y),p(r.x+r.w,r.y),p(r.x+r.w,r.y+r.h),p(r.x,r.y+r.h)],fill)}
  for(const o of P.objects.filter(o=>o.type==='room')){const r=rect(o),color=o.kind==='meeting'?'#047857':o.kind==='office'?'#6d28d9':'#c2410c',a=p(r.x,r.y),b=p(r.x+r.w,r.y),c=p(r.x+r.w,r.y+r.h),d=p(r.x,r.y+r.h);poly([a,b,c,d],o.kind==='meeting'?'#d1fae5':o.kind==='office'?'#ede9fe':'#ffedd5',color);ctx.strokeStyle=color;ctx.lineWidth=2;for(const [u,v] of [[a,p(r.x,r.y,2200)],[b,p(r.x+r.w,r.y,2200)],[c,p(r.x+r.w,r.y+r.h,2200)],[d,p(r.x,r.y+r.h,2200)]]){ctx.beginPath();ctx.moveTo(...u);ctx.lineTo(...v);ctx.stroke()}ctx.beginPath();[p(r.x,r.y,2200),p(r.x+r.w,r.y,2200),p(r.x+r.w,r.y+r.h,2200),p(r.x,r.y+r.h,2200),p(r.x,r.y,2200)].forEach((v,i)=>i?ctx.lineTo(...v):ctx.moveTo(...v));ctx.stroke()}
  for(const f of displayItems){
    const item=catalog.find(c=>c.kind===f.kind),visual=productVisuals.get(f.id),height=f.z||item?.height||700,turn=(f.rot||0)*Math.PI/180,active=f.id===focusedProductId||f.id===selected,edge=active?'#2563eb':'#64748b';
    const point=(u,v,z)=>{const x=(u-.5)*f.w,y=(v-.5)*f.h;return p(f.x+x*Math.cos(turn)-y*Math.sin(turn),f.y+x*Math.sin(turn)+y*Math.cos(turn),z*height)};
    for(const [material,x,y,z,w,d,h] of visual?.modelParts||item?.modelParts||[['metal',0,0,0,1,1,1]]){
      const a=point(x,y,z),b=point(x+w,y,z),c=point(x+w,y+d,z),e=point(x,y+d,z);
      const A=point(x,y,z+h),B=point(x+w,y,z+h),C=point(x+w,y+d,z+h),E=point(x,y+d,z+h),shade=visual?.materials?.[material]||visual?.materials?.metal||['#64748b','#475569','#94a3b8'];
      poly([a,b,B,A],shade[0],edge,active?2.4:1);poly([b,c,C,B],shade[1],edge,active?2.4:1);poly([A,B,C,E],shade[2],edge,active?2.4:1);
    }
  }
  for(const o of P.objects.filter(o=>['wall','partition'].includes(o.type))){const z=o.type==='wall'?3000:2400;ctx.strokeStyle=o.type==='wall'?'#334155':'#94a3b8';ctx.lineWidth=o.type==='wall'?4:2;ctx.beginPath();ctx.moveTo(...p(o.x,o.y,z));ctx.lineTo(...p(o.x2,o.y2,z));ctx.stroke()}
  ctx.fillStyle='#475569';ctx.font='13px system-ui';ctx.fillText(sceneVisuals.summary?.productVisualCount?`Product-aware demo finishes · ${sceneVisuals.summary.productVisualCount}/${sceneVisuals.summary.itemCount} items · illustrative geometry`:'Illustrative 3D models · Return to 2D to edit',18,25);
}
function find(i){return P.furniture.find(x=>x.id===i)||P.objects.find(x=>x.id===i)||(P.workAreas||[]).find(x=>x.id===i)}
function issueTargetBoxes(ids){const boxes=[],seenIslands=new Set();for(const targetId of ids||[]){const item=find(targetId);if(!item)continue;if(item.islandId){if(seenIslands.has(item.islandId))continue;seenIslands.add(item.islandId);boxes.push(islandEnvelope(P.furniture.filter(f=>f.islandId===item.islandId)))}else if(item.type==='furniture')boxes.push(furnitureRect(item));else if(item.x2!=null)boxes.push(rect(item));else boxes.push({x:item.x-250,y:item.y-250,w:500,h:500})}return boxes}
function focusCheckIssue(issue){const boxes=issueTargetBoxes(issue.targetIds);if(issue.point)boxes.push({x:issue.point.x-250,y:issue.point.y-250,w:500,h:500});if(!boxes.length)return;focusedIssue={key:issue.key,targetIds:issue.targetIds,point:issue.point};editGuideIssue={key:issue.key,baseline:JSON.stringify([P.objects,P.furniture])};selected=issue.targetIds.length===1?issue.targetIds[0]:null;tool='select';setTool();view='2d';document.querySelectorAll('[data-view]').forEach(button=>button.classList.toggle('active',button.dataset.view==='2d'));const x=Math.min(...boxes.map(box=>box.x)),y=Math.min(...boxes.map(box=>box.y)),right=Math.max(...boxes.map(box=>box.x+box.w)),bottom=Math.max(...boxes.map(box=>box.y+box.h)),width=cv.clientWidth,height=cv.clientHeight;V.scale=Math.max(.008,Math.min(.14,(width-90)/(right-x+1800),(height-90)/(bottom-y+1800)));V.x=width/2-(x+right)/2*V.scale;V.y=height/2-(y+bottom)/2*V.scale;render();cv.scrollIntoView({block:'nearest'});$('#hint').classList.add('issue-guidance');$('#hint').textContent=issue.key?.startsWith('aisle-')?'Highlighted narrow aisle · move the intruding object, then check whether the warning clears.':'Highlighted route issue · move the obstacle or affected object, then check whether the warning clears.'}
function renderEditGuide(issues){const panel=$('#editGuide');if(!P.drafts?.length)editGuideIssue=null;panel.hidden=!editGuideIssue;if(!editGuideIssue)return;const issue=issues.find(item=>item.key===editGuideIssue.key),stale=P.draftsStale,done=!issue&&!stale;panel.classList.toggle('done',done);$('#editGuideTitle').textContent=stale?'Site changed · update the layouts':done?'Issue cleared in this edited plan':'Fix this planning warning';$('#editGuideText').textContent=readOnly?'This shared snapshot is read-only. Ask the project owner to make a change.':stale?'A fixed site condition changed. Regenerate A / B / C before relying on this check.':done?'The warning is no longer detected. This edited plan is separate from the original A / B / C snapshots; review other warnings before sharing.':editGuideIssue.key.startsWith('aisle-')?'Drag the red-outlined object away from the marked pinch point. The aisle warning recalculates as you move it.':'The red outlines show affected locations, not necessarily the blocker. Inspect objects between them; use Edit plan if you need more controls.';$('#editGuideUndo').disabled=readOnly||!history.length||JSON.stringify([P.objects,P.furniture])===editGuideIssue.baseline}
function checks(){
  const issues=[];
  for(const f of P.furniture){const r=furnitureRect(f);if(!inSite(r))issues.push({level:'bad',text:`${f.name} extends beyond the site boundary`});for(const o of P.objects){if(['column','blocked','room'].includes(o.type)&&overlap(r,rect(o)))issues.push({level:'bad',text:`${f.name} overlaps ${o.type==='room'?o.name:typeName[o.type].toLowerCase()}`});if(o.type==='corridor'&&overlap(r,rect(o)))issues.push({level:'bad',text:`${f.name} blocks a corridor`});if(o.type==='zone'&&f.zoneId!==o.id&&overlap(r,rect(o)))issues.push({level:'bad',text:`${f.name} overlaps ${o.name}`})}for(const g of P.furniture)if(g.id>f.id&&overlap(r,furnitureRect(g)))issues.push({level:'bad',text:`${f.name} collides with ${g.name}`})}
  for(const f of P.furniture.filter(item=>chairSeats(item).length))if(!furnitureHasClearance(f,P))issues.push({level:'bad',text:`${f.name} chair or chair-use area is blocked; its seats need review`});
  for(const islandId of new Set(P.furniture.filter(f=>f.islandId).map(f=>f.islandId))){const member=P.furniture.find(f=>f.islandId===islandId);if(!islandSpacingValid(member,P))issues.push({level:'bad',text:`${member.islandSeats}-person workstation island needs space from another island, room or corridor`})}
  for(const room of P.objects.filter(o=>o.type==='room')){const r=rect(room),minimum=roomSpec(room.kind,room.plannedSeats,room.door?.side,room.sizeVariant);if(!inSite(r))issues.push({level:'bad',text:`${room.name} extends beyond the site boundary`});if(r.w<minimum.w||r.h<minimum.h)issues.push({level:'bad',text:`${room.name} is smaller than the MVP placeholder footprint`});if(!roomHasCorridorAccess(room,P.objects))issues.push({level:'bad',text:`${room.name} door does not connect to the marked corridor`});if(!roomFurnitureValid(room,P))issues.push({level:'bad',text:`${room.name} furniture, seating or door approach do not fit`});for(const o of P.objects)if(o.id!==room.id&&['column','blocked','corridor','room','zone'].includes(o.type)&&overlap(r,rect(o)))issues.push({level:'bad',text:`${room.name} overlaps ${o.type==='room'||o.type==='zone'?o.name:typeName[o.type].toLowerCase()}`})}
  for(const zone of P.objects.filter(o=>o.type==='zone'))if(!validSharedZone(zone,P.objects,P.furniture))issues.push({level:'bad',text:`${zone.name} zone or its furniture needs placement review`});
  for(const bottleneck of corridorBottlenecks(P))issues.push({level:'warn',key:`aisle-${bottleneck.corridorId}`,targetIds:bottleneck.sourceIds,point:bottleneck.point,text:`${bottleneck.kind==='main'?'Main':'Secondary'} aisle narrows to about ${bottleneck.clearance} mm; the project planning target is ${bottleneck.required} mm${bottleneck.sources.length?` near ${bottleneck.sources.slice(0,2).join(', ')}`:''}. Not a code-clearance finding.`});
  if(P.drafts?.length&&!P.draftsStale){const access=accessReview(P);if(access.status==='checked'){if(!access.exitConnected)issues.push({level:'bad',key:'route-exit',targetIds:P.objects.filter(o=>['door','exit'].includes(o.type)).map(o=>o.id),text:'No sampled open-floor route connects the marked entrance to an exit'});if(access.unreachableRooms.length)issues.push({level:'bad',key:'route-rooms',targetIds:access.unreachableRoomIds,text:`Room doors without a sampled entrance route: ${access.unreachableRooms.join(', ')}`});if(access.unreachableZones.length)issues.push({level:'bad',key:'route-zones',targetIds:access.unreachableZoneIds,text:`Shared-use zones without a sampled entrance route: ${access.unreachableZones.join(', ')}`});if(access.unreachableIslands.length)issues.push({level:'bad',key:'route-islands',targetIds:P.furniture.filter(f=>access.unreachableIslands.includes(f.islandId)).map(f=>f.id),text:`${access.unreachableIslands.length} workstation island(s) lack a sampled entrance route`})}}
  if(!P.objects.some(o=>o.type==='exit'))issues.push({level:'warn',text:'No emergency exit has been marked'});
  return issues;
}
function renderTeamAreaPicker(){const host=$('#teamAreaPicker'),areas=(P.workAreas||[]).filter(area=>!area.generic&&[area.x,area.y,area.x2,area.y2].every(Number.isFinite));host.hidden=readOnly||!areas.length||!document.body.classList.contains('advanced-on');if(host.hidden)return;host.innerHTML=`<b>Team work areas</b><p>Choose a boundary to move or resize. Desk islands stay in place; shortages update immediately.</p>${areas.map(area=>{const actual=workAreaSeatsForAssessment(P,area.id);return `<button type="button" class="btn ${actual<area.minimumDesks?'short':''}" data-focus-work-area="${esc(area.id)}">${esc(area.name)} · ${actual}/${area.targetDesks} desks</button>`}).join('')}`;host.querySelectorAll('[data-focus-work-area]').forEach(button=>button.onclick=()=>focusPlanTarget(button.dataset.focusWorkArea))}
function renderPanel(){
  const o=find(selected),ins=$('#inspector');if(!o){ins.textContent='Select an object to view its size and position.';return}
  if(P.broker?.fitOutMode==='as_is'&&o.existing&&o.fixed){const use=o.type==='room'&&o.existingKind&&o.existingKind!==o.kind?`Original ${o.existingKind} · planned ${o.kind}`:'Fixed shell';ins.innerHTML=`<div class="field"><label>Existing property · fixed</label><b>${esc(o.name||typeName[o.type]||o.type)}</b></div><div class="empty">${esc(use)}. Walls, size and openings stay locked; proposed use and furniture still need on-site verification.</div>`;return}
  const f=o.type==='furniture',room=o.type==='room',zone=o.type==='zone',area=o.type==='workArea',label=room||zone||area?o.name:f?o.name:typeName[o.type],box=o.x2!=null?rect(o):null;
  const dimensions=box&&['room','zone','workArea'].includes(o.type)?`<div class="row"><div class="field"><label>Width (mm)</label><input data-size="w" type="number" min="1000" step="100" value="${Math.round(box.w)}"></div><div class="field"><label>Depth (mm)</label><input data-size="h" type="number" min="1000" step="100" value="${Math.round(box.h)}"></div></div>`:'';
  const corner=o.x2!=null?`<details><summary>Corner coordinates</summary><div class="row"><div class="field"><label>X2 (mm)</label><input data-prop="x2" type="number" value="${Math.round(o.x2)}"></div><div class="field"><label>Y2 (mm)</label><input data-prop="y2" type="number" value="${Math.round(o.y2)}"></div></div></details>`:'';
  const areaStatus=area?`<div class="status ${workAreaSeatsForAssessment(P,o.id)<o.minimumDesks?'bad':'warn'}">${workAreaSeatsForAssessment(P,o.id)}/${o.targetDesks} concept desks · minimum ${o.minimumDesks}. Moving this boundary does not move its desk islands.</div>`:'';
  ins.innerHTML=`<div class="field"><label>Type</label><b>${esc(label)}</b></div>${areaStatus}<div class="row"><div class="field"><label>X (mm)</label><input data-prop="x" type="number" value="${Math.round(o.x)}"></div><div class="field"><label>Y (mm)</label><input data-prop="y" type="number" value="${Math.round(o.y)}"></div></div>${f?`<div class="row"><div class="field"><label>Width (mm)</label><input data-prop="w" type="number" value="${o.w}"></div><div class="field"><label>Depth (mm)</label><input data-prop="h" type="number" value="${o.h}"></div></div><div class="field"><label>Rotation</label><input data-prop="rot" type="number" value="${o.rot||0}" step="90"></div>`:dimensions}${corner}${room?`<div class="field"><label>Door side</label><select id="roomDoorSide"><option value="north" ${o.door?.side==='north'?'selected':''}>North</option><option value="south" ${o.door?.side==='south'?'selected':''}>South</option><option value="east" ${o.door?.side==='east'?'selected':''}>East</option><option value="west" ${o.door?.side==='west'?'selected':''}>West</option></select></div>${o.kind==='meeting'?`<div class="field"><label>Planned seats</label><input id="roomSeats" type="number" min="1" value="${o.plannedSeats||6}"></div>`:''}<div class="empty">Concept room only; access and compliance require review.</div>`:''}${area?'':`<button class="btn" id="deleteSelected">Delete object</button>`}`;
  if(f&&o.islandId){ins.querySelectorAll('[data-prop="rot"],[data-prop="w"],[data-prop="h"]').forEach(input=>input.disabled=true);ins.insertAdjacentHTML('beforeend',`<div class="empty">${o.islandSeats}-person workstation island · move or delete as one group</div>`)}
  ins.querySelectorAll('[data-prop]').forEach(i=>i.onchange=()=>{const next=Number(i.value);if(!Number.isFinite(next)){i.reportValidity();return}snapshot();if(!f&&!room&&!zone&&!area)markSiteChanged();const old=o[i.dataset.prop];if(f&&o.islandId&&['x','y'].includes(i.dataset.prop)){moveIslandMember(o,i.dataset.prop==='x'?next:o.x,i.dataset.prop==='y'?next:o.y);save();return}if(zone&&['x','y'].includes(i.dataset.prop)){const item=P.furniture.find(v=>v.zoneId===o.id);if(item)item[i.dataset.prop]+=next-old}o[i.dataset.prop]=next;save()});
  ins.querySelectorAll('[data-size]').forEach(i=>i.onchange=()=>{const value=Number(i.value);if(!Number.isInteger(value)||value<1000){i.setCustomValidity('Enter at least 1000 mm.');i.reportValidity();return}i.setCustomValidity('');const next={...o,[i.dataset.size==='w'?'x2':'y2']:o[i.dataset.size==='w'?'x':'y']+(Math.sign(o[i.dataset.size==='w'?'x2':'y2']-o[i.dataset.size==='w'?'x':'y'])||1)*value},bounds=rect(next);if(bounds.x<0||bounds.y<0||bounds.x+bounds.w>P.w||bounds.y+bounds.h>P.h){i.setCustomValidity('Area must stay inside the site.');i.reportValidity();return}if(next.x2===o.x2&&next.y2===o.y2)return;snapshot();o.x2=next.x2;o.y2=next.y2;save()});
  if(room){$('#roomDoorSide').onchange=e=>{snapshot();o.door={side:e.target.value,width:900};save()};const seats=$('#roomSeats');if(seats)seats.onchange=e=>{snapshot();o.plannedSeats=Math.max(1,+e.target.value||1);save()}}
  if(!area)$('#deleteSelected').onclick=()=>{snapshot();if(!f&&!room&&!zone)markSiteChanged();P.furniture=P.furniture.filter(x=>x.id!==o.id&&x.zoneId!==o.id&&(!o.islandId||x.islandId!==o.islandId));P.objects=P.objects.filter(x=>x.id!==o.id);selected=null;save()};
}
const money=n=>'$'+n.toLocaleString('en-US');
function loadProductTools(){
  if(!productToolsPromise)productToolsPromise=Promise.all([
    import('./src/domain/catalog-import.js'),
    import('./src/domain/match-products.js'),
    import('./src/domain/layout-revision.js')
  ]).then(([catalogImport,matching,revision])=>productTools={...catalogImport,...matching,...revision}).catch(error=>{productToolsPromise=null;throw error});
  return productToolsPromise;
}
function loadApprovedTools(){
  if(!approvedToolsPromise)approvedToolsPromise=Promise.all([
    import('./src/domain/home-product-binding.js'),
    import('./src/domain/office-product-binding.js'),
    import('./src/domain/planning-product-binding.js'),
    import('./src/domain/procurement-bom.js'),
    import('./src/domain/layout-revision.js'),
    import('./src/domain/set-procurement.js'),
    import('./src/domain/set-offers.js'),
    import('./src/domain/home-assemblies.js'),
    import('./src/domain/review-snapshot.js'),
    import('./src/domain/planning-coverage.js'),
    import('./src/domain/planning-fit-alternatives.js'),
    import('./src/domain/demo-catalog.js'),
    import('./src/domain/demo-product-packages.js'),
    import('./src/domain/demo-quote.js'),
    import('./src/domain/product-visuals.js')
  ]).then(([binding,office,planning,procurement,revision,sets,offers,assemblies,review,coverage,alternatives,demoCatalog,demoProductPackages,demoQuote,productVisuals])=>approvedTools={...binding,...office,...planning,...procurement,...revision,...sets,...offers,...assemblies,...review,...coverage,...alternatives,...demoCatalog,...demoProductPackages,...demoQuote,...productVisuals})
    .catch(error=>{approvedToolsPromise=null;throw error});
  return approvedToolsPromise;
}
const formatCatalogMoney=(value,currency='USD')=>new Intl.NumberFormat('en-US',{style:'currency',currency,maximumFractionDigits:2}).format(value);
function currentDemoSlots(){return designBomModule?designBomModule.buildProductSlots(allDisplayFurniture(P.furniture,P.objects,P.derivedProducts)):[]}
function currentProductCandidateId(item){return approvedSelections[item.id]||item.productCandidateId||null}
function sceneProductVisuals(items=allDisplayFurniture(P.furniture,P.objects,P.derivedProducts)){
  if(!approvedTools?.summarizeProductVisuals){cv.dataset.productVisualCount='0';cv.dataset.productVisualTiers='';cv.dataset.productVisualFingerprint='';return {visuals:new Map(),summary:null}}
  const selections=Object.fromEntries(items.map(item=>[item.id,currentProductCandidateId(item)]).filter(([,candidateId])=>candidateId));
  const summary=approvedTools.summarizeProductVisuals({items,selections,candidates:approvedCandidates,baseSpecs:catalog});
  const visuals=new Map(items.map((item,index)=>[item.id,summary.visuals[index]]));
  cv.dataset.productVisualCount=String(summary.productVisualCount);
  cv.dataset.productVisualTiers=summary.tiers.join(',');
  cv.dataset.productVisualFingerprint=summary.visuals.map(visual=>`${visual.candidateId||'fallback'}:${visual.plan.fill}`).join('|');
  cv.dataset.focusedProductId=focusedProductId||'';
  const status=$('#productVisualStatus');
  if(status)status.textContent=summary.productVisualCount
    ?`${summary.productVisualCount}/${summary.itemCount} scene items are using selected catalog finishes${summary.tiers.length?` · ${summary.tiers.join(' + ')} package`:''}. Switch A / B / C or an individual product to update the plan and 3D preview immediately.`
    :'Choose a complete A / B / C package to preview its products in the plan and 3D scene.';
  return {visuals,summary};
}
function persistDemoPreviewSelections(){
  if(approvedCatalogMode!=='demo'||!P.demoPackageChoice)return;
  const slotIds=new Set(currentDemoSlots().map(slot=>slot.sourceInstanceId));
  P.demoPackageChoice={...P.demoPackageChoice,selections:Object.fromEntries(Object.entries(approvedSelections).filter(([instanceId,candidateId])=>slotIds.has(instanceId)&&candidateId))};
}
function validSavedDemoSelection(slot,candidate){
  if(!slot||!candidate||candidate.category!==slot.category||candidate.role!==slot.role||!approvedCandidateReady(candidate))return false;
  const box=slot.envelopeMm||{},size=candidate.dimensionsMm||{};
  return (size.width<=box.width&&size.depth<=box.depth)||(size.depth<=box.width&&size.width<=box.depth);
}
function editableFurnitureForDisplay(item){
  if(!item)return null;
  const exact=P.furniture.find(value=>value.id===item.id);if(exact)return exact;
  const linked=P.furniture.find(value=>value.id===item.linkedTo);if(linked)return linked;
  return P.furniture.filter(value=>item.id.startsWith(`${value.id}-`)).sort((a,b)=>b.id.length-a.id.length)[0]||null;
}
function syncProductFocusUi(scroll=false){
  document.querySelectorAll('[data-approved-product-line]').forEach(line=>line.classList.toggle('focused',line.dataset.approvedProductLine===focusedProductId));
  document.querySelectorAll('[data-locate-product]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.locateProduct===focusedProductId)));
  cv.dataset.focusedProductId=focusedProductId||'';
  if(scroll&&focusedProductId){const line=document.querySelector(`[data-approved-product-line="${CSS.escape(focusedProductId)}"]`);line?.scrollIntoView({block:'nearest'})}
}
function focusProductInstance(instanceId,{center=true}={}){
  const item=allDisplayFurniture(P.furniture,P.objects,P.derivedProducts).find(value=>value.id===instanceId);if(!item)return;
  focusedProductId=item.id;focusedIssue=null;selected=editableFurnitureForDisplay(item)?.id||null;tool='select';setTool();
  if(center){view='2d';document.querySelectorAll('[data-view]').forEach(button=>button.classList.toggle('active',button.dataset.view==='2d'));
    const bounds=furnitureRect(item),width=cv.clientWidth,height=cv.clientHeight,target=Math.min(.14,(width-100)/(bounds.w+1800),(height-100)/(bounds.h+1800));
    V.scale=Math.max(V.scale,Math.max(.025,target));V.x=width/2-item.x*V.scale;V.y=height/2-item.y*V.scale}
  render();syncProductFocusUi(center);if(center)cv.scrollIntoView({block:'nearest'});
  $('#hint').textContent=`Located ${item.name} · the matching product row and scene item are highlighted.`;
}
function commitProductPreview(message){
  if(P.demoPackageChoice)P.demoPackageChoice={...P.demoPackageChoice,customized:true};
  P.demoQuote=null;P.demoOrder=null;approvedFitOptions=null;approvedRenderKey='';persistDemoPreviewSelections();
  save();renderApprovedProductResults();if(P.demoPackageChoice)$('#demoPackageStatus').textContent=`${P.demoPackageChoice.label} customized with individual product choices. The scene is showing the saved custom mix.`;if(message)$('#approvedProductStatus').textContent=message;
}
function showcasePackageKey(slots=currentDemoSlots(),budget=Number($('#demoBudget')?.value||P.demoBudget||75000)){
  return JSON.stringify([demoCatalogVersion,budget,slots.map(slot=>[slot.sourceInstanceId,slot.category,slot.role,slot.envelopeMm?.width,slot.envelopeMm?.depth])]);
}
async function activateShowcaseCatalog(){
  const tools=await loadApprovedTools(),demo=tools.createDemoCatalog(catalog);
  approvedCandidates=demo.candidates;approvedSetOffers=[];approvedCatalogLoaded=true;approvedCatalogMode='demo';
  demoCatalogVersion=demo.version;approvedCatalogRevision++;approvedRenderKey='';approvedFitOptions=null;
  P.catalogMode='demo';P.catalogVersion=demo.version;
  return demo;
}
function demoPackageVisualBoard(plan){
  const samples=plan.lines.slice(0,6).map((line,index)=>{
    const candidate=approvedCandidates.find(value=>value.candidateId===line.candidateId),visual=candidate?.visualSpec?.plan;
    if(!visual)return '';
    const width=26+(index%3)*9,height=12+(index%2)*7;
    return `<i title="${esc(candidate.name)} · ${esc(candidate.finish)}" style="width:${width}px;height:${height}px;background:${esc(visual.fill)};border-color:${esc(visual.stroke)};box-shadow:inset 0 -3px 0 ${esc(visual.accent)}"></i>`;
  }).join('');
  return `<div class="package-visual-board" aria-label="${esc(plan.label)} product finish preview">${samples}</div>`;
}
function renderDemoPackageCards(){
  const host=$('#demoPackageResults'),status=$('#demoPackageStatus');
  if(!host||!status)return;
  $('#demoBudget').value=P.demoBudget||75000;
  if(!demoPackages.length){host.innerHTML='';return}
  const currentKey=showcasePackageKey(),stale=currentKey!==demoPackageKey;
  if(stale)status.textContent='The layout or merchandise budget changed. Rebuild A / B / C before applying a package.';
  host.innerHTML=`<div class="demo-package-grid">${demoPackages.map(plan=>{
    const active=P.demoPackageChoice?.packageId===plan.packageId&&!P.demoPackageChoice?.customized&&!stale,finishes=[...new Map(plan.lines.map(line=>[line.finish,line.accent])).entries()].slice(0,6);
    const budgetText=plan.budgetStatus==='within_budget'?'Within merchandise budget':plan.budgetStatus==='over_budget'?'Above merchandise budget':'Budget comparison unavailable';
    return `<article class="demo-package-card ${active?'active':''}"><b>${esc(plan.label)}</b><p>${esc(plan.description)}</p>${demoPackageVisualBoard(plan)}<div class="package-total">${plan.subtotal?formatCatalogMoney(plan.subtotal.amount,plan.subtotal.currency):'Incomplete'}</div><p>${plan.selectedCount}/${plan.itemCount} items · ${esc(budgetText)}</p><div class="finish-dots" aria-label="Package finishes">${finishes.map(([finish,color])=>`<i title="${esc(finish)}" style="background:${esc(color)}"></i>`).join('')}</div><button class="btn ${active?'':'primary'}" type="button" data-demo-package="${esc(plan.packageId)}" ${readOnly||stale||plan.status!=='complete'?'disabled':''}>${active?'Previewing this package':'Preview this complete package'}</button></article>`;
  }).join('')}</div>`;
  host.querySelectorAll('[data-demo-package]').forEach(button=>button.onclick=()=>{
    if(readOnly||showcasePackageKey()!==demoPackageKey)return;
    const plan=demoPackages.find(value=>value.packageId===button.dataset.demoPackage);
    if(!plan||plan.status!=='complete')return;
    approvedSelections=Object.fromEntries(plan.selections.map(selection=>[selection.sourceInstanceId,selection.candidateId]));
    approvedFitOptions=null;approvedRenderKey='';P.demoQuote=null;P.demoOrder=null;
    P.demoPackageChoice={packageId:plan.packageId,label:plan.label,catalogVersion:demoCatalogVersion,
      selectedAt:new Date().toISOString(),itemCount:plan.itemCount,subtotal:plan.subtotal,customized:false,
      selections:{...approvedSelections}};
    status.textContent=`${plan.label} is now previewed across all ${plan.itemCount} furniture instances in both 2D and 3D. Run the complete-scene placement review below when ready.`;
    save();approvedRenderKey='';renderApprovedProductResults();
  });
}
async function buildShowcasePackages({restore=false}={}){
  const status=$('#demoPackageStatus'),button=$('#buildDemoPackages');
  if(readOnly&&!restore)return;
  if(!P.site?.confirmed){status.textContent='Confirm the site and select a generated layout first.';return}
  button.disabled=true;status.textContent=restore?'Restoring the showcase catalog…':'Building complete product packages…';
  try{
    if(!designBomModule)designBomModule=await import('./src/domain/design-bom.js');
    const demo=await activateShowcaseCatalog(),slots=currentDemoSlots();
    if(!slots.length)throw new Error('Place furniture or select a generated layout first.');
    const budget=Math.max(1000,Number($('#demoBudget').value)||P.demoBudget||75000);P.demoBudget=budget;
    demoPackages=approvedTools.buildDemoProductPackages({slots,candidates:approvedCandidates,budget});
    demoPackageKey=showcasePackageKey(slots,budget);
    const savedPackage=P.demoPackageChoice?.catalogVersion===demoCatalogVersion&&
      demoPackages.find(plan=>plan.packageId===P.demoPackageChoice.packageId&&plan.status==='complete');
    if(savedPackage){
      approvedSelections=Object.fromEntries(savedPackage.selections.map(selection=>[selection.sourceInstanceId,selection.candidateId]));
      const slotById=new Map(slots.map(slot=>[slot.sourceInstanceId,slot])),candidateById=new Map(approvedCandidates.map(candidate=>[candidate.candidateId,candidate]));
      for(const [instanceId,candidateId] of Object.entries(P.demoPackageChoice.selections||{}))
        if(validSavedDemoSelection(slotById.get(instanceId),candidateById.get(candidateId)))approvedSelections[instanceId]=candidateId;
      persistDemoPreviewSelections();
    }
    const complete=demoPackages.filter(plan=>plan.status==='complete').length;
    status.textContent=`${demo.candidates.length} fictional SKUs · catalog ${demo.version} · ${complete}/3 complete packages ready.${savedPackage?P.demoPackageChoice.customized?` ${P.demoPackageChoice.label} custom mix restored.`:` ${P.demoPackageChoice.label} preview restored.`:''}`;
    $('#approvedProductStatus').textContent=`Showcase catalog ${demo.version} loaded. Fictional products and prices for demonstrating the complete workflow.`;
    if(!readOnly)localStorage.setItem(STORE,JSON.stringify(P));
    render();renderDemoPackageCards();renderApprovedProductResults();
  }catch(error){demoPackages=[];demoPackageKey='';status.textContent=error.message||'Could not build showcase packages.'}
  finally{button.disabled=readOnly}
}
function renderDemoQuotePanel({draft,layoutRevision}){
  const panel=$('#demoQuotePanel');
  if(!panel)return;
  if(approvedCatalogMode!=='demo'){panel.hidden=true;panel.innerHTML='';return}
  panel.hidden=false;
  if(!draft||draft.pendingCount||!draft.merchandiseSubtotal){
    panel.innerHTML='<h3>Demo quote</h3><p>Complete the product placement review for every item before generating a quote.</p>';
    return;
  }
  const context={layoutRevision,catalogVersion:demoCatalogVersion,procurementDraft:draft},quote=P.demoQuote,
    current=approvedTools.demoQuoteMatches(quote,context),order=current&&P.demoOrder?.quoteNumber===quote.quoteNumber?P.demoOrder:null;
  if(!quote||!current){
    panel.innerHTML=`<h3>Demo quote <span class="demo-badge">FICTIONAL PRICES</span></h3><p>${quote?'The saved quote is out of date because the layout, products or catalog changed.':'Create an itemized showcase quote from the reviewed merchandise draft.'}</p><button class="btn primary" id="generateDemoQuote" type="button" ${readOnly?'disabled':''}>${quote?'Generate updated demo quote':'Generate demo quote'}</button>`;
    const generate=panel.querySelector('#generateDemoQuote');if(generate)generate.onclick=()=>{snapshot();P.demoQuote=approvedTools.createDemoQuote({projectName:P.name,layoutRevision,catalogVersion:demoCatalogVersion,procurementDraft:draft});P.demoOrder=null;save()};
    return;
  }
  const a=quote.amounts;
  panel.innerHTML=`<h3>Demo quote <span class="demo-badge">${esc(quote.status.toUpperCase())}</span></h3><p class="quote-number">${esc(quote.quoteNumber)} · version ${quote.version}</p><p>Valid through ${esc(quote.validUntil.slice(0,10))} · catalog ${esc(quote.catalogVersion)}</p><div class="quote-amounts"><div class="metric"><span>Merchandise</span><b>${formatCatalogMoney(a.merchandise)}</b></div><div class="metric"><span>Delivery estimate</span><b>${formatCatalogMoney(a.delivery)}</b></div><div class="metric"><span>Installation estimate</span><b>${formatCatalogMoney(a.installation)}</b></div><div class="metric"><span>Estimated tax</span><b>${formatCatalogMoney(a.estimatedTax)}</b></div><div class="metric total"><span>Demo total</span><b>${formatCatalogMoney(a.total)}</b></div></div>${order?`<div class="demo-order"><b>${esc(order.orderRequestNumber)}</b><br>Order request received · demonstration only; no purchase or payment was created.</div>`:`<div class="demo-quote-actions">${quote.status==='draft'?`<button class="btn primary" id="confirmDemoQuote" type="button" ${readOnly?'disabled':''}>Confirm demo quote</button>`:`<button class="btn primary" id="submitDemoOrder" type="button" ${readOnly?'disabled':''}>Submit demo order request</button>`}<button class="btn" id="replaceDemoQuote" type="button" ${readOnly?'disabled':''}>Regenerate quote</button></div>`}<p>${esc(quote.disclaimer)}</p>`;
  const confirm=panel.querySelector('#confirmDemoQuote');if(confirm)confirm.onclick=()=>{snapshot();P.demoQuote=approvedTools.confirmDemoQuote(P.demoQuote);save()};
  const submit=panel.querySelector('#submitDemoOrder');if(submit)submit.onclick=()=>{snapshot();P.demoOrder=approvedTools.createDemoOrderRequest(P.demoQuote);save()};
  const replace=panel.querySelector('#replaceDemoQuote');if(replace)replace.onclick=()=>{snapshot();P.demoQuote=approvedTools.createDemoQuote({projectName:P.name,layoutRevision,catalogVersion:demoCatalogVersion,procurementDraft:draft});P.demoOrder=null;save()};
}
function approvedCandidateReady(candidate){
  return approvedTools?.candidateEvidenceGaps(candidate).length===0;
}
const coverageReasonLabel={catalog_role_missing:'No product for this furniture role',catalog_evidence_incomplete:'Available candidates lack reviewed evidence',
  product_not_selected:'Choose a reviewed product',selected_candidate_missing:'Selected product is absent from this catalog',
  category_or_role_mismatch:'Selected product has the wrong furniture role',product_identity_missing:'Source or product identity missing',
  spec_unverified:'Dimensions not verified',use_spec_unverified:'Use space not reviewed',purchase_unit_not_single:'Single purchase unit not verified',
  supply_unverified:'Availability not verified',not_confirmed_in_stock:'Not confirmed in stock',lead_time_unknown:'Lead time unknown',
  price_unverified:'Price not verified'};
const placementReasonLabel={site_not_confirmed:'Site not confirmed',site_geometry_invalid:'Site geometry invalid',
  display_geometry_invalid:'Furniture geometry invalid',duplicate_instance_id:'Duplicate furniture ID',
  clearance_profile_missing_or_stale:'Use space evidence missing or stale',outside_room:'Outside room',
  outside_zone:'Outside shared zone',outside_site:'Outside site',room_missing:'Room missing',zone_missing:'Shared zone missing',
  multiple_containing_areas:'Room and shared zone both assigned',room_door_missing:'Room door missing',
  room_door_approach_blocked:'Blocks room door approach',fixed_object_collision:'Collides with fixed object',
  furniture_collision:'Furniture bodies collide',use_clearance_collision:'Use spaces collide',
  corridor_too_narrow:'Corridor too narrow',entrance_exit_disconnected:'Entrance to exit route blocked',
  room_route_disconnected:'Room route blocked',route_markers_missing:'Entrance or exit marker missing'};
function setOfferFitsGroup(offer,items){
  if(!offer?.verification?.components||!offer?.verification?.price||!offer?.verification?.availability||offer.availability!=='in_stock'||!offer.review?.reviewedBy)return false;
  const counts=new Map();
  for(const item of items){if(!item.productCandidateId)return false;counts.set(item.productCandidateId,(counts.get(item.productCandidateId)||0)+1)}
  return counts.size===offer.components?.length&&offer.components.every(part=>counts.get(part.candidateId)===part.quantity);
}
function renderApprovedProductResults(){
  const host=$('#approvedProductResults');
  if(!host||!approvedCatalogLoaded||!designBomModule){const quote=$('#demoQuotePanel');if(quote)quote.hidden=true;return}
  if(!approvedTools){
    host.innerHTML='<div class="empty">Preparing product coverage…</div>';
    loadApprovedTools().then(()=>renderApprovedProductResults()).catch(()=>{host.innerHTML='<div class="status warn">Could not prepare product coverage.</div>'});
    return;
  }
  const displayed=allDisplayFurniture(P.furniture,P.objects,P.derivedProducts),primary=P.furniture||[];
  const homeScene=displayed.length===primary.length&&primary.length>0&&primary.every(item=>['wardrobe','table','homeChair','vanity','sofa','coffeeTable','lowCabinet','bed'].includes(item.kind));
  const officeKinds=new Set(['desk','bench2','cubicle','manager','chair','meeting','meetingModular','meetingChair','phone','cabinet','shelf','locker']);
  const officeScene=displayed.length>0&&displayed.every(item=>officeKinds.has(item.kind))&&primary.every(item=>officeKinds.has(item.kind));
  const planningScene=displayed.length>0&&displayed.every(item=>!['dining4','lounge2'].includes(item.kind)&&catalog.some(spec=>spec.kind===item.kind))&&
    primary.every(item=>catalog.some(spec=>spec.kind===item.kind));
  const key=JSON.stringify([approvedCatalogRevision,approvedCatalogMode,P.objects,primary,P.derivedProducts,P.productBindings,P.productProfiles,P.setSelections,approvedSelections,P.demoPackageChoice,P.demoQuote,P.demoOrder]);
  if(key===approvedRenderKey)return;
  approvedRenderKey=key;
  if(!displayed.length){host.innerHTML='<div class="empty">Place furniture or generate a supported office plan to review products.</div>';return}
  if(!homeScene&&!officeScene&&!planningScene){
    host.innerHTML='<div class="empty">This scene has furniture kinds that cannot yet enter a complete product review. They remain design needs.</div>';return;
  }
  const slots=designBomModule.buildProductSlots(displayed);
  const currentCandidateId=instanceId=>approvedSelections[instanceId]||displayed.find(item=>item.id===instanceId)?.productCandidateId||'';
  const coverage=approvedTools.auditPlanningCoverage({slots,candidates:approvedCandidates,
    selections:slots.map(slot=>({sourceInstanceId:slot.sourceInstanceId,candidateId:currentCandidateId(slot.sourceInstanceId)}))});
  const coverageById=new Map(coverage.lines.map(line=>[line.sourceInstanceId,line]));
  const missingRoles=coverage.roles.filter(role=>role.readyForPlacementReview<role.total)
    .map(role=>`${role.role} ${role.total-role.readyForPlacementReview}/${role.total}`);
  const summary=`<div class="status ${coverage.needsProductEvidence?'warn':'ok'}" id="approvedCoverageSummary">${coverage.readyForPlacementReview}/${coverage.itemCount} physical items ready for placement review${missingRoles.length?` · Open roles: ${esc(missingRoles.join(', '))}`:''}. This is a product evidence precheck; placement and procurement still require review.</div>`;
  const fitSuggestions=approvedFitOptions?.key===key&&
    (approvedFitOptions.alternatives.length||approvedFitOptions.pairs.length||approvedFitOptions.moves.length||approvedFitOptions.containers.length||approvedFitOptions.containerPairs.length||approvedFitOptions.roomLayouts.length||approvedFitOptions.roomItemMoves.length||approvedFitOptions.roomItemPairs.length||approvedFitOptions.roomItemRotations.length||approvedFitOptions.roomItemSwaps.length)?
    `<div class="status warn" id="approvedFitAlternatives">Whole-scene checked adjustments: ${approvedFitOptions.alternatives.map(option=>
      `<button class="btn" type="button" data-fit-instance="${esc(option.sourceInstanceId)}" data-fit-candidate="${esc(option.toCandidateId)}" ${readOnly?'disabled':''}>Product: ${esc(option.sourceInstanceId)} → ${esc(option.name)} · ${option.dimensionsMm.width} × ${option.dimensionsMm.depth} mm</button>`).join(' ')}${approvedFitOptions.pairs.map((option,index)=>
      `<button class="btn" type="button" data-fit-pair="${index}" ${readOnly?'disabled':''}>Pair: ${option.changes.map(change=>`${esc(change.sourceInstanceId)} → ${esc(change.name)}`).join(' + ')}</button>`).join(' ')}${approvedFitOptions.moves.map(option=>
      `<button class="btn" type="button" data-move-instance="${esc(option.sourceInstanceId)}" data-move-x="${option.to.x}" data-move-y="${option.to.y}" ${readOnly?'disabled':''}>Move: ${esc(option.sourceInstanceId)} → (${option.to.x}, ${option.to.y}) mm</button>`).join(' ')}${approvedFitOptions.containers.map((option,index)=>
      `<button class="btn" type="button" data-container-move="${index}" ${readOnly?'disabled':''}>Reposition ${esc(option.kind)} ${esc(option.containerId)} · ${option.kind==='room'?`offset (${option.to.dx}, ${option.to.dy})`:`furniture (${option.to.x}, ${option.to.y})`} mm</button>`).join(' ')}${approvedFitOptions.containerPairs.map((option,index)=>
      `<button class="btn" type="button" data-container-pair="${index}" ${readOnly?'disabled':''}>Reposition both: ${option.changes.map(change=>`${esc(change.kind)} ${esc(change.containerId)} ${change.kind==='room'?`offset (${change.to.dx}, ${change.to.dy})`:`furniture (${change.to.x}, ${change.to.y})`}`).join(' + ')} mm</button>`).join(' ')}${approvedFitOptions.roomLayouts.map((option,index)=>
      `<button class="btn" type="button" data-room-layout="${index}" ${readOnly?'disabled':''}>Reorient room ${esc(option.containerId)} · ${esc(({rotate_cw:'90° clockwise',rotate_180:'180°',rotate_ccw:'90° counterclockwise',mirror_x:'mirror left/right',mirror_y:'mirror top/bottom',base:'original layout'})[option.to]||option.to)}</button>`).join(' ')}${approvedFitOptions.roomItemMoves.map((option,index)=>
      `<button class="btn" type="button" data-room-item-move="${index}" ${readOnly?'disabled':''}>Move room item ${esc(option.sourceInstanceId)} · offset (${option.to.dx}, ${option.to.dy}) mm</button>`).join(' ')}${approvedFitOptions.roomItemPairs.map((option,index)=>
      `<button class="btn" type="button" data-room-item-pair="${index}" ${readOnly?'disabled':''}>Move room pair: ${option.changes.map(change=>`${esc(change.sourceInstanceId)} (${change.to.dx}, ${change.to.dy})`).join(' + ')} mm</button>`).join(' ')}${approvedFitOptions.roomItemRotations.map((option,index)=>
      `<button class="btn" type="button" data-room-item-rotation="${index}" ${readOnly?'disabled':''}>Rotate room item ${esc(option.sourceInstanceId)} · ${esc(({0:'original orientation',90:'90° clockwise',180:'180°',270:'90° counterclockwise'})[option.to])}</button>`).join(' ')}${approvedFitOptions.roomItemSwaps.map((option,index)=>
      `<button class="btn" type="button" data-room-item-swap="${index}" ${readOnly?'disabled':''}>Swap room positions: ${option.changes.map(change=>esc(change.sourceInstanceId)).join(' ↔ ')}</button>`).join(' ')}<small>Choose an adjustment, then review and bind the complete scene again.</small></div>`:'';
  host.innerHTML=summary+slots.map(slot=>{
    const choices=approvedCandidates.filter(candidate=>candidate.category===slot.category&&candidate.role===slot.role);
    const selected=currentCandidateId(slot.sourceInstanceId);
    const selectedCandidate=approvedCandidates.find(candidate=>candidate.candidateId===selected),visual=selectedCandidate?.visualSpec?.plan;
    const line=coverageById.get(slot.sourceInstanceId);
    const options=choices.map(candidate=>`<option value="${esc(candidate.candidateId)}" ${candidate.candidateId===selected?'selected':''} ${approvedCandidateReady(candidate)?'':'disabled'}>${esc(candidate.name||candidate.supplierSku)} · ${candidate.dimensionsMm.width||'?'} × ${candidate.dimensionsMm.depth||'?'} mm${approvedCandidateReady(candidate)?'':` · ${esc(approvedTools.candidateEvidenceGaps(candidate).map(reason=>coverageReasonLabel[reason]||reason).join(', '))}`}</option>`).join('');
    return `<div class="candidate-line ${focusedProductId===slot.sourceInstanceId?'focused':''}" data-approved-product-line="${esc(slot.sourceInstanceId)}"><div class="candidate-line-head"><b>${esc(slot.label)} · ${esc(slot.sourceInstanceId)}</b><button class="btn locate-product" type="button" data-locate-product="${esc(slot.sourceInstanceId)}" aria-pressed="${focusedProductId===slot.sourceInstanceId}">Locate in plan</button></div><select data-approved-instance="${esc(slot.sourceInstanceId)}" ${readOnly?'disabled':''}><option value="">Choose reviewed product</option>${options}</select>${selectedCandidate?`<div class="product-visual-meta">${visual?`<i aria-hidden="true" style="background:${esc(visual.fill)};border-color:${esc(visual.stroke)}"></i>`:''}<span>${esc(selectedCandidate.tierLabel||'Selected')} · ${esc(selectedCandidate.finish||selectedCandidate.supplierSku)} · ${esc(selectedCandidate.supplierSku)}</span></div>`:''}<small>${esc(line.reasons.length?line.reasons.map(reason=>coverageReasonLabel[reason]||reason).join('; '):'Product evidence ready; placement review pending')}</small></div>`;
  }).join('')+`<button class="btn primary" id="bindApprovedProducts" type="button" ${readOnly||coverage.needsProductEvidence?'disabled':''}>Review placement &amp; bind all</button>${fitSuggestions}<div id="approvedDraft"></div>`;
  host.querySelectorAll('[data-approved-instance]').forEach(select=>select.onchange=()=>{
    approvedSelections[select.dataset.approvedInstance]=select.value;
    commitProductPreview('Product changed. The 2D plan and 3D preview now use the selected finish; review the complete scene before saving products.');
  });
  host.querySelectorAll('[data-locate-product]').forEach(button=>button.onclick=()=>focusProductInstance(button.dataset.locateProduct));
  host.querySelectorAll('[data-fit-instance]').forEach(button=>button.onclick=()=>{
    if(readOnly)return;
    approvedSelections[button.dataset.fitInstance]=button.dataset.fitCandidate;
    commitProductPreview('Alternative selected and shown in the scene. Review the complete scene again before saving.');
  });
  host.querySelectorAll('[data-fit-pair]').forEach(button=>button.onclick=()=>{
    if(readOnly||approvedFitOptions?.key!==key)return;
    const pair=approvedFitOptions.pairs[Number(button.dataset.fitPair)];
    if(!pair||pair.changes.length!==2)return;
    for(const change of pair.changes)approvedSelections[change.sourceInstanceId]=change.toCandidateId;
    commitProductPreview('Product pair selected and shown in the scene. Review the complete scene again before saving.');
  });
  host.querySelectorAll('[data-move-instance]').forEach(button=>button.onclick=()=>{
    if(readOnly)return;
    const item=P.furniture.find(value=>value.id===button.dataset.moveInstance),x=Number(button.dataset.moveX),y=Number(button.dataset.moveY);
    if(!item||item.roomId||item.zoneId||item.islandId||item.workAreaId||item.linkedTo||
      P.furniture.some(other=>other.linkedTo===item.id)||!Number.isFinite(x)||!Number.isFinite(y))return;
    snapshot();item.x=x;item.y=y;approvedFitOptions=null;save();
    $('#approvedProductStatus').textContent='Suggested furniture move applied. Review the complete scene again before saving products.';
  });
  host.querySelectorAll('[data-container-move]').forEach(button=>button.onclick=()=>{
    if(readOnly||approvedFitOptions?.key!==key)return;
    const option=approvedFitOptions.containers[Number(button.dataset.containerMove)];
    if(!option)return;
    const room=option.kind==='room'?P.objects.find(item=>item.id===option.containerId&&item.type==='room'):null;
    const parent=option.kind==='zone'?P.furniture.find(item=>item.id===option.furnitureId&&item.zoneId===option.containerId):null;
    if(!room&&!parent)return;
    snapshot();
    if(room)room.furnitureShift={dx:option.to.dx,dy:option.to.dy};
    else{parent.x=option.to.x;parent.y=option.to.y}
    approvedFitOptions=null;save();
    $('#approvedProductStatus').textContent='Suggested room or shared-zone furniture move applied. Review the complete scene again before saving products.';
  });
  host.querySelectorAll('[data-container-pair]').forEach(button=>button.onclick=()=>{
    if(readOnly||approvedFitOptions?.key!==key)return;
    const option=approvedFitOptions.containerPairs[Number(button.dataset.containerPair)];
    if(!option||option.changes.length!==2)return;
    const targets=option.changes.map(change=>change.kind==='room'
      ?P.objects.find(item=>item.id===change.containerId&&item.type==='room')
      :P.furniture.find(item=>item.id===change.furnitureId&&item.zoneId===change.containerId));
    if(targets.some((target,index)=>!target||(option.changes[index].kind==='room'
      ?(target.furnitureShift?.dx||0)!==option.changes[index].from.dx||
        (target.furnitureShift?.dy||0)!==option.changes[index].from.dy
      :target.x!==option.changes[index].from.x||target.y!==option.changes[index].from.y)))return;
    snapshot();
    option.changes.forEach((change,index)=>{if(change.kind==='room')targets[index].furnitureShift={...change.to};
      else{targets[index].x=change.to.x;targets[index].y=change.to.y}});
    approvedFitOptions=null;save();
    $('#approvedProductStatus').textContent='Suggested two-area furniture move applied. Review the complete scene again before saving products.';
  });
  host.querySelectorAll('[data-room-layout]').forEach(button=>button.onclick=()=>{
    if(readOnly||approvedFitOptions?.key!==key)return;
    const option=approvedFitOptions.roomLayouts[Number(button.dataset.roomLayout)],room=option&&
      P.objects.find(item=>item.id===option.containerId&&item.type==='room');
    if(!room||(room.furnitureLayout||'base')!==option.from)return;
    snapshot();
    if(option.to==='base')delete room.furnitureLayout;else room.furnitureLayout=option.to;
    approvedFitOptions=null;save();
    $('#approvedProductStatus').textContent='Suggested room furniture orientation applied. Review the complete scene again before saving products.';
  });
  host.querySelectorAll('[data-room-item-move]').forEach(button=>button.onclick=()=>{
    if(readOnly||approvedFitOptions?.key!==key)return;
    const option=approvedFitOptions.roomItemMoves[Number(button.dataset.roomItemMove)],room=option&&
      P.objects.find(item=>item.id===option.containerId&&item.type==='room');
    const current=room?.furnitureItemOffsets?.[option?.sourceInstanceId]||{dx:0,dy:0};
    if(!room||current.dx!==option.from.dx||current.dy!==option.from.dy)return;
    snapshot();
    const offsets={...(room.furnitureItemOffsets||{})};
    if(option.to.dx||option.to.dy)offsets[option.sourceInstanceId]={...option.to};else delete offsets[option.sourceInstanceId];
    if(Object.keys(offsets).length)room.furnitureItemOffsets=offsets;else delete room.furnitureItemOffsets;
    approvedFitOptions=null;save();
    $('#approvedProductStatus').textContent='Suggested room furniture item move applied. Review the complete scene again before saving products.';
  });
  host.querySelectorAll('[data-room-item-pair]').forEach(button=>button.onclick=()=>{
    if(readOnly||approvedFitOptions?.key!==key)return;
    const option=approvedFitOptions.roomItemPairs[Number(button.dataset.roomItemPair)],room=option&&
      P.objects.find(item=>item.id===option.containerId&&item.type==='room');
    if(!room||option.changes.length!==2||option.changes.some(change=>{const current=room.furnitureItemOffsets?.[change.sourceInstanceId]||{dx:0,dy:0};
      return current.dx!==change.from.dx||current.dy!==change.from.dy}))return;
    snapshot();
    const offsets={...(room.furnitureItemOffsets||{})};
    for(const change of option.changes){if(change.to.dx||change.to.dy)offsets[change.sourceInstanceId]={...change.to};
      else delete offsets[change.sourceInstanceId]}
    if(Object.keys(offsets).length)room.furnitureItemOffsets=offsets;else delete room.furnitureItemOffsets;
    approvedFitOptions=null;save();
    $('#approvedProductStatus').textContent='Suggested two-item room furniture move applied. Review the complete scene again before saving products.';
  });
  host.querySelectorAll('[data-room-item-rotation]').forEach(button=>button.onclick=()=>{
    if(readOnly||approvedFitOptions?.key!==key)return;
    const option=approvedFitOptions.roomItemRotations[Number(button.dataset.roomItemRotation)],room=option&&
      P.objects.find(item=>item.id===option.containerId&&item.type==='room');
    if(!room||(room.furnitureItemRotations?.[option.sourceInstanceId]||0)!==option.from)return;
    snapshot();
    const rotations={...(room.furnitureItemRotations||{})};
    if(option.to)rotations[option.sourceInstanceId]=option.to;else delete rotations[option.sourceInstanceId];
    if(Object.keys(rotations).length)room.furnitureItemRotations=rotations;else delete room.furnitureItemRotations;
    approvedFitOptions=null;save();
    $('#approvedProductStatus').textContent='Suggested room furniture item rotation applied. Review the complete scene again before saving products.';
  });
  host.querySelectorAll('[data-room-item-swap]').forEach(button=>button.onclick=()=>{
    if(readOnly||approvedFitOptions?.key!==key)return;
    const option=approvedFitOptions.roomItemSwaps[Number(button.dataset.roomItemSwap)],room=option&&
      P.objects.find(item=>item.id===option.containerId&&item.type==='room');
    if(!room||option.changes.length!==2||option.changes.some(change=>{const current=room.furnitureItemOffsets?.[change.sourceInstanceId]||{dx:0,dy:0};
      return current.dx!==change.from.dx||current.dy!==change.from.dy}))return;
    snapshot();
    const offsets={...(room.furnitureItemOffsets||{})};
    for(const change of option.changes){if(change.to.dx||change.to.dy)offsets[change.sourceInstanceId]={...change.to};
      else delete offsets[change.sourceInstanceId]}
    if(Object.keys(offsets).length)room.furnitureItemOffsets=offsets;else delete room.furnitureItemOffsets;
    approvedFitOptions=null;save();
    $('#approvedProductStatus').textContent='Suggested room furniture position swap applied. Review the complete scene again before saving products.';
  });
  host.querySelector('#bindApprovedProducts').onclick=async()=>{
    const button=host.querySelector('#bindApprovedProducts'),status=$('#approvedProductStatus');
    if(readOnly||button.disabled)return;
    button.disabled=true;status.textContent='Reviewing the full scene and product evidence…';
    const before=JSON.stringify(P),selections=slots.map(slot=>({sourceInstanceId:slot.sourceInstanceId,
      candidateId:currentCandidateId(slot.sourceInstanceId)})),selectionKey=JSON.stringify(selections);
    const unchanged=()=>JSON.stringify(P)===before&&JSON.stringify(slots.map(slot=>({sourceInstanceId:slot.sourceInstanceId,
      candidateId:currentCandidateId(slot.sourceInstanceId)})))===selectionKey;
    try{
      const tools=await loadApprovedTools();
      const bind=homeScene?tools.bindReviewedHomeScene:officeScene?tools.bindReviewedOfficeScene:tools.bindReviewedPlanningScene;
      const result=await bind({project:P,
        selections,
        candidates:approvedCandidates,displayFurniture:trial=>allDisplayFurniture(trial.furniture,trial.objects,trial.derivedProducts)});
      if(!unchanged()){status.textContent='The layout or product selection changed during review. Retry with the current scene.';return}
      if(result.status!=='bound'){
        const details=result.placementIssues?.length?result.placementIssues.map(issue=>
          `${issue.instanceIds.length?issue.instanceIds.join(' + '):'Scene'}: ${placementReasonLabel[issue.reason]||issue.reason}${issue.objectId?` (${issue.objectId})`:''}`):result.reasons;
        status.textContent=`Binding needs review: ${details.join('; ')}.`;
        if(planningScene&&result.placementIssues?.length){
          const fit=await tools.reviewPlanningProductAlternatives({project:P,
            selections,
            candidates:approvedCandidates,displayFurniture:trial=>allDisplayFurniture(trial.furniture,trial.objects,trial.derivedProducts),
            initialReview:result,maxTrials:8});
          const pair=fit.alternatives.length?{alternatives:[],trials:0}:await tools.reviewPlanningProductPairs({project:P,
            selections,candidates:approvedCandidates,
            displayFurniture:trial=>allDisplayFurniture(trial.furniture,trial.objects,trial.derivedProducts),
            initialReview:result,maxTrials:8});
          const move=fit.alternatives.length||pair.alternatives.length?{alternatives:[],trials:0}:await tools.reviewPlanningLayoutMoves({project:P,
            selections,
            candidates:approvedCandidates,displayFurniture:trial=>allDisplayFurniture(trial.furniture,trial.objects,trial.derivedProducts),
            initialReview:result,maxTrials:12});
          const containerLayoutValid=(trial,target)=>target.kind==='room'
            ?tools.isPlanningProductScene(trial,allDisplayFurniture(trial.furniture,trial.objects,trial.derivedProducts))&&
              roomFurnitureValid(trial.objects.find(item=>item.id===target.containerId),trial)
            :validSharedZone(trial.objects.find(item=>item.id===target.containerId),trial.objects,trial.furniture);
          const container=fit.alternatives.length||pair.alternatives.length||move.alternatives.length?
            {alternatives:[],trials:0}:await tools.reviewPlanningContainerMoves({project:P,selections,
              candidates:approvedCandidates,displayFurniture:trial=>allDisplayFurniture(trial.furniture,trial.objects,trial.derivedProducts),
              layoutValid:containerLayoutValid,
              initialReview:result,maxTrials:16});
          const containerPair=fit.alternatives.length||pair.alternatives.length||move.alternatives.length||container.alternatives.length?
            {alternatives:[],trials:0}:await tools.reviewPlanningContainerPairs({project:P,selections,
              candidates:approvedCandidates,displayFurniture:trial=>allDisplayFurniture(trial.furniture,trial.objects,trial.derivedProducts),
              layoutValid:containerLayoutValid,initialReview:result,maxTrials:16});
          const roomLayout=fit.alternatives.length||pair.alternatives.length||move.alternatives.length||container.alternatives.length||containerPair.alternatives.length?
            {alternatives:[],trials:0}:await tools.reviewPlanningRoomLayouts({project:P,selections,
              candidates:approvedCandidates,displayFurniture:trial=>allDisplayFurniture(trial.furniture,trial.objects,trial.derivedProducts),
              layoutValid:containerLayoutValid,initialReview:result,maxTrials:12});
          const roomItemMove=fit.alternatives.length||pair.alternatives.length||move.alternatives.length||container.alternatives.length||containerPair.alternatives.length||roomLayout.alternatives.length?
            {alternatives:[],trials:0}:await tools.reviewPlanningRoomItemMoves({project:P,selections,
              candidates:approvedCandidates,displayFurniture:trial=>allDisplayFurniture(trial.furniture,trial.objects,trial.derivedProducts),
              layoutValid:containerLayoutValid,initialReview:result,maxTrials:16});
          const roomItemPair=fit.alternatives.length||pair.alternatives.length||move.alternatives.length||container.alternatives.length||containerPair.alternatives.length||roomLayout.alternatives.length||roomItemMove.alternatives.length?
            {alternatives:[],trials:0}:await tools.reviewPlanningRoomItemPairs({project:P,selections,
              candidates:approvedCandidates,displayFurniture:trial=>allDisplayFurniture(trial.furniture,trial.objects,trial.derivedProducts),
              layoutValid:containerLayoutValid,initialReview:result,maxTrials:24});
          const roomItemRotation=fit.alternatives.length||pair.alternatives.length||move.alternatives.length||container.alternatives.length||containerPair.alternatives.length||roomLayout.alternatives.length||roomItemMove.alternatives.length||roomItemPair.alternatives.length?
            {alternatives:[],trials:0}:await tools.reviewPlanningRoomItemRotations({project:P,selections,
              candidates:approvedCandidates,displayFurniture:trial=>allDisplayFurniture(trial.furniture,trial.objects,trial.derivedProducts),
              layoutValid:containerLayoutValid,initialReview:result,maxTrials:12});
          const roomItemSwap=fit.alternatives.length||pair.alternatives.length||move.alternatives.length||container.alternatives.length||containerPair.alternatives.length||roomLayout.alternatives.length||roomItemMove.alternatives.length||roomItemPair.alternatives.length||roomItemRotation.alternatives.length?
            {alternatives:[],trials:0}:await tools.reviewPlanningRoomItemSwaps({project:P,selections,
              candidates:approvedCandidates,displayFurniture:trial=>allDisplayFurniture(trial.furniture,trial.objects,trial.derivedProducts),
              layoutValid:containerLayoutValid,initialReview:result,maxTrials:12});
          if(!unchanged()){status.textContent='The layout or product selection changed during review. Retry with the current scene.';return}
          approvedFitOptions={key,alternatives:fit.alternatives,pairs:pair.alternatives,moves:move.alternatives,containers:container.alternatives,containerPairs:containerPair.alternatives,roomLayouts:roomLayout.alternatives,roomItemMoves:roomItemMove.alternatives,roomItemPairs:roomItemPair.alternatives,roomItemRotations:roomItemRotation.alternatives,roomItemSwaps:roomItemSwap.alternatives};
          status.textContent+=fit.alternatives.length||pair.alternatives.length||move.alternatives.length||container.alternatives.length||containerPair.alternatives.length||roomLayout.alternatives.length||roomItemMove.alternatives.length||roomItemPair.alternatives.length||roomItemRotation.alternatives.length||roomItemSwap.alternatives.length?
            ` ${fit.alternatives.length} single-product, ${pair.alternatives.length} two-product, ${move.alternatives.length} local, ${container.alternatives.length} one-area, ${containerPair.alternatives.length} two-area, ${roomLayout.alternatives.length} room-layout, ${roomItemMove.alternatives.length} room-item, ${roomItemPair.alternatives.length} room-item-pair, ${roomItemRotation.alternatives.length} item-rotation and ${roomItemSwap.alternatives.length} position-swap adjustment(s) passed complete scene review; choose one below.`:
            ` No passing adjustment in ${fit.trials} single-product, ${pair.trials} two-product, ${move.trials} local, ${container.trials} one-area, ${containerPair.trials} two-area, ${roomLayout.trials} room-layout, ${roomItemMove.trials} room-item, ${roomItemPair.trials} room-item-pair, ${roomItemRotation.trials} item-rotation and ${roomItemSwap.trials} position-swap trial(s); revise the layout or inspect more candidates.`;
        }
        return;
      }
      approvedFitOptions=null;
      snapshot();P=normalizeProject(result.project);approvedRenderKey='';save();
      status.textContent=approvedCatalogMode==='demo'?`${result.procurementDraft.readyCount} product instances reviewed and bound. The demo merchandise draft is ready for a showcase quote below.`:`${result.procurementDraft.readyCount} product instances reviewed and bound. Merchandise draft only; no formal quote.`;
    }catch{status.textContent='Could not review and bind these products. Check the catalog and scene.'}
    finally{approvedRenderKey='';renderApprovedProductResults()}
  };
  if(P.productBindings?.length){
    const draftHost=host.querySelector('#approvedDraft');
    draftHost.innerHTML='<div class="empty">Checking saved procurement draft…</div>';
    loadApprovedTools().then(async tools=>{
      const revision=await tools.computeLayoutRevision(P,displayed,P.productProfiles);
      const currentSlotIds=new Set(slots.map(slot=>slot.slotId));
      const baseDraft=tools.buildProcurementBom({slots,bindings:P.productBindings.filter(binding=>currentSlotIds.has(binding.slotId)),candidates:approvedCandidates,layoutRevision:revision});
      const draft=P.setSelections?.length?tools.buildSetProcurementDraft({baseDraft,furniture:P.furniture,offers:approvedSetOffers,selections:P.setSelections}):baseDraft;
      if(approvedRenderKey!==key||!draftHost.isConnected)return;
      const purchaseLines=draft.purchaseLines||draft.lines;
      const relations=homeScene?tools.analyzeHomeAssemblies(P.furniture).relations:[];
      const groups=[...new Set(relations.map(relation=>relation.anchorId))].map(anchorId=>{
        const ids=[anchorId,...relations.filter(relation=>relation.anchorId===anchorId).map(relation=>relation.memberId)];
        return {anchorId,ids,items:ids.map(id=>P.furniture.find(item=>item.id===id))};
      });
      const groupChoices=groups.map(group=>{
        const offers=approvedSetOffers.filter(offer=>setOfferFitsGroup(offer,group.items));
        if(!offers.length)return `<div class="empty">${esc(group.anchorId)}: no reviewed set matches these linked products.</div>`;
        const selected=P.setSelections?.find(selection=>selection.instanceIds.includes(group.anchorId))?.offerId||'';
        return `<div class="candidate-line"><b>Set for ${esc(group.anchorId)}</b><select data-set-anchor="${esc(group.anchorId)}" ${readOnly?'disabled':''}><option value="">Buy items separately</option>${offers.map(offer=>`<option value="${esc(offer.offerId)}" ${selected===offer.offerId?'selected':''}>${esc(offer.supplierSku)} · ${esc(offer.price.currency)} ${esc(offer.price.amount)}</option>`).join('')}</select><small>Full linked group only; set components remain separate design items.</small></div>`;
      }).join('');
      draftHost.innerHTML=`<div class="status ${draft.pendingCount?'warn':'ok'}">${draft.readyCount}/${draft.itemCount} reviewed product instances current · ${draft.pendingCount} pending</div>${purchaseLines.map(line=>`<div class="item"><span>${esc(line.kind==='set'?'Supplier set':line.label)}<small>${line.status==='ready_for_quote_review'?`${esc(line.supplierSku)} · ${esc(line.sourceRef)}${line.kind==='set'?` · ${line.components.map(part=>`${esc(part.supplierSku)} × ${part.quantity}`).join(', ')}`:''}`:esc(line.reasons.join(', '))}</small></span><b>× ${line.quantity||1}</b></div>`).join('')}${groupChoices}${P.setSelections?.length?'<button class="btn" id="clearSetChoices" type="button">Buy all items separately</button>':''}<div class="empty">${draft.merchandiseSubtotal?`Merchandise subtotal: ${esc(draft.merchandiseSubtotal.currency)} ${esc(draft.merchandiseSubtotal.amount)}. `:''}${approvedCatalogMode==='demo'?'Showcase quote available below.':'Formal quote: not issued.'}</div>`;
      draftHost.querySelectorAll('[data-set-anchor]').forEach(select=>select.onchange=()=>{
        if(readOnly)return;
        const group=groups.find(value=>value.anchorId===select.dataset.setAnchor),offer=approvedSetOffers.find(value=>value.offerId===select.value);
        snapshot();P.setSelections=(P.setSelections||[]).filter(selection=>!selection.instanceIds.includes(group.anchorId));
        if(offer)P.setSelections.push({offerId:offer.offerId,offerSnapshot:tools.setOfferSnapshot(offer),instanceIds:group.ids});
        save();
      });
      const clear=draftHost.querySelector('#clearSetChoices');
      if(clear)clear.onclick=()=>{if(readOnly)return;snapshot();P.setSelections=[];save()};
      renderDemoQuotePanel({draft,layoutRevision:revision});
    }).catch(()=>{if(approvedRenderKey===key&&draftHost.isConnected)draftHost.innerHTML='<div class="status warn">Saved product binding needs review against the current catalog and layout.</div>'});
  }else renderDemoQuotePanel({draft:null,layoutRevision:null});
}
function candidatePositionReview(line,candidate){
  const result={passed:0,blocked:0,unassessed:0,reasons:new Set()};
  if(['wardrobe','table','chair','vanity','sofa','coffee_table','low_cabinet','bed','desk','cabinet','shelf','locker','phone_booth','counter','stool'].includes(line.category))return {passed:0,blocked:0,unassessed:line.sourceInstanceIds.length,
    reasons:['Product-specific use space needs a verified placement review']};
  const {width,depth}=candidate.dimensionsMm||{};
  for(const instanceId of line.sourceInstanceIds){
    const original=P.furniture.find(item=>item.id===instanceId);
    if(!original){result.unassessed++;result.reasons.add('Linked or room furniture needs its own placement model');continue}
    if(!Number.isFinite(width)||!Number.isFinite(depth)){result.unassessed++;result.reasons.add('Product width/depth is missing');continue}
    let fits=false,routeUnknown=false;
    const instanceReasons=new Set();
    for(const turn of width===depth?[0]:[0,90]){
      const replacement={...original,w:width,h:depth,rot:(original.rot||0)+turn};
      const trial={...P,furniture:P.furniture.map(item=>item.id===instanceId?replacement:item)};
      if(!furnitureHasClearance(replacement,trial)){instanceReasons.add('Footprint or current chair-use zone conflicts');continue}
      if(replacement.islandId&&!trial.furniture.filter(item=>item.islandId===replacement.islandId).every(item=>islandSpacingValid(item,trial))){instanceReasons.add('Workstation island spacing conflicts');continue}
      if(corridorBottlenecks(trial).length){instanceReasons.add('Current aisle-width check fails');continue}
      const route=accessReview(trial);
      if(route.status!=='checked'){routeUnknown=true;continue}
      if(!route.exitConnected||route.unreachableRooms.length||route.unreachableZones.length||route.unreachableIslands.length){instanceReasons.add('Current access route check fails');continue}
      fits=true;break;
    }
    if(fits)result.passed++;
    else{
      if(routeUnknown&&!instanceReasons.size){result.unassessed++;result.reasons.add('Entrance/exit route is not assessable')}
      else result.blocked++;
      instanceReasons.forEach(reason=>result.reasons.add(reason));
    }
  }
  return {...result,reasons:[...result.reasons]};
}
function renderCandidateMatches(){
  const host=$('#productCandidateResults');
  if(!host)return;
  if(!productCandidates.length){host.innerHTML='<p class="empty">No supplier candidates imported.</p>';return}
  if(!productTools){host.innerHTML='<p class="empty">Preparing candidate matching…</p>';return}
  const planKey=productTools.serializeLayout(P);
  if(planKey!==sourcingPlanKey){sourcingPlanKey=planKey;productPlacementReviews.clear()}
  const key=JSON.stringify([sourcingRevision,planKey,latestDesignLines.map(line=>[line.category,line.role,line.kind,line.envelopeMm,line.quantity])]);
  if(key===sourcingRenderKey)return;
  sourcingRenderKey=key;
  host.innerHTML=latestDesignLines.length?latestDesignLines.map((line,lineIndex)=>{
    const result=productTools.matchProducts({category:line.category,role:line.role,envelopeMm:line.envelopeMm},productCandidates);
    const matches=result.matches.map(match=>{
      const item=match.candidate,dimensions=item.dimensionsMm,candidateIndex=productCandidates.indexOf(item),review=productPlacementReviews.get(`${lineIndex}:${candidateIndex}`);
      const reviewText=review?`<small>Current-position check: ${review.passed} pass · ${review.blocked} blocked · ${review.unassessed} unassessed${review.reasons.length?` · ${esc(review.reasons.join('; '))}`:''}</small>`:'';
      const unitNote=item.purchaseUnit==='set'?'Supplier set · component breakdown required':item.purchaseUnit!=='single'?'Purchase unit unknown':'';
      return `<div class="candidate-line"><b>${esc(item.name||item.supplierSku||'Unnamed candidate')}</b><small>${esc(item.supplierSku||'No supplier SKU')} · ${dimensions.width} × ${dimensions.depth} mm · ${esc(item.sourceRef)}</small><small>Research candidate · verify product data and rerun full layout checks before use${unitNote?` · ${unitNote}`:''}</small><button class="btn" type="button" data-product-line="${lineIndex}" data-product-candidate="${candidateIndex}">Check current positions</button>${reviewText}</div>`;
    }).join('');
    const rejected=result.rejected.filter(item=>productCandidates.some(candidate=>candidate.candidateId===item.candidateId&&candidate.category===line.category&&candidate.role===line.role)).map(item=>{
      const candidate=productCandidates.find(value=>value.candidateId===item.candidateId);
      const reason=item.reasons.includes('missing_dimensions')?'width/depth missing':item.reasons.includes('too_large_for_slot')?'larger than the design envelope':item.reasons.includes('unavailable')?'unavailable':'requires review';
      return `<small>${esc(candidate?.name||candidate?.supplierSku||'Unnamed candidate')} · ${reason} · ${esc(candidate?.sourceRef||'Unknown source')}</small>`;
    }).join('');
    return `<div class="candidate-line"><b>${esc(line.label)} × ${line.quantity}</b>${matches||'<small>No matching furniture category, use and size in the imported sources.</small>'}${rejected}</div>`;
  }).join(''):'<p class="empty">Place furniture to see candidate matches.</p>';
  host.querySelectorAll('[data-product-candidate]').forEach(button=>button.onclick=()=>{
    const lineIndex=Number(button.dataset.productLine),candidateIndex=Number(button.dataset.productCandidate);
    productPlacementReviews.set(`${lineIndex}:${candidateIndex}`,candidatePositionReview(latestDesignLines[lineIndex],productCandidates[candidateIndex]));
    sourcingRenderKey='';renderCandidateMatches();
  });
}
function renderHomeRelations(){
  const host=$('#homeRelations');
  if(!host)return;
  const items=P.furniture||[],members=items.filter(item=>['homeChair','coffeeTable'].includes(item.kind));
  if(!members.length){host.innerHTML='';return}
  host.innerHTML=`<div class="empty">Furniture relationships are explicit design links. Each item stays separate in the product list.</div>${members.map(item=>{
    const anchorKinds=item.kind==='homeChair'?['table','vanity']:['sofa'];
    const anchors=items.filter(other=>other.id!==item.id&&anchorKinds.includes(other.kind));
    const current=anchors.some(anchor=>anchor.id===item.linkedTo)?item.linkedTo:'';
    return `<div class="candidate-line"><b>${esc(item.name||item.kind)} · ${esc(item.id)}</b><label>Use with <select data-home-link="${esc(item.id)}" ${readOnly?'disabled':''}><option value="">Independent item</option>${anchors.map(anchor=>`<option value="${esc(anchor.id)}" ${current===anchor.id?'selected':''}>${esc(anchor.name||anchor.kind)} · ${esc(anchor.id)}</option>`).join('')}</select></label>${item.linkedTo&&!current?'<small>Previous relationship is invalid; choose an item or independent.</small>':''}</div>`;
  }).join('')}`;
  host.querySelectorAll('[data-home-link]').forEach(select=>select.onchange=()=>{
    if(readOnly)return;
    const item=P.furniture.find(value=>value.id===select.dataset.homeLink);
    if(!item)return;
    snapshot();
    if(select.value)item.linkedTo=select.value;else delete item.linkedTo;
    save();
  });
}
function renderDesignNeeds(displayed){
  const host=$('#designBom');
  if(!host)return;
  if(designBomLoadError){host.innerHTML='<div class="status bad">Design needs could not load. The illustrative list below remains available.</div>';return}
  if(!designBomModule){host.innerHTML='<div class="empty">Preparing design needs…</div>';return}
  try{
    const result=designBomModule.buildDesignBom(designBomModule.buildProductSlots(displayed));
    latestDesignLines=result.lines;
    host.innerHTML=result.itemCount
      ? `<div class="empty">${result.itemCount} placed items · design needs only; see product status below</div>${result.lines.map(line=>`<div class="item"><span>${esc(line.label)}<small>${line.envelopeMm.width} × ${line.envelopeMm.depth}${line.envelopeMm.height==null?'':` × ${line.envelopeMm.height}`} mm · ${P.productBindings?.some(binding=>line.slotIds.includes(binding.slotId))?'Product selected; review status below':'Needs product'}</small></span><b>× ${line.quantity}</b></div>`).join('')}`
      : '<div class="empty">No furniture placed in this plan yet.</div>';
    renderHomeRelations();
    renderCandidateMatches();
    renderApprovedProductResults();
  }catch{
    host.innerHTML='<div class="status bad">Design needs could not be calculated for this plan. Review the furniture data.</div>';
  }
}
$('#loadApprovedProducts').onclick=async()=>{
  const status=$('#approvedProductStatus'),pin=$('#productSourcePin').value,button=$('#loadApprovedProducts');
  if(!pin){$('#productSourcing').open=true;status.textContent='Enter the product access code under Find supplier candidates, then load the approved catalog.';return}
  button.disabled=true;status.textContent='Loading server-approved product records…';
  try{
    const response=await fetch('api/trusted-products',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin})});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||'Approved catalog unavailable');
    if(!Array.isArray(result.candidates))throw new Error('Approved catalog response is invalid');
    approvedCandidates=result.candidates;approvedSetOffers=Array.isArray(result.setOffers)?result.setOffers:[];approvedCatalogLoaded=true;approvedCatalogMode='server';demoCatalogVersion=null;demoPackages=[];demoPackageKey='';approvedCatalogRevision++;approvedSelections={};approvedRenderKey='';approvedFitOptions=null;P.catalogMode='server';P.catalogVersion=typeof result.catalogVersion==='string'?result.catalogVersion:null;P.demoPackageChoice=null;P.demoQuote=null;P.demoOrder=null;
    status.textContent=`${result.candidates.length} products loaded; ${approvedSetOffers.length} set offers from ${result.sourceCount} configured source(s). Binding still requires complete evidence and a passing layout review.`;
    render();renderDemoPackageCards();localStorage.setItem(STORE,JSON.stringify(P));
    renderApprovedProductResults();
  }catch(error){approvedCandidates=[];approvedSetOffers=[];approvedCatalogLoaded=false;approvedCatalogMode=null;approvedRenderKey='';$('#approvedProductResults').innerHTML='';status.textContent=error.message||'Could not load approved catalog.'}
  finally{button.disabled=false}
};
$('#buildDemoPackages').onclick=()=>buildShowcasePackages();
$('#demoBudget').oninput=()=>renderDemoPackageCards();
$('#productCatalogFile').onchange=async event=>{
  const file=event.target.files?.[0],status=$('#productSourcingStatus');
  if(!file)return;
  if(file.size>2000000){status.textContent='Supplier file must be 2 MB or smaller.';return}
  status.textContent='Reading supplier candidates…';
  try{
    const tools=await loadProductTools(),format=file.name.toLowerCase().endsWith('.csv')?'csv':'json';
    const result=tools.importCatalog({
      id:`file-${Date.now()}`,ref:file.name,observedAt:new Date().toISOString(),format,
      trustSpecs:false,trustPrice:false,trustAvailability:false
    },await file.text());
    productCandidates.push(...result.candidates);
    sourcingRevision++;
    const corrections=result.errors.slice(0,5).map(error=>`row ${error.row}: ${error.reason}`).join('; ');
    const uncategorized=result.candidates.filter(candidate=>!candidate.category).length;
    status.textContent=`${result.candidates.length} research candidates imported; ${result.errors.length} row(s) need correction${corrections?` (${corrections})`:''}${uncategorized?`; ${uncategorized} need an explicit furniture category`:''}. No product is verified for purchase.`;
    renderCandidateMatches();
  }catch{status.textContent='Could not read this supplier file. Check its CSV or JSON format.'}
};
$('#extractProductCandidates').onclick=async()=>{
  const status=$('#productSourcingStatus'),sourceRef=$('#productSourceRef').value.trim(),sourceText=$('#productSourceText').value.trim(),pin=$('#productSourcePin').value;
  if(!sourceRef||sourceText.length<20||!pin){status.textContent='Add a source reference, at least 20 characters of product text, and the extraction access code.';return}
  const button=$('#extractProductCandidates');
  button.disabled=true;status.textContent='Extracting research candidates…';
  try{
    await loadProductTools();
    const response=await fetch('api/extract-products',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      pin,sourceId:`pasted-${Date.now()}`,sourceRef,text:sourceText
    })});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||'Extraction failed');
    productCandidates.push(...(result.candidates||[]));
    sourcingRevision++;
    const unresolved=(result.unresolved||[]).slice(0,5).join('; ');
    status.textContent=`${result.candidates.length} research candidates extracted; ${result.unresolved?.length||0} unresolved item(s)${unresolved?` (${unresolved})`:''}. Verify source data before purchase.`;
    renderCandidateMatches();
  }catch(error){status.textContent=error.message||'Could not extract product candidates.'}
  finally{button.disabled=false}
};
function renderStats(){
  const displayed=allDisplayFurniture(P.furniture),workstations=workstationSeatsForAssessment(P),chairs=displayed.filter(f=>f.kind==='chair').length,meetingChairs=displayed.filter(f=>f.kind==='meetingChair').length;
  const meetingSeats=P.furniture.filter(f=>f.kind==='meeting').length*6+P.objects.filter(o=>o.type==='room'&&o.kind==='meeting'&&meetingRoomFurnitureValid(o,P)).reduce((n,o)=>n+(+o.plannedSeats||0),0);
  const sum=displayed.reduce((n,f)=>n+(+f.price||0),0),issues=checks();
  $('#stats').innerHTML=`<div class="metric"><span>Workstations with chair clearance</span><b>${workstations}</b></div><div class="metric"><span>Planned meeting seats</span><b>${meetingSeats}</b></div><div class="metric"><span>Task chairs</span><b>${chairs}</b></div><div class="metric"><span>Meeting chairs</span><b>${meetingChairs}</b></div><div class="metric"><span>Furniture items</span><b>${displayed.length}</b></div><div class="metric"><span>Illustrative furniture value</span><b>${money(sum)}</b></div><div class="empty">Chair-use allowance is conceptual · demo prices only</div>`;
  const groups=displayed.reduce((m,f)=>{const key=f.sku||`${f.kind}:${f.name}`,entry=m[key]||(m[key]={name:f.name,sku:f.sku||'Needs product',quantity:0});entry.quantity++;return m},{});
  $('#bom').innerHTML=displayed.length?Object.values(groups).map(g=>`<div class="item"><span>${esc(g.name)}<small>${esc(g.sku)}</small></span><b>× ${g.quantity}</b></div>`).join(''):'<div class="empty">No furniture added yet</div>';
  renderDesignNeeds(displayed);
  const activeIssue=issues.find(issue=>issue.key&&issue.key===focusedIssue?.key);focusedIssue=activeIssue?{key:activeIssue.key,targetIds:activeIssue.targetIds,point:activeIssue.point}:null;if(!focusedIssue&&$('#hint').classList.contains('issue-guidance')){$('#hint').classList.remove('issue-guidance');setTool()}
  const issueMarkup=(issue,index)=>issue.targetIds?.length?`<button type="button" class="status ${issue.level} issue-action" data-check-index="${index}" aria-label="Locate issue: ${esc(issue.text)}">${esc(issue.text)} <span aria-hidden="true">→ Show on plan</span></button>`:`<div class="status ${issue.level}">${esc(issue.text)}</div>`;
  $('#checks').innerHTML=issues.length?issues.map(issueMarkup).join(''):'<div class="status ok">No basic conflicts found</div>';
  const routeAlerts=$('#routeAlerts'),accessIssues=issue=>issue.key?.startsWith('route-')||issue.key?.startsWith('aisle-');if(routeAlerts)routeAlerts.innerHTML=issues.some(accessIssues)?`<h2>Access & aisle issues</h2>${issues.map((issue,index)=>accessIssues(issue)?issueMarkup(issue,index):'').join('')}`:'';
  document.querySelectorAll('#checks [data-check-index],#routeAlerts [data-check-index]').forEach(button=>button.onclick=()=>focusCheckIssue(issues[+button.dataset.checkIndex]));
  renderEditGuide(issues);
  return issues;
}
function renderRoomSchedule(){const rooms=P.objects.filter(o=>o.type==='room'),zones=P.objects.filter(o=>o.type==='zone'&&validSharedZone(o,P.objects,P.furniture)),count=kind=>rooms.filter(o=>o.kind===kind&&!o.extraKind).length,zoneCount=kind=>zones.filter(o=>o.kind===kind).length,extra=Object.entries(extraRoomSpecs).filter(([kind])=>rooms.some(o=>o.extraKind===kind)).map(([kind,spec])=>`<div class="item"><span>${spec.name}</span><b>× ${rooms.filter(o=>o.extraKind===kind).length}</b></div>`).join('');$('#roomSchedule').innerHTML=rooms.length||zones.length?`<div class="empty">${P.broker?.fitOutMode==='as_is'?'Fictional existing rooms are fixed · furniture fit is conceptual':'Concept rooms & valid shared-use zones · not construction-ready'}</div>${[['meeting','Meeting rooms'],['office','Private offices'],['pantry','Pantry']].filter(([kind])=>count(kind)).map(([kind,name])=>`<div class="item"><span>${name}</span><b>× ${count(kind)}</b></div>`).join('')}${extra}${[['dining','Dining seats',4],['lounge','Lounge seats',2],['coffee','Coffee bar',1],['reception','Reception',1]].filter(([kind])=>zoneCount(kind)).map(([kind,name,seats])=>`<div class="item"><span>${name}</span><b>× ${zoneCount(kind)*seats}</b></div>`).join('')}`:''}
function comparisonMeasures(objects,furniture,meta,workAreas=null){
  workAreas=workAreas||(objects===P.objects&&furniture===P.furniture?P.workAreas:[...P.drafts,...(P.spaceProposals||[]).map(item=>item.draft)].find(d=>d?.objects===objects&&d?.furniture===furniture)?.workAreas)||P.workAreas||[];
  const brief=P.broker,seatCount=workstationSeatsForAssessment({...P,objects,furniture}),phones=furniture.filter(f=>f.kind==='phone').length;
  const validRooms=objects.filter(o=>o.type==='room'&&(typeof validRoomForAssessment==='function'?validRoomForAssessment(o,{...P,objects,furniture}):roomHasCorridorAccess(o,objects)&&inSite(rect(o)))),validZones=objects.filter(o=>o.type==='zone'&&validSharedZone(o,objects,furniture)),zoneCount=kind=>validZones.filter(z=>z.kind===kind).length;
  const count=kind=>validRooms.filter(o=>o.kind===kind&&!o.extraKind).length,rows=[{name:'Workstations',actual:seatCount,required:brief?.people??meta.requested}];
  for(const area of brief?.requirements?.workAreas||[])rows.push({key:`work-area:${area.id}`,name:`Work area · ${area.name}`,actual:workAreaSeatsForAssessment({...P,objects,furniture,workAreas},area.id),required:area.targetDesks,minimum:area.minimumDesks||0});
  if(brief){rows.push({name:'Meeting rooms',actual:validRooms.filter(o=>o.kind==='meeting'&&!o.extraKind&&o.plannedSeats>=brief.roomSeats).length,required:brief.meetingRooms},{name:'Private offices',actual:count('office'),required:brief.offices},{name:'Executive offices',actual:validRooms.filter(o=>o.kind==='office'&&o.role==='executive').length,required:+brief.officeRoles?.executive||0},{name:'Director offices',actual:validRooms.filter(o=>o.kind==='office'&&o.role==='director').length,required:+brief.officeRoles?.director||0},{name:'Pantry',actual:count('pantry'),required:brief.pantry?1:0},{name:'Dining seats',actual:zoneCount('dining')*4,required:+brief.diningSeats||0},{name:'Lounge seats',actual:zoneCount('lounge')*2,required:+brief.loungeSeats||0},{name:'Coffee bar',actual:zoneCount('coffee'),required:brief.coffeeBar?1:0},{name:'Reception',actual:zoneCount('reception'),required:brief.reception?1:0});for(const space of brief.requirements?.spaces?.filter(s=>s.origin==='extra')||[])rows.push({name:extraRoomSpecs[space.kind]?.name||space.kind,actual:validRooms.filter(o=>o.requirementId===space.id&&(!space.seats||o.plannedSeats>=space.seats)).length,required:space.count})}
  else rows.push({name:'Meeting seats',actual:furniture.filter(f=>f.kind==='meeting').length*6,required:+$('#briefMeeting').value||0});
  rows.push({name:'Phone booths',actual:phones,required:brief?.phones??(+$('#briefPhone').value||0)});
  return rows.filter(row=>row.required>0).map(row=>({...row,shortfall:Math.max(0,row.required-row.actual)}));
}
// A fixed room may change use, but never its shell. Re-plan every soft zone and workstation after the use change.
function buildRoomReuseProposals(base){
  if(P.broker?.fitOutMode!=='as_is'||!base||P.draftsStale)return [];
  const brief=P.broker,before=comparisonMeasures(base.objects,base.furniture,base.meta,base.workAreas||[]),meeting=before.find(row=>row.name==='Meeting rooms'),baseProject={...P,objects:base.objects,furniture:base.furniture},officeActual=base.objects.filter(o=>o.type==='room'&&o.kind==='office'&&!o.extraKind&&validRoomForAssessment(o,baseProject)).length;
  if(!meeting?.shortfall||officeActual<=(Number(brief.offices)||0))return [];
  const proposals=[];
  for(const room of base.objects.filter(o=>o.type==='room'&&o.existing&&o.fixed&&o.kind==='office'&&!o.role)){
    const sourceObjects=JSON.parse(JSON.stringify(base.objects)),changed=sourceObjects.find(o=>o.id===room.id);
    changed.existingKind=room.existingKind||room.kind;changed.kind='meeting';changed.name='Meeting room';changed.plannedSeats=Math.max(1,Number(brief.roomSeats)||6);
    const candidate=conceptAtShift(base.layoutPattern,base.meta.requested,Number(brief.meetingRooms)*Number(brief.roomSeats),Number(brief.phones)||0,base.stationStyle||'hybrid',base.corridorShift||{x:0,y:0},{sourceObjects});
    const converted=candidate.objects.find(o=>o.id===room.id),project={...P,objects:candidate.objects,furniture:candidate.furniture,workAreas:candidate.workAreas||[],drafts:[candidate]};
    const sameShell=base.objects.filter(o=>o.existing&&o.fixed).every(o=>{const next=candidate.objects.find(item=>item.id===o.id);return next&&['x','y','x2','y2'].every(key=>next[key]===o[key])&&next.door?.side===o.door?.side});
    if(!sameShell)continue;
    if(!converted||!validRoomForAssessment(converted,project)||!candidate.objects.filter(o=>o.type==='room').every(o=>validRoomForAssessment(o,project))||!candidate.objects.filter(o=>o.type==='zone').every(o=>validSharedZone(o,candidate.objects,candidate.furniture)))continue;
    if(!candidate.furniture.every(item=>furnitureHasClearance(item,project)&&islandSpacingValid(item,project)))continue;
    const after=comparisonMeasures(candidate.objects,candidate.furniture,candidate.meta,candidate.workAreas||[]),beforeGap=before.reduce((sum,row)=>sum+row.shortfall,0),afterGap=after.reduce((sum,row)=>sum+row.shortfall,0);
    if(afterGap>=beforeGap||before.some(row=>{const next=after.find(item=>(item.key||item.name)===(row.key||row.name));return next&&next.shortfall>row.shortfall}))continue;
    const access=candidate.access;if(access.status!=='checked'||!access.exitConnected||access.unreachableRooms.length||access.unreachableZones.length||access.unreachableIslands.length)continue;
    if(corridorBottlenecks(project).length>corridorBottlenecks({...P,objects:base.objects,furniture:base.furniture}).length)continue;
    if(evaluatePlacementRules(project,brief).some(rule=>rule?.priority==='must'&&rule.status==='fail'))continue;
    proposals.push({id:id(),sourceDraftId:base.id,roomId:room.id,originalKind:room.existingKind||room.kind,plannedKind:'meeting',plannedSeats:changed.plannedSeats,shortfallBefore:beforeGap,shortfallAfter:afterGap,status:'pending',draft:candidate});
  }
  return proposals.sort((a,b)=>a.shortfallAfter-b.shortfallAfter).slice(0,2);
}
function buildSpaceProposals(base){
  if(!P.broker||!base||P.draftsStale)return [];
  const before=comparisonMeasures(base.objects,base.furniture,base.meta,base.workAreas||[]),beforeGap=before.reduce((sum,row)=>sum+row.shortfall,0);
  if(!beforeGap)return [];
  const seen=new Set(),targets=base.objects.filter(o=>o.generated&&['room','zone'].includes(o.type)&&o.spaceKey).filter(o=>{if(seen.has(o.kind))return false;seen.add(o.kind);return true}).slice(0,10),proposals=[];
  for(const target of targets){
    const contract=spaceConstraint(P.broker,target.requirementId,target.kind,target.plannedSeats||target.capacity,target.door?.side);
    if(contract.mode!=='suggest'||!contract.minimumFootprint)continue;
    const candidate=conceptAtShift(base.layoutPattern,base.meta.requested,(+P.broker.meetingRooms||0)*(+P.broker.roomSeats||0),+P.broker.phones||0,base.stationStyle||'hybrid',base.corridorShift||{x:0,y:0},{compactSpaceKey:target.spaceKey});
    const changed=candidate.objects.find(o=>o.spaceKey===target.spaceKey&&o.type===target.type&&o.sizeVariant==='compact'),savedArea=changed?(rect(target).w*rect(target).h-rect(changed).w*rect(changed).h):0;
    if(!changed||savedArea<=0||(target.type==='room'&&changed.plannedSeats<target.plannedSeats)||(target.type==='zone'&&changed.capacity<target.capacity))continue;
    const project={...P,objects:candidate.objects,furniture:candidate.furniture,workAreas:candidate.workAreas||[],drafts:[candidate]},after=comparisonMeasures(candidate.objects,candidate.furniture,candidate.meta,candidate.workAreas||[]),afterGap=after.reduce((sum,row)=>sum+row.shortfall,0);
    if(afterGap>=beforeGap||before.some(row=>(after.find(item=>(item.key||item.name)===(row.key||row.name))?.actual??0)<row.actual)||after.some(row=>row.minimum!=null&&row.actual<row.minimum))continue;
    if(!candidate.objects.filter(o=>o.type==='room').every(o=>validRoomForAssessment(o,project))||!candidate.objects.filter(o=>o.type==='zone').every(o=>validSharedZone(o,candidate.objects,candidate.furniture)))continue;
    if(!candidate.furniture.every(f=>furnitureHasClearance(f,project)&&islandSpacingValid(f,project)))continue;
    const access=candidate.access;if(access.status!=='checked'||!access.exitConnected||access.unreachableRooms.length||access.unreachableZones.length||access.unreachableIslands.length)continue;
    if(corridorBottlenecks(project).length>corridorBottlenecks({...P,objects:base.objects,furniture:base.furniture}).length)continue;
    const placement=evaluatePlacementRules(project,P.broker).filter(Boolean);if(placement.some(rule=>rule.priority==='must'&&rule.status==='fail'))continue;
    const changes=after.map(row=>{const old=before.find(item=>(item.key||item.name)===(row.key||row.name));return old&&row.actual!==old.actual?{name:row.name,before:old.actual,after:row.actual}:null}).filter(Boolean);
    proposals.push({id:id(),sourceDraftId:base.id,spaceKey:target.spaceKey,requirementId:target.requirementId,kind:target.kind,label:target.name||target.kind,contract,from:{size:rect(target),capacity:target.plannedSeats||target.capacity||contract.targetCapacity},to:{size:rect(changed),capacity:changed.plannedSeats||changed.capacity||contract.minimumCapacity},savedArea,shortfallBefore:beforeGap,shortfallAfter:afterGap,changes,validation:'Concept furniture, door, corridor and sampled walking route checked; not code approval',status:'pending',draft:candidate});
  }
  return proposals.sort((a,b)=>(a.shortfallAfter-b.shortfallAfter)||(b.savedArea-a.savedArea)).slice(0,3);
}
function selectDraftWithProposals(draftId){mobileCompareExpanded=false;proposalDisclosure.open=false;roomReuseDisclosure.open=false;applyDraft(draftId);const base=P.drafts.find(d=>d.id===draftId);P.spaceProposals=buildSpaceProposals(base);P.roomReuseProposals=buildRoomReuseProposals(base);save()}
function shortfallPhrase(row){const name=String(row.name||'need').toLowerCase(),label=row.shortfall===1&&name.endsWith('s')?name.slice(0,-1):name;return `${row.shortfall} ${label}`}
function focusPlanTarget(targetId){
  const target=find(targetId);if(!target)return;
  if(!document.body.classList.contains('advanced-on')){document.body.classList.add('advanced-on');const toggle=$('#advancedToggle');if(toggle)toggle.textContent='Close current plan editor'}
  selected=target.id;tool='select';setTool();view='2d';document.querySelectorAll('[data-view]').forEach(button=>button.classList.toggle('active',button.dataset.view==='2d'));
  requestAnimationFrame(()=>{const r=rect(target),width=cv.clientWidth,height=cv.clientHeight,pad=110;V.scale=Math.max(.008,Math.min(.14,(width-pad)/Math.max(r.w,2400),(height-pad)/Math.max(r.h,2400)));V.x=width/2-(r.x+r.w/2)*V.scale;V.y=height/2-(r.y+r.h/2)*V.scale;render();(matchMedia('(max-width:760px)').matches&&!$('#manualSpaceGuide').hidden?$('#manualSpaceGuide'):cv).scrollIntoView({block:'nearest'})});
}
function startManualSpaceProposal(proposalId){
  if(readOnly||P.draftsStale||currentPlanEdited())return;
  const proposal=(P.spaceProposals||[]).find(item=>item.id===proposalId&&item.status==='pending'&&item.sourceDraftId===P.activeDraft),target=proposal&&P.objects.find(object=>object.spaceKey===proposal.spaceKey&&['room','zone'].includes(object.type));if(!target)return;
  P.manualSpaceEdit={proposalId:proposal.id,sourceDraftId:proposal.sourceDraftId,targetId:target.id};previewProposalId=null;save();focusPlanTarget(target.id);
}
function renderManualSpaceGuide(issues=[]){
  const panel=$('#manualSpaceGuide'),state=P.manualSpaceEdit,proposal=(P.spaceProposals||[]).find(item=>item.id===state?.proposalId),target=state&&find(state.targetId),active=P.drafts?.find(d=>d.id===P.activeDraft);
  panel.hidden=readOnly||P.draftsStale||!state||!proposal||!target||!active||state.sourceDraftId!==P.activeDraft||!!P.acceptedAdjustment;
  if(panel.hidden)return;
  const size=rect(target),valid=target.type==='room'?typeof validRoomForAssessment==='function'&&validRoomForAssessment(target,P):target.type==='zone'?validSharedZone(target,P.objects,P.furniture):true,rows=comparisonMeasures(P.objects,P.furniture,active.meta,P.workAreas),before=comparisonMeasures(active.objects,active.furniture,active.meta,active.workAreas||[]),seats=rows.find(row=>row.name==='Workstations')?.actual||0,oldSeats=before.find(row=>row.name==='Workstations')?.actual||0,remaining=rows.filter(row=>row.shortfall).reduce((sum,row)=>sum+row.shortfall,0),warnings=issues.filter(issue=>issue.level==='bad').length;
  $('#manualSpaceTitle').textContent=`Adjust ${target.name||target.kind} yourself`;
  $('#manualSpaceSuggestion').textContent=`Rule-based option: ${(proposal.from.size.w/1000).toFixed(1)} × ${(proposal.from.size.h/1000).toFixed(1)} → ${(proposal.to.size.w/1000).toFixed(1)} × ${(proposal.to.size.h/1000).toFixed(1)} m. Nothing was applied automatically.`;
  $('#manualSpaceFeedback').textContent=`Current: ${Math.round(size.w)} × ${Math.round(size.h)} mm · ${valid?'area furniture and access fit this concept':'area or furniture needs review'} · workstations ${seats} (original ${oldSeats}) · ${remaining} counted need${remaining===1?'':'s'} still missing${warnings?` · ${warnings} basic issue${warnings===1?'':'s'}`:''}.`;
  for(const [key,value] of [['manualSpaceWidth',Math.round(size.w)],['manualSpaceDepth',Math.round(size.h)]]){const input=$(`#${key}`);if(document.activeElement!==input)input.value=value}
  $('#manualSpaceApply').disabled=readOnly;$('#manualSpaceUndo').disabled=readOnly||!history.length||!currentPlanEdited();
}
function applyManualSpaceDimensions(){
  const state=P.manualSpaceEdit,target=state&&find(state.targetId);if(readOnly||!target||!['room','zone'].includes(target.type))return;
  const width=Number($('#manualSpaceWidth').value),depth=Number($('#manualSpaceDepth').value),feedback=$('#manualSpaceFeedback');
  if(!Number.isInteger(width)||!Number.isInteger(depth)||width<1000||depth<1000){feedback.textContent='Enter whole-millimetre width and depth of at least 1000 mm.';return}
  const next={...target,x2:target.x+(Math.sign(target.x2-target.x)||1)*width,y2:target.y+(Math.sign(target.y2-target.y)||1)*depth},bounds=rect(next);
  if(bounds.x<0||bounds.y<0||bounds.x+bounds.w>P.w||bounds.y+bounds.h>P.h){feedback.textContent='This size would extend outside the site. Choose smaller dimensions or move the area first.';return}
  if(target.x2===next.x2&&target.y2===next.y2){feedback.textContent='The area already has that size.';return}
  snapshot();target.x2=next.x2;target.y2=next.y2;save();
}
function renderSpaceProposals(){
  const host=$('#spaceProposals');if(!host)return;const openDetails=new Set([...host.querySelectorAll('details[data-proposal-details][open]')].map(detail=>detail.dataset.proposalDetails)),base=P.drafts?.find(d=>d.id===P.activeDraft),items=(P.spaceProposals||[]).filter(proposal=>proposal.sourceDraftId===P.activeDraft),pending=items.filter(proposal=>proposal.status==='pending'),accepted=items.find(proposal=>proposal.id===P.acceptedAdjustment?.proposalId);
  host.hidden=!P.broker||!base||P.draftsStale||(!pending.length&&!accepted);
  proposalDisclosure.hidden=host.hidden;
  const disclosureLayout=matchMedia('(max-width:760px)').matches?'mobile':'desktop';
  if(proposalDisclosure.dataset.layout!==disclosureLayout){proposalDisclosure.open=false;proposalDisclosure.dataset.layout=disclosureLayout}
  const bestGain=pending[0]?.changes?.find(change=>change.after>change.before),gainText=bestGain?` · ${pending.length>1?'best: ':''}+${shortfallPhrase({name:bestGain.name,shortfall:bestGain.after-bestGain.before})}`:'',remainingText=pending[0]?.shortfallAfter>0?' · other gaps remain':'';
  proposalDisclosure.querySelector('summary').textContent=accepted?'Applied space adjustment':currentPlanEdited()?P.manualSpaceEdit?'Manual adjustment in progress':'Space adjustment paused':`${pending.length} area adjustment option${pending.length===1?'':'s'}${gainText}${remainingText}`;
  if(host.hidden)return;
  if(P.acceptedAdjustment&&accepted){host.innerHTML=`<h3>Applied: ${esc(accepted.label)} compact layout</h3><p>Original A / B / C and client needs are unchanged.</p><button type="button" class="btn" id="undoSpaceAdjustment" ${readOnly?'disabled':''}>Restore original plan</button>`;$('#undoSpaceAdjustment').onclick=()=>{if(readOnly||!confirm('Restore the original A / B / C snapshot? This replaces edits made after the adjustment.'))return;snapshot();P.objects=JSON.parse(JSON.stringify(base.objects));P.furniture=JSON.parse(JSON.stringify(base.furniture));P.workAreas=JSON.parse(JSON.stringify(base.workAreas||[]));P.acceptedAdjustment=null;P.manualSpaceEdit=null;selected=null;save()};return}
  if(currentPlanEdited()){host.innerHTML=P.manualSpaceEdit?'<h3>Manual adjustment in progress</h3><p>The original automatic option is paused. Your edited plan and live checks are shown below; no client requirement was changed.</p><button type="button" class="btn" id="resumeManualSpace">Return to highlighted area</button>':'<h3>Space adjustment paused</h3><p>This plan was edited. Reopen its A / B / C snapshot to review automatic options. Undo is available.</p>';$('#resumeManualSpace')?.addEventListener('click',()=>focusPlanTarget(P.manualSpaceEdit.targetId));return}
  if(!pending.length){host.innerHTML='<h3>No safe adjustment found</h3><p>Keep this plan or edit it manually.</p>';return}
  host.innerHTML=`<h3>${pending.length} possible improvement${pending.length===1?'':'s'}</h3><p>Nothing changes until you choose Use. Client needs stay fixed.</p><div class="space-proposal-list">${pending.map(proposal=>{const preview=previewProposalId===proposal.id,changes=proposal.changes.filter(change=>change.after>change.before).map(change=>`+${shortfallPhrase({name:change.name,shortfall:change.after-change.before})}`),after=comparisonMeasures(proposal.draft.objects,proposal.draft.furniture,proposal.draft.meta,proposal.draft.workAreas||[]),remaining=after.filter(row=>row.shortfall).map(shortfallPhrase),remainingText=remaining.length?`${remaining.slice(0,2).join(' · ')}${remaining.length>2?` · ${remaining.length-2} more`:''}`:'none in counted items',project={...P,objects:proposal.draft.objects,furniture:proposal.draft.furniture,workAreas:proposal.draft.workAreas||[],drafts:[proposal.draft]},aisleWarnings=corridorBottlenecks(project).length,locationWarnings=P.broker&&typeof evaluatePlacementRules==='function'?evaluatePlacementRules(project,P.broker).filter(rule=>rule?.status==='fail').length:0,warningText=aisleWarnings||locationWarnings?`${aisleWarnings} aisle-width and ${locationWarnings} location warning(s) remain`:'No flagged aisle or location issue';return `<article class="space-proposal"><b>${esc(proposal.label)} · compact layout</b><p class="space-proposal-outcome">${esc(changes.join(' · ')||`Counted shortfall ${proposal.shortfallBefore} → ${proposal.shortfallAfter}`)}</p><p class="space-proposal-remaining">${remaining.length?`Still needed: ${esc(remainingText)}`:'Counted needs met'}</p>${aisleWarnings||locationWarnings?`<p class="space-proposal-warning">${esc(warningText)}</p>`:''}<details data-proposal-details="${esc(proposal.id)}" ${openDetails.has(proposal.id)?'open':''}><summary>Size &amp; checks</summary><div class="space-proposal-detail"><p>Size: ${(proposal.from.size.w/1000).toFixed(1)} × ${(proposal.from.size.h/1000).toFixed(1)} → ${(proposal.to.size.w/1000).toFixed(1)} × ${(proposal.to.size.h/1000).toFixed(1)} m · ${((proposal.savedArea)/1e6).toFixed(1)} m² released</p><p>Zone capacity: ${proposal.from.capacity} → ${proposal.to.capacity} · Counted shortfall: ${proposal.shortfallBefore} → ${proposal.shortfallAfter}</p>${remaining.length?`<p>All remaining counted needs: ${esc(remaining.join(' · '))}</p>`:''}<p>${esc(proposal.validation)}.</p></div></details><div class="space-proposal-actions"><button type="button" class="btn" data-preview-proposal="${esc(proposal.id)}" aria-expanded="${preview}">${preview?'Hide preview':'Preview'}</button><button type="button" class="btn primary" data-accept-proposal="${esc(proposal.id)}" ${readOnly?'disabled':''}>Use this option</button><button type="button" class="btn" data-dismiss-proposal="${esc(proposal.id)}" ${readOnly?'disabled':''}>Keep original</button></div>${preview?`<div class="space-proposal-preview"><div><span>Original</span>${comparisonThumbnail(base)}</div><div><span>Adjusted</span>${comparisonThumbnail(proposal.draft)}</div></div>`:''}</article>`}).join('')}</div>`;
  host.querySelectorAll('[data-preview-proposal]').forEach(button=>{
    const card=button.closest('.space-proposal'),actions=button.parentElement,reviewOpen=previewProposalId===button.dataset.previewProposal;
    const manual=document.createElement('button');manual.type='button';manual.className='btn';manual.dataset.manualProposal=button.dataset.previewProposal;manual.textContent='Adjust myself';manual.hidden=!reviewOpen;button.after(manual);
    for(const action of actions.querySelectorAll('[data-accept-proposal],[data-dismiss-proposal]'))action.hidden=!reviewOpen;
    button.textContent=reviewOpen?'Hide review':'Review change';
    if(reviewOpen)card.querySelector('.space-proposal-preview')?.after(actions);
    button.onclick=()=>{previewProposalId=reviewOpen?null:button.dataset.previewProposal;renderSpaceProposals()};
  });
  host.querySelectorAll('[data-manual-proposal]').forEach(button=>button.onclick=()=>startManualSpaceProposal(button.dataset.manualProposal));
  host.querySelectorAll('[data-accept-proposal]').forEach(button=>button.onclick=()=>{if(readOnly||currentPlanEdited())return;const proposal=items.find(item=>item.id===button.dataset.acceptProposal&&item.status==='pending');if(!proposal)return;snapshot();P.objects=JSON.parse(JSON.stringify(proposal.draft.objects));P.furniture=JSON.parse(JSON.stringify(proposal.draft.furniture));P.workAreas=JSON.parse(JSON.stringify(proposal.draft.workAreas||[]));P.acceptedAdjustment={proposalId:proposal.id,sourceDraftId:proposal.sourceDraftId,requirementId:proposal.requirementId,acceptedAt:new Date().toISOString()};P.manualSpaceEdit=null;previewProposalId=null;selected=null;save()});
  host.querySelectorAll('[data-dismiss-proposal]').forEach(button=>button.onclick=()=>{if(readOnly)return;const proposal=items.find(item=>item.id===button.dataset.dismissProposal);if(!proposal)return;snapshot();proposal.status='dismissed';previewProposalId=null;save()});
}
function renderRoomReuseProposals(){
  const host=$('#roomReuseOptions'),base=P.drafts?.find(d=>d.id===P.activeDraft),items=(P.roomReuseProposals||[]).filter(item=>item.sourceDraftId===P.activeDraft),accepted=items.find(item=>item.id===P.acceptedRoomReuse?.proposalId),pending=items.filter(item=>item.status==='pending');
  const hidden=P.broker?.fitOutMode!=='as_is'||!base||P.draftsStale||(!accepted&&!pending.length);roomReuseDisclosure.hidden=hidden;if(hidden)return;
  const layout=matchMedia('(max-width:760px)').matches?'mobile':'desktop';if(roomReuseDisclosure.dataset.layout!==layout){roomReuseDisclosure.open=false;roomReuseDisclosure.dataset.layout=layout}
  roomReuseDisclosure.querySelector('summary').textContent=accepted?'Applied room-use change':`${pending.length} room-use option${pending.length===1?'':'s'} · +1 meeting room${pending.length===1?'':' each'}${pending[0]?.shortfallAfter>0?' · other gaps remain':''}`;
  if(accepted){host.innerHTML=`<h3>Existing office planned as a meeting room</h3><p>Walls and doors stayed fixed. Customer needs and original A/B/C snapshots are unchanged.</p><button type="button" class="btn" id="restoreRoomReuse" ${readOnly?'disabled':''}>Restore original use</button>`;$('#restoreRoomReuse').onclick=()=>{if(readOnly||!confirm('Restore the original A / B / C plan? This replaces later edits to the current plan.'))return;snapshot();P.objects=JSON.parse(JSON.stringify(base.objects));P.furniture=JSON.parse(JSON.stringify(base.furniture));P.workAreas=JSON.parse(JSON.stringify(base.workAreas||[]));P.acceptedRoomReuse=null;roomReusePreviewId=null;selected=null;save()};return}
  if(currentPlanEdited()){host.innerHTML='<h3>Room-use option paused</h3><p>Return to an original A / B / C snapshot to review this option. Your current edits are untouched.</p>';return}
  host.innerHTML=`<h3>${pending.length} possible room-use change${pending.length===1?'':'s'}</h3><p>Fixed shell only · no change until you confirm.</p><div class="space-proposal-list">${pending.map(item=>{const original=base.objects.find(o=>o.id===item.roomId),size=rect(original),after=comparisonMeasures(item.draft.objects,item.draft.furniture,item.draft.meta,item.draft.workAreas||[]),count=(draft,kind)=>draft.objects.filter(o=>o.type==='room'&&o.kind===kind&&!o.extraKind).length,remaining=after.filter(row=>row.shortfall).map(shortfallPhrase),preview=roomReusePreviewId===item.id;return `<article class="space-proposal"><b>Use existing office as a ${item.plannedSeats}-seat meeting room</b><p>${(size.w/1000).toFixed(1)} × ${(size.h/1000).toFixed(1)} m · walls and door unchanged</p><p class="space-proposal-outcome">Meeting rooms ${count(base,'meeting')} → ${count(item.draft,'meeting')} · Offices ${count(base,'office')} → ${count(item.draft,'office')}</p><p class="space-proposal-remaining">${remaining.length?`Still needed: ${esc(remaining.slice(0,3).join(' · '))}`:'No counted shortfall'}</p><p class="empty">Room furniture, door approach and sampled walking routes screened; not move-in or code approval. Existing furniture has not been inventoried.</p><div class="space-proposal-actions"><button type="button" class="btn" data-preview-room-reuse="${esc(item.id)}">${preview?'Hide preview':'Preview'}</button><button type="button" class="btn primary" data-accept-room-reuse="${esc(item.id)}" ${readOnly?'disabled':''}>Use this option</button><button type="button" class="btn" data-dismiss-room-reuse="${esc(item.id)}" ${readOnly?'disabled':''}>Keep original</button></div>${preview?`<div class="space-proposal-preview"><div><span>Original</span>${comparisonThumbnail(base)}</div><div><span>Proposed use</span>${comparisonThumbnail(item.draft)}</div></div>`:''}</article>`}).join('')}</div>`;
  host.querySelectorAll('[data-preview-room-reuse]').forEach(button=>{
    const card=button.closest('.space-proposal'),actions=button.parentElement,reviewOpen=roomReusePreviewId===button.dataset.previewRoomReuse;
    for(const action of actions.querySelectorAll('[data-accept-room-reuse],[data-dismiss-room-reuse]'))action.hidden=!reviewOpen;
    button.textContent=reviewOpen?'Hide review':'Review room change';
    if(reviewOpen)card.querySelector('.space-proposal-preview')?.after(actions);
  });
  host.querySelectorAll('[data-preview-room-reuse]').forEach(button=>button.onclick=()=>{roomReusePreviewId=roomReusePreviewId===button.dataset.previewRoomReuse?null:button.dataset.previewRoomReuse;renderRoomReuseProposals()});
  host.querySelectorAll('[data-accept-room-reuse]').forEach(button=>button.onclick=()=>{if(readOnly||currentPlanEdited())return;const item=items.find(value=>value.id===button.dataset.acceptRoomReuse&&value.status==='pending');if(!item)return;snapshot();P.objects=JSON.parse(JSON.stringify(item.draft.objects));P.furniture=JSON.parse(JSON.stringify(item.draft.furniture));P.workAreas=JSON.parse(JSON.stringify(item.draft.workAreas||[]));P.acceptedRoomReuse={proposalId:item.id,sourceDraftId:item.sourceDraftId,acceptedAt:new Date().toISOString()};roomReusePreviewId=null;selected=null;save()});
  host.querySelectorAll('[data-dismiss-room-reuse]').forEach(button=>button.onclick=()=>{if(readOnly)return;const item=items.find(value=>value.id===button.dataset.dismissRoomReuse);if(!item)return;snapshot();item.status='dismissed';roomReusePreviewId=null;save()});
}
function comparisonThumbnail(d){
  const width=250,height=125,pad=6,scale=Math.min((width-2*pad)/P.w,(height-2*pad)/P.h),ox=(width-P.w*scale)/2,oy=(height-P.h*scale)/2;
  const shape=(r,fill,stroke='none')=>`<rect x="${(ox+r.x*scale).toFixed(1)}" y="${(oy+r.y*scale).toFixed(1)}" width="${Math.max(0,r.w*scale).toFixed(1)}" height="${Math.max(0,r.h*scale).toFixed(1)}" fill="${fill}" stroke="${stroke}"/>`;
  const objects=d.objects||[],furniture=d.furniture||[],workAreas=d.workAreas||[];
  const areas=workAreas.filter(area=>workAreaColor(area.id,workAreas)&&[area.x,area.y,area.x2,area.y2].every(Number.isFinite)).map(area=>shape(rect(area),workAreaColor(area.id,workAreas).desk,workAreaColor(area.id,workAreas).line)).join('');
  const corridors=objects.filter(o=>o.type==='corridor').map(o=>shape(rect(o),'#bfdbfe')).join(''),zones=objects.filter(o=>o.type==='zone').map(o=>shape(rect(o),({dining:'#fcd34d',lounge:'#f9a8d4',coffee:'#c4b5fd',reception:'#5eead4'})[o.kind]||'#e2e8f0','#475569')).join(''),rooms=objects.filter(o=>o.type==='room').map(o=>shape(rect(o),({meeting:'#a7f3d0',office:'#ddd6fe',pantry:'#fed7aa'})[o.kind]||'#e2e8f0','#475569')).join(''),fixed=objects.filter(o=>['column','blocked'].includes(o.type)).map(o=>shape(rect(o),'#64748b')).join(''),displayed=allDisplayFurniture(furniture,objects,{}),desks=displayed.filter(f=>['desk','cubicle','bench2'].includes(f.kind)).map(f=>shape(furnitureRect(f),workAreaColor(f.workAreaId,workAreas)?.line||'#475569')).join(''),chairs=displayed.filter(f=>['chair','meetingChair','diningChair','barStool'].includes(f.kind)).map(f=>shape(furnitureRect(f),'#94a3b8')).join(''),roomItems=displayed.filter(f=>f.derived&&!['chair','meetingChair','diningChair','barStool'].includes(f.kind)).map(f=>shape(furnitureRect(f),'#14532d')).join('');
  const labels=workAreas.filter(area=>workAreaColor(area.id,workAreas)&&[area.x,area.y,area.x2,area.y2].every(Number.isFinite)).map(area=>`<text x="${(ox+area.x*scale+3).toFixed(1)}" y="${(oy+area.y*scale+10).toFixed(1)}" font-size="8" font-weight="700" fill="${workAreaColor(area.id,workAreas).line}">${esc(area.name.slice(0,14))}</text>`).join('');
  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><rect x="${ox.toFixed(1)}" y="${oy.toFixed(1)}" width="${(P.w*scale).toFixed(1)}" height="${(P.h*scale).toFixed(1)}" fill="#fff" stroke="#94a3b8"/>${areas}${corridors}${zones}${rooms}${fixed}${desks}${chairs}${roomItems}${labels}</svg>`;
}
function functionalZoneDiagram(d){
  const width=480,height=300,pad=12,scale=Math.min((width-2*pad)/P.w,(height-2*pad)/P.h),ox=(width-P.w*scale)/2,oy=(height-P.h*scale)/2;
  const box=(r,fill,stroke='none',label='')=>`<rect x="${(ox+r.x*scale).toFixed(1)}" y="${(oy+r.y*scale).toFixed(1)}" width="${Math.max(0,r.w*scale).toFixed(1)}" height="${Math.max(0,r.h*scale).toFixed(1)}" fill="${fill}" stroke="${stroke}">${label?`<title>${esc(label)}</title>`:''}</rect>`;
  const label=(r,name,color)=>r.w*scale>=45&&r.h*scale>=20?`<text x="${(ox+(r.x+r.w/2)*scale).toFixed(1)}" y="${(oy+(r.y+r.h/2)*scale+4).toFixed(1)}" text-anchor="middle" font-size="14" font-weight="700" fill="${color}" pointer-events="none">${esc(String(name).slice(0,Math.max(4,Math.floor(r.w*scale/8))))}</text>`:'';
  const objects=d.objects||[],furniture=d.furniture||[],workAreas=d.workAreas||[],skeleton=d.layoutPattern?layoutSkeleton(d.layoutPattern,d.corridorShift||{x:0,y:0}):null;
  const deskZones=(skeleton?.zones||[]).filter(z=>z.x1>z.x0&&z.y1>z.y0).map(z=>({x:z.x0,y:z.y0,w:z.x1-z.x0,h:z.y1-z.y0}));
  const deskSectors=deskZones.map(r=>box(r,'#eff6ff','#bfdbfe','Open work area')).join('');
  const namedAreas=workAreas.filter(area=>!area.generic&&[area.x,area.y,area.x2,area.y2].every(Number.isFinite)).map(area=>{const r=rect(area);return box(r,'#dbeafe','#3b82f6',area.name)+label(r,area.name,'#1e40af')}).join('');
  const corridors=objects.filter(o=>o.type==='corridor').map(o=>box(rect(o),'#cbd5e1','none','Walkway')).join('');
  const roomColor={meeting:['#bbf7d0','#166534'],office:['#ddd6fe','#5b21b6'],pantry:['#fed7aa','#9a3412'],focus:['#ddd6fe','#5b21b6'],huddle:['#bbf7d0','#166534'],training:['#bbf7d0','#166534'],video:['#bbf7d0','#166534']};
  const rooms=objects.filter(o=>o.type==='room').map(o=>{const r=rect(o),[fill,ink]=roomColor[o.kind]||['#e2e8f0','#334155'],shortName={meeting:'Meeting',office:'Office',pantry:'Pantry',huddle:'Huddle',focus:'Focus',training:'Training',video:'Video'}[o.kind]||o.name||o.kind;return box(r,fill,ink,o.name||roomNames[o.kind]||o.kind)+label(r,shortName,ink)}).join('');
  const zoneColor={dining:['#fde68a','#92400e'],lounge:['#fbcfe8','#9d174d'],coffee:['#ddd6fe','#5b21b6'],reception:['#99f6e4','#115e59']};
  const shared=objects.filter(o=>o.type==='zone').map(o=>{const r=rect(o),[fill,ink]=zoneColor[o.kind]||['#e2e8f0','#334155'];return box(r,fill,ink,o.name||o.kind)+label(r,o.name||o.kind,ink)}).join('');
  const desks=allDisplayFurniture(furniture,objects,{}).filter(f=>['desk','cubicle','bench2'].includes(f.kind)).map(f=>box(furnitureRect(f),'#3b82f6')).join('');
  const fixed=objects.filter(o=>['column','blocked'].includes(o.type)).map(o=>box(rect(o),'#64748b','none',o.type==='column'?'Column':'No-go area')).join('');
  const markers=objects.filter(o=>['door','exit','window'].includes(o.type)).map(o=>`<circle cx="${(ox+o.x*scale).toFixed(1)}" cy="${(oy+o.y*scale).toFixed(1)}" r="${o.type==='window'?3:5}" fill="${o.type==='exit'?'#dc2626':o.type==='window'?'#2563eb':'#0f766e'}"><title>${o.type==='door'?'Entrance':o.type==='exit'?'Exit':'Window'}</title></circle>`).join('');
  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Concept functional-zone plan"><rect x="${ox.toFixed(1)}" y="${oy.toFixed(1)}" width="${(P.w*scale).toFixed(1)}" height="${(P.h*scale).toFixed(1)}" fill="#fff" stroke="#64748b" stroke-width="2"/>${deskSectors}${corridors}${namedAreas}${desks}${shared}${rooms}${fixed}${markers}</svg>`;
}
function currentPlanEdited(project=P){const active=project.drafts?.find(d=>d.id===project.activeDraft);return !!active&&(JSON.stringify(project.objects)!==JSON.stringify(active.objects)||JSON.stringify(project.furniture)!==JSON.stringify(active.furniture)||JSON.stringify(project.workAreas||[])!==JSON.stringify(active.workAreas||[]))}
function accessSummary(access){if(!access||access.status!=='checked')return 'Walking route not assessed';const misses=access.unreachableRooms.length+access.unreachableZones.length+access.unreachableIslands.length;return `${access.exitConnected?'Entrance to exit sampled route found':'No sampled entrance-to-exit route'} · ${misses?`${misses} area(s) need route review`:'room, zone and work-island approaches reached'}`}
function comparisonTradeoff(d,other,otherLabel){const own=comparisonMeasures(d.objects,d.furniture,d.meta),reference=comparisonMeasures(other.objects,other.furniture,other.meta),changes=own.map(row=>{const before=reference.find(item=>item.name===row.name)?.actual??0,delta=row.actual-before;return delta?`${delta>0?'+':''}${delta} ${row.name.toLowerCase()}`:null}).filter(Boolean);return changes.length?`Compared with ${otherLabel}: ${changes.slice(0,3).join(' · ')}${changes.length>3?' · more differences':''}.`:`Compared with ${otherLabel}: the shown quantities match; spatial arrangement differs.`}
function renderComparison(){
  const panel=$('#comparisonPanel'),drafts=P.drafts||[];panel.hidden=!drafts.length;if(!drafts.length)return;
  const openDetails=new Set([...panel.querySelectorAll('details[data-comparison-details][open]')].map(detail=>detail.dataset.comparisonDetails)),editedDetailsOpen=!!panel.querySelector('#comparisonCurrent details[open]');
  panel.querySelector('.comparison-head h2').textContent=P.source?.kind==='simulated'?'Step 3 of 3 · Compare layouts A / B / C':'Compare layouts A / B / C';
  panel.querySelector('.comparison-head p').textContent=P.draftsStale?'Site or needs changed · regenerate to compare again.':'Select a concept · early estimate, not approval.';
  const mobileControls=$('#mobilePlanControls'),mobileSelect=$('#mobilePlanSelect'),mobileToggle=$('#mobileCompareToggle');
  mobileControls.hidden=P.draftsStale;
  if(!P.draftsStale){mobileSelect.innerHTML=drafts.map((draft,index)=>`<option value="${esc(draft.id)}">${'ABC'[index]} · ${esc(draft.label)}</option>`).join('');mobileSelect.value=P.activeDraft;mobileSelect.disabled=readOnly}
  panel.classList.toggle('mobile-all-plans',mobileCompareExpanded);
  mobileToggle.textContent=mobileCompareExpanded?'Show current plan':'Compare all three';
  mobileToggle.setAttribute('aria-expanded',String(mobileCompareExpanded));
  panel.classList.toggle('collapsed',comparisonCollapsed);$('#comparisonToggle').textContent=comparisonCollapsed?'Show comparison':'Hide comparison';$('#comparisonToggle').setAttribute('aria-expanded',String(!comparisonCollapsed));
  const active=P.drafts.find(d=>d.id===P.activeDraft),edited=currentPlanEdited();
  if(P.draftsStale){$('#comparisonGrid').innerHTML='';const current=$('#comparisonCurrent');current.hidden=false;current.classList.remove('bad');current.classList.add('stale');current.textContent='Previous A / B / C snapshots are out of date and cannot be compared or shared. Review the site and needs, then regenerate layouts.';return}
  const otherUnassessed=(P.broker?.requirements?.departments?.length||0)+(P.broker?.requirements?.tradeoffs?.length||0);
  $('#comparisonGrid').innerHTML=drafts.map((d,index)=>{
    const project={...P,objects:d.objects,furniture:d.furniture,workAreas:d.workAreas||[],drafts:[d]};
    const rows=comparisonMeasures(d.objects,d.furniture,d.meta,d.workAreas||[]),gaps=rows.filter(r=>r.shortfall),workstations=rows.find(r=>r.name==='Workstations'),placement=P.broker&&typeof evaluatePlacementRules==='function'?evaluatePlacementRules(project,P.broker).filter(Boolean):[],hardMiss=placement.some(r=>r.priority==='must'&&r.status==='fail'),unassessed=otherUnassessed+placement.filter(r=>r.status==='unknown').length+Math.max(0,(P.broker?.requirements?.relations?.length||0)-placement.length),access=d.access||accessReview(project),routeMiss=access.status==='checked'&&(!access.exitConnected||access.unreachableRooms.length||access.unreachableZones.length||access.unreachableIslands.length),reference=drafts[index===0?1:0],tradeoff=reference?comparisonTradeoff(d,reference,index===0?'B':'A'):'',takeaway=(gaps.length?`Still needed: ${gaps.map(r=>`${r.name} ${r.shortfall}`).join(' · ')}.`:'Shown quantities placed as concepts; professional review still needed.')+(hardMiss?' A required location rule misses the MVP screen.':'')+(unassessed?` ${unassessed} additional requirement(s) not assessed.`:'');
    const aisleWarnings=corridorBottlenecks({...P,objects:d.objects,furniture:d.furniture,drafts:[d]}).length,alerts=[hardMiss?'Location rule needs review':null,routeMiss?'Walking route needs review':null,aisleWarnings?`${aisleWarnings} aisle warning${aisleWarnings===1?'':'s'}`:null,unassessed?`${unassessed} not assessed`:null].filter(Boolean);
    const otherGaps=gaps.filter(row=>row.name!=='Workstations'),teamRows=rows.filter(row=>row.key?.startsWith('work-area:')),teamSummary=teamRows.length?` · Team areas ${teamRows.filter(row=>!row.shortfall).length}/${teamRows.length}`:'',needLine=(otherGaps.length?`Also short: ${otherGaps.slice(0,2).map(shortfallPhrase).join(' · ')}${otherGaps.length>2?` · +${otherGaps.length-2} more`:''}`:workstations?.shortfall?`${shortfallPhrase(workstations)} short`:'Counts met')+teamSummary;
    return `<article class="comparison-item ${d.id===P.activeDraft?'active':''}"><button class="comparison-card ${d.id===P.activeDraft?'active':''}" type="button" data-compare-draft="${esc(d.id)}" aria-pressed="${d.id===P.activeDraft}" ${readOnly||P.draftsStale?'disabled':''}><span class="comparison-card-head"><b>${'ABC'[index]} · ${esc(d.label)}</b><small>${d.id===P.activeDraft?'Viewing':'View plan'}</small></span>${comparisonThumbnail(d)}<span class="comparison-key"><b>Workstations ${workstations?.actual??d.meta.seats}/${workstations?.required??d.meta.requested}</b></span><span class="comparison-need ${gaps.length?'short':''}">${esc(needLine)}</span>${alerts.length?`<span class="comparison-flag">${esc(alerts.join(' · '))}</span>`:''}</button><details class="comparison-details" data-comparison-details="${esc(d.id)}" ${openDetails.has(d.id)?'open':''}><summary>All counts &amp; checks</summary><div class="comparison-details-body"><p class="comparison-purpose">${esc(d.purpose)}</p>${rows.map(r=>`<div class="comparison-row ${r.shortfall?'short':''}"><span>${esc(r.name)}</span><b>${r.actual}/${r.required}</b></div>`).join('')}${placement.map(r=>`<div class="comparison-position ${r.status==='fail'?'short':''}">${esc(r.label)} · ${esc(r.status==='pass'?'Within MVP distance':r.status==='fail'?'Misses MVP distance':'Cannot assess')}<small>${esc(r.reason)}</small></div>`).join('')}<p class="comparison-takeaway">${esc(accessSummary(access))}. ${esc(tradeoff)} ${esc(takeaway)}</p></div></details></article>`;
  }).join('');
  if(edited)panel.querySelector('.comparison-card.active .comparison-card-head small').textContent='Original snapshot';
  const current=$('#comparisonCurrent');current.hidden=!edited;current.classList.remove('stale');
  if(edited){
    const rows=comparisonMeasures(P.objects,P.furniture,active.meta),placement=P.broker&&typeof evaluatePlacementRules==='function'?evaluatePlacementRules(P,P.broker).filter(Boolean):[];
    const positions=placement.map(r=>`${r.priority==='must'?'Required':'Preferred'} ${r.label}: ${r.status==='pass'?'within MVP distance':r.status==='fail'?'misses MVP distance':'cannot assess'} (${r.reason})`);
    const narrow=corridorBottlenecks(P),gaps=rows.filter(r=>r.shortfall),summary=`${gaps.length?`Still short: ${gaps.slice(0,2).map(shortfallPhrase).join(' · ')}${gaps.length>2?` · +${gaps.length-2} more`:''}`:'Counts met'}${narrow.length?` · ${narrow.length} aisle warning${narrow.length===1?'':'s'}`:''}`;
    current.innerHTML=`<b>Current edited plan</b> · ${esc(summary)} <details ${editedDetailsOpen?'open':''}><summary>Counts &amp; checks</summary><p>${esc(rows.map(r=>`${r.name} ${r.actual}/${r.required}${r.shortfall?' short':''}`).join(' · '))}.${positions.length?` Location checks: ${esc(positions.join(' · '))}.`:''} ${esc(accessSummary(accessReview(P)))}. ${narrow.length?`${narrow.length} aisle planning-width issue(s); worst about ${Math.min(...narrow.map(item=>item.clearance))} mm.`:'No marked aisle planning-width issue.'} These screens are not compliance findings.</p></details>`;
    current.classList.toggle('bad',placement.some(r=>r.priority==='must'&&r.status==='fail'));
  }else current.classList.remove('bad');
  panel.querySelectorAll('[data-compare-draft]').forEach(button=>button.onclick=()=>{if(currentPlanEdited()&&!confirm('Opening an A / B / C snapshot replaces the current edited plan. You can use Undo afterward. Continue?'))return;selectDraftWithProposals(button.dataset.compareDraft)});
}
function renderDrafts(){const host=$('#drafts'),drafts=P.drafts||[];if(!drafts.length){host.innerHTML='<div class="empty">Complete the brief to generate plans.</div>';return}if(P.draftsStale){host.innerHTML='<div class="status warn">Previous A / B / C snapshots are out of date. Review the site and needs, then regenerate before comparing or sharing.</div>';return}host.innerHTML=drafts.map(d=>{const gap=Math.max(0,d.meta.requested-d.meta.seats),active=d.id===P.activeDraft,rooms=P.broker?` · Meeting rooms ${d.meta.meetings}/${P.broker.meetingRooms} · Offices ${d.meta.offices}/${P.broker.offices} · Pantry ${d.meta.pantries}/${P.broker.pantry?1:0}`:` · Meeting seats ${d.meta.meetings}`,roomGap=P.broker?Math.max(0,P.broker.meetingRooms-d.meta.meetings)+Math.max(0,P.broker.offices-d.meta.offices)+Math.max(0,(P.broker.pantry?1:0)-d.meta.pantries):0;return `<button class="tool ${active?'active':''}" data-draft="${d.id}" ${readOnly?'disabled':''}><b>${d.label}${active?' · Selected':''}</b><small>${d.purpose}</small><small>Seats ${d.meta.seats}/${d.meta.requested}${rooms} · Booths ${d.meta.phones}/${P.broker?.phones??$('#briefPhone').value}${gap?` · ${gap} seats short`:''}${roomGap?` · ${roomGap} rooms short`:''}</small></button>`}).join('');host.querySelectorAll('[data-draft]').forEach(b=>b.onclick=()=>selectDraftWithProposals(b.dataset.draft))}
function render(){P.rules.main=+$('#mainClear').value||1200;P.rules.minor=+$('#minorClear').value||900;const fixedShell=P.broker?.fitOutMode==='as_is';$('#projectTitle').textContent=`${P.name}${fixedShell?' · Furniture only':''} · ${readOnly?'Read-only':'Saved locally'}`;document.querySelectorAll('#tools [data-tool], [data-setup-tool]').forEach(button=>{if(button.dataset.tool==='select'||button.dataset.setupTool==='select')return;button.disabled=fixedShell;button.title=fixedShell?'Existing rooms and shell are locked in furniture-only mode':''});renderSiteStatus();renderPhaseBar();renderTeamAreaPicker();renderPanel();const issues=renderStats();(view==='2d'?draw2d:draw3d)();renderRoomSchedule();renderDrafts();renderComparison();renderSpaceProposals();renderRoomReuseProposals();renderManualSpaceGuide(issues)}
function pointer(e){const r=cv.getBoundingClientRect();return world(e.clientX-r.left,e.clientY-r.top)}
function moveIslandMember(item,nextX,nextY){const members=item.islandId?P.furniture.filter(f=>f.islandId===item.islandId):[item],box=item.islandId?islandEnvelope(members):furnitureRect(item),dx=Math.max(-box.x,Math.min(P.w-box.x-box.w,nextX-item.x)),dy=Math.max(-box.y,Math.min(P.h-box.y-box.h,nextY-item.y));for(const member of members){member.x+=dx;member.y+=dy}}
cv.addEventListener('pointerdown',e=>{const [x,y]=pointer(e);if(e.button===1||spaceDown){drag={pan:true,x:e.clientX,y:e.clientY,vx:V.x,vy:V.y};return}if(readOnly)return;if(P.broker?.fitOutMode==='as_is'&&tool!=='select'){tool='select';setTool();$('#hint').textContent='Existing rooms and shell are locked. Add or move furniture instead.';return}if(tool==='select'){const displayHit=hitDisplayFurniture(x,y),h=displayHit?editableFurnitureForDisplay(displayHit):hit(x,y);focusedProductId=displayHit?.id||null;selected=h?.id||null;if(h&&!(P.broker?.fitOutMode==='as_is'&&h.existing&&h.fixed)){snapshot();drag={move:h,ox:x-h.x,oy:y-h.y,changed:false}}render();syncProductFocusUi();if(displayHit)$('#hint').textContent=`${displayHit.name} · matching product row highlighted`;return}focusedProductId=null;syncProductFocusUi();snapshot();if(['door','window','exit'].includes(tool)){const placedType=tool,wall=P.objects.find(o=>o.type==='wall'&&lineHit(o,{x:o.x2,y:o.y2},x,y));if(!wall){history.pop();$('#hint').textContent=`Move closer to an exterior wall, then click to place the ${placedType==='door'?'entrance':placedType}.`;return}markSiteChanged();P.objects.push({id:id(),type:placedType,x:clamp(x),y:clamp(y),wallId:wall.id});selected=P.objects.at(-1).id;if(placedType==='door'&&!P.objects.some(o=>o.type==='exit'))tool='exit';else if(placedType==='exit')tool='select';setTool();save();return}const roomKind={meetingRoom:'meeting',officeRoom:'office',pantryRoom:'pantry'}[tool];if(!roomKind)markSiteChanged();drag={create:roomKind?{id:id(),type:'room',kind:roomKind,name:roomNames[roomKind],plannedSeats:roomKind==='meeting'?Number(P.broker?.roomSeats)||6:0,x:clamp(x),y:clamp(y),x2:clamp(x),y2:clamp(y),door:{side:'south',width:900},conceptOnly:true}:{id:id(),type:tool,x:clamp(x),y:clamp(y),x2:clamp(x),y2:clamp(y)}};P.objects.push(drag.create);selected=drag.create.id;render()});
cv.addEventListener('pointermove',e=>{if(!drag)return;if(drag.pan){V.x=drag.vx+e.clientX-drag.x;V.y=drag.vy+e.clientY-drag.y;render();return}const [x,y]=pointer(e);if(drag.create){drag.create.x2=clamp(x);drag.create.y2=clamp(y)}else if(drag.move){const o=drag.move;if(!drag.changed&&!['furniture','room','zone','workArea'].includes(o.type)){markSiteChanged();drag.changed=true}if(o.type==='furniture'){moveIslandMember(o,clamp(x-drag.ox),clamp(y-drag.oy))}else if(o.x2!=null){const dx=clamp(x-drag.ox)-o.x,dy=clamp(y-drag.oy)-o.y;o.x+=dx;o.y+=dy;o.x2+=dx;o.y2+=dy;if(o.type==='zone'){const item=P.furniture.find(f=>f.zoneId===o.id);if(item){item.x+=dx;item.y+=dy}}}else{o.x=clamp(x-drag.ox);o.y=clamp(y-drag.oy)}}render()});
addEventListener('pointerup',()=>{if(drag?.create?.type==='room'){const room=drag.create,corridor=P.objects.find(o=>o.type==='corridor');room.door.side=corridor&&(rect(room).y+rect(room).h/2)>=rect(corridor).y+rect(corridor).h/2?'north':'south'}if(drag&&!drag.pan)save();drag=null});cv.addEventListener('wheel',e=>{e.preventDefault();const r=cv.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top,[wx,wy]=world(mx,my),z=e.deltaY<0?1.12:.89;V.scale=Math.max(.008,Math.min(.18,V.scale*z));V.x=mx-wx*V.scale;V.y=my-wy*V.scale;render()},{passive:false});
addEventListener('keydown',e=>{if(e.code==='Space'&&!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName)){spaceDown=true;e.preventDefault()}});addEventListener('keyup',e=>{if(e.code==='Space')spaceDown=false});
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;document.querySelectorAll('[data-view]').forEach(x=>x.classList.toggle('active',x===b));render()});$('#tools').onclick=e=>{const b=e.target.closest('[data-tool]');if(b){tool=b.dataset.tool;setTool()}};$('#catalog').innerHTML=visibleCatalog.map(c=>`<button class="tool" data-kind="${c.kind}">${esc(c.name)}<small>${esc(c.sku)} · ${c.width} × ${c.depth} × ${c.height} mm</small></button>`).join('');$('#catalog').onclick=e=>{const b=e.target.closest('[data-kind]');if(b)addFurniture(b.dataset.kind)};$('#fitBtn').onclick=fit;$('#undoBtn').onclick=undo;$('#editGuideUndo').onclick=undo;$('#editGuideClose').onclick=()=>{editGuideIssue=null;focusedIssue=null;render()};$('#mainClear').onchange=$('#minorClear').onchange=save;
$('#manualSpaceApply').onclick=applyManualSpaceDimensions;$('#manualSpaceFocus').onclick=()=>{if(P.manualSpaceEdit)focusPlanTarget(P.manualSpaceEdit.targetId)};$('#manualSpaceUndo').onclick=undo;$('#manualSpaceClose').onclick=()=>{P.manualSpaceEdit=null;save()};
$('#comparisonToggle').onclick=()=>{comparisonCollapsed=!comparisonCollapsed;renderComparison()};
$('#mobileCompareToggle').onclick=()=>{mobileCompareExpanded=!mobileCompareExpanded;renderComparison()};
$('#mobilePlanSelect').onchange=event=>{const draftId=event.target.value;if(readOnly||P.draftsStale||draftId===P.activeDraft)return;if(currentPlanEdited()&&!confirm('Opening an A / B / C snapshot replaces the current edited plan. You can use Undo afterward. Continue?')){event.target.value=P.activeDraft;return}selectDraftWithProposals(draftId)};
$('#drafts').addEventListener('click',event=>{if(event.target.closest('[data-draft]')&&currentPlanEdited()&&!confirm('Opening an A / B / C snapshot replaces the current edited plan. You can use Undo afterward. Continue?')){event.preventDefault();event.stopImmediatePropagation()}},true);
$('#generateDrafts').onclick=generateDrafts;
$('#newProject').onclick=()=>{$('#welcomeModal').hidden=false;$('#projectModal').hidden=true;$('#briefModal').hidden=true};
function syncSourceMode(){const upload=document.querySelector('[name="sourceMode"]:checked')?.value==='upload';$('#uploadFields').hidden=!upload;$('#siteFile').required=upload;$('#widthLabel').textContent=upload?'Approx. overall width (mm)':'Clear width (mm)';$('#depthLabel').textContent=upload?'Approx. overall depth (mm)':'Clear depth (mm)';$('#createProjectSubmit').textContent=upload?'Attach plan & create review canvas':'Create review canvas'}
document.querySelectorAll('[name="sourceMode"]').forEach(i=>i.onchange=syncSourceMode);
function makePlanPreview(file){if(!file?.type?.startsWith('image/'))return Promise.resolve(null);return new Promise(resolve=>{const reader=new FileReader();reader.onerror=()=>resolve(null);reader.onload=()=>{const image=new Image();image.onerror=()=>resolve(null);image.onload=()=>{const limit=1600,scale=Math.min(1,limit/Math.max(image.naturalWidth,image.naturalHeight)),c=document.createElement('canvas');c.width=Math.max(1,Math.round(image.naturalWidth*scale));c.height=Math.max(1,Math.round(image.naturalHeight*scale));const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);g.drawImage(image,0,0,c.width,c.height);resolve(c.toDataURL('image/jpeg',.78))};image.src=reader.result};reader.readAsDataURL(file)})}
$('#siteFile').onchange=e=>{const f=e.target.files[0];$('#siteFileMeta').textContent=f?`${f.name} · ${f.size<1048576?Math.max(1,Math.round(f.size/1024))+' KB':(f.size/1048576).toFixed(1)+' MB'}`:'No file selected';$('#siteFileHelp').textContent=f?.type?.startsWith('image/')?'The image will appear below the walls as a tracing reference. Confirm scale and every fixed condition before planning.':'PDF and DWG use assisted import in this MVP. The file name is recorded, and the dimensions create a fallback review canvas.'};
$('#startProject').onclick=()=>{$('#projectForm').reset();$('#siteFileMeta').textContent='No file selected';$('#siteFileHelp').textContent='JPG and PNG are placed under the review canvas for manual checking. PDF and DWG use the assisted-import fallback in this MVP.';syncSourceMode();$('#welcomeModal').hidden=true;$('#projectModal').hidden=false};
$('#cancelProject').onclick=()=>{$('#projectModal').hidden=true;$('#welcomeModal').hidden=false};
$('#projectForm').onsubmit=async e=>{e.preventDefault();const mode=document.querySelector('[name="sourceMode"]:checked')?.value||'dimensions',file=$('#siteFile').files[0];if(mode==='upload'&&!file){$('#siteFile').setCustomValidity('Choose a PDF, JPG, PNG or DWG floor plan.');$('#siteFile').reportValidity();return}$('#siteFile').setCustomValidity('');const submit=$('#createProjectSubmit'),label=submit.textContent;submit.disabled=true;submit.textContent=mode==='upload'?'Preparing review…':label;const preview=mode==='upload'?await makePlanPreview(file):null;submit.disabled=false;submit.textContent=label;const source=mode==='upload'?{kind:'upload',fileName:file.name,fileType:file.type||file.name.split('.').pop()?.toLowerCase(),fileSize:file.size,status:preview?'tracing_reference':'awaiting_recognition',...(preview?{preview}:{})}:{kind:'dimensions'};snapshot();P=fresh($('#projectName').value,+$('#siteWidth').value,+$('#siteHeight').value,source);mobileCompareExpanded=false;selected=null;$('#projectModal').hidden=true;tool='door';setTool();save();fit()};
document.querySelectorAll('[data-setup-tool]').forEach(b=>b.onclick=()=>{tool=b.dataset.setupTool;setTool()});
function openBrief(){
  const ready=siteReadiness();
  if(ready.recognitionPending){const {fileName,fileType,fileSize}=P.source;P.source={kind:'dimensions',originalFile:{fileName,fileType,fileSize}};markSiteChanged();$('#hint').textContent='Using the dimension-based canvas. Mark entrances, exits and fixed constraints before continuing.';save();return}
  if(!ready.ready){tool=ready.entrances?'exit':'door';setTool();$('#setupBar').classList.add('warn');$('#setupText').textContent=`Add ${!ready.entrances?'an entrance':ready.exits?'the remaining fixed conditions':'an emergency exit'} before continuing.`;$('#hint').textContent='The site must have at least one entrance and one emergency exit before concepts are generated.';return}
  P.site.confirmed=true;
  P.site.confirmedAt=new Date().toISOString();
  $('#wizardPeople').value=$('#briefPeople').value;
  $('#wizardMode').value=$('#briefMode').value;
  $('#wizardMeeting').value=$('#briefMeeting').value;
  $('#wizardPhone').value=$('#briefPhone').value;
  const source=P.source?.kind==='dimensions'&&!P.source?.originalFile?'entered dimensions':sourceLabel();
  $('#briefSiteSummary').textContent=`${P.name} · ${(P.w/1000).toFixed(1)} × ${(P.h/1000).toFixed(1)} m · ${source}. Set the planning priorities for three comparable concepts.`;
  $('#briefModal').hidden=false;
  save();
}
$('#openBrief').onclick=openBrief;
$('#backToSetup').onclick=()=>$('#briefModal').hidden=true;
$('#briefForm').onsubmit=e=>{e.preventDefault();$('#briefPeople').value=$('#wizardPeople').value;$('#briefMode').value=$('#wizardMode').value;$('#briefMeeting').value=$('#wizardMeeting').value;$('#briefPhone').value=$('#wizardPhone').value;$('#briefModal').hidden=true;generateDrafts();fit()};
$('#useExample').onclick=()=>{snapshot();P=fresh('Example · 36-person hybrid office',18000,12000,{kind:'example'});P.objects.push({id:id(),type:'door',x:0,y:6000,wallId:P.objects[3].id},{id:id(),type:'exit',x:18000,y:6000,wallId:P.objects[1].id},{id:id(),type:'column',x:8400,y:2500,x2:9000,y2:3100},{id:id(),type:'blocked',x:0,y:0,x2:3200,y2:2400});$('#briefPeople').value=36;$('#briefMode').value='hybrid';$('#briefMeeting').value=12;$('#briefPhone').value=2;$('#welcomeModal').hidden=true;generateDrafts();fit()};
$('#exportBtn').onclick=()=>{const a=document.createElement('a'),data=JSON.stringify(P,null,2);a.href=URL.createObjectURL(new Blob([data],{type:'application/json'}));a.download=`${P.name||'office-plan'}.json`;a.click()};$('#importBtn').onclick=()=>$('#fileInput').click();$('#fileInput').onchange=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{try{const p=JSON.parse(r.result);if(p.version!==1)throw Error();snapshot();P=normalizeProject(p);selected=null;$('#welcomeModal').hidden=true;save();fit()}catch{alert('This is not a valid project file.')}};r.readAsText(f)};
$('#exportReviewSnapshot').onclick=async()=>{
  const button=$('#exportReviewSnapshot'),status=$('#reviewSnapshotStatus');
  if(button.disabled)return;
  button.disabled=true;status.textContent='Calculating this review snapshot…';
  const project=JSON.parse(JSON.stringify(P)),candidates=JSON.parse(JSON.stringify(approvedCandidates));
  const offers=JSON.parse(JSON.stringify(approvedSetOffers));
  const capturedAt=new Date().toISOString(),snapshotId=globalThis.crypto?.randomUUID?.()||id();
  try{
    if(!designBomModule)throw new Error('Design furniture needs are not available.');
    const tools=await loadApprovedTools(),displayed=allDisplayFurniture(project.furniture,project.objects,project.derivedProducts);
    const slots=designBomModule.buildProductSlots(displayed),designBom=designBomModule.buildDesignBom(slots);
    const layoutRevision=await tools.computeLayoutRevision(project,displayed,project.productProfiles);
    const currentSlotIds=new Set(slots.map(slot=>slot.slotId));
    const baseDraft=tools.buildProcurementBom({slots,bindings:(project.productBindings||[]).filter(binding=>currentSlotIds.has(binding.slotId)),candidates,layoutRevision});
    const procurementDraft=project.setSelections?.length?tools.buildSetProcurementDraft({baseDraft,furniture:project.furniture,offers,selections:project.setSelections}):baseDraft;
    const review=tools.createReviewSnapshot({project,displayFurniture:displayed,layoutRevision,designBom,baseDraft,procurementDraft,candidates,offers,snapshotId,capturedAt});
    const url=URL.createObjectURL(new Blob([JSON.stringify(review,null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;
    link.download=`${String(project.name||'project').replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').trim().slice(0,80)||'project'}-review-${capturedAt.slice(0,10)}.json`;
    link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
    status.textContent=`Review snapshot exported: ${review.procurement.readyCount}/${review.procurement.itemCount} product instances current, ${review.procurement.pendingCount} pending. Not a quote or order.`;
  }catch(error){status.textContent=`Review snapshot could not be exported: ${error.message||'calculation failed'}`}
  finally{button.disabled=false}
};
$('#shareBtn').onclick=async()=>{if(P.draftsStale){$('#hint').textContent='Regenerate the concept plans before sharing this site revision.';render();return}const shared=JSON.parse(JSON.stringify(P));if(shared.source?.preview)delete shared.source.preview;const raw=new TextEncoder().encode(JSON.stringify(shared)),text=btoa(String.fromCharCode(...raw));const u=new URL('studio.html',location.href);u.hash='project='+encodeURIComponent(text);await navigator.clipboard.writeText(u);alert('Read-only link copied. The planning data is embedded in the link; the source-plan preview is excluded and the link cannot be revoked after sharing.')};
P=load();if(location.hash.startsWith('#project=')){try{P=normalizeProject(JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(decodeURIComponent(location.hash.slice(9))),x=>x.charCodeAt(0)))));readOnly=true}catch{}}if(readOnly){document.querySelectorAll('#tools button,#catalog button,#newProject,#importBtn,#shareBtn,#generateDrafts,#buildDemoPackages').forEach(b=>b.disabled=true);$('#welcomeModal').hidden=true;$('#projectModal').hidden=true;$('#briefModal').hidden=true;$('#setupBar').hidden=true;$('#hint').textContent='Read-only share · View 2D, 3D, summary and checks';$('#projectTitle').textContent='Read-only share';}else{$('#welcomeModal').hidden=hasSavedProject}$('#projectName').value=P.name;$('#siteWidth').value=P.w;$('#siteHeight').value=P.h;$('#mainClear').value=P.rules.main||1200;$('#minorClear').value=P.rules.minor||900;$('#demoBudget').value=P.demoBudget||75000;syncSourceMode();
let lastCanvasWidth=cv.getBoundingClientRect().width;
new ResizeObserver(()=>{const width=cv.getBoundingClientRect().width,majorWidthChange=lastCanvasWidth>0&&Math.abs(width-lastCanvasWidth)>Math.max(80,lastCanvasWidth*.2);lastCanvasWidth=width;resizeCanvas();if(!V.scale||majorWidthChange)fit();else render()}).observe(cv);
resizeCanvas();fit();setTool();render();renderDemoPackageCards();if(P.catalogMode==='demo')buildShowcasePackages({restore:true});
