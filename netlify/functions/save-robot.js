// netlify/functions/save-robot.js
//
// SERVER-SIDE MERGE — prevents stale-tab overwrites.
//
// The browser sends only the fields that changed for ONE robot. This function
// always fetches the latest robots.json from GitHub before applying changes,
// so a worker's stale in-memory state can never overwrite other people's work.
//
// Replaces the dangerous "push entire ROBOTS array" pattern in deployNow().
//
// REQUEST: POST JSON { robotId, changes, workerName }
//   robotId    — required, exact ID of the robot to update
//   changes    — required, object of field updates (e.g. {gallery: [...], img: '...'})
//   workerName — optional, attaches name to the git commit
//
// RESPONSE:
//   200 { ok: true, robotId, updated: [fieldsChanged], commit: <sha> }
//   400 { ok: false, error: '...' } for bad input
//   409 { ok: false, error: 'Robot not found' } if ID doesn't exist
//   500 { ok: false, error: '...' } for GitHub failures
//
// ENV VARS:
//   GITHUB_TOKEN     — fine-grained PAT with Contents:Write on the repo
//   GITHUB_REPO      — defaults to 'myrobot42/myrobot-shop'
//   GITHUB_BRANCH    — defaults to 'main'
//   GITHUB_FILE_PATH — defaults to 'data/robots.json'

const GITHUB_TOKEN     = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const GITHUB_REPO      = process.env.GITHUB_REPO || 'myrobot42/myrobot-shop';
const GITHUB_BRANCH    = process.env.GITHUB_BRANCH || 'main';
const GITHUB_FILE_PATH = process.env.GITHUB_FILE_PATH || 'data/robots.json';

// Fields a worker is allowed to touch via this endpoint. Anything else is silently dropped.
// Keep this list tight — it's the security boundary.
const ALLOWED_FIELDS = new Set([
  'gallery', 'img',
  'desc', 'tags',
  'price', 'status',
  'last_verified',
  // Add more as workers' scope grows. Resist the urge to put everything here.
]);

exports.handler = async (event) => {
  // CORS — admin.html is served from the same Netlify site, so same-origin
  // works without preflight, but explicit headers don't hurt.
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) };
  }

  // Parse + validate body
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ ok: false, error: 'Invalid JSON' }) }; }

  const { robotId, changes, workerName } = body;
  if (!robotId || typeof robotId !== 'string') {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ ok: false, error: 'robotId required' }) };
  }
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ ok: false, error: 'changes object required' }) };
  }

  // Filter to allowed fields only. Silent drop is intentional — workers shouldn't
  // need to know which fields are gated. The response tells them what actually saved.
  const safeChanges = {};
  for (const k of Object.keys(changes)) {
    if (ALLOWED_FIELDS.has(k)) safeChanges[k] = changes[k];
  }
  if (Object.keys(safeChanges).length === 0) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ ok: false, error: 'No editable fields in changes' }) };
  }

  if (!GITHUB_TOKEN) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ ok: false, error: 'GITHUB_TOKEN not configured on server' }) };
  }

  const apiBase = `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`;
  const ghHeaders = {
    'Authorization': `token ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'myrobot-shop-save-robot',
  };

  // Retry loop handles:
  //   - 409/422 SHA conflicts (concurrent edits)
  //   - Transient network/parse errors (truncated JSON, GitHub blips)
  // Exponential backoff: 0ms, 300ms, 900ms between attempts.
  let attempt = 0;
  const MAX_ATTEMPTS = 4;
  let lastTransientError = null;
  while (attempt < MAX_ATTEMPTS) {
    attempt++;
    if (attempt > 1){
      // Exponential backoff before retry
      const delay = 100 * Math.pow(3, attempt - 2); // 100, 300, 900ms
      await new Promise(r => setTimeout(r, delay));
    }

    // 1. Fetch latest robots.json + its SHA from GitHub
    let currentSha = null;
    let robots;
    try {
      const r = await fetch(`${apiBase}?ref=${encodeURIComponent(GITHUB_BRANCH)}`, { headers: ghHeaders });
      if (!r.ok) {
        // 5xx from GitHub = transient, retry. 4xx = our problem, fail fast.
        if (r.status >= 500 && attempt < MAX_ATTEMPTS) {
          lastTransientError = `GitHub ${r.status}`;
          continue;
        }
        const errText = await r.text();
        return { statusCode: 502, headers: cors, body: JSON.stringify({ ok: false, error: `Could not fetch robots.json: ${r.status} ${errText.slice(0, 200)}` }) };
      }
      // Read body as text first so we can retry on truncated responses
      const rawResponse = await r.text();
      let fileData;
      try {
        fileData = JSON.parse(rawResponse);
      } catch (parseErr) {
        // Truncated or malformed GitHub response — retry
        lastTransientError = `GitHub response parse failed: ${parseErr.message}`;
        if (attempt < MAX_ATTEMPTS) continue;
        return { statusCode: 502, headers: cors, body: JSON.stringify({ ok: false, error: `GitHub returned malformed JSON after ${attempt} attempts: ${parseErr.message}` }) };
      }
      currentSha = fileData.sha;
      if (!fileData.content) {
        return { statusCode: 502, headers: cors, body: JSON.stringify({ ok: false, error: 'GitHub response missing content field' }) };
      }
      // GitHub returns base64-encoded content. Decode.
      const raw = Buffer.from(fileData.content, 'base64').toString('utf8');
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (parseErr) {
        // robots.json itself is malformed — this is bad. Retry once in case the
        // base64 was corrupted in transit, but most likely a real data problem.
        lastTransientError = `robots.json parse failed: ${parseErr.message}`;
        if (attempt < MAX_ATTEMPTS) continue;
        return { statusCode: 500, headers: cors, body: JSON.stringify({ ok: false, error: `robots.json corrupted after ${attempt} attempts: ${parseErr.message}` }) };
      }
      // File may be a plain array or {robots: [...]} — handle both
      robots = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.robots) ? parsed.robots : null);
      if (!robots) {
        return { statusCode: 500, headers: cors, body: JSON.stringify({ ok: false, error: 'robots.json malformed — neither array nor {robots: [...]}' }) };
      }
    } catch (e) {
      // Network error — retry
      lastTransientError = `GitHub fetch network error: ${e.message}`;
      if (attempt < MAX_ATTEMPTS) continue;
      return { statusCode: 502, headers: cors, body: JSON.stringify({ ok: false, error: `GitHub fetch failed after ${attempt} attempts: ${e.message}` }) };
    }

    // 2. Find target robot + apply changes
    const target = robots.find(r => r && r.id === robotId);
    if (!target) {
      return { statusCode: 409, headers: cors, body: JSON.stringify({ ok: false, error: `Robot not found: ${robotId}` }) };
    }

    const updated = [];
    for (const [k, v] of Object.entries(safeChanges)) {
      // For gallery specifically: empty array OR all-empty-string entries → delete the field
      if (k === 'gallery') {
        const arr = Array.isArray(v) ? v.filter(u => u && String(u).trim()) : [];
        if (arr.length) target.gallery = arr;
        else delete target.gallery;
      } else if (v === null || v === '' || v === undefined) {
        // Explicit null/empty → remove field
        if (k in target) { delete target[k]; updated.push(k); continue; }
      } else {
        target[k] = v;
      }
      updated.push(k);
    }

    // Also stamp who edited + when (commit message uses workerName; the data itself stays clean)
    // Intentionally NOT adding edit_log to the robot — keeps the JSON small.

    // 3. PUT back with SHA-based optimistic concurrency
    const newContent = Buffer.from(JSON.stringify(robots, null, 2), 'utf8').toString('base64');
    const commitMsg = `Update ${robotId} (${updated.join(', ')})${workerName ? ` — ${workerName}` : ''}`;
    const putBody = {
      message: commitMsg,
      content: newContent,
      sha: currentSha,
      branch: GITHUB_BRANCH,
    };

    try {
      const put = await fetch(apiBase, {
        method: 'PUT',
        headers: { ...ghHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(putBody),
      });

      if (put.status === 409 || put.status === 422) {
        // SHA mismatch — someone else committed between our fetch and PUT. Retry.
        continue;
      }
      if (!put.ok) {
        const errText = await put.text();
        return { statusCode: 502, headers: cors, body: JSON.stringify({ ok: false, error: `GitHub PUT failed: ${put.status} ${errText}` }) };
      }

      const result = await put.json();
      return {
        statusCode: 200,
        headers: cors,
        body: JSON.stringify({
          ok: true,
          robotId,
          updated,
          commit: result.commit && result.commit.sha,
          attempt,
        }),
      };
    } catch (e) {
      return { statusCode: 502, headers: cors, body: JSON.stringify({ ok: false, error: `GitHub PUT error: ${e.message}` }) };
    }
  }
  return { statusCode: 503, headers: cors, body: JSON.stringify({ ok: false, error: 'Save conflict — too many concurrent edits. Try again.' }) };
};
