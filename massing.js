/* ============ 浏览器里现搭白模 ============
   Blender 那条路（分析/render.py → models/model_<id>_clay.json）出来的模型更细：
   有 AO、有窗外配景、有灯具和机电、椅子有扶手和五星脚。但它要跑 Blender，
   方案一改就得重跑一遍 —— 分享链接等不起，中介在浏览器里排完就要发出去。

   这里按同一套尺寸在浏览器里现搭一份，一两百毫秒。体块格式和 render.py --export
   完全一样（['b', 材质, x,y,z, dx,dy,dz] 和 ['c', 材质, cx,cy,z, r,h]），
   所以 viewer.js 一行都不用改，有 Blender 那份就优先用那份。

   和 Blender 那份的差别（分享页上写明了）：没有 AO、窗外是空的、灯具和机电没建、
   门只留洞不建门扇、椅子简化成四块。房间和桌椅的位置尺寸走的是 scheme.js
   同一份数据，所以不会漂 —— 分享页上看到几个工位，排布页上就是几个。 */

const H_CEIL = 3000, H_DOOR = 2700, H_SOFFIT = 4280, MWALL = 100, KWALL = 150;

function massing(BASE, SCH){
  const it = [];
  const box = (m, x, y, z, dx, dy, dz) => {
    if (dx > 0.5 && dy > 0.5 && dz > 0.5) it.push(['b', m, x, y, z, dx, dy, dz]);
  };
  const cyl = (m, cx, cy, z, r, h) => it.push(['c', m, cx, cy, z, r, h]);
  const gone = n => (SCH.demolish || []).includes(n);
  const S = BASE.shell, G = BASE.glazing;

  // ---- 楼板、吊顶
  box('floor_grey', S.x0, S.y0, -120, S.x1 - S.x0, S.y1 - S.y0, 120);
  box('ceiling',    S.x0, S.y0, H_CEIL, S.x1 - S.x0, S.y1 - S.y0, 120);

  // ---- 外围：玻璃段之间补墙；玻璃两端各一根竖挺，中间每 4050 一根
  const facade = (horiz, pos, runs, lo, hi, t = 250) => {
    const cuts = []; let p = lo;
    for (const [a, b] of runs){ if (a > p) cuts.push([p, a, false]); cuts.push([a, b, true]); p = b; }
    if (p < hi) cuts.push([p, hi, false]);
    for (const [a, b, g] of cuts){
      if (!g){ horiz ? box('wall', a, pos, 0, b - a, t, H_CEIL)
                     : box('wall', pos, a, 0, t, b - a, H_CEIL); continue; }
      const n = Math.max(1, Math.round((b - a) / 4050));
      if (horiz){
        box('glass', a, pos + 100, 0, b - a, 40, H_CEIL);
        for (const u of [a, b]) box('mullion', u - 30, pos, 0, 60, t, H_SOFFIT);
        for (let i = 1; i < n; i++) box('mullion', a + (b - a) * i / n - 25, pos, 0, 50, t, H_SOFFIT);
        box('mullion', a, pos, H_CEIL - 40, b - a, t, 40);
      } else {
        box('glass', pos + 100, a, 0, 40, b - a, H_CEIL);
        for (const u of [a, b]) box('mullion', pos, u - 30, 0, t, 60, H_SOFFIT);
        for (let i = 1; i < n; i++) box('mullion', pos, a + (b - a) * i / n - 25, 0, t, 50, H_SOFFIT);
        box('mullion', pos, a, H_CEIL - 40, t, b - a, 40);
      }
    }
  };
  // 外墙定位跟 render.py shell() 同一组数：北 101、南 20900、西 51，厚 250
  facade(true,  101,   G.north, S.x0, S.x1);
  facade(true,  20900, G.south, S.x0, S.x1);
  facade(false, 51,    G.west,  S.y0, S.y1);
  box('wall', 27650, S.y0, 0, 250, S.y1 - S.y0, H_CEIL);      // 东侧核心筒外墙

  for (const c of BASE.columns) box('column', c.x, c.y, 0, c.w, c.d, H_CEIL);

  // ---- 保留下来的底板房间：四面实墙。拆掉的那几间不建。
  const kept = BASE.rooms.filter(r => !gone(r.n)).concat(BASE.entry ? [BASE.entry] : []);
  for (const r of kept){
    const [x0, x1] = r.x, [y0, y1] = r.y;
    box('wall', x0, y0, 0, x1 - x0, KWALL, H_CEIL);
    box('wall', x0, y1 - KWALL, 0, x1 - x0, KWALL, H_CEIL);
    box('wall', x0, y0, 0, KWALL, y1 - y0, H_CEIL);
    box('wall', x1 - KWALL, y0, 0, KWALL, y1 - y0, H_CEIL);
  }

  // ---- 手钉的走廊：地面换个灰，读图时看得出来是通道
  for (const h of (SCH.halls || []))
    box('floor_grey', h.x[0], h.y[0], 0, h.x[1] - h.x[0], h.y[1] - h.y[0], 8);

  // ---- 方案自己画的房间：开门那一侧做玻璃隔断，其余三面实墙
  const fx = (S.x0 + S.x1) / 2, fy = (S.y0 + S.y1) / 2;
  for (const r of (SCH.rooms || [])){
    const [x0, x1] = r.x, [y0, y1] = r.y;
    box('carpet', x0 + MWALL, y0 + MWALL, 0, x1 - x0 - 2*MWALL, y1 - y0 - 2*MWALL, 8);
    // 门开在朝楼层中心那一侧 —— 进出一定是往中间走。Blender 那份是逐间判的，
    // 这里图快，判错了在图上一眼能看出来。
    const dx = (x0 + x1) / 2 - fx, dy = (y0 + y1) / 2 - fy;
    const door = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'W' : 'E') : (dy > 0 ? 'N' : 'S');
    const D = 900;
    for (const s of ['N', 'S', 'W', 'E']){
      const horiz = s === 'N' || s === 'S';
      const ax = s === 'E' ? x1 - MWALL : x0, ay = s === 'S' ? y1 - MWALL : y0;
      const aw = horiz ? x1 - x0 : MWALL,     ah = horiz ? MWALL : y1 - y0;
      if (s !== door){ box('wall', ax, ay, 0, aw, ah, H_CEIL); continue; }
      const lo = horiz ? ax : ay, hi = horiz ? ax + aw : ay + ah;
      const d0 = (lo + hi) / 2 - D / 2;
      for (const [a, b] of [[lo, d0], [d0 + D, hi]]){
        if (b - a <= 1) continue;
        if (horiz){
          box('wall',  a, ay, 0, b - a, ah, 100);
          box('glass', a + 40, ay + 40, 100, b - a - 80, 20, H_CEIL - 100);
          for (const u of [a, b - 60]) box('mullion', u, ay, 0, 60, ah, H_CEIL);
        } else {
          box('wall',  ax, a, 0, aw, b - a, 100);
          box('glass', ax + 40, a + 40, 100, 20, b - a - 80, H_CEIL - 100);
          for (const u of [a, b - 60]) box('mullion', ax, u, 0, aw, 60, H_CEIL);
        }
      }
      if (horiz) box('glass', d0 + 40, ay + 40, H_DOOR, D - 80, 20, H_CEIL - H_DOOR);
      else       box('glass', ax + 40, d0 + 40, H_DOOR, 20, D - 80, H_CEIL - H_DOOR);
    }
  }

  // ---- 椅子：座 + 背 + 气杆 + 底盘。Blender 那份还有扶手和五星脚，这里省掉 ——
  // 五十几把椅子每把多十几块体块，浏览器现画会拖慢一截，读图又看不出差别。
  const chair = (cx, cy, face) => {
    const b = {N:[0,1], S:[0,-1], W:[1,0], E:[-1,0]}[face];
    box('seat', cx - 240, cy - 240, 430, 480, 480, 60);
    if (b[1]) box('seat', cx - 205, cy + b[1]*230 - 30, 490, 410, 60, 520);
    else      box('seat', cx + b[0]*230 - 30, cy - 205, 490, 60, 410, 520);
    cyl('metal_dk', cx, cy, 60, 35, 370);
    cyl('metal_dk', cx, cy, 20, 250, 40);
  };

  // ---- 工位：桌面 + 两块侧板 + 屏风 + 椅子
  for (const d of (SCH.desks || [])){
    for (const s of seatsOf(d)){
      const x = s.x[0], y = s.y[0], dw = s.x[1] - s.x[0], dd = s.y[1] - s.y[0];
      box('desk_top', x, y, 720, dw, dd, 30);
      box('desk_leg', x + 60, y + 60, 0, 50, dd - 120, 720);
      box('desk_leg', x + dw - 110, y + 60, 0, 50, dd - 120, 720);
      // 屏风装在离椅子远的那一侧，背靠背一对只装一块 —— 和清单里的块数是同一个判断
      if (s.face === 'N') box('screen', x, y + dd - 30, 750, dw, 60, 450);
      if (s.face === 'W') box('screen', x + dw - 30, y, 750, 60, dd, 450);
      const c = {N:[x + dw/2, y - 620], S:[x + dw/2, y + dd + 620],
                 W:[x - 620, y + dd/2], E:[x + dw + 620, y + dd/2]}[s.face];
      chair(c[0], c[1], {N:'S', S:'N', W:'E', E:'W'}[s.face]);
    }
  }

  // ---- 会议桌、洽谈桌：桌子多大、坐几个人，跟清单是同一个 fitTable
  const counter = (x0, y0, x1, y1, stools) => {
    const L = x1 - x0 - 600;
    box('counter', x0 + 300, y1 - MWALL - 700, 0, L, 600, 900);
    box('table',   x0 + 300, y1 - MWALL - 720, 900, L, 640, 40);
    for (let i = 0; i < stools; i++){
      const px = x0 + 300 + L * (i + 0.5) / stools;
      cyl('metal_dk', px, y1 - MWALL - 1300, 0, 180, 750);
      cyl('seat',     px, y1 - MWALL - 1300, 750, 190, 60);
    }
  };
  for (const r of (SCH.rooms || [])){
    const [x0, x1] = r.x, [y0, y1] = r.y, mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    if (/茶水/.test(r.n)){
      box('tile', x0 + MWALL, y0 + MWALL, 0, x1 - x0 - 2*MWALL, y1 - y0 - 2*MWALL, 9);
      counter(x0, y0, x1, y1, Math.max(2, Math.min(8, Math.round((x1 - x0 - 600) / 1000))));
      continue;
    }
    if (/打印|储物/.test(r.n)){ box('panel', x0 + 300, y0 + MWALL, 0, x1 - x0 - 600, 600, 1900); continue; }
    if (/电话亭/.test(r.n)){ box('panel', x0 + 200, y0 + 200, 0, x1 - x0 - 400, 400, 1200); continue; }
    if (/前台/.test(r.n)){ box('counter', x0 + 300, my - 350, 0, x1 - x0 - 600, 700, 1100); continue; }
    if (!/会议|洽谈/.test(r.n)) continue;
    const f = fitTable(r, /会议/.test(r.n));
    if (!f) continue;
    const along = (x1 - x0) >= (y1 - y0);          // 桌子顺着房间长边摆
    const TW = along ? f.t[0] : f.t[1], TD = along ? f.t[1] : f.t[0];
    box('table', mx - TW/2, my - TD/2, 730, TW, TD, 40);
    for (const ux of [mx - TW/2 + 150, mx + TW/2 - 250])
      box('table', ux, my - TD/2 + 200, 0, 100, TD - 400, 730);
    const ends = f.t[1] >= 1200 ? 2 : 0, per = (f.n - ends) / 2;
    for (let i = 0; i < per; i++){
      if (along){
        const px = mx - TW/2 + TW * (i + 0.5) / per;
        chair(px, my - TD/2 - 620, 'S'); chair(px, my + TD/2 + 620, 'N');
      } else {
        const py = my - TD/2 + TD * (i + 0.5) / per;
        chair(mx - TW/2 - 620, py, 'E'); chair(mx + TW/2 + 620, py, 'W');
      }
    }
    if (ends){
      if (along){ chair(mx - TW/2 - 620, my, 'E'); chair(mx + TW/2 + 620, my, 'W'); }
      else      { chair(mx, my - TD/2 - 620, 'S'); chair(mx, my + TD/2 + 620, 'N'); }
    }
    if (/会议/.test(r.n)){                                    // 挂在离门最远那面墙上
      const w = Math.min(2800, TW - 400);
      box('screen_tv', mx - w/2, y0 + MWALL + 60, 900, w, 20, w * 0.56);
    }
  }

  // ---- 没拆掉的茶水间／备餐间也要台面（清单里算了钱，白模里就得有东西）
  for (const r of kept){
    if (!/茶水|备餐/.test(r.n)) continue;
    const [x0, x1] = r.x, [y0, y1] = r.y;
    box('tile', x0 + KWALL, y0 + KWALL, 0, x1 - x0 - 2*KWALL, y1 - y0 - 2*KWALL, 9);
    counter(x0, y0, x1, y1, /茶水/.test(r.n)
      ? Math.max(2, Math.min(8, Math.round((x1 - x0 - 600) / 1000))) : 0);
  }
  return it;
}
