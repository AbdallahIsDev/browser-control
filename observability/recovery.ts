/**
 * Recovery Guidance — Deterministic guidance for common failures.
 *
 * Generates structured RecoveryGuidance based on error patterns.
 * Covers:
 *   - CDP unavailable
 *   - browser disconnected
 *   - page/ref not found
 *   - policy denied
 *   - terminal timeout
 *   - terminal dead/unresponsive
 *   - filesystem permission failure
 *   - service URL unhealthy
 *   - remote provider connection failure
 */

import type { RecoveryGuidance } from "./types";
import type { ExecutionPath, ExecutionPath as PolicyExecutionPath } from "../policy";

// ── Error Classification ───────────────────────────────────────────────

export type FailureCategory =
  | "cdp_unavailable"
  | "browser_disconnected"
  | "page_not_found"
  | "ref_not_found"
  | "policy_denied"
  | "terminal_timeout"
  | "terminal_dead"
  | "fs_permission"
  | "service_unhealthy"
  | "provider_failure"
  | "unknown";

interface ErrorPattern {
  category: FailureCategory;
  patterns: RegExp[];
}

const ERROR_PATTERNS: ErrorPattern[] = [
  {
    category: "cdp_unavailable",
    patterns: [
      /CDP port.*not reachable/i,
      /Cannot connect to Chrome/i,
      /ECONNREFUSED.*9222/i,
      /debugging port.*closed/i,
      /No browser with id/i,
    ],
  },
  {
    category: "browser_disconnected",
    patterns: [
      /browser.*disconnected/i,
      /Browser has been closed/i,
      /Target closed/i,
      /Connection closed/i,
      /WebSocket.*closed/i,
    ],
  },
  {
    category: "page_not_found",
    patterns: [
      /page.*not found/i,
      /no page with url/i,
      /Navigation failed/i,
      /net::ERR_CONNECTION_REFUSED/i,
      /net::ERR_NAME_NOT_RESOLVED/i,
    ],
  },
  {
    category: "ref_not_found",
    patterns: [
      /ref.*not found/i,
      /element.*not found/i,
      /selector.*not found/i,
      /Unable to find element/i,
      /locator.*resolved to 0 elements/i,
    ],
  },
  {
    category: "policy_denied",
    patterns: [
      /Policy denied/i,
      /denied by policy/i,
      /Confirmation required/i,
      /requires confirmation/i,
    ],
  },
  {
    category: "terminal_timeout",
    patterns: [
      /timeout/i,
      /timed out/i,
      /execution timed out/i,
      /Command exceeded timeout/i,
    ],
  },
  {
    category: "terminal_dead",
    patterns: [
      /terminal.*not found/i,
      /session.*not found/i,
      /PTY.*closed/i,
      /shell.*exited/i,
      /process.*terminated/i,
    ],
  },
  {
    category: "fs_permission",
    patterns: [
      /EACCES/i,
      /EPERM/i,
      /permission denied/i,
      /access denied/i,
      /Operation not permitted/i,
    ],
  },
  {
    category: "service_unhealthy",
    patterns: [
      /service.*unhealthy/i,
      /health check failed/i,
      /Connection refused.*service/i,
      /service.*not responding/i,
    ],
  },
  {
    category: "provider_failure",
    patterns: [
      /provider.*failed/i,
      /Provider connection error/i,
      /Browserless.*error/i,
      /remote browser.*failed/i,
    ],
  },
];

// ── Guidance Rules ─────────────────────────────────────────────────────

const GUIDANCE_RULES: Record<FailureCategory, RecoveryGuidance> = {
  cdp_unavailable: {
    canRetry: true,
    retryReason: "Chrome may have restarted or the debug port may have changed. Retry after verifying Chrome is running.",
    alternativePath: "command",
    alternativeReason: "If browser automation is not essential, use terminal commands instead.",
    requiresConfirmation: false,
    requiresHuman: false,
    suggestedAction: "Run 'bc browser attach' or 'bc browser launch' to reconnect.",
  },
  browser_disconnected: {
    canRetry: true,
    retryReason: "Browser may have crashed or been closed. Retry after reconnecting.",
    alternativePath: "command",
    alternativeReason: "Use terminal commands as fallback if browser is unavailable.",
    requiresConfirmation: false,
    requiresHuman: false,
    suggestedAction: "Check Chrome process status and reconnect via 'bc browser attach'.",
  },
  page_not_found: {
    canRetry: true,
    retryReason: "Network issues or incorrect URL. Verify the URL and retry.",
    alternativePath: "command",
    alternativeReason: "Use curl or wget via terminal to verify URL accessibility.",
    requiresConfirmation: false,
    requiresHuman: false,
    suggestedAction: "Verify the URL is correct and the site is reachable.",
  },
  ref_not_found: {
    canRetry: true,
    retryReason: "Page may have changed dynamically. Retry after refreshing the snapshot.",
    alternativePath: "low_level",
    alternativeReason: "Use DOM query or coordinate fallback if a11y ref is stale.",
    requiresConfirmation: false,
    requiresHuman: false,
    suggestedAction: "Take a fresh snapshot and verify the element still exists.",
  },
  policy_denied: {
    canRetry: false,
    retryReason: "Policy explicitly denied this action. Retry will fail with the same result.",
    requiresConfirmation: true,
    confirmationReason: "This action requires explicit human approval due to its risk level.",
    requiresHuman: false,
    suggestedAction: "Switch to a more permissive policy profile or request explicit confirmation.",
  },
  terminal_timeout: {
    canRetry: true,
    retryReason: "Command may have hung. Retry with a longer timeout or simpler command.",
    alternativePath: "command",
    alternativeReason: "Run the command with reduced complexity or batch size.",
    requiresConfirmation: false,
    requiresHuman: false,
    suggestedAction: "Increase timeout or break the command into smaller steps.",
  },
  terminal_dead: {
    canRetry: false,
    retryReason: "Terminal session is dead and cannot be recovered. Start a new session.",
    alternativePath: "command",
    alternativeReason: "Use one-shot exec instead of persistent session.",
    requiresConfirmation: false,
    requiresHuman: false,
    suggestedAction: "Open a new terminal session with 'bc term open'.",
  },
  fs_permission: {
    canRetry: false,
    retryReason: "Permission denied. Retry will fail unless permissions are changed.",
    alternativePath: "command",
    alternativeReason: "Use sudo or chmod via terminal to adjust permissions first.",
    requiresConfirmation: true,
    confirmationReason: "Elevated permissions may be required for this operation.",
    requiresHuman: false,
    suggestedAction: "Check file permissions and ownership, or use a permitted path.",
  },
  service_unhealthy: {
    canRetry: true,
    retryReason: "Service may be temporarily down. Retry after a brief delay.",
    alternativePath: "command",
    alternativeReason: "Use direct service commands or check service logs via terminal.",
    requiresConfirmation: false,
    requiresHuman: false,
    suggestedAction: "Check service status and logs, then retry.",
  },
  provider_failure: {
    canRetry: true,
    retryReason: "Remote provider may have transient issues. Retry with backoff.",
    alternativePath: "a11y",
    alternativeReason: "Switch to local browser provider if remote is unavailable.",
    requiresConfirmation: false,
    requiresHuman: false,
    suggestedAction: "Switch to local provider or retry with exponential backoff.",
  },
  unknown: {
    canRetry: true,
    retryReason: "Unknown error. Retry once to rule out transient issues.",
    requiresConfirmation: false,
    requiresHuman: true,
    humanReason: "The failure cause is unclear and may require human investigation.",
    suggestedAction: "Review the debug bundle for more details.",
  },
};

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Classify an error message into a known failure category.
 */
export function classifyFailure(error: string | Error | unknown): FailureCategory {
  const message = error instanceof Error ? error.message : String(error);

  for (const pattern of ERROR_PATTERNS) {
    for (const regex of pattern.patterns) {
      if (regex.test(message)) {
        return pattern.category;
      }
    }
  }

  return "unknown";
}

/**
 * Generate recovery guidance for a failure.
 */
export function generateRecoveryGuidance(error: string | Error | unknown): RecoveryGuidance {
  const category = classifyFailure(error);
  const base = GUIDANCE_RULES[category];

  // Add context-specific enhancements
  const message = error instanceof Error ? error.message : String(error);

  return {
    ...base,
    ...(message.includes("network") && category === "unknown"
      ? {
          alternativePath: "command" as PolicyExecutionPath,
          alternativeReason: "Network issues detected. Use terminal commands as fallback.",
        }
      : {}),
  };
}

/**
 * Determine if retry is recommended for a given error.
 */
export function isRetryRecommended(error: string | Error | unknown): boolean {
  return generateRecoveryGuidance(error).canRetry;
}

/**
 * Determine if an alternative execution path is recommended.
 */
export function getAlternativePath(error: string | Error | unknown): ExecutionPath | undefined {
  return generateRecoveryGuidance(error).alternativePath;
}

/**
 * Format guidance as a human-readable string.
 */
export function formatGuidance(guidance: RecoveryGuidance): string {
  const parts: string[] = [];

  if (guidance.canRetry) {
    parts.push(`Retry: Yes. ${guidance.retryReason}`);
  } else {
    parts.push("Retry: No. This failure is not expected to resolve on retry.");
  }

  if (guidance.alternativePath) {
    parts.push(`Alternative path: ${guidance.alternativePath}. ${guidance.alternativeReason}`);
  }

  if (guidance.requiresConfirmation) {
    parts.push(`Confirmation required: ${guidance.confirmationReason}`);
  }

  if (guidance.requiresHuman) {
    parts.push(`Human intervention needed: ${guidance.humanReason}`);
  }

  if (guidance.suggestedAction) {
    parts.push(`Suggested action: ${guidance.suggestedAction}`);
  }

  return parts.join("\n");
}