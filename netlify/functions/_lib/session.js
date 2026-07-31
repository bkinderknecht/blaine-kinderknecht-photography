// Shared auth helpers for the admin CMS's Netlify Functions — no npm
// dependencies, just Node's built-in crypto module. Two jobs:
// 1. Check a submitted password against the stored hash (scrypt).
// 2. Sign/verify the session cookie issued after a successful login.
//
// There's no user database — a single username + password hash live
// in Netlify environment variables (ADMIN_USERNAME, ADMIN_PASSWORD_HASH),
// set once via scripts/hash-password.js. No registration, nothing else.

const crypto = require('crypto');

const SESSION_COOKIE_NAME = 'sawyer_admin_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

// --- Password hashing ---
// Format: "<salt-hex>:<hash-hex>". scripts/hash-password.js produces
// this same format standalone (kept in sync by hand — it's a few
// lines, not worth a shared-require just for that).

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, hash] = storedHash.split(':');
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

// --- Session cookie signing/verification ---

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function createSessionToken(username, secret) {
  const exp = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  const payload = Buffer.from(JSON.stringify({ sub: username, exp })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

function verifySessionToken(token, secret) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  // Buffer.from(str, 'hex') silently stops at the first non-hex
  // character instead of throwing, so e.g. a valid signature with
  // extra characters appended would otherwise decode down to the
  // same bytes as the real one and wrongly pass — reject anything
  // that isn't exactly a 64-char (32-byte SHA-256) hex string first.
  if (!/^[0-9a-f]{64}$/.test(sig)) return null;
  const expectedSig = sign(payload, secret);
  const sigBuf = Buffer.from(sig, 'hex');
  const expectedBuf = Buffer.from(expectedSig, 'hex');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch (err) {
    return null;
  }
  if (!data.exp || Date.now() > data.exp) return null;
  return data;
}

function buildSessionCookie(token) {
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

function buildLogoutCookie() {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

function readCookie(headerValue, name) {
  if (!headerValue) return null;
  for (const part of headerValue.split(';').map((p) => p.trim())) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq) === name) return part.slice(eq + 1);
  }
  return null;
}

// Reads and verifies the session cookie from a Netlify Function event.
// Returns the decoded payload ({sub, exp}) if valid, or null. This is
// the actual security boundary every write-capable function checks —
// admin.js hiding edit UI from logged-out visitors is just UX on top.
function getSession(event) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  const cookieHeader = event.headers && (event.headers.cookie || event.headers.Cookie);
  const token = readCookie(cookieHeader, SESSION_COOKIE_NAME);
  return verifySessionToken(token, secret);
}

module.exports = {
  SESSION_COOKIE_NAME,
  verifyPassword,
  createSessionToken,
  verifySessionToken,
  buildSessionCookie,
  buildLogoutCookie,
  getSession,
};
