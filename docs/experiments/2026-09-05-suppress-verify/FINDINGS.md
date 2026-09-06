# Live suppression verification

Run: 2026-09-05T15:35:11.429Z

| Field | Value |
| --- | --- |
| Document id | `a11ce0000000000000000007` |
| Workspace id | `a11ce0000000000000000044` |
| Part Studio element id | `a11ce0000000000000000135` |
| Part Studio URL | https://cad.onshape.com/documents/a11ce0000000000000000007/w/a11ce0000000000000000044/e/a11ce0000000000000000135 |
| Document visibility | PUBLIC |
| Native item | `native:FRS8YirWVn4peOr_0:referenceAlignVerifyImage` |
| Duplicates found | Reference image sketch (exact, blob-element) |

Each suppression step ran through the product’s own route handler in
`src/install-routes.mjs`. Captures live beside this file as `NN-<name>.json`,
redacted of email-like strings and owner records.

| Step | HTTP | featureStatus | Error |
| --- | --- | --- | --- |
| upload-image | 200 | — | — |
| install | 200 | OK | — |
| create-native-sketch | 200 | ERROR | — |
| suppress-unconfirmed | 400 | — | CONFIRM_REQUIRED |
| suppress | 200 | OK | — |
| suppress-again | 200 | — | — |
| unsuppress | 200 | ERROR | — |

`suppress-unconfirmed` is expected to fail with HTTP 400 CONFIRM_REQUIRED:
suppression is confirmed every time, whatever the confirm-before-write
setting says.

DELETE is not attempted: this account’s key has no delete scope, so the
scratch document and its elements are left in place on purpose.
