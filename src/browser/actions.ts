/**
 * Browser Actions — High-level browser action surface for Browser Control.
 *
 * Implements the canonical browser actions:
 *   open, snapshot, click, fill, hover, type, press, scroll, screenshot,
 *   tab list, tab switch, tab close, close
 *
 * Uses:
 *   - Section 8 browser connection/session layer
 *   - Section 6 snapshot/ref/query layer
 *   - Section 4 policy routing
 *   - ActionResult as the unified result contract
 */

import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import { snapshot, type A11ySnapshot, type A11yElement, INTERACTIVE_ROLES } from "../a11y_snapshot";
import { RefStore, getPageId, resolveRefLocator } from "../ref_store";
import { globalRefStore } from "./core";
import { BrowserConnectionManager, type BrowserDropRequest, type BrowserDropResult } from "./connection";
import type { SessionManager } from "../session_manager";
import { isPolicyAllowed } from "../session_manager";
import {
  successResult,
  failureResult,
  type ActionResult,
} from "../shared/action_result";
import { logger } from "../shared/logger";
import { resolveServiceUrl, mightBeServiceRef } from "../services/resolver";
import { ServiceRegistry, globalServiceRegistry } from "../services/registry";
import { collectFailureDebugMetadata } from "../observability/action_debug";
import { getGlobalConsoleCapture } from "../observability/console_capture";
import { getGlobalNetworkCapture } from "../observability/network_capture";
import type { ExecutionPath, PolicyDecision, RiskLevel } from "../policy/types";
import type { ScreencastOptions, ScreencastSession, ActionReceiptEvent } from "../observability/types";
import { getGlobalScreencastRecorder } from "../observability/screencast";
import { validateFilePath, getFileSize, type ExtendedDownloadResult } from "./file_helpers";
import { getSessionDownloadsDir } from "../shared/paths";

const log = logger.withComponent("browser_actions");

type ObservabilityCdpClient = {
  on: (event: string, handler: (params: Record<string, unknown>) => void) => void;
  off: (event: string, handler: (params: Record<string, unknown>) => void) => void;
  send: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
};

interface BrowserWindowTarget {
  page: Page;
  targetId: string;
  windowId: number;
}

// ── Action Options ─────────────────────────────────────────────────────

export interface BrowserActionContext {
  /** Session manager for policy routing and session binding. */
  sessionManager: SessionManager;
  /** Ref store to use (defaults to global). */
  refStore?: RefStore;
  /** Service registry to use for URL resolution (defaults to global). */
  serviceRegistry?: ServiceRegistry;
}

export interface OpenOptions {
  url: string;
  /** Wait until this event fires (default: domcontentloaded). */
  waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
}

export interface SnapshotOptions {
  /** Root selector to scope the snapshot. */
  rootSelector?: string;
  /** Include element bounds with viewport metadata. */
  boxes?: boolean;
}

export interface ClickOptions {
  /** Target: ref (@e3), selector, or semantic description. */
  target: string;
  /** Click timeout in ms. */
  timeoutMs?: number;
  /** Force click without actionability checks. */
  force?: boolean;
}

export interface FillOptions {
  /** Target: ref (@e3), selector, or semantic description. */
  target: string;
  /** Text to fill. */
  text: string;
  /** Fill timeout in ms. */
  timeoutMs?: number;
  /** Commit with Tab after fill. */
  commit?: boolean;
}

export interface HoverOptions {
  /** Target: ref (@e3), selector, or semantic description. */
  target: string;
  /** Hover timeout in ms. */
  timeoutMs?: number;
}

export interface TypeOptions {
  /** Text to type into the currently focused element. */
  text: string;
  /** Delay between keystrokes in ms. */
  delayMs?: number;
}

export interface PressOptions {
  /** Key to press (e.g., "Enter", "Tab", "ArrowDown"). */
  key: string;
}

export interface ScrollOptions {
  /** Direction: up, down, left, right. */
  direction: "up" | "down" | "left" | "right";
  /** Scroll amount in pixels (default: 300). */
  amount?: number;
}

export interface ScreenshotOptions {
  /** Output file path. */
  outputPath?: string;
  /** Full page screenshot. */
  fullPage?: boolean;
  /** Element selector/ref to screenshot. */
  target?: string;
  /** Annotate screenshot with ref labels and boxes. */
  annotate?: boolean;
  /** Specific refs to annotate (if annotate is true). */
  refs?: string[];
}

export interface HighlightOptions {
  /** Target: ref (@e3), selector, or semantic description. */
  target: string;
  /** Custom CSS for highlight overlay. */
  style?: string;
  /** Whether to persist the highlight (default: false). */
  persist?: boolean;
  /** Whether to hide the highlight (if target is omitted, hides all). */
  hide?: boolean;
}

export interface LocatorCandidate {
  kind: "role" | "label" | "placeholder" | "text" | "testid" | "css" | "xpath";
  value: string;
  confidence: "high" | "medium" | "low";
  reason: string;
}

// ── Section 27: File/Data Drop Options ─────────────────────────────────────

export interface DropOptions {
  /** Target: ref (@e3), selector, or semantic description. */
  target: string;
  /** Local file paths to drop. */
  files?: string[];
  /** MIME/value pairs for clipboard-like data drop (e.g., text/plain=hello). */
  data?: Array<{ mimeType: string; value: string }>;
}

// ── Browser Action Implementation ──────────────────────────────────────

export class BrowserActions {
  private readonly context: BrowserActionContext;
  private readonly refStore: RefStore;
  private readonly observabilityClients = new Map<string, Awaited<ReturnType<ReturnType<Page["context"]>["newCDPSession"]>>>();

  constructor(context: BrowserActionContext) {
    this.context = context;
    this.refStore = context.refStore ?? globalRefStore;
  }

  // ── Page Access ──────────────────────────────────────────────────────

  private getPage(): Page {
    const bm = this.context.sessionManager.getBrowserManager();
    const context = bm.getContext();
    if (context) {
      const pages = context.pages();
      if (pages.length > 0) return pages[0];
    }
    const browser = bm.getBrowser();
    if (browser) {
      const contexts = browser.contexts();
      if (contexts.length > 0) {
        const pages = contexts[0].pages();
        if (pages.length > 0) return pages[0];
      }
    }
    throw new Error("No active browser page. Use 'bc open <url>' or 'bc browser attach' first.");
  }

  private getPages(): Page[] {
    const bm = this.context.sessionManager.getBrowserManager();
    const context = bm.getContext();
    if (context) {
      const pages = context.pages();
      if (pages.length > 0) return pages;
    }
    const browser = bm.getBrowser();
    if (browser) {
      const contexts = browser.contexts();
      if (contexts.length > 0) {
        const pages = contexts[0].pages();
        if (pages.length > 0) return pages;
      }
    }
    return [];
  }

  private async getWindowTarget(page: Page): Promise<BrowserWindowTarget | null> {
    let client: Awaited<ReturnType<ReturnType<Page["context"]>["newCDPSession"]>> | undefined;
    try {
      client = await page.context().newCDPSession(page);
      const info = await client.send("Target.getTargetInfo") as { targetInfo?: { targetId?: string } };
      const targetId = info.targetInfo?.targetId;
      if (!targetId) return null;
      const windowInfo = await client.send("Browser.getWindowForTarget", { targetId }) as {
        windowId?: number;
      };
      if (typeof windowInfo.windowId !== "number") return null;
      return { page, targetId, windowId: windowInfo.windowId };
    } catch {
      return null;
    } finally {
      await client?.detach?.().catch(() => undefined);
    }
  }

  private async activateWindowTarget(target: BrowserWindowTarget): Promise<void> {
    let client: Awaited<ReturnType<ReturnType<Page["context"]>["newCDPSession"]>> | undefined;
    try {
      client = await target.page.context().newCDPSession(target.page);
      await client.send("Browser.setWindowBounds", {
        windowId: target.windowId,
        bounds: { windowState: "normal" },
      }).catch(() => undefined);
      await client.send("Target.activateTarget", { targetId: target.targetId }).catch(() => undefined);
    } catch {
      // Best-effort foregrounding only; Playwright bringToFront still follows.
    } finally {
      await client?.detach?.().catch(() => undefined);
    }
    await target.page.bringToFront().catch(() => undefined);
  }

  private async getWindowTargets(pages = this.getPages()): Promise<BrowserWindowTarget[]> {
    const targets: BrowserWindowTarget[] = [];
    for (const page of pages) {
      const target = await this.getWindowTarget(page);
      if (target) targets.push(target);
    }
    return targets;
  }

  private async getVisiblePages(pages = this.getPages()): Promise<Page[]> {
    const targets = await this.getWindowTargets(pages);
    return targets.length > 0 ? targets.map((target) => target.page) : pages;
  }

  private async getBestVisiblePage(preferred?: Page): Promise<Page> {
    const pages = this.getPages();
    const candidates = preferred ? [preferred, ...pages.filter((page) => page !== preferred)] : pages;
    const targets = await this.getWindowTargets(candidates);
    const target = targets[0];
    if (target) {
      await this.activateWindowTarget(target);
      return target.page;
    }
    if (preferred) return preferred;
    const fallback = pages[0];
    if (fallback) return fallback;
    return this.getPage();
  }

  /**
   * Ensure a browser is connected. Attempts attach → launch in sequence.
   * Returns the page on success, or a failure ActionResult if no browser
   * could be obtained.
   *
   * When a browser connection is established, also binds it into the
   * active session so that session state truthfully reflects browser binding.
   */
  private async ensureBrowserConnected(): Promise<Page | ActionResult<never>> {
    try {
      return this.getPage();
    } catch {
      // No browser connected — try to attach
      const bm = this.context.sessionManager.getBrowserManager();
      const sessionId = this.getSessionId();

      if (!bm.isConnected()) {
        const reconnected = typeof bm.reconnectActiveManaged === "function"
          ? await bm.reconnectActiveManaged()
          : false;
        if (reconnected) {
          this.bindBrowserToSession(bm);
        } else {
          try {
            await bm.attach({ actor: "human" });
            // Bind the browser connection into the session (Issue 3)
            this.bindBrowserToSession(bm);
          } catch {
            // Attach failed — try launching managed browser
            try {
              await bm.launchManaged({ actor: "human" });
              // Bind the browser connection into the session (Issue 3)
              this.bindBrowserToSession(bm);
            } catch (launchError: unknown) {
              const launchMsg = launchError instanceof Error ? launchError.message : String(launchError);
              return this.failureWithDebug(`No browser available and auto-launch failed: ${launchMsg}. Use 'bc browser attach' or 'bc browser launch' first.`, launchError, {
                action: "browser_connect",
                path: "a11y",
                sessionId,
              });
            }
          }
        }
      }
      return this.getPage();
    }
  }

  /**
   * Bind the current browser connection into the active session.
   * This ensures session state reflects the browser binding (Issue 3).
   */
  private bindBrowserToSession(bm: BrowserConnectionManager): void {
    const conn = bm.getConnection();
    const activeSession = this.context.sessionManager.getActiveSession();
    if (conn && activeSession) {
      this.context.sessionManager.bindBrowser(activeSession.id, conn.id);
    }
  }

  /**
   * Unbind the browser from the active session when the browser
   * is disconnected or closed (Issue 3).
   */
  private unbindBrowserFromSession(): void {
    const activeSession = this.context.sessionManager.getActiveSession();
    if (activeSession && activeSession.browserConnectionId) {
      this.context.sessionManager.unbindBrowser(activeSession.id);
    }
  }

  private getSessionId(): string {
    const session = this.context.sessionManager.getActiveSession();
    return session?.id ?? "default";
  }

  private tryGetPage(): Page | null {
    try {
      return this.getPage();
    } catch {
      return null;
    }
  }

  private async getConnectedPageForAction<T>(): Promise<Page | ActionResult<T>> {
    const pageOrErr = await this.ensureBrowserConnected();
    if ("success" in pageOrErr) return pageOrErr as ActionResult<T>;
    const page = await this.getBestVisiblePage(pageOrErr);
    await this.startObservability(page, this.getSessionId());
    return page;
  }

  private async startObservability(page: Page, sessionId: string): Promise<void> {
    if (this.observabilityClients.has(sessionId)) return;

    try {
      const client = await page.context().newCDPSession(page);
      await Promise.allSettled([
        client.send("Runtime.enable", {}),
        client.send("Console.enable", {}),
        client.send("Network.enable", {}),
      ]);
      const captureClient: ObservabilityCdpClient = {
        on: client.on.bind(client) as ObservabilityCdpClient["on"],
        off: client.off.bind(client) as ObservabilityCdpClient["off"],
        send: (method, params) => client.send(method as never, params as never),
      };
      getGlobalConsoleCapture().startCapture(sessionId, captureClient);
      getGlobalNetworkCapture({ captureSuccess: true }).startCapture(sessionId, captureClient);
      this.observabilityClients.set(sessionId, client);
    } catch (error: unknown) {
      log.warn(`Observability capture unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async persistObservability(sessionId: string, page?: Page, settleMs = 250): Promise<void> {
    try {
      await page?.waitForTimeout(settleMs).catch(() => undefined);
      const store = this.context.sessionManager.getMemoryStore();
      getGlobalConsoleCapture().persistToStore(store, sessionId);
      getGlobalNetworkCapture({ captureSuccess: true }).persistToStore(store, sessionId);
    } catch (error: unknown) {
      log.warn(`Observability persistence failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Record an action event to the screencast timeline (Section 26).
   * Errors in timeline recording must not break the original action.
   */
  private recordTimelineEvent(event: {
    action: string;
    target?: string;
    url?: string;
    title?: string;
    policyDecision?: string;
    risk?: string;
    durationMs?: number;
    artifactPath?: string;
    success?: boolean;
    error?: string;
  }): void {
    try {
      const store = this.context.sessionManager.getMemoryStore();
      const recorder = getGlobalScreencastRecorder(store);
      recorder.appendEvent({
        timestamp: new Date().toISOString(),
        ...event,
      });
    } catch (error) {
      // Silently fail - timeline errors must not break the original action
      log.debug(`Failed to record timeline event: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async closePage(page: Page): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const closePromise = page.close({ runBeforeUnload: false });
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Timed out waiting for browser tab to close")), 5_000);
        timer.unref?.();
      });
      await Promise.race([closePromise, timeoutPromise]);
    } catch (error: unknown) {
      await this.closePageViaCdp(page, error);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async closePageViaCdp(page: Page, originalError: unknown): Promise<void> {
    let client: Awaited<ReturnType<ReturnType<Page["context"]>["newCDPSession"]>> | undefined;
    try {
      client = await page.context().newCDPSession(page);
      const info = await client.send("Target.getTargetInfo") as { targetInfo?: { targetId?: string } };
      const targetId = info.targetInfo?.targetId;
      if (!targetId) throw new Error("CDP target id is unavailable");
      const result = await client.send("Target.closeTarget", { targetId }) as { success?: boolean };
      if (result.success === false) {
        throw new Error("CDP target close was rejected");
      }
      await page.waitForEvent("close", { timeout: 2_000 }).catch(() => undefined);
    } catch {
      throw originalError instanceof Error ? originalError : new Error(String(originalError));
    } finally {
      await client?.detach().catch(() => undefined);
    }
  }

  private async ensureScreenshotViewport(page: Page): Promise<void> {
    // Do NOT change the viewport for visible browsers (headful mode).
    // page.viewportSize() returns null for visible browsers - changing it would
    // mutate the real Chrome window layout (bug: forced 16:9 viewport).
    // For headless browsers, Playwright already sets an appropriate viewport.
    // Just ensure the page is brought to front for visibility.
    await page.bringToFront().catch(() => undefined);
  }

  private async failureWithDebug<T>(
    message: string,
    error: unknown,
    options: {
      action: string;
      path: ExecutionPath;
      sessionId: string;
      policyDecision?: PolicyDecision;
      risk?: RiskLevel;
      auditId?: string;
    },
  ): Promise<ActionResult<T>> {
    const debug = await collectFailureDebugMetadata({
      action: options.action,
      sessionId: options.sessionId,
      executionPath: options.path,
      error,
      page: this.tryGetPage(),
      store: this.context.sessionManager.getMemoryStore(),
      policyDecision: options.policyDecision,
      risk: options.risk,
    });
    return failureResult<T>(message, {
      path: options.path,
      sessionId: options.sessionId,
      policyDecision: options.policyDecision,
      risk: options.risk,
      auditId: options.auditId,
      ...debug,
    });
  }

  private isPathInside(childPath: string, parentPath: string, pathModule: typeof import("node:path")): boolean {
    const child = pathModule.resolve(childPath);
    const parent = pathModule.resolve(parentPath);
    const relative = pathModule.relative(parent, child);
    return relative === "" || (!relative.startsWith("..") && !pathModule.isAbsolute(relative));
  }

  private resolveScreenshotOutputPath(
    requestedPath: string | undefined,
    helpers: {
      path: typeof import("node:path");
      fs: typeof import("node:fs");
      getDataHome: () => string;
      getSessionScreenshotsDir: (sessionId: string) => string;
    },
  ): string {
    const sessionId = this.getSessionId();
    const outputDir = helpers.getSessionScreenshotsDir(sessionId);

    if (!requestedPath) {
      helpers.fs.mkdirSync(outputDir, { recursive: true });
      return helpers.path.join(outputDir, `screenshot-${Date.now()}.png`);
    }

    const activeSession = this.context.sessionManager.getActiveSession();
    const baseDir = activeSession?.workingDirectory ?? process.cwd();
    const resolvedPath = helpers.path.resolve(baseDir, requestedPath);
    const dataHome = helpers.getDataHome();

    if (
      activeSession?.workingDirectory
      && this.isPathInside(resolvedPath, activeSession.workingDirectory, helpers.path)
      && !this.isPathInside(resolvedPath, dataHome, helpers.path)
    ) {
      throw new Error(
        `Refusing to write screenshot inside the session working directory: ${resolvedPath}. ` +
        `Use the default runtime screenshots directory under ${outputDir}.`,
      );
    }

    return resolvedPath;
  }

  // ── Ref Resolution ──────────────────────────────────────────────────

  private async resolveTarget(target: string, page: Page): Promise<{ locator: import("playwright").Locator; description: string } | null> {
    // Check if target is a ref (@e3 or e3)
    const isRef = target.startsWith("@") || /^e\d+$/.test(target);
    if (isRef) {
      const pageId = getPageId(page.url(), this.getSessionId());
      const result = await resolveRefLocator(this.refStore, pageId, page, target);
      if (result) {
        return { locator: result.locator, description: result.description };
      }
      return null;
    }

    // Treat as a Playwright selector
    try {
      const locator = page.locator(target).first();
      const count = await locator.count();
      if (count > 0) {
        return { locator, description: `selector: ${target}` };
      }
    } catch {
      // Not a valid selector
    }

    // Try as a semantic text match
    const textLocator = page.getByText(target).first();
    const textCount = await textLocator.count();
    if (textCount > 0) {
      return { locator: textLocator, description: `text: ${target}` };
    }

    return null;
  }

  // ── Actions ─────────────────────────────────────────────────────────

  /**
   * Open a URL in the browser.
   *
   * If no browser is connected, this will attempt to attach to a
   * running browser on the configured debug port first. This is the
   * canonical first action — it should work as `bc open <url>`.
   */
  async open(options: OpenOptions): Promise<ActionResult<{ url: string; title: string }>> {
    const sessionId = this.getSessionId();
    const startTime = Date.now();

    // Section 14: resolve stable local URLs before navigation
    let resolvedUrl = options.url;
    const registry = this.context.serviceRegistry ?? globalServiceRegistry;
    if (mightBeServiceRef(options.url, registry)) {
      const resolveResult = await resolveServiceUrl(options.url, registry);
      if ("error" in resolveResult) {
        return this.failureWithDebug(resolveResult.error, new Error(resolveResult.error), {
          action: "browser_navigate",
          path: "a11y",
          sessionId,
        });
      }
      resolvedUrl = resolveResult.url;
      if (resolveResult.service) {
        log.info("Resolved service ref", { input: options.url, resolvedUrl, service: resolveResult.service.name });
      }
    }

    // Policy check — returns PolicyAllowResult on allow
    const policyEval = this.context.sessionManager.evaluateAction("browser_navigate", { url: resolvedUrl });
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<{ url: string; title: string }>;

    try {
      // Auto-attach if no browser is connected yet
      const pageOrErr = await this.ensureBrowserConnected();
      if ("success" in pageOrErr) return pageOrErr as ActionResult<{ url: string; title: string }>;
      const page = await this.getBestVisiblePage(pageOrErr as Page);

      await this.startObservability(page, sessionId);
      await page.goto(resolvedUrl, { waitUntil: options.waitUntil ?? "domcontentloaded" });
      await page.bringToFront().catch(() => undefined);
      const title = await page.title();
      await this.persistObservability(sessionId, page);

      log.info("Opened URL", { url: resolvedUrl, title, originalInput: options.url });

      // Record timeline event (Section 26)
      this.recordTimelineEvent({
        action: "open",
        target: resolvedUrl,
        url: page.url(),
        title,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        durationMs: Date.now() - startTime,
        success: true,
      });

      return successResult({ url: page.url(), title }, {
        path: policyEval.path,
        sessionId,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        auditId: policyEval.auditId,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`Failed to open URL: ${message}`);

      // Record timeline event (Section 26)
      this.recordTimelineEvent({
        action: "open",
        target: resolvedUrl,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        durationMs: Date.now() - startTime,
        success: false,
        error: message,
      });

      return this.failureWithDebug(`Failed to open ${options.url}: ${message}`, error, {
        action: "browser_navigate",
        path: policyEval.path,
        sessionId,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        auditId: policyEval.auditId,
      });
    }
  }

  /**
   * Take an accessibility snapshot of the current page.
   */
  async takeSnapshot(options: SnapshotOptions = {}): Promise<ActionResult<A11ySnapshot>> {
    const sessionId = this.getSessionId();
    const startTime = Date.now();

    // Snapshot is low-risk but still routes through policy for consistency
    const policyEval = this.context.sessionManager.evaluateAction("browser_snapshot", {});
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<A11ySnapshot>;

    try {
      const pageOrErr = await this.getConnectedPageForAction<A11ySnapshot>();
      if ("success" in pageOrErr) return pageOrErr;
      const page = pageOrErr;
      const snap = await snapshot(page, {
        sessionId,
        rootSelector: options.rootSelector,
        boxes: options.boxes,
      });

      // Store snapshot in ref store
      const pageId = getPageId(page.url(), sessionId);
      this.refStore.setSnapshot(pageId, snap);

      log.info("Snapshot taken", { elements: snap.elements.length, pageUrl: snap.pageUrl, boxes: options.boxes });
      await this.persistObservability(sessionId, page);

      this.recordTimelineEvent({
        action: "snapshot",
        url: page.url(),
        title: await page.title().catch(() => undefined),
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        durationMs: Date.now() - startTime,
        success: true,
      });

      return successResult(snap, {
        path: policyEval.path,
        sessionId,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        auditId: policyEval.auditId,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`Snapshot failed: ${message}`);
      this.recordTimelineEvent({
        action: "snapshot",
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        durationMs: Date.now() - startTime,
        success: false,
        error: message,
      });
      return this.failureWithDebug(`Snapshot failed: ${message}`, error, {
        action: "browser_snapshot",
        path: policyEval.path,
        sessionId,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        auditId: policyEval.auditId,
      });
    }
  }

  /**
   * Click a target element.
   */
  async click(options: ClickOptions): Promise<ActionResult<{ clicked: string }>> {
    const sessionId = this.getSessionId();
    const startTime = Date.now();

    // Policy check
    const policyEval = this.context.sessionManager.evaluateAction("browser_click", { target: options.target });
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<{ clicked: string }>;

    try {
      const pageOrErr = await this.getConnectedPageForAction<{ clicked: string }>();
      if ("success" in pageOrErr) return pageOrErr;
      const page = pageOrErr;
      const resolved = await this.resolveTarget(options.target, page);

      if (!resolved) {
        // Take a snapshot first to populate refs, then retry
        const snap = await snapshot(page, { sessionId });
        const pageId = getPageId(page.url(), sessionId);
        this.refStore.setSnapshot(pageId, snap);

        const retry = await this.resolveTarget(options.target, page);
        if (!retry) {
          this.recordTimelineEvent({
            action: "click",
            target: options.target,
            policyDecision: policyEval.policyDecision,
            risk: policyEval.risk,
            durationMs: Date.now() - startTime,
            success: false,
            error: `Could not resolve click target: ${options.target}`,
          });
          return this.failureWithDebug(`Could not resolve click target: ${options.target}`, new Error(`Could not resolve click target: ${options.target}`), {
            action: "browser_click",
            path: policyEval.path,
            sessionId,
            policyDecision: policyEval.policyDecision,
            risk: policyEval.risk,
            auditId: policyEval.auditId,
          });
        }
        await retry.locator.click({
          timeout: options.timeoutMs ?? 5000,
          force: options.force,
        });
        await this.persistObservability(sessionId, page);
        this.recordTimelineEvent({
          action: "click",
          target: options.target,
          url: page.url(),
          title: await page.title().catch(() => undefined),
          policyDecision: policyEval.policyDecision,
          risk: policyEval.risk,
          durationMs: Date.now() - startTime,
          success: true,
        });
        return successResult({ clicked: retry.description }, { path: policyEval.path, sessionId, policyDecision: policyEval.policyDecision, risk: policyEval.risk, auditId: policyEval.auditId });
      }

      await resolved.locator.click({
        timeout: options.timeoutMs ?? 5000,
        force: options.force,
      });

      log.info("Clicked element", { target: options.target });
      await this.persistObservability(sessionId, page);

      this.recordTimelineEvent({
        action: "click",
        target: options.target,
        url: page.url(),
        title: await page.title().catch(() => undefined),
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        durationMs: Date.now() - startTime,
        success: true,
      });

      return successResult({ clicked: resolved.description }, { path: policyEval.path, sessionId, policyDecision: policyEval.policyDecision, risk: policyEval.risk, auditId: policyEval.auditId });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.recordTimelineEvent({
        action: "click",
        target: options.target,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        durationMs: Date.now() - startTime,
        success: false,
        error: message,
      });
      return this.failureWithDebug(`Click failed for "${options.target}": ${message}`, error, {
        action: "browser_click",
        path: policyEval.path,
        sessionId,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        auditId: policyEval.auditId,
      });
    }
  }

  /**
   * Fill a target element with text.
   */
  async fill(options: FillOptions): Promise<ActionResult<{ filled: string }>> {
    const sessionId = this.getSessionId();
    const startTime = Date.now();

    // Policy check — fill with credentials is higher risk
    const policyEval = this.context.sessionManager.evaluateAction("browser_fill", { target: options.target, text: options.text });
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<{ filled: string }>;

    try {
      const pageOrErr = await this.getConnectedPageForAction<{ filled: string }>();
      if ("success" in pageOrErr) return pageOrErr;
      const page = pageOrErr;
      const resolved = await this.resolveTarget(options.target, page);

      if (!resolved) {
        const snap = await snapshot(page, { sessionId });
        const pageId = getPageId(page.url(), sessionId);
        this.refStore.setSnapshot(pageId, snap);

        const retry = await this.resolveTarget(options.target, page);
        if (!retry) {
          this.recordTimelineEvent({
            action: "fill",
            target: options.target,
            policyDecision: policyEval.policyDecision,
            risk: policyEval.risk,
            durationMs: Date.now() - startTime,
            success: false,
            error: `Could not resolve fill target: ${options.target}`,
          });
          return this.failureWithDebug(`Could not resolve fill target: ${options.target}`, new Error(`Could not resolve fill target: ${options.target}`), {
            action: "browser_fill",
            path: policyEval.path,
            sessionId,
            policyDecision: policyEval.policyDecision,
            risk: policyEval.risk,
            auditId: policyEval.auditId,
          });
        }
        await retry.locator.fill(options.text, { timeout: options.timeoutMs ? Number(options.timeoutMs) : 5000 });
        if (options.commit) await retry.locator.press("Tab");
        await this.persistObservability(sessionId, page);
        this.recordTimelineEvent({
          action: "fill",
          target: options.target,
          url: page.url(),
          title: await page.title().catch(() => undefined),
          policyDecision: policyEval.policyDecision,
          risk: policyEval.risk,
          durationMs: Date.now() - startTime,
          success: true,
        });
        return successResult({ filled: retry.description }, { path: policyEval.path, sessionId, policyDecision: policyEval.policyDecision, risk: policyEval.risk, auditId: policyEval.auditId });
      }

      await resolved.locator.fill(options.text, { timeout: options.timeoutMs ? Number(options.timeoutMs) : 5000 });
      if (options.commit) await resolved.locator.press("Tab");

      log.info("Filled element", { target: options.target });
      await this.persistObservability(sessionId, page);

      this.recordTimelineEvent({
        action: "fill",
        target: options.target,
        url: page.url(),
        title: await page.title().catch(() => undefined),
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        durationMs: Date.now() - startTime,
        success: true,
      });

      return successResult({ filled: resolved.description }, { path: policyEval.path, sessionId, policyDecision: policyEval.policyDecision, risk: policyEval.risk, auditId: policyEval.auditId });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.recordTimelineEvent({
        action: "fill",
        target: options.target,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        durationMs: Date.now() - startTime,
        success: false,
        error: message,
      });
      return this.failureWithDebug(`Fill failed for "${options.target}": ${message}`, error, {
        action: "browser_fill",
        path: policyEval.path,
        sessionId,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        auditId: policyEval.auditId,
      });
    }
  }

  /**
   * Hover over a target element.
   */
  async hover(options: HoverOptions): Promise<ActionResult<{ hovered: string }>> {
    const sessionId = this.getSessionId();
    const startTime = Date.now();

    const policyEval = this.context.sessionManager.evaluateAction("browser_hover", { target: options.target });
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<{ hovered: string }>;

    try {
      const pageOrErr = await this.getConnectedPageForAction<{ hovered: string }>();
      if ("success" in pageOrErr) return pageOrErr;
      const page = pageOrErr;
      const resolved = await this.resolveTarget(options.target, page);

      if (!resolved) {
        this.recordTimelineEvent({
          action: "hover",
          target: options.target,
          policyDecision: policyEval.policyDecision,
          risk: policyEval.risk,
          durationMs: Date.now() - startTime,
          success: false,
          error: `Could not resolve hover target: ${options.target}`,
        });
        return this.failureWithDebug(`Could not resolve hover target: ${options.target}`, new Error(`Could not resolve hover target: ${options.target}`), {
          action: "browser_hover",
          path: policyEval.path,
          sessionId,
          policyDecision: policyEval.policyDecision,
          risk: policyEval.risk,
          auditId: policyEval.auditId,
        });
      }

      await resolved.locator.hover({ timeout: options.timeoutMs ?? 5000 });
      await this.persistObservability(sessionId, page);

      this.recordTimelineEvent({
        action: "hover",
        target: options.target,
        url: page.url(),
        title: await page.title().catch(() => undefined),
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        durationMs: Date.now() - startTime,
        success: true,
      });

      return successResult({ hovered: resolved.description }, { path: policyEval.path, sessionId, policyDecision: policyEval.policyDecision, risk: policyEval.risk, auditId: policyEval.auditId });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.recordTimelineEvent({
        action: "hover",
        target: options.target,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        durationMs: Date.now() - startTime,
        success: false,
        error: message,
      });
      return this.failureWithDebug(`Hover failed for "${options.target}": ${message}`, error, {
        action: "browser_hover",
        path: policyEval.path,
        sessionId,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        auditId: policyEval.auditId,
      });
    }
  }

  /**
   * Type text into the currently focused element.
   */
  async type(options: TypeOptions): Promise<ActionResult<{ typed: string }>> {
    const sessionId = this.getSessionId();
    const startTime = Date.now();

    const policyEval = this.context.sessionManager.evaluateAction("browser_type", { text: options.text });
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<{ typed: string }>;

    try {
      const pageOrErr = await this.getConnectedPageForAction<{ typed: string }>();
      if ("success" in pageOrErr) return pageOrErr;
      const page = pageOrErr;
      await page.keyboard.type(options.text, { delay: options.delayMs ?? 0 });
      await this.persistObservability(sessionId, page);

      this.recordTimelineEvent({
        action: "type",
        target: options.text.substring(0, 50),
        url: page.url(),
        title: await page.title().catch(() => undefined),
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        durationMs: Date.now() - startTime,
        success: true,
      });

      return successResult({ typed: options.text }, { path: policyEval.path, sessionId, policyDecision: policyEval.policyDecision, risk: policyEval.risk, auditId: policyEval.auditId });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.recordTimelineEvent({
        action: "type",
        target: options.text.substring(0, 50),
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        durationMs: Date.now() - startTime,
        success: false,
        error: message,
      });
      return this.failureWithDebug(`Type failed: ${message}`, error, {
        action: "browser_type",
        path: policyEval.path,
        sessionId,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        auditId: policyEval.auditId,
      });
    }
  }

  /**
   * Press a keyboard key.
   */
  async press(options: PressOptions): Promise<ActionResult<{ pressed: string }>> {
    const sessionId = this.getSessionId();
    const startTime = Date.now();

    const policyEval = this.context.sessionManager.evaluateAction("browser_press", { key: options.key });
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<{ pressed: string }>;

    try {
      const pageOrErr = await this.getConnectedPageForAction<{ pressed: string }>();
      if ("success" in pageOrErr) return pageOrErr;
      const page = pageOrErr;
      await page.keyboard.press(options.key);
      await this.persistObservability(sessionId, page);

      this.recordTimelineEvent({
        action: "press",
        target: options.key,
        url: page.url(),
        title: await page.title().catch(() => undefined),
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        durationMs: Date.now() - startTime,
        success: true,
      });

      return successResult({ pressed: options.key }, { path: policyEval.path, sessionId, policyDecision: policyEval.policyDecision, risk: policyEval.risk, auditId: policyEval.auditId });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.recordTimelineEvent({
        action: "press",
        target: options.key,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        durationMs: Date.now() - startTime,
        success: false,
        error: message,
      });
      return this.failureWithDebug(`Press failed: ${message}`, error, {
        action: "browser_press",
        path: policyEval.path,
        sessionId,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        auditId: policyEval.auditId,
      });
    }
  }

  /**
   * Scroll in a direction.
   */
  async scroll(options: ScrollOptions): Promise<ActionResult<{ scrolled: string }>> {
    const sessionId = this.getSessionId();
    const startTime = Date.now();

    const policyEval = this.context.sessionManager.evaluateAction("browser_scroll", { direction: options.direction });
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<{ scrolled: string }>;

    try {
      const pageOrErr = await this.getConnectedPageForAction<{ scrolled: string; amount: number }>();
      if ("success" in pageOrErr) return pageOrErr;
      const page = pageOrErr;
      const amount = options.amount ?? 300;
      const delta = options.direction === "up" || options.direction === "left" ? -amount : amount;

      if (options.direction === "up" || options.direction === "down") {
        await page.mouse.wheel(0, delta);
      } else {
        await page.mouse.wheel(delta, 0);
      }
      await this.persistObservability(sessionId, page);

      this.recordTimelineEvent({
        action: "scroll",
        target: `${options.direction} ${amount}px`,
        url: page.url(),
        title: await page.title().catch(() => undefined),
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        durationMs: Date.now() - startTime,
        success: true,
      });

      return successResult({ scrolled: `${options.direction} ${amount}px` }, { path: policyEval.path, sessionId, policyDecision: policyEval.policyDecision, risk: policyEval.risk, auditId: policyEval.auditId });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.recordTimelineEvent({
        action: "scroll",
        target: options.direction,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        durationMs: Date.now() - startTime,
        success: false,
        error: message,
      });
      return this.failureWithDebug(`Scroll failed: ${message}`, error, {
        action: "browser_scroll",
        path: policyEval.path,
        sessionId,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        auditId: policyEval.auditId,
      });
    }
  }

  /**
   * Highlight a target element visually on the page.
   */
  async highlight(options: HighlightOptions): Promise<ActionResult<{ highlighted: string }>> {
    const sessionId = this.getSessionId();
    const startTime = Date.now();

    // Highlight is low-risk but still routes through policy
    const policyEval = this.context.sessionManager.evaluateAction("browser_highlight", { target: options.target });
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<{ highlighted: string }>;

    try {
      const pageOrErr = await this.getConnectedPageForAction<{ highlighted: string }>();
      if ("success" in pageOrErr) return pageOrErr;
      const page = pageOrErr;

      if (options.hide) {
        // Remove highlight overlay
        await page.evaluate(() => {
          const root = document.querySelector('[data-browser-control-highlight-root]');
          if (root) {
            root.remove();
          }
          // Also remove any orphaned highlight nodes
          document.querySelectorAll('[data-browser-control-highlight]').forEach(el => el.remove());
        });
        log.info("Highlight removed", { target: options.target });
        await this.persistObservability(sessionId, page);
        this.recordTimelineEvent({
          action: "highlight",
          target: options.target,
          url: page.url(),
          title: await page.title().catch(() => undefined),
          policyDecision: policyEval.policyDecision,
          risk: policyEval.risk,
          durationMs: Date.now() - startTime,
          success: true,
        });
        return successResult({ highlighted: options.target }, {
          path: policyEval.path,
          sessionId,
          policyDecision: policyEval.policyDecision,
          risk: policyEval.risk,
          auditId: policyEval.auditId,
        });
      }

      // Resolve target to get element bounds
      const resolved = await this.resolveTarget(options.target, page);
      if (!resolved) {
        // Try to take a snapshot first to populate refs
        const snap = await snapshot(page, { sessionId, boxes: true });
        const pageId = getPageId(page.url(), sessionId);
        this.refStore.setSnapshot(pageId, snap);

        const retry = await this.resolveTarget(options.target, page);
        if (!retry) {
          this.recordTimelineEvent({
            action: "highlight",
            target: options.target,
            policyDecision: policyEval.policyDecision,
            risk: policyEval.risk,
            durationMs: Date.now() - startTime,
            success: false,
            error: `Could not resolve highlight target: ${options.target}`,
          });
          return this.failureWithDebug(`Could not resolve highlight target: ${options.target}`, new Error(`Could not resolve highlight target: ${options.target}`), {
            action: "browser_highlight",
            path: policyEval.path,
            sessionId,
            policyDecision: policyEval.policyDecision,
            risk: policyEval.risk,
            auditId: policyEval.auditId,
          });
        }
        await this.injectHighlightOverlay(page, retry.locator, options.style, options.persist);
        await this.persistObservability(sessionId, page);
        this.recordTimelineEvent({
          action: "highlight",
          target: options.target,
          url: page.url(),
          title: await page.title().catch(() => undefined),
          policyDecision: policyEval.policyDecision,
          risk: policyEval.risk,
          durationMs: Date.now() - startTime,
          success: true,
        });
        return successResult({ highlighted: options.target }, {
          path: policyEval.path,
          sessionId,
          policyDecision: policyEval.policyDecision,
          risk: policyEval.risk,
          auditId: policyEval.auditId,
        });
      }

      await this.injectHighlightOverlay(page, resolved.locator, options.style, options.persist);
      log.info("Highlight injected", { target: options.target, persist: options.persist });
      await this.persistObservability(sessionId, page);

      this.recordTimelineEvent({
        action: "highlight",
        target: options.target,
        url: page.url(),
        title: await page.title().catch(() => undefined),
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        durationMs: Date.now() - startTime,
        success: true,
      });

      return successResult({ highlighted: options.target }, {
        path: policyEval.path,
        sessionId,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        auditId: policyEval.auditId,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.recordTimelineEvent({
        action: "highlight",
        target: options.target,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        durationMs: Date.now() - startTime,
        success: false,
        error: message,
      });
      return this.failureWithDebug(`Highlight failed for "${options.target}": ${message}`, error, {
        action: "browser_highlight",
        path: policyEval.path,
        sessionId,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        auditId: policyEval.auditId,
      });
    }
  }

  private async injectHighlightOverlay(
    page: Page,
    locator: import("playwright").Locator,
    customStyle?: string,
    persist = false,
  ): Promise<void> {
    const element = await locator.elementHandle();
    if (!element) return;

    const bounds = await element.boundingBox();
    if (!bounds) return;

    // Sanitize custom style - only allow safe CSS properties
    const safeStyleProperties = [
      'border', 'border-width', 'border-style', 'border-color',
      'background-color',
      'opacity', 'border-radius',
      'box-shadow', 'outline', 'outline-color', 'outline-width', 'outline-style'
    ];

    let sanitizedStyle = '';
    if (customStyle) {
      // Parse custom style and only allow safe properties
      const styleRules = customStyle.split(';').filter(rule => rule.trim());
      for (const rule of styleRules) {
        const colonIndex = rule.indexOf(':');
        if (colonIndex === -1) continue;
        const property = rule.slice(0, colonIndex).trim().toLowerCase();
        const value = rule.slice(colonIndex + 1).trim();
        if (safeStyleProperties.includes(property)) {
          sanitizedStyle += `${property}: ${value}; `;
        }
      }
    }

    // Default style if no custom style provided
    if (!sanitizedStyle) {
      sanitizedStyle = `
        border: 3px solid #ff0000;
        background-color: rgba(255, 0, 0, 0.2);
      `;
    }

    await page.evaluate(({ bounds: b, style: s, persist: p }) => {
      // Check if root container exists
      let root = document.querySelector('[data-browser-control-highlight-root]') as HTMLElement;
      if (!root) {
        root = document.createElement('div');
        root.setAttribute('data-browser-control-highlight-root', 'true');
        root.style.position = 'fixed';
        root.style.top = '0';
        root.style.left = '0';
        root.style.width = '100%';
        root.style.height = '100%';
        root.style.pointerEvents = 'none';
        root.style.zIndex = '2147483647';
        document.body.appendChild(root);
      }

      const overlay = document.createElement('div');
      overlay.setAttribute('data-browser-control-highlight', 'true');

      // Apply sanitized custom style first
      overlay.style.cssText = s;

      // Force safety constraints - these override any user-provided values
      overlay.style.position = 'absolute';
      overlay.style.pointerEvents = 'none';
      overlay.style.zIndex = '2147483647';
      overlay.style.left = `${b.x}px`;
      overlay.style.top = `${b.y}px`;
      overlay.style.width = `${b.width}px`;
      overlay.style.height = `${b.height}px`;
      overlay.textContent = p ? 'highlighted' : '';

      root.appendChild(overlay);

      // If not persisting, auto-remove after 5 seconds
      if (!p) {
        setTimeout(() => {
          overlay.remove();
          // Remove root if empty
          if (root.children.length === 0) {
            root.remove();
          }
        }, 5000);
      }
    }, { bounds, style: sanitizedStyle, persist });
  }

  /**
   * Generate stable locator candidates for a target element.
   */
  async generateLocator(target: string): Promise<ActionResult<{ candidates: LocatorCandidate[] }>> {
    const sessionId = this.getSessionId();

    // Locator generation is low-risk
    const policyEval = this.context.sessionManager.evaluateAction("browser_generate_locator", { target });
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<{ candidates: LocatorCandidate[] }>;

    try {
      const pageOrErr = await this.getConnectedPageForAction<{ candidates: LocatorCandidate[] }>();
      if ("success" in pageOrErr) return pageOrErr;
      const page = pageOrErr;

      // Check if target is a ref
      const isRef = target.startsWith("@") || /^e\d+$/.test(target);
      let element: A11yElement | undefined;

      if (isRef) {
        const pageId = getPageId(page.url(), sessionId);
        element = this.refStore.lookup(pageId, target);
        if (!element) {
          // Take a snapshot first to populate refs
          const snap = await snapshot(page, { sessionId });
          this.refStore.setSnapshot(pageId, snap);
          element = this.refStore.lookup(pageId, target);
        }
      } else {
        // Treat as selector/text and try to find element
        const resolved = await this.resolveTarget(target, page);
        if (resolved) {
          // Create a synthetic element from the locator
          const handle = await resolved.locator.elementHandle();
          if (handle) {
            element = await this.elementToA11yElement(page, handle, target);
          }
        }
      }

      if (!element) {
        return this.failureWithDebug(`Could not resolve locator target: ${target}`, new Error(`Could not resolve locator target: ${target}`), {
          action: "browser_generate_locator",
          path: policyEval.path,
          sessionId,
          policyDecision: policyEval.policyDecision,
          risk: policyEval.risk,
          auditId: policyEval.auditId,
        });
      }

      const candidates = this.generateLocatorCandidates(element);
      log.info("Generated locator candidates", { target, count: candidates.length });
      await this.persistObservability(sessionId, page);

      return successResult({ candidates }, {
        path: policyEval.path,
        sessionId,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        auditId: policyEval.auditId,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return this.failureWithDebug(`Locator generation failed for "${target}": ${message}`, error, {
        action: "browser_generate_locator",
        path: policyEval.path,
        sessionId,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        auditId: policyEval.auditId,
      });
    }
  }

  private async elementToA11yElement(page: Page, handle: import("playwright").ElementHandle, target: string): Promise<A11yElement> {
    const element: A11yElement = {
      ref: "e0",
      role: "unknown",
    };

    try {
      const attrs = await handle.evaluate((el) => {
        const elem = el as Element;
        const role = elem.getAttribute("role") || elem.tagName.toLowerCase();
        const name = elem.getAttribute("aria-label") || elem.getAttribute("title") || elem.textContent?.slice(0, 100) || "";
        const id = elem.id;
        const dataTestId = elem.getAttribute("data-testid");
        const dataTest = elem.getAttribute("data-test");
        const placeholder = elem.getAttribute("placeholder");
        const tag = elem.tagName.toLowerCase();
        return { role, name, id, dataTestId, dataTest, placeholder, tag };
      });

      element.role = attrs.role;
      element.name = attrs.name;
      element.selector = attrs.id ? `#${attrs.id}` :
        attrs.dataTestId ? `[data-testid="${attrs.dataTestId}"]` :
        attrs.dataTest ? `[data-test="${attrs.dataTest}"]` :
        target;
    } catch {
      // Use defaults if evaluation fails
    }

    return element;
  }

  private generateLocatorCandidates(element: A11yElement): LocatorCandidate[] {
    const candidates: LocatorCandidate[] = [];

    // 1. Role/name locator (highest confidence)
    if (element.role && element.name) {
      candidates.push({
        kind: "role",
        value: `getByRole("${element.role}", { name: "${this.escapeString(element.name)}" })`,
        confidence: "high",
        reason: "Semantic role with accessible name",
      });
    }

    // 2. Label/placeholder locator
    if (element.name) {
      candidates.push({
        kind: "label",
        value: `getByLabel("${this.escapeString(element.name)}")`,
        confidence: "high",
        reason: "Accessible name or label",
      });
    }

    // 3. Placeholder locator (for inputs)
    if (element.role === "textbox" || element.role === "searchbox") {
      const placeholder = element.name;
      if (placeholder) {
        candidates.push({
          kind: "placeholder",
          value: `getByPlaceholder("${this.escapeString(placeholder)}")`,
          confidence: "medium",
          reason: "Input placeholder text",
        });
      }
    }

    // 4. Text locator
    if (element.text) {
      candidates.push({
        kind: "text",
        value: `getByText("${this.escapeString(element.text)}")`,
        confidence: "medium",
        reason: "Visible text content",
      });
    }

    // 5. Test ID locator
    if (element.selector) {
      const testIdMatch = element.selector.match(/\[data-(?:test|testid)="([^"]+)"\]/);
      if (testIdMatch) {
        candidates.push({
          kind: "testid",
          value: `getByTestId("${testIdMatch[1]}")`,
          confidence: "high",
          reason: "Test ID attribute",
        });
      }
    }

    // 6. CSS selector (if specific enough)
    if (element.selector && this.isSpecificSelector(element.selector)) {
      candidates.push({
        kind: "css",
        value: `locator("${element.selector}")`,
        confidence: "medium",
        reason: "CSS selector",
      });
    }

    // 7. XPath (last resort, low confidence)
    if (element.name) {
      candidates.push({
        kind: "xpath",
        value: `xpath(\`//*[text()="${this.escapeString(element.name)}"]\`)`,
        confidence: "low",
        reason: "XPath fallback (brittle)",
      });
    }

    return candidates;
  }

  private isSpecificSelector(selector: string): boolean {
    // Reject generic tag-only selectors
    if (/^(button|a|input|div|span|p|li|tr|td|th)$/i.test(selector.trim())) {
      return false;
    }
    // Accept selectors with attributes
    return selector.includes("#") || selector.includes("[") || selector.includes(".");
  }

  private escapeString(str: string): string {
    return str.replace(/"/g, '\\"').replace(/\n/g, " ").trim().slice(0, 100);
  }

  /**
   * Take a screenshot.
   */
  async screenshot(options: ScreenshotOptions = {}): Promise<ActionResult<{ path: string; sizeBytes: number }>> {
    const sessionId = this.getSessionId();
    const startTime = Date.now();

    const policyEval = this.context.sessionManager.evaluateAction("screenshot", {});
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<{ path: string; sizeBytes: number }>;

    try {
      const pageOrErr = await this.getConnectedPageForAction<{ path: string; sizeBytes: number }>();
      if ("success" in pageOrErr) return pageOrErr;
      const page = pageOrErr;
      const fs = await import("node:fs");
      const path = await import("node:path");
      const { getDataHome, getSessionScreenshotsDir } = await import("../shared/paths");

      const outputPath = this.resolveScreenshotOutputPath(options.outputPath, {
        path,
        fs,
        getDataHome,
        getSessionScreenshotsDir,
      });
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      const tempPath = `${outputPath}.tmp-${process.pid}-${Date.now()}.png`;

      // Handle annotation: inject temporary overlays before screenshot
      let annotationInjected = false;
      if (options.annotate) {
        annotationInjected = await this.injectAnnotationOverlays(page, options.refs);
      }

      try {
        if (options.target) {
          const resolved = await this.resolveTarget(options.target, page);
          if (resolved) {
            await resolved.locator.screenshot({ path: tempPath });
          } else {
            await this.capturePageScreenshot(page, tempPath, options.fullPage ?? false);
          }
        } else {
          await this.capturePageScreenshot(page, tempPath, options.fullPage ?? false);
        }
      } finally {
        // Clean up annotation overlays if they were injected
        if (annotationInjected) {
          await this.removeAnnotationOverlays(page);
        }
      }

      if (fs.existsSync(outputPath)) fs.rmSync(outputPath, { force: true });
      fs.renameSync(tempPath, outputPath);
      const stats = fs.statSync(outputPath);
      await this.persistObservability(sessionId, page);

      this.recordTimelineEvent({
        action: "screenshot",
        target: options.target,
        url: page.url(),
        title: await page.title().catch(() => undefined),
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        durationMs: Date.now() - startTime,
        success: true,
        artifactPath: outputPath,
      });

      return successResult({ path: outputPath, sizeBytes: stats.size }, { path: policyEval.path, sessionId, policyDecision: policyEval.policyDecision, risk: policyEval.risk, auditId: policyEval.auditId });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.recordTimelineEvent({
        action: "screenshot",
        target: options.target,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        durationMs: Date.now() - startTime,
        success: false,
        error: message,
      });
      return this.failureWithDebug(`Screenshot failed: ${message}`, error, {
        action: "screenshot",
        path: policyEval.path,
        sessionId,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        auditId: policyEval.auditId,
      });
    }
  }

  private async injectAnnotationOverlays(page: Page, refs?: string[]): Promise<boolean> {
    try {
      // Ensure we have a snapshot with bounds
      const sessionId = this.getSessionId();
      const snap = await snapshot(page, { sessionId, boxes: true });
      const pageId = getPageId(page.url(), sessionId);
      this.refStore.setSnapshot(pageId, snap);

      const elementsToAnnotate = refs
        ? refs.map(r => this.refStore.lookup(pageId, r)).filter((e): e is A11yElement => e !== undefined)
        : snap.elements.filter(e => INTERACTIVE_ROLES.has(e.role) || e.role === "heading");

      if (elementsToAnnotate.length === 0) return false;

      await page.evaluate((elements) => {
        // Create root container
        let root = document.querySelector('[data-browser-control-annotation-root]') as HTMLElement;
        if (!root) {
          root = document.createElement('div');
          root.setAttribute('data-browser-control-annotation-root', 'true');
          root.style.position = 'fixed';
          root.style.top = '0';
          root.style.left = '0';
          root.style.width = '100%';
          root.style.height = '100%';
          root.style.pointerEvents = 'none';
          root.style.zIndex = '2147483647';
          document.body.appendChild(root);
        }

        // Add overlay for each element
        for (const el of elements) {
          if (!el.bounds) continue;
          const overlay = document.createElement('div');
          overlay.setAttribute('data-browser-control-annotation', 'true');
          overlay.style.cssText = `
            position: absolute;
            border: 2px solid #00ff00;
            background-color: rgba(0, 255, 0, 0.1);
            pointer-events: none;
            z-index: 2147483647;
            font-size: 10px;
            color: #00ff00;
            padding: 1px;
            white-space: nowrap;
            left: ${el.bounds.x}px;
            top: ${el.bounds.y}px;
            width: ${el.bounds.width}px;
            height: ${el.bounds.height}px;
          `;
          overlay.textContent = el.ref;
          root.appendChild(overlay);
        }
      }, elementsToAnnotate);

      return true;
    } catch {
      return false;
    }
  }

  private async removeAnnotationOverlays(page: Page): Promise<void> {
    try {
      await page.evaluate(() => {
        const root = document.querySelector('[data-browser-control-annotation-root]');
        if (root) {
          root.remove();
        }
      });
    } catch {
      // Ignore cleanup errors
    }
  }

  private async capturePageScreenshot(page: Page, outputPath: string, fullPage: boolean): Promise<void> {
    await this.ensureScreenshotViewport(page);
    try {
      await page.screenshot({ path: outputPath, fullPage, timeout: 30_000 });
      const fs = await import("node:fs");
      if (fs.existsSync(outputPath) && fs.statSync(outputPath).size >= 512) {
        return;
      }
      await this.capturePageScreenshotViaCdp(page, outputPath, fullPage);
      return;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("Timeout")) throw error;

      await this.capturePageScreenshotViaCdp(page, outputPath, fullPage);
    }
  }

  private async capturePageScreenshotViaCdp(page: Page, outputPath: string, fullPage: boolean): Promise<void> {
    const fs = await import("node:fs");
    let client: Awaited<ReturnType<ReturnType<Page["context"]>["newCDPSession"]>> | undefined;
    try {
      client = await page.context().newCDPSession(page);
      const result = await client.send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: fullPage,
      });
      fs.writeFileSync(outputPath, Buffer.from(result.data, "base64"));
    } finally {
      await client?.detach().catch(() => undefined);
    }
  }

  /**
   * List browser tabs.
   */
  async tabList(): Promise<ActionResult<Array<{ id: string; url: string; title: string }>>> {
    const sessionId = this.getSessionId();

    // Route through policy for consistency (Issue 2)
    const policyEval = this.context.sessionManager.evaluateAction("browser_tab_list", {});
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<Array<{ id: string; url: string; title: string }>>;

    try {
      const pageOrErr = await this.getConnectedPageForAction<Array<{ id: string; url: string; title: string }>>();
      if ("success" in pageOrErr) return pageOrErr;
      const page = pageOrErr;
      const context = page.context();
      const pages = await this.getVisiblePages(context.pages());

      const tabs = await Promise.all(pages.map(async (p, i) => ({
        id: String(i),
        url: p.url(),
        title: await p.title().catch(() => ""),
      })));
      await this.persistObservability(sessionId, page);

      return successResult(tabs, { path: policyEval.path, sessionId, policyDecision: policyEval.policyDecision, risk: policyEval.risk, auditId: policyEval.auditId });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return this.failureWithDebug(`Tab list failed: ${message}`, error, {
        action: "browser_tab_list",
        path: policyEval.path,
        sessionId,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        auditId: policyEval.auditId,
      });
    }
  }

  /**
   * Switch to a browser tab by index.
   */
  async tabSwitch(tabId: string): Promise<ActionResult<{ activeTab: string }>> {
    const sessionId = this.getSessionId();

    // Route through policy for consistency (Issue 2)
    const policyEval = this.context.sessionManager.evaluateAction("browser_tab_switch", { tabId });
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<{ activeTab: string }>;

    try {
      const pageOrErr = await this.getConnectedPageForAction<{ activeTab: string }>();
      if ("success" in pageOrErr) return pageOrErr;
      const page = pageOrErr;
      const context = page.context();
      const rawPages = context.pages();
      const windowTargets = await this.getWindowTargets(rawPages);
      const pages = windowTargets.length > 0 ? windowTargets.map((target) => target.page) : rawPages;
      const index = parseInt(tabId, 10);

      if (index < 0 || index >= pages.length) {
        return this.failureWithDebug(`Tab index ${tabId} out of range (0..${pages.length - 1})`, new Error(`Tab index ${tabId} out of range (0..${pages.length - 1})`), {
          action: "browser_tab_switch",
          path: policyEval.path,
          sessionId,
          policyDecision: policyEval.policyDecision,
          risk: policyEval.risk,
          auditId: policyEval.auditId,
        });
      }

      const windowTarget = windowTargets.find((target) => target.page === pages[index]);
      if (windowTarget) {
        await this.activateWindowTarget(windowTarget);
      } else {
        await pages[index].bringToFront();
      }
      await this.persistObservability(sessionId, pages[index]);

      return successResult({ activeTab: tabId }, { path: policyEval.path, sessionId, policyDecision: policyEval.policyDecision, risk: policyEval.risk, auditId: policyEval.auditId });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return this.failureWithDebug(`Tab switch failed: ${message}`, error, {
        action: "browser_tab_switch",
        path: policyEval.path,
        sessionId,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        auditId: policyEval.auditId,
      });
    }
  }

  /**
   * Close the current browser tab without ending the browser lifecycle.
   */
  async tabClose(): Promise<ActionResult<{ closed: boolean }>> {
    const sessionId = this.getSessionId();

    const policyEval = this.context.sessionManager.evaluateAction("browser_tab_close", {});
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<{ closed: boolean }>;

    try {
      const pageOrErr = await this.getConnectedPageForAction<{ closed: true }>();
      if ("success" in pageOrErr) return pageOrErr;
      const page = pageOrErr;
      await this.persistObservability(sessionId, page);
      await this.closePage(page);

      return successResult({ closed: true }, { path: policyEval.path, sessionId, policyDecision: policyEval.policyDecision, risk: policyEval.risk, auditId: policyEval.auditId });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return this.failureWithDebug(`Tab close failed: ${message}`, error, {
        action: "browser_tab_close",
        path: policyEval.path,
        sessionId,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        auditId: policyEval.auditId,
      });
    }
  }

  /**
   * Close the browser lifecycle for the active Browser Control session.
   *
   * Managed browsers are terminated. Attached browsers are detached rather
   * than killed by BrowserConnectionManager.disconnect().
   */
  async close(): Promise<ActionResult<{ closed: boolean }>> {
    const sessionId = this.getSessionId();

    const policyEval = this.context.sessionManager.evaluateAction("browser_close", {});
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<{ closed: boolean }>;

    try {
      const bm = this.context.sessionManager.getBrowserManager();
      await bm.disconnect();
      this.unbindBrowserFromSession();

      return successResult({ closed: true }, { path: policyEval.path, sessionId, policyDecision: policyEval.policyDecision, risk: policyEval.risk, auditId: policyEval.auditId });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return this.failureWithDebug(`Browser close failed: ${message}`, error, {
        action: "browser_close",
        path: policyEval.path,
        sessionId,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        auditId: policyEval.auditId,
      });
    }
  }

  // ── Screencast (Section 26) ───────────────────────────────────────────────

  /**
   * Start a browser screencast recording.
   */
  async screencastStart(options: ScreencastOptions = {}): Promise<ActionResult<{ session: ScreencastSession }>> {
    const sessionId = this.getSessionId();

    // Route through policy (moderate risk)
    const policyEval = this.context.sessionManager.evaluateAction("browser_screencast_start", options as Record<string, unknown>);
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<{ session: ScreencastSession }>;

    try {
      const pageOrErr = await this.getConnectedPageForAction<{ session: ScreencastSession }>();
      if ("success" in pageOrErr) return pageOrErr;
      const page = pageOrErr;

      const browserSessionId = sessionId;
      const pageId = getPageId(page.url(), sessionId);
      const store = this.context.sessionManager.getMemoryStore();
      const recorder = getGlobalScreencastRecorder(store);

      const session = await recorder.start({
        browserSessionId,
        pageId,
        options,
        page: {
          url: () => page.url(),
          title: () => page.title(),
          screenshot: (opts) => page.screenshot(opts),
          evaluate: (fn) => page.evaluate(fn),
        },
      });

      return successResult({ session }, { path: policyEval.path, sessionId, policyDecision: policyEval.policyDecision, risk: policyEval.risk, auditId: policyEval.auditId });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return this.failureWithDebug(`Screencast start failed: ${message}`, error, {
        action: "browser_screencast_start",
        path: policyEval.path,
        sessionId,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        auditId: policyEval.auditId,
      });
    }
  }

  /**
   * Stop the current screencast recording.
   */
  async screencastStop(): Promise<ActionResult<{ session: ScreencastSession; receiptId?: string; timelinePath?: string }>> {
    const sessionId = this.getSessionId();

    // Route through policy (low/moderate risk)
    const policyEval = this.context.sessionManager.evaluateAction("browser_screencast_stop", {});
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<{ session: ScreencastSession; receiptId?: string; timelinePath?: string }>;

    try {
      const store = this.context.sessionManager.getMemoryStore();
      const recorder = getGlobalScreencastRecorder(store);
      const result = await recorder.stop(true);

      return successResult({
        session: result.session,
        receiptId: result.receipt?.receiptId,
        timelinePath: result.timelinePath,
      }, { path: policyEval.path, sessionId, policyDecision: policyEval.policyDecision, risk: policyEval.risk, auditId: policyEval.auditId });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return this.failureWithDebug(`Screencast stop failed: ${message}`, error, {
        action: "browser_screencast_stop",
        path: policyEval.path,
        sessionId,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        auditId: policyEval.auditId,
      });
    }
  }

  /**
   * Get the current screencast status.
   */
  async screencastStatus(): Promise<ActionResult<{ session: ScreencastSession | null }>> {
    const sessionId = this.getSessionId();

    // Route through policy (low risk)
    const policyEval = this.context.sessionManager.evaluateAction("browser_screencast_status", {});
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<{ session: ScreencastSession | null }>;

    try {
      const store = this.context.sessionManager.getMemoryStore();
      const recorder = getGlobalScreencastRecorder(store);
      const session = recorder.status();

      return successResult({ session }, { path: policyEval.path, sessionId, policyDecision: policyEval.policyDecision, risk: policyEval.risk, auditId: policyEval.auditId });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return this.failureWithDebug(`Screencast status failed: ${message}`, error, {
        action: "browser_screencast_status",
        path: policyEval.path,
        sessionId,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        auditId: policyEval.auditId,
      });
    }
  }

  // ── Section 27: File/Data Drop ───────────────────────────────────────────

  /**
   * Drop files or data onto a page element.
   *
   * Supports file drop (local files) and data drop (MIME/value pairs like text/plain).
   * Routes through policy as browser_drop_file or browser_drop_data.
   */
  async drop(options: DropOptions): Promise<ActionResult<BrowserDropResult>> {
    const sessionId = this.getSessionId();
    const startTime = Date.now();
    const page = this.tryGetPage();
    if (!page) {
      return failureResult("No active page", { path: "a11y", sessionId });
    }

    // Determine policy action based on what's being dropped
    const hasFiles = options.files && options.files.length > 0;
    const hasData = options.data && options.data.length > 0;

    if (!hasFiles && !hasData) {
      return failureResult("Drop requires either files or data", { path: "a11y", sessionId });
    }

    // Route through policy (moderate/high risk for files, moderate for data)
    const policyAction = hasFiles ? "browser_drop_file" : "browser_drop_data";
    const policyEval = this.context.sessionManager.evaluateAction(policyAction, {});
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<BrowserDropResult>;

    try {
      // Resolve target selector
      const targetResult = await this.resolveTarget(options.target, page);
      if (!targetResult) {
        this.recordTimelineEvent({
          action: "drop",
          target: options.target,
          policyDecision: policyEval.policyDecision,
          risk: policyEval.risk,
          durationMs: Date.now() - startTime,
          success: false,
          error: `Could not resolve target: ${options.target}`,
        });
        return failureResult(`Could not resolve target: ${options.target}`, {
          path: policyEval.path,
          sessionId,
          policyDecision: policyEval.policyDecision,
          risk: policyEval.risk,
          auditId: policyEval.auditId,
        });
      }

      const droppedFiles: Array<{ path: string; sizeBytes: number }> = [];
      const droppedData: Array<{ mimeType: string; value: string }> = [];

      // Handle file drop - use locator directly
      if (hasFiles && options.files) {
        for (const filePath of options.files) {
          try {
            const absolutePath = validateFilePath(filePath);
            const sizeBytes = getFileSize(filePath);
            // Use Playwright's setInputFiles for file inputs
            await targetResult.locator.setInputFiles(absolutePath);
            droppedFiles.push({ path: absolutePath, sizeBytes });
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            log.warn(`Failed to drop file ${filePath}: ${message}`);
            this.recordTimelineEvent({
              action: "drop",
              target: options.target,
              policyDecision: policyEval.policyDecision,
              risk: policyEval.risk,
              durationMs: Date.now() - startTime,
              success: false,
              error: `Failed to drop file ${filePath}: ${message}`,
            });
            return failureResult(`Failed to drop file ${filePath}: ${message}`, {
              path: policyEval.path,
              sessionId,
              policyDecision: policyEval.policyDecision,
              risk: policyEval.risk,
              auditId: policyEval.auditId,
            });
          }
        }
      }

      // Handle data drop - use element handle directly
      if (hasData && options.data) {
        const elementHandle = await targetResult.locator.elementHandle();
        if (!elementHandle) {
          this.recordTimelineEvent({
            action: "drop",
            target: options.target,
            policyDecision: policyEval.policyDecision,
            risk: policyEval.risk,
            durationMs: Date.now() - startTime,
            success: false,
            error: `Could not get element handle for target: ${options.target}`,
          });
          return failureResult(`Could not get element handle for target: ${options.target}`, {
            path: policyEval.path,
            sessionId,
            policyDecision: policyEval.policyDecision,
            risk: policyEval.risk,
            auditId: policyEval.auditId,
          });
        }

        for (const dataItem of options.data) {
          try {
            // Dispatch drag events with DataTransfer using element handle
            await elementHandle.evaluate(
              (el: Element, { mimeType, value }: { mimeType: string; value: string }) => {
                // Create DataTransfer with the data
                const dt = new DataTransfer();
                dt.setData(mimeType, value);

                // Dispatch drag events
                el.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: dt }));
                el.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
                el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
              },
              { mimeType: dataItem.mimeType, value: dataItem.value },
            );
            droppedData.push({ mimeType: dataItem.mimeType, value: dataItem.value });
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            log.warn(`Failed to drop data (${dataItem.mimeType}): ${message}`);
            this.recordTimelineEvent({
              action: "drop",
              target: options.target,
              policyDecision: policyEval.policyDecision,
              risk: policyEval.risk,
              durationMs: Date.now() - startTime,
              success: false,
              error: `Failed to drop data (${dataItem.mimeType}): ${message}`,
            });
            return failureResult(`Failed to drop data (${dataItem.mimeType}): ${message}`, {
              path: policyEval.path,
              sessionId,
              policyDecision: policyEval.policyDecision,
              risk: policyEval.risk,
              auditId: policyEval.auditId,
            });
          }
        }
      }

      const result: BrowserDropResult = {
        success: true,
        files: droppedFiles.length > 0 ? droppedFiles : undefined,
        // Redact data values for privacy - only keep mimeType and length
        data: droppedData.length > 0 ? droppedData.map(d => ({
          mimeType: d.mimeType,
          value: `[REDACTED: ${d.value.length} characters]`,
        })) : undefined,
      };

      this.recordTimelineEvent({
        action: "drop",
        target: options.target,
        url: page.url(),
        title: await page.title().catch(() => undefined),
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        durationMs: Date.now() - startTime,
        success: true,
      });

      return successResult(result, {
        path: policyEval.path,
        sessionId,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        auditId: policyEval.auditId,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.recordTimelineEvent({
        action: "drop",
        target: options.target,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        durationMs: Date.now() - startTime,
        success: false,
        error: message,
      });
      return this.failureWithDebug(`Drop failed: ${message}`, error, {
        action: policyAction,
        path: policyEval.path,
        sessionId,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        auditId: policyEval.auditId,
      });
    }
  }

  // ── Section 27: Downloads List ───────────────────────────────────────────

  /**
   * List recent downloads for the current session.
   *
   * Returns structured download information from the session downloads directory.
   * Routes through policy as browser_downloads_list (low risk).
   */
  async downloadsList(): Promise<ActionResult<ExtendedDownloadResult[]>> {
    const sessionId = this.getSessionId();

    // Route through policy (low risk)
    const policyEval = this.context.sessionManager.evaluateAction("browser_downloads_list", {});
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<ExtendedDownloadResult[]>;

    try {
      const downloadsDir = getSessionDownloadsDir(sessionId);
      const helpers = { fs, path };

      // Ensure downloads directory exists
      if (!helpers.fs.existsSync(downloadsDir)) {
        return successResult([], {
          path: policyEval.path,
          sessionId,
          policyDecision: policyEval.policyDecision,
          risk: policyEval.risk,
          auditId: policyEval.auditId,
        });
      }

      // Read files in downloads directory
      const entries = helpers.fs.readdirSync(downloadsDir);
      const downloads: ExtendedDownloadResult[] = [];

      for (const entry of entries) {
        const fullPath = helpers.path.join(downloadsDir, entry);
        try {
          const stats = helpers.fs.statSync(fullPath);
          if (stats.isFile()) {
            downloads.push({
              url: "", // URL is not persisted in current implementation
              suggestedFilename: entry,
              path: fullPath,
              sizeBytes: stats.size,
              status: "completed",
            });
          }
        } catch {
          // Skip files that can't be read
          continue;
        }
      }

      // Sort by modification time (most recent first)
      downloads.sort((a, b) => {
        const aTime = a.path ? helpers.fs.statSync(a.path).mtimeMs : 0;
        const bTime = b.path ? helpers.fs.statSync(b.path).mtimeMs : 0;
        return bTime - aTime;
      });

      return successResult(downloads, {
        path: policyEval.path,
        sessionId,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        auditId: policyEval.auditId,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return this.failureWithDebug(`Downloads list failed: ${message}`, error, {
        action: "browser_downloads_list",
        path: policyEval.path,
        sessionId,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        auditId: policyEval.auditId,
      });
    }
  }

  // ── Action Timeline (Section 26) ──────────────────────────────────────────

  /**
   * Record an action event to the timeline if screencast is active.
   */
  private async recordActionTimeline(
    action: string,
    options: { target?: string; success?: boolean; error?: string; durationMs?: number },
  ): Promise<void> {
    const recorder = getGlobalScreencastRecorder();
    const session = recorder.status();
    if (!session) return;

    const page = this.tryGetPage();
    const event: ActionReceiptEvent = {
      timestamp: new Date().toISOString(),
      action,
      target: options.target,
      url: page?.url(),
      title: page ? await page.title().catch(() => undefined) : undefined,
      durationMs: options.durationMs,
      success: options.success,
      error: options.error,
    };

    recorder.appendEvent(event);
  }

  /**
   * Helper to wrap action execution with timeline recording.
   * Timeline errors are swallowed to not break the action.
   */
  private async withTimeline<T>(
    action: string,
    target: string | undefined,
    fn: () => Promise<T>,
  ): Promise<T> {
    const startTime = Date.now();
    let result: T;
    let error: string | undefined;

    try {
      result = await fn();
      return result;
    } catch (e: unknown) {
      error = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      try {
        const durationMs = Date.now() - startTime;
        await this.recordActionTimeline(action, {
          target,
          success: !error,
          error,
          durationMs,
        });
      } catch {
        // Swallow timeline errors to not break the action
      }
    }
  }
}
