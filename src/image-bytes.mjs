// What an uploaded file actually is, decided from its bytes.
//
// The browser's Content-Type on a multipart part is whatever the client chose
// to send. It is a hint about intent, never evidence about content, so the
// allow-list here is checked against the leading bytes and the client's header
// is only used to notice a disagreement worth reporting.
//
// Pure: no fs, no network. The route reads the bytes; this decides about them.

/** 25 MB. Overridable per install through MAX_IMAGE_UPLOAD_BYTES. */
export const DEFAULT_MAX_IMAGE_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * The image formats this app will hand to Onshape, and the leading bytes that
 * identify each one.
 *
 * `offset` exists for WebP, whose signature is split: "RIFF" at 0, a four-byte
 * length, then "WEBP" at 8. Both fragments have to match, or a RIFF container
 * holding audio would pass as an image.
 */
export const IMAGE_SIGNATURES = Object.freeze([
  Object.freeze({
    mediaType: 'image/png',
    extension: '.png',
    fragments: Object.freeze([Object.freeze({ offset: 0, bytes: Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) })])
  }),
  Object.freeze({
    mediaType: 'image/jpeg',
    extension: '.jpg',
    fragments: Object.freeze([Object.freeze({ offset: 0, bytes: Object.freeze([0xff, 0xd8, 0xff]) })])
  }),
  Object.freeze({
    mediaType: 'image/gif',
    extension: '.gif',
    fragments: Object.freeze([Object.freeze({ offset: 0, bytes: Object.freeze([0x47, 0x49, 0x46, 0x38]) })])
  }),
  Object.freeze({
    mediaType: 'image/webp',
    extension: '.webp',
    fragments: Object.freeze([
      Object.freeze({ offset: 0, bytes: Object.freeze([0x52, 0x49, 0x46, 0x46]) }),
      Object.freeze({ offset: 8, bytes: Object.freeze([0x57, 0x45, 0x42, 0x50]) })
    ])
  })
]);

export const ALLOWED_IMAGE_TYPES = Object.freeze(IMAGE_SIGNATURES.map((signature) => signature.mediaType));

function matches(bytes, fragment) {
  if (bytes.length < fragment.offset + fragment.bytes.length) return false;
  for (let index = 0; index < fragment.bytes.length; index += 1) {
    if (bytes[fragment.offset + index] !== fragment.bytes[index]) return false;
  }
  return true;
}

/**
 * The media type of these bytes, or undefined if they are not an image this
 * app will upload. Undefined is the answer for an empty buffer too: nothing is
 * not a PNG.
 */
export function sniffImageType(bytes) {
  if (!bytes || typeof bytes.length !== 'number') return undefined;
  for (const signature of IMAGE_SIGNATURES) {
    if (signature.fragments.every((fragment) => matches(bytes, fragment))) return signature.mediaType;
  }
  return undefined;
}

function extensionFor(mediaType) {
  return IMAGE_SIGNATURES.find((signature) => signature.mediaType === mediaType)?.extension || '';
}

/**
 * Reduce a client-supplied filename to something safe to put in a multipart
 * body and in an Onshape element name.
 *
 * Directory separators and control characters go first (a name is not a path),
 * then the stem is capped. The extension is always rewritten from the sniffed
 * type, so a file called "photo.png" that is really a JPEG arrives in Onshape
 * named for what it is.
 */
export function sanitizeUploadFilename(name, mediaType) {
  const raw = String(name ?? '').split(/[\\/]/).pop() || '';
  // Control characters and quotes go before anything else: this string ends up
  // in a multipart Content-Disposition header.
  const cleaned = raw.replace(/[\u0000-\u001f\u007f"]+/g, '').trim();
  const stem = cleaned.replace(/\.[A-Za-z0-9]{1,8}$/, '').replace(/[^A-Za-z0-9 ._-]+/g, '_').slice(0, 80).trim();
  return `${stem || 'reference-image'}${extensionFor(mediaType)}`;
}

/**
 * Decide whether these bytes may be uploaded, and under what name.
 *
 * Returns `{ ok: false, code, message }` rather than throwing so the route can
 * choose the status: every refusal here is the client's to fix, and the
 * message is written to be shown to the person who picked the file.
 */
export function validateImageUpload({ bytes, filename, declaredType, maxBytes = DEFAULT_MAX_IMAGE_UPLOAD_BYTES } = {}) {
  if (!bytes || bytes.length === 0) {
    return { ok: false, code: 'EMPTY_UPLOAD', message: 'No image data was received.' };
  }
  if (bytes.length > maxBytes) {
    return {
      ok: false,
      code: 'IMAGE_TOO_LARGE',
      message: `That image is ${formatBytes(bytes.length)}. The limit is ${formatBytes(maxBytes)} — resize it, or raise MAX_IMAGE_UPLOAD_BYTES in the config file.`
    };
  }
  const mediaType = sniffImageType(bytes);
  if (!mediaType) {
    return {
      ok: false,
      code: 'UNSUPPORTED_IMAGE_TYPE',
      message: `That file is not a PNG, JPEG, GIF, or WebP image. ${describeDeclared(declaredType)}`.trim()
    };
  }
  return {
    ok: true,
    mediaType,
    filename: sanitizeUploadFilename(filename, mediaType),
    // Reported, not enforced: a browser that mislabels a file is worth a line
    // in the response, but the bytes have already been believed over it.
    declaredTypeMismatch: Boolean(declaredType) && declaredType !== mediaType
  };
}

function describeDeclared(declaredType) {
  return declaredType ? `The browser called it ${declaredType}, but the file's own bytes say otherwise.` : '';
}

export function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
