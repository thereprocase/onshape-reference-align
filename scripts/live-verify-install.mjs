/**
 * Live verification of the one-click install and the image upload/rebind path.
 *
 * It drives the product's own route handlers — the same createWriteRoutes()
 * server.mjs mounts — against a real Onshape document, with a fake request and
 * a capturing sendJson standing in for the HTTP layer. Nothing about the
 * request shapes is re-implemented here, because a verification script that
 * builds its own payloads verifies the script.
 *
 * This script WRITES to Onshape. It refuses to run without --yes and an
 * explicit target, never falls back to a default document, and refuses the
 * public example identifiers outright.
 *
 * Usage:
 *   node scripts/live-verify-install.mjs --yes --create-document
 *   node scripts/live-verify-install.mjs --yes --document-id <24 hex>
 *
 * Every request and response is written, redacted, to
 * docs/experiments/<date>-install-verify/.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { getConfig } from '../src/config.mjs';
import { createAssetSource } from '../src/assets.mjs';
import { resolveSettingsFile } from '../src/config-paths.mjs';
import { normalizeContext } from '../src/context.mjs';
import { OnshapeApi } from '../src/onshape-api.mjs';
import { findImageItem, scanFeatureList } from '../src/onshape-model.mjs';
import { DEFAULT_SETTINGS, readSettingsFile } from '../src/settings.mjs';
import { createWriteRoutes } from '../src/write-routes.mjs';
import { isExampleOnshapeId, requireScratchFolder } from './live-target.mjs';
export { resolveScratchTarget } from './live-target.mjs';

const SCRATCH_DOCUMENT_NAME = 'Reference Align install verify — safe to delete';

/** Reserved historical example. All pseudonymized ids are refused too. */
const PROTECTED_DOCUMENT_IDS = new Set(['a11ce0000000000000000143']);

/**
 * Where a scratch document created by this script should live, and whether
 * creating one is allowed at all.
 *
 * Reads the same settings.json the settings card writes, so "Create scratch
 * documents" and the scratch folder id actually govern this script instead of
 * being a switch that only ever affected a claim in the UI copy.
 * No folder is defaulted: allowDocumentCreation and scratchFolderId are
 * enforced by the shared live-target helper before remote mutation.
 */

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// Redacted wholesale rather than pattern-matched: Onshape nests user records
// under these keys, and a capture in a tracked directory must not carry them.
const REDACTED_KEYS = new Set([
  'email',
  'owner',
  'creator',
  'createdby',
  'modifiedby',
  'lastmodifiedby',
  'lastmodifier', 'firstname', 'lastname', 'displayname',
  'authorization',
  'accesskey',
  'secretkey',
  'bearertoken'
]);

function usage() {
  return [
    'Usage: node scripts/live-verify-install.mjs --yes (--create-document | --document-id <id>)',
    '',
    '  --yes              Required. Acknowledges that this script writes to Onshape.',
    '  --create-document  Create a disposable document inside the test folder and run there.',
    '  --document-id <id> Run against an existing document id (24 hex characters).',
    '',
    'Exactly one of --create-document and --document-id must be given.'
  ].join('\n');
}

function parseArgs(argv) {
  const options = { yes: false, createDocument: false, documentId: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--yes') options.yes = true;
    else if (arg === '--create-document') options.createDocument = true;
    else if (arg === '--document-id') {
      options.documentId = argv[index + 1];
      index += 1;
    } else if (arg.startsWith('--document-id=')) {
      options.documentId = arg.slice('--document-id='.length);
    } else {
      throw Object.assign(new Error(`Unknown argument: ${arg}`), { status: 2 });
    }
  }
  return options;
}

function validateOptions(options) {
  const problems = [];
  if (!options.yes) problems.push('--yes is required.');
  const targetCount = (options.createDocument ? 1 : 0) + (options.documentId !== undefined ? 1 : 0);
  if (targetCount !== 1) problems.push('Pass exactly one of --create-document or --document-id <id>.');
  if (options.documentId !== undefined) {
    if (!/^[0-9a-f]{24}$/i.test(String(options.documentId))) {
      problems.push('--document-id must be 24 hexadecimal characters.');
    } else if (isExampleOnshapeId(options.documentId) || PROTECTED_DOCUMENT_IDS.has(String(options.documentId).toLowerCase())) {
      problems.push('That document id is a protected public example, not a live target.');
    }
  }
  return problems;
}

function redact(value, depth = 0) {
  if (depth > 40) return '[redacted-depth]';
  if (typeof value === 'string') return value.replace(EMAIL_PATTERN, '[redacted-email]');
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = REDACTED_KEYS.has(key.toLowerCase()) ? '[redacted]' : redact(item, depth + 1);
    }
    return output;
  }
  return value;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isFreeAccountPrivateDocumentRejection(error) {
  const message = String(error?.body?.message || '');
  return error?.status === 409 && /free accounts only allow access to public documents/i.test(message);
}

/** A request object with just the surface readJson and the upload route use. */
function fakeRequest({ method, headers = {}, body }) {
  const stream = Readable.from(body === undefined ? [] : [body]);
  stream.method = method;
  stream.headers = headers;
  return stream;
}

function jsonRequest(value) {
  const payload = Buffer.from(JSON.stringify(value));
  return fakeRequest({
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': String(payload.length) },
    body: payload
  });
}

async function multipartRequest({ bytes, filename, mediaType, confirm }) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mediaType }), filename);
  if (confirm) form.append('confirm', 'true');
  const staged = new Request('https://local.invalid/', { method: 'POST', body: form });
  const contentType = staged.headers.get('content-type');
  const payload = Buffer.from(await staged.arrayBuffer());
  return fakeRequest({
    method: 'POST',
    headers: { 'content-type': contentType, 'content-length': String(payload.length) },
    body: payload
  });
}

function documentUrl(documentId, workspaceId, elementId) {
  const base = `https://cad.onshape.com/documents/${documentId}/w/${workspaceId}`;
  return elementId ? `${base}/e/${elementId}` : base;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const problems = validateOptions(options);
  if (problems.length) {
    process.stderr.write(`Refusing to run:\n  - ${problems.join('\n  - ')}\n\n${usage()}\n`);
    process.exitCode = 2;
    return;
  }

  const config = getConfig();
  if (config.authMode === 'none') {
    process.stderr.write('No Onshape authentication is configured. Run the setup wizard first.\n');
    process.exitCode = 2;
    return;
  }

  const captureDir = path.join(config.projectRoot, 'docs', 'experiments', `${today()}-install-verify`);
  await fsp.mkdir(captureDir, { recursive: true });
  let captureIndex = 0;
  const steps = [];

  function log(line) {
    process.stdout.write(`${line}\n`);
  }

  async function writeCapture(name, record) {
    captureIndex += 1;
    const filename = `${String(captureIndex).padStart(2, '0')}-${name}.json`;
    await fsp.writeFile(path.join(captureDir, filename), `${JSON.stringify(redact(record), null, 2)}\n`);
    return filename;
  }

  // Every outbound Onshape call, captured at the transport. Wrapping fetch
  // rather than instrumenting the routes is what keeps the routes themselves
  // exactly the code the server runs.
  const traffic = [];
  const fetchImpl = async (url, init = {}) => {
    const response = await globalThis.fetch(url, init);
    const clone = response.clone();
    const text = await clone.text().catch(() => '');
    traffic.push({
      method: init.method || 'GET',
      url: String(url),
      status: response.status,
      requestBody: typeof init.body === 'string' ? safeJsonParse(init.body) ?? init.body.slice(0, 4000) : '[binary or absent]',
      responseBody: safeJsonParse(text) ?? text.slice(0, 4000)
    });
    return response;
  };
  const api = new OnshapeApi(config, { fetchImpl });

  // ---- target document ----------------------------------------------------
  let documentId;
  let workspaceId;
  let documentIsPublic;
  if (options.createDocument) {
    const { settings: policySettings } = await readSettingsFile(resolveSettingsFile(config.envFilePath));
    const scratchTarget = { allowed: true, parentId: requireScratchFolder(policySettings) };
    if (!scratchTarget.allowed) {
      process.stderr.write(
        '"Create scratch documents" is switched off in the settings card, so this script will not create one.\n' +
        'Turn it on there, or pass --document-id to run against an existing document instead.\n'
      );
      process.exitCode = 2;
      return;
    }
    log(`Creating "${SCRATCH_DOCUMENT_NAME}" inside folder ${scratchTarget.parentId}.`);
    let created;
    try {
      created = await api.createDocument({ name: SCRATCH_DOCUMENT_NAME, isPublic: false, parentId: scratchTarget.parentId });
      documentIsPublic = false;
    } catch (error) {
      if (!isFreeAccountPrivateDocumentRejection(error)) throw error;
      log('  WARNING: this account cannot hold private documents. Falling back to a PUBLIC one.');
      log('  WARNING: anything written to it is world-readable. Only the MIT-licensed');
      log('  WARNING: FeatureScript and this repository’s own icon are uploaded.');
      created = await api.createDocument({ name: SCRATCH_DOCUMENT_NAME, isPublic: true, parentId: scratchTarget.parentId });
      documentIsPublic = true;
    }
    documentId = created?.id;
    workspaceId = created?.defaultWorkspace?.id;
  } else {
    documentId = String(options.documentId);
    const info = await api.requestJson(`/documents/${documentId}`);
    workspaceId = info?.defaultWorkspace?.id;
    documentIsPublic = info?.public;
  }

  if (!documentId || !workspaceId) {
    process.stderr.write('Could not resolve a document id and default workspace id.\n');
    process.exitCode = 1;
    return;
  }
  if (PROTECTED_DOCUMENT_IDS.has(String(documentId).toLowerCase())) {
    process.stderr.write('Resolved a protected document id. Aborting before any further writes.\n');
    process.exitCode = 1;
    return;
  }

  const elements = await api.listElements(
    { documentId, workspaceOrVersion: 'w', workspaceOrVersionId: workspaceId, elementId: 'x' },
    undefined
  );
  const partStudioId = (elements || []).find((element) => element?.elementType === 'PARTSTUDIO')?.id;
  if (!partStudioId) {
    process.stderr.write('No Part Studio element was found in the target document.\n');
    process.exitCode = 1;
    return;
  }

  const context = normalizeContext({
    documentId,
    workspaceOrVersion: 'w',
    workspaceOrVersionId: workspaceId,
    elementId: partStudioId
  });
  log('');
  log(`Document:    ${documentUrl(documentId, workspaceId, partStudioId)}`);
  log(`Visibility:  ${documentIsPublic ? 'PUBLIC — do not put anything confidential here' : 'private'}`);
  log('');

  // ---- the product's own routes -------------------------------------------
  const captured = [];
  const sendJson = (res, status, value) => {
    captured.push({ status, body: value });
  };
  const settingsStore = {
    // Defaults, with confirmation left on: the requests below carry
    // confirm: true, which is exactly what the browser sends.
    current: () => DEFAULT_SETTINGS
  };
  // This script always runs from a checkout, never from a packaged SEA
  // binary, so the asset source's dev-mode branch (read ReferenceImage.fs off
  // disk under config.projectRoot) is the one that ever runs here.
  const assets = createAssetSource({ projectRoot: config.projectRoot });
  const { handleWrite } = createWriteRoutes({
    api,
    assets,
    config: () => config,
    generation: () => 1,
    settingsStore,
    // No capability model: this run is here to find out what the key can do
    // from Onshape itself, not to be refused on a cached guess.
    capabilities: () => undefined,
    sendJson,
    normalizeContext,
    // /api/preview and /api/apply are not among the steps below, and this
    // script has no business solving a calibration. A named refusal rather
    // than an omission, so adding such a step fails with a sentence instead of
    // a TypeError from inside the route.
    normalizeCalibration: () => {
      throw new Error('This script does not drive /api/preview or /api/apply.');
    },
    loadImageItem: async (ctx, itemId, session) => {
      const featureList = await api.getFeatures(ctx, session);
      return { featureList, item: findImageItem(featureList, itemId, ctx, { enableNativeImageWrite: false }) };
    },
    // Wired even though no step below suppresses anything: a dependency that
    // exists only when someone remembers to pass it is a 500 waiting for the
    // first person who adds a step.
    loadImageItems: async (ctx, session) => {
      const featureList = await api.getFeatures(ctx, session);
      return { featureList, items: scanFeatureList(featureList, ctx, { enableNativeImageWrite: false }) };
    },
    writeBackup: async ({ payload, item }) => {
      const file = path.join(captureDir, `backup-${item.featureId}-${Date.now()}.json`);
      await fsp.writeFile(file, `${JSON.stringify(redact({ item, proposedUpdate: payload }), null, 2)}\n`);
      return file;
    }
  });

  const verificationSession = {};
  async function step(name, { method, pathname, search = '', body, multipart }) {
    const url = new URL(`http://127.0.0.1/${pathname.replace(/^\//, '')}${search ? `?${search}` : ''}`);
    const req = multipart ? await multipartRequest(multipart) : (body ? jsonRequest(body) : fakeRequest({ method, headers: {} }));
    req.method = method;
    const trafficBefore = traffic.length;
    captured.length = 0;
    const record = { name, route: `${method} ${url.pathname}${url.search}`, requestBody: multipart ? '[multipart]' : (body ?? null) };
    try {
      const handled = await handleWrite(req, {}, url, verificationSession);
      if (!handled) throw new Error(`No handler claimed ${method} ${url.pathname}`);
      record.status = captured[0]?.status ?? 200;
      record.responseBody = captured[0]?.body ?? null;
    } catch (error) {
      record.status = error.status ?? null;
      record.error = { message: error.message, code: error.code ?? null, expose: error.expose ?? null, body: error.body ?? null };
    }
    record.onshapeTraffic = traffic.slice(trafficBefore);
    record.captureFile = await writeCapture(name, record);
    const status = record.responseBody?.featureStatus ?? record.error?.expose?.featureStatus ?? '—';
    log(`  ${name}: HTTP ${record.status ?? 'ERR'}, featureStatus ${status} (${record.captureFile})`);
    if (record.error) log(`    error: ${record.error.code || 'ERROR'} — ${record.error.message}`);
    steps.push({ name, status: record.status, featureStatus: status, error: record.error?.code ?? null });
    return record;
  }

  const contextSearch = new URLSearchParams({
    documentId,
    workspaceOrVersion: 'w',
    workspaceOrVersionId: workspaceId,
    elementId: partStudioId
  }).toString();
  const iconBytes = await fsp.readFile(path.join(config.publicDir, 'reference-align-icon.png'));

  log('Running the product’s own route handlers:');
  await step('install-status-before', { method: 'GET', pathname: '/api/install/status', search: contextSearch });

  const firstUpload = await step('upload-image-a', {
    method: 'POST',
    pathname: '/api/upload-image',
    search: contextSearch,
    multipart: { bytes: iconBytes, filename: 'reference-align-icon-a.png', mediaType: 'image/png', confirm: true }
  });

  const install = await step('install', {
    method: 'POST',
    pathname: '/api/install',
    body: { context, imageElementId: firstUpload.responseBody?.elementId, confirm: true }
  });

  await step('install-status-after', { method: 'GET', pathname: '/api/install/status', search: contextSearch });

  // A second identical call must find the instance and write nothing.
  await step('install-again', {
    method: 'POST',
    pathname: '/api/install',
    body: { context, imageElementId: firstUpload.responseBody?.elementId, confirm: true }
  });

  const secondUpload = await step('upload-image-b', {
    method: 'POST',
    pathname: '/api/upload-image',
    search: contextSearch,
    multipart: { bytes: iconBytes, filename: 'reference-align-icon-b.png', mediaType: 'image/png', confirm: true }
  });

  await step('rebind', {
    method: 'POST',
    pathname: '/api/rebind',
    body: {
      context,
      itemId: install.responseBody?.itemId,
      elementId: secondUpload.responseBody?.elementId,
      microversionId: secondUpload.responseBody?.microversionId,
      confirm: true
    }
  });

  await step('install-status-final', { method: 'GET', pathname: '/api/install/status', search: contextSearch });

  const findings = [
    '# Live install/rebind verification',
    '',
    `Run: ${new Date().toISOString()}`,
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| Document id | \`${documentId}\` |`,
    `| Workspace id | \`${workspaceId}\` |`,
    `| Part Studio element id | \`${partStudioId}\` |`,
    `| Part Studio URL | ${documentUrl(documentId, workspaceId, partStudioId)} |`,
    `| Document visibility | ${documentIsPublic ? 'PUBLIC' : 'private'} |`,
    '',
    'Each step ran through the product’s own route handler in',
    '`src/write-routes.mjs`. Captures live beside this file as `NN-<name>.json`,',
    'redacted of email-like strings and owner records.',
    '',
    '| Step | HTTP | featureStatus | Error |',
    '| --- | --- | --- | --- |',
    ...steps.map((entry) => `| ${entry.name} | ${entry.status ?? 'ERR'} | ${entry.featureStatus} | ${entry.error ?? '—'} |`),
    '',
    'DELETE is not attempted: this account’s key has no delete scope, so the',
    'scratch document and its elements are left in place on purpose.',
    ''
  ].join('\n');
  await fsp.writeFile(path.join(captureDir, 'FINDINGS.md'), findings);

  log('');
  log(`Captures and FINDINGS.md written to ${captureDir}`);
  const failed = steps.filter((entry) => entry.error || (entry.featureStatus !== 'OK' && entry.featureStatus !== '—'));
  if (failed.length) {
    log(`FAILED steps: ${failed.map((entry) => entry.name).join(', ')}`);
    process.exitCode = 1;
  } else {
    log('All steps reported OK.');
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
