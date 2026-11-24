// Records the six agents on an Android-sized phone (Pixel 7): idle, then each at work on a real task event, against
// a given copy of HQ. Test fixtures and slow isolated mocks (20 s per AI reply) make the work visible; nothing is paid.
//   node tests/helpers/record-agents.mjs <app root> <port> <out.webm> [--check]
// --check also verifies (Milestone 15): motion never moves a tap target, takes focus or changes the scroll position;
// work motion runs only for real states and stops when they end; offscreen agents pause; reduced motion stops loops.
import { createRequire } from 'module';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const [rootArg, portArg, outFile, flag] = process.argv.slice(2);
const root = path.resolve(rootArg);
const CHECK = flag === '--check';
const PORT = Number(portArg);
const BASE = `http://127.0.0.1:${PORT}/`;
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`  ok  ${m}`); };
const { hashPassword } = require(path.join(root, 'server', 'auth.js'));
const PW = `pw-${crypto.randomBytes(5).toString('hex')}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-rec-'));
const child = spawn(process.execPath, ['server.js'], { cwd: root, env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(PORT), HQ_DATA_DIR: DATA, HQ_OWNER_PASSWORD_HASH: hashPassword(PW), HQ_TEST_FIXTURES: '1', QUILL_PROVIDER: 'mock', QUILL_MOCK_DELAY_MS: '20000', HQ_SCHEDULER_MS: '0' }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((res) => child.stdout.on('data', (d) => { if (/Shared workspace:/.test(d)) res(); }));
const browser = await chromium.launch();
const VID = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-vid-'));
const signIn = async (page) => { await page.goto(BASE); await page.fill('#ws-password', PW); await page.click('#signin-form button[type=submit]'); await page.waitForSelector('.agent-card.char-manager'); };
const states = (page) => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.agent-card[class*="char-"]')].map((c) => [[...c.classList].find((x) => x.startsWith('char-')).slice(5), c.dataset.state])));
try {
  // Setup (not recorded): a finished post for Calibre, sample results for Vantage.
  const setup = await (await browser.newContext({ ...devices['Pixel 7'] })).newPage();
  await signIn(setup);
  await setup.fill('#brief', 'Facebook post for facilities managers about planned maintenance visits that leave no paperwork behind');
  await setup.click('#brief-form button[type=submit]');
  await setup.waitForTimeout(600);
  const jobId = (await setup.evaluate(() => fetch('api/workspace').then((r) => r.json()))).jobs[0].id;
  await setup.goto(`${BASE}#/agent/analyst`);
  await setup.click('[data-testid="add-sample"]');
  await setup.waitForTimeout(400);
  for (let i = 0; i < 120; i++) { const b = (await setup.evaluate((id) => fetch(`api/workspace/jobs/${id}`).then((r) => r.json()), jobId)).bundle; if (b.tasks.every((t) => t.versions.length && !t.pending)) break; await setup.waitForTimeout(250); }
  await setup.context().close();

  const ctx = await browser.newContext({ ...devices['Pixel 7'], recordVideo: { dir: VID, size: { width: 412, height: 915 } } });
  const page = await ctx.newPage();
  await signIn(page);
  const caption = (t) => page.evaluate((x) => { let el = document.getElementById('rec-caption'); if (!el) { el = document.createElement('div'); el.id = 'rec-caption'; el.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;z-index:9999;background:rgba(0,0,0,.82);color:#fff;font:600 15px system-ui;padding:8px 12px;border-radius:10px;pointer-events:none'; document.body.appendChild(el); } el.textContent = x; }, t);
  const tour = async (label, ms = 1600) => {
    for (const id of ['manager', 'copywriter', 'designer', 'reviewer', 'analyst', 'video']) {
      const card = page.locator(`.agent-card.char-${id}`).first();
      if (!(await card.count())) continue;
      await card.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
      const info = await card.evaluate((el) => ({ name: (el.querySelector('.char-name')?.textContent || '').trim(), state: el.querySelector('.state-badge')?.textContent.trim() || el.dataset.state }));
      await caption(`${label}: ${info.name || id} (${info.state})`);
      await page.waitForTimeout(ms);
    }
  };
  await caption('Idle: each agent makes a small move now and then');
  await page.waitForTimeout(1200);
  await tour('Idle', 2600);

  // Work, from real events, started within a few seconds of each other: Cue drafts a video script, Vantage writes
  // an interpretation, Calibre reviews wording, then Vektor delegates a new post to Quill and Prism.
  await page.goto(`${BASE}#/`);
  await page.waitForSelector('#brief-form');
  await caption('Cue: a video brief (script from the mock, 20 s)');
  await page.selectOption('#format', 'video');
  await page.click('[data-testid="use-sample-clip"]');
  await page.waitForSelector('[data-testid="clip-ok"]', { timeout: 20000 });
  await page.fill('#brief', 'Video post showing how a finished job reaches the office with photos attached');
  await page.click('#brief-form button[type=submit]');
  await page.waitForTimeout(500);
  await caption('Vantage: an AI interpretation (mock, 20 s)');
  await page.goto(`${BASE}#/agent/analyst`);
  await page.click('[data-testid="run-interpret"]');
  await page.waitForTimeout(300);
  await caption('Calibre: an AI wording review (mock, 20 s)');
  await page.goto(`${BASE}#/job/${jobId}`);
  await page.click('[data-testid="run-wording-review"]');
  await page.waitForTimeout(300);
  await page.goto(`${BASE}#/`);
  await page.waitForSelector('#brief-form');
  await caption('Vektor delegates; Quill writes; Prism designs (new post)');
  await page.selectOption('#format', 'image');
  await page.fill('#brief', 'LinkedIn post for operations directors about job sheets that arrive complete');
  await page.click('#brief-form button[type=submit]');
  await page.waitForTimeout(300);
  const working = await states(page);
  await tour('At work', 1500);

  if (CHECK) {
    console.log('\n== Motion checks (phone) ==');
    assert(working.manager === 'delegating' && working.reviewer === 'working' && working.analyst === 'working' && ['working', 'queued'].includes(working.video), `Real task events set the work states (${JSON.stringify(working)})`);
    // Tap targets, focus and scroll stay put while agents animate.
    await page.goto(`${BASE}#/`);
    await page.waitForSelector('.agent-card.char-designer');
    await page.locator('#brief').focus();
    await page.evaluate(() => window.scrollTo(0, 420));
    const snap = () => page.evaluate(() => ({ y: scrollY, focus: document.activeElement?.id, boxes: [...document.querySelectorAll('a.agent-card, .agent-card a, .agent-card button, #brief-form button, [data-testid="plan-week-link"], button[data-focus-brief]')].map((el) => { const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(','); }) }));
    const a = await snap();
    await page.waitForTimeout(4000);
    const b = await snap();
    assert(a.boxes.length > 4 && JSON.stringify(a.boxes) === JSON.stringify(b.boxes), `No tap target moved while agents animated (${a.boxes.length} targets, 4 s)`);
    assert(a.focus === 'brief' && b.focus === 'brief', 'Focus stayed where it was');
    assert(a.y === b.y, `Scroll position unchanged (${a.y} px)`);
    // Work motion ends with the work.
    for (let i = 0; i < 160; i++) { const s = await states(page); if (!['working', 'delegating', 'revising'].includes(s.copywriter) && !['working', 'delegating'].includes(s.manager) && s.designer !== 'working') break; await page.waitForTimeout(250); }
    const after = await states(page);
    const running = await page.evaluate(() => [...document.querySelectorAll('.char-copywriter .stylus-trace, .char-manager .tail-pulse, .char-designer .projection')].map((el) => getComputedStyle(el).animationName));
    assert(running.every((n) => n === 'none'), `When the tasks finish, work motion stops (states ${JSON.stringify(after)})`);
    // Idle motion is occasional: each idle layer is still for most of its cycle.
    const idle = await page.evaluate(() => [...document.querySelectorAll('.agent-card .amb')].map((el) => ({ cls: el.className.baseVal ?? el.className, name: getComputedStyle(el).animationName, dur: parseFloat(getComputedStyle(el).animationDuration) })).filter((x) => x.name !== 'none'));
    assert(idle.length >= 5 && idle.every((x) => x.dur >= 11), `Idle moves are slow and occasional (${idle.length} layers, cycles ${[...new Set(idle.map((x) => x.dur))].join(', ')} s)`);
    assert(new Set(idle.map((x) => x.name)).size >= 5, 'Each character has its own idle move (not one shared loop)');
    // Offscreen agents pause.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(600);
    const paused = await page.evaluate(() => [...document.querySelectorAll('.char.offscreen .amb')].map((el) => getComputedStyle(el).animationPlayState));
    assert(paused.length && paused.every((p) => p === 'paused'), `Offscreen agents pause (${paused.length} layers paused)`);
    // Reduced motion: no loops; state still reads as text.
    const rm = await browser.newContext({ ...devices['Pixel 7'], reducedMotion: 'reduce' });
    const rp = await rm.newPage();
    await signIn(rp);
    const loops = await rp.evaluate(() => [...document.querySelectorAll('.amb, .fx-anim')].filter((el) => getComputedStyle(el).animationName !== 'none').length);
    const badges = await rp.locator('.agent-card .state-badge').count();
    assert(loops === 0 && badges >= 6, `Reduced motion: no animation loops; every agent’s status still shows as text (${badges})`);
    await rm.close();
  }
  await page.close();
  await ctx.close();
  const vid = fs.readdirSync(VID).find((f) => f.endsWith('.webm'));
  fs.copyFileSync(path.join(VID, vid), outFile);
  console.log(`Recording: ${outFile}`);
} finally {
  await browser.close();
  child.kill();
  fs.rmSync(DATA, { recursive: true, force: true });
}
