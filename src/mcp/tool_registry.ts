/**
 * MCP Tool Registry — Aggregates all Browser Control MCP tools.
 */

import type { BrowserControlAPI } from "../browser_control";
import type { McpTool } from "./types";
import { DefaultPolicyEngine } from "../policy/engine";
import { defaultRouter } from "../policy/execution_router";
import { buildBrowserTools } from "./tools/browser";
import { buildTerminalTools } from "./tools/terminal";
import { buildFsTools } from "./tools/fs";
import { buildSessionTools } from "./tools/session";
import { buildDebugTools } from "./tools/debug";
import { buildServiceTools } from "./tools/service";
import { buildProviderTools } from "./tools/provider";
import { buildStatusTools } from "./tools/status";
import { buildWorkflowTools } from "./tools/workflow";
import { buildPackageTools } from "./tools/package";
import { buildSecurityTools } from "./tools/security";

/**
 * Build the complete MCP tool registry for a Browser Control instance.
 *
 * Returns a flat array of all tools, ready for registration with the MCP server.
 */
export interface ToolRegistryOptions {
  mode?: "full" | "lite";
}

const LITE_TOOL_NAMES = new Set([
  "bc_open",
  "bc_open_many",
  "bc_capture",
  "bc_capture_many",
  "bc_snapshot",
  "bc_click",
  "bc_fill",
  "bc_state",
  "bc_act",
  "bc_tab_list",
  "bc_task_run",
  "bc_fs_write_output",
  "bc_session_status",
  "bc_status",
]);

interface ToolPolicyProbe {
  action: string;
  params?: Record<string, unknown>;
}

const TOOL_POLICY_PROBES: Record<string, ToolPolicyProbe> = {
  bc_status: { action: "daemon_status" },
  bc_open: { action: "browser_navigate", params: { url: "https://example.test" } },
  bc_open_many: { action: "browser_open_many" },
  bc_navigate: { action: "browser_navigate", params: { url: "https://example.test" } },
  bc_capture: { action: "browser_capture" },
  bc_capture_many: { action: "browser_capture_many" },
  bc_snapshot: { action: "browser_snapshot" },
  bc_click: { action: "browser_click" },
  bc_fill: { action: "browser_fill" },
  bc_fill_many: { action: "browser_fill" },
  bc_hover: { action: "browser_hover" },
  bc_type: { action: "browser_type" },
  bc_paste: { action: "clipboard_write" },
  bc_press: { action: "browser_press" },
  bc_scroll: { action: "browser_scroll" },
  bc_screenshot: { action: "screenshot" },
  bc_highlight: { action: "browser_highlight" },
  bc_generate_locator: { action: "browser_generate_locator" },
  bc_tab_list: { action: "browser_tab_list" },
  bc_tab_switch: { action: "browser_tab_switch" },
  bc_tab_close: { action: "browser_tab_close" },
  bc_close: { action: "browser_close" },
  bc_screencast_start: { action: "browser_screencast_start" },
  bc_screencast_stop: { action: "browser_screencast_stop" },
  bc_screencast_status: { action: "browser_screencast_status" },
  bc_list: { action: "browser_list" },
  bc_attach: { action: "browser_attach" },
  bc_detach: { action: "browser_detach" },
  bc_launch: { action: "browser_launch" },
  bc_drop: { action: "browser_drop_file" },
  bc_downloads_list: { action: "browser_downloads_list" },
  bc_dialog: { action: "browser_dialog" },
  bc_cdp: { action: "cdp_execute" },
  bc_state: { action: "browser_capture" },
  bc_act: { action: "act" },
  bc_task_run: { action: "browser_click" },
  bc_provider_list: { action: "browser_provider_list" },
  bc_provider_catalog: { action: "browser_provider_catalog" },
  bc_provider_use: { action: "browser_provider_use", params: { name: "browserless" } },
  bc_provider_health: { action: "browser_provider_health" },
  bc_terminal_open: { action: "terminal_open" },
  bc_terminal_exec: { action: "terminal_exec", params: { command: "echo test" } },
  bc_terminal_read: { action: "terminal_read" },
  bc_terminal_write: { action: "terminal_write" },
  bc_terminal_interrupt: { action: "terminal_interrupt" },
  bc_terminal_snapshot: { action: "terminal_snapshot" },
  bc_terminal_list: { action: "terminal_list" },
  bc_terminal_close: { action: "terminal_close" },
  bc_terminal_resume: { action: "terminal_resume" },
  bc_terminal_status: { action: "terminal_status" },
  bc_fs_read: { action: "fs_read", params: { path: "." } },
  bc_fs_write: { action: "fs_write", params: { path: "file.txt" } },
  bc_fs_write_output: { action: "fs_write_output", params: { filename: "output.txt" } },
  bc_fs_list: { action: "fs_list", params: { path: "." } },
  bc_fs_move: { action: "fs_move", params: { src: "a.txt", dst: "b.txt" } },
  bc_fs_delete: { action: "fs_delete", params: { path: "file.txt" } },
  bc_fs_stat: { action: "fs_stat", params: { path: "." } },
  bc_debug_health: { action: "debug_health" },
  bc_debug_failure_bundle: { action: "debug_bundle_export" },
  bc_debug_get_console: { action: "debug_console_read" },
  bc_debug_get_network: { action: "debug_network_read" },
  bc_service_list: { action: "service_list" },
  bc_service_resolve: { action: "service_resolve" },
  bc_vault_list: { action: "secret_use" },
  bc_network_rules_list: { action: "network_rules_list" },
  bc_network_blocked_requests: { action: "network_blocked_requests" },
  bc_workflow_run: { action: "workflow_run" },
  bc_workflow_status: { action: "workflow_status" },
  bc_workflow_resume: { action: "workflow_resume" },
  bc_workflow_approve: { action: "workflow_approve" },
  bc_workflow_cancel: { action: "workflow_cancel" },
  bc_workflow_events: { action: "workflow_status" },
  bc_workflow_edit_state: { action: "workflow_edit_state" },
  bc_harness_list: { action: "harness_list" },
  bc_harness_find_helper: { action: "harness_find" },
  bc_harness_validate_helper: { action: "harness_validate" },
  bc_harness_rollback: { action: "harness_rollback" },
  bc_harness_generate: { action: "harness_generate" },
  bc_harness_execute: { action: "harness_execute" },
  bc_package_install: { action: "package_install" },
  bc_package_list: { action: "package_list" },
  bc_package_info: { action: "package_info" },
  bc_package_run: { action: "package_run" },
  bc_package_remove: { action: "package_remove" },
  bc_package_update: { action: "package_update" },
  bc_package_grant: { action: "package_grant" },
  bc_package_eval: { action: "package_eval" },
  bc_package_review: { action: "package_review" },
  bc_package_review_history: { action: "package_review_history" },
  bc_package_eval_history: { action: "package_eval_history" },
};

function filterToolsForPolicyProfile(
  tools: McpTool[],
  profileName: string,
  explicitSession: boolean,
): McpTool[] {
  const policyEngine = new DefaultPolicyEngine({ profileName });
  const context = {
    sessionId: "mcp-list-tools",
    actor: "agent" as const,
    profileName,
    explicitSession,
  };
  return tools.filter((tool) => {
    const probe = TOOL_POLICY_PROBES[tool.name];
    if (!probe) return true;
    const step = defaultRouter.buildRoutedStep(
      {
        goal: `mcp-list-tools:${tool.name}`,
        actor: "agent",
        sessionId: context.sessionId,
        metadata: { source: "mcp-list-tools", toolName: tool.name },
      },
      probe.action,
      probe.params ?? {},
      context,
    );
    const evaluation = policyEngine.evaluate(step, context);
    return evaluation.decision === "allow" || evaluation.decision === "allow_with_audit";
  });
}

export function isToolVisibleForActivePolicy(api: BrowserControlAPI, tool: McpTool): boolean {
  return filterToolsForPolicyProfile(
    [tool],
    api.sessionManager.getActivePolicyProfile(),
    true,
  ).length === 1;
}

export function buildToolRegistry(
  api: BrowserControlAPI,
  options: ToolRegistryOptions = {},
): McpTool[] {
  const tools = [
    ...buildStatusTools(api),
    ...buildSessionTools(api),
    ...buildBrowserTools(api),
    ...buildProviderTools(api),
    ...buildTerminalTools(api),
    ...buildFsTools(api),
    ...buildDebugTools(api),
    ...buildServiceTools(api),
    ...buildSecurityTools(api),
    ...buildWorkflowTools(api),
    ...buildPackageTools(api),
  ];
  const mode = options.mode ?? (process.env.BROWSER_CONTROL_MCP_MODE === "lite" ? "lite" : "full");
  return mode === "lite" ? tools.filter((tool) => LITE_TOOL_NAMES.has(tool.name)) : tools;
}

export function filterToolRegistryForActivePolicy(
  api: BrowserControlAPI,
  tools: McpTool[],
): McpTool[] {
  return filterToolsForPolicyProfile(
    tools,
    api.sessionManager.getActivePolicyProfile(),
    true,
  );
}

export type ToolCategories = Readonly<Record<string, readonly string[]>>;

const toolCategoriesCache = new WeakMap<BrowserControlAPI, ToolCategories>();

function freezeToolCategories(
  categories: Record<string, string[]>,
): ToolCategories {
  for (const names of Object.values(categories)) {
    Object.freeze(names);
  }
  return Object.freeze(categories);
}

/**
 * Get tool names grouped by category for diagnostics.
 */
export function getToolCategories(api: BrowserControlAPI): ToolCategories {
  const cached = toolCategoriesCache.get(api);
  if (cached) {
    return cached;
  }

  const categories = freezeToolCategories({
    status: buildStatusTools(api).map((t) => t.name),
    session: buildSessionTools(api).map((t) => t.name),
    browser: buildBrowserTools(api).map((t) => t.name),
    provider: buildProviderTools(api).map((t) => t.name),
    terminal: buildTerminalTools(api).map((t) => t.name),
    fs: buildFsTools(api).map((t) => t.name),
    debug: buildDebugTools(api).map((t) => t.name),
    service: buildServiceTools(api).map((t) => t.name),
    security: buildSecurityTools(api).map((t) => t.name),
    workflow: buildWorkflowTools(api).map((t) => t.name),
    package: buildPackageTools(api).map((t) => t.name),
  });
  toolCategoriesCache.set(api, categories);
  return categories;
}
