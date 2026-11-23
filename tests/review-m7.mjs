// Milestone 7 acceptance: business profile + Brand & Quality Reviewer, through the real UI.
// Test workspace on :4181 with a fixed test date (HQ_TEST_DATE=2026-12-01), owner password and mock captions.
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA = path.join(ROOT, 'tests', '.tmp-m7-data');
fs.rmSync(DATA, { recursive: true, force: true });
process.env.HQ_DATA_DIR = DATA;
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const { hashPassword } = require('../server/auth');

const PORT = 4181;
const BASE = `http://127.0.0.1:${PORT}/`;
const PREV = path.join(ROOT, 'design', 'previews');
const PHOTO = path.join(ROOT, 'tests', 'fixtures', 'TEST-ASSET-rooftop-hvac-synthetic.jpg');
const LOGO = path.join(ROOT, 'tests', 'fixtures', 'TEST-ASSET-nexai-logo-not-official.png');
const PASSWORD = `test-owner-${crypto.randomBytes(6).toString('hex')}`;
const OFFER = 'Book a Free Workflow Review before 31 December 2026 and get a written action plan within 5 working days.';
fs.mkdirSync(PREV, { recursive: true });
const clean = (page, on) => page.evaluate((v) => { let st = document.getElementById('shot-style'); if (v && !st) { st = document.createElement('style'); st.id = 'shot-style'; st.textContent = '.topbar, .approve-bar, #toast { visibility: hidden !important; }'; document.head.append(st); } if (!v && st) st.remove(); }, on);
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`  ok  ${m}`); };

const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), HQ_DATA_DIR: DATA, HQ_OWNER_PASSWORD_HASH: hashPassword(PASSWORD), HQ_TEST_DATE: '2026-12-01', QUILL_PROVIDER: 'mock', QUILL_MOCK_DELAY_MS: '400', OPENAI_API_KEY: '' }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((res) => { let o = ''; server.stdout.on('data', (d) => { o += d; if (/Shared workspace: on/.test(o)) res(); }); });

const ws = (page) => page.evaluate(async () => (await fetch('api/workspace')).json());
const jobOf = async (page, id) => (await ws(page)).jobs.find((j) => j.id === id).bundle;
async function waitDraw(page, prev) {
  await page.waitForFunction((p) => { const c = document.querySelector('#studio-canvas'); return c && c.dataset.rendered && c.dataset.rendered !== p; }, prev ?? '', { timeout: 15000 });
  await page.waitForTimeout(150);
  return page.locator('#studio-canvas').getAttribute('data-rendered');
}
async function newJob(page, brief, date) {
  await page.goto(`${BASE}#/`);
  await page.fill('#brief', brief);
  await page.fill('#targetDate', date);
  await page.click('button:has-text("Send brief to Vektor")');
  await page.locator('.job-row').first().click();
  await page.waitForSelector('[data-testid="panel-copy"] .caption-text', { timeout: 15000 });
  await page.waitForSelector('[data-testid="panel-graphic"] .graphic-btn', { timeout: 15000 });
  return /#\/job\/([a-z0-9_]+)/.exec(page.url())[1];
}
async function photoLayout(page, withLogo) {
  await page.click('[data-testid="panel-graphic"] a:has-text("Open Photo layout")');
  let r = await waitDraw(page);
  await page.setInputFiles('[data-testid="photo-input"]', PHOTO);
  r = await waitDraw(page, r);
  if (withLogo) { await page.setInputFiles('[data-testid="logo-input"]', LOGO); r = await waitDraw(page, r); }
  await page.fill('#st-headline', 'Job finished. Invoice still waiting.');
  await waitDraw(page, r);
  await page.click('#st-save');
  await page.waitForSelector('[data-testid="panel-graphic"] img[data-photo-version="2"]');
}

const browser = await chromium.launch();
try {
  console.log('\n== Desktop: business profile ==');
  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const dp = await desk.newPage();
  const errors = [];
  dp.on('pageerror', (e) => errors.push(`desktop: ${e.message}`));
  await dp.goto(`${BASE}#/workspace`);
  await dp.fill('#ws-password', PASSWORD);
  await dp.click('#signin-form button[type=submit]');
  await dp.waitForSelector('text=You’re signed in');
  await dp.goto(`${BASE}#/`);
  assert(/Test date in use: 1 December 2026/.test(await dp.locator('[data-testid="test-date"]').innerText()), 'Fixed test date shown (1 December 2026)');
  await dp.click('[data-testid="profile-link"]');
  await dp.waitForSelector('#profile-form');
  const meta1 = await dp.locator('[data-testid="profile-meta"]').innerText();
  assert(/Version 1 · pv1-[0-9a-f]{6} · saved/.test(meta1), `Profile shows version, identifier and save time (${meta1.split(' · saved')[0]})`);
  const form = await dp.locator('#profile-form').evaluate((f) => [...f.querySelectorAll('input, textarea')].map((e) => e.value).join(' | '));
  for (const s of ['Professional Websites', 'Custom Business Software', 'Bespoke AI Agents & Automation', 'UK commercial building maintenance and building services firms', 'Ideally 30–75 employees', 'Owners, MDs and Operations Directors', 'JobTrack Pro', 'Club Operations', 'Request a Free Workflow Review', 'British English']) assert(form.includes(s), `Seeded: ${s}`);
  assert(/No offers yet/.test(await dp.locator('[data-testid="offers"]').innerText()), 'Offers start empty');
  assert(/Winner’s Writing Process and Self-review checklist/.test(await dp.locator('[data-testid="missing-wording"]').innerText()) && (await dp.locator('.missing-tag').count()) === 2, 'Missing Winner’s Writing Process and checklist clearly marked');
  await dp.click('[data-testid="add-offer"]');
  await dp.fill('#pf-offers-0-wording', OFFER);
  await dp.fill('#pf-offers-0-start', '2026-12-01');
  await dp.fill('#pf-offers-0-end', '2026-12-31');
  await dp.waitForSelector('[data-testid="offer-0"] .offer-status:has-text("Live on 1 December 2026")');
  await dp.click('[data-testid="save-profile"]');
  await dp.waitForSelector('[data-testid="profile-saved"]');
  const v2 = /pv2-[0-9a-f]{6}/.exec(await dp.locator('[data-testid="profile-meta"]').innerText())[0];
  assert(/Changed: Offers/.test(await dp.locator('[data-testid="profile-saved"]').innerText()), `Offer saved as ${v2}`);

  console.log('\n== Separate approved post (never mentions the offer) ==');
  const jobB = await newJob(dp, 'Create a LinkedIn post for operations directors about job sheets that never come back from site.', '2026-12-03');
  await photoLayout(dp, true);
  await dp.click('button[data-approve]');
  await dp.waitForSelector('.approve-bar[data-status="approved"]');
  const approvalB = (await jobOf(dp, jobB)).job.approval;
  assert(approvalB.copyVersion === 1 && approvalB.graphicVersion === 2, 'Post B approved (caption v1 + graphic v2)');

  console.log('\n== LinkedIn draft quoting the offer ==');
  const jobA = await newJob(dp, 'Create a LinkedIn post for UK maintenance directors about invoicing delays and mention our current offer.', '2026-12-04');
  const capA1 = await dp.locator('[data-testid="panel-copy"] .caption-text').first().innerText();
  assert(capA1.includes(OFFER), 'Quill’s draft (mock provider) quotes the offer exactly from the profile');
  await photoLayout(dp, false); // reuses the official logo saved with post B
  let bA = await jobOf(dp, jobA);
  const cA = bA.tasks.find((t) => t.type === 'copy').versions[0];
  const gA = bA.tasks.find((t) => t.type === 'graphic').versions;
  assert(cA.profileVersion === v2 && gA[1].profileVersion === v2 && bA.job.profileVersion === v2, `Caption, graphic and job record profile ${v2}`);
  assert(/business profile/i.test(gA[0].notes.join(' ')), 'Prism’s visual brief notes use the profile’s imagery rule');
  const graphicSrcBefore = await dp.locator('[data-testid="panel-graphic"] .graphic-out .graphic-btn img').getAttribute('alt');

  console.log('\n== Phone (iPhone 13 emulation): sign in, edit profile via visible controls ==');
  const phone = await browser.newContext({ ...devices['iPhone 13'] });
  const pp = await phone.newPage();
  pp.on('pageerror', (e) => errors.push(`phone: ${e.message}`));
  await pp.goto(BASE);
  await pp.waitForSelector('.agent-card.char-manager');
  await pp.tap('[data-testid="ws-inline"]');
  await pp.fill('#ws-password', PASSWORD);
  await pp.tap('#signin-form button[type=submit]');
  await pp.waitForSelector('text=You’re signed in');
  await pp.tap('[data-nav="hq"]');
  await pp.waitForSelector('[data-testid="profile-link"]');
  await pp.tap('[data-testid="profile-link"]');
  await pp.waitForSelector('#pf-offers-0-end');
  await pp.fill('#pf-offers-0-end', '2026-11-30');
  await pp.waitForSelector('[data-testid="offer-0"] .offer-status:has-text("ended on 30 November 2026")');
  await pp.screenshot({ path: path.join(PREV, 'm7-phone-profile.jpg'), type: 'jpeg', quality: 85 });
  await pp.tap('[data-testid="save-profile"]');
  await pp.waitForSelector('[data-testid="profile-saved"]');
  const v3 = /pv3-[0-9a-f]{6}/.exec(await pp.locator('[data-testid="profile-meta"]').innerText())[0];
  const affected = await pp.locator('[data-testid="affected-posts"]').innerText();
  assert(/invoicing delays/i.test(affected) || affected.includes('Finished jobs'), `Phone: offer expired as ${v3}; the offer post is listed as affected`);
  assert(!(await pp.locator(`[data-testid="affected-posts"] a[href="#/job/${jobB}"]`).count()), 'Post B (no offer) is not listed as affected');
  assert(/ended on 30 November 2026/.test(affected), 'Affected-post note explains which field changed and how');
  await pp.tap(`[data-testid="affected-posts"] a[href="#/job/${jobA}"]`);
  await pp.waitForSelector('[data-testid="profile-impact"]');
  await pp.tap('[data-testid="job-profile"] a');
  await pp.waitForSelector('[data-testid="back-to-post"]');
  await pp.tap('[data-testid="back-to-post"]');
  await pp.waitForSelector('[data-testid="panel-copy"]');
  assert(pp.url().endsWith(`#/job/${jobA}`), 'Phone: from the post to the profile and straight back to the post');
  const overflow = await pp.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert(overflow <= 0, 'No sideways scrolling on the phone');

  console.log('\n== Desktop: run the Reviewer against the latest profile ==');
  await dp.goto(`${BASE}#/job/${jobA}`);
  await dp.reload();
  await dp.waitForSelector('[data-testid="profile-impact"]');
  assert(/Offers:.*ended on 30 November 2026/s.test(await dp.locator('[data-testid="profile-impact"]').innerText()), 'Post shows the profile change that affects it');
  await dp.click('button[data-run-review]');
  await dp.waitForSelector('[data-testid="review-1"]');
  const meta = await dp.locator('[data-testid="review-1"] [data-testid="review-meta"]').innerText();
  assert(meta.includes('caption v1') && meta.includes('graphic v2') && meta.includes(`profile ${v3}`), `Review records exact versions: ${meta.split(' · offers')[0]}`);
  const finding = dp.locator('[data-testid="finding-offers"]');
  const ftext = await finding.innerText();
  assert(ftext.includes(OFFER) && /Caption v1, paragraph 3/.test(ftext) && /ended on 30 November 2026/.test(ftext) && ftext.includes(v3) && /Quill/.test(ftext), 'Finding: what (the offer line), where (caption v1, paragraph 3), why (ended 30 Nov, profile), who (Quill)');
  assert((await dp.locator('[data-testid="panel-copy"] mark.flagged').innerText()).includes(OFFER), 'The offending caption line is highlighted');
  assert(/ran automatically, \d need you/.test(await dp.locator('[data-testid="review-1"] .checks summary').innerText()) && /Rule.*Owner.*You/s.test(await dp.locator('[data-testid="review-1"] .checks').textContent()), 'Checks labelled: which ran automatically and which need you');
  assert(await dp.locator('[data-testid="finding-visual"] img').count() === 1, 'Visual judgement shows the graphic for human inspection');
  await finding.scrollIntoViewIfNeeded();
  await clean(dp, true);
  await dp.locator('[data-testid="review-panel"]').screenshot({ path: path.join(PREV, 'm7-expired-offer-finding.jpg'), type: 'jpeg', quality: 85 });
  await clean(dp, false);
  await dp.click('[data-testid="finding-offers"] button:has-text("Send to Quill")');
  const fb = await dp.locator('[data-testid="panel-copy"] textarea').inputValue();
  assert(fb.includes('Remove the expired offer wording') && fb.includes(OFFER), 'Finding routed to Quill’s revision form with the fix filled in');
  await dp.click('[data-testid="panel-copy"] button:has-text("Send to Quill")');
  await dp.waitForSelector('[data-testid="panel-copy"] .ver:has-text("v2")', { timeout: 15000 });
  const capA2 = await dp.locator('[data-testid="panel-copy"] .caption-text').first().innerText();
  assert(!capA2.includes(OFFER) && capA2.includes('What’s the one thing'), 'Quill revised only the offending line');
  assert((await dp.locator('[data-testid="panel-graphic"] h2').innerText()).trim() === 'Graphic v2' && (await dp.locator('[data-testid="panel-graphic"] .graphic-out .graphic-btn img').getAttribute('alt')) === graphicSrcBefore, 'Graphic untouched (still v2)');
  assert(/caption changed from v1 to v2/.test(await dp.locator('[data-testid="review-outdated"]').innerText()), 'Earlier review marked outdated, kept for the record');
  await dp.click('button[data-run-review]');
  await dp.waitForSelector('[data-testid="review-2"]');
  const r2 = await dp.locator('[data-testid="review-2"]').innerText();
  assert(/caption v2/.test(r2) && !(await dp.locator('[data-testid="review-2"] [data-testid="finding-offers"]').count()) && /Offer wording is current: Passed/.test(await dp.locator('[data-testid="review-2"] .checks').textContent()), 'Re-review: offer check passes on caption v2');
  assert(await dp.locator('[data-testid="review-state"]').innerText() === 'No problems found', 'Review status: no problems found');
  assert(/Earlier reviews \(1\)/.test(await dp.locator('[data-testid="review-panel"]').innerText()), 'Review history keeps review #1');
  await clean(dp, true);
  await dp.locator('[data-testid="review-panel"]').screenshot({ path: path.join(PREV, 'm7-finding-resolved.jpg'), type: 'jpeg', quality: 85 });
  await clean(dp, false);
  await dp.click('button[data-approve]');
  await dp.waitForSelector('.approve-bar[data-status="approved"]');
  bA = await jobOf(dp, jobA);
  assert(bA.job.approval.copyVersion === 2 && bA.job.approval.graphicVersion === 2, 'You approve corrected caption v2 with the original graphic v2');
  assert((bA.job.reviews || []).length === 2 && bA.job.reviews[0].profileVersion === v3, 'Both reviews stored on the server with their profile version');

  console.log('\n== Post B kept its approval ==');
  const bB = await jobOf(dp, jobB);
  assert(JSON.stringify(bB.job.approval) === JSON.stringify(approvalB), 'Post B’s approval is unchanged');
  await dp.goto(`${BASE}#/job/${jobB}`);
  await dp.waitForSelector('.approve-bar[data-status="approved"]');
  assert(!(await dp.locator('[data-testid="profile-impact"]').count()), 'Post B shows no profile-change notice');

  console.log('\n== Reviewer workspace ==');
  await dp.goto(`${BASE}#/agent/reviewer`);
  await dp.waitForSelector('.sheet .size-hero');
  const sheet = await dp.locator('.sheet').innerText();
  assert(/Calibre/.test(sheet) && /Brand & Quality Reviewer/.test(sheet) && (sheet.match(/review #\d/g) || []).length === 2, 'Reviewer workspace shows character, role and review history');
  await dp.keyboard.press('Escape');

  console.log('\n== Older posts still open intact ==');
  const old = JSON.parse(JSON.stringify(bB));
  const oldId = 'job_legacy01';
  old.job = { ...old.job, id: oldId, title: 'Legacy post from before the profile', taskIds: { copy: 'task_legacyc', graphic: 'task_legacyg' }, reviews: undefined, approval: null, approvals: [] };
  delete old.job.profileVersion;
  old.tasks = old.tasks.map((t) => ({ ...t, id: t.type === 'copy' ? 'task_legacyc' : 'task_legacyg', jobId: oldId, versions: t.versions.map(({ profileVersion, ...v }) => v) }));
  old.log = [];
  const put = await dp.evaluate(async ([id, b]) => (await fetch(`api/workspace/jobs/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseRev: 0, bundle: b }) })).status, [oldId, old]);
  assert(put === 200, 'Pre-profile job stored');
  await dp.goto(`${BASE}#/job/${oldId}`);
  await dp.reload();
  await dp.waitForSelector('[data-testid="job-profile"]');
  assert(/created before the business profile/.test(await dp.locator('[data-testid="job-profile"]').innerText()) && (await dp.locator('[data-testid="panel-copy"] .caption-text').first().innerText()) === old.tasks.find((t) => t.type === 'copy').versions[0].content.text, 'Older post opens with its original content and no profile version');

  console.log('\n== Plans use the profile (template + mock AI) ==');
  await dp.goto(`${BASE}#/week/new`);
  await dp.fill('#wk-brief', 'Plan a week about completed jobs the office still can’t invoice. Cover missing engineer photos, incomplete job sheets and delayed client sign-off.');
  await dp.click('button:has-text("Create template plan")');
  await dp.waitForSelector('[data-testid="plan-editor"]');
  assert((await dp.inputValue('#pd-aud-0')).includes('Owners, MDs and Operations Directors') && /official Nexai logo/.test(await dp.inputValue('#pd-vis-0')), 'Template plan takes audience and visual rules from the profile');
  const plans = (await ws(dp)).plans;
  assert(plans[0].plan.profileVersion === v3, `Plan records profile ${v3}`);

  await dp.goto(`${BASE}#/week/new`);
  await dp.fill('#wk-brief', 'Plan a week about completed jobs the office still can’t invoice.');
  await dp.click('[data-testid="ai-plan-btn"]');
  await dp.waitForSelector('[data-testid="plan-method"]:has-text("Mock AI plan")');
  assert((await dp.inputValue('#pd-aud-0')).includes('Owners, MDs and Operations Directors') && /official Nexai logo/i.test(await dp.inputValue('#pd-vis-0')), 'Mock AI plan receives and uses the profile');
  assert((await ws(dp)).plans.every((p) => p.plan.profileVersion === v3), 'Mock AI plan records the profile version too');

  console.log('\n== Previews ==');
  await dp.goto(`${BASE}#/`);
  await dp.waitForSelector('.agent-card.char-reviewer');
  await dp.waitForTimeout(600);
  await dp.screenshot({ path: path.join(PREV, 'm7-desktop-hq.jpg'), type: 'jpeg', quality: 85 });
  await pp.goto(`${BASE}#/`);
  await pp.waitForSelector('.agent-card.char-reviewer');
  await pp.waitForTimeout(600);
  await pp.screenshot({ path: path.join(PREV, 'm7-phone-hq.jpg'), type: 'jpeg', quality: 85, fullPage: true });
  await pp.locator('.agent-card.char-reviewer').tap();
  await pp.waitForSelector('.sheet .size-hero');
  await pp.waitForTimeout(500);
  await pp.screenshot({ path: path.join(PREV, 'm7-phone-reviewer-workspace.jpg'), type: 'jpeg', quality: 85 });
  assert(true, 'Saved desktop and phone previews');

  assert(errors.length === 0, `No page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  console.log('\nAll Milestone 7 checks passed.');
} finally {
  await browser.close();
  server.kill();
  await new Promise((r) => setTimeout(r, 300));
  fs.rmSync(DATA, { recursive: true, force: true });
}
