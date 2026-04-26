import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { getConfigEntries } from "../../config";

const root = process.cwd();

function readPackageJson(): Record<string, any> {
  return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as Record<string, any>;
}

function readEnvExample(): string {
  return fs.readFileSync(path.join(root, ".env.example"), "utf8");
}

test("package bin points to an existing CLI shim", () => {
  const pkg = readPackageJson();
  assert.equal(pkg.bin?.bc, "./cli.js");
  assert.ok(fs.existsSync(path.join(root, pkg.bin.bc)), "bin target should exist");
});

test("package files include runtime and onboarding docs but exclude local/test artifacts", () => {
  const pkg = readPackageJson();
  assert.ok(Array.isArray(pkg.files), "package should use an explicit files allowlist");

  const required = [
    "dist/",
    "cli.js",
    "LICENSE",
    "README.md",
    ".env.example",
    "docs/getting-started.md",
    "docs/cli.md",
    "docs/mcp.md",
    "docs/troubleshooting.md",
    "docs/policy.md",
    "docs/api.md",
  ];
  for (const entry of required) {
    assert.ok(pkg.files.includes(entry), `package files should include ${entry}`);
  }

  const forbidden = [
    "tests/",
    "*.test.ts",
    "screenshots/",
    "reports/",
    ".worktrees/",
    ".vscode/",
    "automation-memory.sqlite",
  ];
  for (const entry of forbidden) {
    assert.ok(!pkg.files.includes(entry), `package files should not include ${entry}`);
  }
});

test("package smoke script exists", () => {
  assert.ok(fs.existsSync(path.join(root, "scripts", "package_smoke_test.cjs")));
});

test("package smoke script avoids raw Windows shell bin execution", () => {
  const content = fs.readFileSync(path.join(root, "scripts", "package_smoke_test.cjs"), "utf8");
  assert.doesNotMatch(content, /cmd\.exe/u);
  assert.match(content, /npm.*exec|runNpm\(\["exec"/u);
});

test("cli shim fails early on unsupported Node versions", () => {
  const content = fs.readFileSync(path.join(root, "cli.js"), "utf8");
  assert.match(content, /requires Node\.js >=22/u);
  assert.match(content, /process\.versions\.node/u);
});

test("build output matches package entry points when dist exists", () => {
  const distDir = path.join(root, "dist");
  if (!fs.existsSync(distDir)) return;

  assert.ok(fs.existsSync(path.join(root, "dist", "index.js")), "dist/index.js should exist");
  assert.ok(fs.existsSync(path.join(root, "dist", "index.d.ts")), "dist/index.d.ts should exist");
  assert.ok(fs.existsSync(path.join(root, "dist", "cli.js")), "dist/cli.js should exist");
  assert.equal(fs.existsSync(path.join(root, "dist", "test_daemon_helpers.js")), false, "dist should not contain test helper JS");
  assert.equal(fs.existsSync(path.join(root, "dist", "test_daemon_helpers.d.ts")), false, "dist should not contain test helper types");
  assert.equal(fs.existsSync(path.join(root, "dist", "tests")), false, "dist should not contain tests");
});

test("compiled runtime files do not contain repo-only @bc path aliases", () => {
  const distDir = path.join(root, "dist");
  if (!fs.existsSync(distDir)) return;

  const offenders: string[] = [];
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".js")) {
        const content = fs.readFileSync(fullPath, "utf8");
        if (content.includes('require("@bc/')) offenders.push(path.relative(root, fullPath));
      }
    }
  };
  visit(distDir);

  assert.deepEqual(offenders, [], "compiled package should use relative imports");
});

test("cli shim can be required without running the CLI", () => {
  const beforeExitCode = process.exitCode;
  const cli = require("../../cli") as { runCli?: unknown; parseArgs?: unknown };
  assert.equal(typeof cli.runCli, "function");
  assert.equal(typeof cli.parseArgs, "function");
  assert.equal(process.exitCode, beforeExitCode);
});

test(".env.example covers config registry env vars", () => {
  const content = readEnvExample();
  const entries = getConfigEntries({ validate: false });
  const required = new Set<string>();
  for (const entry of entries) {
    for (const envVar of entry.envVars) required.add(envVar);
  }

  for (const envVar of [...required].sort()) {
    assert.match(content, new RegExp(`^${envVar}=`, "m"), `.env.example should document ${envVar}`);
  }
});

test(".env.example covers first-run runtime env vars read outside config registry", () => {
  const content = readEnvExample();
  const required = [
    "BROKER_API_KEY",
    "BROKER_SECRET",
    "BROKER_ALLOWED_DOMAINS",
    "BROKER_ALLOWED_ORIGINS",
    "ENABLE_STEALTH",
    "PROXY_LIST",
    "CAPTCHA_TIMEOUT_MS",
    "STAGEHAND_MODEL",
    "AI_AGENT_COST_PER_TOKEN",
    "RESUME_POLICY",
    "MEMORY_ALERT_MB",
    "CHROME_TAB_LIMIT",
    "TERMINAL_MAX_OUTPUT_BYTES",
    "TERMINAL_MAX_SCROLLBACK_LINES",
    "TERMINAL_MAX_SERIALIZED_SESSIONS",
  ];

  for (const envVar of required) {
    assert.match(content, new RegExp(`^${envVar}=`, "m"), `.env.example should document ${envVar}`);
  }
});
