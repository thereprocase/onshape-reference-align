import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseOnshapeUrl, contextToSearch } from '../public/url-context.mjs';
import { childEnv, reservePort, waitForHealth } from '../test/helpers/server.mjs';
import { createOnshapeStub, DEFAULT_KEYS as VALID_KEYS, DEFAULT_STUB_EMAIL as STUB_EMAIL, STUB_DOCUMENT } from '../test/helpers/onshape-stub.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The startup banner is written from the listen callback, which can race the
// first health response, so wait for the line rather than sampling it.
async function waitForStdout(pattern, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pattern.test(stdout)) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Timed out waiting for server output matching ${pattern}.`);
}

function cookieFrom(response) {
  const raw = response.headers.get('set-cookie');
  return raw?.split(';', 1)[0] || '';
}

// The project's own .env (if the maintainer has one) must never be touched
// by this run: the child is pointed at a throwaway --config path instead.
const projectEnvPath = path.join(root, '.env');
const projectEnvStatBefore = await fsp.stat(projectEnvPath).catch(() => undefined);

const port = await reservePort();
const stubPort = await reservePort();
const baseUrl = `http://127.0.0.1:${port}`;
const stubBaseUrl = `http://127.0.0.1:${stubPort}`;

const { server: onshapeStub, state: stubState, documentStub } = createOnshapeStub();
await new Promise((resolve) => onshapeStub.listen(stubPort, '127.0.0.1', resolve));

// Every wizard request body names the stub explicitly. Omitting baseUrl
// would make the candidate default to the real cad.onshape.com, and this
// script must never make an outbound call to anything but its own stub.
function wizardPayload(overrides = {}) {
  return { ...VALID_KEYS, baseUrl: stubBaseUrl, ...overrides };
}

// The child is given a throwaway config file rather than the project's own, so
// this run cannot read or write the maintainer's credentials and cannot reach
// Onshape however the checkout happens to be configured.
const configDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'reference-align-smoke-'));
const configPath = path.join(configDir, '.env');
await fsp.writeFile(configPath, [
  'HOST=127.0.0.1',
  `PORT=${port}`,
  `PUBLIC_BASE_URL=${baseUrl}`,
  'ONSHAPE_AUTH=none',
  `ONSHAPE_BASE_URL=${stubBaseUrl}`,
  'SESSION_SECRET=smoke-test-only-session-secret',
  // Without this the rebind route's backup would land in the checkout's own
  // backups/ directory. This run writes nothing outside its temp directory.
  `BACKUP_DIR=${path.join(configDir, 'backups')}`,
  'NODE_ENV=test',
  ''
].join('\n'));

let stdout = '';
let stderr = '';
const child = spawn(process.execPath, ['server.mjs', '--config', configPath], {
  cwd: root,
  env: childEnv(),
  stdio: ['ignore', 'pipe', 'pipe']
});
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', (chunk) => { stdout += chunk; });
child.stderr.on('data', (chunk) => { stderr += chunk; });

try {
  const healthResponse = await waitForHealth(baseUrl, child);
  const health = await healthResponse.json();
  assert.equal(health.ok, true);
  assert.equal(health.authMode, 'none');
  assert.equal(health.configSource, 'cli');
  const configLine = new RegExp(`Config: ${configPath.replace(/[\\^$*+?.()|[\]{}]/g, '\\$&')} \\(cli\\)`);
  await waitForStdout(configLine);

  // UPDATE_CHECK_URL is unset in this run's config file, so the update
  // banner route must report itself disabled without making any request.
  const updateResponse = await fetch(`${baseUrl}/api/update`);
  assert.equal(updateResponse.status, 200);
  assert.deepEqual(await updateResponse.json(), { disabled: true });

  const uiResponse = await fetch(`${baseUrl}/`);
  assert.equal(uiResponse.status, 200);
  assert.match(uiResponse.headers.get('content-type') || '', /text\/html/);
  assert.match(await uiResponse.text(), /Reference Align/);

  const fsResponse = await fetch(`${baseUrl}/assets/ReferenceImage.fs`);
  assert.equal(fsResponse.status, 200);
  assert.match(await fsResponse.text(), /Calibrated Reference Image/);

  // GET /api/bootstrap must never probe Onshape: it is on the hot path of
  // first paint and of every adoptContext() call.
  assert.equal(stubState.requestCount, 0);
  const bootstrapResponse = await fetch(`${baseUrl}/api/bootstrap`);
  assert.equal(bootstrapResponse.status, 200);
  const cookie = cookieFrom(bootstrapResponse);
  const bootstrap = await bootstrapResponse.json();
  assert.ok(cookie);
  assert.ok(bootstrap.csrfToken);
  assert.equal(bootstrap.auth.connection.state, 'unconfigured');
  assert.equal(bootstrap.setup.available, true);
  assert.equal(typeof bootstrap.setup.configPath, 'string');
  assert.ok(bootstrap.setup.configPath.length > 0);
  assert.equal(stubState.requestCount, 0);

  // GET /api/connection short-circuits on authMode 'none' with no probe.
  const connectionStart = Date.now();
  const connectionResponse = await fetch(`${baseUrl}/api/connection`);
  const connectionElapsedMs = Date.now() - connectionStart;
  assert.equal(connectionResponse.status, 200);
  const connection = await connectionResponse.json();
  assert.equal(connection.auth.connection.state, 'unconfigured');
  assert.ok(connectionElapsedMs < 1_000, `expected a fast unconfigured response, took ${connectionElapsedMs}ms`);
  assert.equal(stubState.requestCount, 0);

  // The wizard's gates, exercised end to end against the running server. The
  // CSRF gate is not probed here or anywhere else in this script:
  // test/route-gates.test.mjs boots the same server and loops over every
  // CSRF-gated entry in src/routes.mjs, which a hand-picked list of pathnames
  // in this file could never keep up with.
  const badFormat = await fetch(`${baseUrl}/api/setup/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': bootstrap.csrfToken },
    body: JSON.stringify({ accessKey: '', secretKey: '' })
  });
  assert.equal(badFormat.status, 400);
  assert.equal((await badFormat.json()).code, 'INVALID_KEY_FORMAT');
  assert.equal(stubState.requestCount, 0);

  const forwarded = await fetch(`${baseUrl}/api/setup/test`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
      'X-CSRF-Token': bootstrap.csrfToken,
      'X-Forwarded-For': '203.0.113.5'
    },
    body: JSON.stringify(wizardPayload())
  });
  assert.equal(forwarded.status, 403);
  const forwardedBody = await forwarded.json();
  assert.equal(forwardedBody.code, 'SETUP_UNAVAILABLE');
  assert.equal(forwardedBody.reason, 'FORWARDED_HEADER');
  assert.equal(stubState.requestCount, 0);

  const configBefore = await fsp.readFile(configPath, 'utf8');
  const testResponse = await fetch(`${baseUrl}/api/setup/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': bootstrap.csrfToken },
    body: JSON.stringify(wizardPayload())
  });
  assert.equal(testResponse.status, 200);
  const testBody = await testResponse.json();
  assert.equal(testBody.ok, true);
  assert.equal(testBody.accountName, 'Smoke Test User');
  assert.equal(await fsp.readFile(configPath, 'utf8'), configBefore, 'Test must not write the config file');
  assert.ok(stubState.requestCount >= 1);

  const saveResponse = await fetch(`${baseUrl}/api/setup/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': bootstrap.csrfToken },
    body: JSON.stringify(wizardPayload())
  });
  assert.equal(saveResponse.status, 200);
  const saveBody = await saveResponse.json();
  assert.equal(saveBody.ok, true);
  assert.equal(saveBody.auth.connection.state, 'connected');

  // Save takes effect with no restart: the very next request reflects it.
  const healthAfterSave = await (await fetch(`${baseUrl}/api/health`)).json();
  assert.equal(healthAfterSave.authMode, 'api-key-signature');
  const savedFile = await fsp.readFile(configPath, 'utf8');
  assert.match(savedFile, /ONSHAPE_AUTH=api-key-signature/);
  assert.match(savedFile, new RegExp(`ONSHAPE_ACCESS_KEY=${VALID_KEYS.accessKey}`));

  // Every stub connection came from loopback; nothing in this run reached a
  // real Onshape host.
  for (const address of stubState.remoteAddresses) {
    assert.ok(address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1', `unexpected remote address ${address}`);
  }

  // The policy settings routes carry the loopback guard as well as the shared
  // CSRF gate. What is worth proving with a real config directory underneath
  // is that a refused save leaves no settings file behind; the gates
  // themselves are covered route by route in test/route-gates.test.mjs.
  const settingsPath = path.join(configDir, 'settings.json');
  const settingsForwarded = await fetch(`${baseUrl}/api/settings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
      'X-CSRF-Token': bootstrap.csrfToken,
      'X-Forwarded-For': '203.0.113.5'
    },
    body: JSON.stringify({ allowSuppression: false })
  });
  assert.equal(settingsForwarded.status, 403);
  const settingsForwardedBody = await settingsForwarded.json();
  assert.equal(settingsForwardedBody.code, 'SETUP_UNAVAILABLE');
  assert.equal(settingsForwardedBody.reason, 'FORWARDED_HEADER');
  assert.equal(await fsp.access(settingsPath).then(() => true, () => false), false);

  const settingsBefore = await (await fetch(`${baseUrl}/api/settings`, { headers: { Cookie: cookie } })).json();
  assert.equal(settingsBefore.settings.allowSuppression, true);
  assert.equal(settingsBefore.exists, false);

  const settingsSave = await fetch(`${baseUrl}/api/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': bootstrap.csrfToken },
    body: JSON.stringify({ allowSuppression: false })
  });
  assert.equal(settingsSave.status, 200);
  assert.equal((await settingsSave.json()).settings.allowSuppression, false);
  assert.equal(JSON.parse(await fsp.readFile(settingsPath, 'utf8')).allowSuppression, false);

  // The saved policy reaches the browser on the next bootstrap, and the
  // capability model rides along with the auth summary.
  const bootstrapAfterSettings = await (await fetch(`${baseUrl}/api/bootstrap`, { headers: { Cookie: cookie } })).json();
  assert.equal(bootstrapAfterSettings.policy.allowSuppression, false);
  assert.equal(typeof bootstrapAfterSettings.auth.capabilities.features.updateFeature.allowed, 'boolean');
  const capabilities = bootstrapAfterSettings.auth.capabilities;
  assert.equal(capabilities.scopes.raw, 4099);
  assert.equal(capabilities.scopes.write, true);
  assert.equal(capabilities.scopes.delete, false);
  assert.deepEqual(capabilities.scopes.unknownBits, [4096]);
  assert.equal(capabilities.plan.group, 'Free');
  assert.equal(capabilities.plan.canCreatePrivateDocuments, false);
  assert.equal(capabilities.features.updateFeature.allowed, true);
  assert.equal(capabilities.features.deleteCleanup.allowed, false);
  assert.ok(
    !JSON.stringify(bootstrapAfterSettings).includes(STUB_EMAIL),
    'the bootstrap response must never carry the account email'
  );

  // A key that Onshape says has no write scope must stop Apply at this
  // server, with the model's own sentence and without one outbound request.
  // Re-saving the credentials bumps the config generation, which retires
  // every cached connection verdict, so the next probe sees the new mask.
  stubState.scopes = 1;
  const downgrade = await fetch(`${baseUrl}/api/setup/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': bootstrap.csrfToken },
    body: JSON.stringify(wizardPayload({ confirm: true }))
  });
  assert.equal(downgrade.status, 200);
  const downgradeBody = await downgrade.json();
  assert.equal(downgradeBody.auth.capabilities.scopes.raw, 1);
  assert.equal(downgradeBody.auth.capabilities.features.updateFeature.allowed, false);

  const requestsBeforeApply = stubState.requestCount;
  const applyDenied = await fetch(`${baseUrl}/api/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': bootstrap.csrfToken },
    body: JSON.stringify({
      itemId: 'anything',
      context: {
        documentId: '111111111111111111111111',
        workspaceOrVersion: 'w',
        workspaceOrVersionId: '222222222222222222222222',
        elementId: '333333333333333333333333'
      }
    })
  });
  assert.equal(applyDenied.status, 403);
  const applyDeniedBody = await applyDenied.json();
  assert.equal(applyDeniedBody.code, 'CAPABILITY_DENIED');
  assert.equal(applyDeniedBody.feature, 'updateFeature');
  assert.match(applyDeniedBody.reason, /Key lacks write scope/);
  assert.equal(applyDeniedBody.error, applyDeniedBody.reason);
  assert.equal(stubState.requestCount, requestsBeforeApply, 'a refused write must not reach Onshape');

  // ---- install, upload, rebind -------------------------------------------
  // Restore the write scope the downgrade above removed. Re-saving bumps the
  // config generation, which retires every cached connection verdict, so the
  // next probe sees the restored mask.
  stubState.scopes = 4099;
  const restoreScopes = await fetch(`${baseUrl}/api/setup/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': bootstrap.csrfToken },
    body: JSON.stringify(wizardPayload({ confirm: true }))
  });
  assert.equal(restoreScopes.status, 200);
  assert.equal((await restoreScopes.json()).auth.capabilities.features.installFeature.allowed, true);

  const stubContext = {
    documentId: STUB_DOCUMENT.documentId,
    workspaceOrVersion: 'w',
    workspaceOrVersionId: STUB_DOCUMENT.workspaceId,
    elementId: STUB_DOCUMENT.partStudioId
  };
  const stubSearch = contextToSearch(stubContext);
  const readHeaders = { Cookie: cookie };
  const writeHeaders = { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': bootstrap.csrfToken };
  const uploadHeaders = { Cookie: cookie, 'X-CSRF-Token': bootstrap.csrfToken };
  const uploadUrl = `${baseUrl}/api/upload-image?${stubSearch}`;
  const imageForm = (bytes, filename, type = 'image/png') => {
    const form = new FormData();
    form.append('file', new Blob([bytes], { type }), filename);
    form.append('confirm', 'true');
    return form;
  };

  // /api/apply's own context check must answer with the same status, code,
  // and wording requireWorkspaceContext gives install/rebind/suppress,
  // rather than the generic 400 it used to raise on its own.
  const applyNoContext = await fetch(`${baseUrl}/api/apply`, {
    method: 'POST',
    headers: writeHeaders,
    body: JSON.stringify({ itemId: 'anything', context: {} })
  });
  assert.equal(applyNoContext.status, 400);
  assert.equal((await applyNoContext.json()).code, 'CONTEXT_REQUIRED');

  const applyVersionContext = await fetch(`${baseUrl}/api/apply`, {
    method: 'POST',
    headers: writeHeaders,
    body: JSON.stringify({ itemId: 'anything', context: { ...stubContext, workspaceOrVersion: 'v' } })
  });
  assert.equal(applyVersionContext.status, 409);
  assert.equal((await applyVersionContext.json()).code, 'CONTEXT_READ_ONLY');

  // Nothing refused so far -- by CSRF, by the workspace-context check, or by
  // any other gate -- may have reached the document. The gate that runs first
  // and refuses hardest, CSRF, sits above the dispatch chains in server.mjs
  // and is proven route by route in test/route-gates.test.mjs.
  assert.equal(stubState.document.writes, 0, 'no refused request may reach Onshape');

  const statusBefore = await (await fetch(`${baseUrl}/api/install/status?${stubSearch}`, { headers: readHeaders })).json();
  assert.equal(statusBefore.available, true);
  assert.equal(statusBefore.install.state, 'not-installed');
  assert.deepEqual(statusBefore.install.imageElements, []);
  assert.deepEqual(statusBefore.install.instances, []);
  assert.equal(statusBefore.maxImageUploadBytes, 25 * 1024 * 1024);

  // confirmBeforeWrite defaults on, and it is this server that enforces it.
  const unconfirmedInstall = await fetch(`${baseUrl}/api/install`, {
    method: 'POST',
    headers: writeHeaders,
    body: JSON.stringify({ context: stubContext, imageElementId: 'a11ce0000000000000000120' })
  });
  assert.equal(unconfirmedInstall.status, 409);
  assert.equal((await unconfirmedInstall.json()).code, 'CONFIRM_REQUIRED');
  assert.equal(stubState.document.writes, 0, 'an unconfirmed install must write nothing');

  // With no image chosen the server names the tabs it would accept rather than
  // picking one.
  const noImage = await fetch(`${baseUrl}/api/install`, {
    method: 'POST',
    headers: writeHeaders,
    body: JSON.stringify({ context: stubContext, confirm: true })
  });
  assert.equal(noImage.status, 400);
  const noImageBody = await noImage.json();
  assert.equal(noImageBody.code, 'IMAGE_REQUIRED');
  assert.deepEqual(noImageBody.candidates, []);
  assert.equal(stubState.document.writes, 0);

  // The bytes decide the media type, not the part's Content-Type header.
  const trapUpload = await fetch(uploadUrl, {
    method: 'POST',
    headers: uploadHeaders,
    body: imageForm(Buffer.from('<html>not a png</html>', 'utf8'), 'trap.png')
  });
  assert.equal(trapUpload.status, 400);
  assert.equal((await trapUpload.json()).code, 'UNSUPPORTED_IMAGE_TYPE');
  assert.equal(stubState.document.writes, 0, 'a rejected upload must not reach Onshape');

  const unconfirmedUpload = await fetch(uploadUrl, {
    method: 'POST',
    headers: uploadHeaders,
    body: (() => {
      const form = new FormData();
      form.append('file', new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: 'image/png' }), 'x.png');
      return form;
    })()
  });
  assert.equal(unconfirmedUpload.status, 409);
  assert.equal((await unconfirmedUpload.json()).code, 'CONFIRM_REQUIRED');
  assert.equal(stubState.document.writes, 0);

  const iconBytes = await fsp.readFile(path.join(root, 'public/reference-align-icon.png'));
  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: uploadHeaders,
    body: imageForm(iconBytes, 'reference-align-icon.png')
  });
  const uploadText = await uploadResponse.text();
  assert.equal(uploadResponse.status, 200, uploadText);
  const uploaded = JSON.parse(uploadText);
  assert.equal(uploaded.ok, true);
  assert.equal(uploaded.elementId, 'a11ce0000000000000000120');
  assert.equal(uploaded.microversionId, 'a11ce0000000000000000010');
  assert.equal(uploaded.namespace, 'ea11ce0000000000000000120::ma11ce0000000000000000010');
  assert.equal(uploaded.mediaType, 'image/png');
  assert.equal(uploaded.byteLength, iconBytes.length);

  const installResponse = await fetch(`${baseUrl}/api/install`, {
    method: 'POST',
    headers: writeHeaders,
    body: JSON.stringify({ context: stubContext, imageElementId: uploaded.elementId, confirm: true })
  });
  const installText = await installResponse.text();
  assert.equal(installResponse.status, 200, installText);
  const installed = JSON.parse(installText);
  assert.equal(installed.ok, true);
  assert.equal(installed.created, true);
  assert.equal(installed.createdFeatureStudio, true);
  assert.equal(installed.itemId, `custom:${STUB_DOCUMENT.featureId}`);
  assert.equal(installed.imageNamespace, uploaded.namespace);
  // The stub answers ERROR for any namespace that does not resolve, exactly as
  // Onshape did, so an OK here is proof the route used the microversion from
  // the element listing rather than the stale one in the create response.
  assert.equal(installed.featureStatus, 'OK');
  assert.equal(installed.featureStudio.microversionId, STUB_DOCUMENT.featureStudioMicroversionAfterContents);
  assert.notEqual(installed.featureStudio.microversionId, STUB_DOCUMENT.featureStudioMicroversionAtCreate);

  // Idempotent: a second press finds the instance and writes nothing.
  const writesAfterInstall = stubState.document.writes;
  const installAgain = await fetch(`${baseUrl}/api/install`, {
    method: 'POST',
    headers: writeHeaders,
    body: JSON.stringify({ context: stubContext, imageElementId: uploaded.elementId, confirm: true })
  });
  assert.equal(installAgain.status, 200);
  const installedAgain = await installAgain.json();
  assert.equal(installedAgain.alreadyInstalled, true);
  assert.equal(installedAgain.created, false);
  assert.equal(installedAgain.featureId, STUB_DOCUMENT.featureId);
  assert.equal(stubState.document.writes, writesAfterInstall, 'a second install must write nothing');

  const statusAfter = await (await fetch(`${baseUrl}/api/install/status?${stubSearch}`, { headers: readHeaders })).json();
  assert.equal(statusAfter.install.state, 'instance-present');
  assert.equal(statusAfter.install.featureStudio.id, STUB_DOCUMENT.featureStudioId);
  assert.equal(statusAfter.install.instances[0].featureId, STUB_DOCUMENT.featureId);
  assert.equal(statusAfter.install.imageElements.length, 1);

  // ---- the duplicate cross-reference, end to end -------------------------
  // The stub's Part Studio starts with a native Insert image sketch bound to
  // the first blob, and the feature just installed is bound to that same blob.
  // Apply is what the browser presses, and its response is where the offer to
  // suppress the duplicate comes from.
  const calibration = {
    context: stubContext,
    itemId: `custom:${STUB_DOCUMENT.featureId}`,
    imageSize: { width: 1000, height: 500 },
    scalePair: { a: { x: 100, y: 250 }, b: { x: 700, y: 250 } },
    trueDistance: 6,
    distanceUnit: 'in',
    rotationPair: { a: { x: 100, y: 250 }, b: { x: 700, y: 250 } },
    rotationTarget: { mode: 'horizontal' },
    anchor: 'scale-a'
  };

  // Apply gets the same confirmation gate as install, upload, and rebind —
  // it is the write the whole product exists to make, so it is not the one
  // route the confirm-before-write switch fails to reach.
  const writesBeforeUnconfirmedApply = stubState.document.writes;
  const applyUnconfirmed = await fetch(`${baseUrl}/api/apply`, {
    method: 'POST',
    headers: writeHeaders,
    body: JSON.stringify(calibration)
  });
  assert.equal(applyUnconfirmed.status, 409);
  assert.equal((await applyUnconfirmed.json()).code, 'CONFIRM_REQUIRED');
  assert.equal(stubState.document.writes, writesBeforeUnconfirmedApply, 'an unconfirmed apply must write nothing');

  const applyResponse = await fetch(`${baseUrl}/api/apply`, {
    method: 'POST',
    headers: writeHeaders,
    body: JSON.stringify({ ...calibration, confirm: true })
  });
  const applyText = await applyResponse.text();
  assert.equal(applyResponse.status, 200, applyText);
  const applied = JSON.parse(applyText);
  assert.equal(applied.ok, true);
  assert.equal(applied.nativeDuplicates.length, 1);
  const duplicate = applied.nativeDuplicates[0];
  assert.equal(duplicate.itemId, STUB_DOCUMENT.sketchItemId);
  assert.equal(duplicate.confidence, 'exact');
  assert.equal(duplicate.basis, 'blob-element');
  assert.equal(duplicate.suppressed, false);
  // The sketch holds more than the image, and the offer has to say so.
  assert.ok(duplicate.otherSketchEntityCount > 0);

  // FINDINGS.md, E4: HTTP 200 proves nothing about a feature write. The stub
  // can force the next write's featureStatus, so apply is proven to check it
  // rather than believe the transport status the way install/rebind/suppress
  // already do.
  const writesBeforeForcedError = stubState.document.writes;
  stubState.document.forceFeatureStatus = 'ERROR';
  const applyForcedError = await fetch(`${baseUrl}/api/apply`, {
    method: 'POST',
    headers: writeHeaders,
    body: JSON.stringify({ ...calibration, confirm: true })
  });
  stubState.document.forceFeatureStatus = undefined;
  assert.equal(applyForcedError.status, 409);
  const applyForcedErrorBody = await applyForcedError.json();
  assert.equal(applyForcedErrorBody.code, 'FEATURE_STATUS_NOT_OK');
  assert.equal(applyForcedErrorBody.featureStatus, 'ERROR');
  assert.ok(applyForcedErrorBody.backupFile, 'the backup written before the doomed write is still named');
  assert.equal(stubState.document.writes, writesBeforeForcedError + 1, 'the write still happened; only the report is a refusal');

  const secondUpload = await (await fetch(uploadUrl, {
    method: 'POST',
    headers: uploadHeaders,
    body: imageForm(iconBytes, 'reference-align-icon-b.png')
  })).json();
  assert.equal(secondUpload.elementId, 'a11ce0000000000000000026');

  const itemId = `custom:${STUB_DOCUMENT.featureId}`;
  const rebindUnconfirmed = await fetch(`${baseUrl}/api/rebind`, {
    method: 'POST',
    headers: writeHeaders,
    body: JSON.stringify({ context: stubContext, itemId, elementId: secondUpload.elementId, microversionId: secondUpload.microversionId })
  });
  assert.equal(rebindUnconfirmed.status, 409);
  assert.equal((await rebindUnconfirmed.json()).code, 'CONFIRM_REQUIRED');

  const writesBeforeBadRebind = stubState.document.writes;
  const rebindBadId = await fetch(`${baseUrl}/api/rebind`, {
    method: 'POST',
    headers: writeHeaders,
    body: JSON.stringify({ context: stubContext, itemId, elementId: secondUpload.elementId, microversionId: 'not-a-microversion', confirm: true })
  });
  assert.equal(rebindBadId.status, 400);
  assert.equal((await rebindBadId.json()).code, 'INVALID_IMAGE_REFERENCE');
  assert.equal(stubState.document.writes, writesBeforeBadRebind, 'a malformed namespace must never be stored');

  const rebindResponse = await fetch(`${baseUrl}/api/rebind`, {
    method: 'POST',
    headers: writeHeaders,
    body: JSON.stringify({ context: stubContext, itemId, elementId: secondUpload.elementId, microversionId: secondUpload.microversionId, confirm: true })
  });
  const rebindText = await rebindResponse.text();
  assert.equal(rebindResponse.status, 200, rebindText);
  const rebound = JSON.parse(rebindText);
  assert.equal(rebound.featureStatus, 'OK');
  assert.equal(rebound.namespace, `e${secondUpload.elementId}::m${secondUpload.microversionId}`);
  assert.equal(rebound.item.id, itemId);
  assert.ok(rebound.backupFile, 'a rebind writes a backup before it writes to Onshape');
  const backup = JSON.parse(await fsp.readFile(path.join(configDir, 'backups', rebound.backupFile), 'utf8'));
  assert.equal(backup.operation, 'rebind');
  assert.equal(backup.proposedUpdate.feature.parameters[0].namespace, rebound.namespace);

  // ---- suppressing the duplicate native sketch ---------------------------
  // The rebind above pointed the feature at the second blob, so it and the
  // sketch no longer show the same file. The cross-reference has to notice:
  // a different blob element is positive evidence against a duplicate, not a
  // reason to shrug and offer it anyway.
  const applyAfterRebind = await fetch(`${baseUrl}/api/apply`, {
    method: 'POST',
    headers: writeHeaders,
    body: JSON.stringify({ ...calibration, confirm: true })
  });
  assert.equal(applyAfterRebind.status, 200);
  assert.deepEqual((await applyAfterRebind.json()).nativeDuplicates, []);

  const contextItems = await (await fetch(`${baseUrl}/api/context?${stubSearch}`, { headers: readHeaders })).json();
  const nativeItem = contextItems.items.find((item) => item.id === STUB_DOCUMENT.sketchItemId);
  assert.ok(nativeItem, 'the native sketch image is in the target list');
  assert.equal(nativeItem.suppressed, false);
  assert.equal(nativeItem.image.blobElementId, STUB_DOCUMENT.sketchBlobElementId);
  // Native geometry writes are off by default, so this item is not editable —
  // and suppression still has to work, because it touches one documented
  // boolean and no geometry.
  assert.equal(nativeItem.editable, false);

  // The settings section above left this switch off, which is exactly the
  // state a fresh operator would not be in. Turn it on explicitly rather than
  // inheriting it, so the refusals below are the ones under test.
  const allowSuppression = await fetch(`${baseUrl}/api/settings`, {
    method: 'POST',
    headers: writeHeaders,
    body: JSON.stringify({ allowSuppression: true })
  });
  assert.equal(allowSuppression.status, 200);

  const writesBeforeSuppress = stubState.document.writes;
  const suppressBody = (overrides) => JSON.stringify({
    context: stubContext,
    itemId: STUB_DOCUMENT.sketchItemId,
    ...overrides
  });

  // Suppression is confirmed every time, and it is a 400 because confirm is a
  // required field of this request rather than a refusal by policy.
  const suppressUnconfirmed = await fetch(`${baseUrl}/api/suppress`, {
    method: 'POST',
    headers: writeHeaders,
    body: suppressBody({ suppressed: true })
  });
  assert.equal(suppressUnconfirmed.status, 400);
  assert.equal((await suppressUnconfirmed.json()).code, 'CONFIRM_REQUIRED');

  const suppressBadFlag = await fetch(`${baseUrl}/api/suppress`, {
    method: 'POST',
    headers: writeHeaders,
    body: suppressBody({ suppressed: 'true', confirm: true })
  });
  assert.equal(suppressBadFlag.status, 400);
  assert.equal((await suppressBadFlag.json()).code, 'SUPPRESSED_REQUIRED');
  assert.equal(stubState.document.writes, writesBeforeSuppress, 'a rejected suppression must write nothing');

  // The operator's own switch, enforced here and announced to the browser in
  // the same words.
  await fetch(`${baseUrl}/api/settings`, {
    method: 'POST',
    headers: writeHeaders,
    body: JSON.stringify({ allowSuppression: false })
  });
  const suppressDenied = await fetch(`${baseUrl}/api/suppress`, {
    method: 'POST',
    headers: writeHeaders,
    body: suppressBody({ suppressed: true, confirm: true })
  });
  assert.equal(suppressDenied.status, 403);
  const suppressDeniedBody = await suppressDenied.json();
  assert.equal(suppressDeniedBody.code, 'POLICY_DENIED');
  assert.equal(suppressDeniedBody.feature, 'suppressFeature');
  const suppressGates = await (await fetch(`${baseUrl}/api/bootstrap`, { headers: readHeaders })).json();
  assert.equal(suppressGates.gates.suppressFeature, suppressDeniedBody.reason);
  assert.equal(stubState.document.writes, writesBeforeSuppress, 'a refused suppression must not reach Onshape');
  await fetch(`${baseUrl}/api/settings`, {
    method: 'POST',
    headers: writeHeaders,
    body: JSON.stringify({ allowSuppression: true })
  });

  const suppressResponse = await fetch(`${baseUrl}/api/suppress`, {
    method: 'POST',
    headers: writeHeaders,
    body: suppressBody({ suppressed: true, confirm: true })
  });
  const suppressText = await suppressResponse.text();
  assert.equal(suppressResponse.status, 200, suppressText);
  const suppressed = JSON.parse(suppressText);
  assert.equal(suppressed.ok, true);
  assert.equal(suppressed.changed, true);
  assert.equal(suppressed.suppressed, true);
  assert.equal(suppressed.featureStatus, 'OK');
  assert.equal(suppressed.items.find((item) => item.id === STUB_DOCUMENT.sketchItemId).suppressed, true);
  const suppressBackup = JSON.parse(await fsp.readFile(path.join(configDir, 'backups', suppressed.backupFile), 'utf8'));
  assert.equal(suppressBackup.operation, 'suppress');
  assert.equal(suppressBackup.proposedUpdate.feature.suppressed, true);
  assert.equal(suppressBackup.proposedUpdate.feature.entities.length, 5, 'the whole sketch goes back, not a fragment of it');

  // A second press, or a second tab, must not write again.
  const writesAfterSuppress = stubState.document.writes;
  const suppressAgain = await (await fetch(`${baseUrl}/api/suppress`, {
    method: 'POST',
    headers: writeHeaders,
    body: suppressBody({ suppressed: true, confirm: true })
  })).json();
  assert.equal(suppressAgain.changed, false);
  assert.equal(suppressAgain.backupFile, null);
  assert.equal(stubState.document.writes, writesAfterSuppress, 'an unchanged suppression must write nothing');

  const unsuppressed = await (await fetch(`${baseUrl}/api/suppress`, {
    method: 'POST',
    headers: writeHeaders,
    body: suppressBody({ suppressed: false, confirm: true })
  })).json();
  assert.equal(unsuppressed.changed, true);
  assert.equal(unsuppressed.suppressed, false);
  assert.equal(unsuppressed.items.find((item) => item.id === STUB_DOCUMENT.sketchItemId).suppressed, false);

  // A policy switch turned off refuses the write at this server, with the
  // gate's own sentence and without one outbound request.
  const uploadOff = await fetch(`${baseUrl}/api/settings`, {
    method: 'POST',
    headers: writeHeaders,
    body: JSON.stringify({ allowImageUpload: false })
  });
  assert.equal(uploadOff.status, 200);
  const writesBeforeDenied = stubState.document.writes;
  const uploadDenied = await fetch(uploadUrl, {
    method: 'POST',
    headers: uploadHeaders,
    body: imageForm(iconBytes, 'reference-align-icon.png')
  });
  assert.equal(uploadDenied.status, 403);
  const uploadDeniedBody = await uploadDenied.json();
  assert.equal(uploadDeniedBody.code, 'POLICY_DENIED');
  assert.equal(uploadDeniedBody.feature, 'uploadImage');
  assert.equal(uploadDeniedBody.error, uploadDeniedBody.reason);
  assert.match(uploadDeniedBody.reason, /Upload images/);
  assert.equal(stubState.document.writes, writesBeforeDenied, 'a refused upload must not reach Onshape');

  // And the browser is told the same sentence before the button is pressed.
  const gatesBootstrap = await (await fetch(`${baseUrl}/api/bootstrap`, { headers: readHeaders })).json();
  assert.equal(gatesBootstrap.gates.uploadImage, uploadDeniedBody.reason);
  assert.equal(gatesBootstrap.gates.installFeature, '');
  assert.equal(gatesBootstrap.gates.updateFeature, '');
  assert.match(gatesBootstrap.gates.deleteCleanup, /delete scope/);

  await fetch(`${baseUrl}/api/settings`, {
    method: 'POST',
    headers: writeHeaders,
    body: JSON.stringify({ allowImageUpload: true })
  });

  const previewResponse = await fetch(`${baseUrl}/api/preview`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
      'X-CSRF-Token': bootstrap.csrfToken
    },
    body: JSON.stringify({
      imageSize: { width: 1000, height: 500 },
      currentPlacement: { originX: 0, originY: 0, width: 0.5, angle: 0.2 },
      scalePair: { a: { x: 100, y: 250 }, b: { x: 700, y: 250 } },
      trueDistance: 6,
      distanceUnit: 'in',
      rotationPair: { a: { x: 100, y: 250 }, b: { x: 700, y: 250 } },
      rotationTarget: { mode: 'horizontal' },
      anchor: 'scale-a'
    })
  });
  const previewText = await previewResponse.text();
  assert.equal(previewResponse.status, 200, previewText);
  const preview = JSON.parse(previewText);
  assert.ok(Math.abs(preview.placement.width - 0.254) < 1e-12);
  assert.ok(Math.abs(preview.placement.angle) < 1e-12);
  assert.ok(Math.abs(preview.diagnostics.scalePairAfterLength - 0.1524) < 1e-12);
  assert.ok(preview.diagnostics.anchorResidual < 1e-12);

  // Every browser module app.js imports, taken from the embedded-asset list
  // rather than hand-listed here. A module that is not served is not a
  // degraded page: the import fails and app.js never runs at all, so this has
  // to cover whatever public/ actually holds today, not whatever it held when
  // this line was written.
  const seaConfig = JSON.parse(await fsp.readFile(path.join(root, 'sea-config.json'), 'utf8'));
  const browserModules = Object.keys(seaConfig.assets).filter((key) => /^public\/.+\.m?js$/.test(key));
  assert.ok(browserModules.length >= 5, `expected several browser modules, found ${browserModules.length}`);
  for (const key of browserModules) {
    const moduleResponse = await fetch(`${baseUrl}/${key.replace(/^public\//, '')}`);
    assert.equal(moduleResponse.status, 200, key);
    assert.match(moduleResponse.headers.get('content-type') || '', /javascript/, key);
  }

  // Round trip: the parser's canonical query string must be exactly what
  // server.mjs normalizeContext() expects, with no manual re-encoding.
  const workspaceContext = parseOnshapeUrl(
    'https://cad.onshape.com/documents/111111111111111111111111/w/222222222222222222222222/e/333333333333333333333333'
  ).context;
  const workspaceBootstrap = await fetch(`${baseUrl}/api/bootstrap?${contextToSearch(workspaceContext)}`);
  assert.equal(workspaceBootstrap.status, 200);
  const workspaceBody = await workspaceBootstrap.json();
  assert.equal(workspaceBody.context.complete, true);
  assert.deepEqual(
    {
      documentId: workspaceBody.context.documentId,
      workspaceOrVersion: workspaceBody.context.workspaceOrVersion,
      workspaceOrVersionId: workspaceBody.context.workspaceOrVersionId,
      elementId: workspaceBody.context.elementId,
      complete: workspaceBody.context.complete
    },
    workspaceContext
  );

  const versionContext = parseOnshapeUrl(
    'https://cad.onshape.com/documents/111111111111111111111111/v/444444444444444444444444/e/333333333333333333333333'
  ).context;
  const versionBootstrap = await fetch(`${baseUrl}/api/bootstrap?${contextToSearch(versionContext)}`);
  assert.equal(versionBootstrap.status, 200);
  const versionBody = await versionBootstrap.json();
  assert.equal(versionBody.context.complete, true);
  assert.equal(versionBody.context.workspaceOrVersion, 'v');

  const fullOutput = stdout + stderr;
  assert.ok(!fullOutput.includes(VALID_KEYS.accessKey), 'server output must never contain the submitted access key');
  assert.ok(!fullOutput.includes(VALID_KEYS.secretKey), 'server output must never contain the submitted secret key');
  assert.ok(!fullOutput.includes(STUB_EMAIL), 'server output must never contain the account email');

  const projectEnvStatAfter = await fsp.stat(projectEnvPath).catch(() => undefined);
  assert.equal(projectEnvStatAfter?.mtimeMs, projectEnvStatBefore?.mtimeMs, 'the project .env must be untouched by this run');

  process.stdout.write('HTTP smoke test passed.\n');
} finally {
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 2_000);
  await new Promise((resolve) => child.once('exit', resolve));
  clearTimeout(timer);
  if (child.exitCode && child.exitCode !== 0 && child.signalCode !== 'SIGTERM') {
    process.stderr.write(`Server stdout:\n${stdout}\nServer stderr:\n${stderr}\n`);
  }
  await new Promise((resolve) => onshapeStub.close(resolve));
  await fsp.rm(configDir, { recursive: true, force: true });
}
