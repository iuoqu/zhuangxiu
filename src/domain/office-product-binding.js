import { buildProductSlots } from './product-slots.js';
import { hasVerifiedProductUseSpec, requiredProductUseRects } from './product-use-spec.js';
import { reviewProductPlacement } from './product-placement.js';
import { buildProcurementBom } from './procurement-bom.js';
import { seatingRelation } from './home-assemblies.js';

// A first office slice: individual desks, their generated seats, meeting
// furniture, phone booths and storage. Other room equipment remains pending.
export const OFFICE_PRODUCT_KINDS = Object.freeze([
  'desk', 'bench2', 'cubicle', 'manager', 'chair', 'meeting', 'meetingModular',
  'meetingChair', 'phone', 'cabinet', 'shelf', 'locker',
]);
const supported = new Set(OFFICE_PRODUCT_KINDS);

export function isOfficeProductScene(project, displayItems) {
  return Array.isArray(project?.furniture) && Array.isArray(displayItems) && displayItems.length > 0 &&
    displayItems.every(item => supported.has(item.kind)) &&
    project.furniture.every(item => supported.has(item.kind));
}

export async function bindReviewedOfficeScene({ project, selections, candidates, displayFurniture }) {
  if (!project || !Array.isArray(selections) || !Array.isArray(candidates) || typeof displayFurniture !== 'function') {
    throw new TypeError('Office binding needs a project, selections, candidates and display expansion');
  }
  const reject = reasons => ({ status: 'rejected', reasons, project });
  const initial = displayFurniture(project);
  if (!isOfficeProductScene(project, initial)) return reject(['scene_has_unsupported_furniture']);
  const primaryIds = new Set(project.furniture.map(item => item.id));
  const initialIds = new Set(initial.map(item => item.id));
  if (initialIds.size !== initial.length || project.furniture.some(item => !initialIds.has(item.id))) return reject(['instance_ids_invalid']);
  for (const item of initial) {
    if (primaryIds.has(item.id)) continue;
    if (['chair', 'meetingChair'].includes(item.kind) && !item.linkedTo) return reject([`derived_relation_missing:${item.id}`]);
    if (!item.linkedTo) continue;
    const anchor = initial.find(other => other.id === item.linkedTo);
    if (!anchor || !seatingRelation(anchor, item)) return reject([`derived_relation_invalid:${item.id}`]);
  }
  const byCandidate = new Map(candidates.map(candidate => [candidate.candidateId, candidate]));
  const selected = new Map();
  for (const selection of selections) {
    if (!selection || typeof selection.sourceInstanceId !== 'string' || selected.has(selection.sourceInstanceId)) return reject(['duplicate_or_invalid_selection']);
    selected.set(selection.sourceInstanceId, byCandidate.get(selection.candidateId));
  }
  if (selected.size !== initial.length || initial.some(item => !selected.get(item.id))) return reject(['one_product_required_per_instance']);
  const slots = buildProductSlots(initial);
  for (const slot of slots) {
    const candidate = selected.get(slot.sourceInstanceId);
    if (candidate.category !== slot.category || candidate.role !== slot.role) return reject([`category_or_role_mismatch:${slot.sourceInstanceId}`]);
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
      return { ...item, w: candidate.dimensionsMm.width, h: candidate.dimensionsMm.depth,
        z: candidate.dimensionsMm.height, name: candidate.name || item.name,
        sku: null, price: null, priceStatus: 'pending_product_quote', productCandidateId: candidate.candidateId };
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
  if (!Array.isArray(displayed) || displayed.length !== initial.length ||
      displayed.some(item => !initialIds.has(item.id) || !selected.has(item.id))) return reject(['derived_instances_changed']);
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
    if (review.status !== 'passed') return reject(review.reasons.map(reason => `${slot.sourceInstanceId}:${reason}`));
    bindings.push({ slotId: slot.slotId, candidateId: candidate.candidateId, placementReview: review });
  }
  const procurementDraft = buildProcurementBom({ slots: buildProductSlots(displayed), bindings, candidates,
    layoutRevision: bindings[0].placementReview.layoutRevision });
  if (procurementDraft.pendingCount) return { ...reject(['product_or_supply_evidence_incomplete']), procurementDraft };
  trial.productBindings = bindings;
  trial.productProfiles = profiles;
  return { status: 'bound', project: trial, displayItems: displayed, procurementDraft };
}
