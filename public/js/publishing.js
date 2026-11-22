// Demo publishing and scheduling. Pure functions with no DOM or storage: the browser (demo mode) and the HQ server
// (shared workspace) run exactly the same rules. Nothing here talks to LinkedIn, Facebook or Google. Every account is
// simulated and every "publication" goes to a local simulated publisher that returns a receipt.
//
// A publication record lives on the job (job.publications) and names the exact caption and graphic versions you
// authorised. It never follows newer versions: if the content changes, the publication stops and asks for you.
import { expiredOffers } from './review.js';
import { offerState, fmt } from './profile.js';

export const TZ = 'Europe/London';
export const MISSED_MS = 15 * 60 * 1000; // a scheduled post more than 15 minutes late waits for your decision
export const RETRY_MS = 10 * 1000; // automatic retry spacing after the publisher didn't answer

/** Simulated destinations. Not connected to any real account. */
export const DEMO_ACCOUNTS = {
  LinkedIn: { id: 'demo-linkedin', name: 'Nexai Digital', kind: 'LinkedIn company page' },
  Facebook: { id: 'demo-facebook', name: 'Nexai Digital', kind: 'Facebook page' },
  'Google Business Profile': { id: 'demo-gbp', name: 'Nexai Digital', kind: 'Google Business Profile listing' },
};
export const accountFor = (platform) => DEMO_ACCOUNTS[platform] || null;
export const accountLabel = (a) => `${a.name} ${a.kind} (demo account, simulated)`;

export const PUB_LABEL = {
  scheduled: 'Scheduled (demo)',
  publishing: 'Sending (demo)',
  published: 'Published (demo)',
  cancelled: 'Cancelled',
  held: 'Held for your decision',
  attention: 'Needs your attention',
  replaced: 'Replaced',
};
const OPEN = ['scheduled', 'publishing', 'held', 'attention'];
const QUEUED = ['scheduled', 'publishing'];

/* ---------- Europe/London time ---------- */
const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** { date: 'YYYY-MM-DD', time: 'HH:MM', abbr: 'GMT' | 'BST' } for an instant. */
export function londonParts(ms) {
  const p = Object.fromEntries(parts.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  const offset = asUtc - Math.floor(ms / 60000) * 60000;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, abbr: offset === 3600000 ? 'BST' : 'GMT' };
}
const longDay = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const shortDay = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
/** "Friday 27 November 2026, 09:00 GMT" */
export function fmtLondon(ms, { short = false } = {}) {
  const p = londonParts(ms);
  return `${(short ? shortDay : longDay).format(new Date(ms)).replace(/,/g, '')}, ${p.time} ${p.abbr}`;
}
const dayName = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/**
 * Turn a London wall-clock date and time into an instant. Clock changes are handled explicitly:
 *   { ms, abbr }                       one exact instant
 *   { error: 'nonexistent', message }  the time is skipped when clocks go forward (01:00–01:59 in late March)
 *   { error: 'ambiguous', options }    the time happens twice when clocks go back (01:00–01:59 in late October)
 *   { error: 'invalid', message }
 */
export function fromLondon(date, time) {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '');
  const tm = /^(\d{2}):(\d{2})$/.exec(time || '');
  if (!dm || !tm) return { error: 'invalid', message: 'Enter a date and a time.' };
  const [y, mo, d, h, mi] = [+dm[1], +dm[2], +dm[3], +tm[1], +tm[2]];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return { error: 'invalid', message: `${date} isn’t a real date.` };
  if (h > 23 || mi > 59) return { error: 'invalid', message: `${time} isn’t a valid time.` };
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const found = [wall - 3600000, wall].filter((ms) => { const p = londonParts(ms); return p.date === date && p.time === time; });
  if (!found.length) {
    return { error: 'nonexistent', message: `${time} doesn’t exist in London on ${dayName(date)}: the clocks go forward from 01:00 GMT straight to 02:00 BST. Choose a time before 01:00 or from 02:00.` };
  }
  if (found.length === 2) {
    return { error: 'ambiguous', options: found.map((ms) => ({ ms, abbr: londonParts(ms).abbr })), message: `${time} happens twice in London on ${dayName(date)}: first in BST, then again an hour later in GMT after the clocks go back. Choose which one you mean.` };
  }
  return { ms: found[0], abbr: londonParts(found[0]).abbr };
}

/* ---------- Publication records ---------- */
const tasksOf = (bundle) => ({ copy: bundle.tasks.find((t) => t.type === 'copy'), graphic: bundle.tasks.find((t) => t.type === 'graphic') });
export const publications = (job) => job.publications || [];
/** The publication that currently matters for this post (open, or else the most recent). */
export const currentPub = (job) => publications(job).filter((p) => OPEN.includes(p.status)).at(-1) || publications(job).at(-1) || null;
export const openPub = (job) => publications(job).filter((p) => OPEN.includes(p.status)).at(-1) || null;
export const isOpen = (p) => !!p && OPEN.includes(p.status);
const event = (pub, at, type, text, by) => pub.events.push({ at, type, text, by });

/** Why a queued publication can no longer go out as authorised ([] if it still can). */
export function staleReasons(bundle, pub) {
  const { copy, graphic } = tasksOf(bundle);
  const out = [];
  if (copy.versions.length !== pub.copyVersion) out.push(`the caption changed from v${pub.copyVersion} to v${copy.versions.length}`);
  else if (copy.pending && !copy.pending.error) out.push('a caption revision was requested');
  if (graphic.versions.length !== pub.graphicVersion) out.push(`the graphic changed from v${pub.graphicVersion} to v${graphic.versions.length}`);
  else if (graphic.pending && !graphic.pending.error) out.push('a graphic revision was requested');
  const a = bundle.job.approval;
  if (!a || a.copyVersion !== pub.copyVersion || a.graphicVersion !== pub.graphicVersion) {
    if (!out.length) out.push('the approval it was based on has changed');
  }
  return out;
}

/** Create the record for an explicit "Publish now" or "Schedule" you confirmed. Never called by approval. */
export function authorise(bundle, { action, scheduledFor, now, by }) {
  const job = bundle.job;
  const a = job.approval;
  const { copy, graphic } = tasksOf(bundle);
  const account = accountFor(job.platform);
  if (!account) return { error: `Demo publishing covers LinkedIn, Facebook and Google Business Profile. ${job.platform} isn’t included yet.` };
  if (!a || a.copyVersion !== copy.versions.length || a.graphicVersion !== graphic.versions.length || copy.pending || graphic.pending) return { error: 'Approve the current caption and graphic first.' };
  if (publications(job).some((p) => p.status === 'published')) return { error: 'This post has already been published (demo). It can’t be published twice.' };
  const open = publications(job).filter((p) => QUEUED.includes(p.status));
  if (open.length) return { existing: open.at(-1) };
  if (action === 'schedule' && !(scheduledFor > now)) return { error: 'That time has already passed in London. Choose a later time.' };
  const n = publications(job).length + 1;
  for (const p of publications(job)) {
    if (p.status === 'held' || p.status === 'attention') { p.status = 'replaced'; event(p, now, 'replaced', `Replaced by publication #${n}.`, by); }
  }
  const pub = {
    id: `pub_${job.id.slice(4)}_${n}`, n, action, platform: job.platform, account: { ...account },
    copyVersion: a.copyVersion, graphicVersion: a.graphicVersion, approvedAt: a.at,
    scheduledFor: action === 'now' ? now : scheduledFor, createdAt: now, by, status: 'scheduled', attempts: 0, receipt: null, events: [],
  };
  event(pub, now, 'authorised', action === 'now'
    ? `You confirmed Publish now (demo) to ${accountLabel(account)} with caption v${pub.copyVersion} and graphic v${pub.graphicVersion}.`
    : `You confirmed Schedule (demo) for ${fmtLondon(scheduledFor)} on ${accountLabel(account)} with caption v${pub.copyVersion} and graphic v${pub.graphicVersion}.`, by);
  job.publications = [...publications(job), pub];
  return { pub };
}

export function reschedule(pub, { scheduledFor, now, by }) {
  if (pub.status !== 'scheduled' && pub.status !== 'held') return { error: `This publication is ${PUB_LABEL[pub.status].toLowerCase()} and can’t be rescheduled.` };
  if (!(scheduledFor > now)) return { error: 'That time has already passed in London. Choose a later time.' };
  const from = pub.scheduledFor;
  pub.scheduledFor = scheduledFor;
  pub.action = 'schedule';
  pub.status = 'scheduled';
  event(pub, now, 'rescheduled', `You rescheduled it from ${fmtLondon(from)} to ${fmtLondon(scheduledFor)}.`, by);
  return { pub };
}

export function cancel(pub, { now, by }) {
  if (!['scheduled', 'held', 'attention'].includes(pub.status)) return { error: `This publication is ${PUB_LABEL[pub.status].toLowerCase()} and can’t be cancelled.` };
  pub.status = 'cancelled';
  event(pub, now, 'cancelled', 'You cancelled it. It will not be published.', by);
  return { pub };
}

/** Your decision on a held post: send it now anyway (the hold reason is recorded with your decision). */
export function releaseHeld(pub, { now, by }) {
  if (pub.status !== 'held') return { error: 'This publication isn’t held.' };
  pub.status = 'scheduled';
  if (pub.holdKind === 'offer') pub.override = { at: now, by, kind: 'offer', reason: pub.holdReason };
  pub.scheduledFor = now;
  event(pub, now, 'released', `You chose to publish it now (demo) despite: ${pub.holdReason}`, by);
  return { pub };
}

/** Stop any queued publication whose authorised content is no longer current. Returns true if anything changed. */
export function syncPublications(bundle, now, by) {
  let changed = false;
  for (const p of publications(bundle.job)) {
    if (p.status !== 'scheduled' && p.status !== 'held') continue;
    const reasons = staleReasons(bundle, p);
    if (!reasons.length) continue;
    p.status = 'attention';
    p.attentionReason = `Not sent: ${reasons.join(' and ')} after you ${p.action === 'now' ? 'chose Publish now' : 'scheduled it'}.`;
    event(p, now, 'invalidated', `${p.attentionReason} A queued post never picks up a different version. Review and approve the new version, then schedule it again.`, by);
    changed = true;
  }
  return changed;
}

/** What the simulated publisher receives: exactly the authorised versions. */
export function payloadFor(bundle, pub) {
  const { copy, graphic } = tasksOf(bundle);
  const cv = copy.versions[pub.copyVersion - 1];
  const gv = graphic.versions[pub.graphicVersion - 1];
  return {
    publicationId: pub.id, platform: pub.platform, accountId: pub.account.id, scheduledFor: pub.scheduledFor,
    copyVersion: pub.copyVersion, graphicVersion: pub.graphicVersion, caption: cv.content.text,
    graphic: { version: gv.n, mode: gv.content.mode === 'photo' ? 'photo' : 'simulated', headline: gv.content.headline || '' },
  };
}

/**
 * Run whatever is due on one job bundle. `publisher.accept(id, payload)` returns { receipt, duplicate } or throws
 * ({ lost: true } when the request was sent but no answer came back). Returns true if the bundle changed.
 * `force` retries a post awaiting confirmation straight away (your "Retry" tap) instead of waiting RETRY_MS.
 */
export function runDue(bundle, { now, profileData, publisher, by, force = false }) {
  let changed = syncPublications(bundle, now, by);
  const { copy } = tasksOf(bundle);
  for (const p of publications(bundle.job)) {
    if (p.status === 'scheduled' && p.scheduledFor <= now) {
      changed = true;
      if (p.action === 'schedule' && now - p.scheduledFor > MISSED_MS) {
        hold(p, now, by, 'missed', `It was due ${fmtLondon(p.scheduledFor)} but the demo scheduler wasn’t running then, so it wasn’t sent late without asking you.`);
        continue;
      }
      const date = londonParts(p.scheduledFor).date;
      const caption = copy.versions[p.copyVersion - 1]?.content?.text || '';
      const expired = expiredOffers(caption, profileData, date);
      if (expired.length && p.override?.kind !== 'offer') {
        const o = expired[0];
        hold(p, now, by, 'offer', `Calibre (Brand & Quality Reviewer) checked it before sending: caption v${p.copyVersion} quotes “${o.wording}”, which isn’t available on ${fmt(date)} (${offerState(o, date).why}).`);
        continue;
      }
      p.status = 'publishing';
      event(p, now, 'sending', `Sending to the demo publisher (${accountLabel(p.account)}).`, by);
      attempt(bundle, p, now, publisher, by);
    } else if (p.status === 'publishing' && (force || now - (p.lastAttemptAt || 0) >= RETRY_MS)) {
      changed = true;
      attempt(bundle, p, now, publisher, by);
    }
  }
  return changed;
}

function hold(p, now, by, kind, reason) {
  p.status = 'held';
  p.holdKind = kind;
  p.holdReason = reason;
  event(p, now, 'held', `Held for your decision. ${reason}`, by);
}

function attempt(bundle, p, now, publisher, by) {
  p.attempts = (p.attempts || 0) + 1;
  p.lastAttemptAt = now;
  try {
    const { receipt, duplicate } = publisher.accept(p.id, payloadFor(bundle, p));
    p.status = 'published';
    p.receipt = receipt;
    p.publishedAt = receipt.acceptedAt;
    event(p, now, 'published', duplicate
      ? `Published (demo). The publisher had already accepted this post on an earlier attempt, so it returned the original receipt ${receipt.id}. Nothing was published twice.`
      : `Published (demo) to ${accountLabel(p.account)}. Receipt ${receipt.id}.`, by);
  } catch (e) {
    event(p, now, e.lost ? 'no_response' : 'error', e.lost
      ? 'Sent to the demo publisher but no answer came back. It may already have been accepted. Retrying is safe: the publisher recognises this post by its id and won’t publish it twice.'
      : `The demo publisher refused it: ${e.message}`, by);
    if (!e.lost) { p.status = 'held'; p.holdKind = 'refused'; p.holdReason = `The demo publisher refused it: ${e.message}`; }
  }
}

/* ---------- The simulated publisher ---------- */
// Plays the part of a platform API: it records each accepted post under the publication id (an idempotency key)
// and returns a receipt. Asked again for the same id, it returns the original receipt instead of posting again.
export function hashText(s) {
  let h = 2166136261;
  for (const ch of String(s)) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
}
const SLUG = { 'demo-linkedin': 'linkedin', 'demo-facebook': 'facebook', 'demo-gbp': 'google-business' };

/**
 * store: { get(id), put(id, record) } (synchronous). now(): the publisher's clock. takeFault(): 'lose' to accept the
 * post but lose the answer (test hook), else null.
 */
export function makePublisher({ store, now, takeFault = () => null, random = () => Math.random() }) {
  return {
    accept(id, payload) {
      const contentHash = hashText(`${payload.caption}|${payload.graphic.version}|${payload.graphic.mode}|${payload.graphic.headline}`);
      const existing = store.get(id);
      if (existing) {
        if (existing.contentHash !== contentHash) throw new Error('a different post was already accepted under this publication id');
        return { receipt: existing.receipt, duplicate: true };
      }
      const rid = `rcpt_${hashText(`${id}|${now()}|${random()}`)}`;
      const receipt = {
        id: rid, publicationId: id, platform: payload.platform, accountId: payload.accountId, acceptedAt: now(),
        copyVersion: payload.copyVersion, graphicVersion: payload.graphicVersion, scheduledFor: payload.scheduledFor,
        postUrl: `https://demo-publisher.invalid/${SLUG[payload.accountId] || 'post'}/${rid.slice(5)}`, simulated: true,
      };
      store.put(id, { receipt, contentHash, caption: payload.caption, graphic: payload.graphic });
      if (takeFault() === 'lose') throw Object.assign(new Error('response lost'), { lost: true });
      return { receipt, duplicate: false };
    },
  };
}

/** For the calendar: where the post sits and how it's labelled. */
export function calendarState(job, jobStatus) {
  const p = currentPub(job);
  if (p && (p.status === 'published')) return { kind: 'published', label: 'Published (demo)', at: p.publishedAt || p.scheduledFor };
  if (p && QUEUED.includes(p.status)) return { kind: 'scheduled', label: `Scheduled (demo) · ${londonParts(p.scheduledFor).time} ${londonParts(p.scheduledFor).abbr}`, at: p.scheduledFor };
  if (p && (p.status === 'held' || p.status === 'attention')) return { kind: 'attention', label: p.status === 'held' ? 'Held: needs you' : 'Needs attention', at: p.status === 'held' ? p.scheduledFor : null };
  if (jobStatus === 'approved') return { kind: 'approved', label: 'Approved', at: null };
  return { kind: 'reapprove', label: 'Needs re-approval', at: null };
}
