const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scoreRecognition } = require('./score-home-recognition.cjs');
const { scoreBoundaryCase, summarizeBoundaries } = require('./score-home-boundaries.cjs');

test('seven-plan reference records known counts without pretending to score wall accuracy', () => {
  const reference = require('../test-data/home-plan-golden.json');
  assert.equal(reference.cases.length, 7);
  assert.equal(new Set(reference.cases.map(item => item.file)).size, 7);
  assert.deepEqual(reference.cases.find(item => item.file === '1000276471.jpg') &&
    ['bedroomCount', 'livingCount', 'bathroomCount'].map(field =>
      reference.cases.find(item => item.file === '1000276471.jpg')[field]), [1, 1, 1]);
  const result = scoreRecognition([], reference);
  assert.equal(result.complete, false);
  assert.equal(result.boundaryAccuracy, null);
  assert.equal(result.boundaryReferenceCoverage, '0/7 fully reviewed cases');
  assert.equal(result.cases.find(item => item.file === '1000276474.jpg').boundaries.referenceRegions, 2);
});

test('scorer flags wrong counts and overlapping drafts without calling them approved rooms', () => {
  const reference = { cases: [{ file: 'sample.jpg', bedroomCount: 1, livingCount: 1,
    bathroomCount: 1 }] };
  const result = scoreRecognition([{ file: '1-sample.jpg', imageWidth: 1000, imageHeight: 800,
    spaces: [
      { kind: 'bedroom', x: 100, y: 100, w: 300, h: 300, anchorX: 200, anchorY: 200 },
      { kind: 'living', x: 250, y: 150, w: 300, h: 300, anchorX: 350, anchorY: 250 },
    ], unresolved: [] }], reference);
  assert.equal(result.complete, true);
  assert.equal(result.semanticCountAccuracy, 0.667);
  assert.equal(result.cases[0].overlappingBoxes, 1);
  assert.equal(result.cases[0].status, 'count_mismatch');
  assert.equal(result.boundaryAccuracy, null);
});

test('version-two diagnostics show which recognition stage lost a room', () => {
  const reference = { cases: [{ file: 'sample.jpg', bedroomCount: 1, livingCount: 1,
    bathroomCount: 1 }] };
  const result = scoreRecognition([{ file: 'sample.jpg', imageWidth: 100, imageHeight: 100,
    generatedAt: '2026-10-27T00:00:00.000Z',
    overviewProposal: { bedroomCount: 1, livingCount: 1, bathroomCount: 0 },
    stageTrace: { anchors: [{ id: 1 }, { id: 2 }, { id: 3 }], rejectedAnchors: [{ id: 3 }],
      refinement: { boundedIds: [1], unresolvedIds: [2] },
      checks: [{ id: 1, wallMatched: false, classifierConfirmed: true, gateAccepted: false }] },
    spaces: [], unresolved: [{ kind: 'bedroom', x: 10, y: 10 },
      { kind: 'living', x: 40, y: 40 }, { kind: 'bathroom', x: 70, y: 70 }] }], reference);
  assert.deepEqual(result.cases[0].stages, { overviewProposalMismatches: ['bathroomCount'],
    anchorCandidates: 3, anchorRejected: 1, refinementBounded: 1, refinementUnresolved: 1,
    locallyWallMatched: 0, classifierConfirmed: 1, gateAccepted: 0 });
  assert.equal(result.cases[0].generatedAt, '2026-10-27T00:00:00.000Z');
  assert.equal(result.boundaryAccuracy, null);
});

test('all seven visual boundary drafts are valid, but none is silently treated as ground truth', () => {
  const counts = require('../test-data/home-plan-golden.json');
  const boundaries = require('../test-data/home-plan-boundaries.json');
  assert.deepEqual(boundaries.cases.map(item => item.file), counts.cases.map(item => item.file));
  for (const item of boundaries.cases) {
    assert.equal(item.reviewStatus, 'draft');
    assert.equal(item.scope, 'partial');
    const output = scoreBoundaryCase(item, { imageWidth: item.width, imageHeight: item.height,
      spaces: [] });
    assert.equal(output.status, 'draft_not_ground_truth');
    assert.equal(output.precision, null);
    assert.equal(output.missed.length, item.regions.length);
  }
});

test('reviewed boundaries match one-to-one across resized images and penalize duplicates', () => {
  const reference = { file: 'synthetic.jpg', width: 100, height: 100,
    reviewStatus: 'reviewed', scope: 'complete', regions: [
      { id: 'bed-a', kind: 'bedroom', polygon: [[10, 10], [40, 10], [40, 40], [10, 40]] },
      { id: 'bed-b', kind: 'bedroom', polygon: [[60, 10], [90, 10], [90, 40], [60, 40]] },
    ] };
  const output = scoreBoundaryCase(reference, { imageWidth: 200, imageHeight: 200,
    spaces: [
      { kind: 'bedroom', x: 20, y: 20, w: 60, h: 60 },
      { kind: 'bedroom', x: 20, y: 20, w: 60, h: 60 },
      { kind: 'bathroom', x: 120, y: 20, w: 60, h: 60 },
    ] });
  assert.equal(output.status, 'reviewed');
  assert.equal(output.matches.length, 1);
  assert.equal(output.matches[0].iou, 1);
  assert.deepEqual(output.missed, ['bed-b']);
  assert.deepEqual(output.unmatchedCandidates, [1, 2]);
  assert.equal(output.precision, 0.333);
  assert.equal(output.recall, 0.5);
  const summary = summarizeBoundaries([output], 1);
  assert.equal(summary.boundaryAccuracy, 0.4);
  const empty = scoreBoundaryCase(reference, { imageWidth: 100, imageHeight: 100, spaces: [] });
  assert.equal(summarizeBoundaries([empty], 1).boundaryAccuracy, 0);
});

test('partial draft metrics cannot become a release accuracy number', () => {
  const draft = { file: 'synthetic.jpg', width: 100, height: 100,
    reviewStatus: 'draft', scope: 'partial', regions: [
      { id: 'room', kind: 'bedroom', polygon: [[10, 10], [40, 10], [40, 40], [10, 40]] },
    ] };
  const scored = scoreBoundaryCase(draft, { imageWidth: 100, imageHeight: 100,
    spaces: [{ kind: 'bedroom', x: 10, y: 10, w: 30, h: 30 }] });
  assert.equal(scored.recall, 1);
  assert.equal(scored.precision, null);
  assert.equal(summarizeBoundaries([scored], 1).boundaryAccuracy, null);
  assert.throws(() => scoreBoundaryCase({ ...draft, reviewStatus: 'reviewed' }, null),
    /complete plan/);
});
