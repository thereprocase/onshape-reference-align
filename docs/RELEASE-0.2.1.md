# Reference Align 0.2.1 — beginner desktop packages

Download: <https://deployment.example.invalid/reference-align/> (tailnet only).
Files: `dist/release-0.2.1-final/`; extract the ZIP and open `START-HERE.html`.

| Package | Implementation | Verification |
| --- | --- | --- |
| Windows x64 | Self-contained Node 24.14.1 SEA + `.cmd` launcher | Native packaged smoke, actual ZIP extraction/launcher in a path with spaces, no Node/npm on PATH, first-run setup |
| Linux x64 | Self-contained Node 24.15.0 SEA + `.sh` launcher | Native packaged smoke and extracted launcher; clean process shutdown |
| macOS Apple Silicon | Unmodified official Node 24.14.1 arm64 + app + `.command` | Published runtime SHA256 and Mach-O architecture verified; app layout smoke-tested with Linux Node, not a Mac launch |
| macOS Intel | Unmodified official Node 24.14.1 x64 + app + `.command` | Published runtime SHA256 and Mach-O architecture verified; same app layout; not a Mac launch |

The Mac packages are test builds until launched on an actual Mac. No developer
tools or runtime installation are required on any target. Windows is unsigned
as accepted by the user; the product is not Apple-notarized. Per-app security
guidance is included, with no global security changes requested.

## Improvements and evidence

- Final `npm run check`: 685/685 tests and HTTP smoke passed.
- The private HTTPS page and all four complete ZIP downloads were verified
  from the Windows Tailscale peer; every downloaded SHA256 matched the manifest.

- Plain Onshape-oriented create-key → paste → test → save guidance. API-key
  creation still requires the user's own account and is not bypassed or automated.
- Visible Connection/Document/Settings labels and an offline-first preview path.
- Standalone offline HTML guide with exact image/install/calibration steps;
  developer setup is separate. Independent agent walkthrough found and resolved
  three missing steps. This is not an unaided real-person usability test.
- Direct local desktop startup automatically recovers from a busy port, commits
  the new origin before setup, and leaves the occupied listener running. Hosted,
  production and OAuth addresses do not silently move.
- Real-server regression verifies setup saving at the recovered origin and
  refusal of stale-origin/missing-CSRF writes.
- Packaged smoke covers collision recovery, setup, upload, Front install,
  Right replane and backup creation against an isolated local Onshape stub.
- Chromium first-run, Enter-to-test, skip/reopen, document transitions, picking,
  Preview, plane writes, and mobile ordering at 980/390 px pass.
- Native CI matrix prepares four beginner ZIPs with guide, launchers and both
  project and Node licenses. Workflow structure and assembly tested locally;
  hosted CI was not triggered.
- No new live Onshape writes were needed for these onboarding changes. The
  prior product evidence in `VERIFICATION.md` remains historical evidence.

Only the release directory is shared. Credentials, configuration, backups,
source checkout, and recovered chats are outside the served tree. Existing
Tailscale routes on 443, 8443 and 8444 are preserved. Remove only this route
when retiring downloads: `sudo tailscale serve --https=443 --set-path=/reference-align off`.

## SHA256 of distributed ZIPs

```text
73deac9e97c46d59fe65092e4f07a5f864b0136fca2f0d3e55629d670b542f27  reference-align-0.2.1-windows-x64.zip
0612c439cb0129c1834ee29bc4707a3babe2057d82fcd78f36e90cf993e28272  reference-align-0.2.1-linux-x64.zip
f491cfa6b7148aad67e106f4f8bc0a14138d476a4aab46378b51f34ccf6ff99d  reference-align-0.2.1-macos-arm64.zip
494cadbde2dfc7caac3eaf23618c9fe42525f38095e6d556c0da1577a9e10bf9  reference-align-0.2.1-macos-x64.zip
```

Build-tool recipe: `python3 scripts/package-desktop.py --runtime-downloads
/path/to/verified-runtime-downloads --output /new/output/directory`.
The script pins the two official Node runtime archive hashes, copies only
allowlisted app inputs, retains executable permissions, includes Node licensing,
and refuses to overwrite an existing ZIP. Python is needed only by the packager.
