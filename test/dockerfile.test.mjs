import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Text scans rather than a Dockerfile parser: this project has no npm
// dependencies, and the ENV instructions here are written in one shape
// (`ENV KEY=value ...`, optionally continued with backslash-newlines).
function parseEnvAssignments(dockerfileText) {
  const assignments = {};
  const lines = dockerfileText.split('\n');
  let collecting = null;
  for (const line of lines) {
    if (collecting !== null) {
      collecting += `\n${line}`;
    } else if (/^ENV\s+/.test(line)) {
      collecting = line;
    }
    if (collecting !== null) {
      if (collecting.trimEnd().endsWith('\\')) continue;
      const body = collecting.replace(/^ENV\s+/, '').replace(/\\\n/g, ' ');
      for (const match of body.matchAll(/([A-Za-z_][A-Za-z0-9_]*)=(\S+)/g)) {
        assignments[match[1]] = match[2];
      }
      collecting = null;
    }
  }
  return assignments;
}

function extractMkdirPaths(dockerfileText) {
  const paths = [];
  for (const match of dockerfileText.matchAll(/mkdir\s+-p\s+(\S+)/g)) {
    paths.push(match[1]);
  }
  return paths;
}

test('every `mkdir -p` path in the Dockerfile is a path some ENV assignment points the resolver at', async () => {
  const dockerfileText = await fsp.readFile(path.join(root, 'Dockerfile'), 'utf8');
  const mkdirPaths = extractMkdirPaths(dockerfileText);
  assert.ok(mkdirPaths.length > 0, 'expected at least one `mkdir -p` in the Dockerfile');

  const envAssignments = parseEnvAssignments(dockerfileText);
  const envValues = new Set(Object.values(envAssignments));

  for (const mkdirPath of mkdirPaths) {
    assert.ok(
      envValues.has(mkdirPath),
      `Dockerfile creates ${mkdirPath} but no ENV assignment points there`
    );
  }
});

test('the Dockerfile sets BACKUP_DIR and ONSHAPE_REFERENCE_ALIGN_CONFIG', async () => {
  const dockerfileText = await fsp.readFile(path.join(root, 'Dockerfile'), 'utf8');
  const envAssignments = parseEnvAssignments(dockerfileText);

  assert.equal(envAssignments.BACKUP_DIR, '/app/backups');
  assert.equal(envAssignments.ONSHAPE_REFERENCE_ALIGN_CONFIG, '/app/.env');
});

test('docs/DISTRIBUTION.md names the same Docker paths as the Dockerfile', async () => {
  const dockerfileText = await fsp.readFile(path.join(root, 'Dockerfile'), 'utf8');
  const envAssignments = parseEnvAssignments(dockerfileText);
  const distributionText = await fsp.readFile(path.join(root, 'docs', 'DISTRIBUTION.md'), 'utf8');

  const dockerSectionMatch = distributionText.match(/## Docker \(secondary channel\)\n([\s\S]*?)(?:\n## |$)/);
  assert.ok(dockerSectionMatch, 'expected a "## Docker (secondary channel)" section in docs/DISTRIBUTION.md');
  const dockerSection = dockerSectionMatch[1];

  assert.ok(
    dockerSection.includes(envAssignments.BACKUP_DIR),
    `docs/DISTRIBUTION.md Docker section should mention ${envAssignments.BACKUP_DIR}`
  );
  assert.ok(
    dockerSection.includes(envAssignments.ONSHAPE_REFERENCE_ALIGN_CONFIG),
    `docs/DISTRIBUTION.md Docker section should mention ${envAssignments.ONSHAPE_REFERENCE_ALIGN_CONFIG}`
  );
});
