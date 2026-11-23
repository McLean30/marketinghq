// Vantage, the Marketing Analyst. Pure, rules-based analysis of results you enter for published demo posts.
// No AI and no live connections: figures come from you (or the clearly labelled sample posts below).
//
// A measurement is a cumulative snapshot of one published post taken on one date:
//   { id, n, pubId, copyVersion, graphicVersion, platform, publishedOn, measuredOn, windowDays,
//     impressions, clicks, enquiries,   // a whole number, or null = not available / not entered (never 0)
//     source: 'owner' | 'sample', enteredAt, by }
// A later measurement of the same post is a new snapshot; earlier ones stay in the history.
import { londonParts } from './publishing.js';

export const METRICS = [
  { key: 'impressions', label: 'Impressions' },
  { key: 'clicks', label: 'Link clicks' },
  { key: 'enquiries', label: 'Owner-attributed enquiries' },
];
export const WINDOWS = [1, 3, 7, 14, 28];
export const DEFAULT_WINDOW = 7;
export const MIN_POSTS = 3; // fewer comparable posts than this on a platform: too little evidence for a conclusion

const DAY = 86400000;
const toDay = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
export const daysBetween = (a, b) => Math.round((toDay(b) - toDay(a)) / DAY);
export const addDays = (iso, n) => new Date(toDay(iso) + n * DAY).toISOString().slice(0, 10);
export const mondayOf = (iso) => addDays(iso, -((new Date(toDay(iso)).getUTCDay() + 6) % 7));
export const fmtDay = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
export const fmtNum = (n) => (n == null ? '—' : Number(n).toLocaleString('en-GB'));
export const fmtPct = (x) => (x == null ? '—' : `${(x * 100).toFixed(1)}%`);

/** The publication whose versions the results belong to (the post that actually went out). */
export const publishedPub = (job) => (job.publications || []).filter((p) => p.status === 'published').at(-1) || null;
export const publishedOn = (job) => { const p = publishedPub(job); return p ? londonParts(p.publishedAt || p.scheduledFor).date : null; };
export const measurements = (job) => (job.measurements || []).slice().sort((a, b) => (a.measuredOn === b.measuredOn ? a.n - b.n : a.measuredOn < b.measuredOn ? -1 : 1));
export const latestMeasurement = (job) => measurements(job).at(-1) || null;

/** Latest known total per metric, each with the date it was measured (a blank in a newer snapshot keeps the older figure). */
export function latestTotals(job) {
  const out = {};
  for (const m of measurements(job)) for (const { key } of METRICS) if (m[key] != null) out[key] = { value: m[key], measuredOn: m.measuredOn, windowDays: m.windowDays, source: m.source };
  return out;
}

/** Click-through rate for one snapshot: link clicks ÷ impressions, only when both are known and impressions > 0. */
export function ctr(m) {
  if (!m) return { value: null, why: 'no measurement' };
  if (m.clicks == null) return { value: null, why: 'link clicks not entered' };
  if (m.impressions == null) return { value: null, why: 'impressions not entered' };
  if (!(m.impressions > 0)) return { value: null, why: 'impressions are 0' };
  return { value: m.clicks / m.impressions, formula: `${fmtNum(m.clicks)} ÷ ${fmtNum(m.impressions)}` };
}

/**
 * Check a new measurement against the post's history. Values: whole number or null (blank = unknown).
 * Cumulative totals can't fall: a lower figure than an earlier snapshot is refused with the reason.
 */
export function validateMeasurement(job, { measuredOn, impressions, clicks, enquiries }, today) {
  const pub = publishedPub(job);
  if (!pub) return { error: 'Results can only be recorded for a post that has been published (demo).' };
  const pOn = publishedOn(job);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(measuredOn || '')) return { error: 'Choose the date the figures were measured.' };
  if (measuredOn < pOn) return { error: `The post was published on ${fmtDay(pOn)}, so figures can’t be measured before then.` };
  if (measuredOn > today) return { error: 'The measurement date can’t be in the future.' };
  const vals = { impressions, clicks, enquiries };
  for (const { key, label } of METRICS) {
    const v = vals[key];
    if (v != null && (!Number.isInteger(v) || v < 0)) return { error: `${label} must be a whole number of 0 or more, or left blank.` };
  }
  if (METRICS.every(({ key }) => vals[key] == null)) return { error: 'Enter at least one figure. Leave the others blank if you don’t have them.' };
  if (vals.clicks != null && vals.impressions != null && vals.clicks > vals.impressions) return { error: 'Link clicks can’t be more than impressions in the same measurement.' };
  for (const m of measurements(job)) {
    if (m.measuredOn > measuredOn) continue;
    for (const { key, label } of METRICS) {
      if (vals[key] != null && m[key] != null && vals[key] < m[key]) return { error: `${label} were ${fmtNum(m[key])} on ${fmtDay(m.measuredOn)}. These are running totals, so they can’t go down. Check the figure, or enter it with the date it was actually measured.` };
    }
  }
  return { ok: true, publishedOn: pOn, windowDays: daysBetween(pOn, measuredOn), pub };
}

/** One row per published post, using the snapshot taken `window` days after publishing ('latest' = newest snapshot). */
export function comparisonRows(jobs, { platform = 'All', from = '', to = '', posts = 'all', window = DEFAULT_WINDOW } = {}) {
  const rows = [];
  const excluded = [];
  for (const job of jobs) {
    if (!publishedPub(job)) continue;
    if (posts === 'mine' && job.sample) continue;
    if (posts === 'sample' && !job.sample) continue;
    if (platform !== 'All' && job.platform !== platform) continue;
    const pOn = publishedOn(job);
    if ((from && pOn < from) || (to && pOn > to)) continue;
    const ms = measurements(job);
    let m;
    if (window === 'latest') m = ms.at(-1);
    else m = ms.filter((x) => x.windowDays === window).at(-1);
    if (!m) {
      excluded.push({ job, publishedOn: pOn, why: ms.length ? `no ${window}-day measurement (has ${[...new Set(ms.map((x) => `day ${x.windowDays}`))].join(', ')})` : 'no results entered yet' });
      continue;
    }
    rows.push({ job, m, publishedOn: pOn, ctr: ctr(m) });
  }
  return { rows, excluded };
}

const name = (r) => `“${r.job.title || r.job.brief.slice(0, 60)}”`;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/**
 * Rules-based observations, each with the figures behind it. Compares only posts on the same platform measured over
 * the same window. Never declares an overall winner from fewer than MIN_POSTS posts.
 */
export function observations(rows, { window = DEFAULT_WINDOW } = {}) {
  const out = [];
  const byPlatform = {};
  for (const r of rows) (byPlatform[r.job.platform] ||= []).push(r);
  for (const [platform, rs] of Object.entries(byPlatform)) {
    const comparable = window !== 'latest';
    const scope = `${platform}, ${comparable ? `${window}-day figures` : 'latest figures (measurement days differ, not comparable)'}`;
    if (rs.length < 2) { out.push({ kind: 'thin', platform, text: `${platform}: only one post with ${comparable ? `${window}-day` : ''} figures, so there’s nothing to compare it with yet.`, figures: [] }); continue; }
    const withCtr = rs.filter((r) => r.ctr.value != null).sort((a, b) => b.ctr.value - a.ctr.value);
    if (comparable && withCtr.length >= 2) {
      const [hi, ...rest] = withCtr;
      const tie = rest[0].ctr.value === hi.ctr.value;
      out.push({ kind: 'ctr', platform, text: tie ? `${platform}: equal click-through.` : `${platform}: ${name(hi)} had the highest click-through, ${fmtPct(hi.ctr.value)}${rest.length === 1 ? ` against ${fmtPct(rest[0].ctr.value)} for ${name(rest[0])}` : ''}.`,
        figures: withCtr.map((r) => `${name(r)}: ${r.ctr.formula} = ${fmtPct(r.ctr.value)}`), scope, leader: hi.job.id });
    }
    const withClicks = rs.filter((r) => r.m.clicks != null).sort((a, b) => b.m.clicks - a.m.clicks);
    if (withClicks.length >= 2 && withClicks[0].m.clicks !== withClicks[1].m.clicks) {
      const top = withClicks[0];
      const ctrLeader = withCtr[0];
      const differs = ctrLeader && ctrLeader.job.id !== top.job.id;
      out.push({ kind: 'clicks', platform, text: `${platform}: ${name(top)} had the most link clicks in total (${fmtNum(top.m.clicks)})${differs && top.m.impressions != null && ctrLeader.m.impressions != null ? `, from ${top.m.impressions > ctrLeader.m.impressions ? 'more' : 'fewer'} impressions (${fmtNum(top.m.impressions)} against ${fmtNum(ctrLeader.m.impressions)})` : ''}.`,
        figures: withClicks.map((r) => `${name(r)}: ${fmtNum(r.m.clicks)} link clicks, ${fmtNum(r.m.impressions)} impressions`), scope, leader: top.job.id });
    }
    const known = rs.filter((r) => r.m.enquiries != null);
    const unknown = rs.filter((r) => r.m.enquiries == null);
    out.push({ kind: 'enquiries', platform, text: unknown.length
      ? `${platform}: enquiries are known for ${known.length} of ${rs.length} posts. ${unknown.map(name).join(', ')}: not entered, so unknown (not zero). Enquiries can’t be compared yet.`
      : `${platform}: enquiries recorded for all ${rs.length} posts.`,
      figures: rs.map((r) => `${name(r)}: ${r.m.enquiries == null ? 'not entered' : `${fmtNum(r.m.enquiries)} owner-attributed`}`), scope });
    if (rs.length < MIN_POSTS || !comparable) {
      out.push({ kind: 'evidence', platform, text: `Too little evidence for a conclusion: ${!comparable ? 'these figures were measured on different days after publishing' : `${plural(rs.length, 'post')} on ${platform} with ${window}-day figures`}. A difference this size can come from the day, the timing or who happened to see it. Treat it as a hint to test, not a winner.`, figures: [] });
    }
  }
  return out;
}

/** One suggested test for Vektor, with the reason and how strong the evidence is. Rules-based. */
export function suggestTest(rows, { window = DEFAULT_WINDOW } = {}) {
  const byPlatform = {};
  for (const r of rows) if (r.ctr.value != null) (byPlatform[r.job.platform] ||= []).push(r);
  const candidates = Object.entries(byPlatform).filter(([, rs]) => rs.length >= 2).sort((a, b) => b[1].length - a[1].length);
  if (window === 'latest' || !candidates.length) {
    return { kind: 'measure', title: 'Measure before testing', evidence: 'none',
      why: window === 'latest' ? 'Latest figures were measured on different days after publishing, so they can’t be compared fairly. Choose a fixed window (for example 7 days).' : `There aren’t two posts on the same platform with impressions and link clicks measured ${window} days after publishing yet.`,
      brief: '' };
  }
  const [platform, rs] = candidates[0];
  const byCtr = rs.slice().sort((a, b) => b.ctr.value - a.ctr.value);
  const hi = byCtr[0];
  const lo = byCtr[byCtr.length - 1];
  const mostClicks = rs.slice().sort((a, b) => b.m.clicks - a.m.clicks)[0];
  const topic = (r) => r.job.title || r.job.brief.slice(0, 60);
  const enquiriesUnknown = rs.filter((r) => r.m.enquiries == null);
  const evidence = rs.length < MIN_POSTS ? 'low' : 'some';
  const why = [
    `${name(hi)} had the higher click-through (${fmtPct(hi.ctr.value)}, ${hi.ctr.formula}) and ${name(lo)} the lower (${fmtPct(lo.ctr.value)}, ${lo.ctr.formula}).`,
    mostClicks.job.id !== hi.job.id ? `But ${name(mostClicks)} reached more people and got more link clicks in total (${fmtNum(mostClicks.m.clicks)} against ${fmtNum(hi.m.clicks)}).` : '',
    'With posts in different weeks and formats, the topic, the format and the reach are all mixed together. Running both topics in the same format, on the same weekday and time, separates the topic from the rest.',
    enquiriesUnknown.length ? `Enquiries weren’t entered for ${enquiriesUnknown.map(name).join(', ')}, so the test should record enquiries for both posts, including zero.` : '',
  ].filter(Boolean).join(' ');
  return {
    kind: 'test', platform, evidence, leader: hi.job.id,
    title: `On ${platform}, test the “${topic(hi)}” topic against “${topic(lo)}” in the same format`,
    why,
    caution: evidence === 'low' ? `Too little evidence to call a winner: ${plural(rs.length, 'post')} with ${window}-day figures. This is a test worth running, not a conclusion.` : 'A pattern worth testing, not a proven result.',
    brief: `Test week on ${platform}: compare two topics in the same practical format.\n` +
      `1. Follow up “${topic(hi)}” (higher click-through last time: ${fmtPct(hi.ctr.value)}).\n` +
      `2. Revisit “${topic(lo)}” (${lo.job.id === mostClicks.job.id ? `more total clicks: ${fmtNum(lo.m.clicks)}` : `click-through ${fmtPct(lo.ctr.value)}`}) using the same format.\n` +
      `Keep the format, call to action, weekday and posting time the same for both ${platform} posts. ` +
      `Record impressions, link clicks and owner-attributed enquiries for each at ${window} days, entering 0 where there were none.`,
  };
}

/** Weekly summary for posts published in the week beginning `weekStart` (a Monday). */
export function weeklySummary(jobs, { weekStart, platform = 'All', posts = 'all', window = DEFAULT_WINDOW }) {
  const to = addDays(weekStart, 6);
  const { rows, excluded } = comparisonRows(jobs, { platform, posts, window, from: weekStart, to });
  return { weekStart, to, rows, excluded, observations: observations(rows, { window }), suggestion: suggestTest(rows, { window }), hasSample: rows.some((r) => r.job.sample) };
}

/** The week (Monday) of the most recent publication with figures for this window, for the summary's default. */
export function latestWeek(jobs, today, window = DEFAULT_WINDOW) {
  const dates = jobs.filter((j) => publishedPub(j) && (j.measurements || []).some((m) => window === 'latest' || m.windowDays === window)).map(publishedOn).sort();
  return mondayOf(dates.at(-1) || today);
}

/* ---------- Sample posts (made-up figures, clearly labelled, never mixed with yours) ---------- */
export const SAMPLE_POSTS = [
  {
    key: 'photos', title: 'Missing engineer photos', dayOffset: 0, impressions: 1000, clicks: 20, enquiries: 2,
    caption: 'A job isn’t finished until the evidence is on file.\n\nWhen engineers leave site without before-and-after photos, the office can’t invoice, the client queries the work and someone drives back out.\n\nThree habits that fix it:\n1. Photos are part of the job sheet, not an extra\n2. The app won’t close a job without them\n3. The office checks them the same day\n\nHow many of last month’s jobs are still waiting on a photo?\n\n#CommercialMaintenance #FacilitiesManagement #FieldService',
  },
  {
    key: 'invoice', title: 'Jobs waiting for invoice sign-off', dayOffset: 1, impressions: 2000, clicks: 30, enquiries: null,
    caption: 'Finished work that can’t be invoiced is cash you’ve already spent.\n\nMost of it is stuck on the same thing: a signature nobody chased before the van left.\n\nWhat helps:\n1. Get sign-off on site, on the device\n2. Flag unsigned jobs the same afternoon\n3. Review the backlog weekly with the finance team\n\nHow many completed jobs are waiting for sign-off right now?\n\n#CommercialMaintenance #BuildingServices #CashFlow',
  },
];
