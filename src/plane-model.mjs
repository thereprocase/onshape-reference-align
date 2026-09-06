// Plane selection is identified by feature id, never by an editable label.
// cPlane and sketchPlane were verified by the P3/P4 captures under
// docs/experiments/2026-09-05-plane-experiment-t5N9Xx/.
const DEFAULT_PLANES = Object.freeze(['Top', 'Front', 'Right']);
export const MAX_PLANE_RESOLUTIONS = 64;

export function listPlaneCandidates(featureList) {
  const defaults = DEFAULT_PLANES.map((name) => ({ id: `default:${name}`, label: name, kind: 'default' }));
  const planes = [];
  const sketches = [];
  const seen = new Set(defaults.map((candidate) => candidate.id));
  for (const feature of Array.isArray(featureList?.features) ? featureList.features : []) {
    if (typeof feature?.featureId !== 'string' || !feature.featureId.trim()) continue;
    const name = typeof feature.name === 'string' && feature.name.trim() ? feature.name : feature.featureId;
    let candidate;
    if (feature.featureType === 'cPlane') {
      candidate = { id: `plane:${feature.featureId}`, label: name, kind: 'plane-feature', featureId: feature.featureId };
    } else if (/^BTMSketch-\d+$/.test(feature.btType || '')) {
      candidate = { id: `sketch:${feature.featureId}`, label: `Same plane as ${name}`, kind: 'sketch', featureId: feature.featureId };
      const parameter = (Array.isArray(feature.parameters) ? feature.parameters : [])
        .find((entry) => entry?.parameterId === 'sketchPlane' && /^BTMParameterQueryList-\d+$/.test(entry.btType || ''));
      if (parameter && Array.isArray(parameter.queries) && parameter.queries.length) candidate.query = structuredClone(parameter);
      else candidate.unavailableReason = 'This sketch does not expose its plane query.';
    }
    if (!candidate || seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    (candidate.kind === 'sketch' ? sketches : planes).push(candidate);
  }
  return [...defaults, ...planes, ...sketches];
}

export function planeQueryExpression(candidate) {
  let featureId;
  if (candidate?.kind === 'default' && DEFAULT_PLANES.some((name) => candidate.id === `default:${name}`)) {
    featureId = candidate.id.slice('default:'.length);
  } else if (candidate?.kind === 'plane-feature' && typeof candidate.featureId === 'string' && candidate.featureId.trim()) {
    featureId = candidate.featureId;
  } else {
    throw new Error('A default plane or plane feature is required.');
  }
  // JSON string escaping also bounds the FeatureScript string literal.
  return `qCreatedBy(makeId(${JSON.stringify(featureId)}), EntityType.FACE)`;
}

export function buildPlaneParameter(candidate, { deterministicIds } = {}) {
  if (candidate?.kind === 'sketch') {
    if (!candidate.query || !Array.isArray(candidate.query.queries) || !candidate.query.queries.length) {
      throw new Error('This sketch does not expose its plane query.');
    }
    const parameter = structuredClone(candidate.query);
    parameter.parameterId = 'plane';
    return parameter;
  }
  if (deterministicIds !== undefined && (!Array.isArray(deterministicIds) || !deterministicIds.length ||
      deterministicIds.some((id) => typeof id !== 'string' || !id.trim()))) {
    throw new Error('deterministicIds must contain nonempty strings.');
  }
  // Wrapper/filter copied from the accepted Top parameter in
  // docs/experiments/2026-09-04-bind-experiment/15-e3-add-feature-a.json.
  // P2 establishes which queryString/deterministicIds combination regenerates.
  const query = { btType: 'BTMIndividualQuery-138', queryStatement: null, queryString: `query=${planeQueryExpression(candidate)};` };
  if (deterministicIds !== undefined) query.deterministicIds = [...deterministicIds];
  return {
    btType: 'BTMParameterQueryList-148',
    queries: [query],
    filter: {
      btType: 'BTAndFilter-110',
      operand1: { btType: 'BTEntityTypeFilter-124', entityType: 'FACE' },
      operand2: { btType: 'BTGeometryFilter-130', geometryType: 'PLANE' }
    },
    parameterId: 'plane'
  };
}

/** Build one bounded evaluation from server-owned feature ids. */
export function planeEvaluationScript(candidates) {
  return `function(context is Context, queries) { return [${candidates.map((candidate) =>
    `transientQueriesToStrings(evaluateQuery(context, ${planeQueryExpression(candidate)}))`).join(',')}]; }`;
}

function resolvedIds(value) {
  if (!/ValueArray$/.test(value?.btType || '') || !Array.isArray(value.value)) return [];
  return value.value.filter((entry) => /ValueString$/.test(entry?.btType || '') && typeof entry.value === 'string' && entry.value.trim())
    .map((entry) => entry.value);
}

/** Fresh list and evaluation only: caller-supplied query objects never enter here. */
export async function resolvePlaneCandidates(featureList, evaluate, { beforeFeatureId } = {}) {
  const candidates = listPlaneCandidates(featureList);
  const features = Array.isArray(featureList?.features) ? featureList.features : [];
  const targetIndex = beforeFeatureId ? features.findIndex((feature) => feature?.featureId === beforeFeatureId) : -1;
  for (const candidate of candidates) {
    if (candidate.featureId && targetIndex >= 0 && features.findIndex((feature) => feature?.featureId === candidate.featureId) >= targetIndex) {
      candidate.unavailableReason = 'Choose a plane or sketch that appears before this image feature.';
      delete candidate.query;
    }
  }
  const unresolved = candidates.filter((candidate) => candidate.kind !== 'sketch' && !candidate.unavailableReason);
  const batch = unresolved.slice(0, MAX_PLANE_RESOLUTIONS);
  for (const candidate of unresolved.slice(MAX_PLANE_RESOLUTIONS)) candidate.unavailableReason = 'This document has more planes than can be resolved at once.';
  if (batch.length) {
    try {
      const response = await evaluate(planeEvaluationScript(batch));
      const results = response?.result;
      if (!/ValueArray$/.test(results?.btType || '') || !Array.isArray(results.value) || results.value.length !== batch.length) {
        throw new Error('Unexpected plane evaluation response.');
      }
      batch.forEach((candidate, index) => {
        const ids = resolvedIds(results.value[index]);
        if (ids.length === 1) candidate.query = buildPlaneParameter(candidate, { deterministicIds: ids });
        else candidate.unavailableReason = 'This feature does not resolve to one plane.';
      });
    } catch {
      for (const candidate of batch) candidate.unavailableReason = 'Onshape could not resolve this plane. Refresh and try again.';
    }
  }
  return candidates;
}

export function replacePlaneParameter(feature, plane) {
  const updated = structuredClone(feature);
  if (!Array.isArray(updated?.parameters) || !updated.parameters.some((entry) => entry?.parameterId === 'plane')) {
    throw new Error('The selected feature has no plane parameter.');
  }
  const parameter = structuredClone(plane);
  parameter.parameterId = 'plane';
  updated.parameters = updated.parameters.map((entry) => entry?.parameterId === 'plane' ? parameter : entry);
  return updated;
}

export function matchingPlaneCandidate(plane, candidates) {
  const ids = (parameter) => (Array.isArray(parameter?.queries) ? parameter.queries : [])
    .flatMap((query) => Array.isArray(query?.deterministicIds) ? query.deterministicIds : []).sort();
  const expected = ids(plane);
  const candidate = candidates.find((entry) => {
    if (!entry.query || entry.unavailableReason) return false;
    const actual = ids(entry.query);
    if (expected.length && actual.length) return JSON.stringify(expected) === JSON.stringify(actual);
    const statements = (parameter) => parameter?.queries?.map((query) => query?.queryString || query?.queryStatement || null);
    return Boolean(plane?.queries?.length) && JSON.stringify(statements(plane)) === JSON.stringify(statements(entry.query));
  });
  return candidate ? { id: candidate.id, label: candidate.label, kind: candidate.kind } : null;
}
