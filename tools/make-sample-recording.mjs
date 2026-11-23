// Makes public/samples/sample-receipt-recording.{webm,mp4}: a clearly labelled SAMPLE screen recording for trying
// the Video Creator when no real JobTrack Pro footage has been supplied. It's an illustrative mock-up drawn here,
// NOT the real product, and every frame says so. Never present it as evidence of how JobTrack Pro works.
//
//   node tools/make-sample-recording.mjs        (needs Playwright's Chromium and ffmpeg)
import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const W = 540, H = 960, SECONDS = 24;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;font-family:'DejaVu Sans',Arial,sans-serif}
body{width:${W}px;height:${H}px;background:#eef2f7;overflow:hidden;color:#132033}
.wm{position:absolute;top:0;left:0;right:0;z-index:9;background:#b3261e;color:#fff;font-size:17px;font-weight:700;text-align:center;padding:9px 6px;line-height:1.25}
.wm small{display:block;font-size:13px;font-weight:600}
.bar{position:absolute;top:58px;left:0;right:0;height:64px;background:#17324f;color:#fff;display:flex;align-items:center;padding:0 22px;font-size:22px;font-weight:700}
.screen{position:absolute;top:122px;left:0;right:0;bottom:0;padding:22px;opacity:0;transition:opacity .35s}
.screen.on{opacity:1}
.card{background:#fff;border-radius:14px;padding:18px;margin-bottom:16px;box-shadow:0 2px 6px rgba(0,0,0,.08)}
.muted{color:#5b6b80;font-size:17px}.big{font-size:26px;font-weight:700;margin:6px 0}
.btn{display:block;text-align:center;background:#1f6feb;color:#fff;border-radius:12px;padding:18px;font-size:22px;font-weight:700;margin-top:14px;position:relative}
.btn.alt{background:#fff;color:#1f6feb;border:2px solid #1f6feb}
.tap{position:absolute;width:70px;height:70px;border-radius:50%;border:5px solid #ff9f1a;background:rgba(255,159,26,.25);z-index:8;opacity:0;transform:scale(.4);transition:all .35s}
.tap.on{opacity:1;transform:scale(1)}
.cam{position:absolute;inset:122px 0 0 0;background:#1b1b1b;opacity:0;transition:opacity .35s}
.cam.on{opacity:1}
.receipt{position:absolute;left:120px;top:110px;width:300px;height:440px;background:#fffdf6;transform:rotate(-4deg);padding:22px;font-family:'DejaVu Sans Mono',monospace;font-size:17px;color:#222;box-shadow:0 8px 30px rgba(0,0,0,.6)}
.frame{position:absolute;left:90px;top:80px;width:360px;height:500px;border:4px dashed #5ee07a;border-radius:10px}
.shutter{position:absolute;left:50%;bottom:60px;width:96px;height:96px;margin-left:-48px;border-radius:50%;background:#fff;border:8px solid #9aa}
.flash{position:absolute;inset:0;background:#fff;opacity:0;transition:opacity .2s;z-index:7}.flash.on{opacity:.9}
.field{border:2px solid #c9d4e2;border-radius:10px;padding:12px 14px;font-size:21px;margin:8px 0 14px;background:#fff}
.toast{position:absolute;left:30px;right:30px;bottom:60px;background:#1a7f37;color:#fff;font-size:21px;font-weight:700;padding:18px;border-radius:12px;opacity:0;transition:opacity .3s;z-index:6}
.toast.on{opacity:1}
.row{display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid #e3e9f1;font-size:19px}
.row.new{background:#fff6d6;margin:0 -10px;padding:12px 10px;border-radius:8px;font-weight:700}
</style></head><body>
<div class="wm">SAMPLE RECORDING · illustrative mock-up<small>Not the real JobTrack Pro. Not evidence of how the product works.</small></div>
<div class="bar" id="bar">Job #4821</div>
<div class="screen" id="s1"><div class="card"><div class="muted">Boiler service · Harbour Court</div><div class="big">Job #4821</div><div class="muted">Engineer: S. Patel · In progress</div></div>
  <div class="card"><div class="muted">Costs on this job</div><div class="big">£0.00</div></div>
  <div class="btn" id="add">+ Add receipt</div><div class="btn alt">Add photo</div></div>
<div class="cam" id="s2"><div class="receipt">PLUMB SUPPLIES LTD<br>Unit 4, Dock Rd<br><br>2x 15mm valve<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;£31.60<br>PTFE tape &nbsp;&nbsp;£3.20<br>Flux &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;£8.00<br>----------------<br>TOTAL &nbsp;&nbsp;&nbsp;&nbsp;£42.80<br><br>PAID CARD</div><div class="frame"></div><div class="shutter" id="shut"></div><div class="flash" id="flash"></div></div>
<div class="screen" id="s3"><div class="muted">Receipt for job #4821</div><div class="field">Supplier: Plumb Supplies Ltd</div><div class="field">Amount: £42.80</div><div class="field">Category: Parts</div><div class="field" id="note">Note: </div><div class="btn" id="save">Save receipt</div></div>
<div class="screen" id="s4"><div class="card"><div class="muted">Office view · Job costs</div><div class="big">Job #4821 · £42.80</div>
  <div class="row new"><span>Receipt · Plumb Supplies</span><span>£42.80</span></div><div class="row"><span>Added on site by S. Patel</span><span>just now</span></div><div class="row"><span>Ready to invoice</span><span>✓</span></div></div></div>
<div class="toast" id="toast">Receipt saved to job #4821</div>
<div class="tap" id="tap"></div>
<script>
const $ = (id) => document.getElementById(id);
const show = (id) => ['s1','s2','s3','s4'].forEach((s) => $(s).classList.toggle('on', s === id));
const tapAt = (el) => { const r = el.getBoundingClientRect(); const t = $('tap'); t.style.left = (r.left + r.width / 2 - 35) + 'px'; t.style.top = (r.top + r.height / 2 - 35) + 'px'; t.classList.add('on'); setTimeout(() => t.classList.remove('on'), 700); };
const at = (s, fn) => setTimeout(fn, s * 1000);
show('s1');
at(2.5, () => tapAt($('add')));
at(3.4, () => { show(null); $('s2').classList.add('on'); $('bar').textContent = 'Photograph receipt'; });
at(7.0, () => tapAt($('shut')));
at(7.4, () => $('flash').classList.add('on'));
at(7.7, () => $('flash').classList.remove('on'));
at(8.6, () => { $('s2').classList.remove('on'); show('s3'); $('bar').textContent = 'New receipt'; });
const note = 'Valves for boiler repair';
for (let i = 1; i <= note.length; i++) at(9.6 + i * 0.12, () => { $('note').textContent = 'Note: ' + note.slice(0, i); });
at(13.6, () => tapAt($('save')));
at(14.2, () => $('toast').classList.add('on'));
at(16.4, () => { $('toast').classList.remove('on'); show('s4'); $('bar').textContent = 'Office'; });
</script></body></html>`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sample-rec-'));
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: tmp, size: { width: W, height: H } } });
const page = await ctx.newPage();
fs.writeFileSync(path.join(tmp, 'app.html'), html);
const t0 = Date.now();
await page.goto(`file://${path.join(tmp, 'app.html')}`);
await page.waitForTimeout(SECONDS * 1000);
const raw = await page.video().path();
await ctx.close();
await browser.close();
const lead = Math.max(0, (Date.now() - t0) / 1000 - SECONDS - 0.2).toFixed(2); // trim the blank page load at the start
const out = path.join(ROOT, 'public', 'samples');
fs.mkdirSync(out, { recursive: true });
const ff = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', lead, '-i', raw, '-t', String(SECONDS - 1), '-an', ...args], { stdio: 'inherit' });
ff(['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '38', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', '-r', '30', path.join(out, 'sample-receipt-recording.webm')]);
ff(['-c:v', 'libx264', '-preset', 'slow', '-crf', '30', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-r', '30', path.join(out, 'sample-receipt-recording.mp4')]);
fs.rmSync(tmp, { recursive: true, force: true });
const crypto = await import('crypto');
fs.writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify({ note: 'Bundled SAMPLE recordings (illustrative mock-ups, not the real JobTrack Pro). Uploads matching these are labelled sample footage.', sha256: ['webm', 'mp4'].map((f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(out, `sample-receipt-recording.${f}`))).digest('hex')) }, null, 2)}\n`);
for (const f of ['webm', 'mp4']) console.log(`${f}: ${(fs.statSync(path.join(out, `sample-receipt-recording.${f}`)).size / 1024).toFixed(0)} KB`);
