// Exercises the real OpenAI code path (server/openai.js via server.js) against a local stub of the OpenAI API.
// No real key and no network: a dummy key is used and OPENAI_BASE_URL points at the stub. Checks the request shapes
// against OpenAI's documented formats (docs/openai-api-notes.md), the owner gate, one charge per request key, usage
// and cost recording, and error mapping that never leaks the key.
import { fileURLToPath } from 'url';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { hashPassword } = require('../server/auth');
const { mockPng } = require('../server/mock-image');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const STUB_PORT = 4211;
const APP_PORT = 4191;
const KEY = 'sk-dummy-test-key-not-real';
const PASSWORD = 'openai-path-test-password';
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`  ok  ${m}`); };
const seen = [];
let mode = 'ok';
const jpeg = mockPng('stub', 64, 96).toString('base64');
const textUsage = { input_tokens: 1200, input_tokens_details: { cached_tokens: 200 }, output_tokens: 300, output_tokens_details: { reasoning_tokens: 100 }, total_tokens: 1500 };
const imageUsage = { input_tokens: 50, input_tokens_details: { text_tokens: 50, image_tokens: 0 }, output_tokens: 1000, output_tokens_details: { image_tokens: 1000, text_tokens: 0 }, total_tokens: 1050 };

const stub = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const b = JSON.parse(body || '{}');
    seen.push({ url: req.url, headers: req.headers, body: b });
    const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (mode === 'auth') return send(401, { error: { message: 'Incorrect API key provided', type: 'invalid_request_error', code: 'invalid_api_key' } });
    if (mode === 'credit') return send(429, { error: { message: 'You exceeded your current quota', type: 'insufficient_quota', code: 'insufficient_quota' } });
    if (mode === 'down') return send(500, { error: { message: 'server error' } });
    if (req.url.startsWith('/v1/images/')) {
      const usage = req.url.endsWith('edits') ? { ...imageUsage, input_tokens: 650, input_tokens_details: { text_tokens: 50, image_tokens: 600 }, total_tokens: 1650 } : imageUsage;
      return send(200, { created: 1, data: [{ b64_json: jpeg }], output_format: 'jpeg', size: b.size, quality: b.quality, usage });
    }
    const msg = (obj) => send(200, { id: 'resp_stub', object: 'response', status: 'completed', model: b.model, output: [{ type: 'reasoning', id: 'rs_1', summary: [] }, { type: 'message', id: 'msg_1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(obj), annotations: [] }] }], usage: textUsage });
    if (mode === 'refusal') return send(200, { id: 'resp_r', status: 'completed', model: b.model, output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'I can’t help with that.' }] }], usage: textUsage });
    if (mode === 'incomplete') return send(200, { id: 'resp_i', status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, model: b.model, output: [], usage: textUsage });
    const name = b.text?.format?.name;
    if (name === 'vektor_week_plan') return msg({ days: Array.from({ length: 5 }, (_, i) => ({ audience: `Audience ${i}`, angle: `Angle ${i}`, takeaway: `Takeaway ${i}`, visual: `Visual ${i}` })) });
    if (name === 'cue_storyboard') return msg({ scenes: [1, 2, 3].map((i) => ({ title: `Scene ${i}`, duration: 6, from: (i - 1) * 6, caption: `On-screen ${i}`, script: `Voice ${i}` })), notes: 'Stub script.' });
    if (name === 'calibre_wording') return msg({ summary: 'Clear and practical.', suggestions: [{ quote: 'Stub caption.', issue: 'Tighter.', suggestion: 'Stub caption, shorter.' }, { quote: 'Not in the caption', issue: 'y', suggestion: 'x' }] });
    if (name === 'vantage_interpretation') return msg({ text: mode === 'invent' ? 'The first post converted 37% better.' : 'The first post reached 1,000 people and earned 20 link clicks, a click-through of 2.0%.' });
    return msg({ caption: 'Stub caption.\n\n#BuildingServices #NexaiDigital', notes: 'Stub notes.' });
  });
});
await new Promise((r) => stub.listen(STUB_PORT, '127.0.0.1', r));

function startApp(extraEnv, port) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-openai-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HQ_DATA_DIR: data, QUILL_PROVIDER: '', AI_PROVIDER: '', OPENAI_API_KEY: KEY, OPENAI_BASE_URL: `http://127.0.0.1:${STUB_PORT}/v1`, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const ready = new Promise((res) => {
    child.stdout.on('data', () => /provider/.test(out) && res('ready'));
    child.on('exit', (code) => res(`exit ${code}`));
  });
  return { child, ready, output: () => out, data };
}

const results = [];
try {
  console.log('\n== Key only, no owner sign-in configured: live AI stays off ==');
  const open = startApp({ HQ_OWNER_PASSWORD_HASH: '' }, APP_PORT + 5);
  assert((await open.ready) === 'ready', 'Server starts with a key but no owner sign-in');
  let st = await (await fetch(`http://127.0.0.1:${APP_PORT + 5}/api/quill/status`)).json();
  assert(st.provider === 'demo' && st.liveBlocked === 'owner_signin_required', 'Status reports demo mode: a server key alone doesn’t enable spending');
  const before = seen.length;
  let r = await fetch(`http://127.0.0.1:${APP_PORT + 5}/api/quill/caption`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestKey: 'anon-test-0001', kind: 'draft', brief: 'A brief long enough to pass validation.', platform: 'LinkedIn' }) });
  assert(r.status === 403 && (await r.json()).code === 'owner_signin_required' && seen.length === before, 'Anonymous caption request refused (403) and OpenAI never called');
  r = await fetch(`http://127.0.0.1:${APP_PORT + 5}/api/prism/image`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestKey: 'anon-test-0002', op: 'generate', prompt: 'Engineer at a panel' }) });
  assert(r.status === 403 && seen.length === before, 'Anonymous image request refused and OpenAI never called');
  open.child.kill();

  console.log('\n== Owner sign-in configured ==');
  const app = startApp({ HQ_OWNER_PASSWORD_HASH: hashPassword(PASSWORD), HQ_TEST_FIXTURES: '1' }, APP_PORT);
  results.push(app);
  assert((await app.ready) === 'ready', 'Server starts');
  assert(/gpt-6-luna/.test(app.output()) && !app.output().includes(KEY), 'Start-up log names gpt-6-luna and never prints the key');
  const BASE = `http://127.0.0.1:${APP_PORT}/`;
  // Milestone 14: a private workspace tells a signed-out visitor nothing about its AI set-up.
  const qs = await fetch(`${BASE}api/quill/status`);
  st = await qs.json();
  assert(qs.status === 401 && !st.provider && !st.model, 'Signed-out visitor is refused (401) and learns nothing about the AI set-up');
  r = await fetch(`${BASE}api/quill/caption`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestKey: 'anon-test-0003', kind: 'draft', brief: 'A brief long enough to pass validation.', platform: 'LinkedIn' }) });
  assert(r.status === 401 && seen.length === before, 'Signed-out caption request refused (401) with no OpenAI call');
  r = await fetch(`${BASE}api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) });
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  assert(r.ok && cookie.startsWith('hq_session='), 'Owner signs in');
  const H = { 'content-type': 'application/json', cookie };
  const post = (p, body) => fetch(`${BASE}${p}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  st = await (await fetch(`${BASE}api/quill/status`, { headers: H })).json();
  assert(st.provider === 'openai' && st.model === 'gpt-6-luna' && st.imageModel === 'gpt-image-2.6-flare' && st.effort === 'low', 'Signed-in owner: live OpenAI, gpt-6-luna text, gpt-image-2.6-flare images');

  console.log('\n== Captions (Responses API) ==');
  const brief = 'Write for an M&E service manager who gets to Friday afternoon with three completed jobs still waiting on engineer photos.';
  const profile = { versionId: 'pv3-abc123', data: { services: [{ name: 'Custom Business Software', description: 'Job management' }], audience: { summary: 'UK commercial building maintenance firms', size: '30–75 employees', buyers: 'Owners, MDs and Operations Directors' }, proof: [{ name: 'JobTrack Pro', claims: '' }], cta: { main: 'Request a Free Workflow Review', organic: 'No hard selling.' }, brand: { language: 'British English', linkedinHashtags: { min: 3, max: 5, required: ['#NexaiDigital'] } }, offers: [], writing: { process: '', checklist: 'Owner checklist item.' } } };
  r = await post('api/quill/caption', { requestKey: 'job1:cap:0001', jobId: 'job1', kind: 'draft', brief, platform: 'LinkedIn', targetDate: '2026-12-04', profile });
  const cap = await r.json();
  assert(r.status === 200 && cap.provider === 'openai' && cap.model === 'gpt-6-luna' && cap.caption.startsWith('Stub caption'), 'Caption parsed from output[].message.content[].output_text');
  let req = seen.at(-1);
  assert(req.url === '/v1/responses' && req.headers.authorization === `Bearer ${KEY}`, 'POST /v1/responses with the server key as a Bearer token');
  assert(req.body.model === 'gpt-6-luna' && req.body.store === false && req.body.reasoning?.effort === 'low' && typeof req.body.max_output_tokens === 'number', 'Body: model, store:false, reasoning.effort, max_output_tokens');
  assert(req.body.text?.format?.type === 'json_schema' && req.body.text.format.strict === true && req.body.text.format.name === 'quill_caption', 'Structured output via text.format json_schema (strict)');
  assert(/British English/.test(req.body.instructions) && typeof req.body.input === 'string' && req.body.input.includes(brief) && req.body.input.includes('Owners, MDs and Operations Directors'), 'Instructions carry the voice; input carries the brief and business profile');
  assert(!('temperature' in req.body) && !('messages' in req.body), 'No Chat Completions fields or sampling overrides');
  assert(cap.usage && cap.usage.inputTokens === 1200 && cap.usage.cachedTokens === 200 && cap.usage.outputTokens === 300 && cap.usage.reasoningTokens === 100, 'Usage recorded from the response (input, cached, output, reasoning)');
  const expected = (1000 * 0.10 + 200 * 0.01 + 300 * 0.50) / 1e6;
  assert(Math.abs(cap.usage.estCostUsd - expected) < 1e-12, `Estimated cost uses gpt-6-luna list prices ($${expected.toFixed(6)})`);

  let calls = seen.length;
  const [d1, d2] = await Promise.all([post('api/quill/caption', { requestKey: 'job1:cap:0002', jobId: 'job1', kind: 'draft', brief, platform: 'LinkedIn' }), post('api/quill/caption', { requestKey: 'job1:cap:0002', jobId: 'job1', kind: 'draft', brief, platform: 'LinkedIn' })]);
  const [j1, j2] = [await d1.json(), await d2.json()];
  assert(seen.length === calls + 1 && j1.caption === j2.caption && (j1.duplicate || j2.duplicate), 'Double tap (same key, concurrent): one OpenAI call, both get the same caption');
  r = await post('api/quill/caption', { requestKey: 'job1:cap:0002', jobId: 'job1', kind: 'draft', brief, platform: 'LinkedIn' });
  assert(seen.length === calls + 1 && (await r.json()).duplicate === true, 'Retry after a lost reply (same key): no second call');
  r = await post('api/quill/caption', { jobId: 'job1', kind: 'draft', brief, platform: 'LinkedIn' });
  assert(r.status === 400 && seen.length === calls + 1, 'Live request without a request key refused before calling OpenAI');

  r = await post('api/quill/caption', { requestKey: 'job1:rev:0001', jobId: 'job1', kind: 'revision', brief, platform: 'LinkedIn', currentCaption: 'Old caption v1', currentVersion: 1, feedback: 'Cut it to under 100 words.' });
  assert(r.status === 200 && seen.at(-1).body.input.includes('Old caption v1') && seen.at(-1).body.input.includes('Cut it to under 100 words.'), 'Revision sends the current caption and the exact feedback');

  console.log('\n== Images (generations and edits) ==');
  calls = seen.length;
  r = await post('api/prism/image', { requestKey: 'job1:img:0001', jobId: 'job1', op: 'generate', prompt: 'Engineer checking a fire alarm panel in a school corridor', platform: 'LinkedIn' });
  const img = await r.json();
  req = seen.at(-1);
  assert(r.status === 200 && img.assetId && img.model === 'gpt-image-2.6-flare' && img.provider === 'openai', 'Image generated and saved as a workspace asset');
  assert(req.url === '/v1/images/generations' && req.body.model === 'gpt-image-2.6-flare' && req.body.n === 1 && req.body.size === '1024x1536' && req.body.quality === 'medium' && req.body.output_format === 'jpeg', 'POST /v1/images/generations: model, n:1, 1024x1536, quality, jpeg');
  assert(/Never draw any logo/.test(req.body.prompt) && /#1E6BFF/.test(req.body.prompt), 'Prompt carries the Nexai brand palette and tells the model never to draw a logo or text (added locally)');
  const imgCost = (50 * 5 + 1000 * 30) / 1e6;
  assert(img.usage.imageOutputTokens === 1000 && Math.abs(img.usage.estCostUsd - imgCost) < 1e-12, `Image usage and cost recorded ($${imgCost.toFixed(4)})`);
  const asset = await fetch(`${BASE}api/assets/${img.assetId}`, { headers: H });
  assert(asset.ok && (asset.headers.get('content-type') || '').startsWith('image/'), 'Generated image is served from the shared workspace');
  r = await post('api/prism/image', { requestKey: 'job1:img:0001', jobId: 'job1', op: 'generate', prompt: 'Engineer checking a fire alarm panel in a school corridor' });
  assert(seen.length === calls + 1 && (await r.json()).assetId === img.assetId, 'Repeated image request (same key): same image, no second charge');
  r = await post('api/prism/image', { requestKey: 'job1:img:0002', jobId: 'job1', op: 'edit', prompt: 'Make it early morning light', baseAssetId: img.assetId });
  const ed = await r.json();
  req = seen.at(-1);
  assert(r.status === 200 && req.url === '/v1/images/edits' && req.body.model === 'gpt-image-2.6-flare' && /^data:image\/[a-z]+;base64,/.test(req.body.images?.[0]?.image_url || ''), 'Edit: POST /v1/images/edits (JSON) with the current image as a data URL and the model named');
  assert(ed.usage.imageInputTokens === 600 && ed.assetId !== img.assetId, 'Edit usage includes image input tokens; a new asset is saved, the original kept');

  console.log('\n== Cue, Calibre, Vantage, Vektor ==');
  r = await post('api/video/script', { requestKey: 'job2:script:0001', jobId: 'job2', brief, platform: 'Instagram', clipDuration: 20 });
  const sc = await r.json();
  assert(r.status === 200 && sc.scenes.length === 3 && seen.at(-1).body.text.format.name === 'cue_storyboard' && sc.scenes.reduce((a, s) => a + s.duration, 0) <= 30, 'Cue: script and storyboard from gpt-6-luna, timings within the clip');
  r = await post('api/review/wording', { requestKey: 'job1:wr:0001', jobId: 'job1', caption: 'Stub caption.\n\n#BuildingServices #NexaiDigital', platform: 'LinkedIn', brief });
  const wr = await r.json();
  assert(r.status === 200 && wr.suggestions.length === 1 && wr.suggestions[0].quote === 'Stub caption.', 'Calibre: wording suggestions kept only when they quote the caption');
  const rows = [{ title: 'Post A', platform: 'LinkedIn', publishedOn: '2026-11-02', measuredOn: '2026-11-09', impressions: 1000, clicks: 20, enquiries: null, ctrPct: 2.0 }];
  r = await post('api/analyst/interpret', { requestKey: 'interpret:0001', rows, window: 7 });
  const it = await r.json();
  assert(r.status === 200 && /1,000/.test(it.text) && /not entered/.test(seen.at(-1).body.input) && !/enquiries 0/.test(seen.at(-1).body.input), 'Vantage: interpretation of the actual figures; an unknown metric is sent as “not entered”, never 0');
  mode = 'invent';
  r = await post('api/analyst/interpret', { requestKey: 'interpret:0002', rows, window: 7 });
  const inv = await r.json();
  assert(r.status === 422 && inv.code === 'invented_figure' && !inv.text, 'Vantage: a figure not in the data is rejected and not shown');
  mode = 'ok';
  const planDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map((dayName, i) => ({ dayName, date: `2026-11-2${3 + i}`, platform: ['LinkedIn', 'Facebook', 'Google Business Profile', 'Facebook', 'LinkedIn'][i] }));
  r = await post('api/vektor/plan', { requestKey: 'plan:0001', brief, weekStart: '2026-11-23', days: planDays });
  const plan = await r.json();
  assert(r.status === 200 && plan.provider === 'openai' && plan.days.length === 5 && plan.usage?.totalTokens === 1500 && seen.at(-1).body.input.includes(brief), 'Vektor: weekly plan, usage recorded');

  console.log('\n== Failures ==');
  for (const [m, code, test] of [['refusal', 'refusal', 'Refusal'], ['incomplete', 'incomplete', 'Cut-off (incomplete) response'], ['auth', 'auth', 'Bad key'], ['credit', 'no_credit', 'No credit'], ['down', 'api_error', 'OpenAI 500']]) {
    mode = m;
    r = await post('api/quill/caption', { requestKey: `job1:fail:${m}:01`, jobId: 'job1', kind: 'draft', brief, platform: 'LinkedIn' });
    const e = await r.json();
    assert(r.status >= 400 && e.code === code && e.error && !JSON.stringify(e).includes(KEY), `${test}: clear error (${code}), no key in the reply`);
  }
  mode = 'down';
  calls = seen.length;
  await post('api/quill/caption', { requestKey: 'job1:retry:0001', jobId: 'job1', kind: 'draft', brief, platform: 'LinkedIn' });
  mode = 'ok';
  r = await post('api/quill/caption', { requestKey: 'job1:retry:0001', jobId: 'job1', kind: 'draft', brief, platform: 'LinkedIn' });
  assert(r.status === 200 && seen.length === calls + 2, 'A failed request isn’t cached: an explicit retry makes one new call and succeeds');
  assert(!app.output().includes(KEY), 'Server log never contains the key');

  console.log('\n== Usage ledger ==');
  const led = await (await fetch(`${BASE}api/ai/usage?jobId=job1`, { headers: H })).json();
  const kinds = led.entries.map((x) => x.kind);
  assert(kinds.includes('caption') && kinds.includes('caption-revision') && kinds.includes('image-generate') && kinds.includes('image-edit'), 'Ledger has caption, revision, image and image-edit entries for the job');
  assert(led.entries.filter((x) => x.requestKey === 'job1:img:0001').length === 1, 'A repeated request is recorded once');
  assert(!fs.readFileSync(path.join(app.data, 'ai-usage.json'), 'utf8').includes(KEY), 'Ledger file holds numbers only (no key)');
  r = await fetch(`${BASE}api/ai/usage?jobId=job1`);
  assert(r.status === 401, 'Usage ledger is owner-only');
  app.child.kill();

  console.log('\n== Model settings ==');
  const alt = startApp({ HQ_OWNER_PASSWORD_HASH: hashPassword(PASSWORD), HQ_TEST_FIXTURES: '1', OPENAI_TEXT_MODEL: 'gpt-6-luna-mini', OPENAI_IMAGE_MODEL: 'gpt-image-2.6-sunburst', OPENAI_REASONING_EFFORT: 'medium' }, APP_PORT + 1);
  assert((await alt.ready) === 'ready' && /gpt-6-luna-mini/.test(alt.output()), 'OPENAI_TEXT_MODEL / OPENAI_IMAGE_MODEL / OPENAI_REASONING_EFFORT override the defaults');
  alt.child.kill();
  const bad = startApp({ OPENAI_REASONING_EFFORT: 'extreme' }, APP_PORT + 2);
  assert((await bad.ready).startsWith('exit') && /OPENAI_REASONING_EFFORT must be one of/.test(bad.output()), 'Invalid effort stops the server with a clear message');
  console.log('\nOpenAI path checks passed.');
} finally {
  for (const a of results) a.child.kill();
  stub.close();
}
