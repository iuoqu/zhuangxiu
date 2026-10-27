// Visual room-outline evaluation for exported AI diagnostics. Draft references
// are intentionally never included in a published boundary-accuracy score.
const round = value => Number(value.toFixed(3));

function polygonFor(shape, width, height) {
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) return null;
  const raw = shape?.boundaryPolygon || shape?.polygon || (shape &&
    [shape.x, shape.y, shape.w, shape.h].every(Number.isFinite) && shape.w > 0 && shape.h > 0
    ? [[shape.x, shape.y], [shape.x + shape.w, shape.y],
      [shape.x + shape.w, shape.y + shape.h], [shape.x, shape.y + shape.h]] : null);
  if (!Array.isArray(raw) || raw.length < 3 || raw.length > 32) return null;
  const points = raw.map(point => Array.isArray(point) ? point : [point?.x, point?.y]);
  if (points.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y) ||
      x < 0 || y < 0 || x > width || y > height)) return null;
  const normalized = points.map(([x, y]) => [x / width, y / height]);
  const area = Math.abs(normalized.reduce((sum, point, index) => {
    const next = normalized[(index + 1) % normalized.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0)) / 2;
  return area > 0.00001 ? normalized : null;
}

function contains(polygon, x, y) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a[1] > y) !== (b[1] > y) &&
      x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

// Sample each pair's union bounds so a tiny bathroom receives enough samples.
// This is approximate visual IoU, not a surveyed floor-area measurement.
function polygonIoU(a, b, resolution = 128) {
  if (!a || !b) return 0;
  const points = [...a, ...b];
  const x0 = Math.min(...points.map(point => point[0]));
  const x1 = Math.max(...points.map(point => point[0]));
  const y0 = Math.min(...points.map(point => point[1]));
  const y1 = Math.max(...points.map(point => point[1]));
  if (x0 === x1 || y0 === y1) return 0;
  let intersection = 0, union = 0;
  for (let row = 0; row < resolution; row++) {
    const y = y0 + (row + 0.5) * (y1 - y0) / resolution;
    for (let col = 0; col < resolution; col++) {
      const x = x0 + (col + 0.5) * (x1 - x0) / resolution;
      const inA = contains(a, x, y), inB = contains(b, x, y);
      if (inA || inB) union++;
      if (inA && inB) intersection++;
    }
  }
  return union ? intersection / union : 0;
}

function scoreBoundaryCase(reference, diagnostic, minIoU = 0.5) {
  if (!reference || !['draft', 'reviewed'].includes(reference.reviewStatus) ||
      !['partial', 'complete'].includes(reference.scope) ||
      !Number.isFinite(minIoU) || minIoU <= 0 || minIoU > 1)
    throw new TypeError('Valid boundary reference and IoU threshold are required');
  if (reference.reviewStatus === 'reviewed' && reference.scope !== 'complete')
    throw new TypeError(`${reference.file}: reviewed boundary reference must cover the complete plan`);
  const regions = Array.isArray(reference.regions) ? reference.regions : [];
  if (new Set(regions.map(region => region.id)).size !== regions.length)
    throw new TypeError(`${reference.file}: duplicate reference room ids`);
  const expected = regions.map(region => polygonFor(region, reference.width, reference.height));
  if (expected.some(polygon => !polygon)) throw new TypeError(`${reference.file}: invalid reference polygon`);
  if (!diagnostic) return { status: 'missing_diagnostic', coverage: reference.scope,
    reviewStatus: reference.reviewStatus, referenceRegions: regions.length };
  const candidates = Array.isArray(diagnostic.spaces) ? diagnostic.spaces : [];
  const actual = candidates.map(candidate => polygonFor(candidate,
    diagnostic.imageWidth, diagnostic.imageHeight));
  const pairs = [];
  for (let i = 0; i < regions.length; i++) for (let j = 0; j < candidates.length; j++) {
    if (regions[i].kind !== candidates[j]?.kind || !actual[j]) continue;
    pairs.push({ referenceIndex: i, candidateIndex: j, iou: polygonIoU(expected[i], actual[j]) });
  }
  pairs.sort((a, b) => b.iou - a.iou || a.referenceIndex - b.referenceIndex ||
    a.candidateIndex - b.candidateIndex);
  const usedExpected = new Set(), usedActual = new Set(), matches = [];
  for (const pair of pairs) {
    if (pair.iou < minIoU || usedExpected.has(pair.referenceIndex) ||
        usedActual.has(pair.candidateIndex)) continue;
    usedExpected.add(pair.referenceIndex); usedActual.add(pair.candidateIndex);
    matches.push({ id: regions[pair.referenceIndex].id, kind: regions[pair.referenceIndex].kind,
      candidateIndex: pair.candidateIndex, iou: round(pair.iou) });
  }
  const complete = reference.reviewStatus === 'reviewed' && reference.scope === 'complete';
  return { status: complete ? 'reviewed' : 'draft_not_ground_truth', coverage: reference.scope,
    reviewStatus: reference.reviewStatus, referenceRegions: regions.length,
    candidateRegions: candidates.length, matchedRegions: matches.length,
    recall: regions.length ? round(matches.length / regions.length) : null,
    precision: complete ? round(candidates.length ? matches.length / candidates.length :
      regions.length ? 0 : 1) : null,
    meanIoU: matches.length ? round(matches.reduce((sum, item) => sum + item.iou, 0) / matches.length) : null,
    matches, missed: regions.filter((_, index) => !usedExpected.has(index)).map(region => region.id),
    unmatchedCandidates: candidates.flatMap((_, index) => usedActual.has(index) ? [] : [index]),
    invalidCandidateIndices: actual.flatMap((polygon, index) => polygon ? [] : [index]),
    caveat: complete ? 'Reviewed visual plan reference; not surveyed dimensions or furniture fit.' :
      'Partial assistant draft only. Recall is provisional; unlabelled rooms may exist.' };
}

function summarizeBoundaries(cases, expectedCaseCount) {
  const reviewed = cases.filter(item => item.status === 'reviewed');
  const totals = reviewed.reduce((sum, item) => ({ expected: sum.expected + item.referenceRegions,
    candidates: sum.candidates + item.candidateRegions,
    matched: sum.matched + item.matchedRegions }), { expected: 0, candidates: 0, matched: 0 });
  const boundaryComplete = reviewed.length === expectedCaseCount;
  return {
    boundaryReferenceCoverage: `${reviewed.length}/${expectedCaseCount} fully reviewed cases`,
    reviewedBoundaryMetrics: reviewed.length ? {
      precision: totals.candidates ? round(totals.matched / totals.candidates) : 0,
      recall: totals.expected ? round(totals.matched / totals.expected) : null,
      meanIoU: totals.matched ? round(reviewed.flatMap(item => item.matches)
        .reduce((sum, match) => sum + match.iou, 0) / totals.matched) : null,
    } : null,
    boundaryAccuracy: boundaryComplete && totals.expected
      ? round(2 * totals.matched / (totals.expected + totals.candidates)) : null,
    boundaryCaveat: boundaryComplete ? 'Reviewed visual boundary F1; not surveyed dimensions or furniture fit.' :
      'Boundary accuracy is withheld until every reference plan is complete and independently reviewed.',
  };
}

module.exports = { scoreBoundaryCase, summarizeBoundaries, polygonFor, polygonIoU, contains };
