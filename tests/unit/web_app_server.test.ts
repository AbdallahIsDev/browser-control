import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { WebSocket } from "ws";
import type { BrowserControlAPI } from "../../src/browser_control";
import { createBrokerServer } from "../../src/runtime/broker_server";
import type { ActionResult } from "../../src/shared/action_result";
import { createWebAppServer } from "../../src/web/server";

function actionResult<T>(data: T): ActionResult<T> {
	return {
		success: true,
		path: "command",
		sessionId: "system",
		data,
		completedAt: "2026-05-02T00:00:00.000Z",
	};
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
		},
		close: () => undefined,
	} as unknown as BrowserControlAPI;
}

function baseUrl(address: AddressInfo): string {
	return `http://127.0.0.1:${address.port}`;
}

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
		`${baseUrl(address).replace("http", "ws")}/events?token=test-token`,
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

test("web app server bridges task and automation endpoints through broker", async (t) => {
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

	const xFrame = response.headers.get("x-frame-options");
	assert.equal(xFrame, "DENY", "X-Frame-Options must be DENY");

	const nosniff = response.headers.get("x-content-type-options");
	assert.equal(nosniff, "nosniff");
});

test("web app server returns 503 for broker endpoints when broker is unreachable", async (t) => {
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
		503,
		"Tasks endpoint should return 503 when broker is unreachable",
	);
	const body = (await tasks.json()) as { code: string };
	assert.equal(body.code, "capability_unavailable");
});

// ── Regression 1: Terminal stream event contract ─────────────────────

test("terminal output WebSocket event uses correct payload shape", async (t) => {
	const server = createWebAppServer({ api: mockApi(), token: "test-token" });
	t.after(() => server.close());
	await server.listen(0, "127.0.0.1");
	const address = server.address() as AddressInfo;

	const socket = new WebSocket(
		`${baseUrl(address).replace("http", "ws")}/events?token=test-token`,
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
		`${baseUrl(address).replace("http", "ws")}/events?token=test-token`,
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
		`${baseUrl(address).replace("http", "ws")}/events?token=test-token`,
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
		`${info.url.replace("http", "ws")}/events?token=test-token`,
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
