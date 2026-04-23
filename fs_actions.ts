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
  type FileReadResult,
  type FileWriteResult,
  type ListResult,
  type MoveResult,
  type DeleteResult,
  type FileStatResult,
  type ListOptions,
  type DeleteOptions,
} from "./fs_operations";
import type { SessionManager } from "./session_manager";
import { isPolicyAllowed } from "./session_manager";
import {
  successResult,
  failureResult,
  type ActionResult,
} from "./action_result";
import { logger } from "./logger";

const log = logger.withComponent("fs_actions");

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
}

export interface FsRmOptions {
  /** Path to delete. */
  path: string;
  /** Allow recursive directory deletion. */
  recursive?: boolean;
  /** Don't throw if path doesn't exist. */
  force?: boolean;
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

  // ── Actions ─────────────────────────────────────────────────────────

  /**
   * Read a file.
   */
  async read(options: FsReadOptions): Promise<ActionResult<FileReadResult>> {
    const sessionId = this.getSessionId();

    const policyEval = this.context.sessionManager.evaluateAction("fs_read", { path: options.path });
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<FileReadResult>;

    try {
      const result = fsReadFile(options.path, { maxBytes: options.maxBytes });

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
      return failureResult(`Read failed: ${message}`, { path: policyEval.path, sessionId });
    }
  }

  /**
   * Write to a file.
   */
  async write(options: FsWriteOptions): Promise<ActionResult<FileWriteResult>> {
    const sessionId = this.getSessionId();

    const policyEval = this.context.sessionManager.evaluateAction("fs_write", { path: options.path });
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<FileWriteResult>;

    try {
      const result = fsWriteFile(options.path, options.content, {
        createDirs: options.createDirs,
      });

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
      return failureResult(`Write failed: ${message}`, { path: policyEval.path, sessionId });
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
      return failureResult(`List failed: ${message}`, { path: policyEval.path, sessionId });
    }
  }

  /**
   * Move or rename a file/directory.
   */
  async move(options: FsMoveOptions): Promise<ActionResult<MoveResult>> {
    const sessionId = this.getSessionId();

    const policyEval = this.context.sessionManager.evaluateAction("fs_move", { src: options.src, dst: options.dst });
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<MoveResult>;

    try {
      const result = fsMoveFile(options.src, options.dst);

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
      return failureResult(`Move failed: ${message}`, { path: policyEval.path, sessionId });
    }
  }

  /**
   * Delete a file or directory.
   */
  async rm(options: FsRmOptions): Promise<ActionResult<DeleteResult>> {
    const sessionId = this.getSessionId();

    const policyEval = this.context.sessionManager.evaluateAction("fs_delete", { path: options.path, recursive: options.recursive });
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<DeleteResult>;

    try {
      const deleteOpts: DeleteOptions = {
        recursive: options.recursive,
        force: options.force,
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
      return failureResult(`Delete failed: ${message}`, { path: policyEval.path, sessionId });
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
      const result = fsStatPath(options.path);

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
      return failureResult(`Stat failed: ${message}`, { path: policyEval.path, sessionId });
    }
  }
}
