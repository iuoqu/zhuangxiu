import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHomePlanStructure, estimateHomePlanInkBounds, filterHomeSpaceMarginBoxes,
  matchHomeRoomRegions, proposeHomeRoomRegions, segmentHomePlanRooms,
  selectHomeRoomProposalCrops, reconcileHomeSpaceSuggestions } from './home-room-segmentation.js';

test('near-equivalent local and whole-plan room boxes merge but retain boundary review', () => {
  const local = { kind: 'bedroom', x: 21, y: 21, w: 102, h: 92, segmentationRisk: true };
  const whole = { kind: 'bedroom', x: 20, y: 20, w: 108, h: 96, segmentationRisk: false };
  const merged = reconcileHomeSpaceSuggestions([local, whole]);
  assert.equal(merged.length, 1);
  assert.deepEqual([merged[0].x, merged[0].y, merged[0].w, merged[0].h], [21, 21, 102, 92]);
  assert.equal(merged[0].segmentationRisk, true);
});

test('a furniture-sized crop cannot erase a full-room proposal', () => {
  const bedCrop = { kind: 'bedroom', x: 50, y: 50, w: 45, h: 55, segmentationRisk: true };
  const room = { kind: 'bedroom', x: 20, y: 20, w: 160, h: 140, segmentationRisk: false };
  assert.equal(reconcileHomeSpaceSuggestions([bedCrop, room]).length, 2);
});

test('conflicting uses and separate rooms stay visible for review', () => {
  const zones = [
    { kind: 'bedroom', x: 20, y: 20, w: 100, h: 100 },
    { kind: 'living', x: 22, y: 22, w: 100, h: 100 },
    { kind: 'bedroom', x: 115, y: 20, w: 100, h: 100 },
  ];
  assert.equal(reconcileHomeSpaceSuggestions(zones).length, 3);
});

const blank = (width, height) => new Uint8ClampedArray(width * height * 4).fill(255);
const dot = (image, width, x, y) => {
  const at = (y * width + x) * 4;
  image[at] = image[at + 1] = image[at + 2] = 0;
};
const line = (image, width, x0, y0, x1, y1) => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) dot(image, width, x, y);
};

test('line components yield exact free-space masks, not room names', () => {
  const width = 200, height = 140, image = blank(width, height);
  line(image, width, 20, 20, 180, 22);
  line(image, width, 20, 118, 180, 120);
  line(image, width, 20, 20, 22, 120);
  line(image, width, 178, 20, 180, 120);
  line(image, width, 95, 20, 97, 120);
  const regions = segmentHomePlanRooms(image, width, height,
    { minRun: 10, wallRadius: 2, maxGap: 10, minArea: 100, includeMasks: true });
  assert.equal(regions.length, 2);
  for (const region of regions) {
    assert.equal(region.spans.reduce((sum, [, from, to]) => sum + to - from, 0), region.area);
    assert.equal(region.touchesEdge, false);
    assert.equal('kind' in region, false);
  }
});

test('multiscale proposals bridge a narrow door but remain review-only masks', () => {
  const width = 320, height = 220, image = blank(width, height);
  line(image, width, 20, 20, 298, 22);
  line(image, width, 20, 190, 298, 192);
  line(image, width, 20, 20, 22, 192);
  line(image, width, 296, 20, 298, 192);
  line(image, width, 160, 20, 162, 94);
  line(image, width, 160, 109, 162, 192);
  const regions = proposeHomeRoomRegions(image, width, height);
  assert.equal(regions.length, 2);
  assert.ok(regions.every(region => region.stableRuns >= 2 && region.source === 'wall-components'));
  assert.ok(regions.every(region => region.spans.length && !('kind' in region)));
});

test('unclosed lines and invalid raster do not invent a room', () => {
  const width = 200, height = 140, image = blank(width, height);
  line(image, width, 20, 20, 180, 20);
  line(image, width, 20, 20, 20, 120);
  assert.deepEqual(segmentHomePlanRooms(image, width, height), []);
  assert.deepEqual(segmentHomePlanRooms(new Uint8Array(0), width, height), []);
});

test('the same segmented space is never assigned to two room candidates', () => {
  const region = { x: 20, y: 20, w: 80, h: 60, area: 4800,
    spans: Array.from({ length: 60 }, (_, row) => [20 + row, 20, 100]) };
  const zones = [{ x: 18, y: 18, w: 84, h: 64 }, { x: 21, y: 20, w: 80, h: 60 }];
  const matched = matchHomeRoomRegions(zones, [region, { ...region, spans: region.spans.map(span => [...span]) }]);
  assert.equal(matched.filter(Boolean).length, 1);
  assert.equal(matched[1].region.area, 4800);
});

test('distinct neighboring spaces can both be matched', () => {
  const regions = [
    { x: 20, y: 20, w: 80, h: 60, area: 4800 },
    { x: 110, y: 20, w: 80, h: 60, area: 4800 },
  ];
  const matched = matchHomeRoomRegions(regions, regions);
  assert.equal(matched.filter(Boolean).length, 2);
  assert.notEqual(matched[0].region, matched[1].region);
});

test('supplementary crops discard nested and already identified regions without approving types', () => {
  const regions = [
    { x: 20, y: 20, w: 120, h: 90, stableRuns: 4 },
    { x: 30, y: 25, w: 100, h: 80, stableRuns: 2 },
    { x: 165, y: 20, w: 110, h: 90, stableRuns: 3 },
    { x: 300, y: 20, w: 110, h: 90, stableRuns: 1 },
  ];
  assert.deepEqual(selectHomeRoomProposalCrops(regions, [{ x: 20, y: 20, w: 120, h: 90 }]),
    [{ id: 1, x: 165, y: 20, w: 110, h: 90 }]);
  assert.deepEqual(selectHomeRoomProposalCrops(regions, [], 1),
    [{ id: 1, x: 20, y: 20, w: 120, h: 90 }]);
  assert.deepEqual(selectHomeRoomProposalCrops(regions, [], 0), []);
});

test('blank-margin gate discards top-left coordinate drift while retaining edge rooms', () => {
  const width = 500, height = 350, image = blank(width, height);
  line(image, width, 80, 60, 450, 62);
  line(image, width, 80, 298, 450, 300);
  line(image, width, 80, 60, 82, 300);
  line(image, width, 448, 60, 450, 300);
  line(image, width, 265, 60, 267, 300);
  const bounds = estimateHomePlanInkBounds(image, width, height);
  assert.deepEqual(bounds, { x: 80, y: 60, w: 371, h: 241 });
  const bad = { x: 0, y: 0, w: 220, h: 160 };
  const room = { x: 78, y: 58, w: 188, h: 242 };
  assert.deepEqual(filterHomeSpaceMarginBoxes([bad, room], bounds, width, height),
    { accepted: [room], rejectedCount: 1 });
  assert.deepEqual(filterHomeSpaceMarginBoxes([bad], null, width, height),
    { accepted: [bad], rejectedCount: 0 });
});

test('structural draft keeps mask candidates in uploaded-image coordinates without inventing room types', () => {
  const width = 320, height = 220, image = blank(width, height);
  line(image, width, 20, 20, 298, 22);
  line(image, width, 20, 190, 298, 192);
  line(image, width, 20, 20, 22, 192);
  line(image, width, 296, 20, 298, 192);
  line(image, width, 160, 20, 162, 192);
  const draft = buildHomePlanStructure(image, width, height);
  assert.equal(draft.coordinateSpace, 'uploaded-image-pixels');
  assert.equal(draft.widthPx, width);
  assert.equal(draft.heightPx, height);
  assert.equal(draft.candidates.length, 2);
  assert.ok(draft.candidates.every(candidate => !('kind' in candidate) &&
    candidate.x + candidate.w <= width && candidate.y + candidate.h <= height));
  assert.equal(buildHomePlanStructure(new Uint8Array(0), width, height), null);
});

test('pale walls use a cautious contrast fallback only when dark geometry is absent', () => {
  const width = 320, height = 220, image = blank(width, height);
  const pale = (x0, y0, x1, y1) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const at = (y * width + x) * 4;
      image[at] = image[at + 1] = image[at + 2] = 190;
    }
  };
  pale(20, 20, 298, 22); pale(20, 190, 298, 192);
  pale(20, 20, 22, 192); pale(296, 20, 298, 192);
  pale(160, 20, 162, 192);
  const draft = buildHomePlanStructure(image, width, height);
  assert.equal(draft.inkBounds, null);
  assert.equal(draft.contrastFallback, true);
  assert.equal(draft.candidates.length, 2);
  assert.ok(draft.regions.every(region => region.contrastFallback));
});

test('irregular merged component is withheld from semantic crop proposals', () => {
  const regions = [
    { x: 20, y: 20, w: 180, h: 180, fillRatio: .46, stableRuns: 4 },
    { x: 220, y: 20, w: 100, h: 100, fillRatio: .95, stableRuns: 3 },
  ];
  assert.deepEqual(selectHomeRoomProposalCrops(regions), [{ id: 1, x: 220, y: 20, w: 100, h: 100 }]);
});
