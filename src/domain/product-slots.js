// Design needs are derived from placed objects. Demo SKUs and prices are deliberately ignored.
import { sceneFurnitureType } from './furniture-taxonomy.js';

const validSize = value => Number.isFinite(value) && value > 0;

export function buildProductSlots(displayItems) {
  if (!Array.isArray(displayItems)) throw new TypeError('Furniture instances must be an array');
  const seen = new Set();
  return displayItems.map(item => {
    if (!item || typeof item.id !== 'string' || !item.id || seen.has(item.id)) {
      throw new TypeError('Furniture instances need unique IDs');
    }
    if (typeof item.kind !== 'string' || !item.kind || !validSize(item.w) || !validSize(item.h)) {
      throw new TypeError(`Furniture ${item.id} needs a kind and positive dimensions`);
    }
    seen.add(item.id);
    const { category, role, label } = sceneFurnitureType(item.kind);
    return {
      slotId: `slot:${item.id}`,
      sourceInstanceId: item.id,
      category,
      role,
      kind: item.kind,
      label,
      envelopeMm: { width: item.w, depth: item.h, height: validSize(item.z) ? item.z : null },
      placementMm: {
        x: Number.isFinite(item.x) ? item.x : null,
        y: Number.isFinite(item.y) ? item.y : null,
        rotation: Number.isFinite(item.rot) ? item.rot : 0,
      },
      linkedTo: item.linkedTo || item.roomId || item.zoneId || null,
      productStatus: 'needs_product',
    };
  });
}
