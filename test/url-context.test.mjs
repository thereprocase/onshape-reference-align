import test from 'node:test';
import assert from 'node:assert/strict';

import { parseOnshapeUrl, contextToSearch, ONSHAPE_ID_PATTERN, MAX_INPUT_LENGTH } from '../public/url-context.mjs';

// Three distinct literal 24-hex fixture ids. Never a real Onshape document
// id — this file must never reference one, even in a comment or assertion.
const DID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const WID = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const EID = 'cccccccccccccccccccccccc';
const VID = 'dddddddddddddddddddddddd';
const MID = 'eeeeeeeeeeeeeeeeeeeeeeee';

function warningCodes(result) {
  return result.warnings.map((warning) => warning.code);
}

function assertContext(result, overrides = {}) {
  assert.equal(result.ok, true);
  assert.deepEqual(result.context, {
    documentId: DID,
    workspaceOrVersion: 'w',
    workspaceOrVersionId: WID,
    elementId: EID,
    complete: true,
    ...overrides
  });
}

test('parses a plain workspace Part Studio URL', () => {
  const result = parseOnshapeUrl(`https://cad.onshape.com/documents/${DID}/w/${WID}/e/${EID}`);
  assertContext(result);
  assert.deepEqual(warningCodes(result), []);
});

test('ignores unrelated query params on a path-form URL', () => {
  const result = parseOnshapeUrl(`https://cad.onshape.com/documents/${DID}/w/${WID}/e/${EID}?renderMode=0&uiState=abc`);
  assertContext(result);
  assert.deepEqual(warningCodes(result), []);
});

test('tolerates a trailing slash', () => {
  const result = parseOnshapeUrl(`https://cad.onshape.com/documents/${DID}/w/${WID}/e/${EID}/`);
  assertContext(result);
});

test('ignores a hash fragment', () => {
  const result = parseOnshapeUrl(`https://cad.onshape.com/documents/${DID}/w/${WID}/e/${EID}#anchor`);
  assertContext(result);
});

test('ignores path segments after the element id', () => {
  const result = parseOnshapeUrl(`https://cad.onshape.com/documents/${DID}/w/${WID}/e/${EID}/section/xyz`);
  assertContext(result);
});

test('accepts a version link and warns it is read-only', () => {
  const result = parseOnshapeUrl(`https://cad.onshape.com/documents/${DID}/v/${VID}/e/${EID}`);
  assertContext(result, { workspaceOrVersion: 'v', workspaceOrVersionId: VID });
  assert.deepEqual(warningCodes(result), ['VERSION_READ_ONLY']);
});

test('accepts a microversion link and warns it is read-only', () => {
  const result = parseOnshapeUrl(`https://cad.onshape.com/documents/${DID}/m/${MID}/e/${EID}`);
  assertContext(result, { workspaceOrVersion: 'm', workspaceOrVersionId: MID });
  assert.deepEqual(warningCodes(result), ['MICROVERSION_READ_ONLY']);
});

test('accepts http as well as https', () => {
  const result = parseOnshapeUrl(`http://cad.onshape.com/documents/${DID}/w/${WID}/e/${EID}`);
  assertContext(result);
});

test('prepends https:// when the scheme is missing', () => {
  const result = parseOnshapeUrl(`cad.onshape.com/documents/${DID}/w/${WID}/e/${EID}`);
  assertContext(result);
});

test('trims surrounding whitespace', () => {
  const result = parseOnshapeUrl(`  https://cad.onshape.com/documents/${DID}/w/${WID}/e/${EID}\n`);
  assertContext(result);
});

test('strips a single wrapping pair of angle brackets', () => {
  const result = parseOnshapeUrl(`<https://cad.onshape.com/documents/${DID}/w/${WID}/e/${EID}>`);
  assertContext(result);
});

test('warns on a host mismatch against the expected origin', () => {
  const result = parseOnshapeUrl(`https://acme.onshape.com/documents/${DID}/w/${WID}/e/${EID}`, {
    expectedOrigin: 'https://cad.onshape.com'
  });
  assertContext(result);
  assert.deepEqual(warningCodes(result), ['HOST_MISMATCH']);
});

test('the host-mismatch warning points at the setup badge, not a .env restart', () => {
  const result = parseOnshapeUrl(`https://acme.onshape.com/documents/${DID}/w/${WID}/e/${EID}`, {
    expectedOrigin: 'https://cad.onshape.com'
  });
  const message = result.warnings[0].message;
  assert.doesNotMatch(message, /\.env and restart/);
  assert.match(message, /Onshape badge/);
  assert.match(message, /enterprise or private Onshape address/);
  assert.match(message, /https:\/\/acme\.onshape\.com/);
});

test('does not warn when the expected origin matches', () => {
  const result = parseOnshapeUrl(`https://acme.onshape.com/documents/${DID}/w/${WID}/e/${EID}`, {
    expectedOrigin: 'https://acme.onshape.com'
  });
  assertContext(result);
  assert.deepEqual(warningCodes(result), []);
});

test('orders HOST_MISMATCH before VERSION_READ_ONLY', () => {
  const result = parseOnshapeUrl(`https://acme.onshape.com/documents/${DID}/v/${VID}/e/${EID}`, {
    expectedOrigin: 'https://cad.onshape.com'
  });
  assertContext(result, { workspaceOrVersion: 'v', workspaceOrVersionId: VID });
  assert.deepEqual(warningCodes(result), ['HOST_MISMATCH', 'VERSION_READ_ONLY']);
});

test('accepts the apex onshape.com domain with no mismatch warning when unset', () => {
  const result = parseOnshapeUrl(`https://onshape.com/documents/${DID}/w/${WID}/e/${EID}`);
  assertContext(result);
  assert.deepEqual(warningCodes(result), []);
});

test('accepts the extension action-URL form on a non-Onshape host', () => {
  const result = parseOnshapeUrl(`https://myhost.example/?documentId=${DID}&workspaceId=${WID}&elementId=${EID}`);
  assertContext(result);
});

test('accepts a bare query string with no host', () => {
  const result = parseOnshapeUrl(`?documentId=${DID}&workspaceId=${WID}&elementId=${EID}`);
  assertContext(result);
});

test('infers a version workspaceOrVersion from versionId in query form', () => {
  const result = parseOnshapeUrl(`https://myhost.example/?documentId=${DID}&versionId=${VID}&elementId=${EID}`);
  assertContext(result, { workspaceOrVersion: 'v', workspaceOrVersionId: VID });
  assert.deepEqual(warningCodes(result), ['VERSION_READ_ONLY']);
});

test('infers a microversion workspaceOrVersion from microversionId in query form', () => {
  const result = parseOnshapeUrl(`https://myhost.example/?documentId=${DID}&microversionId=${MID}&elementId=${EID}`);
  assertContext(result, { workspaceOrVersion: 'm', workspaceOrVersionId: MID });
  assert.deepEqual(warningCodes(result), ['MICROVERSION_READ_ONLY']);
});

test('accepts short server aliases did/wid/eid', () => {
  const result = parseOnshapeUrl(`?did=${DID}&wid=${WID}&eid=${EID}`);
  assertContext(result);
});

test('accepts wvm/wvmId aliases', () => {
  const result = parseOnshapeUrl(`?documentId=${DID}&wvm=w&wvmId=${WID}&elementId=${EID}`);
  assertContext(result);
});

test('never lower-cases the document id', () => {
  const upperDid = DID.toUpperCase();
  const result = parseOnshapeUrl(`https://cad.onshape.com/documents/${upperDid}/w/${WID}/e/${EID}`);
  assert.equal(result.ok, true);
  assert.equal(result.context.documentId, upperDid);
});

test('accepts a nonstandard-length id in query form with a warning', () => {
  const result = parseOnshapeUrl(`?documentId=abc12345&workspaceId=${WID}&elementId=${EID}`);
  assert.equal(result.ok, true);
  assert.equal(result.context.documentId, 'abc12345');
  assert.deepEqual(warningCodes(result), ['NONSTANDARD_ID']);
});

test('rejects empty input', () => {
  const result = parseOnshapeUrl('');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'EMPTY');
});

test('rejects whitespace-only input', () => {
  const result = parseOnshapeUrl('   \n  ');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'EMPTY');
});

test('rejects undefined input without throwing', () => {
  const result = parseOnshapeUrl(undefined);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'EMPTY');
});

test('rejects an input longer than MAX_INPUT_LENGTH', () => {
  assert.ok(MAX_INPUT_LENGTH > 0);
  const result = parseOnshapeUrl('x'.repeat(5000));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'TOO_LONG');
});

test('rejects the unfilled extension action-URL template', () => {
  const result = parseOnshapeUrl('https://YOUR-HOST/?documentId={$documentId}&workspaceId={$workspaceOrVersionId}&elementId={$elementId}');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'TEMPLATE_PLACEHOLDER');
});

test('rejects plain text with no throw', () => {
  const result = parseOnshapeUrl('not a url at all');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'NOT_A_URL');
});

test('rejects a javascript: scheme', () => {
  const result = parseOnshapeUrl('javascript:alert(1)');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'NOT_A_URL');
});

test('rejects a data: scheme', () => {
  const result = parseOnshapeUrl('data:text/html,<h1>hi</h1>');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'NOT_A_URL');
});

test('rejects a file: scheme', () => {
  const result = parseOnshapeUrl('file:///C:/tmp/x.html');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'NOT_A_URL');
});

test('rejects a non-Onshape host', () => {
  const result = parseOnshapeUrl(`https://example.com/documents/${DID}/w/${WID}/e/${EID}`);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'NOT_ONSHAPE_HOST');
});

test('rejects a lookalike host that is not a dot-boundary suffix match', () => {
  const result = parseOnshapeUrl(`https://onshape.com.evil.example/documents/${DID}/w/${WID}/e/${EID}`);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'NOT_ONSHAPE_HOST');
});

test('rejects the bare document root', () => {
  const result = parseOnshapeUrl('https://cad.onshape.com/');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'UNSUPPORTED_PATH');
});

test('rejects /documents with no id', () => {
  const result = parseOnshapeUrl('https://cad.onshape.com/documents');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'NO_DOCUMENT_ID');
});

test('rejects a document link with no workspace', () => {
  const result = parseOnshapeUrl(`https://cad.onshape.com/documents/${DID}`);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'NO_WORKSPACE');
});

test('rejects a workspace link with no element', () => {
  const result = parseOnshapeUrl(`https://cad.onshape.com/documents/${DID}/w/${WID}`);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'NO_ELEMENT_ID');
});

test('rejects an unrecognized workspaceOrVersion segment', () => {
  const result = parseOnshapeUrl(`https://cad.onshape.com/documents/${DID}/x/${WID}/e/${EID}`);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'UNSUPPORTED_PATH');
});

test('reports a bad document id format', () => {
  const result = parseOnshapeUrl(`https://cad.onshape.com/documents/notanid/w/${WID}/e/${EID}`);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'BAD_ID_FORMAT');
  assert.match(result.error.message, /document/);
});

test('reports a bad workspace id format', () => {
  const result = parseOnshapeUrl(`https://cad.onshape.com/documents/${DID}/w/nope/e/${EID}`);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'BAD_ID_FORMAT');
  assert.match(result.error.message, /workspace/);
});

test('reports a bad version id format', () => {
  const result = parseOnshapeUrl(`https://cad.onshape.com/documents/${DID}/v/nope/e/${EID}`);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'BAD_ID_FORMAT');
  assert.match(result.error.message, /version/);
});

test('reports a bad element id format', () => {
  const result = parseOnshapeUrl(`https://cad.onshape.com/documents/${DID}/w/${WID}/e/nope`);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'BAD_ID_FORMAT');
  assert.match(result.error.message, /element/);
});

test('reports NO_DOCUMENT_ID before other missing pieces in query form', () => {
  const result = parseOnshapeUrl(`?workspaceId=${WID}&elementId=${EID}`);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'NO_DOCUMENT_ID');
});

test('reports NO_WORKSPACE when only the document and element are given', () => {
  const result = parseOnshapeUrl(`?documentId=${DID}&elementId=${EID}`);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'NO_WORKSPACE');
});

test('reports NO_ELEMENT_ID when the workspace is given but not the element', () => {
  const result = parseOnshapeUrl(`?documentId=${DID}&workspaceId=${WID}`);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'NO_ELEMENT_ID');
});

test('freezes the result and context, and always returns a warnings array', () => {
  const ok = parseOnshapeUrl(`https://cad.onshape.com/documents/${DID}/w/${WID}/e/${EID}`);
  assert.ok(Object.isFrozen(ok));
  assert.ok(Object.isFrozen(ok.context));
  assert.ok(Array.isArray(ok.warnings));

  const bad = parseOnshapeUrl('');
  assert.ok(Object.isFrozen(bad));
  assert.ok(Array.isArray(bad.warnings));
});

test('ONSHAPE_ID_PATTERN matches exactly 24 hex characters', () => {
  assert.ok(ONSHAPE_ID_PATTERN.test(DID));
  assert.ok(!ONSHAPE_ID_PATTERN.test(`${DID}0`));
  assert.ok(!ONSHAPE_ID_PATTERN.test('notanid'));
});

test('contextToSearch produces the canonical key order', () => {
  const search = contextToSearch({
    documentId: DID,
    workspaceOrVersion: 'w',
    workspaceOrVersionId: WID,
    elementId: EID
  });
  assert.equal(search, `documentId=${DID}&workspaceOrVersion=w&workspaceOrVersionId=${WID}&elementId=${EID}`);
});

test('contextToSearch appends extra passthrough params after the canonical keys', () => {
  const search = contextToSearch({
    documentId: DID,
    workspaceOrVersion: 'w',
    workspaceOrVersionId: WID,
    elementId: EID
  }, { sessionCompanyId: 'abc' });
  assert.equal(search, `documentId=${DID}&workspaceOrVersion=w&workspaceOrVersionId=${WID}&elementId=${EID}&sessionCompanyId=abc`);
});

test('the round trip from a parsed URL feeds contextToSearch unchanged', () => {
  const parsed = parseOnshapeUrl(`https://cad.onshape.com/documents/${DID}/w/${WID}/e/${EID}`);
  const search = contextToSearch(parsed.context);
  const params = new URLSearchParams(search);
  assert.equal(params.get('documentId'), DID);
  assert.equal(params.get('workspaceOrVersion'), 'w');
  assert.equal(params.get('workspaceOrVersionId'), WID);
  assert.equal(params.get('elementId'), EID);
});
