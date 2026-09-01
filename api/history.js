// POST { pin }            → { items: [...] }   列出产出目录里已经出过的图
// POST { pin, file }      → { meta }           取某一张的元数据（含完整提示词）
//
// 图存在仓库里（见 generate.js 的 saveToRepo），但 Vercel 部署的是某一次提交的快照，
// 新存的图不一定在静态资源里 —— 所以这里一律走 GitHub API 拿当前的真实内容。
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

// 文件名是 generate.js 拼的：20260901-1413_01_3.png ＝ 时间 ＋ 视角 ＋ 第几张
const NAME = /^(\d{8}-\d{4})_(0[1-6]|u\d{1,2})(?:_(\d+))?\.(png|jpe?g)$/;

async function gh(path, token) {
  const r = await fetch('https://api.github.com' + path, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  const t = await r.text();
  let j = null;
  try { j = JSON.parse(t); } catch { /* 留原文 */ }
  if (!r.ok) throw new Error(`GitHub ${r.status}：${j?.message || t.slice(0, 160)}`);
  return j;
}

/** 20260901-1413 → 09-01 14:13（存的时候已经是北京时间） */
function when(stamp) {
  return `${stamp.slice(4, 6)}-${stamp.slice(6, 8)} ${stamp.slice(9, 11)}:${stamp.slice(11, 13)}`;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: '只接受 POST' });

  const { pin, file = null } = req.body || {};
  if (!pinOk(pin)) {
    await sleep(1200);
    return res.status(401).json({ error: '门禁码不对' });
  }

  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!token || !repo) {
    // 没配就不是错误，只是没有历史可看 —— 页面照常能出图
    return res.status(200).json({ items: [], note: '服务端没配 GITHUB_TOKEN／GITHUB_REPO，出图不会存进仓库，也就没有历史' });
  }
  const branch = process.env.GITHUB_BRANCH || 'main';
  const dir = process.env.SAVE_DIR || '产出';
  const ref = `?ref=${encodeURIComponent(branch)}`;

  try {
    // 单张：取它的 json，主要是为了把当时的完整提示词调回来
    if (file) {
      if (!NAME.test(file)) return res.status(400).json({ error: '文件名不对' });
      const j = await gh(`/repos/${repo}/contents/${encodeURIComponent(dir)}/`
                       + `${encodeURIComponent(file.replace(/\.(png|jpe?g)$/, '.json'))}${ref}`, token);
      const meta = JSON.parse(Buffer.from(j.content, 'base64').toString('utf8'));
      return res.status(200).json({ meta });
    }

    // 列表：只读目录，不逐个取 json —— 视角和时间文件名里就有，够摆缩略图了
    let list;
    try {
      list = await gh(`/repos/${repo}/contents/${encodeURIComponent(dir)}${ref}`, token);
    } catch (e) {
      if (/404/.test(String(e.message))) return res.status(200).json({ items: [] });  // 还没出过图
      throw e;
    }

    const items = [];
    for (const f of Array.isArray(list) ? list : []) {
      const m = NAME.exec(f.name);
      if (!m) continue;
      items.push({
        file: f.name,
        url: f.download_url,          // 私有库时这个链接自带短期令牌，公开库就是 raw 直链
        view: m[2],
        n: m[3] ? Number(m[3]) : 1,
        when: when(m[1]),
        stamp: m[1],
      });
    }
    // 文件名前缀是时间戳，按名字倒排就是从新到旧
    items.sort((a, b) => (a.file < b.file ? 1 : a.file > b.file ? -1 : 0));
    return res.status(200).json({ items: items.slice(0, 60) });
  } catch (e) {
    return res.status(502).json({ error: String(e?.message || e).slice(0, 240) });
  }
}
