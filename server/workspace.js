// Shared workspace store. Each job is saved as a bundle { job, tasks, log } with its own revision number.
// A save must name the revision it was based on; if another device saved first, the save is refused (409)
// and the caller gets the latest bundle. Version histories and approvals are append-only.
// The data lives in the configured store (server/backend.js): files on your own machine, Supabase on Vercel.
// Every save is atomic in the store, so the rules hold across several server instances.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { APP_DIR } = require('./storage');
const { store } = require('./backend');

const MAX_BUNDLE = 1.5 * 1024 * 1024;
const ID = /^[a-z]+_[a-z0-9]{4,40}$/;
const ASSET_ID = /^(photo|logo|clip|video)_[a-z0-9]{4,40}$/;
const ASSET_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
const KIND_TYPES = { photo: ['image/jpeg', 'image/png'], logo: ['image/jpeg', 'image/png'], clip: ['video/mp4', 'video/webm', 'video/quicktime'], video: ['video/mp4', 'video/webm'] };
const MAX_ASSET = 15 * 1024 * 1024;
const MAX_VIDEO = 100 * 1024 * 1024;
const maxFor = (kind) => (kind === 'clip' || kind === 'video' ? MAX_VIDEO : MAX_ASSET);

class WsError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}

/* ---------- Business profile: every save is a new, identified version ---------- */
const versionId = (n, data) => `pv${n}-${crypto.createHash('sha1').update(JSON.stringify(data)).digest('hex').slice(0, 6)}`;

/**
 * The business profile, seeded with the starting profile on first use. Profiles saved before the editorial voice
 * existed get it as a new version; every other field is kept as the owner left it. A profile that already has a
 * voice (edited, or deliberately blank) is never changed. Both steps are atomic saves, so two servers can't race.
 */
async function profileRecord() {
  const S = store();
  let cur = await S.get('profile', 'main');
  if (!cur) {
    const seed = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'public', 'data', 'profile-seed.json'), 'utf8'));
    await S.put('profile', 'main', 0, { versions: [{ id: versionId(1, seed), n: 1, savedAt: Date.now(), savedBy: 'seed', data: seed }] }, 'seed');
    cur = await S.get('profile', 'main');
  }
  const last = cur.data.versions.at(-1);
  if (typeof last.data?.writing?.voice !== 'string') {
    const V = require('../public/js/voice.js');
    const data = JSON.parse(JSON.stringify(last.data));
    data.writing = { ...(data.writing || {}), voice: V.DEFAULT_VOICE };
    const n = cur.data.versions.length + 1;
    await S.put('profile', 'main', cur.rev, { versions: [...cur.data.versions, { id: versionId(n, data), n, savedAt: Date.now(), savedBy: 'update: editorial voice added', data }] }, 'update');
    cur = await S.get('profile', 'main');
  }
  // Profiles saved before the service catalogue existed get it as a new version: the owner's services carried over
  // exactly, every other field untouched. A profile that already has a catalogue is never changed here.
  const upgraded = require('../public/js/catalogue.js').upgradeProfile(cur.data.versions.at(-1).data);
  if (upgraded) {
    const n = cur.data.versions.length + 1;
    await S.put('profile', 'main', cur.rev, { versions: [...cur.data.versions, { id: versionId(n, upgraded), n, savedAt: Date.now(), savedBy: 'update: service catalogue added', data: upgraded }] }, 'update');
    cur = await S.get('profile', 'main');
  }
  return cur;
}
const profileOut = (r) => ({ rev: r.rev, versions: r.data.versions });
const brandOut = (r) => (r ? { rev: r.rev, data: r.data, updatedBy: r.updatedBy } : { rev: 0, data: {} });
const entry = (r) => ({ id: r.id, rev: r.rev, updatedAt: r.updatedAt, updatedBy: r.updatedBy, bundle: r.data });
const planEntry = (r) => ({ id: r.id, rev: r.rev, updatedAt: r.updatedAt, updatedBy: r.updatedBy, plan: r.data });

async function snapshot() {
  const S = store();
  const profile = await profileRecord();
  const [jobs, plans, brand, rev] = await Promise.all([S.list('job'), S.list('plan'), S.get('brand', 'main'), S.wsRev()]);
  return {
    rev,
    jobs: jobs.map(entry).sort((a, b) => b.bundle.job.createdAt - a.bundle.job.createdAt),
    brand: brandOut(brand),
    plans: plans.map(planEntry).sort((a, b) => b.plan.createdAt - a.plan.createdAt),
    profile: profileOut(profile),
  };
}
const wsRev = () => store().wsRev();

async function getJob(id) {
  if (!ID.test(id)) return null;
  const r = await store().get('job', id);
  return r ? entry(r) : null;
}

function validateBundle(id, b) {
  const bad = (m) => { throw new WsError(400, `Invalid job data: ${m}.`); };
  if (!ID.test(id)) bad('job id');
  if (!b || typeof b !== 'object' || !b.job || !Array.isArray(b.tasks) || !Array.isArray(b.log)) bad('shape');
  if (b.job.id !== id) bad('job id mismatch');
  if (Buffer.byteLength(JSON.stringify(b)) > MAX_BUNDLE) bad('too large');
  const ids = b.job.taskIds || {};
  if (b.tasks.length !== 2 || !b.tasks.every((t) => t && t.jobId === id && ids[t.type] === t.id && Array.isArray(t.versions))) bad('tasks');
  for (const t of b.tasks) t.versions.forEach((v, i) => { if (!v || v.n !== i + 1) bad('version numbering'); });
  const a = b.job.approval;
  if (a) {
    const copy = b.tasks.find((t) => t.type === 'copy');
    const graphic = b.tasks.find((t) => t.type === 'graphic' || t.type === 'video');
    if (!(a.copyVersion >= 1 && a.copyVersion <= copy.versions.length && a.graphicVersion >= 1 && a.graphicVersion <= graphic.versions.length)) bad('approval refers to a version that does not exist');
  }
  const pubs = b.job.publications;
  if (pubs !== undefined) {
    if (!Array.isArray(pubs) || pubs.length > 200) bad('publications');
    const copy = b.tasks.find((t) => t.type === 'copy');
    const graphic = b.tasks.find((t) => t.type === 'graphic' || t.type === 'video');
    pubs.forEach((p, i) => {
      if (!p || p.n !== i + 1 || !/^pub_[a-z0-9_]{4,60}$/.test(p.id) || !PUB_STATUS.includes(p.status) || !Array.isArray(p.events)) bad('publication record');
      if (!(p.copyVersion >= 1 && p.copyVersion <= copy.versions.length && p.graphicVersion >= 1 && p.graphicVersion <= graphic.versions.length)) bad('publication refers to a version that does not exist');
      if (!Number.isFinite(p.scheduledFor)) bad('publication time');
    });
  }
  const ms = b.job.measurements;
  if (ms !== undefined) {
    if (!Array.isArray(ms) || ms.length > 500) bad('results');
    const num = (v) => v === null || (Number.isInteger(v) && v >= 0 && v < 1e12);
    ms.forEach((m, i) => {
      if (!m || m.n !== i + 1 || !/^ms_[a-z0-9_]{4,60}$/.test(m.id) || !['owner', 'sample'].includes(m.source)) bad('results record');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(m.measuredOn || '') || !num(m.impressions) || !num(m.clicks) || !num(m.enquiries)) bad('results figures');
    });
  }
}
const PUB_STATUS = ['scheduled', 'publishing', 'published', 'cancelled', 'held', 'attention', 'replaced'];
const FINAL = ['published', 'cancelled', 'replaced'];

/** Earlier versions and approvals may never be changed or removed. */
function checkAppendOnly(prev, next) {
  for (const pt of prev.tasks) {
    const nt = next.tasks.find((t) => t.id === pt.id);
    if (!nt || nt.versions.length < pt.versions.length) throw new WsError(422, 'This save would remove saved versions, so it was refused.');
    pt.versions.forEach((v, i) => {
      if (JSON.stringify(v) !== JSON.stringify(nt.versions[i])) throw new WsError(422, `This save would change saved ${pt.type} v${i + 1}, so it was refused.`);
    });
  }
  const pa = prev.job.approvals || [];
  const na = next.job.approvals || [];
  if (na.length < pa.length || pa.some((x, i) => JSON.stringify(x) !== JSON.stringify(na[i]))) throw new WsError(422, 'This save would rewrite the approval history, so it was refused.');
  const pr = prev.job.reviews || [];
  const nr = next.job.reviews || [];
  if (nr.length < pr.length || pr.some((x, i) => JSON.stringify(x) !== JSON.stringify(nr[i]))) throw new WsError(422, 'This save would rewrite the review history, so it was refused.');
  // Publications: never removed; their history only grows; published, cancelled and replaced are final; receipts are kept.
  const pp = prev.job.publications || [];
  const np = next.job.publications || [];
  if (np.length < pp.length) throw new WsError(422, 'This save would remove a publication record, so it was refused.');
  // Results: snapshots are only ever added; recorded figures can't be edited or removed.
  const pm = prev.job.measurements || [];
  const nm = next.job.measurements || [];
  if (nm.length < pm.length || pm.some((x, i) => JSON.stringify(x) !== JSON.stringify(nm[i]))) throw new WsError(422, 'This save would change recorded results, so it was refused.');
  pp.forEach((p, i) => {
    const q = np[i];
    const refuse = () => { throw new WsError(422, `This save would rewrite publication #${p.n}’s history, so it was refused.`); };
    if (q.id !== p.id || q.copyVersion !== p.copyVersion || q.graphicVersion !== p.graphicVersion || q.platform !== p.platform) refuse();
    if (q.events.length < p.events.length || p.events.some((ev, k) => JSON.stringify(ev) !== JSON.stringify(q.events[k]))) refuse();
    if (FINAL.includes(p.status) && JSON.stringify(p) !== JSON.stringify(q)) refuse();
    if (p.receipt && JSON.stringify(p.receipt) !== JSON.stringify(q.receipt)) refuse();
  });
}


async function putJob(id, baseRev, bundle, device) {
  const S = store();
  validateBundle(id, bundle);
  const cur = await S.get('job', id);
  const curRev = cur ? cur.rev : 0;
  if (Number(baseRev) !== curRev) throw new WsError(409, 'This job changed on another device.', { current: cur ? entry(cur) : null });
  if (cur) checkAppendOnly(cur.data, bundle);
  const out = await S.put('job', id, curRev, bundle, device);
  if (!out) {
    const latest = await S.get('job', id);
    throw new WsError(409, 'This job changed on another device.', { current: latest ? entry(latest) : null });
  }
  return { rev: out.rev, wsRev: out.wsRev, updatedAt: out.updatedAt };
}

/* ---------- Weekly plans ---------- */
const PLAN_ID = /^plan_[a-z0-9]{4,40}$/;
function validatePlan(id, p) {
  const bad = (m) => { throw new WsError(400, `Invalid plan: ${m}.`); };
  if (!PLAN_ID.test(id) || !p || p.id !== id) bad('id');
  if (!['draft', 'creating', 'confirmed'].includes(p.status)) bad('status');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.weekStart || '') || typeof p.brief !== 'string') bad('week or brief');
  if (!Array.isArray(p.days) || p.days.length < 1 || p.days.length > 7) bad('days');
  for (const d of p.days) if (d.jobId != null && !ID.test(d.jobId)) bad('job link');
  if (Buffer.byteLength(JSON.stringify(p)) > 200 * 1024) bad('too large');
}
async function putPlan(id, baseRev, plan, device) {
  const S = store();
  validatePlan(id, plan);
  const cur = await S.get('plan', id);
  const curRev = cur ? cur.rev : 0;
  const conflict = (c) => new WsError(409, 'This plan changed on another device.', { current: c ? planEntry(c) : null });
  if (Number(baseRev) !== curRev) throw conflict(cur);
  if (cur) {
    // Once a day is linked to a job, that link is permanent: no re-pointing, no duplicates.
    cur.data.days.forEach((d, i) => {
      if (d.jobId && plan.days[i]?.jobId !== d.jobId) throw new WsError(422, 'A planned post is already linked to a job and can’t be changed.');
    });
    if (cur.data.status === 'confirmed' && plan.status !== 'confirmed') throw new WsError(422, 'A confirmed plan can’t go back to draft.');
  }
  const out = await S.put('plan', id, curRev, plan, device);
  if (!out) throw conflict(await S.get('plan', id));
  return { rev: out.rev, wsRev: out.wsRev, updatedAt: out.updatedAt };
}

function validateProfile(d) {
  const bad = (m) => { throw new WsError(400, `Invalid business profile: ${m}.`); };
  if (!d || typeof d !== 'object') bad('shape');
  if (Buffer.byteLength(JSON.stringify(d)) > 120 * 1024) bad('too large');
  if (!Array.isArray(d.services) || d.services.length > 20) bad('services');
  if (!Array.isArray(d.proof) || !Array.isArray(d.offers) || d.offers.length > 50) bad('proof or offers');
  for (const o of d.offers) {
    if (!o || typeof o.wording !== 'string' || o.wording.length > 600) bad('offer wording');
    for (const k of ['start', 'end']) if (o[k] && !/^\d{4}-\d{2}-\d{2}$/.test(o[k])) bad('offer dates');
  }
  if (!d.audience || !d.cta || !d.brand || !d.writing) bad('sections');
  const c = require('../public/js/catalogue.js').validateCatalogue(d.catalogue);
  if (c) bad(c);
}
async function putProfile(baseRev, data, device) {
  const S = store();
  validateProfile(data);
  const cur = await profileRecord();
  if (Number(baseRev) !== cur.rev) throw new WsError(409, 'The business profile was changed on another device.', { current: profileOut(cur) });
  const n = cur.data.versions.length + 1;
  const out = await S.put('profile', 'main', cur.rev, { versions: [...cur.data.versions, { id: versionId(n, data), n, savedAt: Date.now(), savedBy: device, data }] }, device);
  if (!out) throw new WsError(409, 'The business profile was changed on another device.', { current: profileOut(await profileRecord()) });
  return { profile: profileOut(await S.get('profile', 'main')), wsRev: out.wsRev };
}

async function putBrand(baseRev, data, device) {
  const S = store();
  if (!data || typeof data !== 'object' || (data.logoId && !ASSET_ID.test(data.logoId))) throw new WsError(400, 'Invalid brand settings.');
  const cur = await S.get('brand', 'main');
  const curRev = cur ? cur.rev : 0;
  if (Number(baseRev) !== curRev) throw new WsError(409, 'Brand settings changed on another device.', { current: brandOut(cur) });
  const out = await S.put('brand', 'main', curRev, { logoId: data.logoId || null, logoName: String(data.logoName || '').slice(0, 200), logoSavedAt: Date.now() }, device);
  if (!out) throw new WsError(409, 'Brand settings changed on another device.', { current: brandOut(await S.get('brand', 'main')) });
  return brandOut(await S.get('brand', 'main'));
}

/** Idempotent import: a job id already in the workspace is skipped, never duplicated or overwritten. */
async function importBundles(bundles, brand, device, dryRun) {
  const S = store();
  if (!Array.isArray(bundles)) throw new WsError(400, 'Nothing to import.');
  const imported = [];
  const skipped = [];
  for (const b of bundles) {
    const id = b?.job?.id;
    validateBundle(id, b);
    if (await S.get('job', id)) { skipped.push(id); continue; }
    if (!dryRun && !(await S.put('job', id, 0, b, device))) { skipped.push(id); continue; } // created meanwhile: never overwritten
    imported.push(id);
  }
  let brandSet = false;
  const curBrand = await S.get('brand', 'main');
  if (brand?.logoId && ASSET_ID.test(brand.logoId) && !curBrand?.data?.logoId) {
    brandSet = true;
    if (!dryRun) await S.put('brand', 'main', curBrand ? curBrand.rev : 0, { logoId: brand.logoId, logoName: String(brand.logoName || '').slice(0, 200), logoSavedAt: Date.now() }, device);
  }
  return { imported, skipped, brandSet, dryRun: !!dryRun };
}

/* ---------- Assets (photos, logos, AI images, clips and rendered videos) ---------- */
function checkAsset(id, kind, type, size) {
  if (!ASSET_ID.test(id) || !id.startsWith(`${kind}_`)) throw new WsError(400, 'Invalid image id.');
  if (!ASSET_TYPES[type] || !KIND_TYPES[kind]?.includes(type)) throw new WsError(415, kind === 'clip' || kind === 'video' ? 'Only MP4, MOV and WebM video can be stored.' : 'Only JPG and PNG images can be stored.');
  if (!size || size > maxFor(kind)) throw new WsError(413, kind === 'clip' || kind === 'video' ? 'Video is empty or over 100 MB.' : 'Image is empty or over 15 MB.');
}
const metaFor = (id, kind, name, type, size) => ({ id, kind, name: String(name || '').slice(0, 200), type, size, createdAt: Date.now() });

async function saveAsset(id, { kind, name, type }, buf) {
  checkAsset(id, kind, type, buf.length);
  const existing = await store().assetMeta(id);
  if (existing) {
    if (existing.size !== buf.length) throw new WsError(409, 'A different image already uses this id.');
    return { id, existing: true };
  }
  await store().assetSave(id, metaFor(id, kind, name, type, buf.length), buf);
  return { id, existing: false };
}

/** Direct upload (Supabase): a signed URL for the browser, or { direct: false } to post the file to HQ instead. */
async function assetUploadUrl(id, { kind, name, type, size }) {
  checkAsset(id, kind, type, Number(size));
  const existing = await store().assetMeta(id);
  if (existing) {
    if (existing.size !== Number(size)) throw new WsError(409, 'A different file already uses this id.');
    return { existing: true };
  }
  const url = await store().assetUploadUrl(id);
  return url ? { direct: true, url } : { direct: false };
}
/** After a direct upload: check the stored object matches what was announced, then record it. */
async function assetUploadComplete(id, { kind, name, type, size }) {
  checkAsset(id, kind, type, Number(size));
  const got = await store().assetUploaded(id);
  if (!got) throw new WsError(409, 'The upload didn’t arrive. Nothing was saved; try again.');
  if (got.size !== Number(size)) throw new WsError(409, 'The uploaded file is incomplete. Nothing was saved; try again.');
  await store().assetRecord(id, metaFor(id, kind, name, type, got.size));
  return { id, existing: false };
}

/** For streaming (file store) or a signed redirect (Supabase). */
async function readAsset(id) {
  if (!ASSET_ID.test(id)) return null;
  const meta = await store().assetMeta(id);
  if (!meta) return null;
  const S = store();
  return { meta, stream: S.assetStream ? (opts) => S.assetStream(id, opts) : null, signedUrl: S.assetStream ? null : () => S.assetSignedUrl(id) };
}
async function readAssetBuffer(id) {
  if (!ASSET_ID.test(id)) return null;
  const meta = await store().assetMeta(id);
  const buffer = meta ? await store().assetBuffer(id) : null;
  return buffer ? { meta, buffer } : null;
}
async function hasAsset(id) { return ASSET_ID.test(id) && !!(await store().assetMeta(id)); }

module.exports = { snapshot, wsRev, getJob, putJob, putPlan, putProfile, putBrand, importBundles, saveAsset, assetUploadUrl, assetUploadComplete, readAsset, readAssetBuffer, hasAsset, WsError, MAX_ASSET, MAX_VIDEO };
