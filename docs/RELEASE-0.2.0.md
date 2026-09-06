# Reference Align 0.2.0 — local release

Verified Linux x64 and Windows x64 builds are in `dist/release-0.2.0/`.
The archives contain the executable, this guide, and the MIT license only.
No credentials, configuration, backups, or live captures are distributed.

Extract your platform's archive, then launch `reference-align` (Linux) or
`reference-align.exe` (Windows). No Node installation is required. Open the
printed local URL if the browser does not open. The default port is 8787;
if another instance uses it, this older release requires an explicitly chosen
alternative port. The newer beginner packages include native launchers, an
offline START-HERE guide and automatic local-port fallback.

Follow Connection setup, load a Part Studio URL, then load an image before
installing it. Choose the installation plane in the Document panel.
Scale and rotation use independent pixel pairs. Preview before Apply.
Changing the plane requires confirmation and invalidates the old preview.
Writes retain backups in the per-user configuration directory.

Verify archive hashes against the adjacent `SHA256SUMS`. Windows is unsigned;
only allow it to run if you trust the source. A checksum detects changes against
a trusted expected value; it cannot authenticate an unknown sender.
macOS is configured in release CI but was not built or tested locally.
These are local release artifacts, not an externally published release.

Acceptance: 677 automated tests and HTTP smoke; actual Chromium desktop and
mobile flows; seven live product HTTP checks; healthy suppression/unsuppression;
Linux and Windows packaged startup, upload, Front install, and Right replane.
Live writes used authorized scratch documents only. Native direct-image
calibration remains intentionally disabled; the custom calibrated feature is
the supported placement path. See `docs/VERIFICATION.md` in the source checkout.
