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
  /** Browser ownership mode (default: managed) */
  browserMode: "managed" | "attach";
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

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

function splitCsv(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function parseFloat(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseResumePolicy(value: string | undefined): "resume" | "reschedule" | "abandon" {
  const lowered = value?.trim().toLowerCase();
  if (lowered === "resume" || lowered === "reschedule") return lowered;
  return "abandon";
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
  | "ai";

export type ConfigKey =
  | "dataHome"
  | "brokerPort"
  | "chromeDebugPort"
  | "chromeBindAddress"
  | "chromePath"
  | "browserDebugUrl"
  | "browserMode"
  | "browserViewportWidth"
  | "browserViewportHeight"
  | "browserUserAgent"
  | "policyProfile"
  | "daemonVisible"
  | "logLevel"
  | "logFile"
  | "terminalShell"
  | "terminalCols"
  | "terminalRows"
  | "terminalResumePolicy"
  | "terminalAutoResume"
  | "browserlessEndpoint"
  | "browserlessApiKey"
  | "captchaProvider"
  | "captchaApiKey"
  | "openrouterModel"
  | "openrouterBaseUrl"
  | "openrouterApiKey";

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
  { key: "dataHome", category: "runtime", envVars: ["BROWSER_CONTROL_HOME"], description: "Browser Control runtime data home.", defaultValue: (env) => getDataHome(env), parse: requiredString },
  { key: "brokerPort", category: "broker", envVars: ["BROKER_PORT"], description: "Broker HTTP API port.", defaultValue: () => 7788, parse: integerValue, validate: ensurePort },
  { key: "chromeDebugPort", category: "browser", envVars: ["BROWSER_DEBUG_PORT"], description: "Chrome remote debugging port.", defaultValue: () => 9222, parse: integerValue, validate: ensurePort },
  { key: "chromeBindAddress", category: "browser", envVars: ["BROWSER_BIND_ADDRESS"], description: "Chrome debug bind address.", defaultValue: () => "127.0.0.1", parse: requiredString },
  { key: "chromePath", category: "browser", envVars: ["BROWSER_CHROME_PATH"], description: "Explicit Chrome executable path.", defaultValue: () => undefined, parse: optionalString },
  { key: "browserDebugUrl", category: "browser", envVars: ["BROWSER_DEBUG_URL"], description: "Explicit CDP endpoint URL override.", defaultValue: () => undefined, parse: optionalString, validate: ensureUrl },
  { key: "browserMode", category: "browser", envVars: ["BROWSER_MODE"], description: "Browser ownership mode.", defaultValue: () => "managed", parse: requiredString, validate: ensureAllowed(["managed", "attach"]) },
  { key: "browserViewportWidth", category: "browser", envVars: ["BROWSER_VIEWPORT_WIDTH"], description: "Default viewport width for automation-owned browser contexts.", defaultValue: () => 1365, parse: integerValue, validate: ensurePositiveInt },
  { key: "browserViewportHeight", category: "browser", envVars: ["BROWSER_VIEWPORT_HEIGHT"], description: "Default viewport height for automation-owned browser contexts.", defaultValue: () => 768, parse: integerValue, validate: ensurePositiveInt },
  { key: "browserUserAgent", category: "browser", envVars: ["BROWSER_USER_AGENT"], description: "User agent for automation-owned browser contexts.", defaultValue: () => undefined, parse: optionalString },
  { key: "policyProfile", category: "policy", envVars: ["POLICY_PROFILE"], description: "Default policy profile.", defaultValue: () => "balanced", parse: requiredString, validate: ensureAllowed(["safe", "balanced", "trusted"]) },
  { key: "daemonVisible", category: "daemon", envVars: ["DAEMON_VISIBLE"], description: "Whether daemon launches use a visible console window on Windows.", defaultValue: () => false, parse: booleanValue },
  { key: "logLevel", category: "logging", envVars: ["LOG_LEVEL"], description: "Minimum log level.", defaultValue: () => "info", parse: requiredString, validate: ensureAllowed(["debug", "info", "warn", "error", "critical"]) },
  { key: "logFile", category: "logging", envVars: ["LOG_FILE"], description: "Whether logs are also written to files.", defaultValue: () => false, parse: booleanValue },
  { key: "terminalShell", category: "terminal", envVars: ["TERMINAL_SHELL"], description: "Default shell for terminal sessions.", defaultValue: () => undefined, parse: optionalString },
  { key: "terminalCols", category: "terminal", envVars: ["TERMINAL_COLS"], description: "Default terminal column count.", defaultValue: () => 80, parse: integerValue, validate: ensurePositiveInt },
  { key: "terminalRows", category: "terminal", envVars: ["TERMINAL_ROWS"], description: "Default terminal row count.", defaultValue: () => 24, parse: integerValue, validate: ensurePositiveInt },
  { key: "terminalResumePolicy", category: "terminal", envVars: ["TERMINAL_RESUME_POLICY"], description: "Terminal recovery policy on daemon startup.", defaultValue: () => "resume", parse: requiredString, validate: ensureAllowed(["resume", "metadata_only", "abandon"]) },
  { key: "terminalAutoResume", category: "terminal", envVars: ["TERMINAL_AUTO_RESUME"], description: "Whether terminal sessions auto-resume on daemon startup.", defaultValue: () => true, parse: booleanValue },
  { key: "browserlessEndpoint", category: "provider", envVars: ["BROWSERLESS_ENDPOINT"], description: "Browserless endpoint.", defaultValue: () => undefined, parse: optionalString, validate: ensureUrl },
  { key: "browserlessApiKey", category: "provider", envVars: ["BROWSERLESS_API_KEY"], description: "Browserless API key.", defaultValue: () => undefined, parse: optionalString, sensitive: true },
  {
    key: "captchaProvider",
    category: "captcha",
    envVars: ["CAPTCHA_PROVIDER"],
    description: "CAPTCHA provider.",
    defaultValue: () => undefined,
    parse: optionalString,
    validate: (value, key) => {
      if (value !== undefined) ensureAllowed(["2captcha", "anticaptcha", "capsolver"])(value, key);
    },
  },
  { key: "captchaApiKey", category: "captcha", envVars: ["CAPTCHA_API_KEY"], description: "CAPTCHA provider API key.", defaultValue: () => undefined, parse: optionalString, sensitive: true },
  { key: "openrouterModel", category: "ai", envVars: ["OPENROUTER_MODEL", "AI_AGENT_MODEL"], description: "OpenRouter model for AI agent features.", defaultValue: () => "openai/gpt-4.1-mini", parse: requiredString },
  { key: "openrouterBaseUrl", category: "ai", envVars: ["OPENROUTER_BASE_URL"], description: "OpenRouter API base URL.", defaultValue: () => "https://openrouter.ai/api/v1", parse: requiredString, validate: ensureUrl },
  { key: "openrouterApiKey", category: "ai", envVars: ["OPENROUTER_API_KEY"], description: "OpenRouter API key.", defaultValue: () => undefined, parse: optionalString, sensitive: true },
];

const CONFIG_BY_KEY = new Map<ConfigKey, ConfigDefinition>(
  CONFIG_DEFINITIONS.map((definition) => [definition.key, definition]),
);

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
  return parsed as UserConfig;
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
  const brokerAuthKey = normalizeOptionalString(env.BROKER_API_KEY) ?? normalizeOptionalString(env.BROKER_SECRET);
  const brokerAllowedOrigins = splitCsv(env.BROKER_ALLOWED_ORIGINS);
  const brokerAllowedDomains = splitCsv(env.BROKER_ALLOWED_DOMAINS);

  // ── Chrome ──────────────────────────────────────────────────────
  const chromeDebugPort = effective.chromeDebugPort as number;
  const chromeBindAddress = effective.chromeBindAddress as string;
  const chromePath = effective.chromePath as string | undefined;
  const browserDebugUrl = effective.browserDebugUrl as string | undefined;
  const browserMode = effective.browserMode as "managed" | "attach";
  const browserViewportWidth = effective.browserViewportWidth as number;
  const browserViewportHeight = effective.browserViewportHeight as number;

  // ── Stealth ─────────────────────────────────────────────────────
  const stealthEnabled = parseBoolean(env.ENABLE_STEALTH, false);
  const stealthLocale = normalizeOptionalString(env.STEALTH_LOCALE);
  const stealthTimezoneId = normalizeOptionalString(env.STEALTH_TIMEZONE_ID);
  const stealthFingerprintSeed = normalizeOptionalString(env.STEALTH_FINGERPRINT_SEED);
  const stealthWebglVendor = normalizeOptionalString(env.STEALTH_WEBGL_VENDOR);
  const stealthWebglRenderer = normalizeOptionalString(env.STEALTH_WEBGL_RENDERER);
  const stealthPlatform = normalizeOptionalString(env.STEALTH_PLATFORM);
  const stealthHardwareConcurrency = env.STEALTH_HARDWARE_CONCURRENCY
    ? parsePositiveInt(env.STEALTH_HARDWARE_CONCURRENCY, 8)
    : undefined;
  const stealthDeviceMemory = env.STEALTH_DEVICE_MEMORY
    ? parsePositiveInt(env.STEALTH_DEVICE_MEMORY, 8)
    : undefined;
  const browserUserAgent = effective.browserUserAgent as string | undefined;

  // ── Proxy ──────────────────────────────────────────────────────
  const proxyList = splitCsv(env.PROXY_LIST);

  // ── CAPTCHA ────────────────────────────────────────────────────
  const captchaProvider = effective.captchaProvider as string | undefined;
  const captchaApiKey = effective.captchaApiKey as string | undefined;
  const captchaTimeoutMs = parsePositiveInt(env.CAPTCHA_TIMEOUT_MS, 120_000);

  if (validate && captchaProvider && !captchaApiKey) {
    throw new Error("CAPTCHA_PROVIDER is set but CAPTCHA_API_KEY is missing.");
  }

  // ── AI / OpenRouter ────────────────────────────────────────────
  const openrouterApiKey = effective.openrouterApiKey as string | undefined;
  const openrouterModel = effective.openrouterModel as string;
  const openrouterBaseUrl = effective.openrouterBaseUrl as string;
  const aiAgentCostPerToken = parseFloat(env.AI_AGENT_COST_PER_TOKEN, 0.0001);
  // Stagehand has its own model preference: explicit STAGEHAND_MODEL > OPENROUTER_MODEL > free gemini default
  const stagehandModel = normalizeOptionalString(env.STAGEHAND_MODEL)
    ?? normalizeOptionalString(env.OPENROUTER_MODEL)
    ?? "google/gemini-2.5-flash-preview:free";

  // ── Daemon ──────────────────────────────────────────────────────
  const resumePolicy = parseResumePolicy(env.RESUME_POLICY);
  const memoryAlertMb = parsePositiveInt(env.MEMORY_ALERT_MB, 1024);
  const chromeTabLimit = parsePositiveInt(env.CHROME_TAB_LIMIT, 20);
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
  const terminalMaxOutputBytes = parsePositiveInt(env.TERMINAL_MAX_OUTPUT_BYTES, 1024 * 1024);
  const terminalMaxScrollbackLines = parsePositiveInt(env.TERMINAL_MAX_SCROLLBACK_LINES, 10_000);
  const terminalMaxSerializedSessions = parsePositiveInt(env.TERMINAL_MAX_SERIALIZED_SESSIONS, 50);
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
