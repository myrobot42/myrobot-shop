// netlify/functions/chat.js
// Tubu backend for myrobot.shop.
//
// The browser sends ONLY the conversation. The server decides the model, the
// token limit and the instructions, so nobody can use this endpoint as a free
// general-purpose Claude on your account.
//
// Protections:
//   1. Server owns model / system prompt / max_tokens (client values ignored)
//   2. Per-visitor limit:  10 questions per 10 minutes
//   3. Daily cap:          300 questions per day, whole site (resets midnight Brisbane)
//   4. Input validation:   size, roles, length
//   5. Origin check:       only myrobot.shop pages (speed bump, not a lock)
//   6. Prompt caching:     the big robot digest is billed at a fraction on repeats

const crypto = require('crypto');

// ---------- settings (change these numbers to tune) ----------
const MODEL            = 'claude-sonnet-4-6';
const MAX_TOKENS       = 1024;
const IP_LIMIT         = 10;                 // questions
const IP_WINDOW_MS     = 10 * 60 * 1000;     // per 10 minutes
const DAILY_CAP        = 300;                // questions per day, all visitors
const MAX_BODY_CHARS   = 20000;
const MAX_MSG_CHARS    = 1500;
const MAX_HISTORY      = 10;
const DIGEST_TTL_MS    = 10 * 60 * 1000;
const ALLOWED_ORIGINS  = [
  'https://myrobot.shop',
  'https://www.myrobot.shop',
  'https://myrobot42.netlify.app',
];
const DATA_URLS = [
  'https://myrobot.shop/data/robots.json',
  'https://raw.githubusercontent.com/myrobot42/myrobot-shop/main/data/robots.json',
];

// ---------- helpers ----------
function reply(statusCode, obj, origin) {
  const headers = { 'Content-Type': 'application/json' };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Vary'] = 'Origin';
  }
  return { statusCode, headers, body: JSON.stringify(obj) };
}
const fail = (code, msg, origin) => reply(code, { error: { message: msg } }, origin);

function brisbaneDay() {
  return new Date(Date.now() + 10 * 3600 * 1000).toISOString().slice(0, 10);
}

// ---------- the robot digest, built server-side ----------
let digestCache = { at: 0, text: '' };

function line(r) {
  const m = [];
  if (r.year) m.push(r.year);
  if (r.price && r.price > 0) m.push('$' + r.price); else if (r.price_band) m.push(r.price_band);
  if (r.height_mm) m.push(r.height_mm + 'mm');
  if (r.weight_kg) m.push(r.weight_kg + 'kg');
  if (r.payload_kg) m.push(r.payload_kg + 'kg-payload');
  if (r.dof) m.push(r.dof + 'DoF');
  if (r.speed_ms) m.push(r.speed_ms + 'm/s');
  if (r.status) m.push(r.status);
  if (r.origin || r.made_in) m.push(r.origin || r.made_in);
  if (r.score) m.push('score:' + r.score);
  return r.id + '|' + r.name + '|' + r.brand + '|' + r.cat +
    (m.length ? ' [' + m.join(', ') + ']' : '') +
    (r.use_cases && r.use_cases.length ? ' — uses: ' + r.use_cases.slice(0, 3).join('; ') : '');
}

async function loadRobots() {
  for (const url of DATA_URLS) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) continue;
      const d = await resp.json();
      const arr = Array.isArray(d) ? d : (d && d.robots);
      if (Array.isArray(arr) && arr.length > 100) return arr;
    } catch (e) { /* try next */ }
  }
  return null;
}

async function systemText() {
  if (digestCache.text && Date.now() - digestCache.at < DIGEST_TTL_MS) return digestCache.text;
  const R = await loadRobots();
  if (!R) {
    if (digestCache.text) return digestCache.text;   // serve stale rather than fail
    return null;
  }
  const cats = [...new Set(R.map(r => r.cat))].sort();
  const brands = [...new Set(R.map(r => r.brand))];
  const text =
    "You are Tubu, the friendly robot expert for myrobot.shop, the world's most complete robot database (" +
    R.length + " robots, " + brands.length + " brands, " + cats.length +
    " categories). You are knowledgeable, precise, and genuinely helpful — like a seasoned robotics analyst who knows every machine in the catalog.\n\n" +
    "YOUR JOB (all of these):\n1. RECOMMEND robots based on need, budget, use case, environment.\n2. ANSWER questions about any specific robot — specs, capabilities.\n3. COMPARE robots head-to-head.\n4. EXPLAIN robotics concepts plainly.\n\n" +
    "SCOPE: You only discuss robots, robotics and this database. If asked for anything else (coding help, essays, general chat, other products), politely say you only help with robots and offer a robot-related alternative.\n\n" +
    "CATEGORIES: " + cats.join(', ') + ".\n\n" +
    "HOW TO USE DATA:\n- Below is a digest of EVERY robot (one per line): id|name|brand|category [specs] — uses.\n- Reason across the whole digest to shortlist and recommend.\n- When you reference specific robots, cite them with this EXACT format: [[robot:EXACT-ID]] — copy the id verbatim from the digest (the part before the first | on that robot's line). Example: [[robot:pudu-bellabot-2020]].\n- NEVER write markdown links like [Name](url) for robots. NEVER link to myrobot.shop. ONLY use the [[robot:id]] tag — the site turns it into a clickable card automatically.\n- Put the [[robot:id]] tag on its own line right after you mention that robot. Don't repeat the specs in text; the card shows them.\n- Don't invent specs not shown; for deep detail, point the user to the robot's page.\n\n" +
    "STYLE:\n- Concise, scannable. Lead with the answer. Short paragraphs, tight bullets.\n- When recommending, give 2-5 options each with a one-line reason and a [[robot:id]] tag.\n- Never fabricate robots, specs, or prices. If unsure, say so. Be warm but expert; no filler, no 'as an AI'.\n\n" +
    "ROBOT DIGEST (" + R.length + " robots):\n" + R.map(line).join('\n');
  digestCache = { at: Date.now(), text };
  return text;
}

// ---------- rate limiting ----------
// Layer 1: in-memory (per warm instance) - always on.
// Layer 2: Netlify Blobs (shared across all instances) - if available.
const memHits = new Map();       // ipHash -> [timestamps]
const memDaily = { day: '', n: 0 };

function memCheckIp(ipHash, now) {
  const arr = (memHits.get(ipHash) || []).filter(t => now - t < IP_WINDOW_MS);
  if (arr.length >= IP_LIMIT) { memHits.set(ipHash, arr); return false; }
  arr.push(now); memHits.set(ipHash, arr);
  if (memHits.size > 5000) {                       // keep memory bounded
    for (const [k, v] of memHits) if (!v.some(t => now - t < IP_WINDOW_MS)) memHits.delete(k);
  }
  return true;
}
function memCheckDaily() {
  const d = brisbaneDay();
  if (memDaily.day !== d) { memDaily.day = d; memDaily.n = 0; }
  if (memDaily.n >= DAILY_CAP) return false;
  memDaily.n++; return true;
}

async function getBlobStore(event) {
  try {
    const blobs = require('@netlify/blobs');
    if (typeof blobs.connectLambda === 'function') blobs.connectLambda(event);
    return blobs.getStore('tubu-limits');
  } catch (e) { return null; }
}

const MSG_DAILY = 'Tubu has hit its daily question limit and is resting. Please try again tomorrow, or browse the database directly.';
const MSG_FAST  = "You're asking quickly — please wait a few minutes and try again.";

// returns null if allowed, or a message string if blocked
async function checkLimits(event, ipHash) {
  const now = Date.now();

  if (!memCheckDaily()) return MSG_DAILY;
  if (!memCheckIp(ipHash, now)) return MSG_FAST;

  const store = await getBlobStore(event);
  if (!store) return null;
  try {
    const dayKey = 'day-' + brisbaneDay();
    const dayRaw = await store.get(dayKey);
    const dayN = dayRaw ? parseInt(dayRaw, 10) || 0 : 0;
    if (dayN >= DAILY_CAP) return MSG_DAILY;

    const ipKey = 'ip-' + ipHash;
    const ipRaw = await store.get(ipKey, { type: 'json' });
    const arr = (Array.isArray(ipRaw) ? ipRaw : []).filter(t => now - t < IP_WINDOW_MS);
    if (arr.length >= IP_LIMIT) return MSG_FAST;

    arr.push(now);
    await store.setJSON(ipKey, arr);
    await store.set(dayKey, String(dayN + 1));
  } catch (e) { /* store hiccup: in-memory layer already applied */ }
  return null;
}

// ---------- input validation ----------
function cleanMessages(raw) {
  if (!Array.isArray(raw)) return null;
  let msgs = [];
  for (const m of raw) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) return null;
    if (typeof m.content !== 'string') return null;
    const c = m.content.trim().slice(0, MAX_MSG_CHARS);
    if (!c) continue;
    msgs.push({ role: m.role, content: c });
  }
  msgs = msgs.slice(-MAX_HISTORY);
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();   // must start with user
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return null;
  return msgs;
}

// ---------- handler ----------
exports.handler = async (event) => {
  const h = event.headers || {};
  const originHdr = h.origin || h.Origin || '';
  const referer = h.referer || h.Referer || '';
  const origin = ALLOWED_ORIGINS.find(o => originHdr === o || (!originHdr && referer.startsWith(o + '/'))) || '';

  if (event.httpMethod === 'OPTIONS') return reply(origin ? 200 : 403, {}, origin);
  if (event.httpMethod !== 'POST') return fail(405, 'Method not allowed', origin);
  if (!origin) return fail(403, 'Forbidden', '');

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) return fail(500, 'Tubu is not configured.', origin);

  if (!event.body || event.body.length > MAX_BODY_CHARS) return fail(413, 'Request too large.', origin);
  let payload;
  try { payload = JSON.parse(event.body); } catch (e) { return fail(400, 'Invalid request.', origin); }

  // NOTE: payload.model, payload.system and payload.max_tokens are deliberately ignored.
  const messages = cleanMessages(payload && payload.messages);
  if (!messages) return fail(400, 'Invalid request.', origin);

  const ip = h['x-nf-client-connection-ip'] || (h['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const ipHash = crypto.createHash('sha256').update(ip).digest('hex').slice(0, 20);

  const blocked = await checkLimits(event, ipHash);
  if (blocked) return fail(429, blocked, origin);

  const system = await systemText();
  if (!system) return fail(503, 'Tubu is temporarily unavailable. Please try again shortly.', origin);

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        // cache_control: repeat questions within ~5 min read the big digest from cache
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages,
      }),
    });
    const text = await resp.text();
    if (!resp.ok) {
      console.error('Anthropic error', resp.status, text.slice(0, 300));
      return fail(502, 'Tubu hit a problem. Please try again in a moment.', origin);
    }
    return { statusCode: 200, headers: reply(200, {}, origin).headers, body: text };
  } catch (err) {
    console.error('Upstream error', err && err.message);
    return fail(502, 'Tubu hit a problem. Please try again in a moment.', origin);
  }
};
