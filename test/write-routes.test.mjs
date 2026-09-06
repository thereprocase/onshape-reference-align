import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import { createWriteRoutes, MAX_FEATURE_STUDIO_READS } from '../src/write-routes.mjs';
import { ROUTES } from '../src/routes.mjs';
import { createAssetSource } from '../src/assets.mjs';
import { OnshapeApiError } from '../src/onshape-api.mjs';
import { normalizeContext } from '../src/context.mjs';
import { FEATURES, deriveCapabilities } from '../src/capabilities.mjs';
import { DEFAULT_SETTINGS } from '../src/settings.mjs';
import { FEATURE_MARKER, buildReferenceImageFeature, scanFeatureList } from '../src/onshape-model.mjs';
import { BLOB_B, nativeImageEntity, nativeSketchFeature } from './fixtures/native-sketch-image.mjs';
import { FEATURE_LIST_BEFORE_SUPPRESS } from './fixtures/suppress-feature.mjs';
import {
  ELEMENTS_AFTER_FEATURE_STUDIO,
  ELEMENTS_AFTER_UPLOAD,
  ELEMENTS_INITIAL
} from './fixtures/install-elements.mjs';
import {
  ADD_FEATURE_RESPONSE,
  BLOB_UPLOAD_RESPONSE,
  FEATURE_LIST_BEFORE_ADD,
  FEATURE_STUDIO_CREATE_RESPONSE
} from './fixtures/install-features.mjs';

const CONTEXT = Object.freeze({
  documentId: 'a11ce0000000000000000039',
  workspaceOrVersion: 'w',
  workspaceOrVersionId: 'a11ce0000000000000000052',
  elementId: 'a11ce0000000000000000027'
});

const BLOB_A = { elementId: 'a11ce0000000000000000120', microversionId: 'a11ce0000000000000000010' };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

// The same in-process harness scripts/live-verify-install.mjs uses: a readable
// stream carrying the body, and a sendJson that records instead of writing.
function jsonRequest(value) {
  const payload = Buffer.from(JSON.stringify(value));
  const stream = Readable.from([payload]);
  stream.method = 'POST';
  stream.headers = { 'content-type': 'application/json', 'content-length': String(payload.length) };
  return stream;
}

async function multipartRequest({
  bytes,
  filename,
  mediaType = 'image/png',
  confirm = true,
  extraParts = [],
  declaredLength,
  noFilePart = false
}) {
  const form = new FormData();
  // Appended first so a route that reads parts in order cannot skip past the
  // real file by accident, and so the case is representative of an attacker
  // padding a request with unrelated fields.
  for (const part of extraParts) form.append(part.name, part.value, part.filename);
  if (!noFilePart) form.append('file', new Blob([bytes], { type: mediaType }), filename);
  if (confirm) form.append('confirm', 'true');
  const staged = new Request('https://local.invalid/', { method: 'POST', body: form });
  const contentType = staged.headers.get('content-type');
  const payload = Buffer.from(await staged.arrayBuffer());
  const stream = Readable.from([payload]);
  stream.method = 'POST';
  stream.headers = {
    'content-type': contentType,
    // A caller can lie about this to probe the streaming cap, which must not
    // trust it either way.
    'content-length': String(declaredLength ?? payload.length)
  };
  return stream;
}

/** A body that is not parseable multipart/form-data at all, despite the header. */
function malformedMultipartRequest() {
  const payload = Buffer.from('this is not a multipart body');
  const stream = Readable.from([payload]);
  stream.method = 'POST';
  stream.headers = { 'content-type': 'multipart/form-data; boundary=----nope', 'content-length': String(payload.length) };
  return stream;
}

function contextSearch() {
  return new URLSearchParams({
    documentId: CONTEXT.documentId,
    workspaceOrVersion: CONTEXT.workspaceOrVersion,
    workspaceOrVersionId: CONTEXT.workspaceOrVersionId,
    elementId: CONTEXT.elementId
  }).toString();
}

// The stub every test uses unless it cares specifically about how the
// FeatureScript source is read: a fixed source string, no filesystem or
// packaged-asset behaviour exercised. The dedicated packaged-mode test below
// swaps this out for a real createAssetSource() with an injected sea stub.
function stubAssets(source = `// ${FEATURE_MARKER}\n`) {
  return { readAsset: async () => Buffer.from(source, 'utf8') };
}

// A stand-in for server.mjs's normalizeCalibrationRequest, faithful in the one
// respect these cases depend on: it is the single place a request is turned
// into solver input, and both /api/preview and /api/apply go through it. The
// unit conversions themselves are pinned in test/units.test.mjs.
function calibrationNormalizer(calls) {
  return (body, fallbackPlacement) => {
    calls.push('normalizeCalibration');
    return {
      imageSize: body.imageSize,
      placement: fallbackPlacement || body.currentPlacement,
      scalePair: body.scalePair,
      trueDistance: body.trueDistanceMeters,
      rotationPair: body.rotationPair,
      rotationTarget: body.rotationTarget || { mode: 'keep' },
      anchor: body.anchor || 'scale-a'
    };
  };
}

function harness({
  api = {},
  assets,
  policy = {},
  capabilities,
  featureStatus = 'OK',
  loadImageItem,
  loadImageItems,
  maxImageUploadBytes = 25 * 1024 * 1024,
  enableNativeImageWrite = false
} = {}) {
  const calls = [];
  const sent = [];
  const record = (name, value) => {
    calls.push(name);
    return value;
  };
  const defaultApi = {
    listElements: async () => record('listElements', structuredClone(ELEMENTS_INITIAL)),
    getFeatures: async () => record('getFeatures', structuredClone(FEATURE_LIST_BEFORE_ADD)),
    getFeatureStudioContents: async () => record('getFeatureStudioContents', { contents: '' }),
    createFeatureStudio: async () => record('createFeatureStudio', { ...FEATURE_STUDIO_CREATE_RESPONSE }),
    setFeatureStudioContents: async () => record('setFeatureStudioContents', {}),
    addFeature: async () => record('addFeature', {
      ...ADD_FEATURE_RESPONSE,
      featureState: { btType: 'BTFeatureState-1688', featureStatus, inactive: false }
    }),
    uploadImageBlob: async () => record('uploadImageBlob', { ...BLOB_UPLOAD_RESPONSE }),
    updateFeature: async () => record('updateFeature', {
      ...ADD_FEATURE_RESPONSE,
      featureState: { btType: 'BTFeatureState-1688', featureStatus, inactive: false }
    })
  };
  const backups = [];
  const routes = createWriteRoutes({
    api: { ...defaultApi, ...api },
    assets: assets || stubAssets(),
    config: () => ({ maxImageUploadBytes, enableNativeImageWrite }),
    generation: () => 1,
    settingsStore: { current: () => ({ ...DEFAULT_SETTINGS, ...policy }) },
    capabilities: () => capabilities,
    sendJson: (res, status, body) => sent.push({ status, body }),
    normalizeContext,
    normalizeCalibration: calibrationNormalizer(calls),
    loadImageItem: loadImageItem || (async () => { throw new Error('loadImageItem is not used by these cases.'); }),
    loadImageItems: loadImageItems || (async () => { throw new Error('loadImageItems is not used by these cases.'); }),
    writeBackup: async (...args) => {
      backups.push(args[0]);
      calls.push('writeBackup');
      return 'backup.json';
    }
  });
  return { ...routes, calls, sent, backups };
}

// `session` defaults to a fresh object per call, so a case that does not care
// about the rate-limit buckets never inherits another case's spent tokens.
// Pass one in to share the buckets across several requests, or to start from a
// bucket that is already full.
async function run(routes, { method, pathname, search = '', req, session = {} }) {
  const url = new URL(`http://127.0.0.1${pathname}${search ? `?${search}` : ''}`);
  const request = req || Object.assign(Readable.from([]), { method, headers: {} });
  request.method = method;
  try {
    const handled = await routes.handleWrite(request, {}, url, session);
    return { handled, request, response: routes.sent.at(-1) };
  } catch (error) {
    return { error, request };
  }
}

const NO_WRITE_SCOPE = deriveCapabilities({ sessionInfo: { oauth2Scopes: 1, planGroup: 'Free' }, generation: 1 });

const FEATURE_STUDIO_ID = 'a11ce0000000000000000114';
const FEATURE_STUDIO_MICROVERSION = 'a11ce0000000000000000030';

// A document that already has the marked Feature Studio and both image blobs,
// so a case can reach the add-feature call without creating anything.
function installedDocumentApi() {
  return {
    listElements: async () => structuredClone(ELEMENTS_AFTER_FEATURE_STUDIO),
    getFeatureStudioContents: async () => ({ contents: `// ${FEATURE_MARKER}\n` })
  };
}

test('a key with no write scope is refused before a single Onshape call', async () => {
  const routes = harness({ capabilities: NO_WRITE_SCOPE });
  const { error } = await run(routes, {
    method: 'POST',
    pathname: '/api/install',
    req: jsonRequest({ context: CONTEXT, imageElementId: BLOB_A.elementId, confirm: true })
  });
  assert.equal(error.status, 403);
  assert.equal(error.code, 'CAPABILITY_DENIED');
  assert.equal(error.feature, 'installFeature');
  assert.match(error.reason, /Key lacks write scope/);
  assert.deepEqual(routes.calls, []);
});

test('a policy switch turned off is refused before a single Onshape call, naming the switch', async () => {
  const routes = harness({ policy: { allowFeatureInstall: false } });
  const { error } = await run(routes, {
    method: 'POST',
    pathname: '/api/install',
    req: jsonRequest({ context: CONTEXT, imageElementId: BLOB_A.elementId, confirm: true })
  });
  assert.equal(error.status, 403);
  assert.equal(error.code, 'POLICY_DENIED');
  assert.match(error.reason, /Install the Reference Image feature/);
  assert.deepEqual(routes.calls, []);
});

test('confirmBeforeWrite is enforced by the server, not only asked by the browser', async () => {
  const routes = harness();
  const { error } = await run(routes, {
    method: 'POST',
    pathname: '/api/install',
    req: jsonRequest({ context: CONTEXT, imageElementId: BLOB_A.elementId })
  });
  assert.equal(error.status, 409);
  assert.equal(error.code, 'CONFIRM_REQUIRED');
  assert.deepEqual(routes.calls, []);
});

test('turning confirmation off lets the same request through', async () => {
  const routes = harness({ policy: { confirmBeforeWrite: false }, api: installedDocumentApi() });
  const { response } = await run(routes, {
    method: 'POST',
    pathname: '/api/install',
    req: jsonRequest({ context: CONTEXT, imageElementId: BLOB_A.elementId })
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.featureStatus, 'OK');
});

test('a version link is refused as read-only rather than failing at Onshape', async () => {
  const routes = harness();
  const { error } = await run(routes, {
    method: 'POST',
    pathname: '/api/install',
    req: jsonRequest({
      context: { ...CONTEXT, workspaceOrVersion: 'v' },
      imageElementId: BLOB_A.elementId,
      confirm: true
    })
  });
  assert.equal(error.status, 409);
  assert.equal(error.code, 'CONTEXT_READ_ONLY');
  assert.deepEqual(routes.calls, []);
});

// The whole reason the route re-reads the element listing: HTTP 200 with a
// featureStatus of ERROR is what a namespace that does not resolve looks like.
test('an ERROR feature status is a refusal, not a success', async () => {
  const routes = harness({ featureStatus: 'ERROR', policy: { confirmBeforeWrite: false }, api: installedDocumentApi() });
  const { error } = await run(routes, {
    method: 'POST',
    pathname: '/api/install',
    req: jsonRequest({ context: CONTEXT, imageElementId: BLOB_A.elementId })
  });
  assert.equal(error.status, 409);
  assert.equal(error.code, 'FEATURE_STATUS_NOT_OK');
  assert.equal(error.expose.featureStatus, 'ERROR');
  assert.equal(error.expose.imageNamespace, `e${BLOB_A.elementId}::m${BLOB_A.microversionId}`);
});

// The Feature Studio create response reports the microversion from before the
// contents were set. Using it would build a namespace Onshape stores and then
// reports as ERROR, so the listing has to be read again.
test('creating the Feature Studio re-reads the element listing for its microversion', async () => {
  let listings = 0;
  let sentFeature;
  const routes = harness({
    policy: { confirmBeforeWrite: false },
    api: {
      listElements: async () => {
        listings += 1;
        // First read: the blobs are there, the studio is not. Second read,
        // after the studio has been created and filled in: both.
        return structuredClone(listings === 1 ? ELEMENTS_AFTER_UPLOAD : ELEMENTS_AFTER_FEATURE_STUDIO);
      },
      addFeature: async (context, payload) => {
        sentFeature = payload.feature;
        return { ...ADD_FEATURE_RESPONSE, featureState: { btType: 'BTFeatureState-1688', featureStatus: 'OK', inactive: false } };
      }
    }
  });
  const { response } = await run(routes, {
    method: 'POST',
    pathname: '/api/install',
    req: jsonRequest({ context: CONTEXT, imageElementId: BLOB_A.elementId })
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.createdFeatureStudio, true);
  assert.ok(routes.calls.includes('createFeatureStudio'));
  assert.ok(routes.calls.includes('setFeatureStudioContents'));
  assert.equal(listings, 2, 'the listing is read again after the studio is created');
  assert.equal(sentFeature.namespace, `e${FEATURE_STUDIO_ID}::m${FEATURE_STUDIO_MICROVERSION}`);
  assert.notEqual(sentFeature.namespace, `e${FEATURE_STUDIO_ID}::m${FEATURE_STUDIO_CREATE_RESPONSE.microversionId}`);
});

// A packaged SEA binary's projectRoot is the per-user config directory, which
// nothing ever populates with a featurescript/ subfolder: readFeatureScriptSource
// has to go through the same embedded-asset seam serveAsset uses, not
// config().featureScriptDir, or install is dead in every packaged build. The
// projectRoot below does not exist on disk, so a fall-through to fs would
// surface as ENOENT rather than as the embedded source going missing.
test('creating the Feature Studio reads ReferenceImage.fs from the packaged asset source, not the filesystem', async () => {
  const packagedSource = `// ${FEATURE_MARKER}\nfeatureScript packagedVersion;\n`;
  const sea = {
    isSea: () => true,
    getAssetKeys: () => ['featurescript/ReferenceImage.fs'],
    getRawAsset: (key) => {
      assert.equal(key, 'featurescript/ReferenceImage.fs');
      return new TextEncoder().encode(packagedSource).buffer;
    }
  };
  const packagedAssets = createAssetSource({
    projectRoot: 'Z:/does-not-exist/onshape-reference-align-sea',
    sea
  });
  assert.equal(packagedAssets.isPackaged, true);

  let listings = 0;
  let sentSource;
  const routes = harness({
    assets: packagedAssets,
    policy: { confirmBeforeWrite: false },
    api: {
      listElements: async () => {
        listings += 1;
        return structuredClone(listings === 1 ? ELEMENTS_AFTER_UPLOAD : ELEMENTS_AFTER_FEATURE_STUDIO);
      },
      setFeatureStudioContents: async (context, elementId, contents) => {
        sentSource = contents;
        return {};
      }
    }
  });
  const { response } = await run(routes, {
    method: 'POST',
    pathname: '/api/install',
    req: jsonRequest({ context: CONTEXT, imageElementId: BLOB_A.elementId })
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.createdFeatureStudio, true);
  assert.equal(sentSource, packagedSource);
});

test('a second install finds the instance and writes nothing', async () => {
  const routes = harness({
    policy: { confirmBeforeWrite: false },
    api: {
      ...installedDocumentApi(),
      getFeatures: async () => ({
        ...structuredClone(FEATURE_LIST_BEFORE_ADD),
        features: [structuredClone(ADD_FEATURE_RESPONSE.feature)]
      })
    }
  });
  const { response } = await run(routes, {
    method: 'POST',
    pathname: '/api/install',
    req: jsonRequest({ context: CONTEXT, imageElementId: BLOB_A.elementId })
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.alreadyInstalled, true);
  assert.equal(response.body.created, false);
  assert.equal(response.body.featureId, ADD_FEATURE_RESPONSE.feature.featureId);
  assert.equal(routes.calls.includes('addFeature'), false);
  assert.equal(routes.calls.includes('createFeatureStudio'), false);
});

// A studio this key cannot open might be the one already installed. Creating a
// second copy over it is worse than stopping.
test('a Feature Studio that could not be opened stops the install rather than duplicating it', async () => {
  const routes = harness({
    policy: { confirmBeforeWrite: false },
    api: {
      listElements: async () => structuredClone(ELEMENTS_AFTER_FEATURE_STUDIO),
      getFeatureStudioContents: async () => {
        throw new OnshapeApiError('forbidden', { status: 403 });
      }
    }
  });
  const { error } = await run(routes, {
    method: 'POST',
    pathname: '/api/install',
    req: jsonRequest({ context: CONTEXT, imageElementId: BLOB_A.elementId })
  });
  assert.equal(error.status, 409);
  assert.equal(error.code, 'FEATURE_STUDIO_UNREADABLE');
  assert.deepEqual(error.expose.unreadStudioIds, [FEATURE_STUDIO_ID]);
  assert.equal(routes.calls.includes('createFeatureStudio'), false);
});

test('the upload route judges the bytes, not the declared type', async () => {
  const routes = harness();
  const { error } = await run(routes, {
    method: 'POST',
    pathname: '/api/upload-image',
    search: contextSearch(),
    req: await multipartRequest({ bytes: Buffer.from('<html>', 'utf8'), filename: 'trap.png' })
  });
  assert.equal(error.status, 400);
  assert.equal(error.code, 'UNSUPPORTED_IMAGE_TYPE');
  assert.deepEqual(routes.calls, []);
});

test('a JSON body on the upload route is refused as the wrong media type', async () => {
  const routes = harness();
  const { error } = await run(routes, {
    method: 'POST',
    pathname: '/api/upload-image',
    search: contextSearch(),
    req: jsonRequest({ confirm: true })
  });
  assert.equal(error.status, 415);
  assert.equal(error.code, 'UNSUPPORTED_MEDIA_TYPE');
});

test('a successful upload reports the namespace it would bind with', async () => {
  const routes = harness();
  const { response } = await run(routes, {
    method: 'POST',
    pathname: '/api/upload-image',
    search: contextSearch(),
    req: await multipartRequest({ bytes: PNG, filename: 'icon.png' })
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.elementId, BLOB_A.elementId);
  assert.equal(response.body.namespace, `e${BLOB_A.elementId}::m${BLOB_A.microversionId}`);
  assert.equal(response.body.mediaType, 'image/png');
});

// A namespace missing its microversion is stored by Onshape without complaint
// and then fails, so the route looks the microversion up rather than shipping
// a half-built one.
test('an upload response with no microversion falls back to the element listing', async () => {
  const routes = harness({
    api: {
      uploadImageBlob: async () => ({ ...BLOB_UPLOAD_RESPONSE, microversionId: null }),
      listElements: async () => structuredClone(ELEMENTS_AFTER_UPLOAD)
    }
  });
  const { response } = await run(routes, {
    method: 'POST',
    pathname: '/api/upload-image',
    search: contextSearch(),
    req: await multipartRequest({ bytes: PNG, filename: 'icon.png' })
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.microversionId, BLOB_A.microversionId);
});

// listImageBlobElements and listFeatureStudioElements already accept an
// { items: [...] } listing alongside a bare array; the fallback lookup here
// has to as well; otherwise the two paths silently disagree about what the
// same listElements response means.
test('the microversion fallback also reads an items-wrapped element listing', async () => {
  const routes = harness({
    api: {
      uploadImageBlob: async () => ({ ...BLOB_UPLOAD_RESPONSE, microversionId: null }),
      listElements: async () => ({ items: structuredClone(ELEMENTS_AFTER_UPLOAD) })
    }
  });
  const { response } = await run(routes, {
    method: 'POST',
    pathname: '/api/upload-image',
    search: contextSearch(),
    req: await multipartRequest({ bytes: PNG, filename: 'icon.png' })
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.microversionId, BLOB_A.microversionId);
});

test('an upload Onshape cannot describe is a refusal, not a half-built namespace', async () => {
  const routes = harness({
    api: {
      uploadImageBlob: async () => ({ ...BLOB_UPLOAD_RESPONSE, microversionId: null }),
      listElements: async () => structuredClone(ELEMENTS_INITIAL)
    }
  });
  const { error } = await run(routes, {
    method: 'POST',
    pathname: '/api/upload-image',
    search: contextSearch(),
    req: await multipartRequest({ bytes: PNG, filename: 'icon.png' })
  });
  assert.equal(error.status, 502);
  assert.equal(error.code, 'UPLOAD_REFERENCE_MISSING');
});

test('a 0-byte file part is refused as an empty upload, not sent to Onshape', async () => {
  const routes = harness();
  const { error } = await run(routes, {
    method: 'POST',
    pathname: '/api/upload-image',
    search: contextSearch(),
    req: await multipartRequest({ bytes: Buffer.alloc(0), filename: 'empty.png' })
  });
  assert.equal(error.status, 400);
  assert.equal(error.code, 'EMPTY_UPLOAD');
  assert.deepEqual(routes.calls, []);
});

test('a multipart body with no "file" part is refused by name, not a crash', async () => {
  const routes = harness();
  const { error } = await run(routes, {
    method: 'POST',
    pathname: '/api/upload-image',
    search: contextSearch(),
    req: await multipartRequest({ noFilePart: true })
  });
  assert.equal(error.status, 400);
  assert.equal(error.code, 'FILE_PART_MISSING');
  assert.deepEqual(routes.calls, []);
});

test('a body that is not parseable multipart/form-data is refused, not a crash', async () => {
  const routes = harness();
  const { error } = await run(routes, {
    method: 'POST',
    pathname: '/api/upload-image',
    search: contextSearch(),
    req: malformedMultipartRequest()
  });
  assert.equal(error.status, 400);
  assert.equal(error.code, 'INVALID_MULTIPART');
  assert.deepEqual(routes.calls, []);
});

// The declared Content-Length is only ever a shortcut to refuse early. A
// client that lies about it small still hits the streaming cap once the real
// bytes arrive, and either way Onshape is never called.
test('an oversize upload is refused before Onshape is called, honest or lying about its own size', async () => {
  const big = Buffer.concat([PNG, Buffer.alloc(4096, 0x41)]);
  for (const declaredLength of [undefined, 10]) {
    const routes = harness({ maxImageUploadBytes: 1024 });
    routes.calls.length = 0;
    const { error } = await run(routes, {
      method: 'POST',
      pathname: '/api/upload-image',
      search: contextSearch(),
      req: await multipartRequest({ bytes: big, filename: 'big.png', declaredLength })
    });
    assert.equal(error.status, 413, `declaredLength=${declaredLength}`);
    assert.equal(error.code, 'IMAGE_TOO_LARGE', `declaredLength=${declaredLength}`);
    assert.equal(routes.calls.includes('uploadImageBlob'), false, `declaredLength=${declaredLength}`);
  }
});

// An extra, unrequested part must not confuse the parser or reach Onshape,
// and a path-like filename on the real part must come out the other side as
// a bare name — the same rule sanitizeUploadFilename's own unit test pins,
// exercised here through the actual multipart body the browser would send.
test('an extra multipart part is ignored, and a path-like filename is sanitized before Onshape sees it', async () => {
  let sentFilename;
  const routes = harness({
    api: {
      uploadImageBlob: async (context, args) => {
        sentFilename = args.filename;
        return { ...BLOB_UPLOAD_RESPONSE };
      }
    }
  });
  const { response } = await run(routes, {
    method: 'POST',
    pathname: '/api/upload-image',
    search: contextSearch(),
    req: await multipartRequest({
      bytes: PNG,
      filename: '../../../etc/passwd.png',
      extraParts: [{ name: 'extra', value: new Blob(['unexpected'], { type: 'text/plain' }), filename: '../../evil.txt' }]
    })
  });
  assert.equal(response.status, 200);
  assert.equal(sentFilename, 'passwd.png');
  assert.doesNotMatch(sentFilename, /[/\\]/);
});

// The magic-byte check only reads the header. A payload that starts with a
// valid PNG signature and then carries arbitrary trailing bytes is real image
// data as far as this route can tell — that is the documented trade-off of
// sniffing instead of fully parsing the format — but the extension is always
// rewritten from the sniffed type, so a ".exe" claim on the wire cannot reach
// Onshape's element name.
test('a PNG-signed file is accepted regardless of trailing bytes, and the extension is rewritten from what it actually is', async () => {
  let sentFilename;
  const routes = harness({
    api: {
      uploadImageBlob: async (context, args) => {
        sentFilename = args.filename;
        return { ...BLOB_UPLOAD_RESPONSE };
      }
    }
  });
  const polyglot = Buffer.concat([PNG, Buffer.from('MZ\x90\x00 this is not really an executable', 'latin1')]);
  const { response } = await run(routes, {
    method: 'POST',
    pathname: '/api/upload-image',
    search: contextSearch(),
    req: await multipartRequest({ bytes: polyglot, filename: 'totally-a-picture.exe', mediaType: 'application/x-msdownload' })
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.mediaType, 'image/png');
  assert.equal(sentFilename, 'totally-a-picture.png');
});

test('install with no usable image names the tabs it would accept', async () => {
  const routes = harness();
  const { error } = await run(routes, {
    method: 'POST',
    pathname: '/api/install',
    req: jsonRequest({ context: CONTEXT, confirm: true })
  });
  assert.equal(error.status, 400);
  assert.equal(error.code, 'IMAGE_REQUIRED');
  assert.deepEqual(error.expose.candidates, []);
});

test('status with no context answers instead of failing', async () => {
  const routes = harness();
  const { response } = await run(routes, { method: 'GET', pathname: '/api/install/status' });
  assert.equal(response.status, 200);
  assert.equal(response.body.available, false);
  assert.equal(response.body.install, null);
  assert.deepEqual(routes.calls, []);
});

test('an unrelated path is left for another handler', async () => {
  const routes = harness();
  const { handled } = await run(routes, { method: 'GET', pathname: '/api/context' });
  assert.equal(handled, false);
});

// ---------------------------------------------------------------------------
// The two bounds on how much work one request can be
// ---------------------------------------------------------------------------

// Synthetic, unlike every other fixture in this file: no captured document has
// ten Feature Studios in it, and the point of the cap is precisely the
// document nobody has captured. Only the four fields
// listFeatureStudioElements() reads are filled in.
function documentWithManyFeatureStudios(count) {
  const studios = [];
  for (let index = 0; index < count; index += 1) {
    studios.push({
      name: `Feature Studio ${index + 1}`,
      // Ids are 24 hex characters in Onshape, and isOnshapeId() is applied to
      // them elsewhere, so these have to look like the real thing.
      id: `aaaaaaaaaaaaaaaaaaaa${String(index).padStart(4, '0')}`,
      type: 'Feature Studio',
      elementType: 'FEATURESTUDIO',
      microversionId: `bbbbbbbbbbbbbbbbbbbb${String(index).padStart(4, '0')}`
    });
  }
  return { elements: [...structuredClone(ELEMENTS_INITIAL), ...studios], studios };
}

test('a document with more Feature Studios than the cap reads only the cap, and calls the rest unread', async () => {
  const { elements, studios } = documentWithManyFeatureStudios(10);
  assert.ok(studios.length > MAX_FEATURE_STUDIO_READS, 'this case is only meaningful past the cap');
  const asked = [];
  const routes = harness({
    api: {
      listElements: async () => structuredClone(elements),
      getFeatureStudioContents: async (context, elementId) => {
        asked.push(elementId);
        return { contents: '// nothing of ours\n' };
      }
    }
  });

  const { response } = await run(routes, {
    method: 'GET',
    pathname: '/api/install/status',
    search: contextSearch()
  });

  assert.equal(response.status, 200);
  assert.equal(
    asked.length,
    MAX_FEATURE_STUDIO_READS,
    `one status request opened ${asked.length} Feature Studios; the cap is ${MAX_FEATURE_STUDIO_READS}`
  );
  // The ones that were not opened are reported as unread. This is the part
  // that matters: an unopened studio counted as unmarked would let the install
  // below create a second copy of a feature that is already there.
  const expectedUnread = studios.slice(MAX_FEATURE_STUDIO_READS).map((studio) => studio.id);
  assert.deepEqual(response.body.install.unreadStudioIds, expectedUnread);
  assert.equal(response.body.install.state, 'not-installed');
  for (const id of asked) {
    assert.ok(!response.body.install.unreadStudioIds.includes(id), `${id} was read and still reported unread`);
  }
});

test('install refuses to guess when the cap left Feature Studios unread', async () => {
  const { elements } = documentWithManyFeatureStudios(10);
  const routes = harness({
    api: {
      listElements: async () => structuredClone(elements),
      getFeatureStudioContents: async () => ({ contents: '// nothing of ours\n' })
    }
  });

  const { error } = await run(routes, {
    method: 'POST',
    pathname: '/api/install',
    req: jsonRequest({ context: CONTEXT, imageElementId: BLOB_A.elementId, confirm: true })
  });

  assert.equal(error.status, 409);
  assert.equal(error.code, 'FEATURE_STUDIO_UNREADABLE');
  assert.equal(error.expose.unreadStudioIds.length, 10 - MAX_FEATURE_STUDIO_READS);
});

test('a spent bucket refuses the upload before its body is read', async () => {
  // The ordering the module header claims: the token is taken by the dispatch,
  // so a refusal costs neither the buffered body nor an Onshape call. This is
  // the whole reason the bucket exists on this route -- one upload holds
  // several times the image in memory at once.
  const routes = harness();
  const upload = ROUTES.find((route) => route.method === 'POST' && route.path === '/api/upload-image');
  const session = {
    rateLimits: {
      [upload.rateLimit.bucket]: { windowStart: Date.now(), count: upload.rateLimit.capacity }
    }
  };

  const req = await multipartRequest({ bytes: PNG, filename: 'reference.png' });
  const { error, request } = await run(routes, {
    method: 'POST',
    pathname: '/api/upload-image',
    search: contextSearch(),
    req,
    session
  });

  assert.equal(error.status, 429);
  assert.equal(error.code, 'RATE_LIMITED');
  assert.ok(error.retryAfterSeconds > 0, 'a refusal must say how long to wait');
  assert.equal(error.expose.retryAfterSeconds, error.retryAfterSeconds);
  assert.equal(request.readableEnded, false, 'the request body was buffered despite the refusal');
  assert.deepEqual(routes.calls, []);
});

test('the bucket is spent per session, so one session cannot exhaust another', async () => {
  const routes = harness();
  const install = ROUTES.find((route) => route.method === 'POST' && route.path === '/api/install');
  const spent = {
    rateLimits: {
      [install.rateLimit.bucket]: { windowStart: Date.now(), count: install.rateLimit.capacity }
    }
  };

  const refused = await run(routes, {
    method: 'POST',
    pathname: '/api/install',
    req: jsonRequest({ context: CONTEXT, imageElementId: BLOB_A.elementId, confirm: true }),
    session: spent
  });
  assert.equal(refused.error.status, 429);

  // A different session, same server, same bucket name: unaffected. It gets
  // past the throttle and on to the gates that come after it.
  const other = await run(routes, {
    method: 'POST',
    pathname: '/api/install',
    req: jsonRequest({ context: CONTEXT, imageElementId: BLOB_A.elementId, confirm: true }),
    session: {}
  });
  assert.notEqual(other.error?.status, 429);
});

// ---------------------------------------------------------------------------
// POST /api/suppress
// ---------------------------------------------------------------------------

// A document holding the calibrated feature and one native sketch that shows
// the same image. Scanned with native writes *disabled*, which is the default:
// suppression must not depend on the experimental geometry path.
function suppressionDocument({ suppressed = false } = {}) {
  const features = [
    structuredClone(FEATURE_LIST_BEFORE_SUPPRESS.features[0]),
    nativeSketchFeature({ suppressed, entity: nativeImageEntity({ blob: BLOB_B }) })
  ];
  const featureList = { ...FEATURE_LIST_BEFORE_SUPPRESS, features };
  const items = scanFeatureList(featureList, normalizeContext(CONTEXT), { enableNativeImageWrite: false });
  return { featureList, items };
}

const NATIVE_ITEM_ID = 'native:FSketchOne_0:KsOMMVzbDE6a';

function suppressionHarness(options = {}) {
  const document = suppressionDocument(options);
  return harness({
    ...options,
    loadImageItem: async (context, itemId) => {
      const item = document.items.find((candidate) => candidate.id === itemId);
      if (!item) throw Object.assign(new Error('gone'), { status: 409 });
      return { featureList: document.featureList, item };
    },
    loadImageItems: async () => ({ featureList: document.featureList, items: document.items })
  });
}

test('suppression is refused without confirm: true, whatever the confirm-before-write setting says', async () => {
  for (const policy of [{}, { confirmBeforeWrite: false }]) {
    const routes = suppressionHarness({ capabilities: undefined, policy });
    const { error } = await run(routes, {
      method: 'POST',
      pathname: '/api/suppress',
      req: jsonRequest({ context: CONTEXT, itemId: NATIVE_ITEM_ID, suppressed: true })
    });
    assert.equal(error.status, 400);
    assert.equal(error.code, 'CONFIRM_REQUIRED');
    assert.deepEqual(routes.calls, []);
  }
});

test('suppressed must be a real boolean, not a string that looks like one', async () => {
  const routes = suppressionHarness({ capabilities: undefined });
  const { error } = await run(routes, {
    method: 'POST',
    pathname: '/api/suppress',
    req: jsonRequest({ context: CONTEXT, itemId: NATIVE_ITEM_ID, suppressed: 'true', confirm: true })
  });
  assert.equal(error.status, 400);
  assert.equal(error.code, 'SUPPRESSED_REQUIRED');
  assert.deepEqual(routes.calls, []);
});

test('the policy switch refuses suppression before a single Onshape call', async () => {
  const routes = suppressionHarness({ capabilities: undefined, policy: { allowSuppression: false } });
  const { error } = await run(routes, {
    method: 'POST',
    pathname: '/api/suppress',
    req: jsonRequest({ context: CONTEXT, itemId: NATIVE_ITEM_ID, suppressed: true, confirm: true })
  });
  assert.equal(error.status, 403);
  assert.equal(error.code, 'POLICY_DENIED');
  assert.equal(error.feature, 'suppressFeature');
  assert.match(error.reason, /Suppress features/);
  assert.deepEqual(routes.calls, []);
});

test('a key with no write scope cannot suppress either', async () => {
  const routes = suppressionHarness({ capabilities: NO_WRITE_SCOPE });
  const { error } = await run(routes, {
    method: 'POST',
    pathname: '/api/suppress',
    req: jsonRequest({ context: CONTEXT, itemId: NATIVE_ITEM_ID, suppressed: true, confirm: true })
  });
  assert.equal(error.status, 403);
  assert.equal(error.code, 'CAPABILITY_DENIED');
  assert.equal(error.feature, 'suppressFeature');
});

test('only a native sketch can be suppressed from this route', async () => {
  const routes = suppressionHarness({ capabilities: undefined });
  const { error } = await run(routes, {
    method: 'POST',
    pathname: '/api/suppress',
    req: jsonRequest({ context: CONTEXT, itemId: 'custom:FycByd6CdezIhLo_0', suppressed: true, confirm: true })
  });
  assert.equal(error.status, 409);
  assert.equal(error.code, 'ITEM_NOT_SUPPRESSIBLE');
  assert.deepEqual(routes.calls, []);
});

test('suppressing posts the whole sketch back with only suppressed changed, after a backup', async () => {
  let posted;
  const routes = suppressionHarness({
    capabilities: undefined,
    api: {
      updateFeature: async (context, featureId, payload) => {
        // Captured at call time: what had already happened when Onshape was
        // asked. The backup has to be one of those things.
        posted = { featureId, payload, callsBefore: [...routes.calls] };
        return { ...ADD_FEATURE_RESPONSE, featureState: { featureStatus: 'OK', inactive: false } };
      }
    }
  });
  const { response } = await run(routes, {
    method: 'POST',
    pathname: '/api/suppress',
    req: jsonRequest({ context: CONTEXT, itemId: NATIVE_ITEM_ID, suppressed: true, confirm: true })
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.changed, true);
  assert.equal(response.body.suppressed, true);
  assert.equal(response.body.featureStatus, 'OK');
  assert.equal(response.body.backupFile, 'backup.json');
  assert.ok(Array.isArray(response.body.items));
  // The backup is written before the write reaches Onshape.
  assert.ok(posted.callsBefore.includes('writeBackup'));
  assert.equal(routes.backups[0].operation, 'suppress');

  assert.equal(posted.featureId, 'FSketchOne_0');
  const original = suppressionDocument().featureList.features[1];
  const sent = posted.payload.feature;
  assert.equal(sent.suppressed, true);
  assert.deepEqual({ ...sent, suppressed: original.suppressed }, original);
  assert.equal(posted.payload.btType, 'BTFeatureDefinitionCall-1406');
  assert.equal(posted.payload.sourceMicroversion, FEATURE_LIST_BEFORE_SUPPRESS.sourceMicroversion);
});

test('a sketch already in the requested state is answered without a write', async () => {
  const routes = suppressionHarness({ capabilities: undefined, suppressed: true });
  const { response } = await run(routes, {
    method: 'POST',
    pathname: '/api/suppress',
    req: jsonRequest({ context: CONTEXT, itemId: NATIVE_ITEM_ID, suppressed: true, confirm: true })
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.changed, false);
  assert.equal(response.body.backupFile, null);
  assert.ok(!routes.calls.includes('updateFeature'));
  assert.ok(!routes.calls.includes('writeBackup'));
});

// Nothing is written on this path, so a read that fails afterward must not
// turn into a 500. handleSuppress's own write path already treats a failed
// re-read as a stale list to report rather than an error to raise; this path
// has to make the same call.
test('a sketch already in the requested state still answers 200 when the refresh read fails', async () => {
  const document = suppressionDocument({ suppressed: true });
  const routes = harness({
    capabilities: undefined,
    loadImageItem: async (context, itemId) => {
      const item = document.items.find((candidate) => candidate.id === itemId);
      if (!item) throw Object.assign(new Error('gone'), { status: 409 });
      return { featureList: document.featureList, item };
    },
    loadImageItems: async () => { throw new Error('Onshape is unreachable'); }
  });
  const { response, error } = await run(routes, {
    method: 'POST',
    pathname: '/api/suppress',
    req: jsonRequest({ context: CONTEXT, itemId: NATIVE_ITEM_ID, suppressed: true, confirm: true })
  });
  assert.equal(error, undefined);
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.changed, false);
  assert.equal(response.body.itemsStale, true);
  assert.deepEqual(response.body.items, []);
  assert.equal(response.body.item.id, NATIVE_ITEM_ID);
  assert.ok(!routes.calls.includes('updateFeature'));
  assert.ok(!routes.calls.includes('writeBackup'));
});

test('a non-OK status fails a suppress and only warns on an unsuppress', async () => {
  const failing = {
    updateFeature: async () => ({ ...ADD_FEATURE_RESPONSE, featureState: { featureStatus: 'ERROR', inactive: false } })
  };

  const suppressing = suppressionHarness({ capabilities: undefined, api: failing });
  const { error } = await run(suppressing, {
    method: 'POST',
    pathname: '/api/suppress',
    req: jsonRequest({ context: CONTEXT, itemId: NATIVE_ITEM_ID, suppressed: true, confirm: true })
  });
  assert.equal(error.status, 409);
  assert.equal(error.code, 'FEATURE_STATUS_NOT_OK');
  assert.equal(error.expose.featureStatus, 'ERROR');
  assert.equal(error.expose.backupFile, 'backup.json');

  // E5 unsuppressed a feature that was already broken and got ERROR back for a
  // fault that pre-dated the request. The flip is stored either way, so this
  // is reported as a warning rather than as a failed write.
  const unsuppressing = suppressionHarness({ capabilities: undefined, suppressed: true, api: failing });
  const { response } = await run(unsuppressing, {
    method: 'POST',
    pathname: '/api/suppress',
    req: jsonRequest({ context: CONTEXT, itemId: NATIVE_ITEM_ID, suppressed: false, confirm: true })
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.changed, true);
  assert.equal(response.body.featureStatus, 'ERROR');
  assert.match(response.body.warning, /visible again/);
});

test('a read-only version context refuses suppression', async () => {
  const routes = suppressionHarness({ capabilities: undefined });
  const { error } = await run(routes, {
    method: 'POST',
    pathname: '/api/suppress',
    req: jsonRequest({
      context: { ...CONTEXT, workspaceOrVersion: 'v' },
      itemId: NATIVE_ITEM_ID,
      suppressed: true,
      confirm: true
    })
  });
  assert.equal(error.status, 409);
  assert.equal(error.code, 'CONTEXT_READ_ONLY');
  assert.deepEqual(routes.calls, []);
});

// ---------------------------------------------------------------------------
// POST /api/preview and POST /api/apply
//
// Apply is the write the whole product exists to make, and it was the one
// write whose body lived in server.mjs's dispatch chain — with its own copy of
// the 403-evidence rule and its own requireFeature call. The cases below pin
// what the move had to preserve: the order the gates run in, and that the
// evidence rule is now the shared one.
// ---------------------------------------------------------------------------

const APPLY_FEATURE_ID = 'FycByd6CdezIhLo_0';
const APPLY_ITEM_ID = `custom:${APPLY_FEATURE_ID}`;

// A Part Studio holding one calibrated feature, scanned into an item exactly
// the way server.mjs's getFreshImageItems does it. Built from the real payload
// builder rather than hand-written, so an item shape the product cannot
// actually produce cannot pass these tests.
function calibratedDocument() {
  const feature = buildReferenceImageFeature({
    featureStudio: { id: FEATURE_STUDIO_ID, microversionId: FEATURE_STUDIO_MICROVERSION },
    image: { elementId: BLOB_A.elementId, microversionId: BLOB_A.microversionId }
  });
  feature.featureId = APPLY_FEATURE_ID;
  const featureList = { ...structuredClone(FEATURE_LIST_BEFORE_ADD), features: [feature] };
  return { featureList, items: scanFeatureList(featureList, CONTEXT, { enableNativeImageWrite: false }) };
}

function applyHarness(options = {}) {
  return harness({
    loadImageItems: async () => calibratedDocument(),
    loadImageItem: async (context, itemId) => {
      const { featureList, items } = calibratedDocument();
      return { featureList, item: items.find((candidate) => candidate.id === itemId) };
    },
    ...options
  });
}

// Six inches across a 600px span of a 1000px-wide image: the same numbers
// scripts/smoke.mjs drives the real server with, so a placement solved here
// and one solved end to end are comparable by eye.
function calibrationBody(extra = {}) {
  return {
    context: CONTEXT,
    itemId: APPLY_ITEM_ID,
    imageSize: { width: 1000, height: 500 },
    scalePair: { a: { x: 100, y: 250 }, b: { x: 700, y: 250 } },
    trueDistanceMeters: 0.1524,
    anchor: 'scale-a',
    ...extra
  };
}

test('apply refuses a key with no write scope before a single Onshape call', async () => {
  const routes = applyHarness({ capabilities: NO_WRITE_SCOPE });
  const { error } = await run(routes, {
    method: 'POST',
    pathname: '/api/apply',
    req: jsonRequest(calibrationBody({ confirm: true }))
  });
  assert.equal(error.status, 403);
  assert.equal(error.code, 'CAPABILITY_DENIED');
  assert.equal(error.feature, 'updateFeature');
  assert.match(error.reason, /Key lacks write scope/);
  assert.deepEqual(routes.calls, []);
});

test('no policy switch turns apply off: the key scope and the confirmation are its whole gate', async () => {
  // updateFeature carries policyKey: null in src/capabilities.mjs, so every
  // operator toggle is irrelevant to it — writing calibrated values is what
  // this server is for, and switching it off would be switching the product
  // off. Pinned here because a switch that silently did nothing would look
  // exactly like a switch that worked.
  assert.equal(FEATURES.updateFeature.policyKey, null);
  const routes = applyHarness({
    capabilities: undefined,
    policy: { allowFeatureInstall: false, allowImageUpload: false, allowSuppression: false }
  });
  const { response } = await run(routes, {
    method: 'POST',
    pathname: '/api/apply',
    req: jsonRequest(calibrationBody({ confirm: true }))
  });
  assert.equal(response.status, 200);
});

test('apply asks for a confirmation with the same code and status the other writes send', async () => {
  const routes = applyHarness({ capabilities: undefined });
  const { error } = await run(routes, {
    method: 'POST',
    pathname: '/api/apply',
    req: jsonRequest(calibrationBody())
  });
  assert.equal(error.status, 409);
  assert.equal(error.code, 'CONFIRM_REQUIRED');
  assert.deepEqual(routes.calls, [], 'an unconfirmed apply must not read or write anything');
});

test('apply takes the operator at their word once confirmBeforeWrite is off', async () => {
  const routes = applyHarness({ capabilities: undefined, policy: { confirmBeforeWrite: false } });
  const { response } = await run(routes, {
    method: 'POST',
    pathname: '/api/apply',
    req: jsonRequest(calibrationBody())
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
});

test('apply refuses a read-only version link through the shared workspace gate', async () => {
  const routes = applyHarness({ capabilities: undefined });
  const { error } = await run(routes, {
    method: 'POST',
    pathname: '/api/apply',
    req: jsonRequest(calibrationBody({ context: { ...CONTEXT, workspaceOrVersion: 'v' }, confirm: true }))
  });
  assert.equal(error.status, 409);
  assert.equal(error.code, 'CONTEXT_READ_ONLY');
  assert.deepEqual(routes.calls, []);
});

test('apply checks the context before the capability, so a request wrong in both ways names the context', async () => {
  // Pins the order scripts/smoke.mjs depends on: its context cases run against
  // a server that would also refuse them for want of a confirmation, and they
  // expect the context refusal. Reordering these gates would change what a
  // real client is told without changing any single gate.
  const routes = applyHarness({ capabilities: NO_WRITE_SCOPE });
  const { error } = await run(routes, {
    method: 'POST',
    pathname: '/api/apply',
    req: jsonRequest(calibrationBody({ context: {} }))
  });
  assert.equal(error.status, 400);
  assert.equal(error.code, 'CONTEXT_REQUIRED');
});

test('apply backs the feature up before it writes, and names the backup in its answer', async () => {
  const routes = applyHarness({ capabilities: undefined });
  const { response } = await run(routes, {
    method: 'POST',
    pathname: '/api/apply',
    req: jsonRequest(calibrationBody({ confirm: true }))
  });
  assert.equal(response.status, 200);
  assert.ok(
    routes.calls.indexOf('writeBackup') < routes.calls.indexOf('updateFeature'),
    'the backup has to exist before the write it is a backup of'
  );
  assert.equal(response.body.backupFile, 'backup.json');
  assert.equal(routes.backups[0].operation, undefined, 'apply leaves writeBackup its default operation');
  // Six inches across 600 of 1000 pixels.
  assert.ok(Math.abs(response.body.calibration.placement.width - 0.254) < 1e-12);
});

test('apply believes featureStatus over HTTP 200, and still names the backup', async () => {
  const routes = applyHarness({ capabilities: undefined, featureStatus: 'ERROR' });
  const { error } = await run(routes, {
    method: 'POST',
    pathname: '/api/apply',
    req: jsonRequest(calibrationBody({ confirm: true }))
  });
  assert.equal(error.status, 409);
  assert.equal(error.code, 'FEATURE_STATUS_NOT_OK');
  assert.equal(error.expose.featureStatus, 'ERROR');
  assert.equal(error.expose.backupFile, 'backup.json');
});

test('apply records a 403 from Onshape against the session through the shared evidence path', async () => {
  // The finding this move exists to close: apply used to carry its own copy of
  // this rule in server.mjs, so a change to withEvidence reached four writes
  // and left the fifth behind.
  const session = {};
  const routes = applyHarness({
    capabilities: undefined,
    api: { updateFeature: async () => { throw new OnshapeApiError('forbidden', { status: 403 }); } }
  });
  const { error } = await run(routes, {
    method: 'POST',
    pathname: '/api/apply',
    req: jsonRequest(calibrationBody({ confirm: true })),
    session
  });
  assert.equal(error.status, 403);
  assert.equal(session.capabilityEvidence.updateFeature.status, 403);
  assert.equal(session.capabilityEvidence.updateFeature.generation, 1);
});

test('a later successful apply retires the recorded 403', async () => {
  const session = { capabilityEvidence: { updateFeature: { status: 403, at: 1, generation: 1 } } };
  const routes = applyHarness({ capabilities: undefined });
  const { response } = await run(routes, {
    method: 'POST',
    pathname: '/api/apply',
    req: jsonRequest(calibrationBody({ confirm: true })),
    session
  });
  assert.equal(response.status, 200);
  assert.equal(session.capabilityEvidence.updateFeature, undefined);
});

test('apply refuses an item it cannot edit, naming the experiment when that is why', async () => {
  const routes = harness({
    capabilities: undefined,
    loadImageItems: async () => {
      const { featureList, items } = calibratedDocument();
      return { featureList, items: items.map((item) => ({ ...item, kind: 'native', editable: false })) };
    }
  });
  const { error } = await run(routes, {
    method: 'POST',
    pathname: '/api/apply',
    req: jsonRequest(calibrationBody({ confirm: true }))
  });
  assert.equal(error.status, 409);
  assert.match(error.message, /Native Insert image writes are disabled/);
  assert.equal(routes.calls.includes('updateFeature'), false);
});

test('preview solves without a capability, a confirmation, or a write', async () => {
  const routes = applyHarness({ capabilities: NO_WRITE_SCOPE });
  const { response } = await run(routes, {
    method: 'POST',
    pathname: '/api/preview',
    req: jsonRequest(calibrationBody())
  });
  assert.equal(response.status, 200);
  assert.ok(Math.abs(response.body.placement.width - 0.254) < 1e-12);
  assert.equal(routes.calls.includes('updateFeature'), false);
  assert.equal(routes.calls.includes('writeBackup'), false);
});

test('preview and apply solve the same request through the same normalizer', async () => {
  // The reason preview lives in this module rather than in the dispatcher: a
  // preview that normalized a request differently would show one placement and
  // store another, and nothing in the product would notice.
  const previewRoutes = applyHarness({ capabilities: undefined });
  const { response: preview } = await run(previewRoutes, {
    method: 'POST',
    pathname: '/api/preview',
    req: jsonRequest(calibrationBody())
  });
  const applyRoutes = applyHarness({ capabilities: undefined });
  const { response: applied } = await run(applyRoutes, {
    method: 'POST',
    pathname: '/api/apply',
    req: jsonRequest(calibrationBody({ confirm: true }))
  });
  assert.equal(preview.status, 200);
  assert.equal(applied.status, 200);
  assert.deepEqual(applied.body.calibration.placement, preview.body.placement);
  assert.ok(previewRoutes.calls.includes('normalizeCalibration'));
  assert.ok(applyRoutes.calls.includes('normalizeCalibration'));
});
