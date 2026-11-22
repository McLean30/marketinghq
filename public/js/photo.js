// Prism "Photo layout": supplied photo + logo + headline, rendered locally on a 1080 × 1350 canvas.
// One draw function serves the live preview and the PNG export, so they are pixel-identical.
// Images live in IndexedDB (localStorage is too small); job data keeps only their ids.

export const W = 1080;
export const H = 1350;
const CYAN = '#2EE6FF';
const NAVY = '#07101F';
const DB_NAME = 'nexai-hq-assets';
const STORE = 'assets';
const LIMITS = { photo: { maxEdge: 2400, type: 'image/jpeg', quality: 0.9 }, logo: { maxEdge: 1200, type: 'image/png' } };
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

export class AssetError extends Error {}

export const DEFAULT_SPEC = { headlinePos: 'bottom', crop: { zoom: 1, fx: 0.5, fy: 0.5 }, logoScale: 1 };

/* ---------- IndexedDB asset store ---------- */
let dbPromise = null;
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new AssetError('This browser can’t store images (IndexedDB is unavailable, for example in some private windows).'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new AssetError('Couldn’t open this browser’s image storage.'));
  });
  dbPromise.catch(() => (dbPromise = null));
  return dbPromise;
}

const isQuota = (e) => e && (e.name === 'QuotaExceededError' || e.code === 22 || /quota/i.test(e.message || ''));

export async function putLocalAsset(rec) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    let tx;
    try {
      tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(rec);
    } catch (e) {
      reject(e);
      return;
    }
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error || new Error('Image save was aborted.'));
  }).catch((e) => {
    if (isQuota(e)) throw new AssetError('This browser’s image storage is full. Nothing was saved. Free space by clearing old browser data, or use a smaller photo.');
    throw new AssetError(`The image couldn’t be saved to this browser (${e.name || 'error'}). Nothing was saved.`);
  });
}

export async function getLocalAsset(id) {
  if (!id) return null;
  const db = await openDb();
  return new Promise((resolve) => {
    const req = db.transaction(STORE).objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

/* ---------- Backend switch: this browser (IndexedDB) or the private shared workspace (server) ---------- */
let backend = 'local';
export function setAssetBackend(b) { backend = b === 'server' ? 'server' : 'local'; }
export const assetBackend = () => backend;

export async function uploadAsset(rec) {
  let r;
  try {
    r = await fetch(`api/assets/${rec.id}`, { method: 'POST', body: rec.blob, headers: { 'Content-Type': rec.blob.type, 'X-Asset-Kind': rec.kind, 'X-Asset-Name': encodeURIComponent(rec.name || ''), 'X-HQ-Device': 'upload' } });
  } catch {
    throw new AssetError('Can’t reach the HQ server, so the image wasn’t saved. Nothing was changed.');
  }
  if (r.ok) return;
  let msg = '';
  try { msg = (await r.json()).error; } catch { /* ignore */ }
  if (r.status === 401) throw new AssetError('You’re signed out, so the image wasn’t saved. Sign in, then save again.');
  throw new AssetError(msg || `The server couldn’t store the image (${r.status}). Nothing was saved.`);
}

async function fetchServerAsset(id) {
  try {
    const r = await fetch(`api/assets/${id}`, { cache: 'no-store' });
    return r.ok ? { id, blob: await r.blob() } : null;
  } catch {
    return null;
  }
}

export const putAsset = (rec) => (backend === 'server' ? uploadAsset(rec) : putLocalAsset(rec));
export const getAsset = (id) => (!id ? Promise.resolve(null) : backend === 'server' ? fetchServerAsset(id) : getLocalAsset(id));

const bitmapCache = new Map(); // asset id -> Promise<ImageBitmap|null>
export function loadBitmap(id) {
  if (!id) return Promise.resolve(null);
  if (!bitmapCache.has(id)) {
    const p = getAsset(id).then((rec) => (rec ? createImageBitmap(rec.blob) : null)).catch(() => null);
    bitmapCache.set(id, p);
    p.then((b) => { if (!b) bitmapCache.delete(id); }); // don't cache a miss (e.g. signed out); retry next time
  }
  return bitmapCache.get(id);
}
export function rememberBitmap(id, bitmap) {
  bitmapCache.set(id, Promise.resolve(bitmap));
}

/** Decode, downscale and re-encode an uploaded file. Nothing is stored until the design is saved. */
export async function prepareUpload(file, kind) {
  if (!file) throw new AssetError('No file chosen.');
  if (!/^image\//.test(file.type || '') && !/\.(jpe?g|png|webp|gif|heic|heif)$/i.test(file.name || '')) throw new AssetError(`“${file.name}” isn’t an image. Choose a JPG or PNG.`);
  if (file.size > MAX_UPLOAD_BYTES) throw new AssetError(`“${file.name}” is over 30 MB. Choose a smaller image.`);
  let source;
  try {
    source = await createImageBitmap(file);
  } catch {
    throw new AssetError(`This browser can’t read “${file.name}”. Save it as JPG or PNG and try again.`);
  }
  const lim = LIMITS[kind];
  const scale = Math.min(1, lim.maxEdge / Math.max(source.width, source.height));
  const w = Math.round(source.width * scale);
  const h = Math.round(source.height * scale);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').drawImage(source, 0, 0, w, h);
  const blob = await new Promise((res) => c.toBlob(res, lim.type, lim.quality));
  if (!blob) throw new AssetError('The image couldn’t be processed.');
  const bitmap = await createImageBitmap(blob); // decode the stored bytes so preview = export
  const id = `${kind}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return { id, kind, name: file.name || `${kind}.${lim.type === 'image/png' ? 'png' : 'jpg'}`, blob, bitmap, w, h, createdAt: Date.now() };
}

/* ---------- Layout ---------- */
let fontsReady = null;
function ensureFonts() {
  if (!fontsReady) {
    fontsReady = document.fonts
      ? Promise.all([document.fonts.load('700 96px "Chakra Petch"'), document.fonts.load('600 28px "Barlow"')]).catch(() => null).then(() => document.fonts.ready)
      : Promise.resolve();
  }
  return fontsReady;
}

const FONT = (size) => `700 ${size}px "Chakra Petch", "Arial Narrow", Arial, sans-serif`;

function wrap(ctx, text, maxWidth) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width <= maxWidth) {
      line = test;
      continue;
    }
    if (line) lines.push(line);
    // A single word wider than the column is split by characters.
    if (ctx.measureText(w).width > maxWidth) {
      let part = '';
      for (const ch of w) {
        if (ctx.measureText(part + ch).width > maxWidth) { lines.push(part); part = ch; } else part += ch;
      }
      line = part;
    } else line = w;
  }
  if (line) lines.push(line);
  return lines;
}

/** Choose the largest headline size (104 to 56px) that fits in 4 lines. */
export function fitHeadline(ctx, text, maxWidth = W - 80 - 110) {
  for (let size = 104; size >= 56; size -= 4) {
    ctx.font = FONT(size);
    const lines = wrap(ctx, text, maxWidth);
    if (lines.length <= 4) return { size, lines };
  }
  ctx.font = FONT(56);
  return { size: 56, lines: wrap(ctx, text, maxWidth).slice(0, 5) };
}

export function coverRect(pw, ph, crop) {
  const zoom = Math.max(1, crop?.zoom || 1);
  const s = Math.max(W / pw, H / ph) * zoom;
  const dw = pw * s;
  const dh = ph * s;
  const fx = Math.min(1, Math.max(0, crop?.fx ?? 0.5));
  const fy = Math.min(1, Math.max(0, crop?.fy ?? 0.5));
  return { dx: (W - dw) * fx, dy: (H - dh) * fy, dw, dh };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function logoBox(logo, scale) {
  const maxW = 250 * scale;
  const maxH = 130 * scale;
  if (!logo) return { w: maxW, h: maxH * 0.62 };
  const r = Math.min(maxW / logo.width, maxH / logo.height);
  return { w: logo.width * r, h: logo.height * r };
}

/**
 * Draw the photo layout. `spec`: { headline, headlinePos: top|middle|bottom, crop: {zoom, fx, fy}, logoScale }.
 * `photo` / `logo`: ImageBitmap or null (null draws a clearly labelled "missing" placeholder).
 */
export async function drawLayout(ctx, spec, { photo, logo }) {
  await ensureFonts();
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = NAVY;
  ctx.fillRect(0, 0, W, H);

  // 1. Photo, cover-fitted with zoom and focus point.
  if (photo) {
    const r = coverRect(photo.width, photo.height, spec.crop);
    ctx.drawImage(photo, r.dx, r.dy, r.dw, r.dh);
  } else {
    ctx.strokeStyle = 'rgba(46,230,255,.18)';
    ctx.lineWidth = 2;
    for (let i = -H; i < W; i += 40) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + H, H); ctx.stroke(); }
    ctx.fillStyle = 'rgba(232,241,255,.85)';
    ctx.font = '600 40px "Barlow", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Photo missing: choose a photo', W / 2, H / 2 - 160);
    ctx.textAlign = 'left';
  }

  const pos = ['top', 'middle', 'bottom'].includes(spec.headlinePos) ? spec.headlinePos : 'bottom';
  const logoTop = pos === 'bottom';
  const scale = Math.min(1.8, Math.max(0.6, spec.logoScale || 1));
  const lb = logoBox(logo, scale);
  const M = 80;

  // 2. Scrims keep text and logo legible on any photo.
  const shade = (y0, y1, a0, a1) => {
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, `rgba(4,9,20,${a0})`);
    g.addColorStop(1, `rgba(4,9,20,${a1})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, Math.min(y0, y1), W, Math.abs(y1 - y0));
  };
  if (pos === 'top') shade(0, H * 0.6, 0.86, 0);
  if (pos === 'bottom') shade(H, H * 0.4, 0.9, 0);
  if (pos === 'middle') { shade(H * 0.5, H * 0.18, 0.78, 0); shade(H * 0.5, H * 0.82, 0.78, 0); }
  if (logoTop && pos !== 'top') shade(0, lb.h + M * 2 + 40, 0.62, 0);
  if (!logoTop && pos !== 'bottom') shade(H, H - lb.h - M * 2 - 40, 0.62, 0);

  // 3. Headline with cyan rule.
  const text = (spec.headline || '').trim() || 'Add a headline';
  const { size, lines } = fitHeadline(ctx, text);
  ctx.font = FONT(size);
  ctx.textBaseline = 'alphabetic';
  const lh = Math.round(size * 1.08);
  const blockH = lh * lines.length;
  let top;
  if (pos === 'top') top = logoTop ? M + lb.h + 60 : M + 20;
  else if (pos === 'middle') top = Math.round((H - blockH) / 2);
  else top = H - M - 40 - blockH;
  ctx.fillStyle = CYAN;
  ctx.fillRect(M - 28, top + Math.round(size * 0.12), 10, blockH - Math.round(size * 0.1));
  ctx.shadowColor = 'rgba(0,0,0,.55)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = (spec.headline || '').trim() ? '#FFFFFF' : 'rgba(255,255,255,.55)';
  lines.forEach((l, i) => ctx.fillText(l, M, top + Math.round(size * 0.9) + i * lh));
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // 4. Logo (or a labelled placeholder when the official logo hasn't been supplied).
  const ly = logoTop ? M : H - M - lb.h;
  if (logo) ctx.drawImage(logo, M, ly, lb.w, lb.h);
  else {
    ctx.setLineDash([12, 10]);
    ctx.strokeStyle = CYAN;
    ctx.lineWidth = 4;
    roundRect(ctx, M, ly, lb.w, lb.h, 12);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(4,9,20,.7)';
    ctx.fill();
    ctx.fillStyle = CYAN;
    ctx.font = `600 ${Math.round(24 * Math.max(0.8, scale))}px "Barlow", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('Official logo missing', M + lb.w / 2, ly + lb.h / 2 + 8);
    ctx.textAlign = 'left';
  }
  ctx.restore();
  return { headlineSize: size, headlineLines: lines };
}

export async function renderToCanvas(spec, assets, canvas = document.createElement('canvas')) {
  canvas.width = W;
  canvas.height = H;
  await drawLayout(canvas.getContext('2d'), spec, assets);
  return canvas;
}

export async function renderToPngBlob(spec, assets) {
  const c = await renderToCanvas(spec, assets);
  const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
  if (!blob) throw new AssetError('The PNG couldn’t be created.');
  return blob;
}

/* ---------- Rendered-version cache (object URLs for <img>) ---------- */
const rendered = new Map(); // key -> { url, blob } | Promise | { error }
export function renderedVersion(key, spec, onReady) {
  const hit = rendered.get(key);
  if (hit && !(hit instanceof Promise)) return hit;
  if (!hit) {
    const p = Promise.all([loadBitmap(spec.photoId), loadBitmap(spec.logoId)])
      .then(async ([photo, logo]) => {
        const missing = [!photo && 'photo', !logo && 'logo'].filter(Boolean);
        const blob = await renderToPngBlob(spec, { photo, logo });
        rendered.set(key, { url: URL.createObjectURL(blob), blob, missing });
        if (missing.length) setTimeout(() => rendered.delete(key), 5000); // try again later (e.g. after sign-in)
      })
      .catch((e) => rendered.set(key, { error: e.message || 'Render failed' }))
      .finally(() => onReady && onReady());
    rendered.set(key, p);
  }
  return null;
}
export function seedRendered(key, blob) {
  rendered.set(key, { url: URL.createObjectURL(blob), blob, missing: [] });
}
