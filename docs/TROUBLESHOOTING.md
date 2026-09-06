# Troubleshooting

## The right panel says there is no Part Studio context

Check the extension action URL. The supported shape is:

```text
https://YOUR-HOST/?documentId={$documentId}&workspaceId={$workspaceOrVersionId}&elementId={$elementId}
```

For manual localhost testing, copy document, workspace, and element IDs from the Onshape URL, or paste the Part Studio URL into the box at the top of the Onshape target card.

## The Set up Onshape wizard says it is unavailable

The wizard only runs from the same machine as the server, over a direct connection with no proxy in front of it. It refuses when:

- the server's `PUBLIC_BASE_URL` is `https://` (a public deployment),
- `HOST` is not a loopback address,
- the request arrived through a proxy (any `X-Forwarded-*` or `Forwarded` header is present),
- or the request did not originate from the browser on this machine.

In any of those cases, set `ONSHAPE_ACCESS_KEY` and `ONSHAPE_SECRET_KEY` directly in the server's configuration file instead — its resolved path is printed in the startup log as `Config: <path> (<source>)` — then restart the server. See "Which file is read" in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#which-file-is-read).

## The Onshape badge says the key was rejected, or Onshape is unreachable

Press the badge to reopen the wizard; the failure message names the likely cause (a wrong or incomplete key, a wrong Onshape address for an enterprise stack, or a network/firewall problem). Pressing **Test connection** again re-probes live — it never reuses a stale result. **Refresh** on the target card stays enabled through a transient failure, so retrying does not require reopening the wizard.

## Install into this document is disabled

The reason is printed under the button. The ones that need action elsewhere:

- **"Key lacks write scope…"** — the API key was created without **Write
  documents**. Onshape cannot add a permission to an existing key; create a new
  one at [dev-portal.onshape.com/keys](https://dev-portal.onshape.com/keys)
  with both **Read documents** and **Write documents** ticked, then paste it
  through the **Set up Onshape** wizard.
- **"…is turned off. Switch on …"** — the key can do it, but the matching
  switch in **What this app is allowed to do** is off. Open that card at the
  bottom of the right column and turn it back on.
- **"This is a read-only version or microversion link."** — the URL you pasted
  has `/v/` or `/m/` in it. Open the same tab from the document's workspace and
  paste the address with `/w/` in it.
- **"This document already has a Calibrated Reference Image feature."** — there
  is nothing to install. Choose it under **Target**.

## Onshape reported the new feature as ERROR

The install, rebind, and suppress routes check Onshape's own `featureState.featureStatus`
on every write, because HTTP 200 does not mean the feature works: Onshape
stores an image reference it cannot resolve without complaint and then reports
the feature as `ERROR`.

When you see this, the write did land — the feature exists, and it is broken.
Open the Part Studio, delete the errored feature, and try again. If it happens
twice:

- Confirm the image tab still exists in the document. An image deleted after
  it was listed leaves a reference that cannot resolve.
- Confirm the Feature Studio compiled. Open it in Onshape; a FeatureScript
  error there makes every instance of the feature fail.
- Check the capture in the backup file named in the response. It holds the
  exact request that was sent, including the `namespace` strings.

The one namespace form Onshape resolves is `e<elementId>::m<microversionId>`,
with both ids present. A bare `e<elementId>`, or a full
`d…::w…::e…::m…`, is stored and then fails. This app builds only the working
form and refuses anything else before sending it.

## The image upload is refused

- **"That file is not a PNG, JPEG, GIF, or WebP image."** — the file's leading
  bytes do not match any of those formats. The browser's own label is ignored
  on purpose: it is a claim, not evidence. Re-export the file.
- **"That image is N MB. The limit is 25.0 MB."** — resize it, or raise
  `MAX_IMAGE_UPLOAD_BYTES` in the configuration file. The calibration only
  needs the pixels you are going to click; a downscaled copy is fine as long as
  you calibrate against the same copy you place.
- **"…needs an explicit confirmation."** — the request reached the server
  without a confirmation while **Confirm before every write** is on. In the
  browser this means the confirmation dialog was dismissed. Press the button
  again and accept.

## The offer to suppress a duplicate sketch did not appear

It appears under the result after a successful Apply, and only when the panel
has evidence that a native sketch shows the same image. It stays away when:

- the applied target and the sketch are bound to different image tabs, or their
  proportions disagree — that is positive evidence they are different pictures;
- the sketch is already suppressed. Select it under **Target** and the card
  offers **Unsuppress this sketch** instead;
- the Part Studio has no native Insert image sketch at all.

**Suppress** and **Unsuppress** are refused, with the reason printed under the
button, for the same reasons every other write is: a read-only `/v/` or `/m/`
link, an unconfigured connection, a key without **Write documents**, or the
**Suppress features** switch turned off in **What this app is allowed to do**.

Suppression is confirmed every time, even with **Confirm before every write**
turned off. A request that arrives without that confirmation is refused with
`CONFIRM_REQUIRED`.

## Unsuppressing a sketch reports it as ERROR

The sketch is back — the change was stored — and Onshape cannot regenerate it.
That is almost always a fault the sketch already had before it was hidden:
a suppressed feature does not regenerate, so it reports `OK` regardless.
Open it in Onshape and fix it there. Suppressing it again will hide the error,
not the cause.

## An Onshape write returns 403

A 403 is ambiguous: it means either that the key lacks the scope, or that this
account cannot edit that particular document. The app records it against your
session and says both, so the next press explains itself before it is made.
The record expires after fifteen minutes, clears on the next success, and is
dropped entirely when the credentials change.

If the key is right, check that you can edit the document in Onshape itself
while signed in as the account that created the key.

## No calibrated features appear

- Confirm the Part Studio contains a **Calibrated Reference Image** instance.
- Confirm the server has Onshape document read permission.
- Refresh after OAuth authorization.
- Check server logs for a REST error.
- Verify `ONSHAPE_BASE_URL` matches the user's Onshape stack.

## The selected Onshape image cannot load in the panel

Onshape's serialized `ImageData` reference can vary. Load the original local image instead. Calibration remains valid as long as the raster is exactly the same width, height, crop, and orientation as the image used by the feature.

## Apply stays disabled

Apply requires all of the following:

- a complete workspace context,
- a selected writable target,
- both scale points,
- both rotation points when using a separate pair,
- a positive true distance,
- a successful preview of the current inputs.

The panel now prints the specific blocking reason directly under the Apply button, so this list should only be a backstop.

A `/v/` (version) or `/m/` (microversion) link is read-only: Apply is disabled with a message naming the `/w/` workspace link. Paste the workspace address (the one with `/w/` in it) instead.

Changing a pick, distance, mode, or anchor intentionally invalidates the previous preview.

## The image appears mirrored, upside down, or rotated the wrong way

First confirm the same unmodified source raster is loaded in both places. Then verify the FeatureScript convention:

- origin is lower-left,
- angle is counterclockwise from sketch +X,
- browser pixel +Y points downward and is inverted by the app.

A wrong result here most likely means the FeatureScript's custom plane orientation differs on the selected entity. Reproduce it on a default Top/Front/Right plane and compare before using an arbitrary imported planar face.

## The image does not redraw immediately after Apply

Refresh or regenerate the Part Studio. The update response may complete before the browser redraws the custom sketch image.

## OAuth keeps returning to a blank standalone page

The callback redirects to the saved local return path. Close that tab, return to the Onshape panel, and press Refresh. For production, keep the app and OAuth callback on the same HTTPS host.

## An Onshape update fails after an API release

The feature API exposes internal feature definitions, and parameter encoding can change. Inspect the current feature with `GET .../features`, compare it to the backup JSON, and update the adapter. Set `ONSHAPE_API_VERSION` explicitly; this package defaults to `v17`.
