import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import type { Duplex } from "node:stream";
import {
	type BrowserControlAPI,
	createBrowserControl,
} from "../browser_control";
import {
	type RecordedActionKind,
	recordIfActive,
} from "../observability/recorder";
import { redactObject, redactString } from "../observability/redaction";
import { getAllProfiles } from "../policy/profiles";
import { formatActionResult } from "../shared/action_result";
import { constantTimeTokenEqual } from "../shared/auth";
import {
	getDashboardConfigMutationError,
	redactConfigEntry,
} from "../shared/config";
import { installGlobalFatalHandlers } from "../shared/fatal_handlers";
import { logger } from "../shared/logger";
import { ensureDataHome, ensureSecretsDir, getDataHome } from "../shared/paths";
import {
	getStateStorage,
	type StateStorage,
	type StoredAutomation,
} from "../state/index";
import { validateResize } from "../terminal/actions";
import { buildTerminalView } from "../terminal/render";
import type { TerminalSnapshot } from "../terminal/types";
import { fetchBrokerJson, listLogFiles, readRecentLogs } from "./bridge";
import { WebEventHub } from "./events";
import {
	assertSafeBind,
	closeRequestStreamAfterResponse,
	createLocalToken,
	extractAuthToken,
	isAuthorizedRequest,
	RequestBodyTooLargeError,
	readJsonBody,
	setCorsHeaders,
	setSecurityHeaders,
	UnsupportedMediaTypeError,
} from "./security";
import type {
	PersistedWebAppServerInfo,
	WebApiError,
	WebAppServerInfo,
	WebCapabilities,
} from "./types";

const webLogger = logger.withComponent("web");

function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

function apiError(
	code: WebApiError["code"],
	error: string,
	options: {
		actionResult?: WebApiError["actionResult"];
		details?: unknown;
	} = {},
): WebApiError {
	return {
		success: false,
		code,
		error,
		...(options.actionResult ? { actionResult: options.actionResult } : {}),
		...(options.details !== undefined
			? { details: redactObject(options.details) }
			: {}),
	};
}

function recordReplayAction(
	kind: RecordedActionKind,
	params: Record<string, unknown>,
	result: Parameters<typeof recordIfActive>[2],
): void {
	recordIfActive(kind, params, result);
}

export interface WebAppServerOptions {
	host?: string;
	port?: number;
	token?: string;
	allowRemote?: boolean;
	api?: BrowserControlAPI;
	allowedOrigins?: string[];
}

export interface WebAppServer {
	listen(port?: number, host?: string): Promise<WebAppServerInfo>;
	close(): Promise<void>;
	address(): AddressInfo | string | null;
	info(): WebAppServerInfo | null;
	events: WebEventHub;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 7790;
const WEB_SERVER_RECORD_FILE = "web-server.json";
const WEB_DASHBOARD_TOKEN_FILE = "web-dashboard-token";
const WEB_RATE_LIMIT_WINDOW_MS = 60_000;
const WEB_UNAUTHENTICATED_RATE_LIMIT = 60;
const WEB_AUTHENTICATED_RATE_LIMIT = 300;
const WEB_RATE_LIMIT_MAX_BUCKETS = 10_000;
const TASK_RUNTIME_OFFLINE_ERROR =
	"Task runtime is offline. Start Browser Control daemon to queue and monitor tasks.";
const TASK_RUNTIME_SUBMIT_OFFLINE_ERROR =
	"Task runtime is offline. Start Browser Control daemon before submitting tasks.";
const TASK_RUNTIME_RECOVERY =
	"Run `bc daemon` or start the desktop app. Task history will load automatically when the runtime reconnects.";
const BROKER_UNAVAILABLE_DETAILS = { cause: "broker_unreachable" };

interface WebRateLimitEntry {
	key: string;
	limit: number;
}

interface WebRateLimitDecision {
	allowed: boolean;
	retryAfterSeconds: number;
}

interface SavedAutomation {
	id: string;
	name: string;
	description: string;
	category: string;
	prompt: string;
	source: "built-in" | "user" | "task";
	status: "ready" | "last-run";
	approvalRequired: boolean;
	createdAt: string;
	updatedAt: string;
	lastRunAt?: string;
	runCount: number;
}

function automationStorePath(): string {
	return path.join(getDataHome(), "automations", "saved-automations.json");
}

function webServerRecordPath(): string {
	return path.join(getDataHome(), "runtime", WEB_SERVER_RECORD_FILE);
}

function webDashboardTokenPath(): string {
	return path.join(
		ensureSecretsDir(ensureDataHome()),
		WEB_DASHBOARD_TOKEN_FILE,
	);
}

function readPersistedWebDashboardToken(): string | null {
	const tokenPath = webDashboardTokenPath();
	if (!fs.existsSync(tokenPath)) return null;
	if (
		process.platform !== "win32" &&
		fs.lstatSync(tokenPath).isSymbolicLink()
	) {
		throw new Error(
			"Refusing to read symlinked Browser Control web dashboard token.",
		);
	}
	const token = fs.readFileSync(tokenPath, "utf8").trim();
	return token.length > 0 ? token : null;
}

function writePersistedWebDashboardToken(token: string): string {
	const tokenPath = webDashboardTokenPath();
	const tokenDir = path.dirname(tokenPath);
	fs.mkdirSync(tokenDir, { recursive: true, mode: 0o700 });
	if (process.platform !== "win32") {
		if (fs.lstatSync(tokenDir).isSymbolicLink()) {
			throw new Error(
				"Refusing to write Browser Control web dashboard token under a symlinked secrets directory.",
			);
		}
		fs.chmodSync(tokenDir, 0o700);
		if (fs.existsSync(tokenPath) && fs.lstatSync(tokenPath).isSymbolicLink()) {
			throw new Error(
				"Refusing to overwrite symlinked Browser Control web dashboard token.",
			);
		}
	}
	fs.writeFileSync(tokenPath, `${token}\n`, { encoding: "utf8", mode: 0o600 });
	if (process.platform !== "win32") fs.chmodSync(tokenPath, 0o600);
	return token;
}

function resolveWebDashboardToken(explicitToken?: string): string {
	if (explicitToken !== undefined) return explicitToken;
	return (
		readPersistedWebDashboardToken() ??
		writePersistedWebDashboardToken(createLocalToken())
	);
}

function normalizeRemoteAddress(request: IncomingMessage): string {
	return request.socket.remoteAddress ?? "unknown";
}

function rateLimitTokenHash(tokenValue: string): string {
	return crypto.createHash("sha256").update(tokenValue).digest("base64url");
}

function getWebSocketProtocolTokens(request: IncomingMessage): string[] {
	const protocol = request.headers["sec-websocket-protocol"];
	if (typeof protocol !== "string") return [];
	return protocol
		.split(",")
		.map((value) => value.trim())
		.filter((value) => value.length > 0);
}

function isAuthorizedWebSocketRequest(
	request: IncomingMessage,
	token: string,
): boolean {
	return getWebSocketProtocolTokens(request).some((protocolToken) =>
		constantTimeTokenEqual(protocolToken, token),
	);
}

class WebRateLimiter {
	private readonly buckets = new Map<string, number[]>();

	consume(
		entries: WebRateLimitEntry[],
		now = Date.now(),
	): WebRateLimitDecision {
		const cutoff = now - WEB_RATE_LIMIT_WINDOW_MS;
		let retryAfterSeconds = 0;

		for (const entry of entries) {
			const timestamps = this.pruneExistingBucket(entry.key, cutoff);
			if (timestamps.length >= entry.limit) {
				const oldest = timestamps[0] ?? now;
				retryAfterSeconds = Math.max(
					retryAfterSeconds,
					Math.max(
						1,
						Math.ceil((oldest + WEB_RATE_LIMIT_WINDOW_MS - now) / 1000),
					),
				);
			}
		}

		if (retryAfterSeconds > 0) {
			this.compact(cutoff);
			return { allowed: false, retryAfterSeconds };
		}

		for (const entry of entries) {
			const timestamps = this.bucketForWrite(entry.key, cutoff);
			timestamps.push(now);
		}

		this.compact(cutoff);
		return { allowed: true, retryAfterSeconds: 0 };
	}

	private pruneExistingBucket(key: string, cutoff: number): number[] {
		const existing = this.buckets.get(key);
		if (!existing) return [];
		while (existing.length > 0 && (existing[0] ?? 0) <= cutoff) {
			existing.shift();
		}
		if (existing.length === 0) this.buckets.delete(key);
		return existing;
	}

	private bucketForWrite(key: string, cutoff: number): number[] {
		const existing = this.pruneExistingBucket(key, cutoff);
		if (existing.length > 0) return existing;
		const created: number[] = [];
		this.buckets.set(key, created);
		return created;
	}

	private compact(cutoff: number): void {
		if (this.buckets.size <= WEB_RATE_LIMIT_MAX_BUCKETS) return;
		for (const [key, timestamps] of this.buckets) {
			while (timestamps.length > 0 && (timestamps[0] ?? 0) <= cutoff) {
				timestamps.shift();
			}
			if (timestamps.length === 0) this.buckets.delete(key);
			if (this.buckets.size <= WEB_RATE_LIMIT_MAX_BUCKETS) break;
		}
	}
}

function createRateLimitEntries(
	request: IncomingMessage,
	token: string,
	requestUrl: URL,
	authorized: boolean,
): WebRateLimitEntry[] {
	const remoteAddress = normalizeRemoteAddress(request);
	const protocolTokens =
		requestUrl.pathname === "/events"
			? getWebSocketProtocolTokens(request)
			: [];
	const presentedToken =
		extractAuthToken(request, requestUrl) ??
		protocolTokens.find((protocolToken) =>
			constantTimeTokenEqual(protocolToken, token),
		) ??
		protocolTokens[0] ??
		null;

	if (authorized) {
		const tokenHash = rateLimitTokenHash(presentedToken ?? token);
		return [
			{
				key: `web:auth:ip:${remoteAddress}`,
				limit: WEB_AUTHENTICATED_RATE_LIMIT,
			},
			{
				key: `web:auth:token:${tokenHash}`,
				limit: WEB_AUTHENTICATED_RATE_LIMIT,
			},
		];
	}

	const entries: WebRateLimitEntry[] = [
		{
			key: `web:unauth:ip:${remoteAddress}`,
			limit: WEB_UNAUTHENTICATED_RATE_LIMIT,
		},
	];
	if (presentedToken) {
		entries.push({
			key: `web:unauth:token:${rateLimitTokenHash(presentedToken)}`,
			limit: WEB_UNAUTHENTICATED_RATE_LIMIT,
		});
	}
	return entries;
}

function writeRateLimitResponse(
	response: ServerResponse,
	decision: WebRateLimitDecision,
): void {
	response.setHeader("Retry-After", String(decision.retryAfterSeconds));
	json(response, 429, {
		success: false,
		code: "rate_limited",
		error: "Rate limit exceeded.",
		retryAfterSeconds: decision.retryAfterSeconds,
	});
}

function writeRateLimitUpgradeError(
	socket: Duplex,
	decision: WebRateLimitDecision,
): void {
	socket.write(
		[
			"HTTP/1.1 429 Error",
			"Content-Type: application/json",
			`Retry-After: ${decision.retryAfterSeconds}`,
			"Connection: close",
			"",
			JSON.stringify({
				success: false,
				code: "rate_limited",
				error: "Rate limit exceeded.",
				retryAfterSeconds: decision.retryAfterSeconds,
			}),
		].join("\r\n"),
	);
	socket.destroy();
}

function isProcessAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function readPersistedWebAppServerInfo(): PersistedWebAppServerInfo | null {
	const recordPath = webServerRecordPath();
	if (!fs.existsSync(recordPath)) return null;
	try {
		const parsed = JSON.parse(
			fs.readFileSync(recordPath, "utf8"),
		) as PersistedWebAppServerInfo;
		if (
			typeof parsed?.url !== "string" ||
			typeof parsed?.host !== "string" ||
			typeof parsed?.port !== "number" ||
			typeof parsed?.token !== "string" ||
			typeof parsed?.pid !== "number" ||
			typeof parsed?.startedAt !== "string"
		) {
			return null;
		}
		return parsed;
	} catch {
		return null;
	}
}

function writePersistedWebAppServerInfo(
	info: PersistedWebAppServerInfo,
): PersistedWebAppServerInfo {
	const recordPath = webServerRecordPath();
	fs.mkdirSync(path.dirname(recordPath), { recursive: true });
	fs.writeFileSync(recordPath, `${JSON.stringify(info, null, 2)}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
	fs.chmodSync(recordPath, 0o600);
	return info;
}

function clearPersistedWebAppServerInfo(
	expected?: Partial<PersistedWebAppServerInfo>,
): void {
	const recordPath = webServerRecordPath();
	if (!fs.existsSync(recordPath)) return;
	if (expected) {
		const current = readPersistedWebAppServerInfo();
		if (!current) {
			fs.rmSync(recordPath, { force: true });
			return;
		}
		if (expected.pid !== undefined && expected.pid !== current.pid) return;
		if (expected.port !== undefined && expected.port !== current.port) return;
		if (expected.token !== undefined && expected.token !== current.token)
			return;
	}
	fs.rmSync(recordPath, { force: true });
}

async function fetchJsonWithTimeout(
	url: string,
	options: RequestInit = {},
	timeoutMs = 1_500,
): Promise<Response> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(url, {
			...options,
			signal: controller.signal,
		});
	} finally {
		clearTimeout(timeout);
	}
}

export async function validatePersistedWebAppServerInfo(
	info: PersistedWebAppServerInfo,
	options: { expectedHost?: string; expectedPort?: number } = {},
): Promise<boolean> {
	if (!isProcessAlive(info.pid)) return false;
	if (options.expectedHost && info.host !== options.expectedHost) return false;
	if (
		options.expectedPort !== undefined &&
		info.port !== options.expectedPort
	) {
		return false;
	}
	try {
		const health = await fetchJsonWithTimeout(
			`${info.url}/healthz`,
			{
				headers: {
					authorization: `Bearer ${info.token}`,
				},
			},
			5_000,
		);
		if (!health.ok) return false;
		const capabilitiesResponse = await fetchJsonWithTimeout(
			`${info.url}/api/capabilities`,
			{
				headers: {
					authorization: `Bearer ${info.token}`,
				},
			},
			5_000,
		);
		return capabilitiesResponse.ok;
	} catch {
		return false;
	}
}

export async function readActivePersistedWebAppServerInfo(
	options: { expectedHost?: string; expectedPort?: number } = {},
): Promise<PersistedWebAppServerInfo | null> {
	const info = readPersistedWebAppServerInfo();
	if (!info) return null;
	const valid = await validatePersistedWebAppServerInfo(info, options);
	if (valid) return info;
	clearPersistedWebAppServerInfo({
		pid: info.pid,
		port: info.port,
		token: info.token,
	});
	return null;
}

export async function describeListeningProcess(
	port: number,
): Promise<string | null> {
	if (!Number.isInteger(port) || port <= 0) return null;
	try {
		if (process.platform === "win32") {
			const script = [
				`$conn = Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -First 1`,
				"if (-not $conn) { exit 0 }",
				'$proc = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $conn.OwningProcess)',
				"if ($proc) {",
				'  "$($proc.Name) pid=$($proc.ProcessId) parent=$($proc.ParentProcessId) cmd=$($proc.CommandLine)"',
				"}",
			].join("; ");
			const result = spawn(
				"powershell",
				["-NoProfile", "-NonInteractive", "-Command", script],
				{
					windowsHide: true,
					stdio: ["ignore", "pipe", "ignore"],
				},
			);
			const chunks: Buffer[] = [];
			for await (const chunk of result.stdout) {
				chunks.push(Buffer.from(chunk));
			}
			const description = Buffer.concat(chunks).toString("utf8").trim();
			return description || null;
		}
		const result = spawn("lsof", ["-nPiTCP", `:${port}`, "-sTCP:LISTEN"], {
			stdio: ["ignore", "pipe", "ignore"],
		});
		const chunks: Buffer[] = [];
		for await (const chunk of result.stdout) {
			chunks.push(Buffer.from(chunk));
		}
		const lines = Buffer.concat(chunks)
			.toString("utf8")
			.trim()
			.split(/\r?\n/u)
			.filter(Boolean);
		return lines[1] ?? lines[0] ?? null;
	} catch {
		return null;
	}
}

function slugifyAutomationId(value: string): string {
	const slug = value
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, "-")
		.replace(/^-+|-+$/gu, "")
		.slice(0, 64);
	return slug || `automation-${Date.now()}`;
}

function builtInAutomations(): SavedAutomation[] {
	return [];
}

function readSavedAutomations(): SavedAutomation[] {
	const filePath = automationStorePath();
	if (!fs.existsSync(filePath)) {
		const defaults = builtInAutomations();
		writeSavedAutomations(defaults);
		return defaults;
	}
	try {
		const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
		if (!Array.isArray(parsed)) return builtInAutomations();
		return (parsed as SavedAutomation[]).filter(
			(item) => item.id !== "tradingview-ict-analysis",
		);
	} catch {
		return builtInAutomations();
	}
}

function writeSavedAutomations(automations: SavedAutomation[]): void {
	const filePath = automationStorePath();
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, JSON.stringify(automations, null, 2), "utf8");
}

function upsertSavedAutomation(
	input: Partial<SavedAutomation> & { name: string; prompt: string },
): SavedAutomation {
	const now = new Date().toISOString();
	const automations = readSavedAutomations();
	const id = input.id || slugifyAutomationId(input.name);
	const existingIndex = automations.findIndex((item) => item.id === id);
	const existing = existingIndex >= 0 ? automations[existingIndex] : undefined;
	const next: SavedAutomation = {
		id,
		name: input.name,
		description: input.description || existing?.description || "",
		category: input.category || existing?.category || "General",
		prompt: input.prompt,
		source: input.source || existing?.source || "user",
		status: input.status || existing?.status || "ready",
		approvalRequired:
			input.approvalRequired ?? existing?.approvalRequired ?? true,
		createdAt: existing?.createdAt || input.createdAt || now,
		updatedAt: now,
		lastRunAt: input.lastRunAt || existing?.lastRunAt,
		runCount: input.runCount ?? existing?.runCount ?? 0,
	};
	if (existingIndex >= 0) automations[existingIndex] = next;
	else automations.unshift(next);
	writeSavedAutomations(automations);
	return next;
}

function rememberRequestAutomation(
	body: Record<string, unknown>,
	source: "task" | "user",
): void {
	const action = asOptionalString(body.action) || asOptionalString(body.name);
	const prompt =
		asOptionalString(body.prompt) ||
		asOptionalString(
			(body.params as Record<string, unknown> | undefined)?.prompt,
		) ||
		(action
			? `Run ${action} with parameters ${JSON.stringify(body.params ?? {})}`
			: "");
	if (!action || !prompt) return;
	upsertSavedAutomation({
		id: slugifyAutomationId(action),
		name: action,
		description: "Saved automatically from a submitted task.",
		category: "Recent",
		prompt,
		source,
	});
}

function json(
	response: ServerResponse,
	statusCode: number,
	payload: unknown,
): void {
	if (!response.headersSent)
		response.setHeader("Content-Type", "application/json");
	response.writeHead(statusCode);
	response.end(JSON.stringify(redactObject(payload)));
}

function html(
	response: ServerResponse,
	statusCode: number,
	body: string,
): void {
	response.setHeader("Content-Type", "text/html; charset=utf-8");
	response.writeHead(statusCode);
	response.end(body);
}

function text(
	response: ServerResponse,
	statusCode: number,
	body: string,
	contentType = "text/plain; charset=utf-8",
): void {
	response.setHeader("Content-Type", contentType);
	response.writeHead(statusCode);
	response.end(body);
}

class WebClientError extends Error {
	readonly statusCode = 400;
	readonly code = "bad_request";
}

function asString(value: unknown, name: string): string {
	if (typeof value !== "string" || !value.trim())
		throw new WebClientError(`${name} is required.`);
	return value;
}

function asOptionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}

function asOptionalStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const strings = value.filter(
		(item): item is string => typeof item === "string" && item.trim() !== "",
	);
	return strings.length > 0 ? strings : undefined;
}

function isVerboseRequest(requestUrl: URL): boolean {
	return requestUrl.searchParams.get("verbose") === "true";
}

const VAULT_VERBOSE_CONFIRMATION = "REVEAL_VAULT_METADATA";

function hasVaultVerboseConfirmation(request: IncomingMessage): boolean {
	return (
		request.headers["x-browser-control-confirm"] === VAULT_VERBOSE_CONFIRMATION
	);
}

function rejectUnconfirmedVaultVerbose(
	request: IncomingMessage,
	requestUrl: URL,
	response: ServerResponse,
): boolean {
	if (!isVerboseRequest(requestUrl) || hasVaultVerboseConfirmation(request)) {
		return false;
	}
	json(response, 403, {
		success: false,
		code: "confirmation_required",
		error: `Verbose vault metadata requires X-Browser-Control-Confirm: ${VAULT_VERBOSE_CONFIRMATION}.`,
	});
	return true;
}

function summarizeVaultEntries(
	entries: Array<{ scope: string; hasValue: boolean }>,
): {
	count: number;
	scopes: string[];
	withValues: number;
	missingValues: number;
} {
	const withValues = entries.filter((entry) => entry.hasValue).length;
	return {
		count: entries.length,
		scopes: Array.from(new Set(entries.map((entry) => entry.scope))).sort(),
		withValues,
		missingValues: entries.length - withValues,
	};
}

function summarizeSecretGrants(grants: Array<{ revoked: boolean }>): {
	count: number;
	activeCount: number;
	revokedCount: number;
} {
	const revokedCount = grants.filter((grant) => grant.revoked).length;
	return {
		count: grants.length,
		activeCount: grants.length - revokedCount,
		revokedCount,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asAutomationSource(
	value: unknown,
): StoredAutomation["source"] | undefined {
	const source = asOptionalString(value);
	if (source === "built-in" || source === "user" || source === "task") {
		return source;
	}
	return undefined;
}

function optionalStateStorage(
	api: BrowserControlAPI,
): StateStorage | undefined {
	return (api as BrowserControlAPI & { state?: StateStorage }).state;
}

function vaultStateStorage(api: BrowserControlAPI): StateStorage {
	return optionalStateStorage(api) ?? getStateStorage();
}

function asOptionalNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function asNumber(value: unknown, name: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new WebClientError(`"${name}" must be a finite number`);
	}
	return value;
}

async function capabilities(api: BrowserControlAPI): Promise<WebCapabilities> {
	const status = await api.status();
	const brokerReachable = status.broker?.reachable === true;
	const desktopAvailable =
		fs.existsSync(path.join(__dirname, "..", "..", "desktop", "main.cjs")) ||
		fs.existsSync(path.resolve(process.cwd(), "desktop", "main.cjs"));

	let observabilityOk = false;
	try {
		const debugHealth = await api.debug.health();
		observabilityOk =
			debugHealth.overall === "healthy" || debugHealth.overall === "degraded";
	} catch {
		observabilityOk = false;
	}

	return {
		status: { key: "status", available: true },
		config: { key: "config", available: true },
		policy: { key: "policy", available: true },
		browser: { key: "browser", available: true },
		terminal: { key: "terminal", available: true },
		filesystem: { key: "filesystem", available: true },
		tasks: {
			key: "tasks",
			available: brokerReachable,
			reason: brokerReachable ? undefined : "Broker is not reachable.",
		},
		automations: {
			key: "automations",
			available: brokerReachable,
			reason: brokerReachable
				? undefined
				: "Scheduler requires broker to be reachable.",
		},
		logs: {
			key: "logs",
			available: observabilityOk,
			reason: observabilityOk
				? undefined
				: "Logging and observability store is unavailable.",
		},
		debugEvidence: {
			key: "debugEvidence",
			available: observabilityOk,
			reason: observabilityOk
				? undefined
				: "Debug evidence store is unavailable.",
		},
		desktop: {
			key: "desktop",
			available: desktopAvailable,
			reason: desktopAvailable ? undefined : "Desktop shell files not found.",
		},
	};
}

function getStaticRoot(): string {
	const candidates = [
		path.resolve(process.cwd(), "web", "dist"),
		path.resolve(__dirname, "..", "..", "web", "dist"),
	];
	return (
		candidates.find((candidate) =>
			fs.existsSync(path.join(candidate, "index.html")),
		) ?? ""
	);
}

function contentTypeFor(filePath: string): string {
	switch (path.extname(filePath).toLowerCase()) {
		case ".html":
			return "text/html; charset=utf-8";
		case ".js":
			return "text/javascript; charset=utf-8";
		case ".css":
			return "text/css; charset=utf-8";
		case ".json":
			return "application/json";
		case ".svg":
			return "image/svg+xml";
		case ".png":
			return "image/png";
		case ".jpg":
		case ".jpeg":
			return "image/jpeg";
		default:
			return "application/octet-stream";
	}
}

function serveStatic(
	response: ServerResponse,
	staticRoot: string,
	pathname: string,
): boolean {
	if (!staticRoot) return false;
	const requested =
		pathname === "/" ? "index.html" : pathname.replace(/^\/+/u, "");
	const resolved = path.resolve(staticRoot, requested);
	const relative = path.relative(staticRoot, resolved);
	if (
		relative.startsWith("..") ||
		path.isAbsolute(relative) ||
		!fs.existsSync(resolved) ||
		!fs.statSync(resolved).isFile()
	) {
		return false;
	}
	const content = fs.readFileSync(resolved);
	text(response, 200, content.toString("utf8"), contentTypeFor(resolved));
	return true;
}

function indexHtml(nonce: string): string {
	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Browser Control Operator</title>
  <style nonce="${nonce}">
    body { margin: 0; font-family: Segoe UI, Arial, sans-serif; background: #f7f8fa; color: #17191c; }
    .hidden { display: none !important; }
    .locked-screen { display: flex; align-items: center; justify-content: center; height: 100vh; flex-direction: column; gap: 16px; }
    .locked-screen h1 { font-size: 20px; }
    main { display: grid; grid-template-columns: 220px 1fr; min-height: 100vh; }
    nav { background: #15191f; color: white; padding: 18px 14px; }
    nav h1 { font-size: 16px; margin: 0 0 18px; font-weight: 650; }
    nav a { display: block; color: #d8dde6; padding: 8px 10px; text-decoration: none; border-radius: 6px; }
    nav a:hover { background: #252b35; }
    section { padding: 20px; }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(140px, 1fr)); gap: 12px; }
    .panel { background: white; border: 1px solid #dde2ea; border-radius: 8px; padding: 14px; }
    .stacked-panel { margin-top: 12px; }
    .panel h2 { margin: 0 0 8px; font-size: 14px; }
    pre { white-space: pre-wrap; overflow: auto; max-height: 360px; background: #101418; color: #d8f3dc; padding: 12px; border-radius: 6px; }
    button, input { font: inherit; }
    button { border: 1px solid #b9c1ce; background: white; padding: 7px 10px; border-radius: 6px; cursor: pointer; }
    input { border: 1px solid #b9c1ce; padding: 7px 9px; border-radius: 6px; min-width: 260px; }
    .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    @media (max-width: 800px) { main { grid-template-columns: 1fr; } nav { position: static; } .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div id="locked" class="locked-screen">
    <h1>Browser Control Locked</h1>
    <p>Please open via CLI or provide a valid token.</p>
  </div>
  <main id="app" class="hidden">
    <nav>
      <h1>Browser Control</h1>
      <a href="#overview">Overview</a>
      <a href="#terminal">Terminal</a>
      <a href="#browser">Browser</a>
      <a href="#filesystem">Filesystem</a>
      <a href="#settings">Settings</a>
    </nav>
    <section>
      <div class="grid" id="summary"></div>
      <div class="panel stacked-panel" id="terminal-panel">
        <h2>Terminal</h2>
        <div class="row">
          <input id="command" value="node --version" aria-label="Command">
          <button id="run">Run</button>
        </div>
        <pre id="terminalOut">Idle</pre>
      </div>
      <div class="panel stacked-panel" id="events">
        <h2>Events</h2>
        <pre id="eventOut">Connecting...</pre>
      </div>
    </section>
  </main>
  <script nonce="${nonce}">
    (function() {
      const hashParams = new URLSearchParams(window.location.hash.slice(1));
      let token = hashParams.get("token");
      if (token) {
        sessionStorage.setItem("bc-token", token);
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      } else {
        token = sessionStorage.getItem("bc-token");
      }

      if (!token) return;

      document.getElementById("locked").classList.add("hidden");
      document.getElementById("app").classList.remove("hidden");

      async function api(path, options = {}) {
        const res = await fetch(path, {
          ...options,
          headers: {
            "content-type": "application/json",
            "authorization": "Bearer " + token,
            ...(options.headers || {})
          }
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || res.statusText);
        return body;
      }
      async function refresh() {
        const status = await api("/api/status");
        const caps = await api("/api/capabilities");
        document.getElementById("summary").innerHTML = [
          ["Daemon", status.daemon?.state || "unknown"],
          ["Broker", status.broker?.reachable ? "reachable" : "offline"],
          ["Policy", status.policyProfile || "unknown"],
          ["Terminal", String(status.terminal?.activeSessions || 0)]
        ].map(([k,v]) => '<div class="panel"><h2>'+k+'</h2><strong>'+v+'</strong></div>').join("");
        window.__capabilities = caps;
      }
      document.getElementById("run").addEventListener("click", async () => {
        const command = document.getElementById("command").value;
        document.getElementById("terminalOut").textContent = "Running...";
        try {
          const result = await api("/api/terminal/exec", { method: "POST", body: JSON.stringify({ command }) });
          document.getElementById("terminalOut").textContent = JSON.stringify(result, null, 2);
        } catch (e) {
          document.getElementById("terminalOut").textContent = e.message;
        }
      });
      const wsBase = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/events";
      const ws = new WebSocket(wsBase, [token]);
      ws.onmessage = (event) => { document.getElementById("eventOut").textContent = event.data; };
      ws.onerror = () => { document.getElementById("eventOut").textContent = "Event stream disconnected"; };
      refresh().catch((e) => { document.getElementById("summary").textContent = e.message; });
    })();
  </script>
</body>
</html>`;
}

export function createWebAppServer(
	options: WebAppServerOptions = {},
): WebAppServer {
	const token = resolveWebDashboardToken(options.token);
	const host = options.host ?? DEFAULT_HOST;
	const port = options.port ?? DEFAULT_PORT;
	assertSafeBind(host, options.allowRemote === true);

	const api = options.api ?? createBrowserControl();
	const events = new WebEventHub();

	// Wire up real-time terminal output streaming to the dashboard event hub.
	// Clients may subscribe with ?sessionId=... so terminal output only reaches
	// matching subscribers. Events are redacted through redactObject() before
	// broadcast. Raw output is never logged.
	const termSub = api.terminal.onOutput((sessionId, data) => {
		events.emit("terminal.output", { sessionId, data }, { sessionId });
	});

	const server = http.createServer();
	const localApiServers = new Set<http.Server>();
	const rateLimiter = new WebRateLimiter();
	let currentInfo: WebAppServerInfo | null = null;
	let persistedInfo: PersistedWebAppServerInfo | null = null;
	const startedAt = new Date().toISOString();
	let allowedOrigins = options.allowedOrigins ?? [`http://${host}:${port}`];
	const staticRoot = getStaticRoot();

	async function handleApi(
		request: IncomingMessage,
		response: ServerResponse,
		requestUrl: URL,
	): Promise<void> {
		const { pathname } = requestUrl;

		if (request.method === "GET" && pathname === "/api/status") {
			const status = await api.status();
			events.emit("runtime.status", status);
			json(response, 200, status);
			return;
		}

		if (request.method === "GET" && pathname === "/api/settings") {
			const status = await api.status();
			json(response, 200, {
				dataHome: status.dataHome,
				policyProfile: status.policyProfile,
				provider: status.provider?.active ?? "local",
				browserProvider: status.browser?.provider ?? "local",
			});
			return;
		}

		if (request.method === "GET" && pathname === "/api/capabilities") {
			json(response, 200, await capabilities(api));
			return;
		}

		// ── Credential Vault and Privacy Network Control ───────────────
		if (request.method === "GET" && pathname === "/api/vault") {
			if (rejectUnconfirmedVaultVerbose(request, requestUrl, response)) return;
			const { CredentialVault } = await import("../security/credential_vault");
			const vault = new CredentialVault(optionalStateStorage(api));
			const entries = await vault.list();
			json(
				response,
				200,
				isVerboseRequest(requestUrl) ? entries : summarizeVaultEntries(entries),
			);
			return;
		}

		if (request.method === "POST" && pathname === "/api/vault") {
			const body = await readJsonBody(request);
			if (body.yes !== true && body.confirm !== "STORE_SECRET") {
				json(
					response,
					400,
					apiError(
						"confirmation_required",
						"Secret storage requires yes=true or confirm=STORE_SECRET.",
						{ details: { requiredConfirm: "STORE_SECRET" } },
					),
				);
				return;
			}
			const scope = asString(body.scope, "scope");
			if (scope !== "site" && scope !== "package" && scope !== "workflow") {
				json(
					response,
					400,
					apiError("bad_request", "scope must be site, package, or workflow."),
				);
				return;
			}
			const { CredentialVault } = await import("../security/credential_vault");
			const vault = new CredentialVault(optionalStateStorage(api));
			const stored = await vault.set(
				scope,
				asString(body.scopeName, "scopeName"),
				asString(body.secretName, "secretName"),
				asString(body.value, "value"),
			);
			await vaultStateStorage(api).saveSecretAuditEvent({
				id: `secret-audit-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
				secretId: stored.id,
				action: "set",
				targetDomain: asOptionalString(body.scopeName) ?? null,
				policyDecision: "confirmed",
				sessionId: "web",
				timestamp: new Date().toISOString(),
			});
			json(response, 200, {
				id: stored.id,
				scope: stored.scope,
				scopeName: stored.scopeName,
				secretName: stored.secretName,
				createdAt: stored.createdAt,
				updatedAt: stored.updatedAt,
				hasValue: true,
			});
			return;
		}

		const vaultDeleteMatch = /^\/api\/vault\/([^/]+)$/u.exec(pathname);
		if (request.method === "DELETE" && vaultDeleteMatch) {
			const body = (await readJsonBody(request).catch(() => ({}))) as Record<
				string,
				unknown
			>;
			if (body.confirm !== "DELETE_SECRET") {
				json(
					response,
					400,
					apiError(
						"confirmation_required",
						"Secret deletion requires confirm=DELETE_SECRET.",
						{ details: { requiredConfirm: "DELETE_SECRET" } },
					),
				);
				return;
			}
			const secretId = decodeURIComponent(vaultDeleteMatch[1] ?? "");
			const { CredentialVault } = await import("../security/credential_vault");
			const vault = new CredentialVault(optionalStateStorage(api));
			await vault.delete(secretId);
			await vaultStateStorage(api).saveSecretAuditEvent({
				id: `secret-audit-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
				secretId,
				action: "delete",
				targetDomain: null,
				policyDecision: "confirmed",
				sessionId: "web",
				timestamp: new Date().toISOString(),
			});
			json(response, 200, { success: true });
			return;
		}

		if (request.method === "GET" && pathname === "/api/vault/grants") {
			if (rejectUnconfirmedVaultVerbose(request, requestUrl, response)) return;
			const secretId = requestUrl.searchParams.get("secretId") ?? undefined;
			const { CredentialVault } = await import("../security/credential_vault");
			const vault = new CredentialVault(optionalStateStorage(api));
			const grants = await vault.listGrants(secretId);
			json(
				response,
				200,
				isVerboseRequest(requestUrl) ? grants : summarizeSecretGrants(grants),
			);
			return;
		}

		if (request.method === "POST" && pathname === "/api/vault/grants") {
			const body = await readJsonBody(request);
			const validSecretActions = [
				"reveal",
				"type",
				"paste",
				"use-as-header",
				"use-as-form-value",
			];
			const actions =
				asOptionalStringArray(body.actions) ??
				(asOptionalString(body.action)
					? [asString(body.action, "action")]
					: []);
			if (
				actions.length === 0 ||
				actions.some((action) => !validSecretActions.includes(action))
			) {
				json(response, 400, apiError("bad_request", "Invalid grant action."));
				return;
			}
			const { CredentialVault } = await import("../security/credential_vault");
			const vault = new CredentialVault(optionalStateStorage(api));
			const grant = await vault.grant(asString(body.secretId, "secretId"), {
				actions: actions as never,
				siteScope: asOptionalString(body.siteScope),
				domainScope:
					asOptionalString(body.domainScope) ?? asOptionalString(body.domain),
				packageScope: asOptionalString(body.packageScope),
				workflowScope: asOptionalString(body.workflowScope),
				domain: asOptionalString(body.domain),
				expiresAt: asOptionalString(body.expiresAt),
			});
			await vaultStateStorage(api).saveSecretAuditEvent({
				id: `secret-audit-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
				secretId: grant.secretId,
				action: `grant:${grant.actions.join(",")}`,
				targetDomain: grant.domainScope ?? grant.domain ?? null,
				policyDecision: "allowed",
				sessionId: "web",
				grantId: grant.id,
				packageName: grant.packageScope ?? null,
				workflowId: grant.workflowScope ?? null,
				site: grant.siteScope ?? null,
				redaction: { rawSecretStored: false, output: "[REDACTED_SECRET]" },
				timestamp: new Date().toISOString(),
			});
			json(response, 200, grant);
			return;
		}

		const grantDeleteMatch = /^\/api\/vault\/grants\/([^/]+)$/u.exec(pathname);
		if (request.method === "DELETE" && grantDeleteMatch) {
			const grantId = decodeURIComponent(grantDeleteMatch[1] ?? "");
			const { CredentialVault } = await import("../security/credential_vault");
			const vault = new CredentialVault(optionalStateStorage(api));
			const existingGrant = (await vault.listGrants()).find(
				(grant) => grant.id === grantId,
			);
			await vault.revokeGrant(grantId);
			if (existingGrant) {
				await vaultStateStorage(api).saveSecretAuditEvent({
					id: `secret-audit-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
					secretId: existingGrant.secretId,
					action: "grant:revoke",
					targetDomain:
						existingGrant.domainScope ?? existingGrant.domain ?? null,
					policyDecision: "confirmed",
					sessionId: "web",
					grantId,
					packageName: existingGrant.packageScope ?? null,
					workflowId: existingGrant.workflowScope ?? null,
					site: existingGrant.siteScope ?? null,
					redaction: { rawSecretStored: false, output: "[REDACTED_SECRET]" },
					timestamp: new Date().toISOString(),
				});
			}
			json(response, 200, { success: true });
			return;
		}

		if (request.method === "GET" && pathname === "/api/vault/audit") {
			const limit = Number(requestUrl.searchParams.get("limit") ?? "100");
			json(
				response,
				200,
				await vaultStateStorage(api).listSecretAuditEvents(
					Number.isFinite(limit) ? limit : 100,
				),
			);
			return;
		}

		if (request.method === "GET" && pathname === "/api/network/rules") {
			const { NetworkRuleEngine } = await import("../security/network_rules");
			const engine = new NetworkRuleEngine(optionalStateStorage(api));
			json(response, 200, await engine.listRules());
			return;
		}

		if (request.method === "POST" && pathname === "/api/network/rules") {
			const body = await readJsonBody(request);
			const ruleType = asString(body.ruleType, "ruleType");
			if (
				ruleType !== "allowlist" &&
				ruleType !== "denylist" &&
				ruleType !== "tracker"
			) {
				json(response, 400, apiError("bad_request", "Invalid ruleType."));
				return;
			}
			const { NetworkRuleEngine } = await import("../security/network_rules");
			const engine = new NetworkRuleEngine(optionalStateStorage(api));
			const rule = await engine.addRule(
				asString(body.pattern, "pattern"),
				ruleType,
				asOptionalStringArray(body.resourceTypes) as never,
			);
			json(response, 200, rule);
			return;
		}

		const networkRuleDeleteMatch = /^\/api\/network\/rules\/([^/]+)$/u.exec(
			pathname,
		);
		if (request.method === "DELETE" && networkRuleDeleteMatch) {
			const { NetworkRuleEngine } = await import("../security/network_rules");
			const engine = new NetworkRuleEngine(optionalStateStorage(api));
			const removed = await engine.removeRule(
				decodeURIComponent(networkRuleDeleteMatch[1] ?? ""),
			);
			json(response, 200, { removed });
			return;
		}

		if (request.method === "GET" && pathname === "/api/network/blocked") {
			const entries = api.debug
				.network({
					sessionId: requestUrl.searchParams.get("sessionId") || undefined,
				})
				.filter((entry) => {
					const status = (entry as { status?: number | string }).status;
					const errorText = String((entry as { error?: unknown }).error ?? "");
					return status === 0 || /blocked|abort|deny/iu.test(errorText);
				});
			json(response, 200, entries);
			return;
		}

		// ── Knowledge Backends ─────────────────────────────────────────
		if (request.method === "GET" && pathname === "/api/knowledge/backends") {
			const { getKnowledgeBackendCatalog, createKnowledgeBackend } =
				await import("../knowledge/backends");
			const catalog = getKnowledgeBackendCatalog();
			const healthChecks = await Promise.all(
				catalog.map(async (entry) => {
					const backend = createKnowledgeBackend({ type: entry.type });
					const health = await backend.health();
					return {
						type: entry.type,
						label: entry.label,
						default: entry.default,
						remote: entry.remote,
						status: entry.status,
						health,
					};
				}),
			);
			json(response, 200, { catalog: healthChecks });
			return;
		}

		if (
			request.method === "POST" &&
			pathname === "/api/knowledge/backends/health"
		) {
			const body = await readJsonBody(request);
			const { createKnowledgeBackend } = await import("../knowledge/backends");
			const backend = createKnowledgeBackend({
				type: asString(body.type, "type") as
					| "local-markdown"
					| "qdrant"
					| "pageindex",
				endpoint: asOptionalString(body.endpoint),
				apiKey: asOptionalString(body.apiKey),
				collection: asOptionalString(body.collection),
			});
			const health = await backend.health();
			json(response, health.ok ? 200 : 503, health);
			return;
		}

		if (request.method === "POST" && pathname === "/api/knowledge/search") {
			const body = await readJsonBody(request);
			const { createKnowledgeBackend } = await import("../knowledge/backends");
			const backend = createKnowledgeBackend({
				type: (asOptionalString(body.type) ?? "local-markdown") as
					| "local-markdown"
					| "qdrant"
					| "pageindex",
				endpoint: asOptionalString(body.endpoint),
				apiKey: asOptionalString(body.apiKey),
				collection: asOptionalString(body.collection),
			});
			const results = await backend.search({
				search: asOptionalString(body.query),
				domain: asOptionalString(body.domain),
				tags: asOptionalStringArray(body.tags) as string[] | undefined,
			});
			json(response, 200, { results });
			return;
		}

		if (request.method === "POST" && pathname === "/api/knowledge/rank") {
			const body = await readJsonBody(request);
			const { createKnowledgeBackend } = await import("../knowledge/backends");
			const backend = createKnowledgeBackend({
				type: (asOptionalString(body.type) ?? "local-markdown") as
					| "local-markdown"
					| "qdrant"
					| "pageindex",
				endpoint: asOptionalString(body.endpoint),
				apiKey: asOptionalString(body.apiKey),
				collection: asOptionalString(body.collection),
			});
			const ranked = await backend.rankEntries({
				domain: asOptionalString(body.domain),
				query: asString(body.query, "query"),
				entryType: asOptionalString(body.entryType) as never,
				limit: Number.isFinite(Number(body.limit))
					? Number(body.limit)
					: undefined,
			});
			json(response, 200, { ranked });
			return;
		}

		if (request.method === "GET" && pathname === "/api/health") {
			const health = await api.debug.health();
			json(response, 200, health);
			return;
		}

		if (request.method === "GET" && pathname === "/api/events/recent") {
			json(response, 200, events.listRecent());
			return;
		}

		// ── Browser Dialog ────────────────────────────────────────────────
		if (request.method === "POST" && pathname === "/api/browser/dialog") {
			const body = await readJsonBody(request);
			const action = asString(body.action, "action");
			if (action !== "list" && action !== "respond") {
				json(
					response,
					400,
					apiError("bad_request", "action must be 'list' or 'respond'."),
				);
				return;
			}
			const result = await api.browser.dialog({
				action,
				dialog_id: asOptionalString(body.dialog_id) ?? undefined,
				response: (asOptionalString(body.response) ?? undefined) as
					| "accept"
					| "dismiss"
					| undefined,
				text: asOptionalString(body.text) ?? undefined,
			});
			recordReplayAction("browser-dialog", body, result);
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		// ── Browser CDP Passthrough ─────────────────────────────────────────
		if (request.method === "POST" && pathname === "/api/browser/cdp") {
			const body = await readJsonBody(request);
			const method = asString(body.method, "method");
			const timeoutMs = asNumber(body.timeoutMs, "timeoutMs");
			const result = await api.browser.cdp({
				method,
				params: body.params as Record<string, unknown> | undefined,
				targetId: asOptionalString(body.targetId) ?? undefined,
				frameId: asOptionalString(body.frameId) ?? undefined,
				timeoutMs,
			});
			recordReplayAction("browser-cdp", body, result);
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		// ── Sessions ─────────────────────────────────────────────────────
		if (request.method === "GET" && pathname === "/api/sessions") {
			const result = api.session.list();
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "POST" && pathname === "/api/sessions") {
			const body = await readJsonBody(request);
			const name = asString(body.name, "name");
			const result = await api.session.create(name, {
				policyProfile: asOptionalString(body.policyProfile),
				workingDirectory: asOptionalString(body.workingDirectory),
			});
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "POST" && pathname === "/api/sessions/use") {
			const body = await readJsonBody(request);
			const nameOrId = asString(body.nameOrId, "nameOrId");
			const result = api.session.use(nameOrId);
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		const sessionStatusMatch = /^\/api\/sessions\/([^/]+)\/status$/u.exec(
			pathname,
		);
		if (request.method === "GET" && sessionStatusMatch) {
			const id = decodeURIComponent(sessionStatusMatch[1] ?? "");
			const result = api.session.status(id);
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		// ── Services / optional .localhost proxy ─────────────────────────
		if (request.method === "GET" && pathname === "/api/services") {
			const result = api.service.list();
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "GET" && pathname === "/api/services/proxy") {
			const result = api.service.proxy.status();
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "POST" && pathname === "/api/services/proxy/start") {
			const body = await readJsonBody(request);
			const result = await api.service.proxy.start({
				port: body.port === undefined ? undefined : Number(body.port),
				allowRemote: body.allowRemote === true,
				https: body.https === true,
				certPath: typeof body.certPath === "string" ? body.certPath : undefined,
				keyPath: typeof body.keyPath === "string" ? body.keyPath : undefined,
				localCa: body.localCa === true,
				caDir: typeof body.caDir === "string" ? body.caDir : undefined,
			});
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "POST" && pathname === "/api/services/proxy/stop") {
			const result = await api.service.proxy.stop();
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		// ── Config ───────────────────────────────────────────────────────
		if (request.method === "GET" && pathname === "/api/config") {
			json(response, 200, api.config.list());
			return;
		}

		if (request.method === "POST" && pathname === "/api/config/modelProvider") {
			const body = await readJsonBody(request);
			const { setUserConfigValue } = await import("../shared/config");
			const modelKey = asOptionalString(body.modelKey);
			if (modelKey && body.confirm !== "STORE_MODEL_API_KEY") {
				json(
					response,
					403,
					apiError(
						"confirmation_required",
						"Saving a model API key requires confirm=STORE_MODEL_API_KEY.",
						{ details: { requiredConfirm: "STORE_MODEL_API_KEY" } },
					),
				);
				return;
			}
			const saved = [
				setUserConfigValue("modelProvider", body.modelProvider),
				setUserConfigValue("modelEndpoint", body.modelEndpoint),
				setUserConfigValue("modelName", body.modelName),
			];
			if (modelKey) {
				saved.push(setUserConfigValue("modelApiKey", modelKey));
			}
			json(response, 200, { success: true, saved });
			return;
		}

		if (request.method === "POST" && pathname === "/api/config/localApi") {
			const body = await readJsonBody(request);
			const token = asOptionalString(body.token);
			if (!token) {
				json(response, 400, apiError("bad_request", "token is required"));
				return;
			}
			const { startLocalApi } = await import("../model_router");
			const { server, url } = await startLocalApi({
				port: body.port === undefined ? 11435 : Number(body.port),
				allowRemote: body.allowRemote === true,
				token,
			});
			localApiServers.add(server);
			server.once("close", () => localApiServers.delete(server));
			json(response, 200, { success: true, url, tokenProvided: true });
			return;
		}

		// ── Record / Replay Drafting ─────────────────────────────────────
		if (request.method === "POST" && pathname === "/api/recordings/start") {
			const body = await readJsonBody(request);
			const { getRecorder } = await import("../observability/recorder");
			const session = getRecorder().start(
				asString(body.name, "name"),
				typeof body.domain === "string" ? body.domain : undefined,
			);
			json(response, 200, { success: true, data: session });
			return;
		}

		if (request.method === "POST" && pathname === "/api/recordings/actions") {
			const body = await readJsonBody(request);
			const { getRecorder } = await import("../observability/recorder");
			const action = getRecorder().record(
				asString(
					body.kind,
					"kind",
				) as import("../observability/recorder").RecordedActionKind,
				isRecord(body.params) ? body.params : {},
				isRecord(body.result)
					? (body.result as unknown as import("../shared/action_result").ActionResult)
					: undefined,
			);
			json(response, 200, { success: true, data: action });
			return;
		}

		if (request.method === "POST" && pathname === "/api/recordings/stop") {
			const { getRecorder } = await import("../observability/recorder");
			const session = getRecorder().stop();
			json(
				response,
				session ? 200 : 404,
				session
					? { success: true, data: session }
					: apiError("not_found", "No active recording session"),
			);
			return;
		}

		const recordingDraftMatch = /^\/api\/recordings\/([^/]+)\/draft$/u.exec(
			pathname,
		);
		if (request.method === "GET" && recordingDraftMatch) {
			const id = decodeURIComponent(recordingDraftMatch[1] ?? "");
			const {
				convertRecordingToPackage,
				convertRecordingToWorkflow,
				getRecorder,
			} = await import("../observability/recorder");
			const session = getRecorder().getSession(id);
			if (!session) {
				json(
					response,
					404,
					apiError("not_found", `Recording not found: ${id}`),
				);
				return;
			}
			json(response, 200, {
				success: true,
				data: {
					session,
					workflow: convertRecordingToWorkflow(session),
					package: convertRecordingToPackage(session),
				},
			});
			return;
		}

		const recordingMaterializeMatch =
			/^\/api\/recordings\/([^/]+)\/materialize$/u.exec(pathname);
		if (request.method === "POST" && recordingMaterializeMatch) {
			const id = decodeURIComponent(recordingMaterializeMatch[1] ?? "");
			const body = await readJsonBody(request);
			const { convertRecordingToPackage, getRecorder } = await import(
				"../observability/recorder"
			);
			const { materializePackageDraft } = await import(
				"../packages/materialize"
			);
			const session = getRecorder().getSession(id);
			if (!session) {
				json(
					response,
					404,
					apiError("not_found", `Recording not found: ${id}`),
				);
				return;
			}
			try {
				const materialized = materializePackageDraft(
					convertRecordingToPackage(session),
					{ overwrite: body.overwrite === true },
				);
				const install =
					body.install === true
						? await api.package.install(materialized.packageDir)
						: undefined;
				json(response, install && !install.success ? 403 : 200, {
					success: install ? install.success : true,
					data: { materialized, installedPackage: install?.data },
					...(install?.error ? { error: install.error } : {}),
				});
			} catch (error) {
				json(response, 400, apiError("bad_request", errorMessage(error)));
			}
			return;
		}

		const configKeyMatch = /^\/api\/config\/([^/]+)$/u.exec(pathname);
		if (request.method === "GET" && configKeyMatch) {
			const key = decodeURIComponent(configKeyMatch[1] ?? "");
			json(response, 200, redactConfigEntry(api.config.get(key)));
			return;
		}

		if (request.method === "POST" && configKeyMatch) {
			const key = decodeURIComponent(configKeyMatch[1] ?? "");
			const mutationError = getDashboardConfigMutationError(key);
			if (mutationError) {
				json(response, 403, apiError("forbidden", mutationError));
				return;
			}
			const body = await readJsonBody(request);
			const result = api.config.set(key, body.value);
			events.emit("log.entry", {
				component: "web",
				message: `Config set: ${key}`,
			});
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		// ── Policy ───────────────────────────────────────────────────────
		if (request.method === "GET" && pathname === "/api/policy/profile") {
			json(response, 200, {
				active: api.config.get("policyProfile"),
				profiles: getAllProfiles(),
			});
			return;
		}

		if (request.method === "GET" && pathname === "/api/policy/profiles") {
			const { listBuiltInProfiles, listCustomProfiles } = await import(
				"../policy/profiles"
			);
			json(response, 200, {
				builtIn: listBuiltInProfiles().map((p) => ({ name: p.name })),
				custom: listCustomProfiles().map((p) => ({ name: p.name })),
			});
			return;
		}

		// ── Debug Evidence ───────────────────────────────────────────────
		if (request.method === "GET" && pathname === "/api/debug/bundles") {
			try {
				json(response, 200, api.debug.listBundles());
			} catch (e: unknown) {
				const message = errorMessage(e);
				if (
					!message.includes("requires user confirmation") &&
					!message.includes("Policy blocked debug_bundle_export")
				) {
					throw e;
				}
				json(response, 200, []);
			}
			return;
		}

		if (
			request.method === "GET" &&
			pathname.startsWith("/api/debug/bundles/")
		) {
			const bundleId = decodeURIComponent(
				pathname.slice("/api/debug/bundles/".length),
			);
			const bundle = api.debug.bundle(bundleId);
			if (!bundle) {
				json(
					response,
					404,
					apiError("not_found", `Debug bundle not found: ${bundleId}`),
				);
				return;
			}
			json(response, 200, bundle);
			return;
		}

		if (request.method === "GET" && pathname === "/api/debug/console") {
			json(
				response,
				200,
				api.debug.console({
					sessionId: requestUrl.searchParams.get("sessionId") || undefined,
				}),
			);
			return;
		}

		if (request.method === "GET" && pathname === "/api/debug/network") {
			json(
				response,
				200,
				api.debug.network({
					sessionId: requestUrl.searchParams.get("sessionId") || undefined,
				}),
			);
			return;
		}

		if (request.method === "POST" && pathname === "/api/debug/visual-diff") {
			const body = await readJsonBody(request);
			const beforePath = asString(body.beforePath, "beforePath");
			const afterPath = asString(body.afterPath, "afterPath");
			const { isSafeArtifactPath } = await import("../shared/paths");
			if (!isSafeArtifactPath(beforePath) || !isSafeArtifactPath(afterPath)) {
				json(
					response,
					400,
					apiError(
						"bad_request",
						"beforePath and afterPath must be under Browser Control data home",
					),
				);
				return;
			}
			const { computePixelDiff } = await import("../observability/visual_diff");
			const result = computePixelDiff(beforePath, afterPath);
			json(response, result ? 200 : 400, {
				success: Boolean(result),
				data: result,
				...(result ? {} : { error: "Unable to compute visual diff" }),
			});
			return;
		}

		if (request.method === "POST" && pathname === "/api/debug/dom-diff") {
			const body = await readJsonBody(request);
			const { computeDomDiff } = await import("../observability/visual_diff");
			json(
				response,
				200,
				computeDomDiff(
					Array.isArray(body.beforeNodes) ? body.beforeNodes : [],
					Array.isArray(body.afterNodes) ? body.afterNodes : [],
				),
			);
			return;
		}

		if (request.method === "GET" && pathname === "/api/debug/replays") {
			const { convertRecordingToReplayView, getRecorder } = await import(
				"../observability/recorder"
			);
			const { buildReplayView } = await import("../observability/visual_diff");
			const workflowRuns = api.workflow.runs();
			const workflowViews = workflowRuns.success
				? (workflowRuns.data ?? []).map((run) =>
						buildReplayView({
							id: run.id,
							status: run.status,
							startedAt: run.startedAt,
							completedAt: run.completedAt,
							nodeResults: Object.fromEntries(
								Object.entries(run.nodeResults ?? {}).map(
									([nodeId, result]) => [
										nodeId,
										{
											...result,
											kind: result.status,
											input: {},
										},
									],
								),
							),
						}),
					)
				: [];
			const recordingViews = getRecorder()
				.listSessions()
				.map(convertRecordingToReplayView);
			json(
				response,
				200,
				[...workflowViews, ...recordingViews].sort((a, b) =>
					b.startedAt.localeCompare(a.startedAt),
				),
			);
			return;
		}

		const replayExecuteMatch =
			/^\/api\/debug\/replays\/([^/]+)\/execute$/u.exec(pathname);
		if (request.method === "POST" && replayExecuteMatch) {
			const replayId = decodeURIComponent(replayExecuteMatch[1] ?? "");
			const { convertRecordingToWorkflow, getRecorder } = await import(
				"../observability/recorder"
			);
			const { buildReplayView } = await import("../observability/visual_diff");
			const session = getRecorder().getSession(replayId);
			if (!session) {
				json(
					response,
					404,
					apiError("not_found", "Replay recording not found"),
				);
				return;
			}
			const workflow = convertRecordingToWorkflow(session);
			const result = await api.workflow.run(JSON.stringify(workflow));
			if (!result.success) {
				json(
					response,
					400,
					apiError("policy_denied", result.error ?? "Replay execution failed", {
						actionResult: result,
					}),
				);
				return;
			}
			const run = result.data as import("../workflows/types").WorkflowRun;
			json(response, 200, {
				success: true,
				data: buildReplayView({
					id: run.id,
					status: run.status,
					startedAt: run.startedAt,
					completedAt: run.completedAt,
					nodeResults: Object.fromEntries(
						Object.entries(run.nodeResults ?? {}).map(
							([nodeId, nodeResult]) => [
								nodeId,
								{
									...nodeResult,
									kind: nodeResult.status,
									input:
										workflow.nodes.find((node) => node.id === nodeId)?.input ??
										{},
								},
							],
						),
					),
				}),
			});
			return;
		}

		if (request.method === "GET" && pathname === "/api/debug/receipts") {
			const { getObservabilityDir } = await import("../shared/paths");
			const receiptsDir = path.join(getObservabilityDir(), "receipts");
			const receipts: unknown[] = [];
			if (fs.existsSync(receiptsDir)) {
				for (const sessionId of fs.readdirSync(receiptsDir)) {
					const sessionPath = path.join(receiptsDir, sessionId);
					if (fs.statSync(sessionPath).isDirectory()) {
						for (const file of fs.readdirSync(sessionPath)) {
							if (file.startsWith("receipt-") && file.endsWith(".json")) {
								try {
									receipts.push(
										JSON.parse(
											fs.readFileSync(path.join(sessionPath, file), "utf8"),
										),
									);
								} catch {}
							}
						}
					}
				}
			}
			receipts.sort((a, b) =>
				((b as { completedAt?: string }).completedAt || "").localeCompare(
					(a as { completedAt?: string }).completedAt || "",
				),
			);
			json(response, 200, receipts);
			return;
		}

		const receiptMatch = /^\/api\/debug\/receipts\/([^/]+)$/u.exec(pathname);
		if (request.method === "GET" && receiptMatch) {
			const receiptId = decodeURIComponent(receiptMatch[1] ?? "");
			const receipt = api.debug.receipt(receiptId);
			if (!receipt) {
				json(response, 404, {
					success: false,
					code: "not_found",
					error: `Receipt not found: ${receiptId}`,
				});
				return;
			}
			json(response, 200, receipt);
			return;
		}

		if (request.method === "GET" && pathname === "/api/screenshots") {
			const { getRuntimeDir } = await import("../shared/paths");
			const runtimeDir = getRuntimeDir();
			const files: unknown[] = [];
			const collectScreenshots = (sessionPath: string, sessionDir: string) => {
				if (!fs.statSync(sessionPath).isDirectory()) return;
				const screenshotsDir = path.join(sessionPath, "screenshots");
				if (!fs.existsSync(screenshotsDir)) return;
				for (const name of fs.readdirSync(screenshotsDir)) {
					if (
						name.endsWith(".png") ||
						name.endsWith(".jpg") ||
						name.endsWith(".jpeg")
					) {
						const fullPath = path.join(screenshotsDir, name);
						const stat = fs.statSync(fullPath);
						files.push({
							name,
							path: fullPath,
							sizeBytes: stat.size,
							modifiedAt: stat.mtime.toISOString(),
							sessionDir,
						});
					}
				}
			};
			if (fs.existsSync(runtimeDir)) {
				for (const entry of fs.readdirSync(runtimeDir)) {
					const entryPath = path.join(runtimeDir, entry);
					if (!fs.statSync(entryPath).isDirectory()) continue;
					collectScreenshots(entryPath, entry);
					for (const sessionDir of fs.readdirSync(entryPath)) {
						const sessionPath = path.join(entryPath, sessionDir);
						if (!fs.statSync(sessionPath).isDirectory()) continue;
						collectScreenshots(sessionPath, sessionDir);
					}
				}
			}
			files.sort((a, b) =>
				(b as { modifiedAt: string }).modifiedAt.localeCompare(
					(a as { modifiedAt: string }).modifiedAt,
				),
			);
			json(response, 200, files.slice(0, 50));
			return;
		}

		// ── Logs ─────────────────────────────────────────────────────────
		if (request.method === "GET" && pathname === "/api/logs/files") {
			json(response, 200, listLogFiles());
			return;
		}

		if (request.method === "GET" && pathname === "/api/logs") {
			json(
				response,
				200,
				readRecentLogs(Number(requestUrl.searchParams.get("maxLines")) || 300),
			);
			return;
		}

		if (request.method === "GET" && pathname === "/api/audit") {
			const { getDefaultAuditLogger } = await import("../policy/audit");
			const { filterAuditEntries } = await import(
				"../observability/visual_diff"
			);
			const logger = getDefaultAuditLogger();
			const entries =
				logger?.getAll(Number(requestUrl.searchParams.get("limit")) || 100) ??
				[];
			const viewEntries = entries.map((entry, index) => ({
				id: `${entry.timestamp}-${index}`,
				action: entry.step?.action ?? "unknown",
				sessionId: entry.sessionId,
				policyDecision: entry.decision,
				risk: entry.risk,
				details: JSON.stringify({
					reason: entry.reason,
					profile: entry.profile,
					step: entry.step,
					matchedRule: entry.matchedRule,
				}),
				timestamp: entry.timestamp,
			}));
			json(
				response,
				200,
				filterAuditEntries(viewEntries, {
					sessionId: requestUrl.searchParams.get("sessionId") || undefined,
					workflowId: requestUrl.searchParams.get("workflowId") || undefined,
					packageName: requestUrl.searchParams.get("packageName") || undefined,
					action: requestUrl.searchParams.get("action") || undefined,
					risk: requestUrl.searchParams.get("risk") || undefined,
					limit: Number(requestUrl.searchParams.get("limit")) || undefined,
				}),
			);
			return;
		}

		if (request.method === "GET" && pathname === "/api/data/doctor") {
			const { inspectDataHome } = await import("../data_home");
			json(response, 200, inspectDataHome());
			return;
		}

		if (request.method === "POST" && pathname === "/api/data/cleanup") {
			const body = (await readJsonBody(request)) as {
				dryRun?: boolean;
				confirm?: string;
			};

			if (body.dryRun === false && body.confirm !== "DELETE_RUNTIME_TEMP") {
				json(
					response,
					400,
					apiError(
						"confirmation_required",
						"Destructive cleanup requires explicit confirmation.",
						{ details: { requiredConfirm: "DELETE_RUNTIME_TEMP" } },
					),
				);
				return;
			}

			const { cleanupDataHome } = await import("../data_home");
			json(
				response,
				200,
				cleanupDataHome(undefined, {
					dryRun: body.dryRun !== false,
					confirm: body.confirm,
				}),
			);
			return;
		}

		if (request.method === "POST" && pathname === "/api/data/export") {
			const body = await readJsonBody(request);
			const { exportDataHome } = await import("../data_home");
			json(
				response,
				200,
				exportDataHome(undefined, { label: asOptionalString(body.label) }),
			);
			return;
		}

		if (request.method === "GET" && pathname === "/api/packages") {
			const result = api.package.list();
			json(response, result.success ? 200 : 403, result.data ?? []);
			return;
		}

		if (request.method === "POST" && pathname === "/api/packages/install") {
			const body = await readJsonBody(request);
			const source = asString(body.source, "source");
			const result = await api.package.install(source);
			json(response, result.success ? 200 : 403, result);
			return;
		}

		const packageRunMatch = /^\/api\/packages\/([^/]+)\/run$/u.exec(pathname);
		if (request.method === "POST" && packageRunMatch) {
			const name = decodeURIComponent(packageRunMatch[1] ?? "");
			const body = await readJsonBody(request);
			const workflow = asOptionalString(body.workflow);
			const result = await api.package.run(name, workflow);
			json(response, result.success ? 200 : 403, result);
			return;
		}

		const packageReviewMatch = /^\/api\/packages\/([^/]+)\/review$/u.exec(
			pathname,
		);
		if (request.method === "POST" && packageReviewMatch) {
			const name = decodeURIComponent(packageReviewMatch[1] ?? "");
			const body = await readJsonBody(request);
			const status = (asOptionalString(body.status) || "unreviewed") as
				| "unreviewed"
				| "pending"
				| "approved"
				| "rejected";
			const reviewedBy = asOptionalString(body.reviewedBy) || "web-user";
			const reason = asOptionalString(body.reason);
			const result = api.package.review(name, status, reviewedBy, reason);
			json(response, result.success ? 200 : 403, result);
			return;
		}

		const packageReviewHistoryMatch =
			/^\/api\/packages\/([^/]+)\/review-history$/u.exec(pathname);
		if (request.method === "GET" && packageReviewHistoryMatch) {
			const name = decodeURIComponent(packageReviewHistoryMatch[1] ?? "");
			const result = api.package.reviewHistory(name);
			json(response, result.success ? 200 : 403, { data: result.data ?? [] });
			return;
		}

		const packageEvalMatch = /^\/api\/packages\/([^/]+)\/eval$/u.exec(pathname);
		if (request.method === "POST" && packageEvalMatch) {
			const name = decodeURIComponent(packageEvalMatch[1] ?? "");
			const result = await api.package.eval(name);
			json(response, result.success ? 200 : 403, result);
			return;
		}

		if (request.method === "GET" && pathname === "/api/packages/eval-history") {
			const pkgName = requestUrl.searchParams.get("package");
			const result = api.package.evalHistory(pkgName ?? undefined);
			json(response, result.success ? 200 : 403, { data: result.data ?? [] });
			return;
		}

		if (request.method === "GET" && pathname === "/api/benchmark/results") {
			const { listBenchmarkRuns } = await import("../benchmarks/runner");
			json(
				response,
				200,
				listBenchmarkRuns(undefined, {
					last: Number(requestUrl.searchParams.get("last")) || 10,
				}),
			);
			return;
		}

		// ── State Storage API endpoints ────────────────────────────────
		if (pathname.startsWith("/api/state/")) {
			const { getStateStorage } = await import("../state/index");
			const storage = getStateStorage();
			const subPath = pathname.slice("/api/state/".length);

			if (request.method === "GET") {
				switch (subPath) {
					case "tasks":
						json(response, 200, await storage.listTasks());
						return;
					case "automations":
						json(response, 200, await storage.listAutomations());
						return;
					case "workflow-definitions":
						json(response, 200, await storage.listWorkflowDefinitions());
						return;
					case "workflow-runs":
						json(response, 200, await storage.listWorkflowRuns());
						return;
					case "approvals":
						json(response, 200, await storage.listApprovals());
						return;
					case "evidence":
						json(response, 200, await storage.listEvidence());
						return;
					case "audit-events":
						json(response, 200, await storage.listAuditEvents());
						return;
					case "package-evals":
						json(response, 200, await storage.listPackageEvals());
						return;
					default:
						json(response, 404, {
							error: `Unknown state endpoint: ${subPath}`,
						});
						return;
				}
			}
		}

		if (request.method === "POST" && pathname === "/api/doctor/run") {
			const { runDoctor } = await import("../operator/doctor");
			json(response, 200, await runDoctor());
			return;
		}

		// Workflow v2 routes
		if (request.method === "POST" && pathname === "/api/workflows/run") {
			const body = await readJsonBody(request);
			const graph =
				typeof body.graph === "string"
					? body.graph
					: JSON.stringify(body.graph ?? {});
			const result = await api.workflow.run(graph);
			json(response, result.success ? 200 : 400, result);
			return;
		}

		if (
			request.method === "GET" &&
			pathname.startsWith("/api/workflows/runs/") &&
			pathname.endsWith("/events")
		) {
			const runId = pathname.slice(
				"/api/workflows/runs/".length,
				-"/events".length,
			);
			const result = api.workflow.events(runId);
			json(response, result.success ? 200 : 404, result);
			return;
		}

		if (
			request.method === "GET" &&
			pathname.startsWith("/api/workflows/runs/") &&
			!pathname.includes("/state") &&
			!pathname.includes("/events")
		) {
			const runId = decodeURIComponent(
				pathname.slice("/api/workflows/runs/".length),
			);
			const result = api.workflow.status(runId);
			json(response, result.success ? 200 : 404, result);
			return;
		}

		if (
			request.method === "POST" &&
			pathname.startsWith("/api/workflows/runs/") &&
			pathname.endsWith("/state")
		) {
			const runId = pathname.slice(
				"/api/workflows/runs/".length,
				-"/state".length,
			);
			const body = await readJsonBody(request);
			const result = api.workflow.editState(
				runId,
				String(body.key),
				body.value as string | number | boolean,
			);
			json(response, result.success ? 200 : 400, result);
			return;
		}

		if (
			request.method === "POST" &&
			pathname.startsWith("/api/workflows/runs/") &&
			pathname.endsWith("/approve")
		) {
			const runId = pathname.slice(
				"/api/workflows/runs/".length,
				-"/approve".length,
			);
			const body = await readJsonBody(request);
			const result = api.workflow.approve(
				runId,
				asString(body.nodeId, "nodeId"),
				asOptionalString(body.approvedBy) ?? "user",
			);
			json(response, result.success ? 200 : 400, result);
			return;
		}

		if (
			request.method === "POST" &&
			pathname.startsWith("/api/workflows/runs/") &&
			pathname.endsWith("/resume")
		) {
			const runId = pathname.slice(
				"/api/workflows/runs/".length,
				-"/resume".length,
			);
			const result = await api.workflow.resume(runId);
			json(response, result.success ? 200 : 400, result);
			return;
		}

		if (
			request.method === "POST" &&
			pathname.startsWith("/api/workflows/runs/") &&
			pathname.endsWith("/cancel")
		) {
			const runId = pathname.slice(
				"/api/workflows/runs/".length,
				-"/cancel".length,
			);
			const result = api.workflow.cancel(runId);
			json(response, result.success ? 200 : 400, result);
			return;
		}

		if (request.method === "POST" && pathname === "/api/harness/generate") {
			const body = await readJsonBody(request);
			const result = await api.harness.generate({
				id: asString(body.id, "id"),
				purpose: asString(body.purpose, "purpose"),
				files: Array.isArray(body.files)
					? body.files
					: [{ path: "helper.js", content: "" }],
				taskTags: asOptionalStringArray(body.taskTags),
				failureTypes: asOptionalStringArray(body.failureTypes),
				site: asOptionalString(body.site),
				domains: asOptionalStringArray(body.domains),
				usage: asOptionalString(body.usage),
				version: asOptionalString(body.version),
				testCommand: asOptionalString(body.testCommand),
				activate: body.activate === true,
			});
			json(response, result.success ? 200 : 400, result);
			return;
		}

		if (request.method === "GET" && pathname === "/api/harness") {
			const result = api.harness.list();
			json(response, result.success ? 200 : 400, result);
			return;
		}

		if (request.method === "GET" && pathname === "/api/harness/find") {
			const result = api.harness.find({
				domain: requestUrl.searchParams.get("domain") ?? undefined,
				taskTag: requestUrl.searchParams.get("taskTag") ?? undefined,
				failureType: requestUrl.searchParams.get("failureType") ?? undefined,
			});
			json(response, result.success ? 200 : 400, result);
			return;
		}

		if (
			request.method === "GET" &&
			pathname.startsWith("/api/harness/helpers/") &&
			pathname.endsWith("/validate")
		) {
			const helperId = decodeURIComponent(
				pathname.slice("/api/harness/helpers/".length, -"/validate".length),
			);
			const result = api.harness.validate(helperId);
			json(response, result.success ? 200 : 400, result);
			return;
		}

		if (
			request.method === "POST" &&
			pathname.startsWith("/api/harness/helpers/") &&
			pathname.endsWith("/execute")
		) {
			const helperId = decodeURIComponent(
				pathname.slice("/api/harness/helpers/".length, -"/execute".length),
			);
			const body = await readJsonBody(request);
			const result = await api.harness.execute(
				helperId,
				(body.input as Record<string, unknown> | undefined) ?? {},
			);
			json(response, result.success ? 200 : 400, result);
			return;
		}

		if (
			request.method === "POST" &&
			pathname.startsWith("/api/harness/helpers/") &&
			pathname.endsWith("/rollback")
		) {
			const helperId = decodeURIComponent(
				pathname.slice("/api/harness/helpers/".length, -"/rollback".length),
			);
			const body = await readJsonBody(request);
			const result = api.harness.rollback(
				helperId,
				asString(body.version, "version"),
			);
			json(response, result.success ? 200 : 400, result);
			return;
		}

		if (request.method === "GET" && pathname === "/api/saved-automations") {
			const state = optionalStateStorage(api);
			if (state) {
				let automations = await state.listAutomations();
				if (automations.length === 0) {
					const builtIns = builtInAutomations();
					for (const b of builtIns) {
						await state.saveAutomation({
							...b,
							status: "ready",
							runCount: 0,
							createdAt: new Date().toISOString(),
							updatedAt: new Date().toISOString(),
							source: b.source as "built-in" | "user" | "task",
						});
					}
					automations = await state.listAutomations();
				}
				json(response, 200, automations);
			} else {
				json(response, 200, readSavedAutomations());
			}
			return;
		}

		if (request.method === "POST" && pathname === "/api/saved-automations") {
			const body = await readJsonBody(request);
			const id =
				asOptionalString(body.id) ||
				slugifyAutomationId(asString(body.name, "name"));
			const now = new Date().toISOString();
			const state = optionalStateStorage(api);
			const existing = state ? await state.getAutomation(id) : undefined;

			const automation: StoredAutomation = {
				id,
				name: asString(body.name, "name"),
				description:
					asOptionalString(body.description) || existing?.description || "",
				category:
					asOptionalString(body.category) || existing?.category || "General",
				prompt: asString(body.prompt, "prompt"),
				source: asAutomationSource(body.source) || existing?.source || "user",
				approvalRequired: body.approvalRequired !== false,
				status: "ready",
				runCount: existing?.runCount || 0,
				createdAt: existing?.createdAt || now,
				updatedAt: now,
			};

			if (state) {
				await state.saveAutomation(automation);
			} else {
				upsertSavedAutomation(automation);
			}
			json(response, 200, automation);
			return;
		}

		const savedAutomationRunMatch =
			/^\/api\/saved-automations\/([^/]+)\/run$/u.exec(pathname);
		if (request.method === "POST" && savedAutomationRunMatch) {
			const id = decodeURIComponent(savedAutomationRunMatch[1] ?? "");
			const state = optionalStateStorage(api);
			const automation = state
				? await state.getAutomation(id)
				: readSavedAutomations().find((item) => item.id === id);
			if (!automation) {
				json(response, 404, {
					success: false,
					code: "not_found",
					error: `Automation not found: ${id}`,
				});
				return;
			}

			const now = new Date().toISOString();
			const updated = {
				...automation,
				status: "last-run" as const,
				lastRunAt: now,
				runCount: automation.runCount + 1,
			};
			if (state) {
				await state.saveAutomation(updated);
			} else {
				upsertSavedAutomation(updated);
			}

			try {
				const result = await fetchBrokerJson("/api/v1/tasks/run", {
					method: "POST",
					body: {
						action: updated.name,
						params: {
							automationId: updated.id,
							prompt: updated.prompt,
							approvalRequired: updated.approvalRequired,
						},
					},
				});
				json(response, 202, {
					success: true,
					queued: true,
					automation: updated,
					result,
				});
			} catch (e: unknown) {
				json(response, 200, {
					success: true,
					queued: false,
					automation: updated,
					message:
						"Automation saved. Agent runtime is not reachable, so it was not queued.",
					error: errorMessage(e),
				});
			}
			return;
		}

		if (request.method === "GET" && pathname === "/api/terminal/sessions") {
			const result = await api.terminalActions.list();
			events.emit("terminal.action", formatActionResult(result));
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "GET" && pathname === "/api/browser/providers") {
			json(response, 200, api.provider.list());
			return;
		}

		if (
			request.method === "GET" &&
			pathname === "/api/browser/providers/catalog"
		) {
			const result = api.provider.catalog();
			if (!result.success) {
				json(response, 403, result);
				return;
			}
			json(response, 200, result);
			return;
		}

		if (
			request.method === "GET" &&
			pathname === "/api/browser/providers/health"
		) {
			const result = await api.provider.health(
				requestUrl.searchParams.get("name") || undefined,
			);
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (
			request.method === "POST" &&
			pathname === "/api/browser/providers/use"
		) {
			const body = await readJsonBody(request);
			const result = api.provider.use(asString(body.name, "name"));
			events.emit("browser.action", formatActionResult(result));
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "POST" && pathname === "/api/terminal/sessions") {
			const body = await readJsonBody(request);
			const cols = asOptionalNumber(body.cols);
			const rows = asOptionalNumber(body.rows);
			if (cols !== undefined || rows !== undefined) {
				const validation = validateResize(cols, rows);
				if (!validation.valid) {
					json(response, 400, {
						success: false,
						code: "bad_request",
						error: validation.error,
					});
					return;
				}
			}
			const result = await api.terminal.open({
				shell: asOptionalString(body.shell),
				cwd: asOptionalString(body.cwd),
				name: asOptionalString(body.name),
				cols,
				rows,
			});
			events.emit("terminal.action", formatActionResult(result));
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "POST" && pathname === "/api/terminal/exec") {
			const body = await readJsonBody(request);
			const params = {
				command: asString(body.command, "command"),
				sessionId: asOptionalString(body.sessionId),
				timeoutMs: asOptionalNumber(body.timeoutMs),
			};
			const result = await api.terminal.exec(params);
			recordReplayAction("terminal-exec", params, result);
			events.emit("terminal.action", formatActionResult(result));
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		const termMatch =
			/^\/api\/terminal\/sessions\/([^/]+)\/(input|read|snapshot|render|interrupt|status|resize)$/u.exec(
				pathname,
			);
		if (termMatch) {
			const sessionId = decodeURIComponent(termMatch[1] ?? "");
			const action = termMatch[2];
			let result: unknown;
			if (request.method === "POST" && action === "input") {
				const body = await readJsonBody(request);
				const params = {
					sessionId,
					text: asString(body.text, "text"),
					submit: body.submit !== false,
				};
				result = await api.terminal.type(params);
				recordReplayAction("terminal-type", params, result as never);
			} else if (request.method === "POST" && action === "resize") {
				const body = await readJsonBody(request);
				const cols = Number(body.cols);
				const rows = Number(body.rows);
				const validation = validateResize(cols, rows);
				if (!validation.valid) {
					json(response, 400, {
						success: false,
						code: "bad_request",
						error: validation.error,
					});
					return;
				}
				result = await api.terminal.resize({
					sessionId,
					cols,
					rows,
				});
			} else if (request.method === "GET" && action === "read") {
				result = await api.terminal.read({
					sessionId,
					maxBytes:
						Number(requestUrl.searchParams.get("maxBytes")) || undefined,
				});
			} else if (request.method === "GET" && action === "snapshot") {
				result = await api.terminal.snapshot({ sessionId });
			} else if (request.method === "GET" && action === "render") {
				const snapshotResult = await api.terminal.snapshot({ sessionId });
				result =
					snapshotResult.success &&
					snapshotResult.data &&
					!Array.isArray(snapshotResult.data)
						? {
								...snapshotResult,
								data: buildTerminalView(
									snapshotResult.data as TerminalSnapshot,
								),
							}
						: snapshotResult;
			} else if (request.method === "POST" && action === "interrupt") {
				result = await api.terminal.interrupt({ sessionId });
			} else if (request.method === "GET" && action === "status") {
				result = await api.terminal.status({ sessionId });
			} else {
				json(response, 405, {
					success: false,
					code: "method_not_allowed",
					error: "Method not allowed.",
				});
				return;
			}
			events.emit("terminal.action", formatActionResult(result as never));
			json(
				response,
				(result as { success?: boolean }).success ? 200 : 403,
				formatActionResult(result as never),
			);
			return;
		}

		if (
			request.method === "DELETE" &&
			pathname.startsWith("/api/terminal/sessions/")
		) {
			const sessionId = decodeURIComponent(
				pathname.slice("/api/terminal/sessions/".length),
			);
			const result = await api.terminal.close({ sessionId });
			events.emit("terminal.action", formatActionResult(result));
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "POST" && pathname === "/api/browser/open") {
			const body = await readJsonBody(request);
			const params = {
				url: asString(body.url, "url"),
				waitUntil: body.waitUntil as never,
			};
			const result = await api.browser.open(params);
			recordReplayAction("browser-open", params, result);
			events.emit("browser.action", formatActionResult(result));
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "POST" && pathname === "/api/browser/snapshot") {
			const body = await readJsonBody(request);
			const params = {
				rootSelector: asOptionalString(body.rootSelector),
				boxes: body.boxes === true,
			};
			const result = await api.browser.snapshot(params);
			recordReplayAction("browser-snapshot", params, result);
			events.emit("browser.action", formatActionResult(result));
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "POST" && pathname === "/api/browser/screenshot") {
			const body = await readJsonBody(request);
			const params = {
				copyTo: asOptionalString(body.copyTo),
				outputPath: asOptionalString(body.outputPath),
				fullPage: body.fullPage === true,
				target: asOptionalString(body.target),
				annotate: body.annotate === true,
			};
			const result = await api.browser.screenshot(params);
			recordReplayAction("browser-screenshot", params, result);
			events.emit("browser.action", formatActionResult(result));
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "GET" && pathname === "/api/browser/tabs") {
			const result = await api.browser.tabList();
			events.emit("browser.action", formatActionResult(result));
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "POST" && pathname === "/api/browser/click") {
			const body = await readJsonBody(request);
			const params = {
				target: asString(body.target, "target"),
				timeoutMs: asOptionalNumber(body.timeoutMs),
				force: body.force === true,
			};
			const result = await api.browser.click(params);
			recordReplayAction("browser-click", params, result);
			events.emit("browser.action", formatActionResult(result));
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "POST" && pathname === "/api/browser/fill") {
			const body = await readJsonBody(request);
			const params = {
				target: asString(body.target, "target"),
				text: asString(body.text, "text"),
				timeoutMs: asOptionalNumber(body.timeoutMs),
				commit: body.commit === true,
			};
			const result = await api.browser.fill(params);
			recordReplayAction("browser-fill", params, result);
			events.emit("browser.action", formatActionResult(result));
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "POST" && pathname === "/api/browser/press") {
			const body = await readJsonBody(request);
			const params = {
				key: asString(body.key, "key"),
			};
			const result = await api.browser.press(params);
			recordReplayAction("browser-press", params, result);
			events.emit("browser.action", formatActionResult(result));
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "POST" && pathname === "/api/browser/type") {
			const body = await readJsonBody(request);
			const result = await api.browser.type({
				text: asString(body.text, "text"),
				delayMs: asOptionalNumber(body.delayMs),
			});
			events.emit("browser.action", formatActionResult(result));
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "POST" && pathname === "/api/browser/scroll") {
			const body = await readJsonBody(request);
			const result = await api.browser.scroll({
				direction: asString(body.direction, "direction") as
					| "up"
					| "down"
					| "left"
					| "right",
				amount: asOptionalNumber(body.amount),
			});
			events.emit("browser.action", formatActionResult(result));
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "POST" && pathname === "/api/browser/tabs/switch") {
			const body = await readJsonBody(request);
			const result = await api.browser.tabSwitch(asString(body.id, "id"));
			events.emit("browser.action", formatActionResult(result));
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "POST" && pathname === "/api/browser/tabs/close") {
			const result = await api.browser.tabClose();
			events.emit("browser.action", formatActionResult(result));
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "POST" && pathname === "/api/browser/close") {
			const result = await api.browser.close();
			events.emit("browser.action", formatActionResult(result));
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "GET" && pathname === "/api/fs/list") {
			const result = await api.fs.ls({
				path: requestUrl.searchParams.get("path") || ".",
				recursive: requestUrl.searchParams.get("recursive") === "true",
				extension: requestUrl.searchParams.get("extension") || undefined,
			});
			events.emit("filesystem.action", formatActionResult(result));
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "GET" && pathname === "/api/fs/read") {
			const params = {
				path: requestUrl.searchParams.get("path") || "",
				maxBytes: Number(requestUrl.searchParams.get("maxBytes")) || undefined,
			};
			const result = await api.fs.read(params);
			recordReplayAction("fs-read", params, result);
			events.emit("filesystem.action", formatActionResult(result));
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "POST" && pathname === "/api/fs/write") {
			const body = await readJsonBody(request);
			const params = {
				path: asString(body.path, "path"),
				content: asString(body.content, "content"),
				createDirs: body.createDirs !== false,
			};
			const result = await api.fs.write(params);
			recordReplayAction("fs-write", params, result);
			events.emit("filesystem.action", formatActionResult(result));
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "POST" && pathname === "/api/fs/move") {
			const body = await readJsonBody(request);
			const result = await api.fs.move({
				src: asString(body.src, "src"),
				dst: asString(body.dst, "dst"),
			});
			events.emit("filesystem.action", formatActionResult(result));
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "GET" && pathname === "/api/fs/stat") {
			const result = await api.fs.stat({
				path: requestUrl.searchParams.get("path") || "",
			});
			events.emit("filesystem.action", formatActionResult(result));
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "DELETE" && pathname === "/api/fs/delete") {
			const body = await readJsonBody(request);
			const result = await api.fs.rm({
				path: asString(body.path, "path"),
				recursive: body.recursive === true,
				force: body.force === true,
			});
			events.emit("filesystem.action", formatActionResult(result));
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "GET" && pathname === "/api/tasks") {
			try {
				json(response, 200, await fetchBrokerJson("/api/v1/tasks"));
			} catch {
				json(
					response,
					503,
					apiError("capability_unavailable", TASK_RUNTIME_OFFLINE_ERROR, {
						details: {
							...BROKER_UNAVAILABLE_DETAILS,
							available: false,
							tasks: [],
							recovery: TASK_RUNTIME_RECOVERY,
						},
					}),
				);
			}
			return;
		}

		if (request.method === "POST" && pathname === "/api/tasks") {
			try {
				const body = await readJsonBody(request);
				rememberRequestAutomation(body, "task");
				const result = await fetchBrokerJson("/api/v1/tasks/run", {
					method: "POST",
					body,
				});
				events.emit("log.entry", {
					component: "web",
					message: "Task submitted",
					result,
				});
				json(response, 202, result);
			} catch (e: unknown) {
				webLogger.debug("Task submission broker request failed", {
					error: errorMessage(e),
				});
				json(
					response,
					503,
					apiError(
						"capability_unavailable",
						TASK_RUNTIME_SUBMIT_OFFLINE_ERROR,
						{ details: BROKER_UNAVAILABLE_DETAILS },
					),
				);
			}
			return;
		}

		const taskStatusMatch = /^\/api\/tasks\/([^/]+)$/u.exec(pathname);
		if (request.method === "GET" && taskStatusMatch) {
			try {
				const id = encodeURIComponent(
					decodeURIComponent(taskStatusMatch[1] ?? ""),
				);
				json(
					response,
					200,
					await fetchBrokerJson(`/api/v1/tasks/${id}/status`),
				);
			} catch (e: unknown) {
				webLogger.debug("Task status broker request failed", {
					error: errorMessage(e),
				});
				json(
					response,
					503,
					apiError("capability_unavailable", "Task runtime is offline.", {
						details: BROKER_UNAVAILABLE_DETAILS,
					}),
				);
			}
			return;
		}

		if (request.method === "GET" && pathname === "/api/automations") {
			try {
				json(response, 200, await fetchBrokerJson("/api/v1/scheduler"));
			} catch (e: unknown) {
				webLogger.debug("Automation list broker request failed", {
					error: errorMessage(e),
				});
				json(
					response,
					503,
					apiError("capability_unavailable", "Automation runtime is offline.", {
						details: BROKER_UNAVAILABLE_DETAILS,
					}),
				);
			}
			return;
		}

		if (request.method === "POST" && pathname === "/api/automations") {
			try {
				const body = await readJsonBody(request);
				rememberRequestAutomation(body, "user");
				const result = await fetchBrokerJson("/api/v1/tasks/schedule", {
					method: "POST",
					body,
				});
				events.emit("log.entry", {
					component: "web",
					message: "Automation scheduled",
					result,
				});
				json(response, 200, result);
			} catch (e: unknown) {
				webLogger.debug("Automation schedule broker request failed", {
					error: errorMessage(e),
				});
				json(
					response,
					503,
					apiError("capability_unavailable", "Automation runtime is offline.", {
						details: BROKER_UNAVAILABLE_DETAILS,
					}),
				);
			}
			return;
		}

		const automationMatch =
			/^\/api\/automations\/([^/]+)\/(pause|resume)$/u.exec(pathname);
		if (request.method === "POST" && automationMatch) {
			try {
				const id = encodeURIComponent(
					decodeURIComponent(automationMatch[1] ?? ""),
				);
				const action = automationMatch[2];
				json(
					response,
					200,
					await fetchBrokerJson(`/api/v1/scheduler/${id}/${action}`, {
						method: "POST",
					}),
				);
			} catch (e: unknown) {
				webLogger.debug("Automation state broker request failed", {
					error: errorMessage(e),
				});
				json(
					response,
					503,
					apiError("capability_unavailable", "Automation runtime is offline.", {
						details: BROKER_UNAVAILABLE_DETAILS,
					}),
				);
			}
			return;
		}

		const automationDeleteMatch = /^\/api\/automations\/([^/]+)$/u.exec(
			pathname,
		);
		if (request.method === "DELETE" && automationDeleteMatch) {
			try {
				const id = encodeURIComponent(
					decodeURIComponent(automationDeleteMatch[1] ?? ""),
				);
				json(
					response,
					200,
					await fetchBrokerJson(`/api/v1/scheduler/${id}`, {
						method: "DELETE",
					}),
				);
			} catch (e: unknown) {
				webLogger.debug("Automation delete broker request failed", {
					error: errorMessage(e),
				});
				json(
					response,
					503,
					apiError("capability_unavailable", "Automation runtime is offline.", {
						details: BROKER_UNAVAILABLE_DETAILS,
					}),
				);
			}
			return;
		}

		json(response, 404, {
			success: false,
			code: "not_found",
			error: "Not found.",
		});
	}

	server.on("request", async (request, response) => {
		const nonce = crypto.randomBytes(16).toString("base64");
		setSecurityHeaders(response, nonce);
		setCorsHeaders(request, response, allowedOrigins);

		if (request.method === "OPTIONS") {
			response.writeHead(204);
			response.end();
			return;
		}

		const requestUrl = new URL(
			request.url ?? "/",
			`http://${request.headers.host ?? host}`,
		);
		try {
			if (request.method === "GET" && requestUrl.pathname === "/") {
				if (!serveStatic(response, staticRoot, requestUrl.pathname))
					html(response, 200, indexHtml(nonce));
				return;
			}

			if (request.method === "GET" && requestUrl.pathname === "/healthz") {
				const authorized = isAuthorizedRequest(request, token, requestUrl);
				const rateLimitDecision = rateLimiter.consume(
					createRateLimitEntries(request, token, requestUrl, authorized),
				);
				if (!rateLimitDecision.allowed) {
					writeRateLimitResponse(response, rateLimitDecision);
					return;
				}

				if (!authorized) {
					json(response, 401, {
						success: false,
						code: "unauthorized",
						error: "Unauthorized.",
					});
					return;
				}
				json(response, 200, { ok: true });
				return;
			}

			if (requestUrl.pathname.startsWith("/api/")) {
				const authorized = isAuthorizedRequest(request, token, requestUrl);
				const rateLimitDecision = rateLimiter.consume(
					createRateLimitEntries(request, token, requestUrl, authorized),
				);
				if (!rateLimitDecision.allowed) {
					writeRateLimitResponse(response, rateLimitDecision);
					return;
				}

				if (!authorized) {
					json(response, 401, {
						success: false,
						code: "unauthorized",
						error: "Unauthorized.",
					});
					return;
				}

				await handleApi(request, response, requestUrl);
				return;
			}

			if (
				request.method === "GET" &&
				serveStatic(response, staticRoot, requestUrl.pathname)
			)
				return;
			text(response, 404, "Not found.");
		} catch (error: unknown) {
			closeRequestStreamAfterResponse(request, response, error);
			const message = redactString(
				error instanceof Error ? error.message : String(error),
			);
			if (
				error instanceof RequestBodyTooLargeError ||
				error instanceof UnsupportedMediaTypeError ||
				error instanceof WebClientError
			) {
				json(response, error.statusCode, {
					success: false,
					code: error.code,
					error: message,
				});
				return;
			}
			webLogger.error("Unhandled web request error", {
				method: request.method,
				path: requestUrl.pathname,
				error: redactString(
					error instanceof Error
						? (error.stack ?? error.message)
						: String(error),
				),
			});
			json(response, 500, {
				success: false,
				code: "internal_error",
				error: "Internal server error.",
			});
		}
	});

	server.on("upgrade", (request, socket, head) => {
		const requestUrl = new URL(
			request.url ?? "/",
			`http://${request.headers.host ?? host}`,
		);
		if (requestUrl.pathname !== "/events") {
			socket.destroy();
			return;
		}
		const authorized = isAuthorizedWebSocketRequest(request, token);
		const rateLimitDecision = rateLimiter.consume(
			createRateLimitEntries(request, token, requestUrl, authorized),
		);
		if (!rateLimitDecision.allowed) {
			writeRateLimitUpgradeError(socket, rateLimitDecision);
			return;
		}
		events.handleUpgrade(
			request,
			socket,
			head,
			authorized,
			allowedOrigins,
			token,
		);
	});

	return {
		async listen(
			listenPort = port,
			listenHost = host,
		): Promise<WebAppServerInfo> {
			assertSafeBind(listenHost, options.allowRemote === true);
			await new Promise<void>((resolve, reject) => {
				server.once("error", reject);
				server.listen(listenPort, listenHost, () => {
					server.off("error", reject);
					resolve();
				});
			});
			const address = server.address();
			if (!address || typeof address === "string")
				throw new Error("App server did not provide a TCP address.");
			webLogger.info("Listening", {
				host: listenHost,
				port: address.port,
				url: `http://${listenHost}:${address.port}`,
			});
			currentInfo = {
				host: listenHost,
				port: address.port,
				token,
				url: `http://${listenHost}:${address.port}`,
			};
			persistedInfo = writePersistedWebAppServerInfo({
				...currentInfo,
				pid: process.pid,
				startedAt,
			});
			if (!options.allowedOrigins) {
				allowedOrigins = [`http://${listenHost}:${address.port}`];
			}
			return currentInfo;
		},
		async close(): Promise<void> {
			termSub.dispose();
			await events.close();
			for (const localApiServer of localApiServers) {
				await new Promise<void>((resolve) => {
					localApiServer.close(() => resolve());
				});
			}
			localApiServers.clear();
			if (persistedInfo) {
				clearPersistedWebAppServerInfo({
					pid: persistedInfo.pid,
					port: persistedInfo.port,
					token: persistedInfo.token,
				});
				persistedInfo = null;
			}
			api.close();
			if (!server.listening) return;
			if ("closeAllConnections" in server) {
				(
					server as unknown as {
						closeAllConnections: () => void;
					}
				).closeAllConnections();
			}
			await new Promise<void>((resolve, reject) => {
				server.close((error) => {
					if (error) {
						webLogger.error("Close error", { error: errorMessage(error) });
						reject(error);
					} else {
						resolve();
					}
				});
			});
		},
		address(): AddressInfo | string | null {
			return server.address();
		},
		info(): WebAppServerInfo | null {
			return currentInfo;
		},
		events,
	};
}

export function printServerInfo(info: WebAppServerInfo): void {
	process.stdout.write(`${JSON.stringify({ url: info.url })}\n`);
	process.stderr.write(
		`Token: ${info.token}\nWARNING: The web authentication token is shown above. Keep it secret.\n`,
	);
	if (process.env.BROWSER_CONTROL_WEB_SHOW_TOKEN === "1") {
		process.stdout.write(
			`${JSON.stringify({ url: info.url, token: info.token })}\n`,
		);
	}
}

export async function startWebAppServer(
	options: WebAppServerOptions = {},
): Promise<WebAppServerInfo> {
	const server = createWebAppServer(options);
	const info = await server.listen();
	const shutdown = async () => {
		await server.close().catch(() => undefined);
	};
	process.once("SIGINT", shutdown);
	process.once("SIGTERM", shutdown);
	return info;
}

export function openUrlInDefaultBrowser(url: string): void {
	const parsedUrl = new URL(url);
	if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
		throw new Error(
			"Only http and https URLs can be opened in the default browser.",
		);
	}
	const browserUrl = parsedUrl.toString();
	const command =
		process.platform === "win32"
			? "rundll32.exe"
			: process.platform === "darwin"
				? "open"
				: "xdg-open";
	const args =
		process.platform === "win32"
			? ["url.dll,FileProtocolHandler", browserUrl]
			: [browserUrl];
	const child = spawn(command, args, {
		detached: true,
		stdio: "ignore",
		windowsHide: true,
	});
	child.unref();
}

if (require.main === module) {
	const server = createWebAppServer({
		host: process.env.BROWSER_CONTROL_WEB_HOST,
		port: process.env.BROWSER_CONTROL_WEB_PORT
			? Number(process.env.BROWSER_CONTROL_WEB_PORT)
			: undefined,
		token: process.env.BROWSER_CONTROL_WEB_TOKEN,
		allowRemote: process.env.BROWSER_CONTROL_WEB_ALLOW_REMOTE === "1",
	});
	installGlobalFatalHandlers({
		component: "web",
		logger: webLogger,
		shutdown: () => server.close(),
	});
	void server
		.listen()
		.then((info) => {
			printServerInfo(info);
		})
		.catch((error: unknown) => {
			webLogger.critical("Fatal startup error", { error: errorMessage(error) });
			process.exitCode = 1;
		});
}
