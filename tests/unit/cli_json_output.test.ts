import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

function makeHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bc-cli-json-output-"));
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

test("fs read --json keeps stdout and stderr machine-safe", () => {
  const home = makeHome();
  const filePath = path.join(home, "json-test.txt");
  try {
    fs.writeFileSync(filePath, "json-ok\n");

    const result = runCli(["fs", "read", filePath, "--json"], {
      BROWSER_CONTROL_HOME: home,
      POLICY_PROFILE: "balanced",
    });

    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.success, true);
    assert.equal(parsed.data.content, "json-ok\n");
    assert.equal(result.stderr.trim(), "");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
