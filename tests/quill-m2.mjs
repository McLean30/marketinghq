// Milestone 2 acceptance: Quill AI captions through the real UI, using the deterministic mock provider.
// Starts its own server with QUILL_PROVIDER=mock. Run: npm run test:m2
import { createRequire } from 'module';
import { spawn } from 'child_process';
import fs from 'fs';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const PORT = 4174;
const BASE = `http://127.0.0.1:${PORT}/`;
const OUT = new URL('./screenshots/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const BRIEF = 'Write for an M&E service manager who gets to Friday afternoon with three completed jobs still waiting on engineer photos. Give them one practical way to stop the office chasing.';
const FEEDBACK = 'Open at 4pm on Friday with what the service manager sees on screen. Cut the caption to under 100 words and keep one practical fix.';
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`  ok  ${m}`); };
const words = (t) => t.trim().split(/\s+/).filter(Boolean).length;

const server = spawn(process.execPath, ['server.js'], {
  cwd: new URL('..', import.meta.url).pathname,
  env: { ...process.env, PORT: String(PORT), QUILL_PROVIDER: 'mock', QUILL_MOCK_DELAY_MS: '1200', ANTHROPIC_API_KEY: '' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((res) => server.stdout.on('data', (d) => /running at/.test(d) && res()));
const mockCalls = async () => (await fetch(`${BASE}api/quill/mock-calls`)).json();

async function run(name, ctxOpts) {
  console.log(`\n== ${name} (mock provider) ==`);
  const browser = await chromium.launch();
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = (n, full = false) => page.screenshot({ path: `${OUT}m2-${name}-${n}.png`, fullPage: full });
  const callsBefore = (await mockCalls()).length;

  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('[data-testid="quill-mode"].mock');
  assert(true, 'Brief panel shows Quill is in mock (test) mode');

  await page.fill('#brief', BRIEF);
  await page.selectOption('#platform', 'LinkedIn');
  // Double-tap the submit button: must create exactly one job.
  await page.locator('button:has-text("Send brief to Vektor")').dblclick();
  await page.waitForSelector('.job-row');
  assert((await page.locator('.job-row').count()) === 1, 'Double-tapping "Send brief" creates one job');
  await page.click('.job-row');

  const copy = page.locator('[data-testid="panel-copy"]');
  const graphic = page.locator('[data-testid="panel-graphic"]');
  await page.waitForSelector('[data-testid="panel-copy"] .working-note:has-text("mock provider")', { timeout: 10000 });
  assert(true, 'Caption panel shows Quill working via the provider');
  await copy.locator('.caption-text').first().waitFor({ timeout: 15000 });
  await graphic.locator('.graphic-btn').first().waitFor({ timeout: 15000 });
  const v1 = await copy.locator('.caption-text').first().innerText();
  assert(await copy.locator('.demo-tag.mock').first().isVisible(), 'Caption v1 labelled "Mock AI response (test mode)"');
  let calls = (await mockCalls()).slice(callsBefore);
  assert(calls.length === 1 && calls[0].kind === 'draft' && calls[0].platform === 'LinkedIn' && calls[0].brief === BRIEF, 'Draft request carried the exact brief and platform');
  const graphicSvgBefore = await graphic.locator('.graphic-btn svg').first().evaluate((el) => el.outerHTML);
  await shot('01-draft');

  // Revision with a double-tap on Send.
  await copy.locator('button:has-text("Request revision")').click();
  await copy.locator('textarea').fill(FEEDBACK);
  await copy.locator('button:has-text("Send to Quill")').dblclick();
  await page.waitForSelector('[data-testid="panel-copy"] .pill-revising');
  await shot('02-revising');
  await page.waitForSelector('[data-testid="panel-copy"] .ver:has-text("v2")', { timeout: 15000 });
  calls = (await mockCalls()).slice(callsBefore);
  const revCalls = calls.filter((c) => c.kind === 'revision');
  assert(revCalls.length === 1, 'Double-tapping "Send to Quill" sent exactly one revision request');
  assert(revCalls[0].feedback === FEEDBACK, 'Revision request carried my exact feedback');
  assert(revCalls[0].currentCaption === v1 && revCalls[0].brief === BRIEF && revCalls[0].platform === 'LinkedIn', 'Revision request carried brief, platform and current caption');

  const v2 = await copy.locator('.caption-text').first().innerText();
  assert(/^4pm on Friday/.test(v2), 'Revised caption opens at 4pm on Friday with the screen');
  assert(words(v2) < 100, `Revised caption is under 100 words (${words(v2)})`);
  assert((v2.match(/One fix/g) || []).length === 1, 'Revised caption keeps one practical fix');
  assert(await copy.locator('.hist-item').count() === 2, 'Caption history lists v1 and v2');
  const histText = await copy.locator('.history').evaluate((el) => el.textContent);
  assert(histText.includes(v1.split('\n')[0]) && histText.includes(FEEDBACK), 'v1 text and the feedback remain available in history');
  assert((await graphic.locator('h2').innerText()).trim() === 'Graphic v1', 'Graphic still v1');
  assert((await graphic.locator('.graphic-btn svg').first().evaluate((el) => el.outerHTML)) === graphicSvgBefore, 'Graphic is byte-for-byte unchanged');
  await shot('03-revised', true);

  await page.click('button[data-approve]');
  await page.waitForSelector('.approve-bar[data-status="approved"]');
  assert(/caption v2 with graphic v1/.test(await page.locator('.approve-bar p').innerText()), 'Approval applies to caption v2 + graphic v1');

  // Failure path: next revision fails at the server; work is preserved and Retry sends one request.
  let failNext = true;
  await page.route('**/api/quill/caption', (route) => {
    if (failNext) { failNext = false; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'The Anthropic API returned an error (529). Retry in a moment.', retryable: true }) }); }
    return route.continue();
  });
  await copy.locator('button:has-text("Request revision")').click();
  await copy.locator('textarea').fill('Swap the closing question for something about Monday morning.');
  await copy.locator('button:has-text("Send to Quill")').click();
  await page.waitForSelector('[data-testid="error-copy"]');
  assert(/couldn’t finish the revision/.test(await page.locator('[data-testid="error-copy"]').innerText()), 'Failure shows a clear error with the feedback kept');
  assert((await copy.locator('.caption-text').first().innerText()) === v2, 'Caption v2 still shown after the failure');
  assert(await page.locator('.approve-bar button[data-approve]').isDisabled(), 'Approve is blocked while the revision needs a retry');
  await shot('04-failed');
  const before = (await mockCalls()).length;
  await page.locator('button[data-retry]').dblclick();
  await page.waitForSelector('[data-testid="panel-copy"] .ver:has-text("v3")', { timeout: 15000 });
  assert((await mockCalls()).length - before === 1, 'Retry (double-tapped) sent exactly one request');
  await page.unroute('**/api/quill/caption');
  await page.waitForSelector('.approve-bar[data-status="needs_reapproval"]');
  assert(true, 'Revised caption makes the approved pair need fresh approval');
  await page.click('button[data-approve]');
  await page.waitForSelector('.approve-bar[data-status="approved"]');
  assert(/caption v3 with graphic v1/.test(await page.locator('.approve-bar p').innerText()), 'Re-approval applies to caption v3 + graphic v1');

  // Refresh persistence + calendar
  await page.reload();
  await page.waitForSelector('.approve-bar[data-status="approved"]');
  assert(await copy.locator('.hist-item').count() === 3, 'All three caption versions survive refresh');
  assert(await copy.locator('.src-mini').first().innerText() === 'Mock', 'History marks the source of each version');
  await page.click('[data-nav="calendar"]');
  const entry = page.locator('[data-testid="cal-entry"]:visible').first();
  await entry.waitFor();
  assert(/LinkedIn/.test(await entry.innerText()) && /Approved/.test(await entry.innerText()), 'Calendar shows the approved LinkedIn post after refresh');
  await shot('05-calendar');

  // Refresh during an in-flight request: no silent resend, work kept, Retry offered.
  await entry.click();
  await copy.locator('button:has-text("Request revision")').click();
  const sentBefore = (await mockCalls()).length;
  await copy.locator('textarea').fill('Make the hashtags more specific to M&E.');
  await copy.locator('button:has-text("Send to Quill")').click();
  await page.waitForSelector('[data-testid="panel-copy"] .pill-revising');
  for (let i = 0; i < 20 && (await mockCalls()).length === sentBefore; i++) await page.waitForTimeout(100);
  await page.reload();
  await page.waitForSelector('[data-testid="error-copy"]');
  assert(/refreshed before Quill replied/.test(await page.locator('[data-testid="error-copy"]').innerText()), 'Refresh mid-request offers Retry instead of silently resending');
  await page.click('button[data-cancel-rev]');
  await page.waitForSelector('.approve-bar[data-status="approved"]');
  assert(await copy.locator('.hist-item').count() === 3, 'Cancelling the failed revision keeps v3 and the approval');

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(overflow <= 0, 'No horizontal page scroll');
  assert(errors.length === 0, `No page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
}

try {
  await run('desktop', { viewport: { width: 1440, height: 900 } });
  await run('phone', { ...devices['iPhone 13'] });
  console.log('\nAll Milestone 2 mock checks passed.');
} finally {
  server.kill();
}
