// Deterministic showcase path: example layout -> three product packages -> reviewed draft -> demo quote -> order request.
const { chromium } = require('playwright');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const assert = require('node:assert/strict');
const path = require('node:path');

const files = new Set([
  'studio.html', 'sample-furniture.js', 'studio.js', 'broker.js', 'zone-program.js', 'zone-assist.js',
  'src/domain/design-bom.js', 'src/domain/product-slots.js', 'src/domain/furniture-taxonomy.js',
  'src/domain/product-use-spec.js', 'src/domain/catalog-import.js', 'src/domain/match-products.js',
  'src/domain/layout-revision.js', 'src/domain/home-product-binding.js', 'src/domain/office-product-binding.js',
  'src/domain/planning-product-binding.js', 'src/domain/planning-coverage.js',
  'src/domain/planning-fit-alternatives.js', 'src/domain/home-assemblies.js',
  'src/domain/product-placement.js', 'src/domain/procurement-bom.js', 'src/domain/set-offers.js',
  'src/domain/set-procurement.js', 'src/domain/review-snapshot.js', 'src/domain/demo-catalog.js',
  'src/domain/demo-product-packages.js', 'src/domain/demo-quote.js',
  'src/domain/product-visuals.js',
]);

(async () => {
  const server = createServer(async (req, res) => {
    const name = new URL(req.url, 'http://localhost').pathname.slice(1);
    if (!files.has(name)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', name.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8');
    res.end(await readFile(path.join(__dirname, name)));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  let browser;
  try {
    browser = await chromium.launch({ channel: process.env.MVP_BROWSER_CHANNEL || 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/studio.html`);
    await page.locator('#useExample').click();
    await page.locator('[data-simulation="balanced"]').click();
    await page.waitForFunction(() => typeof P !== 'undefined' && P.drafts?.length === 3 && document.querySelectorAll('#designBom .item').length > 0);
    await page.locator('#approvedProductPanel').evaluate(element => { element.open = true; });
    await page.locator('#buildDemoPackages').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-demo-package]').length === 3);
    assert.match(await page.locator('#demoPackageStatus').innerText(), /3\/3 complete packages ready/);
    assert.equal(await page.locator('[data-demo-package]:disabled').count(), 0);
    await page.locator('[data-demo-package="value"]').click();
    await page.waitForFunction(() => document.querySelector('#canvas')?.dataset.productVisualTiers === 'value');
    const valueVisual = await page.locator('#canvas').evaluate(canvas => ({ count: Number(canvas.dataset.productVisualCount), fingerprint: canvas.dataset.productVisualFingerprint }));
    assert.ok(valueVisual.count >= 20, `expected product visuals across the scene, got ${valueVisual.count}`);
    await page.locator('[data-view="3d"]').click();
    assert.equal(await page.locator('#canvas').getAttribute('data-product-visual-tiers'), 'value');
    await page.locator('[data-demo-package="signature"]').click();
    await page.waitForFunction(previous => {
      const canvas = document.querySelector('#canvas');
      return canvas?.dataset.productVisualTiers === 'signature' && canvas.dataset.productVisualFingerprint !== previous;
    }, valueVisual.fingerprint);
    const signatureFingerprint = await page.locator('#canvas').getAttribute('data-product-visual-fingerprint');
    assert.notEqual(signatureFingerprint, valueVisual.fingerprint);
    await page.locator('[data-demo-package="balanced"]').click();
    await page.waitForFunction(() => {
      const values = [...document.querySelectorAll('[data-approved-instance]')].map(element => element.value);
      return values.length > 0 && values.every(Boolean) && !document.querySelector('#bindApprovedProducts')?.disabled;
    });
    const firstInstance = await page.locator('[data-approved-product-line]').first().getAttribute('data-approved-product-line');
    const customCandidate = await page.locator('[data-approved-instance]').first().evaluate(select => {
      const current = approvedCandidates.find(candidate => candidate.candidateId === select.value);
      return approvedCandidates.find(candidate => candidate.profileId === current.profileId && candidate.demoTier === 'value').candidateId;
    });
    await page.locator('[data-approved-instance]').first().selectOption(customCandidate);
    await page.waitForFunction(({ instanceId, candidateId }) => {
      const saved = JSON.parse(localStorage.getItem('office-planner-mvp-v1'));
      return saved.demoPackageChoice?.customized && saved.demoPackageChoice.selections?.[instanceId] === candidateId;
    }, { instanceId: firstInstance, candidateId: customCandidate });
    await page.reload();
    await page.waitForFunction(({ instanceId, candidateId }) =>
      document.querySelector(`[data-approved-instance="${CSS.escape(instanceId)}"]`)?.value === candidateId,
    { instanceId: firstInstance, candidateId: customCandidate });
    assert.equal(await page.locator(`[data-approved-instance="${firstInstance}"]`).inputValue(), customCandidate);
    await page.locator('#approvedProductPanel').evaluate(element => { element.open = true; });
    await page.locator('[data-demo-package="balanced"]').click();
    await page.waitForFunction(() => document.querySelector('#canvas')?.dataset.productVisualTiers === 'balanced');
    const selectedItems = await page.locator('[data-approved-instance]').count();
    assert.ok(selectedItems >= 20, `expected a complete office package, got ${selectedItems} items`);
    await page.locator('[data-locate-product]').first().click();
    assert.equal(await page.locator('#canvas').getAttribute('data-focused-product-id'), firstInstance);
    assert.ok(await page.locator(`[data-approved-product-line="${firstInstance}"]`).evaluate(element => element.classList.contains('focused')));
    assert.ok(await page.locator('[data-view="2d"]').evaluate(element => element.classList.contains('active')));
    const canvasTarget = await page.evaluate(() => {
      const items = allDisplayFurniture(P.furniture, P.objects, P.derivedProducts);
      for (const item of items) {
        const [x, y] = screen(item.x, item.y);
        if (x < 20 || y < 20 || x > cv.clientWidth - 20 || y > cv.clientHeight - 20) continue;
        if (hitDisplayFurniture(item.x, item.y)?.id === item.id) return { id: item.id, x, y };
      }
      return null;
    });
    assert.ok(canvasTarget, 'expected a visible product instance for canvas selection');
    await page.evaluate(() => { focusedProductId = null; render(); syncProductFocusUi(); });
    const canvasBox = await page.locator('#canvas').boundingBox();
    await page.mouse.click(canvasBox.x + canvasTarget.x, canvasBox.y + canvasTarget.y);
    assert.equal(await page.locator('#canvas').getAttribute('data-focused-product-id'), canvasTarget.id);
    assert.ok(await page.locator(`[data-approved-product-line="${canvasTarget.id}"]`).evaluate(element => element.classList.contains('focused')));
    await page.locator('#bindApprovedProducts').click();
    await page.waitForFunction(() => /reviewed and bound|Binding needs review|Could not review/.test(document.querySelector('#approvedProductStatus')?.textContent || ''), null, { timeout: 30000 });
    const bindingStatus = await page.locator('#approvedProductStatus').innerText();
    assert.match(bindingStatus, /reviewed and bound/, bindingStatus);
    await page.locator('#generateDemoQuote').click();
    await page.waitForFunction(() => document.querySelector('#confirmDemoQuote'), null, { timeout: 10000 }).catch(async error => {
      throw new Error(`Quote did not advance: ${await page.locator('#demoQuotePanel').innerText()}\n${errors.join('\n')}\n${error.message}`);
    });
    assert.match(await page.locator('#demoQuotePanel').innerText(), /Merchandise[\s\S]*Delivery estimate[\s\S]*Installation estimate[\s\S]*Estimated tax[\s\S]*Demo total/);
    await page.locator('#confirmDemoQuote').click();
    await page.waitForFunction(() => document.querySelector('#submitDemoOrder'));
    await page.locator('#submitDemoOrder').click();
    await page.waitForFunction(() => /Order request received/.test(document.querySelector('#demoQuotePanel')?.textContent || ''));
    const project = await page.evaluate(() => JSON.parse(localStorage.getItem('office-planner-mvp-v1')));
    assert.equal(project.catalogMode, 'demo');
    assert.equal(project.demoQuote.status, 'confirmed');
    assert.equal(project.demoOrder.status, 'request_received');
    await page.reload();
    await page.waitForFunction(() => /Order request received/.test(document.querySelector('#demoQuotePanel')?.textContent || ''), null, { timeout: 30000 });
    assert.equal(await page.locator('[data-demo-package]').count(), 3);
    assert.match(await page.locator('#approvedCoverageSummary').textContent(), /physical items ready for placement review/);
    await page.waitForFunction(expected => Number(document.querySelector('#canvas')?.dataset.productVisualCount) === expected &&
      document.querySelector('#canvas')?.dataset.productVisualTiers === 'balanced', selectedItems);
    assert.equal(errors.length, 0, errors.join('\n'));
    if (process.env.SHOWCASE_SCREENSHOT) {
      await page.locator('#demoQuotePanel').scrollIntoViewIfNeeded();
      await page.screenshot({ path: process.env.SHOWCASE_SCREENSHOT });
    }
    console.log(`PASS showcase MVP: ${selectedItems} items -> A/B/C package -> reviewed draft -> quote -> order request`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
