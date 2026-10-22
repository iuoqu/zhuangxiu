const { chromium } = require('playwright');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const [{ default: middleware }, { default: homeAccess }] = await Promise.all([
    import('./middleware.js'), import('./api/home-access.js'),
  ]);
  const oldPin = process.env.PIN;
  const oldSecret = process.env.HOME_GATE_SECRET;
  process.env.PIN = '1234';
  process.env.HOME_GATE_SECRET = 'browser-test-signing-secret';
  const files = new Set(['index.html', 'home-gate.html', 'home.html', 'home.bundle.js']);
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname === '/api/home-access') {
      let body = '';
      for await (const chunk of request) body += chunk;
      const reply = { setHeader: (...args) => response.setHeader(...args),
        status(code) { response.statusCode = code; return this; },
        json(value) { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)); } };
      try { homeAccess({ method: request.method, body: JSON.parse(body) }, reply); }
      catch { response.writeHead(400); response.end(); }
      return;
    }
    const file = url.pathname.slice(1) || 'index.html';
    if (!files.has(file)) { response.writeHead(404); response.end(); return; }
    if (file === 'home.html' || file === 'home.bundle.js') {
      const decision = middleware(new Request(url, { headers: { cookie: request.headers.cookie || '' } }));
      if (decision) {
        response.writeHead(decision.status, Object.fromEntries(decision.headers));
        response.end();
        return;
      }
    }
    response.setHeader('Content-Type', file.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8');
    response.end(await readFile(path.join(__dirname, file)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const base = `http://127.0.0.1:${server.address().port}`;
    const direct = await browser.newPage();
    await direct.goto(`${base}/home.html`);
    assert.equal(new URL(direct.url()).pathname, '/home-gate.html');
    await direct.locator('#pin').fill('0000');
    await direct.locator('#enter').click();
    assert.match(await direct.locator('#message').innerText(), /门禁码不对/);
    await direct.locator('#pin').fill('1234');
    await direct.locator('#enter').click();
    await direct.waitForURL('**/home.html');
    assert.match(await direct.locator('h1').first().innerText(), /给我们户型图/);

    const fromRoot = await browser.newPage();
    await fromRoot.goto(base);
    await fromRoot.locator('#pin').fill('1234');
    await fromRoot.locator('#gateHome').click();
    await fromRoot.waitForURL('**/home.html');
    assert.match(await fromRoot.locator('h1').first().innerText(), /给我们户型图/);
    console.log('PASS: direct home access is gated; valid PIN opens home from gate or root button');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    if (oldPin === undefined) delete process.env.PIN; else process.env.PIN = oldPin;
    if (oldSecret === undefined) delete process.env.HOME_GATE_SECRET; else process.env.HOME_GATE_SECRET = oldSecret;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
