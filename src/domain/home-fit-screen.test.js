import test from 'node:test';
import assert from 'node:assert/strict';
import { createHomeProject, assessHomePackage } from './home-packages.js';
import { mockProductsForPackage } from './home-mock-catalog.js';
import { buildHomeConceptLayout } from './home-concept-layout.js';
import { screenHomeFurnitureFit } from './home-fit-screen.js';

function fixture() {
  const project = createHomeProject('starter', '1b1b');
  project.products = mockProductsForPackage('starter');
  const site = { source: { kind: 'image', fileName: 'plan.jpg' }, zones: [
    { id: 'living', kind: 'living', dimensionsMm: { width: 4000, depth: 3900 }, dimensionSource: 'manual' },
    { id: 'dining', kind: 'dining', dimensionsMm: { width: 3000, depth: 2800 }, dimensionSource: 'manual' },
    { id: 'bedroom', kind: 'bedroom', dimensionsMm: { width: 3800, depth: 4300 }, dimensionSource: 'manual' },
  ] };
  return { project, site };
}

test('clear rectangular screen stays explicitly unverified with simulated products', () => {
  const { project, site } = fixture();
  const result = screenHomeFurnitureFit(assessHomePackage(project).lines, site);
  assert.equal(result.screenStatus, 'outline_clear');
  assert.equal(result.fitStatus, 'not_checked');
  assert.equal(result.conflictCount, 0);
  assert.equal(result.pendingCount, 0);
  assert.equal(result.checkedCount, 11);
  assert.equal(result.evidence.simulatedProductCount, 9);
  assert.ok(result.unchecked.includes('通行与家具使用净空'));
});

test('missing dining measurements and unsized furniture remain pending', () => {
  const { project, site } = fixture();
  delete site.zones[1].dimensionsMm;
  project.products.sofa_3.dimensionsMm = null;
  const result = screenHomeFurnitureFit(assessHomePackage(project).lines, site);
  assert.equal(result.screenStatus, 'incomplete');
  assert.equal(result.fitStatus, 'not_checked');
  assert.ok(result.findings.some(item => item.code === 'room_size_missing' && item.label.startsWith('餐椅')));
  assert.ok(result.findings.some(item => item.code === 'product_size_missing' && item.label === '三人沙发'));
});

test('an outline larger than both room orientations is a size conflict, not a certified failure', () => {
  const { project, site } = fixture();
  site.zones[0].dimensionsMm = { width: 1200, depth: 1200 };
  const result = screenHomeFurnitureFit(assessHomePackage(project).lines, site);
  assert.equal(result.screenStatus, 'conflict');
  assert.equal(result.fitStatus, 'not_checked');
  assert.ok(result.findings.some(item => item.code === 'outline_exceeds_room' && item.label === '三人沙发'));
});

test('a 90-degree option is a pending action because the concept preview does not rotate', () => {
  const { project, site } = fixture();
  site.zones[0].dimensionsMm = { width: 1000, depth: 2400 };
  const result = screenHomeFurnitureFit(assessHomePackage(project).lines, site);
  assert.ok(result.findings.some(item => item.code === 'rotation_needed' && item.label === '三人沙发'));
  assert.ok(!result.findings.some(item => item.code === 'outline_exceeds_room' && item.label === '三人沙发'));
});

test('mattress mismatch and overlapping draft placements are reported', () => {
  const { project, site } = fixture();
  project.products.queen_mattress.dimensionsMm = { width: 3000, depth: 3000, height: 250 };
  const lines = assessHomePackage(project).lines;
  const layout = buildHomeConceptLayout(lines, site);
  const first = layout.placements[0], second = layout.placements[1];
  second.xMm = first.xMm; second.yMm = first.yMm;
  const result = screenHomeFurnitureFit(lines, site, {}, layout);
  assert.equal(result.screenStatus, 'conflict');
  assert.ok(result.findings.some(item => item.code === 'bed_pair_mismatch'));
  assert.ok(result.findings.some(item => item.code === 'furniture_overlap'));
});
