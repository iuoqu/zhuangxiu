const { test } = require('node:test');
const assert = require('node:assert/strict');
const moduleUnderTest = () => import('./find-home-spaces.js');
const response = () => ({ code: 0, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const request = (pin = 'test-pin') => ({ method: 'POST', body: {
  pin, imageDataUrl: 'data:image/jpeg;base64,AAAA', widthPx: 1000, heightPx: 800,
  overview: { reviewed: true, floorCount: 1, bedroomCount: 1, livingCount: 1,
    bathroomCount: 1, hasMezzanine: false },
} });

test('geometry pass keeps valid unlabeled spaces and rejects duplicate or implausible boxes', async () => {
  const { cleanSpaceSuggestions } = await moduleUnderTest();
  assert.deepEqual(cleanSpaceSuggestions({ spaces: [
    { x: 100, y: 100, w: 250, h: 300 },
    { x: 102, y: 102, w: 249, h: 298 },
    { x: 380, y: 100, w: 300, h: 450 },
    { x: 10, y: 10, w: 15, h: 500 },
    { x: 900, y: 900, w: 200, h: 200 },
  ] }, 1000, 800), [
    { id: 1, x: 100, y: 80, w: 250, h: 240 },
    { id: 2, x: 380, y: 80, w: 300, h: 360 },
  ]);
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

test('geometry endpoint asks the model for spaces without required labels or classes', async () => {
  const { default: handler } = await moduleUnderTest();
  const priorPin = process.env.BRIEF_PIN, priorKey = process.env.OPENAI_API_KEY, oldFetch = global.fetch;
  let sent;
  try {
    process.env.BRIEF_PIN = 'test-pin'; process.env.OPENAI_API_KEY = 'test-key';
    global.fetch = async (url, options) => {
      sent = { url, body: JSON.parse(options.body) };
      return { ok: true, json: async () => ({ output_text: JSON.stringify({ spaces: [
        { x: 100, y: 100, w: 250, h: 300 },
      ] }) }) };
    };
    const res = response(); await handler(request(), res);
    assert.equal(res.code, 200);
    assert.equal(res.body.spaces.length, 1);
    assert.equal(sent.body.store, false);
    assert.equal(sent.body.text.format.strict, true);
    assert.equal(sent.body.input[1].content[1].type, 'input_image');
    assert.equal(sent.body.text.format.schema.properties.spaces.items.properties.kind, undefined);
    assert.match(sent.body.input[0].content, /printed words are optional/i);
    assert.match(sent.body.input[0].content, /reviewed whole-plan checklist is 1 bedroom/i);
  } finally {
    if (priorPin === undefined) delete process.env.BRIEF_PIN; else process.env.BRIEF_PIN = priorPin;
    if (priorKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = priorKey;
    global.fetch = oldFetch;
  }
});
