import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPlaneParameter, listPlaneCandidates, planeQueryExpression } from '../src/plane-model.mjs';

// Real captured query wrapper and sketch skeleton; no sketchPlane is present
// in the native capture. The added sketchPlane below is explicitly a synthetic
// clone-contract input, not evidence of an accepted native sketch request.
const accepted = JSON.parse(fs.readFileSync(new URL('../docs/experiments/2026-09-04-bind-experiment/15-e3-add-feature-a.json', import.meta.url)));
const plane = accepted.requestBody.feature.parameters.find((entry) => entry.parameterId === 'plane');
const native = JSON.parse(fs.readFileSync(new URL('../docs/experiments/2026-09-05-suppress-verify/03-create-native-sketch.json', import.meta.url)));

test('defaults have stable ids, and malformed feature lists retain all defaults', () => {
  const expected = ['default:Top', 'default:Front', 'default:Right'];
  for (const list of [undefined, null, {}, { features: null }, { features: {} }, { features: [null, {}, 2] }]) {
    assert.deepEqual(listPlaneCandidates(list).map((entry) => entry.id), expected);
  }
});

test('captured sketch without a sketchPlane remains visible with a reason', () => {
  const sketch = native.responseBody?.feature || native.response?.feature;
  assert.ok(sketch?.featureId, 'capture must contain the returned sketch');
  const candidate = listPlaneCandidates({ features: [sketch] }).find((entry) => entry.kind === 'sketch');
  assert.equal(candidate.id, `sketch:${sketch.featureId}`);
  assert.equal(candidate.query, undefined);
  assert.ok(candidate.unavailableReason);
  assert.throws(() => buildPlaneParameter(candidate), /does not expose/);
});

test('candidate ordering and ids survive duplicate names and feature renaming', () => {
  const sketch = { ...native.requestBody.feature, featureId: 'sketch-one', name: 'Same' };
  // cPlane type is an explicitly assumed protocol input pending P3 evidence.
  const feature = { featureType: 'cPlane', featureId: 'plane-one', name: 'Same' };
  const candidates = listPlaneCandidates({ features: [sketch, feature, { ...feature }] });
  assert.deepEqual(candidates.slice(3).map((entry) => entry.id), ['plane:plane-one', 'sketch:sketch-one']);
  assert.equal(listPlaneCandidates({ features: [{ ...feature, name: 'Renamed' }] })[3].id, candidates[3].id);
});

test('sketch plane queries are copied deeply; only parameterId changes in the payload', () => {
  const query = { ...structuredClone(plane), parameterId: 'sketchPlane' };
  const sketch = { ...native.requestBody.feature, featureId: 'clone-contract', parameters: [query] };
  const candidate = listPlaneCandidates({ features: [sketch] })[3];
  assert.deepEqual(candidate.query, query);
  const result = buildPlaneParameter(candidate);
  assert.deepEqual(result, plane);
  result.queries[0].deterministicIds.push('changed');
  candidate.query.filter.operand1.entityType = 'EDGE';
  assert.deepEqual(query, { ...plane, parameterId: 'sketchPlane' });
  assert.deepEqual(candidate.query.queries[0].deterministicIds, ['JDC']);
});

test('default parameters use stable ids rather than editable labels and clone ids', () => {
  const ids = ['JDC'];
  const candidate = { ...listPlaneCandidates()[0], label: 'Renamed' };
  const result = buildPlaneParameter(candidate, { deterministicIds: ids });
  assert.equal(result.queries[0].queryString, 'query=qCreatedBy(makeId("Top"), EntityType.FACE);');
  assert.deepEqual(result.filter, plane.filter);
  result.queries[0].deterministicIds.push('changed');
  assert.deepEqual(ids, ['JDC']);
  assert.equal('deterministicIds' in buildPlaneParameter(candidate).queries[0], false);
  for (const invalid of [[], 'JDC', [null], ['']]) assert.throws(() => buildPlaneParameter(candidate, { deterministicIds: invalid }));
});

test('query expressions reject unknown candidates and escape feature ids', () => {
  assert.throws(() => buildPlaneParameter({ kind: 'default', id: 'default:Unknown' }));
  assert.throws(() => buildPlaneParameter({ kind: 'plane-feature' }));
  const id = 'feature"\\\n';
  assert.equal(planeQueryExpression({ kind: 'plane-feature', featureId: id }), `qCreatedBy(makeId(${JSON.stringify(id)}), EntityType.FACE)`);
});
