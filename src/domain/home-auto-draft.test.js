import test from 'node:test';
import assert from 'node:assert/strict';
import { createHomeAutoDraft, fillMissingHomeVisualSizes } from './home-auto-draft.js';
import { createHomeProject, assessHomePackage } from './home-packages.js';
import { mockProductsForPackage } from './home-mock-catalog.js';
import { buildHomeConceptLayout } from './home-concept-layout.js';
import { screenHomeFurnitureFit } from './home-fit-screen.js';

const source = { kind: 'image', fileName: 'customer.jpg', widthPx: 1280, heightPx: 875 };

test('automatic plan draft keeps printed text unreviewed and never invents a measured dining size', () => {
  const draft = createHomeAutoDraft([
    { kind: 'living', x: 100, y: 100, w: 300, h: 270,
      evidence: '12′0″ × 12′10″', dimensionsMm: { width: 3658, depth: 3912 } },
    { kind: 'dining', x: 100, y: 400, w: 280, h: 180, evidence: '', dimensionsMm: null },
    { kind: 'bedroom', x: 450, y: 100, w: 300, h: 280,
      evidence: '11′0″ × 14′0″', dimensionsMm: { width: 3353, depth: 4267 } },
    { kind: 'void', x: 800, y: 100, w: 180, h: 250, evidence: '', dimensionsMm: null },
    { kind: 'stairs', x: 820, y: 450, w: 160, h: 180, evidence: '', dimensionsMm: null },
  ], source, 42);
  assert.equal(draft.placeableCount, 3);
  assert.equal(draft.visualOnlyCount, 1);
  assert.equal(draft.printedDraftCount, 2);
  assert.equal(draft.zones[0].reviewStatus, 'draft');
  assert.equal(draft.zones[0].dimensionSource, 'ai_draft_printed');
  assert.equal(draft.zones[1].dimensionsMm, undefined);
  assert.ok(draft.zones[1].visualSizeMm.width > 1000);
  assert.equal(draft.zones[3].visualSizeMm, undefined);
  assert.equal(draft.zones[4].visualSizeMm, undefined);
  const project = createHomeProject('starter', '1b1b');
  project.products = mockProductsForPackage('starter');
  const site = { source, zones: draft.zones };
  const lines = assessHomePackage(project).lines;
  assert.equal(buildHomeConceptLayout(lines, site).placedCount, 0,
    'unreviewed AI boxes cannot automatically receive furniture');
  site.zones.forEach(zone => { zone.reviewStatus = 'reviewed'; });
  const preview = buildHomeConceptLayout(lines, site);
  assert.ok(preview.placements.some(item => item.zoneId === 'auto-42-1'), 'dining furniture appears visually');
  assert.ok(preview.placements.every(item => !['auto-42-3', 'auto-42-4'].includes(item.zoneId)));
  assert.ok(preview.visualOnlyCount > 0);
  const screen = screenHomeFurnitureFit(lines, site, {}, preview);
  assert.equal(screen.screenStatus, 'incomplete');
  assert.equal(screen.fitStatus, 'not_checked');
  assert.ok(screen.findings.some(item => item.code === 'room_size_missing' && item.zoneId === 'auto-42-1'));
  assert.ok(screen.findings.some(item => item.code === 'room_size_missing'));
});

test('without printed dimensions, draft uses drawing units only and keeps unknown spaces nonplaceable', () => {
  const result = createHomeAutoDraft([
    { kind: 'living', x: 40, y: 50, w: 170, h: 150, dimensionsMm: null },
    { kind: 'bedroom', x: 1250, y: 50, w: 100, h: 120 },
    { kind: 'unknown', x: 10, y: 10, w: 100, h: 100 },
  ], source, 8);
  assert.equal(result.zones.length, 2);
  assert.equal(result.placeableCount, 1);
  assert.equal(result.zones[1].kind, 'unknown');
  assert.equal(result.zones[1].visualSizeMm, undefined);
  assert.equal(result.zones[0].dimensionsMm, undefined);
  assert.equal(result.zones[0].reviewStatus, 'draft');
  assert.ok(result.zones[0].visualSizeMm.width >= 4000);
  assert.throws(() => createHomeAutoDraft([], { kind: 'pdf' }));
});

test('a corrected dining box without printed size gets a visual-only scale from measured rooms', () => {
  const site = { source, zones: [
    { id: 'living', kind: 'living', x: 150, y: 190, w: 232, h: 252,
      dimensionsMm: { width: 3658, depth: 3912 } },
    { id: 'bedroom', kind: 'bedroom', x: 395, y: 185, w: 208, h: 258,
      dimensionsMm: { width: 3353, depth: 4267 } },
    { id: 'dining', kind: 'dining', x: 150, y: 632, w: 231, h: 118 },
  ] };
  assert.equal(fillMissingHomeVisualSizes(site), 1);
  assert.equal(fillMissingHomeVisualSizes(site), 0, 'a rerender keeps the same drawing size');
  assert.equal(site.zones[2].dimensionsMm, undefined);
  assert.equal(site.zones[2].reviewStatus, undefined, 'a visual scale is not an AI room review status');
  assert.ok(site.zones[2].visualSizeMm.width > 3500 && site.zones[2].visualSizeMm.width < 3900);
  assert.ok(site.zones[2].visualSizeMm.depth > 1800 && site.zones[2].visualSizeMm.depth < 2100);
  const project = createHomeProject('starter', 'loft1b1b');
  project.products = mockProductsForPackage('starter');
  const lines = assessHomePackage(project).lines;
  const preview = buildHomeConceptLayout(lines, site);
  assert.equal(preview.placements.filter(item => item.zoneId === 'dining').length, 3);
  assert.ok(preview.placements.filter(item => item.zoneId === 'dining').every(item => item.visualOnly));
  assert.ok(screenHomeFurnitureFit(lines, site, {}, preview).findings.some(item =>
    item.code === 'room_size_missing' && item.zoneId === 'dining'));
});

test('no measured room means no inferred visual scale', () => {
  const site = { source, zones: [{ id: 'dining', kind: 'dining', x: 10, y: 10, w: 100, h: 80 }] };
  assert.equal(fillMissingHomeVisualSizes(site), 0);
  assert.equal(site.zones[0].visualSizeMm, undefined);
});

test('two-bedroom desk-and-chair set has a visual envelope but no verified product size', () => {
  const project = createHomeProject('comfort', '2b2b');
  project.products = mockProductsForPackage('comfort');
  const site = { source, zones: [
    { id: 'living', kind: 'living', dimensionsMm: { width: 4800, depth: 4300 } },
    { id: 'dining', kind: 'dining', dimensionsMm: { width: 4000, depth: 3500 } },
    { id: 'bed-a', kind: 'bedroom', dimensionsMm: { width: 4200, depth: 4200 } },
    { id: 'bed-b', kind: 'bedroom', dimensionsMm: { width: 4200, depth: 4200 } },
  ] };
  const lines = assessHomePackage(project).lines;
  assert.equal(lines.find(line => line.key === 'desk_chair_set').dimensionsMm, null);
  const layout = buildHomeConceptLayout(lines, site);
  assert.ok(layout.placements.some(item => item.key === 'desk_chair_set' && item.visualOnly));
  assert.ok(layout.visualOnlyCount >= 1);
  assert.ok(screenHomeFurnitureFit(lines, site, {}, layout).findings.some(item =>
    item.code === 'product_size_missing' && item.label === '书桌＋办公椅套装'));
});
