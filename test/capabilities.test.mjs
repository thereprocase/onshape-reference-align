import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SCOPE_BITS,
  FEATURE_KEYS,
  EVIDENCE_TTL_MS,
  decodeScopes,
  deriveCapabilities,
  pickSessionInfo,
  summarizeScopes
} from '../src/capabilities.mjs';
import { LIVE_SESSIONINFO } from './fixtures/onshape-sessioninfo.mjs';
import { FREE_PLAN_PRIVATE_DOCUMENT_409 } from './fixtures/free-plan-private-document-409.mjs';

const NOW = 1_800_000_000_000;

test('decodeScopes splits the real 4099 mask and keeps the bit it does not recognise', () => {
  const scopes = decodeScopes(LIVE_SESSIONINFO.oauth2Scopes);
  assert.equal(scopes.raw, 4099);
  assert.equal(scopes.known, true);
  assert.equal(scopes.read, true);
  assert.equal(scopes.write, true);
  assert.equal(scopes.delete, false);
  assert.equal(scopes.readPii, false);
  assert.equal(scopes.share, false);
  // 4099 = 1 + 2 + 4096. The 4096 bit is not in SCOPE_BITS and must survive as
  // a raw number rather than being rounded off into "nothing else is granted".
  assert.deepEqual([...scopes.unknownBits], [4096]);
});

test('decodeScopes handles the empty and fully-known masks', () => {
  const none = decodeScopes(0);
  assert.equal(none.known, true);
  assert.equal(none.read, false);
  assert.deepEqual([...none.unknownBits], []);

  const all = decodeScopes(SCOPE_BITS.read | SCOPE_BITS.write | SCOPE_BITS.delete | SCOPE_BITS.readPii | SCOPE_BITS.share);
  assert.equal(all.raw, 31);
  for (const name of Object.keys(SCOPE_BITS)) assert.equal(all[name], true, name);
  assert.deepEqual([...all.unknownBits], []);
});

test('decodeScopes reports an unusable mask as unknown, not as "no scopes"', () => {
  for (const bad of [undefined, null, -1, 1.5, NaN, '4099', {}]) {
    const scopes = decodeScopes(bad);
    assert.equal(scopes.raw, null, String(bad));
    assert.equal(scopes.known, false, String(bad));
    assert.equal(scopes.write, false, String(bad));
  }
});

test('decodeScopes reports a mask made only of unrecognised bits', () => {
  const scopes = decodeScopes(4096 + 8192);
  assert.equal(scopes.known, true);
  assert.equal(scopes.read, false);
  assert.deepEqual([...scopes.unknownBits], [4096, 8192]);
});

test('pickSessionInfo copies the documented fields and never carries email', () => {
  const withEmail = { ...LIVE_SESSIONINFO, email: 'someone@example.com', extra: 'ignored' };
  const picked = pickSessionInfo(withEmail);
  assert.equal('email' in picked, false);
  assert.equal('extra' in picked, false);
  assert.equal(picked.oauth2Scopes, 4099);
  assert.equal(picked.planGroup, 'Free');
  assert.deepEqual([...picked.roles], ['USER', 'DEVELOPER']);
  assert.equal(picked.companyPlan, false);
  assert.equal(JSON.stringify(picked).includes('someone@example.com'), false);
});

test('pickSessionInfo drops fields of the wrong type instead of trusting them', () => {
  const picked = pickSessionInfo({ name: 12, oauth2Scopes: '4099', roles: 'USER', companyPlan: 'yes' });
  assert.equal(picked.name, undefined);
  assert.equal(picked.oauth2Scopes, undefined);
  assert.equal(picked.roles, undefined);
  assert.equal(picked.companyPlan, undefined);
});

test('deriveCapabilities on the real key allows every write and refuses delete cleanup', () => {
  const capabilities = deriveCapabilities({ sessionInfo: LIVE_SESSIONINFO, now: NOW });

  assert.equal(capabilities.known, true);
  assert.equal(capabilities.plan.group, 'Free');
  assert.equal(capabilities.plan.isFree, true);
  // The one plan limit this project has actually observed; see the 409 capture.
  assert.equal(capabilities.plan.canCreatePrivateDocuments, false);
  assert.match(FREE_PLAN_PRIVATE_DOCUMENT_409.error.body.message, /only allow access to public documents/);
  assert.equal(FREE_PLAN_PRIVATE_DOCUMENT_409.status, 409);

  for (const key of ['createDocument', 'installFeature', 'uploadImage', 'rebindImage', 'updateFeature', 'suppressFeature']) {
    assert.equal(capabilities.features[key].allowed, true, key);
    assert.equal(capabilities.features[key].source, 'scope', key);
  }
  assert.equal(capabilities.features.deleteCleanup.allowed, false);
  assert.equal(capabilities.features.deleteCleanup.source, 'scope');
  assert.match(capabilities.features.deleteCleanup.reason, /cleanup will be skipped/);
  assert.match(capabilities.features.createDocument.reason, /have to be public/);
  assert.deepEqual(capabilities.roles, ['USER', 'DEVELOPER']);
});

test('deriveCapabilities refuses every write when the key has read only', () => {
  const capabilities = deriveCapabilities({ sessionInfo: { oauth2Scopes: 1, planGroup: 'Professional' }, now: NOW });
  assert.equal(capabilities.plan.isFree, false);
  assert.equal(capabilities.plan.canCreatePrivateDocuments, true);
  assert.equal(capabilities.features.installFeature.allowed, false);
  assert.match(capabilities.features.installFeature.reason, /Key lacks write scope/);
  assert.match(capabilities.features.installFeature.reason, /Write documents/);
});

test('deriveCapabilities stays permissive when the scopes are unknown, so Onshape decides', () => {
  const capabilities = deriveCapabilities({ sessionInfo: { name: 'Someone' }, now: NOW });
  assert.equal(capabilities.scopes.known, false);
  for (const key of FEATURE_KEYS) {
    assert.equal(capabilities.features[key].allowed, true, key);
    assert.equal(capabilities.features[key].source, 'unknown', key);
  }
});

test('deriveCapabilities with no sessionInfo at all reports unknown rather than denied', () => {
  const capabilities = deriveCapabilities({ now: NOW });
  assert.equal(capabilities.known, false);
  assert.equal(capabilities.plan.group, null);
  assert.equal(capabilities.features.updateFeature.allowed, true);
  assert.equal(capabilities.features.updateFeature.source, 'unknown');
});

test('an observed 403 downgrades exactly that feature, with a reason naming both causes', () => {
  const evidence = { updateFeature: { status: 403, at: NOW - 1_000 } };
  const capabilities = deriveCapabilities({ sessionInfo: LIVE_SESSIONINFO, evidence, now: NOW });
  assert.equal(capabilities.features.updateFeature.allowed, false);
  assert.equal(capabilities.features.updateFeature.source, 'evidence');
  assert.match(capabilities.features.updateFeature.reason, /refused the last attempt with 403/);
  assert.match(capabilities.features.updateFeature.reason, /cannot edit that document/);
  // The evidence is scoped to one feature, not one document, so a stale 403
  // can outlive the document that produced it; the reason has to name a way
  // out rather than pointing back at the very button it just disabled.
  assert.match(capabilities.features.updateFeature.reason, /Onshape badge/);
  assert.doesNotMatch(capabilities.features.updateFeature.reason, /try again\.?$/);
  // A 403 on one write is not proof about a different one.
  assert.equal(capabilities.features.installFeature.allowed, true);
});

test('evidence expires, so one 403 on a read-only document cannot disable the app forever', () => {
  const evidence = { updateFeature: { status: 403, at: NOW - EVIDENCE_TTL_MS - 1 } };
  const capabilities = deriveCapabilities({ sessionInfo: LIVE_SESSIONINFO, evidence, now: NOW });
  assert.equal(capabilities.features.updateFeature.allowed, true);
});

test('evidence recorded under an earlier config generation is discarded', () => {
  const evidence = { updateFeature: { status: 403, at: NOW, generation: 1 } };
  assert.equal(
    deriveCapabilities({ sessionInfo: LIVE_SESSIONINFO, evidence, generation: 1, now: NOW }).features.updateFeature.allowed,
    false
  );
  assert.equal(
    deriveCapabilities({ sessionInfo: LIVE_SESSIONINFO, evidence, generation: 2, now: NOW }).features.updateFeature.allowed,
    true
  );
});

test('malformed evidence entries are ignored rather than trusted', () => {
  for (const evidence of [{ updateFeature: true }, { updateFeature: { status: 403 } }, { updateFeature: null }, null]) {
    const capabilities = deriveCapabilities({ sessionInfo: LIVE_SESSIONINFO, evidence, now: NOW });
    assert.equal(capabilities.features.updateFeature.allowed, true, JSON.stringify(evidence));
  }
});

test('summarizeScopes prints only the scopes that are actually granted', () => {
  assert.equal(summarizeScopes(decodeScopes(4099)), 'read · write');
  assert.equal(summarizeScopes(decodeScopes(7)), 'read · write · delete');
  assert.equal(summarizeScopes(decodeScopes(0)), 'no scopes');
  assert.equal(summarizeScopes(decodeScopes(undefined)), '');
  assert.equal(summarizeScopes(undefined), '');
});

test('the derived capability object never contains an email, whatever went in', () => {
  const capabilities = deriveCapabilities({
    sessionInfo: pickSessionInfo({ ...LIVE_SESSIONINFO, email: 'leak@example.com' }),
    now: NOW
  });
  assert.equal(JSON.stringify(capabilities).includes('leak@example.com'), false);
  assert.equal(JSON.stringify(capabilities).includes('@'), false);
});
