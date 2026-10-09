// POST {credential} from Google Sign-In -> verifies with Google, checks email list, sets session cookie.
const { roleFor, makeToken, setCookie } = require('./lib/session');
const ALLOWED_ORIGINS = ['https://myrobot.shop', 'https://www.myrobot.shop', 'https://myrobot42.netlify.app'];
const LIMIT = 20, WINDOW = 10 * 60 * 1000, hits = new Map();
const json = (code, obj, extra) => ({ statusCode: code, headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, extra || {}), body: JSON.stringify(obj) });

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  const origin = event.headers.origin || '';
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return json(403, { error: 'Forbidden' });
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.SESSION_SECRET) return json(500, { error: 'Server not configured' });

  const ip = (event.headers['x-nf-client-connection-ip'] || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < WINDOW);
  if (arr.length >= LIMIT) return json(429, { error: 'Too many attempts' });
  arr.push(now); hits.set(ip, arr);

  let cred = '';
  try { cred = String(JSON.parse(event.body || '{}').credential || ''); } catch (e) {}
  if (!cred || cred.length > 4000) return json(400, { error: 'Bad request' });

  let info;
  try {
    const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(cred));
    if (!r.ok) return json(401, { error: 'Google sign-in failed' });
    info = await r.json();
  } catch (e) { return json(502, { error: 'Could not reach Google' }); }

  const okIss = info.iss === 'accounts.google.com' || info.iss === 'https://accounts.google.com';
  if (info.aud !== process.env.GOOGLE_CLIENT_ID || !okIss || String(info.email_verified) !== 'true' || Number(info.exp) * 1000 < now)
    return json(401, { error: 'Google sign-in failed' });

  const role = roleFor(info.email);
  if (!role) return json(403, { error: 'This Google account is not approved for the admin portal.' });
  return json(200, { ok: true, role }, { 'Set-Cookie': setCookie(makeToken(String(info.email).toLowerCase(), role)) });
};
