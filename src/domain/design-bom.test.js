import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProductSlots, buildDesignBom } from './design-bom.js';

const item = (id, kind, w, h, extra = {}) => ({
  id, kind, w, h, z: 750, x: 1000, y: 1000, rot: 0,
  sku: `DEMO-${id}`, samplePrice: 99, ...extra,
});

test('design needs count expanded furniture without copying demo SKUs or prices', () => {
  const displayed = [
    item('desk-1', 'desk', 1400, 700),
    item('desk-1-chair-0', 'chair', 600, 600, { linkedTo: 'desk-1' }),
    item('desk-2', 'desk', 1400, 700),
    item('desk-2-chair-0', 'chair', 600, 600, { linkedTo: 'desk-2' }),
    item('room-1-table', 'meetingModular', 3000, 1000, { roomId: 'room-1' }),
    item('room-1-chair-0', 'meetingChair', 600, 600, { roomId: 'room-1' }),
  ];
  const slots = buildProductSlots(displayed);
  const result = buildDesignBom(slots);
  assert.equal(result.itemCount, 6);
  assert.equal(result.lines.find(line => line.kind === 'desk').quantity, 2);
  assert.equal(result.lines.find(line => line.kind === 'chair').quantity, 2);
  assert.equal(result.lines.find(line => line.kind === 'meetingModular').quantity, 1);
  assert.equal(result.lines.find(line => line.kind === 'meetingChair').quantity, 1);
  assert.equal(slots[1].linkedTo, 'desk-1');
  assert.doesNotMatch(JSON.stringify({ slots, result }), /DEMO-|samplePrice|sku/);
});

test('moving preserves quantities while adding, removing and resizing change the needs', () => {
  const displayed = [item('a', 'desk', 1400, 700), item('b', 'desk', 1400, 700)];
  const original = buildDesignBom(buildProductSlots(displayed));
  displayed[1].x = 9000;
  assert.deepEqual(buildDesignBom(buildProductSlots(displayed)), original);
  displayed.push(item('c', 'desk', 1600, 700));
  const expanded = buildDesignBom(buildProductSlots(displayed));
  assert.equal(expanded.itemCount, 3);
  assert.equal(expanded.lines.length, 2);
  displayed.splice(0, 1);
  assert.equal(buildDesignBom(buildProductSlots(displayed)).itemCount, 2);
});

test('bad or duplicate furniture IDs stop the design list instead of hiding an item', () => {
  assert.throws(() => buildProductSlots([item('same', 'desk', 1400, 700), item('same', 'chair', 600, 600)]), /unique IDs/);
  assert.throws(() => buildProductSlots([item('bad', 'desk', 0, 700)]), /positive dimensions/);
});

test('home furniture categories stay distinct in design needs', () => {
  const kinds = ['wardrobe', 'table', 'homeChair', 'vanity', 'sofa', 'coffeeTable', 'lowCabinet', 'bed'];
  const slots = buildProductSlots(kinds.map((kind, index) => item(`home-${index}`, kind, 900, 600)));
  assert.deepEqual(slots.map(slot => slot.category),
    ['wardrobe', 'table', 'chair', 'vanity', 'sofa', 'coffee_table', 'low_cabinet', 'bed']);
  assert.equal(buildDesignBom(slots).lines.length, 8);
  assert.notEqual(slots[1].role, slots[5].role);
  assert.notEqual(slots[0].role, slots[6].role);
});
