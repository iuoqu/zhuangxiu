const { test } = require('node:test');
const assert = require('node:assert/strict');
const moduleUnderTest = () => import('./extract-plan-dimensions.js');
const response = () => ({ code: 0, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const zone = (id = 'zone-1') => ({ id, kind: 'living', imageDataUrl: 'data:image/jpeg;base64,AAAA' });

test('printed feet and metric pairs convert to millimetres; unlabeled text stays unknown', async () => {
  const { parsePrintedPair, cleanCandidates } = await moduleUnderTest();
  assert.deepEqual(parsePrintedPair('12′ 0″ × 12′ 10″'), { width: 3658, depth: 3912 });
  assert.deepEqual(parsePrintedPair('3.6m × 4.2m'), { width: 3600, depth: 4200 });
  assert.equal(parsePrintedPair('12′0″ and 12′10″ × unrelated'), null);
  assert.equal(parsePrintedPair('DINING'), null);
  assert.deepEqual(cleanCandidates({ rooms: [
    { zoneId: 'living', rawText: '12′0″ × 12′10″' },
    { zoneId: 'forged', rawText: '99m × 99m' },
  ] }, [zone('living'), zone('dining')]), [
    { zoneId: 'living', evidence: '12′0″ × 12′10″', dimensionsMm: { width: 3658, depth: 3912 } },
    { zoneId: 'dining', evidence: '', dimensionsMm: null },
  ]);
});

test('endpoint rejects an invalid PIN and malformed image without sending data upstream', async () => {
  const { default: handler } = await moduleUnderTest();
  const priorPin = process.env.BRIEF_PIN, priorKey = process.env.OPENAI_API_KEY, oldFetch = global.fetch;
  try {
    process.env.BRIEF_PIN = 'test-pin'; process.env.OPENAI_API_KEY = 'test-key';
    global.fetch = () => { throw Error('provider should not be called'); };
    let res = response(); await handler({ method: 'POST', body: { pin: 'wrong', zones: [zone()] } }, res);
    assert.equal(res.code, 401);
    res = response(); await handler({ method: 'POST', body: { pin: 'test-pin', zones: [{ ...zone(), imageDataUrl: 'https://other.example/image.jpg' }] } }, res);
    assert.equal(res.code, 400);
  } finally {
    if (priorPin === undefined) delete process.env.BRIEF_PIN; else process.env.BRIEF_PIN = priorPin;
    if (priorKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = priorKey;
    global.fetch = oldFetch;
  }
});

test('endpoint asks for image reading with strict output and returns a bounded draft', async () => {
  const { default: handler } = await moduleUnderTest();
  const priorPin = process.env.BRIEF_PIN, priorKey = process.env.OPENAI_API_KEY, oldFetch = global.fetch;
  let sent;
  try {
    process.env.BRIEF_PIN = 'test-pin'; process.env.OPENAI_API_KEY = 'test-key';
    global.fetch = async (url, options) => {
      sent = { url, body: JSON.parse(options.body) };
      return { ok: true, json: async () => ({ output_text: JSON.stringify({ rooms: [
        { zoneId: 'zone-1', rawText: '12′0″ × 12′10″' },
      ] }) }) };
    };
    const res = response();
    await handler({ method: 'POST', body: { pin: 'test-pin', zones: [zone()] } }, res);
    assert.equal(res.code, 200);
    assert.deepEqual(res.body.candidates[0].dimensionsMm, { width: 3658, depth: 3912 });
    assert.equal(sent.url, 'https://api.openai.com/v1/responses');
    assert.equal(sent.body.store, false);
    assert.equal(sent.body.text.format.strict, true);
    assert.equal(sent.body.input[1].content[2].type, 'input_image');
  } finally {
    if (priorPin === undefined) delete process.env.BRIEF_PIN; else process.env.BRIEF_PIN = priorPin;
    if (priorKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = priorKey;
    global.fetch = oldFetch;
  }
});
