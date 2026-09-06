#!/usr/bin/env node
// Generates sea-config.json from the actual contents of public/ and
// featurescript/ReferenceImage.fs, so the embedded-asset list cannot drift
// from what server.mjs (via src/assets.mjs) actually serves: adding a file
// under public/ and forgetting to hand-list it here used to be exactly the
// kind of mistake that only shows up once a user's browser 404s on it.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = path.join(projectRoot, 'sea-config.json');
const BUNDLE_PATH = 'dist/bundle.cjs';
const BLOB_PATH = 'dist/sea-prep.blob';

async function walk(dir) {
  const entries = await fs.readdir(path.join(projectRoot, dir), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...await walk(rel));
    } else if (entry.isFile()) {
      files.push(rel);
    }
  }
  return files;
}

export async function buildAssetMap() {
  const publicFiles = await walk('public');
  const assets = {};
  for (const file of publicFiles.sort()) {
    assets[file] = file;
  }
  assets['featurescript/ReferenceImage.fs'] = 'featurescript/ReferenceImage.fs';
  return assets;
}

export async function buildSeaConfig() {
  const assets = await buildAssetMap();
  return {
    main: BUNDLE_PATH,
    output: BLOB_PATH,
    disableExperimentalSEAWarning: true,
    // Node 22/24 SEA executes CommonJS. Do not use newer Node's mainFormat
    // option: older runtimes ignore it and would execute ESM as CommonJS.
    // Avoid architecture-dependent snapshots and code caches.
    useSnapshot: false,
    useCodeCache: false,
    assets
  };
}

function render(config) {
  return `${JSON.stringify(config, null, 2)}\n`;
}

async function main() {
  const check = process.argv.includes('--check');
  const config = await buildSeaConfig();
  const rendered = render(config);

  if (check) {
    let existing;
    try {
      existing = await fs.readFile(CONFIG_PATH, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') existing = null;
      else throw error;
    }
    if (existing !== rendered) {
      console.error('sea-config.json is out of date. Run: node scripts/sea-assets.mjs');
      process.exit(1);
    }
    console.log('sea-config.json is current.');
    return;
  }

  await fs.writeFile(CONFIG_PATH, rendered);
  console.log(`Wrote sea-config.json with ${Object.keys(config.assets).length} embedded assets.`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
