import type { Telemetry } from "./telemetry";

export interface TaskResult {
  success: boolean;
  data?: unknown;
  error?: string;
  nextStep?: string;
}

export interface SessionMetadata {
  id: string;
  port: number;
  urlPattern: string;
  createdAt: string;
}

export interface TaskContext {
  page?: unknown;
  pages?: Record<string, unknown>;
  data: Record<string, unknown>;
  cookies: unknown[];
  screenshots: string[];
  metadata: Record<string, unknown>;
  failures: Array<{
    taskId: string;
    error: string;
  }>;
  completedTaskIds: string[];
  sessions?: Record<string, SessionMetadata>;
}

export interface Task {
  id: string;
  name: string;
  action: (context: TaskContext) => Promise<TaskResult>;
  retries?: number;
  retryDelayMs?: number;
  retryBackoff?: "linear" | "exponential";
  timeoutMs?: number;
  continueOnFailure?: boolean;
  conditions?: {
    before?: (context: TaskContext) => Promise<boolean>;
    after?: (context: TaskContext) => Promise<boolean>;
  };
  policyMeta?: {
    action?: string;
    path?: import("../policy/types").ExecutionPath;
    risk?: import("../policy/types").RiskLevel;
    params?: Record<string, unknown>;
  };
}

type MemoryStoreLike = Pick<import("./memory_store").MemoryStore, "get" | "set">;

type PersistedTaskContext = Omit<TaskContext, "page" | "pages">;

export interface TaskStateSnapshot {
  context: TaskContext;
  orderedTaskIds: string[];
  currentTaskId?: string;
}

type StepCompleteHandler = (task: Task, result: TaskResult, context: TaskContext) => void | Promise<void>;
type FailHandler = (task: Task, result: TaskResult, context: TaskContext) => void | Promise<void>;

function createDefaultContext(initial: Partial<TaskContext> = {}): TaskContext {
  return {
    data: { ...(initial.data ?? {}) },
    cookies: [...(initial.cookies ?? [])],
    screenshots: [...(initial.screenshots ?? [])],
    metadata: { ...(initial.metadata ?? {}) },
    failures: [...(initial.failures ?? [])],
    completedTaskIds: [...(initial.completedTaskIds ?? [])],
    ...(initial.page !== undefined ? { page: initial.page } : {}),
    ...(initial.pages !== undefined ? { pages: { ...initial.pages } } : {}),
    ...(initial.sessions !== undefined ? { sessions: { ...initial.sessions } } : {}),
  };
}

async function runWithTimeout<T>(promise: Promise<T>, timeoutMs?: number): Promise<T> {
  if (!timeoutMs) {
    return promise;
  }

  let timeoutHandle: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`Timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

export class TaskEngine {
  private readonly tasks = new Map<string, Task>();

  private readonly orderedTaskIds: string[] = [];

  private readonly stepCompleteHandlers: StepCompleteHandler[] = [];

  private readonly failHandlers: FailHandler[] = [];

  private context: TaskContext;

  private telemetry?: Telemetry;

  private currentTaskId?: string;

  private persistStore?: MemoryStoreLike;

  private persistPrefix = "task_state:";

  constructor(initialContext: Partial<TaskContext> = {}) {
    this.context = createDefaultContext(initialContext);
  }

  addStep(step: Task): this {
    if (!this.tasks.has(step.id)) {
      this.orderedTaskIds.push(step.id);
    }

    this.tasks.set(step.id, step);
    return this;
  }

  onStepComplete(callback: StepCompleteHandler): this {
    this.stepCompleteHandlers.push(callback);
    return this;
  }

  onFail(callback: FailHandler): this {
    this.failHandlers.push(callback);
    return this;
  }

  withTelemetry(telemetry: Telemetry): this {
    this.telemetry = telemetry;
    return this;
  }

  autoPersist(store: MemoryStoreLike, prefix = "task_state:"): void {
    this.persistStore = store;
    this.persistPrefix = prefix;
  }

  async run(startStepId?: string): Promise<TaskContext> {
    let currentTaskId: string | undefined = startStepId ?? this.currentTaskId ?? this.orderedTaskIds[0];

    while (currentTaskId) {
      this.currentTaskId = currentTaskId;
      const task = this.tasks.get(currentTaskId);
      if (!task) {
        throw new Error(`Unknown task "${currentTaskId}".`);
      }

      const result = await this.executeTask(task);
      if (!result.success) {
        if (!task.continueOnFailure) {
          break;
        }
      }

      currentTaskId = result.nextStep ?? this.getNextTaskId(currentTaskId);
      this.currentTaskId = currentTaskId;
      this.persistCurrentState();
    }

    return this.context;
  }

  async runParallel(steps: Task[]): Promise<TaskResult[]> {
    return Promise.all(steps.map(async (task) => this.executeTask(task)));
  }

  exportState(): TaskStateSnapshot {
    return {
      context: {
        ...this.getPersistableContext(),
      },
      orderedTaskIds: [...this.orderedTaskIds],
      ...(this.currentTaskId ? { currentTaskId: this.currentTaskId } : {}),
    };
  }

  importState(state: TaskStateSnapshot): this {
    this.context = createDefaultContext(state.context);
    this.orderedTaskIds.length = 0;
    this.orderedTaskIds.push(...state.orderedTaskIds);
    this.currentTaskId = state.currentTaskId;
    return this;
  }

  static resumeFromStore(
    store: MemoryStoreLike,
    prefix = "task_state:",
  ): { context: TaskContext; engine: TaskEngine } | null {
    const snapshot = store.get<TaskStateSnapshot>(`${prefix}current`);
    if (!snapshot) {
      return null;
    }

    const engine = new TaskEngine();
    engine.importState(snapshot);
    return {
      context: snapshot.context,
      engine,
    };
  }

  private getNextTaskId(taskId: string): string | undefined {
    const currentIndex = this.orderedTaskIds.indexOf(taskId);
    if (currentIndex === -1) {
      return undefined;
    }

    return this.orderedTaskIds[currentIndex + 1];
  }

  private getPersistableContext(): PersistedTaskContext {
    return {
      data: { ...this.context.data },
      cookies: [...this.context.cookies],
      screenshots: [...this.context.screenshots],
      metadata: { ...this.context.metadata },
      failures: [...this.context.failures],
      completedTaskIds: [...this.context.completedTaskIds],
      ...(this.context.sessions !== undefined ? { sessions: { ...this.context.sessions } } : {}),
    };
  }

  private persistCurrentState(): void {
    if (!this.persistStore) {
      return;
    }

    this.persistStore.set(`${this.persistPrefix}current`, this.exportState());
  }

  private async executeTask(task: Task): Promise<TaskResult> {
    const startedAt = Date.now();
    if (task.conditions?.before) {
      const shouldRun = await task.conditions.before(this.context);
      if (!shouldRun) {
        return this.failTask(task, "Before condition prevented task execution.");
      }
    }

    const maxAttempts = (task.retries ?? 0) + 1;
    const retryDelayMs = task.retryDelayMs ?? 1000;
    const retryBackoff = task.retryBackoff ?? "exponential";
    let lastFailure = "Task failed.";

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      // Wait before retry (not on first attempt)
      if (attempt > 1) {
        const delayMs = retryBackoff === "exponential"
          ? retryDelayMs * (2 ** (attempt - 2))
          : retryDelayMs * (attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      try {
        const result = await runWithTimeout(task.action(this.context), task.timeoutMs);
        if (!result.success) {
          lastFailure = result.error ?? lastFailure;
          if (attempt === maxAttempts) {
            return this.failTask(task, lastFailure);
          }
          continue;
        }

        if (task.conditions?.after) {
          const afterSatisfied = await task.conditions.after(this.context);
          if (!afterSatisfied) {
            lastFailure = "After condition failed after task execution.";
            if (attempt === maxAttempts) {
              return this.failTask(task, lastFailure);
            }
            continue;
          }
        }

        if (result.data !== undefined) {
          this.context.data[task.id] = result.data;
        }
        if (!this.context.completedTaskIds.includes(task.id)) {
          this.context.completedTaskIds.push(task.id);
        }

        for (const handler of this.stepCompleteHandlers) {
          await handler(task, result, this.context);
        }

        this.telemetry?.record("task.step", "success", Date.now() - startedAt, {
          taskId: task.id,
        });

        return result;
      } catch (error: unknown) {
        lastFailure = error instanceof Error ? error.message : String(error);
        if (attempt === maxAttempts) {
          return this.failTask(task, lastFailure);
        }
      }
    }

    return this.failTask(task, lastFailure);
  }

  private async failTask(task: Task, error: string): Promise<TaskResult> {
    const result: TaskResult = {
      success: false,
      error,
    };

    this.context.failures.push({
      taskId: task.id,
      error,
    });

    for (const handler of this.failHandlers) {
      await handler(task, result, this.context);
    }

    this.telemetry?.record("task.step", "error", 0, {
      taskId: task.id,
      error,
    });

    return result;
  }
}
