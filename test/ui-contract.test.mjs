import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Static ids that app.js never reaches through $('id') (e.g. only used as an
// aria-describedby target, or set up before app.js runs), so the $('id')
// scan below cannot see them. Listed explicitly so a removed id is caught.
const REQUIRED_IDS = [
  'updateBanner',
  'updateBannerText',
  'updateBannerLink',
  'updateBannerDismiss',
  'urlBoxDetails',
  'urlBoxSummary',
  'onshapeUrlInput',
  'urlHint',
  'urlParsed',
  'urlParsedDocument',
  'urlParsedWorkspace',
  'urlParsedElement',
  'urlParsedWorkspaceKind',
  'urlOpenInOnshape',
  'urlWarning',
  'urlError',
  'loadUrlBtn',
  'loadOnshapeReason',
  'refreshFeaturesReason',
  'scalePickReason',
  'rotationPickReason',
  'previewReason',
  'setupIntro',
  'setupSteps',
  'setupPortalLink',
  'setupKeyHint',
  'setupBaseUrlHint',
  'planBadge',
  'settingsCard',
  'settingsDetails',
  'settingsSummary',
  'settingsUnavailable',
  'settingsAllowFeatureInstall',
  'settingsAllowImageUpload',
  'settingsAllowDocumentCreation',
  'settingsAllowSuppression',
  'settingsConfirmBeforeWrite',
  'settingsScratchFolderId',
  'settingsScratchFolderHint',
  'settingsSaveBtn',
  'settingsReason',
  'settingsStatus',
  'settingsError',
  'settingsPath',
  'capFeatureInstall',
  'capImageUpload',
  'capDocumentCreation',
  'capSuppression',
  'capDeleteCleanup',
  'installSection',
  'installHeading',
  'installState',
  'installImageSelect',
  'installImageHint',
  'installBtn',
  'installReason',
  'uploadUseImageBtn',
  'uploadUseImageReason',
  'installStatus',
  'installError',
  'unsuppressRow',
  'unsuppressBtn',
  'unsuppressReason',
  'suppressStatus',
  'suppressError',
  'duplicateOffer',
  'duplicateOfferText',
  'duplicateOfferExplain',
  'duplicateSuppressBtn',
  'duplicateSuppressReason'
];

// Every policy toggle in the settings card, and the capability line that has
// to sit under it. Drift between these two lists is exactly the failure the
// card exists to prevent: a switch with no statement of whether the key can
// even do the thing.
const POLICY_ROWS = [
  ['settingsAllowFeatureInstall', 'capFeatureInstall'],
  ['settingsAllowImageUpload', 'capImageUpload'],
  ['settingsAllowDocumentCreation', 'capDocumentCreation'],
  ['settingsAllowSuppression', 'capSuppression']
];

function unique(values) {
  return [...new Set(values)];
}
test('every DOM id requested by app.js exists in index.html', async () => {
  const [script, html] = await Promise.all([
    fs.readFile(path.join(root, 'public/app.js'), 'utf8'),
    fs.readFile(path.join(root, 'public/index.html'), 'utf8')
  ]);

  const requested = unique([...script.matchAll(/\$\(['"]([^'"]+)['"]\)/g)].map((match) => match[1]));
  const defined = new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]));
  const missing = requested.filter((id) => !defined.has(id));

  assert.deepEqual(missing, []);
  assert.ok(requested.length > 20, 'test should cover the real UI contract');
});

test('every required static id exists in index.html', async () => {
  const html = await fs.readFile(path.join(root, 'public/index.html'), 'utf8');
  const defined = new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]));
  const missing = REQUIRED_IDS.filter((id) => !defined.has(id));
  assert.deepEqual(missing, []);
});

test('the CSP-compatible UI loads only external local script and stylesheet assets', async () => {
  const html = await fs.readFile(path.join(root, 'public/index.html'), 'utf8');
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i);
  assert.match(html, /<script[^>]+src=["']\/app\.js["']/i);
  assert.match(html, /<link[^>]+href=["']\/styles\.css["']/i);
  assert.doesNotMatch(html, /\bstyle=["']/i);
  await Promise.all([
    fs.access(path.join(root, 'public/app.js')),
    fs.access(path.join(root, 'public/styles.css')),
    fs.access(path.join(root, 'public/reference-align-icon.svg')),
    fs.access(path.join(root, 'featurescript/ReferenceImage.fs'))
  ]);
});

test('app.js imports the URL context parser exactly once, as a same-origin module specifier', async () => {
  const script = await fs.readFile(path.join(root, 'public/app.js'), 'utf8');
  const imports = [...script.matchAll(/^import .*from ['"]\.\/url-context\.mjs['"];?$/gm)];
  assert.equal(imports.length, 1);
});

test('setupCard is the first section in the controls column, and setupSteps precedes setupForm', async () => {
  const html = await fs.readFile(path.join(root, 'public/index.html'), 'utf8');
  const controlsStart = html.indexOf('class="controls-column"');
  assert.ok(controlsStart > -1);
  const firstSection = html.slice(controlsStart).match(/<section[^>]*id="([^"]+)"/);
  assert.equal(firstSection?.[1], 'setupCard');
  assert.ok(html.indexOf('id="setupSteps"') < html.indexOf('id="setupForm"'));
});

test('setupPortalLink targets the Onshape dev portal safely', async () => {
  const html = await fs.readFile(path.join(root, 'public/index.html'), 'utf8');
  assert.match(html, /id="setupPortalLink"[^>]*href="https:\/\/dev-portal\.onshape\.com\/keys"/);
  assert.match(html, /id="setupPortalLink"[^>]*rel="noopener noreferrer"/);
});

test('the fourth setup step warns the secret is shown once and losing it means a new key', async () => {
  const html = await fs.readFile(path.join(root, 'public/index.html'), 'utf8');
  const stepsBlock = html.slice(html.indexOf('id="setupSteps"'), html.indexOf('</ol>'));
  const items = stepsBlock.split('<li>');
  const fourthStep = items[4];
  assert.ok(fourthStep, 'expected a fourth <li> inside #setupSteps');
  assert.match(fourthStep, /once/);
  assert.match(fourthStep, /create a new key/);
});

test('authBadge is a real button, and the setup key fields carry the documented attributes', async () => {
  const html = await fs.readFile(path.join(root, 'public/index.html'), 'utf8');
  assert.match(html, /<button[^>]+id="authBadge"[^>]*>/);
  assert.match(html, /id="setupSecretKey"[^>]*type="password"/);
  assert.match(html, /id="setupSecretKey"[^>]*autocomplete="off"/);
  assert.match(html, /id="setupStatus"[^>]*role="status"/);
  assert.match(html, /id="setupError"[^>]*role="alert"/);
});

test('app.js\'s setup-save success path never reloads the page and completes the documented handoff', async () => {
  const script = await fs.readFile(path.join(root, 'public/app.js'), 'utf8');
  assert.doesNotMatch(script, /location\.reload\(\)/);
  assert.doesNotMatch(script, /location\.href\s*=/);

  const start = script.indexOf('async function handleSetupSave');
  const end = script.indexOf('\nasync function refreshFeatures', start);
  assert.ok(start > -1, 'expected a handleSetupSave function');
  const body = script.slice(start, end > -1 ? end : undefined);
  assert.match(body, /setupAccessKey\.value = ''/);
  assert.match(body, /setupSecretKey\.value = ''/);
  assert.match(body, /setupForm\.hidden = true/);
  assert.match(body, /renderBootstrap\(\)/);
  assert.match(body, /updateControlStates\(\)/);
  assert.ok(body.indexOf('renderBootstrap()') < body.indexOf('updateControlStates()'));
});

test('app.js re-probes the connection state instead of relying on bootstrap\'s cached peek', async () => {
  const script = await fs.readFile(path.join(root, 'public/app.js'), 'utf8');
  // GET /api/bootstrap deliberately never probes (see connection-probe.mjs's
  // peekConnectionState), so without a client-side call to GET /api/connection
  // a healthy, already-configured server stays on "Checking Onshape…" for the
  // life of the process. This counts the refreshConnectionState() declaration
  // plus its call sites (initial load, adopting a new context, badge click,
  // and the browser regaining connectivity) so dropping one silently fails.
  const references = [...script.matchAll(/refreshConnectionState\(\)/g)].length;
  assert.ok(references >= 5, `expected the declaration plus at least 4 call sites, found ${references}`);
  assert.match(script, /apiFetch\('\/api\/connection'\)/);
});

test('the Onshape target card is never hidden based on auth mode, so its paste-URL box stays reachable before Onshape is configured', async () => {
  const script = await fs.readFile(path.join(root, 'public/app.js'), 'utf8');
  assert.doesNotMatch(script, /onshapeCard\.hidden\s*=/);
});

test('a failure from our own /api/setup/test endpoint is not treated as a live-probe verdict on the key', async () => {
  const script = await fs.readFile(path.join(root, 'public/app.js'), 'utf8');
  const start = script.indexOf('async function handleSetupTest');
  const end = script.indexOf('\nasync function handleSetupSave', start);
  assert.ok(start > -1 && end > start, 'expected a handleSetupTest function');
  const body = script.slice(start, end);
  // Every non-timeout error used to become 'ONSHAPE_ERROR', which is in
  // SAVE_ANYWAY_REASONS — so this server's own 429/400/403 responses were
  // silently offering "Save anyway" for a key nobody had actually tested.
  assert.doesNotMatch(body, /reason: error\.name === 'TimeoutError' \? 'TIMEOUT' : 'ONSHAPE_ERROR'/);
  assert.match(body, /classifySetupTransportError\(error\)/);
});

test('classifySetupTransportError only produces a save-anyway verdict for a genuine transport failure', async () => {
  const script = await fs.readFile(path.join(root, 'public/app.js'), 'utf8');
  const start = script.indexOf('function classifySetupTransportError');
  const end = script.indexOf('\n}', start);
  const body = script.slice(start, end);
  assert.match(body, /error\.status === undefined/);
  assert.doesNotMatch(body, /'ONSHAPE_ERROR'/);
});

// Four functions used to each know a slice of this payload contract, and
// requestSuppression borrowed one of them that happened to fit. There is one
// now, and these assertions pin what it must recognise.
test('describeApiError is the only thing that reads a failed request’s payload', async () => {
  const script = await fs.readFile(path.join(root, 'public/app.js'), 'utf8');
  const start = script.indexOf('function describeApiError');
  const end = script.indexOf('\n}', start);
  assert.ok(start > -1 && end > start, 'expected a describeApiError function');
  const body = script.slice(start, end);

  // Every documented server code, recognised in one place.
  for (const code of ['SETUP_RATE_LIMITED', 'FEATURE_STATUS_NOT_OK', 'CONFIRM_REQUIRED']) {
    assert.match(body, new RegExp(`'${code}'`), code);
  }
  // The upstream statuses, and the fact that they are conditional: a 404 from
  // our own /api/setup/test is a missing route, not a document nobody can
  // find, so it must not borrow Onshape's sentence.
  assert.match(body, /if \(upstream\) \{/);
  assert.match(body, /error\?\.status === 401 \|\| error\?\.status === 403/);
  assert.match(body, /error\?\.status === 404/);
  assert.match(body, /return error\?\.message \|\| fallback;/);

  // No other function may re-derive any of this. SETUP_UNAVAILABLE is not on
  // the list: that branch picks a control-flow path (settings unavailable),
  // and its sentence comes from SETUP_UNAVAILABLE_MESSAGES in
  // connection-state.mjs, not from the payload.
  const others = script.slice(0, start) + script.slice(end);
  for (const code of ['SETUP_RATE_LIMITED', 'FEATURE_STATUS_NOT_OK', 'CONFIRM_REQUIRED']) {
    assert.doesNotMatch(others, new RegExp(`'${code}'`), `${code} belongs to describeApiError alone`);
  }
  assert.doesNotMatch(others, /status === 404/);
  // refreshFeatures still reads a 401 to flip the cached auth state, which is
  // control flow rather than copy. What it may not do is turn a status into a
  // sentence of its own. updateControlStates keeps two longer variants of the
  // rejected-key line, each keyed off connectionState rather than off an
  // error and each ending in different advice, so this pins the exact
  // sentence describeApiError owns rather than the phrase they share.
  assert.doesNotMatch(others, /the Onshape badge at the top to enter a new one\.';/);
  assert.doesNotMatch(others, /Onshape could not find that document/);
});

test('a rate-limited setup response surfaces the actual wait time instead of a vague retry message', async () => {
  const script = await fs.readFile(path.join(root, 'public/app.js'), 'utf8');
  assert.match(script, /payload\?\.code === 'SETUP_RATE_LIMITED'/);
  assert.match(script, /payload\.retryAfterSeconds/);
  assert.match(script, /Wait about \$\{payload\.retryAfterSeconds\} seconds/);
  // The setup form reads it through the shared mapper, without the upstream
  // flag: a 404 from /api/setup/test is a missing route on this server, not a
  // document Onshape cannot find.
  assert.match(script, /setSetupError\(describeApiError\(error\)\);/);
});

test('the Refresh reason text does not accuse a healthy server of a past failure while its first probe is still in flight', async () => {
  const script = await fs.readFile(path.join(root, 'public/app.js'), 'utf8');
  const start = script.indexOf('let refreshDisabled = true;');
  const end = script.indexOf('elements.refreshFeaturesBtn.disabled', start);
  const body = script.slice(start, end);
  assert.doesNotMatch(body, /connectionState === 'unreachable' \|\| connectionState === 'error' \|\| connectionState === 'checking'/);
  assert.match(body, /connectionState === 'checking'/);
});

test('the post-save toast only claims a verified connection when the live probe actually succeeded', async () => {
  const script = await fs.readFile(path.join(root, 'public/app.js'), 'utf8');
  const start = script.indexOf('async function handleSetupSave');
  const end = script.indexOf('\nasync function refreshFeatures', start);
  const body = script.slice(start, end);
  assert.match(body, /connectionState === 'connected'/);
  assert.doesNotMatch(body, /toast\(`Connected as \$\{accountName/);
});

test('openSetup does not open the form when the setup route is unavailable, and resets stale status on every open', async () => {
  const script = await fs.readFile(path.join(root, 'public/app.js'), 'utf8');
  const start = script.indexOf('function openSetup(');
  const end = script.indexOf('\nfunction closeSetup', start);
  assert.ok(start > -1 && end > start, 'expected an openSetup function');
  const body = script.slice(start, end);
  assert.match(body, /state\.bootstrap\?\.setup\?\.available === false/);
  assert.match(body, /resetSetupFormState\(\)/);
});

test('refreshFeaturesBtn is disabled only for unconfigured, rejected, and forbidden connection states', async () => {
  const script = await fs.readFile(path.join(root, 'public/app.js'), 'utf8');
  const start = script.indexOf('let refreshDisabled = true;');
  const end = script.indexOf('elements.refreshFeaturesBtn.disabled', start);
  const body = script.slice(start, end);
  assert.match(body, /connectionState === 'unconfigured'/);
  assert.match(body, /connectionState === 'oauth-required'/);
  assert.match(body, /connectionState === 'rejected' \|\| connectionState === 'forbidden'/);
  assert.doesNotMatch(body, /connectionState === 'unreachable'[^\n]*refreshDisabled = true/);
});

test('apiFetch applies a 12s timeout on setup calls and the default elsewhere', async () => {
  const script = await fs.readFile(path.join(root, 'public/app.js'), 'utf8');
  assert.match(script, /timeoutMs = 30_000/);
  assert.match(script, /timeoutMs: 12_000/);
  assert.match(script, /AbortSignal\.timeout\(timeoutMs\)/);
  assert.match(script, /TimeoutError/);
});

// Regression for war council finding frodo-4: the banner must decide
// through the semver-aware helper, not a plain string comparison, and
// Dismiss must persist so the banner does not return on every reload.
test('the update banner is gated by shouldShowUpdateBanner and Dismiss persists to storage', async () => {
  const script = await fs.readFile(path.join(root, 'public/app.js'), 'utf8');
  assert.match(script, /^import \{ shouldShowUpdateBanner \} from ['"]\.\/update-banner\.mjs['"];?$/m);
  assert.match(script, /shouldShowUpdateBanner\(result, readDismissedUpdateVersion\(\)\)/);
  assert.doesNotMatch(script, /result\.latest === result\.current/);
  assert.match(script, /localStorage\.setItem\(UPDATE_BANNER_DISMISSED_KEY/);
  assert.match(script, /localStorage\.getItem\(UPDATE_BANNER_DISMISSED_KEY\)/);
});

// Regression for war council finding aragorn-3: the update feed's url is an
// unauthenticated, remote value that flows straight into an anchor's href.
// The server-side control is isAbsoluteHttpUrl in src/update-check.mjs; this
// is the independent client-side check, since an embedded webview with a
// looser CSP than this app's own has no protection against a javascript:
// or data: href otherwise.
test('the update banner link is only followed for an http(s) url, checked before touching .href', async () => {
  const script = await fs.readFile(path.join(root, 'public/app.js'), 'utf8');

  const fnStart = script.indexOf('function isSafeUpdateUrl');
  assert.ok(fnStart > -1, 'expected an isSafeUpdateUrl function');
  const fnEnd = script.indexOf('\n}', fnStart);
  const fnBody = script.slice(fnStart, fnEnd);
  assert.match(fnBody, /protocol === 'http:'/);
  assert.match(fnBody, /protocol === 'https:'/);

  const bannerStart = script.indexOf('async function checkForUpdateBanner');
  assert.ok(bannerStart > -1, 'expected a checkForUpdateBanner function');
  const bannerEnd = script.indexOf('\n}', bannerStart);
  const bannerBody = script.slice(bannerStart, bannerEnd);
  const checkIndex = bannerBody.indexOf('isSafeUpdateUrl(result.url)');
  const hrefIndex = bannerBody.indexOf('updateBannerLink.href');
  assert.ok(checkIndex > -1, 'expected checkForUpdateBanner to call isSafeUpdateUrl(result.url)');
  assert.ok(hrefIndex > -1, 'expected checkForUpdateBanner to set updateBannerLink.href');
  assert.ok(checkIndex < hrefIndex, 'expected the scheme check to run before the .href assignment');
});

test('url-context.mjs is DOM-free and importable with no shim', async () => {
  const source = await fs.readFile(path.join(root, 'public/url-context.mjs'), 'utf8');
  // "document" also means an Onshape document in this domain's own prose
  // (see the NO_DOCUMENT_ID / HOST_MISMATCH copy), so only the DOM-global
  // access pattern ("document." member access) is disallowed, not the word.
  assert.doesNotMatch(source, /\bdocument\s*[.[]/, 'url-context.mjs must not reference the document global');
  for (const forbidden of ['window', 'localStorage', 'navigator']) {
    assert.doesNotMatch(source, new RegExp(`\\b${forbidden}\\b`), `url-context.mjs must not reference ${forbidden}`);
  }
  // Importing it here, under plain node --test, is itself proof that no DOM
  // shim is required.
  const module = await import('../public/url-context.mjs');
  assert.equal(typeof module.parseOnshapeUrl, 'function');
  assert.equal(typeof module.contextToSearch, 'function');
});

test('every policy toggle is a checkbox with its capability line directly under it', async () => {
  const html = await fs.readFile(path.join(root, 'public/index.html'), 'utf8');
  for (const [input, capacity] of POLICY_ROWS) {
    assert.match(html, new RegExp(`<input id="${input}" type="checkbox"`), input);
    const inputAt = html.indexOf(`id="${input}"`);
    const capacityAt = html.indexOf(`id="${capacity}"`);
    assert.ok(capacityAt > inputAt, `${capacity} must follow ${input}`);
    // The next toggle must not come between them.
    const between = html.slice(inputAt, capacityAt);
    assert.doesNotMatch(between, /type="checkbox"[^>]*>[\s\S]*type="checkbox"/, `${capacity} belongs to ${input}`);
  }
});

test('the settings card is collapsible and lives outside the numbered calibration flow', async () => {
  const html = await fs.readFile(path.join(root, 'public/index.html'), 'utf8');
  const cardAt = html.indexOf('id="settingsCard"');
  assert.ok(cardAt > -1);
  const card = html.slice(cardAt, html.indexOf('</section>', cardAt));
  assert.match(card, /<details id="settingsDetails">/);
  assert.match(card, /<summary id="settingsSummary">/);
  // After the results card, so it never sits between two calibration steps.
  assert.ok(cardAt > html.indexOf('id="resultsCard"'));
});

test('app.js reads every policy toggle from one table, so a new switch cannot skip its capability line', async () => {
  const script = await fs.readFile(path.join(root, 'public/app.js'), 'utf8');
  const start = script.indexOf('const POLICY_ROWS = Object.freeze([');
  const end = script.indexOf(']);', start);
  assert.ok(start > -1 && end > start, 'expected a POLICY_ROWS table in app.js');
  const table = script.slice(start, end);
  for (const [input, capacity] of POLICY_ROWS) {
    assert.match(table, new RegExp(`input: '${input}'`), input);
    assert.match(table, new RegExp(`capacity: '${capacity}'`), capacity);
  }
});

test('the settings save path posts to /api/settings and never invents its own refusal copy', async () => {
  const script = await fs.readFile(path.join(root, 'public/app.js'), 'utf8');
  const start = script.indexOf('async function handleSettingsSave');
  const end = script.indexOf('\nfunction setSetupStatus', start);
  assert.ok(start > -1 && end > start, 'expected a handleSettingsSave function');
  const body = script.slice(start, end);
  assert.match(body, /apiFetch\('\/api\/settings', \{/);
  assert.match(body, /method: 'POST'/);
  assert.match(body, /SETUP_UNAVAILABLE_MESSAGES/);
});

// Apply's capability refusal and the unknown-scope rule are unit tested for
// real in test/write-gates.test.mjs, against the sentence the server's own
// featureGateReasons() produces. What belongs here is the structural half: no
// second copy of either may reappear in app.js. renderSettingsCard does still
// read the capability records, but only to render explanatory copy through
// capabilityCardText — it never turns one into a button's refusal, and that
// is what must not come back.
test('app.js does not compose its own capability refusal or scope verdict', async () => {
  const script = await fs.readFile(path.join(root, 'public/app.js'), 'utf8');
  assert.doesNotMatch(script, /features\?\.updateFeature/);
  assert.doesNotMatch(script, /record\.allowed === false/);
  assert.doesNotMatch(script, /scopes\?\.known/);
  assert.doesNotMatch(script, /function readScopeMissing/);
  assert.match(script, /^import \{[^}]*\breadScopeMissing\b[^}]*\} from '\.\/write-gates\.mjs';$/ms);
});

test('the install section lives inside the Onshape target card, after the target picker', async () => {
  const html = await fs.readFile(path.join(root, 'public/index.html'), 'utf8');
  const cardAt = html.indexOf('id="onshapeCard"');
  const sectionAt = html.indexOf('id="installSection"');
  assert.ok(cardAt > -1);
  assert.ok(sectionAt > cardAt, 'the install section belongs to the Onshape target card');
  assert.ok(sectionAt > html.indexOf('id="featureDetails"'), 'it comes after the target picker');
});

test('both install buttons name the paragraph that explains why they are disabled', async () => {
  const html = await fs.readFile(path.join(root, 'public/index.html'), 'utf8');
  assert.match(html, /id="installBtn"[^>]*aria-describedby="installReason"/);
  assert.match(html, /id="uploadUseImageBtn"[^>]*aria-describedby="uploadUseImageReason"/);
  assert.match(html, /id="installStatus"[^>]*role="status"/);
  assert.match(html, /id="installError"[^>]*role="alert"/);
});

// A FormData body labelled application/json loses its multipart boundary and
// arrives as an unparseable stream, so the upload is the one request this
// helper must not name a content type for.
test('apiFetch only labels a string body as JSON, so the image upload keeps its multipart boundary', async () => {
  const script = await fs.readFile(path.join(root, 'public/app.js'), 'utf8');
  assert.match(script, /typeof rest\.body === 'string' && !headers\.has\('Content-Type'\)/);
  const start = script.indexOf('async function uploadLoadedImage');
  const end = script.indexOf('\n// The install and rebind buttons', start);
  assert.ok(start > -1 && end > start, 'expected an uploadLoadedImage function');
  const body = script.slice(start, end);
  assert.match(body, /new FormData\(\)/);
  // The comment above it may name the header; a quoted literal would mean it
  // is actually being set.
  assert.doesNotMatch(body, /['+chr(39)+chr(34)+']Content-Type/);
});

test('the install, rebind, and apply requests all ask first and carry confirm: true', async () => {
  const script = await fs.readFile(path.join(root, 'public/app.js'), 'utf8');
  for (const name of ['handleInstallClick', 'handleUploadAndUseClick', 'applyCalibration']) {
    const start = script.indexOf(`async function ${name}`);
    assert.ok(start > -1, name);
    const end = script.indexOf('\n}', script.indexOf('  } finally {', start));
    const body = script.slice(start, end);
    assert.match(body, /confirmWrite\(/, name);
    assert.match(body, /confirm: true/, name);
  }
  // The server enforces the same switch; this is only the asking half.
  const start = script.indexOf('function confirmWrite');
  const body = script.slice(start, script.indexOf('\n}', start));
  assert.match(body, /policy\?\.confirmBeforeWrite === false/);
});

// The refusal an operator reads before pressing a button has to be the one the
// route would throw. A second copy composed in the browser is how the two
// drift apart.
test('the install controls show the server’s own gate sentences', async () => {
  const [script, gates] = await Promise.all([
    fs.readFile(path.join(root, 'public/app.js'), 'utf8'),
    fs.readFile(path.join(root, 'public/write-gates.mjs'), 'utf8')
  ]);
  // The gates object is read in one place, and it is not app.js. That the
  // sentence comes back verbatim is asserted for real in
  // test/write-gates.test.mjs, against featureGateReasons().
  const start = gates.indexOf('function gateReason');
  assert.ok(start > -1, 'expected a gateReason helper in write-gates.mjs');
  assert.match(gates.slice(start, gates.indexOf('\n}', start)), /gates\?\.\[feature\]/);
  for (const feature of ['installFeature', 'uploadImage', 'rebindImage']) {
    assert.match(gates, new RegExp(`gateReason\\(gates, '${feature}'\\)`), feature);
  }
  assert.doesNotMatch(script, /bootstrap\?\.gates\?\.\[/);
});

test('updateControlStates is still the only place the install controls are disabled', async () => {
  const script = await fs.readFile(path.join(root, 'public/app.js'), 'utf8');
  const start = script.indexOf('function updateControlStates');
  const end = script.indexOf('\nasync function previewCalibration', start);
  assert.ok(start > -1 && end > start);
  const body = script.slice(start, end);
  for (const id of ['installBtn', 'uploadUseImageBtn', 'installImageSelect']) {
    assert.equal([...script.matchAll(new RegExp(`elements\\.${id}\\.disabled`, 'g'))].length, 1, id);
    assert.match(body, new RegExp(`elements\\.${id}\\.disabled`), id);
  }
});

test('the suppression offer sits under the result, and the unsuppress affordance sits with the target', async () => {
  const html = await fs.readFile(path.join(root, 'public/index.html'), 'utf8');
  const resultsAt = html.indexOf('id="resultsCard"');
  const offerAt = html.indexOf('id="duplicateOffer"');
  assert.ok(offerAt > resultsAt, 'the offer belongs under the calculated placement');
  assert.ok(offerAt < html.indexOf('id="settingsCard"'), 'and inside the results card, not after it');
  // The unsuppress affordance has to reach a suppressed target that was never
  // applied to, so it lives with the target picker, not with the result.
  const unsuppressAt = html.indexOf('id="unsuppressRow"');
  assert.ok(unsuppressAt > html.indexOf('id="featureDetails"'));
  assert.ok(unsuppressAt < html.indexOf('id="installSection"'));
  // The outcome is reported in the Onshape target card, which is the one
  // section that is never hidden — the results card is, until a first solve.
  assert.ok(html.indexOf('id="suppressStatus"') < html.indexOf('id="installSection"'));
  assert.match(html, /id="suppressStatus"[^>]*role="status"/);
  assert.match(html, /id="suppressError"[^>]*role="alert"/);
  assert.match(html, /id="duplicateSuppressBtn"[^>]*aria-describedby="duplicateSuppressReason"/);
  assert.match(html, /id="unsuppressBtn"[^>]*aria-describedby="unsuppressReason"/);
});

// Suppression makes part of someone's model vanish from their screen, so it is
// confirmed every time — not only while confirmBeforeWrite is on. The server
// refuses a body without confirm: true whatever that setting says, and this is
// the browser half of the same rule.
test('the suppress request asks unconditionally and carries confirm: true', async () => {
  const script = await fs.readFile(path.join(root, 'public/app.js'), 'utf8');
  const start = script.indexOf('async function requestSuppression');
  assert.ok(start > -1, 'expected a requestSuppression function');
  const end = script.indexOf('\n}', script.indexOf('  } finally {', start));
  const body = script.slice(start, end);
  assert.match(body, /window\.confirm\(/);
  assert.doesNotMatch(body, /confirmWrite\(/);
  assert.match(body, /confirm: true/);
  assert.match(body, /apiFetch\('\/api\/suppress'/);
});

test('the suppression controls show the server’s own gate sentence', async () => {
  const gates = await fs.readFile(path.join(root, 'public/write-gates.mjs'), 'utf8');
  const start = gates.indexOf('export function suppressBlockReason');
  assert.ok(start > -1, 'expected a suppressBlockReason helper in write-gates.mjs');
  assert.match(gates.slice(start, gates.indexOf('\n}', start)), /gateReason\(gates, 'suppressFeature'\)/);
});

test('updateControlStates is still the only place the suppression buttons are disabled', async () => {
  const script = await fs.readFile(path.join(root, 'public/app.js'), 'utf8');
  const start = script.indexOf('function updateControlStates');
  const end = script.indexOf('\nasync function previewCalibration', start);
  assert.ok(start > -1 && end > start);
  const body = script.slice(start, end);
  for (const id of ['duplicateSuppressBtn', 'unsuppressBtn']) {
    assert.equal([...script.matchAll(new RegExp(`elements\.${id}\.disabled`, 'g'))].length, 1, id);
    assert.match(body, new RegExp(`elements\.${id}\.disabled`), id);
  }
});

// GET /api/connection sends `gates` and `policy` alongside `auth` (see
// server.mjs), and refreshConnectionState is the only thing that ever reads
// that response. Dropping either field here is how a disabled Apply button
// (which reads auth.capabilities directly) and an enabled Install button
// (which reads gates) end up disagreeing about the very same key.
test('refreshConnectionState updates gates and policy, not only auth', async () => {
  const script = await fs.readFile(path.join(root, 'public/app.js'), 'utf8');
  const start = script.indexOf('async function refreshConnectionState');
  const end = script.indexOf('\nfunction setupHost', start);
  assert.ok(start > -1 && end > start, 'expected a refreshConnectionState function');
  const body = script.slice(start, end);
  assert.match(body, /state\.bootstrap\.auth = response\.auth/);
  assert.match(body, /state\.bootstrap\.gates = response\.gates/);
  assert.match(body, /state\.bootstrap\.policy = response\.policy/);
});

// POST /api/setup/save clears every observed 403 for the new key (see
// clearAllCapabilityEvidence in src/setup-routes.mjs) and can send a key with
// entirely different scopes, both of which can change every gate sentence at
// once; only assigning response.auth left the page showing the old key's
// refusal text until the next full connection probe.
test('a successful setup save also refreshes the gates, not only auth', async () => {
  const script = await fs.readFile(path.join(root, 'public/app.js'), 'utf8');
  const start = script.indexOf('async function handleSetupSave');
  const end = script.indexOf('\nasync function refreshFeatures', start);
  assert.ok(start > -1 && end > start, 'expected a handleSetupSave function');
  const body = script.slice(start, end);
  assert.match(body, /state\.bootstrap\.auth = response\.auth/);
  assert.match(body, /state\.bootstrap\.gates = response\.gates/);
});

// A settings save can flip the policy half of a gate immediately (see
// featureGateReasons in src/capability-gate.mjs); loadSettings and
// handleSettingsSave both have to pick up the fresh gates the route now
// sends, or the switch the operator just touched changes nothing on screen
// until the page is reloaded.
test('loading and saving settings both refresh the gates from the response', async () => {
  const script = await fs.readFile(path.join(root, 'public/app.js'), 'utf8');
  for (const [name, nextFn] of [['loadSettings', 'readSettingsForm'], ['handleSettingsSave', 'setSetupStatus']]) {
    const start = script.indexOf(`async function ${name}`);
    const end = script.indexOf(`\nfunction ${nextFn}`, start);
    assert.ok(start > -1 && end > start, name);
    const body = script.slice(start, end);
    assert.match(body, /response\.gates/, name);
  }
});

// The four/five capability records only ever carry a 'write' or 'delete'
// scope (see FEATURES in src/capabilities.mjs), whose raw record.reason is
// written for a log line ("Key lacks write scope"). The settings card is
// read by a non-developer, so it has to go through a translator instead of
// printing that verdict verbatim.
test('the settings card translates a scope verdict into reader-facing copy instead of printing it verbatim', async () => {
  const script = await fs.readFile(path.join(root, 'public/app.js'), 'utf8');
  assert.match(script, /function capabilityCardText\(/);
  const start = script.indexOf('function renderSettingsCard');
  const end = script.indexOf('\n// Until a probe has answered', start);
  assert.ok(start > -1 && end > start, 'expected a renderSettingsCard function');
  const body = script.slice(start, end);
  assert.match(body, /capabilityCardText\(record/);
  assert.match(body, /capabilityCardText\(cleanup/);
  assert.doesNotMatch(body, /elements\[row\.capacity\]\.textContent = record\s*\n\s*\? record\.reason/);
});

test('capDeleteCleanup has a heading of its own instead of dangling under the folder hint', async () => {
  const html = await fs.readFile(path.join(root, 'public/index.html'), 'utf8');
  const hintAt = html.indexOf('id="settingsScratchFolderHint"');
  const cleanupAt = html.indexOf('id="capDeleteCleanup"');
  assert.ok(hintAt > -1 && cleanupAt > hintAt);
  const between = html.slice(hintAt, cleanupAt);
  assert.match(between, /<strong>Deleting<\/strong>/);
});

// Nothing under server.mjs or src/ ever calls api.createDocument or reads
// settings.scratchFolderId — only the scripts/live-verify-*.mjs command-line
// scripts do, reading the real settings.json and honouring both the switch
// and the folder id (see resolveScratchTarget in those scripts). The switch
// and field are real controls that persist to settings.json, so they stay —
// but the card must not claim they affect anything this page does.
test('the create-scratch-documents switch and folder field say they are reserved for the command-line scripts', async () => {
  const html = await fs.readFile(path.join(root, 'public/index.html'), 'utf8');
  const switchAt = html.indexOf('id="settingsAllowDocumentCreation"');
  const folderHintAt = html.indexOf('id="settingsScratchFolderHint"');
  assert.ok(switchAt > -1 && folderHintAt > switchAt);
  const between = html.slice(switchAt, folderHintAt + 400);
  assert.match(between, /command-line/);
  assert.match(between, /scripts\//);
});

// state.settings.available === false covers two different things: a real
// SETUP_UNAVAILABLE (the loopback/remote-admin case, which has a reason) and
// a generic load failure (a timeout, a 500, the server restarting), which
// does not. Only the former is a fact the NOT_LOOPBACK-family copy is true
// about.
test('a settings-load failure only shows the loopback-unavailable callout when the server actually said so', async () => {
  const script = await fs.readFile(path.join(root, 'public/app.js'), 'utf8');
  const renderStart = script.indexOf('function renderSettingsCard');
  const renderEnd = script.indexOf('\n// Until a probe has answered', renderStart);
  const renderBody = script.slice(renderStart, renderEnd);
  assert.match(renderBody, /state\.settings\.available === false && Boolean\(state\.settings\.unavailableReason\)/);

  const controlsStart = script.indexOf('let settingsDisabled = false;');
  const controlsEnd = script.indexOf('elements.settingsSaveBtn.disabled', controlsStart);
  const controlsBody = script.slice(controlsStart, controlsEnd);
  assert.match(controlsBody, /state\.settings\.available === false && state\.settings\.unavailableReason/);
  assert.match(controlsBody, /state\.settings\.available === false/);
});

// loadInstallStatus() returns immediately, without ever setting
// state.install.data, whenever auth.canRequest is false — so "Checking this
// document…" was a promise nothing was keeping for a user who had not set up
// a key yet.
test('the install card does not claim to be checking a document it will never request', async () => {
  const script = await fs.readFile(path.join(root, 'public/app.js'), 'utf8');
  const start = script.indexOf('function installStateText');
  const end = script.indexOf('\n// Rebuilt from the server', start);
  assert.ok(start > -1 && end > start, 'expected an installStateText function');
  const body = script.slice(start, end);
  const canRequestAt = body.indexOf('canRequest');
  const checkingAt = body.indexOf("'Checking this document…'");
  assert.ok(canRequestAt > -1 && canRequestAt < checkingAt, 'the canRequest guard must run before the "Checking…" fallback');
});

// GET /api/install/status can fail with the same rejected/forbidden key every
// other control already names with a next step; the raw upstream text
// ("Onshape API request failed with 401 Unauthorized.") gives none.
test('a rejected key surfaces the standard badge sentence on the install card, not the raw upstream error', async () => {
  const script = await fs.readFile(path.join(root, 'public/app.js'), 'utf8');
  const start = script.indexOf('async function loadInstallStatus');
  const end = script.indexOf('\n// The policy switch', start);
  assert.ok(start > -1 && end > start, 'expected a loadInstallStatus function');
  const body = script.slice(start, end);
  // Everything Onshape refuses with — a rejected key, and most commonly a 404
  // for a document, workspace, or tab the key cannot see — goes through the
  // one reader-facing translator instead of the raw upstream sentence.
  assert.match(body, /describeApiError\(error, \{\s*upstream: true/);
  assert.doesNotMatch(body, /error\.status === 401/);
});

// A pasted URL for a document, workspace, or tab this key cannot open comes
// back from Onshape as a 404. Before this fix, both refreshFeatures and
// loadInstallStatus printed the raw upstream sentence
// ("Onshape API request failed with 404 Not Found.") with no cause and no
// next step — the one gap in an app where every other failure names both.
test('describeApiError names a cause and a next step for an upstream 404, and leaves other errors alone', async () => {
  const script = await fs.readFile(path.join(root, 'public/app.js'), 'utf8');
  const start = script.indexOf('function describeApiError');
  assert.ok(start > -1, 'expected a describeApiError helper');
  const end = script.indexOf('\n}', start);
  const body = script.slice(start, end);
  assert.match(body, /error\?\.status === 404/);
  assert.match(body, /Part Studio tab/);
  assert.match(body, /return error\?\.message \|\| fallback;/);
});

// refreshFeatures is the code path a pasted-URL 404 actually reaches (via
// adoptContext -> refreshFeatures -> GET /api/context); both the callout in
// the Onshape target card and the toast have to show the same translated
// message, not the raw error.
test('refreshFeatures routes its failure message through describeApiError for both the callout and the toast', async () => {
  const script = await fs.readFile(path.join(root, 'public/app.js'), 'utf8');
  const start = script.indexOf('async function refreshFeatures');
  const end = script.indexOf('\nfunction preservedExtras', start);
  assert.ok(start > -1 && end > start, 'expected a refreshFeatures function');
  const body = script.slice(start, end);
  const catchAt = body.indexOf('} catch (error) {');
  assert.ok(catchAt > -1);
  const catchBody = body.slice(catchAt);
  assert.match(catchBody, /const message = describeApiError\(error, \{ upstream: true \}\);/);
  assert.match(catchBody, /elements\.contextMessage\.textContent = message;/);
  assert.match(catchBody, /toast\(message, 'error'\);/);
  assert.doesNotMatch(catchBody, /elements\.contextMessage\.textContent = error\.message;/);
});

// handleUploadAndUseClick always uploads state.sourceBlob and ignores
// installImageSelect — correct for what the button does, but it used to sit
// under the "Image to use" picker with a label ("Upload and use this image")
// that read as if it acted on that selection.
test('the upload-and-use button names the local image it actually uploads', async () => {
  const html = await fs.readFile(path.join(root, 'public/index.html'), 'utf8');
  assert.match(html, /id="uploadUseImageBtn"[^>]*>Upload the local image and use it</);
  assert.doesNotMatch(html, />Upload and use this image</);
});

// The upload half of an install click can succeed even when the install
// half that follows it fails or times out — the image is already a tab in
// the document either way. Losing that fact, and leaving the picker still
// offering "Upload …" for an image that is already there, made a retry
// upload a second copy.
test('a failed install after a successful upload says the upload landed and re-reads the document', async () => {
  const script = await fs.readFile(path.join(root, 'public/app.js'), 'utf8');
  const start = script.indexOf('async function handleInstallClick');
  assert.ok(start > -1, 'expected a handleInstallClick function');
  const end = script.indexOf('\nasync function handleUploadAndUseClick', start);
  const body = script.slice(start, end);
  const catchAt = body.indexOf('} catch (error) {');
  assert.ok(catchAt > -1);
  const catchBody = body.slice(catchAt);
  assert.match(catchBody, /uploadedName/);
  assert.match(catchBody, /loadInstallStatus\(\)/);
});

// Success already toasts a confirmation regardless of which of the two
// suppression buttons was pressed (duplicateSuppressBtn, at the bottom of the
// Result card, or unsuppressBtn, up in the Onshape target card); a refusal
// only wrote to suppressError, which sits in the target card and can be
// off-screen from wherever the press actually happened.
test('a refused suppression is toasted, not left only on a card that may be off-screen', async () => {
  const script = await fs.readFile(path.join(root, 'public/app.js'), 'utf8');
  const start = script.indexOf('async function requestSuppression');
  const end = script.indexOf('\nfunction handleDuplicateSuppressClick', start);
  assert.ok(start > -1 && end > start, 'expected a requestSuppression function');
  const body = script.slice(start, end);
  const catchAt = body.indexOf('} catch (error) {');
  const catchBody = body.slice(catchAt, body.indexOf('} finally {', catchAt));
  assert.match(catchBody, /toast\(message, 'error'\)/);
});

// `editable` gates Apply's imageWidth/imageAngle/originX/Y write only; a
// native sketch can be suppressed and unsuppressed regardless of it. Calling
// that "read-only" right next to a working Suppress/Unsuppress button implied
// those buttons were dead too.
test('a non-editable target is not labelled read-only in the picker, since suppression still works on it', async () => {
  const script = await fs.readFile(path.join(root, 'public/app.js'), 'utf8');
  const start = script.indexOf('function renderFeatureSelect');
  const end = script.indexOf('\nfunction renderBootstrap', start);
  assert.ok(start > -1 && end > start, 'expected a renderFeatureSelect function');
  const body = script.slice(start, end);
  assert.match(body, /geometry not editable here/);
  assert.doesNotMatch(body, /· read-only/);
});

test('the settings switch has a visible disabled state and a focus-visible outline', async () => {
  const css = await fs.readFile(path.join(root, 'public/styles.css'), 'utf8');
  assert.match(css, /\.switch-row input:disabled \+ \.switch\s*\{/);
  assert.match(css, /\.switch-row input:focus-visible \+ \.switch\s*\{/);
});

// Regression for war council finding frodo-7: applyCalibration leaves Target
// selected on the calibrated custom feature (see buildCalibrationPayload's
// caller), not on the native sketch a duplicate-image offer just suppressed,
// so gating "Unsuppress this sketch" on the current selection alone left the
// documented undo unreachable after the one path most likely to need it —
// accepting the offer under the Result card. Every place that decides
// whether the row shows, or that it acts on, has to fall back to the sketch
// this panel's own suppress request last touched.
test('the unsuppress row and button reach a sketch this panel just suppressed, not only the current Target selection', async () => {
  const script = await fs.readFile(path.join(root, 'public/app.js'), 'utf8');
  const candidateStart = script.indexOf('function unsuppressCandidate()');
  assert.ok(candidateStart > -1, 'expected an unsuppressCandidate helper');
  const candidateBody = script.slice(candidateStart, script.indexOf('\n}', candidateStart));
  assert.match(candidateBody, /suppressedNativeSelection\(\)/);
  assert.match(candidateBody, /state\.suppression\.lastSuppressedId/);

  const detailsStart = script.indexOf('function renderFeatureDetails()');
  const detailsEnd = script.indexOf('\nfunction escapeHtml', detailsStart);
  assert.ok(detailsStart > -1 && detailsEnd > detailsStart, 'expected a renderFeatureDetails function');
  const detailsBody = script.slice(detailsStart, detailsEnd);
  const detailsMatches = detailsBody.match(/elements\.unsuppressRow\.hidden = !unsuppressCandidate\(\);/g) || [];
  assert.equal(detailsMatches.length, 2, 'both the no-selection branch and the selected-item branch must use unsuppressCandidate()');
  assert.doesNotMatch(detailsBody, /elements\.unsuppressRow\.hidden = !\(item\.kind/);
  assert.doesNotMatch(detailsBody, /elements\.unsuppressRow\.hidden = true;/);

  const offerStart = script.indexOf('function renderSuppressionOffer()');
  const offerEnd = script.indexOf('\n}', offerStart);
  assert.ok(offerStart > -1 && offerEnd > offerStart, 'expected a renderSuppressionOffer function');
  assert.match(script.slice(offerStart, offerEnd), /elements\.unsuppressRow\.hidden = !unsuppressCandidate\(\);/);

  const clickStart = script.indexOf('function handleUnsuppressClick()');
  const clickEnd = script.indexOf('\n}', clickStart);
  assert.ok(clickStart > -1 && clickEnd > clickStart, 'expected a handleUnsuppressClick function');
  assert.match(script.slice(clickStart, clickEnd), /const item = unsuppressCandidate\(\);/);

  const controlsStart = script.indexOf('function updateControlStates()');
  const controlsEnd = script.indexOf('\nasync function previewCalibration', controlsStart);
  assert.ok(controlsStart > -1 && controlsEnd > controlsStart, 'expected an updateControlStates function');
  assert.match(script.slice(controlsStart, controlsEnd), /const unsuppressTarget = unsuppressCandidate\(\);/);

  // The id has to be recorded on a successful request, or lastSuppressedId
  // is never anything but undefined and the fallback above never fires.
  const requestStart = script.indexOf('async function requestSuppression');
  const requestEnd = script.indexOf('\nfunction handleDuplicateSuppressClick', requestStart);
  assert.ok(requestStart > -1 && requestEnd > requestStart, 'expected a requestSuppression function');
  const requestBody = script.slice(requestStart, requestEnd);
  const tryAt = requestBody.indexOf('try {');
  const catchAt = requestBody.indexOf('} catch (error) {');
  assert.match(requestBody.slice(tryAt, catchAt), /state\.suppression\.lastSuppressedId = itemId;/);
});

// A raw pointermove fires far faster than the screen repaints (a high-poll
// mouse or pen digitizer can exceed 200 Hz), and each one used to force a
// full loupe redraw plus a full source redraw — the coalescing this pins.
// The listener itself must only ever record the latest position and hand
// the actual drawing off to a single requestAnimationFrame callback; a
// drawSource()/drawLoupe() call left directly in the listener would put the
// forced layout back on every raw event. recordPick must stay reachable
// only from pointerup, never from the coalesced frame, or a pick could be
// dropped by a frame that never runs before the release.
test('the pointermove handler coalesces through requestAnimationFrame instead of drawing on every raw event', async () => {
  const script = await fs.readFile(path.join(root, 'public/app.js'), 'utf8');
  const listenerStart = script.indexOf("elements.canvasStage.addEventListener('pointermove'");
  assert.ok(listenerStart > -1, 'expected a pointermove listener');
  const listenerEnd = script.indexOf('\n  });', listenerStart);
  const listenerBody = script.slice(listenerStart, listenerEnd);
  assert.match(listenerBody, /requestAnimationFrame\(/);
  assert.doesNotMatch(listenerBody, /drawSource\(/);
  assert.doesNotMatch(listenerBody, /drawLoupe\(/);

  // The scheduled callback is where the real work happens, still gated to
  // recordPick nowhere in sight.
  const scheduledStart = script.indexOf('const runScheduledPointerMove');
  assert.ok(scheduledStart > -1, 'expected a runScheduledPointerMove callback');
  const scheduledEnd = script.indexOf('\n  };', scheduledStart);
  const scheduledBody = script.slice(scheduledStart, scheduledEnd);
  assert.match(scheduledBody, /drawSource\(/);
  assert.match(scheduledBody, /drawLoupe\(/);
  assert.doesNotMatch(scheduledBody, /recordPick\(/);

  // recordPick is reached from exactly one place: the pointerup path inside
  // finishPointer. Its own declaration also matches "recordPick(", so that
  // is excluded from the call count.
  const recordPickCalls = [...script.matchAll(/(?<!function )recordPick\(/g)].length;
  assert.equal(recordPickCalls, 1, 'recordPick must be called from exactly one place');
  const finishPointerStart = script.indexOf('const finishPointer = (event');
  assert.ok(finishPointerStart > -1, 'expected a finishPointer function');
  const finishPointerEnd = script.indexOf('\n  };', finishPointerStart);
  assert.match(script.slice(finishPointerStart, finishPointerEnd), /recordPick\(/);
});
