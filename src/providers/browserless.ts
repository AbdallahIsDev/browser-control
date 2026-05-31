import { chromium, type Browser, type BrowserContext } from "playwright";
import type {
  BrowserProvider,
  ProviderLaunchOptions,
  ProviderAttachOptions,
  ActiveConnection,
  ProviderCapabilities,
} from "./interface";
import type { BrowserConnection } from "../browser/connection";
import type { ProviderConfig } from "./types";
import { createAutomationContext, ensureContextHasPage, getAllPages } from "../browser/core";
import type { BrowserProfileManager } from "../browser/profiles";
import { ProviderConfigError, ProviderConnectionError } from "./errors";
import {
  closeBrowserResources,
  generateConnectionId,
  getDefaultProviderProfileManager,
  sanitizeString,
  stripSensitiveParams,
} from "./utils";
import { loadConfig } from "../shared/config";

export class BrowserlessProvider implements BrowserProvider {
  readonly name = "browserless";
  readonly capabilities: ProviderCapabilities = {
    supportsCDP: true,
    supportsLaunch: true,
    supportsAttach: true,
    supportsProfiles: false,
    supportsStealth: false,
    maxConcurrentSessions: 1,
    nativeDialogs: "supported",
  };

  private readonly profileManager: BrowserProfileManager;

  constructor(profileManager: BrowserProfileManager = getDefaultProviderProfileManager()) {
    this.profileManager = profileManager;
  }

  private getConfig(providerConfig?: ProviderConfig): {
    endpoint?: string;
    apiKey?: string;
  } {
    const env = loadConfig({ validate: false });
    return {
      endpoint: providerConfig?.endpoint ?? env.browserlessEndpoint ?? undefined,
      apiKey: providerConfig?.apiKey ?? env.browserlessApiKey ?? undefined,
    };
  }

  private buildConnectionOptions(
    providerConfig?: ProviderConfig,
    overrideUrl?: string,
  ): { wsUrl: string; headers?: Record<string, string> } {
    const { endpoint, apiKey } = this.getConfig(providerConfig);

    if (!endpoint && !apiKey && !overrideUrl) {
      throw new ProviderConfigError(
        this.name,
        "Missing browserless endpoint or apiKey. Set BROWSERLESS_ENDPOINT / BROWSERLESS_API_KEY, or provide endpoint in provider config.",
      );
    }

    let url = overrideUrl ?? endpoint ?? "wss://chrome.browserless.io";

    // Validate protocol
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new ProviderConfigError(this.name, `Invalid endpoint: ${stripSensitiveParams(url)}`);
    }

    if (!["wss:", "ws:", "https:", "http:"].includes(parsed.protocol)) {
      throw new ProviderConfigError(
        this.name,
        `Unsupported protocol: ${parsed.protocol}. Use ws://, wss://, http://, or https://.`,
      );
    }

    // Convert https -> wss for Playwright connect
    if (url.startsWith("https://")) {
      url = url.replace("https://", "wss://");
    } else if (url.startsWith("http://")) {
      url = url.replace("http://", "ws://");
    }

    return {
      wsUrl: url,
      headers:
        apiKey && !url.includes("token=")
          ? { Authorization: `Bearer ${apiKey}` }
          : undefined,
    };
  }

  async launch(options: ProviderLaunchOptions): Promise<ActiveConnection> {
    const { wsUrl, headers } = this.buildConnectionOptions(options.config, options.cdpUrl);
    const safeEndpoint = stripSensitiveParams(wsUrl);

    let browser: Browser;
    try {
      browser = await chromium.connect(wsUrl, headers ? { headers } : undefined);
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : String(err);
      const safeMessage = sanitizeString(rawMessage);
      throw new ProviderConnectionError(
        this.name,
        `Failed to connect to Browserless: ${safeEndpoint}. ${safeMessage}`,
      );
    }

    const context = await createAutomationContext(
      browser,
      options.contextOptions ?? {},
    );
    await ensureContextHasPage(context);

    const profile = this.profileManager.getDefaultProfile();
    const providerName = options.config?.name ?? this.name;
    const connection: BrowserConnection = {
      id: generateConnectionId(),
      mode: "managed",
      profile,
      cdpEndpoint: safeEndpoint,
      status: "connected",
      connectedAt: new Date().toISOString(),
      tabCount: getAllPages(browser).length,
      targetType: options.targetType ?? "chrome",
      isRealBrowser: false,
      provider: providerName,
      providerMetadata: { type: this.name, endpoint: safeEndpoint },
    };

    return {
      browser,
      context,
      connection,
      managedProcess: null,
    };
  }

  async attach(options: ProviderAttachOptions): Promise<ActiveConnection> {
    const { wsUrl, headers } = this.buildConnectionOptions(options.config, options.cdpUrl);
    const safeEndpoint = stripSensitiveParams(wsUrl);

    let browser: Browser;
    try {
      browser = await chromium.connect(wsUrl, headers ? { headers } : undefined);
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : String(err);
      const safeMessage = sanitizeString(rawMessage);
      throw new ProviderConnectionError(
        this.name,
        `Failed to connect to Browserless: ${safeEndpoint}. ${safeMessage}`,
      );
    }

    const contexts = browser.contexts();
    const context: BrowserContext | null = contexts.length > 0 ? contexts[0] : await browser.newContext();
    if (context.pages().length === 0) {
      await context.newPage();
    }

    const profile = this.profileManager.getDefaultProfile();
    const providerName = options.config?.name ?? this.name;
    const connection: BrowserConnection = {
      id: generateConnectionId(),
      mode: "attached",
      profile,
      cdpEndpoint: safeEndpoint,
      status: "connected",
      connectedAt: new Date().toISOString(),
      tabCount: getAllPages(browser).length,
      targetType: options.targetType ?? "chrome",
      isRealBrowser: true,
      provider: providerName,
      providerMetadata: { type: this.name, endpoint: safeEndpoint },
    };

    return {
      browser,
      context,
      connection,
      managedProcess: null,
    };
  }

  async disconnect(result: ActiveConnection): Promise<void> {
    await closeBrowserResources(result);
  }
}
