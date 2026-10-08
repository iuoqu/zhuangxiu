// API-mode layout assistant integration; the provider response is intercepted, never called live.
const { chromium }=require('playwright');
const { createServer }=require('node:http');
const { readFile }=require('node:fs/promises');
const assert=require('node:assert/strict');
const path=require('node:path');

const files=new Set(['studio.html','sample-furniture.js','studio.js','broker.js','zone-program.js','zone-assist.js']);
const server=createServer(async(req,res)=>{const name=new URL(req.url,'http://localhost').pathname.slice(1);if(!files.has(name)){res.writeHead(404);res.end();return}res.setHeader('Content-Type',name.endsWith('.html')?'text/html; charset=utf-8':'text/javascript; charset=utf-8');res.end(await readFile(path.join(__dirname,name)))});

(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try{
    browser=await chromium.launch({channel:process.env.MVP_BROWSER_CHANNEL||'msedge',headless:true});
    const page=await browser.newPage({viewport:{width:1440,height:950}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{window.ZONE_ASSIST_MODE='api'});
    let requestBody;
    await page.route('**/api/suggest-zone',async route=>{requestBody=route.request().postDataJSON();const office=requestBody.targets.find(item=>item.kind==='office');await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({reply:'Try a compact office.',intents:[{targetKey:office.key,action:'compact',reason:'Could leave room for more workstations.'},{targetKey:'invented-area',action:'near_window',reason:'Not real.'}]})})});
    await page.goto(`http://127.0.0.1:${server.address().port}/studio.html`);
    await page.locator('#useExample').click();await page.locator('#simulationNeedsDetails summary').click();await page.locator('#simPeople').fill('40');await page.locator('[data-simulation="compact"]').click();
    const original=await page.evaluate(()=>({objects:structuredClone(P.objects),furniture:structuredClone(P.furniture),broker:structuredClone(P.broker)}));
    await page.locator('#zoneAssistDetails > summary').click();await page.locator('#zoneAssistText').fill('Make an office compact to fit more desks');await page.locator('#zoneAssistPin').fill('test-pin');await page.locator('#zoneAssistAsk').click();
    assert.equal(requestBody.pin,'test-pin');assert.equal(requestBody.targets.some(item=>item.kind==='office'),true);assert.equal('broker' in requestBody,false,'the AI endpoint should receive only bounded target metadata, not the full client brief');
    await page.waitForFunction(()=>P.zoneAssist?.source==='api');assert.equal(await page.locator('[data-zone-apply]').count(),1,'invented AI target must not become a candidate');
    assert.deepEqual(await page.evaluate(()=>P.objects),original.objects,'provider output must not directly change geometry');assert.deepEqual(await page.evaluate(()=>P.broker),original.broker,'provider output must not change customer needs');
    const officeKey=requestBody.targets.find(item=>item.kind==='office').key;
    await page.locator('#zoneAssistText').fill('Try the same office again');await page.locator('#zoneAssistAsk').click();await page.waitForFunction(()=>P.zoneAssistHistory?.length===2);
    assert.equal(requestBody.previousTargetKey,officeKey,'a follow-up turn should carry only the previously discussed area id');
    await page.locator('[data-zone-apply]').click();assert.equal(await page.evaluate(()=>currentPlanEdited()),true);assert.deepEqual(await page.evaluate(()=>P.broker),original.broker);
    await page.reload();assert.equal(await page.evaluate(()=>P.zoneAssist?.acceptedId!=null),true,'confirmed candidate should survive reload');
    await page.locator('#zoneAssistDetails > summary').click();page.once('dialog',dialog=>dialog.accept());await page.locator('#zoneAssistRestore').click();
    assert.deepEqual(await page.evaluate(()=>P.objects),original.objects,'restore should recover original A/B/C geometry after reload');assert.deepEqual(await page.evaluate(()=>P.furniture),original.furniture);assert.deepEqual(errors,[]);
    const windowDirection=await page.evaluate(()=>{const base=P.drafts.find(d=>d.id===P.activeDraft),targets=zoneAssistTargets(base),office=targets.find(target=>target.kind==='office');return buildZoneAssistCandidates(base,[{targetKey:office.key,action:'near_window',reason:'test'}],targets)[0]?.metrics});
    assert.ok(windowDirection?.oldDistance-windowDirection?.newDistance>=150,'a window intention must measurably move an office closer, not only rewrite the explanation');
    await page.unroute('**/api/suggest-zone');let releaseResponse;const delayed=new Promise(resolve=>{releaseResponse=resolve});
    await page.route('**/api/suggest-zone',async route=>{const office=route.request().postDataJSON().targets.find(item=>item.kind==='office');await delayed;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({reply:'Try this.',intents:[{targetKey:office.key,action:'compact',reason:'Test'}]})})});
    await page.locator('#zoneAssistText').fill('Try another compact office');const pending=page.waitForRequest('**/api/suggest-zone');await page.locator('#zoneAssistAsk').click();await pending;
    await page.evaluate(()=>selectDraftWithProposals(P.drafts[1].id));releaseResponse();await page.waitForFunction(()=>!zoneAssistBusy);
    assert.equal(await page.evaluate(()=>P.zoneAssist),null,'an AI reply for an earlier snapshot must be discarded');
    console.log('PASS AI-mode follow-up intent → bounded planner candidate → explicit apply → persisted restore; stale reply discarded');
    await page.close();
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve))}
})().catch(error=>{console.error(error);process.exitCode=1});
