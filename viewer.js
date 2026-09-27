/* ============ 白模渲染核心 ============
   跟 分析/render.py 出的白模是同一份几何（models/*.json 由 render.py --export 导出）。
   这里只有「几何 → 像素」这一段，没有页面、没有门禁、没有提示词 ——
   AI 出图页（index.html）和免注册的方案分享页（share.html）共用同一份，
   两边看到的白模必须是同一个，不然分享出去的图和内部出图对不上。

   投影那处的符号曾经反过，整个白模是左右镜像的；拿七个已知点对 Blender 的
   world_to_camera_view 逐点验过才改对，别再动 basis() 里 r 的符号。 */

const CLAY_GREY = {
  ceiling:.93, wall:.86, column:.78, floor_wood:.60, floor_grey:.60, carpet:.52, tile:.64,
  desk_top:.78, desk_leg:.84, screen:.68, seat:.50, metal_dk:.40, table:.80, counter:.60,
  panel:.68, screen_tv:.26, frame:.50, mullion:.36, cove:.97, ground:.34, city:.58, glass:.90,
};

const FDEF = [
  [[0,0,1],[1,0,1],[1,1,1],[0,1,1], 0,0,1], [[0,0,0],[0,1,0],[1,1,0],[1,0,0], 0,0,-1],
  [[0,0,0],[1,0,0],[1,0,1],[0,0,1], 0,-1,0], [[1,0,0],[1,1,0],[1,1,1],[1,0,1], 1,0,0],
  [[1,1,0],[0,1,0],[0,1,1],[1,1,1], 0,1,0], [[0,1,0],[0,0,0],[0,0,1],[0,1,1], -1,0,0],
];

const LIGHT = (() => { const l=[-0.38,-0.55,0.74], n=Math.hypot(...l); return l.map(v=>v/n); })();

function buildFaces(items){
  const out = [];
  let idx = 0;
  const push = (p, n, k) => out.push({ p, n, k, i: idx });
  for (const it of items){
    const k = it[1];
    idx++;
    if (k === 'ground' || k === 'city') continue;          // 窗外配景，取景时只添乱
    if (it[0] === 'b'){
      const [, , x, y, z, dx, dy, dz] = it;
      for (const f of FDEF){
        const p = [];
        for (let i=0;i<4;i++){ const c=f[i]; p.push([c[0]?x+dx:x, c[1]?y+dy:y, c[2]?z+dz:z]); }
        push(p, [f[4],f[5],f[6]], k);
      }
    } else {                                                // 圆柱 → 十二棱柱
      const [, , cx, cy, z, r, h] = it, N = 12, ring = [];
      for (let i=0;i<N;i++){ const a=2*Math.PI*i/N; ring.push([cx+r*Math.cos(a), cy+r*Math.sin(a)]); }
      for (let i=0;i<N;i++){
        const a=ring[i], b=ring[(i+1)%N];
        const nx=(a[0]+b[0])/2-cx, ny=(a[1]+b[1])/2-cy, nl=Math.hypot(nx,ny)||1;
        push([[a[0],a[1],z],[b[0],b[1],z],[b[0],b[1],z+h],[a[0],a[1],z+h]], [nx/nl,ny/nl,0], k);
      }
      push(ring.map(q=>[q[0],q[1],z+h]), [0,0,1], k);
      push(ring.slice().reverse().map(q=>[q[0],q[1],z]), [0,0,-1], k);
    }
  }
  return out;
}

function camFrom(v){
  const d=[v.at[0]-v.eye[0], v.at[1]-v.eye[1], v.at[2]-v.eye[2]];
  return { x:v.eye[0], y:v.eye[1], z:v.eye[2],
           yaw:Math.atan2(d[1],d[0]), pitch:Math.asin(d[2]/Math.hypot(...d)), lens:v.lens };
}

// r＝画面右方向。之前这里符号反了，整个白模是左右镜像的 —— 拿七个已知点对
// Blender 的 world_to_camera_view 逐点验过，现在两边像素级重合。
function basis(c){
  const cp=Math.cos(c.pitch), f=[Math.cos(c.yaw)*cp, Math.sin(c.yaw)*cp, Math.sin(c.pitch)];
  const r=[-Math.sin(c.yaw), Math.cos(c.yaw), 0];
  const u=[f[1]*r[2]-f[2]*r[1], f[2]*r[0]-f[0]*r[2], f[0]*r[1]-f[1]*r[0]];
  return { f, r, u };
}

function clipNear(pts, near){
  const out=[];
  for (let i=0;i<pts.length;i++){
    const a=pts[i], b=pts[(i+1)%pts.length], ai=a[2]>=near, bi=b[2]>=near;
    if (ai) out.push(a);
    if (ai!==bi){ const t=(near-a[2])/(b[2]-a[2]);
      out.push([a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, near]); }
  }
  return out;
}

// 把屏幕多边形裁进画面矩形，再算面积 —— 用来判断「镜头是不是贴着一块板」
function clipRect(pts, W, H){
  const edge = (p, keep, cut) => {
    const out=[];
    for (let i=0;i<p.length;i++){
      const a=p[i], b=p[(i+1)%p.length], ai=keep(a), bi=keep(b);
      if (ai) out.push(a);
      if (ai!==bi) out.push(cut(a,b));
    }
    return out;
  };
  const lerp=(a,b,t)=>[a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t];
  let q = pts;
  q = edge(q, p=>p[0]>=0, (a,b)=>lerp(a,b,(0-a[0])/(b[0]-a[0])));   if(q.length<3) return 0;
  q = edge(q, p=>p[0]<=W, (a,b)=>lerp(a,b,(W-a[0])/(b[0]-a[0])));   if(q.length<3) return 0;
  q = edge(q, p=>p[1]>=0, (a,b)=>lerp(a,b,(0-a[1])/(b[1]-a[1])));   if(q.length<3) return 0;
  q = edge(q, p=>p[1]<=H, (a,b)=>lerp(a,b,(H-a[1])/(b[1]-a[1])));   if(q.length<3) return 0;
  let A=0; for(let i=0;i<q.length;i++){ const a=q[i], b=q[(i+1)%q.length]; A += a[0]*b[1]-b[0]*a[1]; }
  return Math.abs(A)/2;
}

/** 把可见面投到屏幕，附带 1/z。clayPaint 和 visibleCounts 共用这一步。
 *  faces 显式传进来 —— 核心不认识页面上那个全局 FACES。 */
function project(faces, W, H, c){
  const { f, r, u } = basis(c);
  const focal = (W/2) * c.lens / 18;      // Blender sensor_width=36、AUTO 拟合长边 → 视场按宽度算
  const eye=[c.x,c.y,c.z], NEAR=90, list=[];
  for (const fc of faces){
    const p0=fc.p[0], vx=eye[0]-p0[0], vy=eye[1]-p0[1], vz=eye[2]-p0[2];
    if (fc.n[0]*vx + fc.n[1]*vy + fc.n[2]*vz <= 0) continue;
    let cp = fc.p.map(p=>{ const dx=p[0]-eye[0], dy=p[1]-eye[1], dz=p[2]-eye[2];
      return [dx*r[0]+dy*r[1]+dz*r[2], dx*u[0]+dy*u[1]+dz*u[2], dx*f[0]+dy*f[1]+dz*f[2]]; });
    cp = clipNear(cp, NEAR);
    if (cp.length < 3) continue;
    let d=0, dmax=0; for (const q of cp){ d+=q[2]; if (q[2]>dmax) dmax=q[2]; } d/=cp.length;
    list.push({ s: cp.map(q=>[W/2 + q[0]*focal/q[2], H/2 - q[1]*focal/q[2], 1/q[2]]),
                d, dmax, k:fc.k, n:fc.n, i:fc.i });
  }
  return list;
}

/* 逐像素深度缓冲的软光栅。
   原来用的是画家算法：按面的**平均深度**排序，从远到近盖着画。物体一旦互相穿插，
   或者一个面本身跨度很大（长桌面从近伸到远），平均深度就代表不了它 —— 桌腿画到桌面上、
   屏风穿过桌子、椅子穿过挡板，都是这么来的，靠调排序规则治不好。
   这里存 1/z（透视下它才是线性可插值的），逐像素比谁近。1200×800 约 130 ms。 */
const ZBIAS = 1.0004;   // 共面的两个面（比如两个柜子贴在一起）不要来回闪，先画的赢

function rasterize(list, W, H){
  const win = new Int32Array(W * H).fill(-1);        // 这个像素归哪一面
  const zb  = new Float32Array(W * H).fill(-Infinity);
  for (let fi = 0; fi < list.length; fi++){
    const sp = list[fi].s;
    for (let t = 1; t < sp.length - 1; t++){         // 扇形三角化
      const A = sp[0], B = sp[t], C = sp[t + 1];
      const den = (B[1]-C[1])*(A[0]-C[0]) + (C[0]-B[0])*(A[1]-C[1]);
      if (!den) continue;
      const x0 = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0])));
      const x1 = Math.min(W-1, Math.ceil(Math.max(A[0], B[0], C[0])));
      const y0 = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1])));
      const y1 = Math.min(H-1, Math.ceil(Math.max(A[1], B[1], C[1])));
      for (let y = y0; y <= y1; y++){
        const row = y * W;
        for (let x = x0; x <= x1; x++){
          const w0 = ((B[1]-C[1])*(x-C[0]) + (C[0]-B[0])*(y-C[1])) / den;
          if (w0 < 0) continue;
          const w1 = ((C[1]-A[1])*(x-C[0]) + (A[0]-C[0])*(y-C[1])) / den;
          if (w1 < 0) continue;
          const w2 = 1 - w0 - w1;
          if (w2 < 0) continue;
          const iz = w0*A[2] + w1*B[2] + w2*C[2];    // 1/z 线性插值，越大越近
          const i = row + x;
          if (iz <= zb[i] * ZBIAS) continue;
          zb[i] = iz; win[i] = fi;
        }
      }
    }
  }
  return { win, zb };
}

/** 画一帧白模：投影 → 逐像素深度缓冲 → 上灰 → 可选描边。
 *  返回 {list, win, zb} —— 构图自检那类分析拿着它自己算，核心不管。 */
function clayPaint(ctx, faces, W, H, c, edges){
  const list = project(faces, W, H, c);
  const { win, zb } = rasterize(list, W, H);

  const grey = new Uint8Array(list.length);
  for (let i = 0; i < list.length; i++){
    const it = list[i];
    const g = CLAY_GREY[it.k] ?? 0.72;
    const lam = Math.max(0, it.n[0]*LIGHT[0] + it.n[1]*LIGHT[1] + it.n[2]*LIGHT[2]);
    const fog = Math.min(0.30, it.d/70000);                       // 远处轻微发灰，帮助读进深
    let v = g * (0.56 + 0.44*lam);
    v = v*(1-fog) + 0.86*fog;
    grey[i] = Math.round(Math.pow(Math.min(1,v), 1/2.2) * 255);
  }

  const img = ctx.createImageData(W, H), px = img.data;
  for (let i = 0; i < W*H; i++){
    const w = win[i], o = i*4;
    px[o+3] = 255;
    if (w < 0){ px[o]=0xdf; px[o+1]=0xe0; px[o+2]=0xe2; }         // 背景 #dfe0e2
    else { px[o] = px[o+1] = px[o+2] = grey[w]; }
  }
  // 描边只画给人看。从「相邻像素归属不同面」直接生出来 —— 遮挡关系天然是对的，
  // 不像原来那样每个面自己描一圈、再被后画的盖掉。
  if (edges){
    for (let y = 0; y < H; y++){
      for (let x = 0; x < W; x++){
        const i = y*W + x, w = win[i];
        if (w < 0) continue;
        if ((x+1 < W && win[i+1] !== w) || (y+1 < H && win[i+W] !== w)){
          const o = i*4, v = (px[o] * 0.72) | 0;
          px[o] = px[o+1] = px[o+2] = v;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return { list, win, zb };
}
