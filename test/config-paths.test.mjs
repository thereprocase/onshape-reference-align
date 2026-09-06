import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  APP_NAME,
  CONFIG_ENV_VAR,
  userConfigDir,
  parseConfigFlag,
  resolveEnvFile,
  resolveBackupDir
} from '../src/config-paths.mjs';

const home = () => path.join(path.sep, 'home', 'tester');

test('userConfigDir uses APPDATA on Windows', () => {
  const dir = userConfigDir(APP_NAME, {
    platform: 'win32',
    env: { APPDATA: 'C:\Users\tester\AppData\Roaming' },
    homedir: home
  });
  assert.equal(dir, path.join('C:\Users\tester\AppData\Roaming', APP_NAME));
});

test('userConfigDir falls back to the Roaming path when APPDATA is unset', () => {
  const dir = userConfigDir(APP_NAME, { platform: 'win32', env: {}, homedir: home });
  assert.equal(dir, path.join(home(), 'AppData', 'Roaming', APP_NAME));
});

test('userConfigDir uses Application Support on macOS', () => {
  const dir = userConfigDir(APP_NAME, { platform: 'darwin', env: {}, homedir: home });
  assert.equal(dir, path.join(home(), 'Library', 'Application Support', APP_NAME));
});

test('userConfigDir falls back to ~/.config on Linux when XDG_CONFIG_HOME is unset', () => {
  const dir = userConfigDir(APP_NAME, { platform: 'linux', env: {}, homedir: home });
  assert.equal(dir, path.join(home(), '.config', APP_NAME));
});

test('userConfigDir honours XDG_CONFIG_HOME on Linux', () => {
  const dir = userConfigDir(APP_NAME, {
    platform: 'linux',
    env: { XDG_CONFIG_HOME: path.join(home(), 'xdg') },
    homedir: home
  });
  assert.equal(dir, path.join(home(), 'xdg', APP_NAME));
});

test('parseConfigFlag reads both --config forms and ignores everything else', () => {
  assert.equal(parseConfigFlag(['node', 'server.mjs', '--config', '/tmp/a.env']), '/tmp/a.env');
  assert.equal(parseConfigFlag(['node', 'server.mjs', '--config=/tmp/b.env']), '/tmp/b.env');
  assert.equal(parseConfigFlag(['node', 'server.mjs']), undefined);
  assert.equal(parseConfigFlag(['node', 'server.mjs', '--config']), undefined);
  assert.equal(parseConfigFlag(['node', 'server.mjs', '--config', '--watch']), undefined);
  assert.equal(parseConfigFlag([]), undefined);
});

test('resolveEnvFile prefers --config over every other source', () => {
  const result = resolveEnvFile({
    argv: ['node', 'server.mjs', '--config', path.join(path.sep, 'tmp', 'cli.env')],
    env: { [CONFIG_ENV_VAR]: path.join(path.sep, 'tmp', 'from-env.env') },
    projectRoot: path.join(path.sep, 'project'),
    exists: () => true,
    userDir: path.join(path.sep, 'user')
  });
  assert.equal(result.source, 'cli');
  assert.equal(result.path, path.resolve(path.join(path.sep, 'project'), path.join(path.sep, 'tmp', 'cli.env')));
  assert.equal(result.exists, true);
});

test('resolveEnvFile falls to the environment variable when no flag is present', () => {
  const result = resolveEnvFile({
    argv: ['node', 'server.mjs'],
    env: { [CONFIG_ENV_VAR]: path.join(path.sep, 'tmp', 'from-env.env') },
    projectRoot: path.join(path.sep, 'project'),
    exists: () => true,
    userDir: path.join(path.sep, 'user')
  });
  assert.equal(result.source, 'env');
  assert.equal(result.path, path.resolve(path.join(path.sep, 'project'), path.join(path.sep, 'tmp', 'from-env.env')));
});

test('resolveEnvFile uses the project .env only when it exists', () => {
  const projectRoot = path.join(path.sep, 'project');
  const projectEnv = path.join(projectRoot, '.env');
  const result = resolveEnvFile({
    argv: ['node', 'server.mjs'],
    env: {},
    projectRoot,
    exists: (candidate) => candidate === projectEnv,
    userDir: path.join(path.sep, 'user')
  });
  assert.deepEqual(result, { path: projectEnv, source: 'project', exists: true });
});

test('resolveEnvFile falls through to the user config directory with exists false', () => {
  const result = resolveEnvFile({
    argv: ['node', 'server.mjs'],
    env: {},
    projectRoot: path.join(path.sep, 'project'),
    exists: () => false,
    userDir: path.join(path.sep, 'user')
  });
  assert.deepEqual(result, {
    path: path.join(path.sep, 'user', '.env'),
    source: 'user',
    exists: false
  });
});

test('resolveBackupDir keeps project runs writing beside the checkout', () => {
  const projectRoot = path.join(path.sep, 'project');
  assert.equal(
    resolveBackupDir({ projectRoot, envFileSource: 'project', userDir: path.join(path.sep, 'user') }),
    path.resolve(projectRoot, './backups')
  );
  assert.equal(
    resolveBackupDir({ projectRoot, envFileSource: 'cli', userDir: path.join(path.sep, 'user') }),
    path.resolve(projectRoot, './backups')
  );
});

test('resolveBackupDir moves backups next to a per-user config file', () => {
  assert.equal(
    resolveBackupDir({
      projectRoot: path.join(path.sep, 'project'),
      envFileSource: 'user',
      userDir: path.join(path.sep, 'user')
    }),
    path.join(path.sep, 'user', 'backups')
  );
});

test('an explicit BACKUP_DIR wins in both modes and resolves against the project root', () => {
  const projectRoot = path.join(path.sep, 'project');
  assert.equal(
    resolveBackupDir({ envValue: './custom', projectRoot, envFileSource: 'project' }),
    path.resolve(projectRoot, './custom')
  );
  assert.equal(
    resolveBackupDir({
      envValue: './custom',
      projectRoot,
      envFileSource: 'user',
      userDir: path.join(path.sep, 'user')
    }),
    path.resolve(projectRoot, './custom')
  );
});
