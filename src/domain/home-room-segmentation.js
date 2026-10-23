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
  for (const [variant, settings] of variants.entries()) {
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
  return groups.filter(group => group.variants.size >= 2).map(group => {
    const region = group.members.reduce((winner, candidate) => {
      const support = group.members.reduce((sum, other) => sum + overlap(candidate, other), 0);
      return !winner || support > winner.support + .001 ||
        (Math.abs(support - winner.support) <= .001 && candidate.area < winner.region.area)
        ? { region: candidate, support } : winner;
    }, null).region;
    return { ...region, stableRuns: group.variants.size, source: 'wall-components' };
  }).sort((a, b) => b.area - a.area);
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
