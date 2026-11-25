// Milestone 15, pass 1: copy, creative and quality review working together. The owner's private workspace (no
// simulated output) on the Supabase stand-in with jsonb key order, an Android phone, isolated provider mocks
// (QUILL_PROVIDER=mock: canned captions and a generated test pattern instead of OpenAI; nothing is charged).
//   0. Regression: the screenshot case (reactivation wording, simulated v1, empty photo slot) never gets the
//      "What building JobTrack Pro taught us" headline again.
//   A. The reactivation post: Prism's brief from caption v1, headline + scene before the request, the image made
//      for caption v1, Calibre's review with what each check was made on, preview = exported PNG, a headline-only
//      change with zero image requests, approval, one calendar entry, review reuse with no repeat requests.
//   B. A manual caption edit: the pairing is flagged, kept deliberately as a new version, fresh approval.
//   C. An older saved job with the original failure: blocked and explained by Calibre, fixed without losing
//      history or the earlier approval.
//   D. A genuine JobTrack Pro post keeps the product name; a headline-free design renders and passes.
//   E. A five-post week: headlines and scenes side by side, near-duplicates flagged, no image requests.
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { spawn, execFileSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import { startFakeSupabase } from './fake-supabase.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const { hashPassword } = require('../server/auth');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PREV = `${ROOT}design/previews`;
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`  ok  ${m}`); };

/* ---------- 0. Regression for the screenshot case ---------- */
console.log('\n== 0. The screenshot case: no unrelated JobTrack headline ==');
const repro = JSON.parse(execFileSync(process.execPath, [`${ROOT}tests/helpers/headline-repro.mjs`, ROOT, '4279'], { encoding: 'utf8' }).trim().split('\n').pop());
assert(!/JobTrack/i.test(repro.v1Text) && !/JobTrack/i.test(repro.studioHeadline) && !/JobTrack/i.test(repro.pageTitle), `Reactivation wording: job title “${repro.pageTitle}”, simulated v1 “${repro.v1Text}”, Photo layout with an empty photo slot starts with “${repro.studioHeadline}”`);
assert(/back in touch|customers/i.test(repro.studioHeadline), 'The headline Photo layout starts with comes from the post itself');

const FAKE_PORT = 4281;
const PORT = 4282;
const BASE = `http://127.0.0.1:${PORT}/`;
const PASSWORD = `pw-${crypto.randomBytes(6).toString('hex')}`;
const fake = await startFakeSupabase(FAKE_PORT);
const rec = (id) => fake.tables.hq_records.find((r) => r.kind === 'job' && r.id === id);
const task = (id, type) => rec(id).data.tasks.find((t) => t.type === type);
const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(PORT), HQ_OWNER_PASSWORD_HASH: hashPassword(PASSWORD), SUPABASE_URL: fake.url, SUPABASE_SECRET_KEY: fake.secretKey, QUILL_PROVIDER: 'mock', QUILL_MOCK_DELAY_MS: '150', NO_PROXY: '127.0.0.1,localhost' }, stdio: ['ignore', 'pipe', 'inherit'] });
let log = '';
child.stdout.on('data', (d) => { log += d; });
await new Promise((res) => { const t = setInterval(() => { if (/Shared workspace:/.test(log)) { clearInterval(t); res(); } }, 50); });

const browser = await chromium.launch();
const imageCalls = [];
const wordingCalls = [];
const refused = [];
const ctx = await browser.newContext({ ...devices['Pixel 7'], acceptDownloads: true });
const page = await ctx.newPage();
page.on('request', (r) => {
  if (/api\/prism\/image/.test(r.url())) imageCalls.push(JSON.parse(r.postData() || '{}'));
  if (/api\/review\/wording/.test(r.url())) wordingCalls.push(r.url());
});
page.on('response', async (r) => { if (r.request().method() === 'PUT' && r.status() === 422) refused.push((await r.json().catch(() => ({}))).error); });
page.on('pageerror', (e) => console.log(`  [page error] ${e.message}`));
const until = async (fn, arg, ms = 20000) => { const end = Date.now() + ms; for (;;) { if (await page.evaluate(fn, arg)) return true; if (Date.now() > end) return false; await page.waitForTimeout(150); } };
const openJob = async (id) => { await page.goto(`${BASE}#/`); await page.goto(`${BASE}#/job/${id}`); await page.waitForSelector('[data-testid="panel-graphic"]'); };
async function newPost(brief) {
  await page.goto(`${BASE}#/`);
  await page.waitForSelector('#brief-form');
  await page.fill('#brief', brief);
  await page.selectOption('#platform', 'LinkedIn');
  await page.click('#brief-form button[type=submit]');
  let id = null;
  for (let i = 0; i < 80 && !id; i++) { id = fake.tables.hq_records.find((r) => r.kind === 'job' && r.data.job.brief === brief)?.id; if (!id) await page.waitForTimeout(150); }
  await openJob(id);
  assert(await until(() => !!document.querySelector('[data-testid="caption-text"]')), `Quill’s caption arrived for “${brief.slice(0, 50)}…”`);
  return id;
}
async function review(id) {
  await page.click(`[data-run-review="${id}"]`);
  await until((j) => !document.querySelector(`[data-run-review="${j}"][disabled]`), id);
  await page.waitForTimeout(400);
  return rec(id).data.job.reviews || [];
}
/** The preview image on the page and the downloaded PNG export, compared pixel by pixel in the browser. */
async function previewMatchesExport(id, n, file) {
  const t = task(id, 'graphic');
  await page.waitForSelector(`[data-testid="panel-graphic"] img[data-photo-version="${n}"]`);
  await page.locator(`[data-testid="panel-graphic"] [data-lightbox="${t.id}:${n}"]`).first().click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.lightbox [data-download]')]);
  const path = await dl.path();
  fs.copyFileSync(path, file);
  const b64 = fs.readFileSync(path).toString('base64');
  await page.click('[data-close-lb]');
  return page.evaluate(async ({ src, b64 }) => {
    const load = (u) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = u; });
    const [a, b] = await Promise.all([load(src), load(`data:image/png;base64,${b64}`)]);
    const px = (img) => { const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, c.width, c.height).data; };
    const A = px(a), B = px(b);
    let diff = 0; for (let i = 0; i < A.length; i++) if (A[i] !== B[i]) diff++;
    return { w: b.naturalWidth, h: b.naturalHeight, same: A.length === B.length && diff === 0, diff };
  }, { src: await page.locator(`[data-testid="panel-graphic"] img[data-photo-version="${n}"]`).first().getAttribute('src'), b64 });
}
async function calendarCount(id) {
  await page.goto(`${BASE}#/calendar`);
  await page.waitForSelector('[data-testid="cal-private-note"]');
  const target = rec(id).data.job.targetDate.slice(0, 7);
  for (let i = 0; i < 24; i++) {
    const head = await page.locator('.month-nav h2').innerText();
    const want = new Date(`${target}-01T12:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    if (head === want) break;
    await page.click(new Date(`01 ${head}`) < new Date(`${target}-01T12:00:00`) ? '[data-month="1"]' : '[data-month="-1"]');
  }
  return page.locator(`.cal-grid [data-testid="cal-entry"][data-job="${id}"]`).count();
}
async function changeHeadline(id, text, { none = false } = {}) {
  const t = task(id, 'graphic');
  await page.click(`[data-testid="panel-graphic"] [data-testid="change-headline"]`);
  if (none) await page.check(`#hlnone-${t.id}`); else await page.fill(`#hl-${t.id}`, text);
  const before = task(id, 'graphic').versions.length;
  await page.click('[data-testid="headline-save"]');
  assert(await until(([j, n]) => document.querySelectorAll(`[data-testid="panel-graphic"] .hist-item`).length > n, [id, before]) || task(id, 'graphic').versions.length > before, 'Headline change saved');
  await page.waitForTimeout(300);
}

try {
  await page.goto(BASE);
  await page.fill('#ws-password', PASSWORD);
  await page.click('#signin-form button[type=submit]');
  await page.waitForSelector('#brief-form');

  /* ---------- A. The reactivation post ---------- */
  console.log('\n== A. Reactivation post: brief → headline and scene → image → review → export ==');
  const A = await newPost('LinkedIn post about what Nexai is building for businesses with past customers');
  const capA = task(A, 'copy').versions[0].content.text;
  assert(/reconnect with past customers/.test(capA) && !/Revenue Recovery|Database Reactivation/.test(capA), 'Caption v1 uses the approved public wording (mock Quill)');
  await page.click('[data-testid="generate-image"]');
  await page.waitForSelector('[data-testid="concept-form"]');
  const src = await page.locator('[data-testid="concept-source"]').innerText();
  const gA = task(A, 'graphic').id;
  const headA = await page.inputValue(`#aih-${gA}`);
  const sceneA = await page.inputValue(`#aip-${gA}`);
  const cb = await page.locator('[data-testid="creative-brief"]').evaluate((el) => el.textContent);
  assert(/caption v1/.test(src) && /by Quill/.test(src), `The headline and scene show the caption version they came from (“${src.split('.')[0]}”)`);
  assert(headA === 'Past customers, back in touch.' && !/JobTrack/.test(headA), `Headline proposal: “${headA}”`);
  assert(!/engineer|plant room|van|site visit/i.test(sceneA) && /diary|slot|reply|calendar|branded|owner/i.test(sceneA), `Scene idea suits businesses with past customers: “${sceneA}”`);
  assert(/LinkedIn/.test(cb) && /Local SMEs/.test(cb) && /reconnect with past customers/.test(cb), 'Prism’s brief shows the platform, audience, public wording and the exact caption');
  assert(imageCalls.length === 0, 'Nothing requested yet');
  await page.click('[data-testid="send-image-generate"]');
  assert(await until(() => !!document.querySelector('[data-testid="panel-graphic"] img[data-photo-version="1"]'), null, 25000), 'Graphic v1 generated and rendered');
  assert(imageCalls.length === 1 && /Caption v1:/.test(imageCalls[0].context) && /reconnect with past customers/.test(imageCalls[0].context) && imageCalls[0].prompt === sceneA, 'One image request: the scene, with the exact caption v1 as context (mock image provider)');
  let gv = task(A, 'graphic').versions[0].content;
  assert(gv.headline === headA && gv.basis?.copyVersion === 1 && !gv.noHeadline, 'Graphic v1 carries the headline shown before the request and records caption v1 as its source');
  const rvA = await review(A);
  const r1 = rvA.at(-1);
  const basis = Object.fromEntries(r1.checks.filter((c) => c.basis).map((c) => [c.id, c.basis]));
  assert(basis.headline === 'text' && basis.render === 'render' && basis.scene === 'description' && basis.pairing === 'record', `Calibre says what each check was made on: ${JSON.stringify(basis)}`);
  assert(r1.checks.find((c) => c.id === 'headline').result === 'pass' && r1.checks.find((c) => c.id === 'render').result === 'pass', 'Headline expresses the post’s point; the final render passes logo, clipping and phone readability');
  assert(/scene description only.*not the image itself/.test(r1.checks.find((c) => c.id === 'scene').detail), 'The scene check says it used the description only, not the image');
  assert(!r1.findings.some((f) => f.blocking), 'Nothing blocks approval');
  // Reusing the review for unchanged versions: no second review, no repeat requests.
  await page.click(`[data-run-review="${A}"]`);
  await page.waitForTimeout(800);
  assert((rec(A).data.job.reviews || []).length === 1, 'Running the review again on the same versions reuses it (no new review)');
  if (await page.locator('[data-testid="run-wording-review"]').count()) {
    await page.click('[data-testid="run-wording-review"]');
    await until(() => !document.querySelector('[data-testid="run-wording-review"][disabled]'));
    await page.waitForTimeout(500);
    await page.click('[data-testid="run-wording-review"]');
    await page.waitForTimeout(800);
    assert(wordingCalls.length === 1, 'The AI wording review of caption v1 is requested once and then reused');
  }
  const ex1 = await previewMatchesExport(A, 1, `${PREV}/m15-export-reactivation-v1.png`);
  assert(ex1.same && ex1.w === 1080 && ex1.h === 1350, `Preview and exported PNG are the same saved layout (1080 × 1350, ${ex1.diff} differing values)`);
  // A headline-only correction: same image, no request.
  const calls0 = imageCalls.length;
  await changeHeadline(A, 'Good customers shouldn’t go quiet.');
  gv = task(A, 'graphic').versions[1].content;
  assert(task(A, 'graphic').versions.length === 2 && gv.headline === 'Good customers shouldn’t go quiet.' && gv.photoId === task(A, 'graphic').versions[0].content.photoId && imageCalls.length === calls0, 'Headline-only change: graphic v2 reuses the same image with zero image requests');
  const ex2 = await previewMatchesExport(A, 2, `${PREV}/m15-export-reactivation-v2.png`);
  assert(ex2.same, 'Graphic v2 preview and export match');
  await review(A);
  await page.click(`[data-approve="${A}"]`);
  await page.waitForSelector('[data-testid="destination-panel"]');
  assert(rec(A).data.job.approval.graphicVersion === 2, 'Approved caption v1 + graphic v2');
  assert(await calendarCount(A) === 1, 'One calendar entry');

  /* ---------- B. A manual caption edit ---------- */
  console.log('\n== B. Manual caption edit: pairing, fresh approval ==');
  await openJob(A);
  const cA = task(A, 'copy').id;
  await page.click(`[data-toggle-edit="${cA}"]`);
  await page.fill(`#ed-${cA}`, `${capA.split('\n\n')[1]}\n\nWe’d love to hear how you keep in touch with customers once the job is done.`);
  await page.click(`[data-edit-form="${cA}"] button[type=submit]`);
  await page.waitForSelector('[data-testid="pairing-notice"]');
  assert(/made for caption v1; the caption is now v2/.test(await page.locator('[data-testid="pairing-notice"]').innerText()), 'The owner’s edit is caption v2; the graphic is flagged as made for caption v1');
  assert(/Approve changed pair/.test(await page.locator(`[data-approve="${A}"]`).innerText()), 'The revision needs fresh approval');
  await page.click('[data-testid="generate-image"]');
  assert(/caption v2/.test(await page.locator('[data-testid="concept-source"]').innerText()) && /edited by you/.test(await page.locator('[data-testid="concept-source"]').innerText()), 'Prism’s brief now works from caption v2, edited by you');
  await page.click(`[data-ai-image-form="${gA}|generate"] [data-ai-image-open]`);
  await page.click('[data-testid="keep-pairing"]');
  assert(await until(() => !document.querySelector('[data-testid="pairing-notice"]')), 'Keeping the graphic for caption v2 is saved as a new version');
  assert(task(A, 'graphic').versions.at(-1).content.basis.copyVersion === 2 && task(A, 'graphic').versions.length === 3, 'Graphic v3 (same image) is linked to caption v2; v1 and v2 unchanged');
  await page.click(`[data-approve="${A}"]`);
  await page.waitForSelector('[data-testid="destination-panel"]');
  const apA = rec(A).data.job.approvals;
  assert(apA.length === 2 && apA[0].copyVersion === 1 && apA[1].copyVersion === 2 && apA[1].graphicVersion === 3, 'Fresh approval of caption v2 + graphic v3; the first approval is kept');
  assert(await calendarCount(A) === 1, 'Still one calendar entry');

  /* ---------- C. An older saved job with the original failure ---------- */
  console.log('\n== C. Older saved job: the original failure, caught and corrected ==');
  const OLD = 'job_m15oldreactivate';
  const t0 = Date.now() - 86400000;
  const caption = 'Something we’re working on at Nexai right now, and why.\n\nWe’re working on a simple way for local businesses to get back in touch with customers they’ve served before, so a good job leads to the next one.\n\nIf you’re dealing with the same thing, tell us in the comments how you handle it.';
  const G = await import('../app/js/generators.js');
  const bundle = {
    job: { id: OLD, brief: 'We’re building a simple way for local businesses to get back in touch with customers they’ve served before', platform: 'LinkedIn', targetDate: '2026-12-11', createdAt: t0, delegatedAt: t0, taskIds: { copy: 'task_m15oldc', graphic: 'task_m15oldg' }, approval: { copyVersion: 1, graphicVersion: 1, at: t0 + 10 }, approvals: [{ copyVersion: 1, graphicVersion: 1, at: t0 + 10 }] },
    tasks: [
      { id: 'task_m15oldc', jobId: OLD, agent: 'copywriter', type: 'copy', instruction: 'x', createdAt: t0, versions: [{ n: 1, content: { text: caption, opts: null }, notes: [], feedback: null, by: 'Quill', simulated: false, source: 'openai', model: 'gpt-test', createdAt: t0 }], pending: null },
      { id: 'task_m15oldg', jobId: OLD, agent: 'designer', type: 'graphic', instruction: 'x', createdAt: t0, pending: null, versions: [
        { n: 1, content: { ...G.draftGraphic({ id: OLD, brief: 'lessons from building JobTrack Pro', platform: 'LinkedIn' }).content }, notes: ['Simulated'], feedback: null, by: 'Prism', simulated: true, source: 'demo', createdAt: t0 },
        { n: 2, content: { mode: 'photo', photoId: null, photoName: null, logoId: 'brand:nexai-logo.png', logoName: 'Official Nexai Digital logo', headline: 'What building JobTrack Pro taught us.', headlinePos: 'bottom', crop: { zoom: 1, fx: 0.5, fy: 0.5 }, logoScale: 1 }, notes: ['Photo layout'], feedback: null, by: 'You with Prism', simulated: false, source: 'photo', createdAt: t0 + 5 },
      ] },
    ],
    log: [],
  };
  assert((await page.request.put(`${BASE}api/workspace/jobs/${OLD}`, { data: { baseRev: 0, bundle } })).ok(), 'Seeded the older job as an older client saved it (simulated v1, Photo layout v2 with the JobTrack headline and an empty photo slot)');
  await openJob(OLD);
  const bar = await page.locator('[data-testid="approve-bar"]').innerText();
  assert(/Correct this before approving/.test(bar) && /JobTrack Pro/.test(bar) && /photo slot is empty/.test(bar) && await page.locator(`[data-approve="${OLD}"]`).isDisabled(), 'Approval is held: the headline names JobTrack Pro, which this post isn’t about, and the photo slot is empty');
  const rvC = await review(OLD);
  const fC = rvC.at(-1).findings;
  const hf = fC.find((f) => f.check === 'headline' && f.blocking);
  const pf = fC.find((f) => f.check === 'render' && /photo slot is empty/.test(f.title));
  assert(hf && /isn’t about/.test(hf.title) && /never mentions JobTrack Pro/.test(hf.why) && /Get back in touch|customers/i.test(hf.fix), `Calibre’s finding: “${hf?.title}”. Why: ${hf?.why} Fix: ${hf?.fix}`);
  assert(pf && pf.blocking, 'Calibre flags the empty photo slot on the final render');
  await page.locator('[data-testid="review-panel"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${PREV}/m15-calibre-finding-phone.png`, fullPage: false });
  await page.locator('[data-testid="finding-headline"]').first().screenshot({ path: `${PREV}/m15-calibre-finding-headline.png` });
  const calls1 = imageCalls.length;
  const fixed = 'Get back in touch with past customers.';
  await changeHeadline(OLD, fixed);
  assert(imageCalls.length === calls1 && task(OLD, 'graphic').versions.at(-1).content.headline === fixed, 'Headline corrected as graphic v3 with zero image requests');
  assert(await page.locator(`[data-approve="${OLD}"]`).isDisabled() && /photo slot is empty/.test(await page.locator('[data-testid="approve-bar"]').innerText()), 'The missing image still has to be fixed before approval');
  await page.click('[data-testid="generate-image"]');
  assert(await page.inputValue(`#aih-task_m15oldg`) !== 'What building JobTrack Pro taught us.', 'The proposal never offers the old headline back');
  await page.fill('#aih-task_m15oldg', fixed);
  await page.click('[data-testid="send-image-generate"]');
  assert(await until(() => !!document.querySelector('[data-testid="panel-graphic"] img[data-photo-version="4"]'), null, 25000), 'Graphic v4: the image is added');
  await review(OLD);
  assert(!rec(OLD).data.job.reviews.at(-1).findings.some((f) => f.blocking) && !(await page.locator(`[data-approve="${OLD}"]`).isDisabled()), 'Calibre’s new review has nothing blocking; approval opens');
  const exC = await previewMatchesExport(OLD, 4, `${PREV}/m15-export-corrected.png`);
  assert(exC.same, 'The corrected graphic’s preview and exported PNG match');
  await page.click(`[data-approve="${OLD}"]`);
  await page.waitForSelector('[data-testid="destination-panel"]');
  const oj = rec(OLD).data;
  assert(oj.job.approvals.length === 2 && oj.job.approvals[0].graphicVersion === 1 && oj.job.approval.graphicVersion === 4 && oj.tasks.find((t) => t.type === 'graphic').versions.length === 4 && oj.tasks.find((t) => t.type === 'graphic').versions[1].content.headline === 'What building JobTrack Pro taught us.', 'History kept: the earlier approval, simulated v1 and the original v2 are unchanged; the fresh approval names v4');
  assert(await calendarCount(OLD) === 1, 'One calendar entry for the older job');

  /* ---------- D. A genuine JobTrack Pro post ---------- */
  console.log('\n== D. A genuine JobTrack Pro post, and a headline-free design ==');
  const D = await newPost('LinkedIn post about lessons from building JobTrack Pro for maintenance teams');
  assert(/JobTrack Pro/.test(task(D, 'copy').versions[0].content.text), 'The caption is about JobTrack Pro');
  await page.click('[data-testid="generate-image"]');
  const gD = task(D, 'graphic').id;
  await page.fill(`#aih-${gD}`, 'What building JobTrack Pro taught us.');
  const sceneD = await page.inputValue(`#aip-${gD}`);
  await page.click('[data-testid="send-image-generate"]');
  assert(await until(() => !!document.querySelector('[data-testid="panel-graphic"] img[data-photo-version="1"]'), null, 25000), 'Graphic v1 generated');
  const rD = (await review(D)).at(-1);
  assert(rD.checks.find((c) => c.id === 'headline').result === 'pass' && !rD.findings.some((f) => f.check === 'headline'), 'On a post that is about JobTrack Pro, the product name in the headline passes');
  assert(/engineer|plant room|site|office|tablet/i.test(sceneD), `Field-work scenes are proposed when the post is about field work (“${sceneD.slice(0, 70)}…”)`);
  const callsD = imageCalls.length;
  await changeHeadline(D, '', { none: true });
  const gvD = task(D, 'graphic').versions.at(-1).content;
  assert(gvD.noHeadline === true && imageCalls.length === callsD, 'A headline-free design is saved as v2, same image, no request');
  const exD = await previewMatchesExport(D, 2, `${PREV}/m15-export-no-headline.png`);
  const rD2 = (await review(D)).at(-1);
  assert(exD.same && /no headline by design/.test(rD2.checks.find((c) => c.id === 'render').detail) && rD2.checks.find((c) => c.id === 'headline').result === 'pass', 'It renders without a headline (preview = export) and Calibre treats it as intentional');

  /* ---------- E. A five-post week ---------- */
  console.log('\n== E. A five-post week: headlines and scenes side by side ==');
  const callsE = imageCalls.length;
  await page.goto(`${BASE}#/week/new`);
  await page.waitForSelector('#week-form');
  await page.fill('#wk-brief', 'Plan a week about what we are building for businesses with past customers, and getting finished jobs invoiced');
  await page.click('button:has-text("Create template plan")');
  await page.waitForSelector('[data-testid="plan-editor"]');
  await page.click('button[data-confirm-plan]');
  await page.waitForSelector('[data-testid="concept-board"]', { timeout: 30000 });
  assert(await until(() => document.querySelectorAll('[data-testid="concept-row"]').length === 5), 'The week shows five headlines and scene ideas together');
  await page.waitForTimeout(2500); // captions arrive; proposals follow them
  await page.goto(`${BASE}#/`);
  await page.goBack();
  await page.waitForSelector('[data-testid="concept-board"]');
  const rows = await page.locator('[data-testid="concept-row"]').evaluateAll((els) => els.map((el) => ({ day: el.dataset.day, headline: el.querySelector('[data-testid="wk-headline"]').value, scene: el.querySelector('[data-testid="wk-scene"]').value, dup: !!el.querySelector('[data-testid="dup-flag"]') })));
  fs.writeFileSync(`${PREV}/m15-week-concepts.json`, JSON.stringify(rows, null, 2));
  console.log(rows.map((r) => `      ${r.day}: “${r.headline}” | ${r.scene.slice(0, 80)}${r.dup ? '  [near-duplicate]' : ''}`).join('\n'));
  assert(rows.every((r) => r.headline && r.scene), 'Every day has a headline and a scene idea');
  assert(!/engineer|plant room|van|site visit/i.test(rows[0].scene), 'Monday (reactivation) has no engineer scene');
  const shotBoard = async (file) => { const b = page.locator('[data-testid="concept-board"]'); await b.scrollIntoViewIfNeeded(); await page.waitForTimeout(300); const box = await b.boundingBox(); const sy = await page.evaluate(() => scrollY); await page.screenshot({ path: file, fullPage: true, clip: { ...box, y: box.y + sy } }); };
  await shotBoard(`${PREV}/m15-week-concepts-before.png`);
  assert(!rows.some((r) => r.dup), 'Proposed headlines and scenes are varied across the week: no near-duplicates before your edits');
  // Make Wednesday a near-duplicate of Monday, save, and see it flagged.
  const wed = page.locator('[data-testid="concept-row"]').nth(2);
  await wed.locator('[data-testid="wk-headline"]').fill(rows[0].headline);
  await page.click('[data-testid="save-concepts"]');
  assert(await until(() => document.querySelectorAll('[data-testid="dup-flag"]').length >= 2), 'Saving a repeated headline flags both posts as near-duplicates');
  await shotBoard(`${PREV}/m15-week-concepts-flagged.png`);
  await page.locator('[data-testid="concept-row"]').nth(2).locator('[data-testid="wk-headline"]').fill('One list, one hour, fewer jobs stuck at the finish.');
  await page.click('[data-testid="save-concepts"]');
  assert(await until(() => !document.querySelector('[data-testid="concept-row"][data-day="Wednesday"] [data-testid="dup-flag"]')), 'Changing it clears the flag');
  assert(imageCalls.length === callsE, 'No image requests while planning and editing the week’s concepts');

  assert(!refused.length, `No save was refused${refused.length ? `: ${refused.join(' | ')}` : ''}`);
  console.log('\nMilestone 15 creative checks passed.');
} finally {
  await browser.close();
  child.kill();
  await fake.close();
}
