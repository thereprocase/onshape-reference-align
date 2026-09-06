#!/usr/bin/env node
// A minimal, dependency-free structural sanity check for the GitHub Actions
// workflow files, in place of a real YAML parser (this project has zero npm
// dependencies and a YAML library would be the first one). It does not
// validate full YAML syntax — it checks the handful of things that have
// actually gone wrong in a hand-written workflow: tabs (YAML forbids them),
// every `uses:` pinned by a full 40-character commit SHA with a version
// comment instead of a bare tag, and the required top-level keys.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOWS_DIR = path.join(projectRoot, '.github', 'workflows');

const USES_RE = /^\s*-?\s*uses:\s*(\S+)/;
const PINNED_RE = /^([\w.-]+\/[\w.-]+)@([0-9a-f]{40})(\s+#.*v\d+(\.\d+){0,2}.*)?$/;

async function checkFile(filePath) {
  const errors = [];
  const text = await fs.readFile(filePath, 'utf8');
  const name = path.basename(filePath);

  if (text.includes('\t')) {
    errors.push('contains a tab character; YAML indentation must be spaces.');
  }
  for (const key of ['name:', 'on:', 'jobs:']) {
    if (!new RegExp(`^${key}`, 'm').test(text)) {
      errors.push(`missing a top-level "${key}" key.`);
    }
  }

  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const usesMatch = line.match(USES_RE);
    if (!usesMatch) continue;
    const value = usesMatch[1];
    if (!PINNED_RE.test(value)) {
      errors.push(
        `line ${index + 1}: "uses: ${value}" is not pinned by a full 40-character commit SHA ` +
        'with a trailing "# vX.Y.Z" comment.'
      );
    }
  }

  return { name, errors };
}

async function main() {
  let files;
  try {
    files = (await fs.readdir(WORKFLOWS_DIR)).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('No .github/workflows directory found; nothing to check.');
      return;
    }
    throw error;
  }

  if (!files.length) {
    console.log('No workflow files found; nothing to check.');
    return;
  }

  let failed = false;
  for (const file of files) {
    const { name, errors } = await checkFile(path.join(WORKFLOWS_DIR, file));
    if (errors.length) {
      failed = true;
      console.error(`${name}:`);
      for (const error of errors) console.error(`  - ${error}`);
    } else {
      console.log(`${name}: OK`);
    }
  }

  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
