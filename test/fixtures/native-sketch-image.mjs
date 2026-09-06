// A native "Insert image" sketch, in the shape Onshape actually serializes.
//
// There is no capture of one under docs/experiments/ — the experiment document
// never held a native image — so the structure here is copied field for field
// from a local backup of a real Part Studio (an /api/apply backup written by
// this app on 2026-09-04), with two changes made on purpose:
//
//  1. The document's own element and microversion ids are replaced with the
//     experiment document's blob ids, so this fixture composes with
//     install-elements.mjs and nothing here points at a private document.
//  2. The sketch's non-image entities are reduced to their btType and
//     entityId. Only their presence and their count matter to the code under
//     test, and a stranger's sketch geometry does not belong in a fixture.
//
// The parts that are load-bearing are verbatim: BTMSketchImageEntity-763
// carries its blob reference on a BTMParameterBlobReference-1679 child
// parameter (parameterId "blobInfo"), not on the entity's own namespace, which
// is the empty string. A cross-reference that only looked at the entity would
// find nothing.
//
// There is no xaxisX or xaxisY here on purpose: the backup this fixture is
// copied from does not have them, and neither does the entity Onshape
// returned in the later docs/experiments/2026-09-05-suppress-verify/ capture
// (03-create-native-sketch.json, 04-cross-reference.json). That is real
// evidence against src/geometry.mjs's placementFromNativeImageEntity(), which
// reads those two fields to derive width and angle — see "Experimental
// native-image write" in docs/ARCHITECTURE.md. Do not add xaxisX/xaxisY here
// to make a test pass; that would hide the gap instead of fixing it.

/** The first image blob of the experiment document (07-elements-after-upload.json). */
export const BLOB_A = Object.freeze({
  elementId: 'a11ce0000000000000000120',
  microversionId: 'a11ce0000000000000000010'
});

/** The second one, which the E5 feature list is bound to. */
export const BLOB_B = Object.freeze({
  elementId: 'a11ce0000000000000000026',
  microversionId: 'a11ce0000000000000000125'
});

export function nativeImageEntity({
  entityId = 'KsOMMVzbDE6a',
  aspectRatio = 0.75,
  blob = BLOB_A
} = {}) {
  return {
    btType: 'BTMSketchImageEntity-763',
    aspectRatio,
    isConstruction: false,
    isFromSplineHandle: false,
    isFromSplineControlPolygon: false,
    isFromEndpointSplineHandle: false,
    originX: -0.1345094024216632,
    originY: -0.10085854022238962,
    namespace: '',
    name: '',
    index: 1,
    parameters: blob
      ? [{
          btType: 'BTMParameterBlobReference-1679',
          namespace: `e${blob.elementId}::m${blob.microversionId}`,
          nodeId: 'MbXmHlUu5iAt8oqd/',
          blobImport: null,
          libraryRelationType: 'DEFAULT',
          elementLibraryData: null,
          parameterId: 'blobInfo',
          parameterName: ''
        }]
      : [],
    nodeId: 'MKxHkB+ANz0LTOBez',
    entityId
  };
}

/**
 * A sketch holding one image and some other geometry.
 *
 * The "other geometry" is the point of the default: in the document this shape
 * came from, the sketch that carried the reference image also carried the
 * curves that a downstream extrude consumes. Suppressing that sketch hides all
 * of it, which is why the offer has to say so.
 */
export function nativeSketchFeature({
  featureId = 'FSketchOne_0',
  name = 'Sketch 1',
  suppressed = false,
  otherEntities = 4,
  entity = nativeImageEntity()
} = {}) {
  const extras = [];
  for (let index = 0; index < otherEntities; index += 1) {
    extras.push({
      btType: index % 2 === 0 ? 'BTMSketchCurveSegment-155' : 'BTMSketchPoint-158',
      entityId: `trimmed-${index}`
    });
  }
  return {
    btType: 'BTMSketch-151',
    featureType: 'newSketch',
    featureId,
    name,
    suppressed,
    parameters: [],
    entities: [entity, ...extras],
    constraints: []
  };
}
