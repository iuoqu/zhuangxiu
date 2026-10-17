import { buildProductSlots } from './product-slots.js';

export { buildProductSlots };

export function buildDesignBom(slots) {
  if (!Array.isArray(slots)) throw new TypeError('Product slots must be an array');
  const groups = new Map();
  const seen = new Set();
  for (const slot of slots) {
    if (!slot || typeof slot.slotId !== 'string' || seen.has(slot.slotId)) {
      throw new TypeError('Product slots need unique IDs');
    }
    seen.add(slot.slotId);
    const size = slot.envelopeMm;
    if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.depth)) {
      throw new TypeError(`Product slot ${slot.slotId} needs dimensions`);
    }
    const key = JSON.stringify([slot.category, slot.role, slot.kind, size.width, size.depth, size.height]);
    if (!groups.has(key)) {
      groups.set(key, {
        category: slot.category,
        role: slot.role,
        kind: slot.kind,
        label: slot.label,
        envelopeMm: { ...size },
        quantity: 0,
        slotIds: [],
        sourceInstanceIds: [],
        productStatus: 'needs_product',
      });
    }
    const group = groups.get(key);
    group.quantity += 1;
    group.slotIds.push(slot.slotId);
    group.sourceInstanceIds.push(slot.sourceInstanceId);
  }
  return { lines: [...groups.values()], itemCount: slots.length };
}
