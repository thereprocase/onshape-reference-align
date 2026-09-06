import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getConfig, createConfigStore, buildConfig, BOOT_ONLY_KEYS, ENV_KEYS } from '../src/config.mjs';

const KEYS = [
  'ONSHAPE_AUTH',
  'ONSHAPE_ACCESS_KEY',
  'ONSHAPE_SECRET_KEY',
  'ONSHAPE_OAUTH_CLIENT_ID',
  'ONSHAPE_OAUTH_CLIENT_SECRET',
  'ONSHAPE_OAUTH_CALLBACK_URL',
  'ONSHAPE_BEARER_TOKEN',
  'ONSHAPE_BASE_URL',
  'PUBLIC_BASE_URL'
];

function withEnv(values, callback) {
  const prior = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  try {
    for (const key of KEYS) delete process.env[key];
    for (const [key, value] of Object.entries(values)) process.env[key] = value;
    return callback();
  } finally {
    for (const key of KEYS) {
      if (prior[key] === undefined) delete process.env[key];
      else process.env[key] = prior[key];
    }
  }
}

// Every store here is pointed at a temporary env file with an explicit empty
// environment, so a test never reports whatever the maintainer happens to
// have configured in a real, ambient .env.
async function withEnvFile(contents, callback) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'reference-align-config-keys-'));
  const envFilePath = path.join(directory, '.env');
  fs.writeFileSync(envFilePath, contents);
  try {
    const store = createConfigStore({ envFilePath, env: {}, argv: [] });
    return await callback(store.current());
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
}

function withWarnings(callback) {
  const originalWarn = console.warn;
  const logged = [];
  console.warn = (...args) => logged.push(args.join(' '));
  try {
    return { result: callback(), logged };
  } finally {
    console.warn = originalWarn;
  }
}

test('auto authentication chooses signed API-key requests as the secure private default', () => {
  const config = withEnv({
    ONSHAPE_ACCESS_KEY: 'access',
    ONSHAPE_SECRET_KEY: 'secret',
    PUBLIC_BASE_URL: 'http://127.0.0.1:8787'
  }, getConfig);
  assert.equal(config.authMode, 'api-key-signature');
});

test('Basic API-key authorization must be selected explicitly', () => {
  const config = withEnv({
    ONSHAPE_AUTH: 'api-key',
    ONSHAPE_ACCESS_KEY: 'access',
    ONSHAPE_SECRET_KEY: 'secret',
    PUBLIC_BASE_URL: 'http://127.0.0.1:8787'
  }, getConfig);
  assert.equal(config.authMode, 'api-key');
});

// ENV_KEYS is the single table naming every env-file key buildConfig reads,
// its parser, and its consumer. This scan reads src/config.mjs's own source
// text and fails if a `source.X` read is added without a matching ENV_KEYS
// entry, or if an ENV_KEYS entry names a key buildConfig no longer reads —
// the two ways this table can silently go stale.
test('every source.X read in buildConfig has exactly one ENV_KEYS entry, and vice versa', () => {
  const configPath = fileURLToPath(new URL('../src/config.mjs', import.meta.url));
  const text = fs.readFileSync(configPath, 'utf8');
  const read = new Set();
  for (const match of text.matchAll(/\bsource\.([A-Z0-9_]+)\b/g)) read.add(match[1]);

  const declared = new Set(Object.keys(ENV_KEYS));

  const missingFromTable = [...read].filter((key) => !declared.has(key));
  const staleInTable = [...declared].filter((key) => !read.has(key));

  assert.deepEqual(missingFromTable, [], 'source.X read with no ENV_KEYS entry');
  assert.deepEqual(staleInTable, [], 'ENV_KEYS entry naming a key buildConfig no longer reads');
});

test('every ENV_KEYS entry names a non-empty parser and consumer', () => {
  for (const [key, entry] of Object.entries(ENV_KEYS)) {
    assert.equal(typeof entry.parser, 'string', `${key}.parser`);
    assert.ok(entry.parser.length > 0, `${key}.parser`);
    assert.equal(typeof entry.consumer, 'string', `${key}.consumer`);
    assert.ok(entry.consumer.length > 0, `${key}.consumer`);
  }
});

// A key read once from the boot snapshot (server.mjs's `boot`, not the live
// `config()` accessor) cannot honestly apply on a reload — reload() only
// warns that a restart is needed for BOOT_ONLY_KEYS. The two lists must
// agree in both directions, or a boot-only consumer added to ENV_KEYS
// without updating BOOT_ONLY_KEYS would claim a reload applies it when it
// does not, silently.
test('ENV_KEYS boot.* consumers and BOOT_ONLY_KEYS agree in both directions', () => {
  const bootConsumers = Object.entries(ENV_KEYS)
    .filter(([, entry]) => entry.consumer.startsWith('boot.'))
    .map(([key]) => key)
    .sort();
  assert.deepEqual(bootConsumers, [...BOOT_ONLY_KEYS].sort());
});

test('ENABLE_NATIVE_IMAGE_WRITE parses through a real env file', async () => {
  await withEnvFile('ENABLE_NATIVE_IMAGE_WRITE=yes\n', (config) => {
    assert.equal(config.enableNativeImageWrite, true);
  });
  await withEnvFile('ENABLE_NATIVE_IMAGE_WRITE=0\n', (config) => {
    assert.equal(config.enableNativeImageWrite, false);
  });
  await withEnvFile('# nothing configured\n', (config) => {
    assert.equal(config.enableNativeImageWrite, false);
  });
});

test('MAX_IMAGE_UPLOAD_BYTES parses through a real env file, valid and invalid', async () => {
  await withEnvFile('MAX_IMAGE_UPLOAD_BYTES=52428800\n', (config) => {
    assert.equal(config.maxImageUploadBytes, 52428800);
  });

  // buildConfig() runs synchronously while the store is created inside
  // withEnvFile, before the callback below ever sees the config — so the
  // warning capture has to wrap the whole withEnvFile call, not the callback.
  for (const invalid of ['0.4', '0', '-5', 'abc']) {
    const originalWarn = console.warn;
    const logged = [];
    console.warn = (...args) => logged.push(args.join(' '));
    let maxImageUploadBytes;
    try {
      await withEnvFile(`MAX_IMAGE_UPLOAD_BYTES=${invalid}\n`, (config) => {
        maxImageUploadBytes = config.maxImageUploadBytes;
      });
    } finally {
      console.warn = originalWarn;
    }
    assert.equal(maxImageUploadBytes, 25 * 1024 * 1024, `MAX_IMAGE_UPLOAD_BYTES=${invalid}`);
    assert.equal(logged.length, 1, `MAX_IMAGE_UPLOAD_BYTES=${invalid}`);
    assert.match(logged[0], /MAX_IMAGE_UPLOAD_BYTES/);
  }
});

test('a fractional MAX_IMAGE_UPLOAD_BYTES between 0 and 1 falls back and warns, not a silent 0-byte limit', () => {
  const { result, logged } = withWarnings(() =>
    buildConfig({ fileEnv: { MAX_IMAGE_UPLOAD_BYTES: '0.4' }, env: {} }).maxImageUploadBytes
  );
  assert.equal(result, 25 * 1024 * 1024);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /MAX_IMAGE_UPLOAD_BYTES/);
  assert.match(logged[0], /0\.4/);
});

test('UPDATE_CHECK_URL parses through a real env file, valid and invalid', async () => {
  await withEnvFile('UPDATE_CHECK_URL=https://updates.example.test/latest.json\n', (config) => {
    assert.equal(config.updateCheckUrl, 'https://updates.example.test/latest.json');
  });
  await withEnvFile('UPDATE_CHECK_URL=http://updates.example.test/latest.json\n', (config) => {
    assert.equal(config.updateCheckUrl, 'http://updates.example.test/latest.json');
  });
  await withEnvFile('# nothing configured\n', (config) => {
    assert.equal(config.updateCheckUrl, '');
  });
});

test('an UPDATE_CHECK_URL that is not an absolute http(s) URL is rejected and warns', () => {
  for (const invalid of ['javascript:alert(1)', '/relative/path', 'not a url']) {
    const { result, logged } = withWarnings(() =>
      buildConfig({ fileEnv: { UPDATE_CHECK_URL: invalid }, env: {} }).updateCheckUrl
    );
    assert.equal(result, '', `UPDATE_CHECK_URL=${invalid}`);
    assert.equal(logged.length, 1, `UPDATE_CHECK_URL=${invalid}`);
    assert.match(logged[0], /UPDATE_CHECK_URL/);
  }
});
