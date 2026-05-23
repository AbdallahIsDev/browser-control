import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { installGlobalFatalHandlers } from "../../src/shared/fatal_handlers";

const root = path.resolve(__dirname, "..", "..");

test("CLI, web, and daemon entrypoints install global fatal handlers", () => {
	for (const file of [
		"src/cli.ts",
		"src/web/server.ts",
		"src/daemon.ts",
		"src/runtime/daemon.ts",
	]) {
		const source = fs.readFileSync(path.join(root, file), "utf8");
		assert.match(
			source,
			/installGlobalFatalHandlers/u,
			`${file} must install fatal process handlers`,
		);
	}
});

test("fatal handler logs, sets exitCode, and runs shutdown once", async () => {
	const listeners = new Map<string, (...args: unknown[]) => void>();
	const fakeProcess = {
		pid: Math.floor(Math.random() * 1_000_000),
		exitCode: undefined as number | undefined,
		on(event: string, listener: (...args: unknown[]) => void) {
			listeners.set(event, listener);
			return this;
		},
	} as unknown as NodeJS.Process;
	const criticalLogs: Array<{ message: string; data?: Record<string, unknown> }> = [];
	let shutdownCalls = 0;

	installGlobalFatalHandlers({
		component: "fatal-handler-test",
		processRef: fakeProcess,
		logger: {
			critical(message: string, data?: Record<string, unknown>) {
				criticalLogs.push({ message, data });
			},
		},
		shutdown: () => {
			shutdownCalls += 1;
		},
	});

	listeners.get("unhandledRejection")?.(new Error("rejected"));
	listeners.get("uncaughtException")?.(new Error("thrown"));
	await new Promise((resolve) => setImmediate(resolve));

	assert.equal(fakeProcess.exitCode, 1);
	assert.equal(shutdownCalls, 1);
	assert.equal(criticalLogs.length, 2);
	assert.match(criticalLogs[0].message, /unhandledRejection/);
	assert.equal(criticalLogs[0].data?.error, "rejected");
	assert.match(criticalLogs[1].message, /uncaughtException/);
});
