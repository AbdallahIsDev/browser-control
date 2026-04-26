/**
 * Browser Actions — High-level browser action surface for Browser Control.
 *
 * Implements the canonical browser actions:
 *   open, snapshot, click, fill, hover, type, press, scroll, screenshot,
 *   tab list, tab switch, close
 *
 * Uses:
 *   - Section 8 browser connection/session layer
 *   - Section 6 snapshot/ref/query layer
 *   - Section 4 policy routing
 *   - ActionResult as the unified result contract
 */

import type { Page } from "playwright";
import { snapshot, type A11ySnapshot } from "../a11y_snapshot";
import { RefStore, getPageId, resolveRefLocator } from "../ref_store";
import { globalRefStore } from "./core";
import { BrowserConnectionManager } from "./connection";
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
import type { ExecutionPath, PolicyDecision, RiskLevel } from "../policy/types";

const log = logger.withComponent("browser_actions");

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
}

// ── Browser Action Implementation ──────────────────────────────────────

export class BrowserActions {
  private readonly context: BrowserActionContext;
  private readonly refStore: RefStore;

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
      const page = pageOrErr as Page;

      await page.goto(resolvedUrl, { waitUntil: options.waitUntil ?? "domcontentloaded" });
      const title = await page.title();

      log.info("Opened URL", { url: resolvedUrl, title, originalInput: options.url });

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

    // Snapshot is low-risk but still routes through policy for consistency
    const policyEval = this.context.sessionManager.evaluateAction("browser_snapshot", {});
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<A11ySnapshot>;

    try {
      const page = this.getPage();
      const snap = await snapshot(page, {
        sessionId,
        rootSelector: options.rootSelector,
      });

      // Store snapshot in ref store
      const pageId = getPageId(page.url(), sessionId);
      this.refStore.setSnapshot(pageId, snap);

      log.info("Snapshot taken", { elements: snap.elements.length, pageUrl: snap.pageUrl });

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

    // Policy check
    const policyEval = this.context.sessionManager.evaluateAction("browser_click", { target: options.target });
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<{ clicked: string }>;

    try {
      const page = this.getPage();
      const resolved = await this.resolveTarget(options.target, page);

      if (!resolved) {
        // Take a snapshot first to populate refs, then retry
        const snap = await snapshot(page, { sessionId });
        const pageId = getPageId(page.url(), sessionId);
        this.refStore.setSnapshot(pageId, snap);

        const retry = await this.resolveTarget(options.target, page);
        if (!retry) {
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
        return successResult({ clicked: retry.description }, { path: policyEval.path, sessionId, policyDecision: policyEval.policyDecision, risk: policyEval.risk, auditId: policyEval.auditId });
      }

      await resolved.locator.click({
        timeout: options.timeoutMs ?? 5000,
        force: options.force,
      });

      log.info("Clicked element", { target: options.target });

      return successResult({ clicked: resolved.description }, { path: policyEval.path, sessionId, policyDecision: policyEval.policyDecision, risk: policyEval.risk, auditId: policyEval.auditId });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
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

    // Policy check — fill with credentials is higher risk
    const policyEval = this.context.sessionManager.evaluateAction("browser_fill", { target: options.target, text: options.text });
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<{ filled: string }>;

    try {
      const page = this.getPage();
      const resolved = await this.resolveTarget(options.target, page);

      if (!resolved) {
        const snap = await snapshot(page, { sessionId });
        const pageId = getPageId(page.url(), sessionId);
        this.refStore.setSnapshot(pageId, snap);

        const retry = await this.resolveTarget(options.target, page);
        if (!retry) {
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
        return successResult({ filled: retry.description }, { path: policyEval.path, sessionId, policyDecision: policyEval.policyDecision, risk: policyEval.risk, auditId: policyEval.auditId });
      }

      await resolved.locator.fill(options.text, { timeout: options.timeoutMs ? Number(options.timeoutMs) : 5000 });
      if (options.commit) await resolved.locator.press("Tab");

      log.info("Filled element", { target: options.target });

      return successResult({ filled: resolved.description }, { path: policyEval.path, sessionId, policyDecision: policyEval.policyDecision, risk: policyEval.risk, auditId: policyEval.auditId });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
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

    const policyEval = this.context.sessionManager.evaluateAction("browser_hover", { target: options.target });
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<{ hovered: string }>;

    try {
      const page = this.getPage();
      const resolved = await this.resolveTarget(options.target, page);

      if (!resolved) {
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

      return successResult({ hovered: resolved.description }, { path: policyEval.path, sessionId, policyDecision: policyEval.policyDecision, risk: policyEval.risk, auditId: policyEval.auditId });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
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

    const policyEval = this.context.sessionManager.evaluateAction("browser_type", { text: options.text });
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<{ typed: string }>;

    try {
      const page = this.getPage();
      await page.keyboard.type(options.text, { delay: options.delayMs ?? 0 });

      return successResult({ typed: options.text }, { path: policyEval.path, sessionId, policyDecision: policyEval.policyDecision, risk: policyEval.risk, auditId: policyEval.auditId });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
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

    const policyEval = this.context.sessionManager.evaluateAction("browser_press", { key: options.key });
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<{ pressed: string }>;

    try {
      const page = this.getPage();
      await page.keyboard.press(options.key);

      return successResult({ pressed: options.key }, { path: policyEval.path, sessionId, policyDecision: policyEval.policyDecision, risk: policyEval.risk, auditId: policyEval.auditId });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
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

    const policyEval = this.context.sessionManager.evaluateAction("browser_scroll", { direction: options.direction });
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<{ scrolled: string }>;

    try {
      const page = this.getPage();
      const amount = options.amount ?? 300;
      const delta = options.direction === "up" || options.direction === "left" ? -amount : amount;

      if (options.direction === "up" || options.direction === "down") {
        await page.mouse.wheel(0, delta);
      } else {
        await page.mouse.wheel(delta, 0);
      }

      return successResult({ scrolled: `${options.direction} ${amount}px` }, { path: policyEval.path, sessionId, policyDecision: policyEval.policyDecision, risk: policyEval.risk, auditId: policyEval.auditId });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
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
   * Take a screenshot.
   */
  async screenshot(options: ScreenshotOptions = {}): Promise<ActionResult<{ path: string; sizeBytes: number }>> {
    const sessionId = this.getSessionId();

    const policyEval = this.context.sessionManager.evaluateAction("screenshot", {});
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<{ path: string; sizeBytes: number }>;

    try {
      const page = this.getPage();
      const fs = await import("node:fs");
      const path = await import("node:path");
      const { getReportsDir } = await import("../shared/paths");

      const outputDir = getReportsDir();
      fs.mkdirSync(outputDir, { recursive: true });
      const outputPath = options.outputPath ?? path.join(outputDir, `screenshot-${Date.now()}.png`);

      if (options.target) {
        const resolved = await this.resolveTarget(options.target, page);
        if (resolved) {
          await resolved.locator.screenshot({ path: outputPath });
        } else {
          await page.screenshot({ path: outputPath, fullPage: options.fullPage ?? false });
        }
      } else {
        await page.screenshot({ path: outputPath, fullPage: options.fullPage ?? false });
      }

      const stats = fs.statSync(outputPath);

      return successResult({ path: outputPath, sizeBytes: stats.size }, { path: policyEval.path, sessionId, policyDecision: policyEval.policyDecision, risk: policyEval.risk, auditId: policyEval.auditId });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
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

  /**
   * List browser tabs.
   */
  async tabList(): Promise<ActionResult<Array<{ id: string; url: string; title: string }>>> {
    const sessionId = this.getSessionId();

    // Route through policy for consistency (Issue 2)
    const policyEval = this.context.sessionManager.evaluateAction("browser_tab_list", {});
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<Array<{ id: string; url: string; title: string }>>;

    try {
      const page = this.getPage();
      const context = page.context();
      const pages = context.pages();

      const tabs = pages.map((p, i) => ({
        id: String(i),
        url: p.url(),
        title: "", // Will be populated asynchronously if needed
      }));

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
      const page = this.getPage();
      const context = page.context();
      const pages = context.pages();
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

      await pages[index].bringToFront();

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
   * Close the current browser tab.
   */
  async close(): Promise<ActionResult<{ closed: boolean }>> {
    const sessionId = this.getSessionId();

    const policyEval = this.context.sessionManager.evaluateAction("browser_close", {});
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<{ closed: boolean }>;

    try {
      const page = this.getPage();
      await page.close();

      // Unbind browser from session when the tab is closed (Issue 3)
      this.unbindBrowserFromSession();

      return successResult({ closed: true }, { path: policyEval.path, sessionId, policyDecision: policyEval.policyDecision, risk: policyEval.risk, auditId: policyEval.auditId });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return this.failureWithDebug(`Close failed: ${message}`, error, {
        action: "browser_close",
        path: policyEval.path,
        sessionId,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        auditId: policyEval.auditId,
      });
    }
  }
}
