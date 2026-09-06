// Pure, DOM-free rendering and validation helpers for the setup wizard and
// the header badge. No DOM or browser globals of any kind — importable
// under plain node --test with no shim, exactly like url-context.mjs.

const DEFAULT_HOST = 'cad.onshape.com';

const RESTART_INSTRUCTION = 'Set ONSHAPE_ACCESS_KEY and ONSHAPE_SECRET_KEY in the server’s configuration file — its path is printed in the server’s startup log — then restart it.';

export const SETUP_UNAVAILABLE_MESSAGES = Object.freeze({
  NOT_LOOPBACK: `Setup from a browser is only available on the computer running this program. ${RESTART_INSTRUCTION}`,
  // Distinct from NOT_LOOPBACK: this is the operator's own HOST setting (the
  // Dockerfile's HOST=0.0.0.0 default is the common case) turning the guard
  // on for a user who genuinely is on this machine, so it names the actual
  // setting instead of implying they are on the wrong computer.
  HOST_NOT_LOOPBACK: `This server is listening on all network interfaces (HOST is not 127.0.0.1), so browser setup is turned off. Set HOST=127.0.0.1 and restart, or set the keys in the configuration file. ${RESTART_INSTRUCTION}`,
  REMOTE_CLIENT: `Setup from a browser is only available on the computer running this program. ${RESTART_INSTRUCTION}`,
  FORWARDED_HEADER: `This page is being served through a proxy, so browser setup is turned off for safety. ${RESTART_INSTRUCTION}`,
  HTTPS_PUBLIC_URL: `This server has a public HTTPS address, so browser setup is turned off. ${RESTART_INSTRUCTION}`,
  ORIGIN_REJECTED: 'This request could not be verified as coming from this page. Reload the page and try again.'
});

const BADGE_TEXT = Object.freeze({
  unconfigured: { text: 'Set up Onshape', className: 'badge badge-action' },
  checking: { text: 'Checking Onshape…', className: 'badge' },
  rejected: { text: 'Onshape key rejected', className: 'badge badge-warning' },
  forbidden: { text: 'Onshape key lacks access', className: 'badge badge-warning' },
  unreachable: { text: 'Onshape unreachable', className: 'badge badge-warning' },
  error: { text: 'Onshape check failed', className: 'badge badge-warning' },
  'oauth-required': { text: 'Authorize Onshape', className: 'badge badge-warning' }
});

const MAX_BADGE_NAME_LENGTH = 24;

// Mirrors src/capabilities.mjs's SCOPE_BITS table, names and order included.
// Kept as a local list rather than an import because this module is loaded by
// the browser and src/ is server-side; if that table changes, change both.
const SCOPE_NAMES = ['read', 'write', 'delete', 'readPii', 'share'];

/**
 * The plan-and-scope line under the connection badge: "Free · read · write",
 * plus a title that is honest about what is missing and about any permission
 * bit this app does not recognise.
 *
 * Returns `{ text: '', title: '' }` whenever there is nothing truthful to say,
 * so the caller hides the element instead of printing a confident blank.
 */
export function describeCapabilities(capabilities) {
  const scopes = capabilities?.scopes;
  const plan = capabilities?.plan?.group;
  if (!capabilities || (!plan && !scopes?.known)) return { text: '', title: '' };

  const granted = scopes?.known ? SCOPE_NAMES.filter((name) => scopes[name]) : [];
  const missing = scopes?.known ? SCOPE_NAMES.filter((name) => !scopes[name]) : [];

  const parts = [];
  if (plan) parts.push(plan);
  if (scopes?.known) parts.push(granted.length ? granted.join(' · ') : 'no scopes');
  else parts.push('permissions unknown');

  const titleParts = [];
  if (plan) titleParts.push(`Plan: ${plan}.`);
  if (scopes?.known) {
    titleParts.push(granted.length ? `Granted: ${granted.join(', ')}.` : 'This key has no recognised permissions.');
    if (missing.length) titleParts.push(`Missing: ${missing.join(', ')}.`);
    if (scopes.unknownBits?.length) {
      titleParts.push(`Permission bits this app does not recognise: ${scopes.unknownBits.join(', ')}.`);
    }
  } else {
    titleParts.push('This key’s permissions are not known yet.');
  }

  return { text: parts.join(' · '), title: titleParts.join(' ') };
}

/**
 * Render the header badge for the current auth/connection state. Never
 * throws on a missing or partial `auth` — an unloaded bootstrap should read
 * as "checking", not crash the header.
 */
export function describeConnection(auth) {
  const connection = auth?.connection;
  const state = connection?.state;
  // The plan/scope line only means anything once a probe has actually
  // answered, so it rides along with the badge rather than being rendered
  // from a separate, possibly staler source.
  const detail = state === 'connected' ? describeCapabilities(auth?.capabilities) : { text: '', title: '' };

  if (state === 'connected') {
    const name = String(connection.accountName || '');
    const clipped = name.length > MAX_BADGE_NAME_LENGTH ? `${name.slice(0, MAX_BADGE_NAME_LENGTH)}…` : name;
    return {
      text: `Onshape · ${clipped}`,
      className: 'badge badge-good',
      title: name || 'Connected',
      detail: detail.text,
      detailTitle: detail.title
    };
  }

  const entry = BADGE_TEXT[state];
  if (entry) return { text: entry.text, className: entry.className, title: entry.text, detail: '', detailTitle: '' };
  return { text: 'Checking Onshape…', className: 'badge', title: 'Checking Onshape…', detail: '', detailTitle: '' };
}

function stripSurroundingQuotes(value) {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  return value;
}

function cleanOneKey(raw, prefix, notices) {
  let value = stripSurroundingQuotes(String(raw ?? '').trim()).trim();
  if (value.toUpperCase().startsWith(prefix)) {
    value = stripSurroundingQuotes(value.slice(prefix.length).trim()).trim();
    notices.push(`Removed the ${prefix} prefix for you.`);
  }
  return value;
}

// Mirrors src/setup-routes.mjs's KEY_PATTERN exactly, so a key this app will
// reject anyway gets a specific, field-scoped message here instead of
// reaching the server just to bounce off its generic 400.
const KEY_CHAR_PATTERN = /^[A-Za-z0-9+/=_-]+$/;
const KEY_MAX_LENGTH = 256;

/**
 * Trims, strips quotes, and strips an accidentally pasted
 * `ONSHAPE_ACCESS_KEY=`/`ONSHAPE_SECRET_KEY=` prefix, then enforces the same
 * character class and length bound the server does.
 */
export function validateApiKeyInput({ accessKey, secretKey, baseUrl } = {}) {
  const notices = [];
  const cleanedAccessKey = cleanOneKey(accessKey, 'ONSHAPE_ACCESS_KEY=', notices);
  const cleanedSecretKey = cleanOneKey(secretKey, 'ONSHAPE_SECRET_KEY=', notices);

  if (!cleanedAccessKey) {
    return { ok: false, field: 'accessKey', reason: 'MISSING_ACCESS_KEY', message: 'Enter the access key.', notices };
  }
  if (!cleanedSecretKey) {
    return { ok: false, field: 'secretKey', reason: 'MISSING_SECRET_KEY', message: 'Enter the secret key.', notices };
  }
  if (/\s/.test(cleanedAccessKey)) {
    return { ok: false, field: 'accessKey', reason: 'KEY_HAS_SPACES', message: 'The access key should not contain spaces. Check that you copied only the key itself.', notices };
  }
  if (/\s/.test(cleanedSecretKey)) {
    return { ok: false, field: 'secretKey', reason: 'KEY_HAS_SPACES', message: 'The secret key should not contain spaces. Check that you copied only the key itself.', notices };
  }
  if (cleanedAccessKey.length < 16) {
    return { ok: false, field: 'accessKey', reason: 'KEY_TOO_SHORT', message: 'That access key looks too short. Copy the whole value from the Onshape developer portal.', notices };
  }
  if (cleanedSecretKey.length < 16) {
    return { ok: false, field: 'secretKey', reason: 'KEY_TOO_SHORT', message: 'That secret key looks too short. Copy the whole value from the Onshape developer portal.', notices };
  }
  if (cleanedAccessKey.length > KEY_MAX_LENGTH || !KEY_CHAR_PATTERN.test(cleanedAccessKey)) {
    return { ok: false, field: 'accessKey', reason: 'KEY_BAD_FORMAT', message: 'That access key contains a character Onshape keys never contain — copy it again from the developer portal.', notices };
  }
  if (cleanedSecretKey.length > KEY_MAX_LENGTH || !KEY_CHAR_PATTERN.test(cleanedSecretKey)) {
    return { ok: false, field: 'secretKey', reason: 'KEY_BAD_FORMAT', message: 'That secret key contains a character Onshape keys never contain — copy it again from the developer portal.', notices };
  }

  const trimmedBaseUrl = String(baseUrl ?? '').trim();
  let cleanedBaseUrl;
  if (trimmedBaseUrl) {
    let url;
    try {
      url = new URL(trimmedBaseUrl.includes('://') ? trimmedBaseUrl : `https://${trimmedBaseUrl}`);
    } catch {
      return { ok: false, field: 'baseUrl', reason: 'HTTPS_REQUIRED', message: 'Enter a valid https:// address, such as https://acme.onshape.com.', notices };
    }
    if (url.protocol !== 'https:') {
      return { ok: false, field: 'baseUrl', reason: 'HTTPS_REQUIRED', message: 'Enter a valid https:// address, such as https://acme.onshape.com.', notices };
    }
    // A full document URL is reduced to its origin, so pasting the browser
    // address bar here instead of just the host still works.
    cleanedBaseUrl = url.origin;
  }

  return {
    ok: true,
    cleaned: { accessKey: cleanedAccessKey, secretKey: cleanedSecretKey, baseUrl: cleanedBaseUrl },
    notices
  };
}

/**
 * Turn a failed /api/setup/test or /api/setup/save result into the copy
 * shown under the form. Always returns a non-empty string.
 */
export function setupFailureMessage(result, { host = DEFAULT_HOST, timeoutSeconds = 12, configPath } = {}) {
  const reason = result?.reason;
  const isDefaultHost = host === DEFAULT_HOST;
  const configHint = configPath ? ` (the server’s configuration file is at ${configPath})` : '';

  switch (reason) {
    case 'REJECTED': {
      let message = 'Onshape rejected this key pair. Check that you copied the whole access key and the whole secret key, with no characters missing, and that both came from the same key. If you have lost the secret, create a new API key — Onshape only shows the secret once.';
      if (isDefaultHost) {
        message += ' If your company uses a private Onshape address instead of cad.onshape.com, open "Using an enterprise or private Onshape address?" above and enter it.';
      }
      return message;
    }
    case 'FORBIDDEN':
      return 'Onshape accepted this key, but it does not have the Read documents and Write documents permissions this app needs. Create a new API key with both permissions ticked.';
    case 'UNREACHABLE': {
      let message = `Could not reach ${host}. Check this computer's internet connection, and any VPN or firewall that might be blocking it. Your key was not sent anywhere.`;
      if (!isDefaultHost) message += ' Double-check the Onshape address.';
      return message;
    }
    case 'TIMEOUT':
      return `${host} did not answer within ${timeoutSeconds} seconds. Check your connection, then press Test connection again.`;
    case 'ONSHAPE_RATE_LIMITED':
      return 'Onshape is rate-limiting requests from this server right now. Wait a minute, then press Test connection again.';
    case 'ONSHAPE_ERROR':
      return `Onshape returned an unexpected error (status ${result?.status ?? 'unknown'}). This is likely a problem on Onshape's side right now — wait a moment and try again.`;
    case 'BAD_STACK_URL':
      return 'That does not look like a valid Onshape address. Enter a full https:// address, such as https://acme.onshape.com.';
    default:
      return `Something unexpected happened while checking this key${configHint}. Try again, and if it keeps happening, check the server's configuration.`;
  }
}
