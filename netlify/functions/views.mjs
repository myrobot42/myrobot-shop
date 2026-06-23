// netlify/functions/views.mjs
// Per-robot view + fan counter, backed by Netlify Blobs.
import { getStore } from '@netlify/blobs';

const STORE = 'robot-stats';

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Cache-Control': 'no-store'
  };
}

function dayStr(d) { return d.toISOString().slice(0, 10); }

function lastNDays(n, offset = 0) {
  const out = [];
  const now = new Date();
  for (let i = offset; i < offset + n; i++) {
    const d = new Date(now);
    d.setUTCDate(now.getUTCDate() - i);
    out.push(dayStr(d));
  }
  return out;
}

function trendPct(daily) {
  daily = daily || {};
  const last7 = lastNDays(7, 0).reduce((s, k) => s + (daily[k] || 0), 0);
  const prev7 = lastNDays(7, 7).reduce((s, k) => s + (daily[k] || 0), 0);
  if (prev7 === 0) return last7 > 0 ? 100 : 0;
  return Math.round(((last7 - prev7) / prev7) * 100);
}

function pruneDaily(daily) {
  const keep = new Set(lastNDays(35, 0));
  for (const k of Object.keys(daily)) if (!keep.has(k)) delete daily[k];
  return daily;
}

async function readRec(store, id) {
  let rec = null;
  try { rec = await store.get('r:' + id, { type: 'json' }); } catch (e) { rec = null; }
  return rec || { views: 0, fans: 0, daily: {} };
}

function publicStats(rec) {
  return { views: rec.views || 0, fans: rec.fans || 0, trend: trendPct(rec.daily) };
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { headers: cors() });

  const store = getStore(STORE);
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const idsParam = url.searchParams.get('ids') || url.searchParams.get('id') || '';
    const ids = idsParam.split(',').map(s => s.trim()).filter(Boolean).slice(0, 60);
    if (ids.length === 1 && !url.searchParams.get('ids')) {
      const rec = await readRec(store, ids[0]);
      return Response.json(publicStats(rec), { headers: cors() });
    }
    const out = {};
    for (const id of ids) out[id] = publicStats(await readRec(store, id));
    return Response.json(out, { headers: cors() });
  }

  if (req.method === 'POST') {
    let body = {};
    try { body = await req.json(); } catch (e) {}
    const id = (body.id || '').toString().trim();
    const action = (body.action || 'view').toString();
    if (!id) return Response.json({ error: 'missing id' }, { status: 400, headers: cors() });

    const rec = await readRec(store, id);
    if (action === 'view') {
      rec.views = (rec.views || 0) + 1;
      rec.daily = rec.daily || {};
      const t = dayStr(new Date());
      rec.daily[t] = (rec.daily[t] || 0) + 1;
      pruneDaily(rec.daily);
    } else if (action === 'fan') {
      rec.fans = (rec.fans || 0) + 1;
    } else if (action === 'unfan') {
      rec.fans = Math.max(0, (rec.fans || 0) - 1);
    } else {
      return Response.json({ error: 'bad action' }, { status: 400, headers: cors() });
    }
    try { await store.setJSON('r:' + id, rec); } catch (e) {
      return Response.json({ error: 'store write failed' }, { status: 500, headers: cors() });
    }
    return Response.json(publicStats(rec), { headers: cors() });
  }

  return Response.json({ error: 'method not allowed' }, { status: 405, headers: cors() });
};
