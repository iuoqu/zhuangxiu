// A deterministic rectangle occupancy preview, not a fit or circulation assessment.
const zoneKindForRoom = room => room.startsWith('客厅') ? 'living' :
  room.startsWith('餐厅') ? 'dining' : room.startsWith('卧室') ? 'bedroom' : null;
const validSize = dimensions => dimensions && [dimensions.width, dimensions.depth].every(value =>
  Number.isFinite(value) && value >= 100 && value <= 100000);
const drawingSize = zone => validSize(zone.dimensionsMm) ? zone.dimensionsMm :
  validSize(zone.visualSizeMm) ? zone.visualSizeMm : null;
const center = (room, item) => Math.round((room - item) / 2);
const clearOf = (candidate, placed, gap = 60) => placed.every(other =>
  candidate.xMm + candidate.widthMm + gap <= other.xMm ||
  other.xMm + other.widthMm + gap <= candidate.xMm ||
  candidate.yMm + candidate.depthMm + gap <= other.yMm ||
  other.yMm + other.depthMm + gap <= candidate.yMm);

// Familiar furniture relationships make the schematic readable. These are visual
// suggestions only: doors, windows, wall shapes and circulation are not assessed.
function preferredPosition(zone, item, items, roomWidth, roomDepth) {
  const bed = items.find(value => value.key === 'queen_bed_frame');
  const diningTable = items.find(value => value.key.startsWith('dining_table'));
  if (zone.kind === 'living') {
    if (item.key === 'tv_console') return { xMm: center(roomWidth, item.widthMm), yMm: 160 };
    if (item.key === 'coffee_table') return { xMm: center(roomWidth, item.widthMm), yMm: center(roomDepth, item.depthMm) };
    if (item.key === 'sofa_3') return { xMm: center(roomWidth, item.widthMm), yMm: roomDepth - item.depthMm - 180 };
    if (item.key === 'accent_chair') {
      const index = items.filter(value => value.key === 'accent_chair').indexOf(item);
      return { xMm: index % 2 ? roomWidth - item.widthMm - 140 : 140,
        yMm: center(roomDepth, item.depthMm) + (index > 1 ? 180 : 0) };
    }
  }
  if (zone.kind === 'bedroom') {
    const bedY = bed ? center(roomDepth, bed.depthMm) : 0;
    if (item.key === 'queen_bed_frame') return { xMm: center(roomWidth, item.widthMm), yMm: bedY };
    if (item.key === 'nightstand' && bed) {
      const index = items.filter(value => value.key === 'nightstand').indexOf(item);
      return { xMm: index % 2 ? roomWidth - item.widthMm - 100 : 100, yMm: bedY + 100 };
    }
    if (item.key.startsWith('dresser')) return { xMm: center(roomWidth, item.widthMm),
      yMm: roomDepth - item.depthMm - 180 };
  }
  if (zone.kind === 'dining' && diningTable) {
    const tableX = center(roomWidth, diningTable.widthMm), tableY = center(roomDepth, diningTable.depthMm);
    if (item.key.startsWith('dining_table')) return { xMm: tableX, yMm: tableY };
    if (item.key === 'dining_chair') {
      const chairs = items.filter(value => value.key === 'dining_chair');
      const index = chairs.indexOf(item), offset = 100;
      if (index === 0) return { xMm: tableX - item.widthMm - offset,
        yMm: tableY + center(diningTable.depthMm, item.depthMm) };
      if (index === 1) return { xMm: tableX + diningTable.widthMm + offset,
        yMm: tableY + center(diningTable.depthMm, item.depthMm) };
      const top = index === 2 || index === 4;
      const row = chairs.length > 4 ? Math.floor((index - 2) / 2) : 0;
      const count = chairs.length > 4 ? 2 : 1;
      return { xMm: tableX + Math.round((row + 1) * diningTable.widthMm / (count + 1) - item.widthMm / 2),
        yMm: top ? tableY - item.depthMm - offset : tableY + diningTable.depthMm + offset };
    }
  }
  return null;
}

export function buildHomeConceptLayout(lines, site, assignments = {}, overrides = {}) {
  const result = { fitStatus: 'not_checked', basis: 'room_drawing_units_and_product_rectangles',
    placements: [], issues: [], pairedMattresses: 0, placedCount: 0, pendingCount: 0, visualOnlyCount: 0 };
  if (!site?.source || site.source.kind !== 'image' || !Array.isArray(site.zones)) {
    result.issues.push({ label: '户型图', reason: '需要已标注的图片户型图' });
    return result;
  }
  const zones = site.zones.filter(zone => ['living', 'dining', 'bedroom', 'mezzanine'].includes(zone.kind));
  const assigned = new Map();
  const addIssue = (label, reason) => { result.issues.push({ label, reason }); result.pendingCount++; };
  const bed = lines.find(line => line.key === 'queen_bed_frame');
  for (const line of lines) {
    if (line.key === 'queen_mattress') {
      if (!validSize(line.dimensionsMm) || !validSize(bed?.dimensionsMm)) {
        for (let i = 0; i < line.quantity; i++) addIssue(`${line.label} ${i + 1}`, '床垫或床架缺外廓尺寸，不能核对叠放');
      } else if (line.dimensionsMm.width > bed.dimensionsMm.width || line.dimensionsMm.depth > bed.dimensionsMm.depth || line.quantity !== bed.quantity) {
        for (let i = 0; i < line.quantity; i++) addIssue(`${line.label} ${i + 1}`, '床垫与床架示意尺寸或数量不匹配');
      } else result.pairedMattresses = line.quantity;
      continue;
    }
    const kind = zoneKindForRoom(line.room);
    const roomZones = zones.filter(zone => zone.kind === kind);
    for (let i = 0; i < line.quantity; i++) {
      const label = `${line.label}${line.quantity > 1 ? ` ${i + 1}` : ''}`;
      const chosenId = assignments?.[`${line.key}:${i}`];
      const zone = chosenId ? zones.find(item => item.id === chosenId) : roomZones[i % roomZones.length];
      if (chosenId && !zone) { addIssue(label, '指定的房间标注已不存在或不可摆放'); continue; }
      if (!kind || !zone) { addIssue(label, '没有对应的可摆家具房间标注'); continue; }
      const footprint = validSize(line.dimensionsMm) ? line.dimensionsMm : line.simulated && validSize(line.visualFootprintMm)
        ? line.visualFootprintMm : null;
      if (!footprint) { addIssue(label, '商品缺外廓尺寸'); continue; }
      if (!drawingSize(zone)) { addIssue(label, '房间缺图示长宽，暂不按比例占位'); continue; }
      const list = assigned.get(zone.id) || [];
      list.push({ instanceId: `${line.key}-${i + 1}`, key: line.key, label, sku: line.sku,
        zoneId: zone.id, widthMm: footprint.width, depthMm: footprint.depth,
        visualOnly: !validSize(line.dimensionsMm) || !validSize(zone.dimensionsMm) });
      assigned.set(zone.id, list);
    }
  }
  for (const zone of zones) {
    const items = assigned.get(zone.id) || [];
    if (!items.length) continue;
    const roomWidth = drawingSize(zone).width, roomDepth = drawingSize(zone).depth;
    const margin = 80;
    const placed = [];
    for (const item of items) {
      if (item.widthMm + margin * 2 > roomWidth || item.depthMm + margin * 2 > roomDepth) {
        addIssue(item.label, '示意外廓超过该房间图示长宽；需实测与调整朝向'); continue;
      }
      const preferred = preferredPosition(zone, item, items, roomWidth, roomDepth);
      const within = point => point && point.xMm >= margin && point.yMm >= margin &&
        point.xMm + item.widthMm <= roomWidth - margin && point.yMm + item.depthMm <= roomDepth - margin;
      let position = within(preferred) && clearOf({ ...item, ...preferred }, placed) ? preferred : null;
      if (!position) {
        for (let y = margin; y + item.depthMm <= roomDepth - margin && !position; y += 60) {
          for (let x = margin; x + item.widthMm <= roomWidth - margin; x += 60) {
            const point = { xMm: x, yMm: y };
            if (clearOf({ ...item, ...point }, placed)) { position = point; break; }
          }
        }
      }
      if (!position) {
        addIssue(item.label, '简单矩形排布未找到位置；不能据此判定放不下'); continue;
      }
      const placement = { ...item, ...position };
      placed.push(placement);
      result.placements.push(placement);
      if (item.visualOnly) result.visualOnlyCount++;
    }
    // Keep automatic items where they were; moving one piece must not silently move the rest.
    for (const placement of result.placements.filter(item => item.zoneId === zone.id)) {
      const override = overrides?.[placement.instanceId];
      if (override?.zoneId !== zone.id || !Number.isFinite(override.xRatio) || !Number.isFinite(override.yRatio) ||
          override.xRatio < 0 || override.xRatio > 1 || override.yRatio < 0 || override.yRatio > 1) continue;
      placement.xMm = Math.round(override.xRatio * (roomWidth - placement.widthMm));
      placement.yMm = Math.round(override.yRatio * (roomDepth - placement.depthMm));
      placement.manuallyPositioned = true;
    }
  }
  result.placements.forEach((item, index) => { item.marker = `F${index + 1}`; });
  result.placedCount = result.placements.length;
  return result;
}
