import { collectStatus } from "./status";
import type { SystemStatus } from "./types";

export interface DashboardEvent {
  id: string;
  kind: "terminal" | "browser" | "task" | "policy" | "artifact" | "provider";
  timestamp: string;
  sessionId?: string;
  payload: unknown;
}

export interface DashboardState {
  system: SystemStatus;
  summary: {
    status: string;
  };
  browsers: {
    active: number;
    provider: string;
  };
  terminals: {
    active: number;
  };
  tasks: {
    queued: number;
    running: number;
  };
  services: {
    count: number;
  };
  events: DashboardEvent[];
}

export async function getDashboardState(options?: { env?: NodeJS.ProcessEnv }): Promise<DashboardState> {
  const system = await collectStatus({ env: options?.env });
  
  // TODO(Section 28): Pull bounded recent event list from existing daemon state when event source is available.
  // We do not invent a second source of truth here. Returning an empty bounded event array for now.
  return {
    system,
    summary: {
      status: system.daemon.state,
    },
    browsers: {
      active: system.browser.activeSessions,
      provider: system.browser.provider,
    },
    terminals: {
      active: system.terminal.activeSessions,
    },
    tasks: {
      queued: system.tasks.queued,
      running: system.tasks.running,
    },
    services: {
      count: system.services.count,
    },
    events: [], // Max 100 recent events
  };
}
