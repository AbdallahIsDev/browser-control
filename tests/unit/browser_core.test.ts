import assert from "node:assert/strict";
import test from "node:test";
import type { Browser, BrowserContext, Page } from "playwright";
import { MemoryStore } from "../../src/memory_store";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getChromeDebugPath } from "../../src/paths";

import {
  createAutomationContext,
  ensureContextHasPage,
  findPageByUrl,
  getDebugEndpointCandidates,
  getOrOpenPage,
  readRouteGatewayCandidates,
  readNameserverCandidates,
  smartClick,
  smartFill,
  type DebugInteropState,
} from "../../src/browser_core";

test("getDebugEndpointCandidates prefers explicit env override", () => {
  const candidates = getDebugEndpointCandidates(9222, {
    env: {
      BROWSER_DEBUG_URL: "http://10.0.0.5:9555",
      BROWSER_DEBUG_HOST: "10.0.0.6",
    },
    platform: "linux",
    metadata: null,
    resolvConf: "",
  });

  assert.deepEqual(candidates, ["http://10.0.0.5:9555"]);
});

test("getDebugEndpointCandidates prefers launcher metadata when running in WSL", () => {
  const metadata: DebugInteropState = {
    port: 9222,
    bindAddress: "0.0.0.0",
    windowsLoopbackUrl: "http://127.0.0.1:9222",
    localhostUrl: "http://localhost:9222",
    wslPreferredUrl: "http://172.24.240.1:9222",
    wslHostCandidates: ["172.24.240.1", "192.168.1.25"],
    updatedAt: "2026-04-10T00:00:00.000Z",
  };

  const candidates = getDebugEndpointCandidates(9222, {
    env: {
      WSL_DISTRO_NAME: "Ubuntu",
    },
    platform: "linux",
    metadata,
    resolvConf: "nameserver 172.24.240.1\n",
    routeTable: "",
  });

  assert.deepEqual(candidates, [
    "http://172.24.240.1:9222",
    "http://192.168.1.25:9222",
    "http://localhost:9222",
    "http://127.0.0.1:9222",
  ]);
});

test("getDebugEndpointCandidates can ignore env overrides for managed launch", () => {
  const candidates = getDebugEndpointCandidates(9222, {
    env: {
      BROWSER_DEBUG_URL: "http://10.0.0.5:9555",
      BROWSER_DEBUG_HOST: "10.0.0.6",
    },
    platform: "win32",
    metadata: null,
    resolvConf: "",
    routeTable: "",
    ignoreEnvOverrides: true,
  });

  assert.deepEqual(candidates, [
    "http://127.0.0.1:9222",
    "http://localhost:9222",
  ]);
});

test("getDebugEndpointCandidates reads debug metadata from current BROWSER_CONTROL_HOME", () => {
  const previousHome = process.env.BROWSER_CONTROL_HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-debug-home-"));

  try {
    process.env.BROWSER_CONTROL_HOME = home;
    const debugPath = getChromeDebugPath();
    fs.mkdirSync(path.dirname(debugPath), { recursive: true });
    fs.writeFileSync(debugPath, JSON.stringify({
      port: 9222,
      bindAddress: "127.0.0.1",
      windowsLoopbackUrl: "http://127.0.0.1:9222",
      localhostUrl: "http://localhost:9222",
      wslPreferredUrl: "http://172.20.32.1:9222",
      wslHostCandidates: ["172.20.32.1"],
      updatedAt: "2026-04-26T00:00:00.000Z",
    }));

    const candidates = getDebugEndpointCandidates(9222, {
      env: { WSL_DISTRO_NAME: "Ubuntu" },
      platform: "linux",
      resolvConf: "",
      routeTable: "",
    });

    assert.equal(candidates[0], "http://172.20.32.1:9222");
  } finally {
    if (previousHome === undefined) {
      delete process.env.BROWSER_CONTROL_HOME;
    } else {
      process.env.BROWSER_CONTROL_HOME = previousHome;
    }
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("getDebugEndpointCandidates ignores launcher metadata for a different port", () => {
  const candidates = getDebugEndpointCandidates(9222, {
    env: {
      WSL_DISTRO_NAME: "Ubuntu",
    },
    platform: "linux",
    metadata: {
      port: 63530,
      bindAddress: "127.0.0.1",
      windowsLoopbackUrl: "http://127.0.0.1:63530",
      localhostUrl: "http://localhost:63530",
      wslPreferredUrl: "http://172.20.32.1:63530",
      wslHostCandidates: ["172.20.32.1"],
      updatedAt: "2026-04-26T00:00:00.000Z",
    },
    resolvConf: "",
    routeTable: "",
  });

  assert.deepEqual(candidates, [
    "http://localhost:9222",
    "http://127.0.0.1:9222",
  ]);
});

test("readNameserverCandidates extracts WSL host candidates from resolv.conf", () => {
  const candidates = readNameserverCandidates(`
search lan
nameserver 172.25.96.1
nameserver 8.8.8.8
nameserver 192.168.1.5
`);

  assert.deepEqual(candidates, ["172.25.96.1", "192.168.1.5"]);
});

test("readRouteGatewayCandidates extracts the WSL default gateway from /proc/net/route", () => {
  const candidates = readRouteGatewayCandidates([
    "Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT",
    "eth0\t00000000\t012014AC\t0003\t0\t0\t0\t00000000\t0\t0\t0",
  ].join("\n"));

  assert.deepEqual(candidates, ["172.20.32.1"]);
});

test("getDebugEndpointCandidates falls back to the WSL default gateway when launcher metadata is missing", () => {
  const candidates = getDebugEndpointCandidates(9222, {
    env: {
      WSL_DISTRO_NAME: "Ubuntu",
    },
    platform: "linux",
    metadata: null,
    resolvConf: "",
    routeTable: [
      "Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT",
      "eth0\t00000000\t012014AC\t0003\t0\t0\t0\t00000000\t0\t0\t0",
    ].join("\n"),
  });

  assert.deepEqual(candidates, [
    "http://172.20.32.1:9222",
    "http://localhost:9222",
    "http://127.0.0.1:9222",
  ]);
});

test("getDebugEndpointCandidates ignores public DNS resolvers when looking for the Windows host from WSL", () => {
  const candidates = getDebugEndpointCandidates(9222, {
    env: {
      WSL_DISTRO_NAME: "Ubuntu",
    },
    platform: "linux",
    metadata: {
      port: 9222,
      bindAddress: "0.0.0.0",
      windowsLoopbackUrl: "http://127.0.0.1:9222",
      localhostUrl: "http://localhost:9222",
      wslPreferredUrl: "http://8.8.8.8:9222",
      wslHostCandidates: ["1.1.1.1", "172.20.32.1"],
      updatedAt: "2026-04-10T00:00:00.000Z",
    },
    resolvConf: "nameserver 8.8.8.8\nnameserver 172.20.32.1\n",
    routeTable: "",
  });

  assert.deepEqual(candidates, [
    "http://172.20.32.1:9222",
    "http://localhost:9222",
    "http://127.0.0.1:9222",
  ]);
});

test("createAutomationContext uses a plain automation-owned context by default", async () => {
  let addInitScriptCalls = 0;
  const context = {
    addInitScript: async () => {
      addInitScriptCalls += 1;
    },
  } as unknown as BrowserContext;
  let newContextCalls = 0;

  let lastContextOptions: Record<string, unknown> | undefined;
  const browser = {
    newContext: async (options?: Record<string, unknown>) => {
      newContextCalls += 1;
      lastContextOptions = options;
      return context;
    },
  } as unknown as Browser;

  const createdContext = await createAutomationContext(browser);

  assert.equal(createdContext, context);
  assert.equal(newContextCalls, 1);
  assert.equal(addInitScriptCalls, 0);
  assert.deepEqual(lastContextOptions, {
    viewport: { width: 1365, height: 768 },
  });
});

test("createAutomationContext reads viewport dimensions from env", async () => {
  let lastContextOptions: Record<string, unknown> | undefined;
  const context = {} as BrowserContext;
  const browser = {
    newContext: async (options?: Record<string, unknown>) => {
      lastContextOptions = options;
      return context;
    },
  } as unknown as Browser;

  await createAutomationContext(browser, {
    env: {
      BROWSER_VIEWPORT_WIDTH: "1920",
      BROWSER_VIEWPORT_HEIGHT: "1080",
    },
  });

  assert.deepEqual(lastContextOptions, {
    viewport: { width: 1920, height: 1080 },
  });
});

test("createAutomationContext lets explicit viewport override config", async () => {
  let lastContextOptions: Record<string, unknown> | undefined;
  const context = {} as BrowserContext;
  const browser = {
    newContext: async (options?: Record<string, unknown>) => {
      lastContextOptions = options;
      return context;
    },
  } as unknown as Browser;

  await createAutomationContext(browser, {
    env: {
      BROWSER_VIEWPORT_WIDTH: "1920",
      BROWSER_VIEWPORT_HEIGHT: "1080",
    },
    viewport: { width: 1440, height: 900 },
  });

  assert.deepEqual(lastContextOptions, {
    viewport: { width: 1440, height: 900 },
  });
});

test("createAutomationContext enables stealth when requested through env", async () => {
  let addInitScriptCalls = 0;
  let lastContextOptions: Record<string, unknown> | undefined;
  const context = {
    addInitScript: async () => {
      addInitScriptCalls += 1;
    },
  } as unknown as BrowserContext;

  const browser = {
    newContext: async (options?: Record<string, unknown>) => {
      lastContextOptions = options;
      return context;
    },
  } as unknown as Browser;

  const createdContext = await createAutomationContext(browser, {
    env: {
      ENABLE_STEALTH: "true",
      STEALTH_LOCALE: "en-US",
      STEALTH_TIMEZONE_ID: "America/New_York",
    },
  });

  assert.equal(createdContext, context);
  assert.equal(addInitScriptCalls, 1);
  assert.deepEqual(lastContextOptions, {
    locale: "en-US",
    timezoneId: "America/New_York",
    extraHTTPHeaders: {
      "Accept-Language": "en-US",
    },
    viewport: { width: 1365, height: 768 },
  });
});

test("createAutomationContext lets explicit stealth false override env true", async () => {
  let addInitScriptCalls = 0;
  const context = {
    addInitScript: async () => {
      addInitScriptCalls += 1;
    },
  } as unknown as BrowserContext;

  const browser = {
    newContext: async () => context,
  } as unknown as Browser;

  const createdContext = await createAutomationContext(browser, {
    stealth: false,
    env: {
      ENABLE_STEALTH: "true",
    },
  });

  assert.equal(createdContext, context);
  assert.equal(addInitScriptCalls, 0);
});

test("createAutomationContext reads ENABLE_STEALTH from process.env when no env override is provided", async (t) => {
  const previousEnableStealth = process.env.ENABLE_STEALTH;
  const previousLocale = process.env.STEALTH_LOCALE;
  const previousTimezone = process.env.STEALTH_TIMEZONE_ID;

  t.after(() => {
    if (previousEnableStealth === undefined) {
      delete process.env.ENABLE_STEALTH;
    } else {
      process.env.ENABLE_STEALTH = previousEnableStealth;
    }

    if (previousLocale === undefined) {
      delete process.env.STEALTH_LOCALE;
    } else {
      process.env.STEALTH_LOCALE = previousLocale;
    }

    if (previousTimezone === undefined) {
      delete process.env.STEALTH_TIMEZONE_ID;
    } else {
      process.env.STEALTH_TIMEZONE_ID = previousTimezone;
    }
  });

  process.env.ENABLE_STEALTH = "true";
  process.env.STEALTH_LOCALE = "en-US";
  process.env.STEALTH_TIMEZONE_ID = "America/New_York";

  let addInitScriptCalls = 0;
  const context = {
    addInitScript: async () => {
      addInitScriptCalls += 1;
    },
  } as unknown as BrowserContext;

  const browser = {
    newContext: async () => context,
  } as unknown as Browser;

  await createAutomationContext(browser);

  assert.equal(addInitScriptCalls, 1);
});

test("createAutomationContext forwards proxy settings for plain automation contexts", async () => {
  let lastContextOptions: Record<string, unknown> | undefined;
  const context = {} as BrowserContext;

  const browser = {
    newContext: async (options?: Record<string, unknown>) => {
      lastContextOptions = options;
      return context;
    },
  } as unknown as Browser;

  const createdContext = await createAutomationContext(browser, {
    proxy: {
      url: "http://proxy-user:proxy-pass@proxy.example.com:8080",
      status: "active",
    },
  });

  assert.equal(createdContext, context);
  assert.deepEqual(lastContextOptions, {
    proxy: {
      server: "http://proxy.example.com:8080",
      username: "proxy-user",
      password: "proxy-pass",
    },
    viewport: { width: 1365, height: 768 },
  });
});

test("ensureContextHasPage creates the first page inside the automation context", async () => {
  const page = {} as Page;
  let newPageCalls = 0;
  const context = {
    pages: () => [],
    newPage: async () => {
      newPageCalls += 1;
      return page;
    },
  } as unknown as BrowserContext;

  const result = await ensureContextHasPage(context);

  assert.equal(result, page);
  assert.equal(newPageCalls, 1);
});

test("ensureContextHasPage reuses an existing automation context page", async () => {
  const page = {} as Page;
  let newPageCalls = 0;
  const context = {
    pages: () => [page],
    newPage: async () => {
      newPageCalls += 1;
      return {} as Page;
    },
  } as unknown as BrowserContext;

  const result = await ensureContextHasPage(context);

  assert.equal(result, page);
  assert.equal(newPageCalls, 0);
});

test("findPageByUrl scopes page lookup to the provided context", () => {
  const sharedPage = {
    url: () => "https://example.com/shared",
  };
  const isolatedPage = {
    url: () => "https://example.com/isolated",
  };

  const sharedContext = {
    pages: () => [sharedPage],
  } as unknown as BrowserContext;
  const isolatedContext = {
    pages: () => [isolatedPage],
  } as unknown as BrowserContext;

  const browser = {
    contexts: () => [sharedContext, isolatedContext],
  } as unknown as Browser;

  assert.equal(findPageByUrl(browser, "/isolated"), isolatedPage);
  assert.equal(findPageByUrl(browser, "/shared", isolatedContext), null);
  assert.equal(findPageByUrl(browser, "/isolated", isolatedContext), isolatedPage);
});

test("getOrOpenPage creates new pages inside the provided context", async () => {
  let createdInScopedContext = false;
  const page = {
    url: () => "https://example.com/new",
    goto: async () => undefined,
    bringToFront: async () => undefined,
  };

  const sharedContext = {
    pages: () => [],
  } as unknown as BrowserContext;
  const isolatedContext = {
    pages: () => [],
    newPage: async () => {
      createdInScopedContext = true;
      return page;
    },
  } as unknown as BrowserContext;

  const browser = {
    contexts: () => [sharedContext, isolatedContext],
  } as unknown as Browser;

  const openedPage = await getOrOpenPage(browser, "/new", "https://example.com/new", isolatedContext);

  assert.equal(openedPage, page);
  assert.equal(createdInScopedContext, true);
});

test("smartClick retries once after auto-solving a captcha", async () => {
  let clickAttempts = 0;
  let captchaSolveCalls = 0;

  const page = {
    locator: () => ({
      first: () => ({
        click: async () => {
          clickAttempts += 1;
          if (clickAttempts === 1) {
            throw new Error("captcha challenge");
          }
        },
      }),
    }),
  } as unknown as Page;

  const result = await smartClick(page, "#submit", {
    autoSolveCaptcha: true,
    captchaSolver: {
      waitForCaptcha: async () => {
        captchaSolveCalls += 1;
        return { token: "captcha-token" };
      },
    },
  });

  assert.equal(result, true);
  assert.equal(clickAttempts, 2);
  assert.equal(captchaSolveCalls, 1);
});

test("smartFill retries once after auto-solving a captcha", async () => {
  let clickAttempts = 0;
  let fillAttempts = 0;
  let captchaSolveCalls = 0;

  const page = {
    locator: () => ({
      first: () => ({
        click: async () => {
          clickAttempts += 1;
          if (clickAttempts === 1) {
            throw new Error("captcha challenge");
          }
        },
        fill: async () => {
          fillAttempts += 1;
        },
        press: async () => undefined,
      }),
    }),
  } as unknown as Page;

  const result = await smartFill(page, "#email", "user@example.com", {
    autoSolveCaptcha: true,
    captchaSolver: {
      waitForCaptcha: async () => {
        captchaSolveCalls += 1;
        return { token: "captcha-token" };
      },
    },
  });

  assert.equal(result, true);
  assert.equal(clickAttempts, 2);
  assert.equal(fillAttempts, 1);
  assert.equal(captchaSolveCalls, 1);
});

test("createAutomationContext restores and persists cookies for automation-owned sessions", async () => {
  const store = new MemoryStore({
    filename: ":memory:",
  });

  const restoredCookies = [
    {
      name: "existing",
      value: "cookie-a",
      domain: ".example.com",
      path: "/",
    },
  ];
  store.set("sessions:site-a", restoredCookies);

  let addedCookies: unknown[] = [];
  let closeHandler: (() => void) | undefined;

  const context = {
    addCookies: async (cookies: unknown[]) => {
      addedCookies = cookies;
    },
    cookies: async () => [{
      name: "fresh",
      value: "cookie-b",
      domain: ".example.com",
      path: "/",
    }],
    on: (_event: string, handler: () => void) => {
      closeHandler = handler;
    },
  } as unknown as BrowserContext;

  const browser = {
    newContext: async () => context,
  } as unknown as Browser;

  await createAutomationContext(browser, {
    memoryStore: store,
    sessionKey: "site-a",
    sessionTtlMs: 60_000,
  });

  assert.deepEqual(addedCookies, restoredCookies);

  await closeHandler?.();

  assert.deepEqual(store.get("sessions:site-a"), [
    {
      name: "fresh",
      value: "cookie-b",
      domain: ".example.com",
      path: "/",
    },
  ]);

  store.close();
});
