import { createHomeGateSession, homeGatePinMatches, HOME_GATE_COOKIE, HOME_GATE_MAX_AGE } from '../src/domain/home-gate-auth.js';

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Only POST is allowed' });
  const pin = process.env.PIN;
  const secret = process.env.HOME_GATE_SECRET || process.env.OPENAI_API_KEY;
  if (!/^\d{4}$/.test(pin || '') || !secret)
    return res.status(503).json({ error: 'Home access is not configured' });
  if (!homeGatePinMatches(req.body?.pin, pin))
    return res.status(401).json({ error: 'Incorrect access code' });
  const session = createHomeGateSession(pin, secret);
  res.setHeader('Set-Cookie', `${HOME_GATE_COOKIE}=${session}; Path=/; Max-Age=${HOME_GATE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`);
  return res.status(200).json({ ok: true });
}
