// The operator's policy file: which writes this app is allowed to attempt at
// all, independent of what the API key could do.
//
// It lives beside the resolved env file (see resolveSettingsFile) and holds no
// secrets — only booleans and one Onshape folder id. Anything secret belongs in
// the env file, which has the atomic 0600 write and the redaction rules.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { writeFileAtomic, serializeWrites, sweepOrphanTempFiles } from './env-file.mjs';

const TEMP_PREFIX = '.settings.tmp-';

/**
 * Defaults, applied whenever the file is missing, unreadable, or partial.
 *
 * The four allow-* switches default on because the capability model already
 * refuses anything the key cannot do; the conservative half of "conservative"
 * is that every write is ANDed with the key's own scope and that
 * confirmBeforeWrite starts on. A default-off switch here would look like a
 * broken install rather than a policy.
 */
export const DEFAULT_SETTINGS = Object.freeze({
  allowDocumentCreation: true,
  allowFeatureInstall: true,
  allowImageUpload: true,
  allowSuppression: true,
  confirmBeforeWrite: true,
  scratchFolderId: null
});

export const BOOLEAN_SETTINGS = Object.freeze([
  'allowDocumentCreation',
  'allowFeatureInstall',
  'allowImageUpload',
  'allowSuppression',
  'confirmBeforeWrite'
]);

export const SETTINGS_KEYS = Object.freeze(Object.keys(DEFAULT_SETTINGS));

/**
 * Where each setting is actually read, once it ships.
 *
 * A setting with no entry here is a switch that changes nothing, and
 * test/settings.test.mjs fails until every key in DEFAULT_SETTINGS has one and
 * every listed file still mentions the key. Most entries point at
 * `src/capabilities.mjs`, where the key appears as a FEATURES policyKey and
 * `src/capability-gate.mjs` enforces it generically for whichever route names
 * that feature. `allowDocumentCreation` and `scratchFolderId` are the
 * documented exception: this product never calls `api.createDocument` itself,
 * so the only real reader is the maintainer's command-line verification
 * scripts (see the settings-card test in test/ui-contract.test.mjs).
 */
export const SETTING_CONSUMERS = Object.freeze({
  allowDocumentCreation: Object.freeze({
    files: Object.freeze(['scripts/live-target.mjs']),
    description: 'reserved for the command-line verification scripts'
  }),
  allowFeatureInstall: Object.freeze({
    files: Object.freeze(['src/capabilities.mjs']),
    description: 'gates the installFeature capability that POST /api/install requires'
  }),
  allowImageUpload: Object.freeze({
    files: Object.freeze(['src/capabilities.mjs']),
    description: 'gates the uploadImage capability that POST /api/upload-image requires'
  }),
  allowSuppression: Object.freeze({
    files: Object.freeze(['src/capabilities.mjs']),
    description: 'gates the suppressFeature capability that POST /api/suppress requires'
  }),
  confirmBeforeWrite: Object.freeze({
    files: Object.freeze(['src/write-routes.mjs']),
    description: 'requires a confirm flag on every write route unless turned off'
  }),
  scratchFolderId: Object.freeze({
    files: Object.freeze(['scripts/live-target.mjs']),
    description: 'reserved for the command-line verification scripts'
  })
});

// Onshape ids are 24 lowercase hex characters. Validated here so a typo lands
// as a 400 the operator can read instead of a 404 from Onshape three steps
// later, in a request that has already created something.
const ONSHAPE_ID_PATTERN = /^[0-9a-f]{24}$/i;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Coerce arbitrary parsed JSON into a valid settings object.
 *
 * Lenient by design: a bad value falls back to its default and is reported in
 * `warnings` rather than throwing, because a hand-edited settings file with one
 * typo must not stop the server from starting. POST /api/settings uses
 * validateSettingsPatch instead, which is strict, because there a bad value is
 * a request to reject, not a file to survive.
 */
export function normalizeSettings(raw) {
  const warnings = [];
  const settings = { ...DEFAULT_SETTINGS };
  if (raw !== undefined && !isPlainObject(raw)) {
    warnings.push('The settings file is not a JSON object. Defaults are in use.');
    return { settings: Object.freeze(settings), warnings };
  }
  const source = isPlainObject(raw) ? raw : {};

  for (const key of BOOLEAN_SETTINGS) {
    const value = source[key];
    if (value === undefined) continue;
    if (typeof value !== 'boolean') {
      warnings.push(`${key} must be true or false; using the default (${DEFAULT_SETTINGS[key]}).`);
      continue;
    }
    settings[key] = value;
  }

  const folder = source.scratchFolderId;
  if (folder !== undefined && folder !== null && folder !== '') {
    if (typeof folder !== 'string' || !ONSHAPE_ID_PATTERN.test(folder.trim())) {
      warnings.push('scratchFolderId must be a 24-character Onshape id; ignoring it.');
    } else {
      settings.scratchFolderId = folder.trim();
    }
  }

  for (const key of Object.keys(source)) {
    if (!SETTINGS_KEYS.includes(key)) warnings.push(`Unknown setting ignored: ${key}`);
  }

  return { settings: Object.freeze(settings), warnings };
}

/**
 * Strict validation for a client-supplied patch. Unknown keys are a 400 rather
 * than a silent drop: a typo'd toggle that reports success but changes nothing
 * is the worst outcome of the three.
 */
export function validateSettingsPatch(patch) {
  if (!isPlainObject(patch)) {
    return { ok: false, message: 'Settings must be a JSON object.' };
  }
  const unknown = Object.keys(patch).filter((key) => !SETTINGS_KEYS.includes(key));
  if (unknown.length) {
    return { ok: false, message: `Unknown setting${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}.` };
  }
  const clean = {};
  for (const key of BOOLEAN_SETTINGS) {
    if (!(key in patch)) continue;
    if (typeof patch[key] !== 'boolean') {
      return { ok: false, message: `${key} must be true or false.` };
    }
    clean[key] = patch[key];
  }
  if ('scratchFolderId' in patch) {
    const value = patch.scratchFolderId;
    if (value === null || value === '') {
      clean.scratchFolderId = null;
    } else if (typeof value === 'string' && ONSHAPE_ID_PATTERN.test(value.trim())) {
      clean.scratchFolderId = value.trim();
    } else {
      return { ok: false, message: 'scratchFolderId must be a 24-character Onshape folder id, or empty.' };
    }
  }
  return { ok: true, patch: clean };
}

function parseSettingsText(text) {
  try {
    return { value: JSON.parse(text), warnings: [] };
  } catch {
    return {
      value: undefined,
      warnings: ['The settings file is not valid JSON. Defaults are in use; saving will replace it.']
    };
  }
}

/** Synchronous read, matching how createConfigStore reads the env file at boot. */
export function readSettingsFileSync(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { settings: DEFAULT_SETTINGS, warnings: [], exists: false };
    throw error;
  }
  const parsed = parseSettingsText(text);
  const normalized = normalizeSettings(parsed.value);
  return { settings: normalized.settings, warnings: [...parsed.warnings, ...normalized.warnings], exists: true };
}

export async function readSettingsFile(filePath) {
  let text;
  try {
    text = await fsp.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { settings: DEFAULT_SETTINGS, warnings: [], exists: false };
    throw error;
  }
  const parsed = parseSettingsText(text);
  const normalized = normalizeSettings(parsed.value);
  return { settings: normalized.settings, warnings: [...parsed.warnings, ...normalized.warnings], exists: true };
}

/**
 * Write the whole settings object atomically. Every key is written every time:
 * unlike the env file, this one is machine-owned, so there are no operator
 * comments to preserve and a full rewrite is the honest representation.
 */
export async function writeSettingsFile(filePath, settings) {
  const text = `${JSON.stringify(settings, SETTINGS_KEYS, 2)}\n`;
  await writeFileAtomic(filePath, text, { mode: 0o600, tempPrefix: TEMP_PREFIX });
  await sweepOrphanTempFiles(path.dirname(filePath), { prefix: TEMP_PREFIX });
}

/**
 * In-process owner of the settings file.
 *
 * Read once at boot and kept in memory so the gate on a write route costs no
 * filesystem call; `save()` is the only writer and updates the memory copy from
 * the same object it persisted, so the two cannot disagree.
 */
export function createSettingsStore({ filePath }) {
  let settings = DEFAULT_SETTINGS;
  let warnings = [];
  let exists = false;

  function reload() {
    const result = readSettingsFileSync(filePath);
    settings = result.settings;
    warnings = result.warnings;
    exists = result.exists;
    return result;
  }

  async function save(patch) {
    const merged = Object.freeze({ ...settings, ...patch });
    // Serialised through the same per-path queue the env writer uses, so two
    // near-simultaneous saves are last-write-wins rather than a lost merge.
    await serializeWrites(filePath, () => writeSettingsFile(filePath, merged));
    settings = merged;
    warnings = [];
    exists = true;
    return merged;
  }

  return {
    filePath,
    current: () => settings,
    warnings: () => warnings,
    exists: () => exists,
    reload,
    save
  };
}
