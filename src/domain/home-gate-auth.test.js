import test from 'node:test';
import assert from 'node:assert/strict';
import { createHomeGateSession, homeGatePinMatches, homeGateSessionValid,
  readHomeGateCookie, HOME_GATE_COOKIE, HOME_GATE_MAX_AGE } from './home-gate-auth.js';
import middleware from '../../middleware.js';
import homeAccess from '../../api/home-access.js';

const now = Date.UTC(2026, 9, 22, 0, 0, 0);
const configured = { PIN: '1234', OPENAI_API_KEY: 'test-signing-secret' };

function withEnvironment(values, run) {
  const before = Object.fromEntries(Object.keys(configured).map(key => [key, process.env[key]]));
  const oldHomeSecret = process.env.HOME_GATE_SECRET;
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    delete process.env.HOME_GATE_SECRET;
    return run();
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    if (oldHomeSecret === undefined) delete process.env.HOME_GATE_SECRET;
    else process.env.HOME_GATE_SECRET = oldHomeSecret;
  }
}

function response() {
  return { code: 200, headers: {}, setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
}

test('home PIN comparison and signed cookie reject tampering and expiry', () => {
  assert.equal(homeGatePinMatches('1234', '1234'), true);
  assert.equal(homeGatePinMatches('1235', '1234'), false);
  assert.equal(homeGatePinMatches('12345', '1234'), false);
  const token = createHomeGateSession('1234', 'secret', now);
  assert.equal(homeGateSessionValid(token, '1234', 'secret', now), true);
  assert.equal(homeGateSessionValid(token, '1234', 'secret', now + HOME_GATE_MAX_AGE * 1000), false);
  assert.equal(homeGateSessionValid(token, '1235', 'secret', now), false);
  assert.equal(homeGateSessionValid(`${token.slice(0, -1)}A`, '1234', 'secret', now), false);
  assert.equal(readHomeGateCookie(`other=x; ${HOME_GATE_COOKIE}=${token}; another=y`), token);
});

test('home access endpoint sets an HttpOnly session only for the configured PIN', () => withEnvironment(configured, () => {
  const wrong = response();
  homeAccess({ method: 'POST', body: { pin: '0000' } }, wrong);
  assert.equal(wrong.code, 401);
  assert.equal(wrong.headers['Set-Cookie'], undefined);
  const valid = response();
  homeAccess({ method: 'POST', body: { pin: '1234' } }, valid);
  assert.equal(valid.code, 200);
  assert.match(valid.headers['Set-Cookie'], /^home_gate=\d+\.[\w-]+; Path=\/; Max-Age=28800; HttpOnly; Secure; SameSite=Lax$/);
  assert.doesNotMatch(valid.headers['Set-Cookie'], /1234|test-signing-secret/);
  const cookie = valid.headers['Set-Cookie'].split(';')[0];
  const allowed = middleware(new Request('https://example.com/home.html', { headers: { cookie } }));
  assert.equal(allowed, undefined);
}));

test('direct home route and bundle access redirect without a valid session', () => withEnvironment(configured, () => {
  for (const path of ['/home.html', '/home.bundle.js']) {
    const denied = middleware(new Request(`https://example.com${path}`));
    assert.equal(denied.status, 302);
    assert.equal(denied.headers.get('location'), 'https://example.com/home-gate.html');
    assert.equal(denied.headers.get('cache-control'), 'no-store');
  }
  const invalid = middleware(new Request('https://example.com/home.html', {
    headers: { cookie: `${HOME_GATE_COOKIE}=invalid` },
  }));
  assert.equal(invalid.status, 302);
}));

test('home gate fails closed when its server-side secret is missing', () => withEnvironment({ PIN: '1234', OPENAI_API_KEY: undefined }, () => {
  const result = response();
  homeAccess({ method: 'POST', body: { pin: '1234' } }, result);
  assert.equal(result.code, 503);
  assert.equal(result.headers['Set-Cookie'], undefined);
  assert.equal(middleware(new Request('https://example.com/home.html')).status, 503);
}));
