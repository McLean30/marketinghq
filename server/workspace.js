// Shared workspace store. Each job is saved as a bundle { job, tasks, log } with its own revision number.
// A save must name the revision it was based on; if another device saved first, the save is refused (409)
// and the caller gets the latest bundle. Version histories and approvals are append-only.
const fs = require('fs');
const path = require('path');
const { DATA_DIR, ASSET_DIR, writeAtomic, readJson } = require('./storage');

const FILE = path.join(DATA_DIR, 'workspace.json');
const MAX_BUNDLE = 1.5 * 1024 * 1024;
const ID = /^[a-z]+_[a-z0-9]{4,40}$/;
const ASSET_ID = /^(photo|logo)_[a-z0-9]{4,40}$/;
const ASSET_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png' };
const MAX_ASSET = 15 * 1024 * 1024;

let ws = readJson(FILE, { version: 1, rev: 0, jobs: {}, brand: { rev: 0, data: {} } });
const persist = () => writeAtomic(FILE, JSON.stringify(ws));

class WsError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}

const entry = (id, e) => ({ id, rev: e.rev, updatedAt: e.updatedAt, updatedBy: e.updatedBy, bundle: e.bundle });

function snapshot() {
  const jobs = Object.entries(ws.jobs).map(([id, e]) => entry(id, e)).sort((a, b) => b.bundle.job.createdAt - a.bundle.job.createdAt);
  return { rev: ws.rev, jobs, brand: ws.brand };
}

const getJob = (id) => (ws.jobs[id] ? entry(id, ws.jobs[id]) : null);

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
    const graphic = b.tasks.find((t) => t.type === 'graphic');
    if (!(a.copyVersion >= 1 && a.copyVersion <= copy.versions.length && a.graphicVersion >= 1 && a.graphicVersion <= graphic.versions.length)) bad('approval refers to a version that does not exist');
  }
}

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
}

function putJob(id, baseRev, bundle, device) {
  validateBundle(id, bundle);
  const cur = ws.jobs[id];
  const curRev = cur ? cur.rev : 0;
  if (Number(baseRev) !== curRev) throw new WsError(409, 'This job changed on another device.', { current: cur ? entry(id, cur) : null });
  if (cur) checkAppendOnly(cur.bundle, bundle);
  ws.jobs[id] = { rev: curRev + 1, updatedAt: Date.now(), updatedBy: device, bundle };
  ws.rev += 1;
  persist();
  return { rev: curRev + 1, wsRev: ws.rev, updatedAt: ws.jobs[id].updatedAt };
}

function putBrand(baseRev, data, device) {
  if (!data || typeof data !== 'object' || (data.logoId && !ASSET_ID.test(data.logoId))) throw new WsError(400, 'Invalid brand settings.');
  if (Number(baseRev) !== ws.brand.rev) throw new WsError(409, 'Brand settings changed on another device.', { current: ws.brand });
  ws.brand = { rev: ws.brand.rev + 1, data: { logoId: data.logoId || null, logoName: String(data.logoName || '').slice(0, 200), logoSavedAt: Date.now() }, updatedBy: device };
  ws.rev += 1;
  persist();
  return ws.brand;
}

/** Idempotent import: a job id already in the workspace is skipped, never duplicated or overwritten. */
function importBundles(bundles, brand, device, dryRun) {
  if (!Array.isArray(bundles)) throw new WsError(400, 'Nothing to import.');
  const imported = [];
  const skipped = [];
  for (const b of bundles) {
    const id = b?.job?.id;
    validateBundle(id, b);
    if (ws.jobs[id]) { skipped.push(id); continue; }
    imported.push(id);
    if (!dryRun) ws.jobs[id] = { rev: 1, updatedAt: Date.now(), updatedBy: device, importedAt: Date.now(), bundle: b };
  }
  let brandSet = false;
  if (brand?.logoId && ASSET_ID.test(brand.logoId) && !ws.brand.data?.logoId) {
    brandSet = true;
    if (!dryRun) ws.brand = { rev: ws.brand.rev + 1, data: { logoId: brand.logoId, logoName: String(brand.logoName || '').slice(0, 200), logoSavedAt: Date.now() }, updatedBy: device };
  }
  if (!dryRun && (imported.length || brandSet)) { ws.rev += 1; persist(); }
  return { imported, skipped, brandSet, dryRun: !!dryRun };
}

/* ---------- Assets (original photos and logos) ---------- */
const assetPath = (id) => path.join(ASSET_DIR, `${id}.bin`);
const metaPath = (id) => path.join(ASSET_DIR, `${id}.json`);

function saveAsset(id, { kind, name, type }, buf) {
  if (!ASSET_ID.test(id) || !id.startsWith(`${kind}_`)) throw new WsError(400, 'Invalid image id.');
  if (!ASSET_TYPES[type]) throw new WsError(415, 'Only JPG and PNG images can be stored.');
  if (!buf.length || buf.length > MAX_ASSET) throw new WsError(413, 'Image is empty or over 15 MB.');
  const existing = readJson(metaPath(id), null);
  if (existing) {
    if (existing.size !== buf.length) throw new WsError(409, 'A different image already uses this id.');
    return { id, existing: true };
  }
  try {
    writeAtomic(assetPath(id), buf);
    writeAtomic(metaPath(id), JSON.stringify({ id, kind, name: String(name || '').slice(0, 200), type, size: buf.length, createdAt: Date.now() }));
  } catch (e) {
    if (e.code === 'ENOSPC') throw new WsError(507, 'The server’s disk is full. The image wasn’t saved.');
    throw e;
  }
  return { id, existing: false };
}

function readAsset(id) {
  if (!ASSET_ID.test(id)) return null;
  const meta = readJson(metaPath(id), null);
  if (!meta) return null;
  return { meta, stream: () => fs.createReadStream(assetPath(id)) };
}

const hasAsset = (id) => ASSET_ID.test(id) && fs.existsSync(metaPath(id));

module.exports = { snapshot, getJob, putJob, putBrand, importBundles, saveAsset, readAsset, hasAsset, WsError, MAX_ASSET };
