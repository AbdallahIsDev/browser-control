/**
 * Browser Actions — High-level browser action surface for Browser Control.
 *
 * Implements the canonical browser actions:
 *   open, snapshot, click, fill, hover, type, press, scroll, screenshot,
 *   tab list, tab switch, tab close, close
 *
 * Uses:
 *   - Section 8 browser connection/session layer
 *   - Section 6 snapshot/ref/query layer
 *   - Section 4 policy routing
 *   - ActionResult as the unified result contract
 */

import fs from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { BrowserContext, Download, Locator, Page } from "playwright-core";
import {
	type A11yElement,
	type A11ySnapshot,
	INTERACTIVE_ROLES,
	snapshot,
} from "../a11y_snapshot";
import { collectFailureDebugMetadata } from "../observability/action_debug";
import { getGlobalConsoleCapture } from "../observability/console_capture";
import { getGlobalNetworkCapture } from "../observability/network_capture";
import { redactObject, redactString } from "../observability/redaction";
import type { RecordedActionKind } from "../observability/recorder";
import { getGlobalScreencastRecorder } from "../observability/screencast";
import type {
	ScreencastOptions,
	ScreencastSession,
} from "../observability/types";
import { recordPackageRecordingAction } from "../packages/record_cli";
import type { ExecutionPath, PolicyDecision, RiskLevel } from "../policy/types";
import { getProfile } from "../policy/profiles";
import { getPageId, type RefStore, resolveRefLocator } from "../ref_store";
import {
	globalServiceRegistry,
	type ServiceRegistry,
} from "../services/registry";
import { mightBeServiceRef, resolveServiceUrl } from "../services/resolver";
import type { SessionManager } from "../session_manager";
import { isPolicyAllowed } from "../session_manager";
import {
	type ActionResult,
	failureResult,
	successResult,
} from "../shared/action_result";
import { loadConfig } from "../shared/config";
import { logger } from "../shared/logger";
import {
	ensureStructuredSessionRuntimeDir,
	getDataHome,
	getSessionDownloadsDir,
	getSessionRuntimeDir,
} from "../shared/paths";
import { getStateStorage } from "../state/index";
import {
	CredentialVault,
	containsSecretRef,
	parseSecretRef,
	redactKnownSecretValues,
	redactSecretRefs,
	type SecretAction,
} from "../security/credential_vault";
import {
	NetworkRuleEngine,
} from "../security/network_rules";
import type { PrivacyProfileName } from "../policy/types";
import type { BrowserConnectionManager, BrowserDropResult } from "./connection";
import { formatLaunchBrowserCommand } from "./launch_help";
import { globalRefStore } from "./core";
import {
	type ExtendedDownloadResult,
	type UploadOptions,
	getFileSize,
	resolveDownloadFilePath,
	validateFilePath,
} from "./file_helpers";
import {
	BrowserDialogSupervisor,
	type DialogInfo,
	type DialogResponse,
} from "./dialogs";
import {
	BrowserActionQueue,
	type BrowserActionQueueStats,
} from "./action_queue";

const log = logger.withComponent("browser_actions");
const DEFAULT_DOWNLOAD_REGISTRY_MAX_ENTRIES = 200;
const NAVIGATION_RETRY_ATTEMPTS = 3;
const NAVIGATION_RETRY_INITIAL_DELAY_MS = 500;
const OPEN_MANY_PARALLEL_LIMIT = 4;
const BROWSER_LAUNCH_RECOVERY_GUIDANCE =
	"Try 'bc browser launch --port=<other>' with another profile/provider, or 'bc browser open <url>' after fixing Chrome launch.";
const CDP_AUDIT_DETAILS_MAX_CHARS = 20_000;

function resolveDownloadRegistryMaxEntries(value?: number): number {
	if (typeof value === "number" && Number.isInteger(value) && value > 0) {
		return value;
	}
	const fromEnv = Number(process.env.BROWSER_DOWNLOAD_REGISTRY_MAX_ENTRIES ?? "");
	if (Number.isInteger(fromEnv) && fromEnv > 0) {
		return fromEnv;
	}
	return DEFAULT_DOWNLOAD_REGISTRY_MAX_ENTRIES;
}

function truncateAuditValue(value: unknown): unknown {
	const raw = JSON.stringify(value);
	if (raw.length <= CDP_AUDIT_DETAILS_MAX_CHARS) return value;
	return {
		_truncated: true,
		_length: raw.length,
		_preview: raw.slice(0, 2000),
	};
}

function normalizeAuditValue(value: unknown): unknown {
	if (value === undefined) return undefined;
	const redacted = redactObject(truncateAuditValue(value));
	if (typeof redacted === "string") return redactString(redacted);
	return redacted;
}

async function recordCdpAuditEvent(input: {
	action: "cdp_execute_success" | "cdp_execute_denied" | "cdp_execute_failed";
	sessionId: string;
	method: string;
	options: {
		params?: Record<string, unknown>;
		targetId?: string;
		frameId?: string;
		tabId?: string;
		timeoutMs?: number;
	};
	policyDecision?: PolicyDecision;
	result?: unknown;
	error?: string;
	tabId?: string;
	success: boolean;
}): Promise<void> {
	const timestamp = new Date().toISOString();
	const scope = input.options.targetId
		? "target"
		: input.options.frameId
			? "frame"
			: "page";
	const details = {
		timestamp,
		sessionId: input.sessionId,
		method: input.method,
		scope,
		tabId: input.tabId ?? input.options.tabId,
		targetId: input.options.targetId,
		frameId: input.options.frameId,
		timeoutMs: input.options.timeoutMs,
		params: normalizeAuditValue(input.options.params),
		result: normalizeAuditValue(input.result),
		error: input.error ? redactString(input.error) : undefined,
		success: input.success,
	};

	await getStateStorage().saveAuditEvent({
		id: `cdp-audit-${randomUUID()}`,
		action: input.action,
		sessionId: input.sessionId,
		policyDecision: input.policyDecision,
		details: JSON.stringify(details),
		timestamp,
	});
}

function isSafeHighlightStyleValue(value: string): boolean {
	const compact = value.toLowerCase().replace(/\s+/gu, "");
	return !/[\\\u0000-\u001f\u007f]/u.test(value)
		&& !value.includes("/*")
		&& !compact.includes("@import")
		&& !compact.includes("javascript:")
		&& !/(?:url|expression)\(/u.test(compact);
}

interface BrowserWindowTarget {
	page: Page;
	targetId: string;
	windowId: number;
	windowState?: string;
}

	// ── High-Level Composite Action Types (Section 31) ──────────────────

export interface BrowserStateResult {
	browserConnected: boolean;
	url?: string;
	title?: string;
	tabId?: string;
	tabCount: number;
	tabs?: Array<{ id: string; url: string; title: string }>;
	dialogCount: number;
	dialogs?: DialogInfo[];
	downloads?: ExtendedDownloadResult[];
	snapshot?: A11ySnapshot;
	screenshot?: ScreenshotResult;
	activeElementHint?: string;
	warnings: string[];
	status: Record<string, "ok" | "error" | "skipped">;
	queue?: BrowserActionQueueStats;
}

export type BrowserActionName =
	| "click" | "fill" | "press" | "hover" | "scroll" | "type" | "paste"
	| "screenshot" | "tab-close" | "open" | "navigate" | "openMany"
	| "capture" | "captureMany" | "fillMany" | "state";

export type UrlEntry = string | { url: string; label?: string; waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit" };

export interface BrowserActOptions {
	action: BrowserActionName;
	target?: string;
	text?: string;
	key?: string;
	timeoutMs?: number;
	force?: boolean;
	commit?: boolean;
	direction?: string;
	amount?: number;
	delayMs?: number;
	tabId?: string;
	copyTo?: string;
	outputPath?: string;
	fullPage?: boolean;
	annotate?: boolean;
	refs?: string | string[];
	captureOnSuccess?: boolean;
	snapshot?: boolean;
	screenshot?: boolean;
	dialog?: boolean;
	downloads?: boolean;
	url?: string;
	urls?: UrlEntry[];
	waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
	fields?: Array<{ target: string; text: string }>;
	continueOnFailure?: boolean;
	parallel?: boolean;
	concurrency?: number;
	boxes?: boolean;
	rootSelector?: string;
	stateOptions?: {
		tabId?: string;
		snapshot?: boolean;
		screenshot?: boolean;
		fullPage?: boolean;
		dialog?: boolean;
		downloads?: boolean;
	};
}

export interface TaskStep {
	action: string;
	target?: string;
	text?: string;
	key?: string;
	timeoutMs?: number;
	force?: boolean;
	commit?: boolean;
	direction?: string;
	amount?: number;
	delayMs?: number;
	tabId?: string;
	copyTo?: string;
	outputPath?: string;
	fullPage?: boolean;
	annotate?: boolean;
	refs?: string | string[];
	captureOnSuccess?: boolean;
	dialog?: boolean;
	downloads?: boolean;
	url?: string;
	urls?: string[];
	waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
	fields?: Array<{ target: string; text: string }>;
	continueOnFailure?: boolean;
	boxes?: boolean;
	rootSelector?: string;
	snapshot?: boolean;
	screenshot?: boolean;
	content?: string;
	filename?: string;
	subdir?: "runtime" | "reports" | "screenshots" | "artifacts";
	parallel?: boolean;
	concurrency?: number;
}

export interface TaskStepResult {
	step: TaskStep;
	success: boolean;
	result?: Record<string, unknown>;
	error?: string;
	durationMs?: number;
	policy?: string;
	auditId?: string;
	path?: string;
	tabId?: string;
}

export interface TaskRunResult {
	results: TaskStepResult[];
	completedSteps: number;
	totalSteps: number;
	aborted: boolean;
	executedSteps: number;
	successfulSteps: number;
	failedStepIndex: number | null;
	finalState?: BrowserStateResult;
}

// ── Action Options ─────────────────────────────────────────────────────

export interface BrowserActionContext {
	/** Session manager for policy routing and session binding. */
	sessionManager: SessionManager;
	/** Ref store to use (defaults to global). */
	refStore?: RefStore;
	/** Service registry to use for URL resolution (defaults to global). */
	serviceRegistry?: ServiceRegistry;
	/** Maximum in-memory Playwright download records retained per BrowserActions instance. */
	downloadRegistryMaxEntries?: number;
	/** Shared browser action scheduler. Defaults to a process-wide queue. */
	actionQueue?: BrowserActionQueue;
}

let globalActionQueue: BrowserActionQueue | undefined;

function getGlobalBrowserActionQueue(): BrowserActionQueue {
	if (!globalActionQueue) {
		const config = loadConfig({ validate: false });
		globalActionQueue = new BrowserActionQueue({
			maxGlobalConcurrency: config.browserActionMaxConcurrency,
			maxPerSessionConcurrency: config.browserActionMaxConcurrencyPerSession,
			maxQueueDepth: config.browserActionQueueMaxDepth,
		});
	}
	return globalActionQueue;
}

export interface OpenOptions {
	url: string;
	/** Wait until this event fires (default: domcontentloaded). */
	waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
}

export interface OpenManyItem {
	url: string;
	label?: string;
	waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
}

export interface OpenManyOptions {
	/** Open independent tabs concurrently. Sequential remains the default. */
	parallel?: boolean;
	/** Maximum concurrent tab navigations when parallel is true. */
	concurrency?: number;
}

export interface OpenManyTabResult {
	tabId: string;
	label?: string;
	url: string;
	title?: string;
	status: "loaded" | "failed" | "partial";
	error?: string;
}

export interface CaptureResult {
	tabId: string;
	url: string;
	title?: string;
	snapshot?: A11ySnapshot;
	screenshot?: ScreenshotResult;
}

export interface FillField {
	target: string;
	text: string;
}

export interface FillManyFieldResult {
	target: string;
	success: boolean;
	error?: string;
}

export interface FillManyOptions {
	tabId?: string;
	continueOnFailure?: boolean;
	timeoutMs?: number;
}

export interface SnapshotOptions {
	/** Root selector to scope the snapshot. */
	rootSelector?: string;
	/** Include element bounds with viewport metadata. */
	boxes?: boolean;
	tabId?: string;
}

export interface ClickOptions {
	/** Target: ref (@e3), selector, or semantic description. */
	target: string;
	/** Click timeout in ms. */
	timeoutMs?: number;
	/** Force click without actionability checks. */
	force?: boolean;
	tabId?: string;
}

export interface FillOptions {
	/** Target: ref (@e3), selector, or semantic description. */
	target: string;
	/** Text to fill. */
	text: string;
	/** Fill timeout in ms. */
	timeoutMs?: number;
	/** Commit with Tab after fill. */
	commit?: boolean;
	tabId?: string;
}

export interface HoverOptions {
	/** Target: ref (@e3), selector, or semantic description. */
	target: string;
	/** Hover timeout in ms. */
	timeoutMs?: number;
	tabId?: string;
}

export interface TypeOptions {
	/** Text to type into the currently focused element. */
	text: string;
	/** Delay between keystrokes in ms. */
	delayMs?: number;
	tabId?: string;
}

export interface PasteOptions {
	/** Text to paste/insert into the currently focused element. */
	text: string;
	/** Optional target to focus before pasting. */
	target?: string;
	/** Focus/click timeout in ms when target is provided. */
	timeoutMs?: number;
	tabId?: string;
}

export interface PressOptions {
	/** Key to press (e.g., "Enter", "Tab", "ArrowDown"). */
	key: string;
	tabId?: string;
}

export interface ScrollOptions {
	/** Direction: up, down, left, right. */
	direction: "up" | "down" | "left" | "right";
	/** Scroll amount in pixels (default: 300). */
	amount?: number;
	tabId?: string;
}

export interface ScreenshotOptions {
	/** Optional auxiliary copy destination. Primary save remains in the session runtime directory. */
	copyTo?: string;
	/** Deprecated. Use copyTo. Primary save remains in the session runtime directory. */
	outputPath?: string;
	/** Screenshot timeout in ms. */
	timeoutMs?: number;
	/** Full page screenshot. */
	fullPage?: boolean;
	/** Element selector/ref to screenshot. */
	target?: string;
	/** Annotate screenshot with ref labels and boxes. */
	annotate?: boolean;
	/** Specific refs to annotate (if annotate is true). */
	refs?: string[];
	tabId?: string;
}

export interface ScreenshotResult {
	path: string;
	runtimePath: string;
	copyPath?: string;
	sizeBytes: number;
	tabId: string;
}

export interface HighlightOptions {
	/** Target: ref (@e3), selector, or semantic description. */
	target?: string;
	/** Custom CSS for highlight overlay. */
	style?: string;
	/** Whether to persist the highlight (default: false). */
	persist?: boolean;
	/** Whether to hide the highlight (if target is omitted, hides all). */
	hide?: boolean;
	tabId?: string;
}

export interface LocatorCandidate {
	kind: "role" | "label" | "placeholder" | "text" | "testid" | "css";
	value: string;
	confidence: "high" | "medium" | "low";
	reason: string;
}

type ResolvedTarget = { locator: Locator; description: string };

export interface BrowserCloseResult {
	detached: boolean;
	closedBrowser: boolean;
	mode: "attached" | "managed" | "restored" | "none";
	connectionId?: string;
	endpoint?: string;
}

export interface BrowserLaunchOptions {
	/** Chrome remote-debugging port (default: from config). */
	port?: number;
	/** Launcher profile: "system" or "isolated" (default: from config). */
	profile?: "system" | "isolated";
	/** Provider to use for launch (default: active provider). */
	provider?: string;
}

export interface BrowserLaunchResult {
	launched: boolean;
	mode: "managed" | "attached" | "restored";
	connectionId?: string;
	endpoint?: string;
	port?: number;
	profile?: string;
	provider?: string;
}

// ── Section 27: File/Data Drop Options ─────────────────────────────────────

export interface DropOptions {
	/** Target: ref (@e3), selector, or semantic description. */
	target: string;
	/** Local file paths to drop. */
	files?: string[];
	/** MIME/value pairs for clipboard-like data drop (e.g., text/plain=hello). */
	data?: Array<{ mimeType: string; value: string }>;
	tabId?: string;
}


// ── Browser Action Implementation ──────────────────────────────────────

export class BrowserActions {
	private readonly context: BrowserActionContext;
	private readonly refStore: RefStore;
	private readonly dialogSupervisor = new BrowserDialogSupervisor();
	private readonly observabilityPages = new Map<string, WeakSet<Page>>();
	private readonly networkPrivacyPages = new WeakSet<Page>();
	private readonly downloadPages = new WeakSet<Page>();
	private readonly downloadContexts = new WeakSet<BrowserContext>();
	private readonly downloadRegistry: Array<ExtendedDownloadResult & { sortTimeMs: number }> = [];
	private readonly maxDownloadRegistryEntries: number;
	private readonly actionQueue: BrowserActionQueue;
	private readonly trackedPages = new WeakSet<Page>();
	private selectedPage?: Page;

	constructor(context: BrowserActionContext) {
		this.context = context;
		this.refStore = context.refStore ?? globalRefStore;
		this.maxDownloadRegistryEntries = resolveDownloadRegistryMaxEntries(
			context.downloadRegistryMaxEntries,
		);
		this.actionQueue = context.actionQueue ?? getGlobalBrowserActionQueue();
	}

	getActionQueueStats(): BrowserActionQueueStats {
		return this.actionQueue.stats();
	}

	async runQueuedAction<T>(
		actionName: string,
		run: () => Promise<ActionResult<T>>,
	): Promise<ActionResult<T>> {
		const sessionId = this.getSessionId();
		try {
			return await this.actionQueue.enqueue(sessionId, actionName, run);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			return failureResult(`Browser action queue rejected ${actionName}: ${message}`, {
				path: "a11y",
				sessionId,
			});
		}
	}

	private recordPackageAction(
		kind: RecordedActionKind,
		params: Record<string, unknown>,
		result: ActionResult,
	): void {
		try {
			recordPackageRecordingAction({ kind, params, result });
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			if (!/No active package recording/u.test(message)) {
				log.warn(`Package recorder skipped ${kind}: ${message}`);
			}
		}
	}

	// Maps targetId -> page for durable tab ID resolution
	private readonly tabIdMap = new Map<string, Page>();

	/**
	 * Get a durable tab ID for a page. Uses CDP targetId when available,
	 * falls back to the numeric index for backward compatibility.
	 */
	private async getTabIdForPage(page: Page, defaultTabId = "0"): Promise<string> {
		const target = await this.getWindowTarget(page);
		if (target) {
			this.tabIdMap.set(target.targetId, page);
			return target.targetId;
		}
		const rawPages = page.context().pages();
		const windowTargets = await this.getWindowTargets(rawPages);
		const pages = windowTargets.length > 0 ? windowTargets.map(t => t.page) : rawPages;
		const tabIndex = pages.indexOf(page);
		return tabIndex !== -1 ? String(tabIndex) : defaultTabId;
	}

	private syncDialogHandlingMode(): void {
		const session = this.context.sessionManager.getActiveSession();
		const profileName = session?.policyProfile ?? "balanced";
		const profile = getProfile(profileName);
		if (profile?.browserPolicy) {
			const mode = profile.browserPolicy.dialogHandling;
			const timeout = profile.browserPolicy.dialogTimeoutMs;
			this.dialogSupervisor.setHandlingMode(mode);
			this.dialogSupervisor.setDefaultTimeout(timeout);
		}
	}

	private getPendingDialogsForSnapshot(sessionId: string): DialogInfo[] | undefined {
		const dialogs = this.dialogSupervisor.getPendingDialogs(sessionId);
		return dialogs.length > 0 ? dialogs : undefined;
	}

	private isBlankBrowserPage(page: Page): boolean {
		const url = page.url();
		return (
			url === "about:blank" ||
			url === "chrome://newtab/" ||
			url === "chrome://new-tab-page/" ||
			url.startsWith("chrome://new-tab-page?")
		);
	}


	// ── Page Access ──────────────────────────────────────────────────────

	private getPage(): Page {
		const bm = this.context.sessionManager.getBrowserManager();
		const context = bm.getContext();
		if (context) {
			const pages = context.pages();
			this.trackContextPages(context, pages);
			if (this.selectedPage && pages.includes(this.selectedPage)) return this.selectedPage;
			if (pages.length > 0) return pages[0];
		}
		const browser = bm.getBrowser();
		if (browser) {
			const contexts = browser.contexts();
			if (contexts.length > 0) {
				const pages = contexts[0].pages();
				this.trackContextPages(contexts[0], pages);
				if (this.selectedPage && pages.includes(this.selectedPage)) return this.selectedPage;
				if (pages.length > 0) return pages[0];
			}
		}
		throw new Error(
			"No active browser page. Use 'bc browser open <url>' or 'bc browser attach' first.",
		);
	}

	private getPages(): Page[] {
		const bm = this.context.sessionManager.getBrowserManager();
		const context = bm.getContext();
		if (context) {
			const pages = context.pages();
			this.trackContextPages(context, pages);
			if (pages.length > 0) return pages;
		}
		const browser = bm.getBrowser();
		if (browser) {
			const contexts = browser.contexts();
			if (contexts.length > 0) {
				const pages = contexts[0].pages();
				this.trackContextPages(contexts[0], pages);
				if (pages.length > 0) return pages;
			}
		}
		return [];
	}

	private trackContextPages(context: BrowserContext, pages = context.pages()): void {
		for (const page of pages) this.trackPageLifecycle(page);
		if (this.downloadContexts.has(context) || typeof (context as unknown as { on?: unknown }).on !== "function") return;
		context.on("page", (page) => this.trackPageLifecycle(page));
		this.downloadContexts.add(context);
	}

	private trackPageLifecycle(page: Page): void {
		this.trackPageDownloads(page);
		if (this.trackedPages.has(page) || typeof (page as unknown as { on?: unknown }).on !== "function") return;
		page.on("close", () => {
			for (const [tabId, mappedPage] of this.tabIdMap.entries()) {
				if (mappedPage === page) this.tabIdMap.delete(tabId);
			}
			if (this.selectedPage === page) this.selectedPage = undefined;
			this.trackedPages.delete(page);
		});
		this.trackedPages.add(page);
	}

	private trackPageDownloads(page: Page): void {
		if (this.downloadPages.has(page) || typeof (page as unknown as { on?: unknown }).on !== "function") return;
		page.on("download", (download) => {
			void this.recordDownload(page, download);
		});
		page.on("close", () => {
			this.downloadPages.delete(page);
		});
		this.downloadPages.add(page);
	}

	private async recordDownload(page: Page, download: Download): Promise<void> {
		const sessionId = this.getSessionId();
		const downloadsDir = getSessionDownloadsDir(sessionId);
		fs.mkdirSync(downloadsDir, { recursive: true });
		const createdAt = new Date().toISOString();
		const id = `download-${Date.now()}-${this.downloadRegistry.length + 1}`;
		const rawSuggestedFilename = download.suggestedFilename() || id;
		const tabId = await this.getTabIdForPage(page, "0").catch(() => undefined);
		let fileName: string;
		let filePath: string;
		try {
			({ fileName, filePath } = resolveDownloadFilePath(
				downloadsDir,
				rawSuggestedFilename,
				id,
			));
		} catch (error: unknown) {
			this.downloadRegistry.unshift({
				id,
				url: download.url(),
				suggestedFilename: id,
				status: "failed",
				error: error instanceof Error ? error.message : String(error),
				createdAt,
				completedAt: new Date().toISOString(),
				tabId,
				source: "playwright",
				sortTimeMs: Date.now(),
			});
			this.pruneDownloadRegistry();
			return;
		}
		const record: ExtendedDownloadResult & { sortTimeMs: number } = {
			id,
			url: download.url(),
			suggestedFilename: fileName,
			path: filePath,
			status: "pending",
			createdAt,
			tabId,
			source: "playwright",
			sortTimeMs: Date.now(),
		};
		this.downloadRegistry.unshift(record);
		this.pruneDownloadRegistry();
		try {
			await download.saveAs(filePath);
			const failure = await download.failure().catch(() => null);
			record.completedAt = new Date().toISOString();
			record.sortTimeMs = Date.now();
			if (failure) {
				record.status = "failed";
				record.error = failure;
				return;
			}
			record.status = "completed";
			record.sizeBytes = fs.existsSync(filePath) ? fs.statSync(filePath).size : undefined;
		} catch (error: unknown) {
			record.completedAt = new Date().toISOString();
			record.sortTimeMs = Date.now();
			record.status = "failed";
			record.error = error instanceof Error ? error.message : String(error);
		}
	}

	private async getWindowTarget(
		page: Page,
	): Promise<BrowserWindowTarget | null> {
		let client:
			| Awaited<ReturnType<ReturnType<Page["context"]>["newCDPSession"]>>
			| undefined;
		try {
			client = await page.context().newCDPSession(page);
			const info = (await client.send("Target.getTargetInfo")) as {
				targetInfo?: { targetId?: string };
			};
			const targetId = info.targetInfo?.targetId;
			if (!targetId) return null;
			const windowInfo = (await client.send("Browser.getWindowForTarget", {
				targetId,
			})) as {
				windowId?: number;
				bounds?: { windowState?: string };
			};
			if (typeof windowInfo.windowId !== "number") return null;
			return {
				page,
				targetId,
				windowId: windowInfo.windowId,
				windowState: windowInfo.bounds?.windowState,
			};
		} catch {
			return null;
		} finally {
			await client?.detach?.().catch(() => undefined);
		}
	}

	private async activateWindowTarget(
		target: BrowserWindowTarget,
	): Promise<void> {
		if (target.windowState === "minimized") return;
		let client:
			| Awaited<ReturnType<ReturnType<Page["context"]>["newCDPSession"]>>
			| undefined;
		try {
			client = await target.page.context().newCDPSession(target.page);
			// Normal browser actions must not mutate user-managed window bounds.
			// Explicit resize/viewport commands are the only place allowed to resize.
			await client
				.send("Target.activateTarget", { targetId: target.targetId })
				.catch(() => undefined);
		} catch {
			// Best-effort foregrounding only; Playwright bringToFront still follows.
		} finally {
			await client?.detach?.().catch(() => undefined);
		}
		await target.page.bringToFront().catch(() => undefined);
	}

	private async foregroundPage(page: Page): Promise<void> {
		const target = await this.getWindowTarget(page);
		if (target) {
			await this.activateWindowTarget(target);
			this.selectedPage = page;
			return;
		}
		await page.bringToFront().catch(() => undefined);
		this.selectedPage = page;
	}

	private rememberActiveTab(tabId: string | undefined): void {
		if (!tabId) return;
		const sessionId = this.getSessionId();
		this.context.sessionManager.setActiveBrowserTab(sessionId, tabId);
	}

	private async getWindowTargets(
		pages = this.getPages(),
	): Promise<BrowserWindowTarget[]> {
		const targets: BrowserWindowTarget[] = [];
		for (const page of pages) {
			const target = await this.getWindowTarget(page);
			if (target) targets.push(target);
		}
		return targets;
	}

	private refreshTabIdMap(
		targets: BrowserWindowTarget[],
		currentPages: Page[],
	): void {
		const currentPageSet = new Set(currentPages);
		for (const [tabId, mappedPage] of this.tabIdMap.entries()) {
			if (!currentPageSet.has(mappedPage)) this.tabIdMap.delete(tabId);
		}
		for (const target of targets) {
			this.tabIdMap.set(target.targetId, target.page);
		}
	}

	private pruneDownloadRegistry(): void {
		if (this.downloadRegistry.length <= this.maxDownloadRegistryEntries) return;
		this.downloadRegistry.splice(this.maxDownloadRegistryEntries);
	}

	private async getVisiblePages(pages = this.getPages()): Promise<Page[]> {
		const targets = await this.getWindowTargets(pages);
		return targets.length > 0 ? targets.map((target) => target.page) : pages;
	}

	private async getBestVisiblePage(preferred?: Page): Promise<Page> {
		const pages = this.getPages();
		const candidates = preferred
			? [preferred, ...pages.filter((page) => page !== preferred)]
			: pages;
		const targets = await this.getWindowTargets(candidates);
		const target = targets[0];
		if (target) {
			await this.activateWindowTarget(target);
			return target.page;
		}
		if (preferred) return preferred;
		const fallback = pages[0];
		if (fallback) return fallback;
		return this.getPage();
	}

	/**
	 * Ensure a browser is connected. Attempts attach first.
	 * Managed launch is only used when browserMode is explicitly managed.
	 * Returns the page on success, or a failure ActionResult if no browser
	 * could be obtained.
	 *
	 * When a browser connection is established, also binds it into the
	 * active session so that session state truthfully reflects browser binding.
	 */
	private async ensureBrowserConnected(): Promise<Page | ActionResult<never>> {
		try {
			return this.getPage();
		} catch {
			// No browser connected — try to attach
			const bm = this.context.sessionManager.getBrowserManager();
			const sessionId = this.getSessionId();

			if (!bm.isConnected()) {
				const reconnected =
					typeof bm.reconnectActiveManaged === "function"
						? await bm.reconnectActiveManaged()
						: false;
				if (reconnected) {
					this.bindBrowserToSession(bm);
				} else {
					const config = loadConfig({ validate: false });
					try {
						await bm.attach({ actor: "human", port: config.chromeDebugPort });
						// Bind the browser connection into the session (Issue 3)
						this.bindBrowserToSession(bm);
					} catch (attachError: unknown) {
						if (config.browserMode !== "managed" && !config.browserAutoLaunch) {
							const attachMsg =
								attachError instanceof Error
									? attachError.message
									: String(attachError);
							return this.failureWithDebug(
								`No attachable Chrome on port ${config.chromeDebugPort}: ${attachMsg}. Browser mode is attach and auto-launch is disabled. Close all Chrome windows, run ${formatLaunchBrowserCommand(config.chromeDebugPort)}, then retry. For an isolated automation browser, set BROWSER_MODE=managed and BROWSER_LAUNCH_PROFILE=isolated, or enable auto-launch with BROWSER_AUTO_LAUNCH=true.`,
								attachError,
								{
									action: "browser_connect",
									path: "a11y",
									sessionId,
								},
							);
						}
						// Attach failed — try launching managed browser
						try {
							if (config.browserMode === "managed") {
								await bm.launchManaged({
									actor: "human",
									profileName: config.browserLaunchProfile,
								});
							} else {
								await bm.launchAttachable({
									actor: "human",
									port: config.chromeDebugPort,
									profile: config.browserLaunchProfile,
								});
							}
							// Bind the browser connection into the session (Issue 3)
							this.bindBrowserToSession(bm);
						} catch (launchError: unknown) {
							const attachMsg =
								attachError instanceof Error
									? attachError.message
									: String(attachError);
							const launchMsg =
								launchError instanceof Error
									? launchError.message
									: String(launchError);
							return this.failureWithDebug(
								`No browser was connected. Attach failed on port ${config.chromeDebugPort}: ${attachMsg}. ` +
									`${config.browserMode === "managed" ? "Managed launch" : "Attach-mode launch"} also failed: ${launchMsg}. ` +
									BROWSER_LAUNCH_RECOVERY_GUIDANCE,
								launchError,
								{
									action: "browser_connect",
									path: "a11y",
									sessionId,
								},
							);
						}
					}
				}
			}
			return this.getPage();
		}
	}

	/**
	 * Bind the current browser connection into the active session.
	 * This ensures session state reflects the browser binding (Issue 3).
	 */
	private bindBrowserToSession(bm: BrowserConnectionManager): void {
		const conn = bm.getConnection();
		const activeSession = this.context.sessionManager.getActiveSession();
		if (conn && activeSession) {
			this.context.sessionManager.bindBrowser(activeSession.id, conn.id);
		}
	}

	/**
	 * Unbind the browser from the active session when the browser
	 * is disconnected or closed (Issue 3).
	 */
	private unbindBrowserFromSession(): void {
		const activeSession = this.context.sessionManager.getActiveSession();
		if (activeSession?.browserConnectionId) {
			this.context.sessionManager.unbindBrowser(activeSession.id);
		}
	}

	private getSessionId(): string {
		const session = this.context.sessionManager.getActiveSession();
		return session?.id ?? "default";
	}

	private getUploadPathOptions(): UploadOptions {
		const session = this.context.sessionManager.getActiveSession();
		const roots = [
			session?.runtimeDir,
			session?.workingDirectory,
		].filter((root): root is string => Boolean(root));
		return {
			cwd: session?.workingDirectory || undefined,
			allowedRoots: roots.length > 0 ? Array.from(new Set(roots)) : undefined,
		};
	}

	private getNetworkPrivacyProfile(): PrivacyProfileName {
		const profile = this.context.sessionManager.getActiveSession()?.policyProfile;
		if (profile === "safe" || profile === "strict") return "strict";
		if (profile === "trusted" || profile === "audit") return "audit";
		return "balanced";
	}

	private tryGetPage(): Page | null {
		try {
			return this.getPage();
		} catch {
			return null;
		}
	}

	/**
	 * Resolve a tabId to a Page. Supports:
	 * 1. CDP targetId (durable) — checked via tabIdMap
	 * 2. Numeric index (legacy backward compat)
	 */
	private async resolveTabId<T>(tabId: string, contextPage: Page): Promise<Page | ActionResult<T>> {
		const rawPages = contextPage.context().pages();
		const pages = await this.getVisiblePages(rawPages);

		// Try durable targetId first
		const existingPage = this.tabIdMap.get(tabId);
		if (existingPage && pages.includes(existingPage)) {
			await this.foregroundPage(existingPage);
			return existingPage;
		}

		// Refresh known targets without dropping current pages that failed this CDP probe.
		const refreshTargets = await this.getWindowTargets(pages);
		this.refreshTabIdMap(refreshTargets, rawPages);
		const refreshedPage = this.tabIdMap.get(tabId);
		if (refreshedPage) {
			await this.foregroundPage(refreshedPage);
			return refreshedPage;
		}

		// Fall back to numeric index (legacy)
		if (/^\d+$/.test(tabId)) {
			const index = parseInt(tabId, 10);
			if (index >= 0 && index < pages.length) {
				const numericPage = pages[index];
				await this.foregroundPage(numericPage);
				return numericPage;
			}
			const sessionId = this.getSessionId();
			return (await this.failureWithDebug(
				`Tab index ${tabId} out of range (0..${pages.length - 1})`,
				new Error(`Tab index ${tabId} out of range (0..${pages.length - 1})`),
				{ action: "browser_action", path: "a11y", sessionId },
			)) as ActionResult<T>;
		}

		const sessionId = this.getSessionId();
		return (await this.failureWithDebug(
			`Tab "${tabId}" not found. Known tabs: [${[...this.tabIdMap.keys()].join(", ")}]`,
			new Error(`Tab "${tabId}" not found`),
			{ action: "browser_action", path: "a11y", sessionId },
		)) as ActionResult<T>;
	}

	private async getConnectedPageForAction<T>(tabId?: string): Promise<
		Page | ActionResult<T>
	> {
		const pageOrErr = await this.ensureBrowserConnected();
		if ("success" in pageOrErr) return pageOrErr as ActionResult<T>;

		let page: Page;
		const sessionId = this.getSessionId();
		const requestedTabId = tabId ?? this.context.sessionManager.getActiveBrowserTab(sessionId) ?? undefined;
		if (requestedTabId !== undefined) {
			const resolved = await this.resolveTabId<T>(requestedTabId, pageOrErr);
			if ("success" in resolved) {
				if (tabId !== undefined) return resolved;
				this.context.sessionManager.setActiveBrowserTab(sessionId, null);
				page = await this.getBestVisiblePage(pageOrErr);
			} else {
				page = resolved;
			}
		} else {
			page = await this.getBestVisiblePage(pageOrErr);
		}

		await this.startObservability(page, sessionId);
		await this.applyNetworkPrivacyRules(page, sessionId);
		this.syncDialogHandlingMode();
		this.dialogSupervisor.attachToPage(page, sessionId);
		const activeTabId = await this.getTabIdForPage(page, requestedTabId ?? "0").catch(() => requestedTabId);
		this.rememberActiveTab(activeTabId);
		return page;
	}

	private async applyNetworkPrivacyRules(
		page: Page,
		sessionId: string,
	): Promise<void> {
		if (this.networkPrivacyPages.has(page)) return;
		this.networkPrivacyPages.add(page);
		try {
			const engine = new NetworkRuleEngine(undefined, this.context.sessionManager.getPolicyEngine());
			await engine.applyToPage(page, {
				profile: this.getNetworkPrivacyProfile(),
				sessionId,
				recordBlockedRequest: (entry) => {
					getGlobalNetworkCapture({ captureSuccess: true }).recordEntry(
						sessionId,
						entry,
					);
				},
			});
		} catch (error: unknown) {
			this.networkPrivacyPages.delete(page);
			log.warn(
				`Network privacy route unavailable: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	private async startObservability(
		page: Page,
		sessionId: string,
	): Promise<void> {
		const observedPages = this.observabilityPages.get(sessionId);
		if (observedPages?.has(page)) return;
		if (typeof (page as unknown as { on?: unknown }).on !== "function") return;

		try {
			getGlobalConsoleCapture().startCapture(sessionId, page);
			getGlobalNetworkCapture({ captureSuccess: true }).startCapture(sessionId, page);
			page.on("close", () => {
				getGlobalConsoleCapture().stopCapture(sessionId, page);
				getGlobalNetworkCapture({ captureSuccess: true }).stopCapture(sessionId, page);
				this.observabilityPages.get(sessionId)?.delete(page);
			});
			const pages = observedPages ?? new WeakSet<Page>();
			pages.add(page);
			this.observabilityPages.set(sessionId, pages);
		} catch (error: unknown) {
			log.warn(
				`Observability capture unavailable: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	private async persistObservability(
		sessionId: string,
		page?: Page,
		settleMs = 250,
	): Promise<void> {
		try {
			if (page && settleMs > 0) {
				await new Promise((resolve) => setTimeout(resolve, settleMs));
			}
			const store = this.context.sessionManager.getMemoryStore();
			getGlobalConsoleCapture().persistToStore(store, sessionId);
			getGlobalNetworkCapture({ captureSuccess: true }).persistToStore(
				store,
				sessionId,
			);
		} catch (error: unknown) {
			log.warn(
				`Observability persistence failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Record an action event to the screencast timeline (Section 26).
	 * Errors in timeline recording must not break the original action.
	 */
	private recordTimelineEvent(event: {
		action: string;
		target?: string;
		url?: string;
		title?: string;
		policyDecision?: string;
		risk?: string;
		durationMs?: number;
		artifactPath?: string;
		success?: boolean;
		error?: string;
	}): void {
		try {
			const store = this.context.sessionManager.getMemoryStore();
			const recorder = getGlobalScreencastRecorder(store);
			recorder.appendEvent({
				timestamp: new Date().toISOString(),
				...event,
			});
		} catch (error) {
			// Silently fail - timeline errors must not break the original action
			log.debug(
				`Failed to record timeline event: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	private redactSecretMessage(message: string, secretValues: string[]): string {
		return String(redactKnownSecretValues(redactSecretRefs(message), secretValues));
	}

	private secretAwarePolicyParams(
		text: string,
		extra: Record<string, unknown> = {},
	): Record<string, unknown> {
		const parsed = parseSecretRef(text);
		if (!parsed && !containsSecretRef(text)) {
			return { ...extra, text };
		}
		return {
			...extra,
			text: "[REDACTED_SECRET]",
			secretRef: true,
			secretScope: parsed?.scope ?? "embedded",
		};
	}

	private async resolveSecretTextForBrowser(
		text: string,
		action: SecretAction,
		page: Page,
		sessionId: string,
		policyDecision: PolicyDecision,
	): Promise<{
		text: string;
		redactedText: string;
		secretValues: string[];
		usedSecret: boolean;
	}> {
		const parsed = parseSecretRef(text);
		if (!parsed) {
			if (containsSecretRef(text)) {
				throw new Error(
					"Embedded secret:// references are not supported for browser text actions; pass the secret ref as the full text value",
				);
			}
			return { text, redactedText: text, secretValues: [], usedSecret: false };
		}

		let targetDomain: string | undefined;
		try {
			targetDomain = new URL(page.url()).hostname;
		} catch {
			targetDomain = undefined;
		}

		const vault = new CredentialVault();
		const resolved = await vault.resolveForUse(text, {
			action,
			targetDomain,
			site: targetDomain,
			sessionId,
			policyDecision,
		});
		if (!resolved.success) {
			throw new Error(`Secret resolution denied: ${resolved.error}`);
		}
		return {
			text: resolved.value.reveal(),
			redactedText: resolved.redactedValue,
			secretValues: [resolved.value.reveal()],
			usedSecret: true,
		};
	}

	private async closePage(page: Page): Promise<void> {
		let timer: NodeJS.Timeout | undefined;
		try {
			const closePromise = page.close({ runBeforeUnload: false });
			const timeoutPromise = new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error("Timed out waiting for browser tab to close")),
					5_000,
				);
				timer.unref?.();
			});
			await Promise.race([closePromise, timeoutPromise]);
		} catch (error: unknown) {
			await this.closePageViaCdp(page, error);
		} finally {
			if (timer) clearTimeout(timer);
		}
	}

	private async closePageViaCdp(
		page: Page,
		originalError: unknown,
	): Promise<void> {
		let client:
			| Awaited<ReturnType<ReturnType<Page["context"]>["newCDPSession"]>>
			| undefined;
		try {
			client = await page.context().newCDPSession(page);
			const info = (await client.send("Target.getTargetInfo")) as {
				targetInfo?: { targetId?: string };
			};
			const targetId = info.targetInfo?.targetId;
			if (!targetId) throw new Error("CDP target id is unavailable");
			const result = (await client.send("Target.closeTarget", {
				targetId,
			})) as { success?: boolean };
			if (result.success === false) {
				throw new Error("CDP target close was rejected");
			}
			await page
				.waitForEvent("close", { timeout: 2_000 })
				.catch(() => undefined);
		} catch {
			throw originalError instanceof Error
				? originalError
				: new Error(String(originalError));
		} finally {
			await client?.detach().catch(() => undefined);
		}
	}

	private async ensureScreenshotViewport(page: Page): Promise<void> {
		// Do NOT change the viewport for visible browsers (headful mode).
		// page.viewportSize() returns null for visible browsers - changing it would
		// mutate the real Chrome window layout (bug: forced 16:9 viewport).
		// For headless browsers, Playwright already sets an appropriate viewport.
		// Just ensure the page is brought to front for visibility unless the user minimized it.
		await this.foregroundPage(page);
	}

	private async failureWithDebug<T>(
		message: string,
		error: unknown,
		options: {
			action: string;
			path: ExecutionPath;
			sessionId: string;
			policyDecision?: PolicyDecision;
			risk?: RiskLevel;
			auditId?: string;
		},
	): Promise<ActionResult<T>> {
		const debug = await collectFailureDebugMetadata({
			action: options.action,
			sessionId: options.sessionId,
			executionPath: options.path,
			error,
			page: this.tryGetPage(),
			store: this.context.sessionManager.getMemoryStore(),
			policyDecision: options.policyDecision,
			risk: options.risk,
		});
		return failureResult<T>(message, {
			path: options.path,
			sessionId: options.sessionId,
			policyDecision: options.policyDecision,
			risk: options.risk,
			auditId: options.auditId,
			...debug,
		});
	}

	private isPathInside(
		childPath: string,
		parentPath: string,
		pathModule: typeof import("node:path"),
	): boolean {
		const child = pathModule.resolve(childPath);
		const parent = pathModule.resolve(parentPath);
		const relative = pathModule.relative(parent, child);
		return (
			relative === "" ||
			(!relative.startsWith("..") && !pathModule.isAbsolute(relative))
		);
	}

	private resolveScreenshotOutputPath(
		helpers: {
			path: typeof import("node:path");
			fs: typeof import("node:fs");
			getDataHome: () => string;
			getSessionScreenshotsDir: (sessionId: string) => string;
		},
	): string {
		const sessionId = this.getSessionId();
		const activeSession = this.context.sessionManager.getActiveSession();
		const outputDir = activeSession
			? activeSession.screenshotsDir
			: helpers.getSessionScreenshotsDir(sessionId);

		helpers.fs.mkdirSync(outputDir, { recursive: true });
		return helpers.path.join(outputDir, `screenshot-${randomUUID()}.png`);
	}

	private resolveScreenshotCopyPath(
		requestedPath: string | undefined,
		helpers: {
			path: typeof import("node:path");
			fs: typeof import("node:fs");
		},
	): string | undefined {
		if (!requestedPath) return undefined;
		const resolvedPath = helpers.path.isAbsolute(requestedPath)
			? helpers.path.resolve(requestedPath)
			: helpers.path.resolve(process.cwd(), requestedPath);
		const parentDir = helpers.path.dirname(resolvedPath);
		helpers.fs.mkdirSync(parentDir, { recursive: true });
		return resolvedPath;
	}

	// ── Ref Resolution ──────────────────────────────────────────────────

	private isRefTarget(target: string): boolean {
		return target.startsWith("@") || /^e\d+$/.test(target);
	}

	private findReplacementRef(
		previous: A11yElement | undefined,
		snap: A11ySnapshot,
	): string | null {
		if (!previous) return null;
		const matches = snap.elements.filter(
			(element) =>
				element.role === previous.role &&
				(previous.name
					? element.name === previous.name
					: !element.name) &&
				(previous.text ? element.text === previous.text : true),
		);
		if (matches.length === 0) return null;
		// Prefer the last match. Modal/dialog content is usually appended after
		// the page body, so this avoids falling back to a background duplicate.
		return matches[matches.length - 1].ref;
	}

	private async resolveTarget(
		target: string,
		page: Page,
	): Promise<ResolvedTarget | null> {
		// Check if target is a ref (@e3 or e3)
		if (this.isRefTarget(target)) {
			const pageId = getPageId(page.url(), this.getSessionId());
			const result = await resolveRefLocator(
				this.refStore,
				pageId,
				page,
				target,
			);
			if (result) {
				return { locator: result.locator, description: result.description };
			}
			return null;
		}

		// Treat as a Playwright selector
		try {
			const locator = page.locator(target).first();
			const count = await locator.count();
			if (count > 0) {
				return { locator, description: `selector: ${target}` };
			}
		} catch {
			// Not a valid selector
		}

		// Try text within an active dialog/modal before global text. Pages often
		// keep a duplicate background button behind a modal overlay.
		const modalTextLocator = page
			.locator("dialog, [role='dialog'], .snab-dialog, .snab-modal, .modal")
			.getByText(target, { exact: true })
			.first();
		const modalTextCount = await modalTextLocator.count();
		if (modalTextCount > 0) {
			return {
				locator: modalTextLocator,
				description: `dialog text: ${target}`,
			};
		}

		const modalButtonLocator = page
			.locator("dialog, [role='dialog'], .snab-dialog, .snab-modal, .modal")
			.getByRole("button", { name: target, exact: true })
			.first();
		const modalButtonCount = await modalButtonLocator.count();
		if (modalButtonCount > 0) {
			return {
				locator: modalButtonLocator,
				description: `dialog button: ${target}`,
			};
		}

		// Try as a semantic text match
		const textLocator = page.getByText(target).first();
		const textCount = await textLocator.count();
		if (textCount > 0) {
			return { locator: textLocator, description: `text: ${target}` };
		}

		return null;
	}

	private isRetriableLocatorActionError(error: unknown): boolean {
		const message = error instanceof Error ? error.message : String(error);
		return /outside of the viewport|not visible|detached|stale|element is not attached|target closed/i.test(
			message,
		);
	}

	private async refreshSnapshotAndResolve(
		target: string,
		page: Page,
		sessionId: string,
	): Promise<ResolvedTarget | null> {
		const oldPageId = getPageId(page.url(), sessionId);
		const previous = this.isRefTarget(target)
			? this.refStore.lookup(oldPageId, target)
			: undefined;
		const snap = await snapshot(page, {
			sessionId,
			pendingDialogs: this.getPendingDialogsForSnapshot(sessionId),
		});
		const pageId = getPageId(page.url(), sessionId);
		this.refStore.setSnapshot(pageId, snap);
		if (this.isRefTarget(target)) {
			const replacementRef = this.findReplacementRef(previous, snap);
			if (replacementRef) {
				const replacement = await this.resolveTarget(
					`@${replacementRef}`,
					page,
				);
				if (replacement) return replacement;
			}
		}
		return this.resolveTarget(target, page);
	}

	private async prepareLocatorAction(
		page: Page,
		locator: Locator,
		timeoutMs: number,
	): Promise<void> {
		const target = await this.getWindowTarget(page);
		if (target) {
			await this.activateWindowTarget(target);
		} else {
			await this.foregroundPage(page);
		}
		await locator
			.scrollIntoViewIfNeeded({ timeout: timeoutMs })
			.catch((error: unknown) => {
				if (!this.isRetriableLocatorActionError(error)) throw error;
			});
	}

	private async runLocatorActionWithRetry(
		actionName: "click" | "fill" | "hover" | "paste",
		target: string,
		page: Page,
		sessionId: string,
		run: (resolved: ResolvedTarget) => Promise<void>,
	): Promise<ResolvedTarget | null> {
		const first =
			(await this.resolveTarget(target, page)) ??
			(await this.refreshSnapshotAndResolve(target, page, sessionId));
		if (!first) return null;

		try {
			await run(first);
			return first;
		} catch (error: unknown) {
			if (!this.isRetriableLocatorActionError(error)) throw error;
			log.warn(`${actionName} retrying after locator actionability failure`, {
				target,
				error: error instanceof Error ? error.message : String(error),
			});
		}

		const retry = await this.refreshSnapshotAndResolve(target, page, sessionId);
		if (!retry) return null;
		await run(retry);
		return retry;
	}

	private isTransientNavigationError(error: unknown): boolean {
		if (!(error instanceof Error)) return false;
		if (error.name === "TimeoutError") return false;
		const message = error.message;
		return (
			message.includes("ERR_ABORTED") ||
			/net::ERR_[A-Z_]+/u.test(message) ||
			message.includes("Target closed") ||
			message.includes("target closed") ||
			message.includes("Navigation failed")
		);
	}

	private async waitForNavigationRetry(attempt: number): Promise<void> {
		const delayMs = NAVIGATION_RETRY_INITIAL_DELAY_MS * 2 ** attempt;
		await new Promise((resolve) => setTimeout(resolve, delayMs));
	}

	private async navigateWithRetry(
		page: Page,
		url: string,
		waitUntil: OpenOptions["waitUntil"],
	): Promise<void> {
		let lastError: unknown;
		for (let attempt = 0; attempt < NAVIGATION_RETRY_ATTEMPTS; attempt += 1) {
			try {
				await page.goto(url, {
					waitUntil: waitUntil ?? "domcontentloaded",
				});
				return;
			} catch (error: unknown) {
				lastError = error;
				const canRetry =
					attempt < NAVIGATION_RETRY_ATTEMPTS - 1 &&
					this.isTransientNavigationError(error);
				if (!canRetry) throw error;
				log.warn("Retrying transient navigation failure", {
					url,
					attempt: attempt + 1,
					error: error instanceof Error ? error.message : String(error),
				});
				await this.waitForNavigationRetry(attempt);
			}
		}
		throw lastError;
	}

	// ── Actions ─────────────────────────────────────────────────────────

	/**
	 * Open a URL in the browser.
	 *
	 * If no browser is connected, this will attempt to attach to a
	 * running browser on the configured debug port first. This is the
	 * canonical first action — it should work as `bc browser open <url>`.
	 */
	async open(
		options: OpenOptions,
	): Promise<ActionResult<{ url: string; title: string; tabId: string }>> {
		const sessionId = this.getSessionId();
		const startTime = Date.now();

		// Section 14: resolve stable local URLs before navigation
		let resolvedUrl = options.url;
		const registry = this.context.serviceRegistry ?? globalServiceRegistry;
		if (mightBeServiceRef(options.url, registry)) {
			const resolveResult = await resolveServiceUrl(options.url, registry);
			if ("error" in resolveResult) {
				return this.failureWithDebug(
					resolveResult.error,
					new Error(resolveResult.error),
					{
						action: "browser_navigate",
						path: "a11y",
						sessionId,
					},
				);
			}
			resolvedUrl = resolveResult.url;
			if (resolveResult.service) {
				log.info("Resolved service ref", {
					input: options.url,
					resolvedUrl,
					service: resolveResult.service.name,
				});
			}
		}

		// Policy check — returns PolicyAllowResult on allow
		const policyEval = this.context.sessionManager.evaluateAction(
			"browser_navigate",
			{ url: resolvedUrl },
		);
		if (!isPolicyAllowed(policyEval))
			return policyEval as ActionResult<{ url: string; title: string; tabId: string }>;

		try {
			// Auto-attach if no browser is connected yet
			const pageOrErr = await this.ensureBrowserConnected();
			if ("success" in pageOrErr)
				return pageOrErr as ActionResult<{ url: string; title: string; tabId: string }>;

			// Reuse the focused blank tab when present; otherwise open a new tab.
			// Chrome's New Tab URL differs by channel/profile, so use the shared blank predicate.
			const bm = this.context.sessionManager.getBrowserManager();
			const context = bm.getContext();
			let page: Page;
			if (context) {
				const rawPages = context.pages();
				const pages = await this.getVisiblePages(rawPages);
				const preferredBlank =
					pages.find((candidate) => candidate === pageOrErr && this.isBlankBrowserPage(candidate)) ??
					(pages.length === 1 && this.isBlankBrowserPage(pages[0]) ? pages[0] : undefined);
				if (preferredBlank) {
					page = preferredBlank;
					const windowTargets = await this.getWindowTargets(rawPages);
					const target = windowTargets.find((t) => t.page === page);
					if (target) {
						await this.activateWindowTarget(target);
					}
				} else {
					page = await context.newPage();
				}
			} else {
				page = await this.getBestVisiblePage(pageOrErr as Page);
			}

			await this.startObservability(page, sessionId);
			await this.applyNetworkPrivacyRules(page, sessionId);
			await this.navigateWithRetry(page, resolvedUrl, options.waitUntil);
			const openedTarget = await this.getWindowTarget(page);
			if (openedTarget) {
				await this.activateWindowTarget(openedTarget);
			}
			await this.foregroundPage(page);
			const title = await page.title();
			await this.persistObservability(sessionId, page);

			this.syncDialogHandlingMode();
			this.dialogSupervisor.attachToPage(page, sessionId);

			const finalTabId = await this.getTabIdForPage(page, "0");
			this.rememberActiveTab(finalTabId);

			log.info("Opened URL", {
				url: resolvedUrl,
				title,
				originalInput: options.url,
				tabId: finalTabId,
			});

			// Record timeline event (Section 26)
			this.recordTimelineEvent({
				action: "open",
				target: resolvedUrl,
				url: page.url(),
				title,
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				durationMs: Date.now() - startTime,
				success: true,
			});

			const result = successResult(
				{ url: page.url(), title, tabId: finalTabId },
				{
					path: policyEval.path,
					sessionId,
					policyDecision: policyEval.policyDecision,
					risk: policyEval.risk,
					auditId: policyEval.auditId,
				},
			);
			this.recordPackageAction(
				"browser-open",
				{ url: options.url, resolvedUrl, waitUntil: options.waitUntil },
				result,
			);
			return result;
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			log.error(`Failed to open URL: ${message}`);

			// Record timeline event (Section 26)
			this.recordTimelineEvent({
				action: "open",
				target: resolvedUrl,
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				durationMs: Date.now() - startTime,
				success: false,
				error: message,
			});

			return this.failureWithDebug(
				`Failed to open ${options.url}: ${message}`,
				error,
				{
					action: "browser_navigate",
					path: policyEval.path,
					sessionId,
					policyDecision: policyEval.policyDecision,
					risk: policyEval.risk,
					auditId: policyEval.auditId,
				},
			);
		}
	}

	/**
	 * Navigate the selected tab or the front-most tab to a URL.
	 */
	async navigate(
		options: OpenOptions & { tabId?: string },
	): Promise<ActionResult<{ url: string; title: string; tabId: string }>> {
		const sessionId = this.getSessionId();
		const startTime = Date.now();

		let resolvedUrl = options.url;
		const registry = this.context.serviceRegistry ?? globalServiceRegistry;
		if (mightBeServiceRef(options.url, registry)) {
			const resolveResult = await resolveServiceUrl(options.url, registry);
			if ("error" in resolveResult) {
				return this.failureWithDebug(
					resolveResult.error,
					new Error(resolveResult.error),
					{
						action: "browser_navigate",
						path: "a11y",
						sessionId,
					},
				);
			}
			resolvedUrl = resolveResult.url;
		}

		const policyEval = this.context.sessionManager.evaluateAction(
			"browser_navigate",
			{ url: resolvedUrl },
		);
		if (!isPolicyAllowed(policyEval))
			return policyEval as ActionResult<{ url: string; title: string; tabId: string }>;

		try {
			const pageOrErr = await this.getConnectedPageForAction<{
				url: string;
				title: string;
				tabId: string;
			}>(options.tabId);
			if ("success" in pageOrErr) return pageOrErr;
			const page = pageOrErr;

			await this.navigateWithRetry(page, resolvedUrl, options.waitUntil);
			const title = await page.title();
			await this.persistObservability(sessionId, page);
			const finalTabId = await this.getTabIdForPage(page, options.tabId ?? "0");
			this.rememberActiveTab(finalTabId);

			this.recordTimelineEvent({
				action: "navigate",
				target: resolvedUrl,
				url: page.url(),
				title,
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				durationMs: Date.now() - startTime,
				success: true,
			});

			const result = successResult(
				{ url: page.url(), title, tabId: finalTabId },
				{
					path: policyEval.path,
					sessionId,
					policyDecision: policyEval.policyDecision,
					risk: policyEval.risk,
					auditId: policyEval.auditId,
				},
			);
			this.recordPackageAction(
				"browser-open",
				{
					url: options.url,
					resolvedUrl,
					tabId: options.tabId,
					waitUntil: options.waitUntil,
				},
				result,
			);
			return result;
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			this.recordTimelineEvent({
				action: "navigate",
				target: resolvedUrl,
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				durationMs: Date.now() - startTime,
				success: false,
				error: message,
			});
			return this.failureWithDebug(
				`Failed to navigate ${options.url}: ${message}`,
				error,
				{
					action: "browser_navigate",
					path: policyEval.path,
					sessionId,
					policyDecision: policyEval.policyDecision,
					risk: policyEval.risk,
					auditId: policyEval.auditId,
				},
			);
		}
	}

	/**
	 * Open multiple URLs in parallel/sequence tabs.
	 */
	async openMany(
		items: OpenManyItem[],
		options: OpenManyOptions = {},
	): Promise<ActionResult<{ browserSessionId: string; tabs: OpenManyTabResult[] }>> {
		const sessionId = this.getSessionId();

		for (const item of items) {
			const policyEval = this.context.sessionManager.evaluateAction(
				"browser_navigate",
				{ url: item.url },
			);
			if (!isPolicyAllowed(policyEval)) {
				return policyEval as ActionResult<{ browserSessionId: string; tabs: OpenManyTabResult[] }>;
			}
		}

		try {
			const pageOrErr = await this.ensureBrowserConnected();
			if ("success" in pageOrErr)
				return pageOrErr as ActionResult<{ browserSessionId: string; tabs: OpenManyTabResult[] }>;

			const bm = this.context.sessionManager.getBrowserManager();
			const context = bm.getContext();
			if (!context) {
				return this.failureWithDebug(
					"No browser context available",
					new Error("No browser context available"),
					{ action: "browser_open_many", path: "a11y", sessionId },
				);
			}

			const tabs: OpenManyTabResult[] = new Array(items.length);
			const openTab = async (item: OpenManyItem, index: number): Promise<void> => {
				let page: Page;
				const pages = context.pages();
				if (index === 0 && pages.length === 1 && this.isBlankBrowserPage(pages[0])) {
					page = pages[0];
				} else {
					page = await context.newPage();
				}

				await this.startObservability(page, sessionId);
				await this.applyNetworkPrivacyRules(page, sessionId);
				this.syncDialogHandlingMode();
				this.dialogSupervisor.attachToPage(page, sessionId);

				try {
					await this.navigateWithRetry(page, item.url, item.waitUntil);
					const tabId = await this.getTabIdForPage(page, "0");
					const title = await page.title().catch(() => undefined);
					tabs[index] = {
						tabId,
						label: item.label,
						url: page.url(),
						title,
						status: "loaded",
					};
				} catch (err: unknown) {
					const tabId = await this.getTabIdForPage(page, "0");
					const title = await page.title().catch(() => undefined);
					tabs[index] = {
						tabId,
						label: item.label,
						url: page.url() || item.url,
						title,
						status: "failed",
						error: err instanceof Error ? err.message : String(err),
					};
				}
			};

			if (options.parallel) {
				const concurrency = Math.max(
					1,
					Math.min(options.concurrency ?? OPEN_MANY_PARALLEL_LIMIT, items.length),
				);
				let nextIndex = 0;
				const workers = Array.from({ length: concurrency }, async () => {
					while (nextIndex < items.length) {
						const index = nextIndex;
						nextIndex += 1;
						await openTab(items[index], index);
					}
				});
				await Promise.all(workers);
			} else {
				for (const [index, item] of items.entries()) {
					await openTab(item, index);
				}
			}

			const allFailed = tabs.length > 0 && tabs.every(t => t.status === "failed");

			if (allFailed) {
				return this.failureWithDebug(
					"All tabs failed to load",
					new Error("All tabs failed to load"),
					{ action: "browser_open_many", path: "a11y", sessionId },
				);
			}

			const someFailed = tabs.some(t => t.status === "failed");
			const result = successResult({
				browserSessionId: sessionId,
				tabs,
				...(someFailed ? { warning: `${tabs.filter(t => t.status === "failed").length} of ${tabs.length} tabs failed to load` } : {}),
			}, { path: "a11y", sessionId });
			for (const [index, tab] of tabs.entries()) {
				if (tab.status === "failed") continue;
				const item = items[index];
				this.recordPackageAction(
					"browser-open",
					{
						url: item?.url ?? tab.url,
						label: tab.label,
						waitUntil: item?.waitUntil,
					},
					successResult(tab, { path: "a11y", sessionId }),
				);
			}
			return result;
		} catch (error: unknown) {
			return this.failureWithDebug(
				`Failed to open many: ${error instanceof Error ? error.message : String(error)}`,
				error,
				{ action: "browser_open_many", path: "a11y", sessionId },
			);
		}
	}

	/**
	 * Capture state (accessibility snapshot and/or screenshot) of a tab.
	 */
	async capture(options?: {
		tabId?: string;
		snapshot?: boolean;
		screenshot?: boolean;
		fullPage?: boolean;
	}): Promise<ActionResult<CaptureResult>> {
		const sessionId = this.getSessionId();

		try {
			const pageOrErr = await this.getConnectedPageForAction<CaptureResult>(options?.tabId);
			if ("success" in pageOrErr) return pageOrErr;
			const page = pageOrErr;

			const tabId = await this.getTabIdForPage(page, options?.tabId ?? "0");
			const result: CaptureResult = {
				tabId,
				url: page.url(),
				title: await page.title().catch(() => undefined),
			};

			if (options?.snapshot !== false) {
				const snap = await snapshot(page, {
					sessionId,
					boxes: true,
					pendingDialogs: this.getPendingDialogsForSnapshot(sessionId),
				});
				const pageId = getPageId(page.url(), sessionId);
				this.refStore.setSnapshot(pageId, snap);
				result.snapshot = snap;
			}

			if (options?.screenshot) {
				const screenshotRes = await this.screenshot({
					fullPage: options.fullPage,
					tabId,
				});
				if (screenshotRes.success && screenshotRes.data) {
					result.screenshot = screenshotRes.data;
				}
			}

			const actionResult = successResult(result, { path: "a11y", sessionId });
			if (result.snapshot) {
				this.recordPackageAction(
					"browser-snapshot",
					{ tabId: options?.tabId, boxes: true },
					successResult(result.snapshot, { path: "a11y", sessionId }),
				);
			}
			return actionResult;
		} catch (error: unknown) {
			return this.failureWithDebug(
				`Capture failed: ${error instanceof Error ? error.message : String(error)}`,
				error,
				{ action: "browser_capture", path: "a11y", sessionId },
			);
		}
	}

	/**
	 * Capture state of multiple tabs.
	 */
	async captureMany(
		tabIds: string[],
		options?: {
			snapshot?: boolean;
			screenshot?: boolean;
			fullPage?: boolean;
		},
	): Promise<ActionResult<{ captures: CaptureResult[] }>> {
		const sessionId = this.getSessionId();
		const captures: CaptureResult[] = [];

		for (const tabId of tabIds) {
			const res = await this.capture({
				tabId,
				snapshot: options?.snapshot,
				screenshot: options?.screenshot,
				fullPage: options?.fullPage,
			});
			if (res.success && res.data) {
				captures.push(res.data);
			} else {
				return failureResult(res.error || `Failed to capture tab ${tabId}`, {
					path: "a11y",
					sessionId,
				});
			}
		}

		return successResult({ captures }, { path: "a11y", sessionId });
	}

	/**
	 * Dialog detection and response command.
	 */
	async dialog(options: {
		action: "list" | "respond";
		dialog_id?: string;
		response?: "accept" | "dismiss";
		text?: string;
		tabId?: string;
	}): Promise<ActionResult<{ dialogs: DialogInfo[]; tabId?: string } | (DialogResponse & { tabId?: string })>> {
		const sessionId = this.getSessionId();

		const policyEval = this.context.sessionManager.evaluateAction(
			"browser_dialog",
			options,
		);
		if (!isPolicyAllowed(policyEval))
			return policyEval as ActionResult<{ dialogs: DialogInfo[] } | DialogResponse>;

		try {
			if (options.action === "list") {
				let tabId: string | undefined;
				if (options.tabId !== undefined) {
					const pageOrErr = await this.getConnectedPageForAction<{ dialogs: DialogInfo[]; tabId?: string }>(options.tabId);
					if ("success" in pageOrErr) return pageOrErr;
					tabId = await this.getTabIdForPage(pageOrErr, options.tabId);
				}
				const dialogs = this.dialogSupervisor.getPendingDialogs(sessionId);
				return successResult({ dialogs, tabId }, { path: "a11y", sessionId });
			} else {
				if (!options.dialog_id) {
					return failureResult("dialog_id is required for respond action", {
						path: "a11y",
						sessionId,
					});
				}
				const action = options.response ?? "accept";
				let page = this.tryGetPage() || undefined;
				let tabId: string | undefined;
				if (options.tabId !== undefined) {
					const pageOrErr = await this.getConnectedPageForAction<DialogResponse & { tabId?: string }>(options.tabId);
					if ("success" in pageOrErr) return pageOrErr;
					page = pageOrErr;
					tabId = await this.getTabIdForPage(page, options.tabId);
				} else if (page) {
					tabId = await this.getTabIdForPage(page, "0");
				}
				const value = this.dialogSupervisor.respond(
					options.dialog_id,
					action,
					page,
					options.text,
					sessionId,
				);
				return successResult({ ...value, tabId }, { path: "a11y", sessionId });
			}
		} catch (error: unknown) {
			return this.failureWithDebug(
				`Dialog action failed: ${error instanceof Error ? error.message : String(error)}`,
				error,
				{ action: "browser_dialog", path: "a11y", sessionId },
			);
		}
	}

	/**
	 * Execute a raw CDP command via passthrough.
	 */
	async cdp(options: {
		method: string;
		params?: Record<string, unknown>;
		targetId?: string;
		frameId?: string;
		timeoutMs: number;
		tabId?: string;
	}): Promise<ActionResult<{ result: unknown; tabId: string }>> {
		const sessionId = this.getSessionId();

		const policyEval = this.context.sessionManager.evaluateAction(
			"cdp_execute",
			{ method: options.method },
		);
		if (!isPolicyAllowed(policyEval)) {
			await recordCdpAuditEvent({
				action: "cdp_execute_denied",
				sessionId,
				method: options.method,
				options,
				policyDecision: policyEval.policyDecision,
				error: policyEval.error,
				success: false,
			}).catch((error: unknown) => {
				log.warn("Failed to record CDP policy denial audit event", {
					error: error instanceof Error ? error.message : String(error),
				});
			});
			return policyEval as ActionResult<{ result: unknown; tabId: string }>;
		}

		try {
			const pageOrErr = await this.getConnectedPageForAction<{ result: unknown; tabId: string }>(options.tabId);
			if ("success" in pageOrErr) return pageOrErr;
			const page = pageOrErr;
			const tabId = await this.getTabIdForPage(page, options.tabId ?? "0");
			const { executeCdpCommand } = await import("./cdp_passthrough");
			const result = await executeCdpCommand(page, options, sessionId);
			if (!result.success || !result.data) {
				await recordCdpAuditEvent({
					action: "cdp_execute_denied",
					sessionId,
					method: options.method,
					options,
					tabId,
					policyDecision: policyEval.policyDecision,
					error: result.error,
					success: false,
				}).catch((error: unknown) => {
					log.warn("Failed to record CDP denial audit event", {
						error: error instanceof Error ? error.message : String(error),
					});
				});
				return failureResult(result.error ?? "CDP command failed", {
					path: result.path ?? "low_level",
					sessionId,
					policyDecision: policyEval.policyDecision,
					risk: policyEval.risk,
					auditId: policyEval.auditId,
				}) as ActionResult<{ result: unknown; tabId: string }>;
			}
			await recordCdpAuditEvent({
				action: "cdp_execute_success",
				sessionId,
				method: options.method,
				options,
				tabId,
				policyDecision: policyEval.policyDecision,
				result: result.data.result,
				success: true,
			}).catch((error: unknown) => {
				log.warn("Failed to record CDP success audit event", {
					error: error instanceof Error ? error.message : String(error),
				});
			});
			return successResult({ ...result.data, tabId }, {
				path: result.path ?? "low_level",
				sessionId,
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				auditId: policyEval.auditId,
			});
		} catch (error: unknown) {
			await recordCdpAuditEvent({
				action: "cdp_execute_failed",
				sessionId,
				method: options.method,
				options,
				policyDecision: policyEval.policyDecision,
				error: error instanceof Error ? error.message : String(error),
				success: false,
			}).catch((auditError: unknown) => {
				log.warn("Failed to record CDP failure audit event", {
					error: auditError instanceof Error ? auditError.message : String(auditError),
				});
			});
			return this.failureWithDebug(
				`CDP action failed: ${error instanceof Error ? error.message : String(error)}`,
				error,
				{ action: "cdp_execute", path: "low_level", sessionId },
			);
		}
	}


	/**
	 * Take an accessibility snapshot of the current page.
	 */
	async takeSnapshot(
		options: SnapshotOptions = {},
	): Promise<ActionResult<A11ySnapshot>> {
		const sessionId = this.getSessionId();
		const startTime = Date.now();

		// Snapshot is low-risk but still routes through policy for consistency
		const policyEval = this.context.sessionManager.evaluateAction(
			"browser_snapshot",
			{},
		);
		if (!isPolicyAllowed(policyEval))
			return policyEval as ActionResult<A11ySnapshot>;

		try {
			const pageOrErr = await this.getConnectedPageForAction<A11ySnapshot>(options.tabId);
			if ("success" in pageOrErr) return pageOrErr;
			const page = pageOrErr;
			const snap = await snapshot(page, {
				sessionId,
				rootSelector: options.rootSelector,
				boxes: options.boxes,
				pendingDialogs: this.getPendingDialogsForSnapshot(sessionId),
			});

			// Store snapshot in ref store
			const pageId = getPageId(page.url(), sessionId);
			this.refStore.setSnapshot(pageId, snap);

			log.info("Snapshot taken", {
				elements: snap.elements.length,
				pageUrl: snap.pageUrl,
				boxes: options.boxes,
			});
			await this.persistObservability(sessionId, page);

			this.recordTimelineEvent({
				action: "snapshot",
				url: page.url(),
				title: await page.title().catch(() => undefined),
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				durationMs: Date.now() - startTime,
				success: true,
			});

			const result = successResult(snap, {
				path: policyEval.path,
				sessionId,
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				auditId: policyEval.auditId,
			});
			this.recordPackageAction(
				"browser-snapshot",
				{
					rootSelector: options.rootSelector,
					boxes: options.boxes,
					tabId: options.tabId,
				},
				result,
			);
			return result;
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			log.error(`Snapshot failed: ${message}`);
			this.recordTimelineEvent({
				action: "snapshot",
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				durationMs: Date.now() - startTime,
				success: false,
				error: message,
			});
			return this.failureWithDebug(`Snapshot failed: ${message}`, error, {
				action: "browser_snapshot",
				path: policyEval.path,
				sessionId,
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				auditId: policyEval.auditId,
			});
		}
	}

	/**
	 * Click a target element.
	 */
	async click(
		options: ClickOptions,
	): Promise<ActionResult<{ clicked: string; tabId: string }>> {
		const sessionId = this.getSessionId();
		const startTime = Date.now();

		// Policy check
		const policyEval = this.context.sessionManager.evaluateAction(
			"browser_click",
			{ target: options.target },
		);
		if (!isPolicyAllowed(policyEval))
			return policyEval as ActionResult<{ clicked: string; tabId: string }>;

		try {
			const pageOrErr = await this.getConnectedPageForAction<{
				clicked: string;
				tabId: string;
			}>(options.tabId);
			if ("success" in pageOrErr) return pageOrErr;
			const page = pageOrErr;
			const resolved = await this.runLocatorActionWithRetry(
				"click",
				options.target,
				page,
				sessionId,
				async (target) => {
					await this.prepareLocatorAction(
						page,
						target.locator,
						options.timeoutMs ?? 5000,
					);
					await target.locator.click({
						timeout: options.timeoutMs ?? 5000,
						force: options.force,
					});
				},
			);

			if (!resolved) {
				this.recordTimelineEvent({
					action: "click",
					target: options.target,
					policyDecision: policyEval.policyDecision,
					risk: policyEval.risk,
					durationMs: Date.now() - startTime,
					success: false,
					error: `Could not resolve click target: ${options.target}`,
				});
				return this.failureWithDebug(
					`Could not resolve click target: ${options.target}`,
					new Error(`Could not resolve click target: ${options.target}`),
					{
						action: "browser_click",
						path: policyEval.path,
						sessionId,
						policyDecision: policyEval.policyDecision,
						risk: policyEval.risk,
						auditId: policyEval.auditId,
					},
				);
			}

			log.info("Clicked element", { target: options.target });
			await this.persistObservability(sessionId, page);

			this.recordTimelineEvent({
				action: "click",
				target: options.target,
				url: page.url(),
				title: await page.title().catch(() => undefined),
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				durationMs: Date.now() - startTime,
				success: true,
			});

			const result = successResult(
				{ clicked: resolved.description, tabId: await this.getTabIdForPage(page, options.tabId ?? "0") },
				{
					path: policyEval.path,
					sessionId,
					policyDecision: policyEval.policyDecision,
					risk: policyEval.risk,
					auditId: policyEval.auditId,
				},
			);
			this.recordPackageAction(
				"browser-click",
				{
					target: options.target,
					tabId: options.tabId,
					timeoutMs: options.timeoutMs,
					force: options.force,
				},
				result,
			);
			return result;
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			this.recordTimelineEvent({
				action: "click",
				target: options.target,
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				durationMs: Date.now() - startTime,
				success: false,
				error: message,
			});
			return this.failureWithDebug(
				`Click failed for "${options.target}": ${message}`,
				error,
				{
					action: "browser_click",
					path: policyEval.path,
					sessionId,
					policyDecision: policyEval.policyDecision,
					risk: policyEval.risk,
					auditId: policyEval.auditId,
				},
			);
		}
	}

	/**
	 * Fill a target element with text.
	 */
	async fill(options: FillOptions): Promise<ActionResult<{ filled: string; tabId: string }>> {
		const sessionId = this.getSessionId();
		const startTime = Date.now();
		let secretValues: string[] = [];

		// Policy check — fill with credentials is higher risk
		const policyEval = this.context.sessionManager.evaluateAction(
			"browser_fill",
			this.secretAwarePolicyParams(options.text, { target: options.target }),
		);
		if (!isPolicyAllowed(policyEval))
			return policyEval as ActionResult<{ filled: string; tabId: string }>;

		try {
			const pageOrErr = await this.getConnectedPageForAction<{
				filled: string;
				tabId: string;
			}>(options.tabId);
			if ("success" in pageOrErr) return pageOrErr;
			const page = pageOrErr;
			const timeoutMs = options.timeoutMs ? Number(options.timeoutMs) : 5000;
			const resolvedText = await this.resolveSecretTextForBrowser(
				options.text,
				"use-as-form-value",
				page,
				sessionId,
				policyEval.policyDecision,
			);
			secretValues = resolvedText.secretValues;
			const resolved = await this.runLocatorActionWithRetry(
				"fill",
				options.target,
				page,
				sessionId,
				async (target) => {
					await this.prepareLocatorAction(page, target.locator, timeoutMs);
					await target.locator.fill(resolvedText.text, { timeout: timeoutMs });
					if (options.commit) await target.locator.press("Tab");
				},
			);

			if (!resolved) {
				this.recordTimelineEvent({
					action: "fill",
					target: options.target,
					policyDecision: policyEval.policyDecision,
					risk: policyEval.risk,
					durationMs: Date.now() - startTime,
					success: false,
					error: `Could not resolve fill target: ${options.target}`,
				});
				return this.failureWithDebug(
					`Could not resolve fill target: ${options.target}`,
					new Error(`Could not resolve fill target: ${options.target}`),
					{
						action: "browser_fill",
						path: policyEval.path,
						sessionId,
						policyDecision: policyEval.policyDecision,
						risk: policyEval.risk,
						auditId: policyEval.auditId,
					},
				);
			}

			log.info("Filled element", { target: options.target });
			await this.persistObservability(sessionId, page);

			this.recordTimelineEvent({
				action: "fill",
				target: options.target,
				url: page.url(),
				title: await page.title().catch(() => undefined),
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				durationMs: Date.now() - startTime,
				success: true,
			});

			const result = successResult(
				{ filled: resolved.description, tabId: await this.getTabIdForPage(page, options.tabId ?? "0") },
				{
					path: policyEval.path,
					sessionId,
					policyDecision: policyEval.policyDecision,
					risk: policyEval.risk,
					auditId: policyEval.auditId,
				},
			);
			this.recordPackageAction(
				"browser-fill",
				{
					target: options.target,
					text: options.text,
					tabId: options.tabId,
					timeoutMs: options.timeoutMs,
					commit: options.commit,
				},
				result,
			);
			return result;
		} catch (error: unknown) {
			const message = this.redactSecretMessage(
				error instanceof Error ? error.message : String(error),
				secretValues,
			);
			this.recordTimelineEvent({
				action: "fill",
				target: options.target,
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				durationMs: Date.now() - startTime,
				success: false,
				error: message,
			});
			return this.failureWithDebug(
				`Fill failed for "${options.target}": ${message}`,
				error,
				{
					action: "browser_fill",
					path: policyEval.path,
					sessionId,
					policyDecision: policyEval.policyDecision,
					risk: policyEval.risk,
					auditId: policyEval.auditId,
				},
			);
		}
	}

	/**
	 * Fill multiple fields sequentially on the current page.
	 */
	async fillMany(
		fields: FillField[],
		options: FillManyOptions = {},
	): Promise<ActionResult<{ tabId: string; fields: FillManyFieldResult[] }>> {
		const sessionId = this.getSessionId();
		const startTime = Date.now();
		const results: FillManyFieldResult[] = [];
		const secretValues: string[] = [];

		if (!Array.isArray(fields)) {
			return failureResult("fillMany fields must be an array", {
				path: "a11y",
				sessionId,
			});
		}
		if (fields.length === 0) {
			return failureResult("fillMany requires at least one field", {
				path: "a11y",
				sessionId,
			});
		}
		if (fields.length > 100) {
			return failureResult("fillMany supports at most 100 fields per call", {
				path: "a11y",
				sessionId,
			});
		}

		const invalidField = fields.find(
			(field) =>
				!field ||
				typeof field.target !== "string" ||
				field.target.trim().length === 0 ||
				typeof field.text !== "string",
		);
		if (invalidField) {
			return failureResult(
				"fillMany fields must include non-empty string target and string text",
				{ path: "a11y", sessionId },
			);
		}

		const policyEval = this.context.sessionManager.evaluateAction("browser_fill", {
			fields: fields.map((field) =>
				this.secretAwarePolicyParams(field.text, { target: field.target }),
			),
			count: fields.length,
		});
		if (!isPolicyAllowed(policyEval)) {
			return policyEval as ActionResult<{
				tabId: string;
				fields: FillManyFieldResult[];
			}>;
		}

		try {
			const pageOrErr = await this.getConnectedPageForAction<{
				tabId: string;
				fields: FillManyFieldResult[];
			}>(options.tabId);
			if ("success" in pageOrErr) return pageOrErr;
			const page = pageOrErr;
			const tabId = await this.getTabIdForPage(page, options.tabId ?? "0");
			const timeoutMs = options.timeoutMs ? Number(options.timeoutMs) : 5000;

			for (const field of fields) {
				try {
					const resolvedText = await this.resolveSecretTextForBrowser(
						field.text,
						"use-as-form-value",
						page,
						sessionId,
						policyEval.policyDecision,
					);
					secretValues.push(...resolvedText.secretValues);
					const resolved = await this.runLocatorActionWithRetry(
						"fill",
						field.target,
						page,
						sessionId,
						async (target) => {
							await this.prepareLocatorAction(page, target.locator, timeoutMs);
							await target.locator.fill(resolvedText.text, {
								timeout: timeoutMs,
							});
						},
					);

					if (!resolved) {
						const error = `Could not resolve fill target: ${field.target}`;
						results.push({ target: field.target, success: false, error });
						if (!options.continueOnFailure) {
							this.recordTimelineEvent({
								action: "fillMany",
								target: `${fields.length} fields`,
								policyDecision: policyEval.policyDecision,
								risk: policyEval.risk,
								durationMs: Date.now() - startTime,
								success: false,
								error,
							});
							return this.failureWithDebug(
								`fillMany failed at target "${field.target}": ${error}`,
								new Error(error),
								{
									action: "browser_fill_many",
									path: policyEval.path,
									sessionId,
									policyDecision: policyEval.policyDecision,
									risk: policyEval.risk,
									auditId: policyEval.auditId,
								},
							);
						}
						continue;
					}

					results.push({ target: field.target, success: true });
				} catch (error: unknown) {
					const message = this.redactSecretMessage(
						error instanceof Error ? error.message : String(error),
						secretValues,
					);
					results.push({
						target: field.target,
						success: false,
						error: message,
					});
					if (!options.continueOnFailure) {
						this.recordTimelineEvent({
							action: "fillMany",
							target: `${fields.length} fields`,
							policyDecision: policyEval.policyDecision,
							risk: policyEval.risk,
							durationMs: Date.now() - startTime,
							success: false,
							error: message,
						});
						return this.failureWithDebug(
							`fillMany failed at target "${field.target}": ${message}`,
							error,
							{
								action: "browser_fill_many",
								path: policyEval.path,
								sessionId,
								policyDecision: policyEval.policyDecision,
								risk: policyEval.risk,
								auditId: policyEval.auditId,
							},
						);
					}
				}
			}

			await this.persistObservability(sessionId, page);
			this.recordTimelineEvent({
				action: "fillMany",
				target: `${fields.length} fields`,
				url: page.url(),
				title: await page.title().catch(() => undefined),
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				durationMs: Date.now() - startTime,
				success: results.every((field) => field.success),
			});

			return successResult(
				{ tabId, fields: results },
				{
					path: policyEval.path,
					sessionId,
					policyDecision: policyEval.policyDecision,
					risk: policyEval.risk,
					auditId: policyEval.auditId,
				},
			);
		} catch (error: unknown) {
			const message = this.redactSecretMessage(
				error instanceof Error ? error.message : String(error),
				secretValues,
			);
			this.recordTimelineEvent({
				action: "fillMany",
				target: `${fields.length} fields`,
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				durationMs: Date.now() - startTime,
				success: false,
				error: message,
			});
			return this.failureWithDebug(`fillMany failed: ${message}`, error, {
				action: "browser_fill_many",
				path: policyEval.path,
				sessionId,
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				auditId: policyEval.auditId,
			});
		}
	}

	/**
	 * Hover over a target element.
	 */
	async hover(
		options: HoverOptions,
	): Promise<ActionResult<{ hovered: string; tabId: string }>> {
		const sessionId = this.getSessionId();
		const startTime = Date.now();

		const policyEval = this.context.sessionManager.evaluateAction(
			"browser_hover",
			{ target: options.target },
		);
		if (!isPolicyAllowed(policyEval))
			return policyEval as ActionResult<{ hovered: string; tabId: string }>;

		try {
			const pageOrErr = await this.getConnectedPageForAction<{
				hovered: string;
				tabId: string;
			}>(options.tabId);
			if ("success" in pageOrErr) return pageOrErr;
			const page = pageOrErr;
			const resolved = await this.runLocatorActionWithRetry(
				"hover",
				options.target,
				page,
				sessionId,
				async (target) => {
					await this.prepareLocatorAction(
						page,
						target.locator,
						options.timeoutMs ?? 5000,
					);
					await target.locator.hover({ timeout: options.timeoutMs ?? 5000 });
				},
			);

			if (!resolved) {
				this.recordTimelineEvent({
					action: "hover",
					target: options.target,
					policyDecision: policyEval.policyDecision,
					risk: policyEval.risk,
					durationMs: Date.now() - startTime,
					success: false,
					error: `Could not resolve hover target: ${options.target}`,
				});
				return this.failureWithDebug(
					`Could not resolve hover target: ${options.target}`,
					new Error(`Could not resolve hover target: ${options.target}`),
					{
						action: "browser_hover",
						path: policyEval.path,
						sessionId,
						policyDecision: policyEval.policyDecision,
						risk: policyEval.risk,
						auditId: policyEval.auditId,
					},
				);
			}

			await this.persistObservability(sessionId, page);

			this.recordTimelineEvent({
				action: "hover",
				target: options.target,
				url: page.url(),
				title: await page.title().catch(() => undefined),
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				durationMs: Date.now() - startTime,
				success: true,
			});

			return successResult(
				{ hovered: resolved.description, tabId: await this.getTabIdForPage(page, options.tabId ?? "0") },
				{
					path: policyEval.path,
					sessionId,
					policyDecision: policyEval.policyDecision,
					risk: policyEval.risk,
					auditId: policyEval.auditId,
				},
			);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			this.recordTimelineEvent({
				action: "hover",
				target: options.target,
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				durationMs: Date.now() - startTime,
				success: false,
				error: message,
			});
			return this.failureWithDebug(
				`Hover failed for "${options.target}": ${message}`,
				error,
				{
					action: "browser_hover",
					path: policyEval.path,
					sessionId,
					policyDecision: policyEval.policyDecision,
					risk: policyEval.risk,
					auditId: policyEval.auditId,
				},
			);
		}
	}

	/**
	 * Type text into the currently focused element.
	 */
	async type(options: TypeOptions): Promise<ActionResult<{ typed: string; tabId: string }>> {
		const sessionId = this.getSessionId();
		const startTime = Date.now();
		let secretValues: string[] = [];
		let redactedText = redactSecretRefs(options.text);

		const policyEval = this.context.sessionManager.evaluateAction(
			"browser_type",
			this.secretAwarePolicyParams(options.text),
		);
		if (!isPolicyAllowed(policyEval))
			return policyEval as ActionResult<{ typed: string; tabId: string }>;

		try {
			const pageOrErr = await this.getConnectedPageForAction<{
				typed: string;
				tabId: string;
			}>(options.tabId);
			if ("success" in pageOrErr) return pageOrErr;
			const page = pageOrErr;
			const resolvedText = await this.resolveSecretTextForBrowser(
				options.text,
				"type",
				page,
				sessionId,
				policyEval.policyDecision,
			);
			secretValues = resolvedText.secretValues;
			redactedText = resolvedText.redactedText;
			await page.keyboard.type(resolvedText.text, { delay: options.delayMs ?? 0 });
			await this.persistObservability(sessionId, page);

			this.recordTimelineEvent({
				action: "type",
				target: redactedText.substring(0, 50),
				url: page.url(),
				title: await page.title().catch(() => undefined),
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				durationMs: Date.now() - startTime,
				success: true,
			});

			return successResult(
				{ typed: resolvedText.usedSecret ? resolvedText.redactedText : options.text, tabId: await this.getTabIdForPage(page, options.tabId ?? "0") },
				{
					path: policyEval.path,
					sessionId,
					policyDecision: policyEval.policyDecision,
					risk: policyEval.risk,
					auditId: policyEval.auditId,
				},
			);
		} catch (error: unknown) {
			const message = this.redactSecretMessage(
				error instanceof Error ? error.message : String(error),
				secretValues,
			);
			this.recordTimelineEvent({
				action: "type",
				target: redactedText.substring(0, 50),
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				durationMs: Date.now() - startTime,
				success: false,
				error: message,
			});
			return this.failureWithDebug(`Type failed: ${message}`, error, {
				action: "browser_type",
				path: policyEval.path,
				sessionId,
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				auditId: policyEval.auditId,
			});
		}
	}

	/**
	 * Paste/insert text into the focused element, optionally focusing a target first.
	 */
	async paste(options: PasteOptions): Promise<ActionResult<{ pasted: string; tabId: string }>> {
		const sessionId = this.getSessionId();
		const startTime = Date.now();
		let secretValues: string[] = [];
		let redactedText = redactSecretRefs(options.text);

		const policyEval = this.context.sessionManager.evaluateAction(
			"browser_paste",
			this.secretAwarePolicyParams(options.text, { target: options.target }),
		);
		if (!isPolicyAllowed(policyEval))
			return policyEval as ActionResult<{ pasted: string; tabId: string }>;

		try {
			const pageOrErr = await this.getConnectedPageForAction<{
				pasted: string;
				tabId: string;
			}>(options.tabId);
			if ("success" in pageOrErr) return pageOrErr;
			const page = pageOrErr;
			const resolvedText = await this.resolveSecretTextForBrowser(
				options.text,
				"paste",
				page,
				sessionId,
				policyEval.policyDecision,
			);
			secretValues = resolvedText.secretValues;
			redactedText = resolvedText.redactedText;

			if (options.target) {
				const timeoutMs = options.timeoutMs ? Number(options.timeoutMs) : 5000;
				const resolved = await this.runLocatorActionWithRetry(
					"paste",
					options.target,
					page,
					sessionId,
					async (target) => {
						await this.prepareLocatorAction(page, target.locator, timeoutMs);
						await target.locator.click({ timeout: timeoutMs });
					},
				);
				if (!resolved) {
					return this.failureWithDebug(
						`Could not resolve paste target: ${options.target}`,
						new Error(`Could not resolve paste target: ${options.target}`),
						{
							action: "browser_paste",
							path: policyEval.path,
							sessionId,
							policyDecision: policyEval.policyDecision,
							risk: policyEval.risk,
							auditId: policyEval.auditId,
						},
					);
				}
			}

			await page.keyboard.insertText(resolvedText.text);
			await this.persistObservability(sessionId, page);

			this.recordTimelineEvent({
				action: "paste",
				target: options.target ?? redactedText.substring(0, 50),
				url: page.url(),
				title: await page.title().catch(() => undefined),
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				durationMs: Date.now() - startTime,
				success: true,
			});

			return successResult(
				{
					pasted: resolvedText.usedSecret
						? resolvedText.redactedText
						: options.text,
					tabId: await this.getTabIdForPage(page, options.tabId ?? "0")
				},
				{
					path: policyEval.path,
					sessionId,
					policyDecision: policyEval.policyDecision,
					risk: policyEval.risk,
					auditId: policyEval.auditId,
				},
			);
		} catch (error: unknown) {
			const message = this.redactSecretMessage(
				error instanceof Error ? error.message : String(error),
				secretValues,
			);
			this.recordTimelineEvent({
				action: "paste",
				target: options.target ?? redactedText.substring(0, 50),
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				durationMs: Date.now() - startTime,
				success: false,
				error: message,
			});
			return this.failureWithDebug(`Paste failed: ${message}`, error, {
				action: "browser_paste",
				path: policyEval.path,
				sessionId,
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				auditId: policyEval.auditId,
			});
		}
	}

	/**
	 * Press a keyboard key.
	 */
	async press(
		options: PressOptions,
	): Promise<ActionResult<{ pressed: string; tabId: string }>> {
		const sessionId = this.getSessionId();
		const startTime = Date.now();

		const policyEval = this.context.sessionManager.evaluateAction(
			"browser_press",
			{ key: options.key },
		);
		if (!isPolicyAllowed(policyEval))
			return policyEval as ActionResult<{ pressed: string; tabId: string }>;

		try {
			const pageOrErr = await this.getConnectedPageForAction<{
				pressed: string;
				tabId: string;
			}>(options.tabId);
			if ("success" in pageOrErr) return pageOrErr;
			const page = pageOrErr;
			await page.keyboard.press(options.key);
			await this.persistObservability(sessionId, page);

			this.recordTimelineEvent({
				action: "press",
				target: options.key,
				url: page.url(),
				title: await page.title().catch(() => undefined),
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				durationMs: Date.now() - startTime,
				success: true,
			});

			const result = successResult(
				{ pressed: options.key, tabId: await this.getTabIdForPage(page, options.tabId ?? "0") },
				{
					path: policyEval.path,
					sessionId,
					policyDecision: policyEval.policyDecision,
					risk: policyEval.risk,
					auditId: policyEval.auditId,
				},
			);
			this.recordPackageAction(
				"browser-press",
				{ key: options.key, tabId: options.tabId },
				result,
			);
			return result;
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			this.recordTimelineEvent({
				action: "press",
				target: options.key,
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				durationMs: Date.now() - startTime,
				success: false,
				error: message,
			});
			return this.failureWithDebug(`Press failed: ${message}`, error, {
				action: "browser_press",
				path: policyEval.path,
				sessionId,
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				auditId: policyEval.auditId,
			});
		}
	}

	/**
	 * Scroll in a direction.
	 */
	async scroll(
		options: ScrollOptions,
	): Promise<ActionResult<{ scrolled: string; tabId: string }>> {
		const sessionId = this.getSessionId();
		const startTime = Date.now();

		const policyEval = this.context.sessionManager.evaluateAction(
			"browser_scroll",
			{ direction: options.direction },
		);
		if (!isPolicyAllowed(policyEval))
			return policyEval as ActionResult<{ scrolled: string; tabId: string }>;

		try {
			const pageOrErr = await this.getConnectedPageForAction<{
				scrolled: string;
				amount: number;
				tabId: string;
			}>(options.tabId);
			if ("success" in pageOrErr) return pageOrErr;
			const page = pageOrErr;
			const amount = options.amount ?? 300;
			const delta =
				options.direction === "up" || options.direction === "left"
					? -amount
					: amount;

			if (options.direction === "up" || options.direction === "down") {
				await page.mouse.wheel(0, delta);
			} else {
				await page.mouse.wheel(delta, 0);
			}
			await this.persistObservability(sessionId, page);

			this.recordTimelineEvent({
				action: "scroll",
				target: `${options.direction} ${amount}px`,
				url: page.url(),
				title: await page.title().catch(() => undefined),
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				durationMs: Date.now() - startTime,
				success: true,
			});

			return successResult(
				{ scrolled: `${options.direction} ${amount}px`, tabId: await this.getTabIdForPage(page, options.tabId ?? "0") },
				{
					path: policyEval.path,
					sessionId,
					policyDecision: policyEval.policyDecision,
					risk: policyEval.risk,
					auditId: policyEval.auditId,
				},
			);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			this.recordTimelineEvent({
				action: "scroll",
				target: options.direction,
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				durationMs: Date.now() - startTime,
				success: false,
				error: message,
			});
			return this.failureWithDebug(`Scroll failed: ${message}`, error, {
				action: "browser_scroll",
				path: policyEval.path,
				sessionId,
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				auditId: policyEval.auditId,
			});
		}
	}

	/**
	 * Highlight a target element visually on the page.
	 */
	async highlight(
		options: HighlightOptions,
	): Promise<ActionResult<{ highlighted: string; tabId: string }>> {
		const sessionId = this.getSessionId();
		const startTime = Date.now();

		if (!options.hide && !options.target) {
			return failureResult("'target' is required unless hide is true", {
				path: "a11y",
				sessionId,
			});
		}

		// Highlight is low-risk but still routes through policy
		const policyEval = this.context.sessionManager.evaluateAction(
			"browser_highlight",
			{ target: options.target },
		);
		if (!isPolicyAllowed(policyEval))
			return policyEval as ActionResult<{ highlighted: string; tabId: string }>;

		try {
			const pageOrErr = await this.getConnectedPageForAction<{
				highlighted: string;
				tabId: string;
			}>(options.tabId);
			if ("success" in pageOrErr) return pageOrErr;
			const page = pageOrErr;

			if (options.hide) {
				// Remove highlight overlay
				await page.evaluate(() => {
					const root = document.querySelector(
						"[data-browser-control-highlight-root]",
					);
					if (root) {
						root.remove();
					}
					// Also remove any orphaned highlight nodes
					document
						.querySelectorAll("[data-browser-control-highlight]")
						.forEach((el) => {
							el.remove();
						});
				});
				log.info("Highlight removed", { target: options.target });
				await this.persistObservability(sessionId, page);
				this.recordTimelineEvent({
					action: "highlight",
					target: options.target,
					url: page.url(),
					title: await page.title().catch(() => undefined),
					policyDecision: policyEval.policyDecision,
					risk: policyEval.risk,
					durationMs: Date.now() - startTime,
					success: true,
				});
				return successResult(
					{ highlighted: options.target ?? "all", tabId: await this.getTabIdForPage(page, options.tabId ?? "0") },
					{
						path: policyEval.path,
						sessionId,
						policyDecision: policyEval.policyDecision,
						risk: policyEval.risk,
						auditId: policyEval.auditId,
					},
				);
			}

			// Resolve target to get element bounds
			const target = options.target as string;
			const resolved = await this.resolveTarget(target, page);
			if (!resolved) {
				// Try to take a snapshot first to populate refs
				const snap = await snapshot(page, { sessionId, boxes: true });
				const pageId = getPageId(page.url(), sessionId);
				this.refStore.setSnapshot(pageId, snap);

				const retry = await this.resolveTarget(target, page);
				if (!retry) {
					this.recordTimelineEvent({
						action: "highlight",
						target: options.target,
						policyDecision: policyEval.policyDecision,
						risk: policyEval.risk,
						durationMs: Date.now() - startTime,
						success: false,
						error: `Could not resolve highlight target: ${options.target}`,
					});
					return this.failureWithDebug(
						`Could not resolve highlight target: ${options.target}`,
						new Error(`Could not resolve highlight target: ${options.target}`),
						{
							action: "browser_highlight",
							path: policyEval.path,
							sessionId,
							policyDecision: policyEval.policyDecision,
							risk: policyEval.risk,
							auditId: policyEval.auditId,
						},
					);
				}
				await this.injectHighlightOverlay(
					page,
					retry.locator,
					options.style,
					options.persist,
				);
				await this.persistObservability(sessionId, page);
				this.recordTimelineEvent({
					action: "highlight",
					target: options.target,
					url: page.url(),
					title: await page.title().catch(() => undefined),
					policyDecision: policyEval.policyDecision,
					risk: policyEval.risk,
					durationMs: Date.now() - startTime,
					success: true,
				});
				return successResult(
					{ highlighted: target, tabId: await this.getTabIdForPage(page, options.tabId ?? "0") },
					{
						path: policyEval.path,
						sessionId,
						policyDecision: policyEval.policyDecision,
						risk: policyEval.risk,
						auditId: policyEval.auditId,
					},
				);
			}

			await this.injectHighlightOverlay(
				page,
				resolved.locator,
				options.style,
				options.persist,
			);
			log.info("Highlight injected", {
				target: options.target,
				persist: options.persist,
			});
			await this.persistObservability(sessionId, page);

			this.recordTimelineEvent({
				action: "highlight",
				target: options.target,
				url: page.url(),
				title: await page.title().catch(() => undefined),
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				durationMs: Date.now() - startTime,
				success: true,
			});

			return successResult(
				{ highlighted: target, tabId: await this.getTabIdForPage(page, options.tabId ?? "0") },
				{
					path: policyEval.path,
					sessionId,
					policyDecision: policyEval.policyDecision,
					risk: policyEval.risk,
					auditId: policyEval.auditId,
				},
			);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			this.recordTimelineEvent({
				action: "highlight",
				target: options.target,
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				durationMs: Date.now() - startTime,
				success: false,
				error: message,
			});
			return this.failureWithDebug(
				`Highlight failed for "${options.target}": ${message}`,
				error,
				{
					action: "browser_highlight",
					path: policyEval.path,
					sessionId,
					policyDecision: policyEval.policyDecision,
					risk: policyEval.risk,
					auditId: policyEval.auditId,
				},
			);
		}
	}

	private async injectHighlightOverlay(
		page: Page,
		locator: import("playwright-core").Locator,
		customStyle?: string,
		persist = false,
	): Promise<void> {
		const element = await locator.elementHandle();
		if (!element) return;

		const bounds = await element.boundingBox();
		if (!bounds) return;

		// Sanitize custom style - only allow safe CSS properties
		const safeStyleProperties = [
			"border",
			"border-width",
			"border-style",
			"border-color",
			"background-color",
			"opacity",
			"border-radius",
			"box-shadow",
			"outline",
			"outline-color",
			"outline-width",
			"outline-style",
		];

		let sanitizedStyle = "";
		if (customStyle) {
			// Parse custom style and only allow safe properties
			const styleRules = customStyle.split(";").filter((rule) => rule.trim());
			for (const rule of styleRules) {
				const colonIndex = rule.indexOf(":");
				if (colonIndex === -1) continue;
				const property = rule.slice(0, colonIndex).trim().toLowerCase();
				const value = rule.slice(colonIndex + 1).trim();
				if (safeStyleProperties.includes(property) && isSafeHighlightStyleValue(value)) {
					sanitizedStyle += `${property}: ${value}; `;
				}
			}
		}

		// Default style if no custom style provided
		if (!sanitizedStyle) {
			sanitizedStyle = `
        border: 3px solid #ff0000;
        background-color: rgba(255, 0, 0, 0.2);
      `;
		}

		await page.evaluate(
			({ bounds: b, style: s, persist: p }) => {
				// Check if root container exists
				let root = document.querySelector(
					"[data-browser-control-highlight-root]",
				) as HTMLElement;
				if (!root) {
					root = document.createElement("div");
					root.setAttribute("data-browser-control-highlight-root", "true");
					root.style.position = "fixed";
					root.style.top = "0";
					root.style.left = "0";
					root.style.width = "100%";
					root.style.height = "100%";
					root.style.pointerEvents = "none";
					root.style.zIndex = "2147483647";
					document.body.appendChild(root);
				}

				const overlay = document.createElement("div");
				overlay.setAttribute("data-browser-control-highlight", "true");

				// Apply sanitized custom style first
				overlay.style.cssText = s;

				// Force safety constraints - these override any user-provided values
				overlay.style.position = "absolute";
				overlay.style.pointerEvents = "none";
				overlay.style.zIndex = "2147483647";
				overlay.style.left = `${b.x}px`;
				overlay.style.top = `${b.y}px`;
				overlay.style.width = `${b.width}px`;
				overlay.style.height = `${b.height}px`;
				overlay.textContent = p ? "highlighted" : "";

				root.appendChild(overlay);

				// If not persisting, auto-remove after 5 seconds
				if (!p) {
					setTimeout(() => {
						overlay.remove();
						// Remove root if empty
						if (root.children.length === 0) {
							root.remove();
						}
					}, 5000);
				}
			},
			{ bounds, style: sanitizedStyle, persist },
		);
	}

	/**
	 * Generate stable locator candidates for a target element.
	 */
	async generateLocator(
		target: string,
		options?: { tabId?: string },
	): Promise<ActionResult<{ candidates: LocatorCandidate[]; tabId: string }>> {
		const sessionId = this.getSessionId();

		// Locator generation is low-risk
		const policyEval = this.context.sessionManager.evaluateAction(
			"browser_generate_locator",
			{ target },
		);
		if (!isPolicyAllowed(policyEval))
			return policyEval as ActionResult<{ candidates: LocatorCandidate[]; tabId: string }>;

		try {
			const pageOrErr = await this.getConnectedPageForAction<{
				candidates: LocatorCandidate[];
				tabId: string;
			}>(options?.tabId);
			if ("success" in pageOrErr) return pageOrErr;
			const page = pageOrErr;

			// Check if target is a ref
			const isRef = target.startsWith("@") || /^e\d+$/.test(target);
			let element: A11yElement | undefined;

			if (isRef) {
				const pageId = getPageId(page.url(), sessionId);
				element = this.refStore.lookup(pageId, target);
				if (!element) {
					// Take a snapshot first to populate refs
					const snap = await snapshot(page, { sessionId });
					this.refStore.setSnapshot(pageId, snap);
					element = this.refStore.lookup(pageId, target);
				}
			} else {
				// Treat as selector/text and try to find element
				const resolved = await this.resolveTarget(target, page);
				if (resolved) {
					// Create a synthetic element from the locator
					const handle = await resolved.locator.elementHandle();
					if (handle) {
						element = await this.elementToA11yElement(page, handle, target);
					}
				}
			}

			if (!element) {
				return this.failureWithDebug(
					`Could not resolve locator target: ${target}`,
					new Error(`Could not resolve locator target: ${target}`),
					{
						action: "browser_generate_locator",
						path: policyEval.path,
						sessionId,
						policyDecision: policyEval.policyDecision,
						risk: policyEval.risk,
						auditId: policyEval.auditId,
					},
				);
			}

			const candidates = this.generateLocatorCandidates(element);
			log.info("Generated locator candidates", {
				target,
				count: candidates.length,
			});
			await this.persistObservability(sessionId, page);

			return successResult(
				{ candidates, tabId: await this.getTabIdForPage(page, options?.tabId ?? "0") },
				{
					path: policyEval.path,
					sessionId,
					policyDecision: policyEval.policyDecision,
					risk: policyEval.risk,
					auditId: policyEval.auditId,
				},
			);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			return this.failureWithDebug(
				`Locator generation failed for "${target}": ${message}`,
				error,
				{
					action: "browser_generate_locator",
					path: policyEval.path,
					sessionId,
					policyDecision: policyEval.policyDecision,
					risk: policyEval.risk,
					auditId: policyEval.auditId,
				},
			);
		}
	}

	private async elementToA11yElement(
		_page: Page,
		handle: import("playwright-core").ElementHandle,
		target: string,
	): Promise<A11yElement> {
		const element: A11yElement = {
			ref: "e0",
			role: "unknown",
		};

		try {
			const attrs = await handle.evaluate((el) => {
				const elem = el as Element;
				const tag = elem.tagName.toLowerCase();
				const role = elem.getAttribute("role") || tag;
				const id = elem.id;
				const dataTestId = elem.getAttribute("data-testid");
				const dataTest = elem.getAttribute("data-test");
				const placeholder = elem.getAttribute("placeholder");
				const ariaLabel = elem.getAttribute("aria-label");
				const ariaLabelledBy = elem.getAttribute("aria-labelledby");
				const title = elem.getAttribute("title");
				const text = elem.textContent?.trim().slice(0, 100) || "";
				let label = "";
				let name = "";
				let nameSource:
					| "aria-label"
					| "aria-labelledby"
					| "label"
					| "placeholder"
					| "title"
					| "text"
					| "unknown" = "unknown";

				if (ariaLabel) {
					name = ariaLabel;
					label = ariaLabel;
					nameSource = "aria-label";
				} else if (ariaLabelledBy) {
					const labelledText = ariaLabelledBy
						.split(/\s+/)
						.map((labelId) => elem.ownerDocument.getElementById(labelId)?.textContent?.trim())
						.filter((value): value is string => Boolean(value))
						.join(" ")
						.trim();
					if (labelledText) {
						name = labelledText;
						label = labelledText;
						nameSource = "aria-labelledby";
					}
				}

				const formLabels = "labels" in elem
					? Array.from((elem as HTMLInputElement).labels ?? [])
							.map((item) => item.textContent?.trim())
							.filter((value): value is string => Boolean(value))
					: [];
				if (!name && formLabels.length > 0) {
					label = formLabels.join(" ").trim();
					name = label;
					nameSource = "label";
				}

				if (!name && title) {
					name = title;
					nameSource = "title";
				}
				if (!name && placeholder) {
					name = placeholder;
					nameSource = "placeholder";
				}
				if (!name && text) {
					name = text;
					nameSource = "text";
				}

				return {
					role,
					name,
					nameSource,
					label,
					id,
					dataTestId,
					dataTest,
					placeholder,
					text,
					tag,
				};
			});

			element.role = attrs.role;
			element.name = attrs.name;
			element.nameSource = attrs.nameSource;
			if (attrs.label) element.label = attrs.label;
			if (attrs.placeholder) element.placeholder = attrs.placeholder;
			if (attrs.text && attrs.nameSource !== "text") element.text = attrs.text;
			element.selector = attrs.id
				? `#${this.escapeCssIdentifier(attrs.id)}`
				: attrs.dataTestId
					? `[data-testid="${this.escapeCssAttributeValue(attrs.dataTestId)}"]`
					: attrs.dataTest
						? `[data-test="${this.escapeCssAttributeValue(attrs.dataTest)}"]`
						: target;
		} catch {
			// Use defaults if evaluation fails
		}

		return element;
	}

	private generateLocatorCandidates(element: A11yElement): LocatorCandidate[] {
		const candidates: LocatorCandidate[] = [];

		// Playwright has no stable public locator-codegen API. Keep this as a
		// thin candidate list around public locator methods.
		if (element.role && element.name) {
			candidates.push({
				kind: "role",
				value: `getByRole("${element.role}", { name: "${this.escapeString(element.name)}", exact: true })`,
				confidence: "high",
				reason: "Semantic role with accessible name",
			});
		}

		// 2. Label locator. Only suggest when the source is label-compatible.
		const label = element.label ?? (
			element.nameSource === "aria-label" ||
			element.nameSource === "aria-labelledby" ||
			element.nameSource === "label"
				? element.name
				: undefined
		);
		if (label) {
			candidates.push({
				kind: "label",
				value: `getByLabel("${this.escapeString(label)}")`,
				confidence: "high",
				reason: "Label-derived accessible name",
			});
		}

		// 3. Placeholder locator (for inputs)
		if (element.role === "textbox" || element.role === "searchbox") {
			if (element.placeholder) {
				candidates.push({
					kind: "placeholder",
					value: `getByPlaceholder("${this.escapeString(element.placeholder)}")`,
					confidence: "medium",
					reason: "Input placeholder text",
				});
			}
		}

		// 4. Text locator
		if (element.text) {
			candidates.push({
				kind: "text",
				value: `getByText("${this.escapeString(element.text)}")`,
				confidence: "medium",
				reason: "Visible text content",
			});
		}

		// 5. Test ID locator
		if (element.selector) {
			const testIdMatch = element.selector.match(
				/\[data-(?:test|testid)="([^"]+)"\]/,
			);
			if (testIdMatch) {
				candidates.push({
					kind: "testid",
					value: `getByTestId("${testIdMatch[1]}")`,
					confidence: "high",
					reason: "Test ID attribute",
				});
			}
		}

		// 6. CSS selector (if specific enough)
		if (element.selector && this.isSpecificSelector(element.selector)) {
			candidates.push({
				kind: "css",
				value: `locator("${this.escapeString(element.selector, { maxLength: null })}")`,
				confidence: "medium",
				reason: "CSS selector",
			});
		}

		return candidates;
	}

	private isSpecificSelector(selector: string): boolean {
		// Reject generic tag-only selectors
		if (/^(button|a|input|div|span|p|li|tr|td|th)$/i.test(selector.trim())) {
			return false;
		}
		// Accept selectors with attributes
		return (
			selector.includes("#") || selector.includes("[") || selector.includes(".")
		);
	}

	private escapeString(str: string, options?: { maxLength?: number | null }): string {
		const escaped = str.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ").trim();
		if (options?.maxLength === null) return escaped;
		return escaped.slice(0, options?.maxLength ?? 100);
	}

	private escapeCssIdentifier(value: string): string {
		let escaped = "";
		for (let index = 0; index < value.length; index += 1) {
			const char = value.charAt(index);
			const code = value.charCodeAt(index);
			if (code === 0) {
				escaped += "\uFFFD";
				continue;
			}
			if (
				(code >= 0x0001 && code <= 0x001f) ||
				code === 0x007f ||
				(index === 0 && code >= 0x0030 && code <= 0x0039) ||
				(index === 1 &&
					code >= 0x0030 &&
					code <= 0x0039 &&
					value.charCodeAt(0) === 0x002d)
			) {
				escaped += `\\${code.toString(16)} `;
				continue;
			}
			if (index === 0 && code === 0x002d && value.length === 1) {
				escaped += "\\-";
				continue;
			}
			if (
				code >= 0x0080 ||
				code === 0x002d ||
				code === 0x005f ||
				(code >= 0x0030 && code <= 0x0039) ||
				(code >= 0x0041 && code <= 0x005a) ||
				(code >= 0x0061 && code <= 0x007a)
			) {
				escaped += char;
				continue;
			}
			escaped += `\\${char}`;
		}
		return escaped;
	}

	private escapeCssAttributeValue(value: string): string {
		return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
	}

	/**
	 * Take a screenshot.
	 */
	async screenshot(
		options: ScreenshotOptions = {},
	): Promise<ActionResult<ScreenshotResult>> {
		const sessionId = this.getSessionId();
		const startTime = Date.now();

		const policyEval = this.context.sessionManager.evaluateAction(
			"screenshot",
			{},
		);
		if (!isPolicyAllowed(policyEval))
			return policyEval as ActionResult<ScreenshotResult>;

		try {
			const pageOrErr = await this.getConnectedPageForAction<ScreenshotResult>(options.tabId);
			if ("success" in pageOrErr) return pageOrErr;
			const page = pageOrErr;
			const fs = await import("node:fs");
			const path = await import("node:path");
			const { getDataHome, getSessionScreenshotsDir } = await import(
				"../shared/paths"
			);

			const outputPath = this.resolveScreenshotOutputPath({
				path,
				fs,
				getDataHome,
				getSessionScreenshotsDir,
			});
			const requestedCopyPath = options.copyTo ?? options.outputPath;
			const copyPath = this.resolveScreenshotCopyPath(requestedCopyPath, { path, fs });
			fs.mkdirSync(path.dirname(outputPath), { recursive: true });
			const tempPath = `${outputPath}.tmp-${process.pid}-${Date.now()}.png`;
			const restoreOverlays = await this.hideBrowserControlScreenshotOverlays(
				page,
			);

			// Handle annotation: inject temporary overlays before screenshot
			let annotationInjected = false;
			try {
				await this.removeAnnotationOverlays(page);
				if (options.annotate) {
					annotationInjected = await this.injectAnnotationOverlays(
						page,
						options.refs,
					);
				}
				if (options.target) {
					const resolved = await this.resolveTarget(options.target, page);
					if (resolved) {
						await resolved.locator.screenshot({
							path: tempPath,
							timeout: options.timeoutMs ?? 30_000,
						});
					} else {
						await this.capturePageScreenshot(
							page,
							tempPath,
							options.fullPage ?? false,
							options.timeoutMs,
						);
					}
				} else {
					await this.capturePageScreenshot(
						page,
						tempPath,
						options.fullPage ?? false,
						options.timeoutMs,
					);
				}
			} finally {
				// Clean up annotation overlays if they were injected
				if (annotationInjected) {
					await this.removeAnnotationOverlays(page);
				}
				await restoreOverlays();
			}

			if (fs.existsSync(outputPath)) fs.rmSync(outputPath, { force: true });
			fs.renameSync(tempPath, outputPath);
			if (copyPath && path.resolve(copyPath) !== path.resolve(outputPath)) {
				fs.copyFileSync(outputPath, copyPath);
			}
			const stats = fs.statSync(outputPath);
			await this.persistObservability(sessionId, page);

			this.recordTimelineEvent({
				action: "screenshot",
				target: options.target,
				url: page.url(),
				title: await page.title().catch(() => undefined),
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				durationMs: Date.now() - startTime,
				success: true,
				artifactPath: outputPath,
			});

			const warning = options.outputPath
				? "outputPath is deprecated; Browser Control saved the primary screenshot to runtimePath and copied it to copyPath. Use copyTo for auxiliary copies."
				: undefined;
			const result = successResult(
				{
					path: outputPath,
					runtimePath: outputPath,
					...(copyPath && path.resolve(copyPath) !== path.resolve(outputPath) ? { copyPath } : {}),
					sizeBytes: stats.size,
					tabId: await this.getTabIdForPage(page, options.tabId ?? "0"),
				},
				{
					path: policyEval.path,
					sessionId,
					warning,
					policyDecision: policyEval.policyDecision,
					risk: policyEval.risk,
					auditId: policyEval.auditId,
				},
			);
			this.recordPackageAction(
				"browser-screenshot",
				{
					copyTo: options.copyTo ?? options.outputPath,
					deprecatedOutputPath: options.outputPath !== undefined,
					fullPage: options.fullPage,
					target: options.target,
					tabId: options.tabId,
					annotate: options.annotate,
				},
				result,
			);
			return result;
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			this.recordTimelineEvent({
				action: "screenshot",
				target: options.target,
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				durationMs: Date.now() - startTime,
				success: false,
				error: message,
			});
			return this.failureWithDebug(`Screenshot failed: ${message}`, error, {
				action: "screenshot",
				path: policyEval.path,
				sessionId,
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				auditId: policyEval.auditId,
			});
		}
	}

	private async injectAnnotationOverlays(
		page: Page,
		refs?: string[],
	): Promise<boolean> {
		try {
			// Ensure we have a snapshot with bounds
			const sessionId = this.getSessionId();
			const snap = await snapshot(page, { sessionId, boxes: true });
			const pageId = getPageId(page.url(), sessionId);
			this.refStore.setSnapshot(pageId, snap);

			const elementsToAnnotate = refs
				? refs
						.map((r) => this.refStore.lookup(pageId, r))
						.filter((e): e is A11yElement => e !== undefined)
				: snap.elements.filter(
						(e) => INTERACTIVE_ROLES.has(e.role) || e.role === "heading",
					);

			if (elementsToAnnotate.length === 0) return false;

			await page.evaluate((elements) => {
				// Create root container
				let root = document.querySelector(
					"[data-browser-control-annotation-root]",
				) as HTMLElement;
				if (!root) {
					root = document.createElement("div");
					root.setAttribute("data-browser-control-annotation-root", "true");
					root.style.position = "fixed";
					root.style.top = "0";
					root.style.left = "0";
					root.style.width = "100%";
					root.style.height = "100%";
					root.style.pointerEvents = "none";
					root.style.zIndex = "2147483647";
					document.body.appendChild(root);
				}

				// Add overlay for each element
				for (const el of elements) {
					if (!el.bounds) continue;
					const overlay = document.createElement("div");
					overlay.setAttribute("data-browser-control-annotation", "true");
					overlay.style.cssText = `
            position: absolute;
            border: 2px solid #00ff00;
            background-color: rgba(0, 255, 0, 0.1);
            pointer-events: none;
            z-index: 2147483647;
            font-size: 10px;
            color: #00ff00;
            padding: 1px;
            white-space: nowrap;
            left: ${el.bounds.x}px;
            top: ${el.bounds.y}px;
            width: ${el.bounds.width}px;
            height: ${el.bounds.height}px;
          `;
					overlay.textContent = el.ref;
					root.appendChild(overlay);
				}
			}, elementsToAnnotate);

			return true;
		} catch {
			return false;
		}
	}

	private async removeAnnotationOverlays(page: Page): Promise<void> {
		try {
			await page.evaluate(() => {
				const root = document.querySelector(
					"[data-browser-control-annotation-root]",
				);
				if (root) {
					root.remove();
				}
			});
		} catch {
			// Ignore cleanup errors
		}
	}

	private async hideBrowserControlScreenshotOverlays(
		page: Page,
	): Promise<() => Promise<void>> {
		const cleanupAttribute = "data-browser-control-screenshot-overlay-style";
		try {
			await page.evaluate((attribute) => {
				const existing = document.querySelector(`[${attribute}]`);
				if (existing) existing.remove();
				const style = document.createElement("style");
				style.setAttribute(attribute, "true");
				style.textContent = `
          [data-browser-control-highlight-root],
          [data-browser-control-screencast-root] {
            visibility: hidden !important;
          }
        `;
				document.head.appendChild(style);
			}, cleanupAttribute);
			return async () => {
				try {
					await page.evaluate((attribute) => {
						const style = document.querySelector(`[${attribute}]`);
						if (style) style.remove();
					}, cleanupAttribute);
				} catch {
					// Ignore cleanup errors
				}
			};
		} catch {
			return async () => undefined;
		}
	}

	private async capturePageScreenshot(
		page: Page,
		outputPath: string,
		fullPage: boolean,
		timeoutMs = 30_000,
	): Promise<void> {
		await this.ensureScreenshotViewport(page);
		try {
			await page.screenshot({ path: outputPath, fullPage, timeout: timeoutMs });
			const fs = await import("node:fs");
			if (fs.existsSync(outputPath) && fs.statSync(outputPath).size >= 512) {
				return;
			}
			await this.capturePageScreenshotViaCdp(page, outputPath, fullPage);
			return;
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			if (!message.includes("Timeout")) throw error;

			await this.capturePageScreenshotViaCdp(page, outputPath, fullPage);
		}
	}

	private async capturePageScreenshotViaCdp(
		page: Page,
		outputPath: string,
		fullPage: boolean,
	): Promise<void> {
		const fs = await import("node:fs");
		let client:
			| Awaited<ReturnType<ReturnType<Page["context"]>["newCDPSession"]>>
			| undefined;
		try {
			client = await page.context().newCDPSession(page);
			const result = await client.send("Page.captureScreenshot", {
				format: "png",
				captureBeyondViewport: fullPage,
			});
			fs.writeFileSync(outputPath, Buffer.from(result.data, "base64"));
		} finally {
			await client?.detach().catch(() => undefined);
		}
	}

	/**
	 * List browser tabs.
	 */
	async tabList(): Promise<
		ActionResult<Array<{ id: string; url: string; title: string }>>
	> {
		const sessionId = this.getSessionId();

		// Route through policy for consistency (Issue 2)
		const policyEval = this.context.sessionManager.evaluateAction(
			"browser_tab_list",
			{},
		);
		if (!isPolicyAllowed(policyEval))
			return policyEval as ActionResult<
				Array<{ id: string; url: string; title: string }>
			>;

		try {
			const pageOrErr =
				await this.getConnectedPageForAction<
					Array<{ id: string; url: string; title: string }>
				>();
			if ("success" in pageOrErr) return pageOrErr;
			const page = pageOrErr;
			const context = page.context();
			const rawPages = context.pages();
			const windowTargets = await this.getWindowTargets(rawPages);
			const pages = windowTargets.length > 0 ? windowTargets.map(t => t.page) : rawPages;

			// Refresh durable targetIds without discarding pages missed by this probe.
			this.refreshTabIdMap(windowTargets, rawPages);

			const tabs = await Promise.all(
				pages.map(async (p, i) => {
					const target = windowTargets.find(t => t.page === p);
					const id = target ? target.targetId : String(i);
					return {
						id,
						url: p.url(),
						title: await p.title().catch(() => ""),
					};
				}),
			);
			await this.persistObservability(sessionId, page);

			return successResult(tabs, {
				path: policyEval.path,
				sessionId,
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				auditId: policyEval.auditId,
			});
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			return this.failureWithDebug(`Tab list failed: ${message}`, error, {
				action: "browser_tab_list",
				path: policyEval.path,
				sessionId,
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				auditId: policyEval.auditId,
			});
		}
	}

	async tabSwitch(tabId: string): Promise<ActionResult<{
		activeTabId: string;
		url: string;
		title?: string;
		readyState?: string;
	}>> {
		const sessionId = this.getSessionId();

		// Route through policy for consistency (Issue 2)
		const policyEval = this.context.sessionManager.evaluateAction(
			"browser_tab_switch",
			{ tabId },
		);
		if (!isPolicyAllowed(policyEval))
			return policyEval as ActionResult<{
				activeTabId: string;
				url: string;
				title?: string;
				readyState?: string;
			}>;

		try {
			const pageOrErr = await this.ensureBrowserConnected();
			if ("success" in pageOrErr) return pageOrErr as ActionResult<{
				activeTabId: string;
				url: string;
				title?: string;
				readyState?: string;
			}>;

			const resolved = await this.resolveTabId<{
				activeTabId: string;
				url: string;
				title?: string;
				readyState?: string;
			}>(tabId, pageOrErr);
			if ("success" in resolved) return resolved;
			const targetPage = resolved;

			await this.persistObservability(sessionId, targetPage);

			const url = targetPage.url();
			const title = await targetPage.title().catch(() => undefined);
			const readyState = await targetPage.evaluate(() => document.readyState).catch(() => undefined);
			const resolvedTabId = await this.getTabIdForPage(targetPage, tabId);
			this.rememberActiveTab(resolvedTabId);

			return successResult(
				{
					activeTabId: resolvedTabId,
					url,
					title,
					readyState,
				},
				{
					path: policyEval.path,
					sessionId,
					policyDecision: policyEval.policyDecision,
					risk: policyEval.risk,
					auditId: policyEval.auditId,
				},
			);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			return (await this.failureWithDebug(`Tab switch failed: ${message}`, error, {
				action: "browser_tab_switch",
				path: policyEval.path,
				sessionId,
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				auditId: policyEval.auditId,
			})) as ActionResult<{
				activeTabId: string;
				url: string;
				title?: string;
				readyState?: string;
			}>;
		}
	}

	/**
	 * Close the current browser tab without ending the browser lifecycle.
	 */
	async tabClose(options?: { tabId?: string }): Promise<ActionResult<{ closed: boolean; tabId?: string }>> {
		const sessionId = this.getSessionId();

		const policyEval = this.context.sessionManager.evaluateAction(
			"browser_tab_close",
			{ tabId: options?.tabId },
		);
		if (!isPolicyAllowed(policyEval)) {
			return policyEval as ActionResult<{ closed: boolean; tabId?: string }>;
		}

		try {
			const pageOrErr = await this.getConnectedPageForAction<{
				closed: true;
			}>(options?.tabId);
			if ("success" in pageOrErr) return pageOrErr;
			const page = pageOrErr;
			const closedTabId = await this.getTabIdForPage(page, options?.tabId ?? "0")
				.catch(() => options?.tabId);
			await this.persistObservability(sessionId, page);
			await this.closePage(page);
			this.context.sessionManager.setActiveBrowserTab(sessionId, null);

			return successResult(
				{ closed: true, tabId: closedTabId },
				{
					path: policyEval.path,
					sessionId,
					policyDecision: policyEval.policyDecision,
					risk: policyEval.risk,
					auditId: policyEval.auditId,
				},
			);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			return this.failureWithDebug(`Tab close failed: ${message}`, error, {
				action: "browser_tab_close",
				path: policyEval.path,
				sessionId,
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				auditId: policyEval.auditId,
			});
		}
	}

	/**
	 * Close the browser lifecycle for the active Browser Control session.
	 *
	 * Managed browsers are terminated. Attached browsers are detached rather
	 * than killed by BrowserConnectionManager.disconnect().
	 */
	async close(): Promise<ActionResult<BrowserCloseResult>> {
		const sessionId = this.getSessionId();

		const policyEval = this.context.sessionManager.evaluateAction(
			"browser_close",
			{},
		);
		if (!isPolicyAllowed(policyEval))
			return policyEval as ActionResult<BrowserCloseResult>;

		try {
			const bm = this.context.sessionManager.getBrowserManager();
			const connection = bm.getConnection();
			await bm.disconnect();
			this.unbindBrowserFromSession();

			return successResult(
				{
					detached: true,
					closedBrowser: connection?.mode !== "attached",
					mode: connection?.mode ?? "none",
					...(connection?.id ? { connectionId: connection.id } : {}),
					...(connection?.cdpEndpoint
						? { endpoint: connection.cdpEndpoint }
						: {}),
				},
				{
					path: policyEval.path,
					sessionId,
					policyDecision: policyEval.policyDecision,
					risk: policyEval.risk,
					auditId: policyEval.auditId,
				},
			);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			return this.failureWithDebug(`Browser close failed: ${message}`, error, {
				action: "browser_close",
				path: policyEval.path,
				sessionId,
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				auditId: policyEval.auditId,
			});
		}
	}

	/**
	 * Launch a managed browser instance.
	 *
	 * This is an explicit launch action that starts a new managed Chrome
	 * process. Unlike auto-launch fallback, this is a direct user request.
	 */
	async launch(
		options: BrowserLaunchOptions = {},
	): Promise<ActionResult<BrowserLaunchResult>> {
		const sessionId = this.getSessionId();

		const policyEval = this.context.sessionManager.evaluateAction(
			"browser_launch",
			options as Record<string, unknown>,
		);
		if (!isPolicyAllowed(policyEval))
			return policyEval as ActionResult<BrowserLaunchResult>;

		try {
			const bm = this.context.sessionManager.getBrowserManager();
			if (bm.isConnected()) {
				const existing = bm.getConnection();
				const port = existing?.cdpEndpoint
					? parseInt(new URL(existing.cdpEndpoint).port, 10)
					: undefined;
				return successResult(
					{
						launched: false,
						mode: existing?.mode ?? "managed",
						connectionId: existing?.id,
						endpoint: existing?.cdpEndpoint,
						port,
						profile: existing?.profile?.name,
						provider: existing?.provider,
					},
					{
						path: policyEval.path,
						sessionId,
						policyDecision: policyEval.policyDecision,
						risk: policyEval.risk,
						auditId: policyEval.auditId,
					},
				);
			}

			const config = loadConfig({ validate: false });
			await bm.launchManaged({
				actor: "human",
				port: options.port ?? config.chromeDebugPort,
				profileName: options.profile ?? config.browserLaunchProfile,
				provider: options.provider,
			});

			this.bindBrowserToSession(bm);

			const conn = bm.getConnection();
			const port = conn?.cdpEndpoint
				? parseInt(new URL(conn.cdpEndpoint).port, 10)
				: undefined;
			return successResult(
				{
					launched: true,
					mode: conn?.mode ?? "managed",
					connectionId: conn?.id,
					endpoint: conn?.cdpEndpoint,
					port,
					profile: conn?.profile?.name,
					provider: conn?.provider,
				},
				{
					path: policyEval.path,
					sessionId,
					policyDecision: policyEval.policyDecision,
					risk: policyEval.risk,
					auditId: policyEval.auditId,
				},
			);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			return this.failureWithDebug(
				`Browser launch failed: ${message}. ${BROWSER_LAUNCH_RECOVERY_GUIDANCE}`,
				error,
				{
					action: "browser_launch",
					path: policyEval.path,
					sessionId,
					policyDecision: policyEval.policyDecision,
					risk: policyEval.risk,
					auditId: policyEval.auditId,
				},
			);
		}
	}

	// ── Screencast (Section 26) ───────────────────────────────────────────────

	/**
	 * Start a browser screencast recording.
	 */
	async screencastStart(
		options: ScreencastOptions = {},
	): Promise<ActionResult<{ session: ScreencastSession }>> {
		const sessionId = this.getSessionId();

		// Route through policy (moderate risk)
		const policyEval = this.context.sessionManager.evaluateAction(
			"browser_screencast_start",
			options as Record<string, unknown>,
		);
		if (!isPolicyAllowed(policyEval))
			return policyEval as ActionResult<{ session: ScreencastSession }>;

		try {
			const pageOrErr = await this.getConnectedPageForAction<{
				session: ScreencastSession;
			}>();
			if ("success" in pageOrErr) return pageOrErr;
			const page = pageOrErr;

			const browserSessionId = sessionId;
			const pageId = getPageId(page.url(), sessionId);
			const store = this.context.sessionManager.getMemoryStore();
			const recorder = getGlobalScreencastRecorder(store);
			const activeSession = this.context.sessionManager.getActiveSession();
			const artifactRoot = activeSession
				? ensureStructuredSessionRuntimeDir(activeSession, getDataHome())
				: getSessionRuntimeDir(sessionId);

			const session = await recorder.start({
				browserSessionId,
				pageId,
				options,
				artifactRoot,
				page: {
					url: () => page.url(),
					title: () => page.title(),
					screenshot: (opts) => page.screenshot(opts),
					evaluate: (fn) => page.evaluate(fn),
				},
			});

			return successResult(
				{ session },
				{
					path: policyEval.path,
					sessionId,
					warning: options.path
						? "path is deprecated; Browser Control saved the primary screencast to runtimePath and copied it to copyPath. Use copyTo for auxiliary copies."
						: undefined,
					policyDecision: policyEval.policyDecision,
					risk: policyEval.risk,
					auditId: policyEval.auditId,
				},
			);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			return this.failureWithDebug(
				`Screencast start failed: ${message}`,
				error,
				{
					action: "browser_screencast_start",
					path: policyEval.path,
					sessionId,
					policyDecision: policyEval.policyDecision,
					risk: policyEval.risk,
					auditId: policyEval.auditId,
				},
			);
		}
	}

	/**
	 * Stop the current screencast recording.
	 */
	async screencastStop(): Promise<
		ActionResult<{
			session: ScreencastSession;
			receiptId?: string;
			timelinePath?: string;
		}>
	> {
		const sessionId = this.getSessionId();

		// Route through policy (low/moderate risk)
		const policyEval = this.context.sessionManager.evaluateAction(
			"browser_screencast_stop",
			{},
		);
		if (!isPolicyAllowed(policyEval))
			return policyEval as ActionResult<{
				session: ScreencastSession;
				receiptId?: string;
				timelinePath?: string;
			}>;

		try {
			const store = this.context.sessionManager.getMemoryStore();
			const recorder = getGlobalScreencastRecorder(store);
			const result = await recorder.stop(true);

			return successResult(
				{
					session: result.session,
					receiptId: result.receipt?.receiptId,
					timelinePath: result.timelinePath,
				},
				{
					path: policyEval.path,
					sessionId,
					policyDecision: policyEval.policyDecision,
					risk: policyEval.risk,
					auditId: policyEval.auditId,
				},
			);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			return this.failureWithDebug(
				`Screencast stop failed: ${message}`,
				error,
				{
					action: "browser_screencast_stop",
					path: policyEval.path,
					sessionId,
					policyDecision: policyEval.policyDecision,
					risk: policyEval.risk,
					auditId: policyEval.auditId,
				},
			);
		}
	}

	/**
	 * Get the current screencast status.
	 */
	async screencastStatus(): Promise<
		ActionResult<{ session: ScreencastSession | null }>
	> {
		const sessionId = this.getSessionId();

		// Route through policy (low risk)
		const policyEval = this.context.sessionManager.evaluateAction(
			"browser_screencast_status",
			{},
		);
		if (!isPolicyAllowed(policyEval))
			return policyEval as ActionResult<{ session: ScreencastSession | null }>;

		try {
			const store = this.context.sessionManager.getMemoryStore();
			const recorder = getGlobalScreencastRecorder(store);
			const session = recorder.status();

			return successResult(
				{ session },
				{
					path: policyEval.path,
					sessionId,
					policyDecision: policyEval.policyDecision,
					risk: policyEval.risk,
					auditId: policyEval.auditId,
				},
			);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			return this.failureWithDebug(
				`Screencast status failed: ${message}`,
				error,
				{
					action: "browser_screencast_status",
					path: policyEval.path,
					sessionId,
					policyDecision: policyEval.policyDecision,
					risk: policyEval.risk,
					auditId: policyEval.auditId,
				},
			);
		}
	}

	// ── Section 27: File/Data Drop ───────────────────────────────────────────

	/**
	 * Drop files or data onto a page element.
	 *
	 * Supports file drop (local files) and data drop (MIME/value pairs like text/plain).
	 * Routes through policy as browser_drop_file or browser_drop_data.
	 */
	async drop(options: DropOptions): Promise<ActionResult<BrowserDropResult>> {
		const sessionId = this.getSessionId();
		const startTime = Date.now();
		const pageOrErr = await this.getConnectedPageForAction<BrowserDropResult>(options.tabId);
		if ("success" in pageOrErr) return pageOrErr;
		const page = pageOrErr;

		// Determine policy action based on what's being dropped
		const hasFiles = options.files && options.files.length > 0;
		const hasData = options.data && options.data.length > 0;

		if (!hasFiles && !hasData) {
			return failureResult("Drop requires either files or data", {
				path: "a11y",
				sessionId,
			});
		}

		// Route through policy (moderate/high risk for files, moderate for data)
		const policyAction = hasFiles ? "browser_drop_file" : "browser_drop_data";
		const policyEval = this.context.sessionManager.evaluateAction(
			policyAction,
			{},
		);
		if (!isPolicyAllowed(policyEval))
			return policyEval as ActionResult<BrowserDropResult>;

		try {
			// Resolve target selector
			const targetResult = await this.resolveTarget(options.target, page);
			if (!targetResult) {
				this.recordTimelineEvent({
					action: "drop",
					target: options.target,
					policyDecision: policyEval.policyDecision,
					risk: policyEval.risk,
					durationMs: Date.now() - startTime,
					success: false,
					error: `Could not resolve target: ${options.target}`,
				});
				return failureResult(`Could not resolve target: ${options.target}`, {
					path: policyEval.path,
					sessionId,
					policyDecision: policyEval.policyDecision,
					risk: policyEval.risk,
					auditId: policyEval.auditId,
				});
			}

			const droppedFiles: Array<{ path: string; sizeBytes: number }> = [];
			const droppedData: Array<{ mimeType: string; value: string }> = [];

			// Handle file drop - use locator directly
			if (hasFiles && options.files) {
				const uploadPathOptions = this.getUploadPathOptions();
				for (const filePath of options.files) {
					try {
						const absolutePath = validateFilePath(filePath, uploadPathOptions);
						const sizeBytes = getFileSize(absolutePath, uploadPathOptions);
						// Use Playwright's setInputFiles for file inputs
						await targetResult.locator.setInputFiles(absolutePath);
						droppedFiles.push({ path: absolutePath, sizeBytes });
					} catch (error: unknown) {
						const message =
							error instanceof Error ? error.message : String(error);
						log.warn(`Failed to drop file ${filePath}: ${message}`);
						this.recordTimelineEvent({
							action: "drop",
							target: options.target,
							policyDecision: policyEval.policyDecision,
							risk: policyEval.risk,
							durationMs: Date.now() - startTime,
							success: false,
							error: `Failed to drop file ${filePath}: ${message}`,
						});
						return failureResult(
							`Failed to drop file ${filePath}: ${message}`,
							{
								path: policyEval.path,
								sessionId,
								policyDecision: policyEval.policyDecision,
								risk: policyEval.risk,
								auditId: policyEval.auditId,
							},
						);
					}
				}
			}

			// Handle data drop - use element handle directly
			if (hasData && options.data) {
				const elementHandle = await targetResult.locator.elementHandle();
				if (!elementHandle) {
					this.recordTimelineEvent({
						action: "drop",
						target: options.target,
						policyDecision: policyEval.policyDecision,
						risk: policyEval.risk,
						durationMs: Date.now() - startTime,
						success: false,
						error: `Could not get element handle for target: ${options.target}`,
					});
					return failureResult(
						`Could not get element handle for target: ${options.target}`,
						{
							path: policyEval.path,
							sessionId,
							policyDecision: policyEval.policyDecision,
							risk: policyEval.risk,
							auditId: policyEval.auditId,
						},
					);
				}

				for (const dataItem of options.data) {
					try {
						// Dispatch drag events with DataTransfer using element handle
						await elementHandle.evaluate(
							(
								el: Element,
								{ mimeType, value }: { mimeType: string; value: string },
							) => {
								// Create DataTransfer with the data
								const dt = new DataTransfer();
								dt.setData(mimeType, value);

								// Dispatch drag events
								el.dispatchEvent(
									new DragEvent("dragenter", {
										bubbles: true,
										cancelable: true,
										dataTransfer: dt,
									}),
								);
								el.dispatchEvent(
									new DragEvent("dragover", {
										bubbles: true,
										cancelable: true,
										dataTransfer: dt,
									}),
								);
								el.dispatchEvent(
									new DragEvent("drop", {
										bubbles: true,
										cancelable: true,
										dataTransfer: dt,
									}),
								);
							},
							{ mimeType: dataItem.mimeType, value: dataItem.value },
						);
						droppedData.push({
							mimeType: dataItem.mimeType,
							value: dataItem.value,
						});
					} catch (error: unknown) {
						const message =
							error instanceof Error ? error.message : String(error);
						log.warn(`Failed to drop data (${dataItem.mimeType}): ${message}`);
						this.recordTimelineEvent({
							action: "drop",
							target: options.target,
							policyDecision: policyEval.policyDecision,
							risk: policyEval.risk,
							durationMs: Date.now() - startTime,
							success: false,
							error: `Failed to drop data (${dataItem.mimeType}): ${message}`,
						});
						return failureResult(
							`Failed to drop data (${dataItem.mimeType}): ${message}`,
							{
								path: policyEval.path,
								sessionId,
								policyDecision: policyEval.policyDecision,
								risk: policyEval.risk,
								auditId: policyEval.auditId,
							},
						);
					}
				}
			}

			const result: BrowserDropResult = {
				success: true,
				files: droppedFiles.length > 0 ? droppedFiles : undefined,
				// Redact data values for privacy - only keep mimeType and length
				data:
					droppedData.length > 0
						? droppedData.map((d) => ({
								mimeType: d.mimeType,
								value: `[REDACTED: ${d.value.length} characters]`,
							}))
						: undefined,
			};

			this.recordTimelineEvent({
				action: "drop",
				target: options.target,
				url: page.url(),
				title: await page.title().catch(() => undefined),
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				durationMs: Date.now() - startTime,
				success: true,
			});

			return successResult(result, {
				path: policyEval.path,
				sessionId,
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				auditId: policyEval.auditId,
			});
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			this.recordTimelineEvent({
				action: "drop",
				target: options.target,
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				durationMs: Date.now() - startTime,
				success: false,
				error: message,
			});
			return this.failureWithDebug(`Drop failed: ${message}`, error, {
				action: policyAction,
				path: policyEval.path,
				sessionId,
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				auditId: policyEval.auditId,
			});
		}
	}

	// ── Section 27: Downloads List ───────────────────────────────────────────

	/**
	 * List recent downloads for the current session.
	 *
	 * Returns structured download information from the session downloads directory.
	 * Routes through policy as browser_downloads_list (low risk).
	 */
	// ── Section 31: High-Level Composite Actions ─────────────────────────

	/**
	 * Collect all current browser state in a single call.
	 * Combines tab list, dialogs, downloads, and optional snapshot/screenshot.
	 * Reduces the "poll all state" pattern from ~4 calls to 1.
	 */
	async browserState(options?: {
		tabId?: string;
		snapshot?: boolean;
		screenshot?: boolean;
		fullPage?: boolean;
		dialog?: boolean;
		downloads?: boolean;
	}): Promise<ActionResult<BrowserStateResult>> {
		const sessionId = this.getSessionId();
		const warnings: string[] = [];
		const status: Record<string, "ok" | "error" | "skipped"> = {};
		const result: BrowserStateResult = {
			browserConnected: false,
			tabCount: 0,
			dialogCount: 0,
			warnings,
			status,
			queue: this.getActionQueueStats(),
		};

		// Check browser is connected and honor explicit/persisted active tab.
		let page: Page | undefined;
		try {
			const pageOrErr = await this.getConnectedPageForAction<BrowserStateResult>(options?.tabId);
			if (!("success" in pageOrErr)) page = pageOrErr;
			else warnings.push(pageOrErr.error ?? "No browser is connected or attached");
		} catch (error: unknown) {
			warnings.push(error instanceof Error ? error.message : String(error));
		}
		const connected = page != null;
		result.browserConnected = connected;
		status.browser = connected ? "ok" : "error";
		if (!connected) {
			if (warnings.length === 0) warnings.push("No browser is connected or attached");
			return successResult(result, { path: "a11y", sessionId });
		}

		const currentPage = page!;

		// Tab list (always included, compact)
		try {
			const tabListRes = await this.tabList();
			if (tabListRes.success && tabListRes.data) {
				result.tabs = tabListRes.data;
				result.tabCount = tabListRes.data.length;
				// Find active tab by matching current page URL instead of assuming tabs[0]
				const pageUrl = currentPage.url();
				const active = tabListRes.data.find(t => t.url === pageUrl) ?? tabListRes.data[0];
				if (active) {
					result.url = active.url;
					result.title = active.title;
					result.tabId = active.id;
				}
				status.tabs = "ok";
			} else {
				status.tabs = "error";
				warnings.push(`tabList: ${tabListRes.error ?? "Unknown error"}`);
			}
		} catch (error: unknown) {
			status.tabs = "error";
			warnings.push(`tabList threw: ${error instanceof Error ? error.message : String(error)}`);
		}

		// Dialogs (opt-out by default)
		if (options?.dialog !== false) {
			try {
				const dialogRes = await this.dialog({ action: "list" });
				if (dialogRes.success && dialogRes.data) {
					const dialogs = (dialogRes.data as { dialogs: DialogInfo[] }).dialogs;
					result.dialogs = dialogs;
					result.dialogCount = dialogs.length;
					status.dialogs = "ok";
				} else {
					status.dialogs = "error";
					warnings.push(`dialog: ${dialogRes.error ?? "Failed to list dialogs"}`);
				}
			} catch (error: unknown) {
				status.dialogs = "error";
				warnings.push(`dialog threw: ${error instanceof Error ? error.message : String(error)}`);
			}
		} else {
			status.dialogs = "skipped";
		}

		// Downloads (opt-in only — high risk under balanced policy)
		if (options?.downloads === true) {
			try {
				const dlRes = await this.downloadsList();
				if (dlRes.success && dlRes.data) {
					result.downloads = dlRes.data;
					status.downloads = "ok";
				} else {
					status.downloads = "error";
					warnings.push(`downloads: ${dlRes.error ?? "Failed to list downloads"}`);
				}
			} catch (error: unknown) {
				status.downloads = "error";
				warnings.push(`downloads threw: ${error instanceof Error ? error.message : String(error)}`);
			}
		} else {
			status.downloads = "skipped";
		}

		// Snapshot (off by default now — compact)
		if (options?.snapshot === true) {
			try {
				const snapRes = await this.takeSnapshot({ tabId: options?.tabId, boxes: true });
				if (snapRes.success && snapRes.data) {
					result.snapshot = snapRes.data;
					status.snapshot = "ok";
				} else {
					status.snapshot = "error";
					warnings.push(`snapshot: ${snapRes.error ?? "Failed to take snapshot"}`);
				}
			} catch (error: unknown) {
				status.snapshot = "error";
				warnings.push(`snapshot threw: ${error instanceof Error ? error.message : String(error)}`);
			}
		} else {
			status.snapshot = "skipped";
		}

		// Screenshot (opt-in only)
		if (options?.screenshot === true) {
			try {
				const ssRes = await this.screenshot({ fullPage: options.fullPage, tabId: options?.tabId });
				if (ssRes.success && ssRes.data) {
					result.screenshot = ssRes.data;
					status.screenshot = "ok";
				} else {
					status.screenshot = "error";
					warnings.push(`screenshot: ${ssRes.error ?? "Failed to take screenshot"}`);
				}
			} catch (error: unknown) {
				status.screenshot = "error";
				warnings.push(`screenshot threw: ${error instanceof Error ? error.message : String(error)}`);
			}
		} else {
			status.screenshot = "skipped";
		}

		return successResult(result, { path: "a11y", sessionId });
	}

	/**
	 * Perform any single action with optional post-action capture.
	 * Supports all major actions: open, navigate, openMany, capture, captureMany,
	 * click, fill, fillMany, press, hover, scroll, type, paste, screenshot,
	 * tab-close, state.
	 * Strips raw snapshot/screenshot data from result metadata to keep compact.
	 * Preserves policy decision, auditId, path, tabId from underlying actions.
	 */
	async browserAct(options: BrowserActOptions): Promise<ActionResult<Record<string, unknown>>> {
		const sessionId = this.getSessionId();

		// Strict validation: check required fields before dispatch
		if (options.action === "click" && !options.target) {
			return failureResult("'target' is required for click action", { path: "a11y", sessionId });
		}
		if (options.action === "fill" && !options.target) {
			return failureResult("'target' is required for fill action", { path: "a11y", sessionId });
		}
		if (options.action === "fill" && !options.text && options.text !== "") {
			return failureResult("'text' is required for fill action", { path: "a11y", sessionId });
		}
		if (options.action === "press" && !options.key) {
			return failureResult("'key' is required for press action", { path: "a11y", sessionId });
		}
		if (options.action === "hover" && !options.target) {
			return failureResult("'target' is required for hover action", { path: "a11y", sessionId });
		}
		if (options.action === "type" && !options.text && options.text !== "") {
			return failureResult("'text' is required for type action", { path: "a11y", sessionId });
		}
		if (options.action === "paste" && !options.text && options.text !== "") {
			return failureResult("'text' is required for paste action", { path: "a11y", sessionId });
		}
		if ((options.action === "open" || options.action === "navigate") && !options.url) {
			return failureResult("'url' is required for open/navigate action", { path: "a11y", sessionId });
		}
		if (options.action === "openMany" && (!options.urls || options.urls.length === 0)) {
			return failureResult("'urls' is required for openMany action", { path: "a11y", sessionId });
		}
		if (options.action === "captureMany" && (!options.urls || options.urls.length === 0)) {
			return failureResult("'urls' (tabIds) is required for captureMany action", { path: "a11y", sessionId });
		}
		if (options.action === "fillMany" && (!options.fields || options.fields.length === 0)) {
			return failureResult("'fields' is required for fillMany action", { path: "a11y", sessionId });
		}

		let actResult: ActionResult<Record<string, unknown>>;

		switch (options.action) {
			case "click": {
				const r = await this.click({ target: options.target!, timeoutMs: options.timeoutMs, force: options.force, tabId: options.tabId });
				actResult = { ...r, data: r.data as unknown as Record<string, unknown> };
				break;
			}
			case "fill": {
				const r = await this.fill({ target: options.target!, text: options.text!, timeoutMs: options.timeoutMs, commit: options.commit, tabId: options.tabId });
				actResult = { ...r, data: r.data as unknown as Record<string, unknown> };
				break;
			}
			case "press": {
				const r = await this.press({ key: options.key!, tabId: options.tabId });
				actResult = { ...r, data: r.data as unknown as Record<string, unknown> };
				break;
			}
			case "hover": {
				const r = await this.hover({ target: options.target!, timeoutMs: options.timeoutMs, tabId: options.tabId });
				actResult = { ...r, data: r.data as unknown as Record<string, unknown> };
				break;
			}
			case "scroll": {
				const dir = (options.direction ?? "down") as "up" | "down" | "left" | "right";
				const r = await this.scroll({ direction: dir, amount: options.amount, tabId: options.tabId });
				actResult = { ...r, data: r.data as unknown as Record<string, unknown> };
				break;
			}
			case "type": {
				const r = await this.type({ text: options.text!, delayMs: options.delayMs, tabId: options.tabId });
				actResult = { ...r, data: r.data as unknown as Record<string, unknown> };
				break;
			}
			case "paste": {
				const r = await this.paste({ text: options.text!, target: options.target, timeoutMs: options.timeoutMs, tabId: options.tabId });
				actResult = { ...r, data: r.data as unknown as Record<string, unknown> };
				break;
			}
			case "screenshot": {
				const refs = typeof options.refs === "string"
					? options.refs.split(",").map((ref) => ref.trim()).filter(Boolean)
					: options.refs;
				const r = await this.screenshot({
					copyTo: options.copyTo,
					outputPath: options.outputPath,
					timeoutMs: options.timeoutMs,
					fullPage: options.fullPage,
					target: options.target,
					annotate: options.annotate,
					refs,
					tabId: options.tabId,
				});
				actResult = { ...r, data: r.data as unknown as Record<string, unknown> };
				break;
			}
			case "tab-close": {
				const r = await this.tabClose({ tabId: options.tabId });
				actResult = { ...r, data: r.data as unknown as Record<string, unknown> };
				break;
			}
			case "open": {
				const r = await this.open({ url: options.url!, waitUntil: options.waitUntil });
				actResult = { ...r, data: r.data as unknown as Record<string, unknown> };
				break;
			}
			case "navigate": {
				const r = await this.navigate({ url: options.url!, waitUntil: options.waitUntil, tabId: options.tabId });
				actResult = { ...r, data: r.data as unknown as Record<string, unknown> };
				break;
			}
			case "openMany": {
				const items = (options.urls ?? []).map((u: UrlEntry) => {
					if (typeof u === "string") return { url: u, waitUntil: options.waitUntil };
					return { url: u.url, label: u.label, waitUntil: u.waitUntil ?? options.waitUntil ?? "domcontentloaded" as const };
				});
				const r = await this.openMany(items, {
					parallel: options.parallel,
					concurrency: options.concurrency,
				});
				actResult = { ...r, data: r.data as unknown as Record<string, unknown> };
				break;
			}
		case "capture": {
			const r = await this.capture({
				tabId: options.tabId,
				snapshot: options.snapshot,
				screenshot: options.screenshot === true,
			});
			actResult = { ...r, data: r.data as unknown as Record<string, unknown> };
			break;
		}
		case "captureMany": {
			const captureManyIds = (options.urls ?? []).map((u: UrlEntry) => typeof u === "string" ? u : u.url);
			const r = await this.captureMany(captureManyIds, {
				snapshot: options.snapshot,
				screenshot: options.screenshot === true,
			});
				actResult = { ...r, data: r.data as unknown as Record<string, unknown> };
				break;
			}
			case "fillMany": {
				const r = await this.fillMany(options.fields!, {
					tabId: options.tabId,
					continueOnFailure: options.continueOnFailure,
					timeoutMs: options.timeoutMs,
				});
				actResult = { ...r, data: r.data as unknown as Record<string, unknown> };
				break;
			}
			case "state": {
				const r = await this.browserState({
					tabId: options.stateOptions?.tabId ?? options.tabId,
					snapshot: options.stateOptions?.snapshot ?? options.snapshot,
					screenshot: options.stateOptions?.screenshot ?? options.screenshot,
					fullPage: options.stateOptions?.fullPage ?? options.fullPage,
					dialog: options.stateOptions?.dialog ?? options.dialog,
					downloads: options.stateOptions?.downloads ?? options.downloads,
				});
				actResult = { ...r, data: r.data as unknown as Record<string, unknown> };
				break;
			}
			default:
				return failureResult(`Unknown action: ${options.action}`, { path: "a11y", sessionId });
		}

		if (!actResult.success) return actResult;

		// Extract policy metadata from underlying result
		const policy = actResult.policyDecision;
		const auditId = actResult.auditId;
		const actPath = actResult.path;
		const actTabId = actResult.data?.tabId as string | undefined ?? options.tabId;
		const stateTabId = options.action === "tab-close" ? undefined : actTabId ?? options.tabId;

		const shouldCapturePostAction =
			options.action !== "state" &&
			options.action !== "capture" &&
			options.action !== "captureMany" &&
			(options.captureOnSuccess === true ||
				options.snapshot === true ||
				(options.action !== "screenshot" && options.screenshot === true));

		const state = options.action === "state"
			? { success: true, data: actResult.data as unknown as BrowserStateResult }
			: shouldCapturePostAction
				? await this.browserState({
					tabId: stateTabId,
					snapshot: options.snapshot === true,
					screenshot: options.screenshot === true,
					dialog: options.dialog,
					downloads: options.downloads,
				})
				: null;

		return successResult({
			action: options.action,
			result: actResult.data ?? {},
			policy,
			auditId,
			path: actPath,
			tabId: actTabId,
			...(state?.success && state.data ? { state: state.data } : {}),
		}, {
			path: actPath ?? "a11y",
			sessionId,
			policyDecision: policy,
			auditId,
		});
	}

	/**
	 * Execute a deterministic multi-step browser task sequence.
	 * Each step runs browserAct with the given parameters.
	 * Supports continueOnFailure to proceed past errors.
	 * Returns all step results in order with duration tracking,
	 * correct completed/successful/failed counts, per-step policy metadata,
	 * and a final browser state after task completion.
	 */
	async taskRun(options: {
		steps: TaskStep[];
		continueOnFailure?: boolean;
		writeOutput?: (opts: { filename: string; content: string; subdir?: "runtime" | "reports" | "screenshots" | "artifacts" }) => Promise<ActionResult<Record<string, unknown>>>;
	}): Promise<ActionResult<TaskRunResult>> {
		const sessionId = this.getSessionId();
		const results: TaskStepResult[] = [];
		let aborted = false;
		let failedStepIndex: number | null = null;

		const BROWSER_ACTIONS = new Set([
			"click", "fill", "press", "hover", "scroll", "type", "paste",
			"screenshot", "tab-close", "open", "navigate", "openMany",
			"capture", "captureMany", "fillMany", "state",
		]);

		// Validate all steps before execution
		for (let i = 0; i < options.steps.length; i++) {
			const step = options.steps[i];
			if (!step.action) {
				return failureResult(`Step ${i}: 'action' is required`, { path: "a11y", sessionId });
			}
			if (!BROWSER_ACTIONS.has(step.action) && step.action !== "writeOutput") {
				return failureResult(`Step ${i}: Unknown action '${step.action}'. Allowed: ${[...BROWSER_ACTIONS, "writeOutput"].join(", ")}`, { path: "a11y", sessionId });
			}
		}

		for (let i = 0; i < options.steps.length; i++) {
			const step = options.steps[i];
			const stepStart = Date.now();

			// Handle writeOutput steps through injected callback (backed by FsActions)
			if (step.action === "writeOutput") {
				const content = step.content ?? step.text ?? "";
				const filename = step.filename ?? step.target ?? "";
				if (step.content === undefined && step.text === undefined) {
					const durationMs = Date.now() - stepStart;
					results.push({ step, success: false, error: "'content' is required for writeOutput step", durationMs });
					if (failedStepIndex === null) failedStepIndex = i;
					if (!options.continueOnFailure) { aborted = true; break; }
					continue;
				}
				if (!filename) {
					const durationMs = Date.now() - stepStart;
					results.push({ step, success: false, error: "'filename' (or 'target') is required for writeOutput step", durationMs });
					if (failedStepIndex === null) failedStepIndex = i;
					if (!options.continueOnFailure) { aborted = true; break; }
					continue;
				}
				if (!options.writeOutput) {
					const durationMs = Date.now() - stepStart;
					results.push({ step, success: false, error: "writeOutput callback not available — writeOutput steps require FsActions", durationMs });
					if (failedStepIndex === null) failedStepIndex = i;
					if (!options.continueOnFailure) { aborted = true; break; }
					continue;
				}
				const wRes = await options.writeOutput({ filename, content, subdir: step.subdir });
				const durationMs = Date.now() - stepStart;
				if (wRes.success) {
					results.push({
						step, success: true, result: wRes.data ?? {}, durationMs,
						policy: wRes.policyDecision, auditId: wRes.auditId, path: wRes.path, tabId: step.tabId,
					});
				} else {
					results.push({
						step, success: false, error: wRes.error ?? "writeOutput failed", durationMs,
						policy: wRes.policyDecision, auditId: wRes.auditId, path: wRes.path,
					});
					if (failedStepIndex === null) failedStepIndex = i;
					if (!options.continueOnFailure) { aborted = true; break; }
				}
				continue;
			}

			const actResult = await this.browserAct({
				action: step.action as BrowserActionName,
				target: step.target,
				text: step.text,
				key: step.key,
				timeoutMs: step.timeoutMs,
				force: step.force,
				commit: step.commit,
				direction: step.direction,
				amount: step.amount,
				delayMs: step.delayMs,
				tabId: step.tabId,
				copyTo: step.copyTo,
				outputPath: step.outputPath,
				fullPage: step.fullPage,
				annotate: step.annotate,
				refs: step.refs,
				captureOnSuccess: step.captureOnSuccess,
				dialog: step.dialog,
				downloads: step.downloads,
				url: step.url,
				urls: step.urls,
				waitUntil: step.waitUntil,
				fields: step.fields,
				continueOnFailure: step.continueOnFailure,
				parallel: step.parallel,
				concurrency: step.concurrency,
				boxes: step.boxes,
				rootSelector: step.rootSelector,
				snapshot: step.snapshot,
				screenshot: step.screenshot,
			});

			const durationMs = Date.now() - stepStart;

			if (actResult.success) {
				results.push({
					step,
					success: true,
					result: actResult.data ?? {},
					durationMs,
					policy: actResult.policyDecision,
					auditId: actResult.auditId,
					path: actResult.path,
					tabId: (actResult.data as Record<string, unknown> | undefined)?.tabId as string | undefined ?? step.tabId,
				});
			} else {
				results.push({
					step,
					success: false,
					error: actResult.error ?? "Unknown error",
					durationMs,
					policy: actResult.policyDecision,
					auditId: actResult.auditId,
					path: actResult.path,
					tabId: (actResult.data as Record<string, unknown> | undefined)?.tabId as string | undefined ?? step.tabId,
				});
				if (failedStepIndex === null) {
					failedStepIndex = i;
				}
				if (!options.continueOnFailure) {
					aborted = true;
					break;
				}
			}
		}

		const completedSteps = results.filter(r => r.success).length;
		const executedSteps = results.length;

		// Collect final browser state (compact, no snapshot/screenshot by default)
		let finalState: BrowserStateResult | undefined;
		if (executedSteps > 0) {
			const stateRes = await this.browserState({
				snapshot: false,
				screenshot: false,
				dialog: true,
				downloads: false,
			});
			if (stateRes.success && stateRes.data) {
				finalState = stateRes.data;
			}
		}

		return successResult({
			results,
			completedSteps,
			executedSteps,
			successfulSteps: completedSteps,
			totalSteps: options.steps.length,
			aborted,
			failedStepIndex,
			finalState,
		}, {
			path: "a11y",
			sessionId,
		});
	}

	async downloadsList(): Promise<ActionResult<ExtendedDownloadResult[]>> {
		const sessionId = this.getSessionId();

		// Route through policy (low risk)
		const policyEval = this.context.sessionManager.evaluateAction(
			"browser_downloads_list",
			{},
		);
		if (!isPolicyAllowed(policyEval))
			return policyEval as ActionResult<ExtendedDownloadResult[]>;

		try {
			this.getPages();
			const downloadsDir = getSessionDownloadsDir(sessionId);
			const helpers = { fs, path };

			if (this.downloadRegistry.length > 0) {
				const registryOnly = [...this.downloadRegistry]
					.sort((a, b) => b.sortTimeMs - a.sortTimeMs)
					.map(({ sortTimeMs: _sortTimeMs, ...download }) => download);
				return successResult(registryOnly, {
					path: policyEval.path,
					sessionId,
					policyDecision: policyEval.policyDecision,
					risk: policyEval.risk,
					auditId: policyEval.auditId,
				});
			}

			if (!helpers.fs.existsSync(downloadsDir)) {
				return successResult([], {
					path: policyEval.path,
					sessionId,
					policyDecision: policyEval.policyDecision,
					risk: policyEval.risk,
					auditId: policyEval.auditId,
				});
			}

			const entries = helpers.fs.readdirSync(downloadsDir);
			const downloads: Array<ExtendedDownloadResult & { sortTimeMs: number }> = [];

			for (const entry of entries) {
				const fullPath = helpers.path.join(downloadsDir, entry);
				try {
					const stats = helpers.fs.statSync(fullPath);
					if (stats.isFile()) {
						downloads.push({
							url: "", // URL is not persisted in current implementation
							suggestedFilename: entry,
							path: fullPath,
							sizeBytes: stats.size,
							status: "completed",
							completedAt: stats.mtime.toISOString(),
							source: "filesystem-fallback",
							sortTimeMs: stats.mtimeMs,
						});
					}
				} catch {}
			}

			// Sort by modification time (most recent first)
			downloads.sort((a, b) => b.sortTimeMs - a.sortTimeMs);
			const result = downloads.map(({ sortTimeMs: _sortTimeMs, ...download }) => download);

			return successResult(result, {
				path: policyEval.path,
				sessionId,
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				auditId: policyEval.auditId,
			});
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			return this.failureWithDebug(`Downloads list failed: ${message}`, error, {
				action: "browser_downloads_list",
				path: policyEval.path,
				sessionId,
				policyDecision: policyEval.policyDecision,
				risk: policyEval.risk,
				auditId: policyEval.auditId,
			});
		}
	}
}
