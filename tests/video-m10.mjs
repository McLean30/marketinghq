// Milestone 10 acceptance: Cue, the Video Creator. Real browser rendering, no paid services, simulated publishing.
// No real JobTrack Pro footage is in the repository, so this uses the clearly labelled SAMPLE recording
// (app/samples/, an illustrative mock-up with a red banner on every frame) through the normal upload control.
//
// Shared workspace on :4185 (mock captions, test clock) and browser demo mode on :4186:
//   1. HQ shows six agents; Cue's card and workspace open
//   2. A video brief with an uploaded clip → template script + storyboard → edit → render v1 → download v1
//   3. The downloaded file checked in a separate player (ffprobe/ffmpeg): duration, caption band, logo, screen action
//   4. Approve + schedule v1; change ONLY the closing on-screen caption; render v2: post caption intact, v1 still
//      plays, the schedule is held, approval needs v2; approve v2 and publish (demo): receipt names video v2
//   5. Phone: watch the whole clip from the review screen
//   6. Failures keep the draft: a device that can't export, and a render that fails
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { spawn, execFileSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA = path.join(ROOT, 'tests', '.tmp-m10-data');
const TMP = path.join(ROOT, 'tests', '.tmp-m10-files');
for (const d of [DATA, TMP]) fs.rmSync(d, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const { hashPassword } = require('../server/auth');

const PORT = 4185;
const BASE = `http://127.0.0.1:${PORT}/`;
const DEMO = 'http://127.0.0.1:4186/';
const OUT = path.join(ROOT, 'tests', 'screenshots');
const PREVIEWS = path.join(ROOT, 'design', 'previews');
const SAMPLE = path.join(ROOT, 'app', 'samples', 'sample-receipt-recording.mp4');
const PASSWORD = `test-owner-${crypto.randomBytes(6).toString('hex')}`;
const BRIEF = 'Create a 20-second LinkedIn walkthrough for a UK maintenance director showing how an engineer records a receipt in JobTrack Pro. Show the step on screen, explain why it helps the office, and finish with one practical takeaway.';
fs.mkdirSync(OUT, { recursive: true });
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`  ok  ${m}`); };

function start(port, env) {
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((res) => { let o = ''; child.stdout.on('data', (d) => { o += d; if (/Shared workspace: (on|off)/.test(o)) res(child); }); });
}
const server = await start(PORT, { HQ_DATA_DIR: DATA, HQ_OWNER_PASSWORD_HASH: hashPassword(PASSWORD), HQ_TEST_FIXTURES: '1', QUILL_PROVIDER: 'mock', QUILL_MOCK_DELAY_MS: '300', HQ_TEST_CLOCK: '1', HQ_SCHEDULER_MS: '1000' });
const demo = await start(4186, {});

async function signIn(page) {
  await page.goto(`${BASE}#/workspace`);
  await page.fill('#ws-password', PASSWORD);
  await page.click('#signin-form button[type=submit]');
  await page.waitForFunction(() => document.getElementById('ws-pill')?.textContent === 'Shared workspace');
}
const api = (page, p) => page.evaluate(async (p) => (await fetch(p, { cache: 'no-store' })).json(), p);
const bundleOf = async (page, id) => (await api(page, 'api/workspace')).jobs.find((e) => e.id === id)?.bundle;
const londonDate = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date(ms));

/** ffprobe + raw greyscale frames: the "separate player" check, outside the browser. */
function probe(file) {
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,format_name:stream=codec_name,width,height', '-of', 'json', file]).toString());
  return { duration: Number(j.format.duration), format: j.format.format_name, codec: j.streams[0].codec_name, w: j.streams[0].width, h: j.streams[0].height };
}
function frame(file, t, png) {
  if (png) execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-ss', String(t), '-i', file, '-frames:v', '1', png]);
  return execFileSync('ffmpeg', ['-loglevel', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 16 * 1024 * 1024 });
}
const W = 1080;
const region = (buf, x0, y0, x1, y1, fn) => { let n = 0, hit = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { n++; if (fn(buf[y * W + x])) hit++; } return hit / n; };
const diff = (a, b, y0, y1) => { let s = 0; for (let i = y0 * W; i < y1 * W; i++) s += Math.abs(a[i] - b[i]); return s / ((y1 - y0) * W); };

const browser = await chromium.launch();
const errors = [];
const watch = (page, name) => page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
try {
  console.log('\n== 1. Cue on HQ ==');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const dp = await ctx.newPage();
  watch(dp, 'desktop');
  await signIn(dp);
  await dp.goto(`${BASE}#/`);
  await dp.waitForSelector('.agent-card.char-video');
  assert((await dp.locator('.team .agent-card').count()) === 6 && /Cue/.test(await dp.locator('.agent-card.char-video').innerText()) && /Video Creator/.test(await dp.locator('.agent-card.char-video').innerText()), 'HQ shows six agents, including Cue, Video Creator');
  assert((await dp.locator('.agent-card.char-video img').first().evaluate((i) => i.naturalWidth)) > 0, 'Cue’s artwork loads');
  assert((await dp.locator('.agent-card.char-video').getAttribute('data-state')) === 'idle', 'Cue is idle with no video work (no animation without processing)');
  await dp.screenshot({ path: `${PREVIEWS}/m10-desktop-hq.png` });
  await dp.click('.agent-card.char-video');
  await dp.waitForSelector('.sheet .size-hero .char-role');
  assert((await dp.locator('.sheet .size-hero .char-role').innerText()) === 'Video Creator' && /No video jobs yet/.test(await dp.locator('.sheet').innerText()), 'Clicking the card opens Cue’s workspace');
  await dp.keyboard.press('Escape');

  console.log('\n== 2. Video brief → storyboard → edit → render v1 → download ==');
  await dp.goto(`${BASE}#/`);
  await dp.selectOption('#format', 'video');
  await dp.setInputFiles('#brief-clip', SAMPLE); // the normal upload control
  await dp.waitForSelector('[data-testid="clip-ok"]');
  assert(/23 s · 540 × 960/.test(await dp.locator('[data-testid="clip-ok"]').innerText()) && /Sample footage, not real product/.test(await dp.locator('[data-testid="clip-ok"]').innerText()), 'Uploaded clip read: 23 s, 540 × 960, and labelled sample footage');
  await dp.fill('#brief', BRIEF);
  await dp.selectOption('#platform', 'LinkedIn');
  await dp.click('#brief-form button[type=submit]');
  let id;
  for (let i = 0; i < 40 && !id; i++) { id = (await api(dp, 'api/workspace')).jobs.find((e) => e.bundle.job.brief === BRIEF)?.id; if (!id) await dp.waitForTimeout(250); }
  assert(id, 'Video job created for Vektor');
  await dp.goto(`${BASE}#/job/${id}`);
  await dp.waitForSelector('[data-testid="open-video-editor"]', { timeout: 20000 });
  let b = await bundleOf(dp, id);
  const vt = b.tasks.find((t) => t.type === 'video');
  const ct = b.tasks.find((t) => t.type === 'copy');
  assert(b.job.kind === 'video' && vt.agent === 'video' && vt.clip?.id && !vt.versions.length && vt.draft?.scenes.length === 4, 'Cue drafted a 4-scene storyboard; nothing rendered yet');
  assert(/Template script and storyboard \(demo mode, not AI\)|Mock script and storyboard \(test mode, not AI\)/.test(await dp.locator('[data-testid="storyboard-summary"]').innerText()), 'The storyboard is labelled as not AI (mock provider here; demo template in browser demo mode)');
  await dp.waitForSelector('[data-testid="panel-copy"] [data-testid="caption-text"]', { timeout: 20000 });
  const socialCaption = (await bundleOf(dp, id)).tasks.find((t) => t.type === 'copy').versions[0].content.text;
  assert(socialCaption.length > 40 && !vt.draft.scenes.some((sc) => socialCaption.includes(sc.caption)), 'Quill’s post caption is separate from the on-screen captions');
  const clipHead = await dp.evaluate(async (cid) => { const r = await fetch(`api/assets/${cid}`, { headers: { Range: 'bytes=0-99' } }); return { status: r.status, range: r.headers.get('content-range'), type: r.headers.get('content-type') }; }, vt.clip.id);
  assert(clipHead.status === 206 && /^bytes 0-99\//.test(clipHead.range) && clipHead.type === 'video/mp4', 'Clip stored on the server and served with byte ranges (phones can stream and seek)');

  await dp.click('[data-testid="open-video-editor"]');
  await dp.waitForSelector('[data-testid="scene"]');
  assert((await dp.locator('[data-testid="sample-footage-banner"]').count()) === 1 && b.tasks.find((t) => t.type === 'video').clip.sample === true, 'The uploaded file is recognised as the bundled sample recording and labelled sample footage');
  assert(/MP4 \(H\.264\)|WebM/.test(await dp.locator('[data-testid="export-format"]').innerText()), `Export format shown: ${await dp.locator('[data-testid="export-format"]').innerText()}`);
  // Edit the storyboard: scene 2 caption, trim scene 3 footage, adjust timing, logo position.
  await dp.fill('#vs-cap-1', 'On site, the engineer photographs the receipt in the job app.');
  await dp.locator('#vs-cap-1').dispatchEvent('change');
  await dp.fill('#vs-from-2', '8.6');
  await dp.locator('#vs-from-2').dispatchEvent('change');
  await dp.fill('#vs-dur-0', '3.5');
  await dp.locator('#vs-dur-0').dispatchEvent('change');
  await dp.fill('#vs-dur-1', '7.5');
  await dp.locator('#vs-dur-1').dispatchEvent('change');
  await dp.selectOption('#vs-logo', 'top-right');
  await dp.waitForTimeout(700);
  assert(/Total: 20 s/.test(await dp.locator('[data-testid="vs-total"]').innerText()), 'Scene timing adjusted, still 20 s in total');
  b = await bundleOf(dp, id);
  const d1 = b.tasks.find((t) => t.type === 'video').draft;
  assert(d1.scenes[1].caption.startsWith('On site, the engineer photographs') && d1.scenes[2].from === 8.6 && d1.scenes[0].duration === 3.5, 'Edits saved to the shared draft as you go');
  await dp.screenshot({ path: `${OUT}/m10-desktop-01-editor.png`, fullPage: true });
  await dp.click('[data-testid="render-video"]');
  await dp.waitForSelector('[data-testid="render-progress"]:not([hidden])');
  await dp.waitForTimeout(1200);
  assert((await dp.evaluate(() => document.getElementById('vs-prog').value)) > 0, 'Render progress is shown');
  await dp.goto(`${BASE}#/`).catch(() => {});
  assert(/vstudio|video/.test(await dp.evaluate(() => location.hash)), 'Leaving mid-render is blocked (the render would stop)');
  await dp.waitForSelector('[data-testid="render-result"]', { timeout: 60000 });
  const meta1 = await dp.locator('[data-testid="render-result"] [data-testid="video-meta"]').innerText();
  assert(/Video v1 · (MP4 \(H\.264\)|WebM \(VP\d\)|MP4|WebM) · 20\.\d s · 1080 × 1350/.test(meta1), `Render finished: ${meta1}`);
  const [dl1] = await Promise.all([dp.waitForEvent('download'), dp.click('[data-testid="render-result"] [data-testid="download-video"]')]);
  const ext1 = path.extname(dl1.suggestedFilename()).slice(1);
  const f1 = path.join(TMP, dl1.suggestedFilename());
  await dl1.saveAs(f1);
  assert(/-video-v1\.(mp4|webm)$/.test(dl1.suggestedFilename()) && (/MP4/.test(meta1) ? ext1 === 'mp4' : ext1 === 'webm'), `Downloaded ${dl1.suggestedFilename()} (extension matches the real format)`);

  console.log('\n== 3. The downloaded v1 in a separate player (ffprobe / ffmpeg) ==');
  const p1 = probe(f1);
  assert(p1.duration >= 19.5 && p1.duration <= 20.8 && p1.w === 1080 && p1.h === 1350, `ffprobe: ${p1.codec} in ${p1.format}, ${p1.duration.toFixed(2)} s, ${p1.w} × ${p1.h}`);
  assert(ext1 === 'mp4' ? /mp4|mov/.test(p1.format) && p1.codec === 'h264' : /webm|matroska/.test(p1.format), 'Container and codec match the label');
  const fr = { hook: frame(f1, 1.5, `${TMP}/v1-hook.png`), step: frame(f1, 6.5, `${TMP}/v1-step.png`), why: frame(f1, 13.5, `${TMP}/v1-why.png`), end: frame(f1, 19.2, `${TMP}/v1-end.png`) };
  for (const [k, buf] of Object.entries(fr)) {
    const text = region(buf, 40, 1060, 1040, 1340, (v) => v > 200);
    assert(text > 0.01 && text < 0.35, `${k}: caption band has light text on a dark band (${(text * 100).toFixed(1)}% text pixels)`);
  }
  const logo = region(fr.hook, 1080 - 34 - 218, 34, 1080 - 34, 118, (v) => v > 120);
  assert(logo > 0.05, `Logo (placeholder mark) present in the top-right corner (${(logo * 100).toFixed(0)}% bright pixels)`);
  const screen = region(fr.step, 300, 100, 780, 1000, (v) => v > 200);
  assert(screen > 0.05 && diff(fr.hook, fr.step, 0, 1040) > 8, 'Screen action visible: the footage area shows the recording, and it changes between scenes');
  assert(region(fr.step, 0, 0, W, 1040, (v) => v > 20) > 0.2, 'Footage isn’t black');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', `${TMP}/v1-hook.png`, '-i', `${TMP}/v1-step.png`, '-i', `${TMP}/v1-why.png`, '-i', `${TMP}/v1-end.png`, '-filter_complex', 'hstack=inputs=4,scale=1600:-1', `${PREVIEWS}/m10-export-v1-frames.png`]);
  fs.copyFileSync(f1, path.join(PREVIEWS, `m10-sample-export-v1.${ext1}`));

  console.log('\n== 4. Approve + schedule v1, change only the closing caption, render v2 ==');
  await dp.goto(`${BASE}#/job/${id}`);
  await dp.waitForSelector('[data-approve]:not([disabled])');
  assert(/caption v1 with video v1/.test(await dp.locator('.approve-bar').innerText()), 'Approval names caption v1 and video v1');
  await dp.click('[data-approve]');
  await dp.waitForSelector('[data-testid="publish-now"]');
  const pv = await dp.locator('[data-testid="pub-start"] [data-testid="pub-versions"]').innerText();
  assert(/Caption v1 · Video v1/.test(pv) && await dp.locator('[data-testid="pub-start"] video').count(), 'Publishing preview plays the video and names video v1');
  const now = (await api(dp, 'api/publish/receipts')).now;
  await dp.click('[data-testid="schedule"]');
  await dp.fill('[data-pub-field="date"]', londonDate(now + 3 * 86400000));
  await dp.fill('[data-pub-field="time"]', '09:30');
  await dp.click('[data-pub-time] button[type=submit]');
  assert(/video v1/.test(await dp.locator('[data-testid="confirm-versions"]').innerText()), 'Confirmation names video v1');
  await dp.click('[data-testid="confirm-publish"]');
  await dp.waitForSelector('[data-testid="pub-card"][data-status="scheduled"]');
  await dp.click('[data-testid="open-video-editor"]');
  await dp.waitForSelector('[data-testid="scene"]');
  const closing = 'Takeaway: snap every receipt before the van leaves.';
  await dp.fill('#vs-cap-3', closing);
  await dp.locator('#vs-cap-3').dispatchEvent('change');
  await dp.fill('#vs-note', 'Closing caption only');
  await dp.click('[data-testid="render-video"]');
  await dp.waitForSelector('[data-testid="render-result"]', { timeout: 60000 });
  const [dl2] = await Promise.all([dp.waitForEvent('download'), dp.click('[data-testid="render-result"] [data-testid="download-video"]')]);
  const f2 = path.join(TMP, dl2.suggestedFilename());
  await dl2.saveAs(f2);
  assert(/-video-v2\./.test(dl2.suggestedFilename()), `Downloaded ${dl2.suggestedFilename()}`);
  b = await bundleOf(dp, id);
  const v = b.tasks.find((t) => t.type === 'video');
  const sc1 = v.versions[0].content.storyboard.scenes, sc2 = v.versions[1].content.storyboard.scenes;
  assert(v.versions.length === 2 && sc2[3].caption === closing && sc1[3].caption !== closing && sc1.slice(0, 3).every((s, i) => JSON.stringify(s) === JSON.stringify(sc2[i])) && sc1[3].from === sc2[3].from && sc1[3].duration === sc2[3].duration, 'v2 differs from v1 only in the closing on-screen caption');
  const copyNow = b.tasks.find((t) => t.type === 'copy');
  assert(copyNow.versions.length === 1 && copyNow.versions[0].content.text === socialCaption, 'The post caption is untouched (still caption v1, same text)');
  const p2 = probe(f2);
  const end1 = fr.end, end2 = frame(f2, 19.2, `${TMP}/v2-end.png`), mid2 = frame(f2, 6.5);
  assert(p2.duration >= 19.5 && p2.duration <= 20.8 && diff(end1, end2, 1046, 1350) > 3 && diff(fr.step, mid2, 1046, 1350) < 3, `ffprobe v2: ${p2.duration.toFixed(2)} s; closing caption band changed, earlier scene captions unchanged`);
  fs.copyFileSync(f2, path.join(PREVIEWS, `m10-sample-export-v2.${path.extname(f2).slice(1)}`));
  await dp.goto(`${BASE}#/job/${id}`);
  await dp.waitForSelector('[data-testid="pub-card"]');
  assert((await dp.locator('[data-testid="pub-card"]').getAttribute('data-status')) === 'attention' && /video changed from v1 to v2/.test(await dp.locator('[data-testid="pub-attention"]').innerText()), 'The scheduled demo publication is held: the video changed from v1 to v2');
  assert(/Changed, needs fresh approval/.test(await dp.locator('.job-head').innerText()), 'The post needs fresh approval');
  await dp.locator('[data-key^="hw-task"]').last().evaluate((d) => { d.open = true; });
  const hist = dp.locator('[data-testid="video-history-item"][data-version="1"] video');
  await hist.evaluate((el) => el.play().then(() => new Promise((r) => setTimeout(r, 600))).then(() => el.pause()));
  const v1state = await hist.evaluate((el) => ({ t: el.currentTime, d: el.duration, err: el.error?.code || null }));
  assert(v1state.t > 0.2 && v1state.d > 19 && !v1state.err, `The earlier video v1 still plays (played to ${v1state.t.toFixed(1)} s of ${v1state.d.toFixed(1)} s)`);
  await dp.click('[data-approve]');
  await dp.waitForSelector('[data-testid="publish-now"]');
  b = await bundleOf(dp, id);
  assert(b.job.approval.graphicVersion === 2 && b.job.approval.copyVersion === 1 && b.job.approvals.length === 2, 'Approval now points to caption v1 + video v2 (v1’s approval kept in history)');
  await dp.click('[data-testid="publish-now"]');
  assert(/Caption v1 and video v2/.test(await dp.locator('[data-testid="confirm-versions"]').innerText()), 'Publish confirmation names video v2');
  await dp.click('[data-testid="confirm-publish"]');
  await dp.waitForSelector('[data-testid="pub-card"][data-status="published"]');
  const rc = (await api(dp, 'api/publish/receipts')).posts.find((r) => r.publicationId.includes(id.slice(4)));
  assert(rc && rc.visual === 'video' && rc.videoVersion === 2 && rc.copyVersion === 1, `Demo receipt ${rc?.id} identifies video v2 and caption v1`);
  await dp.screenshot({ path: `${OUT}/m10-desktop-02-published.png`, fullPage: true });

  console.log('\n== 5. Phone: watch the complete clip on the review screen ==');
  const phoneCtx = await browser.newContext({ ...devices['iPhone 13'] });
  const pp = await phoneCtx.newPage();
  watch(pp, 'phone');
  await signIn(pp);
  await pp.goto(`${BASE}#/job/${id}`);
  await pp.waitForSelector('[data-testid="panel-video"] video.video-out');
  const pv2 = pp.locator('[data-testid="panel-video"] [data-testid="video-output"] video.video-out').first();
  const box = await pv2.boundingBox();
  assert(box.width >= 300, `Video fills the phone's content width (${Math.round(box.width)} px)`);
  const watched = await pv2.evaluate((el) => new Promise((res) => {
    const t0 = performance.now();
    el.muted = true; el.playbackRate = 4;
    el.onended = () => res({ ended: true, d: el.duration, wall: performance.now() - t0 });
    el.play().catch((e) => res({ ended: false, err: e.message }));
    setTimeout(() => res({ ended: false, t: el.currentTime }), 15000);
  }));
  assert(watched.ended && watched.d > 19.5, `Played to the end on the phone (${watched.d?.toFixed(1)} s clip, at 4× speed)`);
  await pp.locator('[data-testid="panel-video"]').scrollIntoViewIfNeeded();
  await pp.screenshot({ path: `${PREVIEWS}/m10-phone-review.png` });
  await pp.goto(`${BASE}#/agent/video`);
  await pp.waitForSelector('.sheet [data-testid="video-assigned"]');
  assert(/v2 rendered|Video v2/.test(await pp.locator('.sheet').innerText()), 'Cue’s workspace shows the job, progress and output');
  await pp.screenshot({ path: `${PREVIEWS}/m10-phone-workspace.png` });
  await phoneCtx.close();

  console.log('\n== 6. Failures keep the editable draft (browser demo mode) ==');
  const noExport = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await noExport.addInitScript(() => { delete window.MediaRecorder; });
  const np = await noExport.newPage();
  watch(np, 'no-export');
  await np.goto(DEMO);
  await np.selectOption('#format', 'video');
  await np.setInputFiles('#brief-clip', SAMPLE);
  await np.waitForSelector('[data-testid="clip-ok"]');
  await np.fill('#brief', BRIEF);
  await np.click('#brief-form button[type=submit]');
  await np.waitForTimeout(400);
  const nid = await np.evaluate(() => JSON.parse(localStorage.getItem('nexai-hq:v1')).jobs[0].id);
  await np.goto(`${DEMO}#/job/${nid}/video`);
  await np.waitForSelector('[data-testid="scene"]', { timeout: 20000 });
  assert(/Not available/.test(await np.locator('[data-testid="export-format"]').innerText()) && await np.locator('[data-testid="render-video"]').isDisabled(), 'A device that can’t export says so and disables Render');
  await np.fill('#vs-cap-0', 'Edited on a device that can’t export.');
  await np.locator('#vs-cap-0').dispatchEvent('change');
  await np.waitForTimeout(700);
  await np.reload();
  await np.waitForSelector('[data-testid="scene"]');
  assert((await np.inputValue('#vs-cap-0')) === 'Edited on a device that can’t export.', 'The edited draft survives a reload');
  await noExport.close();

  const failing = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await failing.addInitScript(() => { const s = MediaRecorder.prototype.start; MediaRecorder.prototype.start = function () { throw new Error('simulated encoder failure'); }; void s; });
  const fp = await failing.newPage();
  watch(fp, 'failing');
  await fp.goto(DEMO);
  await fp.selectOption('#format', 'video');
  await fp.click('[data-testid="use-sample-clip"]');
  await fp.waitForSelector('[data-testid="clip-ok"]');
  assert(/Sample footage, not real product/.test(await fp.locator('[data-testid="clip-ok"]').innerText()), 'The built-in sample is labelled as sample footage when chosen');
  await fp.fill('#brief', BRIEF);
  await fp.click('#brief-form button[type=submit]');
  await fp.waitForTimeout(400);
  const fid = await fp.evaluate(() => JSON.parse(localStorage.getItem('nexai-hq:v1')).jobs[0].id);
  await fp.goto(`${DEMO}#/job/${fid}/video`);
  await fp.waitForSelector('[data-testid="sample-footage-banner"]', { timeout: 20000 });
  await fp.fill('#vs-cap-3', 'Draft kept after a failed render.');
  await fp.locator('#vs-cap-3').dispatchEvent('change');
  await fp.click('[data-testid="render-video"]');
  await fp.waitForSelector('[data-testid="render-error"]', { timeout: 20000 });
  assert(/simulated encoder failure|Rendering failed/.test(await fp.locator('[data-testid="render-error"]').innerText()) && /draft is saved/i.test(await fp.locator('[data-testid="render-error"]').innerText()), 'A failed render reports the error and says the draft is saved');
  const fjob = await fp.evaluate((i) => { const s = JSON.parse(localStorage.getItem('nexai-hq:v1')); const t = s.tasks.find((x) => x.jobId === i && x.type === 'video'); return { versions: t.versions.length, cap: t.draft.scenes[3].caption }; }, fid);
  assert(fjob.versions === 0 && fjob.cap === 'Draft kept after a failed render.', 'No broken version was added and the edited draft is kept');
  await failing.close();

  assert(!errors.length, `No uncaught page errors${errors.length ? `: ${errors.join('; ')}` : ''}`);
  console.log('\nMilestone 10 Video Creator tests passed.');
} finally {
  await browser.close();
  server.kill();
  demo.kill();
  for (const d of [DATA, TMP]) fs.rmSync(d, { recursive: true, force: true });
}
