import assert from 'node:assert/strict';
import { test } from 'node:test';
import { homeZoneGeometryWarnings } from './home-zone-geometry.js';

const source = { widthPx: 1000, heightPx: 800 };
const room = (x, y, w, h, selected = true) => ({ x, y, w, h, kind: 'bedroom', selected });

test('flags obviously risky image-edge, oversized, and overlapping boxes', () => {
  const result = homeZoneGeometryWarnings([
    room(0, 0, 610, 590), room(250, 220, 300, 300), room(700, 300, 180, 180),
  ], source);
  assert.match(result[0].join(' '), /超过 36%/);
  assert.match(result[0].join(' '), /图片边缘/);
  assert.match(result[0].join(' '), /明显重叠/);
  assert.match(result[1].join(' '), /明显重叠/);
  assert.deepEqual(result[2], []);
});

test('excluded boxes cannot make a selected room fail overlap review', () => {
  const result = homeZoneGeometryWarnings([room(100, 100, 200, 200), room(120, 120, 200, 200, false)], source);
  assert.deepEqual(result, [[], []]);
});
