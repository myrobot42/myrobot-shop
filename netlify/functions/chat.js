// netlify/functions/chat.js
// Secure proxy: browser calls /api/chat, this adds your Anthropic API key
// (server-side, never exposed) and forwards to Claude.

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: { message: 'Method not allowed' } }) };
  }

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: { message: 'Missing ANTHROPIC_API_KEY env var' } }) };
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: { message: 'Invalid JSON body' } }) }; }

  const body = {
    model: payload.model || 'claude-sonnet-4-6',
    max_tokens: Math.min(payload.max_tokens || 1024, 2048),
    system: payload.system || '',
    messages: Array.isArray(payload.messages) ? payload.messages.slice(-12) : [],
  };

  // Use global fetch (Node 18+) if available, otherwise fall back to https module
  // so the function works regardless of the site's Node version.
  try {
    let status, text;

    if (typeof fetch === 'function') {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });
      status = resp.status;
      text = await resp.text();
    } else {
      // Fallback for older Node runtimes without global fetch
      const https = require('https');
      const data = JSON.stringify(body);
      const result = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'api.anthropic.com',
          path: '/v1/messages',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
            'x-api-key': API_KEY,
            'anthropic-version': '2023-06-01',
          },
        }, (res) => {
          let chunks = '';
          res.on('data', (c) => chunks += c);
          res.on('end', () => resolve({ status: res.statusCode, text: chunks }));
        });
        req.on('error', reject);
        req.write(data);
        req.end();
      });
      status = result.status;
      text = result.text;
    }

    return { statusCode: status, headers, body: text };
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: { message: 'Upstream error: ' + (err && err.message ? err.message : String(err)) } }) };
  }
};
