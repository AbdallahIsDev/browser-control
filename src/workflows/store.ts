/**
 * Workflow Store — Persistence layer for workflow graphs and runs.
 *
 * Uses MemoryStore with versioned key prefixes for durable storage.
 * All workflow state is JSON-serializable.
 */

import type { MemoryStore } from "../runtime/memory_store";
import {
  type CredentialProtectionService,
  createCredentialProtectionService,
} from "../security/credential_provider";
import type { WorkflowGraph, WorkflowRun } from "./types";

const GRAPH_PREFIX = "wf:graph:v1:";
const RUN_PREFIX = "wf:run:v1:";
const PROTECTED_WORKFLOW_STORE_VERSION = 1;

export interface WorkflowStoreOptions {
  credentialProtection?: CredentialProtectionService;
}

interface ProtectedWorkflowStoreRecord {
  protected: true;
  formatVersion: typeof PROTECTED_WORKFLOW_STORE_VERSION;
  recordType: "graph" | "run";
  id: string;
  encryption: "credential-protection-service";
  encryptedPayload: string;
}

function isProtectedWorkflowStoreRecord(value: unknown): value is ProtectedWorkflowStoreRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { protected?: unknown }).protected === true &&
    (value as { formatVersion?: unknown }).formatVersion === PROTECTED_WORKFLOW_STORE_VERSION &&
    ((value as { recordType?: unknown }).recordType === "graph" ||
      (value as { recordType?: unknown }).recordType === "run") &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { encryptedPayload?: unknown }).encryptedPayload === "string"
  );
}

export class WorkflowStore {
  private readonly credentialProtection: CredentialProtectionService;

  constructor(
    private readonly store: MemoryStore,
    options: WorkflowStoreOptions = {},
  ) {
    this.credentialProtection = options.credentialProtection ?? createCredentialProtectionService();
  }

  // ── Graph CRUD ────────────────────────────────────────────────────

  saveGraph(graph: WorkflowGraph): void {
    this.store.set(`${GRAPH_PREFIX}${graph.id}`, this.protectValue(graph.id, "graph", graph));
  }

  getGraph(graphId: string): WorkflowGraph | null {
    const record = this.store.get<WorkflowGraph | ProtectedWorkflowStoreRecord>(`${GRAPH_PREFIX}${graphId}`);
    if (!record) return null;
    if (!isProtectedWorkflowStoreRecord(record)) return record;
    return this.unprotectValue<WorkflowGraph>(graphId, "graph", record);
  }

  listGraphs(): WorkflowGraph[] {
    const keys = this.store.keys(GRAPH_PREFIX);
    return keys
      .map(k => this.getGraph(k.slice(GRAPH_PREFIX.length)))
      .filter((g): g is WorkflowGraph => g !== null);
  }

  deleteGraph(graphId: string): void {
    this.store.delete(`${GRAPH_PREFIX}${graphId}`);
  }

  // ── Run CRUD ──────────────────────────────────────────────────────

  saveRun(run: WorkflowRun): void {
    this.store.set(`${RUN_PREFIX}${run.id}`, this.protectValue(run.id, "run", run));
  }

  getRun(runId: string): WorkflowRun | null {
    const record = this.store.get<WorkflowRun | ProtectedWorkflowStoreRecord>(`${RUN_PREFIX}${runId}`);
    if (!record) return null;
    if (!isProtectedWorkflowStoreRecord(record)) return record;
    return this.unprotectValue<WorkflowRun>(runId, "run", record);
  }

  listRuns(): WorkflowRun[] {
    const keys = this.store.keys(RUN_PREFIX);
    return keys
      .map(k => this.getRun(k.slice(RUN_PREFIX.length)))
      .filter((r): r is WorkflowRun => r !== null);
  }

  deleteRun(runId: string): void {
    this.store.delete(`${RUN_PREFIX}${runId}`);
  }

  private protectValue(
    id: string,
    recordType: ProtectedWorkflowStoreRecord["recordType"],
    value: unknown,
  ): ProtectedWorkflowStoreRecord {
    const encrypted = this.credentialProtection.protect(JSON.stringify(value));
    return {
      protected: true,
      formatVersion: PROTECTED_WORKFLOW_STORE_VERSION,
      recordType,
      id,
      encryption: "credential-protection-service",
      encryptedPayload: encrypted.toString("base64"),
    };
  }

  private unprotectValue<T>(
    id: string,
    recordType: ProtectedWorkflowStoreRecord["recordType"],
    record: ProtectedWorkflowStoreRecord,
  ): T | null {
    if (record.id !== id || record.recordType !== recordType) return null;
    try {
      return JSON.parse(
        this.credentialProtection.unprotect(Buffer.from(record.encryptedPayload, "base64")),
      ) as T;
    } catch {
      return null;
    }
  }
}
