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

import { getDataHome as _getDataHome, ensureDataHomeAtPath } from "./paths";

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
  /** Chrome debug bind address (default: 0.0.0.0) */
  chromeBindAddress: string;
  /** Explicit Chrome binary path (optional) */
  chromePath: string | undefined;
  /** Explicit CDP URL override (optional) */
  browserDebugUrl: string | undefined;

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

  const dataHome = ensureDataHomeAtPath(getDataHome(env));

  // ── Broker ──────────────────────────────────────────────────────
  const brokerPortRaw = env.BROKER_PORT?.trim();
  const brokerPort = brokerPortRaw ? Number(brokerPortRaw) : 7788;
  if (validate && (!Number.isFinite(brokerPort) || brokerPort < 1 || brokerPort > 65535)) {
    throw new Error(`BROKER_PORT must be between 1 and 65535, got: ${brokerPortRaw}`);
  }
  const brokerAuthKey = normalizeOptionalString(env.BROKER_API_KEY) ?? normalizeOptionalString(env.BROKER_SECRET);
  const brokerAllowedOrigins = splitCsv(env.BROKER_ALLOWED_ORIGINS);
  const brokerAllowedDomains = splitCsv(env.BROKER_ALLOWED_DOMAINS);

  // ── Chrome ──────────────────────────────────────────────────────
  const chromeDebugPort = parsePositiveInt(env.BROWSER_DEBUG_PORT, 9222);
  const chromeBindAddress = normalizeOptionalString(env.BROWSER_BIND_ADDRESS) ?? "0.0.0.0";
  const chromePath = normalizeOptionalString(env.BROWSER_CHROME_PATH);
  const browserDebugUrl = normalizeOptionalString(env.BROWSER_DEBUG_URL);

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
  const browserUserAgent = normalizeOptionalString(env.BROWSER_USER_AGENT);

  // ── Proxy ──────────────────────────────────────────────────────
  const proxyList = splitCsv(env.PROXY_LIST);

  // ── CAPTCHA ────────────────────────────────────────────────────
  const captchaProvider = normalizeOptionalString(env.CAPTCHA_PROVIDER);
  const captchaApiKey = normalizeOptionalString(env.CAPTCHA_API_KEY);
  const captchaTimeoutMs = parsePositiveInt(env.CAPTCHA_TIMEOUT_MS, 120_000);

  if (validate && captchaProvider && !captchaApiKey) {
    throw new Error("CAPTCHA_PROVIDER is set but CAPTCHA_API_KEY is missing.");
  }

  // ── AI / OpenRouter ────────────────────────────────────────────
  const openrouterApiKey = normalizeOptionalString(env.OPENROUTER_API_KEY);
  const openrouterModel = normalizeOptionalString(env.OPENROUTER_MODEL) ?? normalizeOptionalString(env.AI_AGENT_MODEL) ?? "openai/gpt-4.1-mini";
  const openrouterBaseUrl = normalizeOptionalString(env.OPENROUTER_BASE_URL) ?? "https://openrouter.ai/api/v1";
  const aiAgentCostPerToken = parseFloat(env.AI_AGENT_COST_PER_TOKEN, 0.0001);
  // Stagehand has its own model preference: explicit STAGEHAND_MODEL > OPENROUTER_MODEL > free gemini default
  const stagehandModel = normalizeOptionalString(env.STAGEHAND_MODEL)
    ?? normalizeOptionalString(env.OPENROUTER_MODEL)
    ?? "google/gemini-2.5-flash-preview:free";

  // ── Daemon ──────────────────────────────────────────────────────
  const resumePolicy = parseResumePolicy(env.RESUME_POLICY);
  const memoryAlertMb = parsePositiveInt(env.MEMORY_ALERT_MB, 1024);
  const chromeTabLimit = parsePositiveInt(env.CHROME_TAB_LIMIT, 20);
  const daemonVisible = parseBoolean(env.DAEMON_VISIBLE, false);

  // ── Logging ────────────────────────────────────────────────────
  const logLevel = normalizeOptionalString(env.LOG_LEVEL) ?? "info";
  const logFile = parseBoolean(env.LOG_FILE, false);

  // ── Policy ─────────────────────────────────────────────────────
  const policyProfile = normalizeOptionalString(env.POLICY_PROFILE) ?? "balanced";
  const validProfiles = ["safe", "balanced", "trusted"];
  if (validate && !validProfiles.includes(policyProfile)) {
    throw new Error(`POLICY_PROFILE must be one of: ${validProfiles.join(", ")}, got: ${policyProfile}`);
  }

  // ── Terminal (Section 12 + 13) ────────────────────────────────────
  const terminalShell = normalizeOptionalString(env.TERMINAL_SHELL);
  const terminalCols = parsePositiveInt(env.TERMINAL_COLS, 80);
  const terminalRows = parsePositiveInt(env.TERMINAL_ROWS, 24);
  const terminalMaxOutputBytes = parsePositiveInt(env.TERMINAL_MAX_OUTPUT_BYTES, 1024 * 1024);
  const terminalMaxScrollbackLines = parsePositiveInt(env.TERMINAL_MAX_SCROLLBACK_LINES, 10_000);
  const terminalMaxSerializedSessions = parsePositiveInt(env.TERMINAL_MAX_SERIALIZED_SESSIONS, 50);
  const terminalResumePolicy = normalizeOptionalString(env.TERMINAL_RESUME_POLICY) ?? "resume";
  const validTerminalResumePolicies = ["resume", "metadata_only", "abandon"];
  if (validate && !validTerminalResumePolicies.includes(terminalResumePolicy)) {
    throw new Error(`TERMINAL_RESUME_POLICY must be one of: ${validTerminalResumePolicies.join(", ")}, got: ${terminalResumePolicy}`);
  }
  const terminalAutoResume = parseBoolean(env.TERMINAL_AUTO_RESUME, true);

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
