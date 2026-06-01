/**
 * Typed configuration loader for browser-control.
 *
 * Centralizes environment variable reads so runtime code doesn't
 * scatter `process.env.X` throughout the codebase.  Load once at
 * startup with `loadConfig()` and pass the result where needed.
 *
 * Design choices:
 *   - No external config framework — just typed accessors over process.env
 *   - Validation fires on load(); missing required vars produce clear errors
 *   - Optional vars have documented defaults
 *   - A `validate: false` option skips strict checks for CLI-only use
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDataHome as _getDataHome, ensureDataHomeAtPath, getUserConfigPath } from "./paths";
import { redactString } from "../observability/redaction";

/** Allow override for testing. */
function getDataHome(env?: NodeJS.ProcessEnv): string {
  if (env) {
    const override = env.BROWSER_CONTROL_HOME;
    if (override && override.trim()) return override.trim();
  }
  return _getDataHome();
}

// ── Config Shape ─────────────────────────────────────────────────────

export interface BrowserControlConfig {
  /** Data directory root (default: ~/.browser-control, override: BROWSER_CONTROL_HOME) */
  dataHome: string;

  // ── Broker / Server ─────────────────────────────────────────────
  /** Broker HTTP port (default: 7788) */
  brokerPort: number;
  /** Broker auth key (BROKER_API_KEY or fallback BROKER_SECRET) */
  brokerAuthKey: string | undefined;
  /** Comma-separated CORS origins the broker allows */
  brokerAllowedOrigins: string[];
  /** Comma-separated domains the broker accepts tasks for */
  brokerAllowedDomains: string[];

  // ── Chrome / CDP ────────────────────────────────────────────────
  /** Chrome remote-debugging port (default: 9222) */
  chromeDebugPort: number;
  /** Chrome debug bind address (default: 127.0.0.1) */
  chromeBindAddress: string;
  /** Explicit Chrome binary path (optional) */
  chromePath: string | undefined;
  /** Explicit CDP URL override (optional) */
  browserDebugUrl: string | undefined;
  /** Browser ownership mode (default: attach) */
  browserMode: "managed" | "attach";
  /** Whether to auto-launch a managed browser when attach fails (default: true) */
  browserAutoLaunch: boolean;
  /** Visible launcher profile mode (default: system) */
  browserLaunchProfile: "system" | "isolated";
  /** Explicit Chrome user-data-dir for visible launcher */
  browserUserDataDir: string | undefined;
  /** Default automation-owned browser viewport width (default: 1365) */
  browserViewportWidth: number;
  /** Default automation-owned browser viewport height (default: 768) */
  browserViewportHeight: number;

  // ── Stealth ─────────────────────────────────────────────────────
  /** Whether stealth mode is enabled (default: false) */
  stealthEnabled: boolean;
  stealthLocale: string | undefined;
  stealthTimezoneId: string | undefined;
  stealthFingerprintSeed: string | undefined;
  stealthWebglVendor: string | undefined;
  stealthWebglRenderer: string | undefined;
  stealthPlatform: string | undefined;
  stealthHardwareConcurrency: number | undefined;
  stealthDeviceMemory: number | undefined;
  browserUserAgent: string | undefined;

  // ── Proxy ──────────────────────────────────────────────────────
  /** Comma-separated proxy URLs (PROXY_LIST) */
  proxyList: string[];

  // ── CAPTCHA ────────────────────────────────────────────────────
  captchaProvider: string | undefined;
  captchaApiKey: string | undefined;
  captchaTimeoutMs: number;

  // ── AI Agent / OpenRouter ──────────────────────────────────────
  modelProvider: "openrouter" | "ollama" | "openai-compatible";
  modelEndpoint: string | undefined;
  modelApiKey: string | undefined;
  modelName: string | undefined;
  openrouterApiKey: string | undefined;
  openrouterModel: string;
  openrouterBaseUrl: string;
  aiAgentCostPerToken: number;
  /** Stagehand model — defaults to free gemini; falls back to OPENROUTER_MODEL when set */
  stagehandModel: string;

  // ── Daemon ─────────────────────────────────────────────────────
  /** Resume policy for interrupted tasks (default: "abandon") */
  resumePolicy: "resume" | "reschedule" | "abandon";
  /** Memory alert threshold in MB (default: 1024) */
  memoryAlertMb: number;
  /** Chrome session limit (default: 20) */
  chromeTabLimit: number;
  /** Whether daemon launches should use a visible console window on Windows */
  daemonVisible: boolean;

  // ── Logging ────────────────────────────────────────────────────
  logLevel: string;
  logFile: boolean;

  // ── Policy ─────────────────────────────────────────────────────
  /** Default policy profile (safe, balanced, or trusted) */
  policyProfile: string;

  // ── Provider ─────────────────────────────────────────────────────
  browserlessEndpoint: string | undefined;
  browserlessApiKey: string | undefined;

  // ── Terminal (Section 12 + 13) ────────────────────────────────────
  /** Default shell for terminal sessions (auto-detected if omitted) */
  terminalShell: string | undefined;
  /** Default terminal columns (default: 80) */
  terminalCols: number;
  /** Default terminal rows (default: 24) */
  terminalRows: number;
  /** Max output bytes per command (default: 1MB) */
  terminalMaxOutputBytes: number;
  /** Max scrollback lines to persist across daemon restarts (default: 10_000) */
  terminalMaxScrollbackLines: number;
  /** Max serialized terminal sessions to keep (default: 50) */
  terminalMaxSerializedSessions: number;
  /** Terminal recovery policy on daemon startup (default: "resume") */
  terminalResumePolicy: "resume" | "metadata_only" | "abandon";
  /** Auto-resume terminal sessions on daemon startup (default: true) */
  terminalAutoResume: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────

function splitCsv(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function getBrokerAuthKeyPath(env: NodeJS.ProcessEnv): string {
  return path.join(getDataHome(env), "secrets", "broker-api-key");
}

function getLegacyBrokerAuthKeyPaths(env: NodeJS.ProcessEnv): string[] {
  const home = getDataHome(env);
  return [
    path.join(home, "interop", "broker-api-key"),
    path.join(home, ".interop", "broker-api-key"),
  ];
}

function writePrivateFile(filePath: string, value: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, `${value.trim()}\n`, { mode: 0o600 });
  if (process.platform !== "win32") {
    fs.chmodSync(path.dirname(filePath), 0o700);
    fs.chmodSync(filePath, 0o600);
  }
}

function removeLegacyBrokerAuthKeyFiles(env: NodeJS.ProcessEnv): void {
  for (const legacyPath of getLegacyBrokerAuthKeyPaths(env)) {
    if (fs.existsSync(legacyPath)) {
      fs.rmSync(legacyPath, { force: true });
    }
  }
}

function migrateLegacyBrokerAuthKeyFile(env: NodeJS.ProcessEnv): string | undefined {
  const canonicalPath = getBrokerAuthKeyPath(env);
  for (const legacyPath of getLegacyBrokerAuthKeyPaths(env)) {
    if (!fs.existsSync(legacyPath)) continue;
    const key = normalizeOptionalString(fs.readFileSync(legacyPath, "utf8"));
    if (!key) continue;
    if (!fs.existsSync(canonicalPath)) {
      writePrivateFile(canonicalPath, key);
    }
    removeLegacyBrokerAuthKeyFiles(env);
    return normalizeOptionalString(fs.readFileSync(canonicalPath, "utf8")) ?? key;
  }
  return undefined;
}

function readBrokerAuthKeyFile(env: NodeJS.ProcessEnv): string | undefined {
  const filePath = getBrokerAuthKeyPath(env);
  if (fs.existsSync(filePath)) {
    removeLegacyBrokerAuthKeyFiles(env);
    return normalizeOptionalString(fs.readFileSync(filePath, "utf8"));
  }
  return migrateLegacyBrokerAuthKeyFile(env);
}

export function ensureBrokerAuthKey(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = normalizeOptionalString(env.BROKER_API_KEY) ?? normalizeOptionalString(env.BROKER_SECRET);
  if (fromEnv) return fromEnv;
  const existing = readBrokerAuthKeyFile(env);
  if (existing) return existing;

  const key = `brk_${randomUUID().replace(/-/g, "")}`;
  const filePath = getBrokerAuthKeyPath(env);
  writePrivateFile(filePath, key);
  return key;
}

// ── User-Scoped Config Registry ──────────────────────────────────────

export type ConfigSource = "default" | "user" | "env";
export type ConfigValue = string | number | boolean | string[] | undefined;
export type ConfigCategory =
  | "runtime"
  | "broker"
  | "browser"
  | "policy"
  | "daemon"
  | "logging"
  | "terminal"
  | "provider"
  | "captcha"
  | "ai"
  | "proxy"
  | "stealth";

export type ConfigKey =
  | "dataHome"
  | "brokerPort"
  | "brokerAuthKey"
  | "brokerAllowedOrigins"
  | "brokerAllowedDomains"
  | "chromeDebugPort"
  | "chromeBindAddress"
  | "chromePath"
  | "browserDebugUrl"
  | "browserMode"
  | "browserAutoLaunch"
  | "browserLaunchProfile"
  | "browserUserDataDir"
  | "browserViewportWidth"
  | "browserViewportHeight"
  | "browserUserAgent"
  | "stealthEnabled"
  | "stealthLocale"
  | "stealthTimezoneId"
  | "stealthFingerprintSeed"
  | "stealthWebglVendor"
  | "stealthWebglRenderer"
  | "stealthPlatform"
  | "stealthHardwareConcurrency"
  | "stealthDeviceMemory"
  | "proxyList"
  | "policyProfile"
  | "daemonVisible"
  | "resumePolicy"
  | "memoryAlertMb"
  | "chromeTabLimit"
  | "logLevel"
  | "logFile"
  | "terminalShell"
  | "terminalCols"
  | "terminalRows"
  | "terminalMaxOutputBytes"
  | "terminalMaxScrollbackLines"
  | "terminalMaxSerializedSessions"
  | "terminalResumePolicy"
  | "terminalAutoResume"
  | "browserlessEndpoint"
  | "browserlessApiKey"
  | "captchaProvider"
  | "captchaApiKey"
  | "captchaTimeoutMs"
  | "modelProvider"
  | "modelEndpoint"
  | "modelApiKey"
  | "modelName"
  | "openrouterModel"
  | "openrouterBaseUrl"
  | "openrouterApiKey"
  | "aiAgentCostPerToken"
  | "stagehandModel";

export type UserConfig = Partial<Record<ConfigKey, ConfigValue>>;

export interface ConfigEntry {
  key: ConfigKey;
  category: ConfigCategory;
  value: ConfigValue | "[redacted]";
  defaultValue: ConfigValue | "[redacted]";
  source: ConfigSource;
  sensitive: boolean;
  envVars: string[];
  description: string;
}

export interface ConfigEnvEntry {
  envVar: string;
  category: string;
  description: string;
  configKey?: ConfigKey;
  sensitive: boolean;
  currentValue: string | "[redacted]" | undefined;
  source: "env" | "unset";
  defaultValue?: string;
}

export interface ConfigSetResult {
  key: ConfigKey;
  value: ConfigValue | "[redacted]";
  source: "user";
  configPath: string;
}

interface ConfigDefinition {
  key: ConfigKey;
  category: ConfigCategory;
  envVars: string[];
  sensitive?: boolean;
  description: string;
  defaultValue: (env: NodeJS.ProcessEnv) => ConfigValue;
  parse: (value: unknown, key: ConfigKey) => ConfigValue;
  validate?: (value: ConfigValue, key: ConfigKey) => void;
}

interface AdditionalConfigEnvDefinition {
  envVar: string;
  category: string;
  description: string;
  sensitive?: boolean;
  defaultValue?: string;
}

const CONFIG_VALUE_SCHEMA = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.undefined(),
]);
const USER_CONFIG_SCHEMA = z.record(z.string(), CONFIG_VALUE_SCHEMA);

function requiredString(value: unknown, key: ConfigKey): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(value: unknown, key: ConfigKey): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error(`${key} must be a string.`);
  return normalizeOptionalString(value);
}

function integerValue(value: unknown, key: ConfigKey): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${key} must be an integer.`);
  return parsed;
}

function booleanValue(value: unknown, key: ConfigKey): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(lowered)) return true;
    if (["0", "false", "no", "off"].includes(lowered)) return false;
  }
  throw new Error(`${key} must be a boolean.`);
}

function stringArrayValue(value: unknown, key: ConfigKey): string[] {
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value.map((item) => item.trim()).filter(Boolean);
  }
  if (typeof value === "string") return splitCsv(value);
  throw new Error(`${key} must be a string array or comma-separated string.`);
}

function optionalPositiveInt(value: unknown, key: ConfigKey): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return positiveIntValue(value, key);
}

function positiveIntValue(value: unknown, key: ConfigKey): number {
  const parsed = integerValue(value, key);
  if (parsed < 1) throw new Error(`${key} must be a positive integer.`);
  return parsed;
}

function positiveFloatValue(value: unknown, key: ConfigKey): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive number.`);
  }
  return parsed;
}

function resumePolicyValue(value: unknown): "resume" | "reschedule" | "abandon" {
  const lowered = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (lowered === "resume" || lowered === "reschedule") return lowered;
  return "abandon";
}

function ensurePort(value: ConfigValue, key: ConfigKey): void {
  if (typeof value !== "number" || value < 1 || value > 65535) {
    throw new Error(`${key} must be between 1 and 65535.`);
  }
}

function ensurePositiveInt(value: ConfigValue, key: ConfigKey): void {
  if (typeof value !== "number" || value < 1) {
    throw new Error(`${key} must be a positive integer.`);
  }
}

function ensureAllowed(values: string[]): (value: ConfigValue, key: ConfigKey) => void {
  return (value, key) => {
    if (typeof value !== "string" || !values.includes(value)) {
      throw new Error(`${key} must be one of: ${values.join(", ")}.`);
    }
  };
}

function ensureUrl(value: ConfigValue, key: ConfigKey): void {
  if (value === undefined) return;
  if (typeof value !== "string") throw new Error(`${key} must be a URL string.`);
  try {
    new URL(value);
  } catch {
    throw new Error(`${key} must be a valid URL.`);
  }
}

const CONFIG_DEFINITIONS: ConfigDefinition[] = [
  { key: "dataHome", category: "runtime", envVars: ["BROWSER_CONTROL_HOME"], description: "Directory used for Browser Control runtime state, including sessions, logs, screenshots, profiles, and durable stores. Set this when you need an isolated workspace or a non-default data location.", defaultValue: (env) => getDataHome(env), parse: requiredString },
  { key: "brokerPort", category: "broker", envVars: ["BROKER_PORT"], description: "Port for the local broker HTTP API and WebSocket server. Change this when another service already uses the default port or when running multiple instances.", defaultValue: () => 7788, parse: integerValue, validate: ensurePort },
  { key: "brokerAuthKey", category: "broker", envVars: ["BROKER_API_KEY", "BROKER_SECRET"], description: "Bearer token required for broker HTTP and WebSocket access. Prefer BROKER_API_KEY; BROKER_SECRET remains supported for legacy deployments.", defaultValue: () => undefined, parse: optionalString, sensitive: true },
  { key: "brokerAllowedOrigins", category: "broker", envVars: ["BROKER_ALLOWED_ORIGINS"], description: "Comma-separated browser origins allowed by the broker CORS guard. Use exact loopback origins for local dashboards and avoid broad wildcards unless explicitly needed.", defaultValue: () => [], parse: stringArrayValue },
  { key: "brokerAllowedDomains", category: "broker", envVars: ["BROKER_ALLOWED_DOMAINS"], description: "Comma-separated host or domain allowlist for broker-submitted task URLs. Use this to restrict remote task navigation targets for shared or automated environments.", defaultValue: () => [], parse: stringArrayValue },
  { key: "chromeDebugPort", category: "browser", envVars: ["BROWSER_DEBUG_PORT"], description: "Chrome DevTools Protocol port used when attaching to a visible browser. The launcher scripts and attach-mode commands must use the same port.", defaultValue: () => 9222, parse: integerValue, validate: ensurePort },
  { key: "chromeBindAddress", category: "browser", envVars: ["BROWSER_BIND_ADDRESS"], description: "Network address where launched Chrome exposes its debugging port. Keep this on localhost unless you explicitly understand the remote-control risk.", defaultValue: () => "127.0.0.1", parse: requiredString },
  { key: "chromePath", category: "browser", envVars: ["BROWSER_CHROME_PATH"], description: "Explicit filesystem path to the Chrome or Chromium executable. Use this when automatic browser discovery picks the wrong binary or cannot find Chrome.", defaultValue: () => undefined, parse: optionalString },
  { key: "browserDebugUrl", category: "browser", envVars: ["BROWSER_DEBUG_URL"], description: "Full Chrome DevTools Protocol endpoint to attach to instead of deriving one from host and port. Use this for remote CDP providers, forwarded ports, or non-standard browser endpoints.", defaultValue: () => undefined, parse: optionalString, validate: ensureUrl },
  { key: "browserMode", category: "browser", envVars: ["BROWSER_MODE"], description: "Controls whether Browser Control attaches to an existing browser or launches a managed browser it owns. Use `attach` for a visible user browser and `managed` for isolated automation sessions.", defaultValue: () => "attach", parse: requiredString, validate: ensureAllowed(["managed", "attach"]) },
  { key: "browserAutoLaunch", category: "browser", envVars: ["BROWSER_AUTO_LAUNCH"], description: "Allows Browser Control to launch an attachable browser when attach mode cannot find one. Disable this when browser startup must be manual or externally supervised.", defaultValue: () => true, parse: booleanValue },
  { key: "browserLaunchProfile", category: "browser", envVars: ["BROWSER_LAUNCH_PROFILE"], description: "Profile mode used by the visible browser launcher. Use `isolated` for a Browser Control profile and `system` only when you intentionally want the normal Chrome profile.", defaultValue: () => "isolated", parse: requiredString, validate: ensureAllowed(["system", "isolated"]) },
  { key: "browserUserDataDir", category: "browser", envVars: ["BROWSER_USER_DATA_DIR"], description: "Explicit Chrome user-data directory for the visible launcher. Use this to point launched Chrome at a known profile directory without relying on the default profile manager.", defaultValue: () => undefined, parse: optionalString },
  { key: "browserViewportWidth", category: "browser", envVars: ["BROWSER_VIEWPORT_WIDTH"], description: "Default viewport width for automation-owned browser contexts. This affects screenshots, layout-sensitive interactions, and tests that depend on responsive breakpoints.", defaultValue: () => 1365, parse: integerValue, validate: ensurePositiveInt },
  { key: "browserViewportHeight", category: "browser", envVars: ["BROWSER_VIEWPORT_HEIGHT"], description: "Default viewport height for automation-owned browser contexts. This affects visible page area, screenshot dimensions, and scroll behavior.", defaultValue: () => 768, parse: integerValue, validate: ensurePositiveInt },
  { key: "browserUserAgent", category: "browser", envVars: ["BROWSER_USER_AGENT"], description: "User-Agent string applied to automation-owned browser contexts. Use this only when a target site or test requires a specific client identity.", defaultValue: () => undefined, parse: optionalString },
  { key: "stealthEnabled", category: "stealth", envVars: ["ENABLE_STEALTH"], description: "Enables stealth browser context options where supported. Use this only for legitimate testing scenarios that require deterministic fingerprint controls.", defaultValue: () => false, parse: booleanValue },
  { key: "stealthLocale", category: "stealth", envVars: ["STEALTH_LOCALE"], description: "Locale value exposed in stealth contexts. Use this when tests need consistent language and regional formatting across machines.", defaultValue: () => undefined, parse: optionalString },
  { key: "stealthTimezoneId", category: "stealth", envVars: ["STEALTH_TIMEZONE_ID"], description: "Timezone identifier exposed in stealth contexts. Use this when tests need stable timezone behavior independent of host settings.", defaultValue: () => undefined, parse: optionalString },
  { key: "stealthFingerprintSeed", category: "stealth", envVars: ["STEALTH_FINGERPRINT_SEED"], description: "Seed used to derive deterministic stealth fingerprint values. This can identify runs and is treated as sensitive.", defaultValue: () => undefined, parse: optionalString, sensitive: true },
  { key: "stealthWebglVendor", category: "stealth", envVars: ["STEALTH_WEBGL_VENDOR"], description: "WebGL vendor string exposed in stealth contexts. Use this only for deterministic fingerprint testing of legitimate web workflows.", defaultValue: () => undefined, parse: optionalString },
  { key: "stealthWebglRenderer", category: "stealth", envVars: ["STEALTH_WEBGL_RENDERER"], description: "WebGL renderer string exposed in stealth contexts. Use this only for deterministic fingerprint testing of legitimate web workflows.", defaultValue: () => undefined, parse: optionalString },
  { key: "stealthPlatform", category: "stealth", envVars: ["STEALTH_PLATFORM"], description: "Navigator platform value exposed in stealth contexts. Use this when deterministic platform fingerprints are required for repeatable tests.", defaultValue: () => undefined, parse: optionalString },
  { key: "stealthHardwareConcurrency", category: "stealth", envVars: ["STEALTH_HARDWARE_CONCURRENCY"], description: "Navigator hardwareConcurrency value exposed in stealth contexts. Use this to keep CPU-core fingerprints stable in controlled tests.", defaultValue: () => undefined, parse: optionalPositiveInt },
  { key: "stealthDeviceMemory", category: "stealth", envVars: ["STEALTH_DEVICE_MEMORY"], description: "Navigator deviceMemory value exposed in stealth contexts. Use this only when a test needs a deterministic browser fingerprint.", defaultValue: () => undefined, parse: optionalPositiveInt },
  { key: "proxyList", category: "proxy", envVars: ["PROXY_LIST"], description: "Comma-separated proxy URL list used by proxy-aware workflows. Proxy URLs can contain credentials, so this value is treated as sensitive.", defaultValue: () => [], parse: stringArrayValue, sensitive: true },
  { key: "policyProfile", category: "policy", envVars: ["POLICY_PROFILE"], description: "Default safety policy profile for sessions and actions. Use `safe` for stricter automation, `balanced` for normal work, and `trusted` only for high-trust local workflows.", defaultValue: () => "balanced", parse: requiredString, validate: ensureAllowed(["safe", "balanced", "trusted"]) },
  { key: "daemonVisible", category: "daemon", envVars: ["DAEMON_VISIBLE"], description: "Controls whether daemon helper processes use a visible console window on Windows. Keep it false for background operation and enable it only when debugging daemon startup.", defaultValue: () => false, parse: booleanValue },
  { key: "resumePolicy", category: "daemon", envVars: ["RESUME_POLICY"], description: "Task resume policy used after daemon interruption. Use this to decide whether interrupted work should be abandoned, resumed, or rescheduled.", defaultValue: () => "abandon", parse: resumePolicyValue },
  { key: "memoryAlertMb", category: "daemon", envVars: ["MEMORY_ALERT_MB"], description: "Memory threshold in megabytes used by health checks. Increase this on large hosts or lower it to catch memory growth earlier.", defaultValue: () => 1024, parse: positiveIntValue },
  { key: "chromeTabLimit", category: "daemon", envVars: ["CHROME_TAB_LIMIT"], description: "Maximum active Chrome tabs before health checks warn. Use this to detect tab leaks and runaway browser workflows.", defaultValue: () => 20, parse: positiveIntValue },
  { key: "logLevel", category: "logging", envVars: ["LOG_LEVEL"], description: "Minimum severity level written to logs. Use `debug` for diagnosis and `info` or higher for normal local operation.", defaultValue: () => "info", parse: requiredString, validate: ensureAllowed(["debug", "info", "warn", "error", "critical"]) },
  { key: "logFile", category: "logging", envVars: ["LOG_FILE"], description: "Controls whether logs are also persisted to files under the runtime data home. Enable this when you need post-run diagnostics beyond terminal output.", defaultValue: () => false, parse: booleanValue },
  { key: "terminalShell", category: "terminal", envVars: ["TERMINAL_SHELL"], description: "Default shell executable or named shell for terminal sessions. Use this to prefer PowerShell, bash, zsh, or another installed shell.", defaultValue: () => undefined, parse: optionalString },
  { key: "terminalCols", category: "terminal", envVars: ["TERMINAL_COLS"], description: "Default terminal width in columns for new terminal sessions. Increase this when commands wrap too aggressively or when testing wide terminal layouts.", defaultValue: () => 80, parse: integerValue, validate: ensurePositiveInt },
  { key: "terminalRows", category: "terminal", envVars: ["TERMINAL_ROWS"], description: "Default terminal height in rows for new terminal sessions. Increase this when interactive tools need more visible screen space.", defaultValue: () => 24, parse: integerValue, validate: ensurePositiveInt },
  { key: "terminalMaxOutputBytes", category: "terminal", envVars: ["TERMINAL_MAX_OUTPUT_BYTES"], description: "Maximum bytes captured from one terminal command. This bounds memory and response size for commands with large output.", defaultValue: () => 1024 * 1024, parse: positiveIntValue },
  { key: "terminalMaxScrollbackLines", category: "terminal", envVars: ["TERMINAL_MAX_SCROLLBACK_LINES"], description: "Maximum terminal scrollback lines persisted for resume. Increase this for long-running interactive sessions or reduce it to limit stored output.", defaultValue: () => 10_000, parse: positiveIntValue },
  { key: "terminalMaxSerializedSessions", category: "terminal", envVars: ["TERMINAL_MAX_SERIALIZED_SESSIONS"], description: "Maximum number of terminal sessions retained for resume. Increase this for many concurrent terminals or reduce it to keep startup recovery small.", defaultValue: () => 50, parse: positiveIntValue },
  { key: "terminalResumePolicy", category: "terminal", envVars: ["TERMINAL_RESUME_POLICY"], description: "Policy for reconstructing terminal sessions after daemon startup. Use `resume` to restore metadata and buffer, `metadata_only` to preserve identity only, or `abandon` to start clean.", defaultValue: () => "resume", parse: requiredString, validate: ensureAllowed(["resume", "metadata_only", "abandon"]) },
  { key: "terminalAutoResume", category: "terminal", envVars: ["TERMINAL_AUTO_RESUME"], description: "Controls whether terminal sessions are automatically restored when the daemon starts. Disable this when stale terminal state is more harmful than losing prior session context.", defaultValue: () => true, parse: booleanValue },
  { key: "browserlessEndpoint", category: "provider", envVars: ["BROWSERLESS_ENDPOINT"], description: "WebSocket or HTTPS endpoint for a Browserless remote browser provider. Configure this when browser sessions should run outside the local machine.", defaultValue: () => undefined, parse: optionalString, validate: ensureUrl },
  { key: "browserlessApiKey", category: "provider", envVars: ["BROWSERLESS_API_KEY"], description: "API key sent to the Browserless provider when the endpoint does not already include a token. This is sensitive and is redacted from config inventories.", defaultValue: () => undefined, parse: optionalString, sensitive: true },
  {
    key: "captchaProvider",
    category: "captcha",
    envVars: ["CAPTCHA_PROVIDER"],
    description: "CAPTCHA solving provider used by browser automation when solver support is enabled. Leave this unset unless a workflow explicitly needs CAPTCHA solving.",
    defaultValue: () => undefined,
    parse: optionalString,
    validate: (value, key) => {
      if (value !== undefined) ensureAllowed(["2captcha", "anticaptcha", "capsolver"])(value, key);
    },
  },
  { key: "captchaApiKey", category: "captcha", envVars: ["CAPTCHA_API_KEY"], description: "API key for the configured CAPTCHA solving provider. This is sensitive and should only be set for workflows that are allowed to use solver services.", defaultValue: () => undefined, parse: optionalString, sensitive: true },
  { key: "captchaTimeoutMs", category: "captcha", envVars: ["CAPTCHA_TIMEOUT_MS"], description: "Maximum time in milliseconds to wait for a CAPTCHA solver response. Increase this for slower providers or reduce it to fail blocked workflows faster.", defaultValue: () => 120_000, parse: positiveIntValue },
  { key: "modelProvider", category: "ai", envVars: ["BROWSER_CONTROL_MODEL_PROVIDER"], description: "Canonical model provider used by the Browser Control model router. Choose `openrouter`, `ollama`, or `openai-compatible` based on where model requests should be sent.", defaultValue: () => "openrouter", parse: requiredString, validate: ensureAllowed(["openrouter", "ollama", "openai-compatible"]) },
  { key: "modelEndpoint", category: "ai", envVars: ["BROWSER_CONTROL_MODEL_ENDPOINT"], description: "Canonical base URL override for the selected model provider. When modelProvider is `openrouter`, this takes precedence over legacy openrouterBaseUrl.", defaultValue: () => undefined, parse: optionalString, validate: ensureUrl },
  { key: "modelApiKey", category: "ai", envVars: ["BROWSER_CONTROL_MODEL_API_KEY"], description: "Canonical API key for the selected model provider in the model router. When modelProvider is `openrouter`, this sensitive value takes precedence over legacy openrouterApiKey.", defaultValue: () => undefined, parse: optionalString, sensitive: true },
  { key: "modelName", category: "ai", envVars: ["BROWSER_CONTROL_MODEL_NAME"], description: "Canonical model identifier used by the selected model provider. When modelProvider is `openrouter`, this takes precedence over legacy openrouterModel.", defaultValue: () => undefined, parse: optionalString },
  { key: "openrouterModel", category: "ai", envVars: ["OPENROUTER_MODEL", "AI_AGENT_MODEL"], description: "Legacy OpenRouter model slug kept for older AI-agent configuration. Prefer modelName because canonical model* settings take precedence when both are configured.", defaultValue: () => "openai/gpt-4.1-mini", parse: requiredString },
  { key: "openrouterBaseUrl", category: "ai", envVars: ["OPENROUTER_BASE_URL"], description: "Legacy OpenRouter base URL kept for compatibility with older configuration. Prefer modelEndpoint because canonical model* settings take precedence when both are configured.", defaultValue: () => "https://openrouter.ai/api/v1", parse: requiredString, validate: ensureUrl },
  { key: "openrouterApiKey", category: "ai", envVars: ["OPENROUTER_API_KEY"], description: "Legacy API key for OpenRouter-backed AI-agent features. Prefer modelApiKey because canonical model* settings take precedence when both are configured.", defaultValue: () => undefined, parse: optionalString, sensitive: true },
  { key: "aiAgentCostPerToken", category: "ai", envVars: ["AI_AGENT_COST_PER_TOKEN"], description: "Estimated AI-agent cost per token used for local cost tracking and budgeting. Set this when your configured model has different pricing than the default estimate.", defaultValue: () => 0.0001, parse: positiveFloatValue },
  { key: "stagehandModel", category: "ai", envVars: ["STAGEHAND_MODEL", "OPENROUTER_MODEL"], description: "Model override used by Stagehand-backed automation. Explicit STAGEHAND_MODEL wins, then OPENROUTER_MODEL, then the free Gemini default.", defaultValue: (env) => normalizeOptionalString(env.OPENROUTER_MODEL) ?? "google/gemini-2.5-flash-preview:free", parse: requiredString },
];

const ADDITIONAL_CONFIG_ENV_DEFINITIONS: AdditionalConfigEnvDefinition[] = [
  { envVar: "BROKER_API_KEY", category: "broker", description: "Bearer token required for broker HTTP and WebSocket access. This is the preferred broker secret and is redacted from inventories.", sensitive: true },
  { envVar: "BROKER_SECRET", category: "broker", description: "Legacy broker bearer token kept for backward compatibility. Prefer BROKER_API_KEY for new deployments.", sensitive: true },
  { envVar: "BROKER_ALLOWED_ORIGINS", category: "broker", description: "Comma-separated browser origins allowed by the broker CORS guard. Use exact origins such as `http://127.0.0.1:5173`, not broad domains.", defaultValue: "" },
  { envVar: "BROKER_ALLOWED_DOMAINS", category: "broker", description: "Comma-separated host or domain allowlist for broker-submitted task URLs. Use this to restrict remote task navigation targets.", defaultValue: "" },
  { envVar: "BROKER_MAX_BODY_BYTES", category: "broker", description: "Maximum JSON request body size accepted by the broker. Lower this to reduce abuse risk or raise it only for known large payloads.", defaultValue: "1048576" },
  { envVar: "BROKER_RATE_LIMIT_MAX_REQUESTS", category: "broker", description: "Maximum broker requests allowed during one rate-limit window. Tune this for expected automation throughput and local abuse resistance.", defaultValue: "120" },
  { envVar: "BROKER_RATE_LIMIT_WINDOW_MS", category: "broker", description: "Length of each broker rate-limit window in milliseconds. Larger windows smooth bursts while smaller windows react faster.", defaultValue: "60000" },
  { envVar: "BROKER_RATE_LIMIT_BUCKET_TTL_MS", category: "broker", description: "How long idle broker rate-limit buckets remain in memory and persisted state. Increase this for longer abuse tracking or lower it to reduce retained state.", defaultValue: "600000" },
  { envVar: "BROKER_TASK_STATUS_RETENTION_MS", category: "broker", description: "How long completed broker task statuses remain queryable. Increase this for longer restart diagnostics or reduce it to shrink persisted state.", defaultValue: "86400000" },
  { envVar: "BROWSER_ALLOW_DEBUG_FILE_READS", category: "debug", description: "Allows debug file override reads under the Browser Control runtime debug directory only. Keep this disabled unless diagnosing WSL or network discovery behavior.", defaultValue: "0" },
  { envVar: "BROWSER_ALLOW_REMOTE_CDP", category: "browser", description: "Allows launcher scripts to bind Chrome remote debugging beyond localhost. This exposes browser control over the network and should stay disabled by default.", defaultValue: "0" },
  { envVar: "BROWSER_CONTROL_ALLOW_SYSTEM_PROFILE", category: "browser", description: "Allows CLI flows to use the normal system Chrome profile after explicit confirmation. This can expose existing cookies and logins, so prefer isolated profiles.", defaultValue: "0" },
  { envVar: "BROWSER_CONTROL_DOM_SNAPSHOT_FALLBACK", category: "browser", description: "Enables DOM fallback extraction when accessibility snapshots cannot see page content. Disable this only when strict accessibility-only inspection is required.", defaultValue: "true" },
  { envVar: "BROWSER_CONTROL_DOM_SNAPSHOT_TIMEOUT_MS", category: "browser", description: "Timeout in milliseconds for DOM snapshot fallback collection. Lower values fail closed faster while higher values help complex pages.", defaultValue: "2500" },
  { envVar: "BROWSER_DOWNLOAD_REGISTRY_MAX_ENTRIES", category: "browser", description: "Maximum in-memory Playwright download records retained per BrowserActions instance. Lower this to reduce daemon memory use or raise it for longer live download history.", defaultValue: "200" },
  { envVar: "BROWSER_CONTROL_JSON_LOGS", category: "logging", description: "Writes logs as structured JSON records. Enable this for machine ingestion, log pipelines, or deterministic parsing.", defaultValue: "0" },
  { envVar: "BROWSER_CONTROL_JSON_OUTPUT", category: "cli", description: "Suppresses human-oriented logs when CLI JSON output is requested. Use this in scripts that parse stdout as JSON.", defaultValue: "0" },
  { envVar: "BROWSER_CONTROL_MCP_MODE", category: "mcp", description: "Selects the MCP tool surface mode. Use `lite` for fewer tools and lower token cost or `full` for complete IDE integration.", defaultValue: "full" },
  { envVar: "BROWSER_CONTROL_STATE_BACKEND", category: "runtime", description: "Selects the durable state storage backend. Use `sqlite` for normal production behavior and `json` only for compatibility or debugging.", defaultValue: "sqlite" },
  { envVar: "BROWSER_CONTROL_STDIO_MODE", category: "mcp", description: "Suppresses non-protocol output for stdio MCP transport. Enable this when an MCP client requires clean JSON-RPC streams.", defaultValue: "0" },
  { envVar: "BROWSER_DEBUG_HOST", category: "browser", description: "Additional host candidate used for WSL or private Chrome debug endpoint discovery. Set this when the browser debug port is reachable through a known forwarded host." },
  { envVar: "BROWSER_DEBUG_RESOLV_CONF", category: "debug", description: "Debug-only resolv.conf override used during WSL host discovery. It requires BROWSER_ALLOW_DEBUG_FILE_READS=1 and should point inside runtime debug data." },
  { envVar: "BROWSER_DEBUG_ROUTE_TABLE", category: "debug", description: "Debug-only route-table override used during network discovery. It requires BROWSER_ALLOW_DEBUG_FILE_READS=1 and should point inside runtime debug data." },
  { envVar: "BROWSER_ENABLE_WSL_CDP_BRIDGE", category: "browser", description: "Enables the Windows-hosted bridge used by WSL to reach visible Windows Chrome. Disable this when WSL should never spawn or use the bridge.", defaultValue: "true" },
  { envVar: "BROWSER_TELEMETRY_MAX_EVENTS", category: "observability", description: "Maximum number of telemetry events retained in memory. Raise this for longer diagnostics or lower it to bound memory use.", defaultValue: "2000" },
  { envVar: "BROWSERBASE_API_KEY", category: "provider", description: "API key used for Browserbase provider sessions. This is sensitive and is redacted from config output.", sensitive: true },
  { envVar: "BROWSERBASE_PROJECT_ID", category: "provider", description: "Browserbase project identifier used when creating hosted browser sessions. Set this when the Browserbase account has multiple projects." },
  { envVar: "AI_AGENT_COST_PER_TOKEN", category: "ai", description: "Estimated AI-agent cost per token used for local cost tracking and budgeting. Set this when your configured model has different pricing than the default estimate.", defaultValue: "0.0001" },
  { envVar: "CAPTCHA_TIMEOUT_MS", category: "captcha", description: "Maximum time in milliseconds to wait for a CAPTCHA solver response. Increase this for slower providers or reduce it to fail blocked workflows faster.", defaultValue: "120000" },
  { envVar: "CHROME_TAB_LIMIT", category: "daemon", description: "Maximum active Chrome tabs before health checks warn. Use this to detect tab leaks and runaway browser workflows.", defaultValue: "20" },
  { envVar: "ENABLE_STEALTH", category: "stealth", description: "Enables stealth browser context options where supported. Use this only for legitimate testing scenarios that require fingerprint controls.", defaultValue: "false" },
  { envVar: "MEMORY_ALERT_MB", category: "daemon", description: "Memory threshold in megabytes used by health checks. Increase this on large hosts or lower it to catch memory growth earlier.", defaultValue: "1024" },
  { envVar: "PROXY_LIST", category: "proxy", description: "Comma-separated proxy URL list used by proxy-aware workflows. Proxy URLs can contain credentials, so this value is treated as sensitive.", sensitive: true },
  { envVar: "RESUME_POLICY", category: "daemon", description: "Task resume policy used after daemon interruption. Use this to decide whether interrupted work should be abandoned or recovered.", defaultValue: "abandon" },
  { envVar: "STAGEHAND_MODEL", category: "ai", description: "Model override used by Stagehand-backed automation. Set this when Stagehand should use a model different from the main model router." },
  { envVar: "STEALTH_DEVICE_MEMORY", category: "stealth", description: "Navigator deviceMemory value exposed in stealth contexts. Use this only when a test needs a deterministic browser fingerprint." },
  { envVar: "STEALTH_FINGERPRINT_SEED", category: "stealth", description: "Seed used to derive deterministic stealth fingerprint values. This can identify runs and is treated as sensitive.", sensitive: true },
  { envVar: "STEALTH_HARDWARE_CONCURRENCY", category: "stealth", description: "Navigator hardwareConcurrency value exposed in stealth contexts. Use this to keep CPU-core fingerprints stable in controlled tests." },
  { envVar: "STEALTH_LOCALE", category: "stealth", description: "Locale value exposed in stealth contexts. Use this when tests need consistent language and regional formatting." },
  { envVar: "STEALTH_PLATFORM", category: "stealth", description: "Navigator platform value exposed in stealth contexts. Use this when deterministic platform fingerprints are required." },
  { envVar: "STEALTH_TIMEZONE_ID", category: "stealth", description: "Timezone identifier exposed in stealth contexts. Use this when tests need stable timezone behavior independent of host settings." },
  { envVar: "STEALTH_WEBGL_RENDERER", category: "stealth", description: "WebGL renderer string exposed in stealth contexts. Use this only for deterministic fingerprint testing." },
  { envVar: "STEALTH_WEBGL_VENDOR", category: "stealth", description: "WebGL vendor string exposed in stealth contexts. Use this only for deterministic fingerprint testing." },
  { envVar: "TERMINAL_MAX_OUTPUT_BYTES", category: "terminal", description: "Maximum bytes captured from one terminal command. This bounds memory and response size for commands with large output.", defaultValue: "1048576" },
  { envVar: "TERMINAL_MAX_SCROLLBACK_LINES", category: "terminal", description: "Maximum terminal scrollback lines persisted for resume. Increase this for long-running interactive sessions or reduce it to limit stored output.", defaultValue: "10000" },
  { envVar: "TERMINAL_MAX_SERIALIZED_SESSIONS", category: "terminal", description: "Maximum number of terminal sessions retained for resume. Increase this for many concurrent terminals or reduce it to keep startup recovery small.", defaultValue: "50" },
];

const CONFIG_BY_KEY = new Map<ConfigKey, ConfigDefinition>(
  CONFIG_DEFINITIONS.map((definition) => [definition.key, definition]),
);

const DASHBOARD_MUTABLE_CONFIG_KEYS = new Set<ConfigKey>([
  "logLevel",
  "logFile",
  "terminalCols",
  "terminalRows",
  "terminalResumePolicy",
  "terminalAutoResume",
  "browserViewportWidth",
  "browserViewportHeight",
  "browserUserAgent",
]);

export function isDashboardMutableConfigKey(key: string): key is ConfigKey {
  return DASHBOARD_MUTABLE_CONFIG_KEYS.has(key as ConfigKey);
}

export function getDashboardConfigMutationError(key: string): string | null {
  if (isDashboardMutableConfigKey(key)) return null;
  if (!CONFIG_BY_KEY.has(key as ConfigKey)) return `Unknown config key: ${key}`;
  return `Config key "${key}" is not mutable from the dashboard. Use the CLI or environment configuration for high-impact settings.`;
}

function getUserConfigBaseHome(env: NodeJS.ProcessEnv): string {
  const override = env.BROWSER_CONTROL_HOME;
  return override?.trim() || _getDataHome();
}

function getEnvOverride(definition: ConfigDefinition, env: NodeJS.ProcessEnv): { value: string; envVar: string } | null {
  for (const envVar of definition.envVars) {
    const value = env[envVar];
    if (value !== undefined && value.trim() !== "") return { value, envVar };
  }
  return null;
}

function readDefinitionValue(
  definition: ConfigDefinition,
  userConfig: UserConfig,
  env: NodeJS.ProcessEnv,
  strict: boolean,
): { value: ConfigValue; source: ConfigSource; envVar?: string } {
  const defaultValue = definition.defaultValue(env);
  const userValue = userConfig[definition.key];
  let value = defaultValue;
  let source: ConfigSource = "default";

  if (userValue !== undefined) {
    try {
      value = definition.parse(userValue, definition.key);
      definition.validate?.(value, definition.key);
      source = "user";
    } catch (error) {
      if (strict) throw error;
      value = defaultValue;
      source = "default";
    }
  }

  const envOverride = getEnvOverride(definition, env);
  if (envOverride) {
    try {
      value = definition.parse(envOverride.value, definition.key);
      definition.validate?.(value, definition.key);
      return { value, source: "env", envVar: envOverride.envVar };
    } catch (error) {
      if (strict) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${envOverride.envVar}: ${message}`);
      }
    }
  }

  return { value, source };
}

function redactConfigValue(definition: ConfigDefinition, value: ConfigValue): ConfigValue | "[redacted]" {
  if (definition.sensitive && value !== undefined) return "[redacted]";
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redactString(item));
  return value;
}

export function redactConfigEntry(entry: ConfigEntry): ConfigEntry {
  const definition = CONFIG_BY_KEY.get(entry.key);
  if (!definition) return entry;
  return {
    ...entry,
    sensitive: entry.sensitive || definition.sensitive === true,
    envVars: [...entry.envVars],
    value: redactConfigValue(definition, entry.value),
    defaultValue: redactConfigValue(definition, entry.defaultValue),
  };
}

function resolveUserConfigPath(env: NodeJS.ProcessEnv): string {
  return getUserConfigPath(getUserConfigBaseHome(env));
}

export function loadUserConfig(options: { env?: NodeJS.ProcessEnv } = {}): UserConfig {
  const env = options.env ?? process.env;
  const filePath = resolveUserConfigPath(env);
  if (!fs.existsSync(filePath)) return {};

  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`User config must be a JSON object: ${filePath}`);
  }
  const validated = USER_CONFIG_SCHEMA.parse(parsed);
  for (const key of Object.keys(validated)) {
    if (!CONFIG_BY_KEY.has(key as ConfigKey)) {
      throw new Error(`Unknown config key in ${filePath}: ${key}`);
    }
  }
  return validated as UserConfig;
}

export function saveUserConfig(config: UserConfig, options: { env?: NodeJS.ProcessEnv } = {}): string {
  const env = options.env ?? process.env;
  const filePath = resolveUserConfigPath(env);
  const configDir = path.dirname(filePath);
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") {
    fs.chmodSync(configDir, 0o700);
  }
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  if (process.platform !== "win32") {
    fs.chmodSync(tmpPath, 0o600);
  }
  fs.renameSync(tmpPath, filePath);
  if (process.platform !== "win32") {
    fs.chmodSync(filePath, 0o600);
  }
  return filePath;
}

export function validateConfigValue(key: string, value: unknown): ConfigValue {
  const definition = CONFIG_BY_KEY.get(key as ConfigKey);
  if (!definition) throw new Error(`Unknown config key: ${key}`);
  const parsed = definition.parse(value, definition.key);
  definition.validate?.(parsed, definition.key);
  return parsed;
}

export function setUserConfigValue(
  key: string,
  value: unknown,
  options: { env?: NodeJS.ProcessEnv } = {},
): ConfigSetResult {
  const definition = CONFIG_BY_KEY.get(key as ConfigKey);
  if (!definition) throw new Error(`Unknown config key: ${key}`);

  const parsed = validateConfigValue(key, value);
  const env = options.env ?? process.env;
  const current = loadUserConfig({ env });
  current[definition.key] = parsed;
  const configPath = saveUserConfig(current, { env });

  return {
    key: definition.key,
    value: redactConfigValue(definition, parsed),
    source: "user",
    configPath,
  };
}

export function getConfigEntries(options: { env?: NodeJS.ProcessEnv; validate?: boolean } = {}): ConfigEntry[] {
  const env = options.env ?? process.env;
  const userConfig = loadUserConfig({ env });
  const strict = options.validate ?? false;

  return CONFIG_DEFINITIONS.map((definition) => {
    const { value, source } = readDefinitionValue(definition, userConfig, env, strict);
    const defaultValue = definition.defaultValue(env);
    return {
      key: definition.key,
      category: definition.category,
      value: redactConfigValue(definition, value),
      defaultValue: redactConfigValue(definition, defaultValue),
      source,
      sensitive: definition.sensitive === true,
      envVars: [...definition.envVars],
      description: definition.description,
    };
  });
}

function redactEnvValue(definition: { sensitive?: boolean }, value: string | undefined): string | "[redacted]" | undefined {
  if (value === undefined || value === "") return undefined;
  if (definition.sensitive) return "[redacted]";
  return redactString(value);
}

export function getConfigEnvEntries(options: { env?: NodeJS.ProcessEnv } = {}): ConfigEnvEntry[] {
  const env = options.env ?? process.env;
  const entries = new Map<string, ConfigEnvEntry>();

  for (const definition of CONFIG_DEFINITIONS) {
    const defaultValue = definition.defaultValue(env);
    for (const envVar of definition.envVars) {
      const currentValue = env[envVar];
      entries.set(envVar, {
        envVar,
        category: definition.category,
        description: definition.description,
        configKey: definition.key,
        sensitive: definition.sensitive === true,
        currentValue: redactEnvValue(definition, currentValue),
        source: currentValue === undefined || currentValue === "" ? "unset" : "env",
        defaultValue: defaultValue === undefined ? undefined : String(redactConfigValue(definition, defaultValue)),
      });
    }
  }

  for (const definition of ADDITIONAL_CONFIG_ENV_DEFINITIONS) {
    if (entries.has(definition.envVar)) continue;
    const currentValue = env[definition.envVar];
    entries.set(definition.envVar, {
      envVar: definition.envVar,
      category: definition.category,
      description: definition.description,
      sensitive: definition.sensitive === true,
      currentValue: redactEnvValue(definition, currentValue),
      source: currentValue === undefined || currentValue === "" ? "unset" : "env",
      defaultValue: definition.defaultValue,
    });
  }

  return [...entries.values()].sort((a, b) => a.envVar.localeCompare(b.envVar));
}

export function getConfigValue(
  key: string,
  options: { env?: NodeJS.ProcessEnv; validate?: boolean } = {},
): ConfigEntry {
  const entry = getConfigEntries(options).find((item) => item.key === key);
  if (!entry) throw new Error(`Unknown config key: ${key}`);
  return entry;
}

function getRawEffectiveConfig(options: { env: NodeJS.ProcessEnv; validate: boolean }): Record<ConfigKey, ConfigValue> {
  const userConfig = loadUserConfig({ env: options.env });
  const values = {} as Record<ConfigKey, ConfigValue>;
  for (const definition of CONFIG_DEFINITIONS) {
    values[definition.key] = readDefinitionValue(definition, userConfig, options.env, options.validate).value;
  }
  return values;
}

// ── Public Loader ────────────────────────────────────────────────────

export interface LoadConfigOptions {
  /** Skip strict validation (useful for CLI subcommands that don't need the full stack) */
  validate?: boolean;
  /** Override process.env for testing */
  env?: NodeJS.ProcessEnv;
}

/**
 * Load and return the full browser-control configuration.
 *
 * When `validate` is true (default), missing required values for
 * *activated* features produce descriptive errors rather than silent
 * fallbacks.  Optional features (stealth, captcha, proxy, AI) only
 * validate their sub-config when the feature is opted in.
 */
export function loadConfig(options: LoadConfigOptions = {}): BrowserControlConfig {
  const env = options.env ?? process.env;
  const validate = options.validate ?? true;
  const effective = getRawEffectiveConfig({ env, validate });

  const dataHome = ensureDataHomeAtPath(effective.dataHome as string);

  // ── Broker ──────────────────────────────────────────────────────
  const brokerPortRaw = String(effective.brokerPort);
  const brokerPort = effective.brokerPort as number;
  if (validate && (!Number.isFinite(brokerPort) || brokerPort < 1 || brokerPort > 65535)) {
    throw new Error(`BROKER_PORT must be between 1 and 65535, got: ${brokerPortRaw}`);
  }
  const brokerAuthKey =
    (effective.brokerAuthKey as string | undefined) ??
    readBrokerAuthKeyFile(env);
  const brokerAllowedOrigins = effective.brokerAllowedOrigins as string[];
  const brokerAllowedDomains = effective.brokerAllowedDomains as string[];

  // ── Chrome ──────────────────────────────────────────────────────
  const chromeDebugPort = effective.chromeDebugPort as number;
  const chromeBindAddress = effective.chromeBindAddress as string;
  const chromePath = effective.chromePath as string | undefined;
  const browserDebugUrl = effective.browserDebugUrl as string | undefined;
  const browserMode = effective.browserMode as "managed" | "attach";
  const browserAutoLaunch = effective.browserAutoLaunch as boolean;
  const browserLaunchProfile = effective.browserLaunchProfile as "system" | "isolated";
  const browserUserDataDir = effective.browserUserDataDir as string | undefined;
  const browserViewportWidth = effective.browserViewportWidth as number;
  const browserViewportHeight = effective.browserViewportHeight as number;

  // ── Stealth ─────────────────────────────────────────────────────
  const stealthEnabled = effective.stealthEnabled as boolean;
  const stealthLocale = effective.stealthLocale as string | undefined;
  const stealthTimezoneId = effective.stealthTimezoneId as string | undefined;
  const stealthFingerprintSeed = effective.stealthFingerprintSeed as string | undefined;
  const stealthWebglVendor = effective.stealthWebglVendor as string | undefined;
  const stealthWebglRenderer = effective.stealthWebglRenderer as string | undefined;
  const stealthPlatform = effective.stealthPlatform as string | undefined;
  const stealthHardwareConcurrency = effective.stealthHardwareConcurrency as number | undefined;
  const stealthDeviceMemory = effective.stealthDeviceMemory as number | undefined;
  const browserUserAgent = effective.browserUserAgent as string | undefined;

  // ── Proxy ──────────────────────────────────────────────────────
  const proxyList = effective.proxyList as string[];

  // ── CAPTCHA ────────────────────────────────────────────────────
  const captchaProvider = effective.captchaProvider as string | undefined;
  const captchaApiKey = effective.captchaApiKey as string | undefined;
  const captchaTimeoutMs = effective.captchaTimeoutMs as number;

  if (validate && captchaProvider && !captchaApiKey) {
    throw new Error("CAPTCHA_PROVIDER is set but CAPTCHA_API_KEY is missing.");
  }

  // ── AI / OpenRouter ────────────────────────────────────────────
  const modelProvider = effective.modelProvider as "openrouter" | "ollama" | "openai-compatible";
  const modelEndpoint = effective.modelEndpoint as string | undefined;
  const modelApiKey = effective.modelApiKey as string | undefined;
  const modelName = effective.modelName as string | undefined;
  const openrouterApiKey = effective.openrouterApiKey as string | undefined;
  const openrouterModel = effective.openrouterModel as string;
  const openrouterBaseUrl = effective.openrouterBaseUrl as string;
  const aiAgentCostPerToken = effective.aiAgentCostPerToken as number;
  const stagehandModel = effective.stagehandModel as string;

  // ── Daemon ──────────────────────────────────────────────────────
  const resumePolicy = effective.resumePolicy as "resume" | "reschedule" | "abandon";
  const memoryAlertMb = effective.memoryAlertMb as number;
  const chromeTabLimit = effective.chromeTabLimit as number;
  const daemonVisible = effective.daemonVisible as boolean;

  // ── Logging ────────────────────────────────────────────────────
  const logLevel = effective.logLevel as string;
  const logFile = effective.logFile as boolean;

  // ── Policy ─────────────────────────────────────────────────────
  const policyProfile = effective.policyProfile as string;
  const validProfiles = ["safe", "balanced", "trusted"];
  if (validate && !validProfiles.includes(policyProfile)) {
    throw new Error(`POLICY_PROFILE must be one of: ${validProfiles.join(", ")}, got: ${policyProfile}`);
  }

  // ── Provider ─────────────────────────────────────────────────────
  const browserlessEndpoint = effective.browserlessEndpoint as string | undefined;
  const browserlessApiKey = effective.browserlessApiKey as string | undefined;

  // ── Terminal (Section 12 + 13) ────────────────────────────────────
  const terminalShell = effective.terminalShell as string | undefined;
  const terminalCols = effective.terminalCols as number;
  const terminalRows = effective.terminalRows as number;
  const terminalMaxOutputBytes = effective.terminalMaxOutputBytes as number;
  const terminalMaxScrollbackLines = effective.terminalMaxScrollbackLines as number;
  const terminalMaxSerializedSessions = effective.terminalMaxSerializedSessions as number;
  const terminalResumePolicy = effective.terminalResumePolicy as string;
  const validTerminalResumePolicies = ["resume", "metadata_only", "abandon"];
  if (validate && !validTerminalResumePolicies.includes(terminalResumePolicy)) {
    throw new Error(`TERMINAL_RESUME_POLICY must be one of: ${validTerminalResumePolicies.join(", ")}, got: ${terminalResumePolicy}`);
  }
  const terminalAutoResume = effective.terminalAutoResume as boolean;

  return {
    dataHome,

    brokerPort,
    brokerAuthKey,
    brokerAllowedOrigins,
    brokerAllowedDomains,

    chromeDebugPort,
    chromeBindAddress,
    chromePath,
    browserDebugUrl,
    browserMode,
    browserAutoLaunch,
    browserLaunchProfile,
    browserUserDataDir,
    browserViewportWidth,
    browserViewportHeight,

    stealthEnabled,
    stealthLocale,
    stealthTimezoneId,
    stealthFingerprintSeed,
    stealthWebglVendor,
    stealthWebglRenderer,
    stealthPlatform,
    stealthHardwareConcurrency,
    stealthDeviceMemory,
    browserUserAgent,

    proxyList,

    captchaProvider,
    captchaApiKey,
    captchaTimeoutMs,

    modelProvider,
    modelEndpoint,
    modelApiKey,
    modelName,
    openrouterApiKey,
    openrouterModel,
    openrouterBaseUrl,
    aiAgentCostPerToken,
    stagehandModel,

    resumePolicy,
    memoryAlertMb,
    chromeTabLimit,
    daemonVisible,

    logLevel,
    logFile,

    policyProfile,

    browserlessEndpoint,
    browserlessApiKey,

    terminalShell,
    terminalCols,
    terminalRows,
    terminalMaxOutputBytes,
    terminalMaxScrollbackLines,
    terminalMaxSerializedSessions,
    terminalResumePolicy: terminalResumePolicy as "resume" | "metadata_only" | "abandon",
    terminalAutoResume,
  };
}
