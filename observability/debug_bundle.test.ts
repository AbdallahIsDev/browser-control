/**
 * Debug Bundle Tests — Verify bundle assembly and storage.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildDebugBundle, saveDebugBundle, loadDebugBundle, listDebugBundles, deleteDebugBundle } from "./debug_bundle";

let originalHome: string | undefined;
let tempHome: string;

beforeEach(() => {
  originalHome = process.env.BROWSER_CONTROL_HOME;
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "bc-debug-bundle-test-"));
  process.env.BROWSER_CONTROL_HOME = tempHome;
});

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.BROWSER_CONTROL_HOME;
  } else {
    process.env.BROWSER_CONTROL_HOME = originalHome;
  }
  fs.rmSync(tempHome, { recursive: true, force: true });
});

describe("buildDebugBundle", () => {
  it("assembles a basic bundle", async () => {
    const bundle = await buildDebugBundle({
      taskId: "task-1",
      sessionId: "session-1",
      executionPath: "a11y",
      error: new Error("Test failure"),
    });

    assert.strictEqual(bundle.taskId, "task-1");
    assert.strictEqual(bundle.sessionId, "session-1");
    assert.strictEqual(bundle.executionPath, "a11y");
    assert.strictEqual(bundle.partial, false);
    assert(bundle.bundleId.startsWith("bundle-"));
    assert(bundle.recoveryGuidance);
    assert(bundle.recoveryGuidance.canRetry);
  });

  it("includes terminal evidence", async () => {
    const bundle = await buildDebugBundle({
      taskId: "task-1",
      sessionId: "session-1",
      executionPath: "command",
      error: new Error("Terminal failure"),
      terminalSession: {
        sessionId: "term-1",
        lastOutput: "Error output here",
        exitCode: 1,
        promptState: "error",
        shell: "bash",
        cwd: "/tmp",
      },
    });

    assert(bundle.terminal);
    assert.strictEqual(bundle.terminal.sessionId, "term-1");
    assert.strictEqual(bundle.terminal.exitCode, 1);
    assert.strictEqual(bundle.terminal.shell, "bash");
  });

  it("includes filesystem evidence", async () => {
    const bundle = await buildDebugBundle({
      taskId: "task-1",
      sessionId: "session-1",
      executionPath: "command",
      error: new Error("FS failure"),
      fsOperation: {
        path: "/tmp/test",
        operation: "write",
        errorCode: "EACCES",
      },
    });

    assert(bundle.filesystem);
    assert.strictEqual(bundle.filesystem.path, "/tmp/test");
    assert.strictEqual(bundle.filesystem.errorCode, "EACCES");
  });

  it("bounds terminal output", async () => {
    const longOutput = "x".repeat(10000);
    const bundle = await buildDebugBundle({
      taskId: "task-1",
      sessionId: "session-1",
      executionPath: "command",
      error: new Error("Long output"),
      terminalSession: {
        sessionId: "term-1",
        lastOutput: longOutput,
        promptState: "idle",
      },
    });

    assert(bundle.terminal);
    assert(bundle.terminal.lastOutput.length <= 5000);
  });

  it("redacts secrets in returned exception and terminal evidence", async () => {
    const error = new Error("failed with token=supersecrettoken1234567890");
    error.stack = "Error: failed\n    at connect (https://alice:password@example.test?api_key=secretkey1234567890)";

    const bundle = await buildDebugBundle({
      taskId: "task-1",
      sessionId: "session-1",
      executionPath: "command",
      error,
      terminalSession: {
        sessionId: "term-1",
        lastOutput: "SESSION_COOKIE=sid-secret",
        promptState: "error",
      },
    });

    assert(!bundle.exception.message.includes("supersecrettoken1234567890"));
    assert(!bundle.exception.stack?.includes("secretkey1234567890"));
    assert(!bundle.exception.stack?.includes("password"));
    assert(!bundle.terminal?.lastOutput.includes("sid-secret"));
  });

  it("marks partial when evidence collection fails", async () => {
    const bundle = await buildDebugBundle({
      taskId: "task-1",
      sessionId: "session-1",
      executionPath: "a11y",
      error: new Error("Test"),
      page: {
        url: () => { throw new Error("Page crashed"); },
        title: () => Promise.resolve("title"),
        screenshot: () => Promise.resolve(Buffer.from("")),
        evaluate: () => Promise.resolve([]),
      } as NonNullable<Parameters<typeof buildDebugBundle>[0]["page"]>,
    });

    assert.strictEqual(bundle.partial, true);
    assert(bundle.partialReasons);
    assert(bundle.partialReasons!.length > 0);
  });
});

describe("saveDebugBundle / loadDebugBundle", () => {
  it("round-trips a bundle", () => {
    const bundle = buildDebugBundleSync({
      taskId: "task-1",
      sessionId: "session-1",
      executionPath: "a11y",
      error: new Error("Test"),
    });

    const { filePath } = saveDebugBundle(bundle);
    const loaded = loadDebugBundle(bundle.bundleId);
    assert(loaded);
    assert.strictEqual(loaded.bundleId, bundle.bundleId);
    assert.strictEqual(loaded.taskId, "task-1");

    // Cleanup
    deleteDebugBundle(bundle.bundleId);
  });

  it("rejects path traversal bundle IDs", () => {
    const providersDir = path.join(tempHome, "providers");
    fs.mkdirSync(providersDir, { recursive: true });
    fs.writeFileSync(path.join(providersDir, "registry.json"), JSON.stringify({ secret: "leaked" }));

    assert.equal(loadDebugBundle("..\\providers\\registry"), null);
    assert.equal(loadDebugBundle("../providers/registry"), null);
    assert.equal(deleteDebugBundle("..\\providers\\registry"), false);
  });
});

// Helper to avoid async in sync context for storage tests
function buildDebugBundleSync(options: Parameters<typeof buildDebugBundle>[0]) {
  return {
    bundleId: "bundle-00000000-0000-4000-8000-000000000123",
    taskId: options.taskId,
    sessionId: options.sessionId,
    executionPath: options.executionPath,
    exception: { message: options.error instanceof Error ? options.error.message : String(options.error) },
    retrySummary: { attempts: 1, totalDurationMs: 0, backoffUsed: false },
    recoveryGuidance: { canRetry: true, requiresConfirmation: false, requiresHuman: false },
    assembledAt: new Date().toISOString(),
    partial: false,
    recentActions: [],
    policyDecisions: [],
    ...(options.terminalSession ? { terminal: options.terminalSession } : {}),
    ...(options.fsOperation ? { filesystem: options.fsOperation } : {}),
  } as import("./types").DebugBundle;
}
