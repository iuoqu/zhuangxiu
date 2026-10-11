// A counted shortfall should lead only to an option that actually improves it.
const { chromium }=require('playwright');
const { createServer }=require('node:http');
const { readFile, mkdir }=require('node:fs/promises');
const assert=require('node:assert/strict');
const path=require('node:path');

const files=new Set(['studio.html','sample-furniture.js','studio.js','broker.js','zone-program.js','zone-assist.js']);
const server=createServer(async(req,res)=>{const name=new URL(req.url,'http://localhost').pathname.slice(1);if(!files.has(name)){res.writeHead(404);res.end();return}res.setHeader('Content-Type',name.endsWith('.html')?'text/html; charset=utf-8':'text/javascript; charset=utf-8');res.end(await readFile(path.join(__dirname,name)))});

async function sample(browser,base,fixture,{mode='concept',people='40',meetings='2',seats='6',offices='3'}={}){
  const page=await browser.newPage({viewport:{width:1360,height:900}});
  await page.goto(base);
  await page.locator('#useExample').click();
  await page.locator('#simulationFitOutMode').selectOption(mode);
  await page.locator('#simulationNeedsDetails summary').click();
  await page.locator('#simPeople').fill(people);
  await page.locator('#simMeetingRooms').fill(meetings);
  await page.locator('#simRoomSeats').fill(seats);
  await page.locator('#simOffices').fill(offices);
  await page.locator('#simPhones').fill('0');
  await page.locator('#simulationRefresh').click();
  await page.locator(`[data-simulation="${fixture}"]`).click();
  return page;
}
const state=page=>page.evaluate(()=>({brief:structuredClone(P.broker),objects:structuredClone(P.objects),furniture:structuredClone(P.furniture)}));

(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try{
    browser=await chromium.launch({channel:process.env.MVP_BROWSER_CHANNEL||'msedge',headless:true});
    const base=`http://127.0.0.1:${server.address().port}/studio.html`;
    const meeting=await sample(browser,base,'spacious',{mode:'as_is',people:'12',meetings:'2',seats:'6',offices:'2'}),meetingErrors=[];
    meeting.on('pageerror',error=>meetingErrors.push(error.message));
    assert.match(await meeting.locator('#quickAssessment').innerText(),/1 meeting room short/i);
    assert.match(await meeting.locator('#quickAssessment').innerText(),/Checked option:.*\+1 meeting room/i);
    if(process.env.MVP_UI_SCREENSHOT_DIR){await mkdir(process.env.MVP_UI_SCREENSHOT_DIR,{recursive:true});await meeting.screenshot({path:path.join(process.env.MVP_UI_SCREENSHOT_DIR,'office-gap-meeting-desktop.png'),fullPage:true})}
    const originalMeeting=await state(meeting);
    await meeting.setViewportSize({width:390,height:844});await meeting.evaluate(()=>render());
    assert.equal(await meeting.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'gap action fits a phone');
    if(process.env.MVP_UI_SCREENSHOT_DIR)await meeting.screenshot({path:path.join(process.env.MVP_UI_SCREENSHOT_DIR,'office-gap-meeting-mobile.png'),fullPage:true});
    await meeting.locator('#quickPreviewOption').click();
    assert.equal(await meeting.locator('#roomReuseDisclosure').evaluate(element=>element.open),true);
    assert.equal(await meeting.locator('#roomReuseOptions .space-proposal-preview svg').count(),2);
    assert.deepEqual(await state(meeting),originalMeeting,'preview never edits needs or the plan');
    await meeting.locator('[data-accept-room-reuse]').click();
    assert.ok(await meeting.evaluate(()=>P.acceptedRoomReuse?.proposalId),'only explicit Use accepts the option');
    assert.doesNotMatch(await meeting.locator('#quickAssessment').innerText(),/Not a fit yet/,'accepted room use closes the counted gap');
    assert.deepEqual(await meeting.evaluate(()=>P.broker),originalMeeting.brief,'accepting keeps the client brief');
    meeting.once('dialog',dialog=>dialog.accept());
    await meeting.locator('#restoreRoomReuse').click();
    assert.deepEqual(await state(meeting),originalMeeting,'restore brings back the original layout and brief');
    await meeting.locator('[data-preview-room-reuse]').click();
    await meeting.locator('[data-dismiss-room-reuse]').click();
    assert.equal(await meeting.locator('#quickPreviewOption').count(),0,'declining removes the reviewed option from the result card');
    assert.match(await meeting.locator('#quickAssessment').innerText(),/No checked automatic option/);
    assert.deepEqual(meetingErrors,[]);await meeting.close();

    const partial=await sample(browser,base,'compact',{people:'40',meetings:'2',seats:'6',offices:'3'}),partialErrors=[];
    partial.on('pageerror',error=>partialErrors.push(error.message));
    assert.match(await partial.locator('#quickAssessment').innerText(),/workstations short/i);
    assert.match(await partial.locator('#quickAssessment').innerText(),/\+1 private office/i);
    assert.match(await partial.locator('#quickAssessment').innerText(),/Workstations still short/i,'the unrelated first gap is not presented as solved');
    if(process.env.MVP_UI_SCREENSHOT_DIR)await partial.screenshot({path:path.join(process.env.MVP_UI_SCREENSHOT_DIR,'office-gap-partial-desktop.png'),fullPage:true});
    const originalPartial=await state(partial);
    await partial.locator('#quickPreviewOption').click();
    assert.equal(await partial.locator('#proposalDisclosure').evaluate(element=>element.open),true);
    assert.equal(await partial.locator('.space-proposal-preview svg').count(),2);
    assert.deepEqual(await state(partial),originalPartial);
    await partial.locator('[data-accept-proposal]').click();
    assert.ok(await partial.evaluate(()=>P.acceptedAdjustment?.proposalId));
    assert.match(await partial.locator('#quickAssessment').innerText(),/Not a fit yet/,'partial improvement never claims the space fits');
    assert.deepEqual(await partial.evaluate(()=>P.broker),originalPartial.brief);
    assert.deepEqual(partialErrors,[]);await partial.close();

    const noOption=await sample(browser,base,'compact',{mode:'as_is',people:'12',meetings:'2',seats:'6',offices:'0'}),noOptionErrors=[];
    noOption.on('pageerror',error=>noOptionErrors.push(error.message));
    assert.equal(await noOption.locator('#quickPreviewOption').count(),0,'unsafe or absent options are not offered');
    assert.match(await noOption.locator('#quickAssessment').innerText(),/No checked automatic option for these counted gaps/);
    if(process.env.MVP_UI_SCREENSHOT_DIR)await noOption.screenshot({path:path.join(process.env.MVP_UI_SCREENSHOT_DIR,'office-gap-no-option-desktop.png'),fullPage:true});
    const originalNoOption=await state(noOption);
    await noOption.locator('#quickTrySpace').click();
    assert.equal(await noOption.locator('#simulationModal').isVisible(),true,'the safe fallback compares other samples');
    assert.deepEqual(await state(noOption),originalNoOption,'opening the sample chooser is non-mutating');
    noOption.once('dialog',dialog=>dialog.dismiss());
    await noOption.locator('[data-simulation="spacious"]').click();
    assert.deepEqual(await state(noOption),originalNoOption,'declining replacement keeps the current local plan');
    assert.equal(await noOption.locator('#simulationModal').isVisible(),true);
    noOption.once('dialog',dialog=>dialog.accept());
    await noOption.locator('[data-simulation="spacious"]').click();
    assert.equal(await noOption.evaluate(()=>P.source.fixtureId),'spacious','a confirmed choice opens the new sample');
    assert.deepEqual(noOptionErrors,[]);await noOption.close();
    console.log('PASS gap actions: matching room fix, partial area improvement, no safe option and explicit acceptance');
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
})().catch(error=>{console.error(error);process.exitCode=1});
