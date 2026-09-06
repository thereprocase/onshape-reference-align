import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  parseEnvFile,
  updateEnvText,
  readEnvFileText,
  writeEnvFileAtomic,
  applyEnvUpdates
} from '../src/env-file.mjs';

async function tempDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'reference-align-env-'));
}

test('an existing key is replaced in place with every other line preserved', () => {
  const before = '# Server\nPORT=8787\n\n# keys\nONSHAPE_ACCESS_KEY=\n';
  const after = updateEnvText(before, { ONSHAPE_ACCESS_KEY: 'AAA' });
  assert.equal(after, '# Server\nPORT=8787\n\n# keys\nONSHAPE_ACCESS_KEY=AAA\n');
});

test('unknown keys are appended under a single generated header', () => {
  const after = updateEnvText('A=1\n', { B: '2' });
  assert.equal(after, 'A=1\n\n# Added by Reference Align setup\nB=2\n');
  assert.deepEqual(parseEnvFile(after), { A: '1', B: '2' });

  const twice = updateEnvText(after, { C: '3' });
  assert.equal(twice.match(/# Added by Reference Align setup/g).length, 1);
  assert.deepEqual(parseEnvFile(twice), { A: '1', B: '2', C: '3' });
});

test('a file generated from nothing carries no header', () => {
  assert.equal(updateEnvText('', { ONSHAPE_AUTH: 'none' }), 'ONSHAPE_AUTH=none\n');
});

test('a null update deletes the key and leaves one trailing newline', () => {
  assert.equal(updateEnvText('A=1\nB=2\n', { B: null }), 'A=1\n');
});

test('quoted values round trip through parseEnvFile exactly', () => {
  for (const value of ['has space #hash', 'say "hi" now', "it's fine", 'trailing space ', '#leading']) {
    const text = updateEnvText('A=1\n', { A: value });
    assert.equal(parseEnvFile(text).A, value, `round trip failed for ${JSON.stringify(value)}`);
  }
});

test('a trailing " # comment" on an unquoted value is dropped', () => {
  const text = 'MAX_IMAGE_UPLOAD_BYTES=52428800 # 50 MB\nONSHAPE_API_VERSION=v17 # pinned\nENABLE_NATIVE_IMAGE_WRITE=true # experimental\n';
  assert.deepEqual(parseEnvFile(text), {
    MAX_IMAGE_UPLOAD_BYTES: '52428800',
    ONSHAPE_API_VERSION: 'v17',
    ENABLE_NATIVE_IMAGE_WRITE: 'true'
  });
});

test('a "#" with no preceding space is kept as part of an unquoted value', () => {
  assert.deepEqual(parseEnvFile('COLOR=#FF0000\n'), { COLOR: '#FF0000' });
});

test('a quoted value containing "#" is not altered by comment stripping', () => {
  assert.deepEqual(parseEnvFile('A="value # still inside quotes"\n'), { A: 'value # still inside quotes' });
});

test('multiple spaces before the comment marker are all trimmed from the value', () => {
  assert.deepEqual(parseEnvFile('A=value    # comment\n'), { A: 'value' });
});

test('a value containing a line break is refused with status 400 and no output', () => {
  assert.throws(
    () => updateEnvText('A=1\n', { A: 'line1\nONSHAPE_SECRET_KEY=stolen' }),
    (error) => error.status === 400 && /line break/.test(error.message)
  );
  assert.throws(() => updateEnvText('A=1\n', { A: 'line1\rB=2' }), (error) => error.status === 400);
});

test('CRLF files keep their line endings', () => {
  const after = updateEnvText('# c\r\nA=1\r\n', { A: '2' });
  assert.equal(after, '# c\r\nA=2\r\n');
});

test('readEnvFileText treats a missing file as empty', async () => {
  const directory = await tempDir();
  try {
    assert.equal(await readEnvFileText(path.join(directory, 'absent.env')), '');
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
});

test('applyEnvUpdates creates the file, reports the change, and leaves no temp sibling', async () => {
  const directory = await tempDir();
  const target = path.join(directory, 'nested', '.env');
  try {
    const result = await applyEnvUpdates(target, { ONSHAPE_AUTH: 'none' });
    assert.deepEqual(result, { created: true, changedKeys: ['ONSHAPE_AUTH'] });
    assert.equal(await fsp.readFile(target, 'utf8'), 'ONSHAPE_AUTH=none\n');

    const siblings = await fsp.readdir(path.dirname(target));
    assert.deepEqual(siblings.filter((name) => name.startsWith('.env.tmp-')), []);

    if (process.platform !== 'win32') {
      const stat = await fsp.stat(target);
      assert.equal(stat.mode & 0o777, 0o600);
    }

    const second = await applyEnvUpdates(target, { ONSHAPE_AUTH: 'none' });
    assert.deepEqual(second, { created: false, changedKeys: [] });
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
});

test('a failed write leaves the existing file byte-for-byte unchanged', async () => {
  const directory = await tempDir();
  const target = path.join(directory, '.env');
  const original = '# keep me\nPORT=9999\n';
  try {
    await fsp.writeFile(target, original);
    await assert.rejects(
      () => applyEnvUpdates(target, { ONSHAPE_ACCESS_KEY: 'AAA' }, {
        write: async () => { throw Object.assign(new Error('disk is full'), { code: 'ENOSPC' }); }
      }),
      /disk is full/
    );
    assert.equal(await fsp.readFile(target, 'utf8'), original);
    const siblings = await fsp.readdir(directory);
    assert.deepEqual(siblings.filter((name) => name.startsWith('.env.tmp-')), []);
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
});

test('writeEnvFileAtomic replaces the target and creates missing directories', async () => {
  const directory = await tempDir();
  const target = path.join(directory, 'a', 'b', '.env');
  try {
    await writeEnvFileAtomic(target, 'A=1\n');
    await writeEnvFileAtomic(target, 'A=2\n');
    assert.equal(fs.readFileSync(target, 'utf8'), 'A=2\n');
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
});

test('concurrent saves serialise instead of losing a merge', async () => {
  const directory = await tempDir();
  const target = path.join(directory, '.env');
  try {
    await Promise.all([
      applyEnvUpdates(target, { A: '1' }),
      applyEnvUpdates(target, { B: '2' })
    ]);
    assert.deepEqual(parseEnvFile(await fsp.readFile(target, 'utf8')), { A: '1', B: '2' });
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
});
