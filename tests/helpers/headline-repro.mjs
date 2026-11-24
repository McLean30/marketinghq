// Reproduces the "What building JobTrack Pro taught us" case from the owner's Android screenshots against a given
// copy of HQ: a customer-reactivation post, the simulated v1 graphic older workspaces still have (test fixtures on,
// as production had before Milestone 14), then Photo layout with an empty photo slot.
//   node tests/helpers/headline-repro.mjs <app root> <port> [screenshot.png]
// Prints JSON: where the headline came from at each step. Used by test:m15 (current code) and run once against the
// Milestone 14 commit to record the original failure.
import { createRequire } from 'module';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const [root, portArg, shot] = process.argv.slice(2);
const PORT = Number(portArg || 4271);
const { hashPassword } = require(path.join(root, 'server', 'auth.js'));
const PW = `pw-${crypto.randomBytes(5).toString('hex')}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-repro-'));
const child = spawn(process.execPath, ['server.js'], { cwd: root, env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(PORT), HQ_DATA_DIR: DATA, HQ_OWNER_PASSWORD_HASH: hashPassword(PW), HQ_TEST_FIXTURES: '1', QUILL_PROVIDER: 'mock', QUILL_MOCK_DELAY_MS: '100', HQ_SCHEDULER_MS: '0' }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((res) => child.stdout.on('data', (d) => { if (/Shared workspace:/.test(d)) res(); }));
const BASE = `http://127.0.0.1:${PORT}/`;
const browser = await chromium.launch();
const out = {};
try {
  const page = await (await browser.newContext({ ...devices['Pixel 7'] })).newPage();
  await page.goto(`${BASE}#/`);
  await page.waitForSelector('#ws-password');
  await page.fill('#ws-password', PW);
  await page.click('#signin-form button[type=submit]');
  await page.waitForSelector('#brief-form');
  // The caption from the screenshots' reactivation post, used as the brief (what's typed, or a planned day's text).
  // The reactivation wording the owner approved in Milestone 13. It has none of the catalogue's topic words, so (like
  // production before the catalogue) nothing but the brief decides the graphic: the case from the screenshots.
  const BRIEF = process.env.REPRO_BRIEF || 'We’re building a simple way for local businesses to get back in touch with customers they’ve served before, so a good job leads to the next one.';
  await page.selectOption('#format', 'image').catch(() => {});
  await page.fill('#brief', BRIEF);
  await page.selectOption('#platform', 'LinkedIn');
  await page.click('#brief-form button[type=submit]');
  await page.locator('.job-row').first().click();
  const jobId = /#\/job\/([a-z0-9_]+)/.exec(page.url())[1];
  // Wait for the simulated v1 (fixtures), as older workspaces have it.
  for (let i = 0; i < 100; i++) { const st = await page.evaluate(() => fetch('api/workspace').then((r) => r.json())); const b = st.jobs.find((j) => j.id === jobId)?.bundle; if (b?.tasks.find((t) => t.type === 'graphic').versions.length) { out.v1 = b.tasks.find((t) => t.type === 'graphic').versions[0].content.headline; out.title = b.job.title || null; break; } await page.waitForTimeout(200); }
  out.pageTitle = await page.locator('h1').first().innerText();
  // Photo layout with an empty photo slot: the headline field it starts with.
  await page.goto(`${BASE}#/job/${jobId}/studio`);
  await page.waitForSelector('#st-headline');
  out.studioHeadline = await page.inputValue('#st-headline');
  out.v1Text = Array.isArray(out.v1) ? out.v1.join(' ') : out.v1;
  if (shot) await page.screenshot({ path: shot });
} finally {
  await browser.close();
  child.kill();
  fs.rmSync(DATA, { recursive: true, force: true });
}
console.log(JSON.stringify(out));
