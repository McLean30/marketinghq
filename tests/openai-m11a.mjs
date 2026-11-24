// Milestone 11A: the six-agent HQ on OpenAI, end to end in the browser against a local stub of the OpenAI API
// (dummy key, OPENAI_BASE_URL; no network, no cost). Shared workspace with owner sign-in on :4198, stub on :4199.
//   1. Gate: a signed-out visitor sees demo mode and can't trigger a paid call
//   2. Quill: one caption call per post, even with a second device open; "Live AI · gpt-6-luna" label
//   3. Prism: Generate image (double tap = one call), logo/headline/crop in Photo layout (no call), Edit image (one call)
//   4. Caption revision keeps the same image; a failed request keeps the work and retries once
//   5. Usage and estimated cost per job; Calibre AI wording review; Vektor AI plan waits for confirmation;
//      Cue's script from gpt-6-luna with a template fallback after a failure
//   6. Nothing is approved, published or scheduled; phone and desktop previews
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { spawn } from 'child_process';
import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TMP = path.join(ROOT, 'tests', '.tmp-m11a');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const { hashPassword } = require('../server/auth');
const { mockPng } = require('../server/mock-image');

const PORT = 4198;
const STUB = 4199;
const BASE = `http://127.0.0.1:${PORT}/`;
const KEY = 'sk-dummy-m11a-not-real';
const PASSWORD = `test-owner-${crypto.randomBytes(6).toString('hex')}`;
const PREVIEWS = path.join(ROOT, 'design', 'previews');
const LOGO = path.join(ROOT, 'tests', 'fixtures', 'TEST-ASSET-nexai-logo-not-official.png');
const BRIEF = 'LinkedIn post for UK facilities directors about planning PPM visits so engineers arrive with the right parts.';
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`  ok  ${m}`); };

/* ---------- OpenAI stub ---------- */
const calls = [];
let mode = 'ok';
const count = (re) => calls.filter((c) => re.test(c.url)).length;
const textUsage = { input_tokens: 2000, input_tokens_details: { cached_tokens: 0 }, output_tokens: 400, output_tokens_details: { reasoning_tokens: 150 }, total_tokens: 2400 };
const stub = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const b = JSON.parse(body || '{}');
    calls.push({ url: req.url, body: b });
    const send = (status, obj) => setTimeout(() => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); }, 250);
    if (mode === 'down') return send(500, { error: { message: 'server error' } });
    if (req.url.startsWith('/v1/images/')) {
      const edit = req.url.endsWith('edits');
      return send(200, { created: 1, data: [{ b64_json: mockPng(edit ? 'edited' : 'generated', 400, 600).toString('base64') }], usage: { input_tokens: edit ? 900 : 60, input_tokens_details: { text_tokens: 60, image_tokens: edit ? 840 : 0 }, output_tokens: 1200, output_tokens_details: { image_tokens: 1200 }, total_tokens: edit ? 2100 : 1260 } });
    }
    const out = (obj) => send(200, { id: `resp_${calls.length}`, status: 'completed', model: b.model, output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(obj) }] }], usage: textUsage });
    const name = b.text?.format?.name;
    if (name === 'vektor_week_plan') return out({ days: Array.from({ length: 5 }, (_, i) => ({ audience: `Facilities directors ${i}`, angle: `Live angle ${i}`, takeaway: `Takeaway ${i}`, visual: `Engineer with parts trolley ${i}` })) });
    if (name === 'cue_storyboard') return out({ scenes: [1, 2, 3].map((i) => ({ title: `Live scene ${i}`, duration: 6, from: (i - 1) * 5, caption: `Live on-screen ${i}`, script: `Voice ${i}` })), notes: 'Stub script.' });
    if (name === 'calibre_wording') return out({ summary: 'Reads naturally in British English.', suggestions: [] });
    const rev = /Feedback|feedback/.test(b.input || '') && /Current caption/i.test(b.input || '');
    return out({ caption: rev ? 'Shorter live caption about PPM visits.\n\nWhat would change if every engineer arrived with the right parts?\n\n#FacilitiesManagement #PPM #NexaiDigital' : 'Live caption about PPM visits for facilities directors.\n\nPlanning the parts before the van leaves saves a second visit.\n\n#FacilitiesManagement #PPM #NexaiDigital', notes: rev ? 'Shortened.' : 'First draft.' });
  });
});
await new Promise((r) => stub.listen(STUB, '127.0.0.1', r));

const server = spawn(process.execPath, ['server.js'], {
  cwd: ROOT,
  env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(PORT), HQ_DATA_DIR: path.join(TMP, 'data'), HQ_OWNER_PASSWORD_HASH: hashPassword(PASSWORD), HQ_TEST_FIXTURES: '1', HQ_SCHEDULER_MS: '0', OPENAI_API_KEY: KEY, OPENAI_BASE_URL: `http://127.0.0.1:${STUB}/v1`, NO_PROXY: '127.0.0.1,localhost' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
let serverLog = '';
await new Promise((res) => server.stdout.on('data', (d) => { serverLog += d; if (/Shared workspace: on/.test(serverLog)) res(); }));

async function signIn(page) {
  await page.goto(`${BASE}#/workspace`);
  await page.waitForSelector('#ws-password, [data-signout]');
  if (!(await page.locator('[data-signout]').count())) {
    await page.fill('#ws-password', PASSWORD);
    await page.click('#signin-form button[type=submit]');
  }
  await page.waitForFunction(() => document.getElementById('ws-pill')?.textContent === 'Shared workspace');
}
const bundle = (page, id) => page.evaluate(async (id) => (await (await fetch('api/workspace', { cache: 'no-store' })).json()).jobs.find((j) => j.id === id)?.bundle, id);
async function until(page, id, fn, what, timeout = 20000) {
  const end = Date.now() + timeout;
  for (;;) {
    const b = await bundle(page, id);
    if (b && fn(b)) return b;
    if (Date.now() > end) throw new Error(`FAIL: timed out waiting for ${what}`);
    await page.waitForTimeout(250);
  }
}
const task = (b, type) => b.tasks.find((t) => t.type === type);

const browser = await chromium.launch();
const errors = [];
try {
  console.log('\n== 1. Signed-out visitor: sign-in screen only, no paid calls ==');
  const anon = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const ap = await anon.newPage();
  ap.on('pageerror', (e) => errors.push(`anon: ${e.message}`));
  await ap.goto(BASE);
  // Milestone 14: the private workspace shows only the owner sign-in screen until someone signs in.
  await ap.waitForSelector('[data-testid="gate-signin"]');
  assert(!(await ap.locator('[data-testid="quill-mode"], .agent-card').count()), 'A signed-out visitor sees only the owner sign-in screen');
  const r = await ap.evaluate(async () => (await fetch('api/quill/caption', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestKey: 'anon:probe:0001', kind: 'draft', brief: 'A brief long enough to pass validation.', platform: 'LinkedIn' }) })).status);
  assert(r === 401 && calls.length === 0, 'A signed-out caption request is refused (401); OpenAI was never called');
  await anon.close();

  console.log('\n== 2. Quill: one live caption per post ==');
  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const dp = await desk.newPage();
  dp.on('pageerror', (e) => errors.push(`desktop: ${e.message}`));
  await signIn(dp);
  const phoneCtx = await browser.newContext({ ...devices['iPhone 13'] });
  const pp = await phoneCtx.newPage();
  pp.on('pageerror', (e) => errors.push(`phone: ${e.message}`));
  await signIn(pp);
  await dp.goto(`${BASE}#/`);
  await dp.waitForSelector('[data-testid="quill-mode"].live');
  assert(/gpt-6-luna/.test(await dp.textContent('[data-testid="quill-mode"]')) && /gpt-image-2\.6-flare/.test(await dp.textContent('[data-testid="quill-mode"]')), 'Signed-in owner sees live AI with gpt-6-luna and gpt-image-2.6-flare');
  await pp.goto(`${BASE}#/`); // a second device watching the same workspace
  await dp.selectOption('#format', 'image');
  await dp.fill('#brief', BRIEF);
  await dp.selectOption('#platform', 'LinkedIn');
  await dp.click('#brief-form button[type=submit]');
  const jobId = await dp.evaluate(async (b) => { for (let i = 0; i < 80; i++) { const r = await fetch('api/workspace', { cache: 'no-store' }); const e = (await r.json()).jobs.find((x) => x.bundle.job.brief === b); if (e) return e.id; await new Promise((r2) => setTimeout(r2, 200)); } return null; }, BRIEF);
  let b = await until(dp, jobId, (x) => task(x, 'copy').versions.length === 1 && task(x, 'graphic').versions.length === 1, 'caption v1 and graphic v1');
  await dp.waitForTimeout(1500); // give the phone every chance to send a duplicate
  const cap1 = task(b, 'copy').versions[0];
  assert(count(/responses/) === 1, 'Exactly one OpenAI caption request, with two devices open');
  assert(cap1.source === 'openai' && cap1.model === 'gpt-6-luna' && cap1.simulated === false && cap1.usage?.totalTokens === 2400, 'Caption v1 recorded as live, gpt-6-luna, with its token usage');
  assert(/British English/.test(calls[0].body.instructions) && /soft|Soft/.test(calls[0].body.input + calls[0].body.instructions), 'The request carries the saved editorial voice (British English, soft CTA)');
  await dp.goto(`${BASE}#/job/${jobId}`);
  await dp.waitForSelector('[data-testid="panel-copy"] [data-source="openai"]');
  assert(/Live AI · gpt-6-luna/.test(await dp.textContent('[data-testid="panel-copy"] [data-testid="source-tag"]')), 'Caption labelled “Live AI · gpt-6-luna”');
  assert((await dp.textContent('[data-testid="panel-graphic"] .graphic-out')).includes('Simulated demo output'), 'Prism’s first graphic is the labelled simulated template (no image charge yet)');

  console.log('\n== 3. Prism: generate, lay out (free), edit ==');
  const gTask = task(b, 'graphic').id;
  await dp.click('[data-testid="generate-image"]');
  const prefill = await dp.inputValue(`#aip-${gTask}`);
  assert(prefill.length > 10, `Generate image opens with the selected scene filled in (“${prefill.slice(0, 50)}…”)`);
  await dp.evaluate(() => { const f = document.querySelector('[data-ai-image-form]'); f.requestSubmit(); f.requestSubmit(); }); // double tap
  b = await until(dp, jobId, (x) => task(x, 'graphic').versions.length === 2, 'AI image graphic v2');
  await dp.waitForTimeout(800);
  const g2 = task(b, 'graphic').versions[1];
  assert(count(/images\/generations/) === 1, 'Double tap on Generate: one image request');
  assert(g2.content.mode === 'photo' && g2.content.photoOrigin === 'ai' && g2.content.generated.model === 'gpt-image-2.6-flare' && g2.source === 'openai' && g2.usage?.imageOutputTokens === 1200, 'Graphic v2: live AI image from gpt-image-2.6-flare with usage');
  await dp.waitForSelector('[data-testid="panel-graphic"] [data-source="openai"]');
  assert(/Live AI image · gpt-image-2\.6-flare/.test(await dp.textContent('[data-testid="panel-graphic"] [data-testid="source-tag"]')), 'Graphic labelled “Live AI image · gpt-image-2.6-flare”');
  await dp.screenshot({ path: `${PREVIEWS}/m11a-desktop-job.png`, fullPage: false });
  // Photo layout: official logo, headline, crop. All local.
  await dp.click('[data-testid="panel-graphic"] [data-testid="upload-photo"]');
  await dp.waitForSelector('#studio-canvas');
  assert((await dp.textContent('[data-testid="photo-name"]')).startsWith('generated-'), 'Photo layout opens on the generated image');
  await dp.setInputFiles('#st-logo', LOGO);
  await dp.waitForFunction(() => /nexai-logo/.test(document.querySelector('[data-testid="logo-name"]')?.textContent || ''));
  await dp.fill('#st-headline', 'Right parts, first visit.');
  await dp.locator('#st-zoom').fill('140');
  await dp.click('input[name="st-pos"][value="top"]', { force: true });
  await dp.click('#st-save');
  b = await until(dp, jobId, (x) => task(x, 'graphic').versions.length === 3, 'graphic v3 (layout)');
  const g3 = task(b, 'graphic').versions[2];
  assert(count(/images\//) === 1, 'Logo, headline, crop and position changes made no image request');
  assert(g3.content.photoId === g2.content.photoId && g3.content.photoOrigin === 'ai' && g3.source === 'photo' && g3.content.headline === 'Right parts, first visit.' && g3.content.crop.zoom === 1.4, 'Graphic v3 keeps the same AI image with your layout');
  await dp.waitForSelector('[data-testid="panel-graphic"] [data-testid="source-tag"]');
  assert(/layout owner-edited/.test(await dp.textContent('[data-testid="panel-graphic"] [data-testid="source-tag"]')), 'Labelled “Live AI image · gpt-image-2.6-flare · layout owner-edited”');
  await dp.click('[data-testid="edit-image"]');
  await dp.fill(`#aip-${gTask}`, 'Make it early morning light; keep the engineer and the parts trolley.');
  await dp.click('[data-testid="send-image-edit"]');
  b = await until(dp, jobId, (x) => task(x, 'graphic').versions.length === 4, 'edited image v4');
  const g4 = task(b, 'graphic').versions[3];
  const editReq = calls.find((c) => /images\/edits/.test(c.url));
  assert(count(/images\/edits/) === 1 && editReq.body.model === 'gpt-image-2.6-flare' && /^data:image\//.test(editReq.body.images[0].image_url), 'Edit image: one /images/edits request with the current image');
  assert(g4.content.photoId !== g3.content.photoId && g4.content.headline === 'Right parts, first visit.' && g4.content.logoId === g3.content.logoId && g4.feedback?.startsWith('Make it early morning'), 'Graphic v4: edited image; your headline and logo carried over; edit instruction kept');

  console.log('\n== 4. Caption revision keeps the image; failures keep the work ==');
  const cTask = task(b, 'copy').id;
  await dp.click(`[data-toggle-rev="${cTask}"]`);
  await dp.fill(`#fb-${cTask}`, 'Make it shorter and end on a question.');
  await dp.evaluate((id) => { const f = document.querySelector(`[data-rev-form="${id}"]`); f.requestSubmit(); f.requestSubmit(); }, cTask);
  b = await until(dp, jobId, (x) => task(x, 'copy').versions.length === 2, 'caption v2');
  await dp.waitForTimeout(600);
  assert(count(/responses/) === 2, 'Double tap on the revision: one OpenAI request');
  const c2 = task(b, 'copy').versions[1];
  assert(c2.source === 'openai' && c2.feedback === 'Make it shorter and end on a question.' && task(b, 'graphic').versions.length === 4 && task(b, 'graphic').versions[3].content.photoId === g4.content.photoId, 'Caption v2 is live; the graphic is still v4 with the same image');
  mode = 'down';
  await dp.click(`[data-toggle-rev="${cTask}"]`);
  await dp.fill(`#fb-${cTask}`, 'Mention the van stock check.');
  await dp.click(`[data-rev-form="${cTask}"] button[type=submit]`);
  await dp.waitForSelector('[data-testid="error-copy"]');
  const errText = await dp.textContent('[data-testid="error-copy"]');
  assert(/OpenAI returned an error \(500\)/.test(errText) && /Mention the van stock check/.test(errText), 'A failed request shows a useful error and keeps your feedback');
  b = await bundle(dp, jobId);
  assert(task(b, 'copy').versions.length === 2 && task(b, 'graphic').versions.length === 4, 'Caption v2 and graphic v4 are untouched');
  mode = 'ok';
  const before = count(/responses/);
  await dp.click(`[data-retry="${cTask}"]`);
  b = await until(dp, jobId, (x) => task(x, 'copy').versions.length === 3, 'caption v3 after retry');
  assert(count(/responses/) === before + 1, 'Retry: one new request (failures aren’t charged twice or cached)');

  console.log('\n== 5. Usage, Calibre, Vektor, Cue ==');
  await dp.goto(`${BASE}#/job/${jobId}`);
  await dp.waitForSelector('[data-testid="ai-usage"]');
  await dp.waitForFunction(() => document.querySelectorAll('[data-testid="usage-row"]').length === 5, null, { timeout: 10000 }).catch(() => {});
  const usageRows = await dp.$$eval('[data-testid="usage-row"]', (rows) => rows.map((r) => r.textContent));
  assert(usageRows.length === 5 && usageRows.some((t) => /^Image edit/.test(t)) && usageRows.some((t) => /^Caption revision/.test(t)) && usageRows.every((t) => /\$/.test(t)), `Usage panel: ${usageRows.length} paid requests (captions, revisions, image, image edit), each with an estimated cost`);
  b = await bundle(dp, jobId);
  const total = b.job.aiUsage.reduce((a, u) => a + u.estCostUsd, 0);
  const summary = await dp.textContent('[data-testid="ai-usage"] summary');
  assert(summary.includes(`$${total.toFixed(3)}`), `Usage total matches the recorded estimates (${summary.trim()})`);
  await dp.click(`[data-run-review="${jobId}"]`);
  await dp.waitForSelector('[data-testid="run-wording-review"]:not([disabled])');
  const beforeWr = count(/responses/);
  await dp.click('[data-testid="run-wording-review"]');
  await dp.waitForSelector('[data-testid="wording-result"]');
  assert(count(/responses/) === beforeWr + 1 && /Live AI · gpt-6-luna/.test(await dp.textContent('[data-testid="wording-result"]')), 'Calibre: rule checks still run; the optional AI wording review makes one labelled request');
  // Vektor: an AI plan waits for your confirmation.
  await dp.goto(`${BASE}#/week/new`);
  await dp.waitForSelector('#week-form');
  await dp.fill('#wk-brief', 'A week on planned maintenance for facilities directors: fewer second visits, parts ready, clear reports.');
  const jobsBefore = (await dp.evaluate(async () => (await (await fetch('api/workspace')).json()).jobs.length));
  await dp.click('[data-testid="ai-plan-btn"]');
  await dp.waitForSelector('[data-testid="plan-method"].ai');
  assert(/Live AI: drafted by gpt-6-luna/.test(await dp.textContent('[data-testid="plan-method"]')) && /Live angle 2/.test(await dp.textContent('main')), 'Vektor: editable plan from gpt-6-luna');
  assert((await dp.evaluate(async () => (await (await fetch('api/workspace')).json()).jobs.length)) === jobsBefore, 'Nothing delegated until you confirm the plan');
  // Cue: script from gpt-6-luna; after a failure, a template fallback.
  await dp.goto(`${BASE}#/`);
  await dp.selectOption('#format', 'video');
  await dp.click('[data-testid="use-sample-clip"]');
  await dp.waitForSelector('[data-testid="clip-ok"]');
  await dp.fill('#brief', 'Twenty-second walkthrough of an engineer checking parts before a PPM visit.');
  await dp.click('#brief-form button[type=submit]');
  const vJob = await dp.evaluate(async () => { for (let i = 0; i < 80; i++) { const e = (await (await fetch('api/workspace', { cache: 'no-store' })).json()).jobs.find((x) => x.bundle.tasks.some((t) => t.type === 'video')); if (e) return e.id; await new Promise((r) => setTimeout(r, 200)); } return null; });
  b = await until(dp, vJob, (x) => !!task(x, 'video').draft, 'Cue storyboard');
  assert(task(b, 'video').draft.source === 'openai' && task(b, 'video').draft.scenes[0].title === 'Live scene 1' && calls.some((c) => c.body.text?.format?.name === 'cue_storyboard'), 'Cue: script and storyboard from gpt-6-luna');
  await dp.goto(`${BASE}#/job/${vJob}`);
  await dp.reload(); // either device may have sent the request; load the latest shared state
  await dp.waitForSelector('[data-testid="storyboard-source"]', { timeout: 20000 });
  assert(/AI script and storyboard \(live, gpt-6-luna\)/.test(await dp.textContent('[data-testid="storyboard-source"]')), 'Storyboard labelled as live AI; editing and rendering stay in the video editor');
  mode = 'down';
  await dp.goto(`${BASE}#/`);
  await dp.selectOption('#format', 'video');
  await dp.click('[data-testid="use-sample-clip"]');
  await dp.waitForSelector('[data-testid="clip-ok"]');
  const VB2 = 'Short reel showing an engineer labelling parts bags for tomorrow’s PPM visits.';
  await dp.fill('#brief', VB2);
  await dp.click('#brief-form button[type=submit]');
  const vJob2 = await dp.evaluate(async (bb) => { for (let i = 0; i < 80; i++) { const e = (await (await fetch('api/workspace', { cache: 'no-store' })).json()).jobs.find((x) => x.bundle.job.brief === bb); if (e) return e.id; await new Promise((r) => setTimeout(r, 200)); } return null; }, VB2);
  await until(dp, vJob2, (x) => !!task(x, 'video').pending?.error, 'Cue script error');
  mode = 'ok';
  await dp.goto(`${BASE}#/job/${vJob2}`);
  await dp.reload(); // the phone may have sent this request; load the latest shared state
  await dp.waitForSelector('[data-testid="error-video"]', { timeout: 20000 });
  assert(/OpenAI returned an error/.test(await dp.textContent('[data-testid="error-video"]')), 'Cue: a failed script request shows the error; brief and clip kept');
  await dp.click('[data-use-template]');
  b = await until(dp, vJob2, (x) => !!task(x, 'video').draft && !task(x, 'video').pending, 'template storyboard');
  assert(!task(b, 'video').draft.source && /template/i.test(task(b, 'video').draft.label), 'Cue: “Use the template storyboard instead” gives the labelled template (no charge)');

  console.log('\n== 6. Waiting for your review ==');
  b = await bundle(dp, jobId);
  assert(!b.job.approval && !(b.job.publications || []).length, 'The job is not approved, published or scheduled');
  assert(!serverLog.includes(KEY), 'The server log never contains the key');
  const html = await dp.content();
  assert(!html.includes(KEY), 'The page never contains the key');
  await pp.goto(`${BASE}#/job/${jobId}`);
  await pp.waitForSelector('[data-testid="ai-usage"]');
  await pp.waitForTimeout(800);
  await pp.screenshot({ path: `${PREVIEWS}/m11a-phone-job.png`, fullPage: true });
  assert(errors.length === 0, `No page errors${errors.length ? `: ${errors.join('; ')}` : ''}`);
  console.log('\nMilestone 11A browser checks passed.');
} finally {
  await browser.close();
  server.kill();
  stub.close();
}
