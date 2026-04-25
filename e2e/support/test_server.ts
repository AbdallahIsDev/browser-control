import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import path from "node:path";

export interface LocalAppServer {
  url: string;
  port: number;
  pid?: number;
  close(): Promise<void>;
}

export function startLocalAppServer(): Promise<LocalAppServer> {
  const serverPath = path.join(process.cwd(), "e2e", "fixtures", "local-app", "server.cjs");
  const child = spawn(process.execPath, [serverPath], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: "0" },
    windowsHide: true,
  });
  return waitForServerReady(child);
}

type LocalServerProcess = ChildProcessByStdio<null, Readable, Readable>;

function waitForServerReady(child: LocalServerProcess): Promise<LocalAppServer> {
  let stdout = "";
  let stderr = "";

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      child.kill();
      reject(new Error(`Local app server did not start. stderr: ${stderr}`));
    }, 10000);

    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.off("data", onStdout);
      child.stderr.off("data", onStderr);
      child.off("exit", onExit);
    };

    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`Local app server exited before ready with code ${code}. stderr: ${stderr}`));
    };

    const onStderr = (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    };

    const onStdout = (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      const line = stdout.split(/\r?\n/).find((candidate) => candidate.trim().startsWith("{"));
      if (!line) return;
      try {
        const ready = JSON.parse(line) as { url: string; port: number };
        cleanup();
        resolve({
          url: ready.url,
          port: ready.port,
          pid: child.pid,
          close: () => closeChild(child),
        });
      } catch {
        // Wait for a complete JSON line.
      }
    };

    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.once("exit", onExit);
  });
}

function closeChild(child: LocalServerProcess): Promise<void> {
  if (child.exitCode !== null || child.killed) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 3000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}
