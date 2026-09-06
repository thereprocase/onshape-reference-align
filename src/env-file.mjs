import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

const GENERATED_HEADER = '# Added by Reference Align setup';
const TEMP_PREFIX = '.env.tmp-';
const ORPHAN_TEMP_MAX_AGE_MS = 60 * 60 * 1000;

function unquote(raw) {
  const value = String(raw);
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\(["\\])/g, '$1');
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
}

function quote(raw) {
  const value = String(raw);
  if (value === '') return '';
  if (!/[\s#'"]/.test(value)) return value;
  return `"${value.replace(/([\\"])/g, '\\$1')}"`;
}

/**
 * Drop a trailing "# comment" from an unquoted value, matching standard
 * dotenv behaviour. Quoted values are left untouched — the comment marker
 * only counts outside quotes, and unquote() is what strips the quotes.
 */
function stripUnquotedComment(raw) {
  if (raw.startsWith('"') || raw.startsWith("'")) return raw;
  const match = raw.match(/\s#/);
  if (!match) return raw;
  return raw.slice(0, match.index).trimEnd();
}

function assertNoLineBreak(key, value) {
  if (/[\n\r]/.test(String(value))) {
    throw Object.assign(new Error('Config values cannot contain a line break.'), {
      status: 400,
      code: 'INVALID_CONFIG_VALUE',
      key
    });
  }
}

/**
 * Parse env-file text into a plain key/value map. Whole-line comments and
 * blanks are dropped; a trailing " #..." comment on an unquoted value is also
 * dropped, matching standard dotenv behaviour. A quoted value keeps a literal
 * "#" of its own.
 */
export function parseEnvFile(text) {
  const result = {};
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    result[line.slice(0, eq).trim()] = unquote(stripUnquotedComment(line.slice(eq + 1).trim()));
  }
  return result;
}

/**
 * Apply key updates to env-file text.
 *
 * Every line the update does not name is preserved byte-for-byte and in order,
 * because this file is hand-edited by operators and losing their comments to a
 * machine rewrite is the fastest way to make them stop trusting the tool. A
 * null value deletes the key. Values containing a line break are rejected:
 * that is header injection, not data.
 */
export function updateEnvText(text, updates = {}) {
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === undefined) continue;
    assertNoLineBreak(key, value);
  }

  const original = String(text ?? '');
  const lineEnding = original.includes('\r\n') ? '\r\n' : '\n';
  const pending = new Map(Object.entries(updates));
  const output = [];

  for (const rawLine of original.split('\n')) {
    const carriage = rawLine.endsWith('\r') ? '\r' : '';
    const body = carriage ? rawLine.slice(0, -1) : rawLine;
    const trimmed = body.trim();
    const eq = trimmed.indexOf('=');
    const key = !trimmed || trimmed.startsWith('#') || eq < 1 ? undefined : trimmed.slice(0, eq).trim();

    if (key === undefined || !pending.has(key)) {
      output.push(rawLine);
      continue;
    }

    const value = pending.get(key);
    pending.delete(key);
    if (value === null || value === undefined) continue;
    output.push(`${key}=${quote(value)}${carriage}`);
  }

  while (output.length && output[output.length - 1].trim() === '') output.pop();

  const appended = [...pending].filter(([, value]) => value !== null && value !== undefined);
  if (appended.length) {
    // The header only earns its place in a file an operator already owns. A
    // file this tool generates from scratch is entirely "added by setup".
    if (output.length) {
      output.push('');
      if (!original.includes(GENERATED_HEADER)) output.push(GENERATED_HEADER);
    }
    for (const [key, value] of appended) output.push(`${key}=${quote(value)}`);
  }

  if (!output.length) return '';
  return output.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line)).join(lineEnding) + lineEnding;
}

/** Read env-file text, treating a missing file as empty. */
export async function readEnvFileText(filePath) {
  try {
    return await fsp.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

/**
 * Write text through a same-directory temp file and a rename.
 *
 * The temp file is a sibling so the rename stays on one volume and is therefore
 * atomic; a cross-device rename is a hard failure rather than a copy fallback,
 * since a non-atomic fallback reintroduces the partial-write corruption this
 * function exists to prevent. On Windows the mode bits are advisory - the real
 * protection is the containing directory's ACL.
 *
 * `tempPrefix` is a parameter so a second file in the same directory gets its
 * own orphan namespace and one file's crash sweep cannot delete another's
 * in-flight temp file.
 */
export async function writeFileAtomic(filePath, text, { mode = 0o600, tempPrefix = TEMP_PREFIX } = {}) {
  const directory = path.dirname(filePath);
  await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
  const tempPath = path.join(
    directory,
    `${tempPrefix}${process.pid}-${crypto.randomBytes(6).toString('hex')}`
  );
  try {
    await fsp.writeFile(tempPath, text, { mode });
    await fsp.rename(tempPath, filePath);
  } catch (error) {
    await fsp.unlink(tempPath).catch(() => {});
    throw error;
  }
  await fsp.chmod(filePath, mode).catch(() => {});
}

export function writeEnvFileAtomic(filePath, text) {
  return writeFileAtomic(filePath, text, { mode: 0o600, tempPrefix: TEMP_PREFIX });
}

/**
 * Delete stale temp files left by a crashed write. They hold live credentials,
 * so an orphan is a secret sitting in a world-listable directory.
 */
export async function sweepOrphanTempFiles(directory, { prefix = TEMP_PREFIX, now = Date.now() } = {}) {
  let entries;
  try {
    entries = await fsp.readdir(directory);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.startsWith(prefix)) continue;
    const candidate = path.join(directory, entry);
    try {
      const stat = await fsp.stat(candidate);
      if (now - stat.mtimeMs > ORPHAN_TEMP_MAX_AGE_MS) await fsp.unlink(candidate);
    } catch {
      // A racing writer may have already renamed or removed it.
    }
  }
}

// Saves are serialised so two near-simultaneous writes are last-write-wins
// rather than a silent lost merge through a stale read. Keyed by target path:
// a second writable file (the policy settings file) shares this module's
// atomic-write machinery, and one global chain would make an unrelated slow
// write block it for no reason.
const saveQueues = new Map();

export function serializeWrites(filePath, task) {
  const key = path.resolve(filePath);
  const previous = saveQueues.get(key) || Promise.resolve();
  const run = previous.then(task, task);
  const settled = run.then(() => undefined, () => undefined);
  saveQueues.set(key, settled);
  // Drop the entry once nothing else has queued behind it, so a long-lived
  // process does not accumulate one resolved promise per path forever.
  settled.then(() => {
    if (saveQueues.get(key) === settled) saveQueues.delete(key);
  });
  return run;
}

async function applyEnvUpdatesNow(filePath, updates, { write }) {
  let before = '';
  let created = false;
  try {
    before = await fsp.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    created = true;
  }

  const priorValues = parseEnvFile(before);
  const changedKeys = [];
  for (const [key, value] of Object.entries(updates)) {
    const prior = priorValues[key];
    if (value === null || value === undefined) {
      if (prior !== undefined) changedKeys.push(key);
      continue;
    }
    if (prior !== String(value)) changedKeys.push(key);
  }

  await write(filePath, updateEnvText(before, updates));
  await sweepOrphanTempFiles(path.dirname(filePath), { prefix: TEMP_PREFIX });
  return { created, changedKeys };
}

export function applyEnvUpdates(filePath, updates = {}, { write = writeEnvFileAtomic } = {}) {
  return serializeWrites(filePath, () => applyEnvUpdatesNow(filePath, updates, { write }));
}
