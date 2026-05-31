/**
 * Policy Engine Tests
 *
 * Comprehensive test coverage for the DefaultPolicyEngine class.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DefaultPolicyEngine } from "../../src/policy_engine";
import type { RoutedStep, ExecutionContext, ConfirmationHandler, PolicyEvaluationResult } from "../../src/policy";
import { Logger } from "../../src/logger";
import { getProfile, saveCustomProfile, TRUSTED_PROFILE, validateProfile } from "../../src/policy_profiles";

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

test("loads custom profiles from disk by name", () => {
  const previousHome = process.env.BROWSER_CONTROL_HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-policy-profile-"));
  process.env.BROWSER_CONTROL_HOME = home;

  try {
    saveCustomProfile({
      ...TRUSTED_PROFILE,
      name: "review_profile",
      commandPolicy: {
        ...TRUSTED_PROFILE.commandPolicy,
        deniedCommands: ["blockedbin"],
      },
    });

    const mockLogger = new Logger({ component: "test", level: "info" });
    const policyEngine = new DefaultPolicyEngine({
      profileName: "balanced",
      logger: mockLogger,
    });
    policyEngine.setProfile("review_profile");

    assert.strictEqual(policyEngine.getActiveProfile(), "review_profile");
    const result = policyEngine.evaluate({
      id: "custom-deny",
      path: "command",
      action: "execute_command",
      params: { command: "blockedbin --danger" },
      risk: "low",
      sessionId: "test-session",
    });
    assert.equal(result.decision, "deny");
    assert.equal(result.profile, "review_profile");
  } finally {
    if (previousHome === undefined) {
      delete process.env.BROWSER_CONTROL_HOME;
    } else {
      process.env.BROWSER_CONTROL_HOME = previousHome;
    }
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("denies restricted working directories after resolving dot components", () => {
  const previousHome = process.env.BROWSER_CONTROL_HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-policy-restricted-"));
  process.env.BROWSER_CONTROL_HOME = home;

  try {
    const restrictedDir = path.join(home, "sensitive");
    fs.mkdirSync(restrictedDir, { recursive: true });

    saveCustomProfile({
      ...TRUSTED_PROFILE,
      name: "restricted_cwd_profile",
      commandPolicy: {
        ...TRUSTED_PROFILE.commandPolicy,
        restrictedWorkingDirectories: [restrictedDir],
      },
    });

    const policyEngine = new DefaultPolicyEngine({
      profileName: "restricted_cwd_profile",
      logger: new Logger({ component: "test", level: "info" }),
    });

    const result = policyEngine.evaluate({
      id: "restricted-dot-cwd",
      path: "command",
      action: "execute_command",
      params: {
        command: "pwd",
        cwd: path.join(home, ".", "sensitive"),
      },
      risk: "low",
      sessionId: "test-session",
    });

    assert.equal(result.decision, "deny");
    assert.equal(result.matchedRule, "restrictedWorkingDirectories");
  } finally {
    if (previousHome === undefined) {
      delete process.env.BROWSER_CONTROL_HOME;
    } else {
      process.env.BROWSER_CONTROL_HOME = previousHome;
    }
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("normalizes filesystem paths without lowercasing case-sensitive platforms", () => {
	const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-policy-case-"));
	Object.defineProperty(process, "platform", { value: "linux" });

	try {
		const policyEngine = new DefaultPolicyEngine({
			logger: new Logger({ component: "test", level: "info" }),
		});
		const normalized = (
			policyEngine as unknown as {
				normalizeFilesystemPath(inputPath: string): string;
			}
		).normalizeFilesystemPath(path.join(home, "CaseSensitiveChild"));

		assert.match(normalized, /CaseSensitiveChild$/u);
	} finally {
		if (originalPlatform) {
			Object.defineProperty(process, "platform", originalPlatform);
		}
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("initializes with a saved custom profile by name", () => {
  const previousHome = process.env.BROWSER_CONTROL_HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-policy-profile-"));
  process.env.BROWSER_CONTROL_HOME = home;

  try {
    saveCustomProfile({
      ...TRUSTED_PROFILE,
      name: "saved_profile",
      commandPolicy: {
        ...TRUSTED_PROFILE.commandPolicy,
        deniedCommands: ["blockedbin"],
      },
    });

    const mockLogger = new Logger({ component: "test", level: "info" });
    const policyEngine = new DefaultPolicyEngine({
      profileName: "saved_profile",
      logger: mockLogger,
    });

    assert.strictEqual(policyEngine.getActiveProfile(), "saved_profile");
    const result = policyEngine.evaluate({
      id: "saved-custom-deny",
      path: "command",
      action: "execute_command",
      params: { command: "blockedbin --danger" },
      risk: "low",
      sessionId: "test-session",
    });
    assert.equal(result.decision, "deny");
  } finally {
    if (previousHome === undefined) {
      delete process.env.BROWSER_CONTROL_HOME;
    } else {
      process.env.BROWSER_CONTROL_HOME = previousHome;
    }
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("custom profiles resolve a risk matrix from their privacy profile", () => {
  const previousHome = process.env.BROWSER_CONTROL_HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-policy-profile-risk-"));
  process.env.BROWSER_CONTROL_HOME = home;

  try {
    saveCustomProfile({
      ...TRUSTED_PROFILE,
      name: "strict_custom",
      privacyPolicy: {
        ...TRUSTED_PROFILE.privacyPolicy,
        profile: "strict",
      },
    });

    const policyEngine = new DefaultPolicyEngine({
      profileName: "strict_custom",
      logger: new Logger({ component: "test", level: "info" }),
    });

    const result = policyEngine.evaluate({
      id: "custom-risk-matrix",
      path: "command",
      action: "execute_command",
      params: { command: "echo ok" },
      risk: "moderate",
      sessionId: "test-session",
    });

    assert.equal(result.profile, "strict_custom");
    assert.equal(result.decision, "require_confirmation");
  } finally {
    if (previousHome === undefined) {
      delete process.env.BROWSER_CONTROL_HOME;
    } else {
      process.env.BROWSER_CONTROL_HOME = previousHome;
    }
    fs.rmSync(home, { recursive: true, force: true });
  }
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

test("rejects custom policy profile names that could escape the profile directory", () => {
  const validation = validateProfile({
    ...TRUSTED_PROFILE,
    name: "..\\providers\\registry",
  });

  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("\n"), /Profile name/);
});

test("saveCustomProfile refuses path traversal profile names", () => {
  const previousHome = process.env.BROWSER_CONTROL_HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-policy-profile-"));
  process.env.BROWSER_CONTROL_HOME = home;

  try {
    assert.throws(
      () => saveCustomProfile({ ...TRUSTED_PROFILE, name: "../providers/registry" }),
      /Profile name/,
    );
    assert.equal(fs.existsSync(path.join(home, "providers", "registry.json")), false);
  } finally {
    if (previousHome === undefined) {
      delete process.env.BROWSER_CONTROL_HOME;
    } else {
      process.env.BROWSER_CONTROL_HOME = previousHome;
    }
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("getProfile returns null for unsafe custom profile names", () => {
  assert.equal(getProfile("../providers/registry"), null);
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

test("denies commands in the denied list after shell operators", () => {
  const mockLogger = new Logger({ component: "test", level: "info" });
  const policyEngine = new DefaultPolicyEngine({
    profileName: "balanced",
    logger: mockLogger,
  });
  const step: RoutedStep = {
    id: "test-deny-shell-operator",
    path: "command",
    action: "execute_command",
    params: { command: "echo ok && rm -rf /tmp/browser-control-test" },
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

test("requires confirmation for confirmation-listed commands after shell operators", () => {
  const mockLogger = new Logger({ component: "test", level: "info" });
  const policyEngine = new DefaultPolicyEngine({
    profileName: "balanced",
    logger: mockLogger,
  });
  const step: RoutedStep = {
    id: "test-confirm-shell-operator",
    path: "command",
    action: "execute_command",
    params: { command: "echo ok && npm install package" },
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

test("filesystem allowed roots canonicalize paths and validate move destination", () => {
  const allowed = process.platform === "win32" ? "C:\\allowed" : "/tmp/allowed";
  const outside = process.platform === "win32" ? "C:\\outside\\file.txt" : "/tmp/outside/file.txt";
  const traversal = process.platform === "win32"
    ? "C:\\allowed\\../\outside\\file.txt"
    : "/tmp/allowed/../outside/file.txt";
  const policyEngine = new DefaultPolicyEngine({
    customProfile: {
      ...TRUSTED_PROFILE,
      name: "trusted",
      filesystemPolicy: {
        ...TRUSTED_PROFILE.filesystemPolicy,
        allowedReadRoots: [allowed],
        allowedWriteRoots: [allowed],
        allowedDeleteRoots: [allowed],
      },
    },
  });

  const traversalResult = policyEngine.evaluate({
    id: "fs-traversal",
    path: "command",
    action: "fs_write",
    params: { path: traversal },
    risk: "high",
    sessionId: "test-session",
  });
  assert.equal(traversalResult.decision, "deny");
  assert.equal(traversalResult.matchedRule, "allowedWriteRoots");

  const moveResult = policyEngine.evaluate({
    id: "fs-move",
    path: "command",
    action: "fs_move",
    params: { src: `${allowed}/source.txt`, dst: outside },
    risk: "high",
    sessionId: "test-session",
  });
  assert.equal(moveResult.decision, "deny");
  assert.equal(moveResult.matchedRule, "allowedWriteRoots");
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
