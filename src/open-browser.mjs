import { spawn } from 'node:child_process';

/**
 * Whether the first-run flow should try to open a browser: an explicit
 * --open always wins, an explicit --no-open always refuses, and otherwise a
 * real terminal (stdout is a TTY) is treated as an interactive launch worth
 * opening a window for. A background/service launch (stdout redirected to a
 * log file, no TTY) stays silent by default.
 *
 * `node --watch` re-spawns the whole process on every file save, and the
 * listen callback that calls this runs again on each restart — without a
 * guard, editing a file while `npm run dev` is running opens a new tab every
 * save. Node does not put `--watch` back on the restarted process's argv or
 * execArgv (verified: it isn't there), but it does set
 * WATCH_REPORT_DEPENDENCIES=1 on the child so its own dependency tracking can
 * report back over IPC; that env var is the only signal available and is
 * treated here as "this is a watch-mode restart, not a first launch". An
 * explicit --open still overrides it.
 */
export function shouldOpenBrowser({
  argv = process.argv,
  isTTY = process.stdout.isTTY,
  isWatchMode = process.env.WATCH_REPORT_DEPENDENCIES !== undefined
} = {}) {
  if (argv.includes('--no-open')) return false;
  if (argv.includes('--open')) return true;
  return Boolean(isTTY) && !isWatchMode;
}

/**
 * Best-effort default-browser launch, one process per platform.
 *
 * Never throws: a headless session, a missing `xdg-open`, or any other
 * opener failure just means nothing happens, since the bound URL is already
 * printed to stdout regardless of whether this succeeds.
 */
export function openBrowser(url, { platform = process.platform, spawnImpl = spawn } = {}) {
  try {
    let child;
    if (platform === 'win32') {
      // cmd's `start` treats its first quoted argument as a window title, so
      // an empty title has to be passed explicitly or `start` treats the URL
      // itself as the title and never opens it.
      child = spawnImpl('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore', windowsHide: true });
    } else if (platform === 'darwin') {
      child = spawnImpl('open', [url], { detached: true, stdio: 'ignore' });
    } else {
      child = spawnImpl('xdg-open', [url], { detached: true, stdio: 'ignore' });
    }
    // A missing opener binary (e.g. xdg-open on a minimal server image)
    // raises an async 'error' event on the child, not a thrown exception;
    // an unhandled one would crash the whole process over a cosmetic feature.
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}
