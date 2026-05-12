/**
 * Workflow Types v2 — Branching, loops, typed state, and events.
 */

export interface RetryPolicy { maxAttempts: number; delayMs: number; backoff: "linear" | "exponential"; }

export interface LoopConfig { maxIterations: number; timeoutMs?: number; requireStateChange?: boolean; stateChangeField?: string; }

export interface ConditionExpression { field: string; operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "includes" | "exists"; value?: unknown; }

export type WorkflowNodeKind = "terminal" | "filesystem" | "browser" | "approval" | "wait" | "assertion" | "verification" | "helper" | "loop";

export interface WorkflowNode { id: string; kind: WorkflowNodeKind; name?: string; input: Record<string, unknown>; retry?: RetryPolicy; timeoutMs?: number; loopConfig?: LoopConfig; }

export interface WorkflowEdge { from: string; to: string; condition?: ConditionExpression; label?: string; }

export interface WorkflowGraph { id: string; name: string; version: string; nodes: WorkflowNode[]; edges: WorkflowEdge[]; entryNodeId?: string; stateSchema?: Record<string, "string" | "number" | "boolean">; }

export interface WorkflowState { values: Record<string, string | number | boolean>; updatedAt: string; nodeId: string; }

export type WorkflowEventType = "node-started" | "node-completed" | "node-failed" | "node-retried" | "node-paused" | "node-resumed" | "state-updated" | "loop-iteration" | "loop-completed" | "workflow-completed" | "workflow-failed";

export interface WorkflowEvent { type: WorkflowEventType; runId: string; nodeId?: string; timestamp: string; data?: unknown; }

export interface WorkflowNodeResult { nodeId: string; status: "completed" | "failed" | "skipped" | "pending-approval"; output?: unknown; error?: string; retryCount: number; startedAt: string; completedAt?: string; policyDecision?: string; artifacts?: Array<{ kind: string; path: string }>; loopIteration?: number; }

export type WorkflowRunStatus = "running" | "paused" | "completed" | "failed" | "canceled";

export interface WorkflowApprovalRecord { nodeId: string; approvedBy: string; approvedAt: string; metadata?: Record<string, unknown>; }

export interface WorkflowRun { id: string; graphId: string; graphName: string; status: WorkflowRunStatus; currentNodeId?: string; state: Record<string, string | number | boolean>; nodeResults: Record<string, WorkflowNodeResult>; approvals: WorkflowApprovalRecord[]; artifacts: Array<{ kind: string; path: string }>; failures: Array<{ nodeId: string; error: string; timestamp: string }>; events: WorkflowEvent[]; startedAt: string; updatedAt: string; completedAt?: string; sessionId?: string; }

export interface WorkflowValidationResult { valid: boolean; errors: string[]; }

export const MAX_WORKFLOW_NODES = 100;
export const MAX_WORKFLOW_EDGES = 200;
export const MAX_LOOP_ITERATIONS = 100;

function isObject(v: unknown): v is Record<string, unknown> { return typeof v === "object" && v !== null && !Array.isArray(v); }
function isSafeId(v: unknown): v is string { return typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v); }

const VALID_OPS = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "includes", "exists"]);
const SAFE_FIELD = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/;

function validateCond(cond: unknown, nodeId: string): string[] {
  const err: string[] = [];
  if (!isObject(cond)) return err;
  const c = cond as Record<string, unknown>;
  if (typeof c.field !== "string" || !SAFE_FIELD.test(c.field)) err.push(`Node "${nodeId}" edge has invalid condition field`);
  if (typeof c.operator !== "string" || !VALID_OPS.has(c.operator)) err.push(`Node "${nodeId}" edge has invalid condition operator: ${String(c.operator)}`);
  return err;
}

export function validateWorkflowGraph(graph: unknown): WorkflowValidationResult {
  const errors: string[] = [];
  if (!isObject(graph)) return { valid: false, errors: ["Graph must be an object"] };
  const c = graph as Partial<WorkflowGraph>;

  if (!isSafeId(c.id)) errors.push("Graph must have a safe string id");
  if (!c.name || typeof c.name !== "string") errors.push("Graph must have a string name");
  if (!c.version || typeof c.version !== "string") errors.push("Graph must have a string version");
  if (!Array.isArray(c.nodes) || c.nodes.length === 0) errors.push("Graph must have at least one node");
  if (Array.isArray(c.nodes) && c.nodes.length > MAX_WORKFLOW_NODES) errors.push(`Graph cannot exceed ${MAX_WORKFLOW_NODES} nodes`);
  if (!Array.isArray(c.edges)) errors.push("Graph must have an edges array");
  if (Array.isArray(c.edges) && c.edges.length > MAX_WORKFLOW_EDGES) errors.push(`Graph cannot exceed ${MAX_WORKFLOW_EDGES} edges`);
  if (!Array.isArray(c.nodes) || !Array.isArray(c.edges)) return { valid: false, errors };

  const nodeIds = new Set(c.nodes.map(n => isObject(n) ? n.id : undefined));
  if (nodeIds.size !== c.nodes.length) errors.push("Graph contains duplicate node IDs");

  for (const n of c.nodes) {
    if (!isObject(n)) { errors.push("Node must be an object"); continue; }
    if (!isSafeId(n.id)) errors.push("Node must have a safe string id");
    if (!new Set(["terminal","filesystem","browser","approval","wait","assertion","verification","helper","loop"]).has(String(n.kind))) errors.push(`Node "${String(n.id)}" has invalid kind: ${String(n.kind)}`);
    if (!isObject(n.input)) errors.push(`Node "${String(n.id)}" must have an input object`);
    if (isObject(n.retry)) {
      if (!Number.isInteger(Number(n.retry.maxAttempts)) || Number(n.retry.maxAttempts) < 1 || Number(n.retry.maxAttempts) > 10) errors.push(`Node "${String(n.id)}" retry.maxAttempts must be 1-10`);
    }
    if (n.kind === "loop") {
      const lc = n.loopConfig;
      if (!lc || !Number.isInteger(lc.maxIterations) || lc.maxIterations < 1 || lc.maxIterations > MAX_LOOP_ITERATIONS) errors.push(`Loop node "${String(n.id)}" requires loopConfig.maxIterations 1-${MAX_LOOP_ITERATIONS}`);
    }
  }

  for (const e of c.edges) {
    if (!isObject(e)) { errors.push("Edge must be an object"); continue; }
    if (!nodeIds.has(e.from)) errors.push(`Edge references unknown source: ${String(e.from)}`);
    if (!nodeIds.has(e.to)) errors.push(`Edge references unknown target: ${String(e.to)}`);
    if (isObject(e.condition)) errors.push(...validateCond(e.condition, e.from));
  }

  if (c.entryNodeId && !nodeIds.has(c.entryNodeId)) errors.push(`Entry node "${c.entryNodeId}" not found`);

  // Cycle detection (loop nodes may have self-referencing edges)
  const outEdges = new Map<string, string[]>();
  for (const e of c.edges) { if (!outEdges.has(e.from)) outEdges.set(e.from, []); outEdges.get(e.from)!.push(e.to); }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const loopSet = new Set(c.nodes.filter(n => isObject(n) && (n as WorkflowNode).kind === "loop").map(n => (isObject(n) ? n.id : "")));
  const hasCycle = (nodeId: string): boolean => {
    if (visiting.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    visiting.add(nodeId);
    for (const next of outEdges.get(nodeId) ?? []) {
      if (loopSet.has(nodeId) && next === nodeId) continue;
      if (hasCycle(next)) return true;
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return false;
  };
  for (const nid of nodeIds) {
    if (typeof nid === "string" && hasCycle(nid)) { errors.push(`Workflow graph contains a cycle at node "${nid}"`); break; }
  }

  if (c.stateSchema && isObject(c.stateSchema)) {
    for (const [key, type] of Object.entries(c.stateSchema)) {
      if (!SAFE_FIELD.test(key)) errors.push(`State schema key "${key}" is invalid`);
      if (type !== "string" && type !== "number" && type !== "boolean") errors.push(`State schema key "${key}" has unsupported type: ${type}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function evaluateCondition(cond: ConditionExpression, state: Record<string, string | number | boolean>): boolean {
  const v = state[cond.field];
  switch (cond.operator) {
    case "exists": return v !== undefined;
    case "eq": return v === cond.value;
    case "neq": return v !== cond.value;
    case "gt": return Number(v) > Number(cond.value);
    case "gte": return Number(v) >= Number(cond.value);
    case "lt": return Number(v) < Number(cond.value);
    case "lte": return Number(v) <= Number(cond.value);
    case "includes": return typeof v === "string" && typeof cond.value === "string" && v.includes(cond.value);
    default: return false;
  }
}
