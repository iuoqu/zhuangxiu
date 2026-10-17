// Product-specific planning clearances. These values come from a reviewed
// source or planning record; the module does not invent universal allowances.
const positive = value => Number.isFinite(value) && value > 0;
const nonnegative = value => Number.isFinite(value) && value >= 0;
const factMatches = (candidate, field, expected) => {
  const fact = candidate.fieldSources?.[field];
  return fact?.sourceRef === candidate.sourceRef && fact?.observedAt === candidate.observedAt &&
    typeof fact.raw === 'string' && fact.raw.trim() !== '' &&
    (typeof expected === 'number' ? Number(fact.raw) === expected : fact.raw.trim().toLowerCase() === expected);
};

const reviewedZoneCategories = new Set(['table', 'chair', 'vanity', 'sofa', 'coffee_table', 'low_cabinet',
  'desk', 'cabinet', 'shelf', 'locker', 'phone_booth', 'counter', 'stool', 'equipment', 'display']);
export const needsProductUseSpec = category => category === 'wardrobe' || category === 'bed' || reviewedZoneCategories.has(category);

const validZone = zone => zone && typeof zone.purpose === 'string' && zone.purpose.trim() &&
  Number.isFinite(zone.x) && Number.isFinite(zone.y) && positive(zone.w) && positive(zone.h);
const outsideBody = (zone, width, depth) => zone.x + zone.w <= -width / 2 || zone.x >= width / 2 ||
  zone.y + zone.h <= -depth / 2 || zone.y >= depth / 2;
const sameZones = (left, right) => Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
  left.every((zone, index) => validZone(zone) && validZone(right[index]) &&
    ['purpose', 'x', 'y', 'w', 'h'].every(field => zone[field] === right[index][field]));

export function hasVerifiedProductUseSpec(candidate) {
  if (!needsProductUseSpec(candidate?.category)) return true;
  if (candidate.verification?.use !== true || !positive(candidate.dimensionsMm?.width) || !positive(candidate.dimensionsMm?.depth)) return false;
  const spec = candidate.useSpec;
  if (!spec || typeof spec !== 'object') return false;
  if (candidate.category === 'wardrobe') {
    return ['hinged', 'sliding'].includes(spec.doorMechanism) && positive(spec.frontClearanceMm) &&
      factMatches(candidate, 'doorMechanism', spec.doorMechanism) &&
      factMatches(candidate, 'frontClearanceMm', spec.frontClearanceMm);
  }
  if (candidate.category === 'bed') {
    return nonnegative(spec.leftClearanceMm) && nonnegative(spec.rightClearanceMm) &&
      nonnegative(spec.footClearanceMm) && spec.leftClearanceMm + spec.rightClearanceMm > 0 &&
      factMatches(candidate, 'leftClearanceMm', spec.leftClearanceMm) &&
      factMatches(candidate, 'rightClearanceMm', spec.rightClearanceMm) &&
      factMatches(candidate, 'footClearanceMm', spec.footClearanceMm);
  }
  const fact = candidate.fieldSources?.useZones;
  if (!fact || fact.sourceRef !== candidate.sourceRef || fact.observedAt !== candidate.observedAt ||
      !Array.isArray(spec.zones) || !spec.zones.length || spec.zones.length > 8 ||
      spec.zones.some(zone => !validZone(zone) || !outsideBody(zone, candidate.dimensionsMm.width, candidate.dimensionsMm.depth))) return false;
  try { return sameZones(spec.zones, JSON.parse(fact.raw)); } catch { return false; }
}

export function requiredProductUseRects(candidate) {
  if (!hasVerifiedProductUseSpec(candidate)) return null;
  if (!needsProductUseSpec(candidate?.category)) return [];
  const { width, depth } = candidate.dimensionsMm, spec = candidate.useSpec;
  if (candidate.category === 'wardrobe') {
    return [{ x: -width / 2, y: depth / 2, w: width, h: spec.frontClearanceMm }];
  }
  if (reviewedZoneCategories.has(candidate.category)) {
    return spec.zones.map(({ x, y, w, h }) => ({ x, y, w, h }));
  }
  const boxes = [];
  if (spec.leftClearanceMm) boxes.push({ x: -width / 2 - spec.leftClearanceMm, y: -depth / 2, w: spec.leftClearanceMm, h: depth });
  if (spec.rightClearanceMm) boxes.push({ x: width / 2, y: -depth / 2, w: spec.rightClearanceMm, h: depth });
  if (spec.footClearanceMm) boxes.push({ x: -width / 2, y: depth / 2, w: width, h: spec.footClearanceMm });
  return boxes;
}

export function profileCoversRequiredUseRects(profile, required) {
  return Array.isArray(profile?.clearanceRects) && Array.isArray(required) && required.every(box =>
    profile.clearanceRects.some(value => ['x', 'y', 'w', 'h'].every(field => value?.[field] === box[field])));
}
