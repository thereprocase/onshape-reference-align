// The one gate every write route calls before it touches Onshape.
//
// Two independent questions, asked in this order: can the credential do this
// at all, and has the operator allowed it? Capability is asked first because
// it is the one the operator cannot fix with a toggle — telling someone to
// switch on a setting that would still be refused by Onshape is worse than
// telling them nothing.

import { FEATURES, POLICY_LABELS } from './capabilities.mjs';

export const CAPABILITY_DENIED = 'CAPABILITY_DENIED';
export const POLICY_DENIED = 'POLICY_DENIED';

function denial(code, feature, reason) {
  return Object.assign(new Error(reason), { status: 403, code, feature, reason });
}

/**
 * Throw a 403 unless both the key and the operator's policy allow `feature`.
 *
 * `state` is `{ capabilities, policy }`: the derived capability model and the
 * settings object. The thrown error carries `feature` and `reason` so the
 * route layer can hand the reason to the UI verbatim instead of inventing a
 * second, drifting copy of it.
 */
export function requireFeature(state, feature) {
  const refusal = describeFeatureGate(state, feature);
  if (refusal.blocked) throw denial(refusal.code, feature, refusal.reason);
  return refusal.record;
}

/**
 * The same two questions, answered without throwing.
 *
 * The UI has to disable a button and say why *before* it is pressed, and the
 * sentence it shows has to be the identical one the route would refuse with.
 * Composing it twice is how the button and the server end up disagreeing, so
 * both come from here.
 */
export function describeFeatureGate(state, feature) {
  const definition = FEATURES[feature];
  if (!definition) {
    throw Object.assign(new Error(`Unknown feature: ${feature}`), { status: 500, code: 'UNKNOWN_FEATURE' });
  }

  const record = state?.capabilities?.features?.[feature];
  if (record && record.allowed === false) {
    return { blocked: true, code: CAPABILITY_DENIED, reason: record.reason, record };
  }

  const policyKey = definition.policyKey;
  if (policyKey && state?.policy && state.policy[policyKey] === false) {
    return {
      blocked: true,
      code: POLICY_DENIED,
      // Names the switch and the card exactly as index.html labels them, so
      // the sentence sends the operator to something they can actually find.
      reason: `${definition.label} is turned off. Switch on “${POLICY_LABELS[policyKey] || policyKey}” under “What this app is allowed to do”.`,
      record
    };
  }

  return { blocked: false, code: null, reason: '', record };
}

/**
 * Every feature's refusal sentence, or '' where nothing refuses it. Sent with
 * the auth summary so the browser never has to compose one of its own.
 */
export function featureGateReasons(state) {
  const reasons = {};
  for (const feature of Object.keys(FEATURES)) {
    reasons[feature] = describeFeatureGate(state, feature).reason;
  }
  return reasons;
}

/**
 * Record a 403 Onshape returned for a feature, so the next request already
 * knows. Scoped to the session, expired by deriveCapabilities' own TTL.
 */
export function recordCapabilityEvidence(session, feature, { status = 403, now = Date.now(), generation } = {}) {
  if (!session) return;
  if (!session.capabilityEvidence) session.capabilityEvidence = {};
  session.capabilityEvidence[feature] = { status, at: now, generation };
}

/** Drop the recorded 403 for a feature after it has actually succeeded. */
export function clearCapabilityEvidence(session, feature) {
  if (session?.capabilityEvidence) delete session.capabilityEvidence[feature];
}

/** Drop every recorded 403 for a session, e.g. after a new key is saved. */
export function clearAllCapabilityEvidence(session) {
  if (session) session.capabilityEvidence = {};
}
