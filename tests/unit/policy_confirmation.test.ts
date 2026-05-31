import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { DefaultPolicyEngine } from "../../src/policy/engine";
import { SessionManager, isPolicyAllowed } from "../../src/session_manager";
import { MemoryStore } from "../../src/runtime/memory_store";

test("DefaultPolicyEngine invokes confirmation handler for confirmation decisions", async () => {
  const policyEngine = new DefaultPolicyEngine({ profileName: "balanced" });
  let called = false;

  policyEngine.setConfirmationHandler({
    confirm: async (_step, evaluation, context) => {
      called = true;
      assert.equal(evaluation.decision, "require_confirmation");
      assert.equal(context.sessionId, "confirm-session");
      return true;
    },
  });

  const result = await policyEngine.evaluateWithConfirmation(
    {
      id: "confirm-delete-action",
      path: "command",
      action: "fs_delete",
      params: { path: path.join(os.tmpdir(), "bc-confirm-delete"), recursive: true },
      risk: "high",
      sessionId: "confirm-session",
    },
    { sessionId: "confirm-session", actor: "human" },
  );

  assert.equal(called, true);
  assert.equal(result.decision, "allow_with_audit");
  assert.match(result.reason, /Confirmed by user/);
});

test("DefaultPolicyEngine denies when confirmation handler rejects", async () => {
  const policyEngine = new DefaultPolicyEngine({ profileName: "balanced" });

  policyEngine.setConfirmationHandler({
    confirm: async () => false,
  });

  const result = await policyEngine.evaluateWithConfirmation({
    id: "reject-delete-action",
    path: "command",
    action: "fs_delete",
    params: { path: path.join(os.tmpdir(), "bc-reject-delete"), recursive: true },
    risk: "high",
    sessionId: "reject-session",
  });

  assert.equal(result.decision, "deny");
  assert.match(result.reason, /Confirmation rejected/);
});

test("SessionManager evaluateActionWithConfirmation wires confirmation handler", async () => {
  const store = new MemoryStore({ filename: ":memory:" });
  const manager = new SessionManager({ memoryStore: store });

  try {
    await manager.create("confirm-actions", {
      policyProfile: "balanced",
      workingDirectory: os.tmpdir(),
    });
    const activeSession = manager.getActiveSession();
    assert.ok(activeSession);

    const target = path.join(activeSession.runtimeDir, "recursive-delete");
    const blocked = manager.evaluateAction("fs_delete", {
      path: target,
      recursive: true,
    });
    assert.equal(isPolicyAllowed(blocked), false);
    assert.equal(blocked.policyDecision, "require_confirmation");

    manager.setConfirmationHandler({
      confirm: async (_step, evaluation) => {
        assert.equal(evaluation.decision, "require_confirmation");
        return true;
      },
    });

    const confirmed = await manager.evaluateActionWithConfirmation("fs_delete", {
      path: target,
      recursive: true,
    });

    assert.equal(isPolicyAllowed(confirmed), true);
    if (isPolicyAllowed(confirmed)) {
      assert.equal(confirmed.policyDecision, "allow_with_audit");
    }
  } finally {
    manager.close();
    store.close();
  }
});
