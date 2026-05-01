/**
 * MCP Tool Registry — Aggregates all Browser Control MCP tools.
 *
 * This module collects tools from all categories (browser, terminal,
 * filesystem, session, debug) and provides a flat registry that the
 * MCP server uses to expose tools to clients.
 *
 * Tool surface versioning:
 *   - Tool names are stable (bc_* prefix)
 *   - Additive evolution preferred
 *   - Destructive renames discouraged
 */

import type { BrowserControlAPI } from "../browser_control";
import type { McpTool } from "./types";
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

const SHORT_TOOL_ALIASES: Record<string, string> = {
  bc_status: "status",
  bc_browser_open: "open",
  bc_browser_snapshot: "snapshot",
  bc_browser_click: "click",
  bc_browser_fill: "fill",
  bc_browser_hover: "hover",
  bc_browser_type: "type",
  bc_browser_press: "press",
  bc_browser_scroll: "scroll",
  bc_browser_screenshot: "screenshot",
  bc_browser_highlight: "highlight",
  bc_browser_generate_locator: "generate_locator",
  bc_browser_tab_list: "tab_list",
  bc_browser_tab_switch: "tab_switch",
  bc_browser_tab_close: "tab_close",
  bc_browser_close: "browser_close",
  bc_browser_list: "browser_list",
  bc_browser_attach: "attach",
  bc_browser_detach: "detach",
  bc_browser_drop: "drop",
  bc_browser_downloads_list: "downloads_list",
  bc_session_create: "session_create",
  bc_session_list: "session_list",
  bc_session_select: "session_select",
  bc_session_status: "session_status",
  bc_terminal_open: "terminal_open",
  bc_terminal_exec: "terminal_exec",
  bc_terminal_read: "terminal_read",
  bc_terminal_write: "terminal_write",
  bc_terminal_interrupt: "terminal_interrupt",
  bc_terminal_snapshot: "terminal_snapshot",
  bc_terminal_list: "terminal_list",
  bc_terminal_close: "terminal_close",
  bc_terminal_resume: "terminal_resume",
  bc_terminal_status: "terminal_status",
  bc_fs_read: "fs_read",
  bc_fs_write: "fs_write",
  bc_fs_list: "fs_list",
  bc_fs_move: "fs_move",
  bc_fs_delete: "fs_delete",
  bc_fs_stat: "fs_stat",
  bc_debug_health: "debug_health",
  bc_debug_failure_bundle: "debug_failure_bundle",
  bc_debug_get_console: "debug_get_console",
  bc_debug_get_network: "debug_get_network",
};

function withShortAliases(tools: McpTool[]): McpTool[] {
  const aliases = tools.flatMap((tool) => {
    const alias = SHORT_TOOL_ALIASES[tool.name];
    if (!alias) return [];
    return [{
      ...tool,
      name: alias,
      description: `${tool.description} Alias for ${tool.name}.`,
    }];
  });
  return [...tools, ...aliases];
}

/**
 * Build the complete MCP tool registry for a Browser Control instance.
 *
 * Returns a flat array of all tools, ready for registration with the MCP server.
 */
export function buildToolRegistry(api: BrowserControlAPI): McpTool[] {
  return withShortAliases([
    ...buildStatusTools(api),
    ...buildSessionTools(api),
    ...buildBrowserTools(api),
    ...buildProviderTools(api),
    ...buildTerminalTools(api),
    ...buildFsTools(api),
    ...buildDebugTools(api),
    ...buildServiceTools(api),
    ...buildWorkflowTools(api),
    ...buildPackageTools(api),
  ]);
}

/**
 * Get tool names grouped by category for diagnostics.
 */
export function getToolCategories(api: BrowserControlAPI): Record<string, string[]> {
  return {
    status: withShortAliases(buildStatusTools(api)).map((t) => t.name),
    session: withShortAliases(buildSessionTools(api)).map((t) => t.name),
    browser: withShortAliases(buildBrowserTools(api)).map((t) => t.name),
    provider: withShortAliases(buildProviderTools(api)).map((t) => t.name),
    terminal: withShortAliases(buildTerminalTools(api)).map((t) => t.name),
    fs: withShortAliases(buildFsTools(api)).map((t) => t.name),
    debug: withShortAliases(buildDebugTools(api)).map((t) => t.name),
    service: withShortAliases(buildServiceTools(api)).map((t) => t.name),
    workflow: withShortAliases(buildWorkflowTools(api)).map((t) => t.name),
    package: withShortAliases(buildPackageTools(api)).map((t) => t.name),
  };
}
