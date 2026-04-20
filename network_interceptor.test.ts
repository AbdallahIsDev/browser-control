import assert from "node:assert/strict";
import describe from "node:test";
import type { Page, Route, Response } from "playwright";
import { NetworkInterceptor, captureJsonResponse, blockResource, mockResponse } from "./network_interceptor";

/** Create a mock page with working route and event support. */
function createMockPage(options: {
  routes?: Map<string, (route: Route) => Promise<void>>;
  responseListeners?: Array<(response: Response) => void>;
} = {}): Page {
  const routes = options.routes ?? new Map<string, (route: Route) => Promise<void>>();
  const responseListeners = options.responseListeners ?? [];

  return {
    route: async (urlPattern: string | RegExp, handler: (route: Route) => Promise<void>) => {
      const key = typeof urlPattern === "string" ? urlPattern : urlPattern.source;
      routes.set(key, handler);
    },
    unroute: async (urlPattern: string | RegExp) => {
      const key = typeof urlPattern === "string" ? urlPattern : urlPattern.source;
      routes.delete(key);
    },
    on: (event: string, listener: (...args: unknown[]) => void) => {
      if (event === "response") {
        responseListeners.push(listener as (response: Response) => void);
      }
    },
    removeListener: (event: string, listener: (...args: unknown[]) => void) => {
      if (event === "response") {
        const idx = responseListeners.indexOf(listener as (response: Response) => void);
        if (idx !== -1) responseListeners.splice(idx, 1);
      }
    },
    // Expose a way to simulate responses in tests
    _emitResponse(url: string, status: number, body?: unknown) {
      const response = {
        url: () => url,
        status: () => status,
        headers: () => ({ "content-type": "application/json" }),
        json: async () => body,
      } as unknown as Response;
      for (const listener of responseListeners) {
        listener(response);
      }
    },
  } as unknown as Page & { _emitResponse: (url: string, status: number, body?: unknown) => void };
}

describe.describe("NetworkInterceptor", () => {
  describe.describe("constructor", () => {
    describe.it("creates an interceptor with default options", () => {
      const interceptor = new NetworkInterceptor();
      assert.ok(interceptor);
      assert.deepEqual(interceptor.getCapturedResponses(), []);
    });

    describe.it("accepts custom maxCapturedResponses", () => {
      const interceptor = new NetworkInterceptor({ maxCapturedResponses: 5 });
      assert.ok(interceptor);
    });
  });

  describe.describe("intercept", () => {
    describe.it("registers a route with abort action", async () => {
      const routes = new Map<string, (route: Route) => Promise<void>>();
      const page = createMockPage({ routes });
      const interceptor = new NetworkInterceptor();

      await interceptor.intercept(page, {
        urlPattern: "/api/block-me",
        action: "abort",
      });
      assert.equal(routes.size, 1);
      assert.ok(routes.has("/api/block-me"));
    });

    describe.it("registers a route with fulfill action", async () => {
      const routes = new Map<string, (route: Route) => Promise<void>>();
      const page = createMockPage({ routes });
      const interceptor = new NetworkInterceptor();

      await interceptor.intercept(page, {
        urlPattern: "/api/mock",
        action: "fulfill",
        fulfillOptions: {
          status: 200,
          body: { mocked: true },
        },
      });
      assert.equal(routes.size, 1);
      assert.ok(routes.has("/api/mock"));
    });

    describe.it("registers a route with continue action", async () => {
      const routes = new Map<string, (route: Route) => Promise<void>>();
      const page = createMockPage({ routes });
      const interceptor = new NetworkInterceptor();

      await interceptor.intercept(page, {
        urlPattern: "/api/passthrough",
        action: "continue",
      });
      assert.equal(routes.size, 1);
    });

    describe.it("calls route.abort() for abort action", async () => {
      const routes = new Map<string, (route: Route) => Promise<void>>();
      const page = createMockPage({ routes });
      const interceptor = new NetworkInterceptor();

      await interceptor.intercept(page, {
        urlPattern: "/api/block",
        action: "abort",
      });

      let aborted = false;
      const mockRoute = {
        abort: async () => { aborted = true; },
        continue: async () => {},
        fulfill: async () => {},
        fetch: async () => ({}),
      } as unknown as Route;

      await routes.get("/api/block")!(mockRoute);
      assert.equal(aborted, true);
    });

    describe.it("calls route.fulfill() for fulfill action with correct options", async () => {
      const routes = new Map<string, (route: Route) => Promise<void>>();
      const page = createMockPage({ routes });
      const interceptor = new NetworkInterceptor();

      await interceptor.intercept(page, {
        urlPattern: "/api/mock",
        action: "fulfill",
        fulfillOptions: {
          status: 201,
          body: { result: "ok" },
          contentType: "application/json",
        },
      });

      let fulfilled: { status?: number; body?: string; headers?: Record<string, string> } = {};
      const mockRoute = {
        abort: async () => {},
        continue: async () => {},
        fulfill: async (opts: { status?: number; body?: string; headers?: Record<string, string> }) => {
          fulfilled = opts;
        },
        fetch: async () => ({}),
      } as unknown as Route;

      await routes.get("/api/mock")!(mockRoute);
      assert.equal(fulfilled.status, 201);
      assert.equal(fulfilled.body, JSON.stringify({ result: "ok" }));
      assert.equal(fulfilled.headers?.["Content-Type"], "application/json");
    });

    describe.it("predicate controls whether handler fires", async () => {
      const routes = new Map<string, (route: Route) => Promise<void>>();
      const page = createMockPage({ routes });
      const interceptor = new NetworkInterceptor();

      // Only handle requests with a specific header
      await interceptor.intercept(page, {
        urlPattern: "/api/conditional",
        action: "abort",
        predicate: (route) => {
          const headers = (route as unknown as { request: { headers: () => Record<string, string> } }).request?.headers?.();
          return headers?.["x-handle"] === "true";
        },
      });

      // Predicate returns false → should call continue
      let continued = false;
      let aborted = false;
      const mockRouteFalse = {
        abort: async () => { aborted = true; },
        continue: async () => { continued = true; },
        fulfill: async () => {},
        fetch: async () => ({}),
        request: { headers: () => ({ "x-handle": "false" }) },
      } as unknown as Route & { request: { headers: () => Record<string, string> } };

      await routes.get("/api/conditional")!(mockRouteFalse);
      assert.equal(continued, true);
      assert.equal(aborted, false);
    });
  });

  describe.describe("removeIntercept", () => {
    describe.it("removes a route by pattern", async () => {
      const routes = new Map<string, (route: Route) => Promise<void>>();
      const page = createMockPage({ routes });
      const interceptor = new NetworkInterceptor();

      await interceptor.intercept(page, {
        urlPattern: "/api/temp",
        action: "abort",
      });
      assert.equal(routes.size, 1);

      await interceptor.removeIntercept(page, "/api/temp");
      assert.equal(routes.size, 0);
    });
  });

  describe.describe("captureResponse", () => {
    describe.it("registers a route for response capture", async () => {
      const routes = new Map<string, (route: Route) => Promise<void>>();
      const page = createMockPage({ routes });
      const interceptor = new NetworkInterceptor();

      await interceptor.captureResponse(page, "/api/data");
      assert.equal(routes.size, 1);
      assert.ok(routes.has("/api/data"));
    });
  });

  describe.describe("waitForApiResponse", () => {
    describe.it("resolves when a matching response is emitted", async () => {
      const responseListeners: Array<(response: Response) => void> = [];
      const page = createMockPage({ responseListeners });
      const interceptor = new NetworkInterceptor();

      const promise = interceptor.waitForApiResponse(page, "/api/test", { timeoutMs: 5000 });

      // Simulate a matching response after a short delay
      setTimeout(() => {
        const response = {
          url: () => "https://example.com/api/test",
          status: () => 200,
          headers: () => ({ "content-type": "application/json" }),
          json: async () => ({ success: true }),
        } as unknown as Response;
        for (const listener of responseListeners) {
          listener(response);
        }
      }, 10);

      const result = await promise;
      assert.equal(result.url, "https://example.com/api/test");
      assert.equal(result.status, 200);
      assert.deepEqual(result.body, { success: true });
    });

    describe.it("ignores non-matching responses", async () => {
      const responseListeners: Array<(response: Response) => void> = [];
      const page = createMockPage({ responseListeners });
      const interceptor = new NetworkInterceptor();

      const promise = interceptor.waitForApiResponse(page, "/api/target", { timeoutMs: 200 });

      // Emit a non-matching response
      setTimeout(() => {
        const response = {
          url: () => "https://example.com/api/other",
          status: () => 200,
          headers: () => ({ "content-type": "application/json" }),
          json: async () => ({}),
        } as unknown as Response;
        for (const listener of responseListeners) {
          listener(response);
        }
      }, 10);

      await assert.rejects(promise, /Timed out/);
    });

    describe.it("cleans up listener after resolve", async () => {
      const responseListeners: Array<(response: Response) => void> = [];
      const page = createMockPage({ responseListeners });
      const interceptor = new NetworkInterceptor();

      const promise = interceptor.waitForApiResponse(page, "/api/cleanup", { timeoutMs: 5000 });

      setTimeout(() => {
        const response = {
          url: () => "https://example.com/api/cleanup",
          status: () => 200,
          headers: () => ({ "content-type": "application/json" }),
          json: async () => ({ ok: true }),
        } as unknown as Response;
        for (const listener of responseListeners) {
          listener(response);
        }
      }, 10);

      await promise;
      // Listener should have been removed
      assert.equal(responseListeners.length, 0);
    });
  });

  describe.describe("captureJsonResponse", () => {
    describe.it("returns parsed JSON body from matching response", async () => {
      const responseListeners: Array<(response: Response) => void> = [];
      const page = createMockPage({ responseListeners });
      const interceptor = new NetworkInterceptor();

      const promise = interceptor.captureJsonResponse(page, "/api/users", { timeoutMs: 5000 });

      setTimeout(() => {
        const response = {
          url: () => "https://example.com/api/users",
          status: () => 200,
          headers: () => ({ "content-type": "application/json" }),
          json: async () => [{ id: 1, name: "Alice" }],
        } as unknown as Response;
        for (const listener of responseListeners) {
          listener(response);
        }
      }, 10);

      const result = await promise;
      assert.deepEqual(result, [{ id: 1, name: "Alice" }]);
    });
  });

  describe.describe("intercept stores captured responses", () => {
    describe.it("waitForApiResponse stores the response in capturedResponses", async () => {
      const responseListeners: Array<(response: Response) => void> = [];
      const page = createMockPage({ responseListeners });
      const interceptor = new NetworkInterceptor();

      const promise = interceptor.waitForApiResponse(page, "/api/store", { timeoutMs: 5000 });

      setTimeout(() => {
        const response = {
          url: () => "https://example.com/api/store",
          status: () => 200,
          headers: () => ({ "content-type": "application/json" }),
          json: async () => ({ stored: true }),
        } as unknown as Response;
        for (const listener of responseListeners) {
          listener(response);
        }
      }, 10);

      await promise;
      const captured = interceptor.getCapturedResponses();
      assert.equal(captured.length, 1);
      assert.equal(captured[0].url, "https://example.com/api/store");
      assert.deepEqual(captured[0].body, { stored: true });
    });
  });

  describe.describe("captureResponses (legacy)", () => {
    describe.it("registers a route on the page", async () => {
      const routes = new Map<string, (route: Route) => Promise<void>>();
      const page = createMockPage({ routes });
      const interceptor = new NetworkInterceptor();

      await interceptor.captureResponses(page, "/api/data");
      assert.equal(routes.size, 1);
      assert.ok(routes.has("/api/data"));
    });
  });

  describe.describe("blockResource", () => {
    describe.it("registers a blocking route on the page", async () => {
      const routes = new Map<string, (route: Route) => Promise<void>>();
      const page = createMockPage({ routes });
      const interceptor = new NetworkInterceptor();

      await interceptor.blockResource(page, "*.png");
      assert.equal(routes.size, 1);
    });

    describe.it("calls route.abort() when handler fires", async () => {
      const routes = new Map<string, (route: Route) => Promise<void>>();
      const page = createMockPage({ routes });
      const interceptor = new NetworkInterceptor();

      await interceptor.blockResource(page, "*.png");

      let aborted = false;
      const mockRoute = {
        abort: async () => { aborted = true; },
        continue: async () => {},
        fulfill: async () => {},
      } as unknown as Route;

      await routes.get("*.png")!(mockRoute);
      assert.equal(aborted, true);
    });
  });

  describe.describe("mockResponse", () => {
    describe.it("registers a mock route on the page", async () => {
      const routes = new Map<string, (route: Route) => Promise<void>>();
      const page = createMockPage({ routes });
      const interceptor = new NetworkInterceptor();

      await interceptor.mockResponse(page, "/api/test", { body: { ok: true } });
      assert.equal(routes.size, 1);
    });

    describe.it("calls route.fulfill() with mock data", async () => {
      const routes = new Map<string, (route: Route) => Promise<void>>();
      const page = createMockPage({ routes });
      const interceptor = new NetworkInterceptor();

      await interceptor.mockResponse(page, "/api/test", {
        status: 201,
        body: { mocked: true },
        contentType: "text/plain",
      });

      let fulfilled: { status?: number; body?: string; headers?: Record<string, string> } = {};
      const mockRoute = {
        abort: async () => {},
        continue: async () => {},
        fulfill: async (opts: { status?: number; body?: string; headers?: Record<string, string> }) => {
          fulfilled = opts;
        },
      } as unknown as Route;

      await routes.get("/api/test")!(mockRoute);
      assert.equal(fulfilled.status, 201);
      assert.equal(fulfilled.body, JSON.stringify({ mocked: true }));
      assert.equal(fulfilled.headers?.["Content-Type"], "text/plain");
    });
  });

  describe.describe("getCapturedResponses / clearCapturedResponses", () => {
    describe.it("starts empty and returns copies", () => {
      const interceptor = new NetworkInterceptor();
      const responses = interceptor.getCapturedResponses();
      assert.equal(responses.length, 0);
      responses.push({ url: "x", status: 200, headers: {} });
      assert.equal(interceptor.getCapturedResponses().length, 0);
    });

    describe.it("supports filtering with a predicate", () => {
      const interceptor = new NetworkInterceptor();

      const internalResponses = (interceptor as unknown as { capturedResponses: Array<{ url: string; status: number; headers: Record<string, string> }> }).capturedResponses;
      internalResponses.push(
        { url: "https://api.example.com/users", status: 200, headers: {} },
        { url: "https://api.example.com/posts", status: 404, headers: {} },
      );

      const okResponses = interceptor.getCapturedResponses((r) => r.status === 200);
      assert.equal(okResponses.length, 1);
      assert.equal(okResponses[0].url, "https://api.example.com/users");
    });

    describe.it("clears all captured responses", () => {
      const interceptor = new NetworkInterceptor();

      const internalResponses = (interceptor as unknown as { capturedResponses: Array<{ url: string; status: number; headers: Record<string, string> }> }).capturedResponses;
      internalResponses.push({ url: "x", status: 200, headers: {} });
      interceptor.clearCapturedResponses();
      assert.equal(interceptor.getCapturedResponses().length, 0);
    });
  });
});

describe.describe("standalone helpers", () => {
  describe.describe("captureJsonResponse", () => {
    describe.it("is a function", () => {
      assert.equal(typeof captureJsonResponse, "function");
    });
  });

  describe.describe("blockResource", () => {
    describe.it("is a function", () => {
      assert.equal(typeof blockResource, "function");
    });
  });

  describe.describe("mockResponse", () => {
    describe.it("is a function", () => {
      assert.equal(typeof mockResponse, "function");
    });
  });
});
