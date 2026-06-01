import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { buildDoctorChecks, runDoctor } from "../../src/operator/doctor";
import { runSetup } from "../../src/operator/setup";
import { collectStatus } from "../../src/operator/status";
import { loadUserConfig } from "../../src/config";
import { cleanupStaleDaemonFiles } from "../../src/runtime/daemon_cleanup";
import { getInteropDir } from "../../src/shared/paths";

function makeHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bc-operator-"));
}

test("doctor exits 0 when only warnings are present", async () => {
  const result = await runDoctor({
    checks: [
      async () => ({
        id: "optional.chrome",
        name: "Chrome",
        category: "browser",
        status: "warn",
        details: "Chrome is not running.",
        fix: "Run bc browser launch when browser automation is needed.",
        critical: false,
      }),
    ],
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.report.summary.warn, 1);
  assert.equal(result.report.summary.criticalFailures, 0);
});

test("doctor exits 1 when a critical failure is present", async () => {
  const result = await runDoctor({
    checks: [
      async () => ({
        id: "data.home.writable",
        name: "Data Home Writable",
        category: "filesystem",
        status: "fail",
        details: "Cannot write to data home.",
        fix: "Set BROWSER_CONTROL_HOME to a writable directory.",
        critical: true,
      }),
    ],
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.summary.fail, 1);
  assert.equal(result.report.summary.criticalFailures, 1);
});

test("doctor treats missing Chrome as degraded browser capability, not total failure", async () => {
  const home = makeHome();
  try {
    const result = await runDoctor({
      env: {
        BROWSER_CONTROL_HOME: home,
        BROWSER_CHROME_PATH: path.join(home, "missing-chrome.exe"),
        BROKER_PORT: "1",
      },
    });

    const chrome = result.report.checks.find((check) => check.id === "browser.chrome");
    assert.equal(chrome?.status, "warn");
    assert.equal(chrome?.critical, false);
    assert.equal(result.exitCode, 0);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("doctor node version check does not depend on caller cwd", async () => {
  const home = makeHome();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "bc-doctor-cwd-"));
  try {
    const env = { BROWSER_CONTROL_HOME: home, BROKER_PORT: "1" };
    const [nodeCheck] = buildDoctorChecks({ env, cwd });
    const result = await runDoctor({ env, cwd, checks: [nodeCheck] });
    assert.equal(result.exitCode, 0);
    assert.equal(result.report.checks[0]?.id, "node.version");
    assert.equal(result.report.checks[0]?.status, "pass");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("setup non-interactive creates config and never waits for prompts", async () => {
  const home = makeHome();
  try {
    const env = { BROWSER_CONTROL_HOME: home };
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("setup hung waiting for input")), 1000);
    });

    const result = await Promise.race([
      runSetup({
        env,
        nonInteractive: true,
        profile: "balanced",
        skipBrowserTest: true,
        skipTerminalTest: true,
        modelProvider: "openai-compatible",
        modelEndpoint: "http://127.0.0.1:11434/v1",
        modelName: "local-model",
        modelApiKey: "setup-model-key",
      }),
      timeout,
    ]);

    assert.equal(result.success, true);
    assert.ok(result.changed.includes("config.policyProfile"));
    assert.ok(result.skipped.includes("browser-test"));
    assert.ok(result.skipped.includes("terminal-test"));
    assert.equal(fs.existsSync(home), true);

    const userConfig = loadUserConfig({ env });
    assert.equal(userConfig.policyProfile, "balanced");
    assert.equal(userConfig.browserMode, "attach");
    assert.equal(userConfig.chromeDebugPort, 9222);
    assert.equal(userConfig.chromeBindAddress, "127.0.0.1");
    assert.equal(userConfig.modelProvider, "openai-compatible");
    assert.equal(userConfig.modelEndpoint, "http://127.0.0.1:11434/v1");
    assert.equal(userConfig.modelName, "local-model");
    assert.equal(userConfig.modelApiKey, "setup-model-key");
    assert.deepEqual(result.mcpConfigSnippet, {
      mcpServers: {
        "browser-control": {
          command: "bc",
          args: ["mcp", "serve"],
        },
      },
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("setup --json emits only JSON and never prompts interactively", () => {
  const home = makeHome();
  try {
    const result = spawnSync(
      process.execPath,
      [
        "--require",
        "ts-node/register",
        "--require",
        "tsconfig-paths/register",
        "src/cli.ts",
        "setup",
        "--json",
        "--skip-browser-test",
        "--skip-terminal-test",
      ],
      {
        cwd: path.join(__dirname, "..", ".."),
        env: { ...process.env, BROWSER_CONTROL_HOME: home },
        encoding: "utf8",
        input: "",
        timeout: 5000,
      },
    );

    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.doesNotMatch(result.stdout, /Policy profile|Browser mode|Chrome debug port/);
    const parsed = JSON.parse(result.stdout) as { success: boolean; skipped: string[] };
    assert.equal(parsed.success, true);
    assert.deepEqual(parsed.skipped, ["browser-test", "terminal-test"]);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("setup rejects unknown flags before writing config", () => {
  const home = makeHome();
  try {
    const result = spawnSync(
      process.execPath,
      [
        "--require",
        "ts-node/register",
        "--require",
        "tsconfig-paths/register",
        "src/cli.ts",
        "setup",
        "--json",
        "--non-interactive",
        "--chrome-debugg-port=9222",
        "--skip-browser-test",
        "--skip-terminal-test",
      ],
      {
        cwd: path.join(__dirname, "..", ".."),
        env: { ...process.env, BROWSER_CONTROL_HOME: home },
        encoding: "utf8",
        input: "",
        timeout: 5000,
      },
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /unknown option '--chrome-debugg-port=9222'/);
    assert.equal(fs.existsSync(path.join(home, "config", "config.json")), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("setup validates known flag values and rolls back invalid config writes", () => {
  const home = makeHome();
  try {
    const result = spawnSync(
      process.execPath,
      [
        "--require",
        "ts-node/register",
        "--require",
        "tsconfig-paths/register",
        "src/cli.ts",
        "setup",
        "--json",
        "--non-interactive",
        "--chrome-debug-port=not-a-number",
        "--skip-browser-test",
        "--skip-terminal-test",
      ],
      {
        cwd: path.join(__dirname, "..", ".."),
        env: { ...process.env, BROWSER_CONTROL_HOME: home },
        encoding: "utf8",
        input: "",
        timeout: 5000,
      },
    );

    assert.equal(result.status, 1, result.stderr || result.stdout);
    const parsed = JSON.parse(result.stdout) as { success: boolean; warnings: string[] };
    assert.equal(parsed.success, false);
    assert.equal(parsed.warnings.some((warning) => warning.includes("chromeDebugPort must be an integer")), true);
    assert.equal(fs.existsSync(path.join(home, "config", "config.json")), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("setup reports browser test failures as unsuccessful", async () => {
  const home = makeHome();
  try {
    const result = await runSetup({
      env: { BROWSER_CONTROL_HOME: home },
      nonInteractive: true,
      chromeDebugPort: 9,
      skipTerminalTest: true,
    });

    assert.equal(result.success, false);
    assert.equal(result.warnings.some((warning) => warning.includes("CDP port 9")), true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("setup rolls back partial config writes when a later config write fails", async () => {
  const home = makeHome();
  try {
    const env = { BROWSER_CONTROL_HOME: home };
    const before = {
      policyProfile: "trusted",
      browserMode: "managed",
    };
    fs.mkdirSync(path.join(home, "config"), { recursive: true });
    fs.writeFileSync(
      path.join(home, "config", "config.json"),
      `${JSON.stringify(before, null, 2)}\n`,
    );

    const result = await runSetup({
      env,
      nonInteractive: true,
      profile: "safe",
      modelProvider: "invalid-provider" as "openrouter",
      skipBrowserTest: true,
      skipTerminalTest: true,
    });

    assert.equal(result.success, false);
    assert.deepEqual(loadUserConfig({ env }), before);
    assert.equal(result.changed.length, 0);
    assert.equal(result.warnings.some((warning) => warning.includes("Config write failed")), true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("status reports stopped daemon without throwing when broker is unreachable", async () => {
  const home = makeHome();
  try {
    const status = await collectStatus({
      env: {
        BROWSER_CONTROL_HOME: home,
        BROKER_PORT: "1",
      },
      brokerProbe: async () => ({
        reachable: false,
        brokerUrl: "http://127.0.0.1:1",
      }),
    });

    assert.equal(status.daemon.state, "stopped");
    assert.equal(status.broker.reachable, false);
    assert.equal(status.dataHome, home);
    assert.equal(status.policyProfile, "balanced");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("status reads daemon state from canonical interop directory", async () => {
  const home = makeHome();
  try {
    const interop = getInteropDir(home);
    fs.mkdirSync(interop, { recursive: true });
    fs.writeFileSync(path.join(interop, "daemon.pid"), `${process.pid}\n`);
    fs.writeFileSync(
      path.join(interop, "daemon-status.json"),
      JSON.stringify({ status: "degraded", pid: process.pid, reason: "test degraded" }),
    );

    const status = await collectStatus({
      env: {
        BROWSER_CONTROL_HOME: home,
        BROKER_PORT: "1",
      },
      brokerProbe: async () => ({
        reachable: false,
        brokerUrl: "http://127.0.0.1:1",
      }),
    });

    assert.equal(status.daemon.state, "degraded");
    assert.equal(status.daemon.pid, process.pid);
    assert.equal(status.daemon.reason, "test degraded");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("cleanupStaleDaemonFiles removes stale canonical interop files", () => {
  const home = makeHome();
  try {
    const interop = getInteropDir(home);
    const pidPath = path.join(interop, "daemon.pid");
    const statusPath = path.join(interop, "daemon-status.json");
    fs.mkdirSync(interop, { recursive: true });
    fs.writeFileSync(pidPath, "999999999\n");
    fs.writeFileSync(statusPath, JSON.stringify({ status: "running", pid: 999999999 }));

    cleanupStaleDaemonFiles(home);

    assert.equal(fs.existsSync(pidPath), false);
    assert.equal(fs.existsSync(statusPath), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("status summarizes reachable broker health, sessions, tasks, services, and provider", async () => {
  const home = makeHome();
  try {
    const status = await collectStatus({
      env: { BROWSER_CONTROL_HOME: home },
      serviceRegistry: {
        list: () => [{ name: "app", port: 5173 }],
      },
      providerRegistry: {
        getActiveName: () => "browserless",
      },
      brokerProbe: async () => ({
        reachable: true,
        brokerUrl: "http://127.0.0.1:7788",
        health: {
          overall: "healthy",
          checks: [{ name: "memoryStore", status: "pass", details: "ok" }],
          timestamp: "2026-04-25T00:00:00.000Z",
        },
        stats: {
          daemon: { status: "running", pid: 1234 },
          tasks: { running: 2, queued: 1 },
          activeSessions: 3,
        },
        terminalSessions: [
          { id: "term-1", shell: "pwsh", cwd: "C:\\tmp", status: "idle" },
        ],
        tasks: [
          { id: "task-1", status: "running" },
          { id: "task-2", status: "pending" },
        ],
        skills: [
          { name: "framer", version: "1.0.0", requiredEnv: [], allowedDomains: [] },
        ],
      }),
    });

    assert.equal(status.daemon.state, "running");
    assert.equal(status.daemon.pid, 1234);
    assert.equal(status.browser.activeSessions, 3);
    assert.equal(status.terminal.activeSessions, 1);
    assert.equal(status.tasks.running, 2);
    assert.equal(status.tasks.queued, 1);
    assert.equal(status.services.count, 1);
    assert.equal(status.provider.active, "browserless");
    assert.equal(status.health.overall, "healthy");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
