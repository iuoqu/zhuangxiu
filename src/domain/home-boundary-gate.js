// A visual box is not a room footprint until independent checks agree.
// Rejected boxes remain diagnostic evidence; only their semantic anchors reach
// the review UI so users are not asked to approve a visibly misplaced box.
export function gateHomeBoundaryDrafts(zones, geometryWarnings = []) {
  if (!Array.isArray(zones)) return { accepted: [], unresolved: [] };
  const accepted = [], unresolved = [];
  for (const [index, zone] of zones.entries()) {
    const reasons = [];
    if (!Array.isArray(zone?.boundaryPolygon) || zone.boundaryPolygon.length < 4)
      reasons.push('缺少一致的完整墙线轮廓');
    if (zone?.wallMatched !== true) reasons.push('未与本地墙线区域相符');
    if (zone?.classifierConfirmed !== true) reasons.push('局部复核未确认');
    if (zone?.segmentationRisk === true || zone?.boundaryConflict === true)
      reasons.push('边界冲突或裁图风险');
    if (Array.isArray(geometryWarnings[index]) && geometryWarnings[index].length)
      reasons.push('几何检查未通过');
    if (!reasons.length) { accepted.push(zone); continue; }
    unresolved.push({ id: zone.id, kind: zone.kind, x: zone.anchorX, y: zone.anchorY,
      evidence: zone.evidence, labelText: zone.labelText || '',
      boundaryIssue: reasons.join('；'),
      rejectedBox: { x: zone.x, y: zone.y, w: zone.w, h: zone.h } });
  }
  return { accepted, unresolved };
}

// Several unrelated rooms cannot all have their interior point in a tiny
// drawing-margin cluster. Vision coordinate collapse must not produce a stack
// of misleading red dots or trigger room-boundary refinement there.
export function collapsedHomeAnchorIds(anchors, inkBounds, width, height) {
  const collapsed = new Set();
  if (!Array.isArray(anchors) || ![width, height].every(Number.isFinite) ||
      width <= 0 || height <= 0) return collapsed;
  const radius = Math.min(width, height) * .11;
  const pad = Math.min(width, height) * .05;
  const box = inkBounds || { x: 0, y: 0, w: width, h: height };
  const atMargin = anchor => anchor.x < box.x + pad || anchor.y < box.y + pad ||
    anchor.x > box.x + box.w - pad || anchor.y > box.y + box.h - pad;
  const roomKinds = new Set(['bedroom', 'living', 'bathroom', 'dining', 'kitchen', 'study', 'mezzanine']);
  for (const anchor of anchors) {
    if (!atMargin(anchor)) continue;
    const nearby = anchors.filter(other => Math.hypot(other.x - anchor.x, other.y - anchor.y) <= radius);
    if (new Set(nearby.filter(other => roomKinds.has(other.kind)).map(other => other.kind)).size < 3)
      continue;
    for (const other of nearby) if (atMargin(other)) collapsed.add(other.id);
  }
  return collapsed;
}
