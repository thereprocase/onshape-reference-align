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
const VALID_KEYS = { accessKey: 'a'.repeat(24), secretKey: 'b'.repeat(24) };

// The same pathnames server.mjs gates on, read from the registry rather than
// copied, so this harness cannot model a gate the server no longer has.
function dispatchWithCsrfGate(req, res, url, session, handleSetup) {
  if (req.method === 'POST' && CSRF_PATHS.includes(url.pathname)) {
    if (!requireCsrf(req, session)) {
      sendJson(res, 403, { error: 'Invalid or missing CSRF token.', code: 'CSRF' });
      return Promise.resolve(true);
    }
  }
  return handleSetup(req, res, url, session);
}

async function startServer({ envFileContents = '', fetchImpl } = {}) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'reference-align-setup-'));
  const port = await reservePort();
  const envFilePath = path.join(directory, '.env');
  fs.writeFileSync(envFilePath, `PORT=${port}\n${envFileContents}`);
  const store = createConfigStore({ envFilePath, env: {}, argv: [] });
  const { handleSetup } = createSetupRoutes({ store, sendJson, fetchImpl });

  const server = http.createServer(async (req, res) => {
    const session = getSession(req, res, store.current());
    const url = new URL(req.url || '/', 'http://127.0.0.1');
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
    }
  };
}

test('save without prior test succeeds if the live probe passes', async () => {
  const server = await startServer({
    fetchImpl: async () => new Response(JSON.stringify({ name: 'Test User', id: 'abc' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  });
  try {
    const client = await newClient(server.baseUrl);
    const response = await client.post('/api/setup/save', VALID_KEYS);
    assert.equal(response.status, 200);
  } finally {
    await server.close();
  }
});

test('concurrent saves from different sessions both succeed', async () => {
  let callCount = 0;
  const server = await startServer({
    fetchImpl: async () => {
      callCount += 1;
      return new Response(JSON.stringify({ name: 'Test User', id: 'abc' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
  });
  try {
    const client1 = await newClient(server.baseUrl);
    const client2 = await newClient(server.baseUrl);
    const [response1, response2] = await Promise.all([
      client1.post('/api/setup/save', VALID_KEYS),
      client2.post('/api/setup/save', VALID_KEYS)
    ]);
    assert.equal(response1.status, 200);
    assert.equal(response2.status, 200);
    assert.equal(callCount, 2);
  } finally {
    await server.close();
  }
});

test('response bodies never echo keys back', async () => {
  const server = await startServer({
    fetchImpl: async () => new Response(JSON.stringify({ name: 'Test User', id: 'abc' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  });
  try {
    const client = await newClient(server.baseUrl);
    const response = await client.post('/api/setup/save', VALID_KEYS);
    const body = await response.json();
    const text = JSON.stringify(body);
    assert.ok(!text.includes(VALID_KEYS.accessKey));
    assert.ok(!text.includes(VALID_KEYS.secretKey));
  } finally {
    await server.close();
  }
});

test('sixth probe in one rate-limit window is rejected', async () => {
  let calls = 0;
  const server = await startServer({
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ name: 'Test User' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
  });
  try {
    const client = await newClient(server.baseUrl);
    for (let i = 0; i < 5; i += 1) {
      const response = await client.post('/api/setup/test', VALID_KEYS);
      assert.equal(response.status, 200);
    }
    const response = await client.post('/api/setup/test', VALID_KEYS);
    assert.equal(response.status, 429);
    assert.equal(calls, 5);
  } finally {
    await server.close();
  }
});

test('body over 4096 bytes is rejected', async () => {
  const server = await startServer({
    fetchImpl: async () => { throw new Error('fetch should not be called'); }
  });
  try {
    const client = await newClient(server.baseUrl);
    const response = await client.post('/api/setup/test', { ...VALID_KEYS, padding: 'x'.repeat(5000) });
    assert.equal(response.status, 413);
  } finally {
    await server.close();
  }
});

test('malformed keys are rejected', async () => {
  const server = await startServer({
    fetchImpl: async () => { throw new Error('fetch should not be called'); }
  });
  try {
    const client = await newClient(server.baseUrl);
    let response = await client.post('/api/setup/test', { accessKey: 'space in key!', secretKey: 'b'.repeat(24) });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'INVALID_KEY_FORMAT');
  } finally {
    await server.close();
  }
});

test('mismatched Origin header is rejected', async () => {
  const server = await startServer({
    fetchImpl: async () => { throw new Error('fetch should not be called'); }
  });
  try {
    const client = await newClient(server.baseUrl);
    const response = await client.post('/api/setup/test', VALID_KEYS, {
      headers: { Origin: 'http://evil.example.com' }
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).reason, 'ORIGIN_REJECTED');
  } finally {
    await server.close();
  }
});

test('X-Forwarded-* headers are rejected', async () => {
  const server = await startServer({
    fetchImpl: async () => { throw new Error('fetch should not be called'); }
  });
  try {
    const client = await newClient(server.baseUrl);
    for (const header of ['X-Forwarded-For', 'X-Forwarded-Host', 'Forwarded']) {
      const response = await client.post('/api/setup/test', VALID_KEYS, {
        headers: { [header]: 'something' }
      });
      assert.equal(response.status, 403);
      assert.equal((await response.json()).reason, 'FORWARDED_HEADER');
    }
  } finally {
    await server.close();
  }
});

test('temporary env files are cleaned up', async () => {
  const server = await startServer({
    fetchImpl: async () => new Response(JSON.stringify({ name: 'Test User' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  });
  try {
    const client = await newClient(server.baseUrl);
    const response = await client.post('/api/setup/save', VALID_KEYS);
    assert.equal(response.status, 200);
    const dir = path.dirname(server.envFilePath);
    const files = await fsp.readdir(dir);
    const tempFiles = files.filter(f => f.startsWith('.env.tmp-'));
    assert.deepEqual(tempFiles, []);
  } finally {
    await server.close();
  }
});
