// netlify/functions/chat.js
// Secure proxy: the browser calls /api/chat, this function adds your
// Anthropic API key (kept server-side) and forwards to Claude.
// Your key is NEVER exposed to the browser.

exports.handler = async (event) => {
  // CORS headers so the browser can call this
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  // Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server not configured: missing ANTHROPIC_API_KEY' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  // Build the request to Claude. We accept {system, messages, model, max_tokens}
  // from the browser but cap max_tokens and pin a safe default model.
  const body = {
    model: payload.model || 'claude-sonnet-4-6',
    max_tokens: Math.min(payload.max_tokens || 1024, 2048),
    system: payload.system || '',
    messages: Array.isArray(payload.messages) ? payload.messages.slice(-12) : [],
  };

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    const data = await resp.json();
    return { statusCode: resp.status, headers, body: JSON.stringify(data) };
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'Upstream error: ' + err.message }) };
  }
};
