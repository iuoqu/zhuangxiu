// POST { pin }           → { spots: [...] }    读回存在仓库里的机位
// POST { pin, spots }    → { spots, saved }    覆盖保存
//
// 机位原来只存在浏览器的 localStorage 里 —— 换浏览器、换设备、甚至 Vercel 换个
// 部署域名（localStorage 按域名隔离）就没了。数据本身只有几个数字，存进仓库最稳。
import { timingSafeEqual } from 'node:crypto';

export const config = { maxDuration: 60 };

function pinOk(got) {
  const want = process.env.PIN || '';
  if (!want) return false;
  const a = Buffer.from(String(got ?? ''));
  const b = Buffer.from(want);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FILE = '机位.json';

async function gh(path, token, init = {}) {
  const r = await fetch('https://api.github.com' + path, {
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
  return { ok: r.ok, status: r.status, json: j, txt: t };
}

/** 浏览器送上来的机位，逐个验形状再存 —— 别把脏数据写进仓库 */
function clean(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const s of raw.slice(0, 99)) {
    if (!/^u\d{1,2}$/.test(s?.id)) continue;
    const c = s.cam;
    if (!c || typeof c !== 'object') continue;
    const cam = {};
    let bad = false;
    for (const k of ['x', 'y', 'z', 'yaw', 'pitch', 'lens']) {
      const v = Number(c[k]);
      if (!Number.isFinite(v)) { bad = true; break; }
      cam[k] = Math.round(v * 1000) / 1000;
    }
    if (bad) continue;
    if (out.some((o) => o.id === s.id)) continue;          // 同一个编号只留一份
    out.push({ id: s.id, name: String(s.name || s.id).slice(0, 20), cam });
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: '只接受 POST' });

  const { pin, spots = null } = req.body || {};
  if (!pinOk(pin)) {
    await sleep(1200);
    return res.status(401).json({ error: '门禁码不对' });
  }

  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  // 没配 token 就退回「只存浏览器」，不当成错误 —— 页面照常能用
  if (!token || !repo) {
    return res.status(200).json({ spots: null, local: true,
      note: '服务端没配 GITHUB_TOKEN／GITHUB_REPO，机位只存在这台浏览器里' });
  }
  const branch = process.env.GITHUB_BRANCH || 'main';
  const path = `/repos/${repo}/contents/${encodeURIComponent(FILE)}`;

  try {
    const cur = await gh(`${path}?ref=${encodeURIComponent(branch)}`, token);
    const sha = cur.ok ? cur.json?.sha : null;
    const have = cur.ok
      ? (clean(JSON.parse(Buffer.from(cur.json.content, 'base64').toString('utf8'))) || [])
      : [];

    if (!spots) return res.status(200).json({ spots: have });

    const next = clean(spots);
    if (!next) return res.status(400).json({ error: '机位数据格式不对' });

    const put = await gh(path, token, {
      method: 'PUT',
      body: JSON.stringify({
        message: `机位：${next.length} 个（${next.map((s) => s.name).join('、') || '清空'}）`,
        content: Buffer.from(JSON.stringify(next, null, 1), 'utf8').toString('base64'),
        branch,
        ...(sha ? { sha } : {}),
      }),
    });
    if (!put.ok) {
      return res.status(put.status).json({
        error: `存不进仓库：${put.json?.message || put.txt.slice(0, 160)}` });
    }
    return res.status(200).json({ spots: next, saved: true });
  } catch (e) {
    return res.status(502).json({ error: String(e?.message || e).slice(0, 240) });
  }
}
