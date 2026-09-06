/**
 * P1-P5 plane-query experiment. Only an explicitly requested scratch target
 * is writable. Importing this module performs no configuration reads or I/O.
 * Run: node scripts/experiment-plane.mjs --yes --create-document
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig } from '../src/config.mjs';
import { resolveSettingsFile } from '../src/config-paths.mjs';
import { readSettingsFile } from '../src/settings.mjs';
import { OnshapeApi, encodeMultipartBody } from '../src/onshape-api.mjs';
import { buildReferenceImageFeature, elementList, featureAddPayload, featureUpdatePayload, isOnshapeId, readFeatureStatus } from '../src/onshape-model.mjs';
import { buildPlaneParameter, listPlaneCandidates, planeQueryExpression } from '../src/plane-model.mjs';
import { isExampleOnshapeId, requireScratchFolder } from './live-target.mjs';

const PROTECTED_DOCUMENT_IDS = new Set(['a11ce0000000000000000143']);
const REDACTED_KEYS = /^(email|owner|creator|createdby|modifiedby|lastmodifiedby|lastmodifier|firstname|lastname|displayname|authorization|accesskey|secretkey|bearertoken|access_token|refresh_token|client_secret)$/i;

export function parsePlaneArgs(argv) {
  const options = { yes: false, createDocument: false };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const key = arg.split('=')[0];
    if (seen.has(key)) throw new Error('Repeated command-line option.');
    seen.add(key);
    if (arg === '--yes') options.yes = true;
    else if (arg === '--create-document') options.createDocument = true;
    else if (key === '--document-id') {
      const value = arg.includes('=') ? arg.slice('--document-id='.length) : argv[++index];
      if (!value || value.startsWith('--')) throw new Error('--document-id requires a value.');
      options.documentId = value;
    } else throw new Error('Unknown command-line option.');
  }
  validatePlaneOptions(options);
  return options;
}

export function validatePlaneOptions(options) {
  if (options?.yes !== true) throw new Error('--yes is required.');
  if (Number(options.createDocument === true) + Number(options.documentId !== undefined) !== 1) {
    throw new Error('Pass exactly one of --create-document or --document-id.');
  }
  if (options.documentId !== undefined) assertDocumentId(options.documentId);
}

function assertDocumentId(id) {
  if (!isOnshapeId(id)) throw new Error('The document id must be 24 hexadecimal characters.');
  if (isExampleOnshapeId(id) || PROTECTED_DOCUMENT_IDS.has(String(id).toLowerCase())) throw new Error('That document is protected: public example identifiers are not live targets.');
}

export function redactPlaneCapture(value, secrets = [], depth = 0) {
  if (depth > 40) return '[redacted-depth]';
  if (typeof value === 'string') {
    let text = value.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[redacted-email]');
    for (const secret of secrets) if (typeof secret === 'string' && secret) text = text.replaceAll(secret, '[redacted]');
    return text;
  }
  if (Array.isArray(value)) return value.map((entry) => redactPlaneCapture(entry, secrets, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) =>
      [key, REDACTED_KEYS.test(key) ? '[redacted]' : redactPlaneCapture(entry, secrets, depth + 1)]));
  }
  return value;
}

export function collectPlaneIds(result) {
  const ids = [];
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    if (/ValueString/.test(value.btType || '') && typeof value.value === 'string' && value.value.trim()) ids.push(value.value);
    for (const child of Object.values(value)) walk(child);
  }
  walk(result);
  return [...new Set(ids)];
}

export function planeEvaluationBody(candidate) {
  // Official endpoint example: https://onshape-public.github.io/docs/api-adv/fs/
  return { script: `function(context is Context, queries) { return transientQueriesToStrings(evaluateQuery(context, ${planeQueryExpression(candidate)})); }`, queries: {} };
}

function parameter(feature, id) {
  return (Array.isArray(feature?.parameters) ? feature.parameters : []).find((entry) => entry?.parameterId === id);
}

export function sameStoredPlane(expected, actual) {
  if (!Array.isArray(expected?.queries) || !Array.isArray(actual?.queries)) return false;
  const ids = (value) => value.queries.flatMap((query) => Array.isArray(query?.deterministicIds) ? query.deterministicIds : []).sort();
  const expectedIds = ids(expected);
  const actualIds = ids(actual);
  if (expectedIds.length && actualIds.length) return JSON.stringify(expectedIds) === JSON.stringify(actualIds);
  const statements = (value) => value.queries.map((query) => [query?.queryString ?? null, query?.queryStatement ?? null]);
  return expected.queries.length > 0 && JSON.stringify(statements(expected)) === JSON.stringify(statements(actual));
}

/** Dependencies are injected so offline tests cannot accidentally acquire credentials. */
export async function runPlaneExperiment({ options, api, projectRoot, settings = {}, secrets = [], log = () => {} }) {
  validatePlaneOptions(options);
  if (settings.allowFeatureInstall === false || settings.allowImageUpload === false) {
    throw new Error('Feature installation and image upload must be enabled for this experiment.');
  }
  if (options.createDocument && settings.allowDocumentCreation === false) throw new Error('Scratch document creation is disabled.');
  const scratchFolderId = options.createDocument ? requireScratchFolder(settings) : null;
  // Read only the two known repository assets before any remote mutation.
  const imageBytes = await fsp.readFile(path.join(projectRoot, 'public', 'reference-align-icon.png'));
  const featureSource = await fsp.readFile(path.join(projectRoot, 'featurescript', 'ReferenceImage.fs'), 'utf8');
  const experimentRoot = path.join(projectRoot, 'docs', 'experiments');
  await fsp.mkdir(experimentRoot, { recursive: true });
  const captureDir = await fsp.mkdtemp(path.join(experimentRoot, `${new Date().toISOString().slice(0, 10)}-plane-experiment-`));
  const summary = { generatedAt: new Date().toISOString(), phases: [], completed: false };
  let captureIndex = 0;
  async function capture(name, value) {
    const file = `${String(++captureIndex).padStart(2, '0')}-${name}.json`;
    await fsp.writeFile(path.join(captureDir, file), JSON.stringify(redactPlaneCapture(value, secrets), null, 2) + '\n');
    return file;
  }
  // Failed API requests are evidence, not exceptions that discard later phases.
  // Capture I/O failures intentionally stop the run before another remote write.
  async function call(name, requestPath, options = {}) {
    const record = { name, method: options.method || 'GET', path: requestPath, requestBody: options.body ?? null };
    if (!['GET', 'POST'].includes(record.method)) throw new Error('Only reads and explicit experimental writes are supported.');
    try {
      const response = await api.request(requestPath, options);
      const text = await response.text();
      record.status = response.status;
      try { record.data = JSON.parse(text); } catch { record.data = null; }
      record.ok = response.ok;
      record.featureStatus = readFeatureStatus(record.data).status;
    } catch (error) {
      record.ok = false;
      record.status = error.status ?? null;
      record.error = { message: error.message, body: error.body ?? null };
    }
    record.captureFile = await capture(name, record);
    log(`${name}: ${record.status ?? 'ERR'} ${record.featureStatus ?? ''}`);
    return record;
  }
  function requireResult(result, message) {
    if (!result?.ok) throw new Error(message);
    return result.data;
  }
  try {
    let info;
    if (options.createDocument) {
      const body = { name: 'Reference Align plane experiment', parentId: scratchFolderId, isPublic: false };
      let created = await call('create-document-private', '/documents', { method: 'POST', body });
      if (created.status === 409 && /free accounts only allow access to public documents/i.test(created.error?.body?.message || '')) {
        log('WARNING: the scratch document will be PUBLIC. Only repository assets are uploaded.');
        created = await call('create-document-public', '/documents', { method: 'POST', body: { ...body, isPublic: true } });
        summary.publicFallback = true;
      }
      info = requireResult(created, 'Scratch document creation failed.');
    } else {
      info = requireResult(await call('get-document', `/documents/${options.documentId}`), 'Document lookup failed.');
      if (info.id && String(info.id).toLowerCase() !== options.documentId.toLowerCase()) throw new Error('The resolved document does not match the requested target.');
    }
    const documentId = options.documentId || info.id;
    assertDocumentId(documentId);
    const workspaceId = info.defaultWorkspace?.id;
    if (!isOnshapeId(workspaceId)) throw new Error('No valid default workspace was returned.');
    Object.assign(summary, { documentId, workspaceId });
    const documentPath = `/documents/d/${documentId}/w/${workspaceId}`;
    const elements = requireResult(await call('elements-initial', `${documentPath}/elements`), 'Element lookup failed.');
    const partStudio = elementList(elements).find((element) => element?.elementType === 'PARTSTUDIO' && isOnshapeId(element.id));
    if (!partStudio) throw new Error('No Part Studio was found in the explicit target.');
    summary.partStudioId = partStudio.id;
    const partPath = `/partstudios/d/${documentId}/w/${workspaceId}/e/${partStudio.id}`;
    const featurePath = `${partPath}/features`;
    const defaults = listPlaneCandidates();
    const resolved = new Map();
    const p1 = { id: 'P1', attempts: [] };
    summary.phases.push(p1);
    async function resolve(candidate, name) {
      const result = await call(name, `${partPath}/featurescript`, { method: 'POST', body: planeEvaluationBody(candidate) });
      const ids = result.ok ? collectPlaneIds(result.data?.result) : [];
      return { ids, captureFile: result.captureFile, ok: result.ok && ids.length === 1 };
    }
    for (const candidate of defaults) {
      const result = await resolve(candidate, `p1-resolve-${candidate.label.toLowerCase()}`);
      if (result.ok) resolved.set(candidate.id, result.ids);
      p1.attempts.push({ plane: candidate.label, ...result, ...(candidate.label === 'Top' ? { topIsJDC: result.ids.length === 1 && result.ids[0] === 'JDC' } : {}) });
    }
    p1.accepted = p1.attempts.every((attempt) => attempt.ok);

    // Install prerequisites use the same upload contract and feature builders
    // as the product, with each element's own freshly listed microversion.
    const form = new FormData();
    form.append('file', new Blob([imageBytes], { type: 'image/png' }), 'reference-align-plane.png');
    form.append('encodedFilename', 'reference-align-plane.png');
    const multipart = await encodeMultipartBody(form);
    const uploadResponse = requireResult(await call('upload-image', `/blobelements/d/${documentId}/w/${workspaceId}`, { method: 'POST', ...multipart }), 'Image upload failed.');
    // Older capture 05-e1-upload-plain.json is a bare element. Current live
    // responses may wrap uploaded elements in items; require a single image
    // rather than guessing which result a multipart upload should bind.
    const uploaded = Array.isArray(uploadResponse?.items)
      ? (uploadResponse.items.length === 1 ? uploadResponse.items[0] : null)
      : uploadResponse;
    if (!isOnshapeId(uploaded?.id)) throw new Error('Image upload did not return one valid element id.');
    const studio = requireResult(await call('create-feature-studio', `/featurestudios/d/${documentId}/w/${workspaceId}`, { method: 'POST', body: { name: 'Reference Align plane experiment' } }), 'Feature Studio creation failed.');
    if (!isOnshapeId(studio.id) || !isOnshapeId(uploaded.id)) throw new Error('Upload or studio returned an invalid element id.');
    requireResult(await call('set-feature-studio', `/featurestudios/d/${documentId}/w/${workspaceId}/e/${studio.id}`, { method: 'POST', body: { contents: featureSource } }), 'Setting FeatureScript failed.');
    const installedElements = elementList(requireResult(await call('elements-after-install', `${documentPath}/elements`), 'Installed element lookup failed.'));
    const featureStudio = installedElements.find((entry) => entry.id === studio.id);
    const image = installedElements.find((entry) => entry.id === uploaded.id);
    const template = buildReferenceImageFeature({ featureStudio, image });
    Object.assign(summary, { featureStudioId: studio.id, imageElementId: uploaded.id });

    async function add(name, feature) {
      const list = await call(`${name}-before`, featurePath);
      if (!list.ok) return { accepted: false, reason: 'Feature read failed.' };
      const request = featureAddPayload(list.data, feature);
      const result = await call(name, featurePath, { method: 'POST', body: request });
      const featureId = result.data?.feature?.featureId;
      const after = await call(`${name}-after`, featurePath);
      const stored = (after.data?.features || []).find((entry) => entry.featureId === featureId);
      const outcome = { featureId, featureStatus: result.featureStatus, accepted: result.ok && result.featureStatus === 'OK' && Boolean(stored), storedPlane: parameter(stored, 'plane') ?? parameter(stored, 'sketchPlane') ?? null, captureFile: result.captureFile };
      await capture(`${name}-outcome`, outcome);
      return outcome;
    }
    function reference(name, plane) {
      const feature = structuredClone(template);
      feature.name = name;
      feature.parameters = feature.parameters.map((entry) => entry.parameterId === 'plane' ? structuredClone(plane) : entry);
      return feature;
    }
    const acceptedPlanes = new Map();
    const p2 = { id: 'P2', attempts: [] };
    summary.phases.push(p2);
    for (const candidate of defaults.filter((entry) => entry.label !== 'Top')) {
      for (const variant of ['a', 'b', 'c']) {
        const ids = resolved.get(candidate.id);
        if (variant !== 'b' && !ids) { p2.attempts.push({ plane: candidate.label, variant, accepted: false, reason: 'P1 did not resolve one plane.' }); continue; }
        const plane = buildPlaneParameter(candidate, variant === 'b' ? {} : { deterministicIds: ids });
        if (variant === 'c') plane.queries[0].queryString = null;
        const outcome = await add(`p2-${candidate.label.toLowerCase()}-${variant}`, reference(`P2 ${candidate.label} ${variant}`, plane));
        p2.attempts.push({ plane: candidate.label, variant, ...outcome });
        if (outcome.accepted && !acceptedPlanes.has(candidate.id)) acceptedPlanes.set(candidate.id, { ...outcome, plane });
      }
    }
    p2.accepted = ['default:Front', 'default:Right'].every((id) => acceptedPlanes.has(id));

    const p3 = { id: 'P3', accepted: false };
    summary.phases.push(p3);
    if (resolved.has('default:Top')) {
      // Experimental cPlane REST fields, not a captured fixture. P3 is the
      // gate for treating them as established. Standard feature parameters:
      // https://cad.onshape.com/FsDoc/library.html (cPlane / CPlaneType).
      const entities = buildPlaneParameter(defaults[0], { deterministicIds: resolved.get('default:Top') });
      entities.parameterId = 'entities';
      const offset = { btType: 'BTMFeature-134', featureType: 'cPlane', name: 'P3 offset plane', parameters: [
        { btType: 'BTMParameterEnum-145', parameterId: 'cplaneType', enumName: 'CPlaneType', value: 'OFFSET' },
        entities,
        { btType: 'BTMParameterQuantity-147', parameterId: 'offset', expression: '0.01 m', isInteger: false, value: 0, units: '' },
        { btType: 'BTMParameterBoolean-144', parameterId: 'oppositeDirection', value: false }
      ] };
      p3.creation = await add('p3-create-offset-plane', offset);
      if (p3.creation.accepted) {
        const candidate = { kind: 'plane-feature', featureId: p3.creation.featureId };
        p3.resolution = await resolve(candidate, 'p3-resolve-offset-plane');
        if (p3.resolution.ok) {
          p3.reference = await add('p3-reference-image', reference('P3 reference image', buildPlaneParameter(candidate, { deterministicIds: p3.resolution.ids })));
          p3.accepted = p3.reference.accepted;
        }
      }
    } else p3.reason = 'P1 did not resolve Top.';

    const p4 = { id: 'P4', accepted: false };
    summary.phases.push(p4);
    const front = acceptedPlanes.get('default:Front');
    if (front) {
      // Skeleton from 2026-09-05-suppress-verify/03-create-native-sketch.json.
      // That capture has no sketchPlane. The added query is experimental until
      // the freshly created sketch regenerates and returns it on re-read.
      const sketchPlane = structuredClone(front.storedPlane || front.plane);
      sketchPlane.parameterId = 'sketchPlane';
      p4.creation = await add('p4-create-front-sketch', { btType: 'BTMSketch-151', featureType: 'newSketch', name: 'P4 Front sketch', suppressed: false, parameters: [sketchPlane], entities: [], constraints: [] });
      if (p4.creation.accepted && p4.creation.storedPlane) {
        p4.reference = await add('p4-reference-image', reference('P4 same plane as sketch', buildPlaneParameter({ kind: 'sketch', query: p4.creation.storedPlane })));
        p4.accepted = p4.reference.accepted;
      }
    } else p4.reason = 'P2 did not establish a Front-plane query.';

    const p5 = { id: 'P5', accepted: false };
    summary.phases.push(p5);
    const right = acceptedPlanes.get('default:Right');
    if (front && right) {
      const before = await call('p5-before', featurePath);
      const stored = (before.data?.features || []).find((entry) => entry.featureId === front.featureId);
      if (before.ok && stored) {
        const updated = structuredClone(stored);
        updated.parameters = updated.parameters.map((entry) => entry.parameterId === 'plane' ? structuredClone(right.storedPlane || right.plane) : entry);
        const payload = featureUpdatePayload(before.data, updated);
        await capture('p5-backup', { originalFeatureList: before.data, proposedUpdate: payload });
        const result = await call('p5-replane', `${featurePath}/featureid/${encodeURIComponent(front.featureId)}`, { method: 'POST', body: payload });
        const after = await call('p5-after', featurePath);
        const reread = (after.data?.features || []).find((entry) => entry.featureId === front.featureId);
        const storedPlaneMatches = sameStoredPlane(parameter(updated, 'plane'), parameter(reread, 'plane'));
        Object.assign(p5, { featureId: front.featureId, featureStatus: result.featureStatus, requestedPlane: parameter(updated, 'plane'), storedPlane: parameter(reread, 'plane') ?? null, storedPlaneMatches, accepted: result.ok && result.featureStatus === 'OK' && storedPlaneMatches });
      }
    } else p5.reason = 'P2 did not establish both Front and Right.';
    summary.completed = true;
    summary.accepted = summary.phases.length === 5 && summary.phases.every((phase) => phase.accepted);
  } catch (error) {
    summary.error = { message: error.message };
    summary.accepted = false;
  } finally {
    const safe = redactPlaneCapture(summary, secrets);
    await fsp.writeFile(path.join(captureDir, 'summary.json'), JSON.stringify(safe, null, 2) + '\n');
    await fsp.writeFile(path.join(captureDir, 'FINDINGS.md'), '# Plane experiment\n\n' +
      `Run: ${safe.generatedAt}\n\n` + safe.phases.map((phase) => `## ${phase.id}: ${phase.accepted ? 'ACCEPTED' : 'NOT PROVEN'}\n\n\`\`\`json\n${JSON.stringify(phase, null, 2)}\n\`\`\`\n`).join('\n') +
      (safe.error ? `\nStopped: ${safe.error.message}\n` : '') + '\nNo documents or features were deleted.\n');
  }
  return { captureDir, summary };
}

async function main() {
  let options;
  try { options = parsePlaneArgs(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`Refusing to run: ${error.message}\n`); process.exitCode = 2; return; }
  const config = getConfig();
  if (config.authMode === 'none') throw new Error('Onshape authentication is not configured.');
  const { settings } = await readSettingsFile(resolveSettingsFile(config.envFilePath));
  const secrets = [config.accessKey, config.secretKey, config.bearerToken, config.oauth?.clientSecret];
  const result = await runPlaneExperiment({ options, api: new OnshapeApi(config), projectRoot: config.projectRoot, settings, secrets, log: (line) => process.stdout.write(redactPlaneCapture(line, secrets) + '\n') });
  process.stdout.write(`Captures: ${result.captureDir}\n`);
  if (!result.summary.accepted) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { process.stderr.write('Plane experiment stopped. Check the configuration or redacted captures.\n'); process.exitCode = 1; });
}
