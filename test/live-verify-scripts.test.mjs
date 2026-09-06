// resolveScratchTarget is the one bit of scripts/live-verify-install.mjs and
// scripts/live-verify-suppress.mjs that reads operator policy: whether
// "Create scratch documents" is on, and which folder a scratch document
// should land in. It is exported, and importing either script does not run
// main() (see the isMain guard at the bottom of each), so this is exercised
// directly rather than by asserting against source text.
import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveScratchTarget as resolveScratchTargetInstall } from '../scripts/live-verify-install.mjs';
import { resolveScratchTarget as resolveScratchTargetSuppress, nativeImageSketch } from '../scripts/live-verify-suppress.mjs';
import { capturedSketch } from './fixtures/plane-features.mjs';

const FALLBACK_FOLDER_ID = 'a11ce0000000000000000009';

test('suppression fixture requires a resolved plane and preserves its captured query', () => {
  const blob = { elementId: 'a'.repeat(24), microversionId: 'b'.repeat(24) };
  assert.throws(() => nativeImageSketch(blob), /resolved sketch plane/);
  const plane = capturedSketch().parameters.find(entry => entry.parameterId === 'sketchPlane');
  const before = structuredClone(plane);
  const sketch = nativeImageSketch({ ...blob, sketchPlane: plane });
  assert.deepEqual(sketch.parameters, [before]);
  sketch.parameters[0].queries[0].deterministicIds.push('changed');
  assert.deepEqual(plane, before);
  assert.equal(sketch.entities[0].parameters[0].namespace, `e${blob.elementId}::m${blob.microversionId}`);
  assert.equal(sketch.entities[0].xaxisX, undefined, 'do not invent native placement fields');
});

for (const [name, resolveScratchTarget] of [
  ['live-verify-install.mjs', resolveScratchTargetInstall],
  ['live-verify-suppress.mjs', resolveScratchTargetSuppress]
]) {
  test(`${name}: resolveScratchTarget refuses an unset operator folder despite a fallback argument`, () => {
    const target = resolveScratchTarget({ allowDocumentCreation: true, scratchFolderId: null }, FALLBACK_FOLDER_ID);
    assert.deepEqual(target, { allowed: false, parentId: null });
  });

  test(`${name}: resolveScratchTarget prefers an operator-configured scratchFolderId over the fallback`, () => {
    const target = resolveScratchTarget(
      { allowDocumentCreation: true, scratchFolderId: 'aaaaaaaaaaaaaaaaaaaaaaaa' },
      FALLBACK_FOLDER_ID
    );
    assert.deepEqual(target, { allowed: true, parentId: 'aaaaaaaaaaaaaaaaaaaaaaaa' });
  });

  test(`${name}: resolveScratchTarget refuses when allowDocumentCreation is switched off`, () => {
    const target = resolveScratchTarget({ allowDocumentCreation: false, scratchFolderId: null }, FALLBACK_FOLDER_ID);
    assert.deepEqual(target, { allowed: false, parentId: null });
  });

  test(`${name}: resolveScratchTarget refuses even when a scratchFolderId is set, once the switch is off`, () => {
    const target = resolveScratchTarget(
      { allowDocumentCreation: false, scratchFolderId: 'aaaaaaaaaaaaaaaaaaaaaaaa' },
      FALLBACK_FOLDER_ID
    );
    assert.deepEqual(target, { allowed: false, parentId: null });
  });

  test(`${name}: resolveScratchTarget refuses missing settings`, () => {
    // readSettingsFile always returns a fully-normalized settings object in
    // practice, but the function is defensive about a missing or partial one
    // rather than throwing on a script's first live run.
    assert.deepEqual(resolveScratchTarget({}, FALLBACK_FOLDER_ID), { allowed: false, parentId: null });
    assert.deepEqual(resolveScratchTarget(undefined, FALLBACK_FOLDER_ID), { allowed: false, parentId: null });
  });

  test(`${name}: resolveScratchTarget treats an empty-string scratchFolderId as unset`, () => {
    const target = resolveScratchTarget({ allowDocumentCreation: true, scratchFolderId: '' }, FALLBACK_FOLDER_ID);
    assert.deepEqual(target, { allowed: false, parentId: null });
  });
}
