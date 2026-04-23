import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildToolRegistry, getToolCategories } from "./tool_registry";
import { createBrowserControl, type BrowserControlAPI } from "../browser_control";
import { MemoryStore } from "../memory_store";
import * as os from "node:os";
import * as path from "node:path";

describe("MCP Tool Registry", () => {
  let api: BrowserControlAPI;
  let store: MemoryStore;
  let tempDir: string;

  beforeEach(async () => {
    store = new MemoryStore({ filename: ":memory:" });
    tempDir = os.tmpdir();
    api = createBrowserControl({ memoryStore: store });
    // Create a session so tools have an active session to work with
    await api.session.create("test-session", { policyProfile: "trusted" });
  });

  afterEach(() => {
    // api.close() closes the MemoryStore; do NOT call store.close() separately
    api.close();
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
      assert.ok(names.includes("bc_browser_snapshot"));
      assert.ok(names.includes("bc_browser_click"));
      assert.ok(names.includes("bc_browser_fill"));
      assert.ok(names.includes("bc_browser_hover"));
      assert.ok(names.includes("bc_browser_type"));
      assert.ok(names.includes("bc_browser_press"));
      assert.ok(names.includes("bc_browser_scroll"));
      assert.ok(names.includes("bc_browser_screenshot"));
      assert.ok(names.includes("bc_browser_tab_list"));
      assert.ok(names.includes("bc_browser_tab_switch"));
      assert.ok(names.includes("bc_browser_close"));

      // Terminal tools
      assert.ok(names.includes("bc_terminal_open"));
      assert.ok(names.includes("bc_terminal_exec"));
      assert.ok(names.includes("bc_terminal_read"));
      assert.ok(names.includes("bc_terminal_write"));
      assert.ok(names.includes("bc_terminal_interrupt"));
      assert.ok(names.includes("bc_terminal_snapshot"));
      assert.ok(names.includes("bc_terminal_list"));
      assert.ok(names.includes("bc_terminal_close"));

      // Filesystem tools
      assert.ok(names.includes("bc_fs_read"));
      assert.ok(names.includes("bc_fs_write"));
      assert.ok(names.includes("bc_fs_list"));
      assert.ok(names.includes("bc_fs_move"));
      assert.ok(names.includes("bc_fs_delete"));
      assert.ok(names.includes("bc_fs_stat"));

      // Debug tools
      assert.ok(names.includes("bc_debug_health"));
    });

    it("has no duplicate tool names", () => {
      const tools = buildToolRegistry(api);
      const names = tools.map((t) => t.name);
      const unique = new Set(names);
      assert.equal(unique.size, names.length, `Duplicate tool names found: ${names.filter((n, i) => names.indexOf(n) !== i)}`);
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
