const crypto = require('crypto');

const PASSWORD = process.env.APP_PASSWORD || '';
const SECRET = process.env.SESSION_SECRET || PASSWORD;
const COOKIE = 'transcribe_session';
const MAX_AGE_DAYS = 30;

// Auth is only enforced when a password is configured. Locally (no
// APP_PASSWORD) the app runs open, so there's no login friction.
function authEnabled() {
  return PASSWORD.length > 0;
}

// The session token is a deterministic HMAC of the secret. It can't be forged
// without the secret, and rotating the password invalidates old cookies.
function expectedToken() {
  return crypto.createHmac('sha256', SECRET).update('transcribe-auth-v1').digest('hex');
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function checkPassword(pw) {
  return authEnabled() && typeof pw === 'string' && timingSafeEqual(pw, PASSWORD);
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isAuthenticated(req) {
  if (!authEnabled()) return true;
  const token = parseCookies(req)[COOKIE];
  return !!token && timingSafeEqual(token, expectedToken());
}

function setSessionCookie(req, res) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const maxAge = MAX_AGE_DAYS * 24 * 60 * 60;
  const parts = [
    `${COOKIE}=${expectedToken()}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

// Express middleware: block unauthenticated requests. API calls get 401;
// page navigations are redirected to the login page.
function requireAuth(req, res, next) {
  if (isAuthenticated(req)) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  return res.redirect('/login');
}

module.exports = {
  authEnabled,
  checkPassword,
  isAuthenticated,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
};
