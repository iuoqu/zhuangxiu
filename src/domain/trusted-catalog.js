import { importCatalog } from './catalog-import.js';
import { importSetOffers } from './set-offers.js';

// Only a server-owned configuration may set trust flags. Browser file imports
// remain research candidates even when they contain identical product rows.
export function loadTrustedCatalog(configuration) {
  if (!configuration || !Array.isArray(configuration.sources) || configuration.sources.length > 20) {
    throw new TypeError('Catalog configuration needs up to 20 sources');
  }
  const sourceIds = new Set(), candidateIds = new Set(), offerIds = new Set(), candidates = [], setOffers = [];
  for (const source of configuration.sources) {
    if (!source || typeof source.id !== 'string' || !source.id || sourceIds.has(source.id) ||
        !Array.isArray(source.products) || source.products.length > 2000) {
      throw new TypeError('Catalog sources need unique IDs and up to 2000 products');
    }
    sourceIds.add(source.id);
    const imported = importCatalog({
      id: source.id, ref: source.ref, observedAt: source.observedAt, format: 'json',
      trustSpecs: source.trustSpecs === true, trustPrice: source.trustPrice === true,
      trustAvailability: source.trustAvailability === true, trustUseSpec: source.trustUseSpec === true,
      useReviewedBy: source.useReviewedBy, useReviewedAt: source.useReviewedAt,
    }, source.products);
    if (imported.errors.length) throw new TypeError(`Catalog ${source.id} has invalid product rows`);
    for (const candidate of imported.candidates) {
      if (candidateIds.has(candidate.candidateId)) throw new TypeError('Catalog has duplicate candidate IDs');
      candidateIds.add(candidate.candidateId);
      candidates.push(candidate);
    }
    for (const offer of importSetOffers(source, source.sets || [], imported.candidates)) {
      if (offerIds.has(offer.offerId)) throw new TypeError('Catalog has duplicate set offer IDs');
      offerIds.add(offer.offerId);
      setOffers.push(offer);
    }
  }
  return { sourceCount: sourceIds.size, candidates, setOffers };
}
