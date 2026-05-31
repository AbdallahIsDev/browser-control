import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { FsActions, type FsActionContext } from "../../src/fs_actions";
import { SessionManager } from "../../src/session_manager";
import { MemoryStore } from "../../src/memory_store";
import { loadDebugBundle } from "../../src/observability/debug_bundle";
import type { BrowserConnectionManager } from "../../src/browser_connection";

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
      const activeSession = sessionManager.getActiveSession()!;
      const filePath = path.join(activeSession.runtimeDir, "test.txt");

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
      const activeSession = sessionManager.getActiveSession()!;
      const readResult = await fsActions.read({
        path: path.join(activeSession.runtimeDir, "nonexistent.txt"),
      });

      assert.equal(readResult.success, false);
      assert.ok(readResult.error);
      assert.ok(readResult.debugBundleId);
      assert.ok(readResult.recoveryGuidance);
      assert.ok(loadDebugBundle(readResult.debugBundleId, store));
    });

    it("honors explicit confirmation for balanced-policy file writes", async () => {
      const session = await sessionManager.create("fs-balanced-write", { policyProfile: "balanced" });
      sessionManager.use(session.data!.id);
      const activeSession = sessionManager.getActiveSession()!;
      const filePath = path.join(activeSession.runtimeDir, "confirmed-write.txt");

      const blocked = await fsActions.write({
        path: filePath,
        content: "blocked",
      });
      assert.equal(blocked.success, false);
      assert.equal(blocked.policyDecision, "require_confirmation");
      assert.equal(fs.existsSync(filePath), false);

      const confirmed = await fsActions.write({
        path: filePath,
        content: "confirmed",
        confirmed: true,
      });
      assert.equal(confirmed.success, true);
      assert.equal(fs.readFileSync(filePath, "utf-8"), "confirmed");
    });

    it("writes relative path resolves within session runtime directory", async () => {
      const activeSession = sessionManager.getActiveSession();
      assert.ok(activeSession);

      const writeResult = await fsActions.write({
        path: "runtime-file.md",
        content: "# Report\n",
      });

      assert.equal(writeResult.success, true);
      assert.ok(writeResult.data?.path.startsWith(activeSession.runtimeDir));
      assert.equal(
        fs.existsSync(path.join(activeSession.runtimeDir, "runtime-file.md")),
        true,
      );
    });

    it("writes absolute paths under the active session working directory", async () => {
      const workDir = fs.mkdtempSync(path.join(tempDir, "workspace-"));
      const session = await sessionManager.create("fs-workdir-write", {
        policyProfile: "trusted",
        workingDirectory: workDir,
      });
      sessionManager.use(session.data!.id);

      const filePath = path.join(workDir, "report.txt");
      const writeResult = await fsActions.write({
        path: filePath,
        content: "workspace write",
      });

      assert.equal(writeResult.success, true, writeResult.error);
      assert.equal(fs.readFileSync(filePath, "utf-8"), "workspace write");
    });

    it("blocks writes outside runtime and working directory roots", async () => {
      const workDir = fs.mkdtempSync(path.join(tempDir, "workspace-"));
      const outsideDir = fs.mkdtempSync(path.join(tempDir, "outside-"));
      const session = await sessionManager.create("fs-workdir-block", {
        policyProfile: "trusted",
        workingDirectory: workDir,
      });
      sessionManager.use(session.data!.id);

      const writeResult = await fsActions.write({
        path: path.join(outsideDir, "report.txt"),
        content: "outside write",
      });

      assert.equal(writeResult.success, false);
      assert.match(writeResult.error ?? "", /allowed roots/i);
    });

    it("writes task output under the active session runtime directory", async () => {
      const activeSession = sessionManager.getActiveSession();
      assert.ok(activeSession);

      const result = await fsActions.writeOutput({
        filename: "reports/espocrm.md",
        content: "# EspoCRM\n",
      });

      assert.equal(result.success, true);
      assert.equal(result.data?.path, path.join(activeSession.runtimeDir, "reports", "espocrm.md"));
      assert.equal(fs.readFileSync(result.data!.path, "utf-8"), "# EspoCRM\n");
    });

    it("rejects output path traversal", async () => {
      const activeSession = sessionManager.getActiveSession();
      assert.ok(activeSession);

      const result = await fsActions.writeOutput({
        filename: "../escape.md",
        content: "escape",
      });

      assert.equal(result.success, false);
      assert.match(result.error ?? "", /session runtime directory/i);
      assert.equal(fs.existsSync(path.join(activeSession.runtimeDir, "..", "escape.md")), false);
    });
  });

  describe("ls", () => {
    it("lists directory contents", async () => {
      const activeSession = sessionManager.getActiveSession()!;
      const runtimeDir = activeSession.runtimeDir;
      // Create some test files
      fs.writeFileSync(path.join(runtimeDir, "a.txt"), "a");
      fs.writeFileSync(path.join(runtimeDir, "b.txt"), "b");
      fs.mkdirSync(path.join(runtimeDir, "subdir"));

      const result = await fsActions.ls({ path: runtimeDir });

      assert.equal(result.success, true);
      assert.ok(result.data);
      assert.ok(result.data.totalEntries >= 3);
    });

    it("returns failure for nonexistent directory", async () => {
      const activeSession = sessionManager.getActiveSession()!;
      const result = await fsActions.ls({
        path: path.join(activeSession.runtimeDir, "no-such-dir"),
      });

      assert.equal(result.success, false);
      assert.ok(result.error);
    });
  });

  describe("stat", () => {
    it("returns file metadata", async () => {
      const activeSession = sessionManager.getActiveSession()!;
      const runtimeDir = activeSession.runtimeDir;
      const filePath = path.join(runtimeDir, "stat-test.txt");
      fs.writeFileSync(filePath, "stat content");

      const result = await fsActions.stat({ path: filePath });

      assert.equal(result.success, true);
      assert.ok(result.data);
      assert.equal(result.data.isFile, true);
      assert.ok(result.data.sizeBytes > 0);
    });

    it("returns result with exists=false for nonexistent path", async () => {
      const activeSession = sessionManager.getActiveSession()!;
      const result = await fsActions.stat({
        path: path.join(activeSession.runtimeDir, "nonexistent"),
      });

      // statPath returns exists:false rather than throwing
      assert.equal(result.success, true);
      assert.equal(result.data!.exists, false);
    });

    // ── Issue 5: fs stat routes through policy pipeline ────────────
    it("stat routes through policy and returns policy metadata", async () => {
      const activeSession = sessionManager.getActiveSession()!;
      const runtimeDir = activeSession.runtimeDir;
      const filePath = path.join(runtimeDir, "stat-policy.txt");
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
      const activeSession = sessionManager.getActiveSession()!;
      const runtimeDir = activeSession.runtimeDir;
      const srcPath = path.join(runtimeDir, "move-src.txt");
      const dstPath = path.join(runtimeDir, "move-dst.txt");
      fs.writeFileSync(srcPath, "move me");

      const result = await fsActions.move({ src: srcPath, dst: dstPath });

      assert.equal(result.success, true);
      assert.ok(!fs.existsSync(srcPath));
      assert.ok(fs.existsSync(dstPath));
    });

    it("returns failure for nonexistent source", async () => {
      const activeSession = sessionManager.getActiveSession()!;
      const runtimeDir = activeSession.runtimeDir;
      const result = await fsActions.move({
        src: path.join(runtimeDir, "no-such-file"),
        dst: path.join(runtimeDir, "destination"),
      });

      assert.equal(result.success, false);
      assert.ok(result.error);
    });

    it("honors explicit confirmation for balanced-policy moves", async () => {
      const session = await sessionManager.create("fs-balanced-move", { policyProfile: "balanced" });
      sessionManager.use(session.data!.id);
      const activeSession = sessionManager.getActiveSession()!;
      const runtimeDir = activeSession.runtimeDir;
      const srcPath = path.join(runtimeDir, "confirmed-move-src.txt");
      const dstPath = path.join(runtimeDir, "confirmed-move-dst.txt");
      fs.writeFileSync(srcPath, "move me");

      const blocked = await fsActions.move({ src: srcPath, dst: dstPath });
      assert.equal(blocked.success, false);
      assert.equal(blocked.policyDecision, "require_confirmation");
      assert.equal(fs.existsSync(srcPath), true);
      assert.equal(fs.existsSync(dstPath), false);

      const confirmed = await fsActions.move({ src: srcPath, dst: dstPath, confirmed: true });
      assert.equal(confirmed.success, true);
      assert.equal(fs.existsSync(srcPath), false);
      assert.equal(fs.existsSync(dstPath), true);
    });
  });

  describe("rm", () => {
    it("deletes a file", async () => {
      const activeSession = sessionManager.getActiveSession()!;
      const runtimeDir = activeSession.runtimeDir;
      const filePath = path.join(runtimeDir, "rm-test.txt");
      fs.writeFileSync(filePath, "delete me");

      const result = await fsActions.rm({ path: filePath });

      assert.equal(result.success, true);
      assert.ok(!fs.existsSync(filePath));
    });

    it("policy blocks recursive delete (requires confirmation)", async () => {
      const activeSession = sessionManager.getActiveSession()!;
      const runtimeDir = activeSession.runtimeDir;
      const dirPath = path.join(runtimeDir, "rm-dir");
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
      const activeSession = sessionManager.getActiveSession()!;
      const runtimeDir = activeSession.runtimeDir;
      const filePath = path.join(runtimeDir, "rm-file.txt");
      fs.writeFileSync(filePath, "delete me");

      const result = await fsActions.rm({ path: filePath });

      assert.equal(result.success, true);
      assert.ok(!fs.existsSync(filePath));
    });

    it("honors explicit confirmation for balanced-policy deletes", async () => {
      const session = await sessionManager.create("fs-balanced-delete", { policyProfile: "balanced" });
      sessionManager.use(session.data!.id);
      const activeSession = sessionManager.getActiveSession()!;
      const runtimeDir = activeSession.runtimeDir;
      const filePath = path.join(runtimeDir, "confirmed-delete.txt");
      fs.writeFileSync(filePath, "delete me");

      const blocked = await fsActions.rm({ path: filePath });
      assert.equal(blocked.success, false);
      assert.equal(blocked.policyDecision, "require_confirmation");
      assert.equal(fs.existsSync(filePath), true);

      const confirmed = await fsActions.rm({ path: filePath, confirmed: true });
      assert.equal(confirmed.success, true);
      assert.equal(fs.existsSync(filePath), false);
    });

    it("honors explicit confirmation for recursive deletes", async () => {
      const activeSession = sessionManager.getActiveSession()!;
      const runtimeDir = activeSession.runtimeDir;
      const dirPath = path.join(runtimeDir, "confirmed-rm-dir");
      fs.mkdirSync(dirPath);
      fs.writeFileSync(path.join(dirPath, "file.txt"), "inside");

      const blocked = await fsActions.rm({ path: dirPath, recursive: true, force: true });
      assert.equal(blocked.success, false);
      assert.equal(blocked.policyDecision, "require_confirmation");
      assert.equal(fs.existsSync(dirPath), true);

      const confirmed = await fsActions.rm({ path: dirPath, recursive: true, force: true, confirmed: true });
      assert.equal(confirmed.success, true);
      assert.equal(fs.existsSync(dirPath), false);
    });

    it("returns failure for nonexistent path without force", async () => {
      const activeSession = sessionManager.getActiveSession()!;
      const result = await fsActions.rm({
        path: path.join(activeSession.runtimeDir, "nonexistent"),
      });

      assert.equal(result.success, false);
      assert.ok(result.error);
    });

    it("succeeds for nonexistent path with force", async () => {
      const activeSession = sessionManager.getActiveSession()!;
      const result = await fsActions.rm({
        path: path.join(activeSession.runtimeDir, "nonexistent"),
        force: true,
      });

      assert.equal(result.success, true);
    });
  });

  // ── Issue 2: CLI fs commands return ActionResult shape ──────────────

  describe("CLI fs commands return ActionResult shape", () => {
    it("fs read returns ActionResult with success, path, sessionId, policyDecision", async () => {
      const activeSession = sessionManager.getActiveSession()!;
      const runtimeDir = activeSession.runtimeDir;
      const filePath = path.join(runtimeDir, "action-result-read.txt");
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
      const activeSession = sessionManager.getActiveSession()!;
      const runtimeDir = activeSession.runtimeDir;
      const filePath = path.join(runtimeDir, "action-result-write.txt");

      const result = await fsActions.write({ path: filePath, content: "test" });

      assert.equal(result.success, true, `write should succeed: ${result.error}`);
      assert.ok(result.path, "ActionResult must have path");
      assert.ok(result.sessionId, "ActionResult must have sessionId");
      assert.ok(result.policyDecision, "ActionResult must have policyDecision");
      assert.ok(result.risk, "ActionResult must have risk");
    });

    it("fs ls returns ActionResult with policy metadata", async () => {
      const activeSession = sessionManager.getActiveSession()!;
      const runtimeDir = activeSession.runtimeDir;

      const result = await fsActions.ls({ path: runtimeDir });

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
      const activeSession = sessionManager.getActiveSession()!;
      const runtimeDir = activeSession.runtimeDir;
      const filePath = path.join(runtimeDir, "stat-action-result.txt");
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
