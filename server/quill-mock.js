// Deterministic mock provider for repeatable tests (QUILL_PROVIDER=mock). Not AI output.
// Responses are built from the request so tests can assert that the brief and feedback reached the provider.

const DELAY_MS = Number(process.env.QUILL_MOCK_DELAY_MS || 900);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const calls = [];

const TAGS = '#BuildingServices #FacilitiesManagement #FieldService #MEP #CommercialMaintenance';

const activeOffers = (req) => ((req.profile?.data?.offers) || []).filter((o) => o.active && (!o.start || o.start <= (req.targetDate || '')) && (!o.end || o.end >= (req.targetDate || '')));
function profileTags(req) {
  const req2 = req.profile?.data?.brand?.linkedinHashtags?.required || [];
  const base = TAGS.split(' ');
  return [...new Set([...req2, ...base])].slice(0, Math.max(5, req2.length)).join(' ');
}
/** Remove text the feedback quotes and asks to remove (e.g. an expired offer line). */
function removeQuoted(caption, feedback) {
  if (!/\b(remove|delete|take out|drop)\b/i.test(feedback)) return null;
  const quotes = [...feedback.matchAll(/[“"]([^”"]{6,})[”"]/g)].map((m) => m[1]);
  let out = caption;
  for (const q of quotes) out = out.split('\n').filter((line) => !line.includes(q)).join('\n');
  return out === caption ? null : out.replace(/\n{3,}/g, '\n\n').trim();
}

function draftFor(req) {
  // Tone from voice.js (sent by the app, or decided from the brief): the mock follows it so tests can check it.
  if (req.tone?.mode === 'promo') {
    return {
      caption: [
        'Not sure where jobs slow down between site and invoice? Our free workflow review will show you.',
        'We walk through how a job moves through your business, from booking to invoice, and point out the steps worth fixing first.',
        `${req.profile?.data?.cta?.main || 'Request a Free Workflow Review'}: book your slot by sending us a message today.`,
        req.platform === 'LinkedIn' ? profileTags(req) : '#FacilitiesManagement',
      ].join('\n\n'),
      notes: 'Mock direct-response draft (this job only): service, benefit and one booking call to action.',
    };
  }
  if (/jobtrack|what we(?:’|')?ve? learn/i.test(req.brief)) {
    return {
      caption: [
        'We’ve been building JobTrack Pro, our own job app for maintenance teams, and it keeps changing how we design workflows for clients.',
        'What prompted it: the same gap kept appearing between engineers on site and the office, so we started building something to close it ourselves.',
        'The biggest lesson so far: capture evidence at the moment the work is done. Everything downstream gets easier when the photo and the signature arrive with the job.',
        'JobTrack Pro is still a work in progress, so this is what we’re learning as we build rather than a result we can point to yet.',
        'If you’re wrestling with the same handover, send us a message. We’re happy to compare notes.',
        req.platform === 'LinkedIn' ? profileTags(req) : '#FieldService',
      ].join('\n\n'),
      notes: 'Mock draft in Nexai’s editorial voice: an honest update from inside Nexai, work in progress kept distinct.',
    };
  }
  if (/\boffer\b/i.test(req.brief) && activeOffers(req).length) {
    const o = activeOffers(req)[0];
    return {
      caption: [
        'Finished jobs that can’t be invoiced are cash you’ve already earned, waiting on admin.',
        'Most of the delay comes from one missing photo or an unsigned job sheet. Fix the handover and the invoice follows.',
        o.wording,
        'What’s the one thing that most often holds up your invoices?',
        req.platform === 'LinkedIn' ? profileTags(req) : '#FacilitiesManagement',
      ].join('\n\n'),
      notes: 'Mock draft including the active offer wording exactly as the profile states it.',
    };
  }
  const angle = /^Angle: (.+)$/m.exec(req.brief);
  const takeaway = /^Practical takeaway: (.+)$/m.exec(req.brief);
  if (angle && takeaway) {
    const gbp = req.platform === 'Google Business Profile';
    return {
      caption: [
        `${angle[1].replace(/\.$/, '')}.`,
        'It rarely looks like a big problem on the day. It shows up later, when the office is chasing and the invoice is still waiting.',
        `One practical step: ${takeaway[1].charAt(0).toLowerCase()}${takeaway[1].slice(1).replace(/\.$/, '')}.`,
        gbp ? 'Questions about how we handle this on your site? Ask the team.' : 'How does your team handle this today?',
        ...(gbp ? [] : [req.platform === 'Facebook' ? '#FacilitiesManagement #BuildingServices' : TAGS]),
      ].join('\n\n'),
      notes: `Mock draft from the plan's angle and takeaway for ${req.platform}.`,
    };
  }
  if (/photo/i.test(req.brief)) {
    return {
      caption: [
        'Friday afternoon. Three jobs marked complete. None of them can be invoiced yet.',
        'The work is done and the client is happy, but the engineer photos are still on someone’s phone in a van on the M25. So the office starts chasing, and the invoices slide into next week.',
        'One practical fix: make the photos part of closing the job, not an extra step afterwards. If the job can’t be marked complete on the engineer’s device until the before and after photos are attached, the office has nothing to chase.',
        'It feels strict for about a fortnight. Then Friday afternoons get a lot quieter.',
        'What’s the most common thing your office is still chasing at the end of the week?',
        TAGS,
      ].join('\n\n'),
      notes: 'Opened on the Friday moment from the brief and gave one practical fix: photos required to close the job.',
    };
  }
  return {
    caption: `A quick update from us at Nexai on the brief: "${req.brief.slice(0, 120)}".\n\nWhat would you change first? Tell us in the comments.\n\n${TAGS}`,
    notes: 'Generic mock draft (editorial voice).',
  };
}

function revisionFor(req) {
  const removed = removeQuoted(req.currentCaption, req.feedback);
  if (removed) return { caption: removed, notes: 'Removed the quoted wording; everything else kept as it was.' };
  const fb = req.feedback.toLowerCase();
  if (/4\s?pm/.test(fb)) {
    return {
      caption: [
        '4pm on Friday. The job screen shows three green ticks: complete. Next to each one, the same grey box: “Awaiting photos”.',
        'The work’s done. The invoices aren’t going anywhere until those photos arrive, so the office starts ringing round.',
        'One fix: don’t let a job close without them. Make before and after photos a required step on the engineer’s device, and “complete” finally means ready to invoice.',
        'What does your 4pm Friday screen look like?',
        '#BuildingServices #FieldService #FacilitiesManagement',
      ].join('\n\n'),
      notes: 'Reopened at 4pm Friday on the service manager’s screen, cut to under 100 words and kept one fix.',
    };
  }
  return { caption: `${req.currentCaption}\n\n[Mock revision applying: ${req.feedback}]`, notes: 'Generic mock revision.' };
}

async function generate(req) {
  calls.push({ kind: req.kind, platform: req.platform, brief: req.brief, feedback: req.feedback || null, currentCaption: req.currentCaption || null, tone: req.tone?.mode || null, voice: req.voice || null });
  await sleep(DELAY_MS);
  return req.kind === 'revision' ? revisionFor(req) : draftFor(req);
}

const planCalls = [];
async function planWeek(req) {
  planCalls.push({ brief: req.brief, weekStart: req.weekStart, days: req.days.map((d) => `${d.dayName} ${d.platform}`), tone: req.tone?.mode || null, voice: req.voice || null });
  await sleep(DELAY_MS);
  const angles = [
    ['Maintenance directors', 'Finished jobs that sit unbilled are cash you have already earned', 'Pull a “complete but not invoiced” list every Monday morning'],
    ['Office and service coordinators', 'The missing engineer photo is the most common reason an invoice waits', 'Make before and after photos a required step to close a job'],
    ['Local facilities managers', 'What a complete job sheet looks like when it reaches the office', 'Use a five-line job sheet check before leaving site'],
    ['Service managers', 'Client sign-off that waits a week turns into a dispute', 'Capture sign-off on the engineer’s device before leaving'],
    ['Operations directors', 'Three checks that turn “done” into “ready to invoice”', 'Agree one definition of complete with engineers and the office'],
  ];
  return req.days.map((d, i) => {
    const [audience, angle, takeaway] = angles[i % angles.length];
    const prof = req.profile?.data;
    return {
      audience: prof?.audience?.buyers ? `${audience} (${prof.audience.buyers})` : audience,
      angle, takeaway,
      visual: `Engineer on a UK commercial site for ${d.platform}: plant room or rooftop, natural light, no text.${prof?.brand ? ' Official Nexai logo.' : ''}`,
    };
  });
}

/* Cue / Calibre / Vantage mocks (deterministic, not AI) */
async function videoScript(req) {
  calls.push({ kind: 'script', brief: req.brief, tone: req.tone?.mode || null });
  await sleep(DELAY_MS);
  const promo = req.tone?.mode === 'promo';
  return {
    scenes: [
      { title: 'Opening', duration: 4, from: 0, caption: 'Mock: receipts go missing between site and office.', script: 'Mock direction: open on the job screen.' },
      { title: 'On screen', duration: 8, from: 2.5, caption: 'Mock: the engineer adds the receipt on site.', script: 'Mock direction: show the tap and the photo.' },
      { title: 'Why it helps', duration: 5, from: 9, caption: 'Mock: the office sees it straight away.', script: 'Mock direction: office view.' },
      { title: promo ? 'Call to action' : 'Takeaway', duration: 3, from: 16, caption: promo ? 'Mock: Request a Free Workflow Review.' : 'Mock takeaway: log receipts before you leave site.', script: 'Mock direction: close.' },
    ],
    notes: 'Mock storyboard from the brief (test mode, not AI).',
  };
}
function wordingReview(caption, tone) {
  calls.push({ kind: 'wording', tone: tone?.mode || null });
  const first = caption.split('\n').find((l) => l.trim()) || caption;
  return { summary: 'Mock wording review (test mode, not AI): reads clearly overall.', suggestions: [{ quote: first.slice(0, 40), issue: 'Mock: the opening could be more specific.', suggestion: 'Mock: name the moment on site.' }] };
}
function interpret(rows, invent) {
  calls.push({ kind: 'interpret', rows: rows.length });
  const withCtr = rows.filter((r) => r.ctrPct != null).sort((a, b) => b.ctrPct - a.ctrPct);
  if (invent) return 'Mock: this post converted 37% better.';
  return `Mock interpretation (test mode, not AI): ${withCtr.length ? `“${withCtr[0].title}” had the higher click-through at ${withCtr[0].ctrPct.toFixed(1)}%. ` : ''}Enquiries not entered are unknown, not zero. With ${rows.length} posts there’s too little evidence for a conclusion.`;
}

module.exports = { generate, calls, planWeek, planCalls, videoScript, wordingReview, interpret };
