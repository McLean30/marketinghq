// Quill (Copywriter) caption generation. Runs server-side only: credentials never reach the browser.
//
// Provider is chosen at start-up (see providerInfo()):
//   live  - Anthropic API via the official SDK. Enabled when ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN /
//           ANTHROPIC_PROFILE) is set in the server environment, or QUILL_PROVIDER=anthropic.
//   mock  - deterministic canned responses for repeatable tests (QUILL_PROVIDER=mock). Never used by default.
//   demo  - no provider: the browser falls back to the Milestone 1 local templates, labelled as simulated.

const Anthropic = require('@anthropic-ai/sdk').default;
const mock = require('./quill-mock');

const MODEL = process.env.QUILL_MODEL || 'claude-opus-5-5';
const PLATFORMS = ['LinkedIn', 'Instagram', 'Facebook', 'X'];

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
4. Close with a genuine question or a light, useful next thought. No pitch.`;

const SELF_REVIEW = `Before answering, silently check (working stand-in for Nexai's self-review checklist):
- Does it use the operational detail from the brief, not generic marketing language?
- Is it natural British English (spelling, idiom, tone) that a UK operations director would write themselves?
- Is every claim either from the brief or plainly framed as common experience? No invented statistics, results, client names or quotes.
- Is it useful even if the reader never contacts Nexai? No hard sell, no "book a demo", no hype words.
- Does it fit the platform conventions and any length or format limit in the feedback?`;

const SYSTEM_PROMPT = `You are Quill, the Copywriter for Nexai Digital's internal marketing team.

Audience: owners, managing directors and operations directors of UK commercial maintenance and building services firms (M&E, FM, HVAC, electrical and fire contractors). They are practical, busy and allergic to marketing fluff.

Voice: natural British English (British spelling such as "organise", "colour", "programme"; UK terms such as "job sheet", "engineer", "PPM", "reactive"). Plain, warm, direct. Short paragraphs. No em dashes. No clichés such as "game-changer", "unlock", "in today's fast-paced world". No emojis unless the brief asks.

Rules:
- Use the operational detail in the brief. Write about the reader's situation, not about Nexai.
- Give the reader something genuinely useful. Avoid hard selling and calls to buy.
- Never invent results, statistics, percentages, client names, testimonials or quotes. If a number would help, leave a clearly marked placeholder in square brackets for the team to fill in.
- Platform conventions: LinkedIn - line breaks between short paragraphs, end with 3 to 5 relevant hashtags on their own line. Instagram - conversational, up to 8 relevant hashtags at the end. Facebook - conversational, at most 2 hashtags. X - under 280 characters including at most 2 hashtags.

${WRITING_PROCESS}

${SELF_REVIEW}

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

function buildUserMessage(req) {
  const lines = [`Platform: ${req.platform}`, `Job brief (from the Nexai team):\n"""\n${req.brief}\n"""`];
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
    },
  };
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
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      // Opus 5.5: thinking is always adaptive; effort set explicitly (its default is medium).
      output_config: { effort: 'high', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
      // Server-side refusal fallback, routed by refusal category.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
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
  if (response.stop_reason === 'refusal') throw new QuillError('The model declined this request. Try rewording the brief or feedback.', { retryable: false, code: 'refusal' });
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

module.exports = { generate, providerInfo, QuillError, buildUserMessage, SYSTEM_PROMPT, validate };
