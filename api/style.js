// POST { pin, image } → { en, zh: [...] }
// 把一张风格参考图「读」成可直接用的材质／光照描述。
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

const ASK = `You are an interior design analyst. Look at this reference photograph and describe ONLY
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

async function vision(key, model, dataUrl, withCap) {
  const body = {
    model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: ASK },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    }],
    response_format: { type: 'json_object' },
  };
  if (withCap) body.max_tokens = 900;
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
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

  const { pin, image } = req.body || {};
  if (!pinOk(pin)) {
    await sleep(1200);
    return res.status(401).json({ error: '门禁码不对' });
  }
  if (typeof image !== 'string' || !image.startsWith('data:image/')) {
    return res.status(400).json({ error: '没有收到图片' });
  }
  const key = process.env.OPENAI_API_KEY;
  if (!key) return res.status(500).json({ error: '服务端没配 OPENAI_API_KEY' });

  // 模型可用环境变量 VISION_MODEL 覆盖；默认 gpt-4o，失败再退一档
  const models = [process.env.VISION_MODEL, 'gpt-4o', 'gpt-4o-mini'].filter(Boolean);
  let out = null;
  for (const m of models) {
    out = await vision(key, m, image, true);
    if (!out.ok && /max_tokens|max_completion_tokens/i.test(out.txt)) {
      out = await vision(key, m, image, false);       // 新模型改用别的参数名，就不带上限重试
    }
    if (out.ok) break;
    if (!/model|not found|does not exist|unsupported/i.test(out.txt)) break;  // 不是模型问题就别再换
  }
  if (!out?.ok) {
    const msg = out?.json?.error?.message || out?.txt?.slice(0, 300) || '未知错误';
    return res.status(out?.status || 502).json({ error: `读取风格失败：${msg}` });
  }

  try {
    const parsed = JSON.parse(out.json.choices[0].message.content);
    const en = String(parsed.en || '').trim();
    const zh = Array.isArray(parsed.zh) ? parsed.zh.map(String) : [];
    if (!en) throw new Error('返回里没有 en');
    return res.status(200).json({ en, zh });
  } catch (e) {
    return res.status(502).json({ error: `解析失败：${e.message}` });
  }
}
