import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import { createResponders, readJson, MAX_JSON_BYTES } from '../src/http.mjs';

function fakeRequest(body) {
  return Readable.from([Buffer.from(body)]);
}

function fakeResponse() {
  return {
    status: undefined,
    headers: undefined,
    body: undefined,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    }
  };
}

test('readJson parses a JSON body and treats an empty body as an empty object', async () => {
  assert.deepEqual(await readJson(fakeRequest('{"a":1}')), { a: 1 });
  assert.deepEqual(await readJson(Readable.from([])), {});
});

test('readJson rejects an oversize body with status 413', async () => {
  await assert.rejects(
    () => readJson(fakeRequest('x'.repeat(64)), { maxBytes: 16 }),
    (error) => error.status === 413
  );
});

test('readJson rejects malformed JSON with status 400', async () => {
  await assert.rejects(() => readJson(fakeRequest('{nope')), (error) => error.status === 400);
});

test('the default body cap is one megabyte', () => {
  assert.equal(MAX_JSON_BYTES, 1_000_000);
});

test('responders emit indented JSON only when pretty is set, and never cache', () => {
  const pretty = fakeResponse();
  createResponders({ pretty: true }).sendJson(pretty, 200, { ok: true });
  assert.equal(pretty.body, '{\n  "ok": true\n}');
  assert.equal(pretty.headers['Cache-Control'], 'no-store');

  const compact = fakeResponse();
  createResponders().sendJson(compact, 201, { ok: true });
  assert.equal(compact.status, 201);
  assert.equal(compact.body, '{"ok":true}');
  assert.equal(compact.headers['Cache-Control'], 'no-store');
  assert.equal(compact.headers['Content-Length'], Buffer.byteLength('{"ok":true}'));
});

test('sendText and redirect carry the documented headers', () => {
  const { sendText, redirect } = createResponders();

  const text = fakeResponse();
  sendText(text, 404, 'Not found.');
  assert.equal(text.status, 404);
  assert.equal(text.body, 'Not found.');
  assert.equal(text.headers['Content-Type'], 'text/plain; charset=utf-8');

  const moved = fakeResponse();
  redirect(moved, '/target');
  assert.equal(moved.status, 302);
  assert.equal(moved.headers.Location, '/target');
});
