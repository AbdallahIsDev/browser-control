import test from "node:test";
import assert from "node:assert/strict";
import type * as ChildProcessNs from "node:child_process";

const mutableChildProcess = require("node:child_process") as typeof ChildProcessNs & {
  fork: typeof import("node:child_process").fork;
};

test("applyNodePtyWindowsForkPatch forces windowsHide for node-pty console list agent", async () => {
  if (process.platform !== "win32") {
    return;
  }

  const originalFork = mutableChildProcess.fork;
  const calls: unknown[] = [];

  try {
    mutableChildProcess.fork = function fakeFork(...forkArgs: any[]) {
      calls.push({
        modulePath: forkArgs[0],
        args: Array.isArray(forkArgs[1]) ? forkArgs[1] : undefined,
        options: Array.isArray(forkArgs[1]) ? forkArgs[2] : forkArgs[1],
      });
      return {} as ReturnType<typeof mutableChildProcess.fork>;
    };

    const mod = await import("../../node_pty_windows_patch");
    mod.applyNodePtyWindowsForkPatch();

    mutableChildProcess.fork("C:\\temp\\conpty_console_list_agent.js", ["123"], {});

    assert.equal(calls.length, 1);
    const first = calls[0] as { options?: { windowsHide?: boolean } };
    assert.equal(first.options?.windowsHide, true);
  } finally {
    mutableChildProcess.fork = originalFork;
  }
});
