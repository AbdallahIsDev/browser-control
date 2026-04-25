import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface McpGoldenHarness {
  homeDir: string;
  port: string;
  pid?: number;
  pids: number[];
  transport: StdioClientTransport;
  client: Client;
  readStartupStdout(ms: number): Promise<string>;
  close(): Promise<void>;
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.killed) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

export function createMcpGoldenHarness(): McpGoldenHarness {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-e2e-mcp-home-"));
  const port = String(31000 + Math.floor(Math.random() * 20000));
  const pids: number[] = [];
  const env = {
    ...process.env,
    BROWSER_CONTROL_HOME: homeDir,
    BROKER_PORT: port,
  } as Record<string, string>;

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["-r", "ts-node/register", "-r", "tsconfig-paths/register", "cli.ts", "mcp", "serve"],
    cwd: process.cwd(),
    env,
    stderr: "pipe",
  });

  const client = new Client(
    { name: "bc-e2e-golden-client", version: "1.0.0" },
    { capabilities: {} },
  );

  return {
    homeDir,
    port,
    pids,
    transport,
    client,
    async readStartupStdout(ms: number): Promise<string> {
      const child = spawn(process.execPath, ["-r", "ts-node/register", "-r", "tsconfig-paths/register", "cli.ts", "mcp", "serve"], {
        cwd: process.cwd(),
        env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      if (child.pid) pids.push(child.pid);
      let stdout = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      await new Promise((resolve) => setTimeout(resolve, ms));
      await waitForExit(child, 3000);
      return stdout;
    },
    async close(): Promise<void> {
      try {
        await client.close();
      } catch {
        // best effort
      }
      try {
        await transport.close();
      } catch {
        // best effort
      }
    },
  };
}
