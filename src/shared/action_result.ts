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
  /** Stable machine-readable error code for agent recovery. */
  errorCode?: string;
  /** Whether retrying the action may succeed without changing user intent. */
  retryable?: boolean;
  /** Suggested next action for automated or human recovery. */
  suggestedAction?: string;
  /** Safe structured error metadata; must not contain secrets or page-sensitive payloads. */
  errorMetadata?: Record<string, unknown>;
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
    errorCode?: string;
    retryable?: boolean;
    suggestedAction?: string;
    errorMetadata?: Record<string, unknown>;
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
    ...(options.errorCode ? { errorCode: options.errorCode } : {}),
    ...(options.retryable !== undefined ? { retryable: options.retryable } : {}),
    ...(options.suggestedAction ? { suggestedAction: options.suggestedAction } : {}),
    ...(options.errorMetadata ? { errorMetadata: options.errorMetadata } : {}),
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
    errorCode: "POLICY_DENIED",
    retryable: false,
    suggestedAction: "Change the policy profile, request confirmation when supported, or choose a lower-risk action.",
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
  if (result.errorCode) out.errorCode = result.errorCode;
  if (result.retryable !== undefined) out.retryable = result.retryable;
  if (result.suggestedAction) out.suggestedAction = result.suggestedAction;
  if (result.errorMetadata) out.errorMetadata = result.errorMetadata;
  if (result.auditId) out.auditId = result.auditId;
  if (result.policyDecision) out.policyDecision = result.policyDecision;
  if (result.risk) out.risk = result.risk;
  if (result.debugBundleId) out.debugBundleId = result.debugBundleId;
  if (result.debugBundlePath) out.debugBundlePath = result.debugBundlePath;
  if (result.recoveryGuidance) out.recoveryGuidance = result.recoveryGuidance;
  if (result.partialDebug) out.partialDebug = result.partialDebug;

  return out;
}
