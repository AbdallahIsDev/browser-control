/**
 * Product state storage interface and JSON-file durable backend.
 *
 * Implements a storage adapter that persists tasks, automations, workflows,
 * approvals, evidence indexes, trading supervisor jobs, and audit events.
 *
 * SQLite migration target: `state/app.sqlite`.
 * Current backend: SQLite (preferred) or JSON files.
 *
 * This adapter is designed so that swapping to better-sqlite3 requires only
 * implementing the same interface in a new module.
 */

import fs from "node:fs";
import path from "node:path";
import { getStateDir } from "../shared/paths";
import { SqliteStateStorage } from "./sqlite";

// ── Types ────────────────────────────────────────────────────────────────

export interface StoredTask {
  id: string;
  prompt: string;
  skill?: string;
  action?: string;
  params?: Record<string, unknown>;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  result?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  sessionId?: string;
}

export interface StoredAutomation {
  id: string;
  name: string;
  description: string;
  prompt: string;
  category?: string;
  source: "built-in" | "user" | "task";
  status: "ready" | "last-run";
  approvalRequired: boolean;
  variableNames?: string[];
  domains?: string[];
  retryStrategy?: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  runCount: number;
}

export interface StoredWorkflowDefinition {
  id: string;
  name: string;
  description?: string;
  graph: WorkflowNode[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowNode {
  id: string;
  type: string;
  params?: Record<string, unknown>;
  dependsOn?: string[];
  approvalRequired?: boolean;
}

export interface StoredWorkflowRun {
  id: string;
  workflowId: string;
  status: "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";
  currentNodeId?: string;
  results?: Record<string, unknown>;
  error?: string;
  startedAt: string;
  completedAt?: string;
}

export interface StoredApproval {
  id: string;
  actionId: string;
  actionType: string;
  description: string;
  status: "pending" | "approved" | "denied";
  approvedBy?: string;
  approvedAt?: string;
  deniedReason?: string;
  createdAt: string;
}

export interface StoredPackageEval {
  packageName: string;
  version: string;
  evalResult: "pass" | "fail" | "warn";
  details?: string;
  evaluatedAt: string;
}

export interface StoredEvidence {
  id: string;
  taskId: string;
  type: "screenshot" | "debug-bundle" | "receipt" | "log" | "artifact";
  path?: string;
  description?: string;
  createdAt: string;
}

export interface StoredAuditEvent {
  id: string;
  action: string;
  sessionId?: string;
  userId?: string;
  policyDecision?: string;
  details?: string;
  timestamp: string;
}

export interface StoredTradePlan {
  id: string;
  planId: string;
  symbol: string;
  side: "buy" | "sell";
  mode: "analysis_only" | "paper" | "live_assisted" | "live_supervised";
  status: "draft" | "active" | "completed" | "cancelled";
  riskPercent: number;
  thesis: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredOrderTicket {
  id: string;
  planId: string;
  mode: string;
  account: string;
  platform: string;
  symbol: string;
  side: string;
  size: number;
  entry: number;
  stopLoss?: number;
  targets: number[];
  status: "pending" | "approved" | "executed" | "rejected";
  approval?: {
    approvedAt: string;
    approvedBy: string;
  };
  createdAt: string;
  executedAt?: string;
}

export interface StoredSupervisorJob {
  id: string;
  tradeId: string;
  symbol: string;
  side: string;
  mode: string;
  interval: number;
  status: "active" | "paused" | "completed" | "stopped";
  decidedAt: string;
  lastCheck?: string;
  createdAt: string;
}

export interface StoredSupervisorDecision {
  id: string;
  tradeId: string;
  decision: string;
  confidence: string;
  riskState: string;
  reason: string;
  requiresApproval: boolean;
  proposedActions?: string[];
  createdAt: string;
}

// ── Storage Interface ────────────────────────────────────────────────────

export interface StateStorage {
  // Tasks
  saveTask(task: StoredTask): Promise<void>;
  getTask(id: string): Promise<StoredTask | null>;
  listTasks(): Promise<StoredTask[]>;
  deleteTask(id: string): Promise<void>;

  // Automations
  saveAutomation(automation: StoredAutomation): Promise<void>;
  getAutomation(id: string): Promise<StoredAutomation | null>;
  listAutomations(): Promise<StoredAutomation[]>;
  deleteAutomation(id: string): Promise<void>;

  // Workflow Definitions
  saveWorkflowDefinition(def: StoredWorkflowDefinition): Promise<void>;
  getWorkflowDefinition(id: string): Promise<StoredWorkflowDefinition | null>;
  listWorkflowDefinitions(): Promise<StoredWorkflowDefinition[]>;
  deleteWorkflowDefinition(id: string): Promise<void>;

  // Workflow Runs
  saveWorkflowRun(run: StoredWorkflowRun): Promise<void>;
  getWorkflowRun(id: string): Promise<StoredWorkflowRun | null>;
  listWorkflowRuns(): Promise<StoredWorkflowRun[]>;

  // Approvals
  saveApproval(approval: StoredApproval): Promise<void>;
  getApproval(id: string): Promise<StoredApproval | null>;
  listApprovals(status?: string): Promise<StoredApproval[]>;

  // Evidence
  saveEvidence(evidence: StoredEvidence): Promise<void>;
  listEvidence(taskId?: string): Promise<StoredEvidence[]>;

  // Audit
  saveAuditEvent(event: StoredAuditEvent): Promise<void>;
  listAuditEvents(limit?: number): Promise<StoredAuditEvent[]>;

  // Trading State
  saveTradePlan(plan: StoredTradePlan): Promise<void>;
  listTradePlans(): Promise<StoredTradePlan[]>;
  saveOrderTicket(ticket: StoredOrderTicket): Promise<void>;
  listOrderTickets(): Promise<StoredOrderTicket[]>;
  saveSupervisorJob(job: StoredSupervisorJob): Promise<void>;
  listSupervisorJobs(): Promise<StoredSupervisorJob[]>;
  saveSupervisorDecision(decision: StoredSupervisorDecision): Promise<void>;
  listSupervisorDecisions(tradeId?: string): Promise<StoredSupervisorDecision[]>;

  // Package Evals
  savePackageEval(evalResult: StoredPackageEval): Promise<void>;
  listPackageEvals(): Promise<StoredPackageEval[]>;

  // Lifecycle
  close(): void;
}

// ── JSON File Backend ────────────────────────────────────────────────────

/**
 * JSON-file durable backend for product state.
 *
 * Each collection is stored as a JSON array in a separate file under
 * `<state-dir>/collections/<name>.json`.
 *
 * This is the first durable backend. When SQLite is ready, implement
 * the same StateStorage interface with better-sqlite3 and swap here.
 */
export class JsonFileStateStorage implements StateStorage {
  private baseDir: string;
  private collections: Map<string, unknown[]> = new Map();
  private dirty = false;

  constructor(dataHome?: string) {
    this.baseDir = path.join(getStateDir(dataHome), "collections");
    fs.mkdirSync(this.baseDir, { recursive: true, mode: 0o700 });
  }

  private collectionPath(name: string): string {
    return path.join(this.baseDir, `${name}.json`);
  }

  private loadCollection<T>(name: string): T[] {
    const cached = this.collections.get(name);
    if (cached) return cached as T[];
    const filePath = this.collectionPath(name);
    if (fs.existsSync(filePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        const arr = Array.isArray(data) ? data : [];
        this.collections.set(name, arr);
        return arr as T[];
      } catch {
        // Corrupted file — start fresh
      }
    }
    const arr: T[] = [];
    this.collections.set(name, arr);
    return arr;
  }

  private saveCollection<T>(name: string, data: T[]): void {
    this.collections.set(name, data);
    this.dirty = true;
    const filePath = this.collectionPath(name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
    this.dirty = false;
  }

  private findById<T extends { id: string }>(items: T[], id: string): T | undefined {
    return items.find((item) => item.id === id);
  }

  private upsertById<T extends { id: string }>(items: T[], item: T): void {
    const idx = items.findIndex((i) => i.id === item.id);
    if (idx >= 0) items[idx] = item;
    else items.push(item);
  }

  private deleteById<T extends { id: string }>(items: T[], id: string): void {
    const idx = items.findIndex((i) => i.id === id);
    if (idx >= 0) items.splice(idx, 1);
  }

  // ── Tasks ──

  async saveTask(task: StoredTask): Promise<void> {
    const items = this.loadCollection<StoredTask>("tasks");
    this.upsertById(items, task);
    this.saveCollection("tasks", items);
  }

  async getTask(id: string): Promise<StoredTask | null> {
    const items = this.loadCollection<StoredTask>("tasks");
    return this.findById(items, id) ?? null;
  }

  async listTasks(): Promise<StoredTask[]> {
    return this.loadCollection<StoredTask>("tasks");
  }

  async deleteTask(id: string): Promise<void> {
    const items = this.loadCollection<StoredTask>("tasks");
    this.deleteById(items, id);
    this.saveCollection("tasks", items);
  }

  // ── Automations ──

  async saveAutomation(automation: StoredAutomation): Promise<void> {
    const items = this.loadCollection<StoredAutomation>("automations");
    this.upsertById(items, automation);
    this.saveCollection("automations", items);
  }

  async getAutomation(id: string): Promise<StoredAutomation | null> {
    const items = this.loadCollection<StoredAutomation>("automations");
    return this.findById(items, id) ?? null;
  }

  async listAutomations(): Promise<StoredAutomation[]> {
    return this.loadCollection<StoredAutomation>("automations");
  }

  async deleteAutomation(id: string): Promise<void> {
    const items = this.loadCollection<StoredAutomation>("automations");
    this.deleteById(items, id);
    this.saveCollection("automations", items);
  }

  // ── Workflow Definitions ──

  async saveWorkflowDefinition(def: StoredWorkflowDefinition): Promise<void> {
    const items = this.loadCollection<StoredWorkflowDefinition>("workflow_defs");
    this.upsertById(items, def);
    this.saveCollection("workflow_defs", items);
  }

  async getWorkflowDefinition(id: string): Promise<StoredWorkflowDefinition | null> {
    const items = this.loadCollection<StoredWorkflowDefinition>("workflow_defs");
    return this.findById(items, id) ?? null;
  }

  async listWorkflowDefinitions(): Promise<StoredWorkflowDefinition[]> {
    return this.loadCollection<StoredWorkflowDefinition>("workflow_defs");
  }

  async deleteWorkflowDefinition(id: string): Promise<void> {
    const items = this.loadCollection<StoredWorkflowDefinition>("workflow_defs");
    this.deleteById(items, id);
    this.saveCollection("workflow_defs", items);
  }

  // ── Workflow Runs ──

  async saveWorkflowRun(run: StoredWorkflowRun): Promise<void> {
    const items = this.loadCollection<StoredWorkflowRun>("workflow_runs");
    this.upsertById(items, run);
    this.saveCollection("workflow_runs", items);
  }

  async getWorkflowRun(id: string): Promise<StoredWorkflowRun | null> {
    const items = this.loadCollection<StoredWorkflowRun>("workflow_runs");
    return this.findById(items, id) ?? null;
  }

  async listWorkflowRuns(): Promise<StoredWorkflowRun[]> {
    return this.loadCollection<StoredWorkflowRun>("workflow_runs");
  }

  // ── Approvals ──

  async saveApproval(approval: StoredApproval): Promise<void> {
    const items = this.loadCollection<StoredApproval>("approvals");
    this.upsertById(items, approval);
    this.saveCollection("approvals", items);
  }

  async getApproval(id: string): Promise<StoredApproval | null> {
    const items = this.loadCollection<StoredApproval>("approvals");
    return this.findById(items, id) ?? null;
  }

  async listApprovals(status?: string): Promise<StoredApproval[]> {
    const items = this.loadCollection<StoredApproval>("approvals");
    if (status) return items.filter((a) => a.status === status);
    return items;
  }

  // ── Evidence ──

  async saveEvidence(evidence: StoredEvidence): Promise<void> {
    const items = this.loadCollection<StoredEvidence>("evidence");
    this.upsertById(items, evidence);
    this.saveCollection("evidence", items);
  }

  async listEvidence(taskId?: string): Promise<StoredEvidence[]> {
    const items = this.loadCollection<StoredEvidence>("evidence");
    if (taskId) return items.filter((e) => e.taskId === taskId);
    return items;
  }

  // ── Audit ──

  async saveAuditEvent(event: StoredAuditEvent): Promise<void> {
    const items = this.loadCollection<StoredAuditEvent>("audit_events");
    items.push(event);
    // Keep only last 1000 audit events
    if (items.length > 1000) items.splice(0, items.length - 1000);
    this.saveCollection("audit_events", items);
  }

  async listAuditEvents(limit = 100): Promise<StoredAuditEvent[]> {
    const items = this.loadCollection<StoredAuditEvent>("audit_events");
    return items.slice(-limit).reverse();
  }

  // ── Trading State ──

  async saveTradePlan(plan: StoredTradePlan): Promise<void> {
    const items = this.loadCollection<StoredTradePlan>("trade_plans");
    this.upsertById(items, plan);
    this.saveCollection("trade_plans", items);
  }

  async listTradePlans(): Promise<StoredTradePlan[]> {
    return this.loadCollection<StoredTradePlan>("trade_plans");
  }

  async saveOrderTicket(ticket: StoredOrderTicket): Promise<void> {
    const items = this.loadCollection<StoredOrderTicket>("order_tickets");
    this.upsertById(items, ticket);
    this.saveCollection("order_tickets", items);
  }

  async listOrderTickets(): Promise<StoredOrderTicket[]> {
    return this.loadCollection<StoredOrderTicket>("order_tickets");
  }

  async saveSupervisorJob(job: StoredSupervisorJob): Promise<void> {
    const items = this.loadCollection<StoredSupervisorJob>("supervisor_jobs");
    this.upsertById(items, job);
    this.saveCollection("supervisor_jobs", items);
  }

  async listSupervisorJobs(): Promise<StoredSupervisorJob[]> {
    return this.loadCollection<StoredSupervisorJob>("supervisor_jobs");
  }

  async saveSupervisorDecision(decision: StoredSupervisorDecision): Promise<void> {
    const items = this.loadCollection<StoredSupervisorDecision>("supervisor_decisions");
    items.push(decision);
    if (items.length > 1000) items.splice(0, items.length - 1000);
    this.saveCollection("supervisor_decisions", items);
  }

  async listSupervisorDecisions(tradeId?: string): Promise<StoredSupervisorDecision[]> {
    const items = this.loadCollection<StoredSupervisorDecision>("supervisor_decisions");
    if (tradeId) return items.filter((d) => d.tradeId === tradeId);
    return items;
  }

  // ── Package Evals ──

  async savePackageEval(evalResult: StoredPackageEval): Promise<void> {
    const items = this.loadCollection<StoredPackageEval>("package_evals");
    items.push(evalResult);
    if (items.length > 500) items.splice(0, items.length - 500);
    this.saveCollection("package_evals", items);
  }

  async listPackageEvals(): Promise<StoredPackageEval[]> {
    return this.loadCollection<StoredPackageEval>("package_evals");
  }

  // ── Lifecycle ──

  close(): void {
    if (this.dirty) {
      // Force-sync all dirty collections
      for (const [name, data] of this.collections) {
        const filePath = this.collectionPath(name);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
      }
      this.dirty = false;
    }
    this.collections.clear();
  }
}

// ── Factory ──────────────────────────────────────────────────────────────

let _globalStorage: StateStorage | null = null;

export function getStateStorage(dataHome?: string): StateStorage {
	if (!_globalStorage) {
		const backend = process.env.BROWSER_CONTROL_STATE_BACKEND || "sqlite";

		if (backend === "json") {
			console.warn(
				"WARNING: Using legacy JSON file state storage as explicitly requested.",
			);
			_globalStorage = new JsonFileStateStorage(dataHome);
		} else {
			try {
				_globalStorage = new SqliteStateStorage(dataHome);
			} catch (error) {
				console.error("FATAL: Failed to initialize SQLite state storage.");
				console.error(error instanceof Error ? error.message : String(error));
				throw new Error(
					`Failed to initialize durable SQLite storage at ${path.join(getStateDir(dataHome), "app.sqlite")}. ` +
						"The application cannot start without durable storage.",
				);
			}
		}
	}
	return _globalStorage;
}

export function resetStateStorage(): void {
  if (_globalStorage) {
    _globalStorage.close();
    _globalStorage = null;
  }
}