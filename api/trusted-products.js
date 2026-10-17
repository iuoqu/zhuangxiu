import { timingSafeEqual } from 'node:crypto';
import { loadTrustedCatalog } from '../src/domain/trusted-catalog.js';

const pinOk = (got, want) => {
  if (!want || typeof got !== 'string') return false;
  const a = Buffer.from(got), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
};

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}; }
  catch { return res.status(400).json({ error: 'Invalid JSON request' }); }
  if (!process.env.PRODUCT_PIN) return res.status(503).json({ error: 'Product access is not configured' });
  if (!pinOk(body.pin, process.env.PRODUCT_PIN)) return res.status(401).json({ error: 'Access code required or incorrect' });
  if (!process.env.TRUSTED_PRODUCT_CATALOG_JSON) return res.status(503).json({ error: 'Approved product catalog is not configured' });
  try {
    const catalog = loadTrustedCatalog(JSON.parse(process.env.TRUSTED_PRODUCT_CATALOG_JSON));
    return res.status(200).json(catalog);
  } catch {
    return res.status(503).json({ error: 'Approved product catalog is invalid' });
  }
}
