-- Nexai Marketing HQ: hosted demo scheduler (Supabase Cron → Edge Function "hq-scheduler").
-- Publications stay inside each job record (hq_records, kind 'job'), exactly as HQ already stores them; the worker
-- claims due ones with the same revision-checked save HQ uses (hq_put), so overlapping runs can't both send a post.
-- Demo-publisher receipts are hq_records of kind 'post', keyed by the stable publication id.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- Which workspaces the hosted worker schedules. Opt-in, so a project can hold test workspaces it never touches.
create table public.hq_scheduler_workspaces (
  workspace text primary key,
  enabled boolean not null default true,
  added_at timestamptz not null default now()
);

-- One row per worker run, for HQ's "last run" note and troubleshooting (numbers and reasons only, no content).
create table public.hq_worker_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  trigger text,
  due integer not null default 0,
  claimed integer not null default 0,
  published integer not null default 0,
  held integer not null default 0,
  checked integer not null default 0,
  conflicts integer not null default 0,
  errors jsonb not null default '[]'::jsonb,
  ok boolean
);
create index hq_worker_runs_started on public.hq_worker_runs (started_at desc);

alter table public.hq_scheduler_workspaces enable row level security;
alter table public.hq_worker_runs enable row level security;
revoke all on public.hq_scheduler_workspaces, public.hq_worker_runs from anon, authenticated;

-- Jobs with a publication that is due, or whose delivery has no recorded outcome. Bounded. p_workspaces limits the
-- search to named workspaces (tests); null means every enabled workspace (the cron job).
create function public.hq_due_jobs(p_now_ms bigint, p_limit integer, p_workspaces text[] default null)
returns table (workspace text, id text, rev integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.workspace, r.id, r.rev
  from public.hq_records as r
  where r.kind = 'job'
    and (
      (p_workspaces is null and exists (select 1 from public.hq_scheduler_workspaces w where w.workspace = r.workspace and w.enabled))
      or (p_workspaces is not null and r.workspace = any (p_workspaces))
    )
    and exists (
      select 1 from jsonb_array_elements(coalesce(r.data -> 'job' -> 'publications', '[]'::jsonb)) as p
      where (p ->> 'status' = 'scheduled' and (p ->> 'scheduledFor')::bigint <= p_now_ms)
         or p ->> 'status' = 'publishing'
    )
  order by r.updated_at
  limit greatest(1, least(p_limit, 100));
$$;
revoke all on function public.hq_due_jobs(bigint, integer, text[]) from public, anon, authenticated;
grant execute on function public.hq_due_jobs(bigint, integer, text[]) to service_role;

-- The worker's credential lives only in Vault: the cron job reads it to call the worker, and the worker asks the
-- database whether a caller's value matches. Nobody needs to see or copy it.
create function public.hq_worker_secret_ok(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(length(p_secret) >= 32, false) and exists (
    select 1 from vault.decrypted_secrets
    where name = 'hq_worker_secret'
      and extensions.digest(decrypted_secret, 'sha256') = extensions.digest(p_secret, 'sha256')
  );
$$;
revoke all on function public.hq_worker_secret_ok(text) from public, anon, authenticated;
grant execute on function public.hq_worker_secret_ok(text) to service_role;

-- Setup, safe to run again: creates the worker credential once, records the project URL, and (re)registers the one
-- cron job by its fixed name, so running it twice still leaves exactly one job.
create function public.hq_scheduler_setup(p_project_url text)
returns table (job_name text, jobs_with_name bigint, schedule text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  url_id uuid;
begin
  if p_project_url !~ '^https://[a-z0-9]+\.supabase\.co$' then
    raise exception 'Project URL must look like https://<ref>.supabase.co';
  end if;
  if not exists (select 1 from vault.secrets where name = 'hq_worker_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'hq_worker_secret', 'Nexai HQ: credential the cron job sends to the hq-scheduler Edge Function');
  end if;
  select id into url_id from vault.secrets where name = 'hq_project_url';
  if url_id is null then
    perform vault.create_secret(p_project_url, 'hq_project_url', 'Nexai HQ: this project''s URL, for the scheduler cron job');
  else
    perform vault.update_secret(url_id, p_project_url);
  end if;
  perform cron.schedule(
    'nexai-hq-demo-scheduler',
    '* * * * *',
    $cmd$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'hq_project_url') || '/functions/v1/hq-scheduler',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-hq-worker-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'hq_worker_secret')
      ),
      body := jsonb_build_object('trigger', 'cron'),
      timeout_milliseconds := 55000
    );
    $cmd$
  );
  return query select j.jobname::text, count(*) over (), j.schedule::text from cron.job j where j.jobname = 'nexai-hq-demo-scheduler';
end;
$$;
revoke all on function public.hq_scheduler_setup(text) from public, anon, authenticated;
