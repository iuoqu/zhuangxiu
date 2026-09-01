// POST { pin, image (data URL), meta } → { saved: [路径…] }
//
// 存仓库从出图那个请求里拆出来了。原因：千问 3.0 出的 PNG 有 5~6 MB，
// 「调模型 → 下载 → 转 base64 → 提交到 GitHub（7.9 MB 的请求体）」全挤在一个函数里，
// 很容易撞上平台的函数时长上限；函数被掐掉时响应就没了，浏览器只看到 Failed to fetch，
// 可图其实已经提交进仓库了 —— 这正是之前反复出现的现象。
//
// 现在浏览器先把图缩成 1600 长边的 JPEG 再送过来，通常两三百 KB：
// 传得快、提交得快、仓库也不会被几 MB 的 PNG 撑大（图会永远留在 git 历史里）。
import { timingSafeEqual } from 'node:crypto';

export const config = { maxDuration: 120 };

function pinOk(got) {
  const want = process.env.PIN || '';
  if (!want) return false;
  const a = Buffer.from(String(got ?? ''));
  const b = Buffer.from(want);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE_CN = { clay:'白模 3.0 m', bare:'白模裸顶 4.28 m', render:'渲染图',
                  custom:'白模自由取景', redo:'上一轮出图' };
const VIEW_OK = /^(\d{2}|u\d{1,2})$/;

async function gh(path, token, init = {}) {
  const r = await fetch('https://api.github.com' + path, {
    signal: AbortSignal.timeout(30000),
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

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: '只接受 POST' });

  const { pin, image, meta = {} } = req.body || {};
  if (!pinOk(pin)) {
    await sleep(1200);
    return res.status(401).json({ error: '门禁码不对' });
  }
  if (typeof image !== 'string' || !image.startsWith('data:image/')) {
    return res.status(400).json({ error: '没有收到图片' });
  }
  if (!VIEW_OK.test(String(meta.view ?? ''))) {
    return res.status(400).json({ error: '视角编号不对' });
  }

  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!token || !repo) {
    return res.status(200).json({ saved: [],
      note: '服务端没配 GITHUB_TOKEN／GITHUB_REPO，这次没有存进仓库 —— 请先下载' });
  }
  const branch = process.env.GITHUB_BRANCH || 'main';
  const dir = process.env.SAVE_DIR || '产出';

  const [head, b64] = image.split(',');
  const ext = /png/.test(head) ? 'png' : 'jpg';

  const d = new Date(Date.now() + 8 * 3600 * 1000);   // 北京时间
  const stamp = d.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  const name = `${stamp}_${meta.view}${meta.n > 1 ? `_${meta.i || 1}` : ''}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const ref = await gh(`/repos/${repo}/git/ref/heads/${branch}`, token);
      const headSha = ref.object.sha;
      const parent = await gh(`/repos/${repo}/git/commits/${headSha}`, token);

      const blob = await gh(`/repos/${repo}/git/blobs`, token, {
        method: 'POST', body: JSON.stringify({ content: b64, encoding: 'base64' }),
      });
      const info = await gh(`/repos/${repo}/git/blobs`, token, {
        method: 'POST',
        body: JSON.stringify({
          content: Buffer.from(JSON.stringify(
            { ...meta, 出图时间: d.toISOString(), 文件: `${name}.${ext}` }, null, 2)).toString('base64'),
          encoding: 'base64',
        }),
      });
      const tree = await gh(`/repos/${repo}/git/trees`, token, {
        method: 'POST',
        body: JSON.stringify({ base_tree: parent.tree.sha, tree: [
          { path: `${dir}/${name}.${ext}`, mode: '100644', type: 'blob', sha: blob.sha },
          { path: `${dir}/${name}.json`, mode: '100644', type: 'blob', sha: info.sha },
        ] }),
      });
      const commit = await gh(`/repos/${repo}/git/commits`, token, {
        method: 'POST',
        body: JSON.stringify({
          message: `AI 出图 ${meta.view}（${BASE_CN[meta.baseKind] || meta.baseKind}底图，`
                 + `${meta.engine === 'qwen' ? '千问' : meta.quality}）`,
          tree: tree.sha, parents: [headSha],
        }),
      });
      await gh(`/repos/${repo}/git/refs/heads/${branch}`, token, {
        method: 'PATCH', body: JSON.stringify({ sha: commit.sha }),
      });
      return res.status(200).json({ saved: [`${dir}/${name}.${ext}`] });
    } catch (e) {
      // 并发提交会在最后一步撞车，重试一次即可
      if (attempt === 1 || !/refs\/heads/.test(String(e.message))) {
        return res.status(502).json({ error: String(e?.message || e).slice(0, 240) });
      }
    }
  }
  return res.status(502).json({ error: '存仓库失败' });
}
