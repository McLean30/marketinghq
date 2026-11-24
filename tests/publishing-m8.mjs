// Milestone 8 acceptance: demo publishing and scheduling (simulated accounts only; nothing reaches a real platform).
//
// Part 1, shared workspace (server :4182, test clock, scheduler timer every 1 s, mock captions):
//   - approval alone queues nothing; schedule a LinkedIn post on a phone; a second signed-in browser sees the same
//     destination, time and versions; the calendar shows it once
//   - the graphic changes before its time: advancing the clock publishes nothing; re-approve and schedule again
//   - a Facebook "Publish now" double tap gives exactly one receipt
//   - a Google Business Profile post is cancelled and stays cancelled after refresh and after its time
//   - a lost publisher response: retry returns the original receipt, nothing is published twice
//   - an expired offer found before dispatch holds the post for your decision
//   - approving one post in a weekly plan doesn't authorise the others
//   - the server's own timer sends a due post with no browser open (unattended, on this server)
// Part 2, browser demo mode (server :4183 with no settings, as on the Vercel preview), with Playwright's clock:
//   - a scheduled post is sent while HQ is open; one that was missed (HQ not running) waits for a decision
//   - Europe/London times: GMT/BST shown, the March gap refused, the October repeat asks which one
//   - a lost response in the browser publisher recovers the original receipt
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA = path.join(ROOT, 'tests', '.tmp-m8-data');
fs.rmSync(DATA, { recursive: true, force: true });
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const { hashPassword } = require('../server/auth');

const PORT = 4182;
const BASE = `http://127.0.0.1:${PORT}/`;
const DEMO = 'http://127.0.0.1:4183/';
const OUT = path.join(ROOT, 'tests', 'screenshots');
const PREVIEWS = path.join(ROOT, 'design', 'previews');
const PASSWORD = `test-owner-${crypto.randomBytes(6).toString('hex')}`;
fs.mkdirSync(OUT, { recursive: true });
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`  ok  ${m}`); };
const HOUR = 3600000;
const DAY = 24 * HOUR;
const londonDate = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date(ms));
const plusDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

function start(port, env) {
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((res) => { let o = ''; child.stdout.on('data', (d) => { o += d; if (/Shared workspace: (on|off)/.test(o)) res(child); }); });
}
const server = await start(PORT, { HQ_DATA_DIR: DATA, HQ_OWNER_PASSWORD_HASH: hashPassword(PASSWORD), HQ_TEST_FIXTURES: '1', QUILL_PROVIDER: 'mock', QUILL_MOCK_DELAY_MS: '300', HQ_TEST_CLOCK: '1', HQ_SCHEDULER_MS: '1000' });
const demo = await start(4183, {});

async function signIn(page) {
  await page.goto(`${BASE}#/workspace`);
  await page.fill('#ws-password', PASSWORD);
  await page.click('#signin-form button[type=submit]');
  await page.waitForFunction(() => document.getElementById('ws-pill')?.textContent === 'Shared workspace');
}
const api = (page, p, body) => page.evaluate(async ([p, body]) => {
  const r = await fetch(p, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
  return r.json();
}, [p, body]);
const workspace = (page) => api(page, 'api/workspace');
const jobOf = async (page, id) => (await workspace(page)).jobs.find((e) => e.id === id).bundle.job;
const receipts = async (page) => (await api(page, 'api/publish/receipts')).posts;
const serverNow = async (page) => (await api(page, 'api/publish/receipts')).now;
const advance = (page, ms, run = true) => api(page, 'api/test/clock', { advanceMs: ms, run });
/** Move the server clock to just after `ms` (jumping far past a due time would look like a missed post). */
const advanceTo = async (page, ms, run = true) => advance(page, ms - (await serverNow(page)) + 30000, run);

/** Create a post from HQ and wait until both outputs are ready for review. Returns the job id. */
async function newPost(page, base, { platform, brief, date }) {
  await page.goto(`${base}#/`);
  await page.fill('#brief', brief);
  await page.selectOption('#platform', platform);
  if (date) await page.fill('#targetDate', date);
  await page.click('#brief-form button[type=submit]');
  const id = await page.evaluate(async (b) => {
    for (let i = 0; i < 60; i++) {
      const local = JSON.parse(localStorage.getItem('nexai-hq:v1') || '{"jobs":[]}').jobs.find((j) => j.brief === b);
      if (local) return local.id;
      const r = await fetch('api/workspace', { cache: 'no-store' });
      if (r.ok) { const e = (await r.json()).jobs.find((x) => x.bundle.job.brief === b); if (e) return e.id; }
      await new Promise((r) => setTimeout(r, 250));
    }
    return null;
  }, brief);
  assert(id, `${platform} post created`);
  await page.goto(`${base}#/job/${id}`);
  try { await page.waitForSelector('[data-approve]:not([disabled])', { timeout: 30000 }); } catch (e) {
    await page.screenshot({ path: `${OUT}/m8-stuck.png`, fullPage: true });
    console.log((await page.locator('main').innerText()).slice(0, 1500));
    throw e;
  }
  return id;
}
async function approve(page) {
  await page.click('[data-approve]');
  await page.waitForSelector('[data-testid="publish-panel"] [data-testid="publish-now"]');
}
async function schedule(page, date, time) {
  await page.click('[data-testid="schedule"]');
  await page.fill('[data-pub-field="date"]', date);
  await page.fill('[data-pub-field="time"]', time);
  await page.click('[data-pub-time] button[type=submit]');
  await page.waitForSelector('[data-testid="publish-confirm"]');
}
const pubCard = (page) => page.locator('[data-testid="pub-card"]');
const waitPub = (page, status) => page.waitForSelector(`[data-testid="pub-card"][data-status="${status}"]`, { timeout: 15000 });

const browser = await chromium.launch();
const errors = [];
const watch = (page, name) => page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
try {
  /* ================= Part 1: shared workspace ================= */
  console.log('\n== 1. Phone: approve, then schedule a LinkedIn post (approval alone queues nothing) ==');
  const phoneCtx = await browser.newContext({ ...devices['iPhone 13'] });
  const phone = await phoneCtx.newPage();
  watch(phone, 'phone');
  await signIn(phone);
  const t0 = await serverNow(phone);
  const target = plusDays(londonDate(t0), 3);
  const li = await newPost(phone, BASE, { platform: 'LinkedIn', brief: 'LinkedIn post for UK facilities directors about why job sheets go missing between site and office.', date: target });
  await approve(phone);
  let job = await jobOf(phone, li);
  assert(job.approval && !(job.publications || []).length, 'Approval saved and no publication was queued by approving');
  assert((await receipts(phone)).length === 0, 'The demo publisher has received nothing');
  const preview = phone.locator('[data-testid="pub-start"] [data-testid="pub-preview"]');
  const pv = await preview.innerText();
  assert(/LinkedIn/.test(pv) && /demo account, simulated/.test(pv) && /Caption v1 · Graphic v1/.test(pv), 'Preview shows platform, labelled demo account and approved versions');
  const caption = (await workspace(phone)).jobs.find((e) => e.id === li).bundle.tasks.find((t) => t.type === 'copy').versions[0].content.text;
  assert((await phone.locator('[data-testid="pub-start"] [data-testid="pub-caption"]').innerText()).trim() === caption.trim(), 'Preview shows the exact approved caption');
  const gbox = await phone.locator('[data-testid="pub-start"] [data-testid="pub-graphic"]').boundingBox();
  assert(gbox && gbox.width >= 300, `Full graphic shown across the phone screen (${Math.round(gbox.width)} px wide)`);
  const fs1 = await phone.locator('[data-testid="pub-start"] [data-testid="pub-caption"]').evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  assert(fs1 >= 16, `Caption is comfortable to read on a phone (${fs1}px)`);
  const noScroll = await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  assert(noScroll, 'No sideways scrolling on the phone');
  await phone.locator('[data-testid="publish-panel"]').screenshot({ path: `${OUT}/m8-phone-01-publish-panel.png` });
  await schedule(phone, target, '10:30');
  const reading = await phone.locator('[data-testid="publish-confirm"]').innerText();
  assert(/Schedule \(demo\) for .* 10:30 (GMT|BST)/.test(reading) && /LinkedIn: Kieran’s personal LinkedIn profile \(demo account, simulated\)/.test(reading) && /Caption v1 and graphic v1/.test(reading), 'Separate confirmation names the action, Europe/London time with GMT/BST, destination and versions');
  assert((await jobOf(phone, li)).publications === undefined || !(await jobOf(phone, li)).publications.length, 'Nothing is queued until you confirm');
  await phone.screenshot({ path: `${OUT}/m8-phone-02-confirm.png`, fullPage: false });
  await phone.click('[data-testid="confirm-publish"]');
  await waitPub(phone, 'scheduled');
  const whenPhone = await phone.locator('[data-testid="pub-when"]').innerText();
  job = await jobOf(phone, li);
  const p1 = job.publications[0];
  assert(job.publications.length === 1 && p1.status === 'scheduled' && p1.copyVersion === 1 && p1.graphicVersion === 1 && p1.account.id === 'demo-linkedin', 'Server holds one scheduled publication for caption v1 + graphic v1 on the demo LinkedIn account');
  await phone.screenshot({ path: `${OUT}/m8-phone-03-scheduled.png`, fullPage: false });

  console.log('\n== 2. Second signed-in browser sees the same destination, time and versions ==');
  const deskCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const desk = await deskCtx.newPage();
  watch(desk, 'desktop');
  await signIn(desk);
  await desk.goto(`${BASE}#/job/${li}`);
  await waitPub(desk, 'scheduled');
  assert((await desk.locator('[data-testid="pub-when"]').innerText()) === whenPhone, `Same time on both devices (${whenPhone})`);
  const auth = await desk.locator('[data-testid="pub-authorised"]').innerText();
  assert(/caption v1 and graphic v1/.test(auth) && /personal LinkedIn profile \(demo account/.test(auth), 'Same destination and versions on the second browser');
  await desk.goto(`${BASE}#/calendar`);
  await desk.waitForSelector(`[data-testid="cal-entry"][data-job="${li}"]`);
  const entries = await desk.locator(`.cal-grid [data-testid="cal-entry"][data-job="${li}"]`).count();
  const state = await desk.locator(`.cal-grid [data-testid="cal-entry"][data-job="${li}"]`).first().getAttribute('data-cal-state');
  assert(entries === 1 && state === 'scheduled', 'Calendar shows the post once, as Scheduled (demo)');
  await desk.screenshot({ path: `${OUT}/m8-desktop-01-calendar.png`, fullPage: true });
  // Any open HQ finishes agent work for every post, and an open post isn't swapped under you (Milestone 4). Close the
  // phone so the desktop's posts below aren't finished by it while they're open.
  await phoneCtx.close();

  console.log('\n== 3. Graphic edited before its time: nothing publishes; re-approve and schedule again ==');
  await desk.goto(`${BASE}#/job/${li}`);
  const gTask = (await workspace(desk)).jobs.find((e) => e.id === li).bundle.job.taskIds.graphic;
  await desk.click(`[data-toggle-rev="${gTask}"]`);
  await desk.fill(`#fb-${gTask}`, 'Show the engineer handing the signed job sheet to the client.');
  await desk.click(`[data-rev-form="${gTask}"] button[type=submit]`);
  await waitPub(desk, 'attention');
  await desk.waitForSelector('[data-approve]:not([disabled])', { timeout: 20000 });
  const why = await desk.locator('[data-testid="pub-attention"]').innerText();
  assert(/graphic|revision/.test(why) && /never picks up a different version/.test(why), `The scheduled post stopped and says why: “${why.slice(0, 90)}…”`);
  await advance(desk, 5 * DAY);
  await desk.waitForTimeout(1500);
  job = await jobOf(desk, li);
  assert(job.publications[0].status === 'attention' && (await receipts(desk)).length === 0, 'After its time passes, nothing was published');
  await desk.screenshot({ path: `${OUT}/m8-desktop-02-attention.png`, fullPage: true });
  await desk.click('[data-approve]');
  await desk.waitForSelector('[data-testid="publish-now"]');
  job = await jobOf(desk, li);
  assert(job.publications.length === 1 && job.approval.graphicVersion === 2, 'Approving the new pair queued nothing new');
  const later = await serverNow(desk);
  await desk.waitForTimeout(3500); // let the page pick up the moved server clock
  const d2 = plusDays(londonDate(later), 1);
  await schedule(desk, d2, '09:15');
  assert(/graphic v2/.test(await desk.locator('[data-testid="confirm-versions"]').innerText()), 'The new confirmation names graphic v2');
  await desk.click('[data-testid="confirm-publish"]');
  await waitPub(desk, 'scheduled');
  job = await jobOf(desk, li);
  assert(job.publications.length === 2 && job.publications[0].status === 'replaced' && job.publications[1].graphicVersion === 2, 'Publication #2 authorises graphic v2; #1 is kept in history as replaced');
  await advanceTo(desk, job.publications[1].scheduledFor);
  await waitPub(desk, 'published');
  const r1 = (await receipts(desk)).filter((r) => r.publicationId === job.publications[1].id);
  assert(r1.length === 1 && r1[0].graphicVersion === 2 && r1[0].copyVersion === 1, 'Published once, with the authorised caption v1 + graphic v2, and a receipt');
  const hist = await desk.locator('[data-testid="pub-history"]').evaluate((d) => { d.open = true; return d.innerText; });
  assert(/#1 Replaced/.test(hist) && /#2 Published \(demo\)/.test(hist) && hist.includes(r1[0].id), 'History keeps destination, versions, times, outcome and receipt for both publications');
  await desk.screenshot({ path: `${OUT}/m8-desktop-03-published.png`, fullPage: true });

  console.log('\n== 4. Facebook: Publish now with a double tap → exactly one receipt ==');
  const fb = await newPost(desk, BASE, { platform: 'Facebook', brief: 'Facebook post for building managers about logging reactive repairs the same day.' });
  await approve(desk);
  await desk.click('[data-testid="publish-now"]');
  await desk.waitForSelector('[data-testid="confirm-publish"]');
  await desk.dblclick('[data-testid="confirm-publish"]');
  await desk.evaluate(() => { const b = document.querySelector('[data-testid="confirm-publish"]'); b?.click(); b?.click(); });
  await waitPub(desk, 'published');
  job = await jobOf(desk, fb);
  const fbReceipts = (await receipts(desk)).filter((r) => r.publicationId.startsWith(`pub_${fb.slice(4)}`));
  assert(job.publications.length === 1 && fbReceipts.length === 1, `One publication and exactly one receipt (${fbReceipts[0]?.id})`);
  assert(!(await desk.locator('[data-testid="publish-now"]').count()), 'A published post offers no second Publish now');

  console.log('\n== 5. Google Business Profile: schedule, cancel; stays cancelled after refresh and after its time ==');
  const gbp = await newPost(desk, BASE, { platform: 'Google Business Profile', brief: 'Google Business Profile update about planned maintenance visits for local offices.' });
  await approve(desk);
  const n5 = await serverNow(desk);
  await schedule(desk, londonDate(n5 + 2 * DAY), '11:00');
  await desk.click('[data-testid="confirm-publish"]');
  await waitPub(desk, 'scheduled');
  await desk.click('[data-pub-step="cancel-confirm"]');
  assert(/won’t be published/.test(await desk.locator('[data-testid="publish-confirm"]').innerText()), 'Cancelling asks for confirmation');
  await desk.click('[data-testid="confirm-publish"]');
  await waitPub(desk, 'cancelled');
  await desk.reload();
  await waitPub(desk, 'cancelled');
  assert(true, 'Still cancelled after a refresh');
  await advance(desk, 3 * DAY);
  await desk.waitForTimeout(1500);
  job = await jobOf(desk, gbp);
  assert(job.publications.length === 1 && job.publications[0].status === 'cancelled' && !(await receipts(desk)).some((r) => r.publicationId === job.publications[0].id), 'Still cancelled after its due time, and the publisher never received it');
  await desk.reload();
  await waitPub(desk, 'cancelled');
  await desk.goto(`${BASE}#/calendar`);
  await desk.waitForTimeout(400);

  console.log('\n== 6. Lost response after the publisher accepted: retry recovers the original receipt ==');
  const lost = await newPost(desk, BASE, { platform: 'Facebook', brief: 'Facebook post about photographing completed work before leaving site.' });
  await approve(desk);
  await api(desk, 'api/test/publisher-fault', { mode: 'lose-next-response' });
  await desk.click('[data-testid="publish-now"]');
  await desk.click('[data-testid="confirm-publish"]');
  await desk.waitForSelector('[data-testid="pub-no-response"]');
  job = await jobOf(desk, lost);
  const accepted = (await receipts(desk)).filter((r) => r.publicationId === job.publications[0].id);
  assert(job.publications[0].status === 'publishing' && accepted.length === 1, 'The publisher accepted it but HQ got no answer: HQ shows “no confirmation yet”, not published');
  await desk.screenshot({ path: `${OUT}/m8-desktop-04-lost-response.png`, fullPage: false });
  if (await desk.locator('[data-pub-retry]').count()) await desk.click('[data-pub-retry]');
  await waitPub(desk, 'published');
  job = await jobOf(desk, lost);
  const after = (await receipts(desk)).filter((r) => r.publicationId === job.publications[0].id);
  assert(after.length === 1 && job.publications[0].receipt.id === accepted[0].id, `Retry returned the original receipt ${accepted[0].id}; still one publication`);
  assert(job.publications[0].events.some((e) => /already accepted/.test(e.text)), 'History records that the receipt was recovered, not re-published');

  console.log('\n== 7. Expired offer found before dispatch: held for your decision ==');
  const ws0 = await workspace(desk);
  const today = londonDate(await serverNow(desk));
  const prof = JSON.parse(JSON.stringify(ws0.profile.versions.at(-1).data));
  prof.offers = [{ id: 'of_winter', wording: 'Free workflow review for the first ten firms to book this month.', start: today, end: plusDays(today, 2), active: true }];
  await desk.evaluate(async ([rev, data]) => fetch('api/workspace/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseRev: rev, data }) }), [ws0.profile.rev, prof]);
  await desk.reload();
  const off = await newPost(desk, BASE, { platform: 'LinkedIn', brief: 'LinkedIn post promoting our current offer to UK commercial maintenance firms.', date: plusDays(today, 1) });
  const offCaption = (await workspace(desk)).jobs.find((e) => e.id === off).bundle.tasks.find((t) => t.type === 'copy').versions[0].content.text;
  assert(offCaption.includes('Free workflow review for the first ten firms'), 'The caption quotes the offer (live when drafted)');
  await approve(desk);
  await desk.waitForTimeout(3500);
  await schedule(desk, plusDays(today, 5), '09:00');
  await desk.click('[data-testid="confirm-publish"]');
  await waitPub(desk, 'scheduled');
  await advanceTo(desk, (await jobOf(desk, off)).publications[0].scheduledFor);
  await waitPub(desk, 'held');
  const held = await desk.locator('[data-testid="pub-held"]').innerText();
  assert(/Calibre/.test(held) && /Free workflow review/.test(held) && /ended on/.test(held), 'Held: the Reviewer found the expired offer before dispatch');
  job = await jobOf(desk, off);
  assert(!(await receipts(desk)).some((r) => r.publicationId === job.publications[0].id), 'Nothing was sent while held');
  assert(await desk.locator('[data-pub-step="release-confirm"]').count() && await desk.locator('[data-pub-step="cancel-confirm"]').count(), 'You decide: publish anyway, reschedule or cancel');
  await desk.screenshot({ path: `${OUT}/m8-desktop-05-held-offer.png`, fullPage: true });

  console.log('\n== 8. Weekly plan: approving one post authorises nothing else ==');
  await desk.goto(`${BASE}#/`);
  await desk.click('[data-testid="plan-week-link"]');
  await desk.fill('#wk-brief', 'Plan a week for UK commercial maintenance directors about getting completed jobs invoiced faster.');
  await desk.click('button:has-text("Create template plan")');
  await desk.waitForSelector('[data-testid="plan-editor"]');
  await desk.click('[data-confirm-plan]');
  let plan;
  for (let i = 0; i < 60; i++) { plan = (await workspace(desk)).plans[0]?.plan; if (plan?.status === 'confirmed') break; await desk.waitForTimeout(500); }
  const ids = plan.days.filter((d) => d.jobId).map((d) => d.jobId);
  assert(ids.length === 5, 'Plan created five linked posts');
  await desk.goto(`${BASE}#/job/${ids[0]}`);
  await desk.waitForSelector('[data-approve]:not([disabled])', { timeout: 30000 });
  await approve(desk);
  const wsPlan = await workspace(desk);
  const pj = ids.map((id) => wsPlan.jobs.find((e) => e.id === id).bundle.job);
  assert(pj[0].approval && pj.slice(1).every((j) => !j.approval), 'Only Monday’s post is approved');
  assert(pj.every((j) => !(j.publications || []).length), 'No post in the plan has a publication: approval authorises nothing');
  for (const id of ids.slice(1, 3)) {
    await desk.goto(`${BASE}#/job/${id}`);
    await desk.waitForSelector('.approve-bar');
    assert(!(await desk.locator('[data-testid="publish-now"], [data-testid="schedule"]').count()), `${id.slice(-3)}: no publishing controls until it is approved itself`);
  }

  console.log('\n== 9. Unattended: the server’s timer sends a due post with no browser open ==');
  const un = await newPost(desk, BASE, { platform: 'LinkedIn', brief: 'LinkedIn post about closing out reactive jobs on the same day.' });
  await approve(desk);
  await desk.waitForTimeout(3500);
  const n9 = await serverNow(desk);
  const due = new Date(n9 + 2 * HOUR);
  const dueParts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(due);
  await schedule(desk, londonDate(due.getTime()), dueParts);
  await desk.click('[data-testid="confirm-publish"]');
  await waitPub(desk, 'scheduled');
  const dueAt = (await jobOf(desk, un)).publications[0].scheduledFor;
  const cookies = await deskCtx.cookies();
  await deskCtx.close(); // no device has HQ open now
  const req = await require('playwright').request.newContext({ baseURL: BASE, extraHTTPHeaders: { Cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; ') } });
  const nowU = (await (await req.get('api/publish/receipts')).json()).now;
  await req.post('api/test/clock', { data: { advanceMs: dueAt - nowU + 30000, run: false } });
  await new Promise((r) => setTimeout(r, 2600)); // the scheduler timer runs every second
  const wsU = await (await req.get('api/workspace')).json();
  const pU = wsU.jobs.find((e) => e.id === un).bundle.job.publications[0];
  assert(pU.status === 'published' && pU.events.some((e) => e.by === 'scheduler' && e.type === 'published'), 'Published by the server’s own timer while no browser was open');
  await req.dispose();

  /* ================= Part 2: browser demo mode (the Vercel preview setup) ================= */
  console.log('\n== 10. Demo mode: the scheduler runs in the browser, only while HQ is open ==');
  const dctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const dp = await dctx.newPage();
  watch(dp, 'demo');
  await dp.clock.install({ time: new Date('2026-12-01T09:00:00Z') });
  const dli = await newPost(dp, DEMO, { platform: 'LinkedIn', brief: 'LinkedIn post about planned preventive maintenance windows.', date: '2026-12-04' });
  await approve(dp);
  assert(/in this browser/.test(await dp.locator('[data-testid="scheduler-note"]').innerText()) && /only while HQ is open/.test(await dp.locator('[data-testid="scheduler-note"]').innerText()), 'The screen says the demo scheduler runs in this browser, only while HQ is open');
  await schedule(dp, '2026-12-01', '11:00');
  assert(/11:00 GMT/.test(await dp.locator('[data-testid="confirm-action"]').innerText()), 'Winter time is shown as GMT');
  await dp.click('[data-testid="confirm-publish"]');
  await waitPub(dp, 'scheduled');
  await dp.screenshot({ path: `${PREVIEWS}/m8-phone-scheduled.png` });
  await dp.clock.fastForward(1.5 * HOUR);
  await dp.waitForTimeout(500);
  assert((await pubCard(dp).getAttribute('data-status')) === 'scheduled', 'Not sent before its time');
  await dp.clock.fastForward(35 * 60 * 1000);
  await waitPub(dp, 'published');
  const local = await dp.evaluate(() => Object.values(JSON.parse(localStorage.getItem('nexai-hq:demo-publisher') || '{}')));
  assert(local.length === 1 && local[0].receipt.publicationId.startsWith(`pub_${dli.slice(4)}`), 'Sent when due while HQ was open: one receipt in the browser’s demo publisher');
  await dp.locator('[data-testid="publish-panel"]').screenshot({ path: `${PREVIEWS}/m8-phone-published.png` });

  console.log('\n== 11. Demo mode: a post missed while HQ wasn’t running waits for a decision ==');
  const dfb = await newPost(dp, DEMO, { platform: 'Facebook', brief: 'Facebook post about booking boiler servicing before winter.', date: '2026-12-04' });
  await approve(dp);
  const nowLocal = await dp.evaluate(() => Date.now());
  const at = new Date(nowLocal + 2 * HOUR);
  await schedule(dp, londonDate(at.getTime()), new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at));
  await dp.click('[data-testid="confirm-publish"]');
  await waitPub(dp, 'scheduled');
  await dp.clock.fastForward(5 * HOUR); // like HQ being closed past the due time, then opened again
  await waitPub(dp, 'held');
  assert(/wasn’t running/.test(await dp.locator('[data-testid="pub-held"]').innerText()), 'Missed post is held, not sent late without asking');
  await dp.click('[data-pub-step="release-confirm"]');
  await dp.click('[data-testid="confirm-publish"]');
  await waitPub(dp, 'published');
  assert(true, 'Published after you chose “Publish now anyway”');
  void dfb;

  console.log('\n== 12. Europe/London clock changes are explicit ==');
  const dg = await newPost(dp, DEMO, { platform: 'Google Business Profile', brief: 'Google Business Profile post about out-of-hours call-outs.', date: '2026-12-04' });
  await approve(dp);
  await dp.click('[data-testid="schedule"]');
  await dp.fill('[data-pub-field="date"]', '2027-03-28');
  await dp.fill('[data-pub-field="time"]', '01:30');
  assert(/doesn’t exist in London/.test(await dp.locator('[data-testid="tz-error"]').innerText()), '01:30 on 28 March 2027 is refused: the clocks skip it');
  await dp.click('[data-pub-time] button[type=submit]');
  assert(await dp.locator('[data-testid="pub-error"]').count(), 'Continue is refused for a skipped time');
  await dp.fill('[data-pub-field="date"]', '2027-10-31');
  await dp.fill('[data-pub-field="time"]', '01:30');
  assert(/happens twice/.test(await dp.locator('[data-testid="tz-ambiguous"]').innerText()), '01:30 on 31 October 2027 is flagged as happening twice');
  await dp.click('[data-pub-time] button[type=submit]');
  assert(/BST or .* GMT/.test(await dp.locator('[data-testid="pub-error"]').innerText()), 'You must choose BST or GMT before continuing');
  await dp.screenshot({ path: `${PREVIEWS}/m8-phone-clock-change.png` });
  await dp.locator('[data-pub-pick]').nth(1).check();
  await dp.click('[data-pub-time] button[type=submit]');
  assert(/31 October 2027, 01:30 GMT/.test(await dp.locator('[data-testid="confirm-action"]').innerText()), 'Choosing the second 01:30 schedules it for 01:30 GMT');
  await dp.click('[data-pub-back]');
  await dp.fill('[data-pub-field="date"]', '2027-07-01');
  await dp.fill('[data-pub-field="time"]', '09:00');
  assert(/09:00 BST/.test(await dp.locator('[data-testid="tz-reading"]').innerText()), 'Summer time is shown as BST');
  void dg;

  console.log('\n== 13. Demo mode: lost response in the browser publisher ==');
  await dp.click('[data-pub-back]');
  await dp.evaluate(() => localStorage.setItem('nexai-hq:demo-publisher-fault', 'lose'));
  await dp.click('[data-testid="publish-now"]');
  await dp.click('[data-testid="confirm-publish"]');
  await dp.waitForSelector('[data-testid="pub-no-response"]');
  await dp.click('[data-pub-retry]');
  await waitPub(dp, 'published');
  const lp = await dp.evaluate(() => Object.values(JSON.parse(localStorage.getItem('nexai-hq:demo-publisher') || '{}')).map((r) => r.receipt.publicationId));
  assert(new Set(lp).size === lp.length && lp.length === 3, 'Three demo posts, one receipt each: nothing published twice');

  await dp.goto(`${DEMO}#/calendar`);
  await dp.waitForSelector('.agenda [data-testid="cal-entry"]');
  await dp.screenshot({ path: `${PREVIEWS}/m8-phone-calendar.png`, fullPage: true });

  assert(!errors.length, `No uncaught page errors${errors.length ? `: ${errors.join('; ')}` : ''}`);
  console.log('\nMilestone 8 publishing tests passed.');
} finally {
  await browser.close();
  server.kill();
  demo.kill();
  fs.rmSync(DATA, { recursive: true, force: true });
}
