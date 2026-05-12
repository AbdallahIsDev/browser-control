/**
 * Workflow Runtime v2 — Branching, loops, typed state, and event streaming.
 */

import crypto from "node:crypto";
import {
	type WorkflowGraph,
	type WorkflowNode,
	type WorkflowRun,
	type WorkflowNodeResult,
	type WorkflowRunStatus,
	type WorkflowEvent,
	type LoopConfig,
	validateWorkflowGraph,
	evaluateCondition,
	MAX_LOOP_ITERATIONS,
} from "./types";
import { WorkflowStore } from "./store";
import type { ActionResult } from "../shared/action_result";
import { successResult, failureResult } from "../shared/action_result";

const MAX_WORKFLOW_EXECUTION_STEPS = 5000;

export interface WorkflowEventSink {
	emit(event: WorkflowEvent): void;
}

export interface WorkflowExecutionContext {
	terminalExec?: (command: string, timeoutMs?: number) => Promise<ActionResult>;
	fsRead?: (path: string) => Promise<ActionResult>;
	fsWrite?: (path: string, content: string) => Promise<ActionResult>;
	browserOpen?: (url: string) => Promise<ActionResult>;
	browserSnapshot?: () => Promise<ActionResult>;
	helperExecute?: (helperId: string, input: Record<string, unknown>) => Promise<ActionResult>;
	verificationExecute?: (input: Record<string, unknown>) => Promise<ActionResult>;
	sessionId?: string;
	eventSink?: WorkflowEventSink;
	autoApprove?: boolean;
}

export class WorkflowRuntime {
	constructor(
		private readonly store: WorkflowStore,
		private readonly ctx: WorkflowExecutionContext = {},
	) {}

	private emit(evt: WorkflowEvent): void {
		this.ctx.eventSink?.emit(evt);
	}

	private now(): string {
		return new Date().toISOString();
	}

	async run(graph: WorkflowGraph): Promise<ActionResult<WorkflowRun>> {
		const validation = validateWorkflowGraph(graph);
		if (!validation.valid) {
			return failureResult(`Invalid workflow graph: ${validation.errors.join("; ")}`, {
				path: "command",
				sessionId: this.ctx.sessionId ?? "system",
			});
		}

		this.store.saveGraph(graph);

		const entryNodeId = graph.entryNodeId ?? graph.nodes[0]?.id;
		const run: WorkflowRun = {
			id: crypto.randomUUID(),
			graphId: graph.id,
			graphName: graph.name,
			status: "running",
			currentNodeId: entryNodeId,
			state: {},
			nodeResults: {},
			approvals: [],
			artifacts: [],
			failures: [],
			events: [],
			startedAt: this.now(),
			updatedAt: this.now(),
			sessionId: this.ctx.sessionId,
		};
		this.store.saveRun(run);

		this.emit({
			type: "node-started",
			runId: run.id,
			nodeId: entryNodeId,
			timestamp: this.now(),
		});

		return this.executeFrom(run, graph, entryNodeId);
	}

	async resume(runId: string): Promise<ActionResult<WorkflowRun>> {
		const run = this.store.getRun(runId);
		if (!run) {
			return failureResult(`Run not found: ${runId}`, { path: "command", sessionId: this.ctx.sessionId ?? "system" });
		}
		if (run.status !== "paused" && run.status !== "failed") {
			return failureResult(`Cannot resume run in status: ${run.status}`, { path: "command", sessionId: this.ctx.sessionId ?? "system" });
		}
		const graph = this.store.getGraph(run.graphId);
		if (!graph) {
			return failureResult(`Graph not found: ${run.graphId}`, { path: "command", sessionId: this.ctx.sessionId ?? "system" });
		}
		run.status = "running";
		run.updatedAt = this.now();
		this.store.saveRun(run);

		this.emit({ type: "node-resumed", runId: run.id, nodeId: run.currentNodeId, timestamp: this.now() });
		return this.executeFrom(run, graph, run.currentNodeId);
	}

	approve(runId: string, nodeId: string, approvedBy = "user"): ActionResult<WorkflowRun> {
		const run = this.store.getRun(runId);
		if (!run) return failureResult(`Run not found: ${runId}`, { path: "command", sessionId: this.ctx.sessionId ?? "system" });
		if (run.status !== "paused") return failureResult(`Run is not paused (${run.status})`, { path: "command", sessionId: this.ctx.sessionId ?? "system" });
		const nodeResult = run.nodeResults[nodeId];
		if (!nodeResult || nodeResult.status !== "pending-approval") return failureResult(`Node ${nodeId} not pending approval`, { path: "command", sessionId: this.ctx.sessionId ?? "system" });
		const graph = this.store.getGraph(run.graphId);
		if (!graph) return failureResult(`Graph not found: ${run.graphId}`, { path: "command", sessionId: this.ctx.sessionId ?? "system" });

		nodeResult.status = "completed";
		nodeResult.completedAt = this.now();
		run.approvals.push({ nodeId, approvedBy, approvedAt: this.now() });
		const nextNode = this.resolveNextNode(graph, nodeId, run.state);
		run.currentNodeId = nextNode;
		run.updatedAt = this.now();

		if (!nextNode) {
			run.status = "completed";
			run.completedAt = this.now();
			this.emit({ type: "workflow-completed", runId: run.id, timestamp: this.now() });
		}

		this.store.saveRun(run);
		return successResult(run, { path: "command", sessionId: this.ctx.sessionId ?? "system" });
	}

	cancel(runId: string): ActionResult<WorkflowRun> {
		const run = this.store.getRun(runId);
		if (!run) return failureResult(`Run not found: ${runId}`, { path: "command", sessionId: this.ctx.sessionId ?? "system" });
		if (run.status === "completed" || run.status === "canceled") return failureResult(`Cannot cancel run in ${run.status}`, { path: "command", sessionId: this.ctx.sessionId ?? "system" });
		run.status = "canceled";
		run.updatedAt = this.now();
		run.completedAt = this.now();
		this.store.saveRun(run);
		return successResult(run, { path: "command", sessionId: this.ctx.sessionId ?? "system" });
	}

	status(runId: string): ActionResult<WorkflowRun> {
		const run = this.store.getRun(runId);
		if (!run) return failureResult(`Run not found: ${runId}`, { path: "command", sessionId: this.ctx.sessionId ?? "system" });
		return successResult(run, { path: "command", sessionId: this.ctx.sessionId ?? "system" });
	}

	editState(runId: string, key: string, value: string | number | boolean): ActionResult<WorkflowRun> {
		const run = this.store.getRun(runId);
		if (!run) return failureResult(`Run not found: ${runId}`, { path: "command", sessionId: this.ctx.sessionId ?? "system" });
		const graph = this.store.getGraph(run.graphId);
		if (graph?.stateSchema && !(key in graph.stateSchema)) {
			return failureResult(`State key "${key}" not in state schema`, { path: "command", sessionId: this.ctx.sessionId ?? "system" });
		}
		run.state[key] = value;
		run.updatedAt = this.now();
		run.events.push({ type: "state-updated", runId: run.id, timestamp: this.now(), data: { key, value } });
		this.store.saveRun(run);
		return successResult(run, { path: "command", sessionId: this.ctx.sessionId ?? "system" });
	}

	// ── Internal ────────────────────────────────────────────────────

	private resolveNextNode(
		graph: WorkflowGraph,
		currentNodeId: string,
		state: Record<string, string | number | boolean>,
	): string | undefined {
		const outgoing = graph.edges.filter(e => e.from === currentNodeId);
		if (outgoing.length === 0) return undefined;
		if (outgoing.length === 1) return outgoing[0].to;

		// Branching: evaluate conditions
		for (const edge of outgoing) {
			if (edge.condition) {
				if (evaluateCondition(edge.condition, state)) return edge.to;
			}
		}

		// Default: first edge without a condition
		const defaultEdge = outgoing.find(e => !e.condition);
		return defaultEdge?.to;
	}

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
				run.failures.push({ nodeId: currentNodeId, error: `Exceeded ${MAX_WORKFLOW_EXECUTION_STEPS} steps`, timestamp: this.now() });
				run.updatedAt = run.completedAt = this.now();
				this.emit({ type: "workflow-failed", runId: run.id, timestamp: this.now(), data: "max-steps" });
				this.store.saveRun(run);
				break;
			}

			const node = nodeMap.get(currentNodeId);
			if (!node) {
				run.status = "failed";
				run.failures.push({ nodeId: currentNodeId, error: `Unknown node: ${currentNodeId}`, timestamp: this.now() });
				run.updatedAt = this.now();
				this.store.saveRun(run);
				break;
			}

			run.currentNodeId = currentNodeId;
			this.store.saveRun(run);

			// Handle loop nodes
			if (node.kind === "loop") {
				const loopResult = await this.executeLoop(node, run, graph);
				if (loopResult.status === "failed") {
					run.status = "failed";
					run.completedAt = this.now();
					run.updatedAt = this.now();
					this.store.saveRun(run);
					return failureResult(`Loop "${node.id}" failed: ${loopResult.error}`, { path: "command", sessionId: this.ctx.sessionId ?? "system" });
				}
				if (loopResult.status === "completed") {
					run.nodeResults[node.id] = loopResult;
					currentNodeId = this.resolveNextNode(graph, currentNodeId, run.state);
					run.updatedAt = this.now();
					this.store.saveRun(run);
					continue;
				}
			}

			const result = await this.executeNode(node, run);
			run.nodeResults[node.id] = result;
			run.updatedAt = this.now();

			if (result.status === "pending-approval") {
				run.status = "paused";
				this.emit({ type: "node-paused", runId: run.id, nodeId: node.id, timestamp: this.now() });
				this.store.saveRun(run);
				return successResult(run, { path: "command", sessionId: this.ctx.sessionId ?? "system" });
			}

			if (result.status === "failed") {
				run.status = "failed";
				run.completedAt = this.now();
				this.emit({ type: "workflow-failed", runId: run.id, nodeId: node.id, timestamp: this.now() });
				this.store.saveRun(run);
				return failureResult(`Workflow failed at "${node.id}": ${result.error}`, { path: "command", sessionId: this.ctx.sessionId ?? "system" });
			}

			if (result.artifacts) run.artifacts.push(...result.artifacts);

			this.emit({ type: "node-completed", runId: run.id, nodeId: node.id, timestamp: this.now(), data: result.output });

			currentNodeId = this.resolveNextNode(graph, currentNodeId, run.state);
			this.store.saveRun(run);
		}

		if (run.status === "running") {
			run.status = "completed";
			run.completedAt = run.updatedAt = this.now();
			this.emit({ type: "workflow-completed", runId: run.id, timestamp: this.now() });
			this.store.saveRun(run);
		}

		return successResult(run, { path: "command", sessionId: this.ctx.sessionId ?? "system" });
	}

	private async executeLoop(
		loopNode: WorkflowNode,
		run: WorkflowRun,
		graph: WorkflowGraph,
	): Promise<WorkflowNodeResult> {
		const config = loopNode.loopConfig;
		if (!config) {
			return { nodeId: loopNode.id, status: "failed", error: "Loop node missing loopConfig", retryCount: 0, startedAt: this.now() };
		}

		const childEdges = graph.edges.filter(e => e.from === loopNode.id);
		if (childEdges.length === 0) {
			return { nodeId: loopNode.id, status: "failed", error: "Loop node has no outgoing edges", retryCount: 0, startedAt: this.now() };
		}

		const bodyStart = childEdges[0].to;
		const timeoutAt = config.timeoutMs ? Date.now() + config.timeoutMs : null;
		let iteration = 0;
		const prevState = config.requireStateChange && config.stateChangeField
			? run.state[config.stateChangeField]
			: undefined;

		const startedAt = this.now();

		for (iteration = 0; iteration < config.maxIterations; iteration++) {
			if (timeoutAt && Date.now() >= timeoutAt) {
				this.emit({ type: "loop-completed", runId: run.id, nodeId: loopNode.id, timestamp: this.now(), data: { iterations: iteration, reason: "timeout" } });
				break;
			}

			this.emit({ type: "loop-iteration", runId: run.id, nodeId: loopNode.id, timestamp: this.now(), data: { iteration } });

			// Execute body as linear path from bodyStart
			const bodyResult = await this.executeLinearPath(run, graph, bodyStart, loopNode.id);
			if (!bodyResult.success) {
				return { nodeId: loopNode.id, status: "failed", error: `Loop iteration ${iteration} failed`, retryCount: 0, startedAt, completedAt: this.now(), loopIteration: iteration };
			}

			if (run.status === "paused") {
				return { nodeId: loopNode.id, status: "pending-approval", retryCount: 0, startedAt, loopIteration: iteration };
			}

			// State-change check
			if (config.requireStateChange && config.stateChangeField) {
				const currentVal = run.state[config.stateChangeField];
				if (currentVal === prevState) {
					this.emit({ type: "loop-completed", runId: run.id, nodeId: loopNode.id, timestamp: this.now(), data: { iterations: iteration + 1, reason: "no-state-change" } });
					break;
				}
			}
		}

		if (iteration >= config.maxIterations) {
			this.emit({ type: "loop-completed", runId: run.id, nodeId: loopNode.id, timestamp: this.now(), data: { iterations: iteration, reason: "max-iterations" } });
		}

		return {
			nodeId: loopNode.id,
			status: "completed",
			output: { iterations: iteration },
			retryCount: 0,
			startedAt,
			completedAt: this.now(),
			loopIteration: iteration,
		};
	}

	private async executeLinearPath(
		run: WorkflowRun,
		graph: WorkflowGraph,
		startNodeId: string,
		stopAfterNodeId: string,
	): Promise<ActionResult<unknown>> {
		const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));
		let current = startNodeId;
		let steps = 0;

		while (current && current !== stopAfterNodeId && steps < MAX_LOOP_ITERATIONS) {
			steps++;
			const node = nodeMap.get(current);
			if (!node) break;

			const result = await this.executeNode(node, run);
			run.nodeResults[node.id] = result;
			run.updatedAt = this.now();

			if (result.status === "pending-approval") {
				run.status = "paused";
				this.store.saveRun(run);
				return successResult({ paused: node.id }, { path: "command", sessionId: this.ctx.sessionId ?? "system" });
			}
			if (result.status === "failed") {
				return failureResult(result.error ?? "Node failed", { path: "command", sessionId: this.ctx.sessionId ?? "system" });
			}
			if (result.artifacts) run.artifacts.push(...result.artifacts);

			const edges = graph.edges.filter(e => e.from === current);
			const nextEdge = edges.find(e => e.to === stopAfterNodeId);
			if (nextEdge) {
				current = stopAfterNodeId;
				break;
			}

			const next = edges[0];
			if (!next || next.to === current) break;
			current = next.to;
		}

		this.store.saveRun(run);
		return successResult({ pathComplete: true }, { path: "command", sessionId: this.ctx.sessionId ?? "system" });
	}

	// ── Node execution (same as v1) ─────────────────────────────────

	private async executeNode(node: WorkflowNode, run: WorkflowRun): Promise<WorkflowNodeResult> {
		const startedAt = this.now();
		this.emit({ type: "node-started", runId: run.id, nodeId: node.id, timestamp: startedAt });

		const maxAttempts = node.retry?.maxAttempts ?? 1;
		let lastError = "";

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			if (attempt > 1) {
				this.emit({ type: "node-retried", runId: run.id, nodeId: node.id, timestamp: this.now(), data: { attempt } });
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
				lastError = result.error ?? "Node failed";
			} catch (err) {
				lastError = err instanceof Error ? err.message : String(err);
			}
		}

		this.emit({ type: "node-failed", runId: run.id, nodeId: node.id, timestamp: this.now(), data: lastError });
		run.failures.push({ nodeId: node.id, error: lastError, timestamp: this.now() });

		return { nodeId: node.id, status: "failed", error: lastError, retryCount: maxAttempts - 1, startedAt, completedAt: this.now() };
	}

	private async executeNodeKind(node: WorkflowNode): Promise<WorkflowNodeResult> {
		switch (node.kind) {
			case "terminal": {
				if (!this.ctx.terminalExec) return this.failNode(node.id, "Terminal executor not available");
				const command = String(node.input.command ?? "");
				const result = await this.ctx.terminalExec(command, node.timeoutMs);
				return this.nodeFromAction(node.id, result);
			}
			case "filesystem": {
				const action = String(node.input.action ?? "read");
				if (action === "read" && this.ctx.fsRead) {
					return this.nodeFromAction(node.id, await this.ctx.fsRead(String(node.input.path ?? "")));
				}
				if (action === "write" && this.ctx.fsWrite) {
					return this.nodeFromAction(node.id, await this.ctx.fsWrite(String(node.input.path ?? ""), String(node.input.content ?? "")));
				}
				return this.failNode(node.id, `Filesystem action not available: ${action}`);
			}
			case "browser": {
				if (this.ctx.browserOpen && node.input.url) {
					return this.nodeFromAction(node.id, await this.ctx.browserOpen(String(node.input.url)));
				}
				return this.failNode(node.id, "Browser executor not available");
			}
			case "approval":
				return { nodeId: node.id, status: "pending-approval", retryCount: 0, startedAt: this.now() };
			case "wait": {
				const waitMs = Number(node.input.durationMs ?? 1000);
				if (!Number.isFinite(waitMs) || waitMs < 0) return this.failNode(node.id, "Wait duration must be non-negative");
				const bounded = Math.min(waitMs, 60000);
				await new Promise(r => setTimeout(r, bounded));
				return { nodeId: node.id, status: "completed", output: { waited: bounded }, retryCount: 0, startedAt: this.now(), completedAt: this.now() };
			}
			case "assertion": {
				const expr = String(node.input.expression ?? "");
				const expected = node.input.expected;
				const passed = expr === String(expected);
				return { nodeId: node.id, status: passed ? "completed" : "failed", output: { expression: expr, expected, passed }, error: passed ? undefined : `Expected "${expected}" got "${expr}"`, retryCount: 0, startedAt: this.now(), completedAt: this.now() };
			}
			case "verification": {
				if (!this.ctx.verificationExecute) return this.failNode(node.id, "Verification executor not available");
				return this.nodeFromAction(node.id, await this.ctx.verificationExecute(node.input));
			}
			case "helper": {
				if (!this.ctx.helperExecute) return this.failNode(node.id, "Helper executor not available");
				const helperId = String(node.input.helperId ?? "");
				if (!helperId) return this.failNode(node.id, "Helper node requires input.helperId");
				return this.nodeFromAction(node.id, await this.ctx.helperExecute(helperId, node.input));
			}
			default:
				return this.failNode(node.id, `Unknown node kind: ${node.kind}`);
		}
	}

	private failNode(nodeId: string, error: string): WorkflowNodeResult {
		return { nodeId, status: "failed", error, retryCount: 0, startedAt: this.now(), completedAt: this.now() };
	}

	private nodeFromAction(nodeId: string, result: ActionResult): WorkflowNodeResult {
		return {
			nodeId,
			status: result.success ? "completed" : "failed",
			output: result.data,
			error: result.error,
			retryCount: 0,
			startedAt: this.now(),
			completedAt: this.now(),
			policyDecision: result.policyDecision,
		};
	}
}
