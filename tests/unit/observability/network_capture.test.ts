/**
 * Network Capture Tests — Verify bounded ring buffer and error filtering.
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { NetworkCapture, getGlobalNetworkCapture, resetGlobalNetworkCapture } from "../../../src/observability/network_capture";

class FakePage {
  readonly handlers = new Map<string, Set<(payload: unknown) => void>>();

  on(event: string, handler: (payload: unknown) => void): void {
    const handlers = this.handlers.get(event) ?? new Set();
    handlers.add(handler);
    this.handlers.set(event, handlers);
  }

  off(event: string, handler: (payload: unknown) => void): void {
    this.handlers.get(event)?.delete(handler);
  }

  emit(event: string, params: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(params);
    }
  }
}

class FakeRequest {
  constructor(
    private readonly requestUrl: string,
    private readonly requestMethod = "GET",
    private readonly requestResourceType = "fetch",
    private readonly requestFailure?: string,
  ) {}

  url(): string {
    return this.requestUrl;
  }

  method(): string {
    return this.requestMethod;
  }

  resourceType(): string {
    return this.requestResourceType;
  }

  failure(): { errorText: string } | null {
    return this.requestFailure ? { errorText: this.requestFailure } : null;
  }
}

class FakeResponse {
  constructor(
    private readonly responseRequest: FakeRequest,
    private readonly responseStatus: number,
    private readonly responseUrl = responseRequest.url(),
  ) {}

  request(): FakeRequest {
    return this.responseRequest;
  }

  status(): number {
    return this.responseStatus;
  }

  url(): string {
    return this.responseUrl;
  }
}

describe("NetworkCapture", () => {
  it("records and retrieves entries", () => {
    const capture = new NetworkCapture();
    capture.recordEntry("session-1", {
      url: "https://example.com/api",
      method: "GET",
      status: 500,
      timestamp: "2024-01-01T00:00:00Z",
      sessionId: "session-1",
    });

    const entries = capture.getEntries("session-1");
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].status, 500);
  });

  it("respects the max entries bound", () => {
    const capture = new NetworkCapture({ maxEntries: 3 });
    for (let i = 0; i < 5; i++) {
      capture.recordEntry("session-1", {
        url: `https://example.com/${i}`,
        method: "GET",
        status: 400 + i,
        timestamp: "2024-01-01T00:00:00Z",
      });
    }

    const entries = capture.getEntries("session-1");
    assert.strictEqual(entries.length, 3);
  });

  it("filters errors", () => {
    const capture = new NetworkCapture();
    capture.recordEntry("s1", { url: "https://a.com", method: "GET", status: 200, timestamp: "2024-01-01T00:00:00Z" });
    capture.recordEntry("s1", { url: "https://b.com", method: "GET", status: 404, timestamp: "2024-01-01T00:00:00Z" });
    capture.recordEntry("s1", { url: "https://c.com", method: "GET", error: "timeout", timestamp: "2024-01-01T00:00:00Z" });

    const errors = capture.getErrors("s1");
    assert.strictEqual(errors.length, 2);
  });

  it("isolates sessions", () => {
    const capture = new NetworkCapture();
    capture.recordEntry("s1", { url: "https://a.com", method: "GET", status: 500, timestamp: "2024-01-01T00:00:00Z" });
    capture.recordEntry("s2", { url: "https://b.com", method: "GET", status: 500, timestamp: "2024-01-01T00:00:00Z" });

    assert.strictEqual(capture.getEntries("s1").length, 1);
    assert.strictEqual(capture.getEntries("s2").length, 1);
  });

  it("clears entries", () => {
    const capture = new NetworkCapture();
    capture.recordEntry("s1", { url: "https://a.com", method: "GET", status: 500, timestamp: "2024-01-01T00:00:00Z" });
    capture.clear("s1");
    assert.strictEqual(capture.getEntries("s1").length, 0);
  });

  it("clears all", () => {
    const capture = new NetworkCapture();
    capture.recordEntry("s1", { url: "https://a.com", method: "GET", status: 500, timestamp: "2024-01-01T00:00:00Z" });
    capture.recordEntry("s2", { url: "https://b.com", method: "GET", status: 500, timestamp: "2024-01-01T00:00:00Z" });
    capture.clearAll();
    assert.strictEqual(capture.getEntries("s1").length, 0);
    assert.strictEqual(capture.getEntries("s2").length, 0);
  });

  it("redacts URLs on record", () => {
    const capture = new NetworkCapture();
    capture.recordEntry("s1", {
      url: "https://example.com/api?token=secret",
      method: "GET",
      status: 500,
      timestamp: "2024-01-01T00:00:00Z",
    });

    const entries = capture.getEntries("s1");
    // URL encoding turns [REDACTED] into %5BREDACTED%5D
    assert(entries[0].url.includes("REDACTED"));
    assert(!entries[0].url.includes("secret"));
    assert.strictEqual(entries[0].redacted, true);
  });

  it("removes exact Playwright event listeners on stopCapture", () => {
    const capture = new NetworkCapture();
    const page = new FakePage();

    capture.startCapture("s1", page as any);
    capture.stopCapture("s1", page as any);

    page.emit("response", new FakeResponse(new FakeRequest("https://example.com/fail"), 500));

    assert.strictEqual(capture.getEntries("s1").length, 0);
  });

  it("captures a replacement page for the same session when the old page did not close", () => {
    const capture = new NetworkCapture();
    const stalePage = new FakePage();
    const replacementPage = new FakePage();
    const request = new FakeRequest("https://example.com/reconnected");

    capture.startCapture("s1", stalePage as any);
    capture.startCapture("s1", replacementPage as any);
    replacementPage.emit("request", request);
    replacementPage.emit("response", new FakeResponse(request, 500));

    const entries = capture.getEntries("s1");
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].url, "https://example.com/reconnected");
  });

  it("preserves URL and method for loading failures", () => {
    const capture = new NetworkCapture();
    const page = new FakePage();
    const request = new FakeRequest("https://example.com/api?token=supersecret", "POST", "fetch", "net::ERR_FAILED");

    capture.startCapture("s1", page as any);
    page.emit("request", request);
    page.emit("requestfailed", request);

    const entries = capture.getEntries("s1");
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].method, "POST");
    assert(entries[0].url.includes("https://example.com/api"));
    assert(!entries[0].url.includes("supersecret"));
    assert.strictEqual(entries[0].error, "net::ERR_FAILED");
  });

  it("preserves request method for HTTP error responses", () => {
    const capture = new NetworkCapture();
    const page = new FakePage();
    const request = new FakeRequest("https://example.com/api", "PATCH", "fetch");

    capture.startCapture("s1", page as any);
    page.emit("request", request);
    page.emit("response", new FakeResponse(request, 503));

    const entries = capture.getEntries("s1");
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].method, "PATCH");
    assert.strictEqual(entries[0].status, 503);
  });

  it("captures successful Playwright responses when enabled", () => {
    const capture = new NetworkCapture({ captureSuccess: true });
    const page = new FakePage();
    const request = new FakeRequest("https://example.com/ok", "GET", "document");

    capture.startCapture("s1", page as any);
    page.emit("request", request);
    page.emit("response", new FakeResponse(request, 200));

    const entries = capture.getEntries("s1");
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].url, "https://example.com/ok");
    assert.strictEqual(entries[0].status, 200);
    assert.strictEqual(entries[0].resourceType, "document");
  });
});

describe("getGlobalNetworkCapture", () => {
  it("returns a singleton", () => {
    const a = getGlobalNetworkCapture();
    const b = getGlobalNetworkCapture();
    assert.strictEqual(a, b);
  });

  it("can be reset", () => {
    const a = getGlobalNetworkCapture();
    resetGlobalNetworkCapture();
    const b = getGlobalNetworkCapture();
    assert.notStrictEqual(a, b);
  });
});
