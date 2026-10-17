// A fictional furnished-as-is suite must retain its shell and report missing rooms.
const { chromium }=require('playwright');
const { createServer }=require('node:http');
const { readFile }=require('node:fs/promises');
const assert=require('node:assert/strict');
const path=require('node:path');

  const files=new Set(['studio.html','sample-furniture.js','studio.js','broker.js','zone-program.js','zone-assist.js','src/domain/design-bom.js','src/domain/product-slots.js','src/domain/furniture-taxonomy.js','src/domain/product-use-spec.js']);
const server=createServer(async(req,res)=>{const name=new URL(req.url,'http://localhost').pathname.slice(1);if(!files.has(name)){res.writeHead(404);res.end();return}res.setHeader('Content-Type',name.endsWith('.html')?'text/html; charset=utf-8':'text/javascript; charset=utf-8');res.end(await readFile(path.join(__dirname,name)))});

(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try{
    browser=await chromium.launch({channel:process.env.MVP_BROWSER_CHANNEL||'msedge',headless:true});
    const page=await browser.newPage({viewport:{width:1360,height:900}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/studio.html`);
    await page.locator('#useExample').click();
    await page.locator('#simulationFitOutMode').selectOption('as_is');
    assert.match(await page.locator('#simulationResults').textContent(),/fixed existing-room sketch/);
    const decision=await page.evaluate(()=>{const brief=simulationBrief(),snapshot=decisionSnapshot(brief,simulationPreviews(brief),'spacious','Verify the existing suite before leasing');return {mode:snapshot?.brief.fitOutMode,issue:decisionContinueIssue(snapshot)}});
    assert.deepEqual(decision,{mode:'as_is',issue:''},'shortlist continuation must retain the furnishing mode');
    await page.locator('[data-simulation="spacious"]').click();
    const result=await page.evaluate(()=>{
      const fixed=project=>project.objects.filter(o=>o.existing&&o.fixed).map(o=>({type:o.type,kind:o.kind,x:o.x,y:o.y,x2:o.x2,y2:o.y2,door:o.door}));
      const baseline=fixed(P),rooms=P.objects.filter(o=>o.type==='room'),drafts=P.drafts.map(d=>({fixed:fixed(d),generatedRooms:d.objects.filter(o=>o.type==='room'&&o.generated).length,generatedCorridors:d.objects.filter(o=>o.type==='corridor'&&o.generated).length}));
      const rows=brokerAssessment(P).rows.filter(row=>/Meeting rooms|Private offices|Pantry/.test(row.name)).map(row=>({name:row.name,status:row.status,actual:row.actual}));
      const validity=rooms.map(room=>({kind:room.kind,furniture:roomFurnitureValid(room,P),access:roomHasCorridorAccess(room,P.objects)}));
      return {mode:P.broker.fitOutMode,source:P.source.fixtureId,baseline,drafts,rows,validity,issues:checks().filter(issue=>issue.level==='bad').map(issue=>issue.text),saved:JSON.parse(localStorage.getItem(STORE)).broker.fitOutMode};
    });
    assert.equal(result.mode,'as_is');assert.equal(result.saved,'as_is');assert.equal(result.source,'spacious');
    assert.equal(result.baseline.filter(item=>item.type==='room').length,5);
    assert.equal(result.drafts.length,3);
    for(const draft of result.drafts){assert.deepEqual(draft.fixed,result.baseline,'every A/B/C plan keeps the same property shell');assert.equal(draft.generatedRooms,0,'furniture-only must not fabricate rooms');assert.equal(draft.generatedCorridors,0,'furniture-only must not fabricate corridors')}
    assert.ok(result.validity.every(item=>item.furniture&&item.access),JSON.stringify(result.validity));
    assert.equal(result.rows.find(row=>row.name.startsWith('Meeting rooms')).status,'Shortfall');
    assert.equal(result.rows.find(row=>row.name==='Private offices').status,'Placed · concept');
    assert.equal(result.rows.find(row=>row.name==='Pantry').status,'Placed · concept');
    assert.deepEqual(result.issues,[],'the fixed sample rooms and furniture must have no hard geometry conflicts');
    await page.evaluate(()=>{selected=P.objects.find(o=>o.type==='room').id;render()});
    assert.equal(await page.locator('#inspector #deleteSelected').count(),0,'existing rooms cannot be deleted');
    assert.equal(await page.locator('#inspector input').count(),0,'existing room size and role cannot be edited');
    assert.equal(await page.locator('#tools [data-tool="meetingRoom"]').isDisabled(),true);
    await page.reload();
    assert.equal(await page.evaluate(()=>P.broker.fitOutMode),'as_is');
    assert.deepEqual(await page.evaluate(()=>P.objects.filter(o=>o.existing&&o.fixed).map(o=>({type:o.type,kind:o.kind,x:o.x,y:o.y,x2:o.x2,y2:o.y2,door:o.door}))),result.baseline,'local save/reload must retain the fixed shell');
    await page.locator('#planAdjustOpen').click();await page.locator('#zoneProgramOpen').click();
    await page.locator('[data-program-field="people"]').fill('38');
    await page.locator('#zoneProgramAfterMap svg').waitFor({timeout:30000});
    assert.equal(await page.evaluate(()=>P.broker.people),40,'preview must not silently edit needs');
    await page.locator('#zoneProgramSave').click();
    assert.equal(await page.evaluate(()=>P.broker.fitOutMode),'as_is','changing needs must preserve furniture-only mode');
    assert.deepEqual(await page.evaluate(()=>P.objects.filter(o=>o.existing&&o.fixed).map(o=>({type:o.type,kind:o.kind,x:o.x,y:o.y,x2:o.x2,y2:o.y2,door:o.door}))),result.baseline,'regeneration must preserve the property shell');
    assert.equal(await page.evaluate(()=>P.drafts.every(d=>d.objects.every(o=>o.type!=='room'||!o.generated))),true);
    for(const [fixture,roomCount] of [['compact',2],['balanced',2]]){
      await page.evaluate(()=>showSimulationChooser());
      await page.locator('#simulationFitOutMode').selectOption('as_is');
      await page.locator(`[data-simulation="${fixture}"]`).click();
      const sample=await page.evaluate(()=>({rooms:P.objects.filter(o=>o.type==='room').length,generations:P.drafts.map(d=>d.objects.filter(o=>o.type==='room'&&o.generated).length),valid:P.objects.filter(o=>o.type==='room').every(o=>roomFurnitureValid(o,P)&&roomHasCorridorAccess(o,P.objects)),issues:checks().filter(issue=>issue.level==='bad').map(issue=>issue.text),pantry:brokerAssessment(P).rows.find(row=>row.name==='Pantry')?.status}));
      assert.equal(sample.rooms,roomCount,fixture);assert.deepEqual(sample.generations,[0,0,0],fixture);assert.equal(sample.valid,true,fixture);assert.deepEqual(sample.issues,[],fixture);assert.equal(sample.pantry,'Shortfall',fixture);
    }
    const mobile=await browser.newPage({viewport:{width:390,height:844}});
    await mobile.goto(`http://127.0.0.1:${server.address().port}/studio.html`);
    await mobile.locator('#useExample').click();
    await mobile.locator('#simulationFitOutMode').selectOption('as_is');
    const firstCardY=(await mobile.locator('#simulationResults .simulation-card').first().boundingBox()).y;
    assert.ok(firstCardY<370,`furniture-only choice must keep the first sample visible near the top on a phone (${firstCardY}px)`);
    await mobile.close();
    assert.deepEqual(errors,[]);
    console.log('PASS furnished-as-is: fixed shell, unmet room gaps, valid room furniture, and reload');
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
})().catch(error=>{console.error(error);process.exitCode=1});
