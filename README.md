# Nexai AI Marketing HQ (milestone 3)

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

- `server.js`: static server plus `GET /api/quill/status` and `POST /api/quill/caption` (same-origin only).
- `server/quill.js`: provider selection, prompt, Anthropic SDK call, error mapping. `server/quill-mock.js`: test fixture.
- `public/js/store.js`: jobs, linked tasks, versions, feedback, approvals, persistence, caption request dispatch and retry.
- `public/js/app.js`: views (HQ stage, agent workspace, review, Photo layout studio, calendar, full-screen graphic viewer).
- `public/js/photo.js`: Photo layout renderer (shared by preview and PNG export), upload processing, IndexedDB image store.
- `public/css/app.css`: tokens, responsive layout, reduced-motion handling.
