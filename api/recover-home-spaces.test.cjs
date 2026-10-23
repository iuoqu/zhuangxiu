const { test } = require('node:test');
const assert = require('node:assert/strict');
const moduleUnderTest = () => import('./recover-home-spaces.js');
const response = () => ({ code: 0, setHeader() {}, status(code) { this.code = code; return this; },
  json(body) { this.body = body; return this; } });
const request = () => ({ method: 'POST', body: {
  pin: 'test-pin', imageDataUrl: 'data:image/jpeg;base64,AAAA', widthPx: 1000, heightPx: 800,
  overview: { reviewed: true, bedroomCount: 2, livingCount: 1, bathroomCount: 1,
    hasMezzanine: false },
  knownZones: [{ kind: 'living', x: 100, y: 80, w: 200, h: 160 }],
  missingCounts: { bedroom: 2, living: 0, bathroom: 1, mezzanine: 0 },
} });

test('recovery keeps only evidenced missing rooms outside identified rooms and deduplicates', async () => {
  const { cleanRecoveredSpaces } = await moduleUnderTest();
  const result = cleanRecoveredSpaces({ spaces: [
    { kind: 'bedroom', x: 100, y: 100, w: 200, h: 200, evidenceText: 'bed' },
    { kind: 'bedroom', x: 400, y: 100, w: 200, h: 200, evidenceText: 'bed' },
    { kind: 'bedroom', x: 405, y: 105, w: 190, h: 190, evidenceText: 'same bed' },
    { kind: 'bathroom', x: 700, y: 100, w: 160, h: 200, evidenceText: 'toilet' },
    { kind: 'living', x: 400, y: 400, w: 200, h: 200, evidenceText: 'sofa' },
    { kind: 'bedroom', x: 400, y: 450, w: 200, h: 200, evidenceText: '' },
  ] }, 1000, 800, request().body.knownZones, request().body.missingCounts);
  assert.deepEqual(result, [
    { id: 1, x: 400, y: 80, w: 200, h: 160 },
    { id: 2, x: 700, y: 80, w: 160, h: 160 },
  ]);
});

test('recovery endpoint requires a reviewed plan, bounded request, and access code', async () => {
  const { default: handler } = await moduleUnderTest();
  const priorPin = process.env.BRIEF_PIN, priorKey = process.env.OPENAI_API_KEY, oldFetch = global.fetch;
  try {
    process.env.BRIEF_PIN = 'test-pin'; process.env.OPENAI_API_KEY = 'test-key';
    global.fetch = () => { throw Error('provider should not be called'); };
    let res = response(); await handler({ ...request(), body: { ...request().body, pin: 'bad' } }, res);
    assert.equal(res.code, 401);
    res = response(); await handler({ ...request(), body: { ...request().body,
      overview: { ...request().body.overview, reviewed: false } } }, res);
    assert.equal(res.code, 400);
    res = response(); await handler({ ...request(), body: { ...request().body,
      missingCounts: { bedroom: 3, living: 0, bathroom: 0, mezzanine: 0 } } }, res);
    assert.equal(res.code, 400);
    res = response(); await handler({ ...request(), body: { ...request().body,
      missingCounts: { bedroom: 0, living: 0, bathroom: 0, mezzanine: 0 } } }, res);
    assert.equal(res.code, 400);
  } finally {
    if (priorPin === undefined) delete process.env.BRIEF_PIN; else process.env.BRIEF_PIN = priorPin;
    if (priorKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = priorKey;
    global.fetch = oldFetch;
  }
});

test('recovery calls structured vision once and does not turn returned rectangles into approved rooms', async () => {
  const { default: handler } = await moduleUnderTest();
  const priorPin = process.env.BRIEF_PIN, priorKey = process.env.OPENAI_API_KEY, oldFetch = global.fetch;
  let sent, calls = 0;
  try {
    process.env.BRIEF_PIN = 'test-pin'; process.env.OPENAI_API_KEY = 'test-key';
    global.fetch = async (url, options) => {
      calls++; sent = { url, body: JSON.parse(options.body) };
      return { ok: true, json: async () => ({ output_text: JSON.stringify({ spaces: [
        { kind: 'bedroom', x: 400, y: 100, w: 200, h: 200, evidenceText: 'visible bed' },
      ] }) }) };
    };
    const res = response(); await handler(request(), res);
    assert.equal(res.code, 200);
    assert.equal(calls, 1);
    assert.deepEqual(res.body.spaces, [{ id: 1, x: 400, y: 80, w: 200, h: 160 }]);
    assert.equal(sent.url, 'https://api.openai.com/v1/responses');
    assert.equal(sent.body.store, false);
    assert.equal(sent.body.text.format.strict, true);
    assert.equal(sent.body.input[1].content[1].type, 'input_image');
    assert.match(sent.body.input[0].content, /do not force the expected counts/i);
  } finally {
    if (priorPin === undefined) delete process.env.BRIEF_PIN; else process.env.BRIEF_PIN = priorPin;
    if (priorKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = priorKey;
    global.fetch = oldFetch;
  }
});
