import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';

const workflow = await fsp.readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');

test('Unix launchers replace the shell so closing/stopping them stops the app', async () => {
  for (const suffix of ['sh', 'command']) {
    const launcher = await fsp.readFile(new URL(`../scripts/START-REFERENCE-ALIGN.${suffix}`, import.meta.url), 'utf8');
    assert.match(launcher, /exec "\$launcher_dir\/reference-align" --open "\$@"/);
    if (suffix === 'command') assert.match(launcher, /exec "\$launcher_dir\/runtime\/node"/);
  }
});

test('native release matrix includes both Mac architectures and only novice ZIP outputs', () => {
  const matrix = workflow.split('        include:')[1].split('    runs-on:')[0];
  const entries = matrix.split(/\n\s+- os: /).slice(1);
  assert.equal(entries.length, 4);
  for (const [target, runner] of [
    ['windows-x64', 'windows-latest'], ['darwin-arm64', 'macos-15'],
    ['darwin-x64', 'macos-15-intel'], ['linux-x64', 'ubuntu-latest']
  ]) {
    const entry = entries.find(value => value.includes(`target: ${target}`));
    assert.ok(entry, target);
    assert.equal(entry.split('\n')[0].trim(), runner);
    assert.match(entry, /artifact: reference-align-[\w-]+\.zip\n/);
    assert.match(entry, /launcher: (cmd|command|sh)/);
  }
});

test('ZIP assembly includes guide, project and Node licenses, executable, and launcher with executable modes', () => {
  for (const text of ['START-HERE.html', 'LICENSE.txt', 'NODE-LICENSE.txt', 'PACKAGE_BINARY', 'PACKAGE_LAUNCHER', '0o755', 'archive.testzip()']) {
    assert.ok(workflow.includes(text), text);
  }
  assert.ok(workflow.indexOf('scripts/smoke-binary.mjs') < workflow.indexOf('name: Package novice desktop ZIP'));
  assert.ok(workflow.indexOf('name: Sign Windows binary') < workflow.indexOf('name: Package novice desktop ZIP'));
  assert.match(workflow, /startsWith\(matrix.target, 'darwin-'\)/);
  assert.ok(workflow.includes('https://raw.githubusercontent.com/nodejs/node/v24.14.1/LICENSE'));
  assert.ok(!workflow.includes('https://nodejs.org/dist/v24.14.1/LICENSE'));
});
