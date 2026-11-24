import { contextFor } from './catalogue.js';
// Vektor's weekly planning: Europe/London dates, Nexai's posting schedule and the template planner.
// Dates are calendar dates (YYYY-MM-DD); arithmetic is done on whole days in UTC so clock changes
// (BST <-> GMT) can never shift a post to the wrong day.

export const SCHEDULE = [
  { offset: 0, dayName: 'Monday', platform: 'LinkedIn' },
  { offset: 1, dayName: 'Tuesday', platform: 'Facebook' },
  { offset: 2, dayName: 'Wednesday', platform: 'Google Business Profile' },
  { offset: 3, dayName: 'Thursday', platform: 'Facebook' },
  { offset: 4, dayName: 'Friday', platform: 'LinkedIn' },
];

const pad = (n) => String(n).padStart(2, '0');
const toIso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const fromIso = (iso) => new Date(`${iso}T00:00:00Z`);

/** Today's date in Europe/London, whatever the device's own time zone. */
export function londonToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function addDays(iso, n) {
  const d = fromIso(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toIso(d);
}

export const isMonday = (iso) => /^\d{4}-\d{2}-\d{2}$/.test(iso || '') && fromIso(iso).getUTCDay() === 1;

/** The next Monday in Europe/London (today if it is Monday). */
export function nextMonday(now = new Date()) {
  const today = londonToday(now);
  const dow = fromIso(today).getUTCDay();
  return addDays(today, (8 - dow) % 7);
}

export const weekDays = (weekStart) => SCHEDULE.map((s) => ({ ...s, date: addDays(weekStart, s.offset) }));

export const fmtLong = (iso) => fromIso(iso).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
export const fmtWeek = (iso) => `Week beginning ${fromIso(iso).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' })}`;

/* ---------- Template planner (no AI): deterministic, labelled "Template plan" ---------- */
function topicsFrom(brief) {
  const m = /cover\s+([^.]+)/i.exec(brief);
  if (!m) return [];
  return m[1].split(/,\s*|\s+and\s+/i).map((t) => t.trim().replace(/^the\s+/i, '')).filter((t) => t.length > 2).slice(0, 3);
}
function audienceFrom(brief, profile) {
  const m = /for\s+((?:uk\s+)?[a-z&\s-]*?(?:directors|managers|owners|leaders|teams))/i.exec(brief);
  if (m) return m[1].trim().replace(/^uk/i, 'UK');
  if (profile?.audience?.buyers) return `${profile.audience.buyers} at ${profile.audience.summary}`;
  return 'UK commercial maintenance leaders';
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const TOPIC_LIBRARY = [
  { match: /photo/i, angle: (t) => `${cap(t)} are the quiet reason finished work waits to be invoiced`, takeaway: 'Make before and after photos a required step before a job can be closed', visual: 'Engineer photographing completed work on a plant room or rooftop unit, phone in hand.', check: 'photos attached' },
  { match: /job sheet|paperwork|report/i, angle: (t) => `What “complete” should mean when ${t} reach the office`, takeaway: 'Use a short job sheet checklist: work done, parts used, time on site, photos, signature', visual: 'Clipboard or tablet job sheet on a service van bonnet outside a commercial building.', check: 'job sheet complete' },
  { match: /sign.?off|signature|approval/i, angle: (t) => `${cap(t)} turns a finished job into a week-long wait`, takeaway: 'Capture the client’s sign-off on site, on the engineer’s device, before leaving', visual: 'Facilities manager signing on an engineer’s tablet in a building reception or plant room.', check: 'client sign-off captured' },
];
const GENERIC_TOPICS = [
  { angle: (t) => `${cap(t)}: the small gap that holds up the whole job`, takeaway: 'Name one owner for closing this gap and review it weekly', visual: 'Engineer and office coordinator reviewing a job on a tablet.' },
];

/**
 * Build an editable plan for the week. Monday frames the problem, Tuesday to Thursday take one topic each,
 * Friday pulls it together. Wednesday (Google Business Profile) is written for local clients.
 */
export function templatePlan(brief, weekStart, profile = null) {
  const audience = audienceFrom(brief, profile);
  // A week about a catalogue item uses only its approved public information (catalogue.js contextFor).
  const ctxItems = contextFor(profile, brief).items;
  const it = ctxItems[0] || null;
  const it2 = ctxItems[1] || it;
  // Visual briefs follow the profile's imagery and logo rules.
  const visualRule = profile?.brand ? ' Realistic UK commercial setting, no stock-photo clichés; official Nexai logo.' : '';
  const topics = topicsFrom(brief);
  while (topics.length < 3) topics.push(['missing paperwork', 'late client sign-off', 'unclear handovers'][topics.length]);
  const topicDay = (t) => {
    const lib = TOPIC_LIBRARY.find((x) => x.match.test(t)) || GENERIC_TOPICS[0];
    return { angle: lib.angle(t), takeaway: lib.takeaway, visual: lib.visual };
  };
  const days = weekDays(weekStart).map((d, i) => {
    let item;
    if (it && (i === 0 || i === 4)) item = i === 0
      ? { audience: it.audience || audience, angle: `What we’re ${it.status === 'available' ? 'doing' : 'building'} and why: ${it.problem || it.wording}`, takeaway: it.outcome || it.wording, visual: it.visual || 'Founder at a desk, talking through what we’re building; natural light.' }
      : { audience: it2.audience || audience, angle: it2.status === 'available' ? `How it works in practice: ${it2.wording}` : `Where we’re heading (work in progress): ${it2.outcome || it2.wording}`, takeaway: it2.status === 'available' ? (it2.outcome || '') : 'A useful question to ask about your own business this week; no results claimed', visual: it2.visual || 'Founder at a desk, talking through what we’re building; natural light.' };
    else if (i === 0) item = { audience, angle: 'Finished jobs that can’t be invoiced yet are cash you’ve already earned, stuck in admin', takeaway: 'Pull a “complete but not invoiced” list every Monday and set a 48-hour target to clear it', visual: 'Engineer finishing a job on a UK commercial site at the end of the day, van in the background.' };
    else if (i === 4) item = { audience, angle: 'Three checks that turn “job done” into “ready to invoice”', takeaway: `Before a job is marked complete, check: ${topics.slice(0, 3).map((t) => (TOPIC_LIBRARY.find((x) => x.match.test(t))?.check || t)).join(', ')}`, visual: 'Engineer closing a job on a tablet beside completed plant, natural light.' };
    else {
      const t = topicDay(topics[i - 1]);
      item = { audience: i === 2 ? 'Local facilities managers and clients' : audience, ...t };
    }
    return { ...d, ...item, visual: `${item.visual}${visualRule}`, include: true, jobId: null };
  });
  return days;
}
