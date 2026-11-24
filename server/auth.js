// Owner sign-in for the shared workspace. The password is never stored: only a hash in HQ_OWNER_PASSWORD_HASH,
// either scrypt (from `npm run set-password`) or PBKDF2-SHA256 (from HQ's setup page, made in your browser so you
// don't need Node). Sessions are random tokens in an HttpOnly, SameSite=Strict cookie (Secure over HTTPS); only
// their SHA-256 hashes are kept, in the workspace store (files, or Supabase on Vercel), so they survive restarts
// and work across server instances.
const crypto = require('crypto');
const backend = require('./backend');

const COOKIE = 'hq_session';
const SESSION_DAYS = 30;
const HASH = (process.env.HQ_OWNER_PASSWORD_HASH || '').trim();

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const N = 16384, r = 8, p = 1;
  const key = crypto.scryptSync(password, salt, 32, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts[0] === 'pbkdf2-sha256' && parts.length === 4) {
    // pbkdf2-sha256$<iterations>$<salt base64>$<hash base64> (HQ's setup page, WebCrypto in the browser)
    const [, iter, salt, hash] = parts;
    const n = Number(iter);
    if (!(n >= 100000 && n <= 5000000)) return false;
    const expected = Buffer.from(hash, 'base64');
    if (expected.length < 16) return false;
    const got = crypto.pbkdf2Sync(String(password), Buffer.from(salt, 'base64'), n, expected.length, 'sha256');
    return crypto.timingSafeEqual(got, expected);
  }
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64');
  const got = crypto.scryptSync(String(password), Buffer.from(salt, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

const validHash = () => /^scrypt\$/.test(HASH) || /^pbkdf2-sha256\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/.test(HASH);
/** Sign-in is on when a valid hash is set and somewhere durable can hold the workspace (Supabase on Vercel). */
const configured = () => validHash() && backend.available();
const misconfigured = () => (validHash() && !backend.available() ? 'HQ_OWNER_PASSWORD_HASH is set, but on Vercel the shared workspace also needs SUPABASE_URL and SUPABASE_SECRET_KEY. Until then HQ stays in demo mode.' : null);
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

function readCookie(req) {
  const m = /(?:^|;\s*)hq_session=([A-Za-z0-9_-]{20,})/.exec(req.headers.cookie || '');
  return m ? m[1] : null;
}
const secure = (req) => (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' || !!req.socket?.encrypted;

async function session(req) {
  if (!configured()) return null;
  const token = readCookie(req);
  if (!token) return null;
  const s = await backend.store().sessionGet(sha(token));
  if (!s || s.expiresAt < Date.now()) return null;
  return s;
}

/* Login throttling: 5 failures per address per 15 minutes (kept in the store, so it holds across instances). */
const clientIp = (req) => (process.env.VERCEL ? (req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '') || req.socket.remoteAddress || 'unknown';
async function throttled(ip) {
  const f = await backend.store().failGet(ip);
  return !!f && f.count >= 5 && Date.now() < f.until;
}
async function noteFailure(ip) {
  const S = backend.store();
  const f = (await S.failGet(ip)) || { count: 0, until: 0 };
  if (Date.now() > f.until) f.count = 0;
  f.count += 1;
  f.until = Date.now() + 15 * 60 * 1000;
  await S.failPut(ip, f);
}

async function login(req, password, device) {
  const ip = clientIp(req);
  if (!configured()) return { status: 503, error: misconfigured() || 'The shared workspace isn’t set up. Set HQ_OWNER_PASSWORD_HASH on the server first.' };
  if (await throttled(ip)) return { status: 429, error: 'Too many failed sign-in attempts. Wait 15 minutes and try again.' };
  if (typeof password !== 'string' || !password || password.length > 500 || !verifyPassword(password, HASH)) {
    await noteFailure(ip);
    return { status: 401, error: 'That password isn’t right.' };
  }
  const S = backend.store();
  await S.failDelete(ip);
  await S.sessionPrune(Date.now());
  const token = crypto.randomBytes(32).toString('base64url');
  await S.sessionPut(sha(token), { createdAt: Date.now(), expiresAt: Date.now() + SESSION_DAYS * 864e5, device: String(device || '').slice(0, 20) });
  return { status: 200, cookie: `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure(req) ? '; Secure' : ''}` };
}

async function logout(req) {
  const token = readCookie(req);
  if (configured() && token) await backend.store().sessionDelete(sha(token));
  return `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure(req) ? '; Secure' : ''}`;
}

module.exports = { configured, misconfigured, session, login, logout, hashPassword, verifyPassword };
