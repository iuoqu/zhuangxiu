import { buildHomeConceptLayout } from './home-concept-layout.js';

// An outline-only screen. A clear result is never an installation or circulation approval.
const fitValidSize = size => size && [size.width, size.depth].every(value =>
  Number.isFinite(value) && value >= 100 && value <= 100000);
const roomKind = room => room.startsWith('客厅') ? 'living' :
  room.startsWith('餐厅') ? 'dining' : room.startsWith('卧室') ? 'bedroom' : null;
const overlaps = (a, b) => a.xMm < b.xMm + b.widthMm && a.xMm + a.widthMm > b.xMm &&
  a.yMm < b.yMm + b.depthMm && a.yMm + a.depthMm > b.yMm;

export function screenHomeFurnitureFit(lines, site, assignments = {}, conceptLayout = null) {
  const layout = conceptLayout || buildHomeConceptLayout(lines, site, assignments);
  const findings = [];
  const add = (code, severity, label, reason, zoneId = null) =>
    findings.push({ code, severity, label, reason, ...(zoneId ? { zoneId } : {}) });
  const zones = site?.source?.kind === 'image' && Array.isArray(site.zones)
    ? site.zones.filter(zone => ['living', 'dining', 'bedroom', 'mezzanine'].includes(zone.kind)) : [];
  const placements = new Map(layout.placements.map(item => [item.instanceId, item]));
  let checkedCount = 0;
  let pendingCount = 0;

  for (const zone of zones) if (fitValidSize(zone.dimensionsMm) &&
      (zone.reviewStatus === 'draft' || zone.dimensionSource === 'ai_draft_printed')) {
    pendingCount++;
    add('room_not_reviewed', 'pending', '自动识别房间', '图示尺寸和房间边界仍是 AI 草稿，需内部复核', zone.id);
  }

  for (const line of lines) {
    if (line.key === 'queen_mattress') continue; // A mattress shares its bed frame's floor footprint.
    const matching = zones.filter(zone => zone.kind === roomKind(line.room));
    for (let index = 0; index < line.quantity; index++) {
      const label = `${line.label}${line.quantity > 1 ? ` ${index + 1}` : ''}`;
      const id = `${line.key}-${index + 1}`;
      const selectedId = assignments?.[`${line.key}:${index}`];
      const zone = selectedId ? zones.find(item => item.id === selectedId) : matching[index % matching.length];
      if (!zone) {
        pendingCount++;
        add('room_missing', 'pending', label, selectedId ? '指定区域已不存在或不可摆放' : '缺对应的可摆家具房间');
        continue;
      }
      if (!fitValidSize(zone.dimensionsMm)) {
        pendingCount++;
        add('room_size_missing', 'pending', label, '房间缺可核对的长宽', zone.id);
        continue;
      }
      if (!fitValidSize(line.dimensionsMm)) {
        pendingCount++;
        add('product_size_missing', 'pending', label, '商品或套装缺完整外廓长宽；套装须分件录入', zone.id);
        continue;
      }
      checkedCount++;
      const { width: widthMm, depth: depthMm } = line.dimensionsMm;
      const { width: roomWidth, depth: roomDepth } = zone.dimensionsMm;
      const forward = widthMm <= roomWidth && depthMm <= roomDepth;
      const turned = depthMm <= roomWidth && widthMm <= roomDepth;
      if (!forward && !turned) {
        add('outline_exceeds_room', 'conflict', label,
          `两种直角朝向的外廓均超过房间 ${roomWidth}×${roomDepth} mm；先复核净尺寸与商品尺寸`, zone.id);
        continue;
      }
      if (!forward && turned) {
        pendingCount++;
        add('rotation_needed', 'pending', label, '只有旋转 90° 后外廓才可能进入房间；当前预览不自动旋转', zone.id);
        continue;
      }
      const placed = placements.get(id);
      if (!placed || placed.zoneId !== zone.id) {
        pendingCount++;
        add('draft_layout_unresolved', 'pending', label,
          '当前简单矩形排布未找到不重叠位置；不能据此断言放不下', zone.id);
        continue;
      }
      if (placed.xMm < 0 || placed.yMm < 0 || placed.xMm + placed.widthMm > roomWidth ||
          placed.yMm + placed.depthMm > roomDepth) {
        add('outside_room', 'conflict', label, '当前占位超出房间矩形边界', zone.id);
      }
    }
  }

  const bed = lines.find(line => line.key === 'queen_bed_frame');
  const mattress = lines.find(line => line.key === 'queen_mattress');
  if (mattress) {
    if (!fitValidSize(bed?.dimensionsMm) || !fitValidSize(mattress.dimensionsMm)) {
      pendingCount += mattress.quantity;
      add('bed_pair_size_missing', 'pending', '床垫与床架', '缺床垫或床架的外廓长宽，无法核对配对');
    } else if (bed.quantity !== mattress.quantity ||
        !((mattress.dimensionsMm.width <= bed.dimensionsMm.width && mattress.dimensionsMm.depth <= bed.dimensionsMm.depth) ||
          (mattress.dimensionsMm.depth <= bed.dimensionsMm.width && mattress.dimensionsMm.width <= bed.dimensionsMm.depth))) {
      add('bed_pair_mismatch', 'conflict', '床垫与床架', '数量或外廓不匹配；请核对床架适配床垫的实际内径');
    } else checkedCount += mattress.quantity;
  }

  for (let index = 0; index < layout.placements.length; index++) {
    const a = layout.placements[index];
    for (let next = index + 1; next < layout.placements.length; next++) {
      const b = layout.placements[next];
      if (a.zoneId === b.zoneId && overlaps(a, b))
        add('furniture_overlap', 'conflict', `${a.label} / ${b.label}`, '当前两个家具占位相交', a.zoneId);
    }
  }

  const conflictCount = findings.filter(item => item.severity === 'conflict').length;
  const estimatedRoomCount = zones.filter(zone => zone.dimensionsMm &&
    (zone.dimensionSource === 'scale_estimate' || /比例估算/.test(zone.dimensionsLabel || ''))).length;
  return {
    fitStatus: 'not_checked',
    screenStatus: conflictCount ? 'conflict' : pendingCount ? 'incomplete' : 'outline_clear',
    checkedCount, pendingCount, conflictCount, findings,
    evidence: {
      demoSite: !!site?.source?.fileName?.startsWith('系统演示户型'),
      simulatedProductCount: lines.filter(line => line.simulated).length,
      estimatedRoomCount,
      unreviewedRoomCount: zones.filter(zone => zone.reviewStatus === 'draft').length,
    },
    unchecked: ['门窗与开门轨迹', '固定设备和墙体净边界', '通行与家具使用净空', '入户门、楼梯和搬运路径', '现场净尺寸与真实 SKU 规格'],
  };
}
