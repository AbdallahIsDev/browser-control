import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createBrowserControl } from "../../browser_control";
import type { BrowserControlAPI } from "../../browser_control";
import { buildToolRegistry } from "../../src/mcp/tool_registry";
import { MemoryStore } from "../../memory_store";

function makeHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bc-operator-api-"));
}

test("BrowserControl API exposes config and status namespaces", async () => {
  const home = makeHome();
  const previousHome = process.env.BROWSER_CONTROL_HOME;
  const store = new MemoryStore({ filename: ":memory:" });
  let bc: BrowserControlAPI | null = null;
  try {
    process.env.BROWSER_CONTROL_HOME = home;
    bc = createBrowserControl({ memoryStore: store });

    assert.equal(typeof bc.config.list, "function");
    assert.equal(typeof bc.config.get, "function");
    assert.equal(typeof bc.config.set, "function");
    assert.equal(typeof bc.status, "function");

    const setResult = bc.config.set("logLevel", "debug");
    assert.equal(setResult.data?.value, "debug");

    const getResult = bc.config.get("logLevel");
    assert.equal(getResult.value, "debug");

    const status = await bc.status();
    assert.equal(status.dataHome, home);
    assert.ok(["running", "stopped", "degraded"].includes(status.daemon.state));

  } finally {
    bc?.close();
    if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
    else process.env.BROWSER_CONTROL_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("MCP registry exposes bc_status and handler returns status data", async () => {
  const home = makeHome();
  const previousHome = process.env.BROWSER_CONTROL_HOME;
  const store = new MemoryStore({ filename: ":memory:" });
  let api: BrowserControlAPI | null = null;
  try {
    process.env.BROWSER_CONTROL_HOME = home;
    api = createBrowserControl({ memoryStore: store });
    const tools = buildToolRegistry(api);
    const statusTool = tools.find((tool) => tool.name === "bc_status");

    assert.ok(statusTool, "bc_status should be registered");
    const result = await statusTool!.handler({});
    assert.equal(result.success, true);
    assert.ok(result.data);
    assert.equal((result.data as { dataHome: string }).dataHome, home);

  } finally {
    api?.close();
    if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
    else process.env.BROWSER_CONTROL_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
