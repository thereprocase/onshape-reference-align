import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { makeConfigDir, spawnServer } from './helpers/server.mjs';

// This is the exact scenario the War Council reproduced: launching the real
// server with PORT=0 (the SEA smoke test's own configuration) left the
// pinned config().port at 0 forever, so every request's real Origin/Host
// port failed originRefusalReason()'s comparison and /api/bootstrap reported
// the setup wizard as permanently unavailable.
test('a PORT=0 listener reports its own setup wizard as available', async () => {
  // BACKUP_DIR is derived from the temp directory itself, so the config file
  // is written in two steps: reserve the directory, then fill in its path.
  const { configDir, configPath } = await makeConfigDir('reference-align-port-zero-', []);
  await fsp.writeFile(configPath, [
    'HOST=127.0.0.1',
    'PORT=0',
    'ONSHAPE_AUTH=none',
    'SESSION_SECRET=port-zero-test-only',
    `BACKUP_DIR=${path.join(configDir, 'backups')}`,
    'NODE_ENV=test',
    ''
  ].join('\n'));

  const server = spawnServer({ configPath, args: ['--no-open'] });
  try {
    const port = await server.waitForBoundPort();
    const baseUrl = `http://127.0.0.1:${port}`;

    // No Origin header: this is the same request shape a same-origin
    // browser fetch sends, and the one the guard falls back to checking
    // against the Host header.
    const bootstrap = await (await fetch(`${baseUrl}/api/bootstrap`)).json();
    assert.equal(bootstrap.setup.available, true, `expected setup.available: true, got ${JSON.stringify(bootstrap.setup)}`);
    assert.equal(bootstrap.setup.reason, null);
    assert.equal(bootstrap.setup.configPath, configPath);

    // An Origin header naming the real bound port must also pass...
    const withMatchingOrigin = await (await fetch(`${baseUrl}/api/bootstrap`, {
      headers: { Origin: baseUrl }
    })).json();
    assert.equal(withMatchingOrigin.setup.available, true);

    // ...while one naming any other port must still be refused: the fix
    // must track the real bound port, not disable the check altogether.
    const withWrongOrigin = await (await fetch(`${baseUrl}/api/bootstrap`, {
      headers: { Origin: 'http://127.0.0.1:1' }
    })).json();
    assert.equal(withWrongOrigin.setup.available, false);
    assert.equal(withWrongOrigin.setup.reason, 'ORIGIN_REJECTED');
  } finally {
    await server.stop();
    await fsp.rm(configDir, { recursive: true, force: true });
  }
});
