import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeContext, publicContext } from '../src/context.mjs';

function search(query) {
  return new URL(`http://127.0.0.1:8787/api/bootstrap?${query}`);
}

test('a workspace URL resolves to a complete workspace context', () => {
  const context = normalizeContext(search(
    'documentId=111111111111111111111111&workspaceOrVersion=w&workspaceOrVersionId=222222222222222222222222&elementId=333333333333333333333333'
  ));
  assert.deepEqual(context, {
    documentId: '111111111111111111111111',
    workspaceOrVersion: 'w',
    workspaceOrVersionId: '222222222222222222222222',
    elementId: '333333333333333333333333',
    complete: true
  });
});

// Onshape's own right-panel action URLs use the short parameter names.
test('the short Onshape parameter names are accepted', () => {
  const context = normalizeContext(search('did=111111111111111111111111&wid=222222222222222222222222&eid=333333333333333333333333'));
  assert.equal(context.documentId, '111111111111111111111111');
  assert.equal(context.workspaceOrVersion, 'w');
  assert.equal(context.complete, true);
});

test('a version id implies a version context, and a microversion id a microversion one', () => {
  assert.equal(normalizeContext(search('did=1&vid=2&eid=3')).workspaceOrVersion, 'v');
  assert.equal(normalizeContext(search('did=1&mid=2&eid=3')).workspaceOrVersion, 'm');
});

test('a plain object is read the same way a query string is', () => {
  const object = normalizeContext({
    documentId: ' 111111111111111111111111 ',
    workspaceOrVersion: 'W',
    workspaceOrVersionId: '222222222222222222222222',
    elementId: '333333333333333333333333'
  });
  assert.equal(object.documentId, '111111111111111111111111', 'values are trimmed');
  assert.equal(object.workspaceOrVersion, 'w', 'the mode is lower-cased');
  assert.equal(object.complete, true);
});

test('a missing piece leaves the context incomplete rather than half-usable', () => {
  assert.equal(normalizeContext(search('did=1&wid=2')).complete, false);
  assert.equal(normalizeContext(search('')).complete, false);
  assert.equal(normalizeContext(undefined).complete, false);
  // An unrecognised mode is not a workspace, a version, or a microversion.
  assert.equal(normalizeContext({ documentId: '1', workspaceOrVersion: 'x', workspaceOrVersionId: '2', elementId: '3' }).complete, false);
});

test('publicContext copies by name, so nothing else can ride along into a response', () => {
  const context = normalizeContext(search('did=1&wid=2&eid=3'));
  context.secret = 'must not travel';
  assert.deepEqual(Object.keys(publicContext(context)), [
    'documentId',
    'workspaceOrVersion',
    'workspaceOrVersionId',
    'elementId',
    'complete'
  ]);
});
