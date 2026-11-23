// Pre-Milestone 11 update: the three new portraits, an occupied HQ (ambient + work motion), and Kieran's editorial
// voice as the business profile default. Shared workspace on :4187 (mock provider), demo mode on :4188, and two
// profile-migration servers on :4189.
//   1. Calibre, Vantage and Cue use their new portraits on HQ and in their workspaces; phone crops keep the lens,
//      chart and camera; names, roles and status are real text
//   2. Ambient motion while idle (badges still read Idle), distinct rhythms, Vektor's handoff on a real delegation,
//      Cue's tally/progress tied to the render state, the motion switch, reduced motion, offscreen pausing
//   3. The editorial voice: brief 1 (JobTrack lessons) editorial, brief 2 (direct-response promo) promo for that job
//      only, a fresh ordinary brief back to the default; provider path, Vektor, Prism, Cue and Calibre follow it
//   4. Existing customised profiles keep every edit and gain the voice; an edited voice is never overwritten
//   5. A 15–20 s desktop recording (idle → real delegation → ambient), a phone preview and a reduced-motion check
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { spawn, execFileSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TMP = path.join(ROOT, 'tests', '.tmp-update');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const { hashPassword } = require('../server/auth');
const { DEFAULT_VOICE } = await import('../public/js/voice.js');

const BASE = 'http://127.0.0.1:4187/';
const DEMO = 'http://127.0.0.1:4188/';
const PREVIEWS = path.join(ROOT, 'design', 'previews');
const PASSWORD = `test-owner-${crypto.randomBytes(6).toString('hex')}`;
const HASH = hashPassword(PASSWORD);
const BRIEF1 = 'Tell LinkedIn what we learned building JobTrack Pro and how that shapes the workflows we build for clients.';
const BRIEF2 = 'Write a direct-response promo for our free workflow review with a clear booking CTA.';
const BRIEF3 = 'LinkedIn post for UK facilities directors about planning PPM visits so engineers arrive with the right parts.';
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`  ok  ${m}`); };

function start(port, env) {
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((res) => { let o = ''; child.stdout.on('data', (d) => { o += d; if (/Shared workspace: (on|off)/.test(o)) res(child); }); });
}
const shared = await start(4187, { HQ_DATA_DIR: path.join(TMP, 'shared'), HQ_OWNER_PASSWORD_HASH: HASH, QUILL_PROVIDER: 'mock', QUILL_MOCK_DELAY_MS: '300', HQ_SCHEDULER_MS: '0' });
const demo = await start(4188, {});
const servers = [shared, demo];

async function signIn(page, base = BASE) {
  await page.goto(`${base}#/workspace`);
  await page.waitForSelector('#ws-password, [data-signout]');
  if (await page.locator('[data-signout]').count()) { await page.waitForFunction(() => document.getElementById('ws-pill')?.textContent === 'Shared workspace'); return; } // session kept across a restart
  await page.fill('#ws-password', PASSWORD);
  await page.click('#signin-form button[type=submit]');
  await page.waitForFunction(() => document.getElementById('ws-pill')?.textContent === 'Shared workspace');
}
const api = (page, p) => page.evaluate(async (p) => (await fetch(p, { cache: 'no-store' })).json(), p);
const anims = (page) => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.team .agent-card')].map((c) => [c.dataset.agent, c.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').map((a) => a.effect?.getTiming().duration)])));
async function newPost(page, base, brief, { platform = 'LinkedIn', submit = 'click' } = {}) {
  await page.goto(`${base}#/`);
  await page.waitForSelector('#brief-form');
  await page.selectOption('#format', 'image');
  await page.fill('#brief', brief);
  await page.selectOption('#platform', platform);
  if (submit === 'click') await page.click('#brief-form button[type=submit]');
  else await page.evaluate(() => document.getElementById('brief-form').requestSubmit());
  return page.evaluate(async (b) => {
    for (let i = 0; i < 60; i++) {
      const local = JSON.parse(localStorage.getItem('nexai-hq:v1') || '{"jobs":[]}').jobs.find((j) => j.brief === b);
      if (local) return local.id;
      const r = await fetch('api/workspace', { cache: 'no-store' });
      if (r.ok) { const e = (await r.json()).jobs.find((x) => x.bundle.job.brief === b); if (e) return e.id; }
      await new Promise((r2) => setTimeout(r2, 200));
    }
    return null;
  }, brief);
}

const browser = await chromium.launch();
const errors = [];
const watch = (page, name) => page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
try {
  console.log('\n== 1. New portraits for Calibre, Vantage and Cue ==');
  const dctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const dp = await dctx.newPage();
  watch(dp, 'desktop');
  await dp.goto(DEMO);
  await dp.waitForSelector('.agent-card.char-video');
  for (const [id, file, name, role] of [['reviewer', 'calibre.webp', 'Calibre', 'Brand & Quality Reviewer'], ['analyst', 'vantage.webp', 'Vantage', 'Marketing Analyst'], ['video', 'cue.webp', 'Cue', 'Video Creator']]) {
    const w = await dp.locator(`.agent-card.char-${id} .art-portrait img`).evaluate((i) => (i.complete ? i.naturalWidth : 0));
    const src = await dp.locator(`.agent-card.char-${id} .art-portrait img`).getAttribute('src');
    assert(src.endsWith(file) && w === 446, `${name}: HQ card uses ${file} (446 × 695, like Quill and Prism)`);
    const link = dp.getByRole('link', { name: new RegExp(`${name}.*${role.replace(/&/g, '&')}.*Idle`) });
    assert(await link.count() === 1, `${name}: name, role and status are read out from real text`);
    await dp.goto(`${DEMO}#/agent/${id}`);
    await dp.waitForSelector(`.sheet .size-hero img[src$="${file}"]`);
    assert(/Idle/.test(await dp.locator('.sheet .size-hero .state-badge').innerText()) && (await dp.locator('.sheet .size-hero .char-name').innerText()) === name, `${name}: workspace uses the same portrait, with name and status as text`);
    await dp.locator('.sheet .size-hero').screenshot({ path: `${PREVIEWS}/m10u-${id}-workspace.png` });
    await dp.goto(`${DEMO}#/`);
    await dp.waitForSelector('.agent-card.char-video');
  }
  const sizes = await dp.locator('.team .agent-card:not(.char-manager)').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
  assert(new Set(sizes).size === 1, `Desktop: Quill, Prism, Calibre, Vantage and Cue cards share one height (${sizes[0]} px)`);

  const pctx = await browser.newContext({ ...devices['iPhone 13'] });
  const pp = await pctx.newPage();
  watch(pp, 'phone');
  await pp.goto(DEMO);
  await pp.waitForSelector('.agent-card.char-video .art-banner img');
  for (const [id, label] of [['reviewer', 'inspection lens'], ['analyst', 'chart'], ['video', 'camera']]) {
    const banner = pp.locator(`.agent-card.char-${id} .art-banner`);
    const box = await banner.boundingBox();
    assert(box && box.width >= 140 && box.height >= 60, `Phone: ${id} strip shows the ${label} band (${Math.round(box.width)} × ${Math.round(box.height)} px)`);
    await banner.screenshot({ path: `${TMP}/phone-${id}.png` });
  }
  await pp.screenshot({ path: `${PREVIEWS}/m10u-phone-hq.png`, fullPage: true });

  console.log('\n== 2. An occupied HQ: ambient motion, real work motion, controls ==');
  await dp.goto(DEMO);
  await dp.waitForSelector('.agent-card.char-video');
  await dp.waitForTimeout(500);
  let a = await anims(dp);
  assert(Object.keys(a).length === 6 && Object.values(a).every((x) => x.length >= 1), `Idle: every agent has a quiet loop (${Object.entries(a).map(([k, v]) => `${k} ${v.length}`).join(', ')})`);
  assert((await dp.locator('.team .state-badge').allInnerTexts()).every((t) => /Idle/.test(t)), 'Idle motion still reads as Idle on every badge');
  const firstDur = Object.values(a).map((x) => Math.round(x[0]));
  assert(new Set(firstDur).size === 6, `Each agent has its own rhythm (${firstDur.map((d) => `${(d / 1000).toFixed(1)}s`).join(', ')})`);
  const steady = await dp.locator('.team .char-name').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
  await dp.waitForTimeout(1500);
  const steady2 = await dp.locator('.team .char-name').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
  assert(JSON.stringify(steady) === JSON.stringify(steady2), 'Names and layout stay still while the artwork moves');
  // Real delegation: Vektor's handoff runs to the agents receiving the job.
  await dp.fill('#brief', BRIEF3);
  await dp.evaluate(() => document.getElementById('brief-form').requestSubmit());
  await dp.waitForSelector('.agent-card.char-manager[data-state="delegating"]');
  await dp.waitForSelector('svg.handoff[data-to]');
  const to = await dp.locator('svg.handoff').getAttribute('data-to');
  const pulses = await dp.locator('svg.handoff path.pulse').count();
  const receiving = await dp.locator('.agent-card.receiving').evaluateAll((els) => els.map((e) => e.dataset.agent).sort().join(' '));
  assert(to === 'copywriter designer' && pulses === 2 && receiving === 'copywriter designer', 'A real delegation draws Vektor’s handoff to Quill and Prism');
  assert((await dp.locator('.agent-card.char-manager').evaluate((c) => c.getAnimations({ subtree: true }).map((x) => x.animationName).join(' '))).includes('vkLift'), 'Vektor lifts the stinger while delegating');
  await dp.waitForSelector('.agent-card.char-copywriter[data-state="working"]', { timeout: 6000 });
  assert(!(await dp.locator('svg.handoff path').count()), 'The handoff clears once delegation is over');
  const qw = await dp.locator('.agent-card.char-copywriter').evaluate((c) => c.getAnimations({ subtree: true }).map((x) => x.animationName).join(' '));
  assert(/trace/.test(qw) && /qlWrite/.test(qw), 'Quill writing: the stylus traces lines');
  await dp.waitForFunction(() => [...document.querySelectorAll('.team .agent-card')].every((c) => c.dataset.state !== 'working' && c.dataset.state !== 'delegating'), null, { timeout: 15000 });
  a = await anims(dp);
  assert(Object.values(a).every((x) => x.length >= 1), 'Back to ambient motion after the work');
  // Cue: tally light and monitor progress follow the render state.
  await dp.selectOption('#format', 'video');
  await dp.click('[data-testid="use-sample-clip"]');
  await dp.waitForSelector('[data-testid="clip-ok"]');
  await dp.fill('#brief', 'Twenty-second walkthrough of an engineer recording a receipt on site.');
  await dp.evaluate(() => document.getElementById('brief-form').requestSubmit());
  await dp.waitForFunction(() => JSON.parse(localStorage.getItem('nexai-hq:v1')).tasks.some((t) => t.type === 'video'));
  const vtask = await dp.evaluate(() => JSON.parse(localStorage.getItem('nexai-hq:v1')).tasks.find((t) => t.type === 'video').id);
  await dp.evaluate(async (id) => { const S = await import('./js/store.js'); S.setRendering(id, 0.42); }, vtask);
  await dp.waitForSelector('.agent-card.char-video[data-rendering]');
  const cue = await dp.locator('.agent-card.char-video').evaluate((c) => ({ p: getComputedStyle(c).getPropertyValue('--p').trim(), tally: getComputedStyle(c.querySelector('.cu-tally')).opacity, badge: c.querySelector('.state-badge').textContent }));
  assert(cue.p === '0.420' && Number(cue.tally) === 1 && /Rendering/.test(cue.badge), `Cue while rendering: tally on, monitor progress at ${cue.p}, badge “${cue.badge.trim()}”`);
  await dp.evaluate(async (id) => { const S = await import('./js/store.js'); S.setRendering(id, null); }, vtask);
  await dp.waitForFunction(() => !document.querySelector('.agent-card.char-video[data-rendering]'));
  assert(true, 'Tally off again when no render is running');
  // Offscreen pausing
  await dp.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await dp.waitForTimeout(400);
  const paused = await dp.evaluate(() => { const c = document.querySelector('.agent-card.char-reviewer'); return { off: c.classList.contains('offscreen'), states: c.getAnimations({ subtree: true }).map((x) => x.playState) }; });
  assert(paused.off && paused.states.every((s) => s === 'paused'), 'Loops pause while the agents are scrolled off screen');
  await dp.evaluate(() => window.scrollTo(0, 0));
  // Motion switch, persisted
  await dp.click('#motion-toggle');
  await dp.waitForTimeout(200);
  a = await anims(dp);
  assert(Object.values(a).every((x) => x.length === 0) && (await dp.getAttribute('#motion-toggle', 'aria-pressed')) === 'false', 'Motion switch off: no loops anywhere');
  await dp.reload();
  await dp.waitForSelector('.agent-card.char-video');
  assert((await dp.evaluate(() => document.documentElement.dataset.motion)) === 'off' && Object.values(await anims(dp)).every((x) => x.length === 0), 'The switch is remembered after a reload');
  await dp.screenshot({ path: `${PREVIEWS}/m10u-motion-off.png` });
  await dp.click('#motion-toggle');
  // Reduced motion
  const rctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const rp = await rctx.newPage();
  watch(rp, 'reduced');
  await rp.goto(DEMO);
  await rp.waitForSelector('.agent-card.char-video');
  await rp.waitForTimeout(300);
  assert((await rp.evaluate(() => document.documentElement.dataset.motion)) === 'off' && Object.values(await anims(rp)).every((x) => x.length === 0), 'Reduced motion: no loops by default');
  assert((await rp.locator('.team .state-badge').allInnerTexts()).every((t) => /Idle/.test(t)), 'Reduced motion: states still shown as text');
  await rp.click('#motion-toggle');
  assert(Object.values(await anims(rp)).every((x) => x.length >= 1), 'Choosing motion on overrides the system setting (your choice)');
  await rctx.close();

  console.log('\n== 3. Editorial voice: two briefs back to back, then a fresh ordinary brief (provider path) ==');
  const sctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const sp = await sctx.newPage();
  watch(sp, 'shared');
  await signIn(sp);
  const ws0 = await api(sp, 'api/workspace');
  assert(ws0.profile.versions.at(-1).data.writing.voice === DEFAULT_VOICE, 'A new profile starts with Kieran’s editorial voice');
  await sp.goto(`${BASE}#/profile`);
  await sp.waitForSelector('#profile-form');
  assert((await sp.locator('[data-pf="writing.voice"]').inputValue()) === DEFAULT_VOICE, 'The voice is an editable Business Profile field');
  const ids = [];
  for (const [brief, mode] of [[BRIEF1, 'editorial'], [BRIEF2, 'promo'], [BRIEF3, 'editorial']]) {
    const id = await newPost(sp, BASE, brief);
    ids.push(id);
    await sp.goto(`${BASE}#/job/${id}`);
    await sp.waitForSelector('[data-approve]:not([disabled])', { timeout: 30000 });
    const chip = sp.locator('[data-testid="job-tone"]');
    assert((await chip.getAttribute('data-mode')) === mode, `${mode === 'promo' ? 'Brief 2' : brief === BRIEF1 ? 'Brief 1' : 'Fresh brief'}: tone shown on the job is ${mode} (“${(await chip.locator('summary').innerText()).replace(/\s+/g, ' ').replace(/^Tone /, '')}”)`);
  }
  const calls = await api(sp, 'api/quill/mock-calls');
  const forBrief = (b) => calls.filter((c) => c.brief === b && c.kind === 'draft').at(-1);
  assert(forBrief(BRIEF1).tone === 'editorial' && forBrief(BRIEF1).voice === DEFAULT_VOICE, 'Brief 1 reached the provider as editorial, with the profile voice');
  assert(forBrief(BRIEF2).tone === 'promo', 'Brief 2 reached the provider as a direct-response promotion (this job only)');
  assert(forBrief(BRIEF3).tone === 'editorial' && forBrief(BRIEF3).voice === DEFAULT_VOICE, 'The fresh ordinary brief is back on the profile default');
  const ws1 = await api(sp, 'api/workspace');
  const cap = (id) => ws1.jobs.find((e) => e.id === id).bundle.tasks.find((t) => t.type === 'copy').versions[0].content.text;
  const head = (id) => ws1.jobs.find((e) => e.id === id).bundle.tasks.find((t) => t.type === 'graphic').versions[0].content.headline.join(' ');
  assert(/We’ve been building JobTrack Pro/.test(cap(ids[0])) && /work in progress/.test(cap(ids[0])) && !/book your slot/i.test(cap(ids[0])), 'Brief 1 caption: an honest update in first-person plural, work in progress kept distinct, no booking push');
  assert(/Request a Free Workflow Review: book your slot/.test(cap(ids[1])), 'Brief 2 caption: the profile’s CTA as a clear booking call to action');
  assert(/Free workflow review/.test(head(ids[1])) && !/Free workflow review/.test(head(ids[0])), `Prism’s headlines follow the tone (“${head(ids[0])}” / “${head(ids[1])}”)`);
  const { buildUserMessage } = require('../server/quill.js');
  const m1 = buildUserMessage({ kind: 'draft', brief: BRIEF1, platform: 'LinkedIn' });
  const m2 = buildUserMessage({ kind: 'draft', brief: BRIEF2, platform: 'LinkedIn' });
  assert(m1.includes(DEFAULT_VOICE) && /No hard sell/.test(m1) && /direct-response promotion/.test(m2) && !m2.includes('Write like we’re giving someone'), 'Live provider prompt carries the editorial voice by default and the promo tone only for brief 2');
  // Calibre reviews against the job's tone
  for (const [i, label] of [[0, 'Brief 1'], [1, 'Brief 2']]) {
    await sp.goto(`${BASE}#/job/${ids[i]}`);
    await sp.waitForSelector('[data-run-review]');
    await sp.click('[data-run-review]');
    for (let k = 0; k < 40; k++) { if (((await api(sp, 'api/workspace')).jobs.find((e) => e.id === ids[i]).bundle.job.reviews || []).length) break; await sp.waitForTimeout(250); }
  }
  const ws2 = await api(sp, 'api/workspace');
  const toneCheck = (id) => ws2.jobs.find((e) => e.id === id).bundle.job.reviews.at(-1).checks.find((c) => c.id === 'tone');
  assert(toneCheck(ids[0]).result === 'pass' && /editorial voice/.test(toneCheck(ids[0]).label), 'Calibre: brief 1 passes the editorial-voice check');
  assert(toneCheck(ids[1]).result === 'pass' && /direct-response/.test(toneCheck(ids[1]).label), 'Calibre: brief 2 passes the promotion check (clear CTA)');
  const ctask = ws2.jobs.find((e) => e.id === ids[2]).bundle.job.taskIds.copy;
  await sp.goto(`${BASE}#/job/${ids[2]}`);
  await sp.click(`[data-toggle-edit="${ctask}"]`);
  await sp.fill(`#ed-${ctask}`, `${cap(ids[2])}\n\nBook now!! Limited time only.`);
  await sp.click(`[data-edit-form="${ctask}"] button[type=submit]`);
  await sp.waitForTimeout(600);
  await sp.click('[data-run-review]');
  await sp.waitForSelector('[data-testid="review-panel"] :text("Reads like a hard sell")', { timeout: 10000 });
  assert(true, 'Calibre flags hard-sell wording added to an editorial post');
  await sp.screenshot({ path: `${PREVIEWS}/m10u-tone-job.png`, fullPage: false });
  // Vektor's plan request carries the tone and voice; the plan shows it
  await sp.goto(`${BASE}#/week/new`);
  await sp.fill('#wk-brief', 'Plan a week about what we are learning from building JobTrack Pro for maintenance teams.');
  await sp.click('[data-testid="ai-plan-btn"]');
  await sp.waitForSelector('[data-testid="plan-editor"]');
  const pc = (await api(sp, 'api/vektor/mock-plan-calls')).at(-1);
  assert(pc.tone === 'editorial' && pc.voice === DEFAULT_VOICE && (await sp.locator('[data-testid="job-tone"]').getAttribute('data-mode')) === 'editorial', 'Vektor’s plan request and plan page carry the editorial voice');
  // Cue's script follows the tone
  const vjobs = [];
  for (const brief of ['Video walkthrough of an engineer recording a receipt in JobTrack Pro.', 'Direct-response promo video for our free workflow review with a booking CTA.']) {
    await sp.goto(`${BASE}#/`);
    await sp.selectOption('#format', 'video');
    await sp.click('[data-testid="use-sample-clip"]');
    await sp.waitForSelector('[data-testid="clip-ok"]');
    await sp.fill('#brief', brief);
    await sp.waitForTimeout(1300); // the brief form ignores a second submit within 1.2 s (double-tap guard)
    await sp.click('#brief-form button[type=submit]');
    let vid;
    for (let i = 0; i < 40 && !vid; i++) { vid = (await api(sp, 'api/workspace')).jobs.find((e) => e.bundle.job.brief === brief)?.id; if (!vid) await sp.waitForTimeout(250); }
    vjobs.push(vid);
  }
  await sp.waitForTimeout(8000);
  const ws3 = await api(sp, 'api/workspace');
  const last = (id) => ws3.jobs.find((e) => e.id === id).bundle.tasks.find((t) => t.type === 'video').draft.scenes.at(-1);
  // From M11A Cue's script comes from the configured provider (the mock here), which receives the job's tone.
  assert(last(vjobs[0]).title === 'Takeaway' && /takeaway/i.test(last(vjobs[0]).caption), 'Cue (editorial): the script ends on a practical takeaway');
  assert(last(vjobs[1]).title === 'Call to action' && /Request a Free Workflow Review/.test(last(vjobs[1]).caption), 'Cue (promo brief): the script ends on one booking CTA, for that job only');
  await sctx.close();

  console.log('\n== 4. Existing customised profiles survive the update ==');
  // Shared workspace saved before the update: a customised profile without the voice field.
  const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'profile-seed.json'), 'utf8'));
  delete seed.writing.voice;
  const custom = JSON.parse(JSON.stringify(seed));
  custom.audience.summary = 'Custom: FM directors across the North West';
  custom.proof[0].claims = 'Used daily by our own team since spring';
  custom.offers = [{ id: 'of_x', wording: 'Spring workflow audit at half price', start: '2026-01-01', end: '2027-12-31', active: true }];
  custom.writing.process = 'Our own process wording.';
  const old = { version: 1, rev: 4, jobs: {}, brand: { rev: 0, data: {} }, plans: {}, profile: { rev: 2, versions: [{ id: 'pv1-aaaaaa', n: 1, savedAt: 1, savedBy: 'seed', data: seed }, { id: 'pv2-bbbbbb', n: 2, savedAt: 2, savedBy: 'computer', data: custom }] } };
  const oldDir = path.join(TMP, 'old');
  fs.mkdirSync(oldDir, { recursive: true });
  fs.writeFileSync(path.join(oldDir, 'workspace.json'), JSON.stringify(old));
  let mig = await start(4189, { HQ_DATA_DIR: oldDir, HQ_OWNER_PASSWORD_HASH: HASH, QUILL_PROVIDER: 'mock', HQ_SCHEDULER_MS: '0' });
  servers.push(mig);
  const mctx = await browser.newContext();
  const mp = await mctx.newPage();
  await signIn(mp, 'http://127.0.0.1:4189/');
  let prof = (await api(mp, 'api/workspace')).profile;
  const v3 = prof.versions.at(-1);
  const expect = JSON.parse(JSON.stringify(custom));
  expect.writing.voice = DEFAULT_VOICE;
  assert(prof.versions.length === 3 && v3.n === 3 && /editorial voice added/.test(v3.savedBy) && JSON.stringify(v3.data) === JSON.stringify({ ...custom, writing: { ...custom.writing, voice: DEFAULT_VOICE } }), 'Shared workspace: the customised profile gains the voice as version 3; audience, approved claims, offer and process wording unchanged');
  assert(prof.versions[1].id === 'pv2-bbbbbb' && JSON.stringify(prof.versions[1].data) === JSON.stringify(custom), 'The owner’s version 2 is kept exactly in the history');
  mig.kill();
  await new Promise((r) => (mig.exitCode !== null ? r() : mig.once('exit', r)));
  // An owner-edited voice is never overwritten.
  const edited = JSON.parse(fs.readFileSync(path.join(oldDir, 'workspace.json'), 'utf8'));
  const ev = JSON.parse(JSON.stringify(edited.profile.versions.at(-1).data));
  ev.writing.voice = 'Our own edited voice: short, dry and practical.';
  edited.profile.versions.push({ id: 'pv4-cccccc', n: 4, savedAt: 4, savedBy: 'computer', data: ev });
  edited.profile.rev += 1;
  fs.writeFileSync(path.join(oldDir, 'workspace.json'), JSON.stringify(edited));
  mig = await start(4189, { HQ_DATA_DIR: oldDir, HQ_OWNER_PASSWORD_HASH: HASH, QUILL_PROVIDER: 'mock', HQ_SCHEDULER_MS: '0' });
  servers.push(mig);
  await signIn(mp, 'http://127.0.0.1:4189/');
  await mp.reload(); // the file was edited by hand while the server was stopped (no revision bump), so load afresh
  await mp.waitForSelector('#ws-pill');
  prof = (await api(mp, 'api/workspace')).profile;
  assert(prof.versions.length === 4 && prof.versions.at(-1).data.writing.voice === 'Our own edited voice: short, dry and practical.', 'An edited voice survives a restart untouched');
  const own = await newPost(mp, 'http://127.0.0.1:4189/', BRIEF3);
  await mp.goto(`http://127.0.0.1:4189/#/job/${own}`);
  await mp.waitForSelector('[data-testid="job-tone"]');
  await mp.locator('[data-testid="job-tone"]').evaluate((d) => { d.open = true; });
  assert(/short, dry and practical/.test(await mp.locator('[data-testid="voice-text"]').innerText()), 'Jobs work to the owner’s edited voice');
  mig.kill();
  await mctx.close();
  // Browser demo mode: a customised profile saved before the update.
  const lctx = await browser.newContext();
  const old2 = { jobs: [], tasks: [], log: [], brand: {}, plans: [], profile: { rev: 2, versions: [{ id: 'pv1-aaaaaa', n: 1, savedAt: 1, savedBy: 'seed', data: seed }, { id: 'pv2-bbbbbb', n: 2, savedAt: 2, savedBy: 'computer', data: custom }] } };
  await lctx.addInitScript((v) => { if (!localStorage.getItem('nexai-hq:v1')) localStorage.setItem('nexai-hq:v1', v); }, JSON.stringify(old2));
  const lp = await lctx.newPage();
  await lp.goto(DEMO);
  await lp.waitForSelector('.agent-card.char-video');
  const lprof = await lp.evaluate(() => JSON.parse(localStorage.getItem('nexai-hq:v1')).profile);
  assert(lprof.versions.length === 3 && lprof.versions[2].data.writing.voice === DEFAULT_VOICE && lprof.versions[2].data.audience.summary === custom.audience.summary && lprof.versions[2].data.offers[0].wording === custom.offers[0].wording && lprof.versions[2].data.proof[0].claims === custom.proof[0].claims, 'Demo mode: the customised profile gains the voice; every owner edit is kept');
  await lp.reload();
  await lp.waitForSelector('.agent-card.char-video');
  assert((await lp.evaluate(() => JSON.parse(localStorage.getItem('nexai-hq:v1')).profile.versions.length)) === 3, 'Seeding happens once (no new version on reload)');
  await lctx.close();

  console.log('\n== 5. Recordings: 15–20 s desktop HQ (idle → real delegation → ambient), phone, reduced motion ==');
  const recDir = path.join(TMP, 'rec');
  const rec = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: recDir, size: { width: 1440, height: 900 } } });
  const rpg = await rec.newPage();
  const tOpen = Date.now();
  await rpg.goto(DEMO);
  await rpg.waitForSelector('.agent-card.char-video .art-portrait img');
  await rpg.waitForFunction(() => [...document.querySelectorAll('.agent-card img')].filter((i) => i.offsetParent).every((i) => i.complete && i.naturalWidth));
  const lead = (Date.now() - tOpen) / 1000 + 0.3;
  await rpg.waitForTimeout(5500); // all six idle
  await rpg.fill('#brief', 'LinkedIn post for maintenance directors about getting job sheets signed before the van leaves.');
  await rpg.evaluate(() => document.getElementById('brief-form').requestSubmit());
  await rpg.waitForTimeout(12500); // delegation handoff, Quill and Prism at work, back to ambient
  await rec.close();
  const raw = fs.readdirSync(recDir).map((f) => path.join(recDir, f)).find((f) => f.endsWith('.webm'));
  const outVid = path.join(PREVIEWS, 'm10u-hq-ambient-and-handoff.mp4');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-ss', lead.toFixed(2), '-i', raw, '-t', '18', '-an', '-c:v', 'libx264', '-crf', '28', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outVid]);
  const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', outVid]).toString());
  assert(dur >= 15 && dur <= 20, `Desktop recording: ${dur.toFixed(1)} s (${path.relative(ROOT, outVid)})`);
  for (const [t, n] of [[2, 'idle'], [6.3, 'handoff'], [16, 'ambient']]) execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-ss', String(t), '-i', outVid, '-frames:v', '1', '-vf', 'scale=720:-1', path.join(TMP, `rec-${n}.png`)]);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', path.join(TMP, 'rec-idle.png'), '-i', path.join(TMP, 'rec-handoff.png'), '-i', path.join(TMP, 'rec-ambient.png'), '-filter_complex', 'vstack=inputs=3', path.join(PREVIEWS, 'm10u-recording-frames.png')]);
  const phoneRec = await browser.newContext({ ...devices['iPhone 13'], recordVideo: { dir: path.join(TMP, 'prec'), size: { width: 390, height: 844 } } });
  const ppg = await phoneRec.newPage();
  const tp = Date.now();
  await ppg.goto(DEMO);
  await ppg.waitForSelector('.agent-card.char-video .art-banner img');
  const plead = (Date.now() - tp) / 1000 + 0.3;
  await ppg.waitForTimeout(4000);
  await ppg.evaluate(() => window.scrollTo({ top: 500, behavior: 'smooth' }));
  await ppg.waitForTimeout(3500);
  await phoneRec.close();
  const praw = fs.readdirSync(path.join(TMP, 'prec')).map((f) => path.join(TMP, 'prec', f)).find((f) => f.endsWith('.webm'));
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-ss', plead.toFixed(2), '-i', praw, '-t', '7', '-an', '-c:v', 'libx264', '-crf', '28', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(PREVIEWS, 'm10u-phone-hq.mp4')]);
  assert(fs.statSync(path.join(PREVIEWS, 'm10u-phone-hq.mp4')).size > 10000, 'Phone preview recorded (design/previews/m10u-phone-hq.mp4)');

  assert(!errors.length, `No uncaught page errors${errors.length ? `: ${errors.join('; ')}` : ''}`);
  console.log('\nTeam update tests passed.');
} finally {
  await browser.close();
  for (const s of servers) s.kill();
  fs.rmSync(TMP, { recursive: true, force: true });
}
