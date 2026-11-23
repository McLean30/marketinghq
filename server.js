// Nexai HQ server: static files, Quill caption API and the private shared workspace.
// Binds to localhost by default. Set HOST=0.0.0.0 to open it from your phone on your own Wi-Fi.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const quill = require('./server/quill');
const auth = require('./server/auth');
const wsStore = require('./server/workspace');
const storage = require('./server/storage');
const scheduler = require('./server/scheduler');
const ai = require('./server/openai');
const { mockPng } = require('./server/mock-image');

const ROOT = path.join(storage.APP_DIR, 'public');
const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || '127.0.0.1';
const MAX_JSON = 4 * 1024 * 1024;
let schedulerEvery = null;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
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

/* ---------- Paid AI: who may spend, once per explicit action, and what it cost ---------- */
/** null if this request may run the configured AI provider; otherwise why not. */
function paidGate(signedIn) {
  const p = quill.providerInfo().provider;
  if (p === 'demo') return { status: 503, code: 'not_configured', error: 'Live AI isn’t set up on this server (no OPENAI_API_KEY). HQ uses its local demo templates.' };
  if (p === 'openai' && !auth.configured()) return { status: 403, code: 'owner_signin_required', error: 'Live AI is switched off here: this server has no owner sign-in, so paid generation couldn’t be protected. Run HQ with HQ_OWNER_PASSWORD_HASH set and sign in, or use demo mode.' };
  if (auth.configured() && !signedIn) return { status: 401, code: 'signed_out', error: 'Sign in to the shared workspace to use live AI.' };
  return null;
}
/**
 * Run one paid operation: owner gate, one call per requestKey (double taps, refreshes and retries get the first
 * result), usage recorded per job. Live calls need a requestKey; the mock accepts calls without one (older tests).
 */
async function paid(req, res, signedIn, kind, fn, describe) {
  const gate = paidGate(signedIn);
  if (gate) return sendJson(res, gate.status, { error: gate.error, code: gate.code, retryable: false });
  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendJson(res, e.status || 400, { error: e.message }); }
  const live = quill.providerInfo().provider === 'openai';
  const started = Date.now();
  try {
    const run = async () => {
      const out = await fn(body);
      if (out.usage) ai.record({ jobId: typeof body.jobId === 'string' ? body.jobId.slice(0, 60) : null, requestKey: body.requestKey || null, kind: kind === 'caption' ? (body.kind === 'revision' ? 'caption-revision' : 'caption') : kind === 'image' ? `image-${body.op}` : kind, ...out.usage });
      return out;
    };
    const out = live || body.requestKey ? await ai.once(body.requestKey, run) : await run();
    console.log(`[ai] ${describe(body)} via ${out.provider || 'mock'} (${out.model || '-'}) in ${Date.now() - started}ms${out.duplicate ? ' (repeat of an earlier request: no new charge)' : ''}`);
    return sendJson(res, 200, out);
  } catch (e) {
    const status = e.status || 500;
    if (e.usage) ai.record({ jobId: typeof body.jobId === 'string' ? body.jobId.slice(0, 60) : null, requestKey: typeof body.requestKey === 'string' ? body.requestKey.slice(0, 160) : null, kind: `${kind}-failed`, ...e.usage });
    console.warn(`[ai] ${kind} failed: ${e.code || 'error'} (${status})`);
    return sendJson(res, status, { error: e.message || 'Generation failed.', code: e.code || 'error', retryable: e.retryable !== false, usage: e.usage || null });
  }
}
/** Prism: generate a new image or edit the current one, stored as a photo asset for the local Photo layout. */
async function prismImage(body) {
  if (!['generate', 'edit'].includes(body.op)) throw Object.assign(new Error('Unknown image operation.'), { status: 400, retryable: false });
  if (typeof body.prompt !== 'string' || body.prompt.trim().length < 5 || body.prompt.length > 4000) throw Object.assign(new Error('Describe the image (at least a few words).'), { status: 400, retryable: false });
  if (!auth.configured()) throw Object.assign(new Error('Image generation needs the shared workspace (owner sign-in) to store the image.'), { status: 503, retryable: false });
  let base = null;
  if (body.op === 'edit') {
    const a = wsStore.readAssetBuffer(String(body.baseAssetId || ''));
    if (!a) throw Object.assign(new Error('The image to edit isn’t in the shared workspace.'), { status: 404, retryable: false });
    base = { mime: a.meta.type, buffer: a.buffer };
  }
  const prompt = `${body.prompt.trim()}\n\nA realistic photograph for a UK commercial maintenance and building services company's ${body.platform || 'social'} post. Natural light, believable UK setting and PPE. No text, captions, logos or watermarks in the image: the headline and the official logo are added afterwards.`;
  let out;
  if (quill.providerInfo().provider === 'mock') {
    await new Promise((r) => setTimeout(r, Number(process.env.QUILL_MOCK_DELAY_MS || 300)));
    out = { buffer: mockPng(`${body.op}:${body.prompt}:${body.baseAssetId || ''}`), mime: 'image/png', usage: null, model: 'mock-image', size: '512x768' };
  } else {
    try { out = await ai.image({ prompt, base }); } catch (e) { throw e instanceof ai.AiError ? Object.assign(e, { status: e.status }) : e; }
  }
  const id = `photo_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
  const name = `${body.op === 'edit' ? 'edited' : 'generated'}-${id.slice(6)}.${out.mime === 'image/png' ? 'png' : 'jpg'}`;
  wsStore.saveAsset(id, { kind: 'photo', name, type: out.mime }, out.buffer);
  return { assetId: id, name, mime: out.mime, size: out.size, op: body.op, provider: quill.providerInfo().provider, model: out.model, usage: out.usage };
}

async function handleApi(req, res, urlPath) {
  const method = req.method;
  if (method !== 'GET' && !sameOrigin(req)) return sendJson(res, 403, { error: 'Cross-origin requests are not allowed.' });
  const signedIn = !!auth.session(req);

  /* --- Sign-in --- */
  // HQ_TEST_DATE (YYYY-MM-DD) fixes "today" for offer and review checks in test workspaces.
  if (urlPath === '/api/auth/status' && method === 'GET') return sendJson(res, 200, { authConfigured: auth.configured(), signedIn, testDate: /^\d{4}-\d{2}-\d{2}$/.test(process.env.HQ_TEST_DATE || '') ? process.env.HQ_TEST_DATE : null, scheduler: auth.configured() ? { runsOn: 'server', everyMs: schedulerEvery, now: scheduler.now(), testClock: scheduler.testClock() } : { runsOn: 'browser' } });
  if (urlPath === '/api/auth/login' && method === 'POST') {
    const body = await readJsonBody(req);
    const r = auth.login(req, body.password, deviceOf(req));
    if (r.status !== 200) return sendJson(res, r.status, { error: r.error });
    console.log(`[auth] owner signed in from a ${deviceOf(req)}`);
    return sendJson(res, 200, { signedIn: true }, { 'Set-Cookie': r.cookie });
  }
  if (urlPath === '/api/auth/logout' && method === 'POST') return sendJson(res, 200, { signedIn: false }, { 'Set-Cookie': auth.logout(req) });

  /* --- Live AI (OpenAI). Spending needs a signed-in owner; a server key alone never opens it to visitors. --- */
  if (urlPath === '/api/quill/status' && method === 'GET') {
    const info = quill.providerInfo();
    const gate = paidGate(signedIn);
    if (gate && info.provider !== 'demo') return sendJson(res, 200, { provider: 'demo', model: null, imageModel: null, label: gate.code === 'signed_out' ? 'Local demo templates (sign in for live AI)' : 'Local demo templates (live AI needs owner sign-in on this server)', signInRequired: gate.code === 'signed_out', liveBlocked: gate.code });
    return sendJson(res, 200, { ...info, prices: info.provider === 'openai' ? { source: ai.PRICE_SOURCE } : null });
  }
  if (urlPath === '/api/quill/caption' && method === 'POST') return paid(req, res, signedIn, 'caption', (b) => quill.generate(b), (b) => `${b.kind} for ${b.platform}`);
  if (urlPath === '/api/video/script' && method === 'POST') return paid(req, res, signedIn, 'script', (b) => quill.videoScript(b), (b) => `script for ${b.platform}`);
  if (urlPath === '/api/review/wording' && method === 'POST') return paid(req, res, signedIn, 'wording', (b) => quill.wordingReview(b), () => 'wording review');
  if (urlPath === '/api/analyst/interpret' && method === 'POST') return paid(req, res, signedIn, 'interpret', (b) => quill.interpret(b), (b) => `interpretation of ${(b.rows || []).length} posts`);
  if (urlPath === '/api/prism/image' && method === 'POST') return paid(req, res, signedIn, 'image', (b) => prismImage(b), (b) => `image ${b.op}`);
  if (urlPath === '/api/ai/usage' && method === 'GET') {
    if (!auth.configured() || !signedIn) return sendJson(res, 401, { error: 'Sign in to see AI usage.', code: 'signed_out' });
    const jobId = new URL(req.url, 'http://x').searchParams.get('jobId');
    return sendJson(res, 200, { entries: ai.ledger(jobId), priceSource: ai.PRICE_SOURCE });
  }
  if (urlPath === '/api/quill/mock-calls' && method === 'GET' && quill.providerInfo().provider === 'mock') return sendJson(res, 200, require('./server/quill-mock').calls);
  if (urlPath === '/api/vektor/mock-plan-calls' && method === 'GET' && quill.providerInfo().provider === 'mock') return sendJson(res, 200, require('./server/quill-mock').planCalls);
  if (urlPath === '/api/vektor/plan' && method === 'POST') return paid(req, res, signedIn, 'plan', (b) => quill.planWeek(b), (b) => `week plan from ${b.weekStart}`);

  // Which commit this deployment runs (Vercel sets VERCEL_GIT_COMMIT_SHA). Lets the smoke test refuse an older deployment.
  if (urlPath === '/api/version' && method === 'GET') return sendJson(res, 200, { commit: process.env.VERCEL_GIT_COMMIT_SHA || null, environment: process.env.VERCEL_ENV || null });

  /* --- Shared workspace, images and the demo scheduler: owner only --- */
  if (urlPath.startsWith('/api/workspace') || urlPath.startsWith('/api/assets') || urlPath.startsWith('/api/publish') || urlPath.startsWith('/api/test/')) {
    if (!auth.configured()) return sendJson(res, 503, { error: 'The shared workspace isn’t set up on this server.' });
    if (!signedIn) return sendJson(res, 401, { error: 'Sign in to the shared workspace.', code: 'signed_out' });
  }
  /* --- Demo publishing (simulated accounts; the server runs due posts on its own timer too) --- */
  if (urlPath === '/api/publish/run' && method === 'POST') {
    const body = await readJsonBody(req);
    const changed = await scheduler.runDue({ jobId: typeof body.jobId === 'string' ? body.jobId : null, force: !!body.jobId });
    return sendJson(res, 200, { changed, now: scheduler.now() });
  }
  if (urlPath === '/api/publish/receipts' && method === 'GET') return sendJson(res, 200, { posts: scheduler.posts().map((p) => p.receipt), now: scheduler.now() });
  if (urlPath === '/api/test/clock' && method === 'POST') {
    const body = await readJsonBody(req);
    const t = scheduler.advance(body.advanceMs);
    // Time passing runs the scheduler, as its own timer would. run:false leaves it to the timer (to prove unattended runs).
    const changed = body.run === false ? [] : await scheduler.runDue();
    return sendJson(res, 200, { now: t, changed });
  }
  if (urlPath === '/api/test/publisher-fault' && method === 'POST') {
    const body = await readJsonBody(req);
    return sendJson(res, 200, { fault: scheduler.setFault(body.mode) });
  }
  if (urlPath === '/api/workspace' && method === 'GET') return sendJson(res, 200, wsStore.snapshot());
  if (urlPath === '/api/workspace/rev' && method === 'GET') return sendJson(res, 200, { rev: wsStore.snapshot().rev, now: scheduler.now() });
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
    const buf = await readBody(req, (/^(clip|video)_/.test(m[1]) ? wsStore.MAX_VIDEO : wsStore.MAX_ASSET) + 1024);
    let name = '';
    try { name = decodeURIComponent(req.headers['x-asset-name'] || ''); } catch { /* keep empty */ }
    const out = wsStore.saveAsset(m[1], { kind: req.headers['x-asset-kind'], name, type: (req.headers['content-type'] || '').split(';')[0] }, buf);
    return sendJson(res, 200, out);
  }
  if (m && method === 'GET') {
    const a = wsStore.readAsset(m[1]);
    if (!a) return sendJson(res, 404, { error: 'Image not found.' });
    // Byte ranges let phones (Safari in particular) stream and seek videos.
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range && (range[1] || range[2])) {
      const size = a.meta.size;
      let start = range[1] ? Number(range[1]) : size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : size - 1;
      start = Math.max(0, start); end = Math.min(size - 1, end);
      if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${size}`, ...SECURITY_HEADERS }); res.end(); return undefined; }
      res.writeHead(206, { 'Content-Type': a.meta.type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', ...SECURITY_HEADERS });
      a.stream({ start, end }).pipe(res);
      return undefined;
    }
    res.writeHead(200, { 'Content-Type': a.meta.type, 'Content-Length': a.meta.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', ...SECURITY_HEADERS });
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
    if (auth.configured()) {
      schedulerEvery = scheduler.start();
      console.log(schedulerEvery ? `Demo scheduler: on, every ${schedulerEvery / 1000} s while this server runs (simulated accounts only).` : 'Demo scheduler: timer off (HQ_SCHEDULER_MS=0); due posts run when HQ asks.');
    }
    if (auth.configured() && HOST !== '127.0.0.1' && HOST !== 'localhost') console.log('Warning: plain HTTP on your network. Use only on a Wi-Fi network you trust.');
  });
