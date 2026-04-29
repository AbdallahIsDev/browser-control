/**
 * Workflow Types — Core data models for the workflow graph runtime.
 *
 * These types define the durable workflow graph, node kinds, edges,
 * run state, and retry policies. They are designed to be JSON-serializable
 * for persistence in MemoryStore.
 */

// ── Retry Policy ──────────────────────────────────────────────────────

export interface RetryPolicy {
  maxAttempts: number;
  delayMs: number;
  backoff: "linear" | "exponential";
}

// ── Workflow Node ─────────────────────────────────────────────────────

export type WorkflowNodeKind =
  | "terminal"
  | "filesystem"
  | "browser"
  | "approval"
  | "wait"
  | "assertion"
  | "verification"
  | "helper";

export interface WorkflowNode {
  id: string;
  kind: WorkflowNodeKind;
  name?: string;
  input: Record<string, unknown>;
  retry?: RetryPolicy;
  timeoutMs?: number;
}

// ── Workflow Edge ─────────────────────────────────────────────────────

export interface WorkflowEdge {
  from: string;
  to: string;
  condition?: string;
}

// ── Workflow Graph ────────────────────────────────────────────────────

export interface WorkflowGraph {
  id: string;
  name: string;
  version: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  entryNodeId?: string;
  stateSchema?: unknown;
}

// ── Node Execution Result ─────────────────────────────────────────────

export interface WorkflowNodeResult {
  nodeId: string;
  status: "completed" | "failed" | "skipped" | "pending-approval";
  output?: unknown;
  error?: string;
  retryCount: number;
  startedAt: string;
  completedAt?: string;
  policyDecision?: string;
  artifacts?: Array<{ kind: string; path: string }>;
}

// ── Workflow Run ──────────────────────────────────────────────────────

export type WorkflowRunStatus = "running" | "paused" | "completed" | "failed" | "canceled";

export interface WorkflowApprovalRecord {
  nodeId: string;
  approvedBy: string;
  approvedAt: string;
  metadata?: Record<string, unknown>;
}

export interface WorkflowRun {
  id: string;
  graphId: string;
  graphName: string;
  status: WorkflowRunStatus;
  currentNodeId?: string;
  nodeResults: Record<string, WorkflowNodeResult>;
  approvals: WorkflowApprovalRecord[];
  artifacts: Array<{ kind: string; path: string }>;
  failures: Array<{ nodeId: string; error: string; timestamp: string }>;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  sessionId?: string;
}

// ── Workflow Validation ───────────────────────────────────────────────

export interface WorkflowValidationResult {
  valid: boolean;
  errors: string[];
}

export const MAX_WORKFLOW_NODES = 100;
export const MAX_WORKFLOW_EDGES = 200;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

/**
 * Validate a workflow graph for structural correctness.
 */
export function validateWorkflowGraph(graph: unknown): WorkflowValidationResult {
  const errors: string[] = [];

  if (!isObject(graph)) {
    return { valid: false, errors: ["Graph must be an object"] };
  }

  const candidate = graph as Partial<WorkflowGraph>;

  if (!isSafeId(candidate.id)) {
    errors.push("Graph must have a safe string id");
  }
  if (!candidate.name || typeof candidate.name !== "string") {
    errors.push("Graph must have a string name");
  }
  if (!candidate.version || typeof candidate.version !== "string") {
    errors.push("Graph must have a string version");
  }
  if (!Array.isArray(candidate.nodes) || candidate.nodes.length === 0) {
    errors.push("Graph must have at least one node");
  }
  if (Array.isArray(candidate.nodes) && candidate.nodes.length > MAX_WORKFLOW_NODES) {
    errors.push(`Graph cannot exceed ${MAX_WORKFLOW_NODES} nodes`);
  }
  if (!Array.isArray(candidate.edges)) {
    errors.push("Graph must have an edges array");
  }
  if (Array.isArray(candidate.edges) && candidate.edges.length > MAX_WORKFLOW_EDGES) {
    errors.push(`Graph cannot exceed ${MAX_WORKFLOW_EDGES} edges`);
  }

  if (!Array.isArray(candidate.nodes) || !Array.isArray(candidate.edges)) {
    return { valid: false, errors };
  }

  const nodeIds = new Set(candidate.nodes.map(n => isObject(n) ? n.id : undefined));

  // Check for duplicate node IDs
  if (nodeIds.size !== candidate.nodes.length) {
    errors.push("Graph contains duplicate node IDs");
  }

  // Validate node kinds
  const validKinds: Set<string> = new Set([
    "terminal", "filesystem", "browser", "approval", "wait",
    "assertion", "verification", "helper",
  ]);
  for (const node of candidate.nodes) {
    if (!isObject(node)) {
      errors.push("Node must be an object");
      continue;
    }
    if (!isSafeId(node.id)) {
      errors.push("Node must have a safe string id");
    }
    if (!validKinds.has(String(node.kind))) {
      errors.push(`Node "${String(node.id)}" has invalid kind: ${String(node.kind)}`);
    }
    if (!isObject(node.input)) {
      errors.push(`Node "${String(node.id)}" must have an input object`);
    }
    if (isObject(node.retry)) {
      const maxAttempts = Number(node.retry.maxAttempts);
      const delayMs = Number(node.retry.delayMs);
      if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
        errors.push(`Node "${String(node.id)}" retry.maxAttempts must be between 1 and 10`);
      }
      if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > 60000) {
        errors.push(`Node "${String(node.id)}" retry.delayMs must be between 0 and 60000`);
      }
      if (node.retry.backoff !== "linear" && node.retry.backoff !== "exponential") {
        errors.push(`Node "${String(node.id)}" retry.backoff must be linear or exponential`);
      }
    }
  }

  // Validate edges reference existing nodes
  const outgoingCounts = new Map<string, number>();
  for (const edge of candidate.edges) {
    if (!isObject(edge)) {
      errors.push("Edge must be an object");
      continue;
    }
    if (!nodeIds.has(edge.from)) {
      errors.push(`Edge references unknown source node: ${String(edge.from)}`);
    }
    if (!nodeIds.has(edge.to)) {
      errors.push(`Edge references unknown target node: ${String(edge.to)}`);
    }
    if (typeof edge.condition === "string" && edge.condition.length > 0) {
      errors.push("Conditional edges are not supported in v1");
    }
    if (typeof edge.from === "string") {
      outgoingCounts.set(edge.from, (outgoingCounts.get(edge.from) ?? 0) + 1);
    }
  }
  for (const [nodeId, count] of outgoingCounts) {
    if (count > 1) {
      errors.push(`Node "${nodeId}" has multiple outgoing edges; branching is not supported in v1`);
    }
  }

  // Validate entry node
  if (candidate.entryNodeId && !nodeIds.has(candidate.entryNodeId)) {
    errors.push(`Entry node "${candidate.entryNodeId}" not found in nodes`);
  }

  // Reject cycles for the v1 single-path runtime.
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const nextByNode = new Map(candidate.edges.map(edge => [edge.from, edge.to]));
  const visit = (nodeId: string): void => {
    if (visiting.has(nodeId)) {
      errors.push(`Workflow graph contains a cycle at node "${nodeId}"`);
      return;
    }
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    const next = nextByNode.get(nodeId);
    if (typeof next === "string" && nodeIds.has(next)) visit(next);
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  for (const nodeId of nodeIds) {
    if (typeof nodeId === "string") visit(nodeId);
  }

  return { valid: errors.length === 0, errors };
}
