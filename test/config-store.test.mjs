import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createConfigStore, buildConfig, getConfig, BOOT_ONLY_KEYS } from '../src/config.mjs';

// Every store in this file is pointed at a temporary env file with an explicit
// empty environment. A test that read the ambient .env would report whatever
// credentials the maintainer happens to have configured.
async function withEnvFile(contents, callback, env = {}) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'reference-align-config-'));
  const envFilePath = path.join(directory, '.env');
  fs.writeFileSync(envFilePath, contents);
  const rewrite = (next) => fs.writeFileSync(envFilePath, next);
  try {
    return await callback({
      store: createConfigStore({ envFilePath, env, argv: [] }),
      envFilePath,
      rewrite
    });
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
}

// A hand-edited .env is full of trailing "# ..." comments; the loader must
// not let one leak into the value it feeds buildConfig, or the API version
// gets a stray "#" appended to every request URL.
test('a hand-edited env file with trailing comments loads clean values end to end', async () => {
  await withEnvFile(
    'ONSHAPE_API_VERSION=v17 # pinned\nMAX_IMAGE_UPLOAD_BYTES=52428800 # 50 MB\n',
    ({ store }) => {
      assert.equal(store.current().apiVersion, 'v17');
      assert.equal(store.current().maxImageUploadBytes, 52428800);
    }
  );
});

test('a reload picks up a rewritten credential without a restart', async () => {
  await withEnvFile('ONSHAPE_AUTH=api-key-signature\nONSHAPE_ACCESS_KEY=first\nONSHAPE_SECRET_KEY=secret\n', ({ store, rewrite }) => {
    assert.equal(store.current().accessKey.length, 5);

    rewrite('ONSHAPE_AUTH=api-key-signature\nONSHAPE_ACCESS_KEY=second-key\nONSHAPE_SECRET_KEY=secret\n');
    const result = store.reload();

    assert.equal(store.current().accessKey.length, 10);
    assert.equal(result.config.accessKey.length, 10);
    assert.ok(result.changed.includes('accessKey'));
    assert.deepEqual(result.restartRequired, []);
  });
});

test('a reload drops keys that were deleted from the file', async () => {
  await withEnvFile('ONSHAPE_AUTH=api-key-signature\nONSHAPE_ACCESS_KEY=first\nONSHAPE_SECRET_KEY=secret\n', ({ store, rewrite }) => {
    assert.equal(store.current().authMode, 'api-key-signature');

    rewrite('# nothing configured\n');
    store.reload();

    assert.equal(store.current().authMode, 'none');
    assert.equal(store.current().accessKey, '');
    assert.equal(store.current().secretKey, '');
  });
});

test('a real environment variable beats the file, before and after a reload', async () => {
  await withEnvFile(
    'ONSHAPE_AUTH=api-key-signature\nONSHAPE_ACCESS_KEY=from-file\nONSHAPE_SECRET_KEY=secret\n',
    ({ store, rewrite }) => {
      assert.equal(store.current().accessKey, 'from-env');
      rewrite('ONSHAPE_AUTH=api-key-signature\nONSHAPE_ACCESS_KEY=file-again\nONSHAPE_SECRET_KEY=secret\n');
      store.reload();
      assert.equal(store.current().accessKey, 'from-env');
    },
    { ONSHAPE_ACCESS_KEY: 'from-env' }
  );
});

test('reading the config never mutates process.env', () => {
  const before = JSON.stringify(process.env);
  getConfig();
  getConfig();
  assert.equal(JSON.stringify(process.env), before);
});

test('boot-only keys are pinned and reported as needing a restart', async () => {
  await withEnvFile('PORT=8787\nHOST=127.0.0.1\n', ({ store, rewrite }) => {
    assert.equal(store.current().port, 8787);

    rewrite('PORT=9999\nHOST=127.0.0.1\n');
    const result = store.reload();

    assert.equal(store.current().port, 8787);
    assert.equal(store.current().publicBaseUrl, 'http://127.0.0.1:8787');
    assert.deepEqual(result.restartRequired, ['PORT']);
  });
});

test('every boot-only key is honoured, not just PORT', async () => {
  await withEnvFile(
    'HOST=127.0.0.1\nPORT=8787\nPUBLIC_BASE_URL=http://127.0.0.1:8787\nUPDATE_CHECK_URL=http://updates.example.test/a\nNODE_ENV=test\n',
    ({ store, rewrite }) => {
      const boot = store.current();
      rewrite('HOST=0.0.0.0\nPORT=9999\nPUBLIC_BASE_URL=https://example.test\nUPDATE_CHECK_URL=http://updates.example.test/b\nNODE_ENV=production\n');
      const result = store.reload();

      assert.deepEqual(result.restartRequired, [...BOOT_ONLY_KEYS]);
      assert.equal(store.current().host, boot.host);
      assert.equal(store.current().port, boot.port);
      assert.equal(store.current().publicBaseUrl, boot.publicBaseUrl);
      assert.equal(store.current().updateCheckUrl, boot.updateCheckUrl);
      assert.equal(store.current().nodeEnv, boot.nodeEnv);
      assert.equal(store.current().cookieSecure, false);
    }
  );
});

test('a malformed file leaves the previous config and generation in place', async () => {
  await withEnvFile('ONSHAPE_BASE_URL=https://cad.onshape.com\n', ({ store, rewrite }) => {
    const before = store.current();
    assert.equal(store.generation, 1);

    rewrite('ONSHAPE_BASE_URL=http://cad.example.com\n');
    assert.throws(() => store.reload(), /HTTPS Onshape origins/);

    assert.equal(store.current(), before);
    assert.equal(store.current().onshapeBaseUrl, 'https://cad.onshape.com');
    assert.equal(store.generation, 1);
  });
});

test('the generation counts successful reloads only', async () => {
  await withEnvFile('ONSHAPE_BASE_URL=https://cad.onshape.com\n', ({ store, rewrite }) => {
    assert.equal(store.generation, 1);
    store.reload();
    assert.equal(store.generation, 2);

    rewrite('ONSHAPE_AUTH=nonsense\n');
    assert.throws(() => store.reload());
    assert.equal(store.generation, 2);
  });
});

test('a missing env file is not an error and reports its resolved location', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'reference-align-config-'));
  const envFilePath = path.join(directory, '.env');
  try {
    const store = createConfigStore({ envFilePath, env: {}, argv: [] });
    assert.equal(store.envFileExists(), false);
    assert.equal(store.current().authMode, 'none');
    assert.equal(store.current().envFilePath, envFilePath);
    assert.equal(store.current().envFileSource, 'cli');
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
});

test('the config and its oauth block are both frozen', () => {
  const config = buildConfig({ fileEnv: {}, env: {} });
  assert.equal(Object.isFrozen(config), true);
  assert.equal(Object.isFrozen(config.oauth), true);
  assert.throws(() => { config.authMode = 'api-key'; }, TypeError);
  assert.throws(() => { config.oauth.clientId = 'x'; }, TypeError);
});

test('buildConfig reads no ambient state when both layers are supplied', () => {
  const config = buildConfig({
    fileEnv: { ONSHAPE_AUTH: 'bearer', ONSHAPE_BEARER_TOKEN: 'token' },
    env: {},
    projectRoot: path.join(path.sep, 'project'),
    envFilePath: path.join(path.sep, 'project', '.env'),
    envFileSource: 'project'
  });
  assert.equal(config.authMode, 'bearer');
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 8787);
  assert.equal(config.backupDir, path.resolve(path.join(path.sep, 'project'), './backups'));
});

test('a non-numeric PORT is rejected instead of producing a NaN listener', () => {
  assert.throws(
    () => buildConfig({ fileEnv: { PORT: 'not-a-port' }, env: {} }),
    /PORT must be an integer between 0 and 65535, got: not-a-port/
  );
});

test('a PORT outside the valid range is rejected', () => {
  assert.throws(() => buildConfig({ fileEnv: { PORT: '-1' }, env: {} }), /PORT must be an integer/);
  assert.throws(() => buildConfig({ fileEnv: { PORT: '65536' }, env: {} }), /PORT must be an integer/);
});

test('a fractional PORT is rejected', () => {
  assert.throws(() => buildConfig({ fileEnv: { PORT: '8787.5' }, env: {} }), /PORT must be an integer/);
});

test('PORT accepts its full valid range, including both boundaries', () => {
  assert.equal(buildConfig({ fileEnv: { PORT: '0' }, env: {} }).port, 0);
  assert.equal(buildConfig({ fileEnv: { PORT: '65535' }, env: {} }).port, 65535);
});

// server.mjs calls `new URL(boot.publicBaseUrl)` both per-request and again in
// the listen callback (to correct an ephemeral PORT=0 bind). Before this
// check, an unparsable PUBLIC_BASE_URL sailed through buildConfig and only
// surfaced as an uncaught exception once the server tried to use it.
test('an unparsable PUBLIC_BASE_URL is rejected at boot instead of crashing later', () => {
  assert.throws(
    () => buildConfig({ fileEnv: { PUBLIC_BASE_URL: 'not a url' }, env: {} }),
    /PUBLIC_BASE_URL must be a valid absolute URL, got: not a url/
  );
});

test('a PUBLIC_BASE_URL missing a scheme is rejected', () => {
  assert.throws(
    () => buildConfig({ fileEnv: { PUBLIC_BASE_URL: 'example.test' }, env: {} }),
    /PUBLIC_BASE_URL must be a valid absolute URL, got: example.test/
  );
});

test('a well-formed PUBLIC_BASE_URL is accepted', () => {
  assert.equal(
    buildConfig({ fileEnv: { PUBLIC_BASE_URL: 'https://example.test' }, env: {} }).publicBaseUrl,
    'https://example.test'
  );
});

test('an unset MAX_IMAGE_UPLOAD_BYTES uses the default without warning', () => {
  const originalWarn = console.warn;
  const logged = [];
  console.warn = (...args) => logged.push(args.join(' '));
  try {
    const config = buildConfig({ fileEnv: {}, env: {} });
    assert.equal(config.maxImageUploadBytes, 25 * 1024 * 1024);
  } finally {
    console.warn = originalWarn;
  }
  assert.deepEqual(logged, []);
});

test('a valid MAX_IMAGE_UPLOAD_BYTES is used as an exact integer', () => {
  assert.equal(
    buildConfig({ fileEnv: { MAX_IMAGE_UPLOAD_BYTES: '52428800' }, env: {} }).maxImageUploadBytes,
    52428800
  );
  assert.equal(
    buildConfig({ fileEnv: { MAX_IMAGE_UPLOAD_BYTES: '1000.9' }, env: {} }).maxImageUploadBytes,
    1000
  );
});

// A zero, a negative number, or an unparsable value must not stop the server
// from starting, but silently keeping the default with no explanation is how
// an operator's raised limit does nothing and nobody notices. Emit a warning
// instead of failing.
test('a non-numeric MAX_IMAGE_UPLOAD_BYTES falls back to the default and warns', () => {
  const originalWarn = console.warn;
  const logged = [];
  console.warn = (...args) => logged.push(args.join(' '));
  try {
    const config = buildConfig({ fileEnv: { MAX_IMAGE_UPLOAD_BYTES: '52428800 # 50 MB' }, env: {} });
    assert.equal(config.maxImageUploadBytes, 25 * 1024 * 1024);
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(logged.length, 1);
  assert.match(logged[0], /MAX_IMAGE_UPLOAD_BYTES/);
  assert.match(logged[0], /52428800 # 50 MB/);
});

test('a zero or negative MAX_IMAGE_UPLOAD_BYTES falls back to the default and warns', () => {
  const originalWarn = console.warn;
  const logged = [];
  console.warn = (...args) => logged.push(args.join(' '));
  try {
    assert.equal(buildConfig({ fileEnv: { MAX_IMAGE_UPLOAD_BYTES: '0' }, env: {} }).maxImageUploadBytes, 25 * 1024 * 1024);
    assert.equal(buildConfig({ fileEnv: { MAX_IMAGE_UPLOAD_BYTES: '-1' }, env: {} }).maxImageUploadBytes, 25 * 1024 * 1024);
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(logged.length, 2);
});

// PORT=0 asks the OS for an ephemeral port; commitBoundPort() is how the
// listen callback in server.mjs feeds the port it actually got back into
// current(). Every check gated on config().port — most importantly
// originRefusalReason()'s Origin/Host comparison — must see this value, or a
// PORT=0 listener can never pass its own setup-wizard guard.
test('commitBoundPort replaces the pinned port and rewrites the default publicBaseUrl', async () => {
  await withEnvFile('HOST=127.0.0.1\nPORT=0\n', ({ store }) => {
    assert.equal(store.current().port, 0);
    assert.equal(store.current().publicBaseUrl, 'http://127.0.0.1:0');

    const updated = store.commitBoundPort(54321);

    assert.equal(updated, store.current());
    assert.equal(store.current().port, 54321);
    assert.equal(store.current().publicBaseUrl, 'http://127.0.0.1:54321');
  });
});

test('commitBoundPort is a no-op when the OS bound the exact requested port', async () => {
  await withEnvFile('HOST=127.0.0.1\nPORT=8787\n', ({ store }) => {
    const before = store.current();
    const result = store.commitBoundPort(8787);
    assert.equal(result, before);
    assert.equal(store.current(), before);
  });
});

test('commitBoundPort still rewrites the port of an explicit PUBLIC_BASE_URL', async () => {
  await withEnvFile('HOST=127.0.0.1\nPORT=0\nPUBLIC_BASE_URL=http://127.0.0.1:0\n', ({ store }) => {
    store.commitBoundPort(9001);
    assert.equal(store.current().publicBaseUrl, 'http://127.0.0.1:9001');
  });
});

test('commitBoundPort survives a later reload instead of reverting to the requested port', async () => {
  await withEnvFile('HOST=127.0.0.1\nPORT=0\n', ({ store }) => {
    store.commitBoundPort(54321);
    store.reload();
    assert.equal(store.current().port, 54321);
    assert.equal(store.current().publicBaseUrl, 'http://127.0.0.1:54321');
  });
});

test('commitBoundPort rejects an out-of-range port', async () => {
  await withEnvFile('HOST=127.0.0.1\nPORT=0\n', ({ store }) => {
    assert.throws(() => store.commitBoundPort(-1), /commitBoundPort: port must be an integer/);
    assert.throws(() => store.commitBoundPort(65536), /commitBoundPort: port must be an integer/);
    assert.throws(() => store.commitBoundPort(1.5), /commitBoundPort: port must be an integer/);
  });
});
