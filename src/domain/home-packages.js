export const HOME_PACKAGE_VERSION = 1;

const row = (room, key, label, quantity, options = {}) => Object.freeze({ room, key, label, quantity, ...options });
const commonLiving = [
  row('客厅', 'sofa_3', '三人沙发', 1),
  row('客厅', 'coffee_table', '茶几', 1),
  row('客厅', 'tv_console', '电视柜', 1),
];
const commonBedroom = (beds, drawers) => [
  row('卧室（全套）', 'queen_bed_frame', 'Queen 床架', beds, { size: 'queen' }),
  row('卧室（全套）', 'nightstand', '床头柜', 2),
  row('卧室（全套）', `dresser_${drawers}`, `${drawers} 抽斗柜`, beds, { drawerCount: drawers }),
  ...(beds === 2 ? [row('卧室（全套）', 'desk_chair_set', '书桌＋办公椅套装', 1, { components: ['书桌', '办公椅'] })] : []),
  row('卧室（全套）', 'queen_mattress', 'Queen 床垫', beds, { size: 'queen' }),
];

export const HOME_PACKAGES = Object.freeze([
  Object.freeze({ id: 'starter', label: 'Studio / 一室一厅 · 基础款', apartmentTypes: ['studio', '1b1b', 'loft1b1b'], budgetUsd: 600,
    lines: Object.freeze([...commonLiving, row('餐厅', 'dining_table_2_4', '2–4 人餐桌', 1, { seats: [2, 4] }),
      row('餐厅', 'dining_chair', '餐椅', 2), ...commonBedroom(1, 4)]) }),
  Object.freeze({ id: 'comfort', label: '两室两卫 · 舒适款', apartmentTypes: ['2b2b'], budgetUsd: 1200,
    lines: Object.freeze([...commonLiving, row('客厅', 'accent_chair', '休闲椅', 1),
      row('餐厅', 'dining_table_4', '四人餐桌', 1, { seats: [4, 4] }), row('餐厅', 'dining_chair', '餐椅', 4),
      ...commonBedroom(2, 6)]) }),
  Object.freeze({ id: 'premium', label: '两室两卫 · 高端款', apartmentTypes: ['2b2b'], budgetUsd: 2000,
    lines: Object.freeze([...commonLiving, row('客厅', 'accent_chair', '休闲椅', 2),
      row('餐厅', 'dining_table_6', '六人餐桌', 1, { seats: [6, 6] }), row('餐厅', 'dining_chair', '餐椅', 6),
      ...commonBedroom(2, 6)]) }),
]);

export function homePackage(id) {
  return HOME_PACKAGES.find(item => item.id === id) || null;
}

export function createHomeProject(packageId = 'starter', apartmentType = 'studio') {
  const template = homePackage(packageId);
  if (!template || !template.apartmentTypes.includes(apartmentType)) throw new TypeError('Invalid home package or apartment type');
  return { version: HOME_PACKAGE_VERSION, projectType: 'home', packageId, apartmentType,
    budget: { amount: template.budgetUsd, currency: 'USD', scope: 'merchandise_only' }, products: {} };
}

export function assessHomePackage(project) {
  const template = homePackage(project?.packageId);
  if (project?.projectType !== 'home' || !template || !template.apartmentTypes.includes(project.apartmentType)) {
    throw new TypeError('Invalid home project');
  }
  const cap = Number(project.budget?.amount);
  if (!Number.isFinite(cap) || cap <= 0 || project.budget?.currency !== 'USD' ||
      project.budget?.scope !== 'merchandise_only') throw new TypeError('Invalid merchandise budget');
  const lines = template.lines.map(required => {
    const product = project.products?.[required.key] || {};
    const name = typeof product.name === 'string' ? product.name.trim() : '';
    const sku = typeof product.sku === 'string' ? product.sku.trim() : '';
    const source = typeof product.source === 'string' ? product.source.trim() : '';
    const rawPrice = product.unitPrice;
    const unitPrice = rawPrice === '' || rawPrice == null ? null : Number(rawPrice);
    const priceValid = unitPrice !== null && Number.isFinite(unitPrice) && unitPrice >= 0 &&
      Math.abs(Math.round(unitPrice * 100) - unitPrice * 100) < 1e-7;
    const dimensions = product.dimensionsMm;
    const dimensionsMm = dimensions && [dimensions.width, dimensions.depth].every(value =>
      Number.isFinite(value) && value >= 100 && value <= 100000)
      ? { width: dimensions.width, depth: dimensions.depth,
        height: Number.isFinite(dimensions.height) && dimensions.height >= 0 && dimensions.height <= 100000 ? dimensions.height : null }
      : null;
    const simulated = product.simulated === true;
    const visual = simulated ? product.visualFootprintMm : null;
    const visualFootprintMm = visual && [visual.width, visual.depth].every(value =>
      Number.isFinite(value) && value >= 100 && value <= 100000)
      ? { width: visual.width, depth: visual.depth } : null;
    const complete = !!name && !!sku && !!source && priceValid && !simulated;
    const estimateLineTotal = priceValid ? Math.round(unitPrice * 100) * required.quantity / 100 : null;
    return { ...required, name, sku, source, dimensionsMm, visualFootprintMm, unitPrice: priceValid ? unitPrice : null,
      simulated, complete, estimateLineTotal, lineTotal: complete ? estimateLineTotal : null,
      missing: [...(!name ? ['商品名称'] : []), ...(!sku ? ['SKU'] : []), ...(!source ? ['来源'] : []), ...(!priceValid ? ['单价'] : []),
        ...(simulated ? ['模拟 SKU 待替换'] : [])] };
  });
  const itemCount = lines.reduce((sum, line) => sum + line.quantity * (line.components?.length || 1), 0);
  const complete = lines.every(line => line.complete);
  const pricedCount = lines.filter(line => line.unitPrice !== null).length;
  const simulatedCount = lines.filter(line => line.simulated).length;
  const knownSubtotal = Math.round(lines.reduce((sum, line) => sum + (line.estimateLineTotal || 0), 0) * 100) / 100;
  const priceSubtotal = pricedCount === lines.length ? knownSubtotal : null;
  const subtotal = complete ? knownSubtotal : null;
  return { template, lines, itemCount, completeCount: lines.filter(line => line.complete).length,
    missingCount: lines.filter(line => !line.complete).length, simulatedCount, pricedCount, priceSubtotal, subtotal, knownSubtotal,
    priceBudgetStatus: priceSubtotal === null ? 'pending' : priceSubtotal <= cap ? 'within_budget' : 'over_budget',
    priceDifference: priceSubtotal === null ? null : Math.round((cap - priceSubtotal) * 100) / 100,
    budgetStatus: !complete ? 'pending' : subtotal <= cap ? 'within_budget' : 'over_budget',
    difference: complete ? Math.round((cap - subtotal) * 100) / 100 : null,
    fitStatus: 'not_checked' };
}
