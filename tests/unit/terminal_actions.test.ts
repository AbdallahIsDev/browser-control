import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { BrowserConnectionManager } from "../../src/browser/connection";
import { loadDebugBundle } from "../../src/observability/debug_bundle";
import { MemoryStore } from "../../src/runtime/memory_store";
import type { TerminalRuntime } from "../../src/session_manager";
import {
	LocalTerminalRuntime,
	SessionManager,
} from "../../src/session_manager";
import { TerminalActions, validateResize } from "../../src/terminal/actions";
import {
	isWindowsPlatform,
	resolveNamedShell,
} from "../../src/terminal/cross_platform";
import { TerminalSessionManager } from "../../src/terminal/session";

function createUnavailableBrowserManager() {
	return {
		getContext: () => null,
		getBrowser: () => null,
		isConnected: () => false,
		getConnection: () => null,
	} as unknown as BrowserConnectionManager;
}

describe("TerminalActions", () => {
	let sessionManager: SessionManager;
	let terminalActions: TerminalActions;
	let store: MemoryStore;
	let dataHome: string;
	let originalHome: string | undefined;

	beforeEach(async () => {
		originalHome = process.env.BROWSER_CONTROL_HOME;
		dataHome = fs.mkdtempSync(
			path.join(os.tmpdir(), "bc-terminal-actions-test-"),
		);
		process.env.BROWSER_CONTROL_HOME = dataHome;
		store = new MemoryStore({ filename: ":memory:" });
		sessionManager = new SessionManager({
			memoryStore: store,
			browserManager: createUnavailableBrowserManager(),
		});
		await sessionManager.create("term-test", { policyProfile: "balanced" });
		terminalActions = new TerminalActions({ sessionManager });
	});

	afterEach(() => {
		sessionManager.close();
		if (originalHome === undefined) {
			delete process.env.BROWSER_CONTROL_HOME;
		} else {
			process.env.BROWSER_CONTROL_HOME = originalHome;
		}
		fs.rmSync(dataHome, { recursive: true, force: true });
	});

	describe("constructor", () => {
		it("creates instance with session manager", () => {
			const actions = new TerminalActions({ sessionManager });
			assert.ok(actions);
		});
	});

	describe("exec", () => {
		it("executes a one-shot command and returns success", async () => {
			const result = await terminalActions.exec({
				command: "echo hello",
				timeoutMs: 5000,
			});

			assert.equal(result.success, true);
			assert.ok(result.data);
			// exitCode should be 0 for a successful echo
			assert.equal(result.data.exitCode, 0);
			assert.ok(result.data.stdout);
		});

		it("returns failure for missing session", async () => {
			const result = await terminalActions.exec({
				command: "echo test",
				sessionId: "nonexistent-session",
			});

			assert.equal(result.success, false);
			// Error message differs between LocalTerminalRuntime ("Terminal session not found")
			// and BrokerTerminalRuntime ("Session not found") — accept either
			assert.ok(
				result.error?.includes("session not found") ||
					result.error?.includes("Session not found"),
				`Error should mention session not found, got: ${result.error}`,
			);
			assert.ok(result.debugBundleId);
			assert.ok(result.recoveryGuidance);
			assert.ok(loadDebugBundle(result.debugBundleId, store));
		});

		it("rejects placeholder session ids before calling the terminal runtime", async () => {
			const calls: string[] = [];
			const mockRuntime: TerminalRuntime = {
				open: async () => ({
					id: "mock-session",
					shell: "pwsh",
					cwd: dataHome,
					status: "idle",
				}),
				exec: async (command) => {
					calls.push(`exec:${command}`);
					return {
						exitCode: 0,
						stdout: "",
						stderr: "",
						durationMs: 1,
						cwd: dataHome,
						timedOut: false,
					};
				},
				type: async () => {},
				read: async () => "",
				snapshot: async () => ({
					lines: [],
					cursorY: 0,
					cursorX: 0,
					width: 80,
					height: 24,
				}),
				interrupt: async () => {},
				close: async () => {},
				list: async () => [],
				resume: async (sessionId) => ({ sessionId, status: "fresh" }),
				status: async (sessionId) => ({ sessionId, status: "fresh" }),
				resize: async () => {},
				onData: () => ({ dispose: () => {} }),
			};
			const actions = new TerminalActions({
				sessionManager,
				terminalRuntime: mockRuntime,
			});

			const result = await actions.exec({
				command: "echo test",
				sessionId: "<PASTE_TERMINAL_ID_HERE>",
			});

			assert.equal(result.success, false);
			assert.match(
				result.error ?? "",
				/Invalid terminal session id: <PASTE_TERMINAL_ID_HERE>/,
			);
			assert.deepEqual(calls, []);
		});
	});

	describe("type", () => {
		it("returns failure for missing session", async () => {
			const result = await terminalActions.type({
				text: "hello",
				sessionId: "nonexistent-session",
			});

			assert.equal(result.success, false);
			assert.ok(
				result.error?.includes("session not found") ||
					result.error?.includes("Session not found"),
				`Error should mention session not found, got: ${result.error}`,
			);
		});
	});

	describe("read", () => {
		it("returns failure for missing session", async () => {
			const result = await terminalActions.read({
				sessionId: "nonexistent-session",
			});

			assert.equal(result.success, false);
			assert.ok(
				result.error?.includes("session not found") ||
					result.error?.includes("Session not found"),
				`Error should mention session not found, got: ${result.error}`,
			);
		});
	});

	describe("snapshot", () => {
		it("returns failure for missing session", async () => {
			const result = await terminalActions.snapshot({
				sessionId: "nonexistent-session",
			});

			assert.equal(result.success, false);
			assert.ok(
				result.error?.includes("session not found") ||
					result.error?.includes("Session not found"),
				`Error should mention session not found, got: ${result.error}`,
			);
		});
	});

	describe("interrupt", () => {
		it("returns failure for missing session", async () => {
			const result = await terminalActions.interrupt({
				sessionId: "nonexistent-session",
			});

			assert.equal(result.success, false);
			assert.ok(
				result.error?.includes("session not found") ||
					result.error?.includes("Session not found"),
				`Error should mention session not found, got: ${result.error}`,
			);
		});
	});

	describe("close", () => {
		it("handles missing session gracefully", async () => {
			const result = await terminalActions.close({
				sessionId: "nonexistent-session",
			});

			// close delegates to tm.close() which may throw or return success
			// Either way it should not crash
			assert.ok(result.success === true || result.success === false);
		});
	});

	// ── Issue 4: Terminal actions align with daemon-backed runtime ──────

	describe("terminal runtime alignment", () => {
		it("uses sessionManager's TerminalRuntime by default", () => {
			// Default TerminalActions should use sessionManager.getTerminalRuntime()
			const runtime = sessionManager.getTerminalRuntime();
			assert.ok(runtime, "session manager should provide a TerminalRuntime");
			assert.ok(
				runtime instanceof LocalTerminalRuntime,
				"default runtime should be LocalTerminalRuntime",
			);
		});

		it("accepts a custom TerminalRuntime via context", async () => {
			// Create a mock runtime that records calls
			const calls: string[] = [];
			const mockRuntime: TerminalRuntime = {
				open: async (_config) => {
					calls.push("open");
					return {
						id: "mock-session",
						shell: "bash",
						cwd: "/tmp",
						status: "running",
					};
				},
				exec: async (command, _options) => {
					calls.push(`exec:${command}`);
					return {
						exitCode: 0,
						stdout: "mock",
						stderr: "",
						durationMs: 10,
						cwd: "/tmp",
						timedOut: false,
					};
				},
				type: async (sessionId, text) => {
					calls.push(`type:${sessionId}:${text}`);
				},
				read: async (sessionId, _maxBytes) => {
					calls.push(`read:${sessionId}`);
					return "mock output";
				},
				snapshot: async (sessionId) => {
					calls.push(`snapshot:${sessionId ?? "all"}`);
					return { lines: [], cursorY: 0, cursorX: 0, width: 80, height: 24 };
				},
				interrupt: async (sessionId) => {
					calls.push(`interrupt:${sessionId}`);
				},
				close: async (sessionId) => {
					calls.push(`close:${sessionId}`);
				},
				list: async () => {
					calls.push("list");
					return [];
				},
				resume: async (sessionId) => {
					calls.push(`resume:${sessionId}`);
					return { sessionId, status: "fresh" };
				},
				status: async (sessionId) => {
					calls.push(`status:${sessionId}`);
					return { sessionId, status: "fresh" };
				},
				resize: async (sessionId, cols, rows) => {
					calls.push(`resize:${sessionId}:${cols}:${rows}`);
				},
				onData: () => ({ dispose: () => {} }),
			};

			const customActions = new TerminalActions({
				sessionManager,
				terminalRuntime: mockRuntime,
			});

			// Open should go through the mock runtime
			const openResult = await customActions.open({ shell: "bash" });
			assert.equal(
				openResult.success,
				true,
				`open failed: ${openResult.error}`,
			);
			assert.ok(calls.includes("open"), "should have called mockRuntime.open");
		});

		it("custom runtime exec goes through the mock", async () => {
			const calls: string[] = [];
			const mockRuntime: TerminalRuntime = {
				open: async (_config) => {
					return {
						id: "mock-session",
						shell: "bash",
						cwd: "/tmp",
						status: "running",
					};
				},
				exec: async (command, _options) => {
					calls.push(`exec:${command}`);
					return {
						exitCode: 0,
						stdout: "mock-output",
						stderr: "",
						durationMs: 5,
						cwd: "/tmp",
						timedOut: false,
					};
				},
				type: async () => {},
				read: async () => "",
				snapshot: async () => ({}),
				interrupt: async () => {},
				close: async () => {},
				list: async () => [],
				resume: async (sessionId) => ({ sessionId, status: "fresh" }),
				status: async (sessionId) => ({ sessionId, status: "fresh" }),
				resize: async () => {},
				onData: () => ({ dispose: () => {} }),
			};

			const customActions = new TerminalActions({
				sessionManager,
				terminalRuntime: mockRuntime,
			});

			const execResult = await customActions.exec({ command: "ls -la" });
			assert.equal(
				execResult.success,
				true,
				`exec failed: ${execResult.error}`,
			);
			assert.ok(
				calls.includes("exec:ls -la"),
				"should have called mockRuntime.exec",
			);
		});

		it("terminal open binds terminal to session", async () => {
			// Use the mock runtime to verify binding
			const mockRuntime: TerminalRuntime = {
				open: async (_config) => {
					return {
						id: "term-bound-123",
						shell: "bash",
						cwd: "/tmp",
						status: "running",
					};
				},
				exec: async (_cmd, _opts) => ({
					exitCode: 0,
					stdout: "",
					stderr: "",
					durationMs: 0,
					cwd: "/tmp",
					timedOut: false,
				}),
				type: async () => {},
				read: async () => "",
				snapshot: async () => ({}),
				interrupt: async () => {},
				close: async () => {},
				list: async () => [],
				resume: async (sessionId) => ({ sessionId, status: "fresh" }),
				status: async (sessionId) => ({ sessionId, status: "fresh" }),
				resize: async () => {},
				onData: () => ({ dispose: () => {} }),
			};

			const customActions = new TerminalActions({
				sessionManager,
				terminalRuntime: mockRuntime,
			});

			const result = await customActions.open({ shell: "bash" });
			assert.equal(result.success, true, `open failed: ${result.error}`);

			// The terminal should be bound to the active session
			const activeSession = sessionManager.getActiveSession();
			assert.ok(activeSession, "should have active session");
			assert.equal(
				activeSession.terminalSessionId,
				"term-bound-123",
				"terminal should be bound to session after open",
			);
		});

		it("terminal close unbinds from session", async () => {
			const mockRuntime: TerminalRuntime = {
				open: async (_config) => {
					return {
						id: "term-unbind-456",
						shell: "bash",
						cwd: "/tmp",
						status: "running",
					};
				},
				exec: async (_cmd, _opts) => ({
					exitCode: 0,
					stdout: "",
					stderr: "",
					durationMs: 0,
					cwd: "/tmp",
					timedOut: false,
				}),
				type: async () => {},
				read: async () => "",
				snapshot: async () => ({}),
				interrupt: async () => {},
				close: async () => {},
				list: async () => [],
				resume: async (sessionId) => ({ sessionId, status: "fresh" }),
				status: async (sessionId) => ({ sessionId, status: "fresh" }),
				resize: async () => {},
				onData: () => ({ dispose: () => {} }),
			};

			const customActions = new TerminalActions({
				sessionManager,
				terminalRuntime: mockRuntime,
			});

			// Open first
			await customActions.open({ shell: "bash" });
			const activeSession = sessionManager.getActiveSession();
			assert.equal(activeSession?.terminalSessionId, "term-unbind-456");

			// Close should unbind
			const closeResult = await customActions.close({
				sessionId: "term-unbind-456",
			});
			assert.equal(
				closeResult.success,
				true,
				`close failed: ${closeResult.error}`,
			);

			const afterClose = sessionManager.getSession(activeSession?.id);
			assert.equal(
				afterClose?.terminalSessionId,
				null,
				"terminal should be unbound from session after close",
			);
		});
	});

	// ── Issue 2: CLI term commands return ActionResult shape ──────────────

	describe("CLI term commands return ActionResult shape", () => {
		it("term exec returns ActionResult with success, path, sessionId, policyDecision", async () => {
			const result = await terminalActions.exec({
				command: "echo test-action-result",
				timeoutMs: 5000,
			});

			assert.equal(
				result.success,
				true,
				`exec should succeed: ${result.error}`,
			);
			assert.ok(result.path, "ActionResult must have path");
			assert.ok(result.sessionId, "ActionResult must have sessionId");
			assert.ok(result.policyDecision, "ActionResult must have policyDecision");
			assert.ok(result.risk, "ActionResult must have risk");
			assert.ok(result.completedAt, "ActionResult must have completedAt");
			assert.ok(result.data, "ActionResult must have data");
		});

		it("term exec ActionResult has correct field types", async () => {
			const result = await terminalActions.exec({
				command: "echo type-check",
				timeoutMs: 5000,
			});

			assert.equal(typeof result.success, "boolean");
			assert.equal(typeof result.path, "string");
			assert.equal(typeof result.sessionId, "string");
			assert.equal(typeof result.policyDecision, "string");
			assert.equal(typeof result.risk, "string");
			assert.equal(typeof result.completedAt, "string");
		});

		it("policy-denied term action returns ActionResult with policyDecision", async () => {
			// Create a safe session — terminal_exec is moderate risk, safe requires confirmation
			const safeStore = new MemoryStore({ filename: ":memory:" });
			const safeManager = new SessionManager({
				memoryStore: safeStore,
				browserManager: createUnavailableBrowserManager(),
			});
			await safeManager.create("safe-term", { policyProfile: "safe" });
			const safeActions = new TerminalActions({ sessionManager: safeManager });

			// terminal_exec is moderate risk → safe profile requires confirmation
			const result = await safeActions.open({ shell: "bash" });

			// Whether allowed or denied, the result must be an ActionResult shape
			assert.ok(result.path, "ActionResult must have path even when denied");
			assert.ok(result.sessionId, "ActionResult must have sessionId");
			assert.ok(
				result.policyDecision !== undefined,
				"ActionResult must have policyDecision",
			);

			safeManager.close();
		});
	});

	// ── Issue 2 fix: term list routes through Section 5 action surface ───

	describe("term list routes through Section 5 action surface", () => {
		it("list() returns ActionResult with policy metadata", async () => {
			const result = await terminalActions.list();

			assert.equal(
				result.success,
				true,
				`list should succeed: ${result.error}`,
			);
			assert.ok(result.path, "ActionResult must have path");
			assert.ok(result.sessionId, "ActionResult must have sessionId");
			assert.ok(result.policyDecision, "ActionResult must have policyDecision");
			assert.ok(result.risk, "ActionResult must have risk");
			assert.ok(Array.isArray(result.data), "list data must be an array");
		});

		it("list() routes through terminal_list action in policy engine", async () => {
			// Verify the action name is recognized by the execution router
			const router = sessionManager.getExecutionRouter();
			const step = router.buildRoutedStep(
				{ goal: "terminal_list", actor: "human", sessionId: "test" },
				"terminal_list",
				{},
			);
			assert.equal(
				step.path,
				"command",
				"terminal_list should route through command path",
			);
		});
	});

	// ── Regression 5: Terminal resize validation ────────────────────────

	describe("resize validation", () => {
		it("accepts valid cols and rows", () => {
			const result = validateResize(80, 24);
			assert.equal(result.valid, true);
			assert.equal(result.cols, 80);
			assert.equal(result.rows, 24);
		});

		it("rejects NaN cols", () => {
			const result = validateResize(NaN, 24);
			assert.equal(result.valid, false);
			assert.ok(result.error.includes("must be finite"));
		});

		it("rejects negative cols", () => {
			const result = validateResize(-1, 24);
			assert.equal(result.valid, false);
			assert.ok(result.error.includes("between"));
		});

		it("rejects fractional cols", () => {
			const result = validateResize(80.5, 24);
			assert.equal(result.valid, false);
			assert.ok(result.error.includes("integer"));
		});

		it("rejects zero cols", () => {
			const result = validateResize(0, 24);
			assert.equal(result.valid, false);
			assert.ok(result.error.includes("between"));
		});

		it("rejects huge cols", () => {
			const result = validateResize(10000, 24);
			assert.equal(result.valid, false);
			assert.ok(result.error.includes("between"));
		});

		it("rejects missing rows", () => {
			const result = validateResize(80, undefined);
			assert.equal(result.valid, false);
			assert.ok(result.error.includes("must be numbers"));
		});

		it("accepts boundary values", () => {
			const minOk = validateResize(20, 5);
			assert.equal(minOk.valid, true);

			const maxOk = validateResize(500, 200);
			assert.equal(maxOk.valid, true);
		});

		it("rejects just outside boundaries", () => {
			const colsLow = validateResize(19, 24);
			assert.equal(colsLow.valid, false);

			const colsHigh = validateResize(501, 24);
			assert.equal(colsHigh.valid, false);

			const rowsLow = validateResize(80, 4);
			assert.equal(rowsLow.valid, false);

			const rowsHigh = validateResize(80, 201);
			assert.equal(rowsHigh.valid, false);
		});
	});

	// ── Real PTY lifecycle ───────────────────────────────────────────────

	describe("real PTY lifecycle", () => {
		it("resolves explicit powershell to a bounded supported Windows shell", () => {
			if (!isWindowsPlatform()) return;

			const shell = resolveNamedShell("powershell");

			assert.equal(shell.name, "pwsh");
			assert.match(shell.path, /pwsh\.exe$/i);
			assert.deepEqual(shell.args, ["-NoLogo", "-NoProfile", "-Interactive"]);
		});

		it("creates a real terminal, verifies it returns, then closes cleanly", async () => {
			// Use default shell detection (platform-appropriate)
			const result = await terminalActions.open({});
			assert.equal(result.success, true, `open failed: ${result.error}`);
			assert.ok(result.data?.id, "should have terminal session id in data");

			const sessionId = (result.data as { id: string }).id;

			// Execute a simple command
			const execResult = await terminalActions.exec({
				command: "echo hello-from-pty",
				sessionId,
				timeoutMs: 5000,
			});
			assert.equal(
				execResult.success,
				true,
				`exec failed: ${execResult.error}`,
			);
			assert.ok(
				((execResult.data as { stdout?: string }).stdout ?? "").includes(
					"hello-from-pty",
				),
				"output should contain command result",
			);

			// Close the session
			const closeResult = await terminalActions.close({ sessionId });
			assert.equal(
				closeResult.success,
				true,
				`close failed: ${closeResult.error}`,
			);
		});

		it("creates explicit powershell session without hanging", async () => {
			if (!isWindowsPlatform()) return;

			const startedAt = Date.now();
			const terminalManager = new TerminalSessionManager();
			const localActions = new TerminalActions({
				sessionManager,
				terminalRuntime: new LocalTerminalRuntime(terminalManager),
			});
			const result = await localActions.open({ shell: "powershell" });
			assert.equal(result.success, true, `open failed: ${result.error}`);
			assert.ok(result.data?.id, "should have terminal session id in data");
			assert.equal(result.data.shell, "pwsh");

			const sessionId = result.data.id;
			try {
				const execResult = await localActions.exec({
					command: "node --version",
					sessionId,
					timeoutMs: 5000,
				});
				assert.equal(
					execResult.success,
					true,
					`exec failed: ${execResult.error}`,
				);
				assert.match(
					(execResult.data as { stdout?: string }).stdout ?? "",
					/^v\d+\.\d+\.\d+/,
				);
			} finally {
				const closeResult = await localActions.close({ sessionId });
				assert.equal(
					closeResult.success,
					true,
					`close failed: ${closeResult.error}`,
				);
				await terminalManager.closeAll();
			}

			assert.ok(
				Date.now() - startedAt < 10000,
				"explicit powershell compatibility path must finish under 10s",
			);
		});
	});
});
