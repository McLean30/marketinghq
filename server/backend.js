// Where the shared workspace lives. Two interchangeable stores behind one async interface:
//   file      plain files under HQ_DATA_DIR (your own machine, tests) — the original behaviour
//   supabase  a Supabase project (Postgres tables + a private Storage bucket), used whenever SUPABASE_URL and
//             SUPABASE_SECRET_KEY are set. Required on Vercel, whose filesystem is read-only and whose server
//             instances share nothing in memory.
// Nothing here reads files, environment-dependent settings or the network when the module is loaded, so a demo
// deployment with no settings still boots (see CLAUDE.md, rule 3).
const fs = require('fs');
const path = require('path');
const storage = require('./storage');

const SUPABASE_URL = () => (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const SUPABASE_KEY = () => (process.env.SUPABASE_SECRET_KEY || '').trim();
const WORKSPACE = () => (process.env.HQ_WORKSPACE_ID || 'main').trim();
const BUCKET = 'hq-assets';
const useSupabase = () => !!(SUPABASE_URL() && SUPABASE_KEY());
/** On Vercel the filesystem is read-only, so the shared workspace needs Supabase. */
const onVercel = () => !!process.env.VERCEL;
const available = () => useSupabase() || !onVercel();

class StoreError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/* =====================================================================================================
   File store (single server process: the in-memory caches are the source of truth between writes)
   ===================================================================================================== */
function fileStore() {
  const wsFile = () => path.join(storage.paths().DATA_DIR, 'workspace.json');
  let ws = null;
  const W = () => {
    if (!ws) {
      ws = storage.readJson(wsFile(), { version: 1, rev: 0, jobs: {}, brand: { rev: 0, data: {} } });
      ws.jobs = ws.jobs || {};
      ws.plans = ws.plans || {};
      ws.brand = ws.brand || { rev: 0, data: {} };
    }
    return ws;
  };
  const save = () => storage.writeAtomic(wsFile(), JSON.stringify(W()));
  // Map record kinds onto the original workspace.json layout, so existing data folders keep working.
  const read = (kind, id) => {
    const w = W();
    if (kind === 'job') { const e = w.jobs[id]; return e && { id, rev: e.rev, updatedAt: e.updatedAt, updatedBy: e.updatedBy, data: e.bundle }; }
    if (kind === 'plan') { const e = w.plans[id]; return e && { id, rev: e.rev, updatedAt: e.updatedAt, updatedBy: e.updatedBy, data: e.plan }; }
    if (kind === 'profile') return w.profile ? { id: 'main', rev: w.profile.rev, data: { versions: w.profile.versions } } : null;
    if (kind === 'brand') return w.brand.rev ? { id: 'main', rev: w.brand.rev, updatedBy: w.brand.updatedBy, data: w.brand.data } : null;
    return null;
  };
  const write = (kind, id, rec) => {
    const w = W();
    if (kind === 'job') w.jobs[id] = { rev: rec.rev, updatedAt: rec.updatedAt, updatedBy: rec.updatedBy, bundle: rec.data };
    else if (kind === 'plan') w.plans[id] = { rev: rec.rev, updatedAt: rec.updatedAt, updatedBy: rec.updatedBy, plan: rec.data };
    else if (kind === 'profile') w.profile = { rev: rec.rev, versions: rec.data.versions };
    else if (kind === 'brand') w.brand = { rev: rec.rev, data: rec.data, updatedBy: rec.updatedBy };
  };

  const postsFile = () => path.join(storage.paths().DATA_DIR, 'demo-publisher.json');
  let posts = null;
  const P = () => (posts ??= storage.readJson(postsFile(), {}));

  const sessionsFile = () => path.join(storage.paths().DATA_DIR, 'sessions.json');
  let sessions = null;
  const S = () => (sessions ??= storage.readJson(sessionsFile(), {}));
  const saveSessions = () => storage.writeAtomic(sessionsFile(), JSON.stringify(S()));

  const failures = new Map();
  const aiDone = new Map(); // key -> { at, result }
  const aiRunning = new Map(); // key -> Promise

  const usageFile = () => path.join(storage.paths().DATA_DIR, 'ai-usage.json');
  const assetPath = (id) => path.join(storage.paths().ASSET_DIR, `${id}.bin`);
  const metaPath = (id) => path.join(storage.paths().ASSET_DIR, `${id}.json`);

  return {
    kind: 'file',
    async get(kind, id) { return read(kind, id) || null; },
    async list(kind) {
      const w = W();
      const src = kind === 'job' ? w.jobs : kind === 'plan' ? w.plans : {};
      return Object.keys(src).map((id) => read(kind, id));
    },
    async put(kind, id, baseRev, data, by) {
      const cur = read(kind, id);
      if ((cur ? cur.rev : 0) !== Number(baseRev)) return null;
      const rec = { rev: (cur ? cur.rev : 0) + 1, updatedAt: Date.now(), updatedBy: by, data };
      write(kind, id, rec);
      W().rev += 1;
      save();
      return { rev: rec.rev, wsRev: W().rev, updatedAt: rec.updatedAt };
    },
    async wsRev() { return W().rev; },

    async postsAll() { return { ...P() }; },
    async postsPut(entries) { if (!entries.length) return; for (const [id, rec] of entries) P()[id] = rec; storage.writeAtomic(postsFile(), JSON.stringify(P())); },

    async sessionGet(hash) { return S()[hash] || null; },
    async sessionPut(hash, rec) { S()[hash] = rec; saveSessions(); },
    async sessionDelete(hash) { if (S()[hash]) { delete S()[hash]; saveSessions(); } },
    async sessionPrune(now) { let changed = false; for (const [k, s] of Object.entries(S())) if (s.expiresAt < now) { delete S()[k]; changed = true; } if (changed) saveSessions(); },

    async failGet(ip) { return failures.get(ip) || null; },
    async failPut(ip, rec) { failures.set(ip, rec); },
    async failDelete(ip) { failures.delete(ip); },

    /** One paid call per key: returns { result, duplicate } (fn runs at most once per key while it succeeds). */
    async once(key, fn) {
      const hit = aiDone.get(key);
      if (hit) return { result: hit.result, duplicate: true };
      if (aiRunning.has(key)) return { result: await aiRunning.get(key), duplicate: true };
      const p = fn();
      aiRunning.set(key, p);
      try {
        const result = await p;
        aiDone.set(key, { at: Date.now(), result });
        for (const [k, v] of aiDone) if (Date.now() - v.at > 6 * 3600 * 1000) aiDone.delete(k);
        return { result, duplicate: false };
      } finally { aiRunning.delete(key); }
    },

    async usageAdd(entry) {
      const all = storage.readJson(usageFile(), []);
      all.push({ at: Date.now(), ...entry });
      storage.writeAtomic(usageFile(), JSON.stringify(all.slice(-5000)));
    },
    async usageList(jobId) { return storage.readJson(usageFile(), []).filter((x) => !jobId || x.jobId === jobId); },

    async assetMeta(id) { return storage.readJson(metaPath(id), null); },
    async assetSave(id, meta, buf) {
      try {
        storage.writeAtomic(assetPath(id), buf);
        storage.writeAtomic(metaPath(id), JSON.stringify(meta));
      } catch (e) {
        if (e.code === 'ENOSPC') throw new StoreError(507, 'The server’s disk is full. The file wasn’t saved.');
        throw e;
      }
    },
    async assetBuffer(id) { return fs.readFileSync(assetPath(id)); },
    assetStream(id, opts) { return fs.createReadStream(assetPath(id), opts); },
    async assetUploadUrl() { return null; }, // uploads go through the HQ server
    async assetUploaded() { return null; },
    async assetSignedUrl() { return null; },
  };
}

/* =====================================================================================================
   Supabase store (REST: PostgREST for tables, Storage API for files). The secret key goes in the apikey header
   only, as Supabase documents for sb_secret_ keys; it is never logged or sent to a browser.
   ===================================================================================================== */
function supabaseStore() {
  const ws = WORKSPACE();
  const base = SUPABASE_URL();
  async function call(pathname, { method = 'GET', body, headers = {}, raw = false } = {}) {
    let r;
    try {
      r = await fetch(`${base}${pathname}`, {
        method,
        headers: { apikey: SUPABASE_KEY(), ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
      });
    } catch (e) {
      console.warn('[supabase] request failed:', e.cause?.code || e.message);
      throw new StoreError(503, 'Can’t reach the workspace database right now. Nothing was changed; try again.');
    }
    if (r.status === 404 && method === 'GET') return null;
    if (!r.ok) {
      let detail = '';
      try { detail = (await r.json()).message || ''; } catch { /* ignore */ }
      console.warn(`[supabase] ${method} ${pathname.split('?')[0]} → ${r.status} ${String(detail).slice(0, 160)}`);
      if (r.status === 401 || r.status === 403) throw new StoreError(503, 'The workspace database refused HQ’s key. Check SUPABASE_SECRET_KEY on the server.');
      throw new StoreError(502, `The workspace database returned an error (${r.status}). Nothing was changed; try again.`);
    }
    if (raw) return r;
    const text = await r.text(); // writes with Prefer: return=minimal reply with an empty body
    return text ? JSON.parse(text) : null;
  }
  const q = encodeURIComponent;
  const rec = (row) => row && { id: row.id, rev: row.rev, updatedAt: Date.parse(row.updated_at), updatedBy: row.updated_by, data: row.data };
  const objectPath = (id) => `${q(ws)}/${q(id)}`;

  return {
    kind: 'supabase',
    async get(kind, id) {
      const rows = await call(`/rest/v1/hq_records?workspace=eq.${q(ws)}&kind=eq.${q(kind)}&id=eq.${q(id)}&select=id,rev,updated_at,updated_by,data`);
      return rec(rows?.[0]) || null;
    },
    async list(kind) {
      const rows = await call(`/rest/v1/hq_records?workspace=eq.${q(ws)}&kind=eq.${q(kind)}&select=id,rev,updated_at,updated_by,data`);
      return (rows || []).map(rec);
    },
    async put(kind, id, baseRev, data, by) {
      const rows = await call('/rest/v1/rpc/hq_put', { method: 'POST', body: { p_workspace: ws, p_kind: kind, p_id: id, p_base_rev: Number(baseRev) || 0, p_data: data, p_by: by || null } });
      const row = rows?.[0];
      return row ? { rev: row.rev, wsRev: Number(row.ws_rev), updatedAt: Date.parse(row.updated_at) } : null;
    },
    async wsRev() {
      const rows = await call(`/rest/v1/hq_meta?workspace=eq.${q(ws)}&select=rev`);
      return Number(rows?.[0]?.rev || 0);
    },

    async postsAll() {
      const rows = await call(`/rest/v1/hq_records?workspace=eq.${q(ws)}&kind=eq.post&select=id,data`);
      return Object.fromEntries((rows || []).map((r) => [r.id, r.data]));
    },
    async postsPut(entries) {
      if (!entries.length) return;
      await call('/rest/v1/hq_records?on_conflict=workspace,kind,id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: entries.map(([id, data]) => ({ workspace: ws, kind: 'post', id, rev: 1, data, updated_by: 'scheduler' })) });
    },

    async sessionGet(hash) {
      const rows = await call(`/rest/v1/hq_sessions?workspace=eq.${q(ws)}&token_hash=eq.${q(hash)}&select=created_at,expires_at,device`);
      const s = rows?.[0];
      return s ? { createdAt: Date.parse(s.created_at), expiresAt: Date.parse(s.expires_at), device: s.device } : null;
    },
    async sessionPut(hash, s) {
      await call('/rest/v1/hq_sessions', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: { workspace: ws, token_hash: hash, created_at: new Date(s.createdAt).toISOString(), expires_at: new Date(s.expiresAt).toISOString(), device: s.device || null } });
    },
    async sessionDelete(hash) { await call(`/rest/v1/hq_sessions?workspace=eq.${q(ws)}&token_hash=eq.${q(hash)}`, { method: 'DELETE' }); },
    async sessionPrune(now) { await call(`/rest/v1/hq_sessions?workspace=eq.${q(ws)}&expires_at=lt.${q(new Date(now).toISOString())}`, { method: 'DELETE' }); },

    async failGet(ip) {
      const rows = await call(`/rest/v1/hq_login_failures?workspace=eq.${q(ws)}&ip=eq.${q(ip)}&select=count,until`);
      const f = rows?.[0];
      return f ? { count: f.count, until: Date.parse(f.until) } : null;
    },
    async failPut(ip, f) {
      await call('/rest/v1/hq_login_failures?on_conflict=workspace,ip', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: { workspace: ws, ip, count: f.count, until: new Date(f.until).toISOString() } });
    },
    async failDelete(ip) { await call(`/rest/v1/hq_login_failures?workspace=eq.${q(ws)}&ip=eq.${q(ip)}`, { method: 'DELETE' }); },

    /**
     * One paid call per key, across every server instance: the first request claims the key in the database;
     * a repeat waits for and returns the first result. A failed call releases the key, so an explicit retry can run.
     */
    async once(key, fn) {
      const claim = async () => {
        const rows = await call('/rest/v1/hq_ai_requests?on_conflict=workspace,request_key', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }, body: { workspace: ws, request_key: key, state: 'running' } });
        return !!rows?.length;
      };
      const read = async () => (await call(`/rest/v1/hq_ai_requests?workspace=eq.${q(ws)}&request_key=eq.${q(key)}&select=state,result,created_at`))?.[0] || null;
      const release = () => call(`/rest/v1/hq_ai_requests?workspace=eq.${q(ws)}&request_key=eq.${q(key)}&state=eq.running`, { method: 'DELETE' }).catch(() => {});
      for (let attempt = 0; attempt < 2; attempt++) {
        if (await claim()) {
          let result;
          try { result = await fn(); } catch (e) { await release(); throw e; }
          await call(`/rest/v1/hq_ai_requests?workspace=eq.${q(ws)}&request_key=eq.${q(key)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { state: 'done', result, updated_at: new Date().toISOString() } });
          return { result, duplicate: false };
        }
        // Someone else has this key: wait for their result (up to about two and a half minutes).
        const until = Date.now() + 150000;
        for (;;) {
          const row = await read();
          if (!row) break; // the first attempt failed and released the key: try to claim it ourselves
          if (row.state === 'done') return { result: row.result, duplicate: true };
          if (Date.now() - Date.parse(row.created_at) > 10 * 60 * 1000) { await release(); break; } // a crashed attempt
          if (Date.now() > until) throw new StoreError(409, 'The same request is still running on another device. Wait a moment, then refresh.');
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      throw new StoreError(409, 'This request couldn’t be started. Try again.');
    },

    async usageAdd(e) {
      await call('/rest/v1/hq_ai_usage', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: { workspace: ws, job_id: e.jobId || null, request_key: e.requestKey || null, kind: e.kind || null, model: e.model || null, input_tokens: e.inputTokens ?? null, cached_tokens: e.cachedTokens ?? null, output_tokens: e.outputTokens ?? null, reasoning_tokens: e.reasoningTokens ?? null, image_input_tokens: e.imageInputTokens ?? null, image_output_tokens: e.imageOutputTokens ?? null, total_tokens: e.totalTokens ?? null, est_cost_usd: e.estCostUsd ?? null, price_source: e.priceSource || null } });
    },
    async usageList(jobId) {
      const rows = await call(`/rest/v1/hq_ai_usage?workspace=eq.${q(ws)}${jobId ? `&job_id=eq.${q(jobId)}` : ''}&order=id.asc&limit=5000`);
      return (rows || []).map((r) => ({ at: Date.parse(r.at), jobId: r.job_id, requestKey: r.request_key, kind: r.kind, model: r.model, inputTokens: r.input_tokens, cachedTokens: r.cached_tokens, outputTokens: r.output_tokens, reasoningTokens: r.reasoning_tokens, imageInputTokens: r.image_input_tokens, imageOutputTokens: r.image_output_tokens, totalTokens: r.total_tokens, estCostUsd: r.est_cost_usd == null ? null : Number(r.est_cost_usd), priceSource: r.price_source }));
    },

    async assetMeta(id) { return (await this.get('asset', id))?.data || null; },
    async assetSave(id, meta, buf) {
      await call(`/storage/v1/object/${BUCKET}/${objectPath(id)}`, { method: 'POST', raw: true, body: buf, headers: { 'Content-Type': meta.type, 'x-upsert': 'true', 'cache-control': 'private, max-age=0' } });
      await this.assetRecord(id, meta);
    },
    async assetRecord(id, meta) {
      const cur = await this.get('asset', id);
      if (!cur) await this.put('asset', id, 0, meta, 'upload');
    },
    async assetBuffer(id) {
      const r = await call(`/storage/v1/object/authenticated/${BUCKET}/${objectPath(id)}`, { raw: true });
      return r ? Buffer.from(await r.arrayBuffer()) : null;
    },
    assetStream: null,
    /** A signed URL the browser uploads to directly (Vercel limits request bodies to 4.5 MB). Valid 2 hours. */
    async assetUploadUrl(id) {
      const out = await call(`/storage/v1/object/upload/sign/${BUCKET}/${objectPath(id)}`, { method: 'POST', body: {}, headers: { 'x-upsert': 'true' } });
      return `${base}/storage/v1${out.url}`;
    },
    /** The uploaded object's size and type, or null if it isn't there. */
    async assetUploaded(id) {
      const info = await call(`/storage/v1/object/info/${BUCKET}/${objectPath(id)}`);
      return info ? { size: Number(info.size ?? info.metadata?.size), type: info.content_type || info.metadata?.mimetype || '' } : null;
    },
    /** The hosted scheduler: is this workspace enabled, and how did the worker's latest run go? */
    async schedulerStatus() {
      const [en, runs] = await Promise.all([
        call(`/rest/v1/hq_scheduler_workspaces?workspace=eq.${q(ws)}&select=enabled`).catch(() => null),
        call('/rest/v1/hq_worker_runs?select=started_at,finished_at,trigger,claimed,published,held,checked,ok,errors&order=started_at.desc&limit=1').catch(() => null),
      ]);
      const r = runs?.[0];
      return {
        installed: Array.isArray(en) && Array.isArray(runs),
        enabled: !!en?.[0]?.enabled,
        lastRun: r ? { startedAt: Date.parse(r.started_at), finishedAt: r.finished_at ? Date.parse(r.finished_at) : null, trigger: r.trigger, claimed: r.claimed, published: r.published, held: r.held, checked: r.checked, ok: r.ok, errors: (r.errors || []).length } : null,
      };
    },
    /** A short-lived link for viewing (images, video with byte ranges). */
    async assetSignedUrl(id, seconds = 3600) {
      const out = await call(`/storage/v1/object/sign/${BUCKET}/${objectPath(id)}`, { method: 'POST', body: { expiresIn: seconds } });
      return `${base}/storage/v1${out.signedURL}`;
    },
  };
}

let current = null;
/** The configured store (chosen on first use, so nothing happens at import time). */
function store() {
  if (!current) current = useSupabase() ? supabaseStore() : fileStore();
  return current;
}

module.exports = { store, useSupabase, available, onVercel, StoreError, WORKSPACE };
