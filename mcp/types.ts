/**
 * MCP Types — Shared types and helpers for the Browser Control MCP integration layer.
 *
 * This module provides:
 *   - McpTool definition (schema + handler)
 *   - ActionResult → MCP content conversion
 *   - Common input schema pieces
 *   - Error normalization
 *
 * All MCP tools wrap the existing Section 5 action surface and preserve
 * Browser Control's ActionResult metadata in the MCP response.
 */

import type { ActionResult } from "../shared/action_result";

// ── MCP Tool Definition ────────────────────────────────────────────────

/**
 * JSON Schema subset used for MCP tool input schemas.
 * Kept simple and explicit — hand-written for v1.
 */
export interface JSONSchema {
  type: "object";
  properties: Record<string, {
    type: string;
    description?: string;
    enum?: string[];
    default?: unknown;
  }>;
  required?: string[];
}

/**
 * A single MCP tool: name, description, input schema, and handler.
 */
export interface McpTool {
  /** Stable tool name (e.g., `bc_browser_open`). */
  name: string;
  /** Human-readable description for the agent. */
  description: string;
  /** JSON Schema for tool inputs. */
  inputSchema: JSONSchema;
  /** Handler that calls the Browser Control action surface. */
  handler: (params: Record<string, unknown>) => Promise<ActionResult>;
}

/**
 * A category of related MCP tools.
 */
export interface McpToolCategory {
  /** Prefix for tool names in this category (e.g., "browser", "terminal"). */
  prefix: string;
  /** Tools in this category. */
  tools: McpTool[];
}

// ── ActionResult → MCP Content Conversion ──────────────────────────────

/**
 * Convert an ActionResult into MCP-friendly content.
 *
 * Returns a deterministic, structured JSON string that preserves all
 * Browser Control metadata (success, path, sessionId, policyDecision,
 * risk, auditId, etc.).
 */
export function actionResultToMcpContent(result: ActionResult): {
  type: "text";
  text: string;
}[] {
  const structured = {
    success: result.success,
    path: result.path,
    sessionId: result.sessionId,
    ...(result.data !== undefined ? { data: result.data } : {}),
    ...(result.warning ? { warning: result.warning } : {}),
    ...(result.error ? { error: result.error } : {}),
    ...(result.auditId ? { auditId: result.auditId } : {}),
    ...(result.policyDecision ? { policyDecision: result.policyDecision } : {}),
    ...(result.risk ? { risk: result.risk } : {}),
    completedAt: result.completedAt,
  };

  return [
    {
      type: "text",
      text: JSON.stringify(structured, null, 2),
    },
  ];
}

/**
 * Convert an ActionResult into an MCP tool result.
 *
 * This is the standard shape returned by all Browser Control MCP tools.
 * On success: isError=false, content contains structured JSON.
 * On failure: isError=true, content contains structured JSON with error details.
 */
export function actionResultToMcpResult(result: ActionResult): {
  content: { type: "text"; text: string }[];
  isError: boolean;
} {
  return {
    content: actionResultToMcpContent(result),
    isError: !result.success,
  };
}

// ── Common Schema Pieces ───────────────────────────────────────────────

/**
 * Common sessionId parameter used by most MCP tools.
 */
export const sessionIdSchema = {
  type: "string",
  description: "Browser Control session ID. If omitted, uses the active session.",
} as const;

/**
 * Build a tool input schema from properties and required fields.
 */
export function buildSchema(
  properties: Record<string, { type: string; description?: string; enum?: string[]; default?: unknown }>,
  required: string[] = [],
): JSONSchema {
  return {
    type: "object",
    properties,
    required,
  };
}

// ── Error Normalization ────────────────────────────────────────────────

/**
 * Normalize an unknown error into a safe string message.
 */
export function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Create a standard MCP error result for unexpected handler failures.
 */
export function mcpErrorResult(error: string): {
  content: { type: "text"; text: string }[];
  isError: boolean;
} {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ success: false, error }, null, 2),
      },
    ],
    isError: true,
  };
}