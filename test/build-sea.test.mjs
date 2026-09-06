import test from 'node:test';
import assert from 'node:assert/strict';

import { satisfiesMinimum, platformTarget, outputName } from '../scripts/build-sea.mjs';

test('satisfiesMinimum accepts exactly the documented getAssetKeys() floor', () => {
  assert.equal(satisfiesMinimum('v22.20.0'), true);
  assert.equal(satisfiesMinimum('v24.8.0'), true);
});

test('satisfiesMinimum rejects a Node below both floors', () => {
  assert.equal(satisfiesMinimum('v22.19.9'), false);
  assert.equal(satisfiesMinimum('v22.5.0'), false);
  assert.equal(satisfiesMinimum('v21.7.0'), false);
});

test('satisfiesMinimum rejects a major that sits between two independent backports, even if numerically higher than one of them', () => {
  // 22.20.0 and 24.8.0 are two separate backports, not one continuous
  // threshold: 23.x (never mentioned by either) and 24.7.x (before the
  // 24.8.0 backport) do not have node:sea's getAssetKeys()/getRawAsset()
  // just because they numerically exceed 22.20.0.
  assert.equal(satisfiesMinimum('v23.0.0'), false);
  assert.equal(satisfiesMinimum('v24.0.0'), false);
  assert.equal(satisfiesMinimum('v24.7.9'), false);
});

test('satisfiesMinimum accepts any newer major or patch within a known floor\'s own line', () => {
  assert.equal(satisfiesMinimum('v22.20.1'), true);
  assert.equal(satisfiesMinimum('v22.21.0'), true);
  assert.equal(satisfiesMinimum('v24.8.0'), true);
  assert.equal(satisfiesMinimum('v24.14.1'), true, "the maintainer's installed version");
});

test('satisfiesMinimum assumes a major beyond the highest one Node\'s docs confirm still carries the API forward', () => {
  assert.equal(satisfiesMinimum('v25.0.0'), true);
  assert.equal(satisfiesMinimum('v26.0.0'), true);
});

test('platformTarget defaults to the running platform/arch, normalizing win32 to windows', () => {
  assert.equal(platformTarget(undefined, { platform: 'win32', arch: 'x64' }), 'windows-x64');
  assert.equal(platformTarget(undefined, { platform: 'darwin', arch: 'arm64' }), 'darwin-arm64');
  assert.equal(platformTarget(undefined, { platform: 'linux', arch: 'x64' }), 'linux-x64');
});

test('platformTarget honours an explicit override', () => {
  assert.equal(platformTarget('darwin-arm64', { platform: 'linux', arch: 'x64' }), 'darwin-arm64');
});

test('outputName adds .exe only for a windows target', () => {
  assert.equal(outputName('windows-x64'), 'reference-align.exe');
  assert.equal(outputName('darwin-arm64'), 'reference-align');
  assert.equal(outputName('linux-x64'), 'reference-align');
});
