// Deterministic mock provider for repeatable tests (QUILL_PROVIDER=mock). Not AI output.
// Responses are built from the request so tests can assert that the brief and feedback reached the provider.

const DELAY_MS = Number(process.env.QUILL_MOCK_DELAY_MS || 900);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const calls = [];

const TAGS = '#BuildingServices #FacilitiesManagement #FieldService #MEP #CommercialMaintenance';

function draftFor(req) {
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
    caption: `A quick thought for ${req.platform} on the brief: "${req.brief.slice(0, 120)}".\n\nWhat would you change first?\n\n${TAGS}`,
    notes: 'Generic mock draft.',
  };
}

function revisionFor(req) {
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
  calls.push({ kind: req.kind, platform: req.platform, brief: req.brief, feedback: req.feedback || null, currentCaption: req.currentCaption || null });
  await sleep(DELAY_MS);
  return req.kind === 'revision' ? revisionFor(req) : draftFor(req);
}

module.exports = { generate, calls };
