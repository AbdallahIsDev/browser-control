/**
 * Filesystem Actions — High-level filesystem action surface for Browser Control.
 *
 * Implements the canonical filesystem actions:
 *   ls, read, write, move, rm, stat
 *
 * Uses:
 *   - Section 12 structured fs layer (NOT shell commands)
 *   - Section 4 policy routing
 *   - ActionResult as the unified result contract
 */

import {
  readFile as fsReadFile,
  writeFile as fsWriteFile,
  listDir as fsListDir,
  moveFile as fsMoveFile,
  deletePath as fsDeletePath,
  statPath as fsStatPath,
  resolvePath,
  type FileReadResult,
  type FileWriteResult,
  type ListResult,
  type MoveResult,
  type DeleteResult,
  type FileStatResult,
  type ListOptions,
  type MoveOptions,
  type DeleteOptions,
  type ReadFileOptions,
  type WriteFileOptions,
  type StatOptions,
} from "./operations";
import path from "node:path";
import type { PolicyEvalResult, SessionManager } from "../session_manager";
import { isPolicyAllowed } from "../session_manager";
import {
  successResult,
  failureResult,
  type ActionResult,
} from "../shared/action_result";
import { logger } from "../shared/logger";
import { collectFailureDebugMetadata } from "../observability/action_debug";
import type { ExecutionPath, PolicyDecision, RiskLevel } from "../policy/types";

const log = logger.withComponent("fs_actions");

export const DEFAULT_ALLOWED_ROOTS: readonly string[] = [];

// ── Action Options ─────────────────────────────────────────────────────

export interface FsActionContext {
  /** Session manager for policy routing and session binding. */
  sessionManager: SessionManager;
}

export interface FsReadOptions {
  /** File path to read. */
  path: string;
  /** Max bytes to read. */
  maxBytes?: number;
}

export interface FsWriteOptions {
  /** File path to write. */
  path: string;
  /** Content to write. */
  content: string;
  /** Create parent directories (default: true). */
  createDirs?: boolean;
  /** Explicit user confirmation for high-risk writes. */
  confirmed?: boolean;
}

export interface FsWriteOutputOptions {
  /** Filename relative to the active session runtime directory. */
  filename: string;
  /** Content to write. */
  content: string;
}

export interface FsListOptions {
  /** Directory path to list. */
  path: string;
  /** Recurse into subdirectories. */
  recursive?: boolean;
  /** Filter by file extension. */
  extension?: string;
}

export interface FsMoveOptions {
  /** Source path. */
  src: string;
  /** Destination path. */
  dst: string;
  /** Explicit user confirmation for high-risk moves. */
  confirmed?: boolean;
}

export interface FsRmOptions {
  /** Path to delete. */
  path: string;
  /** Allow recursive directory deletion. */
  recursive?: boolean;
  /** Don't throw if path doesn't exist. */
  force?: boolean;
  /** Explicit user confirmation for high-risk deletes. */
  confirmed?: boolean;
}

export interface FsStatOptions {
  /** Path to stat. */
  path: string;
}

// ── FS Action Implementation ───────────────────────────────────────────

export class FsActions {
  private readonly context: FsActionContext;

  constructor(context: FsActionContext) {
    this.context = context;
  }

  private getSessionId(): string {
    const session = this.context.sessionManager.getActiveSession();
    return session?.id ?? "default";
  }

  private getWorkingDirectory(): string | undefined {
    return this.context.sessionManager.getActiveSession()?.workingDirectory;
  }

  private getRuntimeDirectory(): string {
    const session = this.context.sessionManager.getActiveSession();
    if (!session?.runtimeDir) {
      throw new Error("No active session runtime directory");
    }
    return session.runtimeDir;
  }

  private getDefaultAllowedRoots(operation: "read" | "write" | "delete"): string[] | undefined {
    const session = this.context.sessionManager.getActiveSession();
    const roots: string[] = [];
    if (session?.runtimeDir) {
      roots.push(session.runtimeDir);
    }
    if (operation === "read" && session?.workingDirectory) {
      roots.push(session.workingDirectory);
    }
    return roots.length > 0 ? roots : undefined;
  }

  private resolveOutputPath(filename: string): string {
    if (!filename || filename.trim().length === 0) {
      throw new Error("Output filename is required");
    }
    if (path.isAbsolute(filename)) {
      throw new Error("Absolute output paths require explicit fs.write permission");
    }
    const runtimeDir = path.resolve(this.getRuntimeDirectory());
    const resolved = path.resolve(runtimeDir, filename);
    const relative = path.relative(runtimeDir, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Output filename must stay under the session runtime directory");
    }
    return resolved;
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
      fsPath: string;
      operation: string;
    },
  ): Promise<ActionResult<T>> {
    const debug = await collectFailureDebugMetadata({
      action: options.action,
      sessionId: options.sessionId,
      executionPath: options.path,
      error,
      fsOperation: {
        path: options.fsPath,
        operation: options.operation,
        errorCode: (error as { code?: string } | null)?.code,
      },
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

  private isAllowedOrConfirmed(
    policyEval: PolicyEvalResult,
    confirmed: boolean | undefined,
  ): boolean {
    return isPolicyAllowed(policyEval) || (confirmed === true && policyEval.policyDecision === "require_confirmation");
  }

  // ── Actions ─────────────────────────────────────────────────────────

  /**
   * Read a file.
   */
  async read(options: FsReadOptions): Promise<ActionResult<FileReadResult>> {
    const sessionId = this.getSessionId();

    const policyEval = this.context.sessionManager.evaluateAction("fs_read", { path: options.path });
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<FileReadResult>;

    try {
      const readOpts: ReadFileOptions = {
        maxBytes: options.maxBytes,
        cwd: this.getWorkingDirectory(),
        allowedRoots: this.getDefaultAllowedRoots("read"),
      };
      const result = fsReadFile(options.path, readOpts);
      log.info("File read", { path: result.path, sizeBytes: result.sizeBytes });

      return successResult(result, {
        path: policyEval.path,
        sessionId,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        auditId: policyEval.auditId,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`File read failed: ${message}`);
      return this.failureWithDebug(`Read failed: ${message}`, error, {
        action: "fs_read",
        path: policyEval.path,
        sessionId,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        auditId: policyEval.auditId,
        fsPath: options.path,
        operation: "read",
      });
    }
  }

  /**
   * Write to a file.
   */
  async write(options: FsWriteOptions): Promise<ActionResult<FileWriteResult>> {
    const sessionId = this.getSessionId();

    const policyEval = this.context.sessionManager.evaluateAction("fs_write", { path: options.path });
    if (!this.isAllowedOrConfirmed(policyEval, options.confirmed)) return policyEval as ActionResult<FileWriteResult>;

    try {
      const writeOpts: WriteFileOptions = {
        createDirs: options.createDirs,
        cwd: this.getWorkingDirectory(),
        allowedRoots: this.getDefaultAllowedRoots("write"),
      };
      const result = fsWriteFile(options.path, options.content, writeOpts);

      log.info("File written", { path: result.path, sizeBytes: result.sizeBytes, created: result.created });

      return successResult(result, {
        path: policyEval.path,
        sessionId,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        auditId: policyEval.auditId,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`File write failed: ${message}`);
      return this.failureWithDebug(`Write failed: ${message}`, error, {
        action: "fs_write",
        path: policyEval.path,
        sessionId,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        auditId: policyEval.auditId,
        fsPath: options.path,
        operation: "write",
      });
    }
  }

  /**
   * Write task output under the active session runtime directory.
   */
  async writeOutput(options: FsWriteOutputOptions): Promise<ActionResult<FileWriteResult>> {
    const sessionId = this.getSessionId();
    let outputPath: string;
    try {
      outputPath = this.resolveOutputPath(options.filename);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return failureResult<FileWriteResult>(message, {
        path: "command",
        sessionId,
      });
    }

    const policyEval = this.context.sessionManager.evaluateAction("fs_write_output", {
      filename: options.filename,
      sizeBytes: Buffer.byteLength(options.content, "utf8"),
    });
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<FileWriteResult>;

    try {
      const result = fsWriteFile(outputPath, options.content, {
        createDirs: true,
      });
      log.info("Session output written", { path: result.path, sizeBytes: result.sizeBytes });

      return successResult(result, {
        path: policyEval.path,
        sessionId,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        auditId: policyEval.auditId,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`Output write failed: ${message}`);
      return this.failureWithDebug(`Output write failed: ${message}`, error, {
        action: "fs_write_output",
        path: policyEval.path,
        sessionId,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        auditId: policyEval.auditId,
        fsPath: outputPath,
        operation: "write_output",
      });
    }
  }

  /**
   * List directory contents.
   */
  async ls(options: FsListOptions): Promise<ActionResult<ListResult>> {
    const sessionId = this.getSessionId();

    const policyEval = this.context.sessionManager.evaluateAction("fs_list", { path: options.path });
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<ListResult>;

    try {
      const listOpts: ListOptions = {
        recursive: options.recursive,
        extension: options.extension,
        cwd: this.getWorkingDirectory(),
        allowedRoots: this.getDefaultAllowedRoots("read"),
      };
      const result = fsListDir(options.path, listOpts);

      log.info("Directory listed", { path: result.path, entries: result.totalEntries });

      return successResult(result, {
        path: policyEval.path,
        sessionId,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        auditId: policyEval.auditId,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`Directory list failed: ${message}`);
      return this.failureWithDebug(`List failed: ${message}`, error, {
        action: "fs_list",
        path: policyEval.path,
        sessionId,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        auditId: policyEval.auditId,
        fsPath: options.path,
        operation: "list",
      });
    }
  }

  /**
   * Move or rename a file/directory.
   */
  async move(options: FsMoveOptions): Promise<ActionResult<MoveResult>> {
    const sessionId = this.getSessionId();

    const policyEval = this.context.sessionManager.evaluateAction("fs_move", { src: options.src, dst: options.dst });
    if (!this.isAllowedOrConfirmed(policyEval, options.confirmed)) return policyEval as ActionResult<MoveResult>;

    try {
      const moveOpts: MoveOptions = {
        cwd: this.getWorkingDirectory(),
        allowedRoots: this.getDefaultAllowedRoots("write"),
      };
      const result = fsMoveFile(options.src, options.dst, moveOpts);

      log.info("File moved", { from: result.from, to: result.to });

      return successResult(result, {
        path: policyEval.path,
        sessionId,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        auditId: policyEval.auditId,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`Move failed: ${message}`);
      return this.failureWithDebug(`Move failed: ${message}`, error, {
        action: "fs_move",
        path: policyEval.path,
        sessionId,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        auditId: policyEval.auditId,
        fsPath: options.src,
        operation: "move",
      });
    }
  }

  /**
   * Delete a file or directory.
   */
  async rm(options: FsRmOptions): Promise<ActionResult<DeleteResult>> {
    const sessionId = this.getSessionId();

    const policyEval = this.context.sessionManager.evaluateAction("fs_delete", { path: options.path, recursive: options.recursive });
    if (!this.isAllowedOrConfirmed(policyEval, options.confirmed)) return policyEval as ActionResult<DeleteResult>;

    try {
      const deleteOpts: DeleteOptions = {
        recursive: options.recursive,
        force: options.force,
        cwd: this.getWorkingDirectory(),
        allowedRoots: this.getDefaultAllowedRoots("delete"),
      };
      const result = fsDeletePath(options.path, deleteOpts);

      log.info("Path deleted", { path: result.path, type: result.type });

      return successResult(result, {
        path: policyEval.path,
        sessionId,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        auditId: policyEval.auditId,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`Delete failed: ${message}`);
      return this.failureWithDebug(`Delete failed: ${message}`, error, {
        action: "fs_delete",
        path: policyEval.path,
        sessionId,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        auditId: policyEval.auditId,
        fsPath: options.path,
        operation: "delete",
      });
    }
  }

  /**
   * Get file/directory metadata.
   */
  async stat(options: FsStatOptions): Promise<ActionResult<FileStatResult>> {
    const sessionId = this.getSessionId();

    // Stat is a read-only metadata operation but routes through policy
    // for consistency (Issue 5). It evaluates as low-risk fs_stat.
    const policyEval = this.context.sessionManager.evaluateAction("fs_stat", { path: options.path });
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<FileStatResult>;

    try {
      const statOpts: StatOptions = {
        cwd: this.getWorkingDirectory(),
        allowedRoots: this.getDefaultAllowedRoots("read"),
      };
      const result = fsStatPath(options.path, statOpts);

      return successResult(result, {
        path: policyEval.path,
        sessionId,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        auditId: policyEval.auditId,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`Stat failed: ${message}`);
      return this.failureWithDebug(`Stat failed: ${message}`, error, {
        action: "fs_stat",
        path: policyEval.path,
        sessionId,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        auditId: policyEval.auditId,
        fsPath: options.path,
        operation: "stat",
      });
    }
  }
}
