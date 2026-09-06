import { parseOnshapeUrl, contextToSearch } from './url-context.mjs';
import { describeConnection, validateApiKeyInput, setupFailureMessage, SETUP_UNAVAILABLE_MESSAGES } from './connection-state.mjs';
import { shouldShowUpdateBanner } from './update-banner.mjs';
import {
  applyBlockReason,
  installBlockReason,
  previewBlockReason,
  readScopeMissing,
  replaneBlockReason,
  suppressBlockReason,
  uploadAndUseBlockReason,
  UPLOAD_OPTION
} from './write-gates.mjs';

const $ = (id) => document.getElementById(id);

const elements = {
  updateBanner: $('updateBanner'),
  updateBannerText: $('updateBannerText'),
  updateBannerLink: $('updateBannerLink'),
  updateBannerDismiss: $('updateBannerDismiss'),
  modeBadge: $('modeBadge'),
  authBadge: $('authBadge'),
  setupCard: $('setupCard'),
  setupUnavailable: $('setupUnavailable'),
  setupForm: $('setupForm'),
  setupAccessKey: $('setupAccessKey'),
  setupSecretKey: $('setupSecretKey'),
  setupSecretRevealBtn: $('setupSecretRevealBtn'),
  setupKeyHint: $('setupKeyHint'),
  setupAdvanced: $('setupAdvanced'),
  setupBaseUrl: $('setupBaseUrl'),
  setupTestBtn: $('setupTestBtn'),
  setupSaveBtn: $('setupSaveBtn'),
  setupSaveReason: $('setupSaveReason'),
  setupStatus: $('setupStatus'),
  setupError: $('setupError'),
  setupConnected: $('setupConnected'),
  setupConnectedName: $('setupConnectedName'),
  setupReconfigureBtn: $('setupReconfigureBtn'),
  setupCancelBtn: $('setupCancelBtn'),
  setupConfigPath: $('setupConfigPath'),
  planBadge: $('planBadge'),
  settingsCard: $('settingsCard'),
  settingsDetails: $('settingsDetails'),
  settingsUnavailable: $('settingsUnavailable'),
  settingsAllowFeatureInstall: $('settingsAllowFeatureInstall'),
  settingsAllowImageUpload: $('settingsAllowImageUpload'),
  settingsAllowDocumentCreation: $('settingsAllowDocumentCreation'),
  settingsAllowSuppression: $('settingsAllowSuppression'),
  settingsConfirmBeforeWrite: $('settingsConfirmBeforeWrite'),
  settingsScratchFolderId: $('settingsScratchFolderId'),
  settingsSaveBtn: $('settingsSaveBtn'),
  settingsReason: $('settingsReason'),
  settingsStatus: $('settingsStatus'),
  settingsError: $('settingsError'),
  settingsPath: $('settingsPath'),
  capFeatureInstall: $('capFeatureInstall'),
  capImageUpload: $('capImageUpload'),
  capDocumentCreation: $('capDocumentCreation'),
  capSuppression: $('capSuppression'),
  capDeleteCleanup: $('capDeleteCleanup'),
  onshapeCard: $('onshapeCard'),
  installSection: $('installSection'),
  installState: $('installState'),
  installImageSelect: $('installImageSelect'),
  installBtn: $('installBtn'),
  installReason: $('installReason'),
  uploadUseImageBtn: $('uploadUseImageBtn'),
  uploadUseImageReason: $('uploadUseImageReason'),
  installStatus: $('installStatus'),
  installError: $('installError'),
  unsuppressRow: $('unsuppressRow'),
  unsuppressBtn: $('unsuppressBtn'),
  unsuppressReason: $('unsuppressReason'),
  suppressStatus: $('suppressStatus'),
  suppressError: $('suppressError'),
  duplicateOffer: $('duplicateOffer'),
  duplicateOfferText: $('duplicateOfferText'),
  duplicateOfferExplain: $('duplicateOfferExplain'),
  duplicateSuppressBtn: $('duplicateSuppressBtn'),
  duplicateSuppressReason: $('duplicateSuppressReason'),
  imageSummary: $('imageSummary'),
  sourceCanvas: $('sourceCanvas'),
  previewCanvas: $('previewCanvas'),
  canvasStage: $('canvasStage'),
  loupeCanvas: $('loupeCanvas'),
  emptyState: $('emptyState'),
  previewEmpty: $('previewEmpty'),
  pickHud: $('pickHud'),
  cursorReadout: $('cursorReadout'),
  fileInput: $('fileInput'),
  emptyLoadBtn: $('emptyLoadBtn'),
  loadFileBtn: $('loadFileBtn'),
  loadOnshapeBtn: $('loadOnshapeBtn'),
  fitBtn: $('fitBtn'),
  zoomInBtn: $('zoomInBtn'),
  zoomOutBtn: $('zoomOutBtn'),
  panBtn: $('panBtn'),
  contextMessage: $('contextMessage'),
  urlBoxDetails: $('urlBoxDetails'),
  urlBoxSummary: $('urlBoxSummary'),
  onshapeUrlInput: $('onshapeUrlInput'),
  urlParsed: $('urlParsed'),
  urlParsedDocument: $('urlParsedDocument'),
  urlParsedWorkspace: $('urlParsedWorkspace'),
  urlParsedElement: $('urlParsedElement'),
  urlParsedWorkspaceKind: $('urlParsedWorkspaceKind'),
  urlOpenInOnshape: $('urlOpenInOnshape'),
  urlWarning: $('urlWarning'),
  urlError: $('urlError'),
  loadUrlBtn: $('loadUrlBtn'),
  loadOnshapeReason: $('loadOnshapeReason'),
  refreshFeaturesReason: $('refreshFeaturesReason'),
  scalePickReason: $('scalePickReason'),
  rotationPickReason: $('rotationPickReason'),
  previewReason: $('previewReason'),
  featureSelect: $('featureSelect'),
  featureDetails: $('featureDetails'),
  refreshFeaturesBtn: $('refreshFeaturesBtn'),
  authorizeLink: $('authorizeLink'),
  clearPicksBtn: $('clearPicksBtn'),
  pickScaleA: $('pickScaleA'),
  pickScaleB: $('pickScaleB'),
  pickRotationA: $('pickRotationA'),
  pickRotationB: $('pickRotationB'),
  scaleACoord: $('scaleACoord'),
  scaleBCoord: $('scaleBCoord'),
  rotationACoord: $('rotationACoord'),
  rotationBCoord: $('rotationBCoord'),
  distanceInput: $('distanceInput'),
  distanceUnit: $('distanceUnit'),
  samePairToggle: $('samePairToggle'),
  rotationPickGroup: $('rotationPickGroup'),
  rotationMode: $('rotationMode'),
  customAngleField: $('customAngleField'),
  customAngleInput: $('customAngleInput'),
  anchorSelect: $('anchorSelect'),
  previewBtn: $('previewBtn'),
  applyBtn: $('applyBtn'),
  applyHelp: $('applyHelp'),
  resultsCard: $('resultsCard'),
  resultStatus: $('resultStatus'),
  resultWidth: $('resultWidth'),
  resultAngle: $('resultAngle'),
  resultScale: $('resultScale'),
  resultResidual: $('resultResidual'),
  resultOriginX: $('resultOriginX'),
  resultOriginY: $('resultOriginY'),
  resultWidthExpr: $('resultWidthExpr'),
  resultAngleExpr: $('resultAngleExpr'),
  copyParamsBtn: $('copyParamsBtn'),
  downloadRecipeBtn: $('downloadRecipeBtn'),
  downloadPngBtn: $('downloadPngBtn'),
  toastRegion: $('toastRegion')
};

const state = {
  csrfToken: '',
  bootstrap: undefined,
  context: undefined,
  // Version string the update banner is currently showing (or last showed),
  // so Dismiss can remember exactly which version it was dismissing.
  updateLatestVersion: undefined,
  items: [],
  selectedItem: undefined,
  sourceImage: undefined,
  sourceObjectUrl: undefined,
  // The bytes themselves, kept so the loaded image can be re-sent to Onshape
  // as a blob element. The decoded Image cannot be turned back into the
  // original file, and re-encoding it would change the pixels the calibration
  // was measured against.
  sourceBlob: undefined,
  sourceName: undefined,
  sourceOrigin: 'local',
  picks: {
    scale: { a: undefined, b: undefined },
    rotation: { a: undefined, b: undefined }
  },
  pickTarget: undefined,
  hoverPixel: undefined,
  view: {
    zoom: 1,
    panX: 0,
    panY: 0,
    panMode: false,
    spacePan: false,
    pointerId: undefined,
    dragStart: undefined,
    dragMoved: false
  },
  standalonePlacement: { originX: 0, originY: 0, width: 1, angle: 0 },
  result: undefined,
  resultSignature: undefined,
  busy: false,
  setup: {
    busy: false,
    testedSignature: undefined,
    lastResult: undefined
  },
  settings: {
    busy: false,
    available: undefined,
    unavailableReason: undefined,
    loaded: false,
    path: '',
    warnings: []
  },
  install: {
    busy: false,
    planes: [],
    planesLoading: false,
    planeError: '',
    selectedPlane: null,
    statusGeneration: 0,
    available: undefined,
    data: undefined,
    error: '',
    maxImageUploadBytes: undefined
  },
  // The server's advisory cross-reference from the last successful Apply:
  // native sketch images that plausibly show the same picture as the feature
  // just written. Re-checked against state.items before anything is offered,
  // so a sketch that has since been deleted or hidden is not offered again.
  suppression: {
    busy: false,
    offers: [],
    targetId: undefined,
    // The item this panel's own Suppress/Unsuppress buttons last acted on.
    // Apply and the duplicate-image offer both leave Target selected on the
    // calibrated feature, not on the native sketch that was just hidden, so
    // unsuppressCandidate() falls back to this id when the current selection
    // is not itself a hidden native sketch.
    lastSuppressedId: undefined
  }
};

// Which policy switch pairs with which capability, and which line of copy
// under it reports what the key itself can do. One table so a new toggle
// cannot land with a switch but no capability line, or the reverse.
const POLICY_ROWS = Object.freeze([
  { key: 'allowFeatureInstall', input: 'settingsAllowFeatureInstall', feature: 'installFeature', capacity: 'capFeatureInstall' },
  { key: 'allowImageUpload', input: 'settingsAllowImageUpload', feature: 'uploadImage', capacity: 'capImageUpload' },
  { key: 'allowDocumentCreation', input: 'settingsAllowDocumentCreation', feature: 'createDocument', capacity: 'capDocumentCreation' },
  { key: 'allowSuppression', input: 'settingsAllowSuppression', feature: 'suppressFeature', capacity: 'capSuppression' }
]);

const LENGTH_TO_METERS = Object.freeze({
  mm: 0.001,
  cm: 0.01,
  in: 0.0254,
  ft: 0.3048,
  m: 1
});

function cssVar(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function formatNumber(value, digits = 6) {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if ((abs > 0 && abs < 1e-5) || abs >= 1e7) return value.toExponential(5);
  return Number(value.toPrecision(digits)).toString();
}

function signedDegrees(radians) {
  const degrees = radians * 180 / Math.PI;
  return ((degrees + 180) % 360 + 360) % 360 - 180;
}

function pointText(point) {
  return point ? `${point.x.toFixed(2)}, ${point.y.toFixed(2)} px` : 'Not set';
}

function imageSize() {
  if (!state.sourceImage) return undefined;
  return {
    width: state.sourceImage.naturalWidth,
    height: state.sourceImage.naturalHeight
  };
}

function selectedPlacement() {
  return state.selectedItem ? state.selectedItem.placement : state.standalonePlacement;
}

function contextSearchParams(context = state.context) {
  // Delegates to contextToSearch() so the query-string shape can never drift
  // between the paste-URL parser and the rest of the app.
  return new URLSearchParams(contextToSearch(context));
}

function withContext(pathname, extra = {}) {
  const params = contextSearchParams();
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, value);
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function sendOnshapeMessage(messageName, extra = {}) {
  if (window.parent === window || !state.context?.complete) return;
  const targetOrigin = (() => {
    try {
      return new URL(state.bootstrap?.capabilities?.onshapeBaseUrl || 'https://cad.onshape.com').origin;
    } catch {
      return '*';
    }
  })();
  window.parent.postMessage({
    documentId: state.context.documentId,
    workspaceId: state.context.workspaceOrVersionId,
    elementId: state.context.elementId,
    messageName,
    ...extra
  }, targetOrigin);
}

/**
 * The one request path in this app. Every call to our own server goes through
 * here; there is exactly one bare `fetch(` in this file, and it is the one
 * below. test/ui-contract.test.mjs fails if a second one appears.
 *
 * `responseType` is 'json' for everything except GET /api/image, which needs
 * the bytes. The failure path is identical either way, which is the point:
 * the image download used to be a second copy of the content-type sniff and
 * the error extraction, free to drift from this one.
 *
 * The error it throws is a contract, and describeApiError() below is the only
 * thing that reads it:
 *   - `error.status`   the HTTP status, or undefined when the request never
 *                      reached this server at all (a transport failure).
 *   - `error.payload`  the parsed JSON body when the server sent one, so a
 *                      documented `payload.code` can be recognised; the raw
 *                      text otherwise.
 *   - `error.name`     'TimeoutError' when this browser gave up waiting.
 */
async function apiFetch(pathname, options = {}) {
  const { timeoutMs = 30_000, responseType = 'json', ...rest } = options;
  const headers = new Headers(rest.headers || {});
  // Only a string body is ours to label. A FormData body needs fetch to pick
  // the multipart boundary, and naming a Content-Type here would leave it out.
  if (typeof rest.body === 'string' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if ((rest.method || 'GET').toUpperCase() !== 'GET' && state.csrfToken) {
    headers.set('X-CSRF-Token', state.csrfToken);
  }
  let response;
  try {
    response = await fetch(pathname, { ...rest, headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    if (error.name === 'TimeoutError') {
      const timeoutError = new Error(`The server did not respond within ${Math.round(timeoutMs / 1000)} seconds.`);
      timeoutError.name = 'TimeoutError';
      throw timeoutError;
    }
    throw error;
  }
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  if (!response.ok) {
    // A refusal is JSON or text whatever the caller asked for: this server
    // never answers an error with image bytes.
    const payload = isJson ? await response.json() : await response.text();
    const error = new Error(payload?.error || payload || `Request failed (${response.status}).`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  if (responseType === 'blob') return response.blob();
  return isJson ? response.json() : response.text();
}

/**
 * The one place a failed apiFetch becomes a sentence for the reader.
 *
 * Two kinds of failure share this path:
 *   - `payload.code`, a refusal this server documented. It means the same
 *     thing wherever it is raised, so it is recognised unconditionally.
 *   - an HTTP status. 401, 403 and 404 only carry Onshape's meaning on a
 *     route that proxies Onshape, so those are mapped for `{ upstream: true }`
 *     callers only. On a local-only route (setup, settings) the same statuses
 *     mean something else entirely — a 404 there is a missing route, not a
 *     document nobody can find — and the server's own sentence is the honest
 *     one.
 *
 * Adding a server code means adding it here once, not in each caller.
 */
function describeApiError(error, { upstream = false, fallback = 'The request did not complete.' } = {}) {
  const payload = error?.payload;
  if (['POLICY_DENIED', 'CAPABILITY_DENIED', 'CSRF', 'SETUP_UNAVAILABLE'].includes(payload?.code)) {
    return payload.reason || payload.error || error.message || fallback;
  }
  if (payload?.code === 'SETUP_RATE_LIMITED' && Number.isFinite(payload.retryAfterSeconds)) {
    return `Too many setup attempts. Wait about ${payload.retryAfterSeconds} seconds, then press Test connection again.`;
  }
  if (payload?.code === 'FEATURE_STATUS_NOT_OK') {
    return `${payload.error} (Onshape reported ${payload.featureStatus}.)`;
  }
  if (payload?.code === 'CONFIRM_REQUIRED') return payload.error;
  if (upstream) {
    // A rejected or forbidden key is the failure every other control names
    // with this sentence and a next step; the raw upstream text ("Onshape API
    // request failed with 401 Unauthorized.") names neither.
    if (error?.status === 401 || error?.status === 403) {
      return 'Onshape rejected this server’s API key. Press the Onshape badge at the top to enter a new one.';
    }
    // A 404 from a context-scoped Onshape request almost always means the
    // pasted URL and the API key belong to different accounts (a personal
    // key against a work document), the tab pasted was not a Part Studio (an
    // Assembly or Drawing tab), or the tab has since been deleted.
    if (error?.status === 404) {
      return 'Onshape could not find that document, workspace, or tab. Check that the link is a Part Studio tab and that the account this API key belongs to can open it in Onshape.';
    }
  }
  return error?.message || fallback;
}

function toast(message, kind = '') {
  const node = document.createElement('div');
  node.className = `toast ${kind}`.trim();
  node.textContent = message;
  elements.toastRegion.append(node);
  setTimeout(() => node.remove(), 4200);
}

function setReason(element, text) {
  const has = Boolean(text);
  element.textContent = text || '';
  element.hidden = !has;
  element.classList.toggle('is-blocked', has);
}

function setBusy(busy, label) {
  state.busy = busy;
  elements.previewBtn.textContent = busy && label ? label : 'Preview calibration';
  updateControlStates();
}

function markResultStale() {
  state.result = undefined;
  state.resultSignature = undefined;
  elements.resultsCard.hidden = true;
  elements.previewEmpty.hidden = false;
  drawPreview();
  updateControlStates();
}

function currentInputSignature() {
  return JSON.stringify(buildCalibrationPayload(false));
}

function buildCalibrationPayload(includeContext = true) {
  const samePair = elements.samePairToggle.checked;
  const payload = {
    itemId: state.selectedItem?.id,
    imageSize: imageSize(),
    currentPlacement: selectedPlacement(),
    scalePair: {
      a: state.picks.scale.a,
      b: state.picks.scale.b
    },
    trueDistance: Number(elements.distanceInput.value),
    distanceUnit: elements.distanceUnit.value,
    rotationPair: samePair ? undefined : {
      a: state.picks.rotation.a,
      b: state.picks.rotation.b
    },
    rotationTarget: {
      mode: elements.rotationMode.value,
      customAngle: Number(elements.customAngleInput.value),
      customAngleUnit: 'deg'
    },
    anchor: elements.anchorSelect.value
  };
  if (includeContext && state.context) payload.context = state.context;
  return payload;
}

function validateForPreview() {
  if (!state.sourceImage) throw new Error('Load the reference image first.');
  if (!state.picks.scale.a || !state.picks.scale.b) throw new Error('Pick both scale pixels, S1 and S2.');
  const distance = Number(elements.distanceInput.value);
  if (!Number.isFinite(distance) || distance <= 0) throw new Error('Enter a true distance greater than zero.');
  if (!elements.samePairToggle.checked && (!state.picks.rotation.a || !state.picks.rotation.b)) {
    throw new Error('Pick both rotation pixels, R1 and R2, or use the scale pair for rotation.');
  }
  const anchor = elements.anchorSelect.value;
  if ((anchor === 'rotation-a' || anchor === 'rotation-b') && !elements.samePairToggle.checked) {
    const key = anchor === 'rotation-a' ? 'a' : 'b';
    if (!state.picks.rotation[key]) throw new Error(`Pick ${anchor === 'rotation-a' ? 'R1' : 'R2'} before using it as the anchor.`);
  }
  if (!selectedPlacement()) throw new Error('The current image placement could not be read from Onshape.');
}

function updatePickReadouts() {
  elements.scaleACoord.textContent = pointText(state.picks.scale.a);
  elements.scaleBCoord.textContent = pointText(state.picks.scale.b);
  elements.rotationACoord.textContent = pointText(state.picks.rotation.a);
  elements.rotationBCoord.textContent = pointText(state.picks.rotation.b);
}

function pickLabel(target) {
  return ({
    'scale-a': 'S1 · first known-distance pixel',
    'scale-b': 'S2 · second known-distance pixel',
    'rotation-a': 'R1 · first orientation pixel',
    'rotation-b': 'R2 · second orientation pixel'
  })[target] || '';
}

function setPickTarget(target) {
  // The pick buttons are disabled without a loaded image (see
  // updateControlStates), so this only guards non-click callers such as the
  // Escape-key handler and the scale-a -> scale-b auto-advance in recordPick.
  if (target && !state.sourceImage) return;
  if (target) setStageTab('source');
  state.pickTarget = state.pickTarget === target ? undefined : target;
  document.querySelectorAll('[data-pick]').forEach((button) => {
    button.classList.toggle('active', button.dataset.pick === state.pickTarget);
  });
  elements.canvasStage.classList.toggle('pick-active', Boolean(state.pickTarget));
  if (state.pickTarget) {
    elements.pickHud.hidden = false;
    elements.pickHud.textContent = `Click ${pickLabel(state.pickTarget)} · drag to pan · Esc cancels`;
    elements.canvasStage.focus({ preventScroll: true });
    // Onshape's element-right-panel is narrow enough that the controls stack
    // above the viewer. Bring the image back into view as soon as a pick starts.
    if (window.innerWidth <= 980) {
      requestAnimationFrame(() => {
        elements.canvasStage.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
  } else {
    elements.pickHud.hidden = true;
    elements.pickHud.textContent = '';
  }
  drawSource();
}

function clearPicks() {
  state.picks.scale = { a: undefined, b: undefined };
  state.picks.rotation = { a: undefined, b: undefined };
  setPickTarget(undefined);
  updatePickReadouts();
  markResultStale();
  drawSource();
}

function recordPick(target, point) {
  const [groupName, keyName] = target.split('-');
  const group = groupName === 'scale' ? state.picks.scale : state.picks.rotation;
  group[keyName] = point;
  updatePickReadouts();
  markResultStale();

  if (target === 'scale-a') setPickTarget('scale-b');
  else if (target === 'rotation-a') setPickTarget('rotation-b');
  else setPickTarget(undefined);
  drawSource();
}

function canvasMetrics(canvas, knownRect) {
  const rect = knownRect || canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const pixelWidth = Math.round(width * dpr);
  const pixelHeight = Math.round(height * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const context = canvas.getContext('2d');
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { rect, dpr, width, height, context };
}

function imageToScreen(point) {
  return {
    x: state.view.panX + point.x * state.view.zoom,
    y: state.view.panY + point.y * state.view.zoom
  };
}

function screenToImage(clientX, clientY, knownRect) {
  if (!state.sourceImage) return undefined;
  const rect = knownRect || elements.sourceCanvas.getBoundingClientRect();
  const x = (clientX - rect.left - state.view.panX) / state.view.zoom;
  const y = (clientY - rect.top - state.view.panY) / state.view.zoom;
  const size = imageSize();
  if (x < 0 || y < 0 || x > size.width || y > size.height) return undefined;
  return { x, y };
}

function fitImage() {
  if (!state.sourceImage) return;
  const rect = elements.canvasStage.getBoundingClientRect();
  const size = imageSize();
  const margin = 26;
  state.view.zoom = Math.max(0.0001, Math.min(
    (rect.width - margin * 2) / size.width,
    (rect.height - margin * 2) / size.height
  ));
  state.view.panX = (rect.width - size.width * state.view.zoom) / 2;
  state.view.panY = (rect.height - size.height * state.view.zoom) / 2;
  drawSource();
}

function zoomAt(factor, clientX, clientY) {
  if (!state.sourceImage) return;
  const rect = elements.sourceCanvas.getBoundingClientRect();
  const screenX = clientX === undefined ? rect.width / 2 : clientX - rect.left;
  const screenY = clientY === undefined ? rect.height / 2 : clientY - rect.top;
  const imageX = (screenX - state.view.panX) / state.view.zoom;
  const imageY = (screenY - state.view.panY) / state.view.zoom;
  const next = Math.max(0.005, Math.min(64, state.view.zoom * factor));
  state.view.panX = screenX - imageX * next;
  state.view.panY = screenY - imageY * next;
  state.view.zoom = next;
  drawSource();
}

function drawPoint(context, point, label, color, isHover = false) {
  if (!point) return;
  const screen = imageToScreen(point);
  const radius = isHover ? 7 : 8;
  context.save();
  context.translate(screen.x, screen.y);
  context.lineWidth = 2;
  context.strokeStyle = color;
  context.fillStyle = isHover ? 'rgba(0,0,0,.15)' : 'rgba(15,20,23,.78)';
  context.beginPath();
  context.arc(0, 0, radius, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.beginPath();
  context.moveTo(-radius - 5, 0);
  context.lineTo(radius + 5, 0);
  context.moveTo(0, -radius - 5);
  context.lineTo(0, radius + 5);
  context.stroke();
  if (label) {
    context.font = '800 11px ui-sans-serif, sans-serif';
    context.textBaseline = 'middle';
    const textWidth = context.measureText(label).width;
    context.fillStyle = color;
    context.fillRect(radius + 7, -10, textWidth + 10, 20);
    context.fillStyle = '#fff';
    context.fillText(label, radius + 12, 0);
  }
  context.restore();
}

function drawPair(context, pair, labels, color) {
  if (pair.a && pair.b) {
    const a = imageToScreen(pair.a);
    const b = imageToScreen(pair.b);
    context.save();
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.setLineDash([8, 5]);
    context.beginPath();
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.stroke();
    context.restore();
  }
  drawPoint(context, pair.a, labels[0], color);
  drawPoint(context, pair.b, labels[1], color);
}

function drawSource(knownRect) {
  const { context, width, height } = canvasMetrics(elements.sourceCanvas, knownRect);
  context.clearRect(0, 0, width, height);
  if (!state.sourceImage) return;

  context.save();
  context.translate(state.view.panX, state.view.panY);
  context.scale(state.view.zoom, state.view.zoom);
  context.imageSmoothingEnabled = state.view.zoom < 4;
  context.drawImage(state.sourceImage, 0, 0);
  context.restore();

  const scaleColor = cssVar('--scale', '#ff983d');
  const rotationColor = cssVar('--rotation', '#a78bf0');
  drawPair(context, state.picks.scale, ['S1', 'S2'], scaleColor);
  if (!elements.samePairToggle.checked) {
    drawPair(context, state.picks.rotation, ['R1', 'R2'], rotationColor);
  }
  if (state.hoverPixel && state.pickTarget) {
    const hoverColor = state.pickTarget.startsWith('scale') ? scaleColor : rotationColor;
    drawPoint(context, state.hoverPixel, '', hoverColor, true);
  }
}

function drawLoupe(point) {
  const canvas = elements.loupeCanvas;
  const context = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  context.clearRect(0, 0, width, height);
  if (!state.sourceImage || !point) {
    canvas.classList.remove('visible');
    return;
  }
  canvas.classList.add('visible');
  const crop = 25;
  const sx = point.x - crop / 2;
  const sy = point.y - crop / 2;
  context.fillStyle = '#111';
  context.fillRect(0, 0, width, height);
  context.imageSmoothingEnabled = false;
  context.drawImage(state.sourceImage, sx, sy, crop, crop, 0, 0, width, height);
  context.strokeStyle = '#fff';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(width / 2, 0);
  context.lineTo(width / 2, height);
  context.moveTo(0, height / 2);
  context.lineTo(width, height / 2);
  context.stroke();
  context.strokeStyle = '#000';
  context.strokeRect(0.5, 0.5, width - 1, height - 1);
  context.fillStyle = 'rgba(0,0,0,.78)';
  context.fillRect(0, height - 25, width, 25);
  context.fillStyle = '#fff';
  context.font = '12px ui-monospace, monospace';
  context.textBaseline = 'middle';
  context.fillText(`${point.x.toFixed(2)}, ${point.y.toFixed(2)}`, 7, height - 12.5);
}

function transformedPointForPreview(point, imageWidth, imageHeight, angle, scale, centerX, centerY) {
  const x = point.x - imageWidth / 2;
  const y = point.y - imageHeight / 2;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return {
    x: centerX + scale * (c * x - s * y),
    y: centerY + scale * (s * x + c * y)
  };
}

function drawPreview() {
  const { context, width, height } = canvasMetrics(elements.previewCanvas);
  context.clearRect(0, 0, width, height);
  if (!state.sourceImage || !state.result) return;

  const iw = state.sourceImage.naturalWidth;
  const ih = state.sourceImage.naturalHeight;
  const screenAngle = -state.result.placement.angle;
  const c = Math.abs(Math.cos(screenAngle));
  const s = Math.abs(Math.sin(screenAngle));
  const boundWidth = iw * c + ih * s;
  const boundHeight = iw * s + ih * c;
  const margin = 28;
  const fitScale = Math.min((width - margin * 2) / boundWidth, (height - margin * 2) / boundHeight);
  const cx = width / 2;
  const cy = height / 2;

  context.save();
  context.translate(cx, cy);
  context.scale(fitScale, fitScale);
  context.rotate(screenAngle);
  context.translate(-iw / 2, -ih / 2);
  context.imageSmoothingEnabled = fitScale < 3;
  context.drawImage(state.sourceImage, 0, 0);
  context.restore();

  context.save();
  context.strokeStyle = 'rgba(120,130,138,.5)';
  context.lineWidth = 1;
  context.setLineDash([4, 5]);
  context.beginPath();
  context.moveTo(10, cy);
  context.lineTo(width - 10, cy);
  context.moveTo(cx, 10);
  context.lineTo(cx, height - 10);
  context.stroke();
  context.restore();

  const drawPreviewPair = (pair, color, names) => {
    if (!pair.a || !pair.b) return;
    const a = transformedPointForPreview(pair.a, iw, ih, screenAngle, fitScale, cx, cy);
    const b = transformedPointForPreview(pair.b, iw, ih, screenAngle, fitScale, cx, cy);
    context.save();
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.stroke();
    for (const [point, name] of [[a, names[0]], [b, names[1]]]) {
      context.beginPath();
      context.arc(point.x, point.y, 5, 0, Math.PI * 2);
      context.fill();
      context.font = '800 10px ui-sans-serif, sans-serif';
      context.fillText(name, point.x + 8, point.y - 7);
    }
    context.restore();
  };

  drawPreviewPair(state.picks.scale, cssVar('--scale', '#ff983d'), ['S1', 'S2']);
  if (!elements.samePairToggle.checked) {
    drawPreviewPair(state.picks.rotation, cssVar('--rotation', '#a78bf0'), ['R1', 'R2']);
  }
}

async function loadImageBlob(blob, name, origin = 'local') {
  if (!blob?.type?.startsWith('image/')) throw new Error('That file is not a supported browser image.');
  if (state.sourceObjectUrl) URL.revokeObjectURL(state.sourceObjectUrl);
  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = 'async';
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('The browser could not decode that image.'));
    image.src = objectUrl;
  });
  state.sourceObjectUrl = objectUrl;
  state.sourceImage = image;
  state.sourceBlob = blob;
  state.sourceName = name || 'reference-image';
  state.sourceOrigin = origin;
  elements.emptyState.hidden = true;
  elements.imageSummary.textContent = `${state.sourceName} · ${image.naturalWidth} × ${image.naturalHeight} px`;
  clearPicks();
  // The upload option names the loaded file, so the picker is rebuilt here
  // rather than only when the bootstrap or the document listing changes.
  renderInstallCard();
  requestAnimationFrame(fitImage);
  toast(`Loaded ${state.sourceName}.`, 'good');
}

async function loadLocalFile(file) {
  if (!file) return;
  await loadImageBlob(file, file.name, 'local');
}

async function loadSelectedOnshapeImage() {
  if (!state.selectedItem) throw new Error('Select an Onshape image feature first.');
  if (!state.selectedItem.image?.proxyAvailable) throw new Error('Onshape did not expose a downloadable blob reference. Load the same source image locally.');
  setBusy(true, 'Loading image…');
  try {
    // The same request path as everything else, asking for the bytes instead
    // of JSON. The generous timeout is this route's own: it streams a full
    // resolution image back from Onshape, and the raw fetch this replaced had
    // no timeout at all, so a stalled download hung the button forever.
    let blob;
    try {
      blob = await apiFetch(withContext('/api/image', { itemId: state.selectedItem.id }), {
        responseType: 'blob',
        timeoutMs: 120_000
      });
    } catch (error) {
      throw new Error(describeApiError(error, { upstream: true, fallback: 'Could not load the image from Onshape.' }));
    }
    await loadImageBlob(blob, state.selectedItem.image.reference?.filename || state.selectedItem.featureName, 'onshape');
  } finally {
    setBusy(false);
  }
}

function renderFeatureDetails() {
  $('planeChangeRow').hidden = state.selectedItem?.kind !== 'custom';
  const item = state.selectedItem;
  if (!item) {
    elements.featureDetails.hidden = true;
    elements.unsuppressRow.hidden = !unsuppressCandidate();
    elements.modeBadge.textContent = state.context?.complete ? 'Onshape context · standalone target' : 'Standalone';
    updateControlStates();
    return;
  }

  const placement = item.placement;
  const warnings = item.warnings || [];
  const details = [];
  details.push(`<strong>${escapeHtml(item.label)}</strong>`);
  if (placement) {
    details.push(`<div>Width ${formatNumber(placement.width)} m · angle ${formatNumber(signedDegrees(placement.angle))}°</div>`);
  } else {
    details.push('<div>Current placement unavailable.</div>');
  }
  if (item.image?.widthPx && item.image?.heightPx) {
    details.push(`<div>Serialized image ${item.image.widthPx} × ${item.image.heightPx} px</div>`);
  }
  if (item.suppressed) {
    details.push('<div>Suppressed in Onshape — hidden until it is unsuppressed.</div>');
  }
  if (warnings.length) {
    details.push(`<ul>${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>`);
  }
  elements.featureDetails.innerHTML = details.join('');
  elements.featureDetails.hidden = false;
  elements.unsuppressRow.hidden = !unsuppressCandidate();
  elements.modeBadge.textContent = item.kind === 'custom' ? 'Onshape · calibrated feature' : 'Onshape · native image';
  updateControlStates();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

function renderFeatureSelect(preferredId) {
  const selection = preferredId ?? elements.featureSelect.value;
  elements.featureSelect.innerHTML = '<option value="">Standalone / no Onshape write</option>';
  for (const item of state.items) {
    const option = document.createElement('option');
    option.value = item.id;
    // "read-only" here would read as "nothing here can be written", but
    // Suppress/Unsuppress work on a non-editable native item regardless —
    // only Apply's imageWidth/imageAngle/originX/Y write is what `editable`
    // gates. Naming the geometry specifically is what keeps that suppress
    // button two lines below from looking contradicted by this label.
    option.textContent = `${item.label}${item.suppressed ? ' · suppressed' : ''}${item.editable ? '' : ' · geometry not editable here'}`;
    elements.featureSelect.append(option);
  }
  if (state.items.some((item) => item.id === selection)) elements.featureSelect.value = selection;
  state.selectedItem = state.items.find((item) => item.id === elements.featureSelect.value);
  renderFeatureDetails();
}

function renderBootstrap() {
  const { auth, context, setup } = state.bootstrap;
  state.context = context;
  elements.authorizeLink.hidden = !auth.requiresAuthorization;
  const returnTo = `${location.pathname}${location.search}`;
  const authUrl = new URL('/auth/start', location.origin);
  authUrl.searchParams.set('returnTo', returnTo);
  const sessionCompanyId = new URLSearchParams(location.search).get('sessionCompanyId');
  if (sessionCompanyId) authUrl.searchParams.set('companyId', sessionCompanyId);
  elements.authorizeLink.href = authUrl.pathname + authUrl.search;

  const badge = describeConnection(auth);
  elements.authBadge.textContent = badge.text;
  elements.authBadge.className = badge.className;
  elements.authBadge.title = badge.title;
  elements.planBadge.hidden = !badge.detail;
  elements.planBadge.textContent = badge.detail || '';
  elements.planBadge.title = badge.detailTitle || '';

  // The target card stays visible even with no Onshape credentials at all:
  // its paste-URL box is the only way to give the app a document context
  // before Onshape is configured, and hiding the whole card hid that box too.
  renderSetupCard(setup, auth);
  renderSettingsCard();
  renderInstallCard();

  if (!context.complete) {
    elements.contextMessage.className = 'callout callout-neutral';
    elements.contextMessage.textContent = 'No Part Studio context. The pixel calibrator still works in standalone mode.';
    elements.modeBadge.textContent = 'Standalone';
  } else if (!auth.canRequest) {
    elements.contextMessage.className = 'callout callout-warning';
    elements.contextMessage.textContent = 'Part Studio context detected, but the server cannot reach Onshape yet.';
    elements.modeBadge.textContent = 'Onshape context';
  } else {
    elements.contextMessage.className = 'callout callout-good';
    elements.contextMessage.textContent = 'Part Studio context detected. Refreshing reference-image features…';
    elements.modeBadge.textContent = 'Onshape context';
  }

  updateUrlBoxSummary();
}

// GET /api/bootstrap only ever peeks at the cached connection verdict (it
// must never trigger a live probe of its own), so a freshly started server
// answers every bootstrap with 'checking' until something actually asks
// GET /api/connection. This is that something: called after every bootstrap
// and on demand from the badge, so a healthy, already-configured server does
// not sit on a "Checking Onshape…" badge for the life of the process.
async function refreshConnectionState() {
  if (!state.bootstrap) return;
  const response = await apiFetch('/api/connection');
  state.bootstrap.auth = response.auth;
  // The gate sentences and the policy toggles both depend on the connection
  // this probe just re-checked. Dropping either here is how a control ends up
  // disagreeing with the badge sitting right above it about the same key.
  if (response.gates) state.bootstrap.gates = response.gates;
  if (response.policy) state.bootstrap.policy = response.policy;
  renderBootstrap();
  updateControlStates();
}

function setupHost() {
  try {
    return new URL(state.bootstrap?.capabilities?.onshapeBaseUrl || 'https://cad.onshape.com').host;
  } catch {
    return 'cad.onshape.com';
  }
}

// Single authority for the setup card's three mutually exclusive faces:
// unavailable (remote-admin case), the connected summary, or the form.
// Existing cards are moved intact, preserving their ids, state and listeners.
// This also keeps the initial HTML usable if initialization fails.
let activeFlyout = null;
function setFlyout(name, { focus = true } = {}) {
  const previous = activeFlyout;
  activeFlyout = name;
  $('layoutFlyout').hidden = !name;
  for (const key of ['connection', 'document', 'settings']) {
    $(key + 'Panel').hidden = key !== name;
    $(key + 'RailBtn').setAttribute('aria-expanded', String(key === name));
  }
  if (name === 'settings') elements.settingsDetails.open = true;
  if (focus) {
    if (name) {
      const panel = $(name + 'Panel');
      const control = [...panel.querySelectorAll('input:not([type="hidden"]), select, button, summary, a[href]')]
        .find((node) => !node.disabled && node.getClientRects().length);
      (control || $('closeFlyoutBtn')).focus({ preventScroll: true });
    } else if (previous) $(previous + 'RailBtn').focus({ preventScroll: true });
  }
}

function setStageTab(name) {
  if (name === 'preview' && !state.result) return;
  for (const key of ['source', 'preview']) {
    $(key + 'Panel').hidden = key !== name;
    $(key + 'Tab').setAttribute('aria-selected', String(key === name));
    $(key + 'Tab').tabIndex = key === name ? 0 : -1;
  }
  requestAnimationFrame(() => { drawSource(); drawPreview(); });
}

function initializeLayout() {
  $('connectionPanel').append(elements.setupCard);
  $('documentPanel').append(elements.onshapeCard, $('featureDownloadCard'));
  $('settingsPanel').append(elements.settingsCard);
  $('applyCard').append(elements.duplicateOffer);
  $('rotationCard').open = !elements.samePairToggle.checked;
  for (const name of ['connection', 'document', 'settings']) {
    $(name + 'RailBtn').addEventListener('click', () => setFlyout(activeFlyout === name ? null : name));
  }
  $('closeFlyoutBtn').addEventListener('click', () => setFlyout(null));
  document.addEventListener('pointerdown', (event) => {
    if (activeFlyout && !$('layoutFlyout').contains(event.target) && !$('layoutRail').contains(event.target) && event.target !== elements.authBadge) setFlyout(null);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && activeFlyout) { event.preventDefault(); setFlyout(null); }
  });
  for (const name of ['source', 'preview']) {
    $(name + 'Tab').addEventListener('click', () => setStageTab(name));
    $(name + 'Tab').addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 'source' : event.key === 'End' ? 'preview' : name === 'source' ? 'preview' : 'source';
      if (next === 'preview' && !state.result) return;
      setStageTab(next);
      $(next + 'Tab').focus();
    });
  }
}

function renderSetupCard(setup, auth) {
  if (!setup) return;
  const unavailable = setup.available === false;
  elements.setupUnavailable.hidden = !unavailable;
  if (unavailable) {
    elements.setupUnavailable.textContent = SETUP_UNAVAILABLE_MESSAGES[setup.reason] || SETUP_UNAVAILABLE_MESSAGES.NOT_LOOPBACK;
  }
  elements.setupForm.hidden = unavailable || auth.connection?.state === 'connected';
  elements.setupConnected.hidden = unavailable || auth.connection?.state !== 'connected';
  $('setupIntro').hidden = unavailable || auth.connection?.state === 'connected';
  $('setupSkipBtn').hidden = auth.connection?.state === 'connected';
  $('setupSkipHint').hidden = auth.connection?.state === 'connected';
  if (auth.connection?.state === 'connected') {
    elements.setupConnectedName.textContent = `${auth.connection.accountName || 'Onshape'} on ${auth.connection.host || setupHost()}`;
  }
  elements.setupConfigPath.textContent = setup.configPath
    ? `Configuration file: ${setup.configPath}`
    : '';
  elements.setupConfigPath.hidden = unavailable;
}

// Opening the form always starts from a clean slate: stale status/error text
// and a stale Save gate from a previous test-then-abandon are wrong the
// instant the form reappears, not just once the user types again.
function resetSetupFormState() {
  setSetupStatus('');
  setSetupError('');
  setSetupKeyHint([]);
  state.setup.lastResult = undefined;
  state.setup.testedSignature = undefined;
  updateSetupSaveGate();
}

function openSetup({ focus = true } = {}) {
  setFlyout('connection', { focus: false });
  // The badge and "Change API key" are the only callers, and neither should
  // walk a remote/proxied user into a form the server has already said it
  // will refuse (see setup.available in the bootstrap response).
  if (state.bootstrap?.setup?.available === false) {
    elements.setupCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  // Cancel only makes sense when there is a connected state to return to —
  // the first-run form has nowhere to go back to.
  elements.setupCancelBtn.hidden = state.bootstrap?.auth?.connection?.state !== 'connected';
  elements.setupForm.hidden = false;
  $('setupIntro').hidden = false;
  elements.setupConnected.hidden = true;
  resetSetupFormState();
  elements.setupCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (focus) elements.setupAccessKey.focus({ preventScroll: true });
}

function closeSetup() {
  elements.setupAccessKey.value = '';
  elements.setupSecretKey.value = '';
  elements.setupSecretKey.type = 'password';
  elements.setupSecretRevealBtn.textContent = 'Show';
  elements.setupSecretRevealBtn.setAttribute('aria-pressed', 'false');
  resetSetupFormState();
  renderSetupCard(state.bootstrap?.setup, state.bootstrap?.auth || {});
}

function setupInputSignature() {
  return JSON.stringify([elements.setupAccessKey.value, elements.setupSecretKey.value, elements.setupBaseUrl.value]);
}

const SAVE_ANYWAY_REASONS = ['UNREACHABLE', 'TIMEOUT', 'ONSHAPE_RATE_LIMITED', 'ONSHAPE_ERROR'];

function updateSetupSaveGate() {
  const currentSignature = setupInputSignature();
  const result = state.setup.lastResult;
  let disabled = true;
  let label = 'Save and continue';
  let reason = 'Press Test connection first. Nothing is written until Onshape confirms the key works.';

  if (state.setup.busy) {
    reason = 'Working…';
  } else if (!result || state.setup.testedSignature !== currentSignature) {
    if (result && state.setup.testedSignature !== currentSignature) {
      reason = 'You changed a field since the last test. Press Test connection again.';
    }
  } else if (result.ok) {
    disabled = false;
    reason = '';
  } else if (SAVE_ANYWAY_REASONS.includes(result.reason)) {
    disabled = false;
    label = 'Save anyway';
    reason = 'Onshape could not be reached, so the key is unverified. Saving it is fine — this page will check again once you are back online.';
  } else {
    reason = 'Onshape rejected this key, so there is nothing worth saving yet.';
  }

  elements.setupSaveBtn.disabled = disabled;
  elements.setupSaveBtn.textContent = label;
  setReason(elements.setupSaveReason, reason);
}

function setSettingsStatus(text, kind = 'callout-neutral') {
  elements.settingsStatus.hidden = !text;
  elements.settingsStatus.textContent = text || '';
  elements.settingsStatus.className = `callout ${kind}`;
}

function setSettingsError(text) {
  elements.settingsError.hidden = !text;
  elements.settingsError.textContent = text || '';
}

// The capability record's own `reason` names its scope the way Onshape's key
// form does ("Key lacks write scope"), which is right for a disabled-button
// tooltip or a 403 body and jargon for a card a non-developer reads. This
// only rewrites the two 'scope' verdicts, which are the only ones that carry
// that jargon; the evidence and unknown verdicts already read in plain
// language and are shown as the record wrote them. The scope names below are
// the only two any FEATURES entry in src/capabilities.mjs actually uses.
const SCOPE_CARD_TEXT = Object.freeze({
  write: {
    allowed: 'Your key is allowed to write to Onshape.',
    denied: 'Your key cannot write to Onshape — create a new key with Write documents ticked.'
  },
  delete: {
    allowed: 'Your key is allowed to delete files in Onshape.',
    denied: 'Your key cannot delete in Onshape. This app only uses that to clean up scratch tabs it creates, so it skips that step instead.'
  }
});

function capabilityCardText(record, { feature, plan } = {}) {
  if (!record) return undefined;
  if (record.source !== 'scope') return record.reason;
  const copy = SCOPE_CARD_TEXT[record.scope];
  if (!copy) return record.reason;
  if (!record.allowed) return copy.denied;
  const freePlanNote = feature === 'createDocument' && plan?.isFree
    ? ' Free plan: new documents have to be public.'
    : '';
  return copy.allowed + freePlanNote;
}

// Write the switches and the capability lines from the two server-owned
// sources: the policy from /api/settings (or bootstrap), and the capability
// verdicts from the auth summary. Never from what the user last clicked.
function renderSettingsCard() {
  const policy = state.bootstrap?.policy || {};
  const capabilities = state.bootstrap?.auth?.capabilities;
  const features = capabilities?.features;
  const connectionState = state.bootstrap?.auth?.connection?.state;

  for (const row of POLICY_ROWS) {
    const input = elements[row.input];
    if (policy[row.key] !== undefined) input.checked = policy[row.key] !== false;
    const record = features?.[row.feature];
    elements[row.capacity].textContent = record
      ? capabilityCardText(record, { feature: row.feature, plan: capabilities?.plan })
      : capabilityPlaceholder(connectionState);
  }
  if (policy.confirmBeforeWrite !== undefined) {
    elements.settingsConfirmBeforeWrite.checked = policy.confirmBeforeWrite !== false;
  }
  if (policy.scratchFolderId !== undefined && document.activeElement !== elements.settingsScratchFolderId) {
    elements.settingsScratchFolderId.value = policy.scratchFolderId || '';
  }

  const cleanup = features?.deleteCleanup;
  elements.capDeleteCleanup.textContent = cleanup
    ? capabilityCardText(cleanup, { feature: 'deleteCleanup' })
    : capabilityPlaceholder(connectionState);

  // A genuine SETUP_UNAVAILABLE (the loopback/remote-admin case) is the only
  // thing this callout is allowed to describe. A load that failed for some
  // other reason (a timeout, a 500, the server mid-restart) has no
  // unavailableReason, and guessing NOT_LOOPBACK for it told a user sitting at
  // the machine to edit a configuration file over a problem that was never
  // theirs to fix that way; the real message is already in settingsError.
  const unavailable = state.settings.available === false && Boolean(state.settings.unavailableReason);
  elements.settingsUnavailable.hidden = !unavailable;
  if (unavailable) {
    elements.settingsUnavailable.textContent =
      SETUP_UNAVAILABLE_MESSAGES[state.settings.unavailableReason] || SETUP_UNAVAILABLE_MESSAGES.NOT_LOOPBACK;
  }
  elements.settingsPath.textContent = state.settings.path ? `Settings file: ${state.settings.path}` : '';
}

// Until a probe has answered there are no capability records at all, and
// "this key cannot do that" would be a guess. Say what is actually true.
function capabilityPlaceholder(connectionState) {
  if (connectionState === 'connected') return 'This key’s permissions are not known yet.';
  if (connectionState === 'unconfigured') return 'No Onshape key is set up yet.';
  return 'Checking what this key can do…';
}

// The settings routes carry the setup wizard's loopback guard, so a remote or
// proxied browser gets a 403 here exactly as it does there. That is a fact to
// display, not an error to toast.
async function loadSettings() {
  try {
    const response = await apiFetch('/api/settings');
    state.settings.available = true;
    state.settings.unavailableReason = undefined;
    state.settings.path = response.settingsPath || '';
    state.settings.warnings = response.warnings || [];
    state.settings.loaded = true;
    if (state.bootstrap) {
      state.bootstrap.policy = response.settings;
      if (response.gates) state.bootstrap.gates = response.gates;
    }
    // The error line is owned by load and save, not by the renderer: the
    // renderer runs on every connection refresh and would either re-post a
    // warning the operator has already fixed or never clear one they have.
    setSettingsError(state.settings.warnings.join(' '));
  } catch (error) {
    if (error.payload?.code === 'SETUP_UNAVAILABLE') {
      state.settings.available = false;
      state.settings.unavailableReason = error.payload.reason;
    } else {
      state.settings.available = false;
      state.settings.unavailableReason = undefined;
      setSettingsError(error.message);
    }
  }
  renderSettingsCard();
  updateControlStates();
}

function readSettingsForm() {
  const settings = { confirmBeforeWrite: elements.settingsConfirmBeforeWrite.checked };
  for (const row of POLICY_ROWS) settings[row.key] = elements[row.input].checked;
  const folder = elements.settingsScratchFolderId.value.trim();
  settings.scratchFolderId = folder ? folder : null;
  return settings;
}

async function handleSettingsSave() {
  if (state.settings.busy) return;
  state.settings.busy = true;
  setSettingsError('');
  setSettingsStatus('Saving…');
  updateControlStates();
  try {
    const response = await apiFetch('/api/settings', {
      method: 'POST',
      body: JSON.stringify({ settings: readSettingsForm() }),
      timeoutMs: 12_000
    });
    if (state.bootstrap) {
      state.bootstrap.policy = response.settings;
      // A switch flipped here changes what a write gate answers right away
      // (see featureGateReasons in src/capability-gate.mjs); without this the
      // page would keep showing the pre-save gate text — including on a
      // control the operator just switched off — until something else
      // happened to re-fetch /api/connection.
      if (response.gates) state.bootstrap.gates = response.gates;
    }
    state.settings.path = response.settingsPath || state.settings.path;
    state.settings.warnings = [];
    setSettingsStatus('Saved.', 'callout-good');
    renderSettingsCard();
  } catch (error) {
    setSettingsStatus('');
    setSettingsError(
      error.payload?.code === 'SETUP_UNAVAILABLE'
        ? SETUP_UNAVAILABLE_MESSAGES[error.payload.reason] || SETUP_UNAVAILABLE_MESSAGES.NOT_LOOPBACK
        : error.message
    );
  } finally {
    state.settings.busy = false;
    updateControlStates();
  }
}

function setSetupStatus(text, kind = 'callout-neutral') {
  elements.setupStatus.hidden = !text;
  elements.setupStatus.textContent = text || '';
  elements.setupStatus.className = `callout ${kind}`;
}

function setSetupError(text) {
  elements.setupError.hidden = !text;
  elements.setupError.textContent = text || '';
}

function setSetupKeyHint(notices) {
  const text = (notices || []).join(' ');
  elements.setupKeyHint.hidden = !text;
  elements.setupKeyHint.textContent = text;
}

// A failed fetch to our own /api/setup/* endpoint is not necessarily a
// verdict on the key: it could be a genuine transport failure (this browser
// could not reach this server at all — error.status is unset), or it could
// be this server answering with its own 4xx/5xx (bad format, rate limit,
// CSRF, a write/reload failure). Only the former is evidence the key itself
// is unreachable, so only the former may produce a lastResult that
// SAVE_ANYWAY_REASONS will treat as save-anyway-worthy. Everything else
// leaves lastResult unset, which keeps Save disabled with the ordinary
// "press Test connection" reason while the real problem shows in setupError.
function classifySetupTransportError(error) {
  if (error.name === 'TimeoutError') return { ok: false, reason: 'TIMEOUT' };
  if (error.status === undefined) return { ok: false, reason: 'UNREACHABLE' };
  return undefined;
}

async function handleSetupTest() {
  if (state.setup.busy) return;
  const validation = validateApiKeyInput({
    accessKey: elements.setupAccessKey.value,
    secretKey: elements.setupSecretKey.value,
    baseUrl: elements.setupBaseUrl.value
  });
  setSetupError('');
  setSetupKeyHint(validation.notices);
  if (!validation.ok) {
    setSetupError(validation.message);
    return;
  }

  const host = validation.cleaned.baseUrl ? new URL(validation.cleaned.baseUrl).host : setupHost();
  state.setup.busy = true;
  state.setup.lastResult = undefined;
  const oldText = elements.setupTestBtn.textContent;
  elements.setupTestBtn.disabled = true;
  elements.setupTestBtn.textContent = 'Testing…';
  setSetupStatus(`Asking Onshape who this key belongs to…`);
  const stillWaiting = setTimeout(() => setSetupStatus(`Still waiting on ${host}…`), 3_000);
  try {
    const result = await apiFetch('/api/setup/test', {
      method: 'POST',
      body: JSON.stringify({
        accessKey: validation.cleaned.accessKey,
        secretKey: validation.cleaned.secretKey,
        baseUrl: validation.cleaned.baseUrl
      }),
      timeoutMs: 12_000
    });
    state.setup.lastResult = result;
    state.setup.testedSignature = setupInputSignature();
    if (result.ok) {
      setSetupStatus(`Connected as ${result.accountName || 'this account'} on ${result.host || host}. Nothing is saved yet — press Save and continue.`, 'callout-good');
    } else {
      setSetupStatus('');
      setSetupError(setupFailureMessage(result, {
        host: result.host || host,
        timeoutSeconds: result.timeoutSeconds,
        configPath: state.bootstrap?.setup?.configPath
      }));
    }
  } catch (error) {
    state.setup.lastResult = classifySetupTransportError(error);
    state.setup.testedSignature = setupInputSignature();
    setSetupStatus('');
    setSetupError(describeApiError(error));
  } finally {
    clearTimeout(stillWaiting);
    state.setup.busy = false;
    elements.setupTestBtn.disabled = false;
    elements.setupTestBtn.textContent = oldText;
    updateSetupSaveGate();
  }
}

async function handleSetupSave() {
  const validation = validateApiKeyInput({
    accessKey: elements.setupAccessKey.value,
    secretKey: elements.setupSecretKey.value,
    baseUrl: elements.setupBaseUrl.value
  });
  if (!validation.ok) {
    setSetupError(validation.message);
    return;
  }
  const confirmUntested = Boolean(state.setup.lastResult && !state.setup.lastResult.ok);
  const needsConfirm = state.bootstrap?.auth?.mode && state.bootstrap.auth.mode !== 'none';

  state.setup.busy = true;
  const oldText = elements.setupSaveBtn.textContent;
  elements.setupSaveBtn.disabled = true;
  elements.setupSaveBtn.textContent = 'Saving…';
  try {
    const response = await apiFetch('/api/setup/save', {
      method: 'POST',
      body: JSON.stringify({
        accessKey: validation.cleaned.accessKey,
        secretKey: validation.cleaned.secretKey,
        baseUrl: validation.cleaned.baseUrl,
        confirm: needsConfirm ? true : undefined,
        confirmUntested: confirmUntested ? true : undefined
      }),
      timeoutMs: 12_000
    });
    if (!response.ok) {
      setSetupError(setupFailureMessage(response, { host: response.host || setupHost(), configPath: state.bootstrap?.setup?.configPath }));
      return;
    }
    state.bootstrap.auth = response.auth;
    // A saved key clears every observed 403 server-side (see
    // clearAllCapabilityEvidence in src/setup-routes.mjs), which can change
    // every gate sentence at once. Picking up response.gates here is what
    // keeps a just-enabled write control from staying disabled on the old key's
    // refusal text until the next full connection probe.
    if (response.gates) state.bootstrap.gates = response.gates;
    elements.setupForm.hidden = true;
    elements.setupAccessKey.value = '';
    elements.setupSecretKey.value = '';
    elements.setupSecretKey.type = 'password';
    elements.setupSecretRevealBtn.textContent = 'Show';
    elements.setupSecretRevealBtn.setAttribute('aria-pressed', 'false');
    renderBootstrap();
    updateControlStates();
    // A confirmUntested save can succeed at HTTP level while the live probe
    // behind it still failed (connection.state stays 'checking', not
    // 'connected') — that save is real but unverified, and must not be
    // announced as a working connection to an account nobody confirmed.
    const connectionState = response.auth.connection?.state;
    const accountName = response.auth.connection?.accountName;
    const savedLabel = connectionState === 'connected'
      ? `Connected as ${accountName || 'this account'}.`
      : 'Setup saved, but not verified — Onshape could not be reached during Save.';
    if (state.context?.complete) {
      setFlyout('document');
      toast(`${savedLabel} Loading this Part Studio…`, 'good');
      refreshFeatures({ quiet: true }).catch(() => {});
    } else {
      toast(`${savedLabel} Now paste your Onshape Part Studio URL.`, 'good');
      elements.urlBoxDetails.open = true;
      setFlyout('document');
      elements.onshapeUrlInput.focus();
    }
  } catch (error) {
    setSetupError(describeApiError(error));
  } finally {
    state.setup.busy = false;
    elements.setupSaveBtn.textContent = oldText;
    updateSetupSaveGate();
  }
}

let featureRefreshGeneration = 0;
async function refreshFeatures({ quiet = false } = {}) {
  const generation = ++featureRefreshGeneration;
  const contextKey = JSON.stringify(state.context);
  const current = () => generation === featureRefreshGeneration && contextKey === JSON.stringify(state.context);
  if (!state.context?.complete) {
    state.items = [];
    renderFeatureSelect('');
    if (!quiet) toast('No complete Onshape Part Studio context is available.');
    return;
  }
  if (!state.bootstrap?.auth?.canRequest) {
    if (!quiet) toast('Set up or authorize Onshape first.', 'error');
    return;
  }

  const previous = elements.featureSelect.value;
  setBusy(true, 'Refreshing…');
  try {
    const data = await apiFetch(withContext('/api/context'));
    if (!current()) return;
    state.items = data.items || [];
    $('documentDot').dataset.state = 'connected';
    if (activeFlyout === 'document' || activeFlyout === 'connection') setFlyout(null);
    renderFeatureSelect(previous);
    elements.contextMessage.className = state.items.length ? 'callout callout-good' : 'callout callout-neutral';
    elements.contextMessage.textContent = state.items.length
      ? `Found ${state.items.length} reference image${state.items.length === 1 ? '' : 's'} in this Part Studio.`
      : 'No image features found. Add the included Calibrated Reference Image feature, then refresh.';
    if (!quiet) toast(`Found ${state.items.length} reference image${state.items.length === 1 ? '' : 's'}.`, 'good');
    renderSuppressionOffer();
    loadInstallStatus().catch(() => {});
  } catch (error) {
    if (!current()) return;
    if (error.status === 401) {
      // A live probe will replace this on the next badge click or reload;
      // this is just enough to stop pretending the last-known state still
      // holds after Onshape itself has just said otherwise.
      state.bootstrap.auth.canRequest = false;
      state.bootstrap.auth.requiresAuthorization = state.bootstrap.auth.mode === 'oauth';
      if (state.bootstrap.auth.connection) state.bootstrap.auth.connection.state = 'rejected';
      renderBootstrap();
    }
    const message = describeApiError(error, { upstream: true });
    elements.contextMessage.className = 'callout callout-warning';
    elements.contextMessage.textContent = message;
    if (!quiet) toast(message, 'error');
  } finally {
    if (current()) setBusy(false);
  }
}

function preservedExtras() {
  // The Onshape action URL may carry sessionCompanyId, which authorizeLink needs.
  const companyId = new URLSearchParams(location.search).get('sessionCompanyId');
  return companyId ? { sessionCompanyId: companyId } : {};
}

function contextsEqual(a, b) {
  if (!a?.complete || !b?.complete) return false;
  return a.documentId === b.documentId &&
    a.workspaceOrVersion === b.workspaceOrVersion &&
    a.workspaceOrVersionId === b.workspaceOrVersionId &&
    a.elementId === b.elementId;
}

async function adoptContext(context) {
  const search = contextToSearch(context, preservedExtras());
  setBusy(true, 'Loading document…');
  try {
    // Fetch before committing the URL so a failed load never leaves the address
    // bar describing a context the app did not adopt.
    const bootstrap = await apiFetch(`/api/bootstrap?${search}`);
    history.replaceState(null, '', `${location.pathname}?${search}`);
    state.bootstrap = bootstrap;
    state.csrfToken = bootstrap.csrfToken;
    state.items = [];
    state.selectedItem = undefined;
    markResultStale(); // a preview solved against the old feature must not stay appliable
    renderBootstrap();
    loadSettings().catch(() => {});
    refreshConnectionState().catch(() => {});
    sendOnshapeMessage('applicationInit');
    renderFeatureSelect('');
    if (state.context?.complete && bootstrap.auth.canRequest) await refreshFeatures({ quiet: true });
    else loadInstallStatus().catch(() => {});
  } finally {
    setBusy(false);
    updateControlStates();
  }
}

function workspaceKindText(workspaceOrVersion) {
  if (workspaceOrVersion === 'w') return 'Workspace (writable)';
  if (workspaceOrVersion === 'v') return 'Version (read-only)';
  if (workspaceOrVersion === 'm') return 'Microversion (read-only)';
  return '—';
}

function renderUrlParsed(parsed) {
  const context = parsed.context;
  elements.urlParsedDocument.textContent = context.documentId;
  elements.urlParsedWorkspace.textContent = context.workspaceOrVersionId;
  elements.urlParsedElement.textContent = context.elementId;
  elements.urlParsedWorkspaceKind.textContent = workspaceKindText(context.workspaceOrVersion);
  const onshapeBaseUrl = state.bootstrap?.capabilities?.onshapeBaseUrl || 'https://cad.onshape.com';
  try {
    elements.urlOpenInOnshape.href = new URL(
      `/documents/${context.documentId}/${context.workspaceOrVersion}/${context.workspaceOrVersionId}/e/${context.elementId}`,
      onshapeBaseUrl
    ).href;
  } catch {
    elements.urlOpenInOnshape.href = '#';
  }
  elements.urlParsed.hidden = false;
}

function renderUrlWarning(parsed) {
  if (!parsed?.ok || !parsed.warnings.length) {
    elements.urlWarning.hidden = true;
    elements.urlWarning.textContent = '';
    return;
  }
  elements.urlWarning.textContent = parsed.warnings.map((warning) => warning.message).join(' ');
  elements.urlWarning.hidden = false;
}

function showUrlError(message) {
  elements.urlError.textContent = message;
  elements.urlError.hidden = false;
}

function hideUrlError() {
  elements.urlError.hidden = true;
  elements.urlError.textContent = '';
}

function handleLoadUrlClick() {
  const parsed = parseOnshapeUrl(elements.onshapeUrlInput.value, {
    expectedOrigin: state.bootstrap?.capabilities?.onshapeBaseUrl
  });
  if (!parsed.ok) {
    showUrlError(parsed.error.message);
    elements.onshapeUrlInput.focus();
    return;
  }
  renderUrlParsed(parsed);
  renderUrlWarning(parsed);
  hideUrlError();

  if (contextsEqual(state.context, parsed.context)) {
    elements.urlBoxDetails.open = false;
    toast('That document is already loaded.');
    return;
  }
  adoptContext(parsed.context).catch((error) => toast(error.message, 'error'));
}

function updateUrlBoxSummary() {
  const complete = Boolean(state.context?.complete);
  elements.urlBoxDetails.open = !complete;
  elements.urlBoxSummary.textContent = complete
    ? 'Onshape document loaded · change'
    : 'Paste your Onshape Part Studio URL';
}

function renderResult(result, statusText = 'Ready') {
  state.result = result;
  // The offer belongs to one applied write. Any new solve, applied or not,
  // makes the previous one stale; applyCalibration sets the new list after
  // this returns.
  state.suppression.offers = [];
  state.suppression.targetId = undefined;
  state.resultSignature = currentInputSignature();
  const placement = result.placement;
  const diagnostics = result.diagnostics;
  const unit = elements.distanceUnit.value;
  const factor = LENGTH_TO_METERS[unit] || 1;
  const widthInUnit = placement.width / factor;
  const originXInUnit = placement.originX / factor;
  const originYInUnit = placement.originY / factor;
  const angleDegrees = signedDegrees(placement.angle);

  elements.resultsCard.hidden = false;
  elements.resultsCard.open = true;
  setStageTab('preview');
  elements.resultStatus.textContent = statusText;
  elements.resultStatus.className = statusText === 'Applied' ? 'badge badge-good' : 'badge';
  elements.resultWidth.textContent = `${formatNumber(widthInUnit)} ${unit}`;
  elements.resultAngle.textContent = `${formatNumber(angleDegrees)}°`;
  elements.resultScale.textContent = `${formatNumber(diagnostics.scaleFactor)}×`;
  const residualUnit = Math.abs(diagnostics.anchorResidual) < 1e-6 ? 'µm' : 'mm';
  const residualValue = residualUnit === 'µm' ? diagnostics.anchorResidual * 1e6 : diagnostics.anchorResidual * 1e3;
  elements.resultResidual.textContent = `${formatNumber(residualValue)} ${residualUnit}`;
  elements.resultOriginX.textContent = `${formatNumber(originXInUnit)} ${unit}`;
  elements.resultOriginY.textContent = `${formatNumber(originYInUnit)} ${unit}`;
  elements.resultWidthExpr.textContent = `${formatNumber(placement.width, 12)} m`;
  elements.resultAngleExpr.textContent = `${formatNumber(angleDegrees, 12)} deg`;
  elements.previewEmpty.hidden = true;
  drawPreview();
  // renderSuppressionOffer() calls updateControlStates() itself; going
  // through it keeps the offer element and the buttons in one step.
  renderSuppressionOffer();
}

// ---------------------------------------------------------------------------
// One-click install and image upload
//
// Why each of these buttons is disabled lives in write-gates.mjs, with the
// rest of the write gates. The sentences it returns for a capability or a
// policy refusal are the server's own, delivered in bootstrap.gates by the
// same describeFeatureGate() the routes throw from, so a disabled button and
// a 403 can never say different things.
// ---------------------------------------------------------------------------

function setInstallStatus(text, kind = 'callout-neutral') {
  elements.installStatus.hidden = !text;
  elements.installStatus.textContent = text || '';
  elements.installStatus.className = `callout ${kind}`;
}

function setInstallError(text) {
  elements.installError.hidden = !text;
  elements.installError.textContent = text || '';
}

function installStateText() {
  if (!state.context?.complete) return 'Paste a Part Studio URL above to see what this document already has.';
  // loadInstallStatus() deliberately never requests without this (see its own
  // guard), so state.install.data stays undefined here forever — "Checking…"
  // would be a promise nothing is keeping.
  if (!state.bootstrap?.auth?.canRequest) return 'Set up Onshape first — then this panel can say what the document already has.';
  if (state.install.available === false) return state.install.error || 'This document could not be read yet.';
  if (!state.install.data) return 'Checking this document…';
  const install = state.install.data;
  if (install.state === 'instance-present') {
    const count = install.instances.length;
    return `This document already has ${count} Calibrated Reference Image feature${count === 1 ? '' : 's'}.`;
  }
  if (install.state === 'studio-present') {
    return 'The Reference Align Feature Studio is here, but no feature has been added to this Part Studio yet.';
  }
  return 'This document does not have the Calibrated Reference Image feature yet.';
}

// Rebuilt from the server's listing every time, never from what was here
// before: an image tab that has been deleted must stop being offered.
function renderInstallCard() {
  elements.installSection.hidden = !state.context?.complete;
  elements.installState.textContent = installStateText();

  const previous = elements.installImageSelect.value;
  const images = state.install.data?.imageElements || [];
  elements.installImageSelect.innerHTML = '<option value="">Choose an image…</option>';
  const uploadOption = document.createElement('option');
  uploadOption.value = UPLOAD_OPTION;
  uploadOption.textContent = state.sourceName
    ? `Upload “${state.sourceName}” from this browser`
    : 'Upload the image loaded here';
  elements.installImageSelect.append(uploadOption);
  for (const image of images) {
    if (!image.bindable) continue;
    const option = document.createElement('option');
    option.value = image.id;
    option.textContent = `${image.name} · ${image.dataType}`;
    elements.installImageSelect.append(option);
  }

  const values = [...elements.installImageSelect.options].map((option) => option.value);
  if (values.includes(previous) && previous) {
    elements.installImageSelect.value = previous;
  } else if (state.sourceBlob) {
    elements.installImageSelect.value = UPLOAD_OPTION;
  } else if (images.some((image) => image.bindable)) {
    elements.installImageSelect.value = images.find((image) => image.bindable).id;
  }
  renderPlaneControls();
}

function renderPlaneControls() {
  for (const id of ['installPlaneSelect', 'replaneSelect']) {
    const select = $(id);
    const previous = select.value;
    select.replaceChildren();
    for (const plane of state.install.planes) {
      const option = document.createElement('option');
      option.value = plane.id;
      option.textContent = plane.label + (plane.unavailableReason ? ` — ${plane.unavailableReason}` : '');
      select.append(option);
    }
    const preferred = id === 'replaneSelect' ? state.install.selectedPlane?.id : state.install.planes.find((plane) => plane.kind === 'default' && plane.label === 'Top')?.id;
    if (state.install.planes.some((plane) => plane.id === previous)) select.value = previous;
    else if (preferred) select.value = preferred;
  }
  $('selectedPlaneLabel').textContent = `Plane: ${state.install.selectedPlane?.label || (state.install.planesLoading ? 'checking…' : 'not identified')}`;
  $('planeChangeRow').hidden = state.selectedItem?.kind !== 'custom';
}

function planeContextKey() {
  return JSON.stringify([state.context, state.selectedItem?.id]);
}

// The status route reads the document; it is not a write and has no gate of
// its own beyond whatever Onshape allows this key to read.
async function loadInstallStatus({ quiet = true } = {}) {
  const generation = ++state.install.statusGeneration;
  const contextKey = planeContextKey();
  const previousPlane = $('installPlaneSelect').value;
  if (state.install.planeContextKey === contextKey && previousPlane) state.install.preferredPlane = previousPlane;
  else if (state.install.planeContextKey !== contextKey) state.install.preferredPlane = undefined;
  state.install.planeContextKey = contextKey;
  state.install.planes = [];
  state.install.selectedPlane = null;
  state.install.planeError = '';
  if (!state.context?.complete || !state.bootstrap?.auth?.canRequest) {
    state.install.planesLoading = false;
    state.install.data = undefined;
    state.install.available = undefined;
    renderInstallCard();
    updateControlStates();
    return;
  }
  state.install.planesLoading = true;
  renderPlaneControls();
  updateControlStates();
  try {
    const response = await apiFetch(withContext('/api/install/status', { itemId: state.selectedItem?.kind === 'custom' ? state.selectedItem.id : undefined }));
    if (generation !== state.install.statusGeneration || contextKey !== planeContextKey()) return;
    state.install.available = response.available;
    state.install.data = response.install || undefined;
    state.install.maxImageUploadBytes = response.maxImageUploadBytes;
    state.install.error = '';
    state.install.planes = response.planes || [];
    state.install.selectedPlane = response.selectedPlane || null;
  } catch (error) {
    if (generation !== state.install.statusGeneration || contextKey !== planeContextKey()) return;
    state.install.available = false;
    state.install.data = undefined;
    // GET /api/install/status proxies Onshape, so its 401, 403 and 404 carry
    // Onshape's meaning and describeApiError names a cause and a next step
    // for each. Showing the raw upstream text here ("Onshape API request
    // failed with 401 Unauthorized.") would be the one place in the app that
    // does not.
    state.install.error = describeApiError(error, {
      upstream: true,
      fallback: 'This document could not be read yet.'
    });
    state.install.planeError = state.install.error;
    if (!quiet) toast(state.install.error, 'error');
  }
  state.install.planesLoading = false;
  renderInstallCard();
  if (state.install.planes.some((plane) => plane.id === state.install.preferredPlane && !plane.unavailableReason)) $('installPlaneSelect').value = state.install.preferredPlane;
  updateControlStates();
}

// The policy switch is enforced by the server too; this is the asking half of
// it. A cancelled confirm is a normal outcome, not an error.
function confirmWrite(question) {
  if (state.bootstrap?.policy?.confirmBeforeWrite === false) return true;
  return window.confirm(question);
}

async function uploadLoadedImage() {
  if (!state.sourceBlob) throw new Error('Load a local image first.');
  const form = new FormData();
  form.append('file', state.sourceBlob, state.sourceName || 'reference-image');
  form.append('confirm', 'true');
  // No Content-Type header: fetch has to choose the multipart boundary, and
  // apiFetch only sets JSON when a body needs it.
  return apiFetch(withContext('/api/upload-image'), { method: 'POST', body: form, timeoutMs: 120_000 });
}

// The install and rebind buttons share one fallback sentence. Both proxy
// Onshape, so both read the statuses upstream gives meaning to.
function installFailureText(error) {
  return describeApiError(error, { upstream: true, fallback: 'The install did not complete.' });
}

async function handleInstallClick() {
  if (state.install.busy) return;
  const selection = elements.installImageSelect.value;
  const uploading = selection === UPLOAD_OPTION;
  const context = { ...state.context };
  const contextKey = JSON.stringify(context);
  const planeId = $('installPlaneSelect').value || undefined;
  const sourceName = state.sourceName || 'reference-image';
  if (!confirmWrite(uploading
    ? 'Upload this image to Onshape and add a Calibrated Reference Image feature to this Part Studio?'
    : 'Add a Calibrated Reference Image feature to this Part Studio?')) {
    return;
  }

  state.install.busy = true;
  setInstallError('');
  setInstallStatus(uploading ? 'Uploading the image…' : 'Installing…');
  updateControlStates();
  // Set once the upload half actually succeeds, so a failure in the install
  // half that follows can say the upload already landed instead of going
  // silent about it — the tab is sitting in the document either way.
  let uploadedName;
  try {
    let imageElementId = selection;
    if (uploading) {
      const uploaded = await uploadLoadedImage();
      imageElementId = uploaded.elementId;
      uploadedName = sourceName;
      setInstallStatus('Installing the feature…');
    }
    const result = await apiFetch('/api/install', {
      method: 'POST',
      body: JSON.stringify({ context, imageElementId, planeId, confirm: true }),
      timeoutMs: 60_000
    });
    if (contextKey !== JSON.stringify(state.context)) return;
    setInstallStatus(
      result.alreadyInstalled
        ? 'This document already had the feature. Nothing was changed.'
        : 'Installed. Onshape reports the feature as OK.',
      'callout-good'
    );
    await refreshFeatures({ quiet: true });
    if (contextKey !== JSON.stringify(state.context)) return;
    if (result.itemId && state.items.some((item) => item.id === result.itemId)) {
      renderFeatureSelect(result.itemId);
    }
    await loadInstallStatus();
    toast(result.alreadyInstalled ? 'Already installed.' : 'Feature installed.', 'good');
  } catch (error) {
    if (contextKey !== JSON.stringify(state.context)) return;
    setInstallStatus('');
    setInstallError(uploadedName
      ? `The image was uploaded (tab “${uploadedName}”). The feature was not added: ${installFailureText(error)}`
      : installFailureText(error));
    // The upload half of this click can succeed even though the install half
    // that follows it fails or times out. Re-reading the document is what
    // gets the newly uploaded tab into the picker and out of "Upload …"
    // before the next press, instead of uploading a second copy of it.
    await loadInstallStatus().catch(() => {});
  } finally {
    state.install.busy = false;
    updateControlStates();
  }
}

async function handleUploadAndUseClick() {
  if (state.install.busy) return;
  // The button is disabled without these, but a click can still race a refresh
  // that cleared the selection, and a TypeError here would surface as nonsense.
  if (!state.selectedItem || !state.sourceBlob) return;
  const context = { ...state.context };
  const itemId = state.selectedItem.id;
  const contextKey = planeContextKey();
  if (!confirmWrite('Upload this image to Onshape and point the selected feature at it?')) return;

  state.install.busy = true;
  setInstallError('');
  setInstallStatus('Uploading the image…');
  updateControlStates();
  try {
    const uploaded = await uploadLoadedImage();
    setInstallStatus('Pointing the feature at the new image…');
    const result = await apiFetch('/api/rebind', {
      method: 'POST',
      body: JSON.stringify({
        context,
        itemId,
        elementId: uploaded.elementId,
        microversionId: uploaded.microversionId,
        confirm: true
      }),
      timeoutMs: 60_000
    });
    if (contextKey !== planeContextKey()) return;
    setInstallStatus(`Done. Onshape reports the feature as ${result.featureStatus}. Backup: ${result.backupFile}`, 'callout-good');
    await refreshFeatures({ quiet: true });
    if (contextKey !== planeContextKey()) return;
    renderFeatureSelect(itemId);
    await loadInstallStatus();
    toast('The feature now uses the uploaded image.', 'good');
  } catch (error) {
    if (contextKey !== planeContextKey()) return;
    setInstallStatus('');
    setInstallError(installFailureText(error));
  } finally {
    state.install.busy = false;
    updateControlStates();
  }
}

async function handleReplaneClick() {
  const planeId = $('replaneSelect').value;
  const reason = replaneBlockReason(writeGateInput(), planeId);
  if (reason) return;
  const plane = state.install.planes.find((candidate) => candidate.id === planeId);
  if (!confirmWrite(`Move this reference image to ${plane.label}?`)) return;
  const contextKey = planeContextKey();
  const context = { ...state.context };
  const itemId = state.selectedItem.id;
  // Onshape can store the new plane even when regeneration or the response
  // fails. A preview in the old coordinate frame is invalid from this point.
  markResultStale();
  state.install.busy = true;
  $('replaneStatus').hidden = false;
  $('replaneStatus').textContent = 'Changing plane…';
  updateControlStates();
  try {
    const result = await apiFetch('/api/replane', {
      method: 'POST', body: JSON.stringify({ context, itemId, planeId, confirm: true }), timeoutMs: 60_000
    });
    if (contextKey !== planeContextKey()) return;
    if (result.items && !result.itemsStale) {
      state.items = result.items;
      renderFeatureSelect(itemId);
    } else if (result.item) {
      state.items = state.items.map((item) => item.id === itemId ? result.item : item);
      renderFeatureSelect(itemId);
    }
    $('replaneStatus').textContent = result.itemsStale
      ? 'Plane changed. Refreshing the feature list…'
      : `Plane changed to ${result.plane?.label || plane.label}.`;
    await refreshFeatures({ quiet: true });
    await loadInstallStatus();
    if (contextKey === planeContextKey() && result.itemsStale) $('replaneStatus').textContent = `Plane changed to ${result.plane?.label || plane.label}. Press Refresh if the feature list is unavailable.`;
  } catch (error) {
    if (contextKey !== planeContextKey()) return;
    $('replaneStatus').textContent = describeApiError(error, { upstream: true });
    await loadInstallStatus();
  } finally {
    state.install.busy = false;
    updateControlStates();
  }
}

// ---------------------------------------------------------------------------
// Suppressing a duplicate native image
//
// A document that already had an Insert image sketch, and then had the
// calibrated feature added, shows the same picture twice. The server's
// cross-reference (findDuplicateNativeImages in src/onshape-model.mjs) says
// which sketches plausibly duplicate the applied feature; this offers the fix
// and never decides anything on its own.
// ---------------------------------------------------------------------------

function setSuppressStatus(text, kind = 'callout-neutral') {
  elements.suppressStatus.hidden = !text;
  elements.suppressStatus.textContent = text || '';
  elements.suppressStatus.className = `callout ${kind}`;
}

function setSuppressError(text) {
  elements.suppressError.hidden = !text;
  elements.suppressError.textContent = text || '';
}

// The offer the server made, re-checked against the list on screen now: a
// sketch that has since been deleted, or that is already hidden, is not
// something to offer again.
function currentDuplicateOffer() {
  // The feature the offer was made about has to still be there. If the
  // calibrated feature was deleted between the write and now, there is no
  // duplicate of anything left to retire.
  const targetId = state.suppression.targetId;
  if (targetId && !state.items.some((candidate) => candidate.id === targetId)) return undefined;
  for (const offer of state.suppression.offers) {
    const item = state.items.find((candidate) => candidate.id === offer.itemId);
    if (!item || item.suppressed) continue;
    return {
      ...offer,
      featureName: item.featureName,
      otherSketchEntityCount: item.otherSketchEntityCount ?? offer.otherSketchEntityCount ?? 0
    };
  }
  return undefined;
}

// The selected target when it is a native sketch that is currently hidden.
function suppressedNativeSelection() {
  const item = state.selectedItem;
  return item && item.kind === 'native' && item.suppressed ? item : undefined;
}

// The item "Unsuppress this sketch" reaches: the current Target selection,
// if it happens to be a hidden native sketch, or otherwise the sketch this
// panel's own Suppress/Unsuppress buttons last acted on. Apply and the
// duplicate-image offer both leave Target selected on the calibrated
// feature, not on the sketch that request just hid, so relying on selection
// alone left the promised undo unreachable after the most common path to it.
function unsuppressCandidate() {
  const selected = suppressedNativeSelection();
  if (selected) return selected;
  const lastId = state.suppression.lastSuppressedId;
  if (!lastId) return undefined;
  const item = state.items.find((candidate) => candidate.id === lastId);
  return item && item.kind === 'native' && item.suppressed ? item : undefined;
}

// Confidence is the server's, and it changes the sentence rather than being
// printed as a label: "exact" means the two point at the same blob element,
// the weaker two mean the evidence was thinner than that.
function duplicateOfferText(offer) {
  const name = offer.featureName || 'A sketch';
  if (offer.confidence === 'exact') return `“${name}” also shows this image. Suppress it?`;
  if (offer.confidence === 'likely') return `“${name}” looks like it shows this image too. Suppress it?`;
  return `“${name}” has an inserted image that might be this one. Suppress it?`;
}

function duplicateOfferExplain(offer) {
  const lines = ['Suppressing hides the sketch in Onshape. Nothing is deleted, and you can undo it here.'];
  if (offer.otherSketchEntityCount > 0) {
    lines.push(`This sketch also holds ${offer.otherSketchEntityCount} other item${offer.otherSketchEntityCount === 1 ? '' : 's'}, and hiding it hides ${offer.otherSketchEntityCount === 1 ? 'that' : 'those'} too — including anything built on top of ${offer.otherSketchEntityCount === 1 ? 'it' : 'them'}.`);
  }
  return lines.join(' ');
}

function renderSuppressionOffer() {
  const offer = currentDuplicateOffer();
  elements.duplicateOffer.hidden = !offer;
  if (offer) {
    elements.duplicateOfferText.textContent = duplicateOfferText(offer);
    elements.duplicateOfferExplain.textContent = duplicateOfferExplain(offer);
  }
  elements.unsuppressRow.hidden = !unsuppressCandidate();
  updateControlStates();
}

// One request path for both directions. window.confirm rather than
// confirmWrite: this is the write that makes part of someone's model vanish
// from their screen, so it is asked every time, and POST /api/suppress rejects
// a body without confirm: true whatever the confirm-before-write setting says.
async function requestSuppression(itemId, suppressed) {
  if (state.suppression.busy) return;
  const item = state.items.find((candidate) => candidate.id === itemId);
  const name = item?.featureName || 'this sketch';
  const question = suppressed
    ? `Hide “${name}” in Onshape?\n\nNothing is deleted. You can unsuppress it from this panel, and a JSON backup is saved on the server first.`
    : `Show “${name}” in Onshape again?`;
  if (!window.confirm(question)) return;

  state.suppression.busy = true;
  setSuppressError('');
  setSuppressStatus(suppressed ? 'Hiding the sketch…' : 'Showing the sketch again…');
  updateControlStates();
  try {
    const result = await apiFetch('/api/suppress', {
      method: 'POST',
      body: JSON.stringify({ context: state.context, itemId, suppressed, confirm: true }),
      timeoutMs: 60_000
    });
    // Recorded regardless of direction so unsuppressCandidate() can find this
    // item again once Target selection has moved on to the calibrated
    // feature; it re-checks the item's own suppressed flag, so an id left
    // over from an unsuppress does not falsely offer an undo.
    state.suppression.lastSuppressedId = itemId;
    if (result.itemsStale || !Array.isArray(result.items)) {
      await refreshFeatures({ quiet: true });
    } else {
      state.items = result.items;
      renderFeatureSelect(state.selectedItem?.id || '');
    }
    if (!result.changed) {
      setSuppressStatus(`“${name}” was already ${suppressed ? 'hidden' : 'visible'}. Nothing was written.`);
    } else if (suppressed) {
      setSuppressStatus(`“${name}” is hidden in Onshape. Backup: ${result.backupFile}`, 'callout-good');
    } else {
      setSuppressStatus(result.warning || `“${name}” is visible again.`, result.warning ? 'callout-neutral' : 'callout-good');
    }
    toast(suppressed ? 'Sketch suppressed.' : 'Sketch unsuppressed.', 'good');
  } catch (error) {
    setSuppressStatus('');
    const message = describeApiError(error, { upstream: true, fallback: 'The sketch was not changed.' });
    setSuppressError(message);
    // suppressError sits in the Onshape target card, which is not necessarily
    // on screen when this was pressed from the duplicate-image offer at the
    // bottom of the Result card. The success path already toasts a
    // confirmation regardless of which button was pressed; a refusal needs
    // the same, or it can go entirely unseen.
    toast(message, 'error');
  } finally {
    state.suppression.busy = false;
    renderSuppressionOffer();
  }
}

function handleDuplicateSuppressClick() {
  const offer = currentDuplicateOffer();
  // The button is disabled without an offer, but a click can still race a
  // refresh that removed it.
  if (!offer) return;
  return requestSuppression(offer.itemId, true);
}

function handleUnsuppressClick() {
  const item = unsuppressCandidate();
  if (!item) return;
  return requestSuppression(item.id, false);
}

// Everything the pure gates in write-gates.mjs are allowed to see: the state
// object, the server's own auth summary and gate sentences, and the handful
// of form values that decide a reason. Gathered here so those predicates stay
// DOM-free and unit testable, and so a new control cannot start reading the
// DOM from inside one of them.
function writeGateInput() {
  return {
    state,
    auth: state.bootstrap?.auth || {},
    gates: state.bootstrap?.gates || {},
    form: {
      distance: Number(elements.distanceInput.value),
      samePair: elements.samePairToggle.checked,
      anchor: elements.anchorSelect.value,
      installSelection: elements.installImageSelect.value,
      inputSignature: currentInputSignature()
    }
  };
}

// Single authority for every `.disabled` write and every inline reason
// string. Keeping this in one place means a control can never end up
// disabled with stale or missing copy explaining why.
function updateControlStates() {
  $('previewTab').disabled = !state.result;
  $('previewTabReason').hidden = Boolean(state.result);
  if (!state.result && $('sourcePanel').hidden) setStageTab('source');
  $('connectionDot').dataset.state = state.bootstrap?.auth?.connection?.state || 'unconfigured';
  $('connectionRailBtn').title = elements.authBadge.textContent;
  $('documentRailBtn').title = elements.modeBadge.textContent;
  $('installIndicator').hidden = !state.context?.complete || !state.install.data || state.install.data.state === 'instance-present';
  const auth = state.bootstrap?.auth || {};
  const gateInput = writeGateInput();
  const contextComplete = Boolean(state.context?.complete);
  const busy = state.busy;

  const connectionState = auth.connection?.state;

  let loadOnshapeDisabled = true;
  let loadOnshapeReasonText = '';
  if (busy) {
    loadOnshapeReasonText = 'Working… this comes back when the current request finishes.';
  } else if (!contextComplete) {
    loadOnshapeReasonText = 'No Onshape document loaded. Paste your Part Studio URL in the Onshape target card, then try again.';
  } else if (connectionState === 'unconfigured') {
    loadOnshapeReasonText = 'Onshape is not set up yet. Open Connection to connect your account, or use Load local image.';
  } else if (connectionState === 'oauth-required') {
    loadOnshapeReasonText = 'Onshape is not authorized yet. Press Authorize Onshape in the Onshape target card.';
  } else if (connectionState === 'rejected' || connectionState === 'forbidden') {
    loadOnshapeReasonText = 'Onshape rejected this server’s API key. Press the Onshape badge at the top to enter a new one. Load local image still works.';
  } else if (connectionState === 'unreachable' || connectionState === 'error') {
    loadOnshapeReasonText = 'This computer cannot reach Onshape right now. Load local image still works — the calculation happens here, not on Onshape.';
  } else if (readScopeMissing(auth)) {
    loadOnshapeReasonText = 'This API key does not have the Read documents permission, so Onshape will not hand over the image. Create a new key with Read documents ticked. Load local image still works.';
  } else if (state.items.length === 0) {
    loadOnshapeReasonText = 'No reference-image features in this Part Studio. Insert a Calibrated Reference Image feature, then press Refresh.';
  } else if (!state.selectedItem) {
    loadOnshapeReasonText = 'No target selected. Choose a feature under Target, or use Load local image.';
  } else if (!state.selectedItem.image?.proxyAvailable) {
    loadOnshapeReasonText = 'Onshape did not include a downloadable file reference for this feature. Press Load local image and choose the same file — the calibration is still correct as long as the pixels are identical.';
  } else {
    loadOnshapeDisabled = false;
  }
  elements.loadOnshapeBtn.disabled = loadOnshapeDisabled;
  setReason(elements.loadOnshapeReason, loadOnshapeDisabled ? loadOnshapeReasonText : '');

  // Disabling Refresh on a transient failure (unreachable/error/checking) is
  // the classic stuck state, so those three leave the button enabled with an
  // explanatory reason instead.
  let refreshDisabled = true;
  let refreshReasonText = '';
  if (busy) {
    refreshReasonText = 'Refreshing…';
  } else if (!contextComplete) {
    refreshReasonText = 'Nothing to refresh yet. Paste your Part Studio URL above.';
  } else if (connectionState === 'unconfigured') {
    refreshReasonText = 'This server has no Onshape credentials, so there is nothing to read.';
  } else if (connectionState === 'oauth-required') {
    refreshReasonText = 'Authorize Onshape first.';
  } else if (connectionState === 'rejected' || connectionState === 'forbidden') {
    refreshReasonText = 'Onshape rejected this server’s API key. Fix it from the Onshape badge at the top.';
  } else if (readScopeMissing(auth)) {
    refreshReasonText = 'This API key does not have the Read documents permission, so there is nothing it can read. Create a new key with Read documents ticked.';
  } else {
    refreshDisabled = false;
    if (connectionState === 'unreachable' || connectionState === 'error') {
      refreshReasonText = 'Could not reach Onshape last time. Press Refresh to try again.';
    } else if (connectionState === 'checking') {
      // Nothing has failed yet — this is the state before the first probe
      // resolves, not a retry of a past failure. Reusing that copy here
      // accuses a healthy server of an outage that never happened.
      refreshReasonText = 'Checking the Onshape connection…';
    }
  }
  elements.refreshFeaturesBtn.disabled = refreshDisabled;
  setReason(elements.refreshFeaturesReason, refreshReasonText);

  const noImageDisabled = !state.sourceImage;
  const pickReasonText = noImageDisabled ? 'Load an image before picking pixels.' : '';
  elements.pickScaleA.disabled = noImageDisabled;
  elements.pickScaleB.disabled = noImageDisabled;
  elements.pickRotationA.disabled = noImageDisabled;
  elements.pickRotationB.disabled = noImageDisabled;
  setReason(elements.scalePickReason, pickReasonText);
  setReason(elements.rotationPickReason, pickReasonText);

  elements.fitBtn.disabled = noImageDisabled;
  elements.zoomInBtn.disabled = noImageDisabled;
  elements.zoomOutBtn.disabled = noImageDisabled;
  elements.panBtn.disabled = noImageDisabled;

  const anyPickSet = Boolean(
    state.picks.scale.a || state.picks.scale.b || state.picks.rotation.a || state.picks.rotation.b
  );
  elements.clearPicksBtn.disabled = !anyPickSet;

  elements.featureSelect.disabled = state.items.length === 0 || state.busy || state.install.busy;

  const previewReasonText = previewBlockReason(gateInput);
  elements.previewBtn.disabled = Boolean(previewReasonText);
  setReason(elements.previewReason, previewReasonText);

  const apply = applyBlockReason(gateInput, previewReasonText);
  elements.applyBtn.disabled = apply.disabled;
  elements.applyHelp.textContent = apply.text;
  elements.applyHelp.classList.toggle('is-blocked', apply.disabled);

  const installPlaneReason = state.install.planesLoading ? 'Checking available planes…' : state.install.planeError || state.install.planes.find((plane) => plane.id === $('installPlaneSelect').value)?.unavailableReason || '';
  const installReasonText = installBlockReason(gateInput) || installPlaneReason;
  elements.installBtn.disabled = Boolean(installReasonText);
  setReason(elements.installReason, installReasonText);
  const uploadUseReasonText = uploadAndUseBlockReason(gateInput);
  elements.uploadUseImageBtn.disabled = Boolean(uploadUseReasonText);
  setReason(elements.uploadUseImageReason, uploadUseReasonText);
  elements.installImageSelect.disabled = state.busy || state.install.busy || !state.context?.complete;
  $('installPlaneSelect').disabled = state.busy || state.install.busy || !state.context?.complete || state.install.planesLoading || !state.install.planes.length;
  setReason($('installPlaneReason'), installPlaneReason || (!$('installPlaneSelect').disabled ? '' : 'Planes are available after this Part Studio is loaded.'));
  const replaneReason = replaneBlockReason(gateInput, $('replaneSelect').value);
  $('replaneBtn').disabled = Boolean(replaneReason);
  $('replaneSelect').disabled = state.busy || state.install.busy || state.install.planesLoading || !state.install.planes.length;
  setReason($('replaneReason'), replaneReason);
  for (const select of [$('installPlaneSelect'), $('replaneSelect')]) {
    for (const option of select.options) option.disabled = Boolean(state.install.planes.find((plane) => plane.id === option.value)?.unavailableReason);
  }

  const duplicateOffer = currentDuplicateOffer();
  const duplicateReasonText = duplicateOffer ? suppressBlockReason(gateInput, duplicateOffer.itemId) : '';
  elements.duplicateSuppressBtn.disabled = Boolean(duplicateReasonText);
  setReason(elements.duplicateSuppressReason, duplicateReasonText);
  const unsuppressTarget = unsuppressCandidate();
  const unsuppressReasonText = unsuppressTarget ? suppressBlockReason(gateInput, unsuppressTarget.id) : '';
  elements.unsuppressBtn.disabled = Boolean(unsuppressReasonText);
  setReason(elements.unsuppressReason, unsuppressReasonText);

  let settingsDisabled = false;
  let settingsReasonText = '';
  if (state.settings.busy) {
    settingsDisabled = true;
    settingsReasonText = 'Saving…';
  } else if (state.settings.available === false && state.settings.unavailableReason) {
    settingsDisabled = true;
    settingsReasonText = 'These settings can only be changed from a browser on the computer running this program.';
  } else if (state.settings.available === false) {
    // Not a loopback refusal — a transport failure, a 500, or the server
    // restarting mid-load. Saving now would post whatever this form happens
    // to show, which was never read from a real settings file, over
    // whatever is actually saved. The true reason for the failure is already
    // in settingsError.
    settingsDisabled = true;
    settingsReasonText = 'These settings could not be loaded, so saving is disabled to avoid overwriting them with what is shown here. Reload the page to try again.';
  }
  elements.settingsSaveBtn.disabled = settingsDisabled;
  for (const row of POLICY_ROWS) elements[row.input].disabled = settingsDisabled;
  elements.settingsConfirmBeforeWrite.disabled = settingsDisabled;
  elements.settingsScratchFolderId.disabled = settingsDisabled;
  setReason(elements.settingsReason, settingsReasonText);
}

async function previewCalibration() {
  validateForPreview();
  setBusy(true, 'Calculating…');
  try {
    const result = await apiFetch('/api/preview', {
      method: 'POST',
      body: JSON.stringify(buildCalibrationPayload(true))
    });
    renderResult(result);
    toast('Calibration solved.', 'good');
  } finally {
    setBusy(false);
  }
}

async function applyCalibration() {
  validateForPreview();
  if (!state.selectedItem?.editable) throw new Error('Select a writable Onshape calibrated image feature.');
  if (!state.result || state.resultSignature !== currentInputSignature()) {
    throw new Error('Preview the current picks before applying them.');
  }
  if (!confirmWrite(
    `Apply this scale and rotation to “${state.selectedItem.featureName}”?\n\n` +
    'The server will save a JSON backup of the current feature first.'
  )) return;

  state.busy = true;
  elements.applyBtn.disabled = true;
  const oldText = elements.applyBtn.textContent;
  elements.applyBtn.textContent = 'Applying…';
  try {
    const response = await apiFetch('/api/apply', {
      method: 'POST',
      body: JSON.stringify({ ...buildCalibrationPayload(true), confirm: true })
    });
    renderResult(response.calibration, 'Applied');
    toast(`Applied to Onshape. Backup: ${response.backupFile}`, 'good');
    sendOnshapeMessage('showMessageBubble', { message: 'Reference image scale and rotation applied.' });
    // Set after renderResult, which clears the previous write's offer. The
    // list is the server's; the browser never works out for itself which
    // sketches duplicate this image.
    state.suppression.offers = Array.isArray(response.nativeDuplicates) ? response.nativeDuplicates : [];
    state.suppression.targetId = response.item?.id;
    setSuppressStatus('');
    setSuppressError('');
    await refreshFeatures({ quiet: true });
    renderSuppressionOffer();
  } finally {
    state.busy = false;
    elements.applyBtn.textContent = oldText;
    updateControlStates();
  }
}

function parameterText() {
  if (!state.result) return '';
  const placement = state.result.placement;
  return [
    `originX = ${formatNumber(placement.originX, 12)} m`,
    `originY = ${formatNumber(placement.originY, 12)} m`,
    `imageWidth = ${formatNumber(placement.width, 12)} m`,
    `imageAngle = ${formatNumber(signedDegrees(placement.angle), 12)} deg`
  ].join('\n');
}

function buildRecipe() {
  if (!state.result) throw new Error('Preview a calibration first.');
  return {
    schema: 'onshape-reference-align/recipe/v1',
    createdAt: new Date().toISOString(),
    source: {
      name: state.sourceName,
      origin: state.sourceOrigin,
      pixelWidth: state.sourceImage.naturalWidth,
      pixelHeight: state.sourceImage.naturalHeight
    },
    onshape: state.selectedItem ? {
      context: state.context,
      itemId: state.selectedItem.id,
      kind: state.selectedItem.kind,
      featureId: state.selectedItem.featureId,
      entityId: state.selectedItem.entityId
    } : undefined,
    input: buildCalibrationPayload(false),
    result: state.result,
    featureParameters: {
      originX: `${formatNumber(state.result.placement.originX, 15)} m`,
      originY: `${formatNumber(state.result.placement.originY, 15)} m`,
      imageWidth: `${formatNumber(state.result.placement.width, 15)} m`,
      imageAngle: `${formatNumber(signedDegrees(state.result.placement.angle), 15)} deg`
    }
  };
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeBaseName(name) {
  return String(name || 'reference-image').replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 100);
}

async function exportRotatedPng() {
  if (!state.sourceImage || !state.result) throw new Error('Preview a calibration first.');
  const image = state.sourceImage;
  const angle = -state.result.placement.angle;
  const c = Math.abs(Math.cos(angle));
  const s = Math.abs(Math.sin(angle));
  const width = Math.ceil(image.naturalWidth * c + image.naturalHeight * s);
  const height = Math.ceil(image.naturalWidth * s + image.naturalHeight * c);
  const maxSide = 16384;
  if (width > maxSide || height > maxSide) {
    throw new Error(`The rotated raster would be ${width} × ${height} px, which exceeds a conservative browser canvas limit.`);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.translate(width / 2, height / 2);
  context.rotate(angle);
  context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error('The browser could not encode the rotated PNG.')), 'image/png');
  });
  downloadBlob(blob, `${safeBaseName(state.sourceName)}__aligned.png`);
}

const UPDATE_BANNER_DISMISSED_KEY = 'referenceAlign.updateBannerDismissedVersion';

// localStorage access wrapped in try/catch: private-browsing modes and
// locked-down browser policies can make it throw on read or write, and a
// banner that can merely reappear on the next load is not worth crashing
// startup or Dismiss over.
function readDismissedUpdateVersion() {
  try {
    return localStorage.getItem(UPDATE_BANNER_DISMISSED_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function rememberUpdateBannerDismissed(version) {
  try {
    if (version) localStorage.setItem(UPDATE_BANNER_DISMISSED_KEY, version);
  } catch {
    // Best-effort only; a failed write just means Dismiss doesn't stick.
  }
}

function attachEvents() {
  elements.updateBannerDismiss.addEventListener('click', () => {
    elements.updateBanner.hidden = true;
    rememberUpdateBannerDismissed(state.updateLatestVersion);
  });

  for (const button of document.querySelectorAll('[data-pick]')) {
    button.addEventListener('click', () => setPickTarget(button.dataset.pick));
  }

  elements.onshapeUrlInput.addEventListener('input', () => {
    // Never show a rejection while the user is still typing — only on blur
    // or submit, once there is a complete address to judge.
    hideUrlError();
    const value = elements.onshapeUrlInput.value.trim();
    if (!value) {
      elements.urlParsed.hidden = true;
      renderUrlWarning(undefined);
      return;
    }
    const parsed = parseOnshapeUrl(value, { expectedOrigin: state.bootstrap?.capabilities?.onshapeBaseUrl });
    if (parsed.ok) {
      renderUrlParsed(parsed);
      renderUrlWarning(parsed);
    } else {
      elements.urlParsed.hidden = true;
      renderUrlWarning(undefined);
    }
  });
  elements.onshapeUrlInput.addEventListener('blur', () => {
    const value = elements.onshapeUrlInput.value.trim();
    if (!value) return;
    const parsed = parseOnshapeUrl(value, { expectedOrigin: state.bootstrap?.capabilities?.onshapeBaseUrl });
    if (!parsed.ok) showUrlError(parsed.error.message);
  });
  elements.onshapeUrlInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    handleLoadUrlClick();
  });
  elements.loadUrlBtn.addEventListener('click', handleLoadUrlClick);

  elements.installImageSelect.addEventListener('change', updateControlStates);
  $('installPlaneSelect').addEventListener('change', updateControlStates);
  $('replaneSelect').addEventListener('change', updateControlStates);
  $('replaneBtn').addEventListener('click', () => handleReplaneClick());
  elements.installBtn.addEventListener('click', () => handleInstallClick());
  elements.uploadUseImageBtn.addEventListener('click', () => handleUploadAndUseClick());
  elements.duplicateSuppressBtn.addEventListener('click', () => handleDuplicateSuppressClick());
  elements.unsuppressBtn.addEventListener('click', () => handleUnsuppressClick());

  elements.authBadge.addEventListener('click', () => {
    refreshConnectionState().catch(() => {});
    openSetup({ focus: true });
  });
  elements.settingsSaveBtn.addEventListener('click', () => handleSettingsSave().catch((error) => {
    setSettingsError(error.message);
    state.settings.busy = false;
    updateControlStates();
  }));
  // Clearing a stale "Saved." the moment the form differs from what was
  // saved: leaving it up would claim the switch in front of the operator is
  // the one on disk.
  for (const row of POLICY_ROWS) {
    elements[row.input].addEventListener('change', () => setSettingsStatus(''));
  }
  elements.settingsConfirmBeforeWrite.addEventListener('change', () => setSettingsStatus(''));
  elements.settingsScratchFolderId.addEventListener('input', () => setSettingsStatus(''));
  elements.setupReconfigureBtn.addEventListener('click', () => openSetup({ focus: true }));
  elements.setupCancelBtn.addEventListener('click', closeSetup);
  $('setupSkipBtn').addEventListener('click', () => {
    setFlyout(null, { focus: false });
    setStageTab('source');
    elements.loadFileBtn.focus({ preventScroll: true });
  });
  elements.setupForm.addEventListener('submit', (event) => {
    // Enter tests the pasted key. It never reloads this page or saves an
    // untested key; saving stays the explicitly labelled next action.
    event.preventDefault();
    handleSetupTest().catch((error) => setSetupError(error.message));
  });
  elements.setupSecretRevealBtn.addEventListener('click', () => {
    const revealed = elements.setupSecretKey.type === 'text';
    elements.setupSecretKey.type = revealed ? 'password' : 'text';
    elements.setupSecretRevealBtn.textContent = revealed ? 'Show' : 'Hide';
    elements.setupSecretRevealBtn.setAttribute('aria-pressed', String(!revealed));
  });
  for (const input of [elements.setupAccessKey, elements.setupSecretKey, elements.setupBaseUrl]) {
    input.addEventListener('input', updateSetupSaveGate);
  }
  elements.setupSaveBtn.addEventListener('click', () => handleSetupSave().catch((error) => setSetupError(error.message)));

  elements.fileInput.addEventListener('change', async () => {
    try {
      await loadLocalFile(elements.fileInput.files?.[0]);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      elements.fileInput.value = '';
    }
  });
  elements.emptyLoadBtn.addEventListener('click', () => elements.fileInput.click());
  elements.loadFileBtn.addEventListener('click', () => elements.fileInput.click());
  elements.loadOnshapeBtn.addEventListener('click', () => loadSelectedOnshapeImage().catch((error) => toast(error.message, 'error')));
  elements.fitBtn.addEventListener('click', fitImage);
  elements.zoomInBtn.addEventListener('click', () => zoomAt(1.25));
  elements.zoomOutBtn.addEventListener('click', () => zoomAt(0.8));
  elements.panBtn.addEventListener('click', () => {
    state.view.panMode = !state.view.panMode;
    elements.panBtn.setAttribute('aria-pressed', String(state.view.panMode));
    elements.canvasStage.classList.toggle('pan-active', state.view.panMode);
  });
  elements.clearPicksBtn.addEventListener('click', clearPicks);

  elements.samePairToggle.addEventListener('change', () => {
    $('rotationCard').open = !elements.samePairToggle.checked;
    elements.rotationPickGroup.hidden = elements.samePairToggle.checked;
    if (elements.samePairToggle.checked && state.pickTarget?.startsWith('rotation')) setPickTarget(undefined);
    markResultStale();
    drawSource();
  });
  elements.rotationMode.addEventListener('change', () => {
    elements.customAngleField.hidden = elements.rotationMode.value !== 'custom';
    markResultStale();
  });
  for (const input of [elements.distanceInput, elements.distanceUnit, elements.customAngleInput, elements.anchorSelect]) {
    input.addEventListener('input', markResultStale);
    input.addEventListener('change', markResultStale);
  }

  elements.featureSelect.addEventListener('change', () => {
    state.selectedItem = state.items.find((item) => item.id === elements.featureSelect.value);
    markResultStale();
    renderFeatureDetails();
    $('replaneStatus').hidden = true;
    loadInstallStatus().catch(() => {});
  });
  elements.refreshFeaturesBtn.addEventListener('click', () => refreshFeatures().catch((error) => toast(error.message, 'error')));
  elements.previewBtn.addEventListener('click', () => previewCalibration().catch((error) => {
    setBusy(false);
    toast(error.message, 'error');
  }));
  elements.applyBtn.addEventListener('click', () => applyCalibration().catch((error) => {
    state.busy = false;
    elements.applyBtn.textContent = 'Apply to Onshape';
    updateControlStates();
    toast(error.message, 'error');
  }));
  elements.copyParamsBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(parameterText());
      toast('Feature parameters copied.', 'good');
    } catch {
      toast('Clipboard access failed. Select and copy the values manually.', 'error');
    }
  });
  elements.downloadRecipeBtn.addEventListener('click', () => {
    try {
      const blob = new Blob([JSON.stringify(buildRecipe(), null, 2)], { type: 'application/json' });
      downloadBlob(blob, `${safeBaseName(state.sourceName)}__reference-align.json`);
    } catch (error) {
      toast(error.message, 'error');
    }
  });
  elements.downloadPngBtn.addEventListener('click', () => exportRotatedPng().catch((error) => toast(error.message, 'error')));

  elements.canvasStage.addEventListener('contextmenu', (event) => event.preventDefault());
  elements.canvasStage.addEventListener('wheel', (event) => {
    event.preventDefault();
    zoomAt(event.deltaY < 0 ? 1.14 : 0.877, event.clientX, event.clientY);
  }, { passive: false });

  elements.canvasStage.addEventListener('pointerdown', (event) => {
    if (!state.sourceImage) return;
    const shouldPan = state.view.panMode || state.view.spacePan || event.button === 1 || !state.pickTarget;
    state.view.pointerId = event.pointerId;
    state.view.dragStart = {
      clientX: event.clientX,
      clientY: event.clientY,
      panX: state.view.panX,
      panY: state.view.panY,
      shouldPan
    };
    state.view.dragMoved = false;
    elements.canvasStage.setPointerCapture(event.pointerId);
    elements.canvasStage.classList.add('dragging');
  });

  // Pointer events are not capped at the refresh rate (a high-poll-rate mouse
  // or pen digitizer can exceed 200 Hz), and hovering or dragging over the
  // multi-megapixel scan this tool is built for is exactly the case where a
  // full redraw per raw event matters. Only the latest position is kept;
  // everything downstream — the loupe and the full source redraw, each of
  // which would otherwise force its own layout via getBoundingClientRect —
  // runs at most once per animation frame. recordPick stays on pointerup,
  // outside this scheduling, so a coalesced frame can never swallow a pick.
  let pointerMoveScheduled = false;
  let latestPointerMove = null;
  const runScheduledPointerMove = () => {
    pointerMoveScheduled = false;
    if (!latestPointerMove) return;
    const { clientX, clientY, pointerId } = latestPointerMove;
    latestPointerMove = null;

    const rect = elements.sourceCanvas.getBoundingClientRect();
    const point = screenToImage(clientX, clientY, rect);
    state.hoverPixel = point;
    elements.cursorReadout.textContent = point ? `x ${point.x.toFixed(2)}, y ${point.y.toFixed(2)}` : 'x —, y —';
    drawLoupe(point);

    if (state.view.pointerId === pointerId && state.view.dragStart) {
      const dx = clientX - state.view.dragStart.clientX;
      const dy = clientY - state.view.dragStart.clientY;
      if (Math.hypot(dx, dy) > 3) state.view.dragMoved = true;
      if (state.view.dragStart.shouldPan || state.view.dragMoved) {
        state.view.panX = state.view.dragStart.panX + dx;
        state.view.panY = state.view.dragStart.panY + dy;
      }
    }
    drawSource(rect);
  };
  elements.canvasStage.addEventListener('pointermove', (event) => {
    latestPointerMove = { clientX: event.clientX, clientY: event.clientY, pointerId: event.pointerId };
    if (pointerMoveScheduled) return;
    pointerMoveScheduled = true;
    requestAnimationFrame(runScheduledPointerMove);
  });

  const finishPointer = (event, cancelled = false) => {
    if (state.view.pointerId !== event.pointerId) return;
    // Commit the last movement while dragStart still exists. Pointerup may
    // precede the queued frame, otherwise a short drag is mistaken for a pick.
    if (latestPointerMove?.pointerId === event.pointerId) runScheduledPointerMove();
    const wasMoved = state.view.dragMoved;
    const shouldPan = state.view.dragStart?.shouldPan;
    state.view.pointerId = undefined;
    state.view.dragStart = undefined;
    state.view.dragMoved = false;
    elements.canvasStage.classList.remove('dragging');
    if (elements.canvasStage.hasPointerCapture?.(event.pointerId)) elements.canvasStage.releasePointerCapture(event.pointerId);
    if (!cancelled && !wasMoved && !shouldPan && state.pickTarget) {
      const point = screenToImage(event.clientX, event.clientY);
      if (point) recordPick(state.pickTarget, point);
      else toast('Click inside the image.', 'error');
    }
  };
  elements.canvasStage.addEventListener('pointerup', (event) => finishPointer(event));
  elements.canvasStage.addEventListener('pointercancel', (event) => finishPointer(event, true));
  elements.canvasStage.addEventListener('pointerleave', () => {
    // A pointermove already scheduled for this frame must not redraw a stale
    // hover after the pointer has left the canvas.
    latestPointerMove = null;
    if (!state.view.pointerId) {
      state.hoverPixel = undefined;
      drawLoupe(undefined);
      drawSource();
    }
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setPickTarget(undefined);
    if (event.code === 'Space' && !event.repeat && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
      event.preventDefault();
      state.view.spacePan = true;
      elements.canvasStage.classList.add('pan-active');
    }
  });
  window.addEventListener('keyup', (event) => {
    if (event.code === 'Space') {
      state.view.spacePan = false;
      if (!state.view.panMode) elements.canvasStage.classList.remove('pan-active');
    }
  });

  const observer = new ResizeObserver(() => {
    drawSource();
    drawPreview();
  });
  observer.observe(elements.canvasStage);
  observer.observe(elements.previewCanvas.parentElement);
}

// A dismissible, link-only notice — never downloads or runs anything. Only
// ever shown when the server itself reports a newer version (GET /api/update
// resolves to { disabled: true } whenever UPDATE_CHECK_URL is unset, so an
// operator who never opted in never sees a fetch attempt, let alone a
// banner) and shouldShowUpdateBanner (update-banner.mjs) confirms `latest`
// actually parses as newer than `current` — not merely a different string —
// and that this exact version was not already dismissed on this browser.
// The server already validates the feed's own url field (see
// isAbsoluteHttpUrl in src/update-check.mjs), but that value still flows
// straight into this anchor's href. This is a second, independent check on
// the client: the strict CSP (script-src 'self', no unsafe-inline) already
// blocks a javascript: href from executing on click in a compliant browser,
// but an embedded webview with a looser policy has no such protection, and
// this app should not be leaning on CSP alone for a value it controls.
function isSafeUpdateUrl(value) {
  if (typeof value !== 'string' || !value) return false;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}

async function checkForUpdateBanner() {
  const result = await apiFetch('/api/update');
  if (!shouldShowUpdateBanner(result, readDismissedUpdateVersion())) return;
  if (!isSafeUpdateUrl(result.url)) return;
  state.updateLatestVersion = result.latest;
  elements.updateBannerText.textContent = `A newer version (${result.latest}) is available. You're running ${result.current}.`;
  elements.updateBannerLink.href = result.url;
  elements.updateBanner.hidden = false;
}

async function initialize() {
  initializeLayout();
  attachEvents();
  updateSetupSaveGate();
  drawSource();
  drawPreview();
  try {
    state.bootstrap = await apiFetch(`/api/bootstrap${location.search}`);
    state.csrfToken = state.bootstrap.csrfToken;
    renderBootstrap();
    if (state.bootstrap.auth.connection?.state === 'unconfigured' || state.bootstrap.auth.mode === 'none') setFlyout('connection');
    loadSettings().catch(() => {});
    refreshConnectionState().catch(() => {});
    checkForUpdateBanner().catch(() => {});
    sendOnshapeMessage('applicationInit');
    renderFeatureSelect('');
    if (state.context?.complete && state.bootstrap.auth.canRequest) {
      await refreshFeatures({ quiet: true });
    }
  } catch (error) {
    elements.contextMessage.className = 'callout callout-warning';
    elements.contextMessage.textContent = error.message;
    toast(error.message, 'error');
    updateControlStates();
  }
}

// The setup wizard tells the operator an unverified save "will check again
// once you are back online" (see updateSetupSaveGate's SAVE_ANYWAY_REASONS
// copy) — this is what keeps that true, instead of leaving the badge on a
// stale verdict until the next full reload.
window.addEventListener('online', () => refreshConnectionState().catch(() => {}));

initialize();
