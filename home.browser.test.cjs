const { chromium } = require('playwright');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { existsSync } = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const files = new Set(['home.html', 'home.bundle.js']);

(async () => {
  const server = createServer(async (request, response) => {
    const file = new URL(request.url, 'http://localhost').pathname.slice(1);
    if (!files.has(file)) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', file.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8');
    response.end(await readFile(path.join(__dirname, file)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/home.html`);
    if (process.env.HOME_VISUAL_QA === '1') {
      await page.screenshot({ path: path.join(__dirname, 'local-projects', 'home-entry.png'), fullPage: false });
    }
    assert.match(await page.locator('#nextStepTitle').innerText(), /选择模拟户型图，一键填入家具/);
    assert.equal(await page.locator('.product').count(), 9);
    assert.match(await page.locator('#summary').innerText(), /11 件/);
    assert.match(await page.locator('#budgetStatus').innerText(), /还差 9 行单价/);
    assert.equal(await page.locator('#mockCatalogCount').innerText(), '31');
    await page.locator('#loadMockSkus').click();
    assert.equal(await page.locator('[data-key="sofa_3"] [data-field="sku"]').inputValue(), 'DEMO-ST-SOFA-01');
    assert.match(await page.locator('#budgetStatus').innerText(), /模拟单价草算，低于预算 \$35\.00/);
    assert.match(await page.locator('#summary').innerText(), /\$565\.00/);
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#resetPackage').click();
    const imageData = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 600;
      const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, 800, 600);
      context.strokeStyle = '#111'; context.lineWidth = 10; context.strokeRect(40, 40, 720, 520);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    await page.locator('#planFile').setInputFiles({ name: 'floor-plan.png', mimeType: 'image/png', buffer: Buffer.from(imageData, 'base64') });
    await page.waitForFunction(() => document.querySelector('#planStatus')?.textContent.includes('比例待校准'));
    await page.locator('#knownDistance').fill('3000');
    await page.locator('#calibratePlan').click();
    await page.locator('#planCanvas').scrollIntoViewIfNeeded();
    let box = await page.locator('#planCanvas').boundingBox();
    await page.mouse.click(box.x + box.width * .25, box.y + box.height * .25);
    await page.mouse.click(box.x + box.width * .75, box.y + box.height * .25);
    await page.locator('[data-zone="living"]').click();
    await page.locator('#planCanvas').scrollIntoViewIfNeeded();
    box = await page.locator('#planCanvas').boundingBox();
    await page.mouse.move(box.x + box.width * .15, box.y + box.height * .2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * .45, box.y + box.height * .55);
    await page.mouse.up();
    assert.match(await page.locator('#planStatus').innerText(), /已校准比例并标注 1 个房间/);
    assert.equal(await page.locator('#zoneList button').count(), 1);
    const [projectDownload] = await Promise.all([page.waitForEvent('download'), page.locator('#exportProject').click()]);
    const chunks = [];
    for await (const chunk of await projectDownload.createReadStream()) chunks.push(chunk);
    const exportedProject = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    assert.equal(exportedProject.site.source.kind, 'image');
    assert.equal(exportedProject.site.zones.length, 1);
    assert.ok(exportedProject.site.zones[0].dimensionsMm.width > 1000);
    assert.match(exportedProject.site.zones[0].dimensionsLabel, /比例估算/);
    assert.equal(await page.locator('.product-details').first().isVisible(), false);
    await page.locator('#skuEditor summary').click();
    for (const item of await page.locator('.product').all()) await item.locator('[data-field="unitPrice"]').fill('10');
    assert.match(await page.locator('#budgetStatus').innerText(), /按已填单价草算，低于预算 \$490\.00/);
    assert.match(await page.locator('#summary').innerText(), /采购资料\s*0\/9 行齐全/);
    await page.locator('#toggleDetails').click();
    assert.equal(await page.locator('.product-details').first().isVisible(), true);
    for (const item of await page.locator('.product').all()) {
      const key = await item.getAttribute('data-key');
      await item.locator('[data-field="name"]').fill(`Product ${key}`);
      await item.locator('[data-field="sku"]').fill(`SKU-${key}`);
      await item.locator('[data-field="source"]').fill('Supplier sheet');
      await item.locator('[data-field="unitPrice"]').fill('10');
    }
    assert.match(await page.locator('#budgetStatus').innerText(), /低于预算 \$490\.00/);
    await page.locator('[data-key="queen_mattress"] [data-field="unitPrice"]').fill('600');
    assert.match(await page.locator('#budgetStatus').innerText(), /超出商品预算 \$100\.00/);
    await page.reload();
    assert.equal(await page.locator('[data-key="queen_mattress"] [data-field="unitPrice"]').inputValue(), '600');
    assert.match(await page.locator('#planStatus').innerText(), /已校准比例并标注 1 个房间/);
    await page.locator('#apartmentType').selectOption('2b2b');
    assert.equal(await page.locator('.product').count(), 11);
    assert.match(await page.locator('#summary').innerText(), /19 件/);
    await page.locator('#planFile').setInputFiles(path.join(__dirname, '4F 平面方案0828.pdf'));
    await page.waitForFunction(() => document.querySelector('#planStatus')?.textContent.includes('PDF 已附加'));
    await page.locator('#packageId').selectOption('premium');
    assert.match(await page.locator('#summary').innerText(), /22 件/);
    assert.match(await page.locator('#planStatus').innerText(), /PDF 已附加/);
    await page.locator('#apartmentType').selectOption('studio');
    assert.equal(await page.locator('[data-key="queen_mattress"] [data-field="unitPrice"]').inputValue(), '600');
    assert.match(await page.locator('#planStatus').innerText(), /已校准比例并标注 1 个房间/);
    await page.locator('#apartmentType').selectOption('1b1b');
    assert.match(await page.locator('#planStatus').innerText(), /未录入户型图/);
    await page.locator('#importFile').setInputFiles({ name: 'home-project.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(exportedProject)) });
    await page.waitForFunction(() => document.querySelector('#apartmentType')?.value === 'studio');
    assert.equal(await page.locator('#apartmentType').inputValue(), 'studio');
    assert.match(await page.locator('#planStatus').innerText(), /已校准比例并标注 1 个房间/);
    const loftProject = { ...exportedProject, apartmentType: 'loft1b1b', site: { ...exportedProject.site,
      calibration: null, zones: [
        { id: 'living', kind: 'living', x: 40, y: 40, w: 200, h: 220,
          dimensionsLabel: '12′0″ × 12′10″', dimensionsMm: { width: 3658, depth: 3912 } },
        { id: 'bedroom', kind: 'bedroom', x: 260, y: 40, w: 180, h: 220,
          dimensionsLabel: '11′0″ × 14′0″', dimensionsMm: { width: 3353, depth: 4267 } },
        { id: 'dining', kind: 'dining', x: 40, y: 300, w: 200, h: 180 },
        { id: 'mezzanine', kind: 'mezzanine', x: 460, y: 40, w: 180, h: 200,
          dimensionsLabel: '10′10″ × 11′0″', dimensionsMm: { width: 3302, depth: 3353 } },
        { id: 'void', kind: 'void', x: 660, y: 40, w: 100, h: 180 },
      ] } };
    await page.locator('#importFile').setInputFiles({ name: 'loft-project.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(loftProject)) });
    assert.equal(await page.locator('#apartmentType').inputValue(), 'loft1b1b');
    assert.match(await page.locator('#planStatus').innerText(), /3 处图示尺寸/);
    assert.match(await page.locator('#zoneList').innerText(), /夹层.*10′10″ × 11′0″/);
    assert.match(await page.locator('#zoneList').innerText(), /挑空（不可摆放）/);
    assert.equal(await page.locator('#nextStepAction').innerText(), '生成演示方案');
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#nextStepAction').click();
    assert.equal(await page.locator('#generateConcept').getAttribute('aria-pressed'), 'true');
    assert.match(await page.locator('#conceptReport').innerText(), /7 件绘出占位/);
    assert.match(await page.locator('#conceptReport').innerText(), /3 件待补条件/);
    assert.match(await page.locator('#conceptReport').innerText(), /房间缺图示长宽/);
    assert.match(await page.locator('#fitScreenReport').innerText(), /部分商品尚不能初筛/);
    assert.match(await page.locator('#fitScreenReport').innerText(), /房间缺可核对的长宽/);
    const [screenDownload] = await Promise.all([page.waitForEvent('download'), page.locator('#exportList').click()]);
    const screenChunks = [];
    for await (const chunk of await screenDownload.createReadStream()) screenChunks.push(chunk);
    const screenExport = JSON.parse(Buffer.concat(screenChunks).toString('utf8'));
    assert.equal(screenExport.fitStatus, 'not_checked');
    assert.equal(screenExport.outlineScreen.screenStatus, 'incomplete');
    assert.equal(screenExport.outlineScreen.fitStatus, 'not_checked');
    assert.equal(await page.locator('#roomPreviewWrap').isVisible(), true);
    assert.equal(await page.locator('#roomSelect option').count(), 2);
    await page.locator('#roomSelect').selectOption('bedroom');
    await page.locator('.concept-assignments summary').click();
    await page.locator('[data-assignment="sofa_3:0"]').selectOption('mezzanine');
    assert.match(await page.locator('#conceptReport').innerText(), /夹层：F\d+ 三人沙发/);
    await page.reload();
    assert.match(await page.locator('#conceptReport').innerText(), /7 件绘出占位/);
    assert.equal(await page.locator('#generateConcept').getAttribute('aria-pressed'), 'true');
    await page.locator('.concept-assignments summary').click();
    assert.equal(await page.locator('[data-assignment="sofa_3:0"]').inputValue(), 'mezzanine');
    const localLoft = path.join(__dirname, 'local-projects', '复式一室一厅-已标注.json');
    if (existsSync(localLoft)) {
      await page.locator('#importFile').setInputFiles(localLoft);
      await page.waitForFunction(() => document.querySelectorAll('#zoneList button').length === 11);
      assert.equal(await page.locator('#apartmentType').inputValue(), 'loft1b1b');
      assert.match(await page.locator('#planStatus').innerText(), /3 处图示尺寸/);
      assert.equal(await page.locator('#zoneList button').count(), 11);
      await page.waitForFunction(() => {
        const canvas = document.querySelector('#planCanvas');
        return canvas?.width === 1280 && canvas?.height === 875 && canvas.getContext('2d').getImageData(500, 300, 1, 1).data[3] > 0;
      });
      await page.locator('#loadMockSkus').click();
      assert.equal(await page.locator('#generateConcept').getAttribute('aria-pressed'), 'true');
      assert.match(await page.locator('#conceptReport').innerText(), /7 件绘出占位/);
      if (process.env.HOME_VISUAL_QA === '1') {
        await page.locator('#planView').screenshot({ path: path.join(__dirname, 'local-projects', 'concept-preview.png') });
        await page.locator('#roomPreviewWrap').screenshot({ path: path.join(__dirname, 'local-projects', 'room-preview.png') });
      }
    }
    const aiContext = await browser.newContext({ acceptDownloads: true });
    const aiPage = await aiContext.newPage();
    await aiPage.route('**/api/extract-plan-dimensions', route => {
      const request = route.request().postDataJSON();
      assert.equal(request.pin, 'test-pin');
      assert.equal(request.zones.length, 1);
      assert.equal(request.zones[0].kind, 'dining');
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [
        { zoneId: 'zone-1', evidence: '3.0m × 2.5m', dimensionsMm: { width: 3000, depth: 2500 } },
      ] }) });
    });
    await aiPage.goto(`http://127.0.0.1:${server.address().port}/home.html`);
    await aiPage.locator('#importFile').setInputFiles({ name: 'loft-project.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(loftProject)) });
    assert.equal(await aiPage.locator('#aiDimensions').isVisible(), true);
    await aiPage.locator('#planAiPin').fill('test-pin');
    await aiPage.locator('#extractPlanDimensions').click();
    await aiPage.waitForFunction(() => document.querySelector('#aiDimensionStatus')?.textContent.includes('读到 1/1'));
    assert.match(await aiPage.locator('#aiDimensionStatus').innerText(), /读到 1\/1 处完整尺寸/);
    assert.doesNotMatch(await aiPage.locator('#zoneList').innerText(), /3\.0m × 2\.5m/);
    await aiPage.locator('[data-confirm-ai-zone="dining"]').click();
    assert.match(await aiPage.locator('#zoneList').innerText(), /3\.0m × 2\.5m（已确认）/);
    const [aiDownload] = await Promise.all([aiPage.waitForEvent('download'), aiPage.locator('#exportProject').click()]);
    const aiChunks = [];
    for await (const chunk of await aiDownload.createReadStream()) aiChunks.push(chunk);
    const aiExport = JSON.parse(Buffer.concat(aiChunks).toString('utf8'));
    assert.equal(aiExport.site.zones.find(zone => zone.id === 'dining').dimensionSource, 'ai_confirmed_printed');
    await aiContext.close();
    const zoneContext = await browser.newContext({ acceptDownloads: true });
    const zonePage = await zoneContext.newPage();
    let zoneRequests = 0;
    await zonePage.route('**/api/suggest-home-zones', route => {
      const request = route.request().postDataJSON();
      zoneRequests++;
      assert.equal(request.pin, 'test-pin');
      assert.match(request.imageDataUrl, /^data:image\/jpeg;base64,/);
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ suggestions: [
        { id: 'suggestion-1', kind: 'living', x: 80, y: 70, w: 320, h: 260,
          evidence: '12′0″ × 12′10″', dimensionsMm: { width: 3658, depth: 3912 } },
        { id: 'suggestion-2', kind: 'dining', x: 80, y: 340, w: 320, h: 180,
          evidence: '', dimensionsMm: null },
      ] }) });
    });
    await zonePage.goto(`http://127.0.0.1:${server.address().port}/home.html`);
    assert.equal(await zonePage.locator('#startRealPlan').isVisible(), true);
    await zonePage.locator('#planFile').setInputFiles({ name: 'my-home.png', mimeType: 'image/png', buffer: Buffer.from(imageData, 'base64') });
    await zonePage.waitForFunction(() => document.querySelector('#aiZoneAssist')?.hidden === false);
    assert.equal(zoneRequests, 0, 'upload alone must not send the full plan to AI');
    await zonePage.locator('#planZonePin').fill('test-pin');
    await zonePage.locator('#suggestHomeZones').click();
    await zonePage.waitForFunction(() => document.querySelectorAll('.ai-zone-row').length === 2);
    assert.match(await zonePage.locator('.ai-zone-row').nth(1).innerText(), /餐厅/);
    if (process.env.HOME_VISUAL_QA === '1') {
      await zonePage.locator('#aiZoneAssist').screenshot({ path: path.join(__dirname, 'local-projects', 'ai-zone-draft.png') });
      await zonePage.locator('#planView').screenshot({ path: path.join(__dirname, 'local-projects', 'ai-zone-overlay.png') });
    }
    assert.equal(await zonePage.locator('#zoneList button').count(), 0, 'suggestions must remain drafts');
    await zonePage.locator('[data-ai-zone-dimension="0"]').check();
    await zonePage.locator('#planCanvas').scrollIntoViewIfNeeded();
    const planBox = await zonePage.locator('#planCanvas').boundingBox();
    const point = (x, y) => ({ x: planBox.x + planBox.width * x / 800, y: planBox.y + planBox.height * y / 600 });
    let from = point(170, 160), to = point(210, 185);
    await zonePage.mouse.move(from.x, from.y);
    await zonePage.mouse.down(); await zonePage.mouse.move(to.x, to.y, { steps: 5 }); await zonePage.mouse.up();
    const firstRow = zonePage.locator('[data-ai-zone-row="0"]');
    const movedX = Number(await firstRow.locator('[data-ai-box-field="x"]').inputValue());
    const movedY = Number(await firstRow.locator('[data-ai-box-field="y"]').inputValue());
    assert.ok(movedX > 80 && movedY > 70, `dragging the box interior moves the suggestion: x=${movedX}, y=${movedY}, box=${JSON.stringify(planBox)}`);
    assert.equal(await zonePage.locator('[data-ai-zone-dimension="0"]').isChecked(), false,
      'changing a box must require renewed dimension confirmation');
    const oldWidth = Number(await firstRow.locator('[data-ai-box-field="w"]').inputValue());
    const oldHeight = Number(await firstRow.locator('[data-ai-box-field="h"]').inputValue());
    from = point(movedX + oldWidth, movedY + oldHeight);
    to = point(movedX + oldWidth + 35, movedY + oldHeight + 25);
    await zonePage.mouse.move(from.x, from.y);
    await zonePage.mouse.down(); await zonePage.mouse.move(to.x, to.y, { steps: 5 }); await zonePage.mouse.up();
    assert.ok(Number(await firstRow.locator('[data-ai-box-field="w"]').inputValue()) > oldWidth);
    assert.ok(Number(await firstRow.locator('[data-ai-box-field="h"]').inputValue()) > oldHeight);
    await zonePage.locator('[data-ai-zone-kind="1"]').selectOption('bedroom');
    await zonePage.locator('[data-ai-zone-row="1"] [data-ai-size-field="width"]').fill('3000');
    await zonePage.locator('[data-ai-zone-row="1"] [data-ai-size-field="depth"]').fill('2500');
    await zonePage.locator('[data-ai-zone-dimension="1"]').check();
    await zonePage.locator('[data-ai-zone-dimension="0"]').check();
    if (process.env.HOME_VISUAL_QA === '1') {
      await zonePage.locator('#planView').screenshot({ path: path.join(__dirname, 'local-projects', 'ai-zone-edited-overlay.png') });
      await zonePage.locator('#aiZoneAssist').screenshot({ path: path.join(__dirname, 'local-projects', 'ai-zone-edited-review.png') });
    }
    await zonePage.locator('#applyZoneSuggestions').click();
    assert.equal(await zonePage.locator('#zoneList button').count(), 2);
    assert.match(await zonePage.locator('#zoneList').innerText(), /12′0″ × 12′10″（已确认）/);
    assert.match(await zonePage.locator('#zoneList').innerText(), /卧室.*人工确认/);
    assert.match(await zonePage.locator('#evidenceStatus').innerText(), /适配未核验/);
    assert.equal(zoneRequests, 1);
    const [zoneDownload] = await Promise.all([zonePage.waitForEvent('download'), zonePage.locator('#exportProject').click()]);
    const zoneChunks = [];
    for await (const chunk of await zoneDownload.createReadStream()) zoneChunks.push(chunk);
    const zoneExport = JSON.parse(Buffer.concat(zoneChunks).toString('utf8'));
    assert.equal(zoneExport.site.zones[0].dimensionSource, 'ai_confirmed_printed');
    assert.equal(zoneExport.site.zones[1].kind, 'bedroom');
    assert.deepEqual(zoneExport.site.zones[1].dimensionsMm, { width: 3000, depth: 2500 });
    assert.equal(zoneExport.site.zones[1].dimensionSource, 'manual');
    assert.ok(zoneExport.site.zones[0].x > 80 && zoneExport.site.zones[0].w > 320);
    await zoneContext.close();
    const furnishedContext = await browser.newContext({ acceptDownloads: true });
    const furnishedPage = await furnishedContext.newPage();
    let furnishedRequests = 0;
    await furnishedPage.route('**/api/suggest-home-zones', route => {
      furnishedRequests++;
      const request = route.request().postDataJSON();
      assert.equal(request.pin, 'test-pin');
      assert.match(request.imageDataUrl, /^data:image\/jpeg;base64,/);
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ suggestions: [
        { kind: 'living', x: 60, y: 60, w: 300, h: 210,
          evidence: '4.0m × 3.9m', dimensionsMm: { width: 4000, depth: 3900 } },
        { kind: 'dining', x: 60, y: 300, w: 300, h: 200, evidence: '', dimensionsMm: null },
        { kind: 'bedroom', x: 390, y: 60, w: 300, h: 250,
          evidence: '3.8m × 4.3m', dimensionsMm: { width: 3800, depth: 4300 } },
        { kind: 'stairs', x: 390, y: 340, w: 100, h: 160, evidence: '', dimensionsMm: null },
        { kind: 'void', x: 530, y: 340, w: 160, h: 160, evidence: '', dimensionsMm: null },
      ] }) });
    });
    await furnishedPage.goto(`http://127.0.0.1:${server.address().port}/home.html`);
    await furnishedPage.locator('#planFile').setInputFiles({ name: 'customer-plan.png', mimeType: 'image/png', buffer: Buffer.from(imageData, 'base64') });
    await furnishedPage.waitForFunction(() => document.querySelector('#quickGenerate')?.hidden === false);
    assert.equal(furnishedRequests, 0, 'upload alone must not send the plan');
    assert.match(await furnishedPage.locator('#nextStepAction').innerText(), /生成家具初稿/);
    await furnishedPage.locator('#quickPlanPin').fill('test-pin');
    await furnishedPage.locator('#generateFurnishedDraft').click();
    await furnishedPage.waitForFunction(() => document.querySelector('#quickGenerateStatus')?.textContent.includes('已生成家具初稿'));
    assert.equal(furnishedRequests, 1);
    assert.equal(await furnishedPage.locator('#zoneList button').count(), 5);
    assert.match(await furnishedPage.locator('#conceptReport').innerText(), /件绘出占位/);
    assert.match(await furnishedPage.locator('#conceptReport').innerText(), /视觉绘图比例/);
    assert.match(await furnishedPage.locator('#fitScreenReport').innerText(), /部分商品尚不能初筛/);
    assert.match(await furnishedPage.locator('#evidenceStatus').innerText(), /适配未核验/);
    assert.match(await furnishedPage.locator('#reviewGate').innerText(), /正式交付未放行/);
    await furnishedPage.locator('#reviewGate details').nth(1).locator('summary').click();
    await furnishedPage.locator('[data-review-confirm="sofa_3-1"]').click();
    assert.equal(await furnishedPage.locator('[data-review-undo="sofa_3-1"]').count(), 1);
    if (process.env.HOME_VISUAL_QA === '1') {
      await furnishedPage.locator('#demoResult').screenshot({ path: path.join(__dirname, 'local-projects', 'customer-furnished-draft.png') });
    }
    const [furnishedDownload] = await Promise.all([furnishedPage.waitForEvent('download'), furnishedPage.locator('#exportProject').click()]);
    const furnishedChunks = [];
    for await (const chunk of await furnishedDownload.createReadStream()) furnishedChunks.push(chunk);
    const furnishedProject = JSON.parse(Buffer.concat(furnishedChunks).toString('utf8'));
    assert.match(furnishedProject.placementReviews['sofa_3-1'].fingerprint, /^[0-9a-f]{8}$/);
    assert.equal(furnishedProject.site.zones[0].dimensionSource, 'ai_draft_printed');
    assert.equal(furnishedProject.site.zones[1].dimensionsMm, undefined);
    assert.ok(furnishedProject.site.zones[1].visualSizeMm.width > 1000);
    assert.ok(furnishedProject.site.zones.every(zone => zone.reviewStatus === 'draft'));
    await furnishedPage.reload();
    assert.equal(await furnishedPage.locator('[data-review-undo="sofa_3-1"]').count(), 1);
    const [layoutDownload] = await Promise.all([furnishedPage.waitForEvent('download'), furnishedPage.locator('#exportList').click()]);
    const layoutChunks = [];
    for await (const chunk of await layoutDownload.createReadStream()) layoutChunks.push(chunk);
    const layoutExport = JSON.parse(Buffer.concat(layoutChunks).toString('utf8'));
    assert.equal(layoutExport.deliveryGate.canDeliver, false);
    assert.equal(layoutExport.deliveryGate.status, 'draft_only');
    const sofa = layoutExport.conceptOccupancy.placements.find(item => item.instanceId === 'sofa_3-1');
    const table = layoutExport.conceptOccupancy.placements.find(item => item.instanceId === 'coffee_table-1');
    const living = furnishedProject.site.zones.find(zone => zone.id === sofa.zoneId);
    const drawingSize = living.dimensionsMm || living.visualSizeMm;
    const centerOnCanvas = item => ({ x: living.x + living.w * (item.xMm + item.widthMm / 2) / drawingSize.width,
      y: living.y + living.h * (item.yMm + item.depthMm / 2) / drawingSize.depth });
    await furnishedPage.locator('#jumpFurnitureEdit').click();
    assert.equal(await furnishedPage.locator('#adjustFurniture').getAttribute('aria-pressed'), 'true');
    await furnishedPage.locator('#planCanvas').scrollIntoViewIfNeeded();
    const dragBox = await furnishedPage.locator('#planCanvas').boundingBox();
    const planSize = await furnishedPage.locator('#planCanvas').evaluate(canvas => ({ width: canvas.width, height: canvas.height }));
    const screenPoint = point => ({ x: dragBox.x + point.x * dragBox.width / planSize.width,
      y: dragBox.y + point.y * dragBox.height / planSize.height });
    const start = screenPoint(centerOnCanvas(sofa)), end = screenPoint(centerOnCanvas(table));
    await furnishedPage.mouse.move(start.x, start.y);
    await furnishedPage.mouse.down();
    await furnishedPage.mouse.move(end.x, end.y, { steps: 8 });
    await furnishedPage.mouse.up();
    assert.match(await furnishedPage.locator('#furnitureEditStatus').innerText(), /位置已保存；发现 \d+ 处家具重叠/);
    assert.match(await furnishedPage.locator('#fitScreenReport').innerText(), /发现外廓冲突/);
    if (process.env.HOME_VISUAL_QA === '1') {
      await furnishedPage.locator('#planView').screenshot({ path: path.join(__dirname, 'local-projects', 'furniture-overlap-review.png') });
    }
    const [movedDownload] = await Promise.all([furnishedPage.waitForEvent('download'), furnishedPage.locator('#exportProject').click()]);
    const movedChunks = [];
    for await (const chunk of await movedDownload.createReadStream()) movedChunks.push(chunk);
    const movedProject = JSON.parse(Buffer.concat(movedChunks).toString('utf8'));
    assert.equal(movedProject.placementOverrides['sofa_3-1'].zoneId, living.id);
    assert.ok(movedProject.placementOverrides['sofa_3-1'].yRatio < 1);
    assert.equal(movedProject.placementReviews['sofa_3-1'], undefined);
    await furnishedPage.reload();
    assert.match(await furnishedPage.locator('#fitScreenReport').innerText(), /发现外廓冲突/);
    await furnishedPage.locator('#resetFurniturePositions').click();
    await furnishedPage.locator('#importFile').setInputFiles({ name: 'reviewed-furniture.json',
      mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(furnishedProject)) });
    await furnishedPage.waitForFunction(() => document.querySelector('[data-review-undo="sofa_3-1"]'));
    assert.equal(await furnishedPage.locator('[data-review-undo="sofa_3-1"]').count(), 1);
    assert.match(await furnishedPage.locator('#furnitureEditStatus').innerText(), /已恢复系统自动占位/);
    assert.doesNotMatch(await furnishedPage.locator('#fitScreenReport').innerText(), /发现外廓冲突/);
    await furnishedPage.locator('#importFile').setInputFiles({ name: 'moved-furniture.json',
      mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(movedProject)) });
    await furnishedPage.waitForFunction(() => document.querySelector('#fitScreenReport')?.textContent.includes('发现外廓冲突'));
    assert.match(await furnishedPage.locator('#fitScreenReport').innerText(), /发现外廓冲突/);
    await furnishedPage.locator('#resetFurniturePositions').click();
    const [pngDownload] = await Promise.all([furnishedPage.waitForEvent('download'), furnishedPage.locator('#downloadFurnishedDraft').click()]);
    const pngChunks = [];
    for await (const chunk of await pngDownload.createReadStream()) pngChunks.push(chunk);
    assert.deepEqual(Buffer.concat(pngChunks).subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    await furnishedPage.reload();
    assert.equal(await furnishedPage.locator('#zoneList button').count(), 5);
    assert.match(await furnishedPage.locator('#conceptReport').innerText(), /视觉绘图比例/);
    await furnishedContext.close();
    if (existsSync(localLoft)) {
      const annotated = JSON.parse(await readFile(localLoft, 'utf8'));
      const originalContext = await browser.newContext({ acceptDownloads: true });
      const originalPage = await originalContext.newPage();
      await originalPage.route('**/api/suggest-home-zones', route => route.fulfill({ status: 200,
        contentType: 'application/json', body: JSON.stringify({ suggestions: annotated.site.zones.map(zone => ({
          kind: zone.kind, x: zone.x, y: zone.y, w: zone.w, h: zone.h,
          evidence: zone.dimensionsLabel || '', dimensionsMm: zone.dimensionsMm || null,
        })) }) }));
      await originalPage.goto(`http://127.0.0.1:${server.address().port}/home.html`);
      await originalPage.locator('#apartmentType').selectOption('loft1b1b');
      await originalPage.locator('#planFile').setInputFiles({ name: 'customer-loft.jpg', mimeType: 'image/jpeg',
        buffer: Buffer.from(annotated.site.source.dataUrl.split(',')[1], 'base64') });
      await originalPage.waitForFunction(() => document.querySelector('#quickGenerate')?.hidden === false);
      await originalPage.locator('#quickPlanPin').fill('test-pin');
      await originalPage.locator('#generateFurnishedDraft').click();
      await originalPage.waitForFunction(() => document.querySelector('#quickGenerateStatus')?.textContent.includes('已生成家具初稿'));
      assert.equal(await originalPage.locator('#zoneList button').count(), 11);
      assert.match(await originalPage.locator('#conceptReport').innerText(), /餐厅：F\d+ 2–4 人餐桌/);
      assert.match(await originalPage.locator('#conceptReport').innerText(), /客厅：F\d+ 三人沙发/);
      assert.match(await originalPage.locator('#conceptReport').innerText(), /卧室：F\d+ Queen 床架/);
      if (process.env.HOME_VISUAL_QA === '1') {
        await originalPage.locator('#planView').screenshot({ path: path.join(__dirname, 'local-projects', 'original-plan-autofurnished.png') });
      }
      await originalContext.close();
    }
    assert.deepEqual(errors, []);
    const gallery = await browser.newPage({ acceptDownloads: true, viewport: { width: 390, height: 844 } });
    const apiRequests = [];
    gallery.on('request', request => { if (request.url().includes('/api/')) apiRequests.push(request.url()); });
    await gallery.goto(pathToFileURL(path.join(__dirname, 'home.html')).href);
    assert.equal(await gallery.locator('[data-demo-plan]').count(), 4);
    for (const type of ['studio', '1b1b', 'loft1b1b']) {
      await gallery.locator(`[data-demo-plan="${type}"]`).click();
      await gallery.locator('#generateDemoPlan').click();
      assert.match(await gallery.locator('#planStatus').innerText(), /系统演示户型（非真实图纸）/);
      assert.match(await gallery.locator('#conceptReport').innerText(), /件绘出占位/);
      assert.equal(await gallery.evaluate(expected => localStorage.getItem('home-furniture-package-v1').includes(`系统演示户型（${expected}`), type), true);
    }
    await gallery.locator('[data-demo-plan="2b2b"]').click();
    assert.equal(await gallery.locator('#apartmentType').inputValue(), '2b2b');
    await gallery.locator('#packageId').selectOption('premium');
    await gallery.locator('#generateDemoPlan').click();
    assert.match(await gallery.locator('#planStatus').innerText(), /系统演示户型（非真实图纸）/);
    assert.match(await gallery.locator('#conceptReport').innerText(), /19 件绘出占位/);
    assert.match(await gallery.locator('#summary').innerText(), /\$1995\.00/);
    assert.match(await gallery.locator('#demoPlanStatus').innerText(), /没有上传图纸或调用 AI/);
    assert.equal(apiRequests.length, 0, 'the fictional floor-plan path makes no AI request');
    if (process.env.HOME_VISUAL_QA === '1') {
      await gallery.locator('#demoPlanPicker').scrollIntoViewIfNeeded();
      await gallery.screenshot({ path: path.join(__dirname, 'local-projects', 'demo-plan-gallery-mobile.png') });
    }
    assert.equal(await gallery.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true,
      'fictional floor-plan picker and result fit the phone viewport');
    await gallery.locator('#jumpFurnitureEdit').click();
    assert.equal(await gallery.locator('#adjustFurniture').getAttribute('aria-pressed'), 'true');
    await gallery.locator('#adjustFurniture').click();
    const [demoPngDownload] = await Promise.all([
      gallery.waitForEvent('download'), gallery.locator('#downloadFurnishedDraft').click(),
    ]);
    assert.match(demoPngDownload.suggestedFilename(), /furnished-draft\.png$/);
    const [demoProjectDownload] = await Promise.all([
      gallery.waitForEvent('download'), gallery.locator('#exportProject').click(),
    ]);
    const demoProject = JSON.parse(await readFile(await demoProjectDownload.path(), 'utf8'));
    assert.match(demoProject.site.source.fileName, /^系统演示户型/);
    assert.equal(Object.values(demoProject.products).every(product => product.sku.startsWith('DEMO-')), true);
    await gallery.reload();
    assert.equal(await gallery.locator('[data-demo-plan="2b2b"]').getAttribute('aria-pressed'), 'true');
    assert.match(await gallery.locator('#conceptReport').innerText(), /19 件绘出占位/);
    await gallery.locator('#planFile').setInputFiles({ name: 'local-test-plan.png', mimeType: 'image/png',
      buffer: Buffer.from(imageData, 'base64') });
    await gallery.waitForFunction(() => document.querySelector('#planStatus')?.textContent.includes('比例待校准'));
    await gallery.locator('#generateDemoPlan').click();
    assert.match(await gallery.locator('#demoPlanStatus').innerText(), /不会覆盖它/);
    assert.match(await gallery.locator('#planStatus').innerText(), /比例待校准/);
    await gallery.close();
    const direct = await browser.newPage();
    await direct.goto(pathToFileURL(path.join(__dirname, 'home.html')).href);
    assert.equal(await direct.locator('.product').count(), 9, 'file URL can run without an HTTP server');
    await direct.locator('#startRealPlan').click();
    assert.match(await direct.locator('#planHint').innerText(), /系统演示户型/);
    assert.match(await direct.locator('#planStatus').innerText(), /非真实图纸/);
    assert.match(await direct.locator('#conceptReport').innerText(), /10 件绘出占位/);
    assert.match(await direct.locator('#fitScreenReport').innerText(), /现有矩形外廓未发现冲突/);
    assert.match(await direct.locator('#fitScreenReport').innerText(), /适配状态：未核验/);
    assert.equal(await direct.locator('#roomPreviewWrap').isVisible(), true);
    assert.equal(await direct.locator('#skuEditor').getAttribute('open'), null);
    if (process.env.HOME_VISUAL_QA === '1') {
      await direct.locator('#demoResult').screenshot({ path: path.join(__dirname, 'local-projects', 'demo-first-result.png') });
    }
    await direct.locator('#skuEditor summary').click();
    await direct.locator('#toggleDetails').click();
    await direct.locator('[data-key="sofa_3"] [data-field="widthMm"]').fill('5000');
    assert.match(await direct.locator('#fitScreenReport').innerText(), /发现外廓冲突/);
    await direct.reload();
    assert.match(await direct.locator('#conceptReport').innerText(), /9 件绘出占位/);
    assert.match(await direct.locator('#fitScreenReport').innerText(), /发现外廓冲突/);
    await direct.locator('#apartmentType').selectOption('2b2b');
    await direct.locator('#startRealPlan').click();
    assert.match(await direct.locator('#planStatus').innerText(), /非真实图纸/);
    assert.match(await direct.locator('#conceptReport').innerText(), /件绘出占位/);
    assert.equal(await direct.locator('#roomPreviewWrap').isVisible(), true);
    await direct.locator('#packageId').selectOption('premium');
    await direct.locator('#loadMockSkus').click();
    assert.match(await direct.locator('#conceptReport').innerText(), /19 件绘出占位/);
    assert.match(await direct.locator('#summary').innerText(), /\$1995\.00/);
    await direct.setViewportSize({ width: 390, height: 844 });
    assert.equal(await direct.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true,
      'demo floor plan and furniture preview fit the phone viewport');
    assert.equal(await direct.locator('#roomPreviewWrap').isVisible(), true);
    await direct.close();
    await context.close();
    console.log('PASS home packages: required rows, budget, persistence, apartment and tier switching');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
