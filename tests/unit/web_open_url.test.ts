import assert from "node:assert/strict";
import childProcess, {
	type ChildProcess,
	type SpawnOptions,
} from "node:child_process";
import test from "node:test";

type SpawnCall = {
	command: string;
	args: readonly string[];
	options: SpawnOptions;
};

function loadFreshWebServer(): typeof import("../../src/web/server") {
	const modulePath = require.resolve("../../src/web/server");
	delete require.cache[modulePath];
	return require(modulePath) as typeof import("../../src/web/server");
}

function fakeChild(onUnref: () => void): ChildProcess {
	return {
		unref: () => {
			onUnref();
			return undefined;
		},
	} as unknown as ChildProcess;
}

test("openUrlInDefaultBrowser on Windows avoids cmd shell parsing", () => {
	const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
	const originalSpawn = childProcess.spawn;
	let spawnCall: SpawnCall | undefined;
	let unrefCalled = false;

	Object.defineProperty(process, "platform", { value: "win32" });
	Object.defineProperty(childProcess, "spawn", {
		configurable: true,
		value: ((command: string, args: readonly string[], options: SpawnOptions) => {
			spawnCall = { command, args, options };
			return fakeChild(() => {
				unrefCalled = true;
			});
		}) as typeof childProcess.spawn,
	});

	try {
		const { openUrlInDefaultBrowser } = loadFreshWebServer();
		const url = "https://example.test/?q=1&next=calc.exe";

		openUrlInDefaultBrowser(url);

		assert.deepEqual(spawnCall, {
			command: "rundll32.exe",
			args: ["url.dll,FileProtocolHandler", url],
			options: {
				detached: true,
				stdio: "ignore",
				windowsHide: true,
			},
		});
		assert.equal(unrefCalled, true);
	} finally {
		if (originalPlatform) {
			Object.defineProperty(process, "platform", originalPlatform);
		}
		Object.defineProperty(childProcess, "spawn", {
			configurable: true,
			value: originalSpawn,
		});
		delete require.cache[require.resolve("../../src/web/server")];
	}
});

test("openUrlInDefaultBrowser rejects non-http URLs before spawning", () => {
	const originalSpawn = childProcess.spawn;
	let spawned = false;
	Object.defineProperty(childProcess, "spawn", {
		configurable: true,
		value: (() => {
			spawned = true;
			return fakeChild(() => undefined);
		}) as typeof childProcess.spawn,
	});

	try {
		const { openUrlInDefaultBrowser } = loadFreshWebServer();
		assert.throws(
			() => openUrlInDefaultBrowser("javascript:alert(1)"),
			/Only http and https URLs can be opened/u,
		);
		assert.equal(spawned, false);
	} finally {
		Object.defineProperty(childProcess, "spawn", {
			configurable: true,
			value: originalSpawn,
		});
		delete require.cache[require.resolve("../../src/web/server")];
	}
});
