/** Live HTTP acceptance. Creates only a new scratch document in the test folder. */
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getConfig } from '../src/config.mjs';
import { OnshapeApi } from '../src/onshape-api.mjs';
import { featureAddPayload, readFeatureStatus } from '../src/onshape-model.mjs';
import { resolveSettingsFile } from '../src/config-paths.mjs';
import { readSettingsFile } from '../src/settings.mjs';
import { parsePlaneArgs, redactPlaneCapture } from './experiment-plane.mjs';
import { requireScratchFolder } from './live-target.mjs';

// Onshape assigns fresh serialization node ids after every accepted update.
// Compare all persisted model fields while ignoring only that transport id.
function modelFields(value) {
  if (Array.isArray(value)) return value.map(modelFields);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== 'nodeId').map(([key, child]) => [key, modelFields(child)]));
  return value;
}

async function main() {
  const options = parsePlaneArgs(process.argv.slice(2));
  if (!options.createDocument) throw new Error('This verification requires --create-document to keep every write in a fresh scratch document.');
  const config = getConfig();
  const { settings } = await readSettingsFile(resolveSettingsFile(config.envFilePath));
  if (settings.allowDocumentCreation === false || settings.allowFeatureInstall === false || settings.allowImageUpload === false) throw new Error('Scratch creation, feature installation and image upload must be enabled.');
  const scratchFolderId = requireScratchFolder(settings);
  const api = new OnshapeApi(config);
  const secrets = [config.accessKey, config.secretKey, config.bearerToken, config.oauth?.clientSecret];
  const dir = await fsp.mkdtemp(path.join(config.projectRoot, 'docs', 'experiments', `${new Date().toISOString().slice(0, 10)}-product-verify-`));
  const summary = { passed: false, checks: [] };
  let sequence = 0;
  let child;
  const record = async (name, value) => fsp.writeFile(path.join(dir, `${String(++sequence).padStart(2, '0')}-${name}.json`), JSON.stringify(redactPlaneCapture(value, secrets), null, 2) + '\n');
  const check = name => { summary.checks.push(name); console.log(name + ': PASS'); };
  try {
    const body = { name: 'Reference Align product acceptance', parentId: scratchFolderId, isPublic: false };
    let doc;
    try { doc = await (await api.request('/documents', { method: 'POST', body })).json(); }
    catch (error) {
      if (error.status !== 409 || !/free accounts only allow access to public documents/i.test(error.body?.message || '')) throw error;
      console.log('Creating the authorized PUBLIC scratch document.');
      doc = await (await api.request('/documents', { method: 'POST', body: { ...body, isPublic: true } })).json();
    }
    assert.match(doc.id, /^[a-f0-9]{24}$/i);
    assert.notEqual(doc.id.toLowerCase(), 'a11ce0000000000000000143');
    const context = { documentId: doc.id, workspaceOrVersion: 'w', workspaceOrVersionId: doc.defaultWorkspace.id };
    const elements = await api.listElements(context);
    context.elementId = elements.find(element => element.elementType === 'PARTSTUDIO').id;
    Object.assign(summary, { context, documentUrl: `https://cad.onshape.com/documents/${context.documentId}/w/${context.workspaceOrVersionId}/e/${context.elementId}` });
    await record('scratch-document', summary);
    const env = { ...process.env, HOST: '127.0.0.1', PORT: '0', PUBLIC_BASE_URL: '', BACKUP_DIR: path.join(dir, 'backups'), UPDATE_CHECK_URL: '', NODE_ENV: 'production' };
    child = spawn(process.execPath, ['server.mjs', '--config', config.envFilePath, '--no-open'], { cwd: config.projectRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let launchFailed = false;
    child.on('error', () => { launchFailed = true; });
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', () => {});
    const deadline = Date.now() + 10000;
    while (!stdout.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/)) {
      if (launchFailed || child.exitCode !== null || Date.now() > deadline) throw new Error('Verification server did not start.');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const base = `http://127.0.0.1:${stdout.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/)[1]}`;
    const bootstrap = await fetch(base + '/api/bootstrap', { signal: AbortSignal.timeout(10000) });
    const cookie = bootstrap.headers.get('set-cookie').split(';', 1)[0];
    const { csrfToken } = await bootstrap.json();
    const headers = { Cookie: cookie, 'X-CSRF-Token': csrfToken };
    const search = new URLSearchParams(context).toString();
    async function request(name, route, body, expected = 200) {
      const multipart = body instanceof FormData;
      const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST', headers: { ...headers, ...(!multipart && body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: multipart ? body : body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(45000) });
      const data = await response.json();
      await record(name, { route, status: response.status, response: data });
      assert.equal(response.status, expected, `${name}: ${JSON.stringify(redactPlaneCapture(data, secrets))}`);
      return data;
    }
    const before = await request('planes-before', '/api/install/status?' + search);
    assert.ok(['Top', 'Front', 'Right'].every(label => before.planes.some(plane => plane.label === label && plane.query)));
    check('default plane candidates');
    const parameter = (label, id) => ({ ...structuredClone(before.planes.find(plane => plane.label === label).query), parameterId: id });
    const add = async (name, feature) => {
      const result = await api.addFeature(context, featureAddPayload(await api.getFeatures(context), feature));
      await record(name, result);
      assert.equal(readFeatureStatus(result).status, 'OK');
      return result.feature.featureId;
    };
    const planeId = await add('user-plane', { btType: 'BTMFeature-134', featureType: 'cPlane', name: 'Acceptance offset plane', parameters: [
      { btType: 'BTMParameterEnum-145', parameterId: 'cplaneType', enumName: 'CPlaneType', value: 'OFFSET' }, parameter('Top', 'entities'),
      { btType: 'BTMParameterQuantity-147', parameterId: 'offset', expression: '0.01 m', isInteger: false, value: 0, units: '' },
      { btType: 'BTMParameterBoolean-144', parameterId: 'oppositeDirection', value: false }
    ] });
    const sketchId = await add('front-sketch', { btType: 'BTMSketch-151', featureType: 'newSketch', name: 'Acceptance Front sketch', suppressed: false, parameters: [parameter('Front', 'sketchPlane')], entities: [], constraints: [] });
    const form = new FormData();
    form.append('file', new Blob([await fsp.readFile(path.join(config.publicDir, 'reference-align-icon.png'))], { type: 'image/png' }), 'acceptance.png');
    form.append('confirm', 'true');
    const upload = await request('upload', '/api/upload-image?' + search, form);
    const installed = await request('install-front', '/api/install', { context, imageElementId: upload.elementId, planeId: 'default:Front', confirm: true });
    assert.equal(installed.featureStatus, 'OK');
    check('upload and install on Front through HTTP');
    const itemId = installed.itemId;
    const status = await request('planes-after', '/api/install/status?' + search + '&itemId=' + encodeURIComponent(itemId));
    assert.ok(status.planes.some(plane => plane.id === `plane:${planeId}` && !plane.unavailableReason));
    assert.ok(status.planes.some(plane => plane.id === `sketch:${sketchId}` && !plane.unavailableReason));
    check('user plane and sketch candidates');
    const feature = async () => (await api.getFeatures(context)).features.find(feature => feature.featureId === installed.featureId);
    const original = await feature();
    const nonplane = feature => modelFields(feature.parameters.filter(parameter => parameter.parameterId !== 'plane'));
    for (const target of ['default:Right', `plane:${planeId}`, `sketch:${sketchId}`]) {
      const result = await request('replane-' + target.replace(':', '-'), '/api/replane', { context, itemId, planeId: target, confirm: true });
      assert.equal(result.featureStatus, 'OK');
      assert.ok(result.backupFile);
      assert.deepEqual(nonplane(await feature()), nonplane(original));
      check('replane ' + target);
    }
    const calibration = { context, itemId, imageSize: { width: 256, height: 256 }, scalePair: { a: { x: 50, y: 160 }, b: { x: 200, y: 160 } }, trueDistance: 6, distanceUnit: 'in', rotationPair: { a: { x: 80, y: 160 }, b: { x: 160, y: 80 } }, rotationMode: 'horizontal', anchor: 'scale-a', confirm: true };
    const preview = await request('preview', '/api/preview', calibration);
    assert.ok(preview.placement?.width > 0);
    assert.ok(preview.diagnostics.anchorResidual < 1e-8);
    const oldPlane = (await feature()).parameters.find(parameter => parameter.parameterId === 'plane');
    const applied = await request('apply', '/api/apply', calibration);
    assert.equal(applied.featureState.featureStatus, 'OK');
    assert.deepEqual(modelFields((await feature()).parameters.find(parameter => parameter.parameterId === 'plane')), modelFields(oldPlane));
    check('separate scale/rotation preview and apply preserving plane');
    summary.passed = true;
  } catch (error) {
    summary.error = redactPlaneCapture(error.message, secrets);
    process.exitCode = 1;
  } finally {
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
      child.kill('SIGTERM');
      await exited;
      clearTimeout(timer);
    }
    await fsp.writeFile(path.join(dir, 'summary.json'), JSON.stringify(redactPlaneCapture(summary, secrets), null, 2) + '\n');
    console.log(`Captures: ${dir}`);
    if (summary.error) console.log(summary.error);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('Verification refused or could not start. Check explicit scratch flags and configuration.'); process.exitCode = 1; });
}
