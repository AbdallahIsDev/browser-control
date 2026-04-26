import type { Task } from "./task_engine";

type MemoryStoreLike = Pick<import("./memory_store").MemoryStore, "get" | "set" | "keys" | "delete">;

export interface ParsedCronExpression {
  minutes: Set<number | "*">;
  hours: Set<number | "*">;
  daysOfMonth: Set<number | "*">;
  months: Set<number | "*">;
  daysOfWeek: Set<number | "*">;
}

export interface ScheduledTask {
  id: string;
  name: string;
  cronExpression: string;
  taskFactory?: () => Task | Promise<Task>;
  enabled: boolean;
  timezone?: string;
  lastRun?: Date;
  nextRun?: Date;
}

interface PersistedScheduledTask {
  id: string;
  name: string;
  cronExpression: string;
  enabled: boolean;
  timezone?: string;
  lastRun?: string;
  nextRun?: string;
}

interface SchedulerOptions {
  store?: MemoryStoreLike;
  now?: () => Date;
}

type TaskDueHandler = (task: ScheduledTask) => void | Promise<void>;

const SCHEDULE_PREFIX = "schedule:";

function parseCronField(field: string, min: number, max: number): Set<number | "*"> {
  const trimmed = field.trim();
  if (trimmed === "*") {
    return new Set<number | "*">(["*"]);
  }

  const values = new Set<number | "*">();
  for (const part of trimmed.split(",")) {
    const normalized = part.trim();
    if (!normalized) {
      continue;
    }

    if (normalized.startsWith("*/")) {
      const step = Number.parseInt(normalized.slice(2), 10);
      if (!Number.isInteger(step) || step <= 0) {
        throw new Error(`Invalid cron step "${normalized}".`);
      }
      for (let value = min; value <= max; value += step) {
        values.add(value);
      }
      continue;
    }

    const parsed = Number.parseInt(normalized, 10);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      throw new Error(`Invalid cron value "${normalized}".`);
    }
    values.add(parsed);
  }

  return values;
}

function toPersistedTask(task: ScheduledTask): PersistedScheduledTask {
  return {
    id: task.id,
    name: task.name,
    cronExpression: task.cronExpression,
    enabled: task.enabled,
    ...(task.timezone ? { timezone: task.timezone } : {}),
    ...(task.lastRun ? { lastRun: task.lastRun.toISOString() } : {}),
    ...(task.nextRun ? { nextRun: task.nextRun.toISOString() } : {}),
  };
}

function fromPersistedTask(value: PersistedScheduledTask, taskFactory?: () => Task | Promise<Task>): ScheduledTask {
  return {
    id: value.id,
    name: value.name,
    cronExpression: value.cronExpression,
    enabled: value.enabled,
    ...(value.timezone ? { timezone: value.timezone } : {}),
    ...(value.lastRun ? { lastRun: new Date(value.lastRun) } : {}),
    ...(value.nextRun ? { nextRun: new Date(value.nextRun) } : {}),
    ...(taskFactory ? { taskFactory } : {}),
  };
}

function getMinuteStamp(date: Date): string {
  return date.toISOString().slice(0, 16);
}

function getDateParts(date: Date, timezone?: string): {
  minute: number;
  hour: number;
  dayOfMonth: number;
  month: number;
  dayOfWeek: number;
} {
  if (!timezone) {
    return {
      minute: date.getUTCMinutes(),
      hour: date.getUTCHours(),
      dayOfMonth: date.getUTCDate(),
      month: date.getUTCMonth() + 1,
      dayOfWeek: date.getUTCDay(),
    };
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    minute: Number(values.minute),
    hour: Number(values.hour),
    dayOfMonth: Number(values.day),
    month: Number(values.month),
    dayOfWeek: weekdayMap[values.weekday as keyof typeof weekdayMap] ?? 0,
  };
}

function fieldMatches(set: Set<number | "*">, value: number): boolean {
  return set.has("*") || set.has(value);
}

export function parseCron(expression: string): ParsedCronExpression {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error("Cron expression must contain exactly 5 fields.");
  }

  return {
    minutes: parseCronField(parts[0], 0, 59),
    hours: parseCronField(parts[1], 0, 23),
    daysOfMonth: parseCronField(parts[2], 1, 31),
    months: parseCronField(parts[3], 1, 12),
    daysOfWeek: parseCronField(parts[4], 0, 6),
  };
}

function getNextRunDate(expression: string, now: Date, timezone?: string): Date | null {
  const parsed = parseCron(expression);
  const candidate = new Date(now.getTime());
  candidate.setUTCSeconds(0, 0);
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);

  for (let minutesAhead = 0; minutesAhead < 366 * 24 * 60; minutesAhead += 1) {
    const parts = getDateParts(candidate, timezone);
    if (
      fieldMatches(parsed.minutes, parts.minute)
      && fieldMatches(parsed.hours, parts.hour)
      && fieldMatches(parsed.daysOfMonth, parts.dayOfMonth)
      && fieldMatches(parsed.months, parts.month)
      && fieldMatches(parsed.daysOfWeek, parts.dayOfWeek)
    ) {
      return new Date(candidate);
    }

    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }

  return null;
}

export class Scheduler {
  private readonly store?: MemoryStoreLike;

  private readonly now: () => Date;

  private readonly tasks = new Map<string, ScheduledTask>();

  private readonly taskFactories = new Map<string, () => Task | Promise<Task>>();

  private readonly dueHandlers: TaskDueHandler[] = [];

  private readonly inFlight = new Set<Promise<void>>();

  private tickHandle: NodeJS.Timeout | null = null;

  constructor(options: SchedulerOptions = {}) {
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
    this.restoreSchedules();
  }

  registerTaskFactory(id: string, taskFactory: () => Task | Promise<Task>): void {
    this.taskFactories.set(id, taskFactory);
    const existing = this.tasks.get(id);
    if (existing) {
      existing.taskFactory = taskFactory;
    }
  }

  schedule(task: ScheduledTask): void {
    const nextRun = getNextRunDate(task.cronExpression, this.now(), task.timezone);
    const scheduledTask: ScheduledTask = {
      ...task,
      nextRun: task.enabled ? nextRun ?? undefined : undefined,
    };

    if (task.taskFactory) {
      this.taskFactories.set(task.id, task.taskFactory);
    }

    this.tasks.set(task.id, scheduledTask);
    this.persistTask(scheduledTask);
  }

  unschedule(id: string): void {
    this.tasks.delete(id);
    this.taskFactories.delete(id);
    this.store?.delete(`${SCHEDULE_PREFIX}${id}`);
  }

  pause(id: string): void {
    const task = this.tasks.get(id);
    if (!task) {
      return;
    }

    task.enabled = false;
    task.nextRun = undefined;
    this.persistTask(task);
  }

  resume(id: string): void {
    const task = this.tasks.get(id);
    if (!task) {
      return;
    }

    task.enabled = true;
    task.nextRun = getNextRunDate(task.cronExpression, this.now(), task.timezone) ?? undefined;
    this.persistTask(task);
  }

  start(): void {
    if (this.tickHandle) {
      return;
    }

    this.tickHandle = setInterval(() => {
      void this.tick();
    }, 1_000);
  }

  async stop(): Promise<void> {
    if (this.tickHandle) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }

    await Promise.all(Array.from(this.inFlight));
  }

  getQueue(): Array<{ id: string; name: string; nextRun: Date | null; enabled: boolean }> {
    return Array.from(this.tasks.values()).map((task) => ({
      id: task.id,
      name: task.name,
      nextRun: task.nextRun ?? null,
      enabled: task.enabled,
    }));
  }

  onTaskDue(callback: TaskDueHandler): void {
    this.dueHandlers.push(callback);
  }

  isWithinKillzone(session: "london" | "ny" | "asia"): boolean {
    const now = this.now();
    const hour = now.getUTCHours();

    if (session === "london") {
      return hour >= 2 && hour < 5;
    }
    if (session === "ny") {
      return (hour >= 7 && hour < 10) || (hour >= 12 && hour < 15);
    }

    return hour >= 18 && hour < 21;
  }

  private restoreSchedules(): void {
    if (!this.store) {
      return;
    }

    for (const key of this.store.keys(SCHEDULE_PREFIX)) {
      const persisted = this.store.get<PersistedScheduledTask>(key);
      if (!persisted) {
        continue;
      }

      const taskFactory = this.taskFactories.get(persisted.id);
      this.tasks.set(persisted.id, fromPersistedTask(persisted, taskFactory));
    }
  }

  private persistTask(task: ScheduledTask): void {
    this.store?.set(`${SCHEDULE_PREFIX}${task.id}`, toPersistedTask(task));
  }

  private async tick(): Promise<void> {
    const now = this.now();

    for (const task of this.tasks.values()) {
      if (!task.enabled || !task.nextRun) {
        continue;
      }

      if (task.nextRun.getTime() > now.getTime()) {
        continue;
      }

      const previousMinute = task.lastRun ? getMinuteStamp(task.lastRun) : null;
      const currentMinute = getMinuteStamp(now);
      if (previousMinute === currentMinute) {
        continue;
      }

      task.lastRun = new Date(now);
      task.nextRun = getNextRunDate(task.cronExpression, now, task.timezone) ?? undefined;
      task.taskFactory = task.taskFactory ?? this.taskFactories.get(task.id);
      this.persistTask(task);

      const dueTask = { ...task };
      for (const handler of this.dueHandlers) {
        const promise = Promise.resolve(handler(dueTask)).finally(() => {
          this.inFlight.delete(promise);
        });
        this.inFlight.add(promise);
      }
    }
  }
}
