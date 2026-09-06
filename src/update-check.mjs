import { VERSION } from './version.mjs';

const DEFAULT_TIMEOUT_MS = 3000;

/**
 * Expected response shape from UPDATE_CHECK_URL: a small static JSON document
 * — `{ "version": "0.3.0", "url": "https://github.com/<owner>/<repo>/releases/tag/v0.3.0" }`
 * — published wherever the maintainer likes (a GitHub raw file, a static
 * site, anything reachable with a plain GET). This is deliberately not the
 * GitHub Releases API's own shape: a fixed, documented two-field contract is
 * easier for a maintainer to host and keep correct than depending on this
 * app knowing how to parse GitHub's response.
 *
 * One-shot and memory-cached for the process lifetime: never auto-downloads
 * or auto-executes anything, and is entirely offline-safe — a missing
 * UPDATE_CHECK_URL, a timeout, a non-200, or malformed JSON all resolve to
 * `{ disabled: true }` rather than throwing, since a calibration tool must
 * never block or warn about being offline.
 *
 * The configured `url` is expected to already be an absolute http(s) URL or
 * empty string — src/config.mjs validates UPDATE_CHECK_URL at boot and
 * warns-and-empties anything else, so this module does not repeat that check
 * for the configured value. The feed's own `url` field is a different story:
 * it comes from a remote, unauthenticated document, so it is validated here
 * too — a javascript:, data:, or file: scheme, a protocol-relative //host,
 * or a relative path all fall back to the configured feed URL, the same as
 * a response that omits the field entirely.
 */
function isAbsoluteHttpUrl(value) {
  if (typeof value !== 'string' || !value) return false;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}

export function createUpdateChecker({
  url,
  currentVersion = VERSION,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  let cached;

  async function run() {
    if (!url) return { disabled: true };
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) return { disabled: true };
      const body = await response.json();
      if (typeof body?.version !== 'string' || !body.version) return { disabled: true };
      return {
        current: currentVersion,
        latest: body.version,
        url: isAbsoluteHttpUrl(body.url) ? body.url : url
      };
    } catch {
      // Offline, DNS failure, timeout, non-JSON body — all the same verdict.
      return { disabled: true };
    }
  }

  return {
    // Checked once per process start and cached for its lifetime, never
    // polled on an interval: unauthenticated checks against a maintainer's
    // static host have no reason to repeat, and a long-running server should
    // not keep making a background request nobody asked it to repeat.
    check() {
      if (!cached) cached = run();
      return cached;
    }
  };
}
