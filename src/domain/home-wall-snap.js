// A conservative aid for high-contrast, mostly axis-aligned raster plans.
// Dark lines can also be furniture or text: never treat a snap as verified walls.
export function snapHomeZoneToLines(rgba, imageWidth, imageHeight, box) {
  if (!(rgba?.length >= imageWidth * imageHeight * 4) ||
      ![imageWidth, imageHeight, box?.x, box?.y, box?.w, box?.h].every(Number.isFinite) ||
      box.w < 35 || box.h < 35) return null;
  const dark = (x, y) => {
    if (x < 0 || y < 0 || x >= imageWidth || y >= imageHeight) return false;
    const offset = (Math.round(y) * imageWidth + Math.round(x)) * 4;
    return (rgba[offset] * .299 + rgba[offset + 1] * .587 + rgba[offset + 2] * .114) < 120;
  };
  const lineScore = (axis, at, from, to) => {
    const inset = Math.min(12, Math.max(3, Math.floor((to - from) * .07)));
    let darkSamples = 0, samples = 0, streak = 0, longest = 0;
    for (let along = Math.ceil(from + inset); along <= Math.floor(to - inset); along += 2) {
      let hit = false;
      for (let across = -2; across <= 2 && !hit; across++)
        hit = axis === 'vertical' ? dark(at + across, along) : dark(along, at + across);
      samples++;
      darkSamples += Number(hit);
      streak = hit ? streak + 1 : 0;
      longest = Math.max(longest, streak);
    }
    return samples < 10 || longest < samples * .18 ? 0 : darkSamples / samples;
  };
  const nearestLine = (axis, expected, from, to, radius) => {
    let best = null;
    const candidates = [];
    const limit = axis === 'vertical' ? imageWidth : imageHeight;
    for (let at = Math.max(2, Math.round(expected - radius));
      at <= Math.min(limit - 3, Math.round(expected + radius)); at++) {
      const score = lineScore(axis, at, from, to);
      if (score < .72) continue;
      const rank = score - .12 * Math.abs(at - expected) / radius;
      const candidate = { at, score, rank };
      candidates.push(candidate);
      if (!best || rank > best.rank) best = candidate;
    }
    if (!best) return null;
    // The sample band makes every pixel of a thick wall score similarly. Use its centre.
    const sameStroke = candidates.filter(item => item.score >= best.score - .03 &&
      Math.abs(item.at - best.at) <= 8);
    return { ...best, at: Math.round(sameStroke.reduce((sum, item) => sum + item.at, 0) / sameStroke.length) };
  };
  const xRadius = Math.max(12, Math.min(75, Math.round(box.w * .24)));
  const yRadius = Math.max(12, Math.min(75, Math.round(box.h * .24)));
  const left = nearestLine('vertical', box.x, box.y, box.y + box.h, xRadius);
  const right = nearestLine('vertical', box.x + box.w, box.y, box.y + box.h, xRadius);
  const top = nearestLine('horizontal', box.y, box.x, box.x + box.w, yRadius);
  const bottom = nearestLine('horizontal', box.y + box.h, box.x, box.x + box.w, yRadius);
  if (![left, right, top, bottom].every(Boolean)) return null;
  const x = left.at, y = top.at, w = right.at - x, h = bottom.at - y;
  if (w < 30 || h < 30 || w * h < box.w * box.h * .5 || w * h > box.w * box.h * 1.7) return null;
  // A long dark line through the middle is often a partition wall. Do not snap across it.
  for (const fraction of [.3, .5, .7]) {
    const vertical = Math.round(x + w * fraction);
    const horizontal = Math.round(y + h * fraction);
    if (lineScore('vertical', vertical, y, y + h) > .8 ||
        lineScore('horizontal', horizontal, x, x + w) > .8) return null;
  }
  return { x, y, w, h, minEdgeScore: Number(Math.min(left.score, right.score, top.score, bottom.score).toFixed(2)) };
}
