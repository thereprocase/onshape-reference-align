# Live install/rebind verification

Run: 2026-09-05T15:35:05.015Z

| Field | Value |
| --- | --- |
| Document id | `a11ce0000000000000000034` |
| Workspace id | `a11ce0000000000000000043` |
| Part Studio element id | `a11ce0000000000000000020` |
| Part Studio URL | https://cad.onshape.com/documents/a11ce0000000000000000034/w/a11ce0000000000000000043/e/a11ce0000000000000000020 |
| Document visibility | PUBLIC |

Each step ran through the product’s own route handler in
`src/install-routes.mjs`. Captures live beside this file as `NN-<name>.json`,
redacted of email-like strings and owner records.

| Step | HTTP | featureStatus | Error |
| --- | --- | --- | --- |
| install-status-before | 200 | — | — |
| upload-image-a | 200 | — | — |
| install | 200 | OK | — |
| install-status-after | 200 | — | — |
| install-again | 200 | — | — |
| upload-image-b | 200 | — | — |
| rebind | 200 | OK | — |
| install-status-final | 200 | — | — |

DELETE is not attempted: this account’s key has no delete scope, so the
scratch document and its elements are left in place on purpose.
