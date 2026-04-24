import { chromium, type Browser, type BrowserContext } from "playwright";
import type {
  BrowserProvider,
  ProviderLaunchOptions,
  ProviderAttachOptions,
  ActiveConnection,
} from "./interface";
import type { BrowserConnection } from "../browser_connection";
import { getAllPages } from "../browser_core";
import { BrowserProfileManager } from "../browser_profiles";
import { ProviderConfigError, ProviderConnectionError } from "./errors";
import { sanitizeString, stripSensitiveParams } from "./utils";

export class CustomBrowserProvider implements BrowserProvider {
  readonly name = "custom";
  readonly capabilities = {
    supportsCDP: true,
    supportsLaunch: false,
    supportsAttach: true,
    supportsProfiles: false,
    supportsStealth: false,
    maxConcurrentSessions: 1,
  };

  private profileManager = new BrowserProfileManager();

  async launch(_options: ProviderLaunchOptions): Promise<ActiveConnection> {
    throw new ProviderConfigError(
      this.name,
      "Custom provider does not support managed launch. Use attach with a remote CDP endpoint.",
    );
  }

  async attach(options: ProviderAttachOptions): Promise<ActiveConnection> {
    const endpoint = options.config?.endpoint ?? options.cdpUrl;
    if (!endpoint || typeof endpoint !== "string") {
      throw new ProviderConfigError(
        this.name,
        "Missing remote CDP/WebSocket endpoint. Provide endpoint in provider config or via --cdp-url.",
      );
    }

    // Basic URL validation
    try {
      new URL(endpoint);
    } catch {
      throw new ProviderConfigError(this.name, `Invalid endpoint: ${stripSensitiveParams(endpoint)}`);
    }

    const safeEndpoint = stripSensitiveParams(endpoint);
    let browser: Browser;
    try {
      if (endpoint.startsWith("ws://") || endpoint.startsWith("wss://")) {
        browser = await chromium.connect(endpoint);
      } else {
        browser = await chromium.connectOverCDP(endpoint);
      }
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : String(err);
      throw new ProviderConnectionError(
        this.name,
        `Failed to connect to remote endpoint: ${safeEndpoint}. ${sanitizeString(rawMessage)}`,
      );
    }

    const contexts = browser.contexts();
    const context: BrowserContext | null = contexts.length > 0 ? contexts[0] : null;

    const profile = this.profileManager.getDefaultProfile();
    const providerName = options.config?.name ?? this.name;
    const connection: BrowserConnection = {
      id: `conn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
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
  }
}
