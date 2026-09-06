import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyProbeError,
  probeCredentials,
  getConnectionState,
  peekConnectionState,
  seedConnectionState,
  invalidateConnectionState,
  buildAuthSummary,
  PROBE_TIMEOUT_MS
} from '../src/connection-probe.mjs';

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const baseConfig = Object.freeze({
  onshapeBaseUrl: 'https://cad.onshape.com',
  apiVersion: 'v17',
  authMode: 'api-key-signature',
  accessKey: 'A',
  secretKey: 'S'
});

test('authMode none short-circuits before any fetch, even with force', async () => {
  invalidateConnectionState();
  const fetchImpl = () => { throw new Error('must not be called'); };
  const api = { fetchImpl };
  const config = { ...baseConfig, authMode: 'none' };

  const first = await getConnectionState({ api, config, session: {}, generation: 1, now: 0 });
  assert.equal(first.state, 'unconfigured');

  const forced = await getConnectionState({ api, config, session: {}, generation: 1, force: true, now: 0 });
  assert.equal(forced.state, 'unconfigured');
});

test('a successful probe caches for the positive TTL', async () => {
  invalidateConnectionState();
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return jsonResponse(200, { name: 'Test User', id: 'abc' }); };
  const api = { fetchImpl };
  const session = {};

  const first = await getConnectionState({ api, config: baseConfig, session, generation: 1, now: 0 });
  assert.equal(first.state, 'connected');
  assert.equal(first.accountName, 'Test User');
  assert.equal(calls, 1);

  const stillCached = await getConnectionState({ api, config: baseConfig, session, generation: 1, now: 59_000 });
  assert.equal(stillCached.state, 'connected');
  assert.equal(calls, 1);

  const expired = await getConnectionState({ api, config: baseConfig, session, generation: 1, now: 61_000 });
  assert.equal(expired.state, 'connected');
  assert.equal(calls, 2);
});

test('a rejected probe does not leak the upstream response body', async () => {
  invalidateConnectionState();
  const fetchImpl = async () => jsonResponse(401, { message: 'bad key', hint: 'SECRETVALUE' });
  const api = { fetchImpl };

  const result = await getConnectionState({ api, config: baseConfig, session: {}, generation: 1, now: 0 });
  assert.equal(result.state, 'rejected');
  assert.ok(!JSON.stringify(result).includes('SECRETVALUE'));
});

test('403, 429, and 500 map to forbidden and error states', async () => {
  invalidateConnectionState();
  const makeFetch = (status) => async () => jsonResponse(status, { error: 'nope' });

  const forbidden = await getConnectionState({ api: { fetchImpl: makeFetch(403) }, config: baseConfig, session: {}, generation: 1, now: 0 });
  assert.equal(forbidden.state, 'forbidden');

  invalidateConnectionState();
  const rateLimited = await getConnectionState({ api: { fetchImpl: makeFetch(429) }, config: baseConfig, session: {}, generation: 2, now: 0 });
  assert.equal(rateLimited.state, 'error');
  assert.equal(rateLimited.reason, 'ONSHAPE_RATE_LIMITED');

  invalidateConnectionState();
  const serverError = await getConnectionState({ api: { fetchImpl: makeFetch(500) }, config: baseConfig, session: {}, generation: 3, now: 0 });
  assert.equal(serverError.state, 'error');
  assert.equal(serverError.reason, 'ONSHAPE_ERROR');
});

test('consecutive failures back off from 5s to a 60s cap, using injected time only', async () => {
  invalidateConnectionState();
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return jsonResponse(401, { error: 'nope' }); };
  const api = { fetchImpl };
  const session = {};
  const generation = 1;

  // A probe at t triggers a re-probe no earlier than t + backoff(streak).
  let t = 0;
  const expectedDelays = [5_000, 10_000, 20_000, 40_000, 60_000, 60_000];
  for (const delay of expectedDelays) {
    await getConnectionState({ api, config: baseConfig, session, generation, now: t });
    // Requesting just before the expected delay must not re-probe.
    const stillBackedOff = await getConnectionState({ api, config: baseConfig, session, generation, now: t + delay - 1 });
    assert.equal(stillBackedOff.state, 'rejected');
    t += delay;
  }
  assert.equal(calls, expectedDelays.length);

  await getConnectionState({ api, config: baseConfig, session, generation, now: t });
  assert.equal(calls, expectedDelays.length + 1);
});

test('overlapping calls against a deferred fetch resolve to one invocation', async () => {
  invalidateConnectionState();
  let calls = 0;
  let resolveFetch;
  const fetchImpl = () => {
    calls += 1;
    return new Promise((resolve) => { resolveFetch = resolve; });
  };
  const api = { fetchImpl };

  const first = getConnectionState({ api, config: baseConfig, session: {}, generation: 1, now: 0 });
  const second = getConnectionState({ api, config: baseConfig, session: {}, generation: 1, now: 0 });

  // fetchImpl is reached only after a few microtask hops through
  // authorizationHeaders(); poll rather than assume a fixed tick count.
  while (!resolveFetch) await new Promise((resolve) => setImmediate(resolve));
  resolveFetch(jsonResponse(200, { name: 'Test User' }));
  const [a, b] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.deepEqual(a, b);
});

test('bumping the generation forces a fresh probe even before the previous TTL expires', async () => {
  invalidateConnectionState();
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return jsonResponse(200, { name: 'Test User' }); };
  const api = { fetchImpl };
  const session = {};

  await getConnectionState({ api, config: baseConfig, session, generation: 1, now: 0 });
  assert.equal(calls, 1);
  await getConnectionState({ api, config: baseConfig, session, generation: 2, now: 1 });
  assert.equal(calls, 2);
});

test('a fetch that never settles resolves as unreachable via TIMEOUT within the injected timeout', async () => {
  invalidateConnectionState();
  const fetchImpl = () => new Promise(() => {});
  const api = { fetchImpl };

  const result = await probeCredentials(baseConfig, { fetchImpl, timeoutMs: 25 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'TIMEOUT');
});

test('getConnectionState resolves as unreachable via TIMEOUT within an injected short timeout, not the full 8s default', async () => {
  invalidateConnectionState();
  const fetchImpl = () => new Promise(() => {});
  const api = { fetchImpl };

  const started = Date.now();
  const result = await getConnectionState({ api, config: baseConfig, session: {}, generation: 1, now: 0, timeoutMs: 25 });
  const elapsedMs = Date.now() - started;

  assert.equal(result.state, 'unreachable');
  assert.equal(result.reason, 'TIMEOUT');
  assert.ok(elapsedMs < 1_000, `expected a fast timeout, took ${elapsedMs}ms`);
});

test('classifyProbeError maps TypeError to UNREACHABLE and unknown errors to ONSHAPE_ERROR', () => {
  assert.deepEqual(classifyProbeError(new TypeError('fetch failed')), { reason: 'UNREACHABLE' });
  assert.deepEqual(classifyProbeError(new Error('mystery')), { reason: 'ONSHAPE_ERROR' });
});

test('buildAuthSummary has no connected field and exposes the documented shape', () => {
  const connection = { state: 'connected', accountName: 'Test User', host: 'cad.onshape.com', checkedAt: 1 };
  const auth = buildAuthSummary(baseConfig, {}, connection);
  assert.equal('connected' in auth, false);
  assert.deepEqual(Object.keys(auth).sort(), ['canRequest', 'capabilities', 'configured', 'connection', 'mode', 'oauthConnected', 'requiresAuthorization'].sort());
  assert.equal(auth.canRequest, true);
  assert.equal(auth.mode, 'api-key-signature');
});

test('buildAuthSummary reports oauth-required accurately', () => {
  const auth = buildAuthSummary({ authMode: 'oauth' }, {}, { state: 'oauth-required', host: 'cad.onshape.com' });
  assert.equal(auth.requiresAuthorization, true);
  assert.equal(auth.canRequest, false);
  assert.equal(auth.oauthConnected, false);
});

test('peekConnectionState never calls fetch and reports checking before any probe has run', () => {
  invalidateConnectionState();
  const config = { ...baseConfig };
  const result = peekConnectionState({ config, session: {}, generation: 1 });
  assert.equal(result.state, 'checking');
});

test('peekConnectionState reports unconfigured with no probe when authMode is none', () => {
  invalidateConnectionState();
  const result = peekConnectionState({ config: { ...baseConfig, authMode: 'none' }, session: {}, generation: 1 });
  assert.equal(result.state, 'unconfigured');
});

test('peekConnectionState reports a previously cached verdict without re-probing', async () => {
  invalidateConnectionState();
  const fetchImpl = async () => jsonResponse(200, { name: 'Test User' });
  const api = { fetchImpl };
  const session = {};
  await getConnectionState({ api, config: baseConfig, session, generation: 1, now: 0 });

  const peeked = peekConnectionState({ config: baseConfig, session, generation: 1 });
  assert.equal(peeked.state, 'connected');
  assert.equal(peeked.accountName, 'Test User');
});

test('force does not bypass the TTL cache more often than the force floor, even across unrelated sessions', async () => {
  // GET /api/connection?force=1 has no loopback/CSRF gate (it must keep
  // working from an Onshape iframe), so it is reachable from any site the
  // user visits via a plain cross-origin <img> or no-cors fetch. Such a
  // caller never carries the victim's session cookie, so a session-scoped
  // limiter would see a brand-new, unthrottled session on every request.
  // The floor must hold regardless of the session object identity.
  invalidateConnectionState();
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return jsonResponse(401, { error: 'nope' }); };
  const api = { fetchImpl };

  for (let i = 0; i < 20; i += 1) {
    await getConnectionState({ api, config: baseConfig, session: {}, generation: 1, force: true, now: 0 });
  }
  assert.equal(calls, 1);

  // Once the floor interval has elapsed, a forced probe is allowed again.
  await getConnectionState({ api, config: baseConfig, session: {}, generation: 1, force: true, now: 3_000 });
  assert.equal(calls, 2);
});

test('seedConnectionState lets a subsequent lookup reuse the probe Save already performed', async () => {
  invalidateConnectionState();
  const fetchImpl = () => { throw new Error('must not be called after seeding'); };
  const api = { fetchImpl };
  const session = {};
  const connection = { state: 'connected', accountName: 'Seeded User', host: 'cad.onshape.com', checkedAt: 0 };

  seedConnectionState({ generation: 4, session, connection, authMode: 'api-key-signature', now: 0 });
  const result = await getConnectionState({ api, config: baseConfig, session, generation: 4, now: 0 });
  assert.equal(result.accountName, 'Seeded User');
});
