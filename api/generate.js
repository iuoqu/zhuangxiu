// POST { pin, view, prompt, quality, n, withLine, engine, tier } → { images | imageUrls, meta }
// 只负责出图。存仓库拆到 api/save.js 由浏览器接着调 —— 千问 3.0 的 PNG 有 5~6 MB，
// 出图＋下载＋提交挤在一个函数里容易撞上平台的函数时长上限，函数被掐掉响应就没了，
// 浏览器只看到 Failed to fetch，可图其实已经提交进仓库了。
// engine＝'openai'（gpt-image-1）或 'qwen'（阿里云百炼）。
// tier＝'draft'／'final'，只对千问生效，是价格档位（见下面的 QWEN_TIERS）；
// gpt-image-1 的价格档位是它自己的 quality low/medium/high。
// API key 与 PIN 都只存在于服务端环境变量，永远不下发到浏览器。
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';

export const config = { maxDuration: 300 };

// 只有这六个有 Blender 预渲的底图和线稿（clays/ bares/ lines/ lines_bare/）。
// 07 以后的视角和 u1~u99 的自存机位一样，白模在浏览器里现画，底图和线稿都得自己带上来。
const PRE = ['01', '02', '03', '04', '05', '06'];
// 方案 D 的资产在仓库根的 clays/ bares/ …；其余方案在 schemes/<id>/ 下面。
// 方案号会直接拼进路径，先关死取值范围。
const okScheme = (v) => /^[A-Za-z0-9]{1,8}$/.test(String(v || ''));
const dirOf = (scheme, d) => (scheme === 'D' ? d : `schemes/${scheme}/${d}`);
const okView = (v) => /^(\d{2}|u\d{1,2})$/.test(v);   // 只管文件名安全，页面决定哪些真的存在
const hasPre = (v) => PRE.includes(v);
const ENGINES = ['openai', 'qwen'];
const MAX_N = 4;

function pinOk(got) {
  const want = process.env.PIN || '';
  if (!want) return false;
  const a = Buffer.from(String(got ?? ''));
  const b = Buffer.from(want);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function refBlob(dir, view, ext, type) {
  // 静态资源在项目根目录；万一被放进 public/ 也能读到
  const tries = [
    path.join(process.cwd(), dir, `${view}.${ext}`),
    path.join(process.cwd(), 'public', dir, `${view}.${ext}`),
  ];
  let last;
  for (const f of tries) {
    try { return new Blob([await readFile(f)], { type }); } catch (e) { last = e; }
  }
  throw new Error(`读不到参考图 ${dir}/${view}.${ext}：${last?.message}`);
}

async function callOpenAI(form, key, signal) {
  const r = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal,
  });
  const txt = await r.text();
  let json = null;
  try { json = JSON.parse(txt); } catch { /* 非 JSON 就留原文 */ }
  return { ok: r.ok, status: r.status, json, txt };
}

// ---- 千问（阿里云百炼）
// 同步接口，一次调用直接出图，不用异步轮询；出图给的是 24 小时有效的 URL，不是 base64。
const QWEN_URL = () =>
  (process.env.DASHSCOPE_BASE || 'https://dashscope.aliyuncs.com')
  + '/api/v1/services/aigc/multimodal-generation/generation';

// 压两件事：几何别动（净高和取景是这条管线的红线），以及别把白模原样描一遍 ——
// 底图本身是「平灰 ＋ 黑描边」，不明确压住，模型就只给它上个色。
const QWEN_NEG = 'text, watermark, signature, warped walls, curved straight lines, '
               + 'changed room layout, added or removed walls, different camera angle, '
               + 'line art, black outlines, cel shading, flat colour fill, cartoon, '
               + 'clay render, untextured grey surfaces, blocky placeholder furniture';

// 多图时必须在提示词里点明每张图的身份，否则模型会把风格图的布局也一并搬过来。
// 编号按实际送出去的张数现算 —— 没传风格图时第 2 张是线稿，不能还写成「风格参考」。
const QWEN_ROLES = {
  // 「只允许改材质颜色」这种说法，指令编辑模型会照字面执行 —— 结果就是给白模上色。
  // 要说清楚：保留的只有几何，其余整张重画。
  base:  '几何白模，不是成品图。只有房间的布局、比例、相机位置和取景范围要原样保留，'
       + '除此之外整张图都要当成一次重拍：白模上的黑色描边是标注线，不是物体的轮廓，'
       + '成图里一根都不许留；方块占位要换成真实家具；平涂的灰面要换成真实材质和真实光影。'
       + '不是给白模上色，是照着它的几何重新拍一张照片。',
  style: '风格参考：只取它的材质、颜色、饰面和光感，不要搬它的布局、家具位置和取景。',
  line:  '同一视角的线稿：只用来对齐边缘和结构线，它本身的线条不要画进成图。',
};

async function callQwen(model, key, images, prompt, count, full, signal) {
  const content = images.map((im) => ({ image: im.url }));
  const roles = images.map((im, i) => `图${i + 1}是${QWEN_ROLES[im.kind]}`).join('\n');
  content.push({ text: `${roles}\n\n${prompt.slice(0, 4000)}` });

  const body = {
    model,
    input: { messages: [{ role: 'user', content }] },
    // 不传 size：编辑类模型跟随输入图的尺寸，正好是要的 —— 底图 1536×1024 的取景不能被改。
    // prompt_extend 会把提示词改写扩写，而这里的提示词是逐条锁死的设计决定，必须关掉。
    parameters: full
      ? { n: count, watermark: false, prompt_extend: false, negative_prompt: QWEN_NEG }
      : { watermark: false },
  };
  const r = await fetch(QWEN_URL(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const txt = await r.text();
  let json = null;
  try { json = JSON.parse(txt); } catch { /* 非 JSON 就留原文 */ }
  return { ok: r.ok, status: r.status, json, txt, model };
}

// 千问按张计费，档次越高单价越高 —— 跟返回的文件多大没关系，贵在算力。
// 实测：试稿档出 1248×832（约 1 MB），定稿档出 2496×1664（四倍像素，5~6 MB）。
// 调机位、试提示词那种一轮轮的试稿全走 draft，满意了再花一次钱出 final。
// 每档链里排在后面的是兜底，前面的模型下线了才会用到 —— 真正出图的是哪个，
// 响应、页面标签和元数据里都写明，不会闷声换成贵的那个。
const QWEN_TIERS = {
  draft: ['qwen-image-edit-plus', 'qwen-image-edit', 'qwen-image-3.0'],
  final: ['qwen-image-3.0-pro', 'qwen-image-3.0', 'qwen-image-edit-plus', 'qwen-image-edit'],
};
const TIERS = Object.keys(QWEN_TIERS);
const TIER_CN = { draft: '试稿', final: '定稿' };

async function runQwen(key, images, prompt, count, tier, signal) {
  // 都走同一个接口（multimodal-generation，1~3 张参考图），可以直接串成一条链，
  // 模型不存在就自动往下试；想钉死用 QWEN_MODEL —— 它会盖掉档位。
  const models = [process.env.QWEN_MODEL, ...QWEN_TIERS[tier]].filter(Boolean);
  let out = null;
  for (const m of models) {
    out = await callQwen(m, key, images, prompt, count, true, signal);
    const modelErr = !out.ok && /model/i.test(out.txt);
    // 老一点的模型不认 n／prompt_extend／negative_prompt，整组丢掉重试，别一个个试
    if (!out.ok && !modelErr) out = await callQwen(m, key, images, prompt, 1, false, signal);
    if (out.ok || !modelErr) break;              // 不是模型问题就别再换下一个
  }
  return out;
}

/** 出图 URL → base64。页面显示和存仓库都要 base64，而那个 URL 只活 24 小时。 */
async function fetchB64(url, signal) {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`取回出图失败 ${r.status}`);
  return Buffer.from(await r.arrayBuffer()).toString('base64');
}

/** Blob → data URL。千问收的是 data URL 或公网 URL，不收 multipart。 */
async function toDataUrl(im) {
  const b64 = Buffer.from(await im.blob.arrayBuffer()).toString('base64');
  return { url: `data:${im.blob.type};base64,${b64}`, kind: im.kind };
}

/** 浏览器送上来的相机，只留六个数，全部验成有限数字 */
function cleanCam(c) {
  if (!c || typeof c !== 'object') return null;
  const out = {};
  for (const k of ['x', 'y', 'z', 'yaw', 'pitch', 'lens']) {
    const v = Number(c[k]);
    if (!Number.isFinite(v)) return null;
    out[k] = Math.round(v * 1000) / 1000;
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: '只接受 POST' });

  const { pin, view, prompt, quality = 'medium', n = 1,
          withLine = false, styleImage = null, baseKind = 'clay',
          baseImage = null, lineImage = null, engine = null, cam = null,
          tier = 'draft', scheme = 'D' } = req.body || {};

  if (!pinOk(pin)) {
    await sleep(1200);                       // 拖慢暴力猜测
    return res.status(401).json({ error: '门禁码不对' });
  }
  if (!okView(view)) return res.status(400).json({ error: '视角编号不对' });
  if (!okScheme(scheme)) return res.status(400).json({ error: '方案号不对' });
  if (typeof prompt !== 'string' || prompt.trim().length < 20) {
    return res.status(400).json({ error: '提示词太短' });
  }
  // 引擎：页面上选；没选就看环境变量 ENGINE；再没有就还是 OpenAI
  const eng = ENGINES.includes(engine) ? engine
            : (ENGINES.includes(process.env.ENGINE) ? process.env.ENGINE : 'openai');
  const keyName = eng === 'qwen' ? 'DASHSCOPE_API_KEY' : 'OPENAI_API_KEY';
  const key = process.env[keyName];
  if (!key) return res.status(500).json({ error: `服务端没配 ${keyName}` });

  const hasBase = typeof baseImage === 'string' && baseImage.startsWith('data:image/');
  if (!hasPre(view) && !hasBase) {
    return res.status(400).json({ error: '这个视角没有预渲底图，得把浏览器里那张一起送上来' });
  }

  const T0 = Date.now();

  // 到这儿为止的错都还能用正常的状态码。往下要等模型几十秒到几分钟，
  // 一条几分钟没有任何字节的连接，手机网络、公司代理、CDN 都可能直接掐掉，
  // 浏览器只会说一句 Failed to fetch。所以从这里开始改成 NDJSON 边等边发心跳，
  // 最后一行才是结果 —— 连接一直有动静，也顺便让页面知道服务端还活着。
  let hb = null, streaming = false;
  const openStream = () => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('X-Accel-Buffering', 'no');       // 别让中间层攒着不发
    streaming = true;
    const beat = () => { try { res.write(JSON.stringify({ wait: Math.round((Date.now() - T0) / 1000) }) + '\n'); } catch { /* 连接没了就算了 */ } };
    beat();
    hb = setInterval(beat, 5000);
  };
  const done = (obj, status = 200) => {
    if (hb) { clearInterval(hb); hb = null; }
    if (!streaming) return res.status(status).json(obj);
    try { res.write(JSON.stringify(obj) + '\n'); } catch { /* 同上 */ }
    return res.end();
  };

  // 自己先掐，别等平台掐 —— 平台掐是直接断连接，页面拿不到任何解释
  const BUDGET = Math.max(20, Number(process.env.GEN_BUDGET_S) || 285) * 1000;
  const ac = new AbortController();
  const killer = setTimeout(() => ac.abort(), BUDGET);

  const count = Math.min(Math.max(parseInt(n, 10) || 1, 1), MAX_N);
  const q = ['low', 'medium', 'high'].includes(quality) ? quality : 'medium';
  // 档位只对千问有意义；认不出来就按试稿算 —— 默认永远站在便宜那一边
  const tr = TIERS.includes(tier) ? tier : 'draft';

  // 以下 base() 只给 OpenAI 用。extras = 较新的可选参数，老接口不认时整组丢掉重试，别一个个试
  const base = (extras) => {
    const f = new FormData();
    f.append('model', 'gpt-image-1');
    f.append('prompt', prompt.slice(0, 4000));
    f.append('size', '1536x1024');
    f.append('quality', q);
    f.append('n', String(count));
    if (extras) {
      f.append('input_fidelity', 'high');
      f.append('output_format', 'jpeg');       // JPEG 比 PNG 小一大半，存仓库友好
      f.append('output_compression', '90');
    }
    return f;
  };

  try {
    openStream();
    // baseImage＝浏览器里自由取景后抓下来的白模；否则用预渲的三套底图之一
    let ref, refName;
    if (typeof baseImage === 'string' && baseImage.startsWith('data:image/')) {
      const [head, b64] = baseImage.split(',');
      const type = head.slice(5, head.indexOf(';')) || 'image/jpeg';
      ref = new Blob([Buffer.from(b64, 'base64')], { type });
      refName = `view.${type.includes('png') ? 'png' : 'jpg'}`;
    } else if (baseKind === 'render') {
      ref = await refBlob(dirOf(scheme, 'refs'), view, 'jpg', 'image/jpeg');
      refName = `${view}.jpg`;
    } else {
      ref = await refBlob(dirOf(scheme, baseKind === 'bare' ? 'bares' : 'clays'),
                          view, 'png', 'image/png');
      refName = `${view}.png`;
    }

    // 风格参考图（可选）：data URL → Blob
    let style = null;
    if (typeof styleImage === 'string' && styleImage.startsWith('data:image/')) {
      const [head, b64] = styleImage.split(',');
      const type = head.slice(5, head.indexOf(';')) || 'image/jpeg';
      style = new Blob([Buffer.from(b64, 'base64')], { type });
    }

    // 三张图的次序两个引擎共用：几何 → 风格 → 线稿。千问最多收 3 张，正好到顶。
    const imgs = [{ blob: ref, name: refName, kind: 'base' }];
    if (style) imgs.push({ blob: style, name: 'style.jpg', kind: 'style' });
    // 第二轮（底图＝上一轮出图）绝不加线稿：那等于把刚去掉的黑描边重新画回去。
    // 千问同样绝不加：qwen-image-edit 是合成式模型，会把线稿的每条线当成真构件画出来，
    // 桌子屏风隔断全变细金属框＋玻璃，整张图透视掉（视角 10 同底图前后两分钟实测：
    // openai＋线稿正常，qwen＋线稿全是玻璃盒子，qwen 不带线稿正常）。
    const useLine = withLine && baseKind !== 'redo' && eng !== 'qwen';
    if (useLine) {
      // 自由取景时线稿由浏览器现画（相机任意）；预设视角用对应吊顶那一套
      let line = null;
      if (typeof lineImage === 'string' && lineImage.startsWith('data:image/')) {
        line = new Blob([Buffer.from(lineImage.split(',')[1], 'base64')], { type: 'image/png' });
      } else if (hasPre(view)) {                     // 没预渲线稿的视角，没送就不加
        line = await refBlob(dirOf(scheme, baseKind === 'bare' ? 'lines_bare' : 'lines'),
                             view, 'png', 'image/png');
      }
      if (line) imgs.push({ blob: line, name: `${view}_line.png`, kind: 'line' });
    }

    let raw, model, links = null, tModel = 0;
    const notes = [];
    if (eng === 'qwen') {
      const out = await runQwen(key, await Promise.all(imgs.map(toDataUrl)),
                                prompt, count, tr, ac.signal);
      if (!out.ok) {
        const msg = out.json?.message || out.txt.slice(0, 300);
        return done({ error: `千问 ${out.status}：${msg}` });
      }
      links = (out.json?.output?.choices || [])
        .flatMap((c) => c.message?.content || []).map((c) => c.image).filter(Boolean);
      if (!links.length) return done({ error: '千问没返回图片' });
      tModel = Date.now() - T0;
      raw = await Promise.all(links.map((u) => fetchB64(u, ac.signal)));  // URL 只活 24 小时，趁热取回来
      model = out.model;
      // 兜底换了模型就说出来 —— 试稿档掉到贵模型上是要花钱的，不能闷着
      const want = process.env.QWEN_MODEL || QWEN_TIERS[tr][0];
      if (model !== want) {
        notes.push(`${TIER_CN[tr]}档想用的 ${want} 没能用上，这张实际是 ${model} 出的`);
      }
    } else {
      const f = base(true);
      for (const im of imgs) f.append('image[]', im.blob, im.name);

      let out = await callOpenAI(f, key, ac.signal);
      // 旧一点的接口不认 input_fidelity 或 image[]，退回最简形式再试一次。
      // 只认「参数被拒」这一种：以前任何失败都重试，429／5xx／超时也白白再出一次图，
      // 一次请求里跑两遍完整出图，时长直接翻倍，函数被平台掐掉的就是这么来的。
      if (!out.ok && out.status === 400
          && /input_fidelity|output_compression|output_format|image\[\]|unknown|unsupported|invalid.*parameter/i.test(out.txt)) {
        const g = base(false);
        g.append('image', ref, refName);
        out = await callOpenAI(g, key, ac.signal);
      }
      if (!out.ok) {
        const msg = out.json?.error?.message || out.txt.slice(0, 300);
        return done({ error: `OpenAI ${out.status}：${msg}` });
      }
      raw = (out.json?.data || []).map((d) => d.b64_json).filter(Boolean);
      if (!raw.length) return done({ error: 'OpenAI 没返回图片' });
      model = 'gpt-image-1';
      tModel = Date.now() - T0;
    }

    // 首字节判类型：JPEG 以 /9j 开头，PNG 以 iVBOR 开头
    const jpeg = raw[0].startsWith('/9j');
    const mime = jpeg ? 'image/jpeg' : 'image/png';
    const images = raw.map((b) => `data:${mime};base64,${b}`);

    // 出图的活儿到此为止。元数据交给浏览器，它把图缩小之后再调 api/save 存仓库 ——
    // 提交 5~6 MB 的 PNG 太慢，挤在这个请求里会把函数拖过时长上限。
    const meta = {
      view, scheme, engine: eng, model, baseKind, quality: q, withLine: useLine, hasStyle: !!style,
      档位: eng === 'qwen' ? TIER_CN[tr] : null,
      自定义视角: !!refName?.startsWith('view'),
      // 相机存下来，这一张才复现得了 —— 以前只记了「是自定义」，机位就丢了
      cam: cleanCam(cam), spotName: typeof req.body?.spotName === 'string'
        ? req.body.spotName.slice(0, 30) : null,
      耗时: { 出图: tModel, 取回: Date.now() - T0 - tModel, 单位: 'ms',
              图大小MB: +(raw.reduce((n, b) => n + b.length, 0) * 0.75 / 1048576).toFixed(2) },
      prompt,
    };
    const ms = { 出图: tModel, 合计: Date.now() - T0 };

    // 响应体也有 4.5 MB 上限。太大就改回图片链接（24 小时有效），让浏览器自己去取。
    const bulk = images.reduce((n, u) => n + u.length, 0);
    // 注意别叫 done —— 外面那个 done() 是「把响应发出去」（心跳流那套），
    // 同名会把它遮住，响应就绕开 NDJSON 了。这里只负责拼响应体。
    const payload = (extra) => {
      const note = [...notes, ...(extra ? [extra] : [])].join('；') || undefined;
      return { engine: eng, model, tier: eng === 'qwen' ? tr : null, meta, ms, note };
    };
    if (bulk > 3.4 * 1048576) {
      const big = `出图 ${(bulk / 1048576).toFixed(1)} MB`;
      if (links?.length) {
        return done({ imageUrls: links,
          ...payload(`${big}，超过响应体上限，返回的是 24 小时有效的图片链接`) });
      }
      return done({ images: [], ...payload(`${big}，浏览器收不下`) });
    }
    return done({ images, ...payload() });
  } catch (e) {
    const secs = Math.round((Date.now() - T0) / 1000);
    if (e?.name === 'AbortError' || ac.signal.aborted) {
      return done({ error: `模型 ${secs} 秒还没出图，超过了函数的时长预算（${BUDGET / 1000} s），`
        + '主动断开的。把画质降到 medium／low，或把一次出图张数降到 1，通常就过了；'
        + '也可以在 Vercel 环境变量里调 GEN_BUDGET_S。' });
    }
    return done({ error: `${String(e?.message || e).slice(0, 260)}（第 ${secs} 秒）` });
  } finally {
    clearTimeout(killer);
    if (hb) { clearInterval(hb); hb = null; }
  }
}
