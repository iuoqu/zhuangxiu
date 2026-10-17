import { candidateEvidenceGaps } from './planning-coverage.js';

const STRATEGIES = Object.freeze([
  Object.freeze({ id: 'value', label: 'A · Value', description: 'Lowest complete merchandise total', targetTier: 'value' }),
  Object.freeze({ id: 'balanced', label: 'B · Balanced', description: 'Balanced finish, lead time and price', targetTier: 'balanced' }),
  Object.freeze({ id: 'signature', label: 'C · Style', description: 'Signature finish across the complete scene', targetTier: 'signature' }),
]);
const positive = value => Number.isFinite(value) && value > 0;

function fitScore(slot, candidate) {
  const box = slot.envelopeMm || {}, size = candidate.dimensionsMm || {};
  if (![box.width, box.depth, size.width, size.depth].every(positive)) return null;
  const options = [[size.width, size.depth], [size.depth, size.width]]
    .filter(([width, depth]) => width <= box.width && depth <= box.depth);
  if (!options.length) return null;
  return Math.min(...options.map(([width, depth]) =>
    Math.abs(box.width - width) / box.width + Math.abs(box.depth - depth) / box.depth));
}

function candidatesForSlot(slot, candidates, tier) {
  return candidates.map(candidate => ({ candidate, fit: candidate.category === slot.category &&
    candidate.role === slot.role && candidateEvidenceGaps(candidate).length === 0 ? fitScore(slot, candidate) : null }))
    .filter(entry => entry.fit != null)
    .sort((left, right) => left.fit - right.fit ||
      (left.candidate.demoTier === tier ? 0 : 1) - (right.candidate.demoTier === tier ? 0 : 1) ||
      left.candidate.price.amount - right.candidate.price.amount ||
      left.candidate.candidateId.localeCompare(right.candidate.candidateId));
}

function preferredCandidate(options, tier) {
  if (!options.length) return null;
  const closestFit = options[0].fit;
  const sameProfileBand = options.filter(option => option.fit <= closestFit + .000001);
  return sameProfileBand.find(option => option.candidate.demoTier === tier) || sameProfileBand[0];
}

function cheaperAlternatives(entry, slot, candidates) {
  return candidatesForSlot(slot, candidates, 'value')
    .filter(option => option.candidate.price.currency === entry.candidate.price.currency &&
      option.candidate.profileId === entry.candidate.profileId &&
      option.candidate.price.amount < entry.candidate.price.amount)
    .map(option => ({ ...option, saving: entry.candidate.price.amount - option.candidate.price.amount,
      fitCost: Math.max(0, option.fit - entry.fit) }))
    .sort((a, b) => b.saving - a.saving || a.fitCost - b.fitCost || a.candidate.candidateId.localeCompare(b.candidate.candidateId));
}

function applyBudget(entries, slots, candidates, budget) {
  if (!positive(budget)) return entries;
  let total = entries.reduce((sum, entry) => sum + entry.candidate.price.amount, 0);
  const result = entries.map(entry => ({ ...entry })), changed = new Set();
  while (total > budget) {
    const moves = result.flatMap((entry, index) => cheaperAlternatives(entry, slots[index], candidates)
      .slice(0, 1).map(option => ({ index, option })))
      .filter(move => !changed.has(`${move.index}:${move.option.candidate.candidateId}`))
      .sort((a, b) => b.option.saving - a.option.saving || a.option.fitCost - b.option.fitCost);
    if (!moves.length) break;
    const move = moves[0], previous = result[move.index];
    changed.add(`${move.index}:${move.option.candidate.candidateId}`);
    result[move.index] = move.option;
    total -= previous.candidate.price.amount - move.option.candidate.price.amount;
  }
  return result;
}

function packageForStrategy(strategy, slots, candidates, budget) {
  const initial = [], unfilled = [];
  slots.forEach(slot => {
    const options = candidatesForSlot(slot, candidates, strategy.targetTier), selected = preferredCandidate(options, strategy.targetTier);
    if (!selected) unfilled.push({ sourceInstanceId: slot.sourceInstanceId, category: slot.category,
      role: slot.role, reason: options.length ? 'candidate_not_selected' : 'no_fitting_reviewed_candidate' });
    else initial.push({ ...selected, slot });
  });
  const selected = unfilled.length ? initial : applyBudget(initial, slots, candidates, budget);
  const selections = selected.map(entry => ({ sourceInstanceId: entry.slot.sourceInstanceId,
    candidateId: entry.candidate.candidateId, reason: `${entry.candidate.tierLabel} · ${entry.candidate.finish} · ${entry.candidate.leadDays} day lead` }));
  const currencies = new Set(selected.map(entry => entry.candidate.price.currency));
  const subtotal = selected.length && currencies.size === 1
    ? { amount: selected.reduce((sum, entry) => sum + entry.candidate.price.amount, 0), currency: [...currencies][0] }
    : null;
  const lines = new Map();
  for (const entry of selected) {
    const key = entry.candidate.candidateId;
    if (!lines.has(key)) lines.set(key, { candidateId: key, name: entry.candidate.name,
      supplierSku: entry.candidate.supplierSku, tier: entry.candidate.demoTier, finish: entry.candidate.finish,
      accent: entry.candidate.accent, quantity: 0, unitPrice: { ...entry.candidate.price } });
    lines.get(key).quantity++;
  }
  return { packageId: strategy.id, label: strategy.label, description: strategy.description,
    status: unfilled.length ? 'incomplete' : 'complete', selections, lines: [...lines.values()],
    itemCount: slots.length, selectedCount: selections.length, unfilled, subtotal,
    budget: positive(budget) ? { amount: budget, currency: 'USD' } : null,
    budgetStatus: !positive(budget) || !subtotal ? 'not_set' : subtotal.amount <= budget ? 'within_budget' : 'over_budget' };
}

export function buildDemoProductPackages({ slots, candidates, budget = null, lockedSelections = [] }) {
  if (!Array.isArray(slots) || !Array.isArray(candidates) || !Array.isArray(lockedSelections)) {
    throw new TypeError('Demo packages need slots, candidates and locked selections');
  }
  const ids = new Set(slots.map(slot => slot.sourceInstanceId));
  if (ids.size !== slots.length) throw new TypeError('Demo package slots need unique instance IDs');
  const byId = new Map(candidates.map(candidate => [candidate.candidateId, candidate]));
  const locks = new Map(lockedSelections.map(lock => [lock.sourceInstanceId, lock.candidateId]));
  const packages = STRATEGIES.map(strategy => packageForStrategy(strategy, slots, candidates, Number(budget)));
  for (const plan of packages) for (const [sourceInstanceId, candidateId] of locks) {
    const slot = slots.find(value => value.sourceInstanceId === sourceInstanceId), candidate = byId.get(candidateId);
    if (!slot || !candidate || candidateEvidenceGaps(candidate).length || fitScore(slot, candidate) == null ||
        candidate.category !== slot.category || candidate.role !== slot.role) continue;
    const index = plan.selections.findIndex(selection => selection.sourceInstanceId === sourceInstanceId);
    if (index >= 0) plan.selections[index] = { sourceInstanceId, candidateId, reason: 'Locked by user' };
  }
  for (const plan of packages) {
    const chosen = plan.selections.map(selection => byId.get(selection.candidateId)).filter(Boolean);
    const currencies = new Set(chosen.map(candidate => candidate.price.currency));
    plan.subtotal = chosen.length === plan.itemCount && currencies.size === 1
      ? { amount: chosen.reduce((sum, candidate) => sum + candidate.price.amount, 0), currency: [...currencies][0] }
      : null;
    const lines = new Map();
    for (const candidate of chosen) {
      if (!lines.has(candidate.candidateId)) lines.set(candidate.candidateId, { candidateId: candidate.candidateId,
        name: candidate.name, supplierSku: candidate.supplierSku, tier: candidate.demoTier,
        finish: candidate.finish, accent: candidate.accent, quantity: 0, unitPrice: { ...candidate.price } });
      lines.get(candidate.candidateId).quantity++;
    }
    plan.lines = [...lines.values()];
    plan.budgetStatus = !positive(Number(budget)) || !plan.subtotal ? 'not_set'
      : plan.subtotal.amount <= Number(budget) ? 'within_budget' : 'over_budget';
  }
  return packages;
}
