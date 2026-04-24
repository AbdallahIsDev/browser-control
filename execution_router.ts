/**
 * Execution Router - Path Inference and RoutedStep Construction
 *
 * This module analyzes task intents and action parameters to determine the appropriate
 * execution path (command, a11y, or low_level) and constructs RoutedStep objects with
 * the associated risk level.
 */

import type {
  PolicyTaskIntent,
  RoutedStep,
  ExecutionPath,
  RiskLevel,
  ExecutionContext,
} from "./policy";
import crypto from "crypto";

// ── Path Inference Rules ────────────────────────────────────────────────

export interface PathInferenceRule {
  matches: (action: string, params: Record<string, unknown>) => boolean;
  path: ExecutionPath;
  risk: RiskLevel;
}

// Default path inference rules
const DEFAULT_PATH_RULES: PathInferenceRule[] = [
  // Command path - direct terminal commands
  {
    matches: (action, params) => {
      return action === "execute_command" ||
        action === "run_script" ||
        action === "terminal_execute" ||
        (action === "shell" && typeof params.command === "string");
    },
    path: "command",
    risk: "moderate",
  },

  // ── Terminal path — read-only queries (low risk) ─────────────────
  {
    matches: (action) => {
      const terminalReadActions = [
        "terminal_list", "terminal_read", "terminal_snapshot", "terminal_status",
      ];
      return terminalReadActions.includes(action);
    },
    path: "command",
    risk: "low",
  },

  // ── Terminal path (Section 12) ──────────────────────────────────
  {
    matches: (action) => {
      const terminalActions = [
        "terminal_open", "terminal_close", "terminal_write",
        "terminal_interrupt", "terminal_exec", "terminal_resume",
        "term_open", "term_close", "term_exec", "term_resume",
      ];
      return terminalActions.includes(action);
    },
    path: "command",
    risk: "moderate",
  },

  // ── Service path (Section 14) ───────────────────────────────────
  {
    matches: (action) => {
      const serviceActions = ["service_register", "service_list", "service_resolve", "service_remove"];
      return serviceActions.includes(action);
    },
    path: "command",
    risk: "low",
  },

  // ── Filesystem path (Section 12) ────────────────────────────────
  {
    matches: (action) => {
      const fsReadActions = ["fs_read", "file_read", "read_file", "fs_list", "fs_stat"];
      return fsReadActions.includes(action);
    },
    path: "command",
    risk: "low",
  },
  {
    matches: (action) => {
      const fsWriteActions = ["fs_write", "file_write", "write_file"];
      return fsWriteActions.includes(action);
    },
    path: "command",
    risk: "high",
  },
  {
    matches: (action) => {
      const fsDestructiveActions = ["fs_delete", "fs_move", "file_delete", "file_move", "delete_file", "move_file"];
      return fsDestructiveActions.includes(action);
    },
    path: "command",
    risk: "high",
  },

  // ── Browser Action path (Section 5) ────────────────────────────
  // Screenshot is moderate risk (may contain sensitive data) — must come
  // before the broad browser action rule so it takes priority.
  {
    matches: (action) => action === "screenshot",
    path: "a11y",
    risk: "moderate",
  },
  {
    matches: (action) => {
      const browserActions = [
        "browser_navigate", "browser_click", "browser_fill",
        "browser_hover", "browser_type", "browser_press",
        "browser_scroll", "browser_close", "browser_snapshot",
        "browser_tab_list", "browser_tab_switch",
      ];
      return browserActions.includes(action);
    },
    path: "a11y",
    risk: "low",
  },

  // Low-level path - raw CDP, JS eval, network interception
  {
    matches: (action, params) => {
      return action === "cdp_execute" ||
        action === "js_evaluate" ||
        action === "network_intercept" ||
        action === "cookie_export" ||
        action === "cookie_import" ||
        action === "coordinate_action" ||
        action === "performance_trace";
    },
    path: "low_level",
    risk: "high",
  },

  // A11y path - natural language actions via Stagehand
  {
    matches: (action, params) => {
      return action === "act" ||
        action === "observe" ||
        action === "extract" ||
        action === "natural_language_action" ||
        (action === "stagehand" && typeof params.prompt === "string");
    },
    path: "a11y",
    risk: "low",
  },

  // Default fallback - assume a11y for browser actions but with moderate risk for safety
  {
    matches: () => true,
    path: "a11y",
    risk: "moderate",
  },
];

// ── Risk Adjustment Rules ────────────────────────────────────────────────

export interface RiskAdjustmentRule {
  matches: (action: string, params: Record<string, unknown>, context: ExecutionContext) => boolean;
  adjustment: (currentRisk: RiskLevel) => RiskLevel;
}

const DEFAULT_RISK_RULES: RiskAdjustmentRule[] = [
  // State-changing browser verbs - elevate risk to high
  {
    matches: (action) => {
      const stateChangingActions = [
        "publish", "submit", "confirm", "delete", "remove", "finalize", "approve", "reject",
        "upload", "download", "place_trade", "execute_order", "transfer", "payment", "checkout",
        "sign", "authorize", "grant", "revoke", "install", "deploy", "ship", "release",
      ];
      return stateChangingActions.some(verb => action.toLowerCase().includes(verb));
    },
    adjustment: () => "high",
  },

  // File operations - elevate risk to high
  {
    matches: (action, params) => {
      return action === "file_upload" ||
        action === "file_download" ||
        action === "file_delete" ||
        (typeof params.filePath === "string" && params.filePath.length > 0);
    },
    adjustment: () => "high",
  },

  // Credential submission - elevate risk significantly
  {
    matches: (action, params) => {
      return action === "submit_credentials" ||
        (typeof params.password !== "undefined" || typeof params.secret !== "undefined");
    },
    adjustment: () => "high",
  },

  // System-level commands - elevate risk to critical
  {
    matches: (action, params) => {
      if (action !== "execute_command" && action !== "shell") {
        return false;
      }
      const command = typeof params.command === "string" ? params.command.toLowerCase() : "";
      const dangerousCommands = ["rm", "rmdir", "del", "format", "fdisk", "dd", "shutdown", "reboot", "halt", "kill"];
      return dangerousCommands.some(cmd => command.startsWith(cmd));
    },
    adjustment: () => "critical",
  },

  // Domain-based risk - elevate for unknown or suspicious domains
  {
    matches: (action, params, context) => {
      const domain = params.domain ?? context.targetDomain;
      if (typeof domain !== "string") {
        return false;
      }
      // Basic heuristics for suspicious domains
      const suspiciousPatterns = [".onion", "bit.", "crypto", "free-", "hack", "crack"];
      return suspiciousPatterns.some(pattern => domain.toLowerCase().includes(pattern));
    },
    adjustment: (current) => current === "critical" ? "critical" : (current === "high" ? "critical" : "high"),
  },
];

// ── Execution Router Class ───────────────────────────────────────────────

export class ExecutionRouter {
  private pathRules: PathInferenceRule[];
  private riskRules: RiskAdjustmentRule[];

  constructor(
    pathRules: PathInferenceRule[] = DEFAULT_PATH_RULES,
    riskRules: RiskAdjustmentRule[] = DEFAULT_RISK_RULES,
  ) {
    this.pathRules = pathRules;
    this.riskRules = riskRules;
  }

  /**
   * Infer the execution path and base risk for an action.
   */
  private inferPathAndRisk(
    action: string,
    params: Record<string, unknown>,
  ): { path: ExecutionPath; risk: RiskLevel } {
    for (const rule of this.pathRules) {
      if (rule.matches(action, params)) {
        return { path: rule.path, risk: rule.risk };
      }
    }
    // Default fallback
    return { path: "a11y", risk: "low" };
  }

  /**
   * Adjust the risk based on context and specific action characteristics.
   */
  private adjustRisk(
    action: string,
    params: Record<string, unknown>,
    context: ExecutionContext,
    baseRisk: RiskLevel,
  ): RiskLevel {
    let adjustedRisk = baseRisk;
    for (const rule of this.riskRules) {
      if (rule.matches(action, params, context)) {
        adjustedRisk = rule.adjustment(adjustedRisk);
      }
    }
    return adjustedRisk;
  }

  /**
   * Build a RoutedStep from task intent, action, and parameters.
   */
  buildRoutedStep(
    intent: PolicyTaskIntent,
    action: string,
    params: Record<string, unknown>,
    context?: ExecutionContext,
  ): RoutedStep {
    const { path, risk: baseRisk } = this.inferPathAndRisk(action, params);
    const risk = this.adjustRisk(action, params, context ?? {}, baseRisk);

    const step: RoutedStep = {
      id: crypto.randomUUID(),
      path: intent.requestedPath ?? path,
      action,
      params,
      risk,
      actor: intent.actor,
      sessionId: intent.sessionId,
      metadata: intent.metadata,
    };

    return step;
  }

  /**
   * Build multiple RoutedSteps for a batch of actions.
   */
  buildRoutedSteps(
    intent: PolicyTaskIntent,
    actions: Array<{ action: string; params: Record<string, unknown> }>,
    context?: ExecutionContext,
  ): RoutedStep[] {
    return actions.map(({ action, params }) =>
      this.buildRoutedStep(intent, action, params, context),
    );
  }

  /**
   * Override the path for a specific action (used when intent explicitly requests a path).
   */
  overridePath(step: RoutedStep, newPath: ExecutionPath): RoutedStep {
    return {
      ...step,
      path: newPath,
    };
  }

  /**
   * Override the risk for a specific step (used for manual overrides).
   */
  overrideRisk(step: RoutedStep, newRisk: RiskLevel): RoutedStep {
    return {
      ...step,
      risk: newRisk,
    };
  }

  /**
   * Add custom path inference rules.
   */
  addPathRule(rule: PathInferenceRule): void {
    this.pathRules.unshift(rule); // Add to beginning for priority
  }

  /**
   * Add custom risk adjustment rules.
   */
  addRiskRule(rule: RiskAdjustmentRule): void {
    this.riskRules.unshift(rule); // Add to beginning for priority
  }

  /**
   * Reset to default rules.
   */
  resetToDefaults(): void {
    this.pathRules = [...DEFAULT_PATH_RULES];
    this.riskRules = [...DEFAULT_RISK_RULES];
  }
}

// ── Default Singleton Instance ───────────────────────────────────────────

export const defaultRouter = new ExecutionRouter();
