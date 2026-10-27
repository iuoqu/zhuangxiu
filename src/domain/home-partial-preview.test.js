import test from 'node:test';
import assert from 'node:assert/strict';
import { selectHomePartialPreviewZones } from './home-partial-preview.js';

const source = { widthPx: 1000, heightPx: 800 };
const overview = { reviewed: true, bedroomCount: 2, livingCount: 1, bathroomCount: 2, hasMezzanine: false };
const zone = (kind, x, y, extra = {}) => ({ kind, x, y, w: 200, h: 180, selected: true,
  support: `${kind} fixture`, boundaryConfirmed: true, ...extra });

test('previews only evidenced, non-overlapping furniture zones', () => {
  const living = zone('living', 100, 100);
  const bedroom = zone('bedroom', 400, 100);
  const bath = zone('bathroom', 700, 100);
  const unclear = zone('bedroom', 400, 400, { support: 'possibly a bedroom' });
  assert.deepEqual(selectHomePartialPreviewZones([living, bedroom, bath, unclear], source, overview),
    [living, bedroom]);
});

test('overcount, unknown overlap, and risky boundaries never preview', () => {
  const excessLiving = [zone('living', 100, 100), zone('living', 400, 100)];
  assert.deepEqual(selectHomePartialPreviewZones(excessLiving, source, overview), []);
  const bedroom = zone('bedroom', 100, 100);
  const unknown = zone('unknown', 150, 110);
  assert.deepEqual(selectHomePartialPreviewZones([bedroom, unknown], source, overview), []);
  assert.deepEqual(selectHomePartialPreviewZones([zone('bedroom', 100, 100,
    { boundsEdited: true, boundaryConfirmed: false })], source, overview), []);
  assert.deepEqual(selectHomePartialPreviewZones([zone('bedroom', 100, 100,
    { boundaryConfirmed: false })], source, overview), []);
  assert.deepEqual(selectHomePartialPreviewZones([zone('bedroom', 100, 100,
    { boundaryConflict: true })], source, overview), []);
  assert.deepEqual(selectHomePartialPreviewZones([zone('bedroom', 0, 100)], source, overview), []);
});

test('an incomplete bedroom group does not stack a two-bedroom package into one room', () => {
  const living = zone('living', 100, 100);
  const oneBedroom = zone('bedroom', 400, 100);
  assert.deepEqual(selectHomePartialPreviewZones([living, oneBedroom], source, overview), [living]);
});

test('a printed balcony label cannot become a mezzanine furniture preview', () => {
  const loft = { ...overview, hasMezzanine: true };
  assert.deepEqual(selectHomePartialPreviewZones([zone('mezzanine', 400, 100,
    { labelText: 'BALCONY', support: 'mezzanine-like space' })], source, loft), []);
});
