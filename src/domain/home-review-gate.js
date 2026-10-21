// A local, non-authoritative review checklist. It cannot approve procurement or installation.
const reviewValidSize = size => size && [size.width, size.depth].every(value =>
  Number.isFinite(value) && value >= 100 && value <= 100000);
const reviewOverlaps = (a, b) => a.xMm < b.xMm + b.widthMm && a.xMm + a.widthMm > b.xMm &&
  a.yMm < b.yMm + b.depthMm && a.yMm + a.depthMm > b.yMm;

function reviewFingerprint(value) {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
const sourceFingerprints = new WeakMap();
function reviewSourceFingerprint(source) {
  if (!source || typeof source !== 'object') return reviewFingerprint(null);
  if (!sourceFingerprints.has(source)) sourceFingerprints.set(source,
    reviewFingerprint([source.kind, source.fileName, source.widthPx, source.heightPx, source.dataUrl]));
  return sourceFingerprints.get(source);
}

export function assessHomeReviewGate(project, assessment, site, layout, fitScreen) {
  const placements = layout?.placements || [];
  const placementById = new Map(placements.map(item => [item.instanceId, item]));
  const zones = site?.zones || [];
  const zoneById = new Map(zones.map(zone => [zone.id, zone]));
  const sourceMark = reviewSourceFingerprint(site?.source);
  const siteMark = reviewFingerprint([sourceMark, zones.map(zone => [zone.id, zone.kind, zone.x, zone.y,
    zone.w, zone.h, zone.dimensionsMm, zone.visualSizeMm, zone.reviewStatus,
    zone.dimensionSource, zone.dimensionsLabel])]);
  const rows = [];
  for (const line of assessment.lines) {
    if (line.key === 'queen_mattress') continue; // Shares the corresponding bed-frame footprint.
    for (let index = 0; index < line.quantity; index++) {
      const instanceId = `${line.key}-${index + 1}`;
      const label = `${line.label}${line.quantity > 1 ? ` ${index + 1}` : ''}`;
      const placed = placementById.get(instanceId);
      const zone = zoneById.get(placed?.zoneId);
      let status, reason;
      if (!placed || !zone) {
        status = 'unplaced'; reason = '尚未绘出占位；请核对房间识别、分配和商品外廓。';
      } else if (placed.xMm < 0 || placed.yMm < 0 ||
          placed.xMm + placed.widthMm > (zone.dimensionsMm || zone.visualSizeMm)?.width ||
          placed.yMm + placed.depthMm > (zone.dimensionsMm || zone.visualSizeMm)?.depth ||
          placements.some(other => other !== placed && other.zoneId === placed.zoneId && reviewOverlaps(placed, other))) {
        status = 'conflict'; reason = '当前占位越界或与同房间家具重叠。';
      } else if (!reviewValidSize(zone.dimensionsMm) || !reviewValidSize(line.dimensionsMm)) {
        status = 'missing_size'; reason = !reviewValidSize(zone.dimensionsMm)
          ? '房间缺可核对的长宽；图上的视觉比例不等于实测尺寸。'
          : '商品缺完整外廓长宽；套装须分件核对。';
      } else {
        status = 'pending_review';
        reason = '图上位置待人工核对；确认位置不代表门窗、通道或采购适配通过。';
      }
      const placementFingerprint = placed && zone ? reviewFingerprint([project.packageId, project.apartmentType,
        siteMark, instanceId, placed.zoneId, placed.xMm, placed.yMm, placed.widthMm, placed.depthMm,
        line.sku, line.source, line.simulated, line.dimensionsMm, line.visualFootprintMm]) : null;
      if (status === 'pending_review' &&
          project.placementReviews?.[instanceId]?.fingerprint === placementFingerprint) {
        status = 'position_reviewed'; reason = '图上位置已在此项目标记复核；其他交付条件仍须单独核对。';
      }
      rows.push({ instanceId, label, marker: placed?.marker || '', status, reason,
        fingerprint: placementFingerprint, reviewable: status === 'pending_review' });
    }
  }

  const count = status => rows.filter(row => row.status === status).length;
  const blockers = [];
  if (!site?.source || site.source.kind !== 'image') blockers.push('缺可处理的图片户型图');
  if (rows.some(row => row.status === 'unplaced')) blockers.push(`${count('unplaced')} 项家具尚未绘出`);
  if (rows.some(row => row.status === 'conflict')) blockers.push(`${count('conflict')} 项家具占位冲突`);
  if (rows.some(row => row.status === 'missing_size')) blockers.push(`${count('missing_size')} 项缺可核对的房间或商品尺寸`);
  if (rows.some(row => row.status === 'pending_review')) blockers.push(`${count('pending_review')} 项图上位置待人工复核`);
  const draftZones = zones.filter(zone => zone.reviewStatus === 'draft').length;
  if (draftZones) blockers.push(`${draftZones} 处 AI 房间区域尚未核对`);
  if (assessment.simulatedCount) blockers.push(`${assessment.simulatedCount} 行仍为模拟 SKU`);
  const incompleteRealCount = assessment.lines.filter(line => !line.simulated && !line.complete).length;
  if (incompleteRealCount) blockers.push(`${incompleteRealCount} 行真实商品资料不齐`);
  if (assessment.budgetStatus === 'over_budget') blockers.push('真实商品金额超出套餐预算');
  if (fitScreen?.conflictCount) blockers.push(`尺寸初筛仍有 ${fitScreen.conflictCount} 处冲突`);
  if (fitScreen?.pendingCount) blockers.push(`尺寸初筛仍有 ${fitScreen.pendingCount} 件或条件待补`);
  blockers.push('尚无具名审核、门窗通道与搬运核验记录，以及正式交付批准流程');
  return { canDeliver: false, status: 'draft_only', rows, blockers,
    placedCount: placements.length, reviewableCount: rows.length,
    reviewedCount: count('position_reviewed'), pendingCount: rows.length - count('position_reviewed') };
}
