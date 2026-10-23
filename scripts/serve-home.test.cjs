const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

test('local home server serves the bundle and keeps AI credentials server-side', async () => {
  const child = spawn(process.execPath, [path.join(__dirname, 'serve-home.cjs')], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, HOME_PORT: '0', BRIEF_PIN: 'test-pin', OPENAI_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let timer;
  try {
    const url = await Promise.race([
      new Promise((resolve, reject) => {
        child.stdout.once('data', chunk => {
          const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+\/home\.html/);
          match ? resolve(match[0]) : reject(new Error(`Unexpected server output: ${chunk}`));
        });
        child.once('error', reject);
        child.once('exit', code => reject(new Error(`Local server exited early: ${code}`)));
      }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Local server did not start')), 10000); }),
    ]);
    const page = await fetch(url);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /AI 读取图示尺寸/);
    const bundle = await fetch(url.replace('home.html', 'home.bundle.js'));
    assert.equal(bundle.status, 200);
    const result = await fetch(url.replace('home.html', 'api/extract-plan-dimensions'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: 'test-pin', zones: [] }),
    });
    assert.equal(result.status, 503);
    assert.match((await result.json()).error, /not configured/);
    const suggestions = await fetch(url.replace('home.html', 'api/suggest-home-zones'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: 'test-pin', imageDataUrl: 'data:image/jpeg;base64,AAAA', widthPx: 1000, heightPx: 800 }),
    });
    assert.equal(suggestions.status, 503);
    assert.match((await suggestions.json()).error, /not configured/);
    const overview = await fetch(url.replace('home.html', 'api/read-home-plan'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: 'test-pin', imageDataUrl: 'data:image/jpeg;base64,AAAA', widthPx: 1000, heightPx: 800 }),
    });
    assert.equal(overview.status, 503);
    assert.match((await overview.json()).error, /not configured/);
    const spaces = await fetch(url.replace('home.html', 'api/find-home-spaces'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: 'test-pin', imageDataUrl: 'data:image/jpeg;base64,AAAA',
        widthPx: 1000, heightPx: 800, overview: { reviewed: true } }),
    });
    assert.equal(spaces.status, 503);
    assert.match((await spaces.json()).error, /not configured/);
    const classified = await fetch(url.replace('home.html', 'api/classify-home-spaces'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: 'test-pin', widthPx: 1000, heightPx: 800,
        spaces: [{ id: 1, x: 10, y: 10, w: 200, h: 200, cropDataUrl: 'data:image/jpeg;base64,AAAA' }] }),
    });
    assert.equal(classified.status, 503);
    assert.match((await classified.json()).error, /not configured/);
    const recovered = await fetch(url.replace('home.html', 'api/recover-home-spaces'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: 'test-pin', imageDataUrl: 'data:image/jpeg;base64,AAAA',
        widthPx: 1000, heightPx: 800, overview: { reviewed: true, bedroomCount: 1 },
        knownZones: [], missingCounts: { bedroom: 1, living: 0, bathroom: 0, mezzanine: 0 } }),
    });
    assert.equal(recovered.status, 503);
    assert.match((await recovered.json()).error, /not configured/);
  } finally {
    clearTimeout(timer);
    child.kill();
  }
});
