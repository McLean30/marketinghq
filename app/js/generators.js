import { activeOffers, norm } from './profile.js';
import { toneFor, variant } from './voice.js';
import { STATUS } from './catalogue.js';
import { proposeConcept } from './creative.js';

/* ---------- Posts about a service or product in the catalogue ----------
   The job carries only the public context its brief needed (job.catalogue, from catalogue.js contextFor): the
   approved wording, audience, problem, outcome and status. Never internal notes, internal names or prices. */
const catItem = (job) => job?.catalogue?.items?.[0] || null;
const lowerFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const firstSentence = (s, max = 110) => { const m = String(s || '').split(/(?<=[.!?])\s/)[0]; return m.length > max ? `${m.slice(0, max - 1)}…` : m; };
const CAT_TAGS = [['#SmallBusiness', '#UKBusiness', '#CustomerRelationships', '#RepeatBusiness', '#LocalBusiness'], ['#UKSmallBusiness', '#CustomerExperience', '#BusinessGrowth', '#Relationships', '#Founders']];
const SVC_TAGS = [['#CommercialMaintenance', '#FacilitiesManagement', '#BuildingServices', '#Operations', '#UKBusiness'], ['#FMIndustry', '#MaintenanceManagement', '#ServiceDelivery', '#Productivity', '#Leadership']];

function composeCatalogue(it, platform, opts, ctx = {}) {
  const { hookIdx = 0, ctaIdx = 0, tagIdx = 0, short = false, friendly = false, numberPrompt = false } = opts;
  const isShort = short || platform === 'X';
  const noTags = platform === 'Google Business Profile';
  const live = it.status === 'available';
  const intros = it.status === 'in_development'
    ? ['A quick update from inside Nexai on something we’re building at the moment.', 'Something we’re working on at Nexai right now, and why.']
    : it.status === 'planned' ? ['Something we’re thinking about at Nexai.', 'An idea we’re exploring at Nexai, and the problem behind it.']
      : ['A quick note on something we do at Nexai.', 'One of the things we build at Nexai, and the problem behind it.'];
  const parts = [friendly ? 'Quick one from inside Nexai this week.' : intros[hookIdx % intros.length]];
  parts.push(it.name ? `${it.name}: ${it.wording}` : it.wording);
  if (!isShort) {
    if (it.problem) parts.push(`The everyday problem: ${lowerFirst(it.problem)}`);
    if (it.outcome) parts.push(`What we’re aiming for: ${lowerFirst(it.outcome)}`);
  }
  if (it.status === 'in_development') parts.push('It’s still in development, so this is where we’re heading rather than a finished product or results we can point to yet.');
  if (it.status === 'planned') parts.push('It’s an idea we’re exploring, not something you can use yet.');
  if (numberPrompt) parts.push('[Add your own figure here, if you have one you can share.]');
  if (ctx.mode === 'promo' && live) parts.push(`${ctx.cta || 'Request a Free Workflow Review'}: send us a message to book a time.`);
  else {
    const end = variant(`${ctx.seed || ''}:${ctaIdx}`, 3);
    if (end === 0) parts.push('If you’re dealing with the same thing, tell us in the comments how you handle it.');
    else if (end === 1) parts.push(live ? 'If this sounds familiar, send us a message. We’re always happy to compare notes.' : 'If you’d like to compare notes while we build it, send us a message.');
    else parts.push('We’d like to hear how you handle this at the moment. Comments are open.');
  }
  const tags = (it.kind === 'service' ? SVC_TAGS : CAT_TAGS)[tagIdx % 2];
  if (!noTags) parts.push((isShort ? tags.slice(0, 3) : tags).join(' '));
  return { text: parts.join('\n\n'), opts: { hookIdx, ctaIdx, tagIdx, short, friendly, numberPrompt } };
}
const catNote = (job, it) => `Used the business profile’s approved public wording (${job.catalogue.profileVersion || 'profile'}): ${it.name ? `named as “${it.name}”` : 'described without naming it'}, ${STATUS[it.status].toLowerCase()}${job.catalogue.left?.length ? `; left out ${job.catalogue.left.length} internal item${job.catalogue.left.length === 1 ? '' : 's'}` : ''}`;
// LOCAL DEMO GENERATORS. No live AI is called in milestone 1.
// Captions are assembled from templates keyed off the brief; graphics are SVG specs
// rendered by graphics.js. Every output is flagged `simulated` in the UI.

const THEMES = {
  building: {
    // Only a post that is actually about JobTrack Pro. "We're building…" alone used to match too, which gave a
    // customer-reactivation post the headline "What building JobTrack Pro taught us" (Milestone 15).
    match: /jobtrack/i,
    title: 'What building JobTrack Pro taught us',
    hooks: ['We’ve been building JobTrack Pro, our own job management app for maintenance teams, and it’s changed how we think about the workflows we build for clients.'],
    friendlyHook: 'A behind-the-scenes one from us at Nexai: what building our own job app has taught us.',
    ed: {
      intros: [
        'We’ve been building JobTrack Pro, our own job management app for maintenance teams, and it’s changed how we think about the workflows we build for clients.',
        'An honest update from inside Nexai: building JobTrack Pro ourselves has taught us more about maintenance workflows than any brief could.',
      ],
      prompted: 'What prompted it: we kept seeing the same gap between engineers on site and the office, so we started building something to close it ourselves.',
      problemLead: 'The everyday problem is familiar:',
      outcomeLead: 'What it’s taught us, and how it shapes the workflows we build for clients:',
      fixes: [
        'Capture evidence at the moment the work is done, not later from memory',
        'Make the next step obvious to whoever picks the job up',
        'Design out every step where someone re-types or chases information',
      ],
    },
    problem: null,
    impacts: [
      'Engineers re-entering details the office already has',
      'Jobs marked complete that still can’t be invoiced',
      'Nobody quite sure which version of the job is current',
    ],
    fixes: [
      'Capture evidence at the moment the work is done',
      'Make the next step obvious to whoever picks the job up',
      'Keep one version of the job that everyone trusts',
    ],
    ctas: ['What would you design out of your own job workflow first?'],
    hashtags: [['#CommercialMaintenance', '#FieldService', '#WorkflowDesign', '#BuildingInPublic', '#UKBusiness']],
    headlines: [['What building', 'JobTrack Pro taught us.'], ['Built for the gap', 'between site and office.']],
    sub: 'Lessons from building our own job app, applied to client workflows.',
    chip: 'Behind the scenes',
    scenes: ['office', 'plantroom', 'van'],
  },
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
    ed: {
      intros: [
        'We’ve been looking closely at why finished jobs sit unbilled, and it’s rarely about what happens on site.',
        'An honest one from inside Nexai: the job’s done, the client’s happy, and the invoice is still stuck.',
      ],
      prompted: 'What prompted it: conversations with maintenance teams where the work was finished but the office still couldn’t invoice it.',
      problemLead: 'The everyday problem looks like this:',
      outcomeLead: 'What we’re working towards is a handover where “complete” means ready to invoice:',
    },
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
    ed: {
      intros: [
        'A quick update from inside Nexai on something we keep running into.',
        'We spend a lot of our time on the gap between site and office. Here’s what we’re seeing.',
      ],
      prompted: 'What prompted it: the same small handover problems turning up in very different maintenance businesses.',
      problemLead: 'The everyday problem:',
      outcomeLead: 'What we’re working towards with the teams we build for:',
    },
    sub: 'Joined-up job management for UK commercial maintenance teams.',
    chip: 'Site → office',
    scenes: ['plantroom', 'van', 'office'],
  },
};

const themeFor = (brief) => (THEMES.building.match.test(brief) ? 'building' : THEMES.unbilled.match.test(brief) ? 'unbilled' : 'general');

// Direct-response promotion: used only when the brief explicitly asks for it (see voice.js).
const PROMO = {
  hooks: [
    'Losing hours between site and invoice? We’ll show you where.',
    'If jobs keep stalling between the engineer and the office, a free workflow review is the quickest way to find out why.',
  ],
  benefit: 'In a free workflow review we walk through how a job moves through your business, from booking to invoice, and point out where time and money leak out.',
  gets: ['A walk-through of your current workflow', 'The three steps worth fixing first', 'No obligation and no jargon'],
  headlines: [['Free workflow review.', 'Book your slot.'], ['Find the leaks', 'between site and invoice.']],
  sub: 'A free review of how your jobs move from booking to invoice.',
  chip: 'Free review',
};

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

function compose(theme, platform, opts, ctx = {}) {
  const { hookIdx = 0, ctaIdx = 0, tagIdx = 0, short = false, friendly = false, numberPrompt = false } = opts;
  const mode = ctx.mode || 'editorial';
  const tags = theme.hashtags[tagIdx % theme.hashtags.length];
  const isShort = short || platform === 'X';
  const noTags = platform === 'Google Business Profile'; // Google Business Profile posts don't use hashtags
  const tagLine = () => (platform === 'Instagram' ? [...tags, '#Engineering', '#BuildingServices'] : isShort ? tags.slice(0, 3) : tags).join(' ');
  const parts = [];
  if (mode === 'promo') {
    // Direct-response, this job only: service first, a concrete benefit, one clear call to action.
    parts.push(PROMO.hooks[hookIdx % PROMO.hooks.length]);
    if (!isShort) { parts.push(PROMO.benefit); parts.push(`What you get:\n${PROMO.gets.map((g) => `• ${g}`).join('\n')}`); }
    if (numberPrompt) parts.push('[Add your own figure here, e.g. how long a typical job takes from completion to invoice.]');
    parts.push(`${ctx.cta || 'Request a Free Workflow Review'}: send us a message or use the link in our profile to book your slot.`);
  } else {
    // Nexai's editorial voice: an honest update from inside Nexai, something useful, low pressure.
    const ed = theme.ed;
    const fixes = ed.fixes || theme.fixes;
    parts.push(friendly ? theme.friendlyHook : ed.intros[hookIdx % ed.intros.length]);
    if (isShort) parts.push(`One thing that helps: ${fixes[0].charAt(0).toLowerCase()}${fixes[0].slice(1)}.`);
    else {
      parts.push(ed.prompted);
      if (theme.problem) parts.push(theme.problem);
      parts.push(`${ed.problemLead}\n${theme.impacts.map((i) => `• ${i}`).join('\n')}`);
      if (numberPrompt) parts.push('[Add your own figure here, e.g. the value of work completed but not yet invoiced this month.]');
      parts.push(`${ed.outcomeLead}\n${fixes.map((f, i) => `${i + 1}. ${f}`).join('\n')}`);
      for (const w of ctx.wip || []) parts.push(`${w} is our own product and still a work in progress, so this is what we’re learning as we build, not a finished result we can point to yet.`);
    }
    // Vary the ending: invite a comment, invite a message, or end on the useful point.
    const end = variant(`${ctx.seed || ''}:${ctaIdx}`, 3);
    if (end === 0) parts.push('If you’re working through the same thing, tell us in the comments how you handle it.');
    else if (end === 1) parts.push('If any of this sounds familiar, send us a message. We’re always happy to compare notes.');
    else parts.push(`If you change one thing this month, make it this: ${fixes[0].charAt(0).toLowerCase()}${fixes[0].slice(1)}.`);
  }
  if (!noTags) parts.push(tagLine());
  return { text: parts.join('\n\n'), opts: { hookIdx, ctaIdx, tagIdx, short, friendly, numberPrompt } };
}

/** The tone and profile details a template needs: mode, CTA wording, and products mentioned without approved claims. */
function context(job, profile) {
  const mode = job.tone?.mode || toneFor(job.brief).mode;
  const wip = (profile?.proof || []).filter((p) => !p.claims?.trim() && norm(job.brief).includes(norm(p.name))).map((p) => p.name);
  return { mode, cta: profile?.cta?.main || '', wip, seed: job.id || job.brief };
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
  const it = catItem(job);
  if (it) {
    const ctx = context(job, profile);
    const composed = composeCatalogue(it, job.platform, {}, ctx);
    const applied = applyProfile(composed.text, job, profile, date);
    return { content: { text: applied.text, opts: composed.opts, audience: it.audience || audienceFrom(job.brief), offerId: applied.offerId, tone: ctx.mode }, notes: [`Drafted for ${it.audience || audienceFrom(job.brief)} on ${job.platform}`, catNote(job, it), 'Editorial voice: honest update → the everyday problem → the outcome we’re aiming for → a soft invitation'] };
  }
  const theme = THEMES[themeFor(job.brief)];
  const ctx = context(job, profile);
  const composed = compose(theme, job.platform, {}, ctx);
  const applied = applyProfile(composed.text, job, profile, date);
  return {
    content: { text: applied.text, opts: composed.opts, audience: audienceFrom(job.brief), offerId: applied.offerId, tone: ctx.mode },
    notes: [`Drafted for ${audienceFrom(job.brief)} on ${job.platform}`, ctx.mode === 'promo' ? 'Direct-response promotion (this job only): service → benefit → what you get → booking CTA' : 'Editorial voice: honest update → what prompted it → everyday problem → what we’re working towards → a useful ending', ...(profile ? ['Used the business profile (voice, offers, hashtag rule)'] : [])],
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
  if (/question|cta|call to action|ending|close/.test(f)) { o.ctaIdx = (o.ctaIdx || 0) + 1; notes.push('New ending'); }
  if (/stat|number|figure|data/.test(f)) { o.numberPrompt = true; notes.push('Added a placeholder for your own figure (no invented stats)'); }
  if (/hook|open|start|first line|punch/.test(f) || notes.length === 0) {
    o.friendly = false;
    o.hookIdx = (o.hookIdx || 0) + 1;
    notes.push('Rewrote the opening line');
  }
  const it = catItem(job);
  const { text, opts } = it ? composeCatalogue(it, job.platform, o, context(job, profile)) : compose(theme, job.platform, o, context(job, profile));
  const applied = applyProfile(text, job, profile, date, prev.offerId || null);
  return { content: { ...prev, text: applied.text, opts, offerId: applied.offerId }, notes: [`v${n}: ${notes.join('; ')}`] };
}

export function draftGraphic(job, profile = null) {
  const it = catItem(job);
  if (it) {
    const base = THEMES.general;
    return {
      content: {
        theme: 'general', scene: it.kind === 'service' ? 'plantroom' : 'office',
        headline: it.headline?.length ? it.headline : base.headlines[0], sub: firstSentence(it.wording, 90),
        chip: STATUS[it.status], tone: 'editorial', accent: 'cyan', logoScale: 1, platform: job.platform,
      },
      notes: [`Graphic from the approved public wording (${it.name ? it.name : 'described without naming'}); status chip: ${STATUS[it.status]}`],
    };
  }
  // A post without its own template gets a headline from its own brief, never a fixed one from another topic.
  if (themeFor(job.brief) === 'general' && !/promo/.test(context(job, profile).mode || '')) {
    const h = proposeConcept({ brief: job.brief, caption: null }).headline.replace(/\.$/, '');
    const cut = h.split(' ');
    const half = Math.ceil(cut.length / 2);
    return { content: { theme: 'general', scene: 'office', headline: [cut.slice(0, half).join(' '), `${cut.slice(half).join(' ')}.`].filter((x) => x && x !== '.'), sub: '', chip: 'Nexai', tone: 'editorial', accent: 'cyan', logoScale: 1, platform: job.platform }, notes: ['Simulated graphic; headline from this post’s brief'] };
  }
  const key = themeFor(job.brief);
  const theme = THEMES[key];
  const promo = (job.tone?.mode || toneFor(job.brief).mode) === 'promo';
  return {
    content: {
      theme: key,
      scene: theme.scenes[0],
      headline: promo ? PROMO.headlines[0] : theme.headlines[0],
      sub: promo ? PROMO.sub : theme.sub,
      chip: promo ? PROMO.chip : theme.chip,
      tone: promo ? 'promo' : 'editorial',
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
