import fs from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import https from "node:https";
import path from "node:path";
import { request, type BrowserContextOptions } from "playwright";
import { redactString } from "./observability/redaction";
import type { Telemetry } from "./runtime/telemetry";
import { ServiceRegistry, isValidServiceName, type ServiceEntry } from "./services/registry";
import { getLocalhostCaStatus } from "./services/local_ca";
import { getConfigDir } from "./shared/paths";

export interface ProxyConfig {
  url: string;
  username?: string;
  password?: string;
  credentialRef?: string;
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

export interface LocalhostProxyStartResult {
  enabled: true;
  host: string;
  port: number;
  url: string;
}

export interface LocalhostProxyStatus {
  enabled: boolean;
  host: string;
  port?: number;
  url?: string;
  httpsEnabled: boolean;
  allowRemote: boolean;
  activeConnections: number;
}

export interface LocalhostProxyOptions {
  registry?: ServiceRegistry;
  host?: string;
  port?: number;
  allowRemote?: boolean;
  https?: boolean;
  certPath?: string;
  keyPath?: string;
  localCa?: boolean;
  caDir?: string;
  reloadRegistryOnRequest?: boolean;
}

type ProxyConfigInput = string | Omit<ProxyConfig, "lastUsed"> & { lastUsed?: Date | string };

const DEFAULT_COOLDOWN_MS = 60_000;
const DEFAULT_MAX_FAILURES_BEFORE_DEAD = 3;
const LOOPBACK_HOST = "127.0.0.1";

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
    ...(input.credentialRef?.trim()
      ? { credentialRef: input.credentialRef.trim() }
      : {}),
    ...(lastUsed ? { lastUsed } : {}),
  };
}

export function getDefaultProxyPath(dataHome?: string): string {
  return path.join(getConfigDir(dataHome), "proxies.json");
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
  const env = options.env ?? process.env;
  const filePath = options.filePath
    ?? (options.cwd ? path.join(options.cwd, "proxies.json") : getDefaultProxyPath());

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

export async function resolveProxyConfigSecrets(proxy: ProxyConfig): Promise<ProxyConfig> {
  const cloned = cloneProxy(proxy);
  if (!cloned.credentialRef) return cloned;

  const { CredentialVault } = await import("./security/credential_vault");
  const rawValue = await new CredentialVault().getValue(cloned.credentialRef);
  if (!rawValue) return cloned;

  const parsed = JSON.parse(rawValue) as { username?: unknown; password?: unknown };
  return {
    ...cloned,
    username: typeof parsed.username === "string" ? parsed.username : cloned.username,
    password: typeof parsed.password === "string" ? parsed.password : cloned.password,
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
  const resolvedProxy = await resolveProxyConfigSecrets(proxy);
  const client = await request.newContext({
    ignoreHTTPSErrors: true,
    proxy: toPlaywrightProxySettings(resolvedProxy),
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

function isLoopbackAddress(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function stripHostPort(host: string): string {
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end === -1 ? host : host.slice(1, end);
  }
  return host.split(":")[0] ?? host;
}

export function resolveLocalhostProxyHost(hostHeader: string | undefined): {
  serviceName?: string;
  error?: string;
} {
  if (!hostHeader) return { error: "Host header is required." };
  const hostname = stripHostPort(hostHeader).toLowerCase();
  if (!hostname.endsWith(".localhost")) {
    return { error: "Only .localhost hostnames are accepted by the local service proxy." };
  }
  const prefix = hostname.slice(0, -".localhost".length);
  if (!prefix) return { error: "Service subdomain is required before .localhost." };
  const labels = prefix.split(".");
  if (labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label))) {
    return { error: "Invalid .localhost hostname labels." };
  }
  const serviceName = labels.at(-1) ?? "";
  if (!isValidServiceName(serviceName)) {
    return { error: `Invalid service name in .localhost hostname: ${serviceName}` };
  }
  return { serviceName };
}

function buildBackendUrl(entry: ServiceEntry, requestUrl: string | undefined): URL {
  const basePath = entry.path === "/" ? "" : entry.path;
  const suffix = requestUrl && requestUrl !== "/" ? requestUrl : "/";
  return new URL(`${entry.protocol}://127.0.0.1:${entry.port}${basePath}${suffix}`);
}

function copyProxyHeaders(requestHeaders: IncomingMessage["headers"], target: URL): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = {};
  for (const [key, value] of Object.entries(requestHeaders)) {
    const lower = key.toLowerCase();
    if (
      lower === "host" ||
      lower === "connection" ||
      lower === "keep-alive" ||
      lower === "proxy-authenticate" ||
      lower === "proxy-authorization" ||
      lower === "te" ||
      lower === "trailer" ||
      lower === "transfer-encoding" ||
      lower === "upgrade"
    ) {
      continue;
    }
    headers[key] = value;
  }
  headers.host = target.host;
  headers["x-browser-control-localhost-proxy"] = "1";
  return headers;
}

function copyUpstreamResponseHeaders(responseHeaders: IncomingMessage["headers"]): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = {};
  for (const [key, value] of Object.entries(responseHeaders)) {
    const lower = key.toLowerCase();
    if (
      lower === "connection" ||
      lower === "keep-alive" ||
      lower === "proxy-authenticate" ||
      lower === "proxy-authorization" ||
      lower === "te" ||
      lower === "trailer" ||
      lower === "transfer-encoding" ||
      lower === "upgrade"
    ) {
      continue;
    }
    headers[key] = value;
  }
  return headers;
}

function sendProxyError(response: ServerResponse, statusCode: number, message: string): void {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: message }));
}

export class LocalhostProxyManager {
  private readonly registry: ServiceRegistry;
  private readonly host: string;
  private readonly requestedPort: number;
  private readonly allowRemote: boolean;
  private readonly httpsEnabled: boolean;
  private readonly certPath: string | undefined;
  private readonly keyPath: string | undefined;
  private readonly localCa: boolean;
  private readonly caDir: string | undefined;
  private readonly reloadRegistryOnRequest: boolean;
  private server: http.Server | https.Server | null = null;
  private activeConnections = 0;
  private boundPort: number | undefined;

  constructor(options: LocalhostProxyOptions = {}) {
    this.registry = options.registry ?? new ServiceRegistry();
    this.host = options.allowRemote ? "0.0.0.0" : (options.host ?? LOOPBACK_HOST);
    this.requestedPort = options.port ?? 0;
    this.allowRemote = options.allowRemote === true;
    this.httpsEnabled = options.https === true;
    this.certPath = options.certPath;
    this.keyPath = options.keyPath;
    this.localCa = options.localCa === true;
    this.caDir = options.caDir;
    this.reloadRegistryOnRequest = options.reloadRegistryOnRequest ?? !options.registry;
  }

  async start(): Promise<LocalhostProxyStartResult> {
    if (this.server) {
      const status = this.getStatus();
      if (!status.port || !status.url) throw new Error("Localhost proxy server is not fully started.");
      return { enabled: true, host: status.host, port: status.port, url: status.url };
    }

    const requestHandler = (requestMessage: IncomingMessage, response: ServerResponse) => {
      void this.handleRequest(requestMessage, response).catch((error: unknown) => {
        const message = redactString(error instanceof Error ? error.message : String(error));
        if (!response.headersSent) {
          sendProxyError(response, 502, `Localhost proxy request failed: ${message}`);
          return;
        }
        response.destroy(error instanceof Error ? error : new Error(message));
      });
    };
    const server = this.httpsEnabled
      ? https.createServer(this.readTlsOptions(), requestHandler)
      : http.createServer(requestHandler);
    this.server = server;

    await new Promise<void>((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException) => {
        server.off("listening", onListening);
        reject(this.toListenError(error));
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(this.requestedPort, this.host);
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Unable to determine .localhost proxy listening address.");
    }
    this.boundPort = address.port;
    return {
      enabled: true,
      host: this.host === "0.0.0.0" ? LOOPBACK_HOST : this.host,
      port: this.boundPort,
      url: `${this.httpsEnabled ? "https" : "http"}://${this.host === "0.0.0.0" ? LOOPBACK_HOST : this.host}:${this.boundPort}`,
    };
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = null;
    this.boundPort = undefined;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  getStatus(): LocalhostProxyStatus {
    return {
      enabled: Boolean(this.server),
      host: this.host === "0.0.0.0" ? LOOPBACK_HOST : this.host,
      ...(this.boundPort ? {
        port: this.boundPort,
        url: `${this.httpsEnabled ? "https" : "http"}://${this.host === "0.0.0.0" ? LOOPBACK_HOST : this.host}:${this.boundPort}`,
      } : {}),
      httpsEnabled: this.httpsEnabled,
      allowRemote: this.allowRemote,
      activeConnections: this.activeConnections,
    };
  }

  private async handleRequest(requestMessage: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!this.allowRemote && !isLoopbackAddress(requestMessage.socket.remoteAddress)) {
      sendProxyError(response, 403, "Localhost proxy accepts loopback clients only.");
      return;
    }

    const resolvedHost = resolveLocalhostProxyHost(requestMessage.headers.host);
    if (!resolvedHost.serviceName) {
      sendProxyError(response, 400, resolvedHost.error ?? "Invalid .localhost host.");
      return;
    }

    if (this.reloadRegistryOnRequest) {
      this.registry.reload();
    }
    const service = this.registry.get(resolvedHost.serviceName);
    if (!service) {
      sendProxyError(response, 404, `No registered service for ${resolvedHost.serviceName}.localhost.`);
      return;
    }

    const target = buildBackendUrl(service, requestMessage.url);
    const transport = target.protocol === "https:" ? https : http;
    this.activeConnections++;
    const upstream = transport.request(target, {
      method: requestMessage.method,
      headers: copyProxyHeaders(requestMessage.headers, target),
    }, (upstreamResponse) => {
      response.writeHead(
        upstreamResponse.statusCode ?? 502,
        copyUpstreamResponseHeaders(upstreamResponse.headers),
      );
      upstreamResponse.pipe(response);
    });

    upstream.on("error", (error) => {
      if (!response.headersSent) {
        sendProxyError(response, 502, `Failed to reach registered service: ${error.message}`);
      } else {
        response.destroy(error);
      }
    });
    upstream.on("close", () => {
      this.activeConnections = Math.max(0, this.activeConnections - 1);
    });
    requestMessage.pipe(upstream);
  }

  private toListenError(error: NodeJS.ErrnoException): Error {
    if (error.code === "EACCES") {
      return new Error(
        `Unable to bind .localhost proxy on ${this.host}:${this.requestedPort}. On Windows, ports 80/443 usually require administrator rights or an HTTP reservation.`,
      );
    }
    if (error.code === "EADDRINUSE") {
      return new Error(`Unable to bind .localhost proxy on ${this.host}:${this.requestedPort}; port is already in use.`);
    }
    return error;
  }

  private readTlsOptions(): https.ServerOptions {
    const localCa = this.localCa ? getLocalhostCaStatus({ caDir: this.caDir }) : undefined;
    const certSource = this.certPath ?? localCa?.certPath;
    const keySource = this.keyPath ?? localCa?.keyPath;
    if (this.localCa && !localCa?.ready) {
      throw new Error(`HTTPS .localhost proxy local CA material is missing or incomplete. Run "bc service proxy ca create" first. CA dir: ${localCa?.caDir}`);
    }
    if (!certSource || !keySource) {
      throw new Error("HTTPS .localhost proxy requires explicit --cert and --key files from a trusted local CA.");
    }
    const certPath = path.resolve(certSource);
    const keyPath = path.resolve(keySource);
    if (!fs.existsSync(certPath)) {
      throw new Error(`HTTPS .localhost proxy certificate file not found: ${certPath}`);
    }
    if (!fs.existsSync(keyPath)) {
      throw new Error(`HTTPS .localhost proxy key file not found: ${keyPath}`);
    }
    return {
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath),
    };
  }
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
