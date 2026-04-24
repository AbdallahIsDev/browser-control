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
import { buildProviderTools } from "./tools/provider";

/**
 * Build the complete MCP tool registry for a Browser Control instance.
 *
 * Returns a flat array of all tools, ready for registration with the MCP server.
 */
export function buildToolRegistry(api: BrowserControlAPI): McpTool[] {
  return [
    ...buildSessionTools(api),
    ...buildBrowserTools(api),
    ...buildProviderTools(api),
    ...buildTerminalTools(api),
    ...buildFsTools(api),
    ...buildDebugTools(api),
  ];
}

/**
 * Get tool names grouped by category for diagnostics.
 */
export function getToolCategories(api: BrowserControlAPI): Record<string, string[]> {
  return {
    session: buildSessionTools(api).map((t) => t.name),
    browser: buildBrowserTools(api).map((t) => t.name),
    provider: buildProviderTools(api).map((t) => t.name),
    terminal: buildTerminalTools(api).map((t) => t.name),
    fs: buildFsTools(api).map((t) => t.name),
    debug: buildDebugTools(api).map((t) => t.name),
  };
}