// Milestone 5 acceptance: Vektor plans a content week and delegates five posts. Shared workspace, mock captions.
// Starts its own server on :4178 with a fresh data folder and a test owner password.
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA = path.join(ROOT, 'tests', '.tmp-m5-data');
fs.rmSync(DATA, { recursive: true, force: true });
process.env.HQ_DATA_DIR = DATA;
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const { hashPassword } = require('../server/auth');

const PORT = 4178;
const BASE = `http://127.0.0.1:${PORT}/`;
const OUT = path.join(ROOT, 'tests', 'screenshots');
const PASSWORD = `test-owner-${crypto.randomBytes(6).toString('hex')}`;
const BRIEF = 'Plan a week for UK commercial maintenance directors about completed jobs that the office still can’t invoice. Cover missing engineer photos, incomplete job sheets and delayed client sign-off. Give readers something practical they can use. No hard sell.';
const THURSDAY_ANGLE = 'Chasing a client signature for a week costs more than the job itself: get sign-off before the van leaves';
fs.mkdirSync(OUT, { recursive: true });
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`  ok  ${m}`); };

// Expected dates: next Monday in Europe/London.
const londonToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
const t0 = new Date(`${londonToday}T00:00:00Z`);
const MON = new Date(t0); MON.setUTCDate(t0.getUTCDate() + ((8 - t0.getUTCDay()) % 7));
const iso = (d) => d.toISOString().slice(0, 10);
const EXPECT = [['Monday', 'LinkedIn'], ['Tuesday', 'Facebook'], ['Wednesday', 'Google Business Profile'], ['Thursday', 'Facebook'], ['Friday', 'LinkedIn']].map(([day, platform], i) => {
  const d = new Date(MON); d.setUTCDate(MON.getUTCDate() + i);
  return { day, platform, date: iso(d), label: d.toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long' }) };
});

const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), HQ_DATA_DIR: DATA, HQ_OWNER_PASSWORD_HASH: hashPassword(PASSWORD), HQ_TEST_FIXTURES: '1', QUILL_PROVIDER: 'mock', QUILL_MOCK_DELAY_MS: '500', OPENAI_API_KEY: '' }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((res) => { let o = ''; server.stdout.on('data', (d) => { o += d; if (/Shared workspace: on/.test(o)) res(); }); });

async function signIn(page) {
  await page.goto(`${BASE}#/workspace`);
  await page.fill('#ws-password', PASSWORD);
  await page.click('#signin-form button[type=submit]');
  await page.waitForFunction(() => document.getElementById('ws-pill')?.textContent === 'Shared workspace'); // pill is hidden at phone width; status lives on HQ there
}
const workspace = (page) => page.evaluate(async () => (await fetch('api/workspace')).json());
const mockCalls = (page) => page.evaluate(async () => (await fetch('api/quill/mock-calls')).json());
const planCalls = (page) => page.evaluate(async () => (await fetch('api/vektor/mock-plan-calls')).json());

const browser = await chromium.launch();
try {
  console.log('\n== Desktop: plan the week (template) ==');
  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // Covers a deployment without the official logo file (the "logo missing" attention item).
  await desk.route('**/assets/brand/brand.json', (r) => r.fulfill({ contentType: 'application/json', body: '{"logo": false}' }));
  const dp = await desk.newPage();
  const errors = [];
  dp.on('pageerror', (e) => errors.push(`desktop: ${e.message}`));
  await signIn(dp);
  await dp.goto(`${BASE}#/`);
  await dp.click('[data-testid="plan-week-link"]');
  await dp.waitForSelector('#week-form');
  assert((await dp.inputValue('#wk-start')) === EXPECT[0].date, `Week defaults to next Monday in Europe/London (${EXPECT[0].date})`);
  await dp.fill('#wk-brief', BRIEF);
  await dp.click('button:has-text("Create template plan")');
  await dp.waitForSelector('[data-testid="plan-editor"]');
  assert(/Template plan/.test(await dp.locator('[data-testid="plan-method"]').innerText()) && /No AI was used/.test(await dp.locator('[data-testid="plan-method"]').innerText()), 'Plan is clearly labelled as a template plan');
  for (const e of EXPECT) {
    const row = await dp.locator(`[data-testid="plan-day-${e.day}"]`).innerText();
    assert(row.includes(`${e.day} ${e.label}`) && row.includes(e.platform), `${e.day} ${e.label}: ${e.platform}`);
  }
  const fields = await dp.locator('[data-testid="plan-day-Tuesday"] textarea, [data-testid="plan-day-Tuesday"] input:not([type=checkbox])').count();
  assert(fields === 4, 'Each day shows audience, angle, practical takeaway and visual brief');
  assert(/photos/i.test(await dp.inputValue('#pd-angle-1')) && /job sheets/i.test(await dp.inputValue('#pd-angle-2')) && /sign-off/i.test(await dp.inputValue('#pd-angle-3')), 'Template covers photos (Tue), job sheets (Wed), sign-off (Thu)');
  await dp.fill('#pd-angle-3', THURSDAY_ANGLE);
  await dp.press('#pd-angle-3', 'Tab');
  await dp.screenshot({ path: `${OUT}/m5-desktop-01-plan.png`, fullPage: true });

  // Force Thursday's caption request to fail once.
  let failed = 0;
  await dp.route('**/api/quill/caption', async (route) => {
    const body = route.request().postDataJSON();
    if (!failed && body.brief.includes(THURSDAY_ANGLE)) { failed++; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'The Anthropic API returned an error (529). Retry in a moment.', retryable: true }) }); }
    return route.continue();
  });
  console.log('\n== Confirm (double-tapped) and delegate ==');
  await dp.locator('button[data-confirm-plan]').dblclick();
  await dp.waitForSelector('[data-testid="attention"]', { timeout: 15000 });
  const planId = /#\/week\/([a-z0-9_]+)/.exec(dp.url())[1];
  await dp.waitForFunction(() => document.querySelectorAll('[data-testid^="week-day-"] .mini').length === 5 && [...document.querySelectorAll('[data-testid^="week-day-"] .mini')].every((el) => /Caption: (v1|failed)/.test(el.textContent) && /Graphic: v1/.test(el.textContent)), null, { timeout: 30000 });
  let ws = await workspace(dp);
  const planJobs = ws.jobs.filter((j) => j.bundle.job.planId === planId);
  assert(planJobs.length === 5 && ws.jobs.length === 5, 'Exactly five jobs created (double tap did not duplicate)');
  for (const e of EXPECT) {
    const j = planJobs.find((x) => x.bundle.job.planDay.dayName === e.day).bundle.job;
    assert(j.targetDate === e.date && j.platform === e.platform, `${e.day} job: ${j.targetDate} on ${j.platform}`);
  }
  const thu = planJobs.find((x) => x.bundle.job.planDay.dayName === 'Thursday').bundle;
  assert(thu.job.brief.includes(THURSDAY_ANGLE) && thu.job.planDay.angle === THURSDAY_ANGLE, 'Thursday’s job carries the edited angle');
  assert(failed === 1, 'Thursday’s caption request failed (forced)');
  let calls = await mockCalls(dp);
  assert(calls.length === 4, `Four captions generated, one failed (${calls.length} provider calls)`);
  const att = await dp.locator('[data-testid="attention"]').innerText();
  assert(/Thursday’s caption couldn’t be generated/.test(att), 'Attention: Thursday’s caption failed, retry');
  assert(/Needs a photo:.*Wednesday/.test(att) && /Add the official Nexai logo/.test(att), 'Attention: Wednesday needs a photo; official logo missing');
  assert(/\/studio$/.test(await dp.locator('[data-testid="attention"] a[aria-label="Wednesday needs a photo"]').getAttribute('href')), '“Wednesday needs a photo” links straight to its Photo layout');
  assert(/Monday’s post is ready to review/.test(att), 'Attention: Monday is ready to review');
  await dp.screenshot({ path: `${OUT}/m5-desktop-02-week.png`, fullPage: true });

  console.log('\n== Retry only Thursday ==');
  await dp.click('[data-testid="attention"] a:has-text("Thursday’s caption")');
  await dp.waitForSelector('[data-testid="error-copy"]');
  await dp.locator('button[data-retry]').dblclick();
  await dp.waitForSelector('[data-testid="panel-copy"] .ver:has-text("v1")', { timeout: 15000 });
  calls = await mockCalls(dp);
  assert(calls.length === 5 && calls.filter((c) => c.brief.includes(THURSDAY_ANGLE)).length === 1, 'Retry sent exactly one request, for Thursday only');
  ws = await workspace(dp);
  for (const j of ws.jobs) assert(j.bundle.tasks.find((t) => t.type === 'copy').versions.length === 1, `${j.bundle.job.planDay.dayName} keeps caption v1`);

  console.log('\n== Approve Monday only ==');
  await dp.click('[data-testid="plan-link"] a');
  await dp.click('[data-testid="week-day-Monday"] a:has-text("Open post")');
  await dp.click('button[data-approve]');
  await dp.waitForSelector('.approve-bar[data-status="approved"]');
  await dp.click('[data-testid="plan-link"] a');
  await dp.waitForSelector('[data-testid="week-day-Monday"] .pill-approved');
  for (const day of ['Tuesday', 'Wednesday', 'Thursday', 'Friday']) assert(await dp.locator(`[data-testid="week-day-${day}"] .pill-ready_for_review`).count() === 1, `${day} still needs its own approval`);
  ws = await workspace(dp);
  const approved = ws.jobs.filter((j) => j.bundle.job.approval).map((j) => j.bundle.job.planDay.dayName);
  assert(approved.length === 1 && approved[0] === 'Monday', 'Server: only Monday is approved');
  assert(!/Monday/.test(await dp.locator('[data-testid="attention"]').innerText()), 'Monday no longer needs attention');
  await dp.click('[data-nav="calendar"]');
  const monTitle = ws.jobs.find((j) => j.bundle.job.planDay.dayName === 'Monday').bundle.job.title;
  await dp.waitForSelector('[data-testid="cal-entry"]:visible');
  const entries = await dp.locator('[data-testid="cal-entry"]:visible').allInnerTexts();
  console.log('    calendar entries:', JSON.stringify(entries));
  assert(entries.length === 1 && entries[0].includes(monTitle.slice(0, 30)), 'Calendar shows the approved Monday post once (and nothing unapproved)');

  console.log('\n== Refresh: no duplicates, no repeated paid requests ==');
  await dp.goto(`${BASE}#/week/${planId}`);
  await dp.reload();
  await dp.waitForSelector('[data-testid="attention"]');
  await dp.waitForTimeout(3500);
  ws = await workspace(dp);
  calls = await mockCalls(dp);
  assert(ws.jobs.length === 5 && calls.length === 5, 'After refresh and reopening: still 5 jobs and 5 caption requests');
  assert(await dp.locator('button[data-confirm-plan]').count() === 0, 'A confirmed plan can’t be confirmed again');

  console.log('\n== Second signed-in browser (iPhone 13 emulation) ==');
  const phone = await browser.newContext({ ...devices['iPhone 13'] });
  // Covers a deployment without the official logo file (the "logo missing" attention item).
  await phone.route('**/assets/brand/brand.json', (r) => r.fulfill({ contentType: 'application/json', body: '{"logo": false}' }));
  const pp = await phone.newPage();
  pp.on('pageerror', (e) => errors.push(`phone: ${e.message}`));
  await signIn(pp);
  await pp.goto(`${BASE}#/agent/manager`);
  await pp.click('[data-testid="week-link"]');
  await pp.waitForSelector('[data-testid="week-days"]');
  const deskJobs = await dp.locator('[data-testid^="week-day-"]').evaluateAll((els) => els.map((e) => e.dataset.job));
  const phoneJobs = await pp.locator('[data-testid^="week-day-"]').evaluateAll((els) => els.map((e) => e.dataset.job));
  assert(JSON.stringify(deskJobs) === JSON.stringify(phoneJobs) && phoneJobs.filter(Boolean).length === 5, 'Phone shows the same five jobs');
  assert(await pp.locator('[data-testid="week-day-Monday"] .pill-approved').count() === 1 && await pp.locator('.pill-ready_for_review').count() === 4, 'Phone shows the same statuses (Monday approved, four to review)');
  await pp.screenshot({ path: `${OUT}/m5-phone-03-week.png`, fullPage: true });
  let overflow = await pp.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert(overflow <= 0, 'Week view fits the phone screen');

  console.log('\n== Phone: AI plan (mock provider), leave a day out, refresh during confirm ==');
  await pp.goto(`${BASE}#/week/new`);
  await pp.fill('#wk-start', iso(new Date(MON.getTime() + 7 * 864e5)));
  await pp.fill('#wk-brief', BRIEF);
  await pp.locator('[data-testid="ai-plan-btn"]').dblclick();
  await pp.waitForSelector('[data-testid="plan-editor"]', { timeout: 15000 });
  assert(/Mock AI plan \(test mode\)/.test(await pp.locator('[data-testid="plan-method"]').innerText()), 'AI-path plan labelled "Mock AI plan (test mode)"');
  assert((await planCalls(pp)).length === 1, 'Double-tapping "Draft with AI" made one planning request');
  await pp.screenshot({ path: `${OUT}/m5-phone-04-plan-editor.png`, fullPage: true });
  overflow = await pp.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert(overflow <= 0, 'Plan editor fits the phone screen');
  await pp.locator('[data-testid="plan-day-Wednesday"] input[type=checkbox]').uncheck();
  await pp.waitForSelector('[data-testid="plan-day-Wednesday"].left-out');
  const plan2 = /#\/week\/([a-z0-9_]+)/.exec(pp.url())[1];
  await pp.tap('button[data-confirm-plan]');
  await pp.waitForTimeout(250);
  await pp.reload(); // refresh part-way through creating the posts
  await pp.waitForSelector('[data-testid="plan-editor"], [data-testid="attention"]');
  if (await pp.locator('button[data-confirm-plan]').count()) await pp.tap('button[data-confirm-plan]');
  if (await pp.locator('button[data-finish-plan]').count()) await pp.tap('button[data-finish-plan]');
  await pp.waitForSelector('[data-testid="attention"]');
  await pp.waitForFunction(() => !document.querySelector('[data-testid="plan-incomplete"]'), null, { timeout: 15000 });
  await pp.waitForTimeout(4000);
  ws = await workspace(pp);
  const p2 = ws.jobs.filter((j) => j.bundle.job.planId === plan2);
  assert(p2.length === 4 && !p2.some((j) => j.bundle.job.planDay.dayName === 'Wednesday'), 'Second plan: 4 jobs, Wednesday left out, no duplicates after refresh');
  calls = await mockCalls(pp);
  const perJob = p2.map((j) => calls.filter((c) => c.brief === j.bundle.job.brief).length);
  assert(perJob.every((n) => n <= 1), `No caption request was repeated automatically (per post: ${perJob.join(', ')})`);
  assert(/Left out/.test(await pp.locator('[data-testid="week-day-Wednesday"]').innerText()), 'Week view marks Wednesday as left out');

  assert(errors.length === 0, `No page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  console.log('\nAll Milestone 5 checks passed.');
} finally {
  await browser.close();
  server.kill();
  await new Promise((r) => setTimeout(r, 300));
  fs.rmSync(DATA, { recursive: true, force: true });
}
