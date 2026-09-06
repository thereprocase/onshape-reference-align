import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createAssetSource } from '../src/assets.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function request(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const sent = await handler(req, res);
        if (!sent && !res.headersSent) {
          res.writeHead(404);
          res.end();
        }
      } catch (error) {
        reject(error);
        if (!res.headersSent) res.writeHead(500);
        res.end();
      }
    });
    server.listen(0, '127.0.0.1', async () => {
      const { port } = server.address();
      try {
        const response = await fetch(`http://127.0.0.1:${port}/`);
        const body = await response.arrayBuffer();
        resolve({ response, body: Buffer.from(body) });
      } catch (error) {
        reject(error);
      } finally {
        server.close();
      }
    });
  });
}

test('dev mode: isPackaged is false with no sea stub supplied', () => {
  const assets = createAssetSource({ projectRoot, sea: null });
  assert.equal(assets.isPackaged, false);
});

test('dev mode: assetExists reflects the real disk under projectRoot', async () => {
  const assets = createAssetSource({ projectRoot, sea: null });
  assert.equal(await assets.assetExists('public/index.html'), true);
  assert.equal(await assets.assetExists('public/does-not-exist.html'), false);
});

test('dev mode: resolveAssetKey blocks a path that would escape the base directory', () => {
  const assets = createAssetSource({ projectRoot, sea: null });
  assert.equal(assets.resolveAssetKey('public', '/index.html'), 'public/index.html');
  assert.equal(assets.resolveAssetKey('public', '/../server.mjs'), null);
  assert.equal(assets.resolveAssetKey('public', '/../../etc/passwd'), null);
  assert.equal(assets.resolveAssetKey('public', '/sub/dir/file.js'), 'public/sub/dir/file.js');
});

test('dev mode: send() streams a real file with the given content type and cache header', async () => {
  const assets = createAssetSource({ projectRoot, sea: null });
  const { response, body } = await request((req, res) => assets.send(res, 'public/index.html', {
    contentType: 'text/html; charset=utf-8',
    cacheControl: 'no-store'
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.ok(body.length > 0);
});

test('dev mode: send() returns false for a missing asset, writing nothing', async () => {
  const assets = createAssetSource({ projectRoot, sea: null });
  const { response } = await request((req, res) => assets.send(res, 'public/nope.html', {
    contentType: 'text/html',
    cacheControl: 'no-store'
  }));
  assert.equal(response.status, 404);
});

function stubSea({ keys, files }) {
  return {
    isSea: () => true,
    getAssetKeys: () => keys,
    getRawAsset: (key) => {
      if (!(key in files)) throw new Error(`no such packaged asset: ${key}`);
      return files[key];
    }
  };
}

test('packaged mode: isPackaged is true when the injected sea stub reports isSea()', () => {
  const sea = stubSea({ keys: ['public/index.html'], files: { 'public/index.html': Buffer.from('<html></html>') } });
  const assets = createAssetSource({ projectRoot, sea });
  assert.equal(assets.isPackaged, true);
});

test('packaged mode: assetExists and resolveAssetKey are bounded by the closed asset-key list, not the filesystem', () => {
  const sea = stubSea({ keys: ['public/index.html', 'featurescript/ReferenceImage.fs'], files: {} });
  const assets = createAssetSource({ projectRoot, sea });
  assert.equal(assets.resolveAssetKey('public', '/index.html'), 'public/index.html');
  // Even though ../../../windows/win.ini would resolve on disk in dev mode,
  // packaged mode has no disk step at all: an unlisted key is refused
  // outright rather than being path-resolved and then checked.
  assert.equal(assets.resolveAssetKey('public', '/../../../windows/win.ini'), null);
  assert.equal(assets.resolveAssetKey('public', '/missing.html'), null);
});

test('packaged mode: send() returns the embedded bytes, and caches the Buffer across calls', async () => {
  const bytes = new TextEncoder().encode('<html>packaged</html>').buffer;
  let readCount = 0;
  const sea = {
    isSea: () => true,
    getAssetKeys: () => ['public/index.html'],
    getRawAsset: (key) => {
      assert.equal(key, 'public/index.html');
      readCount += 1;
      return bytes;
    }
  };
  const assets = createAssetSource({ projectRoot, sea });
  const first = assets.readAssetBuffer('public/index.html');
  const second = assets.readAssetBuffer('public/index.html');
  assert.equal(readCount, 1, 'a cached asset must not be re-read from the raw source');
  assert.equal(first, second, 'the cached Buffer instance is reused');
  assert.equal(first.toString('utf8'), '<html>packaged</html>');

  const { response, body } = await request((req, res) => assets.send(res, 'public/index.html', {
    contentType: 'text/html; charset=utf-8',
    cacheControl: 'public, max-age=300'
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-length'), String(first.length));
  assert.equal(body.toString('utf8'), '<html>packaged</html>');
});

test('packaged mode: readAssetBuffer refuses to run in dev mode', () => {
  const assets = createAssetSource({ projectRoot, sea: null });
  assert.throws(() => assets.readAssetBuffer('public/index.html'), /packaged-mode only/);
});

test('packaged mode: send() returns false for a key not in the embedded list', async () => {
  const sea = stubSea({ keys: ['public/index.html'], files: { 'public/index.html': Buffer.from('x') } });
  const assets = createAssetSource({ projectRoot, sea });
  const { response } = await request((req, res) => assets.send(res, 'public/other.html', {
    contentType: 'text/html',
    cacheControl: 'no-store'
  }));
  assert.equal(response.status, 404);
});
