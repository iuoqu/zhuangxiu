const { test } = require('node:test');
const assert = require('node:assert/strict');
const moduleUnderTest = () => import('./suggest-home-zones.js');
const response = () => ({ code: 0, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const request = (pin = 'test-pin') => ({ method: 'POST', body: {
  pin, imageDataUrl: 'data:image/jpeg;base64,AAAA', widthPx: 1000, heightPx: 800,
} });

test('zone suggestions reject invalid boxes and keep size text as a draft', async () => {
  const { cleanZoneSuggestions } = await moduleUnderTest();
  assert.deepEqual(cleanZoneSuggestions({ zones: [
    { kind: 'living', x: 100, y: 100, w: 300, h: 400, labelText: 'LIVING', labelX: 240, labelY: 280,
      printedPair: '12′0″ × 12′10″' },
    { kind: 'bedroom', x: 980, y: 100, w: 100, h: 200, printedPair: null },
    { kind: 'unknown', x: 100, y: 100, w: 300, h: 400, printedPair: null },
    { kind: 'dining', x: 400, y: 600, w: 200, h: 200, labelText: 'DINING', labelX: 500, labelY: 700,
      printedPair: null },
  ] }, 1000, 800), [
    { id: 'suggestion-1', kind: 'living', x: 100, y: 80, w: 300, h: 320,
      evidence: '12′0″ × 12′10″', dimensionsMm: { width: 3658, depth: 3912 }, labelText: 'LIVING' },
    { id: 'suggestion-2', kind: 'dining', x: 400, y: 480, w: 200, h: 160,
      evidence: '', dimensionsMm: null, labelText: 'DINING' },
  ]);
});

test('furniture zones without matching printed room text inside the box are rejected', async () => {
  const { cleanZoneSuggestions } = await moduleUnderTest();
  const result = cleanZoneSuggestions({ zones: [
    { kind: 'mezzanine', x: 100, y: 100, w: 250, h: 250,
      labelText: 'BALCONY', labelX: 200, labelY: 200, printedPair: null },
    { kind: 'bedroom', x: 400, y: 100, w: 250, h: 250,
      labelText: 'BEDROOM', labelX: 700, labelY: 200, printedPair: null },
    { kind: 'living', x: 100, y: 400, w: 250, h: 250,
      labelText: null, labelX: null, labelY: null, printedPair: null },
    { kind: 'deck', x: 100, y: 100, w: 250, h: 250,
      labelText: 'BALCONY', labelX: 200, labelY: 200, printedPair: null },
  ] }, 1000, 1000);
  assert.deepEqual(result.map(zone => zone.kind), ['deck']);
});

test('zone endpoint requires access code and a bounded image before provider use', async () => {
  const { default: handler } = await moduleUnderTest();
  const priorPin = process.env.BRIEF_PIN, priorKey = process.env.OPENAI_API_KEY, oldFetch = global.fetch;
  try {
    process.env.BRIEF_PIN = 'test-pin'; process.env.OPENAI_API_KEY = 'test-key';
    global.fetch = () => { throw Error('provider should not be called'); };
    let res = response(); await handler(request('wrong'), res); assert.equal(res.code, 401);
    res = response(); await handler({ method: 'POST', body: { ...request().body,
      imageDataUrl: 'https://other.example/plan.jpg' } }, res); assert.equal(res.code, 400);
  } finally {
    if (priorPin === undefined) delete process.env.BRIEF_PIN; else process.env.BRIEF_PIN = priorPin;
    if (priorKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = priorKey;
    global.fetch = oldFetch;
  }
});

test('zone endpoint uses structured vision output and returns only sanitized candidates', async () => {
  const { default: handler } = await moduleUnderTest();
  const priorPin = process.env.BRIEF_PIN, priorKey = process.env.OPENAI_API_KEY, oldFetch = global.fetch;
  let sent;
  try {
    process.env.BRIEF_PIN = 'test-pin'; process.env.OPENAI_API_KEY = 'test-key';
    global.fetch = async (url, options) => {
      sent = { url, body: JSON.parse(options.body) };
      return { ok: true, json: async () => ({ output_text: JSON.stringify({ zones: [
        { kind: 'living', x: 100, y: 100, w: 300, h: 400,
          labelText: 'LIVING', labelX: 240, labelY: 280, printedPair: '12′0″ × 12′10″' },
      ] }) }) };
    };
    const res = response(); await handler(request(), res);
    assert.equal(res.code, 200);
    assert.equal(res.body.suggestions.length, 1);
    assert.deepEqual(res.body.suggestions[0].dimensionsMm, { width: 3658, depth: 3912 });
    assert.equal(sent.url, 'https://api.openai.com/v1/responses');
    assert.equal(sent.body.store, false);
    assert.equal(sent.body.text.format.strict, true);
    assert.ok(sent.body.text.format.schema.properties.zones.items.properties.labelText);
    assert.equal(sent.body.input[1].content[1].type, 'input_image');
  } finally {
    if (priorPin === undefined) delete process.env.BRIEF_PIN; else process.env.BRIEF_PIN = priorPin;
    if (priorKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = priorKey;
    global.fetch = oldFetch;
  }
});
