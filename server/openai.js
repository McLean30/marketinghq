// OpenAI client for HQ's live content creation. Server-side only: OPENAI_API_KEY never reaches the browser, logs or
// responses. Request formats follow OpenAI's official docs (see docs/openai-api-notes.md, verified 23 Nov 2026):
//   text   POST /v1/responses           (structured JSON output via text.format json_schema)
//   images POST /v1/images/generations  and  POST /v1/images/edits (JSON, images[].image_url as a data URL)
// No SDK dependency: plain fetch, so the request shape is explicit and testable against a local stub
// (OPENAI_BASE_URL). Nothing here decides who may spend: see paidGate() in server.js.

const BASE = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const TEXT_MODEL = (process.env.OPENAI_TEXT_MODEL || 'gpt-6-luna').trim();
const IMAGE_MODEL = (process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2.6-flare').trim();
const EFFORT = (process.env.OPENAI_REASONING_EFFORT || 'low').trim();
const IMAGE_QUALITY = (process.env.OPENAI_IMAGE_QUALITY || 'medium').trim();
const IMAGE_SIZE = (process.env.OPENAI_IMAGE_SIZE || '1024x1536').trim();
const TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 120000);
const EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh', 'max'];
if (!/^[a-z0-9][a-z0-9.\-]+$/i.test(TEXT_MODEL) || !/^[a-z0-9][a-z0-9.\-]+$/i.test(IMAGE_MODEL)) throw new Error('OPENAI_TEXT_MODEL / OPENAI_IMAGE_MODEL must be OpenAI model IDs (e.g. gpt-6-luna, gpt-image-2.6-flare).');
if (!EFFORTS.includes(EFFORT)) throw new Error(`OPENAI_REASONING_EFFORT must be one of ${EFFORTS.join(', ')}.`);
if (!['low', 'medium', 'high', 'auto'].includes(IMAGE_QUALITY)) throw new Error('OPENAI_IMAGE_QUALITY must be low, medium, high or auto.');

const hasKey = () => !!(process.env.OPENAI_API_KEY || '').trim();

/* ---------- Prices for estimates (Standard tier list prices per 1M tokens, from developers.openai.com/api/docs/pricing) ---------- */
const PRICE_SOURCE = 'OpenAI Standard list prices, checked 23 Nov 2026';
const DEFAULT_PRICES = {
  'gpt-6-luna': { kind: 'text', input: 0.10, cached: 0.01, output: 0.50 },
  'gpt-image-2.6-flare': { kind: 'image', textInput: 5.00, textCached: 1.25, imageInput: 8.00, imageCached: 2.00, imageOutput: 30.00 },
};
let PRICES = DEFAULT_PRICES;
try { if (process.env.OPENAI_PRICES) PRICES = { ...DEFAULT_PRICES, ...JSON.parse(process.env.OPENAI_PRICES) }; } catch { throw new Error('OPENAI_PRICES must be JSON.'); }

/** Estimated cost in US dollars from the usage OpenAI returned. null if no price is known for the model. */
function estimateCost(model, usage) {
  const p = PRICES[model] || PRICES[String(model).replace(/-\d{4}-\d{2}-\d{2}$/, '')];
  if (!p || !usage) return null;
  const M = 1e6;
  if (p.kind === 'text') {
    const cached = usage.input_tokens_details?.cached_tokens || 0;
    return ((usage.input_tokens - cached) * p.input + cached * p.cached + (usage.output_tokens || 0) * p.output) / M;
  }
  const inText = usage.input_tokens_details?.text_tokens ?? usage.input_tokens ?? 0;
  const inImage = usage.input_tokens_details?.image_tokens || 0;
  const outImage = usage.output_tokens_details?.image_tokens ?? usage.output_tokens ?? 0;
  return (inText * p.textInput + inImage * p.imageInput + outImage * p.imageOutput) / M;
}
/** The usage record HQ keeps (numbers only; never prompts or keys). */
function usageRecord(model, usage) {
  const u = usage || {};
  return {
    model,
    inputTokens: u.input_tokens ?? null,
    cachedTokens: u.input_tokens_details?.cached_tokens ?? null,
    outputTokens: u.output_tokens ?? null,
    reasoningTokens: u.output_tokens_details?.reasoning_tokens ?? null,
    imageInputTokens: u.input_tokens_details?.image_tokens ?? null,
    imageOutputTokens: u.output_tokens_details?.image_tokens ?? null,
    totalTokens: u.total_tokens ?? null,
    estCostUsd: estimateCost(model, usage),
    priceSource: PRICE_SOURCE,
  };
}

class AiError extends Error {
  constructor(message, { status = 502, retryable = true, code = 'provider_error' } = {}) { super(message); this.status = status; this.retryable = retryable; this.code = code; }
}

async function call(pathname, body) {
  if (!hasKey()) throw new AiError('OPENAI_API_KEY isn’t set on the HQ server.', { status: 503, retryable: false, code: 'not_configured' });
  let r;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    r = await fetch(`${BASE}${pathname}`, { method: 'POST', signal: ac.signal, headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY.trim()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch (e) {
    console.warn('[ai] OpenAI request failed:', e.name === 'AbortError' ? 'timeout' : e.cause?.code || e.cause?.message || e.message);
    throw new AiError(e.name === 'AbortError' ? `OpenAI didn’t answer within ${Math.round(TIMEOUT_MS / 1000)} seconds. Your work is saved; try again.` : 'Couldn’t reach OpenAI. Check the server’s connection, then try again.', { code: e.name === 'AbortError' ? 'timeout' : 'connection' });
  } finally { clearTimeout(t); }
  let data = {};
  try { data = await r.json(); } catch { /* non-JSON error page */ }
  if (r.ok) return data;
  const code = data?.error?.code || data?.error?.type || '';
  if (r.status === 401) throw new AiError('OpenAI rejected the server’s API key. Check OPENAI_API_KEY on the HQ server.', { status: 502, retryable: false, code: 'auth' });
  if (r.status === 403) throw new AiError('OpenAI refused this request from the server’s location or project settings.', { status: 502, retryable: false, code: 'forbidden' });
  if (r.status === 429 && /credit_balance_exhausted|insufficient_quota/.test(code)) throw new AiError('The OpenAI account has no credit left. Add credit in the OpenAI dashboard, then try again.', { status: 402, retryable: false, code: 'no_credit' });
  if (r.status === 429 && /spend_limit/.test(code)) throw new AiError('The OpenAI spend limit for this project or organisation has been reached.', { status: 402, retryable: false, code: 'spend_limit' });
  if (r.status === 429) throw new AiError('OpenAI is rate limiting requests. Wait a moment, then try again.', { status: 429, code: 'rate_limit' });
  if (r.status === 400) throw new AiError(`OpenAI rejected the request as invalid${data?.error?.message ? `: ${String(data.error.message).slice(0, 200)}` : ''}.`, { status: 502, retryable: false, code: 'bad_request' });
  throw new AiError(`OpenAI returned an error (${r.status}). Your work is saved; try again in a moment.`, { status: 502, code: 'api_error' });
}

/** One structured JSON response from the text model. Returns { data, usage, model, responseId }. */
async function textJson({ instructions, input, schemaName, schema, maxOutputTokens = 4000 }) {
  const res = await call('/responses', {
    model: TEXT_MODEL, instructions, input, store: false, max_output_tokens: maxOutputTokens,
    reasoning: { effort: EFFORT },
    text: { format: { type: 'json_schema', name: schemaName, schema, strict: true } },
  });
  const model = res.model || TEXT_MODEL;
  const usage = usageRecord(model, res.usage);
  const content = (res.output || []).filter((o) => o.type === 'message').flatMap((o) => o.content || []);
  const refusal = content.find((c) => c.type === 'refusal');
  if (refusal) throw Object.assign(new AiError(`${model} declined this request. Reword the brief and try again.`, { retryable: false, code: 'refusal' }), { usage });
  if (res.status === 'incomplete') throw Object.assign(new AiError(`The response was cut off (${res.incomplete_details?.reason || 'incomplete'}). Try again.`, { code: 'incomplete' }), { usage });
  const text = content.filter((c) => c.type === 'output_text').map((c) => c.text).join('');
  let data;
  try { data = JSON.parse(text); } catch { throw Object.assign(new AiError('The model’s reply couldn’t be read. Try again.', { code: 'parse' }), { usage }); }
  return { data, usage, model, responseId: res.id || null };
}

/** Generate one image, or edit one (base = { mime, buffer }). Returns { buffer, mime, usage, model, size }. */
async function image({ prompt, base = null }) {
  const body = { model: IMAGE_MODEL, prompt, size: IMAGE_SIZE, quality: IMAGE_QUALITY, output_format: 'jpeg', output_compression: 88 };
  const res = base
    ? await call('/images/edits', { ...body, images: [{ image_url: `data:${base.mime};base64,${base.buffer.toString('base64')}` }] })
    : await call('/images/generations', { ...body, n: 1 });
  const b64 = res.data?.[0]?.b64_json;
  const model = IMAGE_MODEL;
  const usage = usageRecord(model, res.usage);
  if (!b64) throw Object.assign(new AiError('OpenAI returned no image. Try again.', { code: 'empty' }), { usage });
  return { buffer: Buffer.from(b64, 'base64'), mime: 'image/jpeg', usage, model, size: res.size || IMAGE_SIZE };
}

/* ---------- One paid call per explicit action ----------
   Every paid request carries a requestKey made when you tap (and saved with the job). A double tap, a refresh, a
   second device or a retry with the same key gets the first result back instead of a second charge. Failures aren't
   cached, so an explicit retry after an error makes one new call. The claim lives in the workspace store, so this
   holds across server instances (Vercel) as well as on one machine. */
const KEY = /^[A-Za-z0-9:_.-]{8,160}$/;
async function once(requestKey, fn) {
  if (!KEY.test(requestKey || '')) throw new AiError('Missing or invalid request key.', { status: 400, retryable: false, code: 'invalid' });
  const { result, duplicate } = await require('./backend').store().once(requestKey, fn);
  return duplicate ? { ...result, duplicate: true } : result;
}

/* ---------- Usage ledger (workspace store; numbers only) ---------- */
async function record(entry) {
  try { await require('./backend').store().usageAdd(entry); } catch (e) { console.warn('[ai] usage not recorded:', e.code || e.message); }
}
const ledger = async (jobId) => { try { return await require('./backend').store().usageList(jobId); } catch { return []; } };

module.exports = { textJson, image, once, record, ledger, estimateCost, usageRecord, AiError, hasKey, TEXT_MODEL, IMAGE_MODEL, EFFORT, IMAGE_QUALITY, IMAGE_SIZE, PRICE_SOURCE, PRICES };
