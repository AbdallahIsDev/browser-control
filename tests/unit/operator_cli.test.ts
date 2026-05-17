import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { getBrowserActionPositionals, parseArgs, runCli } from "../../src/cli";

function makeHome(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "bc-operator-cli-"));
}

async function captureStdout(fn: () => Promise<void>): Promise<string> {
	const originalLog = console.log;
	const chunks: string[] = [];
	console.log = (value?: unknown) => {
		chunks.push(String(value ?? ""));
	};
	try {
		await fn();
	} finally {
		console.log = originalLog;
	}
	return chunks.join("\n");
}

function startBackend(label: string): Promise<{
	port: number;
	close: () => Promise<void>;
}> {
	const server = http.createServer((request, response) => {
		response.setHeader("content-type", "application/json");
		response.end(JSON.stringify({ label, url: request.url }));
	});
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			resolve({
				port: (server.address() as AddressInfo).port,
				close: () => new Promise((done) => server.close(() => done())),
			});
		});
	});
}

function requestProxy(url: string, host: string): Promise<{
	status: number;
	body: { label?: string; url?: string };
}> {
	const parsed = new URL(url);
	return new Promise((resolve, reject) => {
		const request = http.request(
			{
				hostname: parsed.hostname,
				port: parsed.port,
				path: `${parsed.pathname}${parsed.search}`,
				headers: { host },
			},
			(response) => {
				const chunks: Buffer[] = [];
				response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
				response.on("end", () => {
					const text = Buffer.concat(chunks).toString("utf8");
					resolve({
						status: response.statusCode ?? 0,
						body: text ? JSON.parse(text) : {},
					});
				});
			},
		);
		request.on("error", reject);
		request.end();
	});
}

test("parseArgs handles operator UX commands", () => {
	assert.deepEqual(parseArgs(["node", "cli.ts", "doctor", "--json"]).flags, {
		json: "true",
	});

	const configSet = parseArgs([
		"node",
		"cli.ts",
		"config",
		"set",
		"logLevel",
		"debug",
		"--json",
	]);
	assert.equal(configSet.command, "config");
	assert.equal(configSet.subcommand, "set");
	assert.deepEqual(configSet.positional, ["logLevel", "debug"]);

	const setup = parseArgs([
		"node",
		"cli.ts",
		"setup",
		"--non-interactive",
		"--profile",
		"trusted",
		"--skip-browser-test",
	]);
	assert.equal(setup.command, "setup");
	assert.equal(setup.flags["non-interactive"], "true");
	assert.equal(setup.flags.profile, "trusted");
	assert.equal(setup.flags["skip-browser-test"], "true");
});

test("bc config list --json writes clean parseable JSON", async () => {
	const home = makeHome();
	const previousHome = process.env.BROWSER_CONTROL_HOME;
	try {
		process.env.BROWSER_CONTROL_HOME = home;
		const output = await captureStdout(async () => {
			await runCli(["node", "cli.ts", "config", "list", "--json"]);
		});
		const parsed = JSON.parse(output);
		assert.ok(Array.isArray(parsed));
		assert.ok(
			parsed.some((entry: { key: string }) => entry.key === "dataHome"),
		);
	} finally {
		if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
		else process.env.BROWSER_CONTROL_HOME = previousHome;
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("bc browser provider catalog --json lists provider setup metadata without secrets", async () => {
	const home = makeHome();
	const previousHome = process.env.BROWSER_CONTROL_HOME;
	try {
		process.env.BROWSER_CONTROL_HOME = home;
		const output = await captureStdout(async () => {
			await runCli([
				"node",
				"cli.ts",
				"browser",
				"provider",
				"catalog",
				"--json",
			]);
		});
		const parsed = JSON.parse(output) as Array<{
			name: string;
			risk: string;
			requiresAuth: boolean;
		}>;
		const browserbase = parsed.find((entry) => entry.name === "browserbase");
		const e2b = parsed.find((entry) => entry.name === "e2b");
		const camofox = parsed.find((entry) => entry.name === "camofox");
		assert.ok(browserbase);
		assert.equal(browserbase.risk, "high");
		assert.equal(browserbase.requiresAuth, true);
		assert.ok(e2b);
		assert.equal(e2b.risk, "high");
		assert.equal(e2b.requiresAuth, true);
		assert.ok(camofox);
		assert.equal(camofox.risk, "high");
		assert.doesNotMatch(output, /secret-token|apiKeyValue/u);
	} finally {
		if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
		else process.env.BROWSER_CONTROL_HOME = previousHome;
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("bc web serve --json --port=0 stays alive until killed", async () => {
	const home = makeHome();
	const previousHome = process.env.BROWSER_CONTROL_HOME;
	try {
		process.env.BROWSER_CONTROL_HOME = home;

		const { spawn } = await import("node:child_process");
		const child = spawn(
			process.execPath,
			[
				"--require",
				"ts-node/register",
				"--require",
				"tsconfig-paths/register",
				"src/cli.ts",
				"web",
				"serve",
				"--json",
				"--port",
				"0",
			],
			{
				cwd: process.cwd(),
				env: { ...process.env, BROWSER_CONTROL_HOME: home },
			},
		);

		// Wait for JSON output
		let output = "";
		for await (const chunk of child.stdout) {
			output += chunk;
			if (output.includes("\n")) break;
		}

		const parsed = JSON.parse(output.trim().split(/\r?\n/)[0]);
		assert.strictEqual(parsed.success, true);
		assert.match(parsed.url, /^http:\/\/127\.0\.0\.1:\d+$/u);

		// Process should still be alive after output
		await new Promise((r) => setTimeout(r, 500));
		assert.equal(child.killed, false, "serve process should still be alive");

		child.kill();
		await new Promise((resolve) => child.once("exit", resolve));
	} finally {
		if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
		else process.env.BROWSER_CONTROL_HOME = previousHome;
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("bc web open --json --port=0 exits cleanly", async () => {
	const home = makeHome();
	const previousHome = process.env.BROWSER_CONTROL_HOME;
	try {
		process.env.BROWSER_CONTROL_HOME = home;

		const result = spawnSync(
			process.execPath,
			[
				"--require",
				"ts-node/register",
				"--require",
				"tsconfig-paths/register",
				"src/cli.ts",
				"web",
				"open",
				"--json",
				"--port",
				"0",
			],
			{
				cwd: process.cwd(),
				env: { ...process.env, BROWSER_CONTROL_HOME: home },
				encoding: "utf8",
				timeout: 10000,
			},
		);

		assert.equal(result.status, 0, result.stderr);
		const firstLine = result.stdout.trim().split(/\r?\n/)[0];
		const parsed = JSON.parse(firstLine);
		assert.strictEqual(parsed.success, true);
		assert.match(parsed.url, /^http:\/\/127\.0\.0\.1:\d+$/u);
	} finally {
		if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
		else process.env.BROWSER_CONTROL_HOME = previousHome;
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("desktop main.cjs passes --wait=true to keep server alive", () => {
	const mainPath = path.join(process.cwd(), "desktop", "main.cjs");
	const content = fs.readFileSync(mainPath, "utf8");
	assert.match(
		content,
		/--wait=true/,
		"desktop main.cjs should pass --wait=true to web serve",
	);
	assert.match(
		content,
		/BROWSER_CONTROL_NODE[\s\S]*npm_node_execpath[\s\S]*"node"/u,
		"desktop main.cjs should spawn the app server with Node, not Electron process.execPath",
	);
});

test("bc desktop start prefers Windows electron.exe over detached electron.cmd", () => {
	const cliPath = path.join(process.cwd(), "src", "cli.ts");
	const content = fs.readFileSync(cliPath, "utf8");
	assert.match(
		content,
		/node_modules[\s\S]*electron[\s\S]*dist[\s\S]*electron\.exe/u,
	);
	assert.match(
		content,
		/process\.platform === "win32"[\s\S]*fsMod\.existsSync\(windowsElectronExe\)/u,
	);
	assert.match(content, /BROWSER_CONTROL_NODE: process\.execPath/u);
});

test("bc --help does not import SQLite-backed runtime modules", () => {
	const home = makeHome();
	try {
		const result = spawnSync(
			process.execPath,
			[
				"--require",
				"ts-node/register",
				"--require",
				"tsconfig-paths/register",
				"src/cli.ts",
				"--help",
			],
			{
				cwd: process.cwd(),
				env: {
					...process.env,
					BROWSER_CONTROL_HOME: home,
					NODE_OPTIONS: "--trace-warnings",
				},
				encoding: "utf8",
			},
		);

		assert.equal(result.status, 0, result.stderr || result.stdout);
		assert.match(result.stdout, /Browser Control CLI/);
		assert.doesNotMatch(
			result.stderr,
			/SQLite|node:sqlite|ExperimentalWarning/,
		);
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("top-level browser actions keep the first user argument", () => {
	const parsed = parseArgs(["node", "cli.ts", "open", "https://example.com"]);
	assert.deepEqual(getBrowserActionPositionals("open", parsed), [
		"https://example.com",
	]);

	const fill = parseArgs([
		"node",
		"cli.ts",
		"fill",
		"#email",
		"user@example.com",
	]);
	assert.deepEqual(getBrowserActionPositionals("fill", fill), [
		"#email",
		"user@example.com",
	]);
});

test("bc policy import --json writes clean parseable JSON", async () => {
	const home = makeHome();
	const previousHome = process.env.BROWSER_CONTROL_HOME;
	const profilePath = path.join(home, "review-profile.json");
	fs.writeFileSync(
		profilePath,
		JSON.stringify({
			name: "review_profile",
			commandPolicy: {
				allowedCommands: [],
				deniedCommands: [],
				requireConfirmationCommands: [],
				restrictedWorkingDirectories: [],
				restrictedNetworkClasses: [],
				restrictedProcessClasses: [],
				restrictedServiceClasses: [],
			},
			filesystemPolicy: {
				allowedReadRoots: [],
				allowedWriteRoots: [],
				allowedDeleteRoots: [],
				recursiveDeleteDefaultBehavior: "require_confirmation",
				tempDirectoryDefaultBehavior: "allow",
			},
			browserPolicy: {
				allowedDomains: [],
				blockedDomains: [],
				fileUploadAllowed: true,
				fileDownloadAllowed: true,
				screenshotAllowed: true,
				clipboardAllowed: true,
				credentialSubmissionAllowed: false,
				automationOnlyInExplicitSessions: true,
			},
			lowLevelPolicy: {
				rawCdpAllowed: false,
				jsEvalAllowed: false,
				networkInterceptionAllowed: false,
				cookieExportImportAllowed: false,
				coordinateActionsAllowed: false,
				performanceTracesAllowed: true,
			},
			credentialPolicy: {
				secretUseConfirmThreshold: "all",
				secretRevealAllowed: true,
				secretAutoTypeAllowed: false,
				secretAutoPasteAllowed: false,
			},
			privacyPolicy: {
				profile: "balanced",
			},
		}),
		"utf8",
	);

	try {
		process.env.BROWSER_CONTROL_HOME = home;
		const output = await captureStdout(async () => {
			await runCli([
				"node",
				"cli.ts",
				"policy",
				"import",
				profilePath,
				"--json",
			]);
		});
		const parsed = JSON.parse(output);
		assert.equal(parsed.name, "review_profile");
	} finally {
		if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
		else process.env.BROWSER_CONTROL_HOME = previousHome;
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("bc service proxy start --json --port=0 stays alive until killed", async () => {
	const home = makeHome();
	const previousHome = process.env.BROWSER_CONTROL_HOME;
	try {
		process.env.BROWSER_CONTROL_HOME = home;

		const { spawn } = await import("node:child_process");
		const child = spawn(
			process.execPath,
			[
				"--require",
				"ts-node/register",
				"--require",
				"tsconfig-paths/register",
				"src/cli.ts",
				"service",
				"proxy",
				"start",
				"--json",
				"--port",
				"0",
			],
			{
				cwd: process.cwd(),
				env: { ...process.env, BROWSER_CONTROL_HOME: home },
			},
		);

		let output = "";
		for await (const chunk of child.stdout) {
			output += chunk;
			if (output.includes("\n")) break;
		}

		const parsed = JSON.parse(output.trim().split(/\r?\n/u)[0]);
		assert.equal(parsed.success, true);
		assert.match(parsed.data.url, /^http:\/\/127\.0\.0\.1:\d+$/u);

		await new Promise((r) => setTimeout(r, 500));
		assert.equal(child.killed, false, "proxy process should still be alive");

		child.kill();
		await new Promise((resolve) => child.once("exit", resolve));
	} finally {
		if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
		else process.env.BROWSER_CONTROL_HOME = previousHome;
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("bc service proxy status --json reports disabled without starting listener", async () => {
	const home = makeHome();
	const previousHome = process.env.BROWSER_CONTROL_HOME;
	try {
		process.env.BROWSER_CONTROL_HOME = home;
		const output = await captureStdout(async () => {
			await runCli(["node", "cli.ts", "service", "proxy", "status", "--json"]);
		});
		const parsed = JSON.parse(output);
		assert.equal(parsed.success, true);
		assert.equal(parsed.data.enabled, false);
		assert.equal(parsed.data.httpsEnabled, false);
	} finally {
		if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
		else process.env.BROWSER_CONTROL_HOME = previousHome;
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("bc service proxy background start status and stop manage daemonized proxy", async () => {
	const home = makeHome();
	const previousHome = process.env.BROWSER_CONTROL_HOME;
	try {
		process.env.BROWSER_CONTROL_HOME = home;
		const startOutput = await captureStdout(async () => {
			await runCli([
				"node",
				"cli.ts",
				"service",
				"proxy",
				"start",
				"--background=true",
				"--port",
				"0",
				"--json",
			]);
		});
		const started = JSON.parse(startOutput);
		assert.equal(started.success, true);
		assert.match(started.data.url, /^http:\/\/127\.0\.0\.1:\d+$/u);
		assert.equal(typeof started.data.pid, "number");

		const statusOutput = await captureStdout(async () => {
			await runCli(["node", "cli.ts", "service", "proxy", "status", "--json"]);
		});
		const status = JSON.parse(statusOutput);
		assert.equal(status.success, true);
		assert.equal(status.data.background, true);
		assert.equal(status.data.pid, started.data.pid);

		const stopOutput = await captureStdout(async () => {
			await runCli(["node", "cli.ts", "service", "proxy", "stop", "--json"]);
		});
		const stopped = JSON.parse(stopOutput);
		assert.equal(stopped.success, true);
		assert.equal(stopped.data.stopped, true);
	} finally {
		try {
			await captureStdout(async () => {
				await runCli(["node", "cli.ts", "service", "proxy", "stop", "--json"]);
			});
		} catch {
			/* best-effort cleanup */
		}
		if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
		else process.env.BROWSER_CONTROL_HOME = previousHome;
		const { resetStateStorage } = await import("../../src/state/index");
		resetStateStorage();
		for (let attempt = 0; attempt < 10; attempt++) {
			try {
				fs.rmSync(home, { recursive: true, force: true });
				break;
			} catch (error) {
				if (attempt === 9) break;
				await new Promise((resolve) => setTimeout(resolve, 150));
			}
		}
	}
});

test("bc browser provider add accepts explicit sandbox extension providers", async () => {
	const home = makeHome();
	const previousHome = process.env.BROWSER_CONTROL_HOME;
	try {
		process.env.BROWSER_CONTROL_HOME = home;
		const output = await captureStdout(async () => {
			await runCli([
				"node",
				"cli.ts",
				"browser",
				"provider",
				"add",
				"sandbox-e2b",
				"--type=e2b",
				"--endpoint=https://sandbox.example.test",
				"--api-key=sandbox-secret",
				"--yes",
				"--json",
			]);
		});
		const parsed = JSON.parse(output);
		assert.equal(parsed.success, true);
		assert.doesNotMatch(output, /sandbox-secret/u);
	} finally {
		if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
		else process.env.BROWSER_CONTROL_HOME = previousHome;
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("bc service proxy background reloads service registry updates", async () => {
	const home = makeHome();
	const previousHome = process.env.BROWSER_CONTROL_HOME;
	let first: Awaited<ReturnType<typeof startBackend>> | null = null;
	let second: Awaited<ReturnType<typeof startBackend>> | null = null;
	try {
		process.env.BROWSER_CONTROL_HOME = home;
		first = await startBackend("first");
		const firstBackend = first;
		await captureStdout(async () => {
			await runCli([
				"node",
				"cli.ts",
				"service",
				"register",
				"myapp",
				"--port",
				String(firstBackend.port),
				"--json",
			]);
		});
		const startOutput = await captureStdout(async () => {
			await runCli([
				"node",
				"cli.ts",
				"service",
				"proxy",
				"start",
				"--background=true",
				"--port",
				"0",
				"--json",
			]);
		});
		const started = JSON.parse(startOutput);
		const proxyUrl = `${started.data.url}/stable`;
		const host = `myapp.localhost:${started.data.port}`;
		const firstResponse = await requestProxy(proxyUrl, host);
		assert.equal(firstResponse.status, 200);
		assert.equal(firstResponse.body.label, "first");

		await first.close();
		first = null;
		second = await startBackend("second");
		const secondBackend = second;
		await captureStdout(async () => {
			await runCli([
				"node",
				"cli.ts",
				"service",
				"register",
				"myapp",
				"--port",
				String(secondBackend.port),
				"--json",
			]);
		});
		const secondResponse = await requestProxy(proxyUrl, host);
		assert.equal(secondResponse.status, 200);
		assert.equal(secondResponse.body.label, "second");
	} finally {
		try {
			await captureStdout(async () => {
				await runCli(["node", "cli.ts", "service", "proxy", "stop", "--json"]);
			});
		} catch {
			/* best-effort cleanup */
		}
		if (first) await first.close().catch(() => undefined);
		if (second) await second.close().catch(() => undefined);
		if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
		else process.env.BROWSER_CONTROL_HOME = previousHome;
		const { resetStateStorage } = await import("../../src/state/index");
		resetStateStorage();
		for (let attempt = 0; attempt < 10; attempt++) {
			try {
				fs.rmSync(home, { recursive: true, force: true });
				break;
			} catch {
				if (attempt === 9) break;
				await new Promise((resolve) => setTimeout(resolve, 150));
			}
		}
	}
});

test("bc service proxy startup manages explicit per-user startup files", async () => {
	const home = makeHome();
	const startupDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-proxy-startup-"));
	const previousHome = process.env.BROWSER_CONTROL_HOME;
	try {
		process.env.BROWSER_CONTROL_HOME = home;
		const installOutput = await captureStdout(async () => {
			await runCli([
				"node",
				"cli.ts",
				"service",
				"proxy",
				"startup",
				"install",
				`--startup-dir=${startupDir}`,
				"--command=bc-test",
				"--port=8080",
				"--yes",
				"--json",
			]);
		});
		const installed = JSON.parse(installOutput);
		assert.equal(installed.success, true);
		assert.equal(installed.data.enabled, true);
		assert.ok(String(installed.data.filePath).startsWith(startupDir));

		const uninstallOutput = await captureStdout(async () => {
			await runCli([
				"node",
				"cli.ts",
				"service",
				"proxy",
				"startup",
				"uninstall",
				`--startup-dir=${startupDir}`,
				"--yes",
				"--json",
			]);
		});
		const uninstalled = JSON.parse(uninstallOutput);
		assert.equal(uninstalled.success, true);
		assert.equal(uninstalled.data.enabled, false);
	} finally {
		if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
		else process.env.BROWSER_CONTROL_HOME = previousHome;
		fs.rmSync(home, { recursive: true, force: true });
		fs.rmSync(startupDir, { recursive: true, force: true });
	}
});

test("bc service proxy ca status reports explicit certificate paths without creating trust", async () => {
	const home = makeHome();
	const caDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-proxy-ca-cli-"));
	const previousHome = process.env.BROWSER_CONTROL_HOME;
	try {
		process.env.BROWSER_CONTROL_HOME = home;
		const output = await captureStdout(async () => {
			await runCli([
				"node",
				"cli.ts",
				"service",
				"proxy",
				"ca",
				"status",
				`--ca-dir=${caDir}`,
				"--json",
			]);
		});
		const status = JSON.parse(output);
		assert.equal(status.success, true);
		assert.equal(status.data.ready, false);
		assert.ok(String(status.data.caCertPath).startsWith(caDir));
		assert.equal(status.data.trusted, "unknown");
	} finally {
		if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
		else process.env.BROWSER_CONTROL_HOME = previousHome;
		fs.rmSync(home, { recursive: true, force: true });
		fs.rmSync(caDir, { recursive: true, force: true });
	}
});

test("bc workflow exposes events and typed state edit operator commands", async () => {
	const home = makeHome();
	const previousHome = process.env.BROWSER_CONTROL_HOME;
	const previousBackend = process.env.BROWSER_CONTROL_STATE_BACKEND;
	const graphPath = path.join(home, "approval-workflow.json");
	fs.writeFileSync(
		graphPath,
		JSON.stringify({
			id: "cli-approval-flow",
			name: "CLI Approval Flow",
			version: "1",
			stateSchema: { count: "number" },
			initialState: { count: 1 },
			nodes: [
				{
					id: "approval",
					kind: "approval",
					input: { message: "Continue?" },
				},
			],
			edges: [],
			entryNodeId: "approval",
		}),
		"utf8",
	);

	try {
		process.env.BROWSER_CONTROL_HOME = home;
		process.env.BROWSER_CONTROL_STATE_BACKEND = "json";
		const runOutput = await captureStdout(async () => {
			await runCli(["node", "cli.ts", "workflow", "run", graphPath, "--json"]);
		});
		const run = JSON.parse(runOutput);
		assert.equal(run.success, true);
		const runId = run.data.id;
		assert.equal(typeof runId, "string");

		const eventsOutput = await captureStdout(async () => {
			await runCli(["node", "cli.ts", "workflow", "events", runId, "--json"]);
		});
		const events = JSON.parse(eventsOutput);
		assert.equal(events.success, true);
		assert.ok(
			events.data.some(
				(event: { type: string; nodeId?: string }) =>
					event.type === "node-paused" && event.nodeId === "approval",
			),
		);

		const editOutput = await captureStdout(async () => {
			await runCli([
				"node",
				"cli.ts",
				"workflow",
				"edit-state",
				runId,
				"count",
				"2",
				"--json",
			]);
		});
		const edited = JSON.parse(editOutput);
		assert.equal(edited.success, true);
		assert.equal(edited.data.state.count, 2);
	} finally {
		if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
		else process.env.BROWSER_CONTROL_HOME = previousHome;
		if (previousBackend === undefined)
			delete process.env.BROWSER_CONTROL_STATE_BACKEND;
		else process.env.BROWSER_CONTROL_STATE_BACKEND = previousBackend;
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("bc dashboard open starts local web server", async () => {
	const home = makeHome();
	const previousHome = process.env.BROWSER_CONTROL_HOME;
	try {
		process.env.BROWSER_CONTROL_HOME = home;

		const result = spawnSync(
			process.execPath,
			[
				"--require",
				"ts-node/register",
				"--require",
				"tsconfig-paths/register",
				"src/cli.ts",
				"dashboard",
				"open",
				"--json",
				"--port",
				"0",
			],
			{
				cwd: process.cwd(),
				env: {
					...process.env,
					BROWSER_CONTROL_HOME: home,
				},
				encoding: "utf8",
			},
		);

		assert.equal(result.status, 0, result.stderr);
		const firstLine = result.stdout.trim().split(/\r?\n/u)[0];
		const parsed = JSON.parse(firstLine);
		assert.strictEqual(parsed.success, true);
		assert.match(parsed.url, /^http:\/\/127\.0\.0\.1:\d+$/u);
	} finally {
		if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
		else process.env.BROWSER_CONTROL_HOME = previousHome;
		fs.rmSync(home, { recursive: true, force: true });
	}
});
