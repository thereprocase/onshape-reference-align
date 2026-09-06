// Real unit tests for the write gates, which used to be checked by regex over
// public/app.js source text because they were not importable. They are pure
// functions now, so every one of them is called here with a state object and
// asserted on its actual return value.
//
// The three structural invariants at the bottom are the ones a regex could
// never state honestly:
//   - the read-only sentence is byte-identical to the server's,
//   - a capability or policy refusal is returned verbatim out of the gates
//     object rather than composed in the browser,
//   - app.js still has exactly one bare fetch(, and updateControlStates is
//     still the only writer of .disabled.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyBlockReason,
  installBlockReason,
  previewBlockReason,
  readScopeMissing,
  suppressBlockReason,
  uploadAndUseBlockReason,
  GATE_MESSAGES,
  UPLOAD_OPTION
} from '../public/write-gates.mjs';
import { FEATURES } from '../src/capabilities.mjs';
import { featureGateReasons } from '../src/capability-gate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const WORKSPACE_CONTEXT = Object.freeze({
  complete: true,
  workspaceOrVersion: 'w',
  documentId: 'd'.repeat(24),
  workspaceOrVersionId: 'w'.repeat(24),
  elementId: 'e'.repeat(24)
});

const VERSION_CONTEXT = Object.freeze({ ...WORKSPACE_CONTEXT, workspaceOrVersion: 'v' });

const POINT = Object.freeze({ x: 10, y: 20 });

// A state in which nothing blocks anything: a workspace link, a usable key,
// an image loaded, both pairs picked, a writable custom feature selected, a
// fresh preview, and a document with room for the install. Each test spoils
// exactly one thing, so a returned sentence can only be about that thing.
function baseInput(overrides = {}) {
  const state = {
    busy: false,
    context: WORKSPACE_CONTEXT,
    sourceImage: { naturalWidth: 800, naturalHeight: 600 },
    sourceBlob: { size: 1024 },
    sourceName: 'plan.png',
    picks: { scale: { a: POINT, b: POINT }, rotation: { a: POINT, b: POINT } },
    selectedItem: {
      id: 'item-1',
      kind: 'custom',
      editable: true,
      featureName: 'Calibrated Reference Image',
      placement: { width: 1, angle: 0, originX: 0, originY: 0 }
    },
    result: { placement: {} },
    resultSignature: 'sig',
    install: { busy: false, available: true, error: '', data: { state: 'absent' }, maxImageUploadBytes: 20 * 1024 * 1024 },
    suppression: { busy: false, offers: [], lastSuppressedId: undefined },
    ...overrides.state
  };
  return {
    state,
    auth: { canRequest: true, ...overrides.auth },
    gates: { ...overrides.gates },
    form: {
      distance: 100,
      samePair: true,
      anchor: 'scale-a',
      installSelection: 'image-tab-1',
      inputSignature: 'sig',
      ...overrides.form
    }
  };
}

test('nothing is blocked when the context, the key, the picks, and the preview are all in order', () => {
  const input = baseInput();
  assert.equal(previewBlockReason(input), '');
  assert.equal(installBlockReason(input), '');
  assert.equal(uploadAndUseBlockReason(input), '');
  assert.equal(suppressBlockReason(input, 'item-1'), '');
  assert.deepEqual(applyBlockReason(input, ''), {
    disabled: false,
    text: 'Apply writes imageWidth, imageAngle, originX, and originY to “Calibrated Reference Image”. A JSON backup is saved on the server first.'
  });
});

// ---------------------------------------------------------------------------
// A version link: read-only, and the server would answer 409 CONTEXT_READ_ONLY
// ---------------------------------------------------------------------------

test('a version link blocks every write with the server’s own read-only sentence', () => {
  const input = baseInput({ state: { context: VERSION_CONTEXT } });
  assert.equal(installBlockReason(input), GATE_MESSAGES.CONTEXT_READ_ONLY);
  assert.equal(uploadAndUseBlockReason(input), GATE_MESSAGES.CONTEXT_READ_ONLY);
  assert.equal(suppressBlockReason(input, 'item-1'), GATE_MESSAGES.CONTEXT_READ_ONLY);
});

test('a version link does not block Preview, which writes nothing', () => {
  assert.equal(previewBlockReason(baseInput({ state: { context: VERSION_CONTEXT } })), '');
});

test('Apply names which kind of read-only link was pasted, since the paste box is the fix', () => {
  const version = applyBlockReason(baseInput({ state: { context: VERSION_CONTEXT } }), '');
  assert.equal(version.disabled, true);
  assert.match(version.text, /This is a version link, which is read-only\./);
  assert.match(version.text, /the address with \/w\/ in it/);

  const microversion = applyBlockReason(
    baseInput({ state: { context: { ...WORKSPACE_CONTEXT, workspaceOrVersion: 'm' } } }),
    ''
  );
  assert.match(microversion.text, /This is a microversion link, which is read-only\./);
});

// ---------------------------------------------------------------------------
// An unset connection
// ---------------------------------------------------------------------------

test('no context at all is refused before anything else about the document', () => {
  const input = baseInput({ state: { context: undefined } });
  assert.equal(installBlockReason(input), GATE_MESSAGES.NO_CONTEXT);
  assert.equal(uploadAndUseBlockReason(input), GATE_MESSAGES.NO_CONTEXT);
  assert.equal(suppressBlockReason(input, 'item-1'), GATE_MESSAGES.NO_CONTEXT);
  assert.equal(applyBlockReason(input, '').text, GATE_MESSAGES.APPLY_NO_CONTEXT);
});

test('an unset connection blocks every write and points to connecting or previewing locally', () => {
  const input = baseInput({ auth: { canRequest: false } });
  assert.equal(installBlockReason(input), GATE_MESSAGES.NOT_SET_UP);
  assert.equal(uploadAndUseBlockReason(input), GATE_MESSAGES.NOT_SET_UP);
  assert.equal(suppressBlockReason(input, 'item-1'), GATE_MESSAGES.NOT_SET_UP);
  assert.equal(applyBlockReason(input, '').text, GATE_MESSAGES.APPLY_NOT_SET_UP);
  assert.match(applyBlockReason(input, '').text, /preview your image without connecting/);
});

test('an OAuth connection awaiting authorization asks for authorization, not for setup', () => {
  const input = baseInput({ auth: { canRequest: false, connection: { state: 'oauth-required' } } });
  assert.equal(applyBlockReason(input, '').text, GATE_MESSAGES.NOT_AUTHORIZED);
});

test('a context or credential refusal outranks a capability refusal, since it is the nearer cause', () => {
  const input = baseInput({
    state: { context: VERSION_CONTEXT },
    auth: { canRequest: false },
    gates: { installFeature: 'Installing the Reference Image feature is turned off.' }
  });
  assert.equal(installBlockReason(input), GATE_MESSAGES.CONTEXT_READ_ONLY);
});

test('busy outranks everything, so a control cannot blame the document mid-request', () => {
  assert.equal(installBlockReason(baseInput({ state: { busy: true, context: undefined } })), GATE_MESSAGES.BUSY);
  assert.equal(installBlockReason(baseInput({ state: { install: { busy: true } } })), GATE_MESSAGES.BUSY);
  assert.equal(suppressBlockReason(baseInput({ state: { suppression: { busy: true } } })), GATE_MESSAGES.BUSY);
  assert.equal(previewBlockReason(baseInput({ state: { busy: true, sourceImage: undefined } })), GATE_MESSAGES.BUSY);
  assert.equal(applyBlockReason(baseInput({ state: { busy: true } }), '').text, GATE_MESSAGES.APPLY_BUSY);
});

// ---------------------------------------------------------------------------
// A policy-off gate: the server's sentence, verbatim
// ---------------------------------------------------------------------------

test('a policy-off gate is returned verbatim from the gates object, not composed here', () => {
  // The exact sentence describeFeatureGate() produces for a switched-off
  // policy, taken from the server's own gate rather than retyped.
  const gates = featureGateReasons({
    capabilities: { features: {} },
    policy: { allowFeatureInstall: false, allowImageUpload: false, allowSuppression: false }
  });
  assert.ok(gates.installFeature.length > 0, 'expected the server gate to refuse installFeature');

  assert.equal(installBlockReason(baseInput({ gates })), gates.installFeature);
  assert.equal(uploadAndUseBlockReason(baseInput({ gates })), gates.uploadImage);
  assert.equal(suppressBlockReason(baseInput({ gates }), 'item-1'), gates.suppressFeature);
});

test('a capability refusal on updateFeature is Apply’s reason, verbatim', () => {
  const reason = 'This API key cannot write to documents. Create a new key with Write documents ticked.';
  const gates = featureGateReasons({
    capabilities: { features: { updateFeature: { allowed: false, reason } } },
    policy: {}
  });
  assert.equal(gates.updateFeature, reason);
  assert.equal(applyBlockReason(baseInput({ gates }), '').text, reason);
});

test('the rebind gate blocks upload-and-use on its own, since that button needs both', () => {
  const gates = { rebindImage: 'Pointing a feature at a new image is refused.' };
  assert.equal(uploadAndUseBlockReason(baseInput({ gates })), gates.rebindImage);
  // Install does not rebind anything, so the same gate leaves it alone.
  assert.equal(installBlockReason(baseInput({ gates })), '');
});

test('every gate name the browser asks for is a real feature in src/capabilities.mjs', async () => {
  const source = await fs.readFile(path.join(root, 'public/write-gates.mjs'), 'utf8');
  const asked = [...source.matchAll(/gateReason\(gates, '([^']+)'\)/g)].map((match) => match[1]);
  assert.ok(asked.length >= 4, `expected the write gates to consult several features, found ${asked.length}`);
  for (const feature of asked) {
    assert.ok(FEATURES[feature], `write-gates.mjs asks for an unknown feature: ${feature}`);
  }
});

// ---------------------------------------------------------------------------
// A too-large image
// ---------------------------------------------------------------------------

test('an image over the server’s cap names both numbers and the setting that raises it', () => {
  const input = baseInput({
    state: {
      sourceBlob: { size: 12 * 1024 * 1024 },
      install: { available: true, data: { state: 'absent' }, maxImageUploadBytes: 8 * 1024 * 1024 }
    },
    form: { installSelection: UPLOAD_OPTION }
  });
  const expected = 'This image is 12.0 MB and the server accepts 8.0 MB. Resize it, or raise MAX_IMAGE_UPLOAD_BYTES in the configuration file.';
  assert.equal(installBlockReason(input), expected);
  assert.equal(uploadAndUseBlockReason(input), expected);
});

test('an image inside the cap is not blocked, and an unknown cap never blocks', () => {
  const withinCap = baseInput({
    state: { sourceBlob: { size: 1000 }, install: { available: true, data: { state: 'absent' }, maxImageUploadBytes: 2000 } },
    form: { installSelection: UPLOAD_OPTION }
  });
  assert.equal(installBlockReason(withinCap), '');

  const unknownCap = baseInput({
    state: { sourceBlob: { size: 99 * 1024 * 1024 }, install: { available: true, data: { state: 'absent' }, maxImageUploadBytes: undefined } },
    form: { installSelection: UPLOAD_OPTION }
  });
  assert.equal(installBlockReason(unknownCap), '');
});

test('the upload branch of Install asks for a local image before it asks about size', () => {
  const input = baseInput({
    state: { sourceBlob: undefined, install: { available: true, data: { state: 'absent' }, maxImageUploadBytes: 1 } },
    form: { installSelection: UPLOAD_OPTION }
  });
  assert.equal(installBlockReason(input), GATE_MESSAGES.NO_LOCAL_IMAGE);
});

// ---------------------------------------------------------------------------
// The rest of each predicate's own ladder
// ---------------------------------------------------------------------------

test('Install reports what the document itself is doing, in the server’s order', () => {
  assert.equal(
    installBlockReason(baseInput({ state: { install: { available: false, error: 'Onshape rejected this key.' } } })),
    'Onshape rejected this key.'
  );
  assert.equal(
    installBlockReason(baseInput({ state: { install: { available: false, error: '' } } })),
    'This document could not be read. Press Refresh and try again.'
  );
  assert.equal(
    installBlockReason(baseInput({ state: { install: { available: true, data: undefined } } })),
    'Still reading this document…'
  );
  assert.equal(
    installBlockReason(baseInput({ state: { install: { available: true, data: { state: 'instance-present' } } } })),
    'This document already has a Calibrated Reference Image feature. Choose it under Target.'
  );
  assert.equal(
    installBlockReason(baseInput({ form: { installSelection: '' } })),
    'Choose an image tab, or load a local image to upload.'
  );
});

test('upload-and-use only points a calibrated feature at a new image', () => {
  assert.equal(
    uploadAndUseBlockReason(baseInput({ state: { selectedItem: undefined } })),
    'Choose the feature to point at this image under Target.'
  );
  assert.equal(
    uploadAndUseBlockReason(baseInput({ state: { selectedItem: { kind: 'native', editable: true } } })),
    'Only a Calibrated Reference Image feature can be pointed at a different image.'
  );
  assert.equal(
    uploadAndUseBlockReason(baseInput({ state: { selectedItem: { kind: 'custom', editable: false } } })),
    'That feature is read-only in the current context.'
  );
  assert.equal(uploadAndUseBlockReason(baseInput({ state: { sourceBlob: undefined } })), GATE_MESSAGES.NO_LOCAL_IMAGE);
});

test('suppression without an item says so before it looks at the document', () => {
  assert.equal(suppressBlockReason(baseInput({ state: { context: undefined } }), undefined), 'No sketch selected.');
});

test('Preview walks the picks in the order it needs them', () => {
  assert.match(previewBlockReason(baseInput({ state: { sourceImage: undefined } })), /^Load a reference image first/);
  assert.match(
    previewBlockReason(baseInput({ state: { picks: { scale: {}, rotation: {} } } })),
    /^Pick S1 and S2 on the image/
  );
  assert.equal(previewBlockReason(baseInput({ state: { picks: { scale: { b: POINT }, rotation: {} } } })), 'Pick S1 on the image.');
  assert.equal(previewBlockReason(baseInput({ state: { picks: { scale: { a: POINT }, rotation: {} } } })), 'Pick S2 on the image.');
  assert.equal(previewBlockReason(baseInput({ form: { distance: 0 } })), 'Enter a true distance greater than zero.');
  assert.equal(previewBlockReason(baseInput({ form: { distance: Number.NaN } })), 'Enter a true distance greater than zero.');
});

test('Preview asks for the rotation pair only when the same-pair switch is off', () => {
  const separate = { samePair: false };
  assert.match(
    previewBlockReason(baseInput({ state: { picks: { scale: { a: POINT, b: POINT }, rotation: {} } }, form: separate })),
    /^Pick R1 and R2/
  );
  assert.match(
    previewBlockReason(baseInput({ state: { picks: { scale: { a: POINT, b: POINT }, rotation: { b: POINT } } }, form: separate })),
    /^Pick R1,/
  );
  // With the switch on, the same missing rotation picks block nothing.
  assert.equal(
    previewBlockReason(baseInput({ state: { picks: { scale: { a: POINT, b: POINT }, rotation: {} } }, form: { samePair: true } })),
    ''
  );
});

// The "before using it as the anchor" sentence cannot currently be reached:
// with the same-pair switch off, a missing R1 or R2 is already refused a few
// lines earlier, and with it on the anchor branch is skipped. This is not new
// — validateForPreview() in app.js, which these predicates mirror step for
// step, has carried the same unreachable throw since it was written, and this
// module was extracted without changing behaviour. The test states what
// actually happens, so nobody reads that branch as live copy.
test('a missing rotation pick is named by the pick check, before the anchor check can speak', () => {
  const input = baseInput({
    state: { picks: { scale: { a: POINT, b: POINT }, rotation: { a: POINT } } },
    form: { samePair: false, anchor: 'rotation-b' }
  });
  assert.equal(previewBlockReason(input), 'Pick R2, or switch rotation back to the S1 → S2 pair.');

  // With both rotation picks made, the anchor has something to point at and
  // nothing blocks Preview.
  const complete = baseInput({
    state: { picks: { scale: { a: POINT, b: POINT }, rotation: { a: POINT, b: POINT } } },
    form: { samePair: false, anchor: 'rotation-b' }
  });
  assert.equal(previewBlockReason(complete), '');
});

test('a feature whose placement Onshape could not read blocks Preview and Apply with one sentence', () => {
  const input = baseInput({ state: { selectedItem: { id: 'i', kind: 'custom', editable: true, placement: undefined } } });
  assert.equal(previewBlockReason(input), GATE_MESSAGES.UNREADABLE_PLACEMENT);
  // Apply is handed Preview's reason and must not invent a second wording.
  assert.equal(applyBlockReason(input, previewBlockReason(input)).text, GATE_MESSAGES.UNREADABLE_PLACEMENT);
});

test('Apply refuses a target it cannot write, and says which kind of target it is', () => {
  assert.match(
    applyBlockReason(baseInput({ state: { selectedItem: undefined } }), '').text,
    /^No target selected\./
  );
  assert.match(
    applyBlockReason(baseInput({ state: { selectedItem: { kind: 'native', editable: false } } }), '').text,
    /^Native Insert image features cannot be written by default\./
  );
  assert.equal(
    applyBlockReason(baseInput({ state: { selectedItem: { kind: 'custom', editable: false } } }), '').text,
    'This feature is read-only in the current context.'
  );
});

test('Apply surfaces Preview’s reason verbatim rather than a second wording', () => {
  const previewReason = 'Pick S1 on the image.';
  assert.equal(applyBlockReason(baseInput(), previewReason).text, previewReason);
});

test('Apply needs a preview, and a stale one does not count', () => {
  assert.equal(
    applyBlockReason(baseInput({ state: { result: undefined } }), '').text,
    'Press Preview calibration first.'
  );
  assert.equal(
    applyBlockReason(baseInput({ state: { resultSignature: 'old' } }), '').text,
    'Your picks or numbers changed since the last preview. Press Preview calibration again.'
  );
});

// ---------------------------------------------------------------------------
// readScopeMissing: an unknown scope mask is not evidence
// ---------------------------------------------------------------------------

test('an unknown scope mask never counts as a missing read scope', () => {
  assert.equal(readScopeMissing(undefined), false);
  assert.equal(readScopeMissing({}), false);
  assert.equal(readScopeMissing({ capabilities: { scopes: { known: false, read: false } } }), false);
  assert.equal(readScopeMissing({ capabilities: { scopes: { known: true, read: true } } }), false);
  assert.equal(readScopeMissing({ capabilities: { scopes: { known: true, read: false } } }), true);
});

// ---------------------------------------------------------------------------
// Structural invariants
// ---------------------------------------------------------------------------

// Three controls each carried their own copy of this sentence, and the server
// carried a fourth. Byte equality is the only check that keeps a later edit to
// one of them from silently splitting them again.
test('the read-only sentence is byte-identical to the server’s CONTEXT_READ_ONLY refusal', async () => {
  const routes = await fs.readFile(path.join(root, 'src/write-routes.mjs'), 'utf8');
  const index = routes.indexOf(GATE_MESSAGES.CONTEXT_READ_ONLY);
  assert.ok(index > -1, 'src/write-routes.mjs no longer contains the exact sentence write-gates.mjs shows');
  assert.match(routes.slice(index, index + 400), /'CONTEXT_READ_ONLY'/);
});

test('write-gates.mjs is DOM-free and importable with no shim', async () => {
  const source = await fs.readFile(path.join(root, 'public/write-gates.mjs'), 'utf8');
  for (const forbidden of ['document', 'window', 'localStorage', 'fetch', 'elements']) {
    assert.doesNotMatch(
      source.replace(/^\s*\/\/.*$/gm, ''),
      new RegExp(`\\b${forbidden}\\s*[.[(]`),
      `write-gates.mjs must not reference ${forbidden}`
    );
  }
});

// apiFetch is the single request path: one timeout policy, one CSRF header,
// one error contract. A second bare fetch() is how the image download drifted
// into its own copy of the content-type sniff and the error extraction.
test('app.js contains exactly one bare fetch( call, the one inside apiFetch', async () => {
  const script = await fs.readFile(path.join(root, 'public/app.js'), 'utf8');
  // Excludes `apiFetch(` and the backtick-quoted mention in apiFetch's own
  // doc comment.
  const calls = [...script.matchAll(/(?<![.\w`])fetch\(/g)];
  assert.equal(calls.length, 1, `expected one bare fetch(, found ${calls.length}`);

  const start = script.indexOf('async function apiFetch');
  const end = script.indexOf('\n}', start);
  assert.ok(start > -1 && end > start, 'expected an apiFetch function');
  assert.ok(calls[0].index > start && calls[0].index < end, 'the one bare fetch( must be inside apiFetch');
});

test('every block reason app.js shows comes from write-gates.mjs, not from a local copy', async () => {
  const script = await fs.readFile(path.join(root, 'public/app.js'), 'utf8');
  const imported = /import \{[^}]*\} from '\.\/write-gates\.mjs';/s.exec(script);
  assert.ok(imported, 'expected app.js to import the write gates');
  for (const name of [
    'applyBlockReason',
    'installBlockReason',
    'previewBlockReason',
    'readScopeMissing',
    'suppressBlockReason',
    'uploadAndUseBlockReason',
    'UPLOAD_OPTION'
  ]) {
    assert.match(imported[0], new RegExp(`\\b${name}\\b`), name);
    assert.doesNotMatch(script, new RegExp(`(function|const) ${name}\\b`), `${name} must not be redefined in app.js`);
  }
});

// The packaged binary serves public/ out of the SEA asset map, so a new module
// that is not listed there 404s for every user of a released build while
// working perfectly from a checkout.
test('write-gates.mjs is an embedded SEA asset', async () => {
  const config = JSON.parse(await fs.readFile(path.join(root, 'sea-config.json'), 'utf8'));
  assert.equal(config.assets['public/write-gates.mjs'], 'public/write-gates.mjs');
});
