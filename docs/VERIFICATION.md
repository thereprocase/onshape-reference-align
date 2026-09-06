# Verification record

Latest onboarding/package acceptance: [0.2.1 release record](RELEASE-0.2.1.md).
685 tests plus HTTP smoke pass. Windows/Linux packaged launch and private
Tailscale downloads are verified; macOS native launch and real-person usability
are explicitly not claimed.

## Automated checks

Run:

```bash
npm run check
```

The suite currently checks:

- horizontal two-pixel scaling,
- diagonal/aspect-aware coordinate math,
- separate scale and rotation pairs,
- arbitrary-angle alignment,
- nearest-axis snapping,
- anchoring at pair points and image center,
- coincident-point rejection,
- native image placement conversion,
- engineering unit conversion and expression formatting,
- calibrated-feature discovery,
- preservation of non-placement feature fields,
- removal of only native constraints that reference the image,
- creation of an official-style feature update payload,
- nested image metadata and blob-reference discovery,
- HMAC request-signature canonicalization,
- UI element/asset contract checks,
- full local HTTP startup, CSRF bootstrap, static asset delivery, and a six-inch preview calculation.

## Locally smoke-tested

- Node syntax checks.
- HTTP server startup.
- `GET /api/health` and static UI delivery.
- Static HTML, CSS, JavaScript, FeatureScript, and health-endpoint delivery over the local HTTP server.
- A complete `/api/bootstrap` → CSRF-protected `/api/preview` request with a known 6 in calibration.

## Recorded live Onshape evidence

The September 5, 2026 experiments used public scratch documents and left their
artifacts in place. They are historical evidence, not a claim that every later
revision has been tested live.

- [Write-shape experiment](experiments/2026-09-04-bind-experiment/FINDINGS.md):
  uploaded image blobs, created the Feature Studio and a custom image on Top,
  and captured feature serialization. Only the `e<blobId>::m<microversion>`
  image namespace regenerated successfully.
- [Install/rebind verification](experiments/2026-09-05-install-verify/FINDINGS.md):
  product handlers installed and rebound the image with `featureStatus: OK`;
  repeating install made no duplicate feature.
- [Suppression verification](experiments/2026-09-05-suppress-verify/FINDINGS.md):
  unconfirmed suppression was refused, suppression succeeded, and its repeat
  made no write. The synthetic native sketch started in `ERROR`; unsuppress
  returned it to `ERROR`. This does not prove a healthy native-image workflow.

## Takeover acceptance

- [Plane experiment](experiments/2026-09-05-plane-experiment-t5N9Xx/FINDINGS.md):
  all P1–P5 phases accepted, including Front/Right, a user-created offset plane,
  a copied sketch-plane query and stored replane. Query-only and query plus
  resolved IDs succeeded; IDs without a query string were refused.
- [Product HTTP acceptance](experiments/2026-09-05-product-verify-b7C9vO/summary.json):
  the actual running server uploaded and installed on Front, changed to Right,
  a user plane and a sketch plane, then previewed and applied separate scale
  and rotation pairs. Replane preserved every non-plane model field; Apply
  preserved the selected plane. Backup files are retained beside the captures.
  Only Onshape's regenerated serialization `nodeId` fields are ignored when
  comparing model values.
- [Healthy suppression](experiments/2026-09-06-suppress-verify-pkAcQq/FINDINGS.md):
  a native-image sketch created with a resolved Top plane regenerated OK.
  The product refused unconfirmed suppression, suppressed successfully,
  made no second write for repeat suppression, and unsuppressed with OK.
- Chromium acceptance covers first-run setup, flyout transitions and focus,
  local image picking and repicking, preview/result transitions, and the
  required rail/panel/image/tools ordering at 980px and 390px. Installation on
  Front followed by a confirmed change to Right passed and invalidated the
  prior preview.
- Final independent frontend rereview returned clean after three asynchronous
  state races were fixed; targeted regressions passed 101/101.
- The combined `npm run check` passed 677/677 tests and local HTTP smoke.
- Final Linux SEA build and expanded binary smoke passed from outside the
  checkout, including upload, install on Front, replane to Right and backups
  against a local Onshape stub. Windows x64 also passed that expanded smoke
  on Windows Node 24.14.1; Linux used Node 24.15.0. Release archives and hashes
  are in `dist/release-0.2.0/`. Windows is unsigned; macOS is not locally
  verified. No external release publication destination is established.

Repeat the live product checks only in newly created scratch documents:

```bash
node scripts/experiment-plane.mjs --yes --create-document
node scripts/live-verify-product.mjs --yes --create-document
```

These scripts require configured credentials, write only with explicit flags,
and retain public scratch artifacts in the Reference Align tests folder.
The default test suite uses local stubs and never calls Onshape.

### Suppression

The original September 5 sketch lacked its plane and was already broken.
The corrected verifier resolves the plane first and refuses to proceed unless
the new sketch is healthy:

```bash
node scripts/live-verify-suppress.mjs --yes --create-document
```

It drives the product's route handlers against a scratch document in the
"Reference Align tests" folder and writes redacted captures. The confirmed
round trip does not enable direct native-image placement writes: those still
refuse shapes without a supported placement representation.

What the run has to show: an unconfirmed request refused with 400
`CONFIRM_REQUIRED`, a suppress reported `OK`, a second identical suppress
answered without a write, and an unsuppress that puts the sketch back.

Leave `ENABLE_NATIVE_IMAGE_WRITE=false`; use the calibrated FeatureScript for
placement changes. Photographic distortion and downstream dependencies remain
model-specific considerations, not properties the calibration solver can infer.
