import { analyzeHomeAssemblies } from './home-assemblies.js';
import { exactSum } from './procurement-bom.js';
import { setOfferSnapshot } from './set-offers.js';

// Overlay a selected supplier set on individually reviewed product bindings.
// A pending set never falls back to individual prices without an explicit choice.
export function buildSetProcurementDraft({ baseDraft, furniture, offers = [], selections = [] }) {
  if (!Array.isArray(baseDraft?.items) || !Array.isArray(furniture) || !Array.isArray(offers) || !Array.isArray(selections)) {
    throw new TypeError('Set procurement needs a reviewed base draft, furniture, offers and selections');
  }
  const items = new Map(baseDraft.items.map(item => [item.sourceInstanceId, item]));
  const offersById = new Map(offers.map(offer => [offer.offerId, offer]));
  const relationReview = analyzeHomeAssemblies(furniture);
  const owned = new Set(), setLines = [], setPending = new Set();
  for (const selection of selections) {
    if (!selection || typeof selection.offerId !== 'string' || !Array.isArray(selection.instanceIds) ||
        selection.instanceIds.length < 2 || new Set(selection.instanceIds).size !== selection.instanceIds.length ||
        selection.instanceIds.some(id => typeof id !== 'string' || owned.has(id))) {
      throw new TypeError('Set selections need distinct unclaimed furniture instance IDs');
    }
    for (const id of selection.instanceIds) owned.add(id);
    const offer = offersById.get(selection.offerId), members = new Set(selection.instanceIds), reasons = [];
    if (!offer) reasons.push('set_offer_missing');
    else {
      if (!offer.verification?.components || !offer.verification?.price || !offer.verification?.availability ||
          !offer.review?.reviewedBy || !Number.isFinite(Date.parse(offer.review.reviewedAt))) reasons.push('set_evidence_unverified');
      if (selection.offerSnapshot !== setOfferSnapshot(offer)) reasons.push('set_offer_stale');
      if (offer.availability !== 'in_stock') reasons.push('set_unavailable');
    }
    if (selection.instanceIds.some(id => !items.has(id))) reasons.push('set_members_missing');
    if (relationReview.errors.length) reasons.push('set_relationship_invalid');
    const links = relationReview.relations.filter(relation => members.has(relation.memberId));
    const anchors = new Set(links.map(link => link.anchorId));
    const anchorId = [...anchors][0];
    if (anchors.size !== 1 || links.length !== members.size - Number(members.has(anchorId)) ||
        selection.instanceIds.some(id => id !== anchorId && !links.some(link => link.memberId === id))) {
      reasons.push('set_relationship_missing');
    }
    if (selection.instanceIds.some(id => items.get(id)?.status !== 'ready_for_quote_review')) reasons.push('set_member_product_pending');
    if (offer && selection.instanceIds.every(id => items.has(id))) {
      const actual = new Map();
      for (const id of selection.instanceIds) {
        const candidateId = items.get(id).candidateId;
        actual.set(candidateId, (actual.get(candidateId) || 0) + 1);
      }
      if (actual.size !== offer.components?.length || offer.components.some(part => actual.get(part.candidateId) !== part.quantity)) {
        reasons.push('set_components_mismatch');
      }
    }
    if (reasons.length) for (const id of selection.instanceIds) setPending.add(id);
    setLines.push({ kind: 'set', offerId: selection.offerId, sourceInstanceIds: [...selection.instanceIds],
      status: reasons.length ? 'pending' : 'ready_for_quote_review', reasons,
      supplierSku: reasons.length ? null : offer.supplierSku,
      sourceRef: reasons.length ? null : offer.sourceRef,
      observedAt: reasons.length ? null : offer.observedAt,
      components: reasons.length ? [] : offer.components.map(part => ({ ...part })),
      unitPrice: reasons.length ? null : { ...offer.price } });
  }
  const standaloneLines = baseDraft.items.filter(item => !owned.has(item.sourceInstanceId)).map(item => ({
    ...item, kind: 'single', sourceInstanceIds: [item.sourceInstanceId], components: [],
  }));
  const purchaseLines = [...setLines, ...standaloneLines];
  const pendingIds = new Set([...baseDraft.items.filter(item => item.status !== 'ready_for_quote_review').map(item => item.sourceInstanceId), ...setPending]);
  const pendingCount = Math.min(baseDraft.itemCount, pendingIds.size);
  const hasPendingSet = setLines.some(line => line.status === 'pending');
  const prices = purchaseLines.filter(line => line.status === 'ready_for_quote_review').map(line => line.unitPrice);
  const currencies = new Set(prices.map(price => price.currency));
  const complete = purchaseLines.length > 0 && pendingCount === 0 && !hasPendingSet && currencies.size === 1;
  return {
    purchaseLines, setLines, itemCount: baseDraft.itemCount,
    readyCount: baseDraft.itemCount - pendingCount, pendingCount,
    subtotalStatus: pendingCount || hasPendingSet ? 'pending_items' : currencies.size > 1 ? 'mixed_currencies' : complete ? 'complete' : 'empty',
    merchandiseSubtotal: complete ? { amount: exactSum(prices.map(price => price.amount)), currency: [...currencies][0] } : null,
    quoteStatus: 'not_quoted',
  };
}
