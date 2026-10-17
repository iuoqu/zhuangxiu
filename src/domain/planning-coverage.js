import { hasVerifiedProductUseSpec } from './product-use-spec.js';

const positive = value => Number.isFinite(value) && value > 0;

// Evidence readiness is only the gate for a placement review. Geometry,
// complete source-field reconciliation and a procurement draft follow later.
export function candidateEvidenceGaps(candidate) {
  if (!candidate) return ['candidate_missing'];
  const gaps = [];
  if (!candidate.supplierSku || !candidate.sourceId || !candidate.sourceRef ||
      !Number.isFinite(Date.parse(candidate.observedAt))) gaps.push('product_identity_missing');
  if (!candidate.verification?.spec || ![candidate.dimensionsMm?.width,
    candidate.dimensionsMm?.depth, candidate.dimensionsMm?.height].every(positive)) gaps.push('spec_unverified');
  if (!hasVerifiedProductUseSpec(candidate) || !candidate.useReview?.reviewedBy ||
      !Number.isFinite(Date.parse(candidate.useReview?.reviewedAt))) gaps.push('use_spec_unverified');
  if (candidate.purchaseUnit !== 'single') gaps.push('purchase_unit_not_single');
  if (!candidate.verification?.availability) gaps.push('supply_unverified');
  else if (candidate.availability !== 'in_stock') gaps.push('not_confirmed_in_stock');
  if (!Number.isInteger(candidate.leadDays) || candidate.leadDays < 0) gaps.push('lead_time_unknown');
  if (!candidate.verification?.price || !candidate.price ||
      !Number.isFinite(candidate.price.amount) || candidate.price.amount < 0 ||
      !/^[A-Z]{3}$/.test(candidate.price.currency)) gaps.push('price_unverified');
  return gaps;
}

export function auditPlanningCoverage({ slots, candidates, selections = [] }) {
  if (!Array.isArray(slots) || !Array.isArray(candidates) || !Array.isArray(selections)) {
    throw new TypeError('Coverage needs slots, candidates and selections');
  }
  const selected = new Map();
  for (const value of selections) {
    if (!value || typeof value.sourceInstanceId !== 'string' ||
        selected.has(value.sourceInstanceId)) throw new TypeError('Coverage selections need unique instance IDs');
    selected.set(value.sourceInstanceId, value.candidateId || null);
  }
  const byId = new Map(candidates.map(candidate => [candidate.candidateId, candidate]));
  if (byId.size !== candidates.length) throw new TypeError('Catalog candidate IDs must be unique');
  const lines = slots.map(slot => {
    const matches = candidates.filter(candidate => candidate.category === slot.category && candidate.role === slot.role);
    const ready = matches.filter(candidate => candidateEvidenceGaps(candidate).length === 0);
    const candidateId = selected.get(slot.sourceInstanceId) || null;
    let reasons = [];
    if (candidateId && !byId.has(candidateId)) reasons = ['selected_candidate_missing'];
    else if (candidateId && (byId.get(candidateId).category !== slot.category ||
        byId.get(candidateId).role !== slot.role)) reasons = ['category_or_role_mismatch'];
    else if (!matches.length) reasons = ['catalog_role_missing'];
    else if (!candidateId) {
      if (ready.length) reasons = ['product_not_selected'];
      else {
        const best = matches.map(candidate => ({ candidate, gaps: candidateEvidenceGaps(candidate) }))
          .sort((a, b) => a.gaps.length - b.gaps.length)[0];
        reasons = ['catalog_evidence_incomplete', ...best.gaps];
      }
    } else {
      reasons = candidateEvidenceGaps(byId.get(candidateId));
    }
    return { sourceInstanceId: slot.sourceInstanceId, slotId: slot.slotId,
      category: slot.category, role: slot.role, label: slot.label,
      candidateId, matchingCandidateCount: matches.length, reviewedCandidateCount: ready.length,
      status: reasons.length ? 'needs_product_evidence' : 'ready_for_placement_review', reasons };
  });
  const roles = new Map();
  for (const line of lines) {
    const key = `${line.category || 'unknown'}:${line.role}`;
    if (!roles.has(key)) roles.set(key, { category: line.category, role: line.role,
      total: 0, readyForPlacementReview: 0, instanceIds: [] });
    const group = roles.get(key);
    group.total++;
    if (line.status === 'ready_for_placement_review') group.readyForPlacementReview++;
    group.instanceIds.push(line.sourceInstanceId);
  }
  return { itemCount: lines.length,
    readyForPlacementReview: lines.filter(line => line.status === 'ready_for_placement_review').length,
    needsProductEvidence: lines.filter(line => line.status !== 'ready_for_placement_review').length,
    lines, roles: [...roles.values()] };
}
