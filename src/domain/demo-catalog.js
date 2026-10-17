import { importCatalog } from './catalog-import.js';
import { sceneFurnitureType } from './furniture-taxonomy.js';

export const DEMO_CATALOG_VERSION = 'showcase-2026-10-17-v2';
export const DEMO_VISUAL_ASSET_VERSION = 'demo-visual-2026-10-17-v1';

const SOURCE = Object.freeze({
  id: 'nbai-showcase',
  ref: `demo-catalog://${DEMO_CATALOG_VERSION}`,
  observedAt: '2026-10-17T00:00:00.000Z',
  format: 'json',
  trustSpecs: true,
  trustPrice: true,
  trustAvailability: true,
  trustUseSpec: true,
  useReviewedBy: 'NBAI showcase catalog',
  useReviewedAt: '2026-10-17T00:00:00.000Z',
});

const TIERS = Object.freeze([
  Object.freeze({ id: 'value', label: 'Value', name: 'Essential', multiplier: .82, leadDays: 10,
    finish: 'Light ash', accent: '#c9ad86', styleTags: ['clean', 'light', 'practical'],
    plan: { fill: '#e7d6bc', stroke: '#866b4d', label: '#3f3427' },
    materials: {
      wood: ['#c9ad86', '#a98b65', '#eadbc2'], metal: ['#7b8794', '#5f6974', '#aeb7c0'],
      screen: ['#a9bdc8', '#8098a5', '#d2dee4'], fabric: ['#9fb2b0', '#718b89', '#c9d5d3'],
    } }),
  Object.freeze({ id: 'balanced', label: 'Balanced', name: 'Studio', multiplier: 1, leadDays: 14,
    finish: 'Natural oak', accent: '#9a6c45', styleTags: ['warm', 'modern', 'balanced'],
    plan: { fill: '#bc8c61', stroke: '#69472f', label: '#2f2118' },
    materials: {
      wood: ['#a57446', '#805737', '#d2a46d'], metal: ['#4f5f68', '#34434b', '#7b8b94'],
      screen: ['#71899a', '#4e697b', '#a6b7c2'], fabric: ['#527e89', '#386671', '#7da6aa'],
    } }),
  Object.freeze({ id: 'signature', label: 'Style', name: 'Signature', multiplier: 1.34, leadDays: 21,
    finish: 'Dark walnut', accent: '#594236', styleTags: ['refined', 'contrast', 'statement'],
    plan: { fill: '#685044', stroke: '#2d221d', label: '#fffaf5' },
    materials: {
      wood: ['#594236', '#382a24', '#80685b'], metal: ['#343238', '#1f2025', '#66636c'],
      screen: ['#485665', '#2d3945', '#768696'], fabric: ['#7a5148', '#54352f', '#a87669'],
    } }),
]);

const COMPOSITE_KINDS = new Set(['dining4', 'lounge2']);
const ZONED_CATEGORIES = new Set(['table', 'chair', 'vanity', 'sofa', 'coffee_table', 'low_cabinet',
  'desk', 'cabinet', 'shelf', 'locker', 'phone_booth', 'counter', 'stool', 'equipment', 'display']);

function useFields(category, width, depth) {
  if (category === 'wardrobe') return { doorMechanism: 'sliding', frontClearanceMm: 500 };
  if (category === 'bed') return { leftClearanceMm: 100, rightClearanceMm: 100, footClearanceMm: 300 };
  if (!ZONED_CATEGORIES.has(category)) return {};
  const zoneWidth = Math.min(width, 600);
  return { useZones: [{ purpose: 'Showcase planning access', x: -zoneWidth / 2,
    y: depth / 2, w: zoneWidth, h: 25 }] };
}

function profileFromSpec(spec, suffix = '') {
  const type = sceneFurnitureType(spec.kind);
  if (!type.category || COMPOSITE_KINDS.has(spec.kind)) return null;
  return {
    profileId: `${spec.kind}${suffix}`,
    kind: spec.kind,
    category: type.category,
    role: type.role,
    label: suffix ? `${spec.name} ${suffix.replace(/^-/, '')}` : spec.name,
    width: spec.width,
    depth: spec.depth,
    height: spec.height,
    price: Number.isFinite(spec.samplePrice) ? spec.samplePrice : 500,
    baseSku: String(spec.sku || `DEMO-${spec.kind}`).replace(/[^A-Z0-9-]/gi, '-').toUpperCase(),
  };
}

function extraProfiles(baseSpecs) {
  const meeting = baseSpecs.find(spec => spec.kind === 'meetingModular');
  const sofa = baseSpecs.find(spec => spec.kind === 'sofa');
  return [
    ...(meeting ? [4400, 5200, 6000, 6800, 7600, 8400].map(width => ({
      ...profileFromSpec({ ...meeting, width, samplePrice: meeting.samplePrice * width / meeting.width }, `-${width}`),
      label: `${Math.max(8, Math.round((width - 400) / 800) * 2)}-seat modular meeting table`,
    })) : []),
    ...(sofa ? [{ ...profileFromSpec({ ...sofa, width: 1600, depth: 800,
      samplePrice: sofa.samplePrice * .72 }, '-compact'), label: 'Compact two-seat sofa' }] : []),
  ].filter(Boolean);
}

function visualSpec(profile, tier) {
  const upholstered = new Set(['chair', 'sofa', 'bed', 'stool']).has(profile.category);
  const technical = new Set(['locker', 'equipment', 'phone_booth']).has(profile.category);
  const planMaterial = upholstered ? 'fabric' : technical ? 'metal' : 'wood';
  const material = tier.materials[planMaterial];
  return {
    assetVersion: DEMO_VISUAL_ASSET_VERSION,
    shapeTemplate: profile.kind,
    shapeVariant: tier.id,
    plan: { fill: planMaterial === 'wood' ? tier.plan.fill : material[0], stroke: tier.plan.stroke,
      label: tier.plan.label, accent: tier.accent },
    materials: Object.fromEntries(Object.entries(tier.materials).map(([name, colors]) => [name, [...colors]])),
  };
}

/**
 * Builds an evidence-complete fictional catalog for a deterministic showcase.
 * The same normalized candidate format is used by supplier catalog adapters.
 */
export function createDemoCatalog(baseSpecs) {
  if (!Array.isArray(baseSpecs) || !baseSpecs.length) throw new TypeError('Demo catalog needs base furniture specs');
  const profiles = [...baseSpecs.map(spec => profileFromSpec(spec)).filter(Boolean), ...extraProfiles(baseSpecs)];
  const rows = [], metadata = new Map();
  for (const profile of profiles) for (const tier of TIERS) {
    const sku = `${profile.baseSku}-${profile.profileId.replace(/[^a-z0-9]+/gi, '-').toUpperCase()}-${tier.id[0].toUpperCase()}`;
    rows.push({
      category: profile.category,
      role: profile.role,
      name: `${tier.name} ${profile.label}`,
      supplierSku: sku,
      variantCode: tier.finish.replace(/\s+/g, '-').toLowerCase(),
      widthMm: profile.width,
      depthMm: profile.depth,
      heightMm: profile.height,
      priceAmount: Math.round(profile.price * tier.multiplier),
      currency: 'USD',
      availability: 'in_stock',
      purchaseUnit: 'single',
      leadDays: tier.leadDays,
      ...useFields(profile.category, profile.width, profile.depth),
    });
    metadata.set(sku, { demo: true, demoTier: tier.id, tierLabel: tier.label,
      finish: tier.finish, accent: tier.accent, styleTags: [...tier.styleTags],
      profileId: profile.profileId, sceneKind: profile.kind, visualSpec: visualSpec(profile, tier) });
  }
  const imported = importCatalog(SOURCE, rows);
  if (imported.errors.length) throw new TypeError(`Demo catalog contains ${imported.errors.length} invalid rows`);
  const candidates = imported.candidates.map(candidate => ({ ...candidate, ...metadata.get(candidate.supplierSku) }));
  return {
    version: DEMO_CATALOG_VERSION,
    source: { id: SOURCE.id, ref: SOURCE.ref, observedAt: SOURCE.observedAt },
    candidates,
    categoryCount: new Set(candidates.map(candidate => candidate.category)).size,
    roleCount: new Set(candidates.map(candidate => candidate.role)).size,
    tiers: TIERS.map(tier => ({ id: tier.id, label: tier.label })),
    disclaimer: 'Fictional showcase products, availability and prices. No supplier offer is represented.',
  };
}
