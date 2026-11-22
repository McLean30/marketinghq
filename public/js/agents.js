// Vektor, Quill and Prism: artwork from the approved HQ mockup (design/approved-hq-mockup.png, cleaned by
// tools/make-agent-art.py) plus effect layers positioned in the artwork's own pixel space, so they line up at
// any size. Effects run only for the real task state carried in [data-state]; idle is still.

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
};

const pct = (n) => `${+n.toFixed(3)}%`;

/** A box of the artwork re-drawn on top of itself (for effects that move part of the image). */
function cropLayer(a, x, y, w, h, cls, extra = '') {
  const L = (x / a.w) * 100, T = (y / a.h) * 100, W = (w / a.w) * 100, H = (h / a.h) * 100;
  return `<span class="${cls}" aria-hidden="true" style="left:${pct(L)};top:${pct(T)};width:${pct(W)};height:${pct(H)};background-image:url(${a.src});background-size:${pct(10000 / W)} ${pct(10000 / H)};background-position:${pct((L / (100 - W)) * 100)} ${pct((T / (100 - H)) * 100)};${extra}"></span>`;
}

function effects(id) {
  const a = ART[id];
  if (id === 'manager') {
    // Delegation pulse travels from the body, up the segmented tail, to the stinger.
    return `<svg class="fx fx-vektor" viewBox="0 0 ${a.w} ${a.h}" preserveAspectRatio="none" aria-hidden="true">
      <path class="fx-anim tail-pulse" pathLength="100" d="M560 250 C610 205 670 170 672 110 C674 60 640 15 590 5 C545 0 515 20 510 45 C505 80 500 110 498 145"/>
      <circle class="fx-anim stinger-glow" cx="499" cy="140" r="9"/>
    </svg>`;
  }
  if (id === 'copywriter') {
    // The stylus tip traces a short line on the glowing page.
    return `<svg class="fx fx-quill" viewBox="0 0 ${a.w} ${a.h}" preserveAspectRatio="none" aria-hidden="true">
      <path class="fx-anim stylus-trace" pathLength="100" d="M398 458 c6 9 12 -7 19 1 s10 10 17 -1 s11 -8 18 3 s10 7 16 -2 s9 -6 14 3 s8 5 12 -1"/>
      <circle class="fx-anim stylus-tip" cx="400" cy="455" r="6"/>
    </svg>`;
  }
  // Prism: the aperture turns and the projection comes into focus.
  return cropLayer(a, 260, 70, 110, 110, 'fx-anim aperture') +
    cropLayer(a, 106, 184, 214, 182, 'fx-anim projection', 'clip-path:polygon(2.3% 0,100% 18%,99.5% 100%,0 83%)');
}

/** The artwork block. `windowed` crops a portrait character to its focal band (workspace hero). */
export function art(id, { windowed = false, card = false, eager = false } = {}) {
  const a = ART[id];
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
