import { BrowserbaseProvider } from "./browserbase";
import { BrowserlessProvider } from "./browserless";
import { CustomBrowserProvider } from "./custom";
import type { BrowserProvider } from "./interface";
import { LocalBrowserProvider } from "./local";
import { UnsupportedRemoteSandboxProvider } from "./unsupported";
import type { ProviderConfig } from "./types";
import { getBrowserbaseApiBaseUrl, sanitizeString, stripSensitiveParams } from "./utils";

export type ProviderHealthState = "healthy" | "degraded" | "unhealthy";

export interface ProviderHealthReport {
  name: string;
  type: ProviderConfig["type"];
  ok: boolean;
  state: ProviderHealthState;
  score: number;
  checkedAt: string;
  latencyMs: number;
  authValid: boolean | null;
  endpointReachable: boolean | null;
  launchSupported: boolean;
  attachSupported: boolean;
  recentFailures: number;
  summary: string;
  endpoint?: string;
  nativeDialogStatus?: "supported" | "unsupported" | "unknown";
}

export interface ProviderHealthOptions {
  fetchImpl?: typeof fetch;
  recentFailures?: number;
}

function createProvider(config: ProviderConfig): BrowserProvider {
  switch (config.type) {
    case "local":
      return new LocalBrowserProvider();
    case "custom":
      return new CustomBrowserProvider();
    case "browserless":
      return new BrowserlessProvider();
    case "browserbase":
      return new BrowserbaseProvider();
    case "e2b":
      return new UnsupportedRemoteSandboxProvider("e2b");
    case "cubesandbox":
      return new UnsupportedRemoteSandboxProvider("cubesandbox");
    case "camofox":
      return new UnsupportedRemoteSandboxProvider("camofox");
    case "cloak":
      return new UnsupportedRemoteSandboxProvider("cloak");
    case "obscura":
      return new UnsupportedRemoteSandboxProvider("obscura");
  }
}

function scoreParts(report: Omit<ProviderHealthReport, "score" | "state" | "ok">): number {
  let score = 0;
  if (report.endpointReachable !== false) score += 35;
  if (report.authValid !== false) score += 25;
  if (report.launchSupported) score += 15;
  if (report.attachSupported) score += 15;
  if (report.latencyMs > 0 && report.latencyMs < 1000) score += 10;
  score -= Math.min(30, report.recentFailures * 10);
  return Math.max(0, Math.min(100, score));
}

function stateForScore(score: number): ProviderHealthState {
  if (score >= 75) return "healthy";
  if (score >= 45) return "degraded";
  return "unhealthy";
}

function sanitizeProviderMessage(text: string, config: ProviderConfig): string {
  let safe = sanitizeString(text);
  if (config.apiKey) {
    safe = safe.split(config.apiKey).join("[REDACTED]");
  }
  return safe;
}

export function scoreProviderHealth(report: Pick<ProviderHealthReport, "score">): number {
  return report.score;
}

export async function checkProviderHealth(
  config: ProviderConfig,
  options: ProviderHealthOptions = {},
): Promise<ProviderHealthReport> {
  const started = Date.now();
  const provider = createProvider(config);
  const fetchImpl = options.fetchImpl ?? fetch;
  let authValid: boolean | null = null;
  let endpointReachable: boolean | null = null;
  let summary = `${config.name} provider diagnostics complete.`;

  try {
    if (config.type === "local") {
      authValid = null;
      endpointReachable = true;
      summary = "Local browser provider is available.";
    } else if (config.type === "browserbase") {
      if (!config.apiKey && !process.env.BROWSERBASE_API_KEY) {
        authValid = false;
        endpointReachable = false;
        summary = "Browserbase API key is not configured.";
      } else {
        const response = await fetchImpl(`${getBrowserbaseApiBaseUrl(config)}/sessions`, {
          method: "GET",
          headers: { "x-bb-api-key": config.apiKey ?? process.env.BROWSERBASE_API_KEY ?? "" },
          signal: AbortSignal.timeout(3000),
        });
        authValid = response.status !== 401 && response.status !== 403;
        endpointReachable = response.ok;
        summary = response.ok
          ? "Browserbase API reachable."
          : `Browserbase API returned ${response.status}: ${sanitizeProviderMessage(await response.text(), config)}`;
      }
    } else if (
      config.type === "e2b" ||
      config.type === "cubesandbox" ||
      config.type === "camofox" ||
      config.type === "cloak" ||
      config.type === "obscura"
    ) {
      authValid = config.apiKey ? null : false;
      endpointReachable = false;
      summary = `${config.name} provider adapter is not implemented in this build. Configure only after installing a reviewed runtime adapter.`;
    } else if (config.endpoint) {
      const endpoint = config.endpoint.startsWith("ws")
        ? config.endpoint.replace(/^ws/u, "http")
        : config.endpoint;
      const response = await fetchImpl(endpoint, {
        method: "GET",
        signal: AbortSignal.timeout(3000),
      });
      authValid = response.status !== 401 && response.status !== 403;
      endpointReachable = response.ok || response.status < 500;
      summary = endpointReachable
        ? `${config.name} endpoint reachable.`
        : `${config.name} endpoint returned ${response.status}: ${sanitizeProviderMessage(await response.text(), config)}`;
    } else {
      authValid = config.type === "custom" ? null : false;
      endpointReachable = false;
      summary = `${config.name} provider endpoint is not configured.`;
    }
  } catch (error) {
    authValid = authValid ?? null;
    endpointReachable = false;
    summary = sanitizeProviderMessage(error instanceof Error ? error.message : String(error), config);
  }

  const base = {
    name: config.name,
    type: config.type,
    checkedAt: new Date().toISOString(),
    latencyMs: Date.now() - started,
    authValid,
    endpointReachable,
    launchSupported: provider.capabilities.supportsLaunch,
    attachSupported: provider.capabilities.supportsAttach,
    recentFailures: options.recentFailures ?? 0,
    summary,
    nativeDialogStatus: provider.capabilities.nativeDialogs,
    ...(config.endpoint ? { endpoint: stripSensitiveParams(config.endpoint) } : {}),
  };
  const score = scoreParts(base);
  const state = stateForScore(score);
  return {
    ...base,
    ok: state !== "unhealthy" && endpointReachable !== false && authValid !== false,
    score,
    state,
  };
}
