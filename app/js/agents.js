// The HQ team's artwork and motion.
// Vektor, Quill and Prism come from the approved HQ mockup (design/approved-hq-mockup.png, cleaned by
// tools/make-agent-art.py). Calibre, Vantage and Cue come from the approved three-panel artwork
// (design/source-art/team-three-panel.webp, split by tools/split-team-art.py).
//
// Motion lives in the artwork's own pixel space, so it stays on the tool, joint or light at any size:
//   - idle layers: a quiet loop (feathered crops of the portrait that move a few pixels, or a glow), so HQ feels
//     occupied between jobs. The badge still reads "Idle".
//   - work layers: run only for the agent's real state in [data-state] (delegating, writing, designing, reviewing,
//     analysing, rendering). Cue's render progress comes from the actual render (--p on the card).
// All loops respect reduced motion and the HQ motion switch, and pause while offscreen (see app.js).

const ART = {
  manager: {
    src: 'assets/agents/vektor.webp', w: 909, h: 583, alt: 'Vektor, a gunmetal robotic scorpion with raised tail and cyan lights',
    thumb: { cx: 455, cy: 300, size: 260 },
  },
  copywriter: {
    src: 'assets/agents/quill.webp', w: 438, h: 695, alt: 'Quill, a robot with a narrow cyan visor writing with an illuminated stylus',
    thumb: { cx: 250, cy: 200, size: 230 },
    window: { top: 140, h: 360 }, // workspace hero shows the visor, writing hand and stylus
    card: { top: 0, h: 670 }, // HQ card: trims dark floor below the writing so both action buttons fit on a phone screen
  },
  designer: {
    src: 'assets/agents/prism.webp', w: 446, h: 695, alt: 'Prism, a robot with a large camera aperture framing a projected image',
    thumb: { cx: 315, cy: 125, size: 170 },
    window: { top: 40, h: 370 }, // workspace hero shows the aperture, hands and projection
    card: { top: 0, h: 670 },
  },
  reviewer: {
    src: 'assets/agents/calibre.webp', w: 446, h: 695, alt: 'Calibre, a gunmetal robot whose head is a precision inspection lens with a cyan reticle, holding a proof under an inspection light',
    thumb: { cx: 236, cy: 233, size: 230 },
    window: { top: 90, h: 430 }, // workspace hero: lens, inspection light and proof
    card: { top: 0, h: 670 },
    banner: { top: 128, h: 230 }, // phone strip: the inspection lens and light
  },
  analyst: {
    src: 'assets/agents/vantage.webp', w: 446, h: 695, alt: 'Vantage, a gunmetal robot with a cyan visor studying a holographic chart projected from its wrist',
    thumb: { cx: 140, cy: 190, size: 250 },
    window: { top: 50, h: 400 },
    card: { top: 0, h: 670 },
    banner: { top: 62, h: 250 }, // phone strip: head, visor and the projected chart
  },
  video: {
    src: 'assets/agents/cue.webp', w: 446, h: 695, alt: 'Cue, a gunmetal robot with a cinema camera rig on its shoulder, a monitor and a red tally light',
    thumb: { cx: 250, cy: 200, size: 290 },
    window: { top: 30, h: 400 },
    card: { top: 0, h: 670 },
    banner: { top: 48, h: 270 }, // phone strip: head and the camera rig
  },
};

const pct = (n) => `${+n.toFixed(3)}%`;
let uidSeq = 0;

/**
 * A box of the artwork re-drawn on top of itself, so a part of the portrait (a tail, a hand, a camera) can move a
 * few pixels. `feather` softens the edges so the moving part blends into the still image underneath.
 */
function cropLayer(a, x, y, w, h, cls, { extra = '', origin = null, feather = false } = {}) {
  const L = (x / a.w) * 100, T = (y / a.h) * 100, W = (w / a.w) * 100, H = (h / a.h) * 100;
  const mask = feather ? 'mask-image:radial-gradient(closest-side,#000 62%,transparent 100%);-webkit-mask-image:radial-gradient(closest-side,#000 62%,transparent 100%);' : '';
  const o = origin ? `transform-origin:${pct(((origin[0] - x) / w) * 100)} ${pct(((origin[1] - y) / h) * 100)};` : '';
  return `<span class="${cls}" aria-hidden="true" style="left:${pct(L)};top:${pct(T)};width:${pct(W)};height:${pct(H)};background-image:url(${a.src});background-size:${pct(10000 / W)} ${pct(10000 / H)};background-position:${pct((L / (100 - W)) * 100)} ${pct((T / (100 - H)) * 100)};${o}${mask}${extra}"></span>`;
}
const svg = (a, cls, body) => `<svg class="fx ${cls}" viewBox="0 0 ${a.w} ${a.h}" preserveAspectRatio="none" aria-hidden="true">${body}</svg>`;

function effects(id) {
  const a = ART[id];
  if (id === 'manager') {
    // Idle: slow tail sway, an occasional claw adjustment. Delegating: the stinger lifts and a pulse runs up the tail.
    return cropLayer(a, 470, 0, 300, 275, 'amb vk-tail', { origin: [565, 262], feather: true }) +
      cropLayer(a, 0, 235, 245, 310, 'amb vk-claw', { origin: [225, 300], feather: true }) +
      svg(a, 'fx-vektor', `<path class="fx-anim tail-pulse" pathLength="100" d="M560 250 C610 205 670 170 672 110 C674 60 640 15 590 5 C545 0 515 20 510 45 C505 80 500 110 498 145"/>
      <circle class="fx-anim stinger-glow" cx="499" cy="140" r="9"/>`);
  }
  if (id === 'copywriter') {
    // Idle: a glint moves along the visor as if reading the draft; the stylus hovers. Writing: the stylus traces lines.
    return cropLayer(a, 292, 286, 150, 186, 'amb ql-stylus', { origin: [330, 420], feather: true }) +
      svg(a, 'fx-quill', `<line class="amb ql-visor" pathLength="100" x1="241" y1="95" x2="299" y2="162"/>
      <path class="fx-anim stylus-trace" pathLength="100" d="M398 458 c6 9 12 -7 19 1 s10 10 17 -1 s11 -8 18 3 s10 7 16 -2 s9 -6 14 3 s8 5 12 -1"/>
      <circle class="fx-anim stylus-tip" cx="400" cy="455" r="6"/>`);
  }
  if (id === 'designer') {
    // Idle: the lens gently refocuses and the projection shimmers. Designing: the aperture turns, the artwork sharpens.
    // Idle: now and then the aperture turns a few degrees, as if adjusting. Designing (or generating an image): the
    // aperture turns and the projection comes into focus.
    return cropLayer(a, 260, 70, 110, 110, 'fx-anim aperture') +
      cropLayer(a, 106, 184, 214, 182, 'fx-anim projection', { extra: 'clip-path:polygon(2.3% 0,100% 18%,99.5% 100%,0 83%)' }) +
      cropLayer(a, 252, 45, 140, 140, 'amb pr-lens', { feather: true, origin: [315, 125] }) +
      svg(a, 'fx-prism soft', `<polygon class="amb pr-shimmer" points="111,184 320,217 319,366 106,335"/>`);
  }
  if (id === 'reviewer') {
    // Idle: small focus adjustments of the reticle. Reviewing: a scan passes over the proof and pauses on a finding.
    const clip = `cb-proof-${uidSeq++}`;
    return svg(a, 'fx-reviewer', `<clipPath id="${clip}"><polygon points="226,410 432,368 412,552 175,588"/></clipPath>
      <g class="amb cb-reticle"><circle cx="236" cy="233" r="40" fill="none" stroke-dasharray="4 8"/><circle cx="236" cy="233" r="6"/></g>
      <g clip-path="url(#${clip})"><rect class="fx-anim cb-scan" x="160" y="360" width="290" height="10" rx="5"/></g>
      <circle class="fx-anim cb-finding" cx="297" cy="477" r="17" fill="none"/>
      <circle class="fx-anim cb-light" cx="320" cy="368" r="14"/>`);
  }
  if (id === 'analyst') {
    // Idle: the wrist display glows and the head tilts towards it. Analysing: the display traces a comparison.
    // Decorative only: these shapes never show figures; real numbers live in the workspace as text.
    // Analysing: the projected chart expands from the wrist while the comparison traces across it.
    return cropLayer(a, 20, 55, 215, 255, 'amb va-head', { origin: [115, 300], feather: true }) +
      cropLayer(a, 236, 78, 202, 196, 'fx-anim va-chart', { origin: [320, 343], feather: true }) +
      svg(a, 'fx-analyst', `<circle class="amb va-glow" cx="319" cy="343" r="16"/>
      <polyline class="fx-anim va-trace" pathLength="100" points="249,230 281,190 309,197 339,160 366,165 395,128 420,105"/>
      <polyline class="fx-anim va-compare" pathLength="100" points="249,246 281,226 309,229 339,206 366,214 395,190 420,178"/>`);
  }
  // Cue. Idle: the camera makes a small framing adjustment. Rendering: the tally light comes on and the monitor
  // shows the real render progress (--p, 0–1, set from the render).
  // Idle: the hand turns the focus ring a touch. Drafting the script or editing: a playhead runs along a timeline on
  // the monitor. Rendering: the tally light and the real render progress.
  return cropLayer(a, 150, 40, 296, 300, 'amb cu-camera', { origin: [250, 330], feather: true }) +
    cropLayer(a, 212, 248, 86, 86, 'amb cu-focus', { origin: [255, 291], feather: true }) +
    svg(a, 'fx-cue', `<rect class="cu-timeline" x="120" y="106" width="92" height="9" rx="4.5"/>
    <rect class="fx-anim cu-playhead" x="120" y="96" width="9" height="28" rx="4"/>
    <circle class="fx-anim cu-tally" cx="246" cy="174" r="11"/>
    <rect class="cu-track" x="116" y="118" width="58" height="6" rx="3"/>
    <rect class="cu-progress" x="116" y="118" width="58" height="6" rx="3"/>`);
}

/** The artwork block. `windowed` crops a portrait character to its focal band (workspace hero). */
export function art(id, { windowed = false, card = false, banner = false, eager = false } = {}) {
  const a = ART[id];
  if (banner && a.banner) return framed(a, id, a.banner, eager);
  if (card && a.card) return framed(a, id, a.card, eager);
  const img = `<img src="${a.src}" width="${a.w}" height="${a.h}" alt="" decoding="async" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'}>`;
  const inner = `<span class="agent-art-inner" style="aspect-ratio:${a.w} / ${a.h}">${img}${effects(id)}</span>`;
  if (windowed && a.window) return framed(a, id, a.window, eager);
  return `<span class="agent-art">${inner}</span>`;
}

/** Show a horizontal band of the artwork; effect layers move with it, so they stay aligned. */
function framed(a, id, win, eager) {
  const img = `<img src="${a.src}" width="${a.w}" height="${a.h}" alt="" decoding="async" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'}>`;
  const inner = `<span class="agent-art-inner" style="aspect-ratio:${a.w} / ${a.h}">${img}${effects(id)}</span>`;
  return `<span class="agent-art windowed" style="aspect-ratio:${a.w} / ${win.h}"><span class="agent-art-shift" style="transform:translateY(${pct(-(win.top / a.h) * 100)})">${inner}</span></span>`;
}

export function thumb(id) {
  const a = ART[id];
  const t = a.thumb;
  const size = (a.w / t.size) * 100;
  const px = ((t.cx - t.size / 2) / (a.w - t.size)) * 100;
  const py = ((t.cy - t.size / 2) / (a.h - t.size)) * 100;
  return `<span class="agent-thumb" aria-hidden="true" style="background-image:url(${a.src});background-size:${pct(size)} auto;background-position:${pct(px)} ${pct(py)}"></span>`;
}

export const altText = (id) => ART[id].alt;
