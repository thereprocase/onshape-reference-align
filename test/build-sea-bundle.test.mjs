import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { buildBundle } from '../scripts/build-sea-bundle.mjs';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('buildBundle produces syntactically valid, no-import/export, single-file JavaScript', async () => {
  const bundle = await buildBundle();
  assert.ok(bundle.length > 1000, 'expected a substantial bundle');

  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'reference-align-bundle-'));
  const bundlePath = path.join(dir, 'bundle.cjs');
  try {
    await fsp.writeFile(bundlePath, bundle);
    // node --check proves the file parses as CommonJS with no leftover
    // import/export declarations, no duplicate top-level identifiers, and no
    // top-level await this bundler cannot support.
    await execFileAsync(process.execPath, ['--check', bundlePath]);

    // Every local import must have been rewritten to a __require() call, and
    // no bundled module keeps its own "export" keyword — otherwise a passing
    // --check could still hide an accidentally-unbundled module that a bare
    // "export" line's syntax happens not to break. Hoisted node: builtin
    // imports are expected to remain, so only a relative-specifier import is
    // checked for.
    assert.doesNotMatch(bundle, /^\s*export\s+(default|const|let|var|function|class|\{)/m);
    assert.doesNotMatch(bundle, /^\s*import\s/m, 'SEA on Node 22/24 needs CommonJS');
    assert.doesNotMatch(bundle, /from\s+['"]\.\.?\//, 'no leftover static import of a local module');
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

// Synthetic, self-contained fixture graphs, so these guard-rail tests do not
// depend on the real source tree ever containing (or not containing) a risky
// pattern. Each one is a fresh temp "project root" with its own entry.mjs.
async function withFixture(files, run) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'reference-align-bundle-fixture-'));
  try {
    for (const [name, contents] of Object.entries(files)) {
      await fsp.writeFile(path.join(dir, name), contents);
    }
    return await run(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

test('buildBundle refuses a default export instead of silently dropping it', async () => {
  await withFixture({ 'entry.mjs': 'export default function () {}\n' }, async (dir) => {
    await assert.rejects(
      () => buildBundle({ entryKey: 'entry.mjs', projectRoot: dir }),
      /export default is not supported/
    );
  });
});

test('buildBundle refuses a bare "export { ... }" list instead of silently dropping it', async () => {
  await withFixture(
    { 'entry.mjs': 'const a = 1;\nexport { a };\n' },
    async (dir) => {
      await assert.rejects(
        () => buildBundle({ entryKey: 'entry.mjs', projectRoot: dir }),
        /bare "export \{ \.\.\. \}" list/
      );
    }
  );
});

test('buildBundle refuses a namespace import instead of silently mis-bundling it', async () => {
  await withFixture(
    {
      'entry.mjs': "import * as helper from './helper.mjs';\nexport const x = helper;\n",
      'helper.mjs': 'export const y = 1;\n'
    },
    async (dir) => {
      await assert.rejects(
        () => buildBundle({ entryKey: 'entry.mjs', projectRoot: dir }),
        /namespace import/
      );
    }
  );
});

test('buildBundle refuses a bare-package import, since the project has zero npm dependencies', async () => {
  await withFixture({ 'entry.mjs': "import something from 'left-pad';\n" }, async (dir) => {
    await assert.rejects(
      () => buildBundle({ entryKey: 'entry.mjs', projectRoot: dir }),
      /unsupported bare-package import/
    );
  });
});

test('buildBundle scopes each module to its own factory, so two files may each declare a private helper of the same name', async () => {
  await withFixture(
    {
      'entry.mjs': "import { a } from './a.mjs';\nimport { b } from './b.mjs';\nconsole.log(a() + b());\n",
      'a.mjs': 'function helper() { return 1; }\nexport function a() { return helper(); }\n',
      'b.mjs': 'function helper() { return 2; }\nexport function b() { return helper(); }\n'
    },
    async (dir) => {
      const bundle = await buildBundle({ entryKey: 'entry.mjs', projectRoot: dir });
      const dist = path.join(dir, 'bundle.cjs');
      await fsp.writeFile(dist, bundle);
      // If the two files' private "helper" declarations collided in a shared
      // scope, this would either fail to parse or print the wrong sum.
      const result = await execFileAsync(process.execPath, [dist]);
      assert.equal(result.stdout.trim(), '3');
    }
  );
});

test('the running bundle answers /api/health identically to server.mjs from source', async () => {
  const bundle = await buildBundle();
  // Written under the real checkout's dist/ directory (gitignored, cleaned up
  // below) rather than an unrelated temp directory: the bundle still contains
  // config.mjs's own import.meta.url-based defaultProjectRoot fallback, which
  // — once every file is flattened into one — resolves relative to wherever
  // *this* file sits. dist/ is one level under the real project root, which
  // is exactly where scripts/build-sea-bundle.mjs writes it by default, so
  // this reproduces the actual build layout instead of a coincidence that
  // only holds for that one specific nesting depth.
  const bundlePath = path.join(root, 'dist', 'bundle.cjs');
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'reference-align-bundle-run-'));
  const configPath = path.join(dir, '.env');
  try {
    await fsp.mkdir(path.dirname(bundlePath), { recursive: true });
    await fsp.writeFile(bundlePath, bundle);
    await fsp.writeFile(configPath, [
      'HOST=127.0.0.1',
      'PORT=0',
      'ONSHAPE_AUTH=none',
      'SESSION_SECRET=bundle-test-only',
      'NODE_ENV=test',
      ''
    ].join('\n'));

    const child = spawn(process.execPath, [bundlePath, '--config', configPath, '--no-open'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    try {
      const deadline = Date.now() + 10_000;
      let port;
      while (Date.now() < deadline) {
        const match = stdout.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
        if (match) { port = Number(match[1]); break; }
        if (child.exitCode !== null) throw new Error(`Bundle exited early (${child.exitCode}): ${stderr}`);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.ok(port, `expected a bound-port line in stdout, got: ${stdout}\n${stderr}`);

      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      assert.equal(response.status, 200);
      const health = await response.json();
      assert.equal(health.ok, true);
      assert.equal(health.authMode, 'none');

      const uiResponse = await fetch(`http://127.0.0.1:${port}/`);
      assert.equal(uiResponse.status, 200);
      assert.match(await uiResponse.text(), /Reference Align/);
    } finally {
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 2_000);
      await new Promise((resolve) => child.once('exit', resolve));
      clearTimeout(timer);
    }
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
    await fsp.rm(bundlePath, { force: true });
  }
});
