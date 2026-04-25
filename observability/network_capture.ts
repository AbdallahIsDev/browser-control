/**
 * Browser Network Capture — Bounded ring buffer for network events.
 *
 * Captures request failures and important HTTP errors from active pages/sessions.
 * Uses bounded buffers. Redacts query tokens, auth headers, cookies, API keys,
 * and provider credentials before storage.
 */

import type { NetworkEntry } from "./types";
import { redactNetworkEntry, redactUrl, redactHeaders } from "./redaction";
import { OBSERVABILITY_KEYS } from "./types";
import type { MemoryStore } from "../memory_store";

// ── Ring Buffer (shared with console_capture pattern) ──────────────────

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

// ── Network Capture ────────────────────────────────────────────────────

export interface NetworkCaptureOptions {
  /** Max entries to keep per page/session (default: 1000) */
  maxEntries?: number;
  /** Capture successful requests too (default: false, only errors) */
  captureSuccess?: boolean;
  /** Minimum status code to capture as error (default: 400) */
  errorStatusThreshold?: number;
}

type CdpHandler = (params: Record<string, unknown>) => void;

interface CdpListenerSet {
  requestWillBeSent: CdpHandler;
  loadingFinished: CdpHandler;
  loadingFailed: CdpHandler;
  responseReceived: CdpHandler;
}

interface RequestMetadata {
  url: string;
  method: string;
  startTime: number;
}

export class NetworkCapture {
  private readonly buffers = new Map<string, RingBuffer<NetworkEntry>>();
  private readonly options: Required<NetworkCaptureOptions>;
  private cdpListeners = new Map<string, CdpListenerSet>();
  private requestMetadata = new Map<string, RequestMetadata>();

  constructor(options: NetworkCaptureOptions = {}) {
    this.options = {
      maxEntries: options.maxEntries ?? 1000,
      captureSuccess: options.captureSuccess ?? false,
      errorStatusThreshold: options.errorStatusThreshold ?? 400,
    };
  }

  /**
   * Start capturing network events for a CDP session.
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
      return;
    }

    if (cdpClient.send) {
      void cdpClient.send("Network.enable", {}).catch(() => {});
    }

    const requestWillBeSent: CdpHandler = (params) => {
      this.handleRequestWillBeSent(sessionId, params);
    };

    const loadingFinished: CdpHandler = (params) => {
      this.handleLoadingFinished(sessionId, params);
    };

    const loadingFailed: CdpHandler = (params) => {
      this.handleLoadingFailed(sessionId, params);
    };

    const responseReceived: CdpHandler = (params) => {
      this.handleResponseReceived(sessionId, params);
    };

    cdpClient.on("Network.requestWillBeSent", requestWillBeSent);
    cdpClient.on("Network.loadingFinished", loadingFinished);
    cdpClient.on("Network.loadingFailed", loadingFailed);
    cdpClient.on("Network.responseReceived", responseReceived);

    this.cdpListeners.set(sessionId, {
      requestWillBeSent,
      loadingFinished,
      loadingFailed,
      responseReceived,
    });
  }

  /**
   * Stop capturing network events for a session.
   */
  stopCapture(
    sessionId: string,
    cdpClient: {
      off: (event: string, handler: (params: Record<string, unknown>) => void) => void;
    },
  ): void {
    const listeners = this.cdpListeners.get(sessionId);
    if (listeners) {
      cdpClient.off("Network.requestWillBeSent", listeners.requestWillBeSent);
      cdpClient.off("Network.loadingFinished", listeners.loadingFinished);
      cdpClient.off("Network.loadingFailed", listeners.loadingFailed);
      cdpClient.off("Network.responseReceived", listeners.responseReceived);
      this.cdpListeners.delete(sessionId);
    }
    // Clean up timings for this session
    for (const [key] of this.requestMetadata) {
      if (key.startsWith(`${sessionId}:`)) {
        this.requestMetadata.delete(key);
      }
    }
  }

  /**
   * Record a network entry directly.
   */
  recordEntry(sessionId: string, entry: NetworkEntry): void {
    const buffer = this.getBuffer(sessionId);
    buffer.push(redactNetworkEntry(entry));
  }

  /**
   * Get all captured entries for a session.
   */
  getEntries(sessionId: string): NetworkEntry[] {
    return this.getBuffer(sessionId).toArray();
  }

  /**
   * Get error/failure entries for a session.
   */
  getErrors(sessionId: string): NetworkEntry[] {
    return this.getEntries(sessionId).filter((e) =>
      (e.status && e.status >= this.options.errorStatusThreshold) ||
      e.error !== undefined,
    );
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
    this.requestMetadata.clear();
  }

  /**
   * Persist captured entries to MemoryStore.
   */
  persistToStore(store: MemoryStore, sessionId: string, ttlMs?: number): void {
    const entries = this.getEntries(sessionId);
    if (entries.length === 0) return;

    store.set(
      `${OBSERVABILITY_KEYS.networkPrefix}${sessionId}`,
      entries.slice(-100),
      ttlMs,
    );
  }

  /**
   * Load captured entries from MemoryStore.
   */
  loadFromStore(store: MemoryStore, sessionId: string): NetworkEntry[] {
    return store.get<NetworkEntry[]>(`${OBSERVABILITY_KEYS.networkPrefix}${sessionId}`) ?? [];
  }

  private getBuffer(sessionId: string): RingBuffer<NetworkEntry> {
    let buffer = this.buffers.get(sessionId);
    if (!buffer) {
      buffer = new RingBuffer<NetworkEntry>(this.options.maxEntries);
      this.buffers.set(sessionId, buffer);
    }
    return buffer;
  }

  private handleRequestWillBeSent(sessionId: string, params: Record<string, unknown>): void {
    const requestId = params.requestId as string;
    if (!requestId) return;

    const url = this.extractUrl(params);
    if (!url) return;

    const request = params.request as Record<string, unknown> | undefined;
    const method = typeof request?.method === "string" ? request.method : "GET";
    this.requestMetadata.set(`${sessionId}:${requestId}`, {
      url,
      method,
      startTime: Date.now(),
    });
  }

  private handleLoadingFinished(sessionId: string, params: Record<string, unknown>): void {
    const requestId = params.requestId as string;
    if (!requestId) return;

    // responseReceived captures errors/successes when configured; loadingFinished
    // is the cleanup point for uncaptured successful requests.
    this.requestMetadata.delete(`${sessionId}:${requestId}`);
  }

  private handleLoadingFailed(sessionId: string, params: Record<string, unknown>): void {
    const requestId = params.requestId as string;
    if (!requestId) return;

    const metadata = this.requestMetadata.get(`${sessionId}:${requestId}`);
    const errorText = params.errorText as string | undefined;

    const entry: NetworkEntry = {
      url: metadata?.url ?? "unknown",
      method: metadata?.method ?? "GET",
      error: errorText ?? "Network loading failed",
      timestamp: new Date().toISOString(),
      durationMs: metadata ? Date.now() - metadata.startTime : undefined,
      sessionId,
    };

    this.recordEntry(sessionId, entry);
    this.requestMetadata.delete(`${sessionId}:${requestId}`);
  }

  private handleResponseReceived(sessionId: string, params: Record<string, unknown>): void {
    const requestId = params.requestId as string;
    if (!requestId) return;

    const response = params.response as Record<string, unknown> | undefined;
    if (!response) return;

    const status = response.status as number | undefined;
    if (!status) return;

    const shouldCapture =
      status >= this.options.errorStatusThreshold ||
      this.options.captureSuccess;

    if (!shouldCapture) return;

    const metadata = this.requestMetadata.get(`${sessionId}:${requestId}`);
    const url = (response.url as string) ?? metadata?.url ?? "unknown";

    const entry: NetworkEntry = {
      url,
      method: metadata?.method ?? "GET",
      status,
      timestamp: new Date().toISOString(),
      durationMs: metadata ? Date.now() - metadata.startTime : undefined,
      sessionId,
    };

    this.recordEntry(sessionId, entry);
    this.requestMetadata.delete(`${sessionId}:${requestId}`);
  }

  private extractUrl(params: Record<string, unknown>): string | null {
    const request = params.request as Record<string, unknown> | undefined;
    if (request && typeof request.url === "string") {
      return request.url;
    }
    if (typeof params.url === "string") {
      return params.url;
    }
    return null;
  }

}

// ── Global Instance ────────────────────────────────────────────────────

let globalCapture: NetworkCapture | null = null;

export function getGlobalNetworkCapture(options?: NetworkCaptureOptions): NetworkCapture {
  if (!globalCapture) {
    globalCapture = new NetworkCapture(options);
  }
  return globalCapture;
}

export function resetGlobalNetworkCapture(): void {
  globalCapture = null;
}
