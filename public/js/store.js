// Persistence + domain logic. Browser storage only (milestone 1 prototype).
import { draftCaption, reviseCaption, draftGraphic, reviseGraphic } from './generators.js';

const KEY = 'nexai-hq:v1';
const DELEGATE_MS = 1600; // Manager briefing time
const COPY_MS = 4200;
const GRAPHIC_MS = 5600;
const REVISION_MS = 3800;

export const AGENTS = {
  manager: { id: 'manager', name: 'Vektor', role: 'Marketing Manager' },
  copywriter: { id: 'copywriter', name: 'Quill', role: 'Copywriter', taskType: 'copy', label: 'Caption' },
  designer: { id: 'designer', name: 'Prism', role: 'Creative Designer', taskType: 'graphic', label: 'Graphic' },
};

export const PLATFORMS = ['LinkedIn', 'Instagram', 'Facebook', 'X'];

const empty = () => ({ jobs: [], tasks: [], log: [], brand: {} });

/* ---------- Quill provider (server-side AI) ---------- */
// provider: 'anthropic' (live AI), 'mock' (test fixture) or 'demo' (local templates, no server AI).
export let quill = { provider: 'demo', model: null, label: 'Local demo templates', checked: false };
export async function loadQuillProvider() {
  try {
    const r = await fetch('api/quill/status', { cache: 'no-store' });
    if (r.ok) {
      const info = await r.json();
      quill = { provider: info.provider === 'live' ? 'anthropic' : info.provider, model: info.model, label: info.label, checked: true };
    }
  } catch {
    quill = { ...quill, checked: true };
  }
  listeners.forEach((fn) => fn());
  return quill;
}
const copyEngine = () => (quill.provider === 'demo' ? 'demo' : 'ai');
const inFlight = new Set(); // task ids with a caption request currently awaiting the server (this tab only)
let state = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw);
    return { ...empty(), ...parsed };
  } catch {
    return empty();
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable: app still works for this tab */
  }
  listeners.forEach((fn) => fn());
}

/** Save and report failure (used where a silent failure would wrongly claim success). */
function saveStrict() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    const full = e && (e.name === 'QuotaExceededError' || /quota/i.test(e.message || ''));
    throw new Error(full ? 'This browser’s storage is full, so the design wasn’t saved. Your job and earlier versions are unchanged.' : 'This browser blocked saving, so the design wasn’t saved. Your job and earlier versions are unchanged.');
  } finally {
    listeners.forEach((fn) => fn());
  }
}

export const subscribe = (fn) => listeners.add(fn);
export const getState = () => state;
const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function log(jobId, agent, text) {
  state.log.unshift({ id: uid('log'), jobId, agent, text, at: Date.now() });
  state.log = state.log.slice(0, 200);
}

export function createJob({ brief, platform, targetDate }) {
  const now = Date.now();
  const job = {
    id: uid('job'),
    brief: brief.trim(),
    platform,
    targetDate,
    createdAt: now,
    delegatedAt: now + DELEGATE_MS,
    taskIds: {},
    approval: null, // { copyVersion, graphicVersion, at }
    approvals: [],
  };
  for (const agentId of ['copywriter', 'designer']) {
    const task = {
      id: uid('task'),
      jobId: job.id,
      agent: agentId,
      type: AGENTS[agentId].taskType,
      instruction:
        agentId === 'copywriter'
          ? `Write a ${platform} caption with relevant hashtags for: ${job.brief}`
          : `Design a branded ${platform} graphic for: ${job.brief}`,
      createdAt: now,
      versions: [],
      pending: {
        kind: 'initial',
        engine: agentId === 'copywriter' ? copyEngine() : 'demo',
        startAt: job.delegatedAt,
        readyAt: job.delegatedAt + (agentId === 'copywriter' ? COPY_MS : GRAPHIC_MS),
      },
    };
    job.taskIds[task.type] = task.id;
    state.tasks.push(task);
  }
  state.jobs.unshift(job);
  log(job.id, 'manager', `New brief received for ${platform}, due ${targetDate}.`);
  log(job.id, 'manager', 'Delegated the caption to Quill and the graphic to Prism.');
  save();
  return job;
}

export const getJob = (id) => state.jobs.find((j) => j.id === id);
export const getTask = (id) => state.tasks.find((t) => t.id === id);
export const jobTasks = (job) => ({ copy: getTask(job.taskIds.copy), graphic: getTask(job.taskIds.graphic) });
export const currentVersion = (task) => task.versions[task.versions.length - 1] || null;

export function taskStatus(task, now = Date.now()) {
  if (task.pending?.error) return 'failed';
  if (task.pending) {
    if (now < task.pending.startAt) return 'queued';
    return task.pending.kind === 'revision' ? 'revising' : 'working';
  }
  const job = getJob(task.jobId);
  const st = jobStatus(job, now);
  if (st === 'approved') return 'approved';
  return 'awaiting_review';
}

export function jobStatus(job, now = Date.now()) {
  const { copy, graphic } = jobTasks(job);
  if (now < job.delegatedAt) return 'delegating';
  if (copy.pending?.error || graphic.pending?.error) return 'needs_retry';
  if (copy.pending || graphic.pending) return 'in_production';
  if (job.approval) {
    const fresh =
      job.approval.copyVersion === copy.versions.length && job.approval.graphicVersion === graphic.versions.length;
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
};

/** Resolve any agent work whose time has come. Returns true if state changed. */
export function tick(now = Date.now()) {
  let changed = false;
  for (const task of state.tasks) {
    if (!task.pending) continue;
    if (task.pending.engine === 'ai') {
      if (dispatchAi(task, now)) changed = true;
      continue;
    }
    if (now < task.pending.readyAt) continue;
    const job = getJob(task.jobId);
    const prev = currentVersion(task);
    const n = task.versions.length + 1;
    let output;
    if (task.type === 'copy') {
      output = task.pending.kind === 'initial' ? draftCaption(job) : reviseCaption(job, prev.content, task.pending.feedback, n);
    } else {
      // A simulated revision builds on the latest simulated design, even if Photo layout versions came after it.
      const lastSim = [...task.versions].reverse().find((x) => x.content.mode !== 'photo');
      const base = lastSim ? lastSim.content : draftGraphic(job).content;
      output = task.pending.kind === 'initial' ? draftGraphic(job) : reviseGraphic(job, base, task.pending.feedback, n);
    }
    task.versions.push({
      n,
      content: output.content,
      notes: output.notes,
      feedback: task.pending.feedback || null,
      by: AGENTS[task.agent].name,
      simulated: true,
      source: 'demo',
      createdAt: task.pending.readyAt,
    });
    task.pending = null;
    log(job.id, task.agent, `${AGENTS[task.agent].label} v${n} delivered for review.`);
    changed = true;
  }
  if (changed) save();
  return changed;
}

export function requestRevision(taskId, feedback) {
  const task = getTask(taskId);
  if (!task || task.pending) return;
  const now = Date.now();
  task.pending = {
    kind: 'revision',
    engine: task.type === 'copy' ? copyEngine() : 'demo',
    feedback: feedback.trim(),
    startAt: now,
    readyAt: now + REVISION_MS,
  };
  log(task.jobId, task.agent, `Revision requested on the ${AGENTS[task.agent].label.toLowerCase()}: "${feedback.trim()}"`);
  save();
  tick(); // send the request now rather than on the next timer tick
}

export function editCaption(taskId, text) {
  const task = getTask(taskId);
  if (!task || task.pending || task.type !== 'copy') return;
  const prev = currentVersion(task);
  if (prev && prev.content.text === text) return;
  task.versions.push({
    n: task.versions.length + 1,
    content: { ...prev.content, text },
    notes: ['Edited directly by you'],
    feedback: null,
    by: 'You',
    simulated: false,
    source: 'human',
    createdAt: Date.now(),
  });
  log(task.jobId, 'manager', 'Caption edited by hand. The pair needs fresh approval.');
  save();
}

export function approveJob(jobId) {
  const job = getJob(jobId);
  const st = jobStatus(job);
  if (st !== 'ready_for_review' && st !== 'needs_reapproval') return;
  const { copy, graphic } = jobTasks(job);
  job.approval = { copyVersion: copy.versions.length, graphicVersion: graphic.versions.length, at: Date.now() };
  job.approvals.push(job.approval);
  log(job.id, 'manager', `Approved caption v${job.approval.copyVersion} with graphic v${job.approval.graphicVersion}. Added to the private calendar.`);
  save();
}

export function agentState(agentId, now = Date.now()) {
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

export const agentTasks = (agentId) =>
  state.tasks.filter((t) => t.agent === agentId).sort((a, b) => b.createdAt - a.createdAt);

export function resetAll() {
  state = empty();
  save();
}


/* ---------- Live caption requests ---------- */
/** Start the server request for an AI caption task. Returns true if state changed. */
function dispatchAi(task, now) {
  const p = task.pending;
  if (p.error || inFlight.has(task.id) || now < p.startAt) return false;
  if (p.requestedAt) {
    // A request was sent before a refresh and its reply was lost with the page. Don't silently resend: ask.
    p.error = { message: 'The page was refreshed before Quill replied. Your work is saved. Retry to send the request again.', retryable: true, at: now };
    save();
    return true;
  }
  const job = getJob(task.jobId);
  const prev = currentVersion(task);
  const body = {
    kind: p.kind === 'revision' ? 'revision' : 'draft',
    brief: job.brief,
    platform: job.platform,
    currentCaption: p.kind === 'revision' ? prev?.content.text : undefined,
    currentVersion: prev?.n,
    feedback: p.kind === 'revision' ? p.feedback : undefined,
  };
  p.requestedAt = now;
  inFlight.add(task.id);
  save();
  fetch('api/quill/caption', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(async (r) => {
      let data = {};
      try { data = await r.json(); } catch { /* non-JSON error page */ }
      if (!r.ok) throw Object.assign(new Error(data.error || `Quill request failed (${r.status}).`), { retryable: data.retryable !== false });
      return data;
    })
    .then((data) => {
      const live = getTask(task.id);
      if (!live?.pending || live.pending.requestedAt !== p.requestedAt) return; // superseded
      const n = live.versions.length + 1;
      live.versions.push({
        n,
        content: { text: data.caption, opts: null },
        notes: data.notes ? [`v${n}: ${data.notes}`] : [],
        feedback: live.pending.feedback || null,
        by: AGENTS.copywriter.name,
        simulated: data.provider !== 'anthropic',
        source: data.provider,
        model: data.model,
        createdAt: Date.now(),
      });
      live.pending = null;
      log(live.jobId, 'copywriter', `Caption v${n} delivered for review (${data.provider === 'anthropic' ? 'AI-generated' : 'mock'}).`);
    })
    .catch((e) => {
      const live = getTask(task.id);
      if (!live?.pending || live.pending.requestedAt !== p.requestedAt) return;
      live.pending.error = { message: e.message || 'Quill request failed.', retryable: e.retryable !== false, at: Date.now() };
      log(live.jobId, 'copywriter', `Caption request failed: ${live.pending.error.message}`);
    })
    .finally(() => {
      inFlight.delete(task.id);
      save();
    });
  return true;
}

/** One click = at most one new request: ignored while a request for this task is in flight. */
export function retryTask(taskId) {
  const task = getTask(taskId);
  if (!task?.pending?.error || inFlight.has(taskId)) return false;
  task.pending.error = null;
  task.pending.requestedAt = null;
  task.pending.engine = copyEngine();
  task.pending.startAt = Date.now();
  task.pending.readyAt = Date.now() + REVISION_MS;
  save();
  tick();
  return true;
}

/** Abandon a failed revision request; the current caption version stays as it was. */
export function cancelFailedRevision(taskId) {
  const task = getTask(taskId);
  if (!task?.pending?.error || task.pending.kind !== 'revision' || inFlight.has(taskId)) return;
  log(task.jobId, 'copywriter', 'Failed revision request cancelled. Caption unchanged.');
  task.pending = null;
  save();
}


/* ---------- Prism Photo layout ---------- */
/** Append a Photo layout version. Throws (and leaves state untouched) if it can't be persisted. */
export function saveGraphicVersion(taskId, content, notes) {
  const task = getTask(taskId);
  if (!task || task.type !== 'graphic') throw new Error('Graphic task not found.');
  if (task.pending) throw new Error('Prism is still working on this graphic. Wait for it to finish, then save.');
  const n = task.versions.length + 1;
  const version = { n, content: { ...content, mode: 'photo' }, notes, feedback: null, by: 'You with Prism', simulated: false, source: 'photo', createdAt: Date.now() };
  task.versions.push(version);
  const prevLog = state.log.slice();
  log(task.jobId, 'designer', `Photo layout saved as graphic v${n}.`);
  try {
    saveStrict();
  } catch (e) {
    task.versions.pop();
    state.log = prevLog;
    throw e;
  }
  return version;
}

export function setBrandLogo(id, name) {
  const prev = state.brand;
  state.brand = { ...state.brand, logoId: id, logoName: name, logoSavedAt: Date.now() };
  try {
    saveStrict();
  } catch (e) {
    state.brand = prev;
    throw e;
  }
}
export const brand = () => state.brand || {};
