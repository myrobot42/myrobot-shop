// netlify/functions/news-refresh.js
//
// Scheduled daily. Pulls robot-news RSS feeds, dedupes, filters to robotics,
// and commits data/news.json (which the News page already reads).
//
// SOURCE MODEL: RSS feeds are the free, high-signal backbone. fetchAllArticles()
// is the single swap-point — to add a paid API (NewsData.io, SerpApi, etc.) later,
// add a fetcher and concat its results; nothing else changes.
//
// Needs GITHUB_TOKEN (already in your Netlify env) to commit the result.

const REPO = 'myrobot42/myrobot-shop';

// Run daily at 05:00 UTC (before the 06:00 trends job)
exports.config = { schedule: '0 5 * * *' };

// ── Robot-focused RSS sources (high signal, no API key) ──
const FEEDS = [
  { url: 'https://www.therobotreport.com/feed/', source: 'The Robot Report' },
  { url: 'https://spectrum.ieee.org/feeds/topic/robotics.rss', source: 'IEEE Spectrum' },
  { url: 'https://www.unite.ai/category/robotics/feed/', source: 'Unite.AI' },
  { url: 'https://robohub.org/feed/', source: 'Robohub' },
  { url: 'https://www.therobotreport.com/category/humanoids/feed/', source: 'The Robot Report' },
];

// Keep an article only if it looks robotics-related (cheap noise filter)
const KEEP = /robot|humanoid|quadruped|cobot|drone|automat|android|exoskeleton|unitree|boston dynamics|tesla optimus|figure ai|agility|embodied|actuator|manipulat|legged|biped/i;
// Drop obvious commerce/junk
const DROP = /\b(deal|coupon|discount|sale ends|black friday|cyber monday|gift guide|best price|amazon prime day)\b/i;

const HOT_BRANDS = ['Tesla','Boston Dynamics','Unitree','Figure','Agility','1X','NEURA','Apptronik','UBTECH','Xiaomi','Fourier','Galbot','Sanctuary','Clone','EngineAI','Booster','DOBOT','Elephant Robotics','NVIDIA','DexForce','CASBOT','Hyundai'];

exports.handler = async () => {
  const GH_TOKEN = process.env.GITHUB_TOKEN;
  if (!GH_TOKEN) return { statusCode: 500, body: 'Missing GITHUB_TOKEN' };

  try {
    let articles = await fetchAllArticles();

    // Filter, dedupe by normalized title, sort newest first
    const seen = new Set();
    articles = articles
      .filter(a => a.title && a.url && KEEP.test(a.title + ' ' + (a.summary || '')) && !DROP.test(a.title))
      .filter(a => {
        const key = a.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 60);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => new Date(b.published) - new Date(a.published))
      .slice(0, 40)
      .map(a => ({
        id: hash(a.url),
        title: a.title,
        url: a.url,
        source: a.source,
        published: a.published,
        summary: a.summary || '',
        image: a.image || null,
        tags: deriveTags(a.title + ' ' + (a.summary || '')),
      }));

    const out = {
      generated: new Date().toISOString(),
      count: articles.length,
      items: articles,
      _note: 'Auto-generated daily from robotics RSS feeds by news-refresh.js',
    };

    await ghPutJson('data/news.json', out, GH_TOKEN, 'Daily news refresh [skip ci]');
    return { statusCode: 200, body: JSON.stringify({ ok: true, count: articles.length }) };
  } catch (err) {
    return { statusCode: 500, body: 'News refresh failed: ' + (err.message || String(err)) };
  }
};

// ─────────────────────────────────────────────────────────────
// SOURCE LAYER — the swap point. Add a paid-API fetcher here and
// concat its results; everything downstream stays the same.
// ─────────────────────────────────────────────────────────────
async function fetchAllArticles() {
  const all = [];
  for (const feed of FEEDS) {
    try {
      const resp = await fetch(feed.url, { headers: { 'User-Agent': 'Mozilla/5.0 (myrobot.shop news bot)' } });
      if (!resp.ok) continue;
      const xml = await resp.text();
      all.push(...parseRss(xml, feed.source));
    } catch (e) { /* skip a dead feed, keep going */ }
  }
  return all;
  // To add a paid source later:
  // all.push(...await fetchNewsDataIo(process.env.NEWSDATA_KEY));
  // return all;
}

// ── Minimal RSS/Atom parser (no deps) ──
function parseRss(xml, source) {
  const items = [];
  // handle both <item> (RSS) and <entry> (Atom)
  const blocks = xml.split(/<item[\s>]|<entry[\s>]/i).slice(1);
  for (const b of blocks) {
    const title = clean(pick(b, 'title'));
    let url = pick(b, 'link');
    // Atom links are often <link href="..."/>
    if (!url || /^\s*$/.test(url)) {
      const m = b.match(/<link[^>]*href=["']([^"']+)["']/i);
      if (m) url = m[1];
    }
    url = clean(url);
    const summary = clean(pick(b, 'description') || pick(b, 'summary') || pick(b, 'content'));
    const pubRaw = pick(b, 'pubDate') || pick(b, 'published') || pick(b, 'updated') || pick(b, 'dc:date');
    let published;
    try { published = new Date(clean(pubRaw)).toISOString(); } catch (e) { published = new Date().toISOString(); }
    // try to find an image (media:content, enclosure, or first <img>)
    let image = null;
    const mi = b.match(/<media:content[^>]*url=["']([^"']+)["']/i) ||
               b.match(/<enclosure[^>]*url=["']([^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i) ||
               b.match(/<img[^>]*src=["']([^"']+)["']/i);
    if (mi) image = mi[1];
    if (title && url) items.push({ title, url, source, published, summary: summary.slice(0, 320), image });
  }
  return items;
}

function pick(block, tag) {
  const re = new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i');
  const m = block.match(re);
  return m ? m[1] : '';
}
function clean(s) {
  if (!s) return '';
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/\s+/g, ' ').trim();
}
function deriveTags(text) {
  const tags = [];
  for (const b of HOT_BRANDS) if (new RegExp('\\b' + b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(text)) tags.push(b);
  if (/humanoid/i.test(text)) tags.push('Humanoid');
  if (/quadruped|robot dog/i.test(text)) tags.push('Quadruped');
  if (/drone/i.test(text)) tags.push('Drones');
  return [...new Set(tags)].slice(0, 4);
}
function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
  return Math.abs(h).toString(16).slice(0, 12);
}

// ── GitHub commit helper ──
async function ghPutJson(path, obj, token, message) {
  let sha = null;
  const head = await fetch('https://api.github.com/repos/' + REPO + '/contents/' + path, {
    headers: { 'Authorization': 'token ' + token, 'Accept': 'application/vnd.github.v3+json' },
  });
  if (head.ok) sha = (await head.json()).sha;
  const body = { message, content: Buffer.from(JSON.stringify(obj, null, 2)).toString('base64') };
  if (sha) body.sha = sha;
  const put = await fetch('https://api.github.com/repos/' + REPO + '/contents/' + path, {
    method: 'PUT',
    headers: { 'Authorization': 'token ' + token, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!put.ok) throw new Error('PUT ' + path + ' -> ' + put.status + ' ' + (await put.text()));
}
