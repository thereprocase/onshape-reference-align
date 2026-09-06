import {
  applyPlacementToNativeImageEntity,
  placementFromNativeImageEntity,
  validatePlacement
} from './geometry.mjs';
import {
  formatMetersForOnshape,
  formatRadiansForOnshape,
  quantityParameterToSi
} from './units.mjs';

const CUSTOM_PARAMETER_IDS = Object.freeze([
  'image',
  'plane',
  'imageWidth',
  'imageAngle',
  'originX',
  'originY'
]);

function clone(value) {
  return structuredClone(value);
}

function btTypeIncludes(value, fragment) {
  return typeof value === 'string' && value.includes(fragment);
}

export function parameterMap(feature) {
  const map = new Map();
  for (const parameter of feature?.parameters || []) {
    if (parameter?.parameterId) map.set(parameter.parameterId, parameter);
  }
  return map;
}

export function isReferenceImageFeature(feature) {
  if (!feature || !Array.isArray(feature.parameters)) return false;
  const params = parameterMap(feature);
  return CUSTOM_PARAMETER_IDS.every((id) => params.has(id));
}

function finiteOrUndefined(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function walkObjects(root, visitor, seen = new WeakSet()) {
  if (!root || typeof root !== 'object') return;
  if (seen.has(root)) return;
  seen.add(root);
  visitor(root);
  if (Array.isArray(root)) {
    for (const value of root) walkObjects(value, visitor, seen);
  } else {
    for (const value of Object.values(root)) walkObjects(value, visitor, seen);
  }
}

export function findImageMetadata(root) {
  let best;
  walkObjects(root, (object) => {
    const width = finiteOrUndefined(object.imageWidth ?? object.widthPx ?? object.pixelWidth);
    const height = finiteOrUndefined(object.imageHeight ?? object.heightPx ?? object.pixelHeight);
    if (width > 0 && height > 0) {
      const candidate = { width, height, aspectRatio: width / height };
      if (!best || width * height > best.width * best.height) best = candidate;
    }
  });
  return best;
}

function parseReferencePath(pathValue) {
  if (typeof pathValue !== 'string' || !pathValue.trim()) return undefined;
  const path = pathValue.trim();

  // Canonical API-ish forms: /documents/did/w/wid/e/eid or
  // /blobelements/d/did/v/vid/e/eid.
  const canonical = path.match(/(?:documents|blobelements)?\/?d\/([^/]+)\/(w|v|m)\/([^/]+)\/e\/([^/?#]+)/i);
  if (canonical) {
    const [, documentId, mode, modeId, elementId] = canonical;
    return {
      documentId,
      elementId,
      ...(mode === 'w' ? { workspaceId: modeId } : {}),
      ...(mode === 'v' ? { versionId: modeId } : {}),
      ...(mode === 'm' ? { microversionId: modeId } : {})
    };
  }

  // FeatureScript import paths are commonly encoded as did/wvm/wvmid/eid.
  const compact = path.replace(/^\/+/, '').split('/').filter(Boolean);
  if (compact.length >= 4 && ['w', 'v', 'm'].includes(compact[1])) {
    const [documentId, mode, modeId, elementId] = compact;
    return {
      documentId,
      elementId,
      ...(mode === 'w' ? { workspaceId: modeId } : {}),
      ...(mode === 'v' ? { versionId: modeId } : {}),
      ...(mode === 'm' ? { microversionId: modeId } : {})
    };
  }
  return undefined;
}

// Newer reference-image parameters pack the blob location into a single
// namespace string of "::"-separated segments, each prefixed with a one-letter
// type tag, e.g. "e<elementId>::m<microversionId>". The document segment is
// usually omitted because the blob lives in the same document as the feature.
function parseReferenceNamespace(namespaceValue) {
  if (typeof namespaceValue !== 'string' || !namespaceValue.trim()) return undefined;
  const keys = { d: 'documentId', w: 'workspaceId', v: 'versionId', m: 'microversionId', e: 'elementId' };
  const reference = {};
  for (const segment of namespaceValue.trim().split('::')) {
    const key = keys[segment[0]];
    const id = segment.slice(1);
    if (!key || !/^[0-9a-f]{24}$/i.test(id)) return undefined;
    reference[key] = id;
  }
  return reference.elementId ? reference : undefined;
}

function scoreBlobReference(reference) {
  let score = 0;
  if (reference.documentId) score += 3;
  if (reference.elementId) score += 5;
  if (reference.versionId || reference.workspaceId || reference.microversionId) score += 3;
  if (reference.mediaType?.startsWith?.('image/')) score += 4;
  return score;
}

/**
 * Fallback extraction of an image/blob reference from Onshape's serialized
 * feature format, for shapes that carry no namespace resolveImageBlob() can
 * parse directly. The exact internal shape can vary by API/FeatureScript
 * version, so this walks the whole object graph and scores candidates —
 * only resolveImageBlob() calls this, as a last resort.
 */
function walkForBlobReference(root, context) {
  let best;
  let bestScore = -1;

  walkObjects(root, (object) => {
    let candidate;
    const documentId = object.documentId || object.documentID || object.did;
    const elementId = object.elementId || object.elementID || object.eid;
    if (documentId && elementId) {
      candidate = {
        documentId: String(documentId),
        elementId: String(elementId),
        workspaceId: object.workspaceId || object.workspaceID || object.wid,
        versionId: object.versionId || object.documentVersionId || object.vid,
        microversionId: object.microversionId || object.mid,
        mediaType: object.mediaType || object.mimeType || object.contentType,
        filename: object.fileName || object.filename || object.name
      };
    }

    if (!candidate) {
      const pathReference = parseReferencePath(object.path || object.href || object.uri);
      if (pathReference) {
        candidate = {
          ...pathReference,
          mediaType: object.mediaType || object.mimeType || object.contentType,
          filename: object.fileName || object.filename || object.name
        };
      }
    }

    // A custom feature's own namespace points at its Feature Studio in the same
    // format, so only trust namespaces on image-typed parameters, or on the
    // blob-reference parameter a native sketch image entity carries its blob
    // on (BTMParameterBlobReference-1679, parameterId "blobInfo" — see
    // test/fixtures/native-sketch-image.mjs).
    if (!candidate && (btTypeIncludes(object.btType, 'Image') || btTypeIncludes(object.btType, 'BlobReference'))) {
      const namespaceReference = parseReferenceNamespace(object.namespace);
      if (namespaceReference && (namespaceReference.documentId || context.documentId)) {
        candidate = {
          documentId: context.documentId,
          ...namespaceReference,
          mediaType: object.mediaType || object.mimeType || object.contentType,
          filename: object.fileName || object.filename || object.name
        };
      }
    }

    if (!candidate) return;
    candidate = Object.fromEntries(Object.entries(candidate).filter(([, value]) => value !== undefined && value !== null && value !== ''));
    if (context.workspaceOrVersion === 'w' && context.workspaceOrVersionId) {
      candidate.fallbackWorkspaceId = context.workspaceOrVersionId;
    }
    const score = scoreBlobReference(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  });

  return best;
}

/**
 * Parse the "e<elementId>::m<microversionId>" namespace form directly off
 * `source`, the same way resolveImageBlob() and (before it) findBlobReference()
 * and imageBlobReference() separately did. Trusted only on image-typed
 * parameters or on the blob-reference parameter a native sketch image entity
 * carries its blob on (BTMParameterBlobReference-1679, parameterId
 * "blobInfo" — see test/fixtures/native-sketch-image.mjs), never on a custom
 * feature's own namespace, which points at its Feature Studio in the same
 * format.
 */
function namespaceBlobReference(source) {
  const namespaces = [];
  for (const parameter of source?.parameters || []) {
    if (btTypeIncludes(parameter?.btType, 'ReferenceImage') || btTypeIncludes(parameter?.btType, 'BlobReference')) {
      namespaces.push(parameter.namespace);
    }
  }
  if (btTypeIncludes(source?.btType, 'Image')) namespaces.push(source.namespace);

  for (const namespace of namespaces) {
    const parsed = parseReferenceNamespace(namespace);
    if (parsed?.elementId) return parsed;
  }
  return undefined;
}

/**
 * The one place that answers "where is this image's blob".
 *
 * findBlobReference() and imageBlobReference() used to answer that question by
 * different rules and disagreed once: the native BTMParameterBlobReference-1679
 * shape was reachable through the object walk and not through the namespace
 * parse, which is what kept proxyAvailable false for native sketch images
 * until the walker's btType test was widened. Now there is one rule: the
 * namespace parse first, because it is the authoritative form Onshape's
 * current serializations use, and the scored object walk only as a fallback
 * for older serializations that carry no namespace at all.
 *
 * Returns `{ reference, elementId, microversionId }`. `reference` is the full
 * shape onshape-api.mjs#downloadBlob() needs (documentId, elementId, and one
 * of workspaceId/versionId/microversionId), or undefined when nothing exposes
 * one — never a half-reference with an elementId but no documentId, since
 * that would fail the download silently instead of reporting
 * proxyAvailable: false. `elementId`/`microversionId` are the blob's own ids,
 * for cross-referencing two items as the same picture, and are populated
 * whenever they are known even if `reference` is not (a namespace missing a
 * documentId with no context.documentId to fall back on still names the blob).
 */
export function resolveImageBlob(source, context = {}) {
  const namespaceMatch = namespaceBlobReference(source);
  if (namespaceMatch) {
    const reference = Object.fromEntries(Object.entries({
      documentId: namespaceMatch.documentId || context.documentId,
      elementId: namespaceMatch.elementId,
      workspaceId: namespaceMatch.workspaceId,
      versionId: namespaceMatch.versionId,
      microversionId: namespaceMatch.microversionId
    }).filter(([, value]) => value !== undefined && value !== null && value !== ''));
    if (context.workspaceOrVersion === 'w' && context.workspaceOrVersionId) {
      reference.fallbackWorkspaceId = context.workspaceOrVersionId;
    }
    return {
      reference: reference.documentId ? reference : undefined,
      elementId: namespaceMatch.elementId,
      microversionId: namespaceMatch.microversionId
    };
  }

  const walked = walkForBlobReference(source, context);
  return {
    reference: walked,
    elementId: walked?.elementId,
    microversionId: walked?.microversionId
  };
}

function customPlacementFromFeature(feature) {
  const params = parameterMap(feature);
  const width = quantityParameterToSi(params.get('imageWidth'), 'length');
  const angle = quantityParameterToSi(params.get('imageAngle'), 'angle');
  const originX = quantityParameterToSi(params.get('originX'), 'length');
  const originY = quantityParameterToSi(params.get('originY'), 'length');
  if (![width, angle, originX, originY].every(Number.isFinite) || width <= 0) return undefined;
  return { width, angle, originX, originY };
}

function nativeImageEntities(feature) {
  if (!btTypeIncludes(feature?.btType, 'BTMSketch') && feature?.featureType !== 'newSketch') return [];
  return (feature.entities || []).filter((entity) =>
    btTypeIncludes(entity?.btType, 'BTMSketchImageEntity') ||
    (Number.isFinite(Number(entity?.originX)) && Number.isFinite(Number(entity?.xaxisX)) && 'aspectRatio' in entity)
  );
}

function describeImage(item, source) {
  const metadata = findImageMetadata(source);
  const blob = resolveImageBlob(source, item.context);
  return {
    widthPx: metadata?.width,
    heightPx: metadata?.height,
    aspectRatio: metadata?.aspectRatio ?? finiteOrUndefined(source?.aspectRatio),
    // The blob's own ids, parsed from the namespace rather than inferred from
    // the download reference: this is the one field that can say two items
    // show the same file.
    blobElementId: blob.elementId,
    blobMicroversionId: blob.microversionId,
    reference: blob.reference,
    proxyAvailable: Boolean(blob.reference)
  };
}

export function scanFeatureList(featureList, context = {}, { enableNativeImageWrite = false } = {}) {
  const items = [];
  for (const feature of featureList?.features || []) {
    if (isReferenceImageFeature(feature)) {
      const placement = customPlacementFromFeature(feature);
      const imageParameter = parameterMap(feature).get('image');
      const base = {
        id: `custom:${feature.featureId}`,
        kind: 'custom',
        featureId: feature.featureId,
        featureName: feature.name || 'Reference image',
        label: `${feature.name || 'Reference image'} · calibrated feature`,
        editable: context.workspaceOrVersion === 'w',
        // Onshape's own field, reported for every item so the UI can say a
        // target is hidden rather than leaving someone to wonder why the
        // document looks unchanged after a write.
        suppressed: feature.suppressed === true,
        context
      };
      items.push({
        ...base,
        placement,
        image: describeImage(base, imageParameter || feature),
        warnings: placement ? [] : ['The feature placement uses expressions this app could not evaluate. Replace them with literal values once, then refresh.']
      });
    }

    const imageEntities = nativeImageEntities(feature);
    // What else is in this sketch. Suppressing a sketch hides everything in
    // it, not only the image, so the count of entities that are not the image
    // is the difference between "hides a duplicate picture" and "hides the
    // curves an extrude is built on".
    const otherSketchEntityCount = Math.max(0, (feature.entities || []).length - imageEntities.length);
    for (const entity of imageEntities) {
      let placement;
      try {
        placement = placementFromNativeImageEntity(entity);
      } catch {
        placement = undefined;
      }
      const base = {
        id: `native:${feature.featureId}:${entity.entityId || entity.nodeId || 'image'}`,
        kind: 'native',
        featureId: feature.featureId,
        featureName: feature.name || 'Sketch',
        entityId: entity.entityId || entity.nodeId || 'image',
        label: `${feature.name || 'Sketch'} · native Insert image`,
        editable: Boolean(enableNativeImageWrite && context.workspaceOrVersion === 'w'),
        suppressed: feature.suppressed === true,
        otherSketchEntityCount,
        context
      };
      const image = describeImage(base, entity);
      if (!image.aspectRatio) image.aspectRatio = finiteOrUndefined(entity.aspectRatio);
      items.push({
        ...base,
        placement,
        image,
        warnings: [
          'Native sketch-image writes depend on Onshape internal feature serialization.',
          ...(enableNativeImageWrite ? [] : ['Native writes are disabled. Use the included calibrated FeatureScript for the supported path.'])
        ]
      });
    }
  }
  return items;
}

export function findImageItem(featureList, itemId, context = {}, options = {}) {
  const items = scanFeatureList(featureList, context, options);
  const item = items.find((candidate) => candidate.id === itemId);
  if (!item) throw new Error('The selected reference image no longer exists. Refresh the image list.');
  return item;
}

function setQuantityExpression(feature, parameterId, expression) {
  const parameter = (feature.parameters || []).find((candidate) => candidate?.parameterId === parameterId);
  if (!parameter) throw new Error(`Feature parameter ${parameterId} is missing.`);
  parameter.expression = expression;
  // Evaluated fields are output fields. Removing stale values avoids accidentally
  // sending a value that disagrees with the new expression.
  delete parameter.value;
  delete parameter.units;
}

export function applyPlacementToCustomFeature(feature, placement) {
  const target = validatePlacement(placement);
  const updated = clone(feature);
  setQuantityExpression(updated, 'imageWidth', formatMetersForOnshape(target.width));
  setQuantityExpression(updated, 'imageAngle', formatRadiansForOnshape(target.angle));
  setQuantityExpression(updated, 'originX', formatMetersForOnshape(target.originX));
  setQuantityExpression(updated, 'originY', formatMetersForOnshape(target.originY));
  return updated;
}

function entityReferenceIds(entity) {
  const ids = new Set();
  walkObjects(entity, (object) => {
    for (const [key, value] of Object.entries(object)) {
      if (typeof value === 'string' && /(entityId|nodeId|pointId|controlBoxId|imageId)$/i.test(key)) ids.add(value);
      if (Array.isArray(value) && /(ids|references)$/i.test(key)) {
        for (const member of value) if (typeof member === 'string') ids.add(member);
      }
    }
  });
  if (entity?.entityId) ids.add(entity.entityId);
  if (entity?.nodeId) ids.add(entity.nodeId);
  return ids;
}

function objectContainsExactString(root, candidates) {
  let found = false;
  walkObjects(root, (object) => {
    if (found) return;
    for (const value of Object.values(object)) {
      if (typeof value === 'string' && candidates.has(value)) {
        found = true;
        return;
      }
      if (Array.isArray(value) && value.some((member) => typeof member === 'string' && candidates.has(member))) {
        found = true;
        return;
      }
    }
  });
  return found;
}

export function applyPlacementToNativeSketchFeature(feature, entityId, placement, { removeImageConstraints = true } = {}) {
  const updated = clone(feature);
  const index = (updated.entities || []).findIndex((entity) =>
    (entity.entityId || entity.nodeId || 'image') === entityId
  );
  if (index < 0) throw new Error('Native image entity not found in sketch feature.');
  const oldEntity = updated.entities[index];
  updated.entities[index] = applyPlacementToNativeImageEntity(oldEntity, placement);

  let removedConstraintCount = 0;
  if (removeImageConstraints && Array.isArray(updated.constraints)) {
    const references = entityReferenceIds(oldEntity);
    const before = updated.constraints.length;
    updated.constraints = updated.constraints.filter((constraint) => !objectContainsExactString(constraint, references));
    removedConstraintCount = before - updated.constraints.length;
  }
  return { feature: updated, removedConstraintCount };
}

export function featureUpdatePayload(featureList, updatedFeature) {
  if (!updatedFeature?.featureId || !updatedFeature?.featureType || !updatedFeature?.name) {
    throw new Error('Updated feature must include featureId, featureType, and name.');
  }
  const payload = {
    btType: 'BTFeatureDefinitionCall-1406',
    feature: updatedFeature
  };
  for (const key of ['serializationVersion', 'sourceMicroversion', 'libraryVersion', 'rejectMicroversionSkew']) {
    if (featureList?.[key] !== undefined) payload[key] = featureList[key];
  }
  if (payload.rejectMicroversionSkew === undefined) payload.rejectMicroversionSkew = false;
  return payload;
}

export function prepareImageFeatureUpdate(featureList, item, placement, options = {}) {
  const feature = (featureList?.features || []).find((candidate) => candidate.featureId === item.featureId);
  if (!feature) throw new Error('Feature not found in the latest Part Studio feature list.');

  if (item.kind === 'custom') {
    const updatedFeature = applyPlacementToCustomFeature(feature, placement);
    return {
      payload: featureUpdatePayload(featureList, updatedFeature),
      updatedFeature,
      removedConstraintCount: 0
    };
  }

  if (item.kind === 'native') {
    const result = applyPlacementToNativeSketchFeature(feature, item.entityId, placement, options);
    return {
      payload: featureUpdatePayload(featureList, result.feature),
      updatedFeature: result.feature,
      removedConstraintCount: result.removedConstraintCount
    };
  }

  throw new Error(`Unsupported image item kind: ${item.kind}`);
}

// ---------------------------------------------------------------------------
// One-click install
//
// Everything below is pure: it turns an elements listing, some Feature Studio
// contents, and a feature list into a verdict and a request body. No network,
// no clock, no filesystem. The route layer does the I/O and calls these.
// ---------------------------------------------------------------------------

/**
 * The exact token that marks a Feature Studio as this app's own.
 *
 * An exact token rather than a source diff: an operator may legitimately edit
 * the studio (a comment, a bounds tweak) and it is still the studio we
 * installed, while a studio that merely looks similar is not. A token answers
 * that question; a diff only guesses at it. It lives in
 * featurescript/ReferenceImage.fs and there is a test pinning the two together.
 */
export const FEATURE_MARKER = 'reference-align-feature: 1';

/** The featureType Onshape assigns to the exported FeatureScript feature. */
export const REFERENCE_IMAGE_FEATURE_TYPE = 'referenceImage';

/** The name a newly created Feature Studio is given (matches the experiment). */
export const DEFAULT_FEATURE_STUDIO_NAME = 'Reference Align Features';

/** The name a newly added feature instance is given. */
export const DEFAULT_FEATURE_NAME = 'Calibrated Reference Image 1';

/**
 * The default placement of a freshly added instance, in SI units.
 *
 * 0.25 m matches IMAGE_WIDTH_BOUNDS' own default in the FeatureScript, so the
 * feature regenerates at the size Onshape's own dialog would have used. The
 * calibration write replaces all four the moment the operator presses Apply.
 */
export const DEFAULT_PLACEMENT = Object.freeze({ width: 0.25, angle: 0, originX: 0, originY: 0 });

/**
 * The Top plane, as a query Onshape accepted.
 *
 * This is the captured BTMParameterQueryList-148 from
 * docs/experiments/2026-09-04-bind-experiment/15-e3-add-feature-a.json. The
 * deterministic id "JDC" was identical in two different documents, which is
 * what makes a constant defensible here — but it is still an observation, not
 * a documented guarantee, so the install route checks
 * featureState.featureStatus on the response rather than assuming the plane
 * resolved.
 */
export const TOP_PLANE_PARAMETER = Object.freeze({
  btType: 'BTMParameterQueryList-148',
  queries: Object.freeze([Object.freeze({
    btType: 'BTMIndividualQuery-138',
    queryStatement: null,
    queryString: 'query=qCompressed(1.0,"%B5$QueryM4Sa$entityTypeBa$EntityTypeS4$FACESb$historyTypeS8$CREATIONSb$operationIdB2$IdA1S3.7$TopplaneOpS9$queryTypeS5$DUMMY",id);',
    deterministicIds: Object.freeze(['JDC'])
  })]),
  filter: Object.freeze({
    btType: 'BTAndFilter-110',
    operand1: Object.freeze({ btType: 'BTEntityTypeFilter-124', entityType: 'FACE' }),
    operand2: Object.freeze({ btType: 'BTGeometryFilter-130', geometryType: 'PLANE' })
  }),
  parameterId: 'plane'
});

const ONSHAPE_ID_PATTERN = /^[0-9a-f]{24}$/i;

export function isOnshapeId(value) {
  return ONSHAPE_ID_PATTERN.test(String(value ?? ''));
}

function requireOnshapeId(value, name) {
  const text = String(value ?? '');
  if (!ONSHAPE_ID_PATTERN.test(text)) throw new Error(`${name} must be a 24-character Onshape id.`);
  return text;
}

/**
 * Build the "e<elementId>::m<microversionId>" namespace an image or Feature
 * Studio parameter needs.
 *
 * Both ids are validated because Onshape stores whatever string it is given
 * without checking it: E4 in the experiment proved that a bare "e<id>" and a
 * full "d::w::e::m" are both accepted with HTTP 200 and then leave the feature
 * in featureStatus ERROR. A malformed namespace has to fail here, where the
 * message can say so, rather than three steps later as a broken feature in
 * someone else's document.
 */
export function elementNamespace(elementId, microversionId) {
  return `e${requireOnshapeId(elementId, 'elementId')}::m${requireOnshapeId(microversionId, 'microversionId')}`;
}

/**
 * Normalize a document's element listing to an array.
 *
 * The one observed shape of GET .../elements is a bare array, but other
 * Onshape list endpoints wrap their results as { items: [...] }, and nothing
 * documents that this one never will. Every reader of the listing goes
 * through here so a caller cannot assume the array shape while another
 * silently sees an empty list.
 */
export function elementList(elements) {
  if (Array.isArray(elements)) return elements;
  if (Array.isArray(elements?.items)) return elements.items;
  return [];
}

/**
 * The image blobs in a document, in listing order.
 *
 * dataType, not the filename extension: the extension is whatever the uploader
 * typed, while dataType is what Onshape decided the bytes are. An element
 * missing a usable microversion is still listed, with bindable false, so the
 * UI can show it and say why it cannot be chosen rather than hiding it.
 */
export function listImageBlobElements(elements) {
  return elementList(elements)
    .filter((element) => element?.elementType === 'BLOB' && String(element?.dataType || '').startsWith('image/'))
    .map((element) => ({
      id: element.id,
      name: element.name,
      dataType: element.dataType,
      microversionId: element.microversionId || undefined,
      bindable: isOnshapeId(element.id) && isOnshapeId(element.microversionId)
    }));
}

/** The Feature Studios in a document, in listing order. */
export function listFeatureStudioElements(elements) {
  return elementList(elements)
    .filter((element) => element?.elementType === 'FEATURESTUDIO')
    .map((element) => ({ id: element.id, name: element.name, microversionId: element.microversionId || undefined }));
}

function contentsFor(studioContents, elementId) {
  if (!studioContents) return undefined;
  if (typeof studioContents.get === 'function') return studioContents.get(elementId);
  return studioContents[elementId];
}

/** True when a Feature Studio's source carries this app's version marker. */
export function contentsCarryMarker(contents) {
  return typeof contents === 'string' && contents.includes(FEATURE_MARKER);
}

/**
 * Classify a document as not-installed / studio-present / instance-present.
 *
 * `studioContents` maps a Feature Studio element id to its fetched source; a
 * studio whose contents were not fetched is reported in `unreadStudioIds`
 * rather than being assumed to be someone else's, because "we did not look"
 * and "we looked and it is not ours" are different facts and only one of them
 * justifies creating a second studio.
 *
 * An instance found with no marked studio is still instance-present: an
 * operator who installed the FeatureScript by hand before this route existed
 * has a working document, and offering to install a second copy over it would
 * be wrong.
 */
export function classifyInstall({ elements, studioContents, featureList } = {}) {
  const studios = listFeatureStudioElements(elements);
  const marked = [];
  const unreadStudioIds = [];
  for (const studio of studios) {
    const contents = contentsFor(studioContents, studio.id);
    if (contents === undefined) unreadStudioIds.push(studio.id);
    else if (contentsCarryMarker(contents)) marked.push(studio);
  }

  const instances = (featureList?.features || [])
    .filter((feature) => feature?.featureType === REFERENCE_IMAGE_FEATURE_TYPE && isReferenceImageFeature(feature))
    .map((feature) => ({
      featureId: feature.featureId,
      name: feature.name,
      namespace: feature.namespace,
      suppressed: feature.suppressed === true
    }));

  const featureStudio = marked[0] || null;
  let state = 'not-installed';
  if (instances.length) state = 'instance-present';
  else if (featureStudio) state = 'studio-present';

  return {
    state,
    featureStudio,
    // Every marked studio, not only the first: two copies is a real state and
    // the operator is the one who has to decide which to keep.
    markedStudioIds: marked.map((studio) => studio.id),
    unreadStudioIds,
    instances,
    imageElements: listImageBlobElements(elements)
  };
}

function quantityParameter(parameterId, expression) {
  // Key order matches the accepted request in 15-e3-add-feature-a.json. Onshape
  // does not require it, but a byte-comparison test against the capture is only
  // meaningful if the builder reproduces the shape that was actually accepted.
  return {
    btType: 'BTMParameterQuantity-147',
    isInteger: false,
    value: 0,
    units: '',
    expression,
    parameterId
  };
}

/**
 * The BTMParameterReferenceImage-2014 that binds a feature to an image blob.
 *
 * The namespace uses the blob's own microversion. Not the document's current
 * microversion, and not a workspace-qualified form: E4 established that both
 * are stored without complaint and then fail to resolve.
 */
export function referenceImageParameter({ elementId, microversionId } = {}) {
  return {
    btType: 'BTMParameterReferenceImage-2014',
    namespace: elementNamespace(elementId, microversionId),
    parameterId: 'image',
    elementLibraryData: null
  };
}

/**
 * Build the BTMFeature-134 for a new Calibrated Reference Image instance.
 *
 * The plane is the captured Top-plane constant: a new instance has to land
 * somewhere, and the operator re-picks the plane in Onshape if they want a
 * different one. Placement defaults are SI and are formatted through the same
 * two functions the calibration write uses, so an installed feature and a
 * calibrated one never disagree about how a number becomes an expression.
 */
export function buildReferenceImageFeature({ featureStudio, image, name = DEFAULT_FEATURE_NAME, placement } = {}) {
  // Take the validated copy, not the merged input: validatePlacement coerces
  // every field to a finite number, and the expressions below must be built
  // from the same values the calibration write would use.
  const target = validatePlacement({ ...DEFAULT_PLACEMENT, ...(placement || {}) });
  return {
    btType: 'BTMFeature-134',
    featureType: REFERENCE_IMAGE_FEATURE_TYPE,
    name: String(name || DEFAULT_FEATURE_NAME),
    namespace: elementNamespace(featureStudio?.id, featureStudio?.microversionId),
    parameters: [
      referenceImageParameter({ elementId: image?.elementId ?? image?.id, microversionId: image?.microversionId }),
      structuredClone(TOP_PLANE_PARAMETER),
      quantityParameter('imageWidth', formatMetersForOnshape(target.width)),
      quantityParameter('imageAngle', formatRadiansForOnshape(target.angle)),
      quantityParameter('originX', formatMetersForOnshape(target.originX)),
      quantityParameter('originY', formatMetersForOnshape(target.originY))
    ]
  };
}

/**
 * Wrap a brand-new feature in the BTFeatureDefinitionCall-1406 envelope.
 *
 * Separate from featureUpdatePayload only because that one insists on a
 * featureId, which a feature that does not exist yet cannot have. The envelope
 * fields come from the feature list read immediately before the call, which is
 * what makes sourceMicroversion current.
 */
export function featureAddPayload(featureList, feature) {
  if (!feature?.featureType || !feature?.name) {
    throw new Error('A new feature must include featureType and name.');
  }
  const payload = { btType: 'BTFeatureDefinitionCall-1406', feature };
  for (const key of ['serializationVersion', 'sourceMicroversion', 'libraryVersion', 'rejectMicroversionSkew']) {
    if (featureList?.[key] !== undefined) payload[key] = featureList[key];
  }
  if (payload.rejectMicroversionSkew === undefined) payload.rejectMicroversionSkew = false;
  return payload;
}

/**
 * Return a copy of a stored feature with only its image parameter's namespace
 * replaced. Everything else — nodeIds, the plane query, the calibrated
 * quantities, the suppressed flag — is posted back exactly as Onshape stored
 * it, because this operation is a rebind and nothing else.
 */
export function rebindImageNamespace(feature, { elementId, microversionId } = {}) {
  const namespace = elementNamespace(elementId, microversionId);
  const updated = clone(feature);
  const parameter = (updated.parameters || []).find((candidate) => candidate?.parameterId === 'image');
  if (!parameter) throw new Error('The selected feature has no image parameter to rebind.');
  parameter.namespace = namespace;
  return { feature: updated, namespace };
}

/**
 * The one place a write response is believed or disbelieved.
 *
 * HTTP 200 proves nothing here: E4 got 200 with featureStatus ERROR for a
 * namespace Onshape stored but could not resolve. Callers pass the response of
 * any feature add or update and act on `ok`.
 */
export function readFeatureStatus(response) {
  const status = response?.featureState?.featureStatus;
  return {
    ok: status === 'OK',
    status: typeof status === 'string' ? status : 'UNKNOWN',
    featureId: response?.feature?.featureId,
    inactive: response?.featureState?.inactive === true
  };
}

// ---------------------------------------------------------------------------
// Native duplicates and suppression
//
// A document that already had an "Insert image" sketch, and then had this
// app's calibrated feature added, shows the same picture twice. Onshape's
// answer to that is to suppress one of them. Everything below is pure: the
// cross-reference is advisory and never decides anything on its own, and the
// suppression helper only flips one boolean.
// ---------------------------------------------------------------------------

/**
 * How far two aspect ratios may differ and still count as the same image.
 *
 * Relative, not absolute, because the numbers are ratios: 1% covers the
 * rounding in a serialized float and the odd off-by-one in a resized export,
 * and is far tighter than the gap between two genuinely different photographs.
 * A match on this alone is only ever labelled "likely".
 */
export const DUPLICATE_ASPECT_TOLERANCE = 0.01;

/** Ordering for the confidence labels, strongest first. */
const CONFIDENCE_RANK = Object.freeze({ exact: 0, likely: 1, possible: 2 });

function positiveOrUndefined(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

/**
 * Which native sketch images plausibly show the same picture as `targetId`.
 *
 * Advisory only. The result decides nothing: it is offered to a person, who
 * confirms or does not. Three verdicts, and the difference between them is
 * what evidence exists, never how strongly anything is believed:
 *
 *  - `exact`    — both items name the same blob element. Same file, certainly.
 *  - `likely`   — no blob id on one side, but the aspect ratios agree.
 *  - `possible` — neither comparison could be made at all.
 *
 * A candidate is left out only on positive evidence against it: a different
 * blob element, or aspect ratios that disagree. Absence of a field is not
 * evidence, which is why "possible" exists instead of a silent drop.
 *
 * `sameBlobMicroversion` is reported but never used to exclude: a rebind moves
 * the microversion on and the picture is still the same picture.
 *
 * ASSUMPTION: a native entity's `aspectRatio` is width/height, the same
 * convention validateImageSize() uses for pixel dimensions. That is what
 * scanFeatureList already assumes when it reads the field, and it is not
 * documented by Onshape. If it is the other way round, the aspect comparison
 * silently declines to offer a duplicate. It cannot cause a wrong write: the
 * offer names the sketch and the write is confirmed.
 */
export function findDuplicateNativeImages({ items, targetId, aspectTolerance = DUPLICATE_ASPECT_TOLERANCE } = {}) {
  const list = Array.isArray(items) ? items : [];
  const target = list.find((item) => item.id === targetId);
  if (!target || target.kind !== 'custom') return [];

  const targetBlob = target.image?.blobElementId;
  const targetAspect = positiveOrUndefined(target.image?.aspectRatio);

  const matches = [];
  for (const candidate of list) {
    if (candidate.kind !== 'native') continue;
    const candidateBlob = candidate.image?.blobElementId;
    const candidateAspect = positiveOrUndefined(candidate.image?.aspectRatio);

    let confidence;
    let basis;
    if (targetBlob && candidateBlob) {
      if (targetBlob !== candidateBlob) continue;
      confidence = 'exact';
      basis = 'blob-element';
    } else if (targetAspect && candidateAspect) {
      const difference = Math.abs(targetAspect - candidateAspect) / Math.max(targetAspect, candidateAspect);
      if (difference > aspectTolerance) continue;
      confidence = 'likely';
      basis = 'aspect-ratio';
    } else {
      confidence = 'possible';
      basis = 'none';
    }

    matches.push({
      itemId: candidate.id,
      featureId: candidate.featureId,
      featureName: candidate.featureName,
      entityId: candidate.entityId,
      confidence,
      basis,
      suppressed: candidate.suppressed === true,
      // Not a reason to exclude, and not a detail the UI can leave out either:
      // suppressing a sketch hides whatever else is in it.
      otherSketchEntityCount: candidate.otherSketchEntityCount ?? 0,
      sameBlobMicroversion: Boolean(
        targetBlob && candidateBlob && target.image?.blobMicroversionId === candidate.image?.blobMicroversionId
      ),
      aspectRatio: candidateAspect
    });
  }

  return matches.sort((a, b) => CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence]);
}

/**
 * Return a copy of a stored feature with only `suppressed` changed.
 *
 * E5 of the write-shape experiment established the field name and that posting
 * the whole feature back with it flipped round-trips
 * (docs/experiments/2026-09-04-bind-experiment/27-e5-suppressed-true.json).
 * Everything else — nodeIds, entities, constraints, parameters — goes back
 * exactly as Onshape stored it, because this operation is a suppression and
 * nothing else.
 */
export function setFeatureSuppressed(feature, suppressed) {
  if (typeof suppressed !== 'boolean') throw new Error('suppressed must be true or false.');
  if (!feature?.featureId) throw new Error('The feature to suppress must have a featureId.');
  const updated = clone(feature);
  updated.suppressed = suppressed;
  return updated;
}
