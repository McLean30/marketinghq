// The shared workspace on Supabase, with two HQ servers at once (as on Vercel, where instances share nothing in
// memory). Uses its own workspace id in the real project and removes everything it created. OpenAI is a local stub
// (dummy key): no paid calls.
//   SUPABASE_TEST_URL=https://<ref>.supabase.co SUPABASE_SECRET_KEY=<secret> npm run test:supabase
// (In a Claude cloud session the proxy injects the key; SUPABASE_SECRET_KEY can be a placeholder there.)
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { spawn } from 'child_process';
import http from 'http';
import crypto from 'crypto';

const require = createRequire(import.meta.url);
const { hashPassword } = require('../server/auth');
const { mockPng } = require('../server/mock-image');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const URL_ = (process.env.SUPABASE_TEST_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SECRET_KEY || '';
if (!URL_ || !KEY) { console.log('Skipped: set SUPABASE_TEST_URL and SUPABASE_SECRET_KEY to run the Supabase store test.'); process.exit(0); }
const WS = `test-${crypto.randomBytes(5).toString('hex')}`;
const PASSWORD = `pw-${crypto.randomBytes(8).toString('hex')}`;
const STUB = 4213;
const A = 4214;
const B = 4215;
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`  ok  ${m}`); };
const sb = (p, opts = {}) => fetch(`${URL_}${p}`, { ...opts, headers: { apikey: KEY, 'Content-Type': 'application/json', ...(opts.headers || {}) } });

/* OpenAI stub: counts calls so we can prove one charge per key across both servers. */
let calls = 0;
const stub = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    calls++;
    const b = JSON.parse(body || '{}');
    const send = (o) => setTimeout(() => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); }, 600);
    if (req.url.startsWith('/v1/images/')) return send({ data: [{ b64_json: mockPng('sb', 64, 96).toString('base64') }], usage: { input_tokens: 50, input_tokens_details: { text_tokens: 50, image_tokens: 0 }, output_tokens: 1000, output_tokens_details: { image_tokens: 1000 }, total_tokens: 1050 } });
    send({ id: 'r', status: 'completed', model: b.model, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ caption: 'Stub caption.\n\n#PPM', notes: 'n' }) }] }], usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 0 }, output_tokens: 20, output_tokens_details: { reasoning_tokens: 5 }, total_tokens: 120 } });
  });
});
await new Promise((r) => stub.listen(STUB, '127.0.0.1', r));

const env = { ...process.env, HQ_OWNER_PASSWORD_HASH: hashPassword(PASSWORD), HQ_TEST_FIXTURES: '1', SUPABASE_URL: URL_, SUPABASE_SECRET_KEY: KEY, HQ_WORKSPACE_ID: WS, HQ_SCHEDULER_MS: '0', QUILL_PROVIDER: '', AI_PROVIDER: '', OPENAI_API_KEY: 'sk-dummy-not-real', OPENAI_BASE_URL: `http://127.0.0.1:${STUB}/v1`, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost', NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY || (process.env.HTTPS_PROXY ? '1' : '') };
function start(port) {
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const ready = new Promise((res) => { child.stdout.on('data', () => /Shared workspace:/.test(out) && res()); child.on('exit', () => res()); });
  return { child, ready, log: () => out };
}
const a = start(A);
const b = start(B);
await Promise.all([a.ready, b.ready]);
const base = (p) => `http://127.0.0.1:${p}/`;
const api = (port, p, { method = 'GET', body, cookie, headers = {} } = {}) => fetch(`${base(port)}${p}`, { method, redirect: 'manual', headers: { ...(body !== undefined && !(body instanceof Uint8Array) ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers }, body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body) });

const bundle = (id, versions = 1, extra = {}) => ({
  job: { id, title: 'Supabase test', brief: 'Test brief for the Supabase store.', platform: 'LinkedIn', createdAt: Date.now(), taskIds: { copy: `task_${id.slice(4)}c`, graphic: `task_${id.slice(4)}g` }, ...extra },
  tasks: [
    { id: `task_${id.slice(4)}c`, jobId: id, type: 'copy', versions: Array.from({ length: versions }, (_, i) => ({ n: i + 1, content: { text: `Caption v${i + 1}` } })) },
    { id: `task_${id.slice(4)}g`, jobId: id, type: 'graphic', versions: [] },
  ],
  log: [],
});

try {
  console.log(`\n== Supabase store (workspace ${WS}, two HQ servers) ==`);
  assert(/Storage: Supabase/.test(a.log()) && !a.log().includes(KEY.slice(0, 12) || 'x'.repeat(40)), 'Server reports Supabase storage and never prints the key');
  let st = await (await api(A, 'api/auth/status')).json();
  assert(st.authConfigured && st.storage === 'supabase' && !st.signedIn, 'Status: owner sign-in on, storage supabase, signed out');

  let r = await api(A, 'api/auth/login', { method: 'POST', body: { password: 'wrong' } });
  assert(r.status === 401, 'Wrong password refused');
  r = await api(A, 'api/auth/login', { method: 'POST', body: { password: PASSWORD } });
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  assert(r.ok && cookie.startsWith('hq_session='), 'Owner signs in on server A');
  st = await (await api(B, 'api/auth/status', { cookie })).json();
  assert(st.signedIn, 'The same session works on server B (sessions live in Supabase, not one server’s memory)');
  const rows = await (await sb(`/rest/v1/hq_sessions?workspace=eq.${WS}&select=token_hash`)).json();
  assert(rows.length === 1 && !rows[0].token_hash.includes(cookie.split('=')[1]), 'Only a hash of the session token is stored');

  // Workspace snapshot seeds the profile once, even with both servers asking at the same time.
  const [s1, s2] = await Promise.all([api(A, 'api/workspace', { cookie }).then((x) => x.json()), api(B, 'api/workspace', { cookie }).then((x) => x.json())]);
  assert(s1.profile.versions.length === s2.profile.versions.length && s1.profile.versions.length >= 1 && typeof s1.profile.versions.at(-1).data.writing.voice === 'string', 'Business profile seeded once, with the editorial voice');

  console.log('\n== Saves are atomic across servers ==');
  const id = `job_sb${crypto.randomBytes(4).toString('hex')}`;
  r = await api(A, `api/workspace/jobs/${id}`, { method: 'PUT', cookie, body: { baseRev: 0, bundle: bundle(id) } });
  assert(r.ok && (await r.json()).rev === 1, 'Job created on A (rev 1)');
  const [p1, p2] = await Promise.all([
    api(A, `api/workspace/jobs/${id}`, { method: 'PUT', cookie, body: { baseRev: 1, bundle: bundle(id, 2) } }),
    api(B, `api/workspace/jobs/${id}`, { method: 'PUT', cookie, body: { baseRev: 1, bundle: bundle(id, 2) } }),
  ]);
  const codes = [p1.status, p2.status].sort();
  assert(codes[0] === 200 && codes[1] === 409, `Two devices saving the same revision at once: one saved, one told it changed (${codes.join(', ')})`);
  const loser = p1.status === 409 ? await p1.json() : await p2.json();
  assert(loser.current?.rev === 2 && loser.current.bundle.tasks[0].versions.length === 2, 'The refused save gets the latest version back');
  r = await api(B, `api/workspace/jobs/${id}`, { method: 'PUT', cookie, body: { baseRev: 2, bundle: bundle(id, 1) } });
  assert(r.status === 422, 'Removing a saved version is refused (append-only history)');
  const rev = await (await api(B, 'api/workspace/rev', { cookie })).json();
  assert(rev.rev >= 2, `Workspace revision is shared (${rev.rev})`);

  console.log('\n== Files (private bucket) ==');
  const png = new Uint8Array(mockPng('upload', 32, 48));
  r = await api(A, 'api/assets/photo_sbtest01', { method: 'POST', cookie, body: png, headers: { 'content-type': 'image/png', 'x-asset-kind': 'photo', 'x-asset-name': 'test.png' } });
  assert(r.ok, 'Small photo uploaded through HQ');
  r = await api(B, 'api/assets/photo_sbtest01', { cookie });
  const loc = r.headers.get('location') || '';
  assert(r.status === 302 && loc.startsWith(`${URL_}/storage/v1/object/sign/hq-assets/${WS}/`), 'Server B serves it as a short-lived signed link');
  const got = new Uint8Array(await (await fetch(loc)).arrayBuffer());
  assert(got.length === png.length, 'The signed link returns the same bytes');
  r = await api(B, 'api/assets/photo_sbtest01');
  assert(r.status === 401, 'Files are refused without sign-in');
  // Direct upload (how clips and videos get past Vercel's 4.5 MB request limit).
  const clip = new Uint8Array(200000).fill(7);
  const info = { kind: 'clip', name: 'clip.mp4', type: 'video/mp4', size: clip.length };
  let plan = await (await api(A, 'api/assets/clip_sbtest01/upload-url', { method: 'POST', cookie, body: info })).json();
  assert(plan.direct && plan.url.startsWith(`${URL_}/storage/v1/object/upload/sign/hq-assets/`), 'Direct upload: HQ hands out a signed upload URL');
  r = await fetch(plan.url, { method: 'PUT', body: clip, headers: { 'Content-Type': 'video/mp4', 'x-upsert': 'true' } });
  assert(r.ok, 'The browser-style PUT to Supabase succeeds');
  r = await api(B, 'api/assets/clip_sbtest01/complete', { method: 'POST', cookie, body: { ...info, size: clip.length + 1 } });
  assert(r.status === 409, 'A size that doesn’t match what arrived is refused');
  r = await api(B, 'api/assets/clip_sbtest01/complete', { method: 'POST', cookie, body: info });
  const chk = await (await api(A, 'api/assets/check', { method: 'POST', cookie, body: { ids: ['clip_sbtest01', 'photo_sbtest01', 'photo_missing01'] } })).json();
  assert(r.ok && chk.present.length === 2 && !chk.present.includes('photo_missing01'), 'Upload confirmed; both files listed as present');
  plan = await (await api(B, 'api/assets/clip_sbtest01/upload-url', { method: 'POST', cookie, body: info })).json();
  assert(plan.existing === true, 'Uploading the same file again is a no-op');

  console.log('\n== One paid call per tap, across servers (OpenAI stub) ==');
  const key = `${id}:cap:${crypto.randomBytes(3).toString('hex')}`;
  const cap = { requestKey: key, jobId: id, kind: 'draft', brief: 'LinkedIn post for facilities directors about PPM parts planning.', platform: 'LinkedIn' };
  const before = calls;
  const [c1, c2] = await Promise.all([api(A, 'api/quill/caption', { method: 'POST', cookie, body: cap }), api(B, 'api/quill/caption', { method: 'POST', cookie, body: cap })]);
  const [j1, j2] = [await c1.json(), await c2.json()];
  assert(c1.ok && c2.ok && calls === before + 1 && j1.caption === j2.caption && (j1.duplicate || j2.duplicate), 'Same request key on both servers at once: one OpenAI call, both get the caption');
  r = await api(A, 'api/quill/caption', { method: 'POST', cookie, body: cap });
  assert((await r.json()).duplicate === true && calls === before + 1, 'A later retry with the key: no new call');
  r = await api(B, 'api/prism/image', { method: 'POST', cookie, body: { requestKey: `${id}:img:01`, jobId: id, op: 'generate', prompt: 'Engineer at a plant room panel' } });
  const img = await r.json();
  r = await api(A, 'api/prism/image', { method: 'POST', cookie, body: { requestKey: `${id}:img:02`, jobId: id, op: 'edit', prompt: 'Make it morning light', baseAssetId: img.assetId } });
  assert(img.assetId && r.ok, 'AI image saved to Supabase on B, then edited from A (reads the stored image)');
  const led = await (await api(B, `api/ai/usage?jobId=${id}`, { cookie })).json();
  const kinds = led.entries.map((e) => e.kind).sort().join(',');
  assert(kinds === 'caption,image-edit,image-generate' && led.entries.every((e) => typeof e.estCostUsd === 'number'), `Usage ledger in Supabase: ${kinds}, each with an estimated cost`);

  console.log('\n== Sign-in throttling is shared ==');
  for (let i = 0; i < 5; i++) await api(i % 2 ? A : B, 'api/auth/login', { method: 'POST', body: { password: 'nope' } });
  r = await api(A, 'api/auth/login', { method: 'POST', body: { password: PASSWORD } });
  assert(r.status === 429, 'After 5 failures across both servers, sign-in pauses for 15 minutes');
  r = await api(A, 'api/auth/logout', { method: 'POST', cookie });
  st = await (await api(B, 'api/auth/status', { cookie })).json();
  assert(!st.signedIn, 'Signing out on A signs that session out on B too');
  console.log('\nSupabase store checks passed.');
} finally {
  a.child.kill();
  b.child.kill();
  stub.close();
  // Remove everything this test created (its own workspace id only).
  const list = await (await sb('/storage/v1/object/list/hq-assets', { method: 'POST', body: JSON.stringify({ prefix: WS, limit: 1000 }) })).json().catch(() => []);
  const names = Array.isArray(list) ? list.map((o) => `${WS}/${o.name}`) : [];
  if (names.length) await sb('/storage/v1/object/hq-assets', { method: 'DELETE', body: JSON.stringify({ prefixes: names }) });
  for (const t of ['hq_records', 'hq_sessions', 'hq_login_failures', 'hq_ai_requests', 'hq_ai_usage', 'hq_meta']) await sb(`/rest/v1/${t}?workspace=eq.${WS}`, { method: 'DELETE' });
  const left = await (await sb(`/rest/v1/hq_records?workspace=eq.${WS}&select=id`)).json();
  console.log(`  cleanup: ${names.length} file(s) and the test workspace removed${left.length ? ` (left: ${left.length} rows)` : ''}`);
}
