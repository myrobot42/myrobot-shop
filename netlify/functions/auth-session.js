const { readSession, clearCookie } = require('./lib/session');
exports.handler = async (event) => {
  const h = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (event.httpMethod === 'POST') { h['Set-Cookie'] = clearCookie(); return { statusCode: 200, headers: h, body: '{"ok":true}' }; } // logout
  const s = readSession(event);
  return { statusCode: s ? 200 : 401, headers: h, body: JSON.stringify(s ? { email: s.email, role: s.role } : { error: 'Not signed in' }) };
};
