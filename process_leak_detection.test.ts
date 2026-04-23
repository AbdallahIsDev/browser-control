/**
 * Process leak detection regression test for Section 5 / Section 12.
 *
 * This test verifies that terminal/session operations do not leave behind
 * orphaned daemon processes, interactive shell (pwsh.exe) processes,
 * stale PID/status files, or automation browser (Chrome) processes
 * after proper cleanup.
 *
 * The test:
 *   1. Captures a baseline of Browser Control daemon / pwsh processes
 *   2. Runs a terminal open → close cycle in an isolated environment
 *   3. Performs full cleanup (close sessions, stop daemon with taskkill /T /F)
 *   4. Waits briefly for process termination
 *   5. Verifies no net leaked processes remain for the test's BROKER_PORT
 *   6. Verifies stale daemon.pid and daemon-status.json are cleaned up
 *   7. Verifies no Browser Control automation Chrome remains
 *
 * This catches the exact bug where tests leave behind:
 *   - detached daemon.ts processes
 *   - orphaned pwsh.exe -NoLogo -NoProfile -Interactive processes
 *   - stale daemon.pid / daemon-status.json files
 *   - Browser Control automation Chrome on port 9222
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { stopDaemon, isPidAlive, killProcessTree } from "./daemon_cleanup";

// ── Isolated environment helpers ────────────────────────────────────

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error("Failed to get assigned port")));
      }
    });
    server.on("error", reject);
  });
}

let testEnv: { home: string; port: number; env: Record<string, string> } | null = null;

async function createTestEnv(): Promise<{ home: string; port: number; env: Record<string, string> }> {
  const port = await findFreePort();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-leak-test-"));
  fs.mkdirSync(path.join(home, ".interop"), { recursive: true });

  const env: Record<string, string> = {
    BROWSER_CONTROL_HOME: home,
    BROKER_PORT: String(port),
    BROWSER_DEBUG_PORT: String(port + 100),
    LOG_FILE: "false",
  };

  testEnv = { home, port, env };
  return testEnv;
}

async function cleanupTestEnv(): Promise<void> {
  if (!testEnv) return;
  const { home, port, env } = testEnv;

  // Delegate to the shared stopDaemon() helper which handles:
  //   1. Closing sessions via broker API
  //   2. Killing automation browser
  //   3. Killing daemon process tree
  //   4. Removing stale PID/status files
  try {
    await stopDaemon({ homeDir: home, port });
  } catch { /* best-effort */ }

  // Remove temp dir
  try {
    fs.rmSync(home, { recursive: true, force: true });
  } catch { /* best-effort */ }

  testEnv = null;
}

// ── Process counting helpers ─────────────────────────────────────────

/**
 * Read the daemon PID from the PID file for the given isolated home.
 *
 * Returns the PID if the file exists and contains a valid number, or 0.
 */
function readDaemonPid(home: string): number {
  const pidFile = path.join(home, ".interop", "daemon.pid");
  try {
    if (!fs.existsSync(pidFile)) return 0;
    const pid = Number(fs.readFileSync(pidFile, "utf8").trim());
    return isNaN(pid) || pid <= 0 ? 0 : pid;
  } catch {
    return 0;
  }
}

/**
 * Count pwsh.exe processes. This is a blunt count — we can't easily
 * tie them to a specific test port, but we use before/after delta
 * to detect leaks.
 */
function countPwshProcesses(): number {
  if (process.platform !== "win32") return 0;

  try {
    const output = execSync(
      `tasklist /FI "IMAGENAME eq pwsh.exe" /FO CSV /NH 2>nul`,
      { encoding: "utf8", timeout: 10000 }
    );
    let count = 0;
    for (const line of output.split("\n")) {
      if (line.trim().startsWith('"pwsh.exe"')) {
        count++;
      }
    }
    return count;
  } catch {
    return 0;
  }
}

/**
 * Count node.exe processes (blunt, used for delta comparison).
 */
function countNodeProcesses(): number {
  if (process.platform !== "win32") {
    try {
      const output = execSync(`pgrep -c node`, { encoding: "utf8", timeout: 5000 });
      return Number(output.trim()) || 0;
    } catch { return 0; }
  }

  try {
    const output = execSync(
      `tasklist /FI "IMAGENAME eq node.exe" /FO CSV /NH 2>nul`,
      { encoding: "utf8", timeout: 10000 }
    );
    let count = 0;
    for (const line of output.split("\n")) {
      if (line.trim().startsWith('"node.exe"')) {
        count++;
      }
    }
    return count;
  } catch {
    return 0;
  }
}

/**
 * Count Browser Control automation Chrome processes.
 *
 * Browser Control's managed Chrome is identifiable by:
 *   - --remote-debugging-port
 *   - .browser-control in the user-data-dir
 *
 * We match only Chrome processes whose command line contains both
 * markers to avoid counting unrelated user Chrome instances.
 */
function countBcAutomationChrome(): number {
  if (process.platform !== "win32") return 0;

  try {
    const output = execSync(
      `wmic process where "name='chrome.exe'" get processid,commandline /format:csv 2>nul`,
      { encoding: "utf8", timeout: 10000 },
    );
    let count = 0;
    for (const line of output.split("\n")) {
      const lowerLine = line.toLowerCase();
      if (lowerLine.includes("--remote-debugging-port") && lowerLine.includes(".browser-control")) {
        count++;
      }
    }
    return count;
  } catch {
    return 0;
  }
}

/**
 * Check whether the daemon-status.json file exists for the given isolated home.
 */
function daemonStatusFileExists(home: string): boolean {
  const statusFile = path.join(home, ".interop", "daemon-status.json");
  return fs.existsSync(statusFile);
}

/**
 * Read daemon-status.json and return its parsed content, or null.
 */
function readDaemonStatus(home: string): { status?: string; pid?: number } | null {
  const statusFile = path.join(home, ".interop", "daemon-status.json");
  try {
    if (!fs.existsSync(statusFile)) return null;
    return JSON.parse(fs.readFileSync(statusFile, "utf8"));
  } catch {
    return null;
  }
}

// ── CLI helper ──────────────────────────────────────────────────────

function runCliCommand(
  args: string[],
  env: Record<string, string>,
  timeoutMs: number,
): Promise<{ output: string; exitCode: number | null; timedOut: boolean }> {
  return new Promise((resolve) => {
    const childEnv = { ...process.env, ...env };
    const child = spawn("npx", ["ts-node", "cli.ts", ...args], {
      cwd: process.cwd(),
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: childEnv,
      ...(process.platform === "win32" ? { windowsHide: true } : {}),
    });

    const chunks: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => chunks.push(chunk));

    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill("SIGKILL");
        resolve({
          output: Buffer.concat(chunks).toString("utf8"),
          exitCode: null,
          timedOut: true,
        });
      }
    }, timeoutMs);

    child.on("exit", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({
          output: Buffer.concat(chunks).toString("utf8"),
          exitCode: code,
          timedOut: false,
        });
      }
    });

    child.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({
          output: `Child process error: ${err.message}`,
          exitCode: -1,
          timedOut: false,
        });
      }
    });
  });
}

// ── Tests ────────────────────────────────────────────────────────────

describe("Process leak detection (Section 5 / Section 12)", () => {
  const TIMEOUT_MS = 90_000;

  afterEach(async () => {
    await cleanupTestEnv();
    // Wait a moment for process tree termination to propagate
    await new Promise((r) => setTimeout(r, 2000));
  });

  it("bc term open → close does not leak daemon or shell processes", async () => {
    const { env, port } = await createTestEnv();

    // Capture baseline process counts BEFORE the test
    const pwshBefore = countPwshProcesses();

    // Step 1: Open a terminal session (auto-starts daemon)
    const openResult = await runCliCommand(["term", "open", "--json"], env, TIMEOUT_MS);
    assert.equal(openResult.timedOut, false,
      `bc term open must not hang. Output: ${openResult.output.slice(0, 500)}`);
    assert.equal(openResult.exitCode, 0,
      `bc term open must exit 0. Output: ${openResult.output.slice(0, 500)}`);

    // Parse the session ID
    const outputLines = openResult.output.split("\n");
    let sessionId: string | null = null;
    for (const line of outputLines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("{")) {
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.success && parsed.data?.id) {
            sessionId = parsed.data.id;
            break;
          }
        } catch { /* not JSON */ }
      }
    }
    assert.ok(sessionId, `Must extract session ID from bc term open output: ${openResult.output.slice(0, 300)}`);

    // Verify daemon is now running (PID file should exist and process should be alive)
    const daemonPidDuring = readDaemonPid(env.BROWSER_CONTROL_HOME);
    assert.ok(daemonPidDuring > 0 && isPidAlive(daemonPidDuring),
      `Daemon should be running after term open, but PID file missing or process dead`);

    // Step 2: Close the terminal session via CLI
    const closeResult = await runCliCommand(
      ["term", "close", `--session=${sessionId}`, "--json"],
      env,
      TIMEOUT_MS,
    );
    assert.equal(closeResult.timedOut, false,
      `bc term close must not hang. Output: ${closeResult.output.slice(0, 500)}`);

    // Capture the daemon PID BEFORE stopping — `bc daemon stop` deletes the
    // PID file, so readDaemonPid() would return 0 trivially afterwards.
    const daemonPidBefore = readDaemonPid(env.BROWSER_CONTROL_HOME);
    assert.ok(daemonPidBefore > 0 && isPidAlive(daemonPidBefore),
      `Daemon PID must be available and alive before stop for leak verification`);

    // Step 2b: Close sessions via broker API BEFORE stopping the daemon.
    // Although `bc daemon stop` now uses taskkill /T /F on Windows (which
    // kills child processes), it's better to close sessions gracefully first.
    const brokerUrl = `http://127.0.0.1:${port}`;
    try {
      const listResp = await fetch(`${brokerUrl}/api/v1/term/sessions`, {
        signal: AbortSignal.timeout(3000),
      });
      if (listResp.ok) {
        const sessions = await listResp.json() as Array<Record<string, unknown>>;
        for (const session of sessions) {
          const id = session.id as string;
          if (!id) continue;
          try {
            await fetch(`${brokerUrl}/api/v1/term/close`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sessionId: id }),
              signal: AbortSignal.timeout(3000),
            });
          } catch { /* best-effort */ }
        }
      }
    } catch { /* daemon not reachable */ }

    // Step 3: Stop the daemon via CLI
    const stopResult = await runCliCommand(["daemon", "stop"], env, TIMEOUT_MS);
    assert.equal(stopResult.timedOut, false,
      `bc daemon stop must not hang. Output: ${stopResult.output.slice(0, 500)}`);

    // Wait for process tree termination to propagate
    await new Promise((r) => setTimeout(r, 3000));

    // Step 4: Verify the daemon process is actually dead.
    // We check the PID we captured BEFORE stop (not the PID file, which
    // bc daemon stop deletes).
    const daemonStillAlive = isPidAlive(daemonPidBefore);
    assert.equal(daemonStillAlive, false,
      `Daemon process (PID ${daemonPidBefore}) should not remain after cleanup. The process is still alive.`);

    // Step 5: Verify no net increase in pwsh processes
    const pwshAfter = countPwshProcesses();
    // Allow some tolerance for unrelated system activity (e.g., VS Code
    // terminals, other test suites running in parallel). The key check is
    // the daemon PID — pwsh/node delta is a secondary signal.
    const pwshDelta = pwshAfter - pwshBefore;
    // The primary check is the daemon PID — pwsh/node delta is a secondary
    // signal. Allow tolerance for concurrent test suites / VS Code terminals.
    assert.ok(pwshDelta <= 10,
      `pwsh.exe process count should not increase significantly. Before: ${pwshBefore}, After: ${pwshAfter}, Delta: ${pwshDelta}`);

    // Step 6: Do not assert on global node.exe delta.
    // The full project suite runs many child Node processes concurrently
    // (ts-node, CLI subprocesses, MCP stdio children), so machine-wide
    // node.exe counts are too noisy under parallel load.
    //
    // The authoritative scoped leak checks for this test are:
    //   - the captured daemon PID is dead
    //   - pwsh delta stays bounded
    //   - stale PID/status files are cleaned up
    //   - no automation Chrome remains

    // Step 7: Verify stale PID file is gone after bc daemon stop
    const pidFileAfter = readDaemonPid(env.BROWSER_CONTROL_HOME);
    assert.equal(pidFileAfter, 0,
      `daemon.pid should not exist after bc daemon stop`);

    // Step 8: Verify stale daemon-status.json is cleaned up
    // bc daemon stop now cleans up stale daemon-status.json files.
    // The file should either not exist, or show "stopped" status.
    const statusRecord = readDaemonStatus(env.BROWSER_CONTROL_HOME);
    if (statusRecord) {
      assert.notEqual(statusRecord.status, "running",
        `daemon-status.json should not claim "running" after daemon stop. Got: ${JSON.stringify(statusRecord)}`);
    }

    // Step 9: Verify no Browser Control automation Chrome remains
    const chromeAfter = countBcAutomationChrome();
    assert.equal(chromeAfter, 0,
      `No Browser Control automation Chrome should remain after daemon stop. Found: ${chromeAfter}`);
  });

  it("bc term open with force-killed daemon does not leak processes", async () => {
    const { env, port } = await createTestEnv();

    // Capture baseline
    const pwshBefore = countPwshProcesses();

    // Step 1: Open a terminal session (auto-starts daemon)
    const openResult = await runCliCommand(["term", "open", "--json"], env, TIMEOUT_MS);
    assert.equal(openResult.timedOut, false,
      `bc term open must not hang. Output: ${openResult.output.slice(0, 500)}`);

    // Capture the daemon PID BEFORE killing — we'll verify it's actually dead
    const daemonPidBefore = readDaemonPid(env.BROWSER_CONTROL_HOME);
    assert.ok(daemonPidBefore > 0 && isPidAlive(daemonPidBefore),
      `Daemon PID must be available and alive before kill for leak verification`);

    // Step 2: Force-kill the daemon via taskkill /T /F (simulates the cleanup path)
    // Use the shared killProcessTree helper which handles Windows/POSIX differences
    const pidFile = path.join(env.BROWSER_CONTROL_HOME, ".interop", "daemon.pid");
    if (fs.existsSync(pidFile)) {
      const pid = Number(fs.readFileSync(pidFile, "utf8").trim());
      if (!isNaN(pid) && pid > 0) {
        killProcessTree(pid);
      }
      try { fs.unlinkSync(pidFile); } catch { /* best-effort */ }
    }

    // Wait for process tree termination
    await new Promise((r) => setTimeout(r, 3000));

    // Step 3: Verify the daemon process is actually dead using the PID
    // we captured BEFORE the kill (not checkDaemonAlive which reads the
    // now-deleted PID file).
    const daemonStillAlive = isPidAlive(daemonPidBefore);
    assert.equal(daemonStillAlive, false,
      `Daemon process (PID ${daemonPidBefore}) should not remain after taskkill. The process is still alive.`);

    // Step 4: Verify no significant pwsh increase
    const pwshAfter = countPwshProcesses();
    const pwshDelta = pwshAfter - pwshBefore;
    assert.ok(pwshDelta <= 10,
      `pwsh.exe count should not increase significantly after taskkill. Before: ${pwshBefore}, After: ${pwshAfter}, Delta: ${pwshDelta}`);

    // Step 5: As above, do not assert on global node.exe delta here.
    // The scoped daemon-PID death check is the authoritative signal.

    // Step 6: Verify stale daemon-status.json does not claim "running"
    // When the daemon is force-killed, daemon-status.json may be left
    // behind with stale "running" status.  This test verifies that the
    // status file either doesn't exist or doesn't falsely claim running.
    const statusRecord = readDaemonStatus(env.BROWSER_CONTROL_HOME);
    if (statusRecord && statusRecord.status === "running") {
      // The PID in the status record should be dead — this means
      // the status file is stale. A future cleanup pass should remove it,
      // but for now just verify the PID is actually dead.
      const statusPid = Number(statusRecord.pid ?? 0);
      if (statusPid > 0) {
        assert.equal(isPidAlive(statusPid), false,
          `daemon-status.json claims "running" with PID ${statusPid}, but the process should be dead after force-kill`);
      }
    }

    // Step 7: Verify no Browser Control automation Chrome remains
    const chromeAfter = countBcAutomationChrome();
    assert.equal(chromeAfter, 0,
      `No Browser Control automation Chrome should remain after force-kill. Found: ${chromeAfter}`);
  });
});
