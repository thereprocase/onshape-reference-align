// A stand-in for one Onshape document, good enough to exercise the install,
// upload, and rebind routes end to end without leaving loopback.
//
// It answers with the captured shapes from
// docs/experiments/2026-09-04-bind-experiment/ and reproduces the two
// behaviours those captures established, both of which the product depends on:
//
//  1. The Feature Studio create response carries the microversion from before
//     the contents were set. Only the element listing has the current one. A
//     route that trusts the create response gets a namespace that stores fine
//     and then fails.
//  2. A feature whose image namespace does not resolve to a real element and
//     microversion is stored anyway, with HTTP 200, and reported as
//     featureStatus ERROR. HTTP status is not the answer here.

import { ELEMENTS_AFTER_UPLOAD, ELEMENTS_INITIAL } from './install-elements.mjs';
import { BLOB_A, nativeImageEntity, nativeSketchFeature } from './native-sketch-image.mjs';
import {
  ADD_FEATURE_RESPONSE,
  BLOB_UPLOAD_RESPONSE,
  FEATURE_LIST_BEFORE_ADD,
  FEATURE_STUDIO_CREATE_RESPONSE,
  FEATURE_STUDIO_READ
} from './install-features.mjs';

export const STUB_DOCUMENT = Object.freeze({
  documentId: 'a11ce0000000000000000039',
  workspaceId: 'a11ce0000000000000000052',
  partStudioId: 'a11ce0000000000000000027',
  featureStudioId: 'a11ce0000000000000000114',
  // The microversion the create response reports, before contents exist.
  featureStudioMicroversionAtCreate: 'a11ce0000000000000000153',
  // The one the element listing reports afterwards, and the only one that works.
  featureStudioMicroversionAfterContents: 'a11ce0000000000000000030',
  featureId: 'FycByd6CdezIhLo_0',
  // The Part Studio starts with a native Insert image sketch bound to the
  // first blob the stub hands out, so an installed calibrated feature ends up
  // showing the same picture — the duplicate the suppression offer exists for.
  sketchFeatureId: 'FSketchOne_0',
  sketchItemId: 'native:FSketchOne_0:KsOMMVzbDE6a',
  sketchBlobElementId: BLOB_A.elementId
});

const BLOB_SLOTS = Object.freeze(['a11ce0000000000000000120', 'a11ce0000000000000000026']);

function blobElementFixture(id) {
  return ELEMENTS_AFTER_UPLOAD.find((element) => element.id === id);
}

function parseNamespace(namespace) {
  const parts = String(namespace || '').split('::');
  const map = {};
  for (const part of parts) {
    if (/^e[0-9a-f]{24}$/i.test(part)) map.elementId = part.slice(1);
    else if (/^m[0-9a-f]{24}$/i.test(part)) map.microversionId = part.slice(1);
    else return {};
  }
  return map;
}

export function createDocumentStub() {
  const state = {
    elements: structuredClone(ELEMENTS_INITIAL),
    featureStudioContents: new Map(),
    features: [nativeSketchFeature({ entity: nativeImageEntity({ blob: BLOB_A }) })],
    blobsIssued: 0,
    writes: 0,
    sourceMicroversion: FEATURE_LIST_BEFORE_ADD.sourceMicroversion,
    // Set to a status string to make the next feature write report it, so a
    // caller can prove the route believes featureStatus over HTTP 200.
    forceFeatureStatus: undefined
  };

  function element(id) {
    return state.elements.find((candidate) => candidate.id === id);
  }

  /** Exactly Onshape's rule as observed in E4: element and microversion, both real. */
  function namespaceResolves(namespace, elementType) {
    const { elementId, microversionId } = parseNamespace(namespace);
    if (!elementId || !microversionId) return false;
    const target = element(elementId);
    return Boolean(target) && target.elementType === elementType && target.microversionId === microversionId;
  }

  function featureStatusFor(feature) {
    if (state.forceFeatureStatus) return state.forceFeatureStatus;
    // Only the custom feature is namespace-bound. A sketch has neither a
    // Feature Studio namespace nor an image parameter, and Onshape regenerates
    // it on its own terms, so the rules below do not apply to it.
    if (feature?.featureType !== 'referenceImage') return 'OK';
    const image = (feature?.parameters || []).find((parameter) => parameter?.parameterId === 'image');
    if (!namespaceResolves(image?.namespace, 'BLOB')) return 'ERROR';
    if (!namespaceResolves(feature?.namespace, 'FEATURESTUDIO')) return 'ERROR';
    return 'OK';
  }

  function featureListBody() {
    return { ...FEATURE_LIST_BEFORE_ADD, features: state.features, sourceMicroversion: state.sourceMicroversion };
  }

  function bumpMicroversion(id, microversionId) {
    const target = element(id);
    if (target) target.microversionId = microversionId;
    // A document write moves the whole document on, which is what makes the
    // feature list's sourceMicroversion change between reads.
    state.sourceMicroversion = `${microversionId.slice(0, 23)}f`;
  }

  const prefix = `/api/v17`;
  const workspace = `d/${STUB_DOCUMENT.documentId}/w/${STUB_DOCUMENT.workspaceId}`;

  /**
   * Handle one request. Returns false when the path is not one this stub owns,
   * so the caller can answer 404 (or handle /users/sessioninfo itself).
   */
  async function handle(req, res, body) {
    const url = new URL(req.url, 'http://stub.invalid');
    const route = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : url.pathname;
    // The body arrives as a Buffer so a multipart upload can pass through
    // untouched; only the JSON routes below ever decode it.
    const text = () => (body && body.length ? Buffer.from(body).toString('utf8') : '{}');
    const json = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(value));
      return true;
    };

    if (req.method === 'GET' && route === `/documents/${workspace}/elements`) {
      return json(200, state.elements);
    }

    if (req.method === 'GET' && route === `/partstudios/${workspace}/e/${STUB_DOCUMENT.partStudioId}/features`) {
      return json(200, featureListBody());
    }

    if (req.method === 'POST' && route === `/partstudios/${workspace}/e/${STUB_DOCUMENT.partStudioId}/featurescript`) {
      const request = JSON.parse(text());
      if (!request.queries || Array.isArray(request.queries)) return json(400, { message: 'queries must be a map' });
      // Envelope and default-plane ids copied from the successful P1 captures
      // in 2026-09-05-plane-experiment-t5N9Xx. User-plane identifiers below
      // are deliberately synthetic: this stub verifies transport, not CAD.
      const defaults = { Top: 'JDC', Front: 'JCC', Right: 'JBC' };
      const names = [...String(request.script).matchAll(/makeId\(("(?:[^"\\]|\\.)*")\)/g)].map((match) => JSON.parse(match[1]));
      const values = names.map((name) => {
        const feature = state.features.find((entry) => entry.featureId === name && entry.featureType === 'cPlane' && !entry.suppressed);
        const id = defaults[name] || (feature ? `stub-plane-${name}` : null);
        return {
          btType: 'com.belmonttech.serialize.fsvalue.BTFSValueArray',
          typeTag: '',
          value: id ? [{ btType: 'com.belmonttech.serialize.fsvalue.BTFSValueString', typeTag: '', value: id }] : []
        };
      });
      return json(200, {
        btType: 'BTFeatureScriptEvalResponse-1859',
        result: { btType: 'com.belmonttech.serialize.fsvalue.BTFSValueArray', typeTag: '', value: values },
        sourceMicroversion: state.sourceMicroversion, notices: [], console: ''
      });
    }

    if (req.method === 'POST' && route === `/featurestudios/${workspace}`) {
      state.writes += 1;
      state.elements.push({
        ...FEATURE_STUDIO_CREATE_RESPONSE,
        id: STUB_DOCUMENT.featureStudioId,
        elementType: 'FEATURESTUDIO',
        microversionId: STUB_DOCUMENT.featureStudioMicroversionAtCreate
      });
      return json(200, { ...FEATURE_STUDIO_CREATE_RESPONSE, id: STUB_DOCUMENT.featureStudioId });
    }

    const featureStudioElement = route.match(new RegExp(`^/featurestudios/${workspace}/e/([0-9a-f]{24})$`, 'i'));
    if (featureStudioElement) {
      const id = featureStudioElement[1];
      if (req.method === 'POST') {
        state.writes += 1;
        state.featureStudioContents.set(id, JSON.parse(text()).contents || '');
        bumpMicroversion(id, STUB_DOCUMENT.featureStudioMicroversionAfterContents);
        return json(200, { ...FEATURE_STUDIO_READ, contents: state.featureStudioContents.get(id) });
      }
      if (req.method === 'GET') {
        if (!state.featureStudioContents.has(id)) return json(404, { message: 'not found' });
        return json(200, { ...FEATURE_STUDIO_READ, contents: state.featureStudioContents.get(id) });
      }
    }

    if (req.method === 'POST' && route === `/blobelements/${workspace}`) {
      state.writes += 1;
      const id = BLOB_SLOTS[state.blobsIssued];
      if (!id) return json(400, { message: 'stub has no further blob slots' });
      state.blobsIssued += 1;
      const fixture = blobElementFixture(id);
      state.elements.push(structuredClone(fixture));
      state.sourceMicroversion = `${fixture.microversionId.slice(0, 23)}f`;
      return json(200, {
        ...BLOB_UPLOAD_RESPONSE,
        id,
        name: fixture.name,
        filename: fixture.filename,
        microversionId: fixture.microversionId
      });
    }

    if (req.method === 'POST' && route === `/partstudios/${workspace}/e/${STUB_DOCUMENT.partStudioId}/features`) {
      state.writes += 1;
      const call = JSON.parse(text());
      const stored = {
        ...structuredClone(call.feature),
        featureId: STUB_DOCUMENT.featureId,
        suppressed: call.feature?.suppressed === true
      };
      const featureStatus = featureStatusFor(stored);
      state.features.push(stored);
      state.sourceMicroversion = `${state.sourceMicroversion.slice(0, 23)}a`;
      return json(200, {
        ...ADD_FEATURE_RESPONSE,
        feature: stored,
        featureState: { btType: 'BTFeatureState-1688', featureStatus, inactive: false }
      });
    }

    const featureUpdate = route.match(
      new RegExp(`^/partstudios/${workspace}/e/${STUB_DOCUMENT.partStudioId}/features/featureid/([A-Za-z0-9_-]+)$`)
    );
    if (req.method === 'POST' && featureUpdate) {
      state.writes += 1;
      const call = JSON.parse(text());
      const index = state.features.findIndex((feature) => feature.featureId === featureUpdate[1]);
      if (index < 0) return json(404, { message: 'feature not found' });
      const stored = structuredClone(call.feature);
      const featureStatus = featureStatusFor(stored);
      state.features[index] = stored;
      return json(200, {
        ...ADD_FEATURE_RESPONSE,
        feature: stored,
        featureState: { btType: 'BTFeatureState-1688', featureStatus, inactive: false }
      });
    }

    return false;
  }

  return { handle, state, document: STUB_DOCUMENT };
}
