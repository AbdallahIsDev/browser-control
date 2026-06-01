/**
 * Console Capture Tests — Verify bounded ring buffer and entry capture.
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { ConsoleCapture, getGlobalConsoleCapture, resetGlobalConsoleCapture } from "../../../src/observability/console_capture";

class FakePage {
  readonly handlers = new Map<string, Set<(payload: unknown) => void>>();

  on(event: string, handler: (payload: unknown) => void): void {
    const handlers = this.handlers.get(event) ?? new Set();
    handlers.add(handler);
    this.handlers.set(event, handlers);
  }

  off(event: string, handler: (payload: unknown) => void): void {
    this.handlers.get(event)?.delete(handler);
  }

  url(): string {
    return "https://example.com/page";
  }

  emit(event: string, payload: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(payload);
    }
  }
}

class FakeConsoleMessage {
  constructor(
    private readonly msgType: string,
    private readonly msgText: string,
    private readonly msgLocation: { url?: string; lineNumber?: number; columnNumber?: number } = {},
  ) {}

  type(): string {
    return this.msgType;
  }

  text(): string {
    return this.msgText;
  }

  location(): { url?: string; lineNumber?: number; columnNumber?: number } {
    return this.msgLocation;
  }
}

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

  it("deduplicates the same console event emitted by multiple CDP domains", () => {
    const capture = new ConsoleCapture();
    capture.recordEntry("s1", {
      level: "error",
      message: "bc-console-error-test",
      timestamp: "2026-04-27T14:16:06.100Z",
      source: "console-api",
      line: 1,
      column: 211,
      sessionId: "s1",
    });
    capture.recordEntry("s1", {
      level: "error",
      message: "bc-console-error-test",
      timestamp: "2026-04-27T14:16:06.200Z",
      sessionId: "s1",
    });
    capture.recordEntry("s1", {
      level: "error",
      message: "bc-console-error-test",
      timestamp: "2026-04-27T14:16:08.000Z",
      sessionId: "s1",
    });

    assert.strictEqual(capture.getEntries("s1").length, 2);
  });

  it("captures Playwright console events without enabling CDP domains", () => {
    const capture = new ConsoleCapture();
    const page = new FakePage();

    capture.startCapture("s1", page as any);
    page.emit("console", new FakeConsoleMessage("error", "boom", {
      url: "https://example.com/app.js",
      lineNumber: 12,
      columnNumber: 4,
    }));

    const entries = capture.getEntries("s1");
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].level, "error");
    assert.strictEqual(entries[0].message, "boom");
    assert.strictEqual(entries[0].source, "https://example.com/app.js");
    assert.strictEqual(entries[0].line, 12);
    assert.strictEqual(entries[0].column, 4);
    assert.strictEqual(entries[0].pageUrl, "https://example.com/page");
  });

  it("captures a replacement page for the same session when the old page did not close", () => {
    const capture = new ConsoleCapture();
    const stalePage = new FakePage();
    const replacementPage = new FakePage();

    capture.startCapture("s1", stalePage as any);
    capture.startCapture("s1", replacementPage as any);
    replacementPage.emit("console", new FakeConsoleMessage("error", "after-reconnect"));

    const entries = capture.getEntries("s1");
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].message, "after-reconnect");
  });

  it("removes Playwright console listener on stopCapture", () => {
    const capture = new ConsoleCapture();
    const page = new FakePage();

    capture.startCapture("s1", page as any);
    capture.stopCapture("s1", page as any);
    page.emit("console", new FakeConsoleMessage("error", "after-stop"));

    assert.strictEqual(capture.getEntries("s1").length, 0);
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
