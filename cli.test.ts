import assert from "node:assert/strict";
import test from "node:test";

import { parseArgs } from "./cli";

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