import { describe, it } from "node:test";
import * as assert from "node:assert";
import { MemoryStore } from "../../src/runtime/memory_store";
import { WorkflowStore } from "../../src/workflows/store";
import { WorkflowRuntime } from "../../src/workflows/runtime";
import { validateWorkflowGraph } from "../../src/workflows/types";
import type { WorkflowGraph } from "../../src/workflows/types";
import { createBrowserControl } from "../../src/browser_control";

function makeStore() {
  return new MemoryStore({ filename: ":memory:" });
}

function makeGraph(overrides: Partial<WorkflowGraph> = {}): WorkflowGraph {
  return {
    id: "test-graph",
    name: "Test Workflow",
    version: "1.0",
    nodes: [
      { id: "step1", kind: "terminal", input: { command: "echo hello" } },
      { id: "step2", kind: "assertion", input: { expression: "true", expected: "true" } },
    ],
    edges: [{ from: "step1", to: "step2" }],
    ...overrides,
  };
}

describe("Workflow Graph Validation", () => {
  it("validates a correct graph", () => {
    const result = validateWorkflowGraph(makeGraph());
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.errors.length, 0);
  });

  it("rejects graph with no nodes", () => {
    const result = validateWorkflowGraph(makeGraph({ nodes: [] }));
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes("at least one node")));
  });

  it("rejects graph with invalid node kind", () => {
    const result = validateWorkflowGraph(makeGraph({
      nodes: [{ id: "bad", kind: "unknown" as any, input: {} }],
    }));
    assert.strictEqual(result.valid, false);
  });

  it("rejects malformed graph shapes without throwing", () => {
    const result = validateWorkflowGraph({ id: "bad", nodes: "not-array", edges: [] });
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes("at least one node")));
  });

  it("rejects edge referencing unknown node", () => {
    const result = validateWorkflowGraph(makeGraph({
      edges: [{ from: "step1", to: "nonexistent" }],
    }));
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes("nonexistent")));
  });

  it("rejects cycles and unsupported branching", () => {
    const cycle = validateWorkflowGraph(makeGraph({
      nodes: [
        { id: "a", kind: "assertion", input: { expression: "1", expected: "1" } },
        { id: "b", kind: "assertion", input: { expression: "1", expected: "1" } },
      ],
      edges: [{ from: "a", to: "b" }, { from: "b", to: "a" }],
    }));
    assert.strictEqual(cycle.valid, false);
    assert.ok(cycle.errors.some(e => e.includes("cycle")));

    const branch = validateWorkflowGraph(makeGraph({
      nodes: [
        { id: "a", kind: "assertion", input: { expression: "1", expected: "1" } },
        { id: "b", kind: "assertion", input: { expression: "1", expected: "1" } },
        { id: "c", kind: "assertion", input: { expression: "1", expected: "1" } },
      ],
      edges: [{ from: "a", to: "b" }, { from: "a", to: "c" }],
    }));
    assert.strictEqual(branch.valid, true);
    // v2 allows branching
  });
});

describe("Workflow Store", () => {
  it("persists and retrieves graphs", () => {
    const ms = makeStore();
    const store = new WorkflowStore(ms);
    const graph = makeGraph();

    store.saveGraph(graph);
    const loaded = store.getGraph("test-graph");
    assert.ok(loaded);
    assert.strictEqual(loaded.name, "Test Workflow");

    const list = store.listGraphs();
    assert.strictEqual(list.length, 1);

    store.deleteGraph("test-graph");
    assert.strictEqual(store.getGraph("test-graph"), null);

    ms.close();
  });
});

describe("Workflow Runtime", () => {
  it("runs a simple linear workflow to completion", async () => {
    const ms = makeStore();
    const store = new WorkflowStore(ms);
    const runtime = new WorkflowRuntime(store, {
      terminalExec: async (cmd) => ({
        success: true, data: { stdout: cmd }, path: "command", sessionId: "test", completedAt: new Date().toISOString(),
      }),
    });

    const graph = makeGraph();
    const result = await runtime.run(graph);

    assert.strictEqual(result.success, true);
    assert.ok(result.data);
    assert.strictEqual(result.data.status, "completed");
    assert.strictEqual(Object.keys(result.data.nodeResults).length, 2);
    ms.close();
  });

  it("pauses at approval node and resumes after approve", async () => {
    const ms = makeStore();
    const store = new WorkflowStore(ms);
    const runtime = new WorkflowRuntime(store);

    const graph = makeGraph({
      nodes: [
        { id: "approve1", kind: "approval", input: { message: "Please approve" } },
        { id: "step2", kind: "assertion", input: { expression: "true", expected: "true" } },
      ],
      edges: [{ from: "approve1", to: "step2" }],
    });

    const result = await runtime.run(graph);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data?.status, "paused");

    // Approve
    const approveResult = runtime.approve(result.data!.id, "approve1");
    assert.strictEqual(approveResult.success, true);
    assert.strictEqual(approveResult.data?.approvals.length, 1);

    // Resume
    const resumeResult = await runtime.resume(result.data!.id);
    assert.strictEqual(resumeResult.success, true);
    assert.strictEqual(resumeResult.data?.status, "completed");
    ms.close();
  });

  it("fails and persists failure when node fails", async () => {
    const ms = makeStore();
    const store = new WorkflowStore(ms);
    const runtime = new WorkflowRuntime(store);

    const graph = makeGraph({
      nodes: [
        { id: "assert-fail", kind: "assertion", input: { expression: "a", expected: "b" } },
      ],
      edges: [],
    });

    const result = await runtime.run(graph);
    assert.strictEqual(result.success, false);

    const run = store.getRun(result.data?.id ?? "");
    // The run should be retrievable even on failure (via listRuns)
    const runs = store.listRuns();
    assert.ok(runs.length >= 1);
    ms.close();
  });

  it("fails helper nodes when no validated helper executor is bound", async () => {
    const ms = makeStore();
    const store = new WorkflowStore(ms);
    const runtime = new WorkflowRuntime(store);

    const graph = makeGraph({
      nodes: [
        { id: "helper-node", kind: "helper", input: { helperId: "missing-helper" } },
      ],
      edges: [],
    });

    const result = await runtime.run(graph);
    assert.strictEqual(result.success, false);
    const run = store.listRuns()[0];
    assert.match(run.failures[0]?.error ?? "", /Helper executor not available/);
    ms.close();
  });

  it("executes helper nodes only through a bound helper executor", async () => {
    const ms = makeStore();
    const store = new WorkflowStore(ms);
    const runtime = new WorkflowRuntime(store, {
      helperExecute: async (helperId) => ({
        success: helperId === "known-helper",
        data: { helperId },
        path: "command",
        sessionId: "test",
        completedAt: new Date().toISOString(),
      }),
    });

    const graph = makeGraph({
      nodes: [
        { id: "helper-node", kind: "helper", input: { helperId: "known-helper" } },
      ],
      edges: [],
    });

    const result = await runtime.run(graph);
    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(result.data?.nodeResults["helper-node"].output, { helperId: "known-helper" });
    ms.close();
  });

  it("cancels a running workflow", async () => {
    const ms = makeStore();
    const store = new WorkflowStore(ms);
    const runtime = new WorkflowRuntime(store);

    const graph = makeGraph({
      nodes: [{ id: "approve1", kind: "approval", input: {} }],
      edges: [],
    });

    const result = await runtime.run(graph);
    assert.strictEqual(result.data?.status, "paused");

    const cancelResult = runtime.cancel(result.data!.id);
    assert.strictEqual(cancelResult.success, true);
    assert.strictEqual(cancelResult.data?.status, "canceled");
    ms.close();
  });

  it("retries on failure with retry policy", async () => {
    const ms = makeStore();
    const store = new WorkflowStore(ms);
    let attempts = 0;
    const runtime = new WorkflowRuntime(store, {
      terminalExec: async () => {
        attempts++;
        if (attempts < 3) {
          return { success: false, error: "not ready", path: "command", sessionId: "test", completedAt: new Date().toISOString() };
        }
        return { success: true, data: { ok: true }, path: "command", sessionId: "test", completedAt: new Date().toISOString() };
      },
    });

    const graph = makeGraph({
      nodes: [
        { id: "retry-node", kind: "terminal", input: { command: "test" }, retry: { maxAttempts: 3, delayMs: 10, backoff: "linear" } },
      ],
      edges: [],
    });

    const result = await runtime.run(graph);
    assert.strictEqual(result.success, true);
    assert.strictEqual(attempts, 3);
    ms.close();
  });

  it("returns ActionResult failure for invalid public API graph JSON", async () => {
    const bc = createBrowserControl({ memoryStore: makeStore() });
    const result = await bc.workflow.run("{not-json");
    assert.strictEqual(result.success, false);
    assert.match(result.error ?? "", /Invalid workflow graph JSON/);
    bc.close();
  });
});
