// Three synthetic customer journeys, not a human usability study or real property validation.
// Run with Playwright installed and Microsoft Edge available: node mvp.customer-flow.test.cjs
const { chromium } = require('playwright');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const assert = require('node:assert/strict');
const path = require('node:path');

const scenarios = [
  {
    name: 'desk-heavy',
    request: 'We need 80 workstations, 2 6-person meeting rooms and 2 phone booths.',
    needs: { people: 80, meetingRooms: 2, roomSeats: 6, phones: 2 },
    selected: 'spacious',
    reason: 'Largest sample is worth measuring, but workstation shortfall and exit access need review.',
    expectedGap: 'Workstations',
  },
  {
    name: 'meeting-heavy',
    request: 'We need 20 workstations, 6 8-person meeting rooms and 2 private offices.',
    needs: { people: 20, meetingRooms: 6, roomSeats: 8, offices: 2 },
    selected: 'balanced',
    reason: 'Investigate room capacity and circulation before any shortlist decision.',
    expectedGap: 'Meeting rooms',
  },
  {
    name: 'shared-amenities',
    request: 'We need 24 workstations, 2 6-person meeting rooms, 8 dining seats, 4 lounge seats, a coffee bar and reception.',
    needs: { people: 24, meetingRooms: 2, roomSeats: 6, diningSeats: 8, loungeSeats: 4, coffeeBar: true, reception: true },
    selected: 'spacious',
    reason: 'Check the social spaces, furniture sizes and real measured plan with the client.',
  },
];

(async () => {
  const server = createServer(async (req, res) => {
    const name = new URL(req.url, 'http://localhost').pathname.slice(1);
    if (!['studio.html', 'sample-furniture.js', 'studio.js', 'broker.js', 'zone-assist.js'].includes(name)) {
      res.writeHead(404); res.end(); return;
    }
    res.setHeader('Content-Type', name.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8');
    res.end(await readFile(path.join(__dirname, name)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const url = `http://127.0.0.1:${server.address().port}/studio.html`;
    for (const scenario of scenarios) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('dialog', dialog => dialog.accept());
      await page.goto(url);
      await page.locator('#startProject').click();
      await page.locator('#naturalBriefText').fill(scenario.request);
      await page.locator('#naturalBriefExtract').click();
      await page.locator('#brokerForm').waitFor({ state: 'visible' });
      assert.match(await page.locator('#extractedSummary').innerText(), new RegExp(`${scenario.needs.people} workstations`));
      assert.match(await page.locator('#extractedAnswers').innerText(), /Not mentioned/);
      assert.equal(await page.locator('#brokerForm button.primary').isDisabled(), false);
      await page.locator('#brokerForm button.primary').click();
      assert.equal(await page.locator('#simulationModal').isVisible(), true);
      assert.equal(await page.locator('[data-simulation]').count(), 3);
      assert.match(await page.locator('#simulationBriefSummary').innerText(), new RegExp(`${scenario.needs.people} workstations`));
      assert.equal(await page.locator('#decisionComposerDetails').evaluate(el => el.open), false, 'saving a shortlist is optional and starts folded');
      await page.locator('#decisionComposerDetails summary').click();
      await page.locator('#decisionSite').selectOption(scenario.selected);
      await page.locator('#decisionReason').fill(scenario.reason);
      await page.locator('#decisionCreate').click();
      assert.equal(await page.locator('#decisionModal').isVisible(), true);
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('office-planner-decision-v1')));
      assert.equal(saved.sites.length, 3);
      assert.equal(saved.recommendedSiteId, scenario.selected);
      for (const [field, expected] of Object.entries(scenario.needs)) assert.equal(saved.brief[field], expected, `${scenario.name}: ${field}`);
      assert.equal(saved.brief.intakeAnswers.people, 'requested');
      assert.equal(saved.brief.intakeAnswers.meetingRooms, 'requested');
      assert.equal(saved.brief.intakeAnswers.pantry, 'unknown');
      const reportText = await page.locator('#decisionContent').innerText();
      assert.match(reportText, /does not mean it fits, is code-compliant/);
      assert.match(reportText, /Next checks for this space/);
      assert.match(reportText, /Clarify unconfirmed or unassessed needs:.*Pantry/);
      const selectedRows = saved.sites.find(site => site.fixtureId === scenario.selected).rows;
      if (scenario.expectedGap) {
        assert.ok(selectedRows.some(row => row.name.toLowerCase().includes(scenario.expectedGap.toLowerCase()) && row.status === 'Shortfall'), `${scenario.name}: expected ${scenario.expectedGap} shortfall; got ${JSON.stringify(selectedRows)}`);
        assert.match(reportText, new RegExp(`Resolve counted shortfalls:.*${scenario.expectedGap}`, 'i'));
      }
      if (scenario.name === 'shared-amenities') for (const name of ['Dining seats', 'Lounge seats', 'Coffee bar', 'Reception']) assert.ok(selectedRows.some(row => row.name.includes(name) && !row.name.startsWith('Unconfirmed')), `shared-amenities: missing requested ${name} row`);
      await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.customerFlowShareURL = value; } } }));
      await page.locator('#decisionShare').click();
      const sharedUrl = await page.evaluate(() => window.customerFlowShareURL);
      assert.ok(sharedUrl?.includes('#decision='));
      const sharedContext = await browser.newContext({ viewport: { width: 1100, height: 850 } });
      const recipient = await sharedContext.newPage();
      await recipient.goto(sharedUrl);
      assert.equal(await recipient.locator('#decisionModal').isVisible(), true);
      assert.equal(await recipient.locator('#decisionContinue').isVisible(), false);
      assert.ok((await recipient.locator('#decisionContent').innerText()).includes(scenario.reason));
      await sharedContext.close();
      await page.locator('#decisionContinue').click();
      assert.equal(await page.evaluate(() => P.source.fixtureId), scenario.selected);
      assert.equal(await page.evaluate(() => P.drafts.length), 3);
      assert.equal(await page.locator('#comparisonGrid .comparison-card').count(), 3);
      for (const [field, expected] of Object.entries(scenario.needs)) assert.equal(await page.evaluate(field => P.broker[field], field), expected, `${scenario.name}: regenerated ${field}`);
      await page.locator('#brokerResult').click();
      assert.match(await page.locator('#brokerReportContent').innerText(), /Not assessed|Shortfall|Placed · concept/);
      assert.deepEqual(errors, [], `${scenario.name}: browser errors`);
      console.log(`PASS ${scenario.name}: input → review → three sites → saved/shareable choice → A/B/C → result; shortfalls=${selectedRows.filter(row => row.status === 'Shortfall').map(row => row.name).join(', ') || 'none'}; open=${selectedRows.filter(row => ['Needs review', 'Not assessed'].includes(row.status)).length}`);
      await context.close();
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
