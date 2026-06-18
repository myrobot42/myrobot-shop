// netlify/functions/trends-refresh.js
//
// Scheduled daily. Fetches Google Trends interest for a shortlist of famous/recent
// robots, computes a 0-100 trend score for each, and commits trending.json to the
// repo (which the homepage reads to rank "Trending Now").
//
// DATA SOURCE: Google Trends has no official API. This uses the same public endpoint
// pytrends wraps. It's free but can be rate-limited. The fetchTrendScore() function is
// isolated so you can swap in a paid provider (SerpApi/DataForSEO) later without
// touching anything else.
//
// Setup: this needs GITHUB_TOKEN (already in your Netlify env) to commit the result.

const REPO = 'myrobot42/myrobot-shop';

// ── Schedule: run daily at 06:00 UTC ──
exports.config = { schedule: '0 6 * * *' };

exports.handler = async () => {
  const GH_TOKEN = process.env.GITHUB_TOKEN;
  if (!GH_TOKEN) {
    return { statusCode: 500, body: 'Missing GITHUB_TOKEN' };
  }

  try {
    // 1. Load the robot list from the repo so we know who to track
    const robots = await ghGetJson('data/robots.json', GH_TOKEN);
    const list = Array.isArray(robots) ? robots : robots.robots;

    // 2. Pick the trend candidates (famous brands + recent), cap at 40
    const HOT = ['Tesla','Boston Dynamics','Unitree','Figure','Figure AI','Agility Robotics','1X','1X Technologies','NEURA Robotics','Apptronik','UBTECH','Xiaomi','Fourier','Galbot','Clone Robotics','Deep Robotics','EngineAI','Booster Robotics','Noble Machines','Hexagon'];
    const candidates = list
      .filter(r => HOT.includes(r.brand) && parseInt(r.year) >= 2023)
      .map(r => ({ id: r.id, term: (r.brand + ' ' + r.name).replace(/\s+/g, ' ').trim(), year: parseInt(r.year) || 0 }))
      .sort((a, b) => b.year - a.year)
      .slice(0, 40);

    // 3. Fetch a trend score for each (sequential with delay to avoid rate limiting)
    const scores = {};
    for (const c of candidates) {
      try {
        const score = await fetchTrendScore(c.term);
        if (score != null) scores[c.id] = score;
      } catch (e) {
        // skip individual failures; don't abort the whole run
      }
      await sleep(1500);
    }

    // 4. Build the output and commit it
    const gotCount = Object.keys(scores).length;
    // If Google blocked everything (0 scores), DON'T overwrite the last good file — just report.
    if (gotCount === 0) {
      return { statusCode: 200, body: JSON.stringify({ ok: false, tracked: 0, note: 'Google Trends returned no usable data (likely rate-limited/blocked). Kept previous trending.json. Consider a paid source.' }) };
    }

    const out = {
      updated: new Date().toISOString(),
      source: 'google-trends',
      scores, // { robotId: 0-100 }
    };

    await ghPutJson('data/trending.json', out, GH_TOKEN, 'Daily trends refresh [skip ci]');

    return { statusCode: 200, body: JSON.stringify({ ok: true, tracked: gotCount }) };
  } catch (err) {
    return { statusCode: 500, body: 'Trends refresh failed: ' + (err.message || String(err)) };
  }
};

// ─────────────────────────────────────────────────────────────
// DATA SOURCE — swap this one function to change providers.
// Returns a 0-100 number (relative interest), or null on failure.
// ─────────────────────────────────────────────────────────────
async function fetchTrendScore(term) {
  // Google Trends "interest over time" via the public endpoint pytrends uses.
  // Step 1: get a widget token. Step 2: fetch the multiline data.
  const explore = 'https://trends.google.com/trends/api/explore?hl=en-US&tz=0&req=' +
    encodeURIComponent(JSON.stringify({
      comparisonItem: [{ keyword: term, geo: '', time: 'today 1-m' }],
      category: 0,
      property: '',
    })) + '&tz=0';

  const tokenResp = await fetch(explore, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36' } });
  if (!tokenResp.ok) return null;
  let txt = await tokenResp.text();
  if (!txt || txt.length < 10) return null; // blocked / empty response
  txt = txt.replace(/^\)\]\}',?\s*/, ''); // strip Google's anti-JSON prefix
  let widgets;
  try { widgets = JSON.parse(txt).widgets || []; }
  catch (e) { return null; } // Google returned non-JSON (blocked) — skip this term
  const tl = widgets.find(w => w.id === 'TIMESERIES');
  if (!tl) return null;

  const dataUrl = 'https://trends.google.com/trends/api/widgetdata/multiline?hl=en-US&tz=0&req=' +
    encodeURIComponent(JSON.stringify(tl.request)) + '&token=' + tl.token + '&tz=0';
  const dataResp = await fetch(dataUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36' } });
  if (!dataResp.ok) return null;
  let d = await dataResp.text();
  if (!d || d.length < 10) return null;
  d = d.replace(/^\)\]\}',?\s*/, '');
  let timeline;
  try { timeline = (JSON.parse(d).default || {}).timelineData || []; }
  catch (e) { return null; }
  if (!timeline.length) return null;

  // Use the average of the last week's daily interest values as the score
  const recent = timeline.slice(-7);
  const avg = recent.reduce((s, p) => s + (p.value && p.value[0] ? p.value[0] : 0), 0) / recent.length;
  return Math.round(avg);
}

// ── GitHub helpers ──
async function ghGetJson(path, token) {
  const r = await fetch('https://api.github.com/repos/' + REPO + '/contents/' + path, {
    headers: { 'Authorization': 'token ' + token, 'Accept': 'application/vnd.github.v3+json' },
  });
  if (!r.ok) throw new Error('GET ' + path + ' → ' + r.status);
  const meta = await r.json();
  const content = Buffer.from(meta.content, 'base64').toString('utf-8');
  return JSON.parse(content);
}

async function ghPutJson(path, obj, token, message) {
  // get existing sha if file exists
  let sha = null;
  const head = await fetch('https://api.github.com/repos/' + REPO + '/contents/' + path, {
    headers: { 'Authorization': 'token ' + token, 'Accept': 'application/vnd.github.v3+json' },
  });
  if (head.ok) { sha = (await head.json()).sha; }

  const body = {
    message,
    content: Buffer.from(JSON.stringify(obj, null, 2)).toString('base64'),
  };
  if (sha) body.sha = sha;

  const put = await fetch('https://api.github.com/repos/' + REPO + '/contents/' + path, {
    method: 'PUT',
    headers: { 'Authorization': 'token ' + token, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!put.ok) throw new Error('PUT ' + path + ' → ' + put.status + ' ' + (await put.text()));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
