// Exercises the real Anthropic SDK code path in server/quill.js against a local stub of the Messages API.
// No real key and no network: a dummy key is used and ANTHROPIC_BASE_URL points at the stub.
// Verifies request shape (model, prompt contents, structured output, fallbacks), parsing and error mapping.
import http from 'http';
import { spawn } from 'child_process';

const STUB_PORT = 4180;
const APP_PORT = 4175;
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`  ok  ${m}`); };
const seen = [];
let mode = 'ok';

const stub = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    seen.push({ url: req.url, headers: req.headers, body: JSON.parse(body || '{}') });
    if (mode === 'auth') { res.writeHead(401, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } })); }
    if (mode === 'refusal') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ id: 'msg_stub', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: null, explanation: 'stub' }, usage: { input_tokens: 1, output_tokens: 0 } })); }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'msg_stub', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null,
      content: [{ type: 'thinking', thinking: '', signature: 'x' }, { type: 'text', text: JSON.stringify({ caption: 'Stub caption.\n\n#BuildingServices', notes: 'Stub notes.' }) }],
      usage: { input_tokens: 10, output_tokens: 10 },
    }));
  });
});
await new Promise((r) => stub.listen(STUB_PORT, '127.0.0.1', r));

const app = spawn(process.execPath, ['server.js'], {
  cwd: new URL('..', import.meta.url).pathname,
  env: { ...process.env, PORT: String(APP_PORT), QUILL_PROVIDER: '', ANTHROPIC_API_KEY: 'dummy-test-key-not-real', ANTHROPIC_BASE_URL: `http://127.0.0.1:${STUB_PORT}`, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
let log = '';
app.stdout.on('data', (d) => (log += d));
await new Promise((res) => app.stdout.on('data', () => /provider/.test(log) && res()));
const post = (body) => fetch(`http://127.0.0.1:${APP_PORT}/api/quill/caption`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

try {
  console.log('\n== Anthropic SDK path (local stub, dummy key) ==');
  const status = await (await fetch(`http://127.0.0.1:${APP_PORT}/api/quill/status`)).json();
  assert(status.provider === 'live' && status.model === 'claude-opus-5-5', 'Key in server env switches Quill to live Anthropic provider');
  assert(!log.includes('dummy-test-key'), 'Server log never prints the key');

  const brief = 'Write for an M&E service manager who gets to Friday afternoon with three completed jobs still waiting on engineer photos.';
  let r = await post({ kind: 'revision', brief, platform: 'LinkedIn', currentCaption: 'Old caption v1', currentVersion: 1, feedback: 'Cut it to under 100 words.' });
  const out = await r.json();
  assert(r.status === 200 && out.provider === 'anthropic' && out.caption.startsWith('Stub caption'), 'Structured JSON response parsed into a caption');
  const req = seen.at(-1);
  assert(req.url.startsWith('/v1/messages'), 'Calls the Messages API');
  assert(req.body.model === 'claude-opus-5-5', 'Uses claude-opus-5-5');
  assert(req.body.output_config?.format?.type === 'json_schema' && req.body.output_config.effort === 'high', 'Requests structured output at high effort');
  assert(req.body.fallbacks === 'default' && /server-side-fallback-2026-07-01/.test(req.headers['anthropic-beta'] || ''), 'Server-side refusal fallback enabled');
  assert(!('thinking' in req.body) && !('temperature' in req.body), 'No disabled thinking or sampling params (400s on Opus 5.5)');
  assert(/British English/.test(req.body.system) && /Never invent results/.test(req.body.system), 'System prompt carries Nexai voice and no-invented-results rule');
  const msg = req.body.messages[0].content;
  assert(msg.includes(brief) && msg.includes('Platform: LinkedIn') && msg.includes('Old caption v1') && msg.includes('Cut it to under 100 words.'), 'Revision prompt includes brief, platform, current caption and exact feedback');
  assert(req.headers.authorization === 'Bearer dummy-test-key-not-real', 'Server-env key sent by the server (SDK 1.x uses Authorization: Bearer)');

  mode = 'refusal';
  r = await post({ kind: 'draft', brief, platform: 'LinkedIn' });
  assert(r.status === 502 && (await r.json()).retryable === false, 'Refusal reported as a non-retryable failure');

  mode = 'auth';
  r = await post({ kind: 'draft', brief, platform: 'LinkedIn' });
  const authErr = await r.json();
  assert(r.status === 502 && authErr.retryable === false && /ANTHROPIC_API_KEY/.test(authErr.error) && !JSON.stringify(authErr).includes('dummy-test-key'), 'Bad key gives a clear error without leaking the key');

  r = await post({ kind: 'revision', brief, platform: 'LinkedIn' });
  assert(r.status === 400, 'Invalid revision request rejected before calling the API');
  r = await fetch(`http://127.0.0.1:${APP_PORT}/api/quill/caption`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{}' });
  assert(r.status === 403, 'Cross-origin requests refused');
  console.log('\nAnthropic path checks passed.');
} finally {
  app.kill();
  stub.close();
}
