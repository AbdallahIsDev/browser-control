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

// DebugBundleBrowserEvidence is now defined below with Section 26 extensions

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

// ── Screencast (Section 26) ──────────────────────────────────────────────

export type ScreencastStatus = "recording" | "stopped" | "failed";

export interface ScreencastSession {
  id: string;
  browserSessionId: string;
  pageId: string;
  path: string;
  startedAt: string;
  stoppedAt?: string;
  status: ScreencastStatus;
  actionAnnotations: boolean;
  retention: "keep" | "delete-on-success" | "debug-only";
  mode: "native" | "frames" | "metadata-only";
}

export interface ScreencastOptions {
  path?: string;
  showActions?: boolean;
  annotationPosition?: "top-left" | "top" | "top-right" | "bottom-left" | "bottom" | "bottom-right";
  retention?: "keep" | "delete-on-success" | "debug-only";
}

export interface ActionReceiptEvent {
  timestamp: string;
  action: string;
  target?: string;
  url?: string;
  title?: string;
  policyDecision?: string;
  risk?: string;
  durationMs?: number;
  artifactPath?: string;
  success?: boolean;
  error?: string;
}

export interface DebugReceipt {
  taskId: string;
  receiptId: string;
  status: "success" | "failure" | "partial";
  startedAt: string;
  completedAt: string;
  artifacts: Array<{ kind: string; path: string; sizeBytes?: number }>;
  timelinePath?: string;
  screencastPath?: string;
  annotatedScreenshotPath?: string;
  lastFramePath?: string;
  recordingPolicy?: "keep" | "delete-on-success" | "debug-only";
}

// Extend DebugBundleBrowserEvidence with screencast/receipt artifact fields (Section 26)

export interface DebugBundleBrowserEvidence {
  url: string;
  title: string;
  snapshot?: A11yElement[];
  screenshot?: string; // base64 or file path
  consoleEntries: ConsoleEntry[];
  networkEntries: NetworkEntry[];
  // Section 26: Screencast and debug receipt artifacts
  screencastPath?: string;
  actionTimelinePath?: string;
  annotatedScreenshotPath?: string;
  lastFramePath?: string;
  recordingPolicy?: "keep" | "delete-on-success" | "debug-only";
}

// ── Observability Store Keys ───────────────────────────────────────────

export const OBSERVABILITY_KEYS = {
  consolePrefix: "obs:console:",
  networkPrefix: "obs:network:",
  bundlePrefix: "obs:bundle:",
  tracePrefix: "obs:trace:",
  healthPrefix: "obs:health:",
  screencastPrefix: "obs:screencast:",
  receiptPrefix: "obs:receipt:",
} as const;