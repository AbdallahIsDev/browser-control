export const BROKER_TOOLS = [
  "tabs.list",
  "tabs.find",
  "action.click",
  "action.fill",
  "action.read-text",
  "action.screenshot",
  "action.press-key",
  "action.select-option",
] as const;

export type BrokerTool = (typeof BROKER_TOOLS)[number];

export interface BrokerConfig {
  port: number;
  secret: string;
  allowedDomains: string[];
  allowedTools: BrokerTool[];
  logDir: string;
  defaultSessionTtlSeconds: number;
  maxSessionTtlSeconds: number;
  maxRequestsPerSession: number;
  killSwitchPath: string;
}

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
