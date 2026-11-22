// Shared workspace only: the HQ server's demo scheduler and simulated publisher.
// While this server process runs, it checks the workspace every HQ_SCHEDULER_MS (default 15 s) and sends due demo
// posts to the simulated publisher, with or without any device open. Nothing reaches a real platform.
// The publishing rules are the same module the browser uses (public/js/publishing.js), loaded on first use so a demo
// deployment with no shared workspace never touches it or the data folder.
const path = require('path');
const { pathToFileURL } = require('url');
const storage = require('./storage');
const wsStore = require('./workspace');

let lib = null;
const load = async () => (lib ??= await import(pathToFileURL(path.join(storage.APP_DIR, 'public', 'js', 'publishing.js')).href));

/* ---------- Clock (HQ_TEST_CLOCK=1 lets tests move it forward) ---------- */
let offset = 0;
const now = () => Date.now() + offset;
const testClock = () => process.env.HQ_TEST_CLOCK === '1';
function advance(ms) { if (!testClock()) throw new wsStore.WsError(404, 'Not found'); offset += Number(ms) || 0; return now(); }

/* ---------- Simulated publisher storage: one record per publication id ---------- */
const file = () => path.join(storage.paths().DATA_DIR, 'demo-publisher.json');
let posts = null;
const store = {
  get: (id) => (posts ??= storage.readJson(file(), {}))[id] || null,
  put: (id, rec) => { (posts ??= storage.readJson(file(), {}))[id] = rec; storage.writeAtomic(file(), JSON.stringify(posts)); },
  list: () => Object.values((posts ??= storage.readJson(file(), {}))),
};
let fault = null;
function setFault(mode) { if (!testClock()) throw new wsStore.WsError(404, 'Not found'); fault = mode === 'lose-next-response' ? 'lose' : null; return fault; }
const takeFault = () => { const f = fault; fault = null; return f; };

/* ---------- Running due posts ---------- */
let chain = Promise.resolve();
/** Run due publications (all jobs, or one job with force = an explicit retry). Serialised: one run at a time. */
function runDue({ jobId = null, force = false } = {}) {
  const run = chain.then(async () => {
    const PB = await load();
    const publisher = PB.makePublisher({ store, now, takeFault });
    const snap = wsStore.snapshot();
    const profileData = snap.profile.versions.at(-1).data;
    const changed = [];
    for (const e of snap.jobs) {
      if (jobId && e.id !== jobId) continue;
      if (!(e.bundle.job.publications || []).length) continue;
      const bundle = JSON.parse(JSON.stringify(e.bundle));
      if (PB.runDue(bundle, { now: now(), profileData, publisher, by: 'scheduler', force })) {
        wsStore.putJob(e.id, e.rev, bundle, 'scheduler');
        changed.push(e.id);
      }
    }
    return changed;
  });
  chain = run.catch(() => {});
  return run;
}

let timer = null;
function start() {
  const every = process.env.HQ_SCHEDULER_MS === undefined ? 15000 : Number(process.env.HQ_SCHEDULER_MS);
  if (!every || timer) return null;
  timer = setInterval(() => { runDue().catch((e) => console.error('[scheduler] run failed:', e.message)); }, every);
  timer.unref?.();
  return every;
}

module.exports = { runDue, start, now, advance, setFault, testClock, posts: () => store.list() };
