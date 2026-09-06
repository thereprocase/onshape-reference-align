// A stand-in for Onshape's own API, bound to 127.0.0.1 only, promoted out of
// scripts/smoke.mjs so a test can stand up the same fake credential-check and
// document endpoints scripts/smoke.mjs uses, without owning a second copy.
//
// It answers /users/sessioninfo the way Onshape's own endpoint does, and
// hands every other request to test/fixtures/onshape-document-stub.mjs's
// document stub, which answers the install/upload/rebind/apply write shapes
// captured under docs/experiments/.

import http from 'node:http';

import { createDocumentStub, STUB_DOCUMENT } from '../fixtures/onshape-document-stub.mjs';

export { STUB_DOCUMENT };

// baseUrl must be included on every request a caller sends through this
// stub's credentials: omitting it would make the candidate default to the
// real cad.onshape.com, and nothing in a test run may reach that host.
export const DEFAULT_KEYS = Object.freeze({ accessKey: 'smoke-access-key-0001', secretKey: 'smoke-secret-key-0001' });

// The stub's sessioninfo carries an email exactly as Onshape's does. Nothing
// a server under test sends back or logs may ever contain it.
export const DEFAULT_STUB_EMAIL = 'smoke-user@example.invalid';

/**
 * Creates one fake Onshape backend: a sessioninfo probe answering the given
 * validKeys, backed by one document stub answering install/upload/rebind.
 *
 * state.scopes is mutable so a caller can hand out a second, weaker key
 * later and watch the capability model follow it, exactly as
 * scripts/smoke.mjs does across a credentials downgrade.
 */
export function createOnshapeStub({ validKeys = DEFAULT_KEYS, email = DEFAULT_STUB_EMAIL, scopes = 4099 } = {}) {
  const state = { requestCount: 0, remoteAddresses: new Set(), scopes };
  const documentStub = createDocumentStub();
  state.document = documentStub.state;
  const server = http.createServer(async (req, res) => {
    state.requestCount += 1;
    state.remoteAddresses.add(req.socket.remoteAddress);
    if (req.url?.startsWith('/api/v17/users/sessioninfo')) {
      const authorization = req.headers.authorization || '';
      if (authorization.startsWith(`On ${validKeys.accessKey}:`)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        // Shaped like the real response, including the email field Onshape
        // sends and this app must never keep.
        res.end(JSON.stringify({
          name: 'Smoke Test User',
          id: 'smoke-user-id',
          email,
          oauth2Scopes: state.scopes,
          planGroup: 'Free',
          roles: ['USER', 'DEVELOPER'],
          companyPlan: false
        }));
        return;
      }
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'invalid key' }));
      return;
    }
    const authorization = req.headers.authorization || '';
    if (!authorization.startsWith(`On ${validKeys.accessKey}:`)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'invalid key' }));
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (await documentStub.handle(req, res, Buffer.concat(chunks))) return;
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
  return { server, state, documentStub, validKeys, email };
}
