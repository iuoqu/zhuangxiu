import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateHomePlanZones } from './home-plan-eval.js';

const reference = { source: { widthPx: 1000, heightPx: 800 }, zones: [
  { id: 'living', kind: 'living', x: 100, y: 100, w: 300, h: 300,
    dimensionsMm: { width: 4000, depth: 3900 } },
  { id: 'stairs', kind: 'stairs', x: 500, y: 100, w: 200, h: 300 },
] };

test('one-to-one region scoring tolerates image resizing and swapped printed pairs', () => {
  const candidate = [
    { kind: 'living', x: 50, y: 50, w: 150, h: 150,
      dimensionsMm: { width: 3900, depth: 4000 } },
    { kind: 'stairs', x: 250, y: 50, w: 100, h: 150 },
  ];
  const result = evaluateHomePlanZones(reference, candidate, { widthPx: 500, heightPx: 400 });
  assert.equal(result.samplePass, true);
  assert.equal(result.releaseReady, false);
  assert.equal(result.metrics.meanIoU, 1);
  assert.equal(result.metrics.printedSizeCorrect, 1);
  assert.equal(result.matches[0].printedSize, 'swapped');
});

test('wrong kind, invented size and duplicate room cannot masquerade as complete detection', () => {
  const candidate = [
    { kind: 'bedroom', x: 100, y: 100, w: 300, h: 300,
      dimensionsMm: { width: 4000, depth: 3900 } },
    { kind: 'stairs', x: 500, y: 100, w: 200, h: 300,
      dimensionsMm: { width: 2500, depth: 3000 } },
    { kind: 'stairs', x: 500, y: 100, w: 200, h: 300 },
  ];
  const result = evaluateHomePlanZones(reference, candidate);
  assert.equal(result.samplePass, false);
  assert.equal(result.metrics.placeableRecall, 0);
  assert.equal(result.metrics.fixedRecall, 1);
  assert.equal(result.missed[0].referenceId, 'living');
  assert.equal(result.unexpected.length, 2);
  assert.equal(result.metrics.unsupportedSizeCount, 2);
});

test('shifted box and omitted printed dimension fail the sample gate', () => {
  const candidate = [
    { kind: 'living', x: 300, y: 300, w: 300, h: 300 },
    { kind: 'stairs', x: 500, y: 100, w: 200, h: 300 },
  ];
  const result = evaluateHomePlanZones(reference, candidate);
  assert.equal(result.samplePass, false);
  assert.equal(result.metrics.recall, 0.5);
  assert.equal(result.metrics.printedSizeCorrect, 0);
  assert.equal(result.missed[0].kind, 'living');
});
