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
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ? `已配置（${process.env.OPENAI_API_KEY.length} 位）` : '缺失',
      PIN: process.env.PIN ? `已配置（${process.env.PIN.length} 位）` : '缺失',
    },
    node: process.version,
    工作目录: process.cwd(),
    根目录: await look(process.cwd()),
    refs: await look('refs'),
    lines: await look('lines'),
  });
}
