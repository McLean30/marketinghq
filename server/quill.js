// HQ's content generation: Vektor's plans, Quill's captions, Cue's scripts, Calibre's optional wording review and
// Vantage's optional interpretation. Runs server-side only: OPENAI_API_KEY never reaches the browser.
//
// Provider is chosen at start-up (see providerInfo()):
//   openai - OpenAI (server/openai.js): text with OPENAI_TEXT_MODEL (default gpt-6-luna), images with
//            OPENAI_IMAGE_MODEL (default gpt-image-2.6-flare). On when OPENAI_API_KEY is set (or AI_PROVIDER=openai).
//            Spending also needs a signed-in owner: see paidGate() in server.js.
//   mock   - deterministic canned responses for repeatable tests (AI_PROVIDER=mock). Never used by default.
//   demo   - no provider: the browser uses the local templates, labelled as simulated.

const mock = require('./quill-mock');
const ai = require('./openai');
const V = require('../public/js/voice.js'); // the same tone rules the browser uses
const CAT = require('../public/js/catalogue.js'); // the service catalogue's public-context rules

/**
 * The catalogue context for a prompt: only the public fields of items that may be named or described, whatever the
 * request carries. Internal notes, internal items and names marked "describe" never reach a model.
 */
function cleanCatalogue(c) {
  const s = (x, n = 600) => (typeof x === 'string' ? x.slice(0, n) : '');
  const items = Array.isArray(c?.items) ? c.items.filter((i) => i && i.disclosure !== 'internal' && typeof i.wording === 'string' && i.wording.trim()).slice(0, 3).map((i) => ({
    id: s(i.id, 60), kind: s(i.kind, 20), status: ['available', 'in_development', 'planned'].includes(i.status) ? i.status : 'planned', disclosure: i.disclosure === 'name' ? 'name' : 'describe',
    name: i.disclosure === 'name' ? s(i.name, 120) : null, wording: s(i.wording, 1200), audience: s(i.audience), problem: s(i.problem), outcome: s(i.outcome),
  })) : [];
  return { items };
}
const catalogueBlock = (c) => CAT.contextText(cleanCatalogue(c));
const PLATFORMS = ['LinkedIn', 'Instagram', 'Facebook', 'X', 'Google Business Profile'];

function resolveProvider() {
  const forced = (process.env.AI_PROVIDER || process.env.QUILL_PROVIDER || '').toLowerCase();
  if (forced === 'mock') return 'mock';
  if (forced === 'demo' || forced === 'off') return 'demo';
  if (forced === 'openai') return 'openai';
  return ai.hasKey() ? 'openai' : 'demo';
}
const PROVIDER = resolveProvider();

function providerInfo() {
  return {
    provider: PROVIDER,
    model: PROVIDER === 'openai' ? ai.TEXT_MODEL : PROVIDER === 'mock' ? 'mock-quill' : null,
    imageModel: PROVIDER === 'openai' ? ai.IMAGE_MODEL : PROVIDER === 'mock' ? 'mock-image' : null,
    effort: PROVIDER === 'openai' ? ai.EFFORT : null,
    label: PROVIDER === 'openai' ? `OpenAI (${ai.TEXT_MODEL}, images ${ai.IMAGE_MODEL})` : PROVIDER === 'mock' ? 'Mock provider (tests)' : 'Local demo templates',
  };
}

/* ---------- Prompt ---------- */
// NOTE: Nexai's full "Winner's Writing Process" and self-review checklist are not in this repository.
// The guidance below is a working stand-in written from the Milestone 2 brief. Replace WRITING_PROCESS and
// SELF_REVIEW with the original wording when it is supplied.
const WRITING_PROCESS = `How to write (working stand-in for Nexai's Winner's Writing Process):
1. Find the one operational moment in the brief the reader will recognise from their own week, and open on it in concrete terms.
2. Name the real cost of that moment in operational terms (cash held up, admin time, chasing, client friction) without inventing figures.
3. Give one or two practical things the reader could change on Monday. Be specific about who does what and when.
4. Close with a genuine question, an invitation to comment or message, or simply the useful point. No pitch (unless the tone section says this job is a direct-response promotion).`;

const SELF_REVIEW = `Before answering, silently check (working stand-in for Nexai's self-review checklist):
- Does it use the operational detail from the brief, not generic marketing language?
- Is it natural British English (spelling, idiom, tone) that a UK operations director would write themselves?
- Is every claim either from the brief or plainly framed as common experience? No invented statistics, results, client names or quotes.
- Is it useful even if the reader never contacts Nexai? No hard sell, no "book a demo", no hype words (unless the tone section says this job is a direct-response promotion; then one clear call to action is right).
- Does it fit the platform conventions and any length or format limit in the feedback?`;

const SYSTEM_PROMPT = `You are Quill, the Copywriter for Nexai Digital's internal marketing team.

Audience: owners, managing directors and operations directors of UK commercial maintenance and building services firms (M&E, FM, HVAC, electrical and fire contractors). They are practical, busy and allergic to marketing fluff.

Voice: natural British English (British spelling such as "organise", "colour", "programme"; UK terms such as "job sheet", "engineer", "PPM", "reactive"). Plain, warm, direct. Short paragraphs. No em dashes. No clichés such as "game-changer", "unlock", "in today's fast-paced world". No emojis unless the brief asks.

Rules:
- Use the operational detail in the brief. Follow the tone section in the user message: by default Nexai's editorial voice from the business profile (an honest update from inside Nexai, first-person plural where it fits).
- Unless the tone section says this job is a direct-response promotion, give the reader something genuinely useful and avoid hard selling and calls to buy.
- Keep work in progress distinct from products, results or client work Nexai can genuinely point to.
- Never invent results, statistics, percentages, client names, testimonials or quotes. If a number would help, leave a clearly marked placeholder in square brackets for the team to fill in.
- Platform conventions: LinkedIn - line breaks between short paragraphs, end with 3 to 5 relevant hashtags on their own line. Instagram - conversational, up to 8 relevant hashtags at the end. Facebook - conversational, at most 2 hashtags. X - under 280 characters including at most 2 hashtags. Google Business Profile - a short, practical update of 80 to 200 words in plain text with no hashtags; it may end with one low-key line inviting questions, never a sales pitch.

${WRITING_PROCESS}

${SELF_REVIEW}

The user message includes Nexai's business profile. Use it for audience, services and brand rules. If it contains Nexai's own Winner's Writing Process or self-review checklist, follow those instead of the stand-ins above. Mention an offer only if the brief asks for it, quote it exactly, and never mention an offer that isn't active on the post date. Don't claim results for Nexai's products unless the profile lists approved claims.

Return only the finished caption in the "caption" field, ready to paste. Put a one-sentence summary of your approach or changes in "notes".`;

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    caption: { type: 'string', description: 'The complete caption, including hashtags, ready to paste.' },
    notes: { type: 'string', description: 'One sentence on the approach taken or what changed.' },
  },
  required: ['caption', 'notes'],
  additionalProperties: false,
};

/** Plain-text summary of the business profile fields that matter for writing. */
function profileBlock(p, date) {
  if (!p || typeof p !== 'object') return '';
  const d = CAT.forGeneration(p.data || {});
  const s = (x) => String(x ?? '').slice(0, 1200);
  const on = (o) => o.active && (!o.start || o.start <= date) && (!o.end || o.end >= date);
  const active = (d.offers || []).filter(on);
  const tags = d.brand?.linkedinHashtags || {};
  return [
    `Nexai business profile (${s(p.versionId)}). Use it; don't recite it.`,
    `Services: ${(d.services || []).map((x) => `${s(x.name)} (${s(x.description)})`).join('; ')}`,
    `Audience: ${s(d.audience?.summary)}; ${s(d.audience?.size)}; buyers: ${s(d.audience?.buyers)}`,
    `Proof: ${(d.proof || []).map((x) => (x.claims ? `${s(x.name)} (approved claims: ${s(x.claims)})` : `${s(x.name)} (name only, no approved claims)`)).join('; ')}`,
    `Website call to action: "${s(d.cta?.main)}". ${s(d.cta?.organic)}`,
    `Brand: ${s(d.brand?.language)}. LinkedIn posts end with ${tags.min ?? 3} to ${tags.max ?? 5} hashtags${(tags.required || []).length ? `, always including ${tags.required.map(s).join(' ')}` : ''}.`,
    active.length ? `Offers active on ${date} (quote exactly if the brief asks for an offer): ${active.map((o) => `"${s(o.wording)}"`).join('; ')}` : `No offers are active on ${date}. Don't mention any offer.`,
    d.writing?.process ? `Nexai's Winner's Writing Process (owner's wording):\n${s(d.writing.process)}` : "Nexai's Winner's Writing Process: not supplied yet (use the stand-in).",
    d.writing?.checklist ? `Nexai's self-review checklist (owner's wording):\n${s(d.writing.checklist)}` : "Nexai's self-review checklist: not supplied yet (use the stand-in).",
  ].join('\n');
}

function buildUserMessage(req) {
  const lines = [`Platform: ${req.platform}`, `Post date: ${req.targetDate || 'not set'}`, `Job brief (from the Nexai team):\n"""\n${req.brief}\n"""`];
  if (req.profile) lines.push(profileBlock(req.profile, req.targetDate || ''));
  lines.push(catalogueBlock(req.catalogue));
  lines.push(V.promptBlock(req.tone || V.toneFor(req.brief), req.voice || V.voiceOf(req.profile?.data), req.profile?.data?.cta?.main));
  if (req.kind === 'revision') {
    lines.push(`Current caption (version ${req.currentVersion}):\n"""\n${req.currentCaption}\n"""`);
    lines.push(`Reviewer feedback, quoted exactly:\n"""\n${req.feedback}\n"""`);
    lines.push(
      'Write a revised caption that follows the feedback precisely. The feedback overrides earlier choices where they conflict. ' +
        'If the feedback sets a word limit, count every word in the caption including hashtags and stay under it. ' +
        'Keep what the feedback does not ask you to change, provided it still fits.'
    );
  } else {
    lines.push('Write the first draft of the caption for this brief.');
  }
  return lines.join('\n\n');
}

/* ---------- Validation ---------- */
function validate(body) {
  const err = (m) => ({ error: m });
  if (!body || typeof body !== 'object') return err('Request body must be JSON.');
  const { kind, brief, platform, currentCaption, feedback } = body;
  if (!['draft', 'revision'].includes(kind)) return err('kind must be "draft" or "revision".');
  if (typeof brief !== 'string' || brief.trim().length < 12 || brief.length > 4000) return err('Brief is missing or too long.');
  if (!PLATFORMS.includes(platform)) return err('Unknown platform.');
  if (kind === 'revision') {
    if (typeof currentCaption !== 'string' || !currentCaption.trim() || currentCaption.length > 6000) return err('Current caption is missing.');
    if (typeof feedback !== 'string' || !feedback.trim() || feedback.length > 2000) return err('Feedback is missing.');
  }
  return {
    value: {
      kind,
      brief: brief.trim(),
      platform,
      currentCaption: kind === 'revision' ? currentCaption : undefined,
      currentVersion: Number(body.currentVersion) || 1,
      feedback: kind === 'revision' ? feedback.trim() : undefined,
      targetDate: /^\d{4}-\d{2}-\d{2}$/.test(body.targetDate || '') ? body.targetDate : null,
      profile: body.profile && typeof body.profile === 'object' && JSON.stringify(body.profile).length < 80000 ? body.profile : null,
      catalogue: cleanCatalogue(body.catalogue),
      ...toneAndVoice(body),
    },
  };
}

/** The job's tone (from the client, or decided here from the brief) and the profile's editorial voice. */
function toneAndVoice(body) {
  const t = body.tone && ['editorial', 'promo'].includes(body.tone.mode) ? { mode: body.tone.mode, label: String(body.tone.label || '').slice(0, 120), reason: String(body.tone.reason || '').slice(0, 400) } : V.toneFor(body.brief);
  const voice = typeof body.voice === 'string' && body.voice.trim() ? body.voice.trim().slice(0, 2000) : V.voiceOf(body.profile?.data);
  return { tone: t, voice };
}

/* ---------- Generation ---------- */
class QuillError extends Error {
  constructor(message, { status = 502, retryable = true, code = 'provider_error' } = {}) {
    super(message);
    this.status = status;
    this.retryable = retryable;
    this.code = code;
  }
}

/** Map an OpenAI client error to Quill's error (keeps status, retryability and a useful message). */
const asQuillError = (e) => (e instanceof ai.AiError ? Object.assign(new QuillError(e.message, { status: e.status, retryable: e.retryable, code: e.code }), { usage: e.usage }) : new QuillError('Generation failed unexpectedly. Your work is saved; try again.', { code: 'unknown' }));

async function liveText(opts) {
  try { return await ai.textJson(opts); } catch (e) { throw asQuillError(e); }
}

async function generate(body) {
  if (PROVIDER === 'demo') throw new QuillError('No AI provider is configured on the server.', { status: 503, retryable: false, code: 'not_configured' });
  const { value, error } = validate(body);
  if (error) throw new QuillError(error, { status: 400, retryable: false, code: 'invalid' });
  if (PROVIDER === 'mock') return { ...(await mock.generate(value)), provider: 'mock', model: 'mock-quill', usage: null };
  const out = await liveText({ instructions: SYSTEM_PROMPT, input: buildUserMessage(value), schemaName: 'quill_caption', schema: OUTPUT_SCHEMA, maxOutputTokens: 6000 });
  if (!out.data.caption || typeof out.data.caption !== 'string') throw new QuillError('The model returned an empty caption. Try again.', { code: 'empty' });
  return { caption: out.data.caption.trim(), notes: String(out.data.notes || '').trim(), provider: 'openai', model: out.model, usage: out.usage };
}

module.exports = { generate, providerInfo, QuillError, buildUserMessage, profileBlock, SYSTEM_PROMPT, validate };


/* ---------- Vektor: weekly plan (one explicit request) ---------- */
const PLAN_SYSTEM = `You are Vektor, Marketing Manager for Nexai Digital's internal marketing team.
Plan a week of organic social posts for owners, managing directors and operations directors of UK commercial maintenance and building services firms.
Use natural British English. Each post must give the reader something practical they can use. Follow the tone section in the user message (by default Nexai's editorial voice; a direct-response tone only when the brief explicitly asks). No invented statistics, results, clients or quotes.
For every day you're given (date and platform are fixed), return:
- audience: who this post speaks to, specifically (one short phrase)
- angle: the single idea of the post (one sentence)
- takeaway: one practical thing the reader can do (one sentence)
- visual: a brief for the designer describing a realistic UK commercial maintenance photo to use (one or two sentences, no text in the image)
Vary the angles across the week so posts don't repeat each other, and fit each to its platform. Return exactly one entry per day, in the same order.`;

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    days: {
      type: 'array',
      items: {
        type: 'object',
        properties: { audience: { type: 'string' }, angle: { type: 'string' }, takeaway: { type: 'string' }, visual: { type: 'string' } },
        required: ['audience', 'angle', 'takeaway', 'visual'],
        additionalProperties: false,
      },
    },
  },
  required: ['days'],
  additionalProperties: false,
};

function validatePlanRequest(body) {
  if (!body || typeof body !== 'object') return { error: 'Request body must be JSON.' };
  const { brief, weekStart, days } = body;
  if (typeof brief !== 'string' || brief.trim().length < 12 || brief.length > 4000) return { error: 'Brief is missing or too long.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart || '') || new Date(`${weekStart}T00:00:00Z`).getUTCDay() !== 1) return { error: 'Week must begin on a Monday.' };
  if (!Array.isArray(days) || days.length < 1 || days.length > 7) return { error: 'Plan days are missing.' };
  for (const d of days) if (!/^\d{4}-\d{2}-\d{2}$/.test(d?.date || '') || !PLATFORMS.includes(d?.platform) || typeof d?.dayName !== 'string') return { error: 'Invalid plan day.' };
  return { value: { brief: brief.trim(), weekStart, days: days.map((d) => ({ date: d.date, platform: d.platform, dayName: d.dayName.slice(0, 12) })) } };
}

async function planWeek(body) {
  if (PROVIDER === 'demo') throw new QuillError('No AI provider is configured on the server.', { status: 503, retryable: false, code: 'not_configured' });
  const { value, error } = validatePlanRequest(body);
  if (error) throw new QuillError(error, { status: 400, retryable: false, code: 'invalid' });
  const tv = toneAndVoice(body);
  if (PROVIDER === 'mock') return { days: await mock.planWeek({ ...value, ...tv, profile: body.profile || null }), provider: 'mock', model: 'mock-vektor', usage: null };
  const prof = body.profile && typeof body.profile === 'object' && JSON.stringify(body.profile).length < 80000 ? `\n\n${profileBlock(body.profile, value.weekStart)}` : '';
  const user = `Week beginning ${value.weekStart} (Europe/London).${prof}\n\n${catalogueBlock(body.catalogue)}\n\n${V.promptBlock(tv.tone, tv.voice, body.profile?.data?.cta?.main)}\n\nBrief from the Nexai team:\n"""\n${value.brief}\n"""\n\nDays to plan, in order:\n${value.days.map((d, i) => `${i + 1}. ${d.dayName} ${d.date}: ${d.platform}`).join('\n')}`;
  const out = await liveText({ instructions: PLAN_SYSTEM, input: user, schemaName: 'vektor_week_plan', schema: PLAN_SCHEMA, maxOutputTokens: 8000 });
  const parsed = out.data;
  if (!Array.isArray(parsed.days) || parsed.days.length !== value.days.length) throw new QuillError('The plan came back with the wrong number of days. Try again.', { code: 'shape' });
  const clip = (x) => String(x || '').trim().slice(0, 400);
  return { days: parsed.days.map((d) => ({ audience: clip(d.audience), angle: clip(d.angle), takeaway: clip(d.takeaway), visual: clip(d.visual) })), provider: 'openai', model: out.model, usage: out.usage };
}

module.exports.planWeek = planWeek;

/* ---------- Cue: script and storyboard (Luna) ---------- */
const SCRIPT_SCHEMA = {
  type: 'object',
  properties: {
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        properties: { title: { type: 'string' }, duration: { type: 'number' }, from: { type: 'number' }, caption: { type: 'string' }, script: { type: 'string' } },
        required: ['title', 'duration', 'from', 'caption', 'script'],
        additionalProperties: false,
      },
    },
    notes: { type: 'string' },
  },
  required: ['scenes', 'notes'],
  additionalProperties: false,
};
const SCRIPT_SYSTEM = `You are Cue, the Video Creator for Nexai Digital's internal marketing team. You plan short social videos (15 to 30 seconds) built from a screen recording or clip the owner supplied.
Write 3 to 5 scenes. For each scene give: a short title; its length in seconds (1 to 15); "from", the second in the clip where its footage starts; an on-screen caption (at most 90 characters, plain British English, readable at a glance); and a one-line script/direction note for the editor.
The total length must be between 15 and 30 seconds, close to any length the brief asks for. Every "from" must be inside the clip. The on-screen captions are not the social post caption; don't add hashtags. Never claim results, figures or product capabilities that aren't in the brief or the profile's approved claims. Follow the tone section.`;
function validateScript(body) {
  if (!body || typeof body.brief !== 'string' || body.brief.trim().length < 12 || body.brief.length > 4000) return { error: 'Brief is missing or too long.' };
  if (!PLATFORMS.includes(body.platform)) return { error: 'Unknown platform.' };
  const d = Number(body.clipDuration);
  if (!(d > 0 && d < 3600)) return { error: 'Clip length is missing.' };
  return { value: { brief: body.brief.trim(), platform: body.platform, clipDuration: d, profile: body.profile && typeof body.profile === 'object' ? body.profile : null, catalogue: cleanCatalogue(body.catalogue), ...toneAndVoice(body) } };
}
/** Keep Cue's timings honest: inside the clip, 1–15 s per scene, 15–30 s in total. */
function tidyScenes(scenes, clipDuration) {
  const out = scenes.slice(0, 6).map((s) => ({
    title: String(s.title || 'Scene').slice(0, 60), caption: String(s.caption || '').slice(0, 120), script: String(s.script || '').slice(0, 400),
    duration: Math.min(15, Math.max(1, Math.round(Number(s.duration) * 2) / 2 || 3)), from: Math.min(Math.max(0, Math.round(Number(s.from) * 10) / 10 || 0), Math.max(0, clipDuration - 1)), footage: true,
  }));
  let total = out.reduce((a, s) => a + s.duration, 0);
  while (total > 30) { const big = out.reduce((m, s) => (s.duration > m.duration ? s : m)); big.duration -= 0.5; total -= 0.5; }
  while (total < 15) { out[out.length - 1].duration += 0.5; total += 0.5; }
  return out;
}
async function videoScript(body) {
  if (PROVIDER === 'demo') throw new QuillError('No AI provider is configured on the server.', { status: 503, retryable: false, code: 'not_configured' });
  const { value, error } = validateScript(body);
  if (error) throw new QuillError(error, { status: 400, retryable: false, code: 'invalid' });
  const user = [`Platform: ${value.platform}`, `Clip length: ${value.clipDuration} seconds`, `Job brief:\n"""\n${value.brief}\n"""`, value.profile ? profileBlock(value.profile, '') : '', catalogueBlock(value.catalogue), V.promptBlock(value.tone, value.voice, value.profile?.data?.cta?.main)].filter(Boolean).join('\n\n');
  if (PROVIDER === 'mock') { const m = await mock.videoScript(value); return { scenes: tidyScenes(m.scenes, value.clipDuration), notes: m.notes, provider: 'mock', model: 'mock-cue', usage: null }; }
  const out = await liveText({ instructions: SCRIPT_SYSTEM, input: user, schemaName: 'cue_storyboard', schema: SCRIPT_SCHEMA, maxOutputTokens: 4000 });
  if (!Array.isArray(out.data.scenes) || !out.data.scenes.length) throw new QuillError('The storyboard came back empty. Try again.', { code: 'empty' });
  return { scenes: tidyScenes(out.data.scenes, value.clipDuration), notes: String(out.data.notes || ''), provider: 'openai', model: out.model, usage: out.usage };
}

/* ---------- Calibre: optional AI wording review (advisory; the rule checks still decide) ---------- */
const WORDING_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    suggestions: { type: 'array', items: { type: 'object', properties: { quote: { type: 'string' }, issue: { type: 'string' }, suggestion: { type: 'string' } }, required: ['quote', 'issue', 'suggestion'], additionalProperties: false } },
  },
  required: ['summary', 'suggestions'],
  additionalProperties: false,
};
const WORDING_SYSTEM = `You are Calibre, the Brand & Quality Reviewer for Nexai Digital. Review the wording of one social caption against the tone section and the business profile. You are advisory: you never approve anything and you don't rewrite the whole post.
Give at most 5 specific suggestions. Each quotes the exact words it's about (copied from the caption), says what the issue is (tone, clarity, British English, an unbacked claim, a pushy call to action in an editorial post) and gives a short suggested rewording. If the wording is fine, say so and return no suggestions. Don't invent facts or figures.`;
async function wordingReview(body) {
  if (PROVIDER === 'demo') throw new QuillError('No AI provider is configured on the server.', { status: 503, retryable: false, code: 'not_configured' });
  if (!body || typeof body.caption !== 'string' || !body.caption.trim() || body.caption.length > 6000) throw new QuillError('Caption is missing.', { status: 400, retryable: false, code: 'invalid' });
  if (!PLATFORMS.includes(body.platform)) throw new QuillError('Unknown platform.', { status: 400, retryable: false, code: 'invalid' });
  const tv = toneAndVoice({ ...body, brief: body.brief || '' });
  const prof = body.profile && typeof body.profile === 'object' ? body.profile : null;
  const user = [`Platform: ${body.platform}`, prof ? profileBlock(prof, '') : '', catalogueBlock(body.catalogue), V.promptBlock(tv.tone, tv.voice, prof?.data?.cta?.main), `Caption to review:\n"""\n${body.caption}\n"""`].filter(Boolean).join('\n\n');
  let out;
  if (PROVIDER === 'mock') out = { data: mock.wordingReview(body.caption, tv.tone), model: 'mock-calibre', usage: null };
  else out = await liveText({ instructions: WORDING_SYSTEM, input: user, schemaName: 'calibre_wording', schema: WORDING_SCHEMA, maxOutputTokens: 3000 });
  // Only keep suggestions that quote words actually in the caption.
  const sugg = (out.data.suggestions || []).filter((x) => x.quote && body.caption.includes(x.quote)).slice(0, 5).map((x) => ({ quote: x.quote.slice(0, 300), issue: String(x.issue).slice(0, 300), suggestion: String(x.suggestion).slice(0, 400) }));
  return { summary: String(out.data.summary || '').slice(0, 600), suggestions: sugg, provider: PROVIDER, model: out.model, usage: out.usage };
}

/* ---------- Vantage: optional written interpretation of the actual figures ---------- */
const INTERPRET_SCHEMA = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false };
const INTERPRET_SYSTEM = `You are Vantage, the Marketing Analyst for Nexai Digital. Write a short interpretation (at most 120 words, British English) of the figures provided, for the owner.
Rules: use only the numbers given. A metric marked "not entered" is unknown, never zero, so don't compare it. Don't calculate new percentages; the click-through rates are given. With fewer than three comparable posts, say there's too little evidence for a conclusion. Don't declare a winner. Don't invent results, causes or figures. Suggest what to look at next, without promising outcomes.`;
/** Every number in the interpretation must come from the figures (or be the post count / window). */
function numbersAllowed(text, rows, window) {
  const allowed = new Set([String(rows.length), String(window), '0']);
  const add = (n) => { if (n == null) return; const x = Number(n); allowed.add(String(x)); allowed.add(x.toLocaleString('en-GB')); allowed.add(x.toFixed(1)); };
  for (const r of rows) { add(r.impressions); add(r.clicks); add(r.enquiries); if (r.ctrPct != null) { allowed.add(r.ctrPct.toFixed(1)); allowed.add(`${r.ctrPct.toFixed(1)}%`); } for (const d of [r.publishedOn, r.measuredOn]) if (d) d.split('-').forEach((p) => { allowed.add(p); allowed.add(String(Number(p))); }); }
  const found = String(text).match(/\d[\d,]*(?:\.\d+)?/g) || [];
  return found.filter((n) => !allowed.has(n) && !allowed.has(n.replace(/,/g, '')) && !allowed.has(String(Number(n.replace(/,/g, '')))));
}
async function interpret(body) {
  if (PROVIDER === 'demo') throw new QuillError('No AI provider is configured on the server.', { status: 503, retryable: false, code: 'not_configured' });
  const rows = Array.isArray(body?.rows) ? body.rows.slice(0, 40) : [];
  if (!rows.length) throw new QuillError('There are no figures to interpret yet.', { status: 400, retryable: false, code: 'invalid' });
  const num = (v) => (v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  const clean = rows.map((r) => ({ title: String(r.title || '').slice(0, 120), platform: String(r.platform || ''), publishedOn: /^\d{4}-\d{2}-\d{2}$/.test(r.publishedOn) ? r.publishedOn : null, measuredOn: /^\d{4}-\d{2}-\d{2}$/.test(r.measuredOn) ? r.measuredOn : null, sample: !!r.sample, impressions: num(r.impressions), clicks: num(r.clicks), enquiries: num(r.enquiries), ctrPct: num(r.ctrPct) }));
  const window = Number(body.window) || 7;
  const show = (v) => (v == null ? 'not entered' : String(v));
  const user = `Posts measured ${window} days after publishing (same platform comparisons only):\n${clean.map((r) => `- "${r.title}"${r.sample ? ' (SAMPLE, made-up figures)' : ''}, ${r.platform}, published ${r.publishedOn}: impressions ${show(r.impressions)}, link clicks ${show(r.clicks)}, click-through ${r.ctrPct == null ? 'not available' : `${r.ctrPct.toFixed(1)}%`}, owner-attributed enquiries ${show(r.enquiries)}`).join('\n')}`;
  let out;
  if (PROVIDER === 'mock') out = { data: { text: mock.interpret(clean, body.mockInvent) }, model: 'mock-vantage', usage: null };
  else out = await liveText({ instructions: INTERPRET_SYSTEM, input: user, schemaName: 'vantage_interpretation', schema: INTERPRET_SCHEMA, maxOutputTokens: 2000 });
  const bad = numbersAllowed(out.data.text, clean, window);
  if (bad.length) throw Object.assign(new QuillError(`The interpretation mentioned a figure that isn’t in your data (${bad.slice(0, 3).join(', ')}), so it wasn’t shown.`, { status: 422, retryable: true, code: 'invented_figure' }), { usage: out.usage, model: out.model });
  return { text: String(out.data.text).slice(0, 1200), provider: PROVIDER, model: out.model, usage: out.usage };
}

module.exports.videoScript = videoScript;
module.exports.wordingReview = wordingReview;
module.exports.interpret = interpret;
module.exports.numbersAllowed = numbersAllowed;
