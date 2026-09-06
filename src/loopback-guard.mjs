// Gate for the setup wizard: it must never accept a request that did not
// originate as a direct, unproxied loopback connection from this machine's
// own browser. Every check here fails closed on missing or ambiguous input.

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const FORWARDED_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-port', 'forwarded'];

const COARSE_REASON = Object.freeze({
  PUBLIC_BASE_URL_HTTPS: 'HTTPS_PUBLIC_URL',
  // Distinct from LOCAL_SOCKET_NOT_LOOPBACK: this one means the operator's own
  // HOST setting (e.g. the Dockerfile's HOST=0.0.0.0 default) turned the guard
  // on, not that the request came from another machine. The generic
  // "only available on the computer running this program" message is wrong
  // for a local user in that case, so it gets its own reason and copy.
  SERVER_NOT_LOOPBACK_BOUND: 'HOST_NOT_LOOPBACK',
  FORWARDED_HEADER_PRESENT: 'FORWARDED_HEADER',
  REMOTE_ADDRESS_NOT_LOOPBACK: 'REMOTE_CLIENT',
  LOCAL_SOCKET_NOT_LOOPBACK: 'NOT_LOOPBACK',
  ORIGIN_MALFORMED: 'ORIGIN_REJECTED',
  ORIGIN_MISMATCH: 'ORIGIN_REJECTED',
  HOST_MISMATCH: 'ORIGIN_REJECTED'
});

const COARSE_MESSAGE = Object.freeze({
  NOT_LOOPBACK: 'Setup from a browser is only available on the computer running this program. Set ONSHAPE_ACCESS_KEY and ONSHAPE_SECRET_KEY in the server’s configuration file — its path is printed in the server’s startup log — then restart it.',
  HOST_NOT_LOOPBACK: 'This server is listening on all network interfaces (HOST is not 127.0.0.1), so browser setup is turned off. Set HOST=127.0.0.1 and restart, or set ONSHAPE_ACCESS_KEY and ONSHAPE_SECRET_KEY in the server’s configuration file — its path is printed in the server’s startup log — then restart it.',
  REMOTE_CLIENT: 'Setup from a browser is only available on the computer running this program. Set ONSHAPE_ACCESS_KEY and ONSHAPE_SECRET_KEY in the server’s configuration file — its path is printed in the server’s startup log — then restart it.',
  FORWARDED_HEADER: 'This page is being served through a proxy, so browser setup is turned off for safety. Set ONSHAPE_ACCESS_KEY and ONSHAPE_SECRET_KEY in the server’s configuration file — its path is printed in the server’s startup log — then restart it.',
  HTTPS_PUBLIC_URL: 'This server has a public HTTPS address, so browser setup is turned off. Set ONSHAPE_ACCESS_KEY and ONSHAPE_SECRET_KEY in the server’s configuration file — its path is printed in the server’s startup log — then restart it.',
  ORIGIN_REJECTED: 'This request could not be verified as coming from this page.'
});

/**
 * True for ::1, IPv4-mapped ::ffff:127.x, and all of 127.0.0.0/8. A missing
 * or empty address is not loopback: callers must fail closed rather than
 * treat "unknown" as "trusted".
 */
export function isLoopbackAddress(address) {
  if (!address) return false;
  let value = String(address).trim();
  if (value.startsWith('::ffff:')) value = value.slice('::ffff:'.length);
  if (value === '::1') return true;
  const match = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  return match.slice(1).every((part) => Number(part) >= 0 && Number(part) <= 255) && Number(match[1]) === 127;
}

/**
 * Internal (fine-grained) refusal reason for the setup wizard's loopback
 * requirement, or null when every check passes. Order matters: cheaper,
 * config-only checks run before touching the socket.
 */
export function loopbackRefusalReason(req, config) {
  if (String(config?.publicBaseUrl || '').startsWith('https://')) return 'PUBLIC_BASE_URL_HTTPS';
  if (!LOOPBACK_HOSTS.has(config?.host)) return 'SERVER_NOT_LOOPBACK_BOUND';
  for (const name of FORWARDED_HEADERS) {
    if (req.headers?.[name] !== undefined) return 'FORWARDED_HEADER_PRESENT';
  }
  if (!isLoopbackAddress(req.socket?.remoteAddress)) return 'REMOTE_ADDRESS_NOT_LOOPBACK';
  if (!isLoopbackAddress(req.socket?.localAddress)) return 'LOCAL_SOCKET_NOT_LOOPBACK';
  return null;
}

function parseHostHeader(hostHeader) {
  const text = String(hostHeader || '');
  const match = text.match(/^\[([^\]]+)\](?::(\d+))?$/) || text.match(/^([^:]+)(?::(\d+))?$/);
  if (!match) return undefined;
  return { hostname: match[1].toLowerCase(), port: match[2] ? Number(match[2]) : undefined };
}

/**
 * Internal refusal reason for the Origin/Host cross-origin check, or null
 * when the request may proceed. Origin is authoritative when present; a
 * same-origin fetch from Node (no Origin header) falls back to Host, which
 * also catches DNS rebinding since a rebound hostname fails the allow-list
 * on the Host header exactly as it would on Origin.
 */
export function originRefusalReason(req, config) {
  const port = Number(config?.port);
  const allowedHost = (hostname) => ['127.0.0.1', 'localhost', '::1'].includes(hostname);
  // WHATWG URL.hostname keeps the brackets around an IPv6 literal (e.g.
  // "[::1]"); strip them so it compares equal to the bracket-free form used
  // by req.socket addresses and by the allow-list above.
  const stripBrackets = (hostname) => hostname.replace(/^\[|\]$/g, '');

  const originHeader = req.headers?.origin;
  if (originHeader) {
    let url;
    try {
      url = new URL(originHeader);
    } catch {
      return 'ORIGIN_MALFORMED';
    }
    const effectivePort = url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80);
    if (!allowedHost(stripBrackets(url.hostname.toLowerCase())) || effectivePort !== port) return 'ORIGIN_MISMATCH';
    return null;
  }

  const parsedHost = parseHostHeader(req.headers?.host);
  if (!parsedHost || !allowedHost(parsedHost.hostname) || parsedHost.port !== port) return 'HOST_MISMATCH';
  return null;
}

/**
 * Combined guard for every /api/setup* route. Returns null when the request
 * may proceed, or a response-shaped failure whose public `reason` is one of
 * the five coarse codes. The fine-grained `internalReason` is for server
 * logs only and must never be sent to the client.
 */
export function setupGuardFailure(req, config) {
  const internalReason = loopbackRefusalReason(req, config) || originRefusalReason(req, config);
  if (!internalReason) return null;
  const reason = COARSE_REASON[internalReason] || 'NOT_LOOPBACK';
  return {
    status: 403,
    code: 'SETUP_UNAVAILABLE',
    reason,
    message: COARSE_MESSAGE[reason],
    internalReason
  };
}
