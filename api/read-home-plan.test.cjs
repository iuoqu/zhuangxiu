const { test } = require('node:test');
const assert = require('node:assert/strict');
const moduleUnderTest = () => import('./read-home-plan.js');
const response = () => ({ code: 0, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const request = (pin = 'test-pin') => ({ method: 'POST', body: {
  pin, imageDataUrl: 'data:image/jpeg;base64,AAAA', widthPx: 1000, heightPx: 800,
} });

test('whole-plan reading bounds counts and keeps only short visible evidence', async () => {
  const { cleanPlanOverview } = await moduleUnderTest();
  assert.deepEqual(cleanPlanOverview({ floorCount: 2, bedroomCount: 1, livingCount: 1,
    bathroomCount: 1, hasMezzanine: true, floorEvidence: ['MEZZANINE'], roomEvidence: ['BEDROOM', 'LIVING'],
    uncertainties: [] }), { floorCount: 2, bedroomCount: 1, livingCount: 1, bathroomCount: 1,
    hasMezzanine: true, floorEvidence: ['MEZZANINE'], roomEvidence: ['BEDROOM', 'LIVING'], uncertainties: [] });
  assert.equal(cleanPlanOverview({ floorCount: 99 }).floorCount, null);
});

test('whole-plan endpoint requires access code and image before provider use', async () => {
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

test('whole-plan endpoint calls structured vision before room geometry', async () => {
  const { default: handler } = await moduleUnderTest();
  const priorPin = process.env.BRIEF_PIN, priorKey = process.env.OPENAI_API_KEY, oldFetch = global.fetch;
  let sent;
  try {
    process.env.BRIEF_PIN = 'test-pin'; process.env.OPENAI_API_KEY = 'test-key';
    global.fetch = async (url, options) => {
      sent = { url, body: JSON.parse(options.body) };
      return { ok: true, json: async () => ({ output_text: JSON.stringify({ floorCount: 2,
        bedroomCount: 1, livingCount: 1, bathroomCount: 1, hasMezzanine: true,
        floorEvidence: ['MEZZANINE'], roomEvidence: ['BEDROOM', 'LIVING', 'BATH'], uncertainties: [] }) }) };
    };
    const res = response(); await handler(request(), res);
    assert.equal(res.code, 200);
    assert.equal(res.body.overview.floorCount, 2);
    assert.deepEqual(res.body.overview.floorEvidence, ['MEZZANINE']);
    assert.equal(sent.url, 'https://api.openai.com/v1/responses');
    assert.equal(sent.body.store, false);
    assert.equal(sent.body.text.format.strict, true);
    assert.equal(sent.body.input[1].content[1].type, 'input_image');
    assert.match(sent.body.input[0].content, /does not produce room boxes/);
  } finally {
    if (priorPin === undefined) delete process.env.BRIEF_PIN; else process.env.BRIEF_PIN = priorPin;
    if (priorKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = priorKey;
    global.fetch = oldFetch;
  }
});
