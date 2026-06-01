import { describe, it } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MemoryStore } from "../../src/runtime/memory_store";
import { WorkflowStore } from "../../src/workflows/store";
import { WorkflowRuntime } from "../../src/workflows/runtime";
import { validateWorkflowGraph } from "../../src/workflows/types";
import type { WorkflowGraph } from "../../src/workflows/types";
import { createBrowserControl } from "../../src/browser_control";
import { createCredentialProtectionService } from "../../src/security/credential_provider";
import {
  CredentialVault,
  resetCredentialVault,
  SecretString,
} from "../../src/security/credential_vault";
import { getStateStorage, resetStateStorage } from "../../src/state/index";

function makeStore() {
  return new MemoryStore({ filename: ":memory:" });
}

function makeFileStore(): { store: MemoryStore; storePath: string; cleanup: () => void } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-workflow-store-"));
  const storePath = path.join(tmpDir, "memory.sqlite");
  const store = new MemoryStore({ filename: storePath });
  return {
    store,
    storePath,
    cleanup: () => {
      try {
        store.close();
      } catch {
        // ignore cleanup errors
      }
      fs.rmSync(tmpDir, { force: true, recursive: true });
    },
  };
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

  it("persists graphs and runs without plaintext workflow state", () => {
    const { store: ms, storePath, cleanup } = makeFileStore();
    const secretsDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-workflow-secrets-"));
    const originalVaultPassphrase = process.env.BROWSER_CONTROL_VAULT_PASSPHRASE;
    process.env.BROWSER_CONTROL_VAULT_PASSPHRASE = "workflow-store-vault-passphrase";
    const store = new WorkflowStore(ms, {
      credentialProtection: createCredentialProtectionService({
        dataHome: secretsDir,
        preferWindowsDpapi: false,
      }),
    });
    const secretMarker = "workflow-marker-secret";
    const graph = makeGraph({
      id: "secret-graph",
      nodes: [{ id: "step1", kind: "terminal", input: { command: `echo ${secretMarker}` } }],
      edges: [],
    });

    store.saveGraph(graph);
    store.saveRun({
      id: "secret-run",
      graphId: graph.id,
      graphName: graph.name,
      status: "completed",
      state: { result: secretMarker },
      nodeResults: {
        step1: {
          nodeId: "step1",
          status: "completed",
          output: { stdout: secretMarker },
          retryCount: 0,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        },
      },
      approvals: [],
      artifacts: [],
      failures: [],
      events: [{ type: "workflow-completed", runId: "secret-run", timestamp: new Date().toISOString(), data: secretMarker }],
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    assert.strictEqual(store.getGraph("secret-graph")?.nodes[0].input.command, `echo ${secretMarker}`);
    assert.strictEqual(store.getRun("secret-run")?.state.result, secretMarker);

    ms.close();
    const db = new DatabaseSync(storePath, { readOnly: true });
    try {
      const rows = db.prepare("SELECT value_json FROM memory_store WHERE key IN (?, ?)").all(
        "wf:graph:v1:secret-graph",
        "wf:run:v1:secret-run",
      ) as Array<{ value_json: string }>;
      assert.strictEqual(rows.length, 2);
      for (const row of rows) {
        assert.doesNotMatch(row.value_json, /workflow-marker-secret/);
      }
    } finally {
      db.close();
      if (originalVaultPassphrase === undefined)
        delete process.env.BROWSER_CONTROL_VAULT_PASSPHRASE;
      else process.env.BROWSER_CONTROL_VAULT_PASSPHRASE = originalVaultPassphrase;
      fs.rmSync(secretsDir, { force: true, recursive: true });
      cleanup();
    }
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

  it("replays browser click fill press snapshot and screenshot nodes through executors", async () => {
    const ms = makeStore();
    const store = new WorkflowStore(ms);
    const calls: string[] = [];
    const runtime = new WorkflowRuntime(store, {
      browserOpen: async (url) => {
        calls.push(`open:${url}`);
        return { success: true, data: { url }, path: "command", sessionId: "test", completedAt: new Date().toISOString() };
      },
      browserClick: async (target) => {
        calls.push(`click:${target}`);
        return { success: true, data: { clicked: target }, path: "command", sessionId: "test", completedAt: new Date().toISOString() };
      },
      browserFill: async (target, text) => {
        calls.push(`fill:${target}:${text}`);
        return { success: true, data: { filled: target }, path: "command", sessionId: "test", completedAt: new Date().toISOString() };
      },
      browserPress: async (key) => {
        calls.push(`press:${key}`);
        return { success: true, data: { pressed: key }, path: "command", sessionId: "test", completedAt: new Date().toISOString() };
      },
      browserSnapshot: async () => {
        calls.push("snapshot");
        return { success: true, data: { elements: [] }, path: "command", sessionId: "test", completedAt: new Date().toISOString() };
      },
      browserScreenshot: async () => {
        calls.push("screenshot");
        return { success: true, data: { path: "shot.png" }, path: "command", sessionId: "test", completedAt: new Date().toISOString() };
      },
    });

    const graph = makeGraph({
      nodes: [
        { id: "open", kind: "browser", input: { action: "open", url: "https://example.test" } },
        { id: "click", kind: "browser", input: { action: "click", target: "#submit" } },
        { id: "fill", kind: "browser", input: { action: "fill", target: "#name", text: "Ada" } },
        { id: "press", kind: "browser", input: { action: "press", key: "Enter" } },
        { id: "snapshot", kind: "browser", input: { action: "snapshot" } },
        { id: "screenshot", kind: "browser", input: { action: "screenshot" } },
      ],
      edges: [
        { from: "open", to: "click" },
        { from: "click", to: "fill" },
        { from: "fill", to: "press" },
        { from: "press", to: "snapshot" },
        { from: "snapshot", to: "screenshot" },
      ],
      entryNodeId: "open",
    });

    const result = await runtime.run(graph);

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(calls, [
      "open:https://example.test",
      "click:#submit",
      "fill:#name:Ada",
      "press:Enter",
      "snapshot",
      "screenshot",
    ]);
    assert.strictEqual(result.data?.status, "completed");
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

  it("resolves helper secret refs at execution time and redacts run output", async () => {
    const ms = makeStore();
    const store = new WorkflowStore(ms);
    let helperInput: Record<string, unknown> | null = null;
    const runtime = new WorkflowRuntime(store, {
      sessionId: "session-1",
      packageName: "pkg.alpha",
      helperExecute: async (_helperId, input) => {
        helperInput = input;
        return {
          success: true,
          data: { received: input.password },
          path: "command",
          sessionId: "session-1",
          completedAt: new Date().toISOString(),
        };
      },
      secretResolver: async (secretRef, action, context) => {
        assert.strictEqual(secretRef, "secret://site/example.test/password");
        assert.strictEqual(action, "use-as-form-value");
        assert.strictEqual(context.sessionId, "session-1");
        assert.strictEqual(context.packageName, "pkg.alpha");
        assert.strictEqual(context.workflowId, "test-graph");
        return {
          success: true,
          id: secretRef,
          value: new SecretString("raw-helper-secret"),
          grantId: "grant-1",
        };
      },
    });

    const graph = makeGraph({
      nodes: [
        {
          id: "helper-node",
          kind: "helper",
          input: {
            helperId: "known-helper",
            password: "secret://site/example.test/password",
          },
        },
      ],
      edges: [],
    });

    const result = await runtime.run(graph);

    assert.strictEqual(result.success, true);
    const capturedInput = helperInput as Record<string, unknown> | null;
    assert.ok(capturedInput);
    assert.strictEqual(capturedInput.password, "raw-helper-secret");
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /raw-helper-secret/);
    assert.match(serialized, /REDACTED_SECRET/);
    ms.close();
  });

  it("rejects terminal secret refs instead of expanding secrets into commands", async () => {
    const ms = makeStore();
    const store = new WorkflowStore(ms);
    const runtime = new WorkflowRuntime(store, {
      terminalExec: async () => {
        throw new Error("terminal should not receive secret refs");
      },
      secretResolver: async () => ({
        success: true,
        id: "secret://site/example.test/password",
        value: new SecretString("raw-terminal-secret"),
      }),
    });

    const graph = makeGraph({
      nodes: [
        {
          id: "terminal-node",
          kind: "terminal",
          input: { command: "echo secret://site/example.test/password" },
        },
      ],
      edges: [],
    });

    const result = await runtime.run(graph);

    assert.strictEqual(result.success, false);
    assert.match(result.error ?? "", /not supported in terminal commands/);
    assert.doesNotMatch(JSON.stringify(result), /raw-terminal-secret/);
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

  it("persists event sequence and follows state-based branch edges", async () => {
    const ms = makeStore();
    const store = new WorkflowStore(ms);
    const runtime = new WorkflowRuntime(store);
    const graph = makeGraph({
      initialState: { route: "right" },
      nodes: [
        { id: "start", kind: "assertion", input: { expression: "ok", expected: "ok" } },
        { id: "left", kind: "assertion", input: { expression: "left", expected: "left" } },
        { id: "right", kind: "assertion", input: { expression: "right", expected: "right" } },
      ],
      edges: [
        { from: "start", to: "left", condition: { field: "route", operator: "eq", value: "left" } },
        { from: "start", to: "right", condition: { field: "route", operator: "eq", value: "right" } },
      ],
      entryNodeId: "start",
      stateSchema: { route: "string" },
    });

    const result = await runtime.run(graph);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data?.status, "completed");
    assert.ok(result.data?.nodeResults.right, "right branch should run");
    assert.equal(result.data?.nodeResults.left, undefined);
    assert.deepStrictEqual(
      result.data?.events.map((event) => event.type),
      ["node-started", "node-completed", "node-started", "node-completed", "workflow-completed"],
    );
    ms.close();
  });

  it("executes loop body up to max guard then exits", async () => {
    const ms = makeStore();
    const store = new WorkflowStore(ms);
    const runtime = new WorkflowRuntime(store);
    const graph = makeGraph({
      nodes: [
        { id: "loop", kind: "loop", input: {}, loopConfig: { maxIterations: 3 } },
        { id: "body", kind: "assertion", input: { expression: "tick", expected: "tick" } },
        { id: "after", kind: "assertion", input: { expression: "done", expected: "done" } },
      ],
      edges: [
        { from: "loop", to: "body", role: "body" },
        { from: "body", to: "loop" },
        { from: "loop", to: "after", role: "exit" },
      ],
      entryNodeId: "loop",
    });

    const validation = validateWorkflowGraph(graph);
    assert.strictEqual(validation.valid, true, validation.errors.join("; "));

    const result = await runtime.run(graph);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data?.status, "completed");
    assert.strictEqual(
      (result.data?.nodeResults.loop.output as { iterations?: number } | undefined)?.iterations,
      3,
    );
    assert.ok(result.data?.nodeResults.after, "exit node should run after loop");
    assert.ok(
      result.data?.events.some(
        (event) =>
          event.type === "loop-completed" &&
          (event.data as { reason?: string } | undefined)?.reason === "max-iterations",
      ),
    );
    ms.close();
  });

  it("enforces state schema key and value type edits", async () => {
    const ms = makeStore();
    const store = new WorkflowStore(ms);
    const runtime = new WorkflowRuntime(store);
    const graph = makeGraph({
      nodes: [{ id: "approve1", kind: "approval", input: {} }],
      edges: [],
      stateSchema: { count: "number", enabled: "boolean" },
    });

    const run = await runtime.run(graph);
    assert.strictEqual(run.success, true);
    assert.strictEqual(run.data?.status, "paused");

    assert.strictEqual(runtime.editState(run.data!.id, "count", 2).success, true);
    assert.strictEqual(runtime.editState(run.data!.id, "count", "bad").success, false);
    assert.strictEqual(runtime.editState(run.data!.id, "missing", 1).success, false);
    ms.close();
  });

  it("returns ActionResult failure for invalid public API graph JSON", async () => {
    const bc = createBrowserControl({ memoryStore: makeStore() });
    const result = await bc.workflow.run("{not-json");
    assert.strictEqual(result.success, false);
    assert.match(result.error ?? "", /Invalid workflow graph JSON/);
    bc.close();
  });

  it("public workflow API resolves granted secret refs without leaking raw values", async () => {
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), "bc-workflow-vault-"));
    const previousHome = process.env.BROWSER_CONTROL_HOME;
    const previousBackend = process.env.BROWSER_CONTROL_STATE_BACKEND;
    const previousVaultPassphrase = process.env.BROWSER_CONTROL_VAULT_PASSPHRASE;
    process.env.BROWSER_CONTROL_HOME = dataHome;
    process.env.BROWSER_CONTROL_STATE_BACKEND = "json";
    process.env.BROWSER_CONTROL_VAULT_PASSPHRASE = "workflow-api-vault-passphrase";
    resetCredentialVault();
    resetStateStorage();

    const memoryStore = makeStore();
    const bc = createBrowserControl({ dataHome, memoryStore, policyProfile: "trusted" });

    try {
      const storage = getStateStorage(dataHome);
      const vault = new CredentialVault(
        storage,
        createCredentialProtectionService({
          dataHome,
          preferWindowsDpapi: false,
        }),
      );
      const secret = await vault.set(
        "site",
        "example.test",
        "password",
        "workflow-raw-secret",
      );
      await vault.grant(secret.id, {
        actions: ["use-as-form-value"],
        workflowScope: "test-graph",
      });

      const graph = makeGraph({
        nodes: [
          {
            id: "verify-secret",
            kind: "verification",
            input: {
              actual: secret.id,
              expected: "workflow-raw-secret",
            },
          },
        ],
        edges: [],
      });
      const result = await bc.workflow.run(JSON.stringify(graph));
      const serialized = JSON.stringify(result);

      assert.strictEqual(result.success, true);
      const run = result.data as { status?: string } | undefined;
      assert.strictEqual(run?.status, "completed");
      assert.doesNotMatch(serialized, /workflow-raw-secret/);
      assert.match(serialized, /REDACTED_SECRET/);
      assert.doesNotMatch(JSON.stringify(await storage.listSecretAuditEvents(10)), /workflow-raw-secret/);
    } finally {
      bc.close();
      resetCredentialVault();
      resetStateStorage();
      if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
      else process.env.BROWSER_CONTROL_HOME = previousHome;
      if (previousBackend === undefined) delete process.env.BROWSER_CONTROL_STATE_BACKEND;
      else process.env.BROWSER_CONTROL_STATE_BACKEND = previousBackend;
      if (previousVaultPassphrase === undefined) delete process.env.BROWSER_CONTROL_VAULT_PASSPHRASE;
      else process.env.BROWSER_CONTROL_VAULT_PASSPHRASE = previousVaultPassphrase;
      fs.rmSync(dataHome, { recursive: true, force: true });
    }
  });
});
