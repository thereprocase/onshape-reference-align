// Shared plumbing for tests that spawn the real server.mjs as a child
// process. Before this module existed, childEnv()/waitForBoundPort()/
// stopChild() were copied verbatim between test/server-port-zero.test.mjs and
// test/oversized-body-connection.test.mjs, and a third variant lived in
// scripts/smoke.mjs — three places that could each drift on their own. This
// is the one place left.

import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Environment variables a spawned test server must never inherit: real
// Onshape credentials (anything ONSHAPE_*), or a real HOST/PORT/
// PUBLIC_BASE_URL/SESSION_SECRET/NODE_ENV/BACKUP_DIR that would defeat the
// throwaway --config file every caller here points the child at instead.
const BLOCKED_ENV_KEYS = Object.freeze([
  'HOST',
  'PORT',
  'PUBLIC_BASE_URL',
  'SESSION_SECRET',
  'NODE_ENV',
  'BACKUP_DIR'
]);

export function childEnv(base = process.env) {
  const sanitized = { ...base };
  for (const key of Object.keys(sanitized)) {
    if (key.startsWith('ONSHAPE_')) delete sanitized[key];
  }
  for (const key of BLOCKED_ENV_KEYS) delete sanitized[key];
  return sanitized;
}

// The guard spawnServer() runs on its final, merged environment. Exported
// separately so a helper self-test can prove it fires without needing to
// spawn a real process to do it.
export function assertNoOnshapeEnv(env) {
  const leaked = Object.keys(env).filter((key) => key.startsWith('ONSHAPE_'));
  if (leaked.length > 0) {
    throw new Error(
      `refusing to spawn a test server with a real-looking env var set (${leaked.join(', ')}); ` +
      'this test would otherwise risk signing requests with real Onshape credentials'
    );
  }
}

export function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : undefined;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

// Writes a throwaway --config file under a fresh temp directory. envLines is
// joined with '\n' and given a trailing newline, matching what the config
// loader expects from a real .env file.
export async function makeConfigDir(prefix, envLines) {
  const configDir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  const configPath = path.join(configDir, '.env');
  await fsp.writeFile(configPath, [...envLines, ''].join('\n'));
  return { configDir, configPath };
}

export async function waitForBoundPort(child, getStdout, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited early (code ${child.exitCode}):\n${getStdout()}`);
    }
    const match = getStdout().match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
    if (match) return Number(match[1]);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for a bound-port line.\nstdout:\n${getStdout()}`);
}

export async function waitForHealth(baseUrl, child, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited early with code ${child.exitCode}.`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return response;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`Timed out waiting for server health: ${lastError?.message || 'unknown error'}`);
}

export async function stopChild(child) {
  if (child.pid === undefined) return;
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 3_000);
  await new Promise((resolve) => child.once('exit', resolve));
  clearTimeout(timer);
}

// Spawns server.mjs against configPath. Always runs the final environment
// through childEnv() and assertNoOnshapeEnv(), even when extraEnv is
// supplied, so a future caller cannot reintroduce a real credential by
// merging one in.
export function spawnServer({ configPath, args = [], cwd = root, extraEnv = {} } = {}) {
  const env = { ...childEnv(), ...extraEnv };
  assertNoOnshapeEnv(env);

  let stdout = '';
  let stderr = '';
  const child = spawn(process.execPath, ['server.mjs', '--config', configPath, ...args], {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  return {
    child,
    getStdout: () => stdout,
    getStderr: () => stderr,
    waitForBoundPort: (timeoutMs) => waitForBoundPort(child, () => stdout, timeoutMs),
    waitForHealth: (baseUrl, timeoutMs) => waitForHealth(baseUrl, child, timeoutMs),
    stop: () => stopChild(child)
  };
}
