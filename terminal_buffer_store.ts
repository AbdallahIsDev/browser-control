/**
 * Terminal Buffer Store — Scrollback buffer persistence with size limits.
 *
 * Saves and loads terminal buffer state to/from the durable MemoryStore.
 * Enforces configurable max scrollback lines and truncates oldest content first.
 */

import { MemoryStore } from "./memory_store";
import type { TerminalBufferRecord } from "./terminal_resume_types";

const DEFAULT_MAX_SCROLLBACK_LINES = 10_000;

/** Storage key prefix for terminal buffers. */
export const TERMINAL_BUFFER_KEY = "terminal:buffer:";

/** Storage key prefix for serialized terminal sessions. */
export const TERMINAL_METADATA_KEY = "terminal:session:";

/** Storage key prefix for pending-resume marker. */
export const TERMINAL_PENDING_KEY = "terminal:resume-pending:";

export interface BufferStoreOptions {
  maxScrollbackLines?: number;
}

interface PendingRecord {
  sessionId: string;
  markedAt?: string;
}

export class TerminalBufferStore {
  private readonly store: MemoryStore;
  private readonly maxScrollbackLines: number;

  constructor(store: MemoryStore, options: BufferStoreOptions = {}) {
    this.store = store;
    this.maxScrollbackLines = options.maxScrollbackLines ?? DEFAULT_MAX_SCROLLBACK_LINES;
  }

  /**
   * Save a buffer record for a session.
   *
   * Truncates scrollback to maxScrollbackLines, keeping newest lines.
   */
  saveBuffer(sessionId: string, record: TerminalBufferRecord): void {
    const truncated: TerminalBufferRecord = {
      ...record,
      scrollback: this.truncateLines(record.scrollback),
    };
    this.store.set(`${TERMINAL_BUFFER_KEY}${sessionId}`, truncated);
  }

  /**
   * Load a buffer record for a session.
   */
  loadBuffer(sessionId: string): TerminalBufferRecord | null {
    try {
      const record = this.store.get<TerminalBufferRecord>(`${TERMINAL_BUFFER_KEY}${sessionId}`);
      if (!record || !Array.isArray(record.scrollback)) return null;
      return record;
    } catch {
      return null;
    }
  }

  /**
   * Delete a buffer record.
   */
  deleteBuffer(sessionId: string): void {
    this.store.delete(`${TERMINAL_BUFFER_KEY}${sessionId}`);
  }

  /**
   * Save serialized terminal session metadata.
   */
  saveSession(sessionId: string, data: unknown): void {
    this.store.set(`${TERMINAL_METADATA_KEY}${sessionId}`, data);
  }

  /**
   * Load serialized terminal session metadata.
   */
  loadSession(sessionId: string): unknown | null {
    try {
      return this.store.get<unknown>(`${TERMINAL_METADATA_KEY}${sessionId}`);
    } catch {
      return null;
    }
  }

  /**
   * Delete serialized terminal session metadata.
   */
  deleteSession(sessionId: string): void {
    this.store.delete(`${TERMINAL_METADATA_KEY}${sessionId}`);
  }

  /**
   * Mark a session as pending resume.
   */
  markPending(sessionId: string): void {
    this.store.set(`${TERMINAL_PENDING_KEY}${sessionId}`, { sessionId, markedAt: new Date().toISOString() });
  }

  /**
   * Remove pending-resume marker.
   */
  unmarkPending(sessionId: string): void {
    this.store.delete(`${TERMINAL_PENDING_KEY}${sessionId}`);
  }

  /**
   * List all session IDs that have a pending-resume marker.
   */
  listPending(): string[] {
    const keys = this.store.keys(TERMINAL_PENDING_KEY);
    return keys.map((k) => k.slice(TERMINAL_PENDING_KEY.length));
  }

  /**
   * Keep only the newest pending serialized sessions.
   *
   * Returns the session ids that were evicted.
   */
  enforceMaxSerializedSessions(maxSessions: number): string[] {
    const limit = Math.max(0, Math.floor(maxSessions));
    const pending = this.listPendingRecords();
    if (pending.length <= limit) {
      return [];
    }

    const toRemove = pending.slice(0, pending.length - limit);
    for (const record of toRemove) {
      this.deleteSession(record.sessionId);
      this.deleteBuffer(record.sessionId);
      this.unmarkPending(record.sessionId);
    }
    return toRemove.map((record) => record.sessionId);
  }

  /**
   * Clean up stale records for sessions that are no longer pending and have no buffer.
   */
  cleanup(maxAgeMs?: number): void {
    const now = Date.now();
    const pending = new Set(this.listPending());

    // Clean up old session metadata
    const sessionKeys = this.store.keys(TERMINAL_METADATA_KEY);
    for (const key of sessionKeys) {
      const sessionId = key.slice(TERMINAL_METADATA_KEY.length);
      if (pending.has(sessionId)) continue;

      const data = this.store.get<{ serializedAt?: string }>(key);
      if (maxAgeMs && data?.serializedAt) {
        const age = now - new Date(data.serializedAt).getTime();
        if (age > maxAgeMs) {
          this.store.delete(key);
          this.store.delete(`${TERMINAL_BUFFER_KEY}${sessionId}`);
        }
      }
    }
  }

  /**
   * Truncate scrollback lines to maxScrollbackLines, keeping newest.
   */
  private truncateLines(lines: string[]): string[] {
    if (lines.length <= this.maxScrollbackLines) return lines;
    return lines.slice(lines.length - this.maxScrollbackLines);
  }

  private listPendingRecords(): PendingRecord[] {
    return this.store.keys(TERMINAL_PENDING_KEY)
      .map((key) => {
        const sessionId = key.slice(TERMINAL_PENDING_KEY.length);
        const record = this.store.get<Partial<PendingRecord>>(key);
        return {
          sessionId,
          markedAt: typeof record?.markedAt === "string" ? record.markedAt : undefined,
        };
      })
      .sort((a, b) => {
        const aTime = a.markedAt ? Date.parse(a.markedAt) : 0;
        const bTime = b.markedAt ? Date.parse(b.markedAt) : 0;
        if (aTime !== bTime) return aTime - bTime;
        return a.sessionId.localeCompare(b.sessionId);
      });
  }
}
