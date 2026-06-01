import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { bindMcpShutdownHandlers } from "../../../src/mcp/server";

interface Harness {
  homeDir: string;
  transport: StdioClientTransport;
  client: Client;
}

type ToolCallResult = {
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
};

const harnesses = new Set<Harness>();

function createHarness(): Harness {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-mcp-stdio-"));
  const port = String(30000 + Math.floor(Math.random() * 10000));

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["-r", "ts-node/register", "-r", "tsconfig-paths/register", path.join(process.cwd(), "src", "cli.ts"), "mcp", "serve"],
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
  it("cleans Browser Control resources when stdio transport closes", async () => {
    const signals = new EventEmitter();
    const stdin = new EventEmitter();
    let browserControlClosed = 0;
    let serverClosed = 0;
    let transportClosed = 0;
    let exitCode: number | undefined;

    const transport = {
      onclose: undefined as (() => void) | undefined,
      async close() {
        transportClosed += 1;
        this.onclose?.();
      },
    };

    const server = {
      onclose: undefined as (() => void) | undefined,
      async close() {
        serverClosed += 1;
        transport.onclose?.();
      },
    };

    bindMcpShutdownHandlers({
      bc: {
        close() {
          browserControlClosed += 1;
        },
      },
      exit(code) {
        exitCode = code;
      },
      server,
      signalTarget: signals,
      stdin,
      transport,
    });

    transport.onclose?.();
    stdin.emit("end");
    signals.emit("SIGTERM");
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(browserControlClosed, 1);
    assert.equal(serverClosed, 1);
    assert.equal(transportClosed, 1);
    assert.equal(exitCode, 0);
  });

  it("does not write plain log lines to stdout on startup", async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-mcp-raw-"));
    const port = String(30000 + Math.floor(Math.random() * 10000));
    const child = spawn(
      process.execPath,
      ["-r", "ts-node/register", "-r", "tsconfig-paths/register", path.join(process.cwd(), "src", "cli.ts"), "mcp", "serve"],
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

    assert.ok(result.tools.some((tool) => tool.name === "bc_open"));
    assert.ok(result.tools.some((tool) => tool.name === "bc_session_status"));
    assert.match(harness.client.getInstructions() ?? "", /hidden string sessionId override/);
    assert.ok(result.tools.every((tool) => !("sessionId" in (tool.inputSchema.properties ?? {}))));
  });

  it("filters tools/list by the active safe policy profile", async () => {
    const harness = createHarness();

    await harness.client.connect(harness.transport);
    const created = await harness.client.callTool({
      name: "bc_session_create",
      arguments: { name: "safe-session", policyProfile: "safe" },
    }) as ToolCallResult;
    assert.equal(created.isError, false);

    const result = await harness.client.listTools();
    const names = result.tools.map((tool) => tool.name);

    assert.ok(names.includes("bc_open"));
    assert.ok(names.includes("bc_session_status"));
    assert.ok(!names.includes("bc_cdp"));
    assert.ok(!names.includes("bc_fs_delete"));
    assert.ok(!names.includes("bc_terminal_exec"));

    const hiddenCdp = await harness.client.callTool({
      name: "bc_cdp",
      arguments: { method: "Runtime.evaluate", timeoutMs: 1000 },
    }) as ToolCallResult;
    assert.equal(hiddenCdp.isError, true);
    assert.match(hiddenCdp.content[0].text, /Unknown tool: bc_cdp/);

    const hiddenFsDelete = await harness.client.callTool({
      name: "bc_fs_delete",
      arguments: { path: "hidden-tool-check.txt" },
    }) as ToolCallResult;
    assert.equal(hiddenFsDelete.isError, true);
    assert.match(hiddenFsDelete.content[0].text, /Unknown tool: bc_fs_delete/);
  });

  it("rejects unknown and invalid tool parameters before handlers run", async () => {
    const harness = createHarness();

    await harness.client.connect(harness.transport);

    const unknown = await harness.client.callTool({
      name: "bc_scroll",
      arguments: { direction: "down", expression: "window.scrollBy(0, 500)" },
    }) as ToolCallResult;
    assert.equal(unknown.isError, true);
    assert.match(unknown.content[0].text, /Unknown parameter 'expression' for tool 'bc_scroll'/);
    assert.match(unknown.content[0].text, /Allowed: direction, amount, tabId/);
    assert.doesNotMatch(unknown.content[0].text, /sessionId/);

    const missing = await harness.client.callTool({
      name: "bc_scroll",
      arguments: { amount: 500 },
    }) as ToolCallResult;
    assert.equal(missing.isError, true);
    assert.match(missing.content[0].text, /Missing required parameter 'direction' for tool 'bc_scroll'/);

    const invalid = await harness.client.callTool({
      name: "bc_scroll",
      arguments: { direction: "sideways" },
    }) as ToolCallResult;
    assert.equal(invalid.isError, true);
    assert.match(invalid.content[0].text, /Invalid value 'sideways' for parameter 'direction' on tool 'bc_scroll'/);

    const conditional = await harness.client.callTool({
      name: "bc_act",
      arguments: { action: "click" },
    }) as ToolCallResult;
    assert.equal(conditional.isError, true);
    assert.match(conditional.content[0].text, /Missing required parameter 'target'.*action.*click/);
  });
});
