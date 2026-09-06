# Onshape setup

## 1. Create the calibrated image feature

### One press from the panel (primary path)

Start the server, connect Onshape (section 2), and paste your Part Studio URL
into the Onshape target card. The card reports what the document already has.
Press **Install into this document** and the server creates a Feature Studio
named "Reference Align Features" holding `featurescript/ReferenceImage.fs`,
adds a **Calibrated Reference Image** instance on the selected Plane (Top by
default), and selects it. Choose an existing image tab or load a local image
before pressing Install.

It needs a key with **Write documents**, and the **Install the Reference Image
feature** switch left on. If either is missing the button says so rather than
failing on the press. A document that already has the feature is left alone.

The image the new feature points at is either an image tab already in the
document, or the image loaded in the browser, which is uploaded first. After
installing, **Upload the local image and use it** re-points the selected
feature at a different, freshly uploaded image — not at anything chosen in
the picker above it.

### By hand (fallback)

Use this for a document the server cannot write to, for a shared custom-feature
library, or when you would rather read the source before it goes in.

1. Create a new Onshape document for the tool, or add a **Feature Studio** tab to a test document.
2. Open `featurescript/ReferenceImage.fs` from this package.
3. Replace the Feature Studio contents with that file and commit the Feature Studio.
4. In a Part Studio in the same workspace, open **Custom features in this workspace** and choose **Calibrated Reference Image**.
5. Select:
   - an uploaded image,
   - a planar face or reference plane,
   - any initial positive width,
   - `0 deg`, `0 m`, and `0 m` for the remaining placement values.
6. Confirm that the image appears.

To reuse the feature in other documents, create a version of the FeatureScript document, then use **Add custom features** from the Part Studio toolbar and select that version.

Keep the `// reference-align-feature: 1` marker line near the top of the file.
That exact token is how the panel tells "this document already has our Feature
Studio" from "this document has a Feature Studio". Without it the panel reports
the document as not installed and offers to add a second copy.

### Placement convention

Reference Align and the FeatureScript agree on this convention:

- `Origin X/Y`: lower-left image corner in canonical sketch coordinates of the selected plane.
- `Image width`: physical width of the full raster.
- `Image angle`: counterclockwise rotation from canonical sketch +X.
- Pixel coordinates in the app: `(0,0)` at the raster's upper-left, as browsers normally report them.

The FeatureScript builds a custom sketch plane whose origin and x-axis carry the requested translation and rotation, then inserts the image axis-aligned in that custom plane.

## 2. Choose authentication

### Browser wizard (primary path)

Start the server (`npm start`) and open it in a browser on the same machine. Press the **Set up Onshape** badge at the top of the page. The wizard walks through creating an API key at [dev-portal.onshape.com/keys](https://dev-portal.onshape.com/keys) with **Read documents** and **Write documents** ticked, tests the key against Onshape before anything is written, and then saves it to the server's configuration file. This takes effect immediately, with no restart.

The wizard writes signed API-key credentials (`ONSHAPE_AUTH=api-key-signature`) only — never OAuth or bearer settings, and never `HOST`/`PORT`/`PUBLIC_BASE_URL`/`SESSION_SECRET`. It also refuses to run anywhere except from the server's own machine: it checks the request came over loopback with no proxy in front of it, so a remote or hosted deployment cannot be configured this way. For those cases, or for scripted setup, use the env file directly instead.

The configuration file it writes to is resolved the same way regardless of how the server was started — see "Which file is read" in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#which-file-is-read) — and the resolved path is always shown in the wizard and printed at startup. On Windows, the file's mode bits are advisory; the real protection is the ACL on its containing directory (`%APPDATA%\onshape-reference-align` by default).

### Personal/local test: API key with Basic authorization (env file, headless alternative)

Use a dedicated Onshape API key with only the permissions needed for the test account/document. Onshape classifies Basic API-key authorization as local-test-only.

```dotenv
ONSHAPE_AUTH=api-key
ONSHAPE_ACCESS_KEY=...
ONSHAPE_SECRET_KEY=...
```

Keep `.env` out of source control. API-key operations execute as the user who created the key.


### Private/internal service: signed API key

Use the same access and secret keys, but select the HMAC request-signature mode:

```dotenv
ONSHAPE_AUTH=api-key-signature
ONSHAPE_ACCESS_KEY=...
ONSHAPE_SECRET_KEY=...
```

The server generates a unique nonce and UTC date, signs method/content type/path/query for each request, and signs each redirect target again. Keep the service private and keep the key pair server-side.

### Shared/team deployment: OAuth

Create an OAuth application in Onshape Developer settings and grant document read/write permissions.

```dotenv
ONSHAPE_AUTH=oauth
ONSHAPE_OAUTH_CLIENT_ID=...
ONSHAPE_OAUTH_CLIENT_SECRET=...
ONSHAPE_OAUTH_CALLBACK_URL=https://reference-align.example.com/oauth/callback
PUBLIC_BASE_URL=https://reference-align.example.com
```

The redirect URL must match the registered OAuth callback exactly. The production host must use HTTPS so the embedded iframe can use a `Secure; SameSite=None` session cookie.

### Enterprise/private stack

Set the same stack origin that users open in their browser:

```dotenv
ONSHAPE_BASE_URL=https://YOUR-STACK.onshape.com
```

The server uses that origin for both REST requests and its iframe `frame-ancestors` policy.

## 3. Register the right-panel extension

In **Developer → Extensions**, add an extension with:

```text
Name: Reference Align
Location: Element right panel
Context: Inside part studio
Action URL: https://YOUR-HOST/?documentId={$documentId}&workspaceId={$workspaceOrVersionId}&elementId={$elementId}
```

Upload `public/reference-align-icon.png` as the extension icon. The source SVG is included beside it.

For a simple localhost developer test, Onshape's current extension tutorial permits an HTTP localhost action URL. A real deployment should use HTTPS.

## 4. Start the server

Bare Node:

```bash
npm test
npm start
```

Then open `http://127.0.0.1:8787/` and use the **Set up Onshape** wizard described in step 2 — this is the primary path and needs no pre-existing `.env`. To configure credentials before ever opening a browser (a headless box, a scripted deployment), copy `.env.example` to the resolved config path instead and edit it directly:

```bash
cp .env.example .env
# edit .env
```

Docker:

```bash
docker build -t onshape-reference-align .
docker run --rm -p 8787:8787 --env-file .env -e HOST=0.0.0.0 \
  -v "$PWD/backups:/app/backups" \
  onshape-reference-align
```

The explicit HOST override is required when `.env` was copied from the local
template: a loopback-only listener inside a container cannot serve its published
port. Configure credentials in the env file; the browser wizard is unavailable
through the normal Docker bridge connection.

## 5. First live calibration

1. Make a disposable copy of the Onshape document.
2. Open the Part Studio and open the Reference Align right panel.
3. Authorize the app when using OAuth.
4. Select the **calibrated feature**, not a native sketch image.
5. Click **Load selected Onshape image**. When the serialized image reference is unavailable, use **Load local image** and choose the exact same source raster.
6. Pick `S1` and `S2`; enter their true distance.
7. Keep **Use S1 → S2 for rotation**, or disable it and pick `R1` and `R2`.
8. Choose horizontal, vertical, nearest axis, custom angle, or keep current orientation.
9. Choose the anchor pixel that must stay fixed.
10. Preview and inspect:
    - calculated image width,
    - angle,
    - scale factor,
    - anchor residual.
11. Apply. The server writes a backup before sending the feature update.
12. Regenerate/reload the Part Studio if the image does not redraw immediately.

## Native `Insert image` compatibility mode

Reference Align can recognize native sketch-image entities when Onshape exposes them in the feature list. Writing those entities is intentionally disabled:

```dotenv
ENABLE_NATIVE_IMAGE_WRITE=false
```

Turning it on makes the server mutate internal fields such as `originX`, `originY`, `xaxisX`, and `xaxisY`. Onshape documents its feature API as an internal representation whose fields may change. Only test this switch in an expendable document copy.
