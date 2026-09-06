import { OnshapeApi, OnshapeApiError, AuthRequiredError } from './onshape-api.mjs';
import { pickSessionInfo, deriveCapabilities } from './capabilities.mjs';

export const PROBE_TIMEOUT_MS = 8_000;
export const PROBE_REASONS = Object.freeze([
  'REJECTED',
  'FORBIDDEN',
  'ONSHAPE_RATE_LIMITED',
  'ONSHAPE_ERROR',
  'UNREACHABLE',
  'TIMEOUT',
  'BAD_STACK_URL',
  'NOT_CONFIGURED'
]);

const POSITIVE_TTL_MS = 60_000;
const NEGATIVE_TTL_FLOOR_MS = 5_000;
const NEGATIVE_TTL_CAP_MS = 60_000;

// GET /api/connection?force=1 is deliberately reachable cross-origin (it has
// to work from an Onshape-embedded iframe, so it cannot carry the setup
// wizard's loopback/CSRF gates). Without a floor, `force` bypasses the TTL
// cache entirely, so a page the victim merely visits could trigger unbounded
// live Onshape probes through a plain cross-site <img> or no-cors fetch: no
// cookie is required, since a session-scoped limiter would just see a fresh,
// unthrottled session on every such request. This floor is keyed by the
// cache slot itself (server-wide, or per Onshape session for oauth), not by
// caller identity, so dropping cookies cannot reset it.
const FORCE_MIN_INTERVAL_MS = 3_000;

const REASON_TO_STATE = Object.freeze({
  REJECTED: 'rejected',
  FORBIDDEN: 'forbidden',
  UNREACHABLE: 'unreachable',
  TIMEOUT: 'unreachable',
  ONSHAPE_RATE_LIMITED: 'error',
  ONSHAPE_ERROR: 'error',
  BAD_STACK_URL: 'error',
  NOT_CONFIGURED: 'unconfigured'
});

// One slot for every server-wide auth mode (api-key, api-key-signature,
// bearer): they all share a single set of credentials, so there is nothing
// to key by session. OAuth uses session.connectionProbe instead, because its
// credential is the session's own token.
let serverCache = null;

function negativeTtlMs(failureStreak) {
  const doublings = Math.max(0, failureStreak - 1);
  return Math.min(NEGATIVE_TTL_FLOOR_MS * (2 ** doublings), NEGATIVE_TTL_CAP_MS);
}

function safeHost(onshapeBaseUrl) {
  try {
    return new URL(onshapeBaseUrl).host;
  } catch {
    return String(onshapeBaseUrl || '');
  }
}

function reasonToState(reason) {
  return REASON_TO_STATE[reason] || 'error';
}

/**
 * Map a thrown probe error to one of the fixed PROBE_REASONS. Never reads
 * error.body: an Onshape error body can echo request material, and nothing
 * downstream of this function may see it, in any NODE_ENV.
 */
export function classifyProbeError(error) {
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return { reason: 'TIMEOUT' };
  if (error instanceof AuthRequiredError) return { reason: 'NOT_CONFIGURED' };
  if (error instanceof OnshapeApiError) {
    if (error.status === 401) return { reason: 'REJECTED', status: error.status };
    if (error.status === 403) return { reason: 'FORBIDDEN', status: error.status };
    if (error.status === 429) return { reason: 'ONSHAPE_RATE_LIMITED', status: error.status };
    return { reason: 'ONSHAPE_ERROR', status: error.status };
  }
  if (error instanceof TypeError) return { reason: 'UNREACHABLE' };
  return { reason: 'ONSHAPE_ERROR' };
}

/**
 * Test one credential set against Onshape's own account endpoint. Uncached
 * and ungated: this is the one place a candidate credential (still not the
 * live config) gets probed, which is exactly what the setup wizard needs.
 */
export async function probeCredentials(config, { fetchImpl, timeoutMs = PROBE_TIMEOUT_MS, session } = {}) {
  const api = new OnshapeApi(() => config, fetchImpl ? { fetchImpl } : {});
  const controller = new AbortController();
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      const timeoutError = new Error('Onshape did not respond before the probe timeout.');
      timeoutError.name = 'TimeoutError';
      reject(timeoutError);
    }, timeoutMs);
    // A pending timer must never keep the event loop (and therefore a test
    // runner) alive.
    timer.unref?.();
  });

  try {
    const data = await Promise.race([
      api.requestJson('/users/sessioninfo', { session, signal: controller.signal }),
      timeoutPromise
    ]);
    // pickSessionInfo copies by name, so the email field in this response is
    // dropped here and never reaches a cache, a log, or a browser.
    return { ok: true, accountName: data?.name, accountId: data?.id, sessionInfo: pickSessionInfo(data) };
  } catch (error) {
    const classified = classifyProbeError(error);
    return { ok: false, ...classified };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The truthful, cached connection verdict for the live server config (or, in
 * oauth mode, for one session's tokens).
 *
 * The authMode === 'none' short circuit is unconditional and comes first, not
 * bypassable by force: it is what keeps npm test and npm run check offline.
 */
export async function getConnectionState({ api, config, session, generation, force = false, now = Date.now(), timeoutMs = PROBE_TIMEOUT_MS }) {
  const host = safeHost(config.onshapeBaseUrl);

  if (config.authMode === 'none') {
    return { state: 'unconfigured', host, checkedAt: now };
  }
  if (config.authMode === 'oauth' && !session?.tokens?.accessToken) {
    return { state: 'oauth-required', host, checkedAt: now };
  }

  const scopeKey = config.authMode === 'oauth' ? String(session.id) : 'server';
  const cacheKey = `${generation}:${scopeKey}`;
  const isOAuth = config.authMode === 'oauth';

  let slot = isOAuth ? session.connectionProbe : serverCache;
  if (!slot || slot.key !== cacheKey) {
    slot = { key: cacheKey, entry: null };
    if (isOAuth) session.connectionProbe = slot;
    else serverCache = slot;
  }

  if (slot.entry?.promise) {
    return slot.entry.promise;
  }
  if (!force && slot.entry?.result && now < slot.entry.expiresAt) {
    return slot.entry.result;
  }
  // The force floor only ever holds back a *repeat* forced probe (there is
  // always a prior result once lastAttemptAt is set), so the very first
  // lookup for a key is never delayed by it.
  if (force && slot.entry?.result && now < (slot.entry.lastAttemptAt ?? -Infinity) + FORCE_MIN_INTERVAL_MS) {
    return slot.entry.result;
  }

  const failureStreak = slot.entry?.failureStreak || 0;
  const promise = (async () => {
    const outcome = await probeCredentials(config, { fetchImpl: api?.fetchImpl, session, timeoutMs });
    let result;
    let nextFailureStreak;
    let ttl;
    if (outcome.ok) {
      result = { state: 'connected', accountName: outcome.accountName, host, checkedAt: now, sessionInfo: outcome.sessionInfo };
      nextFailureStreak = 0;
      ttl = POSITIVE_TTL_MS;
    } else {
      result = {
        state: reasonToState(outcome.reason),
        host,
        checkedAt: now,
        reason: outcome.reason,
        ...(outcome.status !== undefined ? { status: outcome.status } : {})
      };
      nextFailureStreak = failureStreak + 1;
      ttl = negativeTtlMs(nextFailureStreak);
    }
    // ttl is measured from the caller-supplied `now`, not the wall clock, so
    // the whole backoff sequence is exercisable with injected time and no
    // real sleeping.
    slot.entry = { failureStreak: nextFailureStreak, expiresAt: now + ttl, lastAttemptAt: now, result, promise: undefined };
    return result;
  })();

  slot.entry = { failureStreak, expiresAt: slot.entry?.expiresAt ?? 0, lastAttemptAt: now, result: slot.entry?.result, promise };
  return promise;
}

/**
 * A non-probing read of the current cached verdict, for /api/bootstrap. It
 * never starts a probe — not even a fire-and-forget one — because a network
 * round trip in front of first paint on every adoptContext() call is exactly
 * the cost this design avoids, and a dropped warmup .catch is its own class
 * of outage.
 */
export function peekConnectionState({ config, session, generation }) {
  const host = safeHost(config.onshapeBaseUrl);
  if (config.authMode === 'none') return { state: 'unconfigured', host };
  if (config.authMode === 'oauth' && !session?.tokens?.accessToken) return { state: 'oauth-required', host };

  const isOAuth = config.authMode === 'oauth';
  const scopeKey = isOAuth ? String(session.id) : 'server';
  const cacheKey = `${generation}:${scopeKey}`;
  const slot = isOAuth ? session.connectionProbe : serverCache;
  if (slot && slot.key === cacheKey && slot.entry?.result && !slot.entry.promise) {
    return slot.entry.result;
  }
  return { state: 'checking', host };
}

/**
 * Adopt a probe result the caller already obtained elsewhere (the setup
 * wizard's own Save re-probe) as this key's cached verdict, so the very next
 * bootstrap/connection call does not re-probe for no reason.
 */
export function seedConnectionState({ generation, session, connection, authMode, now = Date.now() }) {
  const isOAuth = authMode === 'oauth';
  const scopeKey = isOAuth ? String(session.id) : 'server';
  const cacheKey = `${generation}:${scopeKey}`;
  const isPositive = connection.state === 'connected';
  const entry = {
    failureStreak: isPositive ? 0 : 1,
    expiresAt: now + (isPositive ? POSITIVE_TTL_MS : negativeTtlMs(1)),
    lastAttemptAt: now,
    result: connection,
    promise: undefined
  };
  if (isOAuth) session.connectionProbe = { key: cacheKey, entry };
  else serverCache = { key: cacheKey, entry };
}

/** Clear the server-wide cache slot. Mainly a test seam; a store.reload() already invalidates every verdict for free by changing the generation. */
export function invalidateConnectionState() {
  serverCache = null;
}

/**
 * The `auth` object every route returns. `connected` does not exist here on
 * purpose — it used to be computed from credential presence alone and
 * rendered green for a key nobody had verified. `canRequest` says only that
 * the server can attempt an authenticated call.
 *
 * This is also the single choke point where the cached `sessionInfo` snapshot
 * is turned into capabilities and then dropped: every route that answers a
 * browser builds its `auth` object here, so the snapshot cannot leak into a
 * response by way of a route that forgot to strip it.
 */
export function buildAuthSummary(config, session, connection, { now = Date.now(), generation } = {}) {
  const oauthConnected = Boolean(session?.tokens?.accessToken);
  const mode = config.authMode;
  const requiresAuthorization = mode === 'oauth' && !oauthConnected;
  const canRequest = mode !== 'none' && !requiresAuthorization;
  const { sessionInfo, ...rest } = connection || {};
  return {
    mode,
    configured: mode !== 'none',
    canRequest,
    requiresAuthorization,
    oauthConnected,
    connection: connection ? rest : connection,
    capabilities: deriveCapabilities({
      sessionInfo,
      evidence: session?.capabilityEvidence,
      generation,
      now
    })
  };
}
