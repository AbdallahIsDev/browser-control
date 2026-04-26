import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  PUBLIC_SURFACE_FIXTURE_DIR,
  SNAPSHOTS,
  buildSnapshot,
  getActionResultContract,
  getCliCommandInventory,
  getConfigKeyInventory,
  getMcpToolInventory,
  getPersistedFormatInventory,
  stableJson,
} from "./public_surface";
import { runCli } from "../../cli";
import { failureResult, successResult, formatActionResult } from "../../action_result";

function readSnapshot(fileName: string): unknown {
  const filePath = path.join(PUBLIC_SURFACE_FIXTURE_DIR, fileName);
  assert.ok(
    fs.existsSync(filePath),
    `Missing compatibility snapshot ${fileName}. Run npm run compat:update to create it intentionally.`,
  );
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

for (const descriptor of SNAPSHOTS) {
  test(`${descriptor.fileName} matches current public surface`, async () => {
    const actual = await buildSnapshot(descriptor.fileName);
    const expected = readSnapshot(descriptor.fileName);
    assert.deepEqual(
      JSON.parse(stableJson(actual)),
      expected,
      `Public surface snapshot changed: ${descriptor.fileName}. Inspect diff, document compatibility impact, then run npm run compat:update only if intentional.`,
    );
  });
}

test("CLI help runs without starting daemon or browser", async () => {
  const writes: string[] = [];
  const originalLog = console.log;
  try {
    console.log = (...args: unknown[]) => {
      writes.push(args.map(String).join(" "));
    };
    await runCli(["node", "bc", "--help"]);
  } finally {
    console.log = originalLog;
  }

  const output = writes.join("\n");
  assert.match(output, /Browser Control CLI/);
  assert.match(output, /Usage: bc <command>/);
  assert.match(output, /mcp serve/);
});

test("CLI inventory includes required public commands", async () => {
  const inventory = await getCliCommandInventory() as {
    sections: Array<{ entries: Array<{ syntax: string }> }>;
  };
  const syntaxes = inventory.sections.flatMap((section) => section.entries.map((entry) => entry.syntax));
  for (const required of [
    "doctor",
    "setup",
    "config",
    "status",
    "mcp",
    "open",
    "snapshot",
    "click",
    "term",
    "fs",
    "service",
    "debug",
  ]) {
    assert.ok(
      syntaxes.some((syntax) => syntax === required || syntax.startsWith(`${required} `)),
      `CLI inventory missing required command: ${required}`,
    );
  }
});

test("MCP tool inventory has unique names and serializable schemas", () => {
  const inventory = getMcpToolInventory() as {
    tools: Array<{ name: string; category: string; description: string; inputSchema: unknown }>;
  };
  const names = inventory.tools.map((tool) => tool.name);
  assert.equal(new Set(names).size, names.length, "MCP tool names must be unique.");
  for (const tool of inventory.tools) {
    assert.ok(tool.description.trim(), `MCP tool ${tool.name} must have description.`);
    assert.notEqual(tool.category, "unknown", `MCP tool ${tool.name} must have category.`);
    assert.doesNotThrow(() => JSON.stringify(tool.inputSchema), `MCP tool ${tool.name} schema must be JSON serializable.`);
  }
});

test("config inventory and .env.example stay aligned", () => {
  const inventory = getConfigKeyInventory() as {
    configKeys: Array<{ key: string; envVars: string[] }>;
    envVars: Array<{ name: string; backedByConfigRegistry: boolean }>;
  };
  const configEnvVars = new Set(inventory.configKeys.flatMap((entry) => entry.envVars));
  const documented = new Set(inventory.envVars.map((entry) => entry.name));

  for (const envVar of configEnvVars) {
    assert.ok(documented.has(envVar), `.env.example missing public config env var: ${envVar}`);
  }

  assert.ok(inventory.configKeys.some((entry) => entry.key === "dataHome"));
  assert.ok(inventory.configKeys.some((entry) => entry.envVars.includes("OPENROUTER_API_KEY")));
});

test("ActionResult core fields remain present in success and failure results", () => {
  const success = formatActionResult(successResult({ ok: true }, { path: "command", sessionId: "s1" }));
  const failure = formatActionResult(failureResult("bad", { path: "a11y", sessionId: "s1" }));

  for (const result of [success, failure]) {
    assert.equal(typeof result.success, "boolean");
    assert.equal(typeof result.path, "string");
    assert.equal(typeof result.sessionId, "string");
    assert.equal(typeof result.completedAt, "string");
  }
  assert.ok("data" in success);
  assert.ok("error" in failure);

  const contract = getActionResultContract() as { coreFields: string[] };
  assert.ok(contract.coreFields.includes("debugBundleId"));
  assert.ok(contract.coreFields.includes("recoveryGuidance"));
});

test("persisted format inventory uses schema placeholders, not machine values", () => {
  const inventory = getPersistedFormatInventory() as Record<string, unknown>;
  const text = stableJson(inventory);
  const normalizedText = text.replace(/\\\\/g, "\\");
  assert.ok(!normalizedText.includes(os.homedir()), "persisted format inventory must not snapshot user home.");
  assert.ok(!normalizedText.includes(process.cwd()), "persisted format inventory must not snapshot repo path.");
  assert.ok(text.includes("services/registry.json"));
  assert.ok(text.includes("providers/registry.json"));
  assert.ok(text.includes("debug-bundles/"));
});
