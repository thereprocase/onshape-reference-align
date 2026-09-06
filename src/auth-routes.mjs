// The OAuth flow and the session's own logout.
//
//   POST /auth/logout     — drop this session's tokens
//   GET  /auth/start      — redirect into Onshape's authorization page
//   GET  /oauth/callback  — exchange the code, then return where we came from
//
// Extracted from server.mjs for the same reason the write routes were: a route
// body in the dispatcher is a route body nobody holds next to its neighbours.
// POST '/auth/logout' had already shown what that costs — it sat inside the
// '/api/' branch, which the router never enters for an '/auth/' pathname, so a
// route the registry marked CSRF-gated had no gate on it at all.
//
// The CSRF check itself is not here. It runs above every dispatch chain in
// server.mjs, from CSRF_PATHS in src/routes.mjs; a second check in this module
// would be a second rule that can disagree with the registry.
//
// This file is imported into the SEA bundle, so it uses `export function`
// declarations and named relative imports only — scripts/build-sea-bundle.mjs
// refuses anything else.

import { clearOAuthTokens, consumeOAuthState } from './session.mjs';

/** The first of several query parameter spellings that carries a value. */
function firstQuery(url, names) {
  for (const name of names) {
    const value = url.searchParams.get(name);
    if (value) return value;
  }
  return undefined;
}

export function createAuthRoutes({ api, config, sendJson, sendText, redirect }) {
  async function handleAuth(req, res, url, session) {
    if (req.method === 'POST' && url.pathname === '/auth/logout') {
      clearOAuthTokens(session);
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/auth/start') {
      if (config().authMode !== 'oauth') {
        sendText(res, 400, 'OAuth is not configured for this server.');
        return true;
      }
      const returnTo = firstQuery(url, ['returnTo']) || '/';
      const companyId = firstQuery(url, ['companyId', 'sessionCompanyId']);
      redirect(res, api.authorizationUrl(session, returnTo, companyId));
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/oauth/callback') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const oauthError = url.searchParams.get('error');
      if (oauthError) {
        sendText(res, 400, `Onshape authorization failed: ${oauthError}`);
        return true;
      }
      // One use per issued state, and an expired one is not a use. Checked
      // before the code is spent, so a replayed callback costs nothing.
      if (!code || !consumeOAuthState(session, state)) {
        sendText(res, 400, 'Invalid or expired OAuth callback state.');
        return true;
      }
      await api.exchangeAuthorizationCode(session, code);
      redirect(res, session.returnTo || '/');
      return true;
    }

    return false;
  }

  return { handleAuth };
}
