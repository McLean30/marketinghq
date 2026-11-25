// Milestone 16: owner controls. An isolated signed-in test workspace on the Supabase stand-in (jsonb key order),
// the real hosted worker code as the cron (supabase/functions/hq-scheduler/worker.js), a desktop and an Android phone
// (two devices), demo destinations only (HQ_TEST_FIXTURES) and isolated mocks: nothing reaches a real account.
//   A. Archive a completed week that also has a future scheduled post: the scheduled post stays active; restore one.
//   B. Download an older graphic version on the phone: matches its preview, zero AI or image requests.
//   C. Schedule a demo post two minutes ahead, cancel it from the second device, wait past its time: no receipt.
//      A stale tap or save from the first device can't send or recreate it. A cancel racing the worker settles once.
//   D. Cancel and delete post: delivery cancelled first, then the post removed.
//   E. Delete permanently: shared media and the brand logo survive, the post's own media go, the week keeps a
//      "deleted" day that's never recreated, a stale save can't bring it back, published posts are explained.
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import { startFakeSupabase } from './fake-supabase.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const { hashPassword } = require('../server/auth');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PB = await import('../app/js/publishing.js');
const { runScheduler } = await import('../supabase/functions/hq-scheduler/worker.js');
const PREV = `${ROOT}design/previews`;
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`  ok  ${m}`); };

const FAKE_PORT = 4301;
const PORT = 4302;
const BASE = `http://127.0.0.1:${PORT}/`;
const PASSWORD = `pw-${crypto.randomBytes(6).toString('hex')}`;
const fake = await startFakeSupabase(FAKE_PORT);
fake.tables.hq_scheduler_workspaces.push({ workspace: 'main', enabled: true });
const worker = () => runScheduler({ url: fake.url, key: fake.secretKey });
const rec = (id) => fake.tables.hq_records.find((r) => r.kind === 'job' && r.id === id);
const receipts = () => fake.tables.hq_records.filter((r) => r.kind === 'post');
const pubOf = (id) => (rec(id).data.job.publications || []).at(-1);
const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(PORT), HQ_OWNER_PASSWORD_HASH: hashPassword(PASSWORD), HQ_TEST_FIXTURES: '1', SUPABASE_URL: fake.url, SUPABASE_SECRET_KEY: fake.secretKey, QUILL_PROVIDER: 'mock', QUILL_MOCK_DELAY_MS: '150', NO_PROXY: '127.0.0.1,localhost' }, stdio: ['ignore', 'pipe', 'inherit'] });
let log = '';
child.stdout.on('data', (d) => { log += d; });
await new Promise((res) => { const t = setInterval(() => { if (/Shared workspace:/.test(log)) { clearInterval(t); res(); } }, 50); });

const browser = await chromium.launch();
const aiCalls = [];
const errors = [];
async function device(opts, label) {
  const ctx = await browser.newContext({ ...opts, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('request', (r) => { if (/api\/(prism|quill|review|vektor|video|analyst)\//.test(r.url())) aiCalls.push(`${label} ${r.url().split('/api/')[1]}`); });
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  await page.goto(BASE);
  await page.fill('#ws-password', PASSWORD);
  await page.click('#signin-form button[type=submit]');
  await page.waitForSelector('#brief-form');
  return page;
}
const until = async (page, fn, arg, ms = 25000) => { const end = Date.now() + ms; for (;;) { if (await page.evaluate(fn, arg)) return true; if (Date.now() > end) return false; await page.waitForTimeout(200); } };
const open = async (page, hash) => { await page.goto(`${BASE}#/`); await page.goto(`${BASE}${hash}`); };
async function approve(page, id) {
  await open(page, `#/job/${id}`);
  await page.waitForSelector(`[data-approve="${id}"]:not([disabled])`, { timeout: 30000 });
  await page.click(`[data-approve="${id}"]`);
  await page.waitForSelector('[data-testid="publish-panel"]');
}
async function schedule(page, id, ms) {
  const lp = PB.londonParts(ms);
  await open(page, `#/job/${id}`);
  await page.click('[data-testid="publish-panel"] [data-testid="schedule"]');
  await page.fill(`#pt-date-${id}`, lp.date);
  await page.fill(`#pt-time-${id}`, lp.time);
  await page.locator(`#pt-time-${id}`).dispatchEvent('change');
  await page.click(`[data-pub-time="${id}"] button[type=submit]`);
  await page.waitForSelector('[data-testid="publish-confirm"]');
  await page.click('[data-testid="confirm-publish"]');
  await page.waitForSelector('[data-testid="pub-card"][data-status="scheduled"]', { timeout: 20000 });
  return pubOf(id);
}
async function toMonth(page, ym) {
  await page.waitForSelector('.month-nav h2');
  for (let i = 0; i < 24; i++) {
    const head = await page.locator('.month-nav h2').innerText();
    const want = new Date(`${ym}-01T12:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    if (head === want) return;
    await page.click(new Date(`01 ${head}`) < new Date(`${ym}-01T12:00:00`) ? '[data-month="1"]' : '[data-month="-1"]');
  }
}
async function newPost(page, brief) {
  await open(page, '#/');
  await page.fill('#brief', brief);
  await page.selectOption('#platform', 'LinkedIn');
  await page.click('#brief-form button[type=submit]');
  let id = null;
  for (let i = 0; i < 100 && !id; i++) { id = fake.tables.hq_records.find((r) => r.kind === 'job' && r.data.job?.brief === brief)?.id; if (!id) await page.waitForTimeout(150); }
  for (let i = 0; i < 150; i++) { const b = rec(id).data; if (b.tasks.every((t) => t.versions.length && !t.pending)) break; await page.waitForTimeout(200); }
  return id;
}

try {
  const desk = await device({ viewport: { width: 1360, height: 900 } }, 'desktop');
  const phone = await device(devices['Pixel 7'], 'phone');

  /* ---------- A. Archive a completed week ---------- */
  console.log('\n== A. Archive a completed week; the scheduled post stays active; restore one ==');
  await open(desk, '#/week/new');
  await desk.waitForSelector('#week-form');
  await desk.fill('#wk-brief', 'Plan a week for facilities managers about job sheets, photos and sign-off');
  await desk.click('button:has-text("Create template plan")');
  await desk.waitForSelector('[data-testid="plan-editor"]');
  await desk.click('button[data-confirm-plan]');
  await desk.waitForSelector('[data-testid="week-days"]', { timeout: 30000 });
  const planId = /#\/week\/([a-z0-9_]+)/.exec(desk.url())[1];
  const plan = () => fake.tables.hq_records.find((r) => r.kind === 'plan' && r.id === planId).data;
  const weekJobs = plan().days.map((d) => d.jobId);
  for (let i = 0; i < 150; i++) { if (weekJobs.every((id) => rec(id)?.data.tasks.every((t) => t.versions.length && !t.pending))) break; await desk.waitForTimeout(200); }
  for (const id of weekJobs) await approve(desk, id);
  const FRI = weekJobs[4];
  const friPub = await schedule(desk, FRI, Date.now() + 3 * 864e5);
  assert(friPub.status === 'scheduled', `Friday’s post is scheduled for ${PB.fmtLondon(friPub.scheduledFor)}`);
  await open(desk, `#/week/${planId}`);
  await desk.waitForSelector('[data-testid="week-archive"]');
  const wtext = await desk.locator('[data-testid="week-archive"]').innerText();
  assert(/4 completed posts can be archived/.test(wtext) && /1 scheduled post will stay active/.test(wtext), 'The week shows how many will move (4) and that the scheduled one stays');
  await desk.click('[data-testid="week-archive-btn"]');
  assert(/4 posts will move to Archived/.test(await desk.locator('[data-testid="week-archive-confirm"]').innerText()), 'Confirmation: 4 posts will move');
  await desk.click('[data-testid="week-archive-confirm-btn"]');
  await desk.waitForSelector('[data-testid="week-archive-result"]');
  assert(/Archived 4 completed posts\. Skipped 1 scheduled post/.test(await desk.locator('[data-testid="week-archive-result"]').innerText()), 'Result: archived 4, skipped 1 scheduled');
  assert(weekJobs.slice(0, 4).every((id) => rec(id).data.job.archived) && !rec(FRI).data.job.archived && pubOf(FRI).status === 'scheduled', 'Monday–Thursday archived; Friday (scheduled) stays active and scheduled');
  assert(weekJobs.slice(0, 4).every((id) => rec(id).data.job.approvals.length === 1 && rec(id).data.tasks.every((t) => t.versions.length)), 'Archived posts keep their versions and approvals');
  await open(desk, '#/');
  const hqIds = await desk.locator('.job-list a.job-row').evaluateAll((els) => els.map((a) => a.getAttribute('href').split('/')[2]));
  assert(!weekJobs.slice(0, 4).some((id) => hqIds.includes(id)) && hqIds.includes(FRI), 'Archived posts leave the HQ list; the scheduled one is still there');
  await open(desk, '#/agent/copywriter');
  await desk.waitForTimeout(500);
  const sheet = await desk.locator('.sheet').innerText();
  assert(!weekJobs.slice(0, 4).some((id) => sheet.includes(rec(id).data.job.title)), 'Archived posts leave Quill’s task list');
  await open(phone, '#/archived');
  await phone.waitForSelector('[data-testid="archived-list"]');
  assert(await phone.locator('[data-testid="archived-row"]').count() === 4, 'Archived view (phone) lists the 4 posts');
  await phone.screenshot({ path: `${PREV}/m16-phone-archived.png` });
  const RESTORE = weekJobs[1];
  await phone.click(`[data-testid="archived-row"][data-job="${RESTORE}"] [data-testid="restore"]`);
  assert(await until(phone, (id) => !document.querySelector(`[data-testid="archived-row"][data-job="${id}"]`), RESTORE), 'Restore (phone) takes it out of Archived');
  assert(!rec(RESTORE).data.job.archived && rec(RESTORE).data.job.approvals.length === 1, 'Restored with its approval intact');
  await open(phone, '#/');
  assert(await phone.locator(`.job-list a[href="#/job/${RESTORE}"]`).count() === 1, 'Restored post is back in the HQ list');

  /* ---------- B. Download an older graphic version on the phone ---------- */
  console.log('\n== B. Download an older version on the phone: same as its preview, zero AI calls ==');
  const DL = await newPost(phone, 'LinkedIn post for operations directors about engineers capturing sign-off on site');
  await open(phone, `#/job/${DL}`);
  const gDL = rec(DL).data.tasks.find((t) => t.type === 'graphic').id;
  await phone.click('[data-testid="generate-image"]');
  await phone.click('[data-testid="send-image-generate"]');
  assert(await until(phone, () => !!document.querySelector('[data-testid="panel-graphic"] .graphic-out img[data-photo-version]')), 'An image is generated (mock) as a Photo layout version');
  const photoN = rec(DL).data.tasks.find((t) => t.type === 'graphic').versions.length;
  await phone.click('[data-testid="change-headline"]');
  await phone.fill(`#hl-${gDL}`, 'Signed off before the van leaves.');
  await phone.click('[data-testid="headline-save"]');
  assert(await until(phone, (n) => document.querySelectorAll('[data-testid="panel-graphic"] .hist-item').length > n, photoN), `Graphic v${photoN + 1} saved; v${photoN} is now an older version`);
  await phone.locator('[data-testid="panel-graphic"] details.hist-wrap').evaluate((d) => { d.open = true; });
  await phone.locator(`[data-testid="panel-graphic"] details[data-key="h-${gDL}-${photoN}"]`).evaluate((d) => { d.open = true; });
  await phone.waitForSelector(`[data-testid="panel-graphic"] details[data-key="h-${gDL}-${photoN}"] img[data-photo-version="${photoN}"]`);
  const before = aiCalls.length;
  const btn = phone.locator(`[data-testid="panel-graphic"] [data-download="${gDL}:${photoN}"]`).first();
  assert(await btn.isVisible() && (await btn.innerText()).includes(`v${photoN}`), `“Download v${photoN}” sits beside the older version`);
  const [dl] = await Promise.all([phone.waitForEvent('download'), btn.click()]);
  const file = await dl.path();
  const name = dl.suggestedFilename();
  fs.copyFileSync(file, `${PREV}/m16-download-older-version.png`);
  const same = await phone.evaluate(async ({ src, b64 }) => {
    const load = (u) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = u; });
    const [a, b] = await Promise.all([load(src), load(`data:image/png;base64,${b64}`)]);
    const px = (img) => { const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, c.width, c.height).data; };
    const A = px(a), B = px(b); let d = 0; for (let i = 0; i < A.length; i++) if (A[i] !== B[i]) d++;
    return { d, w: b.naturalWidth, h: b.naturalHeight, len: A.length === B.length };
  }, { src: await phone.locator(`[data-testid="panel-graphic"] details[data-key="h-${gDL}-${photoN}"] img[data-photo-version="${photoN}"]`).getAttribute('src'), b64: fs.readFileSync(file).toString('base64') });
  assert(same.len && same.d === 0 && same.w === 1080 && same.h === 1350, `The download is exactly v${photoN}’s preview (1080 × 1350, ${same.d} differing values), with its crop, headline and logo`);
  assert(/^nexai-.*sign-off.*-graphic-v\d+-1080x1350\.png$/.test(name) && name.includes(`graphic-v${photoN}`), `Filename names the post and version: ${name}`);
  assert(aiCalls.length === before, 'Zero AI or image requests to download');
  await open(phone, `#/job/${DL}/studio`);
  await phone.waitForSelector('.studio-dl [data-testid="download-image"]');
  assert(/Download saved graphic v\d/.test(await phone.locator('.studio-dl [data-testid="download-image"]').innerText()), 'Prism’s Photo layout has Download image for the saved version');
  assert(!rec(DL).data.job.approval, 'No approval needed to download');

  /* ---------- C. Schedule two minutes ahead, cancel from the second device ---------- */
  console.log('\n== C. Schedule 2 minutes ahead on the desktop, cancel on the phone, wait past the time ==');
  const C = RESTORE; // approved (restored) post
  const due = Math.ceil((Date.now() + 120000) / 60000) * 60000;
  const cp = await schedule(desk, C, due);
  assert(cp.status === 'scheduled' && cp.scheduledFor === due, `Desktop scheduled it for ${PB.fmtLondon(due)} (two minutes ahead)`);
  await open(phone, '#/calendar');
  await phone.waitForSelector(`.agenda [data-testid="cal-entry"][data-job="${C}"]`);
  assert(await phone.locator(`.agenda [data-testid="cal-entry"][data-job="${C}"]`).first().getAttribute('data-cal-state') === 'scheduled', 'The phone’s calendar shows it scheduled');
  assert(await phone.locator(`.agenda-item:has([data-job="${C}"]) [data-testid="download-image"]`).count() === 1, 'The calendar preview has a Download image button');
  await phone.locator(`.agenda [data-testid="cal-entry"][data-job="${C}"]`).first().click();
  await phone.waitForSelector('[data-testid="cancel-schedule"]');
  await phone.locator('[data-testid="job-menu"] summary').click();
  assert((await phone.locator('[data-testid="job-menu"] [data-testid="download-image"]').innerText()).includes(`graphic v${cp.graphicVersion}`), `On a scheduled post, Download image defaults to the scheduled version (graphic v${cp.graphicVersion})`);
  assert(await phone.locator('[data-testid="pub-preview"] [data-testid="download-image"]').count() >= 1, 'The scheduled post’s preview has a Download image button');
  await phone.locator('[data-testid="job-menu"] summary').click();
  await phone.click('[data-testid="cancel-schedule"]');
  const dest = await phone.locator('[data-testid="cancel-destination"]').innerText();
  const when = await phone.locator('[data-testid="cancel-when"]').innerText();
  assert(dest.includes(rec(C).data.job.platform) && when.includes(PB.londonParts(due).time) && /G?MT|BST/.test(when), `Before confirming: destination “${dest}”, scheduled “${when}”`);
  await phone.screenshot({ path: `${PREV}/m16-phone-cancel-confirm.png` });
  await phone.click('[data-testid="cancel-confirm-btn"]');
  await phone.waitForSelector('[data-testid="cancel-result"]');
  assert(/Schedule cancelled/.test(await phone.locator('[data-testid="cancel-result"]').innerText()) && pubOf(C).status === 'cancelled', 'Phone: the server confirmed the cancellation before success was shown');
  // The desktop still shows it scheduled: a second tap there is harmless.
  await desk.waitForSelector('[data-testid="cancel-schedule"]').catch(() => {});
  if (await desk.locator('[data-testid="cancel-schedule"]').count()) {
    await desk.click('[data-testid="cancel-schedule"]');
    await desk.click('[data-testid="cancel-confirm-btn"]');
    await desk.waitForSelector('[data-testid="cancel-result"]');
    assert(/already/.test(await desk.locator('[data-testid="cancel-result"]').innerText()), 'Desktop (stale) tap: the server says it was already cancelled');
  }
  const stale = JSON.parse(JSON.stringify(rec(C).data));
  stale.job.publications.at(-1).status = 'scheduled';
  const r409 = await desk.request.put(`${BASE}api/workspace/jobs/${C}`, { data: { baseRev: rec(C).rev - 1, bundle: stale } });
  assert(r409.status() === 409, 'A stale save from the other device can’t put the schedule back (409)');
  const pubC = pubOf(C).id;
  const waitMs = due + 15000 - Date.now();
  console.log(`      waiting ${Math.round(waitMs / 1000)} s until past ${PB.fmtLondon(due)}…`);
  await desk.waitForTimeout(Math.max(0, waitMs));
  await worker(); await worker();
  assert(!receipts().some((r) => r.id === pubC) && pubOf(C).status === 'cancelled', 'Past its time, after two worker runs: no delivery receipt, still cancelled');
  assert(!rec(C).data.job.archived && !rec(C).data.deleted, 'The post is still active');
  await open(desk, `#/job/${C}`);
  assert(await desk.locator('[data-testid="publish-panel"] [data-testid="schedule"]').count() === 1, 'It can be scheduled again');
  await open(phone, '#/calendar');
  await toMonth(phone, rec(C).data.job.targetDate.slice(0, 7));
  await phone.waitForSelector(`.agenda [data-testid="cal-entry"][data-job="${C}"]`);
  assert(await phone.locator(`.agenda [data-testid="cal-entry"][data-job="${C}"]`).first().getAttribute('data-cal-state') !== 'scheduled', 'Its calendar slot is freed (approved, not scheduled)');

  // A cancellation racing the worker: exactly one wins, and the answer matches what happened.
  const R = weekJobs[2];
  const storeCall = (page, fn, id) => page.evaluate(async ([f, x]) => (await import('./js/store.js'))[f](x), [fn, id]);
  await storeCall(desk, 'restoreJob', R);
  const dueNow = Math.ceil((Date.now() + 61000) / 60000) * 60000;
  const rp = await schedule(desk, R, dueNow);
  await desk.waitForTimeout(Math.max(0, dueNow - Date.now() + 500));
  const [cancelRes] = await Promise.all([desk.request.post(`${BASE}api/workspace/jobs/${R}/cancel-publication`, { data: { pubId: rp.id } }).then((r) => r.json()), worker()]);
  await worker();
  const sent = receipts().some((r) => r.id === rp.id);
  assert((cancelRes.status === 'cancelled' && !sent && pubOf(R).status === 'cancelled') || (cancelRes.status !== 'cancelled' && (sent || pubOf(R).status === 'publishing')), `Cancel racing the worker settled once: cancel said “${cancelRes.status}”, receipt ${sent ? 'exists' : 'none'}, record “${pubOf(R).status}”`);

  // Delivery already started (the worker claimed it first): the real status comes back and nothing is lost.
  const S2 = weekJobs[0]; // Monday (deleted later in E)
  await storeCall(desk, 'restoreJob', S2);
  const sp = await schedule(desk, S2, Date.now() + 864e5);
  const r2 = rec(S2);
  const claimed = JSON.parse(JSON.stringify(r2.data));
  Object.assign(claimed.job.publications.at(-1), { status: 'publishing', claim: { id: 'claim_test', at: Date.now() }, deliveryStartedAt: Date.now(), attempts: 1 });
  Object.assign(r2, { data: claimed, rev: r2.rev + 1 }); // as the worker's atomic claim would
  const started = await (await desk.request.post(`${BASE}api/workspace/jobs/${S2}/cancel-publication`, { data: { pubId: sp.id } })).json();
  assert(started.status === 'publishing' && pubOf(S2).status === 'publishing' && rec(S2).rev === r2.rev, 'Delivery already started: cancelling reports “publishing” and leaves the record as it is');
  const delStarted = await desk.request.post(`${BASE}api/workspace/jobs/${S2}/delete`, { data: { baseRev: rec(S2).rev } });
  assert(delStarted.status() === 422 && /already started/.test((await delStarted.json()).error) && !rec(S2).data.deleted, 'It can’t be deleted until the outcome is known');
  Object.assign(claimed.job.publications.at(-1), { status: 'cancelled', claim: null }); // tidy the test record for later steps
  claimed.job.publications.at(-1).events.push({ at: Date.now(), type: 'cancelled', text: 'Test reset', by: 'test' });
  Object.assign(r2, { data: claimed, rev: r2.rev + 1 });
  await desk.reload(); // pick up the record as the stand-in now holds it
  await desk.waitForSelector('main');

  /* ---------- D. Cancel and delete post ---------- */
  console.log('\n== D. Cancel and delete post (phone) ==');
  const D = weekJobs[3];
  await storeCall(desk, 'restoreJob', D);
  const dp = await schedule(desk, D, Date.now() + 2 * 864e5);
  await open(phone, `#/job/${D}`);
  await phone.reload(); // the phone picks up the desktop's new schedule (as on its next poll)
  await phone.waitForSelector('[data-testid="cancel-delete"]', { timeout: 20000 });
  await phone.click('[data-testid="cancel-delete"]');
  assert(/cancelled first; only then is the post deleted/.test(await phone.locator('[data-testid="cancel-confirm"]').innerText()), 'Cancel and delete explains the order');
  await phone.click('[data-testid="cancel-confirm-btn"]');
  assert(await until(phone, () => location.hash === '#/calendar'), 'Done: back to the calendar');
  assert(rec(D).data.deleted === true && !receipts().some((r) => r.id === dp.id), 'Delivery cancelled, then the post deleted (tombstone); nothing sent');
  await worker();
  assert(!receipts().some((r) => r.id === dp.id), 'A worker run afterwards sends nothing');
  assert(!(await phone.locator(`[data-testid="cal-entry"][data-job="${D}"]`).count()), 'Gone from the calendar');

  /* ---------- E. Delete permanently ---------- */
  console.log('\n== E. Delete permanently: shared media and the brand logo survive ==');
  const dlBundle = rec(DL).data;
  const sharedPhoto = dlBundle.tasks.find((t) => t.type === 'graphic').versions.at(-1).content.photoId;
  // A second post that uses the same photo (as a duplicate or reused image would).
  const Y = 'job_m16sharedphoto';
  const yb = JSON.parse(JSON.stringify(dlBundle));
  yb.job = { ...yb.job, id: Y, title: 'Post reusing the same photo', approval: null, approvals: [], reviews: [], publications: [], concept: undefined };
  yb.job.taskIds = { copy: 'task_m16yc', graphic: 'task_m16yg' };
  yb.tasks = yb.tasks.map((t) => ({ ...t, id: t.type === 'copy' ? 'task_m16yc' : 'task_m16yg', jobId: Y, pending: null }));
  yb.log = [];
  assert((await desk.request.put(`${BASE}api/workspace/jobs/${Y}`, { data: { baseRev: 0, bundle: yb } })).ok(), 'A second post uses the same photo');
  // A disposable post with media of its own.
  const Z = await newPost(desk, 'Disposable test post about van stock checks');
  await open(desk, `#/job/${Z}`);
  await desk.click('[data-testid="generate-image"]');
  await desk.click('[data-testid="send-image-generate"]');
  assert(await until(desk, () => !!document.querySelector('[data-testid="panel-graphic"] .graphic-out img[data-photo-version]')), 'The disposable post has its own generated image');
  const zPhoto = rec(Z).data.tasks.find((t) => t.type === 'graphic').versions.at(-1).content.photoId;
  const has = (id) => fake.objects.has(`main/${id}`);
  assert(has(zPhoto) && has(sharedPhoto), 'Both images are in storage');
  // Delete the post whose photo is shared.
  await open(desk, `#/job/${DL}`);
  await desk.click('[data-testid="job-menu"] summary');
  await desk.click('[data-testid="delete-open"]');
  await desk.waitForSelector('[data-testid="delete-confirm"]');
  const dtext = await desk.locator('[data-testid="delete-confirm"]').innerText();
  assert(dtext.includes(rec(DL).data.job.title || 'operations directors') && /caption version/.test(dtext) && /graphic versions/.test(dtext) && /also used by another post or the brand logo and will be kept/.test(dtext) && /official Nexai logo is never deleted/.test(dtext), 'The confirmation names the post, says what will be removed and which shared files are kept');
  await desk.screenshot({ path: `${PREV}/m16-desktop-delete-confirm.png` });
  await desk.click('[data-testid="delete-confirm-btn"]');
  assert(await until(desk, () => location.hash === '#/'), 'Deleted; back to HQ');
  assert(rec(DL).data.deleted === true && has(sharedPhoto), `Post deleted; the photo it shared with another post survives (${sharedPhoto})`);
  const brandLogo = fake.tables.hq_records.find((r) => r.kind === 'brand');
  assert(!brandLogo || !brandLogo.data.logoId || has(brandLogo.data.logoId), 'The brand logo is untouched');
  await open(desk, `#/job/${Z}`);
  await desk.click('[data-testid="job-menu"] summary');
  await desk.click('[data-testid="delete-open"]');
  await desk.waitForSelector('[data-testid="delete-confirm"]');
  assert(/1 image or video file used only by this post will be deleted/.test(await desk.locator('[data-testid="delete-confirm"]').innerText()), 'The disposable post’s own image is listed for deletion');
  await desk.click('[data-testid="delete-confirm-btn"]');
  assert(await until(desk, () => location.hash === '#/'), 'Disposable post deleted');
  assert(!has(zPhoto) && rec(Z).data.deleted, 'Its own image is gone from storage');
  // A stale device can't bring a deleted post back.
  const back = await desk.request.put(`${BASE}api/workspace/jobs/${Z}`, { data: { baseRev: 0, bundle: { job: { id: Z } } } });
  const back2 = await desk.request.put(`${BASE}api/workspace/jobs/${DL}`, { data: { baseRev: rec(DL).rev, bundle: dlBundle } });
  assert([400, 409, 410].includes(back.status()) && back2.status() === 410, `A save to a deleted post is refused (${back.status()}, ${back2.status()}: deleted)`);
  // A planned post: the week keeps the day, marked deleted, and never recreates it.
  const W = weekJobs[0]; // archived Monday
  await open(desk, `#/job/${W}`);
  await desk.click('[data-testid="job-menu"] summary');
  await desk.click('[data-testid="delete-open"]');
  await desk.waitForSelector('[data-testid="delete-confirm"]');
  assert(/content week/.test(await desk.locator('[data-testid="delete-confirm"]').innerText()), 'The confirmation mentions the content week');
  await desk.click('[data-testid="delete-confirm-btn"]');
  assert(await until(desk, () => location.hash === '#/'), 'Planned post deleted');
  assert(plan().days[0].deleted && plan().days[0].jobId === W, 'The plan keeps Monday, marked deleted');
  await open(desk, `#/week/${planId}`);
  await desk.waitForSelector('[data-testid="week-day-Monday"][data-deleted="1"]');
  assert(!(await desk.locator('[data-testid="plan-incomplete"], [data-finish-plan]').count()), 'No “Finish creating posts”: the week isn’t treated as incomplete');
  const recreated = await desk.evaluate(async (pid) => (await import('./js/store.js')).confirmPlan?.(pid), planId).catch(() => null);
  await desk.waitForTimeout(800);
  assert(rec(W).data.deleted === true, 'Confirming the plan again doesn’t recreate it');
  // A published post: deleting the record leaves the post on the platform, and HQ says so.
  const PUBJ = weekJobs[4]; // Friday, scheduled in A: cancel, then publish it now (demo) via the worker
  await open(desk, `#/job/${PUBJ}`);
  await desk.click('[data-testid="cancel-schedule"]');
  await desk.click('[data-testid="cancel-confirm-btn"]');
  await desk.waitForSelector('[data-testid="cancel-result"]');
  await desk.click('[data-testid="publish-panel"] [data-testid="publish-now"]');
  await desk.click('[data-testid="confirm-publish"]');
  await desk.waitForTimeout(500);
  await worker();
  assert(await until(desk, (id) => true, PUBJ) && pubOf(PUBJ).status === 'published', 'The post is published (demo)');
  await open(desk, `#/job/${PUBJ}`);
  await desk.click('[data-testid="job-menu"] summary');
  await desk.click('[data-testid="delete-open"]');
  await desk.waitForSelector('[data-testid="delete-published"]');
  assert(/doesn’t remove the post from LinkedIn/.test(await desk.locator('[data-testid="delete-published"]').innerText()), 'Deleting a published post explains it stays on the platform');
  await desk.click('[data-delete-cancel]');
  await open(desk, '#/calendar');
  await desk.waitForSelector('[data-testid="cal-private-note"], .cal-head');
  const calJobs = await desk.locator('[data-testid="cal-entry"]').evaluateAll((els) => els.map((e) => e.dataset.job));
  assert(![DL, Z, W, D].some((id) => calJobs.includes(id)), 'No calendar entries point at deleted posts');
  assert(!errors.length, `No page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  console.log('\nMilestone 16 owner-control checks passed.');
} finally {
  await browser.close();
  child.kill();
  await fake.close();
}
