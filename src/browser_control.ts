/**
 * Browser Control — Top-level TypeScript API facade.
 *
 * This module provides `createBrowserControl(...)`, which returns a single
 * object with namespaced action methods for browser, terminal, filesystem,
 * and session operations.  The CLI and any future MCP wrapper (Section 7)
 * both call through this same surface.
 *
 * Usage:
 *   const bc = createBrowserControl();
 *   await bc.browser.open({ url: "https://example.com" });
 *   const snap = await bc.browser.snapshot();
 *   await bc.terminal.exec({ command: "ls" });
 *   const file = await bc.fs.read({ path: "/tmp/data.json" });
 */

import type { A11ySnapshot } from "./a11y_snapshot";
import {
	type BrowserActOptions,
	type BrowserActionContext,
	BrowserActions,
	type BrowserCloseResult,
	type BrowserLaunchResult,
	type BrowserStateResult,
	type DropOptions,
	type HighlightOptions,
	type LocatorCandidate,
	type ScreenshotResult,
	type TaskRunResult,
	type TaskStep,
} from "./browser/actions";
import type {
	AttachableBrowser,
	BrowserDetachResult,
	BrowserDropResult,
	BrowserTargetType,
} from "./browser/connection";
import type { ExtendedDownloadResult } from "./browser/file_helpers";
import { type FsActionContext, FsActions } from "./filesystem/actions";
import type {
	DeleteResult,
	FileReadResult,
	FileStatResult,
	FileWriteResult,
	ListResult,
	MoveResult,
} from "./filesystem/operations";
import type {
	DebugReceipt,
	ScreencastOptions,
	ScreencastSession,
} from "./observability/types";
import { collectStatus } from "./operator/status";
import type { SystemStatus } from "./operator/types";
import { DefaultPolicyEngine } from "./policy/engine";
import type {
	ProviderListResult,
	ProviderSelectionResult,
} from "./providers/types";
import { checkProviderHealth, type ProviderHealthReport } from "./providers/health";
import type { ProviderCatalogEntry } from "./providers/types";
import {
	LocalhostProxyManager,
	type LocalhostProxyStartResult,
	type LocalhostProxyStatus,
} from "./proxy_manager";
import { type ServiceActionContext, ServiceActions } from "./service_actions";
import type { ServiceEntry } from "./services/registry";
import { ServiceRegistry } from "./services/registry";
import {
	isPolicyAllowed,
	type PolicyAllowResult,
	type SessionCleanupSummary,
	type SessionListEntry,
	SessionManager,
	type SessionState,
} from "./session_manager";
import { getStateStorage } from "./state/index";
import {
	type ActionResult,
	failureResult,
	successResult,
} from "./shared/action_result";
import {
	type ConfigEntry,
	type ConfigSetResult,
	getDashboardConfigMutationError,
	getConfigEntries,
	getConfigValue,
	setUserConfigValue,
} from "./shared/config";
import {
	type TerminalActionContext,
	TerminalActions,
} from "./terminal/actions";
import type { ExecResult, TerminalSnapshot } from "./terminal/types";

// ── Options ──────────────────────────────────────────────────────────

export interface BrowserControlOptions {
	/** Policy profile name (default: from config). */
	policyProfile?: string;
	/** Working directory for filesystem context. */
	workingDirectory?: string;
	/** Custom data home directory (Section 30). */
	dataHome?: string;
	/** Memory store instance (for testing / dependency injection). */
	memoryStore?: import("./runtime/memory_store").MemoryStore;
}

// ── Screencast Namespace (Section 26) ─────────────────────────────────────

export interface ScreencastNamespace {
	start(
		options?: ScreencastOptions,
	): Promise<ActionResult<{ session: ScreencastSession }>>;
	stop(): Promise<
		ActionResult<{
			session: ScreencastSession;
			receiptId?: string;
			timelinePath?: string;
		}>
	>;
	status(): Promise<ActionResult<{ session: ScreencastSession | null }>>;
}

// ── Browser Namespace ────────────────────────────────────────────────

export interface BrowserNamespace {
	open(options: {
		url: string;
		waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
	}): Promise<ActionResult<{ url: string; title: string }>>;
	navigate(options: {
		url: string;
		waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
		tabId?: string;
	}): Promise<ActionResult<{ url: string; title: string; tabId: string }>>;
	openMany(items: import("./browser/actions").OpenManyItem[]): Promise<ActionResult<{ browserSessionId: string; tabs: import("./browser/actions").OpenManyTabResult[] }>>;
	capture(options?: {
		tabId?: string;
		snapshot?: boolean;
		screenshot?: boolean;
		fullPage?: boolean;
	}): Promise<ActionResult<import("./browser/actions").CaptureResult>>;
	captureMany(
		tabIds: string[],
		options?: {
			snapshot?: boolean;
			screenshot?: boolean;
			fullPage?: boolean;
		},
	): Promise<ActionResult<{ captures: import("./browser/actions").CaptureResult[] }>>;
	snapshot(options?: {
		rootSelector?: string;
		boxes?: boolean;
		tabId?: string;
	}): Promise<ActionResult<A11ySnapshot>>;
	click(options: {
		target: string;
		timeoutMs?: number;
		force?: boolean;
		tabId?: string;
	}): Promise<ActionResult<{ clicked: string; tabId: string }>>;
	fill(options: {
		target: string;
		text: string;
		timeoutMs?: number;
		commit?: boolean;
		tabId?: string;
	}): Promise<ActionResult<{ filled: string; tabId: string }>>;
	fillMany(
		fields: import("./browser/actions").FillField[],
		options?: import("./browser/actions").FillManyOptions,
	): Promise<
		ActionResult<{
			tabId: string;
			fields: import("./browser/actions").FillManyFieldResult[];
		}>
	>;
	hover(options: {
		target: string;
		timeoutMs?: number;
		tabId?: string;
	}): Promise<ActionResult<{ hovered: string; tabId: string }>>;
	type(options: {
		text: string;
		delayMs?: number;
		tabId?: string;
	}): Promise<ActionResult<{ typed: string; tabId: string }>>;
	paste(options: {
		text: string;
		target?: string;
		timeoutMs?: number;
		tabId?: string;
	}): Promise<ActionResult<{ pasted: string; tabId: string }>>;
	press(options: { key: string; tabId?: string }): Promise<ActionResult<{ pressed: string; tabId: string }>>;
	scroll(options: {
		direction: "up" | "down" | "left" | "right";
		amount?: number;
		tabId?: string;
	}): Promise<ActionResult<{ scrolled: string; tabId: string }>>;
	screenshot(options?: {
		copyTo?: string;
		outputPath?: string;
		fullPage?: boolean;
		target?: string;
		annotate?: boolean;
		refs?: string[];
		tabId?: string;
	}): Promise<ActionResult<ScreenshotResult>>;
	highlight(
		options: HighlightOptions,
	): Promise<ActionResult<{ highlighted: string; tabId: string }>>;
	generateLocator(
		target: string,
		options?: { tabId?: string },
	): Promise<ActionResult<{ candidates: LocatorCandidate[]; tabId: string }>>;
	dialog(options: {
		action: "list" | "respond";
		dialog_id?: string;
		response?: "accept" | "dismiss";
		text?: string;
		tabId?: string;
	}): Promise<ActionResult<{ dialogs: import("./browser/dialogs").DialogInfo[]; tabId?: string } | (import("./browser/dialogs").DialogResponse & { tabId?: string })>>;
	cdp(options: {
		method: string;
		params?: Record<string, unknown>;
		targetId?: string;
		frameId?: string;
		timeoutMs: number;
		tabId?: string;
	}): Promise<ActionResult<{ result: unknown; tabId: string }>>;
	tabList(): Promise<
		ActionResult<Array<{ id: string; url: string; title: string }>>
	>;
	tabSwitch(tabId: string): Promise<ActionResult<{ activeTabId: string; url: string; title?: string; readyState?: string }>>;
	tabClose(options?: { tabId?: string }): Promise<ActionResult<{ closed: boolean; tabId?: string }>>;
	close(): Promise<ActionResult<BrowserCloseResult>>;
	provider: ProviderNamespace;
	/** Screencast recording namespace (Section 26). */
	screencast: ScreencastNamespace;
	/** Section 27: Browser discovery and attach UX. */
	list(options?: { all?: boolean }): Promise<ActionResult<AttachableBrowser[]>>;
	/** Section 27: Explicit attach to CDP endpoint. */
	attach(options: {
		cdp?: string;
		endpoint?: string;
		port?: number;
		targetType?: string;
	}): Promise<ActionResult<{ attached: boolean; endpoint: string }>>;
	/** Section 27: Clean detach without closing attached browsers. */
	detach(): Promise<ActionResult<BrowserDetachResult>>;
	/** Section 27: Launch a managed browser. */
	launch(options?: {
		port?: number;
		profile?: "system" | "isolated";
		provider?: string;
	}): Promise<ActionResult<BrowserLaunchResult>>;
	/** Section 27: Drop files or data onto page elements. */
	drop(options: DropOptions): Promise<ActionResult<BrowserDropResult>>;
	/** Section 27: List recent downloads. */
	downloads: {
		list(): Promise<ActionResult<ExtendedDownloadResult[]>>;
	};
	/** Section 31: Collect all current browser state in one call. */
	state(options?: {
		tabId?: string;
		snapshot?: boolean;
		screenshot?: boolean;
		fullPage?: boolean;
		dialog?: boolean;
		downloads?: boolean;
	}): Promise<ActionResult<BrowserStateResult>>;
	/** Section 31: Perform any action with optional post-action capture. */
	act(options: BrowserActOptions): Promise<ActionResult<Record<string, unknown>>>;
	/** Section 31: Execute a deterministic multi-step browser task sequence. */
	taskRun(options: {
		steps: TaskStep[];
		continueOnFailure?: boolean;
	}): Promise<ActionResult<TaskRunResult>>;
}

// ── Terminal Namespace ───────────────────────────────────────────────

export interface TerminalNamespace {
	open(options?: {
		shell?: string;
		cwd?: string;
		name?: string;
		cols?: number;
		rows?: number;
	}): Promise<
		ActionResult<{ id: string; shell: string; cwd: string; status: string }>
	>;
	exec(options: {
		command: string;
		sessionId?: string;
		timeoutMs?: number;
	}): Promise<ActionResult<ExecResult>>;
	type(options: {
		text: string;
		sessionId: string;
		submit?: boolean;
	}): Promise<ActionResult<{ typed: string }>>;
	read(options: {
		sessionId: string;
		maxBytes?: number;
	}): Promise<ActionResult<{ output: string }>>;
	snapshot(options?: {
		sessionId?: string;
	}): Promise<ActionResult<TerminalSnapshot | TerminalSnapshot[]>>;
	interrupt(options: {
		sessionId: string;
	}): Promise<ActionResult<{ interrupted: boolean }>>;
	close(options: {
		sessionId: string;
	}): Promise<ActionResult<{ closed: boolean }>>;
	/** Resume a terminal session from persisted state (Section 13). */
	resume(options: { sessionId: string }): Promise<ActionResult<unknown>>;
	/** Get resume status for a terminal session (Section 13). */
	status(options: { sessionId: string }): Promise<ActionResult<unknown>>;
	/** Resize a terminal session (Section 13). */
	resize(options: {
		sessionId: string;
		cols: number;
		rows: number;
	}): Promise<ActionResult<{ resized: boolean }>>;
	/** Subscribe to terminal output data (Section 13). */
	onOutput(listener: (sessionId: string, data: string) => void): {
		dispose(): void;
	};
}

// ── FS Namespace ─────────────────────────────────────────────────────

export interface FsNamespace {
	read(options: {
		path: string;
		maxBytes?: number;
	}): Promise<ActionResult<FileReadResult>>;
	write(options: {
		path: string;
		content: string;
		createDirs?: boolean;
	}): Promise<ActionResult<FileWriteResult>>;
	writeOutput(options: {
		filename: string;
		content: string;
	}): Promise<ActionResult<FileWriteResult>>;
	ls(options: {
		path: string;
		includeHidden?: boolean;
		recursive?: boolean;
		extension?: string;
	}): Promise<ActionResult<ListResult>>;
	move(options: {
		src: string;
		dst: string;
	}): Promise<ActionResult<MoveResult>>;
	rm(options: {
		path: string;
		recursive?: boolean;
		force?: boolean;
	}): Promise<ActionResult<DeleteResult>>;
	stat(options: { path: string }): Promise<ActionResult<FileStatResult>>;
}

// ── Service Namespace ─────────────────────────────────────────────────

export interface ServiceNamespace {
	register(options: {
		name: string;
		port: number;
		protocol?: "http" | "https";
		path?: string;
	}): Promise<ActionResult<ServiceEntry>>;
	list(): ActionResult<ServiceEntry[]>;
	resolve(options: {
		name: string;
	}): Promise<ActionResult<{ url: string; service?: ServiceEntry }>>;
	remove(options: { name: string }): ActionResult<{ removed: boolean }>;
	proxy: {
		start(options?: {
			port?: number;
			allowRemote?: boolean;
			https?: boolean;
			certPath?: string;
			keyPath?: string;
			localCa?: boolean;
			caDir?: string;
		}): Promise<ActionResult<LocalhostProxyStartResult>>;
		stop(): Promise<ActionResult<{ stopped: boolean }>>;
		status(): ActionResult<LocalhostProxyStatus>;
	};
}

// ── Session Namespace ─────────────────────────────────────────────────

export interface SessionNamespace {
	create(
		name: string,
		options?: {
			policyProfile?: string;
			workingDirectory?: string;
			policyProfileEscalationConfirmed?: boolean;
		},
	): Promise<ActionResult<SessionState>>;
	list(): ActionResult<SessionListEntry[]>;
	use(nameOrId: string): ActionResult<SessionState>;
	status(nameOrId?: string): ActionResult<SessionState>;
	destroy(nameOrId: string): Promise<ActionResult<SessionCleanupSummary>>;
	cleanup(): Promise<ActionResult<SessionCleanupSummary>>;
}

// ── Provider Namespace ────────────────────────────────────────────────

export interface ProviderNamespace {
	list(): ProviderListResult;
	catalog(): ActionResult<ProviderCatalogEntry[]>;
	use(name: string): ActionResult<ProviderSelectionResult>;
	getActive(): string;
	health(name?: string): Promise<ActionResult<ProviderHealthReport[]>>;
}

// ── Debug Namespace (Section 10) ──────────────────────────────────────

export interface DebugNamespace {
	/** Run health checks across all components. */
	health(options?: {
		port?: number;
	}): Promise<import("./runtime/health_check").HealthReport>;
	/** Get a debug bundle by ID. */
	bundle(
		bundleId: string,
	): import("./observability/debug_bundle").DebugBundle | null;
	/** Get captured console entries for a session. */
	console(options?: {
		sessionId?: string;
	}): import("./observability/types").ConsoleEntry[];
	/** Get captured network entries for a session. */
	network(options?: {
		sessionId?: string;
	}): import("./observability/types").NetworkEntry[];
	/** List available debug bundles. */
	listBundles(): Array<{
		bundleId: string;
		taskId: string;
		assembledAt: string;
		partial: boolean;
	}>;
	/** Get a debug receipt by ID (Section 26). */
	receipt(receiptId: string): DebugReceipt | null;
}

// ── Config Namespace ──────────────────────────────────────────────────

export interface ConfigNamespace {
	list(): ConfigEntry[];
	get(key: string): ConfigEntry;
	set(key: string, value: unknown): ActionResult<ConfigSetResult>;
}

// ── Dashboard Namespace (Section 28) ──────────────────────────────────

export interface DashboardNamespace {
	status(): Promise<import("./operator/dashboard").DashboardState>;
}

// ── Workflow Namespace (Section 29) ───────────────────────────────────

export interface WorkflowNamespace {
	run(graphJson: string): Promise<ActionResult>;
	runs(): ActionResult<import("./workflows/types").WorkflowRun[]>;
	status(runId: string): ActionResult;
	resume(runId: string): Promise<ActionResult>;
	approve(runId: string, nodeId: string, approvedBy?: string): ActionResult;
	cancel(runId: string): ActionResult;
	events(runId: string): ActionResult;
	editState(runId: string, key: string, value: string | number | boolean): ActionResult;
}

// ── Harness Namespace (Section 29) ────────────────────────────────────

export interface HarnessNamespace {
	list(): ActionResult;
	find(query: {
		domain?: string;
		taskTag?: string;
		failureType?: string;
	}): ActionResult;
	validate(helperId: string): ActionResult;
	rollback(helperId: string, version: string): ActionResult;
	generate(input: {
		id: string;
		purpose: string;
		files: Array<{ path: string; content: string }>;
		taskTags?: string[];
		failureTypes?: string[];
		site?: string;
		domains?: string[];
		usage?: string;
		version?: string;
		testCommand?: string;
		activate?: boolean;
	}): Promise<ActionResult>;
	execute(helperId: string, input?: Record<string, unknown>): Promise<ActionResult>;
}

// ── Package Namespace (Section 30) ────────────────────────────────────

export interface PackageNamespace {
	install(
		source: string,
	): Promise<
		ActionResult<import("./packages/types").InstalledAutomationPackage>
	>;
	list(): ActionResult<import("./packages/types").InstalledAutomationPackage[]>;
	info(
		name: string,
	): ActionResult<import("./packages/types").InstalledAutomationPackage>;
	remove(name: string): ActionResult<{ removed: boolean }>;
	update(
		name: string,
		source?: string,
	): Promise<
		ActionResult<import("./packages/types").InstalledAutomationPackage>
	>;
	grantPermission(
		name: string,
		permissionRef: string | number,
	): ActionResult<{ granted: boolean }>;
	run(name: string, workflowNameOrId?: string): Promise<ActionResult>;
	eval(
		name: string,
	): Promise<ActionResult<import("./packages/types").PackageEvalResult[]>>;
	review(
		name: string,
		status: import("./packages/types").TrustReviewStatus,
		reviewedBy: string,
		reason?: string,
	): ActionResult<{ success: boolean; record?: import("./packages/types").TrustReviewRecord }>;
	reviewHistory(name: string): ActionResult<import("./packages/types").TrustReviewRecord[]>;
	evalHistory(name?: string): ActionResult<import("./packages/types").PackageEvalRecord[]>;
}

// ── Benchmark Namespace (Section 16) ─────────────────────────────────

export interface BenchmarkNamespace {
	run(options?: {
		suite?: import("./benchmarks/types").BenchmarkSuiteName;
		iterations?: number;
	}): Promise<import("./benchmarks/types").BenchmarkRunOutput>;
	results(options?: {
		last?: number;
	}): import("./benchmarks/types").BenchmarkRunRecord[];
	compare(
		baseRunId: string,
		compareRunId: string,
	): import("./benchmarks/types").BenchmarkComparison;
}

// ── Unified API Object ────────────────────────────────────────────────

export interface BrowserControlAPI {
	browser: BrowserNamespace;
	terminal: TerminalNamespace;
	fs: FsNamespace;
	session: SessionNamespace;
	service: ServiceNamespace;
	provider: ProviderNamespace;
	/** Debug and observability namespace (Section 10). */
	debug: DebugNamespace;
	/** Runtime configuration namespace (Section 11). */
	config: ConfigNamespace;
	/** Dashboard and UI rendering namespace (Section 28). */
	dashboard: DashboardNamespace;
	/** Workflow graph runtime namespace (Section 29). */
	workflow: WorkflowNamespace;
	/** Self-healing harness namespace (Section 29). */
	harness: HarnessNamespace;
	/** Automation packages namespace (Section 30). */
	package: PackageNamespace;
	/** Product benchmark namespace (Section 16). */
	benchmark: BenchmarkNamespace;
	/** Durable product state storage (Section 4). */
	state: import("./state/index").StateStorage;
	/** Collect operator-facing system status (Section 11). */
	status(): Promise<SystemStatus>;
	/** Access the underlying session manager for advanced use. */
	readonly sessionManager: SessionManager;
	/** Access the underlying browser actions instance. */
	readonly browserActions: BrowserActions;
	/** Access the underlying terminal actions instance. */
	readonly terminalActions: TerminalActions;
	/** Access the underlying fs actions instance. */
	readonly fsActions: FsActions;
	/** Access the underlying service actions instance. */
	readonly serviceActions: ServiceActions;
	/**
	 * Close the BrowserControl instance and release all held resources.
	 *
	 * This is critical for process lifecycle management: after calling
	 * terminal.open() (which is daemon-backed), the SessionManager's
	 * MemoryStore keeps a SQLite handle alive that prevents the Node.js
	 * event loop from exiting. Calling close() releases that handle so
	 * the process can exit cleanly.
	 *
	 * Call this at the end of any short-lived script that uses the API.
	 */
	close(): void;
}

// ── Factory ──────────────────────────────────────────────────────────

/**
 * Create a Browser Control API instance.
 *
 * This is the main entry point for the programmatic TypeScript API.
 * The returned object provides namespaced action methods that route
 * through policy, return ActionResult, and bind to a unified session.
 *
 * Section 7 (MCP) will wrap this exact object 1:1.
 */
export function createBrowserControl(
	options: BrowserControlOptions = {},
): BrowserControlAPI {
	// If a policy profile was specified, create a policy engine with that profile
	const policyEngine = options.policyProfile
		? new DefaultPolicyEngine({ profileName: options.policyProfile })
		: undefined;

	const sessionManager = new SessionManager({
		memoryStore: options.memoryStore,
		policyEngine,
	});

	// ── Pre-warm daemon runtime (optional optimization) ─────────────
	// TerminalActions.ensureDaemonRuntimeReady() probes the daemon before
	// every session-dependent action, so this fire-and-forget call is NOT
	// a correctness requirement — it's a pre-warm that may settle the
	// broker runtime cache before the first terminal action, saving an
	// HTTP round-trip on that first call.  If it hasn't settled yet,
	// ensureDaemonRuntimeReady() will handle it.
	sessionManager.ensureDaemonRuntime({ autoStart: false }).catch(() => {
		// Ignore — pre-warm failed, ensureDaemonRuntimeReady() will retry
	});

	const sharedRegistry = new ServiceRegistry();

	const browserCtx: BrowserActionContext = {
		sessionManager,
		serviceRegistry: sharedRegistry,
	};
	// Terminal actions use autoStartDaemon: true so that persistent terminal
	// sessions (open, read, type, etc.) are daemon-backed, aligning the API
	// with the CLI ownership model. This prevents the API process from
	// hanging after terminal.open() due to an in-process PTY.
	const terminalCtx: TerminalActionContext = {
		sessionManager,
		autoStartDaemon: true,
	};
	const fsCtx: FsActionContext = { sessionManager };
	const serviceCtx: ServiceActionContext = {
		sessionManager,
		registry: sharedRegistry,
	};

	const browserActions = new BrowserActions(browserCtx);
	const terminalActions = new TerminalActions(terminalCtx);
	const fsActions = new FsActions(fsCtx);
	const serviceActions = new ServiceActions(serviceCtx);
	let localhostProxy: LocalhostProxyManager | null = null;

	const requireDebugPolicy = (
		action: string,
		params: Record<string, unknown> = {},
	) => {
		const policyEval = sessionManager.evaluateAction(action, params);
		if (!isPolicyAllowed(policyEval)) {
			throw new Error(policyEval.error ?? `Policy blocked ${action}`);
		}
		return policyEval;
	};

	const providerNamespace: ProviderNamespace = {
		list: () => sessionManager.getBrowserManager().getProviderRegistry().list(),
		catalog: () => {
			const policyEval = sessionManager.evaluateAction("browser_provider_catalog", {});
			if (!isPolicyAllowed(policyEval))
				return policyEval as ActionResult<ProviderCatalogEntry[]>;
			return {
				success: true,
				path: policyEval.path,
				sessionId: sessionManager.getActiveSession()?.id ?? "default",
				data: sessionManager
					.getBrowserManager()
					.getProviderRegistry()
					.catalog(),
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				...(policyEval.auditId ? { auditId: policyEval.auditId } : {}),
				completedAt: new Date().toISOString(),
			};
		},
		use: (name) => {
			const policyEval = sessionManager.evaluateAction("browser_provider_use", {
				name,
			});
			if (!isPolicyAllowed(policyEval))
				return policyEval as ActionResult<ProviderSelectionResult>;
			const result = sessionManager
				.getBrowserManager()
				.getProviderRegistry()
				.select(name);
			return {
				success: result.success,
				path: policyEval.path,
				sessionId: sessionManager.getActiveSession()?.id ?? "default",
				data: result,
				...(result.error ? { error: result.error } : {}),
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				...(policyEval.auditId ? { auditId: policyEval.auditId } : {}),
				completedAt: new Date().toISOString(),
			};
		},
		getActive: () =>
			sessionManager.getBrowserManager().getProviderRegistry().getActiveName(),
		health: async (name) => {
			const policyEval = sessionManager.evaluateAction("browser_provider_health", {
				name,
			});
			if (!isPolicyAllowed(policyEval))
				return policyEval as ActionResult<ProviderHealthReport[]>;
			const registry = sessionManager.getBrowserManager().getProviderRegistry();
			const listed = registry.list();
			const names = name
				? [name]
				: [...new Set([...listed.builtIn, ...listed.providers.map((p) => p.name)])];
			const reports = [];
			for (const providerName of names) {
				const config = registry.get(providerName);
				if (config) reports.push(await checkProviderHealth(config));
			}
			return {
				success: true,
				path: policyEval.path,
				sessionId: sessionManager.getActiveSession()?.id ?? "default",
				data: reports,
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				...(policyEval.auditId ? { auditId: policyEval.auditId } : {}),
				completedAt: new Date().toISOString(),
			};
		},
	};
	const configNamespace: ConfigNamespace = {
		list: () => getConfigEntries({ validate: false }),
		get: (key) => getConfigValue(key, { validate: false }),
		set: (key, value) => {
			const dashboardMutationError = getDashboardConfigMutationError(key);
			if (dashboardMutationError) {
				return failureResult<ConfigSetResult>(dashboardMutationError, {
					path: "command",
					sessionId: sessionManager.getActiveSession()?.id ?? "default",
				});
			}
			const policyEval = sessionManager.evaluateAction("config_set", {
				key,
				value,
			});
			if (!isPolicyAllowed(policyEval))
				return policyEval as ActionResult<ConfigSetResult>;
			const result = setUserConfigValue(key, value);
			return {
				success: true,
				path: policyEval.path,
				sessionId: sessionManager.getActiveSession()?.id ?? "default",
				data: result,
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				...(policyEval.auditId ? { auditId: policyEval.auditId } : {}),
				completedAt: new Date().toISOString(),
			};
		},
	};

	const debugNamespace: DebugNamespace = {
		health: async (options = {}) => {
			requireDebugPolicy("debug_health", options);
			const { HealthCheck } = await import("./runtime/health_check");
			const healthCheck = new HealthCheck({
				port: options.port,
				memoryStore: sessionManager.getMemoryStore(),
			});
			return healthCheck.runExtended();
		},
		bundle: (bundleId) => {
			requireDebugPolicy("debug_bundle_export", { bundleId });
			const { loadDebugBundle } = require("./observability/debug_bundle");
			return loadDebugBundle(bundleId, sessionManager.getMemoryStore());
		},
		console: (options = {}) => {
			requireDebugPolicy("debug_console_read", options);
			const {
				getGlobalConsoleCapture,
			} = require("./observability/console_capture");
			const capture = getGlobalConsoleCapture();
			return capture.getEntries(options.sessionId ?? "default");
		},
		network: (options = {}) => {
			requireDebugPolicy("debug_network_read", options);
			const {
				getGlobalNetworkCapture,
			} = require("./observability/network_capture");
			const capture = getGlobalNetworkCapture();
			const sessionId = options.sessionId ?? "default";
			const stored = capture.loadFromStore(sessionManager.getMemoryStore(), sessionId);
			const live = capture.getEntries(sessionId);
			const seen = new Set<string>();
			return [...stored, ...live].filter((entry) => {
				const key = [
					entry.timestamp,
					entry.method,
					entry.url,
					entry.status ?? "",
					entry.error ?? "",
				].join("|");
				if (seen.has(key)) return false;
				seen.add(key);
				return true;
			});
		},
		listBundles: () => {
			requireDebugPolicy("debug_bundle_export", { list: true });
			const { listDebugBundles } = require("./observability/debug_bundle");
			return listDebugBundles(sessionManager.getMemoryStore());
		},
		receipt: (receiptId) => {
			requireDebugPolicy("debug_receipt_export", { receiptId });
			const {
				getGlobalScreencastRecorder,
			} = require("./observability/screencast");
			const recorder = getGlobalScreencastRecorder(
				sessionManager.getMemoryStore(),
			);
			return recorder.loadReceipt(receiptId);
		},
	};

	const screencastNamespace: ScreencastNamespace = {
		start: (options) => browserActions.screencastStart(options),
		stop: () => browserActions.screencastStop(),
		status: () => browserActions.screencastStatus(),
	};

	const getActionSessionId = () =>
		sessionManager.getActiveSession()?.id ?? "system";

	const buildWorkflowRuntime = () => {
		const { WorkflowStore } = require("./workflows/store");
		const { WorkflowRuntime } = require("./workflows/runtime");
		const { HarnessRegistry } = require("./harness/registry");
		const store = new WorkflowStore(sessionManager.getMemoryStore());
		return new WorkflowRuntime(store, {
			sessionId: getActionSessionId(),
			terminalExec: (command: string, timeoutMs?: number) =>
				terminalActions.exec({ command, timeoutMs }),
			fsRead: (path: string) => fsActions.read({ path }),
			fsWrite: (path: string, content: string) =>
				fsActions.write({ path, content }),
			browserOpen: (url: string) => browserActions.open({ url }),
			browserClick: (target: string, timeoutMs?: number) =>
				browserActions.click({ target, timeoutMs }),
			browserFill: (target: string, text: string, timeoutMs?: number) =>
				browserActions.fill({ target, text, timeoutMs }),
			browserPress: (key: string) => browserActions.press({ key }),
			browserSnapshot: () => browserActions.takeSnapshot(),
			browserScreenshot: () => browserActions.screenshot(),
			secretResolver: async (
				secretRef: string,
				action: string,
				context: {
					sessionId?: string;
					packageName?: string;
					workflowId?: string;
				},
			) => {
				const policyEval = sessionManager.evaluateAction("secret_use", {
					secretRef: true,
					action,
					packageName: context.packageName,
					workflowId: context.workflowId,
				});
				if (!isPolicyAllowed(policyEval)) {
					return {
						success: false,
						id: secretRef,
						error: `Policy denied secret use: ${policyEval.error ?? "denied"}`,
					};
				}
				const { CredentialVault } = require("./security/credential_vault");
				const vault = new CredentialVault(getStateStorage(options.dataHome));
				const resolved = await vault.resolveForUse(secretRef, {
					action,
					sessionId: context.sessionId ?? getActionSessionId(),
					packageName: context.packageName,
					workflowId: context.workflowId,
					policyDecision: policyEval.policyDecision,
				});
				if (!resolved.success) {
					return { success: false, id: secretRef, error: resolved.error };
				}
				return {
					success: true,
					id: secretRef,
					value: resolved.value,
					grantId: resolved.grantId,
				};
			},
			verificationExecute: async (input: Record<string, unknown>) => {
				const actual = input.actual ?? input.expression;
				const expected = input.expected;
				const passed =
					input.passed === true || String(actual) === String(expected);
				return passed
					? successResult(
							{ actual, expected, passed },
							{ path: "command", sessionId: getActionSessionId() },
						)
					: failureResult(
							`Verification failed: expected "${String(expected)}" but got "${String(actual)}"`,
							{
								path: "command",
								sessionId: getActionSessionId(),
							},
						);
			},
			helperExecute: async (helperId: string) => {
				const registry = new HarnessRegistry();
				const helper = registry.get(helperId);
				if (!helper) {
					return failureResult(`Helper not found: ${helperId}`, {
						path: "command",
						sessionId: getActionSessionId(),
					});
				}
				if (!helper.activated) {
					return failureResult(`Helper is not activated: ${helperId}`, {
						path: "command",
						sessionId: getActionSessionId(),
					});
				}
				const validation = registry.validate(helperId);
				if (validation.status !== "passed") {
					return failureResult(`Helper validation failed: ${helperId}`, {
						path: "command",
						sessionId: getActionSessionId(),
					});
				}
				return successResult(
					{ helperId, helper, validation },
					{ path: "command", sessionId: getActionSessionId() },
				);
			},
		});
	};

	const evaluateActionPolicy = <T>(
		action: string,
		params: Record<string, unknown>,
	):
		| { blocked: ActionResult<T>; policy?: never }
		| { blocked: null; policy: PolicyAllowResult } => {
		const policyEval = sessionManager.evaluateAction(action, params);
		if (!isPolicyAllowed(policyEval))
			return { blocked: policyEval as ActionResult<T> };
		return { blocked: null, policy: policyEval };
	};

	const attachPolicy = <T>(
		result: ActionResult<T>,
		policy: PolicyAllowResult,
	): ActionResult<T> => {
		return {
			...result,
			path: policy.path,
			sessionId: getActionSessionId(),
			...(policy.auditId ? { auditId: policy.auditId } : {}),
			policyDecision: policy.policyDecision,
			risk: policy.risk,
		};
	};

	const queueBrowserAction = <T>(
		actionName: string,
		run: () => Promise<ActionResult<T>>,
	): Promise<ActionResult<T>> => {
		return browserActions.runQueuedAction(actionName, run);
	};

	return {
		browser: {
			open: (o) => queueBrowserAction("browser_open", () => browserActions.open(o)),
			navigate: (o) => queueBrowserAction("browser_navigate", () => browserActions.navigate(o)),
			openMany: (items) => queueBrowserAction("browser_open_many", () => browserActions.openMany(items)),
			capture: (o) => queueBrowserAction("browser_capture", () => browserActions.capture(o)),
			captureMany: (ids, o) => queueBrowserAction("browser_capture_many", () => browserActions.captureMany(ids, o)),
			snapshot: (o) => queueBrowserAction("browser_snapshot", () => browserActions.takeSnapshot(o)),
			click: (o) => queueBrowserAction("browser_click", () => browserActions.click(o)),
			fill: (o) => queueBrowserAction("browser_fill", () => browserActions.fill(o)),
			fillMany: (fields, options) => queueBrowserAction("browser_fill_many", () => browserActions.fillMany(fields, options)),
			hover: (o) => queueBrowserAction("browser_hover", () => browserActions.hover(o)),
			type: (o) => queueBrowserAction("browser_type", () => browserActions.type(o)),
			paste: (o) => queueBrowserAction("browser_paste", () => browserActions.paste(o)),
			press: (o) => queueBrowserAction("browser_press", () => browserActions.press(o)),
			scroll: (o) => queueBrowserAction("browser_scroll", () => browserActions.scroll(o)),
			screenshot: (o) => queueBrowserAction("browser_screenshot", () => browserActions.screenshot(o)),
			highlight: (o) => queueBrowserAction("browser_highlight", () => browserActions.highlight(o)),
			generateLocator: (target, options) => queueBrowserAction("browser_generate_locator", () => browserActions.generateLocator(target, options)),
			dialog: (o) => queueBrowserAction("browser_dialog", () => browserActions.dialog(o)),
			cdp: (o) => queueBrowserAction("browser_cdp", () => browserActions.cdp(o)),
			tabList: () => queueBrowserAction("browser_tab_list", () => browserActions.tabList()),
			tabSwitch: (id) => queueBrowserAction("browser_tab_switch", () => browserActions.tabSwitch(id)),
			tabClose: (options) => queueBrowserAction("browser_tab_close", () => browserActions.tabClose(options)),
			close: () => queueBrowserAction("browser_close", () => browserActions.close()),
			provider: providerNamespace,
			screencast: screencastNamespace,
			// Section 27: Browser discovery and attach UX
			list: async (options) => {
				const policyEval = sessionManager.evaluateAction(
					"browser_list",
					options ?? {},
				);
				if (!isPolicyAllowed(policyEval))
					return policyEval as ActionResult<AttachableBrowser[]>;
				const localProvider = new (
					await import("./providers/local")
				).LocalBrowserProvider();
				const browsers = await localProvider.discoverBrowsers(options);
				return {
					success: true,
					path: policyEval.path,
					sessionId: sessionManager.getActiveSession()?.id ?? "default",
					policyDecision: policyEval.policyDecision,
					risk: policyEval.risk,
					auditId: policyEval.auditId,
					data: browsers,
					completedAt: new Date().toISOString(),
				};
			},
			attach: async (options) => queueBrowserAction("browser_attach", async () => {
				const bm = sessionManager.getBrowserManager();
				const cdpUrl = options.cdp ?? options.endpoint;
				const result = await bm.attach({
					cdpUrl,
					port: options.port,
					targetType: options.targetType as BrowserTargetType | undefined,
				});
				return {
					success: true,
					path: "a11y",
					sessionId: sessionManager.getActiveSession()?.id ?? "default",
					data: { attached: true, endpoint: result.cdpEndpoint },
					completedAt: new Date().toISOString(),
				};
			}),
			detach: async () => queueBrowserAction("browser_detach", async () => {
				const policyEval = sessionManager.evaluateAction("browser_detach", {});
				if (!isPolicyAllowed(policyEval))
					return policyEval as ActionResult<BrowserDetachResult>;
				const bm = sessionManager.getBrowserManager();
				const result = await bm.detach();
				return {
					success: result.detached,
					path: policyEval.path,
					sessionId: sessionManager.getActiveSession()?.id ?? "default",
					policyDecision: policyEval.policyDecision,
					risk: policyEval.risk,
					auditId: policyEval.auditId,
					data: result,
					completedAt: new Date().toISOString(),
				};
			}),
			launch: async (options) => queueBrowserAction("browser_launch", async () => {
				const result = await browserActions.launch({
					port: options?.port,
					profile: options?.profile,
					provider: options?.provider,
				});
				return {
					...result,
					completedAt: new Date().toISOString(),
				};
			}),
			drop: (options) => queueBrowserAction("browser_drop", () => browserActions.drop(options)),
			downloads: {
				list: () => queueBrowserAction("browser_downloads_list", () => browserActions.downloadsList()),
			},
			state: (options) => queueBrowserAction("browser_state", () => browserActions.browserState(options)),
			act: (options) => queueBrowserAction(`browser_${options.action}`, () => browserActions.browserAct(options)),
			taskRun: async (options) => queueBrowserAction("browser_task_run", async () => {
				const result = await browserActions.taskRun({
					steps: options.steps,
					continueOnFailure: options.continueOnFailure,
					writeOutput: async (opts) => {
						const r = await fsActions.writeOutput({ filename: opts.filename, content: opts.content });
						return r as unknown as ActionResult<Record<string, unknown>>;
					},
				});
				return result;
			}),
		},
		terminal: {
			open: (o) => terminalActions.open(o),
			exec: (o) => terminalActions.exec(o),
			type: (o) => terminalActions.type(o),
			read: (o) => terminalActions.read(o),
			snapshot: (o) => terminalActions.snapshot(o),
			interrupt: (o) => terminalActions.interrupt(o),
			close: (o) => terminalActions.close(o),
			resume: (o) => terminalActions.resume(o),
			status: (o) => terminalActions.status(o),
			resize: (o) => terminalActions.resize(o),
			onOutput: (l) => terminalActions.onData(l),
		},
		fs: {
			read: (o) => fsActions.read(o),
			write: (o) => fsActions.write(o),
			writeOutput: (o) => fsActions.writeOutput(o),
			ls: (o) => fsActions.ls(o),
			move: (o) => fsActions.move(o),
			rm: (o) => fsActions.rm(o),
			stat: (o) => fsActions.stat(o),
		},
		session: {
			create: (name, o) => sessionManager.create(name, o),
			list: () => sessionManager.list(),
			use: (nameOrId) => sessionManager.use(nameOrId),
			status: (nameOrId) => sessionManager.status(nameOrId),
			destroy: (nameOrId) => sessionManager.destroy(nameOrId),
			cleanup: () => sessionManager.cleanupIdleSessions(),
		},
		service: {
			register: (o) => serviceActions.register(o),
			list: () => serviceActions.list(),
			resolve: (o) => serviceActions.resolve(o),
			remove: (o) => serviceActions.remove(o),
			proxy: {
				start: async (o = {}) => {
					const policyEval = sessionManager.evaluateAction("service_proxy_start", o);
					if (!isPolicyAllowed(policyEval)) {
						return policyEval as ActionResult<LocalhostProxyStartResult>;
					}
					try {
						localhostProxy ??= new LocalhostProxyManager({
							registry: sharedRegistry,
							reloadRegistryOnRequest: true,
							port: o.port ?? 0,
							allowRemote: o.allowRemote === true,
							https: o.https === true,
							certPath: o.certPath,
							keyPath: o.keyPath,
							localCa: o.localCa === true,
							caDir: o.caDir,
						});
						return successResult(await localhostProxy.start(), {
							path: policyEval.path,
							sessionId: sessionManager.getActiveSession()?.id ?? "default",
							policyDecision: policyEval.policyDecision,
							risk: policyEval.risk,
							auditId: policyEval.auditId,
						});
					} catch (error) {
						return failureResult(
							error instanceof Error ? error.message : String(error),
							{
								path: policyEval.path,
								sessionId: sessionManager.getActiveSession()?.id ?? "default",
								policyDecision: policyEval.policyDecision,
								risk: policyEval.risk,
								auditId: policyEval.auditId,
							},
						);
					}
				},
				stop: async () => {
					const policyEval = sessionManager.evaluateAction("service_proxy_stop", {});
					if (!isPolicyAllowed(policyEval)) {
						return policyEval as ActionResult<{ stopped: boolean }>;
					}
					await localhostProxy?.stop();
					localhostProxy = null;
					return successResult(
						{ stopped: true },
						{
							path: policyEval.path,
							sessionId: sessionManager.getActiveSession()?.id ?? "default",
							policyDecision: policyEval.policyDecision,
							risk: policyEval.risk,
							auditId: policyEval.auditId,
						},
					);
				},
				status: () => {
					const policyEval = sessionManager.evaluateAction("service_proxy_status", {});
					if (!isPolicyAllowed(policyEval)) {
						return policyEval as ActionResult<LocalhostProxyStatus>;
					}
					return successResult(
						localhostProxy?.getStatus() ?? {
							enabled: false,
							host: "127.0.0.1",
							httpsEnabled: false,
							allowRemote: false,
							activeConnections: 0,
						},
						{
							path: policyEval.path,
							sessionId: sessionManager.getActiveSession()?.id ?? "default",
							policyDecision: policyEval.policyDecision,
							risk: policyEval.risk,
							auditId: policyEval.auditId,
						},
					);
				},
			},
		},
		provider: providerNamespace,
		debug: debugNamespace,
		config: configNamespace,
		dashboard: {
			status: async () => {
				const { getDashboardState } = await import("./operator/dashboard");
				return getDashboardState();
			},
		},
		workflow: {
			run: async (graphJson: string) => {
				const policy = evaluateActionPolicy("workflow_run", { graphJson });
				if (policy.blocked) return policy.blocked;
				const runtime = buildWorkflowRuntime();
				let graph: unknown;
				try {
					graph = JSON.parse(graphJson);
				} catch {
					return attachPolicy(
						failureResult("Invalid workflow graph JSON", {
							path: "command",
							sessionId: getActionSessionId(),
						}),
						policy.policy,
					);
				}
				return attachPolicy(
					await runtime.run(graph as import("./workflows/types").WorkflowGraph),
					policy.policy,
				);
			},
			status: (runId: string) => {
				const policy = evaluateActionPolicy("workflow_status", { runId });
				if (policy.blocked) return policy.blocked;
				const runtime = buildWorkflowRuntime();
				return attachPolicy(runtime.status(runId), policy.policy);
			},
			runs: () => {
				const policy = evaluateActionPolicy("workflow_status", {});
				if (policy.blocked) {
					return policy.blocked as ActionResult<
						import("./workflows/types").WorkflowRun[]
					>;
				}
				const { WorkflowStore } = require("./workflows/store");
				const store = new WorkflowStore(sessionManager.getMemoryStore());
				return attachPolicy(
					successResult(store.listRuns(), {
						path: "command",
						sessionId: getActionSessionId(),
					}),
					policy.policy,
				);
			},
			resume: async (runId: string) => {
				const policy = evaluateActionPolicy("workflow_resume", { runId });
				if (policy.blocked) return policy.blocked;
				const runtime = buildWorkflowRuntime();
				return attachPolicy(await runtime.resume(runId), policy.policy);
			},
			approve: (runId: string, nodeId: string, approvedBy?: string) => {
				const policy = evaluateActionPolicy("workflow_approve", {
					runId,
					nodeId,
				});
				if (policy.blocked) return policy.blocked;
				const runtime = buildWorkflowRuntime();
				return attachPolicy(runtime.approve(runId, nodeId, approvedBy), policy.policy);
			},
			cancel: (runId: string) => {
				const policy = evaluateActionPolicy("workflow_cancel", { runId });
				if (policy.blocked) return policy.blocked;
				const runtime = buildWorkflowRuntime();
				return attachPolicy(runtime.cancel(runId), policy.policy);
			},
			events: (runId: string) => {
				const policy = evaluateActionPolicy("workflow_events", { runId });
				if (policy.blocked) return policy.blocked;
				const { WorkflowStore } = require("./workflows/store");
				const store = new WorkflowStore(sessionManager.getMemoryStore());
				const run = store.getRun(runId);
				if (!run) {
					return attachPolicy(
						failureResult(`Run not found: ${runId}`, {
							path: "command",
							sessionId: getActionSessionId(),
						}),
						policy.policy,
					);
				}
				return attachPolicy(
					successResult(run.events, {
						path: "command",
						sessionId: getActionSessionId(),
					}),
					policy.policy,
				);
			},
			editState: (runId: string, key: string, value: string | number | boolean) => {
				const policy = evaluateActionPolicy("workflow_edit_state", { runId, key });
				if (policy.blocked) return policy.blocked;
				const runtime = buildWorkflowRuntime();
				return attachPolicy(runtime.editState(runId, key, value), policy.policy);
			},
		},
		harness: {
			list: () => {
				const policy = evaluateActionPolicy("harness_list", {});
				if (policy.blocked) return policy.blocked;
				const { HarnessRegistry } = require("./harness/registry");
				const registry = new HarnessRegistry();
				return attachPolicy(
					successResult(registry.list(), {
						path: "command",
						sessionId: getActionSessionId(),
					}),
					policy.policy,
				);
			},
			find: (query) => {
				const policy = evaluateActionPolicy("harness_find", query);
				if (policy.blocked) return policy.blocked;
				const { HarnessRegistry } = require("./harness/registry");
				const registry = new HarnessRegistry();
				return attachPolicy(
					successResult(registry.find(query), {
						path: "command",
						sessionId: getActionSessionId(),
					}),
					policy.policy,
				);
			},
			validate: (helperId: string) => {
				const policy = evaluateActionPolicy("harness_validate", { helperId });
				if (policy.blocked) return policy.blocked;
				const { HarnessRegistry } = require("./harness/registry");
				const registry = new HarnessRegistry();
				const result = registry.validate(helperId);
				if (result.status === "passed") {
					return attachPolicy(
						successResult(result, {
							path: "command",
							sessionId: getActionSessionId(),
						}),
						policy.policy,
					);
				}
				return attachPolicy(
					failureResult(`Validation failed for ${helperId}`, {
						path: "command",
						sessionId: getActionSessionId(),
					}),
					policy.policy,
				);
			},
			rollback: (helperId: string, version: string) => {
				const policy = evaluateActionPolicy("harness_rollback", {
					helperId,
					version,
				});
				if (policy.blocked) return policy.blocked;
				const { HarnessRegistry } = require("./harness/registry");
				const registry = new HarnessRegistry();
				const result = registry.rollback(helperId, version);
				if (result.success) {
					return attachPolicy(
						successResult(result, {
							path: "command",
							sessionId: getActionSessionId(),
						}),
						policy.policy,
					);
				}
				return attachPolicy(
					failureResult(result.error ?? "Rollback failed", {
						path: "command",
						sessionId: getActionSessionId(),
					}),
					policy.policy,
				);
			},
			generate: async (input) => {
				const policy = evaluateActionPolicy("harness_generate", {
					id: input.id,
					purpose: input.purpose,
				});
				if (policy.blocked) return policy.blocked;
				const { HarnessRegistry } = require("./harness/registry");
				const registry = new HarnessRegistry();
				try {
					const result = await registry.generateHelper({
						id: input.id,
						purpose: input.purpose,
						files: input.files,
						taskTags: input.taskTags,
						failureTypes: input.failureTypes,
						site: input.site,
						domains: input.domains,
						usage: input.usage,
						version: input.version,
						testCommand: input.testCommand,
						activate: input.activate,
					});
					return attachPolicy(
						successResult(result, {
							path: "command",
							sessionId: getActionSessionId(),
						}),
						policy.policy,
					);
				} catch (err: unknown) {
					return attachPolicy(
						failureResult(err instanceof Error ? err.message : String(err), {
							path: "command",
							sessionId: getActionSessionId(),
						}),
						policy.policy,
					);
				}
			},
			execute: async (helperId: string, input?: Record<string, unknown>) => {
				const policy = evaluateActionPolicy("harness_execute", {
					helperId,
				});
				if (policy.blocked) return policy.blocked;
				const { HarnessRegistry } = require("./harness/registry");
				const registry = new HarnessRegistry();
				try {
					const result = await registry.executeHelper(helperId, input);
					return attachPolicy(
						successResult(result, {
							path: "command",
							sessionId: getActionSessionId(),
						}),
						policy.policy,
					);
				} catch (err: unknown) {
					return attachPolicy(
						failureResult(err instanceof Error ? err.message : String(err), {
							path: "command",
							sessionId: getActionSessionId(),
						}),
						policy.policy,
					);
				}
			},
		},
		package: {
			install: async (source: string) => {
				const policy = evaluateActionPolicy("package_install", { source });
				if (policy.blocked)
					return policy.blocked as ActionResult<
						import("./packages/types").InstalledAutomationPackage
					>;
				const { PackageRegistry } = await import("./packages/registry");
				const registry = new PackageRegistry(options.dataHome);
				const result = registry.install(source);
				if (result.success && result.package) {
					return attachPolicy(
						successResult(result.package, {
							path: "command",
							sessionId: getActionSessionId(),
						}),
						policy.policy,
					);
				}
				return attachPolicy(
					failureResult(result.error ?? "Install failed", {
						path: "command",
						sessionId: getActionSessionId(),
					}),
					policy.policy,
				);
			},
			list: () => {
				const policy = evaluateActionPolicy("package_list", {});
				if (policy.blocked)
					return policy.blocked as ActionResult<
						import("./packages/types").InstalledAutomationPackage[]
					>;
				const { PackageRegistry } = require("./packages/registry");
				const registry = new PackageRegistry(options.dataHome);
				return attachPolicy(
					successResult(registry.list(), {
						path: "command",
						sessionId: getActionSessionId(),
					}),
					policy.policy,
				);
			},
			info: (name: string) => {
				const policy = evaluateActionPolicy("package_info", { name });
				if (policy.blocked)
					return policy.blocked as ActionResult<
						import("./packages/types").InstalledAutomationPackage
					>;
				const { PackageRegistry } = require("./packages/registry");
				const registry = new PackageRegistry(options.dataHome);
				const pkg = registry.get(name);
				if (pkg) {
					return attachPolicy(
						successResult(pkg, {
							path: "command",
							sessionId: getActionSessionId(),
						}),
						policy.policy,
					);
				}
				return attachPolicy(
					failureResult(`Package not found: ${name}`, {
						path: "command",
						sessionId: getActionSessionId(),
					}),
					policy.policy,
				);
			},
			remove: (name: string) => {
				const policy = evaluateActionPolicy("package_remove", { name });
				if (policy.blocked)
					return policy.blocked as ActionResult<{ removed: boolean }>;
				const { PackageRegistry } = require("./packages/registry");
				const registry = new PackageRegistry(options.dataHome);
				const result = registry.remove(name);
				if (result.success) {
					return attachPolicy(
						successResult(
							{ removed: true },
							{ path: "command", sessionId: getActionSessionId() },
						),
						policy.policy,
					);
				}
				return attachPolicy(
					failureResult(result.error ?? "Remove failed", {
						path: "command",
						sessionId: getActionSessionId(),
					}),
					policy.policy,
				);
			},
			update: async (name: string, source?: string) => {
				const policy = evaluateActionPolicy("package_update", { name, source });
				if (policy.blocked)
					return policy.blocked as ActionResult<
						import("./packages/types").InstalledAutomationPackage
					>;
				const { PackageRegistry } = await import("./packages/registry");
				const registry = new PackageRegistry(options.dataHome);
				const result = registry.update(name, source);
				if (result.success && result.package) {
					return attachPolicy(
						successResult(result.package, {
							path: "command",
							sessionId: getActionSessionId(),
						}),
						policy.policy,
					);
				}
				return attachPolicy(
					failureResult(result.error ?? "Update failed", {
						path: "command",
						sessionId: getActionSessionId(),
					}),
					policy.policy,
				);
			},
			grantPermission: (name: string, permissionRef: string | number) => {
				const policy = evaluateActionPolicy("package_grant", {
					name,
					permissionRef,
				});
				if (policy.blocked)
					return policy.blocked as ActionResult<{ granted: boolean }>;
				const { PackageRegistry } = require("./packages/registry");
				const registry = new PackageRegistry(options.dataHome);
				const result = registry.grantPermission(name, permissionRef);
				if (result.success) {
					return attachPolicy(
						successResult(
							{ granted: true },
							{ path: "command", sessionId: getActionSessionId() },
						),
						policy.policy,
					);
				}
				return attachPolicy(
					failureResult(result.error ?? "Grant failed", {
						path: "command",
						sessionId: getActionSessionId(),
					}),
					policy.policy,
				);
			},
			run: async (name: string, workflowNameOrId?: string) => {
				const policy = evaluateActionPolicy("package_run", {
					name,
					workflowNameOrId,
				});
				if (policy.blocked) return policy.blocked as ActionResult;
				const { PackageRegistry } = await import("./packages/registry");
				const { PackageRunner } = await import("./packages/runner");
				const registry = new PackageRegistry(options.dataHome);
				const runner = new PackageRunner(
					registry,
					sessionManager.getMemoryStore(),
					getActionSessionId(),
					buildWorkflowRuntime(),
					{ dataHome: options.dataHome },
				);
				const result = await runner.runWorkflow(name, workflowNameOrId);
				return attachPolicy(result, policy.policy);
			},
			eval: async (name: string) => {
				const policy = evaluateActionPolicy("package_eval", { name });
				if (policy.blocked)
					return policy.blocked as ActionResult<
						import("./packages/types").PackageEvalResult[]
					>;
				const { PackageRegistry } = await import("./packages/registry");
				const { PackageEval } = await import("./packages/eval");
				const registry = new PackageRegistry(options.dataHome);
				const evaluator = new PackageEval(
					registry,
					sessionManager.getMemoryStore(),
					getActionSessionId(),
					buildWorkflowRuntime(),
					{ dataHome: options.dataHome },
				);
				const result = await evaluator.evaluate(name);
				return attachPolicy(result, policy.policy);
			},
			review: (name: string, status: import("./packages/types").TrustReviewStatus, reviewedBy: string, reason?: string): ActionResult<{ success: boolean; record?: import("./packages/types").TrustReviewRecord }> => {
				const policy = evaluateActionPolicy("package_review", { name, status });
				if (policy.blocked) return policy.blocked as ActionResult<{ success: boolean; record?: import("./packages/types").TrustReviewRecord }>;
				const { PackageRegistry } = require("./packages/registry");
				const registry = new PackageRegistry(options.dataHome);
				const result = registry.submitReview(name, status, reviewedBy, reason);
				const responseData: { success: boolean; record?: import("./packages/types").TrustReviewRecord } = result.success
					? { success: true, record: result.record }
					: { success: false };
				return attachPolicy(
					result.success
						? successResult(responseData, { path: "command", sessionId: getActionSessionId() })
						: failureResult(result.error ?? "Review failed", { path: "command", sessionId: getActionSessionId() }),
					policy.policy,
				);
			},
			reviewHistory: (name: string): ActionResult<import("./packages/types").TrustReviewRecord[]> => {
				const policy = evaluateActionPolicy("package_review_history", { name });
				if (policy.blocked) return policy.blocked as ActionResult<import("./packages/types").TrustReviewRecord[]>;
				const { PackageRegistry } = require("./packages/registry");
				const registry = new PackageRegistry(options.dataHome);
				return attachPolicy(
					successResult(registry.getReviewHistory(name), { path: "command", sessionId: getActionSessionId() }),
					policy.policy,
				);
			},
			evalHistory: (name?: string): ActionResult<import("./packages/types").PackageEvalRecord[]> => {
				const policy = evaluateActionPolicy("package_eval_history", { name });
				if (policy.blocked) return policy.blocked as ActionResult<import("./packages/types").PackageEvalRecord[]>;
				const { PackageRegistry } = require("./packages/registry");
				const registry = new PackageRegistry(options.dataHome);
				return attachPolicy(
					successResult(registry.getEvalHistory(name), { path: "command", sessionId: getActionSessionId() }),
					policy.policy,
				);
			},
		},
		benchmark: {
			run: async (runOptions = {}) => {
				const { runBenchmarks } = await import("./benchmarks/runner");
				return runBenchmarks({
					dataHome: options.dataHome,
					api: undefined,
					suite: runOptions.suite,
					iterations: runOptions.iterations,
				});
			},
			results: (resultOptions = {}) => {
				const { listBenchmarkRuns } = require("./benchmarks/runner");
				return listBenchmarkRuns(options.dataHome, resultOptions);
			},
			compare: (baseRunId, compareRunId) => {
				const { compareBenchmarkRuns } = require("./benchmarks/runner");
				return compareBenchmarkRuns(
					options.dataHome ?? require("./shared/paths").getDataHome(),
					baseRunId,
					compareRunId,
				);
			},
		},
		state: getStateStorage(options.dataHome),
		status: () => collectStatus(),
		get sessionManager() {
			return sessionManager;
		},
		get browserActions() {
			return browserActions;
		},
		get terminalActions() {
			return terminalActions;
		},
		get fsActions() {
			return fsActions;
		},
		get serviceActions() {
			return serviceActions;
		},
		close() {
			void localhostProxy?.stop();
			localhostProxy = null;
			sessionManager.close();
			require("./state/index").resetStateStorage();
		},
	};
}
