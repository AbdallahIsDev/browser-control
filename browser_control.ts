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

import { SessionManager, type SessionState, type SessionListEntry } from "./session_manager";
import { DefaultPolicyEngine } from "./policy_engine";
import { BrowserActions, type BrowserActionContext } from "./browser_actions";
import { TerminalActions, type TerminalActionContext } from "./terminal_actions";
import { FsActions, type FsActionContext } from "./fs_actions";
import type { ActionResult } from "./action_result";
import type { A11ySnapshot } from "./a11y_snapshot";
import type { ExecResult, TerminalSnapshot } from "./terminal_types";
import type {
  FileReadResult,
  FileWriteResult,
  ListResult,
  MoveResult,
  DeleteResult,
  FileStatResult,
} from "./fs_operations";

// ── Options ──────────────────────────────────────────────────────────

export interface BrowserControlOptions {
  /** Policy profile name (default: from config). */
  policyProfile?: string;
  /** Working directory for filesystem context. */
  workingDirectory?: string;
  /** Memory store instance (for testing / dependency injection). */
  memoryStore?: import("./memory_store").MemoryStore;
}

// ── Browser Namespace ────────────────────────────────────────────────

export interface BrowserNamespace {
  open(options: { url: string; waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit" }): Promise<ActionResult<{ url: string; title: string }>>;
  snapshot(options?: { rootSelector?: string }): Promise<ActionResult<A11ySnapshot>>;
  click(options: { target: string; timeoutMs?: number; force?: boolean }): Promise<ActionResult<{ clicked: string }>>;
  fill(options: { target: string; text: string; timeoutMs?: number; commit?: boolean }): Promise<ActionResult<{ filled: string }>>;
  hover(options: { target: string; timeoutMs?: number }): Promise<ActionResult<{ hovered: string }>>;
  type(options: { text: string; delayMs?: number }): Promise<ActionResult<{ typed: string }>>;
  press(options: { key: string }): Promise<ActionResult<{ pressed: string }>>;
  scroll(options: { direction: "up" | "down" | "left" | "right"; amount?: number }): Promise<ActionResult<{ scrolled: string }>>;
  screenshot(options?: { outputPath?: string; fullPage?: boolean; target?: string }): Promise<ActionResult<{ path: string; sizeBytes: number }>>;
  tabList(): Promise<ActionResult<Array<{ id: string; url: string; title: string }>>>;
  tabSwitch(tabId: string): Promise<ActionResult<{ activeTab: string }>>;
  close(): Promise<ActionResult<{ closed: boolean }>>;
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

// ── Session Namespace ─────────────────────────────────────────────────

export interface SessionNamespace {
  create(name: string, options?: { policyProfile?: string; workingDirectory?: string }): Promise<ActionResult<SessionState>>;
  list(): ActionResult<SessionListEntry[]>;
  use(nameOrId: string): ActionResult<SessionState>;
  status(): ActionResult<SessionState>;
}

// ── Unified API Object ────────────────────────────────────────────────

export interface BrowserControlAPI {
  browser: BrowserNamespace;
  terminal: TerminalNamespace;
  fs: FsNamespace;
  session: SessionNamespace;
  /** Access the underlying session manager for advanced use. */
  readonly sessionManager: SessionManager;
  /** Access the underlying browser actions instance. */
  readonly browserActions: BrowserActions;
  /** Access the underlying terminal actions instance. */
  readonly terminalActions: TerminalActions;
  /** Access the underlying fs actions instance. */
  readonly fsActions: FsActions;
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

  const browserCtx: BrowserActionContext = { sessionManager };
  // Terminal actions use autoStartDaemon: true so that persistent terminal
  // sessions (open, read, type, etc.) are daemon-backed, aligning the API
  // with the CLI ownership model. This prevents the API process from
  // hanging after terminal.open() due to an in-process PTY.
  const terminalCtx: TerminalActionContext = { sessionManager, autoStartDaemon: true };
  const fsCtx: FsActionContext = { sessionManager };

  const browserActions = new BrowserActions(browserCtx);
  const terminalActions = new TerminalActions(terminalCtx);
  const fsActions = new FsActions(fsCtx);

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
      tabList: () => browserActions.tabList(),
      tabSwitch: (id) => browserActions.tabSwitch(id),
      close: () => browserActions.close(),
    },
    terminal: {
      open: (o) => terminalActions.open(o),
      exec: (o) => terminalActions.exec(o),
      type: (o) => terminalActions.type(o),
      read: (o) => terminalActions.read(o),
      snapshot: (o) => terminalActions.snapshot(o),
      interrupt: (o) => terminalActions.interrupt(o),
      close: (o) => terminalActions.close(o),
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
      status: () => sessionManager.status(),
    },
    get sessionManager() { return sessionManager; },
    get browserActions() { return browserActions; },
    get terminalActions() { return terminalActions; },
    get fsActions() { return fsActions; },
    close() { sessionManager.close(); },
  };
}
