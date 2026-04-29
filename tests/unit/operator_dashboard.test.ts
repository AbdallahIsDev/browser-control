import { describe, it } from "node:test";
import * as assert from "node:assert";
import { getDashboardState } from "../../src/operator/dashboard";
import { validateUiSpec, dispatchUiAction } from "../../src/operator/generated_ui";

describe("Dashboard State", () => {
  it("collects system status including derived sections", async () => {
    const state = await getDashboardState({
      env: { BROWSER_CONTROL_DATA_DIR: "/tmp/fake" }
    });
    assert.ok(state.system);
    assert.ok(state.system.daemon);
    assert.ok(state.system.terminal);
    assert.ok(state.system.tasks);
    assert.ok(state.system.services);
    assert.ok(Array.isArray(state.events));
    assert.strictEqual(state.events.length, 0, "Events array should be bounded and initially empty per TODO");
    
    assert.ok(state.summary);
    assert.ok(state.browsers);
    assert.ok(state.terminals);
    assert.ok(state.tasks);
    assert.ok(state.services);
  });
});

describe("Generated UI Spec Validation", () => {
  it("validates valid spec", () => {
    const validSpec = {
      version: "1.0",
      packageName: "test-pkg",
      components: [
        { type: "panel", props: { title: "Main" } }
      ],
      actions: {
        "test-pkg:run": { description: "run action" }
      }
    };

    const spec = validateUiSpec(validSpec);
    assert.strictEqual(spec.packageName, "test-pkg");
    assert.strictEqual(spec.components[0].type, "panel");
  });

  it("validates button with properly declared actionId", () => {
    const validSpec = {
      version: "1.0",
      packageName: "test-pkg",
      components: [
        { type: "button", props: { label: "Click", actionId: "test-pkg:run" } }
      ],
      actions: {
        "test-pkg:run": { description: "run action" }
      }
    };
    assert.doesNotThrow(() => validateUiSpec(validSpec));
  });

  it("rejects button referencing undeclared actionId", () => {
    const invalidSpec = {
      version: "1.0",
      packageName: "test-pkg",
      components: [
        { type: "button", props: { label: "Click", actionId: "undeclared" } }
      ],
      actions: {
        "test-pkg:run": { description: "run action" }
      }
    };
    assert.throws(() => validateUiSpec(invalidSpec), /undeclared actionId: undeclared/);
  });

  it("rejects unknown components", () => {
    const invalidSpec = {
      version: "1.0",
      packageName: "test-pkg",
      components: [
        { type: "evalJs", script: "alert(1)" }
      ],
      actions: {}
    };

    assert.throws(() => validateUiSpec(invalidSpec));
  });

  it("rejects unsafe props and unknown keys due to strict schemas", () => {
    const invalidSpec = {
      version: "1.0",
      packageName: "test-pkg",
      components: [
        { type: "button", props: { label: "Click", actionId: "run", onClick: "alert(1)" } }
      ],
      actions: {
        run: { actionId: "run" }
      }
    };

    assert.throws(() => validateUiSpec(invalidSpec), /Unrecognized key\(s\) in object: 'onClick'/);
  });

  it("rejects arbitrary style and className props", () => {
    const invalidSpec = {
      version: "1.0",
      packageName: "test-pkg",
      components: [
        { type: "panel", props: { style: { color: "red" }, className: "my-class" } }
      ],
      actions: {}
    };

    assert.throws(() => validateUiSpec(invalidSpec), /Unrecognized key\(s\) in object: 'style', 'className'/);
  });

  it("accepts a normal nested UI tree under the child limit", () => {
    const validSpec = {
      version: "1.0",
      packageName: "test-pkg",
      components: [
        {
          type: "panel",
          children: Array.from({ length: 40 }, () => ({ type: "log" }))
        }
      ],
      actions: {}
    };
    assert.doesNotThrow(() => validateUiSpec(validSpec));
  });

  it("rejects a node with too many children", () => {
    const invalidSpec = {
      version: "1.0",
      packageName: "test-pkg",
      components: [
        {
          type: "panel",
          children: Array.from({ length: 51 }, () => ({ type: "log" }))
        }
      ],
      actions: {}
    };
    assert.throws(() => validateUiSpec(invalidSpec), /too_big/i);
  });

  it("rejects too-deep nesting", () => {
    let deepNode: any = { type: "log" };
    for (let i = 0; i < 15; i++) {
      deepNode = { type: "panel", children: [deepNode] };
    }

    const invalidSpec = {
      version: "1.0",
      packageName: "test-pkg",
      components: [deepNode],
      actions: {}
    };

    assert.throws(() => validateUiSpec(invalidSpec));
  });
});

describe("Safe Action Routing", () => {
  it("requires approval for dangerous actions", async () => {
    const spec = {
      version: "1.0",
      packageName: "test-pkg",
      components: [],
      actions: {
        dangerous_run: { requiresApproval: true }
      }
    };

    const result = await dispatchUiAction(spec, "dangerous_run", {}, async () => {
      return { success: true, path: "command", sessionId: "system", completedAt: "" };
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.policyDecision, "require_confirmation");
  });

  it("fails if action is not declared", async () => {
    const spec = {
      version: "1.0",
      packageName: "test-pkg",
      components: [],
      actions: {}
    };

    const result = await dispatchUiAction(spec, "undeclared_action", {}, async () => {
      return { success: true, path: "command", sessionId: "system", completedAt: "" };
    });

    assert.strictEqual(result.success, false);
    assert.match(result.error || "", /Invalid UI spec|not declared in UI spec/);
  });
});
