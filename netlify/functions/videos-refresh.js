// netlify/functions/videos-refresh.js
// Scheduled daily (see netlify.toml schedule). Pulls the @MYROBOTSHOP YouTube
// channel RSS *server-side* (no CORS proxy needed) and commits data/videos.json
// to the repo with [skip ci] (no deploy — the site reads data/videos.json from
// GitHub raw). This replaces the flaky client-side public-CORS-proxy fetch that
// was showing "Couldn't load videos right now." on the site.

const REPO    = "myrobot42/myrobot-shop";
const BRANCH  = "main";
const FILE    = "data/videos.json";
const CHANNEL = "UCB6SnhND4A3b_QGetSqPYcA"; // @MYROBOTSHOP
const FEED    = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL}`;
const MAX_VIDEOS = 15;

function decode(s){
  return (s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (m,h)=>String.fromCodePoint(parseInt(h,16)))
    .replace(/&#(\d+);/g, (m,n)=>String.fromCodePoint(parseInt(n,10)))
    .replace(/\s+/g, " ").trim();
}

// Parse the YouTube channel Atom feed into the same shape the client expects:
// { id, title, description, published, thumb, url }
function parseFeed(xml){
  const out = [];
  const parts = xml.split(/<entry[\s>]/i).slice(1);
  for (const raw of parts){
    const x = raw.split(/<\/entry>/i)[0];
    const idm = x.match(/<yt:videoId>([^<]+)<\/yt:videoId>/i);
    if (!idm) continue;
    const id = idm[1].trim();
    const tm = x.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = tm ? decode(tm[1]) : "";
    const pm = x.match(/<published>([^<]+)<\/published>/i);
    let published = pm ? pm[1].trim() : "";
    if (published){ const d = new Date(published); if (!isNaN(d)) published = d.toISOString(); }
    const dm = x.match(/<media:description>([\s\S]*?)<\/media:description>/i);
    const description = dm ? decode(dm[1]).slice(0, 220) : "";
    const thm = x.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i);
    const thumb = (thm && thm[1]) ? thm[1] : `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
    out.push({ id, title, description, published, thumb, url: `https://www.youtube.com/watch?v=${id}` });
  }
  return out;
}

async function build(){
  const r = await fetch(FEED, { headers: { "User-Agent": "myrobot-shop-videobot/1.0" } });
  if (!r.ok) throw new Error(`YouTube feed returned ${r.status}`);
  const xml = await r.text();
  if (!/<entry[\s>]/i.test(xml)) throw new Error("Feed had no entries");
  return parseFeed(xml).slice(0, MAX_VIDEOS);
}

async function commit(videos){
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("Missing GITHUB_TOKEN env var");
  const payload = {
    generated: new Date().toISOString(),
    channel: "@MYROBOTSHOP",
    count: videos.length,
    videos,
    _note: "Auto-generated daily from the YouTube channel RSS by videos-refresh.js."
  };
  const content = Buffer.from(JSON.stringify(payload, null, 2)).toString("base64");
  const api = `https://api.github.com/repos/${REPO}/contents/${FILE}`;
  const ghHeaders = {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/vnd.github+json",
    "User-Agent": "myrobot-shop-videobot",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  let sha;
  try { const g = await fetch(`${api}?ref=${BRANCH}`, { headers: ghHeaders }); if (g.ok) sha = (await g.json()).sha; } catch (e) {}
  const put = await fetch(api, {
    method: "PUT",
    headers: ghHeaders,
    body: JSON.stringify({
      message: `chore(videos): daily refresh ${new Date().toISOString().slice(0,10)} [skip ci]`,
      content, branch: BRANCH, ...(sha ? { sha } : {})
    })
  });
  if (!put.ok){ const t = await put.text(); throw new Error(`GitHub write failed: ${t.slice(0,400)}`); }
}

exports.handler = async function(){
  try {
    const videos = await build();
    if (!videos.length) return { statusCode: 502, body: "No videos parsed from feed" };
    await commit(videos);
    return { statusCode: 200, body: `Wrote ${videos.length} videos to ${FILE}` };
  } catch (e){
    return { statusCode: 500, body: String(e && e.message || e) };
  }
};
