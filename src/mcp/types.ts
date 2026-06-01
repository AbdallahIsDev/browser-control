/**
 * MCP Types — Shared types and helpers for the Browser Control MCP integration layer.
 *
 * This module provides:
 *   - McpTool definition (schema + handler)
 *   - ActionResult → MCP content conversion
 *   - Common input schema pieces
 *   - Error normalization
 *
 * All MCP tools wrap the existing Browser Control action surface and preserve
 * Browser Control's ActionResult metadata in the MCP response.
 */

import type { ActionResult } from "../shared/action_result";
import type { BrowserControlAPI } from "../browser_control";
import { redactString } from "../observability/redaction";

function stringifyMcpJson(value: unknown): string {
  return JSON.stringify(value);
}

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
  additionalProperties?: false;
}

export type RequiredParameter =
  | string
  | {
      parameter: string;
      allowEmptyString?: boolean;
      nonEmptyArray?: boolean;
    };

export interface ConditionalRequiredRule {
  when: {
    parameter: string;
    equals: string | string[];
  };
  requires: RequiredParameter[];
}

export interface ToolParameterValidation {
  conditionalRequired?: ConditionalRequiredRule[];
  mutuallyExclusive?: string[][];
  forbiddenParameters?: string[];
  arrayItems?: Record<string, ToolParameterValidation>;
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
  /** Internal cross-field validation rules that are enforced before handlers run. */
  validation?: ToolParameterValidation;
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
      text: stringifyMcpJson(structured),
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

export function resolveMcpSessionId(
  api: BrowserControlAPI,
  params: Record<string, unknown>,
): string {
  if (typeof params.sessionId === "string" && params.sessionId.length > 0) {
    api.session.use(params.sessionId);
    return params.sessionId;
  }
  return api.sessionManager.getActiveSession()?.id ?? "default";
}

/**
 * Build a tool input schema from properties and required fields.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SchemaProperty = { [key: string]: any; type: string; description?: string; enum?: string[]; default?: unknown };

export function buildSchema(
  properties: Record<string, SchemaProperty>,
  required: string[] = [],
): JSONSchema {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function isMissingRequired(value: unknown, required: RequiredParameter): boolean {
  const rule = typeof required === "string" ? { parameter: required } : required;
  if (value === undefined || value === null) return true;
  if (typeof value === "string" && value === "" && rule.allowEmptyString !== true) return true;
  if (Array.isArray(value) && rule.nonEmptyArray === true && value.length === 0) return true;
  return false;
}

function requiredParameterName(required: RequiredParameter): string {
  return typeof required === "string" ? required : required.parameter;
}

function ruleMatches(params: Record<string, unknown>, rule: ConditionalRequiredRule): boolean {
  const actual = params[rule.when.parameter];
  const expected = Array.isArray(rule.when.equals) ? rule.when.equals : [rule.when.equals];
  return expected.includes(String(actual));
}

function validateRules(toolName: string, params: Record<string, unknown>, validation: ToolParameterValidation | undefined, path = ""): string | null {
  if (!validation) return null;
  const prefix = path ? `${path}.` : "";

  for (const key of validation.forbiddenParameters ?? []) {
    if (!isMissingRequired(params[key], key)) {
      return `Parameter '${prefix}${key}' is not supported for tool '${toolName}'.`;
    }
  }

  for (const group of validation.mutuallyExclusive ?? []) {
    const present = group.filter((key) => !isMissingRequired(params[key], key));
    if (present.length > 1) {
      return `Parameters '${present.join("' and '")}' are mutually exclusive for tool '${toolName}'.`;
    }
  }

  for (const rule of validation.conditionalRequired ?? []) {
    if (!ruleMatches(params, rule)) continue;
    for (const required of rule.requires) {
      const key = requiredParameterName(required);
      if (isMissingRequired(params[key], required)) {
        return `Missing required parameter '${prefix}${key}' for tool '${toolName}' when '${prefix}${rule.when.parameter}' is '${String(params[rule.when.parameter])}'.`;
      }
    }
  }

  for (const [key, itemValidation] of Object.entries(validation.arrayItems ?? {})) {
    const value = params[key];
    if (value === undefined || value === null) continue;
    if (!Array.isArray(value)) continue;

    for (let index = 0; index < value.length; index += 1) {
      const item = value[index];
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return `Invalid item '${key}[${index}]' for tool '${toolName}': expected object.`;
      }
      const nestedError = validateRules(toolName, item as Record<string, unknown>, itemValidation, `${key}[${index}]`);
      if (nestedError) return nestedError;
    }
  }

  return null;
}

export function validateToolParams(toolName: string, schema: JSONSchema, params: Record<string, unknown>, validation?: ToolParameterValidation): string | null {
  const allowed = Object.keys(schema.properties);

  for (const key of Object.keys(params)) {
    if (!Object.prototype.hasOwnProperty.call(schema.properties, key)) {
      return `Unknown parameter '${key}' for tool '${toolName}'. Allowed: ${allowed.join(", ")}.`;
    }
  }

  for (const key of schema.required ?? []) {
    if (params[key] === undefined) {
      return `Missing required parameter '${key}' for tool '${toolName}'.`;
    }
  }

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const property = schema.properties[key];
    if (!property) continue;

    if (property.enum && !property.enum.includes(String(value))) {
      return `Invalid value '${String(value)}' for parameter '${key}' on tool '${toolName}'. Allowed: ${property.enum.join(", ")}.`;
    }

    const actualType = Array.isArray(value) ? "array" : typeof value;
    if (property.type !== actualType) {
      return `Invalid type for parameter '${key}' on tool '${toolName}': expected ${property.type}, got ${actualType}.`;
    }
  }

  const ruleError = validateRules(toolName, params, validation);
  if (ruleError) return ruleError;

  return null;
}

// ── Error Normalization ────────────────────────────────────────────────

/**
 * Normalize an unknown error into a safe string message.
 */
export function normalizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactString(message);
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
        text: stringifyMcpJson({ success: false, error: redactString(error) }),
      },
    ],
    isError: true,
  };
}
