import { homeZoneGeometryWarnings } from './home-zone-geometry.js';

const previewFurnishingKinds = new Set(['living', 'dining', 'bedroom', 'mezzanine']);
const previewCountKeys = { living: 'livingCount', bedroom: 'bedroomCount' };
const printedUses = [
  ['bedroom', /bedroom|卧室|主卧/i], ['living', /living|客厅|起居/i],
  ['bathroom', /bath|toilet|\bwc\b|卫生间/i], ['dining', /dining|餐厅/i],
  ['kitchen', /kitchen|厨房/i], ['study', /study|书房/i],
  ['deck', /balcony|terrace|\bdeck\b|阳台|露台/i], ['mezzanine', /mezzanine|loft|夹层/i],
];

function previewOverlaps(a, b) {
  const width = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return width * height > .18 * Math.min(a.w * a.h, b.w * b.h);
}

// This is a visual-only shortlist. Passing these checks does not confirm room
// boundaries, measurements, circulation, or furniture fit.
export function selectHomePartialPreviewZones(suggestions, source, overview) {
  if (!Array.isArray(suggestions) || !source || overview?.reviewed !== true) return [];
  const warnings = homeZoneGeometryWarnings(suggestions, source);
  const counts = Object.fromEntries(['living', 'bedroom'].map(kind => [kind,
    suggestions.filter(zone => zone.selected && zone.kind === kind).length]));
  return suggestions.filter((zone, index) => {
    if (!zone.selected || !previewFurnishingKinds.has(zone.kind) || warnings[index].length || zone.segmentationRisk ||
        zone.boundsEdited && !zone.boundaryConfirmed) return false;
    if (![zone.x, zone.y, zone.w, zone.h].every(Number.isInteger) || zone.w < 8 || zone.h < 8 ||
        zone.x < 0 || zone.y < 0 || zone.x + zone.w > source.widthPx ||
        zone.y + zone.h > source.heightPx) return false;
    const support = [zone.support, zone.labelText, zone.evidence].filter(Boolean).join(' ');
    if (!support || /\b(unclear|uncertain|maybe|possible|possibly)\b|不确定|可能是/.test(support.toLowerCase())) return false;
    const labelKinds = printedUses.filter(([, pattern]) => pattern.test(zone.labelText || ''))
      .map(([kind]) => kind);
    if (labelKinds.length && !labelKinds.includes(zone.kind)) return false;
    if (zone.kind === 'mezzanine' && !overview.hasMezzanine) return false;
    if (previewCountKeys[zone.kind] && counts[zone.kind] > overview[previewCountKeys[zone.kind]]) return false;
    return !suggestions.some((other, otherIndex) => otherIndex !== index && other.selected &&
      [other.x, other.y, other.w, other.h].every(Number.isInteger) && other.w > 0 && other.h > 0 &&
      previewOverlaps(zone, other));
  }).filter(zone => !previewCountKeys[zone.kind] || counts[zone.kind] === overview[previewCountKeys[zone.kind]]);
}
