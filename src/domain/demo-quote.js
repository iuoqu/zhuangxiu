const positive = value => Number.isFinite(value) && value >= 0;
const cents = value => Math.round(Number(value) * 100);
const amount = value => Number((value / 100).toFixed(2));
const addDays = (iso, days) => {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
};

export function procurementFingerprint(draft) {
  if (!draft || !Array.isArray(draft.lines)) throw new TypeError('Procurement draft lines are required');
  return JSON.stringify(draft.lines.map(line => [line.candidateId || null, line.supplierSku || null,
    line.quantity || 1, line.unitPrice?.amount ?? null, line.unitPrice?.currency || null, line.status]).sort());
}

export function createDemoQuote({ projectName, layoutRevision, catalogVersion, procurementDraft,
  createdAt = new Date().toISOString(), quoteNumber = null }) {
  if (typeof layoutRevision !== 'string' || !layoutRevision || typeof catalogVersion !== 'string' || !catalogVersion ||
      !procurementDraft || procurementDraft.pendingCount !== 0 || !procurementDraft.merchandiseSubtotal) {
    throw new TypeError('A complete current procurement draft is required');
  }
  const merchandise = procurementDraft.merchandiseSubtotal;
  const merchandiseAmount = Number(merchandise.amount);
  if (!positive(merchandiseAmount) || merchandise.currency !== 'USD') throw new TypeError('Demo quote requires a USD subtotal');
  const merchandiseCents = cents(merchandiseAmount);
  const deliveryCents = Math.max(25000, Math.round(merchandiseCents * .04));
  const installationCents = Math.round(merchandiseCents * .08);
  const taxCents = Math.round((merchandiseCents + deliveryCents + installationCents) * .095);
  const totalCents = merchandiseCents + deliveryCents + installationCents + taxCents;
  const fingerprint = procurementFingerprint(procurementDraft);
  const suffix = layoutRevision.replace(/[^a-f0-9]/gi, '').slice(-8).toUpperCase() || 'SHOWCASE';
  return {
    mode: 'demonstration', status: 'draft', quoteNumber: quoteNumber || `DEMO-Q-${createdAt.slice(0, 10).replaceAll('-', '')}-${suffix}`,
    version: 1, projectName: String(projectName || 'Untitled project'), createdAt, validUntil: addDays(createdAt, 7),
    layoutRevision, catalogVersion, procurementFingerprint: fingerprint, currency: 'USD',
    lines: procurementDraft.lines.map(line => ({ candidateId: line.candidateId, supplierSku: line.supplierSku,
      label: line.label, quantity: line.quantity, unitPrice: { ...line.unitPrice },
      lineTotal: amount(cents(line.unitPrice.amount) * line.quantity) })),
    amounts: { merchandise: amount(merchandiseCents), delivery: amount(deliveryCents),
      installation: amount(installationCents), estimatedTax: amount(taxCents), total: amount(totalCents) },
    disclaimer: 'Demonstration quote using fictional catalog prices. It is not a supplier offer or payable invoice.',
  };
}

export function demoQuoteMatches(quote, { layoutRevision, catalogVersion, procurementDraft }) {
  if (!quote || quote.mode !== 'demonstration') return false;
  try {
    return quote.layoutRevision === layoutRevision && quote.catalogVersion === catalogVersion &&
      quote.procurementFingerprint === procurementFingerprint(procurementDraft);
  } catch { return false; }
}

export function confirmDemoQuote(quote, confirmedAt = new Date().toISOString()) {
  if (!quote || quote.mode !== 'demonstration' || quote.status !== 'draft') throw new TypeError('A draft demo quote is required');
  return { ...quote, status: 'confirmed', confirmedAt };
}

export function createDemoOrderRequest(quote, requestedAt = new Date().toISOString()) {
  if (!quote || quote.mode !== 'demonstration' || quote.status !== 'confirmed') throw new TypeError('A confirmed demo quote is required');
  if (Date.parse(requestedAt) > Date.parse(quote.validUntil)) throw new TypeError('The demo quote has expired');
  return { mode: 'demonstration', orderRequestNumber: quote.quoteNumber.replace('DEMO-Q-', 'DEMO-OR-'),
    status: 'request_received', requestedAt, quoteNumber: quote.quoteNumber, quoteVersion: quote.version,
    layoutRevision: quote.layoutRevision, catalogVersion: quote.catalogVersion,
    disclaimer: 'Demonstration order request only. No purchase, payment or supplier reservation was created.' };
}
