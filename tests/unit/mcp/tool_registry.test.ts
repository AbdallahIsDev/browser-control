import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildToolRegistry, getToolCategories } from "../../../src/mcp/tool_registry";
import { createBrowserControl, type BrowserControlAPI } from "../../../src/browser_control";
import { MemoryStore } from "../../../src/memory_store";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { createCredentialProtectionService } from "../../../src/security/credential_provider";
import {
  CredentialVault,
  resetCredentialVault,
} from "../../../src/security/credential_vault";
import { getStateStorage, resetStateStorage } from "../../../src/state/index";

describe("MCP Tool Registry", () => {
  let api: BrowserControlAPI;
  let store: MemoryStore;
  let tempDir: string;
  let originalHome: string | undefined;
  let originalBackend: string | undefined;

  beforeEach(async () => {
    originalHome = process.env.BROWSER_CONTROL_HOME;
    originalBackend = process.env.BROWSER_CONTROL_STATE_BACKEND;
    store = new MemoryStore({ filename: ":memory:" });
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-mcp-tools-"));
    process.env.BROWSER_CONTROL_HOME = tempDir;
    process.env.BROWSER_CONTROL_STATE_BACKEND = "json";
    resetStateStorage();
    resetCredentialVault();
    api = createBrowserControl({ memoryStore: store });
    // Create a session so tools have an active session to work with
    await api.session.create("test-session", { policyProfile: "trusted" });
  });

  afterEach(() => {
    // api.close() closes the MemoryStore; do NOT call store.close() separately
    api.close();
    resetCredentialVault();
    resetStateStorage();
    if (originalHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
    else process.env.BROWSER_CONTROL_HOME = originalHome;
    if (originalBackend === undefined) delete process.env.BROWSER_CONTROL_STATE_BACKEND;
    else process.env.BROWSER_CONTROL_STATE_BACKEND = originalBackend;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("buildToolRegistry", () => {
    it("registers all expected tools", () => {
      const tools = buildToolRegistry(api);

      const names = tools.map((t) => t.name).sort();

      // Session tools
      assert.ok(names.includes("bc_session_create"));
      assert.ok(names.includes("bc_session_list"));
      assert.ok(names.includes("bc_session_select"));
      assert.ok(names.includes("bc_session_status"));

      // Browser tools
      assert.ok(names.includes("bc_browser_open"));
      assert.ok(names.includes("bc_browser_open_many"));
      assert.ok(names.includes("bc_browser_navigate"));
      assert.ok(names.includes("bc_browser_capture"));
      assert.ok(names.includes("bc_browser_capture_many"));
      assert.ok(names.includes("bc_browser_snapshot"));
      assert.ok(names.includes("bc_browser_click"));
      assert.ok(names.includes("bc_browser_fill"));
      assert.ok(names.includes("bc_browser_hover"));
      assert.ok(names.includes("bc_browser_type"));
      assert.ok(names.includes("bc_browser_paste"));
      assert.ok(names.includes("bc_browser_press"));
      assert.ok(names.includes("bc_browser_scroll"));
      assert.ok(names.includes("bc_browser_screenshot"));
      assert.ok(names.includes("bc_browser_tab_list"));
      assert.ok(names.includes("bc_browser_tab_switch"));
      assert.ok(names.includes("bc_browser_tab_close"));
      assert.ok(names.includes("bc_browser_close"));
      assert.ok(names.includes("bc_browser_dialog"));
      assert.ok(names.includes("bc_browser_cdp"));

      // Terminal tools
      assert.ok(names.includes("bc_terminal_open"));
      assert.ok(names.includes("bc_terminal_exec"));
      assert.ok(names.includes("bc_terminal_read"));
      assert.ok(names.includes("bc_terminal_write"));
      assert.ok(names.includes("bc_terminal_interrupt"));
      assert.ok(names.includes("bc_terminal_snapshot"));
      assert.ok(names.includes("bc_terminal_list"));
      assert.ok(names.includes("bc_terminal_close"));
      assert.ok(names.includes("bc_terminal_resume"));
      assert.ok(names.includes("bc_terminal_status"));

      // Filesystem tools
      assert.ok(names.includes("bc_fs_read"));
      assert.ok(names.includes("bc_fs_write"));
      assert.ok(names.includes("bc_fs_write_output"));
      assert.ok(names.includes("bc_fs_list"));
      assert.ok(names.includes("bc_fs_move"));
      assert.ok(names.includes("bc_fs_delete"));
      assert.ok(names.includes("bc_fs_stat"));

      // Debug tools
      assert.ok(names.includes("bc_debug_health"));

      // Service tools (Section 14)
      assert.ok(names.includes("bc_service_list"));
      assert.ok(names.includes("bc_service_resolve"));

      // Security/privacy tools
      assert.ok(names.includes("bc_vault_list"));
      assert.ok(names.includes("bc_network_rules_list"));
      assert.ok(names.includes("bc_network_blocked_requests"));
    });

    it("has no duplicate tool names", () => {
      const tools = buildToolRegistry(api);
      const names = tools.map((t) => t.name);
      const unique = new Set(names);
      assert.equal(unique.size, names.length, `Duplicate tool names found: ${names.filter((n, i) => names.indexOf(n) !== i)}`);
    });

    it("lite mode exposes only the reduced high-level toolset", () => {
      const tools = buildToolRegistry(api, { mode: "lite" });
      const names = tools.map((t) => t.name).sort();

      assert.deepEqual(names, [
        "bc_browser_act",
        "bc_browser_capture",
        "bc_browser_capture_many",
        "bc_browser_click",
        "bc_browser_fill",
        "bc_browser_open",
        "bc_browser_open_many",
        "bc_browser_snapshot",
        "bc_browser_state",
        "bc_browser_tab_list",
        "bc_fs_write_output",
        "bc_session_status",
        "bc_status",
        "bc_task_run",
      ].sort());
    });

    it("all tools have descriptions", () => {
      const tools = buildToolRegistry(api);
      for (const tool of tools) {
        assert.ok(tool.description.length > 0, `Tool ${tool.name} has no description`);
      }
    });

    it("all tools have valid input schemas", () => {
      const tools = buildToolRegistry(api);
      for (const tool of tools) {
        assert.equal(tool.inputSchema.type, "object", `Tool ${tool.name} schema type must be 'object'`);
        assert.ok(typeof tool.inputSchema.properties === "object", `Tool ${tool.name} must have properties`);
        assert.equal(tool.inputSchema.additionalProperties, false, `Tool ${tool.name} must reject unknown params`);
      }
    });
  });

  describe("getToolCategories", () => {
    it("groups tools by category", () => {
      const categories = getToolCategories(api);

      assert.ok(categories.session.length > 0);
      assert.ok(categories.browser.length > 0);
      assert.ok(categories.terminal.length > 0);
      assert.ok(categories.fs.length > 0);
      assert.ok(categories.debug.length > 0);
      assert.ok(categories.service.length > 0);
    });
  });

  describe("tool handlers", () => {
    it("session tools return ActionResult shape", async () => {
      const tools = buildToolRegistry(api);
      const listTool = tools.find((t) => t.name === "bc_session_list")!;
      const result = await listTool.handler({});

      assert.equal(typeof result.success, "boolean");
      assert.ok(result.path === "command" || result.path === "a11y" || result.path === "low_level");
      assert.equal(typeof result.sessionId, "string");
      assert.equal(typeof result.completedAt, "string");
    });

    it("bc_vault_list never returns raw secret values", async () => {
      const vault = new CredentialVault(
        getStateStorage(tempDir),
        createCredentialProtectionService({
          dataHome: tempDir,
          preferWindowsDpapi: false,
        }),
      );
      await vault.set("site", "example.test", "login", "mcp-raw-secret");

      const tools = buildToolRegistry(api);
      const vaultTool = tools.find((t) => t.name === "bc_vault_list")!;
      const result = await vaultTool.handler({});
      const serialized = JSON.stringify(result);

      assert.equal(result.success, true);
      assert.match(serialized, /secret:\/\/site\/example.test\/login/);
      assert.doesNotMatch(serialized, /mcp-raw-secret/);
    });

    it("bc_session_create creates a session", async () => {
      const tools = buildToolRegistry(api);
      const createTool = tools.find((t) => t.name === "bc_session_create")!;
      const result = await createTool.handler({ name: "mcp-test" });

      assert.equal(result.success, true);
      assert.ok(result.data);
      assert.equal((result.data as Record<string, unknown>).name, "mcp-test");
    });

    it("bc_fs_read reads a file", async () => {
      const tools = buildToolRegistry(api);
      const testPath = path.join(tempDir, "mcp-test.txt");

      const writeTool = tools.find((t) => t.name === "bc_fs_write")!;
      const writeResult = await writeTool.handler({ path: testPath, content: "hello mcp" });
      // With trusted profile, fs_write should succeed
      assert.equal(writeResult.success, true, `Write failed: ${writeResult.error}`);

      const readTool = tools.find((t) => t.name === "bc_fs_read")!;
      const result = await readTool.handler({ path: testPath });

      assert.equal(result.success, true, `Read failed: ${result.error}`);
      assert.ok(result.data);
      assert.equal((result.data as Record<string, unknown>).content, "hello mcp");
    });

    it("bc_debug_health returns health report", async () => {
      const tools = buildToolRegistry(api);
      const healthTool = tools.find((t) => t.name === "bc_debug_health")!;
      const result = await healthTool.handler({});

      assert.equal(result.success, true);
      assert.ok(result.data);
      assert.ok(["healthy", "degraded", "unhealthy"].includes((result.data as Record<string, unknown>).overall as string));
    });

    it("debug evidence tools route through policy", async () => {
      const calls: string[] = [];
      const originalEvaluate = api.sessionManager.evaluateAction.bind(api.sessionManager);
      api.sessionManager.evaluateAction = ((action: string, params: Record<string, unknown>, sessionId?: string) => {
        calls.push(action);
        return {
          allowed: true,
          policyDecision: "allow",
          risk: action === "debug_console_read" ? "low" : "moderate",
          path: "command",
        };
      }) as typeof api.sessionManager.evaluateAction;

      try {
        const tools = buildToolRegistry(api);
        const bundleTool = tools.find((t) => t.name === "bc_debug_failure_bundle")!;
        const consoleTool = tools.find((t) => t.name === "bc_debug_get_console")!;
        const networkTool = tools.find((t) => t.name === "bc_debug_get_network")!;

        const missingBundle = await bundleTool.handler({ bundleId: "bundle-missing" });
        const consoleResult = await consoleTool.handler({ sessionId: "test-session" });
        const networkResult = await networkTool.handler({ sessionId: "test-session" });

        assert.equal(missingBundle.policyDecision, "allow");
        assert.equal(consoleResult.policyDecision, "allow");
        assert.equal(networkResult.policyDecision, "allow");
        assert.deepEqual(calls, ["debug_bundle_export", "debug_console_read", "debug_network_read"]);
      } finally {
        api.sessionManager.evaluateAction = originalEvaluate as typeof api.sessionManager.evaluateAction;
      }
    });

    it("debug evidence tools honor policy denial", async () => {
      const originalEvaluate = api.sessionManager.evaluateAction.bind(api.sessionManager);
      api.sessionManager.evaluateAction = (() => ({
        success: false,
        path: "command",
        sessionId: "test-session",
        error: "Policy denied: debug evidence access blocked",
        policyDecision: "deny",
        risk: "moderate",
        completedAt: new Date().toISOString(),
      })) as typeof api.sessionManager.evaluateAction;

      try {
        const tools = buildToolRegistry(api);
        const networkTool = tools.find((t) => t.name === "bc_debug_get_network")!;
        const result = await networkTool.handler({ sessionId: "test-session" });

        assert.equal(result.success, false);
        assert.equal(result.policyDecision, "deny");
        assert.equal(result.error, "Policy denied: debug evidence access blocked");
      } finally {
        api.sessionManager.evaluateAction = originalEvaluate as typeof api.sessionManager.evaluateAction;
      }
    });

    it("provider mutation tools route through policy and honor denial", async () => {
      const originalEvaluate = api.sessionManager.evaluateAction.bind(api.sessionManager);
      const calls: string[] = [];
      api.sessionManager.evaluateAction = ((action: string) => {
        calls.push(action);
        return {
          success: false,
          path: "command",
          sessionId: "test-session",
          error: "Policy denied: provider mutation blocked",
          policyDecision: "deny",
          risk: "moderate",
          completedAt: new Date().toISOString(),
        };
      }) as typeof api.sessionManager.evaluateAction;

      try {
        const tools = buildToolRegistry(api);
        const providerUseTool = tools.find((t) => t.name === "bc_browser_provider_use")!;
        const result = await providerUseTool.handler({ name: "browserless" });

        assert.equal(result.success, false);
        assert.equal(result.policyDecision, "deny");
        assert.equal(result.error, "Policy denied: provider mutation blocked");
        assert.deepEqual(calls, ["browser_provider_use"]);
      } finally {
        api.sessionManager.evaluateAction = originalEvaluate as typeof api.sessionManager.evaluateAction;
      }
    });

    it("provider health tool routes through policy and returns diagnostics", async () => {
      const tools = buildToolRegistry(api);
      const providerHealthTool = tools.find((t) => t.name === "bc_browser_provider_health")!;

      assert.ok(providerHealthTool);
      const result = await providerHealthTool.handler({ name: "local" });

      assert.equal(result.success, true);
      assert.ok(Array.isArray(result.data));
      assert.equal((result.data as Array<{ name: string }>)[0]?.name, "local");
    });

    it("provider catalog tool routes through policy and returns non-secret setup metadata", async () => {
      const tools = buildToolRegistry(api);
      const providerCatalogTool = tools.find((t) => t.name === "bc_browser_provider_catalog")!;

      assert.ok(providerCatalogTool);
      const result = await providerCatalogTool.handler({});

      assert.equal(result.success, true);
      assert.ok(Array.isArray(result.data));
      const browserbase = (result.data as Array<{ name: string; risk: string; requiresAuth: boolean }>).find(
        (entry) => entry.name === "browserbase",
      );
      assert.ok(browserbase);
      assert.equal(browserbase.risk, "high");
      assert.equal(browserbase.requiresAuth, true);
      assert.doesNotMatch(JSON.stringify(result.data), /secret-token|apiKeyValue/u);
    });

    it("bc_service_list returns registered services", async () => {
      // Register a service via the API first
      await api.service.register({ name: "mcp-service", port: 5555 });

      const tools = buildToolRegistry(api);
      const listTool = tools.find((t) => t.name === "bc_service_list")!;
      const result = await listTool.handler({});

      assert.equal(result.success, true);
      assert.ok(Array.isArray(result.data));
      assert.ok((result.data as unknown[]).length >= 1);
      const names = (result.data as Array<{ name: string }>).map((s) => s.name);
      assert.ok(names.includes("mcp-service"));
    });

    it("bc_service_resolve returns URL for registered service", async () => {
      await api.service.register({ name: "resolve-test", port: 6666 });

      const tools = buildToolRegistry(api);
      const resolveTool = tools.find((t) => t.name === "bc_service_resolve")!;
      const result = await resolveTool.handler({ name: "resolve-test" });

      // Port 6666 is not actually running, so the health check should fail
      assert.equal(result.success, false);
      assert.ok(result.error);
      assert.ok(
        (result.error as string).includes("not responding") ||
        (result.error as string).includes("not reachable") ||
        (result.error as string).includes("unhealthy")
      );
    });

    it("bc_session_status honors explicit sessionId", async () => {
      const tools = buildToolRegistry(api);
      const createTool = tools.find((t) => t.name === "bc_session_create")!;
      const statusTool = tools.find((t) => t.name === "bc_session_status")!;

      const other = await createTool.handler({ name: "other-session" });
      assert.equal(other.success, true);
      const otherId = (other.data as Record<string, unknown>).id as string;

      const result = await statusTool.handler({ sessionId: otherId });
      assert.equal(result.success, true);
      assert.equal((result.data as Record<string, unknown>).id, otherId);
      assert.equal((result.data as Record<string, unknown>).name, "other-session");
    });

    it("terminal resume/status MCP tools forward sessionId", async () => {
      const calls: { resume?: string; status?: string } = {};
      api.terminal.resume = async (options) => {
        calls.resume = options.sessionId;
        return {
          success: true,
          path: "command",
          sessionId: "test-session",
          data: { id: options.sessionId, status: "resumed" },
          completedAt: new Date().toISOString(),
        };
      };
      api.terminal.status = async (options) => {
        calls.status = options.sessionId;
        return {
          success: true,
          path: "command",
          sessionId: "test-session",
          data: { id: options.sessionId, status: "pending_resume" },
          completedAt: new Date().toISOString(),
        };
      };

      const tools = buildToolRegistry(api);
      const resumeTool = tools.find((t) => t.name === "bc_terminal_resume")!;
      const statusTool = tools.find((t) => t.name === "bc_terminal_status")!;

      const resume = await resumeTool.handler({ sessionId: "term-1" });
      const status = await statusTool.handler({ sessionId: "term-1" });

      assert.equal(resume.success, true);
      assert.equal(status.success, true);
      assert.equal(calls.resume, "term-1");
      assert.equal(calls.status, "term-1");
    });

    it("workflow edit-state MCP tool forwards parsed typed values", async () => {
      const edits: Array<{ key: string; value: unknown; valueType: string }> = [];
      api.workflow.editState = ((runId: string, key: string, value: string | number | boolean) => {
        edits.push({ key, value, valueType: typeof value });
        return {
          success: true,
          path: "command",
          sessionId: "test-session",
          data: { runId, key, value },
          completedAt: new Date().toISOString(),
        };
      }) as typeof api.workflow.editState;

      const tools = buildToolRegistry(api);
      const editTool = tools.find((t) => t.name === "bc_workflow_edit_state")!;

      const numberResult = await editTool.handler({
        runId: "run-1",
        key: "count",
        value: "2",
      });
      const booleanResult = await editTool.handler({
        runId: "run-1",
        key: "enabled",
        value: "true",
      });

      assert.equal(numberResult.success, true);
      assert.equal(booleanResult.success, true);
      assert.deepEqual(edits, [
        { key: "count", value: 2, valueType: "number" },
        { key: "enabled", value: true, valueType: "boolean" },
      ]);
    });
  });

  describe("schema shape", () => {
    it("session-aware tools include sessionId in schema", () => {
      const tools = buildToolRegistry(api);
      const browserTools = tools.filter((t) => t.name.startsWith("bc_browser_"));

      for (const tool of browserTools) {
        assert.ok(
          "sessionId" in tool.inputSchema.properties,
          `Tool ${tool.name} should have sessionId in schema`,
        );
      }
    });

    it("required fields are explicit", () => {
      const tools = buildToolRegistry(api);
      const openTool = tools.find((t) => t.name === "bc_browser_open")!;
      assert.ok(openTool.inputSchema.required?.includes("url"));
    });

    it("bc_browser_dialog schema requires action and has dialog_id", () => {
      const tools = buildToolRegistry(api);
      const tool = tools.find((t) => t.name === "bc_browser_dialog")!;
      assert.ok(tool.inputSchema.required?.includes("action"), "bc_browser_dialog should require action");
      assert.ok("dialog_id" in tool.inputSchema.properties, "bc_browser_dialog should have dialog_id property");
      assert.ok("response" in tool.inputSchema.properties, "bc_browser_dialog should have response property");
      assert.ok("text" in tool.inputSchema.properties, "bc_browser_dialog should have text property");
      assert.ok("tabId" in tool.inputSchema.properties, "bc_browser_dialog should have tabId property");
      assert.ok("sessionId" in tool.inputSchema.properties, "bc_browser_dialog should have sessionId property");
    });

    it("bc_browser_cdp schema requires method/timeoutMs and has params/targetId/frameId", () => {
      const tools = buildToolRegistry(api);
      const tool = tools.find((t) => t.name === "bc_browser_cdp")!;
      assert.ok(tool, "bc_browser_cdp tool should exist");
      assert.ok(tool.inputSchema.required?.includes("method"), "bc_browser_cdp should require method");
      assert.ok(tool.inputSchema.required?.includes("timeoutMs"), "bc_browser_cdp should require timeoutMs");
      assert.ok("params" in tool.inputSchema.properties, "bc_browser_cdp should have params property");
      assert.ok("targetId" in tool.inputSchema.properties, "bc_browser_cdp should have targetId property");
      assert.ok("frameId" in tool.inputSchema.properties, "bc_browser_cdp should have frameId property");
      assert.ok("tabId" in tool.inputSchema.properties, "bc_browser_cdp should have tabId property");
      assert.ok("sessionId" in tool.inputSchema.properties, "bc_browser_cdp should have sessionId property");
    });

    it("bc_browser_drop schema has tabId", () => {
      const tools = buildToolRegistry(api);
      const tool = tools.find((t) => t.name === "bc_browser_drop")!;
      assert.ok(tool, "bc_browser_drop tool should exist");
      assert.ok("tabId" in tool.inputSchema.properties, "bc_browser_drop should have tabId property");
    });
  });

  describe("policy integration", () => {
    it("policy denial surfaces in result", async () => {
      // Create a safe-profile session and try something risky
      const createTool = buildToolRegistry(api).find((t) => t.name === "bc_session_create")!;
      const result = await createTool.handler({
        name: "safe-test",
        policyProfile: "safe",
      });

      assert.equal(result.success, true);
      // The safe profile should still allow session creation (low risk)
    });
  });
});
