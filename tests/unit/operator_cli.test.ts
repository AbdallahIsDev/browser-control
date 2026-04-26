import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parseArgs, runCli } from "../../cli";

function makeHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bc-operator-cli-"));
}

async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const originalLog = console.log;
  const chunks: string[] = [];
  console.log = (value?: unknown) => {
    chunks.push(String(value ?? ""));
  };
  try {
    await fn();
  } finally {
    console.log = originalLog;
  }
  return chunks.join("\n");
}

test("parseArgs handles operator UX commands", () => {
  assert.deepEqual(parseArgs(["node", "cli.ts", "doctor", "--json"]).flags, { json: "true" });

  const configSet = parseArgs(["node", "cli.ts", "config", "set", "logLevel", "debug", "--json"]);
  assert.equal(configSet.command, "config");
  assert.equal(configSet.subcommand, "set");
  assert.deepEqual(configSet.positional, ["logLevel", "debug"]);

  const setup = parseArgs(["node", "cli.ts", "setup", "--non-interactive", "--profile", "trusted", "--skip-browser-test"]);
  assert.equal(setup.command, "setup");
  assert.equal(setup.flags["non-interactive"], "true");
  assert.equal(setup.flags.profile, "trusted");
  assert.equal(setup.flags["skip-browser-test"], "true");
});

test("bc config list --json writes clean parseable JSON", async () => {
  const home = makeHome();
  const previousHome = process.env.BROWSER_CONTROL_HOME;
  try {
    process.env.BROWSER_CONTROL_HOME = home;
    const output = await captureStdout(async () => {
      await runCli(["node", "cli.ts", "config", "list", "--json"]);
    });
    const parsed = JSON.parse(output);
    assert.ok(Array.isArray(parsed));
    assert.ok(parsed.some((entry: { key: string }) => entry.key === "dataHome"));
  } finally {
    if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
    else process.env.BROWSER_CONTROL_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("bc --help does not import SQLite-backed runtime modules", () => {
  const home = makeHome();
  try {
    const result = spawnSync(process.execPath, [
      "--require",
      "ts-node/register",
      "--require",
      "tsconfig-paths/register",
      "cli.ts",
      "--help",
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BROWSER_CONTROL_HOME: home,
        NODE_OPTIONS: "--trace-warnings",
      },
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Browser Control CLI/);
    assert.doesNotMatch(result.stderr, /SQLite|node:sqlite|ExperimentalWarning/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("bc policy import --json writes clean parseable JSON", async () => {
  const home = makeHome();
  const previousHome = process.env.BROWSER_CONTROL_HOME;
  const profilePath = path.join(home, "review-profile.json");
  fs.writeFileSync(profilePath, JSON.stringify({
    name: "review_profile",
    commandPolicy: {
      allowedCommands: [],
      deniedCommands: [],
      requireConfirmationCommands: [],
      restrictedWorkingDirectories: [],
      restrictedNetworkClasses: [],
      restrictedProcessClasses: [],
      restrictedServiceClasses: [],
    },
    filesystemPolicy: {
      allowedReadRoots: [],
      allowedWriteRoots: [],
      allowedDeleteRoots: [],
      recursiveDeleteDefaultBehavior: "require_confirmation",
      tempDirectoryDefaultBehavior: "allow",
    },
    browserPolicy: {
      allowedDomains: [],
      blockedDomains: [],
      fileUploadAllowed: true,
      fileDownloadAllowed: true,
      screenshotAllowed: true,
      clipboardAllowed: true,
      credentialSubmissionAllowed: false,
      automationOnlyInExplicitSessions: true,
    },
    lowLevelPolicy: {
      rawCdpAllowed: false,
      jsEvalAllowed: false,
      networkInterceptionAllowed: false,
      cookieExportImportAllowed: false,
      coordinateActionsAllowed: false,
      performanceTracesAllowed: true,
    },
  }), "utf8");

  try {
    process.env.BROWSER_CONTROL_HOME = home;
    const output = await captureStdout(async () => {
      await runCli(["node", "cli.ts", "policy", "import", profilePath, "--json"]);
    });
    const parsed = JSON.parse(output);
    assert.equal(parsed.name, "review_profile");
  } finally {
    if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
    else process.env.BROWSER_CONTROL_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
