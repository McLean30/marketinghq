// Milestone 6 acceptance: robotic team redesign. Local demo data, mock captions, own server on :4179.
// Saves previews to design/previews/: phone + desktop HQ, mockup comparison, workspace, and a delegation recording.
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 4179;
const BASE = `http://127.0.0.1:${PORT}/`;
const PREV = path.join(ROOT, 'design', 'previews');
const VID = path.join(ROOT, 'tests', 'screenshots', 'm6-video');
fs.mkdirSync(PREV, { recursive: true });
fs.rmSync(VID, { recursive: true, force: true });
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`  ok  ${m}`); };
const BRIEF = 'Create a LinkedIn post for UK commercial maintenance directors about finished jobs still waiting on engineer photos before they can be invoiced.';

const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), QUILL_PROVIDER: 'mock', QUILL_MOCK_DELAY_MS: '2500', ANTHROPIC_API_KEY: '', HQ_OWNER_PASSWORD_HASH: '' }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((res) => server.stdout.on('data', (d) => /running at/.test(d) && res()));

const anim = (page, sel) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).animationName);
const state = (page, id) => page.locator(`.agent-card.char-${id}`).getAttribute('data-state');
async function fresh(page) {
  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('.agent-card.char-manager img');
  await page.waitForFunction(() => [...document.querySelectorAll('.agent-card img')].every((i) => i.complete && i.naturalWidth > 0));
}
async function sendBrief(page) {
  await page.click('button[data-focus-brief]');
  assert(await page.evaluate(() => document.activeElement?.id === 'brief'), '"New brief" takes you to the brief box');
  await page.fill('#brief', BRIEF);
  await page.click('button:has-text("Send brief to Vektor")');
}

const browser = await chromium.launch();
try {
  console.log('\n== Phone (iPhone 13 emulation): HQ against the approved mockup ==');
  const phone = await browser.newContext({ ...devices['iPhone 13'] });
  const pp = await phone.newPage();
  const errors = [];
  pp.on('pageerror', (e) => errors.push(e.message));
  await fresh(pp);
  await pp.screenshot({ path: path.join(PREV, 'm6-phone-hq.jpg'), type: 'jpeg', quality: 85 });
  const vp = pp.viewportSize();
  for (const [id, name] of [['manager', 'Vektor'], ['copywriter', 'Quill'], ['designer', 'Prism']]) {
    const box = await pp.locator(`.agent-card.char-${id}`).boundingBox();
    assert(box.x >= 0 && box.x + box.width <= vp.width && box.y + box.height <= vp.height, `${name} card fully on the first screen (${Math.round(box.width)}×${Math.round(box.height)})`);
    const size = await pp.locator(`.agent-card.char-${id} .char-name`).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    assert(size >= 22, `${name} name is legible (${size}px)`);
  }
  for (const sel of ['button[data-focus-brief]', '[data-testid="plan-week-link"]']) {
    const b = await pp.locator(sel).boundingBox();
    assert(b.y + b.height <= vp.height + 2 && b.height >= 44, `${sel.includes('focus') ? '“New brief”' : '“Plan a content week”'} is on the first screen and at least 44px tall`);
  }
  // Framing: Vektor's claws and stinger, Quill's hand and stylus, Prism's lens and projection are inside their cards.
  const inside = await pp.evaluate(() => {
    const check = (sel, xs, ys) => {
      const card = document.querySelector(sel).getBoundingClientRect();
      const art = document.querySelector(`${sel} .agent-art-inner`).getBoundingClientRect();
      const W = +document.querySelector(`${sel} img`).getAttribute('width');
      const k = art.width / W;
      return xs.every((x, i) => { const px = art.left + x * k, py = art.top + ys[i] * k; return px >= card.left && px <= card.right && py >= card.top && py <= card.bottom; });
    };
    return {
      vektor: check('.agent-card.char-manager', [40, 880, 498, 300], [470, 300, 140, 520]), // left claw, right claw, stinger, right pincer tip
      quill: check('.agent-card.char-copywriter', [400, 300, 230], [455, 380, 230]), // stylus tip, hand, visor
      prism: check('.agent-card.char-designer', [315, 210, 300], [125, 270, 420]), // aperture, projection, hand
    };
  });
  assert(inside.vektor && inside.quill && inside.prism, 'Framing keeps claws + stinger, hand + stylus, lens + projection in view');
  const overflow = await pp.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert(overflow <= 0, 'No horizontal scroll on the phone');
  // Side-by-side with the mockup for review.
  execFileSync('python3', ['-c', `
from PIL import Image
a=Image.open(${JSON.stringify(path.join(PREV, 'm6-phone-hq.jpg'))}).convert('RGB'); m=Image.open(${JSON.stringify(path.join(ROOT, 'design', 'approved-hq-mockup.png'))}).convert('RGB')
m=m.resize((int(m.width*a.height/m.height), a.height))
s=Image.new('RGB',(a.width+m.width+24,a.height),(0,0,0)); s.paste(m,(0,0)); s.paste(a,(m.width+24,0)); s.save(${JSON.stringify(path.join(PREV, 'm6-phone-vs-mockup.jpg'))}, quality=85)`]);
  assert(true, 'Saved design/previews/m6-phone-vs-mockup.jpg (mockup left, running app right)');

  console.log('\n== Desktop layout ==');
  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const dp = await desk.newPage();
  dp.on('pageerror', (e) => errors.push(e.message));
  await fresh(dp);
  await dp.screenshot({ path: path.join(PREV, 'm6-desktop-hq.jpg'), type: 'jpeg', quality: 85 });
  const heights = await dp.locator('.agent-card').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
  assert(Math.max(...heights) - Math.min(...heights) <= 2, `Desktop: three cards in one row at equal height (${heights.join(', ')}px)`);
  const btn = await dp.locator('[data-testid="plan-week-link"]').boundingBox();
  assert(btn.y + btn.height <= 900, 'Desktop: both actions visible without scrolling');

  console.log('\n== Keyboard: each card is one link to its own workspace ==');
  await dp.keyboard.press('Tab'); // skip link
  const order = [];
  for (let i = 0; i < 10; i++) {
    await dp.keyboard.press('Tab');
    order.push(await dp.evaluate(() => document.activeElement.dataset.agent || document.activeElement.textContent.trim().slice(0, 22)));
  }
  const iv = order.indexOf('manager');
  assert(iv >= 0 && order[iv + 1] === 'copywriter' && order[iv + 2] === 'designer' && order[iv + 3] === 'New brief' && order[iv + 4] === 'Plan a content week', `Tab order: … ${order.slice(iv, iv + 5).join(' → ')}`);
  while ((await dp.evaluate(() => document.activeElement.dataset.agent)) !== 'copywriter') await dp.keyboard.press('Shift+Tab');
  const ring = await dp.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  assert(ring !== 'none', 'Focused card shows a visible focus ring');
  for (const [id, name, key] of [['copywriter', 'Quill', 'Enter'], ['designer', 'Prism', 'Enter'], ['manager', 'Vektor', 'Enter']]) {
    await dp.locator(`.agent-card.char-${id}`).focus();
    await dp.keyboard.press(key);
    await dp.waitForSelector('.sheet .size-hero');
    assert(dp.url().endsWith(`#/agent/${id}`) && (await dp.locator('.sheet .size-hero .char-name').innerText()) === name, `${name} card opens ${name}’s workspace with the same artwork`);
    assert(await dp.locator(`.sheet .size-hero img[src$="${id === 'manager' ? 'vektor' : id === 'copywriter' ? 'quill' : 'prism'}.webp"]`).count() === 1, `${name} workspace uses the same artwork file`);
    await dp.keyboard.press('Escape');
    await dp.waitForSelector('.sheet', { state: 'detached' });
  }
  assert(await dp.locator('.agent-card .char-name').evaluateAll((els) => els.every((e) => e.tagName === 'SPAN' && e.textContent.trim())), 'Names, roles and status are real text, not part of the image');

  console.log('\n== Demo job: states drive the animation (recorded) ==');
  const rec = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: VID, size: { width: 1280, height: 720 } } });
  const rp = await rec.newPage();
  rp.on('pageerror', (e) => errors.push(e.message));
  await fresh(rp);
  assert(['manager', 'copywriter', 'designer'].every(Boolean) && (await state(rp, 'manager')) === 'idle' && (await anim(rp, '.char-manager .tail-pulse')) === 'none', 'Idle: Vektor still, no tail pulse');
  await rp.waitForTimeout(800);
  await sendBrief(rp);
  await rp.waitForSelector('.agent-card.char-manager[data-state="delegating"]');
  assert((await anim(rp, '.agent-card.char-manager .tail-pulse')) === 'tailPulse', 'Delegating: pulse travels along Vektor’s tail');
  await rp.waitForSelector('.agent-card.char-copywriter[data-state="working"]', { timeout: 8000 });
  assert((await anim(rp, '.agent-card.char-copywriter .stylus-trace')) === 'trace', 'Quill working: stylus traces a line');
  assert((await anim(rp, '.agent-card.char-manager .tail-pulse')) === 'none', 'Vektor’s pulse stops once delegation ends');
  await rp.waitForSelector('.agent-card.char-designer[data-state="working"]');
  assert((await anim(rp, '.agent-card.char-designer .aperture')) === 'apertureTurn' && (await anim(rp, '.agent-card.char-designer .projection')) === 'focusIn', 'Prism working: aperture turns, projection comes into focus');
  assert((await rp.locator('.agent-card.char-copywriter .state-badge').innerText()).trim() === 'Working', 'Quill’s status text says Working');
  await rp.waitForTimeout(1500);
  await rp.waitForSelector('.agent-card.char-copywriter[data-state="awaiting_review"]', { timeout: 15000 });
  assert((await anim(rp, '.agent-card.char-copywriter .stylus-trace')) === 'none', 'Quill’s stylus stops when the caption is done');
  await rp.waitForSelector('.agent-card.char-designer[data-state="awaiting_review"]', { timeout: 15000 });
  assert((await anim(rp, '.agent-card.char-designer .aperture')) === 'none', 'Prism’s aperture stops when the graphic is done');
  await rp.waitForTimeout(800);
  await rp.click('.job-row');
  await rp.click('button[data-approve]');
  await rp.waitForSelector('.approve-bar[data-status="approved"]');
  await rp.click('[data-nav="hq"]');
  await rp.waitForSelector('.agent-card.char-manager');
  for (const id of ['manager', 'copywriter', 'designer']) assert((await state(rp, id)) === 'idle', `${id === 'manager' ? 'Vektor' : id === 'copywriter' ? 'Quill' : 'Prism'} back to idle after approval`);
  await rp.waitForTimeout(1200);
  const video = await rp.video().path();
  await rec.close();
  const mp4 = path.join(PREV, 'm6-delegation.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-vf', 'fps=30,scale=1280:-2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '26', '-movflags', '+faststart', mp4]);
  assert(fs.statSync(mp4).size > 50000, `Saved design/previews/m6-delegation.mp4 (${Math.round(fs.statSync(mp4).size / 1024)} KB)`);

  console.log('\n== Workspace on the phone while working ==');
  await fresh(pp);
  await pp.click('button[data-focus-brief]');
  await pp.fill('#brief', BRIEF);
  await pp.click('button:has-text("Send brief to Vektor")');
  await pp.waitForSelector('.agent-card.char-designer[data-state="working"]', { timeout: 10000 });
  await pp.locator('.agent-card.char-designer').click();
  await pp.waitForSelector('.sheet .size-hero[data-state="working"]');
  await pp.waitForTimeout(700);
  assert((await anim(pp, '.sheet .size-hero .aperture')) === 'apertureTurn', 'Prism’s workspace hero animates with the same state');
  const lens = await pp.evaluate(() => { const r = document.querySelector('.sheet .size-hero .aperture').getBoundingClientRect(); const h = document.querySelector('.sheet .size-hero').getBoundingClientRect(); return r.top >= h.top && r.bottom <= h.bottom && r.width > 40; });
  assert(lens, 'Prism’s lens is visible in the workspace hero at phone size');
  assert(await pp.locator('.sheet h3:has-text("Assigned task")').isVisible() || (await pp.locator('.sheet h3:has-text("Assigned task")').count()) === 1, 'Assigned task is right under the hero');
  await pp.screenshot({ path: path.join(PREV, 'm6-phone-prism-workspace.jpg'), type: 'jpeg', quality: 85 });

  console.log('\n== Reduced motion ==');
  const rm = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const rmp = await rm.newPage();
  await fresh(rmp);
  await sendBrief(rmp);
  await rmp.waitForSelector('.agent-card.char-manager[data-state="delegating"]');
  assert((await anim(rmp, '.agent-card.char-manager .tail-pulse')) === 'none', 'Reduced motion: no tail pulse');
  assert((await rmp.locator('.agent-card.char-manager .state-badge').innerText()).trim() === 'Delegating', 'Reduced motion: status still reads “Delegating”');
  const border = await rmp.locator('.agent-card.char-manager').evaluate((el) => getComputedStyle(el).borderTopColor);
  assert(border === 'rgb(46, 230, 255)', 'Reduced motion: active card is still highlighted without animation');
  await rmp.waitForSelector('.agent-card.char-designer[data-state="working"]', { timeout: 10000 });
  assert((await anim(rmp, '.agent-card.char-designer .aperture')) === 'none' && (await anim(rmp, '.agent-card.char-copywriter .stylus-trace')) === 'none', 'Reduced motion: aperture and stylus stay still');
  await rm.close();

  assert(errors.length === 0, `No page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  console.log('\nAll Milestone 6 checks passed.');
} finally {
  await browser.close();
  server.kill();
}
