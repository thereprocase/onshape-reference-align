export const MAX_JSON_BYTES = 1_000_000;

/**
 * Build the JSON/text/redirect responders.
 *
 * `pretty` is decided once at construction rather than read per call: it comes
 * from NODE_ENV, which is boot-pinned, so re-reading it on every response would
 * only invite the illusion that it can change while the process runs.
 */
export function createResponders({ pretty = false } = {}) {
  function closeIncompleteRequest(res) {
    // All routes, including setup/settings refusals, use these responders.
    // A response before the request body finishes must not retain a socket
    // waiting for bytes that may never arrive. Flush the response first.
    const req = res.req;
    if (req?.complete === false) {
      res.setHeader('Connection', 'close');
      res.once('finish', () => req.destroy());
    }
  }

  function sendJson(res, status, data) {
    const body = JSON.stringify(data, null, pretty ? 2 : 0);
    closeIncompleteRequest(res);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store'
    });
    res.end(body);
  }

  function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
    const body = String(text);
    closeIncompleteRequest(res);
    res.writeHead(status, {
      'Content-Type': contentType,
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store'
    });
    res.end(body);
  }

  function redirect(res, location, status = 302) {
    closeIncompleteRequest(res);
    res.writeHead(status, { Location: location, 'Cache-Control': 'no-store' });
    res.end();
  }

  return { sendJson, sendText, redirect };
}

export async function readJson(req, { maxBytes = MAX_JSON_BYTES } = {}) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBytes) {
      const error = new Error('Request body is too large.');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Request body is not valid JSON.');
    error.status = 400;
    throw error;
  }
}
