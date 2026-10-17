import { buildProductSlots } from './product-slots.js';
import { hasVerifiedProductUseSpec, requiredProductUseRects } from './product-use-spec.js';
import { reviewProductPlacement } from './product-placement.js';
import { buildProcurementBom } from './procurement-bom.js';
import { analyzeHomeAssemblies } from './home-assemblies.js';

const supported = new Set(['wardrobe', 'table', 'homeChair', 'vanity', 'sofa', 'coffeeTable', 'lowCabinet', 'bed']);

// Bind a simple home-furniture scene against one layout revision. Derived and
// bundled furniture needs explicit component records before joining this flow.
export async function bindReviewedHomeScene({ project, selections, candidates, displayFurniture }) {
  if (!project || !Array.isArray(project.furniture) || !Array.isArray(selections) || !Array.isArray(candidates) || typeof displayFurniture !== 'function') {
    throw new TypeError('Binding needs a project, selections, candidates and display expansion');
  }
  const unchanged = reasons => ({ status: 'rejected', reasons, project });
  if (!project.furniture.length) return unchanged(['no_furniture']);
  const initialDisplay = displayFurniture(project);
  if (!Array.isArray(initialDisplay) || initialDisplay.length !== project.furniture.length ||
      project.furniture.some(item => !supported.has(item.kind)) ||
      initialDisplay.some(item => !project.furniture.some(primary => primary.id === item.id))) {
    return unchanged(['scene_has_unsupported_or_derived_furniture']);
  }
  const assemblies = analyzeHomeAssemblies(project.furniture);
  if (assemblies.errors.length) return unchanged(assemblies.errors);
  const selected = new Map(), byCandidateId = new Map();
  for (const candidate of candidates) {
    if (candidate?.candidateId) byCandidateId.set(candidate.candidateId, candidate);
  }
  for (const selection of selections) {
    if (!selection || typeof selection.sourceInstanceId !== 'string' || selected.has(selection.sourceInstanceId)) return unchanged(['duplicate_or_invalid_selection']);
    selected.set(selection.sourceInstanceId, byCandidateId.get(selection.candidateId));
  }
  if (selected.size !== project.furniture.length || project.furniture.some(item => !selected.get(item.id))) return unchanged(['one_product_required_per_instance']);
  const slots = buildProductSlots(initialDisplay);
  for (const slot of slots) {
    const candidate = selected.get(slot.sourceInstanceId);
    if (candidate.category !== slot.category || candidate.role !== slot.role) return unchanged([`category_or_role_mismatch:${slot.sourceInstanceId}`]);
    if (candidate.purchaseUnit !== 'single') return unchanged([`purchase_unit_not_single:${slot.sourceInstanceId}`]);
    if (!candidate.verification?.spec || !hasVerifiedProductUseSpec(candidate) ||
        !candidate.useReview?.reviewedBy || !Number.isFinite(Date.parse(candidate.useReview?.reviewedAt))) {
      return unchanged([`product_use_spec_unverified:${slot.sourceInstanceId}`]);
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
  };
  const displayItems = displayFurniture(trial);
  const trialSlots = buildProductSlots(displayItems);
  const profiles = Object.fromEntries(trial.furniture.map(item => {
    const candidate = selected.get(item.id);
    return [item.id, { verified: true, reviewedBy: candidate.useReview.reviewedBy, reviewedAt: candidate.useReview.reviewedAt,
      candidateId: candidate.candidateId, sourceRef: candidate.sourceRef, observedAt: candidate.observedAt,
      dimensionsMm: { ...candidate.dimensionsMm }, clearanceRects: requiredProductUseRects(candidate) }];
  }));
  const bindings = [];
  for (const slot of trialSlots) {
    const candidate = selected.get(slot.sourceInstanceId);
    const placementReview = await reviewProductPlacement({ project: trial, displayItems, slot, candidate, profilesByInstanceId: profiles });
    if (placementReview.status !== 'passed') return unchanged(placementReview.reasons.map(reason => `${slot.sourceInstanceId}:${reason}`));
    bindings.push({ slotId: slot.slotId, candidateId: candidate.candidateId, placementReview });
  }
  const procurementDraft = buildProcurementBom({ slots: trialSlots, bindings, candidates,
    layoutRevision: bindings[0].placementReview.layoutRevision });
  if (procurementDraft.pendingCount) return { ...unchanged(['product_or_supply_evidence_incomplete']), procurementDraft };
  trial.productBindings = bindings;
  trial.productProfiles = profiles;
  return { status: 'bound', project: trial, displayItems, procurementDraft };
}
