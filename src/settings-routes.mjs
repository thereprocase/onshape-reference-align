import { readJson } from './http.mjs';
import { setupGuardFailure } from './loopback-guard.mjs';
import { validateSettingsPatch, DEFAULT_SETTINGS } from './settings.mjs';
import { POLICY_LABELS } from './capabilities.mjs';

/**
 * GET and POST /api/settings — the operator's policy toggles.
 *
 * Same trust boundary as the setup wizard, and deliberately the same code
 * enforcing it: setupGuardFailure() from src/loopback-guard.mjs. Changing what
 * this server is willing to write to someone's Onshape account is at least as
 * sensitive as pasting a key into it, so it gets no weaker a gate.
 *
 * CSRF is not checked here. POST '/api/settings' is a registered route in
 * src/routes.mjs, so server.mjs's gate already covers it, exactly as it covers
 * '/api/setup/test' and '/api/setup/save'; a second implementation here would
 * be a second place for that gate to drift.
 *
 * `gates(session)` is optional and, when supplied, is the same
 * featureGateReasons() output GET /api/bootstrap and GET /api/connection send
 * — recomputed against whatever this request just saved, not the stale copy
 * the browser had before the save. Without it the response simply omits
 * `gates`, which is what every existing caller of this factory still gets.
 */
export function createSettingsRoutes({ store, settingsStore, sendJson, gates }) {
  function body(session, extra = {}) {
    return {
      settings: settingsStore.current(),
      defaults: DEFAULT_SETTINGS,
      labels: POLICY_LABELS,
      warnings: settingsStore.warnings(),
      settingsPath: settingsStore.filePath,
      exists: settingsStore.exists(),
      gates: gates ? gates(session) : undefined,
      ...extra
    };
  }

  async function handleSettings(req, res, url, session) {
    if (url.pathname !== '/api/settings') return false;
    if (req.method !== 'GET' && req.method !== 'POST') return false;

    const guardFailure = setupGuardFailure(req, store.current());
    if (guardFailure) {
      // Coarse reason to the client, fine-grained reason to the operator's own
      // console only — same split as the setup routes.
      console.error(`Settings route refused (${req.method} ${url.pathname}): ${guardFailure.internalReason}`);
      sendJson(res, guardFailure.status, {
        error: guardFailure.message,
        code: guardFailure.code,
        reason: guardFailure.reason
      });
      return true;
    }

    if (req.method === 'GET') {
      sendJson(res, 200, body(session));
      return true;
    }

    let payload;
    try {
      payload = await readJson(req, { maxBytes: 4096 });
    } catch (error) {
      sendJson(res, error.status || 400, {
        error: error.message,
        code: error.status === 413 ? 'PAYLOAD_TOO_LARGE' : 'INVALID_JSON'
      });
      return true;
    }

    const validation = validateSettingsPatch(payload?.settings ?? payload);
    if (!validation.ok) {
      sendJson(res, 400, { error: validation.message, code: 'INVALID_SETTINGS' });
      return true;
    }

    let saved;
    try {
      saved = await settingsStore.save(validation.patch);
    } catch (error) {
      sendJson(res, 500, {
        error: `Could not write the settings file at ${settingsStore.filePath} (${error.code || error.message}).`,
        code: 'SETTINGS_WRITE_FAILED',
        settingsPath: settingsStore.filePath
      });
      return true;
    }

    sendJson(res, 200, body(session, { ok: true, settings: saved }));
    return true;
  }

  return { handleSettings };
}
