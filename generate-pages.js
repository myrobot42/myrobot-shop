#!/usr/bin/env node
/* myrobot.shop — static page + sitemap generator (Phase 1 SEO)
   Reads data/robots.json, writes fat /r/<id>.html per robot + sitemap.xml.
   Run at build time (netlify.toml [build] command) so pages stay fresh. */
const fs = require('fs');
const path = require('path');

// Safety net: never let a generation error fail the whole Netlify deploy.
// Logs the cause to the build log, writes whatever it managed, exits clean.
process.on('uncaughtException', function(e){
  console.error('[generate-pages] non-fatal error (deploy not blocked):', e && e.message);
  process.exit(0);
});

const ROOT = process.argv[2] || '.';
const OUT  = process.argv[3] || ROOT;
const SITE = 'https://myrobot.shop';
const AMZ_TAG = 'myrobotshop-20';
const MASCOT = 'https://res.cloudinary.com/djrojgec1/image/upload/f_auto,q_auto/v1777366404/output_17_t74qys.jpg';
const BUYABLE = ['Consumer','Drones','Educational','Social','Entertainment','Telepresence'];

const raw = JSON.parse(fs.readFileSync(path.join(ROOT,'data','robots.json'),'utf8'));
const ROBOTS = Array.isArray(raw) ? raw : (raw.robots || []);

const esc = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const attr = s => esc(s).replace(/'/g,'&#39;');
const has = v => v!==undefined && v!==null && v!=='' && v!==0 && !(Array.isArray(v)&&!v.length);
function g(r, ...keys){ for(const k of keys){ if(has(r[k])) return r[k]; } return undefined; }
function arr(v){ return Array.isArray(v) ? v.join(', ') : v; }

/* ---- price tier (category-relative quintile, mirrors the app) ---- */
const catPrices = {};
for(const r of ROBOTS){ const p=(typeof r.price==='number'&&r.price>0)?r.price:null; if(p){ (catPrices[r.cat]=catPrices[r.cat]||[]).push(p); } }
for(const c in catPrices) catPrices[c].sort((a,b)=>a-b);
function priceTier(r){
  const p=(typeof r.price==='number'&&r.price>0)?r.price:null; if(!p) return null;
  const arrp=catPrices[r.cat]||[]; if(arrp.length<2) return 3;
  const rank=arrp.filter(x=>x<=p).length; const t=Math.ceil(rank/arrp.length*5);
  return Math.min(5,Math.max(1,t));
}
function priceStars(r){ const t=priceTier(r); if(t==null) return 'Price on application'; return '★'.repeat(t)+'☆'.repeat(5-t); }

/* ---- affiliate (mirrors index.html affiliateLink) ---- */
function amzQuery(r){
  var brand=(r.brand||'').trim(), name=(r.name||'').trim();
  name=name.split(/\s[\u2013\u2014-]\s/)[0].replace(/\([^)]*\)/g,' ').replace(/\s+/g,' ').trim();
  var q=name;
  if(brand && name.toLowerCase().indexOf(brand.toLowerCase())!==0) q=brand+' '+name;
  q=q.replace(/\s+(rose gold|graphite|titanium|black|white|silver|grey|gray|blue|red|green|gold|beige|cream|bronze|copper|pearl|navy)$/i,'');
  return q.replace(/\s+/g,' ').trim();
}
function affiliate(r){
  if(r.buy_hide) return null;
  if(has(r.buy_url)){ let u=r.buy_url; if(/amazon\./i.test(u)&&u.indexOf('tag=')<0) u+=(u.indexOf('?')>=0?'&':'?')+'tag='+AMZ_TAG; return {url:u,label:r.buy_label||'Check price'}; }
  if((r.brand||'').toLowerCase().indexOf('dji')>=0) return null;
  if(BUYABLE.indexOf(r.cat)>=0){ const q=encodeURIComponent(amzQuery(r)); return {url:'https://www.amazon.com/s?k='+q+'&tag='+AMZ_TAG, label:'Check price on Amazon'}; }
  return null;
}

/* ---- spec rows: ordered, alias-aware; only render what's present ---- */
const SPECS = [
  ['Also known as', r=>g(r,'also_known_as')],
  ['Announced', r=>g(r,'announced')],
  ['Released', r=>g(r,'released')],
  ['Dimensions (H×W×D)', r=>{const h=g(r,'height_mm'),w=g(r,'width_mm'),d=g(r,'depth_mm'); if(h&&w) return d?`${h} × ${w} × ${d} mm`:`${h} × ${w} mm`; return undefined;}],
  ['Weight', r=>{const v=g(r,'weight_kg','weight'); return has(v)?v+' kg':undefined;}],
  ['Frame', r=>g(r,'frame_material','material')],
  ['IP rating', r=>g(r,'ip_rating')],
  ['Degrees of freedom', r=>g(r,'dof')],
  ['Payload', r=>{const v=g(r,'payload','payload_kg'); return has(v)?v+' kg':undefined;}],
  ['Reach', r=>{const v=g(r,'reach','reach_mm'); return has(v)?v+' mm':undefined;}],
  ['Max speed', r=>{const v=g(r,'speed','speed_ms'); return has(v)?v+' m/s':undefined;}],
  ['Running speed', r=>{const v=g(r,'run_speed','run_speed_ms'); return has(v)?v+' m/s':undefined;}],
  ['Repeatability', r=>{const v=g(r,'repeatability'); return has(v)?'±'+v+' mm':undefined;}],
  ['Battery', r=>{const v=g(r,'battery_wh'); return has(v)?v+' Wh':undefined;}],
  ['Battery life', r=>{const v=g(r,'battery_life','battery_life_typical'); return has(v)?v+' min':undefined;}],
  ['Charge time', r=>{const v=g(r,'charge_time','charge_time_min'); return has(v)?v+' min':undefined;}],
  ['Suction', r=>{const v=g(r,'suction_pa'); return has(v)?v+' Pa':undefined;}],
  ['Flight time', r=>{const v=g(r,'max_flight_time','flight_time_min'); return has(v)?v+' min':undefined;}],
  ['Max range', r=>{const v=g(r,'max_range','range_km'); return has(v)?v+' km':undefined;}],
  ['Max depth', r=>{const v=g(r,'max_depth_m','depth_rating_m'); return has(v)?v+' m':undefined;}],
  ['Camera', r=>{const v=g(r,'camera_mp'); return has(v)?v+' MP':g(r,'cameras');}],
  ['Chipset', r=>g(r,'chipset')],
  ['AI model', r=>g(r,'ai_model')],
  ['Operating system', r=>g(r,'os')],
  ['Actuator type', r=>g(r,'actuator_type')],
  ['Navigation', r=>g(r,'navigation')],
  ['Connectivity', r=>{const w=[];if(has(g(r,'wifi')))w.push('Wi-Fi');if(has(g(r,'bluetooth')))w.push('Bluetooth');if(has(g(r,'cellular')))w.push(arr(g(r,'cellular')));if(r.gps)w.push('GPS');return w.length?w.join(', '):undefined;}],
  ['Use cases', r=>{const v=g(r,'use_cases'); return has(v)?arr(v):undefined;}],
  ['Warranty', r=>{const v=g(r,'warranty_months'); return has(v)?v+' months':undefined;}],
  ['Made in', r=>g(r,'made_in','origin')],
];

function specRows(r){
  const rows=[['Category',r.cat],['Sub-type',r.sub],['Status',r.status||'Active'],['Year',r.year],['Origin',r.origin]];
  for(const [label,fn] of SPECS){ const v=fn(r); if(has(v)) rows.push([label, arr(v)]); }
  // de-dup labels, cap
  const seen=new Set(); const out=[];
  for(const [l,v] of rows){ if(has(v)&&!seen.has(l)){ seen.add(l); out.push([l,v]); } }
  return out;
}

function related(r){
  return ROBOTS.filter(x=>x.id!==r.id && x.cat===r.cat).slice(0,6);
}

function metaDesc(r){
  let d=(r.desc||`${r.name} by ${r.brand} — full specifications, price and videos.`).replace(/\s+/g,' ').trim();
  return d.length>158 ? d.slice(0,155).trim()+'…' : d;
}

function ytId(u){ if(!u) return ''; u=String(u).trim(); if(/^[A-Za-z0-9_-]{11}$/.test(u)) return u; const m=u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/); return m?m[1]:''; }
function allImages(r){ const a=[]; if(has(r.img))a.push(r.img); (Array.isArray(r.gallery)?r.gallery:[]).forEach(u=>{ if(has(u)&&!a.includes(u))a.push(u); }); return a; }
function videoList(r){ let v=Array.isArray(r.videos)?r.videos.slice():[]; if(!v.length){ if(has(r.video))v.push({url:r.video,source:'manufacturer'}); if(has(r.video2))v.push({url:r.video2,source:'manufacturer'}); } return v.map(x=>({title:x.title,source:x.source,id:ytId(x.url)})).filter(x=>x.id); }

function jsonld(r){
  const imgs=allImages(r); if(!imgs.length) imgs.push(MASCOT);
  const o={"@context":"https://schema.org","@type":"Product","name":r.name,"brand":{"@type":"Brand","name":r.brand},
    "description":metaDesc(r),"url":`${SITE}/r/${r.id}.html`,"image":imgs,"category":r.cat};
  /* Real per-store prices now exist for some robots — expose USD as AggregateOffer (matches the
     visible Prices table). Reviews still omitted until they're real. */
  const usd=(Array.isArray(r.prices)?r.prices:[]).filter(p=>p&&p.price!=null&&(p.currency||'USD')==='USD').map(p=>Number(p.price)).filter(x=>!isNaN(x));
  if(usd.length){ o.offers={"@type":"AggregateOffer","priceCurrency":"USD","lowPrice":Math.min(...usd),"highPrice":Math.max(...usd),"offerCount":usd.length,"availability":"https://schema.org/InStock"}; }
  return JSON.stringify(o);
}

function pricesHtml(r){
  const prices=Array.isArray(r.prices)?r.prices.filter(p=>p&&(p.url||p.price!=null)):[];
  if(!prices.length) return '';
  const sym={USD:'$',AUD:'A$',GBP:'£',EUR:'€',CAD:'C$',INR:'₹'};
  const rowsH=prices.map(p=>{
    const price=(p.price!=null)?((sym[p.currency]||'')+Number(p.price).toLocaleString()):'—';
    const storeTxt=esc(p.store||'Store');
    const storeCell=p.url?`<a href="${attr(p.url)}" target="_blank" rel="sponsored nofollow noopener">${storeTxt}</a>`:storeTxt;
    return `<tr><td>${esc(p.region||'')}</td><td>${storeCell}</td><td>${esc(p.variant||'Standard')}</td><td class="pcur">${esc(price)}</td></tr>`;
  }).join('');
  return `<h2>${esc(r.name)} — prices</h2><table class="ptable"><tbody><tr><td><b>Region</b></td><td><b>Store</b></td><td><b>Variant</b></td><td><b>Price</b></td></tr>${rowsH}</tbody></table><div class="disc">Prices are indicative and may exclude tax/shipping — check the store for the final price. As an Amazon Associate and via partner stores, myrobot.shop may earn a commission on qualifying purchases.</div>`;
}

function picturesHtml(r){
  const imgs=allImages(r);
  if(imgs.length<2) return '';
  return `<h2>${esc(r.name)} — pictures</h2><div class="gal">${imgs.map((u,i)=>`<img src="${attr(u)}" alt="${attr(r.name)} — image ${i+1}" loading="lazy">`).join('')}</div>`;
}

function videosHtml(r){
  const vids=videoList(r);
  if(!vids.length) return '';
  return `<h2>${esc(r.name)} — videos</h2><div class="vids">${vids.map(v=>{
    const thumb=`https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`;
    const watch=`https://www.youtube.com/watch?v=${v.id}`;
    const label=v.title||`${r.name} video`;
    return `<a class="vid" href="${attr(watch)}" target="_blank" rel="noopener"><img src="${attr(thumb)}" alt="${attr(label)}" loading="lazy"><span>${esc(label)}${v.source==='tobo'?' · Tobo':''}</span></a>`;
  }).join('')}</div>`;
}

const CSS = `*{box-sizing:border-box}body{font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:760px;margin:0 auto;padding:24px 20px 60px;color:#111827;line-height:1.55}a{color:#0066ff}.crumb{font-size:13px;color:#6b7280;margin-bottom:18px}.crumb a{text-decoration:none}img.hero{max-width:340px;width:100%;display:block;margin:0 0 18px;border:1px solid #e5e7eb;border-radius:14px;background:#fff;object-fit:contain;max-height:340px}h1{font-size:28px;margin:0 0 4px;line-height:1.15}.sub{color:#6b7280;font-weight:600;margin:0 0 16px;font-size:15px}.lead{font-size:15px;color:#374151;margin:0 0 18px}.price{font-size:15px;margin:0 0 16px}.price .stars{color:#16a34a;letter-spacing:2px;font-size:18px;vertical-align:middle}.cta{display:inline-block;background:#0066ff;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:9px;margin:4px 8px 4px 0}.aff{display:inline-block;background:#ff9900;color:#111;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:9px;margin:4px 0}h2{font-size:18px;margin:30px 0 10px;border-bottom:2px solid #f0f2f5;padding-bottom:6px}table{border-collapse:collapse;width:100%}td{padding:9px 10px;border-bottom:1px solid #eef0f3;font-size:14px;vertical-align:top}td:first-child{color:#6b7280;width:42%}.rel{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}.rel a{display:inline-block;border:1px solid #e5e7eb;border-radius:999px;padding:7px 13px;font-size:13px;text-decoration:none;color:#111827}.disc{color:#9ca3af;font-size:11px;margin-top:10px}footer{margin-top:36px;padding-top:18px;border-top:1px solid #e5e7eb;font-size:13px;color:#6b7280}footer a{text-decoration:none}.gal{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:6px 0}.gal img{width:100%;height:auto;border:1px solid #e5e7eb;border-radius:10px;background:#fff;object-fit:contain;aspect-ratio:1/1}.vids{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin:6px 0}.vids .vid{display:block;text-decoration:none;color:#111827;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden}.vids .vid img{width:100%;display:block;aspect-ratio:16/9;object-fit:cover}.vids .vid span{display:block;padding:8px 10px;font-size:13px;font-weight:600}.ptable td:first-child{width:auto}.pcur{color:#16a34a;font-weight:700;white-space:nowrap}@media(max-width:520px){.gal{grid-template-columns:repeat(2,1fr)}.vids{grid-template-columns:1fr}}`;

function page(r){
  const img=r.img||MASCOT;
  const title=`${r.name} by ${r.brand} — specs, price & videos | myrobot.shop`;
  const desc=metaDesc(r);
  const url=`${SITE}/r/${r.id}.html`;
  const aff=affiliate(r);
  const rows=specRows(r);
  const rel=related(r);
  const subbits=[r.brand,r.cat,r.year].filter(has).join(' · ');
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${attr(desc)}">
<link rel="canonical" href="${url}">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta property="og:type" content="product"><meta property="og:title" content="${attr(title)}">
<meta property="og:description" content="${attr(desc)}"><meta property="og:url" content="${url}">
<meta property="og:image" content="${attr(img)}"><meta property="og:site_name" content="myrobot.shop">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${attr(title)}">
<meta name="twitter:description" content="${attr(desc)}"><meta name="twitter:image" content="${attr(img)}">
<script type="application/ld+json">${jsonld(r)}</script>
<style>${CSS}</style></head><body>
<div class="crumb"><a href="/">myrobot.shop</a> › <a href="/#db/cat/${encodeURIComponent(r.cat||'')}">${esc(r.cat||'Robots')}</a> › ${esc(r.name)}</div>
<img class="hero" src="${attr(img)}" alt="${attr(r.name)} robot" loading="lazy">
<h1>${esc(r.name)}</h1>
<p class="sub">${esc(subbits)}</p>
${has(r.desc)?`<p class="lead">${esc(r.desc)}</p>`:''}
${priceTier(r)!=null?`<p class="price">Price level: <span class="stars">${priceStars(r)}</span></p>`:`<p class="price" style="color:#6b7280">Price on application</p>`}
<a class="cta" href="/#profile/${attr(r.id)}">View full interactive profile, comparisons &amp; videos →</a>
${aff?`<a class="aff" href="${attr(aff.url)}" target="_blank" rel="sponsored nofollow noopener">${esc(aff.label)} →</a><div class="disc">As an Amazon Associate, myrobot.shop earns from qualifying purchases.</div>`:''}
<h2>${esc(r.name)} — full specifications</h2>
<table><tbody>${rows.map(([l,v])=>`<tr><td>${esc(l)}</td><td>${esc(v)}</td></tr>`).join('')}</tbody></table>\n${pricesHtml(r)}\n${picturesHtml(r)}\n${videosHtml(r)}
${rel.length?`<h2>Similar ${esc(r.cat||'robots')}</h2><div class="rel">${rel.map(x=>`<a href="/r/${attr(x.id)}.html">${esc(x.name)}</a>`).join('')}</div>`:''}
<footer>${esc(r.name)} is one of ${ROBOTS.length.toLocaleString()} robots catalogued on <a href="/">myrobot.shop</a> — the world's largest robot database. <a href="/#methodology">How we source our data</a>.</footer>
</body></html>`;
}

/* ---- write ---- */
const rdir=path.join(OUT,'r'); fs.mkdirSync(rdir,{recursive:true});
let n=0, bytes=0;
for(const r of ROBOTS){ if(!r.id) continue; try{ const html=page(r); fs.writeFileSync(path.join(rdir,r.id+'.html'),html); n++; bytes+=html.length; }catch(e){ console.error('skip',r.id,e.message); } }


/* ---- questions / FAQ pages ---- */
let qUrls=[];
(function buildQuestions(){
  let QF;
  try{ QF=JSON.parse(fs.readFileSync(path.join(ROOT,'data','questions.json'),'utf8')); }catch(e){ return; }
  const cats=QF.categories||{};
  const slugs=Object.keys(cats);
  if(!slugs.length) return;
  const qdir=path.join(OUT,'questions'); fs.mkdirSync(qdir,{recursive:true});

  // shared answer-link button (browse the category)
  function answerLinks(cat){
    if(!cat.browse_href) return '';
    return `<div class="qlinks"><a class="cta" href="${attr(cat.browse_href)}">Browse ${esc(cat.category_name)} →</a></div>`;
  }
  // per-question reference links (e.g. official regulators) — plain authority links, open in new tab
  function qLinkList(q){
    if(!q.links||!q.links.length) return '';
    return `<div class="qsrc"><span class="qsrc-h">Official sources</span><ul>${q.links.map(l=>`<li><a href="${attr(l.url)}" target="_blank" rel="noopener">${esc(l.label)} \u2197</a></li>`).join('')}</ul></div>`;
  }

  // ----- per-category pages -----
  slugs.forEach(function(cslug){
    const cat=cats[cslug]; const qs=(cat.questions||[]).filter(q=>q.q&&q.a);
    if(!qs.length) return;
    const title=`${cat.category_name} — questions & answers | myrobot.shop`;
    const desc=(cat.intro||`Common questions about ${cat.category_name}, answered.`).replace(/\s+/g,' ').slice(0,158);
    const url=`${SITE}/questions/${cslug}.html`;
    const faq={"@context":"https://schema.org","@type":"FAQPage","mainEntity":qs.map(q=>({"@type":"Question","name":q.q,"acceptedAnswer":{"@type":"Answer","text":q.a}}))};
    const body=qs.map(q=>`<div class="qa" id="${attr(q.slug||'')}"><h2>${esc(q.q)}</h2><p>${esc(q.a)}</p>${qLinkList(q)}</div>`).join('\n');
    const html=`<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${attr(desc)}">
<link rel="canonical" href="${url}">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta property="og:type" content="website"><meta property="og:title" content="${attr(title)}">
<meta property="og:description" content="${attr(desc)}"><meta property="og:url" content="${url}">
<meta property="og:site_name" content="myrobot.shop">
<script type="application/ld+json">${JSON.stringify(faq)}</script>
<style>${CSS}.qa{margin:0 0 26px;padding:0 0 18px;border-bottom:1px solid #eef0f3}.qa h2{margin:0 0 8px;border:none;padding:0}.qa p{margin:0 0 10px}.qlinks{margin-top:8px}.qsrc{margin-top:10px;background:#f7f8fa;border:1px solid #e5e7eb;border-radius:10px;padding:12px 16px}.qsrc-h{display:block;font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#6b7280;margin-bottom:6px}.qsrc ul{margin:0;padding:0;list-style:none}.qsrc li{padding:3px 0}.qsrc a{font-size:14px;text-decoration:none}.qlist{display:flex;flex-wrap:wrap;gap:10px;margin-top:8px}.qcard{display:block;border:1px solid #e5e7eb;border-radius:12px;padding:16px 18px;text-decoration:none;color:#111827;min-width:220px;flex:1}.qcard b{display:block;font-size:16px;margin-bottom:4px}.qcard span{color:#6b7280;font-size:13px}</style></head><body>
<div class="crumb"><a href="/">myrobot.shop</a> › <a href="/questions/">Questions</a> › ${esc(cat.category_name)}</div>
<h1>${esc(cat.category_name)} — questions &amp; answers</h1>
${cat.intro?`<p class="lead">${esc(cat.intro)}</p>`:''}
${body}
${answerLinks(cat)}
<footer>Browsing ${esc(cat.category_name)}? See all <a href="/questions/">robot questions</a> or explore the <a href="/">full database of ${ROBOTS.length.toLocaleString()} robots</a>. <a href="/#methodology">How we source our data</a>.</footer>
</body></html>`;
    fs.writeFileSync(path.join(qdir,cslug+'.html'),html);
    qUrls.push(`<url><loc>${url}</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>`);
  });

  // ----- hub page -----
  const hubTitle='Robot Questions & Answers | myrobot.shop';
  const hubDesc='Straight answers to the most-asked questions about robots — vacuums, drones, lawn mowers, humanoids and more.';
  const cards=slugs.map(function(cslug){
    const cat=cats[cslug]; const cnt=(cat.questions||[]).filter(q=>q.q&&q.a).length;
    if(!cnt) return '';
    return `<a class="qcard" href="/questions/${cslug}.html"><b>${esc(cat.category_name)}</b><span>${cnt} question${cnt>1?'s':''} answered →</span></a>`;
  }).join('');
  const hub=`<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${hubTitle}</title>
<meta name="description" content="${hubDesc}">
<link rel="canonical" href="${SITE}/questions/">
<meta name="robots" content="index,follow">
<meta property="og:type" content="website"><meta property="og:title" content="${hubTitle}">
<meta property="og:description" content="${hubDesc}"><meta property="og:url" content="${SITE}/questions/">
<meta property="og:site_name" content="myrobot.shop">
<style>${CSS}.qlist{display:flex;flex-wrap:wrap;gap:12px;margin-top:14px}.qcard{display:block;border:1px solid #e5e7eb;border-radius:12px;padding:16px 18px;text-decoration:none;color:#111827;min-width:220px;flex:1}.qcard b{display:block;font-size:16px;margin-bottom:4px}.qcard span{color:#6b7280;font-size:13px}</style></head><body>
<div class="crumb"><a href="/">myrobot.shop</a> › Questions</div>
<h1>Robot questions &amp; answers</h1>
<p class="lead">Honest, no-hype answers to the questions people ask most before buying or learning about robots — pick a category to dive in.</p>
<div class="qlist">${cards}</div>
<footer>Can't find your question? Explore the <a href="/">full database of ${ROBOTS.length.toLocaleString()} robots</a> or <a href="/#methodology">see how we source our data</a>.</footer>
</body></html>`;
  fs.writeFileSync(path.join(qdir,'index.html'),hub);
  qUrls.push(`<url><loc>${SITE}/questions/</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>`);
  console.log(`Generated ${slugs.length} question pages + hub (${qUrls.length} URLs)`);
})();

/* ---- sitemap ---- */
const today=new Date().toISOString().slice(0,10);
const urls=[`<url><loc>${SITE}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`]
  .concat(ROBOTS.filter(r=>r.id).map(r=>`<url><loc>${SITE}/r/${r.id}.html</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>`))
  .concat(qUrls);
fs.writeFileSync(path.join(OUT,'sitemap.xml'),`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);

console.log(`Generated ${n} pages (${(bytes/1048576).toFixed(1)} MB total, avg ${Math.round(bytes/n)} bytes) + sitemap with ${urls.length} URLs`);
