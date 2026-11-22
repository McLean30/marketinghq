// Regression test for the Vercel preview crash (TypeError: "path" must be a string, from server/workspace at load).
// Boots the server entry point under preview conditions and requests the homepage:
//   - no API keys and no shared-workspace settings (HQ_OWNER_PASSWORD_HASH, HQ_DATA_DIR unset)
//   - a read-only filesystem (tests/helpers/readonly-fs.cjs makes every write throw EROFS)
//   - started from a different working directory
// Runs the source entry (server.js) and, if esbuild is available, a bundled build (server.cjs) like Vercel's.
import { fileURLToPath } from 'url';
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PRELOAD = path.join(ROOT, 'tests', 'helpers', 'readonly-fs.cjs');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`  ok  ${m}`); };

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
    assert(home.status === 200 && html.includes('<title>Nexai Marketing HQ</title>'), 'Homepage (HQ) is served');
    for (const asset of ['js/app.js', 'js/store.js', 'css/app.css', 'assets/agents/reviewer.svg', 'data/profile-seed.json']) {
      const r = await fetch(base + asset);
      assert(r.status === 200, `Serves ${asset}`);
    }
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
await boot('Source entry (server.js), preview conditions', path.join(ROOT, 'server.js'), 4195, os.tmpdir());

// 2. Bundled build, if esbuild is available (npx downloads it on first use).
let bundled = null;
const outDir = path.join(ROOT, 'tests', '.tmp-preview-build');
fs.rmSync(outDir, { recursive: true, force: true });
try {
  fs.mkdirSync(outDir, { recursive: true });
  execFileSync('npx', ['--yes', 'esbuild@0.24.2', path.join(ROOT, 'server.js'), '--bundle', '--platform=node', '--format=cjs', '--target=node18', `--outfile=${path.join(outDir, 'server.cjs')}`, '--log-level=warning'], { cwd: ROOT, stdio: 'pipe', timeout: 120000 });
  // Mirror a deployment: the bundle plus the static files next to it.
  fs.cpSync(path.join(ROOT, 'public'), path.join(outDir, 'public'), { recursive: true });
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
