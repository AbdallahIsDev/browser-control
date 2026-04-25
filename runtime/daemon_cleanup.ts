/**
 * Shared daemon, terminal session, and browser cleanup helpers.
 *
 * Used by both the CLI (`cli.ts`) and test helpers (`test_daemon_helpers.ts`).
 *
 * On Windows, `process.kill(pid, "SIGTERM")` does NOT kill child
 * processes (orphaned pwsh.exe shells). We use `taskkill /T /F` instead,
 * which kills the entire process tree.
 *
 * Cleanup order:
 *   1. Ask the daemon to serialize terminal state via broker API
 *   2. Kill the automation browser (Chrome) if Browser Control launched one
 *   3. Kill the daemon process tree
 *   4. Remove stale PID and status files
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getDataHome } from "../shared/paths";

// ── PID / process helpers ───────────────────────────────────────────

/**
 * Check whether a specific PID is still alive.
 */
export function isPidAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  if (process.platform === "win32") {
    try {
      const output = execSync(
        `tasklist /FI "PID eq ${pid}" /FO CSV /NH 2>nul`,
        { encoding: "utf8", timeout: 5000 },
      );
      return output.includes(`"${pid}"`);
    } catch {
      return false;
    }
  } else {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Kill a process tree by PID.
 * On Windows, uses `taskkill /T /F` which kills the entire tree.
 * On POSIX, uses SIGTERM which propagates to the process group.
 *
 * If the process is already gone, silently succeeds.
 * If taskkill fails for a real reason ("access denied"), verifies
 * the PID is actually dead before swallowing the error.
 */
export function killProcessTree(pid: number): void {
  if (!pid || pid <= 0) return;

  try {
    if (process.platform === "win32") {
      try {
        execSync(`taskkill /T /F /PID ${pid}`, { stdio: "ignore" });
      } catch (tkErr) {
        // taskkill returns non-zero when the process is already gone.
        // But it can also fail for real reasons like "access denied."
        // Verify the PID is actually dead before swallowing the error.
        let processStillAlive = false;
        try {
          const checkOutput = execSync(
            `tasklist /FI "PID eq ${pid}" /FO CSV /NH 2>nul`,
            { encoding: "utf8", timeout: 5000 },
          );
          if (checkOutput.includes(`"${pid}"`)) {
            processStillAlive = true;
          }
        } catch { /* tasklist failed — assume process is gone */ }
        if (processStillAlive) {
          console.warn(
            `[daemon_cleanup] taskkill failed and PID ${pid} is still alive ` +
            `(access denied?). Manual cleanup may be needed.`,
          );
        }
      }
    } else {
      process.kill(pid, "SIGTERM");
    }
  } catch { /* process may already be gone */ }
}

// ── Automation browser cleanup ───────────────────────────────────────

/**
 * Kill the Browser Control automation Chrome process if it's running.
 *
 * Browser Control's managed Chrome is identifiable by:
 *   - `--remote-debugging-port=<port>` (default 9222 or BROWSER_DEBUG_PORT)
 *   - `--user-data-dir=.../.browser-control/profiles/<profile-id>`
 *
 * We find Chrome processes whose command lines contain both
 * `"--remote-debugging-port"` AND `".browser-control"` to avoid killing
 * unrelated user Chrome instances.
 *
 * @param homeDir Optional Browser Control data home. Used to further
 *   scope matching to a specific test environment. When omitted, matches
 *   any Browser Control Chrome (suitable for `bc daemon stop`).
 */
export function killAutomationBrowser(homeDir?: string): void {
  if (process.platform !== "win32") return;

  try {
    const output = execSync(
      `wmic process where "name='chrome.exe'" get processid,commandline /format:csv 2>nul`,
      { encoding: "utf8", timeout: 10000 },
    );

    for (const line of output.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const lowerLine = trimmed.toLowerCase();
      const hasDebugPort = lowerLine.includes("--remote-debugging-port");
      const hasBcHome = lowerLine.includes(".browser-control");

      if (hasDebugPort && hasBcHome) {
        // If a specific homeDir is given, further verify the command line
        // contains that path (forward or backslash).
        if (homeDir) {
          const normalizedHome = homeDir.replace(/\\/g, "/").toLowerCase();
          const homeSegment = normalizedHome.split("/").pop() ?? ".browser-control";
          // Check for the specific home path or at least the segment
          if (!lowerLine.includes(normalizedHome) &&
              !lowerLine.includes(homeSegment) &&
              !lowerLine.includes(homeDir.toLowerCase())) {
            continue;
          }
        }

        // Extract the PID — it's the last CSV field
        const fields = trimmed.split(",");
        const pidStr = fields[fields.length - 1]?.trim();
        const pid = Number(pidStr);
        if (!isNaN(pid) && pid > 0) {
          try {
            execSync(`taskkill /T /F /PID ${pid}`, { stdio: "ignore" });
          } catch { /* already gone */ }
        }
      }
    }
  } catch {
    // WMIC may fail or not be available — best-effort
  }
}

// ── Stale file cleanup ───────────────────────────────────────────────

/**
 * Remove stale daemon PID and/or status files if the daemon is gone.
 *
 * When the daemon is force-killed (`taskkill /T /F`), it never gets to
 * run its `stop()` method, so `daemon.pid` and `daemon-status.json` may
 * remain on disk with stale data.  This function:
 *   - If `daemon.pid` exists and the PID is dead, removes both files
 *   - If `daemon.pid` doesn't exist but `daemon-status.json` shows
 *     `"running"`, removes the stale status file
 *   - Removes corrupt/unparseable status files
 *
 * @param homeDir Optional Browser Control data home. When omitted, uses
 *   the default from `getDataHome()` / `BROWSER_CONTROL_HOME`.
 */
export function cleanupStaleDaemonFiles(homeDir?: string): void {
  const dataHome = homeDir ?? getDataHome();
  const interopDir = path.join(dataHome, ".interop");
  const pidFile = path.join(interopDir, "daemon.pid");
  const statusFile = path.join(interopDir, "daemon-status.json");

  // Case 1: PID file exists but daemon is dead
  if (fs.existsSync(pidFile)) {
    const pid = Number(fs.readFileSync(pidFile, "utf8").trim());
    if (isNaN(pid) || pid <= 0 || !isPidAlive(pid)) {
      try { fs.unlinkSync(pidFile); } catch { /* best-effort */ }
      try { fs.unlinkSync(statusFile); } catch { /* best-effort */ }
    }
  }

  // Case 2: No PID file but status file claims "running" — stale
  if (!fs.existsSync(pidFile) && fs.existsSync(statusFile)) {
    try {
      const content = fs.readFileSync(statusFile, "utf8");
      const record = JSON.parse(content) as { status?: string; pid?: number };
      if (record.status === "running") {
        const pid = Number(record.pid ?? 0);
        if (isNaN(pid) || pid <= 0 || !isPidAlive(pid)) {
          try { fs.unlinkSync(statusFile); } catch { /* best-effort */ }
        }
      }
    } catch {
      // Corrupt status file — remove it
      try { fs.unlinkSync(statusFile); } catch { /* best-effort */ }
    }
  }
}

// ── Main cleanup function ────────────────────────────────────────────

/**
 * Stop a Browser Control daemon and clean up all associated resources.
 *
 * Steps:
 *   1. Ask the daemon to serialize terminal sessions via the broker API
 *   2. Kill the automation browser (Chrome) if Browser Control launched one
 *   3. Kill the daemon process tree via `taskkill /T /F` (Windows) or
 *      SIGTERM (POSIX)
 *   4. Remove stale PID and status files
 *
 * @param options
 * @param options.homeDir Browser Control data home directory.
 *   Defaults to `getDataHome()` / `BROWSER_CONTROL_HOME`.
 * @param options.port Broker port. Defaults to `loadConfig().brokerPort`.
 */
export async function stopDaemon(options: {
  homeDir?: string;
  port?: number;
} = {}): Promise<void> {
  const { loadConfig } = await import("../shared/config");
  const { stopWslBridge } = await import("../scripts/launch_browser");
  const config = loadConfig({ validate: false });
  const homeDir = options.homeDir ?? getDataHome();
  const port = options.port ?? config.brokerPort;
  const brokerUrl = `http://127.0.0.1:${port}`;

  // Step 1: Let the daemon run its terminal serialization path before
  // the process tree is force-killed. Do not close sessions here: closing
  // first would erase the state Section 13 needs to persist.
  try {
    await fetch(`${brokerUrl}/api/v1/kill`, {
      method: "POST",
      signal: AbortSignal.timeout(5000),
    });
  } catch { /* daemon not reachable — fine */ }

  // Step 2: Kill the automation browser if Browser Control launched one
  try {
    killAutomationBrowser(homeDir);
  } catch { /* best-effort */ }
  try {
    stopWslBridge(config.chromeDebugPort);
  } catch { /* best-effort */ }

  // Step 3: Kill the daemon process tree via PID file
  const pidFile = path.join(homeDir, ".interop", "daemon.pid");
  try {
    if (fs.existsSync(pidFile)) {
      const pid = Number(fs.readFileSync(pidFile, "utf8").trim());
      if (!isNaN(pid) && pid > 0) {
        killProcessTree(pid);
      }
      try { fs.unlinkSync(pidFile); } catch { /* best-effort */ }
    }
  } catch { /* best-effort */ }

  // Step 4: Remove stale PID and status files
  try {
    cleanupStaleDaemonFiles(homeDir);
  } catch { /* best-effort */ }
}
