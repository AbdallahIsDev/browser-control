/**
 * Stdio MCP runtime regression test.
 *
 * Spawns `node cli.js mcp serve`, sends JSON-RPC initialize + tools/list,
 * asserts bc_launch exists with provider, calls bc_status,
 * and asserts the process stays alive.
 */

import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
const CLI_PATH = path.resolve(__dirname, "..", "..", "cli.js");
const PACKAGE_VERSION = JSON.parse(
	fs.readFileSync(path.resolve(__dirname, "..", "..", "package.json"), "utf8"),
) as { version: string };

let child: ChildProcess | null = null;
let buffer = "";
let messageId = 0;
let stdoutHandler: ((data: Buffer) => void) | null = null;
let errorListener: ((err: Error) => void) | null = null;
let testHome: string | null = null;

function nextId(): number {
	return ++messageId;
}

function sendRequest(
	method: string,
	params: Record<string, unknown> = {},
): number {
	const id = nextId();
	const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
	child?.stdin?.write(`${msg}\n`);
	return id;
}

function sendNotification(
	method: string,
	params: Record<string, unknown> = {},
): void {
	const msg = JSON.stringify({ jsonrpc: "2.0", method, params });
	child?.stdin?.write(`${msg}\n`);
}

function waitForResponse(
	requestId: number,
	timeoutMs = 15000,
): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		let settled = false;

		const settle = (fn: () => void) => {
			if (settled) return;
			settled = true;
			fn();
		};

		const timer = setTimeout(() => {
			settle(() => {
				if (stdoutHandler && child) {
					child.stdout?.off("data", stdoutHandler);
					stdoutHandler = null;
				}
				reject(new Error(`Timeout waiting for response id=${requestId}`));
			});
		}, timeoutMs);

		const onStdout = (data: Buffer) => {
			buffer += data.toString();
			const lines = buffer.split("\n").filter((l) => l.trim());
			for (const line of lines) {
				try {
					const parsed = JSON.parse(line);
					if (parsed.id === requestId) {
						settle(() => {
							clearTimeout(timer);
							if (stdoutHandler && child) {
								child.stdout?.off("data", stdoutHandler);
								stdoutHandler = null;
							}
							resolve(parsed);
						});
						return;
					}
				} catch {
					// not JSON yet, keep accumulating
				}
			}
		};

		stdoutHandler = onStdout;
		child?.stdout?.on("data", onStdout);

		// Check buffer in case response already arrived
		const lines = buffer.split("\n").filter((l) => l.trim());
		for (const line of lines) {
			try {
				const parsed = JSON.parse(line);
				if (parsed.id === requestId) {
					settle(() => {
						clearTimeout(timer);
						if (stdoutHandler && child) {
							child.stdout?.off("data", stdoutHandler);
							stdoutHandler = null;
						}
						resolve(parsed);
					});
					return;
				}
			} catch {
				// skip
			}
		}
	});
}

function initializeAndWait(
	timeoutMs = 10000,
): Promise<Record<string, unknown>> {
	const initId = sendRequest("initialize", {
		protocolVersion: "2024-11-05",
		capabilities: {},
		clientInfo: { name: "test", version: "1.0.0" },
	});
	return waitForResponse(initId, timeoutMs).then((response) => {
		sendNotification("notifications/initialized", {});
		return response;
	});
}

async function killChildAndWait(
	proc: ChildProcess,
	timeoutMs = 5000,
): Promise<void> {
	if (!proc || proc.killed) return;

	// Close stdin to signal EOF
	proc.stdin?.end();

	// Remove all listeners to prevent re-entry
	proc.removeAllListeners();

	// Kill the process
	proc.kill("SIGTERM");

	// Wait for exit with timeout, then force kill
	try {
		await Promise.race([
			new Promise<void>((resolve) => {
				proc.on("exit", () => resolve());
				proc.on("error", () => resolve());
			}),
			new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
		]);
	} catch {
		// ignore
	}

	// Force kill if still alive
	if (!proc.killed) {
		try {
			proc.kill("SIGKILL");
		} catch {
			// already dead
		}
	}

	// Close stdio pipes to release event loop handles
	proc.stdout?.destroy();
	proc.stderr?.destroy();
}

function getFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				server.close(() => reject(new Error("Could not allocate test port")));
				return;
			}
			const port = address.port;
			server.close(() => resolve(port));
		});
	});
}

beforeEach(async () => {
	buffer = "";
	messageId = 0;
	stdoutHandler = null;
	errorListener = null;
	testHome = fs.mkdtempSync(path.join(os.tmpdir(), "bc-mcp-stdio-"));
	const brokerPort = await getFreePort();

	child = spawn("node", [CLI_PATH, "mcp", "serve"], {
		env: {
			...process.env,
			BROWSER_CONTROL_HOME: testHome,
			BROWSER_CONTROL_STDIO_MODE: "mcp",
			BROKER_PORT: String(brokerPort),
		},
		stdio: ["pipe", "pipe", "pipe"],
	});

	// Store error listener reference for cleanup
	errorListener = () => {
		// error handled by promise rejection in waitForServerReady
	};
	child.on("error", errorListener);

	// Wait for process to be ready (logs to stderr)
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error("MCP server did not start")),
			10000,
		);
		const onStderr = () => {
			clearTimeout(timer);
			resolve();
		};
		child?.stderr?.once("data", onStderr);
		child?.on("error", (err) => {
			clearTimeout(timer);
			reject(err);
		});
		// Fallback: give it a moment to initialize even without stderr
		setTimeout(() => {
			clearTimeout(timer);
			resolve();
		}, 2000);
	});
});

afterEach(async () => {
	// Clean up stdout listener
	if (stdoutHandler && child) {
		child.stdout?.off("data", stdoutHandler);
		stdoutHandler = null;
	}

	// Kill child and wait for it to fully exit
	if (child) {
		await killChildAndWait(child);
		child = null;
	}

	if (testHome) {
		try {
			fs.rmSync(testHome, { recursive: true, force: true });
		} catch {
			// best effort
		}
		testHome = null;
	}
});

test("stdio MCP: initialize + tools/list includes bc_launch with provider", async () => {
	const initResp = await initializeAndWait();
	const initResult = initResp.result as
		| { serverInfo?: { version?: string } }
		| undefined;
	assert.equal(initResult?.serverInfo?.version, PACKAGE_VERSION.version);

	const listId = sendRequest("tools/list", {});
	const listResp = await waitForResponse(listId);
	assert.equal(listResp.error, undefined, "tools/list should not error");
	const listResult = listResp.result as {
		tools: Array<{ name: string; inputSchema?: Record<string, unknown> }>;
	};
	assert.ok(
		Array.isArray(listResult.tools),
		"tools/list should return tools array",
	);

	const tools = listResult.tools;
	const toolNames = tools.map((t) => t.name);
	assert.ok(toolNames.includes("bc_status"), "should include bc_status");
	assert.ok(toolNames.includes("bc_launch"), "should include bc_launch");
	assert.ok(toolNames.includes("bc_open"), "should include bc_open");

	const launchTool = tools.find((t) => t.name === "bc_launch");
	assert.ok(launchTool, "bc_launch tool should exist");
	const props = launchTool.inputSchema?.properties as
		| Record<string, unknown>
		| undefined;
	assert.ok(
		props && "provider" in props,
		"bc_launch should have provider parameter",
	);
});

test("stdio MCP: bc_status returns valid result without crashing transport", async () => {
	await initializeAndWait();

	const statusId = sendRequest("tools/call", {
		name: "bc_status",
		arguments: {},
	});
	const statusResp = await waitForResponse(statusId);

	assert.equal(statusResp.error, undefined, "bc_status should not error");
	assert.ok(statusResp.result, "bc_status should return result");

	const result = statusResp.result as Record<string, unknown>;
	assert.ok(Array.isArray(result.content), "result should have content array");
	assert.equal(result.isError, false, "result should not be error");

	const content = result.content as Array<{ type: string; text: string }>;
	const textContent = content.find((c) => c.type === "text");
	assert.ok(textContent, "should have text content");
	const parsed = JSON.parse(textContent.text);
	assert.ok(parsed.success, "ActionResult should be successful");
	assert.ok(parsed.data, "should have data");
	assert.ok(parsed.data.daemon, "should have daemon info");
	assert.ok(parsed.data.broker, "should have broker info");

	assert.equal(
		child?.killed,
		false,
		"process should still be alive after bc_status",
	);
	assert.ok(child?.pid, "process should have a PID");
});

test("stdio MCP: process stays alive after multiple tool calls", async () => {
	await initializeAndWait();

	for (const toolName of ["bc_status", "bc_status", "bc_status"]) {
		const callId = sendRequest("tools/call", { name: toolName, arguments: {} });
		const resp = await waitForResponse(callId);
		assert.equal(resp.error, undefined, `${toolName} should not error`);
	}

	assert.equal(
		child?.killed,
		false,
		"process should still be alive after multiple calls",
	);
});

test("stdio MCP: bc_session_create works", async () => {
	await initializeAndWait();

	const createId = sendRequest("tools/call", {
		name: "bc_session_create",
		arguments: { name: "stdio-session-test" },
	});
	const createResp = await waitForResponse(createId);
	assert.equal(
		createResp.error,
		undefined,
		"bc_session_create should not error",
	);

	const result = createResp.result as Record<string, unknown>;
	assert.equal(result.isError, false, "should not be error");
	const content = result.content as Array<{ type: string; text: string }>;
	const textContent = content.find((c) => c.type === "text");
	assert.ok(textContent, "should have text content");
	const parsed = JSON.parse(textContent.text);
	assert.ok(parsed.success, "session creation should succeed");
	assert.ok(parsed.data?.id, "should return session id");
	assert.equal(
		parsed.data?.name,
		"stdio-session-test",
		"should return correct session name",
	);
});

/**
 * Full MCP product flow: open URL from cold state, snapshot, close.
 * Uses isolated BROWSER_CONTROL_HOME under temp to avoid polluting real state.
 * Requires Chrome to be installable; skips gracefully if launch fails.
 */
test("stdio MCP: full browser flow (open -> snapshot -> close) from cold state", async () => {
	const os = await import("node:os");
	const fs = await import("node:fs");
	const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), "bc-mcp-flow-"));
	const brokerPort = await getFreePort();

	// Kill the beforeEach-spawned child before spawning our own
	if (child && !child.killed) {
		await killChildAndWait(child);
		child = null;
	}

	try {
		// Spawn MCP server with isolated home and auto-launch enabled
		buffer = "";
		messageId = 0;
		stdoutHandler = null;

		child = spawn("node", [CLI_PATH, "mcp", "serve"], {
			env: {
				...process.env,
				BROWSER_CONTROL_HOME: isolatedHome,
				BROWSER_CONTROL_STDIO_MODE: "mcp",
				BROWSER_AUTO_LAUNCH: "true",
				BROKER_PORT: String(brokerPort),
			},
			stdio: ["pipe", "pipe", "pipe"],
		});

		// Wait for server ready
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new Error("MCP server did not start")),
				10000,
			);
			child?.stderr?.once("data", () => {
				clearTimeout(timer);
				resolve();
			});
			child?.on("error", (err) => {
				clearTimeout(timer);
				reject(err);
			});
			setTimeout(() => {
				clearTimeout(timer);
				resolve();
			}, 2000);
		});

		// Initialize
		await initializeAndWait();

		// Step 1: Create session
		const sessionId = sendRequest("tools/call", {
			name: "bc_session_create",
			arguments: { name: "flow-test" },
		});
		const sessionResp = await waitForResponse(sessionId);
		assert.equal(
			sessionResp.error,
			undefined,
			"session create should not error",
		);

		// Step 2: Open URL (triggers auto-launch from cold state)
		const openId = sendRequest("tools/call", {
			name: "bc_open",
			arguments: { url: "https://example.com" },
		});
		const openResp = await waitForResponse(openId, 60000);
		assert.equal(openResp.error, undefined, "bc_open should not error");

		const openResult = openResp.result as Record<string, unknown>;
		assert.equal(openResult.isError, false, "open should not be error");
		const openContent = openResult.content as Array<{
			type: string;
			text: string;
		}>;
		const openText = openContent.find((c) => c.type === "text");
		assert.ok(openText, "open should have text content");
		const openParsed = JSON.parse(openText.text);
		assert.ok(openParsed.success, "open ActionResult should succeed");
		assert.ok(openParsed.data?.title, "open should return page title");
		assert.ok(openParsed.data?.tabId, "open should return tab id");

		// Step 3: Snapshot
		const snapId = sendRequest("tools/call", {
			name: "bc_snapshot",
			arguments: { tabId: openParsed.data.tabId },
		});
		const snapResp = await waitForResponse(snapId, 30000);
		assert.equal(snapResp.error, undefined, "snapshot should not error");

		const snapResult = snapResp.result as Record<string, unknown>;
		assert.equal(snapResult.isError, false, "snapshot should not be error");
		const snapContent = snapResult.content as Array<{
			type: string;
			text: string;
		}>;
		const snapText = snapContent.find((c) => c.type === "text");
		assert.ok(snapText, "snapshot should have text content");
		const snapParsed = JSON.parse(snapText.text);
		assert.ok(snapParsed.success, "snapshot ActionResult should succeed");
		assert.ok(snapParsed.data?.elements, "snapshot should have elements");

		// Verify Example Domain content
		const elements = snapParsed.data.elements as Array<{
			name?: string;
			role?: string;
		}>;
		const elementNames = elements.map((e) => e.name ?? "").join(" ");
		assert.ok(
			elementNames.includes("Example Domain") ||
				snapParsed.data.pageTitle?.includes("Example Domain"),
			"snapshot should show Example Domain",
		);
		assert.ok(
			elementNames.includes("Learn more"),
			"snapshot should show Learn more link",
		);

		// Step 4: Close browser
		const closeId = sendRequest("tools/call", {
			name: "bc_close",
			arguments: {},
		});
		const closeResp = await waitForResponse(closeId);
		assert.equal(closeResp.error, undefined, "close should not error");

		const closeResult = closeResp.result as Record<string, unknown>;
		assert.equal(closeResult.isError, false, "close should not be error");
		const closeContent = closeResult.content as Array<{
			type: string;
			text: string;
		}>;
		const closeText = closeContent.find((c) => c.type === "text");
		assert.ok(closeText, "close should have text content");
		const closeParsed = JSON.parse(closeText.text);
		assert.ok(closeParsed.success, "close ActionResult should succeed");
		assert.ok(closeParsed.data?.detached, "close should report detached");

		assert.equal(
			child?.killed,
			false,
			"MCP process should still be alive after full flow",
		);
	} finally {
		// Clean up isolated home
		try {
			fs.rmSync(isolatedHome, { recursive: true, force: true });
		} catch {
			// ignore cleanup errors
		}
		// Note: child cleanup is handled by afterEach
	}
});
