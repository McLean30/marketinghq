// Nexai HQ server: static files, Quill caption API and the private shared workspace.
// Binds to localhost by default. Set HOST=0.0.0.0 to open it from your phone on your own Wi-Fi.
const http = require('http');
const fs = require('fs');
const path = require('path');
const quill = require('./server/quill');
const auth = require('./server/auth');
const wsStore = require('./server/workspace');
const storage = require('./server/storage');

const ROOT = path.join(storage.APP_DIR, 'public');
const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || '127.0.0.1';
const MAX_JSON = 4 * 1024 * 1024;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};
const SECURITY_HEADERS = { 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' };

function sendJson(res, status, obj, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...headers });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new wsStore.WsError(413, 'Request too large.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJsonBody(req) {
  const buf = await readBody(req, MAX_JSON);
  try { return JSON.parse(buf.toString('utf8') || '{}'); } catch { throw new wsStore.WsError(400, 'Request body must be JSON.'); }
}

const sameOrigin = (req) => !req.headers.origin || req.headers.origin === `http://${req.headers.host}`;
const deviceOf = (req) => (/^(phone|computer)$/.test(req.headers['x-hq-device'] || '') ? req.headers['x-hq-device'] : 'device');

async function handleApi(req, res, urlPath) {
  const method = req.method;
  if (method !== 'GET' && !sameOrigin(req)) return sendJson(res, 403, { error: 'Cross-origin requests are not allowed.' });
  const signedIn = !!auth.session(req);

  /* --- Sign-in --- */
  // HQ_TEST_DATE (YYYY-MM-DD) fixes "today" for offer and review checks in test workspaces.
  if (urlPath === '/api/auth/status' && method === 'GET') return sendJson(res, 200, { authConfigured: auth.configured(), signedIn, testDate: /^\d{4}-\d{2}-\d{2}$/.test(process.env.HQ_TEST_DATE || '') ? process.env.HQ_TEST_DATE : null });
  if (urlPath === '/api/auth/login' && method === 'POST') {
    const body = await readJsonBody(req);
    const r = auth.login(req, body.password, deviceOf(req));
    if (r.status !== 200) return sendJson(res, r.status, { error: r.error });
    console.log(`[auth] owner signed in from a ${deviceOf(req)}`);
    return sendJson(res, 200, { signedIn: true }, { 'Set-Cookie': r.cookie });
  }
  if (urlPath === '/api/auth/logout' && method === 'POST') return sendJson(res, 200, { signedIn: false }, { 'Set-Cookie': auth.logout(req) });

  /* --- Quill (paid AI requests need the owner signed in once sign-in is configured) --- */
  if (urlPath === '/api/quill/status' && method === 'GET') {
    const info = quill.providerInfo();
    const locked = auth.configured() && !signedIn && info.provider !== 'demo';
    return sendJson(res, 200, locked ? { provider: 'demo', model: null, label: 'Local demo templates (sign in for live AI)', signInRequired: true } : info);
  }
  if (urlPath === '/api/quill/caption' && method === 'POST') {
    if (auth.configured() && !signedIn) return sendJson(res, 401, { error: 'Sign in to the shared workspace to use AI captions.', retryable: false, code: 'signed_out' });
    try {
      const body = await readJsonBody(req);
      const started = Date.now();
      const out = await quill.generate(body);
      console.log(`[quill] ${body.kind} for ${body.platform} via ${out.provider} (${out.model}) in ${Date.now() - started}ms`);
      return sendJson(res, 200, out);
    } catch (e) {
      const status = e.status || 500;
      console.warn(`[quill] request failed: ${e.code || 'error'} (${status})`);
      return sendJson(res, status, { error: e.message || 'Caption generation failed.', code: e.code || 'error', retryable: e.retryable !== false });
    }
  }
  if (urlPath === '/api/quill/mock-calls' && method === 'GET' && quill.providerInfo().provider === 'mock') return sendJson(res, 200, require('./server/quill-mock').calls);
  if (urlPath === '/api/vektor/mock-plan-calls' && method === 'GET' && quill.providerInfo().provider === 'mock') return sendJson(res, 200, require('./server/quill-mock').planCalls);
  if (urlPath === '/api/vektor/plan' && method === 'POST') {
    // One explicit, paid planning request. Same provider and sign-in rule as Quill captions.
    if (auth.configured() && !signedIn) return sendJson(res, 401, { error: 'Sign in to the shared workspace to plan with AI.', retryable: false, code: 'signed_out' });
    try {
      const body = await readJsonBody(req);
      const out = await quill.planWeek(body);
      console.log(`[vektor] planned ${out.days.length} posts via ${out.provider} (${out.model})`);
      return sendJson(res, 200, out);
    } catch (e) {
      console.warn(`[vektor] plan failed: ${e.code || 'error'} (${e.status || 500})`);
      return sendJson(res, e.status || 500, { error: e.message || 'Planning failed.', retryable: e.retryable !== false });
    }
  }

  /* --- Shared workspace + images: owner only --- */
  if (urlPath.startsWith('/api/workspace') || urlPath.startsWith('/api/assets')) {
    if (!auth.configured()) return sendJson(res, 503, { error: 'The shared workspace isn’t set up on this server.' });
    if (!signedIn) return sendJson(res, 401, { error: 'Sign in to the shared workspace.', code: 'signed_out' });
  }
  if (urlPath === '/api/workspace' && method === 'GET') return sendJson(res, 200, wsStore.snapshot());
  if (urlPath === '/api/workspace/rev' && method === 'GET') return sendJson(res, 200, { rev: wsStore.snapshot().rev });
  let m = /^\/api\/workspace\/jobs\/([a-z0-9_]+)$/.exec(urlPath);
  if (m && method === 'GET') {
    const job = wsStore.getJob(m[1]);
    return job ? sendJson(res, 200, job) : sendJson(res, 404, { error: 'Job not found.' });
  }
  if (m && method === 'PUT') {
    const body = await readJsonBody(req);
    const out = wsStore.putJob(m[1], body.baseRev, body.bundle, deviceOf(req));
    return sendJson(res, 200, out);
  }
  m = /^\/api\/workspace\/plans\/([a-z0-9_]+)$/.exec(urlPath);
  if (m && method === 'PUT') {
    const body = await readJsonBody(req);
    return sendJson(res, 200, wsStore.putPlan(m[1], body.baseRev, body.plan, deviceOf(req)));
  }
  if (urlPath === '/api/workspace/profile' && method === 'PUT') {
    const body = await readJsonBody(req);
    return sendJson(res, 200, wsStore.putProfile(body.baseRev, body.data, deviceOf(req)));
  }
  if (urlPath === '/api/workspace/brand' && method === 'PUT') {
    const body = await readJsonBody(req);
    return sendJson(res, 200, wsStore.putBrand(body.baseRev, body.data, deviceOf(req)));
  }
  if (urlPath === '/api/workspace/import' && method === 'POST') {
    const body = await readJsonBody(req);
    const out = wsStore.importBundles(body.bundles, body.brand, deviceOf(req), !!body.dryRun);
    if (!body.dryRun) console.log(`[workspace] import: ${out.imported.length} imported, ${out.skipped.length} already present`);
    return sendJson(res, 200, out);
  }
  if (urlPath === '/api/assets/check' && method === 'POST') {
    const body = await readJsonBody(req);
    const ids = Array.isArray(body.ids) ? body.ids.slice(0, 2000) : [];
    return sendJson(res, 200, { present: ids.filter((id) => wsStore.hasAsset(id)) });
  }
  m = /^\/api\/assets\/([a-z0-9_]+)$/.exec(urlPath);
  if (m && method === 'POST') {
    const buf = await readBody(req, wsStore.MAX_ASSET + 1024);
    let name = '';
    try { name = decodeURIComponent(req.headers['x-asset-name'] || ''); } catch { /* keep empty */ }
    const out = wsStore.saveAsset(m[1], { kind: req.headers['x-asset-kind'], name, type: (req.headers['content-type'] || '').split(';')[0] }, buf);
    return sendJson(res, 200, out);
  }
  if (m && method === 'GET') {
    const a = wsStore.readAsset(m[1]);
    if (!a) return sendJson(res, 404, { error: 'Image not found.' });
    res.writeHead(200, { 'Content-Type': a.meta.type, 'Content-Length': a.meta.size, 'Cache-Control': 'private, no-store', ...SECURITY_HEADERS });
    a.stream().pipe(res);
    return undefined;
  }
  return sendJson(res, 404, { error: 'Not found' });
}

http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath.startsWith('/api/')) {
      handleApi(req, res, urlPath).catch((e) => {
        const status = e.status || 500;
        if (status >= 500) console.error('[api] error:', e.message);
        sendJson(res, status, { error: e.message || 'Server error', ...(e.current !== undefined ? { current: e.current } : {}) });
      });
      return;
    }
    let file = path.normalize(path.join(ROOT, urlPath));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (urlPath.endsWith('/')) file = path.join(file, 'index.html');
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404).end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
      res.end(data);
    });
  })
  .listen(PORT, HOST, () => {
    const info = quill.providerInfo();
    console.log(`Nexai AI Marketing HQ running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    console.log(`Quill caption provider: ${info.label}${info.model ? ` (${info.model}${info.effort ? `, effort ${info.effort}` : ''})` : ''}`);
    console.log(auth.configured() ? `Shared workspace: on (owner sign-in required). Data folder: ${storage.dataDir()}` : 'Shared workspace: off (run npm run set-password to turn it on). Local demo mode only.');
    if (auth.configured() && HOST !== '127.0.0.1' && HOST !== 'localhost') console.log('Warning: plain HTTP on your network. Use only on a Wi-Fi network you trust.');
  });
