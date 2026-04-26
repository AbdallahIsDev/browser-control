/**
 * MCP Service Tools — Wrap the Browser Control service action surface.
 *
 * Tools:
 *   - bc_service_list
 *   - bc_service_resolve
 *
 * Register/remove are intentionally omitted at the MCP layer per spec.
 */

import type { BrowserControlAPI } from "../../browser_control";
import type { McpTool } from "../types";
import { buildSchema } from "../types";

/**
 * Build service MCP tools for a Browser Control instance.
 */
export function buildServiceTools(api: BrowserControlAPI): McpTool[] {
  return [
    {
      name: "bc_service_list",
      description: "List all registered local services with their names, ports, protocols, and paths.",
      inputSchema: buildSchema({
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
      }),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.service.list();
      },
    },

    {
      name: "bc_service_resolve",
      description: "Resolve a service name to its local URL. Supports explicit bc:// references and bare registered names. Returns an error if the service is unknown or not responding.",
      inputSchema: buildSchema({
        name: { type: "string", description: "Service name to resolve (e.g., 'trading-dashboard' or 'bc://trading-dashboard')." },
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
      }, ["name"]),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.service.resolve({ name: params.name as string });
      },
    },
  ];
}
