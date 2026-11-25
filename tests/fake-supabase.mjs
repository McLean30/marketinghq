// A small in-memory stand-in for the parts of Supabase HQ uses (PostgREST tables and RPCs, Storage), for local tests
// of the Supabase backend and the hosted scheduler worker. It implements the same atomic save (hq_put) and the same
// due-job query as the migrations. Not a general PostgREST: just the filters and headers HQ sends.
import http from 'http';
import crypto from 'crypto';

/**
 * What Postgres jsonb does to a stored object: keys come back sorted (shorter keys first, then byte order), not in
 * the order they were sent. Real Supabase does this, so the fake does too (it is what broke saves on phones, M14).
 */
export function jsonb(x) {
  if (Array.isArray(x)) return x.map(jsonb);
  if (!x || typeof x !== 'object') return x;
  const keys = Object.keys(x).sort((a, b) => Buffer.byteLength(a) - Buffer.byteLength(b) || Buffer.compare(Buffer.from(a), Buffer.from(b)));
  return Object.fromEntries(keys.filter((k) => x[k] !== undefined).map((k) => [k, jsonb(x[k])]));
}

export function startFakeSupabase(port, { secretKey = 'test-secret-key', workerSecret = 'w'.repeat(64) } = {}) {
  const T = { hq_meta: [], hq_records: [], hq_sessions: [], hq_login_failures: [], hq_ai_requests: [], hq_ai_usage: [], hq_scheduler_workspaces: [], hq_worker_runs: [] };
  const KEYS = { hq_meta: ['workspace'], hq_records: ['workspace', 'kind', 'id'], hq_sessions: ['workspace', 'token_hash'], hq_login_failures: ['workspace', 'ip'], hq_ai_requests: ['workspace', 'request_key'], hq_scheduler_workspaces: ['workspace'] };
  const objects = new Map(); // path -> { buf, type }
  let ids = 0;
  const stats = { requests: 0 };
  let down = false; // simulate an outage: every request fails as if Supabase were unreachable

  const now = () => new Date().toISOString();
  const cmp = (v, op, x) => {
    if (op === 'eq') return String(v) === x;
    if (op === 'lt') return (Date.parse(v) || Number(v)) < (Date.parse(x) || Number(x));
    if (op === 'gt') return (Date.parse(v) || Number(v)) > (Date.parse(x) || Number(x));
    return true;
  };
  function filterRows(rows, params) {
    let out = rows.filter((r) => [...params].every(([k, v]) => {
      if (['select', 'order', 'limit', 'on_conflict'].includes(k)) return true;
      const m = /^(eq|lt|gt)\.(.*)$/s.exec(v);
      return m ? cmp(r[k], m[1], m[2]) : true;
    }));
    const order = params.get('order');
    if (order) { const [col, dir] = order.split('.'); out = [...out].sort((a, b) => (a[col] > b[col] ? 1 : -1) * (dir === 'desc' ? -1 : 1)); }
    if (params.get('limit')) out = out.slice(0, Number(params.get('limit')));
    return out;
  }
  const keyOf = (table, row) => KEYS[table]?.map((k) => row[k]).join('|');

  function rpc(name, a) {
    if (name === 'hq_put') {
      let newRev = null;
      const i = T.hq_records.findIndex((r) => r.workspace === a.p_workspace && r.kind === a.p_kind && r.id === a.p_id);
      if (a.p_base_rev === 0) {
        if (i < 0) { T.hq_records.push({ workspace: a.p_workspace, kind: a.p_kind, id: a.p_id, rev: 1, data: jsonb(a.p_data), updated_by: a.p_by, updated_at: now() }); newRev = 1; }
      } else if (i >= 0 && T.hq_records[i].rev === a.p_base_rev) {
        Object.assign(T.hq_records[i], { rev: a.p_base_rev + 1, data: jsonb(a.p_data), updated_by: a.p_by, updated_at: now() });
        newRev = a.p_base_rev + 1;
      }
      if (newRev == null) return [];
      let m = T.hq_meta.find((x) => x.workspace === a.p_workspace);
      if (!m) T.hq_meta.push((m = { workspace: a.p_workspace, rev: 0 }));
      m.rev += 1;
      return [{ rev: newRev, ws_rev: m.rev, updated_at: now() }];
    }
    if (name === 'hq_due_jobs') {
      const enabled = new Set(T.hq_scheduler_workspaces.filter((w) => w.enabled !== false).map((w) => w.workspace));
      return T.hq_records.filter((r) => r.kind === 'job' && (a.p_workspaces ? a.p_workspaces.includes(r.workspace) : enabled.has(r.workspace))
        && (r.data.job.publications || []).some((p) => (p.status === 'scheduled' && p.scheduledFor <= a.p_now_ms) || p.status === 'publishing'))
        .sort((x, y) => (x.updated_at > y.updated_at ? 1 : -1)).slice(0, Math.max(1, Math.min(a.p_limit, 100))).map((r) => ({ workspace: r.workspace, id: r.id, rev: r.rev }));
    }
    if (name === 'hq_worker_secret_ok') return a.p_secret === workerSecret;
    throw Object.assign(new Error(`unknown rpc ${name}`), { status: 404 });
  }

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      stats.requests += 1;
      const body = Buffer.concat(chunks);
      const u = new URL(req.url, 'http://x');
      const send = (status, obj, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*', ...headers }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
      // Signed storage URLs work without the key (as on Supabase); everything else needs it.
      const signed = u.searchParams.has('token');
      if (down) { res.writeHead(503, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ message: 'Service unavailable (simulated outage)' })); }
      if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,PUT,POST', 'access-control-allow-headers': '*' }); return res.end(); }
      if (!signed && req.headers.apikey !== secretKey) return send(401, { message: 'Invalid API key' });
      try {
        let m = /^\/rest\/v1\/rpc\/(\w+)$/.exec(u.pathname);
        if (m) return send(200, rpc(m[1], JSON.parse(body.toString() || '{}')));
        m = /^\/rest\/v1\/(\w+)$/.exec(u.pathname);
        if (m) {
          const table = m[1];
          if (!T[table]) return send(404, { message: 'no table' });
          const prefer = req.headers.prefer || '';
          if (req.method === 'GET') return send(200, filterRows(T[table], u.searchParams));
          if (req.method === 'DELETE') { const gone = new Set(filterRows(T[table], u.searchParams)); T[table] = T[table].filter((r) => !gone.has(r)); return send(204); }
          if (req.method === 'PATCH') { const patch = JSON.parse(body.toString()); for (const r of filterRows(T[table], u.searchParams)) Object.assign(r, patch); return send(204); }
          if (req.method === 'POST') {
            const rows = [].concat(JSON.parse(body.toString()));
            const created = [];
            for (const row of rows) {
              const r = { ...row };
              if (r.data && typeof r.data === 'object') r.data = jsonb(r.data);
              if (table === 'hq_ai_usage' || table === 'hq_worker_runs') { r.id = ++ids; r.started_at ||= now(); r.at ||= now(); }
              if (table === 'hq_ai_requests') { r.created_at ||= now(); r.updated_at ||= now(); }
              if (table === 'hq_records') r.updated_at ||= now();
              const k = keyOf(table, r);
              const i = k ? T[table].findIndex((x) => keyOf(table, x) === k) : -1;
              if (i >= 0) {
                if (/merge-duplicates/.test(prefer)) { Object.assign(T[table][i], r); created.push(T[table][i]); continue; }
                if (/ignore-duplicates/.test(prefer)) continue;
                return send(409, { message: 'duplicate key' });
              }
              T[table].push(r);
              created.push(r);
            }
            return /return=representation/.test(prefer) ? send(201, created) : send(201);
          }
        }
        m = /^\/storage\/v1\/object\/(upload\/sign|sign|info|authenticated)?\/?hq-assets\/(.+)$/.exec(u.pathname);
        if (m) {
          const kind = m[1] || '';
          const p = decodeURIComponent(m[2]);
          if (kind === 'upload/sign' && req.method === 'POST') return send(200, { url: `/object/upload/sign/hq-assets/${m[2]}?token=up-${crypto.randomBytes(6).toString('hex')}` });
          if (kind === 'upload/sign' && req.method === 'PUT') { objects.set(p, { buf: body, type: req.headers['content-type'] || 'application/octet-stream' }); return send(200, { Key: `hq-assets/${p}` }); }
          if (kind === 'sign' && req.method === 'POST') return send(200, { signedURL: `/object/sign/hq-assets/${m[2]}?token=dl-${crypto.randomBytes(6).toString('hex')}` });
          const o = objects.get(p);
          if (kind === 'info') return o ? send(200, { name: p, size: o.buf.length, content_type: o.type }) : send(404, { message: 'not found' });
          if ((kind === 'sign' || kind === 'authenticated') && req.method === 'GET') {
            if (!o) return send(404, { message: 'not found' });
            res.writeHead(200, { 'content-type': o.type, 'content-length': o.buf.length, 'access-control-allow-origin': '*' });
            return res.end(o.buf);
          }
          if (!kind && req.method === 'POST') { objects.set(p, { buf: body, type: req.headers['content-type'] || 'application/octet-stream' }); return send(200, { Key: `hq-assets/${p}` }); }
          if (!kind && req.method === 'DELETE') { if (!objects.has(p)) return send(404, { message: 'not found' }); objects.delete(p); return send(200, [{ name: p }]); }
        }
        return send(404, { message: `not handled: ${req.method} ${u.pathname}` });
      } catch (e) {
        return send(e.status || 500, { message: e.message });
      }
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${port}`, secretKey, workerSecret, tables: T, objects, stats,
    setDown: (v) => { down = !!v; },
    close: () => new Promise((r) => server.close(r)),
  })));
}
