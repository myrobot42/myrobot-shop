// netlify/functions/brand-news-now.js
// MANUAL TRIGGER (HTTP). Same logic as scheduled brand-news-refresh.js, but invokable
// on demand by visiting /.netlify/functions/brand-news-now  — use it to test the
// LimX output immediately without waiting for the weekly schedule. Safe to delete after.
// For each brand in the catalogue it queries
// Google News RSS ("<brand>" robot), parses items with the SAME helpers as
// news-refresh.js, keeps the newest MAX_PER_BRAND, and commits data/brand-news.json
// to the repo with [skip ci] (no deploy — the site reads it from GitHub raw).
//
// Output shape:  { generated, count, brands: { "LimX Dynamics": [ {id,title,url,source,published,summary,image}, ... ], ... } }
//
// TEST MODE: while BRAND_ALLOWLIST is non-empty, only those brands are queried.
// Once verified on LimX, empty the allowlist to cover EVERY brand in robots.json.

const REPO   = "myrobot42/myrobot-shop";
const BRANCH = "main";
const FILE   = "data/brand-news.json";
const ROBOTS = "data/robots.json";
const MAX_PER_BRAND = 5;
const SUMMARY_MAX   = 900;

// ── TEST SCOPE ──────────────────────────────────────────────────────────────
// Keep this to ['LimX Dynamics'] for the first run. After confirming the output
// looks clean, set to [] (empty) to run across ALL brands found in robots.json.
const BRAND_ALLOWLIST = ["LimX Dynamics"];
// ─────────────────────────────────────────────────────────────────────────────

// Brands whose names are ambiguous get an extra qualifier so Google News stays on-topic.
// (e.g. "Figure", "1X", "Sanctuary" are common words). Everything else uses '"<brand>" robot'.
const QUERY_QUALIFIER = {
  "Figure": '"Figure AI" humanoid robot',
  "1X": '"1X Technologies" robot',
  "Sanctuary AI": '"Sanctuary AI" robot',
  "Apptronik": '"Apptronik" robot',
  "Sphero": '"Sphero" robot',
  "Shark": '"Shark" robot vacuum',
};

// ── helpers copied verbatim from news-refresh.js so behaviour is identical ────
function hashId(s){
  let h = 5381;
  for (let i=0;i<s.length;i++){ h = (((h<<5)+h) ^ s.charCodeAt(i)) >>> 0; }
  return h.toString(16).padStart(8,"0").slice(0,8);
}
function decode(s){
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/g, "'")
    .replace(/&#8217;/g, "'").replace(/&#8230;/g, "…").replace(/&nbsp;/g, " ")
    .replace(/&hellip;/g, "…").replace(/&mdash;/g, "—").replace(/&ndash;/g, "–")
    .replace(/&#x([0-9a-fA-F]+);/g, function(m,h){return String.fromCodePoint(parseInt(h,16));})
    .replace(/&#(\d+);/g, function(m,n){return String.fromCodePoint(parseInt(n,10));})
    .replace(/\s+/g, " ").trim();
}
function tag(xml, name){
  const m = xml.match(new RegExp("<"+name+"[^>]*>([\\s\\S]*?)<\\/"+name+">", "i"));
  return m ? decode(m[1]) : "";
}
function extractImage(itemXml){
  let m =
    itemXml.match(/<media:content[^>]+url=["']([^"']+)["'][^>]*>/i) ||
    itemXml.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i) ||
    itemXml.match(/<enclosure[^>]+url=["']([^"']+)["'][^>]*type=["']image/i) ||
    itemXml.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (m && m[1] && /^https?:\/\//i.test(m[1])) return m[1];
  return null;
}
function parseFeed(xml, source){
  const out = [];
  const unit = /<item[\s>]/i.test(xml) ? "item" : "entry";
  const parts = xml.split(new RegExp("<"+unit+"[\\s>]", "i")).slice(1);
  for (const raw of parts){
    const x = raw.split(new RegExp("<\\/"+unit+">", "i"))[0];
    const title = tag(x, "title");
    let url = "";
    const lm = x.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    if (lm) url = decode(lm[1]);
    if (!url){ const hm = x.match(/<link[^>]+href=["']([^"']+)["']/i); if (hm) url = hm[1]; }
    if (!title || !url) continue;

    let summary = tag(x, "content:encoded") || tag(x, "description") || tag(x, "summary") || "";
    if (summary.length > SUMMARY_MAX) summary = summary.slice(0, SUMMARY_MAX - 1).trim() + "…";

    const pub = tag(x, "pubDate") || tag(x, "published") || tag(x, "updated") || tag(x, "dc:date") || "";
    let published = new Date().toISOString();
    if (pub){ const d = new Date(pub); if (!isNaN(d)) published = d.toISOString(); }

    // Google News titles are usually "Headline - Publisher"; split publisher into source.
    let cleanTitle = title, src = source;
    const dash = title.lastIndexOf(" - ");
    if (dash > 0 && dash > title.length - 60){
      cleanTitle = title.slice(0, dash).trim();
      src = title.slice(dash + 3).trim() || source;
    }

    out.push({ id: hashId(url), title: cleanTitle, url, source: src, published, summary, image: extractImage(x) });
  }
  return out;
}

// Build the Google News RSS URL for a brand query.
function googleNewsRss(brand){
  const q = QUERY_QUALIFIER[brand] || ('"' + brand + '" robot');
  return "https://news.google.com/rss/search?q=" + encodeURIComponent(q) +
         "&hl=en-US&gl=US&ceid=US:en";
}

exports.handler = async function(){
  const token = process.env.GITHUB_TOKEN;
  if (!token) return { statusCode: 500, body: "Missing GITHUB_TOKEN env var" };

  const ghHeaders = {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/vnd.github+json",
    "User-Agent": "myrobot-shop-brandnews",
    "X-GitHub-Api-Version": "2022-11-28"
  };

  // 1) Read robots.json from GitHub raw and collect distinct brands.
  let brands = [];
  try {
    const rr = await fetch(`https://raw.githubusercontent.com/${REPO}/${BRANCH}/${ROBOTS}?t=${Date.now()}`);
    const robots = await rr.json();
    const set = new Set();
    for (const r of robots){ if (r && r.brand) set.add(String(r.brand).trim()); }
    brands = [...set].sort();
  } catch (e) {
    return { statusCode: 502, body: "Could not read robots.json: " + e.message };
  }

  // TEST SCOPE: restrict to allowlist if non-empty.
  if (BRAND_ALLOWLIST.length){
    brands = brands.filter(b => BRAND_ALLOWLIST.includes(b));
  }
  if (!brands.length) return { statusCode: 500, body: "No brands to query (check allowlist)." };

  // 2) Query Google News RSS per brand (sequential, gentle; a failing brand is skipped).
  const out = {};
  let total = 0;
  for (const brand of brands){
    try {
      const r = await fetch(googleNewsRss(brand), { headers: { "User-Agent": "myrobot-shop-brandnews/1.0" } });
      if (!r.ok) { out[brand] = []; continue; }
      let items = parseFeed(await r.text(), "Google News");
      items.sort((a, b) => new Date(b.published) - new Date(a.published));
      // dedupe by url, cap per brand
      const seen = new Set(); const kept = [];
      for (const it of items){ if (seen.has(it.url)) continue; seen.add(it.url); kept.push(it); if (kept.length >= MAX_PER_BRAND) break; }
      out[brand] = kept;
      total += kept.length;
    } catch (e) { out[brand] = []; }
  }

  // 3) Commit data/brand-news.json with [skip ci]
  const payload = {
    generated: new Date().toISOString(),
    brand_count: Object.keys(out).length,
    count: total,
    max_per_brand: MAX_PER_BRAND,
    brands: out,
    _note: "Auto-generated weekly by brand-news-refresh.js (Google News RSS per brand). Test scope: " +
           (BRAND_ALLOWLIST.length ? BRAND_ALLOWLIST.join(", ") : "ALL brands")
  };
  const content = Buffer.from(JSON.stringify(payload, null, 2)).toString("base64");
  const api = `https://api.github.com/repos/${REPO}/contents/${FILE}`;

  let sha;
  try {
    const g = await fetch(`${api}?ref=${BRANCH}`, { headers: ghHeaders });
    if (g.ok){ sha = (await g.json()).sha; }
  } catch (e) { /* file may not exist yet */ }

  const put = await fetch(api, {
    method: "PUT",
    headers: ghHeaders,
    body: JSON.stringify({
      message: `chore(brand-news): refresh ${new Date().toISOString().slice(0,10)} [skip ci]`,
      content, branch: BRANCH, ...(sha ? { sha } : {})
    })
  });
  if (!put.ok){ const t = await put.text(); return { statusCode: put.status, body: `GitHub write failed: ${t.slice(0,400)}` }; }

  return { statusCode: 200, body: `Wrote ${total} items across ${Object.keys(out).length} brand(s) to ${FILE}` };
};
