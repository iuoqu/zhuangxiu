// POST { pin }                    → { list:[{id,name,seats}] }   仓库里有哪些方案
// POST { pin, id, scheme }        → { saved:true }                存／覆盖一版方案
//
// 方案文件只描述可变区（房间＋工位带），底板在 models/base.json 里，任何方案都不碰。
// 存进仓库之后还要跑一次 `bash 分析/build_scheme.sh <id>` 才有白模和 AI 底图 ——
// 那一步要跑 Blender，只能在机器上跑，页面里做不了。
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

async function gh(p, token, init = {}) {
  const r = await fetch('https://api.github.com' + p, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch { /* 留原文 */ }
  return { ok: r.ok, status: r.status, json: j, txt: t };
}

/** 方案号会拼进路径，关死；房间和工位带逐条验形状，别把脏数据写进仓库。 */
const okId = (v) => /^[A-Za-z0-9]{1,8}$/.test(String(v || ''));
function clean(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const rect = (r) => {
    const x = (r?.x || []).map(Number), y = (r?.y || []).map(Number);
    if (x.length !== 2 || y.length !== 2 || [...x, ...y].some((v) => !Number.isFinite(v))) return null;
    return { x: x.map(Math.round), y: y.map(Math.round) };
  };
  const rooms = [], desks = [];
  for (const r of (raw.rooms || []).slice(0, 60)) {
    const b = rect(r); if (!b) continue;
    rooms.push({ n: String(r.n || '房间').slice(0, 20), ...b });
  }
  for (const d of (raw.desks || []).slice(0, 60)) {
    const b = rect(d); if (!b) continue;
    const s = (d.size || [1400, 700]).map(Number);
    desks.push({ ...b, size: s.every(Number.isFinite) ? s.map(Math.round) : [1400, 700],
                 dir: d.dir === 'v' ? 'v' : 'h' });
  }
  if (!rooms.length && !desks.length) return null;
  return { id: raw.id, name: String(raw.name || raw.id).slice(0, 40),
           note: String(raw.note || '').slice(0, 200), rooms, desks };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: '只接受 POST' });
  const { pin, id = null, scheme = null } = req.body || {};
  if (!pinOk(pin)) { await sleep(1200); return res.status(401).json({ error: '门禁码不对' }); }

  const token = process.env.GITHUB_TOKEN, repo = process.env.GITHUB_REPO;
  if (!token || !repo) {
    return res.status(200).json({ list: [], local: true,
      note: '服务端没配 GITHUB_TOKEN／GITHUB_REPO，方案只能导出成文件自己放进仓库' });
  }
  const branch = process.env.GITHUB_BRANCH || 'main';

  try {
    if (!id) {                                   // 列一下有哪些方案
      const r = await gh(`/repos/${repo}/contents/schemes?ref=${encodeURIComponent(branch)}`, token);
      if (!r.ok) return res.status(200).json({ list: [] });
      const list = (r.json || []).filter((f) => f.name.endsWith('.json'))
        .map((f) => ({ id: f.name.replace(/\.json$/, '') }));
      return res.status(200).json({ list });
    }
    if (!okId(id)) return res.status(400).json({ error: '方案号只能是字母数字，1~8 位' });
    const body = clean(scheme);
    if (!body) return res.status(400).json({ error: '方案里既没有房间也没有工位带' });
    body.id = id;

    const p = `/repos/${repo}/contents/schemes/${id}.json`;
    const cur = await gh(`${p}?ref=${encodeURIComponent(branch)}`, token);
    const put = await gh(p, token, {
      method: 'PUT',
      body: JSON.stringify({
        message: `方案 ${id}：房间 ${body.rooms.length} 间、工位带 ${body.desks.length} 条`,
        content: Buffer.from(JSON.stringify(body, null, 1), 'utf8').toString('base64'),
        branch, ...(cur.ok && cur.json?.sha ? { sha: cur.json.sha } : {}),
      }),
    });
    if (!put.ok) return res.status(put.status).json({
      error: `存不进仓库：${put.json?.message || put.txt.slice(0, 160)}` });
    return res.status(200).json({ saved: true, id,
      note: `已存成 schemes/${id}.json。还要在机器上跑一次 ` +
            `\`bash 分析/build_scheme.sh ${id}\` 才有白模和 AI 底图。` });
  } catch (e) {
    return res.status(502).json({ error: String(e?.message || e).slice(0, 240) });
  }
}
