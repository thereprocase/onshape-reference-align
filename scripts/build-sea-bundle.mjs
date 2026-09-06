#!/usr/bin/env node
// Hand-rolled static bundler for the SEA build.
//
// Why this exists: a Node Single Executable Application's injected main
// script cannot load anything from the filesystem — "module loading does not
// read from the file system. By default, both require() and import would
// only be able to load the built-in modules." (nodejs.org/api/single-executable-applications.html)
// This project has zero npm dependencies and a small, fully static import
// graph (relative specifiers only, no default exports, no namespace imports,
// no dynamic import() of anything but the node:sea built-in), so a hand-
// rolled build-time bundler is realistic here instead of adding a bundler
// devDependency purely to solve this one problem.
//
// Strategy: each local module is wrapped in its own factory function (a
// minimal CommonJS-style module system), so its private top-level names stay
// scoped to that function and cannot collide with another file's private
// names the way flattening everything into one shared scope would. Only
// `require('./relative.mjs')` calls and the exported names cross that
// boundary. node: built-ins become top-level require() calls. Node 22/24 SEA
// executes CommonJS, regardless of a newer mainFormat option. import.meta.url
// becomes the bundle's file URL (__filename is the executable in SEA), matching
// the previous bundle-relative path semantics; packaged assets use node:sea.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultProjectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY_KEY = 'server.mjs';

// Matches a static `import <clause> from '<specifier>';` declaration. The
// named-import clause `{...}` is allowed to span multiple lines (a bare `.`
// character class already matches newlines); dynamic `import(...)` never
// matches this because it has no `from` clause.
const IMPORT_RE = /import\s+(\*\s+as\s+[A-Za-z_$][\w$]*|\{[^}]*\}|[A-Za-z_$][\w$]*)\s+from\s+(['"])([^'"]+)\2\s*;?/g;

// Matches a top-level `export <keyword> <Name>` declaration this bundler
// knows how to re-expose. Anything else exported (a bare `export { ... }`
// list, `export default`, a multi-binding `export const a = 1, b = 2`) is
// refused loudly rather than silently dropped — see assertNoUnsupportedExports.
const EXPORT_DECL_RE = /^export\s+(async\s+function\*?|function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;

function toKey(projectRoot, absPath) {
  return path.relative(projectRoot, absPath).split(path.sep).join('/');
}

function resolveLocalSpecifier(projectRoot, fromKey, specifier) {
  const fromDir = path.dirname(path.join(projectRoot, fromKey));
  let resolved = path.resolve(fromDir, specifier);
  if (!resolved.endsWith('.mjs')) resolved += '.mjs';
  return toKey(projectRoot, resolved);
}

function assertNoUnsupportedExports(source, key) {
  if (/^export\s+default\b/m.test(source)) {
    throw new Error(`${key}: export default is not supported by this bundler.`);
  }
  if (/^export\s*\{/m.test(source)) {
    throw new Error(`${key}: a bare "export { ... }" list is not supported by this bundler.`);
  }
  if (/^export\s+(const|let|var)\s+[A-Za-z_$][\w$]*\s*,/m.test(source)) {
    throw new Error(`${key}: a multi-binding export declaration ("export const a = 1, b = 2") is not supported by this bundler.`);
  }
}

function assertNoUnsupportedImports(clause, specifier, key) {
  if (clause.startsWith('*')) {
    throw new Error(`${key}: a namespace import ("import * as x") of ${specifier} is not supported by this bundler.`);
  }
  if (/\bas\b/.test(clause)) {
    throw new Error(`${key}: an aliased import ("... as ...") of ${specifier} is not supported by this bundler.`);
  }
}

/**
 * Walk the local (relative-specifier) import graph starting at the entry
 * point, post-order, so every module appears after the modules it depends
 * on. Also collects every node: built-in import encountered, merged by
 * specifier so each ends up hoisted exactly once.
 */
async function collectGraph(projectRoot, entryKey) {
  const order = [];
  const visited = new Set();
  const visiting = new Set();
  const sources = new Map();
  const builtins = new Map(); // specifier -> { defaultName: string|null, named: Set<string> }

  function recordBuiltin(clause, specifier, key) {
    let entry = builtins.get(specifier);
    if (!entry) {
      entry = { defaultName: null, named: new Set() };
      builtins.set(specifier, entry);
    }
    if (clause.startsWith('{')) {
      for (const part of clause.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean)) {
        entry.named.add(part);
      }
    } else {
      if (entry.defaultName && entry.defaultName !== clause) {
        throw new Error(
          `${key}: built-in ${specifier} is imported as both "${entry.defaultName}" and "${clause}" ` +
          'somewhere in the graph; this bundler hoists one shared binding per specifier.'
        );
      }
      entry.defaultName = clause;
    }
  }

  async function visit(key) {
    if (visited.has(key)) return;
    if (visiting.has(key)) throw new Error(`Circular import detected involving ${key}.`);
    visiting.add(key);

    const source = await fs.readFile(path.join(projectRoot, key), 'utf8');
    assertNoUnsupportedExports(source, key);
    sources.set(key, source);

    const localDeps = [];
    for (const match of source.matchAll(IMPORT_RE)) {
      const [, clause, , specifier] = match;
      assertNoUnsupportedImports(clause, specifier, key);
      if (specifier.startsWith('node:')) {
        recordBuiltin(clause, specifier, key);
      } else if (specifier.startsWith('./') || specifier.startsWith('../')) {
        localDeps.push(resolveLocalSpecifier(projectRoot, key, specifier));
      } else {
        throw new Error(`${key}: unsupported bare-package import "${specifier}"; this project has zero npm dependencies.`);
      }
    }

    for (const dep of localDeps) {
      await visit(dep);
    }

    visiting.delete(key);
    visited.add(key);
    order.push(key);
  }

  await visit(entryKey);
  return { order, sources, builtins };
}

/** Strip import/export syntax from one module body and append its exports object assignments. */
function transformModuleBody(projectRoot, key, source) {
  const exportedNames = [];
  for (const match of source.matchAll(EXPORT_DECL_RE)) {
    exportedNames.push(match[2]);
  }

  let body = source
    .replace(IMPORT_RE, (whole, clause, quote, specifier) => {
      if (specifier.startsWith('node:')) return ''; // hoisted to the top of the bundle instead
      const depKey = resolveLocalSpecifier(projectRoot, key, specifier);
      return `const ${clause} = __require(${JSON.stringify(depKey)});`;
    })
    .replace(/^export\s+(?=(async\s+function\*?|function\*?|class|const|let|var)\b)/gm, '')
    .replace(/import\.meta\.url/g, 'require("node:url").pathToFileURL(__filename).href');

  const exportLines = exportedNames.map((name) => `  exports[${JSON.stringify(name)}] = ${name};`);

  return [
    `__define(${JSON.stringify(key)}, function (exports, __require) {`,
    body.trim(),
    '',
    ...exportLines,
    '});'
  ].join('\n');
}

function renderBuiltinImports(builtins) {
  const lines = [];
  for (const [specifier, { defaultName, named }] of builtins) {
    if (defaultName) lines.push(`const ${defaultName} = require(${JSON.stringify(specifier)});`);
    if (named.size) lines.push(`const { ${[...named].join(', ')} } = require(${JSON.stringify(specifier)});`);
  }
  return lines.sort().join('\n');
}

const RUNTIME = `
// Minimal CommonJS-style module registry. Each bundled file's private
// top-level names live inside its own factory function, so files that
// happen to declare the same private helper name (e.g. two files each with
// their own local "bool()") do not collide the way flattening everything
// into one shared scope would.
const __modules = new Map();
function __define(key, factory) {
  __modules.set(key, { factory, exports: null });
}
function __require(key) {
  const mod = __modules.get(key);
  if (!mod) throw new Error('bundled module not found: ' + key);
  if (!mod.exports) {
    mod.exports = {};
    mod.factory(mod.exports, __require);
  }
  return mod.exports;
}
`.trim();

export async function buildBundle({ entryKey = ENTRY_KEY, projectRoot = defaultProjectRoot } = {}) {
  const { order, sources, builtins } = await collectGraph(projectRoot, entryKey);
  const modules = order.map((key) => transformModuleBody(projectRoot, key, sources.get(key)));
  const header = [
    '// Generated by scripts/build-sea-bundle.mjs — do not edit by hand.',
    '// This is the SEA build\'s "main" script: everything server.mjs imports,',
    '// flattened into one file because an injected SEA main script cannot read',
    '// the filesystem it was built from.',
    renderBuiltinImports(builtins),
    '',
    RUNTIME
  ].join('\n');

  return [
    header,
    '',
    ...modules,
    '',
    `__require(${JSON.stringify(entryKey)});`,
    ''
  ].join('\n');
}

async function main() {
  const outArg = process.argv.find((arg) => arg.startsWith('--out='));
  const outPath = outArg ? outArg.slice('--out='.length) : path.join(defaultProjectRoot, 'dist', 'bundle.cjs');
  const bundle = await buildBundle();
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, bundle);
  console.log(`Wrote SEA bundle: ${path.relative(defaultProjectRoot, outPath)} (${bundle.length} bytes)`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
