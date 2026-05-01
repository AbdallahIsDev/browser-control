/**
 * MCP Server — Browser Control's first-party MCP server implementation.
 *
 * Uses the MCP SDK with stdio transport.
 * Registers all Browser Control tools (browser, terminal, filesystem, session, debug).
 * Wraps the Section 5 action surface via createBrowserControl().
 *
 * Entry point: `bc mcp serve` (see cli.ts)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createBrowserControl, type BrowserControlAPI } from "../browser_control";
import { buildToolRegistry } from "./tool_registry";
import { actionResultToMcpResult, normalizeError, mcpErrorResult, validateToolParams } from "./types";
import type { McpTool } from "./types";
import { logger } from "../shared/logger";

const log = logger.withComponent("mcp_server");

// ── Server Metadata ────────────────────────────────────────────────────

const SERVER_NAME = "browser-control";
const SERVER_VERSION = "1.0.0";

// ── Server Factory ─────────────────────────────────────────────────────

/**
 * Create and configure a Browser Control MCP server.
 *
 * @param api - Optional BrowserControlAPI instance. If omitted, creates one.
 * @returns Configured MCP Server instance.
 */
export function createMcpServer(api?: BrowserControlAPI): Server {
  const bc = api ?? createBrowserControl();

  // Build tool registry
  const tools = buildToolRegistry(bc);
  const toolMap = new Map(tools.map((t) => [t.name, t]));

  // Create MCP server
  const server = new Server(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // ListTools handler — expose all registered tools with schemas
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as unknown as Record<string, unknown>,
      })),
    };
  });

  // CallTool handler — route to the correct tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    const tool = toolMap.get(name);
    if (!tool) {
      return mcpErrorResult(`Unknown tool: ${name}`);
    }

    try {
      const params = (args ?? {}) as Record<string, unknown>;
      const validationError = validateToolParams(name, tool.inputSchema, params);
      if (validationError) {
        return mcpErrorResult(validationError);
      }
      const result = await tool.handler(params);
      return actionResultToMcpResult(result);
    } catch (error: unknown) {
      const message = normalizeError(error);
      log.error(`Tool ${name} failed`, { error: message });
      return mcpErrorResult(`Tool ${name} failed: ${message}`);
    }
  });

  return server;
}

// ── Server Startup ─────────────────────────────────────────────────────

/**
 * Start the Browser Control MCP server over stdio transport.
 *
 * This is the main entry point for `bc mcp serve`.
 * It creates a Browser Control instance, builds the MCP server, and
 * connects to the stdio transport.
 *
 * @returns A promise that resolves when the server closes.
 */
export async function startMcpServer(): Promise<void> {
  process.env.BROWSER_CONTROL_STDIO_MODE = "mcp";
  const bc = createBrowserControl();

  try {
    const server = createMcpServer(bc);
    const transport = new StdioServerTransport();

    // Graceful shutdown on SIGINT / SIGTERM
    const cleanup = async () => {
      log.info("MCP server shutting down...");
      bc.close();
      await server.close();
      process.exit(0);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    await server.connect(transport);
    log.info("Browser Control MCP server started", { name: SERVER_NAME, version: SERVER_VERSION });
  } catch (error: unknown) {
    log.error("Failed to start MCP server", { error: normalizeError(error) });
    bc.close();
    throw error;
  }
}

// ── Direct Entry Point ─────────────────────────────────────────────────

if (require.main === module) {
  startMcpServer().catch((error: unknown) => {
    console.error("Fatal MCP server error:", normalizeError(error));
    process.exit(1);
  });
}
