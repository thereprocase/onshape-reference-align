// Source: the live GET /users/sessioninfo response observed on 2026-09-05 with
// this project's own API key, during the write-shape experiment recorded in
// docs/experiments/2026-09-04-bind-experiment/FINDINGS.md. That run wrote no
// sessioninfo capture file, so the load-bearing fields are transcribed here.
//
// The four fields the capability model reads (oauth2Scopes, planGroup, roles,
// companyPlan) are the observed values. `name` and `id` are placeholders: the
// real ones identify the maintainer's account and are not needed by any
// assertion. `email` is in the real response and is deliberately absent here —
// test/capabilities.test.mjs adds it back explicitly to prove pickSessionInfo
// drops it.

export const LIVE_SESSIONINFO = Object.freeze({
  name: 'Reference Align Test Account',
  id: '000000000000000000000000',
  oauth2Scopes: 4099,
  planGroup: 'Free',
  roles: Object.freeze(['USER', 'DEVELOPER']),
  companyPlan: false
});
