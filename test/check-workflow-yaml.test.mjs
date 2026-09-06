import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const scriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'check-workflow-yaml.mjs');

async function withWorkflowsDir(files, run) {
  const projectRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'reference-align-workflow-check-'));
  const workflowsDir = path.join(projectRoot, '.github', 'workflows');
  await fsp.mkdir(workflowsDir, { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    await fsp.writeFile(path.join(workflowsDir, name), contents);
  }
  try {
    // The real script always resolves ".github/workflows" one level above
    // its own directory (i.e. <root>/scripts/this.mjs -> <root>/.github/…),
    // so a fixture has to reproduce that same relative layout rather than
    // being pointed at with an argument.
    const scriptsDir = path.join(projectRoot, 'scripts');
    await fsp.mkdir(scriptsDir, { recursive: true });
    const scriptCopy = path.join(scriptsDir, 'check-workflow-yaml.mjs');
    const scriptText = await fsp.readFile(scriptPath, 'utf8');
    await fsp.writeFile(scriptCopy, scriptText);
    return await run(scriptCopy, projectRoot);
  } finally {
    await fsp.rm(projectRoot, { recursive: true, force: true });
  }
}

test('accepts a workflow with every "uses:" pinned by a full commit SHA and a version comment', async () => {
  await withWorkflowsDir(
    {
      'ci.yml': [
        'name: ci',
        'on:',
        '  push:',
        'jobs:',
        '  check:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
        ''
      ].join('\n')
    },
    async (scriptCopy) => {
      const { stdout } = await execFileAsync(process.execPath, [scriptCopy]);
      assert.match(stdout, /ci\.yml: OK/);
    }
  );
});

test('rejects a "uses:" pinned only by a floating tag', async () => {
  await withWorkflowsDir(
    {
      'ci.yml': [
        'name: ci',
        'on:',
        '  push:',
        'jobs:',
        '  check:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/checkout@v7',
        ''
      ].join('\n')
    },
    async (scriptCopy) => {
      await assert.rejects(() => execFileAsync(process.execPath, [scriptCopy]));
    }
  );
});

test('rejects a workflow missing a required top-level key', async () => {
  await withWorkflowsDir(
    { 'ci.yml': 'on:\n  push:\njobs:\n  check:\n    runs-on: ubuntu-latest\n' },
    async (scriptCopy) => {
      await assert.rejects(() => execFileAsync(process.execPath, [scriptCopy]));
    }
  );
});

test('rejects a workflow containing a tab character', async () => {
  await withWorkflowsDir(
    { 'ci.yml': 'name: ci\non:\n\tpush:\njobs:\n  check:\n    runs-on: ubuntu-latest\n' },
    async (scriptCopy) => {
      await assert.rejects(() => execFileAsync(process.execPath, [scriptCopy]));
    }
  );
});

test('the real committed workflows pass the checker', async () => {
  const { stdout } = await execFileAsync(process.execPath, [scriptPath]);
  assert.match(stdout, /ci\.yml: OK/);
  assert.match(stdout, /release\.yml: OK/);
});
