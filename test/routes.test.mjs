import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ROUTES, CSRF_PATHS } from '../src/routes.mjs';
import { FEATURE_KEYS } from '../src/capabilities.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Every file that dispatches on a pathname. A new sub-router belongs in this
// list; until it is here, its routes are invisible to the scan below and the
// coverage assertion ("every registered route is dispatched somewhere") is the
// only thing that would notice.
const DISPATCH_FILES = [
  'server.mjs',
  'src/auth-routes.mjs',
  'src/settings-routes.mjs',
  'src/setup-routes.mjs',
  'src/write-routes.mjs'
];

// Text scans rather than a parse: this project has no npm dependencies, so
// there is no parser to reach for, and the four dispatch chains are written in
// one shape — `req.method === 'X' && url.pathname === '/y'`, or a pathname
// comparison on its own with the method checked separately.
const EXACT_RE = /url\.pathname\s*(?:===|!==)\s*'([^']+)'/g;
const PREFIX_RE = /url\.pathname\.startsWith\('([^']+)'\)/g;
const METHOD_FIRST_RE = /req\.method\s*===\s*'([A-Z]+)'\s*&&\s*url\.pathname\s*===\s*'([^']+)'/g;
const PATH_FIRST_RE = /url\.pathname\s*===\s*'([^']+)'\s*&&\s*req\.method\s*===\s*'([A-Z]+)'/g;

const COLUMNS = [
  'method',
  'path',
  'csrf',
  'guard',
  'capability',
  'confirm',
  'workspaceContext',
  'bodyCap',
  'rateLimit',
  'rateLimitReason'
];

async function readDispatchSources() {
  const sources = new Map();
  for (const file of DISPATCH_FILES) {
    sources.set(file, await fsp.readFile(path.join(root, file), 'utf8'));
  }
  return sources;
}

/** Every pathname literal the dispatch chains compare against, with its file. */
function scanExactPaths(sources) {
  const found = new Map(); // pathname -> Set of files
  for (const [file, source] of sources) {
    for (const match of source.matchAll(EXACT_RE)) {
      if (!found.has(match[1])) found.set(match[1], new Set());
      found.get(match[1]).add(file);
    }
  }
  return found;
}

/** Every method/pathname pair the dispatch chains test in one expression. */
function scanMethodPairs(sources) {
  const pairs = [];
  for (const [file, source] of sources) {
    for (const match of source.matchAll(METHOD_FIRST_RE)) {
      pairs.push({ file, method: match[1], path: match[2] });
    }
    for (const match of source.matchAll(PATH_FIRST_RE)) {
      pairs.push({ file, method: match[2], path: match[1] });
    }
  }
  return pairs;
}

function scanPrefixes(sources) {
  const prefixes = [];
  for (const [file, source] of sources) {
    for (const match of source.matchAll(PREFIX_RE)) {
      prefixes.push({ file, prefix: match[1] });
    }
  }
  return prefixes;
}

function findRoute(method, pathname) {
  return ROUTES.find((route) => route.method === method && route.path === pathname);
}

test('the scan finds the dispatch chains it is meant to find', async () => {
  // A regex that silently matches nothing would make every assertion below
  // vacuously true, which is the failure mode that matters most in a test
  // whose whole job is to notice something missing.
  const sources = await readDispatchSources();
  const pairs = scanMethodPairs(sources);
  const exact = scanExactPaths(sources);
  for (const file of DISPATCH_FILES) {
    const fromFile = [...exact.values()].filter((files) => files.has(file));
    assert.ok(fromFile.length > 0, `${file}: the pathname scan found no routes at all`);
  }
  assert.ok(pairs.length >= 19, `expected the method/pathname scan to find the whole dispatch chain, found ${pairs.length}`);
  assert.ok(pairs.some((pair) => pair.method === 'POST' && pair.path === '/api/suppress'));
});

test('every non-GET route the server dispatches is registered with CSRF required', async () => {
  const sources = await readDispatchSources();
  for (const pair of scanMethodPairs(sources)) {
    if (pair.method === 'GET' || pair.method === 'HEAD') continue;
    const route = findRoute(pair.method, pair.path);
    assert.ok(
      route,
      `${pair.file} dispatches ${pair.method} ${pair.path}, which is not in ROUTES. ` +
      'Add it to src/routes.mjs; server.mjs derives its CSRF list from that table.'
    );
    assert.equal(route.csrf, true, `${pair.method} ${pair.path} is registered without CSRF`);
  }
});

test('every method/pathname pair in the dispatch chains is registered', async () => {
  const sources = await readDispatchSources();
  for (const pair of scanMethodPairs(sources)) {
    assert.ok(
      findRoute(pair.method, pair.path),
      `${pair.file} dispatches ${pair.method} ${pair.path}, which is not in ROUTES`
    );
  }
});

test('every pathname the dispatch chains compare against belongs to a registered route', async () => {
  // Catches the routes whose method is checked in a separate statement — both
  // /api/settings entries are dispatched that way, so the pair scan above
  // cannot see them.
  const sources = await readDispatchSources();
  for (const [pathname, files] of scanExactPaths(sources)) {
    assert.ok(
      ROUTES.some((route) => route.path === pathname),
      `${[...files].join(', ')} dispatches on ${pathname}, which is not in ROUTES`
    );
  }
});

test('every pathname prefix the server routes on covers at least one registered route', async () => {
  const sources = await readDispatchSources();
  for (const { file, prefix } of scanPrefixes(sources)) {
    assert.ok(
      ROUTES.some((route) => route.path.startsWith(prefix)),
      `${file} routes on the prefix ${prefix}, which no registered route lives under`
    );
  }
});

test('every registered route is dispatched somewhere', async () => {
  const sources = await readDispatchSources();
  const exact = scanExactPaths(sources);
  for (const route of ROUTES) {
    assert.ok(
      exact.has(route.path),
      `${route.method} ${route.path} is registered but no dispatch chain compares against it`
    );
  }
});

test('every non-GET route requires CSRF, and no GET route does', () => {
  for (const route of ROUTES) {
    if (route.method === 'GET') {
      assert.equal(route.csrf, false, `${route.method} ${route.path}: a GET route is not CSRF-gated`);
    } else {
      assert.equal(route.csrf, true, `${route.method} ${route.path}: every non-GET route needs CSRF`);
    }
  }
});

test('every route names every column explicitly', () => {
  // The point of the exact key-set comparison: adding a column to the table
  // fails here for every route that has not been given a value for it, rather
  // than leaving the new column silently undefined on the older entries.
  for (const route of ROUTES) {
    assert.deepEqual(
      Object.keys(route).slice().sort(),
      COLUMNS.slice().sort(),
      `${route.method} ${route.path}: the entry's columns do not match the table's columns`
    );
    for (const column of COLUMNS) {
      assert.notEqual(route[column], undefined, `${route.method} ${route.path}: ${column} is undefined`);
    }
  }
});

test('every column holds one of the values it is allowed to hold', () => {
  for (const route of ROUTES) {
    const where = `${route.method} ${route.path}`;
    assert.ok(['GET', 'POST'].includes(route.method), `${where}: unexpected method`);
    assert.ok(route.path.startsWith('/'), `${where}: path must be absolute`);
    assert.equal(typeof route.csrf, 'boolean', `${where}: csrf must be a boolean`);
    assert.ok(route.guard === null || route.guard === 'loopback', `${where}: unexpected guard`);
    assert.ok(
      route.capability === null || FEATURE_KEYS.includes(route.capability),
      `${where}: capability must be null or a src/capabilities.mjs FEATURES key`
    );
    assert.ok(
      route.confirm === null || route.confirm === 'policy' || route.confirm === 'always',
      `${where}: unexpected confirm mode`
    );
    assert.equal(typeof route.workspaceContext, 'boolean', `${where}: workspaceContext must be a boolean`);
    assert.ok(
      route.bodyCap === null || route.bodyCap === 'multipart' || (Number.isInteger(route.bodyCap) && route.bodyCap > 0),
      `${where}: bodyCap must be null, 'multipart', or a positive byte count`
    );
    if (route.rateLimit !== null) {
      assert.equal(typeof route.rateLimit.bucket, 'string', `${where}: rateLimit needs a bucket name`);
      assert.ok(Number.isInteger(route.rateLimit.capacity) && route.rateLimit.capacity > 0, `${where}: rateLimit needs a capacity`);
      assert.ok(Number.isInteger(route.rateLimit.refillMs) && route.rateLimit.refillMs > 0, `${where}: rateLimit needs a window`);
    }
  }
});

test('every route has either a rate-limit bucket or a written reason for having none', () => {
  // The pairing, not the contents: a new route cannot be added with both
  // columns null, which is the shape "nobody thought about it" takes. What the
  // buckets actually do when spent is proven against the running server in
  // test/route-gates.test.mjs.
  for (const route of ROUTES) {
    const where = `${route.method} ${route.path}`;
    const hasBucket = route.rateLimit !== null;
    const hasReason = route.rateLimitReason !== null;
    assert.ok(
      hasBucket !== hasReason,
      hasBucket
        ? `${where}: a route with a bucket must leave rateLimitReason null`
        : `${where}: no rateLimit and no rateLimitReason. Give it a bucket, or write one sentence saying why it needs none.`
    );
    if (hasReason) {
      assert.equal(typeof route.rateLimitReason, 'string', `${where}: rateLimitReason must be a string`);
      assert.ok(route.rateLimitReason.trim().length >= 20, `${where}: rateLimitReason must actually say something`);
    }
  }
});

test('a route that writes to a document declares a capability and a workspace context', () => {
  // Reading the table the other way round: every entry that names a capability
  // is a write, and every write goes to one document in one workspace.
  for (const route of ROUTES) {
    if (route.capability === null) continue;
    assert.equal(route.workspaceContext, true, `${route.method} ${route.path}: a write must require a workspace context`);
    assert.equal(route.csrf, true, `${route.method} ${route.path}: a write must require CSRF`);
    assert.ok(route.confirm !== null, `${route.method} ${route.path}: a write must declare a confirmation mode`);
  }
});

test('no two entries claim the same method and path', () => {
  const seen = new Set();
  for (const route of ROUTES) {
    const key = `${route.method} ${route.path}`;
    assert.ok(!seen.has(key), `${key} is registered twice`);
    seen.add(key);
  }
});

test('the table and its entries are frozen', () => {
  assert.ok(Object.isFrozen(ROUTES));
  assert.ok(Object.isFrozen(CSRF_PATHS));
  for (const route of ROUTES) {
    assert.ok(Object.isFrozen(route), `${route.method} ${route.path} is not frozen`);
    if (route.rateLimit) assert.ok(Object.isFrozen(route.rateLimit), `${route.method} ${route.path}: rateLimit is not frozen`);
  }
});

test('CSRF_PATHS is exactly the registered non-GET paths', () => {
  const expected = ROUTES.filter((route) => route.method !== 'GET' && route.csrf).map((route) => route.path);
  assert.deepEqual([...CSRF_PATHS], expected);
  assert.deepEqual([...CSRF_PATHS].slice().sort(), [
    '/api/apply',
    '/api/install',
    '/api/preview',
    '/api/rebind',
    '/api/replane',
    '/api/settings',
    '/api/setup/save',
    '/api/setup/test',
    '/api/suppress',
    '/api/upload-image',
    '/auth/logout'
  ]);
});

test('server.mjs reads the registry instead of carrying its own list of pathnames', async () => {
  const source = await fsp.readFile(path.join(root, 'server.mjs'), 'utf8');
  assert.match(source, /CSRF_PATHS\.includes\(url\.pathname\)/);
});

test('server.mjs dispatches on no method but GET', async () => {
  // The invariant, stated as bluntly as it can be: no route body with a
  // request behind it lives in the dispatcher.
  //
  // Why it is worth a test. POST /api/apply was written in server.mjs's chain
  // because that is where the chain was, and over time it grew its own copy of
  // the 403-evidence rule and its own requireFeature() call — so the rule that
  // decides what this server believes about a key's permissions had two
  // implementations, and only one of them was next to the other four writes.
  // Nothing failed when they drifted, because nothing was comparing them. A
  // sixth write added to the chain would do it again, and this is what stops
  // it: put the body in a routes module, or this fails.
  //
  // `req.method !== 'GET' && req.method !== 'HEAD'` — the CSRF gate and the
  // method check — is deliberately still allowed. Those are policy over every
  // route, not a route.
  const source = await fsp.readFile(path.join(root, 'server.mjs'), 'utf8');
  const dispatched = [...source.matchAll(/req\.method\s*===\s*'([A-Z]+)'/g)].map((match) => match[1]);
  assert.ok(dispatched.length > 0, 'the scan found no method comparisons in server.mjs at all');
  for (const method of dispatched) {
    assert.equal(
      method,
      'GET',
      `server.mjs dispatches on ${method}. Non-GET route bodies belong in a routes module ` +
      '(src/write-routes.mjs, src/auth-routes.mjs, src/settings-routes.mjs, src/setup-routes.mjs), ' +
      'where their gates sit beside the gates of every other route like them.'
    );
  }
});

test('every registered non-GET route has its body in a routes module, not in server.mjs', async () => {
  // The same invariant read from the registry rather than from the text, so a
  // route dispatched in some shape this file's regexes do not recognise still
  // has to be answered from somewhere other than the dispatcher.
  const sources = await readDispatchSources();
  const exact = scanExactPaths(sources);
  const nonGet = ROUTES.filter((route) => route.method !== 'GET');
  assert.ok(nonGet.length >= 10, `expected the registry to declare non-GET routes, found ${nonGet.length}`);
  for (const route of nonGet) {
    const files = [...(exact.get(route.path) || [])].filter((file) => file !== 'server.mjs');
    assert.ok(
      files.length > 0,
      `${route.method} ${route.path} is dispatched only from server.mjs. Move its body into a routes module.`
    );
  }
});

/**
 * The endpoint table in docs/ARCHITECTURE.md's "Endpoint table" section,
 * parsed the same naive way the rest of this file scans source: a markdown
 * pipe table, header and separator rows dropped, cells trimmed. The doc
 * writes `null`/`true`/`false` as literal tokens for exactly this reason —
 * so a row can be compared against the registry without a second vocabulary
 * to translate between.
 */
async function readArchitectureEndpointTable() {
  const source = await fsp.readFile(path.join(root, 'docs', 'ARCHITECTURE.md'), 'utf8');
  const heading = '### Endpoint table';
  const start = source.indexOf(heading);
  assert.ok(start >= 0, 'docs/ARCHITECTURE.md has no "### Endpoint table" section');
  const nextHeading = source.indexOf('\n## ', start);
  const section = nextHeading >= 0 ? source.slice(start, nextHeading) : source.slice(start);

  const rows = [];
  for (const line of section.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) continue;
    const cells = trimmed.slice(1, -1).split('|').map((cell) => cell.trim());
    if (cells.every((cell) => /^-+$/.test(cell))) continue; // the header separator row
    if (cells[0] === 'Method') continue; // the header row itself
    rows.push({
      method: cells[0],
      path: cells[1].replace(/`/g, ''),
      csrf: cells[2],
      guard: cells[3],
      capability: cells[4],
      confirm: cells[5],
      workspaceContext: cells[6],
      bodyCap: cells[7],
      rateLimit: cells[8]
    });
  }
  assert.ok(rows.length > 0, 'the endpoint table scan found no data rows at all');
  return rows;
}

function tableToken(value) {
  return value === null ? 'null' : String(value);
}

test('docs/ARCHITECTURE.md\'s endpoint table matches the registry row for row', async () => {
  const rows = await readArchitectureEndpointTable();

  // Every table row names a route that actually exists, with the same
  // capability and confirm columns the registry declares for it. A row for a
  // path the registry does not have is exactly the drift this test exists to
  // catch -- the doc naming a route that was renamed or removed out from
  // under it.
  for (const row of rows) {
    const route = findRoute(row.method, row.path);
    assert.ok(
      route,
      `docs/ARCHITECTURE.md's endpoint table lists ${row.method} ${row.path}, which is not in src/routes.mjs`
    );
    assert.equal(
      row.capability,
      tableToken(route.capability),
      `docs/ARCHITECTURE.md's endpoint table: ${row.method} ${row.path} capability column says ` +
      `${row.capability}, src/routes.mjs says ${tableToken(route.capability)}`
    );
    assert.equal(
      row.confirm,
      tableToken(route.confirm),
      `docs/ARCHITECTURE.md's endpoint table: ${row.method} ${row.path} confirm column says ` +
      `${row.confirm}, src/routes.mjs says ${tableToken(route.confirm)}`
    );
  }

  // Every registered route has a row. Without this direction, deleting a row
  // for a route that still exists -- or forgetting one for a route just
  // added -- would pass the check above silently.
  for (const route of ROUTES) {
    const row = rows.find((candidate) => candidate.method === route.method && candidate.path === route.path);
    assert.ok(
      row,
      `${route.method} ${route.path} is registered in src/routes.mjs but has no row in ` +
      'docs/ARCHITECTURE.md\'s endpoint table'
    );
  }

  assert.equal(rows.length, ROUTES.length, 'the endpoint table has a different number of rows than ROUTES');
});

test('nothing else carries a second copy of the CSRF pathname list', async () => {
  // The private copies this table replaced lived in three test harnesses, two
  // of them already missing five of the routes they claimed to model. A copy
  // is worse than no test: it passes while the real gate is wrong. A file
  // naming one or two pathnames is just calling them; an array literal listing
  // three or more is a second whitelist.
  const arrayLiteral = /\[[^[\]]*\]/gs;
  const files = ['server.mjs'];
  for (const directory of ['src', 'test', 'scripts']) {
    for (const name of await fsp.readdir(path.join(root, directory))) {
      if (name.endsWith('.mjs')) files.push(`${directory}/${name}`);
    }
  }
  for (const file of files) {
    if (file === 'test/routes.test.mjs' || file === 'src/routes.mjs') continue;
    const source = await fsp.readFile(path.join(root, file), 'utf8');
    for (const match of source.matchAll(arrayLiteral)) {
      const listed = CSRF_PATHS.filter((pathname) => match[0].includes(`'${pathname}'`) || match[0].includes(`"${pathname}"`));
      assert.ok(
        listed.length < 3,
        `${file} contains an array listing ${listed.length} CSRF-gated pathnames; import CSRF_PATHS from src/routes.mjs instead`
      );
    }
  }
});
