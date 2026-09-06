#!/usr/bin/env node
// Smoke-tests a built SEA binary: launches it against a temp config
// directory and an occupied local port, waits for the fallback bound-port line,
// hits a few routes, and exits non-zero on any failure. Run by the release
// workflow right after injection, and usable locally against a
// --allow-postject build.
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { childEnv } from '../test/helpers/server.mjs';
import { createOnshapeStub, DEFAULT_KEYS, STUB_DOCUMENT } from '../test/helpers/onshape-stub.mjs';

async function main() {
  const binaryPath = process.argv[2];
  // Optional source entry lets the same acceptance check exercise a packaged
  // runtime+app layout. On another OS this verifies the app layout, not that
  // platform's native executable.
  const sourceEntry = process.argv[3] ? path.resolve(process.argv[3]) : null;
  if (!binaryPath) {
    console.error('Usage: node scripts/smoke-binary.mjs <path-to-binary>');
    process.exit(1);
  }

  const configDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'reference-align-binary-smoke-'));
  const occupied = http.createServer((_req, res) => res.end('existing listener untouched'));
  await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve));
  const occupiedPort = occupied.address().port;
  const stub = createOnshapeStub();
  await new Promise(resolve => stub.server.listen(0, '127.0.0.1', resolve));
  const stubUrl = `http://127.0.0.1:${stub.server.address().port}`;
  const configPath = path.join(configDir, '.env');
  await fsp.writeFile(configPath, [
    'HOST=127.0.0.1',
    `PORT=${occupiedPort}`,
    'ONSHAPE_AUTH=none',
    `ONSHAPE_BASE_URL=${stubUrl}`,
    'UPDATE_CHECK_URL=',
    `BACKUP_DIR=${path.join(configDir, 'backups')}`,
    'NODE_ENV=development',
    ''
  ].join('\n'));

  const env = childEnv();
  delete env.UPDATE_CHECK_URL;
  const child = spawn(path.resolve(binaryPath), [...(sourceEntry ? [sourceEntry] : []), '--config', configPath, '--no-open'], {
    cwd: configDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  // A bad binary path (or any other launch failure) surfaces as an 'error'
  // event on the child, asynchronously, after spawn() has already returned.
  // With no listener, Node treats that as an unhandled 'error' event and
  // crashes the whole script instead of letting the try/catch below report
  // a clean failure. Record it and let the poll loop turn it into a normal
  // thrown Error.
  let spawnError;
  child.on('error', (err) => { spawnError = err; });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  try {
    const deadline = Date.now() + 15_000;
    let port;
    while (Date.now() < deadline) {
      if (spawnError) throw new Error(`Failed to spawn binary: ${spawnError.message}`);
      const match = stdout.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) { port = Number(match[1]); break; }
      if (child.exitCode !== null) throw new Error(`Binary exited early (code ${child.exitCode}):\n${stderr}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (spawnError) throw new Error(`Failed to spawn binary: ${spawnError.message}`);
    if (!port) throw new Error(`Timed out waiting for a bound-port line.\nstdout:\n${stdout}\nstderr:\n${stderr}`);
    if (port === occupiedPort) throw new Error('Binary did not recover to a different local port.');

    const health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
    if (health.ok !== true) throw new Error(`GET /api/health did not report ok:true: ${JSON.stringify(health)}`);

    const uiResponse = await fetch(`http://127.0.0.1:${port}/`);
    if (!uiResponse.ok) throw new Error(`GET / returned ${uiResponse.status}`);
    const html = await uiResponse.text();
    if (!html.includes('Reference Align')) throw new Error('served index.html did not look right');

    const seaConfig = JSON.parse(await fsp.readFile(new URL('../sea-config.json', import.meta.url), 'utf8'));
    for (const key of Object.keys(seaConfig.assets).filter((name) => /^public\/.+\.m?js$/.test(name))) {
      const response = await fetch(`http://127.0.0.1:${port}/${key.slice('public/'.length)}`);
      if (!response.ok || !(response.headers.get('content-type') || '').includes('javascript')) {
        throw new Error(`Embedded browser module ${key} was not served as JavaScript (${response.status}).`);
      }
      await response.arrayBuffer();
    }

    const fsResponse = await fetch(`http://127.0.0.1:${port}/assets/ReferenceImage.fs`);
    if (!fsResponse.ok) throw new Error(`GET /assets/ReferenceImage.fs returned ${fsResponse.status}`);

    const updateResponse = await (await fetch(`http://127.0.0.1:${port}/api/update`)).json();
    if (updateResponse.disabled !== true) throw new Error(`GET /api/update expected disabled:true, got ${JSON.stringify(updateResponse)}`);

    // Recovery must commit the bound port before bootstrap and setup check
    // Host/Origin. The unrelated listener must remain reachable throughout.
    const bootstrapHttp = await fetch(`http://127.0.0.1:${port}/api/bootstrap`);
    const cookie = bootstrapHttp.headers.get('set-cookie').split(';', 1)[0];
    const bootstrapResponse = await bootstrapHttp.json();
    if (bootstrapResponse.setup?.available !== true) {
      throw new Error(`GET /api/bootstrap reported the setup wizard unavailable after local port recovery: ${JSON.stringify(bootstrapResponse.setup)}`);
    }

    // Exercise the packaged write path, not just static asset delivery. The
    // FeatureScript must come from the binary when its install handler runs.
    const base = `http://127.0.0.1:${port}`;
    async function post(route, body) {
      const multipart = body instanceof FormData;
      const response = await fetch(base + route, {
        method: 'POST',
        headers: { Origin: base, Cookie: cookie, 'X-CSRF-Token': bootstrapResponse.csrfToken, ...(!multipart ? { 'Content-Type': 'application/json' } : {}) },
        body: multipart ? body : JSON.stringify(body), signal: AbortSignal.timeout(10000)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(`Packaged ${route} failed: ${JSON.stringify(data)}`);
      return data;
    }
    await post('/api/setup/save', { ...DEFAULT_KEYS, baseUrl: stubUrl });
    const context = { documentId: STUB_DOCUMENT.documentId, workspaceOrVersion: 'w', workspaceOrVersionId: STUB_DOCUMENT.workspaceId, elementId: STUB_DOCUMENT.partStudioId };
    const icon = await fetch(base + '/reference-align-icon.png');
    const form = new FormData();
    form.append('file', new Blob([await icon.arrayBuffer()], { type: 'image/png' }), 'binary-smoke.png');
    form.append('confirm', 'true');
    const upload = await post('/api/upload-image?' + new URLSearchParams(context), form);
    const install = await post('/api/install', { context, imageElementId: upload.elementId, planeId: 'default:Front', confirm: true });
    if (install.featureStatus !== 'OK') throw new Error('Packaged installation did not regenerate.');
    const replane = await post('/api/replane', { context, itemId: install.itemId, planeId: 'default:Right', confirm: true });
    if (replane.featureStatus !== 'OK' || !replane.backupFile) throw new Error('Packaged replane did not regenerate with a backup.');
    if (await (await fetch(`http://127.0.0.1:${occupiedPort}`)).text() !== 'existing listener untouched') {
      throw new Error('Port recovery disturbed the existing listener.');
    }

    console.log(`Binary smoke test passed: ${binaryPath}`);
  } finally {
    child.kill('SIGTERM');
    // A process that never actually launched (e.g. the spawnError path
    // above) has no pid and will never emit 'exit', so waiting on it here
    // would hang forever instead of letting the script report its error.
    if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
      const timer = setTimeout(() => child.kill('SIGKILL'), 3_000);
      await new Promise((resolve) => child.once('exit', resolve));
      clearTimeout(timer);
    }
    await fsp.rm(configDir, { recursive: true, force: true });
    await new Promise(resolve => stub.server.close(resolve));
    await new Promise(resolve => occupied.close(resolve));
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
