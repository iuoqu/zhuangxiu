import { buildProductSlots } from './product-slots.js';
import { reviewProductPlacement } from './product-placement.js';

// Returns a new project only after verified dimensions and a full planning-geometry
// review pass. Candidate data and the original project are never mutated.
export async function bindProductToProject({ project, sourceInstanceId, candidate, profilesByInstanceId, displayFurniture }) {
  if (!project || !Array.isArray(project.furniture) || typeof sourceInstanceId !== 'string' || !candidate || typeof displayFurniture !== 'function') {
    throw new TypeError('Binding needs a project, furniture instance, candidate and display expansion');
  }
  const original = project.furniture.find(item => item.id === sourceInstanceId);
  if (!original) return { status: 'unsupported_instance', reasons: ['derived_furniture_binding_not_available'], project };
  if (candidate.purchaseUnit !== 'single' || !candidate.supplierSku || !candidate.verification?.spec) {
    return { status: 'rejected', reasons: ['candidate_not_verified_single_unit'], project };
  }
  const dimensions = candidate.dimensionsMm || {};
  if (![dimensions.width, dimensions.depth, dimensions.height].every(value => Number.isFinite(value) && value > 0)) {
    return { status: 'rejected', reasons: ['candidate_dimensions_missing'], project };
  }
  const replacement = {
    ...original,
    w: dimensions.width, h: dimensions.depth, z: dimensions.height,
    name: candidate.name || original.name,
    sku: null, price: null, priceStatus: 'pending_product_quote',
    productCandidateId: candidate.candidateId,
  };
  const trial = { ...project, furniture: project.furniture.map(item => item.id === sourceInstanceId ? replacement : { ...item }) };
  const displayItems = displayFurniture(trial);
  const slot = buildProductSlots(displayItems).find(item => item.sourceInstanceId === sourceInstanceId);
  if (!slot) return { status: 'rejected', reasons: ['instance_missing_after_expansion'], project };
  const placementReview = await reviewProductPlacement({ project: trial, displayItems, slot, candidate, profilesByInstanceId });
  if (placementReview.status !== 'passed') return { status: 'rejected', reasons: placementReview.reasons, placementReview, project };
  const binding = { slotId: slot.slotId, candidateId: candidate.candidateId, placementReview };
  trial.productBindings = [...(Array.isArray(project.productBindings) ? project.productBindings : []).filter(item => item.slotId !== slot.slotId), binding];
  return { status: 'bound', project: trial, binding, placementReview, displayItems };
}
