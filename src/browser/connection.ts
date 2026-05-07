/**
 * Browser Connection — Core connection abstraction for Browser Control.
 *
 * This module defines the canonical browser connection model:
 *  - managed: Browser Control launches and owns a dedicated automation browser
 *  - attached: Browser Control connects to an already-running Chrome/Chromium/Electron
 *  - restored: Browser Control starts a managed browser and restores persisted auth state
 *
 * It integrates with:
 *  - browser_core.ts (CDP connect, automation context)
 *  - browser_profiles.ts (profile management)
 *  - browser_auth_state.ts (auth persistence)
 *  - policy_engine.ts (policy-aware connection operations)
 *  - paths.ts / config.ts (path and configuration handling)
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { type Browser, type BrowserContext, chromium } from "playwright";
import { DefaultPolicyEngine } from "../policy/engine";
import {
	defaultRouter,
	type ExecutionRouter,
} from "../policy/execution_router";
import type { PolicyTaskIntent, RiskLevel, RoutedStep } from "../policy/types";
import { BrowserlessProvider } from "../providers/browserless";
import { CustomBrowserProvider } from "../providers/custom";
import { ProviderConfigError } from "../providers/errors";
import type { BrowserProvider } from "../providers/interface";
import { LocalBrowserProvider } from "../providers/local";
import { ProviderRegistry } from "../providers/registry";
import {
	buildChromeArgs,
	getWslHostCandidates,
	isChromeAlive,
	isLikelyWsl,
	isWslCdpBridgeEnabled,
	resolveChromePath,
	resolveWslBridgeScriptPath,
	startWslBridgeIfNeeded,
	stopWslBridge,
	waitForCdp,
	writeDebugState,
} from "../runtime/launch_browser";
import { MemoryStore } from "../runtime/memory_store";
import { loadConfig } from "../shared/config";
import { logger } from "../shared/logger";
import {
	type AuthSnapshot,
	exportAuthSnapshot,
	importAuthSnapshot,
} from "./auth_state";
import {
	type AutomationContextOptions,
	connectBrowser,
	createAutomationContext,
	ensureContextHasPage,
	getAllPages,
	getDebugEndpointCandidates,
	resolveDebugEndpointUrl,
} from "./core";
import type { BrowserProfile, ProfileType } from "./profiles";
import { BrowserProfileManager } from "./profiles";

const log = logger.withComponent("browser_connection");

function isLoopbackEndpoint(endpoint: string): boolean {
	try {
		const host = new URL(endpoint).hostname.toLowerCase();
		return host === "localhost" || host.startsWith("127.");
	} catch {
		return false;
	}
}

export function attachEndpointCandidates(
	cdpUrl: string | undefined,
	port: number,
	fallbackCandidates = getDebugEndpointCandidates(port),
): string[] {
	if (!cdpUrl) return [];
	const candidates = [cdpUrl];
	if (isLoopbackEndpoint(cdpUrl)) {
		for (const candidate of fallbackCandidates) {
			if (!candidates.includes(candidate)) candidates.push(candidate);
		}
	}
	return candidates;
}

function wslAttachHelp(port: number): string {
	if (!isLikelyWsl()) return "";
	return (
		" Running in WSL. To control visible Windows Chrome, start the Windows launcher with " +
		"`BROWSER_ENABLE_WSL_CDP_BRIDGE=1` and attach again. Example from WSL: " +
		`/mnt/c/Windows/System32/cmd.exe /C "set BROWSER_ENABLE_WSL_CDP_BRIDGE=1&& ` +
		`C:\\Users\\11\\browser-control\\launch_browser.bat ${port}", then ` +
		`node cli.js browser attach --port=${port} --yes`
	);
}

function wslChromeLaunchHelp(): string {
	if (!isLikelyWsl()) return "";
	return " Chrome was not found in WSL. To control visible Windows Chrome from WSL, start the Windows launcher/bridge, then run `node cli.js browser attach --port=9222`.";
}

// ── Connection Types ────────────────────────────────────────────────

export type BrowserConnectionMode = "managed" | "attached" | "restored";

export type BrowserTargetType =
	| "chrome"
	| "chromium"
	| "msedge"
	| "electron"
	| "unknown";

export type BrowserConnectionStatus =
	| "disconnected"
	| "connecting"
	| "connected"
	| "degraded"
	| "error";

export interface BrowserConnection {
	/** Unique connection ID */
	id: string;
	/** How this connection was established */
	mode: BrowserConnectionMode;
	/** The active browser profile */
	profile: BrowserProfile;
	/** The CDP endpoint URL */
	cdpEndpoint: string;
	/** Current connection status */
	status: BrowserConnectionStatus;
	/** ISO timestamp when connection was established */
	connectedAt: string;
	/** Number of open tabs/pages */
	tabCount: number;
	/** What kind of browser target */
	targetType: BrowserTargetType;
	/** Whether this is a real user browser (attached) or automation-owned */
	isRealBrowser: boolean;
	/** Provider that established this connection */
	provider: string;
	/** Provider-specific metadata */
	providerMetadata?: Record<string, unknown>;
}

export interface ConnectOptions {
	/** CDP port (default: from config or 9222) */
	port?: number;
	/** CDP endpoint URL override */
	cdpUrl?: string;
	/** CDP endpoint URL alias (Section 27) */
	cdp?: string;
	/** CDP endpoint URL alias (Section 27) */
	endpoint?: string;
	/** Profile to use */
	profileName?: string;
	/** Profile type when creating new */
	profileType?: ProfileType;
	/** Whether to restore auth state into a managed context */
	restoreAuth?: boolean;
	/** Auth snapshot to restore */
	authSnapshot?: AuthSnapshot;
	/** Session key for cookie persistence */
	sessionKey?: string;
	/** Automation context options */
	contextOptions?: AutomationContextOptions;
	/** Target type hint */
	targetType?: BrowserTargetType;
	/** Actor performing the connection */
	actor?: "human" | "agent";
	/** Session ID for policy */
	sessionId?: string;
	/** Provider to use for this connection */
	provider?: string;
	/** Explicit user confirmation for high-risk CLI/browser operations */
	confirmed?: boolean;
}

// ── Section 27: Advanced Browser I/O and Attach UX Types ─────────────

/**
 * Represents an attachable browser discovered on the local system.
 */
export interface AttachableBrowser {
	/** Browser channel: chrome, msedge, chromium, electron, or unknown */
	channel: "chrome" | "msedge" | "chromium" | "electron" | "unknown";
	/** CDP endpoint URL */
	endpoint: string;
	/** Process ID (best-effort, may not be available) */
	pid?: number;
	/** User data directory (best-effort, may not be available) */
	userDataDir?: string;
	/** Browser title or description */
	title?: string;
	/** Whether this browser is currently attached by Browser Control */
	attached: boolean;
}

/**
 * Result of a detach operation.
 */
export interface BrowserDetachResult {
	/** Whether the detach succeeded */
	detached: boolean;
	/** Ownership: managed (we launched it) or attached (user's browser) */
	ownership: "managed" | "attached";
	/** Whether the underlying browser was closed */
	closedBrowser: boolean;
	/** CDP endpoint URL */
	endpoint?: string;
	/** Connection ID */
	connectionId?: string;
}

/**
 * Request to drop files or data onto a page element.
 */
export interface BrowserDropRequest {
	/** Target: ref (@e3), selector, or semantic description */
	target: string;
	/** Local file paths to drop */
	files?: string[];
	/** MIME/value pairs for clipboard-like data drop */
	data?: Array<{ mimeType: string; value: string }>;
}

/**
 * Result of a drop operation.
 */
export interface BrowserDropResult {
	/** Whether the drop succeeded */
	success: boolean;
	/** Files dropped with their paths and sizes */
	files?: Array<{ path: string; sizeBytes: number }>;
	/** Data dropped with MIME types */
	data?: Array<{ mimeType: string; value: string }>;
	/** Error message if failed */
	error?: string;
}

// ── Policy Action Definitions ───────────────────────────────────────

interface BrowserPolicyAction {
	action: string;
	risk: RiskLevel;
	path: "a11y" | "low_level";
}

const BROWSER_POLICY_ACTIONS: Record<string, BrowserPolicyAction> = {
	browser_attach: {
		action: "browser_attach",
		risk: "high",
		path: "a11y",
	},
	browser_launch: {
		action: "browser_launch",
		risk: "moderate",
		path: "a11y",
	},
	browser_disconnect: {
		action: "browser_disconnect",
		risk: "low",
		path: "a11y",
	},
	auth_export: {
		action: "cookie_export",
		risk: "high",
		path: "low_level",
	},
	auth_import: {
		action: "cookie_import",
		risk: "high",
		path: "low_level",
	},
	profile_create: {
		action: "profile_manage",
		risk: "moderate",
		path: "a11y",
	},
	profile_delete: {
		action: "profile_manage",
		risk: "moderate",
		path: "a11y",
	},
	profile_switch: {
		action: "profile_manage",
		risk: "moderate",
		path: "a11y",
	},
	// Section 27: File/data drop policy actions
	browser_drop_file: {
		action: "browser_drop_file",
		risk: "high",
		path: "a11y",
	},
	browser_drop_data: {
		action: "browser_drop_data",
		risk: "moderate",
		path: "a11y",
	},
	// Section 27: Downloads list policy action
	browser_downloads_list: {
		action: "browser_downloads_list",
		risk: "low",
		path: "a11y",
	},
};

// ── Connection Manager ──────────────────────────────────────────────

export class BrowserConnectionManager {
	private browser: Browser | null = null;
	private context: BrowserContext | null = null;
	private connection: BrowserConnection | null = null;
	private managedProcess: import("node:child_process").ChildProcess | null =
		null;
	private readonly profileManager: BrowserProfileManager;
	private readonly memoryStore: MemoryStore;
	private readonly ownsMemoryStore: boolean;
	private policyEngine: DefaultPolicyEngine;
	private executionRouter: ExecutionRouter;
	private connectionCounter = 0;
	private readonly providerRegistry: ProviderRegistry;
	private currentProvider: BrowserProvider | null = null;
	private readonly disconnectHandlers = new Set<
		(connection: BrowserConnection) => void
	>();

	constructor(
		options: {
			memoryStore?: MemoryStore;
			policyEngine?: DefaultPolicyEngine;
			executionRouter?: ExecutionRouter;
			profileManager?: BrowserProfileManager;
			providerRegistry?: ProviderRegistry;
		} = {},
	) {
		const config = loadConfig({ validate: false });
		this.ownsMemoryStore = !options.memoryStore;
		this.memoryStore = options.memoryStore ?? new MemoryStore();
		this.policyEngine =
			options.policyEngine ??
			new DefaultPolicyEngine({ profileName: config.policyProfile });
		this.executionRouter = options.executionRouter ?? defaultRouter;
		this.profileManager = options.profileManager ?? new BrowserProfileManager();
		this.providerRegistry = options.providerRegistry ?? new ProviderRegistry();
	}

	// ── Connection Operations ───────────────────────────────────────

	/**
	 * Launch a managed automation browser.
	 *
	 * Browser Control owns this browser — it uses a dedicated profile directory
	 * and a fresh or persistent automation profile.
	 */
	async launchManaged(
		options: ConnectOptions = {},
	): Promise<BrowserConnection> {
		await this.evaluatePolicy("browser_launch", options);

		const providerName =
			options.provider ?? this.providerRegistry.getActiveName();
		const provider = this.resolveProvider(providerName);
		this.currentProvider = provider;

		// Delegate to remote provider if not local
		if (provider.name !== "local") {
			if (!provider.capabilities.supportsLaunch) {
				throw new Error(
					`Provider "${provider.name}" does not support managed launch.`,
				);
			}
			const result = await provider.launch({
				port: options.port,
				cdpUrl: options.cdpUrl,
				profile: this.resolveProfile(options),
				contextOptions: options.contextOptions,
				targetType: options.targetType,
				config: this.providerRegistry.get(providerName),
			});
			this.browser = result.browser;
			this.context = result.context;
			this.connection = result.connection;
			this.managedProcess = result.managedProcess ?? null;
			this.watchBrowserDisconnect(result.browser);
			this.persistConnectionState();
			return result.connection;
		}

		const config = loadConfig({ validate: false });
		const port = options.port ?? config.chromeDebugPort;

		// Resolve or create profile
		const profile = this.resolveProfile(options);

		log.info("Launching managed automation browser", {
			port,
			profile: profile.name,
			profileType: profile.type,
			dataDir: profile.dataDir,
		});

		try {
			const bindAddress = config.chromeBindAddress;
			const wslHostCandidates = getWslHostCandidates();
			const needsBridge =
				isWslCdpBridgeEnabled() && wslHostCandidates.length > 0;
			const shouldLaunch = true;

			if (await isChromeAlive(port)) {
				throw new Error(
					`Managed launch failed: Port ${port} is already in use by an existing process. Use 'bc browser attach' to connect to an existing browser, or specify an alternative port.`,
				);
			}

			if (shouldLaunch) {
				const platform = process.platform;
				const chromePath = resolveChromePath(
					platform,
					process.env.BROWSER_CHROME_PATH,
				);
				const userDataDir = profile.dataDir;
				fs.mkdirSync(userDataDir, { recursive: true });

				const chromeArgs = buildChromeArgs({ port, userDataDir, bindAddress });

				log.info(
					`Spawning Chrome with --user-data-dir=${userDataDir} and --remote-debugging-port=${port}...`,
				);
				this.managedProcess = spawn(chromePath, chromeArgs, {
					detached: true,
					stdio: "ignore",
					...(platform === "win32" ? { windowsHide: false } : {}),
				});
				this.managedProcess.unref();

				const ready = await waitForCdp(port, 15000);
				if (!ready) {
					throw new Error(
						`Chrome did not become ready on port ${port} within 15 seconds.`,
					);
				}

				writeDebugState({ port, bindAddress, wslHostCandidates });

				if (needsBridge) {
					await startWslBridgeIfNeeded(
						port,
						wslHostCandidates,
						resolveWslBridgeScriptPath(),
					);
				}
			}

			// Use existing connectBrowser which handles resolution
			const browser = await connectBrowser(port, { ignoreEnvOverrides: true });
			const cdpEndpoint = await resolveDebugEndpointUrl(port, {
				ignoreEnvOverrides: true,
			});

			this.browser = browser;
			this.watchBrowserDisconnect(browser);

			// Create automation context if needed
			const contextOpts: AutomationContextOptions = {
				...options.contextOptions,
				memoryStore: this.memoryStore,
				sessionKey: options.sessionKey ?? `profile:${profile.id}`,
				// Disable individual context persistence noise — BrowserConnectionManager
				// handles its own high-level auth persistence on disconnect.
				persistSessionCookies: false,
			};
			this.context = await createAutomationContext(browser, contextOpts);
			await ensureContextHasPage(this.context);

			const tabCount = getAllPages(browser).length;

			this.connection = {
				id: `conn-${Date.now()}-${++this.connectionCounter}`,
				mode: "managed",
				profile,
				cdpEndpoint,
				status: "connected",
				connectedAt: new Date().toISOString(),
				tabCount,
				targetType: options.targetType ?? "chrome",
				isRealBrowser: false,
				provider: "local",
			};

			// Update profile last-used timestamp
			this.profileManager.touchProfile(profile.id);

			// Persist the active connection info
			this.persistConnectionState();

			log.info("Managed browser connected", {
				connectionId: this.connection.id,
				tabs: tabCount,
			});

			return this.connection;
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			if (this.context) {
				try {
					await this.context.close();
				} catch {
					// best effort
				}
			}
			if (this.browser) {
				try {
					await this.browser.close();
				} catch {
					// best effort
				}
			}
			if (this.managedProcess) {
				const pid = this.managedProcess.pid;
				try {
					this.managedProcess.kill();
					if (process.platform === "win32" && pid) {
						spawnSync("taskkill", ["/pid", String(pid), "/f", "/t"], {
							stdio: "ignore",
							timeout: 5000,
						});
					}
					stopWslBridge(port);
				} catch (cleanupError: unknown) {
					log.warn(
						`Failed to clean partial managed browser launch: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
					);
				}
			}
			this.browser = null;
			this.context = null;
			this.connection = null;
			this.managedProcess = null;
			log.error(`Failed to launch managed browser: ${message}`);
			const wslHelp = wslChromeLaunchHelp();
			throw new Error(
				`Failed to launch managed automation browser on port ${port}. ` +
					(wslHelp
						? `${wslHelp}`
						: `Ensure Chrome can start or use 'bc browser launch' / 'launch_browser.bat ${port}'.`),
			);
		}
	}

	/**
	 * Attach to a running Chrome/Chromium/Electron instance via CDP.
	 *
	 * This connects to the user's real browser — the agent sees existing tabs,
	 * cookies, and logins. This is a high-risk operation.
	 *
	 * Section 27: Requires explicit target (cdp, cdpUrl, or endpoint) and
	 * never falls back to launch.
	 */
	async attach(options: ConnectOptions = {}): Promise<BrowserConnection> {
		await this.evaluatePolicy("browser_attach", options);

		const providerName =
			options.provider ?? this.providerRegistry.getActiveName();
		const provider = this.resolveProvider(providerName);
		this.currentProvider = provider;

		// Delegate to remote provider if not local
		if (provider.name !== "local") {
			if (!provider.capabilities.supportsAttach) {
				throw new Error(`Provider "${provider.name}" does not support attach.`);
			}
			// Support new aliases for remote providers too
			const cdpUrl = options.cdp ?? options.endpoint ?? options.cdpUrl;
			const result = await provider.attach({
				port: options.port,
				cdpUrl,
				targetType: options.targetType,
				config: this.providerRegistry.get(providerName),
			});
			this.browser = result.browser;
			this.context = result.context;
			this.connection = result.connection;
			this.managedProcess = result.managedProcess ?? null;
			this.watchBrowserDisconnect(result.browser);
			this.persistConnectionState();
			return result.connection;
		}

		// Resolve CDP endpoint from aliases (Section 27)
		const cdpUrl = options.cdp ?? options.endpoint ?? options.cdpUrl;
		const config = loadConfig({ validate: false });
		const port = options.port ?? config.chromeDebugPort;

		// Section 27: Require explicit target for attach
		if (!cdpUrl && !options.port) {
			throw new Error(
				`Explicit attach target required. Use --cdp <endpoint>, --endpoint <endpoint>, or --port <port>. ` +
					`Use 'bc browser launch' for managed browser instead.`,
			);
		}

		log.info("Attaching to running browser", {
			port,
			targetType: options.targetType ?? "chrome",
			explicitEndpoint: !!cdpUrl,
		});

		try {
			let cdpEndpoint: string | undefined;
			let browser: Browser | undefined;

			if (cdpUrl) {
				let lastError: unknown;
				for (const candidate of attachEndpointCandidates(cdpUrl, port)) {
					try {
						browser = await chromium.connectOverCDP(candidate);
						cdpEndpoint = candidate;
						lastError = undefined;
						break;
					} catch (error: unknown) {
						lastError = error;
					}
				}
				if (lastError) throw lastError;
				if (!browser)
					throw new Error("No attach endpoint candidates were available.");
			} else {
				cdpEndpoint = await resolveDebugEndpointUrl(port);
				browser = await connectBrowser(port);
			}
			if (!cdpEndpoint)
				throw new Error("No attach endpoint candidates were available.");

			this.browser = browser;
			this.watchBrowserDisconnect(browser);

			// For attached mode, we don't create a new context — use existing ones
			const contexts = browser.contexts();
			this.context = contexts[0] ?? null;

			const tabCount = getAllPages(browser).length;

			// Create an "attached" profile record
			const profile: BrowserProfile = {
				id: "attached",
				name: "attached-browser",
				type: "shared",
				dataDir: "",
				createdAt: new Date().toISOString(),
				lastUsedAt: new Date().toISOString(),
			};

			this.connection = {
				id: `conn-${Date.now()}-${++this.connectionCounter}`,
				mode: "attached",
				profile,
				cdpEndpoint,
				status: "connected",
				connectedAt: new Date().toISOString(),
				tabCount,
				targetType: options.targetType ?? this.detectTargetType(cdpEndpoint),
				isRealBrowser: true,
				provider: "local",
			};

			this.persistConnectionState();

			log.info("Attached to running browser", {
				connectionId: this.connection.id,
				tabs: tabCount,
				targetType: this.connection.targetType,
			});

			return this.connection;
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			log.error(`Failed to attach to browser: ${message}`);
			throw new Error(
				`Failed to attach to running browser${cdpUrl ? ` at ${cdpUrl}` : ` on port ${port}`}. ` +
					`Ensure Chrome/Chromium/Electron is running with --remote-debugging-port=${port}. ` +
					`If you want a managed browser instead, use 'bc browser launch'.${wslAttachHelp(port)}`,
			);
		}
	}

	/**
	 * Reconnect to Browser Control's own persisted browser connection.
	 *
	 * Managed/restored local sessions are automation-owned. Non-local attached
	 * sessions are only reused when Browser Control previously persisted them
	 * after an explicit attach.
	 */
	async reconnectActiveManaged(): Promise<boolean> {
		const active = this.memoryStore.get<{
			id?: string;
			mode?: BrowserConnectionMode;
			profileId?: string;
			cdpEndpoint?: string;
			status?: BrowserConnectionStatus;
			connectedAt?: string;
			targetType?: BrowserTargetType;
			isRealBrowser?: boolean;
			provider?: string;
		}>("browser_connection:active");

		if (!active || active.status !== "connected" || !active.cdpEndpoint) {
			return false;
		}

		const canReconnectLocalManaged =
			active.provider === "local" &&
			!active.isRealBrowser &&
			(active.mode === "managed" || active.mode === "restored");
		const canReconnectLocalAttached =
			active.provider === "local" &&
			active.isRealBrowser === true &&
			active.mode === "attached";
		const canReconnectProviderAttached =
			active.provider !== "local" &&
			active.isRealBrowser === true &&
			active.mode === "attached";

		if (
			!canReconnectLocalManaged &&
			!canReconnectLocalAttached &&
			!canReconnectProviderAttached
		) {
			return false;
		}

		try {
			if (canReconnectProviderAttached && active.provider) {
				const provider = this.resolveProvider(active.provider);
				if (!provider.capabilities.supportsAttach) {
					return false;
				}

				const result = await provider.attach({
					cdpUrl: active.cdpEndpoint,
					targetType: active.targetType,
					config: this.providerRegistry.get(active.provider),
				});
				this.currentProvider = provider;
				this.browser = result.browser;
				this.context = result.context;
				this.managedProcess = result.managedProcess ?? null;
				this.watchBrowserDisconnect(result.browser);
				const tabCount = getAllPages(result.browser).length;
				this.connection = {
					...result.connection,
					id: active.id ?? result.connection.id,
					connectedAt: active.connectedAt ?? result.connection.connectedAt,
					tabCount,
					status: "connected",
				};
				this.persistConnectionState();
				log.info("Reconnected to active attached browser", {
					connectionId: this.connection.id,
					endpoint: this.connection.cdpEndpoint,
					provider: this.connection.provider,
					tabs: tabCount,
				});
				return true;
			}

			if (canReconnectLocalAttached) {
				const browser = await chromium.connectOverCDP(active.cdpEndpoint);
				this.browser = browser;
				this.watchBrowserDisconnect(browser);
				this.context = browser.contexts()[0] ?? null;
				const tabCount = getAllPages(browser).length;
				this.connection = {
					id: active.id ?? `conn-${Date.now()}-${++this.connectionCounter}`,
					mode: "attached",
					profile: {
						id: "attached",
						name: "attached-browser",
						type: "shared",
						dataDir: "",
						createdAt: new Date().toISOString(),
						lastUsedAt: new Date().toISOString(),
					},
					cdpEndpoint: active.cdpEndpoint,
					status: "connected",
					connectedAt: active.connectedAt ?? new Date().toISOString(),
					tabCount,
					targetType:
						active.targetType ?? this.detectTargetType(active.cdpEndpoint),
					isRealBrowser: true,
					provider: "local",
				};
				this.persistConnectionState();
				log.info("Reconnected to active local attached browser", {
					connectionId: this.connection.id,
					endpoint: this.connection.cdpEndpoint,
					tabs: tabCount,
				});
				return true;
			}

			const profile = active.profileId
				? (this.profileManager.getProfile(active.profileId) ??
					this.profileManager.getDefaultProfile())
				: this.profileManager.getDefaultProfile();
			const browser = await chromium.connectOverCDP(active.cdpEndpoint);
			this.browser = browser;
			this.watchBrowserDisconnect(browser);
			this.context =
				browser.contexts()[0] ??
				(await createAutomationContext(browser, {
					memoryStore: this.memoryStore,
					sessionKey: `profile:${profile.id}`,
					persistSessionCookies: false,
				}));
			const tabCount = getAllPages(browser).length;
			const connection: BrowserConnection = {
				id: active.id ?? `conn-${Date.now()}-${++this.connectionCounter}`,
				mode: active.mode === "restored" ? "restored" : "managed",
				profile,
				cdpEndpoint: active.cdpEndpoint,
				status: "connected",
				connectedAt: active.connectedAt ?? new Date().toISOString(),
				tabCount,
				targetType: active.targetType ?? "chrome",
				isRealBrowser: false,
				provider: "local",
			};
			this.connection = connection;
			this.persistConnectionState();
			log.info("Reconnected to active managed browser", {
				connectionId: connection.id,
				endpoint: connection.cdpEndpoint,
				tabs: tabCount,
			});
			return true;
		} catch (_error: unknown) {
			try {
				this.memoryStore.set("browser_connection:active", {
					...active,
					status: "disconnected",
					disconnectedAt: new Date().toISOString(),
				});
			} catch {
				// Best-effort stale-state cleanup only.
			}
			log.info(
				"Previous managed browser is not reachable; state marked disconnected",
				{
					endpoint: active.cdpEndpoint,
				},
			);
			return false;
		}
	}

	/**
	 * Restore a session: start a managed browser and rehydrate auth state.
	 *
	 * This combines managed launch with auth snapshot restoration.
	 */
	async restore(options: ConnectOptions = {}): Promise<BrowserConnection> {
		const profileName = options.profileName ?? "default";
		const profile = this.resolveProfile({ ...options, profileName });

		log.info("Restoring browser session", { profile: profile.name });

		// Load auth snapshot for this profile
		let authSnapshot = options.authSnapshot;
		if (!authSnapshot) {
			const { loadAuthSnapshot } = await import("./auth_state");
			authSnapshot =
				loadAuthSnapshot(this.memoryStore, profile.id) ?? undefined;
		}

		if (!authSnapshot) {
			log.warn(
				"No auth snapshot found for restore — launching clean managed session",
				{
					profile: profile.name,
				},
			);
		}

		// Launch managed browser
		const connection = await this.launchManaged({
			...options,
			profileName: profile.name,
			sessionKey: `profile:${profile.id}`,
		});

		// Import auth snapshot if available
		if (authSnapshot && this.context) {
			try {
				await importAuthSnapshot(this.context, authSnapshot);
				log.info("Auth state restored into managed context", {
					cookies: authSnapshot.cookies.length,
					localStorageDomains: Object.keys(authSnapshot.localStorage).length,
				});
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : String(error);
				log.warn(`Failed to restore auth snapshot: ${message}`);
			}
		}

		// Override mode to "restored"
		connection.mode = "restored";
		this.connection = connection;
		this.persistConnectionState();

		return connection;
	}

	/**
	 * Disconnect the current browser connection.
	 */
	async disconnect(): Promise<void> {
		if (!this.connection) {
			return;
		}

		log.info("Disconnecting browser", {
			connectionId: this.connection.id,
			mode: this.connection.mode,
			provider: this.connection.provider,
		});

		// If we have a current provider and it's not local, use provider disconnect
		if (
			this.currentProvider &&
			this.currentProvider.name !== "local" &&
			this.browser
		) {
			try {
				await this.currentProvider.disconnect({
					browser: this.browser,
					context: this.context,
					connection: this.connection,
					managedProcess: this.managedProcess,
				});
			} catch (error: unknown) {
				log.warn(
					`Provider disconnect error: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
			this.browser = null;
			this.context = null;
			this.managedProcess = null;
			this.connection.status = "disconnected";
			this.persistConnectionState();
			this.connection = null;
			this.currentProvider = null;
			return;
		}

		// Save auth state before disconnecting if this is a managed/restored session
		if (this.context && this.connection.mode !== "attached") {
			try {
				const { saveAuthSnapshot } = await import("./auth_state");
				await saveAuthSnapshot(
					this.memoryStore,
					this.connection.profile.id,
					this.context,
				);
			} catch (error: unknown) {
				log.warn(
					`Failed to save auth state on disconnect: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}

		// Close context if we own it
		if (this.context && this.connection.mode !== "attached") {
			try {
				await this.context.close();
			} catch {
				// Context may already be closed
			}
		}

		// Terminate managed browser process if we launched it
		if (this.managedProcess && this.connection.mode !== "attached") {
			try {
				const pid = this.managedProcess.pid;
				const port = this.connection.cdpEndpoint
					? Number(new URL(this.connection.cdpEndpoint).port)
					: undefined;
				log.info("Terminating managed browser process", { pid });

				// Try graceful kill first
				this.managedProcess.kill();

				// On Windows, detached processes often need taskkill to clean up the tree
				if (process.platform === "win32" && pid) {
					spawn("taskkill", ["/pid", String(pid), "/f", "/t"], {
						stdio: "ignore",
					});
				}

				if (port) {
					stopWslBridge(port);
				}
			} catch (error: unknown) {
				log.warn(
					`Failed to kill managed browser process: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
			this.managedProcess = null;
		}

		this.browser = null;
		this.context = null;

		this.connection.status = "disconnected";
		this.persistConnectionState();
		this.connection = null;
		this.currentProvider = null;
	}

	/**
	 * Detach from the current browser connection without closing attached browsers.
	 *
	 * Section 27: Clean detach semantics:
	 * - For attached mode: disconnects without closing the underlying browser
	 * - For managed mode: returns error or closes browser (use disconnect for full cleanup)
	 *
	 * Returns a structured BrowserDetachResult.
	 */
	async detach(): Promise<BrowserDetachResult> {
		if (!this.connection) {
			return {
				detached: false,
				ownership: "managed",
				closedBrowser: false,
			};
		}

		const connectionId = this.connection.id;
		const mode = this.connection.mode;
		const endpoint = this.connection.cdpEndpoint;
		const ownership: "managed" | "attached" =
			mode === "attached" ? "attached" : "managed";

		log.info("Detaching from browser", {
			connectionId,
			mode,
			ownership,
		});

		// For attached mode, disconnect without closing the browser
		if (mode === "attached") {
			try {
				// Save auth state before disconnecting if applicable
				if (this.context) {
					try {
						const { saveAuthSnapshot } = await import("./auth_state");
						await saveAuthSnapshot(
							this.memoryStore,
							this.connection.profile.id,
							this.context,
						);
					} catch (error: unknown) {
						log.warn(
							`Failed to save auth state on detach: ${error instanceof Error ? error.message : String(error)}`,
						);
					}
				}

				// Close Playwright client but not the browser
				if (this.browser) {
					try {
						await this.browser.close();
					} catch (error: unknown) {
						log.warn(
							`Failed to close browser client on detach: ${error instanceof Error ? error.message : String(error)}`,
						);
					}
				}

				this.browser = null;
				this.context = null;
				this.managedProcess = null;

				this.connection.status = "disconnected";
				this.persistConnectionState();
				this.connection = null;
				this.currentProvider = null;

				return {
					detached: true,
					ownership,
					closedBrowser: false,
					endpoint,
					connectionId,
				};
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : String(error);
				log.error(`Failed to detach from browser: ${message}`);
				return {
					detached: false,
					ownership,
					closedBrowser: false,
					endpoint,
					connectionId,
				};
			}
		}

		// For managed mode, detach is not the right operation
		// User should use disconnect() for managed browsers
		return {
			detached: false,
			ownership,
			closedBrowser: false,
			endpoint,
			connectionId,
		};
	}

	/**
	 * Release local Node handles after a one-shot CLI connect command.
	 *
	 * For CDP connections, Playwright's browser.close() closes the client
	 * connection while leaving the remote Chrome process running.
	 */
	async releaseCliHandles(): Promise<void> {
		// A one-shot CLI attach/launch intentionally leaves the persisted browser
		// connection usable for the next CLI command. Closing the Playwright client
		// may emit "disconnected"; suppress that local client event here.
		this.connection = null;
		if (this.browser) {
			try {
				await this.browser.close();
			} catch (error: unknown) {
				log.warn(
					`Failed to close CLI browser client: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}

		this.browser = null;
		this.context = null;
		this.managedProcess = null;
		this.currentProvider = null;

		if (this.ownsMemoryStore) {
			this.memoryStore.close();
		}
	}

	onDisconnected(handler: (connection: BrowserConnection) => void): () => void {
		this.disconnectHandlers.add(handler);
		return () => {
			this.disconnectHandlers.delete(handler);
		};
	}

	private watchBrowserDisconnect(browser: Browser): void {
		// Guard for test fakes that may not have .once() method
		if (typeof browser.once !== "function") {
			log.warn(
				"Browser object does not support .once() event handler, skipping disconnect watch",
			);
			return;
		}

		browser.once("disconnected", () => {
			// Add tolerance: wait briefly before treating disconnect as permanent
			// This allows for temporary CDP reconnections during connection tests
			setTimeout(() => {
				// Check if browser is still disconnected after tolerance period
				if (
					typeof browser.isConnected === "function" &&
					!browser.isConnected()
				) {
					this.handleBrowserDisconnected();
				} else {
					log.info(
						"Browser reconnected within tolerance period, ignoring transient disconnect",
					);
				}
			}, 1000); // 1 second tolerance for transient disconnects
		});
	}

	private handleBrowserDisconnected(): void {
		const connection = this.connection;
		if (!connection) {
			return;
		}

		connection.status = "disconnected";
		this.persistConnectionState();

		this.browser = null;
		this.context = null;
		this.managedProcess = null;
		this.currentProvider = null;

		for (const handler of this.disconnectHandlers) {
			try {
				handler(connection);
			} catch (error: unknown) {
				log.warn(
					`Browser disconnect handler failed: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
	}

	// ── Accessors ─────────────────────────────────────────────────────

	/** Get the current connection, or null if not connected. */
	getConnection(): BrowserConnection | null {
		return this.connection;
	}

	/** Get the Playwright Browser instance, or null. */
	getBrowser(): Browser | null {
		return this.browser;
	}

	/** Get the active BrowserContext, or null. */
	getContext(): BrowserContext | null {
		return this.context;
	}

	/** Get the profile manager for direct profile operations. */
	getProfileManager(): BrowserProfileManager {
		return this.profileManager;
	}

	/** Get the memory store. */
	getMemoryStore(): MemoryStore {
		return this.memoryStore;
	}

	/** Check if currently connected. */
	isConnected(): boolean {
		return this.connection?.status === "connected";
	}

	// ── Provider Integration ──────────────────────────────────────────

	/** Resolve a provider by name using the registry config.type. */
	private resolveProvider(name: string): BrowserProvider {
		const config = this.providerRegistry.get(name);
		if (!config) {
			throw new ProviderConfigError(
				name,
				`Unknown provider "${name}". Use 'bc browser provider list' to see available providers.`,
			);
		}
		switch (config.type) {
			case "local":
				return new LocalBrowserProvider();
			case "custom":
				return new CustomBrowserProvider();
			case "browserless":
				return new BrowserlessProvider();
			default:
				throw new ProviderConfigError(
					name,
					`Unsupported provider type "${(config as { type: string }).type}".`,
				);
		}
	}

	/** Get the provider registry for external management. */
	getProviderRegistry(): ProviderRegistry {
		return this.providerRegistry;
	}

	/** Get a human-readable status summary. */
	getStatusSummary(): Record<string, unknown> {
		if (!this.connection) {
			return {
				connected: false,
				mode: null,
				profile: null,
				status: "disconnected",
			};
		}

		return {
			connected: true,
			connectionId: this.connection.id,
			mode: this.connection.mode,
			provider: this.connection.provider,
			profile: {
				name: this.connection.profile.name,
				type: this.connection.profile.type,
			},
			cdpEndpoint: this.connection.cdpEndpoint,
			status: this.connection.status,
			connectedAt: this.connection.connectedAt,
			tabCount: this.connection.tabCount,
			targetType: this.connection.targetType,
			isRealBrowser: this.connection.isRealBrowser,
		};
	}

	// ── Auth Operations ───────────────────────────────────────────────

	/** Export auth state from the current browser context. */
	async exportAuth(): Promise<AuthSnapshot> {
		await this.evaluatePolicy("auth_export", {});

		if (!this.context) {
			throw new Error("No active browser context to export auth from.");
		}
		if (!this.connection) {
			throw new Error("No active browser connection.");
		}

		return exportAuthSnapshot(this.context, this.connection.profile.id);
	}

	/** Import auth state into the current browser context. */
	async importAuth(snapshot: AuthSnapshot): Promise<void> {
		await this.evaluatePolicy("auth_import", {});

		if (!this.context) {
			throw new Error("No active browser context to import auth into.");
		}

		await importAuthSnapshot(this.context, snapshot);
	}

	// ── Policy Integration ────────────────────────────────────────────

	private async evaluatePolicy(
		actionName: string,
		options: ConnectOptions,
	): Promise<void> {
		if (!this.policyEngine) {
			return;
		}

		const policyAction = BROWSER_POLICY_ACTIONS[actionName];
		if (!policyAction) {
			return;
		}

		const intent: PolicyTaskIntent = {
			goal: actionName,
			actor: options.actor ?? "agent",
			sessionId: options.sessionId ?? "default",
			metadata: { browserAction: actionName },
		};

		const step: RoutedStep = this.executionRouter.buildRoutedStep(
			intent,
			policyAction.action,
			{ browserAction: actionName },
			{
				sessionId: options.sessionId ?? "default",
				actor: options.actor ?? "agent",
			},
		);

		// Override risk and path to match our definitions
		const finalStep = this.executionRouter.overrideRisk(
			this.executionRouter.overridePath(step, policyAction.path),
			policyAction.risk,
		);

		const evaluation = this.policyEngine.evaluate(finalStep, {
			sessionId: options.sessionId ?? "default",
			actor: options.actor ?? "agent",
		});

		log.info("Policy evaluation for browser action", {
			action: actionName,
			decision: evaluation.decision,
			risk: evaluation.risk,
			reason: evaluation.reason,
		});

		if (evaluation.decision === "deny") {
			throw new Error(
				`Browser action "${actionName}" denied by policy (${evaluation.reason}).`,
			);
		}

		if (evaluation.decision === "require_confirmation") {
			if (options.confirmed) {
				return;
			}
			throw new Error(
				`Browser action "${actionName}" requires confirmation (${evaluation.reason}). ` +
					`Rerun with --yes to confirm, or use a more permissive policy profile to proceed.`,
			);
		}
	}

	// ── Internal Helpers ──────────────────────────────────────────────

	private resolveProfile(options: ConnectOptions): BrowserProfile {
		let profileName = options.profileName;

		// If no explicit profile requested, check MemoryStore for active profile preference
		if (!profileName) {
			try {
				const activePref = this.memoryStore.get<{ id: string; name: string }>(
					"browser_connection:active_profile",
				);
				if (activePref?.name) {
					profileName = activePref.name;
				}
			} catch {
				// ignore store errors
			}
		}

		// Fall back to default
		profileName = profileName ?? "default";

		const profileType = options.profileType ?? "shared";

		// Try to load existing profile by name
		const existing = this.profileManager.getProfileByName(profileName);
		if (existing) {
			return existing;
		}

		// Create new profile
		return this.profileManager.createProfile(profileName, profileType);
	}

	private detectTargetType(cdpEndpoint: string): BrowserTargetType {
		const lower = cdpEndpoint.toLowerCase();
		if (lower.includes("electron")) {
			return "electron";
		}
		return "chrome";
	}

	private persistConnectionState(): void {
		if (!this.connection) {
			return;
		}

		try {
			this.memoryStore.set("browser_connection:active", {
				id: this.connection.id,
				mode: this.connection.mode,
				profileId: this.connection.profile.id,
				cdpEndpoint: this.connection.cdpEndpoint,
				status: this.connection.status,
				connectedAt: this.connection.connectedAt,
				targetType: this.connection.targetType,
				isRealBrowser: this.connection.isRealBrowser,
				provider: this.connection.provider,
			});
		} catch (error: unknown) {
			log.warn(
				`Failed to persist connection state: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
}

// ── Convenience Exports ─────────────────────────────────────────────

/** Create a connection manager with defaults from config. */
export function createConnectionManager(
	options: {
		memoryStore?: MemoryStore;
		policyEngine?: DefaultPolicyEngine;
	} = {},
): BrowserConnectionManager {
	return new BrowserConnectionManager(options);
}
