// Live, isolated verification of the deployed image-reading route.
// Requires HOME_AI_URL and HOME_AI_PIN in this process; never prints the PIN or image data.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

const siteUrl = process.env.HOME_AI_URL?.replace(/\/$/, '');
const pin = process.env.HOME_AI_PIN;
if (!siteUrl || !pin) throw new Error('HOME_AI_URL and HOME_AI_PIN are required.');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext({
      extraHTTPHeaders: process.env.HOME_AI_BYPASS
        ? { 'x-vercel-protection-bypass': process.env.HOME_AI_BYPASS }
        : {},
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const loaded = await page.goto(`${siteUrl}/home.html`, { waitUntil: 'domcontentloaded' });
    assert.equal(loaded.status(), 200, 'staged home.html must load');
    await page.locator('#importFile').setInputFiles(path.resolve(__dirname, '../local-projects/复式一室一厅-AI读取验证.json'));
    assert.equal(await page.locator('#aiDimensions').isVisible(), true);
    await page.locator('#planAiPin').fill(pin);
    const [apiResponse] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/api/extract-plan-dimensions') &&
        response.request().method() === 'POST', { timeout: 70000 }),
      page.locator('#extractPlanDimensions').click(),
    ]);
    const body = await apiResponse.json();
    if (!apiResponse.ok()) throw new Error(`Image-reading API returned ${apiResponse.status()}: ${body.error || 'unknown error'}`);
    await page.waitForFunction(() => document.querySelector('#aiDimensionStatus')?.textContent.includes('读到'), null, { timeout: 10000 });
    const living = body.candidates?.find(item => item.zoneId === 'zone-1');
    const dining = body.candidates?.find(item => item.zoneId === 'zone-2');
    assert.ok(living && dining, 'both eligible rooms must return a draft');
    assert.doesNotMatch(await page.locator('#zoneList').innerText(), /已确认/, 'AI must not auto-apply a dimension');
    const expectedLiving = living.dimensionsMm?.width === 3658 && living.dimensionsMm?.depth === 3912;
    const diningUnknown = dining.dimensionsMm === null;
    process.stdout.write(JSON.stringify({ apiStatus: apiResponse.status(),
      livingEvidence: living.evidence, livingDimensionsMm: living.dimensionsMm,
      diningEvidence: dining.evidence, diningDimensionsMm: dining.dimensionsMm,
      expectedLiving, diningUnknown, pageErrors: errors }) + '\n');
    if (expectedLiving && diningUnknown) {
      await page.locator('[data-confirm-ai-zone="main-living"]').click();
      assert.match(await page.locator('#zoneList').innerText(), /客厅.*（已确认）/);
      process.stdout.write('PASS: verified draft was applied only after confirmation.\n');
    } else {
      process.exitCode = 1;
    }
    await context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
