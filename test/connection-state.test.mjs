import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  describeConnection,
  describeCapabilities,
  validateApiKeyInput,
  setupFailureMessage,
  SETUP_UNAVAILABLE_MESSAGES
} from '../public/connection-state.mjs';
import { deriveCapabilities, SCOPE_BITS } from '../src/capabilities.mjs';
import { LIVE_SESSIONINFO } from './fixtures/onshape-sessioninfo.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const STATES = [
  'unconfigured',
  'checking',
  'rejected',
  'forbidden',
  'unreachable',
  'error',
  'oauth-required'
];

test('describeConnection returns non-empty text and className for every documented state', () => {
  for (const state of STATES) {
    const { text, className } = describeConnection({ connection: { state } });
    assert.ok(text.length > 0, `state ${state} produced empty text`);
    assert.match(className, /^badge\b/, `state ${state} produced a bad className`);
  }
});

test('describeConnection renders the connected state with the account name', () => {
  const { text, className, title } = describeConnection({ connection: { state: 'connected', accountName: 'Test User' } });
  assert.equal(text, 'Onshape · Test User');
  assert.equal(className, 'badge badge-good');
  assert.equal(title, 'Test User');
});

test('describeConnection clips a long account name to 24 characters plus an ellipsis, keeping the full name in title', () => {
  const longName = 'A'.repeat(60);
  const { text, title } = describeConnection({ connection: { state: 'connected', accountName: longName } });
  assert.equal(text, `Onshape · ${'A'.repeat(24)}…`);
  assert.equal(title, longName);
});

test('describeConnection does not throw on an empty or partial auth object', () => {
  assert.doesNotThrow(() => describeConnection({}));
  assert.doesNotThrow(() => describeConnection(undefined));
  assert.equal(describeConnection({}).text, 'Checking Onshape…');
  assert.equal(describeConnection(undefined).text, 'Checking Onshape…');
});

test('validateApiKeyInput reports missing keys', () => {
  assert.equal(validateApiKeyInput({ accessKey: '', secretKey: '' }).reason, 'MISSING_ACCESS_KEY');
  assert.equal(validateApiKeyInput({ accessKey: 'a'.repeat(20), secretKey: '' }).reason, 'MISSING_SECRET_KEY');
});

test('validateApiKeyInput reports internal whitespace and short keys', () => {
  assert.equal(validateApiKeyInput({ accessKey: 'has space here 12345', secretKey: 'b'.repeat(20) }).reason, 'KEY_HAS_SPACES');
  assert.equal(validateApiKeyInput({ accessKey: 'a'.repeat(20), secretKey: 'has space here 12345' }).reason, 'KEY_HAS_SPACES');
  assert.equal(validateApiKeyInput({ accessKey: 'short', secretKey: 'b'.repeat(20) }).reason, 'KEY_TOO_SHORT');
});

test('validateApiKeyInput trims whitespace and strips surrounding quotes', () => {
  const result = validateApiKeyInput({ accessKey: '  "aaaaaaaaaaaaaaaaaaaa"  ', secretKey: "'bbbbbbbbbbbbbbbbbbbb'" });
  assert.equal(result.ok, true);
  assert.equal(result.cleaned.accessKey, 'a'.repeat(20));
  assert.equal(result.cleaned.secretKey, 'b'.repeat(20));
});

test('validateApiKeyInput strips an ONSHAPE_ACCESS_KEY= style prefix and reports a notice', () => {
  const result = validateApiKeyInput({ accessKey: `ONSHAPE_ACCESS_KEY=${'a'.repeat(20)}`, secretKey: 'b'.repeat(20) });
  assert.equal(result.ok, true);
  assert.equal(result.cleaned.accessKey, 'a'.repeat(20));
  assert.ok(result.notices.some((notice) => notice.includes('ONSHAPE_ACCESS_KEY=')));
});

test('validateApiKeyInput accepts base64 characters +, / and = at length 16 or more', () => {
  const result = validateApiKeyInput({ accessKey: 'ab+/==cdefgh1234', secretKey: 'b'.repeat(20) });
  assert.equal(result.ok, true);
  assert.equal(result.cleaned.accessKey, 'ab+/==cdefgh1234');
});

test('validateApiKeyInput rejects a character outside the server’s key alphabet, mirroring src/setup-routes.mjs', () => {
  // The server enforces /^[A-Za-z0-9+/=_-]{16,256}$/ (src/setup-routes.mjs
  // KEY_PATTERN). A key with a character outside that set must be caught
  // here with a specific message instead of round-tripping to the server
  // for its generic "not in a format Onshape issues" 400.
  const accented = validateApiKeyInput({ accessKey: `caf${String.fromCharCode(233)}1234567890123`, secretKey: 'b'.repeat(20) });
  assert.equal(accented.ok, false);
  assert.equal(accented.reason, 'KEY_BAD_FORMAT');

  const dotted = validateApiKeyInput({ accessKey: 'a'.repeat(20), secretKey: 'has.a.dot.in.it.1234' });
  assert.equal(dotted.ok, false);
  assert.equal(dotted.reason, 'KEY_BAD_FORMAT');
  assert.equal(dotted.field, 'secretKey');
});

test('validateApiKeyInput rejects a key longer than 256 characters, mirroring src/setup-routes.mjs', () => {
  const result = validateApiKeyInput({ accessKey: 'a'.repeat(300), secretKey: 'b'.repeat(20) });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'KEY_BAD_FORMAT');
});

test('validateApiKeyInput rejects a non-https base url and names the https form', () => {
  const result = validateApiKeyInput({ accessKey: 'a'.repeat(20), secretKey: 'b'.repeat(20), baseUrl: 'http://acme.onshape.com' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'HTTPS_REQUIRED');
  assert.match(result.message, /https:\/\//);
});

test('validateApiKeyInput reduces a full document URL to its origin', () => {
  const result = validateApiKeyInput({
    accessKey: 'a'.repeat(20),
    secretKey: 'b'.repeat(20),
    baseUrl: 'https://acme.onshape.com/documents/abc/w/def/e/ghi'
  });
  assert.equal(result.ok, true);
  assert.equal(result.cleaned.baseUrl, 'https://acme.onshape.com');
});

test('validateApiKeyInput treats a blank base url as the default, not an error', () => {
  const result = validateApiKeyInput({ accessKey: 'a'.repeat(20), secretKey: 'b'.repeat(20), baseUrl: '   ' });
  assert.equal(result.ok, true);
  assert.equal(result.cleaned.baseUrl, undefined);
});

test('setupFailureMessage includes the enterprise rider for REJECTED only on the default host', () => {
  const onDefault = setupFailureMessage({ reason: 'REJECTED' }, { host: 'cad.onshape.com' });
  const onCustom = setupFailureMessage({ reason: 'REJECTED' }, { host: 'acme.onshape.com' });
  assert.match(onDefault, /enterprise or private Onshape address/);
  assert.doesNotMatch(onCustom, /enterprise or private Onshape address/);
});

test('setupFailureMessage names the host for UNREACHABLE and adds a rider only on a custom host', () => {
  const onDefault = setupFailureMessage({ reason: 'UNREACHABLE' }, { host: 'cad.onshape.com' });
  const onCustom = setupFailureMessage({ reason: 'UNREACHABLE' }, { host: 'acme.onshape.com' });
  assert.match(onDefault, /cad\.onshape\.com/);
  assert.doesNotMatch(onDefault, /Double-check the Onshape address/);
  assert.match(onCustom, /acme\.onshape\.com/);
  assert.match(onCustom, /Double-check the Onshape address/);
});

test('setupFailureMessage names both required permissions for FORBIDDEN', () => {
  const message = setupFailureMessage({ reason: 'FORBIDDEN' }, {});
  assert.match(message, /Read documents/);
  assert.match(message, /Write documents/);
});

test('setupFailureMessage names the injected timeoutSeconds for TIMEOUT', () => {
  const message = setupFailureMessage({ reason: 'TIMEOUT' }, { host: 'cad.onshape.com', timeoutSeconds: 8 });
  assert.match(message, /8 seconds/);
});

test('setupFailureMessage names the status for ONSHAPE_ERROR', () => {
  const message = setupFailureMessage({ reason: 'ONSHAPE_ERROR', status: 503 }, {});
  assert.match(message, /503/);
});

test('setupFailureMessage returns a non-empty fallback naming the config path for an unknown reason', () => {
  const message = setupFailureMessage({ reason: 'SOMETHING_NEW' }, { configPath: 'C:\\config\\.env' });
  assert.ok(message.length > 0);
  assert.match(message, /C:\\config\\\.env/);
});

test('every SETUP_UNAVAILABLE_MESSAGES entry is longer than 20 characters', () => {
  for (const [reason, message] of Object.entries(SETUP_UNAVAILABLE_MESSAGES)) {
    assert.ok(message.length > 20, `message for ${reason} is suspiciously short`);
  }
  assert.deepEqual(
    Object.keys(SETUP_UNAVAILABLE_MESSAGES).sort(),
    ['FORWARDED_HEADER', 'HOST_NOT_LOOPBACK', 'HTTPS_PUBLIC_URL', 'NOT_LOOPBACK', 'ORIGIN_REJECTED', 'REMOTE_CLIENT'].sort()
  );
});

test('connection-state.mjs is DOM-free and importable with no shim', async () => {
  const source = await fs.readFile(path.join(root, 'public/connection-state.mjs'), 'utf8');
  assert.doesNotMatch(source, /\bdocument\s*[.[]/);
  for (const forbidden of ['window', 'localStorage', 'navigator']) {
    assert.doesNotMatch(source, new RegExp(`\\b${forbidden}\\b`), `connection-state.mjs must not reference ${forbidden}`);
  }
  const module = await import('../public/connection-state.mjs');
  assert.equal(typeof module.describeConnection, 'function');
  assert.equal(typeof module.validateApiKeyInput, 'function');
  assert.equal(typeof module.setupFailureMessage, 'function');
});

test('describeCapabilities summarises the real key as its plan plus the scopes it has', () => {
  const detail = describeCapabilities(deriveCapabilities({ sessionInfo: LIVE_SESSIONINFO }));
  assert.equal(detail.text, 'Free · read · write');
  assert.match(detail.title, /Plan: Free\./);
  assert.match(detail.title, /Granted: read, write\./);
  assert.match(detail.title, /Missing: delete, readPii, share\./);
  // The 4096 bit is real and unexplained; saying nothing about it would be a
  // quieter lie than saying we do not know what it is.
  assert.match(detail.title, /does not recognise: 4096\./);
});

test('describeCapabilities says "permissions unknown" rather than inventing a denial', () => {
  const detail = describeCapabilities(deriveCapabilities({ sessionInfo: { planGroup: 'Professional' } }));
  assert.equal(detail.text, 'Professional · permissions unknown');
  assert.match(detail.title, /not known yet/);
});

test('describeCapabilities returns empty strings when there is nothing truthful to show', () => {
  for (const input of [undefined, {}, deriveCapabilities({})]) {
    const detail = describeCapabilities(input);
    assert.equal(detail.text, '');
    assert.equal(detail.title, '');
  }
});

test('describeCapabilities reports a key with no recognised scopes as such', () => {
  const detail = describeCapabilities(deriveCapabilities({ sessionInfo: { oauth2Scopes: 0, planGroup: 'Free' } }));
  assert.equal(detail.text, 'Free · no scopes');
  assert.match(detail.title, /no recognised permissions/);
});

test('describeConnection carries the plan detail only once a probe has said connected', () => {
  const capabilities = deriveCapabilities({ sessionInfo: LIVE_SESSIONINFO });
  const connected = describeConnection({
    connection: { state: 'connected', accountName: 'Test User' },
    capabilities
  });
  assert.equal(connected.text, 'Onshape · Test User');
  assert.equal(connected.detail, 'Free · read · write');
  assert.ok(connected.detailTitle.length > 0);

  // A cached capability model from a previous probe must not decorate a badge
  // that is currently reporting a failure.
  for (const state of ['checking', 'rejected', 'unreachable', 'unconfigured']) {
    const badge = describeConnection({ connection: { state }, capabilities });
    assert.equal(badge.detail, '', state);
    assert.equal(badge.detailTitle, '', state);
  }
});

test('the browser scope-name list has not drifted from the server bitmask table', async () => {
  // connection-state.mjs is loaded by the browser and cannot import from src/,
  // so it keeps its own copy of the scope names. This is the only thing that
  // keeps the two in step.
  const source = await fs.readFile(path.join(root, 'public/connection-state.mjs'), 'utf8');
  const match = source.match(/const SCOPE_NAMES = \[([^\]]+)\]/);
  assert.ok(match, 'expected a SCOPE_NAMES list in connection-state.mjs');
  const names = match[1].split(',').map((part) => part.trim().replace(/^'|'$/g, ''));
  assert.deepEqual(names, Object.keys(SCOPE_BITS));
});
