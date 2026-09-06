# Distribution

Download the published desktop packages from
[thereprocase/onshape-reference-align Releases](https://github.com/thereprocase/onshape-reference-align/releases).
The [v0.2.3 native release workflow](https://github.com/thereprocase/onshape-reference-align/actions/runs/34003423109)
passed on all four target platforms and published the ZIPs and checksums.

The release workflow builds desktop ZIPs on Windows x64, Linux x64, Mac Apple
Silicon and Mac Intel runners. Each ZIP contains a launcher, the application,
an offline START-HERE guide, and licenses. Choose the platform ZIP under
**Assets**, not GitHub's automatically generated **Source code** archive.
No Node installation is required. Native executable build and automated launch
checks passed on both Mac architectures as well as Windows and Linux.

CI uses Node's
[Single Executable Application](https://nodejs.org/api/single-executable-applications.html)
format on each target platform. Earlier local Mac packages used an unmodified
official runtime plus app files; those packages did not establish a native Mac
launch result. Historical local acceptance evidence is recorded in
[0.2.0 acceptance](RELEASE-0.2.0.md) and [0.2.1 acceptance](RELEASE-0.2.1.md).
Docker is a secondary hosted channel. There is no npm package or auto-updater.

## Installing and running

Start with the offline [START-HERE guide](START-HERE.html), included in the ZIP.
Extract the entire package (**Extract All…** on Windows), then open its native
launcher: `START-REFERENCE-ALIGN.cmd` on Windows,
`START-REFERENCE-ALIGN.command` on macOS, or `START-REFERENCE-ALIGN.sh` on Linux.
Choose the Apple Silicon or Intel package to match your Mac. Keep all extracted
files together, and keep the launcher’s app window open while using the browser.
Every platform package includes its runtime. An unaided real-person first-launch
test remains outstanding; CI does not verify desktop trust prompts.

The browser opens the local app. If it does not, copy the full local URL printed
in the app window. The Connection wizard walks through creating, testing and
saving your Onshape key; no credential-file editing is needed. Then load your
Part Studio URL, choose an image, install it, pick scale and rotation points,
preview and apply. The offline guide covers those steps and unsigned-app warnings.

No Node install, no `npm install`, no project checkout. The binary is the
same server this repository builds from source — everything in
[`ARCHITECTURE.md`](ARCHITECTURE.md) and [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md)
still applies.

## Advanced launch and configuration (developers and administrators)

### Flags

- `--no-open` — do not open a browser automatically (it still opens by
  default whenever stdout is a real terminal, or unconditionally with
  `--open`).
- `--config <path>` — use a specific config file instead of the default
  per-user location (see below).

### If the port is already in use

The ordinary local desktop app tries another available local port if its normal
port is occupied. Use the full URL from this launch; do not stop another app or
edit configuration to make room. This fallback is limited to direct loopback,
non-OAuth, non-production launches. Administrators of other deployment modes
must deliberately select an available port and preserve their OAuth callback URL.

## Where configuration and backups live

The binary has no project checkout to keep a `.env` beside, so it uses a
per-user configuration directory (the same one `src/config-paths.mjs`
computes for a from-source run with no local `.env`):

| OS | Config directory |
|---|---|
| Windows | `%APPDATA%\onshape-reference-align\` |
| macOS | `~/Library/Application Support/onshape-reference-align/` |
| Linux | `$XDG_CONFIG_HOME/onshape-reference-align/` (or `~/.config/onshape-reference-align/`) |

Inside that directory: `.env` (credentials and settings), `settings.json`
(the policy toggles from the settings card), and `backups/` (one JSON file
per Onshape write, containing the feature state *before* the write — see
[`ARCHITECTURE.md`](ARCHITECTURE.md)). The resolved path is printed once at
startup (`Config: <path> (<source>)`) and shown in the wizard.

Use `--config <path>` to point at a different file (a portable USB install,
a scripted test run, and so on).

## SmartScreen, Gatekeeper, and antivirus

The binaries are not code-signed unless a maintainer has added a paid signing
certificate for this release (see `.github/workflows/release.yml`'s
secrets-gated signing steps). Until then, expect:

- **Windows:** SmartScreen may show "Windows protected your PC". Only if you
  trust the download’s source, choose **More info → Run anyway** where offered.
  If a managed computer blocks that option, ask its administrator. Do not disable
  antivirus or change system security settings.
- **macOS:** Gatekeeper may block the first launch of an unsigned/ad-hoc-signed
  app. After attempting to open it, use **System Settings → Privacy & Security →
  Open Anyway**, only if you trust the download and that option is offered.
  Follow [Apple’s official instructions](https://support.apple.com/en-us/102445).
  If the option is absent or launch is still blocked, report the warning or ask your administrator.
  Do not disable Gatekeeper or remove quarantine protections.
- **Antivirus:** do not assume a detection is a false positive. Stop and verify
  the source, and report the detection for investigation; do not disable protection.

## Verifying `SHA256SUMS`

The release workflow is configured to produce `SHA256SUMS` alongside the ZIPs.
For local outputs, use the checksum supplied with that verified build.
A hash detects differences against a trusted expected value; it does not identify
the publisher. An archive and checksum from the same unknown sender do not prove
the download is trustworthy.

```bash
# macOS / Linux: use the exact ZIP filename downloaded from the release
shasum -a 256 reference-align-macos-arm64.zip
# Compare the printed hash with that filename's entry in SHA256SUMS.
```

```powershell
# Windows PowerShell
$expected = (Select-String -Path SHA256SUMS -Pattern '  reference-align-windows-x64\.zip$').Line.Split(' ')[0]
$actual = (Get-FileHash reference-align-windows-x64.zip -Algorithm SHA256).Hash.ToLower()
if ($expected -eq $actual) { "OK" } else { "MISMATCH" }
```

## Building locally (maintainers)

The build has two stages: generating the blob (a Node built-in) and
injecting it with `postject` (a third-party build-time tool). Only the first
stage runs by default.

```bash
node scripts/build-sea.mjs                     # blob + copied, uninjected binary only
node scripts/build-sea.mjs --allow-postject     # also verifies postject's registry
                                                 # integrity and injects — produces a
                                                 # working binary for your own platform
node scripts/smoke-binary.mjs dist/<platform>/<binary>
```

`--allow-postject` requires network access (to verify `postject`'s published
integrity hash against the constant recorded in `scripts/build-sea.mjs`,
then to fetch it) and is never run automatically by anything other than the
release workflow or a maintainer who deliberately passes the flag.
Build tooling is fetched at its pinned version with npm lifecycle scripts
disabled. The build must run on its target platform; `--platform` labels and
checks the host executable rather than cross-compiling it.

Building a packaged binary requires Node **22.20.0+ or 24.8.0+** specifically
(not just the project's `>=22` floor for running from source): the packaged
asset-loading path in `src/assets.mjs` needs `node:sea`'s `getAssetKeys()`/
`getRawAsset()`, which landed in those two releases independently.
`scripts/build-sea.mjs` refuses to build on an older Node rather than
producing a binary that would fail the first time it serves a static file.

CI builds with Node **24.14.1** exactly (see `.github/workflows/release.yml`)
— pinned to a specific patch, not a floating major, because Node's SEA
feature is Stability 1.1 ("active development"): re-run the full build and
smoke-test matrix before ever bumping that pin, rather than trusting a minor
version bump not to have changed something.

The bundle is CommonJS (`dist/bundle.cjs`). Node 22/24's SEA loader executes
CommonJS; a newer `mainFormat: "module"` setting is ignored by these runtimes.
See the [Node 24 SEA documentation](https://nodejs.org/download/release/v24.15.0/docs/api/single-executable-applications.html).
The binary smoke runs from an empty temporary directory with test-only
configuration, so it cannot silently depend on a project checkout.

### Code signing

Both signing steps in `.github/workflows/release.yml` are optional and gated
on repository secrets:

- **macOS:** set `APPLE_SIGNING_IDENTITY` to a Developer ID Application
  identity already available in the runner's keychain (importing a
  certificate into a GitHub Actions runner is its own setup, not covered
  here).
- **Windows:** set `WINDOWS_CERT_PFX` (a base64-encoded `.pfx`) and
  `WINDOWS_CERT_PASSWORD`. `signtool` ships with the `windows-latest` runner
  image.

Without either secret, releases ship unsigned (Windows) or ad-hoc-signed
(macOS — `codesign --sign -` is mandatory just to run after injection, not a
real identity). Users will see the SmartScreen/Gatekeeper prompts above until
a maintainer adds real certificates.

## Update notices

There is no auto-updater: this binary never downloads or executes anything on
its own. Setting `UPDATE_CHECK_URL` (in the config file, empty/unset by
default) to a URL serving `{ "version": "0.3.0", "url": "https://..." }`
makes the app fetch it once at startup (3s timeout, offline-safe) and show a
dismissible banner with a manual download link when a newer version is
published. See `src/update-check.mjs` for the exact contract.

## Docker (secondary channel)

The `Dockerfile` at the repository root still builds and runs the app from
source inside a container. Configure credentials through an env file or
environment variables: the setup wizard's loopback-only guard rejects the
normal Docker bridge connection. A remote hosted deployment requires its own
HTTPS and access controls; the container does not provide those.

The image sets `BACKUP_DIR=/app/backups` and
`ONSHAPE_REFERENCE_ALIGN_CONFIG=/app/.env`, so those are the two paths to
volume-mount for persistence:

```sh
docker run -p 8787:8787 --env-file .env -e HOST=0.0.0.0 \
  -v reference-align-config:/app \
  onshape-reference-align
```

Mounting `/app` covers both `/app/.env` (config) and `/app/backups`
(feature-list backups) in one volume. Without a mount, the container starts
unconfigured and any backups it writes disappear when the container is
removed.
