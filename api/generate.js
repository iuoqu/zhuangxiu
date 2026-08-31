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

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: '只接受 POST' });

  const { pin, view, prompt, quality = 'medium', n = 1,
          withLine = false, styleImage = null, baseKind = 'clay' } = req.body || {};

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

  const base = (fidelity) => {
    const f = new FormData();
    f.append('model', 'gpt-image-1');
    f.append('prompt', prompt.slice(0, 4000));
    f.append('size', '1536x1024');
    f.append('quality', q);
    f.append('n', String(count));
    if (fidelity) f.append('input_fidelity', 'high');
    return f;
  };

  try {
    // base='clay' 用白模（只给几何，不给材质），'render' 用渲染成图
    const ref = baseKind === 'render'
      ? await refBlob('refs', view, 'jpg', 'image/jpeg')
      : await refBlob('clays', view, 'png', 'image/png');

    // 风格参考图（可选）：data URL → Blob
    let style = null;
    if (typeof styleImage === 'string' && styleImage.startsWith('data:image/')) {
      const [head, b64] = styleImage.split(',');
      const type = head.slice(5, head.indexOf(';')) || 'image/jpeg';
      style = new Blob([Buffer.from(b64, 'base64')], { type });
    }

    const f = base(true);
    f.append('image[]', ref, `${view}.${baseKind === 'render' ? 'jpg' : 'png'}`);   // 第 1 张＝几何
    if (style) f.append('image[]', style, 'style.jpg');   // 第 2 张＝风格
    if (withLine) {
      f.append('image[]', await refBlob('lines', view, 'png', 'image/png'), `${view}_line.png`);
    }
    let out = await callOpenAI(f, key);

    // 旧一点的接口不认 input_fidelity 或 image[]，退回最简形式再试一次
    if (!out.ok) {
      const g = base(false);
      g.append('image', ref, `${view}.${baseKind === 'render' ? 'jpg' : 'png'}`);
      out = await callOpenAI(g, key);
    }
    if (!out.ok) {
      const msg = out.json?.error?.message || out.txt.slice(0, 300);
      return res.status(out.status).json({ error: `OpenAI ${out.status}：${msg}` });
    }

    const images = (out.json?.data || [])
      .map((d) => d.b64_json)
      .filter(Boolean)
      .map((b) => `data:image/png;base64,${b}`);
    if (!images.length) return res.status(502).json({ error: 'OpenAI 没返回图片' });
    return res.status(200).json({ images });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e).slice(0, 300) });
  }
}
