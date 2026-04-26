/**
 * MCP Filesystem Tools — Wrap the Browser Control filesystem action surface.
 *
 * Tools:
 *   - bc_fs_read
 *   - bc_fs_write
 *   - bc_fs_list
 *   - bc_fs_move
 *   - bc_fs_delete
 *   - bc_fs_stat
 *
 * All tools use the structured fs actions (NOT shell command emulation)
 * and preserve policy metadata.
 */

import type { BrowserControlAPI } from "../../browser_control";
import type { McpTool } from "../types";
import { buildSchema } from "../types";

/**
 * Build filesystem MCP tools for a Browser Control instance.
 */
export function buildFsTools(api: BrowserControlAPI): McpTool[] {
  return [
    {
      name: "bc_fs_read",
      description: "Read the contents of a file.",
      inputSchema: buildSchema({
        path: { type: "string", description: "File path to read." },
        maxBytes: { type: "number", description: "Maximum bytes to read." },
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
      }, ["path"]),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.fs.read({
          path: params.path as string,
          maxBytes: params.maxBytes as number | undefined,
        });
      },
    },

    {
      name: "bc_fs_write",
      description: "Write content to a file. Creates parent directories by default.",
      inputSchema: buildSchema({
        path: { type: "string", description: "File path to write." },
        content: { type: "string", description: "Content to write." },
        createDirs: { type: "boolean", description: "Create parent directories if they don't exist. Default: true.", default: true },
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
      }, ["path", "content"]),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.fs.write({
          path: params.path as string,
          content: params.content as string,
          createDirs: params.createDirs as boolean | undefined,
        });
      },
    },

    {
      name: "bc_fs_list",
      description: "List the contents of a directory.",
      inputSchema: buildSchema({
        path: { type: "string", description: "Directory path to list. Default: current working directory.", default: "." },
        recursive: { type: "boolean", description: "Recurse into subdirectories.", default: false },
        extension: { type: "string", description: "Filter by file extension (e.g., '.ts')." },
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
      }),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.fs.ls({
          path: (params.path as string | undefined) ?? ".",
          recursive: params.recursive as boolean | undefined,
          extension: params.extension as string | undefined,
        });
      },
    },

    {
      name: "bc_fs_move",
      description: "Move or rename a file or directory.",
      inputSchema: buildSchema({
        src: { type: "string", description: "Source path." },
        dst: { type: "string", description: "Destination path." },
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
      }, ["src", "dst"]),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.fs.move({
          src: params.src as string,
          dst: params.dst as string,
        });
      },
    },

    {
      name: "bc_fs_delete",
      description: "Delete a file or directory. Use recursive:true for directories.",
      inputSchema: buildSchema({
        path: { type: "string", description: "Path to delete." },
        recursive: { type: "boolean", description: "Allow recursive directory deletion.", default: false },
        force: { type: "boolean", description: "Don't throw if path doesn't exist.", default: false },
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
      }, ["path"]),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.fs.rm({
          path: params.path as string,
          recursive: params.recursive as boolean | undefined,
          force: params.force as boolean | undefined,
        });
      },
    },

    {
      name: "bc_fs_stat",
      description: "Get file or directory metadata (size, type, modified time, permissions).",
      inputSchema: buildSchema({
        path: { type: "string", description: "Path to stat." },
        sessionId: { type: "string", description: "Browser Control session ID. If omitted, uses the active session." },
      }, ["path"]),
      handler: async (params) => {
        if (params.sessionId) api.session.use(params.sessionId as string);
        return api.fs.stat({
          path: params.path as string,
        });
      },
    },
  ];
}