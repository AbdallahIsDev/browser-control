import fs from "node:fs";
import path from "node:path";
import { isDebugPortReady } from "./browser_core";
import { loadProxyConfigs } from "./proxy_manager";
import type { MemoryStore } from "./memory_store";
import type { HealthStatus, HealthCheckDetail } from "./observability/types";

export interface HealthReport {
  overall: "healthy" | "degraded" | "unhealthy";
  checks: Array<{
    name: string;
    status: "pass" | "fail" | "warn";
    details?: string;
  }>;
  timestamp: string;
}

type HealthCheckResult = {
  status: "pass" | "fail" | "warn";
  details?: string;
};

type CriticalRule = boolean | ((context: { env: NodeJS.ProcessEnv }) => boolean);

interface RegisteredCheck {
  name: string;
  critical: CriticalRule;
  run: () => Promise<HealthCheckResult>;
}

interface HealthCheckOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  port?: number;
  memoryStore?: MemoryStore;
  checks?: RegisteredCheck[];
  /** Optional: check browser tab/session integrity (requires browser instance) */
  browserCheck?: () => Promise<{ connected: boolean; tabCount: number; details?: string }>;
  /** Optional: check terminal runtime state */
  terminalCheck?: () => Promise<{ alive: boolean; sessionCount: number; details?: string }>;
  /** Optional: check skill registry status */
  skillCheck?: () => Promise<{ healthy: boolean; loaded: number; details?: string }>;
  /** Optional: check config/policy validity */
  policyCheck?: () => Promise<{ valid: boolean; details?: string }>;
}

function evaluateCritical(rule: CriticalRule, env: NodeJS.ProcessEnv): boolean {
  return typeof rule === "function" ? rule({ env }) : rule;
}

export class HealthCheck {
  private readonly env: NodeJS.ProcessEnv;

  private readonly cwd: string;

  private readonly port?: number;

  private readonly memoryStore?: MemoryStore;

  private readonly checks: RegisteredCheck[] = [];

  constructor(options: HealthCheckOptions = {}) {
    this.env = options.env ?? process.env;
    this.cwd = options.cwd ?? process.cwd();
    this.port = options.port;
    this.memoryStore = options.memoryStore;

    for (const check of options.checks ?? []) {
      this.checks.push(check);
    }
  }

  registerCheck(
    name: string,
    fn: () => Promise<{ status: "pass" | "fail" | "warn"; details?: string }>,
  ): void {
    this.checks.push({
      name,
      critical: false,
      run: fn,
    });
  }

  async checkCdpConnection(port = this.port ?? 9222): Promise<HealthCheckResult> {
    const ready = await isDebugPortReady(port);
    return ready
      ? { status: "pass", details: `CDP port ${port} is reachable.` }
      : { status: "fail", details: `CDP port ${port} is not reachable.` };
  }

  async checkMemoryStore(): Promise<HealthCheckResult> {
    if (!this.memoryStore) {
      return { status: "warn", details: "No MemoryStore instance configured." };
    }

    // Clean up stale health check keys from previous daemon runs.
    // If the daemon crashed or was killed, health_check:memory:* keys
    // may persist. These stale keys cause the leftover check below
    // to falsely report failure, blocking daemon startup even though
    // the MemoryStore itself is perfectly functional.
    try {
      const staleKeys = this.memoryStore.keys("health_check:memory:");
      for (const k of staleKeys) {
        this.memoryStore.delete(k);
      }
    } catch {
      // Best-effort cleanup — don't block the actual check
    }

    const key = `health_check:memory:${Date.now()}`;
    try {
      this.memoryStore.set(key, { ok: true });
      const value = this.memoryStore.get<{ ok: boolean }>(key);
      this.memoryStore.delete(key);
      // Only check for OUR key as leftover — stale keys from previous
      // runs are already cleaned up above.
      const leftovers = this.memoryStore.keys("health_check:");
      if (!value?.ok || leftovers.length > 0) {
        return { status: "fail", details: "MemoryStore read/write/delete verification failed." };
      }

      return { status: "pass", details: "MemoryStore read/write/delete succeeded." };
    } catch (error: unknown) {
      return {
        status: "fail",
        details: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async checkProxyPool(): Promise<HealthCheckResult> {
    const filePath = path.join(this.cwd, "proxies.json");
    const hasConfig = Boolean(this.env.PROXY_LIST?.trim()) || fs.existsSync(filePath);
    if (!hasConfig) {
      return { status: "pass", details: "No proxy configuration present." };
    }

    const proxies = loadProxyConfigs({ cwd: this.cwd, env: this.env });
    const active = proxies.filter((proxy) => proxy.status === "active").length;
    return active > 0
      ? { status: "pass", details: `${active} active proxy entries found.` }
      : { status: "fail", details: "Proxy configuration exists but no active proxies are available." };
  }

  async checkCaptchaSolver(): Promise<HealthCheckResult> {
    if (!this.env.CAPTCHA_PROVIDER?.trim()) {
      return { status: "pass", details: "CAPTCHA provider not configured." };
    }

    return this.env.CAPTCHA_API_KEY?.trim()
      ? { status: "pass", details: "CAPTCHA API key is configured." }
      : { status: "warn", details: "CAPTCHA provider is configured but CAPTCHA_API_KEY is missing." };
  }

  async checkOpenRouter(): Promise<HealthCheckResult> {
    const aiEnabled = Boolean(
      this.env.AI_AGENT_MODEL?.trim()
      || this.env.OPENROUTER_MODEL?.trim()
      || this.env.OPENROUTER_BASE_URL?.trim(),
    );

    if (!aiEnabled) {
      return { status: "pass", details: "OpenRouter-dependent features are not explicitly enabled." };
    }

    return this.env.OPENROUTER_API_KEY?.trim()
      ? { status: "pass", details: "OPENROUTER_API_KEY is configured." }
      : { status: "warn", details: "AI/OpenRouter features are configured but OPENROUTER_API_KEY is missing." };
  }

  async checkDiskSpace(minBytes = 100 * 1024 * 1024): Promise<HealthCheckResult> {
    try {
      const stats = fs.statfsSync(this.cwd);
      const availableBytes = stats.bavail * stats.bsize;
      if (availableBytes < minBytes) {
        return {
          status: "warn",
          details: `Available disk space ${availableBytes} bytes is below threshold ${minBytes} bytes.`,
        };
      }

      return { status: "pass", details: `${availableBytes} bytes available.` };
    } catch (error: unknown) {
      return {
        status: "warn",
        details: `Disk space check unavailable: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async checkSkills(skillNames: string[] = []): Promise<HealthCheckResult> {
    return skillNames.length > 0
      ? { status: "warn", details: `Skill checks are placeholders for: ${skillNames.join(", ")}` }
      : { status: "warn", details: "Skill checks are placeholders." };
  }

  // ── Section 10: Extended Health Checks ───────────────────────────────

  async checkBrowserState(): Promise<HealthCheckResult> {
    try {
      const { getChromeDebugPath } = await import("./paths");
      const debugPath = getChromeDebugPath();
      if (!fs.existsSync(debugPath)) {
        return { status: "warn", details: "No Chrome debug metadata found. Chrome may not be running." };
      }

      const metadata = JSON.parse(fs.readFileSync(debugPath, "utf8")) as { port?: number; wslBridge?: boolean };
      const port = metadata.port ?? 9222;

      const ready = await isDebugPortReady(port);
      if (!ready) {
        return { status: "warn", details: `Chrome debug port ${port} is not reachable.` };
      }

      return { status: "pass", details: `Chrome is reachable on port ${port}.` };
    } catch (error: unknown) {
      return {
        status: "warn",
        details: `Browser state check failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async checkDataDirectories(): Promise<HealthCheckResult> {
    try {
      const { ensureDataHome } = await import("./paths");
      const home = ensureDataHome();

      const dirs = [
        path.join(home, "reports"),
        path.join(home, "logs"),
        path.join(home, ".interop"),
        path.join(home, "skills"),
      ];

      for (const dir of dirs) {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        // Test writability
        const testFile = path.join(dir, ".health-check-write-test");
        fs.writeFileSync(testFile, "ok");
        fs.unlinkSync(testFile);
      }

      return { status: "pass", details: "All data directories are writable." };
    } catch (error: unknown) {
      return {
        status: "fail",
        details: `Data directory check failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async checkConfigValidity(): Promise<HealthCheckResult> {
    try {
      const { loadConfig } = await import("./config");
      loadConfig({ validate: true });
      return { status: "pass", details: "Configuration is valid." };
    } catch (error: unknown) {
      return {
        status: "warn",
        details: `Configuration validation failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async checkDaemonBroker(options: { brokerUrl?: string } = {}): Promise<HealthCheckResult> {
    const { probeDaemonHealth } = await import("./session_manager");
    try {
      const result = await probeDaemonHealth();
      if (result.running) {
        return { status: "pass", details: `Daemon broker is reachable at ${result.brokerUrl}.` };
      }
      return { status: "warn", details: "Daemon broker is not reachable." };
    } catch (error: unknown) {
      return {
        status: "warn",
        details: `Daemon broker check failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async checkSkillRegistry(options: { skillCheck?: HealthCheckOptions["skillCheck"] } = {}): Promise<HealthCheckResult> {
    if (options.skillCheck) {
      try {
        const result = await options.skillCheck();
        return result.healthy
          ? { status: "pass", details: `${result.loaded} skill(s) loaded. ${result.details ?? ""}` }
          : { status: "warn", details: result.details ?? "Skill registry is unhealthy." };
      } catch (error: unknown) {
        return {
          status: "warn",
          details: `Skill registry check failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }
    return { status: "pass", details: "No skill registry check configured." };
  }

  async checkSystemMemory(): Promise<HealthCheckResult> {
    try {
      const memUsage = process.memoryUsage();
      const heapUsedMb = Math.round(memUsage.heapUsed / (1024 * 1024));
      const rssMb = Math.round(memUsage.rss / (1024 * 1024));

      const thresholdMb = Number(this.env.MEMORY_ALERT_MB) || 1024;
      if (heapUsedMb > thresholdMb) {
        return {
          status: "warn",
          details: `Heap usage ${heapUsedMb}MB exceeds threshold ${thresholdMb}MB (RSS: ${rssMb}MB).`,
        };
      }

      return { status: "pass", details: `Heap: ${heapUsedMb}MB, RSS: ${rssMb}MB.` };
    } catch (error: unknown) {
      return {
        status: "warn",
        details: `Memory check failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async runAll(): Promise<HealthReport> {
    return this.runChecks(this.getChecksToRun());
  }

  async runExtended(): Promise<HealthReport> {
    return this.runChecks([
      ...this.getChecksToRun(),
      { name: "browserState", critical: false, run: async () => this.checkBrowserState() },
      { name: "dataDirectories", critical: true, run: async () => this.checkDataDirectories() },
      { name: "configValidity", critical: false, run: async () => this.checkConfigValidity() },
      { name: "daemonBroker", critical: false, run: async () => this.checkDaemonBroker() },
      { name: "systemMemory", critical: false, run: async () => this.checkSystemMemory() },
    ]);
  }

  private async runChecks(checksToRun: RegisteredCheck[]): Promise<HealthReport> {
    const checkResults: HealthReport["checks"] = [];
    let criticalFailure = false;
    let hasWarningOrNonCriticalFailure = false;

    for (const check of checksToRun) {
      const result = await check.run();
      checkResults.push({
        name: check.name,
        status: result.status,
        ...(result.details ? { details: result.details } : {}),
      });

      if (result.status === "fail" && evaluateCritical(check.critical, this.env)) {
        criticalFailure = true;
      } else if (result.status !== "pass") {
        hasWarningOrNonCriticalFailure = true;
      }
    }

    return {
      overall: criticalFailure ? "unhealthy" : hasWarningOrNonCriticalFailure ? "degraded" : "healthy",
      checks: checkResults,
      timestamp: new Date().toISOString(),
    };
  }

  async runCritical(): Promise<boolean> {
    const checksToRun = this.getChecksToRun();
    for (const check of checksToRun) {
      if (!evaluateCritical(check.critical, this.env)) {
        continue;
      }

      const result = await check.run();
      // Only "fail" blocks startup. "warn" is advisory — e.g., disk space
      // check may return "warn" on platforms where statfs is unavailable,
      // which should not prevent the daemon from starting.
      if (result.status === "fail") {
        return false;
      }
    }

    return true;
  }

  private getChecksToRun(): RegisteredCheck[] {
    if (this.checks.length > 0) {
      return [...this.checks];
    }

    return [
      // CDP connection is non-critical: the daemon can start without Chrome.
      // Terminal and FS features work independently of Chrome. The Chrome
      // watchdog in daemon.ts handles degraded state when Chrome is absent.
      {
        name: "cdpConnection",
        critical: false,
        run: async () => this.checkCdpConnection(),
      },
      {
        name: "memoryStore",
        critical: true,
        run: async () => this.checkMemoryStore(),
      },
      {
        name: "proxyPool",
        critical: ({ env }) => Boolean(env.PROXY_LIST?.trim() || fs.existsSync(path.join(this.cwd, "proxies.json"))),
        run: async () => this.checkProxyPool(),
      },
      {
        name: "captchaSolver",
        critical: ({ env }) => Boolean(env.CAPTCHA_PROVIDER?.trim()),
        run: async () => this.checkCaptchaSolver(),
      },
      {
        name: "openRouter",
        critical: ({ env }) => Boolean(env.AI_AGENT_MODEL?.trim() || env.OPENROUTER_MODEL?.trim()),
        run: async () => this.checkOpenRouter(),
      },
      {
        name: "diskSpace",
        critical: true,
        run: async () => this.checkDiskSpace(),
      },
      {
        name: "skills",
        critical: false,
        run: async () => this.checkSkills(),
      },
    ];
  }
}
