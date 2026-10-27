// Geometry-only proposal for high-contrast, axis-aligned floor plans.
// It deliberately does not assign room names or approve furniture placement.
const index = (x, y, width) => y * width + x;

function extractLineMask(rgba, width, height, threshold, minRun) {
  const dark = new Uint8Array(width * height);
  for (let i = 0; i < dark.length; i++) {
    const offset = i * 4;
    dark[i] = rgba[offset] * .299 + rgba[offset + 1] * .587 + rgba[offset + 2] * .114 < threshold ? 1 : 0;
  }
  const lines = new Uint8Array(dark.length);
  for (let y = 0; y < height; y++) {
    let start = -1;
    for (let x = 0; x <= width; x++) {
      if (x < width && dark[index(x, y, width)]) { if (start < 0) start = x; continue; }
      if (start >= 0 && x - start >= minRun)
        for (let at = start; at < x; at++) lines[index(at, y, width)] = 1;
      start = -1;
    }
  }
  for (let x = 0; x < width; x++) {
    let start = -1;
    for (let y = 0; y <= height; y++) {
      if (y < height && dark[index(x, y, width)]) { if (start < 0) start = y; continue; }
      if (start >= 0 && y - start >= minRun)
        for (let at = start; at < y; at++) lines[index(x, at, width)] = 1;
      start = -1;
    }
  }
  return lines;
}

// A coarse envelope of long, dark architectural strokes. It only rejects
// proposals extending far into blank image margins; it is not a floor outline.
export function estimateHomePlanInkBounds(rgba, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 50 || height < 50 ||
      width > 1600 || height > 1600 || rgba?.length < width * height * 4) return null;
  const lines = extractLineMask(rgba, width, height, 145,
    Math.max(12, Math.round(Math.min(width, height) * .025)));
  const rows = new Uint32Array(height), columns = new Uint32Array(width);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!lines[index(x, y, width)]) continue;
    rows[y]++; columns[x]++;
  }
  const rowMin = Math.max(8, Math.round(width * .012));
  const colMin = Math.max(8, Math.round(height * .012));
  const activeRows = [...rows.keys()].filter(y => rows[y] >= rowMin);
  const activeColumns = [...columns.keys()].filter(x => columns[x] >= colMin);
  if (!activeRows.length || !activeColumns.length) return null;
  const x = activeColumns[0], y = activeRows[0];
  const w = activeColumns.at(-1) - x + 1, h = activeRows.at(-1) - y + 1;
  if (w < width * .35 || h < height * .35) return null;
  return { x, y, w, h };
}

export function filterHomeSpaceMarginBoxes(spaces, bounds, width, height) {
  if (!Array.isArray(spaces)) return { accepted: [], rejectedCount: 0 };
  if (!bounds || ![bounds.x, bounds.y, bounds.w, bounds.h, width, height].every(Number.isFinite))
    return { accepted: spaces, rejectedCount: 0 };
  const padX = width * .015, padY = height * .015;
  const left = Math.max(0, bounds.x - padX), top = Math.max(0, bounds.y - padY);
  const right = Math.min(width, bounds.x + bounds.w + padX);
  const bottom = Math.min(height, bounds.y + bounds.h + padY);
  const accepted = spaces.filter(box => {
    if (![box?.x, box?.y, box?.w, box?.h].every(Number.isFinite) || box.w <= 0 || box.h <= 0) return false;
    const overflowX = Math.max(0, left - box.x, box.x + box.w - right);
    const overflowY = Math.max(0, top - box.y, box.y + box.h - bottom);
    return overflowX <= box.w * .12 && overflowY <= box.h * .12 &&
      box.x + box.w / 2 >= left && box.x + box.w / 2 <= right &&
      box.y + box.h / 2 >= top && box.y + box.h / 2 <= bottom;
  });
  return { accepted, rejectedCount: spaces.length - accepted.length };
}

function dilate(mask, width, height, radius) {
  const horizontal = new Uint8Array(mask.length);
  const result = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    let count = 0;
    for (let x = 0; x < width; x++) {
      if (x + radius < width) count += mask[index(x + radius, y, width)];
      if (x - radius - 1 >= 0) count -= mask[index(x - radius - 1, y, width)];
      horizontal[index(x, y, width)] = count > 0 ? 1 : 0;
    }
  }
  for (let x = 0; x < width; x++) {
    let count = 0;
    for (let y = 0; y < height; y++) {
      if (y + radius < height) count += horizontal[index(x, y + radius, width)];
      if (y - radius - 1 >= 0) count -= horizontal[index(x, y - radius - 1, width)];
      result[index(x, y, width)] = count > 0 ? 1 : 0;
    }
  }
  return result;
}

function bridgeGaps(mask, width, height, maxGap, minArm) {
  // A door/window gap is only closed when strong collinear strokes exist on both sides.
  const result = mask.slice();
  for (let axis = 0; axis < 2; axis++) {
    const outer = axis === 0 ? height : width;
    const inner = axis === 0 ? width : height;
    const point = (along, cross) => axis === 0 ? index(along, cross, width) : index(cross, along, width);
    for (let cross = 0; cross < outer; cross++) {
      let at = 0;
      while (at < inner) {
        if (mask[point(at, cross)]) { at++; continue; }
        const start = at;
        while (at < inner && !mask[point(at, cross)]) at++;
        if (start === 0 || at === inner || at - start > maxGap) continue;
        let left = 0, right = 0;
        for (let k = start - 1; k >= 0 && mask[point(k, cross)]; k--) left++;
        for (let k = at; k < inner && mask[point(k, cross)]; k++) right++;
        if (left >= minArm && right >= minArm)
          for (let k = start; k < at; k++) result[point(k, cross)] = 1;
      }
    }
  }
  return result;
}

function components(mask, width, height, minArea, includeEdge = false, includeMasks = false) {
  const labels = new Int32Array(mask.length);
  const queue = new Int32Array(mask.length);
  const found = [];
  let componentId = 0;
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] || labels[start]) continue;
    let head = 0, tail = 1, area = 0;
    let minX = width, minY = height, maxX = 0, maxY = 0, touchesEdge = false;
    componentId++;
    queue[0] = start; labels[start] = componentId;
    while (head < tail) {
      const at = queue[head++], x = at % width, y = (at - x) / width;
      area++; minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      touchesEdge ||= x === 0 || y === 0 || x === width - 1 || y === height - 1;
      if (x > 0 && !mask[at - 1] && !labels[at - 1]) { labels[at - 1] = componentId; queue[tail++] = at - 1; }
      if (x + 1 < width && !mask[at + 1] && !labels[at + 1]) { labels[at + 1] = componentId; queue[tail++] = at + 1; }
      if (y > 0 && !mask[at - width] && !labels[at - width]) { labels[at - width] = componentId; queue[tail++] = at - width; }
      if (y + 1 < height && !mask[at + width] && !labels[at + width]) { labels[at + width] = componentId; queue[tail++] = at + width; }
    }
    if ((!touchesEdge || includeEdge) && area >= minArea) {
      const region = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1,
        area, touchesEdge, fillRatio: Number((area / ((maxX - minX + 1) * (maxY - minY + 1))).toFixed(2)) };
      if (includeMasks) {
        region.spans = [];
        for (let y = minY; y <= maxY; y++) {
          let x = minX;
          while (x <= maxX) {
            if (labels[index(x, y, width)] !== componentId) { x++; continue; }
            const from = x;
            while (x <= maxX && labels[index(x, y, width)] === componentId) x++;
            region.spans.push([y, from, x]);
          }
        }
      }
      found.push(region);
    }
  }
  return found.sort((a, b) => b.area - a.area);
}

export function segmentHomePlanRooms(rgba, width, height, options = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 50 || height < 50 ||
      width > 1600 || height > 1600 || rgba?.length < width * height * 4) return [];
  const scale = Math.min(width, height);
  const lines = extractLineMask(rgba, width, height, options.threshold ?? 145,
    options.minRun ?? Math.max(12, Math.round(scale * .025)));
  const thick = dilate(lines, width, height, options.wallRadius ?? Math.max(2, Math.round(scale * .003)));
  const blocked = bridgeGaps(thick, width, height,
    options.maxGap ?? Math.max(12, Math.round(scale * .035)),
    options.minArm ?? Math.max(16, Math.round(scale * .025)));
  return components(blocked, width, height,
    options.minArea ?? Math.max(500, Math.round(width * height * .003)),
    options.includeEdge === true, options.includeMasks === true);
}

const overlap = (a, b) => {
  const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return w * h / (a.w * a.h + b.w * b.h - w * h || 1);
};

// Only regions repeated at multiple wall thicknesses are returned. This is a
// stability check, not a claim that a region is a usable floor or a room.
export function proposeHomeRoomRegions(rgba, width, height) {
  const scale = Math.min(width, height);
  // Dark-only passes preserve thin fixtures; mid-tone passes recover grey wall
  // strokes that are lost in compressed screenshots. Keep both until review.
  const variants = [
    { radius: .009, threshold: 145 },
    { radius: .014, threshold: 145 },
    { radius: .018, threshold: 145 },
    { radius: .009, threshold: 160 },
    { radius: .009, threshold: 170 },
    { radius: .009, threshold: 180 },
  ];
  const groups = [];
  const collect = (settingsList, offset = 0) => {
    for (const [index, settings] of settingsList.entries()) {
      const variant = index + offset;
      const regions = segmentHomePlanRooms(rgba, width, height, {
        threshold: settings.threshold,
        wallRadius: Math.max(2, Math.round(scale * settings.radius)),
        maxGap: Math.max(12, Math.round(scale * .14)),
        minArm: Math.max(8, Math.round(scale * .01)),
        minArea: Math.max(500, Math.round(width * height * .008)),
        includeMasks: true,
      });
      for (const region of regions) {
        if (region.w * region.h > width * height * .3 || region.fillRatio < .32) continue;
        const group = groups.find(item => !item.variants.has(variant) &&
          overlap(item.best, region) >= .62);
        if (group) {
          group.variants.add(variant);
          group.members.push(region);
          if (region.area > group.best.area) group.best = region;
        } else groups.push({ best: region, members: [region], variants: new Set([variant]) });
      }
    }
  };
  collect(variants);
  // Pale architectural drawings need a different ink threshold. Only try it
  // when ordinary dark strokes yielded no stable region and no usable envelope.
  if (!groups.some(group => group.variants.size >= 2) && !estimateHomePlanInkBounds(rgba, width, height)) {
    collect([
      { radius: .012, threshold: 195 }, { radius: .014, threshold: 195 },
      { radius: .009, threshold: 200 }, { radius: .012, threshold: 200 },
      { radius: .009, threshold: 205 }, { radius: .012, threshold: 205 },
      { radius: .009, threshold: 210 }, { radius: .012, threshold: 210 },
    ], variants.length);
  }
  return groups.filter(group => group.variants.size >= 2).map(group => {
    const region = group.members.reduce((winner, candidate) => {
      const support = group.members.reduce((sum, other) => sum + overlap(candidate, other), 0);
      return !winner || support > winner.support + .001 ||
        (Math.abs(support - winner.support) <= .001 && candidate.area < winner.region.area)
        ? { region: candidate, support } : winner;
    }, null).region;
    return { ...region, stableRuns: group.variants.size, source: 'wall-components',
      contrastFallback: [...group.variants].some(variant => variant >= variants.length) };
  }).sort((a, b) => b.area - a.area);
}

// Supplement missing room candidates with stable line-enclosed regions. These
// are geometry-only crops for AI classification, never approved room zones.
export function selectHomeRoomProposalCrops(regions, identifiedZones = [], limit = 12) {
  if (!Array.isArray(regions) || !Array.isArray(identifiedZones)) return [];
  const max = Number.isInteger(limit) ? Math.max(0, Math.min(12, limit)) : 12;
  if (!max) return [];
  const overlapOfSmaller = (a, b) => {
    const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return w * h / Math.min(a.w * a.h, b.w * b.h);
  };
  const selected = [];
  for (const region of regions) {
    if (![region?.x, region?.y, region?.w, region?.h].every(Number.isInteger) ||
        region.w < 30 || region.h < 30 || region.stableRuns < 2 ||
        (Number.isFinite(region.fillRatio) && region.fillRatio < .68)) continue;
    const box = { x: region.x, y: region.y, w: region.w, h: region.h };
    if (identifiedZones.some(zone => overlapOfSmaller(box, zone) > .65) ||
        selected.some(zone => overlapOfSmaller(box, zone) > .75)) continue;
    selected.push(box);
    if (selected.length >= max) break;
  }
  return selected.map((box, index) => ({ id: index + 1, ...box }));
}

// Ephemeral structural draft in the exact pixel space of the uploaded image.
// No room names, dimensions, or furniture approvals are inferred here.
export function buildHomePlanStructure(rgba, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 50 || height < 50 ||
      width > 1600 || height > 1600 || rgba?.length < width * height * 4) return null;
  const inkBounds = estimateHomePlanInkBounds(rgba, width, height);
  const regions = proposeHomeRoomRegions(rgba, width, height);
  return { version: 1, coordinateSpace: 'uploaded-image-pixels', widthPx: width, heightPx: height,
    inkBounds, regions, contrastFallback: regions.some(region => region.contrastFallback),
    candidates: selectHomeRoomProposalCrops(regions) };
}

// A structural crop and a whole-plan proposal can describe the same place.
// Merge only near-equivalent boxes of the same use; a broad box containing a
// small crop may instead be a merged room or a single piece of furniture.
// Those ambiguous cases must remain visible for review.
export function reconcileHomeSpaceSuggestions(suggestions) {
  if (!Array.isArray(suggestions)) return [];
  const result = [];
  for (const candidate of suggestions) {
    if (!candidate || ![candidate.x, candidate.y, candidate.w, candidate.h]
      .every(Number.isFinite) || candidate.w <= 0 || candidate.h <= 0) continue;
    const match = result.findIndex(existing => {
      if (candidate.kind === 'unknown' || candidate.kind !== existing.kind) return false;
      const areaA = candidate.w * candidate.h, areaB = existing.w * existing.h;
      if (Math.max(areaA, areaB) / Math.min(areaA, areaB) > 1.8) return false;
      const width = Math.max(0, Math.min(candidate.x + candidate.w, existing.x + existing.w) -
        Math.max(candidate.x, existing.x));
      const height = Math.max(0, Math.min(candidate.y + candidate.h, existing.y + existing.h) -
        Math.max(candidate.y, existing.y));
      return width * height / Math.min(areaA, areaB) >= .8;
    });
    if (match < 0) { result.push(candidate); continue; }
    const existing = result[match];
    const existingArea = existing.w * existing.h, candidateArea = candidate.w * candidate.h;
    const chosen = candidateArea > existingArea * 1.15 ? candidate :
      existingArea > candidateArea * 1.15 ? existing :
      candidate.segmentationRisk && !existing.segmentationRisk ? candidate : existing;
    result[match] = { ...chosen,
      segmentationRisk: existing.segmentationRisk === true || candidate.segmentationRisk === true };
  }
  return result;
}

function sharedMaskFraction(a, b) {
  const left = a.spans, right = b.spans;
  if (!left?.length || !right?.length) {
    const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return w * h / Math.min(a.w * a.h, b.w * b.h);
  }
  let i = 0, j = 0, intersection = 0;
  while (i < left.length && j < right.length) {
    const [ay, ax0, ax1] = left[i], [by, bx0, bx1] = right[j];
    if (ay < by) { i++; continue; }
    if (by < ay) { j++; continue; }
    intersection += Math.max(0, Math.min(ax1, bx1) - Math.max(ax0, bx0));
    if (ax1 <= bx1) i++;
    if (bx1 <= ax1) j++;
  }
  return intersection / Math.min(a.area, b.area);
}

// OCR anchors often land on dark glyph pixels rather than white floor. Accept
// nearby free-space pixels only within a small image-scale radius; geometry,
// use classification and box agreement remain separate requirements.
export function homeRegionNearAnchor(region, x, y, radius) {
  if (!Array.isArray(region?.spans) || ![x, y, radius].every(Number.isFinite) || radius < 0)
    return false;
  return region.spans.some(([row, left, right]) => {
    const dy = Math.abs(row - y);
    if (dy > radius) return false;
    const dx = x < left ? left - x : x >= right ? x - right + 1 : 0;
    return dx * dx + dy * dy <= radius * radius;
  });
}

// One-to-one matching prevents a coarse merged component from being offered as
// the boundary of multiple AI room candidates. No match is preferable to a
// duplicate or a weak match; this does not verify room use or wall accuracy.
export function matchHomeRoomRegions(zones, regions) {
  const assignments = Array.from({ length: zones.length }, () => null);
  const options = [];
  for (const [zoneIndex, zone] of zones.entries()) {
    if (![zone?.x, zone?.y, zone?.w, zone?.h].every(Number.isFinite) || zone.w <= 0 || zone.h <= 0) continue;
    const zoneArea = zone.w * zone.h;
    for (const [regionIndex, region] of regions.entries()) {
      const w = Math.max(0, Math.min(zone.x + zone.w, region.x + region.w) - Math.max(zone.x, region.x));
      const h = Math.max(0, Math.min(zone.y + zone.h, region.y + region.h) - Math.max(zone.y, region.y));
      const intersection = w * h, regionArea = region.w * region.h;
      const iou = intersection / (zoneArea + regionArea - intersection || 1);
      const coverage = intersection / zoneArea;
      if (iou < .32 || coverage < .5 || regionArea > zoneArea * 2.5) continue;
      options.push({ zoneIndex, regionIndex, iou, coverage });
    }
  }
  options.sort((a, b) => b.iou - a.iou || b.coverage - a.coverage);
  const used = new Set();
  for (const option of options) {
    if (assignments[option.zoneIndex] || used.has(option.regionIndex)) continue;
    const region = regions[option.regionIndex];
    if ([...used].some(index => sharedMaskFraction(region, regions[index]) >= .8)) continue;
    assignments[option.zoneIndex] = { region, iou: option.iou, coverage: option.coverage };
    used.add(option.regionIndex);
  }
  return assignments;
}
