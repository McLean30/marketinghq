// Nexai Digital brand: one source for the HQ header, Prism's Photo layout and every AI image prompt.
// Colours sampled from the official Nexai Digital banner (glowing circuit scorpion + NEXAI DIGITAL wordmark).
// The official logo files live in app/assets/brand/ and are never redrawn by AI: the image model is told to leave
// the logo out, and Photo layout places the real file whole (aspect kept, nothing cropped).
export const BRAND = {
  name: 'Nexai Digital',
  colours: [
    { name: 'Deep space navy', hex: '#030A1C', use: 'backgrounds and shadows' },
    { name: 'Midnight blue', hex: '#0A1F4D', use: 'panels and gradients' },
    { name: 'Electric blue', hex: '#1E6BFF', use: 'main accent, glow and highlights' },
    { name: 'Glow blue', hex: '#3FA9FF', use: 'secondary accent, light trails' },
    { name: 'Ice cyan', hex: '#A8E6FF', use: 'logo glow, fine detail' },
    { name: 'Wordmark white', hex: '#EAF6FF', use: 'headlines and text' },
  ],
  logo: { file: 'nexai-logo.png', id: 'brand:nexai-logo.png', name: 'Official Nexai Digital logo' },
  /** Direction added to every AI image request (Prism generate and edit). */
  imageDirection: 'Colour grade in Nexai Digital’s brand palette: deep navy (#030A1C) and midnight blue (#0A1F4D) shadows, with electric blue (#1E6BFF) and glow blue (#3FA9FF) accent light that occurs naturally in the scene (LED panels, screens, indicator lights, cool daylight, hi-vis reflections). Keep it realistic and believable, not neon or sci-fi. Leave a clear, uncluttered band at the top and bottom of the frame for the headline and the official logo, which are added afterwards. Never draw any logo, scorpion emblem, wordmark, text or watermark.',
};
export const brandBrief = () => `Brand colours: ${BRAND.colours.map((c) => `${c.name} ${c.hex} (${c.use})`).join('; ')}. Logo: the official ${BRAND.name} logo (glowing circuit scorpion with the NEXAI DIGITAL wordmark), placed whole by Photo layout, never redrawn.`;

/** Whether the official logo file is deployed (checked once in the browser). */
let available = null;
export async function officialLogoAvailable() {
  if (available !== null) return available;
  // brand.json says whether the logo file has been added, so HQ never requests a file that isn't there.
  try {
    const m = await (await fetch('assets/brand/brand.json', { cache: 'no-store' })).json();
    if (m?.logo !== true) return (available = false);
    const r = await fetch(`assets/brand/${BRAND.logo.file}`, { cache: 'no-store' });
    available = r.ok && /^image\//.test(r.headers.get('content-type') || '');
  } catch { available = false; }
  return available;
}
export const officialLogoKnown = () => available === true;
