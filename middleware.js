import { homeGateSessionValid, readHomeGateCookie } from './src/domain/home-gate-auth.js';

export const config = { matcher: ['/home.html', '/home.bundle.js'] };

export default function middleware(request) {
  const pin = process.env.PIN;
  const secret = process.env.HOME_GATE_SECRET || process.env.OPENAI_API_KEY;
  if (!/^\d{4}$/.test(pin || '') || !secret)
    return new Response('Home access is not configured', {
      status: 503, headers: { 'Cache-Control': 'no-store' },
    });
  const session = readHomeGateCookie(request.headers.get('cookie'));
  if (homeGateSessionValid(session, pin, secret)) return;
  return new Response(null, {
    status: 302,
    headers: { Location: new URL('/home-gate.html', request.url).toString(), 'Cache-Control': 'no-store' },
  });
}
