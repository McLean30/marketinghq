// Builds the app with the Vercel CLI (framework preset "node", the same zero-config build Vercel runs for this
// repository) from a copy of the Git-tracked files only, then checks the build output:
//   - the server function carries public/index.html, the app scripts, styles, character art and the profile seed
//     (Vercel sends "/" and every unmatched path to the function, so without them GET / is a 404);
//   - the built function boots on a read-only filesystem with no settings and answers
//     GET / and GET /index.html with HQ, serves an asset, and keeps unknown /api routes as JSON errors.
// This is a local emulation of Vercel's build, not a deployment. Only the preview smoke test on the real
// Preview URL counts for release. Needs network access to npm (npx vercel). No Vercel account is used.
import { fileURLToPath } from 'url';
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PRELOAD = path.join(ROOT, 'tests', 'helpers', 'readonly-fs.cjs');
const WORK = path.join(ROOT, 'tests', '.tmp-vercel-build');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`  ok  ${m}`); };

fs.rmSync(WORK, { recursive: true, force: true });
const src = path.join(WORK, 'src');
const fn = path.join(WORK, 'function');
let child;
try {
  console.log('\n== Vercel build (preset "node") from Git-tracked files ==');
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT }).toString().split('\0').filter(Boolean);
  for (const f of files) {
    if (!fs.existsSync(path.join(ROOT, f))) continue; // deleted in the working tree
    fs.mkdirSync(path.dirname(path.join(src, f)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, f), path.join(src, f));
  }
  assert(files.includes('public/data/profile-seed.json'), 'The starting business profile is tracked in Git (not hidden by .gitignore)');
  fs.cpSync(path.join(ROOT, 'node_modules'), path.join(src, 'node_modules'), { recursive: true, verbatimSymlinks: true });
  fs.mkdirSync(path.join(src, '.vercel'));
  fs.writeFileSync(path.join(src, '.vercel', 'project.json'), JSON.stringify({ projectId: 'prj_local', orgId: 'team_local', settings: { framework: 'node', buildCommand: null, outputDirectory: null, installCommand: null, rootDirectory: null, nodeVersion: '22.x' } }));
  execFileSync('npx', ['--yes', 'vercel@latest', 'build', '--yes'], { cwd: src, stdio: 'pipe', timeout: 300000, env: { ...process.env, VERCEL_TELEMETRY_DISABLED: '1' } });
  const out = path.join(src, '.vercel', 'output');
  const cfg = JSON.parse(fs.readFileSync(path.join(out, 'functions', 'index.func', '.vc-config.json'), 'utf8'));
  const routes = JSON.parse(fs.readFileSync(path.join(out, 'config.json'), 'utf8')).routes || [];
  assert(routes.some((r) => r.dest === '/' || r.dest === '/index'), 'Unmatched paths, including "/", are routed to the server function');
  const map = cfg.filePathMap || {};
  const need = ['public/index.html', 'public/js/app.js', 'public/js/store.js', 'public/css/app.css', 'public/assets/agents/vektor.webp', 'public/assets/agents/reviewer.svg', 'public/data/profile-seed.json'];
  const missing = need.filter((f) => !map[f] && !fs.existsSync(path.join(out, 'functions', 'index.func', f)));
  assert(!missing.length, `The server function includes HQ's page and files${missing.length ? ` (missing: ${missing.join(', ')})` : ''}`);
  assert(fs.existsSync(path.join(out, 'static', 'index.html')), 'Static copy of public/ is present too');

  // Lay the function out as it runs on Vercel: its own files plus every file in filePathMap.
  fs.cpSync(path.join(out, 'functions', 'index.func'), fn, { recursive: true });
  for (const [dest, from] of Object.entries(map)) {
    fs.mkdirSync(path.dirname(path.join(fn, dest)), { recursive: true });
    fs.copyFileSync(path.join(src, from), path.join(fn, dest));
  }

  console.log('\n== Built function under preview conditions (no settings, read-only filesystem) ==');
  const port = 4206;
  child = spawn(process.execPath, ['-r', PRELOAD, path.join(fn, cfg.handler)], { cwd: fn, env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'production', PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const started = await new Promise((res) => {
    const t = setTimeout(() => res(false), 10000);
    child.stdout.on('data', () => { if (/running at/.test(log)) { clearTimeout(t); res(true); } });
    child.on('exit', () => { clearTimeout(t); res(false); });
  });
  assert(started, `Built function starts${started ? '' : `\n${log}`}`);
  const base = `http://127.0.0.1:${port}/`;
  const home = await fetch(base);
  const homeHtml = await home.text();
  assert(home.status === 200 && homeHtml.includes('<title>Nexai Marketing HQ</title>'), `GET / → ${home.status} with HQ`);
  const idx = await fetch(`${base}index.html`);
  assert(idx.status === 200 && (await idx.text()).includes('<title>Nexai Marketing HQ</title>'), `GET /index.html → ${idx.status} with HQ`);
  for (const [p, type] of [['js/app.js', 'javascript'], ['assets/agents/vektor.webp', 'image/webp'], ['data/profile-seed.json', 'json']]) {
    const r = await fetch(base + p);
    assert(r.status === 200 && (r.headers.get('content-type') || '').includes(type), `GET /${p} → ${r.status} (${r.headers.get('content-type')})`);
  }
  const api = await fetch(`${base}api/__unknown-route`);
  const apiBody = await api.text();
  assert(api.status === 404 && /json/.test(api.headers.get('content-type')) && !/<html/i.test(apiBody), `Unknown API route → ${api.status} JSON error, not the homepage`);
  assert(!/EROFS|TypeError/.test(log), 'No filesystem writes attempted, no errors logged');
  console.log('\nVercel build check passed (local emulation; the deployed smoke test is still required).');
} finally {
  if (child) child.kill();
  fs.rmSync(WORK, { recursive: true, force: true });
}
