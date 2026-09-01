// POST { pin, image, options? } → { en, zh: [...], options?, geometry? }
// 把一张风格参考图「读」成三样东西：
//   en / zh —— 材质光照描述（并进提示词 ＋ 给设计师核对）
//   options —— 页面那八个下拉框该选哪一项，对不上的明说对不上
//   geometry —— 这张图的天花是不是裸顶、该配哪套白模底图（净高是几何，AI 改不出来）
// options 的候选项由页面随请求送上来，OPTS 只在 index.html 里有一份，不在这边复制。
// 走的是 OpenAI 的 /chat/completions 协议；百炼有兼容端点，改 VISION_BASE 就能换成千问。
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

const ASK_BASE = `You are an interior design analyst. Look at this reference photograph and describe ONLY
its visual STYLE, so the description can be used to restyle a completely different room.

Do NOT describe the room's layout, its dimensions, how many pieces of furniture there are, or where
anything sits. Only materials, colours, finishes, furniture character and light.

Cover, where visible: floor material and colour; wall finish; ceiling finish and system; desk or
table material and edge detail; chair type, frame and upholstery; screen or partition material;
metal finishes; glass and framing; accent colours; luminaire type and colour temperature; the
quality of daylight; and the overall mood.

Return JSON with exactly two keys:
  "en": one English paragraph, at most 130 words, written so it can be pasted straight into an
        image-generation prompt. Start with "Material and lighting style:".
  "zh": an array of short Chinese lines, each "部位 → 做法／颜色", for a designer to check against.
        8 to 14 lines. No numbering.`;

// 页面送上来的候选项 → 追加两段任务：选项映射 ＋ 天花几何判定
function askWith(cat) {
  if (!cat) return ASK_BASE;
  const groups = Object.entries(cat)
    .map(([k, g]) => `  ${k}（${g.名称}）：` + g.选项.map((o, i) => `${i}=${o}`).join('　'))
    .join('\n');

  return `${ASK_BASE}

ALSO return two more keys.

"options" — map the photograph onto this project's fixed design options. For each group below, pick
the ONE option that best matches what the photograph actually shows, BY INDEX:

${groups}

Shape: { "<group key>": { "pick": <index>, "why": "<中文，20 字以内，说图上到底是什么>",
                          "mismatch": "<中文一句，或 null>" } }

"mismatch" is the important one. If the photograph shows something this option list cannot express —
a different type entirely, or two different treatments in the same room — say plainly what the
difference is. Do NOT quietly round to the nearest option and leave mismatch null. If the option
really does fit, then null is correct. Judge only from what is visible; never invent.

"geometry" — read the CEILING as geometry, not as a finish. This matters more than any material:
ceiling height is geometry, and an image model cannot change it.
Shape: { "type": "bare" | "suspended" | "mixed",
         "clear": "<中文，对结构板底净高的估计，如「约 4 m 以上」；看不出就 null>",
         "baseKind": "clay" | "bare",
         "note": "<中文一句：这张图该配哪套白模底图，为什么>" }
  type: "bare" = 结构板底直接外露；"suspended" = 一整片做到底的吊顶；
        "mixed" = 吊顶岛／灯棚浮在外露板底之下。
  baseKind: "bare"（净高 4.28 m 那套底图）if type is bare or mixed;
            "clay"（吊顶 3.0 m 那套）only if it is a continuous ceiling at roughly 3 m.`;
}

const VISION_BASE = () => (process.env.VISION_BASE || 'https://api.openai.com/v1').replace(/\/+$/, '');
// 端点或模型名任一像千问，就按千问那套取 key 和默认模型；都不像才当 OpenAI。
// 走自建代理这类看不出来的地址时，显式设 VISION_MODEL 或 VISION_API_KEY 即可。
const onQwen = () => /^qwen/i.test(process.env.VISION_MODEL || '')
                  || /dashscope|aliyuncs/i.test(VISION_BASE());

/** 页面送来的候选项：{ key: { 名称, 选项:[中文标签…] } }。形状不对就当没送。 */
function cleanCat(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const cat = {};
  for (const [k, g] of Object.entries(raw).slice(0, 12)) {
    if (!/^[a-z_]{1,20}$/i.test(k) || !Array.isArray(g?.选项)) continue;
    const 选项 = g.选项.slice(0, 12).map((o) => String(o).slice(0, 40));
    if (选项.length >= 2) cat[k] = { 名称: String(g.名称 || k).slice(0, 20), 选项 };
  }
  return Object.keys(cat).length ? cat : null;
}

/** 模型给的选项映射对着候选项校一遍：索引越界、字段缺失的整组丢掉，不猜。 */
function cleanPicks(got, cat) {
  const out = {};
  for (const [k, g] of Object.entries(cat)) {
    const i = Number(got?.[k]?.pick);
    if (!Number.isInteger(i) || i < 0 || i >= g.选项.length) continue;
    const mis = got[k].mismatch;
    out[k] = {
      pick: i,
      label: g.选项[i],
      why: String(got[k].why ?? '').slice(0, 40),
      // 对得上时模型可能回 null、也可能回字符串 "null"／空串，都算没有错配
      mismatch: mis && mis !== 'null' && String(mis).trim() ? String(mis).slice(0, 120) : null,
    };
  }
  return Object.keys(out).length ? out : null;
}

function cleanGeom(g) {
  if (!g || typeof g !== 'object') return null;
  const pick = (v, ok) => (ok.includes(v) ? v : null);
  const str = (v, n) => (v && v !== 'null' && String(v).trim() ? String(v).slice(0, n) : null);
  const type = pick(g.type, ['bare', 'suspended', 'mixed']);
  const baseKind = pick(g.baseKind, ['clay', 'bare']);
  if (!type && !baseKind) return null;
  return { type, baseKind, clear: str(g.clear, 40), note: str(g.note, 160) };
}

/** 模型不一定老实回纯 JSON：可能裹 ```json 围栏，也可能前后带一句话。都要能捞出来。 */
function parseLoose(txt) {
  const t = String(txt).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch { /* 再试从第一个 { 到最后一个 } */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('返回里找不到 JSON');
  return JSON.parse(t.slice(a, b + 1));
}

async function vision(key, model, dataUrl, withCap, ask, jsonMode = true) {
  const body = {
    model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: ask },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    }],
  };
  if (jsonMode) body.response_format = { type: 'json_object' };
  if (withCap) body.max_tokens = 1600;      // 多读两段，上限跟着抬
  const r = await fetch(`${VISION_BASE()}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const txt = await r.text();
  let json = null;
  try { json = JSON.parse(txt); } catch { /* 留原文 */ }
  return { ok: r.ok, status: r.status, json, txt };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: '只接受 POST' });

  const { pin, image, options = null } = req.body || {};
  if (!pinOk(pin)) {
    await sleep(1200);
    return res.status(401).json({ error: '门禁码不对' });
  }
  if (typeof image !== 'string' || !image.startsWith('data:image/')) {
    return res.status(400).json({ error: '没有收到图片' });
  }
  const keyName = onQwen() ? 'DASHSCOPE_API_KEY' : 'OPENAI_API_KEY';
  const key = process.env.VISION_API_KEY || process.env[keyName];
  if (!key) return res.status(500).json({ error: `服务端没配 ${keyName}` });

  // 模型可用环境变量 VISION_MODEL 覆盖；不填就按端点给默认值，失败再退一档
  // 千问侧用 qwen3.x 多模态旗舰。qwen-vl-max／plus 在百炼已标「即将下线」，只留作兜底。
  const models = [process.env.VISION_MODEL,
                  ...(onQwen() ? ['qwen3.8-max', 'qwen3.7-plus', 'qwen-vl-max']
                               : ['gpt-4o', 'gpt-4o-mini'])]
    .filter(Boolean);
  const cat = cleanCat(options);
  const ask = askWith(cat);
  let out = null;
  for (const m of models) {
    out = await vision(key, m, image, true, ask);
    if (!out.ok && /max_tokens|max_completion_tokens/i.test(out.txt)) {
      out = await vision(key, m, image, false, ask);  // 新模型改用别的参数名，就不带上限重试
    }
    if (!out.ok && /response_format|json_object/i.test(out.txt)) {
      out = await vision(key, m, image, true, ask, false);   // 不认 JSON 模式就去掉，靠 parseLoose 兜
    }
    if (out.ok) break;
    if (!/model|not found|does not exist|unsupported/i.test(out.txt)) break;  // 不是模型问题就别再换
  }
  if (!out?.ok) {
    const msg = out?.json?.error?.message || out?.txt?.slice(0, 300) || '未知错误';
    return res.status(out?.status || 502).json({ error: `读取风格失败：${msg}` });
  }

  try {
    const parsed = parseLoose(out.json.choices[0].message.content);
    const en = String(parsed.en || '').trim();
    const zh = Array.isArray(parsed.zh) ? parsed.zh.map(String) : [];
    if (!en) throw new Error('返回里没有 en');
    // 选项和几何是加分项：读不出来就不给，别因为它们把整次读图判失败
    const picks = cat ? cleanPicks(parsed.options, cat) : null;
    return res.status(200).json({ en, zh, options: picks, geometry: cleanGeom(parsed.geometry) });
  } catch (e) {
    return res.status(502).json({ error: `解析失败：${e.message}` });
  }
}
