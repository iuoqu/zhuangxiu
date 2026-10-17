const DEFAULT_MATERIALS = Object.freeze({
  wood: Object.freeze(['#a57446', '#8d623b', '#d2a46d']),
  metal: Object.freeze(['#64748b', '#475569', '#94a3b8']),
  screen: Object.freeze(['#6b8198', '#4d667d', '#9badbd']),
  fabric: Object.freeze(['#527e89', '#386671', '#7da6aa']),
});

const DEFAULT_PLAN = Object.freeze({ fill: '#dbeafe', stroke: '#3b82f6', label: '#1e3a8a', accent: '#93c5fd' });
const SAFE_HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function safeColor(value, fallback) {
  return typeof value === 'string' && SAFE_HEX_COLOR.test(value) ? value : fallback;
}

function colorTriplet(value, fallback) {
  return Array.isArray(value) && value.length === 3
    ? value.map((color, index) => safeColor(color, fallback[index])) : [...fallback];
}

/**
 * Resolves the visual asset for one physical furniture instance. A temporary
 * package selection takes precedence over the product already bound to the
 * project so A / B / C can be previewed without mutating the reviewed layout.
 */
export function resolveProductVisual({ item, candidateId = null, candidates = [], baseSpecs = [] } = {}) {
  if (!item || typeof item !== 'object') throw new TypeError('A furniture item is required');
  const selectedId = candidateId || item.productCandidateId || null;
  const candidate = selectedId ? candidates.find(value => value.candidateId === selectedId) || null : null;
  const visualSpec = candidate?.visualSpec && typeof candidate.visualSpec === 'object' ? candidate.visualSpec : null;
  const shapeTemplate = visualSpec?.shapeTemplate || candidate?.sceneKind || item.kind;
  const baseSpec = baseSpecs.find(value => value.kind === shapeTemplate) ||
    baseSpecs.find(value => value.kind === item.kind) || null;
  const materials = Object.fromEntries(Object.entries(DEFAULT_MATERIALS).map(([name, fallback]) =>
    [name, colorTriplet(visualSpec?.materials?.[name], fallback)]));
  const plan = {
    fill: safeColor(visualSpec?.plan?.fill, DEFAULT_PLAN.fill),
    stroke: safeColor(visualSpec?.plan?.stroke, DEFAULT_PLAN.stroke),
    label: safeColor(visualSpec?.plan?.label, DEFAULT_PLAN.label),
    accent: safeColor(visualSpec?.plan?.accent, safeColor(candidate?.accent, DEFAULT_PLAN.accent)),
  };
  return {
    candidate,
    candidateId: candidate?.candidateId || null,
    supplierSku: candidate?.supplierSku || null,
    tier: candidate?.demoTier || null,
    finish: candidate?.finish || null,
    assetVersion: visualSpec?.assetVersion || null,
    shapeTemplate,
    shapeVariant: visualSpec?.shapeVariant || null,
    modelParts: Array.isArray(baseSpec?.modelParts) && baseSpec.modelParts.length
      ? baseSpec.modelParts : [['metal', 0, 0, 0, 1, 1, 1]],
    materials,
    plan,
    productSpecific: !!candidate && !!visualSpec,
    previewing: !!candidateId && candidateId !== item.productCandidateId,
  };
}

export function summarizeProductVisuals({ items = [], selections = {}, candidates = [], baseSpecs = [] } = {}) {
  if (!Array.isArray(items)) throw new TypeError('Scene items must be an array');
  const visuals = items.map(item => resolveProductVisual({ item,
    candidateId: selections[item.id] || item.productCandidateId || null, candidates, baseSpecs }));
  const productVisuals = visuals.filter(visual => visual.productSpecific);
  return {
    itemCount: items.length,
    productVisualCount: productVisuals.length,
    fallbackCount: visuals.length - productVisuals.length,
    tiers: [...new Set(productVisuals.map(visual => visual.tier).filter(Boolean))].sort(),
    assetVersions: [...new Set(productVisuals.map(visual => visual.assetVersion).filter(Boolean))].sort(),
    visuals,
  };
}
