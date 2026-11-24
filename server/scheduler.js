// Shared workspace only: the HQ server's demo scheduler and simulated publisher.
// While this server process runs, it checks the workspace every HQ_SCHEDULER_MS (default 15 s) and sends due demo
// posts to the simulated publisher, with or without any device open. Nothing reaches a real platform.
// The publishing rules are the same module the browser uses (app/js/publishing.js), loaded on first use so a demo
// deployment with no shared workspace never touches it or the data folder.
const path = require('path');
const { pathToFileURL } = require('url');
const storage = require('./storage');
const wsStore = require('./workspace');

let lib = null;
const load = async () => (lib ??= await import(pathToFileURL(path.join(storage.APP_DIR, 'app', 'js', 'publishing.js')).href));

/* ---------- Clock (HQ_TEST_CLOCK=1 lets tests move it forward) ---------- */
let offset = 0;
const now = () => Date.now() + offset;
const testClock = () => process.env.HQ_TEST_CLOCK === '1';
function advance(ms) { if (!testClock()) throw new wsStore.WsError(404, 'Not found'); offset += Number(ms) || 0; return now(); }

/* ---------- Simulated publisher storage: one record per publication id ----------
   The publisher's interface is synchronous, so each run loads the receipts from the workspace store first and
   saves new ones before the job that refers to them is saved. */
const backend = require('./backend');
function memoryStore(posts) {
  const pending = [];
  return {
    get: (id) => posts[id] || null,
    put: (id, rec) => { posts[id] = rec; pending.push([id, rec]); },
    list: () => Object.values(posts),
    flush: async () => { const batch = pending.splice(0); await backend.store().postsPut(batch); },
  };
}
let fault = null;
function setFault(mode) { if (!testClock()) throw new wsStore.WsError(404, 'Not found'); fault = mode === 'lose-next-response' ? 'lose' : null; return fault; }
const takeFault = () => { const f = fault; fault = null; return f; };

/* ---------- Running due posts ---------- */
let chain = Promise.resolve();
/** Run due publications (all jobs, or one job with force = an explicit retry). Serialised: one run at a time. */
function runDue({ jobId = null, force = false } = {}) {
  const run = chain.then(async () => {
    const PB = await load();
    const store = memoryStore(await backend.store().postsAll());
    const publisher = PB.makePublisher({ store, now, takeFault });
    const snap = await wsStore.snapshot();
    const profileData = snap.profile.versions.at(-1).data;
    const changed = [];
    for (const e of snap.jobs) {
      if (jobId && e.id !== jobId) continue;
      if (!(e.bundle.job.publications || []).length) continue;
      const bundle = JSON.parse(JSON.stringify(e.bundle));
      if (PB.runDue(bundle, { now: now(), profileData, publisher, by: 'scheduler', force })) {
        await store.flush();
        await wsStore.putJob(e.id, e.rev, bundle, 'scheduler');
        changed.push(e.id);
      }
    }
    await store.flush();
    return changed;
  });
  chain = run.catch(() => {});
  return run;
}

let timer = null;
function start() {
  // Vercel runs no long-lived process, so there's no timer there: due posts run when HQ asks (/api/publish/run).
  if (process.env.VERCEL || require('./backend').useSupabase()) return null; // the hosted worker sends posts there
  const every = process.env.HQ_SCHEDULER_MS === undefined ? 15000 : Number(process.env.HQ_SCHEDULER_MS);
  if (!every || timer) return null;
  timer = setInterval(() => { runDue().catch((e) => console.error('[scheduler] run failed:', e.message)); }, every);
  timer.unref?.();
  return every;
}

module.exports = { runDue, start, now, advance, setFault, testClock, posts: async () => Object.values(await backend.store().postsAll()) };
