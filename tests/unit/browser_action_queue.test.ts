import assert from "node:assert/strict";
import test from "node:test";
import { BrowserActionQueue } from "../../src/browser/action_queue";

function deferred<T = void>(): {
	promise: Promise<T>;
	resolve: (value: T) => void;
} {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

function tick(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

test("browser action queue serializes work per session", async () => {
	const queue = new BrowserActionQueue({
		maxGlobalConcurrency: 4,
		maxPerSessionConcurrency: 1,
		maxQueueDepth: 10,
	});
	const firstBlocker = deferred();
	const events: string[] = [];

	const first = queue.enqueue("session-a", "first", async () => {
		events.push("first:start");
		await firstBlocker.promise;
		events.push("first:end");
		return "first";
	});
	const second = queue.enqueue("session-a", "second", async () => {
		events.push("second:start");
		return "second";
	});

	await tick();
	assert.deepEqual(events, ["first:start"]);
	assert.deepEqual(queue.stats(), {
		running: 1,
		queued: 1,
		maxGlobalConcurrency: 4,
		maxPerSessionConcurrency: 1,
		maxQueueDepth: 10,
		perSession: [{ sessionId: "session-a", running: 1, queued: 1 }],
	});

	firstBlocker.resolve();
	assert.deepEqual(await Promise.all([first, second]), ["first", "second"]);
	assert.deepEqual(events, ["first:start", "first:end", "second:start"]);
});

test("browser action queue lets other sessions proceed around a busy session", async () => {
	const queue = new BrowserActionQueue({
		maxGlobalConcurrency: 2,
		maxPerSessionConcurrency: 1,
		maxQueueDepth: 10,
	});
	const firstBlocker = deferred();
	const events: string[] = [];

	const first = queue.enqueue("session-a", "first", async () => {
		events.push("session-a:first");
		await firstBlocker.promise;
		return "first";
	});
	const second = queue.enqueue("session-a", "second", async () => {
		events.push("session-a:second");
		return "second";
	});
	const other = queue.enqueue("session-b", "other", async () => {
		events.push("session-b:other");
		return "other";
	});

	await tick();
	assert.deepEqual(events, ["session-a:first", "session-b:other"]);
	assert.equal(queue.stats().running, 1);
	assert.equal(await other, "other");

	firstBlocker.resolve();
	assert.deepEqual(await Promise.all([first, second]), ["first", "second"]);
	assert.deepEqual(events, [
		"session-a:first",
		"session-b:other",
		"session-a:second",
	]);
});

test("browser action queue rejects work when queued depth is full", async () => {
	const queue = new BrowserActionQueue({
		maxGlobalConcurrency: 1,
		maxPerSessionConcurrency: 1,
		maxQueueDepth: 1,
	});
	const blocker = deferred();
	const first = queue.enqueue("session-a", "first", async () => {
		await blocker.promise;
		return "first";
	});
	const second = queue.enqueue("session-a", "second", async () => "second");
	await assert.rejects(
		queue.enqueue("session-a", "third", async () => "third"),
		/queue is full/u,
	);

	blocker.resolve();
	assert.deepEqual(await Promise.all([first, second]), ["first", "second"]);
});

test("browser action queue releases capacity after synchronous runner throws", async () => {
	const queue = new BrowserActionQueue({
		maxGlobalConcurrency: 1,
		maxPerSessionConcurrency: 1,
		maxQueueDepth: 10,
	});

	await assert.rejects(
		queue.enqueue("session-a", "throws", () => {
			throw new Error("boom");
		}),
		/boom/u,
	);

	assert.deepEqual(queue.stats().perSession, []);
	assert.equal(
		await queue.enqueue("session-a", "next", async () => "next"),
		"next",
	);
});
