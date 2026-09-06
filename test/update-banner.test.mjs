import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseVersion, isNewerVersion, shouldShowUpdateBanner } from '../public/update-banner.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('parseVersion parses a plain major.minor.patch string', () => {
  assert.deepEqual(parseVersion('0.3.0'), { major: 0, minor: 3, patch: 0 });
});

test('parseVersion tolerates a leading "v" (GitHub tag convention)', () => {
  assert.deepEqual(parseVersion('v0.3.0'), { major: 0, minor: 3, patch: 0 });
  assert.deepEqual(parseVersion('V0.3.0'), { major: 0, minor: 3, patch: 0 });
});

test('parseVersion ignores trailing pre-release/build metadata', () => {
  assert.deepEqual(parseVersion('1.2.3-beta.1'), { major: 1, minor: 2, patch: 3 });
  assert.deepEqual(parseVersion('1.2.3+build.7'), { major: 1, minor: 2, patch: 3 });
});

test('parseVersion returns undefined for a string that is not a version', () => {
  assert.equal(parseVersion('banana'), undefined);
  assert.equal(parseVersion(''), undefined);
  assert.equal(parseVersion('latest'), undefined);
});

test('parseVersion returns undefined for non-string input', () => {
  assert.equal(parseVersion(undefined), undefined);
  assert.equal(parseVersion(null), undefined);
  assert.equal(parseVersion(203), undefined);
});

test('isNewerVersion is true when major, minor, or patch is strictly greater', () => {
  assert.equal(isNewerVersion('1.0.0', '0.2.0'), true);
  assert.equal(isNewerVersion('0.3.0', '0.2.0'), true);
  assert.equal(isNewerVersion('0.2.1', '0.2.0'), true);
});

test('isNewerVersion is false when the feed reports the same version, regardless of formatting', () => {
  assert.equal(isNewerVersion('0.2.0', '0.2.0'), false);
  // Regression: a "v" prefix must not make an identical version look newer
  // through plain string inequality (war council finding frodo-4).
  assert.equal(isNewerVersion('v0.2.0', '0.2.0'), false);
});

test('isNewerVersion is false when the feed reports an older version', () => {
  // Regression: an older feed value (e.g. a stale or misconfigured
  // UPDATE_CHECK_URL) must never be announced as an update.
  assert.equal(isNewerVersion('0.1.0', '0.2.0'), false);
});

test('isNewerVersion is false when either side does not parse as a version', () => {
  assert.equal(isNewerVersion('not-a-version', '0.2.0'), false);
  assert.equal(isNewerVersion('0.3.0', 'not-a-version'), false);
  assert.equal(isNewerVersion(undefined, '0.2.0'), false);
});

test('shouldShowUpdateBanner is false when the checker reports disabled', () => {
  assert.equal(shouldShowUpdateBanner({ disabled: true, latest: '9.9.9', current: '0.2.0' }, undefined), false);
});

test('shouldShowUpdateBanner is false when latest is not actually newer', () => {
  assert.equal(shouldShowUpdateBanner({ latest: '0.1.0', current: '0.2.0' }, undefined), false);
  assert.equal(shouldShowUpdateBanner({ latest: 'v0.2.0', current: '0.2.0' }, undefined), false);
});

test('shouldShowUpdateBanner is true for a genuinely newer, never-dismissed version', () => {
  assert.equal(shouldShowUpdateBanner({ latest: '0.3.0', current: '0.2.0' }, undefined), true);
});

test('shouldShowUpdateBanner is false once that exact version has been dismissed', () => {
  assert.equal(shouldShowUpdateBanner({ latest: '0.3.0', current: '0.2.0' }, '0.3.0'), false);
});

test('shouldShowUpdateBanner is true again for a newer release after an older one was dismissed', () => {
  assert.equal(shouldShowUpdateBanner({ latest: '0.4.0', current: '0.2.0' }, '0.3.0'), true);
});

test('shouldShowUpdateBanner tolerates a missing or malformed result rather than throwing', () => {
  assert.equal(shouldShowUpdateBanner(undefined, undefined), false);
  assert.equal(shouldShowUpdateBanner({}, undefined), false);
});

test('update-banner.mjs is DOM-free and importable with no shim', async () => {
  const source = await fs.readFile(path.join(root, 'public/update-banner.mjs'), 'utf8');
  assert.doesNotMatch(source, /\bdocument\s*[.[]/);
  for (const forbidden of ['window', 'localStorage', 'navigator']) {
    assert.doesNotMatch(source, new RegExp(`\\b${forbidden}\\b`), `update-banner.mjs must not reference ${forbidden}`);
  }
  const module = await import('../public/update-banner.mjs');
  assert.equal(typeof module.parseVersion, 'function');
  assert.equal(typeof module.isNewerVersion, 'function');
  assert.equal(typeof module.shouldShowUpdateBanner, 'function');
});
