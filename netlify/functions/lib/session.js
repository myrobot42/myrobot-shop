// Shared helpers: signed session cookie + role lookup. Env vars:
//   SESSION_SECRET (long random string), ADMIN_EMAILS, WORKER_EMAILS (comma-separated Gmail addresses)
const crypto = require('crypto');
const COOKIE = 'mr_session';
const MAX_AGE = 12 * 60 * 60; // 12 hours

const list = (v) => String(v || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const roleFor = (email) => {
  email = String(email || '').toLowerCase();
  if (list(process.env.ADMIN_EMAILS).includes(email)) return 'admin';
  if (list(process.env.WORKER_EMAILS).includes(email)) return 'worker';
  return null;
};
const b64 = (b) => Buffer.from(b).toString('base64url');
const sign = (data) => crypto.createHmac('sha256', process.env.SESSION_SECRET).update(data).digest('base64url');

function makeToken(email, role) {
  const body = b64(JSON.stringify({ e: email, r: role, x: Math.floor(Date.now() / 1000) + MAX_AGE }));
  return body + '.' + sign(body);
}
function readSession(event) {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 24) return null;
  const m = String(event.headers.cookie || '').match(new RegExp('(?:^|; )' + COOKIE + '=([^;]+)'));
  if (!m) return null;
  const [body, sig] = m[1].split('.');
  if (!body || !sig) return null;
  const good = sign(body);
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  let p; try { p = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch (e) { return null; }
  if (!p.x || p.x < Date.now() / 1000) return null;
  const role = roleFor(p.e); // re-check list every request: removing an email revokes access at once
  if (!role) return null;
  return { email: p.e, role };
}
const setCookie = (token) => `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`;
const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
module.exports = { roleFor, makeToken, readSession, setCookie, clearCookie };
