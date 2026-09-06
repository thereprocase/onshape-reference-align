// Every route this server answers with a body: the six that write to
// somebody's Onshape document, and the two reads that share their machinery.
//
//   GET  /api/install/status  — what is already there
//   POST /api/preview         — run the solver without writing
//   POST /api/install         — create the Feature Studio and add an instance
//   POST /api/upload-image    — turn local image bytes into a blob element
//   POST /api/apply           — back up, then write a new placement
//   POST /api/rebind          — point an existing feature at a different blob
//   POST /api/replane         — move the image onto a different plane
//   POST /api/suppress        — hide (or unhide) a duplicate native sketch
//
// /api/apply lived in server.mjs's dispatch chain until it had grown its own
// copy of the 403-evidence rule, so the highest-blast-radius write in the
// product was the one write whose gates nothing held next to the others'.
// /api/preview is here because it is that write's dry run: it reads a feature
// and writes nothing, but it has to normalize and solve a request exactly the
// way apply does or the number it shows the operator is not the number apply
// will store.
//
// Four rules hold for every write here:
//
//  1. The rate-limit token is taken by handleWrite() below, once, before any
//     handler runs — including before the body is read. A throttle that only
//     counted the requests that got past the gates would not be one: a caller
//     refused for lack of a capability can retry as fast as it likes. The
//     bucket comes from the route's own row in src/routes.mjs, so a route
//     added here without a bucket decision fails the test suite.
//  2. requireFeature() runs before any Onshape call, so a refusal costs no
//     network and reads as the gate's own sentence.
//  3. confirmBeforeWrite is honoured here, not only in the browser. A UI that
//     asks is a courtesy; a server that insists is the actual control.
//     /api/suppress goes further and requires confirm: true unconditionally.
//  4. featureState.featureStatus is checked on every write response. The
//     write-shape experiment got HTTP 200 with featureStatus ERROR for a
//     namespace Onshape stored but could not resolve, so 200 proves nothing.
//
// server.mjs keeps no non-GET route body of its own; test/routes.test.mjs
// fails if one grows back there.
//
// Why POST /api/upload-image buffers instead of streaming: the request is
// re-encoded into a *new* multipart body for Onshape, and Onshape's HMAC
// signature has to cover the exact Content-Type header that body is sent
// with — a boundary that is only known once the body has been materialized
// (see encodeMultipartBody in src/onshape-api.mjs). So the payload is live in
// memory several times over for one upload, and the bound on that is the byte
// cap below plus this route's rate-limit bucket, not backpressure.

import path from 'node:path';

import { readJson } from './http.mjs';
import { routeRateLimitError } from './session.mjs';
import { OnshapeApiError } from './onshape-api.mjs';
import { requireFeature, recordCapabilityEvidence, clearCapabilityEvidence } from './capability-gate.mjs';
import { validateImageUpload } from './image-bytes.mjs';
import { calibratePlacement } from './geometry.mjs';
import { buildPlaneParameter, matchingPlaneCandidate, replacePlaneParameter, resolvePlaneCandidates } from './plane-model.mjs';
import {
  DEFAULT_FEATURE_STUDIO_NAME,
  FEATURE_MARKER,
  buildReferenceImageFeature,
  classifyInstall,
  elementList,
  elementNamespace,
  featureAddPayload,
  featureUpdatePayload,
  findDuplicateNativeImages,
  isOnshapeId,
  listFeatureStudioElements,
  prepareImageFeatureUpdate,
  readFeatureStatus,
  rebindImageNamespace,
  setFeatureSuppressed
} from './onshape-model.mjs';

/**
 * How many Feature Studios in one document will be opened to look for the
 * marker. A document with more than this many is not a normal case, and an
 * unbounded loop here would turn one status request into an unbounded number of
 * Onshape calls. The ones not read are reported as unread, never as unmarked.
 */
export const MAX_FEATURE_STUDIO_READS = 8;

/**
 * Slack over the image cap for the multipart envelope itself (boundaries,
 * headers, the encodedFilename part). The image's own size is checked again
 * against the real cap after parsing, so this only decides when to stop reading
 * a body that is obviously too big.
 */
export const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

function httpError(message, status, code, expose) {
  return Object.assign(new Error(message), { status, code, ...(expose ? { expose } : {}) });
}

async function readCappedBody(req, maxBytes) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBytes) {
      throw httpError('The uploaded image is larger than this server accepts.', 413, 'IMAGE_TOO_LARGE');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// The same asset key sea-config.json embeds it under and server.mjs serves it
// from at GET /assets/ReferenceImage.fs. Reading it through this key, rather
// than off config().featureScriptDir, is what keeps this route working inside
// a packaged SEA binary: a packaged process's projectRoot is the per-user
// config directory, which nothing ever populates with a featurescript/
// subfolder.
const FEATURE_SCRIPT_ASSET_KEY = 'featurescript/ReferenceImage.fs';

export function createWriteRoutes({
  api,
  assets,
  config,
  generation,
  settingsStore,
  capabilities,
  sendJson,
  normalizeContext,
  normalizeCalibration,
  loadImageItem,
  loadImageItems,
  writeBackup
}) {
  function policy() {
    return settingsStore.current();
  }

  function gate(session, feature) {
    // peekAuthSummary never probes, so a server that has not checked its
    // connection yet reports unknown scopes and is let through to find out from
    // Onshape rather than being refused on a guess.
    return requireFeature({ capabilities: capabilities(session), policy: policy() }, feature);
  }

  /**
   * The operator's "ask me first" switch, enforced server-side.
   *
   * A 409 rather than a 400: the request is well formed, it is the state of
   * this server that makes it unacceptable, and the client fixes it by asking
   * the person and sending confirm: true.
   */
  function requireConfirmation(confirmed, action) {
    if (policy().confirmBeforeWrite === false) return;
    if (confirmed === true) return;
    throw httpError(
      `${action} needs an explicit confirmation. Turn off “Confirm before every write” in the settings card to stop being asked.`,
      409,
      'CONFIRM_REQUIRED',
      { action }
    );
  }

  /**
   * The one write whose confirmation is not negotiable.
   *
   * Every other route asks only while `confirmBeforeWrite` is on. Suppression
   * makes part of someone's model disappear from their screen, so it is
   * confirmed even by an operator who has turned the asking off everywhere
   * else. A 400 rather than the 409 the policy check throws: `confirm: true`
   * is a required field of this request, not a refusal that depends on the
   * state of this server.
   */
  function requireExplicitConfirmation(confirmed, action) {
    if (confirmed === true) return;
    throw httpError(
      `${action} always needs confirm: true in the request. This one is asked every time, whatever the confirm-before-write setting says.`,
      400,
      'CONFIRM_REQUIRED',
      { action }
    );
  }

  function requireWorkspaceContext(context) {
    if (!context.complete) {
      throw httpError('A complete Onshape Part Studio context is required.', 400, 'CONTEXT_REQUIRED');
    }
    if (context.workspaceOrVersion !== 'w') {
      throw httpError(
        'This is a read-only version or microversion link. Open the same tab from the document’s workspace — the address with /w/ in it.',
        409,
        'CONTEXT_READ_ONLY'
      );
    }
    return context;
  }

  /**
   * A 403 from Onshape is the only direct evidence this server ever gets about
   * what the key may write, so every write records one and every success
   * retires it. Recorded against the generation that produced it, so a later
   * key swap does not inherit the verdict.
   */
  async function withEvidence(session, feature, task) {
    let result;
    try {
      result = await task();
    } catch (error) {
      if (error instanceof OnshapeApiError && error.status === 403) {
        recordCapabilityEvidence(session, feature, { status: 403, generation: generation() });
      }
      throw error;
    }
    clearCapabilityEvidence(session, feature);
    return result;
  }

  async function readFeatureScriptSource() {
    const buffer = await assets.readAsset(FEATURE_SCRIPT_ASSET_KEY);
    return buffer.toString('utf8');
  }

  /**
   * Fetch what the classifier needs: the element listing, the Part Studio's
   * features, and the source of every Feature Studio we are willing to open.
   */
  async function inspectDocument(context, session) {
    const [elements, featureList] = await Promise.all([
      api.listElements(context, session),
      api.getFeatures(context, session)
    ]);
    const studios = listFeatureStudioElements(elements).slice(0, MAX_FEATURE_STUDIO_READS);
    const studioContents = {};
    for (const studio of studios) {
      try {
        const contents = await api.getFeatureStudioContents(context, studio.id, session);
        if (typeof contents?.contents === 'string') studioContents[studio.id] = contents.contents;
      } catch (error) {
        // A studio this key cannot open is unread, not unmarked. Swallowing the
        // error and leaving it out of studioContents is what produces that.
        if (!(error instanceof OnshapeApiError)) throw error;
      }
    }
    return { elements, featureList, install: classifyInstall({ elements, studioContents, featureList }) };
  }

  async function handleStatus(req, res, url, session) {
    const context = normalizeContext(url);
    if (!context.complete) {
      sendJson(res, 200, {
        context,
        available: false,
        reason: 'No complete Onshape Part Studio context was supplied.',
        install: null
      });
      return true;
    }
    const { install, featureList } = await inspectDocument(context, session);
    const itemId = url.searchParams.get('itemId');
    const featureId = itemId?.startsWith('custom:') ? itemId.slice('custom:'.length) : undefined;
    const planes = await planeCandidates(context, featureList, session, featureId);
    const selected = (featureList.features || []).find((feature) => feature.featureId === featureId);
    sendJson(res, 200, {
      context,
      available: true,
      install,
      planes,
      selectedPlane: matchingPlaneCandidate(selected?.parameters?.find((entry) => entry.parameterId === 'plane'), planes),
      marker: FEATURE_MARKER,
      maxImageUploadBytes: config().maxImageUploadBytes
    });
    return true;
  }

  async function planeCandidates(context, featureList, session, beforeFeatureId) {
    return resolvePlaneCandidates(featureList,
      (script) => api.evaluateFeatureScript(context, script, session), { beforeFeatureId });
  }

  async function chosenPlane(context, featureList, planeId, session, beforeFeatureId) {
    if (typeof planeId !== 'string' || !planeId) throw httpError('Choose a plane.', 400, 'PLANE_REQUIRED');
    const planes = await planeCandidates(context, featureList, session, beforeFeatureId);
    const candidate = planes.find((entry) => entry.id === planeId);
    if (!candidate) throw httpError('That plane is no longer available. Refresh and choose a plane.', 409, 'PLANE_MISSING');
    if (candidate.unavailableReason || !candidate.query) {
      throw httpError(candidate.unavailableReason || 'This plane could not be resolved.', 409, 'PLANE_UNAVAILABLE');
    }
    return { candidate, parameter: candidate.kind === 'sketch' ? buildPlaneParameter(candidate) : structuredClone(candidate.query) };
  }

  /**
   * The dry run of /api/apply: the same normalization and the same solver,
   * with nothing written and no capability asked for.
   *
   * It sits beside apply rather than in the dispatcher because the two have to
   * agree. A preview that normalized a request even slightly differently would
   * show the operator one placement and store another, and nothing in the
   * product would notice.
   */
  async function handlePreview(req, res, url, session) {
    const body = await readJson(req);
    let item;
    let fallbackPlacement = body.currentPlacement;
    if (body.itemId) {
      const bodyContext = normalizeContext(body.context || url);
      // No code string: this refusal has always answered with the generic
      // ERROR the error mapper supplies, and the browser matches on the
      // sentence. Not CONTEXT_REQUIRED, which means the workspace gate.
      if (!bodyContext.complete) {
        throw httpError('A complete Onshape context is required for a selected feature.', 400);
      }
      ({ item } = await loadImageItem(bodyContext, body.itemId, session));
      fallbackPlacement = item.placement || fallbackPlacement;
    }
    const result = calibratePlacement(normalizeCalibration(body, fallbackPlacement));
    sendJson(res, 200, { item, ...result });
    return true;
  }

  /**
   * Write a solved placement onto the selected feature.
   *
   * The order below is the order the route has always run in — context, then
   * itemId, then capability, then confirmation — and it is load-bearing: a
   * request that is wrong in two ways has to keep naming the same one first.
   */
  async function handleApply(req, res, url, session) {
    const body = await readJson(req);
    const context = requireWorkspaceContext(normalizeContext(body.context || url));
    // Deliberately not ITEM_REQUIRED, which is what the other four writes send
    // here: this route has always answered with the generic ERROR code, and
    // changing it is a change to a published response, not a refactor.
    if (!body.itemId) throw httpError('itemId is required.', 400);

    // What the key is allowed to do, what the operator has allowed this server
    // to do, and an explicit confirmation — the same three the other four
    // writes ask for, since this write is no smaller than theirs.
    gate(session, 'updateFeature');
    requireConfirmation(body.confirm, 'Applying this calibration to Onshape');

    // The whole list, not just the target: nativeDuplicates below is computed
    // from the same read rather than from a second one.
    const { featureList, items } = await loadImageItems(context, session);
    const item = items.find((candidate) => candidate.id === body.itemId);
    if (!item) {
      throw httpError('The selected reference image no longer exists. Refresh the image list.', 409);
    }
    if (!item.editable) {
      const reason = item.kind === 'native' && !config().enableNativeImageWrite
        ? 'Native Insert image writes are disabled. Use the included calibrated FeatureScript or enable experimental native writes.'
        : 'The selected image is not editable in this context.';
      throw httpError(reason, 409);
    }
    if (!item.placement) {
      throw httpError(
        'The selected image placement could not be evaluated. Replace its placement expressions with literal values, then refresh.',
        409
      );
    }
    const calibration = calibratePlacement(normalizeCalibration(body, item.placement));
    const update = prepareImageFeatureUpdate(featureList, item, calibration.placement, {
      removeImageConstraints: body.removeImageConstraints !== false
    });
    const backupPath = await writeBackup({ context, item, featureList, payload: update.payload, calibration });

    const response = await withEvidence(session, 'updateFeature', () =>
      api.updateFeature(context, item.featureId, update.payload, session));
    // The one place this response is believed or disbelieved: HTTP 200 proves
    // nothing on its own (FINDINGS.md, E4) — a namespace or expression Onshape
    // could not resolve is stored and reported back with featureStatus ERROR.
    // The backup written above already holds the feature as it was.
    const status = readFeatureStatus(response);
    if (!status.ok) {
      throw httpError(
        `Onshape stored the new placement but reports the feature as ${status.status}. The previous feature is in the backup file named below.`,
        409,
        'FEATURE_STATUS_NOT_OK',
        { featureStatus: status.status, backupFile: path.basename(backupPath) }
      );
    }

    sendJson(res, 200, {
      ok: true,
      item,
      calibration,
      removedConstraintCount: update.removedConstraintCount,
      backupFile: path.basename(backupPath),
      featureState: response?.featureState,
      sourceMicroversion: response?.sourceMicroversion,
      // Advisory: native sketch images in this Part Studio that look like the
      // same picture. Computed here, from the list this route already read,
      // because the cross-reference is a pure function in src/ and a second
      // copy of it in the browser would be a second set of rules.
      nativeDuplicates: findDuplicateNativeImages({ items, targetId: item.id })
    });
    return true;
  }

  async function handleInstallPost(req, res, url, session) {
    const body = await readJson(req, { maxBytes: 8192 });
    gate(session, 'installFeature');
    requireConfirmation(body?.confirm, 'Installing the Reference Image feature');
    const context = requireWorkspaceContext(normalizeContext(body?.context || url));

    const before = await inspectDocument(context, session);
    // Idempotent by design: a second press, or two tabs racing, must not leave
    // two instances behind. The instance already there is the answer.
    if (before.install.state === 'instance-present') {
      sendJson(res, 200, {
        ok: true,
        alreadyInstalled: true,
        created: false,
        createdFeatureStudio: false,
        install: before.install,
        featureId: before.install.instances[0].featureId,
        itemId: `custom:${before.install.instances[0].featureId}`,
        featureStatus: null
      });
      return true;
    }

    // "We did not look" is not "it is not ours". A studio this key could not
    // open might be the one already installed, and creating a second copy over
    // it is worse than stopping and saying so.
    if (before.install.state === 'not-installed' && before.install.unreadStudioIds.length) {
      throw httpError(
        'This document has a Feature Studio this key could not open, so there is no way to tell whether the feature is already installed. Grant the key read access to the whole document, or add the feature by hand.',
        409,
        'FEATURE_STUDIO_UNREADABLE',
        { unreadStudioIds: before.install.unreadStudioIds }
      );
    }

    const imageElementId = String(body?.imageElementId || '');
    const chosen = before.install.imageElements.find((element) => element.id === imageElementId);
    if (!chosen || !chosen.bindable) {
      throw httpError(
        chosen
          ? 'That image tab has no microversion Onshape can bind to. Re-upload the image and try again.'
          : 'Choose which image tab the new feature should use, or upload the image you have loaded.',
        400,
        'IMAGE_REQUIRED',
        { candidates: before.install.imageElements }
      );
    }

    // Resolve a selected plane before creating any remote resources. Omitting
    // planeId preserves the already-proven legacy Top installation path.
    if (body.planeId !== undefined) await chosenPlane(context, before.featureList, body.planeId, session);

    let featureStudio = before.install.featureStudio;
    let createdFeatureStudio = false;
    if (!featureStudio) {
      const source = await readFeatureScriptSource();
      const created = await withEvidence(session, 'installFeature', async () => {
        const element = await api.createFeatureStudio(context, DEFAULT_FEATURE_STUDIO_NAME, session);
        await api.setFeatureStudioContents(context, element.id, source, session);
        return element;
      });
      createdFeatureStudio = true;
      // The create response carries the microversion from *before* the contents
      // were set, and the set-contents response carries none at all. The
      // element listing is the only place the current one appears, so it is
      // re-read rather than guessed.
      const elements = await api.listElements(context, session);
      featureStudio = listFeatureStudioElements(elements).find((studio) => studio.id === created.id);
      if (!featureStudio?.microversionId) {
        throw httpError(
          'The Feature Studio was created, but Onshape did not report a microversion for it. Refresh and try again.',
          502,
          'FEATURE_STUDIO_MICROVERSION_MISSING',
          { featureStudioId: created.id }
        );
      }
    }

    // Re-read the features immediately before the add: creating the Feature
    // Studio moved the document on, and sourceMicroversion has to be current.
    const featureList = await api.getFeatures(context, session);
    let feature = buildReferenceImageFeature({
      featureStudio,
      image: { elementId: chosen.id, microversionId: chosen.microversionId },
      // A label, not a payload: capped so a pasted document cannot become a
      // feature name.
      name: typeof body?.featureName === 'string' && body.featureName.trim()
        ? body.featureName.trim().slice(0, 120)
        : undefined
    });
    let plane;
    if (body.planeId !== undefined) {
      const selection = await chosenPlane(context, featureList, body.planeId, session);
      feature = replacePlaneParameter(feature, selection.parameter);
      plane = { id: selection.candidate.id, label: selection.candidate.label, kind: selection.candidate.kind };
    }
    const payload = featureAddPayload(featureList, feature);
    const response = await withEvidence(session, 'installFeature', () => api.addFeature(context, payload, session));
    const status = readFeatureStatus(response);
    if (!status.ok) {
      throw httpError(
        `Onshape accepted the request but reported the new feature as ${status.status}. Open the Part Studio and check the feature, then delete it and try again.`,
        409,
        'FEATURE_STATUS_NOT_OK',
        {
          featureStatus: status.status,
          featureId: status.featureId,
          featureStudioId: featureStudio.id,
          imageNamespace: feature.parameters[0].namespace
        }
      );
    }

    sendJson(res, 200, {
      ok: true,
      alreadyInstalled: false,
      created: true,
      createdFeatureStudio,
      featureId: status.featureId,
      itemId: status.featureId ? `custom:${status.featureId}` : undefined,
      featureStatus: status.status,
      featureStudio,
      imageElementId: chosen.id,
      imageNamespace: feature.parameters[0].namespace,
      ...(plane ? { plane } : {})
    });
    return true;
  }

  async function handleUploadImage(req, res, url, session) {
    gate(session, 'uploadImage');
    const contentType = String(req.headers['content-type'] || '');
    if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
      throw httpError('Send the image as multipart/form-data with a "file" part.', 415, 'UNSUPPORTED_MEDIA_TYPE');
    }
    const context = requireWorkspaceContext(normalizeContext(url));
    const maxBytes = config().maxImageUploadBytes;
    const limit = maxBytes + MULTIPART_OVERHEAD_BYTES;
    // Refuse on the declared length before reading a byte. A client that lies
    // about it still hits the streaming cap below; this only spares the honest
    // case from sending 30 MB to be told no.
    const declaredLength = Number(req.headers['content-length']);
    if (Number.isFinite(declaredLength) && declaredLength > limit) {
      throw httpError('The uploaded image is larger than this server accepts.', 413, 'IMAGE_TOO_LARGE');
    }
    const raw = await readCappedBody(req, limit);

    let form;
    try {
      form = await new Response(raw, { headers: { 'content-type': contentType } }).formData();
    } catch {
      throw httpError('The upload was not a readable multipart/form-data body.', 400, 'INVALID_MULTIPART');
    }

    // Confirmation travels as a form field so it is part of the same signed
    // body as the file, with the query string accepted as a fallback for
    // callers that find a field awkward.
    const confirmed = form.get('confirm') === 'true' || url.searchParams.get('confirm') === 'true';
    requireConfirmation(confirmed, 'Uploading an image to Onshape');

    const file = form.get('file');
    if (typeof file === 'string' || !file) {
      throw httpError('The upload had no "file" part.', 400, 'FILE_PART_MISSING');
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    // The bytes decide, not the part's Content-Type: that header is whatever
    // the client chose to send.
    const verdict = validateImageUpload({
      bytes,
      filename: form.get('filename') || file.name,
      declaredType: file.type || undefined,
      maxBytes
    });
    if (!verdict.ok) {
      throw httpError(verdict.message, verdict.code === 'IMAGE_TOO_LARGE' ? 413 : 400, verdict.code);
    }

    const element = await withEvidence(session, 'uploadImage', () => api.uploadImageBlob(context, {
      bytes,
      filename: verdict.filename,
      mediaType: verdict.mediaType
    }, session));

    let microversionId = element?.microversionId;
    if (!isOnshapeId(microversionId) && isOnshapeId(element?.id)) {
      // Defensive: the upload response carried one in every observed run, but a
      // namespace built from a missing microversion is stored without complaint
      // and then fails to resolve, so guessing is not an option.
      const elements = await api.listElements(context, session);
      microversionId = elementList(elements)
        .find((candidate) => candidate?.id === element.id)?.microversionId;
    }
    if (!isOnshapeId(element?.id) || !isOnshapeId(microversionId)) {
      throw httpError(
        'Onshape stored the image but did not report an id and microversion for it. Press Refresh and pick the tab by hand.',
        502,
        'UPLOAD_REFERENCE_MISSING'
      );
    }

    sendJson(res, 200, {
      ok: true,
      elementId: element.id,
      microversionId,
      name: element.name,
      dataType: element.dataType,
      mediaType: verdict.mediaType,
      byteLength: bytes.length,
      declaredTypeMismatch: verdict.declaredTypeMismatch,
      namespace: elementNamespace(element.id, microversionId)
    });
    return true;
  }

  async function handleRebind(req, res, url, session) {
    const body = await readJson(req, { maxBytes: 8192 });
    gate(session, 'rebindImage');
    requireConfirmation(body?.confirm, 'Pointing this feature at a different image');
    const context = requireWorkspaceContext(normalizeContext(body?.context || url));
    if (!body?.itemId) throw httpError('itemId is required.', 400, 'ITEM_REQUIRED');

    const { featureList, item } = await loadImageItem(context, body.itemId, session);
    if (item.kind !== 'custom') {
      throw httpError(
        'Only a Calibrated Reference Image feature can be pointed at a different image.',
        409,
        'ITEM_NOT_REBINDABLE'
      );
    }
    if (!item.editable) {
      throw httpError('That feature is read-only in the current context.', 409, 'ITEM_READ_ONLY');
    }

    const stored = (featureList?.features || []).find((candidate) => candidate.featureId === item.featureId);
    if (!stored) throw httpError('The feature was not found in the latest feature list.', 409, 'FEATURE_MISSING');

    // Checked here so a typo is a 400 the operator can read. elementNamespace
    // would throw too, but as a 500, and a malformed namespace is exactly the
    // input Onshape stores without complaint and then reports as ERROR.
    if (!isOnshapeId(body.elementId) || !isOnshapeId(body.microversionId)) {
      throw httpError(
        'elementId and microversionId must both be 24-character Onshape ids. Upload the image again to get a fresh pair.',
        400,
        'INVALID_IMAGE_REFERENCE'
      );
    }
    const { feature, namespace } = rebindImageNamespace(stored, {
      elementId: body.elementId,
      microversionId: body.microversionId
    });
    const payload = featureUpdatePayload(featureList, feature);
    const backupPath = await writeBackup({ context, item, featureList, payload, operation: 'rebind' });

    const response = await withEvidence(session, 'rebindImage', () =>
      api.updateFeature(context, item.featureId, payload, session));
    const status = readFeatureStatus(response);
    if (!status.ok) {
      throw httpError(
        `Onshape stored the new image reference but reports the feature as ${status.status}. The previous feature is in the backup file named below.`,
        409,
        'FEATURE_STATUS_NOT_OK',
        { featureStatus: status.status, namespace, backupFile: path.basename(backupPath) }
      );
    }

    // Re-read so the caller gets the placement and image metadata Onshape holds
    // now, rather than the pre-rebind copy it sent in. The write has already
    // succeeded at this point, so a failure here is a stale item to report, not
    // an error to raise: telling the caller the rebind failed when it did not
    // is the one answer that would make them do it twice.
    let refreshedItem = item;
    let stale = true;
    try {
      refreshedItem = (await loadImageItem(context, body.itemId, session)).item;
      stale = false;
    } catch {
      stale = true;
    }
    sendJson(res, 200, {
      ok: true,
      item: refreshedItem,
      itemStale: stale,
      namespace,
      featureStatus: status.status,
      backupFile: path.basename(backupPath)
    });
    return true;
  }

  /**
   * Hide, or unhide, a native sketch image that duplicates a calibrated one.
   *
   * The same order as the rebind route: gate, confirm, context, fresh read,
   * backup, write, featureStatus, re-read. Two things differ, and both are
   * deliberate.
   *
   * `item.editable` is *not* required. For a native item that flag means "this
   * server may rewrite the sketch's internal geometry serialization", which is
   * the experimental path and off by default. Suppression touches one
   * documented boolean on the feature and no geometry at all, so tying it to
   * that flag would make the offer dead for everyone who has not enabled an
   * unrelated experiment. The workspace check above is the access question,
   * and it still applies.
   *
   * A non-OK featureStatus is fatal for a suppress and only a warning for an
   * unsuppress: E5 unsuppressed a feature that was already broken and got
   * ERROR back for a fault that pre-dated the request. The flip is stored
   * either way, so reporting it as a failure would only make someone do it
   * twice.
   */
  async function handleSuppress(req, res, url, session) {
    const body = await readJson(req, { maxBytes: 8192 });
    gate(session, 'suppressFeature');
    const wanted = body?.suppressed;
    if (typeof wanted !== 'boolean') {
      throw httpError('suppressed must be true or false.', 400, 'SUPPRESSED_REQUIRED');
    }
    requireExplicitConfirmation(body?.confirm, wanted ? 'Suppressing a sketch' : 'Unsuppressing a sketch');
    const context = requireWorkspaceContext(normalizeContext(body?.context || url));
    if (!body?.itemId) throw httpError('itemId is required.', 400, 'ITEM_REQUIRED');

    const { featureList, item } = await loadImageItem(context, body.itemId, session);
    if (item.kind !== 'native') {
      throw httpError(
        'Only a native Insert image sketch can be suppressed from here. A Calibrated Reference Image feature is suppressed in Onshape’s own feature list.',
        409,
        'ITEM_NOT_SUPPRESSIBLE'
      );
    }

    const stored = (featureList?.features || []).find((candidate) => candidate.featureId === item.featureId);
    if (!stored) throw httpError('The sketch was not found in the latest feature list.', 409, 'FEATURE_MISSING');
    // featureUpdatePayload insists on all three, and a feature Onshape returned
    // without them is a document this route cannot round-trip safely — a 409
    // that says so beats a 500 from the builder.
    if (!stored.featureType || !stored.name) {
      throw httpError(
        'Onshape returned this sketch without a type or a name, so it cannot be written back unchanged. Suppress it in Onshape instead.',
        409,
        'FEATURE_NOT_ROUND_TRIPPABLE'
      );
    }

    // Already in the requested state: two tabs, or a double press. Answer with
    // the current list and write nothing, the same rule POST /api/install
    // follows for an instance that already exists. Nothing was written here,
    // so a failed refresh read is a stale list to report, not an error to
    // raise — the same reasoning the write path below applies to its own
    // re-read.
    if ((stored.suppressed === true) === wanted) {
      let items = [];
      let stale = true;
      try {
        items = (await loadImageItems(context, session)).items;
        stale = false;
      } catch {
        stale = true;
      }
      sendJson(res, 200, {
        ok: true,
        changed: false,
        suppressed: wanted,
        featureStatus: null,
        warning: null,
        backupFile: null,
        item: items.find((candidate) => candidate.id === body.itemId) || item,
        items,
        itemsStale: stale
      });
      return true;
    }

    const feature = setFeatureSuppressed(stored, wanted);
    const payload = featureUpdatePayload(featureList, feature);
    const backupPath = await writeBackup({
      context,
      item,
      featureList,
      payload,
      operation: wanted ? 'suppress' : 'unsuppress'
    });

    const response = await withEvidence(session, 'suppressFeature', () =>
      api.updateFeature(context, item.featureId, payload, session));
    const status = readFeatureStatus(response);
    if (!status.ok && wanted) {
      throw httpError(
        `Onshape stored the suppression but reports the sketch as ${status.status}. The sketch as it was is in the backup file named below.`,
        409,
        'FEATURE_STATUS_NOT_OK',
        { featureStatus: status.status, backupFile: path.basename(backupPath) }
      );
    }
    const warning = status.ok
      ? null
      : `The sketch is visible again, but Onshape reports it as ${status.status}. That is usually a fault the sketch already had before it was hidden — open it in Onshape to see.`;

    // Re-read so the caller gets the list Onshape holds now. The write has
    // already succeeded here, so a failure is a stale list to report, not an
    // error to raise.
    let items = [];
    let stale = true;
    try {
      items = (await loadImageItems(context, session)).items;
      stale = false;
    } catch {
      stale = true;
    }
    sendJson(res, 200, {
      ok: true,
      changed: true,
      suppressed: wanted,
      featureStatus: status.status,
      warning,
      backupFile: path.basename(backupPath),
      item: items.find((candidate) => candidate.id === body.itemId) || item,
      items,
      itemsStale: stale
    });
    return true;
  }

  async function handleReplane(req, res, url, session) {
    const body = await readJson(req, { maxBytes: 8192 });
    gate(session, 'installFeature');
    requireConfirmation(body?.confirm, 'Changing the image plane');
    const context = requireWorkspaceContext(normalizeContext(body?.context || url));
    if (!body?.itemId) throw httpError('itemId is required.', 400, 'ITEM_REQUIRED');
    const { featureList, item } = await loadImageItem(context, body.itemId, session);
    if (item.kind !== 'custom') throw httpError('Only a Calibrated Reference Image feature can change planes here.', 409, 'ITEM_NOT_REPLANABLE');
    const stored = (featureList.features || []).find((feature) => feature.featureId === item.featureId);
    if (!stored) throw httpError('The feature no longer exists. Refresh and try again.', 409, 'FEATURE_MISSING');
    const selection = await chosenPlane(context, featureList, body.planeId, session, item.featureId);
    const updated = replacePlaneParameter(stored, selection.parameter);
    const payload = featureUpdatePayload(featureList, updated);
    const backupPath = await writeBackup({ context, item, featureList, payload, operation: 'replane' });
    const response = await withEvidence(session, 'installFeature', () => api.updateFeature(context, item.featureId, payload, session));
    const status = readFeatureStatus(response);
    if (!status.ok) throw httpError(
      `Onshape stored the new plane but reports the feature as ${status.status}. The previous feature is in the backup file.`,
      409, 'FEATURE_STATUS_NOT_OK', { featureStatus: status.status, backupFile: path.basename(backupPath) });
    let items = [];
    let itemsStale = true;
    try { items = (await loadImageItems(context, session)).items; itemsStale = false; } catch { /* The write succeeded; refresh is separate. */ }
    sendJson(res, 200, {
      ok: true, featureStatus: status.status, backupFile: path.basename(backupPath),
      plane: { id: selection.candidate.id, label: selection.candidate.label, kind: selection.candidate.kind },
      item: items.find((entry) => entry.id === body.itemId) || item, items, itemsStale
    });
    return true;
  }

  function matchHandler(req, url) {
    if (req.method === 'GET' && url.pathname === '/api/install/status') return handleStatus;
    if (req.method === 'POST' && url.pathname === '/api/preview') return handlePreview;
    if (req.method === 'POST' && url.pathname === '/api/install') return handleInstallPost;
    if (req.method === 'POST' && url.pathname === '/api/upload-image') return handleUploadImage;
    if (req.method === 'POST' && url.pathname === '/api/apply') return handleApply;
    if (req.method === 'POST' && url.pathname === '/api/rebind') return handleRebind;
    if (req.method === 'POST' && url.pathname === '/api/replane') return handleReplane;
    if (req.method === 'POST' && url.pathname === '/api/suppress') return handleSuppress;
    return null;
  }

  async function handleWrite(req, res, url, session) {
    const handler = matchHandler(req, url);
    if (!handler) return false;
    // Matched first, so a request for some other route passing through here
    // spends nothing; then throttled, before the handler reads a byte of the
    // body. The one place any of these routes takes a token, and the bucket is
    // the registry's, not this module's.
    const refusal = routeRateLimitError(session, req.method, url.pathname);
    if (refusal) throw refusal;
    return handler(req, res, url, session);
  }

  return { handleWrite };
}
