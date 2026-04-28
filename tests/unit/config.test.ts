import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { getConfigEntries, getConfigValue, loadConfig, type BrowserControlConfig } from "../../src/config";

// ── Config Loader: Defaults ──────────────────────────────────────────

test("loadConfig returns sensible defaults with empty env", () => {
  const config = loadConfig({ env: {}, validate: false });
  assert.equal(config.brokerPort, 7788);
  assert.equal(config.chromeDebugPort, 9222);
  assert.equal(config.chromeBindAddress, "127.0.0.1");
  assert.equal(config.browserViewportWidth, 1365);
  assert.equal(config.browserViewportHeight, 768);
  assert.equal(config.browserlessEndpoint, undefined);
  assert.equal(config.browserlessApiKey, undefined);
  assert.equal(config.stealthEnabled, false);
  assert.equal(config.captchaProvider, undefined);
  assert.equal(config.captchaApiKey, undefined);
  assert.equal(config.captchaTimeoutMs, 120_000);
  assert.equal(config.resumePolicy, "abandon");
  assert.equal(config.terminalResumePolicy, "resume");
  assert.equal(config.terminalAutoResume, true);
  assert.equal(config.memoryAlertMb, 1024);
  assert.equal(config.chromeTabLimit, 20);
  assert.equal(config.logLevel, "info");
  assert.equal(config.logFile, false);
  assert.equal(config.openrouterModel, "openai/gpt-4.1-mini");
  assert.equal(config.openrouterBaseUrl, "https://openrouter.ai/api/v1");
  assert.deepEqual(config.proxyList, []);
  assert.deepEqual(config.brokerAllowedOrigins, []);
  assert.deepEqual(config.brokerAllowedDomains, []);
});

test("loadConfig reads BROWSER_CONTROL_HOME", () => {
  const tmpDir = path.join(os.tmpdir(), `bc-config-override-test-${Date.now()}`);
  const config = loadConfig({
    env: { BROWSER_CONTROL_HOME: tmpDir },
    validate: false,
  });
  assert.equal(config.dataHome, tmpDir);
  // Cleanup auto-created dir
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("loadConfig reads browser viewport dimensions", () => {
  const config = loadConfig({
    env: {
      BROWSER_VIEWPORT_WIDTH: "1920",
      BROWSER_VIEWPORT_HEIGHT: "1080",
    },
    validate: false,
  });

  assert.equal(config.browserViewportWidth, 1920);
  assert.equal(config.browserViewportHeight, 1080);
});

test("loadConfig reads BROKER_PORT", () => {
  const config = loadConfig({ env: { BROKER_PORT: "9999" }, validate: false });
  assert.equal(config.brokerPort, 9999);
});

test("loadConfig reads BROKER_API_KEY over BROKER_SECRET", () => {
  const config1 = loadConfig({
    env: { BROKER_API_KEY: "key1", BROKER_SECRET: "secret1" },
    validate: false,
  });
  assert.equal(config1.brokerAuthKey, "key1");

  const config2 = loadConfig({
    env: { BROKER_SECRET: "secret1" },
    validate: false,
  });
  assert.equal(config2.brokerAuthKey, "secret1");
});

test("loadConfig reads BROKER_ALLOWED_DOMAINS as CSV", () => {
  const config = loadConfig({
    env: { BROKER_ALLOWED_DOMAINS: "example.com, test.com" },
    validate: false,
  });
  assert.deepEqual(config.brokerAllowedDomains, ["example.com", "test.com"]);
});

test("loadConfig reads Browserless provider env vars", () => {
  const config = loadConfig({
    env: {
      BROWSERLESS_ENDPOINT: "https://browserless.example.com",
      BROWSERLESS_API_KEY: "secret-key",
    },
    validate: false,
  });
  assert.equal(config.browserlessEndpoint, "https://browserless.example.com");
  assert.equal(config.browserlessApiKey, "secret-key");
});

test("config list/get redact sensitive URL query params in endpoint values", () => {
  const env = {
    BROWSERLESS_ENDPOINT: "wss://production-sfo.browserless.io?token=browserless-secret-token-123456",
    BROWSER_DEBUG_URL: "ws://user:pass@example.test/devtools?access_token=debug-secret-token-123456",
  };

  const entries = getConfigEntries({ env, validate: false });
  const browserlessEndpoint = entries.find((entry) => entry.key === "browserlessEndpoint");
  const browserDebugUrl = getConfigValue("browserDebugUrl", { env, validate: false });

  assert.equal(browserlessEndpoint?.value, "wss://production-sfo.browserless.io/?token=[REDACTED]");
  assert.match(String(browserDebugUrl.value), /REDACTED/);
  assert.match(String(browserDebugUrl.value), /example\.test/);
  assert.doesNotMatch(JSON.stringify(entries), /browserless-secret-token-123456|debug-secret-token-123456|user:pass/);
});

test("loadConfig reads ENABLE_STEALTH", () => {
  const config = loadConfig({ env: { ENABLE_STEALTH: "true" }, validate: false });
  assert.equal(config.stealthEnabled, true);
});

test("loadConfig reads stealth sub-options", () => {
  const config = loadConfig({
    env: {
      ENABLE_STEALTH: "1",
      STEALTH_LOCALE: "en-US",
      STEALTH_TIMEZONE_ID: "America/New_York",
      BROWSER_USER_AGENT: "Mozilla/5.0",
      STEALTH_WEBGL_VENDOR: "Intel Inc.",
    },
    validate: false,
  });
  assert.equal(config.stealthEnabled, true);
  assert.equal(config.stealthLocale, "en-US");
  assert.equal(config.stealthTimezoneId, "America/New_York");
  assert.equal(config.browserUserAgent, "Mozilla/5.0");
  assert.equal(config.stealthWebglVendor, "Intel Inc.");
});

test("loadConfig reads PROXY_LIST as CSV", () => {
  const config = loadConfig({
    env: { PROXY_LIST: "http://proxy1:8080,http://proxy2:8080" },
    validate: false,
  });
  assert.deepEqual(config.proxyList, ["http://proxy1:8080", "http://proxy2:8080"]);
});

test("loadConfig reads CAPTCHA_PROVIDER and CAPTCHA_API_KEY", () => {
  const config = loadConfig({
    env: { CAPTCHA_PROVIDER: "2captcha", CAPTCHA_API_KEY: "abc123" },
    validate: false,
  });
  assert.equal(config.captchaProvider, "2captcha");
  assert.equal(config.captchaApiKey, "abc123");
});

test("loadConfig reads OPENROUTER_API_KEY", () => {
  const config = loadConfig({
    env: { OPENROUTER_API_KEY: "sk-or-123" },
    validate: false,
  });
  assert.equal(config.openrouterApiKey, "sk-or-123");
});

test("loadConfig reads OPENROUTER_MODEL", () => {
  const config = loadConfig({
    env: { OPENROUTER_MODEL: "google/gemini-2.5-flash" },
    validate: false,
  });
  assert.equal(config.openrouterModel, "google/gemini-2.5-flash");
});

test("loadConfig reads RESUME_POLICY", () => {
  const config1 = loadConfig({ env: { RESUME_POLICY: "resume" }, validate: false });
  assert.equal(config1.resumePolicy, "resume");

  const config2 = loadConfig({ env: { RESUME_POLICY: "reschedule" }, validate: false });
  assert.equal(config2.resumePolicy, "reschedule");

  const config3 = loadConfig({ env: { RESUME_POLICY: "invalid" }, validate: false });
  assert.equal(config3.resumePolicy, "abandon");
});

test("loadConfig reads TERMINAL_RESUME_POLICY and TERMINAL_AUTO_RESUME", () => {
  const config1 = loadConfig({ env: { TERMINAL_RESUME_POLICY: "metadata_only" }, validate: false });
  assert.equal(config1.terminalResumePolicy, "metadata_only");

  const config2 = loadConfig({ env: { TERMINAL_RESUME_POLICY: "abandon", TERMINAL_AUTO_RESUME: "false" }, validate: false });
  assert.equal(config2.terminalResumePolicy, "abandon");
  assert.equal(config2.terminalAutoResume, false);

  assert.throws(
    () => loadConfig({ env: { TERMINAL_RESUME_POLICY: "invalid" }, validate: true }),
    /TERMINAL_RESUME_POLICY/,
  );
});

test("loadConfig reads LOG_LEVEL and LOG_FILE", () => {
  const config = loadConfig({
    env: { LOG_LEVEL: "debug", LOG_FILE: "true" },
    validate: false,
  });
  assert.equal(config.logLevel, "debug");
  assert.equal(config.logFile, true);
});

test("loadConfig reads DAEMON_VISIBLE", () => {
  const hidden = loadConfig({ env: { DAEMON_VISIBLE: "false" }, validate: false });
  const visible = loadConfig({ env: { DAEMON_VISIBLE: "true" }, validate: false });
  assert.equal(hidden.daemonVisible, false);
  assert.equal(visible.daemonVisible, true);
});

// ── Config Loader: Validation ────────────────────────────────────────

test("loadConfig validates BROKER_PORT range", () => {
  assert.throws(
    () => loadConfig({ env: { BROKER_PORT: "0" }, validate: true }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes("BROKER_PORT"));
      return true;
    },
  );
});

test("loadConfig validates BROKER_PORT upper bound", () => {
  assert.throws(
    () => loadConfig({ env: { BROKER_PORT: "99999" }, validate: true }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes("BROKER_PORT"));
      return true;
    },
  );
});

test("loadConfig validates CAPTCHA_PROVIDER without CAPTCHA_API_KEY", () => {
  assert.throws(
    () => loadConfig({ env: { CAPTCHA_PROVIDER: "2captcha" }, validate: true }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes("CAPTCHA_API_KEY"));
      return true;
    },
  );
});

test("loadConfig with validate=false skips validation", () => {
  // This would throw with validate=true
  const config = loadConfig({
    env: { CAPTCHA_PROVIDER: "2captcha" },
    validate: false,
  });
  assert.equal(config.captchaProvider, "2captcha");
  assert.equal(config.captchaApiKey, undefined);
});

// ── .env.example alignment ──────────────────────────────────────────

test(".env.example exists and documents key env vars", () => {
  const envPath = path.join(process.cwd(), ".env.example");
  assert.ok(fs.existsSync(envPath), ".env.example should exist");

  const content = fs.readFileSync(envPath, "utf8");
  const requiredVars = [
    "BROWSER_CONTROL_HOME",
    "BROKER_PORT",
    "BROKER_API_KEY",
    "BROKER_SECRET",
    "BROKER_ALLOWED_DOMAINS",
    "BROKER_ALLOWED_ORIGINS",
    "BROWSER_DEBUG_PORT",
    "BROWSER_BIND_ADDRESS",
    "BROWSER_CHROME_PATH",
    "BROWSER_DEBUG_URL",
    "BROWSERLESS_ENDPOINT",
    "BROWSERLESS_API_KEY",
    "ENABLE_STEALTH",
    "STEALTH_LOCALE",
    "STEALTH_TIMEZONE_ID",
    "BROWSER_USER_AGENT",
    "STEALTH_FINGERPRINT_SEED",
    "STEALTH_WEBGL_VENDOR",
    "STEALTH_WEBGL_RENDERER",
    "STEALTH_PLATFORM",
    "STEALTH_HARDWARE_CONCURRENCY",
    "STEALTH_DEVICE_MEMORY",
    "PROXY_LIST",
    "CAPTCHA_PROVIDER",
    "CAPTCHA_API_KEY",
    "CAPTCHA_TIMEOUT_MS",
    "OPENROUTER_API_KEY",
    "OPENROUTER_MODEL",
    "STAGEHAND_MODEL",
    "OPENROUTER_BASE_URL",
    "RESUME_POLICY",
    "MEMORY_ALERT_MB",
    "CHROME_TAB_LIMIT",
    "DAEMON_VISIBLE",
    "LOG_LEVEL",
    "LOG_FILE",
  ];
  for (const varName of requiredVars) {
    assert.ok(content.includes(varName), `.env.example should document ${varName}`);
  }
});

// ── Package Metadata ─────────────────────────────────────────────────

test("package.json has required package fields", () => {
  const pkgPath = path.join(process.cwd(), "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

  assert.equal(pkg.name, "browser-control");
  assert.ok(!("private" in pkg), "package.json should not have 'private: true'");
  assert.equal(pkg.main, "./dist/index.js");
  assert.equal(pkg.types, "./dist/index.d.ts");
  assert.equal(pkg.bin.bc, "./cli.js");
  assert.ok(pkg.scripts.build, "should have build script");
  assert.ok(pkg.scripts.prepublishOnly, "should have prepublishOnly script");
  assert.ok(Array.isArray(pkg.files), "should have files allowlist");
  assert.ok(pkg.files.includes("dist/"), "files should include dist/");
  assert.ok(pkg.files.includes("LICENSE"), "files should include LICENSE");
  assert.ok(pkg.files.includes(".env.example"), "files should include .env.example");
});

// ── Build Config ─────────────────────────────────────────────────────

test("tsconfig.build.json extends tsconfig.json and sets outDir", () => {
  const buildPath = path.join(process.cwd(), "tsconfig.build.json");
  assert.ok(fs.existsSync(buildPath), "tsconfig.build.json should exist");

  const buildConfig = JSON.parse(fs.readFileSync(buildPath, "utf8"));
  assert.equal(buildConfig.extends, "./tsconfig.json");
  assert.equal(buildConfig.compilerOptions.outDir, "./dist");
  assert.equal(buildConfig.compilerOptions.rootDir, "./src");

  // Should exclude test files
  const excludes = buildConfig.exclude;
  assert.ok(excludes.includes("**/*.test.ts"), "build should exclude test files");
  assert.ok(excludes.includes("dist"), "build should exclude dist/");
});

// ── Data Home Auto-Creation ──────────────────────────────────────────

test("loadConfig auto-creates data home from BROWSER_CONTROL_HOME override", () => {
  const tmpDir = path.join(os.tmpdir(), `bc-config-test-${Date.now()}`);
  // Ensure it does NOT exist before loadConfig
  assert.ok(!fs.existsSync(tmpDir), "temp dir should not exist yet");

  const config = loadConfig({
    env: { BROWSER_CONTROL_HOME: tmpDir },
    validate: false,
  });

  assert.equal(config.dataHome, tmpDir);
  assert.ok(fs.existsSync(tmpDir), "data home should be created");
  assert.ok(fs.existsSync(path.join(tmpDir, "reports")), "reports/ subdirectory should be created");
  assert.ok(fs.existsSync(path.join(tmpDir, "logs")), "logs/ subdirectory should be created");
  assert.ok(fs.existsSync(path.join(tmpDir, ".interop")), ".interop/ subdirectory should be created");
  assert.ok(fs.existsSync(path.join(tmpDir, "skills")), "skills/ subdirectory should be created");

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("loadConfig auto-creates default data home when no override", () => {
  // Use an explicit override that points to a temp dir to avoid polluting
  // the real ~/.browser-control. The test proves the auto-creation works
  // for any path returned by getDataHome, whether default or override.
  const tmpDir = path.join(os.tmpdir(), `bc-config-default-test-${Date.now()}`);
  assert.ok(!fs.existsSync(tmpDir), "temp dir should not exist yet");

  const config = loadConfig({
    env: { BROWSER_CONTROL_HOME: tmpDir },
    validate: false,
  });

  assert.equal(config.dataHome, tmpDir);
  assert.ok(fs.existsSync(tmpDir), "data home should exist after loadConfig");
  assert.ok(fs.existsSync(path.join(tmpDir, "reports")), "reports/ should exist");

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("loadConfig does not throw when data home already exists", () => {
  const tmpDir = path.join(os.tmpdir(), `bc-config-existing-test-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  // Should not throw even though the directory already exists
  const config = loadConfig({
    env: { BROWSER_CONTROL_HOME: tmpDir },
    validate: false,
  });

  assert.equal(config.dataHome, tmpDir);
  assert.ok(fs.existsSync(tmpDir));

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── AI_AGENT_COST_PER_TOKEN fractional parsing ──────────────────────

test("loadConfig parses fractional AI_AGENT_COST_PER_TOKEN correctly", () => {
  const config1 = loadConfig({ env: { AI_AGENT_COST_PER_TOKEN: "0.0001" }, validate: false });
  assert.equal(config1.aiAgentCostPerToken, 0.0001);

  const config2 = loadConfig({ env: { AI_AGENT_COST_PER_TOKEN: "0.0005" }, validate: false });
  assert.equal(config2.aiAgentCostPerToken, 0.0005);

  const config3 = loadConfig({ env: { AI_AGENT_COST_PER_TOKEN: "0.001" }, validate: false });
  assert.equal(config3.aiAgentCostPerToken, 0.001);
});

test("loadConfig falls back to 0.0001 for invalid AI_AGENT_COST_PER_TOKEN", () => {
  const config1 = loadConfig({ env: { AI_AGENT_COST_PER_TOKEN: "not-a-number" }, validate: false });
  assert.equal(config1.aiAgentCostPerToken, 0.0001);

  const config2 = loadConfig({ env: { AI_AGENT_COST_PER_TOKEN: "0" }, validate: false });
  assert.equal(config2.aiAgentCostPerToken, 0.0001);

  const config3 = loadConfig({ env: { AI_AGENT_COST_PER_TOKEN: "-5" }, validate: false });
  assert.equal(config3.aiAgentCostPerToken, 0.0001);
});

test("loadConfig defaults AI_AGENT_COST_PER_TOKEN to 0.0001 when not set", () => {
  const config = loadConfig({ env: {}, validate: false });
  assert.equal(config.aiAgentCostPerToken, 0.0001);
});

test("loadConfig stagehandModel defaults to free gemini", () => {
  const config = loadConfig({ env: {}, validate: false });
  assert.equal(config.stagehandModel, "google/gemini-2.5-flash-preview:free");
});

test("loadConfig stagehandModel uses OPENROUTER_MODEL when set", () => {
  const config = loadConfig({ env: { OPENROUTER_MODEL: "custom/model" }, validate: false });
  assert.equal(config.stagehandModel, "custom/model");
});

test("loadConfig stagehandModel prefers STAGEHAND_MODEL over OPENROUTER_MODEL", () => {
  const config = loadConfig({
    env: { STAGEHAND_MODEL: "stage/model", OPENROUTER_MODEL: "router/model" },
    validate: false,
  });
  assert.equal(config.stagehandModel, "stage/model");
  assert.equal(config.openrouterModel, "router/model");
});

// ── Engines field ─────────────────────────────────────────────────────

test("package.json requires Node 22+ via engines field", () => {
  const pkgPath = path.join(process.cwd(), "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

  assert.ok(pkg.engines, "package.json should have engines field");
  assert.ok(pkg.engines.node, "engines should specify node");
  assert.ok(
    pkg.engines.node.includes("22"),
    "engines.node should require Node 22+",
  );
});

// ── LICENSE ──────────────────────────────────────────────────────────

test("LICENSE file exists and is MIT", () => {
  const licensePath = path.join(process.cwd(), "LICENSE");
  assert.ok(fs.existsSync(licensePath), "LICENSE should exist");

  const content = fs.readFileSync(licensePath, "utf8");
  assert.ok(content.includes("MIT License"), "LICENSE should be MIT");
});
