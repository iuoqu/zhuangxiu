const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('./trusted-products.js');
const domain = () => import('../src/domain/trusted-catalog.js');
const response = () => ({ code: 0, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const configuration = {
  sources: [{
    id: 'fixture-home', ref: 'fixture:reviewed-catalog', observedAt: '2026-10-15T00:00:00.000Z',
    trustSpecs: true, trustPrice: true, trustAvailability: true, trustUseSpec: true,
    useReviewedBy: 'fixture-reviewer', useReviewedAt: '2026-10-15T01:00:00.000Z',
    products: [{ category: 'wardrobe', sku: 'W-1', name: 'Wardrobe', widthMm: 1600, depthMm: 600, heightMm: 2200,
      priceAmount: 900, currency: 'USD', availability: 'in_stock', leadDays: 14, purchaseUnit: 'single',
      doorMechanism: 'hinged', frontClearanceMm: 800 }],
  }],
};

test('server-owned catalog keeps trust evidence and rejects malformed rows', async () => {
  const { loadTrustedCatalog } = await domain();
  const result = loadTrustedCatalog(configuration);
  assert.equal(result.sourceCount, 1);
  assert.equal(result.candidates[0].verification.use, true);
  assert.equal(result.candidates[0].fieldSources.frontClearanceMm.raw, '800');
  assert.throws(() => loadTrustedCatalog({ sources: [configuration.sources[0], configuration.sources[0]] }), /unique IDs/);
  assert.throws(() => loadTrustedCatalog({ sources: [{ ...configuration.sources[0], products: [{ category: 'not-a-category' }] }] }), /invalid product rows/);
});

test('approved catalog endpoint requires access and server configuration', async () => {
  const { default: handler } = await load();
  const oldPin = process.env.PRODUCT_PIN, oldCatalog = process.env.TRUSTED_PRODUCT_CATALOG_JSON;
  try {
    process.env.PRODUCT_PIN = 'fixture-pin';
    process.env.TRUSTED_PRODUCT_CATALOG_JSON = JSON.stringify(configuration);
    const unauthorized = response();
    handler({ method: 'POST', body: { pin: 'wrong' } }, unauthorized);
    assert.equal(unauthorized.code, 401);
    const authorized = response();
    handler({ method: 'POST', body: { pin: 'fixture-pin' } }, authorized);
    assert.equal(authorized.code, 200);
    assert.equal(authorized.body.candidates[0].supplierSku, 'W-1');
    delete process.env.TRUSTED_PRODUCT_CATALOG_JSON;
    const missing = response();
    handler({ method: 'POST', body: { pin: 'fixture-pin' } }, missing);
    assert.equal(missing.code, 503);
  } finally {
    if (oldPin === undefined) delete process.env.PRODUCT_PIN; else process.env.PRODUCT_PIN = oldPin;
    if (oldCatalog === undefined) delete process.env.TRUSTED_PRODUCT_CATALOG_JSON; else process.env.TRUSTED_PRODUCT_CATALOG_JSON = oldCatalog;
  }
});
