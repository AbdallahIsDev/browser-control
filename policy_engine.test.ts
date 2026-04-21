/**
 * Policy Engine Tests
 *
 * Comprehensive test coverage for the DefaultPolicyEngine class.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { DefaultPolicyEngine } from "./policy_engine";
import type { RoutedStep, ExecutionContext, ConfirmationHandler, PolicyEvaluationResult } from "./policy";
import { Logger } from "./logger";

test("initializes with the default balanced profile", () => {
  const mockLogger = new Logger({ component: "test", level: "info" });
  const policyEngine = new DefaultPolicyEngine({
    logger: mockLogger,
  });
  assert.strictEqual(policyEngine.getActiveProfile(), "balanced");
});

test("initializes with safe profile when specified", () => {
  const mockLogger = new Logger({ component: "test", level: "info" });
  const policyEngine = new DefaultPolicyEngine({
    profileName: "safe",
    logger: mockLogger,
  });
  assert.strictEqual(policyEngine.getActiveProfile(), "safe");
});

test("initializes with a custom profile", () => {
  const mockLogger = new Logger({ component: "test", level: "info" });
  const customEngine = new DefaultPolicyEngine({
    profileName: "safe",
    logger: mockLogger,
  });
  assert.strictEqual(customEngine.getActiveProfile(), "safe");
});

test("allows changing the active profile", () => {
  const mockLogger = new Logger({ component: "test", level: "info" });
  const policyEngine = new DefaultPolicyEngine({
    profileName: "balanced",
    logger: mockLogger,
  });
  policyEngine.setProfile("safe");
  assert.strictEqual(policyEngine.getActiveProfile(), "safe");
  policyEngine.setProfile("trusted");
  assert.strictEqual(policyEngine.getActiveProfile(), "trusted");
});

test("throws error when setting unknown profile", () => {
  const mockLogger = new Logger({ component: "test", level: "info" });
  const policyEngine = new DefaultPolicyEngine({
    profileName: "balanced",
    logger: mockLogger,
  });
  assert.throws(() => {
    policyEngine.setProfile("unknown");
  }, /Profile "unknown" not found/);
});

test("degrades to safe profile when unknown profile is requested on initialization", () => {
  const mockLogger = new Logger({ component: "test", level: "info" });
  const policyEngine = new DefaultPolicyEngine({
    profileName: "unknown_profile",
    logger: mockLogger,
  });
  assert.strictEqual(policyEngine.getActiveProfile(), "safe");
});

test("allows low-risk actions in balanced profile", () => {
  const mockLogger = new Logger({ component: "test", level: "info" });
  const policyEngine = new DefaultPolicyEngine({
    profileName: "balanced",
    logger: mockLogger,
  });
  const step: RoutedStep = {
    id: "test-1",
    path: "a11y",
    action: "click",
    params: {},
    risk: "low",
    sessionId: "test-session",
  };
  const context: ExecutionContext = {
    sessionId: "test-session",
    actor: "agent",
    explicitSession: true,
  };
  const result = policyEngine.evaluate(step, context);
  assert.strictEqual(result.decision, "allow");
  assert.strictEqual(result.risk, "low");
  assert.strictEqual(result.profile, "balanced");
});

test("requires confirmation for moderate-risk actions in balanced profile", () => {
  const mockLogger = new Logger({ component: "test", level: "info" });
  const policyEngine = new DefaultPolicyEngine({
    profileName: "balanced",
    logger: mockLogger,
  });
  const step: RoutedStep = {
    id: "test-2",
    path: "command",
    action: "execute_command",
    params: { command: "npm install" },
    risk: "moderate",
    sessionId: "test-session",
  };
  const result = policyEngine.evaluate(step);
  assert.strictEqual(result.decision, "require_confirmation");
});

test("preserves allow_with_audit decision instead of rewriting to allow", () => {
  const mockLogger = new Logger({ component: "test", level: "info" });
  const policyEngine = new DefaultPolicyEngine({
    profileName: "balanced",
    logger: mockLogger,
  });
  const step: RoutedStep = {
    id: "test-2a",
    path: "command",
    action: "execute_command",
    params: { command: "ls -la" },
    risk: "moderate",
    sessionId: "test-session",
  };
  const result = policyEngine.evaluate(step);
  assert.strictEqual(result.decision, "allow_with_audit");
  assert.strictEqual(result.auditRequired, true);
});

test("denies high-risk actions in balanced profile", () => {
  const mockLogger = new Logger({ component: "test", level: "info" });
  const policyEngine = new DefaultPolicyEngine({
    profileName: "balanced",
    logger: mockLogger,
  });
  const step: RoutedStep = {
    id: "test-3",
    path: "low_level",
    action: "cdp_execute",
    params: { script: "window.location = 'https://evil.com'" },
    risk: "high",
    sessionId: "test-session",
  };
  const result = policyEngine.evaluate(step);
  assert.strictEqual(result.decision, "deny");
});

test("denies high-risk actions in safe profile", () => {
  const mockLogger = new Logger({ component: "test", level: "info" });
  const policyEngine = new DefaultPolicyEngine({
    profileName: "safe",
    logger: mockLogger,
  });
  const step: RoutedStep = {
    id: "test-5",
    path: "low_level",
    action: "cdp_execute",
    params: {},
    risk: "high",
    sessionId: "test-session",
  };
  const result = policyEngine.evaluate(step);
  assert.strictEqual(result.decision, "deny");
});

test("denies commands in the denied list", () => {
  const mockLogger = new Logger({ component: "test", level: "info" });
  const policyEngine = new DefaultPolicyEngine({
    profileName: "balanced",
    logger: mockLogger,
  });
  const step: RoutedStep = {
    id: "test-8",
    path: "command",
    action: "execute_command",
    params: { command: "rm -rf /tmp" },
    risk: "low",
    sessionId: "test-session",
  };
  const result = policyEngine.evaluate(step);
  assert.strictEqual(result.decision, "deny");
  assert.strictEqual(result.matchedRule, "deniedCommands");
});

test("requires confirmation for commands in the confirmation list", () => {
  const mockLogger = new Logger({ component: "test", level: "info" });
  const policyEngine = new DefaultPolicyEngine({
    profileName: "balanced",
    logger: mockLogger,
  });
  const step: RoutedStep = {
    id: "test-9",
    path: "command",
    action: "execute_command",
    params: { command: "npm install package" },
    risk: "low",
    sessionId: "test-session",
  };
  const result = policyEngine.evaluate(step);
  assert.strictEqual(result.decision, "require_confirmation");
  assert.strictEqual(result.matchedRule, "requireConfirmationCommands");
});

test("denies file uploads when not allowed", () => {
  const mockLogger = new Logger({ component: "test", level: "info" });
  const policyEngine = new DefaultPolicyEngine({
    profileName: "safe",
    logger: mockLogger,
  });
  const step: RoutedStep = {
    id: "test-11",
    path: "a11y",
    action: "file_upload",
    params: { filePath: "/tmp/test.txt" },
    risk: "low",
    sessionId: "test-session",
  };
  const result = policyEngine.evaluate(step);
  assert.strictEqual(result.decision, "deny");
  assert.strictEqual(result.matchedRule, "fileUploadAllowed");
});

test("denies credential submission when not allowed", () => {
  const mockLogger = new Logger({ component: "test", level: "info" });
  const policyEngine = new DefaultPolicyEngine({
    profileName: "safe",
    logger: mockLogger,
  });
  const step: RoutedStep = {
    id: "test-13",
    path: "a11y",
    action: "submit_credentials",
    params: { username: "test", password: "secret" },
    risk: "high",
    sessionId: "test-session",
  };
  const result = policyEngine.evaluate(step);
  assert.strictEqual(result.decision, "deny");
  assert.strictEqual(result.matchedRule, "credentialSubmissionAllowed");
});

test("denies raw CDP execution when not allowed", () => {
  const mockLogger = new Logger({ component: "test", level: "info" });
  const policyEngine = new DefaultPolicyEngine({
    profileName: "safe",
    logger: mockLogger,
  });
  const step: RoutedStep = {
    id: "test-16",
    path: "low_level",
    action: "cdp_execute",
    params: { script: "document.body.innerHTML" },
    risk: "high",
    sessionId: "test-session",
  };
  const result = policyEngine.evaluate(step);
  assert.strictEqual(result.decision, "deny");
  assert.strictEqual(result.matchedRule, "rawCdpAllowed");
});

test("allows raw CDP execution in trusted profile", () => {
  const mockLogger = new Logger({ component: "test", level: "info" });
  const policyEngine = new DefaultPolicyEngine({
    profileName: "trusted",
    logger: mockLogger,
  });
  const step: RoutedStep = {
    id: "test-19",
    path: "low_level",
    action: "cdp_execute",
    params: { script: "document.body.innerHTML" },
    risk: "high",
    sessionId: "test-session",
  };
  const result = policyEngine.evaluate(step);
  assert.strictEqual(result.decision, "allow_with_audit");
});

test("records audit entries when enabled", () => {
  const mockLogger = new Logger({ component: "test", level: "info" });
  const auditEntries: Array<unknown> = [];
  const policyEngine = new DefaultPolicyEngine({
    profileName: "balanced",
    logger: mockLogger,
    auditEnabled: true,
    auditHandler: (entry) => {
      auditEntries.push(entry);
    },
  });
  const step: RoutedStep = {
    id: "test-20",
    path: "a11y",
    action: "click",
    params: {},
    risk: "low",
    sessionId: "test-session",
  };
  policyEngine.evaluate(step);
  assert.strictEqual(auditEntries.length, 1);
  assert.ok((auditEntries[0] as Record<string, unknown>).decision);
  assert.strictEqual((auditEntries[0] as Record<string, unknown>).sessionId, "test-session");
});

test("does not record audit entries when disabled", () => {
  const mockLogger = new Logger({ component: "test", level: "info" });
  const auditEntries: Array<unknown> = [];
  const policyEngine = new DefaultPolicyEngine({
    profileName: "balanced",
    logger: mockLogger,
    auditEnabled: true,
    auditHandler: (entry) => {
      auditEntries.push(entry);
    },
  });
  policyEngine.setAuditEnabled(false);
  const step: RoutedStep = {
    id: "test-21",
    path: "a11y",
    action: "click",
    params: {},
    risk: "low",
    sessionId: "test-session",
  };
  policyEngine.evaluate(step);
  assert.strictEqual(auditEntries.length, 0);
});

test("allows setting a confirmation handler", () => {
  const mockLogger = new Logger({ component: "test", level: "info" });
  const policyEngine = new DefaultPolicyEngine({
    profileName: "balanced",
    logger: mockLogger,
  });
  const mockHandler: ConfirmationHandler = {
    confirm: async (_step: RoutedStep, _evaluation: PolicyEvaluationResult, _context: ExecutionContext) => true,
  };
  assert.doesNotThrow(() => {
    policyEngine.setConfirmationHandler(mockHandler);
  });
});

test("allows clearing the confirmation handler", () => {
  const mockLogger = new Logger({ component: "test", level: "info" });
  const policyEngine = new DefaultPolicyEngine({
    profileName: "balanced",
    logger: mockLogger,
  });
  const mockHandler: ConfirmationHandler = {
    confirm: async (_step: RoutedStep, _evaluation: PolicyEvaluationResult, _context: ExecutionContext) => true,
  };
  policyEngine.setConfirmationHandler(mockHandler);
  assert.doesNotThrow(() => {
    policyEngine.setConfirmationHandler(null);
  });
});

test("uses context in evaluation", () => {
  const mockLogger = new Logger({ component: "test", level: "info" });
  const policyEngine = new DefaultPolicyEngine({
    profileName: "balanced",
    logger: mockLogger,
  });
  const step: RoutedStep = {
    id: "test-22",
    path: "a11y",
    action: "click",
    params: {},
    risk: "low",
    sessionId: "test-session",
  };
  const context: ExecutionContext = {
    sessionId: "custom-session",
    actor: "human",
    targetDomain: "example.com",
  };
  const result = policyEngine.evaluate(step, context);
  assert.strictEqual(result.decision, "allow");
});

test("denies automation in non-explicit sessions when automationOnlyInExplicitSessions is enabled", () => {
  const mockLogger = new Logger({ component: "test", level: "info" });
  const policyEngine = new DefaultPolicyEngine({
    profileName: "safe",
    logger: mockLogger,
  });
  const step: RoutedStep = {
    id: "test-23",
    path: "a11y",
    action: "click",
    params: {},
    risk: "low",
    sessionId: "default",
  };
  const context: ExecutionContext = {
    sessionId: "default",
    actor: "agent",
    explicitSession: false,
  };
  const result = policyEngine.evaluate(step, context);
  assert.strictEqual(result.decision, "deny");
  assert.strictEqual(result.matchedRule, "automationOnlyInExplicitSessions");
});

test("allows automation in explicit sessions when automationOnlyInExplicitSessions is enabled", () => {
  const mockLogger = new Logger({ component: "test", level: "info" });
  const policyEngine = new DefaultPolicyEngine({
    profileName: "safe",
    logger: mockLogger,
  });
  const step: RoutedStep = {
    id: "test-24",
    path: "a11y",
    action: "click",
    params: {},
    risk: "low",
    sessionId: "explicit-session",
  };
  const context: ExecutionContext = {
    sessionId: "explicit-session",
    actor: "agent",
    explicitSession: true,
  };
  const result = policyEngine.evaluate(step, context);
  assert.strictEqual(result.decision, "allow");
});
