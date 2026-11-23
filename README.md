# Nexai AI Marketing HQ (milestone 10)

Private internal dashboard for Nexai Digital. Give Vektor (the robotic scorpion Marketing Manager) a brief; it delegates the caption to Quill (Copywriter) and the graphic to Prism (Creative Designer). Review both together, request revisions with feedback, approve the pair, and see it on the private content calendar.

Milestone 2 gives Quill real AI caption drafting and revision through the Anthropic API. By default that's Claude Sonnet 5.5 (`claude-sonnet-5-5`) at `medium` effort, and you can change both on the server. Milestone 3 adds Prism's **Photo layout**: build a branded 1080 × 1350 social graphic from your own photo, the Nexai logo and a headline, then download it as a PNG. Prism's simulated graphics are still available.

## Run it

```bash
npm install
npm start
```

Open http://127.0.0.1:4173. Needs Node 20.6+.

Without credentials, the app runs exactly as in Milestone 1: Quill uses local demo templates and every caption is labelled "Simulated demo output". The brief panel says which mode Quill is in.

### Switch on live AI captions

Quill calls the Anthropic API **from the server only**. The key never reaches the browser, is never logged, and lives in a gitignored `.env` file.

1. Create an API key in the Anthropic Console (platform.claude.com), in a workspace you're happy to bill.
2. Copy `.env.example` to `.env` and put the key after `ANTHROPIC_API_KEY=` in your own editor. Don't paste it into chat, commits or issue trackers.
3. Run `npm run start:env` (same as `node --env-file=.env server.js`).
4. The start-up log should say `Quill caption provider: Anthropic API (claude-sonnet-5-5, effort medium)`. New captions are labelled "AI-generated · Claude Sonnet 5.5".

### Model settings (server-side, in `.env`)

| Setting | Default | Notes |
|---|---|---|
| `QUILL_MODEL` | `claude-sonnet-5-5` | Any Claude model ID. `claude-opus-5-5` for harder briefs (twice the price); `claude-haiku-5-5` for lowest cost (test quality first). |
| `QUILL_EFFORT` | `medium` | `low`, `medium`, `high`, `xhigh` or `max`. Higher means more thinking, latency and cost. |
| `QUILL_PROVIDER` | automatic | `demo` forces local templates even with a key; `mock` is for tests only. |

An invalid model ID format or effort value stops the server at start-up with a clear message. An unknown but well-formed model ID is reported by the API on the first request.

Each draft or revision is a single API request using structured output, plus the SDK's automatic retries on transient errors. **There is no automatic model fallback.** Only the configured model handles a brief. If it declines a request, the caption panel says so and nothing is rerouted.

Settings were checked against the Anthropic docs (models overview, pricing, effort, thinking, structured outputs) in November 2026. Per million tokens: Sonnet 5.5 is $2 input / $10 output; Opus 5.5 is $4 / $20; Haiku 5.5 is $0.10 / $0.50 for prompts up to 100K tokens.

### Phone

`HOST=0.0.0.0 npm start`, then open `http://<your-laptop-LAN-IP>:4173` on the same Wi-Fi. This exposes it to your local network only; don't port-forward or deploy it.

## Prism Photo layout (milestone 3)

From a job, open **Photo layout** from the Graphic panel, or from Prism's workspace (tap Prism).

- **Assets**: choose a photo and the logo from your device (on a phone this opens the camera roll). Images are resized (photos to 2400 px on the long edge, the logo to 1200 px) and stored in this browser's IndexedDB. The logo is remembered and reused for the next job. Until the official logo is supplied, the preview shows a dashed "Official logo missing" box, and saving is blocked with a clear reason.
- **Controls**: graphic headline (separate from Quill's caption, up to 80 characters, auto-sized to fit 4 lines); photo crop (zoom, left/right, up/down, or drag the preview); headline position (top, middle, bottom); logo size (60 to 180%). The preview updates as you adjust.
- **Saving** creates a new graphic version labelled "Photo layout". Earlier versions and Quill's caption are untouched. An approved post whose graphic changes needs fresh approval, as before.
- **Download**: open a Photo layout version full screen and choose **Download PNG (1080 × 1350)**. The preview and the export come from the same canvas renderer, so they match pixel for pixel.
- **Storage limits**: if the browser's image or job storage is full, the save is refused with an explanation, nothing is half-saved, and the existing job and versions stay intact.

Limits: images live only in this browser, so they don't sync between devices, and clearing site data removes them. The headline font (Chakra Petch) loads from Google Fonts; offline, both preview and export fall back to the same system font. Only local rendering is used: no image-generation API and no publishing.

## Deploying a preview (for example Vercel)

**Vercel preview smoke test.** `.github/workflows/vercel-preview-smoke.yml` runs on every push, waits for that commit’s Vercel Preview deployment to finish, and reports a **"Vercel preview smoke test"** check on that exact commit. It opens the deployment's own URL in a browser, checks `GET /` and `GET /index.html` both serve HQ, that the app scripts, styles, character art and starting business profile load, and that an unknown `/api` route still returns an error rather than the homepage. It then confirms the full HQ dashboard renders (all four agent cards with artwork, New brief, Plan a content week), and opens Vektor's workspace, the Brand & Quality Reviewer and the Business profile. From Milestone 8 it also creates one post in the test browser (local templates), approves it and checks the demo publishing controls, the Europe/London schedule form and the confirmation render, then backs out without confirming. From Milestone 9 it also requires the Marketing Analyst's card and workspace. It adds the sample posts in the test browser only and checks the 2.0%/1.5% comparison and the suggested test. From Milestone 10 it also opens the Video Creator, renders a video from the labelled sample in the test browser, and checks it plays, where the browser can export. It refuses a deployment whose `/api/version` reports a different commit. It fails on a 5xx, an uncaught startup error, a blank app or a workspace that won't open. If preview protection or missing access stops it reaching HQ, the result is *Blocked* (action required), never a pass. Add Vercel's *Protection Bypass for Automation* secret as the repository secret `VERCEL_AUTOMATION_BYPASS_SECRET`; protection stays on. Vercel reports this project's deployments as a "Vercel" commit status rather than a GitHub Deployment, so the check finds the URL one of two ways. With a read-only `VERCEL_TOKEN` repository secret, it asks the Vercel API for that exact deployment (recommended). Without it, it uses the branch URL, accepted only once it serves this exact commit. Branch URLs over 63 characters can't be derived, so for long branch names such as `claude/milestone-8-publishing-scheduling` the token is needed, and without it the check reports *Blocked*. You can also run it from the Actions tab with a commit SHA. If discovery is blocked, you can pass the deployment's own unique URL (`preview_url`); it's accepted only if that deployment reports the exact commit at `/api/version`, and otherwise the result is *Blocked*. GitHub only offers that manual run once the workflow is on the default branch. Locally: `PREVIEW_URL=https://<deployment>.vercel.app EXPECT_SHA=<commit> REQUIRE_SHA_MATCH=1 VERCEL_AUTOMATION_BYPASS_SECRET=… npm run test:smoke` (needs network access to the preview). Locally: `PREVIEW_URL=… npm run test:smoke`; `npm run test:smoke-selftest` checks its pass/fail/blocked verdicts.

With no settings the server runs in **browser demo mode**: HQ opens, jobs live in the browser, and captions use local templates. It doesn't read or write its data folder at start-up, so a read-only serverless filesystem is fine. The shared workspace (owner sign-in, durable server saves) switches on only when `HQ_OWNER_PASSWORD_HASH` is set. That needs a persistent, writable `HQ_DATA_DIR`, which serverless functions don't provide, so run the shared workspace on a machine you control. `npm run test:preview` checks this boot path, including a bundled build.

**Vercel build.** Vercel's zero-config `node` preset compiles `server.js` into one server function and routes `/` and every unmatched path to it, so the function needs `public/` beside it. `vercel.json` adds it with `includeFiles: "public/**"`. Without that, `GET /` returns 404 while `GET /index.html` (served from Vercel's static copy) still works. `npm run test:vercel-build` runs the same build locally from Git-tracked files and checks the function's files and responses.

## Cue, the Video Creator (milestone 10)

The sixth agent: a gunmetal robot with a cinema camera rig over its shoulder. The artwork in `public/assets/agents/video.svg` is interim and drawn locally; swap in a rendered character when you have one. Its REC lamp blinks only while a storyboard is being drafted or a video is actually rendering. Its workspace shows the assigned job, progress, the latest output and the history.

- **Brief → video:** on HQ choose **Video post (15–30 s)**, pick the platform and add a screen recording or clip (MP4, MOV or WebM, up to 100 MB). Vektor gives the post caption to Quill and the video to Cue. Cue drafts an editable **script and storyboard** from a labelled template (*demo mode, not AI*): scenes with an on-screen caption, script notes, length and the part of the clip to use. In the **video editor** you can trim (“Start here” takes the clip's current time), change scene timing, reorder, add or remove scenes, edit the on-screen captions and set the logo position. The post caption stays separate: it's Quill's, on the post page.
- **A real video file, made in your browser:** frames are drawn on a 1080 × 1350 canvas and recorded with the browser's MediaRecorder, in real time (a 20 s video takes about 20 s; keep HQ on screen). Captions sit in their own band, so they never cover the screen action. **MP4 (H.264)** is used where the browser can record it, otherwise **WebM**, and the label and file extension say which. WebM files get their duration written in, so other players show the right length. The draft is saved before each render. If rendering fails, or the device can't export (no MediaRecorder), nothing is lost and the editor says so. Nothing is sent to a paid or remote service.
- **Review and publishing:** the review screen plays the whole video, phone included; the shared workspace streams it with byte ranges, which iPhone Safari needs. Each render is a new **video version**, and earlier versions stay playable and downloadable in the history. Approval, publication records and demo receipts name the exact **caption and video versions** (`visual: "video"`, `videoVersion`). A new video version after approval needs fresh approval, and puts any scheduled demo publication on hold. The calendar, job history and Reviewer all work for video posts. The Reviewer checks the logo, the stored files and whether the footage is the sample recording.
- **Sample footage:** no real JobTrack Pro footage has been supplied. `public/samples/sample-receipt-recording.{mp4,webm}` is an **illustrative mock-up** with a red “SAMPLE RECORDING · not the real JobTrack Pro” banner on every frame. You can add it with *Use the labelled sample recording*. A matching upload is recognised by its fingerprint (`public/samples/manifest.json`) and labelled **Sample footage, not real product** wherever it's used. The Reviewer flags any video made from it. Never present it as evidence of how the real product works. Regenerate it with `node tools/make-sample-recording.mjs`.
- **Example exports** made by `npm run test:m10`: `design/previews/m10-sample-export-v1.mp4` and `-v2.mp4` (sample footage), with frames from v1 in `m10-export-v1-frames.png`.

## Vantage, the Marketing Analyst (milestone 9)

The fifth agent: a gunmetal robot studying a chart projected from its wrist. Click its HQ card to open its workspace, which works on a phone. The artwork in `public/assets/agents/analyst.svg` is interim and drawn locally, like the Reviewer's; swap it for a rendered character when you have one. Everything is **rules-based arithmetic on figures you enter**: no AI, no live connections. Platform and Metricool connections come in Milestone 11.

- **Results belong to the exact published version.** On any published demo post, the **Results** panel shows the platform, publication date, published caption and graphic, and the version numbers. Enter running totals for **impressions**, **link clicks** and **owner-attributed enquiries**, with the date you measured them. Leave a box empty when you don't have the figure: it shows as *Not entered* (unknown), never as 0. Enter 0 only when you checked and it was zero. Each entry is a new measurement of the same post: enter 12 clicks today and 18 tomorrow, and the latest total is 18, with both kept in the history. A total lower than an earlier measurement is refused, because running totals can't go down. Recorded measurements can't be edited or removed.
- **Comparing posts** (Analyst workspace → Compare): filter by platform, publication date and *your posts* / *sample posts*. Posts are compared only on the same platform and over the same window: the measurement taken *N* days after publishing, 7 by default. *Latest figures* is available but labelled *not comparable*. Click-through = link clicks ÷ impressions, worked out only when both are known and impressions are above zero; the formula is shown beside each figure. Every observation lists the figures behind it, and each result links to its original post.
- **Weekly summary and one suggested test**: for a chosen week (posts published that week), with observations and **one rules-based suggested test for Vektor**. It explains why the test is worth running and flags when there's too little evidence (fewer than 3 comparable posts on a platform). It never declares a winner from so few posts. **Use this suggestion** opens the test as an editable brief, and **Open in Vektor's planner** prefills *Plan a content week* with it. Nothing is planned until you create the plan, and no posts are written until you confirm it.
- **Sample data** (Analyst workspace → *Add sample data*): two made-up LinkedIn posts, both measured 7 days after publishing. *Missing engineer photos* has 1,000 impressions, 20 link clicks and 2 enquiries. *Jobs waiting for invoice sign-off* has 2,000 impressions, 30 link clicks and enquiries not entered. They're marked **Sample** everywhere, kept out of HQ's job list, the calendar and Vektor's delegations, and can be hidden with *Your posts only*. The Analyst shows 2.0% against 1.5% click-through and notes that the second post had more total clicks and unknown enquiries. Its suggestion is to test both topics in the same format, without calling a winner.

## Demo publishing and scheduling (milestone 8)

Every destination is a **simulated demo account** (Nexai Digital's LinkedIn company page, Facebook page and Google Business Profile listing, all labelled *demo account, simulated*). Nothing is sent to LinkedIn, Facebook or Google. No keys, OAuth connections or Metricool actions are used; those are reserved for Milestone 11. Instagram and X have no demo account yet.

- **Approval never publishes.** Approving a post puts it on the private calendar as **Approved** and nothing more. Once approved, the post screen offers **Publish now (demo)** and **Schedule (demo)** with a preview of exactly what goes out: platform, labelled demo account, the exact caption, the full graphic and the approved version numbers. It's sized to read comfortably on a phone.
- **A separate confirmation is required.** It names the action, the destination, the versions and, for scheduling, the date and time in **Europe/London**, shown as GMT or BST. A time skipped when the clocks go forward (01:00–01:59 on the last Sunday in March) is refused. A time that happens twice when they go back (01:00–01:59 on the last Sunday in October) must be chosen explicitly: BST (first) or GMT (second). Past times are refused.
- **The calendar shows each post once**, on its scheduled day, labelled **Approved**, **Scheduled (demo)**, **Published (demo)** or **Needs attention**. Open a scheduled post to inspect what you authorised, reschedule it or cancel it.
- **A queued post never picks up a different version.** If the caption or graphic changes (or a revision is requested), the queued publication stops and says why. Approve the new version, then schedule it again. Approving alone queues nothing.
- **An expired offer is held.** Just before sending, Calibre's offer rule checks the authorised caption against the business profile for the scheduled London date. If the caption quotes an offer that isn't live, the post is **held for your decision**: publish anyway, reschedule or cancel.
- **A missed time is held.** If a scheduled post is more than 15 minutes late (nothing was running to send it), it waits for your decision instead of going out late.
- **Delivery is idempotent.** Each publication has an id that the simulated publisher uses as an idempotency key. A double tap, a refresh, a retry or a second device can't publish twice. If the publisher accepted a post but the answer was lost, **Retry** returns the original receipt. Every publication keeps its destination, authorised versions, scheduled time, outcome, receipt and a timestamped history on the post.

**Where the scheduler runs (shown on the post screen and the calendar):**

| Setup | Scheduler | Unattended? |
|---|---|---|
| Vercel preview, or any server with no settings (browser demo mode) | In your browser. Due posts are sent while HQ is open in that browser. If HQ is closed at the due time, the post waits for your decision. | **No.** HQ must be open. |
| Shared workspace on your own computer (`npm run start:env` with an owner password) | On the HQ server, every 15 s (`HQ_SCHEDULER_MS`), whether or not any device has HQ open, for as long as the server process runs. | **Yes, while the server runs.** Verified by `npm run test:m8`, which closes every browser and checks the server's timer sends the post. |

The demo publisher's records live in `data/demo-publisher.json` in the shared workspace, or in browser storage (`nexai-hq:demo-publisher`) in demo mode. Neither ever leaves the machine.

**Try one scheduled demo post:** approve a LinkedIn, Facebook or Google Business Profile post, tap **Schedule (demo)**, pick a time a few minutes ahead, tap **Continue**, check the confirmation, then **Confirm: schedule (demo)**. Keep HQ open (on the Vercel preview), or leave the server running (shared workspace). At the time, it changes to **Published (demo)** with a receipt; the calendar and the post history update.

## Business profile and Brand & Quality Reviewer (milestone 7)

**Business profile** (HQ → *Business profile*, on desktop and phone): services with descriptions, audience, proof (product names only until you add approved claims or links), the website CTA and organic-post guidance, brand rules (British English, LinkedIn hashtag rule, imagery, and the official logo, which Prism's Photo layout sets), offers (wording, start, end, active; empty at first), and fields for Nexai's **Winner's Writing Process** and **self-review checklist**, which are marked *Missing* until you paste the original wording.

- Every save is a new version with an identifier (for example `pv3-9f2c1a`), a timestamp and the device. Earlier versions are kept, and the history shows what changed. In the shared workspace only the signed-in owner can edit; signed out, it's read-only.
- Vektor's plans (template and AI), Quill's drafts and revisions (local templates, mock and the configured Anthropic provider) and Prism's visual briefs use the relevant fields. Every new caption, graphic, plan, job and review records the profile version it used. Posts from before the profile open unchanged and say so.
- Offers are quoted exactly, and only when the brief asks for an offer that's live on the post date.
- **Profile changes are targeted.** After a save, the screen lists only the posts the change actually touches (for example, a post quoting an offer whose end date changed) and says which field changed and how. An unrelated edit doesn't send other posts back to review or remove approvals.

**Calibre, the Brand & Quality Reviewer** (fourth agent; HQ card, workspace with assigned reviews and history, and a *Brand & quality review* panel on every post):
- Reviews the exact **caption version + graphic version** against the **current profile version**, records all three, and checks offers against the post date (or today, if that's later).
- **Rules the app runs itself:** offer wording that isn't live on that date; the LinkedIn hashtag rule (count and required tags); common US spellings; whether the graphic records the official logo; missing photo or logo files.
- **Needs owner review:** figures, guarantees, superlatives, measured results, and product names without approved claims.
- **Needs your judgement:** whether the image looks like a real UK commercial setting. The graphic is shown for you to inspect.
- Each finding says what was found, where (caption version and paragraph, or graphic version), why it matters and who can fix it. *Send to Quill* and *Send to Prism* open the existing revision controls with the fix pre-filled for you to edit.
- If the caption or graphic changes, the earlier review is marked outdated and kept in the history. Calibre never approves; you do.
- **Artwork:** `public/assets/agents/reviewer.svg` is interim, locally drawn artwork (a precision inspection lens). Replace it with a rendered character in the Milestone 6 style (446 × 695 portrait, lens centred near (223, 262)); see `public/js/agents.js`.

`HQ_TEST_DATE=YYYY-MM-DD` on the server fixes "today" for offer and review checks in a test workspace, and the app shows a banner while it's set.

## Robotic team redesign (milestone 6)

HQ follows the approved mockup (`design/approved-hq-mockup.png`). Vektor is the full-width centrepiece, with Quill and Prism side by side below him, then **New brief** and **Plan a content week**. On desktop all three sit in one row at equal height.

- **Artwork**: `public/assets/agents/{vektor,quill,prism}.webp` are cropped from the approved mockup, with its baked-in text removed by inpainting (`tools/make-agent-art.py`, build-time only: `pip install pillow opencv-python-headless`). Names, roles, status and chevrons are live interface text. The source is phone resolution (about 900 px wide for Vektor), which is enough for these card sizes; supply higher-resolution renders for anything larger.
- **Each card is one link** to that agent's workspace. Tab order is Vektor → Quill → Prism → New brief → Plan a content week, and each card has a visible focus ring. The workspace opens with the same artwork as a hero (a shared-element View Transition where the browser supports it), with assignments, output and history directly below.
- **Motion follows real task state**: while Vektor delegates, a pulse travels along his tail to the stinger; while Quill writes, the stylus traces a short line; while Prism works, the aperture turns and the projection comes into focus. Every effect stops when its task ends, and idle is still. With reduced motion, nothing animates; status stays readable as text, a status dot and a highlighted card border.
- On phones the header matches the mockup (logo, HQ, Calendar). The workspace status moves to a link under the HQ buttons.

## Vektor's weekly planning (milestone 5)

**Plan a content week** (HQ, or Vektor's workspace → Content weeks): choose a week beginning Monday and write one brief. Dates are UK calendar dates (Europe/London), and Nexai's schedule is fixed:

| Day | Channel |
|---|---|
| Monday, Friday | LinkedIn |
| Tuesday, Thursday | Facebook |
| Wednesday | Google Business Profile |

- **Two planning methods, both labelled on the plan.** *Create template plan*: instant and free, built from your brief with Nexai's standard week structure, no AI. *Draft with AI (1 request)*: one explicit request to the server's configured provider (`QUILL_MODEL`, default Claude Sonnet 5.5). It's only offered when AI is set up and you're signed in.
- **Editable before anything is written.** Each day shows the platform, audience, angle, practical takeaway and visual brief. Edit any of them, or untick a day to leave it out.
- **Confirming** creates one linked job per included day. Quill writes the caption using that day's angle, audience and takeaway; Prism starts the graphic, with the visual brief shown in the Graphic panel and the Photo layout studio. Each post keeps its own feedback, versions and approval. Approved posts appear on the calendar once, through the existing approval flow. Nothing is published.
- **The week view** lists what needs your attention, with links straight to each post: failed captions, posts ready to review, revised captions, posts that still need a photo, and a missing official logo.
- **Safe to repeat.** Job ids are fixed on the plan before any job is created, so a double tap, a refresh part-way through or a second device can't duplicate a post. If creation is interrupted, *Finish creating posts* completes only what's missing. A caption request interrupted by a refresh is offered for Retry, never resent automatically. One failed caption doesn't affect the others; retry just that one.

## Shared private workspace (milestone 4)

One workspace for your laptop and phone: jobs, captions, graphic versions, original photos, the reusable logo, feedback, approvals and the calendar are stored on the HQ server, not in one browser.

- **Storage**: plain files in `data/` (or `HQ_DATA_DIR`): `workspace.json`, `sessions.json` and `assets/`. Writes are atomic, so data survives restarts. Back up by copying the `data` folder while the server is stopped. `data/` is gitignored.
- **Privacy**: the owner signs in with a password. Only its scrypt hash is stored, in `.env` as `HQ_OWNER_PASSWORD_HASH`, set with `npm run set-password`. Workspace data, images, exports (rendered from those images) and AI caption requests all require sign-in; a signed-out browser gets 401 even with a direct URL. Sessions use an HttpOnly, SameSite=Strict cookie and last 30 days. Five wrong passwords lock sign-in for 15 minutes.
- **Local demo** still works: without a password set, or when not signed in, the app uses this browser's storage as before. The top-right pill shows which you're using.
- **Import**: Workspace → Preview import shows the jobs in this browser, which ones are already in the workspace, and any missing photos or logos. Import copies them; the browser originals are kept, and re-importing never duplicates a job or version.
- **Two devices**: each job has a revision number. If your phone saves a newer version while your laptop shows an older one, the laptop gets an "Updated on your phone" notice, and any save or approval from the stale screen is refused with a list of what changed. "Load the latest version" brings it up to date. In Prism your unsaved edits are kept, and the next save becomes a new version on top. Saved versions and approvals can't be overwritten or removed (enforced by the server). Leaving Prism with unsaved edits asks first.

**Security limits for this milestone**: it runs on plain HTTP. Over Wi-Fi, your password and session cookie are unencrypted on the local network. Use it only on a Wi-Fi network you trust (your own home or office network, set to Private on Windows), never on public Wi-Fi, and stop the server when you're done. Don't port-forward or deploy it; that needs HTTPS and hosting first.

## Behaviour

- **Every request uses the real job**: the brief and platform go to Quill on every draft. A revision also sends the current caption and your feedback, quoted exactly.
- **Versions**: every result is saved as a new caption version, with its source (AI, mock, demo or you) and the feedback that produced it. Earlier versions stay in History. Revising the caption never touches Prism's graphic.
- **Approval** records the exact caption and graphic versions. Any new caption version makes an approved post need fresh approval; the calendar shows "Needs re-approval".
- **Failures** keep your work. The caption panel shows what went wrong, with **Retry** (and, for a revision, an option to keep the current version and cancel). Approval is blocked until the failed request is resolved.
- **One click, one request**: double taps on Send brief, Send to Quill and Retry are ignored while a request is in flight. If you refresh while Quill is working, the reply is lost with the page; the app then offers Retry rather than silently sending a second request.

## Tests

```bash
npm run test:m2      # Milestone 2 UI suite, desktop + phone, deterministic mock provider (starts its own server on :4174)
npm run test:m3      # Milestone 3 Photo layout suite (desktop, phone-sized and iPhone 13; starts its own server on :4176)
npm run test:m4      # Milestone 4 shared workspace: desktop + iPhone-emulation browsers, server restart, signed-out access, import (own server on :4177)
npm run test:m5      # Milestone 5 weekly planning: template plan, edits, forced failure + retry, approvals, second browser, AI-path (mock) on phone (own server on :4178)
npm run test:m6      # Milestone 6 redesign: phone/desktop framing, keyboard, state-driven motion, reduced motion; saves design/previews/ (own server on :4179)
npm run test:m7      # Milestone 7: profile versions, expired-offer review on a fixed test date, phone controls (own server on :4181)
npm run test:m10     # Milestone 10: video brief → storyboard → render → download, ffprobe checks, v2, approval/publishing, phone playback, failures (servers on :4185 shared, :4186 demo)
npm run test:m9      # Milestone 9: Marketing Analyst, results entry, sample decision, filters, brief to Vektor (server on :4184)
npm run test:m8      # Milestone 8: demo publishing and scheduling with a test clock (servers on :4182 shared, :4183 demo mode)
npm run test:preview # Preview/serverless boot: no settings, read-only filesystem, source entry + esbuild bundle
npm run test:vercel-build # Vercel CLI build (node preset) from tracked files: function includes public/, boots, serves / and /index.html
npm run test:api     # Anthropic SDK path against a local stub API with a dummy key (no network, no cost)
npm start   # then, in a second terminal:
npm run test:e2e   # Milestone 1 desktop + phone suite, demo mode on :4173
```

The mock provider (`QUILL_PROVIDER=mock`, `server/quill-mock.js`) returns canned captions so tests are repeatable. Its output is labelled "Mock AI response (test mode)" and is never used unless that variable is set.

## Writing guidance

`server/quill.js` holds Quill's system prompt: British English, written for owners, MDs and operations directors of UK commercial maintenance and building services firms. It uses the brief's operational detail, stays useful rather than salesy, never invents results, and follows platform conventions (3 to 5 hashtags on LinkedIn).

**Nexai's Winner's Writing Process and self-review checklist are not in this repository.** `WRITING_PROCESS` and `SELF_REVIEW` in `server/quill.js` are clearly marked working stand-ins. Replace them with the original wording when available.

## What's simulated

- **Simulated graphics** are local demo outputs (`public/js/graphics.js`), labelled "Simulated demo output": illustrated scenes, not photography. **Photo layout** graphics use your own supplied photo and logo.
- `tests/fixtures/` holds labelled **TEST assets** (a synthetic rooftop HVAC scene and a test logo marked "not official"), generated by `npm run fixtures`. They're for tests only; don't publish them.
- **Captions** are simulated only in demo mode (no key) or mock mode (tests), and labelled as such.
- **Scorpion, agent characters and Nexai logo** are local SVG placeholders, pending official artwork.
- Data lives in this browser's `localStorage` (`nexai-hq:v1`) and doesn't sync between devices.
- Nothing is published, sent, scheduled on a live account or deployed.

## Structure

- `server.js`: static files, Quill API, sign-in, workspace and image APIs (mutating requests same-origin only).
- `server/auth.js` (owner password, sessions), `server/workspace.js` (job revisions, append-only checks, import, images), `server/storage.js` (atomic file writes).
- `scripts/set-owner-password.cjs`: hidden password prompt; writes only the hash to `.env`.
- `server/quill.js`: provider selection, prompt, Anthropic SDK call, error mapping. `server/quill-mock.js`: test fixture.
- `public/js/store.js`: jobs, linked tasks, versions, feedback, approvals, persistence, caption request dispatch and retry.
- `public/js/app.js`: views (HQ stage, agent workspace, review, Photo layout studio, calendar, full-screen graphic viewer).
- `public/js/profile.js` (profile helpers, offer dates, targeted change impact) and `public/js/review.js` (Calibre's rules).
- `public/data/profile-seed.json`: the starting business profile.
- `public/js/agents.js`: character artwork, workspace hero, thumbnails and state-driven effect layers.
- `public/js/plan.js`: Europe/London week dates, Nexai's schedule, template planner.
- `public/js/photo.js`: Photo layout renderer (shared by preview and PNG export), upload processing, IndexedDB image store.
- `public/css/app.css`: tokens, responsive layout, reduced-motion handling.
