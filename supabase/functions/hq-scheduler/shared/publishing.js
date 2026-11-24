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
export const CLAIM_MS = 3 * 60 * 1000; // a claimed delivery with no outcome after this is checked, never blindly resent
export const BATCH = 10; // the hosted worker sends at most this many publications per run

/**
 * The intended destinations, each with a simulated demo stand-in. Nothing here is connected to a real account; the
 * live connections come in a later milestone and replace only the publisher, not these records.
 */
export const DEMO_ACCOUNTS = {
  LinkedIn: { id: 'demo-linkedin', name: 'Kieran’s', kind: 'personal LinkedIn profile' },
  Facebook: { id: 'demo-facebook', name: 'Nexai Digital', kind: 'Facebook Page' },
  'Google Business Profile': { id: 'demo-gbp', name: 'Nexai Digital', kind: 'Google Business Profile' },
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
// `graphic` is the visual task: a graphic, or a video for a video post. Records say which (`visual`).
const tasksOf = (bundle) => ({ copy: bundle.tasks.find((t) => t.type === 'copy'), graphic: bundle.tasks.find((t) => t.type === 'graphic' || t.type === 'video') });
export const visualOf = (pub) => (pub?.visual === 'video' ? 'video' : 'graphic');
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
  if (graphic.versions.length !== pub.graphicVersion) out.push(`the ${visualOf(pub)} changed from v${pub.graphicVersion} to v${graphic.versions.length}`);
  else if (graphic.pending && !graphic.pending.error) out.push(`a ${visualOf(pub)} revision was requested`);
  const a = bundle.job.approval;
  if (!a || a.copyVersion !== pub.copyVersion || a.graphicVersion !== pub.graphicVersion) {
    if (!out.length) out.push('the approval it was based on has changed');
  }
  return out;
}

/** Create the record for an explicit "Publish now" or "Schedule" you confirmed. Never called by approval. */
export function authorise(bundle, { action, scheduledFor, now, by, media = null }) {
  const job = bundle.job;
  const a = job.approval;
  const { copy, graphic } = tasksOf(bundle);
  const account = accountFor(job.platform);
  if (!account) return { error: `Demo publishing covers LinkedIn, Facebook and Google Business Profile. ${job.platform} isn’t included yet.` };
  if (!a || a.copyVersion !== copy.versions.length || a.graphicVersion !== graphic.versions.length || copy.pending || graphic.pending) return { error: `Approve the current caption and ${graphic.type === 'video' ? 'video' : 'graphic'} first.` };
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
    copyVersion: a.copyVersion, graphicVersion: a.graphicVersion, visual: graphic.type === 'video' ? 'video' : 'graphic', approvedAt: a.at,
    scheduledFor: action === 'now' ? now : scheduledFor, createdAt: now, by, status: 'scheduled', attempts: 0, receipt: null, events: [],
    // The exact media file, stored with the workspace so the hosted worker can deliver it with every browser closed.
    ...(media ? { media: { assetId: media.assetId, type: media.type, size: media.size, sha256: media.sha256 || null } } : {}),
  };
  event(pub, now, 'authorised', action === 'now'
    ? `You confirmed Publish now (demo) to ${accountLabel(account)} with caption v${pub.copyVersion} and ${pub.visual} v${pub.graphicVersion}.`
    : `You confirmed Schedule (demo) for ${fmtLondon(scheduledFor)} on ${accountLabel(account)} with caption v${pub.copyVersion} and ${pub.visual} v${pub.graphicVersion}.`, by);
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
    visual: visualOf(pub),
    graphic: { version: gv.n, mode: gv.content.mode === 'photo' ? 'photo' : gv.content.mode === 'video' ? 'video' : 'simulated', headline: gv.content.mode === 'video' ? `${gv.content.videoId} ${gv.content.mime} ${gv.content.durationMs}ms` : gv.content.headline || '' },
    ...(pub.media ? { media: { ...pub.media } } : {}),
  };
}

/* ---------- Claiming and delivering (shared by the browser demo, the HQ server and the hosted worker) ----------
   1. claimDue: on a fresh copy of the job, recheck everything (approval, cancellation, versions, the 15-minute rule,
      expired offers), then mark each due publication as being delivered under a new claim id. The caller saves that
      with a revision check, so when two scheduler runs overlap only one claim is saved; the other sends nothing.
   2. The claim winner sends the authorised payload to the publisher, keyed by the stable publication id.
   3. applyOutcome: records the result on the latest copy of the job, only if that claim is still current. */

/**
 * Due work on one job. Returns { changed, claimed: [pubs to send now], checks: [pubs whose earlier delivery has
 * no outcome yet] }. Nothing is sent here.
 */
export function claimDue(bundle, { now, profileData, by, claimId, limit = BATCH }) {
  let changed = syncPublications(bundle, now, by);
  const { copy } = tasksOf(bundle);
  const claimed = [];
  const checks = [];
  for (const p of publications(bundle.job)) {
    if (claimed.length + checks.length >= limit) break;
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
      p.claim = { id: claimId, at: now, by };
      p.deliveryStartedAt = p.deliveryStartedAt || now;
      p.attempts = (p.attempts || 0) + 1;
      p.lastAttemptAt = now;
      event(p, now, 'sending', `Delivery started: sending to the demo publisher (${accountLabel(p.account)}), attempt ${p.attempts}.`, by);
      claimed.push(p);
    } else if (p.status === 'publishing' && (!p.claim || now - p.claim.at >= CLAIM_MS || p.events.at(-1)?.type === 'no_response')) {
      // An earlier delivery has no recorded outcome. Ask the publisher what happened before doing anything else.
      changed = true;
      p.claim = { id: claimId, at: now, by };
      event(p, now, 'checking', `Checking with the publisher what happened to attempt ${p.attempts || 1} (no outcome was recorded).`, by);
      checks.push(p);
    }
  }
  return { changed, claimed, checks };
}

/**
 * Record what happened to a claimed delivery. outcome: { receipt, duplicate } | { lost: true } | { refused: message }
 * | { uncertain: detail } (a live platform might have accepted it: never resent automatically) | { notFound: true }
 * (a check found the publisher never received it: safe to send again). Returns false if the claim is no longer current.
 */
export function applyOutcome(bundle, pubId, claimId, outcome, { now, by }) {
  const p = publications(bundle.job).find((x) => x.id === pubId);
  if (!p || p.status !== 'publishing' || p.claim?.id !== claimId) return false;
  delete p.claim;
  if (outcome.receipt) {
    p.status = 'published';
    p.receipt = outcome.receipt;
    p.publishedAt = outcome.receipt.acceptedAt;
    event(p, now, 'published', outcome.duplicate
      ? `Published (demo). The publisher had already accepted this post on an earlier attempt, so it returned the original receipt ${outcome.receipt.id}. Nothing was published twice.`
      : `Published (demo) to ${accountLabel(p.account)}. Receipt ${outcome.receipt.id}.`, by);
  } else if (outcome.lost) {
    event(p, now, 'no_response', 'Sent to the demo publisher but no answer came back. It may already have been accepted. The scheduler checks with the publisher by this post’s id before anything is sent again, so it can’t be published twice.', by);
  } else if (outcome.notFound) {
    p.status = 'scheduled';
    p.scheduledFor = now;
    event(p, now, 'not_received', 'The publisher confirmed it never received this post, so it will be sent again with the same publication id.', by);
  } else if (outcome.uncertain) {
    p.status = 'attention';
    p.attentionReason = `Delivery may or may not have reached ${p.platform}: ${outcome.uncertain}`;
    event(p, now, 'uncertain', `${p.attentionReason} It won’t be resent automatically. Check the account, then cancel or schedule again.`, by);
  } else {
    hold(p, now, by, 'refused', `The demo publisher refused it: ${outcome.refused || 'unknown error'}`);
  }
  return true;
}

/**
 * Run whatever is due on one job bundle. `publisher.accept(id, payload)` returns { receipt, duplicate } or throws
 * ({ lost: true } when the request was sent but no answer came back). Returns true if the bundle changed.
 * `force` retries a post awaiting confirmation straight away (your "Retry" tap) instead of waiting RETRY_MS.
 */
export function runDue(bundle, { now, profileData, publisher, by, force = false }) {
  if (force) for (const p of publications(bundle.job)) if (p.status === 'publishing' && p.claim) p.claim.at = -Infinity;
  const claimId = `run_${now.toString(36)}`;
  const { changed, claimed, checks } = claimDue(bundle, { now, profileData, by, claimId, limit: Infinity });
  for (const p of [...claimed, ...checks]) {
    let outcome;
    try { outcome = publisher.accept(p.id, payloadFor(bundle, p)); } catch (e) { outcome = e.lost ? { lost: true } : { refused: e.message }; }
    applyOutcome(bundle, p.id, claimId, outcome, { now, by });
  }
  return changed;
}

function hold(p, now, by, kind, reason) {
  p.status = 'held';
  p.holdKind = kind;
  p.holdReason = reason;
  event(p, now, 'held', `Held for your decision. ${reason}`, by);
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
export const contentHashOf = (payload) => hashText(`${payload.caption}|${payload.graphic.version}|${payload.graphic.mode}|${payload.graphic.headline}`);
/** The record the demo publisher keeps for one accepted post (keyed by publication id). */
export function demoRecord(id, payload, at, random = Math.random) {
  const rid = `rcpt_${hashText(`${id}|${at}|${random()}`)}`;
  const receipt = {
    id: rid, publicationId: id, platform: payload.platform, accountId: payload.accountId, acceptedAt: at,
    copyVersion: payload.copyVersion, graphicVersion: payload.graphicVersion, scheduledFor: payload.scheduledFor,
    visual: payload.visual || 'graphic', ...(payload.visual === 'video' ? { videoVersion: payload.graphicVersion } : {}),
    ...(payload.media ? { media: { assetId: payload.media.assetId, size: payload.media.size, type: payload.media.type } } : {}),
    postUrl: `https://demo-publisher.invalid/${SLUG[payload.accountId] || 'post'}/${rid.slice(5)}`, simulated: true,
  };
  return { receipt, contentHash: contentHashOf(payload), caption: payload.caption, graphic: payload.graphic };
}
/** Compare a stored record with a payload: the same post returns its original receipt, a different one is refused. */
export function demoAnswer(existing, payload) {
  if (existing.contentHash !== contentHashOf(payload)) throw new Error('a different post was already accepted under this publication id');
  return { receipt: existing.receipt, duplicate: true };
}

export function makePublisher({ store, now, takeFault = () => null, random = () => Math.random() }) {
  return {
    accept(id, payload) {
      const existing = store.get(id);
      if (existing) return demoAnswer(existing, payload);
      const rec = demoRecord(id, payload, now(), random);
      store.put(id, rec);
      if (takeFault() === 'lose') throw Object.assign(new Error('response lost'), { lost: true });
      return { receipt: rec.receipt, duplicate: false };
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
