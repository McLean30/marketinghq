// The in-browser owner password hash (for Vercel, where you can't run npm run set-password): made on HQ's Workspace
// page with no settings, then used as HQ_OWNER_PASSWORD_HASH to sign in. The password never leaves the page.
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`  ok  ${m}`); };
const PASSWORD = 'correct horse battery staple 42';

function start(port, env) {
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  return new Promise((res) => child.stdout.on('data', () => /Shared workspace:/.test(out) && res({ child, log: () => out })));
}

const browser = await chromium.launch();
const servers = [];
try {
  console.log('\n== Make a password hash in the browser ==');
  const demo = await start(4216, {});
  servers.push(demo);
  const page = await browser.newPage();
  const sent = [];
  page.on('request', (r) => { if (r.method() !== 'GET') sent.push(r.postData() || ''); });
  await page.goto('http://127.0.0.1:4216/#/workspace');
  await page.waitForSelector('[data-testid="password-tool"]');
  await page.fill('#pw-1', 'short');
  await page.fill('#pw-2', 'short');
  await page.click('#pwhash-form button[type=submit]');
  assert(/at least 12/.test(await page.textContent('#pwhash-form .form-error')), 'A short password is refused');
  await page.fill('#pw-1', PASSWORD);
  await page.fill('#pw-2', `${PASSWORD}x`);
  await page.click('#pwhash-form button[type=submit]');
  assert(/don’t match/.test(await page.textContent('#pwhash-form .form-error')), 'Mismatched passwords are refused');
  await page.fill('#pw-1', PASSWORD);
  await page.fill('#pw-2', PASSWORD);
  await page.click('#pwhash-form button[type=submit]');
  await page.waitForSelector('[data-testid="password-hash"]', { timeout: 20000 });
  const hash = await page.inputValue('[data-testid="password-hash"]');
  assert(/^pbkdf2-sha256\$600000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/.test(hash), 'Hash made: PBKDF2-SHA256, 600,000 rounds');
  assert(!hash.includes(PASSWORD) && !sent.some((b) => b.includes(PASSWORD)), 'The password isn’t in the hash and was never sent to the server');
  demo.child.kill();

  console.log('\n== Sign in with it ==');
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-pw-'));
  const shared = await start(4217, { HQ_OWNER_PASSWORD_HASH: hash, HQ_DATA_DIR: data, HQ_SCHEDULER_MS: '0' });
  servers.push(shared);
  assert(/Shared workspace: on/.test(shared.log()), 'Server accepts the hash and turns the shared workspace on');
  const p2 = await browser.newPage();
  await p2.goto('http://127.0.0.1:4217/#/workspace');
  await p2.waitForSelector('#ws-password');
  await p2.fill('#ws-password', 'wrong password here');
  await p2.click('#signin-form button[type=submit]');
  await p2.waitForSelector('#signin-error:not([hidden])');
  assert(/isn’t right/.test(await p2.textContent('#signin-error')), 'A wrong password is refused');
  await p2.fill('#ws-password', PASSWORD);
  await p2.click('#signin-form button[type=submit]');
  await p2.waitForFunction(() => document.getElementById('ws-pill')?.textContent === 'Shared workspace', null, { timeout: 15000 });
  assert(true, 'The owner signs in with the password behind the browser-made hash');

  console.log('\n== Vercel without Supabase stays in demo mode ==');
  const vercel = await start(4218, { HQ_OWNER_PASSWORD_HASH: hash, VERCEL: '1', HQ_SCHEDULER_MS: '0' });
  servers.push(vercel);
  const st = await (await fetch('http://127.0.0.1:4218/api/auth/status')).json();
  assert(!st.authConfigured && /SUPABASE_URL/.test(st.setupProblem || ''), 'A hash alone on Vercel (read-only disk) keeps HQ in demo mode and says Supabase is needed');
  console.log('\nPassword setup checks passed.');
} finally {
  await browser.close();
  for (const s of servers) s.child.kill();
}
