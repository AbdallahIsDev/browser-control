/**
 * Browser Control — Top-level TypeScript API facade.
 *
 * This module provides `createBrowserControl(...)`, which returns a single
 * object with namespaced action methods for browser, terminal, filesystem,
 * and session operations.  The CLI and any future MCP wrapper (Section 7)
 * both call through this same surface.
 *
 * Usage:
 *   const bc = createBrowserControl();
 *   await bc.browser.open({ url: "https://example.com" });
 *   const snap = await bc.browser.snapshot();
 *   await bc.terminal.exec({ command: "ls" });
 *   const file = await bc.fs.read({ path: "/tmp/data.json" });
 */

import { isPolicyAllowed, SessionManager, type SessionState, type SessionListEntry } from "./session_manager";
import { DefaultPolicyEngine } from "./policy/engine";
import { BrowserActions, type SnapshotOptions, type ClickOptions, type FillOptions, type HoverOptions, type TypeOptions, type PressOptions, type ScrollOptions, type ScreenshotOptions, type HighlightOptions, type LocatorCandidate, type BrowserActionContext, type DropOptions } from "./browser/actions";
import { TerminalActions, type TerminalActionContext } from "./terminal/actions";
import { FsActions, type FsActionContext } from "./filesystem/actions";
import { ServiceActions, type ServiceActionContext } from "./service_actions";
import type { ActionResult } from "./shared/action_result";
import type { A11ySnapshot } from "./a11y_snapshot";
import type { ExecResult, TerminalSnapshot } from "./terminal/types";
import type {
  FileReadResult,
  FileWriteResult,
  ListResult,
  MoveResult,
  DeleteResult,
  FileStatResult,
} from "./filesystem/operations";
import type { ServiceEntry } from "./services/registry";
import { ServiceRegistry } from "./services/registry";
import type { ProviderListResult, ProviderSelectionResult } from "./providers/types";
import {
  getConfigEntries,
  getConfigValue,
  setUserConfigValue,
  type ConfigEntry,
  type ConfigSetResult,
} from "./shared/config";
import { collectStatus } from "./operator/status";
import type { SystemStatus } from "./operator/types";
import type { ScreencastOptions, ScreencastSession, DebugReceipt } from "./observability/types";
import type { AttachableBrowser, BrowserDetachResult, BrowserDropResult } from "./browser/connection";
import type { ExtendedDownloadResult } from "./browser/file_helpers";

// ── Options ──────────────────────────────────────────────────────────

export interface BrowserControlOptions {
  /** Policy profile name (default: from config). */
  policyProfile?: string;
  /** Working directory for filesystem context. */
  workingDirectory?: string;
  /** Memory store instance (for testing / dependency injection). */
  memoryStore?: import("./runtime/memory_store").MemoryStore;
}

// ── Screencast Namespace (Section 26) ─────────────────────────────────────

export interface ScreencastNamespace {
  start(options?: ScreencastOptions): Promise<ActionResult<{ session: ScreencastSession }>>;
  stop(): Promise<ActionResult<{ session: ScreencastSession; receiptId?: string; timelinePath?: string }>>;
  status(): Promise<ActionResult<{ session: ScreencastSession | null }>>;
}

// ── Browser Namespace ────────────────────────────────────────────────

export interface BrowserNamespace {
  open(options: { url: string; waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit" }): Promise<ActionResult<{ url: string; title: string }>>;
  snapshot(options?: { rootSelector?: string; boxes?: boolean }): Promise<ActionResult<A11ySnapshot>>;
  click(options: { target: string; timeoutMs?: number; force?: boolean }): Promise<ActionResult<{ clicked: string }>>;
  fill(options: { target: string; text: string; timeoutMs?: number; commit?: boolean }): Promise<ActionResult<{ filled: string }>>;
  hover(options: { target: string; timeoutMs?: number }): Promise<ActionResult<{ hovered: string }>>;
  type(options: { text: string; delayMs?: number }): Promise<ActionResult<{ typed: string }>>;
  press(options: { key: string }): Promise<ActionResult<{ pressed: string }>>;
  scroll(options: { direction: "up" | "down" | "left" | "right"; amount?: number }): Promise<ActionResult<{ scrolled: string }>>;
  screenshot(options?: { outputPath?: string; fullPage?: boolean; target?: string; annotate?: boolean; refs?: string[] }): Promise<ActionResult<{ path: string; sizeBytes: number }>>;
  highlight(options: HighlightOptions): Promise<ActionResult<{ highlighted: string }>>;
  generateLocator(target: string): Promise<ActionResult<{ candidates: LocatorCandidate[] }>>;
  tabList(): Promise<ActionResult<Array<{ id: string; url: string; title: string }>>>;
  tabSwitch(tabId: string): Promise<ActionResult<{ activeTab: string }>>;
  tabClose(): Promise<ActionResult<{ closed: boolean }>>;
  close(): Promise<ActionResult<{ closed: boolean }>>;
  provider: ProviderNamespace;
  /** Screencast recording namespace (Section 26). */
  screencast: ScreencastNamespace;
  /** Section 27: Browser discovery and attach UX. */
  list(options?: { all?: boolean }): Promise<ActionResult<AttachableBrowser[]>>;
  /** Section 27: Explicit attach to CDP endpoint. */
  attach(options: { cdp?: string; endpoint?: string; port?: number; targetType?: string }): Promise<ActionResult<{ attached: boolean; endpoint: string }>>;
  /** Section 27: Clean detach without closing attached browsers. */
  detach(): Promise<ActionResult<BrowserDetachResult>>;
  /** Section 27: Drop files or data onto page elements. */
  drop(options: DropOptions): Promise<ActionResult<BrowserDropResult>>;
  /** Section 27: List recent downloads. */
  downloads: {
    list(): Promise<ActionResult<ExtendedDownloadResult[]>>;
  };
}

// ── Terminal Namespace ───────────────────────────────────────────────

export interface TerminalNamespace {
  open(options?: { shell?: string; cwd?: string; name?: string }): Promise<ActionResult<{ id: string; shell: string; cwd: string; status: string }>>;
  exec(options: { command: string; sessionId?: string; timeoutMs?: number }): Promise<ActionResult<ExecResult>>;
  type(options: { text: string; sessionId: string }): Promise<ActionResult<{ typed: string }>>;
  read(options: { sessionId: string; maxBytes?: number }): Promise<ActionResult<{ output: string }>>;
  snapshot(options?: { sessionId?: string }): Promise<ActionResult<TerminalSnapshot | TerminalSnapshot[]>>;
  interrupt(options: { sessionId: string }): Promise<ActionResult<{ interrupted: boolean }>>;
  close(options: { sessionId: string }): Promise<ActionResult<{ closed: boolean }>>;
  /** Resume a terminal session from persisted state (Section 13). */
  resume(options: { sessionId: string }): Promise<ActionResult<unknown>>;
  /** Get resume status for a terminal session (Section 13). */
  status(options: { sessionId: string }): Promise<ActionResult<unknown>>;
}

// ── FS Namespace ─────────────────────────────────────────────────────

export interface FsNamespace {
  read(options: { path: string; maxBytes?: number }): Promise<ActionResult<FileReadResult>>;
  write(options: { path: string; content: string; createDirs?: boolean }): Promise<ActionResult<FileWriteResult>>;
  ls(options: { path: string; recursive?: boolean; extension?: string }): Promise<ActionResult<ListResult>>;
  move(options: { src: string; dst: string }): Promise<ActionResult<MoveResult>>;
  rm(options: { path: string; recursive?: boolean; force?: boolean }): Promise<ActionResult<DeleteResult>>;
  stat(options: { path: string }): Promise<ActionResult<FileStatResult>>;
}

// ── Service Namespace ─────────────────────────────────────────────────

export interface ServiceNamespace {
  register(options: { name: string; port: number; protocol?: "http" | "https"; path?: string }): Promise<ActionResult<ServiceEntry>>;
  list(): ActionResult<ServiceEntry[]>;
  resolve(options: { name: string }): Promise<ActionResult<{ url: string; service?: ServiceEntry }>>;
  remove(options: { name: string }): ActionResult<{ removed: boolean }>;
}

// ── Session Namespace ─────────────────────────────────────────────────

export interface SessionNamespace {
  create(name: string, options?: { policyProfile?: string; workingDirectory?: string }): Promise<ActionResult<SessionState>>;
  list(): ActionResult<SessionListEntry[]>;
  use(nameOrId: string): ActionResult<SessionState>;
  status(nameOrId?: string): ActionResult<SessionState>;
}

// ── Provider Namespace ────────────────────────────────────────────────

export interface ProviderNamespace {
  list(): ProviderListResult;
  use(name: string): ActionResult<ProviderSelectionResult>;
  getActive(): string;
}

// ── Debug Namespace (Section 10) ──────────────────────────────────────

export interface DebugNamespace {
  /** Run health checks across all components. */
  health(options?: { port?: number }): Promise<import("./runtime/health_check").HealthReport>;
  /** Get a debug bundle by ID. */
  bundle(bundleId: string): import("./observability/debug_bundle").DebugBundle | null;
  /** Get captured console entries for a session. */
  console(options?: { sessionId?: string }): import("./observability/types").ConsoleEntry[];
  /** Get captured network entries for a session. */
  network(options?: { sessionId?: string }): import("./observability/types").NetworkEntry[];
  /** List available debug bundles. */
  listBundles(): Array<{ bundleId: string; taskId: string; assembledAt: string; partial: boolean }>;
  /** Get a debug receipt by ID (Section 26). */
  receipt(receiptId: string): DebugReceipt | null;
}

// ── Config Namespace ──────────────────────────────────────────────────

export interface ConfigNamespace {
  list(): ConfigEntry[];
  get(key: string): ConfigEntry;
  set(key: string, value: unknown): ActionResult<ConfigSetResult>;
}

// ── Dashboard Namespace (Section 28) ──────────────────────────────────

export interface DashboardNamespace {
  status(): Promise<import("./operator/dashboard").DashboardState>;
}

// ── Unified API Object ────────────────────────────────────────────────

export interface BrowserControlAPI {
  browser: BrowserNamespace;
  terminal: TerminalNamespace;
  fs: FsNamespace;
  session: SessionNamespace;
  service: ServiceNamespace;
  provider: ProviderNamespace;
  /** Debug and observability namespace (Section 10). */
  debug: DebugNamespace;
  /** Runtime configuration namespace (Section 11). */
  config: ConfigNamespace;
  /** Dashboard and UI rendering namespace (Section 28). */
  dashboard: DashboardNamespace;
  /** Collect operator-facing system status (Section 11). */
  status(): Promise<SystemStatus>;
  /** Access the underlying session manager for advanced use. */
  readonly sessionManager: SessionManager;
  /** Access the underlying browser actions instance. */
  readonly browserActions: BrowserActions;
  /** Access the underlying terminal actions instance. */
  readonly terminalActions: TerminalActions;
  /** Access the underlying fs actions instance. */
  readonly fsActions: FsActions;
  /** Access the underlying service actions instance. */
  readonly serviceActions: ServiceActions;
  /**
   * Close the BrowserControl instance and release all held resources.
   *
   * This is critical for process lifecycle management: after calling
   * terminal.open() (which is daemon-backed), the SessionManager's
   * MemoryStore keeps a SQLite handle alive that prevents the Node.js
   * event loop from exiting. Calling close() releases that handle so
   * the process can exit cleanly.
   *
   * Call this at the end of any short-lived script that uses the API.
   */
  close(): void;
}

// ── Factory ──────────────────────────────────────────────────────────

/**
 * Create a Browser Control API instance.
 *
 * This is the main entry point for the programmatic TypeScript API.
 * The returned object provides namespaced action methods that route
 * through policy, return ActionResult, and bind to a unified session.
 *
 * Section 7 (MCP) will wrap this exact object 1:1.
 */
export function createBrowserControl(options: BrowserControlOptions = {}): BrowserControlAPI {
  // If a policy profile was specified, create a policy engine with that profile
  const policyEngine = options.policyProfile
    ? new DefaultPolicyEngine({ profileName: options.policyProfile })
    : undefined;

  const sessionManager = new SessionManager({
    memoryStore: options.memoryStore,
    policyEngine,
  });

  // ── Pre-warm daemon runtime (optional optimization) ─────────────
  // TerminalActions.ensureDaemonRuntimeReady() probes the daemon before
  // every session-dependent action, so this fire-and-forget call is NOT
  // a correctness requirement — it's a pre-warm that may settle the
  // broker runtime cache before the first terminal action, saving an
  // HTTP round-trip on that first call.  If it hasn't settled yet,
  // ensureDaemonRuntimeReady() will handle it.
  sessionManager.ensureDaemonRuntime({ autoStart: false }).catch(() => {
    // Ignore — pre-warm failed, ensureDaemonRuntimeReady() will retry
  });

  const sharedRegistry = new ServiceRegistry();

  const browserCtx: BrowserActionContext = { sessionManager, serviceRegistry: sharedRegistry };
  // Terminal actions use autoStartDaemon: true so that persistent terminal
  // sessions (open, read, type, etc.) are daemon-backed, aligning the API
  // with the CLI ownership model. This prevents the API process from
  // hanging after terminal.open() due to an in-process PTY.
  const terminalCtx: TerminalActionContext = { sessionManager, autoStartDaemon: true };
  const fsCtx: FsActionContext = { sessionManager };
  const serviceCtx: ServiceActionContext = { sessionManager, registry: sharedRegistry };

  const browserActions = new BrowserActions(browserCtx);
  const terminalActions = new TerminalActions(terminalCtx);
  const fsActions = new FsActions(fsCtx);
  const serviceActions = new ServiceActions(serviceCtx);

  const requireDebugPolicy = (action: string, params: Record<string, unknown> = {}) => {
    const policyEval = sessionManager.evaluateAction(action, params);
    if (!isPolicyAllowed(policyEval)) {
      throw new Error(policyEval.error ?? `Policy blocked ${action}`);
    }
    return policyEval;
  };

  const providerNamespace: ProviderNamespace = {
    list: () => sessionManager.getBrowserManager().getProviderRegistry().list(),
    use: (name) => {
      const policyEval = sessionManager.evaluateAction("browser_provider_use", { name });
      if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<ProviderSelectionResult>;
      const result = sessionManager.getBrowserManager().getProviderRegistry().select(name);
      return {
        success: result.success,
        path: policyEval.path,
        sessionId: sessionManager.getActiveSession()?.id ?? "default",
        data: result,
        ...(result.error ? { error: result.error } : {}),
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        ...(policyEval.auditId ? { auditId: policyEval.auditId } : {}),
        completedAt: new Date().toISOString(),
      };
    },
    getActive: () => sessionManager.getBrowserManager().getProviderRegistry().getActiveName(),
  };
  const configNamespace: ConfigNamespace = {
    list: () => getConfigEntries({ validate: false }),
    get: (key) => getConfigValue(key, { validate: false }),
    set: (key, value) => {
      const policyEval = sessionManager.evaluateAction("config_set", { key, value });
      if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<ConfigSetResult>;
      const result = setUserConfigValue(key, value);
      return {
        success: true,
        path: policyEval.path,
        sessionId: sessionManager.getActiveSession()?.id ?? "default",
        data: result,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        ...(policyEval.auditId ? { auditId: policyEval.auditId } : {}),
        completedAt: new Date().toISOString(),
      };
    },
  };

  const debugNamespace: DebugNamespace = {
    health: async (options = {}) => {
      requireDebugPolicy("debug_health", options);
      const { HealthCheck } = await import("./runtime/health_check");
      const healthCheck = new HealthCheck({
        port: options.port,
        memoryStore: sessionManager.getMemoryStore(),
      });
      return healthCheck.runExtended();
    },
    bundle: (bundleId) => {
      requireDebugPolicy("debug_bundle_export", { bundleId });
      const { loadDebugBundle } = require("./observability/debug_bundle");
      return loadDebugBundle(bundleId, sessionManager.getMemoryStore());
    },
    console: (options = {}) => {
      requireDebugPolicy("debug_console_read", options);
      const { getGlobalConsoleCapture } = require("./observability/console_capture");
      const capture = getGlobalConsoleCapture();
      return capture.getEntries(options.sessionId ?? "default");
    },
    network: (options = {}) => {
      requireDebugPolicy("debug_network_read", options);
      const { getGlobalNetworkCapture } = require("./observability/network_capture");
      const capture = getGlobalNetworkCapture();
      return capture.getEntries(options.sessionId ?? "default");
    },
    listBundles: () => {
      requireDebugPolicy("debug_bundle_export", { list: true });
      const { listDebugBundles } = require("./observability/debug_bundle");
      return listDebugBundles(sessionManager.getMemoryStore());
    },
    receipt: (receiptId) => {
      requireDebugPolicy("debug_receipt_export", { receiptId });
      const { getGlobalScreencastRecorder } = require("./observability/screencast");
      const recorder = getGlobalScreencastRecorder(sessionManager.getMemoryStore());
      return recorder.loadReceipt(receiptId);
    },
  };

  const screencastNamespace: ScreencastNamespace = {
    start: (options) => browserActions.screencastStart(options),
    stop: () => browserActions.screencastStop(),
    status: () => browserActions.screencastStatus(),
  };

  return {
    browser: {
      open: (o) => browserActions.open(o),
      snapshot: (o) => browserActions.takeSnapshot(o),
      click: (o) => browserActions.click(o),
      fill: (o) => browserActions.fill(o),
      hover: (o) => browserActions.hover(o),
      type: (o) => browserActions.type(o),
      press: (o) => browserActions.press(o),
      scroll: (o) => browserActions.scroll(o),
      screenshot: (o) => browserActions.screenshot(o),
      highlight: (o) => browserActions.highlight(o),
      generateLocator: (target) => browserActions.generateLocator(target),
      tabList: () => browserActions.tabList(),
      tabSwitch: (id) => browserActions.tabSwitch(id),
      tabClose: () => browserActions.tabClose(),
      close: () => browserActions.close(),
      provider: providerNamespace,
      screencast: screencastNamespace,
      // Section 27: Browser discovery and attach UX
      list: async (options) => {
        const policyEval = sessionManager.evaluateAction("browser_list", options ?? {});
        if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<AttachableBrowser[]>;
        const localProvider = new (await import("./providers/local")).LocalBrowserProvider();
        const browsers = await localProvider.discoverBrowsers(options);
        return {
          success: true,
          path: policyEval.path,
          sessionId: sessionManager.getActiveSession()?.id ?? "default",
          policyDecision: policyEval.policyDecision,
          risk: policyEval.risk,
          auditId: policyEval.auditId,
          data: browsers,
          completedAt: new Date().toISOString(),
        };
      },
      attach: async (options) => {
        const bm = sessionManager.getBrowserManager();
        const cdpUrl = options.cdp ?? options.endpoint;
        const result = await bm.attach({
          cdpUrl,
          port: options.port,
          targetType: options.targetType as any,
        });
        return {
          success: true,
          path: "a11y",
          sessionId: sessionManager.getActiveSession()?.id ?? "default",
          data: { attached: true, endpoint: result.cdpEndpoint },
          completedAt: new Date().toISOString(),
        };
      },
      detach: async () => {
        const policyEval = sessionManager.evaluateAction("browser_detach", {});
        if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<BrowserDetachResult>;
        const bm = sessionManager.getBrowserManager();
        const result = await bm.detach();
        return {
          success: result.detached,
          path: policyEval.path,
          sessionId: sessionManager.getActiveSession()?.id ?? "default",
          policyDecision: policyEval.policyDecision,
          risk: policyEval.risk,
          auditId: policyEval.auditId,
          data: result,
          completedAt: new Date().toISOString(),
        };
      },
      drop: (options) => browserActions.drop(options),
      downloads: {
        list: () => browserActions.downloadsList(),
      },
    },
    terminal: {
      open: (o) => terminalActions.open(o),
      exec: (o) => terminalActions.exec(o),
      type: (o) => terminalActions.type(o),
      read: (o) => terminalActions.read(o),
      snapshot: (o) => terminalActions.snapshot(o),
      interrupt: (o) => terminalActions.interrupt(o),
      close: (o) => terminalActions.close(o),
      resume: (o) => terminalActions.resume(o),
      status: (o) => terminalActions.status(o),
    },
    fs: {
      read: (o) => fsActions.read(o),
      write: (o) => fsActions.write(o),
      ls: (o) => fsActions.ls(o),
      move: (o) => fsActions.move(o),
      rm: (o) => fsActions.rm(o),
      stat: (o) => fsActions.stat(o),
    },
    session: {
      create: (name, o) => sessionManager.create(name, o),
      list: () => sessionManager.list(),
      use: (nameOrId) => sessionManager.use(nameOrId),
      status: (nameOrId) => sessionManager.status(nameOrId),
    },
    service: {
      register: (o) => serviceActions.register(o),
      list: () => serviceActions.list(),
      resolve: (o) => serviceActions.resolve(o),
      remove: (o) => serviceActions.remove(o),
    },
    provider: providerNamespace,
    debug: debugNamespace,
    config: configNamespace,
    dashboard: {
      status: async () => {
        const { getDashboardState } = await import("./operator/dashboard");
        return getDashboardState();
      }
    },
    status: () => collectStatus(),
    get sessionManager() { return sessionManager; },
    get browserActions() { return browserActions; },
    get terminalActions() { return terminalActions; },
    get fsActions() { return fsActions; },
    get serviceActions() { return serviceActions; },
    close() { sessionManager.close(); },
  };
}
