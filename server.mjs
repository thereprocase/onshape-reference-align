import http from 'node:http';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

import { createConfigStore } from './src/config.mjs';
import { createAssetSource, isSeaPackaged } from './src/assets.mjs';
import { shouldOpenBrowser, openBrowser } from './src/open-browser.mjs';
import { listenWithLocalFallback } from './src/listen.mjs';
import { createUpdateChecker } from './src/update-check.mjs';
import { VERSION } from './src/version.mjs';
import { createResponders } from './src/http.mjs';
import { CSRF_PATHS } from './src/routes.mjs';
import { CalibrationError } from './src/geometry.mjs';
import { lengthToMeters, angleToRadians } from './src/units.mjs';
import { getSession, requireCsrf } from './src/session.mjs';
import { OnshapeApi, OnshapeApiError, AuthRequiredError } from './src/onshape-api.mjs';
import { scanFeatureList } from './src/onshape-model.mjs';
import { getConnectionState, peekConnectionState, buildAuthSummary } from './src/connection-probe.mjs';
import { createSetupRoutes } from './src/setup-routes.mjs';
import { createSettingsRoutes } from './src/settings-routes.mjs';
import { createWriteRoutes } from './src/write-routes.mjs';
import { createAuthRoutes } from './src/auth-routes.mjs';
import { createSettingsStore } from './src/settings.mjs';
import { resolveSettingsFile, userConfigDir } from './src/config-paths.mjs';
import { setupGuardFailure } from './src/loopback-guard.mjs';
import { normalizeContext, publicContext } from './src/context.mjs';
import { featureGateReasons } from './src/capability-gate.mjs';

// A packaged SEA binary has no real checkout directory: import.meta.url
// inside an injected main script does not point at a real project on the end
// user's disk, so treating some arbitrary resolved path as "the project
// root" — and therefore as a place to look for a stray .env, or to default
// relative BACKUP_DIR paths against — would be actively wrong. Route
// packaged runs through the same per-user config directory that "no project
// .env found" already falls back to everywhere else.
const store = createConfigStore(isSeaPackaged() ? { projectRoot: userConfigDir() } : {});
// boot: the fields a bound listener and already-issued cookies have committed
// to. config(): everything else, re-read per use so a reload takes effect at
// once. Never destructure either one at module scope.
const boot = store.current();
const config = () => store.current();
const assets = createAssetSource({ projectRoot: boot.projectRoot });
// Read from the boot snapshot, not config(): the check runs at most once per
// process start (see src/update-check.mjs), so a later config reload has
// nothing to hand it anyway.
const updateChecker = createUpdateChecker({ url: boot.updateCheckUrl });
const { sendJson, sendText, redirect } = createResponders({ pretty: boot.nodeEnv === 'development' });
const onshape = new OnshapeApi(config);
// The policy file sits beside the resolved env file and is read once here.
// Nothing on the boot path creates it: an absent file means the defaults, and
// only POST /api/settings ever writes one. Created before the setup and
// settings routes below so both can be handed the real store rather than a
// stand-in, and their own gates never drift from what /api/bootstrap sends.
const settingsStore = createSettingsStore({ filePath: resolveSettingsFile(store.envFilePath) });
settingsStore.reload();
const { handleSetup } = createSetupRoutes({ store, sendJson, fetchImpl: onshape.fetchImpl, settingsStore });
const { handleSettings } = createSettingsRoutes({
  store,
  settingsStore,
  sendJson,
  gates: (session) => writeGates(peekAuthSummary(session))
});
// Every route with a request body: preview, install, upload, apply, rebind,
// suppress, and the install status read. Everything they need from this file
// is passed in rather than imported, so the module stays testable and the
// context, calibration, backup, and capability rules have exactly one
// implementation. Nothing this server writes to Onshape is dispatched from
// this file; test/routes.test.mjs fails if that stops being true.
const { handleWrite } = createWriteRoutes({
  api: onshape,
  assets,
  config,
  generation: () => store.generation,
  settingsStore,
  capabilities: (session) => peekAuthSummary(session).capabilities,
  sendJson,
  normalizeContext,
  normalizeCalibration: normalizeCalibrationRequest,
  loadImageItem: getFreshImageItem,
  loadImageItems: getFreshImageItems,
  writeBackup
});
const { handleAuth } = createAuthRoutes({ api: onshape, config, sendJson, sendText, redirect });

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.fs': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
});

function setSecurityHeaders(res) {
  const frameOrigin = new URL(config().onshapeBaseUrl).origin;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' blob: data:",
      "connect-src 'self'",
      `frame-ancestors 'self' ${frameOrigin}`,
      "base-uri 'self'",
      "form-action 'self'"
    ].join('; ')
  );
}

// A non-probing summary for routes that must never trigger a network call
// (bootstrap). GET /api/connection uses getConnectionState instead, which
// probes on a cache miss.
function peekAuthSummary(session) {
  const current = config();
  const connection = peekConnectionState({ config: current, session, generation: store.generation });
  return buildAuthSummary(current, session, connection, { generation: store.generation });
}

// Every write feature's refusal sentence, or '' where nothing refuses it.
// Sent with the auth summary so a disabled button in the browser shows the
// server's own wording rather than a second copy that can drift from it.
function writeGates(auth) {
  return featureGateReasons({ capabilities: auth?.capabilities, policy: settingsStore.current() });
}

function normalizeCalibrationRequest(body, fallbackPlacement) {
  const distanceMeters = body.trueDistanceMeters !== undefined
    ? Number(body.trueDistanceMeters)
    : lengthToMeters(body.trueDistance, body.distanceUnit || 'in');

  const rotationTarget = { mode: body.rotationTarget?.mode || body.rotationMode || 'keep' };
  if (rotationTarget.mode === 'custom') {
    rotationTarget.customAngle = body.rotationTarget?.customAngleRadians !== undefined
      ? Number(body.rotationTarget.customAngleRadians)
      : angleToRadians(
          body.rotationTarget?.customAngle ?? body.customAngle ?? 0,
          body.rotationTarget?.customAngleUnit ?? body.customAngleUnit ?? 'deg'
        );
  }

  return {
    imageSize: body.imageSize,
    placement: fallbackPlacement || body.currentPlacement,
    scalePair: body.scalePair,
    trueDistance: distanceMeters,
    rotationPair: body.rotationPair,
    rotationTarget,
    anchor: body.anchor || 'scale-a'
  };
}

// One read, one scan. Every caller that needs a single item goes through
// getFreshImageItem, and every caller that needs the whole list goes through
// this, so a target and its neighbours are never scanned with different
// options.
async function getFreshImageItems(context, session) {
  const featureList = await onshape.getFeatures(context, session);
  const items = scanFeatureList(featureList, context, {
    enableNativeImageWrite: config().enableNativeImageWrite
  });
  return { featureList, items };
}

async function getFreshImageItem(context, itemId, session) {
  const { featureList, items } = await getFreshImageItems(context, session);
  const item = items.find((candidate) => candidate.id === itemId);
  // A stale itemId is the browser holding a list Onshape has moved past, not
  // a server fault: 409, so the UI can say "press Refresh" instead of showing
  // an internal error.
  if (!item) throw Object.assign(new Error('The selected reference image no longer exists. Refresh the image list.'), { status: 409 });
  return { featureList, item };
}

function safeFilenamePart(value) {
  return String(value || 'unknown').replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 100);
}

async function writeBackup({ context, item, featureList, payload, calibration, operation = 'apply' }) {
  await fsp.mkdir(config().backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const random = crypto.randomBytes(3).toString('hex');
  const filename = [
    stamp,
    safeFilenamePart(context.documentId),
    safeFilenamePart(context.elementId),
    safeFilenamePart(item.featureId),
    random
  ].join('__') + '.json';
  const filepath = path.join(config().backupDir, filename);
  await fsp.writeFile(filepath, JSON.stringify({
    createdAt: new Date().toISOString(),
    operation,
    context: publicContext(context),
    item,
    calibration,
    originalFeatureList: featureList,
    proposedUpdate: payload
  }, null, 2));
  return filepath;
}

async function serveStatic(url, res) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/assets/ReferenceImage.fs') {
    return serveAsset('featurescript/ReferenceImage.fs', res, 'text/plain; charset=utf-8');
  }
  const assetKey = assets.resolveAssetKey('public', pathname);
  if (!assetKey) return false;
  return serveAsset(assetKey, res);
}

// Routes both the from-source and the packaged (SEA) cases through
// src/assets.mjs, which is the one place that knows whether this process is
// reading off disk or out of the binary it was built into.
async function serveAsset(assetKey, res, forcedType) {
  const type = forcedType || MIME[path.extname(assetKey).toLowerCase()] || 'application/octet-stream';
  return assets.send(res, assetKey, {
    contentType: type,
    cacheControl: boot.nodeEnv === 'development' ? 'no-store' : 'public, max-age=300'
  });
}

async function handleApi(req, res, url, session) {
  const context = normalizeContext(url);

  if (req.method === 'GET' && url.pathname === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      name: 'onshape-reference-align',
      version: VERSION,
      apiVersion: config().apiVersion,
      authMode: config().authMode,
      nativeImageWrite: config().enableNativeImageWrite,
      configSource: store.envFileSource
    });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/update') {
    sendJson(res, 200, await updateChecker.check());
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/bootstrap') {
    const setupFailure = setupGuardFailure(req, config());
    const auth = peekAuthSummary(session);
    sendJson(res, 200, {
      csrfToken: session.csrfToken,
      context: publicContext(context),
      auth,
      // One refusal sentence per write feature, composed by the same gate the
      // routes throw from. The browser shows these verbatim.
      gates: writeGates(auth),
      // The operator's policy toggles, sent on first paint so the UI can
      // explain a disabled control without a second round trip. Booleans and
      // one folder id only; never a credential.
      policy: settingsStore.current(),
      capabilities: {
        standalone: true,
        customFeatureWrite: true,
        nativeImageWrite: config().enableNativeImageWrite,
        onshapeBaseUrl: config().onshapeBaseUrl,
        apiVersion: config().apiVersion
      },
      setup: {
        available: !setupFailure,
        reason: setupFailure?.reason ?? null,
        // Only shown once the guard has already established the caller is on
        // this machine; the unavailable case never names the path.
        configPath: setupFailure ? null : store.envFilePath
      }
    });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/connection') {
    const current = config();
    const connection = await getConnectionState({
      api: onshape,
      config: current,
      session,
      generation: store.generation,
      force: url.searchParams.get('force') === '1'
    });
    const auth = buildAuthSummary(current, session, connection, { generation: store.generation });
    sendJson(res, 200, { auth, gates: writeGates(auth), policy: settingsStore.current() });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/context') {
    if (!context.complete) {
      sendJson(res, 200, {
        context: publicContext(context),
        auth: peekAuthSummary(session),
        items: [],
        message: 'No complete Onshape Part Studio context was supplied.'
      });
      return true;
    }
    const { featureList, items } = await getFreshImageItems(context, session);
    sendJson(res, 200, {
      context: publicContext(context),
      auth: peekAuthSummary(session),
      items,
      featureListSummary: {
        serializationVersion: featureList.serializationVersion,
        libraryVersion: featureList.libraryVersion,
        featureCount: featureList.features?.length || 0
      }
    });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/image') {
    if (!context.complete) throw Object.assign(new Error('A complete Onshape context is required.'), { status: 400 });
    const itemId = url.searchParams.get('itemId');
    if (!itemId) throw Object.assign(new Error('itemId is required.'), { status: 400 });
    const { item } = await getFreshImageItem(context, itemId, session);
    if (!item.image?.reference) throw Object.assign(new Error('The serialized feature did not expose a downloadable image reference.'), { status: 404 });
    const response = await onshape.downloadBlob(item.image.reference, session);
    const contentType = response.headers.get('content-type') || item.image.reference.mediaType || 'application/octet-stream';
    const buffer = Buffer.from(await response.arrayBuffer());
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': buffer.length,
      'Cache-Control': 'private, max-age=60'
    });
    res.end(buffer);
    return true;
  }

  if (url.pathname.startsWith('/api/setup')) {
    return handleSetup(req, res, url, session);
  }

  if (url.pathname === '/api/settings') {
    return handleSettings(req, res, url, session);
  }

  // Every route with a body, and the one registry-driven rate-limit lookup
  // that covers them all — taken inside the module, before any handler reads
  // a byte. This file keeps no such route of its own, so there is no second
  // place a bucket could be skipped.
  if (await handleWrite(req, res, url, session)) return true;

  return false;
}

function errorResponse(error) {
  let status = Number(error.status) || 500;
  if (error instanceof CalibrationError) status = 400;
  if (error instanceof AuthRequiredError) status = 401;
  if (error instanceof OnshapeApiError) status = error.status || 502;
  const safeMessage = status >= 500 && boot.nodeEnv !== 'development'
    ? 'The server could not complete the request.'
    : error.message;
  return {
    status,
    body: {
      error: safeMessage,
      code: error.code || 'ERROR',
      ...(error instanceof CalibrationError && error.details ? { details: error.details } : {}),
      ...(error instanceof OnshapeApiError && boot.nodeEnv === 'development' ? { upstream: error.body } : {}),
      ...(error instanceof AuthRequiredError && config().authMode === 'oauth' ? { authorizeUrl: '/auth/start' } : {}),
      // The capability/policy gate's reason is written for the operator and
      // is shown verbatim by the UI, so it travels with the response instead
      // of being re-derived (and re-worded) in the browser.
      ...(error.code === 'CAPABILITY_DENIED' || error.code === 'POLICY_DENIED'
        ? { feature: error.feature, reason: error.reason }
        : {}),
      // Structured detail a route has explicitly chosen to publish, e.g. the
      // featureStatus behind a refused install or the image tabs to choose
      // from. Opt-in by name so an internal error object can never leak by
      // being spread wholesale.
      ...(error.expose && typeof error.expose === 'object' ? error.expose : {})
    }
  };
}

const server = http.createServer(async (req, res) => {
  setSecurityHeaders(res);

  try {
    const session = getSession(req, res, boot);
    const host = req.headers.host || `${boot.host}:${boot.port}`;
    const url = new URL(req.url || '/', `${boot.publicBaseUrl || `http://${host}`}`);
    // Runs above the dispatch chains, not inside one of them. Derived from the
    // route registry rather than typed out here: a list kept by hand next to a
    // dispatch chain is fail-open, since a new non-GET route that nobody
    // remembers to add to it is simply unprotected. It sat inside handleApi()
    // until POST '/auth/logout' showed what that costs -- the router never
    // enters handleApi() for a '/auth/' pathname, so a route the registry
    // marked CSRF-gated had no gate on it. src/routes.mjs is the one place a
    // route is declared; test/routes.test.mjs fails when a dispatched route is
    // missing from it, and test/route-gates.test.mjs fails when a registered
    // route's gate does not answer.
    if (req.method !== 'GET' && req.method !== 'HEAD' && CSRF_PATHS.includes(url.pathname)) {
      if (!requireCsrf(req, session)) {
        sendJson(res, 403, { error: 'Invalid or missing CSRF token.', code: 'CSRF' });
        return;
      }
    }

    if (url.pathname.startsWith('/api/')) {
      if (await handleApi(req, res, url, session)) return;
      sendJson(res, 404, { error: 'API route not found.', code: 'NOT_FOUND' });
      return;
    }
    if (url.pathname.startsWith('/auth/') || url.pathname === '/oauth/callback') {
      if (await handleAuth(req, res, url, session)) return;
      sendText(res, 404, 'Route not found.');
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendText(res, 405, 'Method not allowed.');
      return;
    }
    if (await serveStatic(url, res)) return;
    sendText(res, 404, 'Not found.');
  } catch (error) {
    console.error(error);
    if (res.headersSent) {
      res.destroy();
      return;
    }
    const { status, body } = errorResponse(error);
    // The one header a refusal may add, set from a number the throwing code
    // computed rather than copied from any upstream response. Kept to this
    // single name on purpose: a general "headers" bag on an error object is
    // how an upstream 429's own headers end up forwarded to a browser.
    if (Number.isFinite(error.retryAfterSeconds)) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil(error.retryAfterSeconds))));
    }
    // req.complete is false only when the client's declared or actual body
    // was never fully received (readJson()/readCappedBody() throwing on an
    // oversize body, or the declared-Content-Length checks in
    // write-routes.mjs, all leave it false). Answering with the default
    // keep-alive in that case would leave this socket waiting on bytes the
    // client may never finish sending, so nothing else on it -- including a
    // pipelined next request -- would ever get a response. Force the client
    // to open a new connection instead.
    sendJson(res, status, body);
  }
});

listenWithLocalFallback(server, boot, {
  onFallback: () => console.log('The usual local address is busy. Finding another available address automatically…')
}).then(() => {
  // PORT=0 asks the OS for an ephemeral port (used by the SEA smoke test and
  // available to anyone who wants one). Commit the real bound port to the
  // config store before reading current(): originRefusalReason() compares a
  // request's Origin/Host port against config().port on every request after
  // this, and it must see what the OS actually bound rather than the "0"
  // that was requested, or the setup wizard can never pass its own check.
  const address = server.address();
  const boundPort = typeof address === 'object' && address ? address.port : boot.port;
  const current = store.commitBoundPort(boundPort);
  console.log(`Reference Align listening on ${current.publicBaseUrl}`);
  console.log('Keep this window open while using Reference Align. Close it when you are finished.');
  console.log(`Config: ${store.envFilePath} (${store.envFileSource})`);
  console.log(`Onshape API: ${current.onshapeBaseUrl}/api/${current.apiVersion}; auth=${current.authMode}; nativeWrite=${current.enableNativeImageWrite}`);
  if (shouldOpenBrowser()) openBrowser(current.publicBaseUrl);
}).catch((error) => {
  console.error(error.code === 'EADDRINUSE'
    ? `The configured hosted address is busy (${boot.host}:${boot.port}). Ask the person who configured this deployment for help.`
    : `Reference Align could not start: ${error.message}`);
  process.exitCode = 1;
});
