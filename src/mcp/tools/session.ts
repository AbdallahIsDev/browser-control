/**
 * MCP Session Tools — Wrap the Browser Control session action surface.
 *
 * Tools:
 *   - bc_session_create
 *   - bc_session_list
 *   - bc_session_select
 *   - bc_session_status
 *
 * All tools operate on the real SessionManager — no separate MCP session registry.
 */

import type { BrowserControlAPI } from "../../browser_control";
import type { McpTool } from "../types";
import { buildSchema } from "../types";

/**
 * Build session MCP tools for a Browser Control instance.
 */
export function buildSessionTools(api: BrowserControlAPI): McpTool[] {
  return [
    {
      name: "bc_session_create",
      description: "Create a new Browser Control session. Sessions bind together browser state, terminal state, policy profile, and filesystem working directory. Use this before running browser, terminal, or filesystem operations.",
      inputSchema: buildSchema({
        name: { type: "string", description: "Human-readable session name (e.g., 'trading-session-1')." },
        policyProfile: { type: "string", description: "Policy profile: 'safe', 'balanced', or 'trusted'. Default: from config.", default: "balanced" },
        workingDirectory: { type: "string", description: "Filesystem working directory for this session. Default: current working directory." },
      }, ["name"]),
      handler: async (params) => {
        const result = await api.session.create(params.name as string, {
          policyProfile: params.policyProfile as string | undefined,
          workingDirectory: params.workingDirectory as string | undefined,
        });
        if (result.success && result.data?.id) {
          api.session.use(result.data.id);
        }
        return result;
      },
    },

    {
      name: "bc_session_list",
      description: "List all Browser Control sessions with their IDs, names, policy profiles, and whether they have browser/terminal bindings.",
      inputSchema: buildSchema({}),
      handler: async () => {
        return api.session.list();
      },
    },

    {
      name: "bc_session_select",
      description: "Set the active session by name or ID. All subsequent tools that don't specify a sessionId will use this session.",
      inputSchema: buildSchema({
        nameOrId: { type: "string", description: "Session name or ID to activate." },
      }, ["nameOrId"]),
      handler: async (params) => {
        return api.session.use(params.nameOrId as string);
      },
    },

    {
      name: "bc_session_status",
      description: "Get the status of the active session or a specific session.",
      inputSchema: buildSchema({
        sessionId: { type: "string", description: "Session ID to check. If omitted, uses the active session." },
      }),
      handler: async (params) => {
        return api.session.status(params.sessionId as string | undefined);
      },
    },
  ];
}
