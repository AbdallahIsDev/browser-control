import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isMalformedError, quarantineDatabase, safeInitDatabase } from "../shared/sqlite_util";
import { getStateDir } from "../shared/paths";
import { logger } from "../shared/logger";
import type {
  StateStorage,
  StoredTask,
  StoredAutomation,
  StoredWorkflowDefinition,
  StoredWorkflowRun,
  StoredApproval,
  StoredEvidence,
  StoredAuditEvent,
  StoredTradePlan,
  StoredOrderTicket,
  StoredSupervisorJob,
  StoredSupervisorDecision,
  StoredPackageEval,
  StoredSecret,
  StoredSecretGrant,
  StoredNetworkRule,
  StoredSecretAuditEvent,
} from "./index";

const log = logger.withComponent("sqlite-state");

export class SqliteStateStorage implements StateStorage {
  private db: DatabaseSync;
  private readonly dbPath: string;

	constructor(dataHome?: string) {
		const stateDir = getStateDir(dataHome);
		this.dbPath = path.join(stateDir, "app.sqlite");

		try {
			fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
			this.db = safeInitDatabase(this.dbPath, { component: "state-storage" });

			// Enable WAL mode
			this.db.exec("PRAGMA journal_mode=WAL");

			this.initSchema();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`Failed to initialize SQLite state storage at ${this.dbPath}: ${message}`);
		}
	}

  private safeExecute<T>(fn: () => T): T {
    try {
      return fn();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isMalformedError(message)) {
        log.error(`Runtime malformed database error in SqliteStateStorage: ${message}. Quarantining...`);
        try {
          this.db.close();
          quarantineDatabase(this.dbPath, message, { component: "state-storage" });
        } catch (quarantineErr) {
          log.error(`Failed to quarantine state database: ${quarantineErr}`);
        }
        // For durable state, we fail clearly after quarantine instead of
        // auto-recreating a fresh (empty) DB at runtime, to prevent
        // surprising the user with lost data.
        throw new Error(
          `Critical: SQLite state database at ${this.dbPath} is malformed. ` +
          "It has been moved to quarantine. The application must be restarted to initialize a fresh database.",
        );
      }
      throw error;
    }
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        data_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS automations (
        id TEXT PRIMARY KEY,
        data_json TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS workflow_defs (
        id TEXT PRIMARY KEY,
        data_json TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS workflow_runs (
        id TEXT PRIMARY KEY,
        data_json TEXT NOT NULL,
        workflow_id TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        data_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS evidence (
        id TEXT PRIMARY KEY,
        data_json TEXT NOT NULL,
        task_id TEXT NOT NULL,
        type TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        data_json TEXT NOT NULL,
        timestamp TEXT NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS trade_plans (
        id TEXT PRIMARY KEY,
        data_json TEXT NOT NULL,
        plan_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS order_tickets (
        id TEXT PRIMARY KEY,
        data_json TEXT NOT NULL,
        plan_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS supervisor_jobs (
        id TEXT PRIMARY KEY,
        data_json TEXT NOT NULL,
        trade_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS supervisor_decisions (
        id TEXT PRIMARY KEY,
        data_json TEXT NOT NULL,
        trade_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS package_evals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        data_json TEXT NOT NULL,
        package_name TEXT NOT NULL,
        evaluated_at TEXT NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_id ON workflow_runs(workflow_id);
      CREATE INDEX IF NOT EXISTS idx_evidence_task_id ON evidence(task_id);
      CREATE INDEX IF NOT EXISTS idx_trade_plans_plan_id ON trade_plans(plan_id);
      CREATE INDEX IF NOT EXISTS idx_order_tickets_plan_id ON order_tickets(plan_id);
      CREATE INDEX IF NOT EXISTS idx_supervisor_jobs_trade_id ON supervisor_jobs(trade_id);
      CREATE INDEX IF NOT EXISTS idx_supervisor_decisions_trade_id ON supervisor_decisions(trade_id);
      
      CREATE TABLE IF NOT EXISTS secrets (
        id TEXT PRIMARY KEY,
        data_json TEXT NOT NULL,
        scope TEXT NOT NULL,
        scope_name TEXT NOT NULL,
        secret_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        encrypted_value BLOB NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS secret_grants (
        id TEXT PRIMARY KEY,
        data_json TEXT NOT NULL,
        secret_id TEXT NOT NULL,
        action TEXT NOT NULL,
        revoked INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS network_rules (
        id TEXT PRIMARY KEY,
        data_json TEXT NOT NULL,
        pattern TEXT NOT NULL,
        rule_type TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        source TEXT NOT NULL DEFAULT 'user',
        created_at TEXT NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS secret_audit_events (
        id TEXT PRIMARY KEY,
        data_json TEXT NOT NULL,
        secret_id TEXT NOT NULL,
        timestamp TEXT NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_secret_grants_secret_id ON secret_grants(secret_id);
      CREATE INDEX IF NOT EXISTS idx_secret_audit_secret_id ON secret_audit_events(secret_id);
    `);
  }

  // ── Tasks ──
  async saveTask(task: StoredTask): Promise<void> {
    return this.safeExecute(() => {
      const stmt = this.db.prepare(`
        INSERT INTO tasks (id, data_json, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          data_json = excluded.data_json,
          status = excluded.status,
          updated_at = excluded.updated_at
      `);
      stmt.run(task.id, JSON.stringify(task), task.status, task.createdAt, task.updatedAt);
    });
  }

  async getTask(id: string): Promise<StoredTask | null> {
    return this.safeExecute(() => {
      const stmt = this.db.prepare("SELECT data_json FROM tasks WHERE id = ?");
      const row = stmt.get(id) as { data_json: string } | undefined;
      return row ? JSON.parse(row.data_json) : null;
    });
  }

  async listTasks(): Promise<StoredTask[]> {
    return this.safeExecute(() => {
      const rows = this.db.prepare("SELECT data_json FROM tasks ORDER BY created_at DESC").all() as Array<{ data_json: string }>;
      return rows.map(r => JSON.parse(r.data_json));
    });
  }

  async deleteTask(id: string): Promise<void> {
    return this.safeExecute(() => {
      this.db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
    });
  }

  // ── Automations ──
  async saveAutomation(automation: StoredAutomation): Promise<void> {
    return this.safeExecute(() => {
      const stmt = this.db.prepare(`
        INSERT INTO automations (id, data_json, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          data_json = excluded.data_json,
          name = excluded.name,
          updated_at = excluded.updated_at
      `);
      stmt.run(automation.id, JSON.stringify(automation), automation.name, automation.createdAt, automation.updatedAt);
    });
  }

  async getAutomation(id: string): Promise<StoredAutomation | null> {
    return this.safeExecute(() => {
      const stmt = this.db.prepare("SELECT data_json FROM automations WHERE id = ?");
      const row = stmt.get(id) as { data_json: string } | undefined;
      return row ? JSON.parse(row.data_json) : null;
    });
  }

  async listAutomations(): Promise<StoredAutomation[]> {
    return this.safeExecute(() => {
      const rows = this.db.prepare("SELECT data_json FROM automations ORDER BY created_at DESC").all() as Array<{ data_json: string }>;
      return rows.map(r => JSON.parse(r.data_json));
    });
  }

  async deleteAutomation(id: string): Promise<void> {
    return this.safeExecute(() => {
      this.db.prepare("DELETE FROM automations WHERE id = ?").run(id);
    });
  }

  // ── Workflow Definitions ──
  async saveWorkflowDefinition(def: StoredWorkflowDefinition): Promise<void> {
    return this.safeExecute(() => {
      const stmt = this.db.prepare(`
        INSERT INTO workflow_defs (id, data_json, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          data_json = excluded.data_json,
          name = excluded.name,
          updated_at = excluded.updated_at
      `);
      stmt.run(def.id, JSON.stringify(def), def.name, def.createdAt, def.updatedAt);
    });
  }

  async getWorkflowDefinition(id: string): Promise<StoredWorkflowDefinition | null> {
    return this.safeExecute(() => {
      const stmt = this.db.prepare("SELECT data_json FROM workflow_defs WHERE id = ?");
      const row = stmt.get(id) as { data_json: string } | undefined;
      return row ? JSON.parse(row.data_json) : null;
    });
  }

  async listWorkflowDefinitions(): Promise<StoredWorkflowDefinition[]> {
    return this.safeExecute(() => {
      const rows = this.db.prepare("SELECT data_json FROM workflow_defs ORDER BY created_at DESC").all() as Array<{ data_json: string }>;
      return rows.map(r => JSON.parse(r.data_json));
    });
  }

  async deleteWorkflowDefinition(id: string): Promise<void> {
    return this.safeExecute(() => {
      this.db.prepare("DELETE FROM workflow_defs WHERE id = ?").run(id);
    });
  }

  // ── Workflow Runs ──
  async saveWorkflowRun(run: StoredWorkflowRun): Promise<void> {
    return this.safeExecute(() => {
      const stmt = this.db.prepare(`
        INSERT INTO workflow_runs (id, data_json, workflow_id, status, started_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          data_json = excluded.data_json,
          status = excluded.status
      `);
      stmt.run(run.id, JSON.stringify(run), run.workflowId, run.status, run.startedAt);
    });
  }

  async getWorkflowRun(id: string): Promise<StoredWorkflowRun | null> {
    return this.safeExecute(() => {
      const stmt = this.db.prepare("SELECT data_json FROM workflow_runs WHERE id = ?");
      const row = stmt.get(id) as { data_json: string } | undefined;
      return row ? JSON.parse(row.data_json) : null;
    });
  }

  async listWorkflowRuns(): Promise<StoredWorkflowRun[]> {
    return this.safeExecute(() => {
      const rows = this.db.prepare("SELECT data_json FROM workflow_runs ORDER BY started_at DESC").all() as Array<{ data_json: string }>;
      return rows.map(r => JSON.parse(r.data_json));
    });
  }

  // ── Approvals ──
  async saveApproval(approval: StoredApproval): Promise<void> {
    return this.safeExecute(() => {
      const stmt = this.db.prepare(`
        INSERT INTO approvals (id, data_json, status, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          data_json = excluded.data_json,
          status = excluded.status
      `);
      stmt.run(approval.id, JSON.stringify(approval), approval.status, approval.createdAt);
    });
  }

  async getApproval(id: string): Promise<StoredApproval | null> {
    return this.safeExecute(() => {
      const stmt = this.db.prepare("SELECT data_json FROM approvals WHERE id = ?");
      const row = stmt.get(id) as { data_json: string } | undefined;
      return row ? JSON.parse(row.data_json) : null;
    });
  }

  async listApprovals(status?: string): Promise<StoredApproval[]> {
    return this.safeExecute(() => {
      if (status) {
        const rows = this.db.prepare("SELECT data_json FROM approvals WHERE status = ? ORDER BY created_at DESC").all(status) as Array<{ data_json: string }>;
        return rows.map(r => JSON.parse(r.data_json));
      }
      const rows = this.db.prepare("SELECT data_json FROM approvals ORDER BY created_at DESC").all() as Array<{ data_json: string }>;
      return rows.map(r => JSON.parse(r.data_json));
    });
  }

  // ── Evidence ──
  async saveEvidence(evidence: StoredEvidence): Promise<void> {
    return this.safeExecute(() => {
      const stmt = this.db.prepare(`
        INSERT INTO evidence (id, data_json, task_id, type, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          data_json = excluded.data_json
      `);
      stmt.run(evidence.id, JSON.stringify(evidence), evidence.taskId, evidence.type, evidence.createdAt);
    });
  }

  async listEvidence(taskId?: string): Promise<StoredEvidence[]> {
    return this.safeExecute(() => {
      if (taskId) {
        const rows = this.db.prepare("SELECT data_json FROM evidence WHERE task_id = ? ORDER BY created_at DESC").all(taskId) as Array<{ data_json: string }>;
        return rows.map(r => JSON.parse(r.data_json));
      }
      const rows = this.db.prepare("SELECT data_json FROM evidence ORDER BY created_at DESC").all() as Array<{ data_json: string }>;
      return rows.map(r => JSON.parse(r.data_json));
    });
  }

  // ── Audit ──
  async saveAuditEvent(event: StoredAuditEvent): Promise<void> {
    return this.safeExecute(() => {
      const stmt = this.db.prepare(`
        INSERT INTO audit_events (id, data_json, timestamp)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO NOTHING
      `);
      stmt.run(event.id, JSON.stringify(event), event.timestamp);
      
      // Retention: keep last 1000
      this.db.exec("DELETE FROM audit_events WHERE id NOT IN (SELECT id FROM audit_events ORDER BY timestamp DESC LIMIT 1000)");
    });
  }

  async listAuditEvents(limit = 100): Promise<StoredAuditEvent[]> {
    return this.safeExecute(() => {
      const rows = this.db.prepare("SELECT data_json FROM audit_events ORDER BY timestamp DESC LIMIT ?").all(limit) as Array<{ data_json: string }>;
      return rows.map(r => JSON.parse(r.data_json));
    });
  }

  // ── Trading State ──
  async saveTradePlan(plan: StoredTradePlan): Promise<void> {
    return this.safeExecute(() => {
      const stmt = this.db.prepare(`
        INSERT INTO trade_plans (id, data_json, plan_id, symbol, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          data_json = excluded.data_json,
          status = excluded.status,
          updated_at = excluded.updated_at
      `);
      stmt.run(plan.id, JSON.stringify(plan), plan.planId, plan.symbol, plan.status, plan.createdAt, plan.updatedAt);
    });
  }

  async listTradePlans(): Promise<StoredTradePlan[]> {
    return this.safeExecute(() => {
      const rows = this.db.prepare("SELECT data_json FROM trade_plans ORDER BY created_at DESC").all() as Array<{ data_json: string }>;
      return rows.map(r => JSON.parse(r.data_json));
    });
  }

  async saveOrderTicket(ticket: StoredOrderTicket): Promise<void> {
    return this.safeExecute(() => {
      const stmt = this.db.prepare(`
        INSERT INTO order_tickets (id, data_json, plan_id, status, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          data_json = excluded.data_json,
          status = excluded.status
      `);
      stmt.run(ticket.id, JSON.stringify(ticket), ticket.planId, ticket.status, ticket.createdAt);
    });
  }

  async listOrderTickets(): Promise<StoredOrderTicket[]> {
    return this.safeExecute(() => {
      const rows = this.db.prepare("SELECT data_json FROM order_tickets ORDER BY created_at DESC").all() as Array<{ data_json: string }>;
      return rows.map(r => JSON.parse(r.data_json));
    });
  }

  async saveSupervisorJob(job: StoredSupervisorJob): Promise<void> {
    return this.safeExecute(() => {
      const stmt = this.db.prepare(`
        INSERT INTO supervisor_jobs (id, data_json, trade_id, status, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          data_json = excluded.data_json,
          status = excluded.status
      `);
      stmt.run(job.id, JSON.stringify(job), job.tradeId, job.status, job.createdAt);
    });
  }

  async listSupervisorJobs(): Promise<StoredSupervisorJob[]> {
    return this.safeExecute(() => {
      const rows = this.db.prepare("SELECT data_json FROM supervisor_jobs ORDER BY created_at DESC").all() as Array<{ data_json: string }>;
      return rows.map(r => JSON.parse(r.data_json));
    });
  }

  async saveSupervisorDecision(decision: StoredSupervisorDecision): Promise<void> {
    return this.safeExecute(() => {
      const stmt = this.db.prepare(`
        INSERT INTO supervisor_decisions (id, data_json, trade_id, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          data_json = excluded.data_json
      `);
      stmt.run(decision.id, JSON.stringify(decision), decision.tradeId, decision.createdAt);
      
      // Retention: keep last 1000
      this.db.exec("DELETE FROM supervisor_decisions WHERE id NOT IN (SELECT id FROM supervisor_decisions ORDER BY created_at DESC LIMIT 1000)");
    });
  }

  async listSupervisorDecisions(tradeId?: string): Promise<StoredSupervisorDecision[]> {
    return this.safeExecute(() => {
      if (tradeId) {
        const rows = this.db.prepare("SELECT data_json FROM supervisor_decisions WHERE trade_id = ? ORDER BY created_at DESC").all(tradeId) as Array<{ data_json: string }>;
        return rows.map(r => JSON.parse(r.data_json));
      }
      const rows = this.db.prepare("SELECT data_json FROM supervisor_decisions ORDER BY created_at DESC").all() as Array<{ data_json: string }>;
      return rows.map(r => JSON.parse(r.data_json));
    });
  }

  // ── Package Evals ──
  async savePackageEval(evalResult: StoredPackageEval): Promise<void> {
    return this.safeExecute(() => {
      const stmt = this.db.prepare(`
        INSERT INTO package_evals (data_json, package_name, evaluated_at)
        VALUES (?, ?, ?)
      `);
      stmt.run(JSON.stringify(evalResult), evalResult.packageName, evalResult.evaluatedAt);
      
      // Retention: keep last 500
      this.db.exec("DELETE FROM package_evals WHERE id NOT IN (SELECT id FROM package_evals ORDER BY evaluated_at DESC LIMIT 500)");
    });
  }

  async listPackageEvals(): Promise<StoredPackageEval[]> {
    return this.safeExecute(() => {
      const rows = this.db.prepare("SELECT data_json FROM package_evals ORDER BY evaluated_at DESC").all() as Array<{ data_json: string }>;
      return rows.map(r => JSON.parse(r.data_json));
    });
  }

  // ── Secrets ──
  async saveSecret(secret: StoredSecret): Promise<void> {
    return this.safeExecute(() => {
      const stmt = this.db.prepare(`
        INSERT INTO secrets (id, data_json, scope, scope_name, secret_name, created_at, updated_at, encrypted_value)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          data_json = excluded.data_json,
          encrypted_value = excluded.encrypted_value,
          updated_at = excluded.updated_at
      `);
      stmt.run(secret.id, JSON.stringify({ id: secret.id, scope: secret.scope, scopeName: secret.scopeName, secretName: secret.secretName }), secret.scope, secret.scopeName, secret.secretName, secret.createdAt, secret.updatedAt, secret.encryptedValue);
    });
  }

  async getSecret(id: string): Promise<StoredSecret | null> {
    return this.safeExecute(() => {
      const stmt = this.db.prepare("SELECT data_json, scope, scope_name, secret_name, created_at, updated_at, encrypted_value FROM secrets WHERE id = ?");
      const row = stmt.get(id) as { data_json: string; scope: string; scope_name: string; secret_name: string; created_at: string; updated_at: string; encrypted_value: Buffer } | undefined;
      if (!row) return null;
      return { id, scope: row.scope as StoredSecret["scope"], scopeName: row.scope_name, secretName: row.secret_name, encryptedValue: row.encrypted_value, createdAt: row.created_at, updatedAt: row.updated_at };
    });
  }

  async listSecrets(): Promise<StoredSecret[]> {
    return this.safeExecute(() => {
      const rows = this.db.prepare("SELECT id, scope, scope_name, secret_name, created_at, updated_at, encrypted_value FROM secrets ORDER BY created_at DESC").all() as Array<{ id: string; scope: string; scope_name: string; secret_name: string; created_at: string; updated_at: string; encrypted_value: Buffer }>;
      return rows.map(r => ({ id: r.id, scope: r.scope as StoredSecret["scope"], scopeName: r.scope_name, secretName: r.secret_name, encryptedValue: r.encrypted_value, createdAt: r.created_at, updatedAt: r.updated_at }));
    });
  }

  async deleteSecret(id: string): Promise<void> {
    return this.safeExecute(() => { this.db.prepare("DELETE FROM secrets WHERE id = ?").run(id); });
  }

  // ── Grants ──
  async saveGrant(grant: StoredSecretGrant): Promise<void> {
    return this.safeExecute(() => {
      const stmt = this.db.prepare(`
        INSERT INTO secret_grants (id, data_json, secret_id, action, revoked, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, revoked = excluded.revoked
      `);
      stmt.run(grant.id, JSON.stringify(grant), grant.secretId, grant.action, grant.revoked ? 1 : 0, grant.createdAt);
    });
  }

  async listGrants(secretId?: string): Promise<StoredSecretGrant[]> {
    return this.safeExecute(() => {
      if (secretId) {
        const rows = this.db.prepare("SELECT data_json FROM secret_grants WHERE secret_id = ? ORDER BY created_at DESC").all(secretId) as Array<{ data_json: string }>;
        return rows.map(r => JSON.parse(r.data_json));
      }
      const rows = this.db.prepare("SELECT data_json FROM secret_grants ORDER BY created_at DESC").all() as Array<{ data_json: string }>;
      return rows.map(r => JSON.parse(r.data_json));
    });
  }

  async revokeGrant(grantId: string): Promise<void> {
    return this.safeExecute(() => {
      this.db.prepare("UPDATE secret_grants SET revoked = 1 WHERE id = ?").run(grantId);
    });
  }

  // ── Network Rules ──
  async saveNetworkRule(rule: StoredNetworkRule): Promise<void> {
    return this.safeExecute(() => {
      const stmt = this.db.prepare(`
        INSERT INTO network_rules (id, data_json, pattern, rule_type, enabled, source, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, enabled = excluded.enabled
      `);
      stmt.run(rule.id, JSON.stringify(rule), rule.pattern, rule.ruleType, rule.enabled ? 1 : 0, rule.source, rule.createdAt);
    });
  }

  async listNetworkRules(): Promise<StoredNetworkRule[]> {
    return this.safeExecute(() => {
      const rows = this.db.prepare("SELECT data_json FROM network_rules ORDER BY created_at DESC").all() as Array<{ data_json: string }>;
      return rows.map(r => JSON.parse(r.data_json));
    });
  }

  async deleteNetworkRule(id: string): Promise<void> {
    return this.safeExecute(() => { this.db.prepare("DELETE FROM network_rules WHERE id = ?").run(id); });
  }

  // ── Secret Audit ──
  async saveSecretAuditEvent(event: StoredSecretAuditEvent): Promise<void> {
    return this.safeExecute(() => {
      const stmt = this.db.prepare(`
        INSERT INTO secret_audit_events (id, data_json, secret_id, timestamp)
        VALUES (?, ?, ?, ?)
      `);
      stmt.run(event.id, JSON.stringify(event), event.secretId, event.timestamp);
      this.db.exec("DELETE FROM secret_audit_events WHERE id NOT IN (SELECT id FROM secret_audit_events ORDER BY timestamp DESC LIMIT 1000)");
    });
  }

  async listSecretAuditEvents(limit = 100): Promise<StoredSecretAuditEvent[]> {
    return this.safeExecute(() => {
      const rows = this.db.prepare("SELECT data_json FROM secret_audit_events ORDER BY timestamp DESC LIMIT ?").all(limit) as Array<{ data_json: string }>;
      return rows.map(r => JSON.parse(r.data_json));
    });
  }

  // ── Lifecycle ──
  close(): void {
    this.db.close();
  }
}
