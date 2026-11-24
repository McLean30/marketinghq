// Supabase Edge Function "hq-scheduler": the only component that sends scheduled posts in a Supabase workspace.
// Called every minute by the Supabase Cron job "nexai-hq-demo-scheduler" (see supabase/migrations), with a credential
// that lives only in Supabase Vault. Deploy with JWT verification off: this function checks that credential itself.
import { runScheduler } from './worker.js';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only.' });
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  let key = '';
  try { key = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default ?? ''; } catch { /* fall back below */ }
  key = key || (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  if (!url || !key) return json(500, { error: 'The function has no server credentials.' });

  const secret = req.headers.get('x-hq-worker-secret') ?? '';
  const check = await fetch(`${url}/rest/v1/rpc/hq_worker_secret_ok`, { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_secret: secret }) });
  if (!check.ok || (await check.json()) !== true) return json(401, { error: 'Not authorised.' });

  let body: { trigger?: string } = {};
  try { body = await req.json(); } catch { /* empty body */ }
  const out = await runScheduler({ url, key, trigger: body.trigger === 'cron' ? 'cron' : 'manual', log: (m: string) => console.log(`[hq-scheduler] ${m}`) });
  return json(200, out);
});
