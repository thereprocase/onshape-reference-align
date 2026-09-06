/**
 * Live verification that POST /api/apply now believes featureState.featureStatus
 * instead of the HTTP status code.
 *
 * Before this fix, server.mjs sent the placement update to Onshape and
 * answered `ok: true` with whatever featureState the response carried,
 * without ever inspecting it. FINDINGS.md (E4 of the write-shape experiment)
 * documents HTTP 200 with featureStatus ERROR for a feature whose image
 * namespace does not resolve — exactly the shape that would have been
 * reported as a success.
 *
 * This script re-sends a target feature's own current placement unchanged
 * (a no-op resize) through the same three calls the route makes —
 * api.getFeatures, prepareImageFeatureUpdate, api.updateFeature — and prints
 * what readFeatureStatus() makes of the real response, which is exactly the
 * function server.mjs's POST /api/apply now calls before answering.
 *
 * It does not drive server.mjs's HTTP layer or touch the running dev server:
 * it calls the same src/ functions directly against a real document, the
 * way scripts/live-verify-install.mjs and scripts/live-verify-suppress.mjs
 * do.
 *
 * This script WRITES to Onshape (it re-applies the feature's own current
 * placement). It refuses to run without --yes and an explicit target, never
 * falls back to a default document, and refuses public example identifiers.
 *
 * Usage:
 *   node scripts/live-verify-apply-status.mjs --yes \
 *     --document-id <24 hex> --element-id <24 hex Part Studio> --item-id <itemId>
 *
 * Example, against the scratch feature already left in ERROR state on
 * purpose (see docs/experiments/2026-09-04-bind-experiment/FINDINGS.md and
 * the project handoff notes):
 *   node scripts/live-verify-apply-status.mjs --yes \
 *     --document-id a11ce0000000000000000039 \
 *     --element-id a11ce0000000000000000027 \
 *     --item-id custom:FycByd6CdezIhLo_0
 *
 * Every request and response is written, redacted, to
 * docs/experiments/<date>-apply-status-verify/.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';

import { getConfig } from '../src/config.mjs';
import { normalizeContext } from '../src/context.mjs';
import { OnshapeApi } from '../src/onshape-api.mjs';
import { isExampleOnshapeId } from './live-target.mjs';
import { prepareImageFeatureUpdate, readFeatureStatus, scanFeatureList } from '../src/onshape-model.mjs';

/** Reserved historical example. All pseudonymized ids are refused too. */
const PROTECTED_DOCUMENT_IDS = new Set(['a11ce0000000000000000143']);

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
    'Usage: node scripts/live-verify-apply-status.mjs --yes',
    '         --document-id <24 hex> --element-id <24 hex Part Studio> --item-id <itemId>',
    '',
    '  --yes           Required. Acknowledges that this script writes to Onshape',
    '                  (it re-applies the target feature\'s own current placement).',
    '  --document-id   Required. The document to run against. Never defaulted.',
    '  --element-id    Required. The Part Studio element id.',
    '  --item-id       Required. The item id from GET /api/context, e.g. custom:<featureId>.',
    '                  Only a "custom" (calibrated) item can be re-applied this way.'
  ].join('\n');
}

function parseArgs(argv) {
  const options = { yes: false, documentId: undefined, elementId: undefined, itemId: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--yes') options.yes = true;
    else if (arg === '--document-id') options.documentId = argv[++index];
    else if (arg === '--element-id') options.elementId = argv[++index];
    else if (arg === '--item-id') options.itemId = argv[++index];
    else if (arg.startsWith('--document-id=')) options.documentId = arg.slice('--document-id='.length);
    else if (arg.startsWith('--element-id=')) options.elementId = arg.slice('--element-id='.length);
    else if (arg.startsWith('--item-id=')) options.itemId = arg.slice('--item-id='.length);
    else throw Object.assign(new Error(`Unknown argument: ${arg}`), { status: 2 });
  }
  return options;
}

function validateOptions(options) {
  const problems = [];
  if (!options.yes) problems.push('--yes is required.');
  if (!options.documentId) problems.push('--document-id is required.');
  else if (!/^[0-9a-f]{24}$/i.test(String(options.documentId))) problems.push('--document-id must be 24 hexadecimal characters.');
  else if (isExampleOnshapeId(options.documentId) || PROTECTED_DOCUMENT_IDS.has(String(options.documentId).toLowerCase())) problems.push('That document id is protected or a public example, not a live target.');
  if (!options.elementId) problems.push('--element-id is required.');
  else if (!/^[0-9a-f]{24}$/i.test(String(options.elementId))) problems.push('--element-id must be 24 hexadecimal characters.');
  if (!options.itemId) problems.push('--item-id is required.');
  else if (!options.itemId.startsWith('custom:')) problems.push('--item-id must be a "custom:" item — only a calibrated feature can be re-applied this way.');
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

  const captureDir = path.join(config.projectRoot, 'docs', 'experiments', `${today()}-apply-status-verify`);
  await fsp.mkdir(captureDir, { recursive: true });
  let captureIndex = 0;

  function log(line) {
    process.stdout.write(`${line}\n`);
  }

  async function writeCapture(name, record) {
    captureIndex += 1;
    const filename = `${String(captureIndex).padStart(2, '0')}-${name}.json`;
    await fsp.writeFile(path.join(captureDir, filename), `${JSON.stringify(redact(record), null, 2)}\n`);
    return filename;
  }

  // Every outbound Onshape call, captured at the transport, exactly as the
  // other live-verify scripts do: wrapping fetch rather than instrumenting
  // the routes is what keeps the code under test the code the server runs.
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

  const documentId = String(options.documentId);
  const info = await api.requestJson(`/documents/${documentId}`);
  const workspaceId = info?.defaultWorkspace?.id;
  if (!workspaceId) {
    process.stderr.write('Could not resolve the document\'s default workspace id.\n');
    process.exitCode = 1;
    return;
  }
  if (PROTECTED_DOCUMENT_IDS.has(String(documentId).toLowerCase())) {
    process.stderr.write('Resolved a protected document id. Aborting before any further writes.\n');
    process.exitCode = 1;
    return;
  }

  const context = normalizeContext({
    documentId,
    workspaceOrVersion: 'w',
    workspaceOrVersionId: workspaceId,
    elementId: options.elementId
  });

  log('');
  log(`Document:    https://cad.onshape.com/documents/${documentId}/w/${workspaceId}/e/${options.elementId}`);
  log(`Target item: ${options.itemId}`);
  log('');

  const featureListBefore = await api.getFeatures(context);
  const items = scanFeatureList(featureListBefore, context, { enableNativeImageWrite: false });
  const item = items.find((candidate) => candidate.id === options.itemId);
  if (!item) {
    process.stderr.write(`No item with id ${options.itemId} was found in this Part Studio's current feature list.\n`);
    process.exitCode = 1;
    return;
  }
  if (item.kind !== 'custom') {
    process.stderr.write(`Item ${options.itemId} is a "${item.kind}" item; only a "custom" (calibrated) item can be re-applied this way.\n`);
    process.exitCode = 1;
    return;
  }
  if (!item.placement) {
    process.stderr.write('The feature\'s placement could not be evaluated (it likely uses expressions), so there is nothing to re-apply unchanged.\n');
    process.exitCode = 1;
    return;
  }

  await writeCapture('before', { item, featureStateBefore: featureListBefore.features?.find((f) => f.featureId === item.featureId)?.featureState ?? null });

  // The smallest legitimate write: the feature's own current placement,
  // unchanged. This script exists to observe featureStatus, not to test
  // calibration math, which is covered elsewhere.
  const update = prepareImageFeatureUpdate(featureListBefore, item, item.placement, { removeImageConstraints: false });

  log('Re-applying the feature\'s own current placement (a no-op resize)...');
  const response = await api.updateFeature(context, item.featureId, update.payload);
  const status = readFeatureStatus(response);
  const captureFile = await writeCapture('after', { proposedUpdate: update.payload, response, readFeatureStatus: status });

  log('');
  log(`featureState.featureStatus from Onshape: ${status.status}`);
  log(`readFeatureStatus().ok:                  ${status.ok}`);
  log('');
  if (status.ok) {
    log('This feature came back OK. server.mjs\'s POST /api/apply would answer 200 ok:true here,');
    log('which was always the correct answer for this response — the fix only changes behaviour');
    log('when featureStatus is NOT OK. To see the refusal path exercised live, point this script');
    log('at a feature already known to be broken (see the FEATURE_MARKER note in the module');
    log('docstring and the project\'s scratch-feature notes).');
  } else {
    log('This feature came back NOT OK. Before this fix, server.mjs would have answered 200');
    log('ok:true anyway, reporting a broken write as a success. With the fix in place, the same');
    log('response now makes POST /api/apply answer 409 FEATURE_STATUS_NOT_OK, naming this');
    log('featureStatus and the backup file written just before the write.');
  }
  log('');
  log(`Full request/response capture: ${path.join(captureDir, captureFile)}`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
