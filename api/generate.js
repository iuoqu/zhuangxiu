// POST { pin, view, prompt, quality, n, withLine } → { images: [dataURL] }
// OPENAI_API_KEY 与 PIN 都只存在于服务端环境变量，永远不下发到浏览器。
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';

export const config = { maxDuration: 300 };

const VIEWS = ['01', '02', '03', '04', '05', '06'];
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
          message: `AI 出图 ${meta.view}（${BASE_CN[meta.baseKind] || meta.baseKind}底图，${meta.quality}）`,
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
          baseImage = null } = req.body || {};

  if (!pinOk(pin)) {
    await sleep(1200);                       // 拖慢暴力猜测
    return res.status(401).json({ error: '门禁码不对' });
  }
  if (!VIEWS.includes(view)) return res.status(400).json({ error: '视角编号不对' });
  if (typeof prompt !== 'string' || prompt.trim().length < 20) {
    return res.status(400).json({ error: '提示词太短' });
  }
  const key = process.env.OPENAI_API_KEY;
  if (!key) return res.status(500).json({ error: '服务端没配 OPENAI_API_KEY' });

  const count = Math.min(Math.max(parseInt(n, 10) || 1, 1), MAX_N);
  const q = ['low', 'medium', 'high'].includes(quality) ? quality : 'medium';

  // extras = 较新的可选参数。老接口不认时整组丢掉重试，别一个个试
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

    const f = base(true);
    f.append('image[]', ref, refName);                   // 第 1 张＝几何
    if (style) f.append('image[]', style, 'style.jpg');   // 第 2 张＝风格
    if (withLine) {
      f.append('image[]', await refBlob('lines', view, 'png', 'image/png'), `${view}_line.png`);
    }
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

    const raw = (out.json?.data || []).map((d) => d.b64_json).filter(Boolean);
    if (!raw.length) return res.status(502).json({ error: 'OpenAI 没返回图片' });
    // 首字节判类型：JPEG 以 /9j 开头，PNG 以 iVBOR 开头
    const jpeg = raw[0].startsWith('/9j');
    const mime = jpeg ? 'image/jpeg' : 'image/png';
    const images = raw.map((b) => `data:${mime};base64,${b}`);

    // 自动存进仓库；存失败不影响出图，只把原因带回去
    let saved = [], saveError = null;
    try {
      saved = await saveToRepo(raw, jpeg ? 'jpg' : 'png', {
        view, baseKind, quality: q, withLine, hasStyle: !!style,
        自定义视角: !!refName?.startsWith('view'), prompt,
      });
    } catch (e) {
      saveError = String(e?.message || e).slice(0, 240);
    }
    return res.status(200).json({ images, saved, saveError });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e).slice(0, 300) });
  }
}
