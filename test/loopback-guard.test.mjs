import test from 'node:test';
import assert from 'node:assert/strict';

import { isLoopbackAddress, loopbackRefusalReason, originRefusalReason, setupGuardFailure } from '../src/loopback-guard.mjs';

const baseConfig = Object.freeze({ host: '127.0.0.1', port: 8787, publicBaseUrl: 'http://127.0.0.1:8787' });

function req({ headers = {}, remoteAddress = '127.0.0.1', localAddress = '127.0.0.1' } = {}) {
  return { headers, socket: { remoteAddress, localAddress } };
}

test('isLoopbackAddress accepts ::1, mapped IPv4, and all of 127.0.0.0/8', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true);
  assert.equal(isLoopbackAddress('127.0.0.5'), true);
  assert.equal(isLoopbackAddress('127.255.255.255'), true);
  assert.equal(isLoopbackAddress('::1'), true);
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
});

test('isLoopbackAddress rejects non-loopback and missing addresses', () => {
  assert.equal(isLoopbackAddress('10.0.0.5'), false);
  assert.equal(isLoopbackAddress('192.168.1.1'), false);
  assert.equal(isLoopbackAddress('::2'), false);
  assert.equal(isLoopbackAddress(undefined), false);
  assert.equal(isLoopbackAddress(''), false);
  assert.equal(isLoopbackAddress(null), false);
});

test('loopbackRefusalReason accepts a plain loopback request', () => {
  assert.equal(loopbackRefusalReason(req(), baseConfig), null);
  assert.equal(loopbackRefusalReason(req({ remoteAddress: '::1', localAddress: '::1' }), baseConfig), null);
  assert.equal(loopbackRefusalReason(req({ remoteAddress: '::ffff:127.0.0.1' }), baseConfig), null);
  assert.equal(loopbackRefusalReason(req({ remoteAddress: '127.0.0.5' }), baseConfig), null);
});

test('loopbackRefusalReason refuses a non-loopback remote address', () => {
  assert.equal(loopbackRefusalReason(req({ remoteAddress: '10.0.0.5' }), baseConfig), 'REMOTE_ADDRESS_NOT_LOOPBACK');
});

test('loopbackRefusalReason refuses every forwarded header even with a loopback remote address', () => {
  for (const name of ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-port', 'forwarded']) {
    assert.equal(
      loopbackRefusalReason(req({ headers: { [name]: 'anything' } }), baseConfig),
      'FORWARDED_HEADER_PRESENT',
      `expected ${name} to trip the forwarded-header check`
    );
  }
});

test('loopbackRefusalReason refuses a non-loopback configured host', () => {
  assert.equal(loopbackRefusalReason(req(), { ...baseConfig, host: '0.0.0.0' }), 'SERVER_NOT_LOOPBACK_BOUND');
});

test('setupGuardFailure gives a HOST-specific coarse reason for a non-loopback configured host, distinct from a non-loopback caller', () => {
  // HOST=0.0.0.0 (the Dockerfile's own default) is the operator's own
  // setting, not evidence the caller is on another machine, so it must not
  // collapse into the same reason as REMOTE_ADDRESS_NOT_LOOPBACK.
  const failure = setupGuardFailure(req(), { ...baseConfig, host: '0.0.0.0' });
  assert.equal(failure.reason, 'HOST_NOT_LOOPBACK');
  assert.equal(failure.internalReason, 'SERVER_NOT_LOOPBACK_BOUND');
  assert.notEqual(failure.reason, 'NOT_LOOPBACK');
});

test('loopbackRefusalReason refuses an https public base url', () => {
  assert.equal(
    loopbackRefusalReason(req(), { ...baseConfig, publicBaseUrl: 'https://example.test' }),
    'PUBLIC_BASE_URL_HTTPS'
  );
});

test('loopbackRefusalReason refuses a non-loopback local socket address', () => {
  assert.equal(loopbackRefusalReason(req({ localAddress: '10.0.0.9' }), baseConfig), 'LOCAL_SOCKET_NOT_LOOPBACK');
});

test('loopbackRefusalReason fails closed on an undefined remote address', () => {
  const requestWithNoRemoteAddress = { headers: {}, socket: { localAddress: '127.0.0.1' } };
  assert.equal(loopbackRefusalReason(requestWithNoRemoteAddress, baseConfig), 'REMOTE_ADDRESS_NOT_LOOPBACK');
});

test('originRefusalReason accepts matching Origin hosts', () => {
  assert.equal(originRefusalReason(req({ headers: { origin: 'http://127.0.0.1:8787' } }), baseConfig), null);
  assert.equal(originRefusalReason(req({ headers: { origin: 'http://localhost:8787' } }), baseConfig), null);
  assert.equal(originRefusalReason(req({ headers: { origin: 'http://[::1]:8787' } }), baseConfig), null);
});

test('originRefusalReason rejects a foreign origin and a mismatched port', () => {
  assert.equal(originRefusalReason(req({ headers: { origin: 'https://evil.example' } }), baseConfig), 'ORIGIN_MISMATCH');
  assert.equal(originRefusalReason(req({ headers: { origin: 'http://127.0.0.1:9999' } }), baseConfig), 'ORIGIN_MISMATCH');
});

test('originRefusalReason rejects a malformed Origin header', () => {
  assert.equal(originRefusalReason(req({ headers: { origin: 'not a url' } }), baseConfig), 'ORIGIN_MALFORMED');
});

test('originRefusalReason falls back to Host when Origin is absent', () => {
  assert.equal(originRefusalReason(req({ headers: { host: '127.0.0.1:8787' } }), baseConfig), null);
});

test('originRefusalReason rejects a rebound Host when Origin is absent (DNS rebinding)', () => {
  assert.equal(originRefusalReason(req({ headers: { host: 'evil.example:8787' } }), baseConfig), 'HOST_MISMATCH');
});

test('setupGuardFailure exposes only a coarse reason publicly, with the fine-grained reason on internalReason', () => {
  const failure = setupGuardFailure(req({ remoteAddress: '10.0.0.5' }), baseConfig);
  assert.equal(failure.status, 403);
  assert.equal(failure.code, 'SETUP_UNAVAILABLE');
  assert.equal(failure.reason, 'REMOTE_CLIENT');
  assert.equal(failure.internalReason, 'REMOTE_ADDRESS_NOT_LOOPBACK');
  assert.ok(['NOT_LOOPBACK', 'HOST_NOT_LOOPBACK', 'REMOTE_CLIENT', 'FORWARDED_HEADER', 'HTTPS_PUBLIC_URL', 'ORIGIN_REJECTED'].includes(failure.reason));
});

test('setupGuardFailure returns null when every check passes', () => {
  assert.equal(setupGuardFailure(req({ headers: { host: '127.0.0.1:8787' } }), baseConfig), null);
});

test('setupGuardFailure checks the Origin/Host gate only after the loopback gate passes', () => {
  const failure = setupGuardFailure(req({ remoteAddress: '10.0.0.5', headers: { origin: 'https://evil.example' } }), baseConfig);
  assert.equal(failure.internalReason, 'REMOTE_ADDRESS_NOT_LOOPBACK');
});
