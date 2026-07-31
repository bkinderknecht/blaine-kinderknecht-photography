// Login / logout / session-check for the admin CMS. No user
// registration — a single username+password pair lives in Netlify
// env vars (ADMIN_USERNAME, ADMIN_PASSWORD_HASH), set once via
// scripts/hash-password.js. See _lib/session.js for the actual
// hashing/signing logic.
//
//   GET  /api/auth                          -> { authenticated: bool }
//   POST /api/auth {action:"login", ...}    -> sets session cookie
//   POST /api/auth {action:"logout"}        -> clears session cookie

const {
  verifyPassword,
  createSessionToken,
  buildSessionCookie,
  buildLogoutCookie,
  getSession,
} = require('./_lib/session');

exports.handler = async (event) => {
  if (event.httpMethod === 'GET') {
    return json(200, { authenticated: !!getSession(event) });
  }

  if (event.httpMethod === 'POST') {
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (err) {
      return json(400, { ok: false, error: 'Bad request' });
    }

    if (body.action === 'logout') {
      return json(200, { ok: true }, { 'Set-Cookie': buildLogoutCookie() });
    }

    if (body.action === 'login') {
      // .trim() guards against a trailing newline/space sneaking into
      // the env var value from a copy-paste out of a terminal — an
      // untrimmed value would otherwise fail verifyPassword's length
      // check every time, even with the exact right password.
      const expectedUsername = (process.env.ADMIN_USERNAME || '').trim();
      const expectedHash = (process.env.ADMIN_PASSWORD_HASH || '').trim();
      const secret = (process.env.SESSION_SECRET || '').trim();
      if (!expectedUsername || !expectedHash || !secret) {
        return json(500, { ok: false, error: 'Admin login is not configured yet.' });
      }
      const { username, password } = body;
      if ((username || '').trim() !== expectedUsername || !verifyPassword(password || '', expectedHash)) {
        return json(401, { ok: false, error: 'Wrong username or password.' });
      }
      const token = createSessionToken(username, secret);
      return json(200, { ok: true }, { 'Set-Cookie': buildSessionCookie(token) });
    }

    return json(400, { ok: false, error: 'Unknown action' });
  }

  return json(405, { ok: false, error: 'Method not allowed' });
};

function json(statusCode, body, extraHeaders) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...(extraHeaders || {}) },
    body: JSON.stringify(body),
  };
}
