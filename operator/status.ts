import fs from "node:fs";
import path from "node:path";

import { loadConfig } from "../config";
import { isPidAlive } from "../daemon_cleanup";
import { ProviderRegistry } from "../providers/registry";
import type { BrowserControlConfig } from "../config";
import type { BrokerProbeResult, SystemStatus } from "./types";

interface StatusOptions {
  env?: NodeJS.ProcessEnv;
  brokerProbe?: (config: BrowserControlConfig) => Promise<BrokerProbeResult>;
  serviceRegistry?: { list(): Array<unknown> };
  providerRegistry?: { getActiveName(): string };
}

async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(1500),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

export async function defaultBrokerProbe(config: BrowserControlConfig): Promise<BrokerProbeResult> {
  const brokerUrl = `http://127.0.0.1:${config.brokerPort}`;
  const headers: Record<string, string> = config.brokerAuthKey ? { "x-api-key": config.brokerAuthKey } : {};
  const endpoints = await Promise.allSettled([
    fetchJson(`${brokerUrl}/api/v1/health`, headers),
    fetchJson(`${brokerUrl}/api/v1/stats`, headers),
    fetchJson(`${brokerUrl}/api/v1/term/sessions`, headers),
    fetchJson(`${brokerUrl}/api/v1/tasks`, headers),
    fetchJson(`${brokerUrl}/api/v1/skills`, headers),
  ]);

  const [health, stats, terminalSessions, tasks, skills] = endpoints;
  const reachable = endpoints.some((entry) => entry.status === "fulfilled");
  if (!reachable) {
    const error = endpoints.find((entry) => entry.status === "rejected") as PromiseRejectedResult | undefined;
    return {
      reachable: false,
      brokerUrl,
      error: error?.reason instanceof Error ? error.reason.message : String(error?.reason ?? "unreachable"),
    };
  }

  return {
    reachable,
    brokerUrl,
    ...(health.status === "fulfilled" ? { health: health.value as BrokerProbeResult["health"] } : {}),
    ...(stats.status === "fulfilled" ? { stats: stats.value as Record<string, unknown> } : {}),
    ...(terminalSessions.status === "fulfilled" && Array.isArray(terminalSessions.value) ? { terminalSessions: terminalSessions.value as Array<Record<string, unknown>> } : {}),
    ...(tasks.status === "fulfilled" && Array.isArray(tasks.value) ? { tasks: tasks.value as Array<Record<string, unknown>> } : {}),
    ...(skills.status === "fulfilled" && Array.isArray(skills.value) ? { skills: skills.value as Array<Record<string, unknown>> } : {}),
  };
}

function localDaemonState(dataHome: string): { state: "running" | "stopped" | "degraded"; pid?: number; reason?: string } {
  const interop = path.join(dataHome, ".interop");
  const pidPath = path.join(interop, "daemon.pid");
  const statusPath = path.join(interop, "daemon-status.json");
  let statusRecord: Record<string, unknown> = {};

  try {
    if (fs.existsSync(statusPath)) {
      statusRecord = JSON.parse(fs.readFileSync(statusPath, "utf8")) as Record<string, unknown>;
    }
  } catch {
    statusRecord = {};
  }

  if (!fs.existsSync(pidPath)) {
    return { state: "stopped" };
  }

  const pid = Number(fs.readFileSync(pidPath, "utf8").trim());
  if (!Number.isFinite(pid) || pid <= 0 || !isPidAlive(pid)) {
    return { state: "stopped" };
  }

  const recorded = statusRecord.status === "degraded" ? "degraded" : "running";
  return {
    state: recorded,
    pid,
    ...(typeof statusRecord.reason === "string" ? { reason: statusRecord.reason } : {}),
  };
}

function countServices(dataHome: string, serviceRegistry?: { list(): Array<unknown> }): number {
  if (serviceRegistry) return serviceRegistry.list().length;
  const registryPath = path.join(dataHome, "services", "registry.json");
  try {
    if (!fs.existsSync(registryPath)) return 0;
    const parsed = JSON.parse(fs.readFileSync(registryPath, "utf8")) as { services?: Record<string, unknown> };
    return Object.keys(parsed.services ?? {}).length;
  } catch {
    return 0;
  }
}

function healthSummary(probe: BrokerProbeResult): SystemStatus["health"] {
  const checks = probe.health?.checks ?? [];
  return {
    overall: probe.health?.overall ?? "unknown",
    pass: checks.filter((check) => check.status === "pass").length,
    warn: checks.filter((check) => check.status === "warn").length,
    fail: checks.filter((check) => check.status === "fail").length,
  };
}

function countTasks(probe: BrokerProbeResult): { queued: number; running: number } {
  const statsTasks = probe.stats?.tasks as Record<string, unknown> | undefined;
  if (statsTasks) {
    return {
      queued: Number(statsTasks.queued ?? 0),
      running: Number(statsTasks.running ?? 0),
    };
  }
  const tasks = probe.tasks ?? [];
  return {
    queued: tasks.filter((task) => task.status === "pending" || task.status === "queued").length,
    running: tasks.filter((task) => task.status === "running").length,
  };
}

export async function collectStatus(options: StatusOptions = {}): Promise<SystemStatus> {
  const env = options.env ?? process.env;
  const config = loadConfig({ env, validate: false });
  const probe = await (options.brokerProbe ?? defaultBrokerProbe)(config);
  const localDaemon = localDaemonState(config.dataHome);
  const statsDaemon = probe.stats?.daemon as Record<string, unknown> | undefined;
  const daemonState = probe.reachable
    ? ((statsDaemon?.status as "running" | "stopped" | "degraded" | undefined) ?? localDaemon.state)
    : (localDaemon.state === "running" ? "degraded" : localDaemon.state);
  const tasks = countTasks(probe);
  const terminalSessions = probe.terminalSessions ?? [];
  const activeProvider = options.providerRegistry?.getActiveName()
    ?? new ProviderRegistry(config.dataHome).getActiveName();

  return {
    daemon: {
      state: daemonState,
      ...(typeof statsDaemon?.pid === "number" ? { pid: statsDaemon.pid } : localDaemon.pid ? { pid: localDaemon.pid } : {}),
      ...(localDaemon.reason ? { reason: localDaemon.reason } : {}),
    },
    broker: {
      reachable: probe.reachable,
      url: probe.brokerUrl,
      ...(probe.error ? { error: probe.error } : {}),
    },
    browser: {
      provider: activeProvider,
      activeSessions: Number(probe.stats?.activeSessions ?? 0),
      connection: (probe.stats?.browserConnection as Record<string, unknown> | undefined) ?? null,
    },
    terminal: {
      activeSessions: terminalSessions.length,
      sessions: terminalSessions,
    },
    tasks,
    services: {
      count: countServices(config.dataHome, options.serviceRegistry),
    },
    provider: {
      active: activeProvider,
    },
    policyProfile: config.policyProfile,
    dataHome: config.dataHome,
    health: healthSummary(probe),
    timestamp: new Date().toISOString(),
  };
}
