// Conservative structural checks. These are review prompts, not wall detection.
export function homeZoneGeometryWarnings(zones, source) {
  const width = source?.widthPx, height = source?.heightPx;
  if (!(width > 0 && height > 0)) return zones.map(() => ['图纸尺寸未知，无法校验边界']);
  const warnings = zones.map(() => []);
  for (const [index, zone] of zones.entries()) {
    if (!zone?.selected || zone.kind === 'unknown') continue;
    const area = zone.w * zone.h;
    if (area > width * height * .36)
      warnings[index].push('框占整张图超过 36%，可能跨越多个房间');
    if (zone.x <= width * .012 || zone.y <= height * .012 ||
        zone.x + zone.w >= width * .988 || zone.y + zone.h >= height * .988)
      warnings[index].push('框贴近图片边缘，可能包含图外空白或漏掉墙体');
    if (Math.max(zone.w / zone.h, zone.h / zone.w) > 4)
      warnings[index].push('框过于狭长，请确认不是走廊或误框');
    for (let otherIndex = 0; otherIndex < index; otherIndex++) {
      const other = zones[otherIndex];
      if (!other?.selected || other.kind === 'unknown') continue;
      const overlapWidth = Math.max(0, Math.min(zone.x + zone.w, other.x + other.w) - Math.max(zone.x, other.x));
      const overlapHeight = Math.max(0, Math.min(zone.y + zone.h, other.y + other.h) - Math.max(zone.y, other.y));
      if (overlapWidth * overlapHeight <= .18 * Math.min(area, other.w * other.h)) continue;
      warnings[index].push(`与建议 ${otherIndex + 1} 明显重叠`);
      warnings[otherIndex].push(`与建议 ${index + 1} 明显重叠`);
    }
  }
  return warnings;
}
