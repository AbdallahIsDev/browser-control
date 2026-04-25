/**
 * Policy Engine - Core Types and Interfaces
 *
 * This module defines the foundational types for the Browser Control policy system.
 * It provides the type system for execution paths, risk levels, policy decisions,
 * and the structured policy categories that govern browser, terminal, and file/system operations.
 */

// ── Core Type Definitions ─────────────────────────────────────────────

export type ExecutionPath = "command" | "a11y" | "low_level";
export type RiskLevel = "low" | "moderate" | "high" | "critical";
export type PolicyDecision = "allow" | "allow_with_audit" | "require_confirmation" | "deny";

// ── Task Intent and Routed Step ───────────────────────────────────────────

export interface PolicyTaskIntent {
  goal: string;
  actor: "human" | "agent";
  sessionId: string;
  requestedPath?: ExecutionPath;
  metadata?: Record<string, unknown>;
}

export interface RoutedStep {
  id: string;
  path: ExecutionPath;
  action: string;
  params: Record<string, unknown>;
  risk: RiskLevel;
  actor?: "human" | "agent";
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

// ── Policy Evaluation Result ─────────────────────────────────────────────

export interface PolicyEvaluationResult {
  decision: PolicyDecision;
  reason: string;
  profile: string;
  risk: RiskLevel;
  matchedRule?: string;
  auditRequired: boolean;
}

// ── Execution Context ───────────────────────────────────────────────────

export interface ExecutionContext {
  sessionId?: string;
  actor?: "human" | "agent";
  cwd?: string;
  targetDomain?: string;
  profileName?: string;
  metadata?: Record<string, unknown>;
  explicitSession?: boolean;
  internalTask?: boolean;
}

// ── Policy Category: Command ─────────────────────────────────────────────

export interface CommandPolicy {
  allowedCommands?: string[];
  deniedCommands?: string[];
  requireConfirmationCommands?: string[];
  restrictedWorkingDirectories?: string[];
  restrictedNetworkClasses?: string[];
  restrictedProcessClasses?: string[];
  restrictedServiceClasses?: string[];
}

// ── Policy Category: Filesystem ─────────────────────────────────────────

export interface FilesystemPolicy {
  allowedReadRoots?: string[];
  allowedWriteRoots?: string[];
  allowedDeleteRoots?: string[];
  recursiveDeleteDefaultBehavior: "deny" | "require_confirmation";
  tempDirectoryDefaultBehavior: "allow" | "require_confirmation";
}

// ── Policy Category: Browser ────────────────────────────────────────────

export interface BrowserPolicy {
  allowedDomains?: string[];
  blockedDomains?: string[];
  fileUploadAllowed: boolean;
  fileDownloadAllowed: boolean;
  screenshotAllowed: boolean;
  clipboardAllowed: boolean;
  credentialSubmissionAllowed: boolean;
  automationOnlyInExplicitSessions: boolean;
}

// ── Policy Category: Low-Level ───────────────────────────────────────────

export interface LowLevelPolicy {
  rawCdpAllowed: boolean;
  jsEvalAllowed: boolean;
  networkInterceptionAllowed: boolean;
  cookieExportImportAllowed: boolean;
  coordinateActionsAllowed: boolean;
  performanceTracesAllowed: boolean;
}

// ── Policy Profile ───────────────────────────────────────────────────────

export interface PolicyProfile {
  name: string;
  commandPolicy: CommandPolicy;
  filesystemPolicy: FilesystemPolicy;
  browserPolicy: BrowserPolicy;
  lowLevelPolicy: LowLevelPolicy;
}

// ── Confirmation Handler Interface ───────────────────────────────────────

export interface ConfirmationHandler {
  confirm(step: RoutedStep, evaluation: PolicyEvaluationResult, context: ExecutionContext): Promise<boolean>;
}

// ── Audit Entry ──────────────────────────────────────────────────────────

export interface PolicyAuditEntry {
  timestamp: string;
  sessionId: string;
  actor: "human" | "agent";
  step: RoutedStep;
  decision: PolicyDecision;
  reason: string;
  profile: string;
  risk: RiskLevel;
  matchedRule?: string;
}

// ── Policy Engine Interface ───────────────────────────────────────────────

export interface PolicyEngine {
  evaluate(step: RoutedStep, context?: ExecutionContext): PolicyEvaluationResult;
  setConfirmationHandler(handler: ConfirmationHandler | null): void;
  getActiveProfile(): string;
  setProfile(profileName: string): void;
}
