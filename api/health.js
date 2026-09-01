// GET /api/health —— 部署自检。不返回任何密钥内容，只报「有没有」。
import { readdir } from 'node:fs/promises';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const look = async (d) => {
    try { return (await readdir(d)).sort(); } catch (e) { return `读不到：${e.code || e.message}`; }
  };
  res.status(200).json({
    ok: true,
    时间: new Date().toISOString(),
    环境变量: {
      ENGINE: process.env.ENGINE || 'openai（默认，页面上可逐次切换）',
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ? `已配置（${process.env.OPENAI_API_KEY.length} 位）` : '缺失',
      DASHSCOPE_API_KEY: process.env.DASHSCOPE_API_KEY
        ? `已配置（${process.env.DASHSCOPE_API_KEY.length} 位）` : '缺失（选千问会报错）',
      QWEN_MODEL: process.env.QWEN_MODEL || '未设，用默认 qwen-image-edit-plus，失败退到 qwen-image-edit',
      DASHSCOPE_BASE: process.env.DASHSCOPE_BASE || 'https://dashscope.aliyuncs.com（北京，默认）',
      PIN: process.env.PIN ? `已配置（${process.env.PIN.length} 位）` : '缺失',
      VISION_BASE: process.env.VISION_BASE || '未设，读风格走 OpenAI',
      VISION_MODEL: process.env.VISION_MODEL || '未设，按 VISION_BASE 取默认值',
      GITHUB_TOKEN: process.env.GITHUB_TOKEN ? '已配置' : '缺失（出图不会自动存进仓库）',
      GITHUB_REPO: process.env.GITHUB_REPO || '缺失（出图不会自动存进仓库）',
      GITHUB_BRANCH: process.env.GITHUB_BRANCH || 'main（默认）',
      SAVE_DIR: process.env.SAVE_DIR || '产出（默认）',
    },
    node: process.version,
    工作目录: process.cwd(),
    根目录: await look(process.cwd()),
    refs: await look('refs'),
    lines: await look('lines'),
    clays: await look('clays'),
    bares: await look('bares'),
  });
}
