import { computeLayoutRevision } from './layout-revision.js';
import { needsProductUseSpec, profileCoversRequiredUseRects, requiredProductUseRects } from './product-use-spec.js';
import { seatingRelation } from './home-assemblies.js';

const positive = value => Number.isFinite(value) && value > 0;
const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const inside = (box, outer) => box.x >= outer.x && box.y >= outer.y && box.x + box.w <= outer.x + outer.w && box.y + box.h <= outer.y + outer.h;
const rect = item => ({ x: Math.min(item.x, item.x2), y: Math.min(item.y, item.y2), w: Math.abs(item.x2 - item.x), h: Math.abs(item.y2 - item.y) });
const normalizedTurn = value => ((value % 360) + 360) % 360;
function localBox(item, box) {
  const turn = normalizedTurn(item.rot || 0);
  const corners = [[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]];
  const points = corners.map(([x, y]) => turn === 0 ? [x, y] : turn === 90 ? [-y, x] : turn === 180 ? [-x, -y] : [y, -x]);
  const xs = points.map(([x]) => item.x + x), ys = points.map(([, y]) => item.y + y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}
const footprint = item => localBox(item, { x: -item.w / 2, y: -item.h / 2, w: item.w, h: item.h });
function doorApproach(room) {
  const box = rect(room), side = room.door?.side;
  if (side === 'north') return { x: box.x + box.w / 2 - 450, y: box.y, w: 900, h: 900 };
  if (side === 'south') return { x: box.x + box.w / 2 - 450, y: box.y + box.h - 900, w: 900, h: 900 };
  if (side === 'west') return { x: box.x, y: box.y + box.h / 2 - 450, w: 900, h: 900 };
  if (side === 'east') return { x: box.x + box.w - 900, y: box.y + box.h / 2 - 450, w: 900, h: 900 };
  return null;
}
function routeCheck(project, obstacles) {
  const entrances = project.objects.filter(item => item.type === 'door');
  const exits = project.objects.filter(item => item.type === 'exit');
  if (!entrances.length || !exits.length) return 'route_markers_missing';
  const step = 500, cols = Math.ceil(project.w / step), rows = Math.ceil(project.h / step);
  const clear = new Uint8Array(cols * rows), visited = new Uint8Array(cols * rows);
  const index = (x, y) => y * cols + x;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const point = { x: (x + .5) * step, y: (y + .5) * step };
    if (point.x < project.w && point.y < project.h && !obstacles.some(box => point.x >= box.x - 100 && point.x <= box.x + box.w + 100 && point.y >= box.y - 100 && point.y <= box.y + box.h + 100)) clear[index(x, y)] = 1;
  }
  const nearby = point => {
    const found = [];
    for (let y = Math.max(0, Math.floor((point.y - 850) / step)); y < Math.min(rows, Math.ceil((point.y + 850) / step)); y++)
      for (let x = Math.max(0, Math.floor((point.x - 850) / step)); x < Math.min(cols, Math.ceil((point.x + 850) / step)); x++)
        if (clear[index(x, y)] && Math.hypot((x + .5) * step - point.x, (y + .5) * step - point.y) <= 850) found.push(index(x, y));
    return found;
  };
  const queue = [];
  for (const entrance of entrances) for (const cell of nearby(entrance)) if (!visited[cell]) { visited[cell] = 1; queue.push(cell); }
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head], x = cell % cols, y = Math.floor(cell / cols);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const next = index(nx, ny);
      if (clear[next] && !visited[next]) { visited[next] = 1; queue.push(next); }
    }
  }
  if (!exits.some(exitPoint => nearby(exitPoint).some(cell => visited[cell]))) return 'entrance_exit_disconnected';
  for (const room of project.objects.filter(item => item.type === 'room')) {
    const box = rect(room), approach = doorApproach(room), side = room.door?.side;
    if (!approach) return 'room_door_missing';
    const point = side === 'north' ? { x: box.x + box.w / 2, y: box.y - 550 } :
      side === 'south' ? { x: box.x + box.w / 2, y: box.y + box.h + 550 } :
      side === 'west' ? { x: box.x - 550, y: box.y + box.h / 2 } : { x: box.x + box.w + 550, y: box.y + box.h / 2 };
    if (!nearby(point).some(cell => visited[cell])) return 'room_route_disconnected';
  }
  return null;
}

// This is a conservative planning screen for rectangular, 90-degree furniture. It does
// not certify fire, accessibility or construction-code compliance.
export async function reviewProductPlacement({ project, displayItems, slot, candidate, profilesByInstanceId }) {
  if (!project || !Array.isArray(displayItems) || !slot || !candidate || !profilesByInstanceId) throw new TypeError('A project, displayed furniture, slot, candidate and clearance profiles are required');
  const layoutRevision = await computeLayoutRevision(project, displayItems, profilesByInstanceId);
  const base = { slotId: slot.slotId, candidateId: candidate.candidateId, candidateObservedAt: candidate.observedAt,
    useSpecSnapshot: needsProductUseSpec(candidate.category) ? JSON.stringify(candidate.useSpec ?? null) : null,
    layoutRevision, productClearanceVerified: false };
  const unassessed = reason => ({ ...base, status: 'unassessed', reasons: [reason],
    issues: [{ reason, instanceIds: ['site_not_confirmed', 'site_geometry_invalid', 'display_geometry_invalid',
      'duplicate_instance_id', 'clearance_profile_missing_or_stale'].includes(reason) ? [] : [slot.sourceInstanceId] }] });
  const blocked = issues => ({ ...base, status: 'blocked',
    reasons: [...new Set(issues.map(issue => issue.reason))], issues });
  if (project.site?.confirmed !== true) return unassessed('site_not_confirmed');
  if (!positive(project.w) || !positive(project.h) || !Array.isArray(project.objects) || project.objects.some(item => {
    if (!item || typeof item.id !== 'string' || !Number.isFinite(item.x) || !Number.isFinite(item.y)) return true;
    return ['column', 'blocked', 'partition', 'room', 'zone', 'corridor'].includes(item.type) &&
      (![item.x2, item.y2].every(Number.isFinite) || !positive(Math.abs(item.x2 - item.x)) || !positive(Math.abs(item.y2 - item.y)));
  })) return unassessed('site_geometry_invalid');
  const target = displayItems.find(item => item.id === slot.sourceInstanceId);
  if (!target || displayItems.some(item => !item || typeof item.id !== 'string' || !positive(item.w) || !positive(item.h) || !positive(item.z) || !Number.isFinite(item.x) || !Number.isFinite(item.y) || !Number.isInteger((item.rot || 0) / 90))) return unassessed('display_geometry_invalid');
  if (new Set(displayItems.map(item => item.id)).size !== displayItems.length) return unassessed('duplicate_instance_id');
  if (!slot.category || slot.category !== candidate.category) return unassessed('category_mismatch');
  if (slot.role !== candidate.role) return unassessed('role_mismatch');
  if (!candidate.verification?.spec || ![candidate.dimensionsMm?.width, candidate.dimensionsMm?.depth, candidate.dimensionsMm?.height].every(positive)) return unassessed('candidate_spec_unverified');
  if (target.w !== candidate.dimensionsMm.width || target.h !== candidate.dimensionsMm.depth || target.z !== candidate.dimensionsMm.height) return unassessed('candidate_dimensions_not_applied');
  const profiles = new Map();
  for (const item of displayItems) {
    const profile = profilesByInstanceId[item.id];
    if (!profile || profile.verified !== true || typeof profile.reviewedBy !== 'string' || !profile.reviewedBy.trim() ||
        !Number.isFinite(Date.parse(profile.reviewedAt)) || !Array.isArray(profile.clearanceRects) ||
        profile.dimensionsMm?.width !== item.w || profile.dimensionsMm?.depth !== item.h || profile.dimensionsMm?.height !== item.z ||
        profile.clearanceRects.some(box => !box || ![box.x, box.y, box.w, box.h].every(Number.isFinite) || !positive(box.w) || !positive(box.h))) return unassessed('clearance_profile_missing_or_stale');
    profiles.set(item.id, profile);
  }
  const targetProfile = profiles.get(target.id);
  if (targetProfile.candidateId !== candidate.candidateId || targetProfile.sourceRef !== candidate.sourceRef || targetProfile.observedAt !== candidate.observedAt) return unassessed('candidate_clearance_unverified');
  const requiredUse = requiredProductUseRects(candidate);
  if (requiredUse == null) return unassessed('product_use_spec_unverified');
  if (!profileCoversRequiredUseRects(targetProfile, requiredUse)) return unassessed('product_use_clearance_missing_or_stale');
  const site = { x: 0, y: 0, w: project.w, h: project.h }, issues = [];
  const issue = (reason, instanceIds = [], objectId = null) => {
    const ids = [...new Set(instanceIds)];
    if (!issues.some(entry => entry.reason === reason && (entry.objectId || null) === objectId &&
        entry.instanceIds.length === ids.length && entry.instanceIds.every((id, index) => id === ids[index]))) {
      issues.push({ reason, instanceIds: ids, ...(objectId ? { objectId } : {}) });
    }
  };
  const objects = project.objects || [];
  const geometry = displayItems.map(item => ({ item, body: footprint(item), use: profiles.get(item.id).clearanceRects.map(box => localBox(item, box)) }));
  const fixed = objects.filter(item => ['column', 'blocked', 'partition', 'room', 'zone', 'corridor'].includes(item.type)).map(item => {
    const box = rect(item);
    return { item, box: item.type === 'partition' ? { x: box.x - 100, y: box.y - 100, w: box.w + 200, h: box.h + 200 } : box };
  });
  for (const entry of geometry) {
    const { item, body, use } = entry,
      room = objects.find(object => object.id === item.roomId && object.type === 'room'),
      zone = objects.find(object => object.id === item.zoneId && object.type === 'zone');
    if (item.roomId && !room) { issue('room_missing', [item.id], item.roomId); continue; }
    if (item.zoneId && !zone) { issue('zone_missing', [item.id], item.zoneId); continue; }
    if (room && zone) { issue('multiple_containing_areas', [item.id]); continue; }
    const area = room ? rect(room) : zone ? rect(zone) : site,
      approach = room ? doorApproach(room) : null;
    if (room && !approach) issue('room_door_missing', [item.id], room.id);
    for (const box of [body, ...use]) {
      if (!inside(box, area)) issue(room ? 'outside_room' : zone ? 'outside_zone' : 'outside_site', [item.id], room?.id || zone?.id);
      if (approach && overlaps(box, approach)) issue('room_door_approach_blocked', [item.id], room.id);
      for (const object of fixed) if (object.item.id !== item.roomId && object.item.id !== item.zoneId && overlaps(box, object.box))
        issue('fixed_object_collision', [item.id], object.item.id);
    }
  }
  for (let i = 0; i < geometry.length; i++) for (let j = i + 1; j < geometry.length; j++) {
    const a = geometry[i], b = geometry[j];
    const aSeatsB = seatingRelation(a.item, b.item), bSeatsA = seatingRelation(b.item, a.item);
    if (overlaps(a.body, b.body)) issue('furniture_collision', [a.item.id, b.item.id]);
    const aUseBBody = a.use.some(box => overlaps(box, b.body));
    const bUseABody = b.use.some(box => overlaps(box, a.body));
    const sharedUse = a.use.some(box => b.use.some(other => overlaps(box, other)));
    if ((!aSeatsB && aUseBBody) || (!bSeatsA && bUseABody) ||
        (!aSeatsB && !bSeatsA && sharedUse)) issue('use_clearance_collision', [a.item.id, b.item.id]);
  }
  for (const corridor of objects.filter(item => item.type === 'corridor')) {
    const box = rect(corridor), width = box.w >= box.h ? box.h : box.w;
    if (width < (corridor.kind === 'main' ? project.rules?.main || 1200 : project.rules?.minor || 900)) issue('corridor_too_narrow', [], corridor.id);
  }
  const routeObstacles = [...fixed.filter(entry => entry.item.type !== 'corridor').map(entry => entry.box), ...geometry.flatMap(entry => [entry.body, ...entry.use])];
  const routeReason = routeCheck(project, routeObstacles);
  if (routeReason) issue(routeReason);
  return issues.length ? blocked(issues) : { ...base, status: 'passed', reasons: [], issues: [], productClearanceVerified: true };
}
