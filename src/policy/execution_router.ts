/**
 * Execution Router - Path Inference and RoutedStep Construction
 *
 * This module analyzes task intents and action parameters to determine the appropriate
 * execution path (command, a11y, low_level, or network) and constructs RoutedStep objects with
 * the associated risk level.
 */

import type {
  PolicyTaskIntent,
  RoutedStep,
  ExecutionPath,
  RiskLevel,
  ExecutionContext,
} from "./types";
import crypto from "crypto";
import {
  DEFAULT_PATH_RULES,
  DEFAULT_RISK_RULES,
  type PathInferenceRule,
  type RiskAdjustmentRule,
} from "./execution_router_rules";
export type { PathInferenceRule, RiskAdjustmentRule } from "./execution_router_rules";

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
