import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildAssetMap, buildSeaConfig } from '../scripts/sea-assets.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('buildAssetMap includes every real file under public/, keyed identically to its disk path', async () => {
  const assets = await buildAssetMap();
  assert.ok(assets['public/index.html']);
  assert.ok(assets['public/app.js']);
  assert.ok(assets['public/styles.css']);
  for (const [key, diskPath] of Object.entries(assets)) {
    assert.equal(key, diskPath);
    await fsp.access(path.join(root, diskPath)); // throws if the file does not exist
  }
});

test('buildAssetMap always includes the FeatureScript file, not only public/', async () => {
  const assets = await buildAssetMap();
  assert.equal(assets['featurescript/ReferenceImage.fs'], 'featurescript/ReferenceImage.fs');
});

test('buildAssetMap does not silently include sample/ or other non-served directories', async () => {
  const assets = await buildAssetMap();
  for (const key of Object.keys(assets)) {
    assert.ok(key.startsWith('public/') || key === 'featurescript/ReferenceImage.fs', key);
  }
});

test('buildSeaConfig produces the fields Node\'s SEA config requires, with both snapshot flags false', async () => {
  const config = await buildSeaConfig();
  assert.equal(config.main, 'dist/bundle.cjs');
  assert.equal(config.mainFormat, undefined);
  assert.equal(config.output, 'dist/sea-prep.blob');
  assert.equal(config.disableExperimentalSEAWarning, true);
  assert.equal(config.useSnapshot, false, 'useSnapshot must stay false for portable builds');
  assert.equal(config.useCodeCache, false, 'useCodeCache must stay false for a cross-platform-safe build');
});

test('the committed sea-config.json matches what the generator would produce right now', async () => {
  const committed = JSON.parse(await fsp.readFile(path.join(root, 'sea-config.json'), 'utf8'));
  const generated = await buildSeaConfig();
  assert.deepEqual(committed, generated, 'run `node scripts/sea-assets.mjs` and commit the result');
});
