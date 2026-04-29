/**
 * Workflow Store — Persistence layer for workflow graphs and runs.
 *
 * Uses MemoryStore with versioned key prefixes for durable storage.
 * All workflow state is JSON-serializable.
 */

import type { MemoryStore } from "../runtime/memory_store";
import type { WorkflowGraph, WorkflowRun } from "./types";

const GRAPH_PREFIX = "wf:graph:v1:";
const RUN_PREFIX = "wf:run:v1:";

export class WorkflowStore {
  constructor(private readonly store: MemoryStore) {}

  // ── Graph CRUD ────────────────────────────────────────────────────

  saveGraph(graph: WorkflowGraph): void {
    this.store.set(`${GRAPH_PREFIX}${graph.id}`, graph);
  }

  getGraph(graphId: string): WorkflowGraph | null {
    return this.store.get<WorkflowGraph>(`${GRAPH_PREFIX}${graphId}`);
  }

  listGraphs(): WorkflowGraph[] {
    const keys = this.store.keys(GRAPH_PREFIX);
    return keys
      .map(k => this.store.get<WorkflowGraph>(k))
      .filter((g): g is WorkflowGraph => g !== null);
  }

  deleteGraph(graphId: string): void {
    this.store.delete(`${GRAPH_PREFIX}${graphId}`);
  }

  // ── Run CRUD ──────────────────────────────────────────────────────

  saveRun(run: WorkflowRun): void {
    this.store.set(`${RUN_PREFIX}${run.id}`, run);
  }

  getRun(runId: string): WorkflowRun | null {
    return this.store.get<WorkflowRun>(`${RUN_PREFIX}${runId}`);
  }

  listRuns(): WorkflowRun[] {
    const keys = this.store.keys(RUN_PREFIX);
    return keys
      .map(k => this.store.get<WorkflowRun>(k))
      .filter((r): r is WorkflowRun => r !== null);
  }

  deleteRun(runId: string): void {
    this.store.delete(`${RUN_PREFIX}${runId}`);
  }
}
