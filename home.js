import { HOME_PACKAGES, createHomeProject, assessHomePackage, homePackage } from './src/domain/home-packages.js';
import { HOME_MOCK_CATALOG, mockSkusForPackage, mockProductsForPackage } from './src/domain/home-mock-catalog.js';
import { buildHomeConceptLayout } from './src/domain/home-concept-layout.js';
import { screenHomeFurnitureFit } from './src/domain/home-fit-screen.js';
import { createHomeAutoDraft, fillMissingHomeVisualSizes } from './src/domain/home-auto-draft.js';
import { assessHomeReviewGate } from './src/domain/home-review-gate.js';
import { homeZoneGeometryWarnings } from './src/domain/home-zone-geometry.js';
import { snapHomeZoneToLines } from './src/domain/home-wall-snap.js';
import { buildHomePlanStructure, proposeHomeRoomRegions, matchHomeRoomRegions,
  filterHomeSpaceMarginBoxes, reconcileHomeSpaceSuggestions } from './src/domain/home-room-segmentation.js';
import { selectHomePartialPreviewZones } from './src/domain/home-partial-preview.js';

const STORE = 'home-furniture-package-v1';
const $ = selector => document.querySelector(selector);
const money = value => `$${Number(value).toFixed(2)}`;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const kinds = { studio: 'Studio（开放式）', '1b1b': '一室一厅 / 1B1B', loft1b1b: '一室一厅＋夹层 / Loft', '2b2b': '两室两卫 / 2B2B' };
const demoPlanPresets = [
  { type: 'studio', label: '开放式 Studio', detail: '起居、餐区、睡眠区' },
  { type: '1b1b', label: '一室一厅', detail: '独立卧室与起居区' },
  { type: 'loft1b1b', label: '一室＋夹层', detail: '含夹层示意区域' },
  { type: '2b2b', label: '两室两卫', detail: '两处卧室示意区域' },
];
const demoPlanPreviewCache = new Map();

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE));
    const projects = saved?.projects;
    if (!projects || typeof projects !== 'object' || Array.isArray(projects)) return { projects: {}, sites: {} };
    const validProjects = Object.fromEntries(Object.entries(projects).filter(([key, value]) => {
      try { return key === value.packageId && !!assessHomePackage(value); } catch { return false; }
    }).map(([key, value]) => [key, { ...value,
      placementOverrides: cleanPlacementOverrides(value.placementOverrides),
      placementReviews: cleanPlacementReviews(value.placementReviews) }]));
    const sites = saved.sites && typeof saved.sites === 'object' && !Array.isArray(saved.sites) ? saved.sites : {};
    return { projects: validProjects, sites };
  } catch { return { projects: {}, sites: {} }; }
}

const saved = load();
let projects = saved.projects, sites = saved.sites;
let active = localStorage.getItem(`${STORE}:active`) || 'starter';
let showDetails = false;
let conceptLayout = null;
let tentativeLayout = null, tentativeZones = [];
let fitScreen = null;
let reviewGate = null;
if (!homePackage(active)) active = 'starter';

function current() {
  if (!projects[active]) projects[active] = createHomeProject(active, homePackage(active).apartmentTypes[0]);
  return projects[active];
}

function persist() {
  localStorage.setItem(STORE, JSON.stringify({ version: 1, projects, sites }));
  localStorage.setItem(`${STORE}:active`, active);
}

function currentSite() { return sites[current().apartmentType] || null; }
function isDemoSite(site = currentSite()) { return typeof site?.source?.fileName === 'string' && site.source.fileName.startsWith('系统演示户型'); }
function siteState() {
  const site = currentSite();
  if (!site?.source) return '未录入户型图';
  if (isDemoSite(site)) return '系统演示户型（非真实图纸），尺寸和摆放待核对';
  if (site.source.kind === 'pdf') return 'PDF 已附加，尺寸与房间待人工核对';
  if (site.planOverview && !overviewReady(site)) return 'AI 户型概况待核对；房间与家具尚未确认';
  if (tentativeLayout?.placedCount) return `已绘出 ${tentativeLayout.placedCount} 件模拟家具候选示意；房间边界和适配未核验`;
  if (overviewReady(site) && !site.zones?.length) return '整体户型已核对；房间边界与家具尚未确认';
  if (site.zones?.some(zone => zone.reviewStatus === 'draft'))
    return `AI 区域草稿 · ${site.zones.filter(zone => zone.reviewStatus === 'draft').length} 个区域待内部复核，家具暂不绘制`;
  if (!site.calibration?.mmPerPx) {
    const printed = site.zones?.filter(zone => zone.dimensionsMm).length || 0;
    return printed ? `已录入图纸与 ${printed} 处图示尺寸；比例和摆放待核对` : '图片已上传，比例待校准';
  }
  if (!site.zones?.length) return '比例已校准，房间待标注';
  return `已校准比例并标注 ${site.zones.length} 个房间区域；尺寸仍需实测复核`;
}

function availablePackages(apartmentType) {
  return HOME_PACKAGES.filter(item => item.apartmentTypes.includes(apartmentType));
}

function zoneDrawingSize(zone) { return zone?.dimensionsMm || zone?.visualSizeMm || null; }
function cleanPlacementOverrides(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, item]) =>
    /^[a-z0-9_]+-[1-9]\d*$/.test(key) && item && typeof item === 'object' &&
    typeof item.zoneId === 'string' && item.zoneId.length < 120 &&
    [item.xRatio, item.yRatio].every(number => Number.isFinite(number) && number >= 0 && number <= 1))
    .map(([key, item]) => [key, { zoneId: item.zoneId, xRatio: item.xRatio, yRatio: item.yRatio }]));
}
function cleanPlacementReviews(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, item]) =>
    /^[a-z0-9_]+-[1-9]\d*$/.test(key) && item && typeof item === 'object' &&
    /^[0-9a-f]{8}$/.test(item.fingerprint))
    .map(([key, item]) => [key, { fingerprint: item.fingerprint,
      reviewedAt: typeof item.reviewedAt === 'string' ? item.reviewedAt.slice(0, 40) : '' }]));
}
function drawableZones(site = currentSite()) {
  return site?.source?.kind === 'image' ? (site.zones || []).filter(zone =>
    ['living', 'dining', 'bedroom', 'mezzanine'].includes(zone.kind) && zoneDrawingSize(zone)) : [];
}
function hasUnreviewedAiZones(site = currentSite()) {
  return site?.source?.kind === 'image' && (site.zones || []).some(zone =>
    zone.reviewStatus === 'draft' || zone.kind === 'unknown');
}
function suggestedApartmentType(overview) {
  if (!overview || overview.livingCount !== 1) return null;
  if (overview.bedroomCount === 0 && overview.bathroomCount === 1 && overview.hasMezzanine === false) return 'studio';
  if (overview.bedroomCount === 1 && overview.bathroomCount === 1)
    return overview.hasMezzanine ? 'loft1b1b' : '1b1b';
  if (overview.bedroomCount === 2 && overview.bathroomCount === 2 && overview.hasMezzanine === false) return '2b2b';
  return null;
}
function cleanPlanOverview(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const bounded = (number, max) => Number.isInteger(number) && number >= 0 && number <= max ? number : null;
  const strings = (items, max) => Array.isArray(items) ? items.slice(0, max)
    .filter(item => typeof item === 'string').map(item => item.slice(0, 120)) : [];
  const overview = { floorCount: bounded(value.floorCount, 4), bedroomCount: bounded(value.bedroomCount, 8),
    livingCount: bounded(value.livingCount, 5), bathroomCount: bounded(value.bathroomCount, 8),
    hasMezzanine: typeof value.hasMezzanine === 'boolean' ? value.hasMezzanine : null,
    floorEvidence: strings(value.floorEvidence, 6), roomEvidence: strings(value.roomEvidence, 16),
    uncertainties: strings(value.uncertainties, 8), reviewed: value.reviewed === true,
    mismatchAcknowledged: value.mismatchAcknowledged === true };
  if (overview.floorCount === 0) overview.floorCount = null;
  if ([overview.floorCount, overview.bedroomCount, overview.livingCount, overview.bathroomCount, overview.hasMezzanine].includes(null))
    overview.reviewed = false;
  return overview;
}
function overviewReady(site = currentSite()) { return site?.planOverview?.reviewed === true; }
function packageMatchesReviewedPlan(site = currentSite()) {
  return !site?.planOverview || !overviewReady(site) || isDemoSite(site) ||
    suggestedApartmentType(site.planOverview) === current().apartmentType;
}

function createDemoSite(apartmentType) {
  const canvas = document.createElement('canvas');
  canvas.width = 1000; canvas.height = 760;
  const context = canvas.getContext('2d');
  context.fillStyle = '#f8fafc'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#334155'; context.font = 'bold 21px system-ui';
  context.fillText(`系统演示户型 · ${kinds[apartmentType] || ''} · 非真实图纸`, 55, 38);
  const twoBedroom = apartmentType === '2b2b';
  const specs = twoBedroom ? [
    ['living', 60, 70, 400, 300, 4800, 4300],
    ['dining', 60, 390, 400, 300, 4000, 3500],
    ['bedroom', 490, 70, 440, 300, 4200, 4200],
    ['bedroom', 490, 390, 440, 300, 4200, 4200],
  ] : apartmentType === 'studio' ? [
    ['living', 60, 70, 430, 300, 3900, 3200],
    ['dining', 60, 390, 430, 300, 2800, 2800],
    ['bedroom', 510, 70, 420, 620, 3600, 4900],
  ] : apartmentType === 'loft1b1b' ? [
    ['living', 60, 70, 360, 300, 4000, 3900],
    ['dining', 60, 390, 360, 300, 3000, 2800],
    ['bedroom', 450, 70, 480, 360, 3800, 4000],
    ['mezzanine', 450, 450, 480, 240, 3300, 3400],
  ] : [
    ['living', 60, 70, 360, 300, 4000, 3900],
    ['dining', 60, 390, 360, 300, 3000, 2800],
    ['bedroom', 450, 70, 480, 460, 3800, 4300],
  ];
  const zones = specs.map(([kind, x, y, w, h, width, depth], index) => {
    context.fillStyle = kind === 'bedroom' ? '#f5f3ff' : kind === 'dining' ? '#f0fdf4' : '#eff6ff';
    context.fillRect(x, y, w, h);
    context.strokeStyle = '#64748b'; context.lineWidth = 3; context.setLineDash([8, 5]);
    context.strokeRect(x, y, w, h); context.setLineDash([]);
    context.fillStyle = '#334155'; context.font = 'bold 22px system-ui';
    context.fillText(`${{ living: '客厅', dining: '餐区', bedroom: '卧室', mezzanine: '夹层' }[kind]} ${kind === 'bedroom' && twoBedroom ? index - 1 : ''}`, x + 16, y + 32);
    return { id: `demo-${kind}-${index + 1}`, kind, x, y, w, h,
      dimensionsMm: { width, depth }, dimensionsLabel: `${(width / 1000).toFixed(1)}m × ${(depth / 1000).toFixed(1)}m（演示）` };
  });
  return { source: { kind: 'image', fileName: `系统演示户型（${apartmentType}，非真实图纸）.jpg`,
    dataUrl: canvas.toDataURL('image/jpeg', .82), widthPx: canvas.width, heightPx: canvas.height },
    note: '系统生成的演示户型与示意尺寸，不属于用户上传图纸，不可用于实际适配判断。', zones };
}

function renderDemoPlanGallery() {
  const selected = current().apartmentType;
  $('#demoPlanGrid').innerHTML = demoPlanPresets.map(preset => {
    if (!demoPlanPreviewCache.has(preset.type))
      demoPlanPreviewCache.set(preset.type, createDemoSite(preset.type).source.dataUrl);
    return `<button class="demo-plan-card" type="button" data-demo-plan="${preset.type}" aria-pressed="${preset.type === selected}"><img src="${demoPlanPreviewCache.get(preset.type)}" alt="${preset.label}虚构户型示意图"><strong>${preset.label}</strong><small>${preset.detail}</small></button>`;
  }).join('');
}

function renderNextStep() {
  const site = currentSite(), assessment = assessHomePackage(current());
  const expectedPlacements = assessment.lines.filter(line => line.key !== 'queen_mattress')
    .reduce((sum, line) => sum + line.quantity, 0);
  const hasRooms = site?.source?.kind === 'image' && (site.zones || []).some(zone =>
    ['living', 'dining', 'bedroom', 'mezzanine'].includes(zone.kind));
  const allMock = assessment.simulatedCount === assessment.lines.length;
  let title, description, action, label;
  if (conceptLayout?.placedCount) {
    title = `${isDemoSite(site) ? '演示' : '客户图纸'}初稿绘出 ${conceptLayout.placedCount}/${expectedPlacements} 项家具示意占位`;
    const draftCount = (site?.zones || []).filter(zone => zone.reviewStatus === 'draft').length;
    description = `${draftCount ? `${draftCount} 个 AI 房间框的名称和边界待核对；` : ''}${expectedPlacements - conceptLayout.placedCount} 项尚未绘出；尺寸与真实商品仍须内部复核。`;
    action = draftCount ? 'reviewZones' : 'inspect'; label = draftCount ? '核对房间框' : '查看方案';
  } else if (tentativeLayout?.placedCount) {
    title = `先看 ${tentativeLayout.placedCount} 件模拟家具候选示意`;
    description = '仅在无明显冲突的候选区域显示；有疑点的房间仍需对照原图修正。未核对尺寸，不可下载为交付图。';
    action = 'reviewZones'; label = '核对异常区域';
  } else if (!site?.source) {
    title = '先上传你的户型图';
    description = '上传不会自动发送图纸；点击识别后，先核对户型，再查看家具候选示意。也可体验下方模拟演示。';
    action = 'upload'; label = '选择户型图';
  } else if (site.source.kind === 'pdf') {
    title = '把 PDF 换成可标注的图片';
    description = '现有 PDF 会保留至替换前；家具预览需要 JPG、PNG 或 WebP 图片。';
    action = 'upload'; label = '选择图片';
  } else if (!overviewReady(site) && !isDemoSite(site) && (site.planOverview || !site.zones?.length)) {
    title = '图纸已上传，先识别几室几厅几层';
    description = 'AI 先读整套户型与图上依据。核对确认后，再识别房间边界；此时不会摆家具。';
    action = 'overview'; label = '识别户型';
  } else if (!packageMatchesReviewedPlan(site)) {
    title = '当前套餐不覆盖已确认的户型';
    description = '仍可继续识别和核对房间；匹配套餐准备好之前，不会按错误套餐填家具或下载家具图。';
    action = aiZoneDraft || hasUnreviewedAiZones(site) ? 'reviewZones' : !site.zones?.length ? 'auto' : 'overview';
    label = action === 'reviewZones' ? '核对房间' : action === 'auto' ? '仅识别房间' : '查看户型与套餐';
  } else if (hasUnreviewedAiZones(site)) {
    title = 'AI 房间识别待核对，家具尚未生成';
    description = `${site.zones.filter(zone => zone.reviewStatus === 'draft').length} 个候选区域需内部核对名称和边界；确认后才会绘制家具占位。`;
    action = 'reviewZones'; label = '核对房间框';
  } else if (!hasRooms) {
    title = '图纸已上传，先识别房间';
    description = '户型概况已确认。再识别房间区域；核对名称和边界后才会绘制家具。';
    action = 'auto'; label = '识别房间草稿';
  } else if (!drawableZones(site).length) {
    title = '先核对房间尺寸';
    description = '可读取图上印出的尺寸并确认，或用实测距离校准比例。';
    action = 'dimensions'; label = '查看尺寸入口';
  } else if (allMock) {
    title = '模拟商品已就绪';
    description = '沿用当前图纸和模拟 SKU，直接查看家具方案。';
    action = 'preview'; label = '查看方案';
  } else {
    title = '用当前图纸生成模拟方案';
    description = '自动载入本套餐模拟 SKU；若已有商品内容，会先征求替换确认。';
    action = 'demo'; label = '生成演示方案';
  }
  $('#nextStepTitle').textContent = title;
  $('#nextStepText').textContent = description;
  $('#nextStepAction').textContent = label;
  $('#nextStepAction').dataset.action = action;
  $('#startRealPlan').hidden = !!site?.source && !isDemoSite(site);
  $('#startRealPlan').textContent = site?.source ? '上传我的图纸' : '体验模拟演示';
}

function renderSelectors() {
  const project = current();
  $('#apartmentType').value = project.apartmentType;
  $('#packageId').innerHTML = availablePackages(project.apartmentType).map(item =>
    `<option value="${item.id}">${item.label} · $${item.budgetUsd}</option>`).join('');
  $('#packageId').value = project.packageId;
  $('#packageDescription').textContent = `商品预算上限 ${money(project.budget.amount)} · ${kinds[project.apartmentType]} · 套餐必选件按整套数量核对。`;
}

function renderLines() {
  const assessment = assessHomePackage(current());
  const rooms = [...new Set(assessment.lines.map(line => line.room))];
  $('#packageLines').innerHTML = rooms.map(room => `<div class="room"><h3>${room}</h3>${assessment.lines.filter(line => line.room === room).map(line => {
    const product = current().products[line.key] || {};
    return `<div class="product" data-key="${line.key}"><div class="product-title"><strong>${line.label} ×${line.quantity}${line.simulated ? ' <em class="mock-badge">模拟</em>' : ''}</strong><small>${line.components ? `${line.components.join('＋')} · 1 套 / 2 件` : line.size === 'queen' ? 'Queen 尺寸' : line.drawerCount ? `${line.drawerCount} 抽` : line.seats ? (line.seats[0] === line.seats[1] ? `${line.seats[0]} 人` : `${line.seats[0]}–${line.seats[1]} 人`) : '必选商品'}</small></div>
      <div class="field product-name"><span>商品名称（可稍后填）</span><input data-field="name" aria-label="${line.label}商品名称" value="${escapeHtml(product.name)}" placeholder="选定后填写"></div>
      <div class="field product-price"><span>单价 USD</span><input data-field="unitPrice" aria-label="${line.label}单价" type="number" min="0" step="0.01" value="${escapeHtml(product.unitPrice ?? '')}" placeholder="0.00"></div>
      <div class="line-total">小计 <b>${line.estimateLineTotal === null ? '待填' : money(line.estimateLineTotal)}</b></div>
      <div class="product-details"><div class="field"><span>SKU / 型号</span><input data-field="sku" aria-label="${line.label}SKU" value="${escapeHtml(product.sku)}" placeholder="采购核对时填写"></div>
      <div class="field"><span>价格来源</span><input data-field="source" aria-label="${line.label}价格来源" value="${escapeHtml(product.source)}" placeholder="供应商或链接"></div>
      <div class="field"><span>商品外廓一边（毫米）</span><input data-field="widthMm" aria-label="${line.label}外廓一边毫米" type="number" min="100" max="100000" step="1" value="${escapeHtml(product.dimensionsMm?.width ?? '')}" placeholder="待核对"></div>
      <div class="field"><span>商品外廓另一边（毫米）</span><input data-field="depthMm" aria-label="${line.label}外廓另一边毫米" type="number" min="100" max="100000" step="1" value="${escapeHtml(product.dimensionsMm?.depth ?? '')}" placeholder="待核对"></div></div></div>`;
  }).join('')}</div>`).join('');
  $('#packageLines').classList.toggle('show-details', showDetails);
  $('#toggleDetails').textContent = showDetails ? '收起采购详情' : '展开 SKU / 价格来源';
  $('#toggleDetails').setAttribute('aria-expanded', String(showDetails));
}

function renderMockCatalog() {
  $('#mockCatalogCount').textContent = HOME_MOCK_CATALOG.length;
  $('#mockCatalogBody').innerHTML = HOME_MOCK_CATALOG.map(item => {
    const packageLabel = { starter: '基础', comfort: '舒适', premium: '高端' }[item.packageId];
    const dimensions = item.dimensionsMm ? `${item.dimensionsMm.width}×${item.dimensionsMm.depth}×${item.dimensionsMm.height} mm` : '套装，尺寸待分件确认';
    return `<tr><td>${packageLabel}</td><td>${escapeHtml(item.name)}</td><td><code>${escapeHtml(item.sku)}</code></td><td>${escapeHtml(dimensions)}</td><td>${money(item.unitPrice)}</td></tr>`;
  }).join('');
}

function renderSummary() {
  const result = assessHomePackage(current()), cap = current().budget.amount;
  const site = currentSite(), evidence = $('#evidenceStatus');
  evidence.classList.toggle('demo', !site?.source || isDemoSite(site));
  evidence.textContent = !site?.source ? '未录入真实户型 · 可先体验演示，适配未核验。' :
    isDemoSite(site) ? '演示户型与模拟商品 · 不是你的房屋，适配未核验。' :
    site.source.kind === 'pdf' ? '你的 PDF 已保存 · 尚不能标注房间或判断适配。' :
      site.planOverview && !overviewReady(site) ? '你的户型 · AI 整体识别待核对 · 家具尚未绘制。' :
      hasUnreviewedAiZones(site) ? `你的户型 · ${site.zones.filter(zone => zone.reviewStatus === 'draft').length} 个 AI 区域待核对 · ${tentativeLayout?.placedCount ? `${tentativeLayout.placedCount} 件模拟家具仅候选示意` : '家具尚未绘制'}，适配未核验。` :
      tentativeLayout?.placedCount ? `你的户型 · ${tentativeLayout.placedCount} 件模拟家具仅候选示意 · 房间与适配待核对。` :
      `你的户型 · 已标注 ${site.zones?.length || 0} 个区域 · 家具实际适配未核验。`;
  const rows = [
    ['户型图', siteState()],
    ['单价进度', `${result.pricedCount}/${result.lines.length} 行`],
    ['实物数量', `${result.itemCount} 件`],
    ['商品预算', money(cap)],
    ['已填价格小计', money(result.knownSubtotal)],
    ['整套价格草算', result.priceSubtotal == null ? '待填齐单价' : money(result.priceSubtotal)],
    ['采购资料', result.simulatedCount ? `模拟 ${result.simulatedCount} 行 · 待真实商品替换` : `${result.completeCount}/${result.lines.length} 行齐全`],
  ];
  $('#summary').innerHTML = rows.map(([label, value]) => `<div class="metric"><span>${label}</span><b>${value}</b></div>`).join('') +
    (result.missingCount ? `<details class="missing-details"><summary>查看待补采购资料（${result.missingCount} 行）</summary><ul class="missing-list">${result.lines.filter(line => !line.complete).map(line => `<li>${line.label}：缺 ${line.missing.join('、')}</li>`).join('')}</ul></details>` : '');
  const status = $('#budgetStatus');
  status.className = `status ${result.priceBudgetStatus === 'over_budget' ? 'over' : result.priceBudgetStatus === 'within_budget' ? 'estimate' : 'pending'}`;
  status.textContent = result.priceBudgetStatus === 'pending' ? `还差 ${result.lines.length - result.pricedCount} 行单价，暂不能草算整套预算。` :
    result.priceBudgetStatus === 'over_budget' ? `按${result.simulatedCount ? '模拟' : '已填'}单价草算，超出商品预算 ${money(-result.priceDifference)}；不是正式报价。` :
      `按${result.simulatedCount ? '模拟' : '已填'}单价草算，低于预算 ${money(result.priceDifference)}；${result.simulatedCount ? '模拟 SKU 与价格不可用于采购，' : result.missingCount ? '采购资料尚未齐全，' : ''}不是正式报价。`;
  renderNextStep();
}

function renderConcept() {
  const host = $('#conceptReport');
  const awaitingRoomReview = hasUnreviewedAiZones();
  const packageMismatch = !packageMatchesReviewedPlan();
  furnitureEdit.hidden = currentSite()?.source?.kind !== 'image' || !conceptLayout?.placedCount;
  jumpFurnitureEdit.hidden = furnitureEdit.hidden;
  $('#resetFurniturePositions').disabled = !Object.keys(current().placementOverrides || {}).length;
  $('#generateConcept').textContent = packageMismatch ? '当前套餐不匹配' : awaitingRoomReview ? '先核对房间框' :
    current().conceptPreviewEnabled === true ? '隐藏占位预览' : '生成占位预览';
  $('#generateConcept').disabled = awaitingRoomReview || packageMismatch;
  $('#generateConcept').setAttribute('aria-pressed', String(current().conceptPreviewEnabled === true));
  $('#downloadFurnishedDraft').disabled = !conceptLayout?.placedCount || currentSite()?.source?.kind !== 'image';
  if (!conceptLayout) {
    fitScreen = null;
    host.innerHTML = packageMismatch
      ? '<p class="concept-caution">已确认的户型不属于当前套餐；可继续核对房间，但不会按错误套餐填家具或下载方案。请改选匹配套餐，或先增加对应户型套餐。</p>'
      : tentativeLayout?.placedCount
      ? `<p><strong>原图上已有 ${tentativeLayout.placedCount} 件模拟家具候选示意</strong>，仅覆盖 ${tentativeZones.length} 处相对低风险区域。房间名称、边界、实际尺寸与家具落位均未核验；风险区域没有强行摆放。此预览不可下载为交付图。</p>`
      : awaitingRoomReview
      ? '<p class="muted">AI 房间框尚未核对；为避免错位，暂不绘制或下载家具图。请先在原图上核对全部区域的名称与边界。</p>'
      : '<p class="muted">尚未生成。点击页面顶部“生成演示方案”，即可先看家具布局。</p>';
    $('#fitScreenReport').innerHTML = '<p class="muted">生成家具占位后，这里会显示尺寸初筛和待补条件。</p>';
    $('#roomPreviewWrap').hidden = true;
    renderReviewGate();
    renderNextStep();
    return;
  }
  const result = conceptLayout;
  fitScreen = screenHomeFurnitureFit(assessHomePackage(current()).lines, currentSite(), current().zoneAssignments, result);
  const zoneById = new Map((currentSite()?.zones || []).map(zone => [zone.id, zone]));
  const groups = new Map();
  for (const item of result.placements) {
    const zone = zoneById.get(item.zoneId);
    const key = zoneDisplayName(zone);
    groups.set(key, [...(groups.get(key) || []), `${item.marker} ${item.label}`]);
  }
  const draftZones = (currentSite()?.zones || []).filter(zone => zone.reviewStatus === 'draft').length;
  host.innerHTML = `<p><strong>${result.placedCount} 件绘出示意占位，不代表落位准确</strong> · ${result.pairedMattresses} 张床垫与床架共用占位 · ${result.pendingCount} 件待补条件。</p>` +
    (groups.size ? `<ul>${[...groups].map(([room, names]) => `<li>${escapeHtml(room)}：${names.map(escapeHtml).join('、')}</li>`).join('')}</ul>` : '') +
    (result.issues.length ? `<details open><summary>待核对事项（${result.issues.length}）</summary><ul>${result.issues.map(issue => `<li>${escapeHtml(issue.label)}：${escapeHtml(issue.reason)}</li>`).join('')}</ul></details>` : '') +
    `<p class="concept-caution">这是家具平面初稿，不是已核验的采购摆放图。${draftZones ? `${draftZones} 个 AI 房间框尚未核对名称和边界，框内家具只能算候选占位；` : ''}${result.visualOnlyCount ? `其中 ${result.visualOnlyCount} 件使用视觉绘图比例或示意套装外廓，需补房间及商品实测尺寸；` : ''}未检查门窗、固定设备、通道、搬运和真实 SKU，适配状态仍为“未核验”。</p>`;
  renderFitScreen();
  renderReviewGate();
  renderRoomPreview();
  renderNextStep();
}

function renderFitScreen() {
  const report = fitScreen, host = $('#fitScreenReport');
  if (!report) return;
  const headline = report.screenStatus === 'conflict' ? '发现外廓冲突，先复核尺寸' :
    report.screenStatus === 'incomplete' ? '部分商品尚不能初筛' : '现有矩形外廓未发现冲突';
  const evidence = [
    ...(report.evidence.demoSite ? ['系统演示户型'] : []),
    ...(report.evidence.simulatedProductCount ? [`${report.evidence.simulatedProductCount} 行模拟 SKU`] : []),
    ...(report.evidence.estimatedRoomCount ? [`${report.evidence.estimatedRoomCount} 处比例估算房间尺寸`] : []),
    ...(report.evidence.unreviewedRoomCount ? [`${report.evidence.unreviewedRoomCount} 处自动识别区域待复核`] : []),
  ];
  host.innerHTML = `<h3>尺寸与占位初筛</h3><p class="fit-screen-status ${report.screenStatus}"><strong>${headline}</strong> · 已检查 ${report.checkedCount} 件外廓 / 床垫配对，${report.pendingCount} 件或条件待补，${report.conflictCount} 处冲突。</p>` +
    (evidence.length ? `<p class="muted">当前证据：${evidence.map(escapeHtml).join('、')}。</p>` : '') +
    (report.findings.length ? `<details${report.screenStatus !== 'outline_clear' ? ' open' : ''}><summary>逐项查看（${report.findings.length}）</summary><ul>${report.findings.map(item =>
      `<li>${escapeHtml(item.label)}：${escapeHtml(item.reason)}</li>`).join('')}</ul></details>` : '') +
    `<p class="fit-screen-limit">适配状态：未核验。规则只检查外廓是否可沿房间两边放入、床垫床架配对及当前占位是否越界或重叠；尚未检查${report.unchecked.map(escapeHtml).join('、')}。初筛无冲突不等于能实际摆放。</p>`;
}

function renderReviewGate() {
  const host = $('#reviewGate');
  if (!conceptLayout || !fitScreen) { reviewGate = null; host.hidden = true; host.innerHTML = ''; return; }
  reviewGate = assessHomeReviewGate(current(), assessHomePackage(current()), currentSite(), conceptLayout, fitScreen);
  host.hidden = false;
  const labels = { unplaced: '未放置', pending_zone_review: '先核对房间框', conflict: '占位冲突', missing_size: '缺尺寸',
    pending_review: '待确认图上位置', position_reviewed: '图上位置已确认' };
  host.innerHTML = `<h3>交付前复核</h3><p class="gate-head">正式交付未放行 · 当前仅可下载平面初稿</p>` +
    `<p>已绘出 ${reviewGate.placedCount}/${reviewGate.reviewableCount} 个占位项，${reviewGate.reviewedCount} 项图上位置已人工标记；床垫与床架共用占位，套装仍须分件核对。</p>` +
    ((currentSite()?.zones || []).some(zone => zone.reviewStatus === 'draft') ? '<button class="secondary" type="button" data-jump-zone-review>到图上核对 AI 房间框</button>' : '') +
    `<details open><summary>阻止正式交付的条件（${reviewGate.blockers.length}）</summary><ul>${reviewGate.blockers.map(reason => `<li>${escapeHtml(reason)}</li>`).join('')}</ul></details>` +
    `<details><summary>逐项查看与确认图上位置（${reviewGate.rows.length} 项）</summary><ul class="review-items">${reviewGate.rows.map(row =>
      `<li><div><strong>${escapeHtml(row.marker ? `${row.marker} ${row.label}` : row.label)} · ${labels[row.status]}</strong><small>${escapeHtml(row.reason)}</small></div>` +
      (row.status === 'pending_review' ? `<button class="secondary" type="button" data-review-confirm="${escapeHtml(row.instanceId)}">确认图上位置</button>` :
        row.status === 'position_reviewed' ? `<button class="secondary" type="button" data-review-undo="${escapeHtml(row.instanceId)}">撤销确认</button>` : '') +
      '</li>').join('')}</ul></details>` +
    '<p class="gate-note">确认仅表示本地项目中的位置复核标记，不证明尺寸、门窗、通道、运输或真实商品合格；没有审核人身份与批准记录，不能作为正式交付。</p>';
}

function renderConceptAssignments() {
  const host = $('#conceptAssignments');
  const zones = (currentSite()?.zones || []).filter(zone => ['living', 'dining', 'bedroom', 'mezzanine'].includes(zone.kind));
  if (!zones.length) { host.innerHTML = '<p class="muted">请先录入并标注可摆家具的房间。</p>'; return; }
  const assignments = current().zoneAssignments || {};
  const lines = assessHomePackage(current()).lines.filter(line => line.key !== 'queen_mattress');
  host.innerHTML = lines.flatMap(line => Array.from({ length: line.quantity }, (_, i) => {
    const instance = `${line.key}:${i}`;
    const selected = assignments[instance] || '';
    const options = `<option value="">自动按套餐房间</option>` + zones.map(zone =>
      `<option value="${escapeHtml(zone.id)}"${selected === zone.id ? ' selected' : ''}>${zoneDisplayName(zone)}${zone.dimensionsMm ? '' : ' · 缺尺寸'}</option>`).join('');
    return `<label><span>${escapeHtml(line.label)}${line.quantity > 1 ? ` ${i + 1}` : ''}</span><select data-assignment="${instance}" aria-label="${escapeHtml(line.label)} ${i + 1}摆放区域">${options}</select></label>`;
  })).join('');
}

function invalidateConcept() {
  conceptLayout = current().conceptPreviewEnabled === true && !hasUnreviewedAiZones() && packageMatchesReviewedPlan()
    ? buildHomeConceptLayout(assessHomePackage(current()).lines, currentSite(), current().zoneAssignments,
      current().placementOverrides) : null;
  rebuildTentativePreview();
  renderConcept();
  drawPlan();
}

const planCanvas = $('#planCanvas'), planContext = planCanvas.getContext('2d');
const furnitureEdit = document.createElement('div');
furnitureEdit.className = 'furniture-edit'; furnitureEdit.id = 'furnitureEdit'; furnitureEdit.hidden = true;
furnitureEdit.innerHTML = '<div class="actions"><button class="secondary" id="adjustFurniture" type="button" aria-pressed="false">调整家具位置</button><button class="secondary" id="resetFurniturePositions" type="button">重置人工位置</button></div><p>内部复核：点击调整后，直接拖动图上的蓝色家具；红框表示占位重叠。这里是矩形示意，不能代替实测与通道检查。</p><p id="furnitureEditStatus" role="status"></p>';
$('#imageTools').prepend(furnitureEdit);
$('#furnitureEdit .actions').append($('#downloadFurnishedDraft'));
const jumpFurnitureEdit = document.createElement('button');
jumpFurnitureEdit.className = 'secondary'; jumpFurnitureEdit.id = 'jumpFurnitureEdit';
jumpFurnitureEdit.type = 'button'; jumpFurnitureEdit.textContent = '到图上调整家具';
$('#demoResult .product-actions').prepend(jumpFurnitureEdit);
const reviewGatePanel = document.createElement('section');
reviewGatePanel.id = 'reviewGate'; reviewGatePanel.className = 'review-gate'; reviewGatePanel.hidden = true;
reviewGatePanel.setAttribute('aria-label', '交付前复核');
$('#fitScreenReport').after(reviewGatePanel);
const tentativePreviewStatus = document.createElement('p');
tentativePreviewStatus.id = 'tentativePreviewStatus'; tentativePreviewStatus.className = 'plan-status';
tentativePreviewStatus.hidden = true;
$('#planView').after(tentativePreviewStatus);
const previewReviewNotice = document.createElement('div');
previewReviewNotice.id = 'previewReviewNotice'; previewReviewNotice.className = 'preview-review';
previewReviewNotice.hidden = true;
previewReviewNotice.innerHTML = '<span></span><button class="secondary" id="jumpZoneReview" type="button">核对房间区域</button>';
tentativePreviewStatus.after(previewReviewNotice);
$('#jumpZoneReview').addEventListener('click', () =>
  (aiZoneDraft ? $('#aiZoneAssist') : $('#zoneList')).scrollIntoView({ behavior: 'smooth', block: 'start' }));
const zoneNames = { living: '客厅', dining: '餐厅', bedroom: '卧室', bathroom: '卫生间', kitchen: '厨房',
  study: '书房', mezzanine: '夹层', void: '挑空（不可摆放）', stairs: '楼梯',
  deck: '露台（室外）', closet: '储物/衣柜', ac_ledge: '空调机位', unknown: '用途待判断' };
function zoneDisplayName(zone, site = currentSite()) {
  if (!zone) return '房间';
  const peers = (site?.zones || []).filter(item => item.kind === zone.kind);
  const number = peers.findIndex(item => item.id === zone.id) + 1;
  return `${zoneNames[zone.kind] || '房间'}${peers.length > 1 && number > 0 ? ` ${number}` : ''}`;
}
const fixedZones = new Set(['bathroom', 'kitchen', 'study', 'void', 'stairs', 'deck', 'closet', 'ac_ledge', 'unknown']);
let drawMode = null, drawing = null, calibrationPoints = [], planImage = null, planImageUrl = null;
let aiDimensionDraft = null;
let aiZoneDraft = null;
let aiZoneDrag = null;
let wallSnapPixels = null;
let segmentationCache = null;
let appliedZoneDrag = null;
let furnitureEditMode = false, furnitureDrag = null;

function rebuildTentativePreview() {
  tentativeLayout = null; tentativeZones = [];
  const site = currentSite(), source = site?.source;
  if (source?.kind !== 'image' || isDemoSite(site) || !overviewReady(site) || conceptLayout?.placedCount ||
      suggestedApartmentType(site.planOverview) !== current().apartmentType) return;
  if (aiZoneDraft?.source === source.dataUrl && aiZoneDraft.apartmentType === current().apartmentType) {
    const candidates = selectHomePartialPreviewZones(aiZoneDraft.suggestions, source, site.planOverview);
    tentativeZones = createHomeAutoDraft(candidates, source).zones;
  } else if (hasUnreviewedAiZones(site) && site.zones.some(zone => zone.previewSafe === true)) {
    tentativeZones = (site.zones || []).filter(zone =>
      ['living', 'dining', 'bedroom', 'mezzanine'].includes(zone.kind) &&
      (zone.reviewStatus === 'reviewed' || zone.previewSafe === true));
  }
  const previewCounts = { bedroom: tentativeZones.filter(zone => zone.kind === 'bedroom').length,
    living: tentativeZones.filter(zone => zone.kind === 'living').length };
  tentativeZones = tentativeZones.filter(zone => zone.kind !== 'bedroom' && zone.kind !== 'living' ||
    previewCounts[zone.kind] === site.planOverview[zone.kind === 'bedroom' ? 'bedroomCount' : 'livingCount']);
  if (!tentativeZones.length) return;
  const simulated = { ...current(), products: mockProductsForPackage(active) };
  const visualSite = { source, zones: tentativeZones.map(zone => ({ ...zone, reviewStatus: 'visual_only' })) };
  tentativeLayout = buildHomeConceptLayout(assessHomePackage(simulated).lines, visualSite);
}

function renderTentativePreviewStatus() {
  tentativePreviewStatus.hidden = !tentativeLayout?.placedCount;
  tentativePreviewStatus.textContent = tentativeLayout?.placedCount
    ? `已在 ${tentativeZones.length} 处候选区域绘出 ${tentativeLayout.placedCount} 件半透明模拟家具。仅供讨论；风险区域未强行摆放，房间边界、尺寸和实际适配均未核验，不可下载为交付图。`
    : '';
}

function renderPreviewReviewNotice() {
  const site = currentSite(), pending = (site?.zones || []).filter(zone => zone.reviewStatus === 'draft').length;
  const candidates = aiZoneDraft?.suggestions || [];
  const hasReview = candidates.length > 0 || pending > 0;
  previewReviewNotice.hidden = !hasReview;
  if (!hasReview) return;
  const uncertain = candidates.filter(zone => zone.kind === 'unknown').length;
  const risky = candidates.filter(zone => zone.geometryWarnings?.length).length;
  previewReviewNotice.querySelector('span').textContent = candidates.length
    ? `图上有 ${candidates.length} 个候选区域待核对${uncertain ? `，${uncertain} 个用途未定` : ''}${risky ? `，${risky} 个边界有风险` : ''}。${tentativeLayout?.placedCount ? '半透明家具仅是低风险区域的模拟示意。' : '暂未绘出可靠家具位置。'}`
    : `${pending} 个房间名称或边界待核对。${tentativeLayout?.placedCount ? '图上半透明家具仅供讨论。' : '核对完成后才能绘制可下载的家具初稿。'}`;
}

function draftDimensions(zone) {
  const values = [zone.widthInput, zone.depthInput];
  if (values.some(value => String(value ?? '').trim() === '')) return null;
  const [width, depth] = values.map(Number);
  return [width, depth].every(value => Number.isInteger(value) && value >= 100 && value <= 100000)
    ? { width, depth } : null;
}

function renderAiZoneAssist() {
  const site = currentSite(), source = site?.source;
  rebuildTentativePreview();
  renderTentativePreviewStatus();
  renderPreviewReviewNotice();
  $('#aiZoneAssist').hidden = source?.kind !== 'image' || isDemoSite(site);
  $('#aiZoneAssist .muted').textContent = 'AI 先提出候选框，再逐个查看局部图判断用途；图上文字只是可选依据。蓝色半透明家具只在较低风险区域试绘，并非已确认落位。本地墙线分割可能把客餐厨合并或把挑空当房间；风险框需对照原图核对。';
  $('#suggestHomeZones').disabled = !overviewReady(site);
  const host = $('#aiZoneSuggestions');
  const expanded = new Set([...host.querySelectorAll('[data-ai-zone-row]:has(.ai-zone-advanced[open])')]
    .map(row => Number(row.dataset.aiZoneRow)));
  const suggestions = aiZoneDraft?.suggestions || [];
  host.innerHTML = suggestions.map((zone, index) => `<div class="ai-zone-row" data-ai-zone-row="${index}">
    <div class="ai-zone-head"><label><input type="checkbox" data-ai-zone-selected="${index}"${zone.selected ? ' checked' : ''}>
      <strong>建议 ${index + 1}</strong></label><select data-ai-zone-kind="${index}" aria-label="建议 ${index + 1} 的区域类型">
      ${Object.entries(zoneNames).map(([kind, name]) => `<option value="${kind}"${zone.kind === kind ? ' selected' : ''}>${name}</option>`).join('')}
      </select></div><small>${zone.labelText ? `图上文字：${escapeHtml(zone.labelText)}（待核对）。` : ''}${zone.support ? `局部图依据：${escapeHtml(zone.support)}。` : ''}${zone.kind === 'unknown' ? '用途不确定，人工定类前不能应用。' : ''}${zone.boundsEdited ? '边界已调整，仍须对照原图。' : '蓝色虚线框为 AI 建议边界。'}在图上拖动框内可移动，拖四角可缩放。</small>
    ${zone.geometryWarnings?.length ? `<small class="ai-geometry-warning">边界风险：${escapeHtml(zone.geometryWarnings.join('；'))}。辅助线条不能证明完整墙体，请先改框或对照原图确认。</small>
    <label class="ai-geometry-confirm"><input type="checkbox" data-ai-boundary-confirmed="${index}"${zone.boundaryConfirmed ? ' checked' : ''}> 我已对照原图核实该框的完整边界</label>` : ''}
    <details class="ai-zone-advanced"${expanded.has(index) ? ' open' : ''}><summary>高级调整：边界与图示尺寸</summary>
    <button class="secondary ai-snap-button" type="button" data-ai-wall-snap="${index}">尝试按图纸线条修框</button>
    <button class="secondary ai-snap-button" type="button" data-ai-region-preview="${index}">预览墙线分割（实验）</button>
    ${aiZoneDraft?.segmentationPreview?.index === index ? `<button class="secondary ai-snap-button" type="button" data-ai-region-apply="${index}">套用轮廓外接框（仍待核对）</button>
      <small>蓝色遮罩是本地图像算出的连通区域，不代表它一定是${escapeHtml(zoneNames[zone.kind] || '房间')}；套用后只改变外接框，须检查门洞、墙体和挑空。</small>` : ''}
    <div class="ai-size-fields"><label>一边（毫米）<input type="number" min="100" max="100000" step="1" data-ai-size-field="width" value="${escapeHtml(zone.widthInput)}"></label>
      <label>另一边（毫米）<input type="number" min="100" max="100000" step="1" data-ai-size-field="depth" value="${escapeHtml(zone.depthInput)}"></label>
      <label><input type="checkbox" data-ai-zone-dimension="${index}"${zone.confirmSize ? ' checked' : ''}> 确认并应用这两边尺寸</label></div>
    <small>${zone.evidence ? `AI 读到：${escapeHtml(zone.evidence)}。若改动数字，将记为人工确认。` : 'AI 未读到完整尺寸；仅在另有可靠依据时手动填写。'}</small>
    <details class="ai-box-fields"><summary>精确调整边界（图像像素）</summary><div class="ai-size-fields">
      ${[['x', '左'], ['y', '上'], ['w', '宽'], ['h', '高']].map(([field, label]) =>
        `<label>${label}<input type="number" min="0" step="1" data-ai-box-field="${field}" value="${zone[field]}"></label>`).join('')}
    </div></details></details>
  </div>`).join('');
  $('#aiZoneActions').hidden = !suggestions.length;
  $('#applyZoneSuggestions').textContent = site?.zones?.length ? '追加勾选的区域' : '应用勾选的区域';
  renderSummary(); renderConcept();
}

function renderPlanOverview() {
  const site = currentSite(), overview = site?.planOverview;
  $('#planOverview').hidden = site?.source?.kind !== 'image' || isDemoSite(site);
  $('#overviewResult').hidden = !overview;
  $('#generateFurnishedDraft').disabled = !overviewReady(site);
  $('#quickGenerate h3').textContent = overviewReady(site) ? '下一步：分步识别空间' : '先确认整套户型';
  $('#generateFurnishedDraft').textContent = overviewReady(site) ? '③ 分步识别空间' : '③ 分步识别空间（先确认户型）';
  $('#quickGenerate p').textContent = overviewReady(site)
    ? '整套户型已由你确认。下一步先提取墙线结构候选、再用 AI 查看局部图判断用途，整图定位仅用于补漏；较低风险区域可先显示模拟家具候选示意，不确定区域保持空白，房间与尺寸核对前不可下载为交付图。'
    : '请先完成上方“识别户型”并核对几室几厅几层；确认前不会请求房间框或绘制家具。';
  if (!overview) { $('#useSuggestedType').hidden = true; return; }
  for (const [field, key] of [ ['#overviewFloors', 'floorCount'], ['#overviewBedrooms', 'bedroomCount'],
    ['#overviewLiving', 'livingCount'], ['#overviewBathrooms', 'bathroomCount'] ])
    $(field).value = overview[key] ?? '';
  $('#overviewMezzanine').value = overview.hasMezzanine === null ? '' : overview.hasMezzanine ? 'yes' : 'no';
  const evidence = [overview.floorEvidence?.length ? `楼层依据：${overview.floorEvidence.join('、')}` : '楼层依据未读清',
    overview.roomEvidence?.length ? `房间文字或可见特征：${overview.roomEvidence.join('、')}` : '房间用途依据不足',
    overview.uncertainties?.length ? `待核对：${overview.uncertainties.join('；')}` : ''].filter(Boolean);
  $('#overviewEvidence').textContent = `${evidence.join('。')}。这些是 AI 提议的图像依据，尚未经人工核验。`;
  const suggested = suggestedApartmentType(overview);
  const mismatch = !suggested || suggested !== current().apartmentType;
  $('#overviewMismatch').textContent = mismatch
    ? `当前选择“${kinds[current().apartmentType]}”与${suggested ? `识别建议“${kinds[suggested]}”` : '这组房间数量（不属于现有四种套餐）'}不一致；仍可继续核对房间，但不会按错误套餐填家具。`
    : `与当前“${kinds[current().apartmentType]}”套餐类型一致；房间边界和尺寸仍待后续核对。`;
  $('#overviewOverride').checked = overview.mismatchAcknowledged === true;
  $('#overviewOverride').disabled = !mismatch;
  $('#useSuggestedType').hidden = !suggested || !mismatch;
  $('#useSuggestedType').textContent = suggested ? `改选为“${kinds[suggested]}”套餐` : '';
  $('#confirmPlanOverview').textContent = overview.reviewed ? '户型已确认 · 重新确认' : '② 确认户型，再识别房间';
}

function aiEligibleZones(site = currentSite()) {
  return site?.source?.kind === 'image' && !isDemoSite(site) ? (site.zones || []).filter(zone =>
    ['living', 'dining', 'bedroom', 'mezzanine'].includes(zone.kind) &&
    (!zone.dimensionsMm || ['scale_estimate', 'ai_draft_printed'].includes(zone.dimensionSource) ||
      /比例估算/.test(zone.dimensionsLabel || ''))) : [];
}

function renderAiDimensionResults() {
  const host = $('#aiDimensionResults');
  if (!aiDimensionDraft) { host.innerHTML = ''; return; }
  host.innerHTML = aiDimensionDraft.rows.map(row => {
    const candidate = row.candidate, size = candidate?.dimensionsMm;
    return `<div class="ai-dimension-result" data-ai-zone="${escapeHtml(row.zoneId)}">
      <img src="${row.crop}" alt="${escapeHtml(row.name)}图纸局部">
      <div><strong>${escapeHtml(row.name)}</strong><p>${candidate?.evidence ? `AI 读到：${escapeHtml(candidate.evidence)}` : '图中未读到完整长宽；如有可靠尺寸，可手动填写。'}</p>
      <div class="ai-values"><div class="field"><label>长 / 宽（毫米）<input data-ai-field="width" type="number" min="100" max="100000" step="1" value="${size?.width || ''}"></label></div>
      <div class="field"><label>另一边（毫米）<input data-ai-field="depth" type="number" min="100" max="100000" step="1" value="${size?.depth || ''}"></label></div>
      <button class="secondary" data-confirm-ai-zone="${escapeHtml(row.zoneId)}" type="button">确认并应用</button></div>
      <p>请对照左侧局部图核实；点击确认后才进入家具预览，不代表现场净尺寸。</p></div></div>`;
  }).join('');
}

function renderAiDimensions() {
  const site = currentSite(), eligible = aiEligibleZones(site);
  $('#aiDimensions').hidden = !eligible.length;
  if (aiDimensionDraft && (aiDimensionDraft.source !== site?.source?.dataUrl ||
      aiDimensionDraft.apartmentType !== current().apartmentType)) aiDimensionDraft = null;
  if (aiDimensionDraft) {
    const ids = new Set(eligible.map(zone => zone.id));
    aiDimensionDraft.rows = aiDimensionDraft.rows.filter(row => ids.has(row.zoneId));
  }
  renderAiDimensionResults();
}

async function cropRoomImages(site, zones) {
  const image = await new Promise((resolve, reject) => {
    const value = new Image(); value.onload = () => resolve(value); value.onerror = reject; value.src = site.source.dataUrl;
  });
  return zones.map((zone, index) => {
    const margin = 12;
    const sx = Math.max(0, zone.x - margin), sy = Math.max(0, zone.y - margin);
    const sw = Math.min(image.width - sx, zone.w + 2 * margin), sh = Math.min(image.height - sy, zone.h + 2 * margin);
    const scale = Math.min(1, 1024 / Math.max(sw, sh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sw * scale)); canvas.height = Math.max(1, Math.round(sh * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return { requestId: `zone-${index + 1}`, zoneId: zone.id, name: zoneDisplayName(zone, site),
      kind: zone.kind, crop: canvas.toDataURL('image/jpeg', .85) };
  });
}

function drawFurniture(context, item, x, y, w, h, enlarged = false) {
  if (w < 2 || h < 2) return;
  context.save();
  const pad = Math.max(2, Math.min(w, h) * .1);
  context.fillStyle = enlarged ? '#dbeafe' : '#bfdbfe';
  context.strokeStyle = '#1d4ed8'; context.lineWidth = enlarged ? 2.5 : 2;
  context.fillRect(x, y, w, h); context.strokeRect(x, y, w, h);
  if (w > 24 && h > 19) {
    context.strokeStyle = '#2563eb'; context.lineWidth = enlarged ? 2 : 1.5;
    if (item.key === 'sofa_3') {
      const seatW = (w - 2 * pad) / 3;
      for (let i = 0; i < 3; i++) context.strokeRect(x + pad + i * seatW, y + pad, seatW, h - 2 * pad);
      context.fillStyle = '#93c5fd'; context.fillRect(x, y, w, Math.max(3, pad * .75));
    } else if (item.key === 'queen_bed_frame') {
      context.fillStyle = '#93c5fd';
      context.fillRect(x + pad, y + pad, (w - 3 * pad) / 2, Math.max(5, h * .22));
      context.fillRect(x + 2 * pad + (w - 3 * pad) / 2, y + pad, (w - 3 * pad) / 2, Math.max(5, h * .22));
      context.beginPath(); context.moveTo(x + pad, y + h * .44); context.lineTo(x + w - pad, y + h * .44); context.stroke();
    } else if (item.key === 'tv_console') {
      context.fillStyle = '#1e3a8a'; context.fillRect(x + pad, y + pad, w - 2 * pad, Math.max(3, h * .25));
      context.strokeRect(x + pad, y + h * .58, w - 2 * pad, Math.max(2, h * .2));
    } else if (item.key.startsWith('dresser') || item.key === 'nightstand') {
      const drawers = item.key.startsWith('dresser') ? 4 : 2;
      for (let i = 1; i < drawers; i++) {
        const yy = y + pad + i * (h - 2 * pad) / drawers;
        context.beginPath(); context.moveTo(x + pad, yy); context.lineTo(x + w - pad, yy); context.stroke();
      }
    } else if (item.key.includes('chair')) {
      context.strokeRect(x + pad, y + pad * 1.2, w - 2 * pad, h - 2.2 * pad);
      context.fillStyle = '#93c5fd'; context.fillRect(x + pad, y, w - 2 * pad, Math.max(3, pad * .8));
    } else {
      context.strokeRect(x + pad, y + pad, w - 2 * pad, h - 2 * pad);
    }
  }
  const tagSize = enlarged ? 15 : 12;
  context.font = `bold ${tagSize}px system-ui`;
  const tagW = Math.min(w, Math.max(23, context.measureText(item.marker).width + 8));
  const tagH = Math.min(h, tagSize + 5);
  context.fillStyle = '#1e3a8a'; context.fillRect(x, y, tagW, tagH);
  context.fillStyle = '#fff'; context.fillText(item.marker, x + 3, y + Math.min(tagH - 3, tagSize + 1), Math.max(4, tagW - 5));
  context.restore();
}

function renderRoomPreview() {
  const site = currentSite(), placements = conceptLayout?.placements || [];
  const zones = (site?.zones || []).filter(zone => placements.some(item => item.zoneId === zone.id) && zoneDrawingSize(zone));
  const wrap = $('#roomPreviewWrap');
  wrap.hidden = !zones.length || site?.source?.kind !== 'image';
  if (wrap.hidden) return;
  const select = $('#roomSelect'), previous = select.value;
  select.innerHTML = zones.map(zone => `<option value="${escapeHtml(zone.id)}">${zoneDisplayName(zone, site)}</option>`).join('');
  select.value = zones.some(zone => zone.id === previous) ? previous : zones[0].id;
  drawRoomPreview();
}

function drawRoomPreview() {
  const site = currentSite(), zone = site?.zones?.find(item => item.id === $('#roomSelect').value);
  if (!zoneDrawingSize(zone) || !conceptLayout?.placements.length || site.source?.kind !== 'image') return;
  const size = zoneDrawingSize(zone);
  const canvas = $('#roomPreview'), context = canvas.getContext('2d');
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
  const margin = 15;
  const sx = Math.max(0, zone.x - margin), sy = Math.max(0, zone.y - margin);
  const sw = Math.min(site.source.widthPx - sx, zone.w + 2 * margin);
  const sh = Math.min(site.source.heightPx - sy, zone.h + 2 * margin);
  const factor = Math.min((canvas.width - 24) / sw, (canvas.height - 24) / sh);
  const dx = (canvas.width - sw * factor) / 2, dy = (canvas.height - sh * factor) / 2;
  if (planImage) context.drawImage(planImage, sx, sy, sw, sh, dx, dy, sw * factor, sh * factor);
  context.strokeStyle = '#047857'; context.lineWidth = 3;
  context.strokeRect(dx + (zone.x - sx) * factor, dy + (zone.y - sy) * factor, zone.w * factor, zone.h * factor);
  for (const item of conceptLayout.placements.filter(value => value.zoneId === zone.id)) {
    const x = dx + (zone.x - sx + zone.w * item.xMm / size.width) * factor;
    const y = dy + (zone.y - sy + zone.h * item.yMm / size.depth) * factor;
    const w = zone.w * item.widthMm / size.width * factor;
    const h = zone.h * item.depthMm / size.depth * factor;
    drawFurniture(context, item, x, y, w, h, true);
  }
}

function pointOnPlan(event) {
  const bounds = planCanvas.getBoundingClientRect();
  return { x: Math.max(0, Math.min(planCanvas.width, (event.clientX - bounds.left) * planCanvas.width / bounds.width)),
    y: Math.max(0, Math.min(planCanvas.height, (event.clientY - bounds.top) * planCanvas.height / bounds.height)) };
}

function draftHit(point) {
  if (drawMode || aiZoneDraft?.source !== currentSite()?.source?.dataUrl ||
      aiZoneDraft?.apartmentType !== current().apartmentType) return null;
  const bounds = planCanvas.getBoundingClientRect();
  const radius = Math.max(8, 14 * planCanvas.width / bounds.width);
  for (let index = aiZoneDraft.suggestions.length - 1; index >= 0; index--) {
    const zone = aiZoneDraft.suggestions[index];
    if (!zone.selected) continue;
    const corners = [
      ['nw', zone.x, zone.y], ['ne', zone.x + zone.w, zone.y],
      ['sw', zone.x, zone.y + zone.h], ['se', zone.x + zone.w, zone.y + zone.h],
    ];
    for (const [corner, x, y] of corners) {
      if (Math.abs(point.x - x) <= radius && Math.abs(point.y - y) <= radius)
        return { index, mode: 'resize', corner };
    }
    if (point.x >= zone.x && point.x <= zone.x + zone.w &&
        point.y >= zone.y && point.y <= zone.y + zone.h) return { index, mode: 'move' };
  }
  return null;
}

function appliedZoneHit(point) {
  if (drawMode || furnitureEditMode) return null;
  const bounds = planCanvas.getBoundingClientRect();
  const radius = Math.max(8, 14 * planCanvas.width / bounds.width);
  const zones = currentSite()?.zones || [];
  for (let index = zones.length - 1; index >= 0; index--) {
    const zone = zones[index];
    if (!['draft', 'reviewed'].includes(zone.reviewStatus)) continue;
    for (const [corner, x, y] of [
      ['nw', zone.x, zone.y], ['ne', zone.x + zone.w, zone.y],
      ['sw', zone.x, zone.y + zone.h], ['se', zone.x + zone.w, zone.y + zone.h],
    ]) if (Math.abs(point.x - x) <= radius && Math.abs(point.y - y) <= radius)
      return { index, mode: 'resize', corner };
    if (point.x >= zone.x && point.x <= zone.x + zone.w &&
        point.y >= zone.y && point.y <= zone.y + zone.h) return { index, mode: 'move' };
  }
  return null;
}

function updateAppliedZoneDrag(point) {
  const drag = appliedZoneDrag, zone = currentSite()?.zones?.[drag?.index];
  if (!drag || !zone) return;
  const dx = Math.round(point.x - drag.start.x), dy = Math.round(point.y - drag.start.y);
  const original = drag.original;
  if (drag.mode === 'move') {
    zone.x = Math.max(0, Math.min(planCanvas.width - original.w, original.x + dx));
    zone.y = Math.max(0, Math.min(planCanvas.height - original.h, original.y + dy));
    zone.w = original.w; zone.h = original.h;
    return;
  }
  let left = original.x, top = original.y;
  let right = original.x + original.w, bottom = original.y + original.h;
  if (drag.corner.includes('w')) left = Math.max(0, Math.min(right - 8, left + dx));
  if (drag.corner.includes('e')) right = Math.min(planCanvas.width, Math.max(left + 8, right + dx));
  if (drag.corner.includes('n')) top = Math.max(0, Math.min(bottom - 8, top + dy));
  if (drag.corner.includes('s')) bottom = Math.min(planCanvas.height, Math.max(top + 8, bottom + dy));
  Object.assign(zone, { x: left, y: top, w: right - left, h: bottom - top });
}

function updateAiZoneDrag(point) {
  const drag = aiZoneDrag, zone = aiZoneDraft?.suggestions[drag?.index];
  if (!drag || !zone) return;
  const dx = Math.round(point.x - drag.start.x), dy = Math.round(point.y - drag.start.y);
  const original = drag.original;
  if (drag.mode === 'move') {
    zone.x = Math.max(0, Math.min(planCanvas.width - original.w, original.x + dx));
    zone.y = Math.max(0, Math.min(planCanvas.height - original.h, original.y + dy));
    zone.w = original.w; zone.h = original.h;
    return;
  }
  let left = original.x, top = original.y;
  let right = original.x + original.w, bottom = original.y + original.h;
  if (drag.corner.includes('w')) left = Math.max(0, Math.min(right - 8, left + dx));
  if (drag.corner.includes('e')) right = Math.min(planCanvas.width, Math.max(left + 8, right + dx));
  if (drag.corner.includes('n')) top = Math.max(0, Math.min(bottom - 8, top + dy));
  if (drag.corner.includes('s')) bottom = Math.min(planCanvas.height, Math.max(top + 8, bottom + dy));
  Object.assign(zone, { x: left, y: top, w: right - left, h: bottom - top });
}

function applyCalibratedZoneDimensions(site) {
  const mmPerPx = site?.calibration?.mmPerPx;
  if (!Number.isFinite(mmPerPx) || mmPerPx <= 0) return;
  for (const zone of site.zones || []) {
    if (zone.dimensionsMm && !zone.dimensionSource && /比例估算/.test(zone.dimensionsLabel || '')) zone.dimensionSource = 'scale_estimate';
    if (zone.dimensionsMm || !['living', 'dining', 'bedroom', 'mezzanine'].includes(zone.kind)) continue;
    const width = Math.round(zone.w * mmPerPx), depth = Math.round(zone.h * mmPerPx);
    if (width < 100 || depth < 100 || width > 100000 || depth > 100000) continue;
    zone.dimensionsMm = { width, depth };
    zone.dimensionsLabel = `约 ${(width / 1000).toFixed(2)}m × ${(depth / 1000).toFixed(2)}m（比例估算）`;
    zone.dimensionSource = 'scale_estimate';
  }
}

function loadPlanImage(source) {
  if (planImageUrl === source.dataUrl) return;
  planImageUrl = source.dataUrl; planImage = null;
  const image = new Image();
  image.onload = () => { if (planImageUrl === source.dataUrl) { planImage = image; drawPlan(); drawRoomPreview(); } };
  image.src = source.dataUrl;
}

function furnitureRect(item) {
  const zone = currentSite()?.zones?.find(value => value.id === item.zoneId);
  const size = zoneDrawingSize(zone);
  if (!zone || !size) return null;
  return { x: zone.x + zone.w * item.xMm / size.width,
    y: zone.y + zone.h * item.yMm / size.depth,
    w: zone.w * item.widthMm / size.width, h: zone.h * item.depthMm / size.depth };
}

function furnitureHit(point) {
  return [...(conceptLayout?.placements || [])].reverse().find(item => {
    const rect = furnitureRect(item);
    return rect && point.x >= rect.x && point.x <= rect.x + rect.w &&
      point.y >= rect.y && point.y <= rect.y + rect.h;
  }) || null;
}

function furnitureOverlaps(item) {
  return (conceptLayout?.placements || []).some(other => other !== item && other.zoneId === item.zoneId &&
    item.xMm < other.xMm + other.widthMm && item.xMm + item.widthMm > other.xMm &&
    item.yMm < other.yMm + other.depthMm && item.yMm + item.depthMm > other.yMm);
}

function drawPlan() {
  const site = currentSite(), source = site?.source;
  if (!source || source.kind !== 'image' || !planCanvas.width) return;
  planContext.clearRect(0, 0, planCanvas.width, planCanvas.height);
  if (planImage) planContext.drawImage(planImage, 0, 0, planCanvas.width, planCanvas.height);
  const scale = Math.max(1, planCanvas.width / 700);
  for (const [index, zone] of (site.zones || []).entries()) {
    planContext.fillStyle = fixedZones.has(zone.kind) ? '#f59e0b33' : zone.kind === 'bedroom' ? '#a78bfa44' : '#34d39944';
    planContext.strokeStyle = fixedZones.has(zone.kind) ? '#b45309' : zone.kind === 'bedroom' ? '#7c3aed' : '#047857';
    planContext.lineWidth = 3 * scale;
    planContext.fillRect(zone.x, zone.y, zone.w, zone.h);
    if (zone.reviewStatus === 'draft') planContext.setLineDash([7 * scale, 5 * scale]);
    planContext.strokeRect(zone.x, zone.y, zone.w, zone.h);
    planContext.setLineDash([]);
    planContext.fillStyle = '#17202a'; planContext.font = `bold ${15 * scale}px system-ui`;
    const dimension = zone.dimensionsLabel ? ` · ${zone.dimensionsLabel}` : '';
    const area = !dimension && site.calibration?.mmPerPx ? ` · 框选约${(zone.w * zone.h * site.calibration.mmPerPx ** 2 / 1e6).toFixed(1)}㎡` : '';
    planContext.fillText(`${zoneNames[zone.kind] || '区域'} ${index + 1}${zone.reviewStatus === 'draft' ? ' · 待核对' : ''}${dimension}${area}`,
      zone.x + 6 * scale, zone.y + 20 * scale, Math.max(30, zone.w - 10 * scale));
  }
  if (aiZoneDraft?.source === source.dataUrl && aiZoneDraft.apartmentType === current().apartmentType) {
    planContext.save();
    const preview = aiZoneDraft.segmentationPreview;
    if (preview) {
      planContext.fillStyle = '#0ea5e944';
      for (const [y, from, to] of preview.region.spans) planContext.fillRect(from, y, to - from, 1);
      planContext.strokeStyle = '#0284c7';
      planContext.lineWidth = 3 * scale;
      planContext.setLineDash([5 * scale, 4 * scale]);
      planContext.strokeRect(preview.region.x, preview.region.y, preview.region.w, preview.region.h);
      planContext.setLineDash([]);
    }
    for (const [index, zone] of aiZoneDraft.suggestions.entries()) {
      planContext.globalAlpha = zone.selected ? 1 : .3;
      planContext.setLineDash([8 * scale, 5 * scale]);
      planContext.strokeStyle = zone.geometryWarnings?.length ? '#b45309' : '#1d4ed8';
      planContext.lineWidth = 3 * scale;
      planContext.strokeRect(zone.x, zone.y, zone.w, zone.h);
      planContext.setLineDash([]);
      planContext.fillStyle = zone.geometryWarnings?.length ? '#92400e' : '#1e40af';
      planContext.font = `bold ${14 * scale}px system-ui`;
      planContext.fillText(`建议 ${index + 1}：${zoneNames[zone.kind] || '区域'}${zone.geometryWarnings?.length ? ' · 边界风险' : ''}`,
        zone.x + 5 * scale, zone.y + 18 * scale);
      if (zone.selected) for (const [x, y] of [
        [zone.x, zone.y], [zone.x + zone.w, zone.y],
        [zone.x, zone.y + zone.h], [zone.x + zone.w, zone.y + zone.h],
      ]) planContext.fillRect(x - 5 * scale, y - 5 * scale, 10 * scale, 10 * scale);
    }
    planContext.restore();
  }
  for (const item of conceptLayout?.placements || []) {
    const rect = furnitureRect(item);
    if (!rect) continue;
    drawFurniture(planContext, item, rect.x, rect.y, rect.w, rect.h);
    if (furnitureOverlaps(item)) {
      planContext.strokeStyle = '#dc2626'; planContext.lineWidth = 4 * scale;
      planContext.strokeRect(rect.x, rect.y, rect.w, rect.h);
    }
  }
  if (!conceptLayout && tentativeLayout?.placedCount) {
    const zones = new Map(tentativeZones.map(zone => [zone.id, zone]));
    planContext.save(); planContext.globalAlpha = .58;
    for (const item of tentativeLayout.placements) {
      const zone = zones.get(item.zoneId), size = zoneDrawingSize(zone);
      if (!zone || !size) continue;
      drawFurniture(planContext, item, zone.x + zone.w * item.xMm / size.width,
        zone.y + zone.h * item.yMm / size.depth,
        zone.w * item.widthMm / size.width, zone.h * item.depthMm / size.depth);
    }
    planContext.restore();
  }
  if (drawing) {
    planContext.strokeStyle = '#2563eb'; planContext.lineWidth = 2 * scale;
    planContext.setLineDash([8 * scale, 5 * scale]);
    planContext.strokeRect(Math.min(drawing.start.x, drawing.end.x), Math.min(drawing.start.y, drawing.end.y),
      Math.abs(drawing.end.x - drawing.start.x), Math.abs(drawing.end.y - drawing.start.y));
    planContext.setLineDash([]);
  }
  const markers = drawMode === 'calibrate' ? calibrationPoints : site.calibration ? [site.calibration.p1, site.calibration.p2] : [];
  for (const point of markers) {
    planContext.beginPath(); planContext.arc(point.x, point.y, 6 * scale, 0, Math.PI * 2);
    planContext.fillStyle = '#dc2626'; planContext.fill();
  }
  if (markers.length === 2) {
    planContext.beginPath(); planContext.moveTo(markers[0].x, markers[0].y); planContext.lineTo(markers[1].x, markers[1].y);
    planContext.strokeStyle = '#dc2626'; planContext.lineWidth = 2 * scale; planContext.stroke();
  }
}

function renderPlan() {
  const site = currentSite(), source = site?.source, image = source?.kind === 'image';
  renderPlanOverview();
  if (aiZoneDraft && (aiZoneDraft.source !== source?.dataUrl || aiZoneDraft.apartmentType !== current().apartmentType)) aiZoneDraft = null;
  if (!aiZoneDraft) aiZoneDrag = null;
  planCanvas.style.cursor = drawMode ? 'crosshair' : furnitureEditMode ? 'grab' : '';
  $('#planView').hidden = !source;
  $('#planCanvas').hidden = !image;
  $('#pdfPreview').hidden = source?.kind !== 'pdf';
  $('#imageTools').hidden = !image;
  $('#quickGenerate').hidden = !image || isDemoSite(site);
  furnitureEdit.hidden = !image || !conceptLayout?.placedCount;
  $('#adjustFurniture').setAttribute('aria-pressed', String(furnitureEditMode));
  $('#adjustFurniture').textContent = furnitureEditMode ? '完成位置调整' : '调整家具位置';
  $('#resetFurniturePositions').disabled = !Object.keys(current().placementOverrides || {}).length;
  $('#planNote').value = site?.note || '';
  $('#planHint').textContent = !source ? '尚未上传户型图。' : isDemoSite(site)
    ? '当前为系统演示户型与示意尺寸，不是你的房屋。可在上方选择文件，换成自己的户型图。' : source.kind === 'pdf'
    ? `${source.fileName} · PDF 原图已保存在当前户型项目中；如需框房间，请上传 JPG/PNG/WebP。`
    : `${source.fileName} · ${site.zones?.some(zone => zone.dimensionsMm) ? '已有房间尺寸，仍需核对来源与净尺寸；' : ''}彩色矩形仅是示意边界，不代表实测面积。AI 房间框可拖动框内移动、拖四角调整；调整后需重新核对。`;
  const status = $('#planStatus');
  status.innerHTML = `<strong>${escapeHtml(siteState())}</strong>`;
  status.classList.toggle('ready', !!(site?.calibration?.mmPerPx && site.zones?.length));
  if (image) {
    planCanvas.width = source.widthPx; planCanvas.height = source.heightPx;
    $('#planView').style.aspectRatio = `${source.widthPx} / ${source.heightPx}`;
    loadPlanImage(source); drawPlan();
  } else {
    planImage = null; planImageUrl = null;
    $('#planView').style.aspectRatio = '4 / 3';
    $('#pdfPreview').data = source?.kind === 'pdf' ? source.dataUrl : '';
  }
  $('#zoneTools').querySelectorAll('[data-zone]').forEach(button => button.classList.toggle('active', button.dataset.zone === drawMode));
  $('#calibratePlan').textContent = drawMode === 'calibrate' ? `请在图上点两点（${calibrationPoints.length}/2）` : '点两点校准比例';
  $('#zoneList').innerHTML = (site?.zones || []).map((zone, index) => `<div class="zone-entry"><button class="delete" type="button" data-delete-zone="${escapeHtml(zone.id)}">${zoneNames[zone.kind] || '区域'} ${index + 1}${zone.labelText ? ` · AI 读到 ${escapeHtml(zone.labelText)}` : ''}${zone.dimensionsLabel ? ` · ${escapeHtml(zone.dimensionsLabel)}` : ''} ×</button>${['draft', 'reviewed'].includes(zone.reviewStatus) ? `<button class="secondary ai-snap-button" type="button" data-zone-wall-snap="${escapeHtml(zone.id)}">按线条修框</button><label>类型 <select data-zone-kind="${escapeHtml(zone.id)}" aria-label="区域 ${index + 1} 类型">${Object.entries(zoneNames).map(([kind, name]) => `<option value="${kind}"${zone.kind === kind ? ' selected' : ''}>${name}</option>`).join('')}</select></label><label><input type="checkbox" data-review-zone="${escapeHtml(zone.id)}"${zone.reviewStatus === 'reviewed' ? ' checked' : ''}${zone.kind === 'unknown' ? ' disabled' : ''}> ${zone.kind === 'unknown' ? '先选择用途，再核对边界' : '名称与边界已按原图核对'}</label>` : ''}</div>`).join('');
  renderConceptAssignments();
  renderAiZoneAssist();
  renderAiDimensions();
}

function render() {
  applyCalibratedZoneDimensions(currentSite());
  if (fillMissingHomeVisualSizes(currentSite())) persist();
  conceptLayout = current().conceptPreviewEnabled === true && !hasUnreviewedAiZones() && packageMatchesReviewedPlan() &&
    !(currentSite()?.planOverview && !overviewReady())
    ? buildHomeConceptLayout(assessHomePackage(current()).lines, currentSite(), current().zoneAssignments,
      current().placementOverrides) : null;
  rebuildTentativePreview();
  renderSelectors(); renderDemoPlanGallery(); renderPlan(); renderLines(); renderSummary(); renderConcept();
}

function download(name, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function fileData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function preparePlanFile(file) {
  const mime = file.type || ({ pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' })[file.name.split('.').at(-1)?.toLowerCase()];
  if (mime === 'application/pdf') {
    if (file.size > 1_500_000) throw new Error('PDF 超过 1.5 MB，请压缩后上传。');
    return { kind: 'pdf', fileName: file.name, dataUrl: await fileData(file) };
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) throw new Error('请使用 JPG、PNG、WebP 或 PDF 户型图。');
  const original = await fileData(file);
  const image = await new Promise((resolve, reject) => {
    const value = new Image(); value.onload = () => resolve(value); value.onerror = reject; value.src = original;
  });
  const ratio = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', .78);
  if (dataUrl.length > 2_000_000) throw new Error('图片压缩后仍过大，请先缩小图片。');
  return { kind: 'image', fileName: file.name, dataUrl, widthPx: canvas.width, heightPx: canvas.height };
}

function validImportedSite(site) {
  if (!site || typeof site !== 'object' || !site.source) return null;
  const source = site.source;
  const kind = source.kind;
  const prefix = kind === 'pdf' ? /^data:application\/pdf;base64,/ : /^data:image\/(jpeg|png|webp);base64,/;
  if (!['pdf', 'image'].includes(kind) || typeof source.dataUrl !== 'string' ||
      source.dataUrl.length > 3_000_000 || !prefix.test(source.dataUrl)) throw new TypeError('Invalid floor plan');
  if (kind === 'image' && (!Number.isInteger(source.widthPx) || !Number.isInteger(source.heightPx) ||
      source.widthPx < 1 || source.heightPx < 1 || source.widthPx > 1600 || source.heightPx > 1600)) throw new TypeError('Invalid plan dimensions');
  const clean = { source: { kind, fileName: String(source.fileName || '户型图').slice(0, 180), dataUrl: source.dataUrl,
    ...(kind === 'image' ? { widthPx: source.widthPx, heightPx: source.heightPx } : {}) },
    note: String(site.note || '').slice(0, 500), zones: [] };
  if (kind === 'image') clean.planOverview = cleanPlanOverview(site.planOverview);
  const calibration = site.calibration;
  const pointValid = point => point && Number.isFinite(point.x) && Number.isFinite(point.y) &&
    point.x >= 0 && point.y >= 0 && point.x <= source.widthPx && point.y <= source.heightPx;
  if (kind === 'image' && calibration && pointValid(calibration.p1) && pointValid(calibration.p2) &&
      Number.isFinite(calibration.distanceMm) && calibration.distanceMm >= 100 &&
      Number.isFinite(calibration.mmPerPx) && calibration.mmPerPx > 0 && calibration.mmPerPx < 100) {
    clean.calibration = { p1: calibration.p1, p2: calibration.p2,
      distanceMm: calibration.distanceMm, mmPerPx: calibration.mmPerPx };
  }
  if (kind === 'image' && Array.isArray(site.zones)) clean.zones = site.zones.slice(0, 30).filter(zone =>
    Object.hasOwn(zoneNames, zone.kind) && [zone.x, zone.y, zone.w, zone.h].every(Number.isFinite) &&
    zone.x >= 0 && zone.y >= 0 && zone.w > 0 && zone.h > 0 &&
    zone.x + zone.w <= source.widthPx && zone.y + zone.h <= source.heightPx)
    .map((zone, index) => ({ id: String(zone.id || `room-${index}`).slice(0, 50), kind: zone.kind,
      x: zone.x, y: zone.y, w: zone.w, h: zone.h,
      ...(zone.dimensionsMm && Number.isFinite(zone.dimensionsMm.width) && Number.isFinite(zone.dimensionsMm.depth) &&
        zone.dimensionsMm.width >= 100 && zone.dimensionsMm.width <= 100000 &&
        zone.dimensionsMm.depth >= 100 && zone.dimensionsMm.depth <= 100000
        ? { dimensionsMm: { width: zone.dimensionsMm.width, depth: zone.dimensionsMm.depth } } : {}),
      ...(typeof zone.dimensionsLabel === 'string' ? { dimensionsLabel: zone.dimensionsLabel.slice(0, 60) } : {}),
      ...(typeof zone.labelText === 'string' ? { labelText: zone.labelText.slice(0, 60) } : {}),
      ...(['scale_estimate', 'ai_confirmed_printed', 'ai_draft_printed', 'manual'].includes(zone.dimensionSource)
        ? { dimensionSource: zone.dimensionSource } : {}),
      ...(['draft', 'reviewed'].includes(zone.reviewStatus) ? { reviewStatus: zone.reviewStatus } : {}),
      ...(zone.previewSafe === true ? { previewSafe: true } : {}),
      ...(['draft', 'reviewed'].includes(zone.reviewStatus) && zone.visualSizeMm &&
        Number.isFinite(zone.visualSizeMm.width) && Number.isFinite(zone.visualSizeMm.depth) &&
        zone.visualSizeMm.width >= 100 && zone.visualSizeMm.width <= 100000 &&
        zone.visualSizeMm.depth >= 100 && zone.visualSizeMm.depth <= 100000
        ? { visualSizeMm: { width: zone.visualSizeMm.width, depth: zone.visualSizeMm.depth } } : {}),
      ...(typeof zone.dimensionEvidence === 'string' ? { dimensionEvidence: zone.dimensionEvidence.slice(0, 120) } : {}) }));
  return clean;
}

$('#planFile').addEventListener('change', async event => {
  const file = event.target.files?.[0]; if (!file) return;
  const type = current().apartmentType, previous = sites[type];
  if (previous?.source && !isDemoSite(previous) && !confirm('上传新图片会替换当前户型图和房间标注。请先导出项目备份，确定继续吗？')) {
    event.target.value = ''; return;
  }
  try {
    const source = await preparePlanFile(file);
    sites[type] = { source, note: $('#planNote').value.trim(), zones: [] };
    aiZoneDraft = null;
    for (const project of Object.values(projects)) if (project.apartmentType === type) {
      project.zoneAssignments = {}; project.placementOverrides = {}; project.placementReviews = {};
    }
    furnitureEditMode = false;
    invalidateConcept();
    drawMode = null; drawing = null; calibrationPoints = [];
    persist(); renderPlan(); renderSummary();
    $('#message').textContent = source.kind === 'image'
      ? '户型图已录入。点击“识别户型”后才会把压缩图纸发送给 AI；先核对整套户型，再识别房间。'
      : 'PDF 已保存并可预览；如需标注房间，请导出为 JPG、PNG 或 WebP。';
  } catch (error) {
    if (previous) sites[type] = previous; else delete sites[type];
    $('#message').textContent = error?.name === 'QuotaExceededError' ? '浏览器本地空间不足，请先导出项目并缩小图纸。' : error.message;
  }
  event.target.value = '';
});
$('#startRealPlan').addEventListener('click', () => {
  if (!currentSite()?.source) loadMockProducts(true);
  else $('#planFile').click();
});
$('#demoPlanGrid').addEventListener('click', event => {
  const type = event.target.closest('[data-demo-plan]')?.dataset.demoPlan;
  if (!demoPlanPresets.some(preset => preset.type === type)) return;
  if (current().apartmentType === type) return;
  $('#apartmentType').value = type;
  $('#apartmentType').dispatchEvent(new Event('change', { bubbles: true }));
  $('#demoPlanStatus').textContent = `已选择${kinds[type]}虚构户型；确认上方套餐后点击生成。`;
});
$('#generateDemoPlan').addEventListener('click', () => {
  if (currentSite()?.source && !isDemoSite(currentSite())) {
    $('#demoPlanStatus').textContent = '此户型已有上传图纸。请先导出项目备份并移除该图纸，模拟入口不会覆盖它。';
    return;
  }
  if (loadMockProducts(true))
    $('#demoPlanStatus').textContent = `已用${kinds[current().apartmentType]}虚构户型填入模拟家具；没有上传图纸或调用 AI。`;
});
$('#planNote').addEventListener('input', event => {
  const site = currentSite(); if (!site) return;
  site.note = event.target.value.slice(0, 500); persist();
});
$('#overviewMismatch').insertAdjacentHTML('afterend', '<button class="secondary" id="useSuggestedType" type="button" hidden></button>');
$('#overviewOverride').parentElement.lastChild.textContent = ' 我已核对，继续识别房间；套餐不匹配时不会填家具';
$('#apartmentType').closest('.card').before($('#realPlanUpload'));
$('#quickGenerate').before($('#planOverview'));
$('#useSuggestedType').addEventListener('click', () => {
  const site = currentSite(), target = suggestedApartmentType(site?.planOverview);
  if (!site || !target || target === current().apartmentType) return;
  if (sites[target]?.source) {
    $('#overviewStatus').textContent = `“${kinds[target]}”下已有图纸。请先导出并处理该图纸，自动切换不会覆盖它。`;
    return;
  }
  const previousType = current().apartmentType;
  delete sites[previousType]; sites[target] = site;
  if (!availablePackages(target).some(item => item.id === active)) active = availablePackages(target)[0].id;
  current().apartmentType = target;
  current().zoneAssignments = {}; current().placementOverrides = {}; current().placementReviews = {};
  site.planOverview.reviewed = false; site.planOverview.mismatchAcknowledged = false;
  aiZoneDraft = null; furnitureEditMode = false;
  persist(); render();
  $('#overviewStatus').textContent = `已改选为“${kinds[target]}”套餐，图纸已随之保留。请核对套餐并确认户型。`;
});
$('#readPlanOverview').addEventListener('click', async () => {
  const site = currentSite(), status = $('#overviewStatus'), button = $('#readPlanOverview');
  if (site?.source?.kind !== 'image' || isDemoSite(site)) { status.textContent = '请先上传真实的图片户型图。'; return; }
  if (location.protocol === 'file:') { status.textContent = 'AI 需要服务端：请在已部署的验收页使用，或运行 npm run dev:home。'; return; }
  const pin = $('#overviewPin').value.trim();
  if (!pin) { status.textContent = '请填写验收访问码。'; $('#overviewPin').focus(); return; }
  if (site.zones?.length && !confirm('重新识别整套户型后，现有房间标注仍会保留，但家具预览将暂停，直到重新确认户型。继续吗？')) return;
  const source = site.source.dataUrl, apartmentType = current().apartmentType;
  button.disabled = true; status.textContent = '正在先读取整套户型；这一步不画房间和家具…';
  try {
    const response = await fetch('api/read-home-plan', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin, imageDataUrl: source, widthPx: site.source.widthPx, heightPx: site.source.heightPx }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '户型读取失败');
    if (currentSite()?.source?.dataUrl !== source || current().apartmentType !== apartmentType)
      throw new Error('图纸或套餐已变化，请重新识别。');
    const overview = cleanPlanOverview(result.overview);
    if (!overview) throw new Error('AI 未返回可核对的户型信息。');
    site.planOverview = { ...overview, reviewed: false, mismatchAcknowledged: false };
    aiZoneDraft = null;
    $('#quickPlanPin').value = pin;
    $('#planZonePin').value = pin;
    persist(); render();
    status.textContent = [overview.floorCount, overview.bedroomCount, overview.livingCount, overview.bathroomCount]
      .every(value => value === null) && !overview.floorEvidence.length && !overview.roomEvidence.length
      ? 'AI 未读清图纸；请对照原图手动补齐户型概况，无法确认时不要继续自动摆放。'
      : '已读出户型概况。请对照原图核对层数、房间数量和可见依据，再点“确认户型”。';
    $('#overviewResult').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (error) { status.textContent = error.message || '户型读取失败，请重试。'; }
  finally { button.disabled = false; $('#overviewPin').value = ''; }
});
$('#overviewResult').addEventListener('change', event => {
  const site = currentSite(), overview = site?.planOverview;
  if (!overview) return;
  const key = { overviewFloors: 'floorCount', overviewBedrooms: 'bedroomCount', overviewLiving: 'livingCount',
    overviewBathrooms: 'bathroomCount' }[event.target.id];
  if (key) overview[key] = event.target.value === '' ? null : Number(event.target.value);
  else if (event.target.id === 'overviewMezzanine') overview.hasMezzanine = event.target.value === '' ? null : event.target.value === 'yes';
  else if (event.target.id === 'overviewOverride') overview.mismatchAcknowledged = event.target.checked;
  else return;
  overview.reviewed = false;
  persist(); render();
  $('#overviewStatus').textContent = '户型结论已修改，请重新确认后再识别房间。';
});
$('#confirmPlanOverview').addEventListener('click', () => {
  const site = currentSite(), overview = site?.planOverview, status = $('#overviewStatus');
  if (!overview) return;
  const checked = cleanPlanOverview(overview);
  if ([checked.floorCount, checked.bedroomCount, checked.livingCount, checked.bathroomCount, checked.hasMezzanine].includes(null)) {
    status.textContent = '请根据原图补齐或修改层数、卧室、客厅、卫生间与夹层情况；无法确认时先不要进入自动摆放。'; return;
  }
  if (suggestedApartmentType(checked) !== current().apartmentType && !checked.mismatchAcknowledged) {
    status.textContent = '识别户型与所选套餐不一致。请核对并选择匹配套餐，或明确勾选仍按当前套餐继续。'; return;
  }
  site.planOverview = { ...checked, reviewed: true };
  persist(); render();
  status.textContent = '整套户型已由你核对。现在可以识别房间草稿；家具仍需逐房间核对后才显示。';
  $('#quickGenerate').scrollIntoView({ behavior: 'smooth', block: 'center' });
});
async function cropHomeSpaces(source, spaces) {
  const image = await new Promise((resolve, reject) => {
    const value = new Image(); value.onload = () => resolve(value); value.onerror = reject;
    value.src = source.dataUrl;
  });
  return spaces.map(space => {
    const margin = Math.min(50, Math.max(12, Math.round(Math.max(space.w, space.h) * .12)));
    const sx = Math.max(0, space.x - margin), sy = Math.max(0, space.y - margin);
    const sw = Math.min(source.widthPx - sx, space.w + margin * 2);
    const sh = Math.min(source.heightPx - sy, space.h + margin * 2);
    const scale = Math.min(1, 560 / Math.max(sw, sh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(20, Math.round(sw * scale));
    canvas.height = Math.max(20, Math.round(sh * scale));
    const context = canvas.getContext('2d');
    context.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    context.strokeStyle = '#2563eb'; context.lineWidth = 2;
    context.setLineDash([6, 4]);
    context.strokeRect((space.x - sx) * scale, (space.y - sy) * scale,
      space.w * scale, space.h * scale);
    context.setLineDash([]);
    let cropDataUrl = canvas.toDataURL('image/jpeg', .75);
    if (cropDataUrl.length > 250_000) cropDataUrl = canvas.toDataURL('image/jpeg', .55);
    if (cropDataUrl.length > 250_000) throw new Error('局部图过大，无法安全分析；请换清晰但文件更小的图纸。');
    return { ...space, cropDataUrl };
  });
}

async function gridHomePlanForLocation(source) {
  const image = await new Promise((resolve, reject) => {
    const value = new Image(); value.onload = () => resolve(value); value.onerror = reject;
    value.src = source.dataUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = source.widthPx; canvas.height = source.heightPx;
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  context.save();
  context.strokeStyle = 'rgba(37, 99, 235, 0.27)';
  context.fillStyle = '#1d4ed8';
  context.lineWidth = Math.max(1, Math.round(Math.min(canvas.width, canvas.height) / 700));
  context.font = `bold ${Math.max(11, Math.round(Math.min(canvas.width, canvas.height) / 60))}px system-ui`;
  for (let step = 1; step < 5; step++) {
    const x = Math.round(canvas.width * step / 5), y = Math.round(canvas.height * step / 5);
    context.beginPath(); context.moveTo(x, 0); context.lineTo(x, canvas.height);
    context.moveTo(0, y); context.lineTo(canvas.width, y); context.stroke();
    context.fillText(String(step * 200), Math.min(canvas.width - 38, x + 3), 16);
    context.fillText(String(step * 200), 3, Math.min(canvas.height - 3, y - 4));
  }
  context.restore();
  const gridded = canvas.toDataURL('image/jpeg', .75);
  return gridded.length <= 2_000_000 ? gridded : source.dataUrl;
}

async function requestZoneSuggestions(site, pin, onProgress = () => {}) {
  const source = site?.source;
  if (source?.kind !== 'image' || isDemoSite(site)) throw new Error('请先上传真实的图片户型图。');
  if (!overviewReady(site)) throw new Error('请先识别并确认整套户型，再识别房间。');
  if (location.protocol === 'file:') throw new Error('AI 需要服务端：请在已部署的验收页使用，或运行 npm run dev:home。');
  if (!pin) throw new Error('请填写服务端 AI 访问码。');
  const apartmentType = current().apartmentType;
  onProgress('第一步：正在从原图提取墙线与封闭区域；这只是结构候选，不代表已识别房间…');
  let structure = null, localError = '';
  try {
    if (segmentationCache?.source !== source.dataUrl || !segmentationCache.structure) {
      structure = buildHomePlanStructure(await pixelsForWallSnap(source), source.widthPx, source.heightPx);
      segmentationCache = { source: source.dataUrl, structure, regions: structure?.regions || [] };
    } else structure = segmentationCache.structure;
  } catch (error) { localError = error.message || '墙线结构提取失败'; }
  if (currentSite()?.source?.dataUrl !== source.dataUrl || current().apartmentType !== apartmentType)
    throw new Error('户型图已变化，请重新分析。');
  const inkBounds = structure?.inkBounds || null;
  const localSpaces = structure?.candidates || [];
  const localProposed = localSpaces.length;
  const suggestions = [];
  let rejectedCount = 0, uncertainCount = 0;
  const classifyCrops = async (items, stage, segmentationRisk = false) => {
    for (let index = 0; index < items.length; index += 8) {
      const batch = items.slice(index, index + 8);
      onProgress(`${stage}：正在看第 ${index + 1}–${index + batch.length}/${items.length} 个空间的局部图，判断用途…`);
      const classified = await fetch('api/classify-home-spaces', { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, widthPx: source.widthPx, heightPx: source.heightPx, spaces: batch }) });
      const answer = await classified.json();
      if (!classified.ok) throw new Error(answer.error || '空间用途判断失败');
      for (const zone of Array.isArray(answer.suggestions) ? answer.suggestions : []) {
        // Outdoor and circulation areas can lie outside the main indoor wall envelope.
        if (!['deck', 'ac_ledge', 'void', 'stairs'].includes(zone.kind) &&
            filterHomeSpaceMarginBoxes([zone], inkBounds, source.widthPx, source.heightPx).rejectedCount) {
          rejectedCount++; continue;
        }
        suggestions.push({ ...zone, segmentationRisk });
      }
      rejectedCount += Number.isInteger(answer.rejectedCount) ? answer.rejectedCount : 0;
      uncertainCount += Number.isInteger(answer.uncertainCount) ? answer.uncertainCount : 0;
    }
  };
  try {
    if (localSpaces.length) await classifyCrops(await cropHomeSpaces(source, localSpaces), '第一步', true);
  } catch (error) { localError = error.message || '结构候选用途判断失败'; }
  onProgress('第二步：正在对照整图寻找结构分割漏掉的区域；坐标框仍须复核…');
  const locationImage = await gridHomePlanForLocation(source);
  const response = await fetch('api/find-home-spaces', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin, imageDataUrl: locationImage, widthPx: source.widthPx, heightPx: source.heightPx,
      overview: site.planOverview }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '空间补漏失败');
  if (currentSite()?.source?.dataUrl !== source.dataUrl || current().apartmentType !== apartmentType)
    throw new Error('户型图已变化，请重新分析。');
  const spaces = (Array.isArray(result.spaces) ? result.spaces : []).slice(0, 16).filter(space =>
    Number.isInteger(space?.id) && [space.x, space.y, space.w, space.h].every(Number.isInteger) &&
    space.x >= 0 && space.y >= 0 && space.w >= 20 && space.h >= 20 &&
    space.x + space.w <= source.widthPx && space.y + space.h <= source.heightPx);
  if (spaces.length) await classifyCrops(await cropHomeSpaces(source, spaces), '第二步');
  const trustedZones = () => {
    // A structural crop might contain only a bed or a bathroom fixture. It
    // must not satisfy the whole-unit count or suppress the recovery pass.
    const identified = reconcileHomeSpaceSuggestions(suggestions.filter(zone =>
      !zone.segmentationRisk && ['bedroom', 'living', 'bathroom', 'mezzanine'].includes(zone.kind)));
    const conflicted = new Set();
    for (let i = 0; i < identified.length; i++) for (let j = i + 1; j < identified.length; j++) {
      const a = identified[i], b = identified[j];
      const width = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
      const height = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      if (width * height > .35 * Math.min(a.w * a.h, b.w * b.h)) {
        conflicted.add(a); conflicted.add(b);
      }
    }
    return identified.filter(zone => !conflicted.has(zone));
  };
  const missingFrom = zones => ({
    bedroom: Math.max(0, site.planOverview.bedroomCount - zones.filter(zone => zone.kind === 'bedroom').length),
    living: Math.max(0, site.planOverview.livingCount - zones.filter(zone => zone.kind === 'living').length),
    bathroom: Math.max(0, site.planOverview.bathroomCount - zones.filter(zone => zone.kind === 'bathroom').length),
    mezzanine: Number(site.planOverview.hasMezzanine && !zones.some(zone => zone.kind === 'mezzanine')),
  });
  let knownZones = trustedZones(), missingCounts = missingFrom(knownZones);
  const allSpaces = [...localSpaces, ...spaces];
  let recoveryAttempted = false, recoveryFound = 0, recoveryError = '';
  if (Object.values(missingCounts).some(Boolean)) {
    recoveryAttempted = true;
    onProgress('第三步：房间数量仍有缺口，正在回看整图寻找遗漏；不会强凑数量…');
    try {
      const alreadyFound = knownZones.map(({ kind, x, y, w, h }) => ({ kind, x, y, w, h }));
      const recovered = await fetch('api/recover-home-spaces', { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, imageDataUrl: source.dataUrl, widthPx: source.widthPx,
          heightPx: source.heightPx, overview: site.planOverview, knownZones: alreadyFound, missingCounts }) });
      const answer = await recovered.json();
      if (!recovered.ok) throw new Error(answer.error || '缺失房间回找失败');
      if (currentSite()?.source?.dataUrl !== source.dataUrl || current().apartmentType !== apartmentType)
        throw new Error('户型图已变化，请重新分析。');
      const rawProposals = (Array.isArray(answer.spaces) ? answer.spaces : []).slice(0, 16).filter(space =>
        Number.isInteger(space?.id) && [space.x, space.y, space.w, space.h].every(Number.isInteger) &&
        space.x >= 0 && space.y >= 0 && space.w >= 20 && space.h >= 20 &&
        space.x + space.w <= source.widthPx && space.y + space.h <= source.heightPx);
      const proposals = rawProposals;
      recoveryFound = proposals.length;
      allSpaces.push(...proposals);
      if (proposals.length) await classifyCrops(await cropHomeSpaces(source, proposals), '第三步');
    } catch (error) {
      if (error.message === '户型图已变化，请重新分析。') throw error;
      recoveryError = error.message || '缺失房间回找失败';
    }
  }
  if (currentSite()?.source?.dataUrl !== source.dataUrl || current().apartmentType !== apartmentType)
    throw new Error('户型图已变化，请重新分析。');
  const reconciled = reconcileHomeSpaceSuggestions(suggestions);
  const prioritized = reconciled.length <= 20 ? reconciled : [
    ...reconciled.filter(zone => zone.kind !== 'unknown'),
    ...reconciled.filter(zone => zone.kind === 'unknown'),
  ].slice(0, 20);
  const clean = prioritized.filter(zone =>
      Object.hasOwn(zoneNames, zone?.kind) && [zone.x, zone.y, zone.w, zone.h].every(Number.isInteger) &&
      zone.x >= 0 && zone.y >= 0 && zone.w >= 8 && zone.h >= 8 &&
      zone.x + zone.w <= source.widthPx && zone.y + zone.h <= source.heightPx)
      .map(zone => {
        const dimensionsMm = zone.dimensionsMm && [zone.dimensionsMm.width, zone.dimensionsMm.depth]
          .every(value => Number.isInteger(value) && value >= 100 && value <= 100000)
          ? { width: zone.dimensionsMm.width, depth: zone.dimensionsMm.depth } : null;
        return { kind: zone.kind, x: zone.x, y: zone.y, w: zone.w, h: zone.h,
          evidence: typeof zone.evidence === 'string' ? zone.evidence.slice(0, 120) : '',
          labelText: typeof zone.labelText === 'string' ? zone.labelText.slice(0, 60) : '',
          support: typeof zone.support === 'string' ? zone.support.slice(0, 160) : '',
          dimensionsMm, segmentationRisk: zone.segmentationRisk === true };
      });
  for (let i = 0; i < clean.length; i++) for (let j = i + 1; j < clean.length; j++) {
    const a = clean[i], b = clean[j];
    const width = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const height = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    if (width * height / Math.min(a.w * a.h, b.w * b.h) <= .35 ||
        a.kind === 'unknown' || b.kind === 'unknown') continue;
    for (const zone of [a, b]) Object.assign(zone, { kind: 'unknown', labelText: '', evidence: '',
      dimensionsMm: null, support: '候选空间明显重叠，需人工核对边界' });
  }
  uncertainCount = clean.filter(zone => zone.kind === 'unknown').length;
  const localIdentified = clean.filter(zone => zone.segmentationRisk && zone.kind !== 'unknown').length;
  const geometryWarningCount = homeZoneGeometryWarnings(clean.map(zone =>
    ({ ...zone, selected: zone.kind !== 'unknown' })), source)
    .filter((items, index) => items.length || clean[index].segmentationRisk).length;
  return { suggestions: clean, reviewSuggestions: clean,
    spaceCount: allSpaces.length, rejectedCount, uncertainCount, geometryWarningCount,
    localProposed, localIdentified, localError, contrastFallback: structure?.contrastFallback === true,
    recoveryAttempted, recoveryFound, recoveryError };
}

function editableZoneSuggestions(suggestions) {
  return suggestions.map(zone => ({ ...zone,
    widthInput: String(zone.dimensionsMm?.width ?? ''),
    depthInput: String(zone.dimensionsMm?.depth ?? ''),
    selected: zone.kind !== 'unknown', confirmSize: false, boundsEdited: false,
    boundaryConfirmed: false, geometryWarnings: [] }));
}

function refreshDraftGeometry() {
  const draft = aiZoneDraft, source = currentSite()?.source;
  if (!draft || draft.source !== source?.dataUrl) return;
  const warnings = homeZoneGeometryWarnings(draft.suggestions, source);
  for (const [index, zone] of draft.suggestions.entries()) {
    if (zone.segmentationRisk) warnings[index].push('墙线连通域可能包括走道、储物或挑空');
    if (zone.geometryWarnings.join('|') !== warnings[index].join('|')) zone.boundaryConfirmed = false;
    zone.geometryWarnings = warnings[index];
  }
}

async function pixelsForWallSnap(source) {
  if (wallSnapPixels?.source === source.dataUrl) return wallSnapPixels.data;
  const image = await new Promise((resolve, reject) => {
    const value = new Image(); value.onload = () => resolve(value); value.onerror = reject;
    value.src = source.dataUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = source.widthPx; canvas.height = source.heightPx;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  wallSnapPixels = { source: source.dataUrl, data };
  return data;
}

function showZoneReviewDraft(site, suggestions, quickRecovery = false) {
  aiZoneDrag = null;
  aiZoneDraft = { source: site.source.dataUrl, apartmentType: current().apartmentType,
    suggestions: editableZoneSuggestions(suggestions), quickRecovery, segmentationPreview: null };
  refreshDraftGeometry();
  render();
}

$('#suggestHomeZones').addEventListener('click', async () => {
  const status = $('#aiZoneStatus'), button = $('#suggestHomeZones');
  button.disabled = true; status.textContent = '正在分步分析图纸；结果只会先显示为草稿…';
  try {
    const site = currentSite();
    const analysis = await requestZoneSuggestions(site, $('#planZonePin').value,
      message => { status.textContent = message; });
    showZoneReviewDraft(site, analysis.reviewSuggestions);
    status.textContent = analysis.reviewSuggestions.length
      ? `共检查 ${analysis.spaceCount} 个候选空间（先提取墙线结构 ${analysis.localProposed} 个，局部 AI 暂定用途 ${analysis.localIdentified} 个），${analysis.rejectedCount} 个被排除且不再画框，${analysis.uncertainCount} 个用途不确定，${analysis.geometryWarningCount} 个边界存在结构风险。${analysis.contrastFallback ? '浅色图启用了增强线条，须特别核对边界。' : ''}${analysis.localError ? `结构提取未完成：${analysis.localError}。` : ''}${analysis.recoveryError ? `整图补漏未完成：${analysis.recoveryError}。` : ''}保留的边界和类型仍需核对。`
      : `没有找到可靠的房间区域${analysis.recoveryAttempted ? '；已回看整图仍未找到可确认的缺失房间' : ''}。可在图上手工框选。`;
  } catch (error) { status.textContent = error.message || '分析失败，请重试。'; }
  finally { button.disabled = false; $('#planZonePin').value = ''; }
});

$('#generateFurnishedDraft').addEventListener('click', async () => {
  const site = currentSite(), status = $('#quickGenerateStatus'), button = $('#generateFurnishedDraft');
  if (site?.source?.kind !== 'image' || isDemoSite(site)) { status.textContent = '请先上传客户的图片户型图。'; return; }
  if (location.protocol === 'file:') { status.textContent = '自动填家具需要服务端：请在已部署的验收页使用，或运行 npm run dev:home。'; return; }
  if (!$('#quickPlanPin').value) { status.textContent = '请填写验收访问码后再生成。'; $('#quickPlanPin').focus(); return; }
  if (site.zones?.length && !confirm('重新生成会替换当前户型的全部房间标注和家具区域分配。请先导出项目备份，确定继续吗？')) return;
  button.disabled = true; status.textContent = '正在先提取结构候选、再用 AI 判断用途；候选区域仍需核对…';
  try {
    const analysis = await requestZoneSuggestions(site, $('#quickPlanPin').value,
      message => { status.textContent = message; });
    const suggestions = analysis.suggestions;
    const roomCounts = [ ['bedroom', 'bedroomCount', '卧室'], ['living', 'livingCount', '客厅'],
      ['bathroom', 'bathroomCount', '卫生间'] ];
    const mismatches = [];
    for (const [kind, key, name] of roomCounts) {
      const found = suggestions.filter(zone => zone.kind === kind).length;
      if (found !== site.planOverview[key])
        mismatches.push(`识别到 ${found} 处${name}，已确认 ${site.planOverview[key]} 处`);
    }
    const mezzanineFound = suggestions.some(zone => zone.kind === 'mezzanine');
    if (mezzanineFound !== site.planOverview.hasMezzanine)
      mismatches.push(`夹层识别${mezzanineFound ? '有' : '无'}，已确认${site.planOverview.hasMezzanine ? '有' : '无'}`);
    if (mismatches.length || analysis.geometryWarningCount ||
        analysis.reviewSuggestions.some(zone => zone.segmentationRisk) ||
        analysis.recoveryFound || analysis.recoveryError ||
        !suggestions.some(zone => ['living', 'dining', 'bedroom', 'mezzanine'].includes(zone.kind))) {
      showZoneReviewDraft(site, analysis.reviewSuggestions, true);
      const detail = mismatches.length ? `房间草稿与户型不一致：${mismatches.join('；')}。` :
        analysis.geometryWarningCount ? `${analysis.geometryWarningCount} 个候选框有明显几何风险。` :
          analysis.recoveryFound ? `整图补漏找到了 ${analysis.recoveryFound} 个候选框，必须核对位置和用途。` :
            analysis.recoveryError ? `缺失房间回找未完成：${analysis.recoveryError}。` :
              analysis.localIdentified ? '墙线结构候选框必须核对完整边界和用途。' : '未识别到可摆家具的房间。';
      status.textContent = `${detail}未覆盖原标注；${tentativeLayout?.placedCount ? `已在低风险区域试绘 ${tentativeLayout.placedCount} 件模拟家具，仅供讨论、不可下载` : '风险区域暂不摆家具'}。墙线结构先提出 ${analysis.localProposed} 个候选，局部 AI 暂定用途 ${analysis.localIdentified} 个；${analysis.rejectedCount} 个被排除且不再画框。${analysis.contrastFallback ? '浅色图启用了增强线条，边界更需核对。' : ''}保留 ${analysis.reviewSuggestions.length} 个待核对框，请在下方改类型、核边界或在图上补画。`;
      $('#planView').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const draft = createHomeAutoDraft(suggestions, site.source);
    const candidates = suggestions.map(zone => ({ ...zone, selected: zone.kind !== 'unknown' }));
    const previewable = new Set(selectHomePartialPreviewZones(candidates, site.source, site.planOverview));
    site.zones = draft.zones.map((zone, index) => ({ ...zone,
      previewSafe: previewable.has(candidates[index]) }));
    current().zoneAssignments = {};
    current().placementOverrides = {};
    current().placementReviews = {};
    const samples = mockProductsForPackage(active);
    current().products = { ...samples, ...current().products };
    current().conceptPreviewEnabled = true;
    aiZoneDraft = null; aiZoneDrag = null; drawMode = null; drawing = null;
    persist(); render();
    status.textContent = `已得到 ${draft.zones.length} 个候选区域，${analysis.uncertainCount} 个用途不确定，${analysis.rejectedCount} 个排除。边界待内部核对；其中 ${draft.visualOnlyCount} 处缺图示尺寸。${tentativeLayout?.placedCount ? `已试绘 ${tentativeLayout.placedCount} 件半透明模拟家具，非正式方案` : '尚无可安全试绘的家具区域'}。`;
    $('#message').textContent = 'AI 房间识别尚未核对，当前没有家具适配结果。';
    $('#planView').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (error) { status.textContent = error.message || '生成失败，请稍后重试。'; }
  finally { button.disabled = false; $('#quickPlanPin').value = ''; }
});
$('#aiZoneSuggestions').addEventListener('input', event => {
  const field = event.target.dataset.aiSizeField;
  const index = Number(event.target.closest('[data-ai-zone-row]')?.dataset.aiZoneRow);
  const zone = aiZoneDraft?.suggestions[index];
  if (!zone || !['width', 'depth'].includes(field)) return;
  zone[`${field}Input`] = event.target.value;
  if (zone.confirmSize) {
    zone.confirmSize = false;
    event.target.closest('.ai-zone-row').querySelector('[data-ai-zone-dimension]').checked = false;
    $('#aiZoneStatus').textContent = '尺寸已修改；请核对来源后重新勾选确认。';
  }
});
$('#aiZoneSuggestions').addEventListener('click', async event => {
  const previewButton = event.target.closest('[data-ai-region-preview]');
  if (previewButton) {
    const draft = aiZoneDraft, source = currentSite()?.source;
    const index = Number(previewButton.dataset.aiRegionPreview), zone = draft?.suggestions[index];
    if (!zone || !source || draft.source !== source.dataUrl) return;
    if (draft.segmentationPreview?.index === index) {
      draft.segmentationPreview = null; renderAiZoneAssist(); drawPlan(); return;
    }
    previewButton.disabled = true;
    $('#aiZoneStatus').textContent = '正在本地提取墙线和封闭区域；这一步不会发送图纸或改动房间…';
    try {
      if (segmentationCache?.source !== source.dataUrl) {
        const pixels = await pixelsForWallSnap(source);
        segmentationCache = { source: source.dataUrl,
          regions: proposeHomeRoomRegions(pixels, source.widthPx, source.heightPx) };
      }
      if (aiZoneDraft !== draft || currentSite()?.source !== source) return;
      const match = matchHomeRoomRegions(draft.suggestions, segmentationCache.regions)[index];
      if (!match) {
        draft.segmentationPreview = null; drawPlan();
        $('#aiZoneStatus').textContent = '附近没有唯一且相近的封闭区域，或该轮廓已属于另一候选房间。开放客餐厨、门洞或挑空请手工核对。';
        return;
      }
      draft.segmentationPreview = { index, region: match.region };
      renderAiZoneAssist(); drawPlan();
      $('#aiZoneStatus').textContent = `已显示建议 ${index + 1} 附近的墙线连通域。请对照原图检查，蓝色遮罩也可能覆盖走道、储物或挑空。`;
    } catch { $('#aiZoneStatus').textContent = '无法提取墙线分割；原房间框未改动。'; }
    finally { previewButton.disabled = false; }
    return;
  }
  const applyRegion = event.target.closest('[data-ai-region-apply]');
  if (applyRegion) {
    const draft = aiZoneDraft, index = Number(applyRegion.dataset.aiRegionApply);
    const preview = draft?.segmentationPreview, zone = draft?.suggestions[index];
    if (!zone || !preview || preview.index !== index) return;
    Object.assign(zone, { x: preview.region.x, y: preview.region.y,
      w: preview.region.w, h: preview.region.h,
      boundsEdited: true, boundaryConfirmed: false, confirmSize: false, labelText: '',
      segmentationRisk: true });
    draft.segmentationPreview = null;
    refreshDraftGeometry(); renderAiZoneAssist(); drawPlan();
    $('#aiZoneStatus').textContent = '已套用连通区域的外接框，但未确认房间边界或尺寸；请核对门洞、隔墙及挑空。';
    return;
  }
  const button = event.target.closest('[data-ai-wall-snap]');
  if (!button) return;
  const draft = aiZoneDraft, source = currentSite()?.source;
  const zone = draft?.suggestions[Number(button.dataset.aiWallSnap)];
  if (!zone || !source || draft.source !== source.dataUrl) return;
  button.disabled = true;
  $('#aiZoneStatus').textContent = '正在本地图像中寻找四条连续线条…';
  try {
    const pixels = await pixelsForWallSnap(source);
    if (aiZoneDraft !== draft || currentSite()?.source !== source) return;
    const snapped = snapHomeZoneToLines(pixels, source.widthPx, source.heightPx, zone);
    if (!snapped) {
      $('#aiZoneStatus').textContent = '未找到可信的四边线条，或框内疑似有隔墙；原框未改动，请手动修正。';
      return;
    }
    const changed = ['x', 'y', 'w', 'h'].some(field => zone[field] !== snapped[field]);
    if (!changed) {
      $('#aiZoneStatus').textContent = '候选框已贴近可见线条；这些线条仍可能属于家具，请对照原图核对。';
      return;
    }
    Object.assign(zone, { x: snapped.x, y: snapped.y, w: snapped.w, h: snapped.h,
      boundsEdited: true, boundaryConfirmed: false, confirmSize: false, labelText: '' });
    draft.segmentationPreview = null;
    refreshDraftGeometry(); renderAiZoneAssist(); drawPlan();
    $('#aiZoneStatus').textContent = '已按可见线条修正候选框，但未自动确认房间边界；请核对墙体、门和尺寸。';
  } catch { $('#aiZoneStatus').textContent = '无法分析该图片的线条，原框未改动。'; }
  finally { button.disabled = false; }
});
$('#aiZoneSuggestions').addEventListener('change', event => {
  const row = event.target.closest('[data-ai-zone-row]');
  const zone = aiZoneDraft?.suggestions[Number(row?.dataset.aiZoneRow)];
  if (!zone) return;
  const target = event.target;
  if (target.matches('[data-ai-zone-selected]')) {
    zone.selected = target.checked; refreshDraftGeometry(); renderAiZoneAssist(); drawPlan(); return;
  }
  if (target.matches('[data-ai-zone-kind]')) {
    if (!Object.hasOwn(zoneNames, target.value)) return;
    const wasUnknown = zone.kind === 'unknown';
    zone.kind = target.value; zone.confirmSize = false; zone.labelText = ''; zone.support = '';
    aiZoneDraft.segmentationPreview = null;
    if (wasUnknown && target.value !== 'unknown') zone.selected = true;
    refreshDraftGeometry();
    renderAiZoneAssist(); drawPlan(); return;
  }
  if (target.matches('[data-ai-boundary-confirmed]')) {
    zone.boundaryConfirmed = target.checked;
    return;
  }
  if (target.matches('[data-ai-zone-dimension]')) {
    if (target.checked && !draftDimensions(zone)) {
      target.checked = false;
      $('#aiZoneStatus').textContent = '请先填写两边经核对的毫米整数（100–100000）。';
      return;
    }
    zone.confirmSize = target.checked; return;
  }
  if (target.matches('[data-ai-box-field]')) {
    const values = Object.fromEntries(['x', 'y', 'w', 'h'].map(field =>
      [field, Number(row.querySelector(`[data-ai-box-field="${field}"]`).value)]));
    const source = currentSite()?.source;
    if (!source || !Object.values(values).every(Number.isInteger) || values.x < 0 || values.y < 0 ||
        values.w < 8 || values.h < 8 || values.x + values.w > source.widthPx ||
        values.y + values.h > source.heightPx) {
      $('#aiZoneStatus').textContent = '边界必须在图片内，宽和高至少 8 像素。';
      renderAiZoneAssist(); return;
    }
    Object.assign(zone, values, { boundsEdited: true, boundaryConfirmed: false,
      confirmSize: false, labelText: '' });
    aiZoneDraft.segmentationPreview = null;
    refreshDraftGeometry();
    renderAiZoneAssist(); drawPlan();
  }
});
$('#applyZoneSuggestions').addEventListener('click', () => {
  const site = currentSite(), draft = aiZoneDraft;
  if (!site || !draft || site.source?.dataUrl !== draft.source || current().apartmentType !== draft.apartmentType) return;
  const quickRecovery = draft.quickRecovery === true && !site.zones.length;
  const selected = draft.suggestions.filter(zone => zone.selected);
  if (!selected.length) { $('#aiZoneStatus').textContent = '请至少勾选一个可信区域。'; return; }
  if (selected.some(zone => zone.kind === 'unknown')) {
    $('#aiZoneStatus').textContent = '有用途不确定的区域；请先按原图确定类型，或取消勾选。'; return;
  }
  refreshDraftGeometry();
  if (selected.some(zone => zone.geometryWarnings.length && !zone.boundaryConfirmed)) {
    $('#aiZoneStatus').textContent = '有边界风险尚未核实；请调整方框或逐个对照原图勾选“完整边界已核实”。'; return;
  }
  if (site.zones.length + selected.length > 30) {
    $('#aiZoneStatus').textContent = '区域数量不能超过 30 个。请先取消多余建议。'; return;
  }
  const stamp = Date.now();
  for (const [index, zone] of selected.entries()) {
    const size = zone.confirmSize ? draftDimensions(zone) : null;
    if (zone.confirmSize && !size) { $('#aiZoneStatus').textContent = '有尚未核对的尺寸，请先修正。'; return; }
  }
  const visualDrafts = createHomeAutoDraft(selected, site.source).zones;
  const previewable = new Set(selectHomePartialPreviewZones(draft.suggestions, site.source, site.planOverview));
  for (const [index, zone] of selected.entries()) {
    const size = zone.confirmSize ? draftDimensions(zone) : null;
    const confirmedPrinted = !!size && !!zone.dimensionsMm && !!zone.evidence &&
      size.width === zone.dimensionsMm.width && size.depth === zone.dimensionsMm.depth;
    site.zones.push({ id: `ai-${stamp}-${index}`, kind: zone.kind, x: zone.x, y: zone.y, w: zone.w, h: zone.h,
      reviewStatus: 'draft',
      previewSafe: previewable.has(zone),
      ...(!size && visualDrafts[index]?.visualSizeMm ? { visualSizeMm: visualDrafts[index].visualSizeMm } : {}),
      ...(zone.labelText && !zone.boundsEdited ? { labelText: zone.labelText } : {}),
      ...(size ? { dimensionsMm: size,
        dimensionsLabel: confirmedPrinted ? `${zone.evidence}（已确认）`.slice(0, 60) :
          `${(size.width / 1000).toFixed(2)}m × ${(size.depth / 1000).toFixed(2)}m（人工确认）`,
        dimensionSource: confirmedPrinted ? 'ai_confirmed_printed' : 'manual',
        dimensionEvidence: confirmedPrinted ? zone.evidence : '' } : {}) });
  }
  if (quickRecovery) {
    const samples = mockProductsForPackage(active);
    current().products = { ...samples, ...current().products };
    const overview = site.planOverview;
    current().conceptPreviewEnabled = overviewReady(site) &&
      site.zones.filter(zone => zone.kind === 'bedroom').length === overview.bedroomCount &&
      site.zones.filter(zone => zone.kind === 'living').length === overview.livingCount &&
      site.zones.filter(zone => zone.kind === 'bathroom').length === overview.bathroomCount &&
      site.zones.some(zone => zone.kind === 'mezzanine') === overview.hasMezzanine;
  }
  aiZoneDraft = null; aiZoneDrag = null;
  persist(); render();
  $('#aiZoneStatus').textContent = `已应用 ${selected.length} 个待核对区域；${quickRecovery && !current().conceptPreviewEnabled ? '房间数量仍未与确认的户型一致，请补画缺失区域；' : ''}${tentativeLayout?.placedCount ? '低风险区域的模拟家具仅供预览；' : ''}请逐一确认名称和边界后再生成可下载的家具初稿。`;
  $('#message').textContent = '房间建议已应用；未确认的尺寸保持空白或比例估算。';
});
$('#extractPlanDimensions').addEventListener('click', async () => {
  const status = $('#aiDimensionStatus'), button = $('#extractPlanDimensions');
  const site = currentSite(), zones = aiEligibleZones(site).slice(0, 12);
  if (!zones.length) { status.textContent = '没有需要补充的可摆家具房间。'; return; }
  if (location.protocol === 'file:') {
    status.textContent = 'AI 识别需要服务端：请先导出当前家庭项目，再打开已部署此功能的 Vercel 站点 /home.html（或运行 npm run dev:home 打开本机页面），导入项目后重试。'; return;
  }
  const pin = $('#planAiPin').value;
  if (!pin) { status.textContent = '请填写服务端 AI 访问码。'; return; }
  button.disabled = true; status.textContent = '正在读取房间局部图中的尺寸文字…';
  try {
    const source = site.source.dataUrl, apartmentType = current().apartmentType;
    const zoneSnapshot = zones.map(zone => [zone.id, zone.kind, zone.x, zone.y, zone.w, zone.h]);
    const rows = await cropRoomImages(site, zones);
    if (rows.some(row => row.crop.length > 700000) || JSON.stringify(rows.map(row => row.crop)).length > 2400000)
      throw new Error('房间图片过大，请先缩小户型图。');
    const response = await fetch('api/extract-plan-dimensions', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin, zones: rows.map(row => ({ id: row.requestId, kind: row.kind, imageDataUrl: row.crop })) }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '读取失败');
    if (currentSite()?.source?.dataUrl !== source || current().apartmentType !== apartmentType ||
        JSON.stringify(aiEligibleZones().slice(0, 12).map(zone => [zone.id, zone.kind, zone.x, zone.y, zone.w, zone.h])) !== JSON.stringify(zoneSnapshot))
      throw new Error('户型图已变化，请重新读取。');
    const candidates = new Map((Array.isArray(result.candidates) ? result.candidates : []).map(item => [item.zoneId, item]));
    aiDimensionDraft = { source, apartmentType, rows: rows.map(row =>
      ({ ...row, candidate: candidates.get(row.requestId) || null })) };
    renderAiDimensionResults();
    const readCount = aiDimensionDraft.rows.filter(row => row.candidate?.dimensionsMm).length;
    status.textContent = `读到 ${readCount}/${rows.length} 处完整尺寸。请逐项核对局部图，点击“确认并应用”；未确认的值不会改变方案。`;
  } catch (error) { status.textContent = error.message || '读取失败，请重试。'; }
  finally { button.disabled = false; $('#planAiPin').value = ''; }
});
$('#aiDimensionResults').addEventListener('click', event => {
  const zoneId = event.target.closest('[data-confirm-ai-zone]')?.dataset.confirmAiZone;
  if (!zoneId || !aiDimensionDraft || aiDimensionDraft.source !== currentSite()?.source?.dataUrl ||
      aiDimensionDraft.apartmentType !== current().apartmentType) return;
  const row = aiDimensionDraft.rows.find(item => item.zoneId === zoneId);
  const zone = aiEligibleZones().find(item => item.id === zoneId);
  if (!row || !zone) return;
  const host = event.target.closest('.ai-dimension-result');
  const width = Number(host.querySelector('[data-ai-field="width"]').value);
  const depth = Number(host.querySelector('[data-ai-field="depth"]').value);
  if (![width, depth].every(value => Number.isInteger(value) && value >= 100 && value <= 100000)) {
    $('#aiDimensionStatus').textContent = '请填写两边经核对的毫米整数，范围 100–100000。'; return;
  }
  const suggested = row.candidate?.dimensionsMm;
  const confirmedPrinted = !!suggested && width === suggested.width && depth === suggested.depth;
  zone.dimensionsMm = { width, depth };
  zone.dimensionSource = confirmedPrinted ? 'ai_confirmed_printed' : 'manual';
  zone.dimensionEvidence = confirmedPrinted ? row.candidate.evidence : '';
  zone.dimensionsLabel = confirmedPrinted ? `${row.candidate.evidence}（已确认）`.slice(0, 60)
    : `${(width / 1000).toFixed(2)}m × ${(depth / 1000).toFixed(2)}m（人工确认）`;
  aiDimensionDraft.rows = aiDimensionDraft.rows.filter(item => item.zoneId !== zoneId);
  persist(); invalidateConcept(); renderPlan(); renderSummary();
  $('#aiDimensionStatus').textContent = `${zoneDisplayName(zone)}尺寸已应用；家具图已更新，实际适配仍待现场核对。`;
  $('#message').textContent = `${zoneDisplayName(zone)}图示尺寸已确认并应用；实际适配仍待现场核对。`;
});
$('#clearPlan').addEventListener('click', () => {
  if (!currentSite() || !confirm('移除当前户型图和房间标注？')) return;
  delete sites[current().apartmentType]; drawMode = null; drawing = null; calibrationPoints = [];
  for (const project of Object.values(projects)) if (project.apartmentType === current().apartmentType) {
    project.zoneAssignments = {}; project.placementOverrides = {}; project.placementReviews = {};
  }
  furnitureEditMode = false;
  invalidateConcept();
  persist(); renderPlan(); renderSummary();
});
$('#calibratePlan').addEventListener('click', () => {
  if (!currentSite()?.source || currentSite().source.kind !== 'image') return;
  const distance = Number($('#knownDistance').value);
  if (!Number.isFinite(distance) || distance < 100 || distance > 100000) {
    $('#message').textContent = '请先填写图上两点的实测距离，单位为毫米。'; return;
  }
  furnitureEditMode = false; drawMode = 'calibrate'; calibrationPoints = []; renderPlan();
  $('#message').textContent = '请在图上依次点击已知距离的两个端点。';
});
$('#zoneTools').addEventListener('click', event => {
  const button = event.target.closest('[data-zone]');
  if (!button || currentSite()?.source?.kind !== 'image') return;
  furnitureEditMode = false; drawMode = button.dataset.zone; calibrationPoints = []; renderPlan();
});
$('#stopDrawing').addEventListener('click', () => { drawMode = null; drawing = null; calibrationPoints = []; renderPlan(); });
$('#zoneList').addEventListener('click', event => {
  const snapId = event.target.closest('[data-zone-wall-snap]')?.dataset.zoneWallSnap;
  if (snapId) {
    const site = currentSite(), source = site?.source;
    const zone = site?.zones?.find(item => item.id === snapId);
    if (!zone || source?.kind !== 'image') return;
    const button = event.target.closest('[data-zone-wall-snap]');
    button.disabled = true;
    $('#message').textContent = '正在本地图像中寻找四条连续线条…';
    pixelsForWallSnap(source).then(pixels => {
      if (currentSite() !== site || !site.zones.includes(zone)) return;
      const snapped = snapHomeZoneToLines(pixels, source.widthPx, source.heightPx, zone);
      if (!snapped) { $('#message').textContent = '未找到可信的四边线条，或框内疑似有隔墙；原框未改动。'; return; }
      if (!['x', 'y', 'w', 'h'].some(field => zone[field] !== snapped[field])) {
        $('#message').textContent = '框已贴近可见线条；仍须人工确认这些线条属于墙体。'; return;
      }
      const previous = { w: zone.w, h: zone.h, visualSizeMm: zone.visualSizeMm };
      Object.assign(zone, { x: snapped.x, y: snapped.y, w: snapped.w, h: snapped.h,
        reviewStatus: 'draft', previewSafe: false });
      delete zone.labelText;
      if (previous.visualSizeMm) zone.visualSizeMm = {
        width: Math.max(100, Math.min(100000, Math.round(previous.visualSizeMm.width * zone.w / previous.w))),
        depth: Math.max(100, Math.min(100000, Math.round(previous.visualSizeMm.depth * zone.h / previous.h))),
      };
      for (const project of Object.values(projects)) if (project.apartmentType === current().apartmentType)
        project.placementReviews = {};
      invalidateConcept(); persist(); render();
      $('#message').textContent = '房间框已按可见线条调整，重新列为待核对；家具暂不绘制。请核对墙体、门和尺寸。';
    }).catch(() => { $('#message').textContent = '无法分析该图片的线条，原框未改动。'; })
      .finally(() => { button.disabled = false; });
    return;
  }
  const id = event.target.closest('[data-delete-zone]')?.dataset.deleteZone;
  if (!id || !currentSite()) return;
  currentSite().zones = currentSite().zones.filter(zone => zone.id !== id);
  for (const project of Object.values(projects)) if (project.apartmentType === current().apartmentType) {
    for (const [key, value] of Object.entries(project.zoneAssignments || {})) if (value === id) delete project.zoneAssignments[key];
    for (const [key, value] of Object.entries(project.placementOverrides || {}))
      if (value.zoneId === id) delete project.placementOverrides[key];
  }
  invalidateConcept();
  persist(); renderPlan(); renderSummary();
});
$('#zoneList').addEventListener('change', event => {
  const kindId = event.target?.dataset?.zoneKind;
  if (kindId) {
    const zone = currentSite()?.zones?.find(item => item.id === kindId);
    const kind = event.target.value;
    if (!zone || !Object.hasOwn(zoneNames, kind) || zone.kind === kind) return;
    zone.kind = kind; zone.reviewStatus = 'draft'; zone.previewSafe = false;
    delete zone.labelText; delete zone.dimensionsMm; delete zone.dimensionsLabel;
    delete zone.dimensionSource; delete zone.dimensionEvidence; delete zone.visualSizeMm;
    if (['living', 'dining', 'bedroom', 'mezzanine'].includes(kind)) {
      const visual = createHomeAutoDraft([zone], currentSite().source).zones[0]?.visualSizeMm;
      if (visual) zone.visualSizeMm = visual;
    }
    for (const project of Object.values(projects)) if (project.apartmentType === current().apartmentType) {
      for (const [key, value] of Object.entries(project.zoneAssignments || {}))
        if (value === kindId) delete project.zoneAssignments[key];
      for (const [key, value] of Object.entries(project.placementOverrides || {}))
        if (value.zoneId === kindId) delete project.placementOverrides[key];
      project.placementReviews = {};
    }
    persist(); render();
    $('#message').textContent = `已改为${zoneNames[kind]}，旧的 AI 文字和尺寸依据已清除；请重新核对边界与尺寸。`;
    return;
  }
  const id = event.target?.dataset?.reviewZone;
  const zone = currentSite()?.zones?.find(item => item.id === id);
  if (!zone || !['draft', 'reviewed'].includes(zone.reviewStatus)) return;
  if (zone.kind === 'unknown') {
    event.target.checked = false;
    $('#message').textContent = '此区域用途不确定；请先选择房间类型，再核对边界。';
    return;
  }
  zone.reviewStatus = event.target.checked ? 'reviewed' : 'draft';
  for (const project of Object.values(projects)) if (project.apartmentType === current().apartmentType)
    project.placementReviews = {};
  invalidateConcept(); persist(); renderPlan(); renderSummary();
  $('#message').textContent = event.target.checked
    ? `${zoneDisplayName(zone)}的名称与边界已人工标记核对；图示尺寸、家具位置和实际适配仍需分别复核。`
    : `${zoneDisplayName(zone)}已恢复为 AI 待核对区域，框内家具位置确认随之失效。`;
});
planCanvas.addEventListener('pointerdown', event => {
  if (currentSite()?.source?.kind !== 'image') return;
  const point = pointOnPlan(event);
  if (!drawMode) {
    if (furnitureEditMode) {
      const item = furnitureHit(point);
      if (!item) return;
      furnitureDrag = { item, start: point, original: { xMm: item.xMm, yMm: item.yMm } };
      planCanvas.setPointerCapture(event.pointerId);
      planCanvas.style.cursor = 'grabbing';
      event.preventDefault(); return;
    }
    const hit = draftHit(point);
    if (hit) {
      const zone = aiZoneDraft.suggestions[hit.index];
      aiZoneDrag = { ...hit, start: point, original: { x: zone.x, y: zone.y, w: zone.w, h: zone.h } };
      planCanvas.setPointerCapture(event.pointerId);
      event.preventDefault(); return;
    }
    const appliedHit = appliedZoneHit(point);
    if (!appliedHit) return;
    const zone = currentSite().zones[appliedHit.index];
    appliedZoneDrag = { ...appliedHit, start: point,
      original: { x: zone.x, y: zone.y, w: zone.w, h: zone.h, visualSizeMm: zone.visualSizeMm } };
    planCanvas.setPointerCapture(event.pointerId);
    event.preventDefault(); return;
  }
  if (drawMode === 'calibrate') {
    calibrationPoints.push(point);
    if (calibrationPoints.length === 2) {
      const px = Math.hypot(point.x - calibrationPoints[0].x, point.y - calibrationPoints[0].y);
      const mm = Number($('#knownDistance').value);
      if (px < 10 || !Number.isFinite(mm) || mm < 100) {
        calibrationPoints = []; $('#message').textContent = '两点距离过短，请重新选择。';
      } else {
        currentSite().calibration = { p1: calibrationPoints[0], p2: point, distanceMm: mm, mmPerPx: mm / px };
        applyCalibratedZoneDimensions(currentSite());
        drawMode = null; calibrationPoints = []; invalidateConcept(); persist(); renderPlan(); renderSummary();
        $('#message').textContent = '图纸比例已按这段实测距离校准。';
      }
    }
    drawPlan(); return;
  }
  drawing = { kind: drawMode, start: point, end: point };
  planCanvas.setPointerCapture(event.pointerId); drawPlan();
});
planCanvas.addEventListener('pointermove', event => {
  if (furnitureDrag) {
    const { item, start, original } = furnitureDrag;
    const zone = currentSite()?.zones?.find(value => value.id === item.zoneId);
    const size = zoneDrawingSize(zone);
    if (!zone || !size) return;
    const point = pointOnPlan(event);
    const proposedX = Math.round(original.xMm + (point.x - start.x) * size.width / zone.w);
    const proposedY = Math.round(original.yMm + (point.y - start.y) * size.depth / zone.h);
    item.xMm = Math.max(0, Math.min(size.width - item.widthMm, proposedX));
    item.yMm = Math.max(0, Math.min(size.depth - item.depthMm, proposedY));
    $('#furnitureEditStatus').textContent = proposedX !== item.xMm || proposedY !== item.yMm
      ? '已限制在当前房间边界内；请确认图纸标注是否准确。'
      : furnitureOverlaps(item) ? '红框提示：当前家具占位重叠，请调整。' : `正在调整 ${item.label}。`;
    drawPlan(); return;
  }
  if (aiZoneDrag) { updateAiZoneDrag(pointOnPlan(event)); drawPlan(); return; }
  if (appliedZoneDrag) { updateAppliedZoneDrag(pointOnPlan(event)); drawPlan(); return; }
  if (!drawMode && furnitureEditMode) {
    planCanvas.style.cursor = furnitureHit(pointOnPlan(event)) ? 'grab' : '';
    return;
  }
  if (!drawing && !drawMode) {
    const hit = draftHit(pointOnPlan(event)) || appliedZoneHit(pointOnPlan(event));
    planCanvas.style.cursor = hit?.mode === 'move' ? 'move' :
      hit?.corner === 'nw' || hit?.corner === 'se' ? 'nwse-resize' : hit ? 'nesw-resize' : '';
  }
  if (!drawing) return;
  drawing.end = pointOnPlan(event); drawPlan();
});
planCanvas.addEventListener('pointerup', event => {
  if (furnitureDrag) {
    const { item } = furnitureDrag;
    const zone = currentSite()?.zones?.find(value => value.id === item.zoneId);
    const size = zoneDrawingSize(zone);
    if (zone && size) {
      const overrides = current().placementOverrides || (current().placementOverrides = {});
      overrides[item.instanceId] = { zoneId: zone.id,
        xRatio: size.width === item.widthMm ? 0 : item.xMm / (size.width - item.widthMm),
        yRatio: size.depth === item.depthMm ? 0 : item.yMm / (size.depth - item.depthMm) };
      delete (current().placementReviews || {})[item.instanceId];
      persist();
    }
    furnitureDrag = null;
    invalidateConcept();
    const conflicts = fitScreen?.findings?.filter(finding => finding.code === 'furniture_overlap').length || 0;
    $('#furnitureEditStatus').textContent = conflicts ? `位置已保存；发现 ${conflicts} 处家具重叠，红框处需调整。` : '位置已保存；仍需核对尺寸、门窗和通行净空。';
    planCanvas.style.cursor = 'grab';
    return;
  }
  if (aiZoneDrag) {
    updateAiZoneDrag(pointOnPlan(event));
    const zone = aiZoneDraft?.suggestions[aiZoneDrag.index], original = aiZoneDrag.original;
    if (zone && ['x', 'y', 'w', 'h'].some(field => zone[field] !== original[field])) {
      zone.boundsEdited = true; zone.boundaryConfirmed = false;
      zone.confirmSize = false; zone.labelText = '';
      aiZoneDraft.segmentationPreview = null;
      refreshDraftGeometry();
      $('#aiZoneStatus').textContent = '边界已调整；请重新核对并确认图示尺寸，再应用区域。';
      renderAiZoneAssist();
    }
    aiZoneDrag = null; drawPlan(); return;
  }
  if (appliedZoneDrag) {
    updateAppliedZoneDrag(pointOnPlan(event));
    const zone = currentSite()?.zones?.[appliedZoneDrag.index], original = appliedZoneDrag.original;
    if (zone && ['x', 'y', 'w', 'h'].some(field => zone[field] !== original[field])) {
      zone.reviewStatus = 'draft'; zone.previewSafe = false;
      delete zone.labelText;
      if (original.visualSizeMm) zone.visualSizeMm = {
        width: Math.max(100, Math.min(100000, Math.round(original.visualSizeMm.width * zone.w / original.w))),
        depth: Math.max(100, Math.min(100000, Math.round(original.visualSizeMm.depth * zone.h / original.h))),
      };
      for (const project of Object.values(projects)) if (project.apartmentType === current().apartmentType)
        project.placementReviews = {};
      invalidateConcept(); persist(); renderPlan(); renderSummary();
      $('#message').textContent = `${zoneDisplayName(zone)}边界已调整，重新列为待核对；家具暂不绘制。`;
    }
    appliedZoneDrag = null; drawPlan(); return;
  }
  if (!drawing) return;
  drawing.end = pointOnPlan(event);
  const zone = { id: `room-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, kind: drawing.kind,
    x: Math.min(drawing.start.x, drawing.end.x), y: Math.min(drawing.start.y, drawing.end.y),
    w: Math.abs(drawing.end.x - drawing.start.x), h: Math.abs(drawing.end.y - drawing.start.y) };
  drawing = null;
  if (zone.w >= 15 && zone.h >= 15) {
    currentSite().zones.push(zone); applyCalibratedZoneDimensions(currentSite());
    invalidateConcept(); persist(); renderPlan(); renderSummary();
  } else drawPlan();
});
planCanvas.addEventListener('pointercancel', () => {
  if (furnitureDrag) {
    Object.assign(furnitureDrag.item, furnitureDrag.original);
    furnitureDrag = null; drawPlan();
  }
  if (aiZoneDrag && aiZoneDraft?.suggestions[aiZoneDrag.index]) {
    Object.assign(aiZoneDraft.suggestions[aiZoneDrag.index], aiZoneDrag.original);
    aiZoneDrag = null; drawPlan();
  }
  if (appliedZoneDrag && currentSite()?.zones?.[appliedZoneDrag.index]) {
    const zone = currentSite().zones[appliedZoneDrag.index];
    Object.assign(zone, appliedZoneDrag.original);
    appliedZoneDrag = null; drawPlan();
  }
  drawing = null;
});

$('#apartmentType').addEventListener('change', event => {
  const type = event.target.value;
  const matching = availablePackages(type);
  if (!matching.length) return;
  if (!matching.some(item => item.id === active)) active = matching[0].id;
  current().apartmentType = type;
  current().zoneAssignments = {};
  furnitureEditMode = false; drawMode = null; drawing = null; calibrationPoints = [];
  persist(); render();
});
$('#packageId').addEventListener('change', event => { active = event.target.value; furnitureEditMode = false; drawMode = null; drawing = null; calibrationPoints = []; persist(); render(); });
$('#generateConcept').addEventListener('click', () => {
  current().conceptPreviewEnabled = current().conceptPreviewEnabled !== true;
  if (!current().conceptPreviewEnabled) furnitureEditMode = false;
  persist(); invalidateConcept();
  renderPlan();
  $('#message').textContent = current().conceptPreviewEnabled ? '家具俯视示意已生成；下方可放大查看，不代表实际适配。' : '概念占位已隐藏。';
});
$('#adjustFurniture').addEventListener('click', () => {
  if (!conceptLayout?.placedCount) return;
  furnitureEditMode = !furnitureEditMode;
  drawMode = null; drawing = null; calibrationPoints = [];
  $('#furnitureEditStatus').textContent = furnitureEditMode
    ? '调整模式已开启：拖动图上的蓝色家具；固定区域不能摆放。' : '已退出调整模式。';
  renderPlan();
  if (furnitureEditMode) $('#planView').scrollIntoView({ behavior: 'smooth', block: 'center' });
});
$('#jumpFurnitureEdit').addEventListener('click', () => {
  if (!furnitureEditMode) $('#adjustFurniture').click();
  else $('#planView').scrollIntoView({ behavior: 'smooth', block: 'center' });
});
$('#resetFurniturePositions').addEventListener('click', () => {
  if (!Object.keys(current().placementOverrides || {}).length) return;
  current().placementOverrides = {};
  current().placementReviews = {};
  persist(); invalidateConcept();
  $('#furnitureEditStatus').textContent = '已恢复系统自动占位；房间标注和商品资料未改动。';
});
$('#reviewGate').addEventListener('click', event => {
  if (event.target.closest('[data-jump-zone-review]')) {
    $('#zoneList').scrollIntoView({ behavior: 'smooth', block: 'center' }); return;
  }
  const confirm = event.target.closest('[data-review-confirm]');
  const undo = event.target.closest('[data-review-undo]');
  const id = confirm?.dataset.reviewConfirm || undo?.dataset.reviewUndo;
  if (!id || !reviewGate) return;
  const row = reviewGate.rows.find(item => item.instanceId === id);
  if (!row || (confirm && !row.reviewable) || (undo && row.status !== 'position_reviewed')) return;
  const reviews = current().placementReviews || (current().placementReviews = {});
  if (confirm) reviews[id] = { fingerprint: row.fingerprint, reviewedAt: new Date().toISOString() };
  else delete reviews[id];
  persist(); renderReviewGate();
});
$('#nextStepAction').addEventListener('click', event => {
  const action = event.currentTarget.dataset.action;
  if (action === 'demoPicker') $('#demoPlanPicker').scrollIntoView({ behavior: 'smooth', block: 'start' });
  else if (action === 'upload') $('#planFile').click();
  else if (action === 'overview') {
    $('#planOverview').scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('#overviewPin').focus({ preventScroll: true });
  }
  else if (action === 'reviewZones') (aiZoneDraft ? $('#planView') : $('#zoneList'))
    .scrollIntoView({ behavior: 'smooth', block: 'center' });
  else if (action === 'auto') {
    $('#quickGenerate').scrollIntoView({ behavior: 'smooth', block: 'center' });
    if ($('#quickPlanPin').value) $('#generateFurnishedDraft').click();
    else $('#quickPlanPin').focus({ preventScroll: true });
  }
  else if (action === 'suggest') $('#aiZoneAssist').scrollIntoView({ behavior: 'smooth', block: 'center' });
  else if (action === 'dimensions') {
    ($('#aiDimensions').hidden ? $('#knownDistance') : $('#aiDimensions'))
      .scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  else if (action === 'calibrate') {
    $('#knownDistance').scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('#knownDistance').focus({ preventScroll: true });
  } else if (action === 'demo') loadMockProducts(true);
  else if (action === 'preview' || action === 'inspect') {
    if (action === 'preview') {
      current().conceptPreviewEnabled = true; persist(); invalidateConcept();
    }
    (conceptLayout?.placedCount ? $('#demoResult') : $('#conceptReport'))
      .scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
});
$('#roomSelect').addEventListener('change', drawRoomPreview);
$('#downloadFurnishedDraft').addEventListener('click', () => {
  if (!conceptLayout?.placedCount || currentSite()?.source?.kind !== 'image') return;
  drawPlan();
  const canvas = document.createElement('canvas');
  canvas.width = planCanvas.width; canvas.height = planCanvas.height;
  const context = canvas.getContext('2d');
  context.drawImage(planCanvas, 0, 0);
  const height = Math.max(34, Math.round(canvas.height * .055));
  context.fillStyle = '#17202add'; context.fillRect(0, canvas.height - height, canvas.width, height);
  context.fillStyle = '#fff'; context.font = `bold ${Math.max(12, Math.round(height * .36))}px system-ui`;
  context.fillText('家具平面初稿 · 自动识别及商品尺寸待复核 · 不可直接采购安装', 10, canvas.height - height / 3,
    canvas.width - 20);
  const link = document.createElement('a');
  link.href = canvas.toDataURL('image/png');
  link.download = `home-${active}-furnished-draft.png`;
  link.click();
});
$('#conceptAssignments').addEventListener('change', event => {
  const select = event.target.closest('select[data-assignment]');
  if (!select) return;
  const key = select.dataset.assignment;
  const allowed = new Set(assessHomePackage(current()).lines.filter(line => line.key !== 'queen_mattress')
    .flatMap(line => Array.from({ length: line.quantity }, (_, i) => `${line.key}:${i}`)));
  if (!allowed.has(key)) return;
  const validZone = (currentSite()?.zones || []).some(zone => zone.id === select.value &&
    ['living', 'dining', 'bedroom', 'mezzanine'].includes(zone.kind));
  const assignments = current().zoneAssignments || (current().zoneAssignments = {});
  if (select.value && validZone) assignments[key] = select.value;
  else delete assignments[key];
  const instanceId = key.replace(/:(\d+)$/, (_, number) => `-${Number(number) + 1}`);
  delete (current().placementOverrides || {})[instanceId];
  delete (current().placementReviews || {})[instanceId];
  persist(); invalidateConcept();
});
function loadMockProducts(withSamplePlan = false) {
  const template = homePackage(active), samples = mockSkusForPackage(active);
  if (samples.length !== template.lines.length || template.lines.some(line => !samples.some(item => item.key === line.key))) {
    $('#message').textContent = '当前套餐的模拟 SKU 库不完整，未更改商品。'; return false;
  }
  const mockProducts = mockProductsForPackage(active);
  const hasProducts = Object.values(current().products || {}).some(product =>
    product && Object.values(product).some(value => value !== '' && value != null));
  const alreadyMock = hasProducts && template.lines.every(line =>
    JSON.stringify(current().products[line.key]) === JSON.stringify(mockProducts[line.key]));
  if (hasProducts && !alreadyMock && !confirm('用模拟 SKU 替换当前套餐已填写的商品？户型图和其他套餐不会改变。')) return false;
  if (withSamplePlan && !currentSite()?.source) sites[current().apartmentType] = createDemoSite(current().apartmentType);
  current().products = mockProducts;
  const canPreview = drawableZones().length > 0;
  if (canPreview) current().conceptPreviewEnabled = true;
  persist(); render();
  $('#message').textContent = `已载入 ${samples.length} 条模拟 SKU；${canPreview ? '家具示意已自动生成。' : '补齐户型房间尺寸后可看家具。'}模拟数据不代表真实商品或报价。`;
  if (canPreview && conceptLayout?.placedCount) $('#demoResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
  return true;
}
$('#loadMockSkus').addEventListener('click', () => loadMockProducts());
$('#toggleDetails').addEventListener('click', () => {
  showDetails = !showDetails;
  $('#packageLines').classList.toggle('show-details', showDetails);
  $('#toggleDetails').textContent = showDetails ? '收起采购详情' : '展开 SKU / 价格来源';
  $('#toggleDetails').setAttribute('aria-expanded', String(showDetails));
});
$('#packageLines').addEventListener('input', event => {
  const field = event.target.dataset.field, key = event.target.closest('[data-key]')?.dataset.key;
  if (!key || !['name', 'sku', 'source', 'unitPrice', 'widthMm', 'depthMm'].includes(field)) return;
  const products = current().products, product = products[key] || (products[key] = {});
  if (field === 'widthMm' || field === 'depthMm') {
    const dimensions = { ...(product.dimensionsMm || {}) };
    dimensions[field === 'widthMm' ? 'width' : 'depth'] = event.target.value === '' ? null : Number(event.target.value);
    product.dimensionsMm = dimensions;
  } else product[field] = event.target.value;
  invalidateConcept();
  persist(); renderSummary();
  if (field === 'unitPrice') {
    const line = assessHomePackage(current()).lines.find(item => item.key === key);
    event.target.closest('.product').querySelector('.line-total b').textContent = line.estimateLineTotal === null ? '待填' : money(line.estimateLineTotal);
  }
});
$('#exportProject').addEventListener('click', () => download(`home-${active}-project.json`, { ...current(), site: currentSite() }));
$('#exportList').addEventListener('click', () => {
  const result = assessHomePackage(current());
  download(`home-${active}-review-list.json`, { projectType: 'home', packageId: active, apartmentType: current().apartmentType,
    budget: current().budget, floorPlanStatus: siteState(), fitStatus: result.fitStatus, budgetStatus: result.budgetStatus,
    subtotal: result.subtotal, priceBudgetStatus: result.priceBudgetStatus, priceSubtotal: result.priceSubtotal,
    simulatedCount: result.simulatedCount,
    conceptOccupancy: conceptLayout ? { fitStatus: conceptLayout.fitStatus, placedCount: conceptLayout.placedCount,
      pendingCount: conceptLayout.pendingCount, pairedMattresses: conceptLayout.pairedMattresses,
      placements: conceptLayout.placements, issues: conceptLayout.issues } : null,
    outlineScreen: fitScreen,
    deliveryGate: reviewGate,
    lines: result.lines, note: '按单价计算的金额仅为预算草算；未经户型适配、SKU/来源核对和正式报价复核。' });
});
$('#importProject').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', async event => {
  const file = event.target.files?.[0]; if (!file) return;
  try {
    const incoming = JSON.parse(await file.text());
    if (!incoming || !incoming.products || typeof incoming.products !== 'object' || Array.isArray(incoming.products)) throw new Error('文件缺少商品资料');
    assessHomePackage(incoming);
    const allowed = new Set(homePackage(incoming.packageId).lines.map(line => line.key));
    const products = Object.fromEntries(Object.entries(incoming.products).filter(([key]) => allowed.has(key)));
    const site = validImportedSite(incoming.site);
    projects[incoming.packageId] = { ...incoming, products,
      placementOverrides: cleanPlacementOverrides(incoming.placementOverrides),
      placementReviews: cleanPlacementReviews(incoming.placementReviews) };
    delete projects[incoming.packageId].site;
    if (site) sites[incoming.apartmentType] = site;
    else delete sites[incoming.apartmentType];
    active = incoming.packageId; furnitureEditMode = false; persist(); render();
    $('#message').textContent = '项目已导入。';
  } catch { $('#message').textContent = '无法导入：请使用本工具导出的家庭项目 JSON。'; }
  event.target.value = '';
});
$('#resetPackage').addEventListener('click', () => {
  if (!confirm('清空当前套餐填写的商品信息？已导出的项目文件不受影响。')) return;
  current().products = {}; current().conceptPreviewEnabled = false; current().placementReviews = {};
  persist(); render(); $('#message').textContent = '当前套餐商品已清空。';
});

renderMockCatalog();
render();
