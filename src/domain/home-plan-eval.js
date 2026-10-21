// Offline comparison of one AI draft with a manually annotated floor plan.
// The reference rectangles are schematic annotations, not surveyed wall boundaries.
const placeableKinds = new Set(['living', 'dining', 'bedroom', 'mezzanine']);
const fixedKinds = new Set(['bathroom', 'kitchen', 'void', 'stairs', 'deck', 'closet']);
const validDimensions = value => value && [value.width, value.depth].every(number =>
  Number.isFinite(number) && number >= 100 && number <= 100000);

function normalizedBox(zone, source) {
  if (!zone || !source || !Number.isFinite(source.widthPx) || !Number.isFinite(source.heightPx) ||
      source.widthPx <= 0 || source.heightPx <= 0 ||
      ![zone.x, zone.y, zone.w, zone.h].every(Number.isFinite) ||
      zone.x < 0 || zone.y < 0 || zone.w <= 0 || zone.h <= 0 ||
      zone.x + zone.w > source.widthPx || zone.y + zone.h > source.heightPx) return null;
  return { x: zone.x / source.widthPx, y: zone.y / source.heightPx,
    w: zone.w / source.widthPx, h: zone.h / source.heightPx };
}

function boxIoU(a, b) {
  if (!a || !b) return 0;
  const width = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const intersection = width * height;
  return intersection / (a.w * a.h + b.w * b.h - intersection);
}

function printedSizeResult(expected, actual, toleranceMm) {
  if (!validDimensions(expected)) return validDimensions(actual) ? 'unsupported' : 'not_required';
  if (!validDimensions(actual)) return 'missing';
  const direct = Math.abs(expected.width - actual.width) <= toleranceMm &&
    Math.abs(expected.depth - actual.depth) <= toleranceMm;
  const swapped = Math.abs(expected.width - actual.depth) <= toleranceMm &&
    Math.abs(expected.depth - actual.width) <= toleranceMm;
  return direct ? 'correct' : swapped ? 'swapped' : 'incorrect';
}

export function evaluateHomePlanZones(referenceSite, candidateZones, candidateSource = referenceSite?.source,
  { minIoU = 0.4, sizeToleranceMm = 75 } = {}) {
  const expected = referenceSite?.zones;
  if (!Array.isArray(expected) || !expected.length || !Array.isArray(candidateZones) ||
      !Number.isFinite(minIoU) || minIoU <= 0 || minIoU > 1 ||
      !Number.isFinite(sizeToleranceMm) || sizeToleranceMm < 0) {
    throw new TypeError('A reference plan, candidate zones and valid scoring thresholds are required');
  }
  const expectedBoxes = expected.map(zone => normalizedBox(zone, referenceSite.source));
  const candidateBoxes = candidateZones.map(zone => normalizedBox(zone, candidateSource));
  if (expectedBoxes.some(box => !box)) throw new TypeError('Reference zones must be inside their image');
  const invalidCandidateIndices = candidateBoxes.flatMap((box, index) => box ? [] : [index]);
  const pairings = [];
  for (let referenceIndex = 0; referenceIndex < expected.length; referenceIndex++) {
    for (let candidateIndex = 0; candidateIndex < candidateZones.length; candidateIndex++) {
      if (expected[referenceIndex].kind !== candidateZones[candidateIndex]?.kind) continue;
      const iou = boxIoU(expectedBoxes[referenceIndex], candidateBoxes[candidateIndex]);
      if (iou >= minIoU) pairings.push({ referenceIndex, candidateIndex, iou });
    }
  }
  pairings.sort((a, b) => b.iou - a.iou || a.referenceIndex - b.referenceIndex || a.candidateIndex - b.candidateIndex);
  const usedReference = new Set(), usedCandidate = new Set(), matches = [];
  for (const pair of pairings) {
    if (usedReference.has(pair.referenceIndex) || usedCandidate.has(pair.candidateIndex)) continue;
    usedReference.add(pair.referenceIndex); usedCandidate.add(pair.candidateIndex);
    matches.push({ ...pair, referenceId: expected[pair.referenceIndex].id || `reference-${pair.referenceIndex + 1}`,
      kind: expected[pair.referenceIndex].kind,
      iou: Number(pair.iou.toFixed(3)),
      printedSize: printedSizeResult(expected[pair.referenceIndex].dimensionsMm,
        candidateZones[pair.candidateIndex].dimensionsMm, sizeToleranceMm) });
  }
  matches.sort((a, b) => a.referenceIndex - b.referenceIndex);
  const missed = expected.flatMap((zone, index) => usedReference.has(index) ? [] : [{
    referenceIndex: index, referenceId: zone.id || `reference-${index + 1}`, kind: zone.kind,
    printedSize: validDimensions(zone.dimensionsMm) ? 'missing' : 'not_required' }]);
  const unexpected = candidateZones.flatMap((zone, index) => {
    if (usedCandidate.has(index)) return [];
    const nearest = expected.map((target, referenceIndex) => ({ referenceIndex,
      kind: target.kind, iou: boxIoU(expectedBoxes[referenceIndex], candidateBoxes[index]) }))
      .sort((a, b) => b.iou - a.iou)[0];
    return [{ candidateIndex: index, kind: zone?.kind || 'invalid',
      nearestExpectedKind: nearest?.kind || null, nearestIoU: Number((nearest?.iou || 0).toFixed(3)) }];
  });
  const expectedCount = kindSet => expected.filter(zone => kindSet.has(zone.kind)).length;
  const matchedCount = kindSet => matches.filter(match => kindSet.has(match.kind)).length;
  const printedExpectedCount = expected.filter(zone => validDimensions(zone.dimensionsMm)).length;
  const printedCorrectCount = matches.filter(match => ['correct', 'swapped'].includes(match.printedSize)).length;
  const unsupportedSizeCount = matches.filter(match => match.printedSize === 'unsupported').length +
    unexpected.filter(item => validDimensions(candidateZones[item.candidateIndex]?.dimensionsMm)).length;
  const ratio = (numerator, denominator) => denominator ? Number((numerator / denominator).toFixed(3)) : 1;
  const metrics = {
    expectedZones: expected.length, candidateZones: candidateZones.length,
    matchedZones: matches.length, precision: ratio(matches.length, candidateZones.length),
    recall: ratio(matches.length, expected.length),
    meanIoU: matches.length ? Number((matches.reduce((sum, match) => sum + match.iou, 0) / matches.length).toFixed(3)) : 0,
    placeableRecall: ratio(matchedCount(placeableKinds), expectedCount(placeableKinds)),
    fixedRecall: ratio(matchedCount(fixedKinds), expectedCount(fixedKinds)),
    printedSizeCorrect: printedCorrectCount, printedSizeExpected: printedExpectedCount,
    unsupportedSizeCount, invalidCandidateCount: invalidCandidateIndices.length,
  };
  return { referenceBasis: 'manually_annotated_schematic_boxes', metrics, matches, missed, unexpected,
    invalidCandidateIndices,
    samplePass: metrics.placeableRecall === 1 && metrics.fixedRecall === 1 &&
      metrics.precision >= 0.9 && metrics.meanIoU >= 0.65 &&
      metrics.printedSizeCorrect === metrics.printedSizeExpected &&
      metrics.unsupportedSizeCount === 0 && metrics.invalidCandidateCount === 0,
    releaseReady: false,
    caveat: 'One schematic floor plan cannot establish model accuracy or furniture installation fit.' };
}
