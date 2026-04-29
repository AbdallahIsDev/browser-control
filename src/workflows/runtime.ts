/**
 * Workflow Runtime — Durable workflow graph execution engine.
 *
 * Executes workflow graphs node-by-node, persisting state after each step.
 * Supports run, resume, cancel, approve, and status operations.
 * Routes node execution through existing Browser Control action surfaces.
 */

import crypto from "node:crypto";
import type { WorkflowGraph, WorkflowNode, WorkflowRun, WorkflowNodeResult, WorkflowRunStatus } from "./types";
import { validateWorkflowGraph } from "./types";
import { WorkflowStore } from "./store";
import type { ActionResult } from "../shared/action_result";
import { successResult, failureResult } from "../shared/action_result";

const MAX_WORKFLOW_EXECUTION_STEPS = 1000;

export interface WorkflowExecutionContext {
  terminalExec?: (command: string, timeoutMs?: number) => Promise<ActionResult>;
  fsRead?: (path: string) => Promise<ActionResult>;
  fsWrite?: (path: string, content: string) => Promise<ActionResult>;
  browserOpen?: (url: string) => Promise<ActionResult>;
  browserSnapshot?: () => Promise<ActionResult>;
  helperExecute?: (helperId: string, input: Record<string, unknown>) => Promise<ActionResult>;
  verificationExecute?: (input: Record<string, unknown>) => Promise<ActionResult>;
  sessionId?: string;
}

export class WorkflowRuntime {
  constructor(
    private readonly store: WorkflowStore,
    private readonly ctx: WorkflowExecutionContext = {},
  ) {}

  /**
   * Start a new workflow run from a graph definition.
   */
  async run(graph: WorkflowGraph): Promise<ActionResult<WorkflowRun>> {
    const validation = validateWorkflowGraph(graph);
    if (!validation.valid) {
      return failureResult(`Invalid workflow graph: ${validation.errors.join("; ")}`, {
        path: "command",
        sessionId: this.ctx.sessionId ?? "system",
      });
    }

    // Persist graph
    this.store.saveGraph(graph);

    // Create run
    const entryNodeId = graph.entryNodeId ?? graph.nodes[0]?.id;
    const run: WorkflowRun = {
      id: crypto.randomUUID(),
      graphId: graph.id,
      graphName: graph.name,
      status: "running",
      currentNodeId: entryNodeId,
      nodeResults: {},
      approvals: [],
      artifacts: [],
      failures: [],
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sessionId: this.ctx.sessionId,
    };

    this.store.saveRun(run);

    // Execute from entry node
    return this.executeFrom(run, graph, entryNodeId);
  }

  /**
   * Resume a paused or failed workflow run.
   */
  async resume(runId: string): Promise<ActionResult<WorkflowRun>> {
    const run = this.store.getRun(runId);
    if (!run) {
      return failureResult(`Workflow run not found: ${runId}`, {
        path: "command",
        sessionId: this.ctx.sessionId ?? "system",
      });
    }

    if (run.status !== "paused" && run.status !== "failed") {
      return failureResult(`Cannot resume run in status: ${run.status}`, {
        path: "command",
        sessionId: this.ctx.sessionId ?? "system",
      });
    }

    const graph = this.store.getGraph(run.graphId);
    if (!graph) {
      return failureResult(`Workflow graph not found: ${run.graphId}`, {
        path: "command",
        sessionId: this.ctx.sessionId ?? "system",
      });
    }

    run.status = "running";
    run.updatedAt = new Date().toISOString();
    this.store.saveRun(run);

    return this.executeFrom(run, graph, run.currentNodeId);
  }

  /**
   * Approve a node that is pending approval.
   */
  approve(runId: string, nodeId: string, approvedBy = "user"): ActionResult<WorkflowRun> {
    const run = this.store.getRun(runId);
    if (!run) {
      return failureResult(`Workflow run not found: ${runId}`, {
        path: "command",
        sessionId: this.ctx.sessionId ?? "system",
      });
    }

    if (run.status !== "paused") {
      return failureResult(`Cannot approve — run is not paused (status: ${run.status})`, {
        path: "command",
        sessionId: this.ctx.sessionId ?? "system",
      });
    }

    const nodeResult = run.nodeResults[nodeId];
    if (!nodeResult || nodeResult.status !== "pending-approval") {
      return failureResult(`Node ${nodeId} is not pending approval`, {
        path: "command",
        sessionId: this.ctx.sessionId ?? "system",
      });
    }

    const graph = this.store.getGraph(run.graphId);
    if (!graph) {
      return failureResult(`Workflow graph not found: ${run.graphId}`, {
        path: "command",
        sessionId: this.ctx.sessionId ?? "system",
      });
    }

    nodeResult.status = "completed";
    nodeResult.completedAt = new Date().toISOString();
    run.approvals.push({
      nodeId,
      approvedBy,
      approvedAt: new Date().toISOString(),
    });
    const nextNodeId = this.getNextNodeId(graph, nodeId);
    if (nextNodeId) {
      run.currentNodeId = nextNodeId;
    } else {
      run.currentNodeId = undefined;
      run.status = "completed";
      run.completedAt = new Date().toISOString();
    }
    run.updatedAt = new Date().toISOString();
    this.store.saveRun(run);

    return successResult(run, {
      path: "command",
      sessionId: this.ctx.sessionId ?? "system",
    });
  }

  /**
   * Cancel a running or paused workflow run.
   */
  cancel(runId: string): ActionResult<WorkflowRun> {
    const run = this.store.getRun(runId);
    if (!run) {
      return failureResult(`Workflow run not found: ${runId}`, {
        path: "command",
        sessionId: this.ctx.sessionId ?? "system",
      });
    }

    if (run.status === "completed" || run.status === "canceled") {
      return failureResult(`Cannot cancel run in status: ${run.status}`, {
        path: "command",
        sessionId: this.ctx.sessionId ?? "system",
      });
    }

    run.status = "canceled";
    run.updatedAt = new Date().toISOString();
    run.completedAt = new Date().toISOString();
    this.store.saveRun(run);

    return successResult(run, {
      path: "command",
      sessionId: this.ctx.sessionId ?? "system",
    });
  }

  /**
   * Get current status of a workflow run.
   */
  status(runId: string): ActionResult<WorkflowRun> {
    const run = this.store.getRun(runId);
    if (!run) {
      return failureResult(`Workflow run not found: ${runId}`, {
        path: "command",
        sessionId: this.ctx.sessionId ?? "system",
      });
    }

    return successResult(run, {
      path: "command",
      sessionId: this.ctx.sessionId ?? "system",
    });
  }

  // ── Internal execution ──────────────────────────────────────────

  private async executeFrom(
    run: WorkflowRun,
    graph: WorkflowGraph,
    startNodeId?: string,
  ): Promise<ActionResult<WorkflowRun>> {
    const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));
    let currentNodeId = startNodeId;
    let stepCount = 0;

    while (currentNodeId && run.status === "running") {
      stepCount++;
      if (stepCount > MAX_WORKFLOW_EXECUTION_STEPS) {
        run.status = "failed";
        run.failures.push({
          nodeId: currentNodeId,
          error: `Workflow exceeded ${MAX_WORKFLOW_EXECUTION_STEPS} execution steps`,
          timestamp: new Date().toISOString(),
        });
        run.updatedAt = new Date().toISOString();
        run.completedAt = new Date().toISOString();
        this.store.saveRun(run);
        return failureResult(`Workflow exceeded ${MAX_WORKFLOW_EXECUTION_STEPS} execution steps`, {
          path: "command",
          sessionId: this.ctx.sessionId ?? "system",
        });
      }

      const node = nodeMap.get(currentNodeId);
      if (!node) {
        run.status = "failed";
        run.failures.push({ nodeId: currentNodeId, error: `Unknown node: ${currentNodeId}`, timestamp: new Date().toISOString() });
        run.updatedAt = new Date().toISOString();
        this.store.saveRun(run);
        break;
      }

      run.currentNodeId = currentNodeId;
      this.store.saveRun(run);

      const result = await this.executeNode(node, run);
      run.nodeResults[node.id] = result;
      run.updatedAt = new Date().toISOString();

      if (result.status === "pending-approval") {
        run.status = "paused";
        this.store.saveRun(run);
        return successResult(run, {
          path: "command",
          sessionId: this.ctx.sessionId ?? "system",
          warning: `Workflow paused at node "${node.id}" pending approval`,
        });
      }

      if (result.status === "failed") {
        run.status = "failed";
        run.completedAt = new Date().toISOString();
        this.store.saveRun(run);
        return failureResult(`Workflow failed at node "${node.id}": ${result.error}`, {
          path: "command",
          sessionId: this.ctx.sessionId ?? "system",
        });
      }

      if (result.artifacts) {
        run.artifacts.push(...result.artifacts);
      }

      // Find next node via edges
      currentNodeId = this.getNextNodeId(graph, currentNodeId); // Simple linear traversal for v1
      this.store.saveRun(run);
    }

    if (run.status === "running") {
      run.status = "completed";
      run.completedAt = new Date().toISOString();
      run.updatedAt = new Date().toISOString();
      this.store.saveRun(run);
    }

    return successResult(run, {
      path: "command",
      sessionId: this.ctx.sessionId ?? "system",
    });
  }

  private getNextNodeId(graph: WorkflowGraph, nodeId: string): string | undefined {
    return graph.edges.find(edge => edge.from === nodeId)?.to;
  }

  private async executeNode(node: WorkflowNode, run: WorkflowRun): Promise<WorkflowNodeResult> {
    const startedAt = new Date().toISOString();
    const maxAttempts = node.retry?.maxAttempts ?? 1;
    let lastError = "";

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) {
        const delayMs = node.retry?.delayMs ?? 1000;
        const backoff = node.retry?.backoff ?? "exponential";
        const wait = backoff === "exponential" ? delayMs * (2 ** (attempt - 2)) : delayMs * (attempt - 1);
        await new Promise(r => setTimeout(r, Math.min(wait, 30000)));
      }

      try {
        const result = await this.executeNodeKind(node);
        if (result.status === "completed" || result.status === "pending-approval") {
          return { ...result, startedAt, retryCount: attempt - 1 };
        }
        lastError = result.error ?? "Node execution failed";
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    run.failures.push({ nodeId: node.id, error: lastError, timestamp: new Date().toISOString() });

    return {
      nodeId: node.id,
      status: "failed",
      error: lastError,
      retryCount: maxAttempts - 1,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }

  private async executeNodeKind(node: WorkflowNode): Promise<WorkflowNodeResult> {
    switch (node.kind) {
      case "terminal": {
        if (!this.ctx.terminalExec) {
          return { nodeId: node.id, status: "failed", error: "Terminal executor not available", retryCount: 0, startedAt: new Date().toISOString() };
        }
        const command = String(node.input.command ?? "");
        const result = await this.ctx.terminalExec(command, node.timeoutMs);
        return {
          nodeId: node.id,
          status: result.success ? "completed" : "failed",
          output: result.data,
          error: result.error,
          retryCount: 0,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          policyDecision: result.policyDecision,
        };
      }

      case "filesystem": {
        const action = String(node.input.action ?? "read");
        if (action === "read" && this.ctx.fsRead) {
          const result = await this.ctx.fsRead(String(node.input.path ?? ""));
          return {
            nodeId: node.id,
            status: result.success ? "completed" : "failed",
            output: result.data,
            error: result.error,
            retryCount: 0,
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          };
        }
        if (action === "write" && this.ctx.fsWrite) {
          const result = await this.ctx.fsWrite(String(node.input.path ?? ""), String(node.input.content ?? ""));
          return {
            nodeId: node.id,
            status: result.success ? "completed" : "failed",
            output: result.data,
            error: result.error,
            retryCount: 0,
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          };
        }
        return { nodeId: node.id, status: "failed", error: `Filesystem action not available: ${action}`, retryCount: 0, startedAt: new Date().toISOString() };
      }

      case "approval":
        return {
          nodeId: node.id,
          status: "pending-approval",
          retryCount: 0,
          startedAt: new Date().toISOString(),
        };

      case "wait": {
        const waitMs = Number(node.input.durationMs ?? 1000);
        if (!Number.isFinite(waitMs) || waitMs < 0) {
          return {
            nodeId: node.id,
            status: "failed",
            error: "Wait duration must be a non-negative finite number",
            retryCount: 0,
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          };
        }
        const boundedWaitMs = Math.min(waitMs, 60000);
        await new Promise(r => setTimeout(r, boundedWaitMs));
        return {
          nodeId: node.id,
          status: "completed",
          output: { waited: boundedWaitMs },
          retryCount: 0,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        };
      }

      case "assertion": {
        const expression = String(node.input.expression ?? "");
        const expected = node.input.expected;
        // Simple assertion: check if expression equals expected
        const passed = expression === String(expected);
        return {
          nodeId: node.id,
          status: passed ? "completed" : "failed",
          output: { expression, expected, passed },
          error: passed ? undefined : `Assertion failed: expected "${expected}" but got "${expression}"`,
          retryCount: 0,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        };
      }

      case "verification": {
        if (!this.ctx.verificationExecute) {
          return { nodeId: node.id, status: "failed", error: "Verification executor not available", retryCount: 0, startedAt: new Date().toISOString() };
        }
        const result = await this.ctx.verificationExecute(node.input);
        return {
          nodeId: node.id,
          status: result.success ? "completed" : "failed",
          output: result.data,
          error: result.error,
          retryCount: 0,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          policyDecision: result.policyDecision,
        };
      }

      case "helper": {
        if (!this.ctx.helperExecute) {
          return { nodeId: node.id, status: "failed", error: "Helper executor not available", retryCount: 0, startedAt: new Date().toISOString() };
        }
        const helperId = String(node.input.helperId ?? "");
        if (!helperId) {
          return { nodeId: node.id, status: "failed", error: "Helper node requires input.helperId", retryCount: 0, startedAt: new Date().toISOString() };
        }
        const result = await this.ctx.helperExecute(helperId, node.input);
        return {
          nodeId: node.id,
          status: result.success ? "completed" : "failed",
          output: result.data,
          error: result.error,
          retryCount: 0,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          policyDecision: result.policyDecision,
        };
      }

      case "browser": {
        if (this.ctx.browserOpen && node.input.url) {
          const result = await this.ctx.browserOpen(String(node.input.url));
          return {
            nodeId: node.id,
            status: result.success ? "completed" : "failed",
            output: result.data,
            error: result.error,
            retryCount: 0,
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            policyDecision: result.policyDecision,
          };
        }
        return { nodeId: node.id, status: "failed", error: "Browser executor not available", retryCount: 0, startedAt: new Date().toISOString() };
      }

      default:
        return { nodeId: node.id, status: "failed", error: `Unknown node kind: ${(node as WorkflowNode).kind}`, retryCount: 0, startedAt: new Date().toISOString() };
    }
  }
}
