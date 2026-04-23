/**
 * MCP Terminal Tools — Wrap the Browser Control terminal action surface.
 *
 * Tools:
 *   - bc_terminal_open
 *   - bc_terminal_exec
 *   - bc_terminal_read
 *   - bc_terminal_write
 *   - bc_terminal_interrupt
 *   - bc_terminal_snapshot
 *   - bc_terminal_list
 *   - bc_terminal_close
 *
 * All tools use the daemon-backed / session-aware terminal path.
 * Session-bound tools (read, write, interrupt, snapshot, close) require
 * a terminal session ID.
 */

import type { BrowserControlAPI } from "../../browser_control";
import type { McpTool } from "../types";
import { buildSchema } from "../types";

/**
 * Build terminal MCP tools for a Browser Control instance.
 */
export function buildTerminalTools(api: BrowserControlAPI): McpTool[] {
  return [
    {
      name: "bc_terminal_open",
      description: "Open a new terminal session. Returns the session ID which you must pass to other terminal tools.",
      inputSchema: buildSchema({
        shell: { type: "string", description: "Shell to use (e.g., 'bash', 'powershell', 'zsh'). Auto-detected if omitted." },
        cwd: { type: "string", description: "Working directory for the terminal session." },
        name: { type: "string", description: "Human-readable name for the terminal session." },
        sessionId: { type: "string", description: "Browser Control session ID to bind the terminal to. If omitted, uses the active session." },
      }),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.terminal.open({
          shell: params.shell as string | undefined,
          cwd: params.cwd as string | undefined,
          name: params.name as string | undefined,
        });
      },
    },

    {
      name: "bc_terminal_exec",
      description: "Execute a command in a terminal session, or run a one-shot command. For one-shot execution, omit sessionId. For persistent session execution, provide the terminal session ID from bc_terminal_open.",
      inputSchema: buildSchema({
        command: { type: "string", description: "Command to execute." },
        sessionId: { type: "string", description: "Terminal session ID (from bc_terminal_open). If omitted, runs as one-shot." },
        timeoutMs: { type: "number", description: "Timeout in milliseconds. Default: 30000." },
        browserControlSessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
      }, ["command"]),
      handler: async (params) => {
        if (params.browserControlSessionId) api.session.use(params.browserControlSessionId as string);
        return api.terminal.exec({
          command: params.command as string,
          sessionId: params.sessionId as string | undefined,
          timeoutMs: params.timeoutMs as number | undefined,
        });
      },
    },

    {
      name: "bc_terminal_read",
      description: "Read recent output from a terminal session.",
      inputSchema: buildSchema({
        sessionId: { type: "string", description: "Terminal session ID (from bc_terminal_open)." },
        maxBytes: { type: "number", description: "Maximum bytes to read." },
        browserControlSessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
      }, ["sessionId"]),
      handler: async (params) => {
        if (params.browserControlSessionId) api.session.use(params.browserControlSessionId as string);
        return api.terminal.read({
          sessionId: params.sessionId as string,
          maxBytes: params.maxBytes as number | undefined,
        });
      },
    },

    {
      name: "bc_terminal_write",
      description: "Type text into a terminal session (send stdin).",
      inputSchema: buildSchema({
        sessionId: { type: "string", description: "Terminal session ID (from bc_terminal_open)." },
        text: { type: "string", description: "Text to type into the terminal." },
        browserControlSessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
      }, ["sessionId", "text"]),
      handler: async (params) => {
        if (params.browserControlSessionId) api.session.use(params.browserControlSessionId as string);
        return api.terminal.type({
          sessionId: params.sessionId as string,
          text: params.text as string,
        });
      },
    },

    {
      name: "bc_terminal_interrupt",
      description: "Send Ctrl+C to interrupt a running command in a terminal session.",
      inputSchema: buildSchema({
        sessionId: { type: "string", description: "Terminal session ID (from bc_terminal_open)." },
        browserControlSessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
      }, ["sessionId"]),
      handler: async (params) => {
        if (params.browserControlSessionId) api.session.use(params.browserControlSessionId as string);
        return api.terminal.interrupt({
          sessionId: params.sessionId as string,
        });
      },
    },

    {
      name: "bc_terminal_snapshot",
      description: "Take a snapshot of terminal state (buffer content, cursor position, prompt status).",
      inputSchema: buildSchema({
        sessionId: { type: "string", description: "Terminal session ID (from bc_terminal_open). If omitted, snapshots all sessions." },
        browserControlSessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
      }),
      handler: async (params) => {
        if (params.browserControlSessionId) api.session.use(params.browserControlSessionId as string);
        return api.terminal.snapshot({
          sessionId: params.sessionId as string | undefined,
        });
      },
    },

    {
      name: "bc_terminal_list",
      description: "List all active terminal sessions with their IDs, shells, working directories, and statuses.",
      inputSchema: buildSchema({
        browserControlSessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
      }),
      handler: async (params) => {
        if (params.browserControlSessionId) api.session.use(params.browserControlSessionId as string);
        return api.terminalActions.list();
      },
    },

    {
      name: "bc_terminal_close",
      description: "Close a terminal session and release its resources.",
      inputSchema: buildSchema({
        sessionId: { type: "string", description: "Terminal session ID (from bc_terminal_open)." },
        browserControlSessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
      }, ["sessionId"]),
      handler: async (params) => {
        if (params.browserControlSessionId) api.session.use(params.browserControlSessionId as string);
        return api.terminal.close({
          sessionId: params.sessionId as string,
        });
      },
    },
  ];
}