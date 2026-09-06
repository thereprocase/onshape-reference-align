import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { shouldOpenBrowser, openBrowser } from '../src/open-browser.mjs';

test('shouldOpenBrowser: --no-open always refuses, even with --open also present', () => {
  assert.equal(shouldOpenBrowser({ argv: ['--no-open'], isTTY: true }), false);
  assert.equal(shouldOpenBrowser({ argv: ['--open', '--no-open'], isTTY: true }), false);
});

test('shouldOpenBrowser: --open opens even without a TTY', () => {
  assert.equal(shouldOpenBrowser({ argv: ['--open'], isTTY: false }), true);
});

test('shouldOpenBrowser: a real terminal opens by default with no flags', () => {
  assert.equal(shouldOpenBrowser({ argv: [], isTTY: true }), true);
});

test('shouldOpenBrowser: a redirected/background launch stays quiet by default', () => {
  assert.equal(shouldOpenBrowser({ argv: [], isTTY: false }), false);
  assert.equal(shouldOpenBrowser({ argv: [], isTTY: undefined }), false);
});

test('shouldOpenBrowser: a node --watch restart stays quiet even from a real terminal', () => {
  assert.equal(shouldOpenBrowser({ argv: [], isTTY: true, isWatchMode: true }), false);
});

test('shouldOpenBrowser: --open still forces it during a node --watch restart', () => {
  assert.equal(shouldOpenBrowser({ argv: ['--open'], isTTY: false, isWatchMode: true }), true);
});

test('shouldOpenBrowser: --no-open wins over a watch restart too', () => {
  assert.equal(shouldOpenBrowser({ argv: ['--no-open'], isTTY: true, isWatchMode: true }), false);
});

test('shouldOpenBrowser: isWatchMode defaults from WATCH_REPORT_DEPENDENCIES, which node --watch sets on the restarted process', () => {
  const original = process.env.WATCH_REPORT_DEPENDENCIES;
  try {
    process.env.WATCH_REPORT_DEPENDENCIES = '1';
    assert.equal(shouldOpenBrowser({ argv: [], isTTY: true }), false);
    delete process.env.WATCH_REPORT_DEPENDENCIES;
    assert.equal(shouldOpenBrowser({ argv: [], isTTY: true }), true);
  } finally {
    if (original === undefined) delete process.env.WATCH_REPORT_DEPENDENCIES;
    else process.env.WATCH_REPORT_DEPENDENCIES = original;
  }
});

function fakeSpawn(calls) {
  return (...args) => {
    calls.push(args);
    const child = new EventEmitter();
    child.unref = () => {};
    return child;
  };
}

test('openBrowser: uses cmd /c start with an empty title on win32', () => {
  const calls = [];
  const ok = openBrowser('http://127.0.0.1:8787', { platform: 'win32', spawnImpl: fakeSpawn(calls) });
  assert.equal(ok, true);
  assert.deepEqual(calls[0], ['cmd', ['/c', 'start', '""', 'http://127.0.0.1:8787'], { detached: true, stdio: 'ignore', windowsHide: true }]);
});

test('openBrowser: uses open on darwin', () => {
  const calls = [];
  openBrowser('http://127.0.0.1:8787', { platform: 'darwin', spawnImpl: fakeSpawn(calls) });
  assert.deepEqual(calls[0], ['open', ['http://127.0.0.1:8787'], { detached: true, stdio: 'ignore' }]);
});

test('openBrowser: uses xdg-open on linux', () => {
  const calls = [];
  openBrowser('http://127.0.0.1:8787', { platform: 'linux', spawnImpl: fakeSpawn(calls) });
  assert.deepEqual(calls[0], ['xdg-open', ['http://127.0.0.1:8787'], { detached: true, stdio: 'ignore' }]);
});

test('openBrowser: a missing opener binary emits an async error instead of throwing', () => {
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.unref = () => {};
    return child;
  };
  const ok = openBrowser('http://127.0.0.1:8787', { platform: 'linux', spawnImpl });
  assert.equal(ok, true, 'spawning itself succeeded synchronously');
  // The child's own 'error' listener swallows this; asserting it does not
  // throw or crash the process is the point of the test.
});

test('openBrowser: a spawn that throws synchronously is caught and reported as failure', () => {
  const spawnImpl = () => { throw new Error('boom'); };
  const ok = openBrowser('http://127.0.0.1:8787', { platform: 'linux', spawnImpl });
  assert.equal(ok, false);
});
