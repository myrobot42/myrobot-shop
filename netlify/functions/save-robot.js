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
  'gallery', 'img', 'video', 'video2',
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
  const blobApiBase = `https://api.github.com/repos/${GITHUB_REPO}/git/blobs`;
  const ghHeaders = {
    'Authorization': `token ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'myrobot-shop-save-robot',
  };

  // Helper: fetch the file content with automatic fallback to Git Data API for files >1MB.
  // Returns {sha, content} or throws.
  // The /contents endpoint truncates files >1MB and returns no `content` field, but it
  // still returns the SHA — we then fetch the blob directly which has no size limit.
  async function fetchFileContent() {
    const metaRes = await fetch(`${apiBase}?ref=${encodeURIComponent(GITHUB_BRANCH)}`, { headers: ghHeaders });
    if (!metaRes.ok) {
      const errText = await metaRes.text();
      const err = new Error(`Could not fetch robots.json metadata: ${metaRes.status} ${errText.slice(0, 200)}`);
      err.status = metaRes.status;
      err.transient = metaRes.status >= 500;
      throw err;
    }
    const rawMeta = await metaRes.text();
    let fileData;
    try { fileData = JSON.parse(rawMeta); }
    catch (e) {
      const err = new Error(`GitHub metadata parse failed: ${e.message}`);
      err.transient = true;
      throw err;
    }
    if (!fileData.sha) {
      const err = new Error(`GitHub returned no SHA. Message: "${(fileData.message||'').slice(0,150)}"`);
      err.transient = /rate limit|abuse/i.test(fileData.message || '');
      throw err;
    }

    // If contents API returned the content inline (file ≤1MB), use it
    if (fileData.content) {
      return { sha: fileData.sha, contentBase64: fileData.content };
    }

    // Otherwise fetch the blob directly — no size limit
    const blobRes = await fetch(`${blobApiBase}/${fileData.sha}`, { headers: ghHeaders });
    if (!blobRes.ok) {
      const errText = await blobRes.text();
      const err = new Error(`Blob fetch failed: ${blobRes.status} ${errText.slice(0, 200)}`);
      err.status = blobRes.status;
      err.transient = blobRes.status >= 500;
      throw err;
    }
    const blobRaw = await blobRes.text();
    let blobData;
    try { blobData = JSON.parse(blobRaw); }
    catch (e) {
      const err = new Error(`Blob response parse failed: ${e.message}`);
      err.transient = true;
      throw err;
    }
    if (!blobData.content) {
      throw new Error('Blob response missing content field');
    }
    return { sha: fileData.sha, contentBase64: blobData.content };
  }

  // Retry loop handles:
  //   - 409/422 SHA conflicts (concurrent edits)
  //   - Transient network/parse errors (truncated JSON, GitHub blips, 5xx)
  //   - Rate limit responses
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

    // 1. Fetch latest robots.json + its SHA from GitHub (handles >1MB via blob API)
    let currentSha = null;
    let robots;
    try {
      const { sha, contentBase64 } = await fetchFileContent();
      currentSha = sha;
      // GitHub returns base64-encoded content. Decode.
      // Blob API base64 has newlines every 60 chars — Node's Buffer handles this fine.
      const raw = Buffer.from(contentBase64, 'base64').toString('utf8');
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (parseErr) {
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
      lastTransientError = e.message;
      if (e.transient && attempt < MAX_ATTEMPTS) continue;
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
