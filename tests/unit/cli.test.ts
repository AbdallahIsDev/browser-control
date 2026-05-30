import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { BrowserProfileManager, getProfilesDir } from "../../src/browser/profiles";
import { CredentialVault, resetCredentialVault } from "../../src/security/credential_vault";
import { resetStateStorage } from "../../src/state/index";
import { parseArgs, runCli as runCliInProcess, VALUE_FLAGS } from "../../src/cli";

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

test("parseArgs parses session lifecycle subcommands", () => {
  const destroy = parseArgs(["node", "cli.ts", "session", "destroy", "session-1"]);
  assert.equal(destroy.command, "session");
  assert.equal(destroy.subcommand, "destroy");
  assert.deepEqual(destroy.positional, ["session-1"]);

  const cleanup = parseArgs(["node", "cli.ts", "session", "cleanup", "--json"]);
  assert.equal(cleanup.command, "session");
  assert.equal(cleanup.subcommand, "cleanup");
  assert.deepEqual(cleanup.flags, { json: "true" });
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

test("data cleanup --purge-profiles reports stale profiles and requires confirmation to delete", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-cli-profile-purge-"));
  const previousHome = process.env.BROWSER_CONTROL_HOME;
  try {
    process.env.BROWSER_CONTROL_HOME = home;
    const manager = new BrowserProfileManager();
    const stale = manager.createProfile("stale-cli-profile", "named");
    fs.writeFileSync(path.join(stale.dataDir, "Cache"), "stale");

    const registryPath = path.join(getProfilesDir(), "registry.json");
    const registry = JSON.parse(fs.readFileSync(registryPath, "utf8")) as {
      profiles: Array<{ id: string; lastUsedAt: string }>;
    };
    const staleMeta = registry.profiles.find((entry) => entry.id === stale.id);
    assert.ok(staleMeta);
    staleMeta.lastUsedAt = new Date("2024-01-01T00:00:00.000Z").toISOString();
    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));

    const env = { BROWSER_CONTROL_HOME: home };
    const dryRun = runCli(["data", "cleanup", "--purge-profiles", "--json"], {
      cwd: process.cwd(),
      env,
    });
    assert.equal(dryRun.status, 0, dryRun.stderr);
    const dryRunJson = JSON.parse(dryRun.stdout) as {
      dryRun: boolean;
      candidates: Array<{ id: string }>;
      deleted: Array<{ id: string }>;
    };
    assert.equal(dryRunJson.dryRun, true);
    assert.ok(dryRunJson.candidates.some((entry) => entry.id === stale.id));
    assert.deepEqual(dryRunJson.deleted, []);
    assert.equal(fs.existsSync(stale.dataDir), true);

    const rejected = runCli(
      ["data", "cleanup", "--purge-profiles", "--dry-run=false", "--json"],
      { cwd: process.cwd(), env },
    );
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /profile purge requires --yes/);
    assert.equal(fs.existsSync(stale.dataDir), true);

    const invalidDays = runCli(
      ["data", "cleanup", "--purge-profiles", "--days=-1", "--json"],
      { cwd: process.cwd(), env },
    );
    assert.notEqual(invalidDays.status, 0);
    assert.match(invalidDays.stderr, /--days must be a non-negative number/);
    assert.equal(fs.existsSync(stale.dataDir), true);

    const deleted = runCli(
      ["data", "cleanup", "--purge-profiles", "--dry-run=false", "--yes", "--json"],
      { cwd: process.cwd(), env },
    );
    assert.equal(deleted.status, 0, deleted.stderr);
    const deletedJson = JSON.parse(deleted.stdout) as {
      dryRun: boolean;
      deleted: Array<{ id: string }>;
    };
    assert.equal(deletedJson.dryRun, false);
    assert.ok(deletedJson.deleted.some((entry) => entry.id === stale.id));
    assert.equal(fs.existsSync(stale.dataDir), false);
  } finally {
    if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
    else process.env.BROWSER_CONTROL_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("daemon start cleans stale daemon files before spawning", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src", "cli.ts"), "utf8");
  const startIndex = source.indexOf('case "start": {');
  const cleanupIndex = source.indexOf("await cleanupStaleDaemonStatus();", startIndex);
  const spawnIndex = source.indexOf("const daemonProcess = spawnDaemonProcess", startIndex);

  assert.notEqual(startIndex, -1);
  assert.ok(
    cleanupIndex > startIndex,
    "daemon start should call stale cleanup in the start branch",
  );
  assert.ok(
    cleanupIndex < spawnIndex,
    "stale cleanup must happen before spawning the daemon",
  );
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

test("bc run sends broker authorization from generated key file", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-cli-auth-"));
  const previousHome = process.env.BROWSER_CONTROL_HOME;
  const previousPort = process.env.BROKER_PORT;
  const previousApiKey = process.env.BROKER_API_KEY;
  const previousSecret = process.env.BROKER_SECRET;
  const previousFetch = globalThis.fetch;
  const previousLog = console.log;
  let authorization: string | undefined;

  process.env.BROWSER_CONTROL_HOME = home;
  process.env.BROKER_PORT = "59999";
  delete process.env.BROKER_API_KEY;
  delete process.env.BROKER_SECRET;
  console.log = () => {};
  globalThis.fetch = (async (_input, init) => {
    const headers = init?.headers as Record<string, string> | undefined;
    authorization = headers?.Authorization ?? headers?.authorization;
    return new Response(JSON.stringify({ taskId: "task-1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    await runCliInProcess([
      "node",
      "cli.ts",
      "run",
      "--skill",
      "navigation",
      "--action",
      "open",
      "--json",
    ]);

    assert.match(
      authorization ?? "",
      /^Bearer brk_/,
      "CLI broker requests should use the persisted generated broker key",
    );
  } finally {
    globalThis.fetch = previousFetch;
    console.log = previousLog;
    if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
    else process.env.BROWSER_CONTROL_HOME = previousHome;
    if (previousPort === undefined) delete process.env.BROKER_PORT;
    else process.env.BROKER_PORT = previousPort;
    if (previousApiKey === undefined) delete process.env.BROKER_API_KEY;
    else process.env.BROKER_API_KEY = previousApiKey;
    if (previousSecret === undefined) delete process.env.BROKER_SECRET;
    else process.env.BROKER_SECRET = previousSecret;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("bc run explains broker authentication failures", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-cli-auth-fail-"));
  const previousHome = process.env.BROWSER_CONTROL_HOME;
  const previousPort = process.env.BROKER_PORT;
  const previousFetch = globalThis.fetch;
  const previousError = console.error;
  const errors: string[] = [];

  process.env.BROWSER_CONTROL_HOME = home;
  process.env.BROKER_PORT = "59998";
  console.error = (...args: unknown[]) => {
    errors.push(args.map((arg) => String(arg)).join(" "));
  };
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: "Unauthorized." }), {
      status: 401,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        runCliInProcess([
          "node",
          "cli.ts",
          "run",
          "--skill",
          "navigation",
          "--action",
          "open",
          "--json",
        ]),
      /broker rejected CLI authentication/,
    );
    assert.match(errors.join("\n"), /BROKER_API_KEY matches the daemon's broker key/);
  } finally {
    globalThis.fetch = previousFetch;
    console.error = previousError;
    if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
    else process.env.BROWSER_CONTROL_HOME = previousHome;
    if (previousPort === undefined) delete process.env.BROKER_PORT;
    else process.env.BROKER_PORT = previousPort;
    fs.rmSync(home, { recursive: true, force: true });
  }
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

test("parseArgs keeps negative numeric values attached to value flags", () => {
  const result = parseArgs([
    "node",
    "cli.ts",
    "browser",
    "scroll",
    "--amount",
    "-500",
    "--json",
  ]);

  assert.equal(result.command, "browser");
  assert.equal(result.subcommand, "scroll");
  assert.equal(result.flags.amount, "-500");
  assert.equal(result.flags.json, "true");
  assert.deepEqual(result.positional, []);
});

test("parseArgs keeps negative decimal values attached to value flags", () => {
  const result = parseArgs([
    "node",
    "cli.ts",
    "browser",
    "act",
    "scroll",
    "--amount",
    "-12.5",
    "--timeout",
    "-1",
  ]);

  assert.equal(result.flags.amount, "-12.5");
  assert.equal(result.flags.timeout, "-1");
  assert.deepEqual(result.positional, ["scroll"]);
});

test("parseArgs keeps newly added command value flags space-separated", () => {
	const result = parseArgs([
		"node",
		"cli.ts",
		"browser",
		"act",
		"fill",
		"--text",
		"hello",
		"--delayMs",
		"50",
		"--domain",
		"example.test",
		"--refs",
		"a,b",
	]);

	assert.equal(result.flags.text, "hello");
	assert.equal(result.flags.delayMs, "50");
	assert.equal(result.flags.domain, "example.test");
	assert.equal(result.flags.refs, "a,b");
});

test("VALUE_FLAGS covers non-boolean flags read by CLI handlers", () => {
	const cliPath = path.join(process.cwd(), "src", "cli.ts");
	const source = fs.readFileSync(cliPath, "utf8");
	const rawList = /export const VALUE_FLAGS = new Set\(\[([\s\S]*?)\]\);/u.exec(source)?.[1] ?? "";
	const rawValues = [...rawList.matchAll(/"([^"]+)"/gu)].map((match) => match[1]);
	const duplicates = rawValues.filter((value, index) => rawValues.indexOf(value) !== index);
	assert.deepEqual(duplicates, [], "VALUE_FLAGS should not contain duplicate entries");

	const booleanOrPresenceFlags = new Set([
		"all",
		"allow-remote",
		"allow-system-profile",
		"annotate",
		"background",
		"capture",
		"capture-on-success",
		"captureOnSuccess",
		"cleanup",
		"commit",
		"create-dirs",
		"dashboard",
		"detect",
		"force",
		"full-page",
		"fullPage",
		"h",
		"hide",
		"https",
		"install",
		"json",
		"live",
		"local-ca",
		"non-interactive",
		"overwrite",
		"persist",
		"purge-profiles",
		"recursive",
		"rotate",
		"skip-browser-test",
		"skip-terminal-test",
		"stale",
		"stored",
		"visible",
		"wait",
		"y",
		"yes",
	]);
	const usedFlags = new Set<string>();
	for (const match of source.matchAll(/flags(?:\.([a-zA-Z_$][\w$]*)|\["([^"]+)"\])/gu)) {
		usedFlags.add(match[1] ?? match[2]);
	}

	const missing = [...usedFlags]
		.filter((flag) => !VALUE_FLAGS.has(flag) && !booleanOrPresenceFlags.has(flag))
		.sort();
	assert.deepEqual(missing, []);
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

test("vault set and delete accept standard yes confirmations", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-cli-vault-home-"));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "bc-cli-vault-cwd-"));
  const env = {
    BROWSER_CONTROL_HOME: home,
    BROWSER_CONTROL_STATE_BACKEND: "json",
  };

  try {
    const stored = runCli(
      [
        "vault",
        "set",
        "--scope",
        "site",
        "example.test",
        "api-token",
        "secret-value",
        "--yes",
        "--json",
      ],
      { cwd, env },
    );
    assert.equal(stored.status, 0, stored.stderr);
    const body = JSON.parse(stored.stdout) as { id: string; hasValue: boolean };
    assert.match(body.id, /^secret:\/\/site\/example\.test\/api-token$/u);
    assert.equal(body.hasValue, true);
    assert.doesNotMatch(stored.stdout, /secret-value/u);

    const deleted = runCli(
      ["vault", "delete", body.id, "-y", "--json"],
      { cwd, env },
    );
    assert.equal(deleted.status, 0, deleted.stderr);
    assert.deepEqual(JSON.parse(deleted.stdout), { success: true, id: body.id });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("vault confirmation errors advertise --yes and keep legacy token compatibility", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-cli-vault-confirm-home-"));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "bc-cli-vault-confirm-cwd-"));
  const env = {
    BROWSER_CONTROL_HOME: home,
    BROWSER_CONTROL_STATE_BACKEND: "json",
  };

  try {
    const rejected = runCli(
      ["vault", "set", "--scope", "site", "example.test", "api-token", "secret-value"],
      { cwd, env },
    );
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /requires --yes/i);
    assert.match(rejected.stderr, /--confirm=STORE_SECRET/);

    const legacy = runCli(
      [
        "vault",
        "set",
        "--scope",
        "site",
        "example.test",
        "api-token",
        "secret-value",
        "--confirm=STORE_SECRET",
        "--json",
      ],
      { cwd, env },
    );
    assert.equal(legacy.status, 0, legacy.stderr);
  } finally {
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
