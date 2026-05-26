// netlify/functions/bulk-merge.js
//
// SERVER-SIDE BULK MERGE — replaces all dangerous deployNow() callers.
//
// Every admin tool that previously pushed the entire ROBOTS array to GitHub now
// sends ONLY its changes through this function. The function fetches the latest
// robots.json from GitHub on every call, applies the changes, and commits back.
//
// This makes the server the source of truth — never the browser's stale memory.
//
// REQUEST: POST JSON
//   {
//     operation: "bulk_merge",
//     workerName?: string,
//     reason?: string,
//     changes: {
//       upsert?: [{ id, ...fields }, ...],   // add new robots or update existing
//       delete?: [id1, id2, ...]              // remove robots by ID
//     }
//   }
//
// RESPONSE:
//   200 { ok: true, added: N, updated: N, deleted: N, total: N, commit: <sha> }
//   400 { ok: false, error: "..." } for bad input
//   413 { ok: false, error: "..." } for limits exceeded
//   500 { ok: false, error: "..." } for GitHub failures
//
// SAFETY CONSTRAINTS (cannot be bypassed by caller):
//   - max 100 deletes per call (refuses larger; prevents catastrophic wipes)
//   - max 500 upserts per call (refuses larger; prevents schema corruption)
//   - if upsert omits `gallery` field → existing gallery preserved (NEVER wipes)
//   - if upsert omits `img` field → existing img preserved
//   - required fields validated on new entries (id, name, brand, cat)
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

const MAX_DELETES_PER_CALL = 100;
const MAX_UPSERTS_PER_CALL = 500;

const REQUIRED_FIELDS_ON_NEW = ['id', 'name', 'brand', 'cat'];

// Field-level preservation: if an upsert omits these, the server keeps the existing value.
// Critical for not wiping galleries when a tool only intends to update other fields.
const PRESERVE_IF_OMITTED = ['gallery', 'img'];

exports.handler = async (event) => {
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

  // --- Parse + validate request ---
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ ok: false, error: 'Invalid JSON' }) }; }

  const { changes, workerName, reason } = body;
  if (!changes || typeof changes !== 'object') {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ ok: false, error: 'changes object required' }) };
  }

  const upserts = Array.isArray(changes.upsert) ? changes.upsert : [];
  const deletes = Array.isArray(changes.delete) ? changes.delete : [];

  if (upserts.length === 0 && deletes.length === 0) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ ok: false, error: 'No upserts or deletes provided' }) };
  }

  // --- Safety limits ---
  if (deletes.length > MAX_DELETES_PER_CALL) {
    return {
      statusCode: 413, headers: cors,
      body: JSON.stringify({ ok: false, error: `Too many deletes: ${deletes.length} (max ${MAX_DELETES_PER_CALL}). Split into smaller batches.` })
    };
  }
  if (upserts.length > MAX_UPSERTS_PER_CALL) {
    return {
      statusCode: 413, headers: cors,
      body: JSON.stringify({ ok: false, error: `Too many upserts: ${upserts.length} (max ${MAX_UPSERTS_PER_CALL}). Split into smaller batches.` })
    };
  }

  // --- Validate upserts have IDs ---
  for (const u of upserts) {
    if (!u || !u.id || typeof u.id !== 'string') {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ ok: false, error: 'Every upsert must have a string id' }) };
    }
  }
  for (const d of deletes) {
    if (!d || typeof d !== 'string') {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ ok: false, error: 'Every delete must be a string id' }) };
    }
  }

  if (!GITHUB_TOKEN) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ ok: false, error: 'GITHUB_TOKEN not configured on server' }) };
  }

  // --- GitHub API setup ---
  const apiBase = `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`;
  const ghHeaders = {
    'Authorization': `token ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'myrobot-shop-bulk-merge',
  };

  // --- Optimistic concurrency loop ---
  // Handles both 409/422 SHA conflicts AND transient GitHub errors (truncated JSON, 5xx).
  // Exponential backoff: 100ms, 300ms, 900ms between attempts.
  const MAX_ATTEMPTS = 4;
  let attempt = 0;
  let lastTransientError = null;
  while (attempt < MAX_ATTEMPTS) {
    attempt++;
    if (attempt > 1){
      const delay = 100 * Math.pow(3, attempt - 2);
      await new Promise(r => setTimeout(r, delay));
    }

    // 1. Fetch latest robots.json from GitHub
    let currentSha = null;
    let robots = null;
    let dataIsArray = true; // track original wrapper format
    try {
      const r = await fetch(`${apiBase}?ref=${encodeURIComponent(GITHUB_BRANCH)}`, { headers: ghHeaders });
      if (!r.ok) {
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
        lastTransientError = `GitHub response parse failed: ${parseErr.message}`;
        if (attempt < MAX_ATTEMPTS) continue;
        return { statusCode: 502, headers: cors, body: JSON.stringify({ ok: false, error: `GitHub returned malformed JSON after ${attempt} attempts: ${parseErr.message}` }) };
      }
      currentSha = fileData.sha;
      if (!fileData.content) {
        return { statusCode: 502, headers: cors, body: JSON.stringify({ ok: false, error: 'GitHub response missing content field' }) };
      }
      const raw = Buffer.from(fileData.content, 'base64').toString('utf8');
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (parseErr) {
        lastTransientError = `robots.json parse failed: ${parseErr.message}`;
        if (attempt < MAX_ATTEMPTS) continue;
        return { statusCode: 500, headers: cors, body: JSON.stringify({ ok: false, error: `robots.json corrupted after ${attempt} attempts: ${parseErr.message}` }) };
      }
      if (Array.isArray(parsed)) {
        robots = parsed;
        dataIsArray = true;
      } else if (parsed && Array.isArray(parsed.robots)) {
        robots = parsed.robots;
        dataIsArray = false;
      } else {
        return { statusCode: 500, headers: cors, body: JSON.stringify({ ok: false, error: 'robots.json is malformed — expected array or {robots:[...]}' }) };
      }
    } catch (e) {
      lastTransientError = `GitHub fetch network error: ${e.message}`;
      if (attempt < MAX_ATTEMPTS) continue;
      return { statusCode: 502, headers: cors, body: JSON.stringify({ ok: false, error: `GitHub fetch failed after ${attempt} attempts: ${e.message}` }) };
    }

    // 2. Build index by ID for fast lookups
    const byId = new Map();
    robots.forEach((r, idx) => { if (r && r.id) byId.set(r.id, idx); });

    let addedCount = 0;
    let updatedCount = 0;
    let deletedCount = 0;
    const skipped = [];

    // 3. Apply deletes
    if (deletes.length > 0) {
      const deleteSet = new Set(deletes);
      const before = robots.length;
      robots = robots.filter(r => !(r && r.id && deleteSet.has(r.id)));
      deletedCount = before - robots.length;
      // Rebuild index after delete
      byId.clear();
      robots.forEach((r, idx) => { if (r && r.id) byId.set(r.id, idx); });
    }

    // 4. Apply upserts
    for (const u of upserts) {
      const existingIdx = byId.get(u.id);
      if (existingIdx !== undefined) {
        // UPDATE: merge u onto existing record
        const existing = robots[existingIdx];
        // Preserve gallery/img if the upsert doesn't include them — critical safety
        const merged = { ...existing };
        for (const [k, v] of Object.entries(u)) {
          merged[k] = v;
        }
        // Defensive: if PRESERVE field was explicitly omitted from upsert and exists on existing, keep it
        for (const k of PRESERVE_IF_OMITTED) {
          if (!(k in u) && k in existing) {
            merged[k] = existing[k];
          }
        }
        robots[existingIdx] = merged;
        updatedCount++;
      } else {
        // ADD: must have required fields
        const missing = REQUIRED_FIELDS_ON_NEW.filter(f => !u[f]);
        if (missing.length > 0) {
          skipped.push({ id: u.id, reason: `missing required fields: ${missing.join(', ')}` });
          continue;
        }
        robots.push(u);
        byId.set(u.id, robots.length - 1);
        addedCount++;
      }
    }

    // 5. Re-serialize + commit
    const outputObj = dataIsArray ? robots : { robots };
    const newContent = Buffer.from(JSON.stringify(outputObj, null, 2), 'utf8').toString('base64');

    const summary = [];
    if (addedCount) summary.push(`+${addedCount}`);
    if (updatedCount) summary.push(`~${updatedCount}`);
    if (deletedCount) summary.push(`-${deletedCount}`);
    const commitMsg = `Bulk merge: ${summary.join(' ')} (${robots.length} total)${reason ? ' — ' + reason : ''}${workerName ? ' — ' + workerName : ''}`;

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
        // Conflict — someone else committed between our fetch + put. Retry.
        if (attempt < MAX_ATTEMPTS) continue;
        return { statusCode: 503, headers: cors, body: JSON.stringify({ ok: false, error: 'Concurrent commit conflict after retries. Try again.' }) };
      }
      if (!put.ok) {
        const errText = await put.text();
        return { statusCode: 502, headers: cors, body: JSON.stringify({ ok: false, error: `GitHub PUT failed: ${put.status} ${errText.slice(0, 200)}` }) };
      }

      const result = await put.json();
      return {
        statusCode: 200,
        headers: cors,
        body: JSON.stringify({
          ok: true,
          added: addedCount,
          updated: updatedCount,
          deleted: deletedCount,
          total: robots.length,
          skipped,
          commit: result.commit && result.commit.sha,
          attempt,
        }),
      };
    } catch (e) {
      return { statusCode: 502, headers: cors, body: JSON.stringify({ ok: false, error: `GitHub PUT error: ${e.message}` }) };
    }
  }

  return { statusCode: 503, headers: cors, body: JSON.stringify({ ok: false, error: 'Too many concurrent attempts' }) };
};
