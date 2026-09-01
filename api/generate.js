// POST { pin, view, prompt, quality, n, withLine, engine } → { images: [dataURL] }
// engine＝'openai'（gpt-image-1）或 'qwen'（阿里云百炼 qwen-image-edit）。
// API key 与 PIN 都只存在于服务端环境变量，永远不下发到浏览器。
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';

export const config = { maxDuration: 300 };

const VIEWS = ['01', '02', '03', '04', '05', '06'];
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

async function callOpenAI(form, key) {
  const r = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
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

async function callQwen(model, key, images, prompt, count, full) {
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
  });
  const txt = await r.text();
  let json = null;
  try { json = JSON.parse(txt); } catch { /* 非 JSON 就留原文 */ }
  return { ok: r.ok, status: r.status, json, txt, model };
}

async function runQwen(key, images, prompt, count) {
  const models = [process.env.QWEN_MODEL, 'qwen-image-edit-plus', 'qwen-image-edit'].filter(Boolean);
  let out = null;
  for (const m of models) {
    out = await callQwen(m, key, images, prompt, count, true);
    const modelErr = !out.ok && /model/i.test(out.txt);
    // 老一点的模型不认 n／prompt_extend／negative_prompt，整组丢掉重试，别一个个试
    if (!out.ok && !modelErr) out = await callQwen(m, key, images, prompt, 1, false);
    if (out.ok || !modelErr) break;              // 不是模型问题就别再换下一个
  }
  return out;
}

/** 出图 URL → base64。页面显示和存仓库都要 base64，而那个 URL 只活 24 小时。 */
async function fetchB64(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`取回出图失败 ${r.status}`);
  return Buffer.from(await r.arrayBuffer()).toString('base64');
}

/** Blob → data URL。千问收的是 data URL 或公网 URL，不收 multipart。 */
async function toDataUrl(im) {
  const b64 = Buffer.from(await im.blob.arrayBuffer()).toString('base64');
  return { url: `data:${im.blob.type};base64,${b64}`, kind: im.kind };
}

const GH = 'https://api.github.com';

async function gh(path, token, init = {}) {
  const r = await fetch(GH + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const t = await r.text();
  let j = null;
  try { j = JSON.parse(t); } catch { /* 留原文 */ }
  if (!r.ok) throw new Error(`GitHub ${r.status} ${path}：${j?.message || t.slice(0, 160)}`);
  return j;
}

/** 把出图连同元数据提交回仓库。没配 token 就静默跳过。 */
const BASE_CN = { clay:'白模 3.0 m', bare:'白模裸顶 4.28 m', render:'渲染图', custom:'白模自由取景' };

async function saveToRepo(b64list, ext, meta) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;            // 形如 iuoqu/zhuangxiu
  if (!token || !repo) return [];
  const branch = process.env.GITHUB_BRANCH || 'main';
  const dir = process.env.SAVE_DIR || '产出';

  const d = new Date(Date.now() + 8 * 3600 * 1000);   // 北京时间
  const stamp = d.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const ref = await gh(`/repos/${repo}/git/ref/heads/${branch}`, token);
      const headSha = ref.object.sha;
      const head = await gh(`/repos/${repo}/git/commits/${headSha}`, token);

      const tree = [];
      const paths = [];
      for (let i = 0; i < b64list.length; i++) {
        const tag = b64list.length > 1 ? `_${i + 1}` : '';
        const name = `${stamp}_${meta.view}${tag}`;
        const blob = await gh(`/repos/${repo}/git/blobs`, token, {
          method: 'POST',
          body: JSON.stringify({ content: b64list[i], encoding: 'base64' }),
        });
        tree.push({ path: `${dir}/${name}.${ext}`, mode: '100644', type: 'blob', sha: blob.sha });
        paths.push(`${dir}/${name}.${ext}`);

        const info = await gh(`/repos/${repo}/git/blobs`, token, {
          method: 'POST',
          body: JSON.stringify({
            content: Buffer.from(JSON.stringify({ ...meta, 出图时间: d.toISOString(), 文件: `${name}.${ext}` }, null, 2)).toString('base64'),
            encoding: 'base64',
          }),
        });
        tree.push({ path: `${dir}/${name}.json`, mode: '100644', type: 'blob', sha: info.sha });
      }

      const newTree = await gh(`/repos/${repo}/git/trees`, token, {
        method: 'POST',
        body: JSON.stringify({ base_tree: head.tree.sha, tree }),
      });
      const commit = await gh(`/repos/${repo}/git/commits`, token, {
        method: 'POST',
        body: JSON.stringify({
          message: `AI 出图 ${meta.view}（${BASE_CN[meta.baseKind] || meta.baseKind}底图，`
                 + `${meta.engine === 'qwen' ? '千问' : meta.quality}）`,
          tree: newTree.sha,
          parents: [headSha],
        }),
      });
      await gh(`/repos/${repo}/git/refs/heads/${branch}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ sha: commit.sha }),
      });
      return paths;
    } catch (e) {
      // 并发提交会在最后一步撞车，重试一次即可
      if (attempt === 1 || !/refs\/heads/.test(String(e.message))) throw e;
    }
  }
  return [];
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: '只接受 POST' });

  const { pin, view, prompt, quality = 'medium', n = 1,
          withLine = false, styleImage = null, baseKind = 'clay',
          baseImage = null, lineImage = null, engine = null } = req.body || {};

  if (!pinOk(pin)) {
    await sleep(1200);                       // 拖慢暴力猜测
    return res.status(401).json({ error: '门禁码不对' });
  }
  if (!VIEWS.includes(view)) return res.status(400).json({ error: '视角编号不对' });
  if (typeof prompt !== 'string' || prompt.trim().length < 20) {
    return res.status(400).json({ error: '提示词太短' });
  }
  // 引擎：页面上选；没选就看环境变量 ENGINE；再没有就还是 OpenAI
  const eng = ENGINES.includes(engine) ? engine
            : (ENGINES.includes(process.env.ENGINE) ? process.env.ENGINE : 'openai');
  const keyName = eng === 'qwen' ? 'DASHSCOPE_API_KEY' : 'OPENAI_API_KEY';
  const key = process.env[keyName];
  if (!key) return res.status(500).json({ error: `服务端没配 ${keyName}` });

  const count = Math.min(Math.max(parseInt(n, 10) || 1, 1), MAX_N);
  const q = ['low', 'medium', 'high'].includes(quality) ? quality : 'medium';

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
    // baseImage＝浏览器里自由取景后抓下来的白模；否则用预渲的三套底图之一
    let ref, refName;
    if (typeof baseImage === 'string' && baseImage.startsWith('data:image/')) {
      const [head, b64] = baseImage.split(',');
      const type = head.slice(5, head.indexOf(';')) || 'image/jpeg';
      ref = new Blob([Buffer.from(b64, 'base64')], { type });
      refName = `view.${type.includes('png') ? 'png' : 'jpg'}`;
    } else if (baseKind === 'render') {
      ref = await refBlob('refs', view, 'jpg', 'image/jpeg');
      refName = `${view}.jpg`;
    } else {
      ref = await refBlob(baseKind === 'bare' ? 'bares' : 'clays', view, 'png', 'image/png');
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
    if (withLine) {
      // 自由取景时线稿由浏览器现画（相机任意）；预设视角用对应吊顶那一套
      let line;
      if (typeof lineImage === 'string' && lineImage.startsWith('data:image/')) {
        line = new Blob([Buffer.from(lineImage.split(',')[1], 'base64')], { type: 'image/png' });
      } else {
        line = await refBlob(baseKind === 'bare' ? 'lines_bare' : 'lines', view, 'png', 'image/png');
      }
      imgs.push({ blob: line, name: `${view}_line.png`, kind: 'line' });
    }

    let raw, model;
    if (eng === 'qwen') {
      const out = await runQwen(key, await Promise.all(imgs.map(toDataUrl)), prompt, count);
      if (!out.ok) {
        const msg = out.json?.message || out.txt.slice(0, 300);
        return res.status(out.status).json({ error: `千问 ${out.status}：${msg}` });
      }
      const links = (out.json?.output?.choices || [])
        .flatMap((c) => c.message?.content || []).map((c) => c.image).filter(Boolean);
      if (!links.length) return res.status(502).json({ error: '千问没返回图片' });
      raw = await Promise.all(links.map(fetchB64));      // URL 只活 24 小时，趁热取回来
      model = out.model;
    } else {
      const f = base(true);
      for (const im of imgs) f.append('image[]', im.blob, im.name);

      let out = await callOpenAI(f, key);
      // 旧一点的接口不认 input_fidelity 或 image[]，退回最简形式再试一次
      if (!out.ok) {
        const g = base(false);
        g.append('image', ref, refName);
        out = await callOpenAI(g, key);
      }
      if (!out.ok) {
        const msg = out.json?.error?.message || out.txt.slice(0, 300);
        return res.status(out.status).json({ error: `OpenAI ${out.status}：${msg}` });
      }
      raw = (out.json?.data || []).map((d) => d.b64_json).filter(Boolean);
      if (!raw.length) return res.status(502).json({ error: 'OpenAI 没返回图片' });
      model = 'gpt-image-1';
    }

    // 首字节判类型：JPEG 以 /9j 开头，PNG 以 iVBOR 开头
    const jpeg = raw[0].startsWith('/9j');
    const mime = jpeg ? 'image/jpeg' : 'image/png';
    const images = raw.map((b) => `data:${mime};base64,${b}`);

    // 自动存进仓库；存失败不影响出图，只把原因带回去
    let saved = [], saveError = null;
    try {
      saved = await saveToRepo(raw, jpeg ? 'jpg' : 'png', {
        view, engine: eng, model, baseKind, quality: q, withLine, hasStyle: !!style,
        自定义视角: !!refName?.startsWith('view'), prompt,
      });
    } catch (e) {
      saveError = String(e?.message || e).slice(0, 240);
    }
    return res.status(200).json({ images, saved, saveError, engine: eng, model });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e).slice(0, 300) });
  }
}
