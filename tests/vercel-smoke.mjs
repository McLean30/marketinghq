// Vercel preview smoke test: opens a deployed preview in a real browser and checks the app actually works.
//
//   PREVIEW_URL=https://<deployment>.vercel.app  node tests/vercel-smoke.mjs
//
// Optional env:
//   VERCEL_AUTOMATION_BYPASS_SECRET  Vercel "Protection Bypass for Automation" secret (keeps protection on)
//   EXPECT_REVIEWER=0                skip the Brand & Quality Reviewer and Business profile (only for pre-Milestone 7 commits)
//   EXPECT_PUBLISHING=1              also open a post and check the demo publishing controls (Milestone 8+)
//   EXPECT_ANALYST=1                 also require the Marketing Analyst card and workspace (Milestone 9+)
//   EXPECT_VIDEO=1                   also require the Video Creator and render a video from the labelled sample (Milestone 10+)
//   REQUIRE_SHA_MATCH=1              block unless the deployment itself reports EXPECT_SHA (a URL you passed in)
//   EXPECT_SHA=<commit>              refuse a deployment that reports a different commit (/api/version)
//   SMOKE_RESULT=path.json           where to write { status: pass|fail|blocked, summary, steps }
//   SMOKE_SHOTS=dir                  where to save screenshots
//
// Exit codes: 0 pass, 1 fail, 2 blocked (couldn't reach HQ: protection/sign-in/no access). Blocked is never a pass.
// Demo mode only: any request to a paid AI endpoint is refused and fails the test. Nothing is published: the publishing
// check creates one post in the test browser's own storage (local demo templates), approves it, opens the controls and
// backs out of the confirmation without confirming.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const URL_IN = (process.env.PREVIEW_URL || '').trim();
const BYPASS = (process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '').trim();
const EXPECT_REVIEWER = process.env.EXPECT_REVIEWER !== '0';
const EXPECT_PUBLISHING = process.env.EXPECT_PUBLISHING === '1';
const EXPECT_ANALYST = process.env.EXPECT_ANALYST === '1';
const EXPECT_VIDEO = process.env.EXPECT_VIDEO === '1';
const REQUIRE_SHA_MATCH = process.env.REQUIRE_SHA_MATCH === '1';
const EXPECT_SHA = (process.env.EXPECT_SHA || '').trim();
const RESULT = process.env.SMOKE_RESULT || '';
const SHOTS = process.env.SMOKE_SHOTS || '';
const steps = [];
const step = (ok, text) => { steps.push({ ok, text }); console.log(`  ${ok ? 'ok ' : 'XX '} ${text}`); };

class Blocked extends Error {}
class Failed extends Error {}

function finish(status, summary) {
  const out = { status, summary, url: URL_IN, steps, at: new Date().toISOString() };
  if (RESULT) fs.writeFileSync(RESULT, JSON.stringify(out, null, 2));
  console.log(`\nRESULT: ${status.toUpperCase()}: ${summary}`);
  process.exit(status === 'pass' ? 0 : status === 'blocked' ? 2 : 1);
}

if (!/^https?:\/\//.test(URL_IN)) finish('blocked', 'No preview URL was provided, so the preview could not be tested.');

const isVercelLogin = (url, html) =>
  /(^|\.)vercel\.com$/.test(new URL(url).hostname) ||
  /vercel authentication|log in to vercel|sign in to vercel|_vercel_sso|this deployment is protected|requested a password/i.test(html || '');

const browser = await chromium.launch();
let page;
try {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 860 },
    extraHTTPHeaders: BYPASS ? { 'x-vercel-protection-bypass': BYPASS, 'x-vercel-set-bypass-cookie': 'true' } : {},
  });
  page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  const serverErrors = [];
  page.on('response', (r) => { if (r.status() >= 500 && new URL(r.url()).host === new URL(URL_IN).host) serverErrors.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  const paid = [];
  await page.route(/\/api\/(quill\/caption|vektor\/plan)/, (route) => { paid.push(route.request().url()); return route.abort(); });

  // 1. Homepage
  let res;
  try {
    res = await page.goto(URL_IN, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (e) {
    throw new Failed(`The preview didn't respond: ${e.message.split('\n')[0]}`);
  }
  const html = await page.content();
  const status = res ? res.status() : 0;
  if (isVercelLogin(page.url(), html) || status === 401 || status === 403) {
    throw new Blocked(`Preview protection stopped the test before HQ (HTTP ${status} at ${new URL(page.url()).host}). ${BYPASS ? 'The bypass secret was rejected.' : 'Add the VERCEL_AUTOMATION_BYPASS_SECRET repository secret (Vercel → Project → Settings → Deployment Protection → Protection Bypass for Automation).'}`);
  }
  if (status >= 500) throw new Failed(`Homepage returned HTTP ${status}${/FUNCTION_INVOCATION_FAILED|server error/i.test(html) ? ' (serverless function crashed)' : ''}.`);
  if (status !== 200) throw new Failed(`Homepage returned HTTP ${status}.`);
  step(true, `GET / returned 200 (${new URL(page.url()).host})`);

  // 2. HQ renders (not blank, no uncaught startup error)
  try {
    await page.waitForSelector('.agent-card.char-manager', { timeout: 20000 });
  } catch {
    const text = (await page.locator('main').innerText().catch(() => '')).trim();
    throw new Failed(`HQ didn't render: ${text ? `the page shows “${text.slice(0, 120)}”` : 'the app is blank'}${pageErrors.length ? `; startup error: ${pageErrors[0]}` : ''}.`);
  }
  await page.waitForTimeout(800);
  if (pageErrors.length) throw new Failed(`Uncaught error while starting: ${pageErrors[0]}`);
  const title = await page.title();
  const need = ['manager', 'copywriter', 'designer', ...(EXPECT_REVIEWER ? ['reviewer'] : []), ...(EXPECT_ANALYST ? ['analyst'] : []), ...(EXPECT_VIDEO ? ['video'] : [])];
  const missing = [];
  for (const id of need) if (!(await page.locator(`.agent-card.char-${id}`).count())) missing.push(id);
  if (missing.length) throw new Failed(`HQ is missing agent card(s): ${missing.join(', ')}.`);
  for (const [sel, label] of [['button[data-focus-brief]', 'New brief'], ['[data-testid="plan-week-link"]', 'Plan a content week'], ['#brief-form', 'the brief form']]) {
    if (!(await page.locator(sel).first().isVisible())) throw new Failed(`HQ rendered without ${label}.`);
  }
  if (/Loading your workspace/.test(await page.locator('main').innerText())) throw new Failed('HQ is stuck on “Loading your workspace…”.');
  const imgs = await page.locator('.agent-card img').evaluateAll((els) => els.filter((i) => i.offsetParent).map((i) => i.naturalWidth));
  if (imgs.some((w) => !w)) throw new Failed('A character image on HQ failed to load.');
  step(/Nexai/.test(title), `HQ dashboard rendered: ${need.length} agent cards with artwork, New brief, Plan a content week (title “${title}”)`);
  // 1b. The files the dashboard needs, and API errors that stay errors.
  const http = page.context().request;
  const base = new URL('/', page.url()).toString();
  const get = async (p) => { const r = await http.get(base + p, { maxRedirects: 0 }); return { status: r.status(), type: r.headers()['content-type'] || '', body: await r.text() }; };
  const idx = await get('index.html');
  if (idx.status !== 200 || !idx.body.includes('<title>Nexai Marketing HQ</title>')) throw new Failed(`GET /index.html returned ${idx.status}${idx.status === 200 ? ' but not the HQ page' : ''}.`);
  if (!html.includes('js/app.js')) throw new Failed('GET / returned 200 but not the HQ page.');
  step(true, 'GET /index.html returned 200 with the HQ page');
  for (const [p, re] of [['js/app.js', /javascript/], ['js/store.js', /javascript/], ['css/app.css', /css/], ['assets/agents/vektor.webp', /image/], ['assets/agents/reviewer.svg', /svg/], ['data/profile-seed.json', /json/]]) {
    const r = await get(p);
    if (r.status !== 200 || !re.test(r.type)) throw new Failed(`GET /${p} returned ${r.status} (${r.type || 'no content type'}).`);
  }
  step(true, 'App scripts, styles, character art and the starting business profile all load');
  if (EXPECT_SHA) {
    const v = await get('api/version');
    let served = null;
    try { served = JSON.parse(v.body).commit; } catch { /* older build without /api/version */ }
    if (served && served !== EXPECT_SHA) throw new Failed(`This deployment runs commit ${served.slice(0, 7)}, not ${EXPECT_SHA.slice(0, 7)}: it is an older or different deployment.`);
    if (!served && REQUIRE_SHA_MATCH) throw new Blocked('This deployment doesn’t report which commit it runs, so it can’t be proved to be the commit under test.');
    step(true, served ? `Deployment reports commit ${served.slice(0, 7)} (the commit under test)` : 'Deployment doesn’t report its commit (VERCEL_GIT_COMMIT_SHA not exposed); the workflow matched it to the commit');
  }
  const api = await get('api/__smoke-unknown-route');
  if (api.status < 400 || /text\/html/.test(api.type) || /<html|<!doctype/i.test(api.body)) throw new Failed(`An unknown API route returned ${api.status} ${api.type} instead of an error (it served ${/<html|<!doctype/i.test(api.body) ? 'the homepage HTML' : 'a non-error response'}).`);
  step(true, `Unknown API route returned an error (${api.status}, ${api.type.split(';')[0]}), not the homepage`);

  const mode = await page.evaluate(async () => (await fetch('api/auth/status').then((r) => r.json()).catch(() => ({}))));
  step(true, `Mode: ${mode.authConfigured ? 'shared workspace configured' : 'browser demo mode'}`);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'hq.png') });

  // 3. Workspaces open
  async function openAgent(selector, expectName, expectRole) {
    await page.locator(selector).first().click();
    try {
      await page.waitForSelector('.sheet .size-hero .char-name', { timeout: 10000 });
    } catch {
      throw new Failed(`${expectRole}'s workspace didn't open.`);
    }
    const name = (await page.locator('.sheet .size-hero .char-name').innerText()).trim();
    const role = (await page.locator('.sheet .size-hero .char-role').innerText()).trim();
    if ((expectName && name !== expectName) || role !== expectRole) throw new Failed(`Clicking the card opened “${name}, ${role}” instead of ${expectRole}.`);
    step(true, `${name}'s workspace opened (${role})`);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${role.replace(/\W+/g, '-').toLowerCase()}.png`) });
    await page.keyboard.press('Escape');
    await page.waitForSelector('.sheet .size-hero', { state: 'detached', timeout: 5000 }).catch(() => {});
  }
  await openAgent('.agent-card.char-manager', 'Vektor', 'Marketing Manager');

  if (EXPECT_REVIEWER) {
    await openAgent('.agent-card.char-reviewer', null, 'Brand & Quality Reviewer');
    await page.locator('[data-testid="profile-link"]').click();
    try {
      await page.waitForSelector('[data-testid="profile-meta"]', { timeout: 10000 });
    } catch {
      throw new Failed('Business profile didn’t open.');
    }
    const meta = await page.locator('[data-testid="profile-meta"]').innerText();
    const fields = await page.locator('#profile-form').evaluate((f) => [...f.querySelectorAll('input, textarea')].map((e) => e.value).join(' '));
    if (!/Version \d+ · pv\d+-/.test(meta) || !fields.includes('Request a Free Workflow Review')) throw new Failed(`Business profile opened but looks wrong (${meta.slice(0, 80)}).`);
    step(true, `Business profile opened (${meta.split(' · saved')[0]})`);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'business-profile.png') });
  }

  if (EXPECT_ANALYST) {
    // The Analyst's workspace, with the labelled sample posts added in this test browser only.
    await page.goto(new URL('#/', page.url()).toString());
    await page.waitForSelector('.agent-card.char-analyst');
    await openAgent('.agent-card.char-analyst', null, 'Marketing Analyst');
    await page.goto(new URL('#/agent/analyst', page.url()).toString());
    await page.waitForSelector('.sheet [data-testid="an-filters"]');
    if (await page.locator('[data-testid="add-sample"]').count()) await page.click('[data-testid="add-sample"]');
    try { await page.waitForSelector('.an-row[data-job="job_sampleinvoice"]', { timeout: 10000 }); } catch { throw new Failed('The Analyst’s sample comparison didn’t appear.'); }
    const ctrs = await page.locator('.an-row [data-fig="ctr"]').allInnerTexts();
    if (!ctrs.some((x) => x.startsWith('2.0%')) || !ctrs.some((x) => x.startsWith('1.5%')) || !(await page.locator('[data-testid="suggested-test"]').count())) throw new Failed('The Analyst workspace opened but the sample comparison or suggested test is missing.');
    step(true, 'Marketing Analyst workspace opened: sample comparison shows 2.0% and 1.5% click-through and a rules-based suggested test');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'analyst.png') });
    await page.keyboard.press('Escape');
  }

  if (EXPECT_VIDEO) {
    // The Video Creator: workspace, then a real render in this browser from the labelled sample recording.
    await page.goto(new URL('#/', page.url()).toString());
    await page.waitForSelector('.agent-card.char-video');
    await openAgent('.agent-card.char-video', null, 'Video Creator');
    await page.goto(new URL('#/', page.url()).toString());
    await page.waitForSelector('#brief-form');
    await page.selectOption('#format', 'video');
    await page.click('[data-testid="use-sample-clip"]');
    try { await page.waitForSelector('[data-testid="clip-ok"]', { timeout: 15000 }); } catch { throw new Failed(`The sample recording couldn’t be loaded as a clip${await page.locator('[data-testid="clip-error"]').count() ? `: ${await page.locator('[data-testid="clip-error"]').innerText()}` : ''}.`); }
    await page.fill('#brief', 'Smoke test: 20-second LinkedIn walkthrough of an engineer recording a receipt.');
    await page.selectOption('#platform', 'LinkedIn');
    await page.click('#brief-form button[type=submit]');
    const vid = await page.waitForFunction(() => JSON.parse(localStorage.getItem('nexai-hq:v1') || '{"jobs":[]}').jobs.find((j) => j.kind === 'video')?.id, null, { timeout: 15000 }).then((h) => h.jsonValue()).catch(() => null);
    if (!vid) throw new Failed('A video job couldn’t be created.');
    await page.goto(new URL(`#/job/${vid}/video`, page.url()).toString());
    try { await page.waitForSelector('[data-testid="scene"]', { timeout: 30000 }); } catch { throw new Failed('The script and storyboard never appeared.'); }
    const fmt = await page.locator('[data-testid="export-format"]').innerText();
    if (/Not available/.test(fmt)) {
      step(true, 'Video Creator opened with a storyboard; this browser can’t export video, so no render was attempted');
    } else {
      await page.click('[data-testid="render-video"]');
      try { await page.waitForSelector('[data-testid="render-result"], [data-testid="render-error"]', { timeout: 90000 }); } catch { throw new Failed('The video render didn’t finish within 90 seconds.'); }
      if (await page.locator('[data-testid="render-error"]').count()) throw new Failed(`Rendering failed on the preview: ${await page.locator('[data-testid="render-error"]').innerText()}`);
      const meta = await page.locator('[data-testid="render-result"] [data-testid="video-meta"]').innerText();
      const played = await page.locator('[data-testid="render-result"] video').evaluate((v) => new Promise((res) => {
        const go = () => { v.muted = true; v.play().then(() => setTimeout(() => res({ t: v.currentTime, d: v.duration, err: v.error?.code || null }), 700)).catch((e) => res({ err: e.message })); };
        if (v.readyState >= 1) go(); else v.onloadedmetadata = go;
        setTimeout(() => res({ timeout: true, t: v.currentTime }), 8000);
      }));
      const name = await page.locator('[data-testid="render-result"] [data-testid="download-video"]').getAttribute('download');
      if (!(played.t > 0.2) || !(played.d > 14)) throw new Failed(`The rendered video didn’t play on the preview (${JSON.stringify(played)}).`);
      step(true, `Video Creator rendered and played a video on the preview: ${meta}; download as ${name}`);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'video.png'), fullPage: true });
    }
  }

  if (EXPECT_PUBLISHING) {
    // 4. Open a post and check the demo publishing controls render (no confirmation is given).
    const q = await page.evaluate(async () => (await fetch('api/quill/status').then((r) => r.json()).catch(() => ({}))));
    if (q.provider && q.provider !== 'demo') throw new Blocked('Quill is configured for live AI on this deployment, so the smoke test can’t create a post without a paid request.');
    await page.goto(new URL('#/', page.url()).toString());
    await page.waitForSelector('#brief-form');
    if (await page.locator('#format').count()) await page.selectOption('#format', 'image');
    await page.fill('#brief', 'Smoke test: LinkedIn post for UK commercial maintenance directors about job sheets.');
    await page.selectOption('#platform', 'LinkedIn');
    await page.click('#brief-form button[type=submit]');
    const jobId = await page.waitForFunction(() => JSON.parse(localStorage.getItem('nexai-hq:v1') || '{"jobs":[]}').jobs.find((j) => j.kind !== 'video' && /^Smoke test: LinkedIn post/.test(j.brief))?.id, null, { timeout: 15000 }).then((h) => h.jsonValue()).catch(() => null);
    if (!jobId) throw new Failed('A new post couldn’t be created in demo mode.');
    await page.goto(new URL(`#/job/${jobId}`, page.url()).toString());
    try { await page.waitForSelector('[data-approve]:not([disabled])', { timeout: 30000 }); } catch { throw new Failed('The post’s caption and graphic never became ready for review.'); }
    await page.click('[data-approve]');
    try { await page.waitForSelector('[data-testid="publish-panel"] [data-testid="publish-now"]', { timeout: 10000 }); } catch { throw new Failed('After approval, the publishing controls didn’t appear.'); }
    const prev = await page.locator('[data-testid="pub-start"] [data-testid="pub-preview"]').innerText();
    if (!/demo account, simulated/.test(prev) || !/Caption v1 · Graphic v1/.test(prev) || !(await page.locator('[data-testid="pub-start"] [data-testid="pub-graphic"] svg, [data-testid="pub-start"] [data-testid="pub-graphic"] img').count())) throw new Failed('The publishing preview is missing the demo account, versions or graphic.');
    const queued = await page.evaluate((id) => (JSON.parse(localStorage.getItem('nexai-hq:v1')).jobs.find((j) => j.id === id).publications || []).length, jobId);
    if (queued) throw new Failed('Approving the post queued a publication.');
    step(true, 'Post approved: Publish now (demo) and Schedule (demo) shown with the demo account, exact caption, full graphic and versions; nothing queued');
    await page.click('[data-testid="schedule"]');
    await page.waitForSelector('[data-testid="tz-note"]');
    const tz = await page.locator('[data-testid="tz-note"]').innerText();
    if (!/Europe\/London/.test(tz) || !/(GMT|BST)/.test(tz)) throw new Failed(`The schedule form doesn’t show Europe/London time with GMT/BST (“${tz.slice(0, 80)}”).`);
    await page.click('[data-pub-time] button[type=submit]');
    await page.waitForSelector('[data-testid="publish-confirm"]', { timeout: 5000 }).catch(() => {});
    const conf = await page.locator('[data-testid="publish-confirm"]').innerText().catch(() => '');
    if (!/Schedule \(demo\) for .* (GMT|BST)/.test(conf) || !/demo account, simulated/.test(conf)) throw new Failed('The separate confirmation step didn’t show the action, time and destination.');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'publishing-confirm.png'), fullPage: true });
    await page.click('[data-pub-back]');
    await page.click('[data-pub-back]');
    const note = await page.locator('[data-testid="scheduler-note"]').first().innerText();
    const sent = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('nexai-hq:demo-publisher') || '{}')).length);
    if (sent) throw new Failed('Something reached the demo publisher without a confirmation.');
    step(true, `Schedule (demo) form and confirmation render (${tz.match(/(GMT|BST)/)[0]}); backed out without confirming. Scheduler: ${/in this browser/.test(note) ? 'runs in this browser while HQ is open' : 'runs on the HQ server'}`);
  }

  if (pageErrors.length) throw new Failed(`Uncaught error in the app: ${pageErrors[0]}`);
  if (serverErrors.length) throw new Failed(`Server errors during the test: ${serverErrors.join(', ')}`);
  if (paid.length) throw new Failed(`The app tried to call a paid AI endpoint during the smoke test (${paid[0]}).`);
  step(true, 'No uncaught errors, no 5xx responses, no paid AI calls');
  await browser.close();
  finish('pass', `HQ rendered and ${EXPECT_REVIEWER ? 'Vektor, the Brand & Quality Reviewer and Business profile' : 'Vektor’s workspace'} opened on the preview${EXPECT_PUBLISHING ? '; a post’s demo publishing controls rendered' : ''}${EXPECT_ANALYST ? '; the Marketing Analyst workspace opened' : ''}${EXPECT_VIDEO ? '; the Video Creator opened and exported a video where supported' : ''}.`);
} catch (e) {
  if (SHOTS && page) await page.screenshot({ path: path.join(SHOTS, 'failure.png') }).catch(() => {});
  await browser.close();
  if (e instanceof Blocked) { step(false, e.message); finish('blocked', e.message); }
  step(false, e.message);
  finish('fail', e instanceof Failed ? e.message : `Unexpected test error: ${e.message}`);
}
