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
  await stub(4202, (req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(indexHtml.replace('<script type="module" src="js/app.js"></script>', '<script>throw new Error("Startup exploded")</script>')); }), // startup error
];
try {
  console.log('\n== Smoke test verdicts against local stand-ins ==');
  let r = await run('http://127.0.0.1:4197/', { EXPECT_REVIEWER: '1' });
  assert(r.code === 0 && /RESULT: PASS/.test(r.out) && /Vektor's workspace opened/.test(r.out) && /Business profile opened/.test(r.out), 'Working app (fixed code, preview conditions) → pass');
  r = await run('http://127.0.0.1:4198/');
  assert(r.code === 1 && /RESULT: FAIL: Homepage returned HTTP 500 \(serverless function crashed\)/.test(r.out), 'Crashed function (Milestone 7 failure) → fail');
  r = await run('http://127.0.0.1:4199/');
  assert(r.code === 2 && /RESULT: BLOCKED/.test(r.out), 'Vercel sign-in page → blocked, not pass');
  r = await run('http://127.0.0.1:4201/');
  assert(r.code === 1 && /the app is blank/.test(r.out), 'Blank app → fail');
  r = await run('http://127.0.0.1:4202/');
  assert(r.code === 1 && /Startup exploded/.test(r.out), 'Uncaught startup error → fail');
  r = await run('');
  assert(r.code === 2, 'No preview URL → blocked, not pass');
  console.log('\nSmoke test self-check passed.');
} finally {
  app.kill();
  for (const s of stubs) s.close();
}
