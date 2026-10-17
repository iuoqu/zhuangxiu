// A procurement draft is derived from explicit slot bindings. Research candidates and
// illustrative scene SKUs never become purchasable lines by appearing in the layout.
import { hasVerifiedProductUseSpec, needsProductUseSpec } from './product-use-spec.js';
const positive = value => Number.isFinite(value) && value > 0;
const sourceFact = (candidate, field, expected) => {
  const fact = candidate.fieldSources?.[field];
  if (!(fact?.sourceRef === candidate.sourceRef &&
    fact?.observedAt === candidate.observedAt &&
    typeof fact.raw === 'string' && fact.raw.trim().length > 0)) return false;
  if (typeof expected === 'number') return Number(fact.raw) === expected;
  const raw = fact.raw.trim();
  if (field === 'currency') return raw.toUpperCase() === expected;
  if (field === 'category') return raw.toLowerCase().replace(/[ -]/g, '_') === expected;
  if (field === 'role') return raw.toLowerCase() === expected;
  if (field === 'availability' || field === 'purchaseUnit') return raw.toLowerCase() === expected;
  return raw === expected;
};
const sizeFits = (slot, candidate) => {
  const { width, depth } = candidate.dimensionsMm || {};
  const box = slot.envelopeMm || {};
  return positive(width) && positive(depth) && positive(box.width) && positive(box.depth) &&
    ((width <= box.width && depth <= box.depth) || (depth <= box.width && width <= box.depth));
};
const decimalParts = amount => {
  const [mantissa, exponentText] = amount.toString().split('e');
  const [whole, fraction = ''] = mantissa.split('.');
  const exponent = exponentText ? Number(exponentText) : 0;
  const scale = fraction.length - exponent;
  let units = BigInt(whole + fraction);
  if (scale < 0) units *= 10n ** BigInt(-scale);
  return { units, scale: Math.max(0, scale) };
};
export function exactSum(amounts) {
  const parts = amounts.map(decimalParts), scale = Math.max(...parts.map(part => part.scale));
  const units = parts.reduce((total, part) => total + part.units * 10n ** BigInt(scale - part.scale), 0n);
  if (!scale) return units.toString();
  const digits = units.toString().padStart(scale + 1, '0');
  return `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/0+$/, '').replace(/\.$/, '');
}

function assessBinding(slot, binding, candidate, layoutRevision) {
  if (!binding) return ['needs_product'];
  if (!candidate) return ['candidate_missing'];
  const reasons = [];
  if (!slot.category || candidate.category !== slot.category) reasons.push('category_mismatch');
  if (candidate.role !== slot.role) reasons.push('role_mismatch');
  if (candidate.fieldSources?.category) {
    if (!sourceFact(candidate, 'category', candidate.category)) reasons.push('category_unverified');
  } else if (!sourceFact(candidate, 'role', candidate.role)) reasons.push('category_unverified');
  if (!candidate.supplierSku || !candidate.sourceId || !candidate.sourceRef || !Number.isFinite(Date.parse(candidate.observedAt))) reasons.push('product_identity_missing');
  if (!candidate.verification?.spec || ![candidate.dimensionsMm?.width, candidate.dimensionsMm?.depth, candidate.dimensionsMm?.height].every(positive) ||
      !sourceFact(candidate, 'supplierSku', candidate.supplierSku) ||
      (candidate.variantCode && !sourceFact(candidate, 'variantCode', candidate.variantCode)) ||
      !sourceFact(candidate, 'widthMm', candidate.dimensionsMm.width) ||
      !sourceFact(candidate, 'depthMm', candidate.dimensionsMm.depth) ||
      !sourceFact(candidate, 'heightMm', candidate.dimensionsMm.height)) reasons.push('spec_unverified');
  if (!sizeFits(slot, candidate)) reasons.push('outside_design_envelope');
  if (needsProductUseSpec(slot.category) && !hasVerifiedProductUseSpec(candidate)) reasons.push('use_spec_unverified');
  if (!candidate.verification?.availability || !sourceFact(candidate, 'availability', candidate.availability)) reasons.push('supply_unverified');
  if (candidate.availability !== 'in_stock') reasons.push('not_confirmed_in_stock');
  if (candidate.purchaseUnit !== 'single' || !sourceFact(candidate, 'purchaseUnit', candidate.purchaseUnit)) reasons.push('purchase_unit_not_expanded');
  if (!Number.isInteger(candidate.leadDays) || candidate.leadDays < 0 || !sourceFact(candidate, 'leadDays', candidate.leadDays)) reasons.push('lead_time_unknown');
  if (!candidate.verification?.price || !candidate.price || !Number.isFinite(candidate.price.amount) || candidate.price.amount < 0 ||
      !/^[A-Z]{3}$/.test(candidate.price.currency) || !sourceFact(candidate, 'priceAmount', candidate.price.amount) || !sourceFact(candidate, 'currency', candidate.price.currency)) reasons.push('price_unverified');
  const review = binding.placementReview;
  if (typeof layoutRevision !== 'string' || !layoutRevision || !review || review.status !== 'passed' || review.slotId !== slot.slotId ||
      review.candidateId !== candidate.candidateId || review.layoutRevision !== layoutRevision ||
      review.candidateObservedAt !== candidate.observedAt || review.productClearanceVerified !== true ||
      (needsProductUseSpec(slot.category) && review.useSpecSnapshot !== JSON.stringify(candidate.useSpec ?? null))) reasons.push('placement_unverified_or_stale');
  return reasons;
}

export function buildProcurementBom({ slots, bindings = [], candidates = [], layoutRevision = null }) {
  if (!Array.isArray(slots) || !Array.isArray(bindings) || !Array.isArray(candidates)) throw new TypeError('Slots, bindings and candidates must be arrays');
  const slotIds = new Set(), bindingBySlot = new Map(), candidateById = new Map();
  for (const slot of slots) {
    if (!slot || typeof slot.slotId !== 'string' || !slot.slotId || slotIds.has(slot.slotId)) throw new TypeError('Slots need unique IDs');
    slotIds.add(slot.slotId);
  }
  for (const binding of bindings) {
    if (!binding || !slotIds.has(binding.slotId) || bindingBySlot.has(binding.slotId) || typeof binding.candidateId !== 'string') throw new TypeError('Bindings need a unique existing slot and candidate ID');
    bindingBySlot.set(binding.slotId, binding);
  }
  for (const candidate of candidates) {
    if (!candidate || typeof candidate.candidateId !== 'string' || !candidate.candidateId || candidateById.has(candidate.candidateId)) throw new TypeError('Candidates need unique IDs');
    candidateById.set(candidate.candidateId, candidate);
  }
  const items = slots.map(slot => {
    const binding = bindingBySlot.get(slot.slotId);
    const candidate = binding && candidateById.get(binding.candidateId);
    const reasons = assessBinding(slot, binding, candidate, layoutRevision);
    const ready = reasons.length === 0;
    return {
      slotId: slot.slotId,
      sourceInstanceId: slot.sourceInstanceId,
      category: slot.category,
      role: slot.role,
      label: slot.label,
      envelopeMm: slot.envelopeMm,
      candidateId: binding?.candidateId || null,
      status: ready ? 'ready_for_quote_review' : 'pending',
      reasons,
      supplierSku: ready ? candidate.supplierSku : null,
      variantCode: ready ? candidate.variantCode : null,
      sourceRef: ready ? candidate.sourceRef : null,
      observedAt: ready ? candidate.observedAt : null,
      unitPrice: ready ? { ...candidate.price } : null,
    };
  });
  const grouped = new Map();
  for (const item of items) {
    const key = item.status === 'ready_for_quote_review'
      ? JSON.stringify([item.candidateId, item.unitPrice.amount, item.unitPrice.currency, item.observedAt])
      : JSON.stringify([item.category, item.role, item.label, item.envelopeMm, item.candidateId, item.reasons]);
    if (!grouped.has(key)) grouped.set(key, { ...item, quantity: 0, slotIds: [], sourceInstanceIds: [] });
    const line = grouped.get(key);
    line.quantity++;
    line.slotIds.push(item.slotId);
    line.sourceInstanceIds.push(item.sourceInstanceId);
  }
  const readyCount = items.filter(item => item.status === 'ready_for_quote_review').length;
  const currencies = new Set(items.filter(item => item.unitPrice).map(item => item.unitPrice.currency));
  const complete = items.length > 0 && readyCount === items.length && currencies.size === 1;
  const subtotalStatus = !items.length ? 'empty' : readyCount !== items.length ? 'pending_items' : currencies.size !== 1 ? 'mixed_currencies' : 'complete';
  return {
    items,
    lines: [...grouped.values()],
    itemCount: items.length,
    readyCount,
    pendingCount: items.length - readyCount,
    subtotalStatus,
    merchandiseSubtotal: complete ? {
      amount: exactSum(items.map(item => item.unitPrice.amount)),
      currency: [...currencies][0],
    } : null,
    quoteStatus: 'not_quoted',
  };
}
