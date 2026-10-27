// Score exported, image-free AI diagnostics against the seven supplied plans.
// Boundary accuracy needs reviewed wall polygons and is deliberately not inferred here.
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { scoreBoundaryCase, summarizeBoundaries } = require('./score-home-boundaries.cjs');

const golden = JSON.parse(readFileSync(path.join(__dirname, '..', 'test-data', 'home-plan-golden.json'), 'utf8'));
const boundaryReference = JSON.parse(readFileSync(path.join(__dirname, '..', 'test-data', 'home-plan-boundaries.json'), 'utf8'));
const kinds = { bedroomCount: 'bedroom', livingCount: 'living', bathroomCount: 'bathroom' };
const name = file => path.basename(String(file || '')).replace(/^\d+-/, '');
const overlap = (a, b) => {
  const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return w * h / Math.min(a.w * a.h, b.w * b.h);
};
const stageSummary = (result, expected) => {
  const trace = result.stageTrace;
  if (!trace || !Array.isArray(trace.anchors) || !Array.isArray(trace.checks)) return null;
  const proposal = result.overviewProposal;
  return {
    overviewProposalMismatches: proposal ? Object.keys(kinds).filter(field =>
      expected[field] !== null && proposal[field] !== expected[field]) : null,
    anchorCandidates: trace.anchors.length,
    anchorRejected: Array.isArray(trace.rejectedAnchors) ? trace.rejectedAnchors.length : null,
    refinementBounded: Array.isArray(trace.refinement?.boundedIds) ? trace.refinement.boundedIds.length : null,
    refinementUnresolved: Array.isArray(trace.refinement?.unresolvedIds) ? trace.refinement.unresolvedIds.length : null,
    locallyWallMatched: trace.checks.filter(item => item.wallMatched === true).length,
    classifierConfirmed: trace.checks.filter(item => item.classifierConfirmed === true).length,
    gateAccepted: trace.checks.filter(item => item.gateAccepted === true).length,
  };
};

function scoreRecognition(exports, reference = golden, boundarySet = boundaryReference) {
  const byFile = new Map(exports.map(item => [name(item.file), item]));
  const boundaryByFile = new Map((boundarySet?.cases || []).map(item => [item.file, item]));
  let scoredFields = 0, correctFields = 0;
  const cases = reference.cases.map(item => {
    const result = byFile.get(item.file);
    const boundaries = boundaryByFile.has(item.file)
      ? scoreBoundaryCase(boundaryByFile.get(item.file), result) : { status: 'no_reference' };
    if (!result) return { file: item.file, status: 'missing_diagnostic', boundaries };
    const spaces = Array.isArray(result.spaces) ? result.spaces : [];
    const unresolved = Array.isArray(result.unresolved) ? result.unresolved : [];
    const anchors = [...spaces, ...unresolved];
    const counts = {}, mismatches = [];
    for (const [field, kind] of Object.entries(kinds)) {
      counts[field] = anchors.filter(anchor => anchor.kind === kind).length;
      if (item[field] === null) continue;
      scoredFields++;
      if (counts[field] === item[field]) correctFields++;
      else mismatches.push(`${field}: expected ${item[field]}, got ${counts[field]}`);
    }
    const invalidBoxes = spaces.filter(box => ![box.x, box.y, box.w, box.h, box.anchorX, box.anchorY,
      result.imageWidth, result.imageHeight].every(Number.isFinite) ||
      box.w <= 0 || box.h <= 0 || box.x < 0 || box.y < 0 ||
      box.x + box.w > result.imageWidth || box.y + box.h > result.imageHeight ||
      box.anchorX < box.x || box.anchorX >= box.x + box.w ||
      box.anchorY < box.y || box.anchorY >= box.y + box.h).length;
    let duplicateAnchors = 0, overlappingBoxes = 0;
    for (let i = 0; i < anchors.length; i++) for (let j = i + 1; j < anchors.length; j++) {
      if (anchors[i].kind === anchors[j].kind &&
          Math.hypot((anchors[i].anchorX ?? anchors[i].x) - (anchors[j].anchorX ?? anchors[j].x),
            (anchors[i].anchorY ?? anchors[i].y) - (anchors[j].anchorY ?? anchors[j].y)) <
            Math.min(result.imageWidth, result.imageHeight) * .035) duplicateAnchors++;
    }
    for (let i = 0; i < spaces.length; i++) for (let j = i + 1; j < spaces.length; j++)
      if (overlap(spaces[i], spaces[j]) > .35) overlappingBoxes++;
    return { file: item.file, status: mismatches.length ? 'count_mismatch' : 'count_match',
      generatedAt: result.generatedAt || null, stages: stageSummary(result, item),
      expected: Object.fromEntries(Object.keys(kinds).map(field => [field, item[field]])),
      detected: counts, unresolved: unresolved.length, invalidBoxes,
      duplicateAnchors, overlappingBoxes, mismatches, boundaries };
  });
  return { cases, complete: cases.every(item => item.status !== 'missing_diagnostic'),
    semanticCountAccuracy: scoredFields ? Number((correctFields / scoredFields).toFixed(3)) : null,
    ...summarizeBoundaries(cases.map(item => item.boundaries), reference.cases.length) };
}

if (require.main === module) {
  const files = process.argv.slice(2);
  if (!files.length) {
    process.stderr.write('Usage: node scripts/score-home-recognition.cjs diagnostic1.json ...\n');
    process.exitCode = 2;
  } else {
    const result = scoreRecognition(files.map(file => JSON.parse(readFileSync(file, 'utf8'))));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.complete || result.cases.some(item => item.status !== 'count_match' ||
      item.invalidBoxes || item.duplicateAnchors || item.overlappingBoxes)) process.exitCode = 1;
  }
}

module.exports = { scoreRecognition };
