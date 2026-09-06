// Parses anything a user might paste that identifies an Onshape Part Studio
// tab: a full browser address, a bare query string, or the extension
// action-URL form. Pure module: no DOM, no network, no globals beyond the
// standard URL/URLSearchParams constructors, so it can be unit tested with
// plain node --test and reused by app.js without a build step.

export const ONSHAPE_ID_PATTERN = /^[0-9a-fA-F]{24}$/;
export const MAX_INPUT_LENGTH = 4096;

// Onshape's extension action-URL query form accepts short ids (own internal
// references, not always the 24-hex document id format), so it is checked
// against a looser shape than a path-form id. Rejecting outright only below
// this floor avoids treating obvious garbage as a nonstandard-but-valid id.
const LOOSE_ID_PATTERN = /^[0-9A-Za-z_-]{8,64}$/;

const MESSAGES = Object.freeze({
  EMPTY: 'Paste an Onshape URL first.',
  TOO_LONG: 'That is too long to be an Onshape URL. Paste just the address of the Part Studio tab.',
  TEMPLATE_PLACEHOLDER: 'That is the extension action-URL template, not a real address. Onshape fills in the {$documentId} placeholders itself — open the Part Studio in Onshape and copy your browser address bar instead.',
  NOT_A_URL: 'That does not look like a web address. Copy the whole line from your browser address bar, starting with https://.',
  NOT_ONSHAPE_HOST: 'That address is not on onshape.com. Open the Part Studio in Onshape and copy the address bar.',
  UNSUPPORTED_PATH: 'That is an Onshape page, but not a document tab. Open the Part Studio you want to calibrate, then copy the address bar.',
  NO_DOCUMENT_ID: 'No document id in that address. Copy the full Onshape address bar, not a shortened link.',
  NO_WORKSPACE: 'That link points at the document but not at a workspace or version. Open the document in Onshape, then copy the address bar.',
  NO_ELEMENT_ID: 'That link points at the document but not at a tab. Click the Part Studio tab in Onshape, then copy the address bar again.',
  VERSION_READ_ONLY: 'This is a version link (/v/), which is read-only. You can preview here, but Apply needs the workspace link (/w/).',
  MICROVERSION_READ_ONLY: 'This is a microversion link (/m/), which is read-only. You can preview here, but Apply needs the workspace link (/w/).',
  NONSTANDARD_ID: 'One of these ids is not the usual 24-character Onshape id. Loading it anyway — if nothing shows up, re-copy the address bar.'
});

function badIdFormatMessage(part) {
  return `The ${part} id in that address is not a valid Onshape id. Copy the whole address bar without editing it.`;
}

function hostMismatchMessage(actualHostname, expectedOrigin) {
  const expectedUrl = new URL(expectedOrigin);
  return `This document is on ${actualHostname}, but this server is set up for ${expectedUrl.hostname}. ` +
    `Press the Onshape badge at the top, open "Using an enterprise or private Onshape address?", and enter https://${actualHostname}.`;
}

// Names the id by position rather than by literal path segment, since the
// same wording is reused for the query-form aliases (workspaceId/versionId/…).
function wvmPartName(workspaceOrVersion) {
  if (workspaceOrVersion === 'v') return 'version';
  if (workspaceOrVersion === 'm') return 'microversion';
  return 'workspace';
}

function fail(code, message) {
  return { error: { code, message } };
}

function getParam(params, names) {
  for (const name of names) {
    const value = params.get(name);
    if (value !== null && value !== undefined && String(value).trim()) return String(value).trim();
  }
  return undefined;
}

function hasAny(params, names) {
  return names.some((name) => {
    const value = params.get(name);
    return value !== null && value !== undefined && String(value).trim() !== '';
  });
}

// Query-form extraction mirrors server.mjs normalizeContext() exactly — same
// alias lists, same inference order — so a URL this function accepts is
// guaranteed to also be accepted by the server, and vice versa.
function parseQueryForm(params, warnings) {
  const documentId = getParam(params, ['documentId', 'docId', 'did']);
  const elementId = getParam(params, ['elementId', 'eId', 'eid']);
  let workspaceOrVersion = getParam(params, ['workspaceOrVersion', 'wvm', 'wv']);
  const workspaceOrVersionId = getParam(params, [
    'workspaceOrVersionId',
    'workspaceId',
    'versionId',
    'microversionId',
    'wvmId',
    'wid',
    'vid',
    'mid'
  ]);

  if (!workspaceOrVersion) {
    if (getParam(params, ['versionId', 'vid'])) workspaceOrVersion = 'v';
    else if (getParam(params, ['microversionId', 'mid'])) workspaceOrVersion = 'm';
    else if (workspaceOrVersionId) workspaceOrVersion = 'w';
  }
  workspaceOrVersion = workspaceOrVersion?.toLowerCase();

  if (!documentId) return fail('NO_DOCUMENT_ID', MESSAGES.NO_DOCUMENT_ID);
  if (!workspaceOrVersionId || !['w', 'v', 'm'].includes(workspaceOrVersion)) {
    return fail('NO_WORKSPACE', MESSAGES.NO_WORKSPACE);
  }
  if (!elementId) return fail('NO_ELEMENT_ID', MESSAGES.NO_ELEMENT_ID);

  const idFields = [
    ['document', documentId],
    [wvmPartName(workspaceOrVersion), workspaceOrVersionId],
    ['element', elementId]
  ];
  for (const [part, value] of idFields) {
    if (!LOOSE_ID_PATTERN.test(value)) return fail('BAD_ID_FORMAT', badIdFormatMessage(part));
  }
  if (idFields.some(([, value]) => !ONSHAPE_ID_PATTERN.test(value))) {
    warnings.push({ code: 'NONSTANDARD_ID', message: MESSAGES.NONSTANDARD_ID });
  }

  return { context: { documentId, workspaceOrVersion, workspaceOrVersionId, elementId } };
}

// Path-form extraction. Ids here are always the strict 24-hex Onshape id —
// this is the shape of a real browser address-bar copy, not an alias-driven
// integration query string.
function parsePathForm(url, warnings, options) {
  const hostname = url.hostname.toLowerCase();
  if (hostname !== 'onshape.com' && !hostname.endsWith('.onshape.com')) {
    return fail('NOT_ONSHAPE_HOST', MESSAGES.NOT_ONSHAPE_HOST);
  }

  if (options.expectedOrigin) {
    try {
      const expectedHostname = new URL(options.expectedOrigin).hostname.toLowerCase();
      if (expectedHostname !== hostname) {
        warnings.push({ code: 'HOST_MISMATCH', message: hostMismatchMessage(hostname, options.expectedOrigin) });
      }
    } catch {
      // A malformed expectedOrigin is a server misconfiguration, not something
      // this paste can fix — ignore rather than failing the user's input.
    }
  }

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments[0] !== 'documents') return fail('UNSUPPORTED_PATH', MESSAGES.UNSUPPORTED_PATH);

  const documentId = segments[1];
  if (!documentId) return fail('NO_DOCUMENT_ID', MESSAGES.NO_DOCUMENT_ID);
  if (!ONSHAPE_ID_PATTERN.test(documentId)) return fail('BAD_ID_FORMAT', badIdFormatMessage('document'));

  if (segments.length === 2) return fail('NO_WORKSPACE', MESSAGES.NO_WORKSPACE);
  const workspaceOrVersion = segments[2];
  if (!['w', 'v', 'm'].includes(workspaceOrVersion)) return fail('UNSUPPORTED_PATH', MESSAGES.UNSUPPORTED_PATH);

  const workspaceOrVersionId = segments[3];
  if (!workspaceOrVersionId) return fail('NO_WORKSPACE', MESSAGES.NO_WORKSPACE);
  if (!ONSHAPE_ID_PATTERN.test(workspaceOrVersionId)) {
    return fail('BAD_ID_FORMAT', badIdFormatMessage(wvmPartName(workspaceOrVersion)));
  }

  if (segments.length <= 4 || segments[4] !== 'e') return fail('NO_ELEMENT_ID', MESSAGES.NO_ELEMENT_ID);
  const elementId = segments[5];
  if (!elementId) return fail('NO_ELEMENT_ID', MESSAGES.NO_ELEMENT_ID);
  if (!ONSHAPE_ID_PATTERN.test(elementId)) return fail('BAD_ID_FORMAT', badIdFormatMessage('element'));

  // Segments past the element id (drawing/section deep links) are ignored.
  return { context: { documentId, workspaceOrVersion, workspaceOrVersionId, elementId } };
}

/**
 * Parse anything a user can paste that identifies an Onshape Part Studio tab.
 * Pure: no DOM, no network, no globals beyond URL/URLSearchParams.
 *
 * @param {string} input Raw pasted text.
 * @param {{ expectedOrigin?: string }} [options] expectedOrigin is
 *   bootstrap.capabilities.onshapeBaseUrl; used only to warn on a stack mismatch.
 * @returns {ParsedOnshapeUrl}
 */
export function parseOnshapeUrl(input, options = {}) {
  const warnings = [];

  let text = String(input ?? '').trim();
  if (text.length > 1 && text.startsWith('<') && text.endsWith('>')) {
    text = text.slice(1, -1).trim();
  }
  // A pasted address is sometimes preceded or followed by other copied text
  // (chat messages, email signatures); only the first token can be a URL.
  text = text.split(/\s+/)[0] || '';

  if (!text) return Object.freeze({ ok: false, warnings, error: { code: 'EMPTY', message: MESSAGES.EMPTY } });
  if (text.length > MAX_INPUT_LENGTH) {
    return Object.freeze({ ok: false, warnings, error: { code: 'TOO_LONG', message: MESSAGES.TOO_LONG } });
  }
  if (text.includes('{$')) {
    return Object.freeze({ ok: false, warnings, error: { code: 'TEMPLATE_PLACEHOLDER', message: MESSAGES.TEMPLATE_PLACEHOLDER } });
  }

  let outcome;
  if (text.startsWith('?')) {
    outcome = parseQueryForm(new URLSearchParams(text.slice(1)), warnings);
  } else {
    const hadScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(text);
    let url;
    try {
      url = new URL(hadScheme ? text : `https://${text}`);
    } catch {
      return Object.freeze({ ok: false, warnings, error: { code: 'NOT_A_URL', message: MESSAGES.NOT_A_URL } });
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return Object.freeze({ ok: false, warnings, error: { code: 'NOT_A_URL', message: MESSAGES.NOT_A_URL } });
    }
    // A scheme we added ourselves can turn a stray word into a syntactically
    // valid but meaningless URL (e.g. "not" -> "https://not"). A real
    // address-bar host always has a dot (or is a recognized local host); a
    // schemeless, dotless result is closer to "not a URL" than "wrong host".
    if (!hadScheme && !url.hostname.includes('.') && url.hostname !== 'localhost') {
      return Object.freeze({ ok: false, warnings, error: { code: 'NOT_A_URL', message: MESSAGES.NOT_A_URL } });
    }
    outcome = hasAny(url.searchParams, ['documentId', 'docId', 'did'])
      ? parseQueryForm(url.searchParams, warnings)
      : parsePathForm(url, warnings, options);
  }

  if (outcome.error) return Object.freeze({ ok: false, warnings, error: outcome.error });

  const { documentId, workspaceOrVersion, workspaceOrVersionId, elementId } = outcome.context;
  if (workspaceOrVersion === 'v') {
    warnings.push({ code: 'VERSION_READ_ONLY', message: MESSAGES.VERSION_READ_ONLY });
  } else if (workspaceOrVersion === 'm') {
    warnings.push({ code: 'MICROVERSION_READ_ONLY', message: MESSAGES.MICROVERSION_READ_ONLY });
  }

  const context = Object.freeze({ documentId, workspaceOrVersion, workspaceOrVersionId, elementId, complete: true });
  return Object.freeze({ ok: true, context, warnings });
}

/**
 * Canonical query string for a context, matching server.mjs normalizeContext().
 * @param {{documentId: string, workspaceOrVersion: string, workspaceOrVersionId: string, elementId: string}} context
 * @param {Record<string,string>} [extra] preserved passthrough params
 * @returns {string} e.g. "documentId=…&workspaceOrVersion=w&workspaceOrVersionId=…&elementId=…"
 */
export function contextToSearch(context, extra = {}) {
  const params = new URLSearchParams();
  for (const key of ['documentId', 'workspaceOrVersion', 'workspaceOrVersionId', 'elementId']) {
    if (context?.[key]) params.set(key, context[key]);
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, value);
  }
  return params.toString();
}
