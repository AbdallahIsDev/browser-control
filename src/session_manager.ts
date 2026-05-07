/**
 * Session Manager — Unified session action surface for Browser Control.
 *
 * A session binds together:
 *   - policy profile
 *   - browser connection state
 *   - terminal session ownership
 *   - filesystem working context
 *   - audit references
 *
 * This module provides the session lifecycle operations that the CLI
 * and TypeScript API expose as `bc session ...`.
 */

import crypto from "node:crypto";
import { WebSocket } from "ws";
import { BrowserConnectionManager } from "./browser/connection";
import { DefaultPolicyEngine } from "./policy/engine";
import { defaultRouter, type ExecutionRouter } from "./policy/execution_router";
import type {
	ExecutionPath,
	PolicyDecision,
	PolicyTaskIntent,
	RiskLevel,
	RoutedStep,
} from "./policy/types";
import { spawnDaemonProcess } from "./runtime/daemon_launch";
import { MemoryStore } from "./runtime/memory_store";
import {
	type ActionResult,
	confirmationRequiredResult,
	failureResult,
	policyDeniedResult,
	successResult,
} from "./shared/action_result";
import { loadConfig } from "./shared/config";
import { logger } from "./shared/logger";
import { TerminalSessionManager } from "./terminal/session";

const log = logger.withComponent("session_manager");

// ── Session State ──────────────────────────────────────────────────────

export interface SessionState {
	/** Unique session ID. */
	id: string;
	/** Human-readable session name. */
	name: string;
	/** Active policy profile. */
	policyProfile: string;
	/** Browser connection ID (if a browser is attached). */
	browserConnectionId: string | null;
	/** Terminal session ID (if a terminal is bound). */
	terminalSessionId: string | null;
	/** Filesystem working directory. */
	workingDirectory: string;
	/** ISO timestamp when the session was created. */
	createdAt: string;
	/** ISO timestamp of last activity. */
	lastActivityAt: string;
	/** Audit reference IDs accumulated in this session. */
	auditIds: string[];
}

// ── Session List Entry ─────────────────────────────────────────────────

export interface SessionListEntry {
	id: string;
	name: string;
	policyProfile: string;
	hasBrowser: boolean;
	hasTerminal: boolean;
	workingDirectory: string;
	createdAt: string;
	lastActivityAt: string;
}

// ── Rich Policy Evaluation Result (Issue 2) ─────────────────────────────

/**
 * Result when policy evaluation allows the action.
 * Carries the REAL decision, risk, auditId — never a hardcoded "allow".
 */
export interface PolicyAllowResult {
	/** The action is allowed to proceed. */
	allowed: true;
	/** The actual policy decision (may be "allow" or "allow_with_audit"). */
	policyDecision: PolicyDecision;
	/** Risk level assigned by the execution router. */
	risk: RiskLevel;
	/** Audit ID if the action was recorded by the policy audit log. */
	auditId?: string;
	/** Execution path that will handle the action. */
	path: ExecutionPath;
}

/**
 * Discriminated union result from evaluateAction().
 *
 * - On denial or confirmation-required: returns an ActionResult (success=false)
 * - On allow: returns a PolicyAllowResult with real metadata that callers
 *   must thread into their success ActionResult
 */
export type PolicyEvalResult = PolicyAllowResult | ActionResult;

/**
 * Type guard: returns true if the policy evaluation allowed the action.
 * Use this instead of `!policyEval.allowed` because ActionResult
 * doesn't have an `allowed` property, so TypeScript can't narrow
 * the union without this guard.
 */
export function isPolicyAllowed(
	result: PolicyEvalResult,
): result is PolicyAllowResult {
	return "allowed" in result && result.allowed === true;
}

// ── Terminal Runtime Interface (Issue 4) ───────────────────────────────

/**
 * Abstract terminal runtime — insulates TerminalActions from whether
 * terminal sessions are owned locally or by the daemon.
 *
 * Two implementations exist:
 *   - LocalTerminalRuntime: uses in-process TerminalSessionManager
 *   - DaemonTerminalRuntime: delegates to a Daemon instance
 *
 * Both the CLI and the API should go through the same runtime, ensuring
 * isomorphic behaviour regardless of whether a daemon is running.
 */
export interface TerminalRuntime {
	open(config: {
		shell?: string;
		cwd?: string;
		name?: string;
	}): Promise<{ id: string; shell: string; cwd: string; status: string }>;
	exec(
		command: string,
		options: {
			sessionId?: string;
			timeoutMs?: number;
		},
	): Promise<import("./terminal/types").ExecResult>;
	type(sessionId: string, text: string): Promise<void>;
	read(sessionId: string, maxBytes?: number): Promise<string>;
	snapshot(sessionId?: string): Promise<unknown>;
	interrupt(sessionId: string): Promise<void>;
	resize(sessionId: string, cols: number, rows: number): Promise<void>;
	close(sessionId: string): Promise<void>;
	list(): Promise<
		Array<{
			id: string;
			name?: string;
			shell: string;
			cwd: string;
			status: string;
		}>
	>;
	/** Resume a terminal session from persisted state (Section 13). */
	resume(sessionId: string): Promise<unknown>;
	/** Get resume status for a terminal session (Section 13). */
	status(sessionId: string): Promise<unknown>;
	onData(listener: (sessionId: string, data: string) => void): {
		dispose(): void;
	};
}

/**
 * Local terminal runtime: uses an in-process TerminalSessionManager.
 * This is the default when no daemon is available.
 */
export class LocalTerminalRuntime implements TerminalRuntime {
	constructor(private readonly tm: TerminalSessionManager) {}

	async open(config: { shell?: string; cwd?: string; name?: string }) {
		const session = await this.tm.create(config);
		return {
			id: session.id,
			shell: session.shell,
			cwd: session.cwd,
			status: session.status,
		};
	}

	async exec(
		command: string,
		options: { sessionId?: string; timeoutMs?: number },
	) {
		if (options.sessionId) {
			const session = this.tm.get(options.sessionId);
			if (!session)
				throw new Error(`Terminal session not found: ${options.sessionId}`);
			return session.exec(command, { timeoutMs: options.timeoutMs });
		}
		// One-shot exec — import the standalone exec
		const { exec: oneShotExec } = await import("./terminal/exec");
		return oneShotExec(command, { timeoutMs: options.timeoutMs });
	}

	async type(sessionId: string, text: string) {
		const session = this.tm.get(sessionId);
		if (!session) throw new Error(`Terminal session not found: ${sessionId}`);
		await session.write(text);
	}

	async read(sessionId: string, maxBytes?: number) {
		const session = this.tm.get(sessionId);
		if (!session) throw new Error(`Terminal session not found: ${sessionId}`);
		return session.read(maxBytes);
	}

	async snapshot(sessionId?: string) {
		if (sessionId) {
			const session = this.tm.get(sessionId);
			if (!session) throw new Error(`Terminal session not found: ${sessionId}`);
			return session.snapshot();
		}
		const sessions = this.tm.list();
		return Promise.all(sessions.map((s) => s.snapshot()));
	}

	async interrupt(sessionId: string) {
		const session = this.tm.get(sessionId);
		if (!session) throw new Error(`Terminal session not found: ${sessionId}`);
		await session.interrupt();
	}

	async resize(sessionId: string, cols: number, rows: number) {
		const session = this.tm.get(sessionId);
		if (!session) throw new Error(`Terminal session not found: ${sessionId}`);
		await session.resize(cols, rows);
	}

	async close(sessionId: string) {
		await this.tm.close(sessionId);
	}

	async list() {
		return this.tm.list().map((s) => ({
			id: s.id,
			name: s.name,
			shell: s.shell,
			cwd: s.cwd,
			status: s.status,
		}));
	}

	async resume(_sessionId: string): Promise<unknown> {
		throw new Error(
			"LocalTerminalRuntime does not support resume. Use daemon-backed runtime.",
		);
	}

	async status(sessionId: string): Promise<unknown> {
		const session = this.tm.get(sessionId);
		if (!session) {
			throw new Error(`Terminal session not found: ${sessionId}`);
		}
		return {
			sessionId,
			resumeLevel: session.resumeMetadata?.resumeLevel ?? 1,
			status: session.resumeMetadata?.status ?? "fresh",
			preserved: session.resumeMetadata?.preserved ?? {
				metadata: true,
				buffer: false,
			},
			lost: session.resumeMetadata?.lost ?? [],
			session: {
				id: session.id,
				name: session.name,
				shell: session.shell,
				cwd: session.cwd,
				status: session.status,
				createdAt: session.createdAt,
			},
		};
	}

	onData(listener: (sessionId: string, data: string) => void): {
		dispose(): void;
	} {
		return this.tm.onData(listener);
	}
}

/**
 * Daemon-backed terminal runtime: delegates to a Daemon instance.
 * Used when the daemon is running and owns terminal session state.
 */
export class DaemonTerminalRuntime implements TerminalRuntime {
	constructor(private readonly daemon: import("./runtime/daemon").Daemon) {}

	async open(config: { shell?: string; cwd?: string; name?: string }) {
		const raw = await this.daemon.termOpen(config);
		return {
			id: raw.id as string,
			shell: (raw.shell as string) ?? "",
			cwd: (raw.cwd as string) ?? "",
			status: (raw.status as string) ?? "running",
		};
	}

	async exec(
		command: string,
		options: { sessionId?: string; timeoutMs?: number },
	) {
		const raw = (await this.daemon.termExec(command, {
			sessionId: options.sessionId,
			timeoutMs: options.timeoutMs,
		})) as Record<string, unknown>;
		return {
			exitCode: (raw.exitCode as number) ?? 0,
			stdout: (raw.stdout as string) ?? "",
			stderr: (raw.stderr as string) ?? "",
			durationMs: (raw.durationMs as number) ?? 0,
			cwd: (raw.cwd as string) ?? "",
			timedOut: (raw.timedOut as boolean) ?? false,
		};
	}

	async type(sessionId: string, text: string) {
		await this.daemon.termType(sessionId, text);
	}

	async read(sessionId: string, maxBytes?: number) {
		const result = await this.daemon.termRead(sessionId, maxBytes);
		return (result as { output: string }).output;
	}

	async snapshot(sessionId?: string) {
		return this.daemon.termSnapshot(sessionId);
	}

	async interrupt(sessionId: string) {
		await this.daemon.termInterrupt(sessionId);
	}

	async resize(sessionId: string, cols: number, rows: number) {
		await this.daemon.termResize(sessionId, cols, rows);
	}

	async close(sessionId: string) {
		await this.daemon.termClose(sessionId);
	}

	async list() {
		return this.daemon.termList().map((s) => ({
			id: s.id as string,
			name: (s.name as string) ?? undefined,
			shell: (s.shell as string) ?? "",
			cwd: (s.cwd as string) ?? "",
			status: (s.status as string) ?? "running",
		}));
	}

	async resume(sessionId: string): Promise<unknown> {
		return this.daemon.termResume(sessionId);
	}

	async status(sessionId: string): Promise<unknown> {
		return this.daemon.termStatus(sessionId);
	}

	onData(listener: (sessionId: string, data: string) => void): {
		dispose(): void;
	} {
		return this.daemon.getTerminalManager().onData(listener);
	}
}

// ── Shared Daemon Health Probe ─────────────────────────────────────────

/**
 * Probe the daemon's health endpoint to check if it's reachable.
 *
 * This is a shared utility used by both the CLI (isDaemonReachable) and
 * the SessionManager (ensureDaemonRuntime) so that both use the same
 * probe implementation instead of duplicating the fetch+timeout logic.
 *
 * @returns `{ running: true, brokerUrl }` if the daemon responded OK,
 *          `{ running: false, brokerUrl }` otherwise.
 */
export async function probeDaemonHealth(
	config?: import("./shared/config").BrowserControlConfig,
): Promise<{ running: boolean; brokerUrl: string }> {
	const resolvedConfig = config ?? loadConfig({ validate: false });
	const brokerUrl = `http://127.0.0.1:${resolvedConfig.brokerPort}`;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 2000);
	try {
		const response = await fetch(`${brokerUrl}/api/v1/health`, {
			signal: controller.signal,
		});
		return { running: response.ok, brokerUrl };
	} catch {
		return { running: false, brokerUrl };
	} finally {
		clearTimeout(timeout);
	}
}

/**
 * Probe the daemon's terminal broker endpoint to verify it's actually
 * ready for terminal actions, not just "the HTTP server is listening."
 *
 * The /api/v1/health endpoint can respond before the daemon's terminal
 * session manager is fully initialized (e.g., during skill loading,
 * task recovery, etc.). This probe specifically checks the terminal
 * broker path that `bc term open` will use, so we don't race between
 * health-probe-success and terminal-action-failure.
 *
 * @returns `true` if the terminal sessions endpoint responded successfully.
 */
export async function probeTerminalReadiness(
	brokerUrl: string,
): Promise<boolean> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 3000);
	try {
		const response = await fetch(`${brokerUrl}/api/v1/term/sessions`, {
			signal: controller.signal,
		});
		return response.ok;
	} catch {
		return false;
	} finally {
		clearTimeout(timeout);
	}
}

// ── Broker-backed Terminal Runtime ────────────────────────────────────

/**
 * Broker-backed terminal runtime: routes terminal commands through the
 * daemon's broker HTTP API. Used by the CLI when the daemon is running,
 * so that terminal sessions live in the daemon process (not the CLI
 * process), and the CLI can exit cleanly after each command.
 *
 * This is the fix for the Section 5 terminal ownership defect:
 * - `bc term open` no longer creates an in-process PTY
 * - The CLI process exits cleanly after printing the result
 * - Terminal sessions persist across CLI invocations
 */
export class BrokerTerminalRuntime implements TerminalRuntime {
	private readonly _brokerUrl: string;
	private readonly apiKey: string | null;

	/** The broker URL this runtime connects to. */
	get brokerUrl(): string {
		return this._brokerUrl;
	}

	constructor(options: {
		brokerUrl: string;
		apiKey?: string | null;
	}) {
		this._brokerUrl = options.brokerUrl;
		this.apiKey = options.apiKey ?? null;
	}

	private async request(
		subcommand: string,
		payload: Record<string, unknown> = {},
		method = "GET",
	): Promise<unknown> {
		const isPost = method === "POST";
		const url = `${this._brokerUrl}/api/v1/term/${subcommand}`;
		const options: RequestInit = {
			method: isPost ? "POST" : "GET",
			headers: {
				"Content-Type": "application/json",
				...(this.apiKey ? { "X-API-Key": this.apiKey } : {}),
			},
		};
		if (isPost) {
			options.body = JSON.stringify(payload);
		} else if (Object.keys(payload).length > 0) {
			// For GET, encode payload as query params
			const params = new URLSearchParams();
			for (const [key, value] of Object.entries(payload)) {
				if (value !== undefined && value !== null) {
					params.set(key, String(value));
				}
			}
			const qs = params.toString();
			if (qs) {
				const urlObj = new URL(url);
				for (const [key, value] of params.entries()) {
					urlObj.searchParams.set(key, value);
				}
				return this.fetchJson(urlObj.toString(), options);
			}
		}
		return this.fetchJson(url, options);
	}

	private async fetchJson(url: string, options: RequestInit): Promise<unknown> {
		// Retry transient connection errors (ECONNREFUSED, fetch failed).
		// This handles the brief window after auto-start where the daemon's
		// broker is listening but the terminal endpoint isn't fully wired up,
		// or the daemon crashes immediately after the health probe succeeds.
		const maxRetries = 3;
		const retryDelayMs = 500;
		let lastError: Error | null = null;

		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			try {
				const response = await fetch(url, options);
				if (!response.ok) {
					const body = await response.text().catch(() => "");
					throw new Error(
						`Broker API error: HTTP ${response.status} for ${url}: ${body}`,
					);
				}
				return response.json();
			} catch (error: unknown) {
				lastError = error instanceof Error ? error : new Error(String(error));
				const message = lastError.message;
				// Only retry on connection-level errors, not on HTTP errors or
				// application-level errors.
				const isTransient =
					/ECONNREFUSED|fetch failed|ECONNRESET|EPIPE|socket hang up/i.test(
						message,
					);
				if (!isTransient || attempt === maxRetries) {
					break;
				}
				// Brief pause before retrying
				await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
			}
		}

		throw lastError ?? new Error(`Broker API request failed: ${url}`);
	}

	async open(config: { shell?: string; cwd?: string; name?: string }) {
		const raw = (await this.request(
			"open",
			{
				shell: config.shell,
				cwd: config.cwd,
				name: config.name,
			},
			"POST",
		)) as Record<string, unknown>;
		return {
			id: (raw.id as string) ?? "",
			shell: (raw.shell as string) ?? "",
			cwd: (raw.cwd as string) ?? "",
			status: (raw.status as string) ?? "idle",
		};
	}

	async exec(
		command: string,
		options: { sessionId?: string; timeoutMs?: number },
	) {
		const raw = (await this.request(
			"exec",
			{
				command,
				sessionId: options.sessionId,
				timeoutMs: options.timeoutMs,
			},
			"POST",
		)) as Record<string, unknown>;
		return {
			exitCode: (raw.exitCode as number) ?? 0,
			stdout: (raw.stdout as string) ?? "",
			stderr: (raw.stderr as string) ?? "",
			durationMs: (raw.durationMs as number) ?? 0,
			cwd: (raw.cwd as string) ?? "",
			timedOut: (raw.timedOut as boolean) ?? false,
		};
	}

	async type(sessionId: string, text: string) {
		await this.request("type", { sessionId, text }, "POST");
	}

	async read(sessionId: string, maxBytes?: number) {
		const result = (await this.request("read", {
			sessionId,
			maxBytes,
		})) as Record<string, unknown>;
		return (result.output as string) ?? "";
	}

	async snapshot(sessionId?: string) {
		return this.request("snapshot", sessionId ? { sessionId } : {});
	}

	async interrupt(sessionId: string) {
		await this.request("interrupt", { sessionId }, "POST");
	}

	async resize(sessionId: string, cols: number, rows: number) {
		await this.request("resize", { sessionId, cols, rows }, "POST");
	}

	async close(sessionId: string) {
		await this.request("close", { sessionId }, "POST");
	}

	async list() {
		const raw = (await this.request("sessions")) as Array<
			Record<string, unknown>
		>;
		return raw.map((s) => ({
			id: (s.id as string) ?? "",
			name: (s.name as string) ?? undefined,
			shell: (s.shell as string) ?? "",
			cwd: (s.cwd as string) ?? "",
			status: (s.status as string) ?? "idle",
		}));
	}

	async resume(sessionId: string): Promise<unknown> {
		return this.request("resume", { sessionId }, "POST");
	}

	async status(sessionId: string): Promise<unknown> {
		return this.request("status", { sessionId });
	}

	onData(listener: (sessionId: string, data: string) => void): {
		dispose(): void;
	} {
		const wsUrl = `${this._brokerUrl.replace(/^http/u, "ws")}/ws`;
		const ws = new WebSocket(wsUrl, {
			headers: this.apiKey ? { "X-API-Key": this.apiKey } : {},
		});
		ws.on("message", (msg) => {
			try {
				const payload = JSON.parse(msg.toString());
				if (payload.type === "terminal.output") {
					listener(payload.sessionId as string, payload.data as string);
				}
			} catch {
				// Ignore malformed frames
			}
		});
		ws.on("error", (err) => {
			log.warn(`Broker WebSocket error: ${err.message}`);
		});
		return {
			dispose: () => {
				try {
					ws.close();
				} catch {
					/* already closed */
				}
			},
		};
	}
}

// ── Session Manager ────────────────────────────────────────────────────

export class SessionManager {
	private readonly sessions = new Map<string, SessionState>();
	private readonly memoryStore: MemoryStore;
	private readonly policyEngine: DefaultPolicyEngine;
	private readonly executionRouter: ExecutionRouter;
	private readonly browserManager: BrowserConnectionManager;
	private readonly terminalManager: TerminalSessionManager;
	private activeSessionId: string | null = null;

	constructor(
		options: {
			memoryStore?: MemoryStore;
			policyEngine?: DefaultPolicyEngine;
			browserManager?: BrowserConnectionManager;
			terminalManager?: TerminalSessionManager;
		} = {},
	) {
		const config = loadConfig({ validate: false });
		this.memoryStore = options.memoryStore ?? new MemoryStore();
		this.policyEngine =
			options.policyEngine ??
			new DefaultPolicyEngine({ profileName: config.policyProfile });
		this.executionRouter = defaultRouter;
		this.browserManager =
			options.browserManager ??
			new BrowserConnectionManager({
				memoryStore: this.memoryStore,
				policyEngine: this.policyEngine,
				executionRouter: this.executionRouter,
			});
		this.terminalManager =
			options.terminalManager ?? new TerminalSessionManager();
		this.browserManager.onDisconnected?.((connection) => {
			this.unbindBrowserConnection(connection.id);
		});

		// Reload persisted sessions from MemoryStore so that
		// separate CLI/API invocations see existing sessions.
		this.loadPersistedSessions();
	}

	// ── Session Lifecycle ────────────────────────────────────────────────

	/**
	 * Create a new session.
	 */
	async create(
		name: string,
		options: {
			policyProfile?: string;
			workingDirectory?: string;
		} = {},
	): Promise<ActionResult<SessionState>> {
		const sessionId = crypto.randomUUID();
		const config = loadConfig({ validate: false });
		const policyProfile = options.policyProfile ?? config.policyProfile;

		// Validate the policy profile — save/restore so that creating a
		// non-active session doesn't permanently mutate the engine state.
		const previousProfile = this.policyEngine.getActiveProfile();
		try {
			this.policyEngine.setProfile(policyProfile);
		} catch {
			// Restore before returning so the engine isn't left in a bad state
			try {
				this.policyEngine.setProfile(previousProfile);
			} catch {
				/* best-effort */
			}
			return failureResult(`Invalid policy profile: ${policyProfile}`, {
				path: "a11y",
				sessionId,
			});
		}
		// Restore: evaluateAction() handles per-eval profile switching; the
		// engine's "resting" profile should reflect whichever session is active.
		// Since this new session may not become active (if one already exists),
		// we restore to avoid leaking profile state.
		if (this.activeSessionId) {
			// An active session already exists — restore its profile
			const activeState = this.sessions.get(this.activeSessionId);
			if (activeState) {
				try {
					this.policyEngine.setProfile(activeState.policyProfile);
				} catch {
					/* best-effort */
				}
			}
		} // else: this is the first session, it will become active, so leave the engine on its profile

		const state: SessionState = {
			id: sessionId,
			name,
			policyProfile,
			browserConnectionId: null,
			terminalSessionId: null,
			workingDirectory: options.workingDirectory ?? process.cwd(),
			createdAt: new Date().toISOString(),
			lastActivityAt: new Date().toISOString(),
			auditIds: [],
		};

		this.sessions.set(sessionId, state);

		// Auto-set as active if this is the first session
		if (!this.activeSessionId) {
			this.activeSessionId = sessionId;
		}

		// Persist AFTER activeSessionId is set so the session:active marker
		// is written correctly.
		this.persistSession(state);

		log.info("Session created", { sessionId, name, policyProfile });

		return successResult(state, {
			path: "a11y",
			sessionId,
			policyDecision: "allow",
		});
	}

	/**
	 * List all sessions.
	 */
	list(): ActionResult<SessionListEntry[]> {
		const entries: SessionListEntry[] = Array.from(this.sessions.values()).map(
			(s) => ({
				id: s.id,
				name: s.name,
				policyProfile: s.policyProfile,
				hasBrowser: s.browserConnectionId !== null,
				hasTerminal: s.terminalSessionId !== null,
				workingDirectory: s.workingDirectory,
				createdAt: s.createdAt,
				lastActivityAt: s.lastActivityAt,
			}),
		);

		return successResult(entries, {
			path: "a11y",
			sessionId: this.activeSessionId ?? "none",
		});
	}

	/**
	 * Set the active session (bc session use <name>).
	 */
	use(nameOrId: string): ActionResult<SessionState> {
		// Try ID first, then name
		let state = this.sessions.get(nameOrId);
		if (!state) {
			state = Array.from(this.sessions.values()).find(
				(s) => s.name === nameOrId,
			);
		}

		if (!state) {
			return failureResult(`Session not found: ${nameOrId}`, {
				path: "a11y",
				sessionId: this.activeSessionId ?? "none",
			});
		}

		this.activeSessionId = state.id;
		this.touchSession(state.id);
		try {
			this.policyEngine.setProfile(state.policyProfile);
		} catch {
			// Creation validates profiles; this is best-effort protection for
			// corrupted persisted session state.
		}

		log.info("Session activated", { sessionId: state.id, name: state.name });

		return successResult(state, {
			path: "a11y",
			sessionId: state.id,
		});
	}

	/**
	 * Get the status of the active or named session.
	 */
	status(nameOrId?: string): ActionResult<SessionState> {
		const state = this.resolveSession(nameOrId);
		if (!state) {
			return failureResult(`No active session`, {
				path: "a11y",
				sessionId: this.activeSessionId ?? "none",
			});
		}

		return successResult(state, {
			path: "a11y",
			sessionId: state.id,
		});
	}

	// ── Accessors ────────────────────────────────────────────────────────

	/** Get the active session state, or null. */
	getActiveSession(): SessionState | null {
		if (!this.activeSessionId) return null;
		return this.sessions.get(this.activeSessionId) ?? null;
	}

	/** Get a session by ID. */
	getSession(id: string): SessionState | null {
		return this.sessions.get(id) ?? null;
	}

	/** Get the browser connection manager. */
	getBrowserManager(): BrowserConnectionManager {
		return this.browserManager;
	}

	/** Release browser/CDP client handles held by one-shot CLI commands. */
	async releaseCliHandles(): Promise<void> {
		await this.browserManager.releaseCliHandles();
	}

	/** Get the terminal session manager. */
	getTerminalManager(): TerminalSessionManager {
		return this.terminalManager;
	}

	/** Get the policy engine. */
	getPolicyEngine(): DefaultPolicyEngine {
		return this.policyEngine;
	}

	/** Get the execution router. */
	getExecutionRouter(): ExecutionRouter {
		return this.executionRouter;
	}

	/** Get the memory store. */
	getMemoryStore(): MemoryStore {
		return this.memoryStore;
	}

	/**
	 * Close the session manager and release all held resources.
	 *
	 * This is critical for the CLI: after a command like `bc term open --json`
	 * completes, the process must exit cleanly. Without close(), the
	 * MemoryStore's SQLite database handle keeps the Node.js event loop
	 * alive, preventing the process from exiting.
	 *
	 * Call this at the end of runCli() (or any short-lived entry point)
	 * after all work is done.
	 */
	close(): void {
		try {
			this.terminalManager.closeAll();
		} catch {
			// Best-effort
		}
		try {
			this.memoryStore.close();
		} catch {
			// Best-effort — may already be closed
		}
	}

	/**
	 * Create a TerminalRuntime for this session manager.
	 *
	 * If a daemon instance has been set (via setDaemon()), returns a
	 * DaemonTerminalRuntime backed by that daemon — this is the case when
	 * the SessionManager is created inside the daemon process.
	 *
	 * Otherwise returns a LocalTerminalRuntime (in-process).
	 *
	 * This addresses Issue 3: CLI and API should not silently use different
	 * runtime models for the same action surface. When the daemon is running,
	 * both the daemon's internal API and the CLI (via the broker) route through
	 * the same DaemonTerminalRuntime.
	 */
	getTerminalRuntime(): TerminalRuntime {
		if (this.daemon) {
			return new DaemonTerminalRuntime(this.daemon);
		}
		// If ensureDaemonRuntime() established a broker connection, use it
		// so that the programmatic API aligns with the CLI ownership model.
		if (this.brokerRuntime) {
			return this.brokerRuntime;
		}
		return new LocalTerminalRuntime(this.terminalManager);
	}

	/**
	 * Set the daemon instance for daemon-backed terminal runtime.
	 * Called when the SessionManager is created inside the daemon process,
	 * ensuring that getTerminalRuntime() returns a DaemonTerminalRuntime
	 * instead of a LocalTerminalRuntime.
	 */
	setDaemon(daemon: import("./runtime/daemon").Daemon): void {
		this.daemon = daemon;
	}

	/** Check whether a daemon is set for daemon-backed runtime. */
	hasDaemon(): boolean {
		return this.daemon !== null;
	}

	private daemon: import("./runtime/daemon").Daemon | null = null;

	/**
	 * Cached broker-backed terminal runtime, set when the API user
	 * calls ensureDaemonRuntime() and the daemon is reachable.
	 * This aligns the programmatic API with the CLI's ownership model:
	 * persistent terminal sessions use the daemon-backed runtime by default.
	 */
	private brokerRuntime: BrokerTerminalRuntime | null = null;

	/**
	 * Invalidate the cached broker runtime.
	 *
	 * Call this when a BrokerTerminalRuntime HTTP request fails (e.g.,
	 * ECONNREFUSED), so that the next ensureDaemonRuntime() call will
	 * re-probe the daemon health endpoint instead of returning the
	 * stale cached runtime.
	 *
	 * Without this, a dead daemon would cause every terminal action to
	 * fail with a network error forever, because the early-return
	 * `if (this.brokerRuntime) return true` prevents re-probing.
	 */
	invalidateBrokerRuntime(): void {
		this.brokerRuntime = null;
	}

	/**
	 * Ensure the terminal runtime is daemon-backed for persistent sessions.
	 *
	 * This aligns the programmatic API with the CLI: when the daemon is
	 * running, terminal sessions should live in the daemon process, not
	 * in the caller's process.  The method probes the daemon's health
	 * endpoint and, if reachable, caches a BrokerTerminalRuntime that
	 * all subsequent TerminalActions calls will use.
	 *
	 * If `autoStart` is true and the daemon is not reachable, the method
	 * will attempt to spawn the daemon process (same as `bc daemon start`)
	 * and retry the health probe.  This makes `bc term open` work without
	 * requiring the user to manually start the daemon first.
	 *
	 * If the daemon is not reachable and autoStart fails or is disabled,
	 * the method returns false and getTerminalRuntime() will continue
	 * returning a LocalTerminalRuntime (for one-shot exec) or a
	 * DaemonTerminalRuntime (if setDaemon was called inside the daemon).
	 *
	 * @returns true if a broker runtime was established, false otherwise
	 */
	async ensureDaemonRuntime(
		options: {
			/** If true, auto-start the daemon if it's not running. */
			autoStart?: boolean;
		} = {},
	): Promise<boolean> {
		// If we already have a daemon injected in-process, that takes precedence
		if (this.daemon) return true;

		// If we already have a cached broker runtime, skip the probe.
		// This avoids an HTTP round-trip on every terminal action when the
		// daemon is already known to be running.  If the daemon dies, the
		// next BrokerTerminalRuntime HTTP request will fail; callers should
		// then call invalidateBrokerRuntime() so a subsequent
		// ensureDaemonRuntime() will re-probe and discover the daemon is down.
		if (this.brokerRuntime) return true;

		// Terminal commands only need the terminal broker endpoint. The full
		// /health check can be slow because it runs non-critical checks such as
		// CDP, so probe terminal readiness first to avoid false auto-starts.
		const initialConfig = loadConfig({ validate: false });
		const initialBrokerUrl = `http://127.0.0.1:${initialConfig.brokerPort}`;
		if (await probeTerminalReadiness(initialBrokerUrl)) {
			this.brokerRuntime = new BrokerTerminalRuntime({
				brokerUrl: initialBrokerUrl,
				apiKey: initialConfig.brokerAuthKey ?? null,
			});
			return true;
		}

		// Probe daemon health, then verify terminal readiness.
		// Two-stage probe prevents the race where /health responds but
		// the terminal broker path is not yet wired up.
		const { running, brokerUrl } = await probeDaemonHealth(initialConfig);
		if (running) {
			// Verify terminal readiness before caching the runtime.
			// If the terminal endpoint isn't ready yet, wait briefly and retry.
			const maxTerminalRetries = 10;
			const terminalRetryDelayMs = 500;
			let termReady = false;
			for (let i = 1; i <= maxTerminalRetries; i++) {
				termReady = await probeTerminalReadiness(brokerUrl);
				if (termReady) break;
				await new Promise((resolve) =>
					setTimeout(resolve, terminalRetryDelayMs),
				);
			}

			if (termReady) {
				const config = loadConfig({ validate: false });
				this.brokerRuntime = new BrokerTerminalRuntime({
					brokerUrl,
					apiKey: config.brokerAuthKey ?? null,
				});
				return true;
			}
			// Health OK but terminal not ready — don't cache a broken runtime.
			// Return false so the caller falls back to LocalTerminalRuntime.
			log.warn(
				"Daemon health OK but terminal endpoint not ready after retries",
			);
			return false;
		}

		// Daemon not reachable — clear stale cache
		this.brokerRuntime = null;

		// If autoStart is requested, try to spawn the daemon
		if (options.autoStart) {
			try {
				const path = await import("node:path");
				const { getPidFilePath } = await import("./shared/paths");
				const fs = await import("node:fs");

				const daemonProcess = spawnDaemonProcess({
					detached: true,
				});

				// Wait to detect immediate crashes. On Windows with ts-node
				// compilation, the daemon can take several seconds just to
				// compile, so we use a generous timeout before assuming it's
				// healthy enough to continue.
				const errorChunks: Buffer[] = [];
				daemonProcess.stderr?.on("data", (chunk: Buffer) =>
					errorChunks.push(chunk),
				);

				const startupTimeout = 8000;
				const exited = await new Promise<boolean>((resolve) => {
					daemonProcess.on("exit", () => resolve(true));
					setTimeout(() => resolve(false), startupTimeout);
				});

				if (exited) {
					const errorOutput = Buffer.concat(errorChunks).toString("utf8");
					log.warn("Daemon auto-start failed", {
						error: errorOutput || "Process exited immediately",
					});
					// Clean up the child process handle — daemon is already dead,
					// but the stderr pipe and listeners still hold references.
					daemonProcess.stderr?.destroy();
					daemonProcess.removeAllListeners();
					return false;
				}

				// Daemon process is running — detach and persist PID.
				// CRITICAL: destroy() the stderr stream to close the underlying
				// pipe file descriptor.  Without this, the open pipe handle keeps
				// the Node.js event loop alive, preventing the parent process from
				// exiting after the command completes (the cold-start hang bug).
				// removeAllListeners() alone is NOT sufficient — it removes the
				// data listeners but the pipe FD stays open.
				daemonProcess.stderr?.destroy();
				daemonProcess.removeAllListeners();
				const interopDir = path.dirname(getPidFilePath());
				if (!fs.existsSync(interopDir)) {
					fs.mkdirSync(interopDir, { recursive: true });
				}
				fs.writeFileSync(getPidFilePath(), String(daemonProcess.pid));
				daemonProcess.unref();

				// Probe with retries until the daemon is ready.
				// On Windows with ts-node, the daemon can take 10-20 seconds
				// to compile and initialize before the broker starts listening.
				//
				// We probe in two stages:
				//   1. probeDaemonHealth() — /api/v1/health responds (broker is listening)
				//   2. probeTerminalReadiness() — /api/v1/term/sessions responds
				//      (terminal session manager is initialized and ready)
				//
				// Stage 2 is critical: the daemon's broker can respond to /health
				// before the terminal session manager is fully wired up, causing
				// the first terminal action to fail with "fetch failed" even though
				// the health probe succeeded.
				const maxRetries = 30;
				const retryDelayMs = 1000;
				const spawnedConfig = loadConfig({ validate: false });
				const spawnedBrokerUrl = `http://127.0.0.1:${spawnedConfig.brokerPort}`;
				for (let attempt = 1; attempt <= maxRetries; attempt++) {
					const termReady = await probeTerminalReadiness(spawnedBrokerUrl);
					if (termReady) {
						this.brokerRuntime = new BrokerTerminalRuntime({
							brokerUrl: spawnedBrokerUrl,
							apiKey: spawnedConfig.brokerAuthKey ?? null,
						});
						log.info("Daemon auto-started and terminal-ready", {
							brokerUrl: spawnedBrokerUrl,
						});
						return true;
					}

					const healthResult = await probeDaemonHealth();
					if (healthResult.running) {
						// Stage 1 passed — broker is listening. Now verify terminal readiness.
						// Health OK but terminal not ready yet — keep retrying
						log.info("Daemon health OK but terminal not ready yet", {
							attempt,
						});
					}
					await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
				}

				log.warn(
					"Daemon auto-started but did not become terminal-ready in time",
				);
				return false;
			} catch (error: unknown) {
				log.warn("Daemon auto-start failed", {
					error: error instanceof Error ? error.message : String(error),
				});
				return false;
			}
		}

		return false;
	}

	// ── Session-aware Policy Evaluation ──────────────────────────────────

	/**
	 * Evaluate a policy action within a session context.
	 *
	 * Returns an ActionResult directly if the action is denied or requires
	 * confirmation. Returns a PolicyAllowResult if the action is allowed —
	 * callers MUST thread its metadata (policyDecision, risk, auditId, path)
	 * into their success ActionResult so the final result preserves the real
	 * policy metadata instead of hardcoding "allow".
	 */
	evaluateAction(
		action: string,
		params: Record<string, unknown>,
		sessionOverride?: string,
	): PolicyEvalResult {
		const state = this.resolveSession(sessionOverride);
		const sessionId = state?.id ?? this.activeSessionId ?? "default";
		const actor: "human" | "agent" = "human";
		const activeState = this.activeSessionId
			? (this.sessions.get(this.activeSessionId) ?? null)
			: null;
		const profileName =
			state?.policyProfile ??
			activeState?.policyProfile ??
			this.policyEngine.getActiveProfile();

		const intent: PolicyTaskIntent = {
			goal: action,
			actor,
			sessionId,
			metadata: { source: "action-surface" },
		};

		const step: RoutedStep = this.executionRouter.buildRoutedStep(
			intent,
			action,
			params,
			{
				sessionId,
				actor,
				profileName,
				cwd: state?.workingDirectory,
			},
		);

		// ── Issue 1 fix: Switch the policy engine to the session's profile ──
		// The DefaultPolicyEngine.evaluate() reads the active profile internally
		// via getRiskDecisionMatrix(this.profileName). Without switching, the
		// engine evaluates against whatever profile was last set globally,
		// NOT the active session's profile. This was a real bug: a "safe"
		// session still allowed fs_write the same way as "trusted".
		//
		// We save/restore the previous profile so that calling evaluateAction
		// does not permanently mutate the engine's global state.
		const previousProfile = this.policyEngine.getActiveProfile();
		if (profileName !== previousProfile) {
			try {
				this.policyEngine.setProfile(profileName);
			} catch {
				// If the profile name is invalid, fall back to the current profile
				// and let the evaluation proceed (it may still deny the action)
			}
		}

		let evaluation: import("./policy/types").PolicyEvaluationResult;
		try {
			evaluation = this.policyEngine.evaluate(step, {
				sessionId,
				actor,
				profileName,
				cwd: state?.workingDirectory,
			});
		} finally {
			// Always restore the previous profile, even if evaluation throws
			if (profileName !== previousProfile) {
				try {
					this.policyEngine.setProfile(previousProfile);
				} catch {
					// Best-effort restore; should not fail for a previously valid profile
				}
			}
		}

		log.info("Policy evaluation for action", {
			action,
			decision: evaluation.decision,
			risk: evaluation.risk,
			reason: evaluation.reason,
			sessionId,
			profileName,
		});

		if (evaluation.decision === "deny") {
			return policyDeniedResult(evaluation.reason, {
				path: step.path,
				sessionId,
				risk: evaluation.risk,
			});
		}

		if (evaluation.decision === "require_confirmation") {
			return confirmationRequiredResult(evaluation.reason, {
				path: step.path,
				sessionId,
				risk: evaluation.risk,
			});
		}

		// Action is allowed — record audit ID if applicable
		let auditId: string | undefined;
		if (evaluation.auditRequired && state) {
			auditId = `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
			state.auditIds.push(auditId);
			this.touchSession(state.id);
		}

		// Return rich allow result with REAL metadata
		return {
			allowed: true,
			policyDecision: evaluation.decision, // "allow" or "allow_with_audit"
			risk: evaluation.risk,
			auditId,
			path: step.path,
		};
	}

	// ── Session State Updates ─────────────────────────────────────────────

	/** Bind a browser connection to a session. */
	bindBrowser(sessionId: string, connectionId: string): void {
		const state = this.sessions.get(sessionId);
		if (state) {
			state.browserConnectionId = connectionId;
			this.touchSession(sessionId);
		}
	}

	/** Unbind the browser connection from a session. */
	unbindBrowser(sessionId: string): void {
		const state = this.sessions.get(sessionId);
		if (state) {
			state.browserConnectionId = null;
			this.touchSession(sessionId);
		}
	}

	private unbindBrowserConnection(connectionId: string): void {
		for (const state of this.sessions.values()) {
			if (state.browserConnectionId === connectionId) {
				state.browserConnectionId = null;
				this.touchSession(state.id);
			}
		}
	}

	/** Bind a terminal session to a session. */
	bindTerminal(sessionId: string, terminalId: string): void {
		const state = this.sessions.get(sessionId);
		if (state) {
			state.terminalSessionId = terminalId;
			this.touchSession(sessionId);
		}
	}

	/** Unbind the terminal session from a session. */
	unbindTerminal(sessionId: string): void {
		const state = this.sessions.get(sessionId);
		if (state) {
			state.terminalSessionId = null;
			this.touchSession(sessionId);
		}
	}

	/** Update the working directory for a session. */
	setWorkingDirectory(sessionId: string, cwd: string): void {
		const state = this.sessions.get(sessionId);
		if (state) {
			state.workingDirectory = cwd;
			this.touchSession(sessionId);
		}
	}

	// ── Internal Helpers ──────────────────────────────────────────────────

	private resolveSession(nameOrId?: string): SessionState | null {
		if (!nameOrId) {
			return this.activeSessionId
				? (this.sessions.get(this.activeSessionId) ?? null)
				: null;
		}
		// Try ID first
		const byId = this.sessions.get(nameOrId);
		if (byId) return byId;
		// Try name
		return (
			Array.from(this.sessions.values()).find((s) => s.name === nameOrId) ??
			null
		);
	}

	private touchSession(id: string): void {
		const state = this.sessions.get(id);
		if (state) {
			state.lastActivityAt = new Date().toISOString();
			this.persistSession(state);
		}
	}

	private persistSession(state: SessionState): void {
		try {
			this.memoryStore.set(`session:${state.id}`, state);
			if (this.activeSessionId === state.id) {
				this.memoryStore.set("session:active", { id: state.id });
			}
		} catch (error: unknown) {
			log.warn(
				`Failed to persist session state: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Load persisted sessions from MemoryStore into the in-memory map.
	 * This ensures that a new SessionManager instance (e.g., from a
	 * separate CLI invocation) can see sessions created by a previous one.
	 */
	private loadPersistedSessions(): void {
		try {
			// Load all session:* keys
			const sessionKeys = this.memoryStore.keys("session:");
			for (const key of sessionKeys) {
				// Skip the session:active marker
				if (key === "session:active") continue;

				const state = this.memoryStore.get<SessionState>(key);
				if (state?.id) {
					this.sessions.set(state.id, state);
				}
			}

			// Restore the active session
			const activeMarker = this.memoryStore.get<{ id: string }>(
				"session:active",
			);
			if (activeMarker?.id && this.sessions.has(activeMarker.id)) {
				this.activeSessionId = activeMarker.id;
				const activeState = this.sessions.get(activeMarker.id);
				if (activeState) {
					try {
						this.policyEngine.setProfile(activeState.policyProfile);
					} catch {
						/* best-effort */
					}
				}
			}

			if (this.sessions.size > 0) {
				log.info("Loaded persisted sessions", {
					count: this.sessions.size,
					activeId: this.activeSessionId,
				});
			}
		} catch (error: unknown) {
			log.warn(
				`Failed to load persisted sessions: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
}

// ── Default Singleton ──────────────────────────────────────────────────

let defaultManager: SessionManager | null = null;

export function getDefaultSessionManager(): SessionManager {
	if (!defaultManager) {
		defaultManager = new SessionManager();
	}
	return defaultManager;
}

export async function resetDefaultSessionManager(): Promise<void> {
	if (defaultManager) {
		await defaultManager.getTerminalManager().closeAll();
		defaultManager = null;
	}
}
