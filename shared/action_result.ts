/**
 * Action Result — Canonical result model for the Browser Control action surface.
 *
 * Every action exposed through the CLI, TypeScript API, or MCP returns
 * an ActionResult.  This is the single contract that consumers rely on
 * to determine success/failure, which execution path was used, and what
 * policy/audit metadata was attached.
 *
 * Section 7 (MCP) will wrap this exact shape 1:1.
 */

import type { ExecutionPath, RiskLevel, PolicyDecision } from "../policy/types";

// ── Core Result Shape ────────────────────────────────────────────────

export interface ActionResult<T = unknown> {
  /** Whether the action completed successfully. */
  success: boolean;
  /** Execution path that handled the action. */
  path: ExecutionPath;
  /** Session ID this action was bound to. */
  sessionId: string;
  /** Action payload on success. */
  data?: T;
  /** Non-fatal warning message (action still succeeded). */
  warning?: string;
  /** Error message on failure. */
  error?: string;
  /** Audit ID if the action was recorded by the policy audit log. */
  auditId?: string;
  /** Policy decision that governed this action. */
  policyDecision?: PolicyDecision;
  /** Risk level assigned by the execution router. */
  risk?: RiskLevel;
  /** ISO timestamp when the action completed. */
  completedAt: string;
  // ── Section 10: Self-Debugging and Observability ─────────────────────
  /** Debug bundle ID for failed actions (for later retrieval). */
  debugBundleId?: string;
  /** Debug bundle file path for failed actions. */
  debugBundlePath?: string;
  /** Recovery guidance for failed actions. */
  recoveryGuidance?: import("../observability/types").RecoveryGuidance;
  /** Whether this result includes partial debug evidence. */
  partialDebug?: boolean;
}

// ── Helper Constructors ───────────────────────────────────────────────

/**
 * Create a successful ActionResult.
 */
export function successResult<T>(
  data: T,
  options: {
    path: ExecutionPath;
    sessionId: string;
    warning?: string;
    auditId?: string;
    policyDecision?: PolicyDecision;
    risk?: RiskLevel;
  },
): ActionResult<T> {
  return {
    success: true,
    path: options.path,
    sessionId: options.sessionId,
    data,
    ...(options.warning ? { warning: options.warning } : {}),
    ...(options.auditId ? { auditId: options.auditId } : {}),
    ...(options.policyDecision ? { policyDecision: options.policyDecision } : {}),
    ...(options.risk ? { risk: options.risk } : {}),
    completedAt: new Date().toISOString(),
  };
}

/**
 * Create a failure ActionResult.
 */
export function failureResult<T = unknown>(
  error: string,
  options: {
    path: ExecutionPath;
    sessionId: string;
    auditId?: string;
    policyDecision?: PolicyDecision;
    risk?: RiskLevel;
    debugBundleId?: string;
    debugBundlePath?: string;
    recoveryGuidance?: import("../observability/types").RecoveryGuidance;
    partialDebug?: boolean;
  },
): ActionResult<T> {
  return {
    success: false,
    path: options.path,
    sessionId: options.sessionId,
    error,
    ...(options.auditId ? { auditId: options.auditId } : {}),
    ...(options.policyDecision ? { policyDecision: options.policyDecision } : {}),
    ...(options.risk ? { risk: options.risk } : {}),
    ...(options.debugBundleId ? { debugBundleId: options.debugBundleId } : {}),
    ...(options.debugBundlePath ? { debugBundlePath: options.debugBundlePath } : {}),
    ...(options.recoveryGuidance ? { recoveryGuidance: options.recoveryGuidance } : {}),
    ...(options.partialDebug ? { partialDebug: options.partialDebug } : {}),
    completedAt: new Date().toISOString(),
  };
}

/**
 * Create a policy-denied ActionResult.
 *
 * This is distinct from a generic failure because the action never
 * executed — policy rejected it before execution.
 */
export function policyDeniedResult<T = unknown>(
  reason: string,
  options: {
    path: ExecutionPath;
    sessionId: string;
    risk?: RiskLevel;
  },
): ActionResult<T> {
  return {
    success: false,
    path: options.path,
    sessionId: options.sessionId,
    error: `Policy denied: ${reason}`,
    policyDecision: "deny",
    ...(options.risk ? { risk: options.risk } : {}),
    completedAt: new Date().toISOString(),
  };
}

/**
 * Create a confirmation-required ActionResult.
 *
 * The action was not executed because it requires interactive
 * confirmation from a human. This is used when the policy profile
 * mandates confirmation for the action's risk level.
 */
export function confirmationRequiredResult<T = unknown>(
  reason: string,
  options: {
    path: ExecutionPath;
    sessionId: string;
    risk?: RiskLevel;
  },
): ActionResult<T> {
  return {
    success: false,
    path: options.path,
    sessionId: options.sessionId,
    error: `Confirmation required: ${reason}`,
    policyDecision: "require_confirmation",
    ...(options.risk ? { risk: options.risk } : {}),
    completedAt: new Date().toISOString(),
  };
}

/**
 * Format an ActionResult as a JSON-friendly plain object for CLI/MCP output.
 */
export function formatActionResult<T>(result: ActionResult<T>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    success: result.success,
    path: result.path,
    sessionId: result.sessionId,
    completedAt: result.completedAt,
  };

  if (result.data !== undefined) out.data = result.data;
  if (result.warning) out.warning = result.warning;
  if (result.error) out.error = result.error;
  if (result.auditId) out.auditId = result.auditId;
  if (result.policyDecision) out.policyDecision = result.policyDecision;
  if (result.risk) out.risk = result.risk;
  if (result.debugBundleId) out.debugBundleId = result.debugBundleId;
  if (result.debugBundlePath) out.debugBundlePath = result.debugBundlePath;
  if (result.recoveryGuidance) out.recoveryGuidance = result.recoveryGuidance;
  if (result.partialDebug) out.partialDebug = result.partialDebug;

  return out;
}
