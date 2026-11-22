# Nexai AI Marketing HQ (milestone 2)

Private internal dashboard for Nexai Digital. Give Vektor (the robotic scorpion Marketing Manager) a brief; it delegates the caption to Quill (Copywriter) and the graphic to Prism (Creative Designer). Review both together, request revisions with feedback, approve the pair, and see it on the private content calendar.

Milestone 2 gives Quill real AI caption drafting and revision through the Anthropic API (Claude Opus 5.5, `claude-opus-5-5`). Prism's graphics are still local demo outputs.

## Run it

```bash
npm install
npm start
```

Open http://127.0.0.1:4173. Needs Node 20+.

Without credentials, the app runs exactly as in Milestone 1: Quill uses local demo templates and every caption is labelled "Simulated demo output". The brief panel says which mode Quill is in.

### Switch on live AI captions

Quill calls the Anthropic API **from the server only**. The key never reaches the browser and is never logged.

1. Create an API key in the Anthropic Console (platform.claude.com), in a workspace you're happy to bill.
2. Start the server with the key in its environment. Either export it in your shell session:

   ```bash
   export ANTHROPIC_API_KEY=...   # type or paste it in your own terminal, not into chat
   npm start
   ```

   or put `ANTHROPIC_API_KEY=...` in a local `.env` file and run `node --env-file=.env server.js`. `.env` is gitignored; never commit it.
3. The start-up log should say `Quill caption provider: Anthropic API (claude-opus-5-5)`, and new captions are labelled "AI-generated · Claude Opus 5.5".

Optional settings: `QUILL_MODEL` (default `claude-opus-5-5`); `QUILL_PROVIDER=demo` forces demo mode even when a key is present.

Each draft or revision is one API request at `high` effort with structured output, plus the SDK's automatic retries on transient errors. Server-side refusal fallback (`fallbacks: "default"`) is enabled, so if Opus 5.5 declines a request, the API can rerun it on a fallback model.

### Phone

`HOST=0.0.0.0 npm start`, then open `http://<your-laptop-LAN-IP>:4173` on the same Wi-Fi. This exposes it to your local network only; don't port-forward or deploy it.

## Behaviour

- **Every request uses the real job**: the brief and platform go to Quill on every draft. A revision also sends the current caption and your feedback, quoted exactly.
- **Versions**: every result is saved as a new caption version, with its source (AI, mock, demo or you) and the feedback that produced it. Earlier versions stay in History. Revising the caption never touches Prism's graphic.
- **Approval** records the exact caption and graphic versions. Any new caption version makes an approved post need fresh approval; the calendar shows "Needs re-approval".
- **Failures** keep your work. The caption panel shows what went wrong, with **Retry** (and, for a revision, an option to keep the current version and cancel). Approval is blocked until the failed request is resolved.
- **One click, one request**: double taps on Send brief, Send to Quill and Retry are ignored while a request is in flight. If you refresh while Quill is working, the reply is lost with the page; the app then offers Retry rather than silently sending a second request.

## Tests

```bash
npm run test:m2      # Milestone 2 UI suite, desktop + phone, deterministic mock provider (starts its own server on :4174)
npm run test:api     # Anthropic SDK path against a local stub API with a dummy key (no network, no cost)
npm start & npm run test:e2e   # Milestone 1 desktop + phone suite, demo mode on :4173
```

The mock provider (`QUILL_PROVIDER=mock`, `server/quill-mock.js`) returns canned captions so tests are repeatable. Its output is labelled "Mock AI response (test mode)" and is never used unless that variable is set.

## Writing guidance

`server/quill.js` holds Quill's system prompt: British English, written for owners, MDs and operations directors of UK commercial maintenance and building services firms. It uses the brief's operational detail, stays useful rather than salesy, never invents results, and follows platform conventions (3 to 5 hashtags on LinkedIn).

**Nexai's Winner's Writing Process and self-review checklist are not in this repository.** `WRITING_PROCESS` and `SELF_REVIEW` in `server/quill.js` are clearly marked working stand-ins. Replace them with the original wording when available.

## What's simulated

- **Graphics** are local demo outputs (`public/js/graphics.js`), labelled "Simulated demo output": illustrated UK commercial maintenance scenes, not photography.
- **Captions** are simulated only in demo mode (no key) or mock mode (tests), and labelled as such.
- **Scorpion, agent characters and Nexai logo** are local SVG placeholders, pending official artwork.
- Data lives in this browser's `localStorage` (`nexai-hq:v1`) and doesn't sync between devices.
- Nothing is published, sent, scheduled on a live account or deployed.

## Structure

- `server.js`: static server plus `GET /api/quill/status` and `POST /api/quill/caption` (same-origin only).
- `server/quill.js`: provider selection, prompt, Anthropic SDK call, error mapping. `server/quill-mock.js`: test fixture.
- `public/js/store.js`: jobs, linked tasks, versions, feedback, approvals, persistence, caption request dispatch and retry.
- `public/js/app.js`: views (HQ stage, agent workspace, review, calendar, full-screen graphic viewer).
- `public/css/app.css`: tokens, responsive layout, reduced-motion handling.
