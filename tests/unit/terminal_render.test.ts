import { describe, it } from "node:test";
import * as assert from "node:assert";
import { buildTerminalView } from "../../src/terminal/render";
import type { TerminalSnapshot } from "../../src/terminal/types";

describe("Terminal Renderer", () => {
  it("converts terminal snapshot into browser terminal view", () => {
    const snapshot: TerminalSnapshot = {
      sessionId: "term-123",
      name: "build",
      shell: "bash",
      cwd: "/app",
      env: {},
      status: "running",
      lastOutput: "\x1b[32mSuccess\x1b[0m\nBuilding...",
      promptDetected: false,
      scrollbackLines: 2,
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString()
    };

    const view = buildTerminalView(snapshot);
    
    assert.strictEqual(view.terminalSessionId, "term-123");
    assert.strictEqual(view.title, "build");
    assert.strictEqual(view.status, "running");
    assert.strictEqual(view.canAcceptInput, false);
    assert.strictEqual(view.rows.length, 2);
    assert.strictEqual(view.rows[0].text, "Success"); // ansi stripped
    assert.strictEqual(view.rows[1].text, "Building...");
  });

  it("identifies idle state for input", () => {
    const snapshot: TerminalSnapshot = {
      sessionId: "term-123",
      shell: "bash",
      cwd: "/app",
      env: {},
      status: "idle",
      lastOutput: "$ ",
      promptDetected: true,
      scrollbackLines: 1,
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString()
    };

    const view = buildTerminalView(snapshot);
    assert.strictEqual(view.status, "idle");
    assert.strictEqual(view.canAcceptInput, true);
  });

  it("identifies idle without prompt as unable to accept input", () => {
    const snapshot: TerminalSnapshot = {
      sessionId: "term-123",
      shell: "bash",
      cwd: "/app",
      env: {},
      status: "idle",
      lastOutput: "waiting...",
      promptDetected: false,
      scrollbackLines: 1,
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString()
    };

    const view = buildTerminalView(snapshot);
    assert.strictEqual(view.status, "idle");
    assert.strictEqual(view.canAcceptInput, false);
  });

  it("identifies interrupted state as unable to accept input", () => {
    const snapshot: TerminalSnapshot = {
      sessionId: "term-123",
      shell: "bash",
      cwd: "/app",
      env: {},
      status: "interrupted",
      lastOutput: "^C",
      promptDetected: false,
      scrollbackLines: 1,
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString()
    };

    const view = buildTerminalView(snapshot);
    assert.strictEqual(view.status, "idle"); // maps to idle in view
    assert.strictEqual(view.canAcceptInput, false);
  });
});
