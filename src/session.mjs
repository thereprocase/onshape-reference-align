import crypto from 'node:crypto';

import { ROUTES } from './routes.mjs';

const sessions = new Map();
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const COOKIE_NAME = 'osra_sid';

// getSession() below runs for every request that reaches the server,
// including ones with no cookie at all, before any routing or CSRF check —
// so an unauthenticated flood of cookie-less requests is the ordinary case
// this bounds, not an edge case. cleanupSessions() alone cannot be trusted to
// keep up with it: it only runs on a 1% die roll per request, and only
// removes entries already past SESSION_TTL_MS. Once at capacity, the oldest
// session (by lastSeen) is evicted to make room for a new one, so the store
// never grows past this regardless of traffic shape.
export const MAX_SESSIONS = 10_000;

// A floor under cleanupSessions() that does not depend on request volume: the
// 1% per-request trigger below can be starved by a burst that arrives faster
// than it fires. Unref'd so holding this module open never keeps a process
// (or a test run) alive on its own.
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function parseCookies(header = '') {
  const result = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) {
      try {
        result[key] = decodeURIComponent(value);
      } catch {
        // A malformed or unrelated cookie must not prevent a fresh session.
      }
    }
  }
  return result;
}

function setCookie(res, config, sid) {
  const attributes = [
    `${COOKIE_NAME}=${encodeURIComponent(sid)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  ];
  if (config.cookieSecure) {
    attributes.push('Secure', 'SameSite=None');
  } else {
    attributes.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', attributes.join('; '));
}

export function cleanupSessions(now = Date.now()) {
  for (const [sid, session] of sessions) {
    if (now - session.lastSeen > SESSION_TTL_MS) sessions.delete(sid);
  }
}

// Runs on a timer independent of request volume; see CLEANUP_INTERVAL_MS.
const cleanupTimer = setInterval(() => cleanupSessions(), CLEANUP_INTERVAL_MS);
cleanupTimer.unref();

function evictOldestSession() {
  // Insertion order (what Map iteration gives for free) is not recency: a
  // session touched by an active user can be the first one ever inserted.
  // Scan for the real least-recently-seen entry instead. O(n) in the number
  // of live sessions, but this only runs once the store is already at
  // MAX_SESSIONS, so it never fires on the common path.
  let oldestSid;
  let oldestSeen = Infinity;
  for (const [sid, session] of sessions) {
    if (session.lastSeen < oldestSeen) {
      oldestSeen = session.lastSeen;
      oldestSid = sid;
    }
  }
  if (oldestSid !== undefined) sessions.delete(oldestSid);
}

export function getSession(req, res, config) {
  if (Math.random() < 0.01) cleanupSessions();
  const cookies = parseCookies(req.headers.cookie || '');
  let sid = cookies[COOKIE_NAME];
  let session = sid ? sessions.get(sid) : undefined;
  if (!session) {
    if (sessions.size >= MAX_SESSIONS) evictOldestSession();
    sid = randomToken();
    session = {
      id: sid,
      createdAt: Date.now(),
      lastSeen: Date.now(),
      csrfToken: randomToken(24),
      oauthState: undefined,
      returnTo: '/',
      tokens: undefined,
      rateLimits: {},
      connectionProbe: undefined,
      // Observed 403s from Onshape, keyed by feature name. Read by
      // deriveCapabilities (src/capabilities.mjs); expired by its own TTL and
      // by the config store's generation.
      capabilityEvidence: {}
    };
    sessions.set(sid, session);
    setCookie(res, config, sid);
  } else {
    session.lastSeen = Date.now();
  }
  return session;
}

export function requireCsrf(req, session) {
  const supplied = req.headers['x-csrf-token'];
  if (!supplied || typeof supplied !== 'string') return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(session.csrfToken);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createOAuthState(session, returnTo = '/') {
  session.oauthState = randomToken(24);
  session.returnTo = sanitizeReturnTo(returnTo);
  return session.oauthState;
}

export function consumeOAuthState(session, state) {
  if (!state || !session.oauthState) return false;
  const a = Buffer.from(String(state));
  const b = Buffer.from(String(session.oauthState));
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (valid) session.oauthState = undefined;
  return valid;
}

export function sanitizeReturnTo(value) {
  const text = String(value || '/');
  if (!text.startsWith('/') || text.startsWith('//')) return '/';
  return text;
}

export function setOAuthTokens(session, tokenResponse) {
  const expiresIn = Number(tokenResponse.expires_in || 3600);
  session.tokens = {
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token,
    tokenType: tokenResponse.token_type || 'Bearer',
    expiresAt: Date.now() + Math.max(30, expiresIn - 30) * 1000
  };
}

export function clearOAuthTokens(session) {
  session.tokens = undefined;
}

export function getSessionCountForDiagnostics() {
  return sessions.size;
}

/**
 * Fixed-window token bucket, scoped to one session and one named bucket.
 *
 * Stored on the session object itself rather than in a second map, so a
 * rate-limit entry is evicted for free whenever the session it belongs to
 * expires.
 */
export function takeRateLimitToken(session, bucket, { capacity = 5, refillMs = 60_000, now = Date.now() } = {}) {
  if (!session.rateLimits) session.rateLimits = {};
  let entry = session.rateLimits[bucket];
  if (!entry || now - entry.windowStart >= refillMs) {
    entry = { windowStart: now, count: 0 };
    session.rateLimits[bucket] = entry;
  }
  if (entry.count >= capacity) {
    const retryAfterSeconds = Math.max(1, Math.ceil((entry.windowStart + refillMs - now) / 1000));
    return { ok: false, retryAfterSeconds };
  }
  entry.count += 1;
  return { ok: true };
}

/**
 * Take one route's rate-limit token, with the bucket read from src/routes.mjs.
 *
 * The descriptor is looked up here rather than named at the call site, so a
 * route's throttle is declared in the same table as its CSRF, capability, and
 * confirmation gates. A route with neither a `rateLimit` nor a written
 * `rateLimitReason` fails test/routes.test.mjs, and a route that declares a
 * bucket it never takes fails test/route-gates.test.mjs, so "nobody decided"
 * is not a state this table can be left in.
 *
 * Returns null when the request may proceed, or an error for the caller to
 * throw. Throwing rather than answering here is deliberate: server.mjs's
 * handler already closes a socket whose request body was never read, which is
 * exactly the state a refused POST /api/upload-image leaves behind — the whole
 * point of refusing before the body is buffered.
 */
export function routeRateLimitError(session, method, pathname, now = Date.now()) {
  const route = ROUTES.find((entry) => entry.method === method && entry.path === pathname);
  if (!route?.rateLimit) return null;
  const { bucket, capacity, refillMs } = route.rateLimit;
  const result = takeRateLimitToken(session, bucket, { capacity, refillMs, now });
  if (result.ok) return null;
  const seconds = result.retryAfterSeconds;
  return Object.assign(
    new Error(`Too many requests. Wait ${seconds} second${seconds === 1 ? '' : 's'} and try again.`),
    {
      status: 429,
      code: 'RATE_LIMITED',
      // Read by server.mjs's handler, which sets the Retry-After header from
      // it. A number rather than a header bag: the only header a refusal may
      // add is this one, and it is never copied from anything upstream.
      retryAfterSeconds: seconds,
      expose: { retryAfterSeconds: seconds }
    }
  );
}
