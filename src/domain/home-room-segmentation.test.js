import test from 'node:test';
import assert from 'node:assert/strict';
import { matchHomeRoomRegions, proposeHomeRoomRegions, segmentHomePlanRooms } from './home-room-segmentation.js';

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
