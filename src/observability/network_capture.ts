/**
 * Browser Network Capture — Bounded ring buffer for network events.
 *
 * Captures request failures and important HTTP errors from active pages/sessions.
 * Uses bounded buffers. Redacts query tokens, auth headers, cookies, API keys,
 * and provider credentials before storage.
 */

import type { NetworkEntry } from "./types";
import { redactNetworkEntry } from "./redaction";
import { OBSERVABILITY_KEYS } from "./types";
import type { MemoryStore } from "../runtime/memory_store";
import type { Page, Request, Response } from "playwright-core";

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

type PageRequestHandler = (request: Request) => void;
type PageResponseHandler = (response: Response) => void;

interface PageListenerSet {
  request: PageRequestHandler;
  requestFailed: PageRequestHandler;
  requestFinished: PageRequestHandler;
  response: PageResponseHandler;
}

interface RequestMetadata {
  url: string;
  method: string;
  startTime: number;
}

export class NetworkCapture {
  private readonly buffers = new Map<string, RingBuffer<NetworkEntry>>();
  private readonly options: Required<NetworkCaptureOptions>;
  private pageListeners = new Map<string, PageListenerSet>();
  private requestMetadata = new WeakMap<Request, RequestMetadata>();
  private pageListenerIds = new WeakMap<Page, number>();
  private nextPageListenerId = 0;

  constructor(options: NetworkCaptureOptions = {}) {
    this.options = {
      maxEntries: options.maxEntries ?? 1000,
      captureSuccess: options.captureSuccess ?? false,
      errorStatusThreshold: options.errorStatusThreshold ?? 400,
    };
  }

  /**
   * Start capturing network events for a Playwright page.
   */
  startCapture(sessionId: string, page: Page): void {
    const listenerKey = this.getPageListenerKey(sessionId, page);
    if (this.pageListeners.has(listenerKey)) return;

    const request: PageRequestHandler = (request) => {
      this.handleRequest(sessionId, request);
    };
    const requestFailed: PageRequestHandler = (request) => {
      this.handleRequestFailed(sessionId, request);
    };
    const requestFinished: PageRequestHandler = (request) => {
      this.requestMetadata.delete(request);
    };
    const response: PageResponseHandler = (response) => {
      this.handleResponse(sessionId, response);
    };

    page.on("request", request);
    page.on("requestfailed", requestFailed);
    page.on("requestfinished", requestFinished);
    page.on("response", response);

    this.pageListeners.set(listenerKey, {
      request,
      requestFailed,
      requestFinished,
      response,
    });
  }

  /**
   * Stop capturing network events for a session.
   */
  stopCapture(
    sessionId: string,
    page: Page,
  ): void {
    const listenerKey = this.getPageListenerKey(sessionId, page);
    const listeners = this.pageListeners.get(listenerKey);
    if (listeners) {
      page.off("request", listeners.request);
      page.off("requestfailed", listeners.requestFailed);
      page.off("requestfinished", listeners.requestFinished);
      page.off("response", listeners.response);
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
    this.pageListeners.clear();
    this.requestMetadata = new WeakMap<Request, RequestMetadata>();
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

  private handleRequest(_sessionId: string, request: Request): void {
    this.requestMetadata.set(request, {
      url: request.url(),
      method: request.method(),
      startTime: Date.now(),
    });
  }

  private handleRequestFailed(sessionId: string, request: Request): void {
    const metadata = this.requestMetadata.get(request);
    const failure = request.failure();

    const entry: NetworkEntry = {
      url: metadata?.url ?? request.url(),
      method: metadata?.method ?? request.method(),
      error: failure?.errorText ?? "Network loading failed",
      timestamp: new Date().toISOString(),
      durationMs: metadata ? Date.now() - metadata.startTime : undefined,
      resourceType: request.resourceType(),
      sessionId,
    };

    this.recordEntry(sessionId, entry);
    this.requestMetadata.delete(request);
  }

  private handleResponse(sessionId: string, response: Response): void {
    const request = response.request();
    const status = response.status();

    const shouldCapture =
      status >= this.options.errorStatusThreshold ||
      this.options.captureSuccess;

    if (!shouldCapture) return;

    const metadata = this.requestMetadata.get(request);

    const entry: NetworkEntry = {
      url: response.url() || metadata?.url || request.url(),
      method: metadata?.method ?? request.method(),
      status,
      timestamp: new Date().toISOString(),
      durationMs: metadata ? Date.now() - metadata.startTime : undefined,
      resourceType: request.resourceType(),
      sessionId,
    };

    this.recordEntry(sessionId, entry);
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
