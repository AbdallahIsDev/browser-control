/**
 * MCP Server — Browser Control's first-party MCP server implementation.
 *
 * Uses the MCP SDK with stdio transport.
 * Registers all Browser Control tools (browser, terminal, filesystem, session, debug).
 * Wraps the Browser Control action surface via createBrowserControl().
 *
 * Entry point: `bc mcp serve` (see cli.ts)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import fs from "node:fs";
import path from "node:path";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createBrowserControl, type BrowserControlAPI } from "../browser_control";
import {
  buildToolRegistry,
  filterToolRegistryForActivePolicy,
  isToolVisibleForActivePolicy,
} from "./tool_registry";
import { actionResultToMcpResult, normalizeError, mcpErrorResult, validateToolParams } from "./types";
import type { McpTool } from "./types";
import { logger } from "../shared/logger";

const log = logger.withComponent("mcp_server");

// ── Server Metadata ────────────────────────────────────────────────────

const SERVER_NAME = "browser-control";
const SERVER_VERSION = readPackageVersion();

type EventTargetLike = {
  once(event: string, listener: () => void): unknown;
  off?(event: string, listener: () => void): unknown;
  removeListener?(event: string, listener: () => void): unknown;
};

type McpLifecycleServer = Pick<Server, "close"> & {
  onclose?: () => void;
};

type McpLifecycleTransport = {
  close(): Promise<void>;
  onclose?: () => void;
};

type McpShutdownOptions = {
  bc: Pick<BrowserControlAPI, "close">;
  server: McpLifecycleServer;
  transport: McpLifecycleTransport;
  stdin?: EventTargetLike;
  signalTarget?: EventTargetLike;
  exit?: (code?: number) => unknown;
};

function readPackageVersion(): string {
  const packageJsonPath = path.resolve(__dirname, "..", "..", "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
  if (typeof packageJson.version !== "string" || packageJson.version.trim() === "") {
    throw new Error(`Missing package version in ${packageJsonPath}`);
  }
  return packageJson.version;
}

function removeOnce(
  target: EventTargetLike,
  event: string,
  listener: () => void,
): void {
  if (typeof target.off === "function") {
    target.off(event, listener);
    return;
  }
  target.removeListener?.(event, listener);
}

function addOnce(
  target: EventTargetLike,
  event: string,
  listener: () => void,
): () => void {
  target.once(event, listener);
  return () => removeOnce(target, event, listener);
}

export function bindMcpShutdownHandlers({
  bc,
  exit = (code?: number) => process.exit(code ?? 0),
  server,
  signalTarget = process,
  stdin = process.stdin,
  transport,
}: McpShutdownOptions): () => void {
  let cleanupPromise: Promise<void> | undefined;
  let cleanupExitCode: number | undefined;

  const cleanup = (reason: string, exitCode = 0): Promise<void> => {
    cleanupExitCode ??= exitCode;
    cleanupPromise ??= Promise.resolve().then(async () => {
      log.info("MCP server shutting down", { reason });
      try {
        bc.close();
      } catch (error: unknown) {
        log.error("Browser Control cleanup failed during MCP shutdown", {
          error: normalizeError(error),
        });
      }
      try {
        await server.close();
      } catch (error: unknown) {
        log.error("MCP server transport cleanup failed", {
          error: normalizeError(error),
        });
      }
      exit(cleanupExitCode);
    });
    return cleanupPromise;
  };

  const previousServerOnClose = server.onclose;
  server.onclose = () => {
    try {
      previousServerOnClose?.();
    } catch (error: unknown) {
      log.error("Previous MCP server close handler failed", {
        error: normalizeError(error),
      });
    }
    void cleanup("transport disconnect");
  };

  const previousTransportOnClose = transport.onclose;
  transport.onclose = () => {
    try {
      previousTransportOnClose?.();
    } catch (error: unknown) {
      log.error("Previous MCP transport close handler failed", {
        error: normalizeError(error),
      });
    }
    void cleanup("transport disconnect");
  };

  const closeTransport = () => {
    void transport.close().catch((error: unknown) => {
      log.error("MCP stdio transport close failed", {
        error: normalizeError(error),
      });
      void cleanup("stdio closed");
    });
  };

  const disposers = [
    addOnce(signalTarget, "SIGINT", () => void cleanup("SIGINT")),
    addOnce(signalTarget, "SIGTERM", () => void cleanup("SIGTERM")),
    addOnce(stdin, "end", closeTransport),
    addOnce(stdin, "close", closeTransport),
  ];

  return () => {
    for (const dispose of disposers) dispose();
    server.onclose = previousServerOnClose;
    transport.onclose = previousTransportOnClose;
  };
}

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
    const visibleTools = filterToolRegistryForActivePolicy(bc, tools);
    return {
      tools: visibleTools.map((tool) => ({
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
    if (!tool || !isToolVisibleForActivePolicy(bc, tool)) {
      return mcpErrorResult(`Unknown tool: ${name}`);
    }

    try {
      const params = (args ?? {}) as Record<string, unknown>;
      const validationError = validateToolParams(name, tool.inputSchema, params, tool.validation);
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
    const disposeShutdownHandlers = bindMcpShutdownHandlers({
      bc,
      server,
      transport,
    });

    try {
      await server.connect(transport);
      log.info("Browser Control MCP server started", { name: SERVER_NAME, version: SERVER_VERSION });
    } catch (error: unknown) {
      disposeShutdownHandlers();
      throw error;
    }
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
