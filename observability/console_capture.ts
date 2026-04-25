/**
 * Browser Console Capture — Bounded ring buffer for console entries.
 *
 * Captures console entries from active pages/sessions using CDP Runtime/Console domains.
 * Uses bounded ring buffers to prevent unbounded memory growth.
 * Includes secret redaction before storage.
 */

import type { ConsoleEntry, ConsoleLevel } from "./types";
import { redactConsoleEntry } from "./redaction";
import { OBSERVABILITY_KEYS } from "./types";
import type { MemoryStore } from "../memory_store";

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
  private cdpListeners = new Map<string, (params: Record<string, unknown>) => void>();

  constructor(options: ConsoleCaptureOptions = {}) {
    this.options = {
      maxEntries: options.maxEntries ?? 1000,
      levels: options.levels ?? ["log", "warn", "error", "info", "debug"],
    };
  }

  /**
   * Start capturing console entries for a CDP session.
   *
   * @param sessionId Unique session identifier
   * @param cdpClient CDP client with `on` and `off` methods (e.g., from playwright)
   */
  startCapture(
    sessionId: string,
    cdpClient: {
      on: (event: string, handler: (params: Record<string, unknown>) => void) => void;
      off: (event: string, handler: (params: Record<string, unknown>) => void) => void;
      send?: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
    },
  ): void {
    if (this.cdpListeners.has(sessionId)) {
      // Already capturing for this session
      return;
    }

    // Enable console and runtime domains if possible
    if (cdpClient.send) {
      void cdpClient.send("Runtime.enable", {}).catch(() => {});
      void cdpClient.send("Console.enable", {}).catch(() => {});
    }

    const listener = (params: Record<string, unknown>) => {
      this.handleConsoleEvent(sessionId, params);
    };

    cdpClient.on("Console.messageAdded", listener);
    cdpClient.on("Runtime.consoleAPICalled", listener);

    this.cdpListeners.set(sessionId, listener);
  }

  /**
   * Stop capturing console entries for a session.
   */
  stopCapture(
    sessionId: string,
    cdpClient: {
      off: (event: string, handler: (params: Record<string, unknown>) => void) => void;
    },
  ): void {
    const listener = this.cdpListeners.get(sessionId);
    if (listener) {
      cdpClient.off("Console.messageAdded", listener);
      cdpClient.off("Runtime.consoleAPICalled", listener);
      this.cdpListeners.delete(sessionId);
    }
  }

  /**
   * Record a console entry directly (for non-CDP sources or manual injection).
   */
  recordEntry(sessionId: string, entry: ConsoleEntry): void {
    if (!this.options.levels.includes(entry.level)) {
      return;
    }

    const buffer = this.getBuffer(sessionId);
    buffer.push(redactConsoleEntry(entry));
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
    this.cdpListeners.clear();
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

  private handleConsoleEvent(sessionId: string, params: Record<string, unknown>): void {
    const level = this.extractLevel(params);
    if (!level || !this.options.levels.includes(level)) {
      return;
    }

    const entry: ConsoleEntry = {
      level,
      message: this.extractMessage(params),
      timestamp: new Date().toISOString(),
      source: this.extractSource(params),
      line: this.extractLine(params),
      column: this.extractColumn(params),
      sessionId,
    };

    this.recordEntry(sessionId, entry);
  }

  private extractLevel(params: Record<string, unknown>): ConsoleLevel | null {
    // Console.messageAdded format
    if (params.message && typeof params.message === "object") {
      const msg = params.message as Record<string, unknown>;
      const level = msg.level;
      if (typeof level === "string" && this.isValidLevel(level)) {
        return level as ConsoleLevel;
      }
    }

    // Runtime.consoleAPICalled format
    if (typeof params.type === "string" && this.isValidLevel(params.type)) {
      return params.type as ConsoleLevel;
    }

    return null;
  }

  private extractMessage(params: Record<string, unknown>): string {
    if (params.message && typeof params.message === "object") {
      const msg = params.message as Record<string, unknown>;
      if (typeof msg.text === "string") return msg.text;
    }

    if (Array.isArray(params.args)) {
      return params.args
        .map((arg: unknown) => {
          if (typeof arg === "object" && arg !== null) {
            const obj = arg as Record<string, unknown>;
            if (typeof obj.value !== "undefined") return String(obj.value);
            if (typeof obj.description === "string") return obj.description;
          }
          return String(arg);
        })
        .join(" ");
    }

    if (typeof params.text === "string") return params.text;

    return JSON.stringify(params);
  }

  private extractSource(params: Record<string, unknown>): string | undefined {
    if (params.message && typeof params.message === "object") {
      const msg = params.message as Record<string, unknown>;
      if (typeof msg.source === "string") return msg.source;
      if (typeof msg.url === "string") return msg.url;
    }
    if (typeof params.url === "string") return params.url;
    return undefined;
  }

  private extractLine(params: Record<string, unknown>): number | undefined {
    if (params.message && typeof params.message === "object") {
      const msg = params.message as Record<string, unknown>;
      if (typeof msg.line === "number") return msg.line;
    }
    if (typeof params.lineNumber === "number") return params.lineNumber;
    return undefined;
  }

  private extractColumn(params: Record<string, unknown>): number | undefined {
    if (params.message && typeof params.message === "object") {
      const msg = params.message as Record<string, unknown>;
      if (typeof msg.column === "number") return msg.column;
    }
    if (typeof params.columnNumber === "number") return params.columnNumber;
    return undefined;
  }

  private isValidLevel(level: string): boolean {
    return ["log", "warn", "error", "info", "debug"].includes(level);
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