# Nexai AI Marketing HQ (milestone 1)

Private internal dashboard for Nexai Digital. Give Vektor (the robotic scorpion Marketing Manager) a brief; it delegates the caption to Quill (Copywriter) and the graphic to Prism (Creative Designer). Review both together, request revisions with feedback, approve the pair, and see it on the private content calendar.

## Run it

```bash
npm start
```

Open http://127.0.0.1:4173. No dependencies to install (Node 18+).

To try it on your phone over your own Wi-Fi: `HOST=0.0.0.0 npm start`, then open `http://<your-laptop-LAN-IP>:4173`. This exposes it to your local network only; don't port-forward or deploy it.

## Test

With the server running:

```bash
npm run test:e2e
```

Runs the acceptance brief through the real UI at desktop (1440×900) and phone (iPhone 13) sizes using Playwright, and saves screenshots to `tests/screenshots/`.

## What's simulated

- **Captions and graphics are local demo outputs** (`public/js/generators.js`, `public/js/graphics.js`), labelled "Simulated demo output" in the UI. No AI model is called.
- **Scorpion, agent characters and Nexai logo are local SVG placeholders** (`public/js/characters.js`, `nexaiLogo()`), pending official artwork.
- Graphics are illustrated scenes of UK commercial maintenance settings (plant room, service van on site, maintenance office), not photography.
- Data is stored in this browser's `localStorage` (`nexai-hq:v1`). It doesn't sync between devices.
- Nothing is published, sent, scheduled on a live account or deployed.

## Structure

- `public/js/store.js`: jobs, linked tasks, versions, feedback, approvals, persistence. Agent work is timestamp-based, so it completes correctly across refreshes. An approval records the exact caption and graphic versions; any later change makes the job need fresh approval.
- `public/js/app.js`: views (HQ stage, agent workspace sheet, review, calendar, full-screen graphic viewer).
- `public/css/app.css`: tokens, responsive layout, reduced-motion handling.
