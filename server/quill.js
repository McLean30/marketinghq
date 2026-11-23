// Quill (Copywriter) caption generation. Runs server-side only: credentials never reach the browser.
//
// Provider is chosen at start-up (see providerInfo()):
//   live  - Anthropic API via the official SDK. Enabled when ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN /
//           ANTHROPIC_PROFILE) is set in the server environment, or QUILL_PROVIDER=anthropic.
//   mock  - deterministic canned responses for repeatable tests (QUILL_PROVIDER=mock). Never used by default.
//   demo  - no provider: the browser falls back to the Milestone 1 local templates, labelled as simulated.

const Anthropic = require('@anthropic-ai/sdk').default;
const mock = require('./quill-mock');
const V = require('../public/js/voice.js'); // the same tone rules the browser uses

// Model and effort are server-side settings. Default: Claude Sonnet 5.5 at medium effort, a cost-effective
// choice for short social captions (verified against platform.claude.com docs, November 2026).
// Examples: QUILL_MODEL=claude-opus-5-5 QUILL_EFFORT=high for harder briefs; QUILL_MODEL=claude-haiku-5-5 for lowest cost.
const MODEL = (process.env.QUILL_MODEL || 'claude-sonnet-5-5').trim();
const EFFORT = (process.env.QUILL_EFFORT || 'medium').trim().toLowerCase();
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
if (!/^claude-[a-z0-9-]+$/.test(MODEL)) throw new Error(`QUILL_MODEL "${MODEL}" is not a valid Claude model ID (e.g. claude-sonnet-5-5).`);
if (!EFFORTS.includes(EFFORT)) throw new Error(`QUILL_EFFORT must be one of ${EFFORTS.join(', ')}.`);
const PLATFORMS = ['LinkedIn', 'Instagram', 'Facebook', 'X', 'Google Business Profile'];

function resolveProvider() {
  const forced = (process.env.QUILL_PROVIDER || '').toLowerCase();
  if (forced === 'mock') return 'mock';
  if (forced === 'demo' || forced === 'off') return 'demo';
  if (forced === 'anthropic') return 'live';
  const hasCreds = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_PROFILE'].some((k) => (process.env[k] || '').trim());
  return hasCreds ? 'live' : 'demo';
}

const PROVIDER = resolveProvider();
let client = null;
if (PROVIDER === 'live') {
  // Zero-arg constructor resolves credentials from the environment; we never read or log the key ourselves.
  client = new Anthropic({ timeout: 120 * 1000, maxRetries: 2 });
}

function providerInfo() {
  return {
    provider: PROVIDER,
    model: PROVIDER === 'live' ? MODEL : PROVIDER === 'mock' ? 'mock-quill' : null,
    effort: PROVIDER === 'live' ? EFFORT : null,
    label: PROVIDER === 'live' ? 'Anthropic API' : PROVIDER === 'mock' ? 'Mock provider (tests)' : 'Local demo templates',
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
  const d = p.data || {};
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

async function callAnthropic(req) {
  let response;
  try {
    // No `fallbacks`: only the configured model handles a brief. A refusal is reported back, not rerouted.
    // `thinking` is omitted, so current models run adaptive thinking; effort is the cost/depth control.
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: EFFORT, format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserMessage(req) }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError)
      throw new QuillError('The Anthropic API rejected the server credentials. Check ANTHROPIC_API_KEY on the server.', { status: 502, retryable: false, code: 'auth' });
    if (e instanceof Anthropic.RateLimitError) throw new QuillError('The Anthropic API is rate limiting requests. Wait a moment, then retry.', { code: 'rate_limit' });
    if (e instanceof Anthropic.BadRequestError) throw new QuillError('The caption request was rejected as invalid.', { status: 502, retryable: false, code: 'bad_request' });
    if (e instanceof Anthropic.APIConnectionError) throw new QuillError('Could not reach the Anthropic API. Check the connection, then retry.', { code: 'connection' });
    if (e instanceof Anthropic.APIError) throw new QuillError(`The Anthropic API returned an error (${e.status ?? 'unknown'}). Retry in a moment.`, { code: 'api_error' });
    throw new QuillError('Caption generation failed unexpectedly. Retry in a moment.', { code: 'unknown' });
  }
  if (response.stop_reason === 'refusal') throw new QuillError(`${MODEL} declined this request. Reword the brief or feedback, or choose another model in QUILL_MODEL.`, { retryable: false, code: 'refusal' });
  if (response.stop_reason === 'max_tokens') throw new QuillError('The caption was cut off before it finished. Retry.', { code: 'truncated' });
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new QuillError('The model response could not be read. Retry.', { code: 'parse' });
  }
  if (!parsed.caption || typeof parsed.caption !== 'string') throw new QuillError('The model returned an empty caption. Retry.', { code: 'empty' });
  return { caption: parsed.caption.trim(), notes: String(parsed.notes || '').trim(), model: response.model || MODEL };
}

async function generate(body) {
  if (PROVIDER === 'demo') throw new QuillError('No AI provider is configured on the server.', { status: 503, retryable: false, code: 'not_configured' });
  const { value, error } = validate(body);
  if (error) throw new QuillError(error, { status: 400, retryable: false, code: 'invalid' });
  if (PROVIDER === 'mock') return { ...(await mock.generate(value)), provider: 'mock', model: 'mock-quill' };
  const out = await callAnthropic(value);
  return { ...out, provider: 'anthropic' };
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
  if (PROVIDER === 'mock') return { days: await mock.planWeek({ ...value, ...tv, profile: body.profile || null }), provider: 'mock', model: 'mock-vektor' };
  const prof = body.profile && typeof body.profile === 'object' && JSON.stringify(body.profile).length < 80000 ? `\n\n${profileBlock(body.profile, value.weekStart)}` : '';
  const user = `Week beginning ${value.weekStart} (Europe/London).${prof}\n\n${V.promptBlock(tv.tone, tv.voice, body.profile?.data?.cta?.main)}\n\nBrief from the Nexai team:\n"""\n${value.brief}\n"""\n\nDays to plan, in order:\n${value.days.map((d, i) => `${i + 1}. ${d.dayName} ${d.date}: ${d.platform}`).join('\n')}`;
  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: EFFORT, format: { type: 'json_schema', schema: PLAN_SCHEMA } },
      system: PLAN_SYSTEM,
      messages: [{ role: 'user', content: user }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new QuillError('The Anthropic API rejected the server credentials. Check ANTHROPIC_API_KEY on the server.', { retryable: false, code: 'auth' });
    if (e instanceof Anthropic.RateLimitError) throw new QuillError('The Anthropic API is rate limiting requests. Wait a moment, then try again.', { code: 'rate_limit' });
    if (e instanceof Anthropic.APIConnectionError) throw new QuillError('Could not reach the Anthropic API.', { code: 'connection' });
    if (e instanceof Anthropic.APIError) throw new QuillError(`The Anthropic API returned an error (${e.status ?? 'unknown'}).`, { code: 'api_error' });
    throw new QuillError('Planning failed unexpectedly.', { code: 'unknown' });
  }
  if (response.stop_reason === 'refusal') throw new QuillError(`${MODEL} declined this request. Reword the brief.`, { retryable: false, code: 'refusal' });
  let parsed;
  try { parsed = JSON.parse(response.content.filter((b) => b.type === 'text').map((b) => b.text).join('')); } catch { throw new QuillError('The plan could not be read. Try again.', { code: 'parse' }); }
  if (!Array.isArray(parsed.days) || parsed.days.length !== value.days.length) throw new QuillError('The plan came back with the wrong number of days. Try again.', { code: 'shape' });
  const clip = (x) => String(x || '').trim().slice(0, 400);
  return { days: parsed.days.map((d) => ({ audience: clip(d.audience), angle: clip(d.angle), takeaway: clip(d.takeaway), visual: clip(d.visual) })), provider: 'anthropic', model: response.model || MODEL };
}

module.exports.planWeek = planWeek;
