import { buildProductSlots } from './product-slots.js';
import { auditPlanningCoverage, candidateEvidenceGaps } from './planning-coverage.js';
import { bindReviewedPlanningScene } from './planning-product-binding.js';

// A proposal changes one selected product at a time and reruns the complete
// scene review. It never edits the project or silently applies a replacement.
export async function reviewPlanningProductAlternatives({ project, selections, candidates,
  displayFurniture, initialReview = null, maxTrials = 12, maxAlternatives = 3 }) {
  if (!project || !Array.isArray(selections) || !Array.isArray(candidates) ||
      typeof displayFurniture !== 'function' || !Number.isInteger(maxTrials) || maxTrials < 1 || maxTrials > 50 ||
      !Number.isInteger(maxAlternatives) || maxAlternatives < 1 || maxAlternatives > 10) {
    throw new TypeError('Alternative review needs a scene, selections, catalog and bounded trial limits');
  }
  const slots = buildProductSlots(displayFurniture(project));
  const coverage = auditPlanningCoverage({ slots, candidates, selections });
  if (coverage.needsProductEvidence) return { status: 'product_evidence_incomplete',
    coverage, alternatives: [], trials: 0, placementIssues: [] };
  const baseline = initialReview || await bindReviewedPlanningScene({ project, selections, candidates, displayFurniture });
  if (baseline.status === 'bound') return { status: 'current_selection_fits', coverage,
    alternatives: [], trials: 0, placementIssues: [] };
  const placementIssues = baseline.placementIssues || [];
  if (!placementIssues.length) return { status: 'binding_blocked', coverage,
    alternatives: [], trials: 0, placementIssues: [], reasons: baseline.reasons };
  const selected = new Map(selections.map(selection => [selection.sourceInstanceId, selection.candidateId]));
  const byId = new Map(candidates.map(candidate => [candidate.candidateId, candidate]));
  const bySlot = new Map(slots.map(slot => [slot.sourceInstanceId, slot]));
  const affected = [...new Set(placementIssues.flatMap(issue => issue.instanceIds || []))]
    .filter(instanceId => bySlot.has(instanceId));
  if (!affected.length) return { status: 'scene_review_needed', coverage,
    alternatives: [], trials: 0, placementIssues };
  const alternatives = [];
  let trials = 0;
  for (const instanceId of affected) {
    const slot = bySlot.get(instanceId), current = byId.get(selected.get(instanceId));
    const choices = candidates.filter(candidate => candidate.candidateId !== current?.candidateId &&
      candidate.category === slot.category && candidate.role === slot.role &&
      candidateEvidenceGaps(candidate).length === 0)
      .sort((a, b) => a.dimensionsMm.width * a.dimensionsMm.depth - b.dimensionsMm.width * b.dimensionsMm.depth ||
        a.candidateId.localeCompare(b.candidateId));
    for (const candidate of choices) {
      if (trials >= maxTrials || alternatives.length >= maxAlternatives) break;
      trials++;
      const changed = selections.map(selection => selection.sourceInstanceId === instanceId
        ? { ...selection, candidateId: candidate.candidateId } : selection);
      const review = await bindReviewedPlanningScene({ project, selections: changed, candidates, displayFurniture });
      if (review.status === 'bound') alternatives.push({ sourceInstanceId: instanceId,
        fromCandidateId: current.candidateId, toCandidateId: candidate.candidateId,
        supplierSku: candidate.supplierSku, name: candidate.name || candidate.supplierSku,
        dimensionsMm: { ...candidate.dimensionsMm },
        reviewStatus: 'whole_scene_passed' });
    }
    if (trials >= maxTrials || alternatives.length >= maxAlternatives) break;
  }
  return { status: alternatives.length ? 'alternatives_found' : 'no_single_swap_found',
    coverage, alternatives, trials, placementIssues,
    trialLimitReached: trials >= maxTrials };
}

// Used only after one-product proposals fail. Search is deliberately bounded:
// every proposed pair is accepted only after a complete scene recheck.
export async function reviewPlanningProductPairs({ project, selections, candidates,
  displayFurniture, initialReview = null, maxTrials = 8, maxAlternatives = 2 }) {
  if (!project || !Array.isArray(selections) || !Array.isArray(candidates) ||
      typeof displayFurniture !== 'function' || !Number.isInteger(maxTrials) || maxTrials < 1 || maxTrials > 50 ||
      !Number.isInteger(maxAlternatives) || maxAlternatives < 1 || maxAlternatives > 10) {
    throw new TypeError('Pair review needs a scene, selections, catalog and bounded trial limits');
  }
  const slots = buildProductSlots(displayFurniture(project));
  const coverage = auditPlanningCoverage({ slots, candidates, selections });
  if (coverage.needsProductEvidence) return { status: 'product_evidence_incomplete',
    alternatives: [], trials: 0, placementIssues: [] };
  const baseline = initialReview || await bindReviewedPlanningScene({ project, selections, candidates, displayFurniture });
  if (baseline.status === 'bound') return { status: 'current_selection_fits',
    alternatives: [], trials: 0, placementIssues: [] };
  const placementIssues = baseline.placementIssues || [];
  const affected = new Set(placementIssues.flatMap(issue => issue.instanceIds || []));
  const selected = new Map(selections.map(selection => [selection.sourceInstanceId, selection.candidateId]));
  const entries = slots.filter(slot => affected.has(slot.sourceInstanceId)).map(slot => ({
    slot, choices: candidates.filter(candidate => candidate.candidateId !== selected.get(slot.sourceInstanceId) &&
      candidate.category === slot.category && candidate.role === slot.role &&
      candidateEvidenceGaps(candidate).length === 0)
      .sort((a, b) => a.dimensionsMm.width * a.dimensionsMm.depth - b.dimensionsMm.width * b.dimensionsMm.depth ||
        a.candidateId.localeCompare(b.candidateId)),
  })).filter(entry => entry.choices.length);
  if (entries.length < 2) return { status: 'no_pair_to_check',
    alternatives: [], trials: 0, placementIssues };
  const alternatives = [];
  let trials = 0;
  search: for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
    const a = entries[i], b = entries[j];
    for (const first of a.choices) for (const second of b.choices) {
      if (trials >= maxTrials || alternatives.length >= maxAlternatives) break search;
      trials++;
      const changed = selections.map(selection => selection.sourceInstanceId === a.slot.sourceInstanceId
        ? { ...selection, candidateId: first.candidateId } : selection.sourceInstanceId === b.slot.sourceInstanceId
          ? { ...selection, candidateId: second.candidateId } : selection);
      const review = await bindReviewedPlanningScene({ project, selections: changed, candidates, displayFurniture });
      if (review.status === 'bound') alternatives.push({ changes: [
        { sourceInstanceId: a.slot.sourceInstanceId, fromCandidateId: selected.get(a.slot.sourceInstanceId),
          toCandidateId: first.candidateId, supplierSku: first.supplierSku,
          name: first.name || first.supplierSku, dimensionsMm: { ...first.dimensionsMm } },
        { sourceInstanceId: b.slot.sourceInstanceId, fromCandidateId: selected.get(b.slot.sourceInstanceId),
          toCandidateId: second.candidateId, supplierSku: second.supplierSku,
          name: second.name || second.supplierSku, dimensionsMm: { ...second.dimensionsMm } },
      ], reviewStatus: 'whole_scene_passed' });
    }
  }
  return { status: alternatives.length ? 'alternatives_found' : 'no_pair_found',
    alternatives, trials, placementIssues, trialLimitReached: trials >= maxTrials };
}

// Only standalone primary furniture is moved here. Generated room furniture,
// shared-zone footprints and workstation islands need their own layout rules.
export async function reviewPlanningLayoutMoves({ project, selections, candidates, displayFurniture,
  initialReview = null, maxTrials = 12, maxAlternatives = 2 }) {
  if (!project || !Array.isArray(project.furniture) || !Array.isArray(selections) ||
      !Array.isArray(candidates) || typeof displayFurniture !== 'function' ||
      !Number.isInteger(maxTrials) || maxTrials < 1 || maxTrials > 50 ||
      !Number.isInteger(maxAlternatives) || maxAlternatives < 1 || maxAlternatives > 10) {
    throw new TypeError('Layout move review needs a scene, selections, catalog and bounded trial limits');
  }
  const slots = buildProductSlots(displayFurniture(project));
  const coverage = auditPlanningCoverage({ slots, candidates, selections });
  if (coverage.needsProductEvidence) return { status: 'product_evidence_incomplete',
    alternatives: [], trials: 0, placementIssues: [] };
  const baseline = initialReview || await bindReviewedPlanningScene({ project, selections, candidates, displayFurniture });
  if (baseline.status === 'bound') return { status: 'current_selection_fits',
    alternatives: [], trials: 0, placementIssues: [] };
  const placementIssues = baseline.placementIssues || [];
  const affected = new Set(placementIssues.flatMap(issue => issue.instanceIds || []));
  const movable = project.furniture.filter(item => affected.has(item.id) &&
    !item.roomId && !item.zoneId && !item.islandId && !item.workAreaId && !item.linkedTo &&
    !project.furniture.some(other => other.linkedTo === item.id) &&
    !['dining4', 'lounge2'].includes(item.kind) && Number.isFinite(item.x) && Number.isFinite(item.y));
  if (!movable.length) return { status: 'no_standalone_move',
    alternatives: [], trials: 0, placementIssues };
  const offsets = [[-250, 0], [250, 0], [0, -250], [0, 250],
    [-500, 0], [500, 0], [0, -500], [0, 500],
    [-1000, 0], [1000, 0], [0, -1000], [0, 1000]];
  const alternatives = [];
  let trials = 0;
  for (const item of movable) {
    for (const [dx, dy] of offsets) {
      if (trials >= maxTrials || alternatives.length >= maxAlternatives) break;
      trials++;
      const trial = { ...project, furniture: project.furniture.map(current => current.id === item.id
        ? { ...current, x: current.x + dx, y: current.y + dy } : { ...current }) };
      const review = await bindReviewedPlanningScene({ project: trial, selections, candidates, displayFurniture });
      if (review.status === 'bound') alternatives.push({ sourceInstanceId: item.id,
        from: { x: item.x, y: item.y }, to: { x: item.x + dx, y: item.y + dy },
        reviewStatus: 'whole_scene_passed' });
    }
    if (trials >= maxTrials || alternatives.length >= maxAlternatives) break;
  }
  return { status: alternatives.length ? 'alternatives_found' : 'no_local_move_found',
    alternatives, trials, placementIssues, trialLimitReached: trials >= maxTrials };
}

// Move a generated room furniture group within its existing room, or the one
// editable furniture footprint belonging to a shared zone. Container geometry
// and concept rules are supplied by the planner through layoutValid.
function affectedContainers(project, displayed, placementIssues) {
  const affected = new Set(placementIssues.flatMap(issue => issue.instanceIds || []));
  const containers = [], seen = new Set();
  for (const item of displayed.filter(value => affected.has(value.id))) {
    if (item.roomId && !seen.has(`room:${item.roomId}`)) {
      const room = project.objects.find(value => value.id === item.roomId && value.type === 'room');
      if (room) { containers.push({ kind: 'room', id: room.id, room }); seen.add(`room:${room.id}`); }
    }
    if (item.zoneId && !seen.has(`zone:${item.zoneId}`)) {
      const parent = project.furniture.find(value => value.zoneId === item.zoneId);
      const zone = project.objects.find(value => value.id === item.zoneId && value.type === 'zone');
      if (parent && zone && Number.isFinite(parent.x) && Number.isFinite(parent.y)) {
        containers.push({ kind: 'zone', id: zone.id, parent }); seen.add(`zone:${zone.id}`);
      }
    }
  }
  return containers;
}

function containerMove(project, container, dx, dy) {
  const oldShift = container.room?.furnitureShift || { dx: 0, dy: 0 };
  if (container.kind === 'room' && (!Number.isInteger(oldShift.dx) || !Number.isInteger(oldShift.dy) ||
      Math.abs(oldShift.dx + dx) > 5000 || Math.abs(oldShift.dy + dy) > 5000)) return null;
  const trial = container.kind === 'room'
    ? { ...project, objects: project.objects.map(value => value.id === container.id
      ? { ...value, furnitureShift: { dx: oldShift.dx + dx, dy: oldShift.dy + dy } } : value) }
    : { ...project, furniture: project.furniture.map(value => value.id === container.parent.id
      ? { ...value, x: value.x + dx, y: value.y + dy } : value) };
  return { trial, change: { kind: container.kind, containerId: container.id,
    furnitureId: container.parent?.id || null,
    from: container.kind === 'room' ? { dx: oldShift.dx, dy: oldShift.dy }
      : { x: container.parent.x, y: container.parent.y },
    to: container.kind === 'room' ? { dx: oldShift.dx + dx, dy: oldShift.dy + dy }
      : { x: container.parent.x + dx, y: container.parent.y + dy } } };
}

export async function reviewPlanningContainerMoves({ project, selections, candidates,
  displayFurniture, layoutValid, initialReview = null, maxTrials = 16, maxAlternatives = 2 }) {
  if (!project || !Array.isArray(project.objects) || !Array.isArray(project.furniture) ||
      !Array.isArray(selections) || !Array.isArray(candidates) || typeof displayFurniture !== 'function' ||
      typeof layoutValid !== 'function' || !Number.isInteger(maxTrials) || maxTrials < 1 || maxTrials > 50 ||
      !Number.isInteger(maxAlternatives) || maxAlternatives < 1 || maxAlternatives > 10) {
    throw new TypeError('Container move review needs a scene, catalog, layout check and bounded trials');
  }
  const displayed = displayFurniture(project), slots = buildProductSlots(displayed);
  const coverage = auditPlanningCoverage({ slots, candidates, selections });
  if (coverage.needsProductEvidence) return { status: 'product_evidence_incomplete',
    alternatives: [], trials: 0, placementIssues: [] };
  const baseline = initialReview || await bindReviewedPlanningScene({ project, selections, candidates, displayFurniture });
  if (baseline.status === 'bound') return { status: 'current_selection_fits',
    alternatives: [], trials: 0, placementIssues: [] };
  const placementIssues = baseline.placementIssues || [];
  const containers = affectedContainers(project, displayed, placementIssues);
  if (!containers.length) return { status: 'no_movable_container',
    alternatives: [], trials: 0, placementIssues };
  const offsets = [[-250, 0], [250, 0], [0, -250], [0, 250],
    [-500, 0], [500, 0], [0, -500], [0, 500],
    [-1000, 0], [1000, 0], [0, -1000], [0, 1000]];
  const alternatives = [];
  let trials = 0;
  search: for (const [dx, dy] of offsets) for (const container of containers) {
    if (trials >= maxTrials || alternatives.length >= maxAlternatives) break search;
    const move = containerMove(project, container, dx, dy);
    if (!move) continue;
    trials++;
    if (!layoutValid(move.trial, { kind: container.kind, containerId: container.id })) continue;
    const review = await bindReviewedPlanningScene({ project: move.trial, selections, candidates, displayFurniture });
    if (review.status === 'bound') alternatives.push({ ...move.change, reviewStatus: 'whole_scene_passed' });
  }
  return { status: alternatives.length ? 'alternatives_found' : 'no_container_move_found',
    alternatives, trials, placementIssues, trialLimitReached: trials >= maxTrials };
}

// Two distinct affected rooms/zones may each need a small shift. The trial
// limit includes rejected concept layouts; suggestions are never applied here.
export async function reviewPlanningContainerPairs({ project, selections, candidates,
  displayFurniture, layoutValid, initialReview = null, maxTrials = 16, maxAlternatives = 2 }) {
  if (!project || !Array.isArray(project.objects) || !Array.isArray(project.furniture) ||
      !Array.isArray(selections) || !Array.isArray(candidates) || typeof displayFurniture !== 'function' ||
      typeof layoutValid !== 'function' || !Number.isInteger(maxTrials) || maxTrials < 1 || maxTrials > 50 ||
      !Number.isInteger(maxAlternatives) || maxAlternatives < 1 || maxAlternatives > 10) {
    throw new TypeError('Container pair review needs a scene, catalog, layout check and bounded trials');
  }
  const displayed = displayFurniture(project), slots = buildProductSlots(displayed);
  const coverage = auditPlanningCoverage({ slots, candidates, selections });
  if (coverage.needsProductEvidence) return { status: 'product_evidence_incomplete',
    alternatives: [], trials: 0, placementIssues: [] };
  const baseline = initialReview || await bindReviewedPlanningScene({ project, selections, candidates, displayFurniture });
  if (baseline.status === 'bound') return { status: 'current_selection_fits',
    alternatives: [], trials: 0, placementIssues: [] };
  const placementIssues = baseline.placementIssues || [];
  const containers = affectedContainers(project, displayed, placementIssues);
  if (containers.length < 2) return { status: 'no_container_pair_to_check',
    alternatives: [], trials: 0, placementIssues };
  const offsets = [[-250, 0], [250, 0], [0, -250], [0, 250],
    [-500, 0], [500, 0], [0, -500], [0, 500]];
  const alternatives = [];
  let trials = 0;
  search: for (let i = 0; i < containers.length; i++) for (let j = i + 1; j < containers.length; j++) {
    for (const [firstDx, firstDy] of offsets) for (const [secondDx, secondDy] of offsets) {
      if (trials >= maxTrials || alternatives.length >= maxAlternatives) break search;
      const first = containerMove(project, containers[i], firstDx, firstDy);
      if (!first) continue;
      const second = containerMove(first.trial, containers[j], secondDx, secondDy);
      if (!second) continue;
      trials++;
      const targets = [first.change, second.change].map(change =>
        ({ kind: change.kind, containerId: change.containerId }));
      if (!targets.every(target => layoutValid(second.trial, target))) continue;
      const review = await bindReviewedPlanningScene({ project: second.trial, selections, candidates, displayFurniture });
      if (review.status === 'bound') alternatives.push({ changes: [first.change, second.change],
        reviewStatus: 'whole_scene_passed' });
    }
  }
  return { status: alternatives.length ? 'alternatives_found' : 'no_container_pair_found',
    alternatives, trials, placementIssues, trialLimitReached: trials >= maxTrials };
}

// Try a small, explicit set of room-internal orientations after product swaps
// and whole-container moves fail. Furniture count and stable instance IDs are
// supplied by displayFurniture and verified again by the complete scene bind.
export async function reviewPlanningRoomLayouts({ project, selections, candidates,
  displayFurniture, layoutValid, initialReview = null, maxTrials = 12, maxAlternatives = 2 }) {
  if (!project || !Array.isArray(project.objects) || !Array.isArray(project.furniture) ||
      !Array.isArray(selections) || !Array.isArray(candidates) || typeof displayFurniture !== 'function' ||
      typeof layoutValid !== 'function' || !Number.isInteger(maxTrials) || maxTrials < 1 || maxTrials > 50 ||
      !Number.isInteger(maxAlternatives) || maxAlternatives < 1 || maxAlternatives > 10) {
    throw new TypeError('Room layout review needs a scene, catalog, layout check and bounded trials');
  }
  const displayed = displayFurniture(project), slots = buildProductSlots(displayed);
  const coverage = auditPlanningCoverage({ slots, candidates, selections });
  if (coverage.needsProductEvidence) return { status: 'product_evidence_incomplete',
    alternatives: [], trials: 0, placementIssues: [] };
  const baseline = initialReview || await bindReviewedPlanningScene({ project, selections, candidates, displayFurniture });
  if (baseline.status === 'bound') return { status: 'current_selection_fits',
    alternatives: [], trials: 0, placementIssues: [] };
  const placementIssues = baseline.placementIssues || [], affected = new Set(
    placementIssues.flatMap(issue => issue.instanceIds || []));
  const roomIds = new Set(displayed.filter(item => affected.has(item.id) && item.roomId).map(item => item.roomId));
  const rooms = project.objects.filter(item => item.type === 'room' && roomIds.has(item.id));
  if (!rooms.length) return { status: 'no_room_layout_to_check',
    alternatives: [], trials: 0, placementIssues };
  const modes = ['rotate_cw', 'rotate_180', 'rotate_ccw', 'mirror_x', 'mirror_y', 'base'];
  const alternatives = [];
  let trials = 0;
  search: for (const room of rooms) {
    const from = room.furnitureLayout || 'base';
    for (const mode of modes) {
      if (mode === from) continue;
      if (trials >= maxTrials || alternatives.length >= maxAlternatives) break search;
      trials++;
      const trial = { ...project, objects: project.objects.map(item => {
        if (item.id !== room.id) return item;
        const changed = { ...item };
        if (mode === 'base') delete changed.furnitureLayout;
        else changed.furnitureLayout = mode;
        return changed;
      }) };
      const target = { kind: 'room', containerId: room.id };
      if (!layoutValid(trial, target)) continue;
      const review = await bindReviewedPlanningScene({ project: trial, selections, candidates, displayFurniture });
      if (review.status === 'bound') alternatives.push({ containerId: room.id, from, to: mode,
        reviewStatus: 'whole_scene_passed' });
    }
  }
  return { status: alternatives.length ? 'alternatives_found' : 'no_room_layout_found',
    alternatives, trials, placementIssues, trialLimitReached: trials >= maxTrials };
}

// After room-wide transforms fail, try moving one affected physical item by a
// small grid step. Stable instance IDs remain unchanged and every suggestion
// must pass both the room concept check and the complete product scene review.
export async function reviewPlanningRoomItemMoves({ project, selections, candidates,
  displayFurniture, layoutValid, initialReview = null, maxTrials = 16, maxAlternatives = 2 }) {
  if (!project || !Array.isArray(project.objects) || !Array.isArray(project.furniture) ||
      !Array.isArray(selections) || !Array.isArray(candidates) || typeof displayFurniture !== 'function' ||
      typeof layoutValid !== 'function' || !Number.isInteger(maxTrials) || maxTrials < 1 || maxTrials > 50 ||
      !Number.isInteger(maxAlternatives) || maxAlternatives < 1 || maxAlternatives > 10) {
    throw new TypeError('Room item move review needs a scene, catalog, layout check and bounded trials');
  }
  const displayed = displayFurniture(project), slots = buildProductSlots(displayed);
  const coverage = auditPlanningCoverage({ slots, candidates, selections });
  if (coverage.needsProductEvidence) return { status: 'product_evidence_incomplete',
    alternatives: [], trials: 0, placementIssues: [] };
  const baseline = initialReview || await bindReviewedPlanningScene({ project, selections, candidates, displayFurniture });
  if (baseline.status === 'bound') return { status: 'current_selection_fits',
    alternatives: [], trials: 0, placementIssues: [] };
  const placementIssues = baseline.placementIssues || [], affected = new Set(
    placementIssues.flatMap(issue => issue.instanceIds || []));
  const roomById = new Map(project.objects.filter(item => item.type === 'room').map(room => [room.id, room]));
  const movable = displayed.filter(item => affected.has(item.id) && item.roomId && roomById.has(item.roomId) &&
    item.id.startsWith(`${item.roomId}-`) && Number.isFinite(item.x) && Number.isFinite(item.y));
  if (!movable.length) return { status: 'no_room_item_to_move',
    alternatives: [], trials: 0, placementIssues };
  const offsets = [[-250, 0], [250, 0], [0, -250], [0, 250],
    [-500, 0], [500, 0], [0, -500], [0, 500]];
  const alternatives = [];
  let trials = 0;
  search: for (const item of movable) {
    const room = roomById.get(item.roomId), from = room.furnitureItemOffsets?.[item.id] || { dx: 0, dy: 0 };
    if (!Number.isInteger(from.dx) || !Number.isInteger(from.dy)) continue;
    for (const [dx, dy] of offsets) {
      if (trials >= maxTrials || alternatives.length >= maxAlternatives) break search;
      const to = { dx: from.dx + dx, dy: from.dy + dy };
      if (Math.abs(to.dx) > 5000 || Math.abs(to.dy) > 5000) continue;
      trials++;
      const trial = { ...project, objects: project.objects.map(current => {
        if (current.id !== room.id) return current;
        const furnitureItemOffsets = { ...(current.furnitureItemOffsets || {}) };
        if (to.dx || to.dy) furnitureItemOffsets[item.id] = to;
        else delete furnitureItemOffsets[item.id];
        const changed = { ...current };
        if (Object.keys(furnitureItemOffsets).length) changed.furnitureItemOffsets = furnitureItemOffsets;
        else delete changed.furnitureItemOffsets;
        return changed;
      }) };
      const target = { kind: 'room', containerId: room.id };
      if (!layoutValid(trial, target)) continue;
      const review = await bindReviewedPlanningScene({ project: trial, selections, candidates, displayFurniture });
      if (review.status === 'bound') alternatives.push({ containerId: room.id,
        sourceInstanceId: item.id, from: { ...from }, to,
        reviewStatus: 'whole_scene_passed' });
    }
  }
  return { status: alternatives.length ? 'alternatives_found' : 'no_room_item_move_found',
    alternatives, trials, placementIssues, trialLimitReached: trials >= maxTrials };
}

// If neither item can move far enough alone, try two affected physical items
// in the same room. This remains a bounded grid search and never edits the
// source project or changes furniture membership and stable IDs.
export async function reviewPlanningRoomItemPairs({ project, selections, candidates,
  displayFurniture, layoutValid, initialReview = null, maxTrials = 24, maxAlternatives = 2 }) {
  if (!project || !Array.isArray(project.objects) || !Array.isArray(project.furniture) ||
      !Array.isArray(selections) || !Array.isArray(candidates) || typeof displayFurniture !== 'function' ||
      typeof layoutValid !== 'function' || !Number.isInteger(maxTrials) || maxTrials < 1 || maxTrials > 50 ||
      !Number.isInteger(maxAlternatives) || maxAlternatives < 1 || maxAlternatives > 10) {
    throw new TypeError('Room item pair review needs a scene, catalog, layout check and bounded trials');
  }
  const displayed = displayFurniture(project), slots = buildProductSlots(displayed);
  const coverage = auditPlanningCoverage({ slots, candidates, selections });
  if (coverage.needsProductEvidence) return { status: 'product_evidence_incomplete',
    alternatives: [], trials: 0, placementIssues: [] };
  const baseline = initialReview || await bindReviewedPlanningScene({ project, selections, candidates, displayFurniture });
  if (baseline.status === 'bound') return { status: 'current_selection_fits',
    alternatives: [], trials: 0, placementIssues: [] };
  const placementIssues = baseline.placementIssues || [], affected = new Set(
    placementIssues.flatMap(issue => issue.instanceIds || []));
  const roomById = new Map(project.objects.filter(item => item.type === 'room').map(room => [room.id, room]));
  const movable = displayed.filter(item => affected.has(item.id) && item.roomId && roomById.has(item.roomId) &&
    item.id.startsWith(`${item.roomId}-`) && Number.isFinite(item.x) && Number.isFinite(item.y));
  const pairs = [];
  for (let i = 0; i < movable.length; i++) for (let j = i + 1; j < movable.length; j++) {
    if (movable[i].roomId === movable[j].roomId) pairs.push([movable[i], movable[j]]);
  }
  if (!pairs.length) return { status: 'no_room_item_pair_to_move',
    alternatives: [], trials: 0, placementIssues };
  const offsets = [[-250, 0], [250, 0], [0, -250], [0, 250],
    [-500, 0], [500, 0], [0, -500], [0, 500]];
  const alternatives = [];
  let trials = 0;
  search: for (const [first, second] of pairs) {
    const room = roomById.get(first.roomId), firstFrom = room.furnitureItemOffsets?.[first.id] || { dx: 0, dy: 0 },
      secondFrom = room.furnitureItemOffsets?.[second.id] || { dx: 0, dy: 0 };
    if (![firstFrom.dx, firstFrom.dy, secondFrom.dx, secondFrom.dy].every(Number.isInteger)) continue;
    for (const [firstDx, firstDy] of offsets) for (const [secondDx, secondDy] of offsets) {
      if (trials >= maxTrials || alternatives.length >= maxAlternatives) break search;
      const firstTo = { dx: firstFrom.dx + firstDx, dy: firstFrom.dy + firstDy },
        secondTo = { dx: secondFrom.dx + secondDx, dy: secondFrom.dy + secondDy };
      if ([firstTo.dx, firstTo.dy, secondTo.dx, secondTo.dy].some(value => Math.abs(value) > 5000)) continue;
      trials++;
      const trial = { ...project, objects: project.objects.map(current => {
        if (current.id !== room.id) return current;
        const furnitureItemOffsets = { ...(current.furnitureItemOffsets || {}) };
        for (const [id, to] of [[first.id, firstTo], [second.id, secondTo]]) {
          if (to.dx || to.dy) furnitureItemOffsets[id] = to;
          else delete furnitureItemOffsets[id];
        }
        const changed = { ...current };
        if (Object.keys(furnitureItemOffsets).length) changed.furnitureItemOffsets = furnitureItemOffsets;
        else delete changed.furnitureItemOffsets;
        return changed;
      }) };
      const target = { kind: 'room', containerId: room.id };
      if (!layoutValid(trial, target)) continue;
      const review = await bindReviewedPlanningScene({ project: trial, selections, candidates, displayFurniture });
      if (review.status === 'bound') alternatives.push({ containerId: room.id, changes: [
        { sourceInstanceId: first.id, from: { ...firstFrom }, to: firstTo },
        { sourceInstanceId: second.id, from: { ...secondFrom }, to: secondTo },
      ], reviewStatus: 'whole_scene_passed' });
    }
  }
  return { status: alternatives.length ? 'alternatives_found' : 'no_room_item_pair_found',
    alternatives, trials, placementIssues, trialLimitReached: trials >= maxTrials };
}

// Rotate one affected physical item in place after bounded translations fail.
// Values are quarter-turn deltas from the generated room orientation.
export async function reviewPlanningRoomItemRotations({ project, selections, candidates,
  displayFurniture, layoutValid, initialReview = null, maxTrials = 12, maxAlternatives = 2 }) {
  if (!project || !Array.isArray(project.objects) || !Array.isArray(project.furniture) ||
      !Array.isArray(selections) || !Array.isArray(candidates) || typeof displayFurniture !== 'function' ||
      typeof layoutValid !== 'function' || !Number.isInteger(maxTrials) || maxTrials < 1 || maxTrials > 50 ||
      !Number.isInteger(maxAlternatives) || maxAlternatives < 1 || maxAlternatives > 10) {
    throw new TypeError('Room item rotation review needs a scene, catalog, layout check and bounded trials');
  }
  const displayed = displayFurniture(project), slots = buildProductSlots(displayed);
  const coverage = auditPlanningCoverage({ slots, candidates, selections });
  if (coverage.needsProductEvidence) return { status: 'product_evidence_incomplete',
    alternatives: [], trials: 0, placementIssues: [] };
  const baseline = initialReview || await bindReviewedPlanningScene({ project, selections, candidates, displayFurniture });
  if (baseline.status === 'bound') return { status: 'current_selection_fits',
    alternatives: [], trials: 0, placementIssues: [] };
  const placementIssues = baseline.placementIssues || [], affected = new Set(
    placementIssues.flatMap(issue => issue.instanceIds || []));
  const roomById = new Map(project.objects.filter(item => item.type === 'room').map(room => [room.id, room]));
  const movable = displayed.filter(item => affected.has(item.id) && item.roomId && roomById.has(item.roomId) &&
    item.id.startsWith(`${item.roomId}-`) && Number.isFinite(item.x) && Number.isFinite(item.y));
  if (!movable.length) return { status: 'no_room_item_to_rotate',
    alternatives: [], trials: 0, placementIssues };
  const modes = [90, 270, 180, 0], alternatives = [];
  let trials = 0;
  search: for (const item of movable) {
    const room = roomById.get(item.roomId), from = room.furnitureItemRotations?.[item.id] || 0;
    if (![0, 90, 180, 270].includes(from)) continue;
    for (const to of modes) {
      if (to === from) continue;
      if (trials >= maxTrials || alternatives.length >= maxAlternatives) break search;
      trials++;
      const trial = { ...project, objects: project.objects.map(current => {
        if (current.id !== room.id) return current;
        const furnitureItemRotations = { ...(current.furnitureItemRotations || {}) }, changed = { ...current };
        if (to) furnitureItemRotations[item.id] = to;
        else delete furnitureItemRotations[item.id];
        if (Object.keys(furnitureItemRotations).length) changed.furnitureItemRotations = furnitureItemRotations;
        else delete changed.furnitureItemRotations;
        return changed;
      }) };
      const target = { kind: 'room', containerId: room.id };
      if (!layoutValid(trial, target)) continue;
      const review = await bindReviewedPlanningScene({ project: trial, selections, candidates, displayFurniture });
      if (review.status === 'bound') alternatives.push({ containerId: room.id,
        sourceInstanceId: item.id, from, to, reviewStatus: 'whole_scene_passed' });
    }
  }
  return { status: alternatives.length ? 'alternatives_found' : 'no_room_item_rotation_found',
    alternatives, trials, placementIssues, trialLimitReached: trials >= maxTrials };
}

// Swap the occupied positions of two stable physical instances in one room.
// At least one member must be named by the baseline placement failure.
export async function reviewPlanningRoomItemSwaps({ project, selections, candidates,
  displayFurniture, layoutValid, initialReview = null, maxTrials = 12, maxAlternatives = 2 }) {
  if (!project || !Array.isArray(project.objects) || !Array.isArray(project.furniture) ||
      !Array.isArray(selections) || !Array.isArray(candidates) || typeof displayFurniture !== 'function' ||
      typeof layoutValid !== 'function' || !Number.isInteger(maxTrials) || maxTrials < 1 || maxTrials > 50 ||
      !Number.isInteger(maxAlternatives) || maxAlternatives < 1 || maxAlternatives > 10) {
    throw new TypeError('Room item swap review needs a scene, catalog, layout check and bounded trials');
  }
  const displayed = displayFurniture(project), slots = buildProductSlots(displayed);
  const coverage = auditPlanningCoverage({ slots, candidates, selections });
  if (coverage.needsProductEvidence) return { status: 'product_evidence_incomplete',
    alternatives: [], trials: 0, placementIssues: [] };
  const baseline = initialReview || await bindReviewedPlanningScene({ project, selections, candidates, displayFurniture });
  if (baseline.status === 'bound') return { status: 'current_selection_fits',
    alternatives: [], trials: 0, placementIssues: [] };
  const placementIssues = baseline.placementIssues || [], affected = new Set(
    placementIssues.flatMap(issue => issue.instanceIds || []));
  const roomById = new Map(project.objects.filter(item => item.type === 'room').map(room => [room.id, room]));
  const items = displayed.filter(item => item.roomId && roomById.has(item.roomId) &&
    item.id.startsWith(`${item.roomId}-`) && Number.isFinite(item.x) && Number.isFinite(item.y));
  const pairs = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    if (items[i].roomId === items[j].roomId && (affected.has(items[i].id) || affected.has(items[j].id))) {
      pairs.push([items[i], items[j]]);
    }
  }
  if (!pairs.length) return { status: 'no_room_item_swap_to_check',
    alternatives: [], trials: 0, placementIssues };
  const alternatives = [];
  let trials = 0;
  for (const [first, second] of pairs) {
    if (trials >= maxTrials || alternatives.length >= maxAlternatives) break;
    const room = roomById.get(first.roomId), firstFrom = room.furnitureItemOffsets?.[first.id] || { dx: 0, dy: 0 },
      secondFrom = room.furnitureItemOffsets?.[second.id] || { dx: 0, dy: 0 },
      firstTo = { dx: firstFrom.dx + second.x - first.x, dy: firstFrom.dy + second.y - first.y },
      secondTo = { dx: secondFrom.dx + first.x - second.x, dy: secondFrom.dy + first.y - second.y };
    if (![firstFrom.dx, firstFrom.dy, secondFrom.dx, secondFrom.dy, firstTo.dx, firstTo.dy, secondTo.dx, secondTo.dy]
      .every(Number.isInteger) || [firstTo.dx, firstTo.dy, secondTo.dx, secondTo.dy]
      .some(value => Math.abs(value) > 5000) || (first.x === second.x && first.y === second.y)) continue;
    trials++;
    const trial = { ...project, objects: project.objects.map(current => {
      if (current.id !== room.id) return current;
      const furnitureItemOffsets = { ...(current.furnitureItemOffsets || {}) }, changed = { ...current };
      for (const [id, to] of [[first.id, firstTo], [second.id, secondTo]]) {
        if (to.dx || to.dy) furnitureItemOffsets[id] = to;
        else delete furnitureItemOffsets[id];
      }
      if (Object.keys(furnitureItemOffsets).length) changed.furnitureItemOffsets = furnitureItemOffsets;
      else delete changed.furnitureItemOffsets;
      return changed;
    }) };
    const target = { kind: 'room', containerId: room.id };
    if (!layoutValid(trial, target)) continue;
    const review = await bindReviewedPlanningScene({ project: trial, selections, candidates, displayFurniture });
    if (review.status === 'bound') alternatives.push({ containerId: room.id, changes: [
      { sourceInstanceId: first.id, from: { ...firstFrom }, to: firstTo },
      { sourceInstanceId: second.id, from: { ...secondFrom }, to: secondTo },
    ], reviewStatus: 'whole_scene_passed' });
  }
  return { status: alternatives.length ? 'alternatives_found' : 'no_room_item_swap_found',
    alternatives, trials, placementIssues, trialLimitReached: trials >= maxTrials };
}
