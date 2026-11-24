// Nexai HQ hosted demo scheduler: one run checks for due posts and sends a bounded batch through the demo publisher.
// Runs in the Supabase Edge Function (index.ts, called every minute by Supabase Cron) and in Node tests. Uses only
// fetch and the shared publishing rules (shared/*.js are exact copies of public/js, kept in sync by
// `npm run worker:sync` and checked by the tests), so the browser, the HQ server and this worker apply one set of rules.
import * as PB from './shared/publishing.js';

/** A small REST client for this project's PostgREST endpoint, using the server-only secret key. */
function db(url, key) {
  async function call(path, { method = 'GET', body, prefer } = {}) {
    const r = await fetch(`${url}${path}`, {
      method,
      headers: { apikey: key, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`${method} ${path.split('?')[0]} → ${r.status} ${text.slice(0, 160)}`);
    return text ? JSON.parse(text) : null;
  }
  const q = encodeURIComponent;
  return {
    rpc: (fn, args) => call(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args }),
    get: async (ws, kind, id) => (await call(`/rest/v1/hq_records?workspace=eq.${q(ws)}&kind=eq.${q(kind)}&id=eq.${q(id)}&select=id,rev,data`))?.[0] || null,
    put: async (ws, kind, id, baseRev, data, by) => (await call('/rest/v1/rpc/hq_put', { method: 'POST', body: { p_workspace: ws, p_kind: kind, p_id: id, p_base_rev: baseRev, p_data: data, p_by: by } }))?.[0] || null,
    /** Insert only if absent; returns the stored row (whoever wrote it first). */
    insertOnce: async (ws, kind, id, data, by) => {
      const rows = await call('/rest/v1/hq_records?on_conflict=workspace,kind,id', { method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation', body: { workspace: ws, kind, id, rev: 1, data, updated_by: by } });
      return rows?.length ? { created: true, data: rows[0].data } : { created: false, data: (await call(`/rest/v1/hq_records?workspace=eq.${q(ws)}&kind=eq.${q(kind)}&id=eq.${q(id)}&select=data`))?.[0]?.data };
    },
    insert: (table, row) => call(`/rest/v1/${table}`, { method: 'POST', prefer: 'return=representation', body: row }),
    patch: (table, filter, row) => call(`/rest/v1/${table}?${filter}`, { method: 'PATCH', prefer: 'return=minimal', body: row }),
    remove: (table, filter) => call(`/rest/v1/${table}?${filter}`, { method: 'DELETE' }),
    objectInfo: async (path) => {
      const r = await fetch(`${url}/storage/v1/object/info/hq-assets/${path}`, { headers: { apikey: key } });
      return r.ok ? r.json() : null;
    },
  };
}

/**
 * Publishers. The demo publisher keeps one record per publication id (hq_records kind 'post'), so a repeat send
 * returns the original receipt, and it can be asked whether it received a post. A future live platform that can't
 * be asked is modelled by `canCheck: false`: an unknown outcome then needs the owner, never an automatic resend.
 */
function demoPublisher(D, ws, { faults = [] } = {}) {
  return {
    canCheck: true,
    async send(id, payload, at) {
      if (faults.includes('refuse')) return { refused: 'test refusal' };
      const stored = await D.insertOnce(ws, 'post', id, PB.demoRecord(id, payload, at), 'demo-publisher');
      if (faults.includes('lose')) return { lost: true }; // accepted, but the answer is "lost" (test hook)
      try { return stored.created ? { receipt: stored.data.receipt, duplicate: false } : PB.demoAnswer(stored.data, payload); } catch (e) { return { refused: e.message }; }
    },
    async check(id, payload) {
      const rec = await D.get(ws, 'post', id);
      if (!rec) return { notFound: true };
      try { return PB.demoAnswer(rec.data, payload); } catch (e) { return { refused: e.message }; }
    },
  };
}
const uncheckablePublisher = (inner) => ({
  ...inner,
  canCheck: false,
  async send(id, payload, at) { const o = await inner.send(id, payload, at); return o.lost ? { uncertain: 'the request timed out, and this platform can’t be asked whether it arrived.' } : o; },
});

/** The approved media must still be in the workspace's private storage before anything is sent. */
async function mediaProblem(D, ws, media) {
  if (!media) return null;
  const meta = await D.get(ws, 'asset', media.assetId);
  if (!meta) return `the approved media file (${media.assetId}) isn’t in the workspace storage any more`;
  const info = await D.objectInfo(`${encodeURIComponent(ws)}/${encodeURIComponent(media.assetId)}`);
  if (!info) return `the approved media file (${media.assetId}) is missing from storage`;
  const size = Number(info.size ?? info.metadata?.size);
  if (media.size && size !== media.size) return `the stored media file (${media.assetId}) isn’t the one that was approved (size ${size}, expected ${media.size})`;
  return null;
}

const clone = (x) => JSON.parse(JSON.stringify(x));
const randomId = () => `claim_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/**
 * One scheduler run. Options: url, key (server-only), workspaces (tests: limit to these; default every enabled
 * workspace), now(), trigger, budgetMs, limit, faults (test hooks), uncheckable (model a live platform).
 */
export async function runScheduler({ url, key, workspaces = null, now = () => Date.now(), trigger = 'manual', budgetMs = 40000, limit = PB.BATCH, faults = [], uncheckable = false, log = () => {} }) {
  const D = db(url, key);
  const started = Date.now();
  const stats = { due: 0, claimed: 0, published: 0, held: 0, checked: 0, conflicts: 0, errors: [] };
  const run = (await D.insert('hq_worker_runs', { trigger }))?.[0];
  const profiles = new Map();
  const profileOf = async (ws) => {
    if (!profiles.has(ws)) profiles.set(ws, (await D.get(ws, 'profile', 'main'))?.data?.versions?.at(-1)?.data || null);
    return profiles.get(ws);
  };
  try {
    const due = await D.rpc('hq_due_jobs', { p_now_ms: now(), p_limit: 25, p_workspaces: workspaces });
    stats.due = due.length;
    for (const row of due) {
      if (stats.claimed + stats.checked >= limit || Date.now() - started > budgetMs) break;
      try { await runJob(D, row, { now, limit: limit - stats.claimed - stats.checked, stats, profileOf, faults, uncheckable, log }); } catch (e) { stats.errors.push({ job: row.id, error: String(e.message || e).slice(0, 300) }); }
    }
  } catch (e) {
    stats.errors.push({ error: String(e.message || e).slice(0, 300) });
  }
  if (run) {
    await D.patch('hq_worker_runs', `id=eq.${run.id}`, { finished_at: new Date().toISOString(), due: stats.due, claimed: stats.claimed, published: stats.published, held: stats.held, checked: stats.checked, conflicts: stats.conflicts, errors: stats.errors, ok: !stats.errors.length }).catch(() => {});
    await D.remove('hq_worker_runs', `started_at=lt.${new Date(Date.now() - 7 * 864e5).toISOString()}`).catch(() => {}); // keep a week
  }
  return { ok: !stats.errors.length, ...stats, ms: Date.now() - started };
}

async function runJob(D, row, { now, limit, stats, profileOf, faults, uncheckable, log }) {
  const ws = row.workspace;
  const rec = await D.get(ws, 'job', row.id);
  if (!rec) return;
  const bundle = clone(rec.data);
  const claimId = randomId();
  const t = now();
  // 1. Claim on a fresh copy: approval, cancellation, versions, the 15-minute rule and offers are all rechecked here.
  const before = new Set(PB.publications(bundle.job).filter((p) => p.status === 'held').map((p) => p.id));
  const { changed, claimed, checks } = PB.claimDue(bundle, { now: t, profileData: await profileOf(ws), by: 'scheduler', claimId, limit });
  if (!changed) return;
  const saved = await D.put(ws, 'job', row.id, rec.rev, bundle, 'scheduler');
  if (!saved) { stats.conflicts += 1; return; } // another run or a device saved first: this run sends nothing for this job
  stats.held += PB.publications(bundle.job).filter((p) => p.status === 'held' && !before.has(p.id)).length;
  stats.claimed += claimed.length;
  stats.checked += checks.length;
  if (!claimed.length && !checks.length) return;
  // 2. Deliver (or ask the publisher about an earlier attempt), keyed by the stable publication id.
  let publisher = demoPublisher(D, ws, { faults });
  if (uncheckable) publisher = uncheckablePublisher(publisher);
  const outcomes = [];
  for (const p of claimed) {
    const payload = PB.payloadFor(bundle, p);
    const problem = await mediaProblem(D, ws, p.media);
    outcomes.push([p.id, problem ? { blocked: problem } : await publisher.send(p.id, payload, now())]);
  }
  for (const p of checks) {
    outcomes.push([p.id, publisher.canCheck ? await publisher.check(p.id, PB.payloadFor(bundle, p)) : { uncertain: `attempt ${p.attempts || 1} has no recorded outcome, and this platform can’t be asked whether it arrived.` }]);
  }
  // 3. Record the outcomes on the latest copy (a device may have saved in between); retry on a revision conflict.
  for (let i = 0; i < 6; i++) {
    const cur = await D.get(ws, 'job', row.id);
    const b2 = clone(cur.data);
    let any = false;
    for (const [pid, outcome] of outcomes) any = PB.applyOutcome(b2, pid, claimId, outcome, { now: now(), by: 'scheduler' }) || any;
    if (!any) return;
    if (await D.put(ws, 'job', row.id, cur.rev, b2, 'scheduler')) {
      stats.published += outcomes.filter(([, o]) => o.receipt).length;
      stats.held += outcomes.filter(([, o]) => o.refused || o.blocked).length;
      log(`job ${row.id}: ${outcomes.map(([pid, o]) => `${pid} ${o.receipt ? 'published' : Object.keys(o)[0]}`).join(', ')}`);
      return;
    }
    stats.conflicts += 1;
  }
  throw new Error('couldn’t record the delivery outcome after several attempts; the next run will check with the publisher');
}
