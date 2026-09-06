#!/usr/bin/env node
// Builds a Node Single Executable Application binary for the current
// platform (or one named with --platform).
//
// Steps: verify sea-config.json/src/version.mjs are current, rebuild the
// bundle, generate the blob (a Node built-in, always run), copy the running
// node binary, and — only behind an explicit --allow-postject flag — inject
// the blob with postject and (on macOS) re-sign. Without that flag this
// script stops right after the blob and the copied-but-uninjected binary,
// which is enough to prove the whole pipeline up to injection works without
// ever running a third-party tool by default.
//
// Usage:
//   node scripts/build-sea.mjs [--platform windows-x64|darwin-arm64|linux-x64] [--allow-postject]
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// postject@1.0.0-alpha.6 is the version Node's own SEA docs point to (no 1.0.0
// GA exists). This integrity hash was captured by a live registry query
// (`npm view postject@1.0.0-alpha.6 dist.integrity`) during this project's
// packaging research and recorded in
// C:/Users/Example/AppData\Local\Temp\claude\...\scratchpad\wfa-packaging-plan.md
// — it is re-verified against the live registry below every time this script
// actually runs the injection step, so a compromised or republished tarball
// still fails closed even if this constant is ever stale.
const POSTJECT_VERSION = '1.0.0-alpha.6';
const POSTJECT_INTEGRITY = 'sha512-b9Eb8h2eVqNE8edvKdwqkrY6O7kAwmI8kcnBv1NScolYJbo59XUF0noFq+lxbC1yN20bmC0WBEbDC5H/7ASb0A==';
const SENTINEL_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

// node:sea's getAssetKeys()/getRawAsset() (used by src/assets.mjs in packaged
// mode) were added in Node 22.20.0 and 24.8.0 — two independent backports on
// two release lines, not one continuous threshold. A version between or
// below them (e.g. 23.x, which this pair of backports does not mention at
// all, or 24.7.x, which predates the 24.8.0 backport) does not have the API
// just because it numerically exceeds 22.20.0. Only a major beyond the
// highest one Node's own docs confirm is assumed to still carry it forward.
// The binary this script copies and injects is whatever `node` is currently
// running it, so that is the version that has to satisfy this floor — the
// >=22 engines field in package.json only governs running from source, not
// a packaged binary.
const MIN_VERSION_BY_MAJOR = { 22: [20, 0], 24: [8, 0] };
const HIGHEST_KNOWN_MAJOR = Math.max(...Object.keys(MIN_VERSION_BY_MAJOR).map(Number));

export function parseVersion(v) {
  return v.replace(/^v/, '').split('.').map(Number);
}

export function satisfiesMinimum(version, minimumByMajor = MIN_VERSION_BY_MAJOR) {
  const [major, minor, patch] = parseVersion(version);
  const highestKnown = Math.max(...Object.keys(minimumByMajor).map(Number));
  if (major > highestKnown) return true;
  const floor = minimumByMajor[major];
  if (!floor) return false; // an older, in-between, or otherwise unlisted major
  const [reqMinor, reqPatch] = floor;
  if (minor !== reqMinor) return minor > reqMinor;
  return patch >= reqPatch;
}

export function platformTarget(name, { platform = process.platform, arch = process.arch } = {}) {
  if (name) return name;
  const normalized = platform === 'win32' ? 'windows' : platform;
  return `${normalized}-${arch}`;
}

export function outputName(target) {
  return target.startsWith('windows-') ? 'reference-align.exe' : 'reference-align';
}

async function runNode(scriptRelPath, args = []) {
  console.log(`> node ${scriptRelPath} ${args.join(' ')}`.trim());
  await execFileAsync(process.execPath, [path.join(projectRoot, scriptRelPath), ...args], { cwd: projectRoot });
}

// Invoke npm's JavaScript entry point with this Node, not npm.cmd/npx.cmd:
// execFile cannot launch those Windows command wrappers without a shell.
async function npmCliPath() {
  const binDir = path.dirname(process.execPath);
  const candidates = [
    path.join(binDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.resolve(binDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  ];
  for (const candidate of candidates) {
    if (await fs.access(candidate).then(() => true, () => false)) return candidate;
  }
  throw new Error('This Node installation has no adjacent npm CLI. Install Node with npm to build the executable.');
}

async function verifyPostjectIntegrity() {
  console.log(`Verifying postject@${POSTJECT_VERSION} integrity against the recorded constant...`);
  let stdout;
  try {
    ({ stdout } = await execFileAsync(process.execPath, [await npmCliPath(), 'view', `postject@${POSTJECT_VERSION}`, 'dist.integrity'], { cwd: projectRoot }));
  } catch (error) {
    throw new Error(`Could not query the npm registry to verify postject's integrity hash (offline?): ${error.message}`);
  }
  const observed = stdout.trim();
  if (observed !== POSTJECT_INTEGRITY) {
    throw new Error(
      `postject@${POSTJECT_VERSION} integrity mismatch.\n` +
      `  expected: ${POSTJECT_INTEGRITY}\n` +
      `  observed: ${observed}\n` +
      'Refusing to run postject: the published tarball no longer matches the ' +
      'hash recorded in this script. This could mean a legitimate re-publish ' +
      '(update the constant deliberately after reviewing the new tarball) or ' +
      'a compromised/typosquatted package (do not proceed).'
    );
  }
  console.log('postject integrity verified.');
}

async function main() {
  const args = process.argv.slice(2);
  const allowPostject = args.includes('--allow-postject');
  const platformArg = args.find((arg) => arg.startsWith('--platform='))?.slice('--platform='.length);
  const target = platformTarget(platformArg);
  if (target !== platformTarget()) {
    throw new Error(`Cannot build ${target} using ${platformTarget()}'s Node executable. Run the build on the matching platform and architecture.`);
  }

  if (!satisfiesMinimum(process.version)) {
    throw new Error(
      `Node ${process.version} is too old to build a packaged binary: ` +
      'src/assets.mjs needs node:sea getAssetKeys()/getRawAsset(), added in ' +
      '22.20.0 and 24.8.0. Build with a newer Node (CI is pinned — see ' +
      '.github/workflows/release.yml and docs/DISTRIBUTION.md).'
    );
  }

  await runNode('scripts/gen-version.mjs', ['--check']);
  await runNode('scripts/sea-assets.mjs', ['--check']);
  await runNode('scripts/build-sea-bundle.mjs');
  console.log('> node --experimental-sea-config sea-config.json');
  await execFileAsync(process.execPath, ['--experimental-sea-config', 'sea-config.json'], { cwd: projectRoot });

  const outDir = path.join(projectRoot, 'dist', target);
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, outputName(target));
  await fs.copyFile(process.execPath, outPath);
  await fs.chmod(outPath, 0o755).catch(() => {}); // no-op on Windows
  console.log(`Copied ${process.execPath} -> ${outPath}`);

  if (target.startsWith('darwin-')) {
    console.log('> codesign --remove-signature (macOS, pre-injection)');
    execFileSync('codesign', ['--remove-signature', outPath]);
  }

  if (!allowPostject) {
    console.log('');
    console.log('Stopping before the injection step (no --allow-postject given).');
    console.log(`Blob:   ${path.join(projectRoot, 'dist', 'sea-prep.blob')}`);
    console.log(`Binary: ${outPath} (copied, not yet injected — this is a plain node binary, not a working SEA)`);
    console.log('Re-run with --allow-postject to inject and produce a working executable.');
    return;
  }

  await verifyPostjectIntegrity();
  const injectArgs = [
    'postject', outPath, 'NODE_SEA_BLOB', path.join('dist', 'sea-prep.blob'),
    '--sentinel-fuse', SENTINEL_FUSE
  ];
  if (target.startsWith('darwin-')) injectArgs.push('--macho-segment-name', 'NODE_SEA');
  console.log(`> npx postject@${POSTJECT_VERSION} ${injectArgs.slice(1).join(' ')}`);
  execFileSync(process.execPath, [await npmCliPath(), 'exec', '--yes', '--ignore-scripts', `--package=postject@${POSTJECT_VERSION}`, '--', ...injectArgs], {
    cwd: projectRoot,
    stdio: 'inherit'
  });

  if (target.startsWith('darwin-')) {
    console.log('> codesign --sign - (macOS, ad-hoc; replace with a real identity to distribute without Gatekeeper warnings)');
    execFileSync('codesign', ['--sign', '-', outPath]);
  }
  if (target.startsWith('windows-')) {
    console.log('Windows: no signature step run. See docs/DISTRIBUTION.md for the optional signtool step (requires a certificate).');
  }

  console.log('');
  console.log(`Built: ${outPath}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
