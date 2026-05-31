/**
 * Policy Audit - Audit Logging and Persistence
 *
 * This module provides audit logging and persistence for policy decisions.
 *
 * AUDIT STORAGE DESIGN (v1):
 * - File-based JSONL logging with rotation under reports/policy-audit/
 * - Querying by session, actor, decision, and time range supported
 * - This design is intentional for v1: simple, append-only, no database dependency
 * - Future versions could add MemoryStore/session-keyed storage if needed
 * - The current approach ensures audit entries are not write-only and remain queryable
 */

import type { PolicyAuditEntry } from "./types";
import { getReportsDir } from "../shared/paths";
import { logger } from "../shared/logger";
import crypto from "node:crypto";
import fs from "fs";
import path from "path";
import { StringDecoder } from "string_decoder";

// ─── Audit Logger Options ───────────────────────────────────────────────

export interface AuditLoggerOptions {
  auditDir?: string;
  maxFileSizeBytes?: number;
  maxFiles?: number;
  enabled?: boolean;
}

export const POLICY_AUDIT_CLEAR_CONFIRMATION = "CLEAR_POLICY_AUDIT_LOGS";

export interface PolicyAuditClearOptions {
  confirm: typeof POLICY_AUDIT_CLEAR_CONFIRMATION;
  actor?: "human" | "agent" | "system";
  reason?: string;
}

// ─── Audit Logger Class ─────────────────────────────────────────────────

export class PolicyAuditLogger {
  private readonly auditLog = logger.withComponent("policy-audit");
  private auditDir: string;
  private maxFileSizeBytes: number;
  private maxFiles: number;
  private enabled: boolean;
  private currentLogFile: string | null = null;
  private currentFileSize: number = 0;
  private pendingWrite: Promise<void> = Promise.resolve();

  constructor(options: AuditLoggerOptions = {}) {
    this.auditDir = options.auditDir ?? path.join(getReportsDir(), "policy-audit");
    this.maxFileSizeBytes = options.maxFileSizeBytes ?? 10 * 1024 * 1024; // 10 MB
    this.maxFiles = options.maxFiles ?? 10;
    this.enabled = options.enabled ?? true;

    if (this.enabled) {
      this.ensureAuditDir();
      this.rotateIfNeeded();
    }
  }

  /**
   * Ensure the audit directory exists.
   */
  private ensureAuditDir(): void {
    try {
      fs.mkdirSync(this.auditDir, { recursive: true });
    } catch (error: unknown) {
      this.auditLog.error("Failed to create audit directory", {
        error: error instanceof Error ? error.message : String(error),
        auditDir: this.auditDir,
      });
    }
  }

  /**
   * Get the current log file name based on date.
   */
  private getCurrentLogFileName(): string {
    const date = new Date().toISOString().slice(0, 10);
    return `policy-audit-${date}.jsonl`;
  }

  /**
   * Rotate log files if the current file is too large.
   */
  private rotateIfNeeded(): void {
    if (!this.enabled) {
      return;
    }

    const logFileName = this.getCurrentLogFileName();
    const logFilePath = path.join(this.auditDir, logFileName);

    // Check if file exists and get its size
    if (fs.existsSync(logFilePath)) {
      const stats = fs.statSync(logFilePath);
      this.currentFileSize = stats.size;

      if (stats.size >= this.maxFileSizeBytes) {
        // Rotate by adding timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const rotatedName = `policy-audit-${timestamp}.jsonl`;
        const rotatedPath = path.join(this.auditDir, rotatedName);
        fs.renameSync(logFilePath, rotatedPath);
        this.currentFileSize = 0;
      }
    } else {
      this.currentFileSize = 0;
    }

    this.currentLogFile = logFilePath;

    // Clean up old files
    this.cleanupOldFiles();
  }

  /**
   * Clean up old audit files, keeping only the most recent maxFiles.
   */
  private cleanupOldFiles(): void {
    try {
      const files = fs.readdirSync(this.auditDir)
        .filter(f => f.startsWith("policy-audit-") && f.endsWith(".jsonl"))
        .map(f => ({
          name: f,
          path: path.join(this.auditDir, f),
          time: fs.statSync(path.join(this.auditDir, f)).mtime.getTime(),
        }))
        .sort((a, b) => b.time - a.time); // Sort by modification time, newest first

      if (files.length > this.maxFiles) {
        const filesToDelete = files.slice(this.maxFiles);
        for (const file of filesToDelete) {
          fs.unlinkSync(file.path);
        }
      }
    } catch (error: unknown) {
      this.auditLog.error("Failed to cleanup old audit files", {
        error: error instanceof Error ? error.message : String(error),
        auditDir: this.auditDir,
      });
    }
  }

  /**
   * Write an audit entry to the log file.
   */
  private writeEntry(entry: PolicyAuditEntry): void {
    if (!this.enabled) {
      return;
    }

    const line = JSON.stringify(entry) + "\n";
    this.pendingWrite = this.pendingWrite.then(
      () => this.appendEntryLine(line),
      () => this.appendEntryLine(line),
    );
  }

  private async appendEntryLine(line: string): Promise<void> {
    this.rotateIfNeeded();

    if (!this.currentLogFile) {
      return;
    }

    try {
      await fs.promises.appendFile(this.currentLogFile, line, { encoding: "utf-8" });
      this.currentFileSize += Buffer.byteLength(line, "utf-8");
    } catch (error: unknown) {
      this.auditLog.error("Failed to write audit entry", {
        error: error instanceof Error ? error.message : String(error),
        logFile: this.currentLogFile,
      });
    }
  }

  private listAuditFiles(): string[] {
    return fs.readdirSync(this.auditDir)
      .filter(f => f.startsWith("policy-audit-") && f.endsWith(".jsonl"))
      .sort()
      .reverse();
  }

  private scanAuditEntries(
    visitor: (entry: PolicyAuditEntry) => boolean | void,
  ): void {
    const files = this.listAuditFiles();
    for (const file of files) {
      const filePath = path.join(this.auditDir, file);
      const shouldContinue = this.scanAuditFile(filePath, visitor);
      if (!shouldContinue) {
        break;
      }
    }
  }

  private scanAuditFile(
    filePath: string,
    visitor: (entry: PolicyAuditEntry) => boolean | void,
  ): boolean {
    const fd = fs.openSync(filePath, "r");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    const decoder = new StringDecoder("utf8");
    let pending = "";

    try {
      let bytesRead = 0;
      while ((bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
        const chunk = pending + decoder.write(buffer.subarray(0, bytesRead));
        const lines = chunk.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) {
          if (!this.visitAuditLine(line, visitor)) {
            return false;
          }
        }
      }

      pending += decoder.end();
      if (pending.trim() !== "") {
        return this.visitAuditLine(pending, visitor);
      }
      return true;
    } finally {
      fs.closeSync(fd);
    }
  }

  private visitAuditLine(
    line: string,
    visitor: (entry: PolicyAuditEntry) => boolean | void,
  ): boolean {
    if (line.trim() === "") {
      return true;
    }
    try {
      const entry = JSON.parse(line) as PolicyAuditEntry;
      return visitor(entry) !== false;
    } catch {
      return true;
    }
  }

  private async writeClearMarker(files: string[], options: PolicyAuditClearOptions): Promise<void> {
    const deletedFiles = [];
    for (const file of files) {
      const filePath = path.join(this.auditDir, file);
      const stat = await fs.promises.stat(filePath);
      const content = await fs.promises.readFile(filePath);
      deletedFiles.push({
        name: file,
        sizeBytes: stat.size,
        sha256: crypto.createHash("sha256").update(content).digest("hex"),
      });
    }

    const marker = {
      timestamp: new Date().toISOString(),
      action: "policy_audit_clear",
      actor: options.actor ?? "system",
      reason: options.reason,
      deletedFiles,
    };

    await fs.promises.appendFile(
      path.join(this.auditDir, "audit-clear-events.jsonl"),
      `${JSON.stringify(marker)}\n`,
      { encoding: "utf-8" },
    );
  }

  /**
   * Log a policy decision.
   */
  log(entry: PolicyAuditEntry): void {
    this.writeEntry(entry);
  }

  /**
   * Query audit entries by session ID.
   */
  queryBySession(sessionId: string): PolicyAuditEntry[] {
    if (!this.enabled) {
      return [];
    }

    const entries: PolicyAuditEntry[] = [];
    try {
      this.scanAuditEntries((entry) => {
        if (entry.sessionId === sessionId) {
          entries.push(entry);
        }
      });
    } catch (error: unknown) {
      this.auditLog.error("Failed to query audit entries by session", {
        error: error instanceof Error ? error.message : String(error),
        sessionId,
      });
    }

    return entries;
  }

  /**
   * Query audit entries by actor.
   */
  queryByActor(actor: "human" | "agent"): PolicyAuditEntry[] {
    if (!this.enabled) {
      return [];
    }

    const entries: PolicyAuditEntry[] = [];
    try {
      this.scanAuditEntries((entry) => {
        if (entry.actor === actor) {
          entries.push(entry);
        }
      });
    } catch (error: unknown) {
      this.auditLog.error("Failed to query audit entries by actor", {
        error: error instanceof Error ? error.message : String(error),
        actor,
      });
    }

    return entries;
  }

  /**
   * Query audit entries by decision.
   */
  queryByDecision(decision: string): PolicyAuditEntry[] {
    if (!this.enabled) {
      return [];
    }

    const entries: PolicyAuditEntry[] = [];
    try {
      this.scanAuditEntries((entry) => {
        if (entry.decision === decision) {
          entries.push(entry);
        }
      });
    } catch (error: unknown) {
      this.auditLog.error("Failed to query audit entries by decision", {
        error: error instanceof Error ? error.message : String(error),
        decision,
      });
    }

    return entries;
  }

  /**
   * Query audit entries by time range.
   */
  queryByTimeRange(start: Date, end: Date): PolicyAuditEntry[] {
    if (!this.enabled) {
      return [];
    }

    const startTime = start.getTime();
    const endTime = end.getTime();
    const entries: PolicyAuditEntry[] = [];

    try {
      this.scanAuditEntries((entry) => {
        const entryTime = new Date(entry.timestamp).getTime();
        if (entryTime >= startTime && entryTime <= endTime) {
          entries.push(entry);
        }
      });
    } catch (error: unknown) {
      this.auditLog.error("Failed to query audit entries by time range", {
        error: error instanceof Error ? error.message : String(error),
        start: start.toISOString(),
        end: end.toISOString(),
      });
    }

    return entries;
  }

  /**
   * Get all audit entries.
   */
  getAll(limit?: number): PolicyAuditEntry[] {
    if (!this.enabled) {
      return [];
    }

    const entries: PolicyAuditEntry[] = [];
    try {
      this.scanAuditEntries((entry) => {
        entries.push(entry);
        if (limit && entries.length >= limit) {
          return false;
        }
      });
    } catch (error: unknown) {
      this.auditLog.error("Failed to get audit entries", {
        error: error instanceof Error ? error.message : String(error),
        limit,
      });
    }

    return limit ? entries.slice(0, limit) : entries;
  }

  /**
   * Clear all audit logs.
   */
  clear(options: PolicyAuditClearOptions): void {
    if (!this.enabled) {
      return;
    }

    if (options?.confirm !== POLICY_AUDIT_CLEAR_CONFIRMATION) {
      throw new Error(`Policy audit clear requires confirm=${POLICY_AUDIT_CLEAR_CONFIRMATION}`);
    }

    this.pendingWrite = this.pendingWrite.then(
      () => this.clearConfirmed(options),
      () => this.clearConfirmed(options),
    );
  }

  private async clearConfirmed(options: PolicyAuditClearOptions): Promise<void> {
    try {
      const files = fs.readdirSync(this.auditDir)
        .filter(f => f.startsWith("policy-audit-") && f.endsWith(".jsonl"));

      await this.writeClearMarker(files, options);

      for (const file of files) {
        await fs.promises.unlink(path.join(this.auditDir, file));
      }

      this.currentFileSize = 0;
      this.currentLogFile = null;
    } catch (error: unknown) {
      this.auditLog.error("Failed to clear audit logs", {
        error: error instanceof Error ? error.message : String(error),
        auditDir: this.auditDir,
      });
    }
  }

  /**
   * Enable or disable audit logging.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) {
      this.ensureAuditDir();
      this.rotateIfNeeded();
    }
  }

  /**
   * Wait until queued audit writes are persisted.
   */
  async flush(): Promise<void> {
    await this.pendingWrite;
  }

  /**
   * Close the audit logger.
   */
  async close(): Promise<void> {
    await this.flush();
  }
}

// ─── Default Singleton Instance ───────────────────────────────────────────

let defaultAuditLogger: PolicyAuditLogger | null = null;

export function getDefaultAuditLogger(): PolicyAuditLogger {
  if (!defaultAuditLogger) {
    defaultAuditLogger = new PolicyAuditLogger();
  }
  return defaultAuditLogger;
}

export function resetDefaultAuditLogger(): void {
  if (defaultAuditLogger) {
    void defaultAuditLogger.close();
    defaultAuditLogger = null;
  }
}
