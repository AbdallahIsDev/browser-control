import { spawn } from "node:child_process";
import fs from "node:fs";
import { chromium, type Browser, type BrowserContext } from "playwright";
import type {
  BrowserProvider,
  ProviderLaunchOptions,
  ProviderAttachOptions,
  ActiveConnection,
} from "./interface";
import type { BrowserConnection, BrowserTargetType } from "../browser/connection";
import {
  resolveChromePath,
  buildChromeArgs,
  waitForCdp,
  writeDebugState,
  getWslHostCandidates,
  isChromeAlive,
  isWslCdpBridgeEnabled,
  startWslBridgeIfNeeded,
  stopWslBridge,
} from "../../scripts/launch_browser";
import { connectBrowser, createAutomationContext, resolveDebugEndpointUrl, getAllPages } from "../browser/core";
import { BrowserProfileManager } from "../browser/profiles";
import { loadConfig } from "../shared/config";
import path from "node:path";

export class LocalBrowserProvider implements BrowserProvider {
  readonly name = "local";
  readonly capabilities = {
    supportsCDP: true,
    supportsLaunch: true,
    supportsAttach: true,
    supportsProfiles: true,
    supportsStealth: true,
    maxConcurrentSessions: 1,
  };

  private profileManager = new BrowserProfileManager();

  async launch(options: ProviderLaunchOptions): Promise<ActiveConnection> {
    const profile = options.profile ?? this.profileManager.getDefaultProfile();
    const port = options.port ?? 9222;
    const platform = process.platform;

    if (await isChromeAlive(port)) {
      throw new Error(
        `Managed launch failed: Port ${port} is already in use by an existing process. Use attach to connect to an existing browser, or specify an alternative port.`,
      );
    }

    const chromePath = resolveChromePath(platform, process.env.BROWSER_CHROME_PATH);
    const userDataDir = profile.dataDir;
    fs.mkdirSync(userDataDir, { recursive: true });

    const bindAddress = loadConfig({ validate: false }).chromeBindAddress;
    const chromeArgs = buildChromeArgs({ port, userDataDir, bindAddress });

    const managedProcess = spawn(chromePath, chromeArgs, {
      detached: true,
      stdio: "ignore",
      ...(platform === "win32" ? { windowsHide: false } : {}),
    });
    managedProcess.unref();

    const ready = await waitForCdp(port, 15000);
    if (!ready) {
      throw new Error(`Chrome did not become ready on port ${port} within 15 seconds.`);
    }

    const wslHostCandidates = getWslHostCandidates();
    const needsBridge = isWslCdpBridgeEnabled() && wslHostCandidates.length > 0;
    writeDebugState({ port, bindAddress, wslHostCandidates });

    if (needsBridge) {
      const bridgeScript = path.resolve(__dirname, "..", "wsl_cdp_bridge.cjs");
      await startWslBridgeIfNeeded(port, wslHostCandidates, bridgeScript);
    }

    const browser = await connectBrowser(port, { ignoreEnvOverrides: true });
    const cdpEndpoint = await resolveDebugEndpointUrl(port, { ignoreEnvOverrides: true });

    const contextOpts = {
      ...options.contextOptions,
      persistSessionCookies: false,
    };
    const context = await createAutomationContext(browser, contextOpts);
    const tabCount = getAllPages(browser).length;

    const connection: BrowserConnection = {
      id: `conn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      mode: "managed",
      profile,
      cdpEndpoint,
      status: "connected",
      connectedAt: new Date().toISOString(),
      tabCount,
      targetType: options.targetType ?? "chrome",
      isRealBrowser: false,
      provider: this.name,
    };

    return {
      browser,
      context,
      connection,
      managedProcess,
    };
  }

  async attach(options: ProviderAttachOptions): Promise<ActiveConnection> {
    const cdpEndpoint = options.cdpUrl ?? (await resolveDebugEndpointUrl(options.port ?? 9222));
    const browser = options.cdpUrl
      ? await chromium.connectOverCDP(options.cdpUrl)
      : await connectBrowser(options.port ?? 9222);

    const contexts = browser.contexts();
    const context = contexts.length > 0 ? contexts[0] : null;
    const tabCount = getAllPages(browser).length;

    const profile = this.profileManager.getDefaultProfile();
    const connection: BrowserConnection = {
      id: `conn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      mode: "attached",
      profile,
      cdpEndpoint,
      status: "connected",
      connectedAt: new Date().toISOString(),
      tabCount,
      targetType: options.targetType ?? this.detectTargetType(cdpEndpoint),
      isRealBrowser: true,
      provider: this.name,
    };

    return {
      browser,
      context,
      connection,
      managedProcess: null,
    };
  }

  async disconnect(result: ActiveConnection): Promise<void> {
    if (result.context && result.connection.mode !== "attached") {
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

    if (result.managedProcess && result.connection.mode !== "attached") {
      try {
        const pid = result.managedProcess.pid;
        result.managedProcess.kill();
        if (process.platform === "win32" && pid) {
          spawn("taskkill", ["/pid", String(pid), "/f", "/t"], { stdio: "ignore" });
        }
        const port = result.connection.cdpEndpoint
          ? Number(new URL(result.connection.cdpEndpoint).port)
          : undefined;
        if (port) {
          stopWslBridge(port);
        }
      } catch {
        // ignore
      }
    }
  }

  private detectTargetType(cdpEndpoint: string): BrowserTargetType {
    const lower = cdpEndpoint.toLowerCase();
    if (lower.includes("electron")) return "electron";
    return "chrome";
  }
}
