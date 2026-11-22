// Vercel preview smoke test: opens a deployed preview in a real browser and checks the app actually works.
//
//   PREVIEW_URL=https://<deployment>.vercel.app  node tests/vercel-smoke.mjs
//
// Optional env:
//   VERCEL_AUTOMATION_BYPASS_SECRET  Vercel "Protection Bypass for Automation" secret (keeps protection on)
//   EXPECT_REVIEWER=0                skip the Brand & Quality Reviewer and Business profile (only for pre-Milestone 7 commits)
//   SMOKE_RESULT=path.json           where to write { status: pass|fail|blocked, summary, steps }
//   SMOKE_SHOTS=dir                  where to save screenshots
//
// Exit codes: 0 pass, 1 fail, 2 blocked (couldn't reach HQ: protection/sign-in/no access). Blocked is never a pass.
// Demo mode only: any request to a paid AI endpoint is refused and fails the test. Nothing is created or published.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const URL_IN = (process.env.PREVIEW_URL || '').trim();
const BYPASS = (process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '').trim();
const EXPECT_REVIEWER = process.env.EXPECT_REVIEWER !== '0';
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
  const need = ['manager', 'copywriter', 'designer', ...(EXPECT_REVIEWER ? ['reviewer'] : [])];
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

  if (pageErrors.length) throw new Failed(`Uncaught error in the app: ${pageErrors[0]}`);
  if (serverErrors.length) throw new Failed(`Server errors during the test: ${serverErrors.join(', ')}`);
  if (paid.length) throw new Failed(`The app tried to call a paid AI endpoint during the smoke test (${paid[0]}).`);
  step(true, 'No uncaught errors, no 5xx responses, no paid AI calls');
  await browser.close();
  finish('pass', `HQ rendered and ${EXPECT_REVIEWER ? 'Vektor, the Brand & Quality Reviewer and Business profile' : 'Vektor’s workspace'} opened on the preview.`);
} catch (e) {
  if (SHOTS && page) await page.screenshot({ path: path.join(SHOTS, 'failure.png') }).catch(() => {});
  await browser.close();
  if (e instanceof Blocked) { step(false, e.message); finish('blocked', e.message); }
  step(false, e.message);
  finish('fail', e instanceof Failed ? e.message : `Unexpected test error: ${e.message}`);
}
