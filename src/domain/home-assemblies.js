// A design relationship is not a supplier bundle or a purchasable SKU.
// Only explicit instance links may make a seating footprint overlap the
// anchor's reviewed use zone. Proximity alone never creates a relationship.
const allowed = new Map([
  ['homeChair', new Set(['table', 'vanity'])],
  ['coffeeTable', new Set(['sofa'])],
  ['diningChair', new Set(['pantryTable', 'diningTable'])],
  ['sideTable', new Set(['sofa'])],
]);

export function analyzeHomeAssemblies(items) {
  if (!Array.isArray(items)) throw new TypeError('Furniture instances must be an array');
  const byId = new Map(), errors = [], relations = [];
  for (const item of items) {
    if (!item || typeof item.id !== 'string' || !item.id || byId.has(item.id)) {
      errors.push('invalid_or_duplicate_instance_id');
      continue;
    }
    byId.set(item.id, item);
  }
  for (const item of items) {
    if (!item?.linkedTo) continue;
    const anchor = byId.get(item.linkedTo);
    if (!anchor || anchor.id === item.id) { errors.push(`missing_link_anchor:${item.id}`); continue; }
    if (!allowed.get(item.kind)?.has(anchor.kind)) { errors.push(`invalid_furniture_relation:${item.id}`); continue; }
    relations.push({ anchorId: anchor.id, memberId: item.id,
      kind: item.kind === 'coffeeTable' ? 'sofa_coffee_table' : item.kind === 'sideTable' ? 'sofa_side_table' : anchor.kind === 'vanity' ? 'vanity_chair' : 'table_chair' });
  }
  return { relations, errors: [...new Set(errors)] };
}

export function seatingRelation(anchor, member) {
  if (!anchor || !member || member.linkedTo !== anchor.id) return false;
  if (member.kind === 'homeChair') return anchor.kind === 'table' || anchor.kind === 'vanity';
  if (member.kind === 'chair') return ['bench2', 'desk', 'manager', 'reception', 'cubicle'].includes(anchor.kind);
  if (member.kind === 'meetingChair') return anchor.kind === 'meeting' || anchor.kind === 'meetingModular';
  if (member.kind === 'barStool') return anchor.kind === 'coffeeBar';
  if (member.kind === 'diningChair') return anchor.kind === 'pantryTable' || anchor.kind === 'diningTable';
  return false;
}
