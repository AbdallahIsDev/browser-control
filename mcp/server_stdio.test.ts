import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

interface Harness {
  homeDir: string;
  transport: StdioClientTransport;
  client: Client;
}

const harnesses = new Set<Harness>();

function createHarness(): Harness {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-mcp-stdio-"));
  const port = String(30000 + Math.floor(Math.random() * 10000));

  const transport = new StdioClientTransport({
    command: "node",
    args: ["-r", "ts-node/register", "-r", "tsconfig-paths/register", "cli.ts", "mcp", "serve"],
    cwd: process.cwd(),
    env: {
      ...process.env,
      BROWSER_CONTROL_HOME: homeDir,
      BROKER_PORT: port,
    } as Record<string, string>,
    stderr: "pipe",
  });

  const client = new Client(
    {
      name: "mcp-stdio-test-client",
      version: "1.0.0",
    },
    {
      capabilities: {},
    },
  );

  const harness = { homeDir, transport, client };
  harnesses.add(harness);
  return harness;
}

afterEach(async () => {
  for (const harness of harnesses) {
    try {
      await harness.client.close();
    } catch {
      // best effort
    }
    try {
      await harness.transport.close();
    } catch {
      // best effort
    }
    try {
      fs.rmSync(harness.homeDir, { force: true, recursive: true });
    } catch {
      // best effort
    }
    harnesses.delete(harness);
  }
});

describe("MCP stdio server", () => {
  it("does not write plain log lines to stdout on startup", async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-mcp-raw-"));
    const port = String(30000 + Math.floor(Math.random() * 10000));
    const child = spawn(
      "node",
      ["-r", "ts-node/register", "-r", "tsconfig-paths/register", "cli.ts", "mcp", "serve"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          BROWSER_CONTROL_HOME: homeDir,
          BROKER_PORT: port,
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    await new Promise((resolve) => setTimeout(resolve, 2500));
    child.kill("SIGTERM");
    try {
      fs.rmSync(homeDir, { force: true, recursive: true });
    } catch {
      // best effort
    }

    assert.equal(stdout, "", `MCP stdio server wrote non-protocol data to stdout:\n${stdout}`);
  });

  it("serves tools/list over clean stdio protocol", async () => {
    const harness = createHarness();

    await harness.client.connect(harness.transport);
    const result = await harness.client.listTools();

    assert.ok(result.tools.some((tool) => tool.name === "bc_browser_open"));
    assert.ok(result.tools.some((tool) => tool.name === "bc_session_status"));
  });
});
