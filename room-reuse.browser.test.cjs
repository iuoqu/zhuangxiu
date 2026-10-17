// Fixed MVP values: a 5.6 × 3.0 m office can host six meeting seats;
// a 3.0 × 3.0 m office cannot. No customer trial is needed to verify either claim.
const { chromium }=require('playwright');
const { createServer }=require('node:http');
const { readFile }=require('node:fs/promises');
const assert=require('node:assert/strict');
const path=require('node:path');

  const files=new Set(['studio.html','sample-furniture.js','studio.js','broker.js','zone-program.js','zone-assist.js','src/domain/design-bom.js','src/domain/product-slots.js','src/domain/furniture-taxonomy.js','src/domain/product-use-spec.js']);
const server=createServer(async(req,res)=>{const name=new URL(req.url,'http://localhost').pathname.slice(1);if(!files.has(name)){res.writeHead(404);res.end();return}res.setHeader('Content-Type',name.endsWith('.html')?'text/html; charset=utf-8':'text/javascript; charset=utf-8');res.end(await readFile(path.join(__dirname,name)))});
const cases=[
  {name:'fits',fixture:'spacious',people:'12',meetings:'2',seats:'6',offices:'2',proposal:true},
  {name:'room too small',fixture:'compact',people:'12',meetings:'2',seats:'6',offices:'0',proposal:false},
  {name:'ten-seat furniture too large',fixture:'spacious',people:'12',meetings:'2',seats:'10',offices:'2',proposal:false},
  {name:'office not surplus',fixture:'spacious',people:'12',meetings:'2',seats:'6',offices:'3',proposal:false}
];

(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try{
    browser=await chromium.launch({channel:process.env.MVP_BROWSER_CHANNEL||'msedge',headless:true});
    for(const scenario of cases){
      const page=await browser.newPage({viewport:{width:1360,height:900}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/studio.html`);
      await page.locator('#useExample').click();
      await page.locator('#simulationFitOutMode').selectOption('as_is');
      await page.locator('#simulationNeedsDetails summary').click();
      await page.locator('#simPeople').fill(scenario.people);
      await page.locator('#simMeetingRooms').fill(scenario.meetings);
      await page.locator('#simRoomSeats').fill(scenario.seats);
      await page.locator('#simOffices').fill(scenario.offices);
      await page.locator('#simPhones').fill('0');
      await page.locator('#simulationRefresh').click();
      await page.locator(`[data-simulation="${scenario.fixture}"]`).click();
      const baseline=await page.evaluate(()=>({brief:structuredClone(P.broker),objects:structuredClone(P.objects),furniture:structuredClone(P.furniture),proposals:P.roomReuseProposals.map(item=>({id:item.id,roomId:item.roomId,status:item.status,after:item.shortfallAfter,before:item.shortfallBefore})),fixed:P.objects.filter(o=>o.existing&&o.fixed).map(o=>({id:o.id,x:o.x,y:o.y,x2:o.x2,y2:o.y2,door:o.door?.side}))}));
      assert.equal(baseline.proposals.length,scenario.proposal?1:0,`${scenario.name}: bounded proposal count`);
      if(scenario.proposal){
        const option=page.locator('#roomReuseOptions');
        assert.equal(await page.locator('#roomReuseDisclosure').evaluate(el=>el.open),false,'desktop also starts with a one-line optional suggestion');
        assert.match(await page.locator('#roomReuseDisclosure > summary').innerText(),/\+1 meeting room/);
        await page.setViewportSize({width:390,height:844});await page.evaluate(()=>render());
        assert.equal(await page.locator('#roomReuseDisclosure summary').isVisible(),true,'phone keeps the room-use suggestion behind a clear summary');
        await page.locator('#roomReuseDisclosure summary').click();
        assert.equal(await page.locator('[data-accept-room-reuse]').isVisible(),false,'the decision stays folded until the room change is reviewed');
        assert.equal(await page.locator('#roomReuseDisclosure').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,'phone suggestion must not overflow horizontally');
        await page.setViewportSize({width:1360,height:900});await page.evaluate(()=>render());
        assert.equal(await page.locator('#roomReuseDisclosure').evaluate(el=>el.open),false,'resizing does not expose the optional decision by default');
        await page.locator('#roomReuseDisclosure > summary').click();
        assert.match(await option.innerText(),/Use existing office as a 6-seat meeting room/);
        await page.locator('[data-preview-room-reuse]').click();
        assert.equal(await page.locator('[data-accept-room-reuse]').isVisible(),true);
        assert.equal(await page.locator('#roomReuseOptions .space-proposal-preview svg').count(),2);
        assert.deepEqual(await page.evaluate(()=>({brief:P.broker,objects:P.objects,furniture:P.furniture})),{brief:baseline.brief,objects:baseline.objects,furniture:baseline.furniture},'preview cannot edit the current plan or brief');
        await page.locator('[data-accept-room-reuse]').click();
        const applied=await page.evaluate(()=>({rooms:P.objects.filter(o=>o.type==='room').map(o=>({id:o.id,kind:o.kind,existingKind:o.existingKind,x:o.x,y:o.y,x2:o.x2,y2:o.y2,door:o.door?.side})),fixed:P.objects.filter(o=>o.existing&&o.fixed).map(o=>({id:o.id,x:o.x,y:o.y,x2:o.x2,y2:o.y2,door:o.door?.side})),measures:comparisonMeasures(P.objects,P.furniture,P.drafts[0].meta),bad:checks().filter(issue=>issue.level==='bad').map(issue=>issue.text),accepted:P.acceptedRoomReuse,brief:P.broker,valid:P.objects.filter(o=>o.type==='room').every(o=>roomFurnitureValid(o,P)&&roomHasCorridorAccess(o,P.objects)),newChairs:meetingRoomFurniture(P.objects.find(o=>o.existingKind==='office'&&o.kind==='meeting')).filter(item=>item.kind==='meetingChair').length}));
        assert.deepEqual(applied.fixed,baseline.fixed,'every fixed boundary and door stays in place');
        assert.equal(applied.rooms.filter(o=>o.kind==='meeting').length,2);
        assert.equal(applied.rooms.filter(o=>o.kind==='office').length,2);
        assert.equal(applied.rooms.find(o=>o.existingKind==='office'&&o.kind==='meeting')?.door,'north');
        assert.equal(applied.measures.find(row=>row.name==='Meeting rooms').shortfall,0);
        assert.equal(applied.measures.find(row=>row.name==='Private offices').shortfall,0);
        assert.equal(applied.measures.find(row=>row.name==='Workstations').shortfall,0,'the twelve requested desks must still fit');
        assert.equal(applied.valid,true);assert.equal(applied.newChairs,6);assert.deepEqual(applied.bad,[]);assert.deepEqual(applied.brief,baseline.brief);
        assert.equal(applied.accepted?.proposalId,baseline.proposals[0].id);
        await page.evaluate(()=>undo());
        assert.deepEqual(await page.evaluate(()=>P.objects),baseline.objects,'Undo restores the original use');
        await page.locator('[data-preview-room-reuse]').click();
        await page.locator('[data-accept-room-reuse]').click();
        await page.reload();
        assert.equal(await page.evaluate(()=>P.acceptedRoomReuse?.proposalId),baseline.proposals[0].id,'acceptance survives local reload');
        await page.locator('#roomReuseDisclosure > summary').click();
        page.once('dialog',dialog=>dialog.accept());
        await page.locator('#restoreRoomReuse').click();
        assert.deepEqual(await page.evaluate(()=>P.objects),baseline.objects,'Restore brings back the original use after reload');
        await page.locator('[data-preview-room-reuse]').click();
        await page.locator('[data-dismiss-room-reuse]').click();
        assert.deepEqual(await page.evaluate(()=>P.objects),baseline.objects,'declining cannot alter the shell or furniture');
        await page.reload();
        assert.equal(await page.evaluate(()=>P.roomReuseProposals[0].status),'dismissed','decline survives reload');
      }else{
        assert.equal(await page.locator('#roomReuseDisclosure').isVisible(),false,`${scenario.name}: no unsafe option shown`);
        assert.deepEqual(await page.evaluate(()=>P.objects),baseline.objects,`${scenario.name}: shell unchanged`);
      }
      assert.deepEqual(errors,[],`${scenario.name}: no browser errors`);
      await page.close();
    }
    console.log('PASS room reuse: fixed test values, furniture fit, no-regression filter, preview, apply, undo and reload');
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
})().catch(error=>{console.error(error);process.exitCode=1});
