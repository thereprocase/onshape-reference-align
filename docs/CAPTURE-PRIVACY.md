# Public capture identifiers

This public source snapshot retains the recorded Onshape payload shapes and
acceptance results used by the offline tests. Live 24-character document,
workspace, element, microversion, folder and related identifiers have been
consistently pseudonymized, including references embedded in namespaces and
capture filenames. Identifiers beginning `a11ce` followed by 19 decimal digits
are reserved public examples. Ownership and nested personal-name metadata are
redacted as well.

Recorded document links therefore do not lead to the original documents, and
copied example commands cannot target those documents. These are historical
evidence and test fixtures, not credentials or reusable live resources.
Synthetic test identifiers and cryptographic checksums are not rewritten.

Live verification still requires explicit `--yes` and an explicit target.
To create a new scratch document, enable scratch creation and configure your
own scratch folder in Settings first. There is no personal default folder.
The scripts refuse reserved example and all-zero target identifiers. An
existing target must be supplied explicitly with `--document-id`; use only a
disposable document, since these scripts perform real writes. Where supported,
Onshape free-account rejection of a private scratch document may trigger the
documented public-scratch fallback; only repository sample assets are uploaded.

The public snapshot has no private development history. Captures from any new
live run should be reviewed and sanitized before committing or sharing them.
