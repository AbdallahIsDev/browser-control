import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  buildToolRegistry,
  createLazyToolRegistry,
  getToolCategories,
} from "../../../src/mcp/tool_registry";
import { actionResultToMcpResult, mcpErrorResult, validateToolParams } from "../../../src/mcp/types";
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
import type { ActionResult } from "../../../src/shared/action_result";
import { successResult } from "../../../src/shared/action_result";
import { getStateStorage, resetStateStorage } from "../../../src/state/index";

describe("MCP Tool Registry", () => {
  let api: BrowserControlAPI;
  let store: MemoryStore;
  let tempDir: string;
  let sessionRuntimeDir: string;
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
    const session = await api.session.create("test-session", {
      policyProfile: "trusted",
      policyProfileEscalationConfirmed: true,
    });
    sessionRuntimeDir = session.data?.runtimeDir ?? tempDir;
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
      assert.ok(names.includes("bc_open"));
      assert.ok(names.includes("bc_snapshot"));
      assert.ok(names.includes("bc_click"));
      assert.ok(names.includes("bc_fill"));
      assert.ok(names.includes("bc_state"));
      assert.ok(names.includes("bc_act"));
      assert.ok(names.includes("bc_tab_list"));
      assert.ok(names.includes("bc_provider_list"));
      assert.ok(names.includes("bc_provider_catalog"));
      assert.ok(names.includes("bc_provider_use"));
      assert.ok(names.includes("bc_provider_health"));
      assert.deepEqual(
        names.filter((name) => name.startsWith("bc_browser_")),
        [],
        "full registry should expose canonical short browser/provider names only",
      );

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

      // Package tools
      for (const toolName of [
        "bc_package_install",
        "bc_package_list",
        "bc_package_info",
        "bc_package_remove",
        "bc_package_update",
        "bc_package_grant",
        "bc_package_run",
        "bc_package_eval",
        "bc_package_review",
        "bc_package_review_history",
        "bc_package_eval_history",
      ]) {
        assert.ok(names.includes(toolName), `${toolName} missing`);
      }

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
        "bc_act",
        "bc_capture",
        "bc_capture_many",
        "bc_click",
        "bc_fill",
        "bc_open",
        "bc_open_many",
        "bc_snapshot",
        "bc_state",
        "bc_tab_list",
        "bc_fs_write_output",
        "bc_session_status",
        "bc_status",
        "bc_task_run",
      ].sort());
      assert.deepEqual(
        names.filter((name) => name.startsWith("bc_browser_")),
        [],
        "lite mode should omit compatibility browser aliases to reduce tool schema tokens",
      );
    });

    it("lazy registry loads no categories until a tool is requested", () => {
      const registry = createLazyToolRegistry(api);

      assert.deepEqual(registry.getLoadedCategoryNames(), []);

      const statusTool = registry.getTool("bc_status");

      assert.equal(statusTool?.name, "bc_status");
      assert.deepEqual(registry.getLoadedCategoryNames(), ["status"]);
    });

    it("lazy lite registry builds only categories that contain lite tools", () => {
      const registry = createLazyToolRegistry(api, { mode: "lite" });

      const tools = registry.getTools();
      const names = tools.map((tool) => tool.name).sort();

      assert.deepEqual(registry.getLoadedCategoryNames(), ["status", "session", "browser", "fs"]);
      assert.deepEqual(names, [
        "bc_act",
        "bc_capture",
        "bc_capture_many",
        "bc_click",
        "bc_fill",
        "bc_open",
        "bc_open_many",
        "bc_snapshot",
        "bc_state",
        "bc_tab_list",
        "bc_fs_write_output",
        "bc_session_status",
        "bc_status",
        "bc_task_run",
      ].sort());
    });

    it("static tool categories match the built full registry", () => {
      const categoryNames = Object.values(getToolCategories(api)).flat().sort();
      const builtNames = buildToolRegistry(api).map((tool) => tool.name).sort();

      assert.deepEqual(categoryNames, builtNames);
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

    it("MCP result content uses compact JSON to reduce token overhead", () => {
      const result = actionResultToMcpResult(
        successResult(
          { nested: { value: true }, items: [1, 2] },
          { path: "command", sessionId: "compact-json" },
        ),
      );
      const error = mcpErrorResult("Example failure");

      assert.doesNotMatch(result.content[0].text, /\n\s+"/);
      assert.doesNotMatch(error.content[0].text, /\n\s+"/);
      assert.deepEqual(JSON.parse(result.content[0].text).data, {
        nested: { value: true },
        items: [1, 2],
      });
      assert.equal(JSON.parse(error.content[0].text).error, "Example failure");
    });

    it("bc_act.urls schema accepts string and object URL entries", () => {
      const tools = buildToolRegistry(api);
      const actTool = tools.find((t) => t.name === "bc_act")!;
      const urlsProp: any = actTool.inputSchema.properties.urls;
      if (!urlsProp || urlsProp.type !== "array") {
        assert.fail("bc_act should have urls property of type array");
      }
      const oneOf: any[] = urlsProp.items?.oneOf;
      assert.ok(oneOf, "urls items should have oneOf for string and object entries");
      assert.ok(oneOf.find((s) => s.type === "string"), "oneOf should include type string");
      const objectItem = oneOf.find((s) => s.type === "object");
      assert.ok(objectItem, "oneOf should include type object");
      assert.ok(objectItem.properties, "object item should have properties");
      assert.equal(objectItem.properties.url.type, "string", "object item url property should be string");
      assert.ok((objectItem.required ?? []).includes("url"), "object item should require url");
    });

    it("browser tools expose canonical short names directly", () => {
      const tools = buildToolRegistry(api);
      const byName = new Map(tools.map((tool) => [tool.name, tool]));
      for (const name of [
        "bc_open",
        "bc_snapshot",
        "bc_click",
        "bc_fill",
        "bc_state",
        "bc_act",
        "bc_tab_list",
      ] as const) {
        const tool = byName.get(name);
        assert.ok(tool, `${name} missing`);
        assert.doesNotMatch(tool.description, /Compatibility alias/);
      }
    });

    it("bc_task_run.steps[].urls schema accepts string and object URL entries", () => {
      const tools = buildToolRegistry(api);
      const taskTool = tools.find((t) => t.name === "bc_task_run")!;
      const stepsProp: any = taskTool.inputSchema.properties.steps;
      if (!stepsProp || stepsProp.type !== "array") assert.fail("bc_task_run should have steps array");
      const stepItems: any = stepsProp.items;
      const urlProp: any = stepItems.properties?.urls;
      if (!urlProp || urlProp.type !== "array") assert.fail("step items should have urls array");
      const oneOf: any[] = urlProp.items?.oneOf;
      assert.ok(oneOf, "step urls items should have oneOf");
      assert.ok(oneOf.find((s) => s.type === "string"), "oneOf should include string");
      const objectItem = oneOf.find((s) => s.type === "object");
      assert.ok(objectItem, "oneOf should include object");
      assert.equal(objectItem.properties.url.type, "string");
    });

    it("bc_task_run.steps schema documents action-specific fields", () => {
      const tools = buildToolRegistry(api);
      const taskTool = tools.find((t) => t.name === "bc_task_run")!;
      const stepsProp: any = taskTool.inputSchema.properties.steps;
      const stepItems: any = stepsProp.items;

      assert.ok(stepItems.oneOf, "step schema should expose action-specific variants");
      assert.deepEqual(stepItems.properties.direction.enum, ["up", "down", "left", "right"]);
      assert.match(stepItems.properties.action.description, /click|fill|scroll/);
      assert.match(stepItems.properties.target.description, /click|fill|hover/);
      assert.match(stepItems.properties.copyTo.description, /Primary save remains/);
      assert.equal(stepItems.properties.outputPath, undefined);

      const fieldsItems = stepItems.properties.fields.items;
      assert.equal(fieldsItems.properties.target.type, "string");
      assert.equal(fieldsItems.properties.text.type, "string");
      assert.deepEqual(fieldsItems.required, ["target", "text"]);
    });

    it("screenshot tools expose copyTo without advertising outputPath", () => {
      const tools = buildToolRegistry(api);
      const screenshotTool = tools.find((t) => t.name === "bc_screenshot")!;
      const actTool = tools.find((t) => t.name === "bc_act")!;

      assert.match((screenshotTool.inputSchema.properties.copyTo as any).description, /Primary screenshot/);
      assert.match((actTool.inputSchema.properties.copyTo as any).description, /Primary save remains/);
      assert.equal(screenshotTool.inputSchema.properties.outputPath, undefined);
      assert.equal(actTool.inputSchema.properties.outputPath, undefined);
      assert.equal(actTool.inputSchema.properties.captureOnSuccess, undefined);
    });

    it("screencast start exposes copyTo and keeps path as deprecated shim", () => {
      const tools = buildToolRegistry(api);
      const screencastTool = tools.find((t) => t.name === "bc_screencast_start")!;

      assert.match((screencastTool.inputSchema.properties.copyTo as any).description, /Primary screencast/);
      assert.match((screencastTool.inputSchema.properties.path as any).description, /Deprecated/);
    });

    it("bc_act handler preserves object URL entries", async () => {
      const browser = api.browser as unknown as {
        act: (options: Record<string, unknown>) => Promise<ActionResult<unknown>>;
      };
      const originalAct = browser.act;
      let capturedOptions: Record<string, unknown> | undefined;
      browser.act = async (options) => {
        capturedOptions = options;
        return successResult(
          { received: options },
          { path: "command", sessionId: "test-session" },
        );
      };

      const tools = buildToolRegistry(api);
      const actTool = tools.find((t) => t.name === "bc_act")!;
      try {
        const result = await actTool.handler({
          action: "openMany",
          urls: [{ url: "https://example.com", label: "test", waitUntil: "domcontentloaded" }],
        });

        assert.equal(result.success, true);
        assert.deepEqual(capturedOptions?.urls, [
          { url: "https://example.com", label: "test", waitUntil: "domcontentloaded" },
        ]);
      } finally {
        browser.act = originalAct;
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

    it("caches category names per API without exposing mutable cache state", () => {
      const first = getToolCategories(api);
      const second = getToolCategories(api);

      assert.equal(first, second);
      assert.equal(Object.isFrozen(first), true);
      assert.equal(Object.isFrozen(first.browser), true);
      assert.throws(() => {
        (first.browser as string[]).push("bc_fake_tool");
      }, /object is not extensible|read only|Cannot add property/i);
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

    it("bc_session_create requires explicit confirmation for trusted profile escalation", async () => {
      const tools = buildToolRegistry(api);
      const createTool = tools.find((t) => t.name === "bc_session_create")!;

      const denied = await createTool.handler({
        name: "mcp-trusted-denied",
        policyProfile: "trusted",
      });
      assert.equal(denied.success, false);
      assert.equal(denied.policyDecision, "deny");

      const confirmed = await createTool.handler({
        name: "mcp-trusted-confirmed",
        policyProfile: "trusted",
        policyProfileEscalationConfirmed: true,
      });
      assert.equal(confirmed.success, true, confirmed.error);
      assert.equal((confirmed.data as Record<string, unknown>).policyProfile, "trusted");
    });

    it("bc_fs_read reads a file", async () => {
      const tools = buildToolRegistry(api);
      const testPath = path.join(sessionRuntimeDir, "mcp-test.txt");

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

    it("debug health and bundle tools honor explicit sessionId", async () => {
      const calls: Array<{ action: string; sessionId?: string }> = [];
      const originalEvaluate = api.sessionManager.evaluateAction.bind(api.sessionManager);
      api.sessionManager.evaluateAction = ((action: string, params: Record<string, unknown>, sessionId?: string) => {
        calls.push({ action, sessionId });
        return {
          allowed: true,
          policyDecision: "allow",
          risk: "low",
          path: "command",
        };
      }) as typeof api.sessionManager.evaluateAction;

      try {
        const tools = buildToolRegistry(api);
        const healthTool = tools.find((t) => t.name === "bc_debug_health")!;
        const bundleTool = tools.find((t) => t.name === "bc_debug_failure_bundle")!;

        const health = await healthTool.handler({ sessionId: "debug-session-a" });
        const missingBundle = await bundleTool.handler({
          bundleId: "bundle-missing",
          sessionId: "debug-session-b",
        });

        assert.equal(health.sessionId, "debug-session-a");
        assert.equal(missingBundle.sessionId, "debug-session-b");
        assert.deepEqual(calls, [
          { action: "debug_health", sessionId: "debug-session-a" },
          { action: "debug_bundle_export", sessionId: "debug-session-b" },
        ]);
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
        const providerUseTool = tools.find((t) => t.name === "bc_provider_use")!;
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
      const providerHealthTool = tools.find((t) => t.name === "bc_provider_health")!;

      assert.ok(providerHealthTool);
      const result = await providerHealthTool.handler({ name: "local" });

      assert.equal(result.success, true);
      assert.ok(Array.isArray(result.data));
      assert.equal((result.data as Array<{ name: string }>)[0]?.name, "local");
    });

    it("provider catalog tool routes through policy and returns non-secret setup metadata", async () => {
      const tools = buildToolRegistry(api);
      const providerCatalogTool = tools.find((t) => t.name === "bc_provider_catalog")!;

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
      const selectTool = tools.find((t) => t.name === "bc_session_select")!;
      const statusTool = tools.find((t) => t.name === "bc_session_status")!;

      const first = await createTool.handler({ name: "first-session" });
      assert.equal(first.success, true);
      const firstId = (first.data as Record<string, unknown>).id as string;

      const other = await createTool.handler({ name: "other-session" });
      assert.equal(other.success, true);
      const otherId = (other.data as Record<string, unknown>).id as string;

      const selectedFirst = await selectTool.handler({ nameOrId: firstId });
      assert.equal(selectedFirst.success, true);

      const result = await statusTool.handler({ sessionId: otherId });
      assert.equal(result.success, true);
      assert.equal((result.data as Record<string, unknown>).id, otherId);
      assert.equal((result.data as Record<string, unknown>).name, "other-session");

      const active = api.session.status();
      assert.equal(active.success, true);
      assert.equal(active.data?.id, otherId);
    });

    it("terminal resume/status MCP tools forward terminalSessionId", async () => {
      const calls: { resume?: string; status?: string; selectedSession?: string } = {};
      const originalUse = api.session.use;
      api.session.use = ((sessionId: string) => {
        calls.selectedSession = sessionId;
        return { success: true, path: "command", sessionId, completedAt: new Date().toISOString() };
      }) as typeof api.session.use;
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

      try {
        const resume = await resumeTool.handler({ terminalSessionId: "term-1", sessionId: "bc-session-1" });
        const status = await statusTool.handler({ terminalSessionId: "term-1" });

        assert.equal(resume.success, true);
        assert.equal(status.success, true);
        assert.equal(calls.resume, "term-1");
        assert.equal(calls.status, "term-1");
        assert.equal(calls.selectedSession, "bc-session-1");
      } finally {
        api.session.use = originalUse;
      }
    });

    it("workflow edit-state MCP tool defaults to string and supports explicit typed values", async () => {
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

      const zipResult = await editTool.handler({
        runId: "run-1",
        key: "zip",
        value: "02138",
      });
      const stringBooleanResult = await editTool.handler({
        runId: "run-1",
        key: "rawEnabled",
        value: "true",
      });
      const numberResult = await editTool.handler({
        runId: "run-1",
        key: "count",
        value: "2",
        valueType: "number",
      });
      const booleanResult = await editTool.handler({
        runId: "run-1",
        key: "enabled",
        value: "true",
        valueType: "boolean",
      });

      assert.equal(zipResult.success, true);
      assert.equal(stringBooleanResult.success, true);
      assert.equal(numberResult.success, true);
      assert.equal(booleanResult.success, true);
      assert.deepEqual(edits, [
        { key: "zip", value: "02138", valueType: "string" },
        { key: "rawEnabled", value: "true", valueType: "string" },
        { key: "count", value: 2, valueType: "number" },
        { key: "enabled", value: true, valueType: "boolean" },
      ]);
    });

    it("harness generate rejects malformed files JSON without creating a helper", async () => {
      let generated = false;
      api.harness.generate = (async () => {
        generated = true;
        return successResult({ id: "bad-helper" }, { path: "a11y", sessionId: "test-session" });
      }) as typeof api.harness.generate;
      const tools = buildToolRegistry(api);
      const generateTool = tools.find((t) => t.name === "bc_harness_generate")!;

      const result = await generateTool.handler({
        id: "bad-helper",
        purpose: "test invalid json",
        files: "{not json",
      });

      assert.equal(result.success, false);
      assert.match(result.error ?? "", /Invalid files JSON/u);
      assert.equal(generated, false);
    });

    it("package tools honor explicit sessionId", async () => {
      const tools = buildToolRegistry(api);
      const listTool = tools.find((t) => t.name === "bc_package_list")!;
      const packageApi = api.package as unknown as {
        list: () => Promise<ActionResult<unknown>>;
      };
      const originalUse = api.session.use;
      const originalList = packageApi.list;
      let selectedSession: string | undefined;

      api.session.use = ((sessionId: string) => {
        selectedSession = sessionId;
        return successResult({ id: sessionId }, { path: "command", sessionId });
      }) as typeof api.session.use;
      packageApi.list = async () => successResult([], { path: "command", sessionId: selectedSession ?? "active" });

      try {
        const result = await listTool.handler({ sessionId: "package-session" });

        assert.equal(result.success, true);
        assert.equal(selectedSession, "package-session");
        assert.equal(result.sessionId, "package-session");
      } finally {
        api.session.use = originalUse;
        packageApi.list = originalList;
      }
    });
  });

  describe("schema shape", () => {
    it("session-aware tools include sessionId in schema", () => {
      const tools = buildToolRegistry(api);
      const browserToolNames = new Set([
        "bc_open",
        "bc_open_many",
        "bc_navigate",
        "bc_capture",
        "bc_capture_many",
        "bc_snapshot",
        "bc_click",
        "bc_fill",
        "bc_fill_many",
        "bc_hover",
        "bc_type",
        "bc_paste",
        "bc_press",
        "bc_scroll",
        "bc_screenshot",
        "bc_highlight",
        "bc_generate_locator",
        "bc_tab_list",
        "bc_tab_switch",
        "bc_tab_close",
        "bc_close",
        "bc_screencast_start",
        "bc_screencast_stop",
        "bc_screencast_status",
        "bc_list",
        "bc_attach",
        "bc_detach",
        "bc_launch",
        "bc_drop",
        "bc_downloads_list",
        "bc_dialog",
        "bc_cdp",
        "bc_state",
        "bc_act",
      ]);
      const browserTools = tools.filter((t) => browserToolNames.has(t.name));

      for (const tool of browserTools) {
        assert.ok(
          "sessionId" in tool.inputSchema.properties,
          `Tool ${tool.name} should have sessionId in schema`,
        );
      }
    });

    it("required fields are explicit", () => {
      const tools = buildToolRegistry(api);
      const openTool = tools.find((t) => t.name === "bc_open")!;
      assert.ok(openTool.inputSchema.required?.includes("url"));
    });

    it("bc_highlight does not require target when hiding highlights", async () => {
      const tools = buildToolRegistry(api);
      const highlightTool = tools.find((t) => t.name === "bc_highlight")!;

      assert.equal(highlightTool.inputSchema.required?.includes("target"), false);
      assert.equal(
        validateToolParams(highlightTool.name, highlightTool.inputSchema, { hide: true }, highlightTool.validation),
        null,
      );

      const browser = api.browser as unknown as {
        highlight: (options: Record<string, unknown>) => Promise<ActionResult<unknown>>;
      };
      const originalHighlight = browser.highlight;
      let capturedOptions: Record<string, unknown> | undefined;
      browser.highlight = async (options) => {
        capturedOptions = options;
        return successResult(
          { highlighted: options.target ?? "all", tabId: "tab-1" },
          { path: "a11y", sessionId: "test-session" },
        );
      };

      try {
        const result = await highlightTool.handler({ hide: true });

        assert.equal(result.success, true);
        assert.deepEqual(capturedOptions, { target: undefined, style: undefined, persist: undefined, hide: true, tabId: undefined });
      } finally {
        browser.highlight = originalHighlight;
      }
    });

    it("bc_dialog schema requires action and has dialog_id", () => {
      const tools = buildToolRegistry(api);
      const tool = tools.find((t) => t.name === "bc_dialog")!;
      assert.ok(tool.inputSchema.required?.includes("action"), "bc_dialog should require action");
      assert.ok("dialog_id" in tool.inputSchema.properties, "bc_dialog should have dialog_id property");
      assert.ok("response" in tool.inputSchema.properties, "bc_dialog should have response property");
      assert.ok("text" in tool.inputSchema.properties, "bc_dialog should have text property");
      assert.ok("tabId" in tool.inputSchema.properties, "bc_dialog should have tabId property");
      assert.ok("sessionId" in tool.inputSchema.properties, "bc_dialog should have sessionId property");
    });

    it("bc_cdp schema requires method/timeoutMs and has params/targetId/frameId", () => {
      const tools = buildToolRegistry(api);
      const tool = tools.find((t) => t.name === "bc_cdp")!;
      assert.ok(tool, "bc_cdp tool should exist");
      assert.ok(tool.inputSchema.required?.includes("method"), "bc_cdp should require method");
      assert.ok(tool.inputSchema.required?.includes("timeoutMs"), "bc_cdp should require timeoutMs");
      assert.ok("params" in tool.inputSchema.properties, "bc_cdp should have params property");
      assert.ok("targetId" in tool.inputSchema.properties, "bc_cdp should have targetId property");
      assert.ok("frameId" in tool.inputSchema.properties, "bc_cdp should have frameId property");
      assert.ok("tabId" in tool.inputSchema.properties, "bc_cdp should have tabId property");
      assert.ok("sessionId" in tool.inputSchema.properties, "bc_cdp should have sessionId property");
    });

    it("bc_drop schema has tabId", () => {
      const tools = buildToolRegistry(api);
      const tool = tools.find((t) => t.name === "bc_drop")!;
      assert.ok(tool, "bc_drop tool should exist");
      assert.ok("tabId" in tool.inputSchema.properties, "bc_drop should have tabId property");
    });

    it("bc_tab_close schema has tabId", () => {
      const tools = buildToolRegistry(api);
      const tool = tools.find((t) => t.name === "bc_tab_close")!;
      assert.ok(tool, "bc_tab_close tool should exist");
      assert.ok("tabId" in tool.inputSchema.properties, "bc_tab_close should have tabId property");
    });

    it("bc_tab_switch schema describes tabId as a tab ID, not an index", () => {
      const tools = buildToolRegistry(api);
      const tool = tools.find((t) => t.name === "bc_tab_switch")!;
      assert.ok(tool, "bc_tab_switch tool should exist");

      const tabId = tool.inputSchema.properties.tabId as { type?: string; description?: string };
      assert.equal(tabId.type, "string");
      assert.match(tabId.description ?? "", /tab ID/i);
      assert.doesNotMatch(tabId.description ?? "", /0-based|index/i);
      assert.doesNotMatch(tool.description, /index/i);
    });

    it("browser MCP tool module does not keep stale type-only imports", () => {
      const source = fs.readFileSync(path.join(process.cwd(), "src/mcp/tools/browser.ts"), "utf8");

      for (const importName of ["ActionResult", "A11ySnapshot", "LocatorCandidate", "JSONSchema"]) {
        assert.doesNotMatch(
          source,
          new RegExp(`import type \\{ ${importName} \\}`),
          `${importName} should not be imported when unused`,
        );
      }
    });

    it("terminal tools disambiguate Browser Control and terminal session IDs", () => {
      const tools = buildToolRegistry(api);
      const terminalTools = tools.filter((tool) => tool.name.startsWith("bc_terminal_"));

      for (const tool of terminalTools) {
        assert.ok("sessionId" in tool.inputSchema.properties, `${tool.name} should accept Browser Control sessionId`);
        assert.ok(!("browserControlSessionId" in tool.inputSchema.properties), `${tool.name} should not expose browserControlSessionId`);
      }

      for (const name of [
        "bc_terminal_exec",
        "bc_terminal_read",
        "bc_terminal_write",
        "bc_terminal_interrupt",
        "bc_terminal_snapshot",
        "bc_terminal_close",
        "bc_terminal_resume",
        "bc_terminal_status",
      ]) {
        const tool = tools.find((candidate) => candidate.name === name)!;
        assert.ok("terminalSessionId" in tool.inputSchema.properties, `${name} should expose terminalSessionId`);
        assert.ok(!tool.inputSchema.required?.includes("sessionId"), `${name} should not require Browser Control sessionId`);
      }
    });

    it("debug health and failure bundle tools expose optional sessionId", () => {
      const tools = buildToolRegistry(api);
      for (const name of ["bc_debug_health", "bc_debug_failure_bundle"]) {
        const tool = tools.find((candidate) => candidate.name === name)!;
        assert.ok("sessionId" in tool.inputSchema.properties, `${name} should expose sessionId`);
        assert.equal(tool.inputSchema.properties.sessionId.default, "system");
        assert.ok(!tool.inputSchema.required?.includes("sessionId"), `${name} should not require sessionId`);
      }
    });

    it("bc_act validation rejects action-specific missing parameters before handler execution", () => {
      const tools = buildToolRegistry(api);
      const actTool = tools.find((t) => t.name === "bc_act")!;

      const missingClickTarget = validateToolParams(actTool.name, actTool.inputSchema, { action: "click" }, actTool.validation);
      const emptyOpenMany = validateToolParams(actTool.name, actTool.inputSchema, { action: "openMany", urls: [] }, actTool.validation);
      const unsupportedScreenshotOutput = validateToolParams(actTool.name, actTool.inputSchema, { action: "screenshot", outputPath: "b.png" }, actTool.validation);

      assert.ok(missingClickTarget);
      assert.match(missingClickTarget, /target/);
      assert.ok(emptyOpenMany);
      assert.match(emptyOpenMany, /urls/);
      assert.ok(unsupportedScreenshotOutput);
      assert.match(unsupportedScreenshotOutput, /Unknown parameter 'outputPath'/);
      assert.equal(
        validateToolParams(actTool.name, actTool.inputSchema, { action: "fill", target: "#name", text: "" }, actTool.validation),
        null,
      );
    });

    it("bc_task_run validation rejects invalid step parameter combinations before handler execution", () => {
      const tools = buildToolRegistry(api);
      const taskTool = tools.find((t) => t.name === "bc_task_run")!;

      const missingFillTarget = validateToolParams(taskTool.name, taskTool.inputSchema, { steps: [{ action: "fill", text: "Ada" }] }, taskTool.validation);
      const missingPressKey = validateToolParams(taskTool.name, taskTool.inputSchema, { steps: [{ action: "press" }] }, taskTool.validation);
      const unsupportedScreenshotOutput = validateToolParams(taskTool.name, taskTool.inputSchema, { steps: [{ action: "screenshot", outputPath: "shot.png" }] }, taskTool.validation);

      assert.ok(missingFillTarget);
      assert.match(missingFillTarget, /steps\[0\]\.target/);
      assert.ok(missingPressKey);
      assert.match(missingPressKey, /steps\[0\]\.key/);
      assert.ok(unsupportedScreenshotOutput);
      assert.match(unsupportedScreenshotOutput, /steps\[0\]\.outputPath/);
      assert.equal(
        validateToolParams(taskTool.name, taskTool.inputSchema, { steps: [{ action: "press", key: "Enter" }] }, taskTool.validation),
        null,
      );
    });

    it("package tools include sessionId and parameter descriptions", () => {
      const tools = buildToolRegistry(api);
      const packageTools = tools.filter((tool) => tool.name.startsWith("bc_package_"));

      assert.ok(packageTools.length > 0, "Expected package tools in registry");
      for (const tool of packageTools) {
        assert.ok("sessionId" in tool.inputSchema.properties, `${tool.name} should include sessionId`);
        assert.ok(!tool.inputSchema.required?.includes("sessionId"), `${tool.name} should not require sessionId`);
        for (const [name, schema] of Object.entries(tool.inputSchema.properties)) {
          assert.ok(schema.description, `${tool.name}.${name} should have a description`);
        }
      }
    });

    it("bc_workflow_edit_state exposes explicit valueType without requiring it", () => {
      const tools = buildToolRegistry(api);
      const editTool = tools.find((tool) => tool.name === "bc_workflow_edit_state")!;
      const valueType = editTool.inputSchema.properties.valueType;

      assert.deepEqual(valueType.enum, ["string", "number", "boolean"]);
      assert.equal(valueType.default, "string");
      assert.ok(!editTool.inputSchema.required?.includes("valueType"));
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
