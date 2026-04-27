import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { OBSERVABILITY_KEYS } from "../../src/observability/types";
import { MemoryStore } from "../../src/runtime/memory_store";

function makeHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bc-cli-debug-observability-"));
}

function runCli(args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync(
    process.execPath,
    ["--require", "ts-node/register", "--require", "tsconfig-paths/register", "cli.ts", ...args],
    {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      encoding: "utf8",
      windowsHide: true,
    },
  );
}

test("debug console --json reads persisted observability entries", () => {
  const home = makeHome();
  const store = new MemoryStore({ filename: path.join(home, "memory.sqlite") });
  try {
    store.set(`${OBSERVABILITY_KEYS.consolePrefix}default`, [
      {
        level: "error",
        message: "bc-console-error-test",
        timestamp: "2026-04-27T14:02:52.000Z",
        sessionId: "default",
      },
    ]);
    store.close();

    const result = runCli(["debug", "console", "--json"], {
      BROWSER_CONTROL_HOME: home,
      POLICY_PROFILE: "balanced",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr.trim(), "");
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.sessionId, "default");
    assert.equal(parsed.entries.length, 1);
    assert.equal(parsed.entries[0].message, "bc-console-error-test");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("debug network --json reads persisted observability entries", () => {
  const home = makeHome();
  const store = new MemoryStore({ filename: path.join(home, "memory.sqlite") });
  try {
    store.set(`${OBSERVABILITY_KEYS.networkPrefix}default`, [
      {
        url: "http://127.0.0.1:7890/api/test?source=bc-debug",
        method: "GET",
        status: 200,
        timestamp: "2026-04-27T14:02:52.000Z",
        sessionId: "default",
      },
    ]);
    store.close();

    const result = runCli(["debug", "network", "--json"], {
      BROWSER_CONTROL_HOME: home,
      POLICY_PROFILE: "balanced",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr.trim(), "");
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.sessionId, "default");
    assert.equal(parsed.entries.length, 1);
    assert.equal(parsed.entries[0].url, "http://127.0.0.1:7890/api/test?source=bc-debug");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
