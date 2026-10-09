// Serves the admin app only to signed-in, approved Google accounts; otherwise serves the sign-in page.
const fs = require('fs'), path = require('path');
const { readSession } = require('./lib/session');
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function loginPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>myrobot.shop — Admin sign-in</title>
<script src="https://accounts.google.com/gsi/client" async defer></script>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0d12;color:#e8eaf0;font-family:system-ui,sans-serif}
.box{background:#12151d;border:1px solid #232838;border-radius:14px;padding:36px 32px;width:320px;text-align:center}
h1{font-size:18px;margin:0 0 6px}p{color:#8b93a7;font-size:13px;margin:0 0 22px}#err{color:#f87171;font-size:13px;margin-top:14px;min-height:18px}</style></head>
<body><div class="box"><h1>myrobot.shop Admin</h1><p>Sign in with your approved Google account.</p>
<div id="g" style="display:flex;justify-content:center"></div><div id="err"></div></div>
<script>
window.onload=function(){
  var t=setInterval(function(){ if(!window.google||!google.accounts) return; clearInterval(t);
    google.accounts.id.initialize({client_id:${JSON.stringify(process.env.GOOGLE_CLIENT_ID || '')},callback:function(r){
      fetch('/api/auth-google',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({credential:r.credential})})
      .then(function(x){return x.json().then(function(d){return [x.ok,d]})})
      .then(function(a){ if(a[0]) location.reload(); else document.getElementById('err').textContent=a[1].error||'Sign-in failed'; })
      .catch(function(){document.getElementById('err').textContent='Network error'});
    }});
    google.accounts.id.renderButton(document.getElementById('g'),{theme:'filled_black',size:'large'});
  },100);
};
</script></body></html>`;
}

exports.handler = async (event) => {
  const base = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Content-Type': 'text/html; charset=utf-8' };
  const s = readSession(event);
  if (!s) return { statusCode: 200, headers: base, body: loginPage() };
  let html;
  try { html = fs.readFileSync(path.join(__dirname, '..', '..', 'admin-app.html'), 'utf8'); }
  catch (e) { try { html = fs.readFileSync(path.join(process.cwd(), 'admin-app.html'), 'utf8'); } catch (e2) { return { statusCode: 500, headers: base, body: 'admin-app.html missing' }; } }
  return { statusCode: 200, headers: base, body: html };
};
