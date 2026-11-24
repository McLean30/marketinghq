// Milestone 14: the hosted HQ as a private, sign-in-first workspace. Runs HQ's server in Supabase mode against the
// in-memory Supabase stand-in (tests/fake-supabase.mjs), which hands JSON back in jsonb's key order exactly as the
// hosted database does, with isolated provider mocks (QUILL_PROVIDER=mock, intercepted failures). No test fixtures
// (HQ_TEST_FIXTURES is off): this is how the owner's hosted workspace behaves.
//   A. Entry point: signed out, every page and direct link shows sign-in first; files, media and API are refused.
//      Sign-in returns to the page opened; the session survives refresh; signing out closes access.
//   B. A new job on an Android phone: the real brief, Quill's real draft, "Graphic needed" with Generate image and
//      Upload photo, no image request on open; open and cancel Generate; a failed Generate keeps the description and
//      retries deliberately; Calibre's review; approve; refresh and reopen. No save is ever refused.
//   C. An older job with simulated v1 then a real v2 (and an approval of the simulated pair): history, approvals and
//      assets preserved and labelled; the simulated approval is flagged and can't be sent; fresh approval of the real
//      pair is valid. Leftover demo work never produces simulated output.
//   D. Calendar: the approved pair appears once; "LinkedIn isn't connected"; no demo publishing anywhere; the server
//      refuses to queue a post for an unconnected destination.
//   E. Supabase unavailable: a clear connection error, typed input kept, never demo data.
//   F. Notices never cover the action buttons on a phone.
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import crypto from 'crypto';
import { startFakeSupabase } from './fake-supabase.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const { hashPassword } = require('../server/auth');
const G = await import('../app/js/generators.js');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`  ok  ${m}`); };

const FAKE_PORT = 4261;
const PORT = 4262;
const BASE = `http://127.0.0.1:${PORT}/`;
const PASSWORD = `pw-${crypto.randomBytes(6).toString('hex')}`;
const fake = await startFakeSupabase(FAKE_PORT);
const jobRec = (id) => fake.tables.hq_records.find((r) => r.kind === 'job' && r.id === id);
const refused = []; // every save the server refused (the mobile save refusal)

const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(PORT), HQ_OWNER_PASSWORD_HASH: hashPassword(PASSWORD), SUPABASE_URL: fake.url, SUPABASE_SECRET_KEY: fake.secretKey, QUILL_PROVIDER: 'mock', QUILL_MOCK_DELAY_MS: '200', NO_PROXY: '127.0.0.1,localhost' }, stdio: ['ignore', 'pipe', 'inherit'] });
let serverLog = '';
child.stdout.on('data', (d) => { serverLog += d; });
await new Promise((res) => { const t = setInterval(() => { if (/Shared workspace:/.test(serverLog)) { clearInterval(t); res(); } }, 50); });

const browser = await chromium.launch();
const watch = (page, label) => {
  page.on('response', async (r) => {
    if (r.request().method() === 'PUT' && /api\/workspace\/jobs\//.test(r.url()) && r.status() === 422) refused.push(`${label}: ${(await r.json().catch(() => ({}))).error}`);
  });
  page.on('pageerror', (e) => console.log(`  [${label} page error] ${e.message}`));
};
const imageCalls = [];
async function newPhone() {
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await ctx.newPage();
  watch(page, 'phone');
  page.on('request', (r) => { if (/api\/prism\/image/.test(r.url())) imageCalls.push(r.url()); });
  return { ctx, page };
}
async function signInAt(page, hash) {
  await page.goto(`${BASE}${hash}`);
  await page.waitForSelector('[data-testid="gate-signin"]');
  await page.fill('#ws-password', PASSWORD);
  await page.click('#signin-form button[type=submit]');
  await page.waitForSelector('#main [data-view], #main', { state: 'attached' });
  await page.waitForFunction(() => document.getElementById('ws-pill')?.textContent === 'Shared workspace', null, { timeout: 15000 });
}
const until = async (page, fn, arg, ms = 20000) => {
  const end = Date.now() + ms;
  for (;;) { if (await page.evaluate(fn, arg)) return true; if (Date.now() > end) return false; await page.waitForTimeout(150); }
};

try {
  /* ---------------- A. Entry point ---------------- */
  console.log('\n== A. Sign-in first: pages, direct links, files, media, exports ==');
  const anon = await browser.newContext({ ...devices['Pixel 7'] });
  const ap = await anon.newPage();
  const appScriptLoads = [];
  ap.on('response', (r) => { if (/\/js\/|\/css\/|\/data\/|api\/workspace/.test(r.url()) && r.status() === 200) appScriptLoads.push(r.url()); });
  for (const hash of ['', '#/job/job_abcd1234', '#/agent/designer', '#/calendar', '#/profile', '#/week/new', '#/job/job_abcd1234/studio']) {
    await ap.goto(`${BASE}${hash}`);
    await ap.waitForSelector('[data-testid="gate-signin"]');
    const body = await ap.locator('body').innerText();
    assert(!/Vektor|Quill|Prism|Calibre|calendar|brief/i.test(body.replace(/Sign in|Owner password|Private workspace|Nexai Marketing HQ|You’ll go straight back to the page you opened\./g, '')), `Signed out, ${hash || '/'} shows only the owner sign-in screen`);
  }
  assert(!appScriptLoads.length, `No HQ script, style, data or workspace content reached the signed-out browser${appScriptLoads.length ? `: ${appScriptLoads.slice(0, 3).join(', ')}` : ''}`);
  const req = anon.request;
  for (const [p, want] of [['js/app.js', 401], ['js/store.js', 401], ['css/app.css', 401], ['data/profile-seed.json', 401], ['assets/agents/prism.webp', 401], ['samples/manifest.json', 401], ['api/workspace', 401], ['api/assets/photo_abcd1234', 401], ['api/quill/status', 401], ['api/ai/usage', 401], ['api/publish/receipts', 401], ['assets/brand/nexai-logo.png', 200]]) {
    const r = await req.get(`${BASE}${p}`);
    assert(r.status() === want, `GET /${p} signed out → ${r.status()}`);
  }
  const st = await (await req.get(`${BASE}api/auth/status`)).json();
  assert(st.private === true && st.signedIn === false && !st.modes && !st.settings, 'The status endpoint tells a signed-out visitor only that sign-in is needed');
  await anon.close();

  // Sign in from a deep link: back to that page.
  const { ctx: phoneCtx, page } = await newPhone();
  await page.goto(`${BASE}#/calendar`);
  await page.fill('#ws-password', 'wrong-password');
  await page.click('#signin-form button[type=submit]');
  await page.waitForFunction(() => /isn’t right/.test(document.getElementById('gate-msg')?.textContent || ''));
  assert(true, 'A wrong password is refused on the sign-in screen');
  await page.fill('#ws-password', PASSWORD);
  await page.click('#signin-form button[type=submit]');
  await page.waitForSelector('[data-testid="cal-private-note"]', { timeout: 15000 });
  assert(page.url().endsWith('#/calendar'), 'After signing in, the page originally opened (the calendar) is shown');
  await page.reload();
  await page.waitForSelector('[data-testid="cal-private-note"]');
  assert(true, 'The session survives a refresh');
  const status = await page.evaluate(() => fetch('api/auth/status').then((r) => r.json()));
  assert(status.private && status.modes.storage === 'supabase' && status.modes.captions === 'mock' && status.modes.publishing === 'not-connected' && !status.fixtures, `Modes: storage ${status.modes.storage}, captions ${status.modes.captions}, images ${status.modes.images}, publishing ${status.modes.publishing}`);

  /* ---------------- B. A new job on the phone ---------------- */
  console.log('\n== B. New job on an Android phone ==');
  const BRIEF = 'LinkedIn post about how planned preventative maintenance keeps plant rooms compliant for facilities managers';
  await page.goto(`${BASE}#/`);
  await page.waitForSelector('#brief-form');
  await page.fill('#brief', BRIEF);
  await page.selectOption('#platform', 'LinkedIn');
  await page.click('#brief-form button[type=submit]');
  let jobId = null;
  for (let i = 0; i < 80 && !jobId; i++) { jobId = fake.tables.hq_records.find((r) => r.kind === 'job' && r.data.job.brief === BRIEF)?.id; if (!jobId) await page.waitForTimeout(150); }
  assert(jobId, 'The job is saved in the Supabase workspace');
  assert(jobRec(jobId).data.job.brief === BRIEF, 'The new job starts with its actual brief');
  await page.goto(`${BASE}#/job/${jobId}`);
  await page.waitForSelector('[data-testid="graphic-needed"]');
  assert(await until(page, () => /Mock|mock/.test(document.querySelector('[data-testid="panel-copy"]')?.innerText || '') && !!document.querySelector('[data-testid="caption-text"]')), 'Quill’s real draft arrives (mock provider: the isolated stand-in for OpenAI)');
  const g0 = jobRec(jobId).data.tasks.find((t) => t.type === 'graphic');
  assert(!g0.versions.length && !g0.pending, 'No simulated graphic was made: the graphic task waits, empty');
  const gp = await page.locator('[data-testid="panel-graphic"]').innerText();
  assert(/Graphic needed/.test(gp) && !/Simulated demo output/.test(gp), `The graphic panel says “Graphic needed”, with no demo artwork`);
  assert(await page.locator('[data-testid="generate-image"]').isVisible() && await page.locator('[data-testid="upload-photo"]').isVisible(), 'Generate image and Upload photo are offered');
  assert((await page.locator('[data-approve]').getAttribute('disabled')) !== null, 'Approval stays closed until a real graphic exists');
  await page.waitForTimeout(1500);
  assert(imageCalls.length === 0, 'Opening the job made no image request (nothing paid)');

  // Open and cancel Generate: nothing sent, nothing saved.
  const revBefore = jobRec(jobId).rev;
  await page.click('[data-testid="generate-image"]');
  const prefill = await page.inputValue(`#aip-${g0.id}`);
  assert(prefill.includes(BRIEF.slice(0, 40)) && await page.locator('[data-testid="visual-brief-source"]').isVisible(), 'Generate opens with this job’s visual brief filled in, and says nothing is generated yet');
  await page.click(`[data-ai-image-form="${g0.id}|generate"] button[type=button]`);
  await page.waitForTimeout(800);
  assert(imageCalls.length === 0 && jobRec(jobId).rev === revBefore, 'Cancelling Generate sends no request and saves nothing');

  // A failed Generate keeps the description; retry is deliberate.
  let failNext = true;
  await page.route('**/api/prism/image', (route) => {
    if (failNext) { failNext = false; return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'The image service didn’t respond (test failure).', retryable: true }) }); }
    return route.continue();
  });
  await page.click('[data-testid="generate-image"]');
  const myPrompt = `${prefill} Morning light, engineer in hi-vis.`;
  await page.fill(`#aip-${g0.id}`, myPrompt);
  await page.click('[data-testid="send-image-generate"]');
  await page.waitForSelector('[data-testid="image-error"]');
  assert(/test failure/.test(await page.locator('[data-testid="image-error"]').innerText()), 'The real failure is shown');
  assert(await page.inputValue(`#aip-${g0.id}`) === myPrompt, 'The description you wrote is kept after the failure');
  assert(!jobRec(jobId).data.tasks.find((t) => t.type === 'graphic').versions.length, 'A failed request creates no graphic version');
  const callsAfterFail = imageCalls.length;
  await page.waitForTimeout(1500);
  assert(imageCalls.length === callsAfterFail, 'Nothing retries on its own');
  await page.click('[data-testid="send-image-generate"]');
  assert(await until(page, (id) => !!document.querySelector('[data-photo-version="1"]') || /v1/.test(document.querySelector('[data-testid="panel-graphic"] h2')?.textContent || ''), jobId), 'Retry generates the image as graphic v1');
  const gv1 = jobRec(jobId).data.tasks.find((t) => t.type === 'graphic').versions[0];
  assert(gv1.content.mode === 'photo' && gv1.content.photoOrigin === 'mock' && gv1.content.generated.prompt === myPrompt && gv1.content.logoId === 'brand:nexai-logo.png', 'Graphic v1 is the generated image (from your description) with the official logo');
  assert(!!fake.objects.get(`main/${gv1.content.photoId}`), 'The image is stored privately in Supabase Storage');

  // Calibre's review, then approval.
  await page.click(`[data-run-review="${jobId}"]`);
  assert(await until(page, (id) => !document.querySelector(`[data-run-review="${id}"][disabled]`) && /Run review again/.test(document.querySelector(`[data-run-review="${id}"]`)?.textContent || ''), jobId), 'Calibre’s review runs and is saved');
  assert((jobRec(jobId).data.job.reviews || []).length === 1, 'The review is in the workspace');
  await page.click(`[data-approve="${jobId}"]`);
  await page.waitForSelector('[data-testid="destination-panel"]');
  const dp = await page.locator('[data-testid="destination-panel"]').innerText();
  assert(/LinkedIn isn’t connected/.test(dp) && /private calendar/.test(dp), 'Approved: on the private calendar, “LinkedIn isn’t connected”');
  assert(!(await page.locator('[data-testid="publish-now"], [data-testid="schedule"], [data-testid="pub-receipt"]').count()), 'No demo publish or schedule buttons, no demo receipts');
  assert(!/demo scheduler|HQ asks the server/i.test(await page.locator('main').innerText()), 'No browser-dependent scheduler message');
  await page.reload();
  await page.waitForSelector('[data-testid="destination-panel"]');
  await page.goto(`${BASE}#/`);
  await page.goto(`${BASE}#/job/${jobId}`);
  await page.waitForSelector('[data-testid="destination-panel"]');
  const a = jobRec(jobId).data.job;
  assert(a.approval.copyVersion === 1 && a.approval.graphicVersion === 1 && a.approvals.length === 1, 'After refresh and reopening, the approval of caption v1 + graphic v1 is intact');
  assert(!refused.length, `No save was refused anywhere in the new-job flow${refused.length ? `: ${refused.join(' | ')}` : ''}`);

  /* ---------------- C. An older job: simulated v1, real v2 ---------------- */
  console.log('\n== C. Older jobs with simulated versions ==');
  const t0 = Date.now() - 86400000;
  const mkJob = (id, brief, graphicVersions, extra = {}) => {
    const job = { id, brief, platform: 'LinkedIn', targetDate: '2026-12-04', createdAt: t0, delegatedAt: t0, taskIds: { copy: `task_${id.slice(4)}c`, graphic: `task_${id.slice(4)}g` }, approval: null, approvals: [], ...extra };
    const sim = G.draftGraphic({ ...job, catalogue: null }).content;
    return {
      job,
      tasks: [
        { id: job.taskIds.copy, jobId: id, agent: 'copywriter', type: 'copy', instruction: 'x', createdAt: t0, versions: [{ n: 1, content: { text: 'A real caption written before the private workspace.', opts: null }, notes: [], feedback: null, by: 'Quill', simulated: false, source: 'openai', model: 'gpt-test', createdAt: t0 }], pending: null },
        { id: job.taskIds.graphic, jobId: id, agent: 'designer', type: 'graphic', instruction: 'x', createdAt: t0, versions: graphicVersions(sim), pending: null },
      ],
      log: [],
    };
  };
  const realPhoto = { mode: 'photo', photoId: gv1.content.photoId, photoName: 'site-photo.png', logoId: 'brand:nexai-logo.png', logoName: 'Official Nexai Digital logo', headline: 'Compliance you can see', headlinePos: 'bottom', crop: { zoom: 1, fx: 0.5, fy: 0.5 }, logoScale: 1 };
  const simV = (sim) => ({ n: 1, content: sim, notes: ['Simulated'], feedback: null, by: 'Prism', simulated: true, source: 'demo', createdAt: t0 });
  const OLD = 'job_legacyv1v2';
  const ONLYSIM = 'job_legacysimonly';
  const PENDING = 'job_legacypending';
  const old = mkJob(OLD, 'Older job: simulated v1 then a real photo v2', (sim) => [simV(sim), { n: 2, content: realPhoto, notes: ['Photo layout'], feedback: null, by: 'You with Prism', simulated: false, source: 'photo', createdAt: t0 + 1000 }],
    { approval: { copyVersion: 1, graphicVersion: 1, at: t0 + 500 }, approvals: [{ copyVersion: 1, graphicVersion: 1, at: t0 + 500 }] });
  const onlySim = mkJob(ONLYSIM, 'Older job approved with simulated artwork only', (sim) => [simV(sim)], { approval: { copyVersion: 1, graphicVersion: 1, at: t0 + 500 }, approvals: [{ copyVersion: 1, graphicVersion: 1, at: t0 + 500 }] });
  const pending = mkJob(PENDING, 'Older job still waiting for a simulated graphic', () => []);
  pending.tasks[1].pending = { kind: 'initial', engine: 'demo', startAt: t0, readyAt: t0 + 5600 };
  for (const b of [old, onlySim, pending]) {
    const r = await page.request.put(`${BASE}api/workspace/jobs/${b.job.id}`, { data: { baseRev: 0, bundle: b }, headers: { 'X-HQ-Device': 'computer' } });
    assert(r.ok(), `Seeded ${b.job.id} as an older client saved it`);
  }
  await page.goto(`${BASE}#/`);
  await page.goto(`${BASE}#/job/${OLD}`);
  await page.waitForSelector('[data-testid="approval-flag"]');
  assert(/graphic v1 is simulated demo artwork/.test(await page.locator('[data-testid="approval-flag"]').innerText()), 'The earlier approval (caption v1 + simulated graphic v1) is flagged: it can’t be sent');
  const hist = await page.locator('[data-testid="panel-graphic"] .hist-wrap').innerText();
  assert(/Legacy simulated · not usable/.test(hist) && /v2/.test(hist), 'History keeps simulated v1, labelled “Legacy simulated · not usable”, and real v2');
  assert(!(await page.locator('[data-testid="graphic-needed"]').count()) && await page.locator('[data-testid="panel-graphic"] [data-photo-version="2"], [data-testid="panel-graphic"] .photo-pending').count(), 'The current graphic is the real v2 (v1 is never used as a fallback)');
  assert(/Approve changed pair/.test(await page.locator(`[data-approve="${OLD}"]`).innerText()), 'A fresh approval is required');
  // The same sequence as on the phone: open and cancel Generate, Calibre's review, approve, refresh, reopen.
  const oldG = old.tasks[1].id;
  const callsBefore = imageCalls.length;
  await page.click('[data-testid="generate-image"]');
  await page.click(`[data-ai-image-form="${oldG}|generate"] button[type=button]`);
  await page.waitForTimeout(500);
  assert(imageCalls.length === callsBefore, 'Older job: opening and cancelling Generate sends nothing');
  await page.click(`[data-run-review="${OLD}"]`);
  assert(await until(page, (id) => /Run review again/.test(document.querySelector(`[data-run-review="${id}"]`)?.textContent || ''), OLD), 'Older job: Calibre reviews caption v1 + real graphic v2');
  await page.click(`[data-approve="${OLD}"]`);
  await page.waitForSelector('[data-testid="destination-panel"]');
  await page.click(`[data-run-review="${OLD}"]`);
  assert(await until(page, (id) => (document.querySelectorAll('[data-testid="review-history"] li, .review-hist li').length >= 0) && !document.querySelector(`[data-run-review="${id}"][disabled]`), OLD), 'Older job: a second review after approval saves too');
  await page.waitForTimeout(800);
  await page.reload();
  await page.waitForSelector('[data-testid="destination-panel"]');
  await page.goto(`${BASE}#/`);
  await page.goto(`${BASE}#/job/${OLD}`);
  await page.waitForSelector('[data-testid="destination-panel"]');
  assert((jobRec(OLD).data.job.reviews || []).length === 2, 'Older job: both reviews are saved after refresh and reopening');
  const oj = jobRec(OLD).data;
  assert(oj.job.approvals.length === 2 && oj.job.approvals[0].graphicVersion === 1 && oj.job.approval.graphicVersion === 2, 'The historical approval is preserved and the fresh approval names real graphic v2');
  assert(oj.tasks.find((t) => t.type === 'graphic').versions.length === 2 && oj.tasks.find((t) => t.type === 'graphic').versions[0].source === 'demo', 'Both graphic versions are kept unchanged (v1 still recorded as simulated)');
  assert(!(await page.locator('[data-testid="approval-flag"]').count()), 'With a real pair approved, the flag clears');

  await page.goto(`${BASE}#/job/${ONLYSIM}`);
  await page.waitForSelector('[data-testid="graphic-needed"]');
  assert(await page.locator('[data-testid="approval-flag"]').count() && /legacy simulated artwork/i.test(await page.locator('[data-testid="graphic-needed"]').innerText() + await page.locator('[data-testid="panel-graphic"]').innerText()), 'A job approved with simulated artwork only: flagged, and “Graphic needed”');
  assert(!(await page.locator('[data-testid="panel-graphic"] .graphic-out').count()), 'The simulated artwork isn’t shown as the post’s graphic');

  await page.goto(`${BASE}#/job/${PENDING}`);
  await page.waitForSelector('[data-testid="graphic-needed"]');
  await page.waitForTimeout(1200);
  const pg = jobRec(PENDING).data.tasks.find((t) => t.type === 'graphic');
  assert(!pg.versions.length && !pg.pending, 'Leftover demo work is retired: no simulated graphic is drawn, the post shows “Graphic needed”');

  /* ---------------- D. Calendar and destinations ---------------- */
  console.log('\n== D. Private calendar and destinations ==');
  await page.goto(`${BASE}#/calendar`);
  await page.waitForSelector('[data-testid="cal-private-note"]');
  // The calendar opens on the earliest month with posts; find each job wherever it is.
  const entries = async (id) => page.locator(`.cal-grid [data-testid="cal-entry"][data-job="${id}"]`).count();
  const months = new Set([jobRec(jobId).data.job.targetDate.slice(0, 7), '2026-12']);
  let mine = 0, oldN = 0, simN = 0, simState = '';
  for (const mo of months) {
    await page.evaluate((m) => { window.__m = m; }, mo);
    for (let i = 0; i < 24; i++) {
      const head = await page.locator('.month-nav h2').innerText();
      const target = new Date(`${mo}-01T12:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
      if (head === target) break;
      const cur = new Date(`01 ${head}`);
      await page.click(cur < new Date(`${mo}-01T12:00:00`) ? '[data-month="1"]' : '[data-month="-1"]');
    }
    mine += await entries(jobId); oldN += await entries(OLD); simN += await entries(ONLYSIM);
    if (await entries(ONLYSIM)) simState = await page.locator(`.cal-grid [data-job="${ONLYSIM}"]`).first().getAttribute('data-cal-state');
  }
  assert(mine === 1 && oldN === 1, `Each approved real pair appears on the calendar exactly once (new job ${mine}, older job ${oldN})`);
  assert(simN === 1 && simState === 'attention', 'The simulated approval is on the calendar flagged “Needs a real replacement”');
  assert(/LinkedIn isn’t connected/.test(await page.locator('main').innerText()), 'The calendar says “LinkedIn isn’t connected”');
  assert(!/demo scheduler|Published \(demo\)|Scheduled \(demo\)/.test(await page.locator('main').innerText()), 'No demo scheduling or receipts on the calendar');
  // The server refuses to queue anything for an unconnected destination, even if asked directly.
  const cur = jobRec(jobId);
  const sneaky = JSON.parse(JSON.stringify(cur.data));
  sneaky.job.publications = [{ id: 'pub_sneakytest_1', n: 1, platform: 'LinkedIn', status: 'scheduled', action: 'schedule', copyVersion: 1, graphicVersion: 1, scheduledFor: Date.now() + 3600000, events: [], account: { id: 'x' } }];
  const pr = await page.request.put(`${BASE}api/workspace/jobs/${jobId}`, { data: { baseRev: cur.rev, bundle: sneaky } });
  assert(pr.status() === 422 && /LinkedIn isn’t connected/.test((await pr.json()).error), 'The server refuses to queue a post for LinkedIn: it isn’t connected');
  for (const p of ['api/publish/run', 'api/test/clock']) {
    const r = await page.request.post(`${BASE}${p}`, { data: {} });
    assert(r.status() === 404, `Demo publishing and test controls are off in the owner’s workspace (${p} → ${r.status()})`);
  }

  /* ---------------- E. Supabase unavailable ---------------- */
  console.log('\n== E. Supabase unavailable ==');
  await page.goto(`${BASE}#/job/${jobId}`);
  await page.waitForSelector('[data-testid="destination-panel"]');
  const copyTask = jobRec(jobId).data.tasks.find((t) => t.type === 'copy');
  await page.click(`[data-toggle-edit="${copyTask.id}"]`);
  const edited = 'My unsaved edit to the caption, typed while the database is down.';
  await page.fill(`#ed-${copyTask.id}`, edited);
  await page.waitForTimeout(400);
  fake.setDown(true);
  await page.waitForTimeout(10500); // let the server's short session memory lapse, as on a cold instance
  await page.click(`[data-edit-form="${copyTask.id}"] button[type=submit]`);
  await page.waitForSelector('[data-testid="workspace-unavailable"]');
  assert(await page.inputValue(`#ed-${copyTask.id}`) === edited, 'Saving during an outage shows a clear connection error, and the typed caption is kept');
  assert(await page.evaluate(() => document.getElementById('ws-pill').textContent) === 'Shared workspace' && !(await page.evaluate(() => localStorage.getItem('nexai-hq:v1'))), 'The session stays in the hosted workspace: no switch to browser demo data');
  await page.reload();
  await page.waitForSelector('[data-testid="gate-unavailable"]');
  assert(/Can’t reach your workspace/.test(await page.locator('body').innerText()), 'Reloading during the outage shows the connection error page, not demo data');
  fake.setDown(false);
  await page.click('[data-testid="gate-unavailable"] button');
  await page.waitForSelector('[data-testid="destination-panel"]');
  await page.click(`[data-toggle-edit="${copyTask.id}"]`);
  assert(await page.inputValue(`#ed-${copyTask.id}`) === edited, 'After the outage, the unsaved caption edit is restored from this tab');
  await page.click(`[data-edit-form="${copyTask.id}"] button[type=submit]`);
  assert(await until(page, () => /Owner-edited/.test(document.querySelector('[data-testid="panel-copy"]')?.innerText || '')), 'Saving again works once Supabase is back');
  assert(jobRec(jobId).data.tasks.find((t) => t.type === 'copy').versions.at(-1).content.text === edited, 'Caption v2 is the edit typed during the outage');

  /* ---------------- F. Notices and buttons on the phone ---------------- */
  console.log('\n== F. Notices never cover the action buttons ==');
  const FRESH = 'job_freshphone1';
  const fresh = mkJob(FRESH, 'A fresh post that still needs its graphic', () => []);
  await page.request.put(`${BASE}api/workspace/jobs/${FRESH}`, { data: { baseRev: 0, bundle: fresh } });
  await page.goto(`${BASE}#/`);
  await page.goto(`${BASE}#/job/${FRESH}`);
  await page.waitForSelector('[data-testid="graphic-needed"]');
  for (const sel of ['[data-testid="generate-image"]', '[data-testid="upload-photo"]']) {
    for (const block of ['center', 'end']) {
      await page.locator(sel).evaluate((el, b) => el.scrollIntoView({ block: b }), block);
      await page.waitForTimeout(150);
      const hit = await page.locator(sel).evaluate((el) => { const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return top === el || el.contains(top); });
      assert(hit, `${sel.match(/"(.+)"/)[1]} is not covered by any notice or bar (scrolled to the ${block})`);
    }
  }
  const pos = await page.locator('[data-testid="approve-bar"]').evaluate((el) => getComputedStyle(el).position);
  assert(pos !== 'sticky' && pos !== 'fixed', `The approval bar sits in the page, not pinned over it (${pos})`);
  // Scrolling doesn't bring notices back.
  const notices = async () => page.locator('[data-testid="remote-update"], [data-testid="conflict"], #toast.show').count();
  for (let y = 0; y < 6; y++) { await page.mouse.wheel(0, 400); await page.waitForTimeout(200); }
  for (let y = 0; y < 6; y++) { await page.mouse.wheel(0, -400); await page.waitForTimeout(200); }
  assert(await notices() === 0, 'Scrolling up and down shows no repeating notices');
  await page.locator('[data-testid="panel-graphic"]').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${ROOT}design/previews/m14-phone-graphic-needed.png` });

  /* ---------------- A (end). Sign out closes access ---------------- */
  console.log('\n== Sign out ==');
  await page.goto(`${BASE}#/workspace`);
  await page.waitForSelector('[data-testid="workspace-modes"]');
  await page.screenshot({ path: `${ROOT}design/previews/m14-phone-workspace.png`, fullPage: true });
  await page.click('[data-testid="signout"]');
  await page.waitForSelector('[data-testid="gate-signin"]');
  await page.goto(`${BASE}#/job/${jobId}`);
  await page.waitForSelector('[data-testid="gate-signin"]');
  const after = await page.request.get(`${BASE}api/workspace`);
  assert(after.status() === 401, 'After signing out, direct links show sign-in and the API is closed');
  await page.screenshot({ path: `${ROOT}design/previews/m14-phone-signin.png` });
  await phoneCtx.close();
  assert(!refused.length, `No save was refused in the whole run${refused.length ? `: ${refused.join(' | ')}` : ''}`);
  console.log('\nMilestone 14 private workspace checks passed.');
} finally {
  if (refused.length) console.log(`\nRefused saves (${refused.length}):\n  ${[...new Set(refused)].join('\n  ')}`);
  await browser.close();
  child.kill();
  await fake.close();
}
