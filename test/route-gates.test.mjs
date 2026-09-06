import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { ROUTES } from '../src/routes.mjs';
import { makeConfigDir, reservePort, spawnServer } from './helpers/server.mjs';

// The gates the route registry declares, probed against the real server on a
// real socket rather than against a hand-built mini-server.
//
// Why it exists: the CSRF gate and the loopback guard were only ever proven by
// harnesses that re-implemented the dispatch chain, plus a hand-picked list of
// pathnames in scripts/smoke.mjs. A hand-picked list cannot notice a route
// that did not exist when the list was written, which is the one failure that
// matters -- and it did not: POST '/auth/logout' was registered as CSRF-gated
// and dispatched from a branch the router never reached.
//
// The loops below are the invariant. They iterate ROUTES, so a route added to
// src/routes.mjs without its gate wired fails here immediately, and a route
// dispatched without being registered fails test/routes.test.mjs's static
// scan. Neither list is written out by hand in this file.

// Any origin that is not this server's own. The loopback guard compares the
// Origin header against the real bound port, so a wrong port is enough to
// stand in for a cross-site request without needing a second listener.
const FOREIGN_ORIGIN = 'http://evil.example:1';

const CSRF_ROUTES = ROUTES.filter((route) => route.method !== 'GET' && route.csrf);
const LOOPBACK_ROUTES = ROUTES.filter((route) => route.guard === 'loopback');
const THROTTLED_ROUTES = ROUTES.filter((route) => route.rateLimit !== null);

// Routes sharing a bucket share its capacity, so they are spent together:
// draining the first one must leave every other route in the group refused.
function bucketGroups() {
  const groups = new Map();
  for (const route of THROTTLED_ROUTES) {
    if (!groups.has(route.rateLimit.bucket)) groups.set(route.rateLimit.bucket, []);
    groups.get(route.rateLimit.bucket).push(route);
  }
  return groups;
}

let server;
let configDir;
let baseUrl;
let cookie;
let csrfToken;
// A loopback port with nothing listening on it. The setup routes are the only
// ones whose rate-limit token is taken behind a live credential probe, so
// spending their bucket means letting that probe run; pointed here, it fails
// on a connection refusal in microseconds and never leaves this machine.
let deadPort;

before(async () => {
  ({ configDir } = await makeConfigDir('reference-align-route-gates-', []));
  // ONSHAPE_AUTH=none and no key of any kind: every probe below must be
  // refused by a gate long before anything would reach a network.
  await fsp.writeFile(path.join(configDir, '.env'), [
    'HOST=127.0.0.1',
    'PORT=0',
    'ONSHAPE_AUTH=none',
    'SESSION_SECRET=route-gates-test-only',
    `BACKUP_DIR=${path.join(configDir, 'backups')}`,
    'NODE_ENV=test',
    ''
  ].join('\n'));

  server = spawnServer({ configPath: path.join(configDir, '.env'), args: ['--no-open'] });
  const port = await server.waitForBoundPort();
  baseUrl = `http://127.0.0.1:${port}`;

  const bootstrap = await fetch(`${baseUrl}/api/bootstrap`);
  cookie = bootstrap.headers.get('set-cookie')?.split(';', 1)[0] || '';
  ({ csrfToken } = await bootstrap.json());
  assert.ok(cookie, 'expected /api/bootstrap to mint a session cookie');
  assert.ok(csrfToken, 'expected /api/bootstrap to hand back a CSRF token');

  deadPort = await reservePort();
});

after(async () => {
  if (server) await server.stop();
  if (configDir) await fsp.rm(configDir, { recursive: true, force: true });
});

// A body every gated route will accept as far as its gate: the gates all run
// before the body is parsed, so its contents never matter.
function probeInit(route, { token, origin } = {}) {
  const headers = { Cookie: cookie };
  if (token) headers['X-CSRF-Token'] = token;
  if (origin) headers.Origin = origin;
  if (route.method === 'GET') return { method: 'GET', headers };
  headers['Content-Type'] = 'application/json';
  return { method: route.method, headers, body: '{}' };
}

async function readBody(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

test('the registry names gates for this probe to check', () => {
  // A filter that silently matched nothing would make every loop below
  // vacuously true, which is the failure mode that matters most here.
  assert.ok(CSRF_ROUTES.length >= 10, `expected the registry to declare CSRF routes, found ${CSRF_ROUTES.length}`);
  assert.ok(LOOPBACK_ROUTES.length >= 5, `expected the registry to declare loopback-guarded routes, found ${LOOPBACK_ROUTES.length}`);
});

test('every route the registry marks csrf refuses a request with no token', async () => {
  for (const route of CSRF_ROUTES) {
    const where = `${route.method} ${route.path}`;
    const response = await fetch(`${baseUrl}${route.path}`, probeInit(route));
    const body = await readBody(response);
    assert.equal(response.status, 403, `${where}: expected 403, got ${response.status} ${JSON.stringify(body)}`);
    assert.equal(body.code, 'CSRF', `${where}: expected code CSRF, got ${JSON.stringify(body)}`);
  }
});

test('the same routes get past the CSRF gate once the token is present', async () => {
  // Without this, the loop above would pass just as happily against a server
  // that answered 403 CSRF to everything, including routes that do not exist.
  for (const route of CSRF_ROUTES) {
    const where = `${route.method} ${route.path}`;
    const response = await fetch(`${baseUrl}${route.path}`, probeInit(route, { token: csrfToken }));
    const body = await readBody(response);
    assert.notEqual(body.code, 'CSRF', `${where}: a valid token was still refused as a CSRF failure`);
    assert.notEqual(response.status, 404, `${where}: registered, CSRF-gated, and not dispatched anywhere (${JSON.stringify(body)})`);
    assert.notEqual(response.status, 405, `${where}: registered but the router refuses its method`);
  }
});

test("every route the registry marks guard:'loopback' refuses a foreign Origin", async () => {
  for (const route of LOOPBACK_ROUTES) {
    const where = `${route.method} ${route.path}`;
    // The CSRF gate runs first, so a non-GET probe carries a valid token:
    // this test must fail on the loopback guard or not at all.
    const init = probeInit(route, { token: route.csrf ? csrfToken : undefined, origin: FOREIGN_ORIGIN });
    const response = await fetch(`${baseUrl}${route.path}`, init);
    const body = await readBody(response);
    assert.equal(response.status, 403, `${where}: expected 403, got ${response.status} ${JSON.stringify(body)}`);
    assert.equal(body.code, 'SETUP_UNAVAILABLE', `${where}: expected the loopback guard, got ${JSON.stringify(body)}`);
    assert.equal(body.reason, 'ORIGIN_REJECTED', `${where}: expected reason ORIGIN_REJECTED, got ${JSON.stringify(body)}`);
    // The fine-grained reason is for the operator's console only.
    assert.equal(body.internalReason, undefined, `${where}: the internal refusal reason leaked to the client`);
  }
});

// The body a route needs in order to get as far as its bucket. Most take the
// token in the dispatch, before anything looks at the body at all, so `{}` is
// enough. The setup routes take theirs immediately before the live probe they
// are protecting (src/routes.mjs says why), so those need keys well-formed
// enough to reach it.
function spendBody(route) {
  if (!route.path.startsWith('/api/setup/')) return '{}';
  return JSON.stringify({
    accessKey: 'A'.repeat(24),
    secretKey: 'B'.repeat(24),
    baseUrl: `http://127.0.0.1:${deadPort}`
  });
}

function spend(route) {
  return fetch(`${baseUrl}${route.path}`, {
    method: route.method,
    headers: { Cookie: cookie, 'X-CSRF-Token': csrfToken, 'Content-Type': 'application/json' },
    body: spendBody(route)
  });
}

function assertRefusal(response, body, where) {
  assert.equal(response.status, 429, `${where}: expected 429, got ${response.status} ${JSON.stringify(body)}`);
  const retryAfter = Number(response.headers.get('retry-after'));
  assert.ok(
    Number.isInteger(retryAfter) && retryAfter > 0,
    `${where}: a 429 must carry a Retry-After header, got ${response.headers.get('retry-after')}`
  );
  // Two shapes answer here -- the shared gate's RATE_LIMITED and the setup
  // wizard's SETUP_RATE_LIMITED -- and a caller has to be able to tell either
  // one apart from an Onshape 429 forwarded through this server.
  assert.match(String(body.code), /RATE_LIMITED$/, `${where}: expected a rate-limit code, got ${JSON.stringify(body)}`);
  assert.ok(
    Number.isFinite(body.retryAfterSeconds) && body.retryAfterSeconds > 0,
    `${where}: the refusal body must say how long to wait, got ${JSON.stringify(body)}`
  );
}

test('a route the registry leaves unguarded does not answer with the loopback guard', async () => {
  // The mirror of the loop above: proves the guard is wired per route rather
  // than applied to everything, so the ORIGIN_REJECTED assertions above are
  // saying something about the routes that claim it.
  for (const route of ROUTES) {
    if (route.guard !== null) continue;
    const where = `${route.method} ${route.path}`;
    const init = probeInit(route, { token: route.csrf ? csrfToken : undefined, origin: FOREIGN_ORIGIN });
    const response = await fetch(`${baseUrl}${route.path}`, init);
    const body = await readBody(response);
    assert.notEqual(body.code, 'SETUP_UNAVAILABLE', `${where}: answered with a loopback guard it does not declare`);
  }
});

// ---------------------------------------------------------------------------
// Rate limits. Every route either has a bucket or has a written reason for
// having none, and the buckets are proven by spending them.
// ---------------------------------------------------------------------------

test('a route with no bucket records why, rather than leaving it unsaid', () => {
  for (const route of ROUTES) {
    if (route.rateLimit !== null) continue;
    const where = `${route.method} ${route.path}`;
    assert.equal(typeof route.rateLimitReason, 'string', `${where}: no bucket and no reason`);
    assert.ok(
      route.rateLimitReason.trim().length > 0,
      `${where}: rateLimitReason is empty. "No throttle" is a decision; write the sentence.`
    );
  }
});

test('every route the registry gives a bucket answers 429 with Retry-After once that bucket is spent', async () => {
  const groups = bucketGroups();
  assert.ok(groups.size >= 6, `expected the registry to declare rate-limit buckets, found ${groups.size}`);

  for (const [bucket, group] of groups) {
    const drain = group[0];
    let refusal;
    // capacity + 1 attempts at most. The loops above have already spent a
    // token on some of these routes, so the refusal can arrive sooner than
    // that -- but it has to arrive.
    for (let attempt = 0; attempt <= drain.rateLimit.capacity; attempt += 1) {
      const response = await spend(drain);
      const body = await readBody(response);
      if (response.status === 429) {
        refusal = { response, body };
        break;
      }
    }
    assert.ok(
      refusal,
      `${bucket}: ${drain.method} ${drain.path} answered ${drain.rateLimit.capacity + 1} requests in one session ` +
      'without ever refusing. The registry declares a bucket this route never takes a token from.'
    );
    assertRefusal(refusal.response, refusal.body, `${drain.method} ${drain.path}`);

    // Everything else sharing the bucket is spent too, on its first request.
    for (const route of group.slice(1)) {
      const response = await spend(route);
      const body = await readBody(response);
      assertRefusal(response, body, `${route.method} ${route.path} (sharing bucket ${bucket})`);
    }
  }
});

test('spending those buckets did not throttle a route that declares no bucket', async () => {
  // The mirror: the buckets above are per route, not one limiter over the
  // whole server. Without this, every assertion above would pass just as
  // happily against a server that answered 429 to everything by now.
  for (const route of ROUTES) {
    if (route.rateLimit !== null || route.method !== 'GET') continue;
    const where = `${route.method} ${route.path}`;
    const response = await fetch(`${baseUrl}${route.path}`, probeInit(route));
    assert.notEqual(response.status, 429, `${where}: refused as rate-limited, but declares no bucket`);
    await response.text();
  }
});
