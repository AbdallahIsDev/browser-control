/**
 * Recovery Guidance Tests — Verify failure classification and guidance generation.
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import {
  classifyFailure,
  generateRecoveryGuidance,
  isRetryRecommended,
  getAlternativePath,
  formatGuidance,
} from "../../../src/observability/recovery";

describe("classifyFailure", () => {
  it("classifies CDP unavailable", () => {
    const category = classifyFailure("CDP port 9222 is not reachable");
    assert.strictEqual(category, "cdp_unavailable");
  });

  it("classifies browser disconnected", () => {
    const category = classifyFailure("Browser has been closed");
    assert.strictEqual(category, "browser_disconnected");
  });

  it("classifies policy denied", () => {
    const category = classifyFailure("Policy denied: fs_delete");
    assert.strictEqual(category, "policy_denied");
  });

  it("classifies terminal timeout", () => {
    const category = classifyFailure("Command execution timed out");
    assert.strictEqual(category, "terminal_timeout");
  });

  it("classifies terminal dead", () => {
    const category = classifyFailure("Terminal session not found: xyz");
    assert.strictEqual(category, "terminal_dead");
  });

  it("classifies fs permission", () => {
    const category = classifyFailure("EACCES: permission denied");
    assert.strictEqual(category, "fs_permission");
  });

  it("returns unknown for unrecognized errors", () => {
    const category = classifyFailure("Something weird happened");
    assert.strictEqual(category, "unknown");
  });
});

describe("generateRecoveryGuidance", () => {
  it("says retry for CDP unavailable", () => {
    const guidance = generateRecoveryGuidance("CDP port not reachable");
    assert.strictEqual(guidance.canRetry, true);
    assert(guidance.retryReason);
    assert(guidance.alternativePath);
  });

  it("says no retry for policy denied", () => {
    const guidance = generateRecoveryGuidance("Policy denied");
    assert.strictEqual(guidance.canRetry, false);
    assert.strictEqual(guidance.requiresConfirmation, true);
  });

  it("says human needed for unknown", () => {
    const guidance = generateRecoveryGuidance("Something weird");
    assert.strictEqual(guidance.canRetry, true);
    assert.strictEqual(guidance.requiresHuman, true);
    assert(guidance.humanReason);
  });

  it("includes suggested action", () => {
    const guidance = generateRecoveryGuidance("Terminal session not found");
    assert(guidance.suggestedAction);
  });
});

describe("isRetryRecommended", () => {
  it("returns true for retryable errors", () => {
    assert.strictEqual(isRetryRecommended("CDP unavailable"), true);
  });

  it("returns false for non-retryable errors", () => {
    assert.strictEqual(isRetryRecommended("Policy denied"), false);
  });
});

describe("getAlternativePath", () => {
  it("suggests command path for CDP failure", () => {
    const path = getAlternativePath("CDP port 9222 is not reachable");
    assert.strictEqual(path, "command");
  });
});

describe("formatGuidance", () => {
  it("formats retry guidance", () => {
    const guidance = generateRecoveryGuidance("CDP port 9222 is not reachable");
    const text = formatGuidance(guidance);
    assert(text.includes("Retry:"));
    assert(text.includes("Alternative path:"));
  });

  it("formats confirmation guidance", () => {
    const guidance = generateRecoveryGuidance("Policy denied");
    const text = formatGuidance(guidance);
    assert(text.includes("Confirmation required:"));
  });
});