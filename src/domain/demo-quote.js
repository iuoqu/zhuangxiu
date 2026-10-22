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
  createdAt = new Date().toISOString(), quoteNumber = null, version = 1 }) {
  if (typeof layoutRevision !== 'string' || !layoutRevision || typeof catalogVersion !== 'string' || !catalogVersion ||
      !procurementDraft || procurementDraft.pendingCount !== 0 || !procurementDraft.merchandiseSubtotal ||
      !Number.isSafeInteger(version) || version < 1) {
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
    mode: 'demonstration', status: 'draft', quoteNumber: quoteNumber || `DEMO-Q-${createdAt.slice(0, 10).replaceAll('-', '')}-${suffix}-V${version}`,
    version, projectName: String(projectName || 'Untitled project'), createdAt, validUntil: addDays(createdAt, 7),
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
    procurementFingerprint: quote.procurementFingerprint, currency: quote.currency, total: quote.amounts.total,
    lines: quote.lines.map(line => ({ ...line, unitPrice: { ...line.unitPrice } })),
    events: [{ status: 'request_received', at: requestedAt }], warrantyRequests: [],
    disclaimer: 'Demonstration order request only. No purchase, payment or supplier reservation was created.' };
}

const demoOrderStages = ['request_received', 'confirmed', 'dispatched', 'delivered', 'installed', 'accepted'];

export function demoOrderMatches(order, quote) {
  return !!order && order.mode === 'demonstration' && quote?.mode === 'demonstration' &&
    quote.status === 'confirmed' && order.quoteNumber === quote.quoteNumber &&
    order.quoteVersion === quote.version && order.layoutRevision === quote.layoutRevision &&
    order.catalogVersion === quote.catalogVersion &&
    (!order.procurementFingerprint || order.procurementFingerprint === quote.procurementFingerprint);
}

export function advanceDemoOrder(order, quote, at = new Date().toISOString()) {
  if (!demoOrderMatches(order, quote)) throw new TypeError('The demo order does not match the confirmed quote');
  const index = demoOrderStages.indexOf(order.status);
  if (index < 0 || index === demoOrderStages.length - 1) throw new TypeError('The demo order cannot advance');
  const previousAt = order.events?.at(-1)?.at || order.requestedAt;
  if (!Number.isFinite(Date.parse(at)) || Date.parse(at) < Date.parse(previousAt)) throw new TypeError('Order events must be chronological');
  const status = demoOrderStages[index + 1];
  const next = { ...order, status, events: [...(order.events || [{ status: order.status, at: order.requestedAt }]), { status, at }] };
  if (status === 'accepted') {
    const ends = new Date(at);
    ends.setUTCFullYear(ends.getUTCFullYear() + 5);
    next.warranty = { status: 'active_demo', startsAt: at, endsAt: ends.toISOString(),
      scope: 'Fictional five-year furniture service demonstration; no real coverage is created.' };
  }
  return next;
}

export function openDemoWarrantyRequest(order, quote, note, at = new Date().toISOString()) {
  if (!demoOrderMatches(order, quote) || order.status !== 'accepted' || order.warranty?.status !== 'active_demo')
    throw new TypeError('An accepted demo order is required');
  if (!Number.isFinite(Date.parse(at)) || Date.parse(at) < Date.parse(order.warranty.startsAt) ||
      Date.parse(at) > Date.parse(order.warranty.endsAt)) throw new TypeError('Outside the demo warranty period');
  const summary = String(note || '').trim().slice(0, 500);
  if (!summary) throw new TypeError('Describe the demo issue');
  const requests = order.warrantyRequests || [];
  if (requests.some(request => request.status === 'open')) throw new TypeError('Resolve the open demo request first');
  const request = { number: `${order.orderRequestNumber}-W${String(requests.length + 1).padStart(2, '0')}`,
    status: 'open', summary, openedAt: at };
  return { ...order, warrantyRequests: [...requests, request] };
}

export function resolveDemoWarrantyRequest(order, quote, at = new Date().toISOString()) {
  if (!demoOrderMatches(order, quote) || order.status !== 'accepted') throw new TypeError('An accepted demo order is required');
  const requests = order.warrantyRequests || [], index = requests.findIndex(request => request.status === 'open');
  if (index < 0 || !Number.isFinite(Date.parse(at)) || Date.parse(at) < Date.parse(requests[index].openedAt))
    throw new TypeError('An open demo warranty request is required');
  return { ...order, warrantyRequests: requests.map((request, position) =>
    position === index ? { ...request, status: 'resolved', resolvedAt: at } : request) };
}
