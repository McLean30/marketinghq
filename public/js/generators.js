import { activeOffers } from './profile.js';
// LOCAL DEMO GENERATORS. No live AI is called in milestone 1.
// Captions are assembled from templates keyed off the brief; graphics are SVG specs
// rendered by graphics.js. Every output is flagged `simulated` in the UI.

const THEMES = {
  unbilled: {
    match: /invoic|job sheet|paperwork|unbilled|engineer photos?|missing photos?|photo is missing/i,
    title: 'Finished jobs the office can’t invoice',
    hooks: [
      'Your engineer finished the job on Tuesday. Your office still can’t invoice it.',
      'The work is done. The client is happy. The invoice still hasn’t gone out.',
      'How much finished work is sitting in your system right now, waiting on a job sheet?',
    ],
    friendlyHook: 'We’ve all been there: the job’s done, everyone’s moved on, and the invoice is stuck on a missing photo.',
    problem:
      'Not because anything went wrong on site. Because the job sheet is missing a signature, or the “after” photo never made it back to the office.',
    impacts: [
      'Completed work sitting unbilled for days or weeks',
      'Office teams chasing engineers instead of raising invoices',
      'Clients querying invoices that arrive without evidence',
    ],
    fixes: [
      'Make the signed job sheet and photos a required step before a job can be closed',
      'Give engineers one place to capture notes, signatures and photos on site',
      'Review “complete but not invoiced” jobs every day, not at month end',
    ],
    ctas: [
      'How many finished jobs are waiting on paperwork in your business right now?',
      'What’s the one missing document that holds up your invoicing most often?',
      'If you could fix one step between “job complete” and “invoice sent”, which would it be?',
    ],
    hashtags: [
      ['#CommercialMaintenance', '#FacilitiesManagement', '#FieldService', '#CashFlow', '#JobManagement'],
      ['#FMIndustry', '#MaintenanceManagement', '#FieldServiceManagement', '#Invoicing', '#UKBusiness'],
    ],
    headlines: [
      ['Job done.', 'Invoice stuck.'],
      ['Finished on site.', 'Unbilled in the office.'],
      ['No job sheet,', 'no invoice.'],
    ],
    sub: 'Missing job sheets and photos are holding up cash your engineers have already earned.',
    chip: 'Complete · not invoiced',
    scenes: ['plantroom', 'van', 'office'],
  },
  general: {
    match: /.*/,
    title: null,
    hooks: [
      'Most maintenance problems don’t start on site. They start in the gap between the site and the office.',
      'The best-run maintenance teams aren’t the busiest. They’re the ones with the fewest loose ends.',
      'If your engineers and your office see different versions of the same job, something will slip.',
    ],
    friendlyHook: 'Quick one for anyone running a maintenance team this week.',
    problem: null,
    impacts: [
      'Engineers re-visiting sites for information they already captured once',
      'Office teams working from out-of-date job details',
      'Directors finding out about problems after the client does',
    ],
    fixes: [
      'Agree one source of truth for every job, from booking to sign-off',
      'Capture evidence on site, at the moment the work is done',
      'Review open and stuck jobs daily, not weekly',
    ],
    ctas: [
      'What’s the one handover that causes your team the most rework?',
      'Where does your process lose the most time between site and office?',
      'Which part of your job workflow would you fix first?',
    ],
    hashtags: [
      ['#CommercialMaintenance', '#FacilitiesManagement', '#FieldService', '#Operations', '#UKBusiness'],
      ['#FMIndustry', '#MaintenanceManagement', '#ServiceDelivery', '#Productivity', '#Leadership'],
    ],
    headlines: [
      ['Close the gap', 'between site and office.'],
      ['Fewer loose ends.', 'Faster jobs.'],
      ['One job.', 'One version of the truth.'],
    ],
    sub: 'Joined-up job management for UK commercial maintenance teams.',
    chip: 'Site → office',
    scenes: ['plantroom', 'van', 'office'],
  },
};

const themeFor = (brief) => (THEMES.unbilled.match.test(brief) ? 'unbilled' : 'general');

function audienceFrom(brief) {
  const m = brief.match(/for (?:uk )?([a-z ]*?(?:directors|managers|owners|leaders|teams|engineers))/i);
  return m ? m[1].trim() : 'maintenance leaders';
}

export function briefTitle(brief) {
  const t = THEMES[themeFor(brief)];
  if (t.title) return t.title;
  let clean = brief.replace(/^(please\s+)?(create|write|make|draft|give me)\s+(.*?\bfor\s+)?/i, '').split(/[.?!]/)[0];
  clean = clean.charAt(0).toUpperCase() + clean.slice(1);
  return clean.length > 64 ? `${clean.slice(0, 61)}…` : clean;
}

function compose(theme, platform, opts) {
  const { hookIdx = 0, ctaIdx = 0, tagIdx = 0, short = false, friendly = false, numberPrompt = false } = opts;
  const hook = friendly ? theme.friendlyHook : theme.hooks[hookIdx % theme.hooks.length];
  const tags = theme.hashtags[tagIdx % theme.hashtags.length];
  const cta = theme.ctas[ctaIdx % theme.ctas.length];
  const isShort = short || platform === 'X';
  const noTags = platform === 'Google Business Profile'; // Google Business Profile posts don't use hashtags
  const parts = [hook];
  if (isShort) {
    parts.push(`The usual culprit: ${theme.fixes[0].charAt(0).toLowerCase()}${theme.fixes[0].slice(1)} isn’t happening.`);
    parts.push(cta);
    if (!noTags) parts.push(tags.slice(0, 3).join(' '));
  } else {
    if (theme.problem) parts.push(theme.problem);
    parts.push(`Across a commercial maintenance business, those small gaps add up:\n${theme.impacts.map((i) => `• ${i}`).join('\n')}`);
    if (numberPrompt) parts.push('[Add your own figure here, e.g. the value of work completed but not yet invoiced this month.]');
    parts.push(`Three fixes that help:\n${theme.fixes.map((f, i) => `${i + 1}. ${f}`).join('\n')}`);
    parts.push(cta);
    if (!noTags) parts.push((platform === 'Instagram' ? [...tags, '#Engineering', '#BuildingServices'] : tags).join(' '));
  }
  return { text: parts.join('\n\n'), opts: { hookIdx, ctaIdx, tagIdx, short, friendly, numberPrompt } };
}

/**
 * Apply the business profile to a composed caption: the exact wording of an active offer when the brief asks for
 * one (inserted before the closing question), and the LinkedIn hashtag rule (count and required tags).
 */
function applyProfile(text, job, profile, date, offerId) {
  if (!profile) return { text, offerId: null };
  let parts = text.split('\n\n');
  let usedOffer = null;
  const live = activeOffers(profile, date || job.targetDate);
  const offer = offerId ? live.find((o) => o.id === offerId) : /\boffer\b/i.test(job.brief) ? live[0] : null;
  if (offer) {
    usedOffer = offer.id;
    const at = parts.length >= 2 ? parts.length - 2 : parts.length;
    parts.splice(at, 0, offer.wording);
  }
  const rule = profile.brand?.linkedinHashtags;
  if (job.platform === 'LinkedIn' && rule) {
    const last = parts[parts.length - 1];
    const tags = last.startsWith('#') ? last.split(/\s+/) : [];
    const merged = [...new Set([...(rule.required || []), ...tags])].slice(0, Math.max(rule.max || 5, (rule.required || []).length));
    if (tags.length) parts[parts.length - 1] = merged.join(' '); else parts.push(merged.join(' '));
  }
  return { text: parts.join('\n\n'), offerId: usedOffer };
}

/** Remove lines containing text the feedback quotes and asks to remove (e.g. an expired offer). */
function removeQuoted(text, feedback) {
  if (!/\b(remove|delete|take out|drop)\b/i.test(feedback)) return null;
  const quotes = [...feedback.matchAll(/[“"]([^”"]{6,})[”"]/g)].map((m) => m[1]);
  let out = text;
  for (const q of quotes) out = out.split('\n').filter((line) => !line.includes(q)).join('\n');
  return out === text ? null : out.replace(/\n{3,}/g, '\n\n').trim();
}

export function draftCaption(job, profile = null, date = null) {
  const theme = THEMES[themeFor(job.brief)];
  const composed = compose(theme, job.platform, {});
  const applied = applyProfile(composed.text, job, profile, date);
  return {
    content: { text: applied.text, opts: composed.opts, audience: audienceFrom(job.brief), offerId: applied.offerId },
    notes: [`Drafted for ${audienceFrom(job.brief)} on ${job.platform}`, 'Hook → problem → practical fixes → question → hashtags', ...(profile ? ['Used the business profile (offers, hashtag rule)'] : [])],
  };
}

export function reviseCaption(job, prev, feedback, n, profile = null, date = null) {
  const removed = removeQuoted(prev.text, feedback);
  if (removed) return { content: { ...prev, text: removed, offerId: null }, notes: [`v${n}: Removed the quoted wording; everything else kept as it was`] };
  const theme = THEMES[themeFor(job.brief)];
  const o = { ...(prev.opts || {}) };
  const notes = [];
  const f = feedback.toLowerCase();
  if (/short|concise|trim|tight|long/.test(f)) { o.short = true; notes.push('Cut down to a shorter version'); }
  if (/hashtag|tags/.test(f)) { o.tagIdx = (o.tagIdx || 0) + 1; notes.push('Swapped in a different hashtag set'); }
  if (/friendl|casual|warm|less formal|tone/.test(f)) { o.friendly = true; notes.push('Warmer, more conversational opening'); }
  if (/question|cta|call to action|ending|close/.test(f)) { o.ctaIdx = (o.ctaIdx || 0) + 1; notes.push('New closing question'); }
  if (/stat|number|figure|data/.test(f)) { o.numberPrompt = true; notes.push('Added a placeholder for your own figure (no invented stats)'); }
  if (/hook|open|start|first line|punch/.test(f) || notes.length === 0) {
    o.friendly = false;
    o.hookIdx = (o.hookIdx || 0) + 1;
    notes.push('Rewrote the opening line');
  }
  const { text, opts } = compose(theme, job.platform, o);
  const applied = applyProfile(text, job, profile, date, prev.offerId || null);
  return { content: { ...prev, text: applied.text, opts, offerId: applied.offerId }, notes: [`v${n}: ${notes.join('; ')}`] };
}

export function draftGraphic(job, profile = null) {
  const key = themeFor(job.brief);
  const theme = THEMES[key];
  return {
    content: {
      theme: key,
      scene: theme.scenes[0],
      headline: theme.headlines[0],
      sub: theme.sub,
      chip: theme.chip,
      accent: 'cyan',
      logoScale: 1,
      platform: job.platform,
    },
    notes: ['Plant-room scene, engineer with tablet', 'Headline left, Nexai logo bottom left', ...(profile?.brand?.imagery ? [`Visual brief from the business profile: ${profile.brand.imagery}`] : [])],
  };
}

export function reviseGraphic(job, prev, feedback, n) {
  const theme = THEMES[prev.theme] || THEMES.general;
  const next = { ...prev };
  const notes = [];
  const f = feedback.toLowerCase();
  const sceneHit = /van|vehicle|outside|street|car park/.test(f) ? 'van' : /office|desk|admin|screen/.test(f) ? 'office' : /plant|boiler|pipe|engineer|site/.test(f) ? 'plantroom' : null;
  if (sceneHit && sceneHit !== prev.scene) { next.scene = sceneHit; notes.push(`Changed the setting to the ${sceneLabel(sceneHit)}`); }
  if (/headline|text|wording|words|copy|message/.test(f)) {
    const i = theme.headlines.findIndex((h) => h.join() === prev.headline.join());
    next.headline = theme.headlines[(i + 1) % theme.headlines.length];
    notes.push('New headline');
  }
  if (/logo/.test(f)) { next.logoScale = prev.logoScale >= 1.3 ? 1 : 1.4; notes.push('Logo made more prominent'); }
  if (/bright|colou?r|contrast|blue|pop/.test(f)) { next.accent = prev.accent === 'cyan' ? 'blue' : 'cyan'; notes.push('Accent colour and contrast adjusted'); }
  if (notes.length === 0) {
    const i = theme.scenes.indexOf(prev.scene);
    next.scene = theme.scenes[(i + 1) % theme.scenes.length];
    notes.push(`Tried a new setting: ${sceneLabel(next.scene)}`);
  }
  return { content: next, notes: [`v${n}: ${notes.join('; ')}`] };
}

export const sceneLabel = (s) => ({ plantroom: 'plant room', van: 'service van on site', office: 'maintenance office' })[s] || s;
