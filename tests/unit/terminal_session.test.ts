import assert from "node:assert/strict";
import os from "node:os";
import test from "node:test";

import { detectShell, resolveNamedShell, isWindowsPlatform, platformShellName } from "../../cross_platform";
import { isPromptDetected, registerCustomPrompt, unregisterCustomPrompt, extractCwdFromPrompt } from "../../terminal_prompt";
import { TerminalSessionManager, getDefaultSessionManager, resetDefaultSessionManager } from "../../terminal_session";

// Ensure clean state before each test group
test.afterEach(async () => {
  // Clean up any lingering sessions in the default manager.
  // Wrap each close() with a 2-second timeout to prevent cleanup itself from hanging.
  const manager = getDefaultSessionManager();
  for (const session of manager.list()) {
    try {
      await Promise.race([
        session.close(),
        new Promise<void>((resolve) => setTimeout(resolve, 2000)),
      ]);
    } catch {
      // Session may already be closed or stuck — ignore cleanup errors
    }
  }
});

// ── Cross-Platform Tests ─────────────────────────────────────────────

test("cross_platform: detectShell returns a valid shell", () => {
  const shell = detectShell();
  assert.ok(shell.name.length > 0, "Shell name should not be empty");
  assert.ok(shell.path.length > 0, "Shell path should not be empty");
  assert.equal(shell.ptyCapable, true);
});

test("cross_platform: platformShellName returns correct value", () => {
  const name = platformShellName();
  if (isWindowsPlatform()) {
    assert.equal(name, "pwsh");
  } else {
    assert.equal(name, "bash");
  }
});

test("cross_platform: resolveNamedShell throws for nonexistent shell", () => {
  assert.throws(
    () => resolveNamedShell("nonexistent-shell-xyz-123"),
    /not found/,
  );
});

// ── Prompt Detection Tests ───────────────────────────────────────────

test("terminal_prompt: detects bash prompt", () => {
  assert.ok(isPromptDetected("user@host:~/dir$ "));
  assert.ok(isPromptDetected("user@host:/home/user$ "));
  assert.ok(isPromptDetected("root@host:/# "));
});

test("terminal_prompt: detects simple $ prompt", () => {
  assert.ok(isPromptDetected("some output\n$ "));
  assert.ok(isPromptDetected("some output\n# "));
});

test("terminal_prompt: detects PowerShell prompt", () => {
  assert.ok(isPromptDetected("PS C:\\Users\\test> "));
  assert.ok(isPromptDetected("PS /home/user> "));
});

test("terminal_prompt: does not detect prompt in middle of output", () => {
  assert.ok(!isPromptDetected("this is just text without a prompt"));
  assert.ok(!isPromptDetected(""));
});

test("terminal_prompt: registerCustomPrompt works", () => {
  const sessionId = "test-session-123";
  registerCustomPrompt(sessionId, /^MY_PROMPT>$/);

  assert.ok(isPromptDetected("some output\nMY_PROMPT>", sessionId));

  unregisterCustomPrompt(sessionId);
  // After unregister, custom prompt should not match
  assert.ok(!isPromptDetected("some output\nMY_PROMPT>", sessionId));
});

test("terminal_prompt: extractCwdFromPrompt extracts bash path", () => {
  const cwd = extractCwdFromPrompt("user@host:~/projects/myapp$ ");
  assert.equal(cwd, "~/projects/myapp");
});

test("terminal_prompt: extractCwdFromPrompt extracts PowerShell path", () => {
  const cwd = extractCwdFromPrompt("PS C:\\Users\\test> ");
  assert.equal(cwd, "C:\\Users\\test");
});

test("terminal_prompt: extractCwdFromPrompt returns null for unrecognized", () => {
  const cwd = extractCwdFromPrompt("just some text");
  assert.equal(cwd, null);
});

function sessionEchoCommand(): string {
  return os.platform() === "win32"
    ? 'Write-Output "session-hello"'
    : 'printf "session-hello\\n"';
}

test("terminal_session: create, exec, snapshot, and close a real session", { timeout: 20000 }, async () => {
  const manager = new TerminalSessionManager();
  const session = await manager.create();

  try {
    const result = await session.exec(sessionEchoCommand(), { timeoutMs: 5000 });
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes("session-hello"));

    const snapshot = await session.snapshot();
    assert.equal(snapshot.sessionId, session.id);
    assert.equal(snapshot.status, "idle");
    assert.ok(snapshot.cwd.length > 0);
  } finally {
    await manager.closeAll();
  }
});

// ── Process-Exit Regression Harness ────────────────────────────────────
// Spawns the test suite as a child process and verifies it exits cleanly
// within a timeout. This proves that PTY handles are properly released
// and do not keep the Node.js event loop alive after close().

test("regression: test process exits cleanly after PTY session lifecycle", { timeout: 30000 }, async () => {
  const { spawn: childSpawn } = await import("node:child_process");
  const tsNode = "node";
  const args = [
    "--require", "ts-node/register",
    "--require", "tsconfig-paths/register",
    "--test", "terminal_session.test.ts",
    "--test-name-pattern", "create, exec, snapshot, and close a real session",
  ];

  const child = childSpawn(tsNode, args, {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer | string) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk: Buffer | string) => { stderr += chunk.toString(); });

  // The child must exit within 20 seconds. If PTY handles leak,
  // the child process will hang and this timeout will fire.
  const exitCode = await new Promise<number>((resolve) => {
    const timeout = setTimeout(() => {
      child.kill();
      resolve(-1);
    }, 20000);
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve(code ?? -1);
    });
  });

  assert.notEqual(exitCode, -1, "Test child process did not exit within 20s — PTY handles may be leaking");
  assert.equal(exitCode, 0, `Test child process exited with code ${exitCode}, expected 0. stderr: ${stderr.slice(0, 500)}`);
});
