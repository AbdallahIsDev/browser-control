/**
 * CLI regression test for the Section 5 terminal ownership defect.
 *
 * This test verifies that `bc term open --json` actually SUCCEEDS in the
 * happy path — not just "doesn't hang" or "fails cleanly." The daemon must
 * auto-start transparently, and terminal sessions must be usable across
 * separate CLI invocations.
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
 *   - `bc term open --json` hung (in-process PTY kept event loop alive)
 *   - After the hang fix, it exited but failed with "start daemon yourself"
 *   - Tests using shared default port 7788 failed intermittently
 *
 * After the fix:
 *   - `bc term open --json` returns success:true with a session ID
 *   - The CLI process exits cleanly
 *   - Terminal sessions persist across CLI invocations
 *   - Each test uses an isolated environment
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
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-cli-term-"));
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

// ── Child process helpers ────────────────────────────────────────────

/**
 * Parse the CLI output as an ActionResult JSON object.
 *
 * The CLI may print extra log lines (e.g., SQLite deprecation warnings,
 * policy engine log messages) before the JSON ActionResult. We scan
 * each line looking for lines that START with '{' and attempt to parse
 * them as JSON. We return the last one that looks like an ActionResult
 * (has a "success" key).
 *
 * Multi-line JSON is handled with brace-depth tracking.
 */
function parseActionResult(output: string): Record<string, unknown> {
  const lines = output.split("\n");
  let lastActionResult: Record<string, unknown> | null = null;

  let buffer = "";
  let depth = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // If we're not currently tracking a JSON object, only start on
    // lines that begin with '{'. This avoids picking up log lines
    // that happen to contain JSON fragments (e.g., policy engine logs).
    if (depth === 0 && buffer.length === 0 && !trimmed.startsWith("{")) {
      continue;
    }

    // Track brace depth for multi-line JSON
    for (const ch of trimmed) {
      if (ch === '{') depth++;
      if (ch === '}') depth--;
    }
    // Clamp depth to 0 minimum to handle stray '}' in non-JSON lines
    depth = Math.max(0, depth);

    buffer += (buffer ? "\n" : "") + trimmed;

    // When depth returns to 0, we've completed a JSON object
    if (depth === 0 && buffer.startsWith("{")) {
      try {
        const parsed = JSON.parse(buffer);
        if (typeof parsed === "object" && parsed !== null && "success" in parsed) {
          lastActionResult = parsed;
        }
      } catch {
        // Not valid JSON — ignore and continue
      }
      buffer = "";
    }

    // Always reset buffer when depth is 0 (even for non-JSON-starting content)
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
        resolve({ output: Buffer.concat(chunks).toString("utf8"), exitCode: null, timedOut: true });
      }
    }, timeoutMs);

    child.on("exit", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ output: Buffer.concat(chunks).toString("utf8"), exitCode: code, timedOut: false });
      }
    });

    child.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ output: `Child process error: ${err.message}`, exitCode: -1, timedOut: false });
      }
    });
  });
}

describe("CLI terminal exit regression (Section 5)", () => {
  const EXIT_TIMEOUT_MS = 90_000; // 90 seconds — auto-start can be slow on Windows with ts-node

  afterEach(async () => {
    await cleanupIsolatedEnvs();
  });

  it("bc term list --json succeeds (auto-starts daemon if needed)", async () => {
    const env = await createIsolatedEnv();

    const result = await runCliCommand(["term", "list", "--json"], env, EXIT_TIMEOUT_MS);

    assert.equal(result.timedOut, false,
      `bc term list --json must not hang. Output: ${result.output.slice(0, 500)}`);

    // The command MUST succeed — the daemon auto-starts transparently
    assert.equal(result.exitCode, 0,
      `bc term list --json must exit 0. Output: ${result.output.slice(0, 500)}`);

    // Parse the output as valid ActionResult JSON
    const parsed = parseActionResult(result.output);
    assert.equal(parsed.success, true,
      `bc term list must return success:true. Got: ${JSON.stringify(parsed).slice(0, 300)}`);
  });

  it("bc term open --json returns success:true (daemon auto-starts)", async () => {
    const env = await createIsolatedEnv();

    const result = await runCliCommand(["term", "open", "--json"], env, EXIT_TIMEOUT_MS);

    assert.equal(result.timedOut, false,
      `bc term open --json must not hang. Output: ${result.output.slice(0, 500)}`);

    // The command MUST succeed — the daemon auto-starts transparently
    assert.equal(result.exitCode, 0,
      `bc term open --json must exit 0. Output: ${result.output.slice(0, 500)}`);

    // Parse the output as valid ActionResult JSON
    const parsed = parseActionResult(result.output);
    assert.equal(parsed.success, true,
      `bc term open must return success:true. Got: ${JSON.stringify(parsed).slice(0, 300)}`);
    assert.ok(parsed.completedAt, "ActionResult must have completedAt");

    // Must return terminal session data
    const data = parsed.data as Record<string, unknown> | undefined;
    assert.ok(data, "ActionResult must have data");
    assert.ok(data.id, "data must include terminal session id");
    assert.ok(data.shell, "data must include shell");
    assert.ok(data.status, "data must include status");
  });

  it("bc term exec --json 'node --version' succeeds", async () => {
    // One-shot exec should work even without the daemon.
    // Use node --version because it has no special characters
    // that could be misinterpreted by Windows PowerShell.
    const env = await createIsolatedEnv();

    const result = await runCliCommand(["term", "exec", "node --version", "--json"], env, EXIT_TIMEOUT_MS);

    assert.equal(result.timedOut, false,
      `bc term exec --json must not hang. Output: ${result.output.slice(0, 500)}`);

    // One-shot exec must succeed (uses LocalTerminalRuntime, no daemon needed)
    assert.equal(result.exitCode, 0,
      `bc term exec must exit 0. Output: ${result.output.slice(0, 500)}`);

    const parsed = parseActionResult(result.output);
    assert.equal(parsed.success, true,
      `bc term exec must return success:true. Got: ${JSON.stringify(parsed).slice(0, 300)}`);
  });

  // ── Cross-invocation terminal flow test ──────────────────────────
  // This test verifies that terminal sessions persist across separate
  // CLI invocations — the core value of daemon-backed ownership.
  it("cross-invocation: open → list → close must all succeed", async () => {
    const env = await createIsolatedEnv();

    // Step 1: Open a terminal session via CLI (daemon auto-starts)
    const openResult = await runCliCommand(["term", "open", "--json"], env, EXIT_TIMEOUT_MS);
    assert.equal(openResult.timedOut, false, "term open must not hang");
    assert.equal(openResult.exitCode, 0,
      `term open must succeed. Output: ${openResult.output.slice(0, 300)}`);

    const openParsed = parseActionResult(openResult.output);
    assert.equal(openParsed.success, true,
      `term open must return success:true. Got: ${JSON.stringify(openParsed).slice(0, 300)}`);

    const sessionId = (openParsed.data as Record<string, unknown>)?.id as string | undefined;
    assert.ok(sessionId, "term open must return a session ID in data.id");

    // Step 2: List sessions in a separate CLI process — the opened session must appear
    const listResult = await runCliCommand(["term", "list", "--json"], env, EXIT_TIMEOUT_MS);
    assert.equal(listResult.timedOut, false, "term list must not hang");
    assert.equal(listResult.exitCode, 0,
      `term list must succeed. Output: ${listResult.output.slice(0, 300)}`);

    const listParsed = parseActionResult(listResult.output);
    assert.equal(listParsed.success, true,
      `term list must return success:true. Got: ${JSON.stringify(listParsed).slice(0, 300)}`);

    const sessions = listParsed.data as Array<Record<string, unknown>> | undefined;
    assert.ok(Array.isArray(sessions), "term list data must be an array");
    const found = sessions.some(s => s.id === sessionId);
    assert.ok(found,
      `term list must include the opened session ${sessionId}. Got: ${JSON.stringify(sessions?.map(s => s.id))}`);

    // Step 3: Close the session in another CLI process
    const closeResult = await runCliCommand(["term", "close", `--session=${sessionId}`, "--json"], env, EXIT_TIMEOUT_MS);
    assert.equal(closeResult.timedOut, false, "term close must not hang");
    assert.equal(closeResult.exitCode, 0,
      `term close must succeed. Output: ${closeResult.output.slice(0, 300)}`);

    const closeParsed = parseActionResult(closeResult.output);
    assert.equal(closeParsed.success, true,
      `term close must return success:true. Got: ${JSON.stringify(closeParsed).slice(0, 300)}`);
  });

  // ── API alignment test ────────────────────────────────────────────
  // Verifies that createBrowserControl() follows the same ownership model
  it("createBrowserControl terminal.open follows same ownership model as CLI", async () => {
    const { createBrowserControl } = await import("../../browser_control");
    const { MemoryStore } = await import("../../memory_store");
    const { BrokerTerminalRuntime, LocalTerminalRuntime } = await import("../../session_manager");

    const store = new MemoryStore({ filename: ":memory:" });
    const bc = createBrowserControl({ memoryStore: store, policyProfile: "balanced" });

    // Wait for the async ensureDaemonRuntime probe to settle
    // (it's fire-and-forget in createBrowserControl, but we need the result)
    await bc.sessionManager.ensureDaemonRuntime({ autoStart: false });

    const runtime = bc.sessionManager.getTerminalRuntime();

    // The runtime should be either BrokerTerminalRuntime (daemon running)
    // or LocalTerminalRuntime (daemon not running) — but NOT undefined or null.
    assert.ok(runtime, "getTerminalRuntime() must return a runtime");

    const { probeDaemonHealth } = await import("../../session_manager");
    const probe = await probeDaemonHealth();

    if (probe.running) {
      assert.ok(runtime instanceof BrokerTerminalRuntime,
        `API runtime should be BrokerTerminalRuntime when daemon is running, got: ${runtime.constructor.name}`);
    } else {
      assert.ok(runtime instanceof LocalTerminalRuntime,
        `API runtime should be LocalTerminalRuntime when daemon is not running, got: ${runtime.constructor.name}`);
    }

    store.close();
  });
});
