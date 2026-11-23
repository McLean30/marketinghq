// Checks that tests/vercel-smoke.mjs reaches the right verdict, offline, against local stand-ins:
// the working app (pass), the crashed Milestone 7 function (fail), a Vercel sign-in page (blocked),
// a blank app and an app with an uncaught startup error (fail). Local results never count as a Vercel pass;
// this only proves the smoke test's judgement.
import { fileURLToPath } from 'url';
import { spawn, execFileSync } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
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
const indexHtml = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const stubs = [
  await stub(4198, (req, res) => { res.writeHead(500, { 'content-type': 'text/plain' }); res.end('A server error has occurred\n\nFUNCTION_INVOCATION_FAILED\n'); }), // crashed function
  await stub(4199, (req, res) => { res.writeHead(401, { 'content-type': 'text/html' }); res.end('<title>Login – Vercel</title><h1>Vercel Authentication</h1><p>Log in to Vercel to continue.</p>'); }), // protection
  await stub(4201, (req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>Nexai Marketing HQ</title><main id="main"></main>'); }), // blank app
  // Vercel's 404 for "/": static files exist, but the function can't find public/index.html.
  await stub(4203, (req, res) => {
    const file = path.join(ROOT, 'public', req.url === '/' ? '__none__' : req.url.split('?')[0]);
    if (req.url !== '/' && fs.existsSync(file) && fs.statSync(file).isFile()) { res.writeHead(200); res.end(fs.readFileSync(file)); return; }
    res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found');
  }),
  // A catch-all that answers every path (including /api/*) with the homepage.
  await stub(4204, (req, res) => {
    const p = req.url.split('?')[0];
    const file = path.join(ROOT, 'public', p === '/' ? 'index.html' : p);
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
  await stub(4202, (req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(indexHtml.replace('<script type="module" src="js/app.js"></script>', '<script>throw new Error("Startup exploded")</script>')); }), // startup error
];
try {
  console.log('\n== Smoke test verdicts against local stand-ins ==');
  let r = await run('http://127.0.0.1:4197/', { EXPECT_REVIEWER: '1', EXPECT_PUBLISHING: '1', EXPECT_ANALYST: '1', EXPECT_VIDEO: '1', EXPECT_SHA: 'a'.repeat(40) });
  assert(r.code === 0 && /RESULT: PASS/.test(r.out) && /Vektor's workspace opened/.test(r.out) && /Business profile opened/.test(r.out) && /publishing controls rendered/.test(r.out) && /Marketing Analyst workspace opened/.test(r.out) && /Video Creator rendered and played a video/.test(r.out), 'Working app (preview conditions), including publishing, the Analyst and a video render → pass');
  r = await run('http://127.0.0.1:4197/', { EXPECT_SHA: 'a'.repeat(40), REQUIRE_SHA_MATCH: '1' });
  assert(r.code === 2 && /doesn’t report which commit/.test(r.out), 'A URL passed in that can’t prove its commit → blocked, not pass');
  r = await run('http://127.0.0.1:4207/', { EXPECT_SHA: 'a'.repeat(40) });
  assert(r.code === 1 && /older or different deployment/.test(r.out), 'Deployment reporting a different commit → fail');
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
  console.log('\nSmoke test self-check passed.');
} finally {
  app.kill();
  for (const s of stubs) s.close();
}
