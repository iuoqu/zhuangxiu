import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLayoutRevision, serializeLayout } from './layout-revision.js';

const project = () => ({
  w: 18000, h: 12000, site: { confirmed: true }, rules: { main: 1200, minor: 900 },
  objects: [
    { id: 'column-1', type: 'column', x: 6000, y: 5000, x2: 6500, y2: 5500 },
    { id: 'room-1', type: 'room', kind: 'meeting', x: 1000, y: 1000, x2: 5000, y2: 4500, door: { side: 'south', width: 900 }, plannedSeats: 6 },
  ],
  furniture: [
    { id: 'desk-2', kind: 'desk', x: 9000, y: 3000, w: 1400, h: 700, z: 750, rot: 0, sku: 'DEMO-B', price: 400 },
    { id: 'desk-1', kind: 'desk', x: 7000, y: 3000, w: 1400, h: 700, z: 750, rot: 0, sku: 'DEMO-A', price: 400 },
  ],
  source: { preview: 'large-image' },
});

test('layout revision is stable across item order and illustrative metadata', async () => {
  const first = project(), second = project();
  second.objects.reverse();
  second.furniture.reverse();
  second.furniture[0].sku = 'ANOTHER-DEMO';
  second.furniture[0].price = 999;
  second.source.preview = 'different-image';
  assert.equal(serializeLayout(first), serializeLayout(second));
  assert.equal(await computeLayoutRevision(first), await computeLayoutRevision(second));
});

test('moving furniture or a fixed object and changing room or aisle rules invalidates the review', async () => {
  const original = await computeLayoutRevision(project());
  for (const change of [
    p => { p.furniture[0].x += 50; },
    p => { p.objects[0].x += 50; },
    p => { p.objects[1].door.side = 'east'; },
    p => { p.objects[1].plannedSeats = 8; },
    p => { p.objects[1].furnitureShift = { dx: -250, dy: 0 }; },
    p => { p.rules.main = 1400; },
    p => { p.site.confirmed = false; },
  ]) {
    const changed = project();
    change(changed);
    assert.notEqual(await computeLayoutRevision(changed), original);
  }
});

test('incomplete geometry cannot receive a layout revision', () => {
  assert.throws(() => serializeLayout({ w: 18000, h: 12000, objects: [] }), /site dimensions, objects and furniture/);
});
