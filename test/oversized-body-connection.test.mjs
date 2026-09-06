import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { makeConfigDir, spawnServer } from './helpers/server.mjs';

function splitHeadHeaders(head) {
  const [statusLine, ...headerLines] = head.split('\r\n');
  const headers = {};
  for (const line of headerLines) {
    const index = line.indexOf(':');
    if (index < 0) continue;
    headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
  }
  return { statusLine, headers };
}

// Waits for the blank line ending the response head, without needing the
// full (possibly chunked, possibly never-arriving-more) body.
function readResponseHead(socket, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    let buffered = '';
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for a response head.\nSo far:\n${buffered}`)), timeoutMs);
    function onData(chunk) {
      buffered += chunk.toString('utf8');
      const boundary = buffered.indexOf('\r\n\r\n');
      if (boundary >= 0) {
        cleanup();
        resolve(splitHeadHeaders(buffered.slice(0, boundary)));
      }
    }
    function cleanup() {
      clearTimeout(timer);
      socket.off('data', onData);
    }
    socket.on('data', onData);
  });
}

function waitForClose(socket, timeoutMs = 2_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for the server to close the connection.')), timeoutMs);
    socket.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

test('early routing refusals close unfinished request bodies and malformed cookies leave the server usable', async () => {
  const { configDir, configPath } = await makeConfigDir('reference-align-early-refusal-', [
    'HOST=127.0.0.1', 'PORT=0', 'ONSHAPE_AUTH=none', 'NODE_ENV=test'
  ]);
  const server = spawnServer({ configPath, args: ['--no-open'] });
  try {
    const port = await server.waitForBoundPort();
    const bootstrapResponse = await fetch(`http://127.0.0.1:${port}/api/bootstrap`);
    const cookie = bootstrapResponse.headers.get('set-cookie').split(';', 1)[0];
    const { csrfToken } = await bootstrapResponse.json();
    for (const [pathname, status, guarded] of [['/api/preview', 403], ['/api/missing', 404], ['/auth/missing', 404], ['/', 405], ['/api/setup/test', 403, true], ['/api/settings', 403, true]]) {
      const socket = net.connect(port, '127.0.0.1');
      try {
        await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
        const head = readResponseHead(socket);
        const closed = waitForClose(socket);
        const guardHeaders = guarded ? `Cookie: ${cookie}\r\nX-CSRF-Token: ${csrfToken}\r\nOrigin: https://unrelated.invalid\r\n` : '';
        socket.write(`POST ${pathname} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n${guardHeaders}Content-Length: 10000\r\nConnection: keep-alive\r\n\r\n`);
        const response = await head;
        assert.ok(response.statusLine.includes(` ${status} `), response.statusLine);
        assert.equal(response.headers.connection, 'close');
        await closed;
      } finally {
        socket.destroy();
      }
    }
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, { headers: { Cookie: 'osra_sid=%' } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/health`)).status, 200);
  } finally {
    await server.stop();
    await fsp.rm(configDir, { recursive: true, force: true });
  }
});

// This is the exact scenario War Council reproduced: a POST whose declared
// Content-Length is far larger than what is ever sent trips the byte cap in
// readJson() (src/http.mjs) partway through, well before the declared body
// has arrived. Answering that 413 with the default keep-alive left the
// socket open and waiting on bytes the client had no intention of finishing,
// so nothing else on that connection -- including a well-formed pipelined
// request -- ever got a response.
test('a 413 from an oversize declared body closes the connection instead of leaving it open on keep-alive', async () => {
  const { configDir, configPath } = await makeConfigDir('reference-align-oversize-body-', []);
  await fsp.writeFile(configPath, [
    'HOST=127.0.0.1',
    'PORT=0',
    'ONSHAPE_AUTH=none',
    'SESSION_SECRET=oversize-body-test-only',
    `BACKUP_DIR=${path.join(configDir, 'backups')}`,
    'NODE_ENV=test',
    ''
  ].join('\n'));

  const server = spawnServer({ configPath, args: ['--no-open'] });
  let socket;
  try {
    const port = await server.waitForBoundPort();
    const baseUrl = `http://127.0.0.1:${port}`;

    // A same-origin-looking GET to mint a session and read its CSRF token,
    // exactly like the browser's own first call to /api/bootstrap.
    const bootstrap = await fetch(`${baseUrl}/api/bootstrap`);
    const setCookie = bootstrap.headers.get('set-cookie');
    assert.ok(setCookie, 'expected /api/bootstrap to mint a session cookie');
    const cookie = setCookie.split(';', 1)[0];
    const { csrfToken } = await bootstrap.json();
    assert.ok(csrfToken, 'expected /api/bootstrap to hand back a CSRF token');

    socket = net.connect(port, '127.0.0.1');
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });

    // Declare a body far larger than src/http.mjs's MAX_JSON_BYTES (1 MB),
    // but only ever send enough to cross that cap -- never the rest. A real
    // client here need not be malicious: a genuinely oversize upload aimed at
    // the wrong endpoint behaves identically.
    const declaredLength = 5_000_000;
    const sentBody = 'x'.repeat(1_200_000);
    const head = [
      `POST /api/preview HTTP/1.1`,
      `Host: 127.0.0.1:${port}`,
      `Cookie: ${cookie}`,
      `X-CSRF-Token: ${csrfToken}`,
      `Content-Type: application/json`,
      `Content-Length: ${declaredLength}`,
      `Connection: keep-alive`,
      '',
      ''
    ].join('\r\n');
    socket.write(head + sentBody);

    const response = await readResponseHead(socket);
    assert.match(response.statusLine, /^HTTP\/1\.1 413\b/, `expected a 413, got: ${response.statusLine}`);
    assert.equal(response.headers.connection, 'close', 'a request body that was never fully received must not be answered with keep-alive');

    // The real proof: the server must actively tear this connection down
    // itself, promptly, rather than the ~3.8 MB of declared-but-unsent body
    // ever mattering.
    await waitForClose(socket);
  } finally {
    if (socket && !socket.destroyed) socket.destroy();
    await server.stop();
    await fsp.rm(configDir, { recursive: true, force: true });
  }
});
