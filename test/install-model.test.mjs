import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_PLACEMENT,
  FEATURE_MARKER,
  buildReferenceImageFeature,
  classifyInstall,
  contentsCarryMarker,
  elementList,
  elementNamespace,
  featureAddPayload,
  featureUpdatePayload,
  listFeatureStudioElements,
  listImageBlobElements,
  readFeatureStatus,
  rebindImageNamespace
} from '../src/onshape-model.mjs';
import {
  ELEMENTS_AFTER_FEATURE_STUDIO,
  ELEMENTS_AFTER_UPLOAD,
  ELEMENTS_INITIAL
} from './fixtures/install-elements.mjs';
import {
  ADD_FEATURE_REQUEST,
  ADD_FEATURE_RESPONSE,
  FEATURE_LIST_BEFORE_ADD,
  FEATURE_LIST_BEFORE_REBIND,
  FEATURE_LIST_WITH_INSTANCE,
  FEATURE_STUDIO_READ,
  REBIND_REQUEST
} from './fixtures/install-features.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const FEATURE_STUDIO_ID = 'a11ce0000000000000000114';
const FEATURE_STUDIO_MICROVERSION = 'a11ce0000000000000000030';
const BLOB_A = { elementId: 'a11ce0000000000000000120', microversionId: 'a11ce0000000000000000010' };
const BLOB_B = { elementId: 'a11ce0000000000000000026', microversionId: 'a11ce0000000000000000125' };

// The classifier's whole premise is that this token is in the shipped source.
// If someone edits the .fs and drops it, every document reads as not-installed
// and the app offers to install a second copy over a working one.
test('the shipped FeatureScript carries the marker the classifier looks for', async () => {
  const source = await fs.readFile(path.join(root, 'featurescript/ReferenceImage.fs'), 'utf8');
  assert.ok(source.includes(FEATURE_MARKER), `ReferenceImage.fs must contain "${FEATURE_MARKER}"`);
  assert.equal(contentsCarryMarker(source), true);
});

test('a document with no Feature Studio and no instance is not-installed', () => {
  const result = classifyInstall({ elements: ELEMENTS_INITIAL, studioContents: {}, featureList: FEATURE_LIST_BEFORE_ADD });
  assert.equal(result.state, 'not-installed');
  assert.equal(result.featureStudio, null);
  assert.deepEqual(result.markedStudioIds, []);
  assert.deepEqual(result.unreadStudioIds, []);
  assert.deepEqual(result.instances, []);
  assert.deepEqual(result.imageElements, []);
});

test('a marked Feature Studio with no instance is studio-present, carrying its microversion', async () => {
  const source = await fs.readFile(path.join(root, 'featurescript/ReferenceImage.fs'), 'utf8');
  const result = classifyInstall({
    elements: ELEMENTS_AFTER_FEATURE_STUDIO,
    studioContents: { [FEATURE_STUDIO_ID]: source },
    featureList: FEATURE_LIST_BEFORE_ADD
  });
  assert.equal(result.state, 'studio-present');
  assert.deepEqual(result.featureStudio, {
    id: FEATURE_STUDIO_ID,
    name: 'Reference Align Features',
    microversionId: FEATURE_STUDIO_MICROVERSION
  });
  assert.deepEqual(result.markedStudioIds, [FEATURE_STUDIO_ID]);
  assert.equal(result.instances.length, 0);
});

test('a feature instance in the Part Studio is instance-present', async () => {
  const source = await fs.readFile(path.join(root, 'featurescript/ReferenceImage.fs'), 'utf8');
  const result = classifyInstall({
    elements: ELEMENTS_AFTER_FEATURE_STUDIO,
    studioContents: { [FEATURE_STUDIO_ID]: source },
    featureList: FEATURE_LIST_WITH_INSTANCE
  });
  assert.equal(result.state, 'instance-present');
  assert.equal(result.instances.length, 1);
  assert.equal(result.instances[0].featureId, 'FycByd6CdezIhLo_0');
  assert.equal(result.instances[0].suppressed, false);
  assert.equal(result.instances[0].namespace, `e${FEATURE_STUDIO_ID}::m${FEATURE_STUDIO_MICROVERSION}`);
});

// An instance can outlive the studio that declared it in the classifier's view
// (hand-installed source, a renamed marker). Offering to install over it would
// be worse than reporting the truth.
test('an instance with no marked studio is still instance-present', () => {
  const result = classifyInstall({
    elements: ELEMENTS_AFTER_FEATURE_STUDIO,
    studioContents: { [FEATURE_STUDIO_ID]: 'FeatureScript 2770;\n' },
    featureList: FEATURE_LIST_WITH_INSTANCE
  });
  assert.equal(result.state, 'instance-present');
  assert.equal(result.featureStudio, null);
});

// The captured Feature Studio source predates the marker, so it is exactly the
// "a studio that looks like ours but is not tagged" case.
test('an unmarked Feature Studio does not count as installed', () => {
  const result = classifyInstall({
    elements: ELEMENTS_AFTER_FEATURE_STUDIO,
    studioContents: { [FEATURE_STUDIO_ID]: FEATURE_STUDIO_READ.contents },
    featureList: FEATURE_LIST_BEFORE_ADD
  });
  assert.equal(result.state, 'not-installed');
  assert.equal(FEATURE_STUDIO_READ.contents.includes(FEATURE_MARKER), false);
});

test('a Feature Studio whose contents were never fetched is reported unread, not unmarked', () => {
  const result = classifyInstall({
    elements: ELEMENTS_AFTER_FEATURE_STUDIO,
    studioContents: {},
    featureList: FEATURE_LIST_BEFORE_ADD
  });
  assert.deepEqual(result.unreadStudioIds, [FEATURE_STUDIO_ID]);
  assert.deepEqual(result.markedStudioIds, []);
});

test('image blobs are listed by dataType with their own microversions', () => {
  const images = listImageBlobElements(ELEMENTS_AFTER_UPLOAD);
  assert.deepEqual(images, [
    {
      id: BLOB_A.elementId,
      name: 'reference-align-icon-a.png',
      dataType: 'image/png',
      microversionId: BLOB_A.microversionId,
      bindable: true
    },
    {
      id: BLOB_B.elementId,
      name: 'reference-align-icon-b.png',
      dataType: 'image/png',
      microversionId: BLOB_B.microversionId,
      bindable: true
    }
  ]);
  // The Part Studio, Assembly and BOM in the same listing are not images.
  assert.equal(listFeatureStudioElements(ELEMENTS_AFTER_UPLOAD).length, 0);
});

// Every list endpoint captured under docs/experiments returns a bare array
// (see ELEMENTS_INITIAL et al.), but elementList also has to accept the
// { items: [...] } shape other Onshape list endpoints use, since every reader
// of the element listing goes through it and none of them should have to
// know which shape this particular endpoint happens to prefer.
test('elementList accepts a bare array, an items wrapper, and anything else as empty', () => {
  const one = { id: 'a', elementType: 'BLOB' };
  assert.deepEqual(elementList([one]), [one]);
  assert.deepEqual(elementList({ items: [one] }), [one]);
  assert.deepEqual(elementList(undefined), []);
  assert.deepEqual(elementList(null), []);
  assert.deepEqual(elementList({}), []);
});

test('listImageBlobElements and listFeatureStudioElements also accept the items-wrapper shape', () => {
  const wrapped = { items: ELEMENTS_AFTER_UPLOAD };
  assert.deepEqual(listImageBlobElements(wrapped), listImageBlobElements(ELEMENTS_AFTER_UPLOAD));
  assert.deepEqual(listFeatureStudioElements(wrapped), listFeatureStudioElements(ELEMENTS_AFTER_UPLOAD));
});

test('a blob with no microversion is listed but not bindable', () => {
  const images = listImageBlobElements([
    { id: BLOB_A.elementId, name: 'x.png', elementType: 'BLOB', dataType: 'image/png', microversionId: null }
  ]);
  assert.equal(images.length, 1);
  assert.equal(images[0].bindable, false);
  assert.equal(images[0].microversionId, undefined);
});

test('elementNamespace produces the one form Onshape actually resolved', () => {
  assert.equal(
    elementNamespace(BLOB_B.elementId, BLOB_B.microversionId),
    'ea11ce0000000000000000026::ma11ce0000000000000000125'
  );
});

// E4: Onshape stored both of these without complaint and then reported
// featureStatus ERROR. They have to be impossible to build, not merely
// discouraged.
test('elementNamespace refuses the two forms that stored fine and then failed', () => {
  assert.throws(() => elementNamespace(BLOB_B.elementId, ''), /microversionId/);
  assert.throws(() => elementNamespace(BLOB_B.elementId, undefined), /microversionId/);
  assert.throws(() => elementNamespace('da11ce0000000000000000039::wa11ce0000000000000000052', BLOB_B.microversionId), /elementId/);
  assert.throws(() => elementNamespace('not-an-id', BLOB_B.microversionId), /elementId/);
});

test('the add-feature payload is byte-identical to the request Onshape accepted', () => {
  const feature = buildReferenceImageFeature({
    featureStudio: { id: FEATURE_STUDIO_ID, microversionId: FEATURE_STUDIO_MICROVERSION },
    image: BLOB_A
  });
  const payload = featureAddPayload(FEATURE_LIST_BEFORE_ADD, feature);
  assert.equal(JSON.stringify(payload), JSON.stringify(ADD_FEATURE_REQUEST));
});

test('the add-feature defaults are the FeatureScript own defaults, in SI', () => {
  assert.deepEqual(DEFAULT_PLACEMENT, { width: 0.25, angle: 0, originX: 0, originY: 0 });
  const feature = buildReferenceImageFeature({
    featureStudio: { id: FEATURE_STUDIO_ID, microversionId: FEATURE_STUDIO_MICROVERSION },
    image: BLOB_A
  });
  const expressions = Object.fromEntries(feature.parameters
    .filter((parameter) => parameter.expression !== undefined)
    .map((parameter) => [parameter.parameterId, parameter.expression]));
  assert.deepEqual(expressions, {
    imageWidth: '0.25 m',
    imageAngle: '0 deg',
    originX: '0 m',
    originY: '0 m'
  });
});

test('a new feature cannot be built without a resolvable studio or image namespace', () => {
  assert.throws(() => buildReferenceImageFeature({ image: BLOB_A }), /elementId/);
  assert.throws(
    () => buildReferenceImageFeature({ featureStudio: { id: FEATURE_STUDIO_ID, microversionId: FEATURE_STUDIO_MICROVERSION } }),
    /elementId/
  );
});

test('the rebind payload is byte-identical to the request Onshape accepted', () => {
  const stored = FEATURE_LIST_BEFORE_REBIND.features.find((feature) => feature.featureId === 'FycByd6CdezIhLo_0');
  const { feature, namespace } = rebindImageNamespace(stored, BLOB_B);
  assert.equal(namespace, 'ea11ce0000000000000000026::ma11ce0000000000000000125');
  assert.equal(JSON.stringify(featureUpdatePayload(FEATURE_LIST_BEFORE_REBIND, feature)), JSON.stringify(REBIND_REQUEST));
});

test('a rebind changes the image namespace and nothing else', () => {
  const stored = FEATURE_LIST_BEFORE_REBIND.features.find((feature) => feature.featureId === 'FycByd6CdezIhLo_0');
  const { feature } = rebindImageNamespace(stored, BLOB_B);
  const strip = (value) => {
    const copy = structuredClone(value);
    copy.parameters = copy.parameters.filter((parameter) => parameter.parameterId !== 'image');
    return copy;
  };
  assert.deepEqual(strip(feature), strip(stored));
  // And the original object is untouched, so a failed write leaves the caller's
  // copy of the feature list still describing what Onshape actually holds.
  assert.equal(stored.parameters.find((parameter) => parameter.parameterId === 'image').namespace,
    'ea11ce0000000000000000120::ma11ce0000000000000000010');
});

test('a feature with no image parameter cannot be rebound', () => {
  assert.throws(
    () => rebindImageNamespace({ parameters: [{ parameterId: 'plane' }] }, BLOB_B),
    /no image parameter/
  );
});

// HTTP 200 proves nothing: E4 variants b and c both returned 200 with an
// ERROR feature status.
test('readFeatureStatus believes featureStatus, not the HTTP status', () => {
  assert.deepEqual(readFeatureStatus(ADD_FEATURE_RESPONSE), {
    ok: true,
    status: 'OK',
    featureId: 'FycByd6CdezIhLo_0',
    inactive: false
  });
  assert.deepEqual(readFeatureStatus({ featureState: { featureStatus: 'ERROR' }, feature: { featureId: 'x' } }), {
    ok: false,
    status: 'ERROR',
    featureId: 'x',
    inactive: false
  });
  assert.deepEqual(readFeatureStatus({}), { ok: false, status: 'UNKNOWN', featureId: undefined, inactive: false });
});
