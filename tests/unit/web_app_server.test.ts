import assert from "node:assert/strict";
import crypto from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PNG } from "pngjs";
import { WebSocket } from "ws";
import type { BrowserControlAPI } from "../../src/browser_control";
import { resetRecorder } from "../../src/observability/recorder";
import { createBrokerServer } from "../../src/runtime/broker_server";
import { resetCredentialVault } from "../../src/security/credential_vault";
import type { ActionResult } from "../../src/shared/action_result";
import { constantTimeTokenEqual } from "../../src/shared/auth";
import { resetStateStorage } from "../../src/state/index";
import { createWebAppServer } from "../../src/web/server";

function writeTinyPng(
	filePath: string,
	rgba: [number, number, number, number],
): void {
	const png = new PNG({ width: 1, height: 1 });
	png.data[0] = rgba[0];
	png.data[1] = rgba[1];
	png.data[2] = rgba[2];
	png.data[3] = rgba[3];
	fs.writeFileSync(filePath, PNG.sync.write(png));
}

function actionResult<T>(data: T): ActionResult<T> {
	return {
		success: true,
		path: "command",
		sessionId: "system",
		data,
		completedAt: "2026-05-02T00:00:00.000Z",
	};
}

function rawHttpRequest(
	url: string,
	options: {
		method: string;
		headers?: Record<string, string>;
		body?: string;
	},
): Promise<{
	statusCode: number;
	headers: http.IncomingHttpHeaders;
	body: string;
}> {
	return new Promise((resolve, reject) => {
		const parsed = new URL(url);
		const request = http.request(
			{
				method: options.method,
				hostname: parsed.hostname,
				port: parsed.port,
				path: `${parsed.pathname}${parsed.search}`,
				headers: {
					...(options.body
						? {
								"content-length": Buffer.byteLength(options.body).toString(),
							}
						: {}),
					...options.headers,
				},
			},
			(response) => {
				const chunks: Buffer[] = [];
				response.on("data", (chunk) => {
					chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
				});
				response.on("end", () => {
					resolve({
						statusCode: response.statusCode ?? 0,
						headers: response.headers,
						body: Buffer.concat(chunks).toString("utf8"),
					});
				});
			},
		);
		request.on("error", reject);
		if (options.body) request.write(options.body);
		request.end();
	});
}

function mockApi(): BrowserControlAPI {
	return {
		status: async () => ({
			daemon: { state: "running" },
			broker: { reachable: true, url: "http://127.0.0.1:7788" },
			browser: { provider: "local", activeSessions: 0 },
			terminal: { activeSessions: 0, sessions: [] },
			tasks: { queued: 0, running: 0 },
			services: { count: 0 },
			provider: { active: "local" },
			policyProfile: "balanced",
			dataHome: "C:\\Users\\11\\.browser-control",
			health: { overall: "healthy", pass: 1, warn: 0, fail: 0 },
			timestamp: "2026-05-02T00:00:00.000Z",
		}),
		config: {
			list: () => [],
			get: (key: string) =>
				({
					key,
					category: "policy",
					value: "balanced",
					defaultValue: "balanced",
					source: "default",
					sensitive: false,
					envVars: [],
					description: "Policy profile.",
				}) as never,
			set: () => actionResult({ key: "x", value: "y", source: "user" }),
		},
		terminal: {
			open: async () =>
				actionResult({
					id: "term-1",
					shell: "powershell",
					cwd: ".",
					status: "idle",
				}),
			exec: async (options: { command: string }) =>
				actionResult({
					command: options.command,
					exitCode: 0,
					stdout: "ok\n",
					stderr: "",
					durationMs: 1,
					cwd: ".",
					timedOut: false,
				} as never),
			type: async () => actionResult({ typed: "x" }),
			read: async () => actionResult({ output: "ok\n" }),
			snapshot: async () => actionResult([]),
			interrupt: async () => actionResult({ interrupted: true }),
			close: async () => actionResult({ closed: true }),
			resume: async () => actionResult({ resumed: true }),
			status: async () => actionResult({ status: "idle" }),
			resize: async () => actionResult({ resized: true }),
			onOutput: () => ({ dispose: () => {} }),
		},
		terminalActions: {
			list: async () => actionResult([]),
		},
		debug: {
			listBundles: () => [],
			health: async () => ({
				overall: "healthy",
				checks: [],
				timestamp: "2026-05-02T00:00:00.000Z",
			}),
			bundle: () => null,
			console: () => [],
			network: () => [],
			receipt: () => null,
		},
		fs: {
			read: async () =>
				actionResult({
					path: "x",
					content: "",
					sizeBytes: 0,
					truncated: false,
				} as never),
			write: async () =>
				actionResult({ path: "x", sizeBytes: 0, created: true } as never),
			ls: async () =>
				actionResult({ path: ".", entries: [], totalEntries: 0 } as never),
			move: async () => actionResult({ from: "a", to: "b" } as never),
			rm: async () =>
				actionResult({ path: "x", deleted: true, type: "file" } as never),
			stat: async () => actionResult({ path: "x", exists: true } as never),
		},
		browser: {
			open: async () =>
				actionResult({ url: "https://example.com", title: "Example" }),
			snapshot: async () =>
				actionResult({
					url: "https://example.com",
					title: "Example",
					elements: [],
				} as never),
			screenshot: async () => actionResult({ path: "shot.png", sizeBytes: 1 }),
			click: async () => actionResult({ clicked: true } as never),
			fill: async () => actionResult({ filled: true } as never),
			press: async () => actionResult({ pressed: true } as never),
			type: async () => actionResult({ typed: true } as never),
			scroll: async () => actionResult({ scrolled: true } as never),
			tabList: async () => actionResult([] as never),
			tabSwitch: async () => actionResult({ switched: true } as never),
			tabClose: async () => actionResult({ closed: true } as never),
			close: async () => actionResult({ closed: true } as never),
			dialog: async (opts: {
				action: string;
				dialog_id?: string;
				response?: string;
				text?: string;
			}) => {
				if (opts.action === "list") {
					return actionResult({ dialogs: [] });
				}
				if (opts.action === "respond" && opts.dialog_id) {
					return actionResult({
						handled: true,
						dialog: {
							id: opts.dialog_id,
							type: "alert",
							message: "Test dialog",
							createdAt: new Date("2026-05-02T00:00:00.000Z").toISOString(),
						},
					});
				}
				return actionResult({
					success: false,
					error: "Invalid dialog action",
				} as never);
			},
			cdp: async (opts: {
				method: string;
				params?: Record<string, unknown>;
				targetId?: string;
				frameId?: string;
				timeoutMs: number;
			}) => {
				if (opts.method === "Runtime.evaluate" && opts.params?.expression) {
					return actionResult({ result: { type: "string", value: "1+1" } });
				}
				if (opts.targetId) {
					return {
						success: false,
						error: "targetId not supported",
						path: "command",
						sessionId: "system",
						completedAt: "2026-05-02T00:00:00.000Z",
					};
				}
				if (opts.frameId) {
					return {
						success: false,
						error: "frameId not supported",
						path: "command",
						sessionId: "system",
						completedAt: "2026-05-02T00:00:00.000Z",
					};
				}
				return actionResult({ result: { targets: [{ id: "t1" }] } });
			},
		},
		package: {
			install: async () =>
				actionResult({
					name: "basic-test-package",
					version: "1.0.0",
					installedAt: "2026-05-08T00:00:00.000Z",
				} as never),
			list: () =>
				actionResult([
					{
						name: "basic-test-package",
						version: "1.0.0",
						installedAt: "2026-05-08T00:00:00.000Z",
					},
				] as never),
			info: () =>
				actionResult({
					name: "basic-test-package",
					version: "1.0.0",
				} as never),
			remove: () => actionResult({ removed: true }),
			update: async () =>
				actionResult({
					name: "basic-test-package",
					version: "1.0.0",
				} as never),
			grantPermission: () => actionResult({ granted: true }),
			run: async () => actionResult({ status: "completed" } as never),
			eval: async () => actionResult([]),
			review: () => actionResult({ success: true } as never),
			reviewHistory: () => actionResult([]),
			evalHistory: () => actionResult([]),
		},
		service: {
			register: async () => actionResult({ name: "app", port: 3000 }),
			list: () => actionResult([{ name: "app", port: 3000 }]),
			resolve: async () => actionResult({ url: "http://127.0.0.1:3000" }),
			remove: () => actionResult({ removed: true }),
			proxy: {
				start: async () =>
					actionResult({
						enabled: true,
						host: "127.0.0.1",
						port: 3210,
						url: "http://127.0.0.1:3210",
					}),
				stop: async () => actionResult({ stopped: true }),
				status: () =>
					actionResult({
						enabled: false,
						host: "127.0.0.1",
						httpsEnabled: false,
						allowRemote: false,
						activeConnections: 0,
					}),
			},
		},
		provider: {
			list: () => ({
				providers: [],
				activeProvider: "local",
				builtIn: ["local", "custom", "browserless", "browserbase"],
			}),
			catalog: () =>
				actionResult([
					{
						name: "browserbase",
						label: "Browserbase",
						description: "Remote hosted browser sessions.",
						remote: true,
						risk: "high",
						requiresEndpoint: false,
						requiresAuth: true,
						launchSupported: true,
						attachSupported: true,
						defaultConfigured: false,
						setupHint: "Configure API key and project id.",
					},
				]),
			use: () =>
				actionResult({
					success: true,
					provider: "local",
					previousProvider: "local",
					persisted: true,
				}),
			getActive: () => "local",
			health: async () =>
				actionResult([
					{
						name: "local",
						type: "local",
						ok: true,
						state: "healthy",
						score: 100,
						checkedAt: "2026-05-02T00:00:00.000Z",
						latencyMs: 1,
						authValid: null,
						endpointReachable: true,
						launchSupported: true,
						attachSupported: true,
						recentFailures: 0,
						summary: "Local browser provider is available.",
					},
				]),
		},
		workflow: {
			run: async (graphJson?: string) => {
				const graph =
					typeof graphJson === "string"
						? (JSON.parse(graphJson) as {
								id?: string;
								name?: string;
								nodes?: Array<{
									id: string;
									kind: string;
									input: Record<string, unknown>;
								}>;
							})
						: {};
				const startedAt = "2026-05-02T00:00:00.000Z";
				return actionResult({
					id: "run-1",
					graphId: graph.id ?? "graph-1",
					graphName: graph.name ?? "Graph",
					status: "completed",
					state: {},
					nodeResults: Object.fromEntries(
						(graph.nodes ?? []).map((node, index) => [
							node.id,
							{
								nodeId: node.id,
								status: "completed",
								output: { ok: true },
								retryCount: 0,
								startedAt,
								completedAt: `2026-05-02T00:00:0${index + 1}.000Z`,
							},
						]),
					),
					approvals: [],
					artifacts: [],
					failures: [],
					events: [],
					startedAt,
					updatedAt: "2026-05-02T00:00:01.000Z",
					completedAt: "2026-05-02T00:00:01.000Z",
				});
			},
			runs: () =>
				actionResult([
					{
						id: "run-1",
						graphId: "graph-1",
						graphName: "Graph",
						status: "completed",
						state: {},
						nodeResults: {
							"node-1": {
								nodeId: "node-1",
								status: "completed",
								output: { token: "secret://site/example.test/login" },
								retryCount: 0,
								startedAt: "2026-05-02T00:00:00.000Z",
								completedAt: "2026-05-02T00:00:01.000Z",
							},
						},
						approvals: [],
						artifacts: [],
						failures: [],
						events: [],
						startedAt: "2026-05-02T00:00:00.000Z",
						updatedAt: "2026-05-02T00:00:01.000Z",
						completedAt: "2026-05-02T00:00:01.000Z",
					},
				] as never),
			status: () => actionResult({ id: "run-1", status: "completed" }),
			resume: async () => actionResult({ id: "run-1", status: "completed" }),
			approve: () => actionResult({ id: "run-1", approved: true }),
			cancel: () => actionResult({ id: "run-1", status: "canceled" }),
			events: () => actionResult([]),
			editState: () => actionResult({ state: {} }),
		},
		close: () => undefined,
	} as unknown as BrowserControlAPI;
}

function baseUrl(address: AddressInfo): string {
	return `http://127.0.0.1:${address.port}`;
}

async function startOpenAiFixture(): Promise<{
	url: string;
	close: () => Promise<void>;
}> {
	const server = http.createServer((request, response) => {
		const chunks: Buffer[] = [];
		request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
		request.on("end", () => {
			response.setHeader("Content-Type", "application/json");
			if (request.url === "/v1/models") {
				response.end(
					JSON.stringify({
						object: "list",
						data: [{ id: "fixture-model", object: "model" }],
					}),
				);
				return;
			}
			if (request.url === "/v1/chat/completions") {
				response.end(
					JSON.stringify({
						id: "chatcmpl-fixture",
						object: "chat.completion",
						created: 1,
						model: "fixture-model",
						choices: [
							{
								index: 0,
								message: { role: "assistant", content: "ok" },
								finish_reason: "stop",
							},
						],
						usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
					}),
				);
				return;
			}
			response.writeHead(404);
			response.end(JSON.stringify({ error: "not found" }));
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	assert.ok(address && typeof address === "object");
	return {
		url: `http://127.0.0.1:${address.port}/v1`,
		close: () => new Promise((resolve) => server.close(() => resolve())),
	};
}

test("web app server persists reusable server info with restrictive permissions", async (t) => {
	const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "bc-web-record-"));
	const previousHome = process.env.BROWSER_CONTROL_HOME;
	const originalWriteFileSync = fs.writeFileSync;
	const originalChmodSync = fs.chmodSync;
	const recordPath = path.join(tmpHome, "runtime", "web-server.json");
	let recordWriteOptions: unknown;
	let recordChmodMode: fs.Mode | undefined;

	process.env.BROWSER_CONTROL_HOME = tmpHome;
	fs.writeFileSync = ((
		filePath: fs.PathOrFileDescriptor,
		data: string | NodeJS.ArrayBufferView,
		options?: fs.WriteFileOptions,
	) => {
		if (filePath === recordPath) recordWriteOptions = options;
		return originalWriteFileSync(filePath, data, options);
	}) as typeof fs.writeFileSync;
	fs.chmodSync = ((filePath: fs.PathLike, mode: fs.Mode) => {
		if (filePath === recordPath) recordChmodMode = mode;
		return originalChmodSync(filePath, mode);
	}) as typeof fs.chmodSync;

	try {
		const server = createWebAppServer({ api: mockApi(), token: "test-token" });
		t.after(() => server.close());
		await server.listen(0, "127.0.0.1");

		assert.deepEqual(recordWriteOptions, { encoding: "utf8", mode: 0o600 });
		assert.equal(recordChmodMode, 0o600);
	} finally {
		fs.writeFileSync = originalWriteFileSync;
		fs.chmodSync = originalChmodSync;
		if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
		else process.env.BROWSER_CONTROL_HOME = previousHome;
		fs.rmSync(tmpHome, { recursive: true, force: true });
	}
});

test("web app server reuses generated dashboard token across restarts", async () => {
	const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "bc-web-token-"));
	const previousHome = process.env.BROWSER_CONTROL_HOME;
	process.env.BROWSER_CONTROL_HOME = tmpHome;
	const tokenPath = path.join(tmpHome, "secrets", "web-dashboard-token");

	let firstServer: ReturnType<typeof createWebAppServer> | null = null;
	let secondServer: ReturnType<typeof createWebAppServer> | null = null;
	try {
		firstServer = createWebAppServer({ api: mockApi() });
		const firstInfo = await firstServer.listen(0, "127.0.0.1");
		await firstServer.close();
		firstServer = null;

		assert.equal(fs.readFileSync(tokenPath, "utf8").trim(), firstInfo.token);
		if (process.platform !== "win32") {
			assert.equal(fs.statSync(tokenPath).mode & 0o777, 0o600);
		}

		secondServer = createWebAppServer({ api: mockApi() });
		const secondInfo = await secondServer.listen(0, "127.0.0.1");

		assert.equal(secondInfo.token, firstInfo.token);
	} finally {
		await firstServer?.close().catch(() => undefined);
		await secondServer?.close().catch(() => undefined);
		if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
		else process.env.BROWSER_CONTROL_HOME = previousHome;
		fs.rmSync(tmpHome, { recursive: true, force: true });
	}
});

test("explicit web dashboard token does not overwrite persisted token", async () => {
	const tmpHome = fs.mkdtempSync(
		path.join(os.tmpdir(), "bc-web-explicit-token-"),
	);
	const previousHome = process.env.BROWSER_CONTROL_HOME;
	process.env.BROWSER_CONTROL_HOME = tmpHome;
	const tokenPath = path.join(tmpHome, "secrets", "web-dashboard-token");
	fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
	fs.writeFileSync(tokenPath, "persisted-token\n", { mode: 0o600 });

	let server: ReturnType<typeof createWebAppServer> | null = null;
	try {
		server = createWebAppServer({ api: mockApi(), token: "explicit-token" });
		const info = await server.listen(0, "127.0.0.1");

		assert.equal(info.token, "explicit-token");
		assert.equal(fs.readFileSync(tokenPath, "utf8").trim(), "persisted-token");
	} finally {
		await server?.close().catch(() => undefined);
		if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
		else process.env.BROWSER_CONTROL_HOME = previousHome;
		fs.rmSync(tmpHome, { recursive: true, force: true });
	}
});

test("web app server protects API routes and exposes status/capabilities", async (t) => {
	const server = createWebAppServer({ api: mockApi(), token: "test-token" });
	t.after(() => server.close());
	const info = await server.listen(0, "127.0.0.1");
	const url = info.url;

	const denied = await fetch(`${url}/api/status`);
	assert.equal(denied.status, 401);

	const queryDenied = await fetch(`${url}/api/status?token=test-token`);
	assert.equal(queryDenied.status, 401);

	const status = await fetch(`${url}/api/status`, {
		headers: { authorization: "Bearer test-token" },
	});
	assert.equal(status.status, 200);
	assert.equal(
		((await status.json()) as { daemon: { state: string } }).daemon.state,
		"running",
	);

	const caps = await fetch(`${url}/api/capabilities`, {
		headers: { "x-api-key": "test-token" },
	});
	assert.equal(caps.status, 200);
	assert.equal(
		((await caps.json()) as { terminal: { available: boolean } }).terminal
			.available,
		true,
	);
});

test("web app server redacts status response secrets", async (t) => {
	const api = mockApi();
	api.status = async () =>
		({
			daemon: { state: "running" },
			broker: {
				reachable: true,
				url: "https://broker.example.test?api_key=broker-secret-value",
			},
			provider: {
				active: "browserless",
				endpoint:
					"wss://user:provider-secret@example.test/chromium?token=provider-token-value",
			},
			nested: {
				callbackUrl: "https://example.test/callback?key=nested-secret-value",
			},
		}) as never;

	const server = createWebAppServer({ api, token: "test-token" });
	t.after(() => server.close());
	const info = await server.listen(0, "127.0.0.1");

	const response = await fetch(`${info.url}/api/status`, {
		headers: { authorization: "Bearer test-token" },
	});

	assert.equal(response.status, 200);
	const body = await response.text();
	assert.doesNotMatch(body, /broker-secret-value/);
	assert.doesNotMatch(body, /provider-secret/);
	assert.doesNotMatch(body, /provider-token-value/);
	assert.doesNotMatch(body, /nested-secret-value/);
	assert.match(body, /REDACTED/);
});

test("web app server reports uncaught API failures as redacted 500", async (t) => {
	const api = mockApi();
	api.status = async () => {
		throw new Error("database exploded with password=super-secret");
	};
	const server = createWebAppServer({ api, token: "test-token" });
	t.after(() => server.close());
	const info = await server.listen(0, "127.0.0.1");

	const response = await fetch(`${info.url}/api/status`, {
		headers: { authorization: "Bearer test-token" },
	});

	assert.equal(response.status, 500);
	const body = await response.text();
	assert.match(body, /"code":"internal_error"/u);
	assert.match(body, /"error":"Internal server error\."/u);
	assert.doesNotMatch(body, /super-secret/u);
	assert.doesNotMatch(body, /database exploded/u);
});

test("web app server requires auth for healthz", async (t) => {
	const server = createWebAppServer({ api: mockApi(), token: "test-token" });
	t.after(() => server.close());
	const info = await server.listen(0, "127.0.0.1");

	const denied = await fetch(`${info.url}/healthz`);
	assert.equal(denied.status, 401);

	const allowed = await fetch(`${info.url}/healthz`, {
		headers: { authorization: "Bearer test-token" },
	});
	assert.equal(allowed.status, 200);
	assert.deepEqual(await allowed.json(), { ok: true });
});

test("web app server rate limits repeated unauthorized healthz requests", async (t) => {
	const server = createWebAppServer({ api: mockApi(), token: "test-token" });
	t.after(() => server.close());
	const info = await server.listen(0, "127.0.0.1");

	let response: Response | null = null;
	for (let i = 0; i < 61; i += 1) {
		response = await fetch(`${info.url}/healthz`, {
			headers: { authorization: "Bearer wrong-token" },
		});
	}

	assert.equal(response?.status, 429);
	assert.equal(response?.headers.get("retry-after"), "60");
	assert.match(await response.text(), /rate limit/i);
});

test("web app server rate limits repeated unauthorized api requests", async (t) => {
	const server = createWebAppServer({ api: mockApi(), token: "test-token" });
	t.after(() => server.close());
	const info = await server.listen(0, "127.0.0.1");

	let response: Response | null = null;
	for (let i = 0; i < 61; i += 1) {
		response = await fetch(`${info.url}/api/status`, {
			headers: { authorization: "Bearer wrong-token" },
		});
	}

	assert.equal(response?.status, 429);
	assert.equal(response?.headers.get("retry-after"), "60");
	assert.match(await response.text(), /rate limit/i);
});

test("web app server rate limits repeated authorized api requests", async (t) => {
	const server = createWebAppServer({ api: mockApi(), token: "test-token" });
	t.after(() => server.close());
	const info = await server.listen(0, "127.0.0.1");

	let response: Response | null = null;
	for (let i = 0; i < 301; i += 1) {
		response = await fetch(`${info.url}/api/status`, {
			headers: { authorization: "Bearer test-token" },
		});
	}

	assert.equal(response?.status, 429);
	assert.equal(response?.headers.get("retry-after"), "60");
	assert.match(await response.text(), /rate limit/i);
});

test("web app config mutation only allows dashboard-safe keys", async (t) => {
	const api = mockApi();
	const setCalls: Array<{ key: string; value: unknown }> = [];
	api.config = {
		...api.config,
		set: (key: string, value: unknown) => {
			setCalls.push({ key, value });
			return actionResult({ key, value, source: "user" } as never);
		},
	};
	const server = createWebAppServer({ api, token: "test-token" });
	t.after(() => server.close());
	const info = await server.listen(0, "127.0.0.1");
	const headers = {
		"content-type": "application/json",
		authorization: "Bearer test-token",
	};

	const allowed = await fetch(`${info.url}/api/config/logLevel`, {
		method: "POST",
		headers,
		body: JSON.stringify({ value: "debug" }),
	});
	assert.equal(allowed.status, 200);

	for (const [key, value] of [
		["policyProfile", "trusted"],
		["browserLaunchProfile", "system"],
		["browserlessApiKey", "secret-browserless-key"],
	] as const) {
		const denied = await fetch(`${info.url}/api/config/${key}`, {
			method: "POST",
			headers,
			body: JSON.stringify({ value }),
		});
		assert.equal(denied.status, 403, `${key} should be denied`);
		assert.match(await denied.text(), /not mutable from the dashboard/i);
	}

	assert.deepEqual(setCalls, [{ key: "logLevel", value: "debug" }]);
});

test("web app config get redacts sensitive config values at route boundary", async (t) => {
	const api = mockApi();
	api.config = {
		...api.config,
		get: (key: string) =>
			({
				key,
				category: "ai",
				value: "super-secret-model-key",
				defaultValue: "super-secret-model-key",
				source: "user",
				sensitive: true,
				envVars: ["BROWSER_CONTROL_MODEL_API_KEY"],
				description: "API key for the selected model provider.",
			}) as never,
	};
	const server = createWebAppServer({ api, token: "test-token" });
	t.after(() => server.close());
	const info = await server.listen(0, "127.0.0.1");

	const response = await fetch(`${info.url}/api/config/modelApiKey`, {
		headers: { authorization: "Bearer test-token" },
	});

	assert.equal(response.status, 200);
	const text = await response.text();
	assert.doesNotMatch(text, /super-secret-model-key/);
	const body = JSON.parse(text) as { value: string; defaultValue: string };
	assert.equal(body.value, "[redacted]");
	assert.equal(body.defaultValue, "[redacted]");
});

test("auth token comparison uses timing-safe digest equality for mismatched token lengths", (t) => {
	let calls = 0;
	t.mock.method(
		crypto,
		"timingSafeEqual",
		(actual: NodeJS.ArrayBufferView, expected: NodeJS.ArrayBufferView) => {
			calls += 1;
			assert.equal(Buffer.isBuffer(actual), true);
			assert.equal(Buffer.isBuffer(expected), true);
			assert.equal(actual.byteLength, expected.byteLength);
			return false;
		},
	);

	assert.equal(constantTimeTokenEqual("test-token", "xxxx-token"), false);
	assert.equal(calls, 1);
	assert.equal(constantTimeTokenEqual("short", "test-token"), false);
	assert.equal(calls, 2);
	assert.equal(constantTimeTokenEqual(null, "test-token"), false);
	assert.equal(calls, 2);
});

test("web event hub protocol token auth uses constant-time comparison", () => {
	const source = fs.readFileSync(
		path.resolve(__dirname, "../../src/web/events.ts"),
		"utf8",
	);

	assert.match(source, /constantTimeTokenEqual/u);
	assert.doesNotMatch(source, /protocols\.includes\(token\)/u);
});

test("web app JSON endpoints reject missing or wrong content type", async (t) => {
	const api = mockApi();
	const setCalls: Array<{ key: string; value: unknown }> = [];
	api.config = {
		...api.config,
		set: (key: string, value: unknown) => {
			setCalls.push({ key, value });
			return actionResult({ key, value, source: "user" } as never);
		},
	};
	const server = createWebAppServer({ api, token: "test-token" });
	t.after(() => server.close());
	const info = await server.listen(0, "127.0.0.1");

	const wrong = await fetch(`${info.url}/api/config/logLevel`, {
		method: "POST",
		headers: {
			"content-type": "text/plain",
			authorization: "Bearer test-token",
		},
		body: JSON.stringify({ value: "debug" }),
	});
	const wrongBody = (await wrong.json()) as { code?: string; error?: string };
	assert.equal(wrong.status, 415);
	assert.equal(wrongBody.code, "unsupported_media_type");
	assert.match(wrongBody.error ?? "", /application\/json/i);

	const missing = await rawHttpRequest(`${info.url}/api/config/logLevel`, {
		method: "POST",
		headers: { authorization: "Bearer test-token" },
		body: JSON.stringify({ value: "trace" }),
	});
	const missingBody = JSON.parse(missing.body) as {
		code?: string;
		error?: string;
	};
	assert.equal(missing.statusCode, 415);
	assert.equal(missingBody.code, "unsupported_media_type");
	assert.match(missingBody.error ?? "", /application\/json/i);
	assert.deepEqual(setCalls, []);
});

test("web app server exposes credential vault without leaking secret values", async (t) => {
	const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "bc-web-vault-"));
	const previousHome = process.env.BROWSER_CONTROL_HOME;
	const previousBackend = process.env.BROWSER_CONTROL_STATE_BACKEND;
	process.env.BROWSER_CONTROL_HOME = tmpHome;
	process.env.BROWSER_CONTROL_STATE_BACKEND = "json";
	resetStateStorage();
	resetCredentialVault();
	t.after(() => {
		resetCredentialVault();
		resetStateStorage();
		if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
		else process.env.BROWSER_CONTROL_HOME = previousHome;
		if (previousBackend === undefined)
			delete process.env.BROWSER_CONTROL_STATE_BACKEND;
		else process.env.BROWSER_CONTROL_STATE_BACKEND = previousBackend;
		fs.rmSync(tmpHome, { recursive: true, force: true });
	});

	const server = createWebAppServer({ api: mockApi(), token: "test-token" });
	t.after(() => server.close());
	const info = await server.listen(0, "127.0.0.1");
	const headers = {
		"content-type": "application/json",
		authorization: "Bearer test-token",
	};

	const rejected = await fetch(`${info.url}/api/vault`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			scope: "site",
			scopeName: "example.test",
			secretName: "login",
			value: "super-secret-value",
		}),
	});
	assert.equal(rejected.status, 400);

	const created = await fetch(`${info.url}/api/vault`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			scope: "site",
			scopeName: "example.test",
			secretName: "login",
			value: "super-secret-value",
			confirm: "STORE_SECRET",
		}),
	});
	assert.equal(created.status, 200);
	const createdText = await created.text();
	assert.doesNotMatch(createdText, /super-secret-value/);
	const createdBody = JSON.parse(createdText) as {
		id: string;
		hasValue: boolean;
	};
	assert.equal(createdBody.id, "secret://site/example.test/login");
	assert.equal(createdBody.hasValue, true);

	const createdWithYes = await fetch(`${info.url}/api/vault`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			scope: "site",
			scopeName: "example.test",
			secretName: "login-yes",
			value: "super-secret-yes-value",
			yes: true,
		}),
	});
	assert.equal(createdWithYes.status, 200);
	const createdWithYesText = await createdWithYes.text();
	assert.doesNotMatch(createdWithYesText, /super-secret-yes-value/);
	const createdWithYesBody = JSON.parse(createdWithYesText) as {
		id: string;
		hasValue: boolean;
	};
	assert.equal(createdWithYesBody.id, "secret://site/example.test/login-yes");
	assert.equal(createdWithYesBody.hasValue, true);

	const list = await fetch(`${info.url}/api/vault`, {
		headers: { authorization: "Bearer test-token" },
	});
	assert.equal(list.status, 200);
	const listText = await list.text();
	assert.doesNotMatch(listText, /super-secret-value/);
	assert.doesNotMatch(listText, /super-secret-yes-value/);
	assert.doesNotMatch(listText, /secret:\/\/site\/example.test\/login/);
	assert.doesNotMatch(listText, /example\.test/);
	assert.doesNotMatch(listText, /login/);
	const listSummary = JSON.parse(listText) as {
		count: number;
		scopes: string[];
		withValues: number;
		missingValues: number;
	};
	assert.deepEqual(listSummary, {
		count: 2,
		scopes: ["site"],
		withValues: 2,
		missingValues: 0,
	});

	const verboseList = await fetch(`${info.url}/api/vault?verbose=true`, {
		headers: { authorization: "Bearer test-token" },
	});
	assert.equal(verboseList.status, 403);
	const verboseListText = await verboseList.text();
	assert.doesNotMatch(verboseListText, /super-secret-value/);
	assert.doesNotMatch(verboseListText, /super-secret-yes-value/);
	assert.doesNotMatch(verboseListText, /secret:\/\/site\/example.test\/login/);
	assert.match(verboseListText, /confirmation_required/);

	const confirmedVerboseList = await fetch(
		`${info.url}/api/vault?verbose=true`,
		{
			headers: {
				authorization: "Bearer test-token",
				"x-browser-control-confirm": "REVEAL_VAULT_METADATA",
			},
		},
	);
	assert.equal(confirmedVerboseList.status, 200);
	const confirmedVerboseListText = await confirmedVerboseList.text();
	assert.doesNotMatch(confirmedVerboseListText, /super-secret-value/);
	assert.doesNotMatch(confirmedVerboseListText, /super-secret-yes-value/);
	assert.match(
		confirmedVerboseListText,
		/secret:\/\/site\/example.test\/login/,
	);
	const verboseListBody = JSON.parse(confirmedVerboseListText) as Array<{
		id: string;
		hasValue: boolean;
	}>;
	assert.equal(verboseListBody[0]?.hasValue, true);

	const grant = await fetch(`${info.url}/api/vault/grants`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			secretId: createdBody.id,
			actions: ["type", "use-as-form-value"],
			domainScope: "example.test",
			packageScope: "pkg.alpha",
			workflowScope: "flow.login",
		}),
	});
	assert.equal(grant.status, 200);
	const grantBody = (await grant.json()) as {
		id: string;
		actions: string[];
		domainScope: string;
		packageScope: string;
		workflowScope: string;
		revoked: boolean;
	};
	assert.equal(grantBody.revoked, false);
	assert.deepEqual(grantBody.actions, ["type", "use-as-form-value"]);
	assert.equal(grantBody.domainScope, "example.test");
	assert.equal(grantBody.packageScope, "pkg.alpha");
	assert.equal(grantBody.workflowScope, "flow.login");

	const revoked = await fetch(
		`${info.url}/api/vault/grants/${encodeURIComponent(grantBody.id)}`,
		{ method: "DELETE", headers: { authorization: "Bearer test-token" } },
	);
	assert.equal(revoked.status, 200);
	assert.equal(((await revoked.json()) as { success: boolean }).success, true);

	const grantsAfterRevoke = await fetch(`${info.url}/api/vault/grants`, {
		headers: { authorization: "Bearer test-token" },
	});
	const grantsText = await grantsAfterRevoke.text();
	assert.doesNotMatch(grantsText, /super-secret-value/);
	assert.doesNotMatch(grantsText, /super-secret-yes-value/);
	assert.doesNotMatch(grantsText, /example\.test/);
	assert.doesNotMatch(grantsText, /pkg\.alpha/);
	assert.doesNotMatch(grantsText, /flow\.login/);
	const grantsSummary = JSON.parse(grantsText) as {
		count: number;
		activeCount: number;
		revokedCount: number;
	};
	assert.deepEqual(grantsSummary, {
		count: 1,
		activeCount: 0,
		revokedCount: 1,
	});

	const verboseGrantsAfterRevoke = await fetch(
		`${info.url}/api/vault/grants?verbose=true`,
		{
			headers: { authorization: "Bearer test-token" },
		},
	);
	const verboseGrantsText = await verboseGrantsAfterRevoke.text();
	assert.equal(verboseGrantsAfterRevoke.status, 403);
	assert.doesNotMatch(verboseGrantsText, /super-secret-value/);
	assert.doesNotMatch(verboseGrantsText, /super-secret-yes-value/);
	assert.doesNotMatch(verboseGrantsText, /example\.test/);
	assert.match(verboseGrantsText, /confirmation_required/);

	const confirmedVerboseGrantsAfterRevoke = await fetch(
		`${info.url}/api/vault/grants?verbose=true`,
		{
			headers: {
				authorization: "Bearer test-token",
				"x-browser-control-confirm": "REVEAL_VAULT_METADATA",
			},
		},
	);
	assert.equal(confirmedVerboseGrantsAfterRevoke.status, 200);
	const confirmedVerboseGrantsText =
		await confirmedVerboseGrantsAfterRevoke.text();
	assert.doesNotMatch(confirmedVerboseGrantsText, /super-secret-value/);
	assert.doesNotMatch(confirmedVerboseGrantsText, /super-secret-yes-value/);
	const grantsBody = JSON.parse(confirmedVerboseGrantsText) as Array<{
		id: string;
		revoked: boolean;
		revokedAt?: string;
	}>;
	assert.equal(
		grantsBody.find((item) => item.id === grantBody.id)?.revoked,
		true,
	);

	const audit = await fetch(`${info.url}/api/vault/audit`, {
		headers: { authorization: "Bearer test-token" },
	});
	const auditText = await audit.text();
	assert.doesNotMatch(auditText, /super-secret-value/);
	assert.doesNotMatch(auditText, /super-secret-yes-value/);
	assert.match(auditText, /grant:revoke/);
});

test("web app server saves model config redacted and starts authenticated local model API", async (t) => {
	const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "bc-web-model-"));
	const previousHome = process.env.BROWSER_CONTROL_HOME;
	process.env.BROWSER_CONTROL_HOME = tmpHome;
	const upstream = await startOpenAiFixture();
	t.after(async () => {
		await upstream.close();
		if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
		else process.env.BROWSER_CONTROL_HOME = previousHome;
		fs.rmSync(tmpHome, { recursive: true, force: true });
	});

	const server = createWebAppServer({ api: mockApi(), token: "test-token" });
	t.after(() => server.close());
	const info = await server.listen(0, "127.0.0.1");
	const headers = {
		"content-type": "application/json",
		authorization: "Bearer test-token",
	};

	const unconfirmed = await fetch(`${info.url}/api/config/modelProvider`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			modelProvider: "openai-compatible",
			modelEndpoint: upstream.url,
			modelKey: "super-secret-model-key",
			modelName: "fixture-model",
		}),
	});
	assert.equal(unconfirmed.status, 403);
	const unconfirmedText = await unconfirmed.text();
	assert.doesNotMatch(unconfirmedText, /super-secret-model-key/);
	assert.match(unconfirmedText, /confirmation_required/);

	const saved = await fetch(`${info.url}/api/config/modelProvider`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			modelProvider: "openai-compatible",
			modelEndpoint: upstream.url,
			modelKey: "super-secret-model-key",
			modelName: "fixture-model",
			confirm: "STORE_MODEL_API_KEY",
		}),
	});
	assert.equal(saved.status, 200);
	const savedText = await saved.text();
	assert.doesNotMatch(savedText, /super-secret-model-key/);
	assert.match(savedText, /\[redacted\]/);

	const localApi = await fetch(`${info.url}/api/config/localApi`, {
		method: "POST",
		headers,
		body: JSON.stringify({ port: 0, token: "local-api-test-token" }),
	});
	assert.equal(localApi.status, 200);
	const localApiBody = (await localApi.json()) as {
		success: boolean;
		url: string;
		tokenProvided: boolean;
	};
	assert.equal(localApiBody.success, true);
	assert.equal(localApiBody.tokenProvided, true);
	assert.match(localApiBody.url, /^http:\/\/127\.0\.0\.1:\d+\/?$/u);
	assert.doesNotMatch(localApiBody.url, /:0\/?$/u);

	const denied = await fetch(`${localApiBody.url}/v1/models`);
	assert.equal(denied.status, 401);

	const chat = await fetch(`${localApiBody.url}/v1/chat/completions`, {
		method: "POST",
		headers: {
			authorization: "Bearer local-api-test-token",
			"content-type": "application/json",
		},
		body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
	});
	const chatText = await chat.text();
	assert.equal(chat.status, 200, chatText);
	assert.equal(
		(JSON.parse(chatText) as { model: string }).model,
		"fixture-model",
	);
});

test("web app server exposes record to workflow and package draft flow", async (t) => {
	resetRecorder();
	const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "bc-web-materialize-"));
	const previousHome = process.env.BROWSER_CONTROL_HOME;
	process.env.BROWSER_CONTROL_HOME = tmpHome;
	const server = createWebAppServer({ api: mockApi(), token: "test-token" });
	t.after(() => {
		if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
		else process.env.BROWSER_CONTROL_HOME = previousHome;
		fs.rmSync(tmpHome, { recursive: true, force: true });
		return server.close();
	});
	const info = await server.listen(0, "127.0.0.1");
	const headers = {
		"content-type": "application/json",
		authorization: "Bearer test-token",
	};

	const started = await fetch(`${info.url}/api/recordings/start`, {
		method: "POST",
		headers,
		body: JSON.stringify({ name: "Checkout Capture", domain: "shop.test" }),
	});
	assert.equal(started.status, 200);
	const startedBody = (await started.json()) as {
		data: { id: string };
	};
	const recordingId = startedBody.data.id;

	const filled = await fetch(`${info.url}/api/recordings/actions`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			kind: "browser-fill",
			params: {
				target: "#password",
				text: "secret://site/shop.test/password",
			},
		}),
	});
	assert.equal(filled.status, 200);
	const filledText = await filled.text();
	assert.doesNotMatch(filledText, /secret:\/\/site/u);
	assert.match(filledText, /\[REDACTED_SECRET\]/u);

	const terminal = await fetch(`${info.url}/api/recordings/actions`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			kind: "terminal-exec",
			params: { command: "npm test" },
		}),
	});
	assert.equal(terminal.status, 200);

	const stopped = await fetch(`${info.url}/api/recordings/stop`, {
		method: "POST",
		headers,
	});
	assert.equal(stopped.status, 200);

	const draft = await fetch(
		`${info.url}/api/recordings/${encodeURIComponent(recordingId)}/draft`,
		{ headers: { authorization: "Bearer test-token" } },
	);
	assert.equal(draft.status, 200);
	const draftText = await draft.text();
	assert.doesNotMatch(draftText, /secret:\/\/site/u);
	const draftBody = JSON.parse(draftText) as {
		data: {
			workflow: { nodes: Array<{ kind: string }> };
			package: { manifest: { permissions: Array<Record<string, unknown>> } };
		};
	};
	assert.deepEqual(
		draftBody.data.workflow.nodes.map((node) => node.kind),
		["browser", "terminal"],
	);
	assert.ok(
		draftBody.data.package.manifest.permissions.some(
			(permission) =>
				permission.kind === "terminal" &&
				Array.isArray(permission.commands) &&
				permission.commands.includes("npm test"),
		),
	);

	const materialized = await fetch(
		`${info.url}/api/recordings/${encodeURIComponent(recordingId)}/materialize`,
		{
			method: "POST",
			headers,
			body: JSON.stringify({ install: true, overwrite: true }),
		},
	);
	assert.equal(materialized.status, 200);
	const materializedBody = (await materialized.json()) as {
		success: boolean;
		data: { materialized: { packageDir: string; manifestPath: string } };
	};
	assert.equal(materializedBody.success, true);
	assert.ok(fs.existsSync(materializedBody.data.materialized.manifestPath));
	assert.ok(
		materializedBody.data.materialized.packageDir.includes(
			path.join("packages", "drafts"),
		),
	);
});

test("web app server records real browser terminal and filesystem actions into replay draft", async (t) => {
	resetRecorder();
	const server = createWebAppServer({ api: mockApi(), token: "test-token" });
	t.after(() => {
		resetRecorder();
		return server.close();
	});
	const info = await server.listen(0, "127.0.0.1");
	const headers = {
		"content-type": "application/json",
		authorization: "Bearer test-token",
	};

	const started = await fetch(`${info.url}/api/recordings/start`, {
		method: "POST",
		headers,
		body: JSON.stringify({ name: "Real Action Capture", domain: "shop.test" }),
	});
	assert.equal(started.status, 200);
	const recordingId = ((await started.json()) as { data: { id: string } }).data
		.id;

	const opened = await fetch(`${info.url}/api/browser/open`, {
		method: "POST",
		headers,
		body: JSON.stringify({ url: "https://shop.test/cart" }),
	});
	assert.equal(opened.status, 200);

	const filled = await fetch(`${info.url}/api/browser/fill`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			target: "#password",
			text: "secret://site/shop.test/password",
		}),
	});
	assert.equal(filled.status, 200);
	assert.doesNotMatch(await filled.text(), /secret:\/\/site/u);

	const terminal = await fetch(`${info.url}/api/terminal/exec`, {
		method: "POST",
		headers,
		body: JSON.stringify({ command: "npm test" }),
	});
	assert.equal(terminal.status, 200);

	const written = await fetch(`${info.url}/api/fs/write`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			path: "reports/output.txt",
			content: "secret://site/shop.test/token",
		}),
	});
	assert.equal(written.status, 200);

	const stopped = await fetch(`${info.url}/api/recordings/stop`, {
		method: "POST",
		headers,
	});
	assert.equal(stopped.status, 200);

	const draft = await fetch(
		`${info.url}/api/recordings/${encodeURIComponent(recordingId)}/draft`,
		{ headers: { authorization: "Bearer test-token" } },
	);
	assert.equal(draft.status, 200);
	const draftText = await draft.text();
	assert.doesNotMatch(draftText, /secret:\/\/site/u);
	const draftBody = JSON.parse(draftText) as {
		data: {
			workflow: {
				nodes: Array<{ kind: string; input: Record<string, unknown> }>;
			};
			package: { manifest: { permissions: Array<Record<string, unknown>> } };
		};
	};
	assert.deepEqual(
		draftBody.data.workflow.nodes.map((node) => node.kind),
		["browser", "browser", "terminal", "filesystem"],
	);
	assert.equal(
		draftBody.data.workflow.nodes[0]?.input.url,
		"https://shop.test/cart",
	);
	assert.equal(
		draftBody.data.workflow.nodes[1]?.input.text,
		"[REDACTED_SECRET]",
	);
	assert.ok(
		draftBody.data.package.manifest.permissions.some(
			(permission) =>
				permission.kind === "filesystem" &&
				Array.isArray(permission.paths) &&
				permission.paths.includes("reports/output.txt") &&
				permission.access === "write",
		),
	);

	const replays = await fetch(`${info.url}/api/debug/replays`, {
		headers: { authorization: "Bearer test-token" },
	});
	assert.equal(replays.status, 200);
	const replayText = await replays.text();
	assert.doesNotMatch(replayText, /secret:\/\/site/u);
	const replayBody = JSON.parse(replayText) as Array<{
		runId: string;
		status: string;
		steps: Array<{ kind: string; input: Record<string, unknown> }>;
	}>;
	const recordedReplay = replayBody.find(
		(entry) => entry.runId === recordingId,
	);
	assert.equal(recordedReplay?.status, "recorded");
	assert.deepEqual(
		recordedReplay?.steps.map((step) => step.kind),
		["browser-open", "browser-fill", "terminal-exec", "fs-write"],
	);
	assert.equal(recordedReplay?.steps[1]?.input.text, "[REDACTED_SECRET]");

	const replayExecution = await fetch(
		`${info.url}/api/debug/replays/${encodeURIComponent(recordingId)}/execute`,
		{ method: "POST", headers: { authorization: "Bearer test-token" } },
	);
	assert.equal(replayExecution.status, 200);
	const replayExecutionText = await replayExecution.text();
	assert.doesNotMatch(replayExecutionText, /secret:\/\/site/u);
	const replayExecutionBody = JSON.parse(replayExecutionText) as {
		success: boolean;
		data: { status: string; steps: Array<{ input: Record<string, unknown> }> };
	};
	assert.equal(replayExecutionBody.success, true);
	assert.equal(replayExecutionBody.data.status, "completed");
	assert.equal(
		replayExecutionBody.data.steps[1]?.input.text,
		"[REDACTED_SECRET]",
	);
});

test("web app server exposes visual, DOM, and filtered audit evidence safely", async (t) => {
	const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "bc-web-evidence-"));
	const previousHome = process.env.BROWSER_CONTROL_HOME;
	process.env.BROWSER_CONTROL_HOME = tmpHome;
	const { getDefaultAuditLogger, resetDefaultAuditLogger } = await import(
		"../../src/policy/audit"
	);
	resetDefaultAuditLogger();
	getDefaultAuditLogger().log({
		timestamp: "2026-05-15T00:00:00.000Z",
		sessionId: "session-1",
		actor: "agent",
		decision: "allow_with_audit",
		reason: "token=superSecretToken12345",
		profile: "balanced",
		risk: "high",
		step: {
			id: "step-1",
			path: "command",
			action: "workflow_run",
			params: { workflowId: "wf-1", packageName: "pkg-a" },
			risk: "high",
		},
	});
	t.after(() => {
		resetDefaultAuditLogger();
		if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
		else process.env.BROWSER_CONTROL_HOME = previousHome;
		fs.rmSync(tmpHome, { recursive: true, force: true });
	});

	const beforePath = path.join(tmpHome, "before.png");
	const afterPath = path.join(tmpHome, "after.png");
	writeTinyPng(beforePath, [0, 0, 0, 255]);
	writeTinyPng(afterPath, [255, 0, 0, 255]);

	const server = createWebAppServer({ api: mockApi(), token: "test-token" });
	t.after(() => server.close());
	const info = await server.listen(0, "127.0.0.1");
	const headers = {
		"content-type": "application/json",
		authorization: "Bearer test-token",
	};

	const visual = await fetch(`${info.url}/api/debug/visual-diff`, {
		method: "POST",
		headers,
		body: JSON.stringify({ beforePath, afterPath }),
	});
	assert.equal(visual.status, 200);
	const visualBody = (await visual.json()) as {
		success: boolean;
		data: { changedPixelCount: number; diffPath: string };
	};
	assert.equal(visualBody.success, true);
	assert.equal(visualBody.data.changedPixelCount, 1);
	assert.ok(
		visualBody.data.diffPath.startsWith(
			path.join(tmpHome, "reports", "evidence"),
		),
	);

	const denied = await fetch(`${info.url}/api/debug/visual-diff`, {
		method: "POST",
		headers,
		body: JSON.stringify({ beforePath: "C:\\Windows\\win.ini", afterPath }),
	});
	assert.equal(denied.status, 400);

	const dom = await fetch(`${info.url}/api/debug/dom-diff`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			beforeNodes: [{ selector: "#result", text: "Old" }],
			afterNodes: [{ selector: "#result", text: "New secret://site/password" }],
		}),
	});
	assert.equal(dom.status, 200);
	assert.doesNotMatch(await dom.text(), /secret:\/\/site/u);

	const audit = await fetch(
		`${info.url}/api/audit?sessionId=session-1&workflowId=wf-1&packageName=pkg-a&risk=high`,
		{ headers: { authorization: "Bearer test-token" } },
	);
	assert.equal(audit.status, 200);
	const auditText = await audit.text();
	assert.match(auditText, /workflow_run/);
	assert.doesNotMatch(auditText, /superSecretToken12345/u);
});

test("web app server exposes real failure debug bundles without leaking secrets", async (t) => {
	const tmpHome = fs.mkdtempSync(
		path.join(os.tmpdir(), "bc-web-debug-bundle-"),
	);
	const previousHome = process.env.BROWSER_CONTROL_HOME;
	process.env.BROWSER_CONTROL_HOME = tmpHome;
	t.after(() => {
		if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
		else process.env.BROWSER_CONTROL_HOME = previousHome;
		fs.rmSync(tmpHome, { recursive: true, force: true });
	});

	const { collectFailureDebugMetadata } = await import(
		"../../src/observability/action_debug"
	);
	const { listDebugBundles, loadDebugBundle } = await import(
		"../../src/observability/debug_bundle"
	);

	const debug = await collectFailureDebugMetadata({
		action: "browser_click",
		sessionId: "session-debug",
		executionPath: "a11y",
		error: new Error("Selector failed with secret://site/password"),
		page: {
			url: () => "https://example.test/?token=superSecretToken12345",
			title: async () => "Debug Failure",
			screenshot: async () => Buffer.from("not-a-real-png"),
			evaluate: async <T>() =>
				[
					{
						ref: "e0",
						role: "button",
						name: "Submit",
						text: "secret://site/password",
					},
				] as T,
		},
		policyDecision: "allow_with_audit",
		policyReason: "token=superSecretToken12345",
	});
	assert.ok(debug.debugBundleId);

	const api = mockApi();
	api.debug = {
		...api.debug,
		listBundles: () => listDebugBundles(),
		bundle: (bundleId: string) => loadDebugBundle(bundleId),
	};

	const server = createWebAppServer({ api, token: "test-token" });
	t.after(() => server.close());
	const info = await server.listen(0, "127.0.0.1");
	const headers = { authorization: "Bearer test-token" };

	const listed = await fetch(`${info.url}/api/debug/bundles`, { headers });
	assert.equal(listed.status, 200);
	const listedText = await listed.text();
	assert.match(listedText, /browser_click/u);
	assert.doesNotMatch(listedText, /secret:\/\/site/u);
	assert.doesNotMatch(listedText, /superSecretToken12345/u);

	const detail = await fetch(
		`${info.url}/api/debug/bundles/${encodeURIComponent(debug.debugBundleId)}`,
		{ headers },
	);
	assert.equal(detail.status, 200);
	const detailText = await detail.text();
	assert.match(detailText, /Debug Failure/u);
	assert.match(detailText, /browser_click/u);
	assert.doesNotMatch(detailText, /secret:\/\/site/u);
	assert.doesNotMatch(detailText, /superSecretToken12345/u);

	const traversal = await fetch(`${info.url}/api/debug/bundles/..%2Fsecret`, {
		headers,
	});
	assert.equal(traversal.status, 404);
});

test("web app server keeps evidence page load quiet when debug bundle listing needs confirmation", async (t) => {
	const api = mockApi();
	api.debug = {
		...api.debug,
		listBundles: () => {
			throw new Error('Risk level "high" requires user confirmation');
		},
	};
	const server = createWebAppServer({ api, token: "test-token" });
	t.after(() => server.close());
	const info = await server.listen(0, "127.0.0.1");

	const listed = await fetch(`${info.url}/api/debug/bundles`, {
		headers: { authorization: "Bearer test-token" },
	});

	assert.equal(listed.status, 200);
	assert.deepEqual(await listed.json(), []);
});

test("web app server reports real debug bundle listing failures", async (t) => {
	const api = mockApi();
	api.debug = {
		...api.debug,
		listBundles: () => {
			throw new Error("debug bundle store unreadable");
		},
	};
	const server = createWebAppServer({ api, token: "test-token" });
	t.after(() => server.close());
	const info = await server.listen(0, "127.0.0.1");

	const listed = await fetch(`${info.url}/api/debug/bundles`, {
		headers: { authorization: "Bearer test-token" },
	});

	assert.equal(listed.status, 500);
	const body = await listed.text();
	assert.match(body, /"code":"internal_error"/u);
	assert.doesNotMatch(body, /debug bundle store unreadable/u);
});

test("web app server exposes service proxy status and controls", async (t) => {
	const server = createWebAppServer({ api: mockApi(), token: "test-token" });
	t.after(() => server.close());
	const info = await server.listen(0, "127.0.0.1");
	const headers = {
		"content-type": "application/json",
		authorization: "Bearer test-token",
	};

	const services = await fetch(`${info.url}/api/services`, {
		headers: { authorization: "Bearer test-token" },
	});
	assert.equal(services.status, 200);
	assert.match(await services.text(), /"app"/u);

	const status = await fetch(`${info.url}/api/services/proxy`, {
		headers: { authorization: "Bearer test-token" },
	});
	assert.equal(status.status, 200);
	assert.match(await status.text(), /"enabled":false/u);

	const started = await fetch(`${info.url}/api/services/proxy/start`, {
		method: "POST",
		headers,
		body: JSON.stringify({ port: 0 }),
	});
	assert.equal(started.status, 200);
	assert.match(await started.text(), /127\.0\.0\.1:3210/u);

	const stopped = await fetch(`${info.url}/api/services/proxy/stop`, {
		method: "POST",
		headers,
	});
	assert.equal(stopped.status, 200);
	assert.match(await stopped.text(), /"stopped":true/u);
});

test("web app server exposes provider health diagnostics", async (t) => {
	const server = createWebAppServer({ api: mockApi(), token: "test-token" });
	t.after(() => server.close());
	const info = await server.listen(0, "127.0.0.1");
	const headers = { authorization: "Bearer test-token" };

	const response = await fetch(`${info.url}/api/browser/providers/health`, {
		headers,
	});

	assert.equal(response.status, 200);
	const body = (await response.json()) as {
		data: Array<{ name: string; state: string; score: number }>;
	};
	assert.equal(body.data[0].name, "local");
	assert.equal(body.data[0].state, "healthy");
	assert.equal(body.data[0].score, 100);
});

test("web app server exposes browser provider catalog metadata", async (t) => {
	const server = createWebAppServer({ api: mockApi(), token: "test-token" });
	t.after(() => server.close());
	const info = await server.listen(0, "127.0.0.1");

	const response = await fetch(`${info.url}/api/browser/providers/catalog`, {
		headers: { authorization: "Bearer test-token" },
	});

	assert.equal(response.status, 200);
	const body = (await response.json()) as {
		data: Array<{ name: string; risk: string; requiresAuth: boolean }>;
	};
	assert.equal(body.data[0].name, "browserbase");
	assert.equal(body.data[0].risk, "high");
	assert.equal(body.data[0].requiresAuth, true);
	assert.doesNotMatch(JSON.stringify(body), /secret-token|apiKeyValue/u);
});

test("web app server exposes network rule management", async (t) => {
	const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "bc-web-rules-"));
	const previousHome = process.env.BROWSER_CONTROL_HOME;
	const previousBackend = process.env.BROWSER_CONTROL_STATE_BACKEND;
	process.env.BROWSER_CONTROL_HOME = tmpHome;
	process.env.BROWSER_CONTROL_STATE_BACKEND = "json";
	t.after(() => {
		if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
		else process.env.BROWSER_CONTROL_HOME = previousHome;
		if (previousBackend === undefined)
			delete process.env.BROWSER_CONTROL_STATE_BACKEND;
		else process.env.BROWSER_CONTROL_STATE_BACKEND = previousBackend;
		fs.rmSync(tmpHome, { recursive: true, force: true });
	});

	const server = createWebAppServer({ api: mockApi(), token: "test-token" });
	t.after(() => server.close());
	const info = await server.listen(0, "127.0.0.1");
	const headers = {
		"content-type": "application/json",
		authorization: "Bearer test-token",
	};

	const created = await fetch(`${info.url}/api/network/rules`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			pattern: "*.analytics.test",
			ruleType: "denylist",
			resourceTypes: ["script"],
		}),
	});
	assert.equal(created.status, 200);
	const createdBody = (await created.json()) as { id: string; pattern: string };
	assert.equal(createdBody.pattern, "*.analytics.test");

	const list = await fetch(`${info.url}/api/network/rules`, {
		headers: { authorization: "Bearer test-token" },
	});
	assert.equal(list.status, 200);
	const rules = (await list.json()) as Array<{ id: string; pattern: string }>;
	assert.ok(rules.some((rule) => rule.id === createdBody.id));

	const removed = await fetch(
		`${info.url}/api/network/rules/${encodeURIComponent(createdBody.id)}`,
		{ method: "DELETE", headers: { authorization: "Bearer test-token" } },
	);
	assert.equal(removed.status, 200);
	assert.equal(((await removed.json()) as { removed: boolean }).removed, true);
});

test("web app server executes terminal route and emits event", async (t) => {
	const server = createWebAppServer({ api: mockApi(), token: "test-token" });
	t.after(() => server.close());
	const info = await server.listen(0, "127.0.0.1");
	const address = server.address() as AddressInfo;

	const unauthorizedSocket = new WebSocket(
		`${baseUrl(address).replace("http", "ws")}/events`,
	);
	const [unauthorizedError] = await once(unauthorizedSocket, "error");
	assert.match(String(unauthorizedError), /Unexpected server response: 401/);
	unauthorizedSocket.close();

	const socket = new WebSocket(
		`${baseUrl(address).replace("http", "ws")}/events`,
		"test-token",
	);
	t.after(() => socket.close());
	const replayEvent = once(socket, "message");
	await once(socket, "open");
	await replayEvent;
	const nextEvent = once(socket, "message");

	const response = await fetch(`${info.url}/api/terminal/exec`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: "Bearer test-token",
		},
		body: JSON.stringify({ command: "echo ok" }),
	});
	assert.equal(response.status, 200);
	const body = (await response.json()) as {
		success: boolean;
		data: { stdout: string };
	};
	assert.equal(body.success, true);
	assert.equal(body.data.stdout, "ok\n");

	const [eventPayload] = await nextEvent;
	const event = JSON.parse(eventPayload.toString()) as {
		type: string;
		payload: { data: { stdout: string } };
	};
	assert.equal(event.type, "terminal.action");
	assert.equal(event.payload.data.stdout, "ok\n");
});

test("terminal API preserves session size and non-submitting input", async (t) => {
	const api = mockApi();
	const openPayloads: unknown[] = [];
	const inputPayloads: unknown[] = [];
	api.terminal.open = async (options: unknown) => {
		openPayloads.push(options);
		return actionResult({
			id: "term-sized",
			shell: "powershell",
			cwd: ".",
			status: "idle",
		});
	};
	api.terminal.type = async (options: unknown) => {
		inputPayloads.push(options);
		return actionResult({ typed: "paste" });
	};
	const server = createWebAppServer({ api, token: "test-token" });
	t.after(() => server.close());
	const info = await server.listen(0, "127.0.0.1");

	const createResponse = await fetch(`${info.url}/api/terminal/sessions`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: "Bearer test-token",
		},
		body: JSON.stringify({ name: "sized", cols: 132, rows: 42 }),
	});
	assert.equal(createResponse.status, 200);
	assert.deepEqual(openPayloads, [
		{ shell: undefined, cwd: undefined, name: "sized", cols: 132, rows: 42 },
	]);

	const inputResponse = await fetch(
		`${info.url}/api/terminal/sessions/term-sized/input`,
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer test-token",
			},
			body: JSON.stringify({ text: "paste without enter", submit: false }),
		},
	);
	assert.equal(inputResponse.status, 200);
	assert.deepEqual(inputPayloads, [
		{ sessionId: "term-sized", text: "paste without enter", submit: false },
	]);
});

test("terminal render endpoint returns browser-ready VT segments", async (t) => {
	const api = mockApi();
	api.terminal.snapshot = async () =>
		actionResult({
			sessionId: "term-render",
			name: "build",
			shell: "bash",
			cwd: "/repo",
			env: {},
			status: "idle",
			lastOutput: "\x1b[1;32mPASS\x1b[0m\nplain",
			promptDetected: true,
			scrollbackLines: 2,
			createdAt: "2026-05-02T00:00:00.000Z",
			lastActivityAt: "2026-05-02T00:00:00.000Z",
		} as never);
	const server = createWebAppServer({ api, token: "test-token" });
	t.after(() => server.close());
	const info = await server.listen(0, "127.0.0.1");

	const response = await fetch(
		`${info.url}/api/terminal/sessions/term-render/render`,
		{ headers: { authorization: "Bearer test-token" } },
	);
	assert.equal(response.status, 200);
	const body = (await response.json()) as {
		success: boolean;
		data: { rows: Array<{ text: string; segments: unknown[] }> };
	};

	assert.equal(body.success, true);
	assert.equal(body.data.rows[0].text, "PASS");
	assert.deepEqual(body.data.rows[0].segments, [
		{ text: "PASS", bold: true, foreground: "green" },
	]);
});

test("web app exposes workflow v2 run, events, state edit, and helper APIs", async (t) => {
	const api = mockApi() as BrowserControlAPI & {
		workflow: {
			run(graph: string): Promise<ActionResult<unknown>>;
			runs(): ActionResult<unknown[]>;
			status(runId: string): ActionResult<unknown>;
			events(runId: string): ActionResult<unknown>;
			editState(
				runId: string,
				key: string,
				value: string | number | boolean,
			): ActionResult<unknown>;
		};
		harness: {
			generate(input: unknown): Promise<ActionResult<unknown>>;
			execute(
				helperId: string,
				input?: Record<string, unknown>,
			): Promise<ActionResult<unknown>>;
		};
	};
	(api as unknown as { workflow: unknown }).workflow = {
		run: async (graph: unknown) =>
			actionResult({ id: "run-1", graph, status: "completed" }),
		runs: () => actionResult([]),
		status: () => actionResult({ id: "run-1", status: "completed" }),
		events: () =>
			actionResult([{ type: "workflow-completed", runId: "run-1" }]),
		editState: (_runId: unknown, key: unknown, value: unknown) =>
			actionResult({ key, value }),
	};
	(api as unknown as { harness: unknown }).harness = {
		generate: async (input: unknown) =>
			actionResult({
				helper: { id: (input as { id?: string }).id },
				activated: true,
			}),
		execute: async (helperId: string, input?: Record<string, unknown>) =>
			actionResult({ helperId, input, validation: { status: "passed" } }),
	};
	const server = createWebAppServer({ api, token: "test-token" });
	t.after(() => server.close());
	const info = await server.listen(0, "127.0.0.1");
	const headers = {
		"content-type": "application/json",
		authorization: "Bearer test-token",
	};

	const run = await fetch(`${info.url}/api/workflows/run`, {
		method: "POST",
		headers,
		body: JSON.stringify({ graph: '{"id":"flow"}' }),
	});
	assert.equal(run.status, 200);
	assert.equal(
		((await run.json()) as { data: { id: string } }).data.id,
		"run-1",
	);

	const events = await fetch(`${info.url}/api/workflows/runs/run-1/events`, {
		headers,
	});
	assert.equal(events.status, 200);
	assert.equal(
		((await events.json()) as { data: Array<{ type: string }> }).data[0].type,
		"workflow-completed",
	);

	const state = await fetch(`${info.url}/api/workflows/runs/run-1/state`, {
		method: "POST",
		headers,
		body: JSON.stringify({ key: "route", value: "right" }),
	});
	assert.equal(state.status, 200);
	assert.equal(
		((await state.json()) as { data: { key: string } }).data.key,
		"route",
	);

	const generated = await fetch(`${info.url}/api/harness/generate`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			id: "helper-ui",
			purpose: "UI helper",
			taskTags: ["login"],
			failureTypes: ["selector"],
			files: [{ path: "helper.js", content: "console.log('ok')" }],
		}),
	});
	assert.equal(generated.status, 200);

	const executed = await fetch(
		`${info.url}/api/harness/helpers/helper-ui/execute`,
		{
			method: "POST",
			headers,
			body: JSON.stringify({ input: { target: "login" } }),
		},
	);
	assert.equal(executed.status, 200);
	assert.equal(
		((await executed.json()) as { data: { helperId: string } }).data.helperId,
		"helper-ui",
	);
});

test("web app server bridges task and automation endpoints through broker", async (t) => {
	const previousKey = process.env.BROKER_API_KEY;
	process.env.BROKER_API_KEY = "web-broker-test-key";
	t.after(() => {
		if (previousKey === undefined) delete process.env.BROKER_API_KEY;
		else process.env.BROKER_API_KEY = previousKey;
	});
	const broker = createBrokerServer({
		callbacks: {
			submitTask: async () => ({ taskId: "task-1" }),
			listTasks: async () => [{ id: "task-1", status: "pending" }],
			getSchedulerQueue: async () => [
				{
					id: "auto-1",
					name: "Morning",
					enabled: true,
					nextRun: new Date("2026-05-02T08:00:00.000Z"),
				},
			],
			scheduleTask: async (request) => ({
				id: request.id,
				nextRun: new Date("2026-05-02T08:00:00.000Z"),
			}),
		},
	});
	t.after(() => broker.close());
	const brokerAddress = await broker.listen(0, "127.0.0.1");
	const previousPort = process.env.BROKER_PORT;
	process.env.BROKER_PORT = String(brokerAddress.port);
	t.after(() => {
		if (previousPort === undefined) delete process.env.BROKER_PORT;
		else process.env.BROKER_PORT = previousPort;
	});

	const server = createWebAppServer({ api: mockApi(), token: "test-token" });
	t.after(() => server.close());
	const info = await server.listen(0, "127.0.0.1");

	const taskRun = await fetch(`${info.url}/api/tasks`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: "Bearer test-token",
		},
		body: JSON.stringify({
			action: "visit",
			params: { url: "https://example.com" },
		}),
	});
	assert.equal(taskRun.status, 202);
	assert.equal(((await taskRun.json()) as { taskId: string }).taskId, "task-1");

	const tasks = await fetch(`${info.url}/api/tasks`, {
		headers: { authorization: "Bearer test-token" },
	});
	assert.equal(tasks.status, 200);
	assert.equal(((await tasks.json()) as Array<{ id: string }>)[0].id, "task-1");

	const automation = await fetch(`${info.url}/api/automations`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: "Bearer test-token",
		},
		body: JSON.stringify({
			id: "auto-1",
			name: "Morning",
			cronExpression: "0 8 * * *",
		}),
	});
	assert.equal(automation.status, 200);
	assert.equal(((await automation.json()) as { id: string }).id, "auto-1");
});

test("web app server persists saved automations and queues run when broker is available", async (t) => {
	const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "bc-web-autos-"));
	const previousHome = process.env.BROWSER_CONTROL_HOME;
	const previousKey = process.env.BROKER_API_KEY;
	process.env.BROWSER_CONTROL_HOME = tmpHome;
	process.env.BROKER_API_KEY = "web-automation-broker-key";
	t.after(() => {
		if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
		else process.env.BROWSER_CONTROL_HOME = previousHome;
		if (previousKey === undefined) delete process.env.BROKER_API_KEY;
		else process.env.BROKER_API_KEY = previousKey;
		fs.rmSync(tmpHome, { recursive: true, force: true });
	});

	const broker = createBrokerServer({
		callbacks: {
			submitTask: async () => ({ taskId: "queued-automation" }),
		},
	});
	t.after(() => broker.close());
	const brokerAddress = await broker.listen(0, "127.0.0.1");
	const previousPort = process.env.BROKER_PORT;
	process.env.BROKER_PORT = String(brokerAddress.port);
	t.after(() => {
		if (previousPort === undefined) delete process.env.BROKER_PORT;
		else process.env.BROKER_PORT = previousPort;
	});

	const server = createWebAppServer({ api: mockApi(), token: "test-token" });
	t.after(() => server.close());
	const info = await server.listen(0, "127.0.0.1");

	const defaults = await fetch(`${info.url}/api/saved-automations`, {
		headers: { authorization: "Bearer test-token" },
	});
	assert.equal(defaults.status, 200);
	assert.deepEqual(await defaults.json(), []);

	const created = await fetch(`${info.url}/api/saved-automations`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: "Bearer test-token",
		},
		body: JSON.stringify({
			name: "Daily review",
			prompt: "Summarize active market conditions.",
		}),
	});
	assert.equal(created.status, 200);
	const createdBody = (await created.json()) as { id: string };

	const run = await fetch(
		`${info.url}/api/saved-automations/${createdBody.id}/run`,
		{
			method: "POST",
			headers: { authorization: "Bearer test-token" },
		},
	);
	assert.equal(run.status, 202);
	const runBody = (await run.json()) as {
		success: boolean;
		queued: boolean;
		result: { taskId: string };
		automation: { runCount: number };
	};
	assert.equal(runBody.success, true);
	assert.equal(runBody.queued, true);
	assert.equal(runBody.result.taskId, "queued-automation");
	assert.equal(runBody.automation.runCount, 1);
});

test("web app server no longer serves /app-config.js (token leak fix)", async (t) => {
	const server = createWebAppServer({ api: mockApi(), token: "secret-token" });
	t.after(() => server.close());
	const info = await server.listen(0, "127.0.0.1");

	// /app-config.js must be gone
	const configJs = await fetch(`${info.url}/app-config.js`);
	assert.equal(configJs.status, 404, "/app-config.js should return 404");

	// Unauthenticated root should NOT contain the token in body
	const root = await fetch(`${info.url}/`);
	const html = await root.text();
	assert.ok(
		!html.includes("secret-token"),
		"Token must not appear in unauthenticated response body",
	);
});

test("web app server sets security headers (CSP, X-Frame-Options)", async (t) => {
	const server = createWebAppServer({ api: mockApi(), token: "test-token" });
	t.after(() => server.close());
	const info = await server.listen(0, "127.0.0.1");

	const response = await fetch(`${info.url}/api/status`, {
		headers: { authorization: "Bearer test-token" },
	});
	assert.equal(response.status, 200);

	const csp = response.headers.get("content-security-policy");
	assert.ok(csp, "CSP header must be present");
	assert.ok(csp?.includes("frame-ancestors 'none'"), "CSP must block framing");
	assert.ok(
		csp?.includes("default-src 'self'"),
		"CSP must restrict default-src",
	);
	assert.ok(
		!csp?.includes("style-src 'self' 'unsafe-inline'"),
		"CSP must not allow arbitrary inline style elements",
	);
	assert.ok(
		csp?.includes("style-src-elem 'self' 'nonce-"),
		"CSP must nonce inline style elements",
	);
	assert.ok(
		csp?.includes("style-src-attr 'unsafe-inline'"),
		"CSP must isolate React style attribute compatibility to style-src-attr",
	);

	const xFrame = response.headers.get("x-frame-options");
	assert.equal(xFrame, "DENY", "X-Frame-Options must be DENY");

	const nosniff = response.headers.get("x-content-type-options");
	assert.equal(nosniff, "nosniff");
});

test("HTML responses do not emit un-nonced inline style blocks", async (t) => {
	const server = createWebAppServer({ api: mockApi(), token: "test-token" });
	t.after(() => server.close());
	const info = await server.listen(0, "127.0.0.1");

	const response = await fetch(`${info.url}/`);
	assert.equal(response.status, 200);
	const csp = response.headers.get("content-security-policy");
	const nonce = /style-src-elem 'self' 'nonce-([^']+)'/.exec(csp ?? "")?.[1];
	assert.ok(nonce, "CSP must include a style nonce");

	const body = await response.text();
	for (const match of body.matchAll(/<style\b([^>]*)>/gi)) {
		assert.match(
			match[1] ?? "",
			new RegExp(`\\bnonce="${nonce.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`),
			"inline style blocks must use the CSP nonce",
		);
	}
});

test("web app server returns readable tasks availability when broker is unreachable", async (t) => {
	// Use a port that nothing is listening on
	const previousPort = process.env.BROKER_PORT;
	process.env.BROKER_PORT = "19999";
	t.after(() => {
		if (previousPort === undefined) delete process.env.BROKER_PORT;
		else process.env.BROKER_PORT = previousPort;
	});

	const server = createWebAppServer({ api: mockApi(), token: "test-token" });
	t.after(() => server.close());
	const info = await server.listen(0, "127.0.0.1");

	const tasks = await fetch(`${info.url}/api/tasks`, {
		headers: { authorization: "Bearer test-token" },
	});
	assert.equal(
		tasks.status,
		200,
		"Tasks list should stay readable when broker is unreachable",
	);
	const body = (await tasks.json()) as {
		code: string;
		available: boolean;
		tasks: unknown[];
		error: string;
	};
	assert.equal(body.code, "capability_unavailable");
	assert.equal(body.available, false);
	assert.deepEqual(body.tasks, []);
	assert.match(body.error, /task runtime is offline/i);
});

test("web app server exposes data and package endpoints without trading product routes", async (t) => {
	const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "bc-web-product-"));
	const previousHome = process.env.BROWSER_CONTROL_HOME;
	process.env.BROWSER_CONTROL_HOME = tmpHome;
	t.after(() => {
		if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
		else process.env.BROWSER_CONTROL_HOME = previousHome;
		fs.rmSync(tmpHome, { recursive: true, force: true });
	});

	const server = createWebAppServer({ api: mockApi(), token: "test-token" });
	t.after(() => server.close());
	const info = await server.listen(0, "127.0.0.1");
	const headers = { authorization: "Bearer test-token" };

	const dataHome = await fetch(`${info.url}/api/data/doctor`, { headers });
	assert.equal(dataHome.status, 200);
	assert.equal(
		((await dataHome.json()) as { schemaVersion: number }).schemaVersion,
		2,
	);

	const packages = await fetch(`${info.url}/api/packages`, { headers });
	assert.equal(packages.status, 200);
	assert.equal(
		((await packages.json()) as Array<{ name: string }>)[0].name,
		"basic-test-package",
	);

	const trading = await fetch(`${info.url}/api/trading/status`, { headers });
	assert.equal(trading.status, 404);
});

test("web app server lists screenshots from direct runtime session folders", async (t) => {
	const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "bc-web-screenshots-"));
	const previousHome = process.env.BROWSER_CONTROL_HOME;
	process.env.BROWSER_CONTROL_HOME = tmpHome;
	t.after(() => {
		if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
		else process.env.BROWSER_CONTROL_HOME = previousHome;
		fs.rmSync(tmpHome, { recursive: true, force: true });
	});

	const sessionDir = path.join(tmpHome, "runtime", "qa-flow_a370f357");
	const screenshotsDir = path.join(sessionDir, "screenshots");
	fs.mkdirSync(screenshotsDir, { recursive: true });
	writeTinyPng(path.join(screenshotsDir, "direct.png"), [255, 0, 0, 255]);
	fs.writeFileSync(
		path.join(sessionDir, "manifest.json"),
		`${JSON.stringify({ sessionId: "a370f357", name: "QA Flow" })}\n`,
	);

	const server = createWebAppServer({ api: mockApi(), token: "test-token" });
	t.after(() => server.close());
	const info = await server.listen(0, "127.0.0.1");

	const response = await fetch(`${info.url}/api/screenshots`, {
		headers: { authorization: "Bearer test-token" },
	});
	assert.equal(response.status, 200);
	const screenshots = (await response.json()) as Array<{
		name: string;
		sessionDir: string;
	}>;

	assert.deepEqual(
		screenshots.map((entry) => ({
			name: entry.name,
			sessionDir: entry.sessionDir,
		})),
		[{ name: "direct.png", sessionDir: "qa-flow_a370f357" }],
	);
});

// ── Regression 1: Terminal stream event contract ─────────────────────

test("terminal output WebSocket event uses correct payload shape", async (t) => {
	const server = createWebAppServer({ api: mockApi(), token: "test-token" });
	t.after(() => server.close());
	await server.listen(0, "127.0.0.1");
	const address = server.address() as AddressInfo;

	const socket = new WebSocket(
		`${baseUrl(address).replace("http", "ws")}/events`,
		"test-token",
	);
	t.after(() => socket.close());

	const replayEvent = once(socket, "message");
	await once(socket, "open");
	await replayEvent;

	server.events.emit("terminal.output", {
		sessionId: "test-session",
		data: "hello\n",
	});

	const [msg] = await once(socket, "message");
	const event = JSON.parse(msg.toString());

	assert.equal(event.type, "terminal.output");
	assert.equal(typeof event.payload, "object");
	assert.equal(event.payload.sessionId, "test-session");
	assert.equal(event.payload.data, "hello\n");
});

test("terminal output WebSocket supports per-session subscription filtering", async (t) => {
	const server = createWebAppServer({ api: mockApi(), token: "test-token" });
	t.after(() => server.close());
	await server.listen(0, "127.0.0.1");
	const address = server.address() as AddressInfo;
	const wsBase = `${baseUrl(address).replace("http", "ws")}/events`;

	const socket = new WebSocket(`${wsBase}?sessionId=session-a`, "test-token");
	t.after(() => socket.close());
	const replayEvent = once(socket, "message");
	await once(socket, "open");
	await replayEvent;

	server.events.emit(
		"terminal.output",
		{ sessionId: "session-b", data: "secret-b\n" },
		{ sessionId: "session-b" },
	);

	const leaked = await Promise.race([
		once(socket, "message").then(() => true),
		new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 150)),
	]);
	assert.equal(
		leaked,
		false,
		"session-a subscriber must not receive session-b output",
	);

	server.events.emit(
		"terminal.output",
		{ sessionId: "session-a", data: "visible-a\n" },
		{ sessionId: "session-a" },
	);

	const [msg] = await once(socket, "message");
	const event = JSON.parse(msg.toString());
	assert.equal(event.type, "terminal.output");
	assert.equal(event.sessionId, "session-a");
	assert.equal(event.payload.data, "visible-a\n");
});

test("terminal output WebSocket accepts dynamic subscribe messages", async (t) => {
	const server = createWebAppServer({ api: mockApi(), token: "test-token" });
	t.after(() => server.close());
	await server.listen(0, "127.0.0.1");
	const address = server.address() as AddressInfo;

	const socket = new WebSocket(
		`${baseUrl(address).replace("http", "ws")}/events`,
		"test-token",
	);
	t.after(() => socket.close());
	const replayEvent = once(socket, "message");
	await once(socket, "open");
	await replayEvent;

	socket.send(
		JSON.stringify({ type: "subscribe", channels: ["terminal:session-a"] }),
	);
	const [ack] = await once(socket, "message");
	assert.deepEqual(JSON.parse(ack.toString()), {
		type: "subscription.updated",
		channels: ["terminal:session-a"],
	});

	server.events.emit(
		"terminal.output",
		{ sessionId: "session-b", data: "hidden-b\n" },
		{ sessionId: "session-b" },
	);
	const leaked = await Promise.race([
		once(socket, "message").then(() => true),
		new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 150)),
	]);
	assert.equal(leaked, false);

	server.events.emit(
		"terminal.output",
		{ sessionId: "session-a", data: "visible-a\n" },
		{ sessionId: "session-a" },
	);
	const [msg] = await once(socket, "message");
	const event = JSON.parse(msg.toString());
	assert.equal(event.type, "terminal.output");
	assert.equal(event.payload.data, "visible-a\n");
});

// ── Regression 3: Subscription lifecycle ─────────────────────────────

test("server.close() disposes terminal output subscription", async (_t) => {
	let disposed = false;
	const api = mockApi();
	api.terminal.onOutput = () => ({
		dispose: () => {
			disposed = true;
		},
	});

	const server = createWebAppServer({ api, token: "test-token" });
	await server.listen(0, "127.0.0.1");
	await server.close();

	assert.equal(
		disposed,
		true,
		"Terminal output subscription must be disposed on close",
	);
});

test("server.close() closes WebSocket event clients", async (_t) => {
	const server = createWebAppServer({ api: mockApi(), token: "test-token" });
	const _info = await server.listen(0, "127.0.0.1");
	const address = server.address() as AddressInfo;

	const socket = new WebSocket(
		`${baseUrl(address).replace("http", "ws")}/events`,
		"test-token",
	);
	const openPromise = once(socket, "open");
	const closePromise = once(socket, "close");
	await openPromise;

	await server.close();

	// Socket should be closed by the server
	await closePromise;
	assert.equal(
		socket.readyState,
		WebSocket.CLOSED,
		"WebSocket should be closed after server.close()",
	);
});

// ── Regression 4: Port 0 origin validation ────────────────────────────

test("port 0 server computes correct origin after listen", async (t) => {
	const server = createWebAppServer({ api: mockApi(), token: "test-token" });
	t.after(() => server.close());
	const info = await server.listen(0, "127.0.0.1");
	const address = server.address() as AddressInfo;

	assert.ok(address.port > 0, "Server must be assigned a real port");
	assert.ok(info.port > 0, "Info must reflect assigned port");
	assert.notEqual(info.port, 0, "Info port must not be 0");

	// Test that WebSocket with correct Origin connects
	const socket = new WebSocket(
		`${baseUrl(address).replace("http", "ws")}/events`,
		"test-token",
		{ origin: info.url },
	);
	t.after(() => socket.close());

	const [replay] = await once(socket, "message");
	assert.ok(
		JSON.parse(replay.toString()).type === "runtime.status",
		"Should receive replay event with correct origin",
	);
});

test("port 0 server rejects wrong origin on WebSocket", async (t) => {
	const server = createWebAppServer({ api: mockApi(), token: "test-token" });
	t.after(() => server.close());
	const info = await server.listen(0, "127.0.0.1");

	const socket = new WebSocket(
		`${info.url.replace("http", "ws")}/events`,
		"test-token",
		{ origin: "http://evil.com:9999" },
	);
	t.after(() => {
		try {
			socket.close();
		} catch {
			/* ignore */
		}
	});

	const [err] = await once(socket, "error");
	assert.match(String(err), /403|Forbidden/);
});

// ── Regression 2: Broker WebSocket auth ──────────────────────────────

test("broker WebSocket accepts X-API-Key header auth", async (t) => {
	const broker = createBrokerServer({
		env: {
			...process.env,
			BROKER_API_KEY: "broker-secret",
		},
	});
	t.after(() => broker.close());
	const addr = await broker.listen(0, "127.0.0.1");

	const socket = new WebSocket(`ws://127.0.0.1:${addr.port}/ws`, {
		headers: { "X-API-Key": "broker-secret" },
	});
	t.after(() => socket.close());

	await once(socket, "open");
	assert.equal(
		socket.readyState,
		WebSocket.OPEN,
		"Broker WebSocket should connect with X-API-Key header",
	);
});

test("broker WebSocket rejects without auth when key is configured", async (t) => {
	const broker = createBrokerServer({
		env: {
			...process.env,
			BROKER_API_KEY: "broker-secret",
		},
	});
	t.after(() => broker.close());
	const addr = await broker.listen(0, "127.0.0.1");

	const socket = new WebSocket(`ws://127.0.0.1:${addr.port}/ws`);
	const [err] = await once(socket, "error");
	assert.match(String(err), /401|Unauthorized/);
});

test("POST /api/browser/dialog with action=list returns dialog list", async (t) => {
	const server = createWebAppServer({ api: mockApi(), token: "test-token" });
	t.after(() => server.close());
	const info = await server.listen(0, "127.0.0.1");

	const res = await fetch(`${info.url}/api/browser/dialog`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: "Bearer test-token",
		},
		body: JSON.stringify({ action: "list" }),
	});
	assert.equal(res.status, 200);
	const body = await res.json();
	assert.ok(body.success, "list action should succeed");
});

test("POST /api/browser/dialog with action=respond forwards dialog_id", async (t) => {
	const server = createWebAppServer({ api: mockApi(), token: "test-token" });
	t.after(() => server.close());
	const info = await server.listen(0, "127.0.0.1");

	const res = await fetch(`${info.url}/api/browser/dialog`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: "Bearer test-token",
		},
		body: JSON.stringify({
			action: "respond",
			dialog_id: "dlg-test-1",
			response: "accept",
		}),
	});
	assert.equal(res.status, 200);
	const body = await res.json();
	assert.ok(body.success, "respond action should succeed");
	assert.ok(body.data?.handled, "dialog should be marked handled");
});

test("POST /api/browser/dialog with invalid action returns 400", async (t) => {
	const server = createWebAppServer({ api: mockApi(), token: "test-token" });
	t.after(() => server.close());
	const info = await server.listen(0, "127.0.0.1");

	const res = await fetch(`${info.url}/api/browser/dialog`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: "Bearer test-token",
		},
		body: JSON.stringify({ action: "invalid" }),
	});
	assert.equal(res.status, 400);
});

test("POST /api/browser/dialog without auth returns 401", async (t) => {
	const server = createWebAppServer({ api: mockApi(), token: "test-token" });
	t.after(() => server.close());
	const info = await server.listen(0, "127.0.0.1");

	const res = await fetch(`${info.url}/api/browser/dialog`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ action: "list" }),
	});
	assert.equal(res.status, 401);
});

// ── CDP Route Tests ───────────────────────────────────────────────────────

test("POST /api/browser/cdp with method+timeoutMs returns result", async (t) => {
	const server = createWebAppServer({ api: mockApi(), token: "test-token" });
	t.after(() => server.close());
	const info = await server.listen(0, "127.0.0.1");

	const res = await fetch(`${info.url}/api/browser/cdp`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: "Bearer test-token",
		},
		body: JSON.stringify({ method: "Target.getTargets", timeoutMs: 5000 }),
	});
	assert.equal(res.status, 200);
	const body = await res.json();
	assert.ok(body.success);
});

test("POST /api/browser/cdp with targetId returns 403 with capability error", async (t) => {
	const server = createWebAppServer({ api: mockApi(), token: "test-token" });
	t.after(() => server.close());
	const info = await server.listen(0, "127.0.0.1");

	const res = await fetch(`${info.url}/api/browser/cdp`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: "Bearer test-token",
		},
		body: JSON.stringify({
			method: "Target.getTargets",
			targetId: "foo",
			timeoutMs: 5000,
		}),
	});
	assert.equal(res.status, 403);
	const body = await res.json();
	assert.equal(body.success, false);
});

test("POST /api/browser/cdp with frameId returns 403 with capability error", async (t) => {
	const server = createWebAppServer({ api: mockApi(), token: "test-token" });
	t.after(() => server.close());
	const info = await server.listen(0, "127.0.0.1");

	const res = await fetch(`${info.url}/api/browser/cdp`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: "Bearer test-token",
		},
		body: JSON.stringify({
			method: "Target.getTargets",
			frameId: "bar",
			timeoutMs: 5000,
		}),
	});
	assert.equal(res.status, 403);
	const body = await res.json();
	assert.equal(body.success, false);
});

test("POST /api/browser/cdp without timeoutMs returns 400", async (t) => {
	const server = createWebAppServer({ api: mockApi(), token: "test-token" });
	t.after(() => server.close());
	const info = await server.listen(0, "127.0.0.1");

	const res = await fetch(`${info.url}/api/browser/cdp`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: "Bearer test-token",
		},
		body: JSON.stringify({ method: "Target.getTargets" }),
	});
	assert.equal(res.status, 400);
});

test("POST /api/browser/cdp without method returns 400", async (t) => {
	const server = createWebAppServer({ api: mockApi(), token: "test-token" });
	t.after(() => server.close());
	const info = await server.listen(0, "127.0.0.1");

	const res = await fetch(`${info.url}/api/browser/cdp`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: "Bearer test-token",
		},
		body: JSON.stringify({ timeoutMs: 5000 }),
	});
	assert.equal(res.status, 400);
});

test("POST /api/browser/cdp without auth returns 401", async (t) => {
	const server = createWebAppServer({ api: mockApi(), token: "test-token" });
	t.after(() => server.close());
	const info = await server.listen(0, "127.0.0.1");

	const res = await fetch(`${info.url}/api/browser/cdp`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ method: "Target.getTargets", timeoutMs: 5000 }),
	});
	assert.equal(res.status, 401);
});

// ── Fix #3: Stdout token leak ─────────────────────────────────────────

test("printServerInfo does NOT write token to stdout by default", async (t) => {
	const { printServerInfo } = await import("../../src/web/server");
	const stdoutChunks: string[] = [];
	const stderrChunks: string[] = [];
	const origStdout = process.stdout.write;
	const origStderr = process.stderr.write;
	process.stdout.write = ((chunk: string | Uint8Array) => {
		stdoutChunks.push(String(chunk));
		return true;
	}) as typeof process.stdout.write;
	process.stderr.write = ((chunk: string | Uint8Array) => {
		stderrChunks.push(String(chunk));
		return true;
	}) as typeof process.stderr.write;
	t.after(() => {
		process.stdout.write = origStdout;
		process.stderr.write = origStderr;
	});

	const previousEnv = process.env.BROWSER_CONTROL_WEB_SHOW_TOKEN;
	delete process.env.BROWSER_CONTROL_WEB_SHOW_TOKEN;
	t.after(() => {
		if (previousEnv === undefined)
			delete process.env.BROWSER_CONTROL_WEB_SHOW_TOKEN;
		else process.env.BROWSER_CONTROL_WEB_SHOW_TOKEN = previousEnv;
	});

	printServerInfo({
		host: "127.0.0.1",
		port: 7790,
		token: "my-secret-token-12345",
		url: "http://127.0.0.1:7790",
	});

	const stdout = stdoutChunks.join("");
	const stderr = stderrChunks.join("");

	assert.match(stdout, /http:\/\/127\.0\.0\.1:7790/);
	assert.doesNotMatch(stdout, /my-secret-token/);
	assert.match(stderr, /my-secret-token/);
	assert.match(stderr, /WARNING/);
});

test("printServerInfo writes token to stdout when BROWSER_CONTROL_WEB_SHOW_TOKEN=1", async (t) => {
	const { printServerInfo } = await import("../../src/web/server");
	const stdoutChunks: string[] = [];
	const stderrChunks: string[] = [];
	const origStdout = process.stdout.write;
	const origStderr = process.stderr.write;
	process.stdout.write = ((chunk: string | Uint8Array) => {
		stdoutChunks.push(String(chunk));
		return true;
	}) as typeof process.stdout.write;
	process.stderr.write = ((chunk: string | Uint8Array) => {
		stderrChunks.push(String(chunk));
		return true;
	}) as typeof process.stderr.write;
	t.after(() => {
		process.stdout.write = origStdout;
		process.stderr.write = origStderr;
	});

	const previousEnv = process.env.BROWSER_CONTROL_WEB_SHOW_TOKEN;
	process.env.BROWSER_CONTROL_WEB_SHOW_TOKEN = "1";
	t.after(() => {
		if (previousEnv === undefined)
			delete process.env.BROWSER_CONTROL_WEB_SHOW_TOKEN;
		else process.env.BROWSER_CONTROL_WEB_SHOW_TOKEN = previousEnv;
	});

	printServerInfo({
		host: "127.0.0.1",
		port: 7790,
		token: "my-secret-token-12345",
		url: "http://127.0.0.1:7790",
	});

	const stdout = stdoutChunks.join("");
	assert.match(stdout, /my-secret-token/);
});

// ── Fix #9: WebSocket token in query string ───────────────────────────

test("WebSocket connects via Sec-WebSocket-Protocol header instead of query string", async (t) => {
	const server = createWebAppServer({
		api: mockApi(),
		token: "ws-protocol-token",
	});
	t.after(() => server.close());
	await server.listen(0, "127.0.0.1");
	const address = server.address() as AddressInfo;

	const socket = new WebSocket(
		`${baseUrl(address).replace("http", "ws")}/events`,
		"ws-protocol-token",
	);
	t.after(() => socket.close());

	const [msg] = await once(socket, "message");
	const event = JSON.parse(msg.toString());
	assert.equal(event.type, "runtime.status");
	assert.ok(Array.isArray(event.events));
});

test("WebSocket rejects auth token in query string", async (t) => {
	const server = createWebAppServer({
		api: mockApi(),
		token: "query-token-rejected",
	});
	t.after(() => server.close());
	await server.listen(0, "127.0.0.1");
	const address = server.address() as AddressInfo;

	const socket = new WebSocket(
		`${baseUrl(address).replace("http", "ws")}/events?token=query-token-rejected`,
	);
	t.after(() => socket.close());

	const [err] = await once(socket, "error");
	assert.match(String(err), /401/);
});

test("WebSocket rejects bearer auth header without protocol token", async (t) => {
	const server = createWebAppServer({
		api: mockApi(),
		token: "ws-header-rejected",
	});
	t.after(() => server.close());
	await server.listen(0, "127.0.0.1");
	const address = server.address() as AddressInfo;

	const socket = new WebSocket(
		`${baseUrl(address).replace("http", "ws")}/events`,
		{
			headers: {
				authorization: "Bearer ws-header-rejected",
			},
		},
	);
	t.after(() => socket.close());

	const [err] = await once(socket, "error");
	assert.match(String(err), /401/);
});

test("WebSocket without token (no query, no protocol) gets 401", async (t) => {
	const server = createWebAppServer({ api: mockApi(), token: "test-token" });
	t.after(() => server.close());
	await server.listen(0, "127.0.0.1");
	const address = server.address() as AddressInfo;

	const socket = new WebSocket(
		`${baseUrl(address).replace("http", "ws")}/events`,
	);
	const [err] = await once(socket, "error");
	assert.match(String(err), /401/);
});
