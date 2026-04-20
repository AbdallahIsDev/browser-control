import fs from "node:fs";
import path from "node:path";

import { isDebugPortReady } from "./browser_core";
import { HealthCheck, type HealthReport } from "./health_check";
import { Logger, logger } from "./logger";
import { MemoryStore } from "./memory_store";
import {
  getChromeDebugPath,
  getDaemonStatusPath,
  getPidFilePath,
} from "./paths";
import { Scheduler, type ScheduledTask } from "./scheduler";
import { SkillRegistry } from "./skill_registry";
import { StagehandManager } from "./stagehand_core";
import { TaskEngine, type Task } from "./task_engine";
import { Telemetry, createTelegramAlertHandler } from "./telemetry";
import { SkillMemoryStore } from "./skill_memory";
import type { SkillContext } from "./skill";
import { loadConfig } from "./config";
import { getSkillsDataDir } from "./paths";

// ── Daemon Status Model ─────────────────────────────────────────────

export type DaemonStatus = "running" | "degraded" | "stopped";

export interface DaemonStatusRecord {
  status: DaemonStatus;
  pid?: number;
  reason?: string;
  startedAt?: string;
  stoppedAt?: string;
  updatedAt: string;
}

// ── Task Intent Persistence ─────────────────────────────────────────

export interface TaskIntent {
  taskId: string;
  skill?: string;
  action?: string;
  params?: Record<string, unknown>;
  status: "running" | "completed" | "failed" | "interrupted";
  startedAt: string;
  completedAt?: string;
  failedAt?: string;
  error?: string;
}

// ── Resume Policy ───────────────────────────────────────────────────

export type ResumePolicy = "resume" | "reschedule" | "abandon";

// ── Broker Server Interface ─────────────────────────────────────────

type BrokerServerLike = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

type HealthCheckLike = {
  runCritical: () => Promise<boolean>;
  runAll: () => Promise<HealthReport>;
};

// ── Running Task Record ─────────────────────────────────────────────

interface RunningTaskRecord {
  id: string;
  status: "pending" | "running" | "completed" | "failed";
  result?: unknown;
  error?: string;
  engine?: TaskEngine;
  promise?: Promise<void>;
  skill?: string;
  action?: string;
  params?: Record<string, unknown>;
  /** Captured at intent-creation time so completion handlers never read from a closed store. */
  startedAt: string;
}

// ── Daemon Configuration ────────────────────────────────────────────

export interface DaemonConfig {
  port?: number;
  schedulerEnabled?: boolean;
  autoRestoreSession?: boolean;
  maxConcurrentTasks?: number;
  heartbeatIntervalMs?: number;
  chromeWatchdogIntervalMs?: number;
  chromeWatchdogMaxRetries?: number;
  chromeWatchdogRetryDelayMs?: number;
  resumePolicy?: ResumePolicy;
  memoryAlertMb?: number;
  chromeTabLimit?: number;
  healthCheck?: HealthCheckLike;
  memoryStore?: MemoryStore;
  telemetry?: Telemetry;
  pidFilePath?: string;
  brokerFactory?: (daemon: Daemon) => Promise<BrokerServerLike> | BrokerServerLike;
}

// ── Daemon Implementation ───────────────────────────────────────────

export class Daemon {
  private readonly config: DaemonConfig;

  private memoryStore!: MemoryStore;

  private telemetry!: Telemetry;

  private healthCheck!: HealthCheckLike;

  private scheduler!: Scheduler;

  private broker!: BrokerServerLike;

  private readonly stagehandManager = new StagehandManager();

  private readonly skillRegistry = new SkillRegistry();

  private readonly taskStatuses = new Map<string, RunningTaskRecord>();

  private readonly taskQueue: Array<{ id: string; task: Task }> = [];

  private readonly runningTaskIds = new Set<string>();

  private heartbeatHandle: NodeJS.Timeout | null = null;

  private chromeWatchdogHandle: NodeJS.Timeout | null = null;

  private started = false;

  private stopped = false;

  private taskCounter = 0;

  private daemonStatus: DaemonStatus = "stopped";

  private startedAt: string | null = null;

  private lastHealthCheckAt: string | null = null;

  private acceptNewTasks = true;

  private schedulerPaused = false;

  private chromeConnected = true;

  private readonly log: Logger;

  private signalHandler: (() => void) | null = null;

  private storeClosed = false;

  private skillStatePersistHandle: NodeJS.Timeout | null = null;

  private readonly skillContexts = new Map<string, SkillContext>();

  /** Cached app config from loadConfig() — set once during start(). */
  private appConfig: ReturnType<typeof loadConfig> | null = null;

  constructor(config: DaemonConfig = {}) {
    this.config = config;
    this.log = logger.withComponent("daemon");
  }

  // ── Public API ─────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    this.appConfig = loadConfig({ validate: false });
    this.memoryStore = this.config.memoryStore ?? new MemoryStore();
    this.telemetry = this.config.telemetry ?? new Telemetry();
    this.telemetry.onAlert(createTelegramAlertHandler(path.join(__dirname, "telegram_notifier.ps1")));
    this.healthCheck = this.config.healthCheck ?? new HealthCheck({
      port: this.config.port,
      memoryStore: this.memoryStore,
    });

    const criticalOkay = await this.healthCheck.runCritical();
    if (!criticalOkay) {
      const report = await this.healthCheck.runAll();
      throw new Error(`Daemon start blocked because critical health checks failed: ${JSON.stringify(report.checks)}`);
    }

    this.scheduler = new Scheduler({
      store: this.memoryStore,
    });

    // Auto-discover skills from the skills/ directory
    const skillsDir = path.join(__dirname, "skills");
    const loadedSkills = await this.skillRegistry.loadFromDirectory(skillsDir);
    if (loadedSkills.length > 0) {
      this.log.info(`Loaded ${loadedSkills.length} skill(s) from ${skillsDir}`);
    }

    this.scheduler.onTaskDue(async (scheduledTask) => {
      if (!scheduledTask.taskFactory) {
        return;
      }
      const task = await scheduledTask.taskFactory();
      await this.submitTask(task, scheduledTask.id);
    });

    this.broker = this.config.brokerFactory
      ? await this.config.brokerFactory(this)
      : await this.createDefaultBroker();
    await this.broker.start();

    this.writePidFile();
    if (this.config.schedulerEnabled ?? true) {
      this.scheduler.start();
    }
    this.startHeartbeat();
    this.startChromeWatchdog();
    this.startSkillStatePersistence();
    this.registerSignalHandlers();

    // Mark daemon as running
    this.startedAt = new Date().toISOString();
    this.daemonStatus = "running";
    this.writeDaemonStatus("running");

    // Startup recovery: scan for interrupted tasks
    await this.recoverInterruptedTasks();

    // Restore skill state for registered skills that implement restoreState
    await this.restoreSkillStates();

    // Call onResume for skills that implement it (after restore + setup)
    await this.resumeSkills();

    this.started = true;
  }

  async stop(): Promise<void> {
    if (!this.started || this.stopped) {
      return;
    }

    this.stopped = true;
    this.acceptNewTasks = false;

    this.log.info("Shutting down daemon — persisting running tasks and exiting cleanly");

    // Stop accepting new tasks and persist running task intents
    for (const taskId of this.runningTaskIds) {
      const record = this.taskStatuses.get(taskId);
      if (record) {
        // Persist TaskEngine state for possible resume
        if (record.engine) {
          this.memoryStore.set(`task_state:${taskId}:current`, record.engine.exportState());
        }

        // Mark intent as interrupted
        this.persistTaskIntent(taskId, {
          taskId,
          ...(record.skill ? { skill: record.skill } : {}),
          ...(record.action ? { action: record.action } : {}),
          ...(record.params ? { params: record.params } : {}),
          status: "interrupted",
          startedAt: record.startedAt || new Date().toISOString(),
          error: "Daemon shutdown while task was running",
        });

        // Update the RunningTaskRecord
        record.status = "failed";
        record.error = "Interrupted by daemon shutdown";
      }
    }

    // Cancel queued tasks that never started
    for (const queued of this.taskQueue.splice(0)) {
      const record = this.taskStatuses.get(queued.id);
      if (record) {
        record.status = "failed";
        record.error = "Cancelled by daemon shutdown";
      }
    }

    // Do NOT wait for running tasks to finish — we've persisted their state

    // Call onPause on skills that implement it and persist their state
    await this.pauseSkills();

    // Stop subsystems
    await this.scheduler.stop();
    await this.broker.stop();
    await this.stagehandManager.closeAll();

    // Save telemetry reports
    this.telemetry.saveReport("markdown");
    this.telemetry.saveReport("json");

    if (this.heartbeatHandle) {
      clearInterval(this.heartbeatHandle);
      this.heartbeatHandle = null;
    }
    if (this.chromeWatchdogHandle) {
      clearInterval(this.chromeWatchdogHandle);
      this.chromeWatchdogHandle = null;
    }
    if (this.skillStatePersistHandle) {
      clearInterval(this.skillStatePersistHandle);
      this.skillStatePersistHandle = null;
    }

    // Write shutdown status
    this.daemonStatus = "stopped";
    this.writeDaemonStatus("stopped", "Clean shutdown");

    if (!this.config.memoryStore) {
      this.memoryStore.close();
    }
    this.storeClosed = true;
    this.removePidFile();

    this.removeSignalHandlers();
    this.started = false;
    this.log.info("Shutdown complete");
  }

  async submitTask(task: Task, externalId?: string): Promise<string> {
    if (!this.acceptNewTasks) {
      throw new Error("Daemon is shutting down — not accepting new tasks.");
    }

    const taskId = externalId ?? `task-${Date.now()}-${++this.taskCounter}`;
    const startedAt = new Date().toISOString();
    this.taskStatuses.set(taskId, {
      id: taskId,
      status: "pending",
      startedAt,
    });

    this.taskQueue.push({ id: taskId, task });
    this.processQueue();
    return taskId;
  }

  submitSkillTask(
    taskId: string,
    skillName: string,
    action: string,
    params: Record<string, unknown>,
  ): void {
    if (!this.acceptNewTasks) {
      this.log.warn("Rejecting skill task — daemon is shutting down", { taskId, skillName });
      return;
    }
    const startedAt = new Date().toISOString();
    this.taskStatuses.set(taskId, {
      id: taskId,
      status: "running",
      skill: skillName,
      action,
      params,
      startedAt,
    });
    this.runningTaskIds.add(taskId);

    // Persist intent before execution
    this.persistTaskIntent(taskId, {
      taskId,
      skill: skillName,
      action,
      params,
      status: "running",
      startedAt,
    });

    this.executeSkillAsync(taskId, skillName, action, params);
  }

  getTaskStatus(taskId: string): { id: string; status: "pending" | "running" | "completed" | "failed"; result?: unknown } | null {
    const record = this.taskStatuses.get(taskId);
    if (!record) {
      return null;
    }

    return {
      id: record.id,
      status: record.status,
      ...(record.result !== undefined ? { result: record.result } : {}),
    };
  }

  getScheduler(): Scheduler {
    return this.scheduler;
  }

  getTelemetry(): Telemetry {
    return this.telemetry;
  }

  getHealthCheck(): HealthCheckLike {
    return this.healthCheck;
  }

  getStagehandManager(): StagehandManager {
    return this.stagehandManager;
  }

  getSkillRegistry(): SkillRegistry {
    return this.skillRegistry;
  }

  getRecentTasks(): Array<{ id: string; status: "pending" | "running" | "completed" | "failed"; result?: unknown }> {
    return Array.from(this.taskStatuses.values()).map((record) => ({
      id: record.id,
      status: record.status,
      ...(record.result !== undefined ? { result: record.result } : {}),
    }));
  }

  /** Get the current daemon status. */
  getDaemonStatus(): DaemonStatus {
    return this.daemonStatus;
  }

  /** Get daemon uptime in milliseconds. */
  getUptimeMs(): number {
    if (!this.startedAt) {
      return 0;
    }
    return Date.now() - new Date(this.startedAt).getTime();
  }

  /** Get enriched stats for /api/v1/stats. */
  getStats(): Record<string, unknown> {
    const telemetrySummary = this.telemetry.getSummary();
    const memoryUsage = process.memoryUsage();

    return {
      ...telemetrySummary,
      daemon: {
        status: this.daemonStatus,
        pid: process.pid,
        uptimeMs: this.getUptimeMs(),
        startedAt: this.startedAt,
        lastHealthCheckAt: this.lastHealthCheckAt,
        acceptNewTasks: this.acceptNewTasks,
        chromeConnected: this.chromeConnected,
      },
      memory: {
        heapUsedMb: Math.round(memoryUsage.heapUsed / (1024 * 1024)),
        heapTotalMb: Math.round(memoryUsage.heapTotal / (1024 * 1024)),
        rssMb: Math.round(memoryUsage.rss / (1024 * 1024)),
        externalMb: Math.round(memoryUsage.external / (1024 * 1024)),
      },
      tasks: {
        running: this.runningTaskIds.size,
        queued: this.taskQueue.length,
        totalCompleted: Array.from(this.taskStatuses.values()).filter((r) => r.status === "completed").length,
        totalFailed: Array.from(this.taskStatuses.values()).filter((r) => r.status === "failed").length,
      },
      scheduler: {
        paused: this.schedulerPaused,
        queueSize: this.scheduler.getQueue().length,
      },
      activeSessions: this.stagehandManager.listSessions().length,
    };
  }

  async emergencyKill(): Promise<void> {
    this.acceptNewTasks = false;
    await this.scheduler.stop();
    for (const queued of this.taskQueue.splice(0)) {
      const record = this.taskStatuses.get(queued.id);
      if (record) {
        record.status = "failed";
        record.error = "Killed before execution.";
      }
    }
  }

  // ── Daemon Status Persistence ──────────────────────────────────────

  private writeDaemonStatus(status: DaemonStatus, reason?: string): void {
    try {
      const statusPath = this.config.pidFilePath
        ? path.join(path.dirname(this.config.pidFilePath), "daemon-status.json")
        : getDaemonStatusPath();

      fs.mkdirSync(path.dirname(statusPath), { recursive: true });

      const record: DaemonStatusRecord = {
        status,
        pid: process.pid,
        updatedAt: new Date().toISOString(),
        ...(reason ? { reason } : {}),
        ...(status === "running" ? { startedAt: this.startedAt ?? new Date().toISOString() } : {}),
        ...(status === "stopped" ? { stoppedAt: new Date().toISOString() } : {}),
      };

      fs.writeFileSync(statusPath, JSON.stringify(record, null, 2));
    } catch (error: unknown) {
      this.log.error("Failed to write daemon status", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // ── Task Intent Persistence ────────────────────────────────────────

  private persistTaskIntent(taskId: string, intent: TaskIntent): void {
    if (this.storeClosed) {
      return;
    }
    try {
      this.memoryStore.set(`task:${taskId}:intent`, intent);
    } catch (error: unknown) {
      this.log.error("Failed to persist task intent", {
        taskId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // ── Startup Recovery ───────────────────────────────────────────────

  private async recoverInterruptedTasks(): Promise<void> {
    const intentKeys = this.memoryStore.keys("task:");
    const interruptedIntents: Array<{ key: string; intent: TaskIntent }> = [];

    for (const key of intentKeys) {
      const intent = this.memoryStore.get<TaskIntent>(key);
      if (intent && intent.status === "running") {
        // This intent was running when the daemon crashed — mark it interrupted
        interruptedIntents.push({ key, intent });
      }
    }

    if (interruptedIntents.length === 0) {
      return;
    }

    this.log.info(`Found ${interruptedIntents.length} interrupted task(s) from previous run`);

    const policy = this.config.resumePolicy ?? this.appConfig!.resumePolicy;

    for (const { key, intent } of interruptedIntents) {
      // Update the stored intent to reflect it was interrupted
      intent.status = "interrupted";
      intent.error = "Daemon crashed or was killed while task was running";
      this.memoryStore.set(key, intent);

      this.log.info(`Recovering task ${intent.taskId} with policy: ${policy}`, {
        taskId: intent.taskId,
        skill: intent.skill,
        action: intent.action,
        policy,
      });

      switch (policy) {
        case "resume": {
          // Try to resume from persisted TaskEngine state
          const resumed = TaskEngine.resumeFromStore(this.memoryStore, `task_state:${intent.taskId}:`);
          if (resumed && intent.skill) {
            this.log.info(`Task ${intent.taskId} has resumable engine state — re-submitting via skill path`);
            // Re-submit as a new skill task (resumed engine state is available for context)
            const newTaskId = `resumed-${intent.taskId}-${Date.now()}`;
            this.submitSkillTask(newTaskId, intent.skill, intent.action ?? "", intent.params ?? {});
          } else if (resumed) {
            this.log.info(`Task ${intent.taskId} has resumable engine state but no skill info — cannot auto-resume. Marking as interrupted.`);
          } else {
            this.log.warn(`Cannot resume task ${intent.taskId} — no saved engine state. Marking as interrupted.`);
          }
          break;
        }
        case "reschedule": {
          // Re-queue the task if it has skill/action info
          if (intent.skill) {
            this.log.info(`Rescheduling skill task ${intent.taskId} (${intent.skill}/${intent.action})`);
            const newTaskId = `rescheduled-${intent.taskId}-${Date.now()}`;
            this.submitSkillTask(newTaskId, intent.skill, intent.action ?? "", intent.params ?? {});
          } else {
            this.log.warn(`Cannot reschedule task ${intent.taskId} — no skill/action info. Marking as interrupted.`);
          }
          break;
        }
        case "abandon":
        default: {
          this.log.info(`Abandoning interrupted task ${intent.taskId}`);
          break;
        }
      }
    }
  }

  // ── Chrome Reconnection Watchdog ───────────────────────────────────

  private startChromeWatchdog(): void {
    const intervalMs = this.config.chromeWatchdogIntervalMs ?? 30_000;
    this.chromeConnected = true;

    this.chromeWatchdogHandle = setInterval(() => {
      void this.checkChromeLiveness();
    }, intervalMs);
  }

  private async checkChromeLiveness(): Promise<void> {
    try {
      // Read CDP port from chrome-debug.json
      const debugPath = getChromeDebugPath();
      let port = this.config.port ?? 9222;

      try {
        if (fs.existsSync(debugPath)) {
          const metadata = JSON.parse(fs.readFileSync(debugPath, "utf8")) as { port?: number };
          if (metadata.port) {
            port = metadata.port;
          }
        }
      } catch {
        // Fall back to configured port
      }

      const isReady = await isDebugPortReady(port);

      if (isReady) {
        if (!this.chromeConnected) {
          this.log.info("Chrome reconnected — resuming normal operation");
          this.chromeConnected = true;
          this.daemonStatus = "running";
          this.writeDaemonStatus("running", "Chrome reconnected");

          // Resume scheduler if it was paused
          if (this.schedulerPaused) {
            this.schedulerPaused = false;
            const queue = this.scheduler.getQueue();
            for (const entry of queue) {
              this.scheduler.resume(entry.id);
            }
            this.log.info("Scheduler resumed after Chrome recovery");
          }
        }
      } else {
        if (this.chromeConnected) {
          this.log.warn("Chrome CDP connection lost — attempting reconnection");
          this.chromeConnected = false;

          // Attempt reconnect with retries
          const maxRetries = this.config.chromeWatchdogMaxRetries ?? 3;
          const retryDelayMs = this.config.chromeWatchdogRetryDelayMs ?? 5000;
          let recovered = false;

          for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
            this.log.info(`Chrome reconnect attempt ${attempt}/${maxRetries}`);
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs));

            if (await isDebugPortReady(port)) {
              recovered = true;
              break;
            }
          }

          if (recovered) {
            this.log.info("Chrome reconnected after retry");
            this.chromeConnected = true;
          } else {
            this.log.critical("Chrome reconnection failed — marking daemon as degraded", {
              maxRetries,
            });

            this.daemonStatus = "degraded";
            this.writeDaemonStatus("degraded", "Chrome CDP connection lost and reconnection failed");

            // Pause scheduled work
            if (!this.schedulerPaused) {
              this.schedulerPaused = true;
              const queue = this.scheduler.getQueue();
              for (const entry of queue) {
                this.scheduler.pause(entry.id);
              }
              this.log.info("Scheduler paused due to Chrome disconnect");
            }

            // Emit critical alert through telemetry
            this.telemetry.record("chrome.watchdog", "error", 0, {
              status: "disconnected",
              reconnectionAttempts: maxRetries,
              message: "Chrome CDP connection lost and all reconnection attempts failed",
            });
          }
        }
      }
    } catch (error: unknown) {
      this.log.error("Chrome watchdog check failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // ── Resource Monitoring ────────────────────────────────────────────

  checkResourceAlerts(): void {
    const memoryAlertMb = this.config.memoryAlertMb ?? this.appConfig!.memoryAlertMb;
    const chromeTabLimit = this.config.chromeTabLimit ?? this.appConfig!.chromeTabLimit;

    const memoryUsage = process.memoryUsage();
    const heapUsedMb = Math.round(memoryUsage.heapUsed / (1024 * 1024));

    if (heapUsedMb > memoryAlertMb) {
      const message = `Memory usage ${heapUsedMb}MB exceeds threshold ${memoryAlertMb}MB`;
      this.log.warn(message, { heapUsedMb, thresholdMb: memoryAlertMb });
      this.telemetry.record("resource.alert", "error", 0, {
        type: "memory",
        heapUsedMb,
        thresholdMb: memoryAlertMb,
        message,
      });
    }

    // Check Chrome tab count via StagehandManager sessions as a proxy
    const sessionCount = this.stagehandManager.listSessions().length;
    if (sessionCount > chromeTabLimit) {
      const message = `Active Chrome sessions ${sessionCount} exceed limit ${chromeTabLimit}`;
      this.log.warn(message, { sessions: sessionCount, limit: chromeTabLimit });
      this.telemetry.record("resource.alert", "error", 0, {
        type: "chrome_tabs",
        sessions: sessionCount,
        limit: chromeTabLimit,
        message,
      });
    }
  }

  // ── Default Broker Factory ─────────────────────────────────────────

  private async createDefaultBroker(): Promise<BrokerServerLike> {
    const module = await import("./broker_server");
    if (!("createBrokerServer" in module) || typeof module.createBrokerServer !== "function") {
      throw new Error("broker_server.ts does not export createBrokerServer().");
    }

    const broker = module.createBrokerServer({
      callbacks: {
        submitTask: async (request) => {
          // If skill is provided, route through skill registry
          if (request.skill) {
            const taskId = `skill-${request.skill}-${Date.now()}`;
            this.submitSkillTask(taskId, request.skill, request.action ?? "", request.params ?? {});
            return { taskId };
          }

          const taskId = await this.submitTask({
            id: request.action ?? "task",
            name: request.action ?? "task",
            timeoutMs: request.timeoutMs,
            action: async () => ({
              success: true,
              data: request.params ?? {},
            }),
          });
          return { taskId };
        },
        scheduleTask: async (request) => {
          this.scheduler.schedule({
            id: request.id,
            name: request.name,
            cronExpression: request.cronExpression,
            enabled: true,
          });

          const queueEntry = this.scheduler.getQueue().find((entry) => entry.id === request.id) ?? null;
          return {
            id: request.id,
            nextRun: queueEntry?.nextRun ?? null,
          };
        },
        kill: async () => {
          await this.emergencyKill();
        },
        getHealth: async () => {
          this.lastHealthCheckAt = new Date().toISOString();
          return this.healthCheck.runAll();
        },
        getStats: async () => this.getStats(),
        getSchedulerQueue: async () => this.scheduler.getQueue(),
        getTaskStatus: async (taskId) => this.getTaskStatus(taskId),
        listTasks: async () => this.getRecentTasks(),
        listSkills: async () => this.skillRegistry.list(),
      },
    });
    return {
      start: async () => {
        await broker.listen(this.config.port);
      },
      stop: async () => {
        await broker.close();
      },
    };
  }

  // ── Skill Execution ────────────────────────────────────────────────

  /** Build a SkillContext with scoped memory, respecting requiresFreshPage. */
  private async buildSkillContext(
    skillName: string,
    params: Record<string, unknown>,
  ): Promise<{ context: SkillContext; freshPage: import("playwright").Page | null } | null> {
    const skill = this.skillRegistry.get(skillName);
    if (!skill) {
      return null;
    }

    const scopedMemory = new SkillMemoryStore(this.memoryStore, skillName);

    // Determine page source
    let page: import("playwright").Page;
    let freshPage: import("playwright").Page | null = null;
    const sessions = this.stagehandManager.listSessions();
    const sessionId = (params.sessionId as string) ?? sessions[0];
    const connection = sessionId ? this.stagehandManager.getSession(sessionId) : undefined;

    if (skill.manifest.requiresFreshPage && connection) {
      // Create a fresh page from the existing Stagehand context
      const stagehand = connection.stagehand;
      page = await stagehand.context.newPage() as unknown as import("playwright").Page;
      freshPage = page; // Track so we can close it after execution
    } else if (connection) {
      page = connection.page as unknown as import("playwright").Page;
    } else {
      return null;
    }

    const context: SkillContext = {
      page,
      data: params,
      memoryStore: scopedMemory,
      rawMemoryStore: this.memoryStore,
      telemetry: this.telemetry,
    };

    return { context, freshPage };
  }

  private async executeSkillAsync(
    taskId: string,
    skillName: string,
    action: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    let skillContext: SkillContext | undefined;
    let freshPage: import("playwright").Page | null = null;

    try {
      const builtResult = await this.buildSkillContext(skillName, params);
      if (!builtResult) {
        throw new Error(`Cannot build context for skill "${skillName}" — no page available.`);
      }
      skillContext = builtResult.context;
      freshPage = builtResult.freshPage;
      // Store context for lifecycle hooks
      this.skillContexts.set(skillName, skillContext);

      // Restore state if available
      const skill = this.skillRegistry.get(skillName);
      if (skill?.restoreState) {
        const savedState = this.memoryStore.get<Record<string, unknown>>(`skill:${skillName}:state`);
        if (savedState) {
          skill.restoreState(savedState);
        }
      }

      await this.skillRegistry.setup(skillName, skillContext);

      const result = await this.skillRegistry.execute(skillName, action, params);

      // After the skill finishes, the daemon may have already stopped.
      // Bail before any store or state mutations to avoid touching a
      // closed MemoryStore or corrupting shutdown-persisted state.
      if (this.stopped) {
        return;
      }

      const record = this.taskStatuses.get(taskId);
      if (record) {
        record.status = "completed";
        record.result = result;
      }

      // Update intent — startedAt was captured on the record before async work
      this.persistTaskIntent(taskId, {
        taskId,
        skill: skillName,
        action,
        params,
        status: "completed",
        startedAt: record?.startedAt || new Date().toISOString(),
        completedAt: new Date().toISOString(),
      });
    } catch (error: unknown) {
      // Same guard: if the daemon stopped while the skill was running,
      // skip completion logic — stop() already persisted the interrupted state.
      if (this.stopped) {
        return;
      }

      const record = this.taskStatuses.get(taskId);
      if (record) {
        record.status = "failed";
        record.error = error instanceof Error ? error.message : String(error);
      }

      // Call onError lifecycle hook if the skill implements it
      const skill = this.skillRegistry.get(skillName);
      if (skill?.onError && skillContext) {
        try {
          await skill.onError(skillContext, error instanceof Error ? error : new Error(String(error)));
        } catch (hookError: unknown) {
          this.log.warn("onError hook failed", { skillName, error: String(hookError) });
        }
      }

      this.persistTaskIntent(taskId, {
        taskId,
        skill: skillName,
        action,
        params,
        status: "failed",
        startedAt: record?.startedAt || new Date().toISOString(),
        failedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      // Always teardown to release context references, even after shutdown
      if (skillContext) {
        await this.skillRegistry.teardown(skillName, skillContext).catch(() => {});
        this.skillContexts.delete(skillName);
      }
      // Close fresh page AFTER teardown so teardown can still reference context.page
      if (freshPage) {
        try {
          await freshPage.close();
        } catch { /* page may already be closed */ }
      }
      this.runningTaskIds.delete(taskId);
      if (!this.stopped) {
        this.processQueue();
      }
    }
  }

  // ── Task Queue Processing ───────────────────────────────────────────

  private processQueue(): void {
    if (!this.acceptNewTasks) {
      return;
    }

    const limit = this.config.maxConcurrentTasks ?? 1;
    while (this.runningTaskIds.size < limit && this.taskQueue.length > 0) {
      const queued = this.taskQueue.shift();
      if (!queued) {
        return;
      }

      const engine = new TaskEngine().withTelemetry(this.telemetry);
      engine.addStep(queued.task);
      engine.autoPersist(this.memoryStore, `task_state:${queued.id}:`);

      const record = this.taskStatuses.get(queued.id);
      if (!record) {
        continue;
      }

      record.status = "running";
      record.engine = engine;
      this.runningTaskIds.add(queued.id);

      // Capture startedAt on the record before async execution
      const startedAt = new Date().toISOString();
      record.startedAt = startedAt;

      // Persist intent before execution
      this.persistTaskIntent(queued.id, {
        taskId: queued.id,
        status: "running",
        startedAt,
      });

      const promise = engine.run().then((context) => {
        if (this.stopped) {
          return;
        }
        record.status = context.failures.length > 0 ? "failed" : "completed";
        record.result = queued.task.id ? context.data[queued.task.id] : context.data;

        // Update intent on completion — use captured startedAt from record, not from store
        const finalStatus = context.failures.length > 0 ? "failed" : "completed";
        this.persistTaskIntent(queued.id, {
          taskId: queued.id,
          status: finalStatus,
          startedAt: record.startedAt || new Date().toISOString(),
          ...(finalStatus === "completed" ? { completedAt: new Date().toISOString() } : {}),
          ...(finalStatus === "failed" ? {
            failedAt: new Date().toISOString(),
            error: context.failures.map((f) => f.error).join("; "),
          } : {}),
        });
      }).catch((error: unknown) => {
        if (this.stopped) {
          return;
        }
        record.status = "failed";
        record.error = error instanceof Error ? error.message : String(error);

        // Update intent on failure — use captured startedAt from record, not from store
        this.persistTaskIntent(queued.id, {
          taskId: queued.id,
          status: "failed",
          startedAt: record.startedAt || new Date().toISOString(),
          failedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error),
        });
      }).finally(() => {
        this.runningTaskIds.delete(queued.id);
        if (!this.stopped) {
          this.processQueue();
        }
      });

      record.promise = promise;
    }
  }

  // ── Skill Lifecycle ────────────────────────────────────────────────

  /** Call onPause on all skills that implement it and persist their state. */
  private async pauseSkills(): Promise<void> {
    for (const name of this.skillRegistry.listNames()) {
      const skill = this.skillRegistry.get(name);
      if (!skill) continue;
      const context = this.skillContexts.get(name);
      try {
        if (skill.onPause && context) {
          await skill.onPause(context);
        }
        if (skill.saveState) {
          const state = skill.saveState();
          this.memoryStore.set(`skill:${name}:state`, state);
        }
      } catch (error: unknown) {
        this.log.warn(`Skill lifecycle hook failed for "${name}"`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /** Restore skill state for skills that implement restoreState and have persisted state. */
  private async restoreSkillStates(): Promise<void> {
    for (const name of this.skillRegistry.listNames()) {
      const skill = this.skillRegistry.get(name);
      if (!skill?.restoreState) continue;

      const savedState = this.memoryStore.get<Record<string, unknown>>(`skill:${name}:state`);
      if (savedState) {
        try {
          skill.restoreState(savedState);
          this.log.info(`Restored state for skill "${name}"`);
        } catch (error: unknown) {
          this.log.warn(`Failed to restore state for skill "${name}"`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }

  /** Call onResume on all skills that implement it. Called after restoreSkillStates on startup.
   *  onResume is only called when a SkillContext is available (i.e., during pause/resume cycles
   *  like Chrome reconnection). At startup, no contexts exist yet, so this is a no-op. */
  private async resumeSkills(): Promise<void> {
    for (const name of this.skillRegistry.listNames()) {
      const skill = this.skillRegistry.get(name);
      if (!skill?.onResume) continue;
      const context = this.skillContexts.get(name);
      if (!context) continue;  // No context available — skip (normal at startup)
      try {
        await skill.onResume(context);
      } catch (error: unknown) {
        this.log.warn(`onResume hook failed for skill "${name}"`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /** Start periodic skill state persistence (default 60s). */
  private startSkillStatePersistence(): void {
    const intervalMs = 60_000;
    this.skillStatePersistHandle = setInterval(() => {
      if (this.stopped || this.storeClosed) return;
      for (const name of this.skillRegistry.listNames()) {
        const skill = this.skillRegistry.get(name);
        if (!skill?.saveState) continue;
        try {
          const state = skill.saveState();
          this.memoryStore.set(`skill:${name}:state`, state);
        } catch (error: unknown) {
          this.log.warn(`Periodic state save failed for skill "${name}"`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }, intervalMs);
  }

  // ── Heartbeat ──────────────────────────────────────────────────────

  private startHeartbeat(): void {
    const intervalMs = this.config.heartbeatIntervalMs ?? 30_000;
    this.heartbeatHandle = setInterval(() => {
      this.log.info("Heartbeat", {
        running: this.runningTaskIds.size,
        queued: this.taskQueue.length,
        status: this.daemonStatus,
        chrome: this.chromeConnected,
      });

      // Resource check on each heartbeat
      this.checkResourceAlerts();
    }, intervalMs);
  }

  // ── PID File ───────────────────────────────────────────────────────

  private writePidFile(): void {
    const pidFilePath = this.config.pidFilePath ?? getPidFilePath();
    fs.mkdirSync(path.dirname(pidFilePath), { recursive: true });
    fs.writeFileSync(pidFilePath, String(process.pid));
  }

  private removePidFile(): void {
    const pidFilePath = this.config.pidFilePath ?? getPidFilePath();
    if (fs.existsSync(pidFilePath)) {
      fs.rmSync(pidFilePath, { force: true });
    }
  }

  // ── Signal Handlers ────────────────────────────────────────────────

  private registerSignalHandlers(): void {
    // Remove previous handler if any
    this.removeSignalHandlers();

    this.signalHandler = () => {
      void this.stop();
    };

    process.on("SIGINT", this.signalHandler);
    process.on("SIGTERM", this.signalHandler);
    process.on("SIGHUP", this.signalHandler);
  }

  private removeSignalHandlers(): void {
    if (!this.signalHandler) {
      return;
    }

    process.removeListener("SIGINT", this.signalHandler);
    process.removeListener("SIGTERM", this.signalHandler);
    process.removeListener("SIGHUP", this.signalHandler);
    this.signalHandler = null;
  }
}

if (require.main === module) {
  const daemon = new Daemon({
    schedulerEnabled: !process.argv.includes("--dev"),
  });

  daemon.start().catch((error: unknown) => {
    logger.critical(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
