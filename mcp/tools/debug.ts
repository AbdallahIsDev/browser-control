/**
 * MCP Debug / Health Tools — Minimal, honest tools for runtime diagnostics.
 *
 * Tools:
 *   - bc_debug_health
 *
 * Important boundary: Section 10 observability is not the target here.
 * We only expose what the current runtime can honestly support.
 *
 * Good:
 *   - bc_debug_health (uses existing HealthCheck from health_check.ts)
 *
 * Bad (not implemented):
 *   - fake console log capture
 *   - fake network trace export
 *   - fake failure bundles
 */

import type { BrowserControlAPI } from "../../browser_control";
import type { McpTool } from "../types";
import { buildSchema } from "../types";
import { HealthCheck } from "../../health_check";

/**
 * Build debug/health MCP tools for a Browser Control instance.
 */
export function buildDebugTools(_api: BrowserControlAPI): McpTool[] {
  return [
    {
      name: "bc_debug_health",
      description: "Run health checks on the Browser Control runtime: CDP connectivity, memory store, proxy pool, CAPTCHA config, OpenRouter config, disk space, and skill status. Returns an overall health status and per-check results.",
      inputSchema: buildSchema({
        port: { type: "number", description: "CDP port to check. Default: 9222.", default: 9222 },
      }),
      handler: async (params) => {
        const healthCheck = new HealthCheck({ port: params.port as number | undefined });
        const report = await healthCheck.runAll();

        // Map HealthReport to ActionResult shape
        return {
          success: report.overall !== "unhealthy",
          path: "command" as const,
          sessionId: "system",
          data: report,
          completedAt: report.timestamp,
        };
      },
    },
  ];
}