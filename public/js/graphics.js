// Customer-facing graphic renderer (local SVG). Scenes are illustrated UK commercial
// maintenance settings. The Nexai logo here is a local placeholder mark.

export function nexaiLogo({ x = 0, y = 0, scale = 1, color = '#FFFFFF', accent = '#2EE6FF' } = {}) {
  return `<g transform="translate(${x} ${y}) scale(${scale})" aria-label="Nexai Digital">
    <path d="M0 8 L20 0 L40 8 L40 40 L20 48 L0 40 Z" fill="none" stroke="${accent}" stroke-width="3"/>
    <path d="M11 34 V14 L29 34 V14" fill="none" stroke="${color}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>
    <text x="54" y="25" font-family="Chakra Petch, Arial, sans-serif" font-weight="700" font-size="26" fill="${color}" letter-spacing="2">NEXAI</text>
    <text x="55" y="44" font-family="Barlow, Arial, sans-serif" font-size="14" fill="${accent}" letter-spacing="3">DIGITAL</text>
  </g>`;
}

const engineer = (x, y, s = 1, tablet = true) => `<g transform="translate(${x} ${y}) scale(${s})">
  <ellipse cx="0" cy="330" rx="70" ry="12" fill="#000" opacity=".35"/>
  <rect x="-34" y="190" width="28" height="135" rx="8" fill="#1F2A3D"/>
  <rect x="6" y="190" width="28" height="135" rx="8" fill="#1B2536"/>
  <rect x="-38" y="318" width="34" height="14" rx="5" fill="#111"/><rect x="4" y="318" width="34" height="14" rx="5" fill="#111"/>
  <path d="M-48 92 Q0 70 48 92 L44 200 L-44 200 Z" fill="#E9F23A"/>
  <rect x="-46" y="150" width="92" height="9" fill="#C9D1D9"/><rect x="-46" y="168" width="92" height="9" fill="#C9D1D9"/>
  <rect x="-6" y="92" width="12" height="108" fill="#C9D1D9" opacity=".85"/>
  <path d="M-48 96 Q-70 150 -40 190 L-28 180 Q-46 150 -34 112 Z" fill="#DDE533"/>
  <path d="M48 96 Q70 140 30 160 L22 148 Q44 136 34 112 Z" fill="#DDE533"/>
  <circle cx="0" cy="52" r="30" fill="#C98E6B"/>
  <path d="M-34 44 Q0 4 34 44 L38 48 L-38 48 Z" fill="#F4F6F8"/><rect x="-40" y="44" width="80" height="8" rx="4" fill="#E2E6EA"/>
  ${tablet ? `<g transform="rotate(-14 30 150)"><rect x="8" y="128" width="54" height="40" rx="5" fill="#0E1626" stroke="#5B6B82" stroke-width="3"/><rect x="14" y="134" width="42" height="28" rx="2" fill="#1C3D5A"/><rect x="18" y="139" width="24" height="4" fill="#7FD9F0"/><rect x="18" y="147" width="30" height="3" fill="#7FD9F0" opacity=".6"/></g>` : ''}
</g>`;

const SCENES = {
  plantroom: () => `
    <rect width="1080" height="1080" fill="#2B3440"/>
    <rect y="760" width="1080" height="320" fill="#4A5260"/>
    <path d="M0 760 H1080" stroke="#6B7380" stroke-width="4"/>
    <g fill="#5E6E3F" opacity=".55"><rect x="0" y="770" width="1080" height="14"/></g>
    <rect x="80" y="60" width="380" height="16" rx="6" fill="#E8EEF5" opacity=".9"/>
    <rect x="620" y="60" width="380" height="16" rx="6" fill="#E8EEF5" opacity=".9"/>
    <rect x="0" y="120" width="1080" height="18" fill="#6C7480"/>
    <g stroke="#9AA3AE" stroke-width="3">${Array.from({ length: 14 }, (_, i) => `<line x1="${i * 80}" y1="120" x2="${i * 80 + 20}" y2="138"/>`).join('')}</g>
    <g><rect x="470" y="320" width="230" height="440" rx="10" fill="#B7BEC6"/><rect x="470" y="320" width="230" height="40" rx="10" fill="#9EA6AF"/>
      <circle cx="540" cy="430" r="26" fill="#F5F5F0" stroke="#3A3F46" stroke-width="5"/><line x1="540" y1="430" x2="552" y2="414" stroke="#C0392B" stroke-width="4"/>
      <circle cx="630" cy="430" r="26" fill="#F5F5F0" stroke="#3A3F46" stroke-width="5"/><line x1="630" y1="430" x2="616" y2="418" stroke="#C0392B" stroke-width="4"/>
      <rect x="500" y="500" width="170" height="90" rx="6" fill="#1D232B"/><rect x="512" y="514" width="60" height="10" fill="#38D47A"/><rect x="512" y="534" width="100" height="8" fill="#6D7782"/>
      <rect x="500" y="610" width="170" height="120" rx="4" fill="#A7AEB7"/><g stroke="#8A929B" stroke-width="4">${[630, 650, 670, 690, 710].map((y) => `<line x1="510" y1="${y}" x2="660" y2="${y}"/>`).join('')}</g></g>
    <g><rect x="740" y="380" width="200" height="380" rx="10" fill="#A9B1BA"/><rect x="760" y="420" width="160" height="70" rx="4" fill="#1D232B"/><circle cx="800" cy="455" r="10" fill="#E74C3C"/><circle cx="840" cy="455" r="10" fill="#38D47A"/>
      <text x="770" y="560" font-family="Arial" font-size="22" font-weight="700" fill="#3A3F46">BOILER 2</text></g>
    <g fill="none" stroke-linecap="round">
      <path d="M0 250 H420 V320" stroke="#B56A3A" stroke-width="26"/><path d="M0 300 H380 V320" stroke="#2F6FB5" stroke-width="22"/>
      <path d="M700 260 H1080" stroke="#D7DCE1" stroke-width="40"/><path d="M700 260 H1080" stroke="#BFC5CC" stroke-width="6" stroke-dasharray="2 38"/>
      <path d="M940 330 H1080" stroke="#B56A3A" stroke-width="24"/><path d="M585 320 V200 H700" stroke="#BFC5CC" stroke-width="30"/>
    </g>
    <g><circle cx="300" cy="250" r="20" fill="#C0392B"/><rect x="292" y="222" width="16" height="10" fill="#7F1D1D"/><circle cx="250" cy="300" r="18" fill="#2F6FB5"/></g>
    <rect x="400" y="560" width="70" height="90" rx="4" fill="#F1C40F"/><path d="M435 578 L420 612 H433 L426 636 L450 600 H436 Z" fill="#1D232B"/>
    ${engineer(960, 420, 1.2)}`,
  van: () => `
    <rect width="1080" height="1080" fill="#7C8EA3"/>
    <rect width="1080" height="560" fill="#9DB0C4"/>
    <rect x="0" y="200" width="1080" height="420" fill="#5C6670"/>
    <g fill="#2A3746">${Array.from({ length: 6 }, (_, i) => `<rect x="${40 + i * 175}" y="250" width="140" height="110" rx="3"/><rect x="${40 + i * 175}" y="400" width="140" height="110" rx="3"/>`).join('')}</g>
    <g fill="#AFC7DD" opacity=".35">${Array.from({ length: 6 }, (_, i) => `<rect x="${40 + i * 175}" y="250" width="60" height="110"/>`).join('')}</g>
    <rect x="0" y="200" width="1080" height="22" fill="#47515B"/>
    <rect x="740" y="520" width="180" height="100" fill="#3B4550"/><text x="752" y="580" font-family="Arial" font-weight="700" font-size="20" fill="#E9EEF3">GOODS IN</text>
    <rect y="620" width="1080" height="460" fill="#3A3F45"/>
    <g fill="#F2F2F2">${[120, 360, 600, 840].map((x) => `<rect x="${x}" y="900" width="160" height="10"/>`).join('')}</g>
    <g transform="translate(330 610) scale(.92)">
      <ellipse cx="300" cy="300" rx="320" ry="22" fill="#000" opacity=".35"/>
      <path d="M0 80 Q0 40 40 40 H420 Q470 40 500 90 L560 170 Q580 190 580 220 V270 Q580 290 560 290 H20 Q0 290 0 270 Z" fill="#F4F6F8"/>
      <path d="M430 60 H460 Q480 60 495 85 L540 160 H430 Z" fill="#1E2A38"/>
      <rect x="20" y="150" width="400" height="34" fill="#1B3A6B"/><rect x="20" y="184" width="400" height="8" fill="#2EE6FF"/>
      <text x="40" y="128" font-family="Chakra Petch, Arial" font-weight="700" font-size="34" fill="#1B3A6B">BUILDING SERVICES</text>
      <circle cx="120" cy="290" r="44" fill="#1A1C1F"/><circle cx="120" cy="290" r="18" fill="#8E949B"/>
      <circle cx="460" cy="290" r="44" fill="#1A1C1F"/><circle cx="460" cy="290" r="18" fill="#8E949B"/>
      <rect x="520" y="240" width="56" height="20" rx="2" fill="#F7D417"/>
    </g>
    ${engineer(990, 590, 1.05)}`,
  office: () => `
    <rect width="1080" height="1080" fill="#3B4452"/>
    <rect y="720" width="1080" height="360" fill="#5B4A3B"/>
    <rect x="60" y="80" width="420" height="300" rx="6" fill="#B8C7D6"/><rect x="60" y="80" width="420" height="300" rx="6" fill="none" stroke="#E5E9EE" stroke-width="14"/>
    <path d="M60 300 L180 220 L280 280 L380 200 L480 260 V380 H60 Z" fill="#7F93A8"/>
    <rect x="560" y="120" width="440" height="230" rx="4" fill="#F4F2EA"/>
    <g fill="#F5D36B">${[[590, 150], [670, 150], [750, 170], [600, 240], [700, 250], [830, 160], [900, 230]].map(([x, y]) => `<rect x="${x}" y="${y}" width="60" height="56" transform="rotate(${(x % 7) - 3} ${x} ${y})"/>`).join('')}</g>
    <rect x="100" y="640" width="900" height="30" fill="#2C2F33"/><rect x="100" y="670" width="900" height="400" fill="#3A3D42"/>
    <g transform="translate(330 380)"><rect width="420" height="260" rx="10" fill="#15191F"/><rect x="14" y="14" width="392" height="216" rx="4" fill="#F7F9FB"/>
      <rect x="30" y="30" width="200" height="16" fill="#1B3A6B"/>
      ${[0, 1, 2, 3, 4].map((i) => `<rect x="30" y="${66 + i * 30}" width="250" height="12" fill="#C8D1DB"/><rect x="300" y="${62 + i * 30}" width="92" height="20" rx="10" fill="${i < 3 ? '#F59E0B' : '#38D47A'}"/>`).join('')}
      <rect x="190" y="260" width="40" height="40" fill="#15191F"/></g>
    <g transform="translate(140 610) rotate(-8)"><rect width="150" height="190" fill="#FFFFFF"/><rect x="16" y="20" width="90" height="10" fill="#1B3A6B"/>${[50, 70, 90].map((y) => `<rect x="16" y="${y}" width="118" height="6" fill="#B6C0CB"/>`).join('')}
      <rect x="16" y="115" width="118" height="56" fill="none" stroke="#E74C3C" stroke-width="4" stroke-dasharray="8 6"/><text x="30" y="150" font-family="Arial" font-size="15" font-weight="700" fill="#E74C3C">NO PHOTO</text></g>
    <rect x="820" y="600" width="70" height="80" rx="8" fill="#E9EEF3"/><path d="M890 620 Q920 630 890 660" fill="none" stroke="#E9EEF3" stroke-width="8"/>`,
};

function wrapLines(text, max) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > max) { lines.push(line.trim()); line = w; } else line += ' ' + w;
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

const escapeXml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function renderGraphic(spec, { title = 'Nexai social graphic' } = {}) {
  const accent = spec.accent === 'blue' ? '#4D8BFF' : '#2EE6FF';
  const scene = (SCENES[spec.scene] || SCENES.plantroom)();
  const subLines = wrapLines(spec.sub, 34);
  const h = spec.headline;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1080" role="img" aria-label="${escapeXml(title)}">
  <defs>
    <linearGradient id="shade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#050B18" stop-opacity=".94"/><stop offset=".6" stop-color="#050B18" stop-opacity=".82"/><stop offset="1" stop-color="#050B18" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="foot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#050B18" stop-opacity="0"/><stop offset="1" stop-color="#050B18" stop-opacity=".9"/></linearGradient>
  </defs>
  ${scene}
  <rect width="760" height="1080" fill="url(#shade)"/>
  <rect y="820" width="1080" height="260" fill="url(#foot)"/>
  <rect x="64" y="96" width="8" height="${h.length * 92 + 10}" fill="${accent}"/>
  ${h.map((line, i) => `<text x="96" y="${170 + i * 92}" font-family="Chakra Petch, Arial, sans-serif" font-weight="700" font-size="80" fill="#FFFFFF">${escapeXml(line)}</text>`).join('')}
  ${subLines.map((line, i) => `<text x="96" y="${200 + h.length * 92 + i * 44}" font-family="Barlow, Arial, sans-serif" font-size="34" fill="#DCE8F7">${escapeXml(line)}</text>`).join('')}
  <g transform="translate(96 ${240 + h.length * 92 + subLines.length * 44})">
    <rect width="${Math.round(spec.chip.length * 12.2 + 48)}" height="52" rx="26" fill="none" stroke="${accent}" stroke-width="3"/>
    <text x="24" y="34" font-family="Barlow, Arial, sans-serif" font-weight="600" font-size="24" fill="${accent}">${escapeXml(spec.chip)}</text>
  </g>
  ${nexaiLogo({ x: 64, y: 1080 - 64 - 48 * spec.logoScale, scale: spec.logoScale, accent })}
</svg>`;
}
