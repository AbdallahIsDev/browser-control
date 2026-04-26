/**
 * MCP Provider Tools — Browser provider management via MCP.
 *
 * Exposes:
 *   - bc_browser_provider_list
 *   - bc_browser_provider_use
 */

import type { BrowserControlAPI } from "../../browser_control";
import type { McpTool } from "../types";
import { buildSchema, sessionIdSchema } from "../types";
import { isPolicyAllowed } from "../../session_manager";

export function buildProviderTools(api: BrowserControlAPI): McpTool[] {
  return [
    {
      name: "bc_browser_provider_list",
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
      name: "bc_browser_provider_use",
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
  ];
}
