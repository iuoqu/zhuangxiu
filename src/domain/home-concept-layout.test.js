import test from 'node:test';
import assert from 'node:assert/strict';
import { createHomeProject, assessHomePackage } from './home-packages.js';
import { mockProductsForPackage } from './home-mock-catalog.js';
import { buildHomeConceptLayout } from './home-concept-layout.js';

test('loft preview places only dimensioned-zone furniture and keeps fit unassessed', () => {
  const project = createHomeProject('starter', 'loft1b1b');
  project.products = mockProductsForPackage('starter');
  const site = { source: { kind: 'image' }, zones: [
    { id: 'living', kind: 'living', dimensionsMm: { width: 3658, depth: 3912 } },
    { id: 'dining', kind: 'dining' },
    { id: 'bedroom', kind: 'bedroom', dimensionsMm: { width: 3353, depth: 4267 } },
    { id: 'void', kind: 'void', dimensionsMm: { width: 3302, depth: 3353 } },
  ] };
  const result = buildHomeConceptLayout(assessHomePackage(project).lines, site);
  assert.equal(result.fitStatus, 'not_checked');
  assert.equal(result.placedCount, 7);
  assert.equal(result.pendingCount, 3);
  assert.equal(result.pairedMattresses, 1);
  assert.ok(result.issues.every(issue => issue.reason.includes('房间缺图示长宽')));
  assert.ok(result.placements.every(item => ['living', 'bedroom'].includes(item.zoneId)));
  const find = key => result.placements.find(item => item.key === key);
  assert.ok(find('tv_console').yMm < find('coffee_table').yMm);
  assert.ok(find('coffee_table').yMm < find('sofa_3').yMm);
  const nightstands = result.placements.filter(item => item.key === 'nightstand');
  assert.ok(nightstands[0].xMm < find('queen_bed_frame').xMm);
  assert.ok(nightstands[1].xMm > find('queen_bed_frame').xMm + find('queen_bed_frame').widthMm);
  for (const a of result.placements) for (const b of result.placements) {
    if (a === b || a.zoneId !== b.zoneId) continue;
    assert.ok(a.xMm + a.widthMm <= b.xMm || b.xMm + b.widthMm <= a.xMm ||
      a.yMm + a.depthMm <= b.yMm || b.yMm + b.depthMm <= a.yMm);
  }
});

test('preview requires an image plan and explicit product dimensions', () => {
  const project = createHomeProject('starter', 'studio');
  project.products = mockProductsForPackage('starter');
  const lines = assessHomePackage(project).lines;
  assert.equal(buildHomeConceptLayout(lines, null).fitStatus, 'not_checked');
  assert.equal(buildHomeConceptLayout(lines, null).placements.length, 0);
  project.products.sofa_3.dimensionsMm = null;
  const result = buildHomeConceptLayout(assessHomePackage(project).lines, { source: { kind: 'image' }, zones: [
    { id: 'living', kind: 'living', dimensionsMm: { width: 4000, depth: 4000 } },
  ] });
  assert.ok(result.issues.some(issue => issue.label === '三人沙发' && issue.reason === '商品缺外廓尺寸'));
});

test('explicit room assignment can move a SKU to the mezzanine', () => {
  const project = createHomeProject('starter', 'loft1b1b');
  project.products = mockProductsForPackage('starter');
  const site = { source: { kind: 'image' }, zones: [
    { id: 'living', kind: 'living', dimensionsMm: { width: 3658, depth: 3912 } },
    { id: 'bedroom', kind: 'bedroom', dimensionsMm: { width: 3353, depth: 4267 } },
    { id: 'dining', kind: 'dining' },
    { id: 'mezzanine', kind: 'mezzanine', dimensionsMm: { width: 3302, depth: 3353 } },
  ] };
  const result = buildHomeConceptLayout(assessHomePackage(project).lines, site, { 'sofa_3:0': 'mezzanine' });
  assert.equal(result.placements.find(item => item.key === 'sofa_3')?.zoneId, 'mezzanine');
  assert.equal(result.fitStatus, 'not_checked');
});

test('manual position changes one furniture instance without moving automatic neighbors', () => {
  const project = createHomeProject('starter', 'studio');
  project.products = mockProductsForPackage('starter');
  const site = { source: { kind: 'image' }, zones: [
    { id: 'living', kind: 'living', dimensionsMm: { width: 4000, depth: 3900 } },
  ] };
  const lines = assessHomePackage(project).lines;
  const before = buildHomeConceptLayout(lines, site);
  const sofa = before.placements.find(item => item.instanceId === 'sofa_3-1');
  const table = before.placements.find(item => item.instanceId === 'coffee_table-1');
  const moved = buildHomeConceptLayout(lines, site, {}, { 'sofa_3-1': {
    zoneId: 'living', xRatio: table.xMm / (4000 - sofa.widthMm),
    yRatio: table.yMm / (3900 - sofa.depthMm),
  } });
  assert.notEqual(moved.placements.find(item => item.instanceId === 'sofa_3-1').yMm, sofa.yMm);
  assert.deepEqual(moved.placements.find(item => item.instanceId === 'coffee_table-1'), table);
  assert.equal(moved.placements.find(item => item.instanceId === 'sofa_3-1').manuallyPositioned, true);
  assert.equal(buildHomeConceptLayout(lines, site, {}, { 'sofa_3-1': {
    zoneId: 'living', xRatio: 2, yRatio: 0 } }).placements.find(item => item.instanceId === 'sofa_3-1').yMm,
  sofa.yMm);
});
