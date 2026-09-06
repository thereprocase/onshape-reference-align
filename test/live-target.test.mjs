import test from 'node:test';
import assert from 'node:assert/strict';
import { isExampleOnshapeId, resolveScratchTarget, requireScratchFolder } from '../scripts/live-target.mjs';

test('public capture identifiers and missing scratch policy fail closed', () => {
  for (const id of ['a11ce0000000000000000001', '0'.repeat(24)]) {
    assert.equal(isExampleOnshapeId(id), true);
    assert.equal(resolveScratchTarget({ scratchFolderId: id }).allowed, false);
    assert.throws(() => requireScratchFolder({ scratchFolderId: id }), /configure your own/);
  }
  for (const settings of [undefined, {}, { scratchFolderId: 'invalid' }, { scratchFolderId: 'a'.repeat(24), allowDocumentCreation: false }]) {
    assert.throws(() => requireScratchFolder(settings));
  }
  assert.equal(requireScratchFolder({ scratchFolderId: 'a'.repeat(24), allowDocumentCreation: true }), 'a'.repeat(24));
});
