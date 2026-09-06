import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createWriteRoutes } from '../src/write-routes.mjs';
import { OnshapeApi, OnshapeApiError } from '../src/onshape-api.mjs';
import { normalizeContext } from '../src/context.mjs';
import { DEFAULT_SETTINGS } from '../src/settings.mjs';
import { deriveCapabilities } from '../src/capabilities.mjs';
import { routeRateLimitError } from '../src/session.mjs';
import { FEATURE_MARKER, scanFeatureList } from '../src/onshape-model.mjs';
import { MAX_PLANE_RESOLUTIONS, resolvePlaneCandidates } from '../src/plane-model.mjs';
import { capturedPlane, capturedSketch, capturedReference } from './fixtures/plane-features.mjs';
import { ELEMENTS_AFTER_FEATURE_STUDIO } from './fixtures/install-elements.mjs';

const CONTEXT = { documentId: 'a11ce0000000000000000039', workspaceOrVersion: 'w', workspaceOrVersionId: 'a11ce0000000000000000052', elementId: 'a11ce0000000000000000027' };
const ITEM_ID = `custom:${capturedReference().featureId}`;
const requestBody = { context: CONTEXT, itemId: ITEM_ID, planeId: 'default:Right', confirm: true };

function evaluation(script) {
  // Synthetic transport envelope uses the real BTFS array/string shape from
  // 03-p1-resolve-top.json. The values exercise routing, not CAD geometry.
  const names = [...script.matchAll(/makeId\("([^"\\]*)"\)/g)].map((match) => match[1]);
  return { result: { btType: 'com.belmonttech.serialize.fsvalue.BTFSValueArray', value: names.map((name) => ({
    btType: 'com.belmonttech.serialize.fsvalue.BTFSValueArray', value: [{ btType: 'com.belmonttech.serialize.fsvalue.BTFSValueString', value: name === 'Top' ? 'JDC' : name === 'Front' ? 'JCC' : name === 'Right' ? 'JBC' : 'USER_PLANE' }]
  })) } };
}

function harness({ install = false, policy = {}, capabilities, featureStatus = 'OK', refreshFails = false, updateError, downstream = false, evaluationFails = false } = {}) {
  const calls = [];
  const backups = [];
  const sent = [];
  const features = install ? [capturedPlane(), capturedSketch()] : downstream
    ? [capturedReference(), capturedPlane(), capturedSketch()] : [capturedPlane(), capturedSketch(), capturedReference()];
  const list = { features, serializationVersion: '1.2.21', sourceMicroversion: '111111111111111111111111', libraryVersion: 3070 };
  let written;
  const api = {
    listElements: async () => { calls.push('elements'); return structuredClone(ELEMENTS_AFTER_FEATURE_STUDIO); },
    getFeatures: async () => { calls.push('features'); return structuredClone(list); },
    getFeatureStudioContents: async () => ({ contents: `// ${FEATURE_MARKER}` }),
    evaluateFeatureScript: async (context, script) => { calls.push('evaluate'); if (evaluationFails) throw new Error('offline'); return evaluation(script); },
    updateFeature: async (context, id, payload) => {
      calls.push('update');
      if (updateError) throw updateError;
      written = payload;
      list.features = list.features.map((feature) => feature.featureId === id ? structuredClone(payload.feature) : feature);
      return { feature: payload.feature, featureState: { featureStatus } };
    },
    addFeature: async (context, payload) => {
      calls.push('add'); written = payload;
      return { feature: { ...payload.feature, featureId: 'added' }, featureState: { featureStatus } };
    }
  };
  const { handleWrite } = createWriteRoutes({
    api, assets: { readAsset: async () => Buffer.from(`// ${FEATURE_MARKER}`) },
    config: () => ({ maxImageUploadBytes: 100000, enableNativeImageWrite: false }), generation: () => 1,
    settingsStore: { current: () => ({ ...DEFAULT_SETTINGS, ...policy }) }, capabilities: () => capabilities,
    normalizeContext, normalizeCalibration: () => { throw new Error('Unexpected calibration.'); },
    loadImageItem: async (context, itemId) => {
      calls.push('item');
      const featureList = structuredClone(list);
      const item = scanFeatureList(featureList, context).find((entry) => entry.id === itemId);
      if (!item) throw Object.assign(new Error('Item missing.'), { status: 409 });
      return { featureList, item };
    },
    loadImageItems: async (context) => {
      calls.push('refresh'); if (refreshFails) throw new Error('offline');
      return { featureList: list, items: scanFeatureList(list, context) };
    },
    writeBackup: async (value) => { calls.push('backup'); backups.push(structuredClone(value)); return '/tmp/plane-backup.json'; },
    sendJson: (res, status, body) => sent.push({ status, body })
  });
  async function run(pathname = '/api/replane', body = requestBody, session = {}) {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]);
    req.method = 'POST'; req.headers = { 'content-type': 'application/json' };
    await handleWrite(req, {}, new URL(`http://local.invalid${pathname}`), session);
    return sent.at(-1)?.body;
  }
  async function status() {
    await handleWrite({ method: 'GET', headers: {} }, {}, new URL(`http://local.invalid/api/install/status?${new URLSearchParams({ ...CONTEXT, itemId: ITEM_ID })}`));
    return sent.at(-1).body;
  }
  return { calls, backups, run, status, get written() { return written; } };
}

test('status resolves defaults/user planes in one call and returns copied sketch queries', async () => {
  const h = harness();
  const result = await h.status();
  assert.equal(h.calls.filter((call) => call === 'evaluate').length, 1);
  assert.deepEqual(result.planes.slice(0, 3).map((plane) => plane.id), ['default:Top', 'default:Front', 'default:Right']);
  assert.equal(result.selectedPlane.id, 'default:Front');
  assert.deepEqual(result.planes.find((plane) => plane.kind === 'sketch').query, capturedSketch().parameters.find((parameter) => parameter.parameterId === 'sketchPlane'));
});

test('replane changes only plane after backing up and returns fresh item', async () => {
  const h = harness();
  const result = await h.run();
  assert.deepEqual(h.calls, ['item', 'evaluate', 'backup', 'update', 'refresh']);
  assert.equal(h.backups[0].operation, 'replane');
  assert.equal(result.plane.id, 'default:Right');
  assert.equal(result.itemsStale, false);
  assert.equal(result.item.id, ITEM_ID);
  const original = capturedReference();
  const expected = structuredClone(original);
  expected.parameters = expected.parameters.map((parameter) => parameter.parameterId === 'plane' ? h.written.feature.parameters.find((entry) => entry.parameterId === 'plane') : parameter);
  assert.deepEqual(h.written.feature, expected);
});

test('selecting same plane as a sketch uses the captured query verbatim except parameterId', async () => {
  const h = harness();
  await h.run('/api/replane', { ...requestBody, planeId: `sketch:${capturedSketch().featureId}`, query: { malicious: true } });
  const expected = capturedSketch().parameters.find((parameter) => parameter.parameterId === 'sketchPlane');
  expected.parameterId = 'plane';
  assert.deepEqual(h.written.feature.parameters.find((entry) => entry.parameterId === 'plane'), expected);
});

test('replane scope, policy, confirmation, and workspace gates run before Onshape reads', async () => {
  const cases = [
    [harness({ capabilities: deriveCapabilities({ sessionInfo: { oauth2Scopes: 1 } }) }), requestBody, /permission|scope|read|write/i],
    [harness({ policy: { allowFeatureInstall: false } }), requestBody, /switched off|disabled|allow|install/i],
    [harness(), { ...requestBody, confirm: false }, /confirmation/],
    [harness(), { ...requestBody, context: { ...CONTEXT, workspaceOrVersion: 'v' } }, /read-only/]
  ];
  for (const [h, body, match] of cases) { await assert.rejects(h.run('/api/replane', body), match); assert.deepEqual(h.calls, []); }
  const allowed = harness({ policy: { confirmBeforeWrite: false } });
  assert.equal((await allowed.run('/api/replane', { ...requestBody, confirm: false })).ok, true);
});

test('missing, unresolvable, and downstream selections are refused without writes', async () => {
  for (const [options, planeId] of [[{}, 'plane:removed'], [{ evaluationFails: true }, 'default:Right'], [{ downstream: true }, `sketch:${capturedSketch().featureId}`], [{ downstream: true }, `plane:${capturedPlane().featureId}`]]) {
    const h = harness(options);
    await assert.rejects(h.run('/api/replane', { ...requestBody, planeId }), (error) => error.status === 409);
    assert.ok(!h.calls.includes('update'));
    assert.equal(h.backups.length, 0);
  }
});

test('status refuses to present later feature dependencies as available planes', async () => {
  const result = await harness({ downstream: true }).status();
  for (const candidate of result.planes.filter((entry) => entry.featureId)) {
    assert.match(candidate.unavailableReason, /before this image/);
    assert.equal(candidate.query, undefined);
  }
});

test('feature errors report the backup, while refresh failure preserves write success', async () => {
  const h = harness({ featureStatus: 'ERROR' });
  await assert.rejects(h.run(), (error) => error.code === 'FEATURE_STATUS_NOT_OK' && error.expose.backupFile === 'plane-backup.json');
  assert.equal(h.backups.length, 1);
  const success = await harness({ refreshFails: true }).run();
  assert.equal(success.ok, true);
  assert.equal(success.itemsStale, true);
});

test('replane 403 evidence uses the install capability generation', async () => {
  const session = {};
  const h = harness({ updateError: new OnshapeApiError('denied', { status: 403 }) });
  await assert.rejects(h.run('/api/replane', requestBody, session));
  assert.equal(session.capabilityEvidence.installFeature.status, 403);
  assert.equal(session.capabilityEvidence.installFeature.generation, 1);
});

test('spent replane bucket refuses before any read or backup', async () => {
  const session = {};
  for (let index = 0; index < 10; index += 1) assert.equal(routeRateLimitError(session, 'POST', '/api/replane'), null);
  const h = harness();
  await assert.rejects(h.run('/api/replane', requestBody, session), (error) => error.status === 429 && error.retryAfterSeconds > 0);
  assert.deepEqual(h.calls, []);
});

test('install honors selected plane and preserves the original Top path when omitted', async () => {
  const imageElementId = ELEMENTS_AFTER_FEATURE_STUDIO.find((entry) => entry.elementType === 'BLOB').id;
  const h = harness({ install: true });
  const result = await h.run('/api/install', { context: CONTEXT, imageElementId, planeId: 'default:Right', confirm: true });
  assert.equal(result.plane.id, 'default:Right');
  assert.deepEqual(h.written.feature.parameters.find((entry) => entry.parameterId === 'plane').queries[0].deterministicIds, ['JBC']);
  const original = harness({ install: true });
  await original.run('/api/install', { context: CONTEXT, imageElementId, confirm: true });
  assert.ok(!original.calls.includes('evaluate'));
  assert.deepEqual(original.written.feature.parameters.find((entry) => entry.parameterId === 'plane').queries[0].deterministicIds, ['JDC']);
});

test('evaluation adapter supplies the captured queries map and context endpoint', async () => {
  let seen;
  const api = new OnshapeApi({ onshapeBaseUrl: 'https://cad.onshape.com', apiVersion: 'v17', authMode: 'bearer', bearerToken: 'test-token-only' }, {
    fetchImpl: async (url, init) => { seen = { url, body: JSON.parse(init.body) }; return new Response('{}', { status: 200 }); }
  });
  await api.evaluateFeatureScript(CONTEXT, 'function(context is Context, queries) { return []; }');
  assert.match(seen.url, /\/partstudios\/d\/.*\/w\/.*\/e\/.*\/featurescript$/);
  assert.deepEqual(seen.body.queries, {});
});

test('large candidate lists use one capped evaluation and explain unresolved entries', async () => {
  const list = { features: Array.from({ length: 100 }, (_, index) => ({ ...capturedPlane(), featureId: `plane${index}` })) };
  let count = 0;
  const result = await resolvePlaneCandidates(list, async (script) => { count += 1; return evaluation(script); });
  assert.equal(count, 1);
  assert.equal(result.filter((candidate) => candidate.query).length, MAX_PLANE_RESOLUTIONS);
  assert.equal(result.length, 103);
  assert.ok(result.at(-1).unavailableReason);
});
