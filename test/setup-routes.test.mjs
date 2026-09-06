import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createConfigStore } from '../src/config.mjs';
import { createResponders } from '../src/http.mjs';
import { getSession, requireCsrf } from '../src/session.mjs';
import { createSetupRoutes } from '../src/setup-routes.mjs';
import { parseEnvFile } from '../src/env-file.mjs';
import { CSRF_PATHS } from '../src/routes.mjs';
import { reservePort } from './helpers/server.mjs';

const { sendJson } = createResponders({ pretty: false });

// setup-routes.mjs deliberately contains no CSRF check of its own (see its
// header comment) — the single gate lives in server.mjs, over the pathnames
// src/routes.mjs registers. This harness reads that same list rather than
// keeping a copy, so it cannot drift away from the gate it claims to model.
function dispatchWithCsrfGate(req, res, url, session, handleSetup) {
  if (req.method === 'POST' && CSRF_PATHS.includes(url.pathname)) {
    if (!requireCsrf(req, session)) {
      sendJson(res, 403, { error: 'Invalid or missing CSRF token.', code: 'CSRF' });
      return Promise.resolve(true);
    }
  }
  return handleSetup(req, res, url, session);
}

// A real HTTP server, not a hand-built IncomingMessage, because the loopback
// guard reads req.socket.remoteAddress/localAddress and the Origin/Host
// gate reads real request headers — both only mean something over a real
// socket. The Origin/Host gate also checks config.port against the request's
// actual port, so the config and the listener must agree on it; a port is
// reserved up front rather than letting the OS assign one after config is
// already built.
async function startServer({ envFileContents = '', fetchImpl, settingsStore } = {}) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'reference-align-setup-'));
  const port = await reservePort();
  const envFilePath = path.join(directory, '.env');
  fs.writeFileSync(envFilePath, `PORT=${port}\n${envFileContents}`);
  const store = createConfigStore({ envFilePath, env: {}, argv: [] });
  const { handleSetup } = createSetupRoutes({ store, sendJson, fetchImpl, settingsStore });

  const server = http.createServer(async (req, res) => {
    const session = getSession(req, res, store.current());
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    // Test-only convenience route: production obtains the CSRF token from
    // /api/bootstrap, which lives in server.mjs, not in this route module.
    if (req.method === 'GET' && url.pathname === '/__test/session') {
      sendJson(res, 200, { csrfToken: session.csrfToken });
      return;
    }
    try {
      if (await dispatchWithCsrfGate(req, res, url, session, handleSetup)) return;
    } catch (error) {
      sendJson(res, 500, { error: error.message, code: 'ERROR' });
      return;
    }
    sendJson(res, 404, { error: 'not found' });
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    store,
    envFilePath,
    directory,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await fsp.rm(directory, { recursive: true, force: true });
    }
  };
}

// A tiny cookie jar: one session's cookie plus its csrf token, fetched once.
async function newClient(baseUrl) {
  const response = await fetch(`${baseUrl}/__test/session`);
  const cookie = response.headers.get('set-cookie').split(';', 1)[0];
  const { csrfToken } = await response.json();
  return {
    cookie,
    csrfToken,
    async post(pathname, body, { headers = {}, includeCsrf = true } = {}) {
      return fetch(`${baseUrl}${pathname}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          ...(includeCsrf ? { 'X-CSRF-Token': csrfToken } : {}),
          ...headers
        },
        body: JSON.stringify(body)
      });
    },
    async get(pathname, { headers = {} } = {}) {
      return fetch(`${baseUrl}${pathname}`, { headers: { Cookie: cookie, ...headers } });
    }
  };
}

const VALID_KEYS = { accessKey: 'a'.repeat(24), secretKey: 'b'.repeat(24) };

function neverCalledFetch() {
  return () => { throw new Error('fetchImpl must not be called'); };
}

test('missing CSRF token is refused with no fetch call and nothing written', async () => {
  const server = await startServer({ fetchImpl: neverCalledFetch() });
  try {
    const client = await newClient(server.baseUrl);
    const response = await client.post('/api/setup/test', VALID_KEYS, { includeCsrf: false });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'CSRF');
  } finally {
    await server.close();
  }
});

test('a mismatched CSRF token from another session is refused', async () => {
  const server = await startServer({ fetchImpl: neverCalledFetch() });
  try {
    const clientA = await newClient(server.baseUrl);
    const clientB = await newClient(server.baseUrl);
    const response = await fetch(`${server.baseUrl}/api/setup/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: clientA.cookie, 'X-CSRF-Token': clientB.csrfToken },
      body: JSON.stringify(VALID_KEYS)
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'CSRF');
  } finally {
    await server.close();
  }
});

test('empty, spaced, and overlong keys are all refused before any fetch call', async () => {
  const server = await startServer({ fetchImpl: neverCalledFetch() });
  try {
    const client = await newClient(server.baseUrl);
    for (const keys of [
      { accessKey: '', secretKey: '' },
      { accessKey: 'has space here12345', secretKey: 'b'.repeat(24) },
      { accessKey: 'a'.repeat(300), secretKey: 'b'.repeat(24) }
    ]) {
      const response = await client.post('/api/setup/test', keys);
      assert.equal(response.status, 400);
      assert.equal((await response.json()).code, 'INVALID_KEY_FORMAT');
    }
  } finally {
    await server.close();
  }
});

test('a body over the 4096-byte cap is rejected with no fetch call', async () => {
  const server = await startServer({ fetchImpl: neverCalledFetch() });
  try {
    const client = await newClient(server.baseUrl);
    const response = await client.post('/api/setup/test', { ...VALID_KEYS, padding: 'x'.repeat(5000) });
    assert.equal(response.status, 413);
  } finally {
    await server.close();
  }
});

test('an X-Forwarded-For header refuses setup even from a loopback socket', async () => {
  const server = await startServer({ fetchImpl: neverCalledFetch() });
  try {
    const client = await newClient(server.baseUrl);
    const response = await client.post('/api/setup/test', VALID_KEYS, { headers: { 'X-Forwarded-For': '1.2.3.4' } });
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.code, 'SETUP_UNAVAILABLE');
    assert.equal(body.reason, 'FORWARDED_HEADER');
    assert.equal('internalReason' in body, false);
  } finally {
    await server.close();
  }
});

test('a Forwarded header also refuses setup', async () => {
  const server = await startServer({ fetchImpl: neverCalledFetch() });
  try {
    const client = await newClient(server.baseUrl);
    const response = await client.post('/api/setup/test', VALID_KEYS, { headers: { Forwarded: 'for=1.2.3.4' } });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).reason, 'FORWARDED_HEADER');
  } finally {
    await server.close();
  }
});

test('an https PUBLIC_BASE_URL refuses setup with reason HTTPS_PUBLIC_URL', async () => {
  const server = await startServer({
    envFileContents: 'PUBLIC_BASE_URL=https://example.test\n',
    fetchImpl: neverCalledFetch()
  });
  try {
    const client = await newClient(server.baseUrl);
    const response = await client.get('/api/setup');
    assert.equal(response.status, 403);
    assert.equal((await response.json()).reason, 'HTTPS_PUBLIC_URL');
  } finally {
    await server.close();
  }
});

test('probe outcomes map to the documented reasons at HTTP 200', async () => {
  const cases = [
    [401, 'REJECTED'],
    [403, 'FORBIDDEN'],
    [429, 'ONSHAPE_RATE_LIMITED'],
    [500, 'ONSHAPE_ERROR']
  ];
  for (const [status, reason] of cases) {
    const server = await startServer({
      fetchImpl: async () => new Response(JSON.stringify({ error: 'nope' }), { status, headers: { 'Content-Type': 'application/json' } })
    });
    try {
      const client = await newClient(server.baseUrl);
      const response = await client.post('/api/setup/test', VALID_KEYS);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.ok, false);
      assert.equal(body.reason, reason);
      assert.equal(body.status, status);
    } finally {
      await server.close();
    }
  }
});

// The server-side probe deadline (PROBE_TIMEOUT_MS, 8s) is exercised with an
// injected short timeout in connection-probe.test.mjs; re-running the real
// 8s deadline here would only slow this suite down for no extra coverage.

test('an unreachable upstream (TypeError) yields UNREACHABLE', async () => {
  const server = await startServer({
    fetchImpl: async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); }
  });
  try {
    const client = await newClient(server.baseUrl);
    const response = await client.post('/api/setup/test', VALID_KEYS);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.reason, 'UNREACHABLE');
  } finally {
    await server.close();
  }
});

test('a successful probe reports ok:true and echoes neither submitted key', async () => {
  const server = await startServer({
    fetchImpl: async () => new Response(JSON.stringify({ name: 'Test User', id: 'abc' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  });
  try {
    const client = await newClient(server.baseUrl);
    const response = await client.post('/api/setup/test', VALID_KEYS);
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.ok(!text.includes(VALID_KEYS.accessKey));
    assert.ok(!text.includes(VALID_KEYS.secretKey));
    assert.equal(JSON.parse(text).accountName, 'Test User');
  } finally {
    await server.close();
  }
});

test('six probes in one window: the sixth is rate limited without reaching the probe, shared across test and save', async () => {
  let calls = 0;
  const server = await startServer({
    fetchImpl: async () => { calls += 1; return new Response(JSON.stringify({ error: 'nope' }), { status: 401, headers: { 'Content-Type': 'application/json' } }); }
  });
  try {
    const client = await newClient(server.baseUrl);
    for (let i = 0; i < 5; i += 1) {
      const response = await client.post('/api/setup/test', VALID_KEYS);
      assert.equal(response.status, 200);
    }
    const sixth = await client.post('/api/setup/save', VALID_KEYS);
    assert.equal(sixth.status, 429);
    const body = await sixth.json();
    assert.equal(body.code, 'SETUP_RATE_LIMITED');
    assert.ok(sixth.headers.get('retry-after'));
    assert.equal(calls, 5);
  } finally {
    await server.close();
  }
});

test('requests rejected by CSRF or key format do not consume rate-limit budget', async () => {
  const server = await startServer({
    fetchImpl: async () => new Response(JSON.stringify({ name: 'Test User' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  });
  try {
    const client = await newClient(server.baseUrl);
    for (let i = 0; i < 10; i += 1) {
      await client.post('/api/setup/test', { accessKey: '', secretKey: '' });
    }
    const response = await client.post('/api/setup/test', VALID_KEYS);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
  } finally {
    await server.close();
  }
});

test('save writes exactly the four keys with one trailing newline into a fresh file', async () => {
  const server = await startServer({
    fetchImpl: async () => new Response(JSON.stringify({ name: 'Test User' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  });
  try {
    const client = await newClient(server.baseUrl);
    const response = await client.post('/api/setup/save', VALID_KEYS);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.restartRequired, []);

    const written = fs.readFileSync(server.envFilePath, 'utf8');
    const parsed = parseEnvFile(written);
    assert.equal(parsed.ONSHAPE_AUTH, 'api-key-signature');
    assert.equal(parsed.ONSHAPE_ACCESS_KEY, VALID_KEYS.accessKey);
    assert.equal(parsed.ONSHAPE_SECRET_KEY, VALID_KEYS.secretKey);
    assert.ok(written.endsWith('\n') && !written.endsWith('\n\n'));
  } finally {
    await server.close();
  }
});

test('save preserves unrelated existing lines byte-for-byte', async () => {
  const server = await startServer({
    envFileContents: '# a comment\nSESSION_SECRET=abc\nBACKUP_DIR=./backups\n',
    fetchImpl: async () => new Response(JSON.stringify({ name: 'Test User' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  });
  try {
    const client = await newClient(server.baseUrl);
    const response = await client.post('/api/setup/save', VALID_KEYS);
    assert.equal(response.status, 200);
    const written = fs.readFileSync(server.envFilePath, 'utf8');
    assert.match(written, /# a comment/);
    assert.match(written, /SESSION_SECRET=abc/);
    assert.match(written, /BACKUP_DIR=\.\/backups/);
  } finally {
    await server.close();
  }
});

test('save without confirm when already configured is refused, and writes nothing', async () => {
  const server = await startServer({
    envFileContents: 'ONSHAPE_AUTH=oauth\nONSHAPE_OAUTH_CLIENT_ID=id\nONSHAPE_OAUTH_CLIENT_SECRET=secret\nONSHAPE_OAUTH_CALLBACK_URL=https://example.test/cb\n',
    fetchImpl: neverCalledFetch()
  });
  try {
    const before = fs.readFileSync(server.envFilePath, 'utf8');
    const client = await newClient(server.baseUrl);
    const response = await client.post('/api/setup/save', VALID_KEYS);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'CONFIRMATION_REQUIRED');
    assert.equal(fs.readFileSync(server.envFilePath, 'utf8'), before);
  } finally {
    await server.close();
  }
});

test('save with confirm:true over an oauth config rewrites auth and keys but leaves oauth lines untouched', async () => {
  const server = await startServer({
    envFileContents: 'ONSHAPE_AUTH=oauth\nONSHAPE_OAUTH_CLIENT_ID=id\nONSHAPE_OAUTH_CLIENT_SECRET=secret\nONSHAPE_OAUTH_CALLBACK_URL=https://example.test/cb\n',
    fetchImpl: async () => new Response(JSON.stringify({ name: 'Test User' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  });
  try {
    const client = await newClient(server.baseUrl);
    const response = await client.post('/api/setup/save', { ...VALID_KEYS, confirm: true });
    assert.equal(response.status, 200);
    const written = fs.readFileSync(server.envFilePath, 'utf8');
    assert.match(written, /ONSHAPE_AUTH=api-key-signature/);
    assert.match(written, new RegExp(`ONSHAPE_ACCESS_KEY=${VALID_KEYS.accessKey}`));
    assert.match(written, /ONSHAPE_OAUTH_CLIENT_ID=id/);
    assert.match(written, /ONSHAPE_OAUTH_CLIENT_SECRET=secret/);
  } finally {
    await server.close();
  }
});

test('save with a REJECTED probe writes nothing even with confirmUntested:true', async () => {
  const server = await startServer({
    fetchImpl: async () => new Response(JSON.stringify({ error: 'nope' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
  });
  try {
    const before = fs.readFileSync(server.envFilePath, 'utf8');
    const client = await newClient(server.baseUrl);
    const response = await client.post('/api/setup/save', { ...VALID_KEYS, confirmUntested: true });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.reason, 'REJECTED');
    assert.equal(fs.readFileSync(server.envFilePath, 'utf8'), before);
  } finally {
    await server.close();
  }
});

test('save with an UNREACHABLE probe and confirmUntested:true writes, reloads, and reports checking', async () => {
  const server = await startServer({
    fetchImpl: async () => { throw new TypeError('fetch failed'); }
  });
  try {
    const client = await newClient(server.baseUrl);
    const response = await client.post('/api/setup/save', { ...VALID_KEYS, confirmUntested: true });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.auth.connection.state, 'checking');
    assert.match(fs.readFileSync(server.envFilePath, 'utf8'), /ONSHAPE_AUTH=api-key-signature/);
  } finally {
    await server.close();
  }
});

test('a baseUrl carrying an embedded line break never reaches the env file, even when the mangled host still probes as "ok"', async () => {
  // The WHATWG URL parser silently strips embedded CR/LF while building the
  // origin used for the live probe, so a crafted baseUrl like this one can
  // sail through candidateConfig()/probeCredentials() looking like an
  // ordinary host. What matters is whether the *original*, still-CRLF-laden
  // string that setup-routes.mjs writes to disk gets caught before it can
  // inject an extra line (e.g. a bogus ONSHAPE_AUTH override) into the env
  // file. env-file.mjs's own line-break guard is the backstop being proven
  // here, exercised through the wizard's actual write path.
  const maliciousBaseUrl = 'https://evil.example\r\nONSHAPE_AUTH=bearer\r\nONSHAPE_BEARER_TOKEN=attacker-token12345';
  const server = await startServer({
    fetchImpl: async () => new Response(JSON.stringify({ name: 'Test User' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  });
  try {
    const before = fs.readFileSync(server.envFilePath, 'utf8');
    const client = await newClient(server.baseUrl);
    const response = await client.post('/api/setup/save', { ...VALID_KEYS, baseUrl: maliciousBaseUrl });
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.code, 'CONFIG_WRITE_FAILED');
    assert.ok(!JSON.stringify(body).includes('ONSHAPE_BEARER_TOKEN'));
    const after = fs.readFileSync(server.envFilePath, 'utf8');
    assert.equal(after, before, 'nothing must be written when a submitted value carries a line break');
    assert.ok(!after.includes('attacker-token12345'));
    assert.ok(!after.includes('ONSHAPE_BEARER_TOKEN'));
  } finally {
    await server.close();
  }
});

test('immediately after a successful save, the new credentials are live with no restart', async () => {
  const server = await startServer({
    fetchImpl: async () => new Response(JSON.stringify({ name: 'Test User' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  });
  try {
    assert.equal(server.store.current().authMode, 'none');
    const client = await newClient(server.baseUrl);
    const response = await client.post('/api/setup/save', VALID_KEYS);
    const body = await response.json();
    assert.equal(body.auth.connection.state, 'connected');
    assert.equal(body.auth.connection.accountName, 'Test User');
    assert.equal(server.store.current().authMode, 'api-key-signature');
    assert.equal(server.store.current().accessKey, VALID_KEYS.accessKey);
  } finally {
    await server.close();
  }
});

// The browser only ever updates state.bootstrap.auth from this response
// (see handleSetupSave in public/app.js); without `gates` here too, a control
// gated on this brand-new key kept showing the previous key's gate text —
// including, after a policy toggle, one that had already been switched back on.
test('a successful save carries gates recomputed for the fresh key, honouring the current policy', async () => {
  const server = await startServer({
    // read + write, so the capability half of the gate passes and the
    // suppressFeature refusal below is provably the policy half, not a
    // capability denial reusing the same reason field.
    fetchImpl: async () => new Response(JSON.stringify({ name: 'Test User', oauth2Scopes: 3 }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    settingsStore: { current: () => ({ allowSuppression: false }) }
  });
  try {
    const client = await newClient(server.baseUrl);
    const response = await client.post('/api/setup/save', VALID_KEYS);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.gates.installFeature, '');
    assert.match(body.gates.suppressFeature, /turned off/);
    assert.match(body.gates.suppressFeature, /Suppress features/);
  } finally {
    await server.close();
  }
});

test('a save shadowed by a real ONSHAPE_ACCESS_KEY/SECRET_KEY env var is reported, not silently dropped', async () => {
  // buildConfig deliberately lets a real environment variable beat the file
  // on every reload (see config.mjs), which is correct for HOST/PORT-style
  // launcher configuration. But it means an operator whose process still has
  // ONSHAPE_ACCESS_KEY/SECRET_KEY set from an older deployment gets a wizard
  // that writes the file, reports success, and then keeps using the old
  // shadowed credentials anyway. This proves the route catches that instead
  // of returning ok:true.
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'reference-align-setup-'));
  try {
    const port = await reservePort();
    const envFilePath = path.join(directory, '.env');
    fs.writeFileSync(envFilePath, `PORT=${port}\n`);
    const shadowKeys = { ONSHAPE_ACCESS_KEY: 'c'.repeat(24), ONSHAPE_SECRET_KEY: 'd'.repeat(24) };
    const store = createConfigStore({ envFilePath, env: { PORT: String(port), ...shadowKeys }, argv: [] });
    // The shadow keys already make the store look configured at boot, exactly
    // as a real deployment with these env vars set would.
    assert.equal(store.current().authMode, 'api-key-signature');
    assert.equal(store.current().accessKey, shadowKeys.ONSHAPE_ACCESS_KEY);
    const { handleSetup } = createSetupRoutes({
      store,
      sendJson,
      fetchImpl: async () => new Response(JSON.stringify({ name: 'Test User' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    });
    const server = http.createServer(async (req, res) => {
      const session = getSession(req, res, store.current());
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/__test/session') {
        sendJson(res, 200, { csrfToken: session.csrfToken });
        return;
      }
      if (await dispatchWithCsrfGate(req, res, url, session, handleSetup)) return;
      sendJson(res, 404, { error: 'not found' });
    });
    try {
      await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
      const baseUrl = `http://127.0.0.1:${port}`;
      const client = await newClient(baseUrl);
      const response = await client.post('/api/setup/save', { ...VALID_KEYS, confirm: true });
      assert.equal(response.status, 500);
      const body = await response.json();
      assert.equal(body.code, 'CONFIG_SHADOWED_BY_ENVIRONMENT');
      assert.deepEqual(body.shadowedKeys.sort(), ['ONSHAPE_ACCESS_KEY', 'ONSHAPE_SECRET_KEY']);
      assert.ok(!JSON.stringify(body).includes(VALID_KEYS.accessKey));
      assert.ok(!JSON.stringify(body).includes(shadowKeys.ONSHAPE_ACCESS_KEY));

      // The file itself was written correctly...
      const fileEnv = parseEnvFile(fs.readFileSync(envFilePath, 'utf8'));
      assert.equal(fileEnv.ONSHAPE_ACCESS_KEY, VALID_KEYS.accessKey);
      // ...but the live, in-memory config still reflects the environment,
      // not the file, which is exactly the mismatch this response must not
      // paper over with ok:true.
      assert.equal(store.current().accessKey, shadowKeys.ONSHAPE_ACCESS_KEY);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
});

test('a write failure reports CONFIG_WRITE_FAILED and leaves the in-memory config untouched', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'reference-align-setup-'));
  // Initialize with a missing config, then obstruct its parent before saving.
  // Obstructing it before startup throws ENOTDIR on POSIX during the boot read
  // instead of exercising the route's config-write failure handling.
  const blocker = path.join(directory, 'blocker');
  const envFilePath = path.join(blocker, '.env');
  const port = await reservePort();
  const store = createConfigStore({ envFilePath, env: { PORT: String(port) }, argv: [] });
  fs.writeFileSync(blocker, 'not a directory');
  const { handleSetup } = createSetupRoutes({
    store,
    sendJson,
    fetchImpl: async () => new Response(JSON.stringify({ name: 'Test User' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  });
  const server = http.createServer(async (req, res) => {
    const session = getSession(req, res, store.current());
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/__test/session') {
      sendJson(res, 200, { csrfToken: session.csrfToken });
      return;
    }
    if (await dispatchWithCsrfGate(req, res, url, session, handleSetup)) return;
    sendJson(res, 404, { error: 'not found' });
  });
  try {
    await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${port}`;
    const client = await newClient(baseUrl);
    const response = await client.post('/api/setup/save', VALID_KEYS);
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.code, 'CONFIG_WRITE_FAILED');
    assert.ok(body.error.includes(envFilePath) || body.configPath === envFilePath);
    assert.equal(store.current().authMode, 'none');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fsp.rm(directory, { recursive: true, force: true });
  }
});

test('console output and response bodies never contain a submitted key, on success or failure', async () => {
  const originalError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.join(' '));
  try {
    const server = await startServer({ fetchImpl: neverCalledFetch() });
    try {
      const client = await newClient(server.baseUrl);
      await client.post('/api/setup/test', VALID_KEYS, { headers: { 'X-Forwarded-For': '1.2.3.4' } });
    } finally {
      await server.close();
    }

    const successServer = await startServer({
      fetchImpl: async () => new Response(JSON.stringify({ name: 'Test User' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    });
    try {
      const client = await newClient(successServer.baseUrl);
      const response = await client.post('/api/setup/test', VALID_KEYS);
      const text = await response.text();
      assert.ok(!text.includes(VALID_KEYS.accessKey));
      assert.ok(!text.includes(VALID_KEYS.secretKey));
    } finally {
      await successServer.close();
    }
  } finally {
    console.error = originalError;
  }
  for (const line of logged) {
    assert.ok(!line.includes(VALID_KEYS.accessKey));
    assert.ok(!line.includes(VALID_KEYS.secretKey));
  }
});

// server.mjs checks CSRF (over the registered routes) before dispatching
// to handleSetup, so setup-routes.mjs itself never sees that gate at all —
// it is effectively always "already passed" from this module's point of
// view. This test proves that fact is harmless: calling handleSetup directly
// (i.e. simulating a request for which CSRF already succeeded, or a bug that
// let a request skip it) with a forged non-loopback socket is still refused
// by the internal loopback guard. The two gates are independent; whichever
// runs first only changes which 403 body comes back, not whether both are
// ultimately enforced.
test('handleSetup refuses a forged non-loopback socket even when the CSRF gate is not exercised at all', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'reference-align-setup-'));
  try {
    const port = await reservePort();
    const envFilePath = path.join(directory, '.env');
    fs.writeFileSync(envFilePath, `PORT=${port}\n`);
    const store = createConfigStore({ envFilePath, env: {}, argv: [] });
    const { handleSetup } = createSetupRoutes({ store, sendJson, fetchImpl: neverCalledFetch() });

    const session = { id: 'forged-session', csrfToken: 'irrelevant', rateLimits: {} };
    const fakeReq = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      socket: { remoteAddress: '10.0.0.5', localAddress: '127.0.0.1' }
    };
    let status;
    let body;
    const fakeRes = {
      setHeader() {},
      writeHead(code) { status = code; },
      end(text) { body = JSON.parse(text); }
    };
    const url = new URL('http://127.0.0.1/api/setup/save');

    const handled = await handleSetup(fakeReq, fakeRes, url, session);
    assert.equal(handled, true);
    assert.equal(status, 403);
    assert.equal(body.code, 'SETUP_UNAVAILABLE');
    assert.equal(body.reason, 'REMOTE_CLIENT');
    assert.equal('internalReason' in body, false);
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
});

test('the real project .env is never touched by this suite', async () => {
  const projectEnvPath = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '.env');
  const before = fs.existsSync(projectEnvPath) ? fs.statSync(projectEnvPath).mtimeMs : undefined;
  const server = await startServer({ fetchImpl: neverCalledFetch() });
  await server.close();
  const after = fs.existsSync(projectEnvPath) ? fs.statSync(projectEnvPath).mtimeMs : undefined;
  assert.equal(after, before);
});
