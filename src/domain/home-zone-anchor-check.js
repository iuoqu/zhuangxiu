// Independent OCR labels are diagnostic evidence, not surveyed room geometry.
const labelKinds = new Map([
  ['LIVING', 'living'], ['BEDROOM', 'bedroom'], ['DINING', 'dining'],
  ['KITCHEN', 'kitchen'], ['BATH', 'bathroom'], ['BATHROOM', 'bathroom'],
  ['MEZZANINE', 'mezzanine'], ['CLOSET', 'closet'], ['DECK', 'deck'],
]);

const centerOf = bbox => ({ x: (bbox.x0 + bbox.x1) / 2, y: (bbox.y0 + bbox.y1) / 2 });
const validBbox = bbox => bbox && [bbox.x0, bbox.y0, bbox.x1, bbox.y1].every(Number.isFinite) &&
  bbox.x1 > bbox.x0 && bbox.y1 > bbox.y0;
const inside = (box, point) => point.x >= box.x && point.x <= box.x + box.w &&
  point.y >= box.y && point.y <= box.y + box.h;

export function extractHomeRoomAnchors(blocks, minConfidence = 55) {
  if (!Array.isArray(blocks) || !Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 100)
    throw new TypeError('OCR blocks and a valid confidence threshold are required');
  const anchors = [];
  for (const block of blocks) for (const paragraph of block.paragraphs || [])
    for (const line of paragraph.lines || []) {
      const words = line.words || [];
      for (const word of words) {
        const kind = labelKinds.get(String(word.text || '').replace(/[^A-Za-z]/g, '').toUpperCase());
        if (!kind || !validBbox(word.bbox) || !Number.isFinite(word.confidence) ||
            word.confidence < minConfidence) continue;
        anchors.push({ kind, text: word.text, ...centerOf(word.bbox), confidence: word.confidence });
      }
      const open = words.find(word => /^OPEN$/i.test(word.text));
      const below = words.find(word => /^BELOW$/i.test(word.text));
      if (open && below && validBbox(open.bbox) && validBbox(below.bbox) &&
          Number.isFinite(open.confidence) && Number.isFinite(below.confidence) &&
          open.confidence >= minConfidence && below.confidence >= minConfidence) {
        anchors.push({ kind: 'void', text: 'OPEN TO BELOW',
          x: (open.bbox.x0 + below.bbox.x1) / 2,
          y: (Math.min(open.bbox.y0, below.bbox.y0) + Math.max(open.bbox.y1, below.bbox.y1)) / 2,
          confidence: Math.min(open.confidence, below.confidence) });
      }
    }
  return anchors.filter((anchor, index) => !anchors.slice(0, index).some(other =>
    other.kind === anchor.kind && Math.hypot(other.x - anchor.x, other.y - anchor.y) < 12));
}

export function assessHomeZoneAnchors(zones, anchors, source) {
  if (!Array.isArray(zones) || !Array.isArray(anchors) ||
      !Number.isFinite(source?.widthPx) || !Number.isFinite(source?.heightPx) ||
      source.widthPx <= 0 || source.heightPx <= 0)
    throw new TypeError('Candidate zones, OCR anchors and image dimensions are required');
  const evidence = anchors.filter(anchor => typeof anchor?.kind === 'string' &&
    [anchor.x, anchor.y].every(Number.isFinite) && anchor.x >= 0 && anchor.y >= 0 &&
    anchor.x <= source.widthPx && anchor.y <= source.heightPx);
  const rows = zones.map((zone, index) => {
    const valid = zone && [zone.x, zone.y, zone.w, zone.h].every(Number.isFinite) &&
      zone.x >= 0 && zone.y >= 0 && zone.w > 0 && zone.h > 0 &&
      zone.x + zone.w <= source.widthPx && zone.y + zone.h <= source.heightPx;
    if (!valid) return { candidateIndex: index, kind: zone?.kind || 'invalid', status: 'invalid_box' };
    const contained = evidence.filter(anchor => inside(zone, anchor));
    const same = contained.filter(anchor => anchor.kind === zone.kind);
    const other = contained.filter(anchor => anchor.kind !== zone.kind);
    const elsewhere = evidence.filter(anchor => anchor.kind === zone.kind && !same.includes(anchor));
    const status = same.length ? other.length ? 'mixed_labels' : 'label_supported' :
      other.length ? 'wrong_label_inside' : elsewhere.length ? 'label_elsewhere' : 'no_text_evidence';
    return { candidateIndex: index, kind: zone.kind, status,
      containedLabels: contained.map(anchor => anchor.kind),
      sameKindLabelsElsewhere: elsewhere.length };
  });
  const unmatchedAnchors = evidence.filter(anchor => !zones.some(zone => zone?.kind === anchor.kind &&
    [zone.x, zone.y, zone.w, zone.h].every(Number.isFinite) && inside(zone, anchor)))
    .map(anchor => ({ kind: anchor.kind, x: anchor.x, y: anchor.y }));
  const count = status => rows.filter(row => row.status === status).length;
  return { rows, unmatchedAnchors, summary: { candidates: rows.length, anchors: evidence.length,
    labelSupported: count('label_supported'), needsReview: count('mixed_labels') +
      count('wrong_label_inside') + count('label_elsewhere'),
    noTextEvidence: count('no_text_evidence'), invalidBoxes: count('invalid_box') },
    caveat: 'OCR label alignment is not wall-boundary or furniture-fit verification.' };
}
