// What this server's Onshape credential is actually allowed to do.
//
// Pure: no clock beyond an injectable `now`, no filesystem, no network. The
// two inputs are a redacted GET /users/sessioninfo snapshot and a per-session
// map of 403s we have actually observed.
//
// Nothing here may read, return, or embed sessionInfo.email. pickSessionInfo()
// is the one place a sessioninfo response is narrowed, and it copies fields by
// name so a future Onshape field cannot ride along by accident.

/**
 * ASSUMPTION, not documentation: Onshape's GET /users/sessioninfo returns
 * `oauth2Scopes` as an integer bitmask, and these are the bit meanings we are
 * working from. Only bits 1 and 2 are corroborated by observed behaviour on
 * this project's own key (mask 4099 = 1 + 2 + 4096; reads and writes both
 * succeed, DELETE returns 403, which is consistent with bit 4 = delete being
 * absent). Bits 8 and 16 are unverified guesses. Every bit outside this table
 * is reported raw in `unknownBits` rather than being silently dropped, because
 * claiming to understand a permission we do not is how a tool ends up telling
 * an operator they cannot do something they can.
 */
export const SCOPE_BITS = Object.freeze({
  read: 1,
  write: 2,
  delete: 4,
  readPii: 8,
  share: 16
});

/** Human names for the scopes, matching the wording of Onshape's own key form. */
export const SCOPE_LABELS = Object.freeze({
  read: 'Read documents',
  write: 'Write documents',
  delete: 'Delete documents',
  readPii: 'Read profile info',
  share: 'Share documents'
});

/**
 * Every write this product performs, the scope it needs, and the policy toggle
 * an operator can use to switch it off.
 *
 * `rebindImage`, `updateFeature`, and `deleteCleanup` have no policy toggle:
 * the first two are the calibration write this app exists to perform (a toggle
 * that disables the product is a broken install, not a policy), and delete is
 * always optional cleanup that may simply be refused.
 */
export const FEATURES = Object.freeze({
  createDocument: Object.freeze({ scope: 'write', policyKey: 'allowDocumentCreation', label: 'Creating a scratch document' }),
  installFeature: Object.freeze({ scope: 'write', policyKey: 'allowFeatureInstall', label: 'Installing the Reference Image feature' }),
  uploadImage: Object.freeze({ scope: 'write', policyKey: 'allowImageUpload', label: 'Uploading an image' }),
  rebindImage: Object.freeze({ scope: 'write', policyKey: null, label: 'Pointing a feature at a new image' }),
  updateFeature: Object.freeze({ scope: 'write', policyKey: null, label: 'Writing calibrated values to a feature' }),
  suppressFeature: Object.freeze({ scope: 'write', policyKey: 'allowSuppression', label: 'Suppressing or unsuppressing a feature' }),
  deleteCleanup: Object.freeze({ scope: 'delete', policyKey: null, label: 'Deleting scratch elements' })
});

export const FEATURE_KEYS = Object.freeze(Object.keys(FEATURES));

/**
 * The label each policy toggle carries in the Settings card. Shared with the
 * gate's refusal copy so the sentence an operator reads names the switch they
 * are looking at, spelled the same way.
 */
export const POLICY_LABELS = Object.freeze({
  allowDocumentCreation: 'Create scratch documents',
  allowFeatureInstall: 'Install the Reference Image feature',
  allowImageUpload: 'Upload images',
  allowSuppression: 'Suppress features',
  confirmBeforeWrite: 'Confirm before every write'
});

/**
 * How long an observed 403 keeps holding a capability down.
 *
 * A 403 from Onshape is ambiguous: it means either "this key lacks the scope"
 * or "you do not have edit access to this particular document". Treating the
 * ambiguous case as permanent would let one attempt against someone else's
 * read-only document disable the whole app for the rest of the session, so the
 * evidence expires and a later success clears it outright.
 */
export const EVIDENCE_TTL_MS = 15 * 60 * 1000;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Split an oauth2Scopes bitmask into named flags plus the bits we do not
 * recognise.
 *
 * A mask that is not a non-negative safe integer yields `known: false` and no
 * flags at all. That is deliberately different from "every scope is missing":
 * callers must treat unknown scopes as unknown, never as denial.
 */
export function decodeScopes(mask) {
  const raw = Number.isSafeInteger(mask) && mask >= 0 ? mask : null;
  const scopes = {
    raw,
    known: raw !== null,
    read: false,
    write: false,
    delete: false,
    readPii: false,
    share: false,
    unknownBits: []
  };
  if (raw === null) return Object.freeze(scopes);

  let recognised = 0;
  for (const [name, bit] of Object.entries(SCOPE_BITS)) {
    recognised |= bit;
    scopes[name] = (raw & bit) === bit;
  }
  const unknownBits = [];
  for (let bit = 1; bit <= raw; bit *= 2) {
    if ((raw & bit) === bit && (recognised & bit) !== bit) unknownBits.push(bit);
  }
  scopes.unknownBits = Object.freeze(unknownBits);
  return Object.freeze(scopes);
}

/**
 * Narrow a raw /users/sessioninfo body to the fields this app is allowed to
 * keep. Copy by name, never by spread: `email` is in that response and must
 * never be cached, logged, or sent to a browser.
 */
export function pickSessionInfo(data) {
  if (!isPlainObject(data)) return undefined;
  return Object.freeze({
    name: typeof data.name === 'string' ? data.name : undefined,
    id: typeof data.id === 'string' ? data.id : undefined,
    oauth2Scopes: Number.isSafeInteger(data.oauth2Scopes) ? data.oauth2Scopes : undefined,
    planGroup: typeof data.planGroup === 'string' ? data.planGroup : undefined,
    roles: Array.isArray(data.roles) ? Object.freeze(data.roles.filter((role) => typeof role === 'string')) : undefined,
    companyPlan: typeof data.companyPlan === 'boolean' ? data.companyPlan : undefined
  });
}

function activeEvidence(evidence, key, { now, generation }) {
  if (!isPlainObject(evidence)) return undefined;
  const entry = evidence[key];
  if (!isPlainObject(entry)) return undefined;
  // An observed 403 is evidence about one credential. A config reload can swap
  // that credential, and the store's generation is the only thing that knows,
  // so evidence recorded under an earlier generation is discarded rather than
  // held against a key that has not been tried yet.
  if (generation !== undefined && entry.generation !== undefined && entry.generation !== generation) return undefined;
  const at = Number(entry.at);
  if (!Number.isFinite(at)) return undefined;
  if (now - at > EVIDENCE_TTL_MS) return undefined;
  return entry;
}

function scopeVerdict(scopes, scope) {
  if (!scopes.known) return 'unknown';
  return scopes[scope] ? 'granted' : 'missing';
}

function featureRecord({ key, definition, scopes, plan, evidence, now, generation }) {
  const scopeLabel = SCOPE_LABELS[definition.scope];
  const observed = activeEvidence(evidence, key, { now, generation });
  if (observed) {
    return {
      allowed: false,
      source: 'evidence',
      scope: definition.scope,
      policyKey: definition.policyKey,
      reason: `Onshape refused the last attempt with ${observed.status || 403}. Either this key lacks ${scopeLabel}, or this account cannot edit that document. Open a document you can edit, or press the Onshape badge at the top to re-enter your key — either one clears this.`
    };
  }

  const verdict = scopeVerdict(scopes, definition.scope);
  if (verdict === 'missing') {
    const consequence = definition.scope === 'delete'
      ? ' — cleanup will be skipped'
      : ` — create a new API key with ${scopeLabel} ticked`;
    return {
      allowed: false,
      source: 'scope',
      scope: definition.scope,
      policyKey: definition.policyKey,
      reason: `Key lacks ${definition.scope} scope${consequence}.`
    };
  }
  if (verdict === 'unknown') {
    return {
      allowed: true,
      source: 'unknown',
      scope: definition.scope,
      policyKey: definition.policyKey,
      reason: `This key's permissions are not known yet, so Onshape decides. ${definition.label} may still be refused.`
    };
  }

  let reason = `Key has ${definition.scope} scope.`;
  if (key === 'createDocument' && plan.isFree) {
    reason += ' Free plan: new documents have to be public.';
  }
  return { allowed: true, source: 'scope', scope: definition.scope, policyKey: definition.policyKey, reason };
}

/**
 * Turn a sessioninfo snapshot plus observed 403s into the per-feature verdicts
 * the gate and the UI both read.
 *
 * This is the key's side of the question only. The operator's policy toggles
 * are ANDed in by requireFeature() in capability-gate.mjs, so a feature can be
 * allowed here and still refused there.
 */
export function deriveCapabilities({ sessionInfo, evidence, generation, now = Date.now() } = {}) {
  const info = isPlainObject(sessionInfo) ? sessionInfo : undefined;
  const scopes = decodeScopes(info?.oauth2Scopes);
  const group = typeof info?.planGroup === 'string' ? info.planGroup : null;
  // Free is the only plan whose limits this project has actually hit (a
  // private-document create returns 409). Anything else, including an unknown
  // plan, is assumed not to carry that limit.
  const isFree = group !== null && group.toLowerCase() === 'free';
  const plan = Object.freeze({
    group,
    isFree,
    canCreatePrivateDocuments: !isFree
  });

  const features = {};
  for (const [key, definition] of Object.entries(FEATURES)) {
    features[key] = Object.freeze(featureRecord({ key, definition, scopes, plan, evidence, now, generation }));
  }

  return Object.freeze({
    known: Boolean(info),
    scopes,
    plan,
    roles: info?.roles ? [...info.roles] : [],
    accountName: info?.name,
    features: Object.freeze(features)
  });
}

/**
 * Short badge copy for the granted scopes, e.g. "read · write". Returns an
 * empty string when the mask is unknown, so a caller can hide the element
 * rather than print a confident-looking blank.
 */
export function summarizeScopes(scopes) {
  if (!scopes?.known) return '';
  const granted = Object.keys(SCOPE_BITS).filter((name) => scopes[name]);
  if (!granted.length) return 'no scopes';
  return granted.join(' · ');
}
