import crypto from 'node:crypto';
import { createOAuthState, setOAuthTokens, clearOAuthTokens } from './session.mjs';

export class AuthRequiredError extends Error {
  constructor(message = 'Onshape authorization is required.') {
    super(message);
    this.name = 'AuthRequiredError';
    this.code = 'AUTH_REQUIRED';
  }
}

export class OnshapeApiError extends Error {
  constructor(message, { status, statusText, body, url, method } = {}) {
    super(message);
    this.name = 'OnshapeApiError';
    this.code = 'ONSHAPE_API_ERROR';
    this.status = status;
    this.statusText = statusText;
    this.body = body;
    this.url = url;
    this.method = method;
  }
}

function encodePath(value, name) {
  const text = String(value ?? '');
  if (!/^[A-Za-z0-9_.:-]{1,160}$/.test(text)) {
    throw new Error(`Invalid ${name}.`);
  }
  return encodeURIComponent(text);
}

function normalizeWvm(value) {
  const mode = String(value || '').toLowerCase();
  if (!['w', 'v', 'm'].includes(mode)) throw new Error('workspaceOrVersion must be w, v, or m.');
  return mode;
}

function featureListPath(context) {
  const did = encodePath(context.documentId, 'documentId');
  const wvm = normalizeWvm(context.workspaceOrVersion);
  const wvmid = encodePath(context.workspaceOrVersionId, 'workspaceOrVersionId');
  const eid = encodePath(context.elementId, 'elementId');
  return `/partstudios/d/${did}/${wvm}/${wvmid}/e/${eid}/features?rollbackBarIndex=-1&includeGeometryIds=true&noSketchGeometry=false`;
}

function updateFeaturePath(context, featureId) {
  const did = encodePath(context.documentId, 'documentId');
  if (normalizeWvm(context.workspaceOrVersion) !== 'w') {
    throw new Error('Features can only be updated in a workspace.');
  }
  const wid = encodePath(context.workspaceOrVersionId, 'workspaceId');
  const eid = encodePath(context.elementId, 'elementId');
  const fid = encodePath(featureId, 'featureId');
  return `/partstudios/d/${did}/w/${wid}/e/${eid}/features/featureid/${fid}`;
}

/**
 * The "d/{did}/w/{wid}" prefix every write route shares.
 *
 * A version or microversion context throws here rather than at Onshape: those
 * are read-only by construction, and a 400 from upstream would name the URL
 * instead of the thing the operator actually did wrong.
 */
function workspacePath(context) {
  const did = encodePath(context.documentId, 'documentId');
  if (normalizeWvm(context.workspaceOrVersion) !== 'w') {
    throw new Error('Onshape writes require a workspace context (a /w/ link).');
  }
  const wid = encodePath(context.workspaceOrVersionId, 'workspaceId');
  return `d/${did}/w/${wid}`;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function randomNonce() {
  // Hex is alphanumeric and comfortably exceeds Onshape's 16-character minimum.
  return crypto.randomBytes(18).toString('hex');
}

/**
 * Build Onshape's HMAC request-signature authorization value.
 * The content type must exactly match the Content-Type request header.
 */
export function createOnshapeRequestSignature({
  method,
  url,
  nonce,
  date,
  contentType,
  accessKey,
  secretKey
}) {
  const parsed = new URL(url);
  const canonical = [
    String(method || 'GET'),
    String(nonce || ''),
    String(date || ''),
    String(contentType || ''),
    parsed.pathname,
    parsed.search.startsWith('?') ? parsed.search.slice(1) : parsed.search,
    ''
  ].join('\n').toLowerCase();
  const digest = crypto.createHmac('sha256', String(secretKey)).update(canonical).digest('base64');
  return `On ${accessKey}:HmacSHA256:${digest}`;
}

/**
 * Materialize a FormData instance into bytes plus the exact Content-Type header
 * that describes them. The HMAC signature must cover the same Content-Type the
 * server receives, so the multipart boundary has to be known before signing
 * instead of being chosen by fetch after the fact.
 */
export async function encodeMultipartBody(formData) {
  const staged = new Request('https://onshape.invalid/', { method: 'POST', body: formData });
  const rawContentType = staged.headers.get('content-type');
  const rawBody = Buffer.from(await staged.arrayBuffer());
  return { rawBody, rawContentType };
}

export class OnshapeApi {
  /**
   * Accepts either a config object or a zero-argument getter.
   *
   * The getter form is how a long-lived instance and a reloadable config are
   * kept from diverging: there is only ever one instance, and it always reads
   * the config that is current right now.
   */
  constructor(configOrGetter, { fetchImpl } = {}) {
    this.readConfig = typeof configOrGetter === 'function' ? configOrGetter : () => configOrGetter;
    // A wrapper rather than a bare reference: a detached fetch throws on
    // invocation, and a wrapper keeps tests that swap globalThis.fetch working.
    this.fetchImpl = fetchImpl || ((...args) => globalThis.fetch(...args));
  }

  get config() {
    return this.readConfig();
  }

  get apiRoot() {
    return `${this.config.onshapeBaseUrl}/api/${this.config.apiVersion}`;
  }

  authorizationUrl(session, returnTo, companyId) {
    if (this.config.authMode !== 'oauth') {
      throw new Error('OAuth is not configured.');
    }
    const state = createOAuthState(session, returnTo);
    const url = new URL('/oauth/authorize', this.config.oauth.baseUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.config.oauth.clientId);
    url.searchParams.set('redirect_uri', this.config.oauth.callbackUrl);
    url.searchParams.set('state', state);
    if (companyId && companyId !== 'cad') url.searchParams.set('company_id', String(companyId));
    return url.toString();
  }

  async exchangeAuthorizationCode(session, code) {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: String(code),
      client_id: this.config.oauth.clientId,
      client_secret: this.config.oauth.clientSecret,
      redirect_uri: this.config.oauth.callbackUrl
    });
    const response = await this.fetchImpl(`${this.config.oauth.baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    const text = await response.text();
    const data = safeJsonParse(text);
    if (!response.ok || !data?.access_token) {
      throw new OnshapeApiError('Onshape rejected the OAuth authorization-code exchange.', {
        status: response.status,
        statusText: response.statusText,
        body: data || text,
        url: response.url,
        method: 'POST'
      });
    }
    setOAuthTokens(session, data);
    return data;
  }

  async refreshOAuthToken(session) {
    const refreshToken = session.tokens?.refreshToken;
    if (!refreshToken) throw new AuthRequiredError();
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.config.oauth.clientId,
      client_secret: this.config.oauth.clientSecret
    });
    const response = await this.fetchImpl(`${this.config.oauth.baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    const text = await response.text();
    const data = safeJsonParse(text);
    if (!response.ok || !data?.access_token) {
      clearOAuthTokens(session);
      throw new AuthRequiredError('The Onshape OAuth grant must be renewed.');
    }
    setOAuthTokens(session, data);
    return data;
  }

  async authorizationHeaders(session, { method, url, contentType, config = this.config }) {
    switch (config.authMode) {
      case 'api-key': {
        const encoded = Buffer.from(`${config.accessKey}:${config.secretKey}`).toString('base64');
        return { Authorization: `Basic ${encoded}` };
      }
      case 'api-key-signature': {
        const nonce = randomNonce();
        const date = new Date().toUTCString();
        return {
          Date: date,
          'On-Nonce': nonce,
          Authorization: createOnshapeRequestSignature({
            method,
            url,
            nonce,
            date,
            contentType,
            accessKey: config.accessKey,
            secretKey: config.secretKey
          })
        };
      }
      case 'bearer':
        return { Authorization: `Bearer ${config.bearerToken}` };
      case 'oauth':
        if (!session?.tokens?.accessToken) throw new AuthRequiredError();
        if (Date.now() >= session.tokens.expiresAt) await this.refreshOAuthToken(session);
        return { Authorization: `Bearer ${session.tokens.accessToken}` };
      case 'none':
      default:
        throw new AuthRequiredError('No Onshape authentication method is configured.');
    }
  }

  async request(requestPath, { method = 'GET', body, rawBody, rawContentType, session, signal, accept = 'application/json;charset=UTF-8; qs=0.09' } = {}) {
    // Snapshot config once for the whole request (including any redirect-loop
    // iterations below). Reading it fresh per iteration would let a config
    // reload that lands mid-request combine an old authMode/contentType
    // decision with new credentials (or vice versa), producing a signature
    // that does not match the headers actually sent.
    const cfg = this.readConfig();
    let url = requestPath.startsWith('http') ? requestPath : `${cfg.onshapeBaseUrl}/api/${cfg.apiVersion}${requestPath}`;
    let currentMethod = String(method).toUpperCase();
    let encodedBody;
    if (body !== undefined) encodedBody = JSON.stringify(body);
    let currentRawBody = encodedBody === undefined ? rawBody : undefined;
    if (currentRawBody !== undefined && !rawContentType) {
      throw new Error('rawBody requires an explicit rawContentType so the request signature can cover it.');
    }
    const signed = cfg.authMode === 'api-key-signature';

    for (let redirectCount = 0; redirectCount <= 4; redirectCount += 1) {
      let contentType;
      if (encodedBody !== undefined) contentType = 'application/json;charset=UTF-8; qs=0.09';
      else if (currentRawBody !== undefined) contentType = rawContentType;
      else contentType = signed ? 'application/json' : '';
      const headers = { Accept: accept };
      if (contentType) headers['Content-Type'] = contentType;
      Object.assign(headers, await this.authorizationHeaders(session, {
        method: currentMethod,
        url,
        contentType,
        config: cfg
      }));

      const response = await this.fetchImpl(url, {
        method: currentMethod,
        headers,
        body: encodedBody !== undefined ? encodedBody : currentRawBody,
        redirect: signed ? 'manual' : 'follow',
        signal
      });

      if (signed && [301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) {
          throw new OnshapeApiError('Onshape returned a redirect without a Location header.', {
            status: response.status,
            statusText: response.statusText,
            url,
            method: currentMethod
          });
        }
        url = new URL(location, url).toString();
        if (response.status === 303) {
          currentMethod = 'GET';
          encodedBody = undefined;
          currentRawBody = undefined;
        }
        continue;
      }

      if (!response.ok) {
        const text = await response.text();
        const parsed = safeJsonParse(text);
        if (response.status === 401 && cfg.authMode === 'oauth') {
          clearOAuthTokens(session);
          throw new AuthRequiredError('Onshape authorization expired or was revoked.');
        }
        throw new OnshapeApiError(`Onshape API request failed with ${response.status} ${response.statusText}.`, {
          status: response.status,
          statusText: response.statusText,
          body: parsed || text,
          url,
          method: currentMethod
        });
      }

      return response;
    }

    throw new OnshapeApiError('Onshape returned too many redirects.', { url, method: currentMethod });
  }

  async requestJson(path, options = {}) {
    const response = await this.request(path, options);
    if (response.status === 204) return undefined;
    return response.json();
  }

  async getFeatures(context, session) {
    return this.requestJson(featureListPath(context), { session });
  }

  async evaluateFeatureScript(context, script, session) {
    const did = encodePath(context.documentId, 'documentId');
    const wvm = normalizeWvm(context.workspaceOrVersion);
    const wvmid = encodePath(context.workspaceOrVersionId, 'workspaceOrVersionId');
    const eid = encodePath(context.elementId, 'elementId');
    return this.requestJson(`/partstudios/d/${did}/${wvm}/${wvmid}/e/${eid}/featurescript`, {
      method: 'POST',
      body: { script, queries: {} },
      session
    });
  }

  async updateFeature(context, featureId, payload, session) {
    return this.requestJson(updateFeaturePath(context, featureId), {
      method: 'POST',
      body: payload,
      session
    });
  }

  async downloadBlob(reference, session) {
    if (!reference?.documentId || !reference?.elementId) {
      throw new Error('Blob reference is incomplete.');
    }
    const did = encodePath(reference.documentId, 'blob documentId');
    const eid = encodePath(reference.elementId, 'blob elementId');
    const candidates = [];

    if (reference.workspaceId) {
      candidates.push(`/blobelements/d/${did}/w/${encodePath(reference.workspaceId, 'blob workspaceId')}/e/${eid}`);
    }
    if (reference.versionId) {
      candidates.push(`/blobelements/d/${did}/v/${encodePath(reference.versionId, 'blob versionId')}/e/${eid}`);
    }
    if (reference.microversionId) {
      candidates.push(`/blobelements/d/${did}/m/${encodePath(reference.microversionId, 'blob microversionId')}/e/${eid}`);
    }

    // Image references often point at a version but may also retain a path that
    // resolves through a workspace. Try the current workspace last when present.
    if (reference.fallbackWorkspaceId) {
      const candidate = `/blobelements/d/${did}/w/${encodePath(reference.fallbackWorkspaceId, 'blob workspaceId')}/e/${eid}`;
      if (!candidates.includes(candidate)) candidates.push(candidate);
    }

    let lastError;
    for (const candidate of candidates) {
      try {
        return await this.request(candidate, { session, accept: 'image/*,application/octet-stream' });
      } catch (error) {
        lastError = error;
        if (!(error instanceof OnshapeApiError) || ![400, 404, 405].includes(error.status)) throw error;
      }
    }
    throw lastError || new Error('No downloadable blob location could be derived from the image reference.');
  }

  /**
   * The document's element listing.
   *
   * This is the only place a Feature Studio's or a blob's microversion can be
   * read: neither the Feature Studio set-contents response nor the blob upload
   * listing carries the one the namespace needs after an edit, so the install
   * route re-reads this after every write that changes an element.
   */
  async listElements(context, session) {
    const did = encodePath(context.documentId, 'documentId');
    const wvm = normalizeWvm(context.workspaceOrVersion);
    const wvmid = encodePath(context.workspaceOrVersionId, 'workspaceOrVersionId');
    return this.requestJson(`/documents/d/${did}/${wvm}/${wvmid}/elements`, { session });
  }

  async getFeatureStudioContents(context, elementId, session) {
    const did = encodePath(context.documentId, 'documentId');
    const wvm = normalizeWvm(context.workspaceOrVersion);
    const wvmid = encodePath(context.workspaceOrVersionId, 'workspaceOrVersionId');
    const eid = encodePath(elementId, 'featureStudioId');
    return this.requestJson(`/featurestudios/d/${did}/${wvm}/${wvmid}/e/${eid}`, { session });
  }

  async createFeatureStudio(context, name, session) {
    return this.requestJson(`/featurestudios/${workspacePath(context)}`, {
      method: 'POST',
      body: { name: String(name) },
      session
    });
  }

  async setFeatureStudioContents(context, elementId, contents, session) {
    const eid = encodePath(elementId, 'featureStudioId');
    return this.requestJson(`/featurestudios/${workspacePath(context)}/e/${eid}`, {
      method: 'POST',
      body: { contents: String(contents) },
      session
    });
  }

  /** Add a new feature instance to a Part Studio. Workspace only. */
  async addFeature(context, payload, session) {
    const eid = encodePath(context.elementId, 'elementId');
    return this.requestJson(`/partstudios/${workspacePath(context)}/e/${eid}/features`, {
      method: 'POST',
      body: payload,
      session
    });
  }

  /**
   * Create a blob element from image bytes.
   *
   * Exactly two multipart parts, `file` and `encodedFilename`, which is the
   * shape E1 in the write-shape experiment established. The body is
   * materialized before the request so the HMAC signature can cover the same
   * Content-Type — including the boundary — that Onshape receives.
   */
  async uploadImageBlob(context, { bytes, filename, mediaType }, session) {
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: mediaType }), filename);
    form.append('encodedFilename', filename);
    const { rawBody, rawContentType } = await encodeMultipartBody(form);
    return this.requestJson(`/blobelements/${workspacePath(context)}`, {
      method: 'POST',
      rawBody,
      rawContentType,
      session
    });
  }

  /**
   * Create a document.
   *
   * `parentId` places it in a folder; moving an existing document into one is
   * not possible with an API key. A Free account is refused isPublic:false with
   * a 409, so the caller decides whether to retry public rather than having a
   * visibility downgrade happen silently down here.
   */
  async createDocument({ name, isPublic = true, parentId } = {}, session) {
    const body = { name: String(name), isPublic: Boolean(isPublic) };
    if (parentId) body.parentId = String(parentId);
    return this.requestJson('/documents', { method: 'POST', body, session });
  }
}
