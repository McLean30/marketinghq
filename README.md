# Nexai AI Marketing HQ (milestone 16: owner controls for cleanup, downloads and cancelling schedules)

Private internal dashboard for Nexai Digital. Give Vektor (the robotic scorpion Marketing Manager) a brief; it delegates the caption to Quill (Copywriter) and the graphic to Prism (Creative Designer), or a video to Cue. Review everything together, request revisions with feedback, approve the pair, and see it on the private content calendar.

Milestone 11A connects the six agents to OpenAI for content creation. Text uses `gpt-6-luna`; images use `gpt-image-2.6-flare`. Both are configurable on the server. Publishing is still simulated (Milestone 11B), and no social account is connected.

## Run it

```bash
npm install
npm start
```

Open http://127.0.0.1:4173. Needs Node 20.6+. There are no runtime dependencies.

Without settings, HQ runs in demo mode. Outputs come from local templates, are labelled "Simulated demo output" and cost nothing. The brief panel says which mode HQ is in. The hosted Vercel preview always runs in demo mode: it has no owner sign-in, so it can never spend.

### Switch on live AI (your own HQ server)

HQ calls OpenAI **from the server only**. The key never reaches the browser, logs, commits or the usage records. It lives in a gitignored `.env` file (or the server's environment).

1. Create an API key in the OpenAI dashboard (platform.openai.com → API keys), in a project you're happy to bill. A project spend limit is a good idea.
2. Set the owner password: `npm run set-password`. This writes only a hash to `.env`. **Live AI needs owner sign-in.** With a key but no owner sign-in, HQ stays in demo mode, so nobody can spend.
3. Copy `.env.example` to `.env` (if you haven't) and put the key after `OPENAI_API_KEY=` in your own editor. Don't paste it into chat, commits or issue trackers.
4. Run `npm run start:env` (same as `node --env-file=.env server.js`). The start-up log should say `Quill caption provider: OpenAI (gpt-6-luna, images gpt-image-2.6-flare)`.
5. Open HQ, sign in on **Shared workspace**, and the brief panel says "Live AI is on". Signed-out visitors keep seeing demo mode, and the paid endpoints refuse them (401).

### What runs live, and what it costs

Every paid request needs an explicit action by the signed-in owner: submitting a brief, sending a revision, or tapping a generate or review button. Nothing runs in the background.

| Agent | Live action | Model |
|---|---|---|
| Vektor | **Draft with AI**: an editable weekly plan from your brief and business profile. Nothing is delegated until you confirm it. | text |
| Quill | First caption per post, and each revision, in the saved editorial voice (conversational British English, practical detail, soft CTA where appropriate). An explicit hard-sell brief overrides the tone for that job only. | text |
| Prism | **Generate image** for the selected scene; **Edit image** of the current picture; **Upload photo** opens Photo layout. The official logo, headline and crop are added locally in Photo layout, so changing them costs nothing. | image |
| Cue | Script and storyboard. Editing and rendering your footage stay in the local video editor. If the request fails, you can retry or use the labelled template storyboard. | text |
| Calibre | Rule checks as before, plus an optional **AI wording review** (advisory). | text |
| Vantage | Calculations as before, plus an optional **written interpretation** of the actual figures. Unknown metrics are sent as "not entered", never zero, and a reply quoting a figure that isn't in your data is rejected. | text |

Each output says what it is: "Live AI · gpt-6-luna", "Live AI image · gpt-image-2.6-flare" (with "layout owner-edited" once you've changed the layout), "Owner-edited", or "Simulated". Version history, feedback, approvals and scheduling holds work as before.

**One charge per action.** Each action carries a request key saved with the job. A double tap, a second open device, a refresh or a retry after a lost reply gets the first result back instead of a second charge. A failed request isn't cached. Your brief, feedback and earlier versions are kept, the error says what went wrong (bad key, no credit, spend limit, rate limit, OpenAI down, timeout), and Retry makes one new request.

**Usage and cost.** Each job's **AI usage** panel lists every paid request: captions, revisions, images and image edits. It shows the model, the tokens OpenAI reported, and an estimated cost from OpenAI's Standard list prices (checked 23 Nov 2026; see `docs/openai-api-notes.md`). The server also keeps a numbers-only ledger in the data folder (`ai-usage.json`; owner-only at `/api/ai/usage`). Your OpenAI invoice is the final figure.

### Live on Vercel (Supabase)

The hosted preview can run live too, once it has somewhere durable to keep the workspace. HQ uses Supabase for that whenever `SUPABASE_URL` and `SUPABASE_SECRET_KEY` are set: jobs and versions, owner sign-in sessions, AI usage, the "one charge per tap" record, and your images and videos (in a private bucket). Set those two, `HQ_OWNER_PASSWORD_HASH` and `OPENAI_API_KEY` in Vercel's environment variables, redeploy, and sign in on the Workspace page. You can make the password hash on that page in your browser; the password never leaves it. Full steps and what each table holds: [docs/supabase-setup.md](docs/supabase-setup.md).

### Model settings (server-side, in `.env`)

| Setting | Default | Notes |
|---|---|---|
| `OPENAI_TEXT_MODEL` | `gpt-6-luna` | Vektor, Quill, Cue, Calibre and Vantage. Responses API with structured output. |
| `OPENAI_IMAGE_MODEL` | `gpt-image-2.6-flare` | Prism's generate and edit (Images API). |
| `OPENAI_REASONING_EFFORT` | `low` | `none`, `low`, `medium`, `high`, `xhigh` or `max`. Higher means slower and dearer. |
| `OPENAI_IMAGE_QUALITY` | `medium` | `low`, `medium`, `high` or `auto`. |
| `OPENAI_IMAGE_SIZE` | `1024x1536` | Portrait; Photo layout crops it to 1080 × 1350. |
| `OPENAI_PRICES` | built in | JSON override for the cost estimates if list prices change. |
| `AI_PROVIDER` | automatic | `demo` forces local templates even with a key; `mock` is for tests only. |

An invalid model ID format or effort value stops the server at start-up with a clear message. **There is no automatic model fallback**: only the configured models are used.

### Phone

`HOST=0.0.0.0 npm start`, then open `http://<your-laptop-LAN-IP>:4173` on the same Wi-Fi. This exposes it to your local network only; don't port-forward or deploy it.

## Prism Photo layout (milestone 3)

From a job, open **Photo layout** from the Graphic panel, or from Prism's workspace (tap Prism).

- **Assets**: choose a photo and the logo from your device (on a phone this opens the camera roll). Images are resized (photos to 2400 px on the long edge, the logo to 1200 px) and stored in this browser's IndexedDB. The logo is remembered and reused for the next job. Until the official logo is supplied, the preview shows a dashed "Official logo missing" box, and saving is blocked with a clear reason.
- **Controls**: graphic headline (separate from Quill's caption, up to 80 characters, auto-sized to fit 4 lines); photo crop (zoom, left/right, up/down, or drag the preview); headline position (top, middle, bottom); logo size (60 to 180%). The preview updates as you adjust.
- **Saving** creates a new graphic version labelled "Photo layout". Earlier versions and Quill's caption are untouched. An approved post whose graphic changes needs fresh approval, as before.
- **Download**: open a Photo layout version full screen and choose **Download PNG (1080 × 1350)**. The preview and the export come from the same canvas renderer, so they match pixel for pixel.
- **Storage limits**: if the browser's image or job storage is full, the save is refused with an explanation, nothing is half-saved, and the existing job and versions stay intact.

Limits: images live only in this browser, so they don't sync between devices, and clearing site data removes them. The headline font (Chakra Petch) loads from Google Fonts; offline, both preview and export fall back to the same system font. Photo layout itself is local rendering only. From Milestone 11A, Prism can also generate or edit the picture with OpenAI (see above); the logo, headline and crop are still added here, at no extra charge. No publishing.

## Deploying a preview (for example Vercel)

**Vercel preview smoke test.** `.github/workflows/vercel-preview-smoke.yml` runs on every push, waits for that commit’s Vercel Preview deployment to finish, and reports a **"Vercel preview smoke test"** check on that exact commit. It opens the deployment's own URL in a browser, checks `GET /` and `GET /index.html` both serve HQ, that the app scripts, styles, character art and starting business profile load, and that an unknown `/api` route still returns an error rather than the homepage. It then confirms the full HQ dashboard renders (all four agent cards with artwork, New brief, Plan a content week), and opens Vektor's workspace, the Brand & Quality Reviewer and the Business profile. From Milestone 8 it also creates one post in the test browser (local templates), approves it and checks the demo publishing controls, the Europe/London schedule form and the confirmation render, then backs out without confirming. From Milestone 9 it also requires the Marketing Analyst's card and workspace. It adds the sample posts in the test browser only and checks the 2.0%/1.5% comparison and the suggested test. From Milestone 10 it also opens the Video Creator, renders a video from the labelled sample in the test browser, and checks it plays, where the browser can export. From Milestone 13 it also checks the Business profile's service catalogue records and their public-use defaults. From Milestone 14, if the preview has owner sign-in set up, it checks the private workspace instead: the sign-in screen comes first on every page and direct link, nothing of HQ (scripts, data, images, API) is served before sign-in, and the screen fits a phone. It never signs in. It refuses a deployment whose `/api/version` reports a different commit. It fails on a 5xx, an uncaught startup error, a blank app or a workspace that won't open. If preview protection or missing access stops it reaching HQ, the result is *Blocked* (action required), never a pass. Add Vercel's *Protection Bypass for Automation* secret as the repository secret `VERCEL_AUTOMATION_BYPASS_SECRET`; protection stays on. Vercel reports this project's deployments as a "Vercel" commit status rather than a GitHub Deployment, so the check finds the URL one of two ways. With a read-only `VERCEL_TOKEN` repository secret, it asks the Vercel API for that exact deployment (recommended). Without it, it uses the branch URL, accepted only once it serves this exact commit. Branch URLs over 63 characters can't be derived, so for long branch names such as `claude/milestone-8-publishing-scheduling` the token is needed, and without it the check reports *Blocked*. You can also run it from the Actions tab with a commit SHA. If discovery is blocked, you can pass the deployment's own unique URL (`preview_url`); it's accepted only if that deployment reports the exact commit at `/api/version`, and otherwise the result is *Blocked*. GitHub only offers that manual run once the workflow is on the default branch. Locally: `PREVIEW_URL=https://<deployment>.vercel.app EXPECT_SHA=<commit> REQUIRE_SHA_MATCH=1 VERCEL_AUTOMATION_BYPASS_SECRET=… npm run test:smoke` (needs network access to the preview). Locally: `PREVIEW_URL=… npm run test:smoke`; `npm run test:smoke-selftest` checks its pass/fail/blocked verdicts.

With no settings the server runs in **browser demo mode**: HQ opens, jobs live in the browser, and captions use local templates. It doesn't read or write its data folder at start-up, so a read-only serverless filesystem is fine. The shared workspace (owner sign-in, durable server saves) switches on only when `HQ_OWNER_PASSWORD_HASH` is set. That needs a persistent, writable `HQ_DATA_DIR`, which serverless functions don't provide, so run the shared workspace on a machine you control. `npm run test:preview` checks this boot path, including a bundled build.

**Vercel build.** Vercel's zero-config `node` preset compiles `server.js` into one server function and routes `/` and every unmatched path to it, so the function needs `app/` beside it. `vercel.json` adds it with `includeFiles: "app/**"`. The app lives in `app/`, not `public/`, on purpose: the `node` preset publishes any `public/` folder as static files that Vercel serves without asking the server, which would let anyone fetch HQ's scripts and data without signing in. With no static copy, every request goes through the server and its sign-in check. `npm run test:vercel-build` runs the same build locally from Git-tracked files and checks the function's files and responses.

## Owner controls (milestone 16)

**Archive.** On HQ, *Select* lets you tick posts and *Archive selected*; a content week has *Archive completed posts*; every post has *Post options → Archive*. Each shows how many posts will move first. Archived posts leave the HQ list and the agents' task lists, and keep their versions, images, approvals and Vantage's results; *Archived* (from HQ) lists them with *Restore*. A post with a scheduled or in-progress delivery always stays active, and HQ says how many were skipped.

**Delete permanently** (*Post options*). The confirmation names the post and lists what goes: its caption and graphic versions, approvals, reviews, results and publishing records, its place on the calendar, and the image or video files only it uses. Files another post still uses, and the official Nexai logo, are kept. On a published post it says plainly that deleting the HQ record doesn't remove the post from the platform. The server replaces the post with a tombstone in the same atomic save every other change uses, so no other device's stale save, import or week plan can recreate it; its week keeps the day, marked deleted. A post with a delivery waiting can't be deleted until the schedule is cancelled.

**Download image.** Beside the full-size graphic on the post, on every saved version in its history, in Prism's Photo layout (the last saved version), on the calendar and on a scheduled post's preview. It's the same PNG exporter as the full-size view, so it's exactly the saved version (crop, headline, logo), named `nexai-<post>-graphic-v<n>-1080x1350.png`. A scheduled or approved post defaults to the version in its preview. No approval needed, and no image request is made.

**Cancel a scheduled post.** Open it (from the calendar or the post): *Cancel schedule* or *Cancel and delete post*, each confirmed with the destination and the scheduled UK date and time. The server settles it against the scheduler before HQ says it's done: both the scheduler (the hosted worker, or this server's demo scheduler) and the cancellation change the post with the same atomic, revision-checked save, and the scheduler claims a post that way before sending it, so exactly one wins. Cancelled: nothing is sent, the calendar slot is freed and the post can be edited or scheduled again. If delivery had already started, HQ shows that status instead and keeps the record until the outcome is known. *Cancel and delete* cancels first and deletes only once that's settled. A second tap, a refresh or another device can't send or recreate a cancelled post.

## Copy, creative and review together (milestone 15)

**The repeated headline, fixed at its source.** The old demo generator chose a post's graphic theme from its brief, and its JobTrack theme matched any brief containing “we're building”. So a customer-reactivation post (“We're building a way for local businesses to get back in touch with customers…”) got “What building JobTrack Pro taught us” as its job title and its simulated v1 headline, and Photo layout copied that headline into the owner's real v2. Only a post that mentions JobTrack uses that theme now, and Photo layout starts from the post's own concept, never from a simulated version. Saved versions and approvals are untouched; Calibre flags any saved graphic that still carries an unrelated headline. `tests/helpers/headline-repro.mjs` reproduces the screenshot case.

**Prism works from the post.** Before any image request, the graphic panel shows the headline and scene idea together, both editable, with the caption version they came from (Quill's, or yours if you edited it), and what Prism works from: platform, audience, the plan day's angle and visual brief, and the public Business Profile wording. “No headline” makes a headline-free design. While Quill is still writing, it says so. The image request carries the exact caption as context and never contains text; the headline and the official logo are laid over it afterwards.

**Image and layout stay separate.** *Change headline* saves a new version with the same image, logo and crop: no image request. Every graphic records the caption version it was made for. If the caption changes (a revision, or your edit while Prism was working), the post says so and you choose: change the headline, or keep the graphic for the new caption. Either way it's a new version and needs fresh approval. The preview and the exported PNG are the same drawing of the same saved layout.

**Visuals for the audience.** Scene ideas follow the post's point: for businesses with past customers (any sector) a booking diary, a quiet appointment slot, an owner picking up a reply, or a simple branded graphic with no people; an engineer or a site visit only when the post is about field work. A confirmed week shows all five headlines and scene ideas side by side; proposals are varied automatically, and anything you make too similar is flagged, before any image is paid for.

**Calibre's creative review.** Calibre reviews the exact caption with the headline as rendered on the selected graphic version, the platform and the profile: does the headline express the post's point; do named products and claims belong; is the tone Kieran's helpful, founder-led voice (unless the brief asked for a hard sell); is the logo placed safely; is the headline clipped; is it readable on a phone. Every check says what it was made on: the final render (the same drawing as the export), the text, the scene description only, or not checked. Each finding names the issue, why it matters and one fix. A clearly unrelated headline or a missing image must be corrected before approval; composition suggestions are advisory; you approve. A review of unchanged versions (and the AI wording review of an unchanged caption) is reused, with no repeat request.

**Agents with presence.** Each character keeps its approved artwork and has its own layered idle move, small and occasional, staggered so the team rarely moves at once: Vektor shifts a claw, Quill repositions the stylus, Prism adjusts the aperture, Calibre's lens settles on a detail, Vantage glances at its wrist chart, Cue turns the focus ring. Work motion runs only for a real task: Vektor's tail pulse while delegating, Quill writing, Prism's projection coming into focus (including while generating an image), Calibre scanning during a review or AI wording review, Vantage's chart expanding during analysis or an AI interpretation, Cue's timeline while drafting and the render progress while rendering. It stops when the task finishes, fails or waits for review. Offscreen agents pause, reduced motion stops every loop, status is always text, and motion never moves a tap target, takes focus or changes the scroll position.

## Private, sign-in-first workspace (milestone 14)

When owner sign-in is set up (`HQ_OWNER_PASSWORD_HASH`, with `SUPABASE_URL` and `SUPABASE_SECRET_KEY` on Vercel), HQ is a **private workspace**:

- **Sign-in first, enforced by the server.** Signed out, every page shows the owner sign-in screen before anything else loads, including direct links to jobs, agent workspaces, the calendar, the profile, media and exports. Scripts, styles, data, images and the API are refused (401); only the sign-in screen, its logo and the sign-in API are public. After signing in, HQ opens the page you originally asked for. A session lasts 30 days and survives refreshes; signing out closes access straight away.
- **Always your hosted workspace.** A signed-in owner always works in the configured Supabase workspace. If Supabase can't be reached, HQ says so (“Can't reach your workspace”) and keeps what you've typed in the tab; it never switches to this browser's demo data. The Workspace page lists how sign-in, storage, captions, images and publishing run.
- **No demo output.** A new job starts with its brief. Quill writes the caption with live AI, or shows the actual failure with Retry (never template text). The graphic shows **Graphic needed** with *Generate image* and *Upload photo* until a real one exists. Opening a job never sends an image request; *Generate image* opens with that job's visual brief filled in and sends nothing until you press the button. A failed request keeps your description for a deliberate retry. Photo layout and the official logo work as before.
- **Older work is preserved.** Simulated versions from before stay in history, labelled *Legacy simulated · not usable*. They are never shown as the post's graphic, offered as a fallback, or sent. An approval that includes simulated content stays in the approval history but is flagged; the post needs a real replacement and a fresh approval. Approvals of real pairs are untouched. Leftover demo work in old jobs is retired: the graphic becomes *Graphic needed*, and a waiting caption becomes a Retry.
- **Private calendar, no demo publishing.** Approving a real caption and graphic puts that exact pair on your private calendar, once. Destinations show “LinkedIn isn't connected” (or the Facebook / Google Business Profile equivalent). The demo publish and schedule buttons, demo receipts and the browser scheduler message are gone from the owner's workspace. The server refuses to queue a post for a destination that isn't connected, or one that contains simulated content. Real scheduling opens only once a destination is really connected and the hosted scheduler is set up (Milestone 11B). Approval and scheduling stay separate decisions.
- **The phone save refusal is fixed.** Supabase stores records as `jsonb`, which returns object keys in its own order (shorter names first). HQ compared saved versions as exact text, so after a phone saved a version its next save of that job was refused as “This save would change saved copy v1 / graphic v2”, even though nothing had changed. Versions, approvals, reviews and publication history are now compared by content (key order ignored), and they stay immutable: a real change to a saved version is still refused. The approval bar now sits in the page instead of floating over Generate image and Upload photo on phones.

Without owner sign-in (a public preview with no settings) HQ still runs its labelled browser demo. Simulated graphics, template captions, sample data and the demo publisher are otherwise kept for isolated automated tests only (`HQ_TEST_FIXTURES=1`, which HQ ignores on Vercel).

## Service and product catalogue (milestone 13)

The Business profile now holds an owner-editable **Services and products** catalogue (HQ → *Business profile*, desktop and phone). Each record has an audience, the everyday problem, the intended outcome, a delivery status (*Available*, *In development*, *Planned*), the **approved public wording**, **internal notes**, and a public-use control: *Name it publicly*, *Describe without naming* or *Keep internal*. *Add a service* and *Add a module* create new records.

Seeded records: Professional Websites, Custom Business Software and Bespoke AI Agents & Automation (available, named; audience UK commercial building maintenance and building services firms, especially owners, MDs and operations directors), and the internal family **Nexai Revenue Recovery** with Database Reactivation (in development, *describe without naming*), Quote Recovery and Enquiry Capture (planned, internal). The proposed reactivation commercial model sits in internal notes only. Client contact lists stay outside Marketing HQ.

An existing profile gets the catalogue as **a new version**: your services are carried over by id or name with their edited names and descriptions, and every other field is left exactly as you saved it. It never repeats once a catalogue exists.

**What agents see.** When a job is created, HQ works out which records the brief is about (the topics on each record) and stores just their *public* context on the job: status, audience, problem, outcome, approved wording, and the name only if it may be named. Vektor's plans, Quill's captions, Prism's visual briefs and Cue's scripts use that context. Internal records, internal notes and names marked *describe* never reach generation; the server strips them again before any prompt. An approved post keeps the wording and profile version it was made with; new drafts pick up wording changes. Calibre reads the whole catalogue and fails a draft that names an internal item, discloses a price or commercial term, presents unlaunched work as available, or claims results. Default tone is Kieran's founder-led, conversational UK voice; a hard-sell brief changes the tone but not the availability and disclosure rules.

## Team update before Milestone 11

**Portraits.** Calibre, Vantage and Cue now use the approved three-panel artwork (`design/source-art/team-three-panel.webp`), split by `tools/split-team-art.py` into `app/assets/agents/{calibre,vantage,cue}.webp`. Each is 446 × 695, the same frame as Quill and Prism. The phone strips keep Calibre's inspection lens, Vantage's chart and Cue's camera in view. Names, roles and status are real text, not part of an image.

**An occupied HQ.** This replaces the earlier “idle is still” decision. Every agent has a quiet idle loop:

- **Vektor:** a slow tail sway and an occasional claw adjustment.
- **Quill:** a glint along the visor and a hovering stylus.
- **Prism:** the lens refocusing and the projection shimmering.
- **Calibre:** small focus adjustments of the reticle.
- **Vantage:** a wrist glow and a head tilt towards the display.
- **Cue:** a small framing adjustment of the camera.

Each agent has its own rhythm, and the badges still read *Idle*. Work motion is tied to the real state:

- **Vektor (delegating):** lifts the stinger and sends a cyan handoff across HQ to the agents receiving the job.
- **Quill (writing):** the stylus traces lines.
- **Prism (designing):** the aperture turns and the artwork comes into focus.
- **Calibre (reviewing):** a scan passes over the proof and pauses on a finding.
- **Vantage (analysing):** the display traces a comparison. It's decorative and never shows figures.
- **Cue (rendering):** the tally light comes on and the monitor bar follows the real render progress.

The moving parts are feathered crops or overlays anchored in each portrait's own pixel space. A faint light sweep crosses the workstations. The **Motion** switch in the header turns all of this off or on and is remembered in the browser. Until you choose, it follows the system's reduced-motion setting. Loops pause while the agents are off screen.

**Kieran's editorial voice.** The business profile has an editable **Editorial voice** (`writing.voice`), seeded with Kieran's guidance. Existing profiles get it as a new version, with every other field kept as the owner left it; a voice that's already there (edited, or deliberately blank) is never overwritten. It's the default tone for organic content:

- Vektor's plans (template and AI);
- Quill's captions and revisions (demo templates, mock and the live provider prompt);
- Prism's headlines;
- Cue's scripts;
- Calibre's reviews, which flag hard-sell wording in editorial jobs.

Only a brief that explicitly asks for a **hard sell, a direct-response advert or a promotional / booking CTA** switches that job to a promotional tone, ending on the profile's CTA. That applies to the one job only; “write about our services” keeps the default. Audience, channel rules, approved claims, valid offers and your approval before publishing apply either way. Every job, plan and video editor shows the **tone** it's working to; expand it to read the exact voice. The rules live in `app/js/voice.js`, shared by the browser and the server.

Previews: `design/previews/m10u-hq-ambient-and-handoff.mp4` (18 s: idle, a real delegation, back to ambient), `m10u-phone-hq.mp4`, `m10u-phone-hq.png`, `m10u-motion-off.png`, and the three workspace heroes.

## Cue, the Video Creator (milestone 10)

The sixth agent: a gunmetal robot with a cinema camera rig over its shoulder (`app/assets/agents/cue.webp`). Its tally light comes on only while a video is actually rendering. Its workspace shows the assigned job, progress, the latest output and the history.

- **Brief → video:** on HQ choose **Video post (15–30 s)**, pick the platform and add a screen recording or clip (MP4, MOV or WebM, up to 100 MB). Vektor gives the post caption to Quill and the video to Cue. Cue drafts an editable **script and storyboard** (with live AI from Milestone 11A, otherwise from a labelled template, *demo mode, not AI*): scenes with an on-screen caption, script notes, length and the part of the clip to use. In the **video editor** you can trim (“Start here” takes the clip's current time), change scene timing, reorder, add or remove scenes, edit the on-screen captions and set the logo position. The post caption stays separate: it's Quill's, on the post page.
- **A real video file, made in your browser:** frames are drawn on a 1080 × 1350 canvas and recorded with the browser's MediaRecorder, in real time (a 20 s video takes about 20 s; keep HQ on screen). Captions sit in their own band, so they never cover the screen action. **MP4 (H.264)** is used where the browser can record it, otherwise **WebM**, and the label and file extension say which. WebM files get their duration written in, so other players show the right length. The draft is saved before each render. If rendering fails, or the device can't export (no MediaRecorder), nothing is lost and the editor says so. Nothing is sent to a paid or remote service.
- **Review and publishing:** the review screen plays the whole video, phone included; the shared workspace streams it with byte ranges, which iPhone Safari needs. Each render is a new **video version**, and earlier versions stay playable and downloadable in the history. Approval, publication records and demo receipts name the exact **caption and video versions** (`visual: "video"`, `videoVersion`). A new video version after approval needs fresh approval, and puts any scheduled demo publication on hold. The calendar, job history and Reviewer all work for video posts. The Reviewer checks the logo, the stored files and whether the footage is the sample recording.
- **Sample footage:** no real JobTrack Pro footage has been supplied. `app/samples/sample-receipt-recording.{mp4,webm}` is an **illustrative mock-up** with a red “SAMPLE RECORDING · not the real JobTrack Pro” banner on every frame. You can add it with *Use the labelled sample recording*. A matching upload is recognised by its fingerprint (`app/samples/manifest.json`) and labelled **Sample footage, not real product** wherever it's used. The Reviewer flags any video made from it. Never present it as evidence of how the real product works. Regenerate it with `node tools/make-sample-recording.mjs`.
- **Example exports** made by `npm run test:m10`: `design/previews/m10-sample-export-v1.mp4` and `-v2.mp4` (sample footage), with frames from v1 in `m10-export-v1-frames.png`.

## Vantage, the Marketing Analyst (milestone 9)

The fifth agent: a gunmetal robot studying a chart projected from its wrist (`app/assets/agents/vantage.webp`). Click its HQ card to open its workspace, which works on a phone. The comparisons are **rules-based arithmetic on figures you enter**, with no live connections. From Milestone 11A an optional written AI interpretation describes the actual figures; it never invents results. Platform and Metricool connections come in Milestone 11B.

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
- Vektor's plans (template and AI), Quill's drafts and revisions (local templates, mock and the configured OpenAI provider) and Prism's visual briefs use the relevant fields. Every new caption, graphic, plan, job and review records the profile version it used. Posts from before the profile open unchanged and say so.
- Offers are quoted exactly, and only when the brief asks for an offer that's live on the post date.
- **Profile changes are targeted.** After a save, the screen lists only the posts the change actually touches (for example, a post quoting an offer whose end date changed) and says which field changed and how. An unrelated edit doesn't send other posts back to review or remove approvals.

**Calibre, the Brand & Quality Reviewer** (fourth agent; HQ card, workspace with assigned reviews and history, and a *Brand & quality review* panel on every post):
- Reviews the exact **caption version + graphic version** against the **current profile version**, records all three, and checks offers against the post date (or today, if that's later).
- **Rules the app runs itself:** offer wording that isn't live on that date; the LinkedIn hashtag rule (count and required tags); common US spellings; whether the graphic records the official logo; missing photo or logo files.
- **Needs owner review:** figures, guarantees, superlatives, measured results, and product names without approved claims.
- **Needs your judgement:** whether the image looks like a real UK commercial setting. The graphic is shown for you to inspect.
- Each finding says what was found, where (caption version and paragraph, or graphic version), why it matters and who can fix it. *Send to Quill* and *Send to Prism* open the existing revision controls with the fix pre-filled for you to edit.
- If the caption or graphic changes, the earlier review is marked outdated and kept in the history. Calibre never approves; you do.
- **Artwork:** `app/assets/agents/calibre.webp`, from the approved three-panel artwork (see the team update above).

`HQ_TEST_DATE=YYYY-MM-DD` on the server fixes "today" for offer and review checks in a test workspace, and the app shows a banner while it's set.

## Robotic team redesign (milestone 6)

HQ follows the approved mockup (`design/approved-hq-mockup.png`). Vektor is the full-width centrepiece, with Quill and Prism side by side below him, then **New brief** and **Plan a content week**. On desktop all three sit in one row at equal height.

- **Artwork**: `app/assets/agents/{vektor,quill,prism}.webp` are cropped from the approved mockup, with its baked-in text removed by inpainting (`tools/make-agent-art.py`, build-time only: `pip install pillow opencv-python-headless`). Names, roles, status and chevrons are live interface text. The source is phone resolution (about 900 px wide for Vektor), which is enough for these card sizes; supply higher-resolution renders for anything larger.
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

- **Two planning methods, both labelled on the plan.** *Create template plan*: instant and free, built from your brief with Nexai's standard week structure, no AI. *Draft with AI (1 request)*: one explicit request to the server's configured text model (`OPENAI_TEXT_MODEL`, default gpt-6-luna). It's only offered when live AI is set up and you're signed in as owner.
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
npm run test:team    # Team update: portraits, ambient/work motion, motion switch, editorial voice, profile migration, recordings (:4187–4189)
npm run test:m10     # Milestone 10: video brief → storyboard → render → download, ffprobe checks, v2, approval/publishing, phone playback, failures (servers on :4185 shared, :4186 demo)
npm run test:m9      # Milestone 9: Marketing Analyst, results entry, sample decision, filters, brief to Vektor (server on :4184)
npm run test:m8      # Milestone 8: demo publishing and scheduling with a test clock (servers on :4182 shared, :4183 demo mode)
npm run test:preview # Preview/serverless boot: no settings, read-only filesystem, source entry + esbuild bundle
npm run test:vercel-build # Vercel CLI build (node preset) from tracked files: function includes app/, boots, serves / and /index.html
npm run test:api     # OpenAI request formats, owner gate, one charge per key, usage and errors against a local stub (dummy key, no network, no cost)
npm run test:m16     # Milestone 16 owner controls: week archive with a scheduled post, restore, older-version download on a phone (0 AI calls), cancel from a second device past the due time, cancel-and-delete, permanent deletion with shared media (:4301–4302, ~4 min)
npm run test:m15     # Milestone 15 creative: screenshot-case regression, Prism's brief, headline-only changes, pairing, Calibre, week concepts (:4279–4282)
npm run test:m15-motion # Milestone 15 agents on a phone: idle/work from real events, tap targets, focus, scroll, offscreen, reduced motion (:4295)
npm run test:m14     # Milestone 14 private workspace on the Supabase stand-in (jsonb key order), Android phone: sign-in first, Graphic needed, legacy versions, calendar, outage, notices (:4261–4262)
npm run test:m13     # Milestone 13 catalogue: demo-mode acceptance (Vektor → Quill/Prism/Cue → Calibre → wording change), shared-server prompts (mock), profile upgrade (:4251–4253)
npm run test:m11a    # Milestone 11A in the browser against the OpenAI stub: labels, Prism generate/layout/edit, revisions, failures, usage
npm start   # then, in a second terminal:
npm run test:e2e   # Milestone 1 desktop + phone suite, demo mode on :4173
```

The mock provider (`QUILL_PROVIDER=mock`, `server/quill-mock.js`) returns canned captions so tests are repeatable. Its output is labelled "Mock AI response (test mode)" and is never used unless that variable is set.

## Writing guidance

`server/quill.js` holds Quill's system prompt: British English, written for owners, MDs and operations directors of UK commercial maintenance and building services firms. It uses the brief's operational detail, stays useful rather than salesy, never invents results, and follows platform conventions (3 to 5 hashtags on LinkedIn).

**Nexai's Winner's Writing Process and self-review checklist are not in this repository.** `WRITING_PROCESS` and `SELF_REVIEW` in `server/quill.js` are clearly marked working stand-ins. Replace them with the original wording when available.

## What's simulated

- **Simulated graphics** are local demo outputs (`app/js/graphics.js`), labelled "Simulated demo output": illustrated scenes, not photography. **Photo layout** graphics use your own supplied photo and logo.
- `tests/fixtures/` holds labelled **TEST assets** (a synthetic rooftop HVAC scene and a test logo marked "not official"), generated by `npm run fixtures`. They're for tests only; don't publish them.
- **Captions** are simulated only in demo mode (no key) or mock mode (tests), and labelled as such.
- **Scorpion, agent characters and Nexai logo** are local SVG placeholders, pending official artwork.
- Data lives in this browser's `localStorage` (`nexai-hq:v1`) and doesn't sync between devices.
- Nothing is published, sent, scheduled on a live account or deployed.

## Structure

- `server.js`: static files, Quill API, sign-in, workspace and image APIs (mutating requests same-origin only).
- `server/auth.js` (owner password, sessions), `server/workspace.js` (job revisions, append-only checks, import, images), `server/storage.js` (atomic file writes).
- `scripts/set-owner-password.cjs`: hidden password prompt; writes only the hash to `.env`.
- `server/openai.js`: OpenAI requests (Responses and Images APIs via fetch), error mapping, one-charge-per-key, usage and cost. `server/quill.js`: provider selection and the agents' prompts and schemas. `server/quill-mock.js`, `server/mock-image.js`: test fixtures.
- `app/js/store.js`: jobs, linked tasks, versions, feedback, approvals, persistence, caption request dispatch and retry.
- `app/js/app.js`: views (HQ stage, agent workspace, review, Photo layout studio, calendar, full-screen graphic viewer).
- `app/js/profile.js` (profile helpers, offer dates, targeted change impact) and `app/js/review.js` (Calibre's rules).
- `app/data/profile-seed.json`: the starting business profile.
- `app/js/agents.js`: character artwork, workspace hero, thumbnails and state-driven effect layers.
- `app/js/plan.js`: Europe/London week dates, Nexai's schedule, template planner.
- `app/js/photo.js`: Photo layout renderer (shared by preview and PNG export), upload processing, IndexedDB image store.
- `app/css/app.css`: tokens, responsive layout, reduced-motion handling.
