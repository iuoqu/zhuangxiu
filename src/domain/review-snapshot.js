// A review snapshot is an independent copy of one layout and its merchandise
// evidence. It is a review artifact, never a quotation or an order.
const copy = value => JSON.parse(JSON.stringify(value));
const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

export function createReviewSnapshot({ project, displayFurniture, layoutRevision, designBom, baseDraft,
  procurementDraft, candidates = [], offers = [], snapshotId, capturedAt }) {
  if (!project || !Array.isArray(project.objects) || !Array.isArray(project.furniture) || !Array.isArray(displayFurniture) ||
      typeof layoutRevision !== 'string' || !layoutRevision.startsWith('layout-v1:') ||
      !Array.isArray(designBom?.lines) || !Array.isArray(baseDraft?.items) ||
      !procurementDraft || !Array.isArray(candidates) || !Array.isArray(offers) ||
      typeof snapshotId !== 'string' || !snapshotId || !Number.isFinite(Date.parse(capturedAt))) {
    throw new TypeError('Review snapshot needs a project, current calculation and capture identity');
  }
  const purchaseLines = procurementDraft.purchaseLines || procurementDraft.lines;
  if (!Array.isArray(purchaseLines) || displayFurniture.length !== designBom.itemCount ||
      procurementDraft.itemCount !== designBom.itemCount ||
      baseDraft.itemCount !== designBom.itemCount) {
    throw new TypeError('Review snapshot needs matching design and procurement counts');
  }
  const selectedCandidateIds = new Set((project.productBindings || []).map(binding => binding.candidateId));
  const selectedOfferIds = new Set((project.setSelections || []).map(selection => selection.offerId));
  const selectedDraft = (project.drafts || []).find(draft => draft.id === project.activeDraft);
  const source = project.source || {};
  const snapshot = {
    kind: 'product_review_snapshot', schemaVersion: 1, snapshotId, capturedAt,
    documentStatus: 'review_only_not_quote_or_order',
    project: {
      name: project.name || 'Untitled project', projectVersion: project.version || null,
      source: { kind: source.kind || null, label: source.label || null,
        fileName: source.fileName || null, fixtureId: source.fixtureId || null,
        status: source.status || null },
      site: project.site || null, brief: project.broker || null,
      activeDraft: project.activeDraft || null, selectedDraftMeta: selectedDraft?.meta || null,
      rules: project.rules || null, widthMm: project.w, depthMm: project.h,
    },
    layout: { revision: layoutRevision, objects: project.objects,
      furniture: project.furniture, displayFurniture, workAreas: project.workAreas || [] },
    design: { itemCount: designBom.itemCount, lines: designBom.lines },
    productEvidence: {
      bindings: project.productBindings || [], profilesByInstanceId: project.productProfiles || {},
      candidates: candidates.filter(candidate => selectedCandidateIds.has(candidate.candidateId)),
      setSelections: project.setSelections || [],
      offers: offers.filter(offer => selectedOfferIds.has(offer.offerId)),
    },
    procurement: {
      itemCount: procurementDraft.itemCount, readyCount: procurementDraft.readyCount,
      pendingCount: procurementDraft.pendingCount,
      subtotalStatus: procurementDraft.subtotalStatus,
      merchandiseSubtotal: procurementDraft.merchandiseSubtotal,
      quoteStatus: 'not_quoted',
      individualItems: baseDraft.items,
      purchaseLines,
      pending: purchaseLines.filter(line => line.status !== 'ready_for_quote_review')
        .map(line => ({ sourceInstanceIds: line.sourceInstanceIds || [line.sourceInstanceId],
          reasons: line.reasons || [] })),
    },
  };
  return freeze(copy(snapshot));
}
