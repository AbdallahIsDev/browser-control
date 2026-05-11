/**
 * MCP Tool Registry — Aggregates all Browser Control MCP tools.
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

/**
 * Build the complete MCP tool registry for a Browser Control instance.
 *
 * Returns a flat array of all tools, ready for registration with the MCP server.
 */
export function buildToolRegistry(api: BrowserControlAPI): McpTool[] {
  return [
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
  ];
}

/**
 * Get tool names grouped by category for diagnostics.
 */
export function getToolCategories(api: BrowserControlAPI): Record<string, string[]> {
  return {
    status: buildStatusTools(api).map((t) => t.name),
    session: buildSessionTools(api).map((t) => t.name),
    browser: buildBrowserTools(api).map((t) => t.name),
    provider: buildProviderTools(api).map((t) => t.name),
    terminal: buildTerminalTools(api).map((t) => t.name),
    fs: buildFsTools(api).map((t) => t.name),
    debug: buildDebugTools(api).map((t) => t.name),
    service: buildServiceTools(api).map((t) => t.name),
    workflow: buildWorkflowTools(api).map((t) => t.name),
    package: buildPackageTools(api).map((t) => t.name),
  };
}
