import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_SETTINGS,
  SETTINGS_KEYS,
  SETTING_CONSUMERS,
  createSettingsStore,
  normalizeSettings,
  readSettingsFile,
  readSettingsFileSync,
  validateSettingsPatch,
  writeSettingsFile
} from '../src/settings.mjs';
import { resolveSettingsFile } from '../src/config-paths.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Every write in this file happens inside a mkdtemp directory. Nothing here
// may touch a real configuration directory or the project's own .env.
async function withTempDir(run) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'reference-align-settings-'));
  try {
    return await run(directory, path.join(directory, 'settings.json'));
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
}

test('resolveSettingsFile puts the file beside the resolved env file', () => {
  const envPath = path.join(os.tmpdir(), 'somewhere', '.env');
  assert.equal(resolveSettingsFile(envPath), path.join(os.tmpdir(), 'somewhere', 'settings.json'));
});

test('resolveSettingsFile refuses an empty env path instead of defaulting to the cwd', () => {
  assert.throws(() => resolveSettingsFile(''), /resolved env file path/);
  assert.throws(() => resolveSettingsFile(undefined), /resolved env file path/);
});

test('the defaults hold every documented key and nothing else', () => {
  assert.deepEqual(SETTINGS_KEYS.slice().sort(), [
    'allowDocumentCreation',
    'allowFeatureInstall',
    'allowImageUpload',
    'allowSuppression',
    'confirmBeforeWrite',
    'scratchFolderId'
  ]);
  assert.equal(DEFAULT_SETTINGS.confirmBeforeWrite, true);
  assert.equal(DEFAULT_SETTINGS.scratchFolderId, null);
});

test('every setting has exactly one consumer, and each consumer file still reads it', async () => {
  const settingsKeys = SETTINGS_KEYS.slice().sort();
  const consumerKeys = Object.keys(SETTING_CONSUMERS).sort();
  assert.deepEqual(
    consumerKeys,
    settingsKeys,
    'SETTING_CONSUMERS must name exactly the keys in DEFAULT_SETTINGS — no more, no fewer'
  );

  for (const [key, consumer] of Object.entries(SETTING_CONSUMERS)) {
    assert.ok(Array.isArray(consumer.files) && consumer.files.length > 0, `${key} needs at least one consumer file`);
    for (const relativeFile of consumer.files) {
      const filePath = path.join(root, relativeFile);
      const source = await fsp.readFile(filePath, 'utf8');
      assert.ok(
        source.includes(key),
        `${relativeFile} is listed as a consumer of ${key} but no longer references it`
      );
    }
  }
});

test('normalizeSettings fills defaults, keeps valid values, and warns about the rest', () => {
  const { settings, warnings } = normalizeSettings({
    allowSuppression: false,
    allowImageUpload: 'yes',
    scratchFolderId: 'a11ce0000000000000000009',
    somethingElse: 1
  });
  assert.equal(settings.allowSuppression, false);
  assert.equal(settings.allowImageUpload, DEFAULT_SETTINGS.allowImageUpload);
  assert.equal(settings.scratchFolderId, 'a11ce0000000000000000009');
  assert.equal(settings.confirmBeforeWrite, true);
  assert.equal(warnings.length, 2);
  assert.ok(warnings.some((line) => line.includes('allowImageUpload')));
  assert.ok(warnings.some((line) => line.includes('somethingElse')));
});

test('normalizeSettings rejects a folder id that is not an Onshape id', () => {
  const { settings, warnings } = normalizeSettings({ scratchFolderId: 'not-an-id' });
  assert.equal(settings.scratchFolderId, null);
  assert.ok(warnings.some((line) => line.includes('scratchFolderId')));
});

test('normalizeSettings survives a file that is not an object at all', () => {
  for (const raw of [[], 'text', 42, null]) {
    const { settings } = normalizeSettings(raw);
    assert.deepEqual({ ...settings }, { ...DEFAULT_SETTINGS }, JSON.stringify(raw));
  }
});

test('validateSettingsPatch is strict where normalizeSettings is lenient', () => {
  assert.equal(validateSettingsPatch({ allowSuppression: false }).ok, true);
  assert.equal(validateSettingsPatch({ allowSuppression: 'false' }).ok, false);
  assert.equal(validateSettingsPatch({ nope: true }).ok, false);
  assert.match(validateSettingsPatch({ nope: true, alsoNope: 1 }).message, /Unknown settings: nope, alsoNope/);
  assert.equal(validateSettingsPatch('text').ok, false);
  assert.equal(validateSettingsPatch({ scratchFolderId: 'xyz' }).ok, false);
  assert.deepEqual(validateSettingsPatch({ scratchFolderId: '' }).patch, { scratchFolderId: null });
  assert.deepEqual(validateSettingsPatch({ scratchFolderId: null }).patch, { scratchFolderId: null });
  assert.deepEqual(
    validateSettingsPatch({ scratchFolderId: ' a11ce0000000000000000009 ' }).patch,
    { scratchFolderId: 'a11ce0000000000000000009' }
  );
});

test('a missing settings file reads as the defaults without creating anything', async () => {
  await withTempDir(async (directory, filePath) => {
    const result = await readSettingsFile(filePath);
    assert.equal(result.exists, false);
    assert.deepEqual({ ...result.settings }, { ...DEFAULT_SETTINGS });
    assert.deepEqual(await fsp.readdir(directory), []);
  });
});

test('settings round trip through the atomic writer and leave no temp files', async () => {
  await withTempDir(async (directory, filePath) => {
    await writeSettingsFile(filePath, { ...DEFAULT_SETTINGS, allowSuppression: false, scratchFolderId: 'a11ce0000000000000000009' });
    const round = await readSettingsFile(filePath);
    assert.equal(round.exists, true);
    assert.equal(round.settings.allowSuppression, false);
    assert.equal(round.settings.scratchFolderId, 'a11ce0000000000000000009');
    assert.deepEqual(round.warnings, []);

    const siblings = await fsp.readdir(directory);
    assert.deepEqual(siblings, ['settings.json']);
    // Written as pretty JSON with a trailing newline, so an operator can read
    // and hand-edit it.
    const text = await fsp.readFile(filePath, 'utf8');
    assert.match(text, /\n$/);
    assert.equal(Object.keys(JSON.parse(text)).length, SETTINGS_KEYS.length);
  });
});

test('a malformed settings file falls back to defaults with a warning instead of throwing', async () => {
  await withTempDir(async (directory, filePath) => {
    await fsp.writeFile(filePath, '{ this is not json');
    const result = await readSettingsFile(filePath);
    assert.deepEqual({ ...result.settings }, { ...DEFAULT_SETTINGS });
    assert.ok(result.warnings.some((line) => line.includes('not valid JSON')));
    assert.deepEqual(readSettingsFileSync(filePath).settings, result.settings);
  });
});

test('the store reads once at boot and keeps memory and file in step after a save', async () => {
  await withTempDir(async (directory, filePath) => {
    const store = createSettingsStore({ filePath });
    store.reload();
    assert.equal(store.exists(), false);
    assert.equal(store.current().allowSuppression, true);

    const saved = await store.save({ allowSuppression: false });
    assert.equal(saved.allowSuppression, false);
    assert.equal(store.current().allowSuppression, false);
    assert.equal(store.exists(), true);
    assert.equal(JSON.parse(fs.readFileSync(filePath, 'utf8')).allowSuppression, false);

    // A patch touches only the keys it names.
    await store.save({ allowImageUpload: false });
    assert.equal(store.current().allowSuppression, false);
    assert.equal(store.current().allowImageUpload, false);
  });
});

test('two saves racing on the same file end up last-write-wins, not half-merged', async () => {
  await withTempDir(async (directory, filePath) => {
    const store = createSettingsStore({ filePath });
    store.reload();
    await Promise.all([store.save({ allowSuppression: false }), store.save({ allowImageUpload: false })]);
    const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.equal(onDisk.allowImageUpload, false);
    assert.equal(Object.keys(onDisk).length, SETTINGS_KEYS.length);
    assert.deepEqual(await fsp.readdir(directory), ['settings.json']);
  });
});

test('the settings file never contains anything that looks like a credential', async () => {
  await withTempDir(async (directory, filePath) => {
    const store = createSettingsStore({ filePath });
    store.reload();
    // Anything not in the schema is rejected before it can reach the file.
    assert.equal(validateSettingsPatch({ ONSHAPE_SECRET_KEY: 'sekrit' }).ok, false);
    await store.save({ allowSuppression: false });
    const text = await fsp.readFile(filePath, 'utf8');
    assert.doesNotMatch(text, /KEY|secret|token|password/i);
  });
});
