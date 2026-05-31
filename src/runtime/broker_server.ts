import "dotenv/config";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { redactString } from "../observability/redaction";
import { collectStatus } from "../operator/status";
import type { SystemStatus } from "../operator/types";
import { DefaultPolicyEngine } from "../policy/engine";
import { defaultRouter } from "../policy/execution_router";
import type { ExecutionContext, PolicyEngine, PolicyTaskIntent } from "../policy/types";
import {
	type ConfigEntry,
	type ConfigSetResult,
	getConfigEntries,
	getConfigValue,
	ensureBrokerAuthKey,
	loadConfig,
	setUserConfigValue,
} from "../shared/config";
import { constantTimeTokenEqual } from "../shared/auth";
import { Logger } from "../shared/logger";
import { isBrowserOriginRequest } from "../web/security";
import type { SkillManifest } from "../skill";
import type {
	BrokerRunTaskRequest,
	BrokerSchedulerQueueEntry,
	BrokerScheduleTaskRequest,
	BrokerTaskStatus,
	BrokerTaskStatusEntry,
} from "./broker_types";
import type { HealthReport } from "./health_check";
import type { MemoryStore } from "./memory_store";
import type { TelemetrySummary } from "./telemetry";

const brokerLog = new Logger({ component: "broker" });

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 7788;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 100;
const DEFAULT_RATE_LIMIT_BUCKET_TTL_MS = 5 * 60_000;
const DEFAULT_TASK_STATUS_RETENTION_MS = 60 * 60_000;
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_CLOSE_TIMEOUT_MS = 5_000;
const MAX_DOMAIN_PARAM_DEPTH = 10;
const MAX_SUBSCRIPTION_CHANNELS = 100;
const MAX_SUBSCRIPTION_CHANNEL_LENGTH = 128;
const BROKER_TASK_STATUS_STORE_PREFIX = "broker:task:";
const BROKER_RATE_LIMIT_STORE_PREFIX = "broker:rate-limit:";
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
type BrokerMemoryStore = Pick<MemoryStore, "delete" | "get" | "keys" | "set">;

export interface BrokerStatusPatch {
	status: BrokerTaskStatus;
	result?: unknown;
	error?: string;
}

export interface BrokerTaskSubmissionResult {
	taskId: string;
	accepted?: boolean;
	status?: "pending" | "running" | "failed";
	error?: string;
	statusCode?: number;
}

export interface BrokerServerCallbacks {
	submitTask?: (
		request: BrokerRunTaskRequest,
	) => MaybePromise<BrokerTaskSubmissionResult | string>;
	scheduleTask?: (
		request: BrokerScheduleTaskRequest,
	) => MaybePromise<{ id: string; nextRun?: Date | string | null }>;
	pauseScheduledTask?: (
		id: string,
	) => MaybePromise<BrokerSchedulerQueueEntry | null>;
	resumeScheduledTask?: (
		id: string,
	) => MaybePromise<BrokerSchedulerQueueEntry | null>;
	removeScheduledTask?: (id: string) => MaybePromise<boolean>;
	kill?: () => MaybePromise<void>;
	getHealth?: () => MaybePromise<HealthReport>;
	getStats?: () => MaybePromise<TelemetrySummary | Record<string, unknown>>;
	getSchedulerQueue?: () => MaybePromise<BrokerSchedulerQueueEntry[]>;
	getTaskStatus?: (
		taskId: string,
	) => MaybePromise<BrokerTaskStatusEntry | null>;
	listTasks?: () => MaybePromise<BrokerTaskStatusEntry[]>;
	listSkills?: () => MaybePromise<SkillManifest[]>;
	getStatus?: () => MaybePromise<SystemStatus | Record<string, unknown>>;
	listConfig?: () => MaybePromise<ConfigEntry[]>;
	getConfig?: (key: string) => MaybePromise<ConfigEntry>;
	setConfig?: (
		key: string,
		value: unknown,
	) => MaybePromise<ConfigSetResult | Record<string, unknown>>;
	handleTerminal?: (
		subcommand: string,
		payload: JsonRecord,
	) => MaybePromise<unknown>;
	handleFilesystem?: (
		subcommand: string,
		payload: JsonRecord,
	) => MaybePromise<unknown>;
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
		submitSkillTask(
			taskId: string,
			skillName: string,
			action: string,
			params: Record<string, unknown>,
		): BrokerTaskSubmissionResult | void;
		getScheduler(): {
			schedule(task: {
				id: string;
				name: string;
				cronExpression: string;
				enabled: boolean;
			}): void;
			pause(id: string): void;
			resume(id: string): void;
			unschedule(id: string): void;
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
		getTaskStatus?(
			taskId: string,
		): MaybePromise<BrokerTaskStatusEntry | null>;
		getRecentTasks?(): MaybePromise<BrokerTaskStatusEntry[]>;
		termOpen?(
			config?: Record<string, unknown>,
		): Promise<Record<string, unknown>>;
		termExec?(
			command: string,
			options?: Record<string, unknown>,
		): Promise<unknown>;
		termType?(
			sessionId: string,
			text: string,
			options?: { submit?: boolean },
		): Promise<{ ok: true }>;
		termRead?(
			sessionId: string,
			maxBytes?: number,
		): Promise<{ output: string }>;
		termSnapshot?(sessionId?: string): Promise<unknown>;
		termInterrupt?(sessionId: string): Promise<{ ok: true }>;
		termClose?(sessionId: string): Promise<{ ok: true }>;
		termResize?(
			sessionId: string,
			cols: number,
			rows: number,
		): Promise<{ ok: true }>;
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
		bucketTtlMs?: number;
	};
	taskStatusRetentionMs?: number;
	allowedDomainParamFields?: string[];
	memoryStore?: BrokerMemoryStore;
	policyEngine?: PolicyEngine;
	closeTimeoutMs?: number;
	now?: () => number;
}

export interface BrokerServer {
	listen(port?: number, host?: string): Promise<AddressInfo>;
	close(): Promise<void>;
	address(): AddressInfo | string | null;
	setTaskStatus(
		taskId: string,
		patch: BrokerStatusPatch,
	): BrokerTaskStatusEntry;
	getTaskStatus(taskId: string): BrokerTaskStatusEntry | null;
	listTaskStatuses(): BrokerTaskStatusEntry[];
	broadcast(message: unknown): void;
}

interface BrokerResolvedConfig {
	port: number;
	authKey: string | null;
	allowedOrigins: string[] | null;
	allowedDomains: string[];
	allowedDomainParamFields: string[];
	rateLimitWindowMs: number;
	rateLimitMaxRequests: number;
	rateLimitBucketTtlMs: number;
	taskStatusRetentionMs: number;
	maxBodyBytes: number;
	closeTimeoutMs: number;
}

interface RateLimitBucket {
	requests: number[];
	lastAccessedAt: number;
}

interface BrokerTaskStatusRecord extends BrokerTaskStatusEntry {
	updatedAt: number;
}

function isBrokerTaskStatus(value: unknown): value is BrokerTaskStatus {
	return (
		value === "pending" ||
		value === "running" ||
		value === "completed" ||
		value === "failed"
	);
}

function isBrokerTaskStatusRecord(
	value: unknown,
): value is BrokerTaskStatusRecord {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return (
		typeof record.id === "string" &&
		isBrokerTaskStatus(record.status) &&
		typeof record.updatedAt === "number"
	);
}

function isRateLimitBucket(value: unknown): value is RateLimitBucket {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return (
		Array.isArray(record.requests) &&
		record.requests.every((timestamp) => typeof timestamp === "number") &&
		typeof record.lastAccessedAt === "number"
	);
}

function isHealthPath(pathname: string): boolean {
	return (
		pathname === "/health" ||
		pathname === "/readyz" ||
		pathname === "/api/v1/health"
	);
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

function parsePositiveInteger(
	value: string | undefined,
	fallback: number,
): number {
	const normalized = normalizeOptionalString(value);
	if (!normalized) {
		return fallback;
	}

	const parsed = Number(normalized);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error(
			`[BROKER_SERVER] Expected a positive integer but received "${value}".`,
		);
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
			throw new Error(
				`[BROKER_SERVER] BROKER_ALLOWED_DOMAINS contains invalid entry "${entry}".`,
			);
		}
		return normalized;
	});
}

function isLoopbackCorsOrigin(origin: string): boolean {
	try {
		const parsed = new URL(origin);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			return false;
		}

		const hostname = parsed.hostname.toLowerCase();
		return (
			hostname === "localhost" ||
			hostname === "::1" ||
			hostname === "[::1]" ||
			/^127(?:\.\d{1,3}){3}$/.test(hostname)
		);
	} catch {
		return false;
	}
}

function resolveBrokerConfig(
	options: BrokerServerOptions,
): BrokerResolvedConfig {
	const env = options.env ?? process.env;

	return {
		port: parsePort(env.BROKER_PORT),
		authKey:
			normalizeOptionalString(env.BROKER_API_KEY) ??
			normalizeOptionalString(env.BROKER_SECRET) ??
			ensureBrokerAuthKey(env),
		allowedOrigins: (() => {
			const origins = splitCsv(env.BROKER_ALLOWED_ORIGINS);
			return origins.length > 0 ? origins : null;
		})(),
		allowedDomains: parseAllowedDomains(env.BROKER_ALLOWED_DOMAINS),
		allowedDomainParamFields: options.allowedDomainParamFields ?? [
			...DEFAULT_DOMAIN_PARAM_FIELDS,
		],
		rateLimitWindowMs:
			options.rateLimit?.windowMs ??
			parsePositiveInteger(
				env.BROKER_RATE_LIMIT_WINDOW_MS,
				DEFAULT_RATE_LIMIT_WINDOW_MS,
			),
		rateLimitMaxRequests:
			options.rateLimit?.maxRequests ??
			parsePositiveInteger(
				env.BROKER_RATE_LIMIT_MAX_REQUESTS,
				DEFAULT_RATE_LIMIT_MAX_REQUESTS,
			),
		rateLimitBucketTtlMs:
			options.rateLimit?.bucketTtlMs ??
			parsePositiveInteger(
				env.BROKER_RATE_LIMIT_BUCKET_TTL_MS,
				DEFAULT_RATE_LIMIT_BUCKET_TTL_MS,
			),
		taskStatusRetentionMs:
			options.taskStatusRetentionMs ??
			parsePositiveInteger(
				env.BROKER_TASK_STATUS_RETENTION_MS,
				DEFAULT_TASK_STATUS_RETENTION_MS,
			),
		maxBodyBytes: parsePositiveInteger(
			env.BROKER_MAX_BODY_BYTES,
			DEFAULT_MAX_BODY_BYTES,
		),
		closeTimeoutMs:
			options.closeTimeoutMs ??
			parsePositiveInteger(
				env.BROKER_CLOSE_TIMEOUT_MS,
				DEFAULT_CLOSE_TIMEOUT_MS,
			),
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
				const submission = daemon.submitSkillTask(
					taskId,
					request.skill,
					request.action ?? "",
					request.params ?? {},
				);
				return submission ?? { taskId };
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

			const queueEntry = scheduler
				.getQueue()
				.find((entry) => entry.id === request.id);
			return {
				id: request.id,
				nextRun: queueEntry?.nextRun ?? null,
			};
		},
		pauseScheduledTask: async (id) => {
			const scheduler = daemon.getScheduler();
			if (!scheduler.getQueue().some((entry) => entry.id === id)) {
				return null;
			}
			scheduler.pause(id);
			return scheduler.getQueue().find((entry) => entry.id === id) ?? null;
		},
		resumeScheduledTask: async (id) => {
			const scheduler = daemon.getScheduler();
			if (!scheduler.getQueue().some((entry) => entry.id === id)) {
				return null;
			}
			scheduler.resume(id);
			return scheduler.getQueue().find((entry) => entry.id === id) ?? null;
		},
		removeScheduledTask: async (id) => {
			const scheduler = daemon.getScheduler();
			if (!scheduler.getQueue().some((entry) => entry.id === id)) {
				return false;
			}
			scheduler.unschedule(id);
			return true;
		},
		kill: async () => {
			await daemon.emergencyKill();
		},
		getHealth: async () => daemon.getHealthCheck().runAll(),
		getStats: async () => daemon.getStats(),
		getSchedulerQueue: async () => daemon.getScheduler().getQueue(),
		...(daemon.getTaskStatus
			? {
					getTaskStatus: async (taskId) =>
						daemon.getTaskStatus?.(taskId) ?? null,
				}
			: {}),
		...(daemon.getRecentTasks
			? {
					listTasks: async () => daemon.getRecentTasks?.() ?? [],
				}
			: {}),
		handleTerminal: async (subcommand, payload) => {
			switch (subcommand) {
				case "open":
					if (!daemon.termOpen)
						throw new Error("Terminal open is not configured.");
					return daemon.termOpen(payload);
				case "exec":
					if (!daemon.termExec)
						throw new Error("Terminal exec is not configured.");
					return daemon.termExec(
						payload.command as string,
						payload as Record<string, unknown>,
					);
				case "type":
					if (!daemon.termType)
						throw new Error("Terminal type is not configured.");
					return daemon.termType(
						payload.sessionId as string,
						payload.text as string,
						{ submit: payload.submit !== false },
					);
				case "read":
					if (!daemon.termRead)
						throw new Error("Terminal read is not configured.");
					return daemon.termRead(
						payload.sessionId as string,
						payload.maxBytes as number | undefined,
					);
				case "snapshot":
					if (!daemon.termSnapshot)
						throw new Error("Terminal snapshot is not configured.");
					return daemon.termSnapshot(payload.sessionId as string | undefined);
				case "interrupt":
					if (!daemon.termInterrupt)
						throw new Error("Terminal interrupt is not configured.");
					return daemon.termInterrupt(payload.sessionId as string);
				case "close":
					if (!daemon.termClose)
						throw new Error("Terminal close is not configured.");
					return daemon.termClose(payload.sessionId as string);
				case "resize":
					if (!daemon.termResize)
						throw new Error("Terminal resize is not configured.");
					return daemon.termResize(
						payload.sessionId as string,
						payload.cols as number,
						payload.rows as number,
					);
				case "sessions":
					if (!daemon.termList)
						throw new Error("Terminal listing is not configured.");
					return daemon.termList();
				case "resume":
					if (!daemon.termResume)
						throw new Error("Terminal resume is not configured.");
					return daemon.termResume(payload.sessionId as string);
				case "status":
					if (!daemon.termStatus)
						throw new Error("Terminal status is not configured.");
					return daemon.termStatus(payload.sessionId as string);
				default:
					throw new Error(`Unknown term subcommand: ${subcommand}`);
			}
		},
		handleFilesystem: async (subcommand, payload) => {
			switch (subcommand) {
				case "read":
					if (!daemon.fsRead)
						throw new Error("Filesystem read is not configured.");
					return daemon.fsRead(payload.path as string);
				case "write":
					if (!daemon.fsWrite)
						throw new Error("Filesystem write is not configured.");
					return daemon.fsWrite(
						payload.path as string,
						(payload.content as string) ?? "",
					);
				case "list":
					if (!daemon.fsList)
						throw new Error("Filesystem list is not configured.");
					return daemon.fsList(
						payload.path as string,
						payload.recursive === true,
						payload.extension as string | undefined,
					);
				case "move":
					if (!daemon.fsMove)
						throw new Error("Filesystem move is not configured.");
					return daemon.fsMove(payload.src as string, payload.dst as string);
				case "delete":
					if (!daemon.fsDelete)
						throw new Error("Filesystem delete is not configured.");
					return daemon.fsDelete(
						payload.path as string,
						payload.recursive === true,
						payload.force === true,
					);
				case "stat":
					if (!daemon.fsStat)
						throw new Error("Filesystem stat is not configured.");
					return daemon.fsStat(payload.path as string);
				default:
					throw new Error(`Unknown fs subcommand: ${subcommand}`);
			}
		},
	};
}

function writeJson(
	response: ServerResponse,
	statusCode: number,
	payload: unknown,
): void {
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
	const requestOrigin =
		typeof request.headers.origin === "string"
			? request.headers.origin
			: undefined;
	const allowOrigin = config.allowedOrigins
		? config.allowedOrigins.includes("*")
			? "*"
			: requestOrigin && config.allowedOrigins.includes(requestOrigin)
				? requestOrigin
				: undefined
		: requestOrigin && isLoopbackCorsOrigin(requestOrigin)
			? requestOrigin
			: undefined;

	if (allowOrigin) {
		response.setHeader("Access-Control-Allow-Origin", allowOrigin);
		response.setHeader("Vary", "Origin");
	}

	response.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
	response.setHeader(
		"Access-Control-Allow-Headers",
		"Content-Type, Authorization, X-API-Key, X-Broker-Api-Key",
	);
}

function extractApiKey(request: IncomingMessage): string | null {
	const brokerKey = request.headers["x-broker-api-key"];
	if (typeof brokerKey === "string" && brokerKey.trim()) {
		return brokerKey.trim();
	}

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

function isPolicyAllowed(decision: string): boolean {
	return decision === "allow" || decision === "allow_with_audit";
}

function evaluateBrokerActionPolicy(
	action: string,
	params: Record<string, unknown>,
	policyEngine: PolicyEngine,
):
	| { allowed: true }
	| { allowed: false; statusCode: number; body: JsonRecord } {
	const profileName = policyEngine.getActiveProfile();
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
	const evaluation = policyEngine.evaluate(step, context);

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

function getTerminalPolicyAction(subcommand: string): string {
	switch (subcommand) {
		case "sessions":
			return "terminal_list";
		case "read":
			return "terminal_read";
		case "snapshot":
			return "terminal_snapshot";
		case "status":
			return "terminal_status";
		case "open":
			return "terminal_open";
		case "exec":
			return "terminal_exec";
		case "type":
			return "terminal_write";
		case "interrupt":
			return "terminal_interrupt";
		case "close":
			return "terminal_close";
		case "resume":
			return "terminal_resume";
		case "resize":
			return "terminal_resize";
		default:
			return `terminal_${subcommand}`;
	}
}

function getFilesystemPolicyAction(subcommand: string): string {
	switch (subcommand) {
		case "read":
			return "fs_read";
		case "write":
			return "fs_write";
		case "list":
			return "fs_list";
		case "move":
			return "fs_move";
		case "delete":
			return "fs_delete";
		case "stat":
			return "fs_stat";
		default:
			return `fs_${subcommand}`;
	}
}

async function readJsonBody(
	request: IncomingMessage,
	maxBytes: number,
): Promise<JsonRecord> {
	const chunks: Buffer[] = [];
	let totalBytes = 0;

	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		totalBytes += buffer.byteLength;
		if (totalBytes > maxBytes) {
			throw new Error(
				`Request body too large. Maximum size is ${maxBytes} bytes.`,
			);
		}
		chunks.push(buffer);
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
		...(body.params &&
		typeof body.params === "object" &&
		!Array.isArray(body.params)
			? { params: body.params as Record<string, unknown> }
			: {}),
		...(typeof body.priority === "string" ? { priority: body.priority } : {}),
		...(typeof body.timeoutMs === "number"
			? { timeoutMs: body.timeoutMs }
			: {}),
	};
}

function toScheduleTaskRequest(body: JsonRecord): BrokerScheduleTaskRequest {
	if (
		typeof body.id !== "string" ||
		typeof body.name !== "string" ||
		typeof body.cronExpression !== "string"
	) {
		throw new Error("Schedule requests require id, name, and cronExpression.");
	}

	return {
		id: body.id,
		name: body.name,
		cronExpression: body.cronExpression,
		...(typeof body.kind === "string" ? { kind: body.kind } : {}),
		...(body.params &&
		typeof body.params === "object" &&
		!Array.isArray(body.params)
			? { params: body.params as Record<string, unknown> }
			: {}),
		...(typeof body.priority === "string" ? { priority: body.priority } : {}),
		...(typeof body.timeoutMs === "number"
			? { timeoutMs: body.timeoutMs }
			: {}),
	};
}

function toHostname(value: string): string | null {
	const trimmed = value.trim();
	if (!trimmed) {
		return null;
	}

	if (/^(?:https?|wss?):\/\//i.test(trimmed)) {
		try {
			return new URL(trimmed).hostname.toLowerCase();
		} catch {
			return null;
		}
	}

	const normalized = trimmed.toLowerCase();
	return HOSTNAME_PATTERN.test(normalized) ? normalized : null;
}

function shouldValidateDomainCandidate(
	key: string,
	value: unknown,
	allowedFields: Set<string>,
): value is string {
	if (typeof value !== "string") {
		return false;
	}
	return allowedFields.has(key) || /(?:https?|wss?):\/\//i.test(value);
}

function isAllowedHostname(
	hostname: string,
	allowedDomains: string[],
): boolean {
	return allowedDomains.some(
		(domain) => hostname === domain || hostname.endsWith(`.${domain}`),
	);
}

function collectDomainCandidates(
	value: unknown,
	allowedFields: Set<string>,
	output: string[],
	depth = 0,
): boolean {
	if (depth > MAX_DOMAIN_PARAM_DEPTH) {
		return false;
	}

	if (!value || typeof value !== "object") {
		return true;
	}

	if (Array.isArray(value)) {
		for (const entry of value) {
			if (!collectDomainCandidates(entry, allowedFields, output, depth + 1)) {
				return false;
			}
		}
		return true;
	}

	for (const [key, entry] of Object.entries(value as JsonRecord)) {
		if (shouldValidateDomainCandidate(key, entry, allowedFields)) {
			output.push(entry);
		}

		if (entry && typeof entry === "object") {
			if (!collectDomainCandidates(entry, allowedFields, output, depth + 1)) {
				return false;
			}
		}
	}

	return true;
}

function validateAllowedDomains(
	params: Record<string, unknown> | undefined,
	config: BrokerResolvedConfig,
): string | null {
	if (!params || config.allowedDomains.length === 0) {
		return null;
	}

	const candidates: string[] = [];
	const withinDepthLimit = collectDomainCandidates(
		params,
		new Set(config.allowedDomainParamFields),
		candidates,
	);
	if (!withinDepthLimit) {
		return "Task params are too deeply nested to validate allowed domains.";
	}

	for (const candidate of candidates) {
		const hostname = toHostname(candidate);
		if (!hostname || !isAllowedHostname(hostname, config.allowedDomains)) {
			return `Task params contain a disallowed domain target: ${candidate}.`;
		}
	}

	return null;
}

function serializeTaskStatus(
	entry: BrokerTaskStatusEntry,
): Record<string, unknown> {
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
	return entries.map(serializeSchedulerQueueEntry);
}

function serializeSchedulerQueueEntry(
	entry: BrokerSchedulerQueueEntry,
): Record<string, unknown> {
	return {
		id: entry.id,
		name: entry.name,
		nextRun: entry.nextRun ? entry.nextRun.toISOString() : null,
		enabled: entry.enabled,
	};
}

function writeUpgradeError(
	socket: Duplex,
	statusCode: number,
	message: string,
): void {
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

export function createBrokerServer(
	options: BrokerServerOptions = {},
): BrokerServer {
	const config = resolveBrokerConfig(options);
	const callbacks =
		options.callbacks ?? createCallbacksFromDaemon(options.daemon);
	const now = options.now ?? Date.now;
	const memoryStore = options.memoryStore;
	const brokerPolicyEngine =
		options.policyEngine ??
		new DefaultPolicyEngine({
			profileName: loadConfig({
				env: options.env ?? process.env,
				validate: false,
			}).policyProfile,
		});
	const rateLimitBuckets = new Map<string, RateLimitBucket>();
	const taskStatuses = new Map<string, BrokerTaskStatusRecord>();
	const server = http.createServer();
	const webSocketServer = new WebSocketServer({ noServer: true });
	const sockets = new Set<Socket>();
	const clientSubscriptions = new WeakMap<WebSocket, Set<string>>();
	const rateLimitPruneIntervalMs = Math.min(
		config.rateLimitBucketTtlMs,
		60_000,
	);
	let lastRateLimitPruneAt = 0;
	let webSocketClosed = false;

	server.on("connection", (socket) => {
		sockets.add(socket);
		socket.once("close", () => sockets.delete(socket));
	});

	const taskStatusKey = (taskId: string): string =>
		`${BROKER_TASK_STATUS_STORE_PREFIX}${taskId}`;

	const rateLimitKey = (clientIp: string): string =>
		`${BROKER_RATE_LIMIT_STORE_PREFIX}${encodeURIComponent(clientIp)}`;

	const restorePersistedState = (): void => {
		if (!memoryStore) return;
		for (const key of memoryStore.keys(BROKER_TASK_STATUS_STORE_PREFIX)) {
			const entry = memoryStore.get<BrokerTaskStatusRecord>(key);
			if (isBrokerTaskStatusRecord(entry)) {
				taskStatuses.set(entry.id, entry);
			} else {
				memoryStore.delete(key);
			}
		}
		for (const key of memoryStore.keys(BROKER_RATE_LIMIT_STORE_PREFIX)) {
			const bucket = memoryStore.get<RateLimitBucket>(key);
			if (isRateLimitBucket(bucket)) {
				const encodedIp = key.slice(BROKER_RATE_LIMIT_STORE_PREFIX.length);
				rateLimitBuckets.set(decodeURIComponent(encodedIp), bucket);
			} else {
				memoryStore.delete(key);
			}
		}
	};

	const persistTaskStatus = (entry: BrokerTaskStatusRecord): void => {
		memoryStore?.set(taskStatusKey(entry.id), entry, config.taskStatusRetentionMs);
	};

	const deletePersistedTaskStatus = (taskId: string): void => {
		memoryStore?.delete(taskStatusKey(taskId));
	};

	const persistRateLimitBucket = (
		clientIp: string,
		bucket: RateLimitBucket,
	): void => {
		memoryStore?.set(
			rateLimitKey(clientIp),
			bucket,
			config.rateLimitBucketTtlMs,
		);
	};

	const deletePersistedRateLimitBucket = (clientIp: string): void => {
		memoryStore?.delete(rateLimitKey(clientIp));
	};

	restorePersistedState();

	const pruneRateLimitBuckets = (currentTime: number): void => {
		if (currentTime - lastRateLimitPruneAt < rateLimitPruneIntervalMs) {
			return;
		}
		lastRateLimitPruneAt = currentTime;
		const windowStart = currentTime - config.rateLimitWindowMs;
		const staleBefore = currentTime - config.rateLimitBucketTtlMs;
		for (const [clientIp, bucket] of rateLimitBuckets) {
			bucket.requests = bucket.requests.filter(
				(timestamp) => timestamp > windowStart,
			);
			if (bucket.requests.length === 0 && bucket.lastAccessedAt <= staleBefore) {
				rateLimitBuckets.delete(clientIp);
				deletePersistedRateLimitBucket(clientIp);
			} else {
				persistRateLimitBucket(clientIp, bucket);
			}
		}
	};

	const pruneTaskStatuses = (): void => {
		const staleBefore = now() - config.taskStatusRetentionMs;
		for (const [taskId, entry] of taskStatuses) {
			if (
				(entry.status === "completed" || entry.status === "failed") &&
				entry.updatedAt <= staleBefore
			) {
				taskStatuses.delete(taskId);
				deletePersistedTaskStatus(taskId);
			}
		}
	};

	const stripTaskStatusRecord = (
		entry: BrokerTaskStatusRecord,
	): BrokerTaskStatusEntry => {
		const { updatedAt: _updatedAt, ...publicEntry } = entry;
		return publicEntry;
	};

	const consumeRateLimit = (request: IncomingMessage): boolean => {
		const clientIp = normalizeClientIp(request.socket.remoteAddress);
		const currentTime = now();
		pruneRateLimitBuckets(currentTime);
		const bucket = rateLimitBuckets.get(clientIp) ?? {
			requests: [],
			lastAccessedAt: currentTime,
		};
		bucket.lastAccessedAt = currentTime;
		const windowStart = currentTime - config.rateLimitWindowMs;
		bucket.requests = bucket.requests.filter(
			(timestamp) => timestamp > windowStart,
		);

		if (bucket.requests.length >= config.rateLimitMaxRequests) {
			rateLimitBuckets.set(clientIp, bucket);
			persistRateLimitBucket(clientIp, bucket);
			return false;
		}

		bucket.requests.push(currentTime);
		rateLimitBuckets.set(clientIp, bucket);
		persistRateLimitBucket(clientIp, bucket);
		return true;
	};

	const setTaskStatus = (
		taskId: string,
		patch: BrokerStatusPatch,
	): BrokerTaskStatusEntry => {
		pruneTaskStatuses();
		const nextEntry: BrokerTaskStatusRecord = {
			id: taskId,
			status: patch.status,
			updatedAt: now(),
			...(patch.result !== undefined ? { result: patch.result } : {}),
			...(patch.error ? { error: patch.error } : {}),
		};

		taskStatuses.delete(taskId);
		taskStatuses.set(taskId, nextEntry);
		persistTaskStatus(nextEntry);

		if (patch.status === "completed" || patch.status === "failed") {
			broadcast({
				type: "task_completed",
				taskId,
				status: patch.status,
				...(patch.result !== undefined ? { result: patch.result } : {}),
				...(patch.error ? { error: patch.error } : {}),
			});
		}

		return stripTaskStatusRecord(nextEntry);
	};

	const broadcast = (message: unknown): void => {
		const payload = JSON.stringify(message);
		const channels = messageChannels(message);
		for (const client of webSocketServer.clients) {
			if (
				client.readyState === WebSocket.OPEN &&
				matchesSubscription(client, channels)
			) {
				client.send(payload);
			}
		}
	};

	const matchesSubscription = (
		client: WebSocket,
		channels: string[],
	): boolean => {
		const subscriptions = clientSubscriptions.get(client);
		return !subscriptions || channels.some((channel) => subscriptions.has(channel));
	};

	const messageChannels = (message: unknown): string[] => {
		if (!message || typeof message !== "object") {
			return [];
		}
		const record = message as Record<string, unknown>;
		const channels: string[] = [];
		if (typeof record.type === "string") channels.push(record.type);
		if (typeof record.taskId === "string") {
			channels.push(`task:${record.taskId}`);
		}
		if (typeof record.sessionId === "string") {
			channels.push(`session:${record.sessionId}`);
			if (record.type === "terminal.output") {
				channels.push(`terminal:${record.sessionId}`);
			}
		}
		return channels;
	};

	const handleClientMessage = (
		client: WebSocket,
		data: RawData,
	): void => {
		const parsed = parseSubscriptionMessage(data);
		if (!parsed.ok) {
			client.send(
				JSON.stringify({ type: "subscription.error", error: parsed.error }),
			);
			return;
		}

		const current = new Set(clientSubscriptions.get(client) ?? []);
		if (parsed.type === "subscribe") {
			for (const channel of parsed.channels) current.add(channel);
		} else if (parsed.channels.length === 0) {
			current.clear();
		} else {
			for (const channel of parsed.channels) current.delete(channel);
		}

		if (current.size > 0) {
			clientSubscriptions.set(client, current);
		} else {
			clientSubscriptions.delete(client);
		}
		client.send(
			JSON.stringify({
				type: "subscription.updated",
				channels: Array.from(current).sort(),
			}),
		);
	};

	const parseSubscriptionMessage = (
		data: RawData,
	):
		| { ok: true; type: "subscribe" | "unsubscribe"; channels: string[] }
		| { ok: false; error: string } => {
		let payload: unknown;
		try {
			payload = JSON.parse(data.toString());
		} catch {
			return { ok: false, error: "Message must be valid JSON." };
		}
		if (!payload || typeof payload !== "object") {
			return { ok: false, error: "Message must be a JSON object." };
		}
		const record = payload as Record<string, unknown>;
		if (record.type !== "subscribe" && record.type !== "unsubscribe") {
			return { ok: false, error: "Message type must be subscribe or unsubscribe." };
		}
		if (!Array.isArray(record.channels)) {
			return { ok: false, error: "channels must be an array." };
		}
		if (record.channels.length > MAX_SUBSCRIPTION_CHANNELS) {
			return { ok: false, error: "Too many subscription channels." };
		}
		const channels: string[] = [];
		for (const channel of record.channels) {
			if (
				typeof channel !== "string" ||
				channel.length === 0 ||
				channel.length > MAX_SUBSCRIPTION_CHANNEL_LENGTH ||
				!/^[a-zA-Z0-9._:-]+$/u.test(channel)
			) {
				return { ok: false, error: "Invalid subscription channel." };
			}
			channels.push(channel);
		}
		return { ok: true, type: record.type, channels };
	};

	const getTaskStatus = (taskId: string): BrokerTaskStatusEntry | null => {
		pruneTaskStatuses();
		const entry = taskStatuses.get(taskId);
		return entry ? stripTaskStatusRecord(entry) : null;
	};

	const listTaskStatuses = (): BrokerTaskStatusEntry[] => {
		pruneTaskStatuses();
		return Array.from(taskStatuses.values()).reverse().map(stripTaskStatusRecord);
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

		try {
			const requestUrl = new URL(
				request.url ?? "/",
				`http://${request.headers.host ?? DEFAULT_HOST}`,
			);
			const { pathname } = requestUrl;

			// Require auth for all endpoints except health
			if (!isHealthPath(pathname)) {
				const apiKey = extractApiKey(request);
				if (!constantTimeTokenEqual(apiKey, config.authKey)) {
					writeJson(response, 401, { error: "Unauthorized." });
					return;
				}
			}

			if (request.method === "POST" && pathname === "/api/v1/tasks/run") {
				if (!callbacks.submitTask) {
					writeJson(response, 503, {
						error: "Task submission callback is not configured.",
					});
					return;
				}

				const body = await readJsonBody(request, config.maxBodyBytes);

				// All task submissions — including skill tasks — go through the
				// submitTask callback so the daemon-managed path handles intent
				// persistence, tracking, graceful shutdown, and recovery.
				const payload = toRunTaskRequest(body);
				const invalidDomain = validateAllowedDomains(payload.params, config);
				if (invalidDomain) {
					writeJson(response, 403, {
						error: invalidDomain,
					});
					return;
				}

				const submission = await callbacks.submitTask(payload);
				const taskId =
					typeof submission === "string" ? submission : submission.taskId;
				const submissionStatus =
					typeof submission === "string"
						? "pending"
						: (submission.status ?? "pending");
				const accepted =
					typeof submission === "string" ? true : (submission.accepted ?? true);
				const submissionError =
					typeof submission === "string" ? undefined : submission.error;
				if (!accepted) {
					setTaskStatus(taskId, {
						status: "failed",
						...(submissionError ? { error: submissionError } : {}),
					});
					writeJson(response, typeof submission === "string" ? 400 : (submission.statusCode ?? 403), {
						taskId,
						status: "failed",
						...(submissionError ? { error: redactString(submissionError) } : {}),
					});
					return;
				}
				setTaskStatus(taskId, {
					status: submissionStatus,
				});
				writeJson(response, 202, {
					taskId,
					status: submissionStatus,
				});
				return;
			}

			if (request.method === "POST" && pathname === "/api/v1/tasks/schedule") {
				if (!callbacks.scheduleTask) {
					writeJson(response, 503, {
						error: "Schedule callback is not configured.",
					});
					return;
				}

				const payload = toScheduleTaskRequest(
					await readJsonBody(request, config.maxBodyBytes),
				);
				const scheduled = await callbacks.scheduleTask(payload);
				writeJson(response, 200, {
					id: scheduled.id,
					...(scheduled.nextRun !== undefined
						? {
								nextRun:
									scheduled.nextRun instanceof Date
										? scheduled.nextRun.toISOString()
										: scheduled.nextRun,
							}
						: {}),
				});
				return;
			}

			if (request.method === "GET" && pathname === "/api/v1/tasks") {
				const taskList = callbacks.listTasks
					? await callbacks.listTasks()
					: listTaskStatuses();
				writeJson(response, 200, taskList.map(serializeTaskStatus));
				return;
			}

			if (
				request.method === "GET" &&
				/^\/api\/v1\/tasks\/[^/]+\/status$/u.test(pathname)
			) {
				const taskId = decodeURIComponent(pathname.split("/")[4] ?? "");
				const taskStatus = callbacks.getTaskStatus
					? await callbacks.getTaskStatus(taskId)
					: getTaskStatus(taskId);
				if (!taskStatus) {
					writeJson(response, 410, {
						code: "task_status_unavailable",
						error: `Task "${taskId}" status is unavailable.`,
						hint:
							"The broker may have restarted or the task status may have expired.",
					});
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
				writeJson(
					response,
					200,
					callbacks.getHealth
						? await callbacks.getHealth()
						: createDefaultHealthReport(),
				);
				return;
			}

			if (request.method === "GET" && pathname === "/api/v1/stats") {
				writeJson(
					response,
					200,
					callbacks.getStats
						? await callbacks.getStats()
						: createDefaultTelemetrySummary(),
				);
				return;
			}

			if (request.method === "GET" && pathname === "/api/v1/scheduler") {
				const queue = callbacks.getSchedulerQueue
					? await callbacks.getSchedulerQueue()
					: [];
				writeJson(response, 200, serializeSchedulerQueue(queue));
				return;
			}

			const schedulerActionMatch =
				/^\/api\/v1\/scheduler\/([^/]+)\/(pause|resume)$/u.exec(pathname);
			if (request.method === "POST" && schedulerActionMatch) {
				const id = decodeURIComponent(schedulerActionMatch[1] ?? "");
				const action = schedulerActionMatch[2];
				const update =
					action === "pause"
						? callbacks.pauseScheduledTask
						: callbacks.resumeScheduledTask;
				if (!update) {
					writeJson(response, 503, {
						error: "Scheduler mutation callback is not configured.",
					});
					return;
				}

				const entry = await update(id);
				if (!entry) {
					writeJson(response, 404, {
						error: `Scheduled task "${id}" was not found.`,
					});
					return;
				}

				writeJson(response, 200, serializeSchedulerQueueEntry(entry));
				return;
			}

			const schedulerRemoveMatch = /^\/api\/v1\/scheduler\/([^/]+)$/u.exec(
				pathname,
			);
			if (request.method === "DELETE" && schedulerRemoveMatch) {
				const id = decodeURIComponent(schedulerRemoveMatch[1] ?? "");
				if (!callbacks.removeScheduledTask) {
					writeJson(response, 503, {
						error: "Scheduler mutation callback is not configured.",
					});
					return;
				}

				const removed = await callbacks.removeScheduledTask(id);
				if (!removed) {
					writeJson(response, 404, {
						error: `Scheduled task "${id}" was not found.`,
					});
					return;
				}

				writeJson(response, 200, { id, removed: true });
				return;
			}

			if (request.method === "GET" && pathname === "/api/v1/skills") {
				const skills = callbacks.listSkills ? await callbacks.listSkills() : [];
				writeJson(response, 200, skills);
				return;
			}

			if (request.method === "GET" && pathname === "/api/v1/status") {
				writeJson(
					response,
					200,
					callbacks.getStatus
						? await callbacks.getStatus()
						: await collectStatus(),
				);
				return;
			}

			if (request.method === "GET" && pathname === "/api/v1/config") {
				writeJson(
					response,
					200,
					callbacks.listConfig
						? await callbacks.listConfig()
						: getConfigEntries({ validate: false }),
				);
				return;
			}

			if (
				(request.method === "GET" || request.method === "POST") &&
				pathname.startsWith("/api/v1/config/")
			) {
				const key = decodeURIComponent(
					pathname.slice("/api/v1/config/".length),
				);
				if (!key) {
					writeJson(response, 400, { error: "Config key is required." });
					return;
				}

				if (request.method === "GET") {
					writeJson(
						response,
						200,
						callbacks.getConfig
							? await callbacks.getConfig(key)
							: getConfigValue(key, { validate: false }),
					);
					return;
				}

				const body = await readJsonBody(request, config.maxBodyBytes);
				if (!Object.hasOwn(body, "value")) {
					writeJson(response, 400, {
						error: "Config set requires a JSON body with value.",
					});
					return;
				}
				const policyEval = evaluateBrokerActionPolicy(
					"config_set",
					{ key, value: body.value },
					brokerPolicyEngine,
				);
				if (!policyEval.allowed) {
					writeJson(response, policyEval.statusCode, policyEval.body);
					return;
				}
				writeJson(
					response,
					200,
					callbacks.setConfig
						? await callbacks.setConfig(key, body.value)
						: setUserConfigValue(key, body.value),
				);
				return;
			}

			if (
				(request.method === "GET" || request.method === "POST") &&
				pathname.startsWith("/api/v1/term/")
			) {
				if (!callbacks.handleTerminal) {
					writeJson(response, 503, {
						error: "Terminal callback is not configured.",
					});
					return;
				}

				const subcommand = pathname.slice("/api/v1/term/".length);
				const payload =
					request.method === "POST"
						? await readJsonBody(request, config.maxBodyBytes)
						: Object.fromEntries(requestUrl.searchParams.entries());
				const policyEval = evaluateBrokerActionPolicy(
					getTerminalPolicyAction(subcommand),
					payload,
					brokerPolicyEngine,
				);
				if (!policyEval.allowed) {
					writeJson(response, policyEval.statusCode, policyEval.body);
					return;
				}
				const result = await callbacks.handleTerminal(subcommand, payload);
				writeJson(response, 200, result);
				return;
			}

			if (
				(request.method === "GET" || request.method === "POST") &&
				pathname.startsWith("/api/v1/fs/")
			) {
				if (!callbacks.handleFilesystem) {
					writeJson(response, 503, {
						error: "Filesystem callback is not configured.",
					});
					return;
				}

				const subcommand = pathname.slice("/api/v1/fs/".length);
				const payload =
					request.method === "POST"
						? await readJsonBody(request, config.maxBodyBytes)
						: Object.fromEntries(requestUrl.searchParams.entries());
				const policyEval = evaluateBrokerActionPolicy(
					getFilesystemPolicyAction(subcommand),
					payload,
					brokerPolicyEngine,
				);
				if (!policyEval.allowed) {
					writeJson(response, policyEval.statusCode, policyEval.body);
					return;
				}
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

		const requestUrl = new URL(
			request.url ?? "/",
			`http://${request.headers.host ?? DEFAULT_HOST}`,
		);
		if (requestUrl.pathname !== "/ws") {
			writeUpgradeError(socket, 404, "Not found.");
			return;
		}

		if (config.authKey) {
			const apiKey = extractApiKey(request);
			if (!constantTimeTokenEqual(apiKey, config.authKey)) {
				writeUpgradeError(socket, 401, "Unauthorized.");
				return;
			}
		}

		webSocketServer.handleUpgrade(request, socket, head, (client) => {
			client.on("message", (data) => handleClientMessage(client, data));
			client.once("close", () => clientSubscriptions.delete(client));
			webSocketServer.emit("connection", client, request);
		});
	});

	return {
		async listen(
			port = config.port,
			host = DEFAULT_HOST,
		): Promise<AddressInfo> {
			await new Promise<void>((resolve, reject) => {
				server.once("error", reject);
				server.listen(port, host, () => {
					server.off("error", reject);
					resolve();
				});
			});

			const address = server.address();
			if (!address || typeof address === "string") {
				throw new Error(
					"[BROKER_SERVER] Server did not provide a TCP address.",
				);
			}

			return address;
		},
		async close(): Promise<void> {
			if (!webSocketClosed) {
				await new Promise<void>((resolve) => {
					let settled = false;
					const finish = () => {
						if (settled) return;
						settled = true;
						webSocketClosed = true;
						clearTimeout(timer);
						resolve();
					};
					const timer = setTimeout(() => {
						brokerLog.warn("Timed out closing broker WebSocket clients", {
							timeoutMs: config.closeTimeoutMs,
							openClients: webSocketServer.clients.size,
						});
						for (const client of webSocketServer.clients) client.terminate();
						finish();
					}, config.closeTimeoutMs);
					timer.unref?.();
					for (const client of webSocketServer.clients) client.close();
					webSocketServer.close(() => finish());
				});
			}

			if (!server.listening) {
				return;
			}

			await new Promise<void>((resolve, reject) => {
				let settled = false;
				const finish = (error?: Error) => {
					if (settled) return;
					settled = true;
					clearTimeout(timer);
					if (error) {
						reject(error);
						return;
					}
					resolve();
				};
				const timer = setTimeout(() => {
					brokerLog.warn("Timed out closing broker HTTP server", {
						timeoutMs: config.closeTimeoutMs,
						openConnections: sockets.size,
					});
					for (const socket of sockets) socket.destroy();
					server.closeAllConnections?.();
					finish();
				}, config.closeTimeoutMs);
				timer.unref?.();
				server.close((error) => {
					if (error) {
						finish(error);
						return;
					}
					finish();
				});
			});
		},
		address(): AddressInfo | string | null {
			return server.address();
		},
		setTaskStatus,
		getTaskStatus,
		listTaskStatuses,
		broadcast,
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
