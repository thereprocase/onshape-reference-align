# Changelog

## 0.2.3

- Preserve LF source/manifests on Windows Git checkouts so generated-asset
  verification is identical across platforms; Windows launchers retain CRLF.
- Supersedes the initial 0.2.2 release attempt, whose Windows checkout failed
  before building. No 0.2.2 binary release was published.

## 0.2.2

- Prepare the initial public repository with contribution, security and conduct
  policies, issue templates, a pull-request checklist and a workspace preview.
- Provide four native CI release ZIPs with offline guides, platform launchers,
  licenses and checksums; require release tags to match the application version.
- Publish a clean source snapshot with private recovery history omitted and
  captured Onshape identifiers pseudonymized for public fixtures.

## 0.2.1

- Added a self-contained, offline beginner guide and explicit Windows launcher.
- Improved first-run connection guidance for Onshape users without development tools.
- Automatically recover from occupied local ports without stopping other apps;
  fixed hosted/OAuth deployments keep their configured address.

## 0.2.0

- Add Connection, Document and Settings flyouts, Source/Preview tabs, and
  responsive calibration tools with keyboard navigation.
- Choose Top, Front, Right, a custom plane, or the plane of an existing sketch
  when installing an image. Change its plane later with confirmation and a
  backup while preserving the image and calibration parameters.
- Verify installation, replane, separate-pair calibration, and healthy native
  sketch suppression against public scratch documents. Direct native-image
  calibration remains experimental and refuses unsupported placements.
- Handle malformed cookies and close unfinished requests through the shared
  responders. Correct Linux setup-write testing and browser drag/error state.

- Build the packaged application as CommonJS for the supported Node 22/24
  SEA loader. The previous ESM bundle generated successfully but failed at
  executable startup. Binary smoke now runs outside the checkout with isolated
  configuration and no inherited Onshape credentials or update feed.

- Put a rate limit on every write route. `/api/preview`, `/api/apply`,
  `/api/install`, `/api/upload-image`, `/api/rebind`, and `/api/suppress` each
  take a per-session token from a bucket declared in `src/routes.mjs`; over the
  limit they answer 429 with a `Retry-After` header, the same shape the setup
  wizard already used. The token is taken before the request body is read,
  which is what bounds `/api/upload-image` — one upload holds several copies of
  the image in memory at once. A route that has no bucket now has to record why
  in the route table.

- Add a Node Single Executable Application build for Windows, macOS
  (arm64), and Linux: download a binary, double-click it, and the setup
  wizard opens in the browser — no Node install required. `src/assets.mjs`
  is the seam that lets the same `server.mjs` read static files from disk
  when run from source and from the binary's embedded asset table when
  packaged; `scripts/build-sea-bundle.mjs` is a hand-rolled bundler that
  flattens the zero-dependency import graph into the one file a packaged
  main script is allowed to load. See `docs/DISTRIBUTION.md`.
- Add `.github/workflows/release.yml`: on a `v*` tag, builds, smoke-tests,
  and publishes all three platform binaries plus a `SHA256SUMS` file to a
  GitHub Release. `.github/workflows/ci.yml` runs the full check on every
  push and pull request. Every action is pinned by commit SHA.
- Print the real bound port once the listener starts (`PORT=0` now works)
  and open the default browser to it on first run, unless `--no-open` is
  given or stdout is not a terminal.
- Add an opt-in update-check banner: `GET /api/update`, driven by
  `UPDATE_CHECK_URL` (empty by default, meaning disabled), shows a
  dismissible notice with a manual download link when a newer version is
  published. Never downloads or runs anything; fails silently offline.
- Offer to hide a duplicate native image. A document that already had an
  Insert image sketch, and then had the calibrated feature added, shows the
  same picture twice. After a successful Apply the result now says which sketch
  looks like a duplicate and offers to suppress it, with a one-line explanation
  of what that does; a suppressed sketch carries an **Unsuppress** button in
  the Onshape target card. Nothing is deleted and the change is reversible.
- Add `POST /api/suppress`. It is gated on both the key's permissions and the
  **Suppress features** switch, it always requires `confirm: true` in the
  request — even with **Confirm before every write** turned off — and it writes
  the usual JSON backup before it writes to Onshape. A sketch already in the
  requested state is answered without a write.
- Cross-reference native images against the calibrated feature by the blob
  element they are bound to, falling back to the aspect ratio: `exact`,
  `likely`, or `possible`. A different blob element, or aspect ratios that
  disagree, excludes a sketch outright; a field that is simply absent never
  reads as a mismatch. The result is advisory and decides nothing on its own.
- Report `suppressed` on every scanned target, and how many non-image entities
  a sketch holds, because suppressing a sketch hides all of it — including
  curves a downstream feature is built on.
- Add `scripts/live-verify-suppress.mjs`, which drives the product's own route
  handlers against a real document and writes redacted captures. It refuses to
  run without `--yes` and an explicit target.

- Install the Onshape feature in one press. The Onshape target card reports
  what a document already has, and **Install into this document** creates the
  Feature Studio, adds a **Calibrated Reference Image** instance, and selects
  it. A second press writes nothing: a document that already has the feature is
  reported, not installed over. Adding the Feature Studio by hand is still
  supported and is now documented as the fallback.
- Add **Upload and use this image**: the image loaded in the browser is
  uploaded to the document and the selected feature is pointed at it, with the
  usual JSON backup written first.
- Add `GET /api/install/status`, `POST /api/install`, `POST /api/upload-image`,
  and `POST /api/rebind`. Each is gated on both the key's permissions and the
  operator's settings before any Onshape call, honours **Confirm before every
  write** at the server rather than only in the browser, and checks Onshape's
  own `featureState.featureStatus` on the response. HTTP 200 is not taken as
  success: Onshape stores an unresolvable image reference without complaint and
  then reports the feature as `ERROR`.
- Recognise an installed Feature Studio by the exact token
  `// reference-align-feature: 1`, now carried near the top of
  `featurescript/ReferenceImage.fs`. A Feature Studio whose source was not
  read is reported as unread rather than assumed to be someone else's.
- Type uploaded images from their own leading bytes rather than the browser's
  `Content-Type`, allow PNG, JPEG, GIF, and WebP only, and cap the upload at
  25 MB (`MAX_IMAGE_UPLOAD_BYTES`).
- Send a refusal sentence per write feature with the bootstrap and connection
  responses, so a disabled button shows the same wording the route would refuse
  with instead of a second copy that can drift from it.
- Add `scripts/live-verify-install.mjs`, which drives the product's own route
  handlers against a real document and writes redacted captures. It refuses to
  run without `--yes` and an explicit target.

- Read what the configured Onshape key is actually permitted to do from
  `GET /users/sessioninfo`, and show it: the header badge now carries the
  plan and the granted scopes (`Free · read · write`), and names any
  permission bit this app does not recognise rather than ignoring it. The
  scope-bit meanings are a working assumption, labelled as one in the source.
- Add a **What this app is allowed to do** card with one switch per optional
  write (install the feature, upload images, create scratch documents,
  suppress features, confirm before every write, plus an optional scratch
  folder id). Settings live in a `settings.json` beside the configuration
  file, hold no credentials, and are readable and writable only from a
  browser on the computer running the server — the same gate the setup
  wizard uses.
- Gate `POST /api/apply` on both halves: the key's own permissions and those
  settings. A refusal carries the reason as text, and the UI shows that same
  sentence on the disabled button instead of composing its own.
- Record a 403 from Onshape on a write as evidence against the session, so
  the next attempt explains itself up front. The evidence expires after
  fifteen minutes, clears on the next success, and is dropped when the
  credentials change — a 403 can also mean "you cannot edit that document",
  and that must not disable the app permanently.
- The account email Onshape returns with the session info is dropped where
  the response is read, and never cached, logged, or sent to the browser.
- Add a loopback-only setup wizard (`#setupCard`) so an operator can enter
  an Onshape API key pair from the browser instead of hand-editing the env
  file. The header badge now shows a truthful, probed connection state
  (`Onshape · {name}`, `Onshape key rejected`, `Onshape unreachable`, …)
  instead of the old credential-presence heuristic, and clicking it opens
  the wizard.
- Add `GET /api/connection`, and add a `setup` block to `GET /api/bootstrap`
  and `configSource` to `GET /api/health`.
- Make the Onshape configuration reloadable in-process: saving credentials
  through the wizard takes effect without a server restart. A hand-edited
  env file still needs one — nothing watches it — and `HOST`, `PORT`,
  `PUBLIC_BASE_URL`, `UPDATE_CHECK_URL`, and `NODE_ENV` always need one; the
  server reports which of those changed on a reload.
- Remove the unused `SESSION_SECRET` configuration key. Session IDs and CSRF
  tokens continue to use random values generated by the server.
- Fix: if `ONSHAPE_ACCESS_KEY`, `ONSHAPE_SECRET_KEY`, `ONSHAPE_BASE_URL`, or
  `ONSHAPE_AUTH` is already set as a real environment variable, it always
  wins over the file on reload, so a wizard save could write new credentials
  to disk and report success while the server kept using the old, shadowed
  ones. Save now recognizes that mismatch and reports
  `CONFIG_SHADOWED_BY_ENVIRONMENT` instead of a false `ok: true`.
- Resolve the configuration file the same way regardless of where the
  server is started from: `--config <path>`, then
  `ONSHAPE_REFERENCE_ALIGN_CONFIG`, then a project-root `.env` if one
  exists, then a per-user config directory. The resolved path and its
  source are printed once at startup.
- Recognize the namespace form of Onshape's reference-image parameter
  (`BTMParameterReferenceImage`), so **Load selected Onshape image** works for
  calibrated features on the current v17 serialization.
- Add a paste-the-URL box to the Onshape target card, so a Part Studio
  address bar copy — including version and microversion links, and the
  extension action-URL form — can be loaded without hand-building a query
  string or reloading the page.
- Show the specific blocking reason under every disabled control (Load
  selected Onshape image, Refresh, the pick buttons, Preview, and Apply),
  replacing the previous silent grey-button-and-toast behavior.

## 0.1.0 — 2026-09-04

- Initial pixel-pair scale and rotation calibrator.
- Separate scale and orientation pairs.
- Horizontal, vertical, nearest-axis, arbitrary-angle, and keep-current rotation targets.
- Anchor preservation at either pair endpoint or image center.
- Supported calibrated-image FeatureScript path.
- OAuth, signed API-key, Basic local-test API-key, and bearer-token server integration.
- Experimental native sketch-image adapter behind an explicit flag.
- Automatic JSON backup before feature updates.
- Narrow-panel pick controls scroll the pixel canvas back into view.
- Automated HMAC, UI-contract, and local HTTP smoke tests.
