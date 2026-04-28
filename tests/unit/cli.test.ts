import assert from "node:assert/strict";
import test from "node:test";

import { parseArgs } from "../../src/cli";

test("parseArgs parses commands correctly", () => {
  const result = parseArgs(["node", "cli.ts", "run", "--skill=test", "--action=click"]);
  assert.equal(result.command, "run");
  assert.equal(result.subcommand, undefined);
  assert.deepEqual(result.flags, { skill: "test", action: "click" });
  assert.deepEqual(result.positional, []);
});

test("parseArgs parses subcommands correctly", () => {
  const result = parseArgs(["node", "cli.ts", "daemon", "start"]);
  assert.equal(result.command, "daemon");
  assert.equal(result.subcommand, "start");
  assert.deepEqual(result.flags, {});
  assert.deepEqual(result.positional, []);
});

test("parseArgs parses positional arguments", () => {
  const result = parseArgs(["node", "cli.ts", "memory", "set", "key1", "value1"]);
  assert.equal(result.command, "memory");
  assert.equal(result.subcommand, "set");
  assert.deepEqual(result.positional, ["key1", "value1"]);
});

test("parseArgs parses mixed flags and positional", () => {
  const result = parseArgs([
    "node", "cli.ts", "schedule", "my-task",
    "--cron=*/5 * * * *",
    "--skill=navigation",
    "--action=open",
    "--params={'url':'example.com'}"
  ]);
  assert.equal(result.command, "schedule");
  assert.equal(result.subcommand, "my-task");
  assert.deepEqual(result.flags, {
    cron: "*/5 * * * *",
    skill: "navigation",
    action: "open",
    params: "{'url':'example.com'}"
  });
  assert.deepEqual(result.positional, []);
});

test("parseArgs handles boolean flags", () => {
  const result = parseArgs(["node", "cli.ts", "run", "--skill=test", "--json"]);
  assert.equal(result.command, "run");
  assert.equal(result.flags.skill, "test");
  assert.equal(result.flags.json, "true");
});

test("parseArgs handles space-separated service flag values", () => {
  const result = parseArgs([
    "node",
    "cli.ts",
    "service",
    "register",
    "app",
    "--port",
    "5173",
    "--cwd",
    "C:\\project",
    "--json",
  ]);

  assert.equal(result.command, "service");
  assert.equal(result.subcommand, "register");
  assert.deepEqual(result.positional, ["app"]);
  assert.equal(result.flags.port, "5173");
  assert.equal(result.flags.cwd, "C:\\project");
  assert.equal(result.flags.json, "true");
});

test("parseArgs handles space-separated provider flag values", () => {
  const result = parseArgs([
    "node",
    "cli.ts",
    "browser",
    "provider",
    "add",
    "browserless",
    "--type",
    "browserless",
    "--endpoint",
    "wss://browserless.example.test",
    "--json",
  ]);

  assert.equal(result.command, "browser");
  assert.equal(result.subcommand, "provider");
  assert.deepEqual(result.positional, ["add", "browserless"]);
  assert.equal(result.flags.type, "browserless");
  assert.equal(result.flags.endpoint, "wss://browserless.example.test");
  assert.equal(result.flags.json, "true");
});

test("parseArgs handles empty args", () => {
  const result = parseArgs(["node", "cli.ts"]);
  assert.equal(result.command, "");
  assert.equal(result.subcommand, undefined);
  assert.deepEqual(result.flags, {});
  assert.deepEqual(result.positional, []);
});

test("parseArgs handles help flags", () => {
  const result1 = parseArgs(["node", "cli.ts", "--help"]);
  assert.equal(result1.flags.help, "true");

  const result2 = parseArgs(["node", "cli.ts", "-h"]);
  assert.equal(result2.flags.h, "true");
});

test("parseArgs handles complex schedule command", () => {
  const result = parseArgs([
    "node", "cli.ts", "schedule", "list"
  ]);
  assert.equal(result.command, "schedule");
  assert.equal(result.subcommand, "list");
});

test("parseArgs handles proxy add with positional URL", () => {
  const result = parseArgs([
    "node", "cli.ts", "proxy", "add", "http://proxy.example.com:8080"
  ]);
  assert.equal(result.command, "proxy");
  assert.equal(result.subcommand, "add");
  assert.deepEqual(result.positional, ["http://proxy.example.com:8080"]);
});

test("parseArgs handles captcha test command", () => {
  const result = parseArgs([
    "node", "cli.ts", "captcha", "test",
  ]);
  assert.equal(result.command, "captcha");
  assert.equal(result.subcommand, "test");
});

test("parseArgs handles captcha test with --json", () => {
  const result = parseArgs([
    "node", "cli.ts", "captcha", "test", "--json",
  ]);
  assert.equal(result.command, "captcha");
  assert.equal(result.subcommand, "test");
  assert.equal(result.flags.json, "true");
});

test("parseArgs handles flags with equals in value", () => {
  const result = parseArgs([
    "node", "cli.ts", "run",
    "--params={'key':'value=with=equals'}"
  ]);
  assert.equal(result.command, "run");
  assert.equal(result.flags.params, "{'key':'value=with=equals'}");
});

test("parseArgs handles multiple positional after subcommand", () => {
  const result = parseArgs([
    "node", "cli.ts", "memory", "get", "mykey"
  ]);
  assert.equal(result.command, "memory");
  assert.equal(result.subcommand, "get");
  assert.deepEqual(result.positional, ["mykey"]);
});

test("parseArgs handles daemon stop command", () => {
  const result = parseArgs([
    "node", "cli.ts", "daemon", "stop"
  ]);
  assert.equal(result.command, "daemon");
  assert.equal(result.subcommand, "stop");
});

test("parseArgs handles report view command", () => {
  const result = parseArgs([
    "node", "cli.ts", "report", "view", "--json"
  ]);
  assert.equal(result.command, "report");
  assert.equal(result.subcommand, "view");
  assert.equal(result.flags.json, "true");
});

// ── Skill Command Parsing ──────────────────────────────────────────────

test("parseArgs handles skill list command", () => {
  const result = parseArgs(["node", "cli.ts", "skill", "list"]);
  assert.equal(result.command, "skill");
  assert.equal(result.subcommand, "list");
});

test("parseArgs handles skill list with --json", () => {
  const result = parseArgs(["node", "cli.ts", "skill", "list", "--json"]);
  assert.equal(result.command, "skill");
  assert.equal(result.subcommand, "list");
  assert.equal(result.flags.json, "true");
});

test("parseArgs handles skill health with skill name", () => {
  const result = parseArgs(["node", "cli.ts", "skill", "health", "framer"]);
  assert.equal(result.command, "skill");
  assert.equal(result.subcommand, "health");
  assert.deepEqual(result.positional, ["framer"]);
});

test("parseArgs handles skill actions with skill name", () => {
  const result = parseArgs(["node", "cli.ts", "skill", "actions", "framer"]);
  assert.equal(result.command, "skill");
  assert.equal(result.subcommand, "actions");
  assert.deepEqual(result.positional, ["framer"]);
});

test("parseArgs handles skill install with directory path", () => {
  const result = parseArgs(["node", "cli.ts", "skill", "install", "/path/to/my-skill"]);
  assert.equal(result.command, "skill");
  assert.equal(result.subcommand, "install");
  assert.deepEqual(result.positional, ["/path/to/my-skill"]);
});

test("parseArgs handles skill validate with name-or-path", () => {
  const result = parseArgs(["node", "cli.ts", "skill", "validate", "framer"]);
  assert.equal(result.command, "skill");
  assert.equal(result.subcommand, "validate");
  assert.deepEqual(result.positional, ["framer"]);
});

test("parseArgs handles skill validate with path and --json", () => {
  const result = parseArgs(["node", "cli.ts", "skill", "validate", "./skills/my-skill", "--json"]);
  assert.equal(result.command, "skill");
  assert.equal(result.subcommand, "validate");
  assert.deepEqual(result.positional, ["./skills/my-skill"]);
  assert.equal(result.flags.json, "true");
});

test("parseArgs handles skill remove with skill name", () => {
  const result = parseArgs(["node", "cli.ts", "skill", "remove", "my-skill"]);
  assert.equal(result.command, "skill");
  assert.equal(result.subcommand, "remove");
  assert.deepEqual(result.positional, ["my-skill"]);
});

// ── CLI-level term/fs command tests (Issue 2) ───────────────────────

test("parseArgs handles term exec command", () => {
  const result = parseArgs(["node", "cli.ts", "term", "exec", "echo hello", "--json"]);
  assert.equal(result.command, "term");
  assert.equal(result.subcommand, "exec");
  assert.deepEqual(result.positional, ["echo hello"]);
  assert.equal(result.flags.json, "true");
});

test("parseArgs handles term list command", () => {
  const result = parseArgs(["node", "cli.ts", "term", "list", "--json"]);
  assert.equal(result.command, "term");
  assert.equal(result.subcommand, "list");
  assert.equal(result.flags.json, "true");
});

test("parseArgs handles fs read command", () => {
  const result = parseArgs(["node", "cli.ts", "fs", "read", "/tmp/test.txt", "--json"]);
  assert.equal(result.command, "fs");
  assert.equal(result.subcommand, "read");
  assert.deepEqual(result.positional, ["/tmp/test.txt"]);
  assert.equal(result.flags.json, "true");
});

test("parseArgs handles fs ls command", () => {
  const result = parseArgs(["node", "cli.ts", "fs", "ls", ".", "--json"]);
  assert.equal(result.command, "fs");
  assert.equal(result.subcommand, "ls");
  assert.deepEqual(result.positional, ["."]);
  assert.equal(result.flags.json, "true");
});

test("parseArgs handles fs write command with --content", () => {
  const result = parseArgs(["node", "cli.ts", "fs", "write", "/tmp/out.txt", "--content=hello"]);
  assert.equal(result.command, "fs");
  assert.equal(result.subcommand, "write");
  assert.deepEqual(result.positional, ["/tmp/out.txt"]);
  assert.equal(result.flags.content, "hello");
});

// ── CLI ActionResult JSON shape verification ───────────────────────
// These tests verify the full chain: action classes return ActionResult,
// formatActionResult() produces valid JSON with the required fields.
// The CLI handlers (handleTerm/handleFs) call these exact functions
// internally, so this verifies the --json output shape.

test("formatActionResult produces correct JSON shape for term exec", async () => {
  const { formatActionResult } = await import("../../src/action_result");
  const { SessionManager } = await import("../../src/session_manager");
  const { TerminalActions } = await import("../../src/terminal_actions");
  const { MemoryStore } = await import("../../src/memory_store");

  const store = new MemoryStore({ filename: ":memory:" });
  const sm = new SessionManager({ memoryStore: store });
  await sm.create("fmt-test", { policyProfile: "trusted" });
  const actions = new TerminalActions({ sessionManager: sm });

  const result = await actions.exec({ command: "echo format-test", timeoutMs: 5000 });
  const formatted = formatActionResult(result);

  // Verify JSON serialization works and has the required fields
  const json = JSON.stringify(formatted);
  const parsed = JSON.parse(json);
  assert.equal(parsed.success, true, `ActionResult.success must be true`);
  assert.ok(parsed.path, "ActionResult must have path");
  assert.ok(parsed.sessionId, "ActionResult must have sessionId");
  assert.ok(parsed.policyDecision, "ActionResult must have policyDecision");
  assert.ok(parsed.risk, "ActionResult must have risk");
  assert.ok(parsed.completedAt, "ActionResult must have completedAt");

  store.close();
});

test("formatActionResult produces correct JSON shape for fs read", async () => {
  const { formatActionResult } = await import("../../src/action_result");
  const { SessionManager } = await import("../../src/session_manager");
  const { FsActions } = await import("../../src/fs_actions");
  const { MemoryStore } = await import("../../src/memory_store");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const os = await import("node:os");

  const store = new MemoryStore({ filename: ":memory:" });
  const sm = new SessionManager({ memoryStore: store });
  await sm.create("fmt-fs-test", { policyProfile: "trusted" });
  const actions = new FsActions({ sessionManager: sm });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fmt-fs-test-"));
  const filePath = path.join(tmpDir, "test.txt");
  fs.writeFileSync(filePath, "format test");

  const result = await actions.read({ path: filePath });
  const formatted = formatActionResult(result);

  const json = JSON.stringify(formatted);
  const parsed = JSON.parse(json);
  assert.equal(parsed.success, true, `ActionResult.success must be true`);
  assert.ok(parsed.path, "ActionResult must have path");
  assert.ok(parsed.sessionId, "ActionResult must have sessionId");
  assert.ok(parsed.policyDecision, "ActionResult must have policyDecision");
  assert.ok(parsed.risk, "ActionResult must have risk");
  assert.ok(parsed.completedAt, "ActionResult must have completedAt");

  store.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("formatActionResult produces correct JSON shape for term list", async () => {
  const { formatActionResult } = await import("../../src/action_result");
  const { SessionManager } = await import("../../src/session_manager");
  const { TerminalActions } = await import("../../src/terminal_actions");
  const { MemoryStore } = await import("../../src/memory_store");

  const store = new MemoryStore({ filename: ":memory:" });
  const sm = new SessionManager({ memoryStore: store });
  await sm.create("fmt-list-test", { policyProfile: "trusted" });
  const actions = new TerminalActions({ sessionManager: sm });

  const result = await actions.list();
  const formatted = formatActionResult(result);

  const json = JSON.stringify(formatted);
  const parsed = JSON.parse(json);
  assert.equal(parsed.success, true, `ActionResult.success must be true`);
  assert.ok(parsed.path, "ActionResult must have path");
  assert.ok(parsed.sessionId, "ActionResult must have sessionId");
  assert.ok(parsed.policyDecision, "ActionResult must have policyDecision");
  assert.ok(Array.isArray(parsed.data), "list data must be an array");

  store.close();
});

test("formatActionResult includes policy metadata for denied actions", async () => {
  const { formatActionResult, policyDeniedResult } = await import("../../src/action_result");

  const denied = policyDeniedResult("High-risk action under safe profile", {
    path: "command",
    sessionId: "test-session",
    risk: "high" as const,
  });
  const formatted = formatActionResult(denied);

  assert.equal(formatted.success, false);
  assert.equal(formatted.policyDecision, "deny");
  assert.equal(formatted.risk, "high");
  assert.ok(formatted.error);
  assert.ok(formatted.completedAt);
});

test("formatActionResult includes policy metadata for confirmation-required", async () => {
  const { formatActionResult, confirmationRequiredResult } = await import("../../src/action_result");

  const confirm = confirmationRequiredResult("Needs human approval", {
    path: "a11y",
    sessionId: "test-session",
    risk: "moderate" as const,
  });
  const formatted = formatActionResult(confirm);

  assert.equal(formatted.success, false);
  assert.equal(formatted.policyDecision, "require_confirmation");
  assert.equal(formatted.risk, "moderate");
  assert.ok(formatted.completedAt);
});
