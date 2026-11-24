# Live HQ on Vercel with Supabase

Vercel's servers have a read-only disk and share nothing in memory, so the shared workspace (jobs, versions, sign-in sessions, AI usage, the "one charge per tap" record and your images and videos) lives in Supabase there. On your own computer HQ can keep using files under `./data`, or Supabase if you set the same two variables.

## What's in the Supabase project

Migration: `supabase/migrations/20261124000000_hq_shared_workspace.sql` (already applied to the Nexai project).

| Table | Holds |
| --- | --- |
| `hq_records` | Jobs, weekly plans, the business profile, brand settings, simulated-publisher receipts, file details. Each has a revision number; `hq_put()` saves only if nobody else saved first. |
| `hq_meta` | The workspace revision devices poll for changes. |
| `hq_sessions` | Owner sign-ins (SHA-256 hashes of session tokens only). |
| `hq_login_failures` | Sign-in throttling (5 failures per address per 15 minutes). |
| `hq_ai_requests` | One paid AI call per request key, across every server instance. |
| `hq_ai_usage` | Tokens and estimated cost per paid call (numbers only). |
| Storage bucket `hq-assets` | Private: photos, logos, AI images, clips and rendered videos (100 MB per file). Browsers get short-lived signed links; large files upload straight to Supabase with a signed upload link HQ checks afterwards. |

Row level security is on with no policies and the `anon` / `authenticated` roles have no grants, so only HQ's server, with the secret key, can read or write. Supabase's security advisor lists this as "RLS enabled, no policy" (info level): that's intended.

## Vercel environment variables

Project → Settings → Environment Variables. Tick **Preview** to try it on the branch preview first; add the same to **Production** only when you decide to promote.

| Name | Value | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | `https://owjllllafgxokjwuqjlr.supabase.co` | Not secret. |
| `SUPABASE_SECRET_KEY` | Supabase → Project Settings → API Keys → **Secret key** (`sb_secret_…`) | Sensitive. Never the publishable key. |
| `HQ_OWNER_PASSWORD_HASH` | From HQ's **Workspace** page → "Make an owner password hash" (or `npm run set-password`) | The hash only, never the password. |
| `OPENAI_API_KEY` | OpenAI dashboard → API keys | Sensitive. A project spend limit is a good idea. |

Then redeploy (Deployments → … → Redeploy) so the new variables are used. With all four set, the preview shows **Sign in** on the Workspace page; after you sign in, live AI is on. Signed-out visitors still get demo mode, and the paid endpoints refuse them.

If `HQ_OWNER_PASSWORD_HASH` is set without the Supabase variables, HQ stays in demo mode on Vercel and the Workspace page says what's missing.

## Testing

`npm run test:supabase` runs two HQ servers against a real project with a throwaway workspace id and removes what it created: atomic saves across servers, shared sessions and throttling, signed file links and direct uploads, one paid call per key across servers (OpenAI stub, no cost) and the usage ledger. It needs `SUPABASE_TEST_URL` and `SUPABASE_SECRET_KEY`; without them it skips.
