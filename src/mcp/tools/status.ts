/**
 * MCP Status Tool — unified operator status for agents.
 *
 * Setup and doctor remain CLI-only. This tool is intentionally read-only.
 */

import type { BrowserControlAPI } from "../../browser_control";
import type { McpTool } from "../types";
import { buildSchema } from "../types";

export function buildStatusTools(api: BrowserControlAPI): McpTool[] {
  return [
    {
      name: "bc_status",
      description: "Get Browser Control operator status: daemon, broker, browser sessions, terminal sessions, tasks, services, provider, policy profile, data home, and health summary.",
      inputSchema: buildSchema({}),
      handler: async () => {
        const status = await api.status();
        return {
          success: true,
          path: "command",
          sessionId: "system",
          data: status,
          completedAt: status.timestamp,
        };
      },
    },
  ];
}

