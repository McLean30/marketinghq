// Owner sign-in for the shared workspace. The password is never stored: only an scrypt hash in
// HQ_OWNER_PASSWORD_HASH (set with `npm run set-password`). Sessions are random tokens in an HttpOnly,
// SameSite=Strict cookie; only their SHA-256 hashes are kept on disk, so sessions survive a restart.
const crypto = require('crypto');
const path = require('path');
const { DATA_DIR, writeAtomic, readJson } = require('./storage');

const COOKIE = 'hq_session';
const SESSION_DAYS = 30;
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const HASH = (process.env.HQ_OWNER_PASSWORD_HASH || '').trim();

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const N = 16384, r = 8, p = 1;
  const key = crypto.scryptSync(password, salt, 32, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64');
  const got = crypto.scryptSync(String(password), Buffer.from(salt, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

const configured = () => /^scrypt\$/.test(HASH);
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
let sessions = readJson(SESSIONS_FILE, {});
const persist = () => writeAtomic(SESSIONS_FILE, JSON.stringify(sessions));

function prune() {
  const now = Date.now();
  let changed = false;
  for (const [k, s] of Object.entries(sessions)) if (s.expiresAt < now) { delete sessions[k]; changed = true; }
  if (changed) persist();
}

function readCookie(req) {
  const m = /(?:^|;\s*)hq_session=([A-Za-z0-9_-]{20,})/.exec(req.headers.cookie || '');
  return m ? m[1] : null;
}

function session(req) {
  if (!configured()) return null;
  const token = readCookie(req);
  if (!token) return null;
  const s = sessions[sha(token)];
  if (!s || s.expiresAt < Date.now()) return null;
  return s;
}

/* Login throttling: 5 failures per address per 15 minutes. */
const failures = new Map();
function throttled(ip) {
  const f = failures.get(ip);
  return f && f.count >= 5 && Date.now() < f.until;
}
function noteFailure(ip) {
  const f = failures.get(ip) || { count: 0, until: 0 };
  if (Date.now() > f.until) { f.count = 0; }
  f.count += 1;
  f.until = Date.now() + 15 * 60 * 1000;
  failures.set(ip, f);
}

function login(req, password, device) {
  const ip = req.socket.remoteAddress || 'unknown';
  if (!configured()) return { status: 503, error: 'The shared workspace isn’t set up. Run npm run set-password on the server first.' };
  if (throttled(ip)) return { status: 429, error: 'Too many failed sign-in attempts. Wait 15 minutes and try again.' };
  if (typeof password !== 'string' || !password || password.length > 500 || !verifyPassword(password, HASH)) {
    noteFailure(ip);
    return { status: 401, error: 'That password isn’t right.' };
  }
  failures.delete(ip);
  prune();
  const token = crypto.randomBytes(32).toString('base64url');
  sessions[sha(token)] = { createdAt: Date.now(), expiresAt: Date.now() + SESSION_DAYS * 864e5, device: String(device || '').slice(0, 20) };
  persist();
  return { status: 200, cookie: `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DAYS * 86400}` };
}

function logout(req) {
  const token = readCookie(req);
  if (token && sessions[sha(token)]) { delete sessions[sha(token)]; persist(); }
  return `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}

module.exports = { configured, session, login, logout, hashPassword, verifyPassword };
