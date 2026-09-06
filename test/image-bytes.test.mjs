import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ALLOWED_IMAGE_TYPES,
  DEFAULT_MAX_IMAGE_UPLOAD_BYTES,
  formatBytes,
  sanitizeUploadFilename,
  sniffImageType,
  validateImageUpload
} from '../src/image-bytes.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Format signatures, not Onshape payloads: these come from the file formats
// themselves, which is why they are written out here rather than captured.
const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const GIF_HEAD = Buffer.from('GIF89a', 'latin1');
const WEBP_HEAD = Buffer.concat([
  Buffer.from('RIFF', 'latin1'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBPVP8 ', 'latin1')
]);

test('a real PNG is recognised from its own bytes', async () => {
  const bytes = await fs.readFile(path.join(root, 'public/reference-align-icon.png'));
  assert.equal(sniffImageType(bytes), 'image/png');
});

test('each allowed format is recognised, and the list matches the signature table', () => {
  assert.deepEqual(ALLOWED_IMAGE_TYPES, ['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
  assert.equal(sniffImageType(JPEG_HEAD), 'image/jpeg');
  assert.equal(sniffImageType(GIF_HEAD), 'image/gif');
  assert.equal(sniffImageType(WEBP_HEAD), 'image/webp');
});

test('a RIFF container that is not WebP is not an image', () => {
  const wav = Buffer.concat([
    Buffer.from('RIFF', 'latin1'),
    Buffer.from([0x24, 0x00, 0x00, 0x00]),
    Buffer.from('WAVEfmt ', 'latin1')
  ]);
  assert.equal(sniffImageType(wav), undefined);
});

test('nothing is not a PNG', () => {
  assert.equal(sniffImageType(Buffer.alloc(0)), undefined);
  assert.equal(sniffImageType(undefined), undefined);
  assert.equal(sniffImageType(Buffer.from([0x89, 0x50])), undefined, 'a truncated signature must not match');
});

// The point of magic-byte detection: a client that says "image/png" is making
// a claim, not supplying evidence.
test('a mislabelled file is judged by its bytes, not its declared type', () => {
  const verdict = validateImageUpload({
    bytes: Buffer.from('<html>not a png</html>', 'utf8'),
    filename: 'photo.png',
    declaredType: 'image/png'
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, 'UNSUPPORTED_IMAGE_TYPE');
  assert.match(verdict.message, /bytes say otherwise/);
});

test('a JPEG announced as a PNG is accepted, renamed, and the disagreement is reported', () => {
  const verdict = validateImageUpload({ bytes: JPEG_HEAD, filename: 'photo.png', declaredType: 'image/png' });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.mediaType, 'image/jpeg');
  assert.equal(verdict.filename, 'photo.jpg');
  assert.equal(verdict.declaredTypeMismatch, true);
});

test('the size cap is enforced on the bytes, and names both numbers', () => {
  const verdict = validateImageUpload({ bytes: Buffer.alloc(2048, 0), filename: 'x.png', maxBytes: 1024 });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, 'IMAGE_TOO_LARGE');
  assert.match(verdict.message, /2\.0 KB/);
  assert.match(verdict.message, /1\.0 KB/);
});

test('a file exactly at the cap is accepted', () => {
  const bytes = Buffer.concat([JPEG_HEAD, Buffer.alloc(1024 - JPEG_HEAD.length, 0)]);
  assert.equal(bytes.length, 1024);
  assert.equal(validateImageUpload({ bytes, filename: 'x.jpg', maxBytes: 1024 }).ok, true);
});

test('an empty upload is refused before anything else', () => {
  const verdict = validateImageUpload({ bytes: Buffer.alloc(0), filename: 'x.png' });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, 'EMPTY_UPLOAD');
});

test('the default cap is 25 MB', () => {
  assert.equal(DEFAULT_MAX_IMAGE_UPLOAD_BYTES, 26_214_400);
  assert.equal(formatBytes(DEFAULT_MAX_IMAGE_UPLOAD_BYTES), '25.0 MB');
});

// This string ends up in a Content-Disposition header and in an Onshape
// element name, so a path, a quote, or a control character in it is not data.
test('a filename is reduced to a name', () => {
  assert.equal(sanitizeUploadFilename('../../etc/passwd', 'image/png'), 'passwd.png');
  assert.equal(sanitizeUploadFilename('C:\\Users\\someone\\Pictures\\plan.png', 'image/png'), 'plan.png');
  assert.equal(sanitizeUploadFilename('sneaky"; name="file', 'image/png'), 'sneaky_ name_file.png');
  assert.equal(sanitizeUploadFilename('line\r\nbreak.png', 'image/png'), 'linebreak.png');
  assert.equal(sanitizeUploadFilename('', 'image/png'), 'reference-image.png');
  assert.equal(sanitizeUploadFilename('   ', 'image/jpeg'), 'reference-image.jpg');
  assert.equal(sanitizeUploadFilename('émoji ✓ name.png', 'image/png'), '_moji _ name.png');
});

test('a very long filename is capped without losing the extension', () => {
  const name = `${'a'.repeat(400)}.png`;
  const result = sanitizeUploadFilename(name, 'image/png');
  assert.equal(result.length, 84);
  assert.ok(result.endsWith('.png'));
});
