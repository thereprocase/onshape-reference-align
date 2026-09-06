import test from 'node:test';
import assert from 'node:assert/strict';

import { createUpdateChecker } from '../src/update-check.mjs';

test('disabled when no URL is configured, with no fetch attempted', async () => {
  let calls = 0;
  const checker = createUpdateChecker({ url: '', fetchImpl: async () => { calls += 1; } });
  assert.deepEqual(await checker.check(), { disabled: true });
  assert.equal(calls, 0);
});

test('reports current and latest from the documented { version, url } contract', async () => {
  const checker = createUpdateChecker({
    url: 'https://example.invalid/latest.json',
    currentVersion: '0.2.0',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ version: '0.3.0', url: 'https://example.invalid/releases/v0.3.0' })
    })
  });
  assert.deepEqual(await checker.check(), {
    current: '0.2.0',
    latest: '0.3.0',
    url: 'https://example.invalid/releases/v0.3.0'
  });
});

test('falls back to the configured URL when the response omits its own url field', async () => {
  const checker = createUpdateChecker({
    url: 'https://example.invalid/latest.json',
    currentVersion: '0.2.0',
    fetchImpl: async () => ({ ok: true, json: async () => ({ version: '0.3.0' }) })
  });
  const result = await checker.check();
  assert.equal(result.url, 'https://example.invalid/latest.json');
});

test('a non-200 response disables the banner rather than throwing', async () => {
  const checker = createUpdateChecker({
    url: 'https://example.invalid/latest.json',
    fetchImpl: async () => ({ ok: false, json: async () => ({ version: '0.3.0' }) })
  });
  assert.deepEqual(await checker.check(), { disabled: true });
});

test('a malformed body (no version string) disables the banner rather than throwing', async () => {
  const checker = createUpdateChecker({
    url: 'https://example.invalid/latest.json',
    fetchImpl: async () => ({ ok: true, json: async () => ({ notVersion: '0.3.0' }) })
  });
  assert.deepEqual(await checker.check(), { disabled: true });
});

test('a network failure or timeout disables the banner rather than throwing', async () => {
  const checker = createUpdateChecker({
    url: 'https://example.invalid/latest.json',
    fetchImpl: async () => { throw new Error('getaddrinfo ENOTFOUND'); }
  });
  assert.deepEqual(await checker.check(), { disabled: true });
});

test('the fetch is only ever made once per process, even across repeated checks', async () => {
  let calls = 0;
  const checker = createUpdateChecker({
    url: 'https://example.invalid/latest.json',
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, json: async () => ({ version: '0.3.0' }) };
    }
  });
  await checker.check();
  await checker.check();
  await checker.check();
  assert.equal(calls, 1);
});

for (const url of [
  'javascript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'file:///etc/passwd',
  '//evil.example/latest',
  '/relative/path'
]) {
  test(`a feed url with an unsafe or non-absolute scheme (${JSON.stringify(url)}) falls back to the configured URL`, async () => {
    const checker = createUpdateChecker({
      url: 'https://example.invalid/latest.json',
      fetchImpl: async () => ({ ok: true, json: async () => ({ version: '0.3.0', url }) })
    });
    const result = await checker.check();
    assert.equal(result.url, 'https://example.invalid/latest.json');
  });
}

test('a feed url that is a plain http URL is passed through, not just https', async () => {
  const checker = createUpdateChecker({
    url: 'https://example.invalid/latest.json',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ version: '0.3.0', url: 'http://example.invalid/releases/v0.3.0' })
    })
  });
  const result = await checker.check();
  assert.equal(result.url, 'http://example.invalid/releases/v0.3.0');
});

test('a 3s AbortSignal.timeout is attached to the request', async () => {
  let receivedSignal;
  const checker = createUpdateChecker({
    url: 'https://example.invalid/latest.json',
    fetchImpl: async (url, options) => {
      receivedSignal = options?.signal;
      return { ok: true, json: async () => ({ version: '0.3.0' }) };
    }
  });
  await checker.check();
  assert.ok(receivedSignal instanceof AbortSignal);
});
