import { createHmac, timingSafeEqual } from 'node:crypto';

export const HOME_GATE_COOKIE = 'home_gate';
export const HOME_GATE_MAX_AGE = 8 * 60 * 60;

const signature = (expires, pin, secret) => createHmac('sha256', secret)
  .update(`home-gate:v1:${expires}:${pin}`)
  .digest('base64url');

export function homeGatePinMatches(given, expected) {
  if (!/^\d{4}$/.test(given || '') || !/^\d{4}$/.test(expected || '')) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

export function createHomeGateSession(pin, secret, now = Date.now()) {
  if (!/^\d{4}$/.test(pin || '') || !secret) throw new TypeError('Home gate is not configured');
  const expires = Math.floor(now / 1000) + HOME_GATE_MAX_AGE;
  return `${expires}.${signature(expires, pin, secret)}`;
}

export function homeGateSessionValid(value, pin, secret, now = Date.now()) {
  if (!/^\d{4}$/.test(pin || '') || !secret || typeof value !== 'string') return false;
  const match = /^(\d{10})\.([\w-]{43})$/.exec(value);
  if (!match) return false;
  const expires = Number(match[1]);
  const current = Math.floor(now / 1000);
  if (expires <= current || expires > current + HOME_GATE_MAX_AGE) return false;
  const expected = signature(expires, pin, secret);
  return timingSafeEqual(Buffer.from(match[2]), Buffer.from(expected));
}

export function readHomeGateCookie(header) {
  const part = String(header || '').split(';').map(item => item.trim())
    .find(item => item.startsWith(`${HOME_GATE_COOKIE}=`));
  return part ? part.slice(HOME_GATE_COOKIE.length + 1) : '';
}
