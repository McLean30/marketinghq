// Milestone 12: Supabase-backed scheduling with a hosted worker. Local end-to-end run: HQ's server in Supabase mode
// against an in-memory Supabase stand-in (tests/fake-supabase.mjs), and the real worker code
// (supabase/functions/hq-scheduler/worker.js) playing the part of each cron run.
//   1. Approve on a laptop → nothing queued. Schedule → confirm shows account, platform, versions, UK time; the exact
//      media is stored privately. HQ's server never dispatches in this mode.
//   2. Laptop browser closed and HQ server stopped → the worker sends it once, even with two runs overlapping.
//   3. Phone: the calendar shows it once, on the right UK day, Published (demo), with receipt and versions.
//   4. Editing after scheduling holds it; cancelling sends nothing and keeps history; rescheduling moves the entry.
//   5. Worker edge cases: missed by >15 min, lost answer, a platform that can't be asked, a crashed run, missing media.
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { spawn, execFileSync } from 'child_process';
import crypto from 'crypto';
import { startFakeSupabase } from './fake-supabase.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const { hashPassword } = require('../server/auth');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PB = await import('../public/js/publishing.js');
const { runScheduler } = await import('../supabase/functions/hq-scheduler/worker.js');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`  ok  ${m}`); };

execFileSync(process.execPath, [`${ROOT}/scripts/sync-worker.cjs`, '--check'], { stdio: 'inherit' });
assert(true, 'The worker’s copies of the publishing rules match public/js');

const FAKE_PORT = 4231;
const PORT = 4232;
const BASE = `http://127.0.0.1:${PORT}/`;
const PASSWORD = `pw-${crypto.randomBytes(6).toString('hex')}`;
const fake = await startFakeSupabase(FAKE_PORT);
fake.tables.hq_scheduler_workspaces.push({ workspace: 'main', enabled: true });
const worker = (opts) => runScheduler({ url: fake.url, key: fake.secretKey, ...opts });
const jobRec = (id, ws = 'main') => fake.tables.hq_records.find((r) => r.workspace === ws && r.kind === 'job' && r.id === id);
const receipts = (ws = 'main') => fake.tables.hq_records.filter((r) => r.workspace === ws && r.kind === 'post');

let server = null;
async function startServer() {
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(PORT), HQ_OWNER_PASSWORD_HASH: hashPassword(PASSWORD), SUPABASE_URL: fake.url, SUPABASE_SECRET_KEY: fake.secretKey, HQ_SCHEDULER_MS: '15000', NO_PROXY: '127.0.0.1,localhost' }, stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  await new Promise((res) => child.stdout.on('data', (d) => { out += d; if (/Shared workspace:/.test(out)) res(); }));
  server = { child, log: () => out };
  return server;
}
const stopServer = () => new Promise((res) => { server.child.once('exit', res); server.child.kill(); });

async function signIn(page) {
  await page.goto(`${BASE}#/workspace`);
  await page.waitForSelector('#ws-password, [data-signout]');
  if (!(await page.locator('[data-signout]').count())) {
    await page.fill('#ws-password', PASSWORD);
    await page.click('#signin-form button[type=submit]');
  }
  await page.waitForFunction(() => document.getElementById('ws-pill')?.textContent === 'Shared workspace');
}
async function newApprovedPost(page, brief, platform = 'LinkedIn') {
  await page.goto(`${BASE}#/`);
  await page.waitForSelector('#brief-form');
  await page.selectOption('#format', 'image');
  await page.fill('#brief', brief);
  await page.selectOption('#platform', platform);
  await page.click('#brief-form button[type=submit]');
  let id = null;
  for (let i = 0; i < 80 && !id; i++) { id = fake.tables.hq_records.find((r) => r.kind === 'job' && r.data.job.brief === brief)?.id; if (!id) await page.waitForTimeout(200); }
  await page.goto(`${BASE}#/job/${id}`);
  await page.waitForSelector('[data-approve]:not([disabled])', { timeout: 30000 });
  await page.click('[data-approve]');
  await page.waitForSelector('[data-testid="publish-panel"] [data-testid="schedule"]');
  return id;
}
async function schedule(page, id, date, time) {
  await page.click('[data-testid="publish-panel"] [data-testid="schedule"]');
  await page.fill(`#pt-date-${id}`, date);
  await page.fill(`#pt-time-${id}`, time);
  await page.locator(`#pt-time-${id}`).dispatchEvent('change');
  await page.click(`[data-pub-time="${id}"] button[type=submit]`);
  await page.waitForSelector('[data-testid="publish-confirm"]');
  const confirm = {
    action: await page.textContent('[data-testid="confirm-action"]'),
    destination: await page.textContent('[data-testid="confirm-destination"]'),
    versions: await page.textContent('[data-testid="confirm-versions"]'),
  };
  await page.click('[data-testid="confirm-publish"]');
  await page.waitForSelector('[data-testid="pub-card"][data-status="scheduled"]', { timeout: 20000 });
  return confirm;
}
const day = (offset) => PB.londonParts(Date.now() + offset * 864e5).date;

await startServer();
const browser = await chromium.launch();
const errors = [];
try {
  console.log('\n== 1. Approve on the laptop, then schedule with a separate confirmation ==');
  assert(/Storage: Supabase/.test(server.log()) && !/Demo scheduler: on/.test(server.log()), 'HQ server in Supabase mode runs no scheduler timer of its own');
  const lap = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const lp = await lap.newPage();
  lp.on('pageerror', (e) => errors.push(`laptop: ${e.message}`));
  await signIn(lp);
  const A = await newApprovedPost(lp, 'LinkedIn post for facilities directors about planning PPM visits so the right parts are on the van.');
  assert(!(jobRec(A).data.job.publications || []).length, 'Approving alone queues nothing');
  await lp.waitForSelector('[data-testid="scheduler-note"][data-runs-on="hosted"]');
  assert(/Supabase Cron runs it every minute/.test(await lp.textContent('[data-testid="scheduler-note"]')), 'The post says the hosted scheduler sends it, with every browser closed');
  const D1 = day(1);
  const conf = await schedule(lp, A, D1, '09:30');
  const at = PB.fromLondon(D1, '09:30').ms;
  assert(/Schedule \(demo\) for .* 09:30 (GMT|BST)/.test(conf.action), `Confirmation shows the UK date and time (${conf.action.trim()})`);
  assert(/LinkedIn: Kieran’s personal LinkedIn profile \(demo account, simulated\)/.test(conf.destination), 'Confirmation names the destination: Kieran’s personal LinkedIn profile, marked as a demo account');
  assert(/Caption v1 and graphic v1/.test(conf.versions), 'Confirmation names the caption and media versions');
  let pub = jobRec(A).data.job.publications[0];
  assert(pub.status === 'scheduled' && pub.scheduledFor === at && pub.copyVersion === 1 && pub.graphicVersion === 1, `Stored: scheduled for ${new Date(at).toISOString()} (UTC), caption v1 + graphic v1`);
  const obj = fake.objects.get(`main/${pub.media?.assetId}`);
  assert(pub.media && obj && obj.buf.length === pub.media.size && pub.media.type === 'image/png' && /^[0-9a-f]{64}$/.test(pub.media.sha256), `The approved graphic is stored privately for the worker (${pub.media?.assetId}, ${Math.round((pub.media?.size || 0) / 1024)} KB)`);
  const run = await lp.evaluate(async () => (await fetch('api/publish/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json());
  assert(run.hosted === true && !run.changed.length, 'The HQ server refuses to dispatch: in Supabase mode only the worker sends posts');

  // More posts for the edit, cancel and reschedule checks.
  const B = await newApprovedPost(lp, 'LinkedIn post about labelling parts bags the night before a planned visit.');
  await schedule(lp, B, D1, '10:00');
  const C = await newApprovedPost(lp, 'Facebook post about photographing completed work before leaving site.', 'Facebook');
  const confC = await schedule(lp, C, D1, '11:00');
  assert(/Facebook: Nexai Digital Facebook Page \(demo account, simulated\)/.test(confC.destination), 'Facebook goes to the Nexai Digital Facebook Page (demo stand-in)');
  const E = await newApprovedPost(lp, 'Google Business Profile post about same-week reactive maintenance call-outs.', 'Google Business Profile');
  const confE = await schedule(lp, E, D1, '12:00');
  assert(/Nexai Digital Google Business Profile \(demo account, simulated\)/.test(confE.destination), 'Google Business Profile goes to the Nexai Digital Google Business Profile (demo stand-in)');

  console.log('\n== 2. Edit after scheduling: held until you approve and schedule again ==');
  await lp.goto(`${BASE}#/job/${B}`);
  const copyTask = jobRec(B).data.tasks.find((t) => t.type === 'copy').id;
  await lp.click(`[data-toggle-edit="${copyTask}"]`);
  await lp.fill(`#ed-${copyTask}`, 'Edited after scheduling: label the parts bags the night before.');
  await lp.click(`[data-edit-form="${copyTask}"] button[type=submit]`);
  await lp.waitForSelector('[data-testid="pub-card"][data-status="attention"]', { timeout: 15000 });
  assert(jobRec(B).data.job.publications[0].status === 'attention' && /caption changed from v1 to v2/.test(jobRec(B).data.job.publications[0].attentionReason), 'Editing the approved caption holds the queued post straight away (caption changed from v1 to v2)');

  console.log('\n== 3. Cancel and reschedule before dispatch ==');
  await lp.goto(`${BASE}#/job/${C}`);
  await lp.click('[data-pub-step="cancel-confirm"]');
  await lp.click('[data-testid="confirm-publish"]');
  await lp.waitForSelector('[data-testid="pub-card"][data-status="cancelled"]');
  assert(jobRec(C).data.job.publications[0].status === 'cancelled' && jobRec(C).data.job.publications[0].events.length >= 2, 'Cancelled before dispatch; its history is kept');
  const D2 = day(2);
  await lp.goto(`${BASE}#/job/${E}`);
  await lp.click('[data-pub-step="reschedule"]');
  await lp.fill(`#pt-date-${E}`, D2);
  await lp.fill(`#pt-time-${E}`, '08:15');
  await lp.locator(`#pt-time-${E}`).dispatchEvent('change');
  await lp.click(`[data-pub-time="${E}"] button[type=submit]`);
  await lp.click('[data-testid="confirm-publish"]');
  await lp.waitForFunction(() => /08:15/.test(document.querySelector('[data-testid="pub-when"]')?.textContent || ''));
  const eAt = PB.fromLondon(D2, '08:15').ms;
  assert(jobRec(E).data.job.publications.length === 1 && jobRec(E).data.job.publications[0].scheduledFor === eAt, 'Rescheduling moves the same publication (same id), no second entry');

  console.log('\n== 4. Laptop closed, HQ server stopped: the hosted worker sends it ==');
  await lap.close();
  await stopServer();
  let r = await worker({ now: () => at - 60000, trigger: 'test' });
  assert(r.claimed === 0 && !receipts().length, 'A run before the time sends nothing');
  const [r1, r2] = await Promise.all([worker({ now: () => at + 20000, trigger: 'test' }), worker({ now: () => at + 20000, trigger: 'test' })]);
  pub = jobRec(A).data.job.publications[0];
  const rcA = receipts().filter((x) => x.id === pub.id);
  assert(pub.status === 'published' && rcA.length === 1 && pub.receipt.id === rcA[0].data.receipt.id, `Two overlapping runs: published once, one receipt (${pub.receipt.id})`);
  assert(r1.claimed + r2.claimed === 1 && pub.events.filter((e) => e.type === 'published').length === 1, `Only one run claimed it; the other sent nothing (claims ${r1.claimed} + ${r2.claimed})`);
  assert(pub.receipt.media?.assetId === pub.media.assetId && pub.receipt.copyVersion === 1 && pub.receipt.graphicVersion === 1, 'The receipt names the delivered media and versions');
  assert(jobRec(B).data.job.publications[0].status === 'attention' && !receipts().some((x) => x.id === jobRec(B).data.job.publications[0].id), 'The edited post was not sent');
  assert(!receipts().some((x) => x.id === jobRec(C).data.job.publications[0].id), 'The cancelled post was not sent');
  assert(jobRec(E).data.job.publications[0].status === 'scheduled', 'The rescheduled post waits for its new time');
  assert(fake.tables.hq_worker_runs.length >= 3 && fake.tables.hq_worker_runs.every((x) => x.finished_at && x.ok), 'Each worker run is logged with its outcome');

  console.log('\n== 5. Later, on the phone: the calendar shows what happened ==');
  await startServer();
  const ph = await browser.newContext({ ...devices['iPhone 13'] });
  const pp = await ph.newPage();
  pp.on('pageerror', (e) => errors.push(`phone: ${e.message}`));
  await signIn(pp);
  await pp.goto(`${BASE}#/calendar`);
  await pp.waitForSelector('.agenda');
  const entries = await pp.$$eval(`[data-testid="cal-entry"][data-job="${A}"]`, (els) => els.filter((e) => e.offsetParent).map((e) => ({ state: e.dataset.calState, day: e.closest('.agenda-day')?.querySelector('h3')?.textContent })));
  assert(entries.length === 1 && entries[0].state === 'published', `Shown once on the phone’s list, as published (${entries[0]?.day})`);
  const want = new Date(`${D1}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
  assert(entries[0].day.includes(want), `On the right UK day (${want})`);
  const eEntries = await pp.$$eval(`[data-testid="cal-entry"][data-job="${E}"]`, (els) => els.filter((e) => e.offsetParent).map((e) => e.closest('.agenda-day')?.querySelector('h3')?.textContent));
  assert(eEntries.length === 1 && eEntries[0].includes(new Date(`${D2}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' })), 'The rescheduled post appears once, on its new day');
  const tag = await pp.textContent(`[data-testid="cal-entry"][data-job="${A}"] .tag`);
  assert(/Published \(demo\)/.test(tag), 'Labelled “Published (demo)”');
  await pp.click(`.agenda [data-testid="cal-entry"][data-job="${A}"]`);
  await pp.waitForSelector('[data-testid="pub-receipt"]');
  const card = await pp.textContent('[data-testid="pub-card"]');
  assert(/Published \(demo\)/.test(card) && card.includes(pub.receipt.id) && /Kieran’s personal LinkedIn profile/.test(card) && /caption v1 and graphic v1/.test(card) && /09:30/.test(card), 'Opening it shows destination, approved versions, scheduled time, status and receipt');
  assert(/Simulated: nothing was posted to LinkedIn/.test(card), 'It says plainly that nothing reached LinkedIn');
  await pp.goto(`${BASE}#/job/${B}`);
  await pp.waitForSelector('[data-testid="pub-attention"]');
  assert(/caption changed from v1 to v2/.test(await pp.textContent('[data-testid="pub-attention"]')), 'The held post shows why it was held');
  await pp.screenshot({ path: `${ROOT}/design/previews/m12-phone-held.png` });
  await pp.goto(`${BASE}#/job/${A}`);
  await pp.waitForSelector('[data-testid="pub-receipt"]');
  await pp.screenshot({ path: `${ROOT}/design/previews/m12-phone-published.png`, fullPage: false });
  await ph.close();

  console.log('\n== 6. Worker edge cases (their own workspace; nothing else touched) ==');
  const WS = 'edge';
  const fresh = (id, platform = 'LinkedIn') => {
    const b = JSON.parse(JSON.stringify(jobRec(A).data));
    b.job.id = id;
    b.job.platform = platform;
    b.job.taskIds = { copy: `task_${id.slice(4)}c`, graphic: `task_${id.slice(4)}g` };
    b.tasks[0].id = b.job.taskIds[b.tasks[0].type === 'copy' ? 'copy' : 'graphic'];
    b.tasks[1].id = b.job.taskIds[b.tasks[1].type === 'copy' ? 'copy' : 'graphic'];
    b.tasks.forEach((t) => { t.jobId = id; });
    b.job.publications = [];
    return b;
  };
  const put = (b) => fake.tables.hq_records.push({ workspace: WS, kind: 'job', id: b.job.id, rev: 1, data: b, updated_at: new Date().toISOString() });
  const queue = (b, when, media = jobRec(A).data.job.publications[0].media) => { const o = PB.authorise(b, { action: 'schedule', scheduledFor: when, now: when - 3600000, by: 'test', media }); if (o.error) throw new Error(o.error); fake.objects.set(`${WS}/${media.assetId}`, fake.objects.get(`main/${media.assetId}`)); fake.tables.hq_records.push({ workspace: WS, kind: 'asset', id: media.assetId, rev: 1, data: { id: media.assetId, size: media.size, type: media.type } }); return b; };
  const T0 = Date.UTC(2027, 2, 1, 9, 0);
  const w = (opts) => worker({ workspaces: [WS], trigger: 'test', ...opts });
  const p0 = (id) => jobRec(id, WS).data.job.publications[0];
  // Missed by more than 15 minutes.
  put(queue(fresh('job_edgemissed'), T0));
  await w({ now: () => T0 + 20 * 60000 });
  assert(p0('job_edgemissed').status === 'held' && /wasn’t sent late/.test(p0('job_edgemissed').holdReason) && !receipts(WS).length, 'More than 15 minutes late: held for your decision, not sent');
  // Lost answer, then the next run asks the publisher and recovers the original receipt.
  put(queue(fresh('job_edgelost'), T0));
  await w({ now: () => T0 + 5000, faults: ['lose'] });
  assert(p0('job_edgelost').status === 'publishing' && p0('job_edgelost').events.at(-1).type === 'no_response' && receipts(WS).length === 1, 'Answer lost after the publisher accepted: shown as “no confirmation yet”, not published');
  await w({ now: () => T0 + 65000 });
  assert(p0('job_edgelost').status === 'published' && receipts(WS).length === 1 && /original receipt/.test(p0('job_edgelost').events.at(-1).text), 'Next run asks the publisher by publication id: original receipt, published once');
  // A platform that can't be asked (future live account): unknown outcome needs you; never resent.
  put(queue(fresh('job_edgelive'), T0));
  await w({ now: () => T0 + 5000, faults: ['lose'], uncheckable: true });
  assert(p0('job_edgelive').status === 'attention' && /may or may not have reached/.test(p0('job_edgelive').attentionReason) && p0('job_edgelive').attempts === 1, 'Live-style timeout: Needs attention with the attempt details, not resent');
  await w({ now: () => T0 + 600000, uncheckable: true });
  assert(p0('job_edgelive').attempts === 1 && p0('job_edgelive').status === 'attention', 'Later runs leave it alone');
  // A run that crashed after claiming: the next run checks first; the publisher never got it, so it's sent again.
  const crashed = queue(fresh('job_edgecrash'), T0);
  PB.claimDue(crashed, { now: T0 + 1000, profileData: null, by: 'scheduler', claimId: 'claim_dead' });
  put(crashed);
  await w({ now: () => T0 + 1000 + 60000 });
  assert(p0('job_edgecrash').status === 'publishing', 'A fresh claim is left alone (still within the delivery window)');
  await w({ now: () => T0 + 1000 + PB.CLAIM_MS + 1000 });
  assert(p0('job_edgecrash').status === 'scheduled' && p0('job_edgecrash').events.some((e) => e.type === 'not_received'), 'After the window: the publisher is asked, says it never received it');
  await w({ now: () => T0 + 1000 + PB.CLAIM_MS + 61000 });
  assert(p0('job_edgecrash').status === 'published' && receipts(WS).filter((x) => x.id === p0('job_edgecrash').id).length === 1, 'Sent on the next run with the same publication id: one receipt');
  // Media gone from storage.
  const noMedia = queue(fresh('job_edgemedia'), T0, { assetId: 'photo_missing0001', size: 10, type: 'image/png' });
  fake.objects.delete(`${WS}/photo_missing0001`);
  put(noMedia);
  await w({ now: () => T0 + 5000 });
  assert(p0('job_edgemedia').status === 'held' && /^Not sent: the approved media file/.test(p0('job_edgemedia').holdReason) && !receipts(WS).some((x) => x.id === p0('job_edgemedia').id), 'Approved media missing from storage: held with “Not sent: …”, nothing reached the publisher');
  // Bounded batch.
  for (let i = 0; i < 14; i++) put(queue(fresh(`job_edgebatch${String(i).padStart(2, '0')}`), T0));
  r = await w({ now: () => T0 + 5000 });
  assert(r.claimed === PB.BATCH, `A run sends at most ${PB.BATCH} posts; the rest wait for the next minute`);
  r = await w({ now: () => T0 + 65000 });
  assert(r.claimed === 4, 'The next run sends the remaining 4');
  // Workspaces that aren't enabled are never touched by the cron run.
  put(queue(fresh('job_edgenotenabled'), T0));
  const snap = JSON.stringify(fake.tables.hq_records.filter((x) => x.workspace === WS));
  r = await worker({ now: () => T0 + 5000, trigger: 'cron' });
  assert(JSON.stringify(fake.tables.hq_records.filter((x) => x.workspace === WS)) === snap && p0('job_edgenotenabled').status === 'scheduled', 'A cron run never touches a workspace that isn’t enabled for the hosted scheduler');
  assert(!errors.length, `No page errors${errors.length ? `: ${errors.join('; ')}` : ''}`);
  console.log('\nHosted scheduler checks passed.');
} finally {
  await browser.close();
  if (server) server.child.kill();
  await fake.close();
}
