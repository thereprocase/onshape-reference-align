import test from 'node:test';
import assert from 'node:assert/strict';

import {
  takeRateLimitToken,
  getSession,
  getSessionCountForDiagnostics,
  cleanupSessions,
  MAX_SESSIONS,
  SESSION_TTL_MS
} from '../src/session.mjs';

const CONFIG = { cookieSecure: false };

function fakeReq(cookieHeader) {
  return { headers: cookieHeader ? { cookie: cookieHeader } : {} };
}

function fakeRes() {
  const headers = {};
  return { headers, setHeader: (name, value) => { headers[name] = value; } };
}

test('malformed cookies do not discard another valid session or prevent a new one', () => {
  const response = fakeRes();
  const initial = getSession(fakeReq(), response, CONFIG);
  const cookie = response.headers['Set-Cookie'].split(';', 1)[0];
  assert.equal(getSession(fakeReq(`unrelated=%; ${cookie}`), fakeRes(), CONFIG), initial);
  assert.ok(getSession(fakeReq('osra_sid=%'), fakeRes(), CONFIG).csrfToken);
});

test('takeRateLimitToken allows exactly capacity calls in one window, then rejects', () => {
  const session = {};
  for (let i = 0; i < 5; i += 1) {
    const result = takeRateLimitToken(session, 'setup-probe', { capacity: 5, refillMs: 60_000, now: 0 });
    assert.equal(result.ok, true, `call ${i + 1} should be allowed`);
  }
  const sixth = takeRateLimitToken(session, 'setup-probe', { capacity: 5, refillMs: 60_000, now: 0 });
  assert.equal(sixth.ok, false);
  assert.equal(sixth.retryAfterSeconds, 60);
});

test('takeRateLimitToken refills the bucket once the window elapses', () => {
  const session = {};
  for (let i = 0; i < 5; i += 1) {
    takeRateLimitToken(session, 'setup-probe', { capacity: 5, refillMs: 60_000, now: 0 });
  }
  const blocked = takeRateLimitToken(session, 'setup-probe', { capacity: 5, refillMs: 60_000, now: 30_000 });
  assert.equal(blocked.ok, false);

  const seventh = takeRateLimitToken(session, 'setup-probe', { capacity: 5, refillMs: 60_000, now: 60_000 });
  assert.equal(seventh.ok, true);
});

test('takeRateLimitToken tracks independent buckets per session', () => {
  const sessionA = {};
  const sessionB = {};
  for (let i = 0; i < 5; i += 1) {
    assert.equal(takeRateLimitToken(sessionA, 'setup-probe', { now: 0 }).ok, true);
  }
  assert.equal(takeRateLimitToken(sessionA, 'setup-probe', { now: 0 }).ok, false);
  assert.equal(takeRateLimitToken(sessionB, 'setup-probe', { now: 0 }).ok, true);
});

test('takeRateLimitToken tracks independent buckets by name within one session', () => {
  const session = {};
  for (let i = 0; i < 5; i += 1) {
    assert.equal(takeRateLimitToken(session, 'setup-probe', { now: 0 }).ok, true);
  }
  assert.equal(takeRateLimitToken(session, 'setup-probe', { now: 0 }).ok, false);
  assert.equal(takeRateLimitToken(session, 'other-bucket', { now: 0 }).ok, true);
});

// getSession()'s own store is a module-level singleton, so this and the two
// tests after it run in this order deliberately: this one first saturates
// the store at MAX_SESSIONS, and the eviction test that follows relies on it
// already being at capacity rather than re-deriving that state itself.
test('getSession caps the live session store at MAX_SESSIONS regardless of how many cookie-less requests arrive', () => {
  for (let i = 0; i < MAX_SESSIONS + 50; i += 1) {
    getSession(fakeReq(), fakeRes(), CONFIG);
  }
  assert.equal(getSessionCountForDiagnostics(), MAX_SESSIONS);
});

test('getSession evicts the least-recently-seen session at capacity, not simply the oldest-inserted one', () => {
  assert.equal(getSessionCountForDiagnostics(), MAX_SESSIONS, 'expected the previous test to have already saturated the store');

  // `early` is inserted first; a naive FIFO eviction would pick it next. It
  // must not be the one evicted, because it gets touched (see below) after
  // `late`, making `late` -- despite being newer -- the least recently seen.
  const early = getSession(fakeReq(), fakeRes(), CONFIG);
  const late = getSession(fakeReq(), fakeRes(), CONFIG);

  // Force `late` to look far older than every other live session, including
  // ones inserted long before it, without waiting on the real clock.
  late.lastSeen = 0;
  // Touch `early` so its lastSeen is current, same as everything else still
  // in the store.
  getSession(fakeReq(`osra_sid=${early.id}`), fakeRes(), CONFIG);

  // The store is at capacity; this insert must evict something first.
  getSession(fakeReq(), fakeRes(), CONFIG);
  assert.equal(getSessionCountForDiagnostics(), MAX_SESSIONS);

  const stillEarly = getSession(fakeReq(`osra_sid=${early.id}`), fakeRes(), CONFIG);
  assert.equal(stillEarly.id, early.id, 'a recently touched session must survive an eviction it did not cause');

  const replacement = getSession(fakeReq(`osra_sid=${late.id}`), fakeRes(), CONFIG);
  assert.notEqual(replacement.id, late.id, 'the session with the oldest lastSeen must have been evicted, minting a new one for its old cookie');
});

test('cleanupSessions removes only entries whose lastSeen is past SESSION_TTL_MS', () => {
  const now = Date.now();
  const fresh = getSession(fakeReq(), fakeRes(), CONFIG);
  const stale = getSession(fakeReq(), fakeRes(), CONFIG);
  fresh.lastSeen = now;
  stale.lastSeen = now - SESSION_TTL_MS - 1;

  cleanupSessions(now);

  const stillFresh = getSession(fakeReq(`osra_sid=${fresh.id}`), fakeRes(), CONFIG);
  assert.equal(stillFresh.id, fresh.id, 'a session seen within the TTL must survive cleanup');

  const replacedStale = getSession(fakeReq(`osra_sid=${stale.id}`), fakeRes(), CONFIG);
  assert.notEqual(replacedStale.id, stale.id, 'a session not seen for over SESSION_TTL_MS must be removed by cleanup');
});

test('getSession sets a fresh cookie only when a session is created, not when an existing one is reused', () => {
  const created = fakeRes();
  const session = getSession(fakeReq(), created, CONFIG);
  assert.ok(created.headers['Set-Cookie'].includes(session.id));

  const reused = fakeRes();
  getSession(fakeReq(`osra_sid=${session.id}`), reused, CONFIG);
  assert.equal(reused.headers['Set-Cookie'], undefined);
});
