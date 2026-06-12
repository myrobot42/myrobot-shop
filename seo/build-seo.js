// build-seo.js — generates one small static HTML page per robot (r/{id}.html)
// plus sitemap.xml, so Google can index every robot individually.
// Runs in GitHub Actions whenever data/robots.json changes. No dependencies.

const fs = require('fs');
const path = require('path');

const SITE = 'https://myrobot.shop';
const data = JSON.parse(fs.readFileSync('data/robots.json', 'utf8'));
const robots = Array.isArray(data) ? data : data.robots;

const outDir = 'r';
fs.mkdirSync(outDir, { recursive: true });

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function specPairs(r) {
  // A few headline specs for the static page (plain facts from the record).
  const pairs = [];
  if (r.cat) pairs.push(['Category', r.cat]);
  if (r.status) pairs.push(['Status', r.status]);
  if (r.year) pairs.push(['Year', r.year]);
  if (r.origin) pairs.push(['Origin', r.origin]);
  if (r.height_mm) pairs.push(['Height', r.height_mm + ' mm']);
  if (r.weight_kg) pairs.push(['Weight', r.weight_kg + ' kg']);
  if (r.payload_kg) pairs.push(['Payload', r.payload_kg + ' kg']);
  if (r.speed_ms) pairs.push(['Speed', r.speed_ms + ' m/s']);
  if (r.dof) pairs.push(['Degrees of freedom', r.dof]);
  if (r.battery_wh) pairs.push(['Battery', r.battery_wh + ' Wh']);
  else if (r.battery_ah) pairs.push(['Battery', r.battery_ah + ' Ah']);
  if (r.battery_life) pairs.push(['Runtime', r.battery_life + ' min']);
  return pairs.slice(0, 10);
}

let count = 0;
const urls = [];

for (const r of robots) {
  if (!r.id || !r.name) continue;
  const name = esc(r.name);
  const brand = esc(r.brand || '');
  const title = `${name} by ${brand} — specs, price & videos | myrobot.shop`;
  const descSrc = (r.desc || `${r.name} by ${r.brand} — full specifications, comparisons and videos on myrobot.shop.`);
  const desc = esc(String(descSrc).replace(/\s+/g, ' ').slice(0, 158));
  const img = r.img && /^https?:/.test(r.img) ? esc(r.img) : '';
  const appUrl = `${SITE}/#profile/${encodeURIComponent(r.id)}`;
  const pageUrl = `${SITE}/r/${encodeURIComponent(r.id)}.html`;

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: r.name,
    brand: { '@type': 'Brand', name: r.brand || '' },
    description: String(descSrc).slice(0, 500),
    url: pageUrl,
  };
  if (img) ld.image = r.img;
  if (r.cat) ld.category = r.cat;

  const rows = specPairs(r).map(p =>
    `<tr><td>${esc(p[0])}</td><td><b>${esc(p[1])}</b></td></tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<meta name="description" content="${desc}">
<link rel="canonical" href="${pageUrl}">
<meta property="og:site_name" content="myrobot.shop">
<meta property="og:type" content="website">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${pageUrl}">
${img ? `<meta property="og:image" content="${img}">` : ''}
<meta name="twitter:card" content="${img ? 'summary_large_image' : 'summary'}">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<style>
body{font-family:-apple-system,'Segoe UI',Roboto,sans-serif;max-width:680px;margin:40px auto;padding:0 20px;color:#111827}
img.hero{max-width:300px;max-height:300px;display:block;margin:0 0 16px;border:1px solid #e5e7eb;border-radius:12px;background:#fff;object-fit:contain}
h1{font-size:26px;margin:0 0 4px}.b{color:#6b7280;margin:0 0 16px}
table{border-collapse:collapse;width:100%;margin:18px 0}td{padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:14px}td:first-child{color:#6b7280;width:45%}
a.cta{display:inline-block;background:#0066ff;color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:9px;margin-top:8px}
p.note{color:#6b7280;font-size:13px}
</style>
</head>
<body>
${img ? `<img class="hero" src="${img}" alt="${name}">` : ''}
<h1>${name}</h1>
<p class="b">${brand}${r.cat ? ' · ' + esc(r.cat) : ''}${r.year ? ' · ' + esc(r.year) : ''}</p>
<p>${esc(String(descSrc).slice(0, 400))}</p>
${rows ? `<table>${rows}</table>` : ''}
<a class="cta" href="${appUrl}">View full interactive profile →</a>
<p class="note">Full specifications, side-by-side comparisons, videos and reviews on <a href="${SITE}/">myrobot.shop</a> — the world's largest robot database.</p>
</body>
</html>`;

  fs.writeFileSync(path.join(outDir, `${r.id}.html`), html);
  urls.push(pageUrl);
  count++;
}

// sitemap.xml — homepage + every robot page
const today = new Date().toISOString().slice(0, 10);
const sm = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>${SITE}/</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>
${urls.map(u => `<url><loc>${u}</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq></url>`).join('\n')}
</urlset>`;
fs.writeFileSync('sitemap.xml', sm);

console.log(`Generated ${count} robot pages in /${outDir} + sitemap.xml (${urls.length + 1} URLs)`);
