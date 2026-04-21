/**
 * Terminal Session — PTY-backed session lifecycle.
 *
 * Provides real shell sessions using node-pty. Sessions preserve shell state
 * (cwd, env, history) between commands. Supports both one-shot exec and
 * interactive persistent sessions.
 */

import * as pty from "node-pty";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import os from "node:os";
import type {
  ExecOptions,
  ExecResult,
  TerminalSession as ITerminalSession,
  TerminalSessionConfig,
  TerminalSessionManager as ITerminalSessionManager,
  TerminalSessionStatus,
  TerminalSnapshot,
} from "./terminal_types";
import { detectShell, resolveNamedShell, type ShellInfo } from "./cross_platform";
import { isPromptDetected, extractCwdFromPrompt } from "./terminal_prompt";
import { logger } from "./logger";

const log = logger.withComponent("terminal");

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const DEFAULT_MAX_OUTPUT = 1024 * 1024; // 1MB
const PROMPT_READY_TIMEOUT = 8000; // ms to wait for prompt after spawn/exec
const OUTPUT_POLL_INTERVAL = 50; // ms between output reads during exec

// ── PTY Session Implementation ───────────────────────────────────────

class PtyTerminalSession implements ITerminalSession {
  readonly id: string;
  readonly name: string | undefined;
  readonly shell: string;
  readonly env: Record<string, string>;
  readonly createdAt: string;

  private _cwd: string;
  private _status: TerminalSessionStatus = "idle";
  private _process: pty.IPty | null = null;
  /** Whether close() has been called. Set only once, at the start of close(). */
  private _closed = false;
  private _outputBuffer = "";
  private _outputResolve: ((data: string) => void) | null = null;
  private _runningCommand: string | undefined;
  private _lastActivityAt: string;
  /** Set when the PTY process has exited (via natural exit or kill). */
  private _processExited = false;
  private _shellInfo: ShellInfo;
  /** Disposable listeners from node-pty onData/onExit. Must be disposed on close to release internal handles. */
  private _onDataDisposable: { dispose(): void } | null = null;
  private _onExitDisposable: { dispose(): void } | null = null;
  /** FDs of active handles before PTY spawn, used to identify PTY-created Socket handles for cleanup. */
  private _preSpawnFds: Set<number> = new Set();

  constructor(
    id: string,
    shellInfo: ShellInfo,
    config: TerminalSessionConfig,
  ) {
    this.id = id;
    this.name = config.name;
    this.shell = shellInfo.name;
    this._shellInfo = shellInfo;
    this._cwd = config.cwd ?? process.cwd();
    this.env = { ...process.env as Record<string, string>, ...(config.env ?? {}) };
    this.createdAt = new Date().toISOString();
    this._lastActivityAt = this.createdAt;
  }

  get cwd(): string {
    return this._cwd;
  }

  set cwd(value: string) {
    this._cwd = value;
  }

  get status(): TerminalSessionStatus {
    return this._status;
  }

  /**
   * Spawn the PTY process. Called internally by the session manager.
   */
  spawn(cols?: number, rows?: number): void {
    if (this._process) {
      throw new Error("Session already spawned.");
    }

    // Snapshot active handle FDs before PTY spawn.
    // On Windows, node-pty creates ConPTY IPC Socket handles that persist
    // even after kill(). We track them so we can unref() them during close().
    this._preSpawnFds = new Set();
    for (const h of (process as any)._getActiveHandles()) {
      if (typeof (h as any).fd === "number") {
        this._preSpawnFds.add((h as any).fd);
      }
    }

    const c = cols ?? DEFAULT_COLS;
    const r = rows ?? DEFAULT_ROWS;

    this._process = pty.spawn(this._shellInfo.path, this._shellInfo.args, {
      name: "xterm-256color",
      cols: c,
      rows: r,
      cwd: this._cwd,
      env: this.env,
    });

    this._onDataDisposable = this._process.onData((data: string) => {
      this._outputBuffer += data;
      this._lastActivityAt = new Date().toISOString();

      // Trim buffer to max size
      if (this._outputBuffer.length > DEFAULT_MAX_OUTPUT) {
        this._outputBuffer = this._outputBuffer.slice(-DEFAULT_MAX_OUTPUT);
      }

      // Notify any pending read
      if (this._outputResolve) {
        const resolve = this._outputResolve;
        this._outputResolve = null;
        resolve(this._outputBuffer);
      }
    });

    this._onExitDisposable = this._process.onExit(({ exitCode, signal }) => {
      // Mark process as exited FIRST — this unblocks any waitForProcessExit() loops
      // and prevents double-kill in close(). Use a separate flag so the natural exit
      // and the close() kill path don't race.
      this._processExited = true;
      this._status = "closed";
      this._closed = true;
      log.info("Terminal session exited", {
        sessionId: this.id,
        exitCode,
        signal,
      });
      // Wake up any pending read
      if (this._outputResolve) {
        const resolve = this._outputResolve;
        this._outputResolve = null;
        resolve(this._outputBuffer);
      }
    });

    this._status = "idle";
    log.info("Terminal session spawned", {
      sessionId: this.id,
      shell: this.shell,
      cwd: this._cwd,
      pid: this._process.pid,
    });
  }

  /**
   * Wait for the shell to be ready (prompt visible) after spawn or exec.
   */
  private async waitForReady(timeoutMs: number = PROMPT_READY_TIMEOUT): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (isPromptDetected(this._outputBuffer, this.id)) {
        return;
      }
      if (this._processExited) return;
      if (this._closed) return;
      await sleep(OUTPUT_POLL_INTERVAL);
    }
    // Timeout — proceed anyway, shell may be slow
  }

  async exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
    this.assertNotClosed();

    const timeoutMs = options.timeoutMs ?? 0;

    // Use markers that differ between shell echo and actual output.
    const stamp = Date.now();
    const startMarker = `__BC_S_${stamp}__`;
    const endMarkerBase = `__BC_E_${stamp}`;

    // Shell-specific command wrapping for exit code capture
    // POSIX (bash/zsh): Uses $? for exit code
    // PowerShell (Windows): Uses $LASTEXITCODE
    const isWindowsShell = this._shellInfo.family === "windows";

    const startCmd = isWindowsShell
      ? `Write-Output "${startMarker}"\r`
      : `printf '%s\n' '${startMarker}'\r`;

    let execCmd: string;
    if (isWindowsShell) {
      execCmd = `& { ${command} }; $__bc_success = $?; $__bc_exit = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } elseif ($__bc_success) { 0 } else { 1 }; Write-Output "${endMarkerBase}:$__bc_exit"\r`;
    } else {
      execCmd = `${command}; __bc_ec=$?; printf '${endMarkerBase}:%s\n' "$__bc_ec"\r`;
    }

    this._status = "running";
    this._runningCommand = command;
    const startMs = Date.now();

    // Clear the output buffer
    this._outputBuffer = "";

    // Write the command sequence
    if (this._process) {
      this._process.write(startCmd);
      await new Promise(r => setTimeout(r, 50));
      this._process.write(execCmd);
    }

    // Wait for the end marker with expanded exit code to appear
    // POSIX looks like: __BC_E_<ts>:0  (digits after colon)
    // PowerShell looks like: __BC_E_<ts>:"0" (quoted digits)
    const endMarkerEscaped = endMarkerBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const endMarkerPattern = new RegExp(`${endMarkerEscaped}:\\d+`);
    let timedOut = false;

    const waitForEndMarker = async (): Promise<void> => {
      const pollInterval = 50;
      const deadline = timeoutMs > 0 ? startMs + timeoutMs : startMs + 30000;

      while (Date.now() < deadline) {
        if (endMarkerPattern.test(this._outputBuffer)) {
          return;
        }
        if (this._closed) return;
        await new Promise(r => setTimeout(r, pollInterval));
      }
      timedOut = true;
      await this.interrupt();
      await new Promise(r => setTimeout(r, 200));
    };

    await waitForEndMarker();

    const durationMs = Date.now() - startMs;

    // Extract output between markers
    let commandOutput = "";
    let exitCode = timedOut ? 124 : 1;

    const startIdx = this._outputBuffer.indexOf(startMarker);
    const endMatch = this._outputBuffer.match(endMarkerPattern);

    if (startIdx !== -1 && endMatch && endMatch.index !== undefined) {
      // Get everything after the start marker line and before the end marker
      const afterStart = this._outputBuffer.slice(startIdx + startMarker.length);
      const endPos = afterStart.search(endMarkerPattern);

      if (endPos !== -1) {
        commandOutput = afterStart.slice(0, endPos);

        // Extract exit code from the end marker
        const exitCodeStr = endMatch[0].split(":")[1];
        if (exitCodeStr) {
          exitCode = parseInt(exitCodeStr, 10);
        }
      }
    } else if (this._outputBuffer.length > 0) {
      commandOutput = this._outputBuffer;
    }

    // Clean ANSI codes
    const cleanOutput = stripAnsi(commandOutput);

    // Split into stdout/stderr (PTY merges them)
    const { stdout, stderr } = splitPtyOutput(cleanOutput, command);

    // Try to detect cwd from the full buffer
    const detectedCwd = extractCwdFromPrompt(this._outputBuffer);
    if (detectedCwd) {
      this._cwd = detectedCwd;
    }

    this._status = "idle";
    this._runningCommand = undefined;

    return {
      exitCode,
      stdout: stdout.slice(0, options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT),
      stderr: stderr.slice(0, options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT),
      durationMs,
      cwd: this._cwd,
      timedOut,
    };
  }

  async write(data: string): Promise<void> {
    this.assertNotClosed();
    if (this._process) {
      this._process.write(data + "\r");
      this._lastActivityAt = new Date().toISOString();
    }
  }

  async read(maxBytes?: number): Promise<string> {
    this.assertNotClosed();
    const limit = maxBytes ?? DEFAULT_MAX_OUTPUT;
    const output = this._outputBuffer.slice(-limit);
    return stripAnsi(output);
  }

  async snapshot(): Promise<TerminalSnapshot> {
    return {
      sessionId: this.id,
      name: this.name,
      shell: this.shell,
      cwd: this._cwd,
      env: { ...this.env },
      status: this._status,
      lastOutput: stripAnsi(this._outputBuffer.slice(-4096)),
      promptDetected: isPromptDetected(this._outputBuffer, this.id),
      scrollbackLines: this._outputBuffer.split(/\r?\n/).length,
      runningCommand: this._runningCommand,
      createdAt: this.createdAt,
      lastActivityAt: this._lastActivityAt,
    };
  }

  async interrupt(): Promise<void> {
    this.assertNotClosed();
    if (this._process) {
      // Send Ctrl+C
      this._process.write("\x03");
      this._status = "interrupted";
      this._lastActivityAt = new Date().toISOString();
      // Brief wait for the interrupt to take effect
      await sleep(100);
      this._status = "idle";
      this._runningCommand = undefined;
    }
  }

  async close(): Promise<void> {
    if (this._closed) return;
    this._status = "closed";

    const processRef = this._process;
    if (!processRef) {
      this._closed = true;
      return;
    }

    // Try graceful exit first: write "exit" to the shell and wait for PTY exit event.
    // On Windows, the PTY exit event fires when the shell process terminates.
    // We do NOT set _closed here — let the PTY onExit handler set it.
    if (this._shellInfo.family === "windows") {
      try {
        // Write exit command to trigger natural shell shutdown.
        // DO NOT set _closed = true here — waitForProcessExit checks _processExited.
        processRef.write("exit\r");

        // Wait for the PTY onExit handler to fire (sets _processExited = true).
        // pollInterval = 50ms, deadline = 1 second from now.
        await this.waitForProcessExit(1000);

        // If we reached here, the PTY naturally exited from "exit" — no kill needed.
        // The onExit handler already set _closed = true and nulled _process.
        this._process = null;
        this.disposeListeners();

        log.info("Terminal session closed (graceful exit)", { sessionId: this.id });
        return;
      } catch {
        // waitForProcessExit threw (e.g. timeout) — fall through to forced kill.
      }
    }

    // Forced kill path: PTY still alive after graceful attempt or non-Windows shell.
    // Set _closed before kill so close() returns immediately without hanging.
    // The kill signal is sent; the PTY will exit asynchronously.
    // We null _process BEFORE kill so the onExit handler sees _process === null
    // and skips redundant cleanup, avoiding any state confusion.
    this._process = null;
    this._closed = true;
    this.disposeListeners();
    try {
      processRef.kill();
    } catch {
      // Process may have already exited.
    }
    this._processExited = true;
    // Belt-and-suspenders: after kill(), node-pty's ConPTY may create
    // transient shutdown handles. Unref again to ensure nothing leaks.
    this.unrefPtyHandles();

    log.info("Terminal session closed (forced kill)", { sessionId: this.id });
  }

  /**
   * Get the PTY process PID (for advanced use cases).
   */
  get pid(): number | undefined {
    return this._process?.pid;
  }

  /**
   * Dispose node-pty event listeners (onData, onExit).
   *
   * node-pty on Windows creates internal ConPTY IPC channels (Sockets + MessagePort)
   * that are held open by the listener references. If we do not dispose these,
   * the handles persist after close() and keep the Node.js event loop alive,
   * preventing the process from exiting naturally.
   *
   * This method is called from close() after the PTY process has been terminated.
   */
  private disposeListeners(): void {
    if (this._onDataDisposable) {
      try { this._onDataDisposable.dispose(); } catch { /* already disposed */ }
      this._onDataDisposable = null;
    }
    if (this._onExitDisposable) {
      try { this._onExitDisposable.dispose(); } catch { /* already disposed */ }
      this._onExitDisposable = null;
    }

    // On Windows (ConPTY), node-pty creates internal IPC Socket handles that
    // persist even after kill() and listener disposal. These handles keep the
    // Node.js event loop alive, preventing the process from exiting naturally.
    // The only reliable way to release them is to call .unref() on each
    // PTY-created Socket handle, which removes their reference from the event
    // loop and allows the process to exit.
    //
    // Evidence: diagnostic harness showed 3 Socket + 1 MessagePort handles
    // remaining after close(). dispose() releases the MessagePort, but
    // unref() is needed for the 3 Sockets.
    this.unrefPtyHandles();
  }

  /**
   * Unref PTY-created Socket handles to allow the Node.js process to exit.
   *
   * On Windows, node-pty's ConPTY implementation creates internal named-pipe
   * Socket handles for IPC with the ConPTY agent process. These handles are
   * NOT released by kill() or listener disposal. Without unref(), they keep
   * the event loop alive and the test process hangs after all tests pass.
   *
   * We identify PTY-created handles by comparing FDs before/after spawn.
   * Handles with FDs not present before spawn are PTY-created.
   */
  private unrefPtyHandles(): void {
    for (const h of (process as any)._getActiveHandles()) {
      const fd = (h as any).fd;
      if (typeof fd === "number" && !this._preSpawnFds.has(fd)) {
        // This handle was created by PTY spawn — unref it.
        try {
          (h as any).unref();
        } catch {
          // Some handles don't support unref() — ignore.
        }
      }
    }
  }

  private assertNotClosed(): void {
    if (this._closed) {
      throw new Error(`Terminal session ${this.id} is closed.`);
    }
  }

  private async waitForProcessExit(timeoutMs: number): Promise<void> {
    const startedAt = Date.now();
    // Wait for the PTY exit event (which sets _processExited = true).
    // We do NOT check _closed here — that flag is set too early in close()
    // and would cause the loop to return immediately without waiting for exit.
    while (!this._processExited && (Date.now() - startedAt) < timeoutMs) {
      await sleep(50);
    }
    // If _processExited is still false after the loop, the PTY did not exit
    // within the timeout. Throw so the caller (close()) falls through to
    // the forced-kill path, which kills the PTY process and releases handles.
    if (!this._processExited) {
      throw new Error(`PTY process did not exit within ${timeoutMs}ms`);
    }
  }
}

// ── Session Manager ──────────────────────────────────────────────────

export class TerminalSessionManager implements ITerminalSessionManager {
  private readonly sessions = new Map<string, PtyTerminalSession>();

  async create(config: TerminalSessionConfig = {}): Promise<ITerminalSession> {
    const id = crypto.randomUUID();
    const shellInfo = config.shell
      ? resolveNamedShell(config.shell)
      : detectShell();

    const session = new PtyTerminalSession(id, shellInfo, config);
    session.spawn(config.cols, config.rows);

    // Wait for initial prompt
    await (session as unknown as { waitForReady: (ms: number) => Promise<void> })
      .waitForReady(PROMPT_READY_TIMEOUT);

    this.sessions.set(id, session);
    return session;
  }

  get(sessionId: string): ITerminalSession | undefined {
    return this.sessions.get(sessionId);
  }

  list(): ITerminalSession[] {
    return Array.from(this.sessions.values());
  }

  async close(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      await session.close();
      this.sessions.delete(sessionId);
    }
  }

  async closeAll(): Promise<void> {
    const promises = Array.from(this.sessions.values()).map((s) => s.close());
    await Promise.allSettled(promises);
    this.sessions.clear();
  }
}

// ── Standalone Exec (no persistent session) ──────────────────────────

/**
 * Execute a command in a fresh PTY session and return the result.
 * The session is closed after execution.
 *
 * Use this for one-shot commands that don't need persistent shell state.
 */
export async function execCommand(
  command: string,
  options: ExecOptions & TerminalSessionConfig = {},
): Promise<ExecResult> {
  const shellInfo = options.shell
    ? resolveNamedShell(options.shell)
    : detectShell();

  const cwd = options.cwd ?? process.cwd();
  const env = { ...process.env, ...(options.env ?? {}) } as NodeJS.ProcessEnv;
  const timeoutMs = options.timeoutMs ?? 0;
  const startedAt = Date.now();

  const args = shellInfo.family === "windows"
    ? ["-NoLogo", "-NoProfile", "-Command", command]
    : [shellInfo.name === "sh" ? "-c" : "-lc", command];

  return await new Promise<ExecResult>((resolve, reject) => {
    const child = spawn(shellInfo.path, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let timeoutHandle: NodeJS.Timeout | null = null;

    const finish = (result: ExecResult): void => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      resolve(result);
    };

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      reject(error);
    });

    child.on("close", (exitCode) => {
      finish({
        exitCode: timedOut ? 124 : (exitCode ?? 1),
        stdout: stdout.slice(0, options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT).trim(),
        stderr: stderr.slice(0, options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT).trim(),
        durationMs: Date.now() - startedAt,
        cwd,
        timedOut,
      });
    });

    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        child.kill(shellInfo.family === "windows" ? undefined : "SIGTERM");
      }, timeoutMs);
    }
  });
}

// ── Utilities ────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Strip ANSI escape codes from terminal output.
 */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
    .replace(/\x1b\][^\x07]*\x07/g, "")
    .replace(/\x1b[()#][a-zA-Z0-9]/g, "");
}

/**
 * PTY merges stdout and stderr. This function cleans up the output
 * by removing echo lines and shell noise.
 */
function splitPtyOutput(
  output: string,
  command: string,
): { stdout: string; stderr: string } {
  const lines = output.split(/\r?\n/);
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    // Skip echo of the command itself
    if (trimmed === command) continue;

    // Heuristic: error-looking lines go to stderr
    if (
      trimmed.startsWith("Error:") ||
      trimmed.startsWith("error:") ||
      trimmed.startsWith("ERROR:") ||
      trimmed.startsWith("bash:") ||
      trimmed.startsWith("sh:") ||
      trimmed.startsWith("zsh:") ||
      trimmed.startsWith("pwsh:") ||
      trimmed.startsWith("powershell:") ||
      trimmed.includes(": command not found") ||
      trimmed.includes(": No such file or directory") ||
      trimmed.includes("Permission denied")
    ) {
      stderrLines.push(line);
    } else {
      stdoutLines.push(line);
    }
  }

  return {
    stdout: stdoutLines.join("\n").trim(),
    stderr: stderrLines.join("\n").trim(),
  };
}

// ── Default Session Manager Singleton ────────────────────────────────

let defaultManager: TerminalSessionManager | null = null;

/**
 * Get or create the default terminal session manager.
 */
export function getDefaultSessionManager(): TerminalSessionManager {
  if (!defaultManager) {
    defaultManager = new TerminalSessionManager();
  }
  return defaultManager;
}

/**
 * Reset the default session manager (mainly for testing).
 */
export async function resetDefaultSessionManager(): Promise<void> {
  if (defaultManager) {
    await defaultManager.closeAll();
    defaultManager = null;
  }
}
