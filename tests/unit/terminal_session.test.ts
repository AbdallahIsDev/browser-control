import assert from "node:assert/strict";
import os from "node:os";
import test from "node:test";

import { detectShell, resolveNamedShell, isWindowsPlatform, platformShellName } from "../../src/cross_platform";
import { isPromptDetected, registerCustomPrompt, unregisterCustomPrompt, extractCwdFromPrompt } from "../../src/terminal_prompt";
import { PtyTerminalSession, TerminalSessionManager, getDefaultSessionManager, resetDefaultSessionManager } from "../../src/terminal_session";

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

test("terminal_session: interrupt waits for prompt before marking idle", { timeout: 5000 }, async () => {
  const session = new PtyTerminalSession(
    "interrupt-unit",
    {
      name: "mock-shell",
      path: "mock-shell",
      args: [],
      family: "posix",
      ptyCapable: true,
    },
    {},
  );
  const internals = session as unknown as {
    _process: { write(data: string): void };
    _outputBuffer: string;
    _status: string;
    _runningCommand?: string;
  };
  const writes: string[] = [];
  internals._process = {
    write(data: string) {
      writes.push(data);
      setTimeout(() => {
        internals._outputBuffer += "\n$ ";
      }, 180);
    },
  };
  internals._status = "running";
  internals._runningCommand = "sleep 10";

  const start = Date.now();
  await session.interrupt();
  const elapsedMs = Date.now() - start;

  assert.deepEqual(writes, ["\x03"]);
  assert.ok(elapsedMs >= 150, `interrupt returned before prompt: ${elapsedMs}ms`);
  assert.equal(session.status, "idle");
  assert.equal(internals._runningCommand, undefined);
});

test("terminal_session: exec resolves from data event when end marker arrives", { timeout: 5000 }, async () => {
  const session = new PtyTerminalSession(
    "event-wait-unit",
    {
      name: "mock-shell",
      path: "mock-shell",
      args: [],
      family: "posix",
      ptyCapable: true,
    },
    {},
  );
  const internals = session as unknown as {
    _process: { write(data: string): void };
    _outputBuffer: string;
    _dataListeners: Set<(data: string) => void>;
  };
  let endMarkerAt = 0;
  const emit = (data: string): void => {
    internals._outputBuffer += data;
    for (const listener of internals._dataListeners) {
      listener(data);
    }
  };

  internals._process = {
    write(data: string) {
      const startMarker = data.match(/(__BC_S_[0-9a-f]+__)/)?.[1];
      if (startMarker) {
        emit(`${startMarker}\n`);
      }

      const endMarkerBase = data.match(/(__BC_E_[0-9a-f]+)/)?.[1];
      if (endMarkerBase) {
        setTimeout(() => {
          endMarkerAt = Date.now();
          emit(`event-output\n${endMarkerBase}:0\n`);
        }, 5);
      }
    },
  };

  const result = await session.exec("echo event-output", { timeoutMs: 1000 });
  const elapsedAfterMarkerMs = Date.now() - endMarkerAt;

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /event-output/);
  assert.ok(endMarkerAt > 0, "test did not emit the end marker");
  assert.ok(
    elapsedAfterMarkerMs < 35,
    `exec waited ${elapsedAfterMarkerMs}ms after end marker instead of resolving from the data event`,
  );
});

test("terminal_session: exec waiter resolves when session closes without more output", { timeout: 5000 }, async () => {
  const session = new PtyTerminalSession(
    "event-close-unit",
    {
      name: "mock-shell",
      path: "mock-shell",
      args: [],
      family: "posix",
      ptyCapable: true,
    },
    {},
  );
  const internals = session as unknown as {
    _process: { write(data: string): void; kill(): void };
    _outputBuffer: string;
  };
  let closedAt = 0;

  internals._process = {
    write(data: string) {
      const startMarker = data.match(/(__BC_S_[0-9a-f]+__)/)?.[1];
      if (startMarker) {
        internals._outputBuffer += `${startMarker}\n`;
      }
    },
    kill() {},
  };

  const execPromise = session.exec("sleep forever", { timeoutMs: 1000 });
  setTimeout(() => {
    closedAt = Date.now();
    void session.close();
  }, 5);

  const result = await execPromise;
  const elapsedAfterCloseMs = Date.now() - closedAt;

  assert.equal(result.exitCode, 1);
  assert.ok(closedAt > 0, "test did not close the session");
  assert.ok(
    elapsedAfterCloseMs < 35,
    `exec waited ${elapsedAfterCloseMs}ms after close instead of resolving from lifecycle event`,
  );
});

function sessionEchoCommand(): string {
  return os.platform() === "win32"
    ? 'Write-Output "session-hello"'
    : 'printf "session-hello\\n"';
}

function slowSessionCommand(): string {
  return os.platform() === "win32"
    ? 'Start-Sleep -Milliseconds 800; Write-Output "first-done"'
    : 'sleep 0.8; printf "first-done\\n"';
}

function errorLookingStdoutCommand(): string {
  return os.platform() === "win32"
    ? 'Write-Output "Error: Connection successful"; Write-Output "bash: not an error"'
    : 'printf "Error: Connection successful\\nbash: not an error\\n"';
}

function sentinelLookingStdoutCommand(): string {
  return os.platform() === "win32"
    ? 'Write-Output "keep __BC_S_123__ user data"; Write-Output "keep __BC_E_123:0 user data"; Write-Output "before }; after"'
    : 'printf "keep __BC_S_123__ user data\\nkeep __BC_E_123:0 user data\\nbefore }; after\\n"';
}

test("terminal_session: create, exec, snapshot, and close a real session", { timeout: 20000 }, async () => {
  const manager = new TerminalSessionManager();
  const session = await manager.create();

  try {
    const result = await session.exec(sessionEchoCommand(), { timeoutMs: 5000 });
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes("session-hello"));
    assert.doesNotMatch(result.stdout, /__BC_[SE]_/);
    assert.doesNotMatch(result.stdout, /\$__bc_success|Write-Output/);

    const readOutput = await session.read();
    assert.ok(readOutput.includes("session-hello"));
    assert.doesNotMatch(readOutput, /__BC_[SE]_/);
    assert.doesNotMatch(readOutput, /\$__bc_success|Write-Output/);

    const snapshot = await session.snapshot();
    assert.equal(snapshot.sessionId, session.id);
    assert.equal(snapshot.status, "idle");
    assert.ok(snapshot.cwd.length > 0);
  } finally {
    await manager.closeAll();
  }
});

test("terminal_session: PTY exec keeps merged output in stdout", { timeout: 20000 }, async () => {
  const manager = new TerminalSessionManager();
  const session = await manager.create();

  try {
    const result = await session.exec(errorLookingStdoutCommand(), { timeoutMs: 5000 });
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Error: Connection successful/);
    assert.match(result.stdout, /bash: not an error/);
    assert.equal(result.stderr, "");
  } finally {
    await manager.closeAll();
  }
});

test("terminal_session: PTY exec preserves user data that resembles control markers", { timeout: 20000 }, async () => {
  const manager = new TerminalSessionManager();
  const session = await manager.create();

  try {
    const result = await session.exec(sentinelLookingStdoutCommand(), { timeoutMs: 5000 });
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /keep __BC_S_123__ user data/);
    assert.match(result.stdout, /keep __BC_E_123:0 user data/);
    assert.match(result.stdout, /before \}; after/);
    assert.doesNotMatch(result.stdout, /\$__bc_success|Write-Output/);
  } finally {
    await manager.closeAll();
  }
});

test("terminal_session: rejects concurrent exec calls on the same session", { timeout: 20000 }, async () => {
  const manager = new TerminalSessionManager();
  const session = await manager.create();

  try {
    const firstExec = session.exec(slowSessionCommand(), { timeoutMs: 5000 });

    await assert.rejects(
      () => session.exec(sessionEchoCommand(), { timeoutMs: 5000 }),
      /already executing a command/,
    );

    const result = await firstExec;
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /first-done/);

    const snapshot = await session.snapshot();
    assert.equal(snapshot.status, "idle");
    assert.equal(snapshot.runningCommand, undefined);
  } finally {
    await manager.closeAll();
  }
});

test("terminal_session: snapshot redacts secret environment values", { timeout: 20000 }, async () => {
  const manager = new TerminalSessionManager();
  const session = await manager.create({
    env: {
      NEXIUM_API_KEY: "secret-value",
      NORMAL_ENV_VALUE: "safe-value",
    },
  });

  try {
    const snapshot = await session.snapshot();
    assert.equal(snapshot.env.NEXIUM_API_KEY, "[REDACTED]");
    assert.equal(snapshot.env.NORMAL_ENV_VALUE, "safe-value");
    assert.notDeepStrictEqual(snapshot.env, session.env);
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
    "--test", "tests/unit/terminal_session.test.ts",
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
