import type { ConfigEntry, ConfigSetResult } from "../config";
import type { HealthReport } from "../health_check";

export type OperatorCheckStatus = "pass" | "warn" | "fail";

export interface DoctorCheckResult {
  id: string;
  name: string;
  category: string;
  status: OperatorCheckStatus;
  details: string;
  fix: string;
  critical: boolean;
}

export interface DoctorReport {
  overall: "healthy" | "degraded" | "unhealthy";
  checks: DoctorCheckResult[];
  summary: {
    pass: number;
    warn: number;
    fail: number;
    criticalFailures: number;
  };
  timestamp: string;
}

export interface DoctorRunResult {
  report: DoctorReport;
  exitCode: 0 | 1;
}

export interface SetupResult {
  success: boolean;
  changed: string[];
  skipped: string[];
  warnings: string[];
  configPath: string;
  dataHome: string;
  mcpConfigSnippet?: Record<string, unknown>;
}

export interface BrokerProbeResult {
  reachable: boolean;
  brokerUrl: string;
  health?: HealthReport;
  stats?: Record<string, unknown>;
  terminalSessions?: Array<Record<string, unknown>>;
  tasks?: Array<Record<string, unknown>>;
  skills?: Array<Record<string, unknown>>;
  error?: string;
}

export interface SystemStatus {
  daemon: {
    state: "running" | "stopped" | "degraded";
    pid?: number;
    reason?: string;
  };
  broker: {
    reachable: boolean;
    url: string;
    error?: string;
  };
  browser: {
    provider: string;
    activeSessions: number;
    connection?: Record<string, unknown> | null;
  };
  terminal: {
    activeSessions: number;
    sessions: Array<Record<string, unknown>>;
  };
  tasks: {
    queued: number;
    running: number;
  };
  services: {
    count: number;
  };
  provider: {
    active: string;
  };
  policyProfile: string;
  dataHome: string;
  health: {
    overall: "healthy" | "degraded" | "unhealthy" | "unknown";
    pass: number;
    warn: number;
    fail: number;
  };
  timestamp: string;
}

export type ConfigCommandResult = ConfigEntry | ConfigEntry[] | ConfigSetResult;

