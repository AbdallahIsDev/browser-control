import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  successResult,
  failureResult,
  policyDeniedResult,
  confirmationRequiredResult,
  formatActionResult,
  type ActionResult,
} from "../../src/action_result";

describe("ActionResult", () => {
  describe("successResult", () => {
    it("creates a successful result with data", () => {
      const result = successResult({ url: "https://example.com", title: "Example" }, {
        path: "a11y",
        sessionId: "sess-1",
      });

      assert.equal(result.success, true);
      assert.equal(result.path, "a11y");
      assert.equal(result.sessionId, "sess-1");
      assert.deepEqual(result.data, { url: "https://example.com", title: "Example" });
      assert.equal(result.error, undefined);
      assert.ok(result.completedAt);
    });

    it("includes optional fields when provided", () => {
      const result = successResult("ok", {
        path: "command",
        sessionId: "sess-2",
        warning: "deprecated",
        auditId: "audit-123",
        policyDecision: "allow",
        risk: "low",
      });

      assert.equal(result.warning, "deprecated");
      assert.equal(result.auditId, "audit-123");
      assert.equal(result.policyDecision, "allow");
      assert.equal(result.risk, "low");
    });

    it("omits optional fields when not provided", () => {
      const result = successResult(42, { path: "a11y", sessionId: "s" });

      assert.equal(result.warning, undefined);
      assert.equal(result.auditId, undefined);
      assert.equal(result.policyDecision, undefined);
      assert.equal(result.risk, undefined);
    });
  });

  describe("failureResult", () => {
    it("creates a failure result with error message", () => {
      const result = failureResult("Something went wrong", {
        path: "command",
        sessionId: "sess-3",
      });

      assert.equal(result.success, false);
      assert.equal(result.error, "Something went wrong");
      assert.equal(result.data, undefined);
      assert.ok(result.completedAt);
    });

    it("includes optional audit and policy fields", () => {
      const result = failureResult("timeout", {
        path: "a11y",
        sessionId: "s",
        auditId: "audit-456",
        policyDecision: "deny",
        risk: "high",
      });

      assert.equal(result.auditId, "audit-456");
      assert.equal(result.policyDecision, "deny");
      assert.equal(result.risk, "high");
    });
  });

  describe("policyDeniedResult", () => {
    it("creates a policy-denied result", () => {
      const result = policyDeniedResult("Action not allowed under safe profile", {
        path: "command",
        sessionId: "sess-4",
        risk: "high",
      });

      assert.equal(result.success, false);
      assert.equal(result.policyDecision, "deny");
      assert.ok(result.error?.includes("Policy denied"));
      assert.ok(result.error?.includes("Action not allowed under safe profile"));
      assert.equal(result.risk, "high");
    });
  });

  describe("confirmationRequiredResult", () => {
    it("creates a confirmation-required result", () => {
      const result = confirmationRequiredResult("This action requires human approval", {
        path: "a11y",
        sessionId: "sess-5",
        risk: "moderate",
      });

      assert.equal(result.success, false);
      assert.equal(result.policyDecision, "require_confirmation");
      assert.ok(result.error?.includes("Confirmation required"));
      assert.ok(result.error?.includes("This action requires human approval"));
      assert.equal(result.risk, "moderate");
    });
  });

  describe("formatActionResult", () => {
    it("formats a success result as a plain object", () => {
      const result = successResult({ count: 5 }, { path: "a11y", sessionId: "s" });
      const formatted = formatActionResult(result);

      assert.equal(formatted.success, true);
      assert.equal(formatted.path, "a11y");
      assert.equal(formatted.sessionId, "s");
      assert.deepEqual(formatted.data, { count: 5 });
      assert.ok(formatted.completedAt);
    });

    it("formats a failure result, omitting undefined optional fields", () => {
      const result = failureResult("oops", { path: "command", sessionId: "s" });
      const formatted = formatActionResult(result);

      assert.equal(formatted.success, false);
      assert.equal(formatted.error, "oops");
      assert.equal(formatted.data, undefined);
      assert.equal(formatted.warning, undefined);
      assert.equal(formatted.auditId, undefined);
    });

    it("includes all fields when present", () => {
      const result = successResult("yay", {
        path: "a11y",
        sessionId: "s",
        warning: "watch out",
        auditId: "a1",
        policyDecision: "allow",
        risk: "low",
      });
      const formatted = formatActionResult(result);

      assert.equal(formatted.warning, "watch out");
      assert.equal(formatted.auditId, "a1");
      assert.equal(formatted.policyDecision, "allow");
      assert.equal(formatted.risk, "low");
    });
  });

  describe("ActionResult generic type", () => {
    it("preserves data type through successResult", () => {
      const result: ActionResult<{ items: string[] }> = successResult(
        { items: ["a", "b"] },
        { path: "a11y", sessionId: "s" },
      );

      assert.deepEqual(result.data?.items, ["a", "b"]);
    });

    it("preserves generic type through failureResult", () => {
      const result: ActionResult<number> = failureResult("fail", {
        path: "command",
        sessionId: "s",
      });

      assert.equal(result.success, false);
      assert.equal(result.data, undefined);
    });
  });
});
