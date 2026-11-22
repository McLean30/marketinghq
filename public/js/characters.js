// HQ characters (local SVG placeholders for official Nexai artwork).
// Animated parts carry classes that CSS drives from the [data-state] on the wrapper.

export function scorpion(uid = 'sc') {
  const leg = (x1, y1, x2, y2, x3, y3) => `<path d="M${x1} ${y1} L${x2} ${y2} L${x3} ${y3}" />`;
  const tailSeg = [
    [180, 128, 30, 20], [182, 100, 27, 18], [188, 74, 25, 17], [198, 52, 23, 16], [214, 36, 21, 15], [234, 28, 19, 14],
  ];
  return `<svg viewBox="0 0 360 270" class="art art-scorpion" aria-hidden="true">
  <defs>
    <linearGradient id="${uid}-metal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#28426E"/><stop offset="1" stop-color="#0A1428"/></linearGradient>
    <linearGradient id="${uid}-plate" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3A5F95"/><stop offset="1" stop-color="#101E3A"/></linearGradient>
    <radialGradient id="${uid}-glow"><stop offset="0" stop-color="#2EE6FF" stop-opacity=".55"/><stop offset="1" stop-color="#2EE6FF" stop-opacity="0"/></radialGradient>
  </defs>
  <ellipse class="floor-glow" cx="180" cy="238" rx="150" ry="22" fill="url(#${uid}-glow)"/>
  <g class="legs" fill="none" stroke="#5F86BF" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
    ${leg(140, 170, 92, 160, 70, 214)}${leg(144, 182, 100, 184, 86, 232)}${leg(150, 194, 116, 206, 108, 244)}
    ${leg(220, 170, 268, 160, 290, 214)}${leg(216, 182, 260, 184, 274, 232)}${leg(210, 194, 244, 206, 252, 244)}
  </g>
  <g class="tail">
    ${tailSeg.map(([x, y, rx, ry]) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="url(#${uid}-plate)" stroke="#2EE6FF" stroke-opacity=".5" stroke-width="1.5"/>`).join('')}
    <path d="M250 24 Q282 22 284 50 Q284 64 272 74 L268 60 Q272 44 252 40 Z" fill="#1A3360" stroke="#2EE6FF" stroke-width="2"/>
    <circle class="stinger" cx="270" cy="70" r="5" fill="#2EE6FF"/>
  </g>
  <g class="claw claw-l">
    <path d="M140 196 Q110 214 82 206" fill="none" stroke="#5F86BF" stroke-width="10" stroke-linecap="round"/>
    <path d="M84 206 Q46 214 34 186 Q52 196 70 190 Q54 178 58 160 Q76 186 90 198 Z" fill="url(#${uid}-plate)" stroke="#2EE6FF" stroke-width="1.5"/>
  </g>
  <g class="claw claw-r">
    <path d="M220 196 Q250 214 278 206" fill="none" stroke="#5F86BF" stroke-width="10" stroke-linecap="round"/>
    <path d="M276 206 Q314 214 326 186 Q308 196 290 190 Q306 178 302 160 Q284 186 270 198 Z" fill="url(#${uid}-plate)" stroke="#2EE6FF" stroke-width="1.5"/>
  </g>
  <g class="body">
    <ellipse cx="180" cy="152" rx="46" ry="24" fill="url(#${uid}-plate)" stroke="#2EE6FF" stroke-opacity=".45" stroke-width="1.5"/>
    <ellipse cx="180" cy="172" rx="56" ry="26" fill="url(#${uid}-plate)" stroke="#2EE6FF" stroke-opacity=".45" stroke-width="1.5"/>
    <path d="M118 196 Q120 166 180 164 Q240 166 242 196 Q236 226 180 228 Q124 226 118 196 Z" fill="url(#${uid}-metal)" stroke="#2EE6FF" stroke-width="2"/>
    <path d="M146 186 H214" stroke="#2EE6FF" stroke-opacity=".35" stroke-width="2"/>
    <rect x="150" y="190" width="60" height="18" rx="9" fill="#04080F"/>
    <circle class="eye" cx="166" cy="199" r="6" fill="#2EE6FF"/>
    <circle class="eye" cx="194" cy="199" r="6" fill="#2EE6FF"/>
    <circle class="eye eye-sm" cx="153" cy="212" r="2.6" fill="#2EE6FF"/>
    <circle class="eye eye-sm" cx="207" cy="212" r="2.6" fill="#2EE6FF"/>
  </g>
</svg>`;
}

export function writer(uid = 'wr') {
  return `<svg viewBox="0 0 180 190" class="art art-writer" aria-hidden="true">
  <defs><linearGradient id="${uid}-m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2E4C80"/><stop offset="1" stop-color="#0C1830"/></linearGradient></defs>
  <ellipse cx="80" cy="178" rx="58" ry="8" fill="#2EE6FF" opacity=".15"/>
  <g class="doc">
    <rect x="112" y="64" width="58" height="74" rx="4" fill="#0A1428" stroke="#2EE6FF" stroke-width="1.5"/>
    <rect class="doc-line l1" x="120" y="76" width="40" height="4" rx="2" fill="#2EE6FF"/>
    <rect class="doc-line l2" x="120" y="88" width="34" height="4" rx="2" fill="#2EE6FF" opacity=".7"/>
    <rect class="doc-line l3" x="120" y="100" width="42" height="4" rx="2" fill="#2EE6FF" opacity=".7"/>
    <rect class="doc-line l4" x="120" y="112" width="26" height="4" rx="2" fill="#2EE6FF" opacity=".7"/>
  </g>
  <rect x="50" y="98" width="60" height="70" rx="12" fill="url(#${uid}-m)" stroke="#5F86BF" stroke-width="2"/>
  <rect x="62" y="114" width="36" height="6" rx="3" fill="#2EE6FF" opacity=".35"/>
  <rect x="66" y="166" width="10" height="12" fill="#3A5F95"/><rect x="84" y="166" width="10" height="12" fill="#3A5F95"/>
  <path d="M52 112 Q30 130 40 154" fill="none" stroke="#5F86BF" stroke-width="7" stroke-linecap="round"/>
  <g class="pen-arm">
    <path d="M108 112 Q122 112 128 100" fill="none" stroke="#5F86BF" stroke-width="7" stroke-linecap="round"/>
    <path d="M126 104 L142 76 L146 79 L132 107 Z" fill="#E8F1FF"/><circle cx="143" cy="76" r="2.5" fill="#2EE6FF"/>
  </g>
  <line x1="80" y1="40" x2="80" y2="22" stroke="#5F86BF" stroke-width="3"/><circle class="antenna" cx="80" cy="18" r="5" fill="#2EE6FF"/>
  <rect x="44" y="40" width="72" height="56" rx="10" fill="url(#${uid}-m)" stroke="#2EE6FF" stroke-width="2"/>
  <rect x="54" y="56" width="52" height="18" rx="9" fill="#04080F"/>
  <rect class="eye visor" x="60" y="62" width="40" height="6" rx="3" fill="#2EE6FF"/>
</svg>`;
}

export function designer(uid = 'ds') {
  const blades = Array.from({ length: 6 }, (_, i) => `<path d="M0 0 L16 -6 L12 8 Z" transform="rotate(${i * 60})" fill="#2EE6FF" opacity=".85"/>`).join('');
  return `<svg viewBox="0 0 180 190" class="art art-designer" aria-hidden="true">
  <defs><linearGradient id="${uid}-m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2A54A8"/><stop offset="1" stop-color="#0B1630"/></linearGradient></defs>
  <ellipse cx="100" cy="178" rx="58" ry="8" fill="#2F6BFF" opacity=".2"/>
  <g class="frame">
    <rect x="8" y="70" width="50" height="62" rx="3" fill="#0A1428" stroke="#4D8BFF" stroke-width="1.5"/>
    <rect class="swatch s1" x="15" y="78" width="36" height="22" fill="#2F6BFF"/>
    <rect class="swatch s2" x="15" y="104" width="16" height="20" fill="#2EE6FF"/>
    <rect class="swatch s3" x="35" y="104" width="16" height="20" fill="#E8F1FF"/>
  </g>
  <path d="M74 116 Q56 112 54 104" fill="none" stroke="#5F86BF" stroke-width="7" stroke-linecap="round"/>
  <path d="M128 116 Q148 130 140 154" fill="none" stroke="#5F86BF" stroke-width="7" stroke-linecap="round"/>
  <path d="M72 100 H128 L134 168 H66 Z" fill="url(#${uid}-m)" stroke="#5F86BF" stroke-width="2"/>
  <circle cx="100" cy="130" r="8" fill="#2F6BFF" opacity=".6"/>
  <rect x="82" y="166" width="10" height="12" fill="#3A5F95"/><rect x="108" y="166" width="10" height="12" fill="#3A5F95"/>
  <circle cx="100" cy="60" r="36" fill="url(#${uid}-m)" stroke="#4D8BFF" stroke-width="2"/>
  <circle cx="100" cy="60" r="22" fill="#04080F" stroke="#2EE6FF" stroke-width="2"/>
  <g transform="translate(100 60)"><g class="aperture eye">${blades}</g></g>
  <circle cx="100" cy="60" r="5" fill="#04080F"/>
  <circle class="antenna" cx="128" cy="32" r="4" fill="#4D8BFF"/>
</svg>`;
}
