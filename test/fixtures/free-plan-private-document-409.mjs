// Source: docs/experiments/2026-09-04-bind-experiment/01-create-document-private.json
// (live run, 2026-09-05). Copied verbatim. This is the only direct evidence
// the project has of a plan limit: a Free account cannot create a private
// document, and Onshape says so with a 409 rather than a 403, which is why
// plan.canCreatePrivateDocuments is a separate field from any scope flag.

export const FREE_PLAN_PRIVATE_DOCUMENT_409 = Object.freeze(
  {
    "name": "create-document-private",
    "method": "POST",
    "path": "/documents",
    "note": null,
    "requestBody": {
      "name": "Reference Align scratch — safe to delete",
      "isPublic": false
    },
    "status": 409,
    "error": {
      "message": "Onshape API request failed with 409 Conflict.",
      "body": {
        "message": "Free accounts only allow access to public documents. Upgrade your account to get full access to private documents.",
        "moreInfoUrl": "",
        "status": 409,
        "code": 0
      }
    }
  }
);
