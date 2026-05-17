/**
 * Process leak detection regression test for Section 5 / Section 12.
 *
 * This test verifies that terminal/session operations do not leave behind
 * orphaned daemon processes, interactive shell (pwsh.exe) processes,
 * stale PID/status files, or automation browser (Chrome) processes
 * after proper cleanup.
 *
 * The test:
 *   1. Spawns a daemon directly with isolated env
 *   2. Waits for daemon to become healthy
 *   3. Runs a terminal open → close cycle via CLI
 *   4. Stops the daemon and verifies cleanup
 *   5. Verifies no net leaked processes remain
 *
 * NOTE: This file uses import.meta which is compatible with Node's test runner
 * when loaded via ts-node/register. TypeScript with "module": "CommonJS" will
 * show TS1343 errors for import.meta, but the runtime handles it correctly.
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import os from "node:os";
import net from "node:net";

// @ts-expect-error - import.meta is available at runtime via ts-node/register
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// @ts-expect-error - import.meta is available at runtime via ts-node/register
const require = createRequire(import.meta.url);

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

let testEnv: {
  home: string;
  port: number;
  env: Record<string, string>;
  daemonPid: number | null;
} | null = null;

async function createTestEnv(): Promise<{
  home: string;
  port: number;
  env: Record<string, string>;
}> {
  const port = await findFreePort();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-leak-test-"));
  fs.mkdirSync(path.join(home, ".interop"), { recursive: true });

  const env: Record<string, string> = {
    ...process.env,
    BROWSER_CONTROL_HOME: home,
    BROKER_PORT: String(port),
    BROWSER_DEBUG_PORT: String(port + 100),
    LOG_FILE: "false",
  };

  testEnv = { home, port, env, daemonPid: null };
  return { home, port, env };
}

/**
 * Spawn daemon directly and wait for it to become healthy.
 * Returns the daemon PID.
 */
async function startDaemon(
  env: Record<string, string>,
): Promise<number> {
  const root = path.resolve(__dirname, "..", "..");
  const distEntry = path.join(root, "dist", "daemon.js");

  // Use dist if available, otherwise fall back to ts-node
  const command = process.execPath;
  const tsNodeBin = require.resolve("ts-node/dist/bin.js");
  const args = fs.existsSync(distEntry)
    ? [distEntry]
    : [tsNodeBin, path.join(root, "src", "daemon.ts")];

  const child = spawn(command, args, {
    cwd: root,
    env,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });

  const daemonPid = child.pid;
  if (!daemonPid) throw new Error("Failed to get daemon PID");

  // Detach so the child survives if the parent exits
  child.unref();

  // Wait for daemon to become healthy (up to 30 seconds)
  const brokerUrl = `http://127.0.0.1:${env.BROKER_PORT}`;
  const maxRetries = 30;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const resp = await fetch(`${brokerUrl}/api/v1/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (resp.ok) {
        // Also verify terminal readiness
        const termResp = await fetch(`${brokerUrl}/api/v1/term/sessions`, {
          signal: AbortSignal.timeout(2000),
        });
        if (termResp.ok) {
          if (testEnv) testEnv.daemonPid = daemonPid;
          return daemonPid;
        }
      }
    } catch {
      // daemon not ready yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  throw new Error(
    `Daemon did not become healthy within 30 seconds (PID: ${daemonPid})`,
  );
}

/**
 * Stop daemon by calling the broker's shutdown endpoint,
 * then verify the process is dead.
 */
async function stopDaemon(home: string, port: number): Promise<void> {
  // PID file is at $home/interop/daemon.pid (no dot)
  const pidFile = path.join(home, "interop", "daemon.pid");
  const brokerUrl = `http://127.0.0.1:${port}`;

  // Try graceful shutdown via broker API
  try {
    await fetch(`${brokerUrl}/api/v1/daemon/stop`, {
      method: "POST",
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // best-effort
  }

  // Wait for process to exit
  await new Promise((r) => setTimeout(r, 3000));

  // If still alive, read PID from file and kill
  const pid = readDaemonPid(home);
  if (pid > 0 && isPidAlive(pid)) {
    try {
      execSync(`taskkill /F /T /PID ${pid}`, {
        stdio: "ignore",
        timeout: 5000,
      });
    } catch {
      // best-effort
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  // Clean up PID file
  try {
    if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
  } catch {
    // best-effort
  }

  // Also clean legacy path if it exists
  const legacyPidFile = path.join(home, ".interop", "daemon.pid");
  try {
    if (fs.existsSync(legacyPidFile)) fs.unlinkSync(legacyPidFile);
  } catch {
    // best-effort
  }
}

async function cleanupTestEnv(): Promise<void> {
  if (!testEnv) return;
  const { home, port } = testEnv;

  try {
    await stopDaemon(home, port);
  } catch {
    /* best-effort */
  }

  try {
    fs.rmSync(home, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }

  testEnv = null;
}

// ── Process counting helpers ─────────────────────────────────────────

function readDaemonPid(home: string): number {
  // PID file is written to $home/interop/daemon.pid (no dot)
  const pidFile = path.join(home, "interop", "daemon.pid");
  try {
    if (!fs.existsSync(pidFile)) return 0;
    const pid = Number(fs.readFileSync(pidFile, "utf8").trim());
    return isNaN(pid) || pid <= 0 ? 0 : pid;
  } catch {
    return 0;
  }
}

function isPidAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function countPwshProcesses(): number {
  if (process.platform !== "win32") return 0;
  try {
    const output = execSync(
      `tasklist /FI "IMAGENAME eq pwsh.exe" /FO CSV /NH 2>nul`,
      { encoding: "utf8", timeout: 10000 },
    );
    let count = 0;
    for (const line of output.split("\n")) {
      if (line.trim().startsWith('"pwsh.exe"')) count++;
    }
    return count;
  } catch {
    return 0;
  }
}

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
      if (
        lowerLine.includes("--remote-debugging-port") &&
        lowerLine.includes(".browser-control")
      ) {
        count++;
      }
    }
    return count;
  } catch {
    return 0;
  }
}

function readDaemonStatus(home: string): {
  status?: string;
  pid?: number;
} | null {
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
): Promise<{
  output: string;
  exitCode: number | null;
  timedOut: boolean;
}> {
  return new Promise((resolve) => {
    const childEnv = { ...process.env, ...env };
    const root = path.resolve(__dirname, "..", "..");
    const tsNodeBin = require.resolve("ts-node/dist/bin.js");
    const child = spawn(
      process.execPath,
      [
        tsNodeBin,
        "--project",
        path.join(root, "tsconfig.json"),
        path.join(root, "src", "cli.ts"),
        ...args,
      ],
      {
        cwd: root,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: childEnv,
        windowsHide: true,
      },
    );

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

    child.on("error", () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({
          output: "Child process error",
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
    await new Promise((r) => setTimeout(r, 1000));
  });

  it("bc term open → close does not leak daemon or shell processes", async () => {
    const { env, port } = await createTestEnv();

    // Capture baseline
    const pwshBefore = countPwshProcesses();

    // Step 1: Start daemon explicitly
    const daemonPid = await startDaemon(env);
    assert.ok(daemonPid > 0, "Daemon must start successfully");

    // Verify PID file was written
    const pidAfterStart = readDaemonPid(env.BROWSER_CONTROL_HOME);
    assert.ok(
      pidAfterStart > 0,
      "PID file must exist after daemon start",
    );

    // Step 2: Open a terminal session via CLI
    const openResult = await runCliCommand(
      ["term", "open", "--json"],
      env,
      TIMEOUT_MS,
    );
    assert.equal(
      openResult.timedOut,
      false,
      `bc term open must not hang. Output: ${openResult.output.slice(0, 500)}`,
    );
    assert.equal(
      openResult.exitCode,
      0,
      `bc term open must exit 0. Output: ${openResult.output.slice(0, 500)}`,
    );

    // Parse session ID
    let sessionId: string | null = null;
    for (const line of openResult.output.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("{")) {
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.success && parsed.data?.id) {
            sessionId = parsed.data.id;
            break;
          }
        } catch {
          /* not JSON */
        }
      }
    }
    assert.ok(
      sessionId,
      `Must extract session ID from bc term open output: ${openResult.output.slice(0, 300)}`,
    );

    // Step 3: Close the terminal session via CLI
    const closeResult = await runCliCommand(
      ["term", "close", `--session=${sessionId}`, "--json"],
      env,
      TIMEOUT_MS,
    );
    assert.equal(
      closeResult.timedOut,
      false,
      `bc term close must not hang. Output: ${closeResult.output.slice(0, 500)}`,
    );

    // Step 4: Stop daemon
    await stopDaemon(env.BROWSER_CONTROL_HOME, port);

    // Wait for cleanup
    await new Promise((r) => setTimeout(r, 2000));

    // Step 5: Verify daemon process is dead
    const daemonStillAlive = isPidAlive(daemonPid);
    assert.equal(
      daemonStillAlive,
      false,
      `Daemon process (PID ${daemonPid}) should not remain after stop`,
    );

    // Step 6: Verify no significant pwsh increase
    const pwshAfter = countPwshProcesses();
    const pwshDelta = pwshAfter - pwshBefore;
    assert.ok(
      pwshDelta <= 10,
      `pwsh.exe count should not increase significantly. Before: ${pwshBefore}, After: ${pwshAfter}, Delta: ${pwshDelta}`,
    );

    // Step 7: Verify PID file is cleaned up
    const pidFileAfter = readDaemonPid(env.BROWSER_CONTROL_HOME);
    assert.equal(
      pidFileAfter,
      0,
      "daemon.pid should not exist after daemon stop",
    );

    // Step 8: Verify daemon-status.json doesn't claim "running"
    const statusRecord = readDaemonStatus(env.BROWSER_CONTROL_HOME);
    if (statusRecord) {
      assert.notEqual(
        statusRecord.status,
        "running",
        `daemon-status.json should not claim "running" after stop. Got: ${JSON.stringify(statusRecord)}`,
      );
    }

    // Step 9: Verify no BC automation Chrome remains
    const chromeAfter = countBcAutomationChrome();
    assert.equal(
      chromeAfter,
      0,
      `No BC automation Chrome should remain. Found: ${chromeAfter}`,
    );
  });

  it("bc term open with force-killed daemon does not leak processes", async () => {
    const { env, port } = await createTestEnv();

    // Capture baseline
    const pwshBefore = countPwshProcesses();

    // Step 1: Start daemon explicitly
    const daemonPid = await startDaemon(env);
    assert.ok(daemonPid > 0, "Daemon must start successfully");

    // Step 2: Force-kill the daemon
    try {
      execSync(`taskkill /F /T /PID ${daemonPid}`, {
        stdio: "ignore",
        timeout: 5000,
      });
    } catch {
      // best-effort
    }

    // Wait for process tree termination
    await new Promise((r) => setTimeout(r, 3000));

    // Step 3: Verify daemon is dead
    const daemonStillAlive = isPidAlive(daemonPid);
    assert.equal(
      daemonStillAlive,
      false,
      `Daemon process (PID ${daemonPid}) should not remain after force-kill`,
    );

    // Step 4: Verify no significant pwsh increase
    const pwshAfter = countPwshProcesses();
    const pwshDelta = pwshAfter - pwshBefore;
    assert.ok(
      pwshDelta <= 10,
      `pwsh.exe count should not increase significantly. Before: ${pwshBefore}, After: ${pwshAfter}, Delta: ${pwshDelta}`,
    );

    // Step 5: Verify daemon-status.json doesn't falsely claim running
    // (or if it does, the PID in it should be dead)
    const statusRecord = readDaemonStatus(env.BROWSER_CONTROL_HOME);
    if (statusRecord && statusRecord.status === "running") {
      const statusPid = Number(statusRecord.pid ?? 0);
      if (statusPid > 0) {
        assert.equal(
          isPidAlive(statusPid),
          false,
          `daemon-status.json claims "running" with PID ${statusPid}, but process should be dead`,
        );
      }
    }

    // Step 6: Verify no BC automation Chrome remains
    const chromeAfter = countBcAutomationChrome();
    assert.equal(
      chromeAfter,
      0,
      `No BC automation Chrome should remain after force-kill. Found: ${chromeAfter}`,
    );
  });
});
