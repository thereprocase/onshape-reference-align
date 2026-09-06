import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { allowsLocalPortFallback, listenWithLocalFallback } from '../src/listen.mjs';

const local = { host: '127.0.0.1', port: 8787, publicBaseUrl: 'http://127.0.0.1:8787', authMode: 'api-key-signature', nodeEnv: 'development' };
test('automatic fallback is restricted to direct local desktop URLs', () => {
  assert.equal(allowsLocalPortFallback(local), true);
  for (const override of [
    { host: '0.0.0.0' }, { authMode: 'oauth' }, { nodeEnv: 'production' },
    { publicBaseUrl: 'https://127.0.0.1:8787' }, { publicBaseUrl: 'http://example.com:8787' },
    { publicBaseUrl: 'http://127.0.0.1:9999' }, { publicBaseUrl: 'http://127.0.0.1:8787/app' }
  ]) assert.equal(allowsLocalPortFallback({ ...local, ...override }), false, JSON.stringify(override));
});
test('occupied local port recovers without disturbing the existing listener', async (t) => {
  const occupied = net.createServer();
  await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve));
  t.after(() => occupied.close());
  const port = occupied.address().port;
  const server = net.createServer();
  t.after(() => server.close());
  let notices = 0;
  const address = await listenWithLocalFallback(server, { ...local, port, publicBaseUrl: `http://127.0.0.1:${port}` }, { onFallback: () => notices++ });
  assert.notEqual(address.port, port);
  assert.equal(notices, 1);
  assert.equal(occupied.listening, true);
});
test('occupied fixed hosted port is refused without moving', async (t) => {
  const occupied = net.createServer();
  await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve));
  t.after(() => occupied.close());
  const server = net.createServer();
  await assert.rejects(listenWithLocalFallback(server, { ...local, port: occupied.address().port, authMode: 'oauth' }), { code: 'EADDRINUSE' });
  assert.equal(server.listening, false);
});
