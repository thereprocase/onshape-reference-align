import test from 'node:test';
import assert from 'node:assert/strict';
import { replaneBlockReason } from '../public/write-gates.mjs';
import fs from 'node:fs';
import vm from 'node:vm';

const script = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

function input() {
  return {
    state: { context: { complete: true, workspaceOrVersion: 'w' }, selectedItem: { id: 'custom:one', kind: 'custom' }, install: { planes: [{ id: 'default:Top', label: 'Top' }, { id: 'default:Right', label: 'Right' }, { id: 'plane:later', label: 'Later', unavailableReason: 'Plane must precede the image.' }], selectedPlane: { id: 'default:Top' } } },
    auth: { canRequest: true }, gates: {}
  };
}

test('changing planes permits another upstream plane but explains same, unavailable and unknown candidates', () => {
  const value = input();
  assert.equal(replaneBlockReason(value, 'default:Right'), '');
  assert.match(replaneBlockReason(value, 'default:Top'), /already on/);
  assert.equal(replaneBlockReason(value, 'plane:later'), 'Plane must precede the image.');
  assert.equal(replaneBlockReason(value, 'missing'), 'Choose a plane.');
});

test('plane changes respect server policy, read-only context, target kind and pending discovery', () => {
  let value = input();
  value.gates.installFeature = 'Installing features is switched off.';
  assert.equal(replaneBlockReason(value, 'default:Right'), value.gates.installFeature);
  value = input(); value.state.context.workspaceOrVersion = 'v';
  assert.match(replaneBlockReason(value, 'default:Right'), /read-only/);
  value = input(); value.state.selectedItem.kind = 'native';
  assert.match(replaneBlockReason(value, 'default:Right'), /calibrated/);
  value = input(); value.state.install.planesLoading = true;
  assert.match(replaneBlockReason(value, 'default:Right'), /Checking/);
  value = input(); value.state.install.planeError = 'Refresh failed.';
  assert.equal(replaneBlockReason(value, 'default:Right'), 'Refresh failed.');
  value = input(); value.state.install.busy = true;
  assert.equal(replaneBlockReason(value, 'default:Right'), 'Working…');
});

test('an older plane discovery response cannot overwrite the newly selected target', async () => {
  const state = input().state;
  state.bootstrap = { auth: { canRequest: true } };
  state.install.statusGeneration = 0;
  const pending = [];
  const context = vm.createContext({ state,
    $() { return { value: '' }; },
    apiFetch(url) { return new Promise(resolve => pending.push({ url, resolve })); },
    withContext(path, extra) { return `${path}?itemId=${extra.itemId}`; },
    planeContextKey() { return JSON.stringify([state.context, state.selectedItem.id]); },
    renderPlaneControls() {}, renderInstallCard() {}, updateControlStates() {}, toast() {}, describeApiError(error) { return error.message; }
  });
  vm.runInContext(script.slice(script.indexOf('async function loadInstallStatus('), script.indexOf('// The policy switch is enforced')), context);
  const first = vm.runInContext('loadInstallStatus()', context);
  state.selectedItem = { kind: 'custom', id: 'custom:two' };
  const second = vm.runInContext('loadInstallStatus()', context);
  assert.match(pending[0].url, /custom:one/);
  assert.match(pending[1].url, /custom:two/);
  pending[1].resolve({ planes: [{ id: 'default:Right', label: 'Right' }], selectedPlane: { id: 'default:Right' } });
  await second;
  pending[0].resolve({ planes: [{ id: 'default:Top', label: 'Top' }], selectedPlane: { id: 'default:Top' } });
  await first;
  assert.equal(state.install.planes[0].id, 'default:Right');
  assert.equal(state.install.selectedPlane.id, 'default:Right');
  assert.equal(state.install.planesLoading, false);
});

test('replane cancellation sends nothing, and accepted request carries frozen target and confirm', async () => {
  const state = input().state;
  const nodes = { replaneSelect: { value: 'default:Right' }, replaneStatus: {} };
  let confirmed = false;
  const requests = [];
  const context = vm.createContext({ state, $: id => nodes[id],
    replaneBlockReason, writeGateInput: () => ({ state, auth: { canRequest: true }, gates: {} }),
    confirmWrite: () => confirmed, planeContextKey: () => JSON.stringify([state.context, state.selectedItem.id]),
    updateControlStates() {}, renderFeatureSelect() {}, markResultStale() {}, refreshFeatures: async () => {}, loadInstallStatus: async () => {},
    apiFetch: async (path, options) => { requests.push({ path, body: JSON.parse(options.body) }); return { plane: { label: 'Right' }, itemsStale: true }; },
    describeApiError(error) { return error.message; }
  });
  const start = script.indexOf('async function handleReplaneClick(');
  vm.runInContext(script.slice(start, script.indexOf('\n// ---------------------------------------------------------------------------', start)), context);
  await vm.runInContext('handleReplaneClick()', context);
  assert.equal(requests.length, 0);
  confirmed = true;
  await vm.runInContext('handleReplaneClick()', context);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, '/api/replane');
  assert.equal(requests[0].body.itemId, 'custom:one');
  assert.equal(requests[0].body.planeId, 'default:Right');
  assert.equal(requests[0].body.confirm, true);
  assert.match(nodes.replaneStatus.textContent, /Plane changed to Right/);
});

test('confirmed install keeps its plane and context while an upload is pending', async () => {
  const state = { install: {}, context: { documentId: 'A' }, sourceName: 'image.png', items: [] };
  const plane = { value: 'default:Front' };
  let finishUpload;
  let request;
  const context = vm.createContext({ state, elements: { installImageSelect: { value: '__upload__' } }, $: () => plane, UPLOAD_OPTION: '__upload__', confirmWrite: () => true,
    setInstallError() {}, setInstallStatus() {}, updateControlStates() {}, toast() {}, renderFeatureSelect() {}, refreshFeatures: async () => {}, loadInstallStatus: async () => {},
    uploadLoadedImage: () => new Promise(resolve => { finishUpload = resolve; }),
    apiFetch: async (path, options) => { request = JSON.parse(options.body); return {}; }, installFailureText: error => error.message
  });
  vm.runInContext(script.slice(script.indexOf('async function handleInstallClick('), script.indexOf('async function handleUploadAndUseClick(')), context);
  const pending = vm.runInContext('handleInstallClick()', context);
  plane.value = 'default:Top'; state.context = { documentId: 'B' };
  finishUpload({ elementId: 'uploaded' }); await pending;
  assert.equal(request.planeId, 'default:Front');
  assert.equal(request.context.documentId, 'A');
});

test('a delayed feature refresh cannot replace another document or clear its busy state', async () => {
  const state = { context: { complete: true, documentId: 'A' }, bootstrap: { auth: { canRequest: true } }, items: [] };
  const pending = [];
  const context = vm.createContext({ state, activeFlyout: null, elements: { featureSelect: { value: '' }, contextMessage: {} }, $: () => ({ dataset: {} }),
    setBusy(value) { state.busy = value; }, withContext: () => '/api/context', apiFetch: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
    renderFeatureSelect() {}, renderSuppressionOffer() {}, loadInstallStatus: async () => {}, toast() {}, renderBootstrap() {}, describeApiError: error => error.message
  });
  vm.runInContext(script.slice(script.indexOf('let featureRefreshGeneration = 0;'), script.indexOf('function preservedExtras(')), context);
  const a = vm.runInContext('refreshFeatures()', context);
  state.context = { complete: true, documentId: 'B' };
  const b = vm.runInContext('refreshFeatures()', context);
  pending[0].resolve({ items: [{ id: 'A-image' }] }); await a;
  assert.equal(state.items.length, 0);
  assert.equal(state.busy, true);
  pending[1].resolve({ items: [{ id: 'B-image' }] }); await b;
  assert.equal(state.items[0].id, 'B-image');
  assert.equal(state.busy, false);
  const c = vm.runInContext('refreshFeatures()', context);
  state.context = { complete: true, documentId: 'C' };
  pending[2].reject(Object.assign(new Error('old key failure'), { status: 401 })); await c;
  assert.equal(state.bootstrap.auth.canRequest, true);
});

test('replane invalidates old-frame preview even when regeneration or response fails', async () => {
  for (const code of ['FEATURE_STATUS_NOT_OK', 'TIMEOUT']) {
    const state = input().state; state.result = { oldPlane: true }; state.resultSignature = 'old';
    const context = vm.createContext({ state, $: id => id === 'replaneSelect' ? { value: 'default:Right' } : {},
      replaneBlockReason, writeGateInput: () => ({ state, auth: { canRequest: true }, gates: {} }), confirmWrite: () => true, planeContextKey: () => 'unchanged', updateControlStates() {},
      markResultStale() { state.result = undefined; state.resultSignature = undefined; },
      apiFetch: async () => { throw Object.assign(new Error(code), { payload: { code } }); }, describeApiError: error => error.message, loadInstallStatus: async () => {}
    });
    const start = script.indexOf('async function handleReplaneClick(');
    vm.runInContext(script.slice(start, script.indexOf('\n// ---------------------------------------------------------------------------', start)), context);
    await vm.runInContext('handleReplaneClick()', context);
    assert.equal(state.result, undefined, code); assert.equal(state.resultSignature, undefined, code);
  }
});
