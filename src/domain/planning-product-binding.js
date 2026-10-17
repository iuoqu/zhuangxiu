import { buildProductSlots } from './product-slots.js';
import { sceneFurnitureType } from './furniture-taxonomy.js';
import { hasVerifiedProductUseSpec, requiredProductUseRects } from './product-use-spec.js';
import { seatingRelation } from './home-assemblies.js';
import { reviewProductPlacement } from './product-placement.js';
import { buildProcurementBom } from './procurement-bom.js';

// These are layout footprints, not product slots. Their children have stable
// IDs and must all be present before a complete scene can be reviewed.
const components = Object.freeze({
  dining4: Object.freeze({ table: 'diningTable', 'chair-west': 'diningChair',
    'chair-east': 'diningChair', 'chair-north': 'diningChair', 'chair-south': 'diningChair' }),
  lounge2: Object.freeze({ sofa: 'sofa', table: 'sideTable' }),
});
const physicalKind = kind => !!sceneFurnitureType(kind).category && !Object.hasOwn(components, kind);
const validLink = (anchor, member) => seatingRelation(anchor, member) ||
  (anchor?.kind === 'sofa' && ['sideTable', 'coffeeTable'].includes(member.kind) && member.linkedTo === anchor.id);

export function isPlanningProductScene(project, displayed) {
  if (!project || !Array.isArray(project.objects) || !Array.isArray(project.furniture) ||
      !Array.isArray(displayed) || !displayed.length || displayed.some(item => !physicalKind(item.kind))) return false;
  const byId = new Map(displayed.map(item => [item.id, item]));
  if (byId.size !== displayed.length || new Set(project.furniture.map(item => item.id)).size !== project.furniture.length) return false;
  for (const parent of project.furniture) {
    if (physicalKind(parent.kind)) {
      if (byId.get(parent.id)?.kind !== parent.kind) return false;
    } else if (!components[parent.kind] || byId.has(parent.id)) return false;
  }
  const footprints = [
    ...project.furniture.filter(item => components[item.kind]).map(item => ({ id: item.id, kind: item.kind })),
    ...project.objects.filter(item => item.type === 'room' && ['collaboration', 'waiting', 'canteen'].includes(item.kind))
      .map(item => ({ id: `${item.id}-seating`, kind: item.kind === 'canteen' ? 'dining4' : 'lounge2' })),
  ];
  if (footprints.some(parent => Object.entries(components[parent.kind]).some(([suffix, kind]) =>
    byId.get(`${parent.id}-${suffix}`)?.kind !== kind))) return false;
  if (project.objects.some(item => ['room', 'zone'].includes(item.type) &&
      !displayed.some(child => child.roomId === item.id || child.zoneId === item.id))) return false;
  for (const item of displayed) {
    if (item.linkedTo && !validLink(byId.get(item.linkedTo), item)) return false;
    if (['chair', 'meetingChair', 'diningChair', 'barStool'].includes(item.kind) &&
        !project.furniture.some(parent => parent.id === item.id) && !item.linkedTo) return false;
  }
  return true;
}

export async function bindReviewedPlanningScene({ project, selections, candidates, displayFurniture }) {
  if (!project || !Array.isArray(selections) || !Array.isArray(candidates) || typeof displayFurniture !== 'function') {
    throw new TypeError('Planning binding needs a project, selections, candidates and display expansion');
  }
  const reject = reasons => ({ status: 'rejected', reasons, project });
  const initial = displayFurniture(project);
  if (!isPlanningProductScene(project, initial)) return reject(['scene_instances_or_relations_invalid']);
  const primaryIds = new Set(project.furniture.map(item => item.id));
  const initialIds = new Set(initial.map(item => item.id));
  const byCandidate = new Map(candidates.map(candidate => [candidate.candidateId, candidate]));
  const selected = new Map();
  for (const selection of selections) {
    if (!selection || typeof selection.sourceInstanceId !== 'string' || selected.has(selection.sourceInstanceId)) {
      return reject(['duplicate_or_invalid_selection']);
    }
    selected.set(selection.sourceInstanceId, byCandidate.get(selection.candidateId));
  }
  if (selected.size !== initial.length || initial.some(item => !selected.get(item.id))) {
    return reject(['one_product_required_per_instance']);
  }
  for (const slot of buildProductSlots(initial)) {
    const candidate = selected.get(slot.sourceInstanceId);
    if (candidate.category !== slot.category || candidate.role !== slot.role) {
      return reject([`category_or_role_mismatch:${slot.sourceInstanceId}`]);
    }
    if (candidate.purchaseUnit !== 'single') return reject([`purchase_unit_not_single:${slot.sourceInstanceId}`]);
    if (!candidate.verification?.spec || !hasVerifiedProductUseSpec(candidate) ||
        !candidate.useReview?.reviewedBy || !Number.isFinite(Date.parse(candidate.useReview.reviewedAt))) {
      return reject([`product_use_spec_unverified:${slot.sourceInstanceId}`]);
    }
  }
  const trial = {
    ...project,
    furniture: project.furniture.map(item => {
      const candidate = selected.get(item.id);
      return !candidate ? { ...item } : { ...item,
        w: candidate.dimensionsMm.width, h: candidate.dimensionsMm.depth, z: candidate.dimensionsMm.height,
        name: candidate.name || item.name, sku: null, price: null,
        priceStatus: 'pending_product_quote', productCandidateId: candidate.candidateId };
    }),
    derivedProducts: Object.fromEntries(initial.filter(item => !primaryIds.has(item.id)).map(item => {
      const candidate = selected.get(item.id);
      return [item.id, { w: candidate.dimensionsMm.width, h: candidate.dimensionsMm.depth,
        z: candidate.dimensionsMm.height, name: candidate.name || item.name,
        productCandidateId: candidate.candidateId }];
    })),
    setSelections: [],
  };
  const displayed = displayFurniture(trial);
  if (!isPlanningProductScene(trial, displayed) || displayed.length !== initial.length ||
      displayed.some(item => !initialIds.has(item.id) || !selected.has(item.id))) {
    return reject(['derived_instances_changed']);
  }
  for (const item of displayed) {
    const candidate = selected.get(item.id);
    if (item.w !== candidate.dimensionsMm.width || item.h !== candidate.dimensionsMm.depth ||
        item.z !== candidate.dimensionsMm.height) return reject([`product_dimensions_not_applied:${item.id}`]);
  }
  const profiles = Object.fromEntries(displayed.map(item => {
    const candidate = selected.get(item.id);
    return [item.id, { verified: true, reviewedBy: candidate.useReview.reviewedBy,
      reviewedAt: candidate.useReview.reviewedAt, candidateId: candidate.candidateId,
      sourceRef: candidate.sourceRef, observedAt: candidate.observedAt,
      dimensionsMm: { ...candidate.dimensionsMm }, clearanceRects: requiredProductUseRects(candidate) }];
  }));
  const bindings = [];
  for (const slot of buildProductSlots(displayed)) {
    const candidate = selected.get(slot.sourceInstanceId);
    const review = await reviewProductPlacement({ project: trial, displayItems: displayed, slot,
      candidate, profilesByInstanceId: profiles });
    if (review.status !== 'passed') {
      const placementIssues = review.issues?.length ? review.issues : review.reasons.map(reason => ({ reason, instanceIds: [] }));
      return { ...reject(placementIssues.map(issue =>
        `${issue.instanceIds.length ? issue.instanceIds.join('+') : 'scene'}:${issue.reason}`)), placementIssues };
    }
    bindings.push({ slotId: slot.slotId, candidateId: candidate.candidateId, placementReview: review });
  }
  const procurementDraft = buildProcurementBom({ slots: buildProductSlots(displayed), bindings, candidates,
    layoutRevision: bindings[0].placementReview.layoutRevision });
  if (procurementDraft.pendingCount) return { ...reject(['product_or_supply_evidence_incomplete']), procurementDraft };
  trial.productBindings = bindings;
  trial.productProfiles = profiles;
  return { status: 'bound', project: trial, displayItems: displayed, procurementDraft };
}
