// netlify/functions/submit-review.js
//
// Receives a review from a SIGNED-IN user (Netlify Identity) and appends it to
// data/reviews-pending.json for admin moderation. Nothing is published until an
// admin approves it (that step moves the item into data/reviews.json).
//
// Auth: Netlify injects context.clientContext.user when the request carries a
// valid Identity JWT (Authorization: Bearer <token>). No valid token => 401.
// Needs GITHUB_TOKEN (already in your Netlify env) to commit the pending file.

const REPO = 'myrobot42/myrobot-shop';
const PENDING_PATH = 'data/reviews-pending.json';
const PUBLISHED_PATH = 'data/reviews.json';

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  // ── must be signed in ──
  const user = context.clientContext && context.clientContext.user;
  if (!user) return json(401, { error: 'Please sign in to post a review.' });

  const GH = process.env.GITHUB_TOKEN;
  if (!GH) return json(500, { error: 'Server not configured (missing token).' });

  // ── parse + validate ──
  let b;
  try { b = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'Bad request.' }); }

  const robot_id = String(b.robot_id || '').trim().slice(0, 100);
  const robot_name = String(b.robot_name || '').trim().slice(0, 140);
  const rating = Math.round(Number(b.rating));
  const text = String(b.text || '').replace(/\s+/g, ' ').trim();
  const role = String(b.role || '').replace(/\s+/g, ' ').trim().slice(0, 80);

  // display name: what they typed, else their account name, else email local-part
  let name = String(b.name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!name) {
    name = (user.user_metadata && user.user_metadata.full_name) ||
           (user.email ? user.email.split('@')[0] : 'Anonymous');
  }

  if (!robot_id) return json(400, { error: 'No robot selected.' });
  if (!(rating >= 1 && rating <= 5)) return json(400, { error: 'Rating must be 1–5 stars.' });
  if (text.length < 10) return json(400, { error: 'Please write at least a sentence (10+ characters).' });
  if (text.length > 2000) return json(400, { error: 'Review is too long (2000 character max).' });
  if ((text.match(/https?:\/\//gi) || []).length > 2) return json(400, { error: 'Too many links in the review.' });

  // profanity guard — checks the review text AND the display name/role
  if (hasProfanity(text) || hasProfanity(name) || hasProfanity(role)) {
    return json(400, { error: 'Please remove inappropriate language before submitting.' });
  }

  // ── read current pending + published, to dedupe per user/robot ──
  const pendingFile = await ghGet(PENDING_PATH, GH);
  const pending = (pendingFile.json && Array.isArray(pendingFile.json.pending)) ? pendingFile.json.pending : [];

  const publishedFile = await ghGet(PUBLISHED_PATH, GH);
  const published = (publishedFile.json && publishedFile.json.reviews) ? publishedFile.json.reviews : {};

  const already =
    pending.some(p => p.user_id === user.sub && p.robot_id === robot_id) ||
    (Array.isArray(published[robot_id]) && published[robot_id].some(p => p.user_id === user.sub));
  if (already) return json(409, { error: "You've already reviewed this robot." });

  // ── build + append ──
  const item = {
    id: hash(user.sub + '|' + robot_id + '|' + Date.now()),
    robot_id,
    robot_name,
    rating,
    name,
    role,
    text,
    user_id: user.sub,       // stable id — kept on publish for dedupe / "your review"
    user_email: user.email,  // moderation context ONLY — strip before publishing
    created: new Date().toISOString(),
    status: 'pending',
  };
  pending.push(item);

  const out = {
    _note: (pendingFile.json && pendingFile.json._note) ||
      'Moderation queue. Admin approves -> item moves into data/reviews.json (email stripped). Reject -> dropped.',
    _generated: new Date().toISOString(),
    pending,
  };

  try {
    await ghPut(PENDING_PATH, out, GH, pendingFile.sha, 'New review pending: ' + robot_id + ' [skip ci]');
  } catch (e) {
    return json(502, { error: 'Could not save right now — please try again in a moment.' });
  }

  return json(200, { ok: true, message: 'Thanks! Your review is pending moderation and will appear once approved.' });
};

// ───────────────────────── profanity ───────────────────────
// No list is exhaustive and determined users evade any filter — this catches the
// straightforward cases plus common letter-swaps (sh1t), spacing (s h i t) and
// repeats (shiiit). Moderation is the real backstop. To ALLOW mild words like
// "damn"/"hell", delete MILD from the WORDS line below.
//
// WORDS are matched as WHOLE WORDS (\b…\b) so normal words are safe:
//   "class", "chassis", "assembly", "compass", "analysis", "shell", "titanium" → all fine.
// TIGHT entries are also matched after stripping spaces/symbols, to catch evasion
// like "f.u.c.k" / "s h i t". TIGHT is deliberately limited to terms that don't
// collide with real words (so "ass"/"anal"/"cunt" are whole-word only on purpose).
const STRONG = [
  'fuck','shit','bitch','bastard','asshole','arsehole','ass','dick','piss','prick',
  'wank','wanker','bollocks','bollock','cock','pussy','slut','whore','douche','jackass',
  'dipshit','bullshit','motherfucker','twat','knob','shag','tit','tits','minge','bellend',
];
const SLURS = [
  'nigger','nigga','faggot','fag','retard','spic','chink','kike','wetback','tranny',
  'dyke','coon','gook','paki',
];
const EXPLICIT = ['cum','cunt','anal','blowjob','handjob','dildo','boner','jizz','rimjob'];
const MILD = ['damn','hell','crap','arse','bugger','bloody'];
const WORDS = [...new Set([].concat(STRONG, SLURS, EXPLICIT, MILD))]; // ← remove MILD to allow mild words
const TIGHT = ['fuck','shit','bitch','asshole','arsehole','motherfucker','nigger','faggot','pussy','bullshit'];

function normalizeForProfanity(s) {
  let t = String(s).toLowerCase();
  const leet = { '0':'o','1':'i','!':'i','3':'e','4':'a','@':'a','5':'s','$':'s','7':'t','8':'b','9':'g' };
  t = t.replace(/[0-9!@$]/g, c => leet[c] || c);
  t = t.replace(/(.)\1+/g, '$1'); // collapse runs: "shiiit" -> "shit"
  return t;
}
function hasProfanity(s) {
  if (!s) return false;
  const norm = normalizeForProfanity(s);
  for (const w of WORDS) {
    const re = new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
    if (re.test(norm)) return true;
  }
  // evasion check PER TOKEN (not across the whole string) so innocent word pairs
  // like "wash it" / "push it" / "finish it" never merge into "shit" and false-trip.
  // Catches intra-word separators (f.u.c.k, s-h-i-t); fully space-split evasion
  // ("f u c k") is left to the moderation queue rather than risk false positives.
  for (const tok of norm.split(/\s+/)) {
    const t = tok.replace(/[^a-z]/g, '');
    if (t.length < 3) continue;
    for (const w of TIGHT) if (t.includes(w)) return true;
  }
  return false;
}

// ───────────────────────── helpers ─────────────────────────
function json(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

async function ghGet(path, token) {
  const res = await fetch('https://api.github.com/repos/' + REPO + '/contents/' + path, {
    headers: { Authorization: 'token ' + token, Accept: 'application/vnd.github.v3+json' },
  });
  if (res.status === 404) return { sha: null, json: null };
  if (!res.ok) throw new Error('GET ' + path + ' -> ' + res.status);
  const data = await res.json();
  let parsed = null;
  try { parsed = JSON.parse(Buffer.from(data.content, 'base64').toString('utf8')); } catch (e) { parsed = null; }
  return { sha: data.sha, json: parsed };
}

async function ghPut(path, obj, token, sha, message) {
  const body = { message, content: Buffer.from(JSON.stringify(obj, null, 2)).toString('base64') };
  if (sha) body.sha = sha;
  const res = await fetch('https://api.github.com/repos/' + REPO + '/contents/' + path, {
    method: 'PUT',
    headers: {
      Authorization: 'token ' + token,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('PUT ' + path + ' -> ' + res.status + ' ' + (await res.text()));
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
  return Math.abs(h).toString(16).slice(0, 12);
}
