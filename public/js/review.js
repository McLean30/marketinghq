// The Brand & Quality Reviewer's checks. Everything here is a local, deterministic rule; nothing is sent anywhere.
// Each check is labelled: 'rule' (the app checked it), 'owner' (needs your review), 'human' (needs your eyes).
import { norm, offerState, fmt } from './profile.js';

const US_UK = [
  ['organize', 'organise'], ['organization', 'organisation'], ['optimize', 'optimise'], ['prioritize', 'prioritise'], ['realize', 'realise'],
  ['color', 'colour'], ['center', 'centre'], ['behavior', 'behaviour'], ['favorite', 'favourite'], ['analyze', 'analyse'], ['program ', 'programme '],
  ['license ', 'licence '], ['catalog ', 'catalogue '], ['labor', 'labour'], ['customize', 'customise'], ['standardize', 'standardise'],
];
const CLAIM_PATTERNS = [
  [/\b\d+(\.\d+)?\s?%/, 'a percentage'], [/£\s?\d/, 'a money figure'], [/\b\d+\s?x\s(faster|more|quicker)\b/i, 'a multiplier'],
  [/\b(guarantee[sd]?|proven|award[- ]winning|industry[- ]leading|number one|best in (the )?(uk|industry))\b/i, 'a superlative or guarantee'],
  [/\b(save[sd]?|cut|reduce[sd]?|increase[sd]?|boost(?:ed|s)?)\b[^.\n]{0,40}\b\d+/i, 'a measured result'],
];

/** Where a line sits, as a person reads it: "paragraph 3" (blank lines separate paragraphs). */
function para(lines, i) {
  let n = 0;
  for (let k = 0; k <= i; k++) if (lines[k].trim() && (k === 0 || !lines[k - 1].trim())) n++;
  return n;
}
const lineOf = (lines, needle) => {
  const i = lines.findIndex((l) => norm(l).includes(norm(needle)));
  return i >= 0 ? `paragraph ${para(lines, i)}` : 'text';
};

/**
 * @param job, copyVersion, graphicVersion  the exact versions under review
 * @param profile  { id, n, data } the current business profile version
 * @param brand    workspace logo setting { logoId, logoName }
 * @param date     the date offers must be valid on (post date or today, whichever is later)
 * @param present  Set of asset ids that exist in storage
 */
export function runChecks({ job, copyVersion, graphicVersion, profile, brand, date, present }) {
  const caption = copyVersion?.content?.text || '';
  const lines = caption.split('\n');
  const cv = copyVersion?.n;
  const gv = graphicVersion?.n;
  const data = profile.data;
  const checks = [];
  const findings = [];
  const add = (f) => findings.push({ id: `${f.check}-${findings.length + 1}`, ...f });

  // 1. Offer wording must match an offer that's live on the post date.
  const offers = (data.offers || []).filter((o) => o.wording);
  const offenders = expiredOffers(caption, data, date);
  checks.push({ id: 'offers', label: 'Offer wording is current', kind: 'rule', result: offenders.length ? 'fail' : 'pass', detail: `${offers.length} offer${offers.length === 1 ? '' : 's'} in ${profile.id} checked for ${fmt(date)}` });
  for (const o of offenders) {
    add({ check: 'offers', status: 'fail', title: 'Expired offer wording in the caption', quote: o.wording, where: `Caption v${cv}, ${lineOf(lines, o.wording)}`,
      why: `This offer isn’t available on ${fmt(date)}: ${offerState(o, date).why} (business profile ${profile.id}). Publishing it would promise something Nexai isn’t offering.`,
      fixer: 'copywriter', fix: `Remove the expired offer wording “${o.wording}”. Keep everything else as it is.` });
  }

  // 2. LinkedIn hashtags follow the profile rule.
  if (job.platform === 'LinkedIn') {
    const rule = data.brand?.linkedinHashtags || { min: 3, max: 5, required: [] };
    const tags = caption.match(/#[\p{L}\p{N}_]+/gu) || [];
    const lower = tags.map((t) => t.toLowerCase());
    const missing = (rule.required || []).filter((t) => !lower.includes(t.toLowerCase()));
    const countBad = tags.length < rule.min || tags.length > rule.max;
    const ok = !countBad && !missing.length;
    checks.push({ id: 'hashtags', label: 'LinkedIn hashtags follow the brand rule', kind: 'rule', result: ok ? 'pass' : 'fail', detail: `${tags.length} hashtag${tags.length === 1 ? '' : 's'}; rule is ${rule.min}–${rule.max}${rule.required?.length ? ` including ${rule.required.join(' ')}` : ''}` });
    if (!ok) {
      const tagLine = lines.findIndex((l) => /#[\p{L}\p{N}_]+/u.test(l));
      add({ check: 'hashtags', status: 'fail', title: countBad ? `${tags.length} hashtag${tags.length === 1 ? '' : 's'} (rule: ${rule.min}–${rule.max})` : `Missing required hashtag${missing.length === 1 ? '' : 's'}: ${missing.join(' ')}`,
        quote: tagLine >= 0 ? lines[tagLine] : '', where: tagLine >= 0 ? `Caption v${cv}, paragraph ${para(lines, tagLine)} (hashtags)` : `Caption v${cv} (no hashtag line)`,
        why: `Nexai’s brand rules (${profile.id}) set LinkedIn hashtags so posts are findable and consistent.`, fixer: 'copywriter',
        fix: `Finish with ${rule.min} to ${rule.max} relevant LinkedIn hashtags${rule.required?.length ? `, including ${rule.required.join(' ')}` : ''}.` });
    }
  } else checks.push({ id: 'hashtags', label: 'LinkedIn hashtags follow the brand rule', kind: 'rule', result: 'na', detail: `Not a LinkedIn post (${job.platform})` });

  // 3. British English spelling (common US forms).
  const us = US_UK.filter(([u]) => new RegExp(`\\b${u.trim()}`, 'i').test(caption));
  checks.push({ id: 'spelling', label: 'British English spelling', kind: 'rule', result: us.length ? 'fail' : 'pass', detail: `Checked ${US_UK.length} common US spellings` });
  for (const [u, k] of us) add({ check: 'spelling', status: 'fail', title: `US spelling “${u.trim()}”`, quote: lines.find((l) => new RegExp(`\\b${u.trim()}`, 'i').test(l)) || '', where: `Caption v${cv}, paragraph ${para(lines, lines.findIndex((l) => new RegExp(`\\b${u.trim()}`, 'i').test(l)))}`, why: `Nexai writes in ${data.brand?.language || 'British English'}.`, fixer: 'copywriter', fix: `Change “${u.trim()}” to “${k.trim()}”.` });

  // 4. Logo metadata and 5. supplied assets.
  const photo = graphicVersion?.content?.mode === 'photo';
  const logoProblems = [];
  if (!brand?.logoId) logoProblems.push({ title: 'No official logo set for the workspace', why: 'Brand rules require the official Nexai logo, and none has been supplied in Prism’s Photo layout yet.' });
  if (!photo) logoProblems.push({ title: `Graphic v${gv} is simulated and has no logo file`, why: 'The simulated graphic draws a placeholder mark, not the official Nexai logo file.' });
  else if (!graphicVersion.content.logoId) logoProblems.push({ title: `Graphic v${gv} has no logo recorded`, why: 'The design doesn’t record which logo it used, so it can’t be confirmed as official.' });
  else if (brand?.logoId && graphicVersion.content.logoId !== brand.logoId) logoProblems.push({ title: `Graphic v${gv} uses an older logo file (${graphicVersion.content.logoName})`, why: `The workspace logo is now ${brand.logoName}.` });
  checks.push({ id: 'logo', label: 'Official logo recorded on the graphic', kind: 'rule', result: logoProblems.length ? 'fail' : 'pass', detail: photo ? `Graphic v${gv} logo: ${graphicVersion.content.logoName || 'none'}` : `Graphic v${gv} is simulated` });
  for (const p of logoProblems) add({ check: 'logo', status: 'fail', title: p.title, where: `Graphic v${gv}`, why: p.why, fixer: 'designer', fix: 'Open Photo layout and save the design with the official Nexai logo.' });

  const missing = [];
  if (!photo) missing.push({ title: `Graphic v${gv} has no supplied photo`, why: 'Brand rules ask for realistic commercial maintenance imagery; the simulated illustration isn’t a real photo.' });
  else {
    if (!present.has(graphicVersion.content.photoId)) missing.push({ title: `Photo “${graphicVersion.content.photoName}” is missing from storage`, why: 'Without the original photo the graphic can’t be exported again.' });
    if (graphicVersion.content.logoId && !present.has(graphicVersion.content.logoId)) missing.push({ title: `Logo file “${graphicVersion.content.logoName}” is missing from storage`, why: 'Without the logo file the graphic can’t be exported again.' });
  }
  checks.push({ id: 'assets', label: 'Supplied photo and logo files exist', kind: 'rule', result: missing.length ? 'fail' : 'pass', detail: photo ? 'Checked the stored photo and logo files' : 'No supplied photo' });
  for (const m of missing) add({ check: 'assets', status: 'fail', title: m.title, where: `Graphic v${gv}`, why: m.why, fixer: 'designer', fix: 'Open Photo layout and choose the photo (and logo) again, then save.' });

  // 6. Claims the profile doesn't substantiate: owner review.
  const claimLines = [];
  lines.forEach((l, i) => {
    for (const [re, kind] of CLAIM_PATTERNS) if (re.test(l) && !/^#/.test(l.trim())) { claimLines.push({ line: i + 1, text: l, kind }); break; }
  });
  for (const p of data.proof || []) {
    if (p.claims?.trim()) continue;
    const i = lines.findIndex((l) => norm(l).includes(norm(p.name)));
    if (i >= 0 && !claimLines.some((c) => c.line === i + 1)) claimLines.push({ line: i + 1, text: lines[i], kind: `${p.name}, which has no approved claims yet` });
  }
  checks.push({ id: 'claims', label: 'Claims are backed by the profile', kind: 'owner', result: claimLines.length ? 'owner' : 'pass', detail: claimLines.length ? `${claimLines.length} line${claimLines.length === 1 ? '' : 's'} need your review` : 'No figures, guarantees or product claims found' });
  for (const c of claimLines) add({ check: 'claims', status: 'owner', title: 'Needs owner review', quote: c.text, where: `Caption v${cv}, paragraph ${para(lines, c.line - 1)}`, why: `This line contains ${c.kind}. The business profile (${profile.id}) has no approved claim that backs it.`, fixer: 'owner', fix: 'Confirm it’s accurate and add it to the profile’s approved claims, or ask Quill to remove it.' });

  // 7. Visual judgement: always a person.
  checks.push({ id: 'visual', label: 'Image shows a realistic UK commercial maintenance setting', kind: 'human', result: 'human', detail: 'Needs your eyes: the app can’t judge what a photo shows' });
  add({ check: 'visual', status: 'human', title: 'Check the image yourself', where: `Graphic v${gv}`, why: `Brand rule (${profile.id}): ${(data.brand?.imagery || 'realistic commercial maintenance imagery').replace(/\.\s*$/, '')}.`, fixer: 'owner', fix: 'Look at the graphic below. If the setting isn’t right, ask Prism for a new photo layout.' });

  return { checks, findings };
}

/** Offers quoted in `caption` that aren't live on `date` (the same rule the review uses). Also run before dispatch. */
export function expiredOffers(caption, data, date) {
  return (data?.offers || []).filter((o) => o.wording && !offerState(o, date).live && norm(caption).includes(norm(o.wording)));
}

/** Is this review still about the current caption and graphic? */
export function reviewFreshness(review, copyN, graphicN) {
  if (!review) return { fresh: false, reasons: [] };
  const reasons = [];
  if (review.copyVersion !== copyN) reasons.push(`caption changed from v${review.copyVersion} to v${copyN}`);
  if (review.graphicVersion !== graphicN) reasons.push(`graphic changed from v${review.graphicVersion} to v${graphicN}`);
  return { fresh: !reasons.length, reasons };
}
