import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { FsActions, type FsActionContext } from "./fs_actions";
import { SessionManager } from "./session_manager";
import { MemoryStore } from "./memory_store";
import { loadDebugBundle } from "./observability/debug_bundle";
import type { BrowserConnectionManager } from "./browser_connection";

function createUnavailableBrowserManager() {
  return {
    getContext: () => null,
    getBrowser: () => null,
    isConnected: () => false,
    getConnection: () => null,
  } as unknown as BrowserConnectionManager;
}

describe("FsActions", () => {
  let sessionManager: SessionManager;
  let fsActions: FsActions;
  let tempDir: string;
  let store: MemoryStore;
  let dataHome: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    originalHome = process.env.BROWSER_CONTROL_HOME;
    dataHome = fs.mkdtempSync(path.join(os.tmpdir(), "bc-fs-actions-home-"));
    process.env.BROWSER_CONTROL_HOME = dataHome;
    store = new MemoryStore({ filename: ":memory:" });
    sessionManager = new SessionManager({ memoryStore: store, browserManager: createUnavailableBrowserManager() });
    await sessionManager.create("fs-test", { policyProfile: "trusted" });
    fsActions = new FsActions({ sessionManager });
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-fs-test-"));
  });

  afterEach(() => {
    sessionManager.close();
    // Clean up temp directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    if (originalHome === undefined) {
      delete process.env.BROWSER_CONTROL_HOME;
    } else {
      process.env.BROWSER_CONTROL_HOME = originalHome;
    }
    fs.rmSync(dataHome, { recursive: true, force: true });
  });

  describe("constructor", () => {
    it("creates instance with session manager", () => {
      const actions = new FsActions({ sessionManager });
      assert.ok(actions);
    });
  });

  describe("write + read", () => {
    it("writes and reads a file", async () => {
      const filePath = path.join(tempDir, "test.txt");

      const writeResult = await fsActions.write({
        path: filePath,
        content: "Hello, world!",
      });

      assert.equal(writeResult.success, true);
      assert.ok(writeResult.data);
      assert.equal(writeResult.data.path, filePath);

      const readResult = await fsActions.read({ path: filePath });

      assert.equal(readResult.success, true);
      assert.ok(readResult.data);
      assert.ok(readResult.data.content.includes("Hello, world!"));
    });

    it("returns failure for reading nonexistent file", async () => {
      const readResult = await fsActions.read({
        path: path.join(tempDir, "nonexistent.txt"),
      });

      assert.equal(readResult.success, false);
      assert.ok(readResult.error);
      assert.ok(readResult.debugBundleId);
      assert.ok(readResult.recoveryGuidance);
      assert.ok(loadDebugBundle(readResult.debugBundleId, store));
    });
  });

  describe("ls", () => {
    it("lists directory contents", async () => {
      // Create some test files
      fs.writeFileSync(path.join(tempDir, "a.txt"), "a");
      fs.writeFileSync(path.join(tempDir, "b.txt"), "b");
      fs.mkdirSync(path.join(tempDir, "subdir"));

      const result = await fsActions.ls({ path: tempDir });

      assert.equal(result.success, true);
      assert.ok(result.data);
      assert.ok(result.data.totalEntries >= 3);
    });

    it("returns failure for nonexistent directory", async () => {
      const result = await fsActions.ls({
        path: path.join(tempDir, "no-such-dir"),
      });

      assert.equal(result.success, false);
      assert.ok(result.error);
    });
  });

  describe("stat", () => {
    it("returns file metadata", async () => {
      const filePath = path.join(tempDir, "stat-test.txt");
      fs.writeFileSync(filePath, "stat content");

      const result = await fsActions.stat({ path: filePath });

      assert.equal(result.success, true);
      assert.ok(result.data);
      assert.equal(result.data.isFile, true);
      assert.ok(result.data.sizeBytes > 0);
    });

    it("returns result with exists=false for nonexistent path", async () => {
      const result = await fsActions.stat({
        path: path.join(tempDir, "nonexistent"),
      });

      // statPath returns exists:false rather than throwing
      assert.equal(result.success, true);
      assert.equal(result.data!.exists, false);
    });

    // ── Issue 5: fs stat routes through policy pipeline ────────────
    it("stat routes through policy and returns policy metadata", async () => {
      const filePath = path.join(tempDir, "stat-policy.txt");
      fs.writeFileSync(filePath, "policy check");

      const result = await fsActions.stat({ path: filePath });

      assert.equal(result.success, true, `stat failed: ${result.error}`);
      // Stat should now carry real policy metadata from the pipeline
      assert.ok(result.policyDecision, "stat must carry policyDecision");
      assert.ok(result.risk, "stat must carry risk");
      assert.equal(result.path, "command", "stat should route through command path");
    });
  });

  describe("move", () => {
    it("moves a file", async () => {
      const srcPath = path.join(tempDir, "move-src.txt");
      const dstPath = path.join(tempDir, "move-dst.txt");
      fs.writeFileSync(srcPath, "move me");

      const result = await fsActions.move({ src: srcPath, dst: dstPath });

      assert.equal(result.success, true);
      assert.ok(!fs.existsSync(srcPath));
      assert.ok(fs.existsSync(dstPath));
    });

    it("returns failure for nonexistent source", async () => {
      const result = await fsActions.move({
        src: path.join(tempDir, "no-such-file"),
        dst: path.join(tempDir, "destination"),
      });

      assert.equal(result.success, false);
      assert.ok(result.error);
    });
  });

  describe("rm", () => {
    it("deletes a file", async () => {
      const filePath = path.join(tempDir, "rm-test.txt");
      fs.writeFileSync(filePath, "delete me");

      const result = await fsActions.rm({ path: filePath });

      assert.equal(result.success, true);
      assert.ok(!fs.existsSync(filePath));
    });

    it("policy blocks recursive delete (requires confirmation)", async () => {
      const dirPath = path.join(tempDir, "rm-dir");
      fs.mkdirSync(dirPath);
      fs.writeFileSync(path.join(dirPath, "file.txt"), "inside");

      const result = await fsActions.rm({ path: dirPath, recursive: true });

      // Even trusted profile requires confirmation for recursive delete
      // (recursiveDeleteDefaultBehavior: "require_confirmation")
      assert.equal(result.success, false);
      assert.ok(result.policyDecision === "require_confirmation" || result.error);
      // Directory should still exist since the action was blocked
      assert.ok(fs.existsSync(dirPath));

      // Clean up manually
      fs.rmSync(dirPath, { recursive: true, force: true });
    });

    it("deletes a single file (non-recursive)", async () => {
      const filePath = path.join(tempDir, "rm-file.txt");
      fs.writeFileSync(filePath, "delete me");

      const result = await fsActions.rm({ path: filePath });

      assert.equal(result.success, true);
      assert.ok(!fs.existsSync(filePath));
    });

    it("returns failure for nonexistent path without force", async () => {
      const result = await fsActions.rm({
        path: path.join(tempDir, "nonexistent"),
      });

      assert.equal(result.success, false);
      assert.ok(result.error);
    });

    it("succeeds for nonexistent path with force", async () => {
      const result = await fsActions.rm({
        path: path.join(tempDir, "nonexistent"),
        force: true,
      });

      assert.equal(result.success, true);
    });
  });

  // ── Issue 2: CLI fs commands return ActionResult shape ──────────────

  describe("CLI fs commands return ActionResult shape", () => {
    it("fs read returns ActionResult with success, path, sessionId, policyDecision", async () => {
      const filePath = path.join(tempDir, "action-result-read.txt");
      fs.writeFileSync(filePath, "action result test");

      const result = await fsActions.read({ path: filePath });

      assert.equal(result.success, true, `read should succeed: ${result.error}`);
      assert.ok(result.path, "ActionResult must have path");
      assert.ok(result.sessionId, "ActionResult must have sessionId");
      assert.ok(result.policyDecision, "ActionResult must have policyDecision");
      assert.ok(result.risk, "ActionResult must have risk");
      assert.ok(result.completedAt, "ActionResult must have completedAt");
    });

    it("fs write returns ActionResult with policy metadata", async () => {
      const filePath = path.join(tempDir, "action-result-write.txt");

      const result = await fsActions.write({ path: filePath, content: "test" });

      assert.equal(result.success, true, `write should succeed: ${result.error}`);
      assert.ok(result.path, "ActionResult must have path");
      assert.ok(result.sessionId, "ActionResult must have sessionId");
      assert.ok(result.policyDecision, "ActionResult must have policyDecision");
      assert.ok(result.risk, "ActionResult must have risk");
    });

    it("fs ls returns ActionResult with policy metadata", async () => {
      const result = await fsActions.ls({ path: tempDir });

      assert.equal(result.success, true, `ls should succeed: ${result.error}`);
      assert.ok(result.path, "ActionResult must have path");
      assert.ok(result.sessionId, "ActionResult must have sessionId");
      assert.ok(result.policyDecision, "ActionResult must have policyDecision");
    });

    it("policy-denied fs action returns ActionResult with policyDecision", async () => {
      // Create a safe session — fs_write is high risk, safe denies high risk
      const safeStore = new MemoryStore({ filename: ":memory:" });
      const safeManager = new SessionManager({
        memoryStore: safeStore,
        browserManager: createUnavailableBrowserManager(),
      });
      await safeManager.create("safe-fs", { policyProfile: "safe" });
      const safeFs = new FsActions({ sessionManager: safeManager });

      const result = await safeFs.write({ path: "/tmp/safe-deny-test.txt", content: "denied" });

      // Should be denied or require confirmation
      if (!result.success) {
        assert.ok(result.policyDecision, "denied ActionResult must have policyDecision");
        assert.ok(result.path, "denied ActionResult must have path");
        assert.ok(result.sessionId, "denied ActionResult must have sessionId");
      }

      safeManager.close();
    });

    it("fs stat returns ActionResult with policy metadata", async () => {
      const filePath = path.join(tempDir, "stat-action-result.txt");
      fs.writeFileSync(filePath, "stat");

      const result = await fsActions.stat({ path: filePath });

      assert.equal(result.success, true, `stat should succeed: ${result.error}`);
      assert.ok(result.path, "ActionResult must have path");
      assert.ok(result.sessionId, "ActionResult must have sessionId");
      assert.ok(result.policyDecision, "ActionResult must have policyDecision");
      assert.ok(result.risk, "ActionResult must have risk");
    });
  });
});
