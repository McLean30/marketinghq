// Static server + Quill caption API for the private Nexai HQ prototype.
// Binds to localhost by default. Set HOST=0.0.0.0 to open it from a phone on your own Wi-Fi.
const http = require('http');
const fs = require('fs');
const path = require('path');
const quill = require('./server/quill');

const ROOT = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || '127.0.0.1';
const MAX_BODY = 64 * 1024;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new quill.QuillError('Request too large.', { status: 413, retryable: false })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new quill.QuillError('Request body must be JSON.', { status: 400, retryable: false })); }
    });
    req.on('error', reject);
  });
}

async function handleApi(req, res, urlPath) {
  if (urlPath === '/api/quill/status' && req.method === 'GET') return sendJson(res, 200, quill.providerInfo());
  if (urlPath === '/api/quill/caption' && req.method === 'POST') {
    // Same-origin only: the dashboard is the only intended caller.
    const origin = req.headers.origin;
    if (origin && origin !== `http://${req.headers.host}`) return sendJson(res, 403, { error: 'Cross-origin requests are not allowed.' });
    try {
      const body = await readJson(req);
      const started = Date.now();
      const out = await quill.generate(body);
      console.log(`[quill] ${body.kind} for ${body.platform} via ${out.provider} (${out.model}) in ${Date.now() - started}ms`);
      return sendJson(res, 200, out);
    } catch (e) {
      const status = e.status || 500;
      console.warn(`[quill] request failed: ${e.code || 'error'} (${status})`);
      return sendJson(res, status, { error: e.message || 'Caption generation failed.', code: e.code || 'error', retryable: e.retryable !== false });
    }
  }
  if (urlPath === '/api/quill/mock-calls' && req.method === 'GET' && quill.providerInfo().provider === 'mock') {
    return sendJson(res, 200, require('./server/quill-mock').calls);
  }
  return sendJson(res, 404, { error: 'Not found' });
}

http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath.startsWith('/api/')) {
      handleApi(req, res, urlPath).catch(() => sendJson(res, 500, { error: 'Server error' }));
      return;
    }
    let file = path.normalize(path.join(ROOT, urlPath));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (urlPath.endsWith('/')) file = path.join(file, 'index.html');
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404).end('Not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex, nofollow',
      });
      res.end(data);
    });
  })
  .listen(PORT, HOST, () => {
    const info = quill.providerInfo();
    console.log(`Nexai AI Marketing HQ running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    console.log(`Quill caption provider: ${info.label}${info.model ? ` (${info.model}${info.effort ? `, effort ${info.effort}` : ''})` : ''}`);
  });
