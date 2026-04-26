import fs from "node:fs";
import path from "node:path";
import { request, type BrowserContextOptions } from "playwright";
import type { Telemetry } from "./runtime/telemetry";

export interface ProxyConfig {
  url: string;
  username?: string;
  password?: string;
  status: "active" | "cooldown" | "dead";
  lastUsed?: Date;
}

export interface LoadProxyConfigOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  filePath?: string;
}

export interface ProxyManagerOptions {
  cooldownMs?: number;
  maxFailuresBeforeDead?: number;
  now?: () => number;
}

export interface ProxyValidationProbeResult {
  ok: boolean;
  details?: Record<string, unknown>;
  error?: string;
}

export interface ProxyValidationResult extends ProxyValidationProbeResult {
  proxyUrl: string;
}

type ProxyConfigInput = string | Omit<ProxyConfig, "lastUsed"> & { lastUsed?: Date | string };

const DEFAULT_COOLDOWN_MS = 60_000;
const DEFAULT_MAX_FAILURES_BEFORE_DEAD = 3;

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeLastUsed(value: Date | string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function normalizeProxyConfig(input: ProxyConfigInput): ProxyConfig {
  if (typeof input === "string") {
    return {
      url: input.trim(),
      status: "active",
    };
  }

  const lastUsed = normalizeLastUsed(input.lastUsed);
  return {
    url: input.url.trim(),
    username: input.username?.trim() || undefined,
    password: input.password?.trim() || undefined,
    status: input.status ?? "active",
    ...(lastUsed ? { lastUsed } : {}),
  };
}

export function getDefaultProxyPath(cwd = process.cwd()): string {
  return path.join(cwd, "proxies.json");
}

function readProxyFile(filePath: string): ProxyConfig[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as ProxyConfigInput[];
  if (!Array.isArray(parsed)) {
    throw new Error("proxies.json must contain an array.");
  }

  return parsed.map(normalizeProxyConfig);
}

function readProxyEnv(value: string | undefined): ProxyConfig[] {
  if (!value) {
    return [];
  }

  return splitCsv(value).map((entry) => normalizeProxyConfig(entry));
}

function cloneProxy(proxy: ProxyConfig): ProxyConfig {
  const lastUsed = proxy.lastUsed ? new Date(proxy.lastUsed.getTime()) : undefined;
  return {
    ...proxy,
    ...(lastUsed ? { lastUsed } : {}),
  };
}

function normalizeProxyUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error("Proxy URL must not be empty.");
  }

  if (/^[a-z]+:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `http://${trimmed}`;
}

export function loadProxyConfigs(options: LoadProxyConfigOptions = {}): ProxyConfig[] {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const filePath = options.filePath ?? getDefaultProxyPath(cwd);

  return [
    ...readProxyFile(filePath),
    ...readProxyEnv(env.PROXY_LIST),
  ];
}

export function toPlaywrightProxySettings(proxy: ProxyConfig): NonNullable<BrowserContextOptions["proxy"]> {
  const parsed = new URL(normalizeProxyUrl(proxy.url));
  const username = proxy.username ?? decodeURIComponent(parsed.username || "");
  const password = proxy.password ?? decodeURIComponent(parsed.password || "");

  return {
    server: `${parsed.protocol}//${parsed.host}`,
    username: username || undefined,
    password: password || undefined,
  };
}

export class ProxyManager {
  private readonly proxies: ProxyConfig[];

  private readonly cooldownMs: number;

  private readonly maxFailuresBeforeDead: number;

  private readonly now: () => number;

  private readonly cooldownUntil = new Map<string, number>();

  private readonly failureCounts = new Map<string, number>();

  private nextIndex = 0;

  constructor(
    proxies: ProxyConfig[],
    options: ProxyManagerOptions = {},
  ) {
    this.proxies = proxies.map((proxy) => cloneProxy(normalizeProxyConfig(proxy)));
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.maxFailuresBeforeDead = options.maxFailuresBeforeDead ?? DEFAULT_MAX_FAILURES_BEFORE_DEAD;
    this.now = options.now ?? Date.now;

    for (const proxy of this.proxies) {
      if (proxy.status === "cooldown") {
        this.cooldownUntil.set(proxy.url, this.now() + this.cooldownMs);
      }
    }
  }

  private refreshCooldowns(): void {
    const now = this.now();
    for (const proxy of this.proxies) {
      if (proxy.status !== "cooldown") {
        continue;
      }

      const readyAt = this.cooldownUntil.get(proxy.url);
      if (readyAt !== undefined && readyAt <= now) {
        proxy.status = "active";
        this.cooldownUntil.delete(proxy.url);
      }
    }
  }

  getSnapshot(): ProxyConfig[] {
    this.refreshCooldowns();
    return this.proxies.map(cloneProxy);
  }

  getProxy(): ProxyConfig | null {
    this.refreshCooldowns();
    if (this.proxies.length === 0) {
      return null;
    }

    for (let offset = 0; offset < this.proxies.length; offset += 1) {
      const index = (this.nextIndex + offset) % this.proxies.length;
      const proxy = this.proxies[index];
      if (proxy.status !== "active") {
        continue;
      }

      proxy.lastUsed = new Date(this.now());
      this.nextIndex = (index + 1) % this.proxies.length;
      return cloneProxy(proxy);
    }

    return null;
  }

  markFailed(proxyUrl: string): void {
    this.refreshCooldowns();
    const proxy = this.proxies.find((entry) => entry.url === proxyUrl);
    if (!proxy) {
      return;
    }

    const failureCount = (this.failureCounts.get(proxyUrl) ?? 0) + 1;
    this.failureCounts.set(proxyUrl, failureCount);

    if (failureCount >= this.maxFailuresBeforeDead) {
      proxy.status = "dead";
      this.cooldownUntil.delete(proxyUrl);
      return;
    }

    proxy.status = "cooldown";
    this.cooldownUntil.set(proxyUrl, this.now() + this.cooldownMs);
  }
}

async function testProxyConnection(proxy: ProxyConfig): Promise<ProxyValidationProbeResult> {
  const client = await request.newContext({
    ignoreHTTPSErrors: true,
    proxy: toPlaywrightProxySettings(proxy),
  });

  try {
    const response = await client.get("https://api.ipify.org?format=json", {
      timeout: 10_000,
    });

    if (!response.ok()) {
      return {
        ok: false,
        error: `HTTP ${response.status()} while probing proxy.`,
      };
    }

    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    return {
      ok: true,
      details: payload ?? {
        status: response.status(),
      },
    };
  } catch (error: unknown) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await client.dispose();
  }
}

export async function validateProxyPool(
  proxies: ProxyConfig[],
  tester: (proxy: ProxyConfig) => Promise<ProxyValidationProbeResult> = testProxyConnection,
  telemetry?: Telemetry,
): Promise<ProxyValidationResult[]> {
  const results: ProxyValidationResult[] = [];

  for (const proxy of proxies) {
    const startedAt = Date.now();
    const result = await tester(proxy);
    telemetry?.record("proxy.validate", result.ok ? "success" : "error", Date.now() - startedAt, {
      proxyUrl: proxy.url,
      ...(result.error ? { error: result.error } : {}),
    });
    results.push({
      proxyUrl: proxy.url,
      ...result,
    });
  }

  return results;
}

async function runCli(argv = process.argv.slice(2)): Promise<number> {
  const [command] = argv;
  if (command !== "test") {
    console.error("[PROXY_MANAGER] Unknown command. Supported commands: test");
    return 1;
  }

  const proxies = loadProxyConfigs();
  if (proxies.length === 0) {
    console.error("[PROXY_MANAGER] No proxies configured in proxies.json or PROXY_LIST.");
    return 1;
  }

  const results = await validateProxyPool(proxies);
  for (const result of results) {
    if (result.ok) {
      console.log(`[PROXY_MANAGER] PASS ${result.proxyUrl} ${JSON.stringify(result.details ?? {})}`);
      continue;
    }

    console.error(`[PROXY_MANAGER] FAIL ${result.proxyUrl} ${result.error ?? "Unknown error"}`);
  }

  return results.every((result) => result.ok) ? 0 : 1;
}

if (require.main === module) {
  runCli().then((code) => {
    process.exit(code);
  }).catch((error: unknown) => {
    console.error(`[PROXY_MANAGER] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
