import test from 'node:test';
import assert from 'node:assert/strict';
import { createHomeProject, assessHomePackage } from './home-packages.js';
import { mockProductsForPackage } from './home-mock-catalog.js';
import { buildHomeConceptLayout } from './home-concept-layout.js';
import { screenHomeFurnitureFit } from './home-fit-screen.js';
import { assessHomeReviewGate } from './home-review-gate.js';

const makeFixture = () => {
  const project = createHomeProject('starter', 'studio');
  project.products = mockProductsForPackage('starter');
  const site = { source: { kind: 'image', fileName: 'customer.png', dataUrl: 'data:image/png;base64,AA',
    widthPx: 800, heightPx: 600 }, zones: [
    { id: 'living', kind: 'living', x: 40, y: 40, w: 300, h: 220,
      dimensionsMm: { width: 4000, depth: 3900 } },
    { id: 'dining', kind: 'dining', x: 40, y: 300, w: 300, h: 220,
      dimensionsMm: { width: 3400, depth: 3000 } },
    { id: 'bedroom', kind: 'bedroom', x: 380, y: 40, w: 340, h: 300,
      dimensionsMm: { width: 3800, depth: 4300 } },
  ] };
  const assess = () => {
    const assessment = assessHomePackage(project);
    const layout = buildHomeConceptLayout(assessment.lines, site, {}, project.placementOverrides);
    const fit = screenHomeFurnitureFit(assessment.lines, site, {}, layout);
    return assessHomeReviewGate(project, assessment, site, layout, fit);
  };
  return { project, site, assess };
};

test('review gate distinguishes a local position mark from delivery approval and invalidates stale marks', () => {
  const { project, site, assess } = makeFixture();
  const first = assess();
  assert.equal(first.canDeliver, false);
  assert.equal(first.status, 'draft_only');
  assert.ok(first.blockers.some(reason => reason.includes('模拟 SKU')));
  assert.ok(first.blockers.some(reason => reason.includes('正式交付批准流程')));
  const sofa = first.rows.find(row => row.instanceId === 'sofa_3-1');
  assert.equal(sofa.status, 'pending_review');
  project.placementReviews = { [sofa.instanceId]: { fingerprint: sofa.fingerprint } };
  assert.equal(assess().rows.find(row => row.instanceId === sofa.instanceId).status, 'position_reviewed');
  site.zones[0].x += 1;
  assert.equal(assess().rows.find(row => row.instanceId === sofa.instanceId).status, 'pending_review');
  site.zones[0].x -= 1;
  project.products.sofa_3 = { ...project.products.sofa_3,
    dimensionsMm: { ...project.products.sofa_3.dimensionsMm,
      width: project.products.sofa_3.dimensionsMm.width + 10 } };
  assert.equal(assess().rows.find(row => row.instanceId === sofa.instanceId).status, 'pending_review');
});

test('missing dimensions and furniture overlap remain blockers, never reviewed', () => {
  const { project, site, assess } = makeFixture();
  site.zones[1].visualSizeMm = site.zones[1].dimensionsMm;
  delete site.zones[1].dimensionsMm;
  const missing = assess();
  assert.equal(missing.rows.find(row => row.instanceId === 'dining_table_2_4-1').status, 'missing_size');
  assert.ok(missing.blockers.some(reason => reason.includes('缺可核对')));
  site.zones[1].dimensionsMm = site.zones[1].visualSizeMm;
  const baseline = assess();
  const table = baseline.rows.find(row => row.instanceId === 'coffee_table-1');
  assert.ok(table.fingerprint);
  const assessment = assessHomePackage(project);
  const layout = buildHomeConceptLayout(assessment.lines, site);
  const sofa = layout.placements.find(item => item.instanceId === 'sofa_3-1');
  const coffee = layout.placements.find(item => item.instanceId === 'coffee_table-1');
  project.placementOverrides = { 'sofa_3-1': { zoneId: 'living',
    xRatio: coffee.xMm / (4000 - sofa.widthMm), yRatio: coffee.yMm / (3900 - sofa.depthMm) } };
  const conflict = assess();
  assert.equal(conflict.rows.find(row => row.instanceId === 'sofa_3-1').status, 'conflict');
  assert.ok(conflict.blockers.some(reason => reason.includes('占位冲突')));
  assert.equal(conflict.canDeliver, false);
});
