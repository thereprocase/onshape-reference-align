import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { parsePlaneArgs, validatePlaneOptions, redactPlaneCapture, collectPlaneIds, planeEvaluationBody, sameStoredPlane, runPlaneExperiment } from '../scripts/experiment-plane.mjs';
const TEST_FOLDER_ID = '7'.repeat(24);

const DID = '111111111111111111111111';
const WID = '222222222222222222222222';
const EID = '333333333333333333333333';
const BLOB = '444444444444444444444444';
const STUDIO = '555555555555555555555555';
const MID = '666666666666666666666666';

test('CLI requires deliberate target and refuses protected ids and duplicate flags', () => {
  for (const args of [[], ['--yes'], ['--create-document'], ['--yes', '--document-id'], ['--yes', '--document-id=../oops'],
    ['--yes', '--create-document', '--document-id', DID], ['--yes', '--document-id', 'a11ce0000000000000000143'],
    ['--yes', '--create-document', '--create-document'], ['--yes', '--output=/tmp/oops']]) {
    assert.throws(() => parsePlaneArgs(args));
  }
  assert.deepEqual(parsePlaneArgs(['--yes', '--create-document']), { yes: true, createDocument: true });
  assert.equal(parsePlaneArgs(['--yes', `--document-id=${DID}`]).documentId, DID);
  assert.throws(() => validatePlaneOptions({ yes: 'true', createDocument: true }));
});

test('importing the experiment neither executes main nor reads configuration', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    "globalThis.fetch = () => { throw new Error('network forbidden'); }; await import('./scripts/experiment-plane.mjs');"],
  { cwd: new URL('..', import.meta.url), encoding: 'utf8', env: { ...process.env, ONSHAPE_REFERENCE_ALIGN_CONFIG: '/no-such-config/for-this-test' } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

test('captures redact credential fields, echoed credentials, and personal records', () => {
  assert.deepEqual(redactPlaneCapture({ defaultWorkspace: { creator: { name: 'Private' }, lastModifier: { name: 'Private' } } }),
    { defaultWorkspace: { creator: '[redacted]', lastModifier: '[redacted]' } });
  assert.deepEqual(redactPlaneCapture({ owner: { name: 'Private' }, creator: 'Private', authorization: 'secret', error: 'echo TOKEN person@example.com', nested: { refresh_token: 'secret' } }, ['TOKEN']),
    { owner: '[redacted]', creator: '[redacted]', authorization: '[redacted]', error: 'echo [redacted] [redacted-email]', nested: { refresh_token: '[redacted]' } });
});

test('evaluation requests use the documented lambda and only collect ValueString ids', () => {
  assert.deepEqual(planeEvaluationBody({ kind: 'default', id: 'default:Front' }).queries, {});
  assert.match(planeEvaluationBody({ kind: 'default', id: 'default:Front' }).script, /transientQueriesToStrings\(evaluateQuery\(context, qCreatedBy\(makeId\("Front"\)/);
  assert.deepEqual(collectPlaneIds({ value: [{ btType: 'BTFSValueString-1', value: 'JDC' }, { btType: 'BTFSValueString-1', value: 'JDC' }, { value: 'ignore' }] }), ['JDC']);
});

test('P5 requires the stored plane to match, ignoring server-generated node ids', () => {
  const plane = { queries: [{ deterministicIds: ['RIGHT'], queryString: 'original' }] };
  assert.equal(sameStoredPlane(plane, { queries: [{ deterministicIds: ['RIGHT'], queryString: 'canonical', nodeId: 'new' }] }), true);
  assert.equal(sameStoredPlane(plane, { queries: [{ deterministicIds: ['FRONT'] }] }), false);
  assert.equal(sameStoredPlane(plane, undefined), false);
});

async function scratch(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'reference-align-plane-test-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  for (const asset of ['public/reference-align-icon.png', 'featurescript/ReferenceImage.fs']) {
    await fsp.mkdir(path.dirname(path.join(root, asset)), { recursive: true });
    await fsp.copyFile(new URL(`../${asset}`, import.meta.url), path.join(root, asset));
  }
  return root;
}

// Synthetic transport responses exercise orchestration and safety only; they
// are not fixtures or evidence that Onshape accepts the experimental payloads.
function fakeApi({ protectedCreated = false, failPlane = false } = {}) {
  const calls = [];
  const features = [];
  let id = 0;
  return { calls, features, async request(url, options = {}) {
    const method = options.method || 'GET';
    calls.push({ url, method, body: structuredClone(options.body) });
    let data;
    if (url === '/documents') data = { id: protectedCreated ? 'a11ce0000000000000000143' : DID, defaultWorkspace: { id: WID } };
    else if (url === `/documents/${DID}`) data = { id: DID, defaultWorkspace: { id: WID } };
    else if (url.endsWith('/elements')) data = [{ id: EID, elementType: 'PARTSTUDIO' }, { id: BLOB, elementType: 'BLOB', microversionId: MID }, { id: STUDIO, elementType: 'FEATURESTUDIO', microversionId: MID }];
    else if (url.endsWith('/featurescript')) data = { result: { btType: 'BTFSValueArray', value: [{ btType: 'BTFSValueString', value: options.body.script.includes('"Top"') ? 'JDC' : options.body.script.includes('"Front"') ? 'FRONT' : 'RIGHT' }] } };
    else if (url.startsWith('/blobelements/')) data = { items: [{ id: BLOB }] };
    else if (url.startsWith('/featurestudios/')) data = { id: STUDIO };
    else if (url.endsWith('/features') && method === 'GET') data = { features, sourceMicroversion: MID, serializationVersion: '1.2.21', libraryVersion: 3070 };
    else if (url.endsWith('/features')) {
      const feature = { ...structuredClone(options.body.feature), featureId: `F${++id}` };
      features.push(feature);
      data = { feature, featureState: { featureStatus: failPlane && feature.featureType === 'cPlane' ? 'ERROR' : 'OK' } };
    } else if (url.includes('/featureid/')) {
      const feature = structuredClone(options.body.feature);
      features[features.findIndex((entry) => entry.featureId === feature.featureId)] = feature;
      data = { feature, featureState: { featureStatus: 'OK' } };
    } else throw new Error('Unexpected fake route.');
    return new Response(JSON.stringify(data), { status: 200 });
  } };
}

test('full offline P1-P5 orchestration uses explicit folder, preserves experiments, and backs up replane', async (t) => {
  const projectRoot = await scratch(t);
  const api = fakeApi();
  const result = await runPlaneExperiment({ options: { yes: true, createDocument: true }, api, projectRoot, settings: { scratchFolderId: TEST_FOLDER_ID } });
  assert.equal(result.summary.accepted, true, JSON.stringify(result.summary));
  assert.equal(api.calls[0].body.parentId, TEST_FOLDER_ID);
  assert.ok(api.calls.every((call) => call.method !== 'DELETE'));
  assert.equal(result.summary.phases.find((phase) => phase.id === 'P2').attempts.length, 6);
  const files = await fsp.readdir(result.captureDir);
  assert.ok(files.includes('summary.json'));
  assert.ok(files.includes('FINDINGS.md'));
  assert.ok(files.some((file) => file.endsWith('-p5-backup.json')));
  const update = api.calls.find((call) => call.url.includes('/featureid/')).body.feature;
  const original = api.calls.find((call) => call.body?.feature?.name === update.name).body.feature;
  assert.deepEqual(update.parameters.filter((entry) => entry.parameterId !== 'plane'), original.parameters.filter((entry) => entry.parameterId !== 'plane'));
  const second = await runPlaneExperiment({ options: { yes: true, documentId: DID }, api: fakeApi(), projectRoot });
  assert.notEqual(result.captureDir, second.captureDir);
});

test('failed cPlane evidence is reported without pretending the phase passed', async (t) => {
  const result = await runPlaneExperiment({ options: { yes: true, createDocument: true }, api: fakeApi({ failPlane: true }), projectRoot: await scratch(t), settings: { scratchFolderId: TEST_FOLDER_ID } });
  assert.equal(result.summary.completed, true);
  assert.equal(result.summary.accepted, false);
  assert.equal(result.summary.phases.find((phase) => phase.id === 'P3').accepted, false);
});

test('policy and protected resolved document stop all subsequent writes', async (t) => {
  for (const settings of [{}, { allowDocumentCreation: false }, { allowFeatureInstall: false }, { allowImageUpload: false }, { scratchFolderId: 'a11ce0000000000000000009' }]) {
    const api = fakeApi();
    await assert.rejects(runPlaneExperiment({ options: { yes: true, createDocument: true }, api, projectRoot: '/unused', settings }));
    assert.equal(api.calls.length, 0);
  }
  const api = fakeApi({ protectedCreated: true });
  const result = await runPlaneExperiment({ options: { yes: true, createDocument: true }, api, projectRoot: await scratch(t), settings: { scratchFolderId: TEST_FOLDER_ID } });
  assert.equal(api.calls.length, 1);
  assert.match(result.summary.error.message, /protected/);
});
