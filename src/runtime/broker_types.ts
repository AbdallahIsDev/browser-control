export type BrokerTaskStatus = "pending" | "running" | "completed" | "failed";

export interface BrokerRunTaskRequest {
  skill?: string;
  action?: string;
  params?: Record<string, unknown>;
  priority?: string;
  timeoutMs?: number;
}

export interface BrokerScheduleTaskRequest {
  id: string;
  name: string;
  cronExpression: string;
  kind?: string;
  params?: Record<string, unknown>;
  priority?: string;
  timeoutMs?: number;
}

export interface BrokerTaskStatusEntry {
  id: string;
  status: BrokerTaskStatus;
  result?: unknown;
  error?: string;
}

export interface BrokerSchedulerQueueEntry {
  id: string;
  name: string;
  nextRun: Date | null;
  enabled: boolean;
}
