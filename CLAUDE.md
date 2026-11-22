# Nexai Marketing HQ: notes for Claude Code sessions

## Release rule (every milestone)

1. **Start from the deployment fix.** Every new milestone branch must start from a commit that includes the preview-crash fix (`1fb45b1`) and the Vercel preview smoke check (`.github/workflows/vercel-preview-smoke.yml`). Before starting, check with `git merge-base --is-ancestor 1fb45b1 HEAD` and confirm the workflow file exists.
2. **Done means the preview works.** A milestone is finished only when the **"Vercel preview smoke test"** check has passed for the branch's final commit, run against that commit's own Vercel Preview deployment. A blocked result, a Vercel sign-in page, an older deployment or a local run does not count. Report the tested commit and preview URL.
3. **Keep demo mode bootable.** With no settings, the server must start on a read-only filesystem: no file writes or required environment variables at import time. Run `npm run test:preview` before pushing.
4. **Extend the smoke test** (`tests/vercel-smoke.mjs`) whenever a milestone adds an agent or a screen people must be able to open, and keep `npm run test:smoke-selftest` passing.
5. **The newest milestone branch becomes the default branch.** When a new milestone (or update) branch is pushed, GitHub's default branch must be switched to it (Settings → General → Default branch); nothing is merged. Cloud sessions can't change this setting, so ask the owner to do it. Before reporting the milestone finished, confirm it with `gh api -X GET search/repositories -f q='repo:McLean30/marketinghq' --jq '.items[0].default_branch'`. Vercel's production branch is a separate Vercel setting and doesn't follow automatically.
6. **Don't weaken protection.** Keep Vercel preview protection on. The check authenticates with the `VERCEL_AUTOMATION_BYPASS_SECRET` repository secret. Never use paid AI calls, publishing or live platform connections in the check.

## Other conventions

- Work on the milestone's own `claude/milestone-N-…` branch; leave the default branch and production deployment alone.
- Secrets live only in the server environment or `.env` (gitignored), never in commits, logs or chat.
