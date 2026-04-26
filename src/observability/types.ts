/**
 * Observability Core Types — Shared type definitions for Section 10.
 *
 * These types define the contracts for:
 *   - Debug bundles
 *   - Console entries
 *   - Network entries
 *   - Health status
 *   - Recovery guidance
 *   - Performance traces
 */

import type { ExecutionPath, RiskLevel, PolicyDecision } from "../policy/types";
import type { A11yElement } from "../a11y_snapshot";

// ── Console Capture ────────────────────────────────────────────────────

export type ConsoleLevel = "log" | "warn" | "error" | "info" | "debug";

export interface ConsoleEntry {
  level: ConsoleLevel;
  message: string;
  timestamp: string;
  source?: string;
  line?: number;
  column?: number;
  /** Page or session context */
  pageUrl?: string;
  sessionId?: string;
}

// ── Network Capture ────────────────────────────────────────────────────

export interface NetworkEntry {
  url: string;
  method: string;
  status?: number;
  error?: string;
  timestamp: string;
  durationMs?: number;
  /** Page or session context */
  pageUrl?: string;
  sessionId?: string;
  /** Whether this entry was redacted for security */
  redacted?: boolean;
}

// ── Debug Bundle ───────────────────────────────────────────────────────

export interface DebugBundleBrowserEvidence {
  url: string;
  title: string;
  snapshot?: A11yElement[];
  screenshot?: string; // base64 or file path
  consoleEntries: ConsoleEntry[];
  networkEntries: NetworkEntry[];
}

export interface DebugBundleTerminalEvidence {
  sessionId: string;
  lastOutput: string;
  exitCode?: number;
  promptState: string;
  shell?: string;
  cwd?: string;
}

export interface DebugBundleFsEvidence {
  path: string;
  operation: string;
  errorCode?: string;
}

export interface DebugBundleException {
  message: string;
  stack?: string;
  code?: string;
}

export interface RetrySummary {
  attempts: number;
  totalDurationMs: number;
  backoffUsed: boolean;
  lastError?: string;
}

export interface DebugBundle {
  bundleId: string;
  taskId: string;
  sessionId: string;
  executionPath: ExecutionPath;
  failedStep?: {
    id: string;
    action: string;
    params: Record<string, unknown>;
    risk: RiskLevel;
  };
  recentActions: Array<{
    action: string;
    timestamp: string;
    success: boolean;
    durationMs?: number;
  }>;
  policyDecisions: Array<{
    decision: PolicyDecision;
    reason?: string;
    timestamp: string;
  }>;
  browser?: DebugBundleBrowserEvidence;
  terminal?: DebugBundleTerminalEvidence;
  filesystem?: DebugBundleFsEvidence;
  exception: DebugBundleException;
  retrySummary: RetrySummary;
  recoveryGuidance: RecoveryGuidance;
  /** ISO timestamp when the bundle was assembled */
  assembledAt: string;
  /** Whether the bundle is partial (some evidence collection failed) */
  partial: boolean;
  /** Reasons why the bundle is partial, if applicable */
  partialReasons?: string[];
}

// ── Recovery Guidance ──────────────────────────────────────────────────

export interface RecoveryGuidance {
  canRetry: boolean;
  retryReason?: string;
  alternativePath?: ExecutionPath;
  alternativeReason?: string;
  requiresConfirmation: boolean;
  confirmationReason?: string;
  requiresHuman: boolean;
  humanReason?: string;
  /** Suggested next action based on failure analysis */
  suggestedAction?: string;
}

// ── Health Status ──────────────────────────────────────────────────────

export interface HealthCheckDetail {
  name: string;
  passed: boolean;
  details?: string;
  durationMs?: number;
}

export interface HealthStatus {
  component: "browser" | "terminal" | "system" | "daemon" | "policy" | "skills";
  healthy: boolean;
  checks: HealthCheckDetail[];
  timestamp: string;
}

// ── Performance Trace ──────────────────────────────────────────────────

export interface PerformanceTrace {
  traceId: string;
  taskId: string;
  sessionId: string;
  steps: Array<{
    stepId: string;
    name: string;
    startMs: number;
    endMs?: number;
    durationMs?: number;
    path: ExecutionPath;
    status: "running" | "completed" | "failed";
  }>;
  startedAt: string;
  endedAt?: string;
}

// ── Observability Store Keys ───────────────────────────────────────────

export const OBSERVABILITY_KEYS = {
  consolePrefix: "obs:console:",
  networkPrefix: "obs:network:",
  bundlePrefix: "obs:bundle:",
  tracePrefix: "obs:trace:",
  healthPrefix: "obs:health:",
} as const;