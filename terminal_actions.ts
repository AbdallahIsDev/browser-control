/**
 * Terminal Actions — High-level terminal action surface for Browser Control.
 *
 * Implements the canonical terminal actions:
 *   open, exec, type, snapshot, read, interrupt, close
 *
 * Uses:
 *   - Section 12 daemon-backed terminal session ownership
 *   - Section 4 policy routing
 *   - ActionResult as the unified result contract
 */

import type { TerminalSession, TerminalSnapshot, ExecResult } from "./terminal_types";
import type { TerminalSessionManager } from "./terminal_session";
import { isPolicyAllowed, BrokerTerminalRuntime, LocalTerminalRuntime, type PolicyEvalResult, type SessionManager, type TerminalRuntime } from "./session_manager";
import {
  successResult,
  failureResult,
  type ActionResult,
} from "./action_result";
import { logger } from "./logger";

const log = logger.withComponent("terminal_actions");

// ── Action Options ─────────────────────────────────────────────────────

export interface TerminalActionContext {
  /** Session manager for policy routing and session binding. */
  sessionManager: SessionManager;
  /**
   * Terminal session manager (or use sessionManager's).
   * @deprecated Use `terminalRuntime` instead — all terminal actions now flow
   * through the TerminalRuntime interface for CLI/API isomorphism.
   */
  terminalManager?: TerminalSessionManager;
  /** Terminal runtime (local or daemon-backed). If omitted, uses sessionManager.getTerminalRuntime(). */
  terminalRuntime?: TerminalRuntime;
  /**
   * When true, session-dependent terminal actions (open, type, read, etc.)
   * will auto-start the daemon if it's not already running. This aligns
   * the programmatic API with the CLI ownership model: persistent terminal
   * sessions should live in the daemon process, not in the caller's process.
   *
   * When false (default), only a best-effort probe with autoStart: false
   * is performed. If the daemon isn't reachable, actions fall back to
   * LocalTerminalRuntime (in-process PTY), which can hang the caller's
   * process.
   */
  autoStartDaemon?: boolean;
}

export interface TermOpenOptions {
  /** Shell to use (auto-detected if omitted). */
  shell?: string;
  /** Working directory. */
  cwd?: string;
  /** Session name. */
  name?: string;
}

export interface TermExecOptions {
  /** Command to execute. */
  command: string;
  /** Terminal session ID (if omitted, uses one-shot exec). */
  sessionId?: string;
  /** Timeout in ms. */
  timeoutMs?: number;
}

export interface TermTypeOptions {
  /** Text to type. */
  text: string;
  /** Terminal session ID. */
  sessionId: string;
}

export interface TermReadOptions {
  /** Terminal session ID. */
  sessionId: string;
  /** Max bytes to read. */
  maxBytes?: number;
}

export interface TermSnapshotOptions {
  /** Terminal session ID (if omitted, snapshots all sessions). */
  sessionId?: string;
}

export interface TermInterruptOptions {
  /** Terminal session ID. */
  sessionId: string;
}

export interface TermCloseOptions {
  /** Terminal session ID. */
  sessionId: string;
}

export interface TermResumeOptions {
  /** Terminal session ID to resume. */
  sessionId: string;
}

export interface TermStatusOptions {
  /** Terminal session ID to check status. */
  sessionId: string;
}

// ── Terminal Action Implementation ────────────────────────────────────

export class TerminalActions {
  private readonly context: TerminalActionContext;

  constructor(context: TerminalActionContext) {
    this.context = context;
  }

  /**
   * Get the terminal runtime — the single path through which all terminal
   * actions flow.  Uses the provided runtime, or falls back to the
   * session manager's default runtime (which is a LocalTerminalRuntime).
   *
   * This ensures CLI and API are isomorphic — both go through the same
   * TerminalRuntime interface, regardless of whether a daemon is running.
   *
   * IMPORTANT: Session-dependent actions (open, type, read, etc.) must
   * call ensureDaemonRuntimeReady() before this method so that the runtime
   * reflects the daemon-backed model when a daemon is available. Without
   * this, a fire-and-forget probe in createBrowserControl() may not have
   * settled yet, causing the first action to use LocalTerminalRuntime
   * (in-process PTY) instead of BrokerTerminalRuntime — the exact bug
   * the Section 5 fix prevents.
   */
  private getTerminalRuntime(): TerminalRuntime {
    return this.context.terminalRuntime ?? this.context.sessionManager.getTerminalRuntime();
  }

  /**
   * Ensure the daemon runtime is ready before session-dependent actions.
   *
   * This resolves the race condition where createBrowserControl() fires
   * an async ensureDaemonRuntime() probe but doesn't await it — the first
   * terminal action might call getTerminalRuntime() before the probe
   * settles, getting a LocalTerminalRuntime (in-process PTY) instead of
   * a BrokerTerminalRuntime.
   *
   * When `autoStartDaemon` is true (set by the programmatic API), this
   * method will auto-start the daemon if it's not already running. This
   * aligns the API path with the CLI: persistent terminal sessions
   * should live in the daemon process, not the caller's process.
   *
   * When `autoStartDaemon` is false (default), only a best-effort probe
   * with autoStart: false is performed. This is used by the CLI, which
   * handles auto-start in handleTerm() separately.
   */
  private async ensureDaemonRuntimeReady(): Promise<void> {
    // Only probe if no explicit runtime was provided AND no daemon/broker
    // runtime is already established on the session manager.
    if (this.context.terminalRuntime) return;
    const sm = this.context.sessionManager;
    if (sm.hasDaemon()) return; // DaemonTerminalRuntime will be used
    // If ensureDaemonRuntime was already called and succeeded,
    // getTerminalRuntime() will return BrokerTerminalRuntime already.
    // But if the fire-and-forget probe hasn't settled yet, this call
    // will wait for it (or discover the daemon is reachable now).
    const autoStart = this.context.autoStartDaemon ?? false;
    await sm.ensureDaemonRuntime({ autoStart }).catch(() => {
      // Ignore — LocalTerminalRuntime will be used as fallback
    });
  }

  /**
   * Check whether the current runtime is LocalTerminalRuntime when
   * autoStartDaemon is true.  If so, return a failure ActionResult
   * directing the user to start the daemon, instead of falling back
   * to in-process PTY ownership.
   *
   * This guard is applied to all session-dependent actions (open, list,
   * type, read, snapshot, interrupt, close, and session-bound exec)
   * so that the API consistently rejects local-fallback ownership and
   * provides a clear error message instead of a misleading "session not
   * found" from the empty LocalTerminalRuntime.
   */
  private requireDaemonRuntime(
    policyEval: PolicyEvalResult,
    sessionId: string,
  ): ActionResult<never> | null {
    if (!this.context.autoStartDaemon) return null;
    const runtime = this.getTerminalRuntime();
    if (runtime instanceof LocalTerminalRuntime) {
      return failureResult(
        "This action requires the daemon runtime, but the daemon could not be started. " +
        "Ensure the daemon is running (bc daemon start) or check daemon startup logs.",
        { path: policyEval.path, sessionId },
      );
    }
    return null;
  }

  /**
   * Invalidate the cached broker runtime if the current runtime is a
   * BrokerTerminalRuntime and the error looks like a connection failure.
   *
   * This is critical for recovery: when the daemon crashes after a
   * BrokerTerminalRuntime is cached, the early-return in ensureDaemonRuntime()
   * prevents re-probing, so every subsequent action would fail with
   * ECONNREFUSED forever. By invalidating the stale cache, the next
   * action's ensureDaemonRuntimeReady() will re-probe and either
   * discover the daemon is down (falling back to LocalTerminalRuntime)
   * or re-establish the connection if the daemon restarted.
   */
  private invalidateBrokerRuntimeOnError(error: unknown): void {
    const runtime = this.context.terminalRuntime ?? this.context.sessionManager.getTerminalRuntime();
    if (!(runtime instanceof BrokerTerminalRuntime)) return;
    const message = error instanceof Error ? error.message : String(error);
    if (/ECONNREFUSED|fetch failed|Broker API error|network error/i.test(message)) {
      log.info("Invalidating stale broker runtime after connection failure");
      this.context.sessionManager.invalidateBrokerRuntime();
    }
  }

  private getSessionId(): string {
    const session = this.context.sessionManager.getActiveSession();
    return session?.id ?? "default";
  }

  // ── Actions ─────────────────────────────────────────────────────────

  /**
   * Open a new terminal session.
   *
   * When `autoStartDaemon` is true (the API path), this method will NOT
   * fall back to LocalTerminalRuntime — persistent terminal sessions
   * must live in the daemon process, not the caller's process, so that
   * the caller can exit cleanly. If the daemon cannot be started, open()
   * returns a failure ActionResult instead of creating an in-process PTY.
   */
  async open(options: TermOpenOptions = {}): Promise<ActionResult<{ id: string; shell: string; cwd: string; status: string }>> {
    const sessionId = this.getSessionId();

    // Policy check
    const policyEval = this.context.sessionManager.evaluateAction("terminal_open", { shell: options.shell, cwd: options.cwd });
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<{ id: string; shell: string; cwd: string; status: string }>;

    try {
      await this.ensureDaemonRuntimeReady();
      const runtime = this.getTerminalRuntime();

      // When autoStartDaemon is true, refuse to fall back to
      // LocalTerminalRuntime for open(). Persistent terminal sessions
      // must be daemon-backed so the caller's process can exit cleanly.
      const daemonGuard = this.requireDaemonRuntime(policyEval, sessionId);
      if (daemonGuard) return daemonGuard;

      const result = await runtime.open({
        shell: options.shell,
        cwd: options.cwd,
        name: options.name,
      });

      // Bind the terminal to the session if there's an active session
      const activeSession = this.context.sessionManager.getActiveSession();
      if (activeSession) {
        this.context.sessionManager.bindTerminal(activeSession.id, result.id);
      }

      log.info("Terminal session opened", { id: result.id, shell: result.shell });

      return successResult(result, { path: policyEval.path, sessionId, policyDecision: policyEval.policyDecision, risk: policyEval.risk, auditId: policyEval.auditId });
    } catch (error: unknown) {
      this.invalidateBrokerRuntimeOnError(error);
      const message = error instanceof Error ? error.message : String(error);
      log.error(`Failed to open terminal session: ${message}`);
      return failureResult(`Failed to open terminal: ${message}`, { path: policyEval.path, sessionId });
    }
  }

  /**
   * Execute a command in a terminal session (or one-shot).
   */
  async exec(options: TermExecOptions): Promise<ActionResult<ExecResult>> {
    const sessionId = this.getSessionId();

    // Policy check
    const policyEval = this.context.sessionManager.evaluateAction("terminal_exec", { command: options.command });
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<ExecResult>;

    try {
      if (options.sessionId) await this.ensureDaemonRuntimeReady();
      const runtime = this.getTerminalRuntime();

      // Session-bound exec must use daemon runtime when autoStartDaemon is true
      if (options.sessionId) {
        const daemonGuard = this.requireDaemonRuntime(policyEval, sessionId);
        if (daemonGuard) return daemonGuard as ActionResult<ExecResult>;
      }

      const result = await runtime.exec(options.command, {
        sessionId: options.sessionId,
        timeoutMs: options.timeoutMs,
      });

      log.info("Command executed", {
        command: options.command.slice(0, 50),
        exitCode: result.exitCode,
        durationMs: result.durationMs,
      });

      return successResult(result, { path: policyEval.path, sessionId, policyDecision: policyEval.policyDecision, risk: policyEval.risk, auditId: policyEval.auditId });
    } catch (error: unknown) {
      this.invalidateBrokerRuntimeOnError(error);
      const message = error instanceof Error ? error.message : String(error);
      log.error(`Command execution failed: ${message}`);
      return failureResult(`Exec failed: ${message}`, { path: policyEval.path, sessionId });
    }
  }

  /**
   * Type text into a terminal session.
   */
  async type(options: TermTypeOptions): Promise<ActionResult<{ typed: string }>> {
    const sessionId = this.getSessionId();

    const policyEval = this.context.sessionManager.evaluateAction("terminal_write", { text: options.text });
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<{ typed: string }>;

    try {
      await this.ensureDaemonRuntimeReady();
      const runtime = this.getTerminalRuntime();
      const daemonGuard = this.requireDaemonRuntime(policyEval, sessionId);
      if (daemonGuard) return daemonGuard as ActionResult<{ typed: string }>;
      await runtime.type(options.sessionId, options.text);

      return successResult({ typed: options.text }, { path: policyEval.path, sessionId, policyDecision: policyEval.policyDecision, risk: policyEval.risk, auditId: policyEval.auditId });
    } catch (error: unknown) {
      this.invalidateBrokerRuntimeOnError(error);
      const message = error instanceof Error ? error.message : String(error);
      return failureResult(`Type failed: ${message}`, { path: policyEval.path, sessionId });
    }
  }

  /**
   * Read recent output from a terminal session.
   */
  async read(options: TermReadOptions): Promise<ActionResult<{ output: string }>> {
    const sessionId = this.getSessionId();

    // Read is low-risk but routes through policy for consistency
    const policyEval = this.context.sessionManager.evaluateAction("terminal_read", { sessionId: options.sessionId });
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<{ output: string }>;

    try {
      await this.ensureDaemonRuntimeReady();
      const runtime = this.getTerminalRuntime();
      const daemonGuard = this.requireDaemonRuntime(policyEval, sessionId);
      if (daemonGuard) return daemonGuard as ActionResult<{ output: string }>;
      const output = await runtime.read(options.sessionId, options.maxBytes);

      return successResult({ output }, { path: policyEval.path, sessionId, policyDecision: policyEval.policyDecision, risk: policyEval.risk, auditId: policyEval.auditId });
    } catch (error: unknown) {
      this.invalidateBrokerRuntimeOnError(error);
      const message = error instanceof Error ? error.message : String(error);
      return failureResult(`Read failed: ${message}`, { path: policyEval.path, sessionId });
    }
  }

  /**
   * Take a snapshot of terminal state.
   */
  async snapshot(options: TermSnapshotOptions = {}): Promise<ActionResult<TerminalSnapshot | TerminalSnapshot[]>> {
    const sessionId = this.getSessionId();

    // Snapshot is low-risk but routes through policy for consistency
    const policyEval = this.context.sessionManager.evaluateAction("terminal_snapshot", { sessionId: options.sessionId });
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<TerminalSnapshot | TerminalSnapshot[]>;

    try {
      await this.ensureDaemonRuntimeReady();
      const runtime = this.getTerminalRuntime();
      const daemonGuard = this.requireDaemonRuntime(policyEval, sessionId);
      if (daemonGuard) return daemonGuard as ActionResult<TerminalSnapshot | TerminalSnapshot[]>;
      const snapResult = await runtime.snapshot(options.sessionId);

      // Runtime returns TerminalSnapshot or TerminalSnapshot[]
      return successResult(snapResult as TerminalSnapshot | TerminalSnapshot[], { path: policyEval.path, sessionId, policyDecision: policyEval.policyDecision, risk: policyEval.risk, auditId: policyEval.auditId });
    } catch (error: unknown) {
      this.invalidateBrokerRuntimeOnError(error);
      const message = error instanceof Error ? error.message : String(error);
      return failureResult(`Snapshot failed: ${message}`, { path: policyEval.path, sessionId });
    }
  }

  /**
   * Interrupt a running command in a terminal session.
   */
  async interrupt(options: TermInterruptOptions): Promise<ActionResult<{ interrupted: boolean }>> {
    const sessionId = this.getSessionId();

    // Interrupt routes through policy for consistency
    const policyEval = this.context.sessionManager.evaluateAction("terminal_interrupt", { sessionId: options.sessionId });
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<{ interrupted: boolean }>;

    try {
      await this.ensureDaemonRuntimeReady();
      const runtime = this.getTerminalRuntime();
      const daemonGuard = this.requireDaemonRuntime(policyEval, sessionId);
      if (daemonGuard) return daemonGuard as ActionResult<{ interrupted: boolean }>;
      await runtime.interrupt(options.sessionId);

      return successResult({ interrupted: true }, { path: policyEval.path, sessionId, policyDecision: policyEval.policyDecision, risk: policyEval.risk, auditId: policyEval.auditId });
    } catch (error: unknown) {
      this.invalidateBrokerRuntimeOnError(error);
      const message = error instanceof Error ? error.message : String(error);
      return failureResult(`Interrupt failed: ${message}`, { path: policyEval.path, sessionId });
    }
  }

  /**
   * List active terminal sessions.
   *
   * Routes through policy for consistency with the Section 5 action surface.
   * This is a read-only / low-risk action, but still goes through
   * evaluateAction() so that every terminal command is on the same path.
   *
   * When `autoStartDaemon` is true, refuses LocalTerminalRuntime fallback
   * so that list() returns daemon sessions (not empty local sessions).
   */
  async list(): Promise<ActionResult<Array<{ id: string; name?: string; shell: string; cwd: string; status: string }>>> {
    const sessionId = this.getSessionId();

    const policyEval = this.context.sessionManager.evaluateAction("terminal_list", {});
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<Array<{ id: string; name?: string; shell: string; cwd: string; status: string }>>;

    try {
      await this.ensureDaemonRuntimeReady();
      const runtime = this.getTerminalRuntime();

      // When autoStartDaemon is true, refuse to fall back to
      // LocalTerminalRuntime for list(). The local manager has no
      // sessions, so it would return an empty list misleading the
      // user into thinking no daemon sessions exist.
      const daemonGuard = this.requireDaemonRuntime(policyEval, sessionId);
      if (daemonGuard) return daemonGuard as ActionResult<Array<{ id: string; name?: string; shell: string; cwd: string; status: string }>>;

      const sessions = await runtime.list();

      return successResult(sessions, { path: policyEval.path, sessionId, policyDecision: policyEval.policyDecision, risk: policyEval.risk, auditId: policyEval.auditId });
    } catch (error: unknown) {
      this.invalidateBrokerRuntimeOnError(error);
      const message = error instanceof Error ? error.message : String(error);
      return failureResult(`List failed: ${message}`, { path: policyEval.path, sessionId });
    }
  }

  /**
   * Close a terminal session.
   */
  async close(options: TermCloseOptions): Promise<ActionResult<{ closed: boolean }>> {
    const sessionId = this.getSessionId();

    const policyEval = this.context.sessionManager.evaluateAction("terminal_close", { sessionId: options.sessionId });
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<{ closed: boolean }>;

    try {
      await this.ensureDaemonRuntimeReady();
      const runtime = this.getTerminalRuntime();
      const daemonGuard = this.requireDaemonRuntime(policyEval, sessionId);
      if (daemonGuard) return daemonGuard as ActionResult<{ closed: boolean }>;
      await runtime.close(options.sessionId);

      // Unbind from session if applicable
      const activeSession = this.context.sessionManager.getActiveSession();
      if (activeSession && activeSession.terminalSessionId === options.sessionId) {
        this.context.sessionManager.unbindTerminal(activeSession.id);
      }

      return successResult({ closed: true }, { path: policyEval.path, sessionId, policyDecision: policyEval.policyDecision, risk: policyEval.risk, auditId: policyEval.auditId });
    } catch (error: unknown) {
      this.invalidateBrokerRuntimeOnError(error);
      const message = error instanceof Error ? error.message : String(error);
      return failureResult(`Close failed: ${message}`, { path: policyEval.path, sessionId });
    }
  }

  /**
   * Resume a terminal session from persisted state.
   */
  async resume(options: TermResumeOptions): Promise<ActionResult<unknown>> {
    const sessionId = this.getSessionId();

    const policyEval = this.context.sessionManager.evaluateAction("terminal_resume", { sessionId: options.sessionId });
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<unknown>;

    try {
      await this.ensureDaemonRuntimeReady();
      const runtime = this.getTerminalRuntime();
      const daemonGuard = this.requireDaemonRuntime(policyEval, sessionId);
      if (daemonGuard) return daemonGuard as ActionResult<unknown>;
      const result = await runtime.resume(options.sessionId);

      return successResult(result, { path: policyEval.path, sessionId, policyDecision: policyEval.policyDecision, risk: policyEval.risk, auditId: policyEval.auditId });
    } catch (error: unknown) {
      this.invalidateBrokerRuntimeOnError(error);
      const message = error instanceof Error ? error.message : String(error);
      return failureResult(`Resume failed: ${message}`, { path: policyEval.path, sessionId });
    }
  }

  /**
   * Get resume status for a terminal session.
   */
  async status(options: TermStatusOptions): Promise<ActionResult<unknown>> {
    const sessionId = this.getSessionId();

    const policyEval = this.context.sessionManager.evaluateAction("terminal_status", { sessionId: options.sessionId });
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<unknown>;

    try {
      await this.ensureDaemonRuntimeReady();
      const runtime = this.getTerminalRuntime();
      const daemonGuard = this.requireDaemonRuntime(policyEval, sessionId);
      if (daemonGuard) return daemonGuard as ActionResult<unknown>;
      const result = await runtime.status(options.sessionId);

      return successResult(result, { path: policyEval.path, sessionId, policyDecision: policyEval.policyDecision, risk: policyEval.risk, auditId: policyEval.auditId });
    } catch (error: unknown) {
      this.invalidateBrokerRuntimeOnError(error);
      const message = error instanceof Error ? error.message : String(error);
      return failureResult(`Status failed: ${message}`, { path: policyEval.path, sessionId });
    }
  }
}
