// netlify/functions/news-refresh-now.js
// MANUAL TRIGGER (HTTP). Same logic as the scheduled news-refresh.js, but
// invokable on demand by visiting /.netlify/functions/news-refresh-now
// Use it to repopulate data/news.json immediately. Safe to delete after use.

const REPO   = "myrobot42/myrobot-shop";
const BRANCH = "main";
const FILE   = "data/news.json";
const MAX_ITEMS = 30;
const SUMMARY_MAX = 900;

const FEEDS = [
  { url: "https://www.therobotreport.com/feed/",                source: "The Robot Report" },
  { url: "https://spectrum.ieee.org/feeds/topic/robotics.rss",  source: "IEEE Spectrum" },
  { url: "https://www.unite.ai/feed/",                          source: "Unite.AI" },
  { url: "https://robohub.org/feed/",                           source: "Robohub" },
];

// stable 8-char hex id from a string (unique per url)
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
    itemXml.match(/<enclosure[^>]+type=["']image[^>]*url=["']([^"']+)["']/i) ||
    itemXml.match(/<img[^>]+src=["']([^"']+)["']/i); // first <img> in content:encoded/description
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
    // strip common WordPress feed boilerplate so we don't waste lines on junk
    summary = summary
      .replace(/\s*The post\b[\s\S]*?appeared first on\b[^.]*\.?\s*$/i, "")
      .replace(/\s*(?:Continue reading|Read more|Read the full (?:article|story))\b[\s\S]*$/i, "")
      .replace(/\s*\[(?:…|\.\.\.)\]\s*$/i, "")
      .trim();
    if (summary.length > SUMMARY_MAX) summary = summary.slice(0, SUMMARY_MAX - 1).trim() + "…";

    const pub = tag(x, "pubDate") || tag(x, "published") || tag(x, "updated") || tag(x, "dc:date") || "";
    let published = new Date().toISOString();
    if (pub){ const d = new Date(pub); if (!isNaN(d)) published = d.toISOString(); }

    out.push({
      id: hashId(url),
      title, url, source, published,
      summary,
      image: extractImage(x),
      tags: []
    });
  }
  return out;
}

exports.handler = async function(){
  const token = process.env.GITHUB_TOKEN;
  if (!token) return { statusCode: 500, body: "Missing GITHUB_TOKEN env var" };

  // 1) Pull & parse all feeds (a failing feed is skipped, not fatal)
  let all = [];
  for (const f of FEEDS){
    try {
      const r = await fetch(f.url, { headers: { "User-Agent": "myrobot-shop-newsbot/1.0" } });
      if (!r.ok) continue;
      all = all.concat(parseFeed(await r.text(), f.source));
    } catch (e) { /* skip this feed */ }
  }

  // 2) Dedupe by url, newest first, cap
  all.sort((a, b) => new Date(b.published) - new Date(a.published));
  const seen = new Set();
  const items = [];
  for (const it of all){
    if (seen.has(it.url)) continue;
    seen.add(it.url);
    items.push(it);
    if (items.length >= MAX_ITEMS) break;
  }
  if (!items.length) return { statusCode: 502, body: "No items parsed from any feed" };

  // 3) Commit data/news.json with [skip ci]
  const payload = {
    generated: new Date().toISOString(),
    count: items.length,
    items,
    _note: "Auto-generated daily from robotics RSS feeds by news-refresh.js."
  };
  const content = Buffer.from(JSON.stringify(payload, null, 2)).toString("base64");
  const api = `https://api.github.com/repos/${REPO}/contents/${FILE}`;
  const ghHeaders = {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/vnd.github+json",
    "User-Agent": "myrobot-shop-newsbot",
    "X-GitHub-Api-Version": "2022-11-28"
  };

  let sha;
  try {
    const g = await fetch(`${api}?ref=${BRANCH}`, { headers: ghHeaders });
    if (g.ok){ sha = (await g.json()).sha; }
  } catch (e) { /* file may not exist yet */ }

  const put = await fetch(api, {
    method: "PUT",
    headers: ghHeaders,
    body: JSON.stringify({
      message: `chore(news): daily refresh ${new Date().toISOString().slice(0,10)} [skip ci]`,
      content,
      branch: BRANCH,
      ...(sha ? { sha } : {})
    })
  });

  if (!put.ok){
    const t = await put.text();
    return { statusCode: put.status, body: `GitHub write failed: ${t.slice(0,400)}` };
  }
  const withImg = items.filter(i => i.image).length;
  return { statusCode: 200, body: `Wrote ${items.length} items (${withImg} with images) to ${FILE}` };
};
