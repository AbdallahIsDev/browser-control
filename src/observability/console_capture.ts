/**
 * Browser Console Capture — Bounded ring buffer for console entries.
 *
 * Captures console entries from active pages/sessions using Playwright page events.
 * Uses bounded ring buffers to prevent unbounded memory growth.
 * Includes secret redaction before storage.
 */

import type { ConsoleEntry, ConsoleLevel } from "./types";
import { redactConsoleEntry } from "./redaction";
import { OBSERVABILITY_KEYS } from "./types";
import type { MemoryStore } from "../runtime/memory_store";
import type { ConsoleMessage, Page } from "playwright";

// ── Ring Buffer ────────────────────────────────────────────────────────

class RingBuffer<T> {
  private readonly buffer: (T | undefined)[];
  private writeIndex = 0;
  private count = 0;

  constructor(private readonly capacity: number) {
    this.buffer = new Array(capacity);
  }

  push(item: T): void {
    this.buffer[this.writeIndex] = item;
    this.writeIndex = (this.writeIndex + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count++;
    }
  }

  toArray(): T[] {
    const result: T[] = [];
    if (this.count === 0) return result;

    const start = this.count < this.capacity
      ? 0
      : this.writeIndex;

    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % this.capacity;
      const item = this.buffer[idx];
      if (item !== undefined) {
        result.push(item);
      }
    }
    return result;
  }

  clear(): void {
    this.buffer.fill(undefined);
    this.writeIndex = 0;
    this.count = 0;
  }

  get size(): number {
    return this.count;
  }
}

// ── Console Capture ────────────────────────────────────────────────────

export interface ConsoleCaptureOptions {
  /** Max entries to keep per page/session (default: 1000) */
  maxEntries?: number;
  /** Which levels to capture (default: all) */
  levels?: ConsoleLevel[];
}

export class ConsoleCapture {
  private readonly buffers = new Map<string, RingBuffer<ConsoleEntry>>();
  private readonly options: Required<ConsoleCaptureOptions>;
  private pageListeners = new Map<string, (message: ConsoleMessage) => void>();
  private pageListenerIds = new WeakMap<Page, number>();
  private nextPageListenerId = 0;

  constructor(options: ConsoleCaptureOptions = {}) {
    this.options = {
      maxEntries: options.maxEntries ?? 1000,
      levels: options.levels ?? ["log", "warn", "error", "info", "debug"],
    };
  }

  /**
   * Start capturing console entries for a Playwright page.
   *
   * @param sessionId Unique session identifier
   * @param page Playwright page to observe
   */
  startCapture(sessionId: string, page: Page): void {
    const listenerKey = this.getPageListenerKey(sessionId, page);
    if (this.pageListeners.has(listenerKey)) return;

    const listener = (message: ConsoleMessage) => {
      this.handleConsoleMessage(sessionId, page, message);
    };

    page.on("console", listener);
    this.pageListeners.set(listenerKey, listener);
  }

  /**
   * Stop capturing console entries for a session.
   */
  stopCapture(
    sessionId: string,
    page: Page,
  ): void {
    const listenerKey = this.getPageListenerKey(sessionId, page);
    const listener = this.pageListeners.get(listenerKey);
    if (listener) {
      page.off("console", listener);
      this.pageListeners.delete(listenerKey);
    }
  }

  private getPageListenerKey(sessionId: string, page: Page): string {
    let pageId = this.pageListenerIds.get(page);
    if (pageId === undefined) {
      pageId = this.nextPageListenerId;
      this.nextPageListenerId += 1;
      this.pageListenerIds.set(page, pageId);
    }
    return `${sessionId}:${pageId}`;
  }

  /**
   * Record a console entry directly (for non-CDP sources or manual injection).
   */
  recordEntry(sessionId: string, entry: ConsoleEntry): void {
    if (!this.options.levels.includes(entry.level)) {
      return;
    }

    const buffer = this.getBuffer(sessionId);
    const redacted = redactConsoleEntry(entry);
    if (this.isRecentDuplicate(buffer, redacted)) {
      return;
    }
    buffer.push(redacted);
  }

  /**
   * Get all captured entries for a session.
   */
  getEntries(sessionId: string): ConsoleEntry[] {
    return this.getBuffer(sessionId).toArray();
  }

  /**
   * Get error-level entries for a session.
   */
  getErrors(sessionId: string): ConsoleEntry[] {
    return this.getEntries(sessionId).filter((e) => e.level === "error" || e.level === "warn");
  }

  /**
   * Clear captured entries for a session.
   */
  clear(sessionId: string): void {
    this.getBuffer(sessionId).clear();
  }

  /**
   * Clear all captured entries.
   */
  clearAll(): void {
    for (const buffer of this.buffers.values()) {
      buffer.clear();
    }
    this.buffers.clear();
    this.pageListeners.clear();
  }

  /**
   * Persist captured entries to MemoryStore.
   */
  persistToStore(store: MemoryStore, sessionId: string, ttlMs?: number): void {
    const entries = this.getEntries(sessionId);
    if (entries.length === 0) return;

    store.set(
      `${OBSERVABILITY_KEYS.consolePrefix}${sessionId}`,
      entries.slice(-100), // Persist last 100 only
      ttlMs,
    );
  }

  /**
   * Load captured entries from MemoryStore.
   */
  loadFromStore(store: MemoryStore, sessionId: string): ConsoleEntry[] {
    return store.get<ConsoleEntry[]>(`${OBSERVABILITY_KEYS.consolePrefix}${sessionId}`) ?? [];
  }

  private getBuffer(sessionId: string): RingBuffer<ConsoleEntry> {
    let buffer = this.buffers.get(sessionId);
    if (!buffer) {
      buffer = new RingBuffer<ConsoleEntry>(this.options.maxEntries);
      this.buffers.set(sessionId, buffer);
    }
    return buffer;
  }

  private isRecentDuplicate(buffer: RingBuffer<ConsoleEntry>, entry: ConsoleEntry): boolean {
    const entryTime = Date.parse(entry.timestamp);
    const recentEntries = buffer.toArray().slice(-10);
    return recentEntries.some((existing) => {
      const existingTime = Date.parse(existing.timestamp);
      const closeInTime = Number.isFinite(entryTime) && Number.isFinite(existingTime)
        ? Math.abs(entryTime - existingTime) <= 1000
        : existing.timestamp === entry.timestamp;

      return closeInTime
        && existing.level === entry.level
        && existing.message === entry.message
        && this.optionalFieldMatches(existing.source, entry.source)
        && this.optionalFieldMatches(existing.line, entry.line)
        && this.optionalFieldMatches(existing.column, entry.column);
    });
  }

  private optionalFieldMatches<T>(left: T | undefined, right: T | undefined): boolean {
    return left === undefined || right === undefined || left === right;
  }

  private handleConsoleMessage(sessionId: string, page: Page, message: ConsoleMessage): void {
    const level = this.toConsoleLevel(message.type());
    if (!level || !this.options.levels.includes(level)) {
      return;
    }

    const location = message.location();
    const entry: ConsoleEntry = {
      level,
      message: message.text(),
      timestamp: new Date().toISOString(),
      source: location.url || undefined,
      line: typeof location.lineNumber === "number" ? location.lineNumber : undefined,
      column: typeof location.columnNumber === "number" ? location.columnNumber : undefined,
      pageUrl: page.url(),
      sessionId,
    };

    this.recordEntry(sessionId, entry);
  }

  private toConsoleLevel(level: string): ConsoleLevel | null {
    if (level === "warning") return "warn";
    if (["log", "warn", "error", "info", "debug"].includes(level)) {
      return level as ConsoleLevel;
    }
    return null;
  }
}

// ── Global Instance ────────────────────────────────────────────────────

let globalCapture: ConsoleCapture | null = null;

export function getGlobalConsoleCapture(options?: ConsoleCaptureOptions): ConsoleCapture {
  if (!globalCapture) {
    globalCapture = new ConsoleCapture(options);
  }
  return globalCapture;
}

export function resetGlobalConsoleCapture(): void {
  globalCapture = null;
}
