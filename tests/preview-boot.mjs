// Regression test for the Vercel preview crash (TypeError: "path" must be a string, from server/workspace at load).
// Boots the server entry point under preview conditions and requests the homepage:
//   - no API keys and no shared-workspace settings (HQ_OWNER_PASSWORD_HASH, HQ_DATA_DIR unset)
//   - a read-only filesystem (tests/helpers/readonly-fs.cjs makes every write throw EROFS)
//   - started from a different working directory
// Runs from a copy of the Git-tracked files only (so an ignored or uncommitted file can't hide a missing one),
// first the source entry (server.js), then, if esbuild is available, a bundled build (server.cjs).
import { fileURLToPath } from 'url';
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PRELOAD = path.join(ROOT, 'tests', 'helpers', 'readonly-fs.cjs');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`  ok  ${m}`); };

// A copy of what Git would deploy: tracked files from the working tree, plus node_modules.
const APP = path.join(ROOT, 'tests', '.tmp-preview-app');
fs.rmSync(APP, { recursive: true, force: true });
for (const f of execFileSync('git', ['ls-files', '-z'], { cwd: ROOT }).toString().split('\0').filter(Boolean)) {
  if (!fs.existsSync(path.join(ROOT, f))) continue;
  fs.mkdirSync(path.dirname(path.join(APP, f)), { recursive: true });
  fs.copyFileSync(path.join(ROOT, f), path.join(APP, f));
}
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(APP, 'node_modules'));

const env = { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'production' }; // nothing else: no keys, no shared config

async function boot(label, entry, port, cwd) {
  console.log(`\n== ${label} ==`);
  const child = spawn(process.execPath, ['-r', PRELOAD, entry], { cwd, env: { ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const started = await new Promise((res) => {
    const t = setTimeout(() => res(false), 8000);
    child.stdout.on('data', () => { if (/running at/.test(out)) { clearTimeout(t); res(true); } });
    child.on('exit', () => { clearTimeout(t); res(false); });
  });
  try {
    assert(started, `Server starts on a read-only filesystem with no settings${started ? '' : `\n${out}`}`);
    const base = `http://127.0.0.1:${port}/`;
    const home = await fetch(base);
    const html = await home.text();
    assert(home.status === 200 && html.includes('<title>Nexai Marketing HQ</title>'), 'GET / serves HQ');
    const idx = await fetch(`${base}index.html`);
    assert(idx.status === 200 && (await idx.text()).includes('<title>Nexai Marketing HQ</title>'), 'GET /index.html serves HQ');
    for (const [asset, type] of [['js/app.js', 'javascript'], ['js/store.js', 'javascript'], ['css/app.css', 'css'], ['assets/agents/vektor.webp', 'image/webp'], ['assets/agents/calibre.webp', 'image/webp'], ['assets/agents/cue.webp', 'image/webp'], ['data/profile-seed.json', 'json']]) {
      const r = await fetch(base + asset);
      assert(r.status === 200 && (r.headers.get('content-type') || '').includes(type), `Serves ${asset} (${r.headers.get('content-type')})`);
    }
    const u = await fetch(`${base}api/__unknown-route`);
    assert(u.status === 404 && /json/.test(u.headers.get('content-type')) && !/<html/i.test(await u.text()), 'Unknown API route returns a JSON 404, not the homepage');
    const status = await (await fetch(`${base}api/auth/status`)).json();
    assert(status.authConfigured === false && status.signedIn === false, 'Shared workspace reported as off: the app opens in browser demo mode');
    const q = await (await fetch(`${base}api/quill/status`)).json();
    assert(q.provider === 'demo', 'No AI provider configured: captions use local demo templates');
    const w = await fetch(`${base}api/workspace`);
    assert(w.status === 503, 'Workspace API answers “not set up” (503) instead of touching storage');
    const a = await fetch(`${base}api/assets/photo_abcd1234`);
    assert(a.status === 503, 'Image API answers “not set up” (503)');
    assert(child.exitCode === null && !/EROFS|TypeError/.test(out), 'Still running, no filesystem writes attempted, no errors logged');
  } finally {
    child.kill();
  }
}

// 1. Source entry, started from another working directory.
try {
await boot('Source entry (server.js, Git-tracked files), preview conditions', path.join(APP, 'server.js'), 4195, os.tmpdir());

// 2. Bundled build, if esbuild is available (npx downloads it on first use).
let bundled = null;
const outDir = path.join(ROOT, 'tests', '.tmp-preview-build');
fs.rmSync(outDir, { recursive: true, force: true });
try {
  fs.mkdirSync(outDir, { recursive: true });
  execFileSync('npx', ['--yes', 'esbuild@0.24.2', path.join(APP, 'server.js'), '--bundle', '--platform=node', '--format=cjs', '--target=node18', `--outfile=${path.join(outDir, 'server.cjs')}`, '--log-level=warning'], { cwd: ROOT, stdio: 'pipe', timeout: 120000 });
  // Mirror a deployment: the bundle plus the static files next to it.
  fs.cpSync(path.join(APP, 'public'), path.join(outDir, 'public'), { recursive: true });
  bundled = path.join(outDir, 'server.cjs');
} catch (e) {
  console.log(`\n(skipped bundled build: esbuild unavailable: ${String(e.message).split('\n')[0]})`);
}
try {
  if (bundled) await boot('Bundled build (single-file server.cjs, esbuild), preview conditions', bundled, 4196, outDir);
  console.log('\nAll preview boot checks passed.');
} finally {
  fs.rmSync(outDir, { recursive: true, force: true });
}
} finally {
  fs.rmSync(APP, { recursive: true, force: true });
}
