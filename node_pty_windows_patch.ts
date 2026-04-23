import type * as ChildProcessNs from "node:child_process";

const mutableChildProcess = require("node:child_process") as typeof ChildProcessNs & {
  fork: typeof import("node:child_process").fork;
};

let patched = false;

export function applyNodePtyWindowsForkPatch(): void {
  if (patched || process.platform !== "win32") {
    return;
  }

  const originalFork = mutableChildProcess.fork;
  mutableChildProcess.fork = function patchedFork(...forkArgs: any[]) {
    const modulePath = forkArgs[0];
    const modulePathText = typeof modulePath === "string" ? modulePath : String(modulePath);
    const isNodePtyConsoleAgent = /conpty_console_list_agent/i.test(modulePathText);

    if (isNodePtyConsoleAgent) {
      if (Array.isArray(forkArgs[1])) {
        forkArgs[2] = { ...(forkArgs[2] ?? {}), windowsHide: true };
      } else {
        forkArgs[1] = { ...(forkArgs[1] ?? {}), windowsHide: true };
      }
    }

    return (originalFork as any).apply(mutableChildProcess, forkArgs);
  };

  patched = true;
}

applyNodePtyWindowsForkPatch();
