import "dotenv/config";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";

import type { HealthReport } from "./health_check";
import type {
  BrokerRunTaskRequest,
  BrokerScheduleTaskRequest,
  BrokerSchedulerQueueEntry,
  BrokerTaskStatus,
  BrokerTaskStatusEntry,
} from "./broker_types";
import type { SkillManifest } from "./skill";
import { Logger } from "./logger";
import type { TelemetrySummary } from "./telemetry";
import { getConfigEntries, getConfigValue, loadConfig, setUserConfigValue, type ConfigEntry, type ConfigSetResult } from "./config";
import { collectStatus } from "./operator/status";
import type { SystemStatus } from "./operator/types";
import { redactString } from "./observability/redaction";
import { DefaultPolicyEngine } from "./policy_engine";
import { defaultRouter } from "./execution_router";
import type { ExecutionContext, PolicyTaskIntent } from "./policy";

const brokerLog = new Logger({ component: "broker" });

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 7788;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 100;
const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const DEFAULT_DOMAIN_PARAM_FIELDS = [
  "url",
  "openUrl",
  "origin",
  "domain",
  "host",
  "hostname",
] as const;

type MaybePromise<T> = T | Promise<T>;
type JsonRecord = Record<string, unknown>;

export interface BrokerStatusPatch {
  status: BrokerTaskStatus;
  result?: unknown;
  error?: string;
}

export interface BrokerServerCallbacks {
  submitTask?: (
    request: BrokerRunTaskRequest,
  ) => MaybePromise<{ taskId: string } | string>;
  scheduleTask?: (
    request: BrokerScheduleTaskRequest,
  ) => MaybePromise<{ id: string; nextRun?: Date | string | null }>;
  kill?: () => MaybePromise<void>;
  getHealth?: () => MaybePromise<HealthReport>;
  getStats?: () => MaybePromise<TelemetrySummary | Record<string, unknown>>;
  getSchedulerQueue?: () => MaybePromise<BrokerSchedulerQueueEntry[]>;
  getTaskStatus?: (taskId: string) => MaybePromise<BrokerTaskStatusEntry | null>;
  listTasks?: () => MaybePromise<BrokerTaskStatusEntry[]>;
  listSkills?: () => MaybePromise<SkillManifest[]>;
  getStatus?: () => MaybePromise<SystemStatus | Record<string, unknown>>;
  listConfig?: () => MaybePromise<ConfigEntry[]>;
  getConfig?: (key: string) => MaybePromise<ConfigEntry>;
  setConfig?: (key: string, value: unknown) => MaybePromise<ConfigSetResult | Record<string, unknown>>;
  handleTerminal?: (subcommand: string, payload: JsonRecord) => MaybePromise<unknown>;
  handleFilesystem?: (subcommand: string, payload: JsonRecord) => MaybePromise<unknown>;
}

export interface BrokerServerOptions {
  env?: NodeJS.ProcessEnv;
  callbacks?: BrokerServerCallbacks;
  daemon?: {
    submitTask(task: {
      id: string;
      name: string;
      timeoutMs?: number;
      action: () => Promise<{ success: boolean; data?: unknown }>;
    }): Promise<string>;
    submitSkillTask(taskId: string, skillName: string, action: string, params: Record<string, unknown>): void;
    getScheduler(): {
      schedule(task: {
        id: string;
        name: string;
        cronExpression: string;
        enabled: boolean;
      }): void;
      getQueue(): BrokerSchedulerQueueEntry[];
    };
    emergencyKill(): Promise<void>;
    getHealthCheck(): {
      runAll(): Promise<HealthReport>;
    };
    getTelemetry(): {
      getSummary(): TelemetrySummary;
    };
    getStats(): Record<string, unknown>;
    termOpen?(config?: Record<string, unknown>): Promise<Record<string, unknown>>;
    termExec?(command: string, options?: Record<string, unknown>): Promise<unknown>;
    termType?(sessionId: string, text: string): Promise<{ ok: true }>;
    termRead?(sessionId: string, maxBytes?: number): Promise<{ output: string }>;
    termSnapshot?(sessionId?: string): Promise<unknown>;
    termInterrupt?(sessionId: string): Promise<{ ok: true }>;
    termClose?(sessionId: string): Promise<{ ok: true }>;
    termList?(): Array<Record<string, unknown>>;
    termResume?(sessionId: string): Promise<unknown>;
    termStatus?(sessionId: string): Promise<unknown>;
    fsRead?(pathname: string): unknown;
    fsWrite?(pathname: string, content: string): unknown;
    fsList?(pathname: string, recursive?: boolean, extension?: string): unknown;
    fsMove?(src: string, dst: string): unknown;
    fsDelete?(pathname: string, recursive?: boolean, force?: boolean): unknown;
    fsStat?(pathname: string): unknown;
  };
  rateLimit?: {
    windowMs?: number;
    maxRequests?: number;
  };
  allowedDomainParamFields?: string[];
  now?: () => number;
}

export interface BrokerServer {
  listen(port?: number, host?: string): Promise<AddressInfo>;
  close(): Promise<void>;
  address(): AddressInfo | string | null;
  setTaskStatus(taskId: string, patch: BrokerStatusPatch): BrokerTaskStatusEntry;
  getTaskStatus(taskId: string): BrokerTaskStatusEntry | null;
  listTaskStatuses(): BrokerTaskStatusEntry[];
}

interface BrokerResolvedConfig {
  port: number;
  authKey: string | null;
  allowedOrigins: string[] | null;
  allowedDomains: string[];
  allowedDomainParamFields: string[];
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
}

interface RateLimitBucket {
  requests: number[];
}

function splitCsv(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeOptionalString(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return fallback;
  }

  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`[BROKER_SERVER] Expected a positive integer but received "${value}".`);
  }

  return parsed;
}

function parsePort(value: string | undefined): number {
  const port = parsePositiveInteger(value, DEFAULT_PORT);
  if (port > 65535) {
    throw new Error("[BROKER_SERVER] BROKER_PORT must be between 1 and 65535.");
  }
  return port;
}

function parseAllowedDomains(value: string | undefined): string[] {
  return splitCsv(value).map((entry) => {
    const normalized = entry.toLowerCase();
    if (!HOSTNAME_PATTERN.test(normalized)) {
      throw new Error(`[BROKER_SERVER] BROKER_ALLOWED_DOMAINS contains invalid entry "${entry}".`);
    }
    return normalized;
  });
}

function resolveBrokerConfig(options: BrokerServerOptions): BrokerResolvedConfig {
  const env = options.env ?? process.env;

  return {
    port: parsePort(env.BROKER_PORT),
    authKey: normalizeOptionalString(env.BROKER_API_KEY) ?? normalizeOptionalString(env.BROKER_SECRET),
    allowedOrigins: (() => {
      const origins = splitCsv(env.BROKER_ALLOWED_ORIGINS);
      return origins.length > 0 ? origins : null;
    })(),
    allowedDomains: parseAllowedDomains(env.BROKER_ALLOWED_DOMAINS),
    allowedDomainParamFields: options.allowedDomainParamFields
      ?? [...DEFAULT_DOMAIN_PARAM_FIELDS],
    rateLimitWindowMs: options.rateLimit?.windowMs
      ?? parsePositiveInteger(env.BROKER_RATE_LIMIT_WINDOW_MS, DEFAULT_RATE_LIMIT_WINDOW_MS),
    rateLimitMaxRequests: options.rateLimit?.maxRequests
      ?? parsePositiveInteger(env.BROKER_RATE_LIMIT_MAX_REQUESTS, DEFAULT_RATE_LIMIT_MAX_REQUESTS),
  };
}

function createDefaultHealthReport(): HealthReport {
  return {
    overall: "healthy",
    checks: [],
    timestamp: new Date().toISOString(),
  };
}

function createDefaultTelemetrySummary(): TelemetrySummary {
  return {
    totalSteps: 0,
    successCount: 0,
    errorCount: 0,
    successRate: 0,
    averageDurationMs: 0,
    captchasSolved: 0,
    screenshotsCaptured: 0,
    proxyUsage: {},
    actions: {},
  };
}

function createCallbacksFromDaemon(
  daemon: NonNullable<BrokerServerOptions["daemon"]> | undefined,
): BrokerServerCallbacks {
  if (!daemon) {
    return {};
  }

  return {
    submitTask: async (request) => {
      // Skill tasks go through the daemon-managed skill path so they get
      // intent persistence, runningTaskIds tracking, graceful shutdown
      // handling, and startup recovery.
      if (request.skill) {
        const taskId = `skill-${request.skill}-${Date.now()}`;
        daemon.submitSkillTask(taskId, request.skill, request.action ?? "", request.params ?? {});
        return { taskId };
      }

      const actionName = request.action ?? "task";
      const taskId = await daemon.submitTask({
        id: actionName,
        name: actionName,
        timeoutMs: request.timeoutMs,
        action: async () => ({
          success: true,
          data: request.params ?? {},
        }),
      });

      return { taskId };
    },
    scheduleTask: async (request) => {
      const scheduler = daemon.getScheduler();
      scheduler.schedule({
        id: request.id,
        name: request.name,
        cronExpression: request.cronExpression,
        enabled: true,
      });

      const queueEntry = scheduler.getQueue().find((entry) => entry.id === request.id);
      return {
        id: request.id,
        nextRun: queueEntry?.nextRun ?? null,
      };
    },
    kill: async () => {
      await daemon.emergencyKill();
    },
    getHealth: async () => daemon.getHealthCheck().runAll(),
    getStats: async () => daemon.getStats(),
    getSchedulerQueue: async () => daemon.getScheduler().getQueue(),
    getTaskStatus: async () => null,
    listTasks: async () => [],
    handleTerminal: async (subcommand, payload) => {
      switch (subcommand) {
        case "open":
          if (!daemon.termOpen) throw new Error("Terminal open is not configured.");
          return daemon.termOpen(payload);
        case "exec":
          if (!daemon.termExec) throw new Error("Terminal exec is not configured.");
          return daemon.termExec(payload.command as string, payload as Record<string, unknown>);
        case "type":
          if (!daemon.termType) throw new Error("Terminal type is not configured.");
          return daemon.termType(payload.sessionId as string, payload.text as string);
        case "read":
          if (!daemon.termRead) throw new Error("Terminal read is not configured.");
          return daemon.termRead(payload.sessionId as string, payload.maxBytes as number | undefined);
        case "snapshot":
          if (!daemon.termSnapshot) throw new Error("Terminal snapshot is not configured.");
          return daemon.termSnapshot(payload.sessionId as string | undefined);
        case "interrupt":
          if (!daemon.termInterrupt) throw new Error("Terminal interrupt is not configured.");
          return daemon.termInterrupt(payload.sessionId as string);
        case "close":
          if (!daemon.termClose) throw new Error("Terminal close is not configured.");
          return daemon.termClose(payload.sessionId as string);
        case "sessions":
          if (!daemon.termList) throw new Error("Terminal listing is not configured.");
          return daemon.termList();
        case "resume":
          if (!daemon.termResume) throw new Error("Terminal resume is not configured.");
          return daemon.termResume(payload.sessionId as string);
        case "status":
          if (!daemon.termStatus) throw new Error("Terminal status is not configured.");
          return daemon.termStatus(payload.sessionId as string);
        default:
          throw new Error(`Unknown term subcommand: ${subcommand}`);
      }
    },
    handleFilesystem: async (subcommand, payload) => {
      switch (subcommand) {
        case "read":
          if (!daemon.fsRead) throw new Error("Filesystem read is not configured.");
          return daemon.fsRead(payload.path as string);
        case "write":
          if (!daemon.fsWrite) throw new Error("Filesystem write is not configured.");
          return daemon.fsWrite(payload.path as string, (payload.content as string) ?? "");
        case "list":
          if (!daemon.fsList) throw new Error("Filesystem list is not configured.");
          return daemon.fsList(payload.path as string, payload.recursive === true, payload.extension as string | undefined);
        case "move":
          if (!daemon.fsMove) throw new Error("Filesystem move is not configured.");
          return daemon.fsMove(payload.src as string, payload.dst as string);
        case "delete":
          if (!daemon.fsDelete) throw new Error("Filesystem delete is not configured.");
          return daemon.fsDelete(payload.path as string, payload.recursive === true, payload.force === true);
        case "stat":
          if (!daemon.fsStat) throw new Error("Filesystem stat is not configured.");
          return daemon.fsStat(payload.path as string);
        default:
          throw new Error(`Unknown fs subcommand: ${subcommand}`);
      }
    },
  };
}

function writeJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  if (!response.headersSent) {
    response.setHeader("Content-Type", "application/json");
  }

  response.writeHead(statusCode);
  response.end(JSON.stringify(payload));
}

function setCorsHeaders(
  response: ServerResponse,
  request: IncomingMessage,
  config: BrokerResolvedConfig,
): void {
  const requestOrigin = typeof request.headers.origin === "string" ? request.headers.origin : undefined;
  const allowOrigin = config.allowedOrigins
    ? (requestOrigin && config.allowedOrigins.includes(requestOrigin) ? requestOrigin : undefined)
    : "*";

  if (allowOrigin) {
    response.setHeader("Access-Control-Allow-Origin", allowOrigin);
    response.setHeader("Vary", "Origin");
  }

  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key");
}

function extractApiKey(request: IncomingMessage): string | null {
  const headerKey = request.headers["x-api-key"];
  if (typeof headerKey === "string" && headerKey.trim()) {
    return headerKey.trim();
  }

  const authorization = request.headers.authorization;
  if (!authorization) {
    return null;
  }

  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() || null;
}

function isBrowserOriginRequest(request: IncomingMessage): boolean {
  return typeof request.headers.origin === "string" && request.headers.origin.trim().length > 0;
}

function isPolicyAllowed(decision: string): boolean {
  return decision === "allow" || decision === "allow_with_audit";
}

function evaluateBrokerActionPolicy(
  action: string,
  params: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
): { allowed: true } | { allowed: false; statusCode: number; body: JsonRecord } {
  const appConfig = loadConfig({ env, validate: false });
  const profileName = appConfig.policyProfile;
  const sessionId = "broker";
  const actor = "agent";
  const intent: PolicyTaskIntent = {
    goal: action,
    actor,
    sessionId,
    metadata: { source: "broker" },
  };
  const context: ExecutionContext = {
    sessionId,
    actor,
    profileName,
    metadata: { source: "broker" },
  };
  const step = defaultRouter.buildRoutedStep(intent, action, params, context);
  const evaluation = new DefaultPolicyEngine({ profileName }).evaluate(step, context);

  if (isPolicyAllowed(evaluation.decision)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    statusCode: 403,
    body: {
      success: false,
      path: step.path,
      sessionId,
      error: evaluation.reason,
      policyDecision: evaluation.decision,
      risk: evaluation.risk,
      completedAt: new Date().toISOString(),
    },
  };
}

async function readJsonBody(request: IncomingMessage): Promise<JsonRecord> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const rawBody = Buffer.concat(chunks).toString("utf8").trim();
  if (!rawBody) {
    return {};
  }

  const parsed = JSON.parse(rawBody) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Request body must be a JSON object.");
  }

  return parsed as JsonRecord;
}

function toRunTaskRequest(body: JsonRecord): BrokerRunTaskRequest {
  return {
    ...(typeof body.skill === "string" ? { skill: body.skill } : {}),
    ...(typeof body.action === "string" ? { action: body.action } : {}),
    ...(body.params && typeof body.params === "object" && !Array.isArray(body.params)
      ? { params: body.params as Record<string, unknown> }
      : {}),
    ...(typeof body.priority === "string" ? { priority: body.priority } : {}),
    ...(typeof body.timeoutMs === "number" ? { timeoutMs: body.timeoutMs } : {}),
  };
}

function toScheduleTaskRequest(body: JsonRecord): BrokerScheduleTaskRequest {
  if (typeof body.id !== "string" || typeof body.name !== "string" || typeof body.cronExpression !== "string") {
    throw new Error("Schedule requests require id, name, and cronExpression.");
  }

  return {
    id: body.id,
    name: body.name,
    cronExpression: body.cronExpression,
    ...(typeof body.kind === "string" ? { kind: body.kind } : {}),
    ...(body.params && typeof body.params === "object" && !Array.isArray(body.params)
      ? { params: body.params as Record<string, unknown> }
      : {}),
    ...(typeof body.priority === "string" ? { priority: body.priority } : {}),
    ...(typeof body.timeoutMs === "number" ? { timeoutMs: body.timeoutMs } : {}),
  };
}

function toHostname(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      return new URL(trimmed).hostname.toLowerCase();
    } catch {
      return null;
    }
  }

  const normalized = trimmed.toLowerCase();
  return HOSTNAME_PATTERN.test(normalized) ? normalized : null;
}

function isAllowedHostname(hostname: string, allowedDomains: string[]): boolean {
  return allowedDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

function collectDomainCandidates(
  value: unknown,
  allowedFields: Set<string>,
  output: string[],
): void {
  if (!value || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectDomainCandidates(entry, allowedFields, output);
    }
    return;
  }

  for (const [key, entry] of Object.entries(value as JsonRecord)) {
    if (allowedFields.has(key) && typeof entry === "string") {
      output.push(entry);
    }

    if (entry && typeof entry === "object") {
      collectDomainCandidates(entry, allowedFields, output);
    }
  }
}

function validateAllowedDomains(
  params: Record<string, unknown> | undefined,
  config: BrokerResolvedConfig,
): string | null {
  if (!params || config.allowedDomains.length === 0) {
    return null;
  }

  const candidates: string[] = [];
  collectDomainCandidates(
    params,
    new Set(config.allowedDomainParamFields),
    candidates,
  );

  for (const candidate of candidates) {
    const hostname = toHostname(candidate);
    if (!hostname || !isAllowedHostname(hostname, config.allowedDomains)) {
      return candidate;
    }
  }

  return null;
}

function serializeTaskStatus(entry: BrokerTaskStatusEntry): Record<string, unknown> {
  return {
    id: entry.id,
    status: entry.status,
    ...(entry.result !== undefined ? { result: entry.result } : {}),
    ...(entry.error ? { error: entry.error } : {}),
  };
}

function serializeSchedulerQueue(
  entries: BrokerSchedulerQueueEntry[],
): Array<Record<string, unknown>> {
  return entries.map((entry) => ({
    id: entry.id,
    name: entry.name,
    nextRun: entry.nextRun ? entry.nextRun.toISOString() : null,
    enabled: entry.enabled,
  }));
}

function writeUpgradeError(socket: Duplex, statusCode: number, message: string): void {
  socket.write(
    [
      `HTTP/1.1 ${statusCode} ${http.STATUS_CODES[statusCode] ?? "Error"}`,
      "Content-Type: application/json",
      "Connection: close",
      "",
      JSON.stringify({ error: message }),
    ].join("\r\n"),
  );
  socket.destroy();
}

export function normalizeClientIp(remoteAddress: string | undefined): string {
  if (!remoteAddress) {
    return "unknown";
  }

  if (remoteAddress === "::1") {
    return "127.0.0.1";
  }

  if (remoteAddress.startsWith("::ffff:")) {
    return remoteAddress.slice("::ffff:".length);
  }

  return remoteAddress;
}

export function createBrokerServer(options: BrokerServerOptions = {}): BrokerServer {
  const config = resolveBrokerConfig(options);
  const callbacks = options.callbacks ?? createCallbacksFromDaemon(options.daemon);
  const now = options.now ?? Date.now;
  const rateLimitBuckets = new Map<string, RateLimitBucket>();
  const taskStatuses = new Map<string, BrokerTaskStatusEntry>();
  const server = http.createServer();
  const webSocketServer = new WebSocketServer({ noServer: true });

  const consumeRateLimit = (request: IncomingMessage): boolean => {
    const clientIp = normalizeClientIp(request.socket.remoteAddress);
    const bucket = rateLimitBuckets.get(clientIp) ?? { requests: [] };
    const currentTime = now();
    const windowStart = currentTime - config.rateLimitWindowMs;
    bucket.requests = bucket.requests.filter((timestamp) => timestamp > windowStart);

    if (bucket.requests.length >= config.rateLimitMaxRequests) {
      rateLimitBuckets.set(clientIp, bucket);
      return false;
    }

    bucket.requests.push(currentTime);
    rateLimitBuckets.set(clientIp, bucket);
    return true;
  };

  const setTaskStatus = (taskId: string, patch: BrokerStatusPatch): BrokerTaskStatusEntry => {
    const nextEntry: BrokerTaskStatusEntry = {
      id: taskId,
      status: patch.status,
      ...(patch.result !== undefined ? { result: patch.result } : {}),
      ...(patch.error ? { error: patch.error } : {}),
    };

    taskStatuses.delete(taskId);
    taskStatuses.set(taskId, nextEntry);

    if (patch.status === "completed" || patch.status === "failed") {
      const payload = JSON.stringify({
        type: "task_completed",
        taskId,
        status: patch.status,
        ...(patch.result !== undefined ? { result: patch.result } : {}),
        ...(patch.error ? { error: patch.error } : {}),
      });

      for (const client of webSocketServer.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(payload);
        }
      }
    }

    return nextEntry;
  };

  const getTaskStatus = (taskId: string): BrokerTaskStatusEntry | null => {
    return taskStatuses.get(taskId) ?? null;
  };

  const listTaskStatuses = (): BrokerTaskStatusEntry[] => {
    return Array.from(taskStatuses.values()).reverse();
  };

  server.on("request", async (request, response) => {
    setCorsHeaders(response, request, config);

    if (!consumeRateLimit(request)) {
      writeJson(response, 429, { error: "Rate limit exceeded." });
      return;
    }

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    if (!config.authKey && isBrowserOriginRequest(request)) {
      writeJson(response, 403, {
        error: "Browser-origin broker requests require BROKER_API_KEY or BROKER_SECRET to be configured.",
      });
      return;
    }

    if (config.authKey) {
      const apiKey = extractApiKey(request);
      if (apiKey !== config.authKey) {
        writeJson(response, 401, { error: "Unauthorized." });
        return;
      }
    }

    try {
      const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? DEFAULT_HOST}`);
      const { pathname } = requestUrl;

      if (request.method === "POST" && pathname === "/api/v1/tasks/run") {
        if (!callbacks.submitTask) {
          writeJson(response, 503, { error: "Task submission callback is not configured." });
          return;
        }

        const body = await readJsonBody(request);

        // All task submissions — including skill tasks — go through the
        // submitTask callback so the daemon-managed path handles intent
        // persistence, tracking, graceful shutdown, and recovery.
        const payload = toRunTaskRequest(body);
        const invalidDomain = validateAllowedDomains(payload.params, config);
        if (invalidDomain) {
          writeJson(response, 403, {
            error: `Task params contain a disallowed domain target: ${invalidDomain}.`,
          });
          return;
        }

        const submission = await callbacks.submitTask(payload);
        const taskId = typeof submission === "string" ? submission : submission.taskId;
        setTaskStatus(taskId, {
          status: "pending",
        });
        writeJson(response, 202, {
          taskId,
          status: "pending",
        });
        return;
      }

      if (request.method === "POST" && pathname === "/api/v1/tasks/schedule") {
        if (!callbacks.scheduleTask) {
          writeJson(response, 503, { error: "Schedule callback is not configured." });
          return;
        }

        const payload = toScheduleTaskRequest(await readJsonBody(request));
        const scheduled = await callbacks.scheduleTask(payload);
        writeJson(response, 200, {
          id: scheduled.id,
          ...(scheduled.nextRun !== undefined
            ? {
              nextRun: scheduled.nextRun instanceof Date
                ? scheduled.nextRun.toISOString()
                : scheduled.nextRun,
            }
            : {}),
        });
        return;
      }

      if (request.method === "GET" && pathname === "/api/v1/tasks") {
        const taskList = callbacks.listTasks ? await callbacks.listTasks() : listTaskStatuses();
        writeJson(response, 200, taskList.map(serializeTaskStatus));
        return;
      }

      if (request.method === "GET" && /^\/api\/v1\/tasks\/[^/]+\/status$/u.test(pathname)) {
        const taskId = decodeURIComponent(pathname.split("/")[4] ?? "");
        const taskStatus = callbacks.getTaskStatus ? await callbacks.getTaskStatus(taskId) : getTaskStatus(taskId);
        if (!taskStatus) {
          writeJson(response, 404, { error: `Task "${taskId}" was not found.` });
          return;
        }

        writeJson(response, 200, serializeTaskStatus(taskStatus));
        return;
      }

      if (request.method === "POST" && pathname === "/api/v1/kill") {
        if (callbacks.kill) {
          await callbacks.kill();
        }
        writeJson(response, 202, { status: "stopping" });
        return;
      }

      if (request.method === "GET" && pathname === "/api/v1/health") {
        writeJson(response, 200, callbacks.getHealth ? await callbacks.getHealth() : createDefaultHealthReport());
        return;
      }

      if (request.method === "GET" && pathname === "/api/v1/stats") {
        writeJson(response, 200, callbacks.getStats ? await callbacks.getStats() : createDefaultTelemetrySummary());
        return;
      }

      if (request.method === "GET" && pathname === "/api/v1/scheduler") {
        const queue = callbacks.getSchedulerQueue ? await callbacks.getSchedulerQueue() : [];
        writeJson(response, 200, serializeSchedulerQueue(queue));
        return;
      }

      if (request.method === "GET" && pathname === "/api/v1/skills") {
        const skills = callbacks.listSkills ? await callbacks.listSkills() : [];
        writeJson(response, 200, skills);
        return;
      }

      if (request.method === "GET" && pathname === "/api/v1/status") {
        writeJson(response, 200, callbacks.getStatus ? await callbacks.getStatus() : await collectStatus());
        return;
      }

      if (request.method === "GET" && pathname === "/api/v1/config") {
        writeJson(response, 200, callbacks.listConfig ? await callbacks.listConfig() : getConfigEntries({ validate: false }));
        return;
      }

      if ((request.method === "GET" || request.method === "POST") && pathname.startsWith("/api/v1/config/")) {
        const key = decodeURIComponent(pathname.slice("/api/v1/config/".length));
        if (!key) {
          writeJson(response, 400, { error: "Config key is required." });
          return;
        }

        if (request.method === "GET") {
          writeJson(response, 200, callbacks.getConfig ? await callbacks.getConfig(key) : getConfigValue(key, { validate: false }));
          return;
        }

        if (request.method === "POST" && !config.authKey) {
          writeJson(response, 403, {
            error: "Broker config mutation requires BROKER_API_KEY or BROKER_SECRET to be configured.",
          });
          return;
        }

        const body = await readJsonBody(request);
        if (!Object.prototype.hasOwnProperty.call(body, "value")) {
          writeJson(response, 400, { error: "Config set requires a JSON body with value." });
          return;
        }
        const policyEval = evaluateBrokerActionPolicy("config_set", { key, value: body.value }, options.env ?? process.env);
        if (!policyEval.allowed) {
          writeJson(response, policyEval.statusCode, policyEval.body);
          return;
        }
        writeJson(response, 200, callbacks.setConfig ? await callbacks.setConfig(key, body.value) : setUserConfigValue(key, body.value));
        return;
      }

      if ((request.method === "GET" || request.method === "POST") && pathname.startsWith("/api/v1/term/")) {
        if (!callbacks.handleTerminal) {
          writeJson(response, 503, { error: "Terminal callback is not configured." });
          return;
        }

        const subcommand = pathname.slice("/api/v1/term/".length);
        const payload = request.method === "POST"
          ? await readJsonBody(request)
          : Object.fromEntries(requestUrl.searchParams.entries());
        const result = await callbacks.handleTerminal(subcommand, payload);
        writeJson(response, 200, result);
        return;
      }

      if ((request.method === "GET" || request.method === "POST") && pathname.startsWith("/api/v1/fs/")) {
        if (!callbacks.handleFilesystem) {
          writeJson(response, 503, { error: "Filesystem callback is not configured." });
          return;
        }

        const subcommand = pathname.slice("/api/v1/fs/".length);
        const payload = request.method === "POST"
          ? await readJsonBody(request)
          : Object.fromEntries(requestUrl.searchParams.entries());
        const result = await callbacks.handleFilesystem(subcommand, payload);
        writeJson(response, 200, result);
        return;
      }

      writeJson(response, 404, { error: "Not found." });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      writeJson(response, 400, {
        error: redactString(message),
      });
    }
  });

  server.on("upgrade", (request, socket, head) => {
    if (!consumeRateLimit(request)) {
      writeUpgradeError(socket, 429, "Rate limit exceeded.");
      return;
    }

    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? DEFAULT_HOST}`);
    if (requestUrl.pathname !== "/ws") {
      writeUpgradeError(socket, 404, "Not found.");
      return;
    }

    if (config.authKey) {
      const apiKey = extractApiKey(request);
      if (apiKey !== config.authKey) {
        writeUpgradeError(socket, 401, "Unauthorized.");
        return;
      }
    }

    webSocketServer.handleUpgrade(request, socket, head, (client) => {
      webSocketServer.emit("connection", client, request);
    });
  });

  return {
    async listen(port = config.port, host = DEFAULT_HOST): Promise<AddressInfo> {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          resolve();
        });
      });

      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("[BROKER_SERVER] Server did not provide a TCP address.");
      }

      return address;
    },
    async close(): Promise<void> {
      await new Promise<void>((resolve) => {
        webSocketServer.clients.forEach((client) => client.close());
        webSocketServer.close(() => resolve());
      });

      if (!server.listening) {
        return;
      }

      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
    address(): AddressInfo | string | null {
      return server.address();
    },
    setTaskStatus,
    getTaskStatus,
    listTaskStatuses,
  };
}

export async function startStandaloneBroker(): Promise<BrokerServer> {
  const broker = createBrokerServer();
  const address = await broker.listen();
  brokerLog.info(`Listening on http://${address.address}:${address.port}`);
  return broker;
}

if (require.main === module) {
  void startStandaloneBroker().catch((error: unknown) => {
    brokerLog.critical(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
