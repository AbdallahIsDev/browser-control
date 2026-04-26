/**
 * Console Capture Tests — Verify bounded ring buffer and entry capture.
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { ConsoleCapture, getGlobalConsoleCapture, resetGlobalConsoleCapture } from "../../../src/observability/console_capture";

describe("ConsoleCapture", () => {
  it("records and retrieves entries", () => {
    const capture = new ConsoleCapture();
    capture.recordEntry("session-1", {
      level: "error",
      message: "Test error",
      timestamp: "2024-01-01T00:00:00Z",
      sessionId: "session-1",
    });

    const entries = capture.getEntries("session-1");
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].message, "Test error");
  });

  it("respects the max entries bound", () => {
    const capture = new ConsoleCapture({ maxEntries: 3 });
    for (let i = 0; i < 5; i++) {
      capture.recordEntry("session-1", {
        level: "log",
        message: `msg-${i}`,
        timestamp: "2024-01-01T00:00:00Z",
      });
    }

    const entries = capture.getEntries("session-1");
    assert.strictEqual(entries.length, 3);
    assert.strictEqual(entries[0].message, "msg-2");
    assert.strictEqual(entries[2].message, "msg-4");
  });

  it("filters by level", () => {
    const capture = new ConsoleCapture({ levels: ["error"] });
    capture.recordEntry("s1", { level: "log", message: "info", timestamp: "2024-01-01T00:00:00Z" });
    capture.recordEntry("s1", { level: "error", message: "fail", timestamp: "2024-01-01T00:00:00Z" });

    assert.strictEqual(capture.getEntries("s1").length, 1);
    assert.strictEqual(capture.getEntries("s1")[0].message, "fail");
  });

  it("isolates sessions", () => {
    const capture = new ConsoleCapture();
    capture.recordEntry("s1", { level: "log", message: "a", timestamp: "2024-01-01T00:00:00Z" });
    capture.recordEntry("s2", { level: "log", message: "b", timestamp: "2024-01-01T00:00:00Z" });

    assert.strictEqual(capture.getEntries("s1").length, 1);
    assert.strictEqual(capture.getEntries("s2").length, 1);
    assert.strictEqual(capture.getEntries("s1")[0].message, "a");
  });

  it("returns errors only", () => {
    const capture = new ConsoleCapture();
    capture.recordEntry("s1", { level: "log", message: "a", timestamp: "2024-01-01T00:00:00Z" });
    capture.recordEntry("s1", { level: "error", message: "b", timestamp: "2024-01-01T00:00:00Z" });
    capture.recordEntry("s1", { level: "warn", message: "c", timestamp: "2024-01-01T00:00:00Z" });

    const errors = capture.getErrors("s1");
    assert.strictEqual(errors.length, 2);
  });

  it("clears entries", () => {
    const capture = new ConsoleCapture();
    capture.recordEntry("s1", { level: "log", message: "a", timestamp: "2024-01-01T00:00:00Z" });
    capture.clear("s1");
    assert.strictEqual(capture.getEntries("s1").length, 0);
  });

  it("clears all", () => {
    const capture = new ConsoleCapture();
    capture.recordEntry("s1", { level: "log", message: "a", timestamp: "2024-01-01T00:00:00Z" });
    capture.recordEntry("s2", { level: "log", message: "b", timestamp: "2024-01-01T00:00:00Z" });
    capture.clearAll();
    assert.strictEqual(capture.getEntries("s1").length, 0);
    assert.strictEqual(capture.getEntries("s2").length, 0);
  });
});

describe("getGlobalConsoleCapture", () => {
  it("returns a singleton", () => {
    const a = getGlobalConsoleCapture();
    const b = getGlobalConsoleCapture();
    assert.strictEqual(a, b);
  });

  it("can be reset", () => {
    const a = getGlobalConsoleCapture();
    resetGlobalConsoleCapture();
    const b = getGlobalConsoleCapture();
    assert.notStrictEqual(a, b);
  });
});