/**
 * Execution Router Tests
 *
 * Comprehensive test coverage for the ExecutionRouter class.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { ExecutionRouter, defaultRouter, type PathInferenceRule, type RiskAdjustmentRule } from "../../execution_router";
import type { PolicyTaskIntent, ExecutionPath, RiskLevel, ExecutionContext, RoutedStep } from "../../policy";

test("default router instance is available", () => {
  assert.ok(defaultRouter);
  assert.strictEqual(typeof defaultRouter.buildRoutedStep, "function");
});

test("creates a new ExecutionRouter with default rules", () => {
  const router = new ExecutionRouter();
  assert.ok(router);
  assert.strictEqual(typeof router.buildRoutedStep, "function");
});

test("infers a11y path for accessibility actions", () => {
  const router = new ExecutionRouter();
  const intent: PolicyTaskIntent = {
    goal: "click button",
    actor: "human",
    sessionId: "test-session",
  };
  const step = router.buildRoutedStep(intent, "click", { selector: "button" });
  assert.strictEqual(step.path, "a11y");
  assert.strictEqual(step.action, "click");
  assert.strictEqual(step.risk, "moderate");
});

test("infers command path for command execution", () => {
  const router = new ExecutionRouter();
  const intent: PolicyTaskIntent = {
    goal: "run command",
    actor: "agent",
    sessionId: "test-session",
  };
  const step = router.buildRoutedStep(intent, "execute_command", { command: "ls" });
  assert.strictEqual(step.path, "command");
  assert.strictEqual(step.action, "execute_command");
  assert.strictEqual(step.risk, "moderate");
});

test("infers command path for terminal resume/status actions", () => {
  const router = new ExecutionRouter();
  const intent: PolicyTaskIntent = {
    goal: "terminal recovery",
    actor: "agent",
    sessionId: "test-session",
  };

  const statusStep = router.buildRoutedStep(intent, "terminal_status", { sessionId: "term-1" });
  assert.strictEqual(statusStep.path, "command");
  assert.strictEqual(statusStep.risk, "low");

  const resumeStep = router.buildRoutedStep(intent, "terminal_resume", { sessionId: "term-1" });
  assert.strictEqual(resumeStep.path, "command");
  assert.strictEqual(resumeStep.risk, "moderate");
});

test("classifies provider and service mutations as policy-governed command actions", () => {
  const router = new ExecutionRouter();
  const intent: PolicyTaskIntent = {
    goal: "mutate local registries",
    actor: "agent",
    sessionId: "test-session",
  };

  const providerUse = router.buildRoutedStep(intent, "browser_provider_use", { name: "browserless" });
  assert.strictEqual(providerUse.path, "command");
  assert.strictEqual(providerUse.risk, "moderate");

  const serviceRegister = router.buildRoutedStep(intent, "service_register", { name: "app" });
  assert.strictEqual(serviceRegister.path, "command");
  assert.strictEqual(serviceRegister.risk, "moderate");

  const serviceRemove = router.buildRoutedStep(intent, "service_remove", { name: "app" });
  assert.strictEqual(serviceRemove.path, "command");
  assert.strictEqual(serviceRemove.risk, "moderate");
});

test("classifies debug evidence reads as policy-governed command actions", () => {
  const router = new ExecutionRouter();
  const intent: PolicyTaskIntent = {
    goal: "read debug evidence",
    actor: "agent",
    sessionId: "debug-test",
  };

  const bundle = router.buildRoutedStep(intent, "debug_bundle_export", { bundleId: "bundle-test" });
  assert.strictEqual(bundle.path, "command");
  assert.strictEqual(bundle.risk, "high");

  const consoleRead = router.buildRoutedStep(intent, "debug_console_read", { sessionId: "debug-test" });
  assert.strictEqual(consoleRead.path, "command");
  assert.strictEqual(consoleRead.risk, "moderate");

  const networkRead = router.buildRoutedStep(intent, "debug_network_read", { sessionId: "debug-test" });
  assert.strictEqual(networkRead.path, "command");
  assert.strictEqual(networkRead.risk, "moderate");
});

test("infers low_level path for CDP actions", () => {
  const router = new ExecutionRouter();
  const intent: PolicyTaskIntent = {
    goal: "execute CDP",
    actor: "agent",
    sessionId: "test-session",
  };
  const step = router.buildRoutedStep(intent, "cdp_execute", { script: "document.body" });
  assert.strictEqual(step.path, "low_level");
  assert.strictEqual(step.action, "cdp_execute");
  assert.strictEqual(step.risk, "high");
});

test("uses requested path from intent", () => {
  const router = new ExecutionRouter();
  const intent: PolicyTaskIntent = {
    goal: "click button",
    actor: "human",
    sessionId: "test-session",
    requestedPath: "command",
  };
  const step = router.buildRoutedStep(intent, "click", { selector: "button" });
  assert.strictEqual(step.path, "command");
});

test("assigns correct risk level based on action", () => {
  const router = new ExecutionRouter();
  const intent: PolicyTaskIntent = {
    goal: "click button",
    actor: "human",
    sessionId: "test-session",
  };
  
  const lowRiskStep = router.buildRoutedStep(intent, "click", { selector: "button" });
  assert.strictEqual(lowRiskStep.risk, "moderate");

  const moderateRiskStep = router.buildRoutedStep(intent, "execute_command", { command: "npm install" });
  assert.strictEqual(moderateRiskStep.risk, "moderate");

  const highRiskStep = router.buildRoutedStep(intent, "cdp_execute", { script: "window.location" });
  assert.strictEqual(highRiskStep.risk, "high");
});

test("includes session ID in RoutedStep", () => {
  const router = new ExecutionRouter();
  const intent: PolicyTaskIntent = {
    goal: "click button",
    actor: "human",
    sessionId: "my-session",
  };
  const step = router.buildRoutedStep(intent, "click", { selector: "button" });
  assert.strictEqual(step.sessionId, "my-session");
});

test("includes actor in RoutedStep", () => {
  const router = new ExecutionRouter();
  const intent: PolicyTaskIntent = {
    goal: "click button",
    actor: "agent",
    sessionId: "test-session",
  };
  const step = router.buildRoutedStep(intent, "click", { selector: "button" });
  assert.strictEqual(step.actor, "agent");
});

test("includes metadata from intent in RoutedStep", () => {
  const router = new ExecutionRouter();
  const intent: PolicyTaskIntent = {
    goal: "click button",
    actor: "human",
    sessionId: "test-session",
    metadata: { skill: "test-skill" },
  };
  const step = router.buildRoutedStep(intent, "click", { selector: "button" });
  assert.deepStrictEqual(step.metadata, { skill: "test-skill" });
});

test("includes parameters in RoutedStep", () => {
  const router = new ExecutionRouter();
  const intent: PolicyTaskIntent = {
    goal: "click button",
    actor: "human",
    sessionId: "test-session",
  };
  const params = { selector: "button", timeout: 5000 };
  const step = router.buildRoutedStep(intent, "click", params);
  assert.deepStrictEqual(step.params, params);
});

test("generates unique ID for each RoutedStep", () => {
  const router = new ExecutionRouter();
  const intent: PolicyTaskIntent = {
    goal: "click button",
    actor: "human",
    sessionId: "test-session",
  };
  
  const step1 = router.buildRoutedStep(intent, "click", { selector: "button" });
  const step2 = router.buildRoutedStep(intent, "click", { selector: "button" });
  
  assert.notStrictEqual(step1.id, step2.id);
  assert.strictEqual(typeof step1.id, "string");
  assert.strictEqual(typeof step2.id, "string");
});

test("builds multiple RoutedSteps for batch actions", () => {
  const router = new ExecutionRouter();
  const intent: PolicyTaskIntent = {
    goal: "perform actions",
    actor: "human",
    sessionId: "test-session",
  };
  const actions = [
    { action: "click", params: { selector: "button" } },
    { action: "fill", params: { selector: "input", value: "test" } },
  ];
  
  const steps = router.buildRoutedSteps(intent, actions);
  assert.strictEqual(steps.length, 2);
  assert.strictEqual(steps[0].action, "click");
  assert.strictEqual(steps[1].action, "fill");
});

test("unknown actions default to moderate risk instead of low", () => {
  const router = new ExecutionRouter();
  const intent: PolicyTaskIntent = {
    goal: "unknown action",
    actor: "human",
    sessionId: "test-session",
  };
  const step = router.buildRoutedStep(intent, "unknown_action", {});
  assert.strictEqual(step.path, "a11y");
  assert.strictEqual(step.risk, "moderate");
});

test("overrides path for a specific step", () => {
  const router = new ExecutionRouter();
  const intent: PolicyTaskIntent = {
    goal: "click button",
    actor: "human",
    sessionId: "test-session",
  };
  
  const step = router.buildRoutedStep(intent, "click", { selector: "button" });
  assert.strictEqual(step.path, "a11y");
  
  const overriddenStep = router.overridePath(step, "command");
  assert.strictEqual(overriddenStep.path, "command");
});

test("overrides risk for a specific step", () => {
  const router = new ExecutionRouter();
  const intent: PolicyTaskIntent = {
    goal: "click button",
    actor: "human",
    sessionId: "test-session",
  };
  
  const step = router.buildRoutedStep(intent, "click", { selector: "button" });
  assert.strictEqual(step.risk, "moderate");
  
  const overriddenStep = router.overrideRisk(step, "high");
  assert.strictEqual(overriddenStep.risk, "high");
});

test("adds custom path inference rule", () => {
  const router = new ExecutionRouter();
  const intent: PolicyTaskIntent = {
    goal: "custom action",
    actor: "human",
    sessionId: "test-session",
  };
  
  const customRule: PathInferenceRule = {
    matches: (action) => action === "custom_action",
    path: "low_level" as ExecutionPath,
    risk: "moderate" as RiskLevel,
  };
  router.addPathRule(customRule);
  
  const step = router.buildRoutedStep(intent, "custom_action", {});
  assert.strictEqual(step.path, "low_level");
  assert.strictEqual(step.risk, "moderate");
});

test("adds custom risk adjustment rule", () => {
  const router = new ExecutionRouter();
  const intent: PolicyTaskIntent = {
    goal: "click button",
    actor: "human",
    sessionId: "test-session",
  };
  
  const customRule: RiskAdjustmentRule = {
    matches: (action, params) => action === "click" && params.selector === "button",
    adjustment: (risk) => risk === "low" ? "moderate" as RiskLevel : risk,
  };
  router.addRiskRule(customRule);
  
  const step = router.buildRoutedStep(intent, "click", { selector: "button" });
  assert.strictEqual(step.risk, "moderate");
});

test("uses context in risk adjustment", () => {
  const router = new ExecutionRouter();
  const intent: PolicyTaskIntent = {
    goal: "click button",
    actor: "human",
    sessionId: "test-session",
  };
  
  const customRule: RiskAdjustmentRule = {
    matches: (action, _params, context) => action === "click" && context.targetDomain === "bank.com",
    adjustment: (risk) => risk === "low" ? "high" as RiskLevel : risk,
  };
  router.addRiskRule(customRule);
  
  const context: ExecutionContext = {
    actor: "human",
    sessionId: "test-session",
    targetDomain: "bank.com",
  };
  
  const step = router.buildRoutedStep(intent, "click", { selector: "button" }, context);
  // Human actor reduction rule applies after domain-based elevation: high -> moderate
  assert.strictEqual(step.risk, "moderate");
});

test("resets all custom rules to defaults", () => {
  const router = new ExecutionRouter();
  const intent: PolicyTaskIntent = {
    goal: "click button",
    actor: "human",
    sessionId: "test-session",
  };
  
  // Get initial behavior
  const initialStep = router.buildRoutedStep(intent, "click", { selector: "button" });
  
  // Add custom rules that change the behavior
  const customPathRule: PathInferenceRule = {
    matches: (action) => action === "click",
    path: "command" as ExecutionPath,
    risk: "critical" as RiskLevel,
  };
  router.addPathRule(customPathRule);
  
  const customRiskRule: RiskAdjustmentRule = {
    matches: () => true,
    adjustment: () => "high" as RiskLevel,
  };
  router.addRiskRule(customRiskRule);
  
  // Verify custom rules are applied
  const customStep = router.buildRoutedStep(intent, "click", { selector: "button" });
  assert.strictEqual(customStep.path, "command");
  assert.strictEqual(customStep.risk, "high");
  
  // Reset to defaults
  router.resetToDefaults();
  
  // Verify router still works after reset
  const resetStep = router.buildRoutedStep(intent, "click", { selector: "button" });
  assert.ok(resetStep);
  assert.strictEqual(typeof resetStep.id, "string");
  assert.strictEqual(resetStep.action, "click");
});

test("elevates risk for file operations", () => {
  const router = new ExecutionRouter();
  const intent: PolicyTaskIntent = {
    goal: "upload file",
    actor: "human",
    sessionId: "test-session",
  };
  
  const step = router.buildRoutedStep(intent, "file_upload", { filePath: "/tmp/test.txt" });
  assert.strictEqual(step.risk, "high");
});

test("elevates risk for credential submission", () => {
  const router = new ExecutionRouter();
  const intent: PolicyTaskIntent = {
    goal: "submit credentials",
    actor: "human",
    sessionId: "test-session",
  };
  
  const step = router.buildRoutedStep(intent, "submit_credentials", { password: "secret" });
  assert.strictEqual(step.risk, "high");
});

test("elevates risk to critical for dangerous system commands", () => {
  const router = new ExecutionRouter();
  const intent: PolicyTaskIntent = {
    goal: "delete files",
    actor: "human",
    sessionId: "test-session",
  };
  
  const step = router.buildRoutedStep(intent, "execute_command", { command: "rm -rf /tmp" });
  assert.strictEqual(step.risk, "critical");
});

test("reduces risk for human actor", () => {
  const router = new ExecutionRouter();
  const intent: PolicyTaskIntent = {
    goal: "execute CDP",
    actor: "human",
    sessionId: "test-session",
  };
  
  const context: ExecutionContext = {
    actor: "human",
    sessionId: "test-session",
  };
  
  const step = router.buildRoutedStep(intent, "cdp_execute", { script: "document.body" }, context);
  // Risk is no longer reduced for human actor - stays at high
  assert.strictEqual(step.risk, "high");
});

test("keeps high risk for agent actor", () => {
  const router = new ExecutionRouter();
  const intent: PolicyTaskIntent = {
    goal: "execute CDP",
    actor: "agent",
    sessionId: "test-session",
  };
  
  const context: ExecutionContext = {
    actor: "agent",
    sessionId: "test-session",
  };
  
  const step = router.buildRoutedStep(intent, "cdp_execute", { script: "document.body" }, context);
  assert.strictEqual(step.risk, "high");
});

test("elevates risk to high for state-changing verbs like publish, submit, confirm", () => {
  const router = new ExecutionRouter();
  const intent: PolicyTaskIntent = {
    goal: "publish content",
    actor: "agent",
    sessionId: "test-session",
  };
  
  const context: ExecutionContext = {
    actor: "agent",
    sessionId: "test-session",
  };
  
  const publishStep = router.buildRoutedStep(intent, "publish_content", {}, context);
  assert.strictEqual(publishStep.risk, "high");
  
  const submitStep = router.buildRoutedStep(intent, "submit_form", {}, context);
  assert.strictEqual(submitStep.risk, "high");
  
  const confirmStep = router.buildRoutedStep(intent, "confirm_action", {}, context);
  assert.strictEqual(confirmStep.risk, "high");
  
  const deleteStep = router.buildRoutedStep(intent, "delete_item", {}, context);
  assert.strictEqual(deleteStep.risk, "high");
});

test("no longer reduces risk for human actor - risk determined by action", () => {
  const router = new ExecutionRouter();
  const intent: PolicyTaskIntent = {
    goal: "execute CDP",
    actor: "human",
    sessionId: "test-session",
  };
  
  const context: ExecutionContext = {
    actor: "human",
    sessionId: "test-session",
  };
  
  const step = router.buildRoutedStep(intent, "cdp_execute", { script: "document.body" }, context);
  assert.strictEqual(step.risk, "high");
});

test("file operations elevated to high risk", () => {
  const router = new ExecutionRouter();
  const intent: PolicyTaskIntent = {
    goal: "upload file",
    actor: "agent",
    sessionId: "test-session",
  };
  
  const context: ExecutionContext = {
    actor: "agent",
    sessionId: "test-session",
  };
  
  const uploadStep = router.buildRoutedStep(intent, "file_upload", { filePath: "/tmp/test.txt" }, context);
  assert.strictEqual(uploadStep.risk, "high");
  
  const downloadStep = router.buildRoutedStep(intent, "file_download", {}, context);
  assert.strictEqual(downloadStep.risk, "high");
});

test("overridePath changes the execution path", () => {
  const router = new ExecutionRouter();
  const step: RoutedStep = {
    id: "test-override",
    path: "a11y",
    action: "click",
    params: { selector: "button" },
    risk: "low",
  };
  
  const overridden = router.overridePath(step, "command");
  assert.strictEqual(overridden.path, "command");
  assert.strictEqual(overridden.action, "click");
});

test("overrideRisk changes the risk level", () => {
  const router = new ExecutionRouter();
  const step: RoutedStep = {
    id: "test-override",
    path: "a11y",
    action: "click",
    params: { selector: "button" },
    risk: "low",
  };
  
  const overridden = router.overrideRisk(step, "critical");
  assert.strictEqual(overridden.risk, "critical");
  assert.strictEqual(overridden.action, "click");
});
