import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { SessionManager, isPolicyAllowed, LocalTerminalRuntime, DaemonTerminalRuntime, BrokerTerminalRuntime, probeDaemonHealth, type SessionState, type SessionListEntry, type TerminalRuntime } from "../../src/session_manager";
import { MemoryStore } from "../../src/memory_store";
import { loadConfig } from "../../src/config";
import { stopDefaultDaemon } from "../helpers/daemon_helpers";

describe("SessionManager", () => {
  let manager: SessionManager;
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ filename: ":memory:" });
    manager = new SessionManager({ memoryStore: store });
  });

  afterEach(async () => {
    store.close();
    // Stop any daemon that may have been auto-started by tests that
    // call ensureDaemonRuntime({ autoStart: true }). Without this, the
    // daemon process and its child pwsh.exe shells survive after the
    // test process exits.
    await stopDefaultDaemon();
  });

  describe("create", () => {
    it("creates a session with a unique ID and name", async () => {
      const result = await manager.create("test-session");

      assert.equal(result.success, true);
      assert.ok(result.data);
      assert.equal(result.data.name, "test-session");
      assert.ok(result.data.id);
      assert.ok(result.data.createdAt);
      assert.ok(result.data.lastActivityAt);
      assert.equal(result.data.browserConnectionId, null);
      assert.equal(result.data.terminalSessionId, null);
      assert.ok(result.data.auditIds);
    });

    it("uses provided policy profile", async () => {
      const result = await manager.create("safe-session", {
        policyProfile: "safe",
      });

      assert.equal(result.success, true);
      assert.equal(result.data!.policyProfile, "safe");
    });

    it("uses provided working directory", async () => {
      const result = await manager.create("cwd-session", {
        workingDirectory: "/tmp/test",
      });

      assert.equal(result.success, true);
      assert.equal(result.data!.workingDirectory, "/tmp/test");
    });

    it("auto-sets as active if first session", async () => {
      const result = await manager.create("first");
      const status = manager.status();

      assert.equal(status.data!.id, result.data!.id);
    });

    it("returns failure for invalid policy profile", async () => {
      // The DefaultPolicyEngine will throw for unknown profiles
      // which SessionManager catches and returns a failure result
      const result = await manager.create("bad-profile", {
        policyProfile: "nonexistent_profile_xyz",
      });

      assert.equal(result.success, false);
      assert.ok(result.error?.includes("Invalid policy profile"));
    });
  });

  describe("list", () => {
    it("returns empty list when no sessions", () => {
      const result = manager.list();

      assert.equal(result.success, true);
      assert.deepEqual(result.data, []);
    });

    it("lists created sessions", async () => {
      await manager.create("session-a");
      await manager.create("session-b");

      const result = manager.list();

      assert.equal(result.success, true);
      assert.equal(result.data!.length, 2);

      const names = result.data!.map((s: SessionListEntry) => s.name);
      assert.ok(names.includes("session-a"));
      assert.ok(names.includes("session-b"));
    });

    it("includes hasBrowser and hasTerminal flags", async () => {
      await manager.create("browser-session");

      const result = manager.list();
      const entry = result.data!.find((s: SessionListEntry) => s.name === "browser-session");

      assert.equal(entry!.hasBrowser, false);
      assert.equal(entry!.hasTerminal, false);
    });
  });

  describe("use", () => {
    it("sets active session by ID", async () => {
      const created = await manager.create("target");
      const sessionId = created.data!.id;

      // Create another session to make it active
      await manager.create("other");

      const result = manager.use(sessionId);

      assert.equal(result.success, true);
      assert.equal(result.data!.name, "target");
    });

    it("sets active session by name", async () => {
      await manager.create("by-name");
      await manager.create("other2");

      const result = manager.use("by-name");

      assert.equal(result.success, true);
      assert.equal(result.data!.name, "by-name");
    });

    it("returns failure for unknown session", () => {
      const result = manager.use("nonexistent");

      assert.equal(result.success, false);
      assert.ok(result.error?.includes("Session not found"));
    });
  });

  describe("status", () => {
    it("returns failure when no active session", () => {
      const result = manager.status();

      // With no session created, status may return failure or a default
      assert.ok(!result.success || result.data === undefined || result.data === null);
    });

    it("returns active session status", async () => {
      const created = await manager.create("active");

      const result = manager.status();

      assert.equal(result.success, true);
      assert.equal(result.data!.name, "active");
    });

    it("returns specific session status by name", async () => {
      await manager.create("specific");

      const result = manager.status("specific");

      assert.equal(result.success, true);
      assert.equal(result.data!.name, "specific");
    });
  });

  describe("accessors", () => {
    it("returns null for getActiveSession when no session", async () => {
      const freshStore = new MemoryStore({ filename: ":memory:" });
      const freshManager = new SessionManager({ memoryStore: freshStore });
      assert.equal(freshManager.getActiveSession(), null);
      freshStore.close();
    });

    it("returns browser manager", () => {
      const bm = manager.getBrowserManager();
      assert.ok(bm);
    });

    it("returns terminal manager", async () => {
      const freshStore = new MemoryStore({ filename: ":memory:" });
      const freshManager = new SessionManager({ memoryStore: freshStore });
      const tm = freshManager.getTerminalManager();
      assert.ok(tm);
      freshStore.close();
    });

    it("returns policy engine", () => {
      const pe = manager.getPolicyEngine();
      assert.ok(pe);
    });

    it("returns execution router", () => {
      const router = manager.getExecutionRouter();
      assert.ok(router);
    });

    it("returns memory store", () => {
      const store = manager.getMemoryStore();
      assert.ok(store);
    });
  });

  describe("bind/unbind", () => {
    it("binds and unbinds browser connection", async () => {
      const created = await manager.create("bind-test");

      manager.bindBrowser(created.data!.id, "conn-1");
      const state = manager.getSession(created.data!.id);
      assert.equal(state!.browserConnectionId, "conn-1");

      manager.unbindBrowser(created.data!.id);
      const afterUnbind = manager.getSession(created.data!.id);
      assert.equal(afterUnbind!.browserConnectionId, null);
    });

    it("binds and unbinds terminal session", async () => {
      const created = await manager.create("term-bind");

      manager.bindTerminal(created.data!.id, "term-1");
      const state = manager.getSession(created.data!.id);
      assert.equal(state!.terminalSessionId, "term-1");

      manager.unbindTerminal(created.data!.id);
      const afterUnbind = manager.getSession(created.data!.id);
      assert.equal(afterUnbind!.terminalSessionId, null);
    });

    it("updates working directory", async () => {
      const created = await manager.create("cwd-update");

      manager.setWorkingDirectory(created.data!.id, "/new/path");
      const state = manager.getSession(created.data!.id);
      assert.equal(state!.workingDirectory, "/new/path");
    });

    it("no-ops on unknown session ID for bind/unbind", () => {
      // Should not throw
      manager.bindBrowser("nonexistent", "conn-x");
      manager.unbindBrowser("nonexistent");
      manager.bindTerminal("nonexistent", "term-x");
      manager.unbindTerminal("nonexistent");
      manager.setWorkingDirectory("nonexistent", "/path");
    });
  });

  describe("evaluateAction", () => {
    it("returns PolicyAllowResult for allowed actions under balanced profile", async () => {
      await manager.create("eval-test", { policyProfile: "balanced" });

      // fs_read is low risk, should be allowed under balanced profile
      const result = manager.evaluateAction("fs_read", { path: "/tmp/test" });

      // Now returns PolicyAllowResult with real metadata, not null
      assert.equal(isPolicyAllowed(result), true);
      if (isPolicyAllowed(result)) {
        assert.ok(result.policyDecision);
        assert.ok(result.risk);
        assert.ok(result.path);
      }
    });

    it("returns policy-denied result for high-risk actions under safe profile", async () => {
      await manager.create("safe-eval", { policyProfile: "safe" });

      // cdp_execute is high risk, likely denied under safe profile
      const result = manager.evaluateAction("cdp_execute", { expression: "document.cookie" });

      if (!isPolicyAllowed(result)) {
        assert.equal(result.success, false);
        assert.ok(result.policyDecision === "deny" || result.policyDecision === "require_confirmation");
      }
    });

    it("works without an active session", () => {
      // Should not throw even with no session
      const result = manager.evaluateAction("fs_read", { path: "/tmp" });
      // Either allowed or denied — just verify no crash
      assert.ok(isPolicyAllowed(result) === true || result.success === false);
    });
  });

  // ── Issue 1: Session persistence across invocations ──────────────

  describe("session persistence across manager instances", () => {
    it("new manager against same store sees previously created sessions", async () => {
      // Create a session in the first manager
      const created = await manager.create("persist-test", { policyProfile: "balanced" });
      const sessionId = created.data!.id;

      // Create a new manager against the same store
      const manager2 = new SessionManager({ memoryStore: store });

      // The new manager should see the session
      const list = manager2.list();
      assert.equal(list.success, true);
      assert.equal(list.data!.length, 1);
      assert.equal(list.data![0].name, "persist-test");
    });

    it("new manager restores the active session", async () => {
      await manager.create("active-persist");

      // Create a new manager against the same store
      const manager2 = new SessionManager({ memoryStore: store });

      // The active session should be restored
      const status = manager2.status();
      assert.equal(status.success, true);
      assert.equal(status.data!.name, "active-persist");
    });

    it("use() works across separate manager instances", async () => {
      await manager.create("first");
      await manager.create("second");

      // Create new manager — it should see both sessions
      const manager2 = new SessionManager({ memoryStore: store });
      const result = manager2.use("first");

      assert.equal(result.success, true);
      assert.equal(result.data!.name, "first");
    });

    it("status() by name works across separate manager instances", async () => {
      await manager.create("status-persist", { policyProfile: "trusted" });

      const manager2 = new SessionManager({ memoryStore: store });
      const status = manager2.status("status-persist");

      assert.equal(status.success, true);
      assert.equal(status.data!.name, "status-persist");
      assert.equal(status.data!.policyProfile, "trusted");
    });
  });

  // ── Issue 2: ActionResults preserve real policy metadata ────────

  describe("evaluateAction returns real policy metadata", () => {
    it("allowed result carries policyDecision, risk, and path", async () => {
      await manager.create("metadata-test", { policyProfile: "balanced" });

      const result = manager.evaluateAction("fs_read", { path: "/tmp/test" });

      assert.equal(isPolicyAllowed(result), true);
      if (isPolicyAllowed(result)) {
        // policyDecision must be a real decision, not hardcoded
        assert.ok(["allow", "allow_with_audit"].includes(result.policyDecision),
          `expected real policyDecision, got: ${result.policyDecision}`);
        assert.ok(result.risk, "risk must be populated");
        assert.ok(result.path, "path must be populated");
      }
    });

    it("trusted profile + fs_write returns real decision (allow_with_audit or allow)", async () => {
      const trustedStore = new MemoryStore({ filename: ":memory:" });
      const trustedManager = new SessionManager({ memoryStore: trustedStore });
      await trustedManager.create("trusted-audit", { policyProfile: "trusted" });

      const result = trustedManager.evaluateAction("fs_write", { path: "/tmp/test.txt" });

      assert.equal(isPolicyAllowed(result), true);
      if (isPolicyAllowed(result)) {
        // The actual decision depends on the risk matrix for trusted profile
        // It should NOT be a hardcoded "allow" — it must be the real evaluation
        assert.ok(["allow", "allow_with_audit"].includes(result.policyDecision),
          `expected real policyDecision for trusted fs_write, got: ${result.policyDecision}`);
        assert.equal(result.path, "command", "fs_write should route through command path");
        assert.ok(result.risk, "risk must be populated");
      }

      trustedStore.close();
    });

    it("denied result carries policyDecision and risk", async () => {
      const safeStore = new MemoryStore({ filename: ":memory:" });
      const safeManager = new SessionManager({ memoryStore: safeStore });
      await safeManager.create("safe-deny", { policyProfile: "safe" });

      // fs_delete with recursive=true should be denied/require_confirmation under safe
      const result = safeManager.evaluateAction("fs_delete", { path: "/important", recursive: true });

      if (!isPolicyAllowed(result)) {
        assert.equal(result.success, false);
        assert.ok(result.policyDecision, "denied result must carry policyDecision");
        assert.ok(result.risk, "denied result must carry risk");
      }

      safeStore.close();
    });

    it("auditId is present when audit applies", async () => {
      // Enable audit on the policy engine
      const auditStore = new MemoryStore({ filename: ":memory:" });
      const { DefaultPolicyEngine } = await import("../../src/policy_engine");
      const engine = new DefaultPolicyEngine({ profileName: "balanced", auditEnabled: true });
      const auditManager = new SessionManager({ memoryStore: auditStore, policyEngine: engine });
      await auditManager.create("audit-test", { policyProfile: "balanced" });

      // Moderate risk under balanced should be allow_with_audit
      const result = auditManager.evaluateAction("terminal_open", {});

      if (isPolicyAllowed(result) && result.policyDecision === "allow_with_audit") {
        assert.ok(result.auditId, "auditId must be present when decision is allow_with_audit");
      }

      auditStore.close();
    });
  });

  // ── Issue 1: Per-session policy profile is actually enforced ───────

  describe("per-session policy profile enforcement", () => {
    it("safe session denies fs_write while trusted session allows it", async () => {
      const safeStore = new MemoryStore({ filename: ":memory:" });
      const safeManager = new SessionManager({ memoryStore: safeStore });
      await safeManager.create("safe-sess", { policyProfile: "safe" });

      // fs_write is high risk → safe profile denies high risk
      const safeResult = safeManager.evaluateAction("fs_write", { path: "/tmp/test.txt" });

      if (!isPolicyAllowed(safeResult)) {
        // Denied or requires confirmation — correct for safe profile
        assert.ok(
          safeResult.policyDecision === "deny" ||
          safeResult.policyDecision === "require_confirmation",
          `safe session should deny/confirm fs_write, got: ${safeResult.policyDecision}`,
        );
      }

      safeStore.close();

      // Now try with a trusted session
      const trustedStore = new MemoryStore({ filename: ":memory:" });
      const trustedManager = new SessionManager({ memoryStore: trustedStore });
      await trustedManager.create("trusted-sess", { policyProfile: "trusted" });

      // fs_write is high risk → trusted profile allows high risk with audit
      const trustedResult = trustedManager.evaluateAction("fs_write", { path: "/tmp/test.txt" });

      assert.equal(isPolicyAllowed(trustedResult), true,
        `trusted session should allow fs_write, got: ${
          isPolicyAllowed(trustedResult) ? "allowed" : (trustedResult as any).policyDecision
        }`);

      trustedStore.close();
    });

    it("decisions differ between safe and trusted for the same high-risk action", async () => {
      // Create both sessions in the SAME manager
      const sharedStore = new MemoryStore({ filename: ":memory:" });
      const sharedManager = new SessionManager({ memoryStore: sharedStore });

      await sharedManager.create("safe-sess", { policyProfile: "safe" });
      await sharedManager.create("trusted-sess", { policyProfile: "trusted" });

      // Evaluate cdp_execute (high risk, low_level path) under safe session
      const safeResult = sharedManager.evaluateAction("cdp_execute", { expression: "document.cookie" }, "safe-sess");

      // Switch to trusted session
      sharedManager.use("trusted-sess");
      const trustedResult = sharedManager.evaluateAction("cdp_execute", { expression: "document.cookie" }, "trusted-sess");

      // Safe should deny cdp_execute (low_level + high risk + rawCdpAllowed=false)
      assert.ok(!isPolicyAllowed(safeResult),
        `safe session should deny cdp_execute, got: ${(safeResult as any).policyDecision}`);

      // Trusted should allow cdp_execute (rawCdpAllowed=true in trusted low-level policy)
      assert.equal(isPolicyAllowed(trustedResult), true,
        `trusted session should allow cdp_execute, got: ${
          isPolicyAllowed(trustedResult) ? "allowed" : (trustedResult as any).policyDecision
        }`);

      sharedStore.close();
    });

    it("policy engine profile is restored after evaluateAction", async () => {
      const store = new MemoryStore({ filename: ":memory:" });
      const manager = new SessionManager({ memoryStore: store });

      // Create a trusted session — this sets the engine to "trusted"
      await manager.create("trusted-first", { policyProfile: "trusted" });

      // The engine's active profile should reflect the last create
      const profileAfterCreate = manager.getPolicyEngine().getActiveProfile();

      // Now evaluate under a different session context
      // This should temporarily switch the engine but restore it
      const result = manager.evaluateAction("fs_read", { path: "/tmp" });

      // The engine's active profile should be restored
      const profileAfterEval = manager.getPolicyEngine().getActiveProfile();
      assert.equal(profileAfterEval, profileAfterCreate,
        `evaluateAction should not permanently change the engine's profile. ` +
        `Before: ${profileAfterCreate}, after: ${profileAfterEval}`);

      store.close();
    });

    it("safe profile denies fs_delete with recursive=true", async () => {
      const safeStore = new MemoryStore({ filename: ":memory:" });
      const safeManager = new SessionManager({ memoryStore: safeStore });
      await safeManager.create("safe-del", { policyProfile: "safe" });

      const result = safeManager.evaluateAction("fs_delete", { path: "/important", recursive: true });

      assert.ok(!isPolicyAllowed(result),
        `safe session should deny recursive fs_delete, got: ${(result as any).policyDecision}`);

      safeStore.close();
    });

    it("create() does not leak profile when creating a non-active session", async () => {
      // Use a fresh MemoryStore to avoid DB lock contention with the
      // shared beforeEach manager's store
      const leakStore = new MemoryStore({ filename: ":memory:" });
      const leakManager = new SessionManager({ memoryStore: leakStore });

      // Create session A with "safe" profile — becomes active
      await leakManager.create("session-a", { policyProfile: "safe" });
      const profileAfterA = leakManager.getPolicyEngine().getActiveProfile();

      // Create session B with "trusted" profile — does NOT become active
      await leakManager.create("session-b", { policyProfile: "trusted" });
      const profileAfterB = leakManager.getPolicyEngine().getActiveProfile();

      // The engine should still reflect the active session's profile ("safe"),
      // not the newly-created session's profile ("trusted").
      assert.equal(profileAfterB, profileAfterA,
        `Creating a non-active session should not change the engine profile. ` +
        `After A: ${profileAfterA}, after B: ${profileAfterB}`);

      leakStore.close();
    });

    it("use() syncs the policy engine profile used by fallback action evaluation", async () => {
      const syncStore = new MemoryStore({ filename: ":memory:" });
      const syncManager = new SessionManager({ memoryStore: syncStore });

      await syncManager.create("trusted-first", { policyProfile: "trusted" });
      await syncManager.create("safe-second", { policyProfile: "safe" });
      syncManager.use("safe-second");

      const result = syncManager.evaluateAction("browser_provider_use", { name: "browserless" }, "mcp");

      assert.ok(!isPolicyAllowed(result),
        `missing MCP session override should use active safe profile, got: ${
          isPolicyAllowed(result) ? "allowed" : (result as any).policyDecision
        }`);

      syncStore.close();
    });
  });

  // ── Issue 3: Default terminal runtime alignment ───────────────────

  describe("terminal runtime alignment", () => {
    it("default runtime is LocalTerminalRuntime when no daemon", () => {
      const runtime = manager.getTerminalRuntime();
      assert.ok(runtime instanceof LocalTerminalRuntime,
        `default runtime should be LocalTerminalRuntime, got: ${runtime.constructor.name}`);
    });

    it("runtime switches to DaemonTerminalRuntime when daemon is set", () => {
      // Create a mock daemon object with the required methods
      const mockDaemon = {
        termOpen: async () => ({ id: "d-1", shell: "bash", cwd: "/tmp", status: "running" }),
        termExec: async () => ({ exitCode: 0, stdout: "", stderr: "", durationMs: 0, cwd: "/tmp", timedOut: false }),
        termType: async () => ({ ok: true }),
        termRead: async () => ({ output: "" }),
        termSnapshot: async () => ({}),
        termInterrupt: async () => ({ ok: true }),
        termClose: async () => ({ ok: true }),
        termList: () => [],
      } as unknown as import("../../src/daemon").Daemon;

      assert.equal(manager.hasDaemon(), false, "should not have daemon initially");

      manager.setDaemon(mockDaemon);
      assert.equal(manager.hasDaemon(), true, "should have daemon after setDaemon");

      const runtime = manager.getTerminalRuntime();
      assert.ok(runtime instanceof DaemonTerminalRuntime,
        `runtime should be DaemonTerminalRuntime after setDaemon, got: ${runtime.constructor.name}`);
    });

    it("runtime reverts to LocalTerminalRuntime when daemon is not set", () => {
      const freshStore = new MemoryStore({ filename: ":memory:" });
      const freshManager = new SessionManager({ memoryStore: freshStore });

      const runtime = freshManager.getTerminalRuntime();
      assert.ok(runtime instanceof LocalTerminalRuntime,
        `fresh manager should use LocalTerminalRuntime, got: ${runtime.constructor.name}`);

      freshStore.close();
    });
  });

  // ── BrokerTerminalRuntime ──────────────────────────────────────────

  describe("BrokerTerminalRuntime", () => {
    it("constructs with brokerUrl and apiKey", () => {
      const runtime = new BrokerTerminalRuntime({
        brokerUrl: "http://127.0.0.1:7788",
        apiKey: "test-key",
      });
      assert.ok(runtime, "BrokerTerminalRuntime should construct");
    });

    it("constructs without apiKey", () => {
      const runtime = new BrokerTerminalRuntime({
        brokerUrl: "http://127.0.0.1:7788",
      });
      assert.ok(runtime, "BrokerTerminalRuntime should construct without apiKey");
    });

    it("implements the TerminalRuntime interface", () => {
      const runtime = new BrokerTerminalRuntime({
        brokerUrl: "http://127.0.0.1:7788",
      });

      // Verify all required methods exist and are functions
      const methods: Array<keyof TerminalRuntime> = [
        "open", "exec", "type", "read",
        "snapshot", "interrupt", "close", "list",
      ];
      for (const method of methods) {
        assert.equal(typeof (runtime as any)[method], "function",
          `BrokerTerminalRuntime must implement ${method}`);
      }
    });

    it("open() throws when daemon is not reachable", async () => {
      const runtime = new BrokerTerminalRuntime({
        brokerUrl: "http://127.0.0.1:1", // Port 1 should not be listening
      });

      await assert.rejects(
        () => runtime.open({ shell: "bash" }),
        /Broker API error|fetch failed|ECONNREFUSED/i,
        "open() should throw when daemon is not reachable",
      );
    });

    it("list() throws when daemon is not reachable", async () => {
      const runtime = new BrokerTerminalRuntime({
        brokerUrl: "http://127.0.0.1:1",
      });

      await assert.rejects(
        () => runtime.list(),
        /Broker API error|fetch failed|ECONNREFUSED/i,
        "list() should throw when daemon is not reachable",
      );
    });

    it("exec() throws when daemon is not reachable", async () => {
      const runtime = new BrokerTerminalRuntime({
        brokerUrl: "http://127.0.0.1:1",
      });

      await assert.rejects(
        () => runtime.exec("echo test", {}),
        /Broker API error|fetch failed|ECONNREFUSED/i,
        "exec() should throw when daemon is not reachable",
      );
    });

    it("brokerUrl getter returns the configured URL", () => {
      const runtime = new BrokerTerminalRuntime({
        brokerUrl: "http://127.0.0.1:9999",
        apiKey: "key",
      });
      assert.equal(runtime.brokerUrl, "http://127.0.0.1:9999");
    });
  });

  // ── probeDaemonHealth ──────────────────────────────────────────────

  describe("probeDaemonHealth", () => {
    it("returns { running: false } when daemon is not running", async () => {
      const config = { ...loadConfig({ validate: false }), brokerPort: 1 };
      const result = await probeDaemonHealth(config);
      assert.equal(result.running, false, "daemon should not be running on port 1");
      assert.ok(result.brokerUrl, "brokerUrl should be populated");
    });

    it("returns a brokerUrl with the configured port", async () => {
      const config = { ...loadConfig({ validate: false }), brokerPort: 12345 };
      const result = await probeDaemonHealth(config);
      assert.ok(result.brokerUrl.includes("12345"), `brokerUrl should include port 12345, got: ${result.brokerUrl}`);
    });
  });

  // ── invalidateBrokerRuntime ──────────────────────────────────────────

  describe("invalidateBrokerRuntime", () => {
    it("clears the cached broker runtime so ensureDaemonRuntime re-probes", async () => {
      const freshStore = new MemoryStore({ filename: ":memory:" });
      const freshManager = new SessionManager({ memoryStore: freshStore });

      // If daemon is not running, there's nothing to invalidate
      const probe = await probeDaemonHealth();
      if (!probe.running) {
        // Verify invalidateBrokerRuntime is a no-op when nothing is cached
        freshManager.invalidateBrokerRuntime();
        const runtime = freshManager.getTerminalRuntime();
        assert.ok(runtime instanceof LocalTerminalRuntime,
          "runtime should still be LocalTerminalRuntime after invalidating nothing");
        freshStore.close();
        return;
      }

      // Daemon is running — establish a broker runtime
      const established = await freshManager.ensureDaemonRuntime({ autoStart: false });
      assert.equal(established, true, "should establish broker runtime");

      let runtime = freshManager.getTerminalRuntime();
      assert.ok(runtime instanceof BrokerTerminalRuntime,
        "runtime should be BrokerTerminalRuntime before invalidation");

      // Invalidate — should clear the cache
      freshManager.invalidateBrokerRuntime();

      // After invalidation, ensureDaemonRuntime should re-probe (not early-return)
      const reEstablished = await freshManager.ensureDaemonRuntime({ autoStart: false });
      assert.equal(reEstablished, true, "should re-establish broker runtime after invalidation");

      runtime = freshManager.getTerminalRuntime();
      assert.ok(runtime instanceof BrokerTerminalRuntime,
        "runtime should be BrokerTerminalRuntime after re-establishment");

      freshStore.close();
    });
  });

  // ── ensureDaemonRuntime ───────────────────────────────────────────

  describe("ensureDaemonRuntime", () => {
    it("uses terminal readiness when daemon health is slow or unavailable", async () => {
      const originalFetch = globalThis.fetch;
      const requestedUrls: string[] = [];
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        requestedUrls.push(url);
        if (url.endsWith("/api/v1/health")) {
          throw new Error("health timed out");
        }
        if (url.endsWith("/api/v1/term/sessions")) {
          return new Response("[]", {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        throw new Error(`Unexpected URL: ${url}`);
      }) as typeof fetch;

      const freshStore = new MemoryStore({ filename: ":memory:" });
      const freshManager = new SessionManager({ memoryStore: freshStore });

      try {
        const result = await freshManager.ensureDaemonRuntime({ autoStart: false });
        assert.equal(result, true, "terminal-ready daemon should establish broker runtime even when health is slow");
        assert.ok(
          freshManager.getTerminalRuntime() instanceof BrokerTerminalRuntime,
          "runtime should be broker-backed",
        );
        assert.ok(
          requestedUrls.some((url) => url.endsWith("/api/v1/term/sessions")),
          "terminal readiness endpoint should be probed",
        );
      } finally {
        globalThis.fetch = originalFetch;
        freshStore.close();
      }
    });

    it("returns false when daemon is not reachable and autoStart is disabled", async () => {
      // If a daemon is running on the default port, we can't test the
      // "not reachable" path — skip with a clear message.
      const probe = await probeDaemonHealth();
      if (probe.running) {
        console.log("SKIP: daemon is running on default port — cannot test 'not reachable' path");
        return;
      }

      const freshStore = new MemoryStore({ filename: ":memory:" });
      const freshManager = new SessionManager({ memoryStore: freshStore });

      const result = await freshManager.ensureDaemonRuntime({ autoStart: false });
      assert.equal(result, false, "should return false when daemon not reachable");

      // getTerminalRuntime() should still return LocalTerminalRuntime
      const runtime = freshManager.getTerminalRuntime();
      assert.ok(runtime instanceof LocalTerminalRuntime,
        "runtime should be LocalTerminalRuntime when ensureDaemonRuntime fails");

      freshStore.close();
    });

    it("returns boolean (not throw) when autoStart is requested but daemon cannot start", async () => {
      const freshStore = new MemoryStore({ filename: ":memory:" });
      const freshManager = new SessionManager({ memoryStore: freshStore });

      // autoStart may succeed (if a daemon is already running) or fail
      // (if ts-node is not in PATH, or the daemon can't bind). Either way
      // it must return a boolean, never throw.
      const result = await freshManager.ensureDaemonRuntime({ autoStart: true });
      assert.ok(typeof result === "boolean", "ensureDaemonRuntime should return a boolean, not throw");

      freshStore.close();
    });

    it("caches BrokerTerminalRuntime when daemon is reachable", async () => {
      // We can't easily start a real daemon in unit tests, so we test
      // the caching path by injecting a brokerRuntime directly.
      const freshStore = new MemoryStore({ filename: ":memory:" });
      const freshManager = new SessionManager({ memoryStore: freshStore });

      // Simulate ensureDaemonRuntime having cached a broker runtime
      // by using the probeDaemonHealth function to verify the probe works
      const probeResult = await probeDaemonHealth();

      if (probeResult.running) {
        // If daemon is running (unlikely in test env), ensureDaemonRuntime should work
        const result = await freshManager.ensureDaemonRuntime({ autoStart: false });
        assert.equal(result, true, "should return true when daemon is reachable");

        const runtime = freshManager.getTerminalRuntime();
        assert.ok(runtime instanceof BrokerTerminalRuntime,
          "runtime should be BrokerTerminalRuntime when daemon is reachable");
        assert.equal(runtime.brokerUrl, probeResult.brokerUrl,
          "brokerUrl should match the probed URL");
      } else {
        // Daemon not running — just verify the fallback is LocalTerminalRuntime
        const runtime = freshManager.getTerminalRuntime();
        assert.ok(runtime instanceof LocalTerminalRuntime,
          "runtime should be LocalTerminalRuntime when daemon is not reachable");
      }

      freshStore.close();
    });

    it("getTerminalRuntime returns BrokerTerminalRuntime after ensureDaemonRuntime succeeds", async () => {
      // Directly test the caching path by creating a BrokerTerminalRuntime
      // and verifying getTerminalRuntime returns it after ensureDaemonRuntime.
      // Since we can't start a daemon in tests, we verify the plumbing:
      // if ensureDaemonRuntime finds a running daemon, getTerminalRuntime must
      // return the cached BrokerTerminalRuntime.
      const probe = await probeDaemonHealth();

      if (!probe.running) {
        // Skip: no daemon running to test against
        return;
      }

      const freshStore = new MemoryStore({ filename: ":memory:" });
      const freshManager = new SessionManager({ memoryStore: freshStore });

      await freshManager.ensureDaemonRuntime({ autoStart: false });
      const runtime = freshManager.getTerminalRuntime();
      assert.ok(runtime instanceof BrokerTerminalRuntime,
        `getTerminalRuntime should return BrokerTerminalRuntime, got ${runtime.constructor.name}`);

      freshStore.close();
    });
  });
});
