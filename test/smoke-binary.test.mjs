import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const scriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'smoke-binary.mjs');

test('reports a clean spawn failure instead of crashing on an unhandled error event', async () => {
  // Never exists: a fresh random name under the OS temp dir.
  const bogusBinaryPath = path.join(os.tmpdir(), `reference-align-smoke-binary-missing-${randomUUID()}`);

  const start = Date.now();
  await assert.rejects(
    execFileAsync(process.execPath, [scriptPath, bogusBinaryPath], { timeout: 10_000 }),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /Failed to spawn binary/);
      // Before the fix, a missing binary path emitted an unhandled 'error'
      // event on the child process and crashed the script with a raw
      // Node stack trace instead of the message above.
      assert.doesNotMatch(error.stderr, /Unhandled 'error' event/);
      return true;
    }
  );
  const elapsedMs = Date.now() - start;
  // The script's own bound-port poll loop allows up to 15s before giving
  // up. A spawn failure should be reported almost immediately instead of
  // waiting out (or hanging past) that deadline.
  assert.ok(elapsedMs < 5_000, `expected a fast failure, took ${elapsedMs}ms`);
});
