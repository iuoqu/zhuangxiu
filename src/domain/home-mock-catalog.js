// Fictional demonstration records. These are not supplier listings or market prices.
export const HOME_MOCK_SOURCE = '模拟 SKU 库 v1（非真实商品或报价）';

const item = (packageId, key, sku, name, unitPrice, width, depth, height) => Object.freeze({
  packageId, key, sku, name, unitPrice, currency: 'USD',
  dimensionsMm: width ? Object.freeze({ width, depth, height }) : null,
  visualFootprintMm: key === 'desk_chair_set' ? Object.freeze({ width: 1100, depth: 900 }) : null,
  source: HOME_MOCK_SOURCE, simulated: true,
});

export const HOME_MOCK_CATALOG = Object.freeze([
  item('starter', 'sofa_3', 'DEMO-ST-SOFA-01', '演示·紧凑三人沙发', 120, 1780, 800, 820),
  item('starter', 'coffee_table', 'DEMO-ST-COFFEE-01', '演示·小型茶几', 25, 800, 450, 420),
  item('starter', 'tv_console', 'DEMO-ST-TV-01', '演示·低电视柜', 35, 1200, 350, 480),
  item('starter', 'dining_table_2_4', 'DEMO-ST-TABLE-01', '演示·2–4人餐桌', 55, 900, 600, 750),
  item('starter', 'dining_chair', 'DEMO-ST-CHAIR-01', '演示·餐椅', 20, 430, 480, 820),
  item('starter', 'queen_bed_frame', 'DEMO-ST-BED-01', '演示·Queen床架', 80, 2120, 1630, 350),
  item('starter', 'nightstand', 'DEMO-ST-NIGHT-01', '演示·床头柜', 15, 400, 350, 450),
  item('starter', 'dresser_4', 'DEMO-ST-DRESSER-01', '演示·四抽斗柜', 50, 800, 400, 850),
  item('starter', 'queen_mattress', 'DEMO-ST-MATTRESS-01', '演示·Queen床垫', 130, 2030, 1520, 250),

  item('comfort', 'sofa_3', 'DEMO-CO-SOFA-01', '演示·三人沙发', 180, 1950, 850, 840),
  item('comfort', 'coffee_table', 'DEMO-CO-COFFEE-01', '演示·茶几', 25, 900, 500, 420),
  item('comfort', 'tv_console', 'DEMO-CO-TV-01', '演示·电视柜', 40, 1400, 380, 500),
  item('comfort', 'accent_chair', 'DEMO-CO-ACCENT-01', '演示·休闲椅', 45, 720, 760, 800),
  item('comfort', 'dining_table_4', 'DEMO-CO-TABLE-01', '演示·四人餐桌', 70, 1200, 750, 750),
  item('comfort', 'dining_chair', 'DEMO-CO-CHAIR-01', '演示·餐椅', 20, 450, 500, 830),
  item('comfort', 'queen_bed_frame', 'DEMO-CO-BED-01', '演示·Queen床架', 80, 2140, 1650, 380),
  item('comfort', 'nightstand', 'DEMO-CO-NIGHT-01', '演示·床头柜', 15, 420, 380, 470),
  item('comfort', 'dresser_6', 'DEMO-CO-DRESSER-01', '演示·六抽斗柜', 65, 1200, 450, 850),
  item('comfort', 'desk_chair_set', 'DEMO-CO-DESKSET-01', '演示·书桌＋办公椅套装', 85),
  item('comfort', 'queen_mattress', 'DEMO-CO-MATTRESS-01', '演示·Queen床垫', 120, 2030, 1520, 260),

  item('premium', 'sofa_3', 'DEMO-PR-SOFA-01', '演示·宽三人沙发', 260, 2200, 920, 850),
  item('premium', 'coffee_table', 'DEMO-PR-COFFEE-01', '演示·茶几', 50, 1100, 600, 420),
  item('premium', 'tv_console', 'DEMO-PR-TV-01', '演示·电视柜', 85, 1800, 450, 520),
  item('premium', 'accent_chair', 'DEMO-PR-ACCENT-01', '演示·休闲椅', 90, 800, 850, 820),
  item('premium', 'dining_table_6', 'DEMO-PR-TABLE-01', '演示·六人餐桌', 170, 1800, 900, 750),
  item('premium', 'dining_chair', 'DEMO-PR-CHAIR-01', '演示·餐椅', 35, 480, 530, 850),
  item('premium', 'queen_bed_frame', 'DEMO-PR-BED-01', '演示·Queen床架', 125, 2180, 1700, 400),
  item('premium', 'nightstand', 'DEMO-PR-NIGHT-01', '演示·床头柜', 35, 500, 420, 500),
  item('premium', 'dresser_6', 'DEMO-PR-DRESSER-01', '演示·六抽斗柜', 120, 1400, 500, 880),
  item('premium', 'desk_chair_set', 'DEMO-PR-DESKSET-01', '演示·书桌＋办公椅套装', 160),
  item('premium', 'queen_mattress', 'DEMO-PR-MATTRESS-01', '演示·Queen床垫', 160, 2030, 1520, 280),
]);

export function mockSkusForPackage(packageId) {
  return HOME_MOCK_CATALOG.filter(product => product.packageId === packageId);
}

export function mockProductsForPackage(packageId) {
  return Object.fromEntries(mockSkusForPackage(packageId).map(({ key, name, sku, source, unitPrice, dimensionsMm, visualFootprintMm }) =>
    [key, { name, sku, source, unitPrice, dimensionsMm, ...(visualFootprintMm ? { visualFootprintMm } : {}), simulated: true }]));
}
