// Supplier sets are purchase offers over individually reviewed scene products.
// Their component list comes from the server-owned source, never from proximity.
const clean = value => typeof value === 'string' ? value.trim() : '';
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

export function importSetOffers(source, rows, candidates) {
  if (!Array.isArray(rows) || rows.length > 500 || !Array.isArray(candidates)) throw new TypeError('Set offers need up to 500 rows and product candidates');
  const byId = new Map(candidates.map(candidate => [candidate.candidateId, candidate]));
  const seen = new Set();
  return rows.map(row => {
    const sku = clean(row?.supplierSku), variantCode = clean(row?.variantCode) || null;
    const offerId = `${source.id}:set:${sku}:${variantCode || 'base'}`;
    if (!sku || seen.has(offerId) || !Array.isArray(row.components) || row.components.length < 1 || row.components.length > 20) {
      throw new TypeError('Set offers need a unique SKU and 1–20 component types');
    }
    seen.add(offerId);
    const parts = new Set();
    const components = row.components.map(component => {
      const componentSku = clean(component?.supplierSku), componentVariant = clean(component?.variantCode) || null;
      const candidateId = `${source.id}:${componentSku}:${componentVariant || 'base'}`;
      const candidate = byId.get(candidateId);
      if (!componentSku || !candidate || candidate.sourceId !== source.id || candidate.purchaseUnit !== 'single' ||
          !Number.isInteger(component.quantity) || component.quantity < 1 || component.quantity > 100 || parts.has(candidateId)) {
        throw new TypeError('Set components need distinct single-unit products and positive quantities');
      }
      parts.add(candidateId);
      return { candidateId, supplierSku: candidate.supplierSku, variantCode: candidate.variantCode, quantity: component.quantity };
    });
    if (components.reduce((count, component) => count + component.quantity, 0) < 2) {
      throw new TypeError('A supplier set must contain at least two physical units');
    }
    const amount = row.priceAmount;
    const currency = clean(row.currency).toUpperCase(), availability = clean(row.availability).toLowerCase();
    const leadDays = row.leadDays;
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || !/^[A-Z]{3}$/.test(currency) ||
        !['in_stock', 'backorder', 'out_of_stock', 'discontinued', 'unknown'].includes(availability) ||
        !Number.isInteger(leadDays) || leadDays < 0) throw new TypeError('Set offers need price, currency, availability and lead days');
    const reviewed = source.trustSets === true && clean(source.setsReviewedBy) && validDate(source.setsReviewedAt);
    return {
      offerId, sourceId: source.id, sourceRef: source.ref, observedAt: source.observedAt,
      supplierSku: sku, variantCode, components, price: { amount, currency }, availability, leadDays,
      review: reviewed ? { reviewedBy: clean(source.setsReviewedBy), reviewedAt: source.setsReviewedAt } : null,
      verification: { components: Boolean(reviewed), price: source.trustPrice === true,
        availability: source.trustAvailability === true },
    };
  });
}

export function setOfferSnapshot(offer) {
  return JSON.stringify([offer?.offerId, offer?.sourceRef, offer?.observedAt, offer?.supplierSku,
    offer?.variantCode, offer?.price, offer?.availability, offer?.leadDays, offer?.components,
    offer?.review, offer?.verification]);
}
