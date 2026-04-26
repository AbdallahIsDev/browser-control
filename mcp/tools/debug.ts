/**
 * MCP Debug / Health Tools — Section 10 observability tools.
 *
 * Tools:
 *   - bc_debug_health
 *   - bc_debug_failure_bundle
 *   - bc_debug_get_console
 *   - bc_debug_get_network
 */

import type { BrowserControlAPI } from "../../browser_control";
import type { McpTool } from "../types";
import { buildSchema } from "../types";
import { HealthCheck } from "../../runtime/health_check";
import { isPolicyAllowed, type PolicyAllowResult } from "../../session_manager";
import type { ActionResult } from "../../shared/action_result";

function evaluateDebugPolicy(
  api: BrowserControlAPI,
  action: string,
  params: Record<string, unknown>,
  sessionId = "system",
): PolicyAllowResult | ActionResult {
  const policyEval = api.sessionManager.evaluateAction(action, params, sessionId);
  return policyEval;
}

/**
 * Build debug/health MCP tools for a Browser Control instance.
 */
export function buildDebugTools(api: BrowserControlAPI): McpTool[] {
  return [
    {
      name: "bc_debug_health",
      description: "Run health checks on the Browser Control runtime: CDP connectivity, memory store, proxy pool, CAPTCHA config, OpenRouter config, disk space, browser state, data directories, config validity, daemon broker, and system memory. Returns an overall health status and per-check results.",
      inputSchema: buildSchema({
        port: { type: "number", description: "CDP port to check. Default: 9222.", default: 9222 },
      }),
      handler: async (params) => {
        const policyEval = evaluateDebugPolicy(api, "debug_health", params, "system");
        if (!isPolicyAllowed(policyEval)) return policyEval;

        const healthCheck = new HealthCheck({
          port: params.port as number | undefined,
          memoryStore: api.sessionManager.getMemoryStore(),
        });
        const report = await healthCheck.runExtended();

        return {
          success: report.overall !== "unhealthy",
          path: policyEval.path,
          sessionId: "system",
          data: report,
          policyDecision: policyEval.policyDecision,
          risk: policyEval.risk,
          ...(policyEval.auditId ? { auditId: policyEval.auditId } : {}),
          completedAt: report.timestamp,
        };
      },
    },
    {
      name: "bc_debug_failure_bundle",
      description: "Retrieve a debug bundle by ID. Debug bundles contain structured evidence about failed actions including browser state, terminal output, console logs, network events, and recovery guidance.",
      inputSchema: buildSchema({
        bundleId: { type: "string", description: "The debug bundle ID to retrieve." },
      }),
      handler: async (params) => {
        const bundleId = params.bundleId as string;
        if (!bundleId) {
          return {
            success: false,
            path: "command" as const,
            sessionId: "system",
            error: "bundleId is required",
            completedAt: new Date().toISOString(),
          };
        }

        const policyEval = evaluateDebugPolicy(api, "debug_bundle_export", { bundleId }, "system");
        if (!isPolicyAllowed(policyEval)) return policyEval;

        const bundle = api.debug.bundle(bundleId);
        if (!bundle) {
          return {
            success: false,
            path: policyEval.path,
            sessionId: "system",
            error: `Bundle "${bundleId}" not found`,
            policyDecision: policyEval.policyDecision,
            risk: policyEval.risk,
            ...(policyEval.auditId ? { auditId: policyEval.auditId } : {}),
            completedAt: new Date().toISOString(),
          };
        }

        return {
          success: true,
          path: policyEval.path,
          sessionId: bundle.sessionId,
          data: bundle,
          policyDecision: policyEval.policyDecision,
          risk: policyEval.risk,
          ...(policyEval.auditId ? { auditId: policyEval.auditId } : {}),
          completedAt: bundle.assembledAt,
        };
      },
    },
    {
      name: "bc_debug_get_console",
      description: "Get captured browser console entries for a session. Returns log, warn, error, info, and debug entries with timestamps and source locations.",
      inputSchema: buildSchema({
        sessionId: { type: "string", description: "Session ID to get console entries for. Default: 'default'.", default: "default" },
      }),
      handler: async (params) => {
        const sessionId = (params.sessionId as string) ?? "default";
        const policyEval = evaluateDebugPolicy(api, "debug_console_read", { sessionId }, sessionId);
        if (!isPolicyAllowed(policyEval)) return policyEval;
        const entries = api.debug.console({ sessionId });

        return {
          success: true,
          path: policyEval.path,
          sessionId,
          data: { sessionId, entries, count: entries.length },
          policyDecision: policyEval.policyDecision,
          risk: policyEval.risk,
          ...(policyEval.auditId ? { auditId: policyEval.auditId } : {}),
          completedAt: new Date().toISOString(),
        };
      },
    },
    {
      name: "bc_debug_get_network",
      description: "Get captured browser network entries for a session. Returns request failures and HTTP errors with URL, method, status, and duration.",
      inputSchema: buildSchema({
        sessionId: { type: "string", description: "Session ID to get network entries for. Default: 'default'.", default: "default" },
      }),
      handler: async (params) => {
        const sessionId = (params.sessionId as string) ?? "default";
        const policyEval = evaluateDebugPolicy(api, "debug_network_read", { sessionId }, sessionId);
        if (!isPolicyAllowed(policyEval)) return policyEval;
        const entries = api.debug.network({ sessionId });

        return {
          success: true,
          path: policyEval.path,
          sessionId,
          data: { sessionId, entries, count: entries.length },
          policyDecision: policyEval.policyDecision,
          risk: policyEval.risk,
          ...(policyEval.auditId ? { auditId: policyEval.auditId } : {}),
          completedAt: new Date().toISOString(),
        };
      },
    },
  ];
}
