import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const APP_NAME = 'onshape-reference-align';
export const CONFIG_ENV_VAR = 'ONSHAPE_REFERENCE_ALIGN_CONFIG';

/**
 * Per-user configuration directory for this application.
 *
 * The platform, environment, and home directory are injectable so the branches
 * can be exercised on any host without mutating process-level state.
 */
export function userConfigDir(appName = APP_NAME, {
  platform = process.platform,
  env = process.env,
  homedir = os.homedir
} = {}) {
  if (platform === 'win32') {
    const base = env.APPDATA || path.join(homedir(), 'AppData', 'Roaming');
    return path.join(base, appName);
  }
  if (platform === 'darwin') {
    return path.join(homedir(), 'Library', 'Application Support', appName);
  }
  const base = env.XDG_CONFIG_HOME || path.join(homedir(), '.config');
  return path.join(base, appName);
}

/** Read `--config <path>` or `--config=<path>` out of an argv array. */
export function parseConfigFlag(argv = process.argv) {
  const list = Array.isArray(argv) ? argv : [];
  for (let index = 0; index < list.length; index += 1) {
    const argument = String(list[index]);
    if (argument === '--config') {
      const value = list[index + 1];
      if (value !== undefined && !String(value).startsWith('-')) return String(value);
      return undefined;
    }
    if (argument.startsWith('--config=')) {
      const value = argument.slice('--config='.length);
      return value ? value : undefined;
    }
  }
  return undefined;
}

/**
 * Decide which env file this process reads, first match wins.
 *
 * The project-root file is only chosen when it exists, so a binary run from a
 * directory with no checkout falls through to the per-user location instead of
 * silently starting unconfigured against a path nobody will ever create.
 */
export function resolveEnvFile({
  argv = process.argv,
  env = process.env,
  projectRoot,
  exists = fs.existsSync,
  userDir
} = {}) {
  const root = projectRoot || process.cwd();

  const flagPath = parseConfigFlag(argv);
  if (flagPath) {
    const resolved = path.resolve(root, flagPath);
    return { path: resolved, source: 'cli', exists: Boolean(exists(resolved)) };
  }

  const envPath = env[CONFIG_ENV_VAR];
  if (envPath) {
    const resolved = path.resolve(root, envPath);
    return { path: resolved, source: 'env', exists: Boolean(exists(resolved)) };
  }

  const projectPath = path.join(root, '.env');
  if (exists(projectPath)) {
    return { path: projectPath, source: 'project', exists: true };
  }

  const resolved = path.join(userDir || userConfigDir(APP_NAME, { env }), '.env');
  return { path: resolved, source: 'user', exists: Boolean(exists(resolved)) };
}

/**
 * Where the policy settings file lives: beside the resolved env file, whatever
 * resolved it.
 *
 * Deriving it from the env file rather than resolving it independently is what
 * keeps `--config <path>` meaning one directory. An empty env path is refused
 * rather than defaulted, because path.dirname('') is '.' and that would drop a
 * settings file into whatever directory the process happened to start in.
 */
export function resolveSettingsFile(envFilePath) {
  const text = String(envFilePath || '');
  if (!text) throw new Error('resolveSettingsFile needs the resolved env file path.');
  return path.join(path.dirname(text), 'settings.json');
}

/**
 * Where feature-list backups are written.
 *
 * Keyed off the env-file source rather than any packaging check, so every run
 * from a source checkout keeps writing to the project's own backups directory.
 */
export function resolveBackupDir({
  envValue,
  projectRoot,
  envFileSource,
  userDir = userConfigDir()
} = {}) {
  const root = projectRoot || process.cwd();
  if (envValue) return path.resolve(root, envValue);
  if (envFileSource === 'user') return path.join(userDir, 'backups');
  return path.resolve(root, './backups');
}
