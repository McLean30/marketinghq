// Nexai's service catalogue: the owner-editable list of services, product families and modules in the business
// profile (profile.data.catalogue). Shared by the browser, the HQ server and the tests.
//
// Two rules hold everywhere:
//   1. Agents that write public content (Vektor, Quill, Prism, Cue) only ever receive the public context for the job
//      in hand (contextFor): approved wording, audience, problem, outcome and status for the items the brief is about,
//      never internal notes, internal names or items marked internal.
//   2. Calibre sees the whole catalogue (disclosureFindings) so it can flag an internal name, a price or commercial
//      term, or an unlaunched item presented as available.
import { norm } from './profile.js';

export const KINDS = { service: 'Service', family: 'Product family', module: 'Module' };
export const STATUS = { available: 'Available', in_development: 'In development', planned: 'Planned' };
export const DISCLOSURE = {
  name: 'Agents may name it publicly',
  describe: 'Describe it without naming it',
  internal: 'Keep it internal',
};
export const CORE_AUDIENCE = 'UK commercial building maintenance and building services firms, particularly owners, MDs and operations directors';

/**
 * The starting catalogue. Existing services (the owner's names and descriptions) are carried over as they are.
 * Topics are deliberately about the offering itself ("custom software"), not everyday problems ("job sheets"), so an
 * ordinary problem-led post isn't turned into a service description. The owner can add topics in the profile.
 */
export function seedCatalogue(services = []) {
  const find = (id, name) => services.find((s) => s.id === id) || services.find((s) => norm(s.name) === norm(name));
  const svc = (id, name, fallback, extra) => {
    const s = find(id, name);
    return { id, kind: 'service', name: s?.name || name, status: 'available', disclosure: 'name', audience: CORE_AUDIENCE, publicWording: s?.description || fallback, internalNotes: '', ...extra };
  };
  const items = [
    svc('svc_web', 'Professional Websites', 'Fast, clear websites for commercial maintenance and building services firms that explain what you do and make it easy for facilities and property managers to get in touch.', {
      problem: 'Facilities and property managers judge a maintenance firm by its website, and many sites don’t explain what the firm does or make it easy to get in touch.',
      outcome: 'A clear website that explains what you do and makes it easy for the right clients to get in touch.',
      topics: ['website', 'web site', 'web design'],
      headline: ['Clear websites', 'for maintenance firms.'], visual: 'A maintenance firm’s website open on a laptop in a site office, engineer’s van visible through the window.',
    }),
    svc('svc_software', 'Custom Business Software', 'Software built around how your engineers and office actually work: job management, job sheets, photos, sign-off and invoicing in one place.', {
      problem: 'Jobs, job sheets, photos, sign-off and invoicing live in different places, so the office chases engineers for information they’ve already captured.',
      outcome: 'One system built around how your engineers and office actually work.',
      topics: ['custom software', 'business software', 'bespoke software', 'job management software', 'software we build'],
      headline: ['One job.', 'One version of the truth.'], visual: 'Engineer closing a job on a tablet beside completed plant in a UK plant room.',
    }),
    svc('svc_ai', 'Bespoke AI Agents & Automation', 'AI agents and automations that take repetitive admin off your office team, such as chasing paperwork, preparing reports and keeping clients updated.', {
      problem: 'Office teams spend hours on repetitive admin: chasing paperwork, preparing reports and keeping clients updated.',
      outcome: 'Agents and automations that take that admin off the team, so people spend their time on the work only they can do.',
      topics: ['ai agent', 'ai agents', 'automation', 'automations', 'automate'],
      headline: ['Less admin.', 'More of the work that matters.'], visual: 'Maintenance office coordinator at a desk with reports and job updates on screen, calm and organised.',
    }),
  ];
  // Any other service the owner had added is kept as it is.
  for (const s of services) {
    if (!items.some((x) => x.id === s.id || norm(x.name) === norm(s.name))) items.push({ id: s.id || `svc_${Math.random().toString(36).slice(2, 8)}`, kind: 'service', name: s.name, status: 'available', disclosure: 'name', audience: CORE_AUDIENCE, problem: '', outcome: '', publicWording: s.description || '', internalNotes: '', topics: [], headline: [], visual: '' });
  }
  items.push(
    {
      id: 'fam_revenue', kind: 'family', name: 'Nexai Revenue Recovery', status: 'in_development', disclosure: 'internal',
      audience: 'Local SMEs that already hold customer data', problem: 'Revenue left behind in past customers, open quotes and missed enquiries.',
      outcome: 'Recover revenue from contacts a business already has.', publicWording: '',
      internalNotes: 'Product family name. Keep internal until approved for public use.', topics: ['revenue recovery'], headline: [], visual: '',
    },
    {
      id: 'mod_reactivation', kind: 'module', family: 'fam_revenue', name: 'Database Reactivation', status: 'in_development', disclosure: 'describe',
      audience: 'Local SMEs across sectors with an existing customer database',
      problem: 'Customers who were happy with the work often never hear from the business again, so repeat work and referrals go to whoever got in touch last.',
      outcome: 'A simple, respectful way to reconnect with past customers and turn some of those relationships into repeat work.',
      publicWording: 'We’re building a way for businesses to reconnect with past customers they already have on their books, so good relationships don’t quietly go cold.',
      internalNotes: 'First build, in development. Proposed commercial model (not approved for public use): no upfront development fee; the client covers running costs plus a commission on sales it generates. Client contact lists stay in the client’s own systems, never in Marketing HQ.',
      topics: ['past customer', 'previous customer', 'former customer', 'lapsed customer', 'customer database', 'customer list', 'reactivat', 'win back'],
      headline: ['Past customers,', 'back in touch.'], visual: 'Owner of a small UK business at their desk, looking back through past jobs and customer notes on a laptop; warm, natural light.',
    },
    {
      id: 'mod_quotes', kind: 'module', family: 'fam_revenue', name: 'Quote Recovery', status: 'planned', disclosure: 'internal',
      audience: 'Local SMEs that send quotes', problem: 'Quotes go out and are never followed up, so work the business could have won goes quiet.',
      outcome: 'Follow up outstanding quotes so fewer go cold.', publicWording: '', internalNotes: 'Planned. Keep internal until approved.',
      topics: ['outstanding quote', 'open quote', 'quote follow', 'unanswered quote', 'quotes that go cold'], headline: [], visual: '',
    },
    {
      id: 'mod_enquiries', kind: 'module', family: 'fam_revenue', name: 'Enquiry Capture', status: 'planned', disclosure: 'internal',
      audience: 'Local SMEs that receive enquiries', problem: 'New enquiries slip through when the team is busy on site.',
      outcome: 'Capture and follow up every new enquiry promptly.', publicWording: '', internalNotes: 'Planned. Keep internal until approved.',
      topics: ['new enquir', 'missed enquir', 'missed call', 'enquiry capture', 'enquiries go'], headline: [], visual: '',
    },
  );
  return { items };
}

/**
 * Profiles saved before the catalogue existed: add it as a new version, carrying over the owner's services exactly
 * as they are. Every other field is left untouched. Returns the new data, or null if there's nothing to add.
 */
export function upgradeProfile(data) {
  if (!data || data.catalogue) return null;
  const next = JSON.parse(JSON.stringify(data));
  next.catalogue = seedCatalogue(next.services || []);
  return next;
}

/** Keep the profile's plain service list (used by older screens and checks) in step with the catalogue. */
export function syncServices(data) {
  if (!data?.catalogue) return data;
  data.services = data.catalogue.items.filter((i) => i.kind === 'service').map((i) => ({ id: i.id, name: i.name, description: i.publicWording }));
  return data;
}

/**
 * What generation may see of the profile: everything except the catalogue, with the service list limited to services
 * that are available and may be named. Internal notes never leave HQ's own screens and Calibre's checks.
 */
export function forGeneration(data) {
  if (!data) return data;
  const out = JSON.parse(JSON.stringify(data));
  if (out.catalogue) {
    out.services = out.catalogue.items.filter((i) => i.kind === 'service' && i.status === 'available' && i.disclosure === 'name').map((i) => ({ id: i.id, name: i.name, description: i.publicWording }));
    delete out.catalogue;
  }
  return out;
}

const items = (data) => data?.catalogue?.items || [];
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whole words for short topics ("ai"), word starts for longer stems ("reactivat", "enquir"); names as phrases. */
const topicRe = (t) => new RegExp(`\\b${esc(norm(t))}${norm(t).length <= 3 ? '\\b' : ''}`, 'i');
/** Where the brief first mentions an item (-1 if it doesn't), so a brief about two things keeps its own order. */
const firstMention = (text, item) => {
  const t = norm(text);
  const at = [...(item.topics || []).filter(Boolean).map((x) => t.search(topicRe(x))), item.name ? t.indexOf(norm(item.name)) : -1].filter((i) => i >= 0);
  return at.length ? Math.min(...at) : -1;
};
const mentions = (text, item) => (item.topics || []).some((t) => t && topicRe(t).test(norm(text))) || (!!item.name && norm(text).includes(norm(item.name)));

/**
 * The public context for one post, decided from its brief when the post is created and kept with it, so an approved
 * post keeps the wording it was written with. Only items the brief is about, and only what may be said publicly.
 * Returns { profileVersion, items: [...], left: [{ id, why }] }.
 */
export function contextFor(data, brief, { profileVersion = null } = {}) {
  const chosen = [];
  const left = [];
  const ordered = items(data).map((it) => [it, firstMention(brief || '', it)]).filter(([, at]) => at >= 0).sort((a, b) => a[1] - b[1]).map(([it]) => it);
  for (const it of ordered) {
    if (it.disclosure === 'internal' || it.kind === 'family' && it.disclosure !== 'name') { left.push({ id: it.id, why: 'internal' }); continue; }
    if (!it.publicWording?.trim()) { left.push({ id: it.id, why: 'no approved public wording yet' }); continue; }
    chosen.push({
      id: it.id, kind: it.kind, status: it.status, disclosure: it.disclosure,
      name: it.disclosure === 'name' ? it.name : null,
      wording: it.publicWording.trim(), audience: it.audience || '', problem: it.problem || '', outcome: it.outcome || '',
      headline: Array.isArray(it.headline) ? it.headline.filter(Boolean).slice(0, 2) : [], visual: it.visual || '',
    });
  }
  return { profileVersion, items: chosen.slice(0, 3), left };
}

const statusPhrase = (s) => (s === 'available' ? 'available now' : s === 'in_development' ? 'in development: present it as work in progress, never as available, and claim no results' : 'planned: present it as an idea we’re exploring, not something available');

/** The context block for an AI prompt (only what contextFor allowed). */
export function contextText(ctx) {
  if (!ctx?.items?.length) return 'Nexai services and products for this post: none specifically. Don’t mention any Nexai product, product family, module, price or commercial terms the brief doesn’t ask for.';
  const lines = ctx.items.map((i) => [
    `- ${i.name ? `Name: ${i.name}` : 'Name: do NOT name it; describe it in plain words'}`,
    `  Status: ${statusPhrase(i.status)}`,
    `  Approved public wording: "${i.wording}"`,
    i.audience ? `  Audience: ${i.audience}` : '',
    i.problem ? `  Everyday problem: ${i.problem}` : '',
    i.outcome ? `  Outcome we’re aiming for: ${i.outcome}` : '',
  ].filter(Boolean).join('\n'));
  return `Nexai services and products for this post (approved public information only):\n${lines.join('\n')}\nRules: use only this information about Nexai’s offering. Don’t mention any other Nexai product, product family, module, internal name, price, fee or commercial terms. Don’t claim results, customers or figures.`;
}

/* ---------- Calibre's disclosure checks ---------- */
const AVAILABLE_NOW = /\b(now available|available now|available today|out now|now live|live now|launch(?:ed|ing) (?:today|this week|now)|sign up (?:now|today)|get started today|start using|try it (?:now|today)|order (?:now|today)|buy (?:now|today)|is ready (?:for you|to use)|ready to use today)\b/i;
const COMMERCIAL = /\b(commission|no upfront|upfront (?:development )?(?:fee|cost)|development fee|running costs?|subscription fee|pricing|per month|a month|monthly fee|price(?:d)? (?:at|from))\b|£\s?\d/i;
const RESULTS = /\b(our clients? (?:have )?(?:seen|got|recovered|won|made)|recovered £?\d|brought back \d+|\d+\s?% (?:more|of) (?:sales|customers|revenue)|proven results?|guaranteed (?:sales|results|revenue))\b/i;

/**
 * Disclosure findings for a draft (caption plus any on-image text): internal names, prices or commercial terms,
 * unlaunched items presented as available, and results claims. Each: { kind, title, quote, why, fix }.
 */
export function disclosureFindings(text, data, { offers = [] } = {}) {
  const out = [];
  const t = String(text || '');
  const lineWith = (re) => t.split('\n').find((l) => (typeof re === 'string' ? norm(l).includes(norm(re)) : re.test(l))) || '';
  for (const it of items(data)) {
    if (it.name && it.disclosure !== 'name' && norm(t).includes(norm(it.name))) {
      out.push({ kind: 'internal-name', title: `Internal name in the draft: “${it.name}”`, quote: lineWith(it.name), why: it.disclosure === 'internal' ? `“${it.name}” is marked internal in the business profile, so it mustn’t appear in public content yet.` : `“${it.name}” may be described but not named publicly (business profile).`, fix: it.disclosure === 'internal' ? `Remove “${it.name}” and anything specific to it.` : `Replace “${it.name}” with a plain description, for example: ${it.publicWording || 'what it does, in a sentence'}` });
    }
  }
  const offerText = offers.map((o) => norm(o.wording || '')).join(' ');
  const price = t.split('\n').find((l) => COMMERCIAL.test(l) && !(offerText && offerText.includes(norm(l))));
  if (price) out.push({ kind: 'commercial', title: 'Price or commercial terms in the draft', quote: price, why: 'Prices, fees and commercial models are internal in the business profile unless they’re an approved offer.', fix: 'Remove the price or commercial terms.' });
  if (AVAILABLE_NOW.test(t)) {
    const unlaunched = items(data).filter((i) => i.status !== 'available' && mentions(t, i));
    if (unlaunched.length) out.push({ kind: 'unlaunched', title: 'Presents something unlaunched as available', quote: lineWith(AVAILABLE_NOW), why: `The draft is about ${unlaunched.map((i) => (i.disclosure === 'name' ? i.name : 'work that’s still ' + STATUS[i.status].toLowerCase())).join(', ')}, which isn’t available yet, but it reads as if it is.`, fix: 'Describe it as work in progress (what we’re building and why), not as something people can use now.' });
  }
  const res = t.split('\n').find((l) => RESULTS.test(l));
  if (res) out.push({ kind: 'results', title: 'Results claim with nothing approved to back it', quote: res, why: 'The business profile has no approved results for this. In-development work has no results to point to yet.', fix: 'Remove the claim, or describe the outcome we’re aiming for instead.' });
  return out;
}

/** Posts whose recorded public context changed in a newer profile version (for the "posts to review" list). */
export function catalogueImpact(job, curData) {
  const ctx = job?.catalogue;
  if (!ctx?.items?.length) return [];
  const out = [];
  for (const used of ctx.items) {
    const now = items(curData).find((i) => i.id === used.id);
    if (!now) out.push({ field: 'Services and products', text: 'A service or product this post describes was removed from the profile.' });
    else if (now.disclosure === 'internal') out.push({ field: 'Services and products', text: `Something this post describes is now marked internal (${now.name}).` });
    else if ((now.publicWording || '').trim() !== used.wording) out.push({ field: 'Services and products', text: `The approved public wording for ${now.disclosure === 'name' ? now.name : 'something this post describes'} changed. This post keeps the wording it was written with.` });
    else if (now.status !== used.status) out.push({ field: 'Services and products', text: `The delivery status of ${now.disclosure === 'name' ? now.name : 'something this post describes'} changed to ${STATUS[now.status].toLowerCase()}.` });
  }
  return out;
}

/** Which catalogue records changed between two profile versions (names, for the saved-version summary). */
export function changedItems(a, b) {
  const before = new Map(items(a).map((i) => [i.id, JSON.stringify(i)]));
  const after = items(b);
  const out = after.filter((i) => before.get(i.id) !== JSON.stringify(i)).map((i) => i.name || i.id);
  for (const [id] of before) if (!after.some((i) => i.id === id)) out.push(`${id} (removed)`);
  return out;
}

/** Light validation for saving (server and browser). Returns an error message or null. */
export function validateCatalogue(c) {
  if (c === undefined) return null;
  if (!c || !Array.isArray(c.items) || c.items.length > 60) return 'catalogue';
  for (const i of c.items) {
    if (!i || typeof i.id !== 'string' || !/^[a-z]+_[a-z0-9_]{2,40}$/.test(i.id)) return 'catalogue item id';
    if (!KINDS[i.kind] || !STATUS[i.status] || !DISCLOSURE[i.disclosure]) return 'catalogue item kind, status or disclosure';
    for (const k of ['name', 'audience', 'problem', 'outcome', 'publicWording', 'internalNotes', 'visual']) if (i[k] != null && (typeof i[k] !== 'string' || i[k].length > 4000)) return `catalogue item ${k}`;
  }
  return null;
}
