const { test } = require('node:test');
const assert = require('node:assert/strict');
const moduleUnderTest = () => import('./classify-home-spaces.js');
const response = () => ({ code: 0, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const spaces = [
  { id: 1, x: 20, y: 20, w: 200, h: 220, cropDataUrl: 'data:image/jpeg;base64,AAAA' },
  { id: 2, x: 300, y: 20, w: 220, h: 220, cropDataUrl: 'data:image/jpeg;base64,AAAA' },
  { id: 3, x: 600, y: 20, w: 220, h: 220, cropDataUrl: 'data:image/jpeg;base64,AAAA' },
];
const request = (pin = 'test-pin') => ({ method: 'POST', body: {
  pin, widthPx: 1000, heightPx: 800, spaces,
} });

test('crop pass can identify an unlabeled bedroom from a bed and hold an empty room as unknown', async () => {
  const { cleanClassifiedSpaces } = await moduleUnderTest();
  const result = cleanClassifiedSpaces({ results: [
    { id: 1, status: 'identified', kind: 'bedroom', evidenceKind: 'furniture',
      evidenceText: 'a bed inside the room', labelText: null, printedPair: null },
    { id: 2, status: 'identified', kind: 'kitchen', evidenceKind: 'geometry',
      evidenceText: 'rectangular area', labelText: null, printedPair: null },
    { id: 3, status: 'not_space', kind: 'unknown', evidenceKind: 'none',
      evidenceText: 'wall strip', labelText: null, printedPair: null },
  ] }, spaces);
  assert.deepEqual(result.suggestions.map(zone => zone.kind), ['bedroom', 'unknown']);
  assert.equal(result.suggestions[0].labelText, '');
  assert.match(result.suggestions[0].support, /bed/);
  assert.equal(result.uncertainCount, 1);
  assert.equal(result.rejectedCount, 1);
});

test('strong overlap keeps room evidence but marks both boundaries conflicted', async () => {
  const { cleanClassifiedSpaces } = await moduleUnderTest();
  const overlapping = [spaces[0], { ...spaces[1], x: 100, y: 90 }];
  const result = cleanClassifiedSpaces({ results: [
    { id: 1, status: 'identified', kind: 'bedroom', evidenceKind: 'furniture',
      evidenceText: 'bed', labelText: null, printedPair: null },
    { id: 2, status: 'identified', kind: 'living', evidenceKind: 'furniture',
      evidenceText: 'sofa', labelText: null, printedPair: null },
  ] }, overlapping);
  assert.deepEqual(result.suggestions.map(zone => zone.kind), ['bedroom', 'living']);
  assert.deepEqual(result.suggestions.map(zone => zone.boundaryConflict), [true, true]);
  assert.equal(result.uncertainCount, 0);
});

test('crop endpoint rejects untrusted images and duplicate IDs before provider use', async () => {
  const { default: handler } = await moduleUnderTest();
  const priorPin = process.env.BRIEF_PIN, priorKey = process.env.OPENAI_API_KEY, oldFetch = global.fetch;
  try {
    process.env.BRIEF_PIN = 'test-pin'; process.env.OPENAI_API_KEY = 'test-key';
    global.fetch = () => { throw Error('provider should not be called'); };
    let res = response(); await handler(request('wrong'), res); assert.equal(res.code, 401);
    res = response(); await handler({ method: 'POST', body: { ...request().body,
      spaces: [{ ...spaces[0], cropDataUrl: 'https://other.example/room.jpg' }] } }, res); assert.equal(res.code, 400);
    res = response(); await handler({ method: 'POST', body: { ...request().body,
      spaces: [spaces[0], { ...spaces[1], id: 1 }] } }, res); assert.equal(res.code, 400);
  } finally {
    if (priorPin === undefined) delete process.env.BRIEF_PIN; else process.env.BRIEF_PIN = priorPin;
    if (priorKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = priorKey;
    global.fetch = oldFetch;
  }
});

test('crop endpoint sends individually numbered images and preserves non-label evidence', async () => {
  const { default: handler } = await moduleUnderTest();
  const priorPin = process.env.BRIEF_PIN, priorKey = process.env.OPENAI_API_KEY, oldFetch = global.fetch;
  let sent;
  try {
    process.env.BRIEF_PIN = 'test-pin'; process.env.OPENAI_API_KEY = 'test-key';
    global.fetch = async (url, options) => {
      sent = { url, body: JSON.parse(options.body) };
      return { ok: true, json: async () => ({ output_text: JSON.stringify({ results: [
        { id: 1, status: 'identified', kind: 'bedroom', evidenceKind: 'furniture',
          evidenceText: 'bed', labelText: null, printedPair: null },
        { id: 2, status: 'uncertain', kind: 'unknown', evidenceKind: 'none',
          evidenceText: 'bare room', labelText: null, printedPair: null },
        { id: 3, status: 'not_space', kind: 'unknown', evidenceKind: 'none',
          evidenceText: 'wall', labelText: null, printedPair: null },
      ] }) }) };
    };
    const res = response(); await handler(request(), res);
    assert.equal(res.code, 200);
    assert.deepEqual(res.body.suggestions.map(zone => zone.kind), ['bedroom', 'unknown']);
    assert.equal(res.body.rejectedCount, 1);
    assert.equal(sent.url, 'https://api.openai.com/v1/responses');
    assert.equal(sent.body.store, false);
    assert.equal(sent.body.text.format.strict, true);
    assert.equal(sent.body.input[1].content.filter(part => part.type === 'input_image').length, 3);
    assert.match(sent.body.input[0].content, /Printed room words are optional/);
    assert.match(sent.body.input[0].content, /blue dashed rectangle/);
    assert.match(sent.body.input[0].content, /one bed, sofa, table/);
  } finally {
    if (priorPin === undefined) delete process.env.BRIEF_PIN; else process.env.BRIEF_PIN = priorPin;
    if (priorKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = priorKey;
    global.fetch = oldFetch;
  }
});
