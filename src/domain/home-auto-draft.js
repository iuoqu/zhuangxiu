// Turn model proposals into an explicitly unreviewed furnishing draft. Visual
// dimensions are drawing units only; they must never become measured room data.
const allowedKinds = new Set(['living', 'dining', 'bedroom', 'bathroom', 'kitchen',
  'study', 'mezzanine', 'void', 'stairs', 'deck', 'closet', 'ac_ledge', 'unknown']);
const furnishingKinds = new Set(['living', 'dining', 'bedroom', 'mezzanine']);
const validPair = size => size && [size.width, size.depth].every(value =>
  Number.isInteger(value) && value >= 100 && value <= 100000);
const measuredScales = zones => zones.flatMap(zone => validPair(zone.dimensionsMm) && furnishingKinds.has(zone.kind)
  ? [zone.dimensionsMm.width / zone.w, zone.dimensionsMm.depth / zone.h] : [])
  .filter(value => value >= 2 && value <= 100).sort((a, b) => a - b);

// For a room without printed dimensions, borrow the drawing scale from other
// measured rooms on the same image. This is only a visual canvas size, not a
// measured dimension or evidence that furniture fits.
export function fillMissingHomeVisualSizes(site) {
  if (site?.source?.kind !== 'image' || !Array.isArray(site.zones)) return 0;
  const scales = measuredScales(site.zones.filter(zone => zone.w > 0 && zone.h > 0));
  if (!scales.length) return 0;
  const scale = scales[Math.floor(scales.length / 2)];
  let filled = 0;
  for (const zone of site.zones) {
    if (!furnishingKinds.has(zone.kind) || validPair(zone.dimensionsMm) || validPair(zone.visualSizeMm) ||
        !Number.isFinite(zone.w) || !Number.isFinite(zone.h) || zone.w <= 0 || zone.h <= 0) continue;
    const width = Math.round(zone.w * scale), depth = Math.round(zone.h * scale);
    if (!validPair({ width, depth })) continue;
    zone.visualSizeMm = { width, depth };
    filled++;
  }
  return filled;
}

export function createHomeAutoDraft(suggestions, source, stamp = Date.now()) {
  if (source?.kind !== 'image' || !Number.isInteger(source.widthPx) || !Number.isInteger(source.heightPx))
    throw new TypeError('An image floor plan is required');
  const proposals = (Array.isArray(suggestions) ? suggestions : []).slice(0, 20).filter(zone =>
    allowedKinds.has(zone?.kind) && [zone.x, zone.y, zone.w, zone.h].every(Number.isInteger) &&
    zone.x >= 0 && zone.y >= 0 && zone.w >= 8 && zone.h >= 8 &&
    zone.x + zone.w <= source.widthPx && zone.y + zone.h <= source.heightPx);
  const scaleSamples = measuredScales(proposals);
  const scale = scaleSamples.length ? scaleSamples[Math.floor(scaleSamples.length / 2)] : null;
  const zones = proposals.map((zone, index) => {
    const size = validPair(zone.dimensionsMm) && typeof zone.evidence === 'string' && zone.evidence.trim()
      ? { width: zone.dimensionsMm.width, depth: zone.dimensionsMm.depth } : null;
    const note = size ? `${zone.evidence.trim().slice(0, 40)}（AI 草稿待复核）` : '';
    const draft = { id: `auto-${stamp}-${index}`, kind: zone.kind, x: zone.x, y: zone.y, w: zone.w, h: zone.h,
      reviewStatus: 'draft' };
    if (typeof zone.labelText === 'string' && zone.labelText.trim())
      draft.labelText = zone.labelText.trim().slice(0, 60);
    if (size) Object.assign(draft, { dimensionsMm: size, dimensionsLabel: note.slice(0, 60),
      dimensionSource: 'ai_draft_printed', dimensionEvidence: zone.evidence.trim().slice(0, 120) });
    else if (furnishingKinds.has(zone.kind)) {
      const base = scale || 25;
      const width = zone.w * base, depth = zone.h * base;
      const minimum = zone.kind === 'bedroom' ? [3600, 3900] :
        zone.kind === 'living' ? [4000, 3600] : zone.kind === 'dining' ? [3400, 3000] : [3400, 3400];
      const expansion = Math.max(1, minimum[0] / width, minimum[1] / depth);
      draft.visualSizeMm = { width: Math.round(width * expansion), depth: Math.round(depth * expansion) };
    }
    return draft;
  });
  return { zones, placeableCount: zones.filter(zone => furnishingKinds.has(zone.kind)).length,
    visualOnlyCount: zones.filter(zone => zone.visualSizeMm).length,
    printedDraftCount: zones.filter(zone => zone.dimensionSource === 'ai_draft_printed').length };
}
