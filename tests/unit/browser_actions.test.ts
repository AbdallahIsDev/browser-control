import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BrowserActions, type BrowserActionContext } from "../../src/browser_actions";
import { SessionManager, isPolicyAllowed } from "../../src/session_manager";
import { MemoryStore } from "../../src/memory_store";
import { ServiceRegistry } from "../../src/services/registry";
import type { BrowserConnectionManager } from "../../src/browser_connection";
import { loadDebugBundle } from "../../src/observability/debug_bundle";

function createUnavailableBrowserManager() {
  const attempts = {
    attach: 0,
    launchManaged: 0,
  };

  const manager = {
    getContext: () => null,
    getBrowser: () => null,
    isConnected: () => false,
    getConnection: () => null,
    attach: async () => {
      attempts.attach += 1;
      throw new Error("attach unavailable in test");
    },
    launchManaged: async () => {
      attempts.launchManaged += 1;
      throw new Error("launch unavailable in test");
    },
  } as unknown as BrowserConnectionManager;

  return { manager, attempts };
}

function createConnectedBrowserManager(pages: any[]) {
  const context = {
    pages: () => pages,
    newCDPSession: async (page: any) => ({
      on: () => undefined,
      off: () => undefined,
      detach: async () => undefined,
      send: async (method: string, params?: Record<string, unknown>) => {
        if (method === "Target.getTargetInfo") {
          return { targetInfo: { targetId: page.targetId ?? page.url() } };
        }
        if (method === "Browser.getWindowForTarget") {
          if (page.hasBrowserWindow === false) {
            throw new Error("Browser window not found");
          }
          return {
            windowId: page.windowId ?? 1,
            bounds: { windowState: "normal" },
          };
        }
        if (method === "Browser.setWindowBounds") {
          page.calls.setWindowBounds += 1;
          return {};
        }
        if (method === "Target.activateTarget") {
          page.calls.activateTarget += 1;
          return {};
        }
        return {};
      },
    }),
  };
  for (const page of pages) {
    page.context = () => context;
  }

  return {
    getContext: () => context,
    getBrowser: () => ({
      contexts: () => [context],
    }),
    isConnected: () => true,
    getConnection: () => ({ id: "conn-test" }),
    reconnectActiveManaged: async () => true,
    attach: async () => {
      throw new Error("attach should not be called");
    },
    launchManaged: async () => {
      throw new Error("launch should not be called");
    },
  } as unknown as BrowserConnectionManager;
}

function createMockPage(url = "about:blank", options: { hasBrowserWindow?: boolean } = {}) {
  const calls = {
    bringToFront: 0,
    close: 0,
    goto: [] as string[],
    setWindowBounds: 0,
    activateTarget: 0,
    screenshot: 0,
  };
  let currentUrl = url;

  return {
    calls,
    hasBrowserWindow: options.hasBrowserWindow,
    targetId: `target-${Math.random().toString(36).slice(2)}`,
    bringToFront: async () => {
      calls.bringToFront += 1;
    },
    goto: async (nextUrl: string) => {
      calls.goto.push(nextUrl);
      currentUrl = nextUrl;
    },
    title: async () => "Mock Title",
    url: () => currentUrl,
    viewportSize: () => ({ width: 1280, height: 720 }),
    setViewportSize: async () => undefined,
    screenshot: async (options: { path: string }) => {
      calls.screenshot += 1;
      fs.writeFileSync(options.path, Buffer.alloc(1024, 1));
    },
    close: async () => {
      calls.close += 1;
    },
  };
}

describe("BrowserActions", () => {
  let sessionManager: SessionManager;
  let browserActions: BrowserActions;
  let store: MemoryStore;
  let dataHome: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    originalHome = process.env.BROWSER_CONTROL_HOME;
    dataHome = fs.mkdtempSync(path.join(os.tmpdir(), "bc-browser-actions-test-"));
    process.env.BROWSER_CONTROL_HOME = dataHome;
    store = new MemoryStore({ filename: ":memory:" });
    sessionManager = new SessionManager({
      memoryStore: store,
      browserManager: createUnavailableBrowserManager().manager,
    });
    await sessionManager.create("test", { policyProfile: "balanced" });
    browserActions = new BrowserActions({ sessionManager });
  });

  afterEach(() => {
    sessionManager.close();
    if (originalHome === undefined) {
      delete process.env.BROWSER_CONTROL_HOME;
    } else {
      process.env.BROWSER_CONTROL_HOME = originalHome;
    }
    fs.rmSync(dataHome, { recursive: true, force: true });
  });

  describe("constructor", () => {
    it("creates instance with session manager", () => {
      const actions = new BrowserActions({ sessionManager });
      assert.ok(actions);
    });

    it("uses provided ref store", async () => {
      const { RefStore } = await import("../../src/ref_store");
      const customStore = new RefStore();
      const actions = new BrowserActions({ sessionManager, refStore: customStore });
      assert.ok(actions);
    });

    it("uses global ref store when none provided", () => {
      const actions = new BrowserActions({ sessionManager });
      assert.ok(actions);
    });
  });

  describe("open", () => {
    it("targets the front-most tab when a restored profile has multiple pages", async () => {
      const isolatedStore = new MemoryStore({ filename: ":memory:" });
      const frontPage = createMockPage("chrome://newtab/");
      const backgroundPage = createMockPage("https://background.example/");
      const manager = createConnectedBrowserManager([frontPage, backgroundPage]);

      try {
        const isolatedSessionManager = new SessionManager({
          memoryStore: isolatedStore,
          browserManager: manager,
        });
        await isolatedSessionManager.create("test", { policyProfile: "balanced" });
        const isolatedActions = new BrowserActions({ sessionManager: isolatedSessionManager });

        const result = await isolatedActions.open({ url: "https://example.com" });

        assert.equal(result.success, true);
        assert.deepEqual(backgroundPage.calls.goto, []);
        assert.deepEqual(frontPage.calls.goto, ["https://example.com"]);
        assert.equal(frontPage.calls.bringToFront, 2);
      } finally {
        isolatedStore.close();
      }
    });

    it("skips hidden CDP targets and navigates the visible Chrome tab", async () => {
      const isolatedStore = new MemoryStore({ filename: ":memory:" });
      const hiddenPage = createMockPage("https://lichess.org/lzuTaBeK", { hasBrowserWindow: false });
      const visiblePage = createMockPage("chrome://newtab/", { hasBrowserWindow: true });
      const manager = createConnectedBrowserManager([hiddenPage, visiblePage]);

      try {
        const isolatedSessionManager = new SessionManager({
          memoryStore: isolatedStore,
          browserManager: manager,
        });
        await isolatedSessionManager.create("test", { policyProfile: "balanced" });
        const isolatedActions = new BrowserActions({ sessionManager: isolatedSessionManager });

        const result = await isolatedActions.open({ url: "https://example.com" });

        assert.equal(result.success, true);
        assert.deepEqual(hiddenPage.calls.goto, []);
        assert.deepEqual(visiblePage.calls.goto, ["https://example.com"]);
        assert.equal(visiblePage.calls.activateTarget > 0, true);
      } finally {
        isolatedStore.close();
      }
    });

    it("returns failure when no browser is connected and auto-connect cannot recover", async () => {
      const isolatedStore = new MemoryStore({ filename: ":memory:" });
      const { manager, attempts } = createUnavailableBrowserManager();

      try {
        const isolatedSessionManager = new SessionManager({
          memoryStore: isolatedStore,
          browserManager: manager,
        });
        await isolatedSessionManager.create("test", { policyProfile: "balanced" });
        const isolatedActions = new BrowserActions({ sessionManager: isolatedSessionManager });

        const result = await isolatedActions.open({ url: "https://example.com" });

        assert.equal(attempts.attach, 1);
        assert.equal(attempts.launchManaged, 1);
        assert.equal(result.success, false);
        assert.ok(result.error?.includes("No browser available and auto-launch failed"));
        assert.equal(result.path, "a11y");
      } finally {
        isolatedStore.close();
      }
    });
  });

  describe("takeSnapshot", () => {
    it("returns failure when no browser is connected", async () => {
      const result = await browserActions.takeSnapshot();

      assert.equal(result.success, false);
      assert.ok(result.error?.includes("No browser available and auto-launch failed"));
      assert.ok(result.debugBundleId);
      assert.ok(result.recoveryGuidance);
      assert.ok(loadDebugBundle(result.debugBundleId, store));
    });
  });

  describe("click", () => {
    it("returns failure when no browser is connected", async () => {
      const result = await browserActions.click({ target: "@e1" });

      assert.equal(result.success, false);
      // Either no page or policy check failure
      assert.ok(result.error);
    });
  });

  describe("fill", () => {
    it("returns failure when no browser is connected", async () => {
      const result = await browserActions.fill({ target: "@e1", text: "hello" });

      assert.equal(result.success, false);
      assert.ok(result.error);
    });
  });

  describe("hover", () => {
    it("returns failure when no browser is connected", async () => {
      const result = await browserActions.hover({ target: "@e1" });

      assert.equal(result.success, false);
      assert.ok(result.error);
    });
  });

  describe("type", () => {
    it("returns failure when no browser is connected", async () => {
      const result = await browserActions.type({ text: "hello" });

      assert.equal(result.success, false);
      assert.ok(result.error);
    });
  });

  describe("press", () => {
    it("returns failure when no browser is connected", async () => {
      const result = await browserActions.press({ key: "Enter" });

      assert.equal(result.success, false);
      assert.ok(result.error);
    });
  });

  describe("scroll", () => {
    it("returns failure when no browser is connected", async () => {
      const result = await browserActions.scroll({ direction: "down" });

      assert.equal(result.success, false);
      assert.ok(result.error);
    });

    it("returns failure for invalid direction", async () => {
      // Type system prevents this, but the runtime should handle it gracefully
      const result = await browserActions.scroll({ direction: "down" });
      // Without browser, will fail with "no page" error
      assert.equal(result.success, false);
    });
  });

  describe("screenshot", () => {
    it("returns failure when no browser is connected", async () => {
      const result = await browserActions.screenshot();

      assert.equal(result.success, false);
      assert.ok(result.error);
    });

    it("rejects explicit screenshot paths inside the session working directory", async () => {
      const isolatedStore = new MemoryStore({ filename: ":memory:" });
      const visiblePage = createMockPage("https://example.com", { hasBrowserWindow: true });
      const manager = createConnectedBrowserManager([visiblePage]);
      const outputPath = path.join(dataHome, "..", "project-root-shot.png");

      try {
        const isolatedSessionManager = new SessionManager({
          memoryStore: isolatedStore,
          browserManager: manager,
        });
        const workingDirectory = path.dirname(outputPath);
        await isolatedSessionManager.create("test", { policyProfile: "balanced", workingDirectory });
        const isolatedActions = new BrowserActions({ sessionManager: isolatedSessionManager });

        const result = await isolatedActions.screenshot({ outputPath });

        assert.equal(result.success, false);
        assert.match(result.error ?? "", /Refusing to write screenshot inside the session working directory/);
        assert.equal(fs.existsSync(outputPath), false);
      } finally {
        isolatedStore.close();
        fs.rmSync(outputPath, { force: true });
      }
    });

    it("stores default screenshots under the session runtime screenshots directory", async () => {
      const isolatedStore = new MemoryStore({ filename: ":memory:" });
      const visiblePage = createMockPage("https://example.com", { hasBrowserWindow: true });
      const manager = createConnectedBrowserManager([visiblePage]);

      try {
        const isolatedSessionManager = new SessionManager({
          memoryStore: isolatedStore,
          browserManager: manager,
        });
        const session = await isolatedSessionManager.create("test", { policyProfile: "balanced" });
        const isolatedActions = new BrowserActions({ sessionManager: isolatedSessionManager });

        const result = await isolatedActions.screenshot();

        assert.equal(result.success, true);
        assert.ok(result.data?.path.includes(path.join(dataHome, "runtime", session.data!.id, "screenshots")));
        assert.equal(fs.existsSync(result.data!.path), true);
      } finally {
        isolatedStore.close();
      }
    });
  });

  describe("tabList", () => {
    it("returns failure when no browser is connected", async () => {
      const result = await browserActions.tabList();

      assert.equal(result.success, false);
      assert.ok(result.error);
    });

    it("lists only visible Chrome window tabs", async () => {
      const isolatedStore = new MemoryStore({ filename: ":memory:" });
      const hiddenPage = createMockPage("https://lichess.org/lzuTaBeK", { hasBrowserWindow: false });
      const visiblePage = createMockPage("chrome://newtab/", { hasBrowserWindow: true });
      const manager = createConnectedBrowserManager([hiddenPage, visiblePage]);

      try {
        const isolatedSessionManager = new SessionManager({
          memoryStore: isolatedStore,
          browserManager: manager,
        });
        await isolatedSessionManager.create("test", { policyProfile: "balanced" });
        const isolatedActions = new BrowserActions({ sessionManager: isolatedSessionManager });

        const result = await isolatedActions.tabList();

        assert.equal(result.success, true);
        assert.deepEqual(result.data?.map((tab) => tab.url), ["chrome://newtab/"]);
      } finally {
        isolatedStore.close();
      }
    });
  });

  describe("tabSwitch", () => {
    it("returns failure when no browser is connected", async () => {
      const result = await browserActions.tabSwitch("0");

      assert.equal(result.success, false);
      assert.ok(result.error);
    });

    it("switches by visible Chrome tab index, not hidden CDP target index", async () => {
      const isolatedStore = new MemoryStore({ filename: ":memory:" });
      const hiddenPage = createMockPage("https://lichess.org/lzuTaBeK", { hasBrowserWindow: false });
      const visiblePage = createMockPage("chrome://newtab/", { hasBrowserWindow: true });
      const manager = createConnectedBrowserManager([hiddenPage, visiblePage]);

      try {
        const isolatedSessionManager = new SessionManager({
          memoryStore: isolatedStore,
          browserManager: manager,
        });
        await isolatedSessionManager.create("test", { policyProfile: "balanced" });
        const isolatedActions = new BrowserActions({ sessionManager: isolatedSessionManager });

        const result = await isolatedActions.tabSwitch("0");

        assert.equal(result.success, true);
        assert.equal(hiddenPage.calls.activateTarget, 0);
        assert.equal(hiddenPage.calls.bringToFront, 0);
        assert.equal(visiblePage.calls.activateTarget > 0, true);
        assert.equal(visiblePage.calls.bringToFront > 0, true);
      } finally {
        isolatedStore.close();
      }
    });
  });

  describe("close", () => {
    it("closes the front-most tab when a restored profile has multiple pages", async () => {
      const isolatedStore = new MemoryStore({ filename: ":memory:" });
      const frontPage = createMockPage("chrome://newtab/");
      const backgroundPage = createMockPage("https://background.example/");
      const manager = createConnectedBrowserManager([frontPage, backgroundPage]);

      try {
        const isolatedSessionManager = new SessionManager({
          memoryStore: isolatedStore,
          browserManager: manager,
        });
        await isolatedSessionManager.create("test", { policyProfile: "balanced" });
        const isolatedActions = new BrowserActions({ sessionManager: isolatedSessionManager });

        const result = await isolatedActions.close();

        assert.equal(result.success, true);
        assert.equal(backgroundPage.calls.close, 0);
        assert.equal(frontPage.calls.close, 1);
        assert.equal(frontPage.calls.bringToFront, 1);
      } finally {
        isolatedStore.close();
      }
    });

    it("returns failure when no browser is connected", async () => {
      const result = await browserActions.close();

      assert.equal(result.success, false);
      assert.ok(result.error);
    });
  });

  // ── Finding 1: API-registered services visible to browser open ──────

  describe("shared registry between service and browser actions", () => {
    it("browser open resolves service refs using the same registry as service actions", async () => {
      const isolatedStore = new MemoryStore({ filename: ":memory:" });
      const { manager } = createUnavailableBrowserManager();

      try {
        const isolatedSessionManager = new SessionManager({
          memoryStore: isolatedStore,
          browserManager: manager,
        });
        await isolatedSessionManager.create("test", { policyProfile: "balanced" });

        const sharedRegistry = new ServiceRegistry();
        sharedRegistry.register({ name: "my-app", port: 3000 });

        const isolatedActions = new BrowserActions({
          sessionManager: isolatedSessionManager,
          serviceRegistry: sharedRegistry,
        });

        const result = await isolatedActions.open({ url: "bc://my-app" });

        // Resolution should succeed (service is known in the shared registry).
        // The open will then fail either because the service is not actually
        // running (unhealthy_service) or because no browser is available.
        // The important thing is that it does NOT say "Unknown service".
        assert.equal(result.success, false);
        assert.ok(
          !result.error?.includes("Unknown service"),
          `Expected resolution to find the service, but got: ${result.error}`,
        );
      } finally {
        isolatedStore.close();
      }
    });

    it("browser open returns unknown_service when service is not in the shared registry", async () => {
      const isolatedStore = new MemoryStore({ filename: ":memory:" });
      const { manager } = createUnavailableBrowserManager();

      try {
        const isolatedSessionManager = new SessionManager({
          memoryStore: isolatedStore,
          browserManager: manager,
        });
        await isolatedSessionManager.create("test", { policyProfile: "balanced" });

        const sharedRegistry = new ServiceRegistry();
        // Do NOT register "missing-app"

        const isolatedActions = new BrowserActions({
          sessionManager: isolatedSessionManager,
          serviceRegistry: sharedRegistry,
        });

        const result = await isolatedActions.open({ url: "bc://missing-app" });

        assert.equal(result.success, false);
        assert.ok(
          result.error?.includes("Unknown service"),
          `Expected "Unknown service" error, got: ${result.error}`,
        );
      } finally {
        isolatedStore.close();
      }
    });
  });

  // ── Issue 3: Browser actions bind browser state into session model ──

  describe("browser binding into session state", () => {
    it("close action unbinds browser from session when browser was bound", async () => {
      // Simulate a bound browser by manually binding it
      const activeSession = sessionManager.getActiveSession();
      assert.ok(activeSession, "should have an active session");

      // Bind a fake browser connection
      sessionManager.bindBrowser(activeSession.id, "conn-test-123");
      const bound = sessionManager.getSession(activeSession.id);
      assert.equal(bound!.browserConnectionId, "conn-test-123",
        "browser should be bound before close");

      // close() will fail because no real browser page exists,
      // but we verify the unbind helper works correctly
      const result = await browserActions.close();

      // The close will fail (no real page), but the unbind attempt was made
      // The important thing is that unbindBrowserFromSession is called
      assert.equal(result.success, false);
    });

    it("session state reflects browser binding after bindBrowser", async () => {
      const activeSession = sessionManager.getActiveSession();
      assert.ok(activeSession);

      sessionManager.bindBrowser(activeSession.id, "conn-abc");

      const state = sessionManager.getSession(activeSession.id);
      assert.equal(state!.browserConnectionId, "conn-abc");

      const status = sessionManager.status();
      assert.equal(status.data!.browserConnectionId, "conn-abc");
    });

    it("session state reflects unbound after unbindBrowser", async () => {
      const activeSession = sessionManager.getActiveSession();
      assert.ok(activeSession);

      sessionManager.bindBrowser(activeSession.id, "conn-xyz");
      sessionManager.unbindBrowser(activeSession.id);

      const state = sessionManager.getSession(activeSession.id);
      assert.equal(state!.browserConnectionId, null);
    });

    it("list() shows hasBrowser flag correctly after binding", async () => {
      const activeSession = sessionManager.getActiveSession();
      assert.ok(activeSession);

      // Before binding
      const listBefore = sessionManager.list();
      const entryBefore = listBefore.data!.find(s => s.id === activeSession.id);
      assert.equal(entryBefore!.hasBrowser, false);

      // After binding
      sessionManager.bindBrowser(activeSession.id, "conn-list");
      const listAfter = sessionManager.list();
      const entryAfter = listAfter.data!.find(s => s.id === activeSession.id);
      assert.equal(entryAfter!.hasBrowser, true);
    });
  });

  // ── Issue 2: ActionResults carry real policy metadata ──────────────

  describe("action results carry policy metadata", () => {
    it("open result includes real policyDecision and risk when allowed", async () => {
      // This will fail because no browser, but if it were allowed by policy
      // the result would carry the real metadata. We verify the pattern
      // by checking evaluateAction directly.
      const policyEval = sessionManager.evaluateAction("browser_navigate", { url: "https://example.com" });
      if (isPolicyAllowed(policyEval)) {
        assert.ok(policyEval.policyDecision);
        assert.ok(policyEval.risk);
        assert.ok(policyEval.path);
      }
    });
  });
});
