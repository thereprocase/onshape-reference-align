// The one list of every HTTP route this server answers, and of what each route
// requires before it runs.
//
// Why it exists: the CSRF gate in server.mjs used to be a hand-maintained
// array of pathnames sitting next to the dispatch chain. That construction is
// fail-open — a new non-GET route that nobody remembers to append to the array
// gets no CSRF check, and every test stays green. The gate now derives its
// pathnames from CSRF_PATHS below, and test/routes.test.mjs statically scans
// the dispatch chains for pathname comparisons, so a route that is missing
// from this table fails the test suite before it can ship without a gate.
//
// What the columns mean:
//   method            the HTTP method this entry dispatches on.
//   path              the exact pathname, as compared in the dispatch chain.
//   csrf              requireCsrf() must pass. Read by server.mjs through
//                     CSRF_PATHS; every non-GET route needs it.
//   guard             'loopback' when setupGuardFailure() refuses the request
//                     from anywhere but this machine, otherwise null.
//   capability        the src/capabilities.mjs FEATURES key the route passes
//                     to requireFeature(), or null when it makes no Onshape
//                     write and so needs no capability.
//   confirm           'policy' when requireConfirmation() asks while the
//                     operator's confirmBeforeWrite setting is on, 'always'
//                     when requireExplicitConfirmation() asks whatever that
//                     setting says, and null when the route takes no write
//                     confirmation.
//   workspaceContext  requireWorkspaceContext() must pass: a complete context
//                     pointing at a workspace, not a read-only version link.
//   bodyCap           the byte cap the route reads its body under, or
//                     'multipart' where the cap is the configured image size
//                     plus multipart overhead rather than a fixed number, or
//                     null where the route reads no body.
//   rateLimit         the takeRateLimitToken() bucket and its window, read by
//                     routeRateLimitError() in src/session.mjs, or null where
//                     the route takes no token.
//   rateLimitReason   why a route with no bucket needs none, in one sentence,
//                     or null on a route that has one. Exactly one of these
//                     two columns is set on every entry: "no throttle" is a
//                     decision somebody made, and this is where it is written
//                     down instead of being the absence of a line of code.
//
// `csrf` and `rateLimit` are read by running code. The other columns record
// what the routes already do, in one place instead of in prose spread across
// four module headers; keeping them true to the code is test/routes.test.mjs's
// job until the gates themselves read this table.
//
// This file is imported into the SEA bundle, so it uses `export const`
// declarations and named relative imports only — scripts/build-sea-bundle.mjs
// refuses anything else.

import { MAX_JSON_BYTES } from './http.mjs';

// One window length for every bucket. Shorter would let a burst through faster
// than a person could notice it; longer would strand an operator who made an
// honest mistake.
const WINDOW_MS = 60_000;

export const ROUTES = Object.freeze([
  Object.freeze({
    method: 'GET',
    path: '/api/health',
    csrf: false,
    guard: null,
    capability: null,
    confirm: null,
    workspaceContext: false,
    bodyCap: null,
    rateLimit: null,
    rateLimitReason: 'Answered from boot state: no Onshape call, no disk write, nothing to exhaust.'
  }),
  Object.freeze({
    method: 'GET',
    path: '/api/update',
    csrf: false,
    guard: null,
    capability: null,
    confirm: null,
    workspaceContext: false,
    bodyCap: null,
    rateLimit: null,
    rateLimitReason: 'One outbound fetch per process, cached for its lifetime however often this is asked.'
  }),
  Object.freeze({
    method: 'GET',
    path: '/api/bootstrap',
    csrf: false,
    guard: null,
    capability: null,
    confirm: null,
    workspaceContext: false,
    bodyCap: null,
    rateLimit: null,
    rateLimitReason: 'Built from state already in memory; peekAuthSummary never probes.'
  }),
  Object.freeze({
    method: 'GET',
    path: '/api/connection',
    csrf: false,
    guard: null,
    capability: null,
    confirm: null,
    workspaceContext: false,
    bodyCap: null,
    rateLimit: null,
    rateLimitReason: 'The probe is cached, and force=1 is held back server-wide by FORCE_MIN_INTERVAL_MS in src/connection-probe.mjs. A per-session bucket would not bind here anyway: this route is reachable without a cookie, so a caller that drops one gets a fresh bucket every time.'
  }),
  Object.freeze({
    method: 'GET',
    path: '/api/context',
    csrf: false,
    guard: null,
    capability: null,
    confirm: null,
    workspaceContext: false,
    bodyCap: null,
    rateLimit: null,
    rateLimitReason: 'Two Onshape reads per request, asked when the operator refreshes the image list; Onshape’s own 429 is the backstop.'
  }),
  Object.freeze({
    method: 'GET',
    path: '/api/image',
    csrf: false,
    guard: null,
    capability: null,
    confirm: null,
    workspaceContext: false,
    bodyCap: null,
    rateLimit: null,
    rateLimitReason: 'One blob download per image the page shows; a bucket here would break a document with many reference images.'
  }),
  // Pure calculation: it reads a feature to fill in the current placement but
  // writes nothing, so it carries no capability, confirmation, or workspace
  // requirement. It still needs CSRF, being a POST that spends the operator's
  // Onshape credential on a read.
  Object.freeze({
    method: 'POST',
    path: '/api/preview',
    csrf: true,
    guard: null,
    capability: null,
    confirm: null,
    workspaceContext: false,
    bodyCap: MAX_JSON_BYTES,
    // The generous end of the table: this is one button press, and somebody
    // pressing it once a second for a solid minute is working, not attacking.
    rateLimit: Object.freeze({ bucket: 'preview', capacity: 60, refillMs: WINDOW_MS }),
    rateLimitReason: null
  }),
  Object.freeze({
    method: 'POST',
    path: '/api/apply',
    csrf: true,
    guard: null,
    capability: 'updateFeature',
    confirm: 'policy',
    workspaceContext: true,
    bodyCap: MAX_JSON_BYTES,
    // Each one writes a backup file and updates a feature. Twenty a minute is
    // more than a calibration session has ever needed.
    rateLimit: Object.freeze({ bucket: 'apply', capacity: 20, refillMs: WINDOW_MS }),
    rateLimitReason: null
  }),
  Object.freeze({
    method: 'POST',
    path: '/auth/logout',
    csrf: true,
    guard: null,
    capability: null,
    confirm: null,
    workspaceContext: false,
    bodyCap: null,
    rateLimit: null,
    rateLimitReason: 'Clears this session’s own tokens: no Onshape call, no disk write, and the only thing it can exhaust is itself.'
  }),
  Object.freeze({
    method: 'GET',
    path: '/auth/start',
    csrf: false,
    guard: null,
    capability: null,
    confirm: null,
    workspaceContext: false,
    bodyCap: null,
    rateLimit: null,
    rateLimitReason: 'A redirect into Onshape’s own authorization page, which does its own throttling.'
  }),
  Object.freeze({
    method: 'GET',
    path: '/oauth/callback',
    csrf: false,
    guard: null,
    capability: null,
    confirm: null,
    workspaceContext: false,
    bodyCap: null,
    rateLimit: null,
    rateLimitReason: 'A replayed or forged callback is refused by the state check before the token exchange, so a flood costs one comparison each.'
  }),
  Object.freeze({
    method: 'GET',
    path: '/api/setup',
    csrf: false,
    guard: 'loopback',
    capability: null,
    confirm: null,
    workspaceContext: false,
    bodyCap: null,
    rateLimit: null,
    rateLimitReason: 'Reports config paths from behind the loopback guard; no probe, no write.'
  }),
  Object.freeze({
    method: 'POST',
    path: '/api/setup/test',
    csrf: true,
    guard: 'loopback',
    capability: null,
    confirm: null,
    workspaceContext: false,
    bodyCap: 4096,
    rateLimit: Object.freeze({ bucket: 'setup-probe', capacity: 5, refillMs: WINDOW_MS }),
    rateLimitReason: null
  }),
  // `confirm` is null because this route takes no *write* confirmation. The
  // confirm: true it asks for when credentials already exist is about
  // replacing those credentials, not about writing to someone's Onshape
  // document, and it is enforced in the route rather than by the shared
  // requireConfirmation() gate.
  //
  // This bucket is shared with /api/setup/test, and both routes take it inside
  // src/setup-routes.mjs rather than through routeRateLimitError(). What the
  // bucket is protecting there is the one live credential probe each request
  // may make, so the token is taken immediately before that probe: a malformed
  // key or an unconfirmed overwrite is refused without spending one.
  Object.freeze({
    method: 'POST',
    path: '/api/setup/save',
    csrf: true,
    guard: 'loopback',
    capability: null,
    confirm: null,
    workspaceContext: false,
    bodyCap: 4096,
    rateLimit: Object.freeze({ bucket: 'setup-probe', capacity: 5, refillMs: WINDOW_MS }),
    rateLimitReason: null
  }),
  Object.freeze({
    method: 'GET',
    path: '/api/settings',
    csrf: false,
    guard: 'loopback',
    capability: null,
    confirm: null,
    workspaceContext: false,
    bodyCap: null,
    rateLimit: null,
    rateLimitReason: 'Reads one small file from behind the loopback guard; no Onshape call.'
  }),
  Object.freeze({
    method: 'POST',
    path: '/api/settings',
    csrf: true,
    guard: 'loopback',
    capability: null,
    confirm: null,
    workspaceContext: false,
    bodyCap: 4096,
    rateLimit: null,
    rateLimitReason: 'Loopback-guarded and same-origin only, and it makes no Onshape call; the write is one small file bounded by the 4096-byte body cap.'
  }),
  Object.freeze({
    method: 'GET',
    path: '/api/install/status',
    csrf: false,
    guard: null,
    capability: null,
    confirm: null,
    workspaceContext: false,
    bodyCap: null,
    rateLimit: null,
    rateLimitReason: 'Bounded per request rather than per session: MAX_FEATURE_STUDIO_READS in src/write-routes.mjs caps how many Onshape calls one status request can become.'
  }),
  Object.freeze({
    method: 'POST',
    path: '/api/install',
    csrf: true,
    guard: null,
    capability: 'installFeature',
    confirm: 'policy',
    workspaceContext: true,
    bodyCap: 8192,
    // Creates a Feature Studio, sets its contents, and adds a feature. The
    // route is idempotent, so a second press is cheap, but ten a minute is
    // already well past deliberate use.
    rateLimit: Object.freeze({ bucket: 'install', capacity: 10, refillMs: WINDOW_MS }),
    rateLimitReason: null
  }),
  Object.freeze({
    method: 'POST',
    path: '/api/upload-image',
    csrf: true,
    guard: null,
    capability: 'uploadImage',
    confirm: 'policy',
    workspaceContext: true,
    bodyCap: 'multipart',
    // The tight end of the table, and the reason this column exists at all.
    // One request holds roughly three to four times the image in memory at
    // once (the module header in src/write-routes.mjs says why it has to),
    // so at the default 25 MB cap this bucket is what stands between one
    // session and a couple of hundred megabytes a minute.
    rateLimit: Object.freeze({ bucket: 'upload-image', capacity: 8, refillMs: WINDOW_MS }),
    rateLimitReason: null
  }),
  Object.freeze({
    method: 'POST',
    path: '/api/rebind',
    csrf: true,
    guard: null,
    capability: 'rebindImage',
    confirm: 'policy',
    workspaceContext: true,
    bodyCap: 8192,
    rateLimit: Object.freeze({ bucket: 'rebind', capacity: 10, refillMs: WINDOW_MS }),
    rateLimitReason: null
  }),
  Object.freeze({
    method: 'POST',
    path: '/api/replane',
    csrf: true,
    guard: null,
    capability: 'installFeature',
    confirm: 'policy',
    workspaceContext: true,
    bodyCap: 8192,
    rateLimit: Object.freeze({ bucket: 'replane', capacity: 10, refillMs: WINDOW_MS }),
    rateLimitReason: null
  }),
  Object.freeze({
    method: 'POST',
    path: '/api/suppress',
    csrf: true,
    guard: null,
    capability: 'suppressFeature',
    confirm: 'always',
    workspaceContext: true,
    bodyCap: 8192,
    rateLimit: Object.freeze({ bucket: 'suppress', capacity: 10, refillMs: WINDOW_MS }),
    rateLimitReason: null
  })
]);

// The pathnames server.mjs checks a CSRF token on. Derived, so registering a
// non-GET route is enough to protect it and no second list can disagree with
// this one.
export const CSRF_PATHS = Object.freeze(
  ROUTES.filter((route) => route.method !== 'GET' && route.csrf).map((route) => route.path)
);
