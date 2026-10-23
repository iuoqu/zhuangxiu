import assert from 'node:assert/strict';
import { test } from 'node:test';
import { snapHomeZoneToLines } from './home-wall-snap.js';

const width = 240, height = 210;
function plan() {
  const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
  const ink = (x, y) => {
    const at = (y * width + x) * 4;
    pixels[at] = pixels[at + 1] = pixels[at + 2] = 0;
  };
  const vertical = (x, y0, y1) => {
    for (let y = y0; y <= y1; y++) for (let dx = -2; dx <= 2; dx++) ink(x + dx, y);
  };
  const horizontal = (y, x0, x1) => {
    for (let x = x0; x <= x1; x++) for (let dy = -2; dy <= 2; dy++) ink(x, y + dy);
  };
  vertical(30, 25, 175); vertical(190, 25, 175);
  horizontal(25, 30, 190); horizontal(175, 30, 190);
  return { pixels, vertical, horizontal };
}

test('snaps four nearby continuous edges to their image coordinates', () => {
  const { pixels } = plan();
  const result = snapHomeZoneToLines(pixels, width, height, { x: 24, y: 20, w: 172, h: 161 });
  assert.ok(result);
  assert.ok(Math.abs(result.x - 30) <= 2, JSON.stringify(result));
  assert.ok(Math.abs(result.y - 25) <= 2);
  assert.ok(Math.abs(result.w - 160) <= 4);
  assert.ok(Math.abs(result.h - 150) <= 4);
});

test('does not turn a box crossing a partition into a trusted room', () => {
  const { pixels, vertical } = plan();
  vertical(110, 25, 175);
  assert.equal(snapHomeZoneToLines(pixels, width, height,
    { x: 24, y: 20, w: 172, h: 161 }), null);
});

test('does not infer walls from blank space or a partial line', () => {
  const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
  assert.equal(snapHomeZoneToLines(pixels, width, height,
    { x: 24, y: 20, w: 172, h: 161 }), null);
});
