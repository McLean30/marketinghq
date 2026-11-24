// Jobs, tasks, versions, approvals. Two backends:
//   local  - this browser's localStorage (the original demo, works signed-out)
//   shared - the private server workspace (owner sign-in), shared by laptop and phone
// Every change goes through commit(jobId, mutate). In shared mode the job is saved against the revision this
// device last saw; if another device saved first, the server refuses it and we never overwrite silently.
import { draftCaption, reviseCaption, draftGraphic, reviseGraphic } from './generators.js';
import { setAssetBackend } from './photo.js';
import { loadSeed, profileImpact } from './profile.js';
import { runChecks, reviewFreshness } from './review.js';
import { londonToday } from './plan.js';
import * as PB from './publishing.js';
import * as AN from './analytics.js';
import { templateStoryboard } from './video.js';
import { BRAND, officialLogoKnown } from './brand.js';
import { toneFor, voiceOf, hasVoiceField, DEFAULT_VOICE } from './voice.js';

const KEY = 'nexai-hq:v1';
const MODE_KEY = 'nexai-hq:mode';
const DEVICE_KEY = 'nexai-hq:device';
const DELEGATE_MS = 1600; // Manager briefing time
const COPY_MS = 4200;
const GRAPHIC_MS = 5600;
const REVISION_MS = 3800;
const STALE_REQUEST_MS = 5 * 60 * 1000;

export const AGENTS = {
  manager: { id: 'manager', name: 'Vektor', role: 'Marketing Manager' },
  copywriter: { id: 'copywriter', name: 'Quill', role: 'Copywriter', taskType: 'copy', label: 'Caption' },
  designer: { id: 'designer', name: 'Prism', role: 'Creative Designer', taskType: 'graphic', label: 'Graphic' },
  reviewer: { id: 'reviewer', name: 'Calibre', role: 'Brand & Quality Reviewer' },
  analyst: { id: 'analyst', name: 'Vantage', role: 'Marketing Analyst' },
  video: { id: 'video', name: 'Cue', role: 'Video Creator', taskType: 'video', label: 'Video' },
};
/** "Graphic" or "Video": the visual half of a post. */
export const visualLabel = (jobOrTask) => ((jobOrTask?.kind === 'video' || jobOrTask?.type === 'video') ? 'Video' : 'Graphic');

export const PLATFORMS = ['LinkedIn', 'Instagram', 'Facebook', 'X', 'Google Business Profile'];

const empty = () => ({ jobs: [], tasks: [], log: [], brand: {}, plans: [] });
const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

/* ---------- Device identity (labels "your phone" / "your computer" in change notes) ---------- */
export const DEVICE = (() => {
  let id = lsGet(DEVICE_KEY);
  if (!id) { id = uid('dev'); lsSet(DEVICE_KEY, id); }
  return id;
})();
export const deviceKind = () => (matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 700 ? 'phone' : 'computer');

/* ---------- Mode, auth and sync status ---------- */
export const ws = {
  testDate: null, // fixed "today" for test workspaces (HQ_TEST_DATE on the server)
  profileRev: 0,
  mode: 'local', // 'local' | 'shared'
  authConfigured: false,
  signedIn: false,
  ready: false,
  status: 'ok', // 'ok' | 'offline' | 'signed_out'
  rev: 0,
  synced: {}, // jobId -> { rev, updatedAt, updatedBy }
  planSynced: {}, // planId -> rev
  brandRev: 0,
  updates: {}, // jobId -> { changes, entry } : newer version on the server, not yet loaded (job is open)
  conflicts: {}, // jobId -> { action, changes, entry } : a save of yours that the server refused
  focusJob: null,
  clockOffset: 0, // shared mode: server time minus this device's time (the server decides when posts are due)
  scheduler: { runsOn: 'browser' },
};
/** "Now" for publishing decisions: the server's clock in the shared workspace, this browser's otherwise. */
export const now = () => Date.now() + (ws.mode === 'shared' ? ws.clockOffset : 0);

/* ---------- Quill provider ---------- */
export let quill = { provider: 'demo', model: null, label: 'Local demo templates', checked: false };
export async function loadQuillProvider() {
  try {
    const r = await fetch('api/quill/status', { cache: 'no-store' });
    if (r.ok) {
      const info = await r.json();
      quill = { provider: info.provider, model: info.model, imageModel: info.imageModel || null, label: info.label, signInRequired: !!info.signInRequired, liveBlocked: info.liveBlocked || null, checked: true };
    }
  } catch {
    quill = { ...quill, checked: true };
  }
  notify();
  return quill;
}
const copyEngine = () => (quill.provider === 'demo' ? 'demo' : 'ai');
const inFlight = new Set(); // task ids with a caption request awaiting the server (this tab)
// A request cut off because this page is being refreshed or closed isn't a failure: the next load offers Retry.
let unloading = false;
addEventListener('pagehide', () => { unloading = true; });
addEventListener('pageshow', () => { unloading = false; });

/* ---------- State ---------- */
let state = loadLocal();
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());
export const subscribe = (fn) => listeners.add(fn);
export const getState = () => state;

function loadLocal() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    return { ...empty(), ...JSON.parse(raw) };
  } catch {
    return empty();
  }
}
export const readLocalState = loadLocal;

function saveLocal(strict) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    if (strict) {
      const full = e && (e.name === 'QuotaExceededError' || /quota/i.test(e.message || ''));
      throw new Error(full ? 'This browser’s storage is full, so the change wasn’t saved. Your job and earlier versions are unchanged.' : 'This browser blocked saving, so the change wasn’t saved. Your job and earlier versions are unchanged.');
    }
  }
}

function log(jobId, agent, text) {
  state.log.unshift({ id: uid('log'), jobId, agent, text, at: Date.now() });
  state.log = state.log.slice(0, 400);
}

/* ---------- Job bundles (the unit saved to the server) ---------- */
export const getJob = (id) => state.jobs.find((j) => j.id === id);
export const getTask = (id) => state.tasks.find((t) => t.id === id);
// `graphic` is the post's visual task: Prism's graphic, or Cue's video for a video post.
export const jobTasks = (job) => ({ copy: getTask(job.taskIds.copy), graphic: getTask(job.taskIds.graphic || job.taskIds.video) });
export const currentVersion = (task) => task.versions[task.versions.length - 1] || null;

function bundleOf(jobId) {
  const job = getJob(jobId);
  if (!job) return null;
  return clone({ job, tasks: state.tasks.filter((t) => t.jobId === jobId), log: state.log.filter((l) => l.jobId === jobId) });
}

function applyBundle(bundle) {
  const id = bundle.job.id;
  const i = state.jobs.findIndex((j) => j.id === id);
  if (i >= 0) state.jobs[i] = clone(bundle.job); else state.jobs.push(clone(bundle.job));
  state.jobs.sort((a, b) => b.createdAt - a.createdAt);
  state.tasks = state.tasks.filter((t) => t.jobId !== id).concat(clone(bundle.tasks));
  state.log = state.log.filter((l) => l.jobId !== id).concat(clone(bundle.log)).sort((a, b) => b.at - a.at);
}
function removeJob(id) {
  state.jobs = state.jobs.filter((j) => j.id !== id);
  state.tasks = state.tasks.filter((t) => t.jobId !== id);
  state.log = state.log.filter((l) => l.jobId !== id);
}

/** Human-readable list of what differs between the bundle you have and the server's. */
export function describeChanges(mine, theirs) {
  const out = [];
  if (!theirs) return out;
  for (const t of theirs.tasks) {
    const old = mine?.tasks.find((x) => x.id === t.id);
    const label = t.type === 'copy' ? 'Caption' : t.type === 'video' ? 'Video' : 'Graphic';
    for (const v of t.versions.slice(old ? old.versions.length : 0)) {
      const kind = t.type === 'video' ? `${(v.content.ext || '').toUpperCase()} render` : t.type === 'graphic' ? (v.content.mode === 'photo' ? 'Photo layout' : 'simulated') : ({ anthropic: 'AI', mock: 'mock', human: 'edited by you', demo: 'demo' })[v.source] || 'saved';
      out.push(`${label} v${v.n} saved (${kind})`);
    }
    if (t.pending && !old?.pending) out.push(`${label} revision requested${t.pending.feedback ? `: “${t.pending.feedback}”` : ''}`);
  }
  const a0 = mine?.job.approval;
  const a1 = theirs.job.approval;
  if (a1 && JSON.stringify(a0) !== JSON.stringify(a1)) out.push(`Approved caption v${a1.copyVersion} with ${visualLabel(theirs.job).toLowerCase()} v${a1.graphicVersion}`);
  for (const m of (theirs.job.measurements || []).slice((mine?.job.measurements || []).length)) out.push(`Results measured ${AN.fmtDay(m.measuredOn)} recorded`);
  for (const p of theirs.job.publications || []) {
    const old = (mine?.job.publications || []).find((x) => x.id === p.id);
    if (!old || old.status !== p.status || old.scheduledFor !== p.scheduledFor) out.push(`${p.platform} publication #${p.n}: ${PB.PUB_LABEL[p.status]}${p.status === 'scheduled' ? ` for ${PB.fmtLondon(p.scheduledFor)}` : ''}${p.receipt && !old?.receipt ? ` (receipt ${p.receipt.id})` : ''}`);
  }
  if (!out.length) out.push('Job details updated');
  return out;
}

/* ---------- Server calls ---------- */
async function api(path, opts = {}) {
  let r;
  try {
    r = await fetch(path, { cache: 'no-store', ...opts, headers: { 'X-HQ-Device': deviceKind(), ...(opts.body && typeof opts.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) } });
  } catch {
    ws.status = 'offline';
    notify();
    throw Object.assign(new Error('Can’t reach the HQ server. Check the server is running and you’re on the same Wi-Fi, then try again.'), { offline: true });
  }
  let data = {};
  try { data = await r.json(); } catch { /* binary or empty */ }
  if (r.status === 401) {
    ws.signedIn = false;
    ws.status = 'signed_out';
    notify();
  } else if (ws.status === 'offline') ws.status = 'ok';
  return { status: r.status, ok: r.ok, data };
}

/* ---------- The one way state changes ---------- */
const locks = new Map(); // jobId -> Promise (serialises saves per job)

/**
 * Apply `mutate` to the job and persist it. `mutate` returns false for "nothing to do".
 * User actions (background: false) that conflict are rolled back and reported in ws.conflicts.
 * Background work (agent timers, AI results) that conflicts is re-applied on top of the latest version.
 */
export async function commit(jobId, mutate, { background = false, strict = true, action = 'save' } = {}) {
  if (ws.mode === 'local') {
    const before = clone(state);
    const result = mutate();
    if (result === false) return { ok: true, noop: true };
    syncPubs(jobId);
    try {
      saveLocal(strict && !background);
    } catch (e) {
      state = before;
      notify();
      return { ok: false, error: e.message };
    }
    notify();
    return { ok: true, result };
  }
  if (background && (locks.has(jobId) || ws.updates[jobId] || ws.conflicts[jobId])) return { ok: true, noop: true, skipped: true };
  const prev = locks.get(jobId) || Promise.resolve();
  const run = prev.then(() => commitShared(jobId, mutate, background, action));
  const guard = run.catch(() => {});
  locks.set(jobId, guard);
  try {
    return await run;
  } finally {
    if (locks.get(jobId) === guard) locks.delete(jobId);
  }
}

async function commitShared(jobId, mutate, background, action) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = bundleOf(jobId);
    const result = mutate();
    if (result === false) return { ok: true, noop: true };
    syncPubs(jobId);
    const bundle = bundleOf(jobId);
    notify();
    let res;
    try {
      res = await api(`api/workspace/jobs/${jobId}`, { method: 'PUT', body: JSON.stringify({ baseRev: ws.synced[jobId]?.rev || 0, bundle }) });
    } catch (e) {
      rollback(jobId, before);
      return { ok: false, error: e.message };
    }
    if (res.ok) {
      ws.synced[jobId] = { rev: res.data.rev, updatedAt: res.data.updatedAt, updatedBy: deviceKind() };
      ws.rev = Math.max(ws.rev, res.data.wsRev);
      if (ws.updates[jobId] && ws.updates[jobId].entry.rev <= res.data.rev) delete ws.updates[jobId]; // that "newer version" was ours
      return { ok: true, result };
    }
    if (res.status === 409) {
      const current = res.data.current;
      if (action === 'create' && current) {
        applyBundle(current.bundle);
        ws.synced[jobId] = { rev: current.rev, updatedAt: current.updatedAt, updatedBy: current.updatedBy };
        notify();
        return { ok: true, existed: true };
      }
      if (background && current) {
        applyBundle(current.bundle);
        ws.synced[jobId] = { rev: current.rev, updatedAt: current.updatedAt, updatedBy: current.updatedBy };
        continue; // re-apply the background change on top of the latest version
      }
      rollback(jobId, before);
      if (current) ws.conflicts[jobId] = { action, changes: describeChanges(before, current.bundle), entry: current };
      notify();
      return { ok: false, conflict: true };
    }
    rollback(jobId, before);
    return { ok: false, error: res.data.error || `Save failed (${res.status}).` };
  }
  return { ok: false, error: 'This job kept changing on another device. Reload and try again.' };
}

function rollback(jobId, before) {
  if (before) applyBundle(before); else removeJob(jobId);
  notify();
}

/** Load the newest server version of a job (after a conflict or an "updated elsewhere" notice). */
export function loadLatest(jobId) {
  const src = ws.conflicts[jobId]?.entry || ws.updates[jobId]?.entry;
  if (!src) return;
  applyBundle(src.bundle);
  ws.synced[jobId] = { rev: src.rev, updatedAt: src.updatedAt, updatedBy: src.updatedBy };
  delete ws.conflicts[jobId];
  delete ws.updates[jobId];
  notify();
}
export const dismissConflict = (jobId) => { delete ws.conflicts[jobId]; notify(); };
export const setFocusJob = (jobId) => { ws.focusJob = jobId || null; };

/* ---------- Boot, sign-in and polling ---------- */
export async function init() {
  try {
    const r = await api('api/auth/status');
    ws.authConfigured = !!r.data.authConfigured;
    ws.setupProblem = r.data.setupProblem || null;
    ws.storage = r.data.storage || null;
    ws.signedIn = !!r.data.signedIn;
    ws.testDate = r.data.testDate || null;
    ws.scheduler = r.data.scheduler || { runsOn: 'browser' };
    if (ws.scheduler.runsOn === 'hosted') refreshHostedStatus();
    if (ws.scheduler.now) ws.clockOffset = ws.scheduler.now - Date.now();
  } catch {
    ws.authConfigured = false;
  }
  const pref = lsGet(MODE_KEY);
  await setMode(ws.signedIn && pref !== 'local' ? 'shared' : 'local');
  ws.ready = true;
  notify();
}

export async function setMode(mode) {
  if (mode === 'shared' && !ws.signedIn) mode = 'local';
  ws.mode = mode;
  setAssetBackend(mode === 'shared' ? 'server' : 'local');
  ws.updates = {};
  ws.conflicts = {};
  ws.synced = {};
  ws.planSynced = {};
  if (mode === 'shared') {
    state = empty();
    await pullWorkspace(true);
  } else {
    state = loadLocal();
    if (!state.profile?.versions?.length) {
      // A missing seed file must not stop HQ from starting; the profile screen reports it instead.
      try {
        const data = await loadSeed();
        state.profile = { rev: 1, versions: [{ id: localVersionId(1, data), n: 1, savedAt: Date.now(), savedBy: 'seed', data }] };
        saveLocal(false);
      } catch {
        ws.profileError = 'The starting business profile (data/profile-seed.json) could not be loaded.';
      }
    }
    seedVoice();
  }
  notify();
}
export function chooseMode(mode) {
  lsSet(MODE_KEY, mode);
  return setMode(mode);
}

export async function signIn(password) {
  const r = await api('api/auth/login', { method: 'POST', body: JSON.stringify({ password }) });
  if (!r.ok) return { ok: false, error: r.data.error || 'Sign-in failed.' };
  ws.signedIn = true;
  ws.status = 'ok';
  lsSet(MODE_KEY, 'shared');
  await setMode('shared');
  await loadQuillProvider();
  return { ok: true };
}

export async function signOut() {
  await api('api/auth/logout', { method: 'POST', body: '{}' }).catch(() => {});
  ws.signedIn = false;
  await setMode('local');
  await loadQuillProvider();
}

/** Fetch the server workspace. Jobs open on screen are not swapped under you: you get a notice instead. */
async function pullWorkspace(initial = false, applyId = null) {
  const r = await api('api/workspace');
  if (!r.ok) return false;
  const snap = r.data;
  for (const e of snap.jobs) {
    const known = ws.synced[e.id];
    if (known && known.rev >= e.rev) continue;
    if (locks.has(e.id)) continue; // a save of ours is in flight; its result decides (it may be this very version)
    if (!initial && known && e.id === ws.focusJob && e.id !== applyId && !ws.conflicts[e.id] && !onlyPublishingChanged(bundleOf(e.id), e.bundle)) {
      ws.updates[e.id] = { changes: describeChanges(bundleOf(e.id), e.bundle), entry: e };
      continue;
    }
    applyBundle(e.bundle);
    ws.synced[e.id] = { rev: e.rev, updatedAt: e.updatedAt, updatedBy: e.updatedBy };
  }
  state.brand = { ...(snap.brand.data || {}) };
  if (snap.profile) { state.profile = snap.profile; ws.profileRev = snap.profile.rev; }
  for (const e of snap.plans || []) {
    if ((ws.planSynced[e.id] || 0) >= e.rev || planLocks.has(e.id)) continue;
    const i = state.plans.findIndex((p) => p.id === e.id);
    if (i >= 0) state.plans[i] = e.plan; else state.plans.push(e.plan);
    ws.planSynced[e.id] = e.rev;
  }
  state.plans.sort((a, b) => b.createdAt - a.createdAt);
  ws.brandRev = snap.brand.rev;
  ws.rev = snap.rev;
  notify();
  return true;
}

/** Changes made by the demo scheduler (publication status, receipts, log) are safe to show at once on an open job. */
function onlyPublishingChanged(mine, theirs) {
  if (!mine) return false;
  const strip = (b) => JSON.stringify({ job: { ...b.job, publications: undefined }, tasks: b.tasks });
  return strip(mine) === strip(theirs);
}

let polling = false;
export async function poll() {
  if (ws.mode !== 'shared' || polling) return;
  polling = true;
  try {
    const r = await api('api/workspace/rev');
    if (r.ok && r.data.now) ws.clockOffset = r.data.now - Date.now();
    if (r.ok && r.data.rev !== ws.rev) await pullWorkspace();
  } catch { /* offline: status already set */ } finally {
    polling = false;
  }
}

/* ---------- Domain actions ---------- */
export async function createJob({ id, brief, platform, targetDate, title, planId, planDay, kind, clip }) {
  if (id && getJob(id)) return { ok: true, existed: true, job: getJob(id) };
  const now = Date.now();
  const job = { id: id || uid('job'), brief: brief.trim(), platform, targetDate, createdAt: now, delegatedAt: now + DELEGATE_MS, taskIds: {}, approval: null, approvals: [] };
  if (kind === 'video') job.kind = 'video';
  // The tone this job works to, decided once from its brief and shown on the job.
  const pd = currentProfile()?.data;
  job.tone = { ...toneFor(job.brief), voiceSource: hasVoiceField(pd) && pd.writing.voice.trim() ? 'profile' : 'default', profileVersion: profileRef() };
  if (title) job.title = title;
  job.profileVersion = profileRef();
  if (planId) { job.planId = planId; job.planDay = planDay; }
  const res = await commit(job.id, () => {
    if (getJob(job.id)) return false;
    const tasks = ['copywriter', job.kind === 'video' ? 'video' : 'designer'].map((agentId) => {
      const task = {
        id: id ? `task_${job.id.slice(4)}${agentId === 'copywriter' ? 'c' : 'g'}` : uid('task'),
        jobId: job.id,
        agent: agentId,
        type: AGENTS[agentId].taskType,
        instruction: agentId === 'copywriter' ? `Write a ${platform} ${job.kind === 'video' ? 'post caption (the text that sits with the video, not the words shown in it)' : 'caption'} with relevant hashtags for: ${job.brief}` : agentId === 'video' ? `Script, storyboard and render a 15–30 second ${platform} video from the supplied clip for: ${job.brief}` : `Design a branded ${platform} graphic for: ${job.brief}`,
        createdAt: now,
        versions: [],
        pending: { kind: 'initial', engine: agentId === 'copywriter' || agentId === 'video' ? copyEngine() : 'demo', startAt: job.delegatedAt, readyAt: job.delegatedAt + (agentId === 'copywriter' ? COPY_MS : GRAPHIC_MS) },
      };
      if (agentId === 'video') { if (id) task.id = `task_${job.id.slice(4)}v`; task.clip = clip || null; task.draft = null; }
      job.taskIds[task.type] = task.id;
      return task;
    });
    state.jobs.unshift(job);
    state.tasks.push(...tasks);
    log(job.id, 'manager', `New brief received for ${platform}, due ${targetDate}.`);
    log(job.id, 'manager', job.kind === 'video' ? 'Delegated the post caption to Quill and the video to Cue.' : 'Delegated the caption to Quill and the graphic to Prism.');
    return job;
  }, { action: 'create' });
  return res.ok ? { ok: true, job: getJob(job.id) || job, existed: !!res.existed || !!res.noop } : res;
}

export function taskStatus(task, now = Date.now()) {
  if (task.pending?.error) return 'failed';
  if (task.pending) {
    if (now < task.pending.startAt) return 'queued';
    return task.pending.kind === 'revision' ? 'revising' : 'working';
  }
  if (task.type === 'video' && rendering.has(task.id)) return 'rendering';
  if (task.type === 'video' && !task.versions.length) return 'needs_render';
  const st = jobStatus(getJob(task.jobId), now);
  if (st === 'approved') return 'approved';
  return 'awaiting_review';
}

export function jobStatus(job, now = Date.now()) {
  const { copy, graphic } = jobTasks(job);
  if (now < job.delegatedAt) return 'delegating';
  if (copy.pending?.error || graphic.pending?.error) return 'needs_retry';
  if (copy.pending || graphic.pending) return 'in_production';
  if (!graphic.versions.length) return graphic.type === 'video' ? 'needs_render' : 'in_production';
  if (job.approval) {
    const fresh = job.approval.copyVersion === copy.versions.length && job.approval.graphicVersion === graphic.versions.length;
    return fresh ? 'approved' : 'needs_reapproval';
  }
  return 'ready_for_review';
}

export const STATUS_LABEL = {
  delegating: 'Manager delegating',
  in_production: 'In production',
  ready_for_review: 'Ready for your review',
  needs_reapproval: 'Changed, needs fresh approval',
  approved: 'Approved',
  queued: 'Queued',
  working: 'Working',
  revising: 'Revising',
  awaiting_review: 'Awaiting your review',
  idle: 'Idle',
  failed: 'Failed, retry needed',
  needs_retry: 'Needs your retry',
  needs_render: 'Storyboard ready: render the video',
  rendering: 'Rendering',
};

/** Resolve agent work whose time has come (simulated outputs, AI requests). */
export function tick(now = Date.now()) {
  dispatchLocal();
  for (const task of state.tasks.slice()) {
    if (!task.pending) continue;
    if (task.pending.engine === 'ai') { dispatchAi(task.id, now); continue; }
    if (now < task.pending.readyAt) continue;
    const taskId = task.id;
    commit(task.jobId, () => {
      const t = getTask(taskId);
      if (!t?.pending || t.pending.engine === 'ai' || Date.now() < t.pending.readyAt) return false;
      const job = getJob(t.jobId);
      if (t.type === 'video') {
        // Cue drafts an editable script and storyboard from a labelled template. The video itself is rendered by you.
        t.draft = templateStoryboard(job, t.clip);
        t.draft.savedAt = Date.now();
        t.pending = null;
        log(job.id, 'video', `Template script and storyboard ready (${t.draft.scenes.length} scenes, demo mode). Edit it, then render.`);
        return true;
      }
      const prev = currentVersion(t);
      const n = t.versions.length + 1;
      let output;
      if (t.type === 'copy') {
        output = t.pending.kind === 'initial' ? draftCaption(job, currentProfile()?.data, job.targetDate) : reviseCaption(job, prev.content, t.pending.feedback, n, currentProfile()?.data, job.targetDate);
      } else {
        // A simulated revision builds on the latest simulated design, even if Photo layout versions came after it.
        const lastSim = [...t.versions].reverse().find((x) => x.content.mode !== 'photo');
        const base = lastSim ? lastSim.content : draftGraphic(job).content;
        output = t.pending.kind === 'initial' ? draftGraphic(job, currentProfile()?.data) : reviseGraphic(job, base, t.pending.feedback, n);
      }
      t.versions.push({ n, content: output.content, notes: output.notes, feedback: t.pending.feedback || null, by: AGENTS[t.agent].name, simulated: true, source: 'demo', createdAt: t.pending.readyAt, profileVersion: profileRef() });
      t.pending = null;
      log(job.id, t.agent, `${AGENTS[t.agent].label} v${n} delivered for review.`);
      return true;
    }, { background: true });
  }
}

export async function requestRevision(taskId, feedback) {
  const task = getTask(taskId);
  if (!task || task.pending) return { ok: false, noop: true };
  const res = await commit(task.jobId, () => {
    const t = getTask(taskId);
    if (!t || t.pending) return false;
    const now = Date.now();
    t.pending = { kind: 'revision', engine: t.type === 'copy' ? copyEngine() : 'demo', feedback: feedback.trim(), startAt: now, readyAt: now + REVISION_MS };
    log(t.jobId, t.agent, `Revision requested on the ${AGENTS[t.agent].label.toLowerCase()}: "${feedback.trim()}"`);
    return true;
  }, { action: 'revision' });
  if (res.ok) tick();
  return res;
}

export function editCaption(taskId, text) {
  const task = getTask(taskId);
  if (!task || task.pending || task.type !== 'copy') return Promise.resolve({ ok: false, noop: true });
  return commit(task.jobId, () => {
    const t = getTask(taskId);
    const prev = currentVersion(t);
    if (!prev || prev.content.text === text) return false;
    t.versions.push({ n: t.versions.length + 1, content: { ...prev.content, text }, notes: ['Edited directly by you'], feedback: null, by: 'You', simulated: false, source: 'human', createdAt: Date.now(), profileVersion: profileRef() });
    log(t.jobId, 'manager', 'Caption edited by hand. The pair needs fresh approval.');
    return true;
  }, { action: 'edit' });
}

/** Approve exactly the versions shown on screen. If the job moved on elsewhere, nothing is approved. */
export async function approveJob(jobId) {
  const job = getJob(jobId);
  if (!job) return { ok: false, noop: true };
  const { copy, graphic } = jobTasks(job);
  const shown = { copyVersion: copy.versions.length, graphicVersion: graphic.versions.length };
  if (ws.mode === 'shared' && ws.updates[jobId]) {
    // We already know a newer version exists: don't even try.
    ws.conflicts[jobId] = { action: 'approve', changes: ws.updates[jobId].changes, entry: ws.updates[jobId].entry };
    delete ws.updates[jobId];
    notify();
    return { ok: false, conflict: true };
  }
  return commit(jobId, () => {
    const j = getJob(jobId);
    const st = jobStatus(j);
    if (st !== 'ready_for_review' && st !== 'needs_reapproval') return false;
    const t = jobTasks(j);
    if (t.copy.versions.length !== shown.copyVersion || t.graphic.versions.length !== shown.graphicVersion) return false;
    j.approval = { ...shown, at: Date.now() };
    j.approvals = [...(j.approvals || []), j.approval];
    log(j.id, 'manager', `Approved caption v${shown.copyVersion} with graphic v${shown.graphicVersion}. Added to the private calendar. Nothing is published or scheduled until you choose to.`);
    return true;
  }, { action: 'approve' });
}

export function agentState(agentId, now = Date.now()) {
  if (agentId === 'video') {
    if (rendering.size) return 'working'; // a render is actually running in this browser
    const mine = state.tasks.filter((t) => t.agent === 'video');
    if (mine.some((t) => t.pending && now >= t.pending.startAt)) return 'working';
    if (mine.some((t) => t.pending)) return 'queued';
    if (mine.some((t) => !t.versions.length || ['ready_for_review', 'needs_reapproval'].includes(jobStatus(getJob(t.jobId), now)))) return 'awaiting_review';
    return 'idle';
  }
  if (agentId === 'analyst') {
    if (analysing) return 'working';
    if (resultsToEnter().length) return 'queued';
    if (AN.suggestTest(AN.comparisonRows(state.jobs).rows).kind === 'test') return 'awaiting_review';
    return 'idle';
  }
  if (agentId === 'reviewer') {
    if (reviewing.size) return 'working';
    const items = reviewQueue();
    if (items.some((x) => x.kind === 'findings')) return 'awaiting_review';
    if (items.length) return 'queued';
    return 'idle';
  }
  if (agentId === 'manager') {
    if (state.jobs.some((j) => now < j.delegatedAt)) return 'delegating';
    if (state.tasks.some((t) => t.pending && !t.pending.error && now >= t.pending.startAt)) return 'working';
    return 'idle';
  }
  const mine = state.tasks.filter((t) => t.agent === agentId);
  const active = mine.filter((t) => t.pending && !t.pending.error);
  if (active.some((t) => now >= t.pending.startAt)) return active.some((t) => t.pending.kind === 'revision') ? 'revising' : 'working';
  if (mine.some((t) => t.pending?.error)) return 'failed';
  if (active.length) return 'queued';
  if (mine.some((t) => ['ready_for_review', 'needs_reapproval'].includes(jobStatus(getJob(t.jobId), now)))) return 'awaiting_review';
  return 'idle';
}

export const agentTasks = (agentId) => state.tasks.filter((t) => t.agent === agentId).sort((a, b) => b.createdAt - a.createdAt);

/* ---------- Live caption requests ---------- */
// A request is "claimed" by saving requestedAt/requestedBy first, so two devices never pay for the same caption.
async function dispatchAi(taskId, now) {
  const task = getTask(taskId);
  const p = task?.pending;
  if (!p || p.error || inFlight.has(taskId) || now < p.startAt) return;
  if (p.requestedAt) {
    const mineLost = p.requestedBy === DEVICE || !p.requestedBy;
    if (mineLost || now - p.requestedAt > STALE_REQUEST_MS) {
      inFlight.add(taskId);
      await commit(task.jobId, () => {
        const t = getTask(taskId);
        if (!t?.pending || t.pending.error || t.pending.requestedAt !== p.requestedAt) return false;
        t.pending.error = { message: mineLost ? `The page was refreshed before ${AGENTS[t.agent]?.name || 'the agent'} replied. Your work is saved. Retry to fetch the reply (no second charge).` : `${AGENTS[t.agent]?.name || 'The agent'}’s reply never arrived. Your work is saved. Retry to fetch it (no second charge).`, retryable: true, at: Date.now() };
        return true;
      }, { background: true });
      inFlight.delete(taskId);
    }
    return; // another device's request is still in flight
  }
  inFlight.add(taskId);
  const claimedAt = Date.now();
  const claim = await commit(task.jobId, () => {
    const t = getTask(taskId);
    if (!t?.pending || t.pending.error || t.pending.requestedAt || t.pending.engine !== 'ai') return false;
    t.pending.requestedAt = claimedAt;
    // One request key per action, kept across retries: if a reply was lost, the server returns the first result
    // instead of charging again.
    t.pending.requestKey = t.pending.requestKey || `${taskId}:${claimedAt}`;
    t.pending.requestedBy = DEVICE;
    return true;
  }, { background: true });
  const live = getTask(taskId);
  if (!claim.ok || claim.noop || live?.pending?.requestedAt !== claimedAt) { inFlight.delete(taskId); return; }
  const job = getJob(live.jobId);
  if (live.type === 'video') return dispatchScript(taskId, live, job, claimedAt);
  const prev = currentVersion(live);
  const body = {
    requestKey: live.pending.requestKey,
    jobId: job.id,
    kind: live.pending.kind === 'revision' ? 'revision' : 'draft',
    brief: job.brief,
    platform: job.platform,
    currentCaption: live.pending.kind === 'revision' ? prev?.content.text : undefined,
    currentVersion: prev?.n,
    feedback: live.pending.kind === 'revision' ? live.pending.feedback : undefined,
    targetDate: job.targetDate,
    profile: currentProfile() ? { versionId: currentProfile().id, data: currentProfile().data } : null,
    tone: job.tone || toneFor(job.brief),
    voice: voiceOf(currentProfile()?.data),
  };
  const usedProfile = profileRef();
  let outcome;
  try {
    const r = await fetch('api/quill/caption', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-HQ-Device': deviceKind() }, body: JSON.stringify(body) });
    let data = {};
    try { data = await r.json(); } catch { /* non-JSON error page */ }
    outcome = r.ok ? { data } : { error: { message: data.error || `Quill request failed (${r.status}).`, retryable: data.retryable !== false } };
  } catch {
    outcome = { error: { message: 'Can’t reach the HQ server. Retry when you’re connected.', retryable: true } };
  }
  if (unloading) { inFlight.delete(taskId); return; }
  await commit(job.id, () => {
    const t = getTask(taskId);
    if (!t?.pending || t.pending.requestedAt !== claimedAt) return false; // superseded
    if (outcome.data) {
      const d = outcome.data;
      const n = t.versions.length + 1;
      t.versions.push({ n, content: { text: d.caption, opts: null }, notes: d.notes ? [`v${n}: ${d.notes}`] : [], feedback: t.pending.feedback || null, by: AGENTS.copywriter.name, simulated: d.provider !== 'openai', source: d.provider, model: d.model, usage: d.usage || null, createdAt: Date.now(), profileVersion: usedProfile });
      noteUsage(getJob(t.jobId), t.pending.requestKey, t.pending.kind === 'revision' ? 'Caption revision' : 'Caption', d);
      t.pending = null;
      log(t.jobId, 'copywriter', `Caption v${n} delivered for review (${d.provider === 'openai' ? `live AI, ${d.model}` : 'mock'}).`);
    } else {
      t.pending.error = { ...outcome.error, at: Date.now() };
      log(t.jobId, 'copywriter', `Caption request failed: ${outcome.error.message}`);
    }
    return true;
  }, { background: true });
  inFlight.delete(taskId);
}

/** One click = at most one new request: ignored while a request for this task is in flight. */
export async function retryTask(taskId) {
  const task = getTask(taskId);
  if (!task?.pending?.error || inFlight.has(taskId)) return { ok: false, noop: true };
  const res = await commit(task.jobId, () => {
    const t = getTask(taskId);
    if (!t?.pending?.error) return false;
    // The request key is kept, so a retry after a lost reply can't be charged twice (see dispatchAi).
    Object.assign(t.pending, { error: null, requestedAt: null, requestedBy: null, engine: t.type === 'copy' || t.type === 'video' ? copyEngine() : 'demo', startAt: Date.now(), readyAt: Date.now() + REVISION_MS });
    return true;
  }, { action: 'retry' });
  if (res.ok) tick();
  return res;
}

/** Abandon a failed revision request; the current caption version stays as it was. */
export function cancelFailedRevision(taskId) {
  const task = getTask(taskId);
  if (!task?.pending?.error || task.pending.kind !== 'revision' || inFlight.has(taskId)) return Promise.resolve({ ok: false, noop: true });
  return commit(task.jobId, () => {
    const t = getTask(taskId);
    if (!t?.pending?.error) return false;
    log(t.jobId, 'copywriter', 'Failed revision request cancelled. Caption unchanged.');
    t.pending = null;
    return true;
  }, { action: 'cancel' });
}

/* ---------- Prism Photo layout ---------- */
/**
 * Append a Photo layout version built on `baseVersions` (the number of graphic versions the editor started from).
 * Resolves { ok, result: version } or { ok: false, conflict | error }; state is unchanged on failure.
 */
export async function saveGraphicVersion(taskId, content, notes, baseVersions) {
  const task = getTask(taskId);
  // Re-laying out an AI image keeps its origin (the layout is yours; the picture is still the model's).
  const ai = task && [...task.versions].reverse().find((v) => v.content.photoId === content.photoId && v.content.photoOrigin);
  if (ai) content = { ...content, photoOrigin: ai.content.photoOrigin, generated: ai.content.generated };
  if (!task || task.type !== 'graphic') return { ok: false, error: 'Graphic task not found.' };
  if (task.pending) return { ok: false, error: 'Prism is still working on this graphic. Wait for it to finish, then save.' };
  if (ws.mode === 'shared' && ws.updates[task.jobId]) {
    ws.conflicts[task.jobId] = { action: 'save-graphic', changes: ws.updates[task.jobId].changes, entry: ws.updates[task.jobId].entry };
    delete ws.updates[task.jobId];
    notify();
    return { ok: false, conflict: true };
  }
  let version;
  const res = await commit(task.jobId, () => {
    const t = getTask(taskId);
    if (baseVersions != null && t.versions.length !== baseVersions) return false;
    const n = t.versions.length + 1;
    version = { n, content: { ...content, mode: 'photo' }, notes, feedback: null, by: 'You with Prism', simulated: false, source: 'photo', createdAt: Date.now(), profileVersion: profileRef() };
    t.versions.push(version);
    log(t.jobId, 'designer', `Photo layout saved as graphic v${n}.`);
    return true;
  }, { action: 'save-graphic' });
  if (res.ok && res.noop) return { ok: false, error: 'The graphic changed since you opened the editor. Reload the latest version, then save again.' };
  return res.ok ? { ok: true, result: version } : res;
}

export async function setBrandLogo(id, name) {
  const prev = state.brand;
  state.brand = { ...state.brand, logoId: id, logoName: name, logoSavedAt: Date.now() };
  if (ws.mode === 'local') {
    try { saveLocal(true); } catch (e) { state.brand = prev; throw e; }
    return;
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await api('api/workspace/brand', { method: 'PUT', body: JSON.stringify({ baseRev: ws.brandRev, data: { logoId: id, logoName: name } }) });
    if (r.ok) { ws.brandRev = r.data.rev; return; }
    if (r.status === 409 && r.data.current) { ws.brandRev = r.data.current.rev; continue; } // last logo chosen wins
    state.brand = prev;
    throw new Error(r.data.error || 'The logo couldn’t be remembered.');
  }
}
// The workspace logo; until the owner sets one, the official logo deployed with HQ (public/assets/brand/).
export const brand = () => (state.brand?.logoId || !officialLogoKnown() ? state.brand || {} : { ...(state.brand || {}), logoId: BRAND.logo.id, logoName: BRAND.logo.name, official: true });

/* ---------- Import this browser's work into the shared workspace ---------- */
export function localBundles() {
  const local = loadLocal();
  return {
    bundles: local.jobs.map((job) => ({ job, tasks: local.tasks.filter((t) => t.jobId === job.id), log: local.log.filter((l) => l.jobId === job.id) })),
    brand: local.brand || {},
  };
}
export async function importPreview(bundles, brandData) {
  const r = await api('api/workspace/import', { method: 'POST', body: JSON.stringify({ bundles, brand: brandData, dryRun: true }) });
  if (!r.ok) throw new Error(r.data.error || 'Import preview failed.');
  return r.data;
}
export async function importCommit(bundles, brandData) {
  const r = await api('api/workspace/import', { method: 'POST', body: JSON.stringify({ bundles, brand: brandData }) });
  if (!r.ok) throw new Error(r.data.error || 'Import failed.');
  await pullWorkspace(true);
  return r.data;
}


/* ---------- Vektor's weekly plans ---------- */
const planLocks = new Map();
export const getPlan = (id) => (state.plans || []).find((p) => p.id === id);
export const allPlans = () => state.plans || [];
export const planJobs = (plan) => plan.days.filter((d) => d.jobId).map((d) => ({ day: d, job: getJob(d.jobId) }));

/** Persist a change to a plan. Conflicts re-apply the change on top of the latest plan (plans hold no versions). */
export async function commitPlan(planId, mutate) {
  if (!state.plans) state.plans = [];
  if (ws.mode === 'local') {
    const before = clone(state.plans);
    const r = mutate();
    if (r === false) return { ok: true, noop: true };
    try { saveLocal(true); } catch (e) { state.plans = before; notify(); return { ok: false, error: e.message }; }
    notify();
    return { ok: true };
  }
  const prev = planLocks.get(planId) || Promise.resolve();
  const run = prev.then(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = clone(getPlan(planId));
      const r = mutate();
      if (r === false) return { ok: true, noop: true };
      notify();
      let res;
      try {
        res = await api(`api/workspace/plans/${planId}`, { method: 'PUT', body: JSON.stringify({ baseRev: ws.planSynced[planId] || 0, plan: getPlan(planId) }) });
      } catch (e) {
        restorePlan(planId, before);
        return { ok: false, error: e.message };
      }
      if (res.ok) { ws.planSynced[planId] = res.data.rev; ws.rev = Math.max(ws.rev, res.data.wsRev); return { ok: true }; }
      if (res.status === 409 && res.data.current) {
        restorePlan(planId, res.data.current.plan);
        ws.planSynced[planId] = res.data.current.rev;
        continue;
      }
      restorePlan(planId, before);
      return { ok: false, error: res.data.error || `Saving the plan failed (${res.status}).` };
    }
    return { ok: false, error: 'This plan kept changing on another device. Reload and try again.' };
  });
  const guard = run.catch(() => {});
  planLocks.set(planId, guard);
  try { return await run; } finally { if (planLocks.get(planId) === guard) planLocks.delete(planId); }
}
function restorePlan(planId, plan) {
  state.plans = state.plans.filter((p) => p.id !== planId);
  if (plan) state.plans.push(clone(plan));
  state.plans.sort((a, b) => b.createdAt - a.createdAt);
  notify();
}

export async function createPlan({ weekStart, brief, method, days, model, usage }) {
  const plan = { id: uid('plan'), weekStart, brief: brief.trim(), method, model: model || null, usage: usage || null, status: 'draft', createdAt: Date.now(), days, profileVersion: profileRef(), tone: toneFor(brief) };
  const res = await commitPlan(plan.id, () => { if (getPlan(plan.id)) return false; state.plans.unshift(plan); return true; });
  return res.ok ? { ok: true, plan: getPlan(plan.id) } : res;
}

/** One explicit, paid request: Vektor drafts the week with the server's configured AI provider. */
export async function requestAiPlan(brief, weekStart, days, requestKey) {
  let r;
  try {
    r = await fetch('api/vektor/plan', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-HQ-Device': deviceKind() }, body: JSON.stringify({ requestKey, brief, weekStart, days: days.map((d) => ({ date: d.date, platform: d.platform, dayName: d.dayName })), profile: currentProfile() ? { versionId: currentProfile().id, data: currentProfile().data } : null, tone: toneFor(brief), voice: voiceOf(currentProfile()?.data) }) });
  } catch {
    return { ok: false, error: 'Can’t reach the HQ server. Your brief is kept here; try again when connected (a retry won’t be charged twice).' };
  }
  let data = {};
  try { data = await r.json(); } catch { /* ignore */ }
  return r.ok ? { ok: true, ...data } : { ok: false, error: data.error || `Planning failed (${r.status}).` };
}

function postBrief(plan, d) {
  return `${plan.brief}\n\nThis post: ${d.dayName} ${d.date}, ${d.platform}.\nAudience: ${d.audience}\nAngle: ${d.angle}\nPractical takeaway: ${d.takeaway}\nVisual brief (for the designer): ${d.visual}`;
}

const confirming = new Set();
/**
 * Create one linked job per included day. Safe to repeat: job ids are fixed on the plan before any job is created,
 * so a double tap, a refresh half-way through or a second device finishing the plan can never duplicate a post.
 */
export async function confirmPlan(planId) {
  if (confirming.has(planId)) return { ok: false, busy: true };
  confirming.add(planId);
  try {
    if (!getPlan(planId)) return { ok: false, error: 'Plan not found.' };
    const r1 = await commitPlan(planId, () => {
      const p = getPlan(planId);
      if (p.status === 'confirmed') return false;
      let changed = false;
      p.days.forEach((d, i) => { if (d.include && !d.jobId) { d.jobId = `job_${p.id.slice(5)}d${i}`; changed = true; } });
      if (p.status === 'draft') { p.status = 'creating'; p.confirmedAt = Date.now(); changed = true; }
      return changed;
    });
    if (!r1.ok) return r1;
    const plan = getPlan(planId);
    const failed = [];
    for (const d of plan.days) {
      if (!d.jobId || getJob(d.jobId)) continue;
      const res = await createJob({
        id: d.jobId,
        brief: postBrief(plan, d),
        platform: d.platform,
        targetDate: d.date,
        title: `${d.dayName}: ${d.angle}`,
        planId,
        planDay: { dayName: d.dayName, date: d.date, audience: d.audience, angle: d.angle, takeaway: d.takeaway, visual: d.visual },
      });
      if (!res.ok) failed.push({ day: d.dayName, error: res.error || 'Not saved' });
    }
    if (!failed.length) await commitPlan(planId, () => { const p = getPlan(planId); if (p.status === 'confirmed') return false; p.status = 'confirmed'; return true; });
    return failed.length ? { ok: false, failed } : { ok: true };
  } finally {
    confirming.delete(planId);
  }
}


/* ---------- Business profile ---------- */
// The shared workspace follows the server's clock (so a test clock moves dates too); demo mode uses this device's.
export const today = () => ws.testDate || (ws.mode === 'shared' ? PB.londonParts(now()).date : londonToday());
export const currentProfile = () => { const v = state.profile?.versions; return v?.length ? v[v.length - 1] : null; };
export const profileVersion = (id) => state.profile?.versions?.find((v) => v.id === id) || null;
export const profileRef = () => currentProfile()?.id || null;
function localVersionId(n, data) {
  let h = 2166136261;
  for (const ch of JSON.stringify(data)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return `pv${n}-${(h >>> 0).toString(16).padStart(8, '0').slice(0, 6)}`;
}

/** Save the profile as a new version. Resolves { ok, version } or { ok: false, conflict | error }. */
export async function saveProfile(data) {
  if (ws.mode === 'local') {
    const n = state.profile.versions.length + 1;
    const v = { id: localVersionId(n, data), n, savedAt: Date.now(), savedBy: deviceKind(), data };
    state.profile.versions.push(v);
    state.profile.rev = (state.profile.rev || 0) + 1;
    try { saveLocal(true); } catch (e) { state.profile.versions.pop(); return { ok: false, error: e.message }; }
    notify();
    return { ok: true, version: v };
  }
  const r = await api('api/workspace/profile', { method: 'PUT', body: JSON.stringify({ baseRev: ws.profileRev, data }) });
  if (r.ok) {
    state.profile = r.data.profile;
    ws.profileRev = r.data.profile.rev;
    ws.rev = Math.max(ws.rev, r.data.wsRev);
    notify();
    return { ok: true, version: currentProfile() };
  }
  if (r.status === 409 && r.data.current) return { ok: false, conflict: true, current: r.data.current };
  return { ok: false, error: r.data.error || `Saving the profile failed (${r.status}).` };
}
export function adoptProfile(p) { state.profile = p; ws.profileRev = p.rev; notify(); }

/** The newest profile version this post's content or review was based on (null for pre-profile posts). */
export function jobProfileRef(job) {
  const { copy, graphic } = jobTasks(job);
  const ids = [job.profileVersion, currentVersion(copy)?.profileVersion, currentVersion(graphic)?.profileVersion, (job.reviews || []).at(-1)?.profileVersion].filter(Boolean);
  const versions = ids.map(profileVersion).filter(Boolean).sort((a, b) => b.n - a.n);
  return versions[0] || null;
}
/** Profile changes since this post was drafted or reviewed that touch what the post actually says. */
export function jobProfileImpact(job) {
  const ref = jobProfileRef(job);
  const cur = currentProfile();
  if (!ref || !cur || ref.id === cur.id) return [];
  const copy = currentVersion(jobTasks(job).copy);
  return profileImpact({ caption: copy?.content?.text || '', platform: job.platform, refData: ref.data, curData: cur.data, refId: ref.id, curId: cur.id, date: reviewDate(job) });
}

/* ---------- Brand & Quality Reviewer ---------- */
const reviewing = new Set();
export const isReviewing = (jobId) => reviewing.has(jobId);
/** Offers must be valid on the post date (or today, if the post date has passed). */
export const reviewDate = (job) => (job.targetDate && job.targetDate > today() ? job.targetDate : today());
export const latestReview = (job) => (job.reviews || []).at(-1) || null;
export function reviewStatus(job) {
  const { copy, graphic } = jobTasks(job);
  const r = latestReview(job);
  const fr = reviewFreshness(r, copy.versions.length, graphic.versions.length);
  return { review: r, ...fr, open: r && fr.fresh ? r.findings.filter((f) => f.status === 'fail' || f.status === 'owner') : [] };
}

/** Reviews that need attention: never reviewed, outdated, findings to act on, or touched by a profile change. */
export function reviewQueue() {
  const out = [];
  for (const job of state.jobs) {
    const { copy, graphic } = jobTasks(job);
    if (!copy?.versions.length || !graphic?.versions.length || copy.pending || graphic.pending) continue;
    const st = jobStatus(job);
    const rs = reviewStatus(job);
    const impact = jobProfileImpact(job);
    if (impact.length) out.push({ job, kind: 'profile', text: impact.map((x) => x.text).join(' ') });
    else if (rs.open.length) out.push({ job, kind: 'findings', text: `${rs.open.length} finding${rs.open.length === 1 ? '' : 's'} to act on` });
    else if (rs.review && !rs.fresh && st !== 'approved') out.push({ job, kind: 'outdated', text: `Review #${rs.review.n} is outdated: ${rs.reasons.join(', ')}` });
    else if (!rs.review && st !== 'approved') out.push({ job, kind: 'new', text: 'Not reviewed yet' });
  }
  return out;
}

/** Run the Reviewer's checks on the exact current versions and append the result to the post's review history. */
export async function runReview(jobId) {
  const job = getJob(jobId);
  if (!job || reviewing.has(jobId)) return { ok: false, busy: true };
  const { copy, graphic } = jobTasks(job);
  const cv = currentVersion(copy);
  const gv = currentVersion(graphic);
  if (!cv || !gv || copy.pending || graphic.pending) return { ok: false, error: 'Wait for Quill and Prism to finish before reviewing.' };
  reviewing.add(jobId);
  notify();
  try {
    const ids = gv.content.mode === 'photo' ? [gv.content.photoId, gv.content.logoId].filter(Boolean) : gv.content.mode === 'video' ? [gv.content.videoId, gv.content.clipId].filter(Boolean) : [];
    const present = new Set([...(await assetsPresent(ids.filter((x) => !String(x).startsWith('brand:')))), ...ids.filter((x) => String(x).startsWith('brand:') && officialLogoKnown())]);
    await new Promise((r) => setTimeout(r, 700)); // a beat so the Reviewer is visibly at work
    const profile = currentProfile();
    const date = reviewDate(job);
    const result = runChecks({ job, copyVersion: cv, graphicVersion: gv, profile, brand: brand(), date, present });
    return await commit(jobId, () => {
      const j = getJob(jobId);
      const t = jobTasks(j);
      if (t.copy.versions.length !== cv.n || t.graphic.versions.length !== gv.n) return false; // changed meanwhile
      const n = (j.reviews || []).length + 1;
      j.reviews = [...(j.reviews || []), { id: `rv_${j.id.slice(4)}_${n}`, n, at: Date.now(), by: AGENTS.reviewer.name, checkDate: date, today: today(), copyVersion: cv.n, graphicVersion: gv.n, profileVersion: profile.id, ...result }];
      log(j.id, 'reviewer', `Review #${n}: ${result.findings.filter((f) => f.status === 'fail').length} problem(s), ${result.findings.filter((f) => f.status === 'owner').length} for owner review.`);
      return true;
    }, { action: 'review' });
  } finally {
    reviewing.delete(jobId);
    notify();
  }
}

async function assetsPresent(ids) {
  if (!ids.length) return [];
  if (ws.mode === 'shared') {
    const r = await api('api/assets/check', { method: 'POST', body: JSON.stringify({ ids }) }).catch(() => null);
    return r?.ok ? r.data.present : [];
  }
  const { getLocalAsset } = await import('./photo.js');
  const out = [];
  for (const id of ids) if (await getLocalAsset(id).catch(() => null)) out.push(id);
  return out;
}


/* ---------- Demo publishing and scheduling ---------- */
// Approval only puts a post on the calendar. Publishing needs a separate, explicit confirmation of the destination and
// action. The record names the exact versions you authorised (see publishing.js for the rules).
const liveBundle = (jobId) => ({ job: getJob(jobId), tasks: state.tasks.filter((t) => t.jobId === jobId) });
function syncPubs(jobId) {
  const job = getJob(jobId);
  if (job?.publications?.length) PB.syncPublications(liveBundle(jobId), now(), deviceKind());
}
export const schedulerInfo = () => (ws.mode === 'shared' ? { runsOn: 'server', ...ws.scheduler } : { runsOn: 'browser' });
/** Supabase workspaces: whether the hosted scheduler is on for this workspace and how its latest run went. */
let hostedTimer = null;
async function refreshHostedStatus() {
  const r = await api('api/scheduler/status').catch(() => null);
  if (r?.ok && r.data.hosted) { ws.hostedStatus = r.data; notify(); }
  if (!hostedTimer && typeof setInterval === 'function') hostedTimer = setInterval(() => { if (ws.mode === 'shared' && ws.scheduler?.runsOn === 'hosted') refreshHostedStatus(); }, 60000);
}

// Demo mode: the simulated publisher keeps its own records in this browser, apart from HQ's data, like a remote service.
const PUB_KEY = 'nexai-hq:demo-publisher';
const FAULT_KEY = 'nexai-hq:demo-publisher-fault';
const readPub = () => { try { return JSON.parse(lsGet(PUB_KEY) || '{}'); } catch { return {}; } };
const localPublisher = PB.makePublisher({
  store: {
    get: (id) => readPub()[id] || null,
    put: (id, rec) => { const all = readPub(); all[id] = rec; localStorage.setItem(PUB_KEY, JSON.stringify(all)); },
  },
  now: () => now(),
  takeFault: () => { const f = lsGet(FAULT_KEY); if (f) { try { localStorage.removeItem(FAULT_KEY); } catch { /* ignore */ } } return f; },
});
export const localReceipts = () => Object.values(readPub()).map((r) => r.receipt);

function runLocal(jobId, force) {
  return commit(jobId, () => PB.runDue(liveBundle(jobId), { now: now(), profileData: currentProfile()?.data, publisher: localPublisher, by: deviceKind(), force }) || false, { background: true });
}
let dispatching = false;
function dispatchLocal() {
  if (ws.mode !== 'local' || dispatching || !ws.ready) return;
  const t = now();
  const due = state.jobs.filter((j) => (j.publications || []).some((p) => (p.status === 'scheduled' && p.scheduledFor <= t) || (p.status === 'publishing' && t - (p.lastAttemptAt || 0) >= PB.RETRY_MS)));
  if (!due.length) return;
  dispatching = true;
  Promise.all(due.map((j) => runLocal(j.id, false))).finally(() => { dispatching = false; });
}

/** Send what's due for this job now: in demo mode here, in the shared workspace on the HQ server. */
async function runPublications(jobId) {
  if (ws.mode === 'local') return runLocal(jobId, true);
  const r = await api('api/publish/run', { method: 'POST', body: JSON.stringify({ jobId }) }).catch((e) => ({ ok: false, data: { error: e.message } }));
  await pullWorkspace(false, jobId);
  return r.ok ? { ok: true } : { ok: false, error: r.data.error || 'The HQ server didn’t run the publication.' };
}

const pubBusy = new Set();
async function pubCommit(jobId, fn, action) {
  if (pubBusy.has(jobId)) return { ok: false, busy: true }; // a double tap is one action
  if (ws.mode === 'shared' && ws.updates[jobId]) {
    ws.conflicts[jobId] = { action, changes: ws.updates[jobId].changes, entry: ws.updates[jobId].entry };
    delete ws.updates[jobId];
    notify();
    return { ok: false, conflict: true };
  }
  pubBusy.add(jobId);
  try {
    let out = {};
    const res = await commit(jobId, () => {
      if (!getJob(jobId)) return false;
      out = fn(liveBundle(jobId), now()) || {};
      return out.error || out.existing ? false : true;
    }, { action });
    if (!res.ok) return res;
    if (out.error) return { ok: false, error: out.error };
    if (out.existing) return { ok: true, existing: out.existing };
    return { ok: true, pub: out.pub };
  } finally {
    pubBusy.delete(jobId);
  }
}
export const isPubBusy = (jobId) => pubBusy.has(jobId);

/** "Publish now (demo)" or "Schedule (demo)", after you confirmed the destination, versions and time. */
export async function authorisePublication(jobId, { action, scheduledFor, media = null }) {
  const res = await pubCommit(jobId, (b, t) => {
    const out = PB.authorise(b, { action, scheduledFor, now: t, by: deviceKind(), media });
    if (out.pub) log(jobId, 'manager', action === 'now' ? `Publish now (demo) confirmed for ${b.job.platform}.` : `Scheduled (demo) for ${PB.fmtLondon(scheduledFor)} on ${b.job.platform}.`);
    return out;
  }, 'publish');
  if (res.ok && res.pub && action === 'now') await runPublications(jobId);
  return res;
}
export const reschedulePublication = (jobId, pubId, scheduledFor) => pubCommit(jobId, (b, t) => {
  const p = (b.job.publications || []).find((x) => x.id === pubId);
  const out = p ? PB.reschedule(p, { scheduledFor, now: t, by: deviceKind() }) : { error: 'Publication not found.' };
  if (out.pub) log(jobId, 'manager', `Rescheduled (demo) to ${PB.fmtLondon(scheduledFor)}.`);
  return out;
}, 'reschedule');
export const cancelPublication = (jobId, pubId) => pubCommit(jobId, (b, t) => {
  const p = (b.job.publications || []).find((x) => x.id === pubId);
  const out = p ? PB.cancel(p, { now: t, by: deviceKind() }) : { error: 'Publication not found.' };
  if (out.pub) log(jobId, 'manager', `Scheduled demo post #${p.n} cancelled.`);
  return out;
}, 'cancel-publication');
export async function releaseHeldPublication(jobId, pubId) {
  const res = await pubCommit(jobId, (b, t) => {
    const p = (b.job.publications || []).find((x) => x.id === pubId);
    return p ? PB.releaseHeld(p, { now: t, by: deviceKind() }) : { error: 'Publication not found.' };
  }, 'release');
  if (res.ok && res.pub) await runPublications(jobId);
  return res;
}
/** Ask the publisher again about a post that got no answer. Safe: the publisher dedupes by publication id. */
export async function retryPublication(jobId) {
  if (pubBusy.has(jobId)) return { ok: false, busy: true };
  pubBusy.add(jobId);
  try { return await runPublications(jobId); } finally { pubBusy.delete(jobId); }
}


/* ---------- Vantage, the Marketing Analyst ---------- */
/** Your published demo posts that have no results entered yet (sample posts excluded). */
export const resultsToEnter = () => state.jobs.filter((j) => !j.sample && AN.publishedPub(j) && !(j.measurements || []).length);
export const hasSampleData = () => state.jobs.some((j) => j.sample);

const measuring = new Set();
/** Record a cumulative snapshot of a published post's results. Earlier snapshots are kept. */
export async function recordMeasurement(jobId, values) {
  if (measuring.has(jobId)) return { ok: false, busy: true };
  const job = getJob(jobId);
  if (!job) return { ok: false, error: 'Post not found.' };
  const check = AN.validateMeasurement(job, values, today());
  if (check.error) return { ok: false, error: check.error };
  measuring.add(jobId);
  try {
    let rec;
    const res = await commit(jobId, () => {
      const j = getJob(jobId);
      const again = AN.validateMeasurement(j, values, today());
      if (again.error) return false;
      const n = (j.measurements || []).length + 1;
      rec = {
        id: `ms_${j.id.slice(4)}_${n}`, n, pubId: again.pub.id, copyVersion: again.pub.copyVersion, graphicVersion: again.pub.graphicVersion,
        platform: j.platform, publishedOn: again.publishedOn, measuredOn: values.measuredOn, windowDays: again.windowDays,
        impressions: values.impressions, clicks: values.clicks, enquiries: values.enquiries, source: 'owner', enteredAt: Date.now(), by: deviceKind(),
      };
      j.measurements = [...(j.measurements || []), rec];
      log(j.id, 'analyst', `Results measured ${AN.fmtDay(values.measuredOn)} (day ${again.windowDays}) recorded for caption v${rec.copyVersion} + graphic v${rec.graphicVersion}.`);
      return true;
    }, { action: 'results' });
    if (!res.ok) return res;
    if (res.noop) return { ok: false, error: 'The post changed while saving. Check the figures and try again.' };
    return { ok: true, measurement: rec };
  } finally {
    measuring.delete(jobId);
  }
}

/** Add the two labelled sample LinkedIn posts (made-up figures, measured 7 days after publishing). Safe to repeat. */
export async function addSampleData() {
  const base = AN.addDays(AN.mondayOf(today()), -14);
  const results = [];
  for (const sp of AN.SAMPLE_POSTS) {
    const id = `job_sample${sp.key}`;
    if (getJob(id)) continue;
    const pubOn = AN.addDays(base, sp.dayOffset);
    const at = PB.fromLondon(pubOn, '08:30').ms;
    const job = {
      id, sample: true, title: sp.title, brief: `Sample post (made-up figures, not a real result): LinkedIn post about ${sp.title.toLowerCase()}.`, platform: 'LinkedIn', targetDate: pubOn,
      createdAt: at - 2 * 86400000, delegatedAt: at - 2 * 86400000, taskIds: { copy: `task_sample${sp.key}c`, graphic: `task_sample${sp.key}g` }, profileVersion: profileRef(),
    };
    job.approval = { copyVersion: 1, graphicVersion: 1, at: at - 86400000 };
    job.approvals = [job.approval];
    const pubId = `pub_sample${sp.key}_1`;
    job.publications = [{
      id: pubId, n: 1, action: 'schedule', platform: 'LinkedIn', account: { ...PB.accountFor('LinkedIn') }, copyVersion: 1, graphicVersion: 1, approvedAt: job.approval.at,
      scheduledFor: at, createdAt: at - 86400000, by: 'sample', status: 'published', attempts: 1, publishedAt: at, sample: true,
      receipt: { id: `rcpt_sample${sp.key}`, publicationId: pubId, platform: 'LinkedIn', accountId: 'demo-linkedin', acceptedAt: at, copyVersion: 1, graphicVersion: 1, scheduledFor: at, postUrl: `https://demo-publisher.invalid/linkedin/sample-${sp.key}`, simulated: true },
      events: [{ at, type: 'published', text: 'Sample post: a made-up publication for trying the Analyst. Nothing was published anywhere.', by: 'sample' }],
    }];
    job.measurements = [{
      id: `ms_sample${sp.key}_1`, n: 1, pubId, copyVersion: 1, graphicVersion: 1, platform: 'LinkedIn', publishedOn: pubOn, measuredOn: AN.addDays(pubOn, 7), windowDays: 7,
      impressions: sp.impressions, clicks: sp.clicks, enquiries: sp.enquiries, source: 'sample', enteredAt: Date.now(), by: 'sample',
    }];
    const g = draftGraphic({ ...job, brief: `LinkedIn post about ${sp.title.toLowerCase()}` }, currentProfile()?.data);
    const tasks = [
      { id: job.taskIds.copy, jobId: id, agent: 'copywriter', type: 'copy', instruction: `Sample caption: ${sp.title}`, createdAt: job.createdAt, pending: null,
        versions: [{ n: 1, content: { text: sp.caption, opts: null }, notes: ['Sample caption for trying the Analyst'], feedback: null, by: 'Sample', simulated: true, source: 'demo', createdAt: job.createdAt, profileVersion: profileRef() }] },
      { id: job.taskIds.graphic, jobId: id, agent: 'designer', type: 'graphic', instruction: `Sample graphic: ${sp.title}`, createdAt: job.createdAt, pending: null,
        versions: [{ n: 1, content: g.content, notes: ['Sample graphic'], feedback: null, by: 'Sample', simulated: true, source: 'demo', createdAt: job.createdAt, profileVersion: profileRef() }] },
    ];
    const res = await commit(id, () => {
      if (getJob(id)) return false;
      state.jobs.push(job);
      state.jobs.sort((a, b) => b.createdAt - a.createdAt);
      state.tasks.push(...tasks);
      log(id, 'analyst', `Sample post “${sp.title}” added with made-up 7-day figures.`);
      return true;
    }, { action: 'create' });
    results.push(res);
  }
  return results.every((r) => r.ok) ? { ok: true } : { ok: false, error: results.find((r) => !r.ok)?.error || 'Sample data wasn’t saved.' };
}

let analysing = false;
/** A short visible beat while Vantage rebuilds the summary (the work itself is instant and local). */
export function analyse(ms = 800) {
  analysing = true;
  notify();
  setTimeout(() => { analysing = false; notify(); }, ms);
}

/* ---------- Cue, the Video Creator ---------- */
const rendering = new Map(); // taskId -> progress 0..1 (renders run in this browser)
export const renderProgress = (taskId) => rendering.get(taskId);
export function setRendering(taskId, progress) {
  if (progress == null) rendering.delete(taskId); else rendering.set(taskId, progress);
  notify();
}
export const videoTasks = () => state.tasks.filter((t) => t.type === 'video').sort((a, b) => b.createdAt - a.createdAt);

/** Save the editable script and storyboard (no new version: a version is a rendered video). */
export function saveVideoDraft(taskId, draft) {
  const task = getTask(taskId);
  if (!task) return Promise.resolve({ ok: false, error: 'Video task not found.' });
  return commit(task.jobId, () => {
    const t = getTask(taskId);
    const { savedAt, ...prev } = t.draft || {};
    const { savedAt: _ignored, ...next } = draft;
    void savedAt; void _ignored;
    if (JSON.stringify(prev) === JSON.stringify(next)) return false;
    t.draft = { ...clone(next), savedAt: Date.now() };
    return true;
  }, { action: 'save-draft' });
}

/** A finished render becomes the next video version; earlier versions are kept. */
export async function addVideoVersion(taskId, { videoId, mime, ext, label, durationMs, width, height, size, storyboard, note }, baseVersions) {
  const task = getTask(taskId);
  if (!task) return { ok: false, error: 'Video task not found.' };
  let version;
  const res = await commit(task.jobId, () => {
    const t = getTask(taskId);
    if (baseVersions != null && t.versions.length !== baseVersions) return false;
    const n = t.versions.length + 1;
    version = {
      n, by: 'You with Cue', simulated: false, source: 'render', createdAt: Date.now(), profileVersion: profileRef(), feedback: note || null,
      content: { mode: 'video', videoId, mime, ext, formatLabel: label, durationMs, width, height, size, clipId: t.clip?.id || null, sampleFootage: !!t.clip?.sample, logoId: state.brand?.logoId || null, logoName: state.brand?.logoName || null, storyboard: clone(storyboard) },
      notes: [n === 1 ? `Rendered from the storyboard (${storyboard.scenes.length} scenes).` : `v${n}: ${note || 'Re-rendered from the edited storyboard.'}`],
    };
    t.versions.push(version);
    log(t.jobId, 'video', `Video v${n} rendered: ${label}, ${(durationMs / 1000).toFixed(1)} s.${n > 1 ? ' The pair needs fresh approval.' : ''}`);
    return true;
  }, { action: 'save-video' });
  if (res.ok && res.noop) return { ok: false, error: 'The video changed since you started this render. Reload the latest version, then render again.' };
  return res.ok ? { ok: true, result: version } : res;
}


/* ---------- Editorial voice in the business profile ---------- */
/**
 * Profiles saved before the editorial voice existed get it as a new profile version, with every other field exactly
 * as the owner left it. A profile that already has a voice (even an edited or blank one) is never touched.
 */
function seedVoice() {
  const cur = currentProfile();
  if (!cur || hasVoiceField(cur.data)) return;
  const data = clone(cur.data);
  data.writing = { ...(data.writing || {}), voice: DEFAULT_VOICE };
  const n = state.profile.versions.length + 1;
  state.profile.versions.push({ id: localVersionId(n, data), n, savedAt: Date.now(), savedBy: 'update: editorial voice added', data });
  state.profile.rev = (state.profile.rev || 0) + 1;
  saveLocal(false);
}
export const activeVoice = () => voiceOf(currentProfile()?.data);


/* ---------- Live AI (OpenAI): usage per job, Cue's script, Prism's images, Calibre and Vantage extras ---------- */
export const liveAi = () => quill.provider === 'openai' || quill.provider === 'mock';
export const newRequestKey = (prefix) => `${prefix}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Record a paid call's usage on the job (once per request key, so a repeated reply isn't counted twice). */
function noteUsage(job, requestKey, what, d) {
  if (!job || !d) return;
  job.aiUsage = job.aiUsage || [];
  if (requestKey && job.aiUsage.some((u) => u.requestKey === requestKey)) return;
  job.aiUsage.push({ at: Date.now(), requestKey: requestKey || null, what, provider: d.provider || 'mock', model: d.model || null, ...(d.usage || {}) });
}
export function jobUsage(job) {
  const rows = job.aiUsage || [];
  const known = rows.filter((r) => typeof r.estCostUsd === 'number');
  return { rows, totalUsd: known.reduce((a, r) => a + r.estCostUsd, 0), tokens: rows.reduce((a, r) => a + (r.totalTokens || 0), 0), unpriced: rows.length - known.length };
}

async function postJson(path, body) {
  let r;
  try { r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-HQ-Device': deviceKind() }, body: JSON.stringify(body) }); } catch { return { ok: false, error: 'Can’t reach the HQ server. Your work is saved; try again when you’re connected.', retryable: true, lost: true }; }
  let data = {};
  try { data = await r.json(); } catch { /* ignore */ }
  if (r.status === 401) { ws.signedIn = false; ws.status = 'signed_out'; notify(); }
  return r.ok ? { ok: true, data } : { ok: false, error: data.error || `Request failed (${r.status}).`, retryable: data.retryable !== false, code: data.code, usage: data.usage || null };
}

/** Cue: script and storyboard from the text model (claimed like a caption, so it runs once). */
async function dispatchScript(taskId, task, job, claimedAt) {
  const res = await postJson('api/video/script', {
    requestKey: task.pending.requestKey, jobId: job.id, brief: job.brief, platform: job.platform, clipDuration: task.clip?.duration || 20,
    profile: currentProfile() ? { versionId: currentProfile().id, data: currentProfile().data } : null, tone: job.tone || toneFor(job.brief), voice: voiceOf(currentProfile()?.data),
  });
  if (unloading) { inFlight.delete(taskId); return; }
  await commit(job.id, () => {
    const t = getTask(taskId);
    if (!t?.pending || t.pending.requestedAt !== claimedAt) return false;
    if (res.ok) {
      const d = res.data;
      const base = templateStoryboard(getJob(t.jobId), t.clip);
      t.draft = { ...base, scenes: d.scenes.map((sc, i) => ({ id: `sc${Date.now().toString(36)}${i}`, ...sc })), label: d.provider === 'openai' ? `AI script and storyboard (live, ${d.model})` : 'Mock script and storyboard (test mode, not AI)', source: d.provider, model: d.model, usage: d.usage || null, savedAt: Date.now() };
      noteUsage(getJob(t.jobId), t.pending.requestKey, 'Video script and storyboard', d);
      t.pending = null;
      log(t.jobId, 'video', `Script and storyboard ready (${d.provider === 'openai' ? `live AI, ${d.model}` : 'mock'}). Edit it, then render.`);
    } else {
      t.pending.error = { message: res.error, retryable: res.retryable, at: Date.now() };
      log(t.jobId, 'video', `Script request failed: ${res.error}`);
    }
    return true;
  }, { background: true });
  inFlight.delete(taskId);
}
/** After a failed script request: use the labelled template storyboard instead (no charge). */
export function useTemplateStoryboard(taskId) {
  const task = getTask(taskId);
  if (!task || task.type !== 'video' || !task.pending?.error) return Promise.resolve({ ok: false, noop: true });
  return commit(task.jobId, () => {
    const t = getTask(taskId);
    if (!t?.pending?.error) return false;
    t.draft = { ...templateStoryboard(getJob(t.jobId), t.clip), savedAt: Date.now() };
    t.pending = null;
    log(t.jobId, 'video', 'Used the template storyboard instead (demo mode, not AI).');
    return true;
  }, { action: 'template' });
}

/**
 * Prism: generate a new image or edit the current one (one paid request per tap), then save it as a Photo layout
 * version with the workspace logo and the current headline. Layout changes afterwards are local and free.
 */
const imaging = new Set();
export const isImaging = (taskId) => imaging.has(taskId) || !!getTask(taskId)?.imageRequest?.inFlight;
export async function prismImage(taskId, { op, prompt, scene }) {
  const task = getTask(taskId);
  if (!task || task.type !== 'graphic') return { ok: false, error: 'Graphic task not found.' };
  if (task.pending) return { ok: false, error: 'Prism is still working on this graphic. Wait for it to finish.' };
  if (imaging.has(taskId)) return { ok: false, busy: true }; // a double tap is one request
  const cur = currentVersion(task);
  const baseAssetId = op === 'edit' ? cur?.content?.photoId : null;
  if (op === 'edit' && !baseAssetId) return { ok: false, error: 'There’s no photo to edit yet. Generate or upload one first.' };
  imaging.add(taskId);
  notify();
  try {
    // Reuse the key of an unfinished request for the same action (a refresh or retry), else make a new one.
    const prior = task.imageRequest && !task.imageRequest.doneAt && task.imageRequest.op === op && task.imageRequest.prompt === prompt.trim() ? task.imageRequest : null;
    const requestKey = prior?.requestKey || newRequestKey(`${taskId}:img`);
    const claimed = await commit(task.jobId, () => { const t = getTask(taskId); t.imageRequest = { requestKey, op, prompt: prompt.trim(), scene: scene || null, at: Date.now(), by: DEVICE, inFlight: true }; return true; }, { action: 'image' });
    if (!claimed.ok) return claimed;
    const job = getJob(task.jobId);
    const res = await postJson('api/prism/image', { requestKey, jobId: job.id, op, prompt: prompt.trim(), platform: job.platform, baseAssetId });
    let version;
    const saved = await commit(task.jobId, () => {
      const t = getTask(taskId);
      if (!res.ok) { t.imageRequest = { ...t.imageRequest, inFlight: false, error: res.error }; noteUsage(getJob(t.jobId), `${requestKey}:failed`, `Image ${op} (failed)`, res.usage ? { provider: quill.provider, model: res.usage.model, usage: res.usage } : null); return true; }
      const d = res.data;
      const last = [...t.versions].reverse().find((v) => v.content.mode === 'photo');
      const lastSim = [...t.versions].reverse().find((v) => v.content.mode !== 'photo');
      const n = t.versions.length + 1;
      version = {
        n, by: 'Prism with live AI', simulated: d.provider !== 'openai', source: d.provider, model: d.model, usage: d.usage || null, createdAt: Date.now(), profileVersion: profileRef(), feedback: op === 'edit' ? prompt.trim() : null,
        content: {
          mode: 'photo', photoId: d.assetId, photoName: d.name, photoOrigin: d.provider === 'openai' ? 'ai' : 'mock', generated: { op, prompt: prompt.trim(), scene: scene || null, model: d.model, provider: d.provider, requestKey },
          logoId: state.brand?.logoId || (officialLogoKnown() ? BRAND.logo.id : null) || last?.content.logoId || null, logoName: state.brand?.logoName || (officialLogoKnown() ? BRAND.logo.name : null) || last?.content.logoName || null,
          headline: last?.content.headline || (lastSim?.content.headline || []).join(' ') || '', headlinePos: last?.content.headlinePos || 'bottom', crop: { zoom: 1, fx: 0.5, fy: 0.5 }, logoScale: last?.content.logoScale || 1,
        },
        notes: [op === 'edit' ? `v${n}: Image edited with ${d.model}: “${prompt.trim()}”. Logo, headline and crop are added locally.` : `v${n}: Image generated with ${d.model}${scene ? ` for “${scene}”` : ''}. Logo, headline and crop are added locally.`],
      };
      t.versions.push(version);
      t.imageRequest = { ...t.imageRequest, inFlight: false, doneAt: Date.now(), version: n };
      noteUsage(getJob(t.jobId), requestKey, op === 'edit' ? 'Image edit' : 'Image', d);
      log(t.jobId, 'designer', `Graphic v${n}: ${op === 'edit' ? 'edited' : 'generated'} image (${d.provider === 'openai' ? `live AI, ${d.model}` : 'mock'}).`);
      return true;
    }, { action: 'image', background: true });
    if (!res.ok) return { ok: false, error: res.error };
    return saved.ok ? { ok: true, version } : saved;
  } finally {
    imaging.delete(taskId);
    notify();
  }
}

/** Calibre: an optional AI wording review of the current caption (advisory; the rule checks still decide). */
const wording = new Set();
export const isWordingReviewing = (jobId) => wording.has(jobId);
export async function aiWordingReview(jobId) {
  const job = getJob(jobId);
  if (!job || wording.has(jobId)) return { ok: false, busy: true };
  const { copy } = jobTasks(job);
  const cv = currentVersion(copy);
  if (!cv) return { ok: false, error: 'There’s no caption to review yet.' };
  wording.add(jobId);
  notify();
  try {
    const requestKey = `${jobId}:wr:${cv.n}:${(job.wordingReviews || []).length + 1}`;
    const res = await postJson('api/review/wording', { requestKey, jobId, caption: cv.content.text, platform: job.platform, brief: job.brief, tone: job.tone || toneFor(job.brief), voice: voiceOf(currentProfile()?.data), profile: currentProfile() ? { versionId: currentProfile().id, data: currentProfile().data } : null });
    if (!res.ok) return res;
    const d = res.data;
    return await commit(jobId, () => {
      const j = getJob(jobId);
      j.wordingReviews = [...(j.wordingReviews || []), { n: (j.wordingReviews || []).length + 1, at: Date.now(), copyVersion: cv.n, provider: d.provider, model: d.model, summary: d.summary, suggestions: d.suggestions, usage: d.usage || null }];
      noteUsage(j, requestKey, 'AI wording review', d);
      log(jobId, 'reviewer', `AI wording review of caption v${cv.n}: ${d.suggestions.length} suggestion(s) (${d.provider === 'openai' ? d.model : 'mock'}).`);
      return true;
    }, { action: 'wording' });
  } finally {
    wording.delete(jobId);
    notify();
  }
}

/** Vantage: an optional written interpretation of the actual figures (numbers are checked server-side). */
export async function aiInterpret(rows, window) {
  return postJson('api/analyst/interpret', { requestKey: newRequestKey('interpret'), rows, window });
}
