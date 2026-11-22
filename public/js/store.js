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

const empty = () => ({ jobs: [], tasks: [], log: [] });
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
};

/** Resolve any agent work whose time has come. Returns true if state changed. */
export function tick(now = Date.now()) {
  let changed = false;
  for (const task of state.tasks) {
    if (!task.pending || now < task.pending.readyAt) continue;
    const job = getJob(task.jobId);
    const prev = currentVersion(task);
    const n = task.versions.length + 1;
    let output;
    if (task.type === 'copy') {
      output = task.pending.kind === 'initial' ? draftCaption(job) : reviseCaption(job, prev.content, task.pending.feedback, n);
    } else {
      output = task.pending.kind === 'initial' ? draftGraphic(job) : reviseGraphic(job, prev.content, task.pending.feedback, n);
    }
    task.versions.push({
      n,
      content: output.content,
      notes: output.notes,
      feedback: task.pending.feedback || null,
      by: AGENTS[task.agent].name,
      simulated: true,
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
  task.pending = { kind: 'revision', feedback: feedback.trim(), startAt: now, readyAt: now + REVISION_MS };
  log(task.jobId, task.agent, `Revision requested on the ${AGENTS[task.agent].label.toLowerCase()}: "${feedback.trim()}"`);
  save();
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
    if (state.tasks.some((t) => t.pending && now >= t.pending.startAt)) return 'working';
    return 'idle';
  }
  const mine = state.tasks.filter((t) => t.agent === agentId);
  if (mine.some((t) => t.pending && now >= t.pending.startAt)) return mine.some((t) => t.pending?.kind === 'revision') ? 'revising' : 'working';
  if (mine.some((t) => t.pending)) return 'queued';
  if (mine.some((t) => ['ready_for_review', 'needs_reapproval'].includes(jobStatus(getJob(t.jobId), now)))) return 'awaiting_review';
  return 'idle';
}

export const agentTasks = (agentId) =>
  state.tasks.filter((t) => t.agent === agentId).sort((a, b) => b.createdAt - a.createdAt);

export function resetAll() {
  state = empty();
  save();
}
