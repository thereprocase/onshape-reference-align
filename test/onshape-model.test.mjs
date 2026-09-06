import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyPlacementToCustomFeature,
  applyPlacementToNativeSketchFeature,
  featureUpdatePayload,
  findDuplicateNativeImages,
  findImageMetadata,
  isReferenceImageFeature,
  resolveImageBlob,
  scanFeatureList,
  setFeatureSuppressed
} from '../src/onshape-model.mjs';
import { BLOB_A, BLOB_B, nativeImageEntity, nativeSketchFeature } from './fixtures/native-sketch-image.mjs';
import { FEATURE_LIST_BEFORE_SUPPRESS, SUPPRESS_TRUE_REQUEST } from './fixtures/suppress-feature.mjs';

function quantity(parameterId, expression, value) {
  return {
    btType: 'BTMParameterQuantity-147',
    parameterId,
    expression,
    value
  };
}

function customFeature() {
  return {
    btType: 'BTMFeature-134',
    featureId: 'feature-custom',
    featureType: 'referenceImage',
    name: 'Elevation photo',
    parameters: [
      {
        btType: 'BTMParameterImage-1',
        parameterId: 'image',
        imageWidth: 4032,
        imageHeight: 3024,
        value: {
          documentId: 'blob-doc',
          versionId: 'blob-version',
          elementId: 'blob-element',
          mediaType: 'image/jpeg'
        }
      },
      { btType: 'BTMParameterQueryList-148', parameterId: 'plane', queries: [] },
      quantity('imageWidth', '10 in', 0.254),
      quantity('imageAngle', '15 deg', Math.PI / 12),
      quantity('originX', '-2 in', -0.0508),
      quantity('originY', '1 in', 0.0254)
    ]
  };
}

test('recognizes and scans the calibrated custom image feature', () => {
  const feature = customFeature();
  assert.equal(isReferenceImageFeature(feature), true);

  const context = {
    workspaceOrVersion: 'w',
    workspaceOrVersionId: 'workspace',
    documentId: 'doc',
    elementId: 'part-studio'
  };
  const items = scanFeatureList({ features: [feature] }, context);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'custom');
  assert.equal(items[0].editable, true);
  assert.equal(items[0].placement.width, 0.254);
  assert.equal(items[0].image.widthPx, 4032);
  assert.equal(items[0].image.heightPx, 3024);
  assert.equal(items[0].image.reference.elementId, 'blob-element');
});

test('reports an unreadable placement rather than a fictional one when a quantity is expression-driven', () => {
  // Regression for the sauron-1 war-council finding: a variable- or
  // arithmetic-driven quantity parameter must not fall back to `value`
  // (which Onshape's serialization echoes as 0 regardless of the real
  // expression — see docs/experiments/2026-09-04-bind-experiment/). Getting
  // this wrong means scanFeatureList reports a placement with a wrong
  // origin and no warning, and Apply is left enabled.
  const feature = customFeature();
  feature.parameters = feature.parameters.map((parameter) =>
    parameter.parameterId === 'originX'
      ? { ...parameter, expression: '#plateOffset', value: 0 }
      : parameter
  );
  const items = scanFeatureList({ features: [feature] }, {
    workspaceOrVersion: 'w',
    workspaceOrVersionId: 'workspace',
    documentId: 'doc',
    elementId: 'part-studio'
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].placement, undefined);
});

test('updates only the custom placement expressions', () => {
  const feature = customFeature();
  const updated = applyPlacementToCustomFeature(feature, {
    originX: 1.1,
    originY: -2.2,
    width: 3.3,
    angle: Math.PI / 2
  });
  const map = new Map(updated.parameters.map((parameter) => [parameter.parameterId, parameter]));
  assert.equal(map.get('originX').expression, '1.1 m');
  assert.equal(map.get('originY').expression, '-2.2 m');
  assert.equal(map.get('imageWidth').expression, '3.3 m');
  assert.equal(map.get('imageAngle').expression, '90 deg');
  assert.equal(map.get('image').imageWidth, 4032);
  assert.notStrictEqual(updated, feature);
  assert.equal(feature.parameters.find((p) => p.parameterId === 'imageWidth').expression, '10 in');
});

test('updates a native image entity and removes only constraints that reference it', () => {
  const feature = {
    btType: 'BTMSketch-151',
    featureId: 'sketch-1',
    featureType: 'newSketch',
    name: 'Sketch 1',
    parameters: [],
    entities: [
      {
        btType: 'BTMSketchImageEntity-1',
        entityId: 'image-1',
        originX: 0,
        originY: 0,
        xaxisX: 1,
        xaxisY: 0,
        aspectRatio: 2
      },
      { btType: 'BTMSketchCurve-4', entityId: 'line-1' }
    ],
    constraints: [
      { btType: 'BTMSketchConstraint-2', firstEntityId: 'image-1', value: 1 },
      { btType: 'BTMSketchConstraint-2', firstEntityId: 'line-1', value: 2 }
    ]
  };

  const result = applyPlacementToNativeSketchFeature(feature, 'image-1', {
    originX: 5,
    originY: 6,
    width: 2,
    angle: Math.PI
  });
  assert.equal(result.removedConstraintCount, 1);
  assert.equal(result.feature.constraints.length, 1);
  assert.equal(result.feature.constraints[0].firstEntityId, 'line-1');
  assert.ok(Math.abs(result.feature.entities[0].xaxisX + 2) < 1e-12);
  assert.ok(Math.abs(result.feature.entities[0].xaxisY) < 1e-12);
});

test('builds an official-style feature update call', () => {
  const feature = customFeature();
  const payload = featureUpdatePayload({
    serializationVersion: '1.2.4',
    sourceMicroversion: 'm123',
    libraryVersion: 42
  }, feature);
  assert.equal(payload.btType, 'BTFeatureDefinitionCall-1406');
  assert.equal(payload.feature.featureId, 'feature-custom');
  assert.equal(payload.serializationVersion, '1.2.4');
  assert.equal(payload.rejectMicroversionSkew, false);
});

test('extracts image metadata and blob references from nested serialization', () => {
  const source = {
    nested: {
      imageWidth: 6000,
      imageHeight: 4000,
      image: {
        path: '/blobelements/d/abc/v/def/e/ghi',
        mimeType: 'image/png'
      }
    }
  };
  assert.deepEqual(findImageMetadata(source), { width: 6000, height: 4000, aspectRatio: 1.5 });
  assert.deepEqual(resolveImageBlob(source).reference, {
    documentId: 'abc',
    elementId: 'ghi',
    versionId: 'def',
    mediaType: 'image/png'
  });
});

test('parses the namespace form of a reference-image parameter', () => {
  // Captured from a live v17 feature list: the parameter carries no
  // documentId/elementId keys, only a tagged namespace string.
  const feature = customFeature();
  feature.parameters[0] = {
    btType: 'BTMParameterReferenceImage-2014',
    parameterId: 'image',
    namespace: 'ea11ce0000000000000000161::ma11ce0000000000000000159',
    elementLibraryData: null
  };
  const context = {
    workspaceOrVersion: 'w',
    workspaceOrVersionId: 'a11ce0000000000000000160',
    documentId: 'a11ce0000000000000000143',
    elementId: 'part-studio'
  };
  const items = scanFeatureList({ features: [feature] }, context);
  assert.equal(items.length, 1);
  assert.equal(items[0].image.proxyAvailable, true);
  assert.deepEqual(items[0].image.reference, {
    documentId: 'a11ce0000000000000000143',
    elementId: 'a11ce0000000000000000161',
    microversionId: 'a11ce0000000000000000159',
    fallbackWorkspaceId: 'a11ce0000000000000000160'
  });
});

test('ignores the namespace on the feature itself, which points at its Feature Studio', () => {
  const feature = customFeature();
  feature.parameters[0] = { btType: 'BTMParameterReferenceImage-2014', parameterId: 'image' };
  feature.namespace = 'd0123456789abcdef01234567::w0123456789abcdef01234567::e0123456789abcdef01234567::m0123456789abcdef01234567';
  const context = { workspaceOrVersion: 'w', workspaceOrVersionId: 'ws', documentId: 'doc', elementId: 'ps' };
  const items = scanFeatureList({ features: [feature] }, context);
  assert.equal(items.length, 1);
  assert.equal(items[0].image.proxyAvailable, false);
  assert.equal(items[0].image.reference, undefined);
});

// ---------------------------------------------------------------------------
// Native duplicates and suppression
// ---------------------------------------------------------------------------

const DUPLICATE_CONTEXT = Object.freeze({
  workspaceOrVersion: 'w',
  workspaceOrVersionId: 'a11ce0000000000000000052',
  documentId: 'a11ce0000000000000000039',
  elementId: 'a11ce0000000000000000027'
});

// The calibrated feature Onshape actually stored in the experiment document.
// Its image parameter is bound to BLOB_B.
function calibratedFeature() {
  return structuredClone(FEATURE_LIST_BEFORE_SUPPRESS.features[0]);
}

function scan(features) {
  return scanFeatureList({ ...FEATURE_LIST_BEFORE_SUPPRESS, features }, DUPLICATE_CONTEXT);
}

test('reads the blob element of both a calibrated parameter and a native sketch image', () => {
  const parameter = calibratedFeature().parameters.find((candidate) => candidate.parameterId === 'image');
  // The stored namespace is E4's rejected d::w::e::m form: unusable for a
  // write, perfectly readable for a comparison. Reading stays lenient so a
  // feature someone else wrote can still be cross-referenced.
  assert.deepEqual(resolveImageBlob(parameter), {
    reference: {
      documentId: 'a11ce0000000000000000039',
      workspaceId: 'a11ce0000000000000000052',
      elementId: BLOB_B.elementId,
      microversionId: BLOB_B.microversionId
    },
    elementId: BLOB_B.elementId,
    microversionId: BLOB_B.microversionId
  });
  // The native entity carries it on a child BTMParameterBlobReference-1679,
  // while the entity's own namespace is the empty string.
  const native = resolveImageBlob(nativeImageEntity({ blob: BLOB_A }));
  assert.equal(native.elementId, BLOB_A.elementId);
  assert.equal(native.microversionId, BLOB_A.microversionId);
  const empty = resolveImageBlob(nativeImageEntity({ blob: null }));
  assert.equal(empty.elementId, undefined);
  assert.equal(empty.microversionId, undefined);
  assert.equal(empty.reference, undefined);
});

test('a native sketch image reports a downloadable proxy reference, not only its blob element', () => {
  // Regression for the sauron-5 war-council finding: BTMParameterBlobReference-1679
  // exposes its namespace on a child parameter of the entity rather than a
  // btType containing 'Image', so findBlobReference() skipped it entirely and
  // proxyAvailable stayed false even though downloadBlob() had everything it
  // needed (documentId from context, elementId + microversionId from the
  // blob's own namespace, and a workspace fallback).
  const items = scan([nativeSketchFeature({ entity: nativeImageEntity({ blob: BLOB_A }) })]);
  assert.equal(items.length, 1);
  assert.equal(items[0].image.proxyAvailable, true);
  assert.deepEqual(items[0].image.reference, {
    documentId: DUPLICATE_CONTEXT.documentId,
    elementId: BLOB_A.elementId,
    microversionId: BLOB_A.microversionId,
    fallbackWorkspaceId: DUPLICATE_CONTEXT.workspaceOrVersionId
  });
});

test('a native sketch image in the shape Onshape actually returns has no readable placement', () => {
  // Pin for the sauron-8 war-council finding: nativeImageEntity() is copied
  // field for field from a real /api/apply backup and carries no xaxisX or
  // xaxisY, which is what placementFromNativeImageEntity() reads to derive
  // width and angle. Against every real capture this project holds (this
  // fixture, and docs/experiments/2026-09-05-suppress-verify/), that read
  // throws and scanFeatureList() reports placement as undefined rather than a
  // guess. This test exists so a change to those field names — or a future
  // capture that does carry them — shows up as a test failure instead of a
  // silent behavior change. See "Experimental native-image write" in
  // docs/ARCHITECTURE.md.
  const items = scan([nativeSketchFeature({ entity: nativeImageEntity({ blob: BLOB_A }) })]);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'native');
  assert.equal(items[0].placement, undefined);
});

test('scanned items report suppression and how much else is in the sketch', () => {
  const items = scan([
    calibratedFeature(),
    nativeSketchFeature({ suppressed: true, otherEntities: 4 })
  ]);
  const [custom, native] = items;
  assert.equal(custom.suppressed, false);
  assert.equal(native.suppressed, true);
  assert.equal(native.otherSketchEntityCount, 4);
  assert.equal(native.image.blobElementId, BLOB_A.elementId);
});

test('a native image bound to the same blob is an exact duplicate', () => {
  const items = scan([
    calibratedFeature(),
    nativeSketchFeature({ entity: nativeImageEntity({ blob: BLOB_B }) })
  ]);
  const matches = findDuplicateNativeImages({ items, targetId: 'custom:FycByd6CdezIhLo_0' });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].itemId, 'native:FSketchOne_0:KsOMMVzbDE6a');
  assert.equal(matches[0].confidence, 'exact');
  assert.equal(matches[0].basis, 'blob-element');
  assert.equal(matches[0].sameBlobMicroversion, true);
  assert.equal(matches[0].suppressed, false);
  assert.equal(matches[0].otherSketchEntityCount, 4);
});

test('a native image bound to a different blob is not offered at all', () => {
  const items = scan([
    calibratedFeature(),
    nativeSketchFeature({ entity: nativeImageEntity({ blob: BLOB_A }) })
  ]);
  assert.deepEqual(findDuplicateNativeImages({ items, targetId: 'custom:FycByd6CdezIhLo_0' }), []);
});

test('matching aspect ratios are a likely duplicate, and mismatched ones are none', () => {
  // customFeature()'s image parameter carries pixel dimensions but no
  // namespace, so the aspect ratio is the only comparison available.
  const target = customFeature();
  const aspect = 4032 / 3024;
  const likely = scan([
    target,
    nativeSketchFeature({ entity: nativeImageEntity({ aspectRatio: aspect * 1.005, blob: null }) })
  ]);
  const matches = findDuplicateNativeImages({ items: likely, targetId: 'custom:feature-custom' });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].confidence, 'likely');
  assert.equal(matches[0].basis, 'aspect-ratio');

  const unrelated = scan([
    target,
    nativeSketchFeature({ entity: nativeImageEntity({ aspectRatio: 0.75, blob: null }) })
  ]);
  assert.deepEqual(findDuplicateNativeImages({ items: unrelated, targetId: 'custom:feature-custom' }), []);
});

test('no comparable evidence at all reads as possible, never as a match or a miss', () => {
  const items = scan([
    calibratedFeature(),
    nativeSketchFeature({ entity: nativeImageEntity({ aspectRatio: undefined, blob: null }) })
  ]);
  const matches = findDuplicateNativeImages({ items, targetId: 'custom:FycByd6CdezIhLo_0' });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].confidence, 'possible');
  assert.equal(matches[0].basis, 'none');
});

test('duplicates are ordered strongest first and only a custom target has any', () => {
  const items = scan([
    calibratedFeature(),
    nativeSketchFeature({
      featureId: 'FSketchTwo_0',
      name: 'Sketch 2',
      entity: nativeImageEntity({ entityId: 'weaker', aspectRatio: undefined, blob: null })
    }),
    nativeSketchFeature({ entity: nativeImageEntity({ blob: BLOB_B }) })
  ]);
  const matches = findDuplicateNativeImages({ items, targetId: 'custom:FycByd6CdezIhLo_0' });
  assert.deepEqual(matches.map((match) => match.confidence), ['exact', 'possible']);
  // A native item is never the target: this offer only exists to retire a
  // duplicate of the calibrated feature.
  assert.deepEqual(findDuplicateNativeImages({ items, targetId: 'native:FSketchOne_0:KsOMMVzbDE6a' }), []);
  assert.deepEqual(findDuplicateNativeImages({ items, targetId: 'custom:nope' }), []);
  assert.deepEqual(findDuplicateNativeImages({}), []);
});

test('setFeatureSuppressed reproduces the body Onshape accepted, changing only suppressed', () => {
  const stored = calibratedFeature();
  const updated = setFeatureSuppressed(stored, true);
  assert.deepEqual(updated, SUPPRESS_TRUE_REQUEST.feature);
  assert.equal(stored.suppressed, false, 'the stored feature is not mutated');

  // Nothing but the one boolean moved.
  const flippedBack = structuredClone(updated);
  flippedBack.suppressed = stored.suppressed;
  assert.deepEqual(flippedBack, stored);

  assert.deepEqual(featureUpdatePayload(FEATURE_LIST_BEFORE_SUPPRESS, updated), SUPPRESS_TRUE_REQUEST);
  assert.throws(() => setFeatureSuppressed(stored, 'true'), /true or false/);
});

// ---------------------------------------------------------------------------
// One blob resolver
//
// resolveImageBlob() replaced two functions (findBlobReference() and
// imageBlobReference()) that answered "where is this image's blob" by
// different rules and once disagreed on the native
// BTMParameterBlobReference-1679 shape. This table enumerates every captured
// image shape this project holds, so a fixture added without a matching
// resolver rule fails here instead of surfacing later as a silent
// proxyAvailable: false.
// ---------------------------------------------------------------------------

test('resolveImageBlob agrees with every captured image shape in test/fixtures', () => {
  const cases = [
    {
      name: 'calibrated custom feature (E4 rejected d::w::e::m namespace form)',
      source: calibratedFeature().parameters.find((candidate) => candidate.parameterId === 'image'),
      context: {},
      expectedElementId: BLOB_B.elementId,
      expectedMicroversionId: BLOB_B.microversionId,
      expectReference: true
    },
    {
      name: 'native sketch image (nested BTMParameterBlobReference-1679, entity namespace empty)',
      source: nativeImageEntity({ blob: BLOB_A }),
      context: DUPLICATE_CONTEXT,
      expectedElementId: BLOB_A.elementId,
      expectedMicroversionId: BLOB_A.microversionId,
      expectReference: true
    },
    {
      name: 'feature with no blob at all',
      source: { btType: 'BTMFeature-134', featureId: 'no-blob', parameters: [] },
      context: DUPLICATE_CONTEXT,
      expectedElementId: undefined,
      expectedMicroversionId: undefined,
      expectReference: false
    }
  ];

  for (const testCase of cases) {
    const resolved = resolveImageBlob(testCase.source, testCase.context);
    assert.equal(resolved.elementId, testCase.expectedElementId, `${testCase.name}: elementId`);
    assert.equal(resolved.microversionId, testCase.expectedMicroversionId, `${testCase.name}: microversionId`);
    if (testCase.expectReference) {
      assert.ok(resolved.reference, `${testCase.name}: expected a reference`);
      assert.ok(resolved.reference.documentId, `${testCase.name}: reference must carry a documentId, never a half-reference`);
      assert.equal(resolved.reference.elementId, testCase.expectedElementId, `${testCase.name}: reference.elementId`);
    } else {
      // A source with no blob yields undefined, never a documentId-less
      // half-reference that would fail a download silently.
      assert.equal(resolved.reference, undefined, `${testCase.name}: expected no reference`);
    }
  }
});
