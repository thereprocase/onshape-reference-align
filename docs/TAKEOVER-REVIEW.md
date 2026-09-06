# Takeover review — 2026-09-05

This records the recovery audit of the inherited `feat/product` tree and the
follow-up fixes, completed layout/plane integration and verified Linux build.
Platform and publication status are recorded below.

## Why the review was repeated

The original consolidation workflow (`wf_898c3dba-a97`) reported completion,
but its final notification recorded 155 completed agents and six session-limit
failures out of 161. The missing results included four consolidation reviewers,
release documentation and the final README read. A completed workflow label
therefore did not establish a clean review. The takeover inspected the journal,
transcripts, handoffs and current code rather than accepting that label.

## Completed checks and fixes

| Area | Evidence and outcome |
| --- | --- |
| Consolidation correctness | Independent differential review reported 174 comparisons with zero differences. This checks the compared behaviors, not every possible input. |
| Client pointer handling | Reproduced a move followed by pointerup before the animation frame: a drag became a calibration pick. The layout work now processes a pending matching move before clearing pointer state. |
| Client error messages | Reproduced a local `POLICY_DENIED` response being replaced with advice to change the Onshape key. The shared formatter now preserves local policy, capability, CSRF and setup refusals before interpreting upstream status codes. |
| Linux baseline | Initial run passed 633 of 634 tests. Commit `ab3ffd9` corrected the setup-write-failure fixture to trigger its failure after startup on all platforms; the baseline then passed 634 tests. |
| Malformed cookies | Commit `aea2d07` ignores invalid percent encoding in cookies and moves session/URL construction inside the server's error boundary. |
| Incomplete refused requests | Follow-up review found setup/settings early refusals bypassed the first cleanup patch. Cleanup now lives in the shared JSON/text/redirect responders, closes incomplete requests after response completion, and covers those module-level refusals. |
| Route gates | Independent inspection found no confirmed CSRF, workspace, capability or confirmation bypass in the reviewed handlers. Existing session, route, write and setup/settings regressions passed 136/136 before the final cleanup follow-up. |
| Final cleanup regression | HTTP/connection tests passed 8/8 after centralizing cleanup, including unfinished foreign-Origin requests to setup/settings with valid CSRF and malformed-cookie recovery. Independent review accepted this correction. |
| Linux executable | Actual SEA startup exposed the inherited ESM bundle as incompatible with Node 24's CommonJS loader. The CommonJS bundle now builds and passes binary smoke from an empty temporary directory, including embedded browser modules and first-run setup availability. Packaging tests passed 23/23. |
| Final frontend review | Independent rereview returned clean after all three asynchronous-state races were fixed; the targeted regression run passed 101/101. |
| Combined integration | `npm run check` passed all 677 tests plus the local HTTP smoke on the combined tree. |

Uploads retain the configured file-size cap, multipart envelope cap, declared
length check, streaming byte counter, content validation and pre-body
per-session rate limit. This statement describes the reviewed implementation;
it is not a general load-capacity certification.

## Completed integration evidence

The rail/flyout layout and plane-selection backend/UI are present. Independent
G1 review found no confirmed backend bugs; plane/model/registry/gate tests passed
45/45. The [product HTTP acceptance](experiments/2026-09-05-product-verify-b7C9vO/summary.json)
completed all seven checks: default candidates, upload/install on Front,
custom/sketch candidates, replane to Right/custom/sketch, and separate-pair
preview/Apply preserving the plane. Non-plane comparisons ignore only
Onshape's regenerated serialization `nodeId` fields.

The [healthy suppression run](experiments/2026-09-06-suppress-verify-pkAcQq/FINDINGS.md)
created a native-image sketch with a resolved Top plane and verified refusal
without confirmation, suppression, a repeat without a write, and unsuppression
with successful regeneration. The historical direct-handler verifiers now
provide the shared session required by the consolidated rate-limit contract.

Actual Chromium checks passed source-image loading, picks, preview and setup,
plus installing on Front and confirming a change to Right that invalidates the
old preview. The corrected mobile ordering passed at both 980px and 390px.

The final Linux SEA build and expanded binary smoke passed. The packaged
process ran outside the checkout and exercised upload, install on Front,
replane to Right and backup creation against a local Onshape stub. This is
separate from the live Onshape acceptance linked above.

## Distribution status

The final Windows x64 build also passed the expanded binary smoke on Windows
Node 24.14.1, staged through PowerShell with no credentials copied. Its copied
binary SHA256 matched the Windows source. Linux used Node 24.15.0. Both release
archives contain only the executable, release guide and license; checksums are
in `dist/release-0.2.0/SHA256SUMS`. Windows is unsigned. macOS has not been built
locally. No external publication destination has been established.
The model-specific visual calibration limitations remain documented in
[VERIFICATION.md](VERIFICATION.md); the healthy suppression gap is closed.

No credentials or live Onshape calls were used in the defensive review. Its
regression checks used local test servers and fixtures.
