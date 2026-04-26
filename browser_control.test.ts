import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createBrowserControl, type BrowserControlOptions } from "./browser_control";
import { MemoryStore } from "./memory_store";

describe("createBrowserControl", () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ filename: ":memory:" });
  });

  afterEach(() => {
    store.close();
  });

  it("returns an object with all four namespaces", () => {
    const bc = createBrowserControl({ memoryStore: store });

    assert.ok(bc.browser, "browser namespace missing");
    assert.ok(bc.terminal, "terminal namespace missing");
    assert.ok(bc.fs, "fs namespace missing");
    assert.ok(bc.session, "session namespace missing");
  });

  it("browser namespace has all action methods", () => {
    const bc = createBrowserControl({ memoryStore: store });

    const browserActions = [
      "open", "snapshot", "click", "fill", "hover",
      "type", "press", "scroll", "screenshot", "tabList",
      "tabSwitch", "close",
    ];

    for (const action of browserActions) {
      assert.equal(typeof bc.browser[action as keyof typeof bc.browser], "function", `browser.${action} is not a function`);
    }
  });

  it("browser namespace exposes provider management per Section 15", () => {
    const bc = createBrowserControl({ memoryStore: store });

    assert.ok(bc.browser.provider, "browser.provider namespace missing");
    assert.equal(typeof bc.browser.provider.list, "function");
    assert.equal(typeof bc.browser.provider.use, "function");
    assert.equal(typeof bc.browser.provider.getActive, "function");
  });

  it("terminal namespace has all action methods", () => {
    const bc = createBrowserControl({ memoryStore: store });

    const terminalActions = [
      "open", "exec", "type", "read", "snapshot",
      "interrupt", "close",
    ];

    for (const action of terminalActions) {
      assert.equal(typeof bc.terminal[action as keyof typeof bc.terminal], "function", `terminal.${action} is not a function`);
    }
  });

  it("fs namespace has all action methods", () => {
    const bc = createBrowserControl({ memoryStore: store });

    const fsActions = ["read", "write", "ls", "move", "rm", "stat"];

    for (const action of fsActions) {
      assert.equal(typeof bc.fs[action as keyof typeof bc.fs], "function", `fs.${action} is not a function`);
    }
  });

  it("session namespace has all methods", () => {
    const bc = createBrowserControl({ memoryStore: store });

    // Session namespace only exposes create, list, use, status
    const sessionMethods = ["create", "use", "list", "status"];

    for (const method of sessionMethods) {
      assert.equal(typeof bc.session[method as keyof typeof bc.session], "function", `session.${method} is not a function`);
    }

    // Advanced methods are on the sessionManager property
    assert.equal(typeof bc.sessionManager.getActiveSession, "function");
    assert.equal(typeof bc.sessionManager.evaluateAction, "function");
    assert.equal(typeof bc.sessionManager.getBrowserManager, "function");
    assert.equal(typeof bc.sessionManager.getTerminalManager, "function");
  });

  it("creates a session via the session namespace", async () => {
    const bc = createBrowserControl({ memoryStore: store });

    const result = await bc.session.create("facade-test", {
      policyProfile: "balanced",
    });

    assert.equal(result.success, true);
    assert.ok(result.data);
    assert.equal(result.data.name, "facade-test");
  });

  it("session.status returns active session after create", async () => {
    const bc = createBrowserControl({ memoryStore: store });

    await bc.session.create("active-test");
    const status = bc.session.status();

    assert.equal(status.success, true);
    assert.ok(status.data);
    assert.equal(status.data.name, "active-test");
  });

  it("session.list returns sessions", async () => {
    const bc = createBrowserControl({ memoryStore: store });

    await bc.session.create("list-test-1");
    await bc.session.create("list-test-2");

    const result = bc.session.list();

    assert.equal(result.success, true);
    assert.ok(result.data);
    assert.ok(result.data.length >= 2);
  });

  it("fs.write + fs.read round-trip through facade", async () => {
    const bc = createBrowserControl({ memoryStore: store, policyProfile: "trusted" });
    await bc.session.create("fs-facade-test", { policyProfile: "trusted" });

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-facade-"));
    const filePath = path.join(tmpDir, "facade-test.txt");

    try {
      const writeResult = await bc.fs.write({ path: filePath, content: "Hello from facade!" });
      assert.equal(writeResult.success, true, `write failed: ${writeResult.error}`);

      const readResult = await bc.fs.read({ path: filePath });
      assert.equal(readResult.success, true, `read failed: ${readResult.error}`);
      assert.ok(readResult.data!.content.includes("Hello from facade!"));
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it("policyProfile option affects policy decisions", async () => {
    // Safe profile denies high-risk actions like fs_write
    const bc = createBrowserControl({ memoryStore: store, policyProfile: "safe" });
    await bc.session.create("safe-test", { policyProfile: "safe" });

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-safe-"));
    const filePath = path.join(tmpDir, "safe-test.txt");

    try {
      // fs_write is classified as high-risk in the execution router,
      // so safe profile (which denies high-risk) should block it
      const writeResult = await bc.fs.write({ path: filePath, content: "test" });
      assert.equal(writeResult.success, false, "safe profile should deny fs_write");
      assert.ok(writeResult.policyDecision === "deny" || writeResult.error?.includes("Policy"));
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it("provider.use is policy-governed through the TypeScript API", async () => {
    const previousHome = process.env.BROWSER_CONTROL_HOME;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-provider-policy-"));
    process.env.BROWSER_CONTROL_HOME = tmpDir;
    try {
      const bc = createBrowserControl({ memoryStore: store, policyProfile: "safe" });
      await bc.session.create("safe-provider", { policyProfile: "safe" });

      const result = bc.browser.provider.use("browserless");

      assert.equal(result.success, false);
      assert.equal(result.policyDecision, "require_confirmation");
      assert.equal(bc.browser.provider.getActive(), "local");
    } finally {
      if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
      else process.env.BROWSER_CONTROL_HOME = previousHome;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("config.set is policy-governed through the TypeScript API", async () => {
    const previousHome = process.env.BROWSER_CONTROL_HOME;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-config-policy-"));
    process.env.BROWSER_CONTROL_HOME = tmpDir;
    try {
      const bc = createBrowserControl({ memoryStore: store, policyProfile: "safe" });
      await bc.session.create("safe-config", { policyProfile: "safe" });

      const result = bc.config.set("logLevel", "debug");

      assert.equal(result.success, false);
      assert.equal(result.policyDecision, "require_confirmation");
      assert.equal(fs.existsSync(path.join(tmpDir, "config", "config.json")), false);
    } finally {
      if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
      else process.env.BROWSER_CONTROL_HOME = previousHome;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("debug evidence methods are policy-governed through the TypeScript API", async () => {
    const bc = createBrowserControl({ memoryStore: store, policyProfile: "safe" });
    await bc.session.create("safe-debug", { policyProfile: "safe" });

    assert.throws(() => bc.debug.network(), /Confirmation required/);
    assert.throws(() => bc.debug.console(), /Confirmation required/);
    assert.throws(() => bc.debug.listBundles(), /Confirmation required/);
  });
});
