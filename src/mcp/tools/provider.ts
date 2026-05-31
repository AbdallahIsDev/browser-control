/**
 * MCP Provider Tools — Browser provider management via MCP.
 *
 * Exposes:
 *   - bc_provider_list
 *   - bc_provider_catalog
 *   - bc_provider_use
 *   - bc_provider_health
 */

import type { BrowserControlAPI } from "../../browser_control";
import type { McpTool } from "../types";
import { buildSchema, sessionIdSchema } from "../types";
import { isPolicyAllowed } from "../../session_manager";

export function buildProviderTools(api: BrowserControlAPI): McpTool[] {
  return [
    {
      name: "bc_provider_list",
      description: "List available browser providers and the active provider.",
      inputSchema: buildSchema({ sessionId: sessionIdSchema }),
      handler: async () => {
        const result = api.provider.list();
        return {
          success: true,
          path: "command",
          sessionId: "mcp",
          data: result,
          completedAt: new Date().toISOString(),
        };
      },
    },
    {
      name: "bc_provider_catalog",
      description: "List supported browser provider types, setup requirements, capabilities, and risk labels.",
      inputSchema: buildSchema({ sessionId: sessionIdSchema }),
      handler: async (params) => {
        const sessionId = (params.sessionId as string | undefined) ?? "mcp";
        if (params.sessionId) api.session.use(sessionId);
        const policyEval = api.sessionManager.evaluateAction("browser_provider_catalog", {}, sessionId);
        if (!isPolicyAllowed(policyEval)) return policyEval;

        const result = api.provider.catalog();
        return {
          success: result.success,
          path: policyEval.path,
          sessionId,
          data: result.data,
          ...(result.error ? { error: result.error } : {}),
          policyDecision: policyEval.policyDecision,
          risk: policyEval.risk,
          ...(policyEval.auditId ? { auditId: policyEval.auditId } : {}),
          completedAt: new Date().toISOString(),
        };
      },
    },
    {
      name: "bc_provider_use",
      description: "Set the active browser provider.",
      inputSchema: buildSchema({
        sessionId: sessionIdSchema,
        name: {
          type: "string",
          description: "Provider name to activate (local, custom, browserless).",
        },
      }, ["name"]),
      handler: async (params) => {
        const name = String(params.name);
        const sessionId = (params.sessionId as string | undefined) ?? "mcp";
        if (params.sessionId) api.session.use(sessionId);
        const policyEval = api.sessionManager.evaluateAction("browser_provider_use", { name }, sessionId);
        if (!isPolicyAllowed(policyEval)) return policyEval;

        const providerResult = api.provider.use(name);
        const result = providerResult.success ? providerResult.data! : {
          success: false,
          error: providerResult.error ?? "Provider selection failed",
        };
        return {
          success: result.success,
          path: policyEval.path,
          sessionId,
          data: result,
          ...(result.error ? { error: result.error } : {}),
          policyDecision: policyEval.policyDecision,
          risk: policyEval.risk,
          ...(policyEval.auditId ? { auditId: policyEval.auditId } : {}),
          completedAt: new Date().toISOString(),
        };
      },
    },
    {
      name: "bc_provider_health",
      description: "Run browser provider health diagnostics and scoring.",
      inputSchema: buildSchema({
        sessionId: sessionIdSchema,
        name: {
          type: "string",
          description: "Optional provider name to check. Omit to check all providers.",
        },
      }),
      handler: async (params) => {
        const sessionId = (params.sessionId as string | undefined) ?? "mcp";
        if (params.sessionId) api.session.use(sessionId);
        const policyEval = api.sessionManager.evaluateAction(
          "browser_provider_health",
          { name: params.name },
          sessionId,
        );
        if (!isPolicyAllowed(policyEval)) return policyEval;

        const result = await api.provider.health(
          typeof params.name === "string" ? params.name : undefined,
        );
        return {
          success: result.success,
          path: policyEval.path,
          sessionId,
          data: result.data,
          ...(result.error ? { error: result.error } : {}),
          policyDecision: policyEval.policyDecision,
          risk: policyEval.risk,
          ...(policyEval.auditId ? { auditId: policyEval.auditId } : {}),
          completedAt: new Date().toISOString(),
        };
      },
    },
  ];
}
