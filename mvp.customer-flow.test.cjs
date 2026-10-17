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
    if (!['studio.html', 'sample-furniture.js', 'studio.js', 'broker.js', 'zone-program.js', 'zone-assist.js', 'src/domain/design-bom.js', 'src/domain/product-slots.js','src/domain/furniture-taxonomy.js','src/domain/product-use-spec.js', 'src/domain/catalog-import.js', 'src/domain/match-products.js', 'src/domain/layout-revision.js', 'src/domain/home-product-binding.js', 'src/domain/office-product-binding.js', 'src/domain/planning-product-binding.js', 'src/domain/planning-coverage.js', 'src/domain/planning-fit-alternatives.js', 'src/domain/home-assemblies.js', 'src/domain/product-placement.js', 'src/domain/procurement-bom.js', 'src/domain/set-offers.js', 'src/domain/set-procurement.js', 'src/domain/review-snapshot.js'].includes(name)) {
      res.writeHead(404); res.end(); return;
    }
    res.setHeader('Content-Type', name.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8');
    res.end(await readFile(path.join(__dirname, name)));
  });
  let listening = false;
  for (let attempt = 0; attempt < 10 && !listening; attempt++) {
    const port = 40000 + Math.floor(Math.random() * 10000);
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
      });
      listening = true;
    } catch (error) {
      if (attempt === 9) throw error;
    }
  }
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
      for (const kind of ['wardrobe', 'table', 'homeChair', 'vanity', 'sofa', 'coffeeTable', 'lowCabinet', 'bed']) {
        assert.equal(await page.locator(`#catalog [data-kind="${kind}"]`).count(), 1, `${kind}: furniture category appears in the editor`);
      }
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
      await page.waitForFunction(() => !document.querySelector('#designBom')?.textContent.includes('Preparing design needs'));
      const designNeeds = await page.evaluate(() => ({
        expected: allDisplayFurniture(P.furniture).length,
        actual: [...document.querySelectorAll('#designBom .item b')].reduce((sum, node) => sum + Number(node.textContent.replace(/[^0-9]/g, '')), 0),
        text: document.querySelector('#designBom').textContent,
      }));
      assert.equal(designNeeds.actual, designNeeds.expected, `${scenario.name}: design needs match placed furniture`);
      assert.doesNotMatch(designNeeds.text, /DEMO-/);
      if (scenario.name === 'shared-amenities') {
        const drafts = await page.evaluate(async () => {
          const { isPlanningProductScene, bindReviewedPlanningScene } = await import('./src/domain/planning-product-binding.js');
          const { buildProductSlots } = await import('./src/domain/product-slots.js');
          const { importCatalog } = await import('./src/domain/catalog-import.js');
          const { auditPlanningCoverage } = await import('./src/domain/planning-coverage.js');
          const { reviewPlanningProductAlternatives } = await import('./src/domain/planning-fit-alternatives.js');
          const scenes = P.drafts.map(draft => {
          const raw = [...draft.furniture.flatMap(item => [item, ...chairItems(item)]),
            ...draft.objects.filter(item => item.type === 'room').flatMap(roomFurniture)];
          const physical = allDisplayFurniture(draft.furniture, draft.objects, {});
          const slots = buildProductSlots(physical);
          return { expected: raw.length + raw.filter(item => item.kind === 'dining4').length * 4 +
              raw.filter(item => item.kind === 'lounge2').length,
            count: physical.length, unique: new Set(physical.map(item => item.id)).size,
            bundles: physical.filter(item => ['dining4', 'lounge2'].includes(item.kind)).length,
            reviewable: isPlanningProductScene({ ...P, furniture: draft.furniture, objects: draft.objects }, physical), slots };
          });
          const allSlots=scenes.flatMap(scene=>scene.slots);
          const roles=[...new Map(allSlots.map(slot=>[`${slot.category}:${slot.role}`,slot])).values()];
          const rows=roles.map((slot,index)=>({category:slot.category,role:slot.role,supplierSku:`FICT-${index}`,
            widthMm:slot.envelopeMm.width,depthMm:slot.envelopeMm.depth,heightMm:slot.envelopeMm.height||800,
            useZones:[{purpose:'fixture access',x:-100,y:slot.envelopeMm.depth/2,w:200,h:50}],
            doorMechanism:'sliding',frontClearanceMm:800,leftClearanceMm:500,rightClearanceMm:500,footClearanceMm:600,
            priceAmount:100,currency:'USD',availability:'in_stock',leadDays:7,purchaseUnit:'single'}));
          const diningRow=rows.find(row=>row.role==='dining-table');
          const {candidates,errors}=importCatalog({id:'fictional-abc',ref:'fixture:fictional-abc',
            observedAt:'2026-10-16T00:00:00Z',trustSpecs:true,trustUseSpec:true,trustPrice:true,
            trustAvailability:true,useReviewedBy:'fixture-reviewer',useReviewedAt:'2026-10-16T01:00:00Z'},
            [...rows,{...diningRow,supplierSku:'FICT-WIDE-DINING',widthMm:4000}]);
          return {errors,roleNames:roles.map(slot=>slot.role),drafts:await Promise.all(scenes.map(async (scene,index)=>{
            const selections=scene.slots.map(slot=>({sourceInstanceId:slot.sourceInstanceId,
              candidateId:candidates.find(candidate=>candidate.category===slot.category&&candidate.role===slot.role)?.candidateId}));
            const coverage=auditPlanningCoverage({slots:scene.slots,candidates,selections});
            const draft=P.drafts[index],project={...P,furniture:draft.furniture,objects:draft.objects,derivedProducts:{}};
            const displayFurniture=trial=>allDisplayFurniture(trial.furniture,trial.objects,trial.derivedProducts);
            const review=await bindReviewedPlanningScene({project,selections,candidates,displayFurniture});
            const dining=scene.slots.find(slot=>slot.role==='dining-table');
            const wideSelections=selections.map(selection=>selection.sourceInstanceId===dining.sourceInstanceId
              ? {...selection,candidateId:candidates.find(candidate=>candidate.supplierSku==='FICT-WIDE-DINING').candidateId}:selection);
            const wideReview=await bindReviewedPlanningScene({project,selections:wideSelections,candidates,displayFurniture});
            const recovery=await reviewPlanningProductAlternatives({project,selections:wideSelections,candidates,
              displayFurniture,initialReview:wideReview,maxTrials:6});
            return {...scene,coverage:{itemCount:coverage.itemCount,ready:coverage.readyForPlacementReview,
              reasons:coverage.lines.filter(line=>line.reasons.length).map(line=>`${line.sourceInstanceId}:${line.reasons.join(',')}`)},
              fit:{status:review.status,wideStatus:wideReview.status,wideIssueCount:wideReview.placementIssues?.length||0,
                recoveryStatus:recovery.status,recoveryInstanceIds:recovery.alternatives.map(item=>item.sourceInstanceId),
                expectedRecoveryId:dining.sourceInstanceId}};
          }))};
        });
        assert.deepEqual(drafts.errors, []);
        for (const role of ['dining-table','dining-chair','sofa','side-table']) assert.ok(drafts.roleNames.includes(role), `A/B/C includes ${role}`);
        for (const draft of drafts.drafts) {
          assert.equal(draft.count, draft.expected, 'A/B/C composite footprint expands once');
          assert.equal(draft.unique, draft.count, 'A/B/C physical furniture IDs stay unique');
          assert.equal(draft.bundles, 0, 'no bundle footprint enters design needs');
          assert.equal(draft.reviewable, true, 'A/B/C physical scenes enter complete product review');
          assert.equal(draft.coverage.itemCount, draft.count);
          assert.equal(draft.coverage.ready, draft.count, `fictional A/B/C evidence precheck: ${draft.coverage.reasons.join('; ')}`);
          assert.equal(draft.fit.status,'bound','matching fictional sizes pass complete A/B/C placement');
          assert.equal(draft.fit.wideStatus,'rejected','oversize dining table fails complete A/B/C placement');
          assert.ok(draft.fit.wideIssueCount>0,'oversize failure has placement reasons');
          assert.equal(draft.fit.recoveryStatus,'alternatives_found','a reviewed single-product alternative passes');
          assert.ok(draft.fit.recoveryInstanceIds.includes(draft.fit.expectedRecoveryId));
        }
        console.log('PASS A/B/C size substitution: matching fictional products bind; oversized dining table fails; one-item alternative restores all three');
        const alternateId = await page.locator('#comparisonGrid [data-compare-draft]').nth(1).getAttribute('data-compare-draft');
        await page.locator('#comparisonGrid [data-compare-draft]').nth(1).click();
        await page.reload();
        await page.waitForFunction(() => !document.querySelector('#designBom')?.textContent.includes('Preparing design needs'));
        const switched = await page.evaluate(() => ({ id: P.activeDraft,
          count: allDisplayFurniture(P.furniture).length,
          shown: [...document.querySelectorAll('#designBom .item b')].reduce((n, node) => n + Number(node.textContent.replace(/[^0-9]/g, '')), 0) }));
        assert.equal(switched.id, alternateId);
        assert.equal(switched.count, switched.shown, 'switched A/B/C plan keeps physical counts after reload');
      }
      if (scenario.name === 'desk-heavy') {
        const alternate = page.locator('#comparisonGrid [data-compare-draft]').nth(1);
        const alternateId = await alternate.getAttribute('data-compare-draft');
        await alternate.click();
        assert.equal(await page.evaluate(() => P.activeDraft), alternateId);
        await page.reload();
        await page.waitForFunction(() => !document.querySelector('#designBom')?.textContent.includes('Preparing design needs'));
        assert.equal(await page.evaluate(() => P.activeDraft), alternateId);
        const restored = await page.evaluate(() => ({
          expected: allDisplayFurniture(P.furniture).length,
          actual: [...document.querySelectorAll('#designBom .item b')].reduce((sum, node) => sum + Number(node.textContent.replace(/[^0-9]/g, '')), 0),
        }));
        assert.equal(restored.actual, restored.expected, 'design needs restore after switching and reloading');
        await page.locator('#productSourcing summary').click();
        await page.locator('#productCatalogFile').setInputFiles({
          name: 'fictional-supplier.csv', mimeType: 'text/csv',
          buffer: Buffer.from('role,supplierSku,name,widthMm,depthMm,heightMm,priceAmount,currency,availability\ntask-chair,FICT-CHAIR,Sample chair,600,600,1000,200,USD,in_stock\ntask-chair,FICT-MISSING,Chair without dimensions,,,,,USD,unknown\n'),
        });
        await page.waitForFunction(() => document.querySelector('#productSourcingStatus')?.textContent.includes('2 research candidates imported'));
        assert.match(await page.locator('#productCandidateResults').innerText(), /FICT-CHAIR/);
        assert.match(await page.locator('#productCandidateResults').innerText(), /width\/depth missing/);
        assert.match(await page.locator('#productCandidateResults').innerText(), /Purchase unit unknown/);
        assert.match(await page.locator('#productCandidateResults').innerText(), /Research candidate/);
        await page.locator('#productCandidateResults [data-product-candidate]').first().click();
        assert.match(await page.locator('#productCandidateResults').innerText(), /Current-position check:/);
        const oversizedReview = await page.evaluate(() => {
          const first = P.furniture[0], before = JSON.stringify(P);
          const review = candidatePositionReview({ sourceInstanceIds: [first.id] }, { dimensionsMm: { width: P.w * 2, depth: P.h * 2 } });
          return { review, unchanged: JSON.stringify(P) === before };
        });
        assert.equal(oversizedReview.review.blocked, 1, 'oversized product fails current-position geometry');
        assert.match(oversizedReview.review.reasons.join(' '), /Footprint/);
        assert.equal(oversizedReview.unchanged, true, 'placement review does not mutate the project');
        assert.equal(await page.evaluate(() => JSON.stringify(P).includes('FICT-CHAIR')), false, 'unverified candidate does not change the project');
      }
      for (const [field, expected] of Object.entries(scenario.needs)) assert.equal(await page.evaluate(field => P.broker[field], field), expected, `${scenario.name}: regenerated ${field}`);
      await page.locator('#brokerResult').click();
      assert.match(await page.locator('#brokerReportContent').innerText(), /Not assessed|Shortfall|Placed · concept/);
      assert.deepEqual(errors, [], `${scenario.name}: browser errors`);
      console.log(`PASS ${scenario.name}: input → review → three sites → saved/shareable choice → A/B/C → result; shortfalls=${selectedRows.filter(row => row.status === 'Shortfall').map(row => row.name).join(', ') || 'none'}; open=${selectedRows.filter(row => ['Needs review', 'Not assessed'].includes(row.status)).length}`);
      await context.close();
    }
    const categoryContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const categoryPage = await categoryContext.newPage();
    await categoryPage.goto(url);
    await categoryPage.waitForFunction(() => !document.querySelector('#designBom')?.textContent.includes('Preparing design needs'));
    const categoryPlacement = await categoryPage.evaluate(async () => {
      P = fresh('Furniture category check', 30000, 20000);
      document.querySelector('#welcomeModal').hidden = true;
      const kinds = ['wardrobe', 'table', 'homeChair', 'vanity', 'sofa', 'coffeeTable', 'lowCabinet', 'bed'];
      for (const kind of kinds) addFurniture(kind);
      const { buildProductSlots } = await import('./src/domain/product-slots.js');
      return {
        kinds: P.furniture.map(item => item.kind),
        categories: buildProductSlots(allDisplayFurniture(P.furniture)).map(slot => slot.category),
        itemCount: [...document.querySelectorAll('#designBom .item b')].reduce((sum, node) => sum + Number(node.textContent.replace(/[^0-9]/g, '')), 0),
      };
    });
    assert.deepEqual(categoryPlacement.kinds, ['wardrobe', 'table', 'homeChair', 'vanity', 'sofa', 'coffeeTable', 'lowCabinet', 'bed']);
    assert.deepEqual(categoryPlacement.categories, ['wardrobe', 'table', 'chair', 'vanity', 'sofa', 'coffee_table', 'low_cabinet', 'bed']);
    assert.equal(categoryPlacement.itemCount, 8);
    const relationIds = await categoryPage.evaluate(() => Object.fromEntries(P.furniture.map(item => [item.kind, item.id])));
    await categoryPage.locator(`[data-home-link="${relationIds.homeChair}"]`).selectOption(relationIds.table);
    await categoryPage.locator(`[data-home-link="${relationIds.coffeeTable}"]`).selectOption(relationIds.sofa);
    assert.deepEqual(await categoryPage.evaluate(() => P.furniture.filter(item => ['homeChair', 'coffeeTable'].includes(item.kind)).map(item => item.linkedTo)), [relationIds.table, relationIds.sofa]);
    await categoryPage.reload();
    assert.deepEqual(await categoryPage.evaluate(() => P.furniture.filter(item => ['homeChair', 'coffeeTable'].includes(item.kind)).map(item => item.linkedTo)), [relationIds.table, relationIds.sofa]);
    console.log('PASS furniture categories: eight examples counted; explicit design links saved and restored');
    const roomCoverage = await categoryPage.evaluate(async () => {
      const { buildProductSlots } = await import('./src/domain/product-slots.js');
      const { importCatalog } = await import('./src/domain/catalog-import.js');
      const { auditPlanningCoverage } = await import('./src/domain/planning-coverage.js');
      const { isPlanningProductScene } = await import('./src/domain/planning-product-binding.js');
      const kinds=['office','pantry',...Object.keys(extraRoomSpecs)];
      const scenes=kinds.map(kind=>{
        const seats={meeting:6,huddle:4,training:8,video:4}[kind]||2;
        const size=roomSpec(kind,seats,'south');
        const room={id:`room-${kind}`,type:'room',kind,x:1000,y:1000,x2:1000+size.w,y2:1000+size.h,
          plannedSeats:seats,door:{side:'south',width:900}};
        const physical=allDisplayFurniture([], [room], {});
        return {kind,reviewable:isPlanningProductScene({furniture:[],objects:[room]},physical),
          slots:buildProductSlots(physical)};
      });
      const roles=[...new Map(scenes.flatMap(scene=>scene.slots).map(slot=>[`${slot.category}:${slot.role}`,slot])).values()];
      const rows=roles.map((slot,index)=>({category:slot.category,role:slot.role,supplierSku:`FICT-ROOM-${index}`,
        widthMm:slot.envelopeMm.width,depthMm:slot.envelopeMm.depth,heightMm:slot.envelopeMm.height||800,
        useZones:[{purpose:'fixture access',x:-100,y:slot.envelopeMm.depth/2,w:200,h:50}],
        priceAmount:100,currency:'USD',availability:'in_stock',leadDays:7,purchaseUnit:'single'}));
      const {candidates,errors}=importCatalog({id:'fictional-room-types',ref:'fixture:fictional-room-types',
        observedAt:'2026-10-16T00:00:00Z',trustSpecs:true,trustUseSpec:true,trustPrice:true,
        trustAvailability:true,useReviewedBy:'fixture-reviewer',useReviewedAt:'2026-10-16T01:00:00Z'},rows);
      return {errors,scenes:scenes.map(scene=>{
        const coverage=auditPlanningCoverage({slots:scene.slots,candidates,
          selections:scene.slots.map(slot=>({sourceInstanceId:slot.sourceInstanceId,
            candidateId:candidates.find(candidate=>candidate.category===slot.category&&candidate.role===slot.role)?.candidateId}))});
        return {kind:scene.kind,reviewable:scene.reviewable,count:scene.slots.length,
          ready:coverage.readyForPlacementReview,reasons:coverage.lines.filter(line=>line.reasons.length).map(line=>line.reasons.join(','))};
      })};
    });
    assert.deepEqual(roomCoverage.errors, []);
    for (const room of roomCoverage.scenes) {
      assert.ok(room.count>0, `${room.kind} has physical furniture`);
      assert.equal(room.reviewable,true,`${room.kind} enters complete product review`);
      assert.equal(room.ready,room.count,`${room.kind} has evidence protocol for every role: ${room.reasons.join('; ')}`);
    }
    console.log(`PASS room product coverage: ${roomCoverage.scenes.length} room kinds have explicit physical roles and reviewed-evidence precheck`);
    await categoryContext.close();
    const compositeContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const compositePage = await compositeContext.newPage();
    const compositeErrors = [];
    compositePage.on('pageerror', error => compositeErrors.push(error.message));
    await compositePage.goto(url);
    await compositePage.waitForFunction(() => !document.querySelector('#designBom')?.textContent.includes('Preparing design needs'));
    const composite = await compositePage.evaluate(async () => {
      P = fresh('Composite instance fixture', 30000, 20000);
      document.querySelector('#welcomeModal').hidden = true;
      P.site.confirmed = true;
      P.furniture = [makeFurniture('dining4', 3000, 3000), makeFurniture('lounge2', 8000, 3000)];
      P.furniture[0].id = 'shared-dining'; P.furniture[1].id = 'shared-lounge';
      for (const [kind, x] of [['collaboration', 1000], ['waiting', 6000], ['canteen', 11000]]) {
        const size = roomSpec(kind, 0, 'south');
        P.objects.push({ id: kind, type: 'room', kind, x, y: 9000, x2: x + size.w,
          y2: 9000 + size.h, door: { side: 'south', width: 900 } });
      }
      save();
      const physical = allDisplayFurniture(P.furniture);
      const { buildProductSlots } = await import('./src/domain/product-slots.js');
      const { analyzeHomeAssemblies } = await import('./src/domain/home-assemblies.js');
      return { ids: physical.map(item => item.id), kinds: physical.map(item => item.kind),
        demoValues: physical.filter(item => item.sku?.startsWith('DEMO-') || item.price != null).length,
        slots: buildProductSlots(physical).length,
        designCount: [...document.querySelectorAll('#designBom .item b')].reduce((n, node) => n + Number(node.textContent.replace(/[^0-9]/g, '')), 0),
        roomsValid: P.objects.filter(item => item.type === 'room').every(room => roomFurnitureValid(room, P)),
        linked: physical.filter(item => item.linkedTo).every(item => physical.some(anchor => anchor.id === item.linkedTo)),
        relations: analyzeHomeAssemblies(physical) };
    });
    assert.equal(composite.slots, 16);
    assert.equal(composite.designCount, 16);
    assert.equal(new Set(composite.ids).size, 16);
    assert.equal(composite.kinds.filter(kind => kind === 'diningTable').length, 2);
    assert.equal(composite.kinds.filter(kind => kind === 'diningChair').length, 8);
    assert.equal(composite.kinds.filter(kind => kind === 'sofa').length, 3);
    assert.equal(composite.kinds.filter(kind => kind === 'sideTable').length, 3);
    assert.equal(composite.kinds.some(kind => ['dining4', 'lounge2'].includes(kind)), false);
    assert.equal(composite.demoValues, 0);
    assert.equal(composite.roomsValid, true);
    assert.equal(composite.linked, true);
    assert.deepEqual(composite.relations.errors, []);
    assert.equal(composite.relations.relations.length, 11);
    await compositePage.evaluate(() => { view = '3d'; draw3d(); view = '2d'; draw2d(); });
    const oldDownload = compositePage.waitForEvent('download').catch(error => error);
    await compositePage.locator('#exportReviewSnapshot').click();
    await compositePage.waitForFunction(() => /Review snapshot (exported|could not be exported)/.test(document.querySelector('#reviewSnapshotStatus')?.textContent || ''));
    assert.match(await compositePage.locator('#reviewSnapshotStatus').innerText(), /Review snapshot exported/);
    const oldCompositeFile = await oldDownload;
    if (oldCompositeFile instanceof Error) throw oldCompositeFile;
    const oldComposite = JSON.parse(await readFile(await oldCompositeFile.path(), 'utf8'));
    assert.equal(oldComposite.design.itemCount, 16);
    assert.equal(oldComposite.procurement.pendingCount, 16);
    assert.equal(oldComposite.procurement.merchandiseSubtotal, null);
    assert.deepEqual(oldComposite.layout.displayFurniture.map(item => item.id), composite.ids);
    await compositePage.evaluate(() => {
      P.objects = P.objects.filter(item => item.id !== 'canteen');
      P.furniture = P.furniture.filter(item => item.id !== 'shared-lounge');
      save();
    });
    const newDownload = compositePage.waitForEvent('download').catch(error => error);
    await compositePage.locator('#exportReviewSnapshot').click();
    await compositePage.waitForFunction(() => /Review snapshot (exported|could not be exported)/.test(document.querySelector('#reviewSnapshotStatus')?.textContent || ''));
    assert.match(await compositePage.locator('#reviewSnapshotStatus').innerText(), /Review snapshot exported/);
    const newCompositeFile = await newDownload;
    if (newCompositeFile instanceof Error) throw newCompositeFile;
    const newComposite = JSON.parse(await readFile(await newCompositeFile.path(), 'utf8'));
    assert.equal(newComposite.design.itemCount, 9);
    assert.equal(newComposite.procurement.pendingCount, 9);
    assert.notEqual(newComposite.layout.revision, oldComposite.layout.revision);
    assert.equal(oldComposite.design.itemCount, 16, 'prior snapshot remains immutable');
    assert.deepEqual(compositeErrors, []);
    console.log('PASS composite furniture: physical instances match 2D/3D, design needs and immutable review snapshots');
    await compositeContext.close();
    const { loadTrustedCatalog } = await import('./src/domain/trusted-catalog.js');
    const mixedFixture = loadTrustedCatalog({ sources: [{
      id: 'fictional-mixed-ui', ref: 'fixture:fictional-mixed-ui', observedAt: '2026-10-16T00:00:00Z',
      trustSpecs: true, trustUseSpec: true, trustPrice: true, trustAvailability: true,
      useReviewedBy: 'fixture-reviewer', useReviewedAt: '2026-10-16T01:00:00Z',
      products: [
        { role: 'dining-table', sku: 'DT-1', widthMm: 1000, depthMm: 700, heightMm: 750,
          useZones: [{ purpose: 'table access', x: -200, y: -450, w: 400, h: 100 }] },
        { role: 'dining-table', sku: 'DT-WIDE', widthMm: 4000, depthMm: 700, heightMm: 750,
          useZones: [{ purpose: 'table access', x: -200, y: -450, w: 400, h: 100 }] },
        { role: 'dining-chair', sku: 'DC-1', widthMm: 600, depthMm: 600, heightMm: 850,
          useZones: [{ purpose: 'chair pullback', x: -100, y: -400, w: 200, h: 100 }] },
        { role: 'sofa', sku: 'S-1', widthMm: 1600, depthMm: 800, heightMm: 850,
          useZones: [{ purpose: 'sofa access', x: -200, y: 400, w: 400, h: 100 }] },
        { role: 'sofa', sku: 'S-WIDE', widthMm: 4000, depthMm: 800, heightMm: 850,
          useZones: [{ purpose: 'sofa access', x: -200, y: 400, w: 400, h: 100 }] },
        { role: 'side-table', sku: 'ST-1', widthMm: 500, depthMm: 500, heightMm: 550,
          useZones: [{ purpose: 'side access', x: 250, y: -100, w: 100, h: 200 }] },
      ].map(row => ({ ...row, priceAmount: 100, currency: 'USD', availability: 'in_stock',
        leadDays: 7, purchaseUnit: 'single' })),
    }] });
    const mixedContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const mixedPage = await mixedContext.newPage();
    const mixedErrors = [];
    mixedPage.on('pageerror', error => mixedErrors.push(error.message));
    await mixedPage.route('**/api/trusted-products', route => route.fulfill({ status: 200,
      contentType: 'application/json', body: JSON.stringify(mixedFixture) }));
    await mixedPage.goto(url);
    await mixedPage.waitForFunction(() => !document.querySelector('#designBom')?.textContent.includes('Preparing design needs'));
    await mixedPage.evaluate(() => {
      P = fresh('Fictional mixed binding', 16000, 9000);
      document.querySelector('#welcomeModal').hidden = true;
      P.site.confirmed = true;
      P.objects.push({ id: 'entry', type: 'door', x: 0, y: 4500 },
        { id: 'exit', type: 'exit', x: 16000, y: 4500 },
        { id: 'dining-zone', type: 'zone', kind: 'dining', x: 2000, y: 2000, x2: 5000, y2: 4800 },
        { id: 'waiting', type: 'room', kind: 'waiting', x: 8000, y: 2000, x2: 11200, y2: 5000,
          door: { side: 'south', width: 900 } });
      const dining = makeFurniture('dining4', 3500, 3400);
      dining.id = 'dining-set'; dining.zoneId = 'dining-zone';
      P.furniture = [dining]; save();
    });
    await mixedPage.locator('#productSourcing summary').click();
    await mixedPage.locator('#productSourcePin').fill('fixture-pin');
    await mixedPage.locator('#approvedProductPanel summary').click();
    await mixedPage.locator('#loadApprovedProducts').click();
    await mixedPage.waitForFunction(() => document.querySelectorAll('[data-approved-instance]').length === 7);
    assert.match(await mixedPage.locator('#approvedCoverageSummary').innerText(), /0\/7 physical items ready/);
    assert.match(await mixedPage.locator('[data-approved-instance="dining-set-table"]').locator('xpath=..').innerText(), /Choose a reviewed product/);
    const roles = { 'dining-set-table': 'dining-table',
      'dining-set-chair-west': 'dining-chair', 'dining-set-chair-east': 'dining-chair',
      'dining-set-chair-north': 'dining-chair', 'dining-set-chair-south': 'dining-chair',
      'waiting-seating-sofa': 'sofa', 'waiting-seating-table': 'side-table' };
    for (const [instanceId, role] of Object.entries(roles)) {
      const candidate = mixedFixture.candidates.find(item => item.role === role);
      await mixedPage.locator(`[data-approved-instance="${instanceId}"]`).selectOption(candidate.candidateId);
    }
    assert.match(await mixedPage.locator('#approvedCoverageSummary').innerText(), /7\/7 physical items ready/);
    await mixedPage.locator('[data-approved-instance="waiting-seating-sofa"]')
      .selectOption(mixedFixture.candidates.find(item => item.supplierSku === 'S-WIDE').candidateId);
    await mixedPage.locator('#bindApprovedProducts').click();
    await mixedPage.waitForFunction(() => document.querySelector('#approvedProductStatus')?.textContent.includes('Outside room'));
    assert.match(await mixedPage.locator('#approvedProductStatus').innerText(), /waiting-seating-sofa: Outside room \(waiting\)/);
    assert.doesNotMatch(await mixedPage.locator('#approvedProductStatus').innerText(), /dining-set-table: Outside room/);
    assert.equal(await mixedPage.evaluate(() => P.productBindings.length), 0);
    await mixedPage.locator('#approvedFitAlternatives [data-fit-instance="waiting-seating-sofa"]').waitFor();
    await mixedPage.locator('#approvedFitAlternatives [data-fit-instance="waiting-seating-sofa"]').click();
    assert.equal(await mixedPage.locator('[data-approved-instance="waiting-seating-sofa"]').inputValue(),
      mixedFixture.candidates.find(item => item.supplierSku === 'S-1').candidateId);
    assert.equal(await mixedPage.evaluate(() => P.productBindings.length), 0, 'alternative changes choice only');
    await mixedPage.locator('[data-approved-instance="dining-set-table"]')
      .selectOption(mixedFixture.candidates.find(item => item.supplierSku === 'DT-WIDE').candidateId);
    await mixedPage.locator('[data-approved-instance="waiting-seating-sofa"]')
      .selectOption(mixedFixture.candidates.find(item => item.supplierSku === 'S-WIDE').candidateId);
    await mixedPage.locator('#bindApprovedProducts').click();
    await mixedPage.locator('#approvedFitAlternatives [data-fit-pair]').first().waitFor();
    assert.equal(await mixedPage.evaluate(() => P.productBindings.length),0,'pair review does not bind automatically');
    await mixedPage.locator('#approvedFitAlternatives [data-fit-pair]').first().click();
    assert.equal(await mixedPage.locator('[data-approved-instance="dining-set-table"]').inputValue(),
      mixedFixture.candidates.find(item => item.supplierSku === 'DT-1').candidateId);
    assert.equal(await mixedPage.locator('[data-approved-instance="waiting-seating-sofa"]').inputValue(),
      mixedFixture.candidates.find(item => item.supplierSku === 'S-1').candidateId);
    await mixedPage.locator('#bindApprovedProducts').click();
    await mixedPage.waitForFunction(() => /product instances reviewed and bound|Binding needs review|Could not review and bind/.test(
      document.querySelector('#approvedProductStatus')?.textContent || ''));
    assert.match(await mixedPage.locator('#approvedProductStatus').innerText(), /7 product instances reviewed and bound/);
    await mixedPage.waitForFunction(() => document.querySelector('#approvedDraft')?.textContent.includes('Merchandise subtotal: USD 700'));
    assert.equal(await mixedPage.evaluate(() => P.productBindings.length), 7);
    assert.equal(await mixedPage.evaluate(() => P.furniture[0].sku), 'DEMO-DINING-4');
    const mixedDownload = mixedPage.waitForEvent('download');
    await mixedPage.locator('#exportReviewSnapshot').click();
    const mixedReview = JSON.parse(await readFile(await (await mixedDownload).path(), 'utf8'));
    assert.equal(mixedReview.design.itemCount, 7);
    assert.equal(mixedReview.procurement.readyCount, 7);
    assert.deepEqual(mixedReview.procurement.merchandiseSubtotal, { amount: '700', currency: 'USD' });
    await mixedPage.evaluate(() => { P.furniture[0].x += 200; save(); });
    await mixedPage.waitForFunction(() => document.querySelector('#approvedDraft')?.textContent.includes('placement_unverified_or_stale'));
    assert.doesNotMatch(await mixedPage.locator('#approvedDraft').innerText(), /Merchandise subtotal:/);
    assert.deepEqual(mixedErrors, []);
    console.log('PASS fictional mixed products: one/two-product adjustments → full-scene bind → snapshot → stale after layout edit');
    await mixedContext.close();
    const moveFixture = loadTrustedCatalog({ sources: [{id:'fictional-move',ref:'fixture:fictional-move',
      observedAt:'2026-10-16T00:00:00Z',trustSpecs:true,trustUseSpec:true,trustPrice:true,
      trustAvailability:true,useReviewedBy:'fixture-reviewer',useReviewedAt:'2026-10-16T01:00:00Z',
      products:[{role:'side-table',supplierSku:'ST-ONLY',widthMm:500,depthMm:500,heightMm:550,
        useZones:[{purpose:'side access',x:250,y:-100,w:100,h:200}],priceAmount:100,currency:'USD',
        availability:'in_stock',leadDays:7,purchaseUnit:'single'}]}] });
    const moveContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const movePage = await moveContext.newPage();
    await movePage.route('**/api/trusted-products', route => route.fulfill({ status: 200,
      contentType: 'application/json', body: JSON.stringify(moveFixture) }));
    await movePage.goto(url);
    await movePage.waitForFunction(() => !document.querySelector('#designBom')?.textContent.includes('Preparing design needs'));
    await movePage.evaluate(() => {
      P=fresh('Fictional local adjustment',10000,8000);P.site.confirmed=true;
      P.objects.push({id:'entry',type:'door',x:0,y:4000},{id:'exit',type:'exit',x:10000,y:4000});
      P.furniture=[makeFurniture('sideTable',9850,2000)];P.furniture[0].id='side-table-1';
      document.querySelector('#welcomeModal').hidden=true;save();
    });
    await movePage.locator('#productSourcing summary').click();
    await movePage.locator('#productSourcePin').fill('fixture-pin');
    await movePage.locator('#approvedProductPanel summary').click();
    await movePage.locator('#loadApprovedProducts').click();
    await movePage.locator('[data-approved-instance="side-table-1"]')
      .selectOption(moveFixture.candidates[0].candidateId);
    await movePage.locator('#bindApprovedProducts').click();
    await movePage.locator('#approvedFitAlternatives [data-move-instance="side-table-1"]').first().waitFor();
    assert.match(await movePage.locator('#approvedProductStatus').innerText(), /side-table-1: Outside site/);
    await movePage.locator('#approvedFitAlternatives [data-move-instance="side-table-1"]').first().click();
    assert.ok(await movePage.evaluate(() => P.furniture[0].x < 9850));
    assert.equal(await movePage.evaluate(() => P.productBindings.length),0,'suggested move does not bind automatically');
    await movePage.locator('#bindApprovedProducts').click();
    await movePage.waitForFunction(() => document.querySelector('#approvedProductStatus')?.textContent.includes('1 product instances reviewed and bound'));
    console.log('PASS local adjustment: oversized position fails → checked move applied → full scene bound after a new review');
    await moveContext.close();
    const containerFixture = loadTrustedCatalog({ sources: [{id:'fictional-container',ref:'fixture:fictional-container',
      observedAt:'2026-10-16T00:00:00Z',trustSpecs:true,trustUseSpec:true,trustPrice:true,
      trustAvailability:true,useReviewedBy:'fixture-reviewer',useReviewedAt:'2026-10-16T01:00:00Z',
      products:[
        {role:'sofa',supplierSku:'S-2800',widthMm:2800,depthMm:800,heightMm:850,
          useZones:[{purpose:'sofa access',x:-200,y:400,w:400,h:100}]},
        {role:'side-table',supplierSku:'ST-1',widthMm:500,depthMm:500,heightMm:550,
          useZones:[{purpose:'side access',x:250,y:-100,w:100,h:200}]},
        {role:'dining-table',supplierSku:'DT-EDGE',widthMm:1000,depthMm:700,heightMm:750,
          useZones:[{purpose:'right-side access',x:500,y:-100,w:800,h:200}]},
        {role:'dining-chair',supplierSku:'DC-1',widthMm:600,depthMm:600,heightMm:850,
          useZones:[{purpose:'chair pullback',x:-100,y:-400,w:200,h:100}]},
      ].map(row=>({...row,priceAmount:100,currency:'USD',availability:'in_stock',leadDays:7,purchaseUnit:'single'}))}] });
    const containerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const containerPage = await containerContext.newPage();
    await containerPage.route('**/api/trusted-products', route => route.fulfill({ status: 200,
      contentType: 'application/json', body: JSON.stringify(containerFixture) }));
    await containerPage.goto(url);
    await containerPage.waitForFunction(() => !document.querySelector('#designBom')?.textContent.includes('Preparing design needs'));
    const roomReady = await containerPage.evaluate(() => {
      P=fresh('Fictional room reflow',16000,9000);P.site.confirmed=true;
      const room={id:'waiting',type:'room',kind:'waiting',x:8000,y:2000,x2:11200,y2:5000,
        door:{side:'south',width:900},furnitureShift:{dx:250,dy:0}};
      P.objects.push({id:'entry',type:'door',x:0,y:4500},{id:'exit',type:'exit',x:16000,y:4500},room);
      document.querySelector('#welcomeModal').hidden=true;save();
      return {valid:roomFurnitureValid(room,P),ids:allDisplayFurniture(P.furniture).map(item=>item.id)};
    });
    assert.equal(roomReady.valid,true,'shifted concept furniture still fits its room');
    assert.deepEqual(roomReady.ids,['waiting-seating-sofa','waiting-seating-table']);
    await containerPage.locator('#productSourcing summary').click();
    await containerPage.locator('#productSourcePin').fill('fixture-pin');
    await containerPage.locator('#approvedProductPanel summary').click();
    await containerPage.locator('#loadApprovedProducts').click();
    for (const [instanceId,role] of [['waiting-seating-sofa','sofa'],['waiting-seating-table','side-table']])
      await containerPage.locator(`[data-approved-instance="${instanceId}"]`)
        .selectOption(containerFixture.candidates.find(item=>item.role===role).candidateId);
    await containerPage.locator('#bindApprovedProducts').click();
    await containerPage.locator('#approvedFitAlternatives [data-container-move]').first().waitFor();
    assert.match(await containerPage.locator('#approvedProductStatus').innerText(), /waiting-seating-sofa: Outside room/);
    await containerPage.locator('#approvedFitAlternatives [data-container-move]').first().click();
    assert.equal(await containerPage.evaluate(() => P.objects.find(item=>item.id==='waiting').furnitureShift.dx),0);
    assert.equal(await containerPage.evaluate(() => P.productBindings.length),0);
    await containerPage.locator('#bindApprovedProducts').click();
    await containerPage.waitForFunction(() => document.querySelector('#approvedProductStatus')?.textContent.includes('2 product instances reviewed and bound'));
    await containerPage.reload();
    assert.equal(await containerPage.evaluate(() => P.objects.find(item=>item.id==='waiting').furnitureShift.dx),0,'room reflow survives reload');
    assert.equal(await containerPage.evaluate(() => P.productBindings.length),2);
    await containerPage.locator('#productSourcing summary').click();
    await containerPage.locator('#productSourcePin').fill('fixture-pin');
    await containerPage.locator('#approvedProductPanel summary').click();
    await containerPage.locator('#loadApprovedProducts').click();
    await containerPage.waitForFunction(() => document.querySelector('#approvedProductStatus')?.textContent.includes('4 products loaded'));
    await containerPage.waitForFunction(() => document.querySelector('#approvedDraft')?.textContent.includes('2/2 reviewed product instances current'));
    await containerPage.evaluate(() => { P.objects.find(item=>item.id==='waiting').furnitureShift.dx=250;save(); });
    await containerPage.waitForFunction(() => document.querySelector('#approvedDraft')?.textContent.includes('0/2 reviewed product instances current'));
    assert.doesNotMatch(await containerPage.locator('#approvedDraft').innerText(),/Merchandise subtotal:/);
    await containerPage.evaluate(() => {
      P=fresh('Fictional zone reflow',16000,9000);P.site.confirmed=true;
      const zone={id:'dining-zone',type:'zone',kind:'dining',x:2000,y:2000,x2:5000,y2:4800};
      P.objects.push({id:'entry',type:'door',x:0,y:4500},{id:'exit',type:'exit',x:16000,y:4500},
        {id:'main-corridor',type:'corridor',kind:'main',x:2000,y:4800,x2:5000,y2:6000},zone);
      const dining=makeFurniture('dining4',3750,3400);dining.id='dining-set';dining.zoneId='dining-zone';
      P.furniture=[dining];save();
    });
    assert.equal(await containerPage.evaluate(() => validSharedZone(P.objects.find(item=>item.id==='dining-zone'),P.objects,P.furniture)),true);
    for (const item of await containerPage.evaluate(() => allDisplayFurniture(P.furniture).map(item=>({id:item.id,kind:item.kind})))) {
      const role={diningTable:'dining-table',diningChair:'dining-chair'}[item.kind];
      await containerPage.locator(`[data-approved-instance="${item.id}"]`)
        .selectOption(containerFixture.candidates.find(candidate=>candidate.role===role).candidateId);
    }
    await containerPage.locator('#bindApprovedProducts').click();
    await containerPage.locator('#approvedFitAlternatives [data-container-move]').first().waitFor();
    assert.match(await containerPage.locator('#approvedProductStatus').innerText(), /dining-set-table: Outside shared zone/);
    await containerPage.locator('#approvedFitAlternatives [data-container-move]').first().click();
    assert.equal(await containerPage.evaluate(() => P.furniture[0].x),3500);
    await containerPage.locator('#bindApprovedProducts').click();
    await containerPage.waitForFunction(() => document.querySelector('#approvedProductStatus')?.textContent.includes('5 product instances reviewed and bound'));
    await containerPage.reload();
    assert.equal(await containerPage.evaluate(() => P.furniture[0].x),3500,'shared-zone move survives reload');
    console.log('PASS room and shared-zone reflow: checked group offsets → explicit apply → complete product binding → reload');
    await containerPage.locator('#productSourcing summary').click();
    await containerPage.locator('#productSourcePin').fill('fixture-pin');
    await containerPage.locator('#approvedProductPanel summary').click();
    await containerPage.locator('#loadApprovedProducts').click();
    await containerPage.waitForFunction(() => document.querySelector('#approvedProductStatus')?.textContent.includes('4 products loaded'));
    await containerPage.evaluate(() => {
      P=fresh('Fictional coordinated reflow',16000,9000);P.site.confirmed=true;
      P.objects.push({id:'entry',type:'door',x:0,y:4500},{id:'exit',type:'exit',x:16000,y:4500},
        {id:'main-corridor',type:'corridor',kind:'main',x:2000,y:4800,x2:5000,y2:6000},
        {id:'dining-zone',type:'zone',kind:'dining',x:2000,y:2000,x2:5000,y2:4800},
        {id:'waiting',type:'room',kind:'waiting',x:8000,y:2000,x2:11200,y2:5000,
          door:{side:'south',width:900},furnitureShift:{dx:250,dy:0}});
      const dining=makeFurniture('dining4',3750,3400);dining.id='dining-set';dining.zoneId='dining-zone';
      P.furniture=[dining];save();
    });
    const combined=await containerPage.evaluate(() => allDisplayFurniture(P.furniture).map(item=>({id:item.id,kind:item.kind})));
    assert.equal(combined.length,7);
    for (const item of combined) {
      const role={diningTable:'dining-table',diningChair:'dining-chair',sofa:'sofa',sideTable:'side-table'}[item.kind];
      await containerPage.locator(`[data-approved-instance="${item.id}"]`)
        .selectOption(containerFixture.candidates.find(candidate=>candidate.role===role).candidateId);
    }
    await containerPage.locator('#bindApprovedProducts').click();
    await containerPage.locator('#approvedFitAlternatives [data-container-pair]').first().waitFor();
    assert.equal(await containerPage.locator('#approvedFitAlternatives [data-container-move]').count(),0,
      'neither area alone resolves both failures');
    await containerPage.locator('#approvedFitAlternatives [data-container-pair]').first().click();
    assert.deepEqual(await containerPage.evaluate(() => ({room:P.objects.find(item=>item.id==='waiting').furnitureShift.dx,
      zone:P.furniture.find(item=>item.id==='dining-set').x,bindings:P.productBindings.length})),
      {room:0,zone:3500,bindings:0});
    await containerPage.locator('#bindApprovedProducts').click();
    await containerPage.waitForFunction(() => document.querySelector('#approvedProductStatus')?.textContent.includes('7 product instances reviewed and bound'));
    await containerPage.reload();
    assert.deepEqual(await containerPage.evaluate(() => ({room:P.objects.find(item=>item.id==='waiting').furnitureShift.dx,
      zone:P.furniture.find(item=>item.id==='dining-set').x,bindings:P.productBindings.length})),
      {room:0,zone:3500,bindings:7});
    console.log('PASS coordinated reflow: two independently invalid areas → jointly checked move → explicit apply → 7 bound items → reload');
    await containerContext.close();
    const approvedFixture = loadTrustedCatalog({ sources: [{
      id: 'fictional-reviewed', ref: 'fixture:fictional-reviewed-home.csv', observedAt: '2026-10-15T00:00:00.000Z',
      trustSpecs: true, trustPrice: true, trustAvailability: true, trustUseSpec: true,
      useReviewedBy: 'fixture-reviewer', useReviewedAt: '2026-10-15T01:00:00.000Z',
      products: [
        { category: 'wardrobe', sku: 'W-1600', name: 'Wardrobe', widthMm: 1600, depthMm: 600, heightMm: 2200,
          priceAmount: 900, currency: 'USD', availability: 'in_stock', leadDays: 14, purchaseUnit: 'single', doorMechanism: 'hinged', frontClearanceMm: 800 },
        { category: 'bed', sku: 'B-1800', name: 'Bed', widthMm: 1800, depthMm: 2100, heightMm: 1000,
          priceAmount: 1200, currency: 'USD', availability: 'in_stock', leadDays: 14, purchaseUnit: 'single',
          leftClearanceMm: 600, rightClearanceMm: 600, footClearanceMm: 600 },
      ],
    }] });
    const homeContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const homePage = await homeContext.newPage();
    await homePage.route('**/api/trusted-products', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(approvedFixture) }));
    await homePage.goto(url);
    await homePage.waitForFunction(() => !document.querySelector('#designBom')?.textContent.includes('Preparing design needs'));
    await homePage.evaluate(() => {
      P = fresh('Reviewed home fixture', 10000, 8000);
      P.site.confirmed = true;
      P.objects.push({ id: 'entrance', type: 'door', x: 0, y: 4000 }, { id: 'exit', type: 'exit', x: 10000, y: 4000 });
      P.furniture = [makeFurniture('wardrobe', 3000, 1800), makeFurniture('bed', 7000, 5800)];
      P.furniture[0].id = 'wardrobe-1'; P.furniture[1].id = 'bed-1';
      save();
      document.querySelector('#welcomeModal').hidden = true;
    });
    await homePage.locator('#productSourcing summary').click();
    await homePage.locator('#productSourcePin').fill('fixture-pin');
    await homePage.locator('#approvedProductPanel summary').click();
    await homePage.locator('#loadApprovedProducts').click();
    await homePage.waitForFunction(() => document.querySelector('#approvedProductStatus')?.textContent.includes('2 products loaded'));
    await homePage.locator('[data-approved-instance="wardrobe-1"]').selectOption(approvedFixture.candidates[0].candidateId);
    await homePage.locator('[data-approved-instance="bed-1"]').selectOption(approvedFixture.candidates[1].candidateId);
    await homePage.locator('#bindApprovedProducts').click();
    await homePage.waitForFunction(() => !document.querySelector('#approvedProductStatus')?.textContent.includes('Reviewing the full scene'));
    assert.match(await homePage.locator('#approvedProductStatus').innerText(), /2 product instances reviewed and bound/);
    await homePage.waitForFunction(() => document.querySelector('#approvedDraft')?.textContent.includes('Merchandise subtotal: USD 2100'));
    assert.equal(await homePage.evaluate(() => P.productBindings.length), 2);
    assert.equal(await homePage.evaluate(() => P.furniture.some(item => item.sku?.startsWith('DEMO-'))), false);
    assert.match(await homePage.locator('#approvedDraft').innerText(), /Formal quote: not issued/);
    await homePage.evaluate(() => { P.furniture[0].x += 500; save(); });
    await homePage.waitForFunction(() => document.querySelector('#approvedDraft')?.textContent.includes('0/2 reviewed product instances current'));
    assert.doesNotMatch(await homePage.locator('#approvedDraft').innerText(), /Merchandise subtotal:/);
    await homePage.reload();
    assert.equal(await homePage.evaluate(() => P.productBindings.length), 2, 'bindings survive project reload');
    await homePage.locator('#productSourcing summary').click();
    await homePage.locator('#productSourcePin').fill('fixture-pin');
    await homePage.locator('#approvedProductPanel summary').click();
    await homePage.locator('#loadApprovedProducts').click();
    await homePage.waitForFunction(() => document.querySelector('#approvedDraft')?.textContent.includes('0/2 reviewed product instances current'));
    console.log('PASS reviewed home products: approved catalog → full-scene bind → procurement draft → stale after layout edit');
    await homeContext.close();
    const officeFixture = loadTrustedCatalog({ sources: [{
      id: 'fictional-office', ref: 'fixture:fictional-office', observedAt: '2026-10-16T00:00:00.000Z',
      trustSpecs: true, trustPrice: true, trustAvailability: true, trustUseSpec: true,
      useReviewedBy: 'fixture-reviewer', useReviewedAt: '2026-10-16T01:00:00.000Z',
      products: [
        { role: 'workstation', supplierSku: 'D-1', widthMm: 1400, depthMm: 700, heightMm: 750,
          useZones: [{ purpose: 'chair seat', x: -300, y: 350, w: 600, h: 800 }] },
        { role: 'task-chair', supplierSku: 'C-1', widthMm: 600, depthMm: 600, heightMm: 1000,
          useZones: [{ purpose: 'pullback', x: -300, y: 300, w: 600, h: 500 }] },
        { role: 'phone-booth', supplierSku: 'P-1', widthMm: 1200, depthMm: 1200, heightMm: 2300,
          useZones: [{ purpose: 'door approach', x: -450, y: 600, w: 900, h: 800 }] },
        { role: 'storage-cabinet', supplierSku: 'S-1', widthMm: 900, depthMm: 450, heightMm: 1100,
          useZones: [{ purpose: 'drawer access', x: -450, y: 225, w: 900, h: 600 }] },
      ].map(row => ({ ...row, priceAmount: 100, currency: 'USD', availability: 'in_stock', leadDays: 7, purchaseUnit: 'single' })),
    }] });
    const officeContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const officePage = await officeContext.newPage();
    await officePage.route('**/api/trusted-products', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(officeFixture) }));
    await officePage.goto(url);
    await officePage.waitForFunction(() => !document.querySelector('#designBom')?.textContent.includes('Preparing design needs'));
    await officePage.evaluate(() => {
      P = fresh('Fictional office fixture', 12000, 9000);
      P.site.confirmed = true;
      P.objects.push({ id: 'entrance', type: 'door', x: 0, y: 4500 }, { id: 'exit', type: 'exit', x: 12000, y: 4500 });
      P.furniture = [makeFurniture('desk', 3000, 3000), makeFurniture('phone', 7000, 2500), makeFurniture('cabinet', 7000, 5500)];
      P.furniture[0].id = 'desk-1'; P.furniture[1].id = 'phone-1'; P.furniture[2].id = 'cabinet-1';
      save(); document.querySelector('#welcomeModal').hidden = true;
    });
    await officePage.locator('#productSourcing summary').click();
    await officePage.locator('#productSourcePin').fill('fixture-pin');
    await officePage.locator('#approvedProductPanel summary').click();
    await officePage.locator('#loadApprovedProducts').click();
    await officePage.waitForFunction(() => document.querySelector('#approvedProductStatus')?.textContent.includes('4 products loaded'));
    for (const [instanceId, candidate] of [['desk-1', officeFixture.candidates[0]], ['desk-1-chair-0', officeFixture.candidates[1]],
      ['phone-1', officeFixture.candidates[2]], ['cabinet-1', officeFixture.candidates[3]]]) {
      await officePage.locator(`[data-approved-instance="${instanceId}"]`).selectOption(candidate.candidateId);
    }
    await officePage.locator('#bindApprovedProducts').click();
    await officePage.waitForFunction(() => document.querySelector('#approvedProductStatus')?.textContent.includes('4 product instances reviewed and bound'));
    await officePage.waitForFunction(() => document.querySelector('#approvedDraft')?.textContent.includes('Merchandise subtotal: USD 400'));
    assert.equal(await officePage.evaluate(() => P.productBindings.length), 4);
    assert.equal(await officePage.evaluate(() => P.derivedProducts['desk-1-chair-0']?.productCandidateId), officeFixture.candidates[1].candidateId);
    const officeDownload = officePage.waitForEvent('download');
    await officePage.locator('#exportReviewSnapshot').click();
    const officeReview = JSON.parse(await readFile(await (await officeDownload).path(), 'utf8'));
    assert.equal(officeReview.layout.displayFurniture.length, 4);
    assert.equal(officeReview.layout.displayFurniture.find(item => item.id === 'desk-1-chair-0').productCandidateId, officeFixture.candidates[1].candidateId);
    assert.equal(officeReview.procurement.itemCount, 4);
    await officePage.reload();
    await officePage.locator('#productSourcing summary').click();
    await officePage.locator('#productSourcePin').fill('fixture-pin');
    await officePage.locator('#approvedProductPanel summary').click();
    await officePage.locator('#loadApprovedProducts').click();
    await officePage.waitForFunction(() => document.querySelector('#approvedDraft')?.textContent.includes('Merchandise subtotal: USD 400'));
    await officePage.evaluate(() => { P.furniture.find(item => item.id === 'desk-1').x += 200; save(); });
    await officePage.waitForFunction(() => document.querySelector('#approvedDraft')?.textContent.includes('0/4 reviewed product instances current'));
    assert.doesNotMatch(await officePage.locator('#approvedDraft').innerText(), /Merchandise subtotal:/);
    console.log('PASS fictional office products: generated task chair has its own binding → reload → layout edit invalidates all');
    await officeContext.close();
    const setFixture = loadTrustedCatalog({ sources: [{
      id: 'fictional-set', ref: 'fixture:fictional-set', observedAt: '2026-10-16T00:00:00.000Z',
      trustSpecs: true, trustPrice: true, trustAvailability: true, trustUseSpec: true, trustSets: true,
      useReviewedBy: 'fixture-reviewer', useReviewedAt: '2026-10-16T01:00:00.000Z',
      setsReviewedBy: 'fixture-reviewer', setsReviewedAt: '2026-10-16T01:00:00.000Z',
      products: [
        { category: 'table', supplierSku: 'T-1', widthMm: 1800, depthMm: 800, heightMm: 750,
          useZones: [{ purpose: 'seating', x: -900, y: 400, w: 1800, h: 1000 }],
          priceAmount: 400, currency: 'USD', availability: 'in_stock', leadDays: 7, purchaseUnit: 'single' },
        { category: 'chair', supplierSku: 'C-1', widthMm: 500, depthMm: 550, heightMm: 850,
          useZones: [{ purpose: 'pullback', x: -250, y: 275, w: 500, h: 600 }],
          priceAmount: 150, currency: 'USD', availability: 'in_stock', leadDays: 7, purchaseUnit: 'single' },
      ],
      sets: [{ supplierSku: 'T-C-SET', priceAmount: 550, currency: 'USD', availability: 'in_stock', leadDays: 7,
        components: [{ supplierSku: 'T-1', quantity: 1 }, { supplierSku: 'C-1', quantity: 2 }] }],
    }] });
    const setContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const setPage = await setContext.newPage();
    await setPage.route('**/api/trusted-products', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(setFixture) }));
    await setPage.goto(url);
    await setPage.waitForFunction(() => !document.querySelector('#designBom')?.textContent.includes('Preparing design needs'));
    await setPage.evaluate(() => {
      P = fresh('Fictional set fixture', 12000, 8000);
      P.site.confirmed = true;
      P.objects.push({ id: 'entrance', type: 'door', x: 0, y: 4000 }, { id: 'exit', type: 'exit', x: 12000, y: 4000 });
      P.furniture = [makeFurniture('table', 4000, 3000), makeFurniture('homeChair', 3500, 4100), makeFurniture('homeChair', 4500, 4100)];
      P.furniture[0].id = 'table-1'; P.furniture[1].id = 'chair-1'; P.furniture[2].id = 'chair-2';
      P.furniture[1].linkedTo = 'table-1'; P.furniture[2].linkedTo = 'table-1';
      save(); document.querySelector('#welcomeModal').hidden = true;
    });
    await setPage.locator('#productSourcing summary').click();
    await setPage.locator('#productSourcePin').fill('fixture-pin');
    await setPage.locator('#approvedProductPanel summary').click();
    await setPage.locator('#loadApprovedProducts').click();
    await setPage.waitForFunction(() => document.querySelector('#approvedProductStatus')?.textContent.includes('2 products loaded'));
    await setPage.locator('[data-approved-instance="table-1"]').selectOption(setFixture.candidates[0].candidateId);
    await setPage.locator('[data-approved-instance="chair-1"]').selectOption(setFixture.candidates[1].candidateId);
    await setPage.locator('[data-approved-instance="chair-2"]').selectOption(setFixture.candidates[1].candidateId);
    await setPage.locator('#bindApprovedProducts').click();
    await setPage.waitForFunction(() => document.querySelector('#approvedProductStatus')?.textContent.includes('3 product instances reviewed and bound'));
    await setPage.waitForFunction(() => document.querySelector('#approvedDraft')?.textContent.includes('Merchandise subtotal: USD 700'));
    await setPage.locator('[data-set-anchor="table-1"]').selectOption(setFixture.setOffers[0].offerId);
    await setPage.waitForFunction(() => document.querySelector('#approvedDraft')?.textContent.includes('Merchandise subtotal: USD 550'));
    assert.match(await setPage.locator('#approvedDraft').innerText(), /T-1 × 1, C-1 × 2/);
    assert.equal(await setPage.evaluate(() => P.setSelections.length), 1);
    await setPage.reload();
    await setPage.locator('#productSourcing summary').click();
    await setPage.locator('#productSourcePin').fill('fixture-pin');
    await setPage.locator('#approvedProductPanel summary').click();
    await setPage.locator('#loadApprovedProducts').click();
    await setPage.waitForFunction(() => document.querySelector('#approvedDraft')?.textContent.includes('Merchandise subtotal: USD 550'));
    const firstDownload = setPage.waitForEvent('download');
    await setPage.locator('#exportReviewSnapshot').click();
    const oldReview = JSON.parse(await readFile(await (await firstDownload).path(), 'utf8'));
    assert.equal(oldReview.kind, 'product_review_snapshot');
    assert.equal(oldReview.documentStatus, 'review_only_not_quote_or_order');
    assert.equal(oldReview.procurement.merchandiseSubtotal.amount, '550');
    assert.equal(oldReview.procurement.purchaseLines[0].components.length, 2);
    assert.equal(oldReview.productEvidence.offers[0].supplierSku, 'T-C-SET');
    await setPage.evaluate(() => { P.furniture = P.furniture.filter(item => item.id !== 'chair-2'); save(); });
    await setPage.waitForFunction(() => document.querySelector('#approvedDraft')?.textContent.includes('set_members_missing'));
    assert.doesNotMatch(await setPage.locator('#approvedDraft').innerText(), /Merchandise subtotal:/);
    const nextDownload = setPage.waitForEvent('download');
    await setPage.locator('#exportReviewSnapshot').click();
    const newReview = JSON.parse(await readFile(await (await nextDownload).path(), 'utf8'));
    assert.equal(newReview.procurement.merchandiseSubtotal, null);
    assert.ok(newReview.procurement.pending.some(item => item.reasons.includes('set_members_missing')));
    assert.notEqual(newReview.layout.revision, oldReview.layout.revision);
    assert.equal(oldReview.procurement.merchandiseSubtotal.amount, '550', 'old exported review remains unchanged');
    console.log('PASS fictional supplier set: linked components → set price → reload → deleted member pending');
    await setContext.close();
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
