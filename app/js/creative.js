// Prism's creative brief and Calibre's creative checks (Milestone 15). Pure functions shared by the browser, the
// server's prompts and the tests: no network, no storage.
//
// The headline and scene for a post come from the post's own copy (the current caption version, owner edits
// included), its plan day (audience, angle, visual brief) and the public Business Profile wording. Nothing here
// borrows another post's headline or a demo template's.

const STOP = new Set('a an and are as at be been being but by can do for from has have how i if in into is it its just more not of on or our out so than that the their them then there these they this to up us was we were what when where which who why will with you your yours we’re we\'re it’s it\'s don’t don\'t isn’t isn\'t can’t can\'t one two get got make made every also about over only very much many some any each most own same other such no nor too s t'.split(' '));
const words = (s) => String(s || '').toLowerCase().replace(/[’']/g, "'").match(/[a-z0-9][a-z0-9'-]*/g) || [];
const stem = (w) => w.replace(/'s$/, '').replace(/(ing|ed|es|s)$/, '').slice(0, 7);
/** The meaningful words of a text, lightly stemmed (for comparing headlines, scenes and captions). */
export const contentWords = (s) => new Set(words(s).filter((w) => w.length > 2 && !STOP.has(w)).map(stem));
const jaccard = (a, b) => { const A = contentWords(a), B = contentWords(b); if (!A.size || !B.size) return 0; let n = 0; for (const x of A) if (B.has(x)) n++; return n / (A.size + B.size - n); };

/* ---------- What the post is about ---------- */
const TOPICS = [
  { id: 'reactivation', re: /past customer|previous customer|former customer|lapsed|customer (?:database|list)|reactivat|win back|reconnect|back in touch|repeat (?:work|business)|go(?:ne)? cold/i },
  { id: 'quotes', re: /outstanding quote|open quote|quote follow|unanswered quote|quotes? that go cold/i },
  { id: 'enquiries', re: /missed (?:call|enquir)|new enquir|enquiry capture/i },
  { id: 'jobtrack', re: /jobtrack/i },
  { id: 'field', re: /\bengineer|on site|on-site|site visit|plant room|rooftop|service van|\bvans?\b|field work|job sheet|sign-?off|\bppm\b|planned (?:preventative )?maintenance|technician/i },
  { id: 'web', re: /\bwebsites?\b|web design/i },
  { id: 'ai', re: /\bai agents?\b|automation|automate/i },
  { id: 'software', re: /software|job management|invoic/i },
];
/** The main topic of a post: its catalogue item first, then the brief, angle and caption. */
export function topicOf({ brief = '', caption = '', angle = '', catalogueId = '' } = {}) {
  if (catalogueId === 'mod_reactivation') return 'reactivation';
  if (catalogueId === 'mod_quotes') return 'quotes';
  if (catalogueId === 'mod_enquiries') return 'enquiries';
  if (catalogueId === 'svc_web') return 'web';
  if (catalogueId === 'svc_ai') return 'ai';
  const text = `${brief}\n${angle}\n${caption}`;
  for (const t of TOPICS) if (t.re.test(text)) return t.id;
  return 'general';
}

/**
 * Scene ideas by topic, chosen for the audience. Reactivation is for businesses of any sector with past customers,
 * so its scenes are the owner's world (a diary, a quiet slot, a reply), not an engineer on site. Engineers and site
 * visits appear only when the post is about field work.
 */
export const SCENES = {
  reactivation: [
    'A paper booking diary open on a small business counter, a pen resting beside an empty afternoon slot; warm natural light, no people.',
    'A small business owner at their desk smiling as they read a reply from a past customer on their phone; natural light, candid, no visible text.',
    'A quiet appointment slot highlighted on a tablet calendar on a tidy counter; soft daylight, no people.',
    'Simple branded graphic: deep navy background, a single line-drawn calendar with one slot filled in electric blue; no people, no text.',
  ],
  quotes: [
    'A printed quote on a desk beside a phone showing an unanswered message, late afternoon light; no people, no readable text.',
    'A small business owner following up a quote on a laptop in a tidy office; natural light.',
  ],
  enquiries: [
    'A phone on a workshop bench lighting up with a missed call while the owner is busy in the background; natural light, no readable text.',
    'Simple branded graphic: navy background with a single phone icon and a soft blue notification glow; no people, no text.',
  ],
  jobtrack: [
    'An engineer closing a job on a tablet beside completed plant in a UK plant room; the screen shows a simple job checklist, no readable text.',
    'Office coordinator and engineer looking at the same job on a tablet in a site office; natural light.',
  ],
  field: [
    'An engineer finishing a planned maintenance visit in a UK plant room, checking a tablet beside serviced equipment; hi-vis, natural light.',
    'A service van parked outside a commercial building at the end of a site visit, engineer packing tools; late afternoon light.',
  ],
  web: ['A maintenance firm’s clear, simple website open on a laptop in a site office; no readable text.'],
  ai: ['A calm office coordinator at a tidy desk while routine updates are handled on screen in the background; natural light, no readable text.'],
  software: ['Engineer and office coordinator reviewing one job together on a tablet; natural light, no readable text.'],
  general: [
    'Founder of a small UK business at a desk, talking through an idea on a call; natural light, candid.',
    'Simple branded graphic: deep navy background with a single electric-blue accent line; no people, no text.',
  ],
};
const hash = (s) => { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
export const sceneFor = (topic, seed = '') => { const list = SCENES[topic] || SCENES.general; return list[hash(seed) % list.length]; };
/** A scene describes field work (an engineer, a site visit, a van, plant). */
export const sceneIsFieldWork = (scene) => /engineer|technician|site visit|plant room|rooftop|service van|hi-?vis|on site/i.test(scene || '');

/* ---------- A headline from the post's own words ---------- */
const INTRO = /^(a quick (?:note|update|one)|something we(?:’|')re|an idea we(?:’|')re|one of the things|quick one|an honest update|a behind-the-scenes)/i;
const sentences = (t) => String(t || '').replace(/#[\w-]+/g, '').split(/\n+|(?<=[.!?])\s+/).map((x) => x.trim()).filter((x) => x.length > 12);
const DANGLING = /\s+(and|or|but|so|to|the|a|an|of|for|with|that|our|your|their|we|on|in|at|about|this|its|it’s|it's|they’ve|they've|you’ve|you've|we’ve|we've|who|which|before|after|when|is|are|be)$/i;
/** A short headline from a longer sentence: cut at a natural break (comma, colon, dash) if one comes early enough. */
function trimWords(s, max = 8) {
  const clean = String(s).replace(/^[^:]{0,40}:\s*/, (m) => (m.length < 30 ? '' : m)).replace(/[“”"]/g, '').trim();
  const w = clean.split(/\s+/);
  let out;
  if (w.length <= max) out = clean;
  else {
    const clause = clean.split(/\s*[,;:–—]\s+|\s+-\s+/)[0].split(/\s+/);
    out = clause.length >= 3 && clause.length <= max + 1 ? clause.join(' ') : w.slice(0, max).join(' ');
    for (let i = 0; i < 4 && DANGLING.test(out); i++) out = out.replace(DANGLING, '');
  }
  out = out.replace(/[,;:–-]+$/, '');
  return out.replace(/[.!?]*$/, '.').replace(/^./, (c) => c.toUpperCase());
}
/** "We're building a way for businesses to reconnect with…" → "Reconnect with…": the point, not the preamble. */
const pointOf = (s) => String(s || '').replace(/^(?:please\s+)?(?:create|write|make|draft)\s+(?:a\s+)?(?:linkedin|facebook|instagram|x|google business profile)?\s*post\s+(?:for\s+[^,]+?\s+)?(?:about|on)\s+/i, '')
  .replace(/^(?:we(?:’|')re|we are|we(?:’|')ve been)\s+(?:building|working on|making)\s+(?:a\s+(?:simple\s+)?way\s+)?(?:for\s+[^,]+?\s+)?to\s+/i, '').replace(/^what nexai is building for\s+/i, 'Built for ');

/**
 * Propose a headline and scene from the creative brief. Free and local; the owner edits it, or asks Prism (AI) for
 * one. Order: the public catalogue headline for this item, the plan day's takeaway or angle, then the caption.
 */
export function proposeConcept(brief, { seed = '' } = {}) {
  // A planned day is about its own angle first (the week's brief can mention other topics).
  const dayTopic = brief.dayName ? topicOf({ angle: `${brief.angle || ''}\n${brief.takeaway || ''}` }) : 'general';
  const topic = dayTopic !== 'general' ? dayTopic : topicOf({ brief: brief.brief, caption: brief.caption?.text, angle: brief.angle, catalogueId: brief.catalogue?.[0]?.id });
  let headline = '';
  let from = '';
  const cat = brief.catalogue?.[0];
  const dayHeadline = (brief.takeaway || brief.angle) ? trimWords(pointOf(brief.takeaway || brief.angle).replace(/^[^:]{0,50}:\s*/, ''), 7) : '';
  // A planned post says its own day's point; a single post about a catalogue item uses its public headline.
  if (brief.dayName && dayHeadline) { headline = dayHeadline; from = `${brief.dayName}’s ${brief.takeaway ? 'takeaway' : 'angle'}`; }
  else if (cat?.headline?.length) { headline = cat.headline.join(' '); from = 'the Business Profile’s public wording'; }
  else if (dayHeadline) { headline = dayHeadline; from = `the plan day’s ${brief.takeaway ? 'takeaway' : 'angle'}`; }
  else if (brief.caption?.text) {
    // The caption's point: not its friendly opener, a question or the invitation at the end.
    const s = sentences(brief.caption.text).find((x) => !INTRO.test(x) && !/\?\s*$/.test(x) && !/^(the everyday problem|what we(?:’|')re aiming for|if you|tell us|we(?:’|')d like to hear|send us|comments are open|what would you)/i.test(x));
    const point = s && pointOf(s.replace(/^(the everyday problem|what we(?:’|')re aiming for):\s*/i, ''));
    if (point) { headline = trimWords(point, 7); from = `caption v${brief.caption.n}`; }
  }
  if (!headline && brief.brief) { headline = trimWords(pointOf(brief.brief), 7); from = 'the brief'; }
  if (!headline) { headline = 'A note from Nexai.'; from = 'a default'; }
  // The plan's visual brief is kept only if it suits the audience (no engineer for a non-field post).
  const planned = brief.visual && !(topic !== 'field' && topic !== 'jobtrack' && sceneIsFieldWork(brief.visual)) ? brief.visual.replace(/\s*Realistic UK commercial setting, no stock-photo clichés; official Nexai logo\.\s*$/, '') : '';
  const scene = planned || sceneFor(topic, seed);
  // Alternatives, so a week of proposals can be varied without the owner having to (see varyWeek).
  const alts = {
    headlines: [headline, cat?.headline?.length ? cat.headline.join(' ') : '', dayHeadline, brief.angle ? trimWords(pointOf(brief.angle).replace(/^[^:]{0,50}:\s*/, ''), 7) : ''].filter(Boolean),
    scenes: [scene, ...(SCENES[topic] || SCENES.general)],
  };
  return { headline, scene, topic, from, sceneFrom: planned ? 'the visual brief' : `ideas for ${topic === 'reactivation' ? 'businesses with past customers' : `a ${topic} post`}`, alts };
}

/**
 * A week's proposals, varied: where a proposed headline or scene nearly repeats an earlier day's, the next
 * alternative is used instead. The owner's own saved choices are never changed (they're flagged instead).
 */
export function varyWeek(items, threshold = 0.5) {
  const out = [];
  for (const it of items) {
    if (it.source === 'owner' || !it.alts) { out.push(it); continue; }
    const clash = (field, v) => out.some((o) => v && o[field] && jaccard(o[field], v) >= threshold);
    const pick = (field, list, cur) => (clash(field, cur) ? list.find((x) => !clash(field, x)) || cur : cur);
    out.push({ ...it, headline: pick('headline', it.alts.headlines, it.headline), scene: pick('scene', it.alts.scenes, it.scene) });
  }
  return out;
}

/* ---------- A week's concepts side by side ---------- */
/** Pairs of posts whose headlines or scenes are near-duplicates (shared meaningful words), so the owner can change one. */
export function nearDuplicates(items, threshold = 0.5) {
  const out = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const h = jaccard(items[i].headline, items[j].headline);
    const s = jaccard(items[i].scene, items[j].scene);
    if (h >= threshold || (items[i].headline && items[i].headline.trim().toLowerCase() === items[j].headline.trim().toLowerCase())) out.push({ a: i, b: j, what: 'headline', score: +h.toFixed(2) });
    if (s >= threshold) out.push({ a: i, b: j, what: 'scene', score: +s.toFixed(2) });
  }
  return out;
}

/* ---------- Calibre: does the headline express this post's point? ---------- */
const HARD_SELL = /\b(book now|buy now|don’t miss|don't miss|limited time|act now|call today|hurry|best in the uk|guaranteed?|100%)\b/i;
const CLAIM = /\d+\s?%|£\s?\d|\b\d+x\b|\bguarantee|\bproven\b|\bdoubled?\b|\btripled?\b/i;
/**
 * Text checks on the rendered headline against the exact caption and profile. Returns findings (issue, why, fix).
 * `blocking` marks the ones that must be fixed before approval (a clearly unrelated headline).
 */
export function headlineFindings({ headline, noHeadline, caption, brief = '', angle = '', profileData = null, catalogue = [], tone = 'editorial', where = 'Headline' }) {
  const out = [];
  const h = String(headline || '').trim();
  if (noHeadline || !h) return out;
  const ref = `${caption}\n${angle}\n${(catalogue || []).map((i) => `${i.wording || ''} ${i.outcome || ''} ${i.problem || ''}`).join(' ')}`;
  const H = contentWords(h);
  const R = contentWords(ref);
  const shared = [...H].filter((w) => R.has(w));
  // Named products and services in the headline that the caption doesn't mention (e.g. JobTrack Pro on a reactivation post).
  const names = [...(profileData?.proof || []).map((p) => p.name), ...(profileData?.catalogue?.items || []).map((i) => i.name)].filter(Boolean);
  const named = names.filter((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(h) || (n.split(/\s+/)[0].length > 4 && new RegExp(`\\b${n.split(/\s+/)[0]}\\b`, 'i').test(h) && /jobtrack/i.test(n)));
  for (const n of named) {
    if (new RegExp(`\\b${n.split(/\s+/)[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(caption)) continue;
    const item = (profileData?.catalogue?.items || []).find((i) => i.name === n);
    out.push({ check: 'headline', status: 'fail', blocking: true, title: `The headline names ${n}, which this post isn’t about`, quote: h, where, why: `The caption never mentions ${n}${item && item.disclosure !== 'name' ? `, and the Business Profile says ${n} ${item.disclosure === 'internal' ? 'stays internal' : 'is described without naming it'}` : ''}. A headline that names a different product reads as a mistake and misleads the reader.`, fixer: 'designer', fix: `Write the headline from the caption’s own point${caption ? ` (for example: “${proposeConcept({ caption: { n: 0, text: caption }, brief, angle, catalogue }).headline}”)` : ''}. The image can stay as it is.` });
  }
  if (!named.length && H.size >= 2 && shared.length === 0) {
    out.push({ check: 'headline', status: 'fail', blocking: true, title: 'The headline doesn’t express this post’s point', quote: h, where, why: 'None of the headline’s key words appear in the caption, its angle or the Business Profile wording it uses, so a reader scrolling past would get a different message from the post.', fixer: 'designer', fix: `Use a headline built from the caption (for example: “${proposeConcept({ caption: { n: 0, text: caption }, brief, angle, catalogue }).headline}”). Changing the headline reuses the same image.` });
  }
  if (CLAIM.test(h) && !CLAIM.test(caption)) out.push({ check: 'headline', status: 'owner', title: 'The headline makes a claim the caption doesn’t', quote: h, where, why: 'Figures, guarantees and results in a headline need the same backing as in the caption, and this one has none there.', fixer: 'designer', fix: 'Remove the figure or claim from the headline, or add an approved claim to the Business Profile first.' });
  if (tone !== 'promo' && HARD_SELL.test(h)) out.push({ check: 'headline', status: 'owner', title: 'The headline reads as a hard sell', quote: h, where, why: 'This post uses Kieran’s helpful, founder-led voice. Only a brief that explicitly asks for a hard sell changes that.', fixer: 'designer', fix: `Rewrite it as the post’s useful point, without “${h.match(HARD_SELL)[0]}”.` });
  return out;
}

/**
 * Checks on the final composed render (what's actually in the exported PNG). `m` comes from photo.js drawLayout.
 * Phone readability assumes the post shows about 360 CSS pixels wide in a feed.
 */
export function renderFindings(m, where) {
  const out = [];
  if (!m) return out;
  if (m.missingPhoto) out.push({ check: 'render', status: 'fail', blocking: true, title: 'The photo slot is empty', where, why: 'The exported graphic would show the “Photo missing” placeholder instead of an image.', fixer: 'designer', fix: 'Generate an image or upload a photo, then save the layout.' });
  if (m.missingLogo) out.push({ check: 'render', status: 'fail', title: 'The official logo is missing from the render', where, why: 'Every Nexai post carries the official logo; the export would show a placeholder.', fixer: 'designer', fix: 'Add the official Nexai logo in Photo layout and save.' });
  if (m.clipped) out.push({ check: 'render', status: 'fail', title: 'The headline is cut off in the render', quote: m.lines?.join(' '), where, why: `At the smallest size the headline still needs ${m.neededLines} lines, so the last words don’t appear in the export.`, fixer: 'designer', fix: 'Shorten the headline to about seven words.' });
  if (m.overlap) out.push({ check: 'render', status: 'fail', title: 'The logo overlaps the headline', where, why: 'Overlapping text and logo are hard to read and look broken on a phone.', fixer: 'designer', fix: 'Move the headline to the bottom, or make the logo smaller.' });
  if (m.logoOutside) out.push({ check: 'render', status: 'fail', title: 'The logo sits outside the safe margin', where, why: 'Feeds crop the edges of images, so the logo could be cut off.', fixer: 'designer', fix: 'Reset the logo size in Photo layout.' });
  if (!m.noHeadline && m.headlineSize && m.headlineSize * (360 / 1080) < 18) out.push({ check: 'render', status: 'owner', title: 'The headline may be small on a phone', where, why: `In a phone feed it shows at about ${Math.round(m.headlineSize / 3)} px, below a comfortable 18 px.`, fixer: 'designer', fix: 'Shorten the headline so it can be set larger.' });
  if (!m.noHeadline && m.lines?.length >= 4) out.push({ check: 'render', status: 'advisory', title: 'The headline runs to four lines', quote: m.lines.join(' '), where, why: 'A long headline covers more of the image and is slower to read in a feed.', fixer: 'designer', fix: 'Cut it to the post’s single point in about seven words.' });
  return out;
}
