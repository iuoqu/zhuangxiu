/* ============ 方案模型 ============
   一份方案（房间 + 工位带 + 拆了哪几间）能推出来的东西：工位在哪、房间坐几个人、
   要配哪些家具。全是纯函数，不碰 DOM、不读全局 —— 排布页（layout.html）、
   免注册的分享页（share.html）和白模搭建（massing.js）调的是同一份，
   所以三边算出来的工位数和家具清单必然一致。 */

// ---- 几何小工具
const area = r => ((r.x[1]-r.x[0]) * (r.y[1]-r.y[0]) / 1e6);
const hits = (a, b) => a.x[0] < b.x[1] && a.x[1] > b.x[0] && a.y[0] < b.y[1] && a.y[1] > b.y[0];
const mid = r => [(r.x[0]+r.x[1])/2, (r.y[0]+r.y[1])/2];

// ---- 工位带 → 一张张桌子
function seatsOf(d){
  const [w, h] = (d.size || [1400, 700]);
  const dir = d.dir || 'h';
  const out = [];
  const X0 = Math.min(...d.x), X1 = Math.max(...d.x), Y0 = Math.min(...d.y), Y1 = Math.max(...d.y);
  // 带够深就背靠背两排一组（组间留座椅＋通行 1800）；只有一张桌深就铺单排 ——
  // 甲方图里靠墙、靠茶水台那两条就是单排，按双排算会少数 8 个工位。
  // face = 椅子在桌子的哪一侧（人坐这边）。背靠背两排：前排椅子朝外，后排也朝外，
  // 屏风夹在中间。单排带的朝向由 d.face 定 —— 靠墙那条，人得背对墙坐。
  if (dir === 'h'){
    const one = (Y1 - Y0) < h * 2 - 50;
    const pitch = one ? h + 1800 : h * 2 + 1800;
    for (let y = Y0; y + (one ? h : h * 2) <= Y1 + 50; y += pitch)
      for (let x = X0; x + w <= X1 + 50; x += w){
        out.push({x:[x, x+w], y:[y, y+h], face: one ? (d.face || 'N') : 'N'});
        if (!one) out.push({x:[x, x+w], y:[y+h, y+h*2], face:'S'});
      }
  } else {
    const one = (X1 - X0) < h * 2 - 50;
    const pitch = one ? h + 1800 : h * 2 + 1800;
    for (let x = X0; x + (one ? h : h * 2) <= X1 + 50; x += pitch)
      for (let y = Y0; y + w <= Y1 + 50; y += w){
        out.push({x:[x, x+h], y:[y, y+w], face: one ? (d.face || 'W') : 'W'});
        if (!one) out.push({x:[x+h, x+h*2], y:[y, y+w], face:'E'});
      }
  }
  return out;
}
const isSingle = d => { const [w, h] = (d.size || [1400,700]);
  return ((d.dir||'h') === 'h' ? d.y[1]-d.y[0] : d.x[1]-d.x[0]) < h * 2 - 50; };

// ---- 会议桌、洽谈桌的尺寸规则
const RULE = { end: 1200, side: 1200, per: 750, chair: 1800, trail: 900, head: 1200, light: 6000 };

function tableFor(n){                      // n 人 → [桌长, 桌宽]
  if (n <= 0) return null;
  if (n <= 6) return [n <= 4 ? 1200 : 1400, n <= 4 ? 1200 : 1400];   // 小洽谈：方桌／圆桌
  const perSide = Math.max(1, Math.ceil((n - 2) / 2));
  return [perSide * RULE.per, n >= 13 ? 1800 : 1500];
}
function roomFor(n){                       // n 人 → [房间长, 房间宽]
  const t = tableFor(n);
  if (!t) return null;
  // 小洽谈不必绕着桌子走一圈，净距 750 就够；长条会议桌要留 1200 才推得开椅子。
  // 对图：4 人洽谈 → 2700×2700 = 7.3 ㎡，图上标 7 SQM ✓
  const c = n <= 6 ? 750 : RULE.end;
  return [t[0] + c * 2, t[1] + (n <= 6 ? c : RULE.side) * 2];
}
function seatsIn(r){                       // 反过来：这间房能坐几人
  const L = Math.max(r.x[1]-r.x[0], r.y[1]-r.y[0]) - RULE.end * 2;
  const W = Math.min(r.x[1]-r.x[0], r.y[1]-r.y[0]) - RULE.side * 2;
  if (L < RULE.per || W < 1200) return 0;
  return Math.floor(L / RULE.per) * 2 + 2;
}

/** 一间房配多大桌子、坐几个人 —— 按房间实际尺寸倒推，不是按生成时的 roomFor。
 *  roomFor 答的是「要留多大才舒服」，这里答的是「已经这么大了，坐得下几个」；
 *  甲方自己画的 7.5 ㎡ 洽谈室属于后者，用 roomFor 去套会判成「摆不下桌子」。
 *  正式会议室四周留 1200（椅子推开还要能过人），洽谈按 700（不绕着桌子走一圈）。
 *  每人 750 宽，和生成器里的 RULE.per 同一个数 —— 所以大／小会议室的人数跟 seatsIn 对得上。 */
function fitTable(r, formal){
  const RL = Math.max(r.x[1]-r.x[0], r.y[1]-r.y[0]);
  const RW = Math.min(r.x[1]-r.x[0], r.y[1]-r.y[0]);
  const c = formal ? RULE.end : 700;
  const tl = Math.min(RL - c * 2, 6000);       // 桌长封顶 6 m，再长该分两张
  const tw = Math.min(RW - c * 2, 1800);       // 桌宽封顶 1.8 m，够两边对坐
  if (tl < 1000 || tw < 700) return null;
  let n = Math.floor(tl / RULE.per) * 2;       // 两条长边
  if (tw >= 1200) n += 2;                      // 桌子够深，两头各加一把
  if (n < 2) return null;
  const R50 = v => Math.round(v / 50) * 50;
  return {n, t: [R50(tl), R50(tw)]};
}

// ---- 家具清单
const TIER = ['经济', '主流', '进口'];
// 单价：经济 / 主流 / 进口（占位）。带 per 的按「底价 + 每人 × 人数」算 ——
// 不然 6 米的大会议桌和 2.45 米的小会议桌会是同一个价。
const CAT = {
  desk:   {n:'办公桌',     u:'张',   p:[150,   380,   820]},
  dchair: {n:'办公椅',     u:'把',   p:[110,   320,   850]},
  screen: {n:'桌面屏风',   u:'块',   p:[85,    190,   400]},
  mtable: {n:'会议桌',     u:'张',   p:[280,   720,  1900], per:[42, 110, 290]},
  mchair: {n:'会议椅',     u:'把',   p:[90,    240,   620]},
  tv:     {n:'会议显示屏', u:'台',   p:[450,   900,  1900]},
  ttable: {n:'洽谈桌',     u:'张',   p:[140,   340,   820], per:[28,  70, 170]},
  tchair: {n:'洽谈椅',     u:'把',   p:[85,    210,   520]},
  bar:    {n:'茶水吧台',   u:'延米', p:[320,   700,  1500]},
  stool:  {n:'吧椅',       u:'把',   p:[70,    170,   420]},
  locker: {n:'储物柜',     u:'延米', p:[180,   420,   900]},
  booth:  {n:'电话亭',     u:'个',   p:[2800, 5200, 11000]},
  recep:  {n:'前台',       u:'组',   p:[900,  2200,  5500]},
  sofa:   {n:'沙发茶几组', u:'套',   p:[700,  1800,  4500]},
  mgr:    {n:'主管桌',     u:'张',   p:[520,  1200,  3000]},
};

/** 方案 → 家具清单。note 里是算不出来、得手工补的。
 *  不碰页面，也不读全局 —— 排布页、分享页、以后的后台都调这一个。 */
function bomOf(BASE, SCH){
  const gone = n => (SCH.demolish || []).includes(n);
  const items = [], note = [];
  const put = (c, spec, qty, drv) => {
    if (!(qty > 0)) return;
    const hit = items.find(e => e.c === c && e.spec === spec);
    if (hit) hit.qty += qty; else items.push({c, spec, qty, drv: drv || 0});
  };

  for (const d of SCH.desks){
    const [w, h] = d.size || [1400, 700];
    const st = seatsOf(d);
    put('desk', `${w}×${h}`, st.length);
    put('dchair', '任务椅', st.length);
    // 屏风按白模数：facing 朝 N / W 的桌子背后装一块，长度＝桌长。背靠背一对只有一块。
    put('screen', `${w}×450`, st.filter(s => s.face === 'N' || s.face === 'W').length);
  }

  for (const r of SCH.rooms){
    const L = Math.max(r.x[1]-r.x[0], r.y[1]-r.y[0]);
    const S = Math.min(r.x[1]-r.x[0], r.y[1]-r.y[0]);
    const lin = Math.max(0, L - 600) / 1000;     // 白模里吧台／柜子就是长边减 600
    if (/会议/.test(r.n)){
      const f = fitTable(r, true);
      if (!f){ note.push(`${r.n} ${L}×${S} 摆不下会议桌，没进清单`); continue; }
      put('mtable', `${f.t[0]}×${f.t[1]} · ${f.n} 人`, 1, f.n);
      put('mchair', '会议椅', f.n);
      put('tv', f.t[0] >= 4000 ? '75″' : f.t[0] >= 2500 ? '65″' : '55″', 1);
    } else if (/洽谈/.test(r.n)){
      const f = fitTable(r, false);
      if (!f){ note.push(`${r.n} ${L}×${S} 摆不下洽谈桌，没进清单`); continue; }
      put('ttable', `${f.t[0]}×${f.t[1]} · ${f.n} 人`, 1, f.n);
      put('tchair', '洽谈椅', f.n);
    } else if (/茶水/.test(r.n)){
      put('bar', `长 ${Math.round(lin * 1000)}`, lin);
      put('stool', '吧椅', Math.max(2, Math.min(8, Math.round(lin))));
    } else if (/打印|储物/.test(r.n)){
      put('locker', `长 ${Math.round(lin * 1000)}`, lin);
    } else if (/电话亭/.test(r.n)){
      put('booth', `${L}×${S}`, 1);
    } else if (/前台/.test(r.n)){
      put('recep', `${L}×${S}`, 1); put('dchair', '任务椅', 1);
    } else if (/协作/.test(r.n)){
      put('sofa', `${L}×${S}`, 1);
    } else if (/经理/.test(r.n)){
      put('mgr', '1600×800', 1); put('dchair', '任务椅', 1); put('tchair', '访客椅', 2);
    } else {
      note.push(`${r.n} 还没对应家具，要手工补`);
    }
  }

  // 没拆掉的底板房间也得配家具 —— 茶水间／备餐间留着就要吧台和吧椅。
  // 电梯、楼梯、厕所、客房、电井这些不配。方案自己又画了同名房间的，以方案的为准，不重复算。
  const own = new Set(SCH.rooms.map(r => r.n));
  for (const r of BASE.rooms){
    if (gone(r.n) || own.has(r.n)) continue;
    const L = Math.max(r.x[1]-r.x[0], r.y[1]-r.y[0]);
    const lin = Math.max(0, L - 600) / 1000;
    if (/茶水|备餐/.test(r.n)){
      put('bar', `长 ${Math.round(lin * 1000)}`, lin);
      // 备餐间是出餐用的，只要台面，没人坐在那儿
      if (/茶水/.test(r.n)) put('stool', '吧椅', Math.max(2, Math.min(8, Math.round(lin))));
    } else if (/打印|储物/.test(r.n)){
      put('locker', `长 ${Math.round(lin * 1000)}`, lin);
    }
  }
  return {items, note};
}
