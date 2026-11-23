// The Video Creator's engine: storyboard templates and a real video render in this browser.
// Frames are drawn on a 1080 × 1350 canvas (footage, on-screen caption, logo) and recorded with MediaRecorder.
// MP4 is used when this browser can record it; otherwise WebM, labelled as such. No paid or remote rendering.

export const VW = 1080;
export const VH = 1350;
const FPS = 30;
export const MIN_S = 15;
export const MAX_S = 30;
export const MAX_CLIP_BYTES = 100 * 1024 * 1024;
const FOOT_H = 1040; // footage area; the on-screen caption has its own band below, so it never covers the screen action
const CYAN = '#2EE6FF';
const NAVY = '#07101F';

export class VideoError extends Error {}

/* ---------- What this browser can export ---------- */
const CANDIDATES = [
  ['video/mp4;codecs=avc1.42E01E', 'mp4', 'MP4 (H.264)'],
  ['video/mp4;codecs=avc1', 'mp4', 'MP4 (H.264)'],
  ['video/mp4', 'mp4', 'MP4'],
  ['video/webm;codecs=vp9', 'webm', 'WebM (VP9)'],
  ['video/webm;codecs=vp8', 'webm', 'WebM (VP8)'],
  ['video/webm', 'webm', 'WebM'],
];
/** { mime, ext, label } for the best format this browser can record, or null if it can't export video at all. */
export function exportFormat() {
  if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement === 'undefined' || !HTMLCanvasElement.prototype.captureStream) return null;
  for (const [mime, ext, label] of CANDIDATES) {
    try { if (MediaRecorder.isTypeSupported(mime)) return { mime, ext, label }; } catch { /* keep looking */ }
  }
  return null;
}
export const formatLabel = (mime) => (CANDIDATES.find(([m]) => m === mime) || CANDIDATES.find(([m]) => mime?.startsWith(m.split(';')[0])) || [null, null, mime])[2];

/* ---------- Clips ---------- */
function loadVideo(src) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.crossOrigin = 'anonymous';
    v.onloadeddata = () => resolve(v);
    v.onerror = () => reject(new VideoError('This browser can’t play that video file.'));
    v.src = src;
  });
}
async function realDuration(v) {
  if (Number.isFinite(v.duration) && v.duration > 0) return v.duration;
  // Some recordings (e.g. browser WebM) don't store a duration: seek to the end to find it.
  await new Promise((res) => { v.ontimeupdate = () => { v.ontimeupdate = null; res(); }; v.currentTime = 1e7; });
  const d = v.duration;
  v.currentTime = 0;
  return Number.isFinite(d) ? d : 0;
}

/** Check an uploaded clip plays here and read its length and size. Nothing is stored until the job is created. */
export async function readClip(file) {
  if (!file) throw new VideoError('No file chosen.');
  if (!/^video\//.test(file.type || '') && !/\.(mp4|m4v|mov|webm)$/i.test(file.name || '')) throw new VideoError(`“${file.name}” isn’t a video. Choose an MP4, MOV or WebM screen recording or clip.`);
  if (file.size > MAX_CLIP_BYTES) throw new VideoError(`“${file.name}” is over 100 MB. Trim it or record a shorter clip.`);
  const url = URL.createObjectURL(file);
  try {
    let v;
    try { v = await loadVideo(url); } catch { throw new VideoError(`This browser can’t play “${file.name}”. Try an MP4 (H.264) or WebM file.`); }
    const duration = await realDuration(v);
    if (!(duration >= 1)) throw new VideoError(`“${file.name}” is shorter than a second, or its length can’t be read.`);
    return { name: file.name || 'clip', type: file.type || (/\.webm$/i.test(file.name) ? 'video/webm' : 'video/mp4'), size: file.size, duration: Math.round(duration * 10) / 10, w: v.videoWidth, h: v.videoHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}
/** Is this file one of the bundled sample recordings? (Then it's labelled sample footage however it was added.) */
let sampleHashes = null;
export async function isSampleRecording(file) {
  if (file.size > 20 * 1024 * 1024 || !crypto?.subtle) return false;
  try {
    sampleHashes ??= fetch('samples/manifest.json').then((r) => (r.ok ? r.json() : { sha256: [] })).then((m) => m.sha256 || []).catch(() => []);
    const hex = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map((x) => x.toString(16).padStart(2, '0')).join('');
    return (await sampleHashes).includes(hex);
  } catch { return false; }
}
export const newClipId = () => `clip_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export const newVideoId = () => `video_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/* ---------- Template script and storyboard (demo mode: templates, not AI) ---------- */
const clampFrom = (s, clipDur, len) => Math.max(0, Math.min(s, Math.max(0, clipDur - Math.min(len, clipDur))));
let seq = 0;
const sid = () => `sc${Date.now().toString(36)}${(seq++).toString(36)}`;

export function templateStoryboard(job, clip) {
  const brief = job.brief || '';
  const d = clip?.duration || 20;
  const receipt = /\breceipt/i.test(brief);
  const product = /jobtrack/i.test(brief) ? 'JobTrack Pro' : 'the job app';
  const scenes = receipt ? [
    { title: 'Hook', duration: 4, footage: true, from: 0, caption: 'Receipts get lost between site and office.', script: 'Open on the job screen. Set up the problem the director recognises.' },
    { title: 'The step on screen', duration: 7, footage: true, from: 2.4, caption: `On site, the engineer snaps the receipt in ${product}.`, script: 'Show the tap on Add receipt and the photo being taken. Keep the screen action fully in view.' },
    { title: 'Why it helps the office', duration: 6, footage: true, from: 9, caption: 'Amount and job filled in, saved to the job.', script: 'Show the receipt details and the save. Then the office view with the cost already on the job.' },
    { title: 'Takeaway', duration: 3, footage: true, from: 16.5, caption: 'Takeaway: log every receipt before you leave site.', script: 'Close on the office view. One practical takeaway, no hard sell.' },
  ] : [
    { title: 'Hook', duration: 4, footage: true, from: 0, caption: 'Here’s a small step that saves the office time.', script: 'Open on the screen. Name the problem in one line.' },
    { title: 'The step on screen', duration: 8, footage: true, from: d * 0.2, caption: 'Do it on site, in the app, while it’s fresh.', script: 'Show the step itself. Keep the important tap in view.' },
    { title: 'Why it helps', duration: 5, footage: true, from: d * 0.55, caption: 'The office sees it straight away.', script: 'Show the result the office sees.' },
    { title: 'Takeaway', duration: 3, footage: true, from: d * 0.8, caption: 'Takeaway: capture it before you leave site.', script: 'One practical takeaway.' },
  ];
  for (const s of scenes) { s.id = sid(); s.from = Math.round(clampFrom(s.from, d, s.duration) * 10) / 10; }
  return {
    template: receipt ? 'receipt-walkthrough' : 'walkthrough',
    label: 'Template script and storyboard (demo mode, not AI)',
    platform: job.platform,
    scenes,
    logo: { pos: 'top-right' },
    note: '',
  };
}
export const totalSeconds = (sb) => Math.round(sb.scenes.reduce((a, s) => a + (Number(s.duration) || 0), 0) * 10) / 10;

/** Problems that stop a render (and the time limits for a 15–30 second post). */
export function storyboardProblems(sb, clip) {
  const out = [];
  const total = totalSeconds(sb);
  if (total < MIN_S || total > MAX_S) out.push(`The video is ${total} seconds. Make it between ${MIN_S} and ${MAX_S} seconds.`);
  sb.scenes.forEach((s, i) => {
    if (!(s.duration >= 1 && s.duration <= 15)) out.push(`Scene ${i + 1}: length must be 1–15 seconds.`);
    if (s.footage && clip && (s.from < 0 || s.from >= clip.duration)) out.push(`Scene ${i + 1}: footage start must be within the clip (0–${clip.duration} s).`);
    if ((s.caption || '').length > 120) out.push(`Scene ${i + 1}: on-screen caption is over 120 characters; it won’t be readable.`);
  });
  if (!sb.scenes.length) out.push('Add at least one scene.');
  return out;
}

/* ---------- Drawing ---------- */
function wrap(ctx, text, maxW) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}
function drawMark(ctx, x, y, h) {
  // Placeholder Nexai mark (used only when no official logo has been set in Prism's Photo layout).
  ctx.save();
  ctx.fillStyle = 'rgba(7,16,31,.78)';
  ctx.strokeStyle = CYAN;
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.roundRect(x, y, h * 2.6, h, 12); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#E8F1FF';
  ctx.font = `700 ${Math.round(h * 0.42)}px "Chakra Petch", "DejaVu Sans", sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText('NEXAI', x + h * 0.38, y + h / 2);
  ctx.restore();
}
function logoRect(pos, lw, lh) {
  const m = 34;
  const x = /left/.test(pos) ? m : VW - m - lw;
  const y = /top/.test(pos) ? m : FOOT_H - m - lh;
  return { x, y };
}

/** Draw one frame: footage (contain-fit, never cropped), caption band, logo. */
export function drawFrame(ctx, { video, scene, sb, logo }) {
  ctx.fillStyle = NAVY;
  ctx.fillRect(0, 0, VW, VH);
  const g = ctx.createLinearGradient(0, 0, VW, FOOT_H);
  g.addColorStop(0, '#0C1A31'); g.addColorStop(1, '#030812');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VW, FOOT_H);
  if (video && scene.footage && video.videoWidth) {
    const s = Math.min(VW / video.videoWidth, FOOT_H / video.videoHeight);
    const w = video.videoWidth * s, h = video.videoHeight * s;
    ctx.drawImage(video, (VW - w) / 2, (FOOT_H - h) / 2, w, h);
  }
  // Caption band
  ctx.fillStyle = '#050B16';
  ctx.fillRect(0, FOOT_H, VW, VH - FOOT_H);
  ctx.fillStyle = CYAN;
  ctx.fillRect(0, FOOT_H, VW, 6);
  ctx.fillStyle = '#FFFFFF';
  let size = 60;
  ctx.font = `700 ${size}px "Barlow", "DejaVu Sans", sans-serif`;
  let lines = wrap(ctx, scene.caption, VW - 120);
  while (lines.length > 3 && size > 40) { size -= 4; ctx.font = `700 ${size}px "Barlow", "DejaVu Sans", sans-serif`; lines = wrap(ctx, scene.caption, VW - 120); }
  const lh = size * 1.22;
  const top = FOOT_H + 6 + (VH - FOOT_H - 6 - lh * lines.length) / 2;
  ctx.textBaseline = 'top';
  lines.slice(0, 4).forEach((l, i) => ctx.fillText(l, 60, top + i * lh));
  // Logo
  const pos = sb.logo?.pos || 'top-right';
  if (pos !== 'none') {
    if (logo?.bitmap) {
      const lw = 230, lh2 = (logo.bitmap.height / logo.bitmap.width) * lw;
      const { x, y } = logoRect(pos, lw, lh2);
      ctx.drawImage(logo.bitmap, x, y, lw, lh2);
    } else {
      const h = 84; const { x, y } = logoRect(pos, h * 2.6, h);
      drawMark(ctx, x, y, h);
    }
  }
}

const seekTo = (v, t) => new Promise((res) => { if (Math.abs(v.currentTime - t) < 0.02) return res(); v.onseeked = () => { v.onseeked = null; res(); }; v.currentTime = t; });
const nextFrame = () => new Promise((r) => (document.hidden ? setTimeout(r, 1000 / FPS) : requestAnimationFrame(() => r())));

/** A still preview of one scene at its first frame, into `canvas`. */
export async function previewScene(canvas, { clipBlob, scene, sb, logo }) {
  canvas.width = VW; canvas.height = VH;
  const ctx = canvas.getContext('2d');
  let video = null, url = null;
  try {
    if (scene.footage && clipBlob) { url = URL.createObjectURL(clipBlob); video = await loadVideo(url); await seekTo(video, scene.from); }
    drawFrame(ctx, { video, scene, sb, logo });
  } finally { if (url) URL.revokeObjectURL(url); }
}

/**
 * Record the storyboard to a real video file. Runs in real time (a 20 s video takes about 20 s). The tab must stay
 * visible: browsers throttle hidden tabs, so a hidden tab stops the render with an error instead of a broken file.
 * Resolves { blob, mime, ext, label, durationMs, width, height }.
 */
export async function renderVideo({ sb, clipBlob, logo, onProgress = () => {}, format = exportFormat() }) {
  if (!format) throw new VideoError('This browser can’t export video (no MediaRecorder or canvas capture). Your draft is saved; try Chrome, Edge or Safari on a computer or phone.');
  await document.fonts?.ready;
  const canvas = document.createElement('canvas');
  canvas.width = VW; canvas.height = VH;
  const ctx = canvas.getContext('2d');
  const url = URL.createObjectURL(clipBlob);
  let video;
  try { video = await loadVideo(url); } catch { URL.revokeObjectURL(url); throw new VideoError('This browser can’t play the source clip, so it can’t render it. Your draft is saved.'); }
  const total = totalSeconds(sb) * 1000;
  const stream = canvas.captureStream(FPS);
  let rec;
  try { rec = new MediaRecorder(stream, { mimeType: format.mime, videoBitsPerSecond: 5_000_000 }); } catch (e) { URL.revokeObjectURL(url); throw new VideoError(`This browser refused to record ${format.label}: ${e.message}. Your draft is saved.`); }
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
  const stopped = new Promise((res, rej) => { rec.onstop = res; rec.onerror = (e) => rej(new VideoError(`Recording failed: ${e.error?.message || 'unknown error'}. Your draft is saved.`)); });
  let done = 0;
  const hidden = () => { if (document.hidden) throw new VideoError('Rendering stopped because HQ went into the background (browsers pause hidden tabs). Your draft is saved. Keep HQ on screen and render again.'); };
  try {
    for (let i = 0; i < sb.scenes.length; i++) {
      const scene = sb.scenes[i];
      if (scene.footage) await seekTo(video, scene.from);
      drawFrame(ctx, { video, scene, sb, logo });
      if (i === 0) rec.start(250); else rec.resume();
      if (scene.footage) await video.play().catch(() => {});
      const ms = scene.duration * 1000;
      const t0 = performance.now();
      while (performance.now() - t0 < ms) {
        hidden();
        drawFrame(ctx, { video, scene, sb, logo });
        onProgress(Math.min(1, (done + performance.now() - t0) / total));
        await nextFrame();
      }
      video.pause();
      done += ms;
      if (i < sb.scenes.length - 1) rec.pause(); // no frozen frames while the next scene's footage seeks
    }
    rec.stop();
    await stopped;
  } catch (e) {
    try { if (rec.state !== 'inactive') rec.stop(); } catch { /* ignore */ }
    throw e instanceof VideoError ? e : new VideoError(`Rendering failed: ${e.message}. Your draft is saved.`);
  } finally {
    video.pause();
    URL.revokeObjectURL(url);
    stream.getTracks().forEach((t) => t.stop());
  }
  let blob = new Blob(chunks, { type: format.mime.split(';')[0] });
  if (!blob.size) throw new VideoError('The browser produced an empty video. Your draft is saved; try again.');
  if (format.ext === 'webm') blob = await setWebmDuration(blob, total);
  onProgress(1);
  return { blob, mime: format.mime.split(';')[0], codecMime: format.mime, ext: format.ext, label: format.label, durationMs: Math.round(total), width: VW, height: VH };
}

/* ---------- WebM duration (browsers' MediaRecorder leaves it out, so other players can't show the length) ---------- */
function readVint(b, p) {
  const first = b[p];
  let len = 1, mask = 0x80;
  while (len <= 8 && !(first & mask)) { len++; mask >>= 1; }
  let v = first & (mask - 1);
  for (let i = 1; i < len; i++) v = v * 256 + b[p + i];
  return { len, value: v };
}
const find = (b, id, from = 0, to = b.length) => { for (let i = from; i < to - id.length; i++) { let ok = true; for (let k = 0; k < id.length; k++) if (b[i + k] !== id[k]) { ok = false; break; } if (ok) return i; } return -1; };
export async function setWebmDuration(blob, ms) {
  const b = new Uint8Array(await blob.arrayBuffer());
  const INFO = [0x15, 0x49, 0xa9, 0x66];
  const at = find(b, INFO, 0, Math.min(b.length, 4096));
  if (at < 0) return blob;
  const sz = readVint(b, at + 4);
  const start = at + 4 + sz.len;
  const end = start + sz.value;
  if (find(b, [0x44, 0x89], start, end) >= 0) return blob; // already has a duration
  let scale = 1e6;
  const ts = find(b, [0x2a, 0xd7, 0xb1], start, end);
  if (ts >= 0) { const l = readVint(b, ts + 3); scale = 0; for (let i = 0; i < l.value; i++) scale = scale * 256 + b[ts + 3 + l.len + i]; }
  const dur = new Uint8Array(11);
  dur.set([0x44, 0x89, 0x88]);
  new DataView(dur.buffer).setFloat64(3, (ms * 1e6) / scale);
  const newSize = sz.value + dur.length;
  const sizeBytes = new Uint8Array(8);
  sizeBytes[0] = 0x01;
  let n = newSize;
  for (let i = 7; i >= 1; i--) { sizeBytes[i] = n & 0xff; n = Math.floor(n / 256); }
  return new Blob([b.slice(0, at + 4), sizeBytes, b.slice(start, end), dur, b.slice(end)], { type: blob.type });
}
