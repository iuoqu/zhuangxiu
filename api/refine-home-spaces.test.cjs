const { test } = require('node:test');
const assert = require('node:assert/strict');
const moduleUnderTest = () => import('./refine-home-spaces.js');
const response = () => ({ code: 0, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const anchor = { id: 1, kind: 'bedroom', x: 300, y: 280, evidence: 'bedroom label', labelText: 'BEDROOM',
  crop: { x: 100, y: 100, w: 500, h: 400, imageDataUrl: 'data:image/jpeg;base64,AAAA' } };
const request = () => ({ method: 'POST', body: { pin: 'test-pin', widthPx: 1000, heightPx: 800, anchors: [anchor] } });

test('refinement maps crop coordinates back to the original image and keeps room evidence', async () => {
  const { cleanRefinedSpaces } = await moduleUnderTest();
  const result = cleanRefinedSpaces({ results: [{ id: 1, status: 'bounded', x: 200, y: 200,
    w: 600, h: 500, boundaryEvidence: 'walls and doorway', outline: [
      { x: 200, y: 200 }, { x: 800, y: 200 }, { x: 800, y: 700 }, { x: 200, y: 700 },
    ] }] }, [anchor], 1000, 800);
  assert.equal(result.unresolved.length, 0);
  assert.deepEqual(result.spaces[0], { id: 1, kind: 'bedroom', x: 200, y: 180, w: 300, h: 200,
    anchorX: 300, anchorY: 280, evidence: 'bedroom label', labelText: 'BEDROOM',
    support: 'bedroom label；walls and doorway', boundaryPolygon: [
      { x: 200, y: 180 }, { x: 500, y: 180 }, { x: 500, y: 380 }, { x: 200, y: 380 },
    ], segmentationRisk: false });
});

test('furniture-only box, missing boundary and crop-clipped proposal stay unresolved or risky', async () => {
  const { cleanRefinedSpaces } = await moduleUnderTest();
  const small = cleanRefinedSpaces({ results: [{ id: 1, status: 'bounded', x: 700, y: 200,
    w: 100, h: 200, boundaryEvidence: 'bed' }] }, [anchor], 1000, 800);
  assert.equal(small.spaces.length, 0);
  assert.equal(small.unresolved.length, 1);
  assert.equal(Object.hasOwn(small.unresolved[0], 'crop'), false,
    'API must not echo uploaded image crops into diagnostics');
  const clipped = cleanRefinedSpaces({ results: [{ id: 1, status: 'bounded', x: 0, y: 100,
    w: 700, h: 700, boundaryEvidence: 'walls' }] }, [anchor], 1000, 800);
  assert.equal(clipped.spaces[0].segmentationRisk, true);
  assert.equal(Object.hasOwn(clipped.spaces[0], 'boundaryPolygon'), false);
  const uncertain = cleanRefinedSpaces({ results: [{ id: 1, status: 'uncertain', x: 0, y: 0,
    w: 0, h: 0, boundaryEvidence: '' }] }, [anchor], 1000, 800);
  assert.equal(uncertain.spaces.length, 0);
});

test('refinement endpoint checks access and requests independent structured crop decisions', async () => {
  const { default: handler } = await moduleUnderTest();
  const priorPin = process.env.BRIEF_PIN, priorKey = process.env.OPENAI_API_KEY;
  const priorBoundaryModel = process.env.OPENAI_BOUNDARY_MODEL, oldFetch = global.fetch;
  let sent;
  try {
    process.env.BRIEF_PIN = 'test-pin'; process.env.OPENAI_API_KEY = 'test-key';
    process.env.OPENAI_BOUNDARY_MODEL = 'test-boundary-model';
    global.fetch = async (url, options) => {
      sent = { url, body: JSON.parse(options.body) };
      return { ok: true, json: async () => ({ output_text: JSON.stringify({ results: [
        { id: 1, status: 'bounded', x: 200, y: 200, w: 600, h: 500,
          boundaryEvidence: 'walls and doorway', outline: [
            { x: 200, y: 200 }, { x: 800, y: 200 }, { x: 800, y: 700 }, { x: 200, y: 700 },
          ] },
      ] }) }) };
    };
    let res = response(); await handler({ ...request(), body: { ...request().body, pin: 'wrong' } }, res);
    assert.equal(res.code, 401);
    res = response(); await handler({ ...request(), body: { ...request().body,
      anchors: [{ ...anchor, crop: { ...anchor.crop, imageDataUrl: 'https://evil.invalid/a.jpg' } }] } }, res);
    assert.equal(res.code, 400);
    res = response(); await handler(request(), res);
    assert.equal(res.code, 200);
    assert.equal(res.body.spaces[0].kind, 'bedroom');
    assert.equal(sent.url, 'https://api.openai.com/v1/responses');
    assert.equal(sent.body.store, false);
    assert.equal(sent.body.model, 'test-boundary-model');
    assert.equal(sent.body.text.format.strict, true);
    assert.equal(sent.body.input[1].content[2].type, 'input_image');
    assert.match(sent.body.input[0].content, /WHOLE room/);
  } finally {
    if (priorPin === undefined) delete process.env.BRIEF_PIN; else process.env.BRIEF_PIN = priorPin;
    if (priorKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = priorKey;
    if (priorBoundaryModel === undefined) delete process.env.OPENAI_BOUNDARY_MODEL;
    else process.env.OPENAI_BOUNDARY_MODEL = priorBoundaryModel;
    global.fetch = oldFetch;
  }
});
