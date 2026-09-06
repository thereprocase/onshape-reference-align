# Live suppression verification

Run: 2026-09-06T00:04:33.102Z

| Field | Value |
| --- | --- |
| Document id | `a11ce0000000000000000149` |
| Workspace id | `a11ce0000000000000000063` |
| Part Studio element id | `a11ce0000000000000000083` |
| Part Studio URL | https://cad.onshape.com/documents/a11ce0000000000000000149/w/a11ce0000000000000000063/e/a11ce0000000000000000083 |
| Document visibility | PUBLIC |
| Native item | `native:FPaMbM1W5VfYagB_0:referenceAlignVerifyImage` |
| Duplicates found | Reference image sketch (exact, blob-element) |

Each suppression step ran through the product’s own route handler in
`src/write-routes.mjs`. Captures live beside this file as `NN-<name>.json`,
redacted of email-like strings and owner records.

| Step | HTTP | featureStatus | Error |
| --- | --- | --- | --- |
| upload-image | 200 | — | — |
| install | 200 | OK | — |
| create-native-sketch | 200 | OK | — |
| suppress-unconfirmed | 400 | — | CONFIRM_REQUIRED |
| suppress | 200 | OK | — |
| suppress-again | 200 | — | — |
| unsuppress | 200 | OK | — |

`suppress-unconfirmed` is expected to fail with HTTP 400 CONFIRM_REQUIRED:
suppression is confirmed every time, whatever the confirm-before-write
setting says.

DELETE is not attempted: this account’s key has no delete scope, so the
scratch document and its elements are left in place on purpose.
