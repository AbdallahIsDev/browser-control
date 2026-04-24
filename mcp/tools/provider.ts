/**
 * MCP Provider Tools — Browser provider management via MCP.
 *
 * Exposes:
 *   - bc_browser_provider_list
 *   - bc_browser_provider_use
 */

import type { BrowserControlAPI } from "../../browser_control";
import type { McpTool } from "../types";
import { buildSchema, actionResultToMcpResult, sessionIdSchema } from "../types";

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
        const result = api.provider.use(name);
        return {
          success: result.success,
          path: "command",
          sessionId: "mcp",
          data: result,
          ...(result.error ? { error: result.error } : {}),
          completedAt: new Date().toISOString(),
        };
      },
    },
  ];
}
