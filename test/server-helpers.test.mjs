import test from 'node:test';
import assert from 'node:assert/strict';

import { assertNoOnshapeEnv, childEnv, spawnServer } from './helpers/server.mjs';

// childEnv() is what every test in this suite trusts to keep a spawned
// server from signing requests with the maintainer's real credentials. This
// pins that behaviour directly, against a fake base object rather than the
// real process.env, so the test cannot accidentally depend on (or corrupt)
// whatever the runner's actual environment happens to contain.
test('childEnv() strips every ONSHAPE_* variable and the launcher-config keys', () => {
  const base = {
    ONSHAPE_ACCESS_KEY: 'real-looking-key',
    ONSHAPE_SECRET_KEY: 'real-looking-secret',
    ONSHAPE_BASE_URL: 'https://cad.onshape.com',
    HOST: '0.0.0.0',
    PORT: '9999',
    PUBLIC_BASE_URL: 'https://example.test',
    SESSION_SECRET: 'real-session-secret',
    NODE_ENV: 'production',
    BACKUP_DIR: '/var/real-backups',
    UNRELATED: 'kept'
  };
  const sanitized = childEnv(base);
  assert.deepEqual(sanitized, { UNRELATED: 'kept' });
  // The input object itself must not be mutated: a caller handing in
  // process.env directly must get its real environment back unharmed.
  assert.equal(base.ONSHAPE_ACCESS_KEY, 'real-looking-key');
});

test('assertNoOnshapeEnv() throws on any leftover ONSHAPE_* key and passes a clean one through', () => {
  assert.throws(() => assertNoOnshapeEnv({ ONSHAPE_ACCESS_KEY: 'leaked' }), /ONSHAPE_ACCESS_KEY/);
  assert.doesNotThrow(() => assertNoOnshapeEnv({ PATH: '/usr/bin' }));
});

// The regression this guards against: a future test adds an extraEnv entry
// without noticing it still carries a real-looking Onshape variable (for
// example by spreading in a slice of process.env). spawnServer() must refuse
// to start rather than quietly handing that variable to the child.
test('spawnServer() refuses to start if an ONSHAPE_* variable survives into the merged env', () => {
  assert.throws(
    () => spawnServer({ configPath: 'unused', extraEnv: { ONSHAPE_ACCESS_KEY: 'leaked-into-extraEnv' } }),
    /ONSHAPE_ACCESS_KEY/
  );
});
