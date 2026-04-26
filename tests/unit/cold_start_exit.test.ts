/**
 * Cold-start regression tests for Section 5: Agent Action Surface.
 *
 * These tests verify the daemon auto-start path in truly isolated
 * environments — no pre-existing daemon, fresh BROWSER_CONTROL_HOME,
 * and a unique BROKER_PORT. This catches the exact bug where the
 * parent process hangs after auto-starting the daemon because the
 * stderr pipe handle remains open.
 *
 * BEFORE the fix:
 *   - With no daemon running, `bc term open --json` auto-started the
 *     daemon but the CLI process hung because:
 *     1. daemonProcess.stderr pipe was not destroyed (only removeAllListeners)
 *     2. The open pipe FD kept the Node.js event loop alive
 *     3. The process never exited on its own
 *
 * AFTER the fix:
 *   - daemonProcess.stderr.destroy() closes the pipe FD
 *   - daemonProcess.removeAllListeners() removes the exit/error listeners
 *   - daemonProcess.unref() detaches the child
 *   - The parent process exits cleanly
 *
 * These tests use isolated BROWSER_CONTROL_HOME and BROKER_PORT so they
 * cannot accidentally pass due to a daemon already running on the
 * default port.
 *
 * CLEANUP REQUIREMENT:
 *   - Each test must close all terminal sessions via the broker API
 *     BEFORE stopping the daemon, so that the daemon's child pwsh
 *     processes are terminated gracefully.
 *   - On Windows, `process.kill(pid, "SIGTERM")` does NOT kill child
 *     processes of the target PID. We use `taskkill /T /F /PID <pid>`
 *     instead, which kills the entire process tree.
 *   - Without this, orphaned daemon.ts and pwsh.exe processes accumulate
 *     after test runs.
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { stopDaemon } from "../../daemon_cleanup";

// ── Isolated environment helpers ────────────────────────────────────

const isolatedEnvs: Array<{ home: string; port: number }> = [];

/**
 * Find a free TCP port by binding to port 0 and reading the assigned port.
 */
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

/**
 * Create an isolated test environment with a fresh BROWSER_CONTROL_HOME
 * and a unique BROKER_PORT. Returns env vars to pass to child processes.
 */
async function createIsolatedEnv(): Promise<Record<string, string>> {
  const port = await findFreePort();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-cold-start-"));
  isolatedEnvs.push({ home, port });

  // Ensure the .interop directory exists so the daemon can write its PID file
  fs.mkdirSync(path.join(home, ".interop"), { recursive: true });

  return {
    BROWSER_CONTROL_HOME: home,
    BROKER_PORT: String(port),
    // Use a non-default debug port too to avoid conflicts
    BROWSER_DEBUG_PORT: String(port + 100),
    // Suppress log file to avoid noise
    LOG_FILE: "false",
  };
}

/**
 * Stop the daemon running in an isolated environment.
 * Delegates to the shared stopDaemon() helper from daemon_cleanup.ts,
 * which handles: closing sessions, killing browser, killing process
 * tree, and cleaning stale files.
 */
async function stopIsolatedDaemon(env: Record<string, string>): Promise<void> {
  await stopDaemon({
    homeDir: env.BROWSER_CONTROL_HOME,
    port: Number(env.BROKER_PORT),
  });
}

/**
 * Clean up all isolated environments (stop daemons, remove temp dirs).
 *
 * This is called from afterEach() and must be async because
 * stopIsolatedDaemon() is now async (it closes sessions via HTTP
 * and uses taskkill on Windows).
 */
async function cleanupIsolatedEnvs(): Promise<void> {
  for (const { home, port } of isolatedEnvs) {
    // Build the env record for stopIsolatedDaemon using the stored port
    const env: Record<string, string> = {
      BROWSER_CONTROL_HOME: home,
      BROKER_PORT: String(port),
    };

    // Close sessions and stop the daemon for this isolated environment.
    // stopIsolatedDaemon handles closing sessions via broker API first,
    // then killing the daemon process tree via taskkill /T /F.
    try {
      await stopIsolatedDaemon(env);
    } catch { /* best-effort */ }

    // Remove temp dir
    try {
      fs.rmSync(home, { recursive: true, force: true });
    } catch { /* best-effort */ }
  }
  isolatedEnvs.length = 0;
}

// ── Child process helpers ────────────────────────────────────────────

/**
 * Run a CLI command as a child process with custom env vars and assert
 * it exits within a timeout. Returns combined output, exit code, and
 * whether it timed out.
 */
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

/**
 * Run a TypeScript script file as a child process with custom env vars.
 */
function runScriptFile(
  scriptPath: string,
  env: Record<string, string>,
  timeoutMs: number,
): Promise<{ output: string; exitCode: number | null; timedOut: boolean }> {
  return new Promise((resolve) => {
    const childEnv = { ...process.env, ...env };
    const tsconfigPath = path.join(process.cwd(), "tsconfig.json");
    const child = spawn("npx", ["ts-node", "--project", tsconfigPath, scriptPath], {
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

/**
 * Parse the CLI output as an ActionResult JSON object.
 * Handles multi-line JSON with brace-depth tracking.
 */
function parseActionResult(output: string): Record<string, unknown> {
  const lines = output.split("\n");
  let lastActionResult: Record<string, unknown> | null = null;

  let buffer = "";
  let depth = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (depth === 0 && buffer.length === 0 && !trimmed.startsWith("{")) {
      continue;
    }

    for (const ch of trimmed) {
      if (ch === "{") depth++;
      if (ch === "}") depth--;
    }
    depth = Math.max(0, depth);

    buffer += (buffer ? "\n" : "") + trimmed;

    if (depth === 0 && buffer.startsWith("{")) {
      try {
        const parsed = JSON.parse(buffer);
        if (typeof parsed === "object" && parsed !== null && "success" in parsed) {
          lastActionResult = parsed;
        }
      } catch {
        // Not valid JSON
      }
      buffer = "";
    }

    if (depth === 0) {
      buffer = "";
    }
  }

  if (lastActionResult) {
    return lastActionResult;
  }

  return { success: false, error: `No ActionResult JSON found in output: ${output.slice(0, 200)}` };
}

/**
 * Extract a marker line from the output.
 */
function extractMarker(output: string, marker: string): string | null {
  const lines = output.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith(marker + ":")) {
      return trimmed.slice(marker.length + 1).trim();
    }
  }
  return null;
}

// ── Temp script management ───────────────────────────────────────────

const tempScripts: string[] = [];

function writeTempScript(content: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-api-cold-"));
  const scriptPath = path.join(tmpDir, "api_test_script.ts");
  fs.writeFileSync(scriptPath, content, "utf8");
  tempScripts.push(scriptPath);
  return scriptPath;
}

function cleanupTempScripts(): void {
  for (const p of tempScripts) {
    try {
      const dir = path.dirname(p);
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
  tempScripts.length = 0;
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("Cold-start terminal ownership regression (Section 5)", () => {
  const TIMEOUT_MS = 90_000; // 90s — daemon auto-start can be slow on Windows with ts-node

  afterEach(async () => {
    cleanupTempScripts();
    await cleanupIsolatedEnvs();
  });

  // ── CLI cold-start test ─────────────────────────────────────────

  it("CLI cold-start: bc term open --json with isolated env succeeds and exits cleanly", async () => {
    // Create a fresh isolated environment — no pre-existing daemon
    const env = await createIsolatedEnv();

    // Verify no daemon is running on this port
    const probeBefore = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ port: Number(env.BROKER_PORT), host: "127.0.0.1" });
      socket.on("connect", () => { socket.destroy(); resolve(true); });
      socket.on("error", () => resolve(false));
    });
    assert.equal(probeBefore, false,
      `Port ${env.BROKER_PORT} must be free before test (no pre-existing daemon)`);

    // Run `bc term open --json` in the isolated environment
    const result = await runCliCommand(["term", "open", "--json"], env, TIMEOUT_MS);

    // The process must NOT hang — this is the core cold-start assertion
    assert.equal(result.timedOut, false,
      `bc term open --json must not hang in cold-start. Output: ${result.output.slice(0, 500)}`);

    // The process must exit cleanly
    assert.equal(result.exitCode, 0,
      `bc term open --json must exit 0 in cold-start. Output: ${result.output.slice(0, 500)}`);

    // Parse the ActionResult
    const parsed = parseActionResult(result.output);
    assert.equal(parsed.success, true,
      `bc term open must return success:true in cold-start. Got: ${JSON.stringify(parsed).slice(0, 300)}`);

    // Must return terminal session data
    const data = parsed.data as Record<string, unknown> | undefined;
    assert.ok(data, "ActionResult must have data");
    assert.ok(data.id, "data must include terminal session id");
    assert.ok(data.shell, "data must include shell");
    assert.ok(data.status, "data must include status");

    // Clean up: stop the isolated daemon (async — closes sessions first)
    await stopIsolatedDaemon(env);
  });

  // ── API cold-start test ────────────────────────────────────────

  it("API cold-start: createBrowserControl().terminal.open() with isolated env succeeds and exits cleanly", async () => {
    // Create a fresh isolated environment — no pre-existing daemon
    const env = await createIsolatedEnv();

    // Verify no daemon is running on this port
    const probeBefore = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ port: Number(env.BROKER_PORT), host: "127.0.0.1" });
      socket.on("connect", () => { socket.destroy(); resolve(true); });
      socket.on("error", () => resolve(false));
    });
    assert.equal(probeBefore, false,
      `Port ${env.BROKER_PORT} must be free before test (no pre-existing daemon)`);

    // Write the test script to a temp file
    // CRITICAL: set process.env BEFORE any dynamic imports so that
    // loadConfig() reads the isolated BROWSER_CONTROL_HOME and BROKER_PORT
    const projectRoot = process.cwd().replace(/\\/g, "/");
    const scriptPath = writeTempScript(`
// Set isolated env vars BEFORE any imports — loadConfig() reads process.env
process.env.BROWSER_CONTROL_HOME = ${JSON.stringify(env.BROWSER_CONTROL_HOME)};
process.env.BROKER_PORT = ${JSON.stringify(env.BROKER_PORT)};
process.env.BROWSER_DEBUG_PORT = ${JSON.stringify(env.BROWSER_DEBUG_PORT)};
process.env.LOG_FILE = "false";

async function main() {
  const { createBrowserControl } = await import("${projectRoot}/browser_control");
  const { MemoryStore } = await import("${projectRoot}/memory_store");
  const { BrokerTerminalRuntime, LocalTerminalRuntime } = await import("${projectRoot}/session_manager");

  const store = new MemoryStore({ filename: ":memory:" });
  const bc = createBrowserControl({ memoryStore: store, policyProfile: "balanced" });

  try {
    // Open a terminal session — must use daemon-backed runtime
    const openResult = await bc.terminal.open({});

    // Print result as a marker for the test to parse
    console.log("RESULT_OPEN:" + JSON.stringify({
      success: openResult.success,
      data: openResult.data,
      error: openResult.error,
    }));

    // Check the runtime type
    const runtime = bc.sessionManager.getTerminalRuntime();
    const runtimeName = runtime instanceof BrokerTerminalRuntime
      ? "BrokerTerminalRuntime"
      : runtime instanceof LocalTerminalRuntime
        ? "LocalTerminalRuntime"
        : runtime.constructor.name;
    console.log("RESULT_RUNTIME:" + runtimeName);
  } finally {
    bc.close();
  }

  // If we reach here, the process did NOT hang — the key assertion
  console.log("RESULT_EXIT:OK");
}

main().catch((e) => {
  console.error("RESULT_ERROR:" + e.message);
  process.exitCode = 1;
});
`);

    const result = await runScriptFile(scriptPath, env, TIMEOUT_MS);

    // The process must NOT hang — this is the core cold-start assertion
    assert.equal(result.timedOut, false,
      `API terminal.open() must not hang in cold-start. Output: ${result.output.slice(0, 500)}`);

    // The process must exit cleanly
    assert.equal(result.exitCode, 0,
      `API terminal.open() must exit 0 in cold-start. Output: ${result.output.slice(0, 500)}`);

    // Verify the exit marker was printed
    const exitMarker = extractMarker(result.output, "RESULT_EXIT");
    assert.equal(exitMarker, "OK", "Script must print RESULT_EXIT:OK (process did not hang)");

    // Verify the open result
    const openMarker = extractMarker(result.output, "RESULT_OPEN");
    assert.ok(openMarker, `Must have RESULT_OPEN marker. Output: ${result.output.slice(0, 500)}`);

    let openData: Record<string, unknown>;
    try {
      openData = JSON.parse(openMarker);
    } catch {
      assert.fail(`RESULT_OPEN is not valid JSON: ${openMarker}`);
    }

    assert.equal(openData.success, true,
      `terminal.open() must return success:true in cold-start. Got: ${JSON.stringify(openData).slice(0, 300)}`);

    // Must return terminal session data
    const data = openData.data as Record<string, unknown> | undefined;
    assert.ok(data, "ActionResult must have data");
    assert.ok(data.id, "data must include terminal session id");
    assert.ok(data.shell, "data must include shell");
    assert.ok(data.status, "data must include status");

    // Verify the runtime is BrokerTerminalRuntime (daemon-backed)
    const runtimeMarker = extractMarker(result.output, "RESULT_RUNTIME");
    assert.equal(runtimeMarker, "BrokerTerminalRuntime",
      `API terminal must use BrokerTerminalRuntime (daemon-backed) in cold-start, got: ${runtimeMarker}. Output: ${result.output.slice(0, 500)}`);

    // Clean up: stop the isolated daemon (async — closes sessions first)
    await stopIsolatedDaemon(env);
  });

  // ── CLI cold-start: bc daemon start exits cleanly ────────────────

  it("CLI cold-start: bc daemon start with isolated env exits cleanly", async () => {
    const env = await createIsolatedEnv();

    // Verify no daemon is running on this port
    const probeBefore = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ port: Number(env.BROKER_PORT), host: "127.0.0.1" });
      socket.on("connect", () => { socket.destroy(); resolve(true); });
      socket.on("error", () => resolve(false));
    });
    assert.equal(probeBefore, false,
      `Port ${env.BROKER_PORT} must be free before test`);

    // Run `bc daemon start` in the isolated environment
    const result = await runCliCommand(["daemon", "start"], env, TIMEOUT_MS);

    // The process must NOT hang
    assert.equal(result.timedOut, false,
      `bc daemon start must not hang in cold-start. Output: ${result.output.slice(0, 500)}`);

    // The process must exit cleanly (not crash)
    assert.equal(result.exitCode, 0,
      `bc daemon start must exit 0. Output: ${result.output.slice(0, 500)}`);

    // The daemon should now be running
    const probeAfter = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ port: Number(env.BROKER_PORT), host: "127.0.0.1" });
      socket.on("connect", () => { socket.destroy(); resolve(true); });
      socket.on("error", () => resolve(false));
    });
    assert.equal(probeAfter, true,
      `Daemon must be listening on port ${env.BROKER_PORT} after bc daemon start`);

    // Clean up: stop the isolated daemon (async — closes sessions first)
    await stopIsolatedDaemon(env);
  });
});
