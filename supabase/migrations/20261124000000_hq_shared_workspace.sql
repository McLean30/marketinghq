-- Nexai Marketing HQ: shared workspace storage (Milestone 11A, Supabase).
-- Only the HQ server touches these tables, with the project's secret key. Row level security is on with no
-- policies, and the anon/authenticated roles have no grants, so the publishable key and browsers can't read or
-- write anything. Every row carries a workspace id, so tests can use their own workspace and clean up.

create table public.hq_meta (
  workspace text primary key,
  rev bigint not null default 0
);

-- Jobs, plans, the business profile, brand settings, simulated-publisher receipts and asset metadata.
-- rev is the optimistic-concurrency revision: a save names the revision it started from (see hq_put).
create table public.hq_records (
  workspace text not null,
  kind text not null check (kind in ('job', 'plan', 'profile', 'brand', 'post', 'asset')),
  id text not null,
  rev integer not null,
  updated_at timestamptz not null default now(),
  updated_by text,
  data jsonb not null,
  primary key (workspace, kind, id)
);

-- Owner sign-in sessions: only SHA-256 hashes of the session tokens are stored.
create table public.hq_sessions (
  workspace text not null,
  token_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  device text,
  primary key (workspace, token_hash)
);

-- Failed sign-in attempts per address (5 per 15 minutes), shared by every server instance.
create table public.hq_login_failures (
  workspace text not null,
  ip text not null,
  count integer not null,
  until timestamptz not null,
  primary key (workspace, ip)
);

-- One paid AI call per request key: a double tap, refresh or retry gets the first result, on any server instance.
create table public.hq_ai_requests (
  workspace text not null,
  request_key text not null,
  state text not null check (state in ('running', 'done')),
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace, request_key)
);

-- Token usage and estimated cost of every paid AI call (numbers only: no prompts, outputs or keys).
create table public.hq_ai_usage (
  id bigint generated always as identity primary key,
  workspace text not null,
  at timestamptz not null default now(),
  job_id text,
  request_key text,
  kind text,
  model text,
  input_tokens integer,
  cached_tokens integer,
  output_tokens integer,
  reasoning_tokens integer,
  image_input_tokens integer,
  image_output_tokens integer,
  total_tokens integer,
  est_cost_usd numeric,
  price_source text
);
create index hq_ai_usage_job on public.hq_ai_usage (workspace, job_id);

alter table public.hq_meta enable row level security;
alter table public.hq_records enable row level security;
alter table public.hq_sessions enable row level security;
alter table public.hq_login_failures enable row level security;
alter table public.hq_ai_requests enable row level security;
alter table public.hq_ai_usage enable row level security;
revoke all on public.hq_meta, public.hq_records, public.hq_sessions, public.hq_login_failures, public.hq_ai_requests, public.hq_ai_usage from anon, authenticated;

-- Save one record only if it is still at p_base_rev (0 = create). Returns the new record and workspace revisions,
-- or no row when another device saved first (the caller answers 409 with the latest version).
create function public.hq_put(p_workspace text, p_kind text, p_id text, p_base_rev integer, p_data jsonb, p_by text)
returns table (rev integer, ws_rev bigint, updated_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_rev integer;
begin
  if p_base_rev = 0 then
    insert into public.hq_records as r (workspace, kind, id, rev, data, updated_by)
    values (p_workspace, p_kind, p_id, 1, p_data, p_by)
    on conflict do nothing
    returning r.rev into new_rev;
  else
    update public.hq_records as r
    set rev = r.rev + 1, data = p_data, updated_by = p_by, updated_at = now()
    where r.workspace = p_workspace and r.kind = p_kind and r.id = p_id and r.rev = p_base_rev
    returning r.rev into new_rev;
  end if;
  if new_rev is null then
    return;
  end if;
  insert into public.hq_meta as m (workspace, rev) values (p_workspace, 1)
  on conflict (workspace) do update set rev = m.rev + 1;
  return query select new_rev, m.rev, now() from public.hq_meta as m where m.workspace = p_workspace;
end;
$$;
revoke all on function public.hq_put(text, text, text, integer, jsonb, text) from public, anon, authenticated;
grant execute on function public.hq_put(text, text, text, integer, jsonb, text) to service_role;

-- Private bucket for photos, logos, AI images, clips and rendered videos (100 MB per file).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hq-assets', 'hq-assets', false, 104857600, array['image/jpeg', 'image/png', 'video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do nothing;
