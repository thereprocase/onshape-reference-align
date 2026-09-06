// Pure decision logic for the update-availability banner. No DOM, no
// storage, no network — app.js supplies the /api/update result and whatever
// version string it last remembered as dismissed, and this module only
// decides whether to show. Testable with plain node --test, matching the
// pattern in url-context.mjs and connection-state.mjs.

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)/i;

/**
 * Parse a version string into a {major, minor, patch} triple, tolerating a
 * leading "v" (the GitHub tag convention, e.g. "v0.3.0") and ignoring any
 * trailing pre-release/build metadata. Returns undefined for anything that
 * does not start with a recognizable major.minor.patch — a feed value this
 * app cannot parse must never be treated as newer.
 *
 * @param {unknown} raw
 * @returns {{major: number, minor: number, patch: number} | undefined}
 */
export function parseVersion(raw) {
  if (typeof raw !== 'string') return undefined;
  const match = VERSION_PATTERN.exec(raw.trim());
  if (!match) return undefined;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/**
 * True only when `latest` parses as a version strictly greater than
 * `current`. Plain string inequality is not enough — a differently
 * formatted (e.g. "v0.2.0" vs "0.2.0") or genuinely older feed value must
 * never count as an update.
 *
 * @param {unknown} latest
 * @param {unknown} current
 * @returns {boolean}
 */
export function isNewerVersion(latest, current) {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  if (a.major !== b.major) return a.major > b.major;
  if (a.minor !== b.minor) return a.minor > b.minor;
  return a.patch > b.patch;
}

/**
 * Decide whether the update banner should be shown, given the /api/update
 * result and whatever version string was last dismissed (undefined if
 * never dismissed, or read back from storage across reloads).
 *
 * @param {{disabled?: boolean, latest?: string, current?: string}} result
 * @param {string | undefined} dismissedVersion
 * @returns {boolean}
 */
export function shouldShowUpdateBanner(result, dismissedVersion) {
  if (!result || result.disabled) return false;
  if (!isNewerVersion(result.latest, result.current)) return false;
  return result.latest !== dismissedVersion;
}
