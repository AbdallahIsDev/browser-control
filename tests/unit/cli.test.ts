import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CredentialVault, resetCredentialVault } from "../../src/security/credential_vault";
import { resetStateStorage } from "../../src/state/index";
import { parseArgs } from "../../src/cli";

function runCli(
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) {
  const cliPath = path.join(process.cwd(), "src", "cli.ts");
  const script = `
    process.chdir(${JSON.stringify(options.cwd)});
    process.argv = ${JSON.stringify(["node", "cli.ts", ...args])};
    (async () => {
      const cli = require(${JSON.stringify(cliPath)});
      await cli.runCli(process.argv);
    })().catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = error && typeof error.exitCode === "number" ? error.exitCode : 1;
    });
  `;
  return spawnSync(
    process.execPath,
    [
      "--require",
      require.resolve("ts-node/register"),
      "--require",
      require.resolve("tsconfig-paths/register"),
      "-e",
      script,
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, ...options.env },
      encoding: "utf8",
      windowsHide: true,
    },
  );
}

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

test("data doctor --cleanup is an alias for data cleanup dry-run", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-cli-data-cleanup-"));
  try {
    const tempDir = path.join(home, "runtime", "temp");
    fs.mkdirSync(tempDir, { recursive: true });
    const staleFile = path.join(tempDir, "old.tmp");
    fs.writeFileSync(staleFile, "old");
    const oldTime = new Date(Date.now() - 48 * 60 * 60 * 1000);
    fs.utimesSync(staleFile, oldTime, oldTime);

    const result = runCli(["data", "doctor", "--cleanup", "--json"], {
      cwd: process.cwd(),
      env: { BROWSER_CONTROL_HOME: home },
    });

    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout) as {
      dryRun: boolean;
      candidates: Array<{ path: string }>;
      deleted: string[];
    };
    assert.equal(parsed.dryRun, true);
    assert.ok(parsed.candidates.some((entry) => entry.path === staleFile));
    assert.deepEqual(parsed.deleted, []);
    assert.equal(fs.existsSync(staleFile), true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("data cleanup --stale moves legacy trading only with explicit confirmation", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-cli-stale-cleanup-"));
  try {
    const journal = path.join(home, "trading", "journals", "keep.md");
    fs.mkdirSync(path.dirname(journal), { recursive: true });
    fs.writeFileSync(journal, "keep");

    const dryRun = runCli(["data", "cleanup", "--stale", "--json"], {
      cwd: process.cwd(),
      env: { BROWSER_CONTROL_HOME: home },
    });
    assert.equal(dryRun.status, 0, dryRun.stderr);
    const dryRunJson = JSON.parse(dryRun.stdout) as {
      dryRun: boolean;
      candidates: Array<{ path: string }>;
      moved: Array<{ from: string; to: string }>;
    };
    assert.equal(dryRunJson.dryRun, true);
    assert.ok(dryRunJson.candidates.some((entry) => entry.path === path.join(home, "trading")));
    assert.deepEqual(dryRunJson.moved, []);
    assert.equal(fs.existsSync(journal), true);

    const move = runCli([
      "data",
      "cleanup",
      "--stale",
      "--dry-run=false",
      "--confirm=MOVE_STALE_LEGACY",
      "--json",
    ], {
      cwd: process.cwd(),
      env: { BROWSER_CONTROL_HOME: home },
    });
    assert.equal(move.status, 0, move.stderr);
    const moveJson = JSON.parse(move.stdout) as {
      dryRun: boolean;
      moved: Array<{ from: string; to: string }>;
      deleted: string[];
    };
    assert.equal(moveJson.dryRun, false);
    assert.ok(moveJson.moved.some((entry) => entry.from === path.join(home, "trading")));
    assert.deepEqual(moveJson.deleted, []);
    assert.equal(fs.existsSync(path.join(home, "trading")), false);
    assert.equal(fs.existsSync(path.join(home, "legacy", "trading", "journals", "keep.md")), true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("CLI validation errors do not end with generic Command failed", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-cli-error-context-"));
  try {
    const result = runCli(["data", "cleanup", "--dry-run=false", "--json"], {
      cwd: process.cwd(),
      env: { BROWSER_CONTROL_HOME: home },
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Destructive cleanup requires explicit confirmation/);
    assert.doesNotMatch(result.stderr, /Command failed/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("CLI unknown subcommands preserve command context", () => {
  const result = runCli(["config", "wat", "--json"], {
    cwd: process.cwd(),
    env: {},
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown config command: wat/);
  assert.doesNotMatch(result.stderr, /Command failed/);
});

test("parseArgs handles existing space-separated value flags", () => {
  const result = parseArgs([
    "node",
    "cli.ts",
    "run",
    "--skill",
    "navigation",
    "--action",
    "open",
    "--params",
    "{\"url\":\"https://example.com\"}",
  ]);

  assert.equal(result.command, "run");
  assert.equal(result.flags.skill, "navigation");
  assert.equal(result.flags.action, "open");
  assert.equal(result.flags.params, "{\"url\":\"https://example.com\"}");
  assert.deepEqual(result.positional, []);
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

test("proxy add stores proxy credentials in the credential vault", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-cli-proxy-home-"));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "bc-cli-proxy-cwd-"));
  const previousHome = process.env.BROWSER_CONTROL_HOME;
  const previousBackend = process.env.BROWSER_CONTROL_STATE_BACKEND;

  try {
    const env = {
      BROWSER_CONTROL_HOME: home,
      BROWSER_CONTROL_STATE_BACKEND: "json",
    };
    const added = runCli(
      ["proxy", "add", "http://user:pass@proxy.example.test:8080"],
      { cwd, env },
    );
    assert.equal(added.status, 0, added.stderr);

    const proxyFile = fs.readFileSync(path.join(cwd, "proxies.json"), "utf8");
    assert.doesNotMatch(proxyFile, /user|pass/u);
    const proxies = JSON.parse(proxyFile) as Array<{
      url: string;
      status: string;
      credentialRef?: string;
    }>;
    assert.equal(proxies[0]?.url, "http://proxy.example.test:8080/");
    assert.equal(proxies[0]?.status, "active");
    assert.match(proxies[0]?.credentialRef ?? "", /^secret:\/\/site\//u);

    process.env.BROWSER_CONTROL_HOME = home;
    process.env.BROWSER_CONTROL_STATE_BACKEND = "json";
    resetStateStorage();
    resetCredentialVault();
    const stored = await new CredentialVault().getValue(proxies[0]!.credentialRef!);
    assert.deepEqual(JSON.parse(stored ?? "{}"), {
      username: "user",
      password: "pass",
    });

    const listed = runCli(["proxy", "list", "--json"], { cwd, env });
    assert.equal(listed.status, 0, listed.stderr);
    assert.doesNotMatch(listed.stdout, /user|pass/u);
    const listedProxies = JSON.parse(listed.stdout) as Array<{ url: string }>;
    assert.equal(listedProxies[0]?.url, "http://proxy.example.test:8080/");
  } finally {
    resetCredentialVault();
    resetStateStorage();
    if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
    else process.env.BROWSER_CONTROL_HOME = previousHome;
    if (previousBackend === undefined) delete process.env.BROWSER_CONTROL_STATE_BACKEND;
    else process.env.BROWSER_CONTROL_STATE_BACKEND = previousBackend;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
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

test("parseArgs collects repeated drop file and data flags without comma splitting", () => {
  const result = parseArgs([
    "node",
    "cli.ts",
    "browser",
    "drop",
    "@e1",
    "--file",
    "C:\\tmp\\one.txt",
    "--file=C:\\tmp\\two.txt",
    "--data",
    "text/plain=hello,world",
    "--data=application/json={\"url\":\"https://example.com?a=1\"}",
  ]);

  assert.equal(result.command, "browser");
  assert.equal(result.subcommand, "drop");
  assert.deepEqual(result.positional, ["@e1"]);
  assert.equal(result.flags.file, "C:\\tmp\\one.txt\0C:\\tmp\\two.txt");
  assert.equal(
    result.flags.data,
    "text/plain=hello,world\0application/json={\"url\":\"https://example.com?a=1\"}",
  );
});

test("parseArgs handles composite browser act flags", () => {
  const result = parseArgs([
    "node",
    "cli.ts",
    "browser",
    "act",
    "screenshot",
    "--capture-on-success",
    "--output-path",
    "C:\\tmp\\page.png",
    "--json",
  ]);

  assert.equal(result.command, "browser");
  assert.equal(result.subcommand, "act");
  assert.deepEqual(result.positional, ["screenshot"]);
  assert.equal(result.flags["capture-on-success"], "true");
  assert.equal(result.flags["output-path"], "C:\\tmp\\page.png");
  assert.equal(result.flags.json, "true");
});

test("parseArgs keeps browser act fill target and text positionals", () => {
  const result = parseArgs([
    "node",
    "cli.ts",
    "browser",
    "act",
    "fill",
    "searchInput",
    "Amazon",
    "--json",
  ]);

  assert.equal(result.command, "browser");
  assert.equal(result.subcommand, "act");
  assert.deepEqual(result.positional, ["fill", "searchInput", "Amazon"]);
  assert.equal(result.flags.json, "true");
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

  const store = new MemoryStore({ filename: ":memory:" });
  const sm = new SessionManager({ memoryStore: store });
  await sm.create("fmt-fs-test", { policyProfile: "trusted" });
  const actions = new FsActions({ sessionManager: sm });

  const session = sm.getActiveSession();
  assert.ok(session, "test session must exist");
  const filePath = path.join(session.runtimeDir, "test.txt");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
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
