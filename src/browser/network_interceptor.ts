import type { Page, Route, Response } from "playwright";

// ── Route types ─────────────────────────────────────────────────────

export type RouteAction = "abort" | "fulfill" | "continue";

export interface RouteHandler {
  urlPattern: string | RegExp;
  action: RouteAction;
  fulfillOptions?: {
    status?: number;
    headers?: Record<string, string>;
    body?: string | Record<string, unknown>;
    contentType?: string;
  };
  predicate?: (route: Route) => boolean | Promise<boolean>;
}

export interface InterceptedResponse {
  url: string;
  status: number;
  headers: Record<string, string>;
  body?: unknown;
}

export interface NetworkInterceptorOptions {
  maxCapturedResponses?: number;
}

export class NetworkInterceptor {
  private readonly capturedResponses: InterceptedResponse[] = [];

  private readonly maxCapturedResponses: number;

  private readonly activeRoutes: Array<{ urlPattern: string | RegExp; handler: (route: Route) => Promise<void> }> = [];

  constructor(options: NetworkInterceptorOptions = {}) {
    this.maxCapturedResponses = options.maxCapturedResponses ?? 100;
  }

  // ── Spec API: intercept, removeIntercept, captureResponse ─────────

  /** Register a route interception on a page. */
  async intercept(page: Page, handler: RouteHandler): Promise<void> {
    await page.route(handler.urlPattern, async (route: Route) => {
      if (handler.predicate) {
        const shouldHandle = await handler.predicate(route);
        if (!shouldHandle) {
          await route.continue();
          return;
        }
      }

      switch (handler.action) {
        case "abort":
          await route.abort();
          break;
        case "fulfill": {
          const opts = handler.fulfillOptions ?? {};
          const status = opts.status ?? 200;
          const headers = { ...(opts.headers ?? {}) };
          const contentType = opts.contentType ?? "application/json";
          if (!headers["Content-Type"] && !headers["content-type"]) {
            headers["Content-Type"] = contentType;
          }
          const body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body ?? {});
          await route.fulfill({ status, headers, body });
          break;
        }
        case "continue":
        default:
          await route.continue();
          break;
      }
    });

    this.activeRoutes.push({
      urlPattern: handler.urlPattern,
      handler: async () => {},
    });
  }

  /** Remove a route interception from a page by pattern. */
  async removeIntercept(page: Page, pattern: string | RegExp): Promise<void> {
    await page.unroute(pattern);
    const key = typeof pattern === "string" ? pattern : pattern.source;
    const idx = this.activeRoutes.findIndex((r) => {
      const rKey = typeof r.urlPattern === "string" ? r.urlPattern : r.urlPattern.source;
      return rKey === key;
    });
    if (idx !== -1) {
      this.activeRoutes.splice(idx, 1);
    }
  }

  /** Capture responses matching a pattern and store them internally. */
  async captureResponse(page: Page, pattern: string | RegExp, maxEntries?: number): Promise<void> {
    const limit = maxEntries ?? this.maxCapturedResponses;
    await page.route(pattern, async (route: Route) => {
      const response = await route.fetch();
      const intercepted: InterceptedResponse = {
        url: response.url(),
        status: response.status(),
        headers: response.headers() as Record<string, string>,
      };

      try {
        const contentType = response.headers()["content-type"] ?? "";
        if (contentType.includes("application/json")) {
          intercepted.body = await response.json();
        }
      } catch {
        // Non-JSON or unreadable body — skip
      }

      this.pushCapturedResponse(intercepted, limit);
      await route.fulfill({ response });
    });

    this.activeRoutes.push({
      urlPattern: pattern,
      handler: async () => {},
    });
  }

  // ── Instance methods (page-bound convenience) ─────────────────────

  /** Intercept all requests matching urlPattern and record their responses. */
  async captureResponses(page: Page, urlPattern: string | RegExp): Promise<void> {
    await page.route(urlPattern, async (route: Route) => {
      const response = await route.fetch();
      const intercepted: InterceptedResponse = {
        url: response.url(),
        status: response.status(),
        headers: response.headers() as Record<string, string>,
      };

      try {
        const contentType = response.headers()["content-type"] ?? "";
        if (contentType.includes("application/json")) {
          intercepted.body = await response.json();
        }
      } catch {
        // Non-JSON or unreadable body — skip
      }

      this.pushCapturedResponse(intercepted);
      await route.fulfill({ response });
    });

    this.activeRoutes.push({
      urlPattern,
      handler: async () => {},
    });
  }

  /** Block requests matching urlPattern. */
  async blockResource(page: Page, urlPattern: string | RegExp): Promise<void> {
    await page.route(urlPattern, async (route: Route) => {
      await route.abort();
    });

    this.activeRoutes.push({
      urlPattern,
      handler: async () => {},
    });
  }

  /** Mock a response for requests matching urlPattern. */
  async mockResponse(
    page: Page,
    urlPattern: string | RegExp,
    options: {
      status?: number;
      headers?: Record<string, string>;
      body?: string | Record<string, unknown>;
      contentType?: string;
    },
  ): Promise<void> {
    const status = options.status ?? 200;
    const headers = options.headers ?? {};
    const contentType = options.contentType ?? "application/json";
    const body = typeof options.body === "string" ? options.body : JSON.stringify(options.body ?? {});

    await page.route(urlPattern, async (route: Route) => {
      await route.fulfill({
        status,
        headers: { "Content-Type": contentType, ...headers },
        body,
      });
    });

    this.activeRoutes.push({
      urlPattern,
      handler: async () => {},
    });
  }

  /** Wait for the next API response matching urlPattern, capture and return it. */
  async waitForApiResponse(
    page: Page,
    urlPattern: string | RegExp,
    options: { timeoutMs?: number } = {},
  ): Promise<InterceptedResponse> {
    const timeoutMs = options.timeoutMs ?? 15000;

    return new Promise<InterceptedResponse>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        page.removeListener("response", onResponse);
        reject(new Error(`Timed out waiting for API response matching ${String(urlPattern)}.`));
      }, timeoutMs);

      const onResponse = async (response: Response) => {
        const url = response.url();
        const matches = typeof urlPattern === "string"
          ? url.includes(urlPattern)
          : urlPattern.test(url);

        if (!matches) {
          return;
        }

        clearTimeout(timeoutHandle);
        page.removeListener("response", onResponse);

        const intercepted: InterceptedResponse = {
          url,
          status: response.status(),
          headers: response.headers() as Record<string, string>,
        };

        try {
          intercepted.body = await response.json();
        } catch {
          // Non-JSON body — skip
        }

        this.pushCapturedResponse(intercepted);
        resolve(intercepted);
      };

      page.on("response", onResponse);
    });
  }

  /** Capture the next JSON response matching urlPattern. Convenience wrapper. */
  async captureJsonResponse(
    page: Page,
    urlPattern: string | RegExp,
    options: { timeoutMs?: number } = {},
  ): Promise<unknown> {
    const response = await this.waitForApiResponse(page, urlPattern, options);
    return response.body;
  }

  // ── Accessors ─────────────────────────────────────────────────────

  /** Get all captured responses, optionally filtered by a predicate. */
  getCapturedResponses(predicate?: (response: InterceptedResponse) => boolean): InterceptedResponse[] {
    if (!predicate) {
      return [...this.capturedResponses];
    }
    return this.capturedResponses.filter(predicate);
  }

  /** Clear all captured responses. */
  clearCapturedResponses(): void {
    this.capturedResponses.length = 0;
  }

  /** Remove all active route interceptions from all tracked pages. */
  async unrouteAll(): Promise<void> {
    for (const entry of this.activeRoutes) {
      // We don't have the page reference stored, so we just clear the tracking
      // The actual unroute must be done by the caller or via removeIntercept
    }
    this.activeRoutes.length = 0;
  }

  private pushCapturedResponse(response: InterceptedResponse, limit?: number): void {
    const max = limit ?? this.maxCapturedResponses;
    this.capturedResponses.push(response);
    while (this.capturedResponses.length > max) {
      this.capturedResponses.shift();
    }
  }
}

// ── Standalone helper wrappers ───────────────────────────────────────

/** Wait for and return parsed JSON from the next response matching pattern. */
export async function captureJsonResponse(
  page: Page,
  pattern: string | RegExp,
  timeoutMs?: number,
): Promise<unknown> {
  const interceptor = new NetworkInterceptor();
  return interceptor.captureJsonResponse(page, pattern, { timeoutMs });
}

/** Block a resource type or URL pattern on a page. */
export async function blockResource(page: Page, pattern: string | RegExp): Promise<void> {
  const interceptor = new NetworkInterceptor();
  await interceptor.blockResource(page, pattern);
}

/** Mock responses for a URL pattern on a page. */
export async function mockResponse(
  page: Page,
  pattern: string | RegExp,
  options: {
    status?: number;
    headers?: Record<string, string>;
    body?: string | Record<string, unknown>;
    contentType?: string;
  },
): Promise<void> {
  const interceptor = new NetworkInterceptor();
  await interceptor.mockResponse(page, pattern, options);
}
