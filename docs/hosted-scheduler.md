# Hosted scheduling (Supabase Cron + Edge Function)

Approve a post on one device, schedule it for a UK date and time, close HQ, and check the calendar later on another device. In a Supabase workspace the delivery happens in Supabase itself, every minute, with every browser closed and no HQ server running.

```
You (laptop)  ── Approve ──►  job record (Supabase, hq_records)       nothing is queued yet
              ── Schedule ─►  confirm: account, platform, caption + media versions, UK date/time
              ── Confirm ──►  publication added to the job (UTC instant, exact versions)
                              + the exact approved image saved to the private bucket

Supabase Cron "nexai-hq-demo-scheduler" (* * * * *)
   └─ pg_net POST /functions/v1/hq-scheduler   (header: credential read from Vault)
        └─ hq-scheduler Edge Function
             1. hq_due_jobs(): jobs with a due publication, in enabled workspaces (bounded)
             2. claim on a fresh copy: recheck approval, cancellation, versions, the 15-minute rule, expired offers;
                save with a revision check (hq_put) — overlapping runs: only one claim saves
             3. send through the demo publisher, keyed by the stable publication id
             4. record the receipt (or the hold reason) on the latest copy of the job

You (phone)   ── Calendar ─►  one entry on the right UK day: Published (demo), receipt, versions, account
```

## What's where

| Piece | Location |
| --- | --- |
| Migrations (versioned) | `supabase/migrations/20261124000000_hq_shared_workspace.sql`, `supabase/migrations/20261124130000_hq_hosted_scheduler.sql` |
| Worker | `supabase/functions/hq-scheduler/` (`index.ts` checks the credential; `worker.js` does the run; `shared/` are copies of `app/js` rules made by `npm run worker:sync`) |
| Cron job | `nexai-hq-demo-scheduler`, `* * * * *`, created by `select * from public.hq_scheduler_setup('https://<ref>.supabase.co');` |
| Worker credential | Supabase Vault secret `hq_worker_secret` (random, made inside the database; nobody sees it). The cron job reads it; the function asks the database (`hq_worker_secret_ok`) whether a caller's value matches. |
| Which workspaces it schedules | `public.hq_scheduler_workspaces` (opt-in) |
| Run log | `public.hq_worker_runs` (one row per run: due, claimed, published, held, checked, conflicts, errors; kept 7 days). HQ shows the latest run under "How the demo scheduler runs here". |

All HQ tables have row level security on with no policies and no grants to `anon` / `authenticated`: only server-side code holding the secret key can read or write. Media lives in the private `hq-assets` bucket under the workspace's folder; browsers only ever get short-lived signed links after owner sign-in.

## Rules it keeps

- Approval never schedules or publishes. Schedule and Publish now each need a separate confirmation that names the account, platform, caption and media versions and the UK date and time.
- Instants are stored in UTC (`scheduledFor`, milliseconds); every screen shows Europe/London with GMT/BST. Times that don't exist or happen twice at the clock change are refused or must be chosen explicitly.
- More than 15 minutes late (for example the project was paused): held for your decision, not sent late.
- Expired offer wording: held by Calibre's check before sending.
- Editing the approved caption or image, or requesting a revision, stops a queued post at once ("Needs attention"). It is never sent with different versions; approve and schedule again.
- Cancel and reschedule work until delivery starts. Once it has started HQ shows "Delivery started …, attempt n" and the post can't be moved.
- A lost answer: the next run asks the demo publisher by publication id and records the original receipt; nothing is sent twice. A future live platform that can't be asked is marked **Needs attention** with the attempt details and is never resent automatically.
- A run that crashed after claiming: after 3 minutes the next run checks with the publisher first.
- At most 10 posts per run; the rest go on the next minute.
- The weekly planner only creates drafts. Nothing queues a whole week.
- In Supabase mode HQ's own server and browsers never send scheduled posts: the worker is the only dispatcher.

## Setting up another project (for example the live one, when you choose to promote)

1. Apply both migrations (Supabase dashboard → SQL Editor, or `supabase db push`).
2. Deploy the function: `npm run worker:sync`, then `supabase functions deploy hq-scheduler --no-verify-jwt` (JWT verification is off because the function checks the Vault credential itself).
3. In SQL Editor: `select * from public.hq_scheduler_setup('https://<project-ref>.supabase.co');` — safe to run again; it always leaves exactly one job named `nexai-hq-demo-scheduler`.
4. Enable the workspace HQ uses (`HQ_WORKSPACE_ID`, default `main`): `insert into public.hq_scheduler_workspaces (workspace) values ('main') on conflict do nothing;`
5. Point HQ at the project with `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (server-side only), plus `HQ_OWNER_PASSWORD_HASH`.

Nothing in the browser needs a key. Public previews without these settings stay in browser-only demo mode.

## Seeing it run

- Supabase dashboard → project → **Integrations → Cron → Jobs → nexai-hq-demo-scheduler → History** (each run's status), or SQL: `select * from cron.job_run_details order by start_time desc limit 20;`
- Function logs: **Edge Functions → hq-scheduler → Logs** / **Invocations**.
- HQ's own log: `select * from public.hq_worker_runs order by started_at desc limit 20;`
- To pause it: `select cron.unschedule('nexai-hq-demo-scheduler');` (run the setup again to restore it).

## Tests

- `npm run test:scheduler`: local end to end against an in-memory Supabase stand-in with the real worker code: approve on a laptop, schedule, close the browser, stop HQ's server, two overlapping runs (published once), phone calendar; edit holds, cancel, reschedule; missed, lost answer, uncheckable platform, crashed run, missing media, batch limit, opt-in workspaces.
- `npm run test:m8`: the original publishing rules (browser demo and HQ server), now on the same claim/outcome steps.
