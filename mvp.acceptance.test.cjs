// End-to-end acceptance for the three fictional rectangular sites.
const { chromium } = require('playwright');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const assert = require('node:assert/strict');
const path = require('node:path');

const fixtures = {compact:[12000,9000,0],balanced:[18000,12000,2],spacious:[24000,16000,4]};
const server = createServer(async(req,res)=>{
  const name=new URL(req.url,'http://localhost').pathname.slice(1);
  if(!['studio.html','sample-furniture.js','studio.js','broker.js'].includes(name)){res.writeHead(404);res.end();return}
  res.setHeader('Content-Type',name.endsWith('.html')?'text/html; charset=utf-8':'text/javascript; charset=utf-8');
  res.end(await readFile(path.join(__dirname,name)));
});

function validateLayout(project){
  const box=f=>{const swapped=Math.abs(Math.round((f.rot||0)/90))%2,w=swapped?f.h:f.w,h=swapped?f.w:f.h;return {x:f.x-w/2,y:f.y-h/2,w,h}};
  const objectBox=o=>({x:Math.min(o.x,o.x2),y:Math.min(o.y,o.y2),w:Math.abs(o.x2-o.x),h:Math.abs(o.y2-o.y)});
  const overlap=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
  for(const draft of project.drafts){
    const furniture=draft.furniture,blocks=draft.objects.filter(o=>['column','blocked','corridor','room'].includes(o.type)).map(objectBox);
    const rooms=draft.objects.filter(o=>o.type==='room'),zones=draft.objects.filter(o=>o.type==='zone'),corridors=draft.objects.filter(o=>o.type==='corridor');
    for(let i=0;i<rooms.length;i++){
      const room=rooms[i],r=objectBox(room),side=room.door?.side,doorY=side==='north'?r.y:side==='south'?r.y+r.h:r.y+r.h/2,doorX=side==='west'?r.x:side==='east'?r.x+r.w:r.x+r.w/2;
      assert.ok(r.x>=0&&r.y>=0&&r.x+r.w<=project.w&&r.y+r.h<=project.h,`${draft.label}: room outside site`);
      assert.ok(corridors.some(c=>{const q=objectBox(c);return side==='north'?doorX>=q.x&&doorX<=q.x+q.w&&Math.abs(doorY-(q.y+q.h))<=50:side==='south'?doorX>=q.x&&doorX<=q.x+q.w&&Math.abs(doorY-q.y)<=50:side==='west'?doorY>=q.y&&doorY<=q.y+q.h&&Math.abs(doorX-(q.x+q.w))<=50:side==='east'&&doorY>=q.y&&doorY<=q.y+q.h&&Math.abs(doorX-q.x)<=50}),`${draft.label}: room door not on corridor`);
      for(let j=i+1;j<rooms.length;j++)assert.ok(!overlap(r,objectBox(rooms[j])),`${draft.label}: room collision`);
      for(const fixed of draft.objects.filter(o=>['column','blocked','corridor'].includes(o.type)))assert.ok(!overlap(r,objectBox(fixed)),`${draft.label}: room overlaps fixed area`);
    }
    for(let i=0;i<zones.length;i++){
      const zone=zones[i],z=objectBox(zone),linked=furniture.filter(f=>f.zoneId===zone.id);
      assert.ok(z.x>=0&&z.y>=0&&z.x+z.w<=project.w&&z.y+z.h<=project.h,`${draft.label}: shared zone outside site`);
      assert.equal(linked.length,1,`${draft.label}: shared zone needs one demo furniture item`);
      assert.ok(corridors.some(c=>{const q=objectBox(c);return ((Math.abs(z.y-(q.y+q.h))<=50||Math.abs(z.y+z.h-q.y)<=50)&&z.x<q.x+q.w&&z.x+z.w>q.x)||((Math.abs(z.x-(q.x+q.w))<=50||Math.abs(z.x+z.w-q.x)<=50)&&z.y<q.y+q.h&&z.y+z.h>q.y)}),`${draft.label}: shared zone lacks corridor access`);
      for(const other of draft.objects.filter(o=>['column','blocked','corridor','room'].includes(o.type)))assert.ok(!overlap(z,objectBox(other)),`${draft.label}: shared zone overlaps fixed area or room`);
      for(let j=i+1;j<zones.length;j++)assert.ok(!overlap(z,objectBox(zones[j])),`${draft.label}: shared zones overlap`);
      for(const f of furniture){const b=box(f);if(f.zoneId===zone.id)assert.ok(b.x>=z.x&&b.y>=z.y&&b.x+b.w<=z.x+z.w&&b.y+b.h<=z.y+z.h,`${draft.label}: linked furniture outside zone`);else assert.ok(!overlap(z,b),`${draft.label}: unrelated furniture occupies shared zone`)}
    }
    for(let i=0;i<furniture.length;i++){
      const f=furniture[i],b=box(f);
      assert.ok(f.sku?.startsWith('DEMO-'),`${draft.label}: missing demo SKU`);
      assert.ok(b.x>=0&&b.y>=0&&b.x+b.w<=project.w&&b.y+b.h<=project.h,`${draft.label}: ${f.sku} outside site`);
      assert.ok(!blocks.some(x=>overlap(b,x)),`${draft.label}: ${f.sku} overlaps fixed zone or corridor`);
      for(let j=i+1;j<furniture.length;j++)assert.ok(!overlap(b,box(furniture[j])),`${draft.label}: furniture collision`);
    }
  }
}

(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await chromium.launch({channel:'msedge',headless:true});
    const patternsSeen=new Set();
    for(const [fixture,expected] of Object.entries(fixtures)){
      const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/studio.html`);
      await page.locator('#useExample').click();
      await page.locator('#simPeople').fill('40');
      await page.locator(`[data-simulation="${fixture}"]`).click();
      const original=await page.evaluate(()=>structuredClone(P));
      console.log(`${fixture} concept: ${original.objects.filter(o=>o.type==='room'&&o.kind==='meeting').length} meeting, ${original.objects.filter(o=>o.type==='room'&&o.kind==='office').length} office, ${original.objects.filter(o=>o.type==='room'&&o.kind==='pantry').length} pantry, ${original.drafts.find(d=>d.id===original.activeDraft)?.meta.seats||0} workstations`);
      console.log(`${fixture} alternatives: ${original.drafts.map(d=>`${d.layoutPattern} ${d.meta.seats}/${d.meta.requested} seats, ${d.meta.meetings} meeting, ${d.meta.offices} office, ${d.meta.pantries} pantry`).join(' | ')}`);
      assert.deepEqual([original.w,original.h,original.objects.filter(o=>o.type==='column').length],expected);
      assert.equal(original.source.fixtureId,fixture);
      assert.equal(original.drafts.length,3);
      assert.equal(new Set(original.drafts.map(d=>d.layoutPattern)).size,3,'A/B/C should use different spatial patterns');
      original.drafts.forEach(d=>patternsSeen.add(d.layoutPattern));
      assert.equal(await page.locator('#comparisonPanel').isVisible(),true);
      assert.equal(await page.locator('.comparison-card').count(),3);
      assert.equal(await page.locator('.comparison-card svg').count(),3);
      assert.match(await page.locator('.comparison-card').first().innerText(),/Workstations/);
      const visibleCanvas=await page.locator('#canvas').boundingBox();
      assert.ok(visibleCanvas.y+visibleCanvas.height<=1001,'comparison should leave the editing canvas within the viewport');
      validateLayout(original);
      const roomRows=await page.evaluate(()=>brokerAssessment(P).rows.filter(r=>['Private offices','Pantry'].includes(r.name)||r.name.startsWith('Meeting rooms')));
      assert.equal(roomRows.length,3);
      if(fixture==='spacious')assert.ok(roomRows.every(r=>r.status==='Placed · concept'));
      assert.match(await page.locator('#drafts').innerText(),/Meeting rooms 2\/2/);
      assert.equal(await page.locator('#bom .item').count(),new Set(original.furniture.map(f=>f.sku)).size);
      assert.equal(Number(await page.locator('#stats .metric').nth(2).locator('b').innerText()),original.furniture.length);
      assert.equal(await page.locator('#checks .status.bad').count(),0);
      await page.locator('[data-view="3d"]').click();
      await page.locator('[data-view="2d"]').click();
      assert.deepEqual(errors,[]);
      if(fixture==='spacious'){
        await page.locator('#advancedToggle').click();
        await page.locator('[data-tool="officeRoom"]').click();
        const canvas=await page.locator('#canvas').boundingBox();
        const points=await page.evaluate(()=>[screen(1500,1000),screen(4500,4000)]);
        await page.mouse.move(canvas.x+points[0][0],canvas.y+points[0][1]);await page.mouse.down();
        await page.mouse.move(canvas.x+points[1][0],canvas.y+points[1][1],{steps:5});await page.mouse.up();
        assert.equal(await page.evaluate(()=>P.objects.filter(o=>o.type==='room'&&!o.generated).length),1);
        assert.equal(await page.locator('#roomDoorSide').count(),1);
        await page.evaluate(()=>undo());
      }
      if(fixture==='balanced'){
        await page.locator('.comparison-card').nth(1).click();
        assert.equal(await page.evaluate(()=>P.activeDraft===P.drafts[1].id),true,'comparison selection should change the active plan');
        assert.equal(await page.locator('.comparison-card.active').count(),1);
        await page.locator('.comparison-card').first().click();
        await page.locator('#comparisonToggle').click();
        await page.locator('#fitBtn').click();
        const drag=await page.evaluate(()=>{const f=P.furniture.find(item=>['bench2','desk','cubicle'].includes(item.kind));return {from:screen(f.x,f.y),to:screen(f.x,P.h/2),id:f.id}});
        const canvas=await page.locator('#canvas').boundingBox();
        await page.mouse.move(canvas.x+drag.from[0],canvas.y+drag.from[1]);
        await page.mouse.down();
        await page.mouse.move(canvas.x+drag.to[0],canvas.y+drag.to[1],{steps:5});
        await page.mouse.up();
        await page.locator('#comparisonToggle').click();
        assert.match(await page.locator('#comparisonCurrent').innerText(),/Current edited plan/);
        assert.equal(await page.evaluate(id=>P.furniture.find(f=>f.id===id)?.y!==undefined,drag.id),true);
        assert.ok((await page.evaluate(()=>checks())).some(i=>i.level==='bad'&&/corridor/.test(i.text)),'manual drag should flag a blocked corridor');
        assert.equal(Number(await page.locator('#stats .metric').nth(2).locator('b').innerText()),original.furniture.length);
        await page.evaluate(()=>undo());
        assert.equal(await page.locator('#comparisonCurrent').isVisible(),false);
        assert.deepEqual(await page.evaluate(()=>P.furniture.map(f=>[f.sku,f.x,f.y])),original.furniture.map(f=>[f.sku,f.x,f.y]));
      }
      // Export the selected scheme and import into a new browser tab.
      const downloadPromise=page.waitForEvent('download');
      await page.evaluate(()=>document.querySelector('#exportBtn').click());
      const download=await downloadPromise,second=await browser.newPage();
      second.on('pageerror',e=>errors.push(e.message));
      await second.goto(`http://127.0.0.1:${server.address().port}/studio.html`);
      await second.locator('#fileInput').setInputFiles(await download.path());
      await second.waitForFunction(id=>P?.source?.fixtureId===id,fixture);
      assert.deepEqual(await second.evaluate(()=>({source:P.source,furniture:P.furniture.map(f=>[f.sku,f.x,f.y]),drafts:P.drafts.length})),{source:original.source,furniture:original.furniture.map(f=>[f.sku,f.x,f.y]),drafts:3});
      assert.deepEqual(errors,[]);
      console.log(`PASS ${fixture}: 3 schemes, geometry, BOM, 3D and export/import`);
      await second.close();await page.close();
    }
    assert.deepEqual([...patternsSeen].sort(),['core','neighborhood','perimeter','spine'],'sample spaces should exercise every representative pattern');
    const narrow=await browser.newPage({viewport:{width:700,height:900}});
    await narrow.goto(`http://127.0.0.1:${server.address().port}/studio.html`);
    await narrow.locator('#useExample').click();
    await narrow.locator('[data-simulation="balanced"]').click();
    assert.equal(await narrow.locator('.comparison-card').count(),3,'comparison stays available on a narrow screen');
    assert.ok(await narrow.evaluate(()=>document.body.scrollWidth<=innerWidth+1),'narrow comparison should scroll inside its panel');
    await narrow.close();
    const shared=await browser.newPage();
    await shared.goto(`http://127.0.0.1:${server.address().port}/studio.html`);
    await shared.locator('#useExample').click();
    await shared.locator('#simPeople').fill('16');
    await shared.locator('#simOffices').fill('0');
    await shared.locator('#simMeetingRooms').fill('1');
    await shared.locator('#simPantry').uncheck();
    await shared.locator('#simDiningSeats').fill('4');
    await shared.locator('#simLoungeSeats').fill('2');
    await shared.locator('#simCoffeeBar').check();
    await shared.locator('#simReception').check();
    await shared.locator('[data-simulation="spacious"]').click();
    const sharedProject=await shared.evaluate(()=>structuredClone(P));
    const sharedState={brief:sharedProject.broker,zones:sharedProject.drafts.map(d=>({pattern:d.layoutPattern,zones:d.objects.filter(o=>o.type==='zone').map(z=>z.kind),meta:d.meta})),rows:await shared.evaluate(()=>brokerAssessment(P).rows)};
    console.log('shared-use scenario',sharedState.zones.map(d=>`${d.pattern}: ${d.zones.join(',')}`).join(' | '));
    assert.equal(sharedState.brief.diningSeats,4);
    for(const draft of sharedState.zones)assert.deepEqual([...draft.zones].sort(),['coffee','dining','lounge','reception']);
    for(const name of ['Dining seats','Lounge seats','Coffee bar','Reception'])assert.equal(sharedState.rows.find(r=>r.name===name)?.status,'Placed · concept',`${name} should be a valid concept placement`);
    validateLayout(sharedProject);
    assert.equal(await shared.locator('#checks .status.bad').count(),0);
    assert.match(await shared.locator('#comparisonGrid').innerText(),/Dining seats/);
    assert.match(await shared.locator('#roomSchedule').innerText(),/Coffee bar/);
    await shared.close();
    const cramped=await browser.newPage();
    await cramped.goto(`http://127.0.0.1:${server.address().port}/studio.html`);
    await cramped.locator('#useExample').click();
    await cramped.locator('#simDiningSeats').fill('40');
    await cramped.locator('#simLoungeSeats').fill('20');
    await cramped.locator('#simCoffeeBar').check();
    await cramped.locator('#simReception').check();
    await cramped.locator('[data-simulation="compact"]').click();
    const amenityRows=await cramped.evaluate(()=>brokerAssessment(P).rows.filter(r=>['Dining seats','Lounge seats','Coffee bar','Reception'].includes(r.name)));
    assert.ok(amenityRows.some(r=>r.status==='Shortfall'),'over-demanded shared uses must show a shortfall');
    assert.match(await cramped.locator('#quickAssessment').innerText(),/Not a fit yet/);
    await cramped.close();
    const overflow=await browser.newPage();
    await overflow.goto(`http://127.0.0.1:${server.address().port}/studio.html`);
    await overflow.locator('#useExample').click();
    await overflow.locator('#simPeople').fill('120');
    await overflow.locator('[data-simulation="compact"]').click();
    assert.deepEqual(await overflow.evaluate(()=>[P.w,P.h]),[12000,9000]);
    assert.ok(await overflow.evaluate(()=>P.drafts.every(d=>d.meta.seats<d.meta.requested)),'oversubscribed site must report a workstation gap');
    assert.match(await overflow.locator('#quickAssessment').innerText(),/Not a fit yet/);
    console.log('PASS compact over-demand: fixed geometry and visible capacity shortfall');
    await overflow.close();
    const regenerate=await browser.newPage();
    await regenerate.goto(`http://127.0.0.1:${server.address().port}/studio.html`);
    await regenerate.locator('#useExample').click();
    await regenerate.locator('[data-simulation="spacious"]').click();
    const counts=await regenerate.evaluate(()=>{const result=()=>P.drafts.map(d=>({pattern:d.layoutPattern,rooms:d.objects.filter(o=>o.type==='room').length,corridors:d.objects.filter(o=>o.type==='corridor').length}));const first=result();generateDrafts();const second=result();generateDrafts();return [first,second,result()]});
    assert.deepEqual(counts[1],counts[0],'regenerating must not duplicate generated rooms or corridors');
    assert.deepEqual(counts[2],counts[0],'repeated regeneration must remain stable');
    console.log('PASS regenerate: conceptual rooms are not duplicated');
    await regenerate.close();
    const roles=await browser.newPage();
    await roles.goto(`http://127.0.0.1:${server.address().port}/studio.html`);
    await roles.locator('#startProject').click();
    await roles.locator('#naturalBriefText').fill('需要24个工位、1间总经理室和2间总监办公室、2间6人会议室、前台。总经理室优先靠窗。');
    await roles.locator('#naturalBriefExtract').click();
    assert.equal(await roles.locator('#officeExecutive').inputValue(),'1');
    assert.equal(await roles.locator('#officeDirector').inputValue(),'2');
    await roles.locator('#reviewEdit').click();
    await roles.locator('#broker-offices').fill('2');
    await roles.locator('#brokerForm button.primary').click();
    assert.match(await roles.locator('#officeRoleError').innerText(),/must fit within the total/);
    await roles.locator('#broker-offices').fill('3');
    await roles.locator('#brokerForm button.primary').click();
    await roles.locator('[data-simulation="spacious"]').click();
    const roleProject=await roles.evaluate(()=>structuredClone(P));
    assert.equal(roleProject.broker.offices,3);
    assert.equal(roleProject.broker.officeRoles.executive,1);
    assert.equal(roleProject.broker.relations[0].rule,'window');
    assert.ok(roleProject.objects.some(o=>o.type==='room'&&o.role==='executive'&&o.name==='Executive office'));
    assert.equal(roleProject.objects.filter(o=>o.type==='room'&&o.role==='director').length,2);
    assert.ok(await roles.evaluate(()=>placementScore('reception',{x:1200,y:8000})>placementScore('reception',{x:22000,y:8000})),'reception candidates should prefer the marked entrance');
    assert.ok(await roles.evaluate(()=>placementScore('office',{x:4500,y:1200},'executive')>placementScore('office',{x:4500,y:14500},'executive')),'stated executive-office window preference should affect placement ranking');
    validateLayout(roleProject);
    await roles.locator('#brokerResult').click();
    assert.match(await roles.locator('#brokerReportContent').innerText(),/Executive offices/);
    assert.match(await roles.locator('#brokerReportContent').innerText(),/System suggestion · reception near entrance/);
    assert.match(await roles.locator('#brokerReportContent').innerText(),/workstations toward daylight/);
    await roles.close();
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve))}
})().catch(e=>{console.error(e);process.exitCode=1});
