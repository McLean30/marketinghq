// Milestone 9 acceptance: Vantage, the Marketing Analyst (rules-based, sample data + owner-entered figures only).
// Shared workspace on :4184 (mock captions, test clock), desktop and iPhone 13 browsers.
//   1. HQ shows the Analyst; its workspace opens and works on a phone
//   2. Results for one of your published demo posts: exact version, zero vs unknown, cumulative 12 → 18 with history
//   3. The Nexai decision with the two labelled sample LinkedIn posts (7-day figures): 2.0% vs 1.5%, more total
//      clicks for the second, its enquiries unknown, a specific follow-up test with no overall winner
//   4. Filters (platform, dates) and opening the original post; update a source post's figures and refresh
//   5. The suggested test, edited, prefills Vektor's weekly brief; nothing is planned until you confirm
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA = path.join(ROOT, 'tests', '.tmp-m9-data');
fs.rmSync(DATA, { recursive: true, force: true });
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const { hashPassword } = require('../server/auth');

const PORT = 4184;
const BASE = `http://127.0.0.1:${PORT}/`;
const OUT = path.join(ROOT, 'tests', 'screenshots');
const PREVIEWS = path.join(ROOT, 'design', 'previews');
const PASSWORD = `test-owner-${crypto.randomBytes(6).toString('hex')}`;
fs.mkdirSync(OUT, { recursive: true });
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`  ok  ${m}`); };
const DAY = 86400000;

const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(PORT), HQ_DATA_DIR: DATA, HQ_OWNER_PASSWORD_HASH: hashPassword(PASSWORD), QUILL_PROVIDER: 'mock', QUILL_MOCK_DELAY_MS: '300', HQ_TEST_CLOCK: '1', HQ_SCHEDULER_MS: '1000' }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((res) => { let o = ''; server.stdout.on('data', (d) => { o += d; if (/Shared workspace: on/.test(o)) res(); }); });

async function signIn(page) {
  await page.goto(`${BASE}#/workspace`);
  await page.fill('#ws-password', PASSWORD);
  await page.click('#signin-form button[type=submit]');
  await page.waitForFunction(() => document.getElementById('ws-pill')?.textContent === 'Shared workspace');
}
const api = (page, p, body) => page.evaluate(async ([p, body]) => (await fetch(p, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' })).json(), [p, body]);
const jobOf = async (page, id) => (await api(page, 'api/workspace')).jobs.find((e) => e.id === id)?.bundle.job;
const londonDate = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date(ms));
const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const mondayOf = (iso) => addDays(iso, -((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7));

async function enter(page, id, { date, imp = '', clk = '', enq = '' }) {
  if (date) await page.fill(`#rs-date-${id}`, date);
  await page.fill(`#rs-imp-${id}`, String(imp));
  await page.fill(`#rs-clk-${id}`, String(clk));
  await page.fill(`#rs-enq-${id}`, String(enq));
  await page.click(`[data-results-form="${id}"] button[type=submit]`);
}
const totals = (page) => page.locator('[data-testid="rs-totals"]').evaluate((dl) => Object.fromEntries([...dl.querySelectorAll('[data-metric]')].map((d) => [d.dataset.metric, d.querySelector('dd strong').textContent.trim()])));
async function openAnalyst(page) {
  await page.goto(`${BASE}#/agent/analyst`);
  await page.waitForSelector('.sheet .size-hero.char-analyst');
}

const browser = await chromium.launch();
const errors = [];
const watch = (page, name) => page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
try {
  console.log('\n== 1. The Analyst on HQ, on desktop and phone ==');
  const deskCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const desk = await deskCtx.newPage();
  watch(desk, 'desktop');
  await signIn(desk);
  await desk.goto(`${BASE}#/`);
  await desk.waitForSelector('.agent-card.char-analyst');
  const cards = await desk.locator('.team .agent-card').count();
  const card = await desk.locator('.agent-card.char-analyst').innerText();
  assert(cards >= 5 && /Vantage/.test(card) && /Marketing Analyst/.test(card), `HQ shows ${cards} agents, including Vantage, Marketing Analyst`);
  const img = await desk.locator('.agent-card.char-analyst img').first().evaluate((i) => i.naturalWidth);
  assert(img > 0, 'The Analyst’s artwork loads');
  await desk.screenshot({ path: `${PREVIEWS}/m9-desktop-hq.png` });
  await desk.click('.agent-card.char-analyst');
  await desk.waitForSelector('.sheet .size-hero .char-role');
  assert((await desk.locator('.sheet .size-hero .char-role').innerText()) === 'Marketing Analyst', 'Clicking the card opens the Analyst’s workspace');

  const phoneCtx = await browser.newContext({ ...devices['iPhone 13'] });
  const phone = await phoneCtx.newPage();
  watch(phone, 'phone');
  await signIn(phone);
  await phone.goto(`${BASE}#/`);
  await phone.waitForSelector('.agent-card.char-analyst');
  await phone.screenshot({ path: `${PREVIEWS}/m9-phone-hq.png`, fullPage: true });
  await phone.click('.agent-card.char-analyst');
  await phone.waitForSelector('.sheet [data-testid="an-filters"]');
  const fits = await phone.evaluate(() => [...document.querySelectorAll('.sheet *')].every((e) => e.getBoundingClientRect().right <= innerWidth + 1));
  const small = await phone.locator('.sheet [data-testid="an-filters"] select, .sheet [data-testid="an-filters"] input').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height < 44).length);
  assert(fits && small === 0, 'Phone: the workspace fits the screen and its controls are at least 44 px tall');

  console.log('\n== 2. Results for one of your published posts: zero vs unknown, cumulative totals ==');
  const brief = 'LinkedIn post for UK facilities directors about chasing job sheets before the van leaves.';
  await desk.goto(`${BASE}#/`);
  await desk.fill('#brief', brief);
  await desk.selectOption('#platform', 'LinkedIn');
  await desk.click('#brief-form button[type=submit]');
  let own;
  for (let i = 0; i < 40 && !own; i++) { own = (await api(desk, 'api/workspace')).jobs.find((e) => e.bundle.job.brief === brief)?.id; if (!own) await desk.waitForTimeout(250); }
  await desk.goto(`${BASE}#/job/${own}`);
  await desk.waitForSelector('[data-approve]:not([disabled])', { timeout: 30000 });
  assert(!(await desk.locator('[data-testid="results-panel"]').count()), 'No results form before the post is published');
  await desk.click('[data-approve]');
  await desk.click('[data-testid="publish-now"]');
  await desk.click('[data-testid="confirm-publish"]');
  await desk.waitForSelector('[data-testid="pub-card"][data-status="published"]');
  await desk.waitForSelector('[data-testid="results-panel"]');
  const post = await desk.locator('[data-testid="rs-post"]').innerText();
  assert(/LinkedIn/.test(post) && /Published \(demo\)/.test(post) && /caption v1 and graphic v1, the version that was published/.test(post) && await desk.locator('[data-testid="rs-post"] svg, [data-testid="rs-post"] img').count(), 'Results panel shows the platform, publication date, caption, graphic and published versions');
  const d0 = londonDate((await api(desk, 'api/publish/receipts')).now);
  await enter(desk, own, { date: d0, imp: '400', clk: '12', enq: '' });
  await desk.waitForSelector('[data-testid="rs-totals"]');
  let t = await totals(desk);
  assert(t.impressions === '400' && t.clicks === '12' && t.enquiries === 'Not entered', `Day 0: 400 impressions, 12 clicks, enquiries left blank shows “Not entered” (${JSON.stringify(t)})`);
  await api(desk, 'api/test/clock', { advanceMs: DAY });
  await desk.waitForTimeout(3500); // the page picks up the server's moved clock
  const d1 = addDays(d0, 1);
  await enter(desk, own, { date: d1, imp: '650', clk: '15', enq: '0' });
  await desk.waitForFunction(() => document.querySelectorAll('[data-testid="rs-history-item"]').length === 2);
  await enter(desk, own, { date: d1, imp: '650', clk: '11', enq: '0' });
  await desk.waitForSelector('[data-testid="rs-error"]');
  assert(/running totals, so they can’t go down/.test(await desk.locator('[data-testid="rs-error"]').innerText()), 'A lower running total than an earlier measurement is refused, with the reason');
  await desk.fill(`#rs-clk-${own}`, '1,2a');
  await desk.click(`[data-results-form="${own}"] button[type=submit]`);
  assert(/whole numbers only/.test(await desk.locator('[data-testid="rs-error"]').innerText()), 'Non-numbers are refused, not silently treated as blank');
  await enter(desk, own, { date: d1, imp: '700', clk: '18', enq: '0' });
  await desk.waitForFunction(() => document.querySelectorAll('[data-testid="rs-history-item"]').length === 3);
  t = await totals(desk);
  assert(t.clicks === '18' && t.impressions === '700' && t.enquiries === '0', 'Clicks entered as 12, then 18 the next day: latest total is 18; enquiries recorded as 0 shows 0');
  assert(t.ctr === '2.6%', `Click-through from the latest measurement: 18 ÷ 700 = ${t.ctr}`);
  const hist = await desk.locator('[data-testid="rs-history"]').innerText();
  assert(/link clicks 12/.test(hist) && /link clicks 18/.test(hist) && /enquiries not entered/.test(hist) && /enquiries 0/.test(hist), 'History keeps every measurement, telling “not entered” apart from 0');
  const ownJob = await jobOf(desk, own);
  assert(ownJob.measurements.every((m) => m.copyVersion === 1 && m.graphicVersion === 1 && m.source === 'owner'), 'Stored measurements name the published versions and are marked as entered by you');
  await desk.screenshot({ path: `${OUT}/m9-desktop-01-results.png`, fullPage: true });

  console.log('\n== 3. The Nexai decision with two labelled sample LinkedIn posts ==');
  await openAnalyst(desk);
  await desk.click('[data-testid="add-sample"]');
  await desk.waitForSelector('[data-testid="sample-note"]');
  await desk.waitForSelector('.an-row[data-job="job_samplephotos"]');
  const row = async (id) => desk.locator(`.an-row[data-job="${id}"]`).evaluate((r) => ({ text: r.innerText, ...Object.fromEntries([...r.querySelectorAll('[data-fig]')].map((d) => [d.dataset.fig, d.textContent.trim()])) }));
  const photos = await row('job_samplephotos');
  const invoice = await row('job_sampleinvoice');
  assert(/Sample/.test(photos.text) && /Sample/.test(invoice.text) && /\(day 7\)/.test(photos.text) && /\(day 7\)/.test(invoice.text), 'Both sample posts are labelled Sample and measured 7 days after publishing');
  assert(photos.impressions === '1,000' && photos.clicks === '20' && photos.enquiries === '2', 'Missing engineer photos: 1,000 impressions, 20 link clicks, 2 enquiries');
  assert(invoice.impressions === '2,000' && invoice.clicks === '30' && invoice.enquiries === 'Not entered', 'Jobs waiting for invoice sign-off: 2,000 impressions, 30 link clicks, enquiries not entered');
  assert(photos.ctr.startsWith('2.0%') && /20 ÷ 1,000/.test(photos.ctr) && invoice.ctr.startsWith('1.5%') && /30 ÷ 2,000/.test(invoice.ctr), 'Click-through 2.0% (20 ÷ 1,000) versus 1.5% (30 ÷ 2,000), with the figures shown');
  assert(!(await desk.locator(`.an-row[data-job="${own}"]`).count()) && /no 7-day measurement/.test(await desk.locator('.an-excluded').evaluate((d) => { d.open = true; return d.innerText; })), 'Your post (measured on days 0 and 1) isn’t compared against 7-day figures, and says why');
  const obs = await desk.locator('[data-testid="an-observations"]').innerText();
  assert(/“Jobs waiting for invoice sign-off” had the most link clicks in total \(30\)/.test(obs), 'Observation: the second post had more total clicks (30)');
  assert(/“Jobs waiting for invoice sign-off”: not entered, so unknown \(not zero\)/.test(obs), 'Observation: its enquiries are unknown, not zero');
  assert(/Too little evidence for a conclusion/.test(obs), 'Observation flags too little evidence');
  await desk.selectOption('#an-posts', 'sample');
  const week = mondayOf(addDays(londonDate((await api(desk, 'api/publish/receipts')).now), -14));
  await desk.waitForSelector('[data-testid="weekly-summary"]');
  const head = await desk.locator('[data-testid="weekly-head"]').innerText();
  const sug = await desk.locator('[data-testid="suggested-test"]').innerText();
  assert((await desk.inputValue('#an-week')) === week && /2 posts published with 7-day figures/.test(head) && /sample data/.test(head), `Weekly summary covers the sample week (${week}) and says it includes sample data`);
  assert(/Rules-based/.test(sug) && /test the “Missing engineer photos” topic against “Jobs waiting for invoice sign-off” in the same format/.test(sug), 'One specific suggested test for Vektor, labelled rules-based');
  assert(/Why it’s worth trying/.test(sug) && /2\.0%, 20 ÷ 1,000/.test(sug) && /30 against 20/.test(sug), 'It explains why, with the figures');
  assert(/Too little evidence to call a winner/.test(await desk.locator('[data-testid="evidence-flag"]').innerText()), 'It flags too little evidence');
  const summaryText = await desk.locator('[data-testid="weekly-summary"]').innerText();
  assert(!/(overall winner is|is the winner|best[- ]performing post|won the week)/i.test(summaryText), 'No overall winner is declared from two posts');
  await desk.screenshot({ path: `${OUT}/m9-desktop-02-analyst.png`, fullPage: true });

  console.log('\n== 4. Filters, opening the source post, updating its figures ==');
  await desk.selectOption('#an-platform', 'Facebook');
  assert(!(await desk.locator('[data-testid="an-row"]').count()), 'Platform filter: Facebook shows no LinkedIn posts');
  await desk.selectOption('#an-platform', 'LinkedIn');
  await desk.fill('#an-from', addDays(week, 1));
  await desk.locator('#an-from').dispatchEvent('change');
  await desk.waitForFunction(() => document.querySelectorAll('[data-testid="an-row"]').length === 1);
  assert(await desk.locator('.an-row[data-job="job_sampleinvoice"]').count(), 'Date filter: from Tuesday leaves only the Tuesday post');
  await desk.fill('#an-from', '');
  await desk.locator('#an-from').dispatchEvent('change');
  await desk.waitForFunction(() => document.querySelectorAll('[data-testid="an-row"]').length === 2);
  await desk.click('.an-row[data-job="job_samplephotos"] [data-testid="an-open"]');
  await desk.waitForSelector('[data-testid="sample-banner"]');
  assert(/Missing engineer photos/.test(await desk.locator('h1').innerText()) && await desk.locator('[data-testid="results-panel"]').count(), 'Opening a result shows the original post, marked as a sample, with its results');
  t = await totals(desk);
  assert(t.clicks === '20' && t.impressions === '1,000', 'Its latest totals before the update: 1,000 impressions, 20 clicks');
  await enter(desk, 'job_samplephotos', { date: addDays(week, 8), imp: '1,150', clk: '24', enq: '3' });
  await desk.waitForFunction(() => document.querySelectorAll('[data-testid="rs-history-item"]').length === 2);
  await desk.reload();
  await desk.waitForSelector('[data-testid="rs-totals"]');
  t = await totals(desk);
  assert(t.impressions === '1,150' && t.clicks === '24' && t.enquiries === '3', 'After a refresh, the updated totals are 1,150 impressions, 24 clicks, 3 enquiries');
  const h2 = await desk.locator('[data-testid="rs-history"]').innerText();
  assert(/made-up figures/.test(h2) && /entered by you/.test(h2) && /link clicks 20/.test(h2), 'Both measurements kept: the sample one (made-up) and yours, labelled apart');
  await openAnalyst(desk);
  assert((await row('job_samplephotos')).ctr.startsWith('2.0%'), '7-day comparison still uses the 7-day measurement (2.0%), not the later day-8 figures');
  await desk.selectOption('#an-window', 'latest');
  assert((await row('job_samplephotos')).clicks === '24' && /not comparable|different days/.test(await desk.locator('.sheet').innerText()), 'Latest figures show 24 clicks and are labelled not comparable');
  await desk.selectOption('#an-window', '7');

  console.log('\n== 5. Send the suggested test to Vektor’s planner as an editable brief ==');
  await desk.selectOption('#an-posts', 'sample');
  await desk.click('[data-testid="use-suggestion"]');
  const draft = await desk.inputValue('#an-brief');
  assert(/Missing engineer photos/.test(draft) && /invoice sign-off/.test(draft) && /7 days/.test(draft), 'Using the suggestion opens an editable brief');
  const edited = `${draft}\nUse a before-and-after photo checklist as the shared format.`;
  await desk.fill('#an-brief', edited);
  const plansBefore = (await api(desk, 'api/workspace')).plans.length;
  await desk.click('[data-testid="send-to-vektor"]');
  await desk.waitForSelector('#week-form [data-testid="brief-from-analyst"]');
  assert((await desk.inputValue('#wk-brief')) === edited, 'Vektor’s weekly brief opens prefilled with your edited text');
  assert((await api(desk, 'api/workspace')).plans.length === plansBefore, 'Nothing is planned yet');
  await desk.fill('#wk-brief', `${edited} Keep it practical.`);
  assert(/Keep it practical\.$/.test(await desk.inputValue('#wk-brief')), 'The brief stays editable');
  await desk.screenshot({ path: `${OUT}/m9-desktop-03-vektor-brief.png`, fullPage: true });
  await desk.click('button:has-text("Create template plan")');
  await desk.waitForSelector('[data-testid="plan-editor"]');
  const plan = (await api(desk, 'api/workspace')).plans[0].plan;
  assert(plan.status === 'draft' && plan.brief.endsWith('Keep it practical.') && plan.days.every((d) => !d.jobId), 'The plan is a draft: no posts until you confirm it yourself');

  console.log('\n== 6. Phone: the Analyst workspace with data ==');
  await phone.reload();
  await phone.goto(`${BASE}#/agent/analyst`);
  await phone.waitForSelector('.sheet .an-row[data-job="job_sampleinvoice"]');
  const fits2 = await phone.evaluate(() => [...document.querySelectorAll('.sheet *')].every((e) => e.getBoundingClientRect().right <= innerWidth + 1));
  assert(fits2, 'Phone: comparison cards, observations and the summary fit the screen');
  await phone.screenshot({ path: `${PREVIEWS}/m9-phone-analyst.png` });
  await phone.locator('[data-testid="suggested-test"]').scrollIntoViewIfNeeded();
  await phone.screenshot({ path: `${PREVIEWS}/m9-phone-suggestion.png` });
  await phone.click('.an-row[data-job="job_sampleinvoice"] [data-testid="an-open"]');
  await phone.waitForSelector('[data-testid="results-panel"]');
  await phone.locator('[data-testid="results-panel"]').screenshot({ path: `${PREVIEWS}/m9-phone-results.png` });
  assert(/Not entered/.test(await phone.locator('[data-testid="rs-totals"]').innerText()), 'Phone: the source post’s enquiries show as Not entered');

  assert(!errors.length, `No uncaught page errors${errors.length ? `: ${errors.join('; ')}` : ''}`);
  console.log('\nMilestone 9 Analyst tests passed.');
} finally {
  await browser.close();
  server.kill();
  fs.rmSync(DATA, { recursive: true, force: true });
}
