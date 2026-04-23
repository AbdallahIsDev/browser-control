/**
 * API process-level regression test for Section 5: Agent Action Surface.
 *
 * This test verifies that the programmatic API terminal-open path is aligned
 * with the CLI terminal-open path:
 *
 *   - createBrowserControl().terminal.open(...) returns success: true
 *   - The returned data includes session id / shell / status
 *   - The calling process exits on its own (no in-process PTY hanging)
 *   - Terminal sessions are daemon-backed (BrokerTerminalRuntime)
 *
 * ISOLATION: Each test uses a unique BROWSER_CONTROL_HOME and BROKER_PORT
 * to prevent interference between tests and with the user's default daemon.
 * This is critical because:
 *   - stopDefaultDaemon() kills the daemon but the TCP port may not be
 *     released immediately (TIME_WAIT on Windows)
 *   - The next test's auto-start would fail if the port is still in use
 *   - Shared BROWSER_CONTROL_HOME means stale MemoryStore state between tests
 *
 * Before the fix:
 *   - createBrowserControl().terminal.open(...) fell back to LocalTerminalRuntime
 *   - In-process PTY kept the Node.js event loop alive → process hung
 *   - API and CLI used different ownership models for terminal sessions
 *
 * After the fix:
 *   - createBrowserControl() sets autoStartDaemon: true on TerminalActions
 *   - terminal.open() auto-starts the daemon and refuses LocalTerminalRuntime fallback
 *   - The process exits cleanly after calling bc.close()
 *   - API and CLI use one coherent daemon-backed ownership model
 *   - Each test uses an isolated environment
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { stopDaemon } from "./daemon_cleanup";

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
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-api-term-"));
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
 * Clean up all isolated environments (stop daemons, remove temp dirs).
 */
async function cleanupIsolatedEnvs(): Promise<void> {
  for (const { home, port } of isolatedEnvs) {
    try {
      await stopDaemon({ homeDir: home, port });
    } catch { /* best-effort */ }

    try {
      fs.rmSync(home, { recursive: true, force: true });
    } catch { /* best-effort */ }
  }
  isolatedEnvs.length = 0;
}

// ── Temp script management ───────────────────────────────────────────

const tempScripts: string[] = [];

function writeTempScript(content: string): string {
  // Write temp script in os.tmpdir() so it doesn't pollute the project tree.
  // Use absolute path imports in the script so they resolve from any directory.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-api-test-"));
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

/**
 * Run a script file as a child process and assert it exits within a timeout.
 * Returns the combined stdout+stderr output and exit code.
 */
function runScriptFile(
  scriptPath: string,
  env: Record<string, string>,
  timeoutMs: number,
): Promise<{ output: string; exitCode: number | null; timedOut: boolean }> {
  return new Promise((resolve) => {
    // Use --project to point ts-node at the project's tsconfig.json so that
    // module resolution (CommonJS, paths, etc.) works from the temp directory.
    const tsconfigPath = path.join(process.cwd(), "tsconfig.json");
    const childEnv = { ...process.env, ...env };
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
 * Parse output for the marker line that the test script prints.
 * The script prints lines like:
 *   RESULT_OPEN:{"success":true,"data":{"id":"...","shell":"...","status":"..."}}
 *   RESULT_RUNTIME:BrokerTerminalRuntime
 *   RESULT_EXIT:OK
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

// ── Tests ──────────────────────────────────────────────────────────────

describe("API terminal process-lifecycle regression (Section 5)", () => {
  const TIMEOUT_MS = 90_000; // 90s — daemon auto-start can be slow on Windows

  afterEach(async () => {
    cleanupTempScripts();
    await cleanupIsolatedEnvs();
  });

  it("createBrowserControl().terminal.open() succeeds and process exits cleanly", async () => {
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

    // Write the test script to a temp file — avoids shell quoting issues
    // on Windows with multiline inline scripts.
    // CRITICAL: set process.env BEFORE any dynamic imports so that
    // loadConfig() reads the isolated BROWSER_CONTROL_HOME and BROKER_PORT.
    const projectRoot = process.cwd().replace(/\\/g, "/"); // forward slashes for TS
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
    // Create a session
    const sessionResult = await bc.session.create("api-test", { policyProfile: "balanced" });

    // Open a terminal session — this must use the daemon-backed runtime
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
    // Close the BrowserControl so the process can exit cleanly.
    // The afterEach hook (cleanupIsolatedEnvs) handles closing terminal
    // sessions and killing the daemon process tree.
    bc.close();
  }

  // If we reach here, the process did NOT hang — that's the key assertion.
  console.log("RESULT_EXIT:OK");
}

main().catch((e) => {
  console.error("RESULT_ERROR:" + e.message);
  process.exitCode = 1;
});
`);

    const result = await runScriptFile(scriptPath, env, TIMEOUT_MS);

    // The process must NOT hang — it must exit on its own
    assert.equal(
      result.timedOut,
      false,
      `API terminal.open() script must not hang. Output: ${result.output.slice(0, 500)}`,
    );

    // The process must exit cleanly (code 0)
    assert.equal(
      result.exitCode,
      0,
      `API terminal.open() script must exit 0. Output: ${result.output.slice(0, 500)}`,
    );

    // Verify the exit marker was printed (process didn't crash before finishing)
    const exitMarker = extractMarker(result.output, "RESULT_EXIT");
    assert.equal(exitMarker, "OK", "Script must print RESULT_EXIT:OK");

    // Verify the open result
    const openMarker = extractMarker(result.output, "RESULT_OPEN");
    assert.ok(openMarker, `Must have RESULT_OPEN marker. Output: ${result.output.slice(0, 500)}`);

    let openData: Record<string, unknown>;
    try {
      openData = JSON.parse(openMarker);
    } catch {
      assert.fail(`RESULT_OPEN is not valid JSON: ${openMarker}`);
    }

    assert.equal(
      openData.success,
      true,
      `terminal.open() must return success:true. Got: ${JSON.stringify(openData).slice(0, 300)}`,
    );

    // Must return terminal session data
    const data = openData.data as Record<string, unknown> | undefined;
    assert.ok(data, "ActionResult must have data");
    assert.ok(data.id, "data must include terminal session id");
    assert.ok(data.shell, "data must include shell");
    assert.ok(data.status, "data must include status");

    // Verify the runtime is BrokerTerminalRuntime (daemon-backed)
    const runtimeMarker = extractMarker(result.output, "RESULT_RUNTIME");
    assert.equal(
      runtimeMarker,
      "BrokerTerminalRuntime",
      `API terminal must use BrokerTerminalRuntime (daemon-backed), got: ${runtimeMarker}. Output: ${result.output.slice(0, 500)}`,
    );
  });

  it("API uses BrokerTerminalRuntime when daemon is running", async () => {
    // Create a fresh isolated environment
    const env = await createIsolatedEnv();

    // Verify no daemon is running on this port
    const probeBefore = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ port: Number(env.BROKER_PORT), host: "127.0.0.1" });
      socket.on("connect", () => { socket.destroy(); resolve(true); });
      socket.on("error", () => resolve(false));
    });
    assert.equal(probeBefore, false,
      `Port ${env.BROKER_PORT} must be free before test`);

    // Simpler test: verify the runtime type directly in an isolated child process
    // CRITICAL: set process.env BEFORE any dynamic imports
    const projectRoot = process.cwd().replace(/\\/g, "/");
    const scriptPath = writeTempScript(`
// Set isolated env vars BEFORE any imports
process.env.BROWSER_CONTROL_HOME = ${JSON.stringify(env.BROWSER_CONTROL_HOME)};
process.env.BROKER_PORT = ${JSON.stringify(env.BROKER_PORT)};
process.env.BROWSER_DEBUG_PORT = ${JSON.stringify(env.BROWSER_DEBUG_PORT)};
process.env.LOG_FILE = "false";

async function main() {
  const { createBrowserControl } = await import("${projectRoot}/browser_control");
  const { MemoryStore } = await import("${projectRoot}/memory_store");
  const { BrokerTerminalRuntime, LocalTerminalRuntime, probeDaemonHealth } = await import("${projectRoot}/session_manager");

  const store = new MemoryStore({ filename: ":memory:" });
  const bc = createBrowserControl({ memoryStore: store, policyProfile: "balanced" });

  try {
    // Wait for the auto-start probe to settle
    await bc.sessionManager.ensureDaemonRuntime({ autoStart: true });

    const runtime = bc.sessionManager.getTerminalRuntime();
    const probe = await probeDaemonHealth();

    const runtimeName = runtime instanceof BrokerTerminalRuntime
      ? "BrokerTerminalRuntime"
      : runtime instanceof LocalTerminalRuntime
        ? "LocalTerminalRuntime"
        : runtime.constructor.name;

    console.log("RESULT_RUNTIME:" + runtimeName);
    console.log("RESULT_DAEMON_RUNNING:" + probe.running);
  } finally {
    bc.close();
  }

  console.log("RESULT_EXIT:OK");
}

main().catch((e) => {
  console.error("RESULT_ERROR:" + e.message);
  process.exitCode = 1;
});
`);

    const result = await runScriptFile(scriptPath, env, TIMEOUT_MS);

    assert.equal(result.timedOut, false,
      `API runtime check must not hang. Output: ${result.output.slice(0, 500)}`);
    assert.equal(result.exitCode, 0,
      `API runtime check must exit 0. Output: ${result.output.slice(0, 500)}`);

    const exitMarker = extractMarker(result.output, "RESULT_EXIT");
    assert.equal(exitMarker, "OK", "Script must print RESULT_EXIT:OK");

    const runtimeMarker = extractMarker(result.output, "RESULT_RUNTIME");
    const daemonRunningMarker = extractMarker(result.output, "RESULT_DAEMON_RUNNING");

    // If the daemon is running, the runtime must be BrokerTerminalRuntime
    if (daemonRunningMarker === "true") {
      assert.equal(runtimeMarker, "BrokerTerminalRuntime",
        `API runtime should be BrokerTerminalRuntime when daemon is running, got: ${runtimeMarker}`);
    } else {
      // If daemon couldn't be started, that's an infrastructure issue.
      // Still verify the runtime is a valid type.
      assert.ok(
        runtimeMarker === "BrokerTerminalRuntime" || runtimeMarker === "LocalTerminalRuntime",
        `API runtime should be BrokerTerminalRuntime or LocalTerminalRuntime, got: ${runtimeMarker}`,
      );
    }
  });
});
