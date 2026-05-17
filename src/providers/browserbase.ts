import { chromium, type Browser, type BrowserContext } from "playwright";
import type {
  ActiveConnection,
  BrowserProvider,
  ProviderAttachOptions,
  ProviderLaunchOptions,
} from "./interface";
import type { BrowserConnection } from "../browser/connection";
import type { ProviderConfig } from "./types";
import { ensureContextHasPage, getAllPages } from "../browser/core";
import { BrowserProfileManager } from "../browser/profiles";
import { ProviderConfigError, ProviderConnectionError } from "./errors";
import { sanitizeString, stripSensitiveParams } from "./utils";

interface BrowserbaseSession {
  id: string;
  connectUrl: string;
  projectId?: string;
  region?: string;
  status?: string;
}

function getStringOption(config: ProviderConfig | undefined, key: string): string | undefined {
  const value = config?.options?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function getBooleanOption(config: ProviderConfig | undefined, key: string): boolean | undefined {
  const value = config?.options?.[key];
  return typeof value === "boolean" ? value : undefined;
}

function getNumberOption(config: ProviderConfig | undefined, key: string): number | undefined {
  const value = config?.options?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getApiBaseUrl(config?: ProviderConfig): string {
  return (getStringOption(config, "apiBaseUrl") ?? "https://api.browserbase.com/v1").replace(/\/+$/u, "");
}

export class BrowserbaseProvider implements BrowserProvider {
  readonly name = "browserbase";
  readonly capabilities = {
    supportsCDP: true,
    supportsLaunch: true,
    supportsAttach: true,
    supportsProfiles: false,
    supportsStealth: true,
    maxConcurrentSessions: 1,
    regions: ["us-west-2", "us-east-1", "eu-central-1", "ap-southeast-1"],
  };

  private profileManager = new BrowserProfileManager();
  private readonly releaseConfigs = new WeakMap<ActiveConnection, ProviderConfig>();

  async launch(options: ProviderLaunchOptions): Promise<ActiveConnection> {
    const session = options.cdpUrl || options.config?.endpoint
      ? undefined
      : await this.createSession(options.config);
    const connectUrl = options.cdpUrl ?? options.config?.endpoint ?? session?.connectUrl;
    if (!connectUrl) {
      throw new ProviderConfigError(
        this.name,
        "Browserbase API key is required to create a session, or provide a direct Browserbase connect endpoint.",
      );
    }
    return this.connect(connectUrl, "managed", options.config, session);
  }

  async attach(options: ProviderAttachOptions): Promise<ActiveConnection> {
    let connectUrl = options.cdpUrl ?? options.config?.endpoint;
    let session: BrowserbaseSession | undefined;
    const sessionId = getStringOption(options.config, "sessionId");
    if (!connectUrl && sessionId) {
      session = await this.getSession(options.config, sessionId);
      connectUrl = session.connectUrl;
    }
    if (!connectUrl) {
      throw new ProviderConfigError(
        this.name,
        "Browserbase attach requires a sessionId option, cdpUrl, or direct connect endpoint.",
      );
    }
    return this.connect(connectUrl, "attached", options.config, session);
  }

  async disconnect(result: ActiveConnection): Promise<void> {
    if (result.context) {
      try {
        await result.context.close();
      } catch {
        // ignore
      }
    }
    if (result.browser) {
      try {
        await result.browser.close();
      } catch {
        // ignore
      }
    }
    const sessionId = typeof result.metadata?.browserbaseSessionId === "string"
      ? result.metadata.browserbaseSessionId
      : undefined;
    const config = this.releaseConfigs.get(result);
    if (sessionId && config?.apiKey && getBooleanOption(config, "releaseOnDisconnect") !== false) {
      await this.releaseSession(config, sessionId);
    }
    this.releaseConfigs.delete(result);
  }

  private async connect(
    connectUrl: string,
    mode: "managed" | "attached",
    config?: ProviderConfig,
    session?: BrowserbaseSession,
  ): Promise<ActiveConnection> {
    const safeEndpoint = stripSensitiveParams(connectUrl);
    let browser: Browser;
    try {
      browser = await chromium.connectOverCDP(connectUrl);
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : String(err);
      throw new ProviderConnectionError(
        this.name,
        `Failed to connect to Browserbase: ${safeEndpoint}. ${sanitizeString(rawMessage)}`,
      );
    }

    let context: BrowserContext | null = browser.contexts()[0] ?? null;
    if (!context && mode === "managed") {
      context = await browser.newContext();
    }
    if (context && mode === "managed") {
      await ensureContextHasPage(context);
    } else if (context && context.pages().length === 0) {
      await context.newPage();
    }

    const profile = this.profileManager.getDefaultProfile();
    const providerName = config?.name ?? this.name;
    const connection: BrowserConnection = {
      id: `conn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      mode,
      profile,
      cdpEndpoint: safeEndpoint,
      status: "connected",
      connectedAt: new Date().toISOString(),
      tabCount: getAllPages(browser).length,
      targetType: "chrome",
      isRealBrowser: true,
      provider: providerName,
      providerMetadata: {
        type: this.name,
        endpoint: safeEndpoint,
        ...(session?.id ? { sessionId: session.id } : {}),
        ...(session?.region ? { region: session.region } : {}),
      },
    };

    const activeConnection: ActiveConnection = {
      browser,
      context,
      connection,
      managedProcess: null,
      metadata: {
        ...(session?.id ? { browserbaseSessionId: session.id } : {}),
      },
    };
    if (session?.id && config?.apiKey) {
      this.releaseConfigs.set(activeConnection, config);
    }
    return activeConnection;
  }

  private async createSession(config?: ProviderConfig): Promise<BrowserbaseSession> {
    const apiKey = config?.apiKey ?? process.env.BROWSERBASE_API_KEY;
    if (!apiKey) {
      throw new ProviderConfigError(
        this.name,
        "Browserbase API key is required to create a session. Configure apiKey or BROWSERBASE_API_KEY.",
      );
    }

    const body: Record<string, unknown> = {};
    const projectId = getStringOption(config, "projectId") ?? process.env.BROWSERBASE_PROJECT_ID;
    const region = getStringOption(config, "region");
    const keepAlive = getBooleanOption(config, "keepAlive");
    const timeout = getNumberOption(config, "timeout");
    if (projectId) body.projectId = projectId;
    if (region) body.region = region;
    if (typeof keepAlive === "boolean") body.keepAlive = keepAlive;
    if (typeof timeout === "number") body.timeout = timeout;

    const response = await fetch(`${getApiBaseUrl(config)}/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-bb-api-key": apiKey,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = sanitizeString(await response.text());
      throw new ProviderConnectionError(this.name, `Browserbase session create failed (${response.status}): ${text}`);
    }
    const session = await response.json() as BrowserbaseSession;
    if (!session.connectUrl || !session.id) {
      throw new ProviderConnectionError(this.name, "Browserbase session response did not include id and connectUrl.");
    }
    return session;
  }

  private async getSession(config: ProviderConfig | undefined, sessionId: string): Promise<BrowserbaseSession> {
    const apiKey = config?.apiKey ?? process.env.BROWSERBASE_API_KEY;
    if (!apiKey) {
      throw new ProviderConfigError(this.name, "Browserbase API key is required to retrieve a session.");
    }
    const response = await fetch(`${getApiBaseUrl(config)}/sessions/${encodeURIComponent(sessionId)}`, {
      headers: { "x-bb-api-key": apiKey },
    });
    if (!response.ok) {
      const text = sanitizeString(await response.text());
      throw new ProviderConnectionError(this.name, `Browserbase session lookup failed (${response.status}): ${text}`);
    }
    const session = await response.json() as BrowserbaseSession;
    if (!session.connectUrl) {
      throw new ProviderConnectionError(this.name, "Browserbase session response did not include connectUrl.");
    }
    return session;
  }

  private async releaseSession(config: ProviderConfig, sessionId: string): Promise<void> {
    try {
      await fetch(`${getApiBaseUrl(config)}/sessions/${encodeURIComponent(sessionId)}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-bb-api-key": config.apiKey ?? "",
        },
        body: JSON.stringify({
          status: "REQUEST_RELEASE",
          ...(getStringOption(config, "projectId") ? { projectId: getStringOption(config, "projectId") } : {}),
        }),
      });
    } catch {
      // Disconnect must not fail because remote release telemetry failed.
    }
  }
}
