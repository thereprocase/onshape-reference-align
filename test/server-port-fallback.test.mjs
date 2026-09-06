import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fsp from 'node:fs/promises';
import { makeConfigDir, spawnServer } from './helpers/server.mjs';
import { createOnshapeStub, DEFAULT_KEYS } from './helpers/onshape-stub.mjs';

test('occupied desktop port recovers with a working setup session and preserves the existing server', async (t) => {
  const occupied = http.createServer((_req, res) => res.end('unrelated application'));
  await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => occupied.close(resolve)));
  const originalPort = occupied.address().port;
  const originalUrl = `http://127.0.0.1:${originalPort}`;
  const stub = createOnshapeStub();
  await new Promise(resolve => stub.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => stub.server.close(resolve)));
  const stubUrl = `http://127.0.0.1:${stub.server.address().port}`;
  const { configDir, configPath } = await makeConfigDir('reference-align-port-fallback-', [
    'HOST=127.0.0.1', `PORT=${originalPort}`, 'ONSHAPE_AUTH=none',
    `ONSHAPE_BASE_URL=${stubUrl}`, 'UPDATE_CHECK_URL=', 'NODE_ENV=development'
  ]);
  t.after(() => fsp.rm(configDir, { recursive: true, force: true }));
  const server = spawnServer({ configPath, args: ['--no-open'] });
  try {
    const port = await server.waitForBoundPort();
    assert.notEqual(port, originalPort);
    assert.match(server.getStdout(), /usual local address is busy/);
    const base = `http://127.0.0.1:${port}`;
    const response = await fetch(base + '/api/bootstrap', { headers: { Origin: base } });
    const bootstrap = await response.json();
    assert.equal(bootstrap.setup.available, true);
    const cookie = response.headers.get('set-cookie').split(';', 1)[0];
    const headers = { Origin: base, Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': bootstrap.csrfToken };
    const body = JSON.stringify({ ...DEFAULT_KEYS, baseUrl: stubUrl });
    const wrongOrigin = await fetch(base + '/api/setup/save', { method: 'POST', headers: { ...headers, Origin: originalUrl }, body });
    assert.equal(wrongOrigin.status, 403);
    const missingCsrf = await fetch(base + '/api/setup/save', { method: 'POST', headers: { ...headers, 'X-CSRF-Token': '' }, body });
    assert.equal(missingCsrf.status, 403);
    const saved = await fetch(base + '/api/setup/save', { method: 'POST', headers, body });
    assert.equal(saved.status, 200, JSON.stringify(await saved.json()));
    const afterSave = await (await fetch(base + '/api/bootstrap', { headers: { Origin: base, Cookie: cookie } })).json();
    assert.equal(afterSave.setup.available, true);
    assert.equal(await (await fetch(originalUrl)).text(), 'unrelated application');
    assert.equal(occupied.listening, true);
  } finally {
    await server.stop();
  }
});
