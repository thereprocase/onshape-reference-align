/**
 * Phase 0 write-shape experiment.
 *
 * Establishes, against a disposable Onshape document, the request/response
 * shapes that later phases depend on: blob upload, Feature Studio creation,
 * adding a custom feature instance, rebinding a feature's image namespace, and
 * suppressing a feature. Every request and response is captured to disk so that
 * later phases can build test fixtures from real traffic instead of guesses.
 *
 * This script mutates Onshape documents. It refuses to run without --yes and an
 * explicit target, and it never falls back to a default document id.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';

import { getConfig } from '../src/config.mjs';
import { OnshapeApi, encodeMultipartBody } from '../src/onshape-api.mjs';
import { featureUpdatePayload } from '../src/onshape-model.mjs';
import { resolveSettingsFile } from '../src/config-paths.mjs';
import { readSettingsFile } from '../src/settings.mjs';
import { isExampleOnshapeId, requireScratchFolder } from './live-target.mjs';

const SCRATCH_DOCUMENT_NAME = 'Reference Align scratch — safe to delete';
const CAPTURE_DIRNAME = path.join('docs', 'experiments', '2026-09-04-bind-experiment');
const FEATURE_STUDIO_NAME = 'Reference Align Features';

// Reserved historical example. All pseudonymized ids are refused too.
const PROTECTED_DOCUMENT_IDS = new Set(['a11ce0000000000000000143']);

// Captured from a working "Calibrated Reference Image" feature in a real
// document. The compressed query encodes the Top default plane.
const CAPTURED_TOP_PLANE_QUERY =
  'query=qCompressed(1.0,"%B5$QueryM4Sa$entityTypeBa$EntityTypeS4$FACESb$historyTypeS8$CREATIONSb$operationIdB2$IdA1S3.7$TopplaneOpS9$queryTypeS5$DUMMY",id);';
const CAPTURED_TOP_PLANE_DETERMINISTIC_ID = 'JDC';

const PLANE_FILTER = Object.freeze({
  btType: 'BTAndFilter-110',
  operand1: { btType: 'BTEntityTypeFilter-124', entityType: 'FACE' },
  operand2: { btType: 'BTGeometryFilter-130', geometryType: 'PLANE' }
});

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// Keys whose values may carry personal data or credentials. Redacted wholesale
// rather than pattern-matched, because Onshape nests user records under them.
const REDACTED_KEYS = new Set([
  'email',
  'owner',
  'createdby',
  'modifiedby',
  'lastmodifiedby',
  'creator', 'lastmodifier', 'firstname', 'lastname', 'displayname',
  'authorization',
  'accesskey',
  'secretkey'
]);

function usage() {
  return [
    'Usage: node scripts/experiment-bind.mjs --yes (--create-document | --document-id <id>)',
    '',
    '  --yes              Required. Acknowledges that this script writes to Onshape.',
    '  --create-document  Create a new disposable document and run there.',
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

function documentUrl(documentId, workspaceId, elementId) {
  const base = `https://cad.onshape.com/documents/${documentId}/w/${workspaceId}`;
  return elementId ? `${base}/e/${elementId}` : base;
}

function quantityParameter(parameterId, expression) {
  return {
    btType: 'BTMParameterQuantity-147',
    isInteger: false,
    value: 0,
    units: '',
    expression,
    parameterId
  };
}

function imageParameter(namespace) {
  return {
    btType: 'BTMParameterReferenceImage-2014',
    namespace,
    parameterId: 'image',
    elementLibraryData: null
  };
}

function planeParameter(queryString, deterministicIds) {
  const query = { btType: 'BTMIndividualQuery-138', queryStatement: null, queryString };
  if (deterministicIds !== undefined) query.deterministicIds = deterministicIds;
  return {
    btType: 'BTMParameterQueryList-148',
    queries: [query],
    filter: PLANE_FILTER,
    parameterId: 'plane'
  };
}

function referenceImageFeature({ name, featureNamespace, imageNamespace, plane }) {
  return {
    btType: 'BTMFeature-134',
    featureType: 'referenceImage',
    name,
    namespace: featureNamespace,
    parameters: [
      imageParameter(imageNamespace),
      plane,
      quantityParameter('imageWidth', '0.25 m'),
      quantityParameter('imageAngle', '0 deg'),
      quantityParameter('originX', '0 m'),
      quantityParameter('originY', '0 m')
    ]
  };
}

/**
 * The add-feature endpoint takes the same BTFeatureDefinitionCall-1406 wrapper
 * as the update endpoint, but a feature that does not exist yet has no
 * featureId, so featureUpdatePayload's guard cannot be reused here.
 */
function featureAddPayload(featureList, feature) {
  const payload = { btType: 'BTFeatureDefinitionCall-1406', feature };
  for (const key of ['serializationVersion', 'sourceMicroversion', 'libraryVersion', 'rejectMicroversionSkew']) {
    if (featureList?.[key] !== undefined) payload[key] = featureList[key];
  }
  if (payload.rejectMicroversionSkew === undefined) payload.rejectMicroversionSkew = false;
  return payload;
}

/**
 * Onshape Free plans cannot hold private documents at all, so a private-document
 * request is refused with a specific 409 rather than a permission error.
 */
function isFreeAccountPrivateDocumentRejection(result) {
  const message = String(result?.error?.body?.message || '');
  return result?.status === 409 && /free accounts only allow access to public documents/i.test(message);
}

function findParameter(feature, parameterId) {
  return (feature?.parameters || []).find((parameter) => parameter?.parameterId === parameterId);
}

function collectValueStrings(root, out = [], seen = new WeakSet()) {
  if (!root || typeof root !== 'object' || seen.has(root)) return out;
  seen.add(root);
  if (typeof root.btType === 'string' && root.btType.includes('ValueString') && typeof root.value === 'string') {
    out.push(root.value);
  }
  for (const value of Object.values(root)) collectValueStrings(value, out, seen);
  return out;
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
  const scratchFolderId = options.createDocument
    ? requireScratchFolder((await readSettingsFile(resolveSettingsFile(config.envFilePath))).settings)
    : null;
  if (config.authMode === 'none') {
    process.stderr.write('No Onshape authentication is configured. Set API keys in .env first.\n');
    process.exitCode = 2;
    return;
  }
  const api = new OnshapeApi(config);
  const captureDir = path.join(config.projectRoot, CAPTURE_DIRNAME);
  await fsp.mkdir(captureDir, { recursive: true });

  let captureIndex = 0;
  const findings = [];

  async function writeCapture(name, record) {
    captureIndex += 1;
    const filename = `${String(captureIndex).padStart(2, '0')}-${name}.json`;
    await fsp.writeFile(path.join(captureDir, filename), `${JSON.stringify(redact(record), null, 2)}\n`);
    return filename;
  }

  function log(line) {
    process.stdout.write(`${line}\n`);
  }

  async function call(name, requestPath, callOptions = {}) {
    const method = String(callOptions.method || 'GET').toUpperCase();
    const record = {
      name,
      method,
      path: requestPath,
      note: callOptions.note ?? null,
      requestBody: callOptions.body ?? null
    };
    let result;
    try {
      const response = await api.request(requestPath, {
        method,
        body: callOptions.body,
        rawBody: callOptions.rawBody,
        rawContentType: callOptions.rawContentType,
        accept: callOptions.accept
      });
      const text = await response.text();
      const parsed = text ? safeJsonParse(text) : undefined;
      record.status = response.status;
      record.responseBody = parsed !== undefined ? parsed : text.slice(0, 4000);
      result = { ok: true, status: response.status, data: parsed };
    } catch (error) {
      record.status = error.status ?? null;
      record.error = { message: error.message, body: error.body ?? null };
      result = { ok: false, status: error.status ?? null, error };
    }
    record.captureFile = await writeCapture(name, record);
    log(`  ${method} ${requestPath} -> ${record.status ?? 'ERR'} (${record.captureFile})`);
    return result;
  }

  // Exercises the product code path (OnshapeApi.updateFeature) rather than a
  // hand-built request, so the captures describe what the app actually sends.
  async function captureUpdateFeature(name, context, featureId, payload) {
    const record = {
      name,
      method: 'POST',
      path: `/partstudios/d/${context.documentId}/w/${context.workspaceOrVersionId}/e/${context.elementId}/features/featureid/${featureId}`,
      via: 'OnshapeApi.updateFeature',
      requestBody: payload
    };
    let result;
    try {
      const data = await api.updateFeature(context, featureId, payload);
      record.status = 200;
      record.responseBody = data ?? null;
      result = { ok: true, data };
    } catch (error) {
      record.status = error.status ?? null;
      record.error = { message: error.message, body: error.body ?? null };
      result = { ok: false, status: error.status ?? null, error };
    }
    record.captureFile = await writeCapture(name, record);
    log(`  POST ${record.path} -> ${record.status ?? 'ERR'} (${record.captureFile})`);
    return result;
  }

  // ---- target document -----------------------------------------------------
  let documentId;
  let workspaceId;
  let documentIsPublic;
  if (options.createDocument) {
    log(`Creating a new Onshape document named "${SCRATCH_DOCUMENT_NAME}".`);
    let created = await call('create-document-private', '/documents', {
      method: 'POST',
      body: { name: SCRATCH_DOCUMENT_NAME, parentId: scratchFolderId, isPublic: false }
    });
    documentIsPublic = false;
    const privateRejected = isFreeAccountPrivateDocumentRejection(created);
    if (privateRejected) {
      // A public scratch document is the only kind this account can create. It
      // holds nothing that is not already public in this repository: the sample
      // icon and the MIT-licensed FeatureScript.
      log('  Onshape refused a private document on this plan. Retrying as a public document.');
      created = await call('create-document-public', '/documents', {
        method: 'POST',
        body: { name: SCRATCH_DOCUMENT_NAME, parentId: scratchFolderId, isPublic: true }
      });
      documentIsPublic = created.ok;
    }
    findings.push({
      id: 'E0',
      question: 'Can this account create a new private document via POST /documents?',
      verdict: privateRejected || !created.ok ? 'rejected' : 'accepted',
      detail: {
        privateRequestAccepted: !privateRejected && created.ok,
        freeAccountRejectsPrivateDocuments: privateRejected,
        publicFallbackUsed: Boolean(documentIsPublic),
        acceptedRequestShape: created.ok
          ? { name: SCRATCH_DOCUMENT_NAME, isPublic: Boolean(documentIsPublic) }
          : null
      }
    });
    if (!created.ok) {
      process.stderr.write('Document creation failed. Not falling back to any existing document.\n');
      process.exitCode = 1;
      return;
    }
    documentId = created.data?.id;
    workspaceId = created.data?.defaultWorkspace?.id;
  } else {
    documentId = String(options.documentId);
    const info = await call('get-document', `/documents/${documentId}`);
    workspaceId = info.data?.defaultWorkspace?.id;
    documentIsPublic = info.data?.public;
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

  log('');
  log(`Target document id: ${documentId}`);
  log(`Target workspace id: ${workspaceId}`);
  log(`Target document URL: ${documentUrl(documentId, workspaceId)}`);
  if (documentIsPublic) log('WARNING: this document is PUBLIC. Do not put anything confidential in it.');
  log('');

  const elements = await call('elements-initial', `/documents/d/${documentId}/w/${workspaceId}/elements`);
  const partStudio = (elements.data || []).find((element) => element?.elementType === 'PARTSTUDIO');
  const partStudioId = partStudio?.id;
  if (!partStudioId) {
    process.stderr.write('No Part Studio element was found in the target document.\n');
    process.exitCode = 1;
    return;
  }
  log(`Part Studio element id: ${partStudioId}`);
  log(`Part Studio URL: ${documentUrl(documentId, workspaceId, partStudioId)}`);

  const currentMicroversion0 = await call(
    'current-microversion-initial',
    `/documents/d/${documentId}/w/${workspaceId}/currentmicroversion`
  );

  // ---- E1: blob upload -----------------------------------------------------
  log('\nE1 blob-upload');
  const imageBytes = await fsp.readFile(path.join(config.publicDir, 'reference-align-icon.png'));

  async function uploadBlob(name, filename, uploadOptions = {}) {
    const { query = '', extraFields } = uploadOptions;
    const form = new FormData();
    form.append('file', new Blob([imageBytes], { type: 'image/png' }), filename);
    form.append('encodedFilename', filename);
    for (const [key, value] of Object.entries(extraFields || {})) form.append(key, value);
    const { rawBody, rawContentType } = await encodeMultipartBody(form);
    return call(name, `/blobelements/d/${documentId}/w/${workspaceId}${query}`, {
      method: 'POST',
      rawBody,
      rawContentType,
      note: {
        multipart: true,
        fields: ['file', 'encodedFilename', ...Object.keys(extraFields || {})],
        filename,
        fileMediaType: 'image/png',
        fileByteLength: imageBytes.length,
        contentTypeShape: `${rawContentType.split(';')[0]}; boundary=<generated>`
      }
    });
  }

  const uploadAttempts = [
    { id: 'a', name: 'e1-upload-plain', description: 'file + encodedFilename only', options: {} },
    {
      id: 'b',
      name: 'e1-upload-query-createdrawing',
      description: 'file + encodedFilename with ?createDrawingIfPossible=false',
      options: { query: '?createDrawingIfPossible=false' }
    },
    {
      id: 'c',
      name: 'e1-upload-field-createdrawing',
      description: 'file + encodedFilename + createDrawingIfPossible and translate form fields',
      options: { extraFields: { createDrawingIfPossible: 'false', translate: 'false' } }
    }
  ];

  let workingUploadOptions;
  let firstBlob;
  const uploadAttemptLog = [];
  for (const attempt of uploadAttempts) {
    const result = await uploadBlob(attempt.name, 'reference-align-icon-a.png', attempt.options);
    uploadAttemptLog.push({
      variant: attempt.id,
      description: attempt.description,
      status: result.status ?? null,
      ok: result.ok,
      elementId: result.data?.id ?? null,
      message: result.ok ? null : result.error?.message
    });
    if (result.ok && result.data?.id) {
      workingUploadOptions = attempt.options;
      firstBlob = result.data;
      break;
    }
  }

  let secondBlob;
  if (workingUploadOptions) {
    const second = await uploadBlob('e1-upload-second', 'reference-align-icon-b.png', workingUploadOptions);
    if (second.ok) secondBlob = second.data;
  }

  await call('elements-after-upload', `/documents/d/${documentId}/w/${workspaceId}/elements`);

  findings.push({
    id: 'E1',
    question: 'Can a blob element be created by signed multipart POST to /blobelements/d/{did}/w/{wid}?',
    verdict: firstBlob ? 'accepted' : 'rejected',
    attempts: uploadAttemptLog,
    detail: {
      firstBlobElementId: firstBlob?.id ?? null,
      secondBlobElementId: secondBlob?.id ?? null,
      responseHasMicroversionId: Boolean(firstBlob && 'microversionId' in firstBlob),
      firstBlobMicroversionId: firstBlob?.microversionId ?? null,
      responseKeys: firstBlob ? Object.keys(firstBlob).sort() : []
    }
  });

  // ---- E2: Feature Studio --------------------------------------------------
  log('\nE2 feature-studio-create');
  const featureStudioSource = await fsp.readFile(path.join(config.featureScriptDir, 'ReferenceImage.fs'), 'utf8');
  const fsCreate = await call('e2-fs-create', `/featurestudios/d/${documentId}/w/${workspaceId}`, {
    method: 'POST',
    body: { name: FEATURE_STUDIO_NAME }
  });
  const featureStudioId = fsCreate.data?.id;

  let fsWrite;
  let fsRead;
  let contentsMatch = false;
  if (featureStudioId) {
    fsWrite = await call('e2-fs-set-contents', `/featurestudios/d/${documentId}/w/${workspaceId}/e/${featureStudioId}`, {
      method: 'POST',
      body: { contents: featureStudioSource }
    });
    fsRead = await call('e2-fs-read-contents', `/featurestudios/d/${documentId}/w/${workspaceId}/e/${featureStudioId}`);
    const stored = fsRead.data?.contents;
    contentsMatch = typeof stored === 'string' &&
      Buffer.from(stored, 'utf8').equals(Buffer.from(featureStudioSource, 'utf8'));
  }

  const elementsAfterFs = await call('elements-after-fs', `/documents/d/${documentId}/w/${workspaceId}/elements`);
  const currentMicroversion1 = await call(
    'e2-current-microversion',
    `/documents/d/${documentId}/w/${workspaceId}/currentmicroversion`
  );
  const fsElement = (elementsAfterFs.data || []).find((element) => element?.id === featureStudioId);

  const microversionSources = {
    setContentsResponse: fsWrite?.data?.microversionId ?? null,
    readContentsResponse: fsRead?.data?.microversionId ?? null,
    elementsListing: fsElement?.microversionId ?? null,
    documentCurrentMicroversion: currentMicroversion1.data?.microversion ?? null,
    documentCurrentMicroversionBefore: currentMicroversion0.data?.microversion ?? null
  };
  const featureStudioMicroversion =
    microversionSources.elementsListing ||
    microversionSources.setContentsResponse ||
    microversionSources.documentCurrentMicroversion;

  findings.push({
    id: 'E2',
    question: 'Can a Feature Studio be created and its contents set and read back byte-for-byte?',
    verdict: featureStudioId && contentsMatch ? 'accepted' : (featureStudioId ? 'inconclusive' : 'rejected'),
    detail: {
      featureStudioId: featureStudioId ?? null,
      contentsRoundTripByteIdentical: contentsMatch,
      sourceByteLength: Buffer.byteLength(featureStudioSource, 'utf8'),
      storedByteLength: typeof fsRead?.data?.contents === 'string'
        ? Buffer.byteLength(fsRead.data.contents, 'utf8')
        : null,
      microversionSources,
      chosenFeatureStudioMicroversion: featureStudioMicroversion ?? null
    }
  });

  // ---- E3: add the feature instance ---------------------------------------
  log('\nE3 add-feature-instance');
  const context = {
    documentId,
    workspaceOrVersion: 'w',
    workspaceOrVersionId: workspaceId,
    elementId: partStudioId
  };
  const featuresPath = `/partstudios/d/${documentId}/w/${workspaceId}/e/${partStudioId}/features`;
  const baselineFeatures = await call('e3-features-before', featuresPath);

  const imageMicroversion = firstBlob?.microversionId || currentMicroversion1.data?.microversion;
  const imageNamespace = firstBlob?.id && imageMicroversion
    ? `e${firstBlob.id}::m${imageMicroversion}`
    : undefined;
  const featureNamespace = featureStudioId && featureStudioMicroversion
    ? `e${featureStudioId}::m${featureStudioMicroversion}`
    : undefined;
  log(`  image namespace candidate: ${imageNamespace ?? '(unavailable)'}`);
  log(`  feature namespace candidate: ${featureNamespace ?? '(unavailable)'}`);

  const planeVariants = [
    {
      id: 'a',
      description: 'captured qCompressed Top-plane queryString with deterministicIds ["JDC"]',
      build: () => planeParameter(CAPTURED_TOP_PLANE_QUERY, [CAPTURED_TOP_PLANE_DETERMINISTIC_ID])
    },
    {
      id: 'b',
      description: 'queryString qCreatedBy(makeId("Top"), EntityType.FACE) with no deterministicIds',
      build: () => planeParameter('query=qCreatedBy(makeId("Top"), EntityType.FACE);', undefined)
    },
    {
      id: 'c',
      description: 'deterministicIds ["JDC"] with a null queryString',
      build: () => planeParameter(null, [CAPTURED_TOP_PLANE_DETERMINISTIC_ID])
    }
  ];

  let createdFeatureId;
  let acceptedPlaneVariant;
  let acceptedFeatureRequest;
  const planeAttemptLog = [];

  async function tryPlaneVariant(variant, featureList) {
    const feature = referenceImageFeature({
      name: 'Calibrated Reference Image 1',
      featureNamespace,
      imageNamespace,
      plane: variant.build()
    });
    const payload = featureAddPayload(featureList, feature);
    const result = await call(`e3-add-feature-${variant.id}`, featuresPath, {
      method: 'POST',
      body: payload,
      note: { planeVariant: variant.id, description: variant.description }
    });
    const featureStatus = result.data?.featureState?.featureStatus ?? null;
    const featureId = result.data?.feature?.featureId ?? null;
    planeAttemptLog.push({
      variant: variant.id,
      description: variant.description,
      status: result.status ?? null,
      featureStatus,
      featureId,
      message: result.ok ? null : result.error?.message
    });
    if (result.ok && featureStatus === 'OK' && featureId) return { accepted: true, featureId, payload };
    if (result.ok && featureId) {
      // A feature that errored still exists; remove it so the next variant is
      // evaluated against a clean Part Studio.
      await call(`e3-delete-feature-${variant.id}`, `${featuresPath}/featureid/${featureId}`, { method: 'DELETE' });
    }
    return { accepted: false, featureId, payload };
  }

  if (imageNamespace && featureNamespace) {
    for (const variant of planeVariants) {
      const list = await call(`e3-features-refresh-${variant.id}`, featuresPath);
      const attempt = await tryPlaneVariant(variant, list.data || baselineFeatures.data);
      if (attempt.accepted) {
        createdFeatureId = attempt.featureId;
        acceptedPlaneVariant = variant;
        acceptedFeatureRequest = attempt.payload;
        break;
      }
    }

    if (!createdFeatureId) {
      // Variant (d): ask the Part Studio itself what the Top plane's
      // deterministic id is, then retry with that id.
      const evaluated = await call(
        'e3-featurescript-top-plane',
        `/partstudios/d/${documentId}/w/${workspaceId}/e/${partStudioId}/featurescript`,
        {
          method: 'POST',
          body: {
            script: 'function(context is Context, queries) { return transientQueriesToStrings(evaluateQuery(context, qCreatedBy(makeId("Top"), EntityType.FACE))); }',
            queries: []
          }
        }
      );
      const resolvedIds = collectValueStrings(evaluated.data?.result);
      log(`  resolved Top-plane deterministic ids: ${JSON.stringify(resolvedIds)}`);
      if (resolvedIds.length) {
        const variant = {
          id: 'd',
          description: `deterministicIds ${JSON.stringify(resolvedIds)} resolved via FeatureScript evaluation, null queryString`,
          build: () => planeParameter(null, resolvedIds)
        };
        const list = await call('e3-features-refresh-d', featuresPath);
        const attempt = await tryPlaneVariant(variant, list.data || baselineFeatures.data);
        if (attempt.accepted) {
          createdFeatureId = attempt.featureId;
          acceptedPlaneVariant = variant;
          acceptedFeatureRequest = attempt.payload;
        }
      }
    }
  }

  const featuresAfterAdd = await call('e3-features-after', featuresPath);
  const storedFeature = (featuresAfterAdd.data?.features || []).find(
    (feature) => feature?.featureId === createdFeatureId
  );

  findings.push({
    id: 'E3',
    question: 'Which plane-parameter shape does Onshape accept when adding a referenceImage feature instance?',
    verdict: createdFeatureId ? 'accepted' : 'rejected',
    attempts: planeAttemptLog,
    detail: {
      featureId: createdFeatureId ?? null,
      acceptedPlaneVariant: acceptedPlaneVariant?.id ?? null,
      acceptedPlaneVariantDescription: acceptedPlaneVariant?.description ?? null,
      requestImageNamespace: imageNamespace ?? null,
      requestFeatureNamespace: featureNamespace ?? null,
      storedImageNamespace: findParameter(storedFeature, 'image')?.namespace ?? null,
      storedFeatureNamespace: storedFeature?.namespace ?? null,
      storedPlaneParameter: findParameter(storedFeature, 'plane') ?? null,
      acceptedRequestShape: acceptedFeatureRequest ?? null,
      storedFeature: storedFeature ?? null
    }
  });

  // ---- E4: namespace rebinding --------------------------------------------
  log('\nE4 namespace-bind');
  const rebindAttemptLog = [];
  if (createdFeatureId && secondBlob?.id) {
    const secondMicroversion = secondBlob.microversionId || currentMicroversion1.data?.microversion;
    const namespaceForms = [
      {
        id: 'a',
        namespace: `e${secondBlob.id}::m${secondMicroversion}`,
        description: 'element + microversion, the same style that worked in E3'
      },
      { id: 'b', namespace: `e${secondBlob.id}`, description: 'element segment only' },
      {
        id: 'c',
        namespace: `d${documentId}::w${workspaceId}::e${secondBlob.id}::m${secondMicroversion}`,
        description: 'document + workspace + element + microversion'
      }
    ];

    for (const form of namespaceForms) {
      const list = await call(`e4-features-before-${form.id}`, featuresPath);
      const current = (list.data?.features || []).find((feature) => feature?.featureId === createdFeatureId);
      if (!current) {
        rebindAttemptLog.push({
          variant: form.id,
          namespace: form.namespace,
          description: form.description,
          status: null,
          featureStatus: null,
          storedNamespace: null,
          rebound: false,
          message: 'The feature was not present in the feature list.'
        });
        continue;
      }
      const updated = structuredClone(current);
      findParameter(updated, 'image').namespace = form.namespace;
      const payload = featureUpdatePayload(list.data, updated);
      const result = await captureUpdateFeature(`e4-rebind-${form.id}`, context, createdFeatureId, payload);
      const after = await call(`e4-features-after-${form.id}`, featuresPath);
      const stored = (after.data?.features || []).find((feature) => feature?.featureId === createdFeatureId);
      const storedNamespace = findParameter(stored, 'image')?.namespace ?? null;
      rebindAttemptLog.push({
        variant: form.id,
        namespace: form.namespace,
        description: form.description,
        status: result.status ?? null,
        featureStatus: result.data?.featureState?.featureStatus ?? null,
        storedNamespace,
        rebound: storedNamespace === form.namespace,
        message: result.ok ? null : result.error?.message
      });
    }
  }

  const reboundSuccess = rebindAttemptLog.find((attempt) => attempt.rebound && attempt.featureStatus === 'OK');
  findings.push({
    id: 'E4',
    question: 'Does Onshape accept a client-authored image namespace and actually rebind the image?',
    verdict: reboundSuccess ? 'accepted' : (rebindAttemptLog.length ? 'rejected' : 'not_run'),
    attempts: rebindAttemptLog,
    detail: {
      secondBlobElementId: secondBlob?.id ?? null,
      acceptedNamespaceForm: reboundSuccess?.namespace ?? null,
      acceptedNamespaceVariant: reboundSuccess?.variant ?? null
    }
  });

  // ---- E5: suppression -----------------------------------------------------
  log('\nE5 suppression');
  const suppressionLog = [];
  if (createdFeatureId) {
    for (const desired of [true, false]) {
      const list = await call(`e5-features-before-${desired}`, featuresPath);
      const current = (list.data?.features || []).find((feature) => feature?.featureId === createdFeatureId);
      if (!current) break;
      const updated = structuredClone(current);
      updated.suppressed = desired;
      const payload = featureUpdatePayload(list.data, updated);
      const result = await captureUpdateFeature(`e5-suppressed-${desired}`, context, createdFeatureId, payload);
      const after = await call(`e5-features-after-${desired}`, featuresPath);
      const stored = (after.data?.features || []).find((feature) => feature?.featureId === createdFeatureId);
      suppressionLog.push({
        requested: desired,
        status: result.status ?? null,
        featureStatus: result.data?.featureState?.featureStatus ?? null,
        storedSuppressed: stored?.suppressed ?? null,
        storedHasSuppressedKey: Boolean(stored && 'suppressed' in stored),
        message: result.ok ? null : result.error?.message
      });
    }
  }

  const suppressionWorks = suppressionLog.length === 2 &&
    suppressionLog[0].storedSuppressed === true &&
    suppressionLog[1].storedSuppressed === false;
  findings.push({
    id: 'E5',
    question: 'Is "suppressed" the field that suppresses a BTMFeature, and does it round-trip?',
    verdict: suppressionWorks ? 'accepted' : (suppressionLog.length ? 'inconclusive' : 'not_run'),
    attempts: suppressionLog,
    detail: { fieldName: 'suppressed' }
  });

  // ---- findings ------------------------------------------------------------
  const summary = {
    generatedAt: new Date().toISOString(),
    documentId,
    workspaceId,
    partStudioId,
    featureStudioId: featureStudioId ?? null,
    blobElementIds: [firstBlob?.id ?? null, secondBlob?.id ?? null],
    featureId: createdFeatureId ?? null,
    documentIsPublic: Boolean(documentIsPublic),
    partStudioUrl: documentUrl(documentId, workspaceId, partStudioId)
  };
  await fsp.writeFile(path.join(captureDir, 'summary.json'), `${JSON.stringify(redact(summary), null, 2)}\n`);

  const lines = [
    '# Onshape write-shape experiment findings',
    '',
    `Run: ${summary.generatedAt}`,
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| Document id | \`${documentId}\` |`,
    `| Workspace id | \`${workspaceId}\` |`,
    `| Part Studio element id | \`${partStudioId}\` |`,
    `| Feature Studio element id | \`${featureStudioId ?? 'n/a'}\` |`,
    `| Blob element ids | \`${firstBlob?.id ?? 'n/a'}\`, \`${secondBlob?.id ?? 'n/a'}\` |`,
    `| Feature id | \`${createdFeatureId ?? 'n/a'}\` |`,
    `| Part Studio URL | ${summary.partStudioUrl} |`,
    `| Document visibility | ${documentIsPublic ? 'PUBLIC' : 'private'} |`,
    '',
    'Request and response captures live beside this file as `NN-<name>.json`.',
    'Email-like strings and owner/creator records are redacted.',
    ''
  ];
  for (const finding of findings) {
    lines.push(`## ${finding.id} — ${finding.verdict.toUpperCase()}`, '');
    lines.push(`**Question:** ${finding.question}`, '');
    if (finding.attempts?.length) {
      lines.push('**Attempts:**', '', '```json', JSON.stringify(finding.attempts, null, 2), '```', '');
    }
    lines.push('**Detail:**', '', '```json', JSON.stringify(redact(finding.detail), null, 2), '```', '');
  }
  await fsp.writeFile(path.join(captureDir, 'FINDINGS.md'), `${lines.join('\n')}\n`);

  log('');
  for (const finding of findings) log(`${finding.id}: ${finding.verdict}`);
  log('');
  log(`Captures: ${captureDir}`);
  log(`Part Studio URL: ${summary.partStudioUrl}`);
}

main().catch((error) => {
  process.stderr.write(`${error?.message || error}\n`);
  process.exitCode = error?.status === 2 ? 2 : 1;
});
