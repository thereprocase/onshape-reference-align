import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveCapabilities } from '../src/capabilities.mjs';
import {
  requireFeature,
  recordCapabilityEvidence,
  clearCapabilityEvidence,
  clearAllCapabilityEvidence,
  CAPABILITY_DENIED,
  POLICY_DENIED
} from '../src/capability-gate.mjs';
import { DEFAULT_SETTINGS } from '../src/settings.mjs';
import { LIVE_SESSIONINFO } from './fixtures/onshape-sessioninfo.mjs';

const NOW = 1_800_000_000_000;

function stateFor(sessionInfo, policy = DEFAULT_SETTINGS, evidence) {
  return { capabilities: deriveCapabilities({ sessionInfo, evidence, now: NOW }), policy };
}

test('requireFeature passes when the key allows it and the policy has not turned it off', () => {
  const record = requireFeature(stateFor(LIVE_SESSIONINFO), 'installFeature');
  assert.equal(record.allowed, true);
});

test('requireFeature throws a 403 CAPABILITY_DENIED carrying the capability reason verbatim', () => {
  const state = stateFor({ oauth2Scopes: 4099 });
  assert.throws(
    () => requireFeature(state, 'deleteCleanup'),
    (error) => {
      assert.equal(error.status, 403);
      assert.equal(error.code, CAPABILITY_DENIED);
      assert.equal(error.feature, 'deleteCleanup');
      assert.equal(error.reason, state.capabilities.features.deleteCleanup.reason);
      // The message and the reason are the same string, so a caller that only
      // reads error.message still shows the operator something true.
      assert.equal(error.message, error.reason);
      return true;
    }
  );
});

test('requireFeature throws POLICY_DENIED naming the switch the operator has to flip', () => {
  const state = stateFor(LIVE_SESSIONINFO, { ...DEFAULT_SETTINGS, allowSuppression: false });
  assert.throws(
    () => requireFeature(state, 'suppressFeature'),
    (error) => {
      assert.equal(error.status, 403);
      assert.equal(error.code, POLICY_DENIED);
      assert.equal(error.feature, 'suppressFeature');
      assert.match(error.reason, /Suppress features/);
      // The card heading in index.html, so the sentence points at something
      // the operator can find on the page.
      assert.match(error.reason, /What this app is allowed to do/);
      return true;
    }
  );
});

test('capability is reported before policy when both would refuse', () => {
  // The operator cannot fix a missing scope with a toggle, so naming the
  // toggle first would send them to a switch that changes nothing.
  const state = stateFor({ oauth2Scopes: 1 }, { ...DEFAULT_SETTINGS, allowFeatureInstall: false });
  assert.throws(() => requireFeature(state, 'installFeature'), (error) => {
    assert.equal(error.code, CAPABILITY_DENIED);
    return true;
  });
});

test('features with no policy toggle are gated by capability alone', () => {
  const state = stateFor(LIVE_SESSIONINFO, {});
  assert.equal(requireFeature(state, 'updateFeature').allowed, true);
  assert.equal(requireFeature(state, 'rebindImage').allowed, true);
});

test('an unknown feature name is a server fault, not a 403', () => {
  assert.throws(() => requireFeature(stateFor(LIVE_SESSIONINFO), 'nonsense'), (error) => {
    assert.equal(error.status, 500);
    assert.equal(error.code, 'UNKNOWN_FEATURE');
    return true;
  });
});

test('requireFeature does not refuse on a missing capability model, so Onshape stays the decider', () => {
  assert.doesNotThrow(() => requireFeature({ policy: DEFAULT_SETTINGS }, 'updateFeature'));
});

test('recorded evidence flows into the next gate call and a success clears it', () => {
  const session = {};
  recordCapabilityEvidence(session, 'updateFeature', { status: 403, now: NOW, generation: 3 });
  assert.equal(session.capabilityEvidence.updateFeature.status, 403);

  const denied = stateFor(LIVE_SESSIONINFO, DEFAULT_SETTINGS, session.capabilityEvidence);
  assert.throws(() => requireFeature(denied, 'updateFeature'), (error) => {
    assert.equal(error.code, CAPABILITY_DENIED);
    return true;
  });

  clearCapabilityEvidence(session, 'updateFeature');
  assert.doesNotThrow(() =>
    requireFeature(stateFor(LIVE_SESSIONINFO, DEFAULT_SETTINGS, session.capabilityEvidence), 'updateFeature')
  );
});

test('clearAllCapabilityEvidence wipes every recorded 403, as a key change must', () => {
  const session = {};
  recordCapabilityEvidence(session, 'updateFeature', { now: NOW });
  recordCapabilityEvidence(session, 'uploadImage', { now: NOW });
  clearAllCapabilityEvidence(session);
  assert.deepEqual(session.capabilityEvidence, {});
});

test('the evidence recorders tolerate a missing session instead of throwing mid-request', () => {
  assert.doesNotThrow(() => recordCapabilityEvidence(undefined, 'updateFeature'));
  assert.doesNotThrow(() => clearCapabilityEvidence(undefined, 'updateFeature'));
  assert.doesNotThrow(() => clearAllCapabilityEvidence(undefined));
});
