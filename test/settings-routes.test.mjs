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
import { createSettingsRoutes } from '../src/settings-routes.mjs';
import { createSettingsStore, DEFAULT_SETTINGS } from '../src/settings.mjs';
import { resolveSettingsFile } from '../src/config-paths.mjs';
import { featureGateReasons } from '../src/capability-gate.mjs';
import { CSRF_PATHS } from '../src/routes.mjs';
import { reservePort } from './helpers/server.mjs';

const { sendJson } = createResponders({ pretty: false });

// A real HTTP server, because the loopback guard reads req.socket addresses
// and cross-checks the Origin/Host header against config.port — neither means
// anything against a hand-built request object.
async function startServer({ settingsFileContents } = {}) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'reference-align-settings-routes-'));
  const port = await reservePort();
  const envFilePath = path.join(directory, '.env');
  fs.writeFileSync(envFilePath, `PORT=${port}\n`);
  const settingsPath = resolveSettingsFile(envFilePath);
  if (settingsFileContents !== undefined) fs.writeFileSync(settingsPath, settingsFileContents);

  const store = createConfigStore({ envFilePath, env: {}, argv: [] });
  const settingsStore = createSettingsStore({ filePath: settingsPath });
  settingsStore.reload();
  // No real capability model in this harness (that is capabilities.test.mjs's
  // job); undefined capabilities still exercises the policy half of every
  // gate, which is the half a settings save can actually change.
  const { handleSettings } = createSettingsRoutes({
    store,
    settingsStore,
    sendJson,
    gates: () => featureGateReasons({ capabilities: undefined, policy: settingsStore.current() })
  });

  const server = http.createServer(async (req, res) => {
    const session = getSession(req, res, store.current());
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/__test/session') {
      sendJson(res, 200, { csrfToken: session.csrfToken });
      return;
    }
    // Mirrors server.mjs exactly: '/api/settings' is a registered non-GET
    // route, so it is in CSRF_PATHS, and src/settings-routes.mjs contains no
    // CSRF check of its own. Reading the registry here — instead of copying
    // its contents — is what keeps this file honest about where that gate
    // actually lives.
    if (req.method === 'POST' && CSRF_PATHS.includes(url.pathname)) {
      if (!requireCsrf(req, session)) {
        sendJson(res, 403, { error: 'Invalid or missing CSRF token.', code: 'CSRF' });
        return;
      }
    }
    try {
      if (await handleSettings(req, res, url, session)) return;
    } catch (error) {
      sendJson(res, 500, { error: error.message, code: 'ERROR' });
      return;
    }
    sendJson(res, 404, { error: 'not found' });
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${port}`;
  const sessionResponse = await fetch(`${baseUrl}/__test/session`);
  const cookie = (sessionResponse.headers.get('set-cookie') || '').split(';', 1)[0];
  const { csrfToken } = await sessionResponse.json();

  return {
    baseUrl,
    cookie,
    csrfToken,
    settingsPath,
    settingsStore,
    directory,
    get(headers = {}) {
      return fetch(`${baseUrl}/api/settings`, { headers: { Cookie: cookie, ...headers } });
    },
    post(payload, headers = {}) {
      return fetch(`${baseUrl}/api/settings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
          'X-CSRF-Token': csrfToken,
          ...headers
        },
        body: typeof payload === 'string' ? payload : JSON.stringify(payload)
      });
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await fsp.rm(directory, { recursive: true, force: true });
    }
  };
}

test('GET /api/settings reports the defaults, the path, and that no file exists yet', async () => {
  const harness = await startServer();
  try {
    const response = await harness.get();
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.settings, { ...DEFAULT_SETTINGS });
    assert.deepEqual(body.defaults, { ...DEFAULT_SETTINGS });
    assert.equal(body.exists, false);
    assert.equal(body.settingsPath, harness.settingsPath);
    assert.deepEqual(body.warnings, []);
    assert.equal(typeof body.labels.allowSuppression, 'string');
    assert.equal(fs.existsSync(harness.settingsPath), false, 'a GET must not create the file');
  } finally {
    await harness.close();
  }
});

test('POST /api/settings without a CSRF token is refused before anything is written', async () => {
  const harness = await startServer();
  try {
    const response = await harness.post({ allowSuppression: false }, { 'X-CSRF-Token': 'wrong' });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'CSRF');
    assert.equal(fs.existsSync(harness.settingsPath), false);
  } finally {
    await harness.close();
  }
});

test('a forwarded header turns the settings routes off, with only a coarse reason', async () => {
  const harness = await startServer();
  try {
    for (const response of [
      await harness.get({ 'X-Forwarded-For': '203.0.113.5' }),
      await harness.post({ allowSuppression: false }, { 'X-Forwarded-Host': 'example.test' })
    ]) {
      assert.equal(response.status, 403);
      const body = await response.json();
      assert.equal(body.code, 'SETUP_UNAVAILABLE');
      assert.equal(body.reason, 'FORWARDED_HEADER');
      assert.equal('internalReason' in body, false);
    }
    assert.equal(fs.existsSync(harness.settingsPath), false);
  } finally {
    await harness.close();
  }
});

test('a foreign Origin is refused even with a valid CSRF token', async () => {
  const harness = await startServer();
  try {
    const response = await harness.post({ allowSuppression: false }, { Origin: 'https://evil.example' });
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.code, 'SETUP_UNAVAILABLE');
    assert.equal(body.reason, 'ORIGIN_REJECTED');
    assert.equal(fs.existsSync(harness.settingsPath), false);
  } finally {
    await harness.close();
  }
});

test('a valid save writes the file, updates memory, and is visible to the next GET', async () => {
  const harness = await startServer();
  try {
    const response = await harness.post({ allowSuppression: false, scratchFolderId: 'a11ce0000000000000000009' });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.settings.allowSuppression, false);
    assert.equal(body.settings.scratchFolderId, 'a11ce0000000000000000009');
    assert.equal(body.exists, true);

    assert.equal(harness.settingsStore.current().allowSuppression, false);
    assert.equal(JSON.parse(fs.readFileSync(harness.settingsPath, 'utf8')).allowSuppression, false);

    const after = await (await harness.get()).json();
    assert.equal(after.settings.allowSuppression, false);
    assert.equal(after.settings.allowImageUpload, true, 'an unnamed key keeps its value');
  } finally {
    await harness.close();
  }
});

// public/app.js's handleSettingsSave only assigns state.bootstrap.gates from
// this response's `gates` field (see the comment beside that assignment);
// without a fresh value here a switch the operator just flipped kept
// disabling — or enabling — the wrong controls until the next full page load.
test('a save carries gates recomputed against the settings it just wrote, in the same response', async () => {
  const harness = await startServer();
  try {
    const before = await (await harness.get()).json();
    assert.equal(before.gates.suppressFeature, '', 'nothing should block it before the switch is touched');

    const response = await harness.post({ allowSuppression: false });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.match(body.gates.suppressFeature, /turned off/);
    assert.match(body.gates.suppressFeature, /Suppress features/);
    // An unrelated feature's gate must not move just because a different
    // switch did.
    assert.equal(body.gates.installFeature, '');
  } finally {
    await harness.close();
  }
});

test('a save wrapped in { settings: ... } is accepted, matching what the UI posts', async () => {
  const harness = await startServer();
  try {
    const response = await harness.post({ settings: { allowImageUpload: false } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).settings.allowImageUpload, false);
  } finally {
    await harness.close();
  }
});

test('an invalid value or an unknown key is a 400 and writes nothing', async () => {
  const harness = await startServer();
  try {
    for (const payload of [{ allowSuppression: 'no' }, { nope: true }, { scratchFolderId: 'nope' }]) {
      const response = await harness.post(payload);
      assert.equal(response.status, 400, JSON.stringify(payload));
      assert.equal((await response.json()).code, 'INVALID_SETTINGS');
    }
    assert.equal(fs.existsSync(harness.settingsPath), false);
  } finally {
    await harness.close();
  }
});

test('a body that is not JSON, or is oversize, is refused by the shared readJson cap', async () => {
  const harness = await startServer();
  try {
    const bad = await harness.post('{ not json');
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).code, 'INVALID_JSON');

    const huge = await harness.post(JSON.stringify({ allowSuppression: false, padding: 'x'.repeat(8_000) }));
    assert.equal(huge.status, 413);
    assert.equal((await huge.json()).code, 'PAYLOAD_TOO_LARGE');
    assert.equal(fs.existsSync(harness.settingsPath), false);
  } finally {
    await harness.close();
  }
});

test('a hand-edited file with a bad value is served as defaults plus a warning, not an error', async () => {
  const harness = await startServer({ settingsFileContents: '{"allowSuppression": "maybe", "mystery": 1}' });
  try {
    const body = await (await harness.get()).json();
    assert.equal(body.settings.allowSuppression, DEFAULT_SETTINGS.allowSuppression);
    assert.equal(body.exists, true);
    assert.equal(body.warnings.length, 2);
  } finally {
    await harness.close();
  }
});

test('/api/settings is not swallowed by the /api/setup prefix dispatcher', () => {
  // '/api/settings'.startsWith('/api/setup') is false only because of one
  // character. server.mjs dispatches the wizard on that prefix, so this is
  // pinned rather than left to a future rename.
  assert.equal('/api/settings'.startsWith('/api/setup'), false);
});
