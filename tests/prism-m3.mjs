// Milestone 3 acceptance: Prism Photo layout through the real UI. Starts its own server (mock Quill) on :4176.
// Uses clearly labelled TEST assets from tests/fixtures (not the official logo, not a real photo).
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const PORT = 4176;
const BASE = `http://127.0.0.1:${PORT}/`;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = path.join(ROOT, 'tests', 'screenshots');
const PHOTO = path.join(ROOT, 'tests', 'fixtures', 'TEST-ASSET-rooftop-hvac-synthetic.jpg');
const LOGO = path.join(ROOT, 'tests', 'fixtures', 'TEST-ASSET-nexai-logo-not-official.png');
const HEADLINE = 'Job finished. Report still waiting.';
const BRIEF = 'Create a LinkedIn post for UK building services directors about rooftop HVAC jobs that are finished on site but still waiting on the engineer report.';
fs.mkdirSync(OUT, { recursive: true });
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`  ok  ${m}`); };

const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), QUILL_PROVIDER: 'mock', QUILL_MOCK_DELAY_MS: '500', OPENAI_API_KEY: '' }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((res) => server.stdout.on('data', (d) => /running at/.test(d) && res()));

const graphicVersions = (page) => page.locator('[data-testid="panel-graphic"] .hist-item').count();
async function waitDraw(page, prev) {
  await page.waitForFunction((p) => { const c = document.querySelector('#studio-canvas'); return c && c.dataset.rendered && c.dataset.rendered !== p; }, prev ?? '', { timeout: 10000 });
  await page.waitForTimeout(150);
  return page.locator('#studio-canvas').getAttribute('data-rendered');
}
async function createJob(page, brief) {
  await page.goto(BASE + '#/');
  await page.fill('#brief', brief);
  await page.selectOption('#platform', 'LinkedIn');
  await page.click('button:has-text("Send brief to Vektor")');
  await page.locator('.job-row').first().click();
  await page.waitForSelector('[data-testid="panel-copy"] .caption-text', { timeout: 15000 });
  await page.waitForSelector('[data-testid="panel-graphic"] .graphic-btn', { timeout: 15000 });
}
function pngSize(buf) {
  assert(buf.slice(1, 4).toString() === 'PNG', 'Downloaded file is a real PNG');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

const browser = await chromium.launch();
try {
  console.log('\n== Desktop, then phone-sized screen (same browser profile) ==');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  // This milestone's checks cover a deployment without the official logo file (the owner supplies one).
  await ctx.route('**/assets/brand/brand.json', (r) => r.fulfill({ contentType: 'application/json', body: '{"logo": false}' }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE);
  await page.evaluate(async () => { localStorage.clear(); await new Promise((r) => { const q = indexedDB.deleteDatabase('nexai-hq-assets'); q.onsuccess = q.onerror = q.onblocked = r; }); });
  await createJob(page, BRIEF);
  const caption = await page.locator('[data-testid="panel-copy"] .caption-text').first().innerText();
  assert(await page.locator('[data-testid="panel-graphic"] .demo-tag').first().innerText() === 'Simulated demo output', 'Simulated graphic v1 still produced and labelled');

  // Open Prism's workspace from the job, then the Photo layout studio.
  await page.locator('[data-testid="panel-graphic"] .mini-char').click();
  await page.click('.sheet a:has-text("Open Photo layout for this job")');
  await page.waitForSelector('#studio-canvas');
  let r = await waitDraw(page);
  assert(/Official Nexai logo not supplied yet/.test(await page.locator('[data-testid="missing-assets"]').innerText()), 'Missing official logo clearly identified before upload');
  await page.setInputFiles('[data-testid="photo-input"]', PHOTO);
  await page.waitForSelector('[data-testid="photo-name"]:has-text("TEST-ASSET-rooftop")');
  r = await waitDraw(page, r);
  await page.fill('#st-headline', HEADLINE);
  r = await waitDraw(page, r);
  await page.screenshot({ path: `${OUT}/m3-desktop-01-logo-missing.png` });
  await page.click('#st-save');
  assert(/add the official Nexai logo/.test(await page.locator('#st-error').innerText()), 'Save refused without the logo, with a clear reason');
  await page.setInputFiles('[data-testid="logo-input"]', LOGO);
  await page.waitForSelector('[data-testid="logo-name"]:has-text("TEST-ASSET-nexai-logo")');
  r = await waitDraw(page, r);
  await page.screenshot({ path: `${OUT}/m3-desktop-02-studio.png` });
  await page.click('#st-save');
  await page.waitForSelector('[data-testid="panel-graphic"] .ver:has-text("v2")');
  assert(await page.locator('[data-testid="panel-graphic"] .demo-tag.photo').isVisible(), 'Graphic v2 saved and labelled "Photo layout"');
  await page.waitForSelector('[data-testid="panel-graphic"] img[data-photo-version="2"]');

  // Phone-sized screen: reposition crop to keep the engineer, bigger logo, save v3.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('[data-testid="panel-graphic"] a:has-text("Open Photo layout")');
  await page.waitForSelector('#studio-canvas');
  r = await waitDraw(page);
  assert(await page.inputValue('#st-headline') === HEADLINE, 'Studio reopens with the saved headline');
  assert(/saved logo, reused/.test(await page.locator('[data-testid="logo-name"]').innerText()), 'Saved logo reused automatically');
  await page.screenshot({ path: `${OUT}/m3-phone-03-studio-before.png` });
  const box = await page.locator('#studio-canvas').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 60, box.y + box.height / 2, { steps: 6 });
  await page.mouse.move(box.x + box.width / 2 - 130, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  r = await waitDraw(page, r);
  const fx = Number(await page.inputValue('#st-fx'));
  assert(fx >= 85, `Dragging the preview moved the crop right towards the engineer (position ${fx}%)`);
  await page.fill('#st-logo-scale', '150');
  r = await waitDraw(page, r);
  assert((await page.locator('#st-logo-out').innerText()) === '150%', 'Logo size increased to 150%');
  await page.screenshot({ path: `${OUT}/m3-phone-04-studio-after.png` });
  // Keep the exact preview pixels to compare with the downloaded PNG.
  await page.evaluate(() => { const c = document.querySelector('#studio-canvas'); window.__preview = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; });
  await page.click('#st-save');
  await page.waitForSelector('[data-testid="panel-graphic"] .ver:has-text("v3")');
  await page.waitForSelector('[data-testid="panel-graphic"] img[data-photo-version="3"]');
  assert(await graphicVersions(page) === 3, 'Graphic history keeps v1 (simulated), v2 and v3');

  // Export v3 as PNG and compare with the preview.
  await page.click('[data-testid="panel-graphic"] .graphic-btn');
  await page.waitForSelector('.lightbox img');
  await page.screenshot({ path: `${OUT}/m3-phone-05-lightbox.png` });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.lightbox button:has-text("Download PNG")')]);
  const exportPath = `${OUT}/m3-export-v3.png`;
  await dl.saveAs(exportPath);
  assert(/graphic-v3-1080x1350\.png$/.test(dl.suggestedFilename()), `Download named ${dl.suggestedFilename()}`);
  const buf = fs.readFileSync(exportPath);
  const { w, h } = pngSize(buf);
  assert(w === 1080 && h === 1350, `Exported PNG is ${w} × ${h}`);
  const diff = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data; const p = window.__preview;
    let n = 0; for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - p[i]) > 2 || Math.abs(d[i + 1] - p[i + 1]) > 2 || Math.abs(d[i + 2] - p[i + 2]) > 2) n++;
    return n;
  }, buf.toString('base64'));
  assert(diff === 0, `Export matches the studio preview pixel for pixel (${diff} differing pixels)`);
  await page.click('[data-close-lb]');

  // Refresh: both versions reopen, caption untouched, approval records the pair.
  await page.reload();
  await page.waitForSelector('[data-testid="panel-graphic"] img[data-photo-version="3"]');
  assert(await graphicVersions(page) === 3, 'All graphic versions survive refresh');
  await page.locator('[data-testid="panel-graphic"] .hist-wrap > summary').click().catch(() => {});
  const histImgs = await page.locator('[data-testid="panel-graphic"] .history img').evaluateAll((els) => els.map((e) => e.naturalWidth));
  assert(histImgs.length === 2 && histImgs.every((wd) => wd === 1080), 'v2 and v3 re-render at full size from browser storage after refresh');
  assert((await page.locator('[data-testid="panel-copy"] .caption-text').first().innerText()) === caption, 'Quill’s caption is exactly unchanged');
  assert((await page.locator('[data-testid="panel-copy"] h2').innerText()).trim() === 'Caption v1', 'Caption still v1');
  await page.click('button[data-approve]');
  await page.waitForSelector('.approve-bar[data-status="approved"]');
  assert(/caption v1 with graphic v3/.test(await page.locator('.approve-bar p').innerText()), 'Approval records caption v1 + graphic v3');

  // Editing the approved design needs fresh approval; calendar follows existing rules.
  await page.click('[data-testid="panel-graphic"] a:has-text("Open Photo layout")');
  r = await waitDraw(page);
  await page.click('.seg-opt:has-text("Top")');
  r = await waitDraw(page, r);
  await page.click('#st-save');
  await page.waitForSelector('.approve-bar[data-status="needs_reapproval"]');
  assert(true, 'Changed approved design (v4) needs fresh approval');
  await page.click('[data-nav="calendar"]');
  assert(/Needs re-approval/.test(await page.locator('[data-testid="cal-entry"]:visible').first().innerText()), 'Calendar flags the changed post');
  await page.goBack();
  await page.click('button[data-approve]');
  await page.waitForSelector('.approve-bar[data-status="approved"]');
  assert(/caption v1 with graphic v4/.test(await page.locator('.approve-bar p').innerText()), 'Re-approval records caption v1 + graphic v4');

  // Storage limits: image store full, then job store full. Nothing is lost and nothing claims success.
  await page.click('[data-testid="panel-graphic"] a:has-text("Open Photo layout")');
  r = await waitDraw(page);
  await page.setInputFiles('[data-testid="photo-input"]', PHOTO);
  r = await waitDraw(page, r);
  await page.evaluate(() => {
    window.__put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () { throw new DOMException('Quota exceeded', 'QuotaExceededError'); };
  });
  await page.click('#st-save');
  await page.waitForSelector('#st-error:has-text("image storage is full")');
  assert(true, 'Full image storage: clear error, still in the studio');
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = window.__put;
    window.__set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (k === 'nexai-hq:v1') throw new DOMException('Quota exceeded', 'QuotaExceededError'); return window.__set.call(this, k, v); };
  });
  await page.click('#st-save');
  await page.waitForSelector('#st-error:has-text("browser’s storage is full, so the change wasn’t saved")');
  assert(true, 'Full job storage: save refused, not reported as saved');
  await page.evaluate(() => { Storage.prototype.setItem = window.__set; });
  await page.screenshot({ path: `${OUT}/m3-phone-06-storage-full.png` });
  await page.reload();
  await page.goto(page.url().replace(/\/studio$/, ''));
  await page.waitForSelector('[data-testid="panel-graphic"] img[data-photo-version="4"]');
  assert(await graphicVersions(page) === 4 && (await page.locator('.approve-bar[data-status="approved"]').count()) === 1, 'After the failed saves and a refresh, the job, 4 versions and approval are intact');

  // Logo reuse on the next job + simulated option still available.
  await createJob(page, 'Create a LinkedIn post for FM directors about PPM visits where the certificate never reaches the client.');
  await page.click('[data-testid="panel-graphic"] a:has-text("Open Photo layout")');
  await waitDraw(page);
  assert(/TEST-ASSET-nexai-logo.*saved logo, reused/.test(await page.locator('[data-testid="logo-name"]').innerText()), 'Next job reuses the saved logo');
  assert(!/logo not supplied/i.test(await page.locator('.studio-preview').innerText()), 'No missing-logo warning on the next job');
  await page.click('[data-studio-cancel]');
  await page.click('[data-testid="panel-graphic"] button:has-text("Request revision")');
  await page.locator('[data-testid="panel-graphic"] textarea').fill('Show the van outside the building');
  await page.click('[data-testid="panel-graphic"] button:has-text("Send to Prism")');
  await page.waitForSelector('[data-testid="panel-graphic"] .ver:has-text("v2")', { timeout: 15000 });
  assert(await page.locator('[data-testid="panel-graphic"] .graphic-out .demo-tag').first().innerText() === 'Simulated demo output', 'Simulated graphic revision still works and is labelled');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(overflow <= 0, 'No horizontal scroll on the phone-sized screen');
  assert(errors.length === 0, `No page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await ctx.close();

  console.log('\n== Phone device (iPhone 13, touch) upload and save ==');
  const pctx = await browser.newContext({ ...devices['iPhone 13'], acceptDownloads: true });
  // This milestone's checks cover a deployment without the official logo file (the owner supplies one).
  await pctx.route('**/assets/brand/brand.json', (r) => r.fulfill({ contentType: 'application/json', body: '{"logo": false}' }));
  const pp = await pctx.newPage();
  await createJob(pp, BRIEF);
  await pp.click('[data-testid="panel-graphic"] a:has-text("Open Photo layout")');
  let pr = await waitDraw(pp);
  await pp.setInputFiles('[data-testid="photo-input"]', PHOTO);
  pr = await waitDraw(pp, pr);
  await pp.setInputFiles('[data-testid="logo-input"]', LOGO);
  pr = await waitDraw(pp, pr);
  await pp.fill('#st-headline', HEADLINE);
  await pp.fill('#st-fx', '92');
  pr = await waitDraw(pp, pr);
  const cbox = await pp.locator('#studio-canvas').boundingBox();
  assert(cbox.y < 844 && cbox.height > 250, 'Preview stays on screen above the controls');
  await pp.screenshot({ path: `${OUT}/m3-iphone-07-studio.png` });
  await pp.tap('#st-save');
  await pp.waitForSelector('[data-testid="panel-graphic"] img[data-photo-version="2"]');
  assert(true, 'Touch upload and save works on a phone');
  await pctx.close();
  console.log('\nAll Milestone 3 checks passed.');
} finally {
  await browser.close();
  server.kill();
}
