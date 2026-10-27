import test from 'node:test';
import assert from 'node:assert/strict';
import { collapsedHomeAnchorIds, gateHomeBoundaryDrafts } from './home-boundary-gate.js';

const zone = { id: 1, kind: 'bedroom', x: 20, y: 30, w: 180, h: 140,
  anchorX: 95, anchorY: 90, evidence: 'BEDROOM label', labelText: 'BEDROOM',
  boundaryPolygon: [{ x: 20, y: 30 }, { x: 200, y: 30 },
    { x: 200, y: 170 }, { x: 20, y: 170 }],
  wallMatched: true, classifierConfirmed: true, segmentationRisk: false };

test('only independently matched complete boundary enters the editable draft', () => {
  assert.deepEqual(gateHomeBoundaryDrafts([zone], [[]]), { accepted: [zone], unresolved: [] });
  assert.equal(gateHomeBoundaryDrafts([zone], [['overlap']]).accepted.length, 0);
});

test('a wrong box becomes an anchor while its coordinates remain in diagnostics', () => {
  const draft = gateHomeBoundaryDrafts([{ ...zone, x: 0, wallMatched: false,
    classifierConfirmed: false, boundaryConflict: true }], [[]]);
  assert.equal(draft.accepted.length, 0);
  assert.deepEqual(draft.unresolved[0].rejectedBox, { x: 0, y: 30, w: 180, h: 140 });
  assert.deepEqual([draft.unresolved[0].x, draft.unresolved[0].y], [95, 90]);
  assert.match(draft.unresolved[0].boundaryIssue, /本地墙线/);
});

test('cross-kind coordinate collapse at drawing margin is quarantined, not genuine rooms', () => {
  const anchors = [
    { id: 1, kind: 'living', x: 48, y: 64 },
    { id: 2, kind: 'dining', x: 62, y: 77 },
    { id: 3, kind: 'kitchen', x: 72, y: 96 },
    { id: 4, kind: 'deck', x: 82, y: 38 },
    { id: 5, kind: 'bedroom', x: 295, y: 351 },
  ];
  assert.deepEqual([...collapsedHomeAnchorIds(anchors, { x: 104, y: 34, w: 750, h: 1220 },
    960, 1280)].sort(), [1, 2, 3, 4]);
  assert.deepEqual([...collapsedHomeAnchorIds(anchors.map((anchor, index) => ({ ...anchor,
    x: index < 4 ? anchor.x + 300 : anchor.x,
    y: index < 4 ? anchor.y + 300 : anchor.y })),
    { x: 104, y: 34, w: 750, h: 1220 }, 960, 1280)], []);
});
