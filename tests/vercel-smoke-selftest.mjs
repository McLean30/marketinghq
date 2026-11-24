// Checks that tests/vercel-smoke.mjs reaches the right verdict, offline, against local stand-ins:
// the working app (pass), the crashed Milestone 7 function (fail), a Vercel sign-in page (blocked),
// a blank app and an app with an uncaught startup error (fail). Local results never count as a Vercel pass;
// this only proves the smoke test's judgement.
import { fileURLToPath } from 'url';
import { spawn, execFileSync } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`  ok  ${m}`); };

function run(url, extra = {}) {
  const r = spawn(process.execPath, [path.join(ROOT, 'tests', 'vercel-smoke.mjs')], { env: { ...process.env, PREVIEW_URL: url, VERCEL_AUTOMATION_BYPASS_SECRET: '', ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  r.stdout.on('data', (d) => (out += d));
  r.stderr.on('data', (d) => (out += d));
  return new Promise((res) => r.on('exit', (code) => res({ code, out })));
}
function stub(port, handler) {
  const s = http.createServer(handler);
  return new Promise((res) => s.listen(port, '127.0.0.1', () => res(s)));
}

// The real app under preview conditions (no settings, read-only filesystem).
const app = spawn(process.execPath, ['-r', path.join(ROOT, 'tests', 'helpers', 'readonly-fs.cjs'), path.join(ROOT, 'server.js')], { env: { PATH: process.env.PATH, PORT: '4197' }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((res) => app.stdout.on('data', (d) => /running at/.test(d) && res()));
const indexHtml = fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8');
const stubs = [
  await stub(4198, (req, res) => { res.writeHead(500, { 'content-type': 'text/plain' }); res.end('A server error has occurred\n\nFUNCTION_INVOCATION_FAILED\n'); }), // crashed function
  await stub(4199, (req, res) => { res.writeHead(401, { 'content-type': 'text/html' }); res.end('<title>Login – Vercel</title><h1>Vercel Authentication</h1><p>Log in to Vercel to continue.</p>'); }), // protection
  await stub(4201, (req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>Nexai Marketing HQ</title><main id="main"></main>'); }), // blank app
  // Vercel's 404 for "/": static files exist, but the function can't find app/index.html.
  await stub(4203, (req, res) => {
    const file = path.join(ROOT, 'app', req.url === '/' ? '__none__' : req.url.split('?')[0]);
    if (req.url !== '/' && fs.existsSync(file) && fs.statSync(file).isFile()) { res.writeHead(200); res.end(fs.readFileSync(file)); return; }
    res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found');
  }),
  // A catch-all that answers every path (including /api/*) with the homepage.
  await stub(4204, (req, res) => {
    const p = req.url.split('?')[0];
    const file = path.join(ROOT, 'app', p === '/' ? 'index.html' : p);
    const types = { '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json', '.html': 'text/html' };
    if (fs.existsSync(file) && fs.statSync(file).isFile()) { res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }); res.end(fs.readFileSync(file)); return; }
    if (p.startsWith('/api/auth/status')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"authConfigured":false,"signedIn":false}'); return; }
    if (p.startsWith('/api/quill/status')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"provider":"demo"}'); return; }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(indexHtml);
  }),
  // The profile seed missing from the deployment (the .gitignore bug).
  await stub(4205, (req, res) => {
    const p = req.url.split('?')[0];
    if (p.startsWith('/data/')) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); return; }
    fetch(`http://127.0.0.1:4197${req.url}`).then(async (r) => { res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || '' }); res.end(Buffer.from(await r.arrayBuffer())); });
  }),
  // An older deployment answering for the commit under test (reports a different commit).
  await stub(4207, (req, res) => {
    if (req.url.startsWith('/api/version')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"commit":"0000000000000000000000000000000000000000"}'); return; }
    fetch(`http://127.0.0.1:4197${req.url}`).then(async (r) => { res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || '' }); res.end(Buffer.from(await r.arrayBuffer())); });
  }),
  // A build where approving a post shows no publishing controls.
  await stub(4208, (req, res) => {
    fetch(`http://127.0.0.1:4197${req.url}`).then(async (r) => {
      let body = Buffer.from(await r.arrayBuffer());
      if (req.url.startsWith('/css/app.css')) body = Buffer.concat([body, Buffer.from('\n[data-testid="publish-panel"]{display:none!important}')]);
      res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || '' }); res.end(body);
    });
  }),
  // A build that reports live OpenAI to an anonymous visitor (paid generation exposed).
  await stub(4209, (req, res) => {
    if (req.url.startsWith('/api/quill/status')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"provider":"openai","model":"gpt-6-luna"}'); return; }
    fetch(`http://127.0.0.1:4197${req.url}`).then(async (r) => { res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || '' }); res.end(Buffer.from(await r.arrayBuffer())); });
  }),
  await stub(4220, (req, res) => { // a private workspace that leaks the app's script before sign-in
    const src = req.url.startsWith('/js/app.js') ? 4197 : 4219;
    fetch(`http://127.0.0.1:${src}${req.url}`, { headers: { accept: req.headers.accept || '*/*' } }).then(async (r) => { res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || '' }); res.end(Buffer.from(await r.arrayBuffer())); });
  }),
  await stub(4202, (req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(indexHtml.replace('<script type="module" src="js/app.js"></script>', '<script>throw new Error("Startup exploded")</script>')); }), // startup error
];
// A private workspace: owner sign-in set up (file store in a temporary folder), as a Preview with the owner's settings.
const PRIV_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-smoke-priv-'));
const priv = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env: { PATH: process.env.PATH, PORT: '4219', HQ_DATA_DIR: PRIV_DIR, HQ_OWNER_PASSWORD_HASH: require('../server/auth').hashPassword('smoke-test-password-1'), HQ_SCHEDULER_MS: '0', VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40) }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((res) => priv.stdout.on('data', (d) => { if (/running at/.test(d)) res(); }));
try {
  console.log('\n== Smoke test verdicts against local stand-ins ==');
  let r = await run('http://127.0.0.1:4197/', { EXPECT_REVIEWER: '1', EXPECT_PUBLISHING: '1', EXPECT_ANALYST: '1', EXPECT_VIDEO: '1', EXPECT_OPENAI: '1', EXPECT_SCHEDULING: '1', EXPECT_CATALOGUE: '1', EXPECT_SHA: 'a'.repeat(40) });
  assert(r.code === 0 && /RESULT: PASS/.test(r.out) && /Vektor's workspace opened/.test(r.out) && /Business profile opened/.test(r.out) && /publishing controls rendered/.test(r.out) && /Marketing Analyst workspace opened/.test(r.out) && /Video Creator rendered and played a video/.test(r.out), 'Working app (preview conditions), including publishing, the Analyst and a video render → pass');
  r = await run('http://127.0.0.1:4197/', { EXPECT_SHA: 'a'.repeat(40), REQUIRE_SHA_MATCH: '1' });
  assert(r.code === 2 && /doesn’t report which commit/.test(r.out), 'A URL passed in that can’t prove its commit → blocked, not pass');
  r = await run('http://127.0.0.1:4207/', { EXPECT_SHA: 'a'.repeat(40) });
  assert(r.code === 1 && /older or different deployment/.test(r.out), 'Deployment reporting a different commit → fail');
  r = await run('http://127.0.0.1:4209/', { EXPECT_OPENAI: '1' });
  assert(r.code === 1 && /live OpenAI to an anonymous visitor/.test(r.out), 'Live OpenAI reported to an anonymous visitor → fail');
  r = await run('http://127.0.0.1:4208/', { EXPECT_PUBLISHING: '1' });
  assert(r.code === 1 && /publishing controls didn’t appear/.test(r.out), 'Approved post with no publishing controls → fail');
  r = await run('http://127.0.0.1:4198/');
  assert(r.code === 1 && /RESULT: FAIL: Homepage returned HTTP 500 \(serverless function crashed\)/.test(r.out), 'Crashed function (Milestone 7 failure) → fail');
  r = await run('http://127.0.0.1:4199/');
  assert(r.code === 2 && /RESULT: BLOCKED/.test(r.out), 'Vercel sign-in page → blocked, not pass');
  r = await run('http://127.0.0.1:4201/');
  assert(r.code === 1 && /the app is blank/.test(r.out), 'Blank app → fail');
  r = await run('http://127.0.0.1:4202/');
  assert(r.code === 1 && /Startup exploded/.test(r.out), 'Uncaught startup error → fail');
  r = await run('http://127.0.0.1:4203/');
  assert(r.code === 1 && /RESULT: FAIL: Homepage returned HTTP 404/.test(r.out), 'GET / 404 while /index.html is 200 (the Vercel 404) → fail');
  r = await run('http://127.0.0.1:4204/');
  assert(r.code === 1 && /unknown API route returned 200/i.test(r.out) && /homepage HTML/.test(r.out), 'Unknown API route answered with homepage HTML → fail');
  r = await run('http://127.0.0.1:4205/');
  assert(r.code === 1 && /data\/profile-seed\.json returned 404/.test(r.out), 'Starting business profile missing from the deployment → fail');
  r = await run('');
  assert(r.code === 2, 'No preview URL → blocked, not pass');
  // Milestone 14: a private workspace (owner sign-in set up) passes only if sign-in comes first and nothing leaks.
  r = await run('http://127.0.0.1:4219/', { EXPECT_SHA: 'a'.repeat(40), EXPECT_REVIEWER: '1', EXPECT_PUBLISHING: '1', EXPECT_CATALOGUE: '1' });
  assert(r.code === 0 && /Private workspace on the preview/.test(r.out) && /all refused \(401\)/.test(r.out), 'Private workspace: sign-in first everywhere, nothing served before sign-in → pass');
  r = await run('http://127.0.0.1:4220/');
  assert(r.code === 1 && /GET \/js\/app\.js returned 200 instead of 401/.test(r.out), 'Private workspace that serves the app’s scripts before sign-in → fail');
  console.log('\nSmoke test self-check passed.');
} finally {
  priv.kill();
  fs.rmSync(PRIV_DIR, { recursive: true, force: true });
  app.kill();
  for (const s of stubs) s.close();
}
