// Milestone 4 acceptance: one private workspace across two independent browsers (desktop + iPhone emulation).
// Starts its own server (mock Quill captions, fresh data folder, test owner password) on :4177 and restarts it mid-test.
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA = path.join(ROOT, 'tests', '.tmp-m4-data');
fs.rmSync(DATA, { recursive: true, force: true });
process.env.HQ_DATA_DIR = DATA; // before loading server modules
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const { hashPassword } = require('../server/auth');

const PORT = 4177;
const BASE = `http://127.0.0.1:${PORT}/`;
const OUT = path.join(ROOT, 'tests', 'screenshots');
const PHOTO = path.join(ROOT, 'tests', 'fixtures', 'TEST-ASSET-rooftop-hvac-synthetic.jpg');
const LOGO = path.join(ROOT, 'tests', 'fixtures', 'TEST-ASSET-nexai-logo-not-official.png');
const PASSWORD = `test-owner-${crypto.randomBytes(6).toString('hex')}`;
const HASH = hashPassword(PASSWORD);
fs.mkdirSync(OUT, { recursive: true });
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`  ok  ${m}`); };

let server;
async function startServer() {
  server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), HQ_DATA_DIR: DATA, HQ_OWNER_PASSWORD_HASH: HASH, HQ_TEST_FIXTURES: '1', QUILL_PROVIDER: 'mock', QUILL_MOCK_DELAY_MS: '500', OPENAI_API_KEY: '' }, stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  await new Promise((res) => server.stdout.on('data', (d) => { out += d; if (/Shared workspace: on/.test(out)) res(); }));
}
async function stopServer() {
  const exited = new Promise((r) => server.once('exit', r));
  server.kill();
  await exited;
}

async function signIn(page) {
  await page.goto(`${BASE}#/workspace`);
  await page.fill('#ws-password', PASSWORD);
  await page.click('#signin-form button[type=submit]');
  await page.waitForSelector('text=You’re signed in');
  await page.waitForFunction(() => document.getElementById('ws-pill')?.textContent === 'Shared workspace'); // pill is hidden at phone width; status lives on HQ there
}
async function waitDraw(page, prev) {
  await page.waitForFunction((p) => { const c = document.querySelector('#studio-canvas'); return c && c.dataset.rendered && c.dataset.rendered !== p; }, prev ?? '', { timeout: 15000 });
  await page.waitForTimeout(150);
  return page.locator('#studio-canvas').getAttribute('data-rendered');
}
const graphicH2 = (page) => page.locator('[data-testid="panel-graphic"] h2').innerText().then((t) => t.trim());
const serverJob = (page, id) => page.evaluate(async (jid) => (await fetch(`api/workspace/jobs/${jid}`)).json(), id);
async function downloadV(page, n, name) {
  await page.click(`[data-testid="panel-graphic"] .graphic-btn`);
  await page.waitForSelector('.lightbox img');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.lightbox button:has-text("Download PNG")')]);
  assert(dl.suggestedFilename().includes(`graphic-v${n}-1080x1350.png`), `Downloaded ${dl.suggestedFilename()}`);
  const file = path.join(OUT, name);
  await dl.saveAs(file);
  await page.click('[data-close-lb]');
  return fs.readFileSync(file);
}
async function samePixels(page, a, b) {
  return page.evaluate(async ([x, y]) => {
    const load = async (b64) => { const i = new Image(); i.src = `data:image/png;base64,${b64}`; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const g = c.getContext('2d'); g.drawImage(i, 0, 0); return { w: i.width, h: i.height, d: g.getImageData(0, 0, i.width, i.height).data }; };
    const A = await load(x); const B = await load(y);
    if (A.w !== B.w || A.h !== B.h) return -1;
    let n = 0; for (let k = 0; k < A.d.length; k++) if (A.d[k] !== B.d[k]) n++;
    return n;
  }, [a.toString('base64'), b.toString('base64')]);
}

await startServer();
const browser = await chromium.launch();
try {
  console.log('\n== Signed-out access (no session) ==');
  let r = await fetch(`${BASE}api/workspace`);
  assert(r.status === 401, 'Workspace data refused without sign-in (401)');
  r = await fetch(`${BASE}api/quill/caption`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert(r.status === 401, 'Caption (paid AI) endpoint refused without sign-in (401)');
  r = await fetch(`${BASE}api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'wrong-password' }) });
  assert(r.status === 401 && !(r.headers.get('set-cookie') || '').includes('hq_session=') , 'Wrong password gets no session');

  console.log('\n== Desktop browser: create job and upload assets ==');
  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const dp = await desk.newPage();
  const errors = [];
  dp.on('pageerror', (e) => errors.push(`desktop: ${e.message}`));
  await signIn(dp);
  await dp.goto(`${BASE}#/`);
  await dp.fill('#brief', 'Create a LinkedIn post for UK building services directors about rooftop HVAC jobs finished on site but still waiting on the engineer report.');
  await dp.click('button:has-text("Send brief to Vektor")');
  await dp.locator('.job-row').first().click();
  await dp.waitForSelector('[data-testid="panel-copy"] .caption-text', { timeout: 15000 });
  await dp.waitForSelector('[data-testid="panel-graphic"] .graphic-btn', { timeout: 15000 });
  const jobUrl = dp.url();
  const jobId = /#\/job\/([a-z0-9_]+)/.exec(jobUrl)[1];
  const caption = await dp.locator('[data-testid="panel-copy"] .caption-text').first().innerText();
  await dp.click('[data-testid="panel-graphic"] a:has-text("Open Photo layout")');
  let d = await waitDraw(dp);
  await dp.setInputFiles('[data-testid="photo-input"]', PHOTO);
  d = await waitDraw(dp, d);
  await dp.setInputFiles('[data-testid="logo-input"]', LOGO);
  d = await waitDraw(dp, d);
  await dp.fill('#st-headline', 'Job finished. Report still waiting.');
  d = await waitDraw(dp, d);
  await dp.click('#st-save');
  await dp.waitForSelector('[data-testid="panel-graphic"] img[data-photo-version="2"]');
  let sj = await serverJob(dp, jobId);
  const g2 = sj.bundle.tasks.find((t) => t.type === 'graphic').versions[1].content;
  assert(sj.rev >= 2 && g2.mode === 'photo', 'Job and Photo layout v2 stored on the server');
  assert(fs.existsSync(path.join(DATA, 'assets', `${g2.photoId}.bin`)) && fs.existsSync(path.join(DATA, 'assets', `${g2.logoId}.bin`)), 'Original photo and logo stored on the server disk');

  console.log('\n== Phone browser (iPhone 13 emulation, separate storage): revise crop ==');
  const phone = await browser.newContext({ ...devices['iPhone 13'], acceptDownloads: true });
  const pp = await phone.newPage();
  pp.on('pageerror', (e) => errors.push(`phone: ${e.message}`));
  assert((await pp.evaluate(() => localStorage.length).catch(() => 0)) === 0, 'Phone context starts with empty browser storage');
  await signIn(pp);
  await pp.goto(jobUrl);
  await pp.waitForSelector('[data-testid="panel-graphic"] img[data-photo-version="2"]', { timeout: 15000 });
  assert((await pp.locator('[data-testid="panel-copy"] .caption-text').first().innerText()) === caption, 'Phone opens the same job with the same caption');
  await pp.click('[data-testid="panel-graphic"] a:has-text("Open Photo layout")');
  let p = await waitDraw(pp);
  assert(/saved logo, reused/.test(await pp.locator('[data-testid="logo-name"]').innerText()), 'Phone reuses the workspace logo');
  await pp.fill('#st-fx', '92');
  p = await waitDraw(pp, p);
  await pp.screenshot({ path: `${OUT}/m4-phone-01-studio.png` });
  await pp.tap('#st-save');
  await pp.waitForSelector('[data-testid="panel-graphic"] img[data-photo-version="3"]');
  assert((await graphicH2(pp)) === 'Graphic v3', 'Phone saved graphic v3 (crop moved to keep the engineer)');

  console.log('\n== Stale desktop tab attempts approval ==');
  assert((await graphicH2(dp)) === 'Graphic v2' || (await dp.locator('[data-testid="remote-update"]').count()) > 0, 'Desktop tab still shows v2 (or a "updated on your phone" notice), not a silent swap');
  await dp.screenshot({ path: `${OUT}/m4-desktop-02-stale.png` });
  await dp.click('button[data-approve]');
  await dp.waitForSelector('[data-testid="conflict"]');
  const conflictText = await dp.locator('[data-testid="conflict"]').innerText();
  assert(/Not approved/.test(conflictText) && /Graphic v3 saved \(Photo layout\)/.test(conflictText) && /your phone/.test(conflictText), 'Approval refused; notice says graphic v3 was saved on your phone');
  sj = await serverJob(dp, jobId);
  assert(!sj.bundle.job.approval, 'Server recorded no approval');
  await dp.screenshot({ path: `${OUT}/m4-desktop-03-conflict.png` });
  await dp.click('button:has-text("Load the latest version")');
  await dp.waitForSelector('[data-testid="panel-graphic"] img[data-photo-version="3"]');
  assert((await graphicH2(dp)) === 'Graphic v3', 'Desktop now shows graphic v3 for review');
  await dp.click('button[data-approve]');
  await dp.waitForSelector('.approve-bar[data-status="approved"]');
  assert(/caption v1 with graphic v3/.test(await dp.locator('.approve-bar p').innerText()), 'Desktop approves caption v1 + graphic v3');
  sj = await serverJob(dp, jobId);
  assert(sj.bundle.job.approval.graphicVersion === 3 && sj.bundle.job.approval.copyVersion === 1, 'Server approval records caption v1 + graphic v3');
  await pp.reload();
  await pp.waitForSelector('.approve-bar[data-status="approved"]');
  assert(/caption v1 with graphic v3/.test(await pp.locator('.approve-bar p').innerText()), 'Phone sees the same approval');
  const before = await downloadV(dp, 3, 'm4-export-before-restart.png');

  console.log('\n== Server restart ==');
  await stopServer();
  await startServer();
  await dp.reload();
  await dp.waitForSelector('[data-testid="panel-graphic"] img[data-photo-version="3"]', { timeout: 15000 });
  assert(/caption v1 with graphic v3/.test(await dp.locator('.approve-bar p').innerText()), 'After restart: still signed in, job approved with caption v1 + graphic v3');
  assert((await dp.locator('[data-testid="panel-copy"] .caption-text').first().innerText()) === caption, 'After restart: caption unchanged');
  const after = await downloadV(dp, 3, 'm4-export-after-restart.png');
  const diff = await samePixels(dp, before, after);
  assert(diff === 0, `After restart: exported v3 PNG is identical to the export before restart (${diff} differing values)`);
  assert(after.readUInt32BE(16) === 1080 && after.readUInt32BE(20) === 1350, 'Export is 1080 × 1350');

  console.log('\n== Signed-out browser, direct URLs ==');
  const anon = await browser.newContext();
  const ap = await anon.newPage();
  await ap.goto(jobUrl);
  await ap.waitForSelector('text=Job not in this browser');
  const anonText = await ap.locator('main').innerText();
  assert(!anonText.includes('Report still waiting') && !anonText.includes(caption.slice(0, 30)), 'Signed-out browser sees a sign-in prompt, not the job');
  let res = await ap.request.get(`${BASE}api/workspace/jobs/${jobId}`);
  assert(res.status() === 401, 'Direct job URL refused (401)');
  res = await ap.request.get(`${BASE}api/assets/${g2.photoId}`);
  assert(res.status() === 401, 'Direct photo URL refused (401)');
  res = await ap.request.get(`${BASE}api/assets/${g2.logoId}`);
  assert(res.status() === 401, 'Direct logo URL refused (401)');
  res = await ap.request.put(`${BASE}api/workspace/jobs/${jobId}`, { data: { baseRev: 0, bundle: {} } });
  assert(res.status() === 401, 'Signed-out save refused (401)');
  await anon.close();

  console.log('\n== Editing on both devices: Prism keeps unsaved edits ==');
  await dp.click('[data-testid="panel-graphic"] a:has-text("Open Photo layout")');
  d = await waitDraw(dp);
  await dp.fill('#st-headline', 'Edited on the laptop.');
  d = await waitDraw(dp, d);
  await pp.click('[data-testid="panel-graphic"] a:has-text("Open Photo layout")');
  p = await waitDraw(pp);
  await pp.fill('#st-logo-scale', '140');
  p = await waitDraw(pp, p);
  await pp.tap('#st-save');
  await pp.waitForSelector('[data-testid="panel-graphic"] img[data-photo-version="4"]');
  await dp.click('#st-save');
  await dp.waitForSelector('#sync-slot [data-testid="conflict"], #sync-slot [data-testid="remote-update"]');
  assert(/changed on another device/.test(await dp.locator('#st-error').innerText().catch(() => '')) || (await dp.locator('#sync-slot').innerText()).includes('Graphic v4'), 'Laptop save refused because the phone saved v4');
  assert((await dp.inputValue('#st-headline')) === 'Edited on the laptop.', 'Unsaved laptop headline still in the editor');
  await dp.click('#sync-slot button:has-text("Load latest and keep my edits")');
  await dp.waitForSelector('#st-save:has-text("Save as graphic v5")');
  assert((await dp.inputValue('#st-headline')) === 'Edited on the laptop.', 'After loading the latest, the laptop edits are kept');
  // Leaving Prism with unsaved edits asks first.
  let asked = 0;
  dp.once('dialog', (dlg) => { asked++; dlg.dismiss(); });
  await dp.click('a:has-text("Back to review")');
  await dp.waitForTimeout(300);
  assert(asked === 1 && /\/studio$/.test(dp.url()) && (await dp.inputValue('#st-headline')) === 'Edited on the laptop.', 'Leaving with unsaved edits asks first; staying keeps the edits');
  await dp.click('#st-save');
  await dp.waitForSelector('[data-testid="panel-graphic"] img[data-photo-version="5"]');
  sj = await serverJob(dp, jobId);
  const gv = sj.bundle.tasks.find((t) => t.type === 'graphic').versions;
  assert(gv.length === 5 && gv[3].content.logoScale === 1.4 && gv[4].content.headline === 'Edited on the laptop.', 'Server keeps both: phone v4 and laptop v5');
  await dp.waitForSelector('.approve-bar[data-status="needs_reapproval"]');
  assert(true, 'Changed design needs fresh approval');

  console.log('\n== Import this browser’s work (separate legacy browser) ==');
  const legacy = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const lp = await legacy.newPage();
  lp.on('pageerror', (e) => errors.push(`legacy: ${e.message}`));
  await lp.goto(BASE);
  await lp.waitForSelector('#ws-pill:has-text("This browser only")');
  await lp.fill('#brief', 'Create a LinkedIn post for FM directors about PPM visits where the certificate never reaches the client.');
  await lp.click('button:has-text("Send brief to Vektor")');
  await lp.locator('.job-row').first().click();
  await lp.waitForSelector('[data-testid="panel-graphic"] .graphic-btn', { timeout: 15000 });
  const localJobId = /#\/job\/([a-z0-9_]+)/.exec(lp.url())[1];
  await lp.click('[data-testid="panel-graphic"] a:has-text("Open Photo layout")');
  let l = await waitDraw(lp);
  await lp.setInputFiles('[data-testid="photo-input"]', PHOTO);
  l = await waitDraw(lp, l);
  await lp.setInputFiles('[data-testid="logo-input"]', LOGO);
  l = await waitDraw(lp, l);
  await lp.click('#st-save');
  await lp.waitForSelector('[data-testid="panel-graphic"] img[data-photo-version="2"]');
  const localPhotoId = await lp.evaluate((id) => JSON.parse(localStorage.getItem('nexai-hq:v1')).tasks.find((t) => t.jobId === id && t.type === 'graphic').versions[1].content.photoId, localJobId);
  // Simulate a photo that's gone from this browser.
  await lp.evaluate((id) => new Promise((res) => { const q = indexedDB.open('nexai-hq-assets'); q.onsuccess = () => { const tx = q.result.transaction('assets', 'readwrite'); tx.objectStore('assets').delete(id); tx.oncomplete = res; }; }), localPhotoId);
  await signIn(lp);
  await lp.click('button:has-text("Preview import")');
  await lp.waitForSelector('[data-testid="import-plan"]');
  const planText = await lp.locator('[data-testid="import-plan"]').innerText();
  assert(/Will import/.test(planText) && /PPM visits/.test(planText), 'Preview lists the local job to import');
  assert(/Missing from this browser/.test(await lp.locator('[data-testid="import-missing"]').innerText()), 'Preview reports the missing photo');
  await lp.screenshot({ path: `${OUT}/m4-import-preview.png` });
  await lp.click('button:has-text("Import 1 job")');
  await lp.waitForSelector('[data-testid="import-result"]');
  const resText = await lp.locator('[data-testid="import-result"]').innerText();
  assert(/1 job imported/.test(resText) && /Missing images/.test(resText), `Import result: ${resText.split('\n')[0]}`);
  await lp.click('button:has-text("Preview import")');
  await lp.waitForSelector('[data-testid="import-plan"]');
  assert(/Already in workspace: skipped/.test(await lp.locator('[data-testid="import-plan"]').innerText()), 'Retrying the import skips the job');
  assert(await lp.locator('button:has-text("Nothing new to import")').isDisabled(), 'Nothing new to import, so no duplicate');
  const ws = await lp.evaluate(async () => (await fetch('api/workspace')).json());
  assert(ws.jobs.filter((j) => j.id === localJobId).length === 1 && ws.jobs.length === 2, 'Workspace has exactly one copy of the imported job (2 jobs total)');
  const imported = ws.jobs.find((j) => j.id === localJobId);
  assert(imported.bundle.tasks.find((t) => t.type === 'graphic').versions.length === 2, 'Imported job keeps its graphic versions without duplicates');
  assert((await lp.evaluate((id) => JSON.parse(localStorage.getItem('nexai-hq:v1')).jobs.some((j) => j.id === id), localJobId)), 'Browser original kept after import');
  await legacy.close();

  assert(errors.length === 0, `No page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await desk.close();
  await phone.close();
  console.log('\nAll Milestone 4 checks passed.');
} finally {
  await browser.close();
  await stopServer().catch(() => {});
  fs.rmSync(DATA, { recursive: true, force: true });
}
