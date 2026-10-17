const { test } = require('node:test');
const assert = require('node:assert/strict');
const moduleUnderTest = () => import('./extract-products.js');
function response() {
  return {
    code: 0, setHeader() {}, status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
}
const source = { id: 'fixture', ref: 'fixture:desk-page', observedAt: '2026-10-14T00:00:00.000Z' };
const text = 'Oak desk SKU D-140. Width 140 cm, depth 70 cm. Price USD 450. In stock.';
const extracted = {
  products: [{
    category: 'desk',
    role: 'workstation',
    name: { value: 'Oak desk', evidence: 'Oak desk' },
    supplierSku: { value: 'D-140', evidence: 'SKU D-140' },
    variantCode: { value: null, evidence: null },
    widthMm: { value: 1400, evidence: 'Width 140 cm' },
    depthMm: { value: 700, evidence: 'depth 70 cm' },
    heightMm: { value: 750, evidence: '750 mm' },
    priceAmount: { value: 450, evidence: 'Price USD 450' },
    currency: { value: 'USD', evidence: 'USD 450' },
    availability: { value: 'in_stock', evidence: 'In stock' },
    leadDays: { value: null, evidence: null },
  }],
  unresolved: ['Chair model not stated'],
};

test('AI facts without literal evidence stay unknown and never become verified supply', async () => {
  const { cleanProductExtraction } = await moduleUnderTest();
  const result = cleanProductExtraction(extracted, text, source);
  assert.equal(result.candidates.length, 1);
  const candidate = result.candidates[0];
  assert.equal(candidate.supplierSku, 'D-140');
  assert.equal(candidate.name, 'Oak desk');
  assert.equal(candidate.category, 'desk');
  assert.equal(candidate.dimensionsMm.width, 1400);
  assert.equal(candidate.dimensionsMm.height, null);
  assert.equal(candidate.fieldSources.widthMm.quote, 'Width 140 cm');
  assert.deepEqual(candidate.verification, { spec: false, price: false, availability: false, use: false });
  assert.deepEqual(result.unresolved, ['Chair model not stated']);
});

test('AI can collect wardrobe use facts as research without verifying their clearance', async () => {
  const { cleanProductExtraction } = await moduleUnderTest();
  const description = 'Wardrobe W-1 with hinged doors. Front opening clearance 80 cm.';
  const result = cleanProductExtraction({ products: [{
    category: 'wardrobe', role: 'wardrobe',
    name: { value: 'Wardrobe', evidence: 'Wardrobe' },
    supplierSku: { value: 'W-1', evidence: 'W-1' },
    doorMechanism: { value: 'hinged', evidence: 'hinged doors' },
    frontClearanceMm: { value: 800, evidence: '80 cm' },
  }] }, description, source);
  assert.deepEqual(result.candidates[0].useSpec, { doorMechanism: 'hinged', frontClearanceMm: 800 });
  assert.equal(result.candidates[0].fieldSources.frontClearanceMm.quote, '80 cm');
  assert.equal(result.candidates[0].verification.use, false);
});

test('product extraction rejects an invalid access code before calling the provider', async () => {
  const { default: handler } = await moduleUnderTest();
  const oldPin = process.env.PRODUCT_PIN, oldKey = process.env.OPENAI_API_KEY, oldFetch = global.fetch;
  try {
    process.env.PRODUCT_PIN = 'test-pin'; process.env.OPENAI_API_KEY = 'test-key';
    global.fetch = () => { throw new Error('provider should not be called'); };
    const res = response();
    await handler({ method: 'POST', body: { pin: 'wrong', sourceId: 'fixture', sourceRef: 'fixture:page', text } }, res);
    assert.equal(res.code, 401);
  } finally {
    if (oldPin === undefined) delete process.env.PRODUCT_PIN; else process.env.PRODUCT_PIN = oldPin;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey;
    global.fetch = oldFetch;
  }
});

test('product extraction sends strict schema and returns research candidates', async () => {
  const { default: handler } = await moduleUnderTest();
  const oldPin = process.env.PRODUCT_PIN, oldKey = process.env.OPENAI_API_KEY, oldFetch = global.fetch;
  let request;
  try {
    process.env.PRODUCT_PIN = 'test-pin'; process.env.OPENAI_API_KEY = 'test-key';
    global.fetch = async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ output: [{ content: [{ type: 'output_text', text: JSON.stringify(extracted) }] }] }) };
    };
    const res = response();
    await handler({ method: 'POST', body: { pin: 'test-pin', sourceId: 'fixture', sourceRef: 'fixture:desk-page', text } }, res);
    assert.equal(res.code, 200);
    assert.equal(res.body.candidates[0].supplierSku, 'D-140');
    assert.equal(res.body.candidates[0].verification.spec, false);
    assert.equal(request.url, 'https://api.openai.com/v1/responses');
    const sent = JSON.parse(request.options.body);
    assert.equal(sent.text.format.type, 'json_schema');
    assert.equal(sent.text.format.strict, true);
    assert.equal(sent.store, false);
    assert.equal(sent.input[1].content, text);
  } finally {
    if (oldPin === undefined) delete process.env.PRODUCT_PIN; else process.env.PRODUCT_PIN = oldPin;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey;
    global.fetch = oldFetch;
  }
});
