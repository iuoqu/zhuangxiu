import { hasVerifiedProductUseSpec, needsProductUseSpec } from './product-use-spec.js';

const sizeFits = (slot, candidate) => {
  const { width, depth } = candidate.dimensionsMm || {};
  const envelope = slot.envelopeMm || {};
  if (![width, depth, envelope.width, envelope.depth].every(value => Number.isFinite(value) && value > 0)) return false;
  return (width <= envelope.width && depth <= envelope.depth) ||
    (depth <= envelope.width && width <= envelope.depth);
};

export function matchProducts(slot, candidates, options = {}) {
  if (!slot || typeof slot.role !== 'string' || !Array.isArray(candidates)) {
    throw new TypeError('Matching needs a product slot and candidate array');
  }
  const matched = [], rejected = [];
  for (const candidate of candidates) {
    const reasons = [];
    if (!slot.category || !candidate.category) reasons.push('category_unknown');
    else if (candidate.category !== slot.category) reasons.push('different_category');
    if (candidate.role !== slot.role) reasons.push('different_role');
    if (!candidate.dimensionsMm?.width || !candidate.dimensionsMm?.depth) reasons.push('missing_dimensions');
    else if (!sizeFits(slot, candidate)) reasons.push('too_large_for_slot');
    if (['out_of_stock', 'discontinued'].includes(candidate.availability)) reasons.push('unavailable');
    if (reasons.length) { rejected.push({ candidateId: candidate.candidateId, reasons }); continue; }
    const warnings = [];
    if (!candidate.supplierSku) warnings.push('missing_supplier_sku');
    if (!candidate.verification?.spec) warnings.push('spec_unverified');
    if (needsProductUseSpec(slot.category) && !hasVerifiedProductUseSpec(candidate)) warnings.push('use_spec_unverified');
    if (!candidate.verification?.availability || candidate.availability !== 'in_stock') warnings.push('supply_unverified');
    if (!candidate.verification?.price || !candidate.price) warnings.push('price_unverified');
    if (candidate.purchaseUnit !== 'single' || !candidate.fieldSources?.purchaseUnit) warnings.push(candidate.purchaseUnit === 'set' ? 'set_requires_component_breakdown' : 'purchase_unit_unknown');
    const sourcingReady = warnings.length === 0;
    const status = sourcingReady ? 'sourcing_ready' : candidate.verification?.spec ? 'fit_candidate' : 'research_candidate';
    const budget = Number.isFinite(options.budgetPerItem) ? options.budgetPerItem : null;
    const overBudget = budget != null && candidate.price?.amount > budget;
    const maxLeadDays = Number.isFinite(options.maxLeadDays) ? options.maxLeadDays : null;
    const slow = maxLeadDays != null && candidate.leadDays != null && candidate.leadDays > maxLeadDays;
    matched.push({ candidateId: candidate.candidateId, candidate, status, warnings, overBudget, slow });
  }
  matched.sort((a, b) =>
    Number(a.status !== 'sourcing_ready') - Number(b.status !== 'sourcing_ready') ||
    Number(a.overBudget) - Number(b.overBudget) ||
    Number(a.slow) - Number(b.slow) ||
    a.warnings.length - b.warnings.length ||
    (a.candidate.price?.amount ?? Infinity) - (b.candidate.price?.amount ?? Infinity) ||
    a.candidateId.localeCompare(b.candidateId)
  );
  return { matches: matched.slice(0, options.maxResults ?? 3), rejected };
}
