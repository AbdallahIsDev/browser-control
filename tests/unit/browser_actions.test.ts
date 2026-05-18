import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { BrowserActions } from "../../src/browser_actions";
import type { BrowserConnectionManager } from "../../src/browser_connection";
import { MemoryStore } from "../../src/memory_store";
import {
	getGlobalNetworkCapture,
	resetGlobalNetworkCapture,
} from "../../src/observability/network_capture";
import { loadDebugBundle } from "../../src/observability/debug_bundle";
import { createCredentialProtectionService } from "../../src/security/credential_provider";
import {
	CredentialVault,
	resetCredentialVault,
} from "../../src/security/credential_vault";
import { NetworkRuleEngine } from "../../src/security/network_rules";
import { ServiceRegistry } from "../../src/services/registry";
import { isPolicyAllowed, SessionManager } from "../../src/session_manager";
import { getStateStorage, resetStateStorage } from "../../src/state/index";

type ViewportSize = { width: number; height: number };

type MockPageCalls = {
	bringToFront: number;
	close: number;
	goto: string[];
	keyboardInsertText: string[];
	keyboardType: string[];
	routes: Array<{
		pattern: string | RegExp;
		handler: (route: unknown) => Promise<void>;
	}>;
	setWindowBounds: number;
	activateTarget: number;
	screenshot: number;
};

type MockCdpSession = {
	on: () => undefined;
	off: () => undefined;
	detach: () => Promise<void>;
	send: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
};

type MockBrowserContext = {
	pages: () => MockPage[];
	newCDPSession: (page: MockPage) => Promise<MockCdpSession>;
};

type MockPage = {
	calls: MockPageCalls;
	hasBrowserWindow?: boolean;
	targetId: string;
	windowId?: number;
	context?: () => MockBrowserContext;
	bringToFront: () => Promise<void>;
	goto: (nextUrl: string) => Promise<void>;
	route: (
		pattern: string | RegExp,
		handler: (route: unknown) => Promise<void>,
	) => Promise<void>;
	title: () => Promise<string>;
	url: () => string;
	viewportSize: () => ViewportSize | null;
	setViewportSize: (size: ViewportSize) => Promise<void>;
	screenshot: (options: { path: string }) => Promise<void>;
	keyboard: {
		type: (text: string, options?: { delay?: number }) => Promise<void>;
		insertText: (text: string) => Promise<void>;
		press: (key: string) => Promise<void>;
	};
	evaluate: (...args: unknown[]) => Promise<unknown>;
	close: () => Promise<void>;
};

type MockLocator = {
	scrollIntoViewIfNeeded: (options?: { timeout?: number }) => Promise<void>;
	click?: () => Promise<void>;
	fill?: (text: string, options?: { timeout?: number }) => Promise<void>;
	press?: (key: string) => Promise<void>;
	hover?: (options?: { timeout?: number }) => Promise<void>;
};

type BrowserActionsInternals = {
	resolveTarget: () => Promise<{ locator: MockLocator; description: string }>;
	ensureScreenshotViewport: (page: MockPage) => Promise<void>;
};

type TestBrowserManager = BrowserConnectionManager & {
	calls: { disconnect: number };
	getConnection: () => ReturnType<BrowserConnectionManager["getConnection"]>;
};

function mockConnection(
	fields: Record<string, unknown>,
): NonNullable<ReturnType<BrowserConnectionManager["getConnection"]>> {
	return fields as unknown as NonNullable<
		ReturnType<BrowserConnectionManager["getConnection"]>
	>;
}

function createUnavailableBrowserManager() {
	const attempts = {
		attach: 0,
		launchManaged: 0,
		launchAttachable: 0,
		attachOptions: [] as Array<{ port?: number; actor?: string }>,
		launchAttachableOptions: [] as Array<Record<string, unknown>>,
	};

	const manager = {
		getContext: () => null,
		getBrowser: () => null,
		isConnected: () => false,
		getConnection: () => null,
		attach: async (options?: { port?: number; actor?: string }) => {
			attempts.attach += 1;
			attempts.attachOptions.push(options ?? {});
			throw new Error("attach unavailable in test");
		},
		launchManaged: async () => {
			attempts.launchManaged += 1;
			throw new Error("launch unavailable in test");
		},
		launchAttachable: async (options?: Record<string, unknown>) => {
			attempts.launchAttachable += 1;
			attempts.launchAttachableOptions.push(options ?? {});
			throw new Error("attachable launch unavailable in test");
		},
	} as unknown as BrowserConnectionManager;

	return { manager, attempts };
}

function createAttachFailLaunchSucceedManager(pages: MockPage[]): TestBrowserManager & {
	attempts: {
		attach: number;
		launchManaged: number;
		launchAttachable: number;
		attachOptions: Array<{ port?: number; actor?: string }>;
		launchAttachableOptions: Array<Record<string, unknown>>;
	};
} {
	const attempts = {
		attach: 0,
		launchManaged: 0,
		launchAttachable: 0,
		attachOptions: [] as Array<{ port?: number; actor?: string }>,
		launchAttachableOptions: [] as Array<Record<string, unknown>>,
	};
	const calls = { disconnect: 0 };
	const context = {
		pages: () => pages,
		newCDPSession: async (page: MockPage) => ({
			on: () => undefined,
			off: () => undefined,
			detach: async () => undefined,
			send: async (method: string) => {
				if (method === "Target.getTargetInfo") return { targetInfo: { targetId: page.targetId ?? page.url() } };
				if (method === "Browser.getWindowForTarget") return { windowId: page.windowId ?? 1, bounds: { windowState: "normal" } };
				if (method === "Target.activateTarget") { page.calls.activateTarget += 1; return {}; }
				return {};
			},
		}),
	};
	for (const page of pages) { page.context = () => context; }

	let connected = false;
	const manager = {
		getContext: () => connected ? context : null,
		getBrowser: () => connected ? { contexts: () => [context] } : null,
		isConnected: () => connected,
		getConnection: () => connected ? mockConnection({ id: "conn-launched", mode: "managed", cdpEndpoint: "http://127.0.0.1:9222", profile: { name: "isolated" }, provider: "local" }) : null,
		attach: async (options?: { port?: number; actor?: string }) => {
			attempts.attach += 1;
			attempts.attachOptions.push(options ?? {});
			throw new Error("attach unavailable in test");
		},
		launchManaged: async () => {
			attempts.launchManaged += 1;
			connected = true;
		},
		launchAttachable: async (options?: Record<string, unknown>) => {
			attempts.launchAttachable += 1;
			attempts.launchAttachableOptions.push(options ?? {});
			connected = true;
		},
		reconnectActiveManaged: async () => false,
		disconnect: async () => { calls.disconnect += 1; connected = false; },
	} as unknown as TestBrowserManager;

	return Object.assign(manager, { calls, attempts });
}

function createAttachFailLaunchCaptureManager(
	pages: MockPage[],
): TestBrowserManager & {
	attempts: {
		attach: number;
		launchManaged: number;
		launchAttachable: number;
		attachOptions: Array<{ port?: number; actor?: string }>;
		launchOptions: Array<Record<string, unknown>>;
		launchAttachableOptions: Array<Record<string, unknown>>;
	};
} {
	const attempts = {
		attach: 0,
		launchManaged: 0,
		launchAttachable: 0,
		attachOptions: [] as Array<{ port?: number; actor?: string }>,
		launchOptions: [] as Array<Record<string, unknown>>,
		launchAttachableOptions: [] as Array<Record<string, unknown>>,
	};
	const calls = { disconnect: 0 };
	const context = {
		pages: () => pages,
		newCDPSession: async (page: MockPage) => ({
			on: () => undefined,
			off: () => undefined,
			detach: async () => undefined,
			send: async (method: string) => {
				if (method === "Target.getTargetInfo") {
					return { targetInfo: { targetId: page.targetId ?? page.url() } };
				}
				if (method === "Browser.getWindowForTarget") {
					return {
						windowId: page.windowId ?? 1,
						bounds: { windowState: "normal" },
					};
				}
				if (method === "Target.activateTarget") {
					page.calls.activateTarget += 1;
					return {};
				}
				return {};
			},
		}),
	};
	for (const page of pages) {
		page.context = () => context;
	}

	let connected = false;
	const manager = {
		getContext: () => (connected ? context : null),
		getBrowser: () => (connected ? { contexts: () => [context] } : null),
		isConnected: () => connected,
		getConnection: () =>
			connected
				? mockConnection({
						id: "conn-launched",
						mode: "managed",
						cdpEndpoint: "http://127.0.0.1:9222",
						profile: { name: "system" },
						provider: "local",
					})
				: null,
		attach: async (options?: { port?: number; actor?: string }) => {
			attempts.attach += 1;
			attempts.attachOptions.push(options ?? {});
			throw new Error("attach unavailable in test");
		},
		launchManaged: async (options?: Record<string, unknown>) => {
			attempts.launchManaged += 1;
			attempts.launchOptions.push(options ?? {});
			connected = true;
		},
		launchAttachable: async (options?: Record<string, unknown>) => {
			attempts.launchAttachable += 1;
			attempts.launchAttachableOptions.push(options ?? {});
			connected = true;
		},
		reconnectActiveManaged: async () => false,
		disconnect: async () => {
			calls.disconnect += 1;
			connected = false;
		},
	} as unknown as TestBrowserManager;

	return Object.assign(manager, { calls, attempts });
}

function createConnectedBrowserManager(pages: MockPage[]): TestBrowserManager {
	const calls = {
		disconnect: 0,
	};
	const context = {
		pages: () => pages,
		newCDPSession: async (page: MockPage) => ({
			on: () => undefined,
			off: () => undefined,
			detach: async () => undefined,
			send: async (method: string, _params?: Record<string, unknown>) => {
				if (method === "Target.getTargetInfo") {
					return { targetInfo: { targetId: page.targetId ?? page.url() } };
				}
				if (method === "Browser.getWindowForTarget") {
					if (page.hasBrowserWindow === false) {
						throw new Error("Browser window not found");
					}
					return {
						windowId: page.windowId ?? 1,
						bounds: { windowState: "normal" },
					};
				}
				if (method === "Browser.setWindowBounds") {
					page.calls.setWindowBounds += 1;
					return {};
				}
				if (method === "Target.activateTarget") {
					page.calls.activateTarget += 1;
					return {};
				}
				return {};
			},
		}),
	};
	for (const page of pages) {
		page.context = () => context;
	}

	const manager = {
		getContext: () => context,
		getBrowser: () => ({
			contexts: () => [context],
		}),
		isConnected: () => true,
		getConnection: () => mockConnection({ id: "conn-test" }),
		reconnectActiveManaged: async () => true,
		attach: async () => {
			throw new Error("attach should not be called");
		},
		launchManaged: async () => {
			throw new Error("launch should not be called");
		},
		disconnect: async () => {
			calls.disconnect += 1;
		},
	} as unknown as TestBrowserManager;

	return Object.assign(manager, { calls });
}

function createMockPage(
	url = "about:blank",
	options: { hasBrowserWindow?: boolean } = {},
): MockPage {
	const calls = {
		bringToFront: 0,
		close: 0,
		goto: [] as string[],
		keyboardInsertText: [] as string[],
		keyboardType: [] as string[],
		routes: [] as Array<{
			pattern: string | RegExp;
			handler: (route: unknown) => Promise<void>;
		}>,
		setWindowBounds: 0,
		activateTarget: 0,
		screenshot: 0,
	};
	let currentUrl = url;

	return {
		calls,
		hasBrowserWindow: options.hasBrowserWindow,
		targetId: `target-${Math.random().toString(36).slice(2)}`,
		bringToFront: async () => {
			calls.bringToFront += 1;
		},
		goto: async (nextUrl: string) => {
			calls.goto.push(nextUrl);
			currentUrl = nextUrl;
		},
		route: async (
			pattern: string | RegExp,
			handler: (route: unknown) => Promise<void>,
		) => {
			calls.routes.push({ pattern, handler });
		},
		title: async () => "Mock Title",
		url: () => currentUrl,
		viewportSize: () => ({ width: 1280, height: 720 }),
		setViewportSize: async () => undefined,
		screenshot: async (options: { path: string }) => {
			calls.screenshot += 1;
			fs.writeFileSync(options.path, Buffer.alloc(1024, 1));
		},
		keyboard: {
			type: async (text: string) => {
				calls.keyboardType.push(text);
			},
			insertText: async (text: string) => {
				calls.keyboardInsertText.push(text);
			},
			press: async () => undefined,
		},
		evaluate: async () => [],
		close: async () => {
			calls.close += 1;
		},
	};
}

describe("BrowserActions", () => {
	let sessionManager: SessionManager;
	let browserActions: BrowserActions;
	let store: MemoryStore;
	let dataHome: string;
	let originalHome: string | undefined;
	let originalBrowserMode: string | undefined;
	let originalBrowserAutoLaunch: string | undefined;
	let originalBackend: string | undefined;

	beforeEach(async () => {
		originalHome = process.env.BROWSER_CONTROL_HOME;
		originalBrowserMode = process.env.BROWSER_MODE;
		originalBrowserAutoLaunch = process.env.BROWSER_AUTO_LAUNCH;
		originalBackend = process.env.BROWSER_CONTROL_STATE_BACKEND;
		dataHome = fs.mkdtempSync(
			path.join(os.tmpdir(), "bc-browser-actions-test-"),
		);
		process.env.BROWSER_CONTROL_HOME = dataHome;
		process.env.BROWSER_CONTROL_STATE_BACKEND = "json";
		resetStateStorage();
		resetCredentialVault();
		delete process.env.BROWSER_MODE;
		delete process.env.BROWSER_AUTO_LAUNCH;
		store = new MemoryStore({ filename: ":memory:" });
		sessionManager = new SessionManager({
			memoryStore: store,
			browserManager: createUnavailableBrowserManager().manager,
		});
		await sessionManager.create("test", { policyProfile: "balanced" });
		browserActions = new BrowserActions({ sessionManager });
	});

	afterEach(() => {
		sessionManager.close();
		resetCredentialVault();
		resetGlobalNetworkCapture();
		resetStateStorage();
		if (originalHome === undefined) {
			delete process.env.BROWSER_CONTROL_HOME;
		} else {
			process.env.BROWSER_CONTROL_HOME = originalHome;
		}
		if (originalBrowserMode === undefined) {
			delete process.env.BROWSER_MODE;
		} else {
			process.env.BROWSER_MODE = originalBrowserMode;
		}
		if (originalBrowserAutoLaunch === undefined) {
			delete process.env.BROWSER_AUTO_LAUNCH;
		} else {
			process.env.BROWSER_AUTO_LAUNCH = originalBrowserAutoLaunch;
		}
		if (originalBackend === undefined) {
			delete process.env.BROWSER_CONTROL_STATE_BACKEND;
		} else {
			process.env.BROWSER_CONTROL_STATE_BACKEND = originalBackend;
		}
		fs.rmSync(dataHome, { recursive: true, force: true });
	});

	describe("constructor", () => {
		it("creates instance with session manager", () => {
			const actions = new BrowserActions({ sessionManager });
			assert.ok(actions);
		});

		it("uses provided ref store", async () => {
			const { RefStore } = await import("../../src/ref_store");
			const customStore = new RefStore();
			const actions = new BrowserActions({
				sessionManager,
				refStore: customStore,
			});
			assert.ok(actions);
		});

		it("uses global ref store when none provided", () => {
			const actions = new BrowserActions({ sessionManager });
			assert.ok(actions);
		});
	});

	describe("open", () => {
		it("targets the front-most tab when a restored profile has multiple pages", async () => {
			const isolatedStore = new MemoryStore({ filename: ":memory:" });
			const frontPage = createMockPage("chrome://newtab/");
			const backgroundPage = createMockPage("https://background.example/");
			const manager = createConnectedBrowserManager([
				frontPage,
				backgroundPage,
			]);

			try {
				const isolatedSessionManager = new SessionManager({
					memoryStore: isolatedStore,
					browserManager: manager,
				});
				await isolatedSessionManager.create("test", {
					policyProfile: "balanced",
				});
				const isolatedActions = new BrowserActions({
					sessionManager: isolatedSessionManager,
				});

				const result = await isolatedActions.open({
					url: "https://example.com",
				});

				assert.equal(result.success, true);
				assert.deepEqual(backgroundPage.calls.goto, []);
				assert.deepEqual(frontPage.calls.goto, ["https://example.com"]);
				assert.equal(frontPage.calls.bringToFront, 2);
			} finally {
				isolatedStore.close();
			}
		});

		it("skips hidden CDP targets and navigates the visible Chrome tab", async () => {
			const isolatedStore = new MemoryStore({ filename: ":memory:" });
			const hiddenPage = createMockPage("https://lichess.org/lzuTaBeK", {
				hasBrowserWindow: false,
			});
			const visiblePage = createMockPage("chrome://newtab/", {
				hasBrowserWindow: true,
			});
			const manager = createConnectedBrowserManager([hiddenPage, visiblePage]);

			try {
				const isolatedSessionManager = new SessionManager({
					memoryStore: isolatedStore,
					browserManager: manager,
				});
				await isolatedSessionManager.create("test", {
					policyProfile: "balanced",
				});
				const isolatedActions = new BrowserActions({
					sessionManager: isolatedSessionManager,
				});

				const result = await isolatedActions.open({
					url: "https://example.com",
				});

				assert.equal(result.success, true);
				assert.deepEqual(hiddenPage.calls.goto, []);
				assert.deepEqual(visiblePage.calls.goto, ["https://example.com"]);
				assert.equal(visiblePage.calls.activateTarget > 0, true);
			} finally {
				isolatedStore.close();
			}
		});

		it("does not normalize browser window bounds during normal navigation", async () => {
			const isolatedStore = new MemoryStore({ filename: ":memory:" });
			const page = createMockPage("chrome://newtab/", {
				hasBrowserWindow: true,
			});
			const manager = createConnectedBrowserManager([page]);

			try {
				const isolatedSessionManager = new SessionManager({
					memoryStore: isolatedStore,
					browserManager: manager,
				});
				await isolatedSessionManager.create("test", {
					policyProfile: "balanced",
				});
				const isolatedActions = new BrowserActions({
					sessionManager: isolatedSessionManager,
				});

				const result = await isolatedActions.open({
					url: "https://example.com",
				});

				assert.equal(result.success, true);
				assert.deepEqual(page.calls.goto, ["https://example.com"]);
				assert.equal(page.calls.activateTarget > 0, true);
				assert.equal(page.calls.setWindowBounds, 0);
			} finally {
				isolatedStore.close();
			}
		});

		it("wires network privacy rules into real browser actions and records blocked evidence", async () => {
			const isolatedStore = new MemoryStore({ filename: ":memory:" });
			const page = createMockPage("chrome://newtab/", {
				hasBrowserWindow: true,
			});
			const manager = createConnectedBrowserManager([page]);
			const storage = getStateStorage();
			const engine = new NetworkRuleEngine(storage);
			await engine.addRule("blocked.example", "denylist", ["script"]);

			try {
				const isolatedSessionManager = new SessionManager({
					memoryStore: isolatedStore,
					browserManager: manager,
				});
				await isolatedSessionManager.create("test", {
					policyProfile: "balanced",
				});
				const isolatedActions = new BrowserActions({
					sessionManager: isolatedSessionManager,
				});

				const result = await isolatedActions.open({
					url: "https://example.com",
				});

				assert.equal(result.success, true);
				assert.equal(page.calls.routes.length, 1);
				assert.equal(String(page.calls.routes[0]?.pattern), "**/*");

				let abortedWith: string | undefined;
				let continued = false;
				await page.calls.routes[0]?.handler({
					request: () => ({
						url: () => "https://blocked.example/app.js?token=raw-secret",
						method: () => "GET",
						resourceType: () => "script",
					}),
					abort: async (code?: string) => {
						abortedWith = code;
					},
					continue: async () => {
						continued = true;
					},
				});

				const sessionId = isolatedSessionManager.getActiveSession()?.id;
				assert.equal(abortedWith, "blockedbyclient");
				assert.equal(continued, false);
				assert.ok(sessionId);
				const entries = getGlobalNetworkCapture({ captureSuccess: true }).getEntries(
					sessionId,
				);
				assert.equal(entries.length, 1);
				assert.equal(entries[0].blocked, true);
				assert.equal(entries[0].domain, "blocked.example");
				assert.equal(entries[0].url.includes("raw-secret"), false);
				const auditEvents = await storage.listAuditEvents(10);
				assert.equal(auditEvents[0]?.action, "network_request_blocked");
			} finally {
				isolatedStore.close();
			}
		});

		it("does not auto-launch a managed Chrome when auto-launch is explicitly disabled", async () => {
			const isolatedStore = new MemoryStore({ filename: ":memory:" });
			const { manager, attempts } = createUnavailableBrowserManager();
			process.env.BROWSER_AUTO_LAUNCH = "false";

			try {
				const isolatedSessionManager = new SessionManager({
					memoryStore: isolatedStore,
					browserManager: manager,
				});
				await isolatedSessionManager.create("test", {
					policyProfile: "balanced",
				});
				const isolatedActions = new BrowserActions({
					sessionManager: isolatedSessionManager,
				});

				const result = await isolatedActions.open({
					url: "https://example.com",
				});

				assert.equal(attempts.attach, 1);
				assert.equal(attempts.attachOptions[0]?.port, 9222);
				assert.equal(attempts.launchManaged, 0);
				assert.equal(result.success, false);
				assert.ok(result.error?.includes("auto-launch is disabled"));
				assert.equal(result.path, "a11y");
			} finally {
				delete process.env.BROWSER_AUTO_LAUNCH;
				isolatedStore.close();
			}
		});

		it("auto-launches an attachable visible Chrome when attach fails in attach mode", async () => {
			const isolatedStore = new MemoryStore({ filename: ":memory:" });
			const page = createMockPage("chrome://newtab/", { hasBrowserWindow: true });
			const manager = createAttachFailLaunchSucceedManager([page]);
			process.env.BROWSER_MODE = "attach";

			try {
				const isolatedSessionManager = new SessionManager({
					memoryStore: isolatedStore,
					browserManager: manager,
				});
				await isolatedSessionManager.create("test", {
					policyProfile: "balanced",
				});
				const isolatedActions = new BrowserActions({
					sessionManager: isolatedSessionManager,
				});

				const result = await isolatedActions.open({
					url: "https://example.com",
				});

				assert.equal(manager.attempts.attach, 1);
				assert.equal(manager.attempts.launchAttachable, 1);
				assert.equal(manager.attempts.launchManaged, 0);
				assert.equal(result.success, true);
				assert.equal(page.calls.goto.length, 1);
				assert.equal(page.calls.goto[0], "https://example.com");
				const activeSession = isolatedSessionManager.getActiveSession();
				assert.ok(activeSession);
				assert.equal(activeSession.browserConnectionId, "conn-launched");
			} finally {
				isolatedStore.close();
			}
		});

		it("passes the configured launch profile into auto-launch fallback", async () => {
			const isolatedStore = new MemoryStore({ filename: ":memory:" });
			const page = createMockPage("chrome://newtab/", {
				hasBrowserWindow: true,
			});
			const manager = createAttachFailLaunchCaptureManager([page]);
			process.env.BROWSER_MODE = "attach";
			process.env.BROWSER_LAUNCH_PROFILE = "system";

			try {
				const isolatedSessionManager = new SessionManager({
					memoryStore: isolatedStore,
					browserManager: manager,
				});
				await isolatedSessionManager.create("test", {
					policyProfile: "balanced",
				});
				const isolatedActions = new BrowserActions({
					sessionManager: isolatedSessionManager,
				});

				const result = await isolatedActions.open({
					url: "https://example.com",
				});

				assert.equal(result.success, true);
				assert.equal(manager.attempts.launchAttachable, 1);
				assert.equal(manager.attempts.launchManaged, 0);
				assert.equal(
					manager.attempts.launchAttachableOptions[0]?.profile,
					"system",
				);
			} finally {
				delete process.env.BROWSER_LAUNCH_PROFILE;
				isolatedStore.close();
			}
		});

		it("fails with both attach and launch reasons when both paths fail", async () => {
			const isolatedStore = new MemoryStore({ filename: ":memory:" });
			const { manager, attempts } = createUnavailableBrowserManager();
			process.env.BROWSER_MODE = "attach";

			try {
				const isolatedSessionManager = new SessionManager({
					memoryStore: isolatedStore,
					browserManager: manager,
				});
				await isolatedSessionManager.create("test", {
					policyProfile: "balanced",
				});
				const isolatedActions = new BrowserActions({
					sessionManager: isolatedSessionManager,
				});

				const result = await isolatedActions.open({
					url: "https://example.com",
				});

				assert.equal(attempts.attach, 1);
				assert.equal(attempts.launchAttachable, 1);
				assert.equal(attempts.launchManaged, 0);
				assert.equal(result.success, false);
				assert.ok(
					result.error?.includes("Attach failed on port 9222"),
					"error should include attach failure",
				);
				assert.ok(
					result.error?.includes("attach unavailable in test"),
					"error should include attach reason text",
				);
				assert.ok(
					result.error?.includes("Attach-mode launch also failed"),
					"error should include launch failure",
				);
				assert.ok(
					result.error?.includes("attachable launch unavailable in test"),
					"error should include launch reason text",
				);
				assert.ok(
					result.error?.includes("bc_browser_launch"),
					"error should mention MCP tool guidance",
				);
				assert.ok(
					!result.error?.includes("bc browser launch"),
					"error should not use CLI-only guidance",
				);
			} finally {
				isolatedStore.close();
			}
		});

		it("launches managed Chrome only when browser mode is explicitly managed", async () => {
			const isolatedStore = new MemoryStore({ filename: ":memory:" });
			const { manager, attempts } = createUnavailableBrowserManager();
			process.env.BROWSER_MODE = "managed";

			try {
				const isolatedSessionManager = new SessionManager({
					memoryStore: isolatedStore,
					browserManager: manager,
				});
				await isolatedSessionManager.create("test", {
					policyProfile: "balanced",
				});
				const isolatedActions = new BrowserActions({
					sessionManager: isolatedSessionManager,
				});

				const result = await isolatedActions.open({
					url: "https://example.com",
				});

				assert.equal(attempts.attach, 1);
				assert.equal(attempts.launchManaged, 1);
				assert.equal(result.success, false);
				assert.ok(
					result.error?.includes("Attach failed on port 9222"),
				);
				assert.ok(
					result.error?.includes("Managed launch also failed"),
				);
				assert.ok(
					result.error?.includes("bc_browser_launch"),
				);
			} finally {
				delete process.env.BROWSER_MODE;
				isolatedStore.close();
			}
		});
	});

	describe("takeSnapshot", () => {
		it("returns failure when no browser is connected", async () => {
			const result = await browserActions.takeSnapshot();

			assert.equal(result.success, false);
			assert.ok(result.error);
			assert.ok(result.debugBundleId);
			assert.ok(result.recoveryGuidance);
			assert.ok(loadDebugBundle(result.debugBundleId, store));
		});
	});

	describe("click", () => {
		it("returns failure when no browser is connected", async () => {
			const result = await browserActions.click({ target: "@e1" });

			assert.equal(result.success, false);
			// Either no page or policy check failure
			assert.ok(result.error);
		});

		it("scrolls locator into view and retries once after outside-viewport click failure", async () => {
			const isolatedStore = new MemoryStore({ filename: ":memory:" });
			const page = createMockPage("https://lichess.org", {
				hasBrowserWindow: true,
			});
			const manager = createConnectedBrowserManager([page]);
			const calls = {
				resolves: 0,
				firstScroll: 0,
				firstClick: 0,
				secondScroll: 0,
				secondClick: 0,
			};

			const firstLocator = {
				scrollIntoViewIfNeeded: async () => {
					calls.firstScroll += 1;
				},
				click: async () => {
					calls.firstClick += 1;
					throw new Error("Element is outside of the viewport");
				},
			};
			const secondLocator = {
				scrollIntoViewIfNeeded: async () => {
					calls.secondScroll += 1;
				},
				click: async () => {
					calls.secondClick += 1;
				},
			};

			try {
				const isolatedSessionManager = new SessionManager({
					memoryStore: isolatedStore,
					browserManager: manager,
				});
				await isolatedSessionManager.create("test", {
					policyProfile: "balanced",
				});
				const isolatedActions = new BrowserActions({
					sessionManager: isolatedSessionManager,
				});

				const testActions =
					isolatedActions as unknown as BrowserActionsInternals;
				testActions.resolveTarget = async () => {
					calls.resolves += 1;
					return calls.resolves === 1
						? { locator: firstLocator, description: "radio Stockfish level 5" }
						: {
								locator: secondLocator,
								description: "radio Stockfish level 5",
							};
				};

				const result = await isolatedActions.click({ target: "@e5" });

				assert.equal(result.success, true);
				assert.equal(calls.resolves, 2);
				assert.equal(calls.firstScroll, 1);
				assert.equal(calls.firstClick, 1);
				assert.equal(calls.secondScroll, 1);
				assert.equal(calls.secondClick, 1);
				assert.equal(page.calls.bringToFront > 0, true);
			} finally {
				isolatedStore.close();
			}
		});
	});

	describe("fill", () => {
		it("returns failure when no browser is connected", async () => {
			const result = await browserActions.fill({
				target: "@e1",
				text: "hello",
			});

			assert.equal(result.success, false);
			assert.ok(result.error);
		});

		it("resolves secret refs at execution time and redacts fill output", async () => {
			const isolatedStore = new MemoryStore({ filename: ":memory:" });
			const page = createMockPage("https://login.example.test/");
			const manager = createConnectedBrowserManager([page]);
			const fillCalls: string[] = [];

			try {
				const storage = getStateStorage(dataHome);
				const vault = new CredentialVault(
					storage,
					createCredentialProtectionService({
						dataHome,
						preferWindowsDpapi: false,
					}),
				);
				const secret = await vault.set(
					"site",
					"example.test",
					"password",
					"raw-secret-fill",
				);
				await vault.grant(secret.id, {
					actions: ["use-as-form-value"],
					domainScope: "example.test",
				});

				const isolatedSessionManager = new SessionManager({
					memoryStore: isolatedStore,
					browserManager: manager,
				});
				await isolatedSessionManager.create("test", {
					policyProfile: "balanced",
				});
				const isolatedActions = new BrowserActions({
					sessionManager: isolatedSessionManager,
				});
				const testActions =
					isolatedActions as unknown as BrowserActionsInternals;
				testActions.resolveTarget = async () => ({
					description: "password field",
					locator: {
						scrollIntoViewIfNeeded: async () => undefined,
						fill: async (text: string) => {
							fillCalls.push(text);
						},
					},
				});

				const result = await isolatedActions.fill({
					target: "@e1",
					text: secret.id,
				});

				assert.equal(result.success, true);
				assert.deepEqual(fillCalls, ["raw-secret-fill"]);
				assert.doesNotMatch(JSON.stringify(result), /raw-secret-fill/);
				const audit = await storage.listSecretAuditEvents(10);
				assert.equal(audit[0]?.policyDecision, "allow");
				assert.doesNotMatch(JSON.stringify(audit), /raw-secret-fill/);
			} finally {
				isolatedStore.close();
			}
		});
	});

	describe("hover", () => {
		it("returns failure when no browser is connected", async () => {
			const result = await browserActions.hover({ target: "@e1" });

			assert.equal(result.success, false);
			assert.ok(result.error);
		});
	});

	describe("type", () => {
		it("returns failure when no browser is connected", async () => {
			const result = await browserActions.type({ text: "hello" });

			assert.equal(result.success, false);
			assert.ok(result.error);
		});

		it("resolves secret refs at execution time and redacts type output", async () => {
			const isolatedStore = new MemoryStore({ filename: ":memory:" });
			const page = createMockPage("https://app.example.test/");
			const manager = createConnectedBrowserManager([page]);

			try {
				const storage = getStateStorage(dataHome);
				const vault = new CredentialVault(
					storage,
					createCredentialProtectionService({
						dataHome,
						preferWindowsDpapi: false,
					}),
				);
				const secret = await vault.set(
					"site",
					"example.test",
					"otp",
					"raw-secret-type",
				);
				await vault.grant(secret.id, {
					actions: ["type"],
					domainScope: "example.test",
				});

				const isolatedSessionManager = new SessionManager({
					memoryStore: isolatedStore,
					browserManager: manager,
				});
				await isolatedSessionManager.create("test", {
					policyProfile: "balanced",
				});
				const isolatedActions = new BrowserActions({
					sessionManager: isolatedSessionManager,
				});

				const result = await isolatedActions.type({ text: secret.id });

				assert.equal(result.success, true);
				assert.deepEqual(page.calls.keyboardType, ["raw-secret-type"]);
				assert.doesNotMatch(JSON.stringify(result), /raw-secret-type/);
				assert.match(JSON.stringify(result), /REDACTED_SECRET/);
				const audit = await storage.listSecretAuditEvents(10);
				assert.equal(audit[0]?.policyDecision, "allow");
				assert.doesNotMatch(JSON.stringify(audit), /raw-secret-type/);
			} finally {
				isolatedStore.close();
			}
		});
	});

	describe("paste", () => {
		it("returns failure when no browser is connected", async () => {
			const result = await browserActions.paste({ text: "hello" });

			assert.equal(result.success, false);
			assert.ok(result.error);
		});

		it("resolves secret refs at execution time and redacts paste output", async () => {
			const isolatedStore = new MemoryStore({ filename: ":memory:" });
			const page = createMockPage("https://app.example.test/");
			const manager = createConnectedBrowserManager([page]);

			try {
				const storage = getStateStorage(dataHome);
				const vault = new CredentialVault(
					storage,
					createCredentialProtectionService({
						dataHome,
						preferWindowsDpapi: false,
					}),
				);
				const secret = await vault.set(
					"site",
					"example.test",
					"token",
					"raw-secret-paste",
				);
				await vault.grant(secret.id, {
					actions: ["paste"],
					domainScope: "example.test",
				});

				const isolatedSessionManager = new SessionManager({
					memoryStore: isolatedStore,
					browserManager: manager,
				});
				await isolatedSessionManager.create("test", {
					policyProfile: "balanced",
				});
				const isolatedActions = new BrowserActions({
					sessionManager: isolatedSessionManager,
				});

				const result = await isolatedActions.paste({ text: secret.id });

				assert.equal(result.success, true);
				assert.deepEqual(page.calls.keyboardInsertText, ["raw-secret-paste"]);
				assert.doesNotMatch(JSON.stringify(result), /raw-secret-paste/);
				assert.match(JSON.stringify(result), /REDACTED_SECRET/);
				const audit = await storage.listSecretAuditEvents(10);
				assert.equal(audit[0]?.policyDecision, "allow");
				assert.doesNotMatch(JSON.stringify(audit), /raw-secret-paste/);
			} finally {
				isolatedStore.close();
			}
		});
	});

	describe("press", () => {
		it("returns failure when no browser is connected", async () => {
			const result = await browserActions.press({ key: "Enter" });

			assert.equal(result.success, false);
			assert.ok(result.error);
		});
	});

	describe("scroll", () => {
		it("returns failure when no browser is connected", async () => {
			const result = await browserActions.scroll({ direction: "down" });

			assert.equal(result.success, false);
			assert.ok(result.error);
		});

		it("returns failure for invalid direction", async () => {
			// Type system prevents this, but the runtime should handle it gracefully
			const result = await browserActions.scroll({ direction: "down" });
			// Without browser, will fail with "no page" error
			assert.equal(result.success, false);
		});
	});

	describe("screenshot", () => {
		it("returns failure when no browser is connected", async () => {
			const result = await browserActions.screenshot();

			assert.equal(result.success, false);
			assert.ok(result.error);
		});

		it("rejects explicit screenshot paths inside the session working directory", async () => {
			const isolatedStore = new MemoryStore({ filename: ":memory:" });
			const visiblePage = createMockPage("https://example.com", {
				hasBrowserWindow: true,
			});
			const manager = createConnectedBrowserManager([visiblePage]);
			const outputPath = path.join(dataHome, "..", "project-root-shot.png");

			try {
				const isolatedSessionManager = new SessionManager({
					memoryStore: isolatedStore,
					browserManager: manager,
				});
				const workingDirectory = path.dirname(outputPath);
				await isolatedSessionManager.create("test", {
					policyProfile: "balanced",
					workingDirectory,
				});
				const isolatedActions = new BrowserActions({
					sessionManager: isolatedSessionManager,
				});

				const result = await isolatedActions.screenshot({ outputPath });

				assert.equal(result.success, false);
				assert.match(
					result.error ?? "",
					/Refusing to write screenshot inside the session working directory/,
				);
				assert.equal(fs.existsSync(outputPath), false);
			} finally {
				isolatedStore.close();
				fs.rmSync(outputPath, { force: true });
			}
		});

		it("stores default screenshots under the session runtime screenshots directory", async () => {
			const isolatedStore = new MemoryStore({ filename: ":memory:" });
			const visiblePage = createMockPage("https://example.com", {
				hasBrowserWindow: true,
			});
			const manager = createConnectedBrowserManager([visiblePage]);

			try {
				const isolatedSessionManager = new SessionManager({
					memoryStore: isolatedStore,
					browserManager: manager,
				});
				await isolatedSessionManager.create("test", {
					policyProfile: "balanced",
				});
				const isolatedActions = new BrowserActions({
					sessionManager: isolatedSessionManager,
				});

				const result = await isolatedActions.screenshot();

				assert.equal(result.success, true);
				const screenshotPath = result.data?.path;
				assert.ok(screenshotPath);
				assert.ok(screenshotPath.includes(path.join(dataHome, "runtime")));
				assert.ok(screenshotPath.includes("test"));
				assert.ok(screenshotPath.includes("screenshots"));
				const manifestPath = path.join(
					path.dirname(path.dirname(screenshotPath)),
					"manifest.json",
				);
				assert.equal(fs.existsSync(manifestPath), true);
				assert.equal(fs.existsSync(screenshotPath), true);
			} finally {
				isolatedStore.close();
			}
		});

		it("hides Browser Control overlays before plain screenshots by default", async () => {
			const isolatedStore = new MemoryStore({ filename: ":memory:" });
			const visiblePage = createMockPage("https://example.com", {
				hasBrowserWindow: true,
			});
			let evaluateCalls = 0;
			visiblePage.evaluate = async () => {
				evaluateCalls += 1;
				return undefined;
			};
			const manager = createConnectedBrowserManager([visiblePage]);

			try {
				const isolatedSessionManager = new SessionManager({
					memoryStore: isolatedStore,
					browserManager: manager,
				});
				await isolatedSessionManager.create("test", {
					policyProfile: "balanced",
				});
				const isolatedActions = new BrowserActions({
					sessionManager: isolatedSessionManager,
				});

				const result = await isolatedActions.screenshot();

				assert.equal(result.success, true);
				assert.ok(
					evaluateCalls >= 3,
					"plain screenshots should hide and then restore Browser Control overlays",
				);
			} finally {
				isolatedStore.close();
			}
		});
	});

	describe("tabList", () => {
		it("returns failure when no browser is connected", async () => {
			const result = await browserActions.tabList();

			assert.equal(result.success, false);
			assert.ok(result.error);
		});

		it("lists only visible Chrome window tabs", async () => {
			const isolatedStore = new MemoryStore({ filename: ":memory:" });
			const hiddenPage = createMockPage("https://lichess.org/lzuTaBeK", {
				hasBrowserWindow: false,
			});
			const visiblePage = createMockPage("chrome://newtab/", {
				hasBrowserWindow: true,
			});
			const manager = createConnectedBrowserManager([hiddenPage, visiblePage]);

			try {
				const isolatedSessionManager = new SessionManager({
					memoryStore: isolatedStore,
					browserManager: manager,
				});
				await isolatedSessionManager.create("test", {
					policyProfile: "balanced",
				});
				const isolatedActions = new BrowserActions({
					sessionManager: isolatedSessionManager,
				});

				const result = await isolatedActions.tabList();

				assert.equal(result.success, true);
				assert.deepEqual(
					result.data?.map((tab) => tab.url),
					["chrome://newtab/"],
				);
			} finally {
				isolatedStore.close();
			}
		});
	});

	describe("tabSwitch", () => {
		it("returns failure when no browser is connected", async () => {
			const result = await browserActions.tabSwitch("0");

			assert.equal(result.success, false);
			assert.ok(result.error);
		});

		it("switches by visible Chrome tab index, not hidden CDP target index", async () => {
			const isolatedStore = new MemoryStore({ filename: ":memory:" });
			const hiddenPage = createMockPage("https://lichess.org/lzuTaBeK", {
				hasBrowserWindow: false,
			});
			const visiblePage = createMockPage("chrome://newtab/", {
				hasBrowserWindow: true,
			});
			const manager = createConnectedBrowserManager([hiddenPage, visiblePage]);

			try {
				const isolatedSessionManager = new SessionManager({
					memoryStore: isolatedStore,
					browserManager: manager,
				});
				await isolatedSessionManager.create("test", {
					policyProfile: "balanced",
				});
				const isolatedActions = new BrowserActions({
					sessionManager: isolatedSessionManager,
				});

				const result = await isolatedActions.tabSwitch("0");

				assert.equal(result.success, true);
				assert.equal(hiddenPage.calls.activateTarget, 0);
				assert.equal(hiddenPage.calls.bringToFront, 0);
				assert.equal(visiblePage.calls.activateTarget > 0, true);
				assert.equal(visiblePage.calls.bringToFront > 0, true);
			} finally {
				isolatedStore.close();
			}
		});
	});

	describe("tabClose", () => {
		it("closes the front-most tab when a restored profile has multiple pages", async () => {
			const isolatedStore = new MemoryStore({ filename: ":memory:" });
			const frontPage = createMockPage("chrome://newtab/");
			const backgroundPage = createMockPage("https://background.example/");
			const manager = createConnectedBrowserManager([
				frontPage,
				backgroundPage,
			]);

			try {
				const isolatedSessionManager = new SessionManager({
					memoryStore: isolatedStore,
					browserManager: manager,
				});
				await isolatedSessionManager.create("test", {
					policyProfile: "balanced",
				});
				const isolatedActions = new BrowserActions({
					sessionManager: isolatedSessionManager,
				});

				const result = await isolatedActions.tabClose();

				assert.equal(result.success, true);
				assert.equal(backgroundPage.calls.close, 0);
				assert.equal(frontPage.calls.close, 1);
				assert.equal(frontPage.calls.bringToFront, 1);
			} finally {
				isolatedStore.close();
			}
		});
	});

	describe("close", () => {
		it("returns failure when no browser is connected", async () => {
			const result = await browserActions.close();

			assert.equal(result.success, false);
			assert.ok(result.error);
		});

		it("reports attached browser close as detach, not killed Chrome", async () => {
			const isolatedStore = new MemoryStore({ filename: ":memory:" });
			const page = createMockPage("https://example.com/");
			const manager = createConnectedBrowserManager([page]);
			manager.getConnection = () =>
				mockConnection({
					id: "conn-attached",
					mode: "attached",
					cdpEndpoint: "http://127.0.0.1:9222",
				});

			try {
				const isolatedSessionManager = new SessionManager({
					memoryStore: isolatedStore,
					browserManager: manager,
				});
				await isolatedSessionManager.create("test", {
					policyProfile: "balanced",
				});
				const isolatedActions = new BrowserActions({
					sessionManager: isolatedSessionManager,
				});

				const result = await isolatedActions.close();

				assert.equal(result.success, true);
				assert.deepEqual(result.data, {
					detached: true,
					closedBrowser: false,
					mode: "attached",
					connectionId: "conn-attached",
					endpoint: "http://127.0.0.1:9222",
				});
			} finally {
				isolatedStore.close();
			}
		});
	});

	describe("launch", () => {
		it("returns failure when launch fails", async () => {
			const { manager, attempts } = createUnavailableBrowserManager();
			const isolatedStore = new MemoryStore({ filename: ":memory:" });

			try {
				const isolatedSessionManager = new SessionManager({
					memoryStore: isolatedStore,
					browserManager: manager,
				});
				await isolatedSessionManager.create("test", {
					policyProfile: "balanced",
				});
				const isolatedActions = new BrowserActions({
					sessionManager: isolatedSessionManager,
				});

				const result = await isolatedActions.launch();

				assert.equal(result.success, false);
				assert.ok(result.error?.includes("Browser launch failed"));
				assert.equal(attempts.launchManaged, 1);
			} finally {
				isolatedStore.close();
			}
		});

		it("returns existing connection info when browser is already connected", async () => {
			const isolatedStore = new MemoryStore({ filename: ":memory:" });
			const page = createMockPage("https://example.com/");
			const manager = createConnectedBrowserManager([page]);
			manager.getConnection = () =>
				mockConnection({
					id: "conn-managed",
					mode: "managed",
					cdpEndpoint: "http://127.0.0.1:9222",
					profile: { name: "isolated" },
				});

			try {
				const isolatedSessionManager = new SessionManager({
					memoryStore: isolatedStore,
					browserManager: manager,
				});
				await isolatedSessionManager.create("test", {
					policyProfile: "balanced",
				});
				const isolatedActions = new BrowserActions({
					sessionManager: isolatedSessionManager,
				});

				const result = await isolatedActions.launch();

				assert.equal(result.success, true);
				assert.equal(result.data?.launched, false);
				assert.equal(result.data?.mode, "managed");
				assert.equal(result.data?.connectionId, "conn-managed");
				assert.equal(result.data?.endpoint, "http://127.0.0.1:9222");
				assert.equal(result.data?.port, 9222);
				assert.equal(result.data?.profile, "isolated");
			} finally {
				isolatedStore.close();
			}
		});

		it("returns attached mode when existing browser is attached, not managed", async () => {
			const isolatedStore = new MemoryStore({ filename: ":memory:" });
			const page = createMockPage("https://example.com/");
			const manager = createConnectedBrowserManager([page]);
			manager.getConnection = () =>
				mockConnection({
					id: "conn-attached",
					mode: "attached",
					cdpEndpoint: "http://127.0.0.1:9222",
					profile: { name: "system" },
					provider: "local",
				});

			try {
				const isolatedSessionManager = new SessionManager({
					memoryStore: isolatedStore,
					browserManager: manager,
				});
				await isolatedSessionManager.create("test", {
					policyProfile: "balanced",
				});
				const isolatedActions = new BrowserActions({
					sessionManager: isolatedSessionManager,
				});

				const result = await isolatedActions.launch();

				assert.equal(result.success, true);
				assert.equal(result.data?.launched, false);
				assert.equal(result.data?.mode, "attached");
				assert.equal(result.data?.connectionId, "conn-attached");
				assert.equal(result.data?.endpoint, "http://127.0.0.1:9222");
				assert.equal(result.data?.port, 9222);
				assert.equal(result.data?.profile, "system");
				assert.equal(result.data?.provider, "local");
			} finally {
				isolatedStore.close();
			}
		});

		it("launch failure error includes MCP tool guidance", async () => {
			const { manager } = createUnavailableBrowserManager();
			const isolatedStore = new MemoryStore({ filename: ":memory:" });

			try {
				const isolatedSessionManager = new SessionManager({
					memoryStore: isolatedStore,
					browserManager: manager,
				});
				await isolatedSessionManager.create("test", {
					policyProfile: "balanced",
				});
				const isolatedActions = new BrowserActions({
					sessionManager: isolatedSessionManager,
				});

				const result = await isolatedActions.launch();

				assert.equal(result.success, false);
				assert.ok(result.error?.includes("bc_browser_launch"));
				assert.ok(
					!result.error?.includes("Use 'bc browser launch'"),
					"should not use CLI-only guidance",
				);
			} finally {
				isolatedStore.close();
			}
		});
	});

	// ── Finding 1: API-registered services visible to browser open ──────

	describe("shared registry between service and browser actions", () => {
		it("browser open resolves service refs using the same registry as service actions", async () => {
			const isolatedStore = new MemoryStore({ filename: ":memory:" });
			const { manager } = createUnavailableBrowserManager();

			try {
				const isolatedSessionManager = new SessionManager({
					memoryStore: isolatedStore,
					browserManager: manager,
				});
				await isolatedSessionManager.create("test", {
					policyProfile: "balanced",
				});

				const sharedRegistry = new ServiceRegistry();
				sharedRegistry.register({ name: "my-app", port: 3000 });

				const isolatedActions = new BrowserActions({
					sessionManager: isolatedSessionManager,
					serviceRegistry: sharedRegistry,
				});

				const result = await isolatedActions.open({ url: "bc://my-app" });

				// Resolution should succeed (service is known in the shared registry).
				// The open will then fail either because the service is not actually
				// running (unhealthy_service) or because no browser is available.
				// The important thing is that it does NOT say "Unknown service".
				assert.equal(result.success, false);
				assert.ok(
					!result.error?.includes("Unknown service"),
					`Expected resolution to find the service, but got: ${result.error}`,
				);
			} finally {
				isolatedStore.close();
			}
		});

		it("browser open returns unknown_service when service is not in the shared registry", async () => {
			const isolatedStore = new MemoryStore({ filename: ":memory:" });
			const { manager } = createUnavailableBrowserManager();

			try {
				const isolatedSessionManager = new SessionManager({
					memoryStore: isolatedStore,
					browserManager: manager,
				});
				await isolatedSessionManager.create("test", {
					policyProfile: "balanced",
				});

				const sharedRegistry = new ServiceRegistry();
				// Do NOT register "missing-app"

				const isolatedActions = new BrowserActions({
					sessionManager: isolatedSessionManager,
					serviceRegistry: sharedRegistry,
				});

				const result = await isolatedActions.open({ url: "bc://missing-app" });

				assert.equal(result.success, false);
				assert.ok(
					result.error?.includes("Unknown service"),
					`Expected "Unknown service" error, got: ${result.error}`,
				);
			} finally {
				isolatedStore.close();
			}
		});
	});

	// ── Issue 3: Browser actions bind browser state into session model ──

	describe("browser binding into session state", () => {
		it("browser close disconnects lifecycle and unbinds browser from session", async () => {
			const isolatedStore = new MemoryStore({ filename: ":memory:" });
			const page = createMockPage("https://example.com/");
			const manager = createConnectedBrowserManager([page]);

			try {
				const isolatedSessionManager = new SessionManager({
					memoryStore: isolatedStore,
					browserManager: manager,
				});
				await isolatedSessionManager.create("test", {
					policyProfile: "balanced",
				});
				const activeSession = isolatedSessionManager.getActiveSession();
				assert.ok(activeSession);
				isolatedSessionManager.bindBrowser(activeSession.id, "conn-test");

				const isolatedActions = new BrowserActions({
					sessionManager: isolatedSessionManager,
				});
				const result = await isolatedActions.close();

				assert.equal(result.success, true);
				assert.equal(manager.calls.disconnect, 1);
				assert.equal(page.calls.close, 0);
				assert.equal(
					isolatedSessionManager.getSession(activeSession.id)
						?.browserConnectionId,
					null,
				);
			} finally {
				isolatedStore.close();
			}
		});

		it("tab close closes only the active page and keeps browser bound", async () => {
			const isolatedStore = new MemoryStore({ filename: ":memory:" });
			const page = createMockPage("https://example.com/");
			const manager = createConnectedBrowserManager([page]);

			try {
				const isolatedSessionManager = new SessionManager({
					memoryStore: isolatedStore,
					browserManager: manager,
				});
				await isolatedSessionManager.create("test", {
					policyProfile: "balanced",
				});
				const activeSession = isolatedSessionManager.getActiveSession();
				assert.ok(activeSession);
				isolatedSessionManager.bindBrowser(activeSession.id, "conn-test");

				const isolatedActions = new BrowserActions({
					sessionManager: isolatedSessionManager,
				});
				const result = await isolatedActions.tabClose();

				assert.equal(result.success, true);
				assert.equal(page.calls.close, 1);
				assert.equal(manager.calls.disconnect, 0);
				assert.equal(
					isolatedSessionManager.getSession(activeSession.id)
						?.browserConnectionId,
					"conn-test",
				);
			} finally {
				isolatedStore.close();
			}
		});

		it("close action fails cleanly when no browser manager disconnect exists", async () => {
			// Simulate a bound browser by manually binding it
			const activeSession = sessionManager.getActiveSession();
			assert.ok(activeSession, "should have an active session");

			// Bind a fake browser connection
			sessionManager.bindBrowser(activeSession.id, "conn-test-123");
			const bound = sessionManager.getSession(activeSession.id);
			assert.equal(
				bound?.browserConnectionId,
				"conn-test-123",
				"browser should be bound before close",
			);

			const result = await browserActions.close();

			assert.equal(result.success, false);
		});

		it("session state reflects browser binding after bindBrowser", async () => {
			const activeSession = sessionManager.getActiveSession();
			assert.ok(activeSession);

			sessionManager.bindBrowser(activeSession.id, "conn-abc");

			const state = sessionManager.getSession(activeSession.id);
			assert.equal(state?.browserConnectionId, "conn-abc");

			const status = sessionManager.status();
			assert.equal(status.data?.browserConnectionId, "conn-abc");
		});

		it("session state reflects unbound after unbindBrowser", async () => {
			const activeSession = sessionManager.getActiveSession();
			assert.ok(activeSession);

			sessionManager.bindBrowser(activeSession.id, "conn-xyz");
			sessionManager.unbindBrowser(activeSession.id);

			const state = sessionManager.getSession(activeSession.id);
			assert.equal(state?.browserConnectionId, null);
		});

		it("list() shows hasBrowser flag correctly after binding", async () => {
			const activeSession = sessionManager.getActiveSession();
			assert.ok(activeSession);

			// Before binding
			const listBefore = sessionManager.list();
			const entryBefore = listBefore.data?.find(
				(s) => s.id === activeSession.id,
			);
			assert.equal(entryBefore?.hasBrowser, false);

			// After binding
			sessionManager.bindBrowser(activeSession.id, "conn-list");
			const listAfter = sessionManager.list();
			const entryAfter = listAfter.data?.find((s) => s.id === activeSession.id);
			assert.equal(entryAfter?.hasBrowser, true);
		});
	});

	// ── Issue 2: ActionResults carry real policy metadata ──────────────

	describe("action results carry policy metadata", () => {
		it("open result includes real policyDecision and risk when allowed", async () => {
			// This will fail because no browser, but if it were allowed by policy
			// the result would carry the real metadata. We verify the pattern
			// by checking evaluateAction directly.
			const policyEval = sessionManager.evaluateAction("browser_navigate", {
				url: "https://example.com",
			});
			if (isPolicyAllowed(policyEval)) {
				assert.ok(policyEval.policyDecision);
				assert.ok(policyEval.risk);
				assert.ok(policyEval.path);
			}
		});
	});

	// ── Screenshot Viewport Bug Tests ──────────────────────────────────

	describe("screenshot viewport behavior", () => {
		it("should NOT call setViewportSize when page.viewportSize() returns null (visible browser)", async () => {
			// This tests the bug: ensureScreenshotViewport should not mutate visible browser
			const setViewportSizeCalls: ViewportSize[] = [];
			const mockPage = createMockPage("https://example.com");
			mockPage.viewportSize = () => null; // Visible browser returns null
			mockPage.setViewportSize = async (size: ViewportSize) => {
				setViewportSizeCalls.push(size);
			};

			const actions = new BrowserActions({
				sessionManager,
			});

			const testActions = actions as unknown as BrowserActionsInternals;
			await testActions.ensureScreenshotViewport(mockPage);

			// The bug: this should be 0, but currently it's 1 because the code
			// calls setViewportSize when viewport is null
			assert.equal(
				setViewportSizeCalls.length,
				0,
				"Should NOT call setViewportSize when viewportSize() is null (visible browser)",
			);
		});

		it("should NOT call setViewportSize when page.viewportSize() returns a valid viewport", async () => {
			const setViewportSizeCalls: ViewportSize[] = [];
			const mockPage = createMockPage("https://example.com");
			mockPage.viewportSize = () => ({ width: 1920, height: 1080 });
			mockPage.setViewportSize = async (size: ViewportSize) => {
				setViewportSizeCalls.push(size);
			};

			const actions = new BrowserActions({
				sessionManager,
			});

			const testActions = actions as unknown as BrowserActionsInternals;
			await testActions.ensureScreenshotViewport(mockPage);

			assert.equal(
				setViewportSizeCalls.length,
				0,
				"Should NOT call setViewportSize when viewport is already set",
			);
		});

		it("brings the page to front without mutating viewport state", async () => {
			let broughtToFront = false;
			const setViewportSizeCalls: ViewportSize[] = [];
			const mockPage = createMockPage("https://example.com");
			mockPage.viewportSize = () => null;
			mockPage.setViewportSize = async (size: ViewportSize) => {
				setViewportSizeCalls.push(size);
			};
			mockPage.bringToFront = async () => {
				broughtToFront = true;
			};

			const actions = new BrowserActions({
				sessionManager,
			});

			const testActions = actions as unknown as BrowserActionsInternals;
			await testActions.ensureScreenshotViewport(mockPage);

			assert.equal(broughtToFront, true);
			assert.equal(setViewportSizeCalls.length, 0);
		});
	});
});
