import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { APP_NAME, resolveEnvFile, resolveBackupDir, userConfigDir } from './config-paths.mjs';
import { parseEnvFile } from './env-file.mjs';
import { DEFAULT_MAX_IMAGE_UPLOAD_BYTES } from './image-bytes.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultProjectRoot = path.resolve(__dirname, '..');

/**
 * Env-file keys whose effect is fixed at boot. HOST and PORT need a listener
 * rebind; PUBLIC_BASE_URL and NODE_ENV are captured by long-lived closures and
 * by cookies already issued to live browsers; UPDATE_CHECK_URL is read once
 * into the one-shot, cached update checker (see src/update-check.mjs) and a
 * later reload has nothing left to hand it. Changing any of these is honest
 * work for a restart, not for a reload.
 */
export const BOOT_ONLY_KEYS = Object.freeze([
  'HOST',
  'PORT',
  'PUBLIC_BASE_URL',
  'UPDATE_CHECK_URL',
  'NODE_ENV'
]);

/** Derived config fields carried over from the boot snapshot on every reload. */
const PINNED_FIELDS = Object.freeze([
  'projectRoot',
  'publicDir',
  'featureScriptDir',
  'host',
  'port',
  'publicBaseUrl',
  'cookieSecure',
  'updateCheckUrl',
  'nodeEnv',
  'envFilePath',
  'envFileSource'
]);

/**
 * Single source of truth for every env-file key buildConfig reads: the
 * parser applied to it and the field that consumes the parsed value. A key
 * read out of `source` without an entry here has no test enforcing that it
 * was ever meant to be read at all — see the structural scan in
 * test/config.test.mjs, which fails a new `source.<KEY>` read that skipped
 * this table just as loudly as a stale entry naming a key nothing reads
 * anymore.
 *
 * A consumer starting with `boot.` is read once from the boot snapshot
 * (`server.mjs`'s `boot`, not `config()`); its key must also appear in
 * BOOT_ONLY_KEYS, and the same test checks that both directions agree.
 */
export const ENV_KEYS = Object.freeze({
  PORT: { parser: 'integer 0-65535, default 8787', consumer: 'boot.port' },
  HOST: { parser: 'string, default 127.0.0.1', consumer: 'boot.host' },
  PUBLIC_BASE_URL: { parser: 'absolute URL, defaulted from host/port', consumer: 'boot.publicBaseUrl' },
  ONSHAPE_BASE_URL: { parser: 'normalizeOrigin (https unless loopback)', consumer: 'config().onshapeBaseUrl' },
  ONSHAPE_API_VERSION: { parser: 'string, default v17, strips a leading api/', consumer: 'config().apiVersion' },
  ONSHAPE_AUTH: { parser: 'enum auto|api-key|api-key-signature|oauth|bearer|none', consumer: 'config().authMode' },
  ONSHAPE_ACCESS_KEY: { parser: 'string', consumer: 'config().accessKey' },
  ONSHAPE_SECRET_KEY: { parser: 'string', consumer: 'config().secretKey' },
  ONSHAPE_OAUTH_CLIENT_ID: { parser: 'string', consumer: 'config().oauth.clientId' },
  ONSHAPE_OAUTH_CLIENT_SECRET: { parser: 'string', consumer: 'config().oauth.clientSecret' },
  ONSHAPE_OAUTH_CALLBACK_URL: { parser: 'string', consumer: 'config().oauth.callbackUrl' },
  ONSHAPE_OAUTH_URL: { parser: 'string, default https://oauth.onshape.com', consumer: 'config().oauth.baseUrl' },
  ONSHAPE_BEARER_TOKEN: { parser: 'string', consumer: 'config().bearerToken' },
  ENABLE_NATIVE_IMAGE_WRITE: { parser: 'bool()', consumer: 'config().enableNativeImageWrite' },
  UPDATE_CHECK_URL: { parser: 'parseUpdateCheckUrl (absolute http/https URL, else empty)', consumer: 'boot.updateCheckUrl' },
  MAX_IMAGE_UPLOAD_BYTES: { parser: 'byteLimit (positive integer, floor of 1 byte)', consumer: 'config().maxImageUploadBytes' },
  BACKUP_DIR: { parser: 'resolveBackupDir', consumer: 'config().backupDir' },
  NODE_ENV: { parser: 'string, default development', consumer: 'boot.nodeEnv' }
});

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

/**
 * A positive byte count, or the default.
 *
 * A zero, a negative number, or a typo falls back rather than throwing: an
 * unreadable upload limit must not stop the server from starting, and the
 * default is the conservative answer anyway. Falling back is silent when the
 * key is simply unset (the common case), but warns when an operator supplied
 * a value that could not be used — otherwise a raised limit that silently did
 * nothing has no way to be noticed short of re-reading this source file.
 *
 * The floor is 1, not 0: a fractional value strictly between 0 and 1 (say,
 * a decimal-point typo like "0.4") used to pass the old `> 0` guard and then
 * get Math.floor()ed down to a silent, unwarned 0-byte limit that refused
 * every upload. Flooring first and rejecting anything under 1 closes that
 * gap and folds it into the same warned fallback as "abc" or "-5".
 */
function byteLimit(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  const floored = Math.floor(number);
  if (!Number.isFinite(number) || floored < 1) {
    console.warn(
      `MAX_IMAGE_UPLOAD_BYTES is set to ${JSON.stringify(value)}, which is not a positive number. ` +
      `Using the default of ${fallback} bytes instead.`
    );
    return fallback;
  }
  return floored;
}

/**
 * An absolute http(s) URL, or empty.
 *
 * Empty (the common case, unset) is silent: no update check runs and nothing
 * warns about it. Anything else that is not a fetchable absolute http(s) URL
 * — a relative path, a bare scheme like `javascript:`, garbage — is rejected
 * with a warning rather than handed to `fetch()` unexamined: this value is
 * read once at boot into src/update-check.mjs's checker.
 */
function parseUpdateCheckUrl(value) {
  if (value === undefined || value === null || value === '') return '';
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    parsed = null;
  }
  if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    console.warn(
      `UPDATE_CHECK_URL is set to ${JSON.stringify(value)}, which is not an absolute http or https URL. ` +
      'Update checks are disabled until this is fixed.'
    );
    return '';
  }
  return value;
}

function normalizeOrigin(value, fallback) {
  const text = String(value || fallback).trim().replace(/\/$/, '');
  const url = new URL(text);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    throw new Error(`Only HTTPS Onshape origins are allowed outside localhost: ${text}`);
  }
  return url.origin;
}

/**
 * Derive a frozen config from an env-file snapshot layered under real
 * environment variables, so a variable set by the OS or launcher still wins.
 *
 * Pure: it reads no files and no clock, and never writes back into process.env,
 * which is what lets a reload drop a deleted key instead of inheriting it from
 * the previous read.
 */
export function buildConfig({
  fileEnv = {},
  env = process.env,
  projectRoot = defaultProjectRoot,
  envFilePath = '',
  envFileSource = 'project',
  pin
} = {}) {
  const source = { ...fileEnv, ...env };

  const port = Number(source.PORT || 8787);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT must be an integer between 0 and 65535, got: ${source.PORT}`);
  }
  const host = source.HOST || '127.0.0.1';
  const publicBaseUrl = String(source.PUBLIC_BASE_URL || `http://${host}:${port}`).replace(/\/$/, '');
  // Validated here, once, rather than left for whichever `new URL(publicBaseUrl)`
  // call happens to run first: server.mjs builds request URLs and the bound-port
  // announcement against this value, and an invalid one there is an uncaught
  // exception at request time or at listen time instead of a clear boot error.
  try {
    new URL(publicBaseUrl);
  } catch {
    throw new Error(`PUBLIC_BASE_URL must be a valid absolute URL, got: ${source.PUBLIC_BASE_URL}`);
  }
  const onshapeBaseUrl = normalizeOrigin(source.ONSHAPE_BASE_URL, 'https://cad.onshape.com');
  const apiVersion = String(source.ONSHAPE_API_VERSION || 'v17').replace(/^\/?api\/?/, '').replace(/^\//, '');
  const requestedAuthMode = String(source.ONSHAPE_AUTH || 'auto').toLowerCase();

  const apiKeyConfigured = Boolean(source.ONSHAPE_ACCESS_KEY && source.ONSHAPE_SECRET_KEY);
  const oauthConfigured = Boolean(
    source.ONSHAPE_OAUTH_CLIENT_ID &&
    source.ONSHAPE_OAUTH_CLIENT_SECRET &&
    source.ONSHAPE_OAUTH_CALLBACK_URL
  );
  const bearerConfigured = Boolean(source.ONSHAPE_BEARER_TOKEN);

  let authMode = requestedAuthMode;
  if (requestedAuthMode === 'auto') {
    if (apiKeyConfigured) authMode = 'api-key-signature';
    else if (oauthConfigured) authMode = 'oauth';
    else if (bearerConfigured) authMode = 'bearer';
    else authMode = 'none';
  }

  const validModes = new Set(['api-key', 'api-key-signature', 'oauth', 'bearer', 'none']);
  if (!validModes.has(authMode)) {
    throw new Error(`Invalid ONSHAPE_AUTH mode: ${requestedAuthMode}`);
  }
  if (['api-key', 'api-key-signature'].includes(authMode) && !apiKeyConfigured) {
    throw new Error(`ONSHAPE_AUTH=${authMode} requires ONSHAPE_ACCESS_KEY and ONSHAPE_SECRET_KEY.`);
  }
  if (authMode === 'oauth' && !oauthConfigured) {
    throw new Error('ONSHAPE_AUTH=oauth requires client ID, client secret, and callback URL.');
  }
  if (authMode === 'bearer' && !bearerConfigured) {
    throw new Error('ONSHAPE_AUTH=bearer requires ONSHAPE_BEARER_TOKEN.');
  }

  const cookieSecure = publicBaseUrl.startsWith('https://');

  const config = {
    projectRoot,
    publicDir: path.join(projectRoot, 'public'),
    featureScriptDir: path.join(projectRoot, 'featurescript'),
    envFilePath,
    envFileSource,
    host,
    port,
    publicBaseUrl,
    onshapeBaseUrl,
    apiVersion,
    authMode,
    accessKey: source.ONSHAPE_ACCESS_KEY || '',
    secretKey: source.ONSHAPE_SECRET_KEY || '',
    bearerToken: source.ONSHAPE_BEARER_TOKEN || '',
    oauth: {
      clientId: source.ONSHAPE_OAUTH_CLIENT_ID || '',
      clientSecret: source.ONSHAPE_OAUTH_CLIENT_SECRET || '',
      callbackUrl: source.ONSHAPE_OAUTH_CALLBACK_URL || '',
      baseUrl: String(source.ONSHAPE_OAUTH_URL || 'https://oauth.onshape.com').replace(/\/$/, '')
    },
    cookieSecure,
    enableNativeImageWrite: bool(source.ENABLE_NATIVE_IMAGE_WRITE, false),
    // Empty by default (opt-in): no update check runs unless a maintainer or
    // operator sets this to a URL that serves the small JSON contract
    // src/update-check.mjs documents. Read once at boot, not through a
    // reload, since the check itself only ever runs once per process start.
    updateCheckUrl: parseUpdateCheckUrl(source.UPDATE_CHECK_URL),
    maxImageUploadBytes: byteLimit(source.MAX_IMAGE_UPLOAD_BYTES, DEFAULT_MAX_IMAGE_UPLOAD_BYTES),
    backupDir: resolveBackupDir({
      envValue: source.BACKUP_DIR,
      projectRoot,
      envFileSource,
      userDir: userConfigDir(APP_NAME, { env })
    }),
    nodeEnv: source.NODE_ENV || 'development'
  };

  if (pin) {
    for (const key of PINNED_FIELDS) {
      if (key in pin) config[key] = pin[key];
    }
  }

  config.oauth = Object.freeze(config.oauth);
  return Object.freeze(config);
}

function listChangedKeys(previous, next) {
  const changed = [];
  for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    const before = previous[key];
    const after = next[key];
    const same = before && typeof before === 'object'
      ? JSON.stringify(before) === JSON.stringify(after)
      : before === after;
    if (!same) changed.push(key);
  }
  return changed;
}

/**
 * Own this process's configuration so Onshape credentials can be replaced
 * without a restart.
 *
 * Read through current() on every use. A destructured field, or a module-scope
 * const taken once, silently keeps serving the pre-reload value and no test can
 * see the difference.
 */
export function createConfigStore({
  argv = process.argv,
  env = process.env,
  projectRoot = defaultProjectRoot,
  envFilePath
} = {}) {
  const resolved = envFilePath
    ? { path: path.resolve(projectRoot, envFilePath), source: 'cli' }
    : resolveEnvFile({ argv, env, projectRoot });

  const readFileEnv = () => {
    try {
      return parseEnvFile(fs.readFileSync(resolved.path, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      throw error;
    }
  };

  const bootFileEnv = readFileEnv();
  let config = buildConfig({
    fileEnv: bootFileEnv,
    env,
    projectRoot,
    envFilePath: resolved.path,
    envFileSource: resolved.source
  });
  const pin = Object.fromEntries(PINNED_FIELDS.map((key) => [key, config[key]]));
  let generation = 1;

  function reload() {
    const fileEnv = readFileEnv();
    // Build the candidate before adopting it. A malformed file must not brick
    // the request path, which parses onshapeBaseUrl on every single response.
    const candidate = buildConfig({
      fileEnv,
      env,
      projectRoot,
      envFilePath: resolved.path,
      envFileSource: resolved.source,
      pin
    });
    const changed = listChangedKeys(config, candidate);
    // Compared against the boot snapshot, not the previous reload, so a value
    // edited and then reverted stops asking for a restart it no longer needs.
    const restartRequired = BOOT_ONLY_KEYS.filter((key) => bootFileEnv[key] !== fileEnv[key]);
    config = candidate;
    generation += 1;
    return { config, changed, restartRequired };
  }

  /**
   * PORT=0 asks the OS for an ephemeral port; the listener only learns the
   * real one from server.address() after listen() resolves. Call this once,
   * from that callback, with the bound port. Unlike reload(), this mutates
   * the pinned port/publicBaseUrl themselves — every current() read (and
   * every already-open reload()) must see the real port from then on, or
   * originRefusalReason()'s Origin/Host comparison never matches what the
   * browser actually sends and the setup wizard is permanently unreachable.
   * A no-op when the OS bound the exact port that was requested.
   */
  function commitBoundPort(boundPort) {
    if (boundPort === pin.port) return config;
    if (!Number.isInteger(boundPort) || boundPort < 0 || boundPort > 65535) {
      throw new Error(`commitBoundPort: port must be an integer between 0 and 65535, got: ${boundPort}`);
    }
    const rebound = new URL(pin.publicBaseUrl);
    rebound.port = String(boundPort);
    pin.port = boundPort;
    pin.publicBaseUrl = rebound.origin;
    config = buildConfig({
      fileEnv: bootFileEnv,
      env,
      projectRoot,
      envFilePath: resolved.path,
      envFileSource: resolved.source,
      pin
    });
    return config;
  }

  return {
    current: () => config,
    reload,
    commitBoundPort,
    get generation() {
      return generation;
    },
    envFilePath: resolved.path,
    envFileSource: resolved.source,
    envFileExists: () => fs.existsSync(resolved.path)
  };
}

export function getConfig(options = {}) {
  return createConfigStore(options).current();
}
