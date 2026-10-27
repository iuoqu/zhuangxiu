const { test } = require('node:test');
const assert = require('node:assert/strict');
const moduleUnderTest = () => import('./find-home-spaces.js');
const response = () => ({ code: 0, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const request = (pin = 'test-pin') => ({ method: 'POST', body: {
  pin, imageDataUrl: 'data:image/jpeg;base64,AAAA', widthPx: 1000, heightPx: 800,
  overview: { reviewed: true, floorCount: 1, bedroomCount: 1, livingCount: 1,
    bathroomCount: 1, hasMezzanine: false },
} });

test('anchor pass keeps evidenced room points and rejects duplicates or invalid coordinates', async () => {
  const { cleanSpaceSuggestions } = await moduleUnderTest();
  assert.deepEqual(cleanSpaceSuggestions({ spaces: [
    { kind: 'bedroom', anchorX: 100, anchorY: 100, evidenceText: 'bedroom label', labelText: 'BEDROOM' },
    { kind: 'bedroom', anchorX: 102, anchorY: 102, evidenceText: 'same bed', labelText: null },
    { kind: 'living', anchorX: 380, anchorY: 100, evidenceText: 'sofa', labelText: null },
    { kind: 'bedroom', anchorX: -1, anchorY: 100, evidenceText: 'invalid', labelText: null },
    { kind: 'unknown', anchorX: 900, anchorY: 900, evidenceText: 'invalid', labelText: null },
  ] }, 1000, 800), [
    { id: 1, kind: 'bedroom', x: 100, y: 80, evidence: 'bedroom label', labelText: 'BEDROOM' },
    { id: 2, kind: 'living', x: 380, y: 80, evidence: 'sofa', labelText: '' },
  ]);
});

test('clear OCR labels correct matching AI anchors without inventing room boundaries', async () => {
  const { groundSpaceSuggestions } = await moduleUnderTest();
  const spaces = [
    { id: 1, kind: 'bedroom', x: 192, y: 192, evidence: 'bed', labelText: '' },
    { id: 2, kind: 'living', x: 480, y: 384, evidence: 'sofa', labelText: '' },
    { id: 3, kind: 'bathroom', x: 100, y: 700, evidence: 'sink', labelText: '' },
  ];
  const result = groundSpaceSuggestions(spaces, [
    { kind: 'bedroom', x: 292, y: 350, confidence: 95, text: 'BEDROOM' },
    { kind: 'living', x: 620, y: 444, confidence: 94, text: 'LIVING' },
    { kind: 'bathroom', x: 250, y: 800, confidence: 30, text: 'BATH' },
  ], 960, 1280);
  assert.deepEqual(result.map(({ x, y }) => [x, y]), [[292, 350], [620, 444], [100, 700]]);
  assert.equal(result[0].anchorSource, 'ocr_label');
  assert.equal(result[2].anchorSource, undefined);
  assert.deepEqual(spaces.map(({ x, y }) => [x, y]), [[192, 192], [480, 384], [100, 700]]);
  const bedrooms = groundSpaceSuggestions([
    { id: 1, kind: 'bedroom', x: 200, y: 300, evidence: 'bed', labelText: '' },
    { id: 2, kind: 'bedroom', x: 800, y: 300, evidence: 'bed', labelText: '' },
  ], [
    { kind: 'bedroom', x: 230, y: 330, confidence: 95, text: 'BEDROOM' },
    { kind: 'bedroom', x: 830, y: 330, confidence: 94, text: 'BEDROOM' },
  ], 1000, 800);
  assert.deepEqual(bedrooms.map(({ x, y }) => [x, y]), [[230, 330], [830, 330]]);
});

test('geometry endpoint enforces access, reviewed overview and image bounds', async () => {
  const { default: handler } = await moduleUnderTest();
  const priorPin = process.env.BRIEF_PIN, priorKey = process.env.OPENAI_API_KEY, oldFetch = global.fetch;
  try {
    process.env.BRIEF_PIN = 'test-pin'; process.env.OPENAI_API_KEY = 'test-key';
    global.fetch = () => { throw Error('provider should not be called'); };
    let res = response(); await handler(request('wrong'), res); assert.equal(res.code, 401);
    res = response(); await handler({ method: 'POST', body: { ...request().body,
      overview: { reviewed: false } } }, res); assert.equal(res.code, 400);
    res = response(); await handler({ method: 'POST', body: { ...request().body,
      imageDataUrl: 'https://other.example/plan.jpg' } }, res); assert.equal(res.code, 400);
  } finally {
    if (priorPin === undefined) delete process.env.BRIEF_PIN; else process.env.BRIEF_PIN = priorPin;
    if (priorKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = priorKey;
    global.fetch = oldFetch;
  }
});

test('anchor endpoint asks the model for semantic points, not grid rectangles', async () => {
  const { default: handler } = await moduleUnderTest();
  const priorPin = process.env.BRIEF_PIN, priorKey = process.env.OPENAI_API_KEY, oldFetch = global.fetch;
  let sent;
  try {
    process.env.BRIEF_PIN = 'test-pin'; process.env.OPENAI_API_KEY = 'test-key';
    global.fetch = async (url, options) => {
      sent = { url, body: JSON.parse(options.body) };
      return { ok: true, json: async () => ({ output_text: JSON.stringify({ spaces: [
        { kind: 'bedroom', anchorX: 100, anchorY: 100, evidenceText: 'bed', labelText: null },
      ] }) }) };
    };
    const res = response(); await handler(request(), res);
    assert.equal(res.code, 200);
    assert.equal(res.body.spaces.length, 1);
    assert.equal(sent.body.store, false);
    assert.equal(sent.body.text.format.strict, true);
    assert.equal(sent.body.input[1].content[1].type, 'input_image');
    assert.equal(sent.body.text.format.schema.properties.spaces.items.properties.kind.type, 'string');
    assert.equal(sent.body.text.format.schema.properties.spaces.items.properties.anchorX.type, 'integer');
    assert.equal(sent.body.text.format.schema.properties.spaces.items.properties.w, undefined);
    assert.match(sent.body.input[0].content, /printed words are optional/i);
    assert.match(sent.body.input[0].content, /reviewed whole-plan checklist is 1 bedroom/i);
    assert.doesNotMatch(sent.body.input[0].content, /each blue grid interval/i);
  } finally {
    if (priorPin === undefined) delete process.env.BRIEF_PIN; else process.env.BRIEF_PIN = priorPin;
    if (priorKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = priorKey;
    global.fetch = oldFetch;
  }
});
