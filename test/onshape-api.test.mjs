import test from 'node:test';
import assert from 'node:assert/strict';

import { OnshapeApi, createOnshapeRequestSignature, encodeMultipartBody } from '../src/onshape-api.mjs';

test('Onshape request signature matches the documented canonical form', () => {
  const authorization = createOnshapeRequestSignature({
    method: 'GET',
    url: 'https://cad.onshape.com/api/v17/documents?a=1&b=2',
    nonce: '0123456789abcdef',
    date: 'Mon, 11 Apr 2016 20:08:56 GMT',
    contentType: 'application/json',
    accessKey: 'ACCESS',
    secretKey: 'SECRET'
  });

  assert.equal(
    authorization,
    'On ACCESS:HmacSHA256:t9Amyusm4UxU57b6NvoVq2Xtw7G6NEiUd9OR7rcD53k='
  );
});

test('Onshape request signature includes an empty query line when no query exists', () => {
  const withoutQuery = createOnshapeRequestSignature({
    method: 'POST',
    url: 'https://cad.onshape.com/api/v17/partstudios/d/doc/w/ws/e/el/features',
    nonce: 'abcdefghijklmnop',
    date: 'Fri, 04 Sep 2026 20:00:00 GMT',
    contentType: 'application/json;charset=UTF-8; qs=0.09',
    accessKey: 'A',
    secretKey: 'S'
  });

  const withEmptyQueryMarker = createOnshapeRequestSignature({
    method: 'POST',
    url: 'https://cad.onshape.com/api/v17/partstudios/d/doc/w/ws/e/el/features?',
    nonce: 'abcdefghijklmnop',
    date: 'Fri, 04 Sep 2026 20:00:00 GMT',
    contentType: 'application/json;charset=UTF-8; qs=0.09',
    accessKey: 'A',
    secretKey: 'S'
  });

  assert.equal(withoutQuery, withEmptyQueryMarker);
});

test('multipart bodies are materialized with a Content-Type the signature can cover', async () => {
  const form = new FormData();
  form.append('encodedFilename', 'reference-align-icon.png');
  form.append('file', new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }), 'icon.png');

  const { rawBody, rawContentType } = await encodeMultipartBody(form);

  assert.match(rawContentType, /^multipart\/form-data; boundary=.+/);
  const boundary = rawContentType.split('boundary=')[1];
  const text = rawBody.toString('latin1');
  assert.ok(text.startsWith(`--${boundary}\r\n`));
  assert.ok(text.endsWith(`--${boundary}--\r\n`));
  assert.match(text, /name="encodedFilename"/);
  assert.match(text, /name="file"; filename="icon\.png"/);
  assert.match(text, /Content-Type: image\/png/);
  assert.ok(text.includes('\x89PNG'));

  // The signature must be computable from the same Content-Type string, which is
  // only possible because the boundary is decided before the request is sent.
  const authorization = createOnshapeRequestSignature({
    method: 'POST',
    url: 'https://cad.onshape.com/api/v17/blobelements/d/doc/w/ws',
    nonce: 'abcdefghijklmnop',
    date: 'Fri, 04 Sep 2026 20:00:00 GMT',
    contentType: rawContentType,
    accessKey: 'A',
    secretKey: 'S'
  });
  assert.match(authorization, /^On A:HmacSHA256:.+=$/);
});

test('a raw body without an explicit content type is refused before any network call', async () => {
  const api = new OnshapeApi({
    onshapeBaseUrl: 'https://cad.onshape.com',
    apiVersion: 'v17',
    authMode: 'api-key-signature',
    accessKey: 'A',
    secretKey: 'S'
  });

  await assert.rejects(
    () => api.request('/blobelements/d/doc/w/ws', { method: 'POST', rawBody: Buffer.from('x') }),
    /rawContentType/
  );
});

test('the object-literal constructor form keeps working', () => {
  const api = new OnshapeApi({ onshapeBaseUrl: 'https://cad.onshape.com', apiVersion: 'v17' });
  assert.equal(api.apiRoot, 'https://cad.onshape.com/api/v17');
});

test('a config getter is re-read on every access, with no reconstruction', () => {
  let live = { onshapeBaseUrl: 'https://cad.onshape.com', apiVersion: 'v17' };
  const api = new OnshapeApi(() => live);
  assert.equal(api.apiRoot, 'https://cad.onshape.com/api/v17');

  live = { onshapeBaseUrl: 'https://acme.onshape.com', apiVersion: 'v18' };
  assert.equal(api.apiRoot, 'https://acme.onshape.com/api/v18');
  assert.equal(api.config.apiVersion, 'v18');
});

test('an injected fetch receives the request and forwards the abort signal', async () => {
  const calls = [];
  const api = new OnshapeApi(
    {
      onshapeBaseUrl: 'https://cad.onshape.com',
      apiVersion: 'v17',
      authMode: 'api-key-signature',
      accessKey: 'A',
      secretKey: 'S'
    },
    {
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return new Response(JSON.stringify({ name: 'Test User' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
  );

  const controller = new AbortController();
  const body = await api.requestJson('/users/sessioninfo', { signal: controller.signal });

  assert.deepEqual(body, { name: 'Test User' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://cad.onshape.com/api/v17/users/sessioninfo');
  assert.equal(calls[0].options.signal, controller.signal);
  assert.match(calls[0].options.headers.Authorization, /^On A:HmacSHA256:/);
});

test('the default fetch implementation resolves through globalThis at call time', async () => {
  const api = new OnshapeApi({
    onshapeBaseUrl: 'https://cad.onshape.com',
    apiVersion: 'v17',
    authMode: 'bearer',
    bearerToken: 'token'
  });

  const realFetch = globalThis.fetch;
  let seenUrl;
  try {
    globalThis.fetch = async (url) => {
      seenUrl = url;
      return new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    assert.deepEqual(await api.requestJson('/users/sessioninfo'), { ok: true });
    assert.equal(seenUrl, 'https://cad.onshape.com/api/v17/users/sessioninfo');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a config reload mid-flight does not mix old and new credentials across a redirect', async () => {
  let live = {
    onshapeBaseUrl: 'https://cad.onshape.com',
    apiVersion: 'v17',
    authMode: 'api-key-signature',
    accessKey: 'OLD',
    secretKey: 'OLD-SECRET'
  };
  const seenAuthorizations = [];
  const api = new OnshapeApi(() => live, {
    fetchImpl: async (url, options) => {
      seenAuthorizations.push(options.headers.Authorization);
      if (seenAuthorizations.length === 1) {
        // Simulate the setup wizard saving new credentials (session.mjs
        // reload()) while this request's first attempt is still in flight.
        live = { ...live, accessKey: 'NEW', secretKey: 'NEW-SECRET' };
        return new Response(null, {
          status: 302,
          headers: { Location: 'https://cad.onshape.com/api/v17/users/sessioninfo?retry=1' }
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  });

  await api.requestJson('/users/sessioninfo');

  assert.equal(seenAuthorizations.length, 2);
  // Both attempts belong to the same logical request, so both must be signed
  // with the credentials captured when the request started, not whatever the
  // config getter returns by the time the redirected retry is sent.
  assert.match(seenAuthorizations[0], /^On OLD:HmacSHA256:/);
  assert.match(seenAuthorizations[1], /^On OLD:HmacSHA256:/);
});
