# Architecture and calibration math

## Why this is a right-panel app plus FeatureScript

A FeatureScript can create and parameterize an image, but it cannot receive arbitrary mouse clicks on pixels in the main Onshape graphics canvas. A right-panel web app can render the raster and capture precise browser pixel coordinates, while the Onshape REST feature API can update the custom feature's numeric placement parameters.

The supported data flow is:

```text
Onshape image / local image
        ↓
right-panel canvas pixel picker
        ↓
scale + rotation + anchor solver
        ↓
preview and recipe JSON
        ↓
Onshape REST feature update
        ↓
Calibrated Reference Image FeatureScript regenerates
```

## Coordinate systems

### Browser raster

- Origin: upper-left.
- +X: right.
- +Y: down.
- Coordinates retain floating-point precision; picks are not rounded to whole pixels.

### Normalized image

```text
u = pixelX / pixelWidth
v = 1 - pixelY / pixelHeight
```

`(u,v)=(0,0)` is the lower-left image corner.

### Image-local physical coordinates

For physical image width `W` and aspect ratio `A = pixelWidth/pixelHeight`:

```text
x_local = W·u
y_local = (W/A)·v
```

### Selected Onshape plane

The custom feature uses the selected planar entity's canonical sketch coordinate system. Placement is:

```text
p_sketch = origin + R(angle)·p_local
```

## Solving scale

Given pixel pair `S1,S2`, calculate its physical vector for a hypothetical image width of one unit. Its length is therefore the fraction of full image width represented by the pair, accounting for raster aspect ratio.

```text
q = local(S2,W=1) - local(S1,W=1)
W_new = knownDistance / |q|
```

This remains correct for horizontal, vertical, and diagonal reference pairs.

## Solving rotation

Let `α` be the orientation pair's image-local angle and `β` the desired sketch angle:

```text
angle_new = β - α
```

Target modes:

- `keep`: preserve the orientation pair's current sketch angle.
- `horizontal`: `β = 0`.
- `vertical`: `β = π/2`.
- `nearest-axis`: round the pair's current sketch angle to the nearest multiple of `π/2`.
- `custom`: use the entered arbitrary angle from sketch +X.

The scale pair can double as the orientation pair, or the user can supply a distinct pair.

## Preserving an anchor pixel

The app first computes the chosen pixel's current sketch-space location `P`. After solving width and angle, it computes that pixel's new rotated local offset `d`. The required lower-left origin is:

```text
origin_new = P - d
```

The diagnostics report the residual distance between the anchor before and after calibration. Unit tests expect this to remain within floating-point noise.

## Configuration

Configuration lives in one env file. Four modules own it:

- `src/config-paths.mjs` — where that file is, and where backups go.
- `src/env-file.mjs` — reading and writing it without destroying it.
- `src/config.mjs` — turning it into a frozen config, and reloading that config.
- `src/http.mjs` — the response helpers, extracted so every route shares one body cap and one error contract.

### Which file is read

First match wins:

1. `--config <path>` on the command line.
2. `ONSHAPE_REFERENCE_ALIGN_CONFIG` in the environment.
3. `<projectRoot>/.env`, only if it exists.
4. `userConfigDir()/.env`, which may not exist yet.

`userConfigDir()` is `%APPDATA%\onshape-reference-align` on Windows, `~/Library/Application Support/onshape-reference-align` on macOS, and `$XDG_CONFIG_HOME/onshape-reference-align` (or `~/.config/...`) elsewhere. The resolved path and its source category are printed once at startup as `Config: <path> (<source>)`.

Rule 3 is what keeps a source checkout behaving exactly as it always has, and rule 4 is what lets a binary started from a directory with no checkout still find its settings.

Backups follow the same decision: an explicit `BACKUP_DIR` always wins, otherwise `userConfigDir()/backups` when the config came from the per-user location, and `projectRoot/backups` in every other case.

### Layering

```text
effective = { ...envFile, ...process.env }
```

A real environment variable beats the file. The env file is re-parsed on every reload and is never written back into `process.env`, which is what allows a reload to observe a changed value or a deleted key at all.

### Boot-pinned versus reloadable

`createConfigStore()` returns a store, not a config. `store.reload()` re-reads the file and swaps in a new frozen config, incrementing `store.generation` only when that succeeds. If the new file is malformed the previous config is retained and the error is rethrown, because the request path parses `onshapeBaseUrl` on every single response and must not be brought down by a typo.

Some fields cannot honestly change in a running process. `HOST` and `PORT` need a listener rebind; `PUBLIC_BASE_URL` and `NODE_ENV` are captured by long-lived closures and by cookies already issued to browsers; `UPDATE_CHECK_URL` is read once into the one-shot, cached update checker, so a later reload has nothing left to hand it. Those are pinned from the boot snapshot, and `reload()` reports any of them that changed in the file as `restartRequired` rather than pretending to apply them.

`src/config.mjs` also exports `ENV_KEYS`, a table naming every env-file key `buildConfig` reads, the parser applied to it, and the field that consumes the parsed value. A structural test in `test/config.test.mjs` scans `buildConfig`'s own source for every `source.X` read and fails if one is missing from this table, or if the table names a key nothing reads anymore — the same test also checks that every `ENV_KEYS` entry whose consumer starts with `boot.` has a matching entry in `BOOT_ONLY_KEYS`, and no others.

Everything Onshape-related — base URL, API version, auth mode, keys, bearer token, OAuth fields, native-image-write flag, backup directory — reloads.

`server.mjs` therefore holds two bindings: `boot` for the pinned fields and `config()` for everything else. A destructured field or a module-scope `const config = store.current()` would silently keep serving the pre-reload value, so reads go through the accessor. `OnshapeApi` is constructed once from that same accessor, which is why the client and the config can never disagree.

### Writing the file

`src/env-file.mjs` replaces a key's value in place and preserves every other line — comments, blank lines, key order — byte for byte, because this file is hand-edited and a machine rewrite that eats an operator's comments is a reason to stop trusting the tool. Writes go to a sibling temp file and are moved into place with a rename, so a crash mid-write cannot leave half a credential behind. Values containing a line break are refused: that is injection, not data.

On POSIX the file is created mode `0600`. On Windows those bits are advisory and the real protection is the ACL on the containing directory; the tool does not claim otherwise.

## Packaging

Two build outputs exist: running from a checkout (`node server.mjs`) and a
packaged Single Executable Application binary. `src/assets.mjs` is the one
module that knows which of the two is running; everything else, including
`server.mjs`'s own static-file routes, goes through it rather than deciding
for itself.

### Which mode this process is in

`isSeaPackaged()` in `src/assets.mjs` answers with `node:sea`'s `isSea()`,
reached through a small injectable stub so tests can flip it without an
actual SEA build. `server.mjs` calls it once, before it creates the config
store, because the answer changes what `projectRoot` even means: a packaged
binary has no real checkout directory on the end user's disk, so
`import.meta.url` inside it does not point at one. When packaged,
`userConfigDir()` stands in for `projectRoot` — the same per-user directory
`src/config-paths.mjs` already falls back to when a from-source run finds no
local `.env` (see "Which file is read" above). The config store, the asset
source, and the backup directory all inherit that one substitution rather
than each rediscovering it.

### Asset source

`createAssetSource({ projectRoot, sea })` gives `server.mjs` one seam for
static files, regardless of mode:

- **Dev mode** reads real files under `projectRoot` with `fs`/`fsp`, exactly
  as the server did before this seam existed.
- **Packaged mode** has no filesystem to read: assets are embedded in the
  binary at build time and fetched back with `node:sea`'s `getRawAsset()`,
  cached per key in a `Buffer` so a request never re-copies the same bytes
  off the `ArrayBuffer` view `getRawAsset()` returns fresh on every call.

`resolveAssetKey(baseKey, relativePathname)` bounds a request-controlled
pathname to a key rooted under `baseKey` (e.g. `public`) in both modes, but by
different mechanisms: dev mode resolves against the real directory and checks
the result still starts with it, the same traversal guard the server always
had; packaged mode has no directory to escape from at all — a request is
bounded by the closed list of asset keys burned into the binary, so a
pathname can never resolve to a key that was not deliberately embedded at
build time.

`getAssetKeys()`/`getRawAsset()` are newer than `isSea()` (Node 22.20.0 or
24.8.0, versus 20.12/21.7) and are only ever reached from the packaged
branch, which by construction only runs inside a binary built with a pinned,
known-recent Node (see `docs/DISTRIBUTION.md`). Reaching them through a lazy
`require('node:sea')` instead of a static import keeps `node server.mjs` from
source working on any Node in the project's `>=22` engines range, including
one older than a packaged build requires.

### Building the bundle

A SEA's injected main script cannot read the filesystem it was built from, so
everything `server.mjs` imports has to be flattened into one file first.
`scripts/build-sea-bundle.mjs` is a hand-rolled bundler rather than a
dependency, viable only because the import graph is small and constrained by
convention: relative specifiers only, no default exports, no namespace
imports, no aliased imports, no multi-binding export declarations, and no
bare-package imports (the project has zero npm dependencies). The bundler
enforces every one of those constraints itself and throws, naming the
offending file, rather than silently mishandling an import shape it does not
support. Each source file becomes its own factory function in a minimal
CommonJS-style module registry, so two files that happen to declare the same
private top-level name cannot collide; only `node:` built-ins are hoisted to
top-level CommonJS `require()` calls, deduplicated across the whole graph.
The output is `dist/bundle.cjs`, compatible with Node 22/24's SEA loader.
`import.meta.url` is replaced with the bundle's file URL (the executable's URL
inside SEA); the packaged runtime resolves configuration from the user config
directory and static content from embedded assets.

`scripts/sea-assets.mjs` generates `sea-config.json` from the actual contents
of `public/` and `featurescript/ReferenceImage.fs`, walking those directories
rather than hand-listing files, so the embedded-asset list cannot drift from
what `src/assets.mjs` actually serves. `--check` compares the generated
config against what is committed and fails the build (and CI) if they
disagree, the same pattern `scripts/gen-version.mjs --check` uses for
`src/version.mjs`.

`scripts/build-sea.mjs` drives the rest: verify the bundle and asset-config
checks are current, rebuild the bundle, generate the blob with Node's own
`--experimental-sea-config`, copy the running `node` binary, and — only
behind an explicit `--allow-postject` flag — inject the blob with `postject`
and re-sign on macOS. Without that flag the script stops at a copied,
uninjected binary, which is enough to prove the whole pipeline up to
injection without ever running a third-party tool by default. See
`docs/DISTRIBUTION.md` for the operator-facing version of this process,
including the Node version pin and the postject integrity check.

### First-run browser open

`src/open-browser.mjs` is what makes a double-clicked binary feel like an
application instead of a server someone has to know to visit.
`shouldOpenBrowser({ argv, isTTY })` decides once, at the bottom of
`server.mjs`'s `listen()` callback, after the real bound port is known: an
explicit `--no-open` always refuses, an explicit `--open` always opens, and
otherwise a real terminal (stdout is a TTY) is treated as an interactive
launch worth opening a window for, while a background or service launch
(stdout redirected to a log file, no TTY) stays silent. `openBrowser(url)`
spawns one platform-specific opener (`cmd /c start` on Windows, `open` on
macOS, `xdg-open` elsewhere), detached and with its `stdio` ignored, and never
throws: a missing opener binary or a headless session just means nothing
happens, since the bound URL is already printed to stdout regardless.

### The one-shot update check

`src/update-check.mjs` is unrelated to packaging mechanically, but exists for
the same audience: a packaged binary has no package manager to report a new
version through. `createUpdateChecker({ url })` fetches `UPDATE_CHECK_URL`
(`boot.updateCheckUrl`, empty by default and boot-only — see above) exactly
once per process lifetime and caches the promise, never polling on an
interval. `src/config.mjs` validates the URL at boot: anything that is not
an absolute `http(s)` URL — a relative path, a bare `javascript:` scheme,
garbage — is rejected with a warning and treated as unset, so this module
only ever sees an empty string or something safe to hand to `fetch()`. A
missing URL, a timeout (3s), a non-200 response, or a malformed body all
resolve to `{ disabled: true }` rather than throwing: this must never be the
reason a calibration tool warns about, or blocks on, being offline. `GET /api/update`
is the only caller; the browser shows a dismissible banner with a manual
download link and never anything that downloads or executes on its own.

## The setup wizard

`#setupCard` in the browser lets an operator paste an Onshape API key pair instead of hand-editing the env file. Three modules own it:

- `src/loopback-guard.mjs` — refuses every `/api/setup*` request that is not a direct, unproxied connection from this machine's own browser: an https `PUBLIC_BASE_URL`, a non-loopback `HOST`, any `X-Forwarded-*`/`Forwarded` header, a non-loopback socket address, or an `Origin`/`Host` that does not name `127.0.0.1`, `localhost`, or `[::1]` on the configured port, all refuse. The response carries only a coarse reason (`NOT_LOOPBACK`, `HOST_NOT_LOOPBACK`, `REMOTE_CLIENT`, `FORWARDED_HEADER`, `HTTPS_PUBLIC_URL`, `ORIGIN_REJECTED`); the fine-grained reason is logged on the server console only.
- `src/connection-probe.mjs` — the truthful connection state. A candidate or live credential is tested with one real `GET /users/sessioninfo` call, cached per config generation with a 60s positive TTL and an exponential 5s-to-60s negative backoff, so a `store.reload()` invalidates every cached verdict for free. `authMode === 'none'` short-circuits before any cache lookup or network call, unconditionally — that is what keeps the test suite and `npm run check` offline. `GET /api/bootstrap` uses a non-probing peek instead, so first paint never waits on a network round trip.
- `src/setup-routes.mjs` — `GET /api/setup`, `POST /api/setup/test`, `POST /api/setup/save`. Save always re-probes independently; it never trusts a client's earlier Test result, and it never writes a key Onshape has definitively rejected (`REJECTED`/`FORBIDDEN`) even if the operator passes `confirmUntested`. Both POST routes share one rate-limit bucket (five probes per 60s per session) taken only immediately before the live network call, so a request rejected earlier by CSRF, body-size, or key-format validation never spends budget it didn't use.

CSRF for the wizard routes is not re-implemented in `src/setup-routes.mjs`: `'/api/setup/test'` and `'/api/setup/save'` are registered routes in `src/routes.mjs`, and `server.mjs` derives its CSRF check from that table, exactly as it does for `/api/preview`, `/api/apply`, and `/auth/logout`.

## Capabilities and policy

Two independent questions stand between a request and an Onshape write: what
the credential is permitted to do, and what the operator has permitted this
server to do. They are answered by different code, from different sources, and
ANDed together in one place.

### What the key can do

`GET /users/sessioninfo` — the call the connection probe already makes —
returns `oauth2Scopes` as an integer bitmask, a `planGroup`, and `roles`.
`src/capabilities.mjs` owns the interpretation:

- `pickSessionInfo(data)` narrows that response by copying fields by name. The
  real response also contains `email`; copying by name rather than by spread is
  what keeps it out of the cache, the logs, and every response body.
- `decodeScopes(mask)` splits the mask into `read`, `write`, `delete`,
  `readPii`, and `share`, and keeps every bit outside that table in
  `unknownBits`. **The bit meanings are an assumption, labelled as one in the
  source.** Only `read` and `write` are corroborated by observed behaviour on
  this project's own key (mask 4099 = 1 + 2 + 4096: reads and writes succeed,
  `DELETE` returns 403). A mask that is not a non-negative safe integer yields
  `known: false`, which is deliberately *not* the same as "every scope is
  missing" — an unknown permission must read as unknown, never as denial.
- `deriveCapabilities({ sessionInfo, evidence, generation, now })` turns that,
  plus the plan, plus observed 403s, into one `{ allowed, reason }` record per
  feature. When the scopes are unknown every feature is allowed, because
  refusing on a guess is worse than letting Onshape answer.

The Free-plan limit is tracked separately from any scope: a Free account gets
a 409, not a 403, when it tries to create a private document (see
`docs/experiments/2026-09-04-bind-experiment/01-create-document-private.json`),
so `plan.canCreatePrivateDocuments` is its own field.

### Evidence

A 403 from Onshape on a write is the only direct evidence this server ever
gets about what the key may do, so every write records one against the
session. It is ambiguous — it means either "this key lacks the scope" or "you
cannot edit that document" — and the reason text says both. Because it is
ambiguous it must not be permanent: an entry expires after fifteen minutes, is
cleared by the next success, is discarded when the config store's generation
changes, and is wiped entirely when the setup wizard saves a new key.

There is one implementation of that rule: `withEvidence()` in
`src/write-routes.mjs`, which every write calls around its Onshape request.
There used to be two. `/api/apply` was dispatched from `server.mjs` and had
grown its own try/catch doing the same thing, so the rule that decides what
this server believes about a key had a copy that nothing compared against the
original. Nothing failed when they drifted, because nothing was looking.

### What the operator allows

`settings.json` lives beside the resolved env file, holds only booleans and one
optional Onshape folder id, and never holds a credential. `src/settings.mjs`
reads it leniently (a bad value falls back to its default and is reported as a
warning, so one typo cannot stop the server from starting) and validates a
`POST` strictly (an unknown key is a 400, because a typo'd toggle that reports
success and changes nothing is the worst of the three outcomes). Writes reuse
`src/env-file.mjs`'s atomic temp-file-and-rename, with its own temp prefix and
its own entry in that module's per-path save queue.

`GET`/`POST /api/settings` carry exactly the setup wizard's gates: the same
`setupGuardFailure()` from `src/loopback-guard.mjs`, and, for the POST, the
CSRF check `server.mjs` derives from `src/routes.mjs`. Changing what this server will write to
someone's Onshape account is at least as sensitive as pasting a key into it.

`SETTING_CONSUMERS` in `src/settings.mjs` names, for every key in
`DEFAULT_SETTINGS`, the file that actually reads it: most point at
`src/capabilities.mjs`, where the key appears as a FEATURES `policyKey` and
`src/capability-gate.mjs` enforces it for whichever route names that feature.
`allowDocumentCreation` and `scratchFolderId` point at
`scripts/live-verify-install.mjs` and `scripts/live-verify-suppress.mjs`
instead — this product never calls `api.createDocument` itself, so those two
controls are real (they persist to `settings.json`) but reserved for the
maintainer's command-line verification scripts. `test/settings.test.mjs`
fails if a setting is added without an entry here, or if a listed consumer
file stops mentioning the key.

### The gate

`requireFeature({ capabilities, policy }, feature)` in
`src/capability-gate.mjs` is the only place the two halves meet. It asks about
the capability first, because a missing scope is the half the operator cannot
fix with a switch, and sending them to a toggle that would change nothing is
worse than saying nothing. It throws
`{ status: 403, code: 'CAPABILITY_DENIED' | 'POLICY_DENIED', feature, reason }`,
and `errorResponse()` forwards `feature` and `reason` to the browser so the UI
shows the server's own sentence rather than composing a second one that can
drift.

Every write reaches it through one `gate()` helper in `src/write-routes.mjs`,
which is handed the capability model and the policy object and names the
feature. `buildAuthSummary()` is where the cached `sessionInfo` snapshot
becomes `auth.capabilities` and is then dropped: every route that answers a
browser builds its `auth` object there, so no route can leak the snapshot by
forgetting to strip it.

## Authentication modes

- `api-key`: Basic authorization for a local developer test.
- `api-key-signature`: Onshape HMAC request signatures for a private/internal service; redirect requests receive a fresh signature.
- `oauth`: per-user authorization for an embedded shared app.
- `bearer`: temporary development/testing mode when a valid bearer token is supplied out of band.
- `none`: standalone pixel calibration only; Onshape reads and writes are unavailable.

Credentials stay in the server process. The browser receives only coarse connection state.

## Write-route pipeline

Every route this server answers — the five writes, the reads that share their
machinery, the OAuth flow, the setup wizard, the settings toggles — is one row
in `src/routes.mjs`. That table, not a hand-maintained list beside a dispatch
chain, is what `server.mjs`'s CSRF check reads and what
`routeRateLimitError()` in `src/session.mjs` looks a bucket up in. A route
missing from it is a route with no gate, and `test/routes.test.mjs` fails
before that can ship: every pathname either dispatch chain compares against
has to name a registered route, and every registered route has to be
dispatched from somewhere.

### The registry's columns

Each row in `src/routes.mjs` names, for one `method`/`path` pair:

- **csrf** — whether `requireCsrf()` must pass. `false` only for `GET`
  requests and the two redirects (`/auth/start`, `/oauth/callback`); every
  other route is `true`.
- **guard** — `'loopback'` when `setupGuardFailure()` in
  `src/loopback-guard.mjs` refuses anything but a direct, unproxied request
  from this machine's own browser, otherwise `null`. Only the setup wizard and
  settings routes carry it.
- **capability** — the `src/capabilities.mjs` `FEATURES` key the route passes
  to `requireFeature()`, or `null` on a route that makes no Onshape write and
  so needs no capability.
- **confirm** — `'policy'` when `requireConfirmation()` asks only while the
  operator's `confirmBeforeWrite` setting is on, `'always'` when
  `requireExplicitConfirmation()` asks regardless of that setting (suppression
  only — see below), or `null` on a route that takes no write confirmation.
- **workspaceContext** — whether `requireWorkspaceContext()` must pass: a
  complete context pointing at a workspace, not a read-only version link.
- **bodyCap** — the byte cap the route reads its body under, `'multipart'`
  where the cap is the configured image size plus multipart overhead instead
  of a fixed number, or `null` where the route reads no body.
- **rateLimit** — the `takeRateLimitToken()` bucket and window the route
  spends, or `null`.
- **rateLimitReason** — exactly one of `rateLimit` and `rateLimitReason` is
  set on every row: a route with no bucket has to say why in one sentence
  instead of the column simply being empty. `test/routes.test.mjs` enforces
  the pairing; the sentences themselves live next to each row in the source
  rather than being repeated here.

`capability`, `confirm`, and `workspaceContext` travel together: any row that
names a capability is a write, and every write in this product goes to one
document in one workspace, so `test/routes.test.mjs` also fails a row that
names a capability without `workspaceContext: true` and a non-`null`
`confirm`.

### The order the gates run in

Above the dispatch chains, `server.mjs` checks CSRF against `CSRF_PATHS`
(`ROUTES` filtered to the non-`GET`, `csrf: true` rows) before any route body
runs. Inside `src/write-routes.mjs`'s `handleWrite()`, the registry's rate
limit bucket is spent next — before the handler reads a byte of the body —
because a throttle that only counted requests which had already passed the
capability gate would not bound anything a client controls. The body is then
read under the row's `bodyCap`.

What runs after that is route-specific, and stays that way: `/api/apply`
checks context and `itemId` before the capability gate; `/api/install` and the
other three writes gate and confirm before reading context. Each handler's own
comment states its order and why — the point that matters here is not that the
four checks (capability gate, write confirmation, workspace context, and the
rate-limit token already spent) run in one universal sequence, but that they
all run, from the same four functions, before any of the five writes touches
Onshape. `withEvidence()` in `src/write-routes.mjs` then wraps the Onshape
call itself: it records a 403 against the session as ambiguous evidence (see
"Evidence" above) and clears any prior evidence on success. `readFeatureStatus()`
reads the response afterward — see "HTTP 200 is not success" below — and, for
install and rebind, the element listing is re-read once more to pick up a
microversion the write response did not carry.

There used to be a second copy of this sequence: `/api/apply` was dispatched
from `server.mjs` and grew its own try/catch around the 403-evidence rule and
its own capability call, so the rule that decides what this server believes
about a key's permissions had two implementations and nothing compared them.
`test/routes.test.mjs` now enforces the fix structurally: `server.mjs` may
contain no `req.method === '<non-GET>'` comparison at all, and every
registered non-`GET` route must be dispatched from some file other than
`server.mjs`.

### Where a route lives

`server.mjs` dispatches; it does not implement.

- `src/write-routes.mjs` — `/api/install/status`, `/api/preview`,
  `/api/install`, `/api/upload-image`, `/api/apply`, `/api/rebind`,
  `/api/suppress`. The five writes and the two reads that share their
  machinery. `/api/preview` lives here rather than on its own because it is
  `/api/apply`'s dry run: it normalizes and solves the operator's request with
  the same code apply will use, and a preview that did it even slightly
  differently would show one placement and store another with nothing in the
  product noticing.
- `src/auth-routes.mjs` — `/auth/logout`, `/auth/start`, `/oauth/callback`.
- `src/settings-routes.mjs` and `src/setup-routes.mjs` — the loopback-only
  wizard and policy routes.

`server.mjs` keeps only the `GET` routes that answer from state it already
holds, the static file server, the CSRF gate, and `errorResponse()`. It also
keeps `normalizeCalibrationRequest()` and `writeBackup()`, which are passed
into `src/write-routes.mjs` as collaborators rather than imported by it, the
same way the context and image-list readers already were.

### Endpoint table

Values below are written the way `src/routes.mjs` writes them —
`null`/`true`/`false` as literal tokens, not prose — so this table can be
checked against the registry mechanically rather than merely read
optimistically. `test/routes.test.mjs` fails if a row here disagrees with the
registry's `method`, `path`, `capability`, or `confirm` columns, or if a row
names a path the registry does not have. `rateLimitReason` is omitted as a
column; the pairing rule is enforced in the source, not restated here.

| Method | Path | csrf | guard | capability | confirm | workspaceContext | bodyCap | rateLimit |
|---|---|---|---|---|---|---|---|---|
| GET | `/api/health` | false | null | null | null | false | null | null |
| GET | `/api/update` | false | null | null | null | false | null | null |
| GET | `/api/bootstrap` | false | null | null | null | false | null | null |
| GET | `/api/connection` | false | null | null | null | false | null | null |
| GET | `/api/context` | false | null | null | null | false | null | null |
| GET | `/api/image` | false | null | null | null | false | null | null |
| POST | `/api/preview` | true | null | null | null | false | 1000000 | preview (60 / 60000ms) |
| POST | `/api/apply` | true | null | updateFeature | policy | true | 1000000 | apply (20 / 60000ms) |
| POST | `/auth/logout` | true | null | null | null | false | null | null |
| GET | `/auth/start` | false | null | null | null | false | null | null |
| GET | `/oauth/callback` | false | null | null | null | false | null | null |
| GET | `/api/setup` | false | loopback | null | null | false | null | null |
| POST | `/api/setup/test` | true | loopback | null | null | false | 4096 | setup-probe (5 / 60000ms) |
| POST | `/api/setup/save` | true | loopback | null | null | false | 4096 | setup-probe (5 / 60000ms) |
| GET | `/api/settings` | false | loopback | null | null | false | null | null |
| POST | `/api/settings` | true | loopback | null | null | false | 4096 | null |
| GET | `/api/install/status` | false | null | null | null | false | null | null |
| POST | `/api/install` | true | null | installFeature | policy | true | 8192 | install (10 / 60000ms) |
| POST | `/api/upload-image` | true | null | uploadImage | policy | true | multipart | upload-image (8 / 60000ms) |
| POST | `/api/rebind` | true | null | rebindImage | policy | true | 8192 | rebind (10 / 60000ms) |
| POST | `/api/replane` | true | null | installFeature | policy | true | 8192 | replane (10 / 60000ms) |
| POST | `/api/suppress` | true | null | suppressFeature | always | true | 8192 | suppress (10 / 60000ms) |

## One-click install

Adding the feature to a document by hand is five steps in three Onshape tabs.
The install route does the same five steps, and everything hard about it is a
question of which microversion goes in which namespace.

### Classification before action

`classifyInstall()` in `src/onshape-model.mjs` is pure: given an element
listing, the source of the Feature Studios that were opened, and the Part
Studio's feature list, it answers `not-installed`, `studio-present`, or
`instance-present`.

A Feature Studio counts as ours when its source contains the exact token
`// reference-align-feature: 1`, which lives in
`featurescript/ReferenceImage.fs` and is pinned by a test. A token rather than
a source diff: an operator may edit the studio and it is still the one we
installed, while a studio that merely looks similar is not. A studio whose
source was *not* fetched is reported in `unreadStudioIds` rather than assumed
to be someone else's, because "we did not look" and "we looked and it is not
ours" are different facts and only one of them justifies creating a second
studio. At most eight studios per document are opened; the rest are unread.

An instance found with no marked studio still reads as `instance-present`. An
operator who installed the FeatureScript by hand has a working document, and
offering to install a second copy over it would be wrong.

### Namespaces, and why the element listing is read twice

A `BTMParameterReferenceImage-2014` locates its image with a namespace string.
E4 of the write-shape experiment established that Onshape stores whatever
string it is given, without validating it, and then reports the feature as
`featureStatus: ERROR` when it cannot resolve. A bare `e<elementId>` and a full
`d…::w…::e…::m…` both do this. The one form that resolves is
`e<elementId>::m<microversionId>`.

The microversion is the trap. The Feature Studio *create* response carries the
microversion from before its contents were set, and the *set-contents* response
carries none at all. Only `GET /documents/d/{did}/w/{wid}/elements` has the
current one. So `POST /api/install` creates the studio, sets its contents, and
then reads the element listing again. `elementNamespace()` validates both ids
and throws on anything else, so a malformed namespace cannot be built at all.

### HTTP 200 is not success

`readFeatureStatus()` is the only place a write response is believed. Every
feature add and every feature update goes through it, and a status other than
`OK` is a 409 carrying the status, not a success. The smoke harness's fake
Onshape reproduces this: a namespace that does not resolve to a real element
and microversion comes back 200 with `ERROR`, exactly as Onshape did.

### Uploads

`src/image-bytes.mjs` decides what an uploaded file is from its leading bytes.
The multipart part's `Content-Type` is a claim about intent, never evidence
about content; it is used only to report a disagreement. PNG, JPEG, GIF, and
WebP are allowed, WebP by both halves of its split signature so a RIFF
container holding audio cannot pass. The filename is reduced to a name —
directory separators, control characters and quotes removed, stem capped, and
the extension rewritten from the sniffed type — because it ends up in a
Content-Disposition header and an Onshape element name.

The body is capped twice: on the declared `Content-Length` before a byte is
read, and again while streaming. `MAX_IMAGE_UPLOAD_BYTES` sets the limit
(25 MB by default) and reloads with the rest of the config.

### Idempotence

`POST /api/install` is idempotent: with an instance present it returns the
existing ids and makes no write, so a double press or two open tabs cannot
leave two features behind. Its `confirm` mode is `'policy'`, the same shared
mechanism every other write but `/api/suppress` uses — see "Write-route
pipeline" above.

### Where the refusal sentence comes from

`describeFeatureGate()` in `src/capability-gate.mjs` answers the same two
questions `requireFeature()` throws on, without throwing.
`featureGateReasons()` runs it over every feature, and `GET /api/bootstrap`,
`GET /api/connection`, `GET`/`POST /api/settings`, and `POST /api/setup/save`
all carry the result as `gates` — every response that can change what a gate
would answer sends the refreshed answer with it, rather than leaving the
browser to keep showing whatever it fetched last. The browser shows those
strings verbatim on the disabled buttons. Composing a second copy in the
browser is how a disabled button and a 403 end up saying different things.

## Suppressing a duplicate native image

A document that already had an Insert image sketch, and then had the calibrated
feature added to it, shows the same picture twice. Onshape's own answer to that
is to suppress one of them, and `POST /api/suppress` is that answer offered at
the moment it becomes relevant: immediately after a successful Apply.

### Which sketch is a duplicate

`findDuplicateNativeImages()` in `src/onshape-model.mjs` is pure and advisory.
It compares the applied feature against every native sketch image in the same
Part Studio and returns one of three verdicts, which differ by what evidence
exists rather than by how strongly anything is believed:

- `exact` — both name the same blob element. The same file, certainly.
- `likely` — no blob id on one side, but the aspect ratios agree to within 1%.
- `possible` — neither comparison could be made at all.

A sketch is left out only on positive evidence against it: a different blob
element, or aspect ratios that disagree. A field that is simply absent is not
evidence, which is why `possible` exists instead of a silent drop. The
microversion is reported and never used to exclude — a rebind moves it on and
the picture is still the same picture.

Reading the blob id is where the two item kinds diverge. A calibrated feature
carries it on its `BTMParameterReferenceImage-2014` `image` parameter; a native
sketch image carries it on a `BTMParameterBlobReference-1679` *inside* the
entity, with `parameterId: "blobInfo"`, while the entity's own `namespace` is
the empty string. `resolveImageBlob()` in `src/onshape-model.mjs` is the one
function that reads either shape, and reads leniently: the `d::w::e::m`
namespace form that Onshape stores but cannot resolve is useless for a write
and perfectly readable for a comparison.

The result travels on the `POST /api/apply` response as `nativeDuplicates`. It
is computed on the server because the cross-reference is one pure function; a
second copy of it in the browser would be a second set of rules.

### What suppression actually does

Suppressing a sketch hides the whole sketch, not only the image in it. In the
document this feature was designed against, the sketch holding the reference
image also held the curves a downstream extrude consumes. So every scanned item
reports `suppressed`, native items also report `otherSketchEntityCount`, and
the offer says how much else is in the sketch before anyone presses anything.

### The route

`POST /api/suppress { itemId, suppressed, confirm }` follows the shared
write-route pipeline (see "Write-route pipeline" above) with three differences
that are deliberate.

**Confirmation is not negotiable.** Every other write asks only while
`confirmBeforeWrite` is on. This one is refused without `confirm: true`
whatever that setting says, because it makes part of someone's model disappear
from their screen. The refusal is a 400, not the 409 the policy check throws:
`confirm` is a required field of this request, not a refusal that depends on
the state of this server.

**`item.editable` is not required.** For a native item that flag means "this
server may rewrite the sketch's internal geometry serialization", which is the
experimental path and off by default. Suppression touches one documented
boolean and no geometry at all, so tying it to that flag would make the offer
dead for everyone who has not enabled an unrelated experiment. The
workspace-versus-version check is the access question, and it still applies.

**A non-OK `featureStatus` means different things in the two directions.** It
fails a suppress. It only warns on an unsuppress: E5 of the write-shape
experiment unsuppressed a feature that was already broken and got `ERROR` back
for a fault that pre-dated the request. The flip is stored either way, so
reporting it as a failed write would only make someone do it twice.

`setFeatureSuppressed()` is the only thing that changes the feature: the whole
stored sketch — nodeIds, entities, constraints — goes back exactly as Onshape
returned it, with one boolean different. A test compares the built payload
against `27-e5-suppressed-true.json`, the body Onshape actually accepted.

A sketch already in the requested state is answered with the current list and
no write, the same rule `POST /api/install` follows for an instance that
already exists.

## Supported custom-feature write

The server looks for a feature containing these exact parameter IDs:

```text
image
plane
imageWidth
imageAngle
originX
originY
```

It changes only the four quantity expressions and sends an official-style `BTFeatureDefinitionCall-1406` update. The image and plane parameters remain untouched.

## Experimental native-image write

Native sketch images may appear as `BTMSketchImageEntity` objects. The adapter derives:

```text
width = hypot(xaxisX, xaxisY)
angle = atan2(xaxisY, xaxisX)
```

It writes the inverse mapping and removes constraints that directly reference the image entity. Because this is internal feature serialization, the implementation is gated and carries no compatibility promise.

**The `xaxisX`/`xaxisY` field names are an assumption, and every real capture
this project holds contradicts them.** `test/fixtures/native-sketch-image.mjs`
is copied field for field from a real `/api/apply` backup and has no
`xaxisX`/`xaxisY`. The later `docs/experiments/2026-09-05-suppress-verify/`
run created a real `BTMSketchImageEntity-763` through the product's own route
and read it back through `scanFeatureList()`
(`04-cross-reference.json`); the entity Onshape returned has no
`xaxisX`/`xaxisY` either, and the resulting item has no `placement` field at
all. Both pieces of evidence agree with each other and disagree with the
formula above: `placementFromNativeImageEntity()` throws on every native
image this project has ever observed, `scanFeatureList()` catches that and
reports `placement: undefined`, and the UI correctly shows "placement
unavailable" and refuses Apply for the item — every time, not only on the
edge case the catch block was written for. Until a capture shows where width
and angle actually live on this entity, treat the write half of this path as
unverified rather than gated-but-working.
