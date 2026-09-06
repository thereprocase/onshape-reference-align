import { readJson } from './http.mjs';
import { setupGuardFailure } from './loopback-guard.mjs';
import { takeRateLimitToken } from './session.mjs';
import { applyEnvUpdates } from './env-file.mjs';
import { buildConfig } from './config.mjs';
import { userConfigDir } from './config-paths.mjs';
import { probeCredentials, seedConnectionState, buildAuthSummary, PROBE_TIMEOUT_MS } from './connection-probe.mjs';
import { clearAllCapabilityEvidence, featureGateReasons } from './capability-gate.mjs';

// Header injection defence (no whitespace, no CR/LF) plus a bounded length.
// Deliberately not alphanumeric-only: rejecting a valid key is an
// unexplainable wall, whereas a clean 401 from a bad-but-well-formed key is
// an accurate diagnosis.
const KEY_PATTERN = /^[A-Za-z0-9+/=_-]{16,256}$/;

// A malformed base URL or an unreachable/rate-limited/server-error upstream
// is a fact about the network or Onshape's side, not about the key itself,
// so Save may still record it when the operator explicitly says so. A
// rejected or forbidden key, and a base URL this server refuses outright,
// are ours to refuse regardless of confirmUntested.
const CONFIRM_UNTESTED_REASONS = Object.freeze(['UNREACHABLE', 'TIMEOUT', 'ONSHAPE_RATE_LIMITED', 'ONSHAPE_ERROR']);

function safeHost(onshapeBaseUrl) {
  try {
    return new URL(onshapeBaseUrl).host;
  } catch {
    return String(onshapeBaseUrl || '');
  }
}

function validateSubmittedKeys(body) {
  const accessKey = typeof body?.accessKey === 'string' ? body.accessKey : '';
  const secretKey = typeof body?.secretKey === 'string' ? body.secretKey : '';
  if (!accessKey) {
    return { ok: false, message: 'The access key is missing.' };
  }
  if (!KEY_PATTERN.test(accessKey)) {
    return { ok: false, message: 'The access key is not in a format Onshape issues.' };
  }
  if (!secretKey) {
    return { ok: false, message: 'The secret key is missing.' };
  }
  if (!KEY_PATTERN.test(secretKey)) {
    return { ok: false, message: 'The secret key is not in a format Onshape issues.' };
  }
  let baseUrl;
  if (typeof body?.baseUrl === 'string' && body.baseUrl.trim()) {
    baseUrl = body.baseUrl.trim();
  }
  return { ok: true, accessKey, secretKey, baseUrl };
}

function candidateConfig({ accessKey, secretKey, baseUrl }) {
  // Reuses buildConfig's own validation (https-or-loopback origin, auth mode
  // requirements) instead of re-implementing it, so a bad address fails the
  // exact same way it would in the real config file.
  return buildConfig({
    fileEnv: {
      ONSHAPE_AUTH: 'api-key-signature',
      ONSHAPE_ACCESS_KEY: accessKey,
      ONSHAPE_SECRET_KEY: secretKey,
      ...(baseUrl ? { ONSHAPE_BASE_URL: baseUrl } : {})
    },
    env: {}
  });
}

function probeResponseBody(probe, host) {
  if (probe.ok) return { ok: true, accountName: probe.accountName, accountId: probe.accountId, host };
  const body = { ok: false, reason: probe.reason };
  if (probe.status !== undefined) body.status = probe.status;
  if (probe.reason === 'TIMEOUT') body.timeoutSeconds = Math.round(PROBE_TIMEOUT_MS / 1000);
  return body;
}

/**
 * Routes for the loopback-only setup wizard: GET /api/setup (status),
 * POST /api/setup/test (uncached probe of candidate credentials), and
 * POST /api/setup/save (re-probe, then write and reload).
 *
 * CSRF is deliberately not checked here: server.mjs gates it over the
 * pathnames src/routes.mjs registers, which cover '/api/setup/test' and
 * '/api/setup/save' before this module is ever reached, and a second
 * implementation here would be a second place for that gate to drift out of
 * sync. Every gate this module does own
 * runs in the cheapest-first order the design specifies, and the rate-limit
 * token is taken only immediately before the one live network call each
 * request may make.
 *
 * `settingsStore` is optional; when supplied, a successful save's response
 * carries `gates` computed against the credential that was just written, the
 * same shape /api/bootstrap and /api/connection send, so the browser never
 * has to keep showing gate text for the key that was just replaced.
 */
export function createSetupRoutes({ store, sendJson, fetchImpl, settingsStore = { current: () => ({}) } }) {
  async function handleSetup(req, res, url, session) {
    if (!url.pathname.startsWith('/api/setup')) return false;

    const config = store.current();
    const guardFailure = setupGuardFailure(req, config);
    if (guardFailure) {
      // The fine-grained reason is for the operator's own console, never the
      // response body.
      console.error(`Setup route refused (${req.method} ${url.pathname}): ${guardFailure.internalReason}`);
      sendJson(res, guardFailure.status, {
        error: guardFailure.message,
        code: guardFailure.code,
        reason: guardFailure.reason
      });
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/setup') {
      sendJson(res, 200, {
        available: true,
        configPath: store.envFilePath,
        configSource: store.envFileSource,
        configExists: store.envFileExists(),
        writable: true,
        userConfigDir: userConfigDir(),
        restartRequired: [],
        authMode: config.authMode
      });
      return true;
    }

    const isTest = req.method === 'POST' && url.pathname === '/api/setup/test';
    const isSave = req.method === 'POST' && url.pathname === '/api/setup/save';
    if (!isTest && !isSave) return false;

    let body;
    try {
      body = await readJson(req, { maxBytes: 4096 });
    } catch (error) {
      sendJson(res, error.status || 400, { error: error.message, code: error.status === 413 ? 'PAYLOAD_TOO_LARGE' : 'INVALID_JSON' });
      return true;
    }

    const validation = validateSubmittedKeys(body);
    if (!validation.ok) {
      sendJson(res, 400, { error: validation.message, code: 'INVALID_KEY_FORMAT' });
      return true;
    }

    if (isSave && config.authMode !== 'none' && body.confirm !== true) {
      sendJson(res, 409, {
        error: 'Onshape is already configured. Confirm to replace the existing credentials.',
        code: 'CONFIRMATION_REQUIRED'
      });
      return true;
    }

    const rate = takeRateLimitToken(session, 'setup-probe');
    if (!rate.ok) {
      res.setHeader('Retry-After', String(rate.retryAfterSeconds));
      sendJson(res, 429, {
        error: 'Too many setup attempts. Wait and try again.',
        code: 'SETUP_RATE_LIMITED',
        retryAfterSeconds: rate.retryAfterSeconds
      });
      return true;
    }

    let candidate;
    try {
      candidate = candidateConfig(validation);
    } catch {
      // A bad candidate base URL is a diagnosis, not a fault: report it the
      // same way a failed live probe would, at 200.
      sendJson(res, 200, { ok: false, reason: 'BAD_STACK_URL' });
      return true;
    }

    const probe = await probeCredentials(candidate, { fetchImpl });
    const host = safeHost(candidate.onshapeBaseUrl);

    if (isTest) {
      sendJson(res, 200, probeResponseBody(probe, host));
      return true;
    }

    // Save re-probes independently; it never trusts a client claim that Test
    // already passed, and a failed probe is only written when the operator
    // explicitly said to save it anyway and the reason is one this server
    // does not consider a verdict on the key itself.
    if (!probe.ok && !(CONFIRM_UNTESTED_REASONS.includes(probe.reason) && body.confirmUntested === true)) {
      sendJson(res, 200, probeResponseBody(probe, host));
      return true;
    }

    const updates = {
      ONSHAPE_AUTH: 'api-key-signature',
      ONSHAPE_ACCESS_KEY: validation.accessKey,
      ONSHAPE_SECRET_KEY: validation.secretKey
    };
    if (validation.baseUrl) updates.ONSHAPE_BASE_URL = validation.baseUrl;

    try {
      await applyEnvUpdates(store.envFilePath, updates);
    } catch (error) {
      sendJson(res, 500, {
        error: `Could not write the configuration file at ${store.envFilePath} (${error.code || error.message}).`,
        code: 'CONFIG_WRITE_FAILED',
        configPath: store.envFilePath
      });
      return true;
    }

    let reloadResult;
    try {
      reloadResult = store.reload();
    } catch (error) {
      sendJson(res, 500, {
        error: `The configuration file was saved but could not be reloaded: ${error.message}`,
        code: 'CONFIG_RELOAD_FAILED'
      });
      return true;
    }

    // buildConfig layers process.env on top of the file on every reload (see
    // its own comment: a variable set by the OS or launcher is meant to win).
    // That is correct for HOST/PORT-style launcher configuration, but it
    // means a real ONSHAPE_ACCESS_KEY/SECRET_KEY/BASE_URL/AUTH left over in
    // this process's environment silently discards exactly what this request
    // just wrote to the file. `candidate` was built with env: {}, so it is
    // ground truth for what the wizard tried to save; comparing it against
    // what the reload actually produced catches that shadowing before this
    // route tells the operator they are connected.
    const shadowedKeys = [];
    if (reloadResult.config.authMode !== candidate.authMode) shadowedKeys.push('ONSHAPE_AUTH');
    if (reloadResult.config.accessKey !== candidate.accessKey) shadowedKeys.push('ONSHAPE_ACCESS_KEY');
    if (reloadResult.config.secretKey !== candidate.secretKey) shadowedKeys.push('ONSHAPE_SECRET_KEY');
    if (validation.baseUrl && reloadResult.config.onshapeBaseUrl !== candidate.onshapeBaseUrl) shadowedKeys.push('ONSHAPE_BASE_URL');
    if (shadowedKeys.length > 0) {
      const plural = shadowedKeys.length > 1;
      sendJson(res, 500, {
        error: `The configuration file was saved, but ${shadowedKeys.join(', ')} ${plural ? 'are' : 'is'} set in this server's own environment, which always overrides the file. The new credentials were written but are not in effect; remove ${plural ? 'those variables' : 'that variable'} from the server's environment, then retry.`,
        code: 'CONFIG_SHADOWED_BY_ENVIRONMENT',
        shadowedKeys,
        configPath: store.envFilePath
      });
      return true;
    }

    const connection = probe.ok
      ? { state: 'connected', accountName: probe.accountName, host: safeHost(reloadResult.config.onshapeBaseUrl), checkedAt: Date.now(), sessionInfo: probe.sessionInfo }
      : { state: 'checking', host: safeHost(reloadResult.config.onshapeBaseUrl), checkedAt: Date.now() };
    seedConnectionState({ generation: store.generation, session, connection, authMode: 'api-key-signature' });
    // A 403 observed under the previous key says nothing about this one.
    clearAllCapabilityEvidence(session);

    const auth = buildAuthSummary(reloadResult.config, session, connection, { generation: store.generation });
    sendJson(res, 200, {
      ok: true,
      auth,
      gates: featureGateReasons({ capabilities: auth.capabilities, policy: settingsStore.current() }),
      configPath: store.envFilePath,
      restartRequired: reloadResult.restartRequired
    });
    return true;
  }

  return { handleSetup };
}
