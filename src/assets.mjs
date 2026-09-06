import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { isSea } from 'node:sea';
import { createRequire } from 'node:module';

// isSea() has existed since Node 20.12/21.7 and is safe to import statically.
// getAssetKeys()/getRawAsset() are newer (Node >=22.20.0 or >=24.8.0) and are
// only ever called from the isPackaged branch below, which by construction
// only runs inside an actual SEA binary built with a pinned, known-recent
// Node (see docs/DISTRIBUTION.md). Reaching them through a lazy require
// instead of a static named import keeps `node server.mjs` from source
// working on any Node in the >=22 engines range, including one older than
// what a packaged build requires.
const requireBuiltin = createRequire(import.meta.url);
const nodeSea = {
  isSea,
  getAssetKeys: (...args) => requireBuiltin('node:sea').getAssetKeys(...args),
  getRawAsset: (...args) => requireBuiltin('node:sea').getRawAsset(...args)
};

/**
 * Whether this process is running as an injected Single Executable
 * Application. Exported standalone (not only as part of createAssetSource)
 * because server.mjs needs the answer before it knows a projectRoot: a
 * packaged binary has no real checkout directory, and deciding what to pass
 * as "the project root" is exactly the question this answers first.
 */
export function isSeaPackaged(sea = nodeSea) {
  return Boolean(sea && typeof sea.isSea === 'function' && sea.isSea());
}

/**
 * Asset-loading seam.
 *
 * In dev mode (from a checkout, `node server.mjs`) this reads files off disk
 * under projectRoot exactly as server.mjs always has. Inside a Single
 * Executable Application build, module loading cannot see the filesystem the
 * binary was built from — assets have to be embedded at build time and read
 * back with node:sea's getRawAsset() instead. Both branches are implemented
 * here so server.mjs's static-file routes never need to know which one is
 * running.
 *
 * `sea` is injectable so tests can exercise the packaged branch with a stub,
 * without an actual SEA build.
 */
export function createAssetSource({ projectRoot, sea = nodeSea } = {}) {
  if (!projectRoot) throw new Error('createAssetSource needs a projectRoot.');
  const isPackaged = isSeaPackaged(sea);

  // Buffers of embedded assets are cached so a request never re-copies the
  // underlying blob: node:sea's getRawAsset() returns a fresh ArrayBuffer
  // view on every call, and Buffer.from() over it is real bytes copied once.
  const bufferCache = new Map();

  function diskPath(assetKey) {
    return path.join(projectRoot, assetKey);
  }

  function assetKeys() {
    return isPackaged ? sea.getAssetKeys() : [];
  }

  async function assetExists(assetKey) {
    if (isPackaged) return assetKeys().includes(assetKey);
    try {
      const stat = await fsp.stat(diskPath(assetKey));
      return stat.isFile();
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }

  function readAssetBuffer(assetKey) {
    if (!isPackaged) throw new Error(`readAssetBuffer is packaged-mode only, got: ${assetKey}`);
    let buffer = bufferCache.get(assetKey);
    if (!buffer) {
      buffer = Buffer.from(sea.getRawAsset(assetKey));
      bufferCache.set(assetKey, buffer);
    }
    return buffer;
  }

  /**
   * Read one asset's bytes for a caller that needs the content itself, not an
   * HTTP response — e.g. the install route embedding ReferenceImage.fs's
   * source in a request body. Unlike readAssetBuffer, this works in both
   * modes: packaged reads the embedded asset, dev mode reads the real file
   * under projectRoot, exactly as fsp.readFile(diskPath(assetKey)) always
   * did before this seam existed.
   */
  async function readAsset(assetKey) {
    if (isPackaged) {
      if (!assetKeys().includes(assetKey)) {
        throw Object.assign(new Error(`Unknown packaged asset: ${assetKey}`), { code: 'ASSET_NOT_FOUND' });
      }
      return readAssetBuffer(assetKey);
    }
    return fsp.readFile(diskPath(assetKey));
  }

  /**
   * Resolve a URL pathname to an assetKey rooted under `baseKey` (e.g.
   * 'public'), refusing anything that would escape it.
   *
   * Dev mode resolves against the real directory and checks the result still
   * starts with it — the same path-traversal guard server.mjs always had.
   * Packaged mode has no directory to escape from; a request is bounded
   * instead by the closed list of asset keys burned into the binary at build
   * time, so an attacker-controlled pathname can never resolve to a key that
   * was not deliberately embedded.
   */
  function resolveAssetKey(baseKey, relativePathname) {
    const relative = String(relativePathname || '').replace(/^\/+/, '');
    const key = relative ? `${baseKey}/${relative}` : baseKey;
    if (isPackaged) {
      return assetKeys().includes(key) ? key : null;
    }
    const base = path.resolve(projectRoot, baseKey);
    const resolved = path.resolve(projectRoot, key);
    if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) return null;
    return path.relative(projectRoot, resolved).split(path.sep).join('/');
  }

  /**
   * Send one asset as an HTTP response.
   *
   * Returns false and writes nothing when the key does not exist, so callers
   * fall through to their own 404 exactly as the old serveFile's ENOENT
   * branch did.
   */
  async function send(res, assetKey, { contentType, cacheControl }) {
    if (isPackaged) {
      if (!assetKeys().includes(assetKey)) return false;
      const buffer = readAssetBuffer(assetKey);
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': buffer.length,
        'Cache-Control': cacheControl
      });
      res.end(buffer);
      return true;
    }
    try {
      const stat = await fsp.stat(diskPath(assetKey));
      if (!stat.isFile()) return false;
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': stat.size,
        'Cache-Control': cacheControl
      });
      fs.createReadStream(diskPath(assetKey)).pipe(res);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }

  return {
    isPackaged,
    assetExists,
    assetKeys,
    resolveAssetKey,
    readAssetBuffer,
    readAsset,
    send
  };
}
