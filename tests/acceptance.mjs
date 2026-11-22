// End-to-end acceptance test for milestone 1. Run with the server up: npm start, then npm run test:e2e
// Drives the real UI at desktop and phone sizes. Screenshots go to tests/screenshots/.
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
const OUT = fileURLToPath(new URL('./screenshots/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const BRIEF =
  "Create Friday's LinkedIn post for UK commercial maintenance directors about jobs engineers have finished but the office still can't invoice because a job sheet or photo is missing. Give me a useful caption with relevant hashtags and a branded graphic.";

function nextFriday() {
  const d = new Date();
  d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const assert = (cond, msg) => { if (!cond) throw new Error(`FAIL: ${msg}`); console.log(`  ok  ${msg}`); };

async function run(name, contextOpts) {
  console.log(`\n== ${name} ==`);
  const browser = await chromium.launch();
  const ctx = await browser.newContext(contextOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/fonts\.g/.test(m.text()) && errors.push(m.text()));
  const shot = (n) => page.screenshot({ path: `${OUT}${name}-${n}.png`, fullPage: false });

  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await shot('01-hq-empty');

  // 1. Create the job
  await page.fill('#brief', BRIEF);
  await page.selectOption('#platform', 'LinkedIn');
  await page.fill('#targetDate', nextFriday());
  await page.click('button:has-text("Send brief to Vektor")');
  await page.waitForSelector('.char-manager[data-state="delegating"]');
  assert(true, 'Manager shows delegating state');
  await shot('02-delegating');

  // 2. Delegation: both agents working, linked to job
  await page.waitForSelector('.char-copywriter[data-state="working"]');
  assert(await page.locator('.char-copywriter .state-badge').innerText() === 'Working', 'Copywriter badge says Working');
  await page.waitForSelector('.char-designer[data-state="working"], .char-designer[data-state="queued"]');
  await shot('03-agents-working');

  // 3. Open the Designer workspace by clicking the character
  await page.click('a.char-designer');
  await page.waitForSelector('.sheet');
  const instr = await page.locator('.assign-instr').innerText();
  assert(/branded LinkedIn graphic/.test(instr) && instr.includes('invoice'), 'Designer workspace shows assigned linked task');
  await shot('04-designer-workspace-working');
  await page.waitForSelector('.sheet .graphic-out', { timeout: 15000 });
  assert(await page.locator('.sheet .demo-tag').first().isVisible(), 'Graphic output is labelled as simulated');
  await shot('05-designer-workspace-ready');
  await page.click('.sheet-head [data-close]');

  // Writer workspace
  await page.click('a.char-copywriter');
  await page.waitForSelector('.sheet .caption-text');
  const cap = await page.locator('.sheet .caption-text').innerText();
  assert(/#CommercialMaintenance/.test(cap) && /invoice/i.test(cap), 'Caption has hashtags and is on-brief');
  await page.click('.sheet a:has-text("Review caption and graphic together")');

  // 4. Review together
  await page.waitForSelector('[data-testid="panel-copy"] .caption-text');
  await page.waitForSelector('[data-testid="panel-graphic"] .graphic-btn');
  const captionV1 = await page.locator('[data-testid="panel-copy"] .caption-text').first().innerText();
  await shot('06-review');
  await page.screenshot({ path: `${OUT}${name}-06b-review-full.png`, fullPage: true });

  // Inspect full graphic
  await page.click('[data-testid="panel-graphic"] .graphic-btn');
  await page.waitForSelector('.lightbox svg');
  const box = await page.locator('.lb-img svg').boundingBox();
  const vp = page.viewportSize();
  const fit = Math.min(vp.width, vp.height - 120, 1080);
  assert(box.width >= fit * 0.85 || box.height >= fit * 0.85, `Full graphic fills the available screen (${Math.round(box.width)}x${Math.round(box.height)} in ${vp.width}x${vp.height})`);
  await shot('07-lightbox');
  await page.click('[data-close-lb]');

  // Request graphic revision
  await page.click('[data-testid="panel-graphic"] button:has-text("Request revision")');
  await page.fill('[data-testid="panel-graphic"] textarea', 'Show the engineer at the service van outside the client’s building, and make the logo more prominent.');
  await shot('08-revision-form');
  await page.click('[data-testid="panel-graphic"] button:has-text("Send to Prism")');
  await page.waitForSelector('[data-testid="panel-graphic"] .pill-revising');
  assert(await page.locator('button[data-approve]').isDisabled(), 'Approve disabled while revising');
  await shot('09-revising');
  await page.waitForSelector('[data-testid="panel-graphic"] .ver:has-text("v2")', { timeout: 15000 });
  const captionAfter = await page.locator('[data-testid="panel-copy"] .caption-text').first().innerText();
  assert(captionAfter === captionV1, 'Caption preserved after graphic revision');
  assert((await page.locator('[data-testid="panel-copy"] h2').innerText()).trim() === 'Caption v1', 'Caption still v1');
  assert(/service van/.test(await page.locator('[data-testid="panel-graphic"] .change-note').innerText()), 'Change note explains the revision');
  assert(await page.locator('[data-testid="panel-graphic"] .hist-item').count() === 2, 'Graphic history shows 2 versions');
  await page.screenshot({ path: `${OUT}${name}-10-revised-full.png`, fullPage: true });

  // 5. Approve
  await page.click('button[data-approve]');
  await page.waitForSelector('.approve-bar[data-status="approved"]');
  assert(/caption v1 with graphic v2/.test(await page.locator('.approve-bar p').innerText()), 'Approval records caption v1 + graphic v2');

  // 6. Refresh and check calendar
  await page.reload();
  await page.waitForSelector('.approve-bar[data-status="approved"]');
  assert(true, 'Approval survives refresh');
  await page.click('[data-nav="calendar"]');
  await page.waitForSelector('[data-testid="cal-entry"]:visible');
  const visibleEntry = page.locator('[data-testid="cal-entry"]:visible').first();
  assert(/LinkedIn/.test(await visibleEntry.innerText()) && /Approved/.test(await visibleEntry.innerText()), 'Calendar shows approved LinkedIn post');
  const fri = nextFriday();
  if (contextOpts.viewport && contextOpts.viewport.width > 640) {
    const label = await visibleEntry.locator('xpath=..').getAttribute('aria-label');
    const expected = new Date(`${fri}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    assert(label === expected, `Entry is on ${expected}`);
  } else {
    const h = await page.locator('.agenda-day h3').first().innerText();
    assert(h.startsWith('Friday'), `Agenda entry under ${h}`);
  }
  await shot('11-calendar');

  // Edit approved content -> needs fresh approval
  await visibleEntry.click();
  await page.click('button:has-text("Edit caption")');
  const ta = page.locator('[data-testid="panel-copy"] textarea');
  await ta.fill((await ta.inputValue()).replace('Three fixes that help:', 'Three fixes that work:'));
  await page.click('button:has-text("Save as new version")');
  await page.waitForSelector('.approve-bar[data-status="needs_reapproval"]');
  assert(true, 'Editing approved caption flags the pair for fresh approval');
  await page.click('[data-nav="calendar"]');
  assert(/Needs re-approval/.test(await page.locator('[data-testid="cal-entry"]:visible').first().innerText()), 'Calendar flags changed post');
  await page.goBack();
  await page.click('button[data-approve]');
  await page.waitForSelector('.approve-bar[data-status="approved"]');
  assert(/caption v2 with graphic v2/.test(await page.locator('.approve-bar p').innerText()), 'Re-approved as caption v2 + graphic v2');

  // Persistence of history after refresh
  await page.reload();
  await page.waitForSelector('[data-testid="panel-graphic"] .hist-item');
  assert(await page.locator('[data-testid="panel-graphic"] .hist-item').count() === 2, 'Graphic history survives refresh');
  assert(/Show the engineer at the service van/.test(await page.locator('[data-testid="panel-graphic"]').innerText()), 'Feedback survives refresh');

  // Reduced motion: status still clear
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(BASE + '#/');
  const anim = await page.locator('.char-manager .eye').first().evaluate((el) => getComputedStyle(el).animationName);
  assert(anim === 'none', 'Reduced motion disables character animation');

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(overflow <= 0, 'No horizontal page scroll');
  assert(errors.length === 0, `No console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
}

await run('desktop', { viewport: { width: 1440, height: 900 } });
await run('phone', { ...devices['iPhone 13'] });
console.log('\nAll acceptance checks passed.');
