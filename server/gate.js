// The private workspace's front door (Milestone 14). When owner sign-in is set up, nothing of HQ is served to a
// signed-out visitor: no app page, scripts, styles, data, images, media or exports. Every page request gets this
// self-contained sign-in screen instead, at the address that was asked for. HQ's routes live in the address's
// #fragment, which browsers never send to a server, so after signing in the page simply reloads and opens exactly
// what was asked for (a job, an agent's workspace, the calendar...).
//
// Public while signed out: this screen, the official logo it shows, and the sign-in API. Nothing else.

const PUBLIC_FILES = new Set(['/assets/brand/nexai-logo.png', '/favicon.ico', '/robots.txt']);
const PUBLIC_API = new Set(['/api/auth/status', '/api/auth/login', '/api/auth/logout', '/api/version']);

/** Whether a signed-out visitor may have this path. */
const isPublic = (urlPath) => PUBLIC_FILES.has(urlPath) || PUBLIC_API.has(urlPath);

/** A request for a page (as opposed to a script, style, image or data file). */
function wantsPage(req, urlPath) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (urlPath === '/' || urlPath.endsWith('/') || urlPath.endsWith('.html')) return true;
  if (/\.[a-z0-9]{1,5}$/i.test(urlPath)) return false;
  return /text\/html/.test(req.headers.accept || '');
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STYLE = `
  :root { color-scheme: dark; --bg:#050912; --panel:#0b1426; --line:#1d3557; --ink:#e8f1ff; --muted:#9db0cc; --accent:#3fa9ff; --bad:#ff8a8a; }
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; background: radial-gradient(1200px 600px at 50% -10%, #0a1f4d 0%, var(--bg) 60%); color: var(--ink);
    font: 16px/1.5 Barlow, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { min-height: 100vh; min-height: 100dvh; display: grid; place-items: center; padding: 24px 16px; }
  .card { width: 100%; max-width: 400px; background: var(--panel); border: 1px solid var(--line); border-radius: 18px; padding: 28px 24px; box-shadow: 0 20px 60px #0008; }
  .logo { display: block; width: 180px; max-width: 70%; height: auto; margin: 0 auto 18px; }
  h1 { font-size: 1.35rem; margin: 0 0 6px; text-align: center; letter-spacing: .01em; }
  p { margin: 0 0 16px; color: var(--muted); text-align: center; }
  label { display: block; font-weight: 600; margin: 0 0 6px; }
  input { width: 100%; font: inherit; color: var(--ink); background: #050b18; border: 1px solid var(--line); border-radius: 12px; padding: 14px; min-height: 48px; }
  input:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  button { width: 100%; margin-top: 14px; min-height: 48px; font: inherit; font-weight: 600; color: #04101f; background: linear-gradient(90deg, #2fe0ff, #3fa9ff); border: 0; border-radius: 999px; cursor: pointer; }
  button[disabled] { opacity: .6; cursor: progress; }
  .msg { min-height: 1.5em; margin: 12px 0 0; color: var(--bad); text-align: left; }
  .fine { font-size: .85rem; margin: 18px 0 0; }`;

const page = (title, body, script = '') => `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow"><meta name="theme-color" content="#050912"><title>${esc(title)}</title>
<style>${STYLE}</style></head>
<body><main>${body}</main>${script ? `<script>${script}</script>` : ''}</body></html>`;

/** The owner sign-in screen. After signing in it reloads the same address (fragment included). */
function signInPage() {
  return page('Sign in · Nexai Marketing HQ', `
  <form class="card" id="signin-form" data-testid="gate-signin" novalidate>
    <img class="logo" src="/assets/brand/nexai-logo.png" alt="Nexai Digital" width="360" height="200">
    <h1>Nexai Marketing HQ</h1>
    <p>Private workspace. Sign in to continue.</p>
    <label for="ws-password">Owner password</label>
    <input id="ws-password" name="password" type="password" autocomplete="current-password" required autofocus>
    <button type="submit" id="gate-submit">Sign in</button>
    <p class="msg" id="gate-msg" role="alert" aria-live="assertive"></p>
    <p class="fine" id="gate-next"></p>
  </form>`, `
  (function () {
    var f = document.getElementById('signin-form'), pw = document.getElementById('ws-password'), btn = document.getElementById('gate-submit'), msg = document.getElementById('gate-msg');
    var h = location.hash.replace(/^#\\/?/, '');
    if (h) document.getElementById('gate-next').textContent = 'You’ll go straight back to the page you opened.';
    var phone = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 700;
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!pw.value) { msg.textContent = 'Enter the owner password.'; pw.focus(); return; }
      btn.disabled = true; btn.textContent = 'Signing in…'; msg.textContent = '';
      fetch('/api/auth/login', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-HQ-Device': phone ? 'phone' : 'computer' }, body: JSON.stringify({ password: pw.value }) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (x) {
          if (x.ok) { location.reload(); return; }
          msg.textContent = x.d.error || 'Sign-in failed.';
          btn.disabled = false; btn.textContent = 'Sign in'; pw.select();
        })
        .catch(function () { msg.textContent = 'Can’t reach HQ. Check your connection and try again.'; btn.disabled = false; btn.textContent = 'Sign in'; });
    });
  })();`);
}

/** Shown instead of HQ when the workspace store can't be reached. Nothing falls back to demo data. */
function unavailablePage() {
  return page('Workspace unavailable · Nexai Marketing HQ', `
  <div class="card" data-testid="gate-unavailable" role="alert">
    <img class="logo" src="/assets/brand/nexai-logo.png" alt="Nexai Digital" width="360" height="200">
    <h1>Can’t reach your workspace</h1>
    <p>HQ couldn’t connect to the workspace database (Supabase), so nothing has been loaded. Your saved work is safe. Nothing switches to demo data.</p>
    <button type="button" onclick="location.reload()">Try again</button>
  </div>`);
}

module.exports = { isPublic, wantsPage, signInPage, unavailablePage, PUBLIC_FILES };
