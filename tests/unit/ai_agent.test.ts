import assert from "node:assert/strict";
import test from "node:test";
import type { Page } from "playwright";

import { AIAgent, GuardrailError } from "../../ai_agent";
import type { AIGuardrails } from "../../ai_agent";
import { loadConfig } from "../../config";

/** Create a minimal mock page for testing */
function createMockPage(overrides: Record<string, unknown> = {}): Page {
  return {
    url: () => "https://example.com/app",
    title: async () => "Example App",
    evaluate: async () => ({
      buttons: ["Continue"],
      inputs: [],
      links: [],
      forms: 0,
      textSnippets: ["Ready"],
      candidateSelectors: [
        {
          selector: "#continue",
          text: "Continue",
          type: "button",
        },
      ],
    }),
    locator: () => ({
      first: () => ({
        click: async () => {},
        fill: async (_value: string) => {},
        press: async (_key: string) => {},
      }),
    }),
    keyboard: {
      press: async (_key: string) => {},
    },
    ...overrides,
  } as unknown as Page;
}

test("observeAndDescribe returns structured page details", async () => {
  const page = {
    url: () => "https://example.com/app",
    title: async () => "Example App",
    evaluate: async () => ({
      buttons: ["Submit", "Cancel"],
      inputs: ["Email"],
      links: ["Dashboard"],
      forms: 1,
      textSnippets: ["Welcome back"],
    }),
  } as unknown as Page;

  const agent = new AIAgent({
    apiKey: "test-key",
    decide: async () => ({
      action: "done",
      rationale: "unused",
    }),
  });

  const description = await agent.observeAndDescribe(page);

  assert.equal(description.url, "https://example.com/app");
  assert.equal(description.title, "Example App");
  assert.deepEqual(description.buttons, ["Submit", "Cancel"]);
});

test("findElement returns the selector chosen by the model", async () => {
  const page = {
    url: () => "https://example.com/app",
    title: async () => "Example App",
    evaluate: async () => ({
      buttons: ["Submit"],
      inputs: [],
      links: [],
      forms: 0,
      textSnippets: [],
      candidateSelectors: [
        {
          selector: "#submit-button",
          text: "Submit",
          type: "button",
        },
      ],
    }),
  } as unknown as Page;

  const agent = new AIAgent({
    apiKey: "test-key",
    decide: async () => ({
      action: "locate",
      selector: "#submit-button",
      rationale: "Matches the only submit button",
    }),
  });

  const selector = await agent.findElement(page, "the submit button");

  assert.equal(selector, "#submit-button");
});

test("executeGoal loops through decisions, executes actions, and logs them", async () => {
  const actions: string[] = [];
  let decisionCount = 0;

  const page = createMockPage({
    locator: () => ({
      first: () => ({
        click: async () => {
          actions.push("click");
        },
        fill: async (value: string) => {
          actions.push(`fill:${value}`);
        },
        press: async (key: string) => {
          actions.push(`press:${key}`);
        },
      }),
    }),
    keyboard: {
      press: async (key: string) => {
        actions.push(`keyboard:${key}`);
      },
    },
  });

  const agent = new AIAgent({
    apiKey: "test-key",
    decide: async () => {
      decisionCount += 1;
      if (decisionCount === 1) {
        return {
          action: "click",
          selector: "#continue",
          rationale: "Advance the goal",
        };
      }

      return {
        action: "done",
        rationale: "Goal reached",
      };
    },
  });

  const result = await agent.executeGoal("Continue the flow", page, 3);

  assert.equal(result.success, true);
  assert.deepEqual(actions, ["click"]);
  assert.equal(agent.getDecisionLog().length, 2);
});

test("dryRun mode logs decisions without executing actions", async () => {
  const actions: string[] = [];

  const page = createMockPage({
    locator: () => ({
      first: () => ({
        click: async () => {
          actions.push("click");
        },
        fill: async (value: string) => {
          actions.push(`fill:${value}`);
        },
        press: async (key: string) => {
          actions.push(`press:${key}`);
        },
      }),
    }),
  });

  const guardrails: AIGuardrails = { dryRun: true };
  let decisionCount = 0;

  const agent = new AIAgent({
    apiKey: "test-key",
    guardrails,
    decide: async () => {
      decisionCount += 1;
      if (decisionCount === 1) {
        return {
          action: "click",
          selector: "#continue",
          rationale: "Advance the goal",
        };
      }
      return {
        action: "fill",
        selector: "#email",
        value: "test@example.com",
        rationale: "Fill email",
      };
    },
  });

  const result = await agent.executeGoal("Test dry run", page, 3);

  assert.equal(result.success, false); // Didn't reach "done"
  assert.deepEqual(actions, []); // No actual actions executed
  assert.equal(result.decisions.length, 3); // But decisions are still logged
});

test("allowedActions throws GuardrailError for disallowed actions", async () => {
  const page = createMockPage();

  const agent = new AIAgent({
    apiKey: "test-key",
    guardrails: { allowedActions: ["click"] },
    decide: async () => ({
      action: "fill",
      selector: "#email",
      value: "test@example.com",
      rationale: "Fill email field",
    }),
  });

  await assert.rejects(
    () => agent.executeGoal("Test allowed actions", page, 1),
    (error: unknown) => {
      assert.ok(error instanceof GuardrailError);
      assert.equal((error as GuardrailError).rule, "allowedActions");
      assert.ok((error as Error).message.includes("fill"));
      return true;
    },
  );
});

test("deniedSelectors throws GuardrailError when selector matches", async () => {
  const page = createMockPage();

  const agent = new AIAgent({
    apiKey: "test-key",
    guardrails: { deniedSelectors: ["#delete"] },
    decide: async () => ({
      action: "click",
      selector: "#delete",
      rationale: "Delete item",
    }),
  });

  await assert.rejects(
    () => agent.executeGoal("Test denied selectors", page, 1),
    (error: unknown) => {
      assert.ok(error instanceof GuardrailError);
      assert.equal((error as GuardrailError).rule, "deniedSelectors");
      return true;
    },
  );
});

test("deniedSelectors supports regex patterns", async () => {
  const page = createMockPage();

  const agent = new AIAgent({
    apiKey: "test-key",
    guardrails: { deniedSelectors: ["/\\#dangerous-.+/i"] },
    decide: async () => ({
      action: "click",
      selector: "#dangerous-button",
      rationale: "Click dangerous button",
    }),
  });

  await assert.rejects(
    () => agent.executeGoal("Test regex denied selectors", page, 1),
    (error: unknown) => {
      assert.ok(error instanceof GuardrailError);
      assert.equal((error as GuardrailError).rule, "deniedSelectors");
      return true;
    },
  );
});

test("deniedSelectors substring match works", async () => {
  const page = createMockPage();

  const agent = new AIAgent({
    apiKey: "test-key",
    guardrails: { deniedSelectors: ["delete"] },
    decide: async () => ({
      action: "click",
      selector: "#btn-delete-confirm",
      rationale: "Delete",
    }),
  });

  await assert.rejects(
    () => agent.executeGoal("Test substring denied", page, 1),
    (error: unknown) => {
      assert.ok(error instanceof GuardrailError);
      assert.equal((error as GuardrailError).rule, "deniedSelectors");
      return true;
    },
  );
});

test("JSON parse retry succeeds after transient failures", async () => {
  const page = createMockPage();
  let callCount = 0;

  const mockFetch: typeof fetch = async () => {
    callCount += 1;
    if (callCount === 1) {
      // First call returns invalid JSON
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "not json at all" } }],
        }),
      } as Response;
    }
    // Second call returns valid JSON
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                action: "done",
                rationale: "Retry succeeded",
              }),
            },
          },
        ],
      }),
    } as Response;
  };

  const agent = new AIAgent({
    apiKey: "test-key",
    fetchImpl: mockFetch,
  });

  const result = await agent.executeGoal("Test JSON retry", page, 1);

  assert.equal(result.success, true);
  assert.equal(callCount, 2); // First call failed, second succeeded
  assert.equal(result.decisions[0].rationale, "Retry succeeded");
});

test("JSON parse fails after 3 attempts", async () => {
  const page = createMockPage();
  let callCount = 0;

  const mockFetch: typeof fetch = async () => {
    callCount += 1;
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "always invalid json" } }],
      }),
    } as Response;
  };

  const agent = new AIAgent({
    apiKey: "test-key",
    fetchImpl: mockFetch,
  });

  await assert.rejects(
    () => agent.executeGoal("Test JSON retry exhaustion", page, 1),
    (error: unknown) => {
      assert.ok((error as Error).message.includes("Failed to parse decision after 3 attempts"));
      return true;
    },
  );

  assert.equal(callCount, 3); // All 3 attempts were made
});

test("cost tracking accumulates tokens and cost", async () => {
  const page = createMockPage();
  let decisionCount = 0;

  const mockFetch: typeof fetch = async () => {
    decisionCount += 1;
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                action: decisionCount < 2 ? "click" : "done",
                selector: "#continue",
                rationale: decisionCount < 2 ? "Continue" : "Done",
              }),
            },
          },
        ],
        usage: { total_tokens: 100 },
      }),
    } as Response;
  };

  const agent = new AIAgent({
    apiKey: "test-key",
    fetchImpl: mockFetch,
  });

  await agent.executeGoal("Test cost tracking", page, 5);

  assert.ok(agent.getTotalTokens() > 0, "Total tokens should be tracked");
  assert.ok(agent.getEstimatedCostUsd() > 0, "Estimated cost should be tracked");
  // 2 calls x 100 tokens = 200 tokens x 0.0001 = 0.02
  assert.equal(agent.getTotalTokens(), 200);
  assert.ok(Math.abs(agent.getEstimatedCostUsd() - 0.02) < 0.001);
});

test("cost cap throws GuardrailError when exceeded", async () => {
  const page = createMockPage();
  let callCount = 0;

  const mockFetch: typeof fetch = async () => {
    callCount += 1;
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                action: "click",
                selector: "#continue",
                rationale: "Continue",
              }),
            },
          },
        ],
        usage: { total_tokens: 100000 },
      }),
    } as Response;
  };

  const agent = new AIAgent({
    apiKey: "test-key",
    fetchImpl: mockFetch,
    guardrails: { maxCostPerGoalUsd: 0.001 },
  });

  // First call: 100000 tokens * 0.0001 = $10 > 0.001, so it should fail on the second loop iteration
  await assert.rejects(
    () => agent.executeGoal("Test cost cap", page, 10),
    (error: unknown) => {
      assert.ok(error instanceof GuardrailError);
      assert.equal((error as GuardrailError).rule, "maxCostPerGoalUsd");
      return true;
    },
  );
});

test("requireConfirmation throws GuardrailError for destructive click actions", async () => {
  const page = createMockPage({
    locator: () => ({
      first: () => ({
        click: async () => {},
        fill: async () => {},
        press: async () => {},
      }),
    }),
  });

  const agent = new AIAgent({
    apiKey: "test-key",
    guardrails: { requireConfirmation: true },
    decide: async () => ({
      action: "click",
      selector: "#submit-order",
      rationale: "Submit the order",
    }),
  });

  await assert.rejects(
    () => agent.executeGoal("Test confirmation", page, 3),
    (error: unknown) => {
      assert.ok(error instanceof GuardrailError);
      assert.equal((error as GuardrailError).rule, "requireConfirmation");
      return true;
    },
  );
});

test("requireConfirmation throws GuardrailError for destructive fill actions", async () => {
  const page = createMockPage({
    locator: () => ({
      first: () => ({
        click: async () => {},
        fill: async () => {},
        press: async () => {},
      }),
    }),
  });

  const agent = new AIAgent({
    apiKey: "test-key",
    guardrails: { requireConfirmation: true },
    decide: async () => ({
      action: "fill",
      selector: "#credit-card-number",
      value: "4111111111111111",
      rationale: "Enter card number",
    }),
  });

  await assert.rejects(
    () => agent.executeGoal("Test confirmation fill", page, 3),
    (error: unknown) => {
      assert.ok(error instanceof GuardrailError);
      assert.equal((error as GuardrailError).rule, "requireConfirmation");
      return true;
    },
  );
});

test("requireConfirmation does not block safe actions", async () => {
  const actions: string[] = [];

  const page = createMockPage({
    locator: () => ({
      first: () => ({
        click: async () => {
          actions.push("click");
        },
        fill: async (value: string) => {
          actions.push(`fill:${value}`);
        },
        press: async (_key: string) => {},
      }),
    }),
  });

  let decisionCount = 0;
  const agent = new AIAgent({
    apiKey: "test-key",
    guardrails: { requireConfirmation: true },
    decide: async () => {
      decisionCount += 1;
      if (decisionCount === 1) {
        return {
          action: "click",
          selector: "#continue",
          rationale: "Safe click",
        };
      }
      return {
        action: "done",
        rationale: "Finished",
      };
    },
  });

  const result = await agent.executeGoal("Test safe action with confirmation", page, 3);

  assert.equal(result.success, true);
  assert.deepEqual(actions, ["click"]); // Safe click was executed
});

test("maxSteps guardrail limits execution steps", async () => {
  let decisionCount = 0;

  const page = createMockPage();

  const agent = new AIAgent({
    apiKey: "test-key",
    guardrails: { maxSteps: 2 },
    decide: async () => {
      decisionCount += 1;
      return {
        action: "click",
        selector: "#continue",
        rationale: "Keep going",
      };
    },
  });

  const result = await agent.executeGoal("Test maxSteps", page, 10);

  // Should stop at 2 steps (guardrail limit), not 10
  assert.equal(result.steps, 2);
  assert.equal(result.success, false);
  assert.equal(decisionCount, 2);
});

test("maxSteps uses lower of guardrail and argument", async () => {
  let decisionCount = 0;

  const page = createMockPage();

  const agent = new AIAgent({
    apiKey: "test-key",
    guardrails: { maxSteps: 5 },
    decide: async () => {
      decisionCount += 1;
      return {
        action: "click",
        selector: "#continue",
        rationale: "Keep going",
      };
    },
  });

  // Guardrail says 5, argument says 3 -> should use 3
  const result = await agent.executeGoal("Test maxSteps lower bound", page, 3);

  assert.equal(result.steps, 3);
  assert.equal(decisionCount, 3);
});

test("GuardrailError has correct name and rule", () => {
  const error = new GuardrailError("Test message", "testRule");
  assert.equal(error.name, "GuardrailError");
  assert.equal(error.rule, "testRule");
  assert.equal(error.message, "Test message");
  assert.ok(error instanceof Error);
  assert.ok(error instanceof GuardrailError);
});

test("allowedActions permits allowed action", async () => {
  const actions: string[] = [];

  const page = createMockPage({
    locator: () => ({
      first: () => ({
        click: async () => {
          actions.push("click");
        },
        fill: async (_value: string) => {},
        press: async (_key: string) => {},
      }),
    }),
  });

  let decisionCount = 0;
  const agent = new AIAgent({
    apiKey: "test-key",
    guardrails: { allowedActions: ["click", "done"] },
    decide: async () => {
      decisionCount += 1;
      if (decisionCount === 1) {
        return {
          action: "click",
          selector: "#continue",
          rationale: "Click is allowed",
        };
      }
      return {
        action: "done",
        rationale: "Done is allowed",
      };
    },
  });

  const result = await agent.executeGoal("Test allowed action", page, 3);

  assert.equal(result.success, true);
  assert.deepEqual(actions, ["click"]);
});

// ── Config integration ──────────────────────────────────────────────────

test("AIAgent uses loadConfig() fallback for apiKey, model, baseUrl, costPerToken", () => {
  const agent = new AIAgent({
    config: loadConfig({
      env: {
        OPENROUTER_API_KEY: "config-key",
        OPENROUTER_MODEL: "config-model",
        OPENROUTER_BASE_URL: "https://config.example.com/api/v1",
        AI_AGENT_COST_PER_TOKEN: "0.0005",
      },
      validate: false,
    }),
  });

  assert.equal(agent["apiKey"], "config-key");
  assert.equal(agent["model"], "config-model");
  assert.equal(agent["baseUrl"], "https://config.example.com/api/v1");
  assert.equal(agent["costPerToken"], 0.0005);
});

test("AIAgent explicit options override config values", () => {
  const agent = new AIAgent({
    apiKey: "explicit-key",
    model: "explicit-model",
    baseUrl: "https://explicit.example.com/api/v1",
    costPerToken: 0.002,
    config: loadConfig({
      env: {
        OPENROUTER_API_KEY: "config-key",
        OPENROUTER_MODEL: "config-model",
        OPENROUTER_BASE_URL: "https://config.example.com/api/v1",
        AI_AGENT_COST_PER_TOKEN: "0.0005",
      },
      validate: false,
    }),
  });

  assert.equal(agent["apiKey"], "explicit-key");
  assert.equal(agent["model"], "explicit-model");
  assert.equal(agent["baseUrl"], "https://explicit.example.com/api/v1");
  assert.equal(agent["costPerToken"], 0.002);
});

test("AIAgent costPerToken option overrides config default", () => {
  const agent = new AIAgent({
    apiKey: "test-key",
    costPerToken: 0.003,
    config: loadConfig({
      env: { OPENROUTER_API_KEY: "config-key" },
      validate: false,
    }),
  });

  assert.equal(agent["costPerToken"], 0.003);
});

test("cost estimation uses prompt length when usage is not provided", async () => {
  const page = createMockPage();
  let callCount = 0;

  const mockFetch: typeof fetch = async () => {
    callCount += 1;
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                action: callCount < 2 ? "click" : "done",
                selector: "#continue",
                rationale: "Test",
              }),
            },
          },
        ],
        // No usage field — should fall back to estimation
      }),
    } as Response;
  };

  const agent = new AIAgent({
    apiKey: "test-key",
    fetchImpl: mockFetch,
  });

  await agent.executeGoal("Test cost estimation fallback", page, 5);

  assert.ok(agent.getTotalTokens() > 0, "Tokens should be estimated from prompt + response length");
  assert.ok(agent.getEstimatedCostUsd() > 0, "Cost should be estimated");
});
