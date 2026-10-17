import { categoryForRole, defaultRoleForCategory, normalizeFurnitureCategory } from './furniture-taxonomy.js';

const clean = value => typeof value === 'string' ? value.trim() : value == null ? '' : String(value);
const positive = value => {
  const number = Number(value);
  return clean(value) !== '' && Number.isFinite(number) && number > 0 ? number : null;
};
const nonnegative = value => {
  const number = Number(value);
  return clean(value) !== '' && Number.isFinite(number) && number >= 0 ? number : null;
};
const AVAILABILITY = new Set(['in_stock', 'backorder', 'out_of_stock', 'discontinued', 'unknown']);
const ZONED_CATEGORIES = new Set(['table', 'chair', 'vanity', 'sofa', 'coffee_table', 'low_cabinet',
  'desk', 'cabinet', 'shelf', 'locker', 'phone_booth', 'counter', 'stool', 'equipment', 'display']);
function parseUseZones(raw, width, depth) {
  if (raw == null || raw === '') return null;
  try {
    const zones = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(zones) || !zones.length || zones.length > 8 || zones.some(zone =>
      !zone || typeof zone.purpose !== 'string' || !zone.purpose.trim() || zone.purpose.length > 80 ||
      !Number.isFinite(zone.x) || !Number.isFinite(zone.y) ||
      !Number.isFinite(zone.w) || zone.w <= 0 || !Number.isFinite(zone.h) || zone.h <= 0 ||
      !(zone.x + zone.w <= -width / 2 || zone.x >= width / 2 || zone.y + zone.h <= -depth / 2 || zone.y >= depth / 2))) return null;
    return zones.map(({ purpose, x, y, w, h }) => ({ purpose, x, y, w, h }));
  } catch { return null; }
}

export function parseCatalogCsv(input) {
  if (typeof input !== 'string') throw new TypeError('CSV content must be text');
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (char === '"') {
      if (quoted && input[index + 1] === '"') { field += '"'; index++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(field); field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && input[index + 1] === '\n') index++;
      row.push(field); field = '';
      if (row.some(cell => cell !== '')) rows.push(row);
      row = [];
    } else field += char;
  }
  if (quoted) throw new Error('Unclosed CSV quote');
  row.push(field);
  if (row.some(cell => cell !== '')) rows.push(row);
  if (!rows.length) return [];
  const headers = rows.shift().map(value => value.trim());
  if (new Set(headers).size !== headers.length || headers.some(value => !value)) throw new Error('CSV headers must be unique and nonempty');
  return rows.map((cells, index) => {
    if (cells.length !== headers.length) throw new Error(`CSV row ${index + 2} has ${cells.length} columns; expected ${headers.length}`);
    return Object.fromEntries(headers.map((header, column) => [header, cells[column]]));
  });
}

export function importCatalog(source, input) {
  if (!source || typeof source.id !== 'string' || !source.id || typeof source.ref !== 'string' || !source.ref || !Number.isFinite(Date.parse(source.observedAt))) {
    throw new TypeError('Catalog source needs id, ref and observedAt');
  }
  const rows = source.format === 'csv' ? parseCatalogCsv(input) : Array.isArray(input) ? input : typeof input === 'string' ? JSON.parse(input) : null;
  if (!Array.isArray(rows)) throw new TypeError('Catalog content must be a JSON array or CSV table');
  const candidates = [], errors = [], seen = new Set();
  rows.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { errors.push({ row: index + 1, reason: 'not an object' }); return; }
    const explicitCategory = clean(raw.category);
    const category = explicitCategory ? normalizeFurnitureCategory(explicitCategory) : categoryForRole(clean(raw.role).toLowerCase());
    const role = clean(raw.role).toLowerCase() || defaultRoleForCategory(category);
    const name = clean(raw.name || raw.title) || null,
      supplierSku = clean(raw.supplierSku || raw.sku) || null, variantCode = clean(raw.variantCode) || null;
    if (explicitCategory && !category) { errors.push({ row: index + 1, reason: 'unsupported furniture category' }); return; }
    if (category && categoryForRole(role) && categoryForRole(role) !== category) {
      errors.push({ row: index + 1, reason: 'category conflicts with role' }); return;
    }
    if (!role) { errors.push({ row: index + 1, reason: 'missing role' }); return; }
    const candidateId = `${source.id}:${supplierSku || 'row-' + (index + 1)}:${variantCode || 'base'}`;
    if (seen.has(candidateId)) { errors.push({ row: index + 1, reason: 'duplicate supplier SKU and variant' }); return; }
    seen.add(candidateId);
    const dimensionsMm = {
      width: positive(raw.widthMm ?? raw.width),
      depth: positive(raw.depthMm ?? raw.depth),
      height: positive(raw.heightMm ?? raw.height),
    };
    const amount = nonnegative(raw.priceAmount ?? raw.price);
    const currency = clean(raw.currency).toUpperCase();
    const price = amount == null || !/^[A-Z]{3}$/.test(currency) ? null : { amount, currency };
    const availability = clean(raw.availability).toLowerCase();
    const normalizedAvailability = AVAILABILITY.has(availability) ? availability : 'unknown';
    const purchaseUnit = clean(raw.purchaseUnit).toLowerCase();
    const normalizedPurchaseUnit = ['single', 'set'].includes(purchaseUnit) ? purchaseUnit : 'unknown';
    const leadDays = nonnegative(raw.leadDays);
    const useSpec = category === 'wardrobe' ? {
      doorMechanism: clean(raw.doorMechanism).toLowerCase(),
      frontClearanceMm: positive(raw.frontClearanceMm),
    } : category === 'bed' ? {
      leftClearanceMm: nonnegative(raw.leftClearanceMm),
      rightClearanceMm: nonnegative(raw.rightClearanceMm),
      footClearanceMm: nonnegative(raw.footClearanceMm),
    } : ZONED_CATEGORIES.has(category) ? { zones: parseUseZones(raw.useZones, dimensionsMm.width, dimensionsMm.depth) } : null;
    const useSpecComplete = category === 'wardrobe'
      ? ['hinged', 'sliding'].includes(useSpec.doorMechanism) && useSpec.frontClearanceMm != null
      : category === 'bed' ? useSpec.leftClearanceMm != null && useSpec.rightClearanceMm != null &&
        useSpec.footClearanceMm != null && useSpec.leftClearanceMm + useSpec.rightClearanceMm > 0
      : ZONED_CATEGORIES.has(category) && Array.isArray(useSpec.zones) && useSpec.zones.length > 0;
    const useReview = source.trustUseSpec === true && typeof source.useReviewedBy === 'string' && source.useReviewedBy.trim() &&
      Number.isFinite(Date.parse(source.useReviewedAt))
      ? { reviewedBy: source.useReviewedBy.trim(), reviewedAt: source.useReviewedAt } : null;
    const rawFields = {
      category: raw.category,
      role: raw.role,
      name: raw.name ?? raw.title,
      supplierSku: raw.supplierSku ?? raw.sku,
      variantCode: raw.variantCode,
      widthMm: raw.widthMm ?? raw.width,
      depthMm: raw.depthMm ?? raw.depth,
      heightMm: raw.heightMm ?? raw.height,
      priceAmount: raw.priceAmount ?? raw.price,
      currency: raw.currency,
      availability: raw.availability,
      purchaseUnit: raw.purchaseUnit,
      leadDays: raw.leadDays,
      doorMechanism: raw.doorMechanism,
      frontClearanceMm: raw.frontClearanceMm,
      leftClearanceMm: raw.leftClearanceMm,
      rightClearanceMm: raw.rightClearanceMm,
      footClearanceMm: raw.footClearanceMm,
      useZones: raw.useZones == null ? null : typeof raw.useZones === 'string' ? raw.useZones : JSON.stringify(raw.useZones),
    };
    const fieldSources = Object.fromEntries(Object.entries(rawFields)
      .filter(([, value]) => clean(value) !== '')
      .map(([field, value]) => [field, { sourceRef: source.ref, observedAt: source.observedAt, raw: clean(value) }]));
    candidates.push({
      candidateId, sourceId: source.id, sourceRef: source.ref, observedAt: source.observedAt,
      category, role, name, supplierSku, variantCode, dimensionsMm, useSpec, useReview, price,
      availability: normalizedAvailability, purchaseUnit: normalizedPurchaseUnit, leadDays: Number.isInteger(leadDays) ? leadDays : null,
      verification: {
        spec: source.trustSpecs === true && dimensionsMm.width != null && dimensionsMm.depth != null && dimensionsMm.height != null,
        price: source.trustPrice === true && price != null,
        availability: source.trustAvailability === true && normalizedAvailability !== 'unknown',
        use: useReview != null && useSpecComplete,
      },
      fieldSources,
    });
  });
  return { candidates, errors };
}
