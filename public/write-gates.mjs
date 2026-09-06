// Pure decision logic for every control this app can disable: the sentence
// that explains why Preview, Apply, Install, Upload-and-use, or Suppress
// cannot run right now, and '' when nothing blocks it. No DOM, no network, no
// browser globals — app.js reads the handful of form values these need and
// passes them in — so each predicate is unit testable with plain node --test,
// the same pattern as url-context.mjs, connection-state.mjs and
// update-banner.mjs.
//
// Three rules hold throughout this module:
//
//   1. A refusal the server would raise is shown in the server's own words.
//      `gates` is bootstrap.gates, built by featureGateReasons() in
//      src/capability-gate.mjs from the same describeFeatureGate() that
//      requireFeature() throws from, and it is passed through verbatim and
//      never edited. CONTEXT_READ_ONLY below is copied character for
//      character from requireWorkspaceContext() in src/write-routes.mjs;
//      test/write-gates.test.mjs reads both files and fails if they ever
//      differ. A disabled button and the 403 or 409 behind it cannot say
//      different things.
//
//   2. These functions return strings. updateControlStates() in app.js stays
//      the only code that writes `.disabled` or calls setReason().
//
//   3. The order of the checks is the order the server refuses in, so the
//      reason shown before a press is the reason that would have come back
//      after it.
//
// The input is one object, built by writeGateInput() in app.js:
//
//   @typedef {object} GateInput
//   @property {object} state  The app's state object.
//   @property {object} auth   state.bootstrap.auth, or {}.
//   @property {object} gates  state.bootstrap.gates, or {}.
//   @property {object} form   The control values these predicates read:
//     {number} distance, {boolean} samePair, {string} anchor,
//     {string} installSelection, {string} inputSignature.
//
// state.bootstrap.policy is deliberately not part of the input. The only
// setting a write control consults is confirmBeforeWrite, which is asked at
// press time by confirmWrite() in app.js, not here — an unread parameter
// would be the same dead control this module exists to avoid.

// The value the "Image to use" picker carries for "upload the local image
// instead of choosing a tab". Defined here rather than in app.js because
// installBlockReason() has to recognise it, and two spellings of it would
// silently disable the wrong branch.
export const UPLOAD_OPTION = '__upload__';

export function replaneBlockReason(input, planeId) {
  const { state, gates } = input;
  if (state?.busy || state?.install?.busy) return GATE_MESSAGES.BUSY;
  const contextReason = writeContextReason(input, WRITE_COPY);
  if (contextReason) return contextReason;
  const refusal = gateReason(gates, 'installFeature');
  if (refusal) return refusal;
  if (state?.selectedItem?.kind !== 'custom') return 'Select a calibrated reference image under Target.';
  if (state?.install?.planesLoading) return 'Checking available planes…';
  if (state?.install?.planeError) return state.install.planeError;
  const plane = state?.install?.planes?.find((candidate) => candidate.id === planeId);
  if (!plane) return 'Choose a plane.';
  if (plane.unavailableReason) return plane.unavailableReason;
  if (state.install.selectedPlane?.id === planeId) return 'The image is already on this plane.';
  return '';
}

export const GATE_MESSAGES = Object.freeze({
  BUSY: 'Working…',
  APPLY_BUSY: 'Applying…',
  NO_CONTEXT: 'Open Document and paste your Part Studio link first.',
  APPLY_NO_CONTEXT: 'Apply needs an Onshape Part Studio. Paste your Part Studio URL in the Onshape target card.',
  // Verbatim from requireWorkspaceContext() in src/write-routes.mjs, where it
  // is thrown as CONTEXT_READ_ONLY with a 409. Three controls showed their own
  // copy of this sentence before; there is one now, and a test pins it to the
  // server's.
  CONTEXT_READ_ONLY: 'This is a read-only version or microversion link. Open the same tab from the document’s workspace — the address with /w/ in it.',
  NOT_SET_UP: 'Onshape is not set up yet. Open Connection to connect your account.',
  APPLY_NOT_SET_UP: 'Onshape is not set up yet. Open Connection to connect your account, or preview your image without connecting.',
  NOT_AUTHORIZED: 'Onshape is not authorized. Open Document and press Authorize Onshape.',
  NO_LOCAL_IMAGE: 'Load an image first — press Load local image.',
  UNREADABLE_PLACEMENT: "Onshape could not read this feature's current width and angle. Replace its expression-driven parameters with plain numbers, then press Refresh."
});

const EMPTY_PICKS = Object.freeze({ scale: Object.freeze({}), rotation: Object.freeze({}) });

// Apply names which kind of read-only link was pasted, because the paste box
// is right there and re-pasting is the fix. The three buttons that use the
// server's CONTEXT_READ_ONLY sentence are further from it and say less.
function applyReadOnlyMessage(workspaceOrVersion) {
  const kind = workspaceOrVersion === 'v' ? 'version' : 'microversion';
  return `This is a ${kind} link, which is read-only. Open the same tab from the document's workspace — the address with /w/ in it — and paste that URL instead.`;
}

// The server's refusal sentence for a feature, or '' when nothing refuses it.
// Never edited, never substituted for: an unknown feature name reads as
// "allowed", which is the server's job to catch, not a place to invent copy.
function gateReason(gates, feature) {
  return gates?.[feature] || '';
}

// The preamble every write control shares, in the order the server itself
// refuses: no context, then a read-only link, then no usable credentials.
// Written once; each caller supplies only the sentences that differ.
function writeContextReason({ state, auth }, copy) {
  if (!state?.context?.complete) return copy.noContext;
  if (state.context.workspaceOrVersion !== 'w') return copy.readOnly(state.context.workspaceOrVersion);
  if (!auth?.canRequest) return copy.notSetUp(auth);
  return '';
}

const WRITE_COPY = Object.freeze({
  noContext: GATE_MESSAGES.NO_CONTEXT,
  readOnly: () => GATE_MESSAGES.CONTEXT_READ_ONLY,
  notSetUp: () => GATE_MESSAGES.NOT_SET_UP
});

const APPLY_COPY = Object.freeze({
  noContext: GATE_MESSAGES.APPLY_NO_CONTEXT,
  readOnly: applyReadOnlyMessage,
  notSetUp: (auth) => (auth?.connection?.state === 'oauth-required'
    ? GATE_MESSAGES.NOT_AUTHORIZED
    : GATE_MESSAGES.APPLY_NOT_SET_UP)
});

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// The server refuses an oversized upload with the same two numbers. Saying it
// here means the operator finds out before sending the bytes, not after.
function uploadSizeReason(state) {
  const cap = state?.install?.maxImageUploadBytes;
  const size = state?.sourceBlob?.size;
  if (!cap || !size || size <= cap) return '';
  return `This image is ${formatBytes(size)} and the server accepts ${formatBytes(cap)}. Resize it, or raise MAX_IMAGE_UPLOAD_BYTES in the configuration file.`;
}

/**
 * True only when a probe has actually answered and said the Read documents
 * scope is absent. An unknown scope mask is not evidence of anything, so it
 * must not disable a control.
 */
export function readScopeMissing(auth) {
  const scopes = auth?.capabilities?.scopes;
  return Boolean(scopes?.known) && !scopes.read;
}

/**
 * Why Preview cannot run. Mirrors validateForPreview() in app.js (kept there
 * as a defense-in-depth throw) in the same order, so the button's disabled
 * reason always matches what would actually stop a preview request.
 */
export function previewBlockReason({ state, form }) {
  if (state?.busy) return GATE_MESSAGES.BUSY;
  if (!state?.sourceImage) return 'Load a reference image first — press Load local image or Load selected Onshape image.';
  const picks = state.picks || EMPTY_PICKS;
  if (!picks.scale.a && !picks.scale.b) return 'Pick S1 and S2 on the image: the two pixels whose real distance you know.';
  if (!picks.scale.a) return 'Pick S1 on the image.';
  if (!picks.scale.b) return 'Pick S2 on the image.';
  const distance = Number(form?.distance);
  if (!Number.isFinite(distance) || distance <= 0) return 'Enter a true distance greater than zero.';
  const samePair = Boolean(form?.samePair);
  if (!samePair) {
    if (!picks.rotation.a && !picks.rotation.b) return 'Pick R1 and R2, or switch rotation back to the S1 → S2 pair.';
    if (!picks.rotation.a) return 'Pick R1, or switch rotation back to the S1 → S2 pair.';
    if (!picks.rotation.b) return 'Pick R2, or switch rotation back to the S1 → S2 pair.';
  }
  const anchor = form?.anchor;
  if (!samePair && (anchor === 'rotation-a' || anchor === 'rotation-b')) {
    const key = anchor === 'rotation-a' ? 'a' : 'b';
    if (!picks.rotation[key]) return `Pick ${anchor === 'rotation-a' ? 'R1' : 'R2'} before using it as the anchor.`;
  }
  if (state.selectedItem && !state.selectedItem.placement) return GATE_MESSAGES.UNREADABLE_PLACEMENT;
  return '';
}

/**
 * Apply's gate. Returns `{disabled, text}` rather than a bare string because
 * Apply's help paragraph is shown either way: enabled, it says what the write
 * will do; disabled, it says why it will not.
 *
 * `previewReasonText` is passed in so a reason that would also block Preview
 * (missing image, missing picks, an unreadable placement) surfaces here with
 * the identical wording instead of a separate, potentially contradictory one.
 */
export function applyBlockReason(input, previewReasonText) {
  const { state, gates } = input;
  if (state?.busy) return { disabled: true, text: GATE_MESSAGES.APPLY_BUSY };

  const contextReason = writeContextReason(input, APPLY_COPY);
  if (contextReason) return { disabled: true, text: contextReason };

  // updateFeature has no policy switch (FEATURES in src/capabilities.mjs
  // gives it policyKey: null), so this gate string is the capability record's
  // own refusal — the same sentence POST /api/apply would answer with.
  const writeGate = gateReason(gates, 'updateFeature');
  if (writeGate) return { disabled: true, text: writeGate };

  if (!state.selectedItem) {
    return { disabled: true, text: 'No target selected. Choose a feature under Target — standalone mode calculates the numbers but writes nothing.' };
  }
  if (!state.selectedItem.editable && state.selectedItem.kind === 'native') {
    return {
      disabled: true,
      text: 'Native Insert image features cannot be written by default. Insert your image with the Calibrated Reference Image FeatureScript instead — download it at the bottom of this panel.'
    };
  }
  if (!state.selectedItem.editable) return { disabled: true, text: 'This feature is read-only in the current context.' };
  if (!state.selectedItem.placement) return { disabled: true, text: GATE_MESSAGES.UNREADABLE_PLACEMENT };
  if (previewReasonText) return { disabled: true, text: previewReasonText };
  if (!state.result) return { disabled: true, text: 'Press Preview calibration first.' };
  if (state.resultSignature !== input.form?.inputSignature) {
    return { disabled: true, text: 'Your picks or numbers changed since the last preview. Press Preview calibration again.' };
  }
  return {
    disabled: false,
    text: `Apply writes imageWidth, imageAngle, originX, and originY to “${state.selectedItem.featureName}”. A JSON backup is saved on the server first.`
  };
}

/**
 * Why the one-click Install button cannot run.
 */
export function installBlockReason(input) {
  const { state, gates, form } = input;
  if (state?.busy || state?.install?.busy) return GATE_MESSAGES.BUSY;

  const contextReason = writeContextReason(input, WRITE_COPY);
  if (contextReason) return contextReason;

  const installGate = gateReason(gates, 'installFeature');
  if (installGate) return installGate;

  if (state.install?.available === false) {
    return state.install.error || 'This document could not be read. Press Refresh and try again.';
  }
  if (!state.install?.data) return 'Still reading this document…';
  if (state.install.data.state === 'instance-present') {
    return 'This document already has a Calibrated Reference Image feature. Choose it under Target.';
  }
  const selection = form?.installSelection;
  if (!selection) return 'Choose an image tab, or load a local image to upload.';
  if (selection === UPLOAD_OPTION) {
    if (!state.sourceBlob) return GATE_MESSAGES.NO_LOCAL_IMAGE;
    const uploadGate = gateReason(gates, 'uploadImage');
    if (uploadGate) return uploadGate;
    const sizeReason = uploadSizeReason(state);
    if (sizeReason) return sizeReason;
  }
  return '';
}

/**
 * Why "Upload the local image and use it" cannot run. This one always sends
 * state.sourceBlob and ignores the "Image to use" picker, so it checks two
 * gates: uploading the bytes, and pointing an existing feature at them.
 */
export function uploadAndUseBlockReason(input) {
  const { state, gates } = input;
  if (state?.busy || state?.install?.busy) return GATE_MESSAGES.BUSY;

  const contextReason = writeContextReason(input, WRITE_COPY);
  if (contextReason) return contextReason;

  const uploadGate = gateReason(gates, 'uploadImage');
  if (uploadGate) return uploadGate;
  const rebindGate = gateReason(gates, 'rebindImage');
  if (rebindGate) return rebindGate;

  if (!state.sourceBlob) return GATE_MESSAGES.NO_LOCAL_IMAGE;
  const sizeReason = uploadSizeReason(state);
  if (sizeReason) return sizeReason;
  if (!state.selectedItem) return 'Choose the feature to point at this image under Target.';
  if (state.selectedItem.kind !== 'custom') {
    return 'Only a Calibrated Reference Image feature can be pointed at a different image.';
  }
  if (!state.selectedItem.editable) return 'That feature is read-only in the current context.';
  return '';
}

/**
 * Why neither suppression button can run. Both directions refuse for the same
 * reasons, in the order the server would refuse them.
 */
export function suppressBlockReason(input, itemId) {
  const { state, gates } = input;
  if (state?.busy || state?.suppression?.busy) return GATE_MESSAGES.BUSY;
  if (!itemId) return 'No sketch selected.';

  const contextReason = writeContextReason(input, WRITE_COPY);
  if (contextReason) return contextReason;

  return gateReason(gates, 'suppressFeature');
}
