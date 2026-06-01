import assert from "node:assert/strict";
import test from "node:test";
import { WebSocket } from "ws";
import { WebEventHub } from "../../src/web/events";

type FakeClient = {
	readyState: number;
	bufferedAmount: number;
	closeCalls: number;
	terminateCalls: number;
	sent: string[];
	send: (data: string, callback?: (error?: Error) => void) => void;
	close: () => void;
	terminate: () => void;
};

function fakeClient(
	overrides: Partial<Pick<FakeClient, "bufferedAmount" | "send">> = {},
): FakeClient {
	const client: FakeClient = {
		readyState: WebSocket.OPEN,
		bufferedAmount: 0,
		closeCalls: 0,
		terminateCalls: 0,
		sent: [],
		send(data, callback) {
			client.sent.push(data);
			callback?.();
		},
		close() {
			client.closeCalls += 1;
			client.readyState = WebSocket.CLOSED;
		},
		terminate() {
			client.terminateCalls += 1;
			client.readyState = WebSocket.CLOSED;
		},
		...overrides,
	};
	return client;
}

function addClients(hub: WebEventHub, clients: FakeClient[]): void {
	const internal = hub as unknown as {
		wss: { clients: Set<WebSocket> };
	};
	for (const client of clients) {
		internal.wss.clients.add(client as unknown as WebSocket);
	}
}

function clearClients(hub: WebEventHub): void {
	const internal = hub as unknown as {
		wss: { clients: Set<WebSocket> };
	};
	internal.wss.clients.clear();
}

test("web event hub isolates send failures per client", () => {
	const hub = new WebEventHub();
	const failing = fakeClient({
		send() {
			throw new Error("socket write failed");
		},
	});
	const healthy = fakeClient();
	addClients(hub, [failing, healthy]);
	try {
		const event = hub.emit("terminal.output", {
			sessionId: "session-a",
			data: "hello",
		});

		assert.equal(event.type, "terminal.output");
		assert.equal(failing.terminateCalls, 1);
		assert.equal(healthy.sent.length, 1);
		assert.equal(JSON.parse(healthy.sent[0]).payload.data, "hello");
	} finally {
		clearClients(hub);
	}
});

test("web event hub drops backpressured clients before broadcasting", () => {
	const hub = new WebEventHub();
	let slowSendCalled = false;
	const slow = fakeClient({
		bufferedAmount: 2_000_000,
		send() {
			slowSendCalled = true;
		},
	});
	const healthy = fakeClient();
	addClients(hub, [slow, healthy]);
	try {
		hub.emit("terminal.output", { sessionId: "session-a", data: "visible" });

		assert.equal(slowSendCalled, false);
		assert.equal(slow.terminateCalls, 1);
		assert.equal(healthy.sent.length, 1);
		assert.equal(JSON.parse(healthy.sent[0]).payload.data, "visible");
	} finally {
		clearClients(hub);
	}
});

test("web event hub evicts clients after asynchronous send errors", async () => {
	const hub = new WebEventHub();
	const failing = fakeClient({
		send(data, callback) {
			failing.sent.push(data);
			setImmediate(() => callback?.(new Error("async write failed")));
		},
	});
	const healthy = fakeClient();
	addClients(hub, [failing, healthy]);
	try {
		hub.emit("terminal.output", { sessionId: "session-a", data: "async" });
		await new Promise((resolve) => setImmediate(resolve));

		assert.equal(failing.sent.length, 1);
		assert.equal(failing.terminateCalls, 1);
		assert.equal(healthy.sent.length, 1);
		assert.equal(JSON.parse(healthy.sent[0]).payload.data, "async");
	} finally {
		clearClients(hub);
	}
});

test("web event hub terminates clients whose sends never complete", async () => {
	const hub = new WebEventHub({ sendTimeoutMs: 5 });
	const stalled = fakeClient({
		send(data) {
			stalled.sent.push(data);
		},
	});
	addClients(hub, [stalled]);
	try {
		hub.emit("terminal.output", { sessionId: "session-a", data: "stalled" });
		await new Promise((resolve) => setTimeout(resolve, 25));

		assert.equal(stalled.sent.length, 1);
		assert.equal(stalled.terminateCalls, 1);
		assert.equal(stalled.readyState, WebSocket.CLOSED);
	} finally {
		clearClients(hub);
	}
});
